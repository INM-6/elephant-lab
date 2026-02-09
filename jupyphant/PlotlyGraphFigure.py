import plotly.graph_objects as go
from plotly.subplots import make_subplots
from IPython.display import display
import warnings
import quantities as pq
import numpy as np

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
    
def convert_to_other_units(val, unit, convert_unit):
    q = pq.Quantity(val, unit)
    return q.rescale(convert_unit).magnitude

class PlotlyGraphFigure:
    def __init__(self, data, shared_xaxes=True, overlapping=False, title=None, relayout_button_options=None, theme_name="plotly_dark", annotation_data=None, annotation_interavals_data=None, overlap_on_compress=True, x_range=None, shift_to_0=True):
        """
        Creates a Plotly figure and adds traces from the provided data.
        Data can be a single trace, a list of traces, or nested lists of traces.
        If many traces are created, it gets compressed, so it still works efficient and is visually pleasing
        """
        self.vertical_spacing = 0.075
        self.default_height = 600
        self.layout_options = dict()

        self.shared_xaxes = shared_xaxes or overlapping
        self.overlapping = overlapping
        self.overlap_on_compress = overlap_on_compress
        self.annotation_data = annotation_data
        self.annotation_interavals_data = annotation_interavals_data

        if not isinstance(data, PlotlyGraphDataTypeList):
            data = PlotlyGraphDataTypeList(data)
        self.nGraphs = len(data.data_list)
        self.compress = self.nGraphs > 10
        data.normalize(x_range=x_range,offset_traces=self.compress and (not overlapping or not self.overlap_on_compress), shift_to_0=shift_to_0)
        self.data = data


        self.height = self.default_height
        if self.nGraphs > 2:
            self.height = 800
        self.traces = []
        if self.compress:
            self.fig = go.FigureWidget(go.Figure())
            self.ticktext=[]
        else:
            self.fig = go.FigureWidget(make_subplots(
                rows=self.nGraphs,
                cols=1,
                vertical_spacing=self.vertical_spacing,
                shared_xaxes=self.shared_xaxes
            ))
        self.create_graphs()

        if title is None:
            title=getattr(data, 'name', None)


        self.layout_options["title"] = title
        self.layout_options["dragmode"] = "pan"
        self.layout_options["height"] = self.height
        self.layout_options["autosize"] = True

        self.update_jupyterlab_theme(theme_name)

        self.manage_axis_units()
        self.overlapping = False
        if overlapping:
            self.overlap()

        if self.compress:
            if len(self.ticktext)==self.nGraphs:
                yaxis_options = dict(
                    showticklabels=False,
                    tickvals=list(range(self.nGraphs)),
                    ticktext=self.ticktext,
                )
                self.update_layout_options_dict("yaxis", yaxis_options)
            self.hide_legend = True
        self.update_legend()
        self.create_sliders()
        self.create_annotations()
        self.create_anntotation_intervals()
        self.format_annotations()
        self.update_layout()
        #self.create_xrange_buttons(relayout_button_options)

    def update_layout_options_dict(self, key, options_dict):
        if key in self.layout_options:
            self.layout_options[key].update(options_dict)
        else:
            self.layout_options[key] = options_dict

    def update_layout_options_list(self, key, options_list):
        if key in self.layout_options:
            self.layout_options[key].extend(options_list)
        else:
            self.layout_options[key] = options_list

    def update_layout(self):
        """
        Updates all collected changes to layout in one update to improve performance
        """
        self.fig.update_layout(**self.layout_options)
        self.layout_options = dict()

    def create_graphs(self):
        """
        Recursively adds traces to a Plotly figure from various data types.
        Supports PlotlyDataType, lists of traces, dicts, pandas objects, or lists of points.
        """
        for d in self.data.data_list:
            # Check if x and y are valid
            if d.x is None or d.y is None or len(d.x) == 0 or len(d.y) == 0:
                warnings.warn(f"Skipping trace '{d.name}' because x or y data is missing or empty.")
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
                marker_settings = default_marker | getattr(d, "marker", {})
                line_settings   = default_line   | getattr(d, "line", {})
                if callable(marker_settings["size"]):
                    marker_settings["size"] = marker_settings["size"](self.getSubplotHeight())
                
                row = len(self.traces) + 1
                
                trace  = go.Scattergl(
                    x=d.x,
                    y=d.y,
                    name=getattr(d, 'name', 'Trace'),
                    mode=getattr(d, "mode", "markers"),
                    marker=marker_settings,
                    line=line_settings
                )
                self.traces.append((trace, row))

                if self.compress:
                    self.fig.add_trace(trace)
                    if hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
                            self.ticktext.append(d.name)
                else:      
                    self.fig.add_trace(
                            trace, 
                            row=row,
                            col=1
                        )
                    if d.units_x is not None:
                        self.fig.layout[f"xaxis{row}"].update(title=d.units_x.__str__())
                    if d.units_y is not None:
                        self.fig.layout[f"yaxis{row}"].update(title=d.units_y.__str__())
                    if hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
                            self.fig.layout[f"yaxis{row}"].update(
                                tickvals=[0],
                                ticktext=[d.name]
                            )
                            if hasattr(self, 'hide_legend'):
                                if self.hide_legend:
                                    if not d.use_name_as_ticklabels:
                                        self.hide_legend = False
                            else:
                                self.hide_legend = d.use_name_as_ticklabels
            except Exception as e:
                warnings.warn(f"Failed to add trace '{d.name}': {e}")
    
    def change_height_after_render(self, height):
        """
        Changing height after the figure has already, is more complicated than just calling update_layout
        """
        if self.fig.layout.height == height:
            return
        
        self.fig.update_layout(
            height = height,
            autosize = True
        )
        self.fig._send_relayout_msg({"autosize": True})
        self.update_y_slider()
    
    def overlap(self):
        """Overlapps the graphs (needs shared x-axes)"""
        if self.overlapping or not self.shared_xaxes or self.compress:
            return
        self.overlapping = True

        for i in range(1, self.nGraphs + 1):
            self.update_layout_options_dict(f"yaxis{i}", dict(
                visible=self.data.common_units_y is not None and i==1,
                domain=[0.0,1.0]
            ))

        self.change_height_after_render(self.default_height)
        self.update_legend()
        self.update_layout()
        
        
    def stack(self):
        """Stacks the graphs"""
        if not self.overlapping or self.compress:
            return
        self.overlapping = False

        n = self.nGraphs
        vertical_spacing = self.vertical_spacing

        subplot_height = self.getSubplotHeight(1.0)

        for i in range(1, n + 1):
            # Domain goes from bottom to top
            end = 1 - (i - 1) * (subplot_height + vertical_spacing)
            start = end - subplot_height
            if(start<0): start=0 #floating point precision issue

            self.update_layout_options_dict(f"yaxis{i}", 
                dict(
                    visible=True,
                    domain=[start, end]
                )
            )

        self.change_height_after_render(self.height)
        self.update_legend()
        self.update_layout()

    def create_sliders(self):
        """Updates the range slider to the last x-axis if shared_xaxes is True"""
        n = self.nGraphs
        x_bgcolor = "#1e7fcc"
        PIXELS = 25
        x_height = max(0.02, PIXELS / self.height)
        if self.compress:
            xaxis_options = dict(
                rangeslider=dict(
                    visible=True,
                    bgcolor=x_bgcolor,
                    thickness=x_height
                )
            )
            self.update_layout_options_dict("xaxis", xaxis_options)
        else:
            for i in range(1, n + 1):
                # Adding this range slider makes it impossible to manually zoom in vertically for this graph
                addX_slider = i == n and (self.shared_xaxes or self.compress)
                if addX_slider:
                    axis_key = f'xaxis{i}'
                    xaxis_options = dict(
                        rangeslider=dict(
                            visible=True,
                            bgcolor=x_bgcolor,
                            thickness=x_height
                        )
                    )
                    self.update_layout_options_dict(axis_key, xaxis_options)
        import ipywidgets as widgets

        y_slider_height = self.calculate_y_slider_height()

        totalrange = [self.data.minY, self.data.maxY]
        self.y_slider = widgets.FloatRangeSlider(
            value=totalrange,
            min=self.data.minY,
            max=self.data.maxY,
            step=0.1,
            orientation='vertical',
            continuous_update=True,
            readout=False,
            layout={'height': f'{y_slider_height}px', 'margin': '100px 0 0 0'}
        )

        def update_ticklabels(new_range):
            if self.compress and len(self.ticktext)==self.nGraphs:
                showticklabels = new_range[1]-new_range[0]<26 and (not self.overlapping or not self.overlap_on_compress)
                self.update_layout_options_dict("yaxis", dict(
                    showticklabels=showticklabels,
                    zeroline=showticklabels,
                    showgrid=showticklabels
                ))
                return True
            return False

        # Callback to update y-axis
        def update_y_range(change):
            new_range = change['new']
            # Use batch_update to avoid flickering
            with self.fig.batch_update():
                self.fig.update_yaxes(range=new_range)
            if update_ticklabels(new_range):
                self.update_layout()

        self.y_slider.observe(update_y_range, names='value')
        self.update_y_slider()
        update_ticklabels(totalrange)

    def update_legend(self):
        if self.nGraphs == 1:
            return

        if self.overlapping and not self.compress:
            if not self.fig.layout.showlegend:
                self.layout_options["showlegend"] = True
        else:
            if hasattr(self, 'hide_legend'):
                if self.hide_legend:
                    self.layout_options["showlegend"] = False
        

    def update_y_slider(self):
        """Updates the y-axis slider height and visibility."""
        if hasattr(self, "y_slider"):
            # Update existing slider
            y_slider_height = self.calculate_y_slider_height()
            if y_slider_height != int(self.y_slider.layout.height.replace('px','')):
                self.y_slider.layout.height = f'{y_slider_height}px'
            visible = 'visible' if self.overlapping or self.compress or self.nGraphs==1 else 'hidden'
            if self.y_slider.layout.visibility != visible:
                self.y_slider.layout.visibility = visible

    def calculate_y_slider_height(self):
        return int(0.875 * self.get_height() - 165)
    
    def get_height(self):
        """Returns the current height of the figure."""
        if self.overlapping:
            return self.default_height
        else:
            return self.height
    
    def create_annotations(self):
        """Updates the graph annotations."""
        if self.annotation_data is None:
            return
        
        xs = self.annotation_data.x
        texts = self.annotation_data.text
        units = self.annotation_data.units

        shapes = []
        annotations = []

        for x, text, unit in zip(xs, texts, units):
            can_convert = can_convert_units(unit=unit, convert_unit=self.data.common_units_x)
            if can_convert == -1:
                continue
            if can_convert == 1:
                x = convert_to_other_units(x, unit=unit, convert_unit=self.data.common_units_x)
            shapes.append(dict(
                type="line",
                x0=x,
                x1=x,
                y0=0,
                y1=1,
                xref="x",
                yref="paper",
                line=dict(
                    width=0.5,
                    dash="dash",
                    color="rgba(255,0,0,1)"
                )
            ))

            # Top annotation: main label
            annotations.append(dict(
                x=x,
                y=1,
                xref="x",
                yref="paper",
                text=text,
                showarrow=False,
                font=dict(size=11, color="#194D89"),
                xanchor="center",
                yanchor="bottom",
            ))

            # Bottom annotation: x value
            annotations.append(dict(
                x=x,
                y=0,
                xref="x",
                yref="paper",
                text=f"{x:.2f}",
                showarrow=False,
                font=dict(size=10, color="#666"),
                xanchor="center",
                yanchor="top"
            ))

        """
        # Convert paper y to data y for hover scatter
        y_range = [self.minY, self.maxY]

        x_trace = []
        y_trace = []
        for x in xs:
            x_trace.extend([x, x, None])  # None to break the line
            y_trace.extend([y_range[0], y_range[1], None])

        # Add invisible scatter for hover
        annotation_hovertext_trace = go.Scattergl(
            x=x_trace,
            y=y_trace,
            mode='markers',
            marker=dict(opacity=0),
            hovertemplate=f"X: %{{x}}<extra></extra>",
            showlegend=False
        )
        if self.compress:
            self.fig.add_trace(annotation_hovertext_trace)
        else:
            self.fig.add_trace(
                annotation_hovertext_trace,
                row=1,
                col=1
            )
        """

        self.update_layout_options_list("shapes", shapes)
        self.update_layout_options_list("annotations", annotations)

    def create_anntotation_intervals(self):
        """Updates the graph annotation intervals."""
        if self.annotation_interavals_data is None:
            return
        
        x0s = self.annotation_interavals_data.x0
        x1s = self.annotation_interavals_data.x1
        texts = self.annotation_interavals_data.text
        units = self.annotation_interavals_data.units

        shapes = []
        annotations = []

        for x0, x1, text, unit in zip(x0s, x1s, texts, units):
            can_convert = can_convert_units(unit=unit, convert_unit=self.data.common_units_x)
            if can_convert == -1:
                continue
            if can_convert == 1:
                x0 = convert_to_other_units(x0, unit=unit, convert_unit=self.data.common_units_x)
                x1 = convert_to_other_units(x1, unit=unit, convert_unit=self.data.common_units_x)
            shapes.append(dict(
                type="rect",
                x0=x0,
                x1=x1,
                y0=0,
                y1=1,
                xref="x",
                yref="paper",
                fillcolor="LightSalmon",
                opacity=0.15,
                line_width=0
            ))

            # Top annotation: main label
            annotations.append(dict(
                x=(x0 + x1) / 2,
                y=1,
                xref="x",
                yref="paper",
                text=text,
                showarrow=False,
                font=dict(size=11, color="#4C9ED9"),
                xanchor="center",
                yanchor="bottom"
            ))

            # Bottom annotation: x value
            annotations.append(dict(
                x=x0,
                y=0,
                xref="x",
                yref="paper",
                text=f"{x0:.2f}",
                showarrow=False,
                font=dict(size=10, color="#666"),
                xanchor="center",
                yanchor="top"
            ))
            annotations.append(dict(
                x=x1,
                y=0,
                xref="x",
                yref="paper",
                text=f"{x1:.2f}",
                showarrow=False,
                font=dict(size=10, color="#666"),
                xanchor="center",
                yanchor="top"
            ))

        self.update_layout_options_list("shapes", shapes)
        self.update_layout_options_list("annotations", annotations)

    def format_annotations(self):
        """Formats existing annotations to have consistent style."""
        if "annotations" not in self.layout_options:
            return
        all_annotations = self.layout_options["annotations"]
        # Separate annotations by y (top vs bottom)
        top_annotations = [ann for ann in all_annotations if ann.get("y", 1) > 0.5]
        bottom_annotations = [ann for ann in all_annotations if ann.get("y", 1) <= 0.5]

        # Sort each list by x coordinate
        top_annotations.sort(key=lambda ann: ann.get("x", 0))
        bottom_annotations.sort(key=lambda ann: ann.get("x", 0))

        # Parameters
        min_x_distance_percent = 0.02 # minimum horizontal distance as percent of x-axis range
        min_x_distance = (self.data.maxX - self.data.minX) * min_x_distance_percent
        y_shift = 0.0175         # vertical shift amount if overlapping
        max_y_shift = y_shift * 2.5    # maximum vertical shift

        l_bottom = len(top_annotations)
        for i in range(1, l_bottom):
            current = top_annotations[i]
            x = current.get("x", 0)
            y = current.get("y", 1)  # default top if missing
            previous = top_annotations[i - 1]
            prev_x = previous.get("x", 0)
            prev_y = previous.get("y", 1)
            if abs(x - prev_x) < min_x_distance:
                # Collision detected → shift vertically
                y = prev_y + y_shift
                if y > 1+max_y_shift:  # prevent going too far off top
                    y = 1
                current["y"] = y

        l_bottom = len(bottom_annotations)
        for i in range(1, l_bottom):
            current = bottom_annotations[i]
            x = current.get("x", 0)
            y = current.get("y", 0)  # default bottom if missing
            previous = bottom_annotations[i - 1]
            prev_x = previous.get("x", 0)
            prev_y = previous.get("y", 1)
            if abs(x - prev_x) < min_x_distance:
                # Collision detected → shift vertically
                y = prev_y - y_shift
                if y < 0-max_y_shift:  # prevent going too far off bottom
                    y = 0
                current["y"] = y

    def manage_axis_units(self):
        """If all x-axes have the same units, move it to the last axis only."""
        if self.compress:
            if self.data.common_units_x is not None:
                self.update_layout_options_dict("xaxis", dict(
                    title=self.data.common_units_x.__str__()
                ))
            if self.data.common_units_y is not None:
                self.update_layout_options_dict("yaxis", dict(
                    title=self.data.common_units_y.__str__()
                ))
        else:
            if self.data.common_units_x is not None:
                # Clear all units except the last one
                for i in range(1, self.nGraphs):
                    self.update_layout_options_dict(f"xaxis{i}", dict(title=None))

    def create_xrange_buttons(self, relayout_button_options):
        """
        Adds updatemenus buttons to the figure to quickly set x-axis range.

        Parameters
        ----------
        relayout_button_options : list of tuples or dicts, optional
            If list of tuples: [(label, fraction_of_width), ...]
            If None, default percentages are used.
        """
        if not self.shared_xaxes:
            return

        # Default percentages
        if relayout_button_options is None:
            start = self.data.minX
            width = self.data.maxX - start
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
        self.update_layout_options_dict("updatemenus", [
            dict(
                type="buttons",
                x=-0.02,
                y=1,
                showactive=False,
                buttons=buttons
            )
        ])

    def update_jupyterlab_theme(self, theme_name):
        """Updates the Plotly figure theme based on JupyterLab theme name."""
        if "dark" in theme_name.lower():
            self.fig.update_layout(template="plotly_dark")
        else:
            self.fig.update_layout(template="plotly_white")

    def display(self):
        """Displays the Plotly figure in a Jupyter notebook."""
        if self.fig:
            if hasattr(self, "y_slider"):
                from ipywidgets import HBox, Layout, Output
                output_fig = Output(layout={'width': "100%", 'height': 'auto', 'min_width': '0px'})
                with output_fig:
                    display(self.fig)
                hbox = HBox([self.y_slider, output_fig], 
                    layout=Layout(
                        width='100%',
                    ),
                )
                display(hbox)
            else:
                display(self.fig)

    def getSubplotHeight(self, height=None):
        """Returns the height of each subplot in pixels."""
        if self.nGraphs == 0:
            return 0
        if height is None:
            height = self.height
        total_gap = self.vertical_spacing * (self.nGraphs - 1)
        subplot_height = (height - total_gap) / self.nGraphs
        if self.compress:
            subplot_height = subplot_height/3.
        return subplot_height
    
    def getXRange(self):
        return self.fig.xaxis.range
class PlotlyGraphDataType:
    def __init__(self, data, **kwargs):
        self.extract_data(data)
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
            warnings.warn(f"Error extracting data for trace '{self.name}': {e}")
            self.x, self.y = None, None

class PlotlyGraphDataTypeList():
    def __init__(self, data):
        self.data_list = []
        self.extract_data(data)

    def extract_data(self, data):
        if isinstance(data, list) and self.is_trace_list(data):
            for d in data:
                try:
                    if not isinstance(d, PlotlyGraphDataType):
                        d = PlotlyGraphDataType(d)
                    self.data_list.append(d)
                except Exception as e:
                    warnings.warn(f"Failed to convert data to PlotlyGraphDataType: {e}")
        else:
            try:
                if not isinstance(d, PlotlyGraphDataType):
                    d = PlotlyGraphDataType(d)
                self.data_list = [d]
            except Exception as e:
                warnings.warn(f"Failed to convert data to PlotlyGraphDataType: {e}")

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
        self.data_list += plotlyGraphDataTypeList.data_list
    
    def normalize(self, x_range, offset_traces, shift_to_0):
        """
        Tries to normalize units to first unit found
        Filters out all points outside of x_range if x_range is not None
        Decreases number of points if there are to many
        sets: common_units_x, common_units_y(They are None if no common units for x or y could be found), is_downscaled, minX, minY, maxX, maxY
        """
        nPoints = 0
        first = True
        common_units_x = None
        for data in self.data_list:
            units_x = None
            units_y = None
            x_values = np.asarray(data.x)
            y_values = np.asarray(data.y)
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
                    can_convert = can_convert_units(units_x, common_units_x)
                    if can_convert == -1:
                        common_units_x = None
                    elif can_convert == 1:
                        x_values= convert_to_other_units(x_values, units_x, common_units_x)
                        units_x = common_units_x
                else:
                    common_units_x = None

            #Filter out of x_range
            if x_range is not None:
                x0 = x_range[0]
                x1 = x_range[1]
                mask = (x_values >= x0) & (x_values <= x1)
                x_values = x_values[mask]
                y_values = y_values[mask]

            #Sum up number of points
            nPoints += len(x_values)

            data.units_x = units_x
            data.x = x_values
            data.y = y_values

        self.common_units_x = common_units_x

        #Calculate how many points to skip
        too_many_points = 10000
        skipFactor = int(np.ceil(nPoints / too_many_points))
        skipFactor = max(skipFactor, 1)

        if skipFactor > 1:
            self.is_downscaled = True
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
                #Reduce number of points
                x_values = x_values[::skipFactor]
                y_values = y_values[::skipFactor]

            if index == 0:
                if hasattr(data, "units_y"):
                    units_y = data.units_y
                    common_units_y = units_y
            else:
                if common_units_y is not None and hasattr(data, "units_y"):
                    units_y = data.units_y
                    can_convert = can_convert_units(units_y, common_units_y)
                    if can_convert == -1:
                        common_units_y = None
                    elif can_convert == 1:
                        y_values= convert_to_other_units(y_values, units_y, common_units_y)
                        units_y = common_units_y
                else:
                    common_units_y = None

            if shift_to_0:
                x_values = x_values - x_values.min()

            if index == 0:
                if not shift_to_0:
                    minX = x_values.min()
                minY = y_values.min()
                maxX = x_values.max()
                maxY = y_values.max()
                previous_maxY = maxY
            else:
                temp_minX = 0 if shift_to_0 else x_values.min()
                temp_minY = y_values.min()
                temp_maxX = x_values.max()
                temp_maxY = y_values.max()

                if offset_traces:
                    offset = previous_maxY - temp_minY
                    span = (temp_maxY - temp_minY)
                    if span < 1e-9:
                        offset += 1
                    else:
                        gap = 0.05 * span
                        offset + gap
                    y_values = y_values + offset
                    temp_minY += offset
                    temp_maxY += offset
                    previous_maxY = temp_maxY

                if not shift_to_0:
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
        if shift_to_0:
            minX = 0
        self.common_units_y = common_units_y
        self.minX = minX
        self.minY = minY
        self.maxX = maxX
        self.maxY = maxY

class PlotlyGraphAnnotations():
    def __init__(self, x, text, units):
        self.x = x
        self.text = text
        self.units = units

class PlotlyGraphAnnotationIntervals():
    def __init__(self, x0, x1, text, units):
        self.x0 = x0
        self.x1 = x1
        self.text = text
        self.units = units