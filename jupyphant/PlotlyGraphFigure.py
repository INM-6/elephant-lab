class PlotlyGraphFigure:
    from .PlotlyGraphContainer import PlotlyUtils, PlotlyGraphDataTypeList, PlotlyGraphAnnotations, PlotlyGraphAnnotationIntervals

    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from ipywidgets import HBox, FloatRangeSlider
    import numpy as np


    def __init__(self, data, overlapping=False, title=None, annotation_data=None, annotation_interval_data=None, overlap_on_compress=True, x_range=None, shift_to_0=False, max_points=10000):
        """
        Creates a Plotly figure and adds traces from the provided data.
        Data can be a single trace, a list of traces, or nested lists of traces.
        If many traces are created, it gets compressed, so it still works efficient and is visually pleasing
        """
        self.vertical_spacing = 0.075
        self.layout_options = dict()

        self.overlapping = overlapping
        self.overlap_on_compress = overlap_on_compress

        if not isinstance(data, self.PlotlyGraphDataTypeList):
            data = self.PlotlyGraphDataTypeList(data)
        data.normalize(x_range=x_range,offset_traces_on_compress= not overlapping or not self.overlap_on_compress, shift_to_0=shift_to_0, max_points=max_points)
        self.nGraphs = data.nGraphs
        self.compress = data.compress
        self.data = data
        self.total_minX = data.minX
        self.total_maxX = data.maxX
        self.total_minY = data.minY
        self.total_maxY = data.maxY


        self.height = 800 if (self.nGraphs > 2 and not self._should_overlap()) else 600
        if self._is_single_plot():
            self.fig = self.go.Figure()
            if self.compress:
                self.ticktext=[]
        else:
            self.fig = PlotlyGraphFigure.make_subplots(
                rows=self.nGraphs,
                cols=1,
                vertical_spacing=self.vertical_spacing,
                shared_xaxes=True
            )
        self._create_graphs()

        if title is None:
            title=getattr(data, 'name', None)


        self.layout_options["title"] = title
        self.layout_options["dragmode"] = "pan"
        self.layout_options["height"] = self.height
        self.layout_options["autosize"] = True

        self._manage_ticklabels()
        self._manage_legend()
        self._create_annotations(annotation_data, annotation_interval_data, x_range)
        self._manage_axis_units()
        self._create_slider()
        # Set x_range to total min and max
        for i in range(1, self.nGraphs + 1):
            self._update_layout_options_dict(f"xaxis{i}", dict(
                range = [self.total_minX, self.total_maxX]
            ))
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
        for index, d in enumerate(self.data.data_list):

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
                            title=self.PlotlyUtils.convert_unit_to_label(d.units_x)
                        ))
                    if d.units_y is not None:
                        self._update_layout_options_dict(f"yaxis{row}",dict(
                            title=self.PlotlyUtils.convert_unit_to_label(d.units_y)
                        ))
                    if self._can_have_custom_ticklabels() and hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
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
                self.PlotlyUtils.print_warning(f"Failed to add trace '{d.name}': {e}")

    def _create_slider(self):
        """Updates the range slider to the last x-axis"""
        n = self.nGraphs
        x_bgcolor = "#1e7fcc"
        PIXELS = 25
        x_height = max(0.02, PIXELS / self.height)
        xaxis_options = dict(
            rangeslider=dict(
                visible=True,
                bgcolor=x_bgcolor,
                thickness=x_height
            )
        )
        axis_key = 'xaxis' if self._is_single_plot() else f'xaxis{n}'
        self._update_layout_options_dict(axis_key, xaxis_options)

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
    
    def _create_annotations(self, annotation_data, annotation_interval_data, x_range):
        """Updates the graph annotations."""
        if annotation_data is None and annotation_interval_data is None:
            return
        if annotation_data is None:
            annotation_data = self.PlotlyGraphAnnotations(self.np.array([]), self.np.array([]), self.np.array([]), [])
        if annotation_interval_data is None:
            annotation_interval_data = self.PlotlyGraphAnnotationIntervals(self.np.array([]), self.np.array([]), self.np.array([]), self.np.array([]), [])

        number_of_events = len(annotation_data.x)
        
        xs = self.np.concatenate((annotation_data.x, (annotation_interval_data.x0 + annotation_interval_data.x1) / 2))
        texts = self.np.concatenate((annotation_data.text, annotation_interval_data.text))
        unit_indice = self.np.concatenate((annotation_data.unit_indice, annotation_interval_data.unit_indice + len(annotation_data.units)))
        unit_indice = unit_indice.astype(int)
        units = annotation_data.units + annotation_interval_data.units
        widths = self.np.concatenate((self.np.zeros(annotation_data.x.size), (annotation_interval_data.x1 - annotation_interval_data.x0)))

        if self.data.is_empty and xs.size > 0 and len(units)>0:
            self.data.is_empty = False
            if(self.data.common_units_x is None):
                self.data.common_units_x = units[0]

        if self.data.common_units_x is not None:
            for i, (x, unit_index) in enumerate(zip(xs, unit_indice)):
                unit = units[unit_index]
                can_convert = self.PlotlyUtils.can_convert_units(
                    unit=unit,
                    convert_unit=self.data.common_units_x
                )
                if can_convert == -1:  # cannot convert
                    self.data.common_units_x = None
                    break
                elif can_convert == 1:  # needs conversion
                    xs[i] = self.PlotlyUtils.convert_to_other_units(
                        x, unit=unit, convert_unit=self.data.common_units_x
                    )
                    if i >= number_of_events:
                        widths[i] = self.PlotlyUtils.convert_to_other_units(
                            widths[i], unit=unit, convert_unit=self.data.common_units_x
                        )
                else:  # already compatible
                    pass

        #Filter out of x_range
        if x_range is not None:
            x0, x1 = x_range
            mask = (xs >= x0) & (xs <= x1)
            xs = xs[mask]
            texts = texts[mask]
            unit_indice = unit_indice[mask]
            widths = widths[mask]

        if xs.size > 0:
            self.total_minX = min(self.total_minX, xs.min())
            self.total_maxX = max(self.total_maxX, xs.max())

            min_bar_width = (self.total_maxX - self.total_minX) / 500

            # Format values
            xs_str = self.PlotlyUtils.format_with_auto_digits(xs)
            start_str = self.PlotlyUtils.format_with_auto_digits(xs - widths/2)
            end_str = self.PlotlyUtils.format_with_auto_digits(xs + widths/2)

            # Build hover text
            hover_texts = self.np.where(
                widths == 0,
                self.np.char.add(
                    self.np.char.add(texts, "<br>Time: "),
                    xs_str
                ),
                self.np.char.add(
                    self.np.char.add(
                        self.np.char.add(texts, "<br>Start: "),
                        start_str
                    ),
                    self.np.char.add("<br>End: ", end_str)
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
                    x=xs,
                    width= self.np.where(widths==0, min_bar_width, widths),
                    y=self.np.full(xs.shape, ymax - ymin),
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
                    graph_trace_data = self.data.data_list[i-1]
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
                    title=self.PlotlyUtils.convert_unit_to_label(self.data.common_units_x)
                ))
            if self.data.common_units_y is not None:
                self._update_layout_options_dict("yaxis", dict(
                    title=self.PlotlyUtils.convert_unit_to_label(self.data.common_units_y)
                ))
        else:
            if self.data.common_units_x is not None:
                # Clear all units except the last one
                for i in range(1, self.nGraphs):
                    self._update_layout_options_dict(f"xaxis{i}", dict(title=None))

    def _manage_ticklabels(self):
        if self.compress:
            has_custom_ticklabels = False
            if self._can_have_custom_ticklabels():
                if len(self.ticktext)==self.nGraphs:
                    has_custom_ticklabels = True
                    yaxis_options = dict(
                        showticklabels=False,
                        tickvals=list(range(self.nGraphs)),
                        ticktext=self.ticktext,
                    )
                    self._update_layout_options_dict("yaxis", yaxis_options)
            if not has_custom_ticklabels and not self._should_overlap():
                self._update_layout_options_dict('yaxis',dict(
                    showticklabels = False
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
    
    def getXRange(self):
        return self.fig.layout.xaxis.range
    
    def isDownscaled(self):
        return self.data.is_downscaled
    
    def isDefaultZeroBased(self):
        return self.data.is_default_zero_based
    
    def changesOnOverlap(self):
        return (not self.compress or self.overlap_on_compress) and self.nGraphs != 1

    def _should_overlap(self):
        return self.overlapping and self.changesOnOverlap()
    
    def _should_have_y_slider(self):
        return (self.overlapping or self.compress or self.nGraphs==1) and self.data.maxY - self.data.minY > 1e-9
    
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