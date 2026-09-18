"""
Blueprints for the PlotlyGraphFigure compatible data objects

And Normalization for them
"""

class PlotlyGraphData:

    """
    Blueprint for the standard data, that will be displayed as a single trace
    """

    from .utils import OutputUtils
    import numpy as np

    def __init__(self, data, name_fallback='Trace', **kwargs):
        self.x = None
        self.y = None
        self.name = None
        self.mode = None
        self.marker = None
        self.line = None
        self.units_x = None
        self.units_y = None
        self.use_name_as_ticklabels = False
        self.unit_x_conversion_factor = 1
        self.unit_y_conversion_factor = 1
        self.shift_x_to_0 = 0
        self.y_normalization_method = None
        self.y_offset = 0
        self.constant_sampling_rate = False
        self.last_full_sampled_x_range = None
        if data is None:
            self.x = []
            self.y = []
            self.name = 'nothing'
            self.mode = 'markers'
        else:
            self.extract_data(data)
            if self.name is None:
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
        """
        Generic extraction of x, y, mode, and name from various simple data types.

        Args:
            data: source to extract from; supports objects with x/y attributes, dicts with x/y keys, a list of (x, y) point tuples, a pandas DataFrame/Series, or None
        """

        def get_value(data, key):
            if isinstance(data, dict):
                return data.get(key)
            return getattr(data, key, None)


        self.name = get_value(data, "name")
        self.mode = get_value(data, "mode")
        self.marker = get_value(data, "marker")
        self.line = get_value(data, "line")
        self.units_x = get_value(data, "units_x")
        self.units_y = get_value(data, "units_y")

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

    def _as_float_if_needed(self, values):
        if isinstance(values, (int, float)):
            return values
        return values.astype(float, copy=False)


    def normalize_x(self, x_values):
        """
        Applies the normalization to the values in-place
        if the normalization would change something.
        """
        if self.shift_x_to_0 != 0 or self.unit_x_conversion_factor != 1:
            x_values = self._as_float_if_needed(x_values)
            if self.shift_x_to_0 != 0:
                x_values += self.shift_x_to_0
            if self.unit_x_conversion_factor != 1:
                x_values *= self.unit_x_conversion_factor
        return x_values

    def normalize_y(self, y_values):
        """
        Applies the normalization to the values in-place
        if the normalization would change something.
        """
        if (
            self.y_normalization_method
            or self.unit_y_conversion_factor != 1
            or self.y_offset != 0
        ):
            y_values = self._as_float_if_needed(y_values)
            if self.y_normalization_method:
                y_values = self.y_normalization_method(y_values)
            elif self.unit_y_conversion_factor != 1:
                y_values *= self.unit_y_conversion_factor
            if self.y_offset != 0:
                y_values += self.y_offset
        return y_values

    def un_normalize_x(self, x_values):
        """
        Un normalizes the values in-place
        if the normalization would change something.
        """
        if self.unit_x_conversion_factor != 1 or self.shift_x_to_0 != 0:
            x_values = self._as_float_if_needed(x_values)

            if self.unit_x_conversion_factor != 1:
                x_values /= self.unit_x_conversion_factor
            if self.shift_x_to_0 != 0:
                x_values -= self.shift_x_to_0
        return x_values

    def get_normalized_x_y_values(self, min_max_lttb_downsampler, x_range, max_points):
        """
        1. Filters the values corresponding to the x_range,
        2. Then downsamples them to the max_points limit
        3. Applies the normalization to the remaining values
        """
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

        return x_values, y_values

    def to_dict(self, min_max_lttb_downsampler, max_points, common_units_x_label=None, common_units_y_label=None):
        """
        Converts the object into a json serializable dict storing all important information to plot it
        """
        data_dict = {
            'name': self.name,
            'mode': self.mode,
            'minX': self.minX,
            'minY': self.minY,
            'maxX': self.maxX,
            'maxY': self.maxY,
            'use_name_as_ticklabels': self.use_name_as_ticklabels
        }
        if self.marker is not None:
            data_dict['marker'] = self.marker
        if self.line is not None:
            data_dict['line'] = self.line
        if self.units_x is not None:
            data_dict['units_x'] = self.OutputUtils.convert_unit_to_label(self.units_x) if common_units_x_label is None else common_units_x_label
        if self.units_y is not None:
            data_dict['units_y'] = self.OutputUtils.convert_unit_to_label(self.units_y) if common_units_y_label is None else common_units_y_label

        x_values, y_values = self.get_normalized_x_y_values(min_max_lttb_downsampler, None, max_points)
        data_dict['temp'] = {
            'x': x_values.tolist(),
            'y': y_values.tolist()
        }

        return data_dict

class PlotlyGraphDataList:
    from .utils import OutputUtils

    def __init__(self, data, name_fallback='Trace'):
        self.datas = []
        self.extract_data(data, name_fallback)

    def extract_data(self, data, name_fallback):
        """
        Builds self.data_list of PlotlyGraphDataType traces from data, whether it's a single trace or a list of traces.

        Args:
            data: None, a single trace (points, dict, object, etc.), or a list of such traces
            name_fallback: name (or callable producing a name) used for traces that don't already have one
        """
        if data is None:
            self.datas = []
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
        self.datas += plotlyGraphDataList.datas

class PlotlyGraphAnnotation:
    def __init__(self, xs, texts, unit, durations=None):
        self.xs = xs
        self.texts = texts
        self.unit = unit
        self.durations = durations
        self.unit_x_conversion_factor = 1

class PlotlyGraphDataBundle:
    """
    A object that bundles the data of traces and annotations and
    has the ability to normalize them together regarding aspects units.
    """

    MAX_POINTS = 100000

    import numpy as np
    from .utils import OutputUtils
    from tsdownsample import MinMaxLTTBDownsampler

    def __init__(self, data_list, annotation_list=None):
        self.last_full_sampled_x_range = None
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
        return len(self.data_list.datas) == 0

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
        self.nGraphs = 0
        self.is_default_zero_based = True
        self.is_default_normalized_y = True

    def _filter_empty_and_normalize_complex(self):
        """
        Filters out empty traces and traces without the same amount of x and y values.
        Handles Complex, inf and nan values properly.
        Ensures x values are ordered (ASC).
        """
        if not self.is_data_empty:
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
            self.data_list.datas = filtered
            
        if not self.is_annotation_empty:
            self.annotation_list = [annotation for annotation in self.annotation_list if annotation.xs.size > 0]

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
                unit = getattr(data, units_string)
                if unit is not None:
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
            if np.all(np.abs(y_values) <= 1e-6):
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
        self._min_max_lttb_downsampler = self.MinMaxLTTBDownsampler()
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

    def get_normalized_annotations(self, x_range, max_annotations=100):
        """
        1. Filters out all off the annotations outside the x_range
        2. Groups annotations with same x and duration
        3. Groups annotations until there are no more groups than max_annotations
        (Grouping concatenates the names until there are to many than it just says (+X more))
        """
        if self.is_annotation_empty:
            return None
        if x_range is not None:
            minX, maxX = x_range
            if self.last_full_sampled_x_range is not None:
                last_minX, last_maxX = self.last_full_sampled_x_range
                if last_minX <= minX <= maxX <= last_maxX:
                    return None
                self.last_full_sampled_x_range = None
        np = self.np
        js = []
        for annotation in self.annotation_list:
            xs = annotation.xs
            if x_range is not None:
                unnormalized_minX = x_range[0] / annotation.unit_x_conversion_factor
                unnormalized_maxX = x_range[1] / annotation.unit_x_conversion_factor
                j0 = np.searchsorted(xs, unnormalized_minX, side="left")
                j1 = np.searchsorted(xs+annotation.durations if annotation.durations is not None else xs, unnormalized_maxX, side="right")
                js.append((j0, j1))
            else:
                js.append((0, len(xs)))

        def normalize_xs(xs, unit_x_conversion_factor):
            if unit_x_conversion_factor != 1:
                return xs * unit_x_conversion_factor
            return xs
        
        xs = np.concatenate([
            normalize_xs(
                annotation.xs[j0:j1],
                annotation.unit_x_conversion_factor
            )
            for annotation, (j0, j1) in zip(self.annotation_list, js)
        ])

        texts = np.concatenate([
            annotation.texts[j0:j1]
            for annotation, (j0, j1) in zip(self.annotation_list, js)
        ])

        durations = np.concatenate([
            normalize_xs(
                annotation.durations[j0:j1],
                annotation.unit_x_conversion_factor
            )
            if annotation.durations is not None
            else np.zeros(j1 - j0)
            for annotation, (j0, j1) in zip(self.annotation_list, js)
        ])

        n = xs.size
        if n == 0:
            return None

        max_texts_joined = 5

        order = np.argsort(xs)
        xs = xs[order]
        texts = texts[order]
        durations = durations[order]


        def format_text(group_texts):
            if len(group_texts) > max_texts_joined:
                return (
                    "<br>".join(group_texts[:max_texts_joined])
                    + f"<br>...<br>(+{len(group_texts) - max_texts_joined} more)"
                )
            return "<br>".join(group_texts)


        # First group annotations with the same x and duration.
        groups = []

        start = 0
        for i in range(1, n + 1):
            same_annotation = (
                i < n
                and np.isclose(xs[i], xs[start], rtol=1e-9, atol=1e-12)
                and np.isclose(durations[i], durations[start], rtol=1e-9, atol=1e-12)
            )

            if not same_annotation:
                groups.append({
                    "x": xs[start],
                    "duration": durations[start],
                    "texts": texts[start:i],
                })
                start = i

        n = len(groups)

        # If there are still too many groups, combine them by x.
        if n > max_annotations:
            group_xs = np.asarray([group["x"] for group in groups])
            gaps = np.diff(group_xs)

            separators = np.argpartition(
                gaps,
                -(max_annotations - 1)
            )[-(max_annotations - 1):]
            separators.sort()

            ranges = []
            start = 0

            for sep in separators:
                ranges.append((start, sep + 1))
                start = sep + 1

            ranges.append((start, n))

            new_groups = []

            for start, end in ranges:
                merged = groups[start:end]

                left = merged[0]["x"]
                right = max(
                    group["x"] + group["duration"]
                    for group in merged
                )

                new_groups.append({
                    "x": left,
                    "duration": right - left,
                    "texts": np.concatenate([
                        group["texts"]
                        for group in merged
                    ]),
                })

            groups = new_groups
            n = len(groups)
        else:
            self.last_full_sampled_x_range = x_range

        # Convert groups to the final arrays.
        xs = np.asarray([group["x"] for group in groups])
        durations = np.asarray([group["duration"] for group in groups])
        texts = np.asarray([
            format_text(group["texts"])
            for group in groups
        ], dtype=object)

        return {
            'xs': xs,
            'texts':  texts,
            'durations': durations,
        }

    def get_normalized_data_for_x_range(self, x_range):
        """
        Returns the normalized data for for that x_range that actually can change with a different x_range
        """
        max_points_per_data = 0 if self.is_data_empty else int(PlotlyGraphDataBundle.MAX_POINTS / len(self.datas)) 

        x_y_values_list = [
            {'index': i, 'temp': { 'x': d[0].tolist(), 'y': d[1].tolist() }}
            for i, data in enumerate(self.datas)
            if (d := data.get_normalized_x_y_values(self._min_max_lttb_downsampler, x_range, max_points_per_data))
        ]
        annotation_list = self.get_normalized_annotations(x_range=x_range)
        return {
            'x_y_values_list': x_y_values_list,
            'x_y_values_list_changed': len(x_y_values_list) > 0,
            'annotation_list': annotation_list,
            'annotation_list_changed': annotation_list is not None
        }

    def to_dict(self):
        """
        Converts the object into a json serializable dict storing all important information to plot it
        """
        max_points_per_data = 0 if self.is_data_empty else int(PlotlyGraphDataBundle.MAX_POINTS / len(self.datas)) 

        data_bundle_dict = {
            "compress": self.compress,
            "nGraphs": self.nGraphs,
            "minX": self.minX,
            "minY": self.minY,
            "maxX": self.maxX,
            "maxY": self.maxY,
        }
        common_units_x_label = None
        common_units_y_label = None
        if self.common_units_x is not None:
            common_units_x_label = self.OutputUtils.convert_unit_to_label(self.common_units_x)
            data_bundle_dict['common_units_x'] = common_units_x_label
        if self.common_units_y is not None:
            common_units_y_label = self.OutputUtils.convert_unit_to_label(self.common_units_y)
            data_bundle_dict['common_units_y'] = common_units_y_label
        plotly_graph_data_list = [
            { **data.to_dict(self._min_max_lttb_downsampler, max_points_per_data, common_units_x_label, common_units_y_label), "index": i }
            for i, data in enumerate(self.datas)
        ]
        data_bundle_dict.update({
            'plotly_graph_data_list': plotly_graph_data_list,
            'annotation_list': self.get_normalized_annotations(x_range=None),
        })
        return data_bundle_dict