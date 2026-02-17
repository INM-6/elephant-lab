class PlotlyImageSequenceFigure():
    import plotly.graph_objects as go
    import numpy as np
    import quantities as pq
    from neo.core import ImageSequence
    from IPython.display import display as ipython_display

    def __init__(self, image_sequences, title=None, theme_name='plotly_dark', color_scale='Viridis'):
        """
        Creates a plotly.Heatmap with animation to display the image_sequence
        """
        if isinstance(image_sequences, self.ImageSequence):
            image_sequences = [image_sequences]

        template = "plotly_white"
        if "dark" in theme_name.lower():
            template = "plotly_dark"
        self.figs = []
        for image_sequence in image_sequences:
            # Shape: (num_frames, height, width)
            num_frames, height, width = image_sequence.shape

            self.figs.append(self.go.Figure(
                data=self.go.Heatmap(
                    z=image_sequence[0].magnitude,  # first frame
                    colorscale=color_scale,
                    zmin=self.np.min(image_sequence.magnitude),
                    zmax=self.np.max(image_sequence.magnitude),
                    colorbar=dict(
                        title=image_sequence.units.__str__()
                    )
                ),
                layout=self.go.Layout(
                    title=f"Duration: {image_sequence.t_stop - image_sequence.t_start}",
                    height=500,
                    xaxis=dict(title=image_sequence.spatial_scale.__str__()),
                    yaxis=dict(
                        title=image_sequence.spatial_scale.__str__(),
                        scaleanchor="x",   # lock y scale to x
                        scaleratio=1       # 1 unit in x = 1 unit in y
                    ),
                    updatemenus=[dict(
                        type="buttons",
                        buttons=[dict(
                            label="Play",
                            method="animate",
                            args=[None, {
                                "frame": {"duration": image_sequence.frame_duration.rescale(self.pq.ms).magnitude, "redraw": True},
                                "fromcurrent": True,
                                "transition": {"duration": 0}
                            }]
                        )]
                    )],
                    template=template
                ),
                frames=[self.go.Frame(
                    data=self.go.Heatmap(z=image_sequence[k].magnitude, colorscale=color_scale),
                    name=str(k)
                ) for k in range(num_frames)]
            ))

    def display(self):
        for fig in self.figs:
            PlotlyImageSequenceFigure.ipython_display(fig)
