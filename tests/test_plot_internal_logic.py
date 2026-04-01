import pytest
import numpy as np
import quantities as pq
import neo
import re
from matplotlib.colors import to_rgb
from jupyphant.PlotlyGraphFigure import *
from jupyphant.PlotlyGraphContainer import *
from jupyphant.PlotlyGraphDataTypes import SpikeTrainRasterPlot
from jupyphant.PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
from ipywidgets import FloatRangeSlider

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

@pytest.fixture
def three_spikeTrainRasterPlots() -> PlotlyGraphFigure:
    spikeTrainRasterPlot1 = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    spikeTrainRasterPlot2 = SpikeTrainRasterPlot(neo.SpikeTrain([0.5,1.5,2.5,3.5,6.5] * pq.s, t_stop=10 * pq.s))
    spikeTrainRasterPlot3 = SpikeTrainRasterPlot(neo.SpikeTrain([0.25,1.25,2.25,3.25,6.25] * pq.s, t_stop=10 * pq.s))
    return PlotlyGraphFigure([spikeTrainRasterPlot1, spikeTrainRasterPlot2, spikeTrainRasterPlot3], overlap_on_compress=False)

def test_plotlyUtils_can_convert_units():
    assert PlotlyUtils.can_convert_units(pq.s, pq.ms)==1
    assert PlotlyUtils.can_convert_units(pq.ms, pq.s)==1
    assert PlotlyUtils.can_convert_units(pq.s, pq.V)==-1
    assert PlotlyUtils.can_convert_units(pq.s, pq.s)==0

def test_plotlyUtils_convert_to_other_units():
    assert np.isclose(PlotlyUtils.convert_to_other_units(1, pq.s, pq.ms), 1000)
    assert np.isclose(PlotlyUtils.convert_to_other_units(1000, pq.ms, pq.s), 1)

def test_height(none_plotlyGraphFigure, three_spikeTrainRasterPlots):
    assert none_plotlyGraphFigure.fig.layout.height == 600
    assert three_spikeTrainRasterPlots.fig.layout.height == 800
    spikeTrainRasterPlot1 = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    spikeTrainRasterPlot2 = SpikeTrainRasterPlot(neo.SpikeTrain([0.5,1.5,2.5,3.5,6.5] * pq.s, t_stop=10 * pq.s))
    spikeTrainRasterPlot3 = SpikeTrainRasterPlot(neo.SpikeTrain([0.25,1.25,2.25,3.25,6.25] * pq.s, t_stop=10 * pq.s))
    assert PlotlyGraphFigure([spikeTrainRasterPlot1, spikeTrainRasterPlot2, spikeTrainRasterPlot3], overlap_on_compress=False, overlapping=True).fig.layout.height == 600

def test_None_data(none_plotlyGraphFigure):
    assert isinstance(none_plotlyGraphFigure.data, PlotlyGraphDataTypeList)
    assert none_plotlyGraphFigure.fig is not None
    assert none_plotlyGraphFigure.data.common_units_y is None
    assert np.allclose(none_plotlyGraphFigure.getXRange(), [0,0], atol=1e-6, rtol=1e-3)

def test_is_not_Downscaled(none_plotlyGraphFigure):
    assert not none_plotlyGraphFigure.isDownscaled()

def test_legend_visibility(none_plotlyGraphFigure, three_spikeTrainRasterPlots):
    assert none_plotlyGraphFigure.fig.layout.showlegend == False
    assert three_spikeTrainRasterPlots.fig.layout.showlegend == False

def test_ticklabels(none_plotlyGraphFigure, three_spikeTrainRasterPlots):
    assert none_plotlyGraphFigure.fig.layout.xaxis.showticklabels == None
    assert three_spikeTrainRasterPlots.fig.layout.xaxis.showticklabels == False

def test_sliders(none_plotlyGraphFigure, three_spikeTrainRasterPlots):
    assert none_plotlyGraphFigure.fig.layout.xaxis.rangeslider != None
    assert three_spikeTrainRasterPlots.fig.layout.xaxis3.rangeslider != None

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

def test_custom_x_range():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure(spikeTrainRasterPlot, overlap_on_compress=False, x_range=[-5,4])
    assert not np.allclose(plotlyGraphFigure.getXRange(), [-5,4], atol=1e-6, rtol=1e-3)
    assert np.allclose(plotlyGraphFigure.getXRange(), [0,3], atol=1e-6, rtol=1e-3)
    assert np.allclose(plotlyGraphFigure.fig.data[0].x, [0,1,2,3], atol=1e-6, rtol=1e-3)

def test_shift_to_0_and_custom_x_range():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure(spikeTrainRasterPlot, overlap_on_compress=False, shift_to_0=True, x_range=[1,6.5])
    assert plotlyGraphFigure.data.minX == 3
    assert plotlyGraphFigure.data.maxX == 3
    assert np.allclose(plotlyGraphFigure.fig.data[0].x, [3])

def test_downsampling():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure(spikeTrainRasterPlot, overlap_on_compress=False, max_points=3)
    assert len(plotlyGraphFigure.fig.data[0].x) == 3
    assert np.allclose(plotlyGraphFigure.fig.data[0].x, [0,1,10])

def test_filtering():
    spikeTrainRasterPlot1 = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    spikeTrainRasterPlot2 = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10, 15, 20] * pq.s, t_stop=20 * pq.s))
    spikeTrainRasterPlot3 = SpikeTrainRasterPlot(neo.SpikeTrain([] * pq.s, t_stop=20 * pq.s))
    plotlyGraphFigure = PlotlyGraphFigure([spikeTrainRasterPlot1, spikeTrainRasterPlot2, spikeTrainRasterPlot3], overlap_on_compress=False, x_range=[13,20])
    assert plotlyGraphFigure.nGraphs == 1

def test_offset_traces_on_compress():
    def createPlotlyGraphDataTypeList():
        def createGraphObject():
            class Dummy:
                pass
            graphObject = Dummy()
            graphObject.x = np.array([0,1,2,3,4])
            graphObject.y = np.array([0,1,2,3,4])
            graphObject.units_x = pq.s
            graphObject.units_y = pq.V
            return graphObject
        
        return PlotlyGraphDataTypeList([createGraphObject() for _ in range(20)])
    plotlyGraphFigure1 = PlotlyGraphFigure(createPlotlyGraphDataTypeList())
    plotlyGraphFigure2 = PlotlyGraphFigure(createPlotlyGraphDataTypeList(), overlapping=True)
    plotlyGraphFigure3 = PlotlyGraphFigure(createPlotlyGraphDataTypeList(), overlapping=True, overlap_on_compress=False)
    assert plotlyGraphFigure1.nGraphs == 20
    assert plotlyGraphFigure1.compress == True
    assert np.allclose(plotlyGraphFigure1.fig.data[19].y, plotlyGraphFigure3.fig.data[19].y)
    assert not np.allclose(plotlyGraphFigure1.fig.data[19].y, plotlyGraphFigure2.fig.data[19].y)

def test_annotations():
    spikeTrainRasterPlot = SpikeTrainRasterPlot(neo.SpikeTrain([0,1,2,3,6,10] * pq.s, t_stop=10 * pq.s))
    plotlyGraphAnnotations = PlotlyGraphAnnotations(np.array([1,2,3]), np.array(["Test"] * 3), np.array([0] * 3), [pq.s])
    plotlyGraphAnnotationIntervals = PlotlyGraphAnnotationIntervals(np.array([1,2,3]),np.array([1.5,2.2,4]), np.array(["Test"] * 3), np.array([0] * 3), [pq.s])
    plotlyGraphFigureNoAnnotations = PlotlyGraphFigure(spikeTrainRasterPlot)
    assert len(plotlyGraphFigureNoAnnotations.fig.data) == 1
    plotlyGraphFigureOnlyAnnotations = PlotlyGraphFigure(spikeTrainRasterPlot, annotation_data=plotlyGraphAnnotations)
    assert len(plotlyGraphFigureOnlyAnnotations.fig.data) == 2
    plotlyGraphFigureOnlyAnnotationsInterval = PlotlyGraphFigure(spikeTrainRasterPlot, annotation_interval_data=plotlyGraphAnnotationIntervals)
    assert len(plotlyGraphFigureOnlyAnnotationsInterval.fig.data) == 2
    plotlyGraphFigureBothAnnotations = PlotlyGraphFigure(spikeTrainRasterPlot, annotation_data=plotlyGraphAnnotations, annotation_interval_data=plotlyGraphAnnotationIntervals)
    assert len(plotlyGraphFigureBothAnnotations.fig.data) == 2

def test_image_sequence():
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