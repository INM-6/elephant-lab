import pytest
import numpy as np
import quantities as pq
import neo
import re
from matplotlib.colors import to_rgb
from jupyphant.PlotlyGraphFigure import PlotlyGraphFigure
from jupyphant.PlotlyGraphDataTypes import SpikeTrainRasterPlot

def parse_plotly_color(color_str):
    """
    Convert Plotly color (rgb(), hex, or name) to (R,G,B) 0-255 tuple
    """
    color_str = color_str.strip()
    
    # rgb(r,g,b)
    match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', color_str)
    if match:
        return tuple(int(v) for v in match.groups())
    
    # hex or named color
    r, g, b = to_rgb(color_str)
    return (int(r*255), int(g*255), int(b*255))


@pytest.fixture
def none_plotlyGraphFigure() -> PlotlyGraphFigure:
    return PlotlyGraphFigure(None)

def test_None_data(none_plotlyGraphFigure):
    # test if any functionlaity raises an error if None was passed in as data
    none_plotlyGraphFigure.overlap()
    none_plotlyGraphFigure.overlap()
    none_plotlyGraphFigure.stack()
    none_plotlyGraphFigure.overlap()
    assert none_plotlyGraphFigure.fig is not None
    assert none_plotlyGraphFigure.data.common_units_y is None
    assert np.allclose(none_plotlyGraphFigure.getXRange(), [0,0], atol=1e-6)

def test_is_not_Downscaled(none_plotlyGraphFigure):
    assert not none_plotlyGraphFigure.isDownscaled()

def test_update_jupyterlab_theme(none_plotlyGraphFigure):
    none_plotlyGraphFigure.update_jupyterlab_theme('dark_theme')
    paper_color = parse_plotly_color(none_plotlyGraphFigure.fig.layout.template.layout.paper_bgcolor)
    assert paper_color == (17, 17, 17)
    none_plotlyGraphFigure.update_jupyterlab_theme('white_theme')
    paper_color = parse_plotly_color(none_plotlyGraphFigure.fig.layout.template.layout.paper_bgcolor)
    assert paper_color == (255, 255, 255)

def test_simple_spiketrain_coords():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure(spikeTrainRasterPlot, overlap_on_compress=False)
    data = plotlyGraphFigure.data
    assert data.minX == 0
    assert data.maxX == 10
    assert data.minY == 0
    assert data.maxY == 0
    assert np.allclose(plotlyGraphFigure.fig.data[0].x, [0,1,2,3,6,10])

def test_automatic_unit_conversion():
    seconds_spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    milliseconds_spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([x * 1000 for x in [0,1,2,3,6,10]] * pq.ms, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure([seconds_spikeTrainRasterPlot, milliseconds_spikeTrainRasterPlot], overlap_on_compress=False)
    assert plotlyGraphFigure.data.common_units_x == pq.s
    assert plotlyGraphFigure.data.maxX == 10
    assert all(np.allclose(data.x, [0,1,2,3,6,10]) for data in plotlyGraphFigure.fig.data)

def test_shift_to_0():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure(spikeTrainRasterPlot, overlap_on_compress=False, shift_to_0=True)
    assert plotlyGraphFigure.data.minX == 0
    assert plotlyGraphFigure.data.maxX == 7
    assert np.allclose(plotlyGraphFigure.fig.data[0].x, [0, 3, 7])