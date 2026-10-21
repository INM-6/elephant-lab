import numpy as np
import quantities as pq
import neo

from elephant_lab.PlotlyGraphDataTypes import (
    SpikeTrainRasterPlot,
    AnalogSignalLFPPlotList,
    EventAnnotations,
    EpochIntervals,
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
    traces = AnalogSignalLFPPlotList([signal]).data_list
    assert [t.name for t in traces] == ["lfp Ch0", "lfp Ch1", "lfp Ch2"]
    np.testing.assert_allclose(traces[1].y, signal.magnitude[:, 1])
    np.testing.assert_allclose(traces[0].x, np.arange(10) / 100)
    assert traces[0].units_y == pq.mV


def test_event_annotations_concatenate_all_events():
    """Times and labels of all events are joined, each keeping its own unit."""
    ev1 = neo.Event([1, 2] * pq.s, labels=np.array(["a", "b"]))
    ev2 = neo.Event([500] * pq.ms, labels=np.array(["c"]))
    annotations = EventAnnotations([ev1, ev2])
    np.testing.assert_allclose(annotations.x, [1, 2, 500])
    assert list(annotations.text) == ["a", "b", "c"]
    assert list(annotations.unit_indice) == [0, 0, 1]
    assert annotations.units == [pq.s, pq.ms]


def test_epoch_intervals_end_at_start_plus_duration():
    """Epoch intervals end at start + duration."""
    ep1 = neo.Epoch([1, 4] * pq.s, durations=[0.5, 2] * pq.s, labels=np.array(["x", "y"]))
    ep2 = neo.Epoch([10] * pq.s, durations=[1] * pq.s, labels=np.array(["z"]))
    intervals = EpochIntervals([ep1, ep2])
    np.testing.assert_allclose(intervals.x0, [1, 4, 10])
    np.testing.assert_allclose(intervals.x1, [1.5, 6, 11])
    assert list(intervals.text) == ["x", "y", "z"]
    assert list(intervals.unit_indice) == [0, 0, 1]
