import numpy as np
import quantities as pq
import neo
import pytest

from helpers import make_spiketrain, node_id_of, plotly_array


@pytest.fixture
def plot(lab):
    return lab.elephant_lab_plot


@pytest.fixture
def comm(plot):
    return plot.comm


def show(lab, kernel_ns, **variables):
    kernel_ns(**variables)
    lab.filter_changed = True
    lab.elephant_lab_tree.update_tree()


def select(lab, *neo_objs):
    """Selects neo_objs the way a click in the tree does and notifies the plot."""
    ids = [node_id_of(lab, obj) for obj in neo_objs]
    lab.elephant_lab_plot._selection_changed = True
    lab.elephant_lab_tree.handle_selection_range(ids)


def updated_plots(comm):
    return [key for m in comm.messages if m["type"] == "plots_update" for key in m["plots"]]


def removed_plots(comm):
    return [key for m in comm.messages if m["type"] == "plots_remove" for key in m["plots"]]


@pytest.fixture
def active(lab, plot):
    lab.on_selected_neo_objects_changed.add_listener(plot.on_selection_changed)
    plot.set_explore_panel_active(True)
    return plot


def test_selecting_spiketrains_sends_raster_plot(lab, active, comm, block, kernel_ns):
    """Selecting spike trains sends a raster plot with the spike times."""
    show(lab, kernel_ns, blk=block)
    select(lab, *block.segments[0].spiketrains)

    assert comm.types() == ["plots_loading", "plots_update"]
    assert updated_plots(comm) == ["raw_st"]
    figure = comm.messages[-1]["plots"]["raw_st"]
    assert len(figure["data"]) == 2
    np.testing.assert_allclose(plotly_array(figure["data"][0]["x"]), [1, 2, 3, 4])
    assert active.plots[active.RawPlotKey.RAW_ST]["is_plotted"]


def test_events_are_drawn_into_existing_plots(lab, active, comm, block, kernel_ns):
    """Events selected with a signal go into the signal plot."""
    seg = block.segments[0]
    show(lab, kernel_ns, blk=block)
    select(lab, seg.analogsignals[0], seg.events[0])

    assert updated_plots(comm) == ["raw_anasig"]  # no separate event plot


def test_deselecting_removes_plot(lab, active, comm, block, kernel_ns):
    """Plots of deselected types are removed."""
    seg = block.segments[0]
    show(lab, kernel_ns, blk=block)
    select(lab, *seg.spiketrains)
    select(lab, seg.analogsignals[0])

    assert removed_plots(comm) == ["raw_st"]
    assert updated_plots(comm) == ["raw_st", "raw_anasig"]


def test_hidden_panel_defers_plotting(lab, plot, comm, block, kernel_ns):
    """Hidden explore panel plots the selection once it becomes visible."""
    lab.on_selected_neo_objects_changed.add_listener(plot.on_selection_changed)
    show(lab, kernel_ns, blk=block)
    select(lab, *block.segments[0].spiketrains)
    assert comm.messages == []

    plot.set_explore_panel_active(True)
    assert updated_plots(comm) == ["raw_st"]


def test_settings_change_replots_only_plotted_figures(lab, active, comm, block, kernel_ns):
    """Changing overlap replots only the plots that are shown."""
    show(lab, kernel_ns, blk=block)
    select(lab, *block.segments[0].spiketrains)
    comm.messages.clear()

    active.update_settings(overlap=True)
    assert all(active.plots[k]["overlapping"] for k in active.RawPlotKey)
    assert updated_plots(comm) == ["raw_st"]


def test_zoom_on_downscaled_plot_replots_with_new_range(lab, active, comm, kernel_ns):
    """Zooming a downsampled plot replots the range, reset restores the original range."""
    st = make_spiketrain(np.linspace(0, 9, 200), t_stop=10, name="dense")
    show(lab, kernel_ns, st=st)
    active.update_settings(max_points=50)
    select(lab, st)
    raw_st = active.plots[active.RawPlotKey.RAW_ST]
    assert raw_st["is_downscaled"]
    comm.messages.clear()

    active.upscale_raw_plot({"raw_st": [2.0, 3.0]})
    assert updated_plots(comm) == ["raw_st"]
    x = plotly_array(comm.messages[-1]["plots"]["raw_st"]["data"][0]["x"])
    assert min(x) >= 2.0 and max(x) <= 3.0

    comm.messages.clear()
    active.reset_scale()
    assert updated_plots(comm) == ["raw_st"]
    assert raw_st["x_range"] == raw_st["og_x_range"]


def test_image_sequence_plot(lab, active, comm, kernel_ns):
    """Image sequences are plotted and replotted on colorscale change."""
    frames = np.random.default_rng(0).random((4, 3, 3))
    imgseq = neo.ImageSequence(frames, units=pq.V, sampling_rate=2 * pq.Hz, spatial_scale=1 * pq.um, name="img")
    show(lab, kernel_ns, img=imgseq)
    select(lab, imgseq)
    assert updated_plots(comm) == ["raw_imgsequence"]

    comm.messages.clear()
    active.update_settings(color_grade="Greys")
    assert updated_plots(comm) == ["raw_imgsequence"]
