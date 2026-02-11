class PlotlyImageSequenceFigure():
    import plotly.graph_objects as go
    import numpy as np
    from neo.core import ImageSequence

    def __init__(self, image_sequences, title=None, theme_name='plotly_dark'):
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
                    colorscale='Viridis',
                    zmin=self.np.min(image_sequence.magnitude),
                    zmax=self.np.max(image_sequence.magnitude)
                ),
                layout=self.go.Layout(
                    title=title,
                    xaxis=dict(title='X pixels'),
                    yaxis=dict(title='Y pixels'),
                    updatemenus=[dict(
                        type="buttons",
                        buttons=[dict(
                            label="Play",
                            method="animate",
                            args=[None, {
                                "frame": {"duration": 200, "redraw": True},
                                "fromcurrent": True,
                                "transition": {"duration": 0}
                            }]
                        )]
                    )],
                    template=template
                ),
                frames=[self.go.Frame(
                    data=self.go.Heatmap(z=image_sequence[k].magnitude, colorscale='Viridis'),
                    name=str(k)
                ) for k in range(num_frames)]
            ))

    def display(self):
        from IPython.display import display
        for fig in self.figs:
            display(fig)
