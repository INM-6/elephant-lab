class PlotlyUtils:
    import quantities as pq
    import numpy as np
    import sys

    @staticmethod
    def can_convert_units(unit, convert_unit):
        """
        Returns 0 if no conversion is needed
        Returns -1 if it is not possible to convert
        Returns 1 if it can be converted
        """
        if unit == convert_unit:
            return 0
        if unit.simplified.dimensionality != convert_unit.simplified.dimensionality:
            return -1
        return 1
        
    @staticmethod
    def convert_to_other_units(val, unit, convert_unit):
        q = PlotlyUtils.pq.Quantity(val, unit)
        return q.rescale(convert_unit).magnitude
    
    @staticmethod
    def format_with_auto_digits(values):
        """
        Fully vectorized formatting of values with automatic per-value decimal digits.
        Handles zeros, NaN, and inf without warnings.
        """
        np = PlotlyUtils.np
        abs_xs = np.abs(values)

        # Replace zeros, NaN, and inf with 1 for log10
        safe_xs = np.where(np.isfinite(abs_xs) & (abs_xs != 0), abs_xs, 1.0)

        # Compute digits, clip to [0,6]
        digits = np.clip(2 - np.floor(np.log10(safe_xs)), 0, 6).astype(int)

        # NaN/inf get 0 digits
        digits[~np.isfinite(abs_xs)] = 0

        # Cast digits and values to Python types for np.char.mod
        digits_py = digits.astype(int).tolist()
        values_py = values.astype(float).tolist()

        # Use np.char.mod with Python ints
        formatted = np.array([
            f"{v:.{d}f}" if np.isfinite(v) else ("nan" if np.isnan(v) else "inf")
            for v, d in zip(values_py, digits_py)
        ])

        return formatted
    
    @staticmethod
    def print_warning(message):
        pass
        #print(f"WARNING: {message}", file=PlotlyUtils.sys.stderr)

class PlotlyGraphDataType:

    def __init__(self, data, name_fallback='Trace', **kwargs):
        if data is None:
            self.x = [0]
            self.y = [0]
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
            PlotlyUtils.print_warning(f"Error extracting data for trace '{self.name}': {e}")
            self.x, self.y = None, None

class PlotlyGraphDataTypeList():
    import numpy as np

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
                    PlotlyUtils.print_warning(f"Failed to convert data to PlotlyGraphDataType: {e}")
        else:
            try:
                if not isinstance(data, PlotlyGraphDataType):
                    data = PlotlyGraphDataType(data, name_fallback)
                self.data_list = [data]
            except Exception as e:
                PlotlyUtils.print_warning(f"Failed to convert data to PlotlyGraphDataType: {e}")

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

    def lttb_downsample(self,x, y, threshold):
        threshold = int(threshold)
        n = len(x)
        if threshold >= n or threshold == 0:
            return x, y

        sampled_x = self.np.empty(threshold)
        sampled_y = self.np.empty(threshold)

        # always keep first point
        sampled_x[0] = x[0]
        sampled_y[0] = y[0]

        bucket_size = (n - 2) / (threshold - 2)

        a = 0  # index of previously selected point

        for i in range(1, threshold - 1):

            start = int(self.np.floor((i - 1) * bucket_size)) + 1
            end   = int(self.np.floor(i * bucket_size)) + 1

            next_start = end
            next_end   = int(self.np.floor((i + 1) * bucket_size)) + 1
            next_end   = min(next_end, n)

            # average point of next bucket
            avg_x = self.np.mean(x[next_start:next_end])
            avg_y = self.np.mean(y[next_start:next_end])

            bx = x[start:end]
            by = y[start:end]

            ax = x[a]
            ay = y[a]

            # triangle area calculation (vectorized)
            area = self.np.abs(
                (ax - avg_x) * (by - ay) -
                (ax - bx)    * (avg_y - ay)
            )

            idx = self.np.argmax(area)
            a = start + idx

            sampled_x[i] = x[a]
            sampled_y[i] = y[a]

        # keep last point
        sampled_x[-1] = x[-1]
        sampled_y[-1] = y[-1]

        return sampled_x, sampled_y
    
    def normalize(self, x_range, offset_traces_on_compress, shift_to_0, max_points):
        """
        Tries to normalize units to first unit found
        Shifts all graphs to 0 if shift_to_0 is True and minX is not already close to 0
        Filters out all points outside of x_range if x_range is not None
        Decreases number of points if there are to many
        sets: common_units_x, common_units_y(They are None if no common units for x or y could be found), is_downscaled, minX, minY, maxX, maxY, is_default_zero_based, nGraphs, compress, is_empty
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
        if(self.is_empty):
            return
        self.is_empty = True

        nPoints = 0
        first = True
        common_units_x = None
        filtered = []
        is_default_zero_based = True
        for data in self.data_list:
            units_x = None
            units_y = None
            x_values = self.np.asarray(data.x)
            y_values = self.np.asarray(data.y)

            # Check if x and y are valid
            x_length = len(x_values)
            y_length = len(y_values)
            if data.x is None or data.y is None or x_length == 0 or y_length == 0 or x_length != y_length:
                PlotlyUtils.print_warning(f"Skipping trace '{data.name}' because x or y data is missing or empty or not the same length.")
                continue

            if first:
                #Set common_units
                if hasattr(data, "units_x"):
                    units_x = data.units_x
                    common_units_x = units_x
                first = False
            else:
                #Try to convert to common_units
                if common_units_x is not None and hasattr(data, "units_x"):
                    units_x = data.units_x
                    can_convert = PlotlyUtils.can_convert_units(units_x, common_units_x)
                    if can_convert == -1:
                        common_units_x = None
                    elif can_convert == 1:
                        x_values= PlotlyUtils.convert_to_other_units(x_values, units_x, common_units_x)
                        units_x = common_units_x
                else:
                    common_units_x = None

            minX = x_values.min()
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
                PlotlyUtils.print_warning(f"Skipping trace '{data.name}' because there is no data after filtering by x_range.")
                continue
            filtered.append(data)

            #Sum up number of points
            nPoints += x_length

            data.units_x = units_x
            data.x = x_values
            data.y = y_values

        self.is_default_zero_based = is_default_zero_based
        if len(filtered) == 0:
            PlotlyUtils.print_warning("No valid data to display after normalization and filtering.")
            self.data_list = [PlotlyGraphDataType(None)]
            return
        self.is_empty = False
        self.data_list = filtered
        self.common_units_x = common_units_x

        self.nGraphs = len(self.data_list)
        self.compress = self.nGraphs > 10
        if nPoints > max_points:
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
        for index, data in enumerate(self.data_list):
            x_values = data.x
            y_values = data.y

            if self.is_downscaled:
                x_values, y_values = self.lttb_downsample(x_values, y_values, max_points_per_graph)

            if index == 0:
                if hasattr(data, "units_y"):
                    units_y = data.units_y
                    common_units_y = units_y
            else:
                if common_units_y is not None and hasattr(data, "units_y"):
                    units_y = data.units_y
                    can_convert = PlotlyUtils.can_convert_units(units_y, common_units_y)
                    if can_convert == -1:
                        common_units_y = None
                    elif can_convert == 1:
                        y_values= PlotlyUtils.convert_to_other_units(y_values, units_y, common_units_y)
                        units_y = common_units_y
                else:
                    common_units_y = None

            should_find_new_minX = x_range is not None
            if index == 0:
                if should_find_new_minX:
                    minX = x_values.min()
                else:
                    minX = data.minX
                minY = y_values.min()
                maxX = x_values.max()
                maxY = y_values.max()
                previous_maxY = maxY
            else:
                temp_minX = x_values.min() if should_find_new_minX else data.minX
                temp_minY = y_values.min()
                temp_maxX = x_values.max()
                temp_maxY = y_values.max()

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