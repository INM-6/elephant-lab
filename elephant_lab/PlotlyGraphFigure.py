class PlotlyGraphFigure:
    from .utils import OutputUtils
    from .PlotlyGraphContainer import PlotlyGraphDataBundle

    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from plotly_resampler import FigureWidgetResampler
    import numpy as np


    def __init__(self, data, overlapping=False, title=None, overlap_on_compress=True, shift_to_0=False, normalize_y_values=False,normalization_method="zscore", dark=False):
        """
        Creates a Plotly figure and adds traces from the provided data.
        Data can be a single trace, a list of traces, or nested lists of traces.
        If many traces are created, it gets compressed, so it still works efficient and is visually pleasing
        """
        self.vertical_spacing = 0.075
        self.layout_options = dict()
        self.has_custom_ticklabels = False

        self.overlapping = overlapping
        self.overlap_on_compress = overlap_on_compress

        if not isinstance(data, self.PlotlyGraphDataBundle):
            data = self.PlotlyGraphDataBundle(data)
        data.normalize(offset_traces_on_compress= not overlapping or not overlap_on_compress, shift_to_0=shift_to_0, normalize_y_values=normalize_y_values, normalization_method=normalization_method)
        self.nGraphs = data.nGraphs
        self.compress = data.compress
        self.data = data
        self.total_minY = data.minY
        self.total_maxY = data.maxY

        if self._same_y() and (self.nGraphs < 2 or self._should_overlap()):
            self.height = 200
        else:
            self.height = 800 if (self.nGraphs > 2 and not self._should_overlap()) else 600
        if self._is_single_plot():
            self.fig = self.FigureWidgetResampler(self.go.Figure())
            if self.compress:
                self.ticktext=[]
        else:
            self.fig = self.FigureWidgetResampler(PlotlyGraphFigure.make_subplots(
                rows=self.nGraphs,
                cols=1,
                vertical_spacing=self.vertical_spacing,
                shared_xaxes=True
            ))
        self._create_graphs()

        if title is None:
            title=getattr(data, 'name', None)


        self.layout_options["title"] = {
            'text': title,
            'x': 0.5,
            'xanchor': 'center'
        }
        self.layout_options["dragmode"] = "pan"
        self.layout_options["height"] = self.height
        self.layout_options["autosize"] = True
        self.layout_options["template"] = "plotly_dark" if dark else "plotly_white"

        self._manage_ticklabels()
        self._manage_legend()
        self._create_annotations()
        self._manage_axis_units()
        self._update_layout()

    def _update_layout_options_dict(self, key, options_dict):
        if key in self.layout_options:
            self.layout_options[key].update(options_dict)
        else:
            self.layout_options[key] = options_dict

    def _update_layout_options_list(self, key, options_list):
        if key in self.layout_options:
            self.layout_options[key].extend(options_list)
        else:
            self.layout_options[key] = options_list

    def _update_layout(self):
        """
        Updates all collected changes to layout in one update to improve performance
        """
        self.fig.update_layout(**self.layout_options)
        self.layout_options = dict()

    def _create_graphs(self):
        """
        Adds traces to a Plotly figure from the extracted and normalized data
        """
        for index, d in enumerate(self.data.datas):

            # Choose Scatter or Scattergl based on x and y size (It does not work with go.Scatter and there is no important benefit of using it)
            """
            size_for_gl = 5000
            use_gl = len(data.x) > size_for_gl or len(data.y) > size_for_gl
            trace_type = go.Scattergl if use_gl else go.Scatter
            """

            # Add the trace
            try:
                # Default settings
                default_marker = dict(size=6)
                default_line   = dict(width=1)


                # Merge with user-provided dicts (data.marker / data.line)
                marker_settings = default_marker | getattr(d, "marker", {})
                line_settings   = default_line   | getattr(d, "line", {})
                if callable(marker_settings["size"]):
                    marker_settings["size"] = marker_settings["size"](self._getSubplotHeight())
                
                trace  = self.go.Scattergl(
                    x=d.x,
                    y=d.y,
                    name=getattr(d, 'name', 'Trace'),
                    mode="markers" if d.x.size < 2 else getattr(d, "mode", "markers"),
                    marker=marker_settings,
                    line=line_settings
                )

                if self._is_single_plot():
                    self.fig.add_trace(trace)
                    if self._can_have_custom_ticklabels() and hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
                            if self.compress:
                                self.ticktext.append(d.name)
                            else:
                                self.has_custom_ticklabels = True
                                self._update_layout_options_dict(f"yaxis",dict(
                                    tickvals=[0],
                                    ticktext=[d.name]
                                ))
                else:
                    row = index + 1
                    self.fig.add_trace(
                            trace, 
                            row=row,
                            col=1
                        )
                    if d.units_x is not None:
                        self._update_layout_options_dict(f"xaxis{row}",dict(
                            title=self.OutputUtils.convert_unit_to_label(d.units_x)
                        ))
                    if d.units_y is not None:
                        self._update_layout_options_dict(f"yaxis{row}",dict(
                            title=self.OutputUtils.convert_unit_to_label(d.units_y)
                        ))
                    if self._can_have_custom_ticklabels() and hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
                            self.has_custom_ticklabels = True
                            self._update_layout_options_dict(f"yaxis{row}",dict(
                                tickvals=[0],
                                ticktext=[d.name]
                            ))
                            if hasattr(self, 'hide_legend'):
                                if self.hide_legend:
                                    if not d.use_name_as_ticklabels:
                                        self.hide_legend = False
                            else:
                                self.hide_legend = d.use_name_as_ticklabels
            except Exception as e:
                self.OutputUtils.print_warning(f"Failed to add trace '{d.name}': {e}")

    def _manage_legend(self):
        if self.nGraphs == 1:
            self.layout_options["showlegend"] = False
            return
        
        if self.compress:
            self.layout_options["showlegend"] = False
            return
        
        if self.overlapping:
            self.layout_options["showlegend"] = True

        if hasattr(self, 'hide_legend'):
            if self.hide_legend:
                self.layout_options["showlegend"] = False
    
    def _create_annotations(self):
        """Updates the graph annotations."""

        if not self.data.is_annotation_empty:

            np = self.np

            annotations = self.data.annotation_list
            xs = annotations.xs
            durations = annotations.durations
            texts = annotations.texts
            n = xs.size
            dynamic_divider = 4 * n
            min_divider = 500
            max_divider = 4000
            min_bar_width = (self.data.maxX - self.data.minX) / min(max_divider, max(min_divider, dynamic_divider))

            # Format values
            xs_str = self.OutputUtils.format_with_auto_digits(xs)
            start_str = self.OutputUtils.format_with_auto_digits(xs)
            end_str = self.OutputUtils.format_with_auto_digits(xs + durations)

            # Build hover text
            hover_texts = self.np.where(
                durations == 0,
                np.char.add(
                    np.char.add(texts, "<br>Time: "),
                    xs_str
                ),
                np.char.add(
                    np.char.add(
                        np.char.add(texts, "<br>Start: "),
                        start_str
                    ),
                    np.char.add("<br>End: ", end_str)
                )
            )

            def calc_new_y(ymin, ymax):
                if ymax - ymin < 1e-9:
                    ymin -= 1
                    ymax += 1
                span = ymax - ymin
                ymax += span * 0.05
                return ymin, ymax

            def create_trace(ymin, ymax):
                return self.go.Bar(
                    x=xs - durations/2,
                    width= np.where(durations==0, min_bar_width, durations),
                    y=np.full(xs.shape, ymax - ymin),
                    base=ymin,
                    hovertext=hover_texts,
                    hoverinfo='text',
                    marker_color='red',
                    opacity=0.3,
                    showlegend=False
                )
            if self._is_single_plot():
                # === Prepare trace ===
                ymin = self.total_minY
                ymax = self.total_maxY
                ymin, ymax = calc_new_y(ymin, ymax)
                self.total_minY = ymin
                self.total_maxY = ymax
                self.fig.add_trace(create_trace(ymin, ymax))
            else:
                for i in range(1, self.nGraphs + 1):
                    graph_trace_data = self.data.datas[i-1]
                    ymin = graph_trace_data.minY
                    ymax = graph_trace_data.maxY
                    ymin, ymax = calc_new_y(ymin, ymax)
                    self.fig.add_trace(
                        create_trace(ymin, ymax),
                        row=i,
                        col=1
                    )

    def _manage_axis_units(self):
        """If all x-axes have the same units, move it to the last axis only."""
        if self._is_single_plot():
            if self.data.common_units_x is not None:
                self._update_layout_options_dict("xaxis", dict(
                    title=self.OutputUtils.convert_unit_to_label(self.data.common_units_x)
                ))
            if self.data.common_units_y is not None:
                self._update_layout_options_dict("yaxis", dict(
                    title=self.OutputUtils.convert_unit_to_label(self.data.common_units_y)
                ))
        else:
            if self.data.common_units_x is not None:
                # Clear all units except the last one
                for i in range(1, self.nGraphs):
                    self._update_layout_options_dict(f"xaxis{i}", dict(title=None))

    def _manage_ticklabels(self):
        if self.compress:
            if self._can_have_custom_ticklabels():
                if len(self.ticktext)==self.nGraphs:
                    self.has_custom_ticklabels = True
                    yaxis_options = dict(
                        showticklabels=False,
                        tickvals=list(range(self.nGraphs)),
                        ticktext=self.ticktext,
                    )
                    self._update_layout_options_dict("yaxis", yaxis_options)
            if not self.has_custom_ticklabels and not self._should_overlap():
                self._update_layout_options_dict('yaxis',dict(
                    visible = False
                ))
        if self._is_single_plot():
            if self._same_y() and not self.has_custom_ticklabels:
                self._update_layout_options_dict('yaxis',dict(
                    visible = False
                ))
        else:
            for i in range(1, self.nGraphs + 1):
                graph_trace_data = self.data.datas[i-1]
                ymin = graph_trace_data.minY
                ymax = graph_trace_data.maxY
                if ymax - ymin < 1e-9 and (not self._can_have_custom_ticklabels() or not getattr(graph_trace_data, 'use_name_as_ticklabels', False)):
                    self._update_layout_options_dict(f'yaxis{i}',dict(
                        visible = False
                    ))

    def to_dict(self):
        """Displays the Plotly figure in a Jupyter notebook."""
        if self.fig:
            fig_dict = self.fig.to_dict()
            if(self._should_have_y_slider()):
                fig_dict['y_slider']= (self.total_minY, self.total_maxY)
            if self.compress and not self._should_overlap() and len(self.ticktext)==self.nGraphs:
                fig_dict['ticklabel_limit'] = 26
            return fig_dict
    
    def isDefaultZeroBased(self):
        return self.data.is_default_zero_based
    
    def isDefaultNormalizedY(self):
        return self.data.is_default_normalized_y
    
    def changesOnOverlap(self):
        return (not self.compress or self.overlap_on_compress) and self.nGraphs != 1

    def _should_overlap(self):
        return self.overlapping and self.changesOnOverlap()
    
    def _should_have_y_slider(self):
        return (self.overlapping or self.compress or self.nGraphs==1) and not self._same_y()
    
    def _same_y(self):
        return self.data.maxY - self.data.minY < 1e-9
    
    def _is_single_plot(self):
        return self.overlapping or self.compress or self.nGraphs==1
    
    def _can_have_custom_ticklabels(self):
        return not self._should_overlap()
    
    def _getSubplotHeight(self, height=None):
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