import pytest
import numpy as np
import quantities as pq
import neo

from elephant_lab.PlotlyImageSequenceFigure import PlotlyImageSequenceFigure

def test_image_sequence():
    """Image sequence figure has one frame per image with correct shape and names."""
    # Parameters
    num_frames = 20
    height = 30
    width = 30
    spatial_scale = 1 * pq.micrometer
    sampling_rate = 5 * pq.Hz

    # Create a synthetic sequence: moving diagonal wave
    image_data = []
    for f in range(num_frames):
        frame = np.zeros((height, width))
        for i in range(height):
            for j in range(width):
                # moving diagonal wave pattern
                frame[i, j] = np.sin(2 * np.pi * (i + j + f) / 10)
        image_data.append(frame)

    # Convert to ImageSequence
    image_sequence = neo.ImageSequence(
        image_data,
        units=pq.V,
        sampling_rate=sampling_rate,
        spatial_scale=spatial_scale,
        t_start=0*pq.s,
        name="Synthetic Sequence",
        description="Moving diagonal wave pattern"
    )
    plotly_fig = PlotlyImageSequenceFigure(image_sequence)

    fig = plotly_fig.fig

    assert len(fig.frames) == num_frames
    assert fig.data[0].z.shape == (height, width)
    assert fig.frames[0].name == "0_0"
    assert fig.frames[-1].name == f"0_{num_frames - 1}"