class PlotlyGraphData:

    from .utils import OutputUtils

    def __init__(self, data, name_fallback='Trace', **kwargs):
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

class NormalizedPlotlyGraphAnnotations:

    def __init__(self, xs, durations, texts):
        self.xs = xs
        self.durations = durations
        self.texts = texts

class PlotlyGraphDataBundle:

    import numpy as np
    from .utils import OutputUtils

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
        return self.annotation_list is None or (not isinstance(self.annotation_list, NormalizedPlotlyGraphAnnotations) and len(self.annotation_list) == 0)
    
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

            if x_values is None or y_values is None:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing or empty or not the same length.")
                continue

            if np.iscomplexobj(x_values):
                x_values = np.abs(x_values)
            if np.iscomplexobj(y_values):
                name = data.name
                data.name = f"{name} (imag)"
                imag_data = PlotlyGraphData(data)
                imag_data.name = f"{name} (imag)"
                imag_data.y_values = np.imag(y_values)
                self.datas.insert(i+1, imag_data)
                n_datas += 1
                y_values = np.real(y_values)
                y_values = y_values
                data.name = f"{name} (real)"
            i+=1
            x_values[np.isinf(x_values)] = np.nan
            y_values[np.isinf(y_values)] = np.nan

            # Check if x and y are valid
            x_length = len(x_values)
            y_length = len(y_values)
            if x_length == 0 or y_length == 0 or x_length != y_length:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing or empty or not the same length.")
                continue

            data.x = x_values
            data.y = y_values
            filtered.append(data)

        self.nGraphs = len(filtered)
        self.compress = self.nGraphs > 10
        self.is_data_empty == self.nGraphs == 0
        self.data_list.datas = filtered

    def _normalize_units(self, y_instead_of_x = False):
        if y_instead_of_x and self.is_data_empty:
            return
        units_string = "units_y" if y_instead_of_x else "units_x"
        values_string = "ys" if y_instead_of_x else "xs"
        common_units = self.annotation_list[0].unit if self.is_data_empty else getattr(self.datas[0], units_string, None)
        if common_units is None:
            return
        units_to_value_data = {}
        def add_to_units_to_values(unit, obj, attribute_name):
            unit_key = unit.dimensionality
            values = getattr(obj, attribute_name)
            n_values = len(values)
            if unit_key in units_to_value_data:
                units_to_value_data[unit_key][1].append((values, obj, attribute_name, n_values))
            else:
                units_to_value_data[unit_key] = (unit, [(values, obj, attribute_name, n_values)])

        if not self.is_data_empty:
            for data in self.datas:
                if hasattr(data, units_string):
                    units = getattr(data, units_string)
                    can_convert = self.OutputUtils.can_convert_units(units, common_units)
                    if can_convert == -1:
                        return
                    elif can_convert == 1:
                        add_to_units_to_values(units, data, values_string)
                else:
                    return
                
        if not y_instead_of_x and not self.is_annotation_empty:
            for annotation in self.annotation_list:
                units_x = annotation.unit
                can_convert = self.OutputUtils.can_convert_units(units_x, common_units)
                if can_convert == -1:
                    return
                elif can_convert == 1:
                    add_to_units_to_values(units_x, annotation, "xs")
                    add_to_units_to_values(units_x, annotation, "durations")

        for unit, value_datas in units_to_value_data.values():
            converted_values = self.OutputUtils.convert_to_other_units(self.np.concatenate([values for values, *_ in value_datas]), unit, common_units)
            i = 0
            for _, obj, attribute_name, n_values in value_datas:
                end_i = i + n_values
                setattr(obj, attribute_name, converted_values[i:end_i])
                i = end_i

        common_units_string = "common_units_y" if y_instead_of_x else "common_units_x"
        setattr(self, common_units_string, common_units)

    def _shift_to_0(self, shift_to_0):
        if self.is_data_empty:
            return
        is_default_zero_based = True
        for data in self.datas:
            minX = self.np.nanmin(data.x)
            if minX > 1e-9 or minX < -1e-9:
                is_default_zero_based = False
                if shift_to_0:
                    x_values = x_values - minX
                    minX = 0
            data.minX = minX
        self.is_default_zero_based = is_default_zero_based

    def _normalize_y_values(self, normalize_y_values, normalization_method):
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
                data.y = self.OutputUtils.normalize(y_values, normalization_method)
        self.is_default_normalized_y = is_default_normalized_y

    def _calc_min_max_apply_offset(self, offset_traces_on_compress):

        np = self.np

        if not self.is_data_empty:
            minX = None
            minY = None
            maxX = None
            maxY = None
            previous_maxY = None
            for index, data in enumerate(self.datas):
                x_values = data.x
                y_values = data.y

                if index == 0:
                    minX = data.minX
                    minY = np.nanmin(y_values)
                    maxX = np.nanmax(x_values)
                    maxY = np.nanmax(y_values)
                    data.minX = minX
                    data.minY = minY
                    data.maxX = maxX
                    data.maxY = maxY
                    previous_maxY = maxY
                else:
                    temp_minX = data.minX
                    temp_minY = np.nanmin(y_values)
                    temp_maxX = np.nanmax(x_values)
                    temp_maxY = np.nanmax(y_values)

                    if self.compress and offset_traces_on_compress:
                        offset = previous_maxY - temp_minY
                        span = (temp_maxY - temp_minY)
                        if span < 1e-9:
                            offset += 1
                        else:
                            gap = 0.05 * span
                            offset += gap
                        y_values = y_values + offset
                        temp_minY += offset
                        temp_maxY += offset
                        previous_maxY = temp_maxY

                    data.minX = temp_minX
                    data.minY = temp_minY
                    data.maxX = temp_maxX
                    data.maxY = temp_maxY
                    if temp_minX < minX:
                        minX = temp_minX
                    if temp_minY < minY:
                        minY = temp_minY
                    if temp_maxX > maxX:
                        maxX = temp_maxX
                    if temp_maxY > maxY:
                        maxY = temp_maxY
                data.y = y_values
            self.data_minX = minX
            self.minY = minY
            self.data_maxX = maxX
            self.maxY = maxY

        if not self.is_annotation_empty:
            self.annotation_list = NormalizedPlotlyGraphAnnotations(
                np.concatenate([annotation.xs for annotation in self.annotation_list]),
                np.concatenate([annotation.durations for annotation in self.annotation_list]),
                np.concatenate([annotation.texts for annotation in self.annotation_list])
            )
            self.annotation_minX = np.nanmin(self.annotation_list.xs)
            self.annotation_maxX = np.nanmax(self.annotation_list.xs + self.annotation_list.durations)
    
    def normalize(self, offset_traces_on_compress, shift_to_0, normalize_y_values, normalization_method):
        """
        Tries to normalize units to first unit found
        Shifts all graphs to 0 if shift_to_0 is True and minX is not already close to 0
        Decreases number of points if there are to many
        sets: common_units_x, common_units_y(They are None if no common units for x or y could be found), minX, minY, maxX, maxY, is_default_zero_based, nGraphs, compress, is_empty, is_default_normalized_y
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