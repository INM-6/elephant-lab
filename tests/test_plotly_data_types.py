import numpy as np
import quantities as pq
import neo

from elephant_lab.PlotlyGraphDatas import (
    SpikeTrainRasterPlot,
    AnalogSignalLFPPlotList,
)
from helpers import make_spiketrain, make_analogsignal


def test_raster_plot_puts_spikes_on_one_line():
    """Raster trace has spike times as x and y = 0."""
    st = make_spiketrain([0.5, 1.5, 4], t_stop=5, name="unit")
    trace = SpikeTrainRasterPlot(st)
    np.testing.assert_allclose(trace.x, [0.5, 1.5, 4])
    np.testing.assert_allclose(trace.y, [0, 0, 0])
    assert trace.units_x == pq.s
    assert trace.name == "unit"
    assert trace.mode == "markers"


def test_lfp_plot_list_creates_one_trace_per_channel():
    """One trace per channel named '<name> Ch<i>' with correct times and values."""
    signal = make_analogsignal(n_samples=10, n_channels=3, rate=100, name="lfp")
    traces = AnalogSignalLFPPlotList([signal]).datas
    assert [t.name for t in traces] == ["lfp-ch0", "lfp-ch1", "lfp-ch2"]
    np.testing.assert_allclose(traces[1].y, signal.magnitude[:, 1])
    np.testing.assert_allclose(traces[0].x, np.arange(10) / 100)
    assert traces[0].units_y == pq.mV