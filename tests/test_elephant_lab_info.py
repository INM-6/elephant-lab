import re

import numpy as np
import quantities as pq
import neo
import pytest

from helpers import make_spiketrain, make_analogsignal, node_id_of


@pytest.fixture
def info(lab):
    return lab.elephant_lab_info


@pytest.fixture
def rendered(info, monkeypatch):
    """Collects the HTML bodies the details panel would display."""
    bodies = []
    monkeypatch.setattr(info, "_display", bodies.append)
    return bodies


def build_tree_and_select(lab, kernel_ns, *neo_objs, **variables):
    kernel_ns(**variables)
    lab.filter_changed = True
    lab.elephant_lab_tree.update_tree()
    lab.selected_neo_objects.clear()
    for obj in neo_objs:
        lab.selected_neo_objects.add(lab.elephant_lab_tree._node_registry[node_id_of(lab, obj)])


def selectable_value(html, filter_type, label):
    """Returns the data-filter value of a clickable statistic in the rendered HTML."""
    pattern = (rf'<span class="key">{re.escape(label)}:</span>\s*<span class="val selectable-stat"\s*'
               rf'data-filter-type="{filter_type}"\s*data-filter="\{{&quot;value&quot;: ([^,}}]+)')
    match = re.search(pattern, html)
    assert match, f"no selectable {filter_type} '{label}' in output"
    return float(match.group(1))


def make_imagesequence():
    return neo.ImageSequence(np.zeros((3, 4, 5)), units=pq.V, sampling_rate=1 * pq.Hz, spatial_scale=1 * pq.um)


@pytest.mark.parametrize("obj, expected", [
    (neo.Block(name="b"), "Type:</span><span class=\"val\">Block"),
    (make_spiketrain([1, 2, 3], t_stop=10), "Spikes:</span><span class=\"val\">3"),
    (make_analogsignal(n_samples=50, n_channels=3), "3 channels × 50 samples"),
    (neo.IrregularlySampledSignal([0.0, 1.0, 3.0] * pq.s, [[1.0], [2.0], [3.0]] * pq.mV), "1 channels × 3 samples"),
    (neo.Event([1, 2] * pq.s, labels=np.array(["a", "b"])), "Events:</span><span class=\"val\">2"),
    (neo.Epoch([1] * pq.s, durations=[2] * pq.s, labels=np.array(["x"])), "Epochs:</span><span class=\"val\">1"),
    (make_imagesequence(), "3 frames × 4 rows × 5 cols"),
])
def test_neo_object_dispatch(info, obj, expected):
    """Each object type is rendered by its own detail view."""
    html = info._html_neo_object(obj, "<b>node</b> name")
    assert html.startswith("<h3>node name</h3>")
    assert expected in html


def test_spiketrain_overview_statistics(lab, info, rendered, kernel_ns):
    """Overview of two trains shows correct spike count, firing rates, CV and t_stop."""
    regular = make_spiketrain([1, 2, 3, 4, 5], t_stop=10, name="regular")   # 0.5 Hz, CV 0
    irregular = make_spiketrain([1, 2, 4, 8], t_stop=20, name="irregular")  # 0.2 Hz, ISIs 1, 2, 4
    build_tree_and_select(lab, kernel_ns, regular, irregular, regular=regular, irregular=irregular)

    info.pretty_print_of_selected_neo_objects()
    html = rendered[0]

    assert "SpikeTrain Overview (2)" in html
    assert "Total Spikes:</span><span class=\"val\">9" in html
    assert selectable_value(html, "firing_rate", "Min") == pytest.approx(0.2)
    assert selectable_value(html, "firing_rate", "Max") == pytest.approx(0.5)
    isis = np.array([1.0, 2.0, 4.0])
    assert selectable_value(html, "cv", "Max") == pytest.approx(isis.std() / isis.mean())
    assert selectable_value(html, "cv", "Min") == pytest.approx(0.0)
    assert selectable_value(html, "t_stop", "t_stop Max") == pytest.approx(20.0)


def test_analogsignal_overview(lab, info, rendered, kernel_ns):
    """Overview of two signals shows channel count and min/max duration."""
    short = make_analogsignal(n_samples=100, n_channels=2, rate=1000, name="short")  # 0.1 s
    long = make_analogsignal(n_samples=500, n_channels=1, rate=1000, name="long")    # 0.5 s
    build_tree_and_select(lab, kernel_ns, short, long, short=short, long=long)

    info.pretty_print_of_selected_neo_objects()
    html = rendered[0]
    assert "AnalogSignal Overview (2)" in html
    assert "Total Channels:</span><span class=\"val\">3" in html
    assert selectable_value(html, "duration", "Duration Min") == pytest.approx(0.1)
    assert selectable_value(html, "duration", "Duration Max") == pytest.approx(0.5)