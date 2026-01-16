import plotly.graph_objects as go
from plotly.subplots import make_subplots
from IPython.display import display
import warnings

class PlotlyGraphFigure:
    def __init__(self, data, overlapping=True, shared_xaxes=True, title=None, relayout_button_options=None):
        """
        Creates a Plotly figure and adds traces from the provided data.
        Data can be a single trace, a list of traces, or nested lists of traces.
        """
        self.vertical_spacing = 0.02
        self.default_height = 600
        

        self.shared_xaxes = shared_xaxes or overlapping
        self.nGraphs = len(data) if isinstance(data, list) and self.is_trace_list(data) else 1
        self.height = self.default_height
        if self.nGraphs > 2:
            self.height = 800
        self.traces = []
        self.fig = make_subplots(
            rows=self.nGraphs,
            cols=1,
            vertical_spacing=self.vertical_spacing,
            shared_xaxes=self.shared_xaxes
        )

        self.create_graphs(self.fig, data)

        if title is None:
            title=getattr(data, 'name', None)

        self.fig.update_layout(
            title=title,
            dragmode="pan",
            height=self.height,
        )
        
        self.overlapping = False
        if overlapping:
            self.overlap()

        self.update_slider()
        self.create_xrange_buttons(relayout_button_options)



    def create_graphs(self, fig, data):
        """
        Recursively adds traces to a Plotly figure from various data types.
        Supports PlotlyDataType, lists of traces, dicts, pandas objects, or lists of points.
        """
        # If data is a list of traces, recurse
        if isinstance(data, list) and self.is_trace_list(data):
            for d in data:
                self.create_graphs(fig, d)
            return

        # Wrap data if not already PlotlyDataType
        try:
            if not isinstance(data, PlotlyGraphDataType):
                data = PlotlyGraphDataType(data)
        except Exception as e:
            warnings.warn(f"Failed to convert data to PlotlyDataType: {e}")
            return  # Skip this trace

        # Check if x and y are valid
        if data.x is None or data.y is None or len(data.x) == 0 or len(data.y) == 0:
            warnings.warn(f"Skipping trace '{data.name}' because x or y data is missing or empty.")
            return

        # Choose Scatter or Scattergl based on x and y size (It does not work with go.Scatter and there is no important benefit of using it)
        """
        size_for_gl = 5000
        use_gl = len(data.x) > size_for_gl or len(data.y) > size_for_gl
        trace_type = go.Scattergl if use_gl else go.Scatter
        """

        # Add the trace
        try:
            # Default settings
            default_marker = dict(size=1)
            default_line   = dict(width=1)


            # Merge with user-provided dicts (data.marker / data.line)
            marker_settings = default_marker | getattr(data, "marker", {})
            line_settings   = default_line   | getattr(data, "line", {})
            if callable(marker_settings["size"]):
                marker_settings["size"] = marker_settings["size"](self.getSubplotHeight())
            
            trace  = go.Scattergl(
                x=data.x,
                y=data.y,
                name=getattr(data, 'name', 'Trace'),
                mode=getattr(data, "mode", "markers"),
                marker=marker_settings,
                line=line_settings
            )
            row = len(self.traces) + 1
            self.traces.append((trace, row))
            fig.add_trace(
                    trace, 
                    row=row,
                    col=1
                )
        except Exception as e:
            warnings.warn(f"Failed to add trace '{data.name}': {e}")

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
    
    def overlap(self):
        """Overlapps the graphs (needs shared x-axes)"""
        if self.overlapping or not self.shared_xaxes:
            return
        self.overlapping = True

        for i in range(1, self.nGraphs + 1):
            self.fig.layout[f"yaxis{i}"].update(
                visible=False,
                domain=[0.0,1.0]
            )

        self.fig.update_layout(
            height=self.default_height,
        )
        
        
    def stack(self):
        """Stacks the graphs"""
        if not self.overlapping:
            return
        self.overlapping = False

        n = self.nGraphs
        vertical_spacing = self.vertical_spacing

        subplot_height = self.getSubplotHeight()

        for i in range(1, n + 1):
            # Domain goes from bottom to top
            end = 1 - (i - 1) * (subplot_height + vertical_spacing)
            start = end - subplot_height
            if(start<0): start=0 #floating point precision issue

            self.fig.layout[f"yaxis{i}"].update(
                visible=True,
                domain=[start, end]
            )

        self.fig.update_layout(
            height=self.height,
        )

    def update_slider(self):
        """Updates the range slider to the last x-axis if shared_xaxes is True"""
        n = self.nGraphs
        for i in range(1, n + 1):
            self.fig.layout[f"xaxis{i}"].update(
                rangeslider=dict(visible=i==n and (self.shared_xaxes))
            )

    def create_xrange_buttons(self, relayout_button_options):
        """
        Adds updatemenus buttons to the figure to quickly set x-axis range.

        Parameters
        ----------
        relayout_button_options : list of tuples or dicts, optional
            If list of tuples: [(label, fraction_of_width), ...]
            If None, default percentages are used.
        """
        # Default percentages
        if relayout_button_options is None:
            x_vals = [x for trace, _ in self.traces for x in trace.x]
            start = min(x_vals)
            width = max(x_vals) - start
            relayout_button_options = [
                ("1%", [start, start+width*0.01]),
                ("5%", [start, start+width*0.05]),
                ("10%", [start, start+width*0.1]),
                ("20%", [start, start+width*0.2]),
                ("50%", [start, start+width*0.5]),
                ("75%", [start, start+width*0.75]),
                ("All", [start, start+width])
            ]

        # Convert to Plotly button dicts
        buttons = []
        for item in relayout_button_options:
            if isinstance(item, dict):
                # If already a dict with label/range
                buttons.append(dict(
                    label=item["label"],
                    method="relayout",
                    args=["xaxis.range", item["range"]]
                ))
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                label, rng = item
                buttons.append(dict(
                    label=label,
                    method="relayout",
                    args=["xaxis.range", rng]
                ))
            else:
                raise ValueError("Each relayout_button_option must be a dict or (label, fraction) tuple")

        # Add buttons to the figure
        self.fig.update_layout(
            updatemenus=[
                dict(
                    type="buttons",
                    x=-0.02,
                    y=1,
                    showactive=False,
                    buttons=buttons
                )
            ]
        )

    def display(self):
        """Displays the Plotly figure in a Jupyter notebook."""
        if self.fig:
            display(self.fig)

    def getSubplotHeight(self):
        """Returns the height of each subplot in pixels."""
        if self.nGraphs == 0:
            return 0
        total_gap = self.vertical_spacing * (self.nGraphs - 1)
        subplot_height = (self.height - total_gap) / self.nGraphs
        return subplot_height

class PlotlyGraphDataType:
    def __init__(self, data):
        self.extract_data(data)

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
            warnings.warn(f"Error extracting data for trace '{self.name}': {e}")
            self.x, self.y = None, None