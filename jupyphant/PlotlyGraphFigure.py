class PlotlyGraphFigure:
    from .PlotlyGraphContainer import PlotlyUtils, PlotlyGraphDataTypeList

    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from ipywidgets import HBox, FloatRangeSlider


    def __init__(self, data, overlapping=False, title=None, annotation_data=None, annotation_interavals_data=None, overlap_on_compress=True, x_range=None, shift_to_0=False, max_points=10000):
        """
        Creates a Plotly figure and adds traces from the provided data.
        Data can be a single trace, a list of traces, or nested lists of traces.
        If many traces are created, it gets compressed, so it still works efficient and is visually pleasing
        """
        self.vertical_spacing = 0.075
        self.default_height = 600
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


        self.height = self.default_height
        if self.nGraphs > 2:
            self.height = 800
        if self.compress:
            self.fig = self.go.Figure()
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

        self._manage_axis_units()

        if self.compress:
            if len(self.ticktext)==self.nGraphs:
                yaxis_options = dict(
                    showticklabels=False,
                    tickvals=list(range(self.nGraphs)),
                    ticktext=self.ticktext,
                )
                self._update_layout_options_dict("yaxis", yaxis_options)
            else:
                if not overlapping:
                    self._update_layout_options_dict('yaxis',dict(
                        showticklabels = False
                    ))
            self.hide_legend = True
        self._update_legend()
        self._create_annotations(annotation_data, x_range)
        self._create_annotation_intervals(annotation_interavals_data, x_range)
        self._create_sliders()
        self._format_annotations()
        # Set x_range to total min and max
        for i in range(1, self.nGraphs + 1):
            self._update_layout_options_dict(f"xaxis{i}", dict(
                range = [self.total_minX, self.total_maxX]
            ))
        self._update_layout()
        
        if overlapping:
            self.overlapping = False
            self.overlap()
            self.overlapping = True

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
                default_marker = dict(size=1)
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
                    mode=getattr(d, "mode", "markers"),
                    marker=marker_settings,
                    line=line_settings
                )

                if self.compress:
                    self.fig.add_trace(trace)
                    if hasattr(d, 'use_name_as_ticklabels'):
                        if d.use_name_as_ticklabels:
                            self.ticktext.append(d.name)
                else:
                    row = index + 1
                    self.fig.add_trace(
                            trace, 
                            row=row,
                            col=1
                        )
                    if d.units_x is not None:
                        self._update_layout_options_dict(f"xaxis{row}",dict(
                            title=d.units_x.__str__()
                        ))
                    if d.units_y is not None:
                        self._update_layout_options_dict(f"yaxis{row}",dict(
                            title=d.units_y.__str__()
                        ))
                    if hasattr(d, 'use_name_as_ticklabels'):
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
    
    def _change_height_after_render(self, height):
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
        self._update_y_slider()
    
    def overlap(self):
        """Overlapps the graphs"""
        if self.overlapping or self.compress:
            return
        self.overlapping = True

        self.saved_y_ranges = []
        for i in range(1, self.nGraphs + 1):
            self._update_layout_options_dict(f"yaxis{i}", dict(
                visible=self.data.common_units_y is not None and i==1,
                domain=[0.0,1.0]
            ))
            y_range = self.fig.layout[f"yaxis{i}"].range
            self.saved_y_ranges.append(y_range)

        self._change_height_after_render(self.default_height)
        if hasattr(self, 'y_slider'):
            with self.fig.batch_update():
                    self.fig.update_yaxes(range=self.y_slider.value)
        self._update_legend()
        self._update_layout()
        
        
    def stack(self):
        """Stacks the graphs"""
        if not self.overlapping or self.compress:
            return
        self.overlapping = False

        n = self.nGraphs
        vertical_spacing = self.vertical_spacing

        subplot_height = self._getSubplotHeight(1.0)

        for i in range(1, n + 1):
            # Domain goes from bottom to top
            end = 1 - (i - 1) * (subplot_height + vertical_spacing)
            start = end - subplot_height
            if(start<0): start=0 #floating point precision issue

            self._update_layout_options_dict(f"yaxis{i}", 
                dict(
                    visible=True,
                    domain=[start, end],
                    range = self.saved_y_ranges[i-1]
                )
            )

        self._change_height_after_render(self.height)
        self._update_legend()
        self._update_layout()

    def _create_sliders(self):
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
            self._update_layout_options_dict("xaxis", xaxis_options)
        else:
            for i in range(1, n + 1):
                # Adding this range slider makes it impossible to manually zoom in vertically for this graph
                addX_slider = i == n
                if addX_slider:
                    axis_key = f'xaxis{i}'
                    xaxis_options = dict(
                        rangeslider=dict(
                            visible=True,
                            bgcolor=x_bgcolor,
                            thickness=x_height
                        )
                    )
                    self._update_layout_options_dict(axis_key, xaxis_options)

        y_slider_height = self._calculate_y_slider_height()

        totalrange = [self.data.minY, self.data.maxY]
        self.y_slider = self.FloatRangeSlider(
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
                showticklabels = bool(new_range[1]-new_range[0]<26) and (not self.overlapping or not self.overlap_on_compress)
                self._update_layout_options_dict("yaxis", dict(
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
                self._update_layout()

        self.y_slider.observe(update_y_range, names='value')
        self._update_y_slider()
        update_ticklabels(totalrange)

    def _update_legend(self):
        if self.nGraphs == 1:
            return

        if self.overlapping and not self.compress:
            if not self.fig.layout.showlegend:
                self.layout_options["showlegend"] = True
        else:
            if hasattr(self, 'hide_legend'):
                if self.hide_legend:
                    self.layout_options["showlegend"] = False
        

    def _update_y_slider(self):
        """Updates the y-axis slider height and visibility."""
        if hasattr(self, 'y_slider'):
            y_slider_height = self._calculate_y_slider_height()
            if y_slider_height != int(self.y_slider.layout.height.replace('px','')):
                self.y_slider.layout.height = f'{y_slider_height}px'
            visible = 'visible' if self.overlapping or self.compress or self.nGraphs==1 else 'hidden'
            if self.y_slider.layout.visibility != visible:
                self.y_slider.layout.visibility = visible

    def _calculate_y_slider_height(self):
        return int(0.875 * self._get_height() - 165)
    
    def _get_height(self):
        """Returns the current height of the figure."""
        if self.overlapping and not self.compress:
            return self.default_height
        else:
            return self.height
    
    def _create_annotations(self, annotation_data, x_range):
        """Updates the graph annotations."""
        if annotation_data is None:
            return
        
        xs = annotation_data.x
        texts = annotation_data.text
        units = annotation_data.units

        #Filter out of x_range
        if x_range is not None:
            x0, x1 = x_range
            mask = (xs >= x0) & (xs <= x1)
            xs = xs[mask]
            texts = texts[mask]
            units = units[mask]

        self.total_minX = min(self.total_minX, xs.min())
        self.total_maxX = max(self.total_maxX, xs.max())
        
        shapes = []
        annotations = []

        for x, text, unit in zip(xs, texts, units):
            if self.data.common_units_x is not None:
                can_convert = self.PlotlyUtils.can_convert_units(unit=unit, convert_unit=self.data.common_units_x)
                if can_convert == -1:
                    continue
                if can_convert == 1:
                    x = self.PlotlyUtils.convert_to_other_units(x, unit=unit, convert_unit=self.data.common_units_x)
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

        self._update_layout_options_list("shapes", shapes)
        self._update_layout_options_list("annotations", annotations)

    def _create_annotation_intervals(self, annotation_interavals_data, x_range):
        """Updates the graph annotation intervals."""
        if annotation_interavals_data is None:
            return
        
        x0s = annotation_interavals_data.x0
        x1s = annotation_interavals_data.x1
        texts = annotation_interavals_data.text
        units = annotation_interavals_data.units

        #Filter out of x_range
        if x_range is not None:
            x0, x1 = x_range
            mask = (x1s >= x0) & (x0s <= x1)
            x0s = x0s[mask]
            x1s = x1s[mask]
            texts = texts[mask]
            units = units[mask]

        self.total_minX = min(min(self.total_minX, x0s.min()), x1s.min())
        self.total_maxX = max(max(self.total_maxX, x0s.max()), x1s.max())

        shapes = []
        annotations = []

        for x0, x1, text, unit in zip(x0s, x1s, texts, units):
            if self.data.common_units_x is not None:
                can_convert = self.PlotlyUtils.can_convert_units(unit=unit, convert_unit=self.data.common_units_x)
                if can_convert == -1:
                    continue
                if can_convert == 1:
                    x0 = self.PlotlyUtils.convert_to_other_units(x0, unit=unit, convert_unit=self.data.common_units_x)
                    x1 = self.PlotlyUtils.convert_to_other_units(x1, unit=unit, convert_unit=self.data.common_units_x)
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

        self._update_layout_options_list("shapes", shapes)
        self._update_layout_options_list("annotations", annotations)

    def _format_annotations(self):
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

    def _manage_axis_units(self):
        """If all x-axes have the same units, move it to the last axis only."""
        if self.compress:
            if self.data.common_units_x is not None:
                self._update_layout_options_dict("xaxis", dict(
                    title=self.data.common_units_x.__str__()
                ))
            if self.data.common_units_y is not None:
                self._update_layout_options_dict("yaxis", dict(
                    title=self.data.common_units_y.__str__()
                ))
        else:
            if self.data.common_units_x is not None:
                # Clear all units except the last one
                for i in range(1, self.nGraphs):
                    self._update_layout_options_dict(f"xaxis{i}", dict(title=None))

    def to_dict(self):
        """Displays the Plotly figure in a Jupyter notebook."""
        if self.fig:
            fig_dict = self.fig.to_dict()
            if(self._should_have_y_slider()):
                fig_dict['y_slider']= (self.data.minY, self.data.maxY)
            if self.compress and not self.overlapping and len(self.ticktext)==self.nGraphs:
                fig_dict['ticklabel_limit'] = 26
            return fig_dict

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
    
    def getXRange(self):
        return self.fig.layout.xaxis.range
    
    def isDownscaled(self):
        return self.data.is_downscaled
    
    def isDefaultZeroBased(self):
        return self.data.is_default_zero_based
    
    def changesOnOverlap(self):
        return not self.compress or self.overlap_on_compress
    
    def _should_have_y_slider(self):
        return (self.overlapping or self.compress or self.nGraphs==1) and self.data.maxY - self.data.minY > 1e-9