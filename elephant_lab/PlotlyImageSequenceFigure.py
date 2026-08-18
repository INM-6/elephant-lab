"""
Creates a plotly figure for image sequences with
the desired settings
"""

class PlotlyImageSequenceFigure:

    from .utils import OutputUtils
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    import numpy as np
    import quantities as pq
    from neo.core import ImageSequence
    import math

    def __init__(self, image_sequences, title=None, color_scale='Viridis', max_cols=2, name_fallback="Image Sequence"):
        if isinstance(image_sequences, self.ImageSequence):
            image_sequences = [image_sequences]

        num_sequences = len(image_sequences)
        cols = min(num_sequences, max_cols)
        rows = self.math.ceil(num_sequences / cols)

        fig_height = 500 * rows
        pixel_spacing = 140

        horizontal_spacing = 0.24
        vertical_spacing = pixel_spacing / fig_height

        # Create subplots
        self.fig = PlotlyImageSequenceFigure.make_subplots(
            rows=rows,
            cols=cols,
            horizontal_spacing=horizontal_spacing,
            vertical_spacing=vertical_spacing
        )

        self.frames = []
        updatemenus = []

        def get_total_spaced_x_space():
            return (cols-1) * horizontal_spacing
        
        def get_total_free_x_space():
            return 1 - get_total_spaced_x_space()
        
        def get_subplot_free_x_space():
            return get_total_free_x_space() / cols
        
        def get_total_spaced_y_space():
            return (rows-1) * vertical_spacing
        
        def get_total_free_y_space():
            return 1 - get_total_spaced_y_space()
        
        def get_subplot_free_y_space():
            return get_total_free_y_space() / rows

        # Helper functions for positioning
        def get_colorbar_x(col_index):
            return col_index * get_subplot_free_x_space() + (col_index-1) * horizontal_spacing

        def get_colorbar_y(row_index):
            row_index = rows - row_index + 1
            subplot_free_y_space = get_subplot_free_y_space()
            return row_index * subplot_free_y_space + (row_index-1) * vertical_spacing - subplot_free_y_space * 0.5


        def get_button_x(col_index):
            subplot_free_x_space = get_subplot_free_x_space()
            return col_index * subplot_free_x_space + (col_index-1) * horizontal_spacing - subplot_free_x_space * 0.5

        def get_button_y(row_index):
            row_index = rows - row_index + 1
            subplot_free_y_space = get_subplot_free_y_space()
            return row_index * subplot_free_y_space + (row_index-1) * vertical_spacing + subplot_free_y_space * 0.01

        for idx, seq in enumerate(image_sequences):
            row = idx // cols + 1
            col = idx % cols + 1
            num_frames, height, width = seq.shape
            duration_ms = (seq.t_stop - seq.t_start).rescale(self.pq.ms).magnitude

            data = seq.magnitude

            data = self.np.where(self.np.isinf(data), self.np.nan, data)

            unit_str = self.OutputUtils.convert_unit_to_label(seq.units, short=True)
            if self.np.iscomplexobj(data):
                data = self.np.abs(data)
                unit_str = f"|{unit_str}|"

            unit_str = self.OutputUtils.center_text_for_length(unit_str, 5)
            
            zmin, zmax = self.np.nanmin(data), self.np.nanmax(data)
            if not self.np.isfinite(zmin) or not self.np.isfinite(zmax):
                zmin, zmax = 0, 1  # fallback

            # Colorbar
            colorbar_x = get_colorbar_x(col)
            colorbar_y = get_colorbar_y(row)
            heatmap = self.go.Heatmap(
                z=data[0],
                colorscale=color_scale,
                zmin=zmin,
                zmax=zmax,
                showscale=True,
                colorbar=dict(
                    title=unit_str,
                    x=colorbar_x,
                    y=colorbar_y,
                    len=get_subplot_free_y_space()
                )
            )
            self.fig.add_trace(heatmap, row=row, col=col)

            # Animation frames
            for k in range(num_frames):
                frame_data = [self.go.Heatmap(
                    z=data[k],
                    colorscale=color_scale,
                    zmin=zmin,
                    zmax=zmax
                )]
                self.frames.append(self.go.Frame(
                    data=frame_data,
                    name=f"{idx}_{k}",
                    traces=[idx]
                ))

            label_text = getattr(seq, 'name', None)
            if label_text is None:
                if callable(name_fallback):
                    label_text = name_fallback(seq)
                else:
                    label_text = str(name_fallback)
            label = f"▶ {label_text}" 
            # Button above column
            button_x = get_button_x(col)
            button_y = get_button_y(row)
            button = dict(
                type="buttons",
                buttons=[dict(
                    label=label,
                    method="animate",
                    args=[[f"{idx}_{k}" for k in range(num_frames)],
                          {"frame": {"duration": duration_ms / num_frames, "redraw": True},
                           "fromcurrent": True,
                           "transition": {"duration": 0}}]
                )],
                direction="left",
                showactive=True,
                x=button_x,
                y=button_y,
                xanchor="center",
                yanchor="bottom"
            )
            updatemenus.append(button)

            # Lock aspect ratio
            self.fig.update_xaxes(scaleanchor=f'y{idx+1}', row=row, col=col)
            self.fig.update_yaxes(scaleratio=1, row=row, col=col)

            # Add spatial scale to axes
            if hasattr(seq, 'spatial_scale') and seq.spatial_scale is not None:
                spatial_scale = seq.spatial_scale
                spatial_label = (
                    f"{spatial_scale} X {spatial_scale}<br>"
                    f"({self.OutputUtils.get_text_label(spatial_scale.units)})"
                )
                self.fig.update_xaxes(title_text=spatial_label, row=row, col=col)

        # Final layout
        self.fig.frames = self.frames
        self.fig.update_layout(
            height=fig_height,
            title=dict(text=title or "Image Sequences", x=0.5, xanchor="center"),
            updatemenus=updatemenus,
            showlegend=False
        )

    def to_dict(self):
        return self.fig.to_dict()