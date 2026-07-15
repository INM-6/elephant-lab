class PlotlyGraphDataType:

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

class PlotlyGraphDataTypeList():
    import numpy as np
    from .utils import OutputUtils

    def __init__(self, data, name_fallback='Trace'):
        self.data_list = []
        self.is_empty = False
        self.extract_data(data, name_fallback)

    def extract_data(self, data, name_fallback):
        if data is None:
            self.is_empty = True
            self.data_list = [PlotlyGraphDataType(None, name_fallback)]
        elif isinstance(data, list) and self.is_trace_list(data):
            for d in data:
                try:
                    if not isinstance(d, PlotlyGraphDataType):
                        d = PlotlyGraphDataType(d, name_fallback)
                    self.data_list.append(d)
                except Exception as e:
                    self.OutputUtils.print_warning(f"Failed to convert data to PlotlyGraphDataType: {e}")
        else:
            try:
                if not isinstance(data, PlotlyGraphDataType):
                    data = PlotlyGraphDataType(data, name_fallback)
                self.data_list = [data]
            except Exception as e:
                self.OutputUtils.print_warning(f"Failed to convert data to PlotlyGraphDataType: {e}")

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
        if any(isinstance(el, PlotlyGraphDataType) for el in data_list):
            return True
        
        # If any element is a dict with x/y or has x/y attributes, treat as multiple traces
        if any((hasattr(el, 'x') and hasattr(el, 'y')) or
            (isinstance(el, dict) and 'x' in el and 'y' in el) for el in data_list):
            return True
        
        # Otherwise, treat it as a single trace (list of points)
        return False
    
    def concat(self, plotlyGraphDataTypeList):
        self.is_empty = self.is_empty and plotlyGraphDataTypeList.is_empty
        self.data_list += plotlyGraphDataTypeList.data_list
    
    def normalize(self, x_range, offset_traces_on_compress, shift_to_0, max_points, normalize_y_values, normalization_method):
        """
        Tries to normalize units to first unit found
        Shifts all graphs to 0 if shift_to_0 is True and minX is not already close to 0
        Filters out all points outside of x_range if x_range is not None
        Decreases number of points if there are to many
        sets: common_units_x, common_units_y(They are None if no common units for x or y could be found), is_downscaled, minX, minY, maxX, maxY, is_default_zero_based, nGraphs, compress, is_empty, is_default_normalized_y
        """
        #set default
        self.common_units_x = None
        self.common_units_y = None
        self.minX = 0
        self.minY = 0
        self.maxX = 0
        self.maxY = 0
        self.is_downscaled = False
        self.compress = False
        self.nGraphs = 1
        self.is_default_zero_based = True
        self.is_default_normalized_y = True
        if(self.is_empty):
            return
        self.is_empty = True

        nPoints = 0
        first = True
        common_units_x = None
        filtered = []
        is_default_zero_based = True
        i = 0
        data_list_length = len(self.data_list)
        while i < data_list_length:
            data = self.data_list[i]
            units_x = None
            units_y = None
            x_values = self.np.asarray(data.x)
            y_values = self.np.asarray(data.y)

            if self.np.iscomplexobj(x_values):
                data.x = self.np.abs(x_values)
            if self.np.iscomplexobj(y_values):
                name = data.name
                data.y = self.np.imag(y_values)
                data.name = f"{name} (imag)"
                self.data_list.insert(i+1, PlotlyGraphDataType(data))
                data_list_length += 1
                y_values = self.np.real(y_values)
                data.y = y_values
                data.name = f"{name} (real)"
            i+=1
            x_values[self.np.isinf(x_values)] = self.np.nan
            y_values[self.np.isinf(y_values)] = self.np.nan

            # Check if x and y are valid
            x_length = len(x_values)
            y_length = len(y_values)
            if data.x is None or data.y is None or x_length == 0 or y_length == 0 or x_length != y_length:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing or empty or not the same length.")
                continue

            if first:
                #Set common_units
                if hasattr(data, "units_x"):
                    units_x = data.units_x
                    common_units_x = units_x
                else:
                    common_units_x = None
                first = False
            else:
                #Try to convert to common_units
                if common_units_x is not None and hasattr(data, "units_x"):
                    units_x = data.units_x
                    can_convert = self.OutputUtils.can_convert_units(units_x, common_units_x)
                    if can_convert == -1:
                        common_units_x = None
                    elif can_convert == 1:
                        x_values= self.OutputUtils.convert_to_other_units(x_values, units_x, common_units_x)
                        units_x = common_units_x
                else:
                    common_units_x = None

            minX = self.np.nanmin(x_values)
            if minX > 1e-9 or minX < -1e-9:
                is_default_zero_based = False
                if shift_to_0:
                    x_values = x_values - minX
                    minX = 0
            data.minX = minX

            #Filter out of x_range
            if x_range is not None:
                x0, x1 = x_range
                mask = (x_values >= x0) & (x_values <= x1)
                x_values = x_values[mask]
                y_values = y_values[mask]

            x_length = len(x_values)
            if x_length == 0:
                self.OutputUtils.print_warning(f"Skipping trace '{data.name}' because there is no data after filtering by x_range.")
                continue
            filtered.append(data)

            #Sum up number of points
            nPoints += x_length

            data.units_x = units_x
            data.x = x_values
            data.y = y_values

        self.is_default_zero_based = is_default_zero_based
        if len(filtered) == 0:
            self.OutputUtils.print_warning("No valid data to display after normalization and filtering.")
            self.data_list = [PlotlyGraphDataType(None)]
            return
        self.is_empty = False
        self.data_list = filtered
        self.common_units_x = common_units_x

        self.nGraphs = len(self.data_list)
        self.compress = self.nGraphs > 10
        if nPoints > max_points and max_points != -1:
            self.is_downscaled = True
            max_points_per_graph = max_points / self.nGraphs
        else:
            self.is_downscaled = False
        
        common_units_y = None
        minX = None
        minY = None
        maxX = None
        maxY = None
        previous_maxY = None
        is_default_normalized_y = True
        for index, data in enumerate(self.data_list):
            x_values = data.x
            y_values = data.y

            if self.is_downscaled:
                x_values, y_values = self.OutputUtils.lttb_downsample(x_values, y_values, max_points_per_graph)

            if index == 0:
                if hasattr(data, "units_y"):
                    units_y = data.units_y
                    common_units_y = units_y
                else:
                    common_units_y = None
            else:
                if common_units_y is not None and hasattr(data, "units_y"):
                    units_y = data.units_y
                    can_convert = self.OutputUtils.can_convert_units(units_y, common_units_y)
                    if can_convert == -1:
                        common_units_y = None
                    elif can_convert == 1:
                        y_values= self.OutputUtils.convert_to_other_units(y_values, units_y, common_units_y)
                        units_y = common_units_y
                else:
                    common_units_y = None

            # Only normalize if requested
            y_values, is_data_default_normalized_y = self.OutputUtils.normalize(
                y_values, method=normalization_method, do_normalize=normalize_y_values
            )

            if not is_data_default_normalized_y:
                is_default_normalized_y = False

            should_find_new_minX = x_range is not None
            if index == 0:
                if should_find_new_minX:
                    minX = self.np.nanmin(x_values)
                else:
                    minX = data.minX
                minY = self.np.nanmin(y_values)
                maxX = self.np.nanmax(x_values)
                maxY = self.np.nanmax(y_values)
                data.minX = minX
                data.minY = minY
                data.maxX = maxX
                data.maxY = maxY
                previous_maxY = maxY
            else:
                temp_minX = self.np.nanmin(x_values) if should_find_new_minX else data.minX
                temp_minY = self.np.nanmin(y_values)
                temp_maxX = self.np.nanmax(x_values)
                temp_maxY = self.np.nanmax(y_values)

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
                if should_find_new_minX or not shift_to_0:
                    if temp_minX < minX:
                        minX = temp_minX
                if temp_minY < minY:
                    minY = temp_minY
                if temp_maxX > maxX:
                    maxX = temp_maxX
                if temp_maxY > maxY:
                    maxY = temp_maxY
            data.units_y = units_y
            data.x = x_values
            data.y = y_values
        if shift_to_0 and x_range is None:
            minX = 0
        self.common_units_y = common_units_y
        self.minX = minX
        self.minY = minY
        self.maxX = maxX
        self.maxY = maxY
        self.is_default_normalized_y = is_default_normalized_y

class PlotlyGraphAnnotations():
    def __init__(self, x, text, unit_indice, units):
        self.x = x
        self.text = text
        self.unit_indice = unit_indice
        self.units = units

class PlotlyGraphAnnotationIntervals():
    def __init__(self, x0, x1, text, unit_indice, units):
        self.x0 = x0
        self.x1 = x1
        self.text = text
        self.unit_indice = unit_indice
        self.units = units