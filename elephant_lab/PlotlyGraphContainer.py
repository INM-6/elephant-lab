class PlotlyGraphData:

    from .utils import OutputUtils
    import numpy as np

    def __init__(self, data, name_fallback='Trace', **kwargs):
        self.unit_x_conversion_factor = 1
        self.unit_y_conversion_factor = 1
        self.shift_x_to_0 = 0
        self.y_normalization_method = None
        self.y_offset = 0
        self.constant_sampling_rate = False
        self.last_full_sampled_x_range = None
        if data is None:
            self.x = [0]
            self.y = [0]
            self.name = 'nothing'
            self.mode = 'markers'
        else:
            self.extract_data(data)
            if not hasattr(self, 'name') or self.name is None:
                if callable(name_fallback):
                    self.name = name_fallback(data)
                else:
                    self.name = str(name_fallback)
        # Override / add attributes from kwargs
        l_name = len(self.name)
        if l_name > 13:
            idx = self.name.rfind('-')
            if idx == -1:
                self.name = f"{self.name[:10]}..."
            else:
                idx += 1
                l_end = l_name - idx
                if l_end < 7:
                    self.name = f"{self.name[:10-l_end]}...{self.name[idx:]}"
                else:
                    self.name = f"{self.name[:10]}..."

        for key, value in kwargs.items():
            setattr(self, key, value)

    def extract_data(self, data):
        """Generic extraction of x, y, mode, and name from various simple data types."""
        self.x = None
        self.y = None
        if hasattr(data, 'name'):
            self.name = data.name
        if hasattr(data, 'mode'):
            self.mode = data.mode
        if hasattr(data, 'marker'):
            self.marker = data.marker
        if hasattr(data, 'line'):
            self.line = data.line
        if hasattr(data, 'units_x'):
            self.units_x = data.units_x
        if hasattr(data, 'units_y'):
            self.units_y = data.units_y

        try:
            # Objects with x/y attributes
            if hasattr(data, 'x') and hasattr(data, 'y'):
                self.x = data.x
                self.y = data.y

            # Dicts with x/y keys
            elif isinstance(data, dict):
                self.x = data.get('x')
                self.y = data.get('y')

            # List of points [(x1,y1), ...]
            elif isinstance(data, (list, tuple)) and all(isinstance(i, (list, tuple)) and len(i) == 2 for i in data):
                self.x, self.y = zip(*data)

            # Pandas DataFrame or Series
            else:
                try:
                    import pandas as pd
                    if isinstance(data, pd.DataFrame):
                        self.x = data["x"]
                        self.y = data["y"]
                    elif isinstance(data, pd.Series):
                        self.y = data.tolist()
                        self.x = data.index.tolist()
                except ImportError:
                    pass

            # Convert to lists
            if self.x is not None:
                self.x = list(self.x)
            if self.y is not None:
                self.y = list(self.y)

        except Exception as e:
            self.OutputUtils.print_warning(f"Error extracting data for trace '{self.name}': {e}")
            self.x, self.y = None, None

    def normalize_x(self, x_values):
        if self.shift_x_to_0 != 0:
            x_values += self.shift_x_to_0
        if self.unit_x_conversion_factor != 1:
            x_values *= self.unit_x_conversion_factor
        return x_values

    def normalize_y(self, y_values):
        if self.y_normalization_method:
            y_values = self.y_normalization_method(y_values)
        else:
            if self.unit_y_conversion_factor != 1:
                y_values *= self.unit_y_conversion_factor
        if self.y_offset != 0:
            y_values += self.y_offset
        return y_values

    def un_normalize_x(self, x_values):
        if self.unit_x_conversion_factor != 1:
            x_values /= self.unit_x_conversion_factor
        if self.shift_x_to_0 != 0:
            x_values -= self.shift_x_to_0
        return x_values

    def to_dict(self, min_max_lttb_downsampler, x_range, max_points, common_units_x_label=None, common_units_y_label=None, setup = False):
        """name, mode, marker, x, y, (unit_x, unit_y)"""
        data_dict = {}
        if setup:
            data_dict['name'] = self.name
            data_dict['mode'] = self.mode
            if hasattr(self, "marker"):
                data_dict['marker'] = self.marker
            if hasattr(self, "units_x"):
                data_dict['units_x'] = self.OutputUtils.convert_unit_to_label(self.units_x) if common_units_x_label is None else common_units_x_label
            if hasattr(self, "units_y"):
                data_dict['units_y'] = self.OutputUtils.convert_unit_to_label(self.units_y) if common_units_y_label is None else common_units_y_label
            if hasattr(self, "use_name_as_ticklabels"):
                data_dict['use_name_as_ticklabels'] = self.use_name_as_ticklabels
            if hasattr(self, "minX"):
                data_dict['minX'] = self.minX
            if hasattr(self, "minY"):
                data_dict['minY'] = self.minY
            if hasattr(self, "maxX"):
                data_dict['maxX'] = self.maxX
            if hasattr(self, "maxY"):
                data_dict['maxY'] = self.maxY

        x_values = self.x
        y_values = self.y

        if x_range is not None:
            minX, maxX = x_range
            if self.last_full_sampled_x_range is not None:
                last_minX, last_maxX = self.last_full_sampled_x_range
                if last_minX <= minX <= maxX <= last_maxX:
                    return False
                self.last_full_sampled_x_range = None
            un_normalized_minX = self.un_normalize_x(minX)
            un_normalized_maxX = self.un_normalize_x(maxX)

            i0 = self.np.searchsorted(x_values, un_normalized_minX, side="left")
            i1 = self.np.searchsorted(x_values, un_normalized_maxX, side="right")

            x_values = x_values[i0:i1]
            y_values = y_values[i0:i1]

        n = x_values.size
        if n > max_points:
            if(self.constant_sampling_rate):
                s_ds = min_max_lttb_downsampler.downsample(y_values, n_out=max_points)
            else:
                s_ds = min_max_lttb_downsampler.downsample(x_values, y_values, n_out=max_points)
            x_values = x_values[s_ds]
            y_values = y_values[s_ds]
        else:
            self.last_full_sampled_x_range = x_range
            x_values = x_values.copy()
            y_values = y_values.copy()

        x_values = self.normalize_x(x_values)
        y_values = self.normalize_y(y_values)
        data_dict['x'] = x_values.tolist()
        data_dict['y'] = y_values.tolist()

        return data_dict

class PlotlyGraphDataList:
    from .utils import OutputUtils

    def __init__(self, data, name_fallback='Trace'):
        self.datas = []
        self.is_empty = False
        self.extract_data(data, name_fallback)

    def extract_data(self, data, name_fallback):
        if data is None:
            self.is_empty = True
            self.datas = [PlotlyGraphData(None, name_fallback)]
        elif isinstance(data, list) and self.is_trace_list(data):
            for d in data:
                try:
                    if not isinstance(d, PlotlyGraphData):
                        d = PlotlyGraphData(d, name_fallback)
                    self.datas.append(d)
                except Exception as e:
                    self.OutputUtils.print_warning(f"Failed to convert data to PlotlyGraphData: {e}")
        else:
            try:
                if not isinstance(data, PlotlyGraphData):
                    data = PlotlyGraphData(data, name_fallback)
                self.datas = [data]
            except Exception as e:
                self.OutputUtils.print_warning(f"Failed to convert data to PlotlyGraphData: {e}")

    def is_trace_list(self,data_list):
        """
        Returns True if data_list should be interpreted as a list of traces
        rather than a single trace of points.
        """
        if not isinstance(data_list, list):
            return False
        
        # Empty list is ambiguous: treat as a single trace
        if len(data_list) == 0:
            return False
        
        # If any element is already a PlotlyDataType, it's a list of traces
        if any(isinstance(el, PlotlyGraphData) for el in data_list):
            return True
        
        # If any element is a dict with x/y or has x/y attributes, treat as multiple traces
        if any((hasattr(el, 'x') and hasattr(el, 'y')) or
            (isinstance(el, dict) and 'x' in el and 'y' in el) for el in data_list):
            return True
        
        # Otherwise, treat it as a single trace (list of points)
        return False
    
    def concat(self, plotlyGraphDataList):
        self.is_empty = self.is_empty and plotlyGraphDataList.is_empty
        self.datas += plotlyGraphDataList.data_list

class PlotlyGraphAnnotation:
    import numpy as np

    def __init__(self, xs, texts, unit, durations=None):
        self.xs = xs
        self.texts = texts
        self.unit = unit
        self.durations = durations if durations is not None else self.np.zeros(xs.shape)
        self.unit_x_conversion_factor = 1

class PlotlyGraphDataBundle:

    import numpy as np
    from .utils import OutputUtils
    from tsdownsample import MinMaxLTTBDownsampler

    def __init__(self, data_list, annotation_list=None):
        if isinstance(data_list, PlotlyGraphDataBundle):
            self.data_list = data_list.data_list
            self.annotation_list = data_list.annotation_list
        else:
            if not isinstance(data_list, PlotlyGraphDataList):
                data_list = PlotlyGraphDataList(data_list)
            if not isinstance(annotation_list, list) or len (annotation_list)==0:
                annotation_list = None
            self.data_list = data_list
            self.annotation_list = annotation_list

    @property
    def datas(self):
        return self.data_list.datas

    @property
    def is_data_empty(self):
        return self.data_list.is_empty

    @is_data_empty.setter
    def is_data_empty(self, is_empty):
        self.data_list.is_empty = is_empty

    @property
    def is_annotation_empty(self):
        return self.annotation_list is None or len(self.annotation_list) == 0
    
    @property
    def is_empty(self):
        return self.is_data_empty and self. is_annotation_empty
    
    @property
    def minX(self):
        if self.annotation_minX is not None:
            return min(self.data_minX, self.annotation_minX)
        return self.data_minX

    @property
    def maxX(self):
        if self.annotation_maxX is not None:
            return max(self.data_maxX, self.annotation_maxX)
        return self.data_maxX

    
    def _set_default_attributes_for_normalization(self):
        """
        Sets default values for normalization.
        Theses are not set in the constructor to ensure,
        that they only can be used onces the object
        actually has been normalized.
        """
        self.common_units_x = None
        self.common_units_y = None
        self.data_minX = 0
        self.minY = 0
        self.data_maxX = 0
        self.maxY = 0
        self.annotation_minX = None
        self.annotation_maxX = None
        self.compress = False
        self.nGraphs = 1
        self.is_default_zero_based = True
        self.is_default_normalized_y = True

    def _filter_empty_and_normalize_complex(self):
        """
        Filters out empty traces and traces without the same amount of x and y values.
        Handles Complex, inf and nan values properly.
        Ensures x values are ordered (ASC).
        """
        if self.is_data_empty:
            return

        np = self.np

        filtered = []

        i = 0
        n_datas = len(self.datas)
        while i < n_datas:
            data = self.datas[i]
            x_values = np.asarray(data.x)
            y_values = np.asarray(data.y)
            x_length = len(x_values)
            y_length = len(y_values)

            if x_values is None or y_values is None or x_length != y_length:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing or empty or not the same length.")
                continue

            if np.iscomplexobj(x_values):
                x_values = np.abs(x_values)
            if np.iscomplexobj(y_values):
                name = data.name
                data.name = f"{name} (imag)"
                imag_data = PlotlyGraphData(data)
                imag_data.name = f"{name} (imag)"
                imag_data.y = np.imag(y_values)
                self.datas.insert(i+1, imag_data)
                n_datas += 1
                y_values = np.real(y_values)
                y_values = y_values
                data.name = f"{name} (real)"
            i+=1
            finite_mask = np.isfinite(x_values)

            if not np.all(finite_mask):
                x_values = x_values[finite_mask]
                y_values = y_values[finite_mask]

            if np.issubdtype(y_values.dtype, np.floating) and np.any(np.isinf(y_values)):
                y_values[np.isinf(y_values)] = np.nan

            # Check if x and y are valid
            x_length = len(x_values)
            y_length = len(y_values)
            if x_length == 0 or y_length == 0:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing")
                continue

            if np.any(x_values[1:] < x_values[:-1]):
                order = np.argsort(x_values)
                x_values = x_values[order]
                y_values = y_values[order]

            data.x = x_values
            data.y = y_values
            filtered.append(data)

        self.nGraphs = len(filtered)
        self.compress = self.nGraphs > 10
        self.is_data_empty == self.nGraphs == 0
        self.data_list.datas = filtered

    def _normalize_units(self, y_instead_of_x = False):
        """
        If there is one common_unit which all other units already are or
        can be converted to, thant it sets the fitting conversion factor for each data.
        Otherwise nothing is going converted.
        """
        if y_instead_of_x and self.is_data_empty:
            return
        units_string = "units_y" if y_instead_of_x else "units_x"
        unit_conversion_factor_string = "unit_y_conversion_factor" if y_instead_of_x else "unit_x_conversion_factor"
        common_units = self.annotation_list[0].unit if self.is_data_empty else getattr(self.datas[0], units_string, None)
        if common_units is None:
            return
        units_to_data = {}

        def handle_unit(unit, data):
            can_convert = self.OutputUtils.can_convert_units(unit, common_units)
            if can_convert == -1:
                return
            elif can_convert == 1:
                unit_key = unit.dimensionality
                if unit_key in units_to_data:
                    units_to_data[unit_key][1].append(data)
                else:
                    units_to_data[unit_key] = (unit, [data])

        if not self.is_data_empty:
            for data in self.datas:
                if hasattr(data, units_string):
                    handle_unit(getattr(data, units_string), data)
                else:
                    return
                
        if not y_instead_of_x and not self.is_annotation_empty:
            for annotation in self.annotation_list:
                handle_unit(annotation.unit, annotation)

        for unit, data in units_to_data.values():
            unit_conversion_factor = self.OutputUtils.get_conversion_factor(unit, common_units)
            for d in data:
                setattr(d, unit_conversion_factor_string, unit_conversion_factor)

        common_units_string = "common_units_y" if y_instead_of_x else "common_units_x"
        setattr(self, common_units_string, common_units)

    def _shift_to_0(self, shift_to_0):
        """
        Figures out if it ever needs to be shifted to 0.
        If it needs and should, than it sets the factor that the values
        need to be shifted by.
        """
        if self.is_data_empty:
            return
        is_default_zero_based = True
        for data in self.datas:
            minX = self.np.nanmin(data.x)
            if minX > 1e-9 or minX < -1e-9:
                is_default_zero_based = False
                if shift_to_0:
                    data.shift_x_to_0 = -minX
            data.minX = minX
        self.is_default_zero_based = is_default_zero_based

    def _normalize_y_values(self, normalize_y_values, normalization_method):
        """
        If normalization is desired, than it calculates the function, that needs to be applied
        to the y values to normalize them (Never normalizes for y values with only zeros).

        Normalization will not work equally (Unit conversion then normalizing, is different from just normalizing)
        if the common_units invoke an offset unit conversion like:
        °C → °F
        """
        if self.is_data_empty:
            return
        
        np = self.np
        is_default_normalized_y = True
        for data in self.datas:
            y_values = data.y
            if np.all(np.abs(y_values) <= np.finfo(y_values.dtype).eps):
                continue
            is_default_normalized_y = False
            if normalize_y_values:
                data.y_normalization_method = self.OutputUtils.normalize(y_values, normalization_method)
        self.is_default_normalized_y = is_default_normalized_y

    def _calc_min_max_apply_offset(self, offset_traces_on_compress):
        """
        Sets the absolute extreme values for each data and the total for all data
        and the total for all annotations.
        Sets a y offset for each data, if the graph is compressed and stacked.
        """

        np = self.np

        if not self.is_data_empty:
            minX = None
            minY = None
            maxX = None
            maxY = None
            previous_maxY = None
            for index, data in enumerate(self.datas):

                def dataExtremes(data):
                    minX = data.normalize_x(data.minX)
                    data.minX = minX
                    minY = data.normalize_y(np.nanmin(data.y))
                    data.minY = minY
                    maxX = data.normalize_x(np.nanmax(data.x))
                    data.maxX = maxX
                    maxY = data.normalize_y(np.nanmax(data.y))
                    data.maxY = maxY
                    return minX, minY, maxX, maxY

                if index == 0:
                    minX, minY, maxX, maxY = dataExtremes(data)
                    previous_maxY = maxY
                else:
                    temp_minX, temp_minY, temp_maxX, temp_maxY = dataExtremes(data)

                    if self.compress and offset_traces_on_compress:
                        offset = previous_maxY - temp_minY
                        span = (temp_maxY - temp_minY)
                        if span < 1e-9:
                            offset += 1
                        else:
                            gap = 0.05 * span
                            offset += gap
                        temp_minY += offset
                        temp_maxY += offset
                        previous_maxY = temp_maxY
                        data.minY = temp_minY
                        data.maxY = temp_maxY
                        data.y_offset = offset
                    
                    minX = min(minX, temp_minX)
                    minY = min(minY, temp_minY)
                    maxX = max(maxX, temp_maxX)
                    maxY = max(maxY, temp_maxY)
            self.data_minX = minX
            self.minY = minY
            self.data_maxX = maxX
            self.maxY = maxY

        if not self.is_annotation_empty:
            self.annotation_minX = min([np.nanmin(annotation.xs) * annotation.unit_x_conversion_factor for annotation in self.annotation_list])
            self.annotation_maxX = max([np.nanmax(annotation.xs) * annotation.unit_x_conversion_factor for annotation in self.annotation_list])
    
    def normalize(self, offset_traces_on_compress, shift_to_0, normalize_y_values, normalization_method):
        """
        Does the normalization steps and sets:
        common_units_x, common_units_y(They are None if no common units for x or y could be found), data_minX, annotation_minX, minY, data_maxX, annotation_maxX, maxY, is_default_zero_based, nGraphs, compress, is_data_empty, is_annotation_empty, is_default_normalized_y
        """
        normalization_steps = [
            self._set_default_attributes_for_normalization, 
            self._filter_empty_and_normalize_complex,
            self._normalize_units,
            lambda: self._shift_to_0(shift_to_0),
            lambda: self._normalize_units(y_instead_of_x=True),
            lambda: self._normalize_y_values(normalize_y_values, normalization_method),
            lambda: self._calc_min_max_apply_offset(offset_traces_on_compress)
        ]
        for normalization_step in normalization_steps:
            if self.is_empty:
                return
            normalization_step()
        self._min_max_lttb_downsampler = self.MinMaxLTTBDownsampler()

    def get_normalized_data_for_x_range(self, x_range=None, max_points=100000, setup = False):
        np = self.np

        max_points_per_data = int(max_points / len(self.datas))
        annotation_list_dict = {
            'xs': np.concatenate([annotation.xs * annotation.unit_x_conversion_factor for annotation in self.annotation_list]),
            'texts':  np.concatenate([annotation.texts for annotation in self.annotation_list]),
            'durations': np.concatenate([annotation.durations * annotation.unit_x_conversion_factor for annotation in self.annotation_list])
        } if not self.is_annotation_empty else None
        data_bundle_dict = {}
        common_units_x_label = None
        common_units_y_label = None
        if setup:
            if self.common_units_x is not None:
                common_units_x_label = self.OutputUtils.convert_unit_to_label(self.common_units_x)
                data_bundle_dict['common_units_x'] = common_units_x_label
            if self.common_units_y is not None:
                common_units_y_label = self.OutputUtils.convert_unit_to_label(self.common_units_y)
                data_bundle_dict['common_units_y'] = common_units_y_label
        plotly_graph_data_list = [
            {**d, "index": i}
            for i, data in enumerate(self.datas)
            if (d := data.to_dict(self._min_max_lttb_downsampler, x_range, max_points_per_data, common_units_x_label, common_units_y_label, setup))
        ]
        data_bundle_dict.update({
            'plotly_graph_data_list': plotly_graph_data_list,
            'plotly_graph_data_list_changed': len(plotly_graph_data_list) > 0,
            'annotation_list': annotation_list_dict,
            'annotation_list_changed': False,
        })
        if setup:
            data_bundle_dict.update({
                "compress": self.compress,
                "nGraphs": self.nGraphs,
                "minX": self.minX,
                "minY": self.minY,
                "maxX": self.maxX,
                "maxY": self.maxY,
                "extended_minY": self.minY,
                "extended_maxY": self.maxY
            })
        return data_bundle_dict