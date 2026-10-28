import json

import neo
import pytest

from helpers import make_spiketrain, node_id_of


@pytest.fixture
def tree(lab):
    return lab.elephant_lab_tree


def build_tree(lab):
    lab.filter_changed = True
    lab.elephant_lab_tree.update_tree()


def selected(lab):
    return {lab.map_ipytree_node_id_to_neo_obj[n._id].name
            for n in lab.selected_neo_objects
            if n._id in lab.map_ipytree_node_id_to_neo_obj}


def result_ids(capsys):
    out = capsys.readouterr().out
    line = next(l for l in out.splitlines() if l.startswith("ELEPHANT_LAB_RESULT_KEY:"))
    return json.loads(line.split(":", 1)[1])


def test_update_tree_renders_top_level_variables(lab, tree, kernel_ns, block):
    """Every variable gets a top-level node and all children are registered."""
    kernel_ns(blk=block, st=make_spiketrain([1]))
    build_tree(lab)

    top_level = tree.ipytree_of_neo_objects.nodes
    assert sorted(n.metadata["variable_name"] for n in top_level) == ["blk", "st"]
    html = tree._tree_widget.value
    assert "jup-tree" in html
    assert ">blk</span>" in html
    assert "fa-cube" in html  # Block icon
    # every neo object in the block is reachable through a node
    seg = block.segments[0]
    for obj in [block, seg, *seg.spiketrains, *seg.analogsignals, *seg.events, *seg.epochs]:
        assert node_id_of(lab, obj) in tree._node_registry


def test_children_of_tracked_parent_are_not_top_level(lab, tree, kernel_ns, block):
    """A segment whose block is also a variable is only shown inside the block."""
    seg = block.segments[0]
    kernel_ns(blk=block, seg=seg)
    build_tree(lab)
    assert [n.metadata["variable_name"] for n in tree.ipytree_of_neo_objects.nodes] == ["blk"]


def test_show_neo_obj_toggles_type_filter(lab, tree, kernel_ns, block):
    """Type filter hides and shows spike trains again."""
    kernel_ns(blk=block)
    build_tree(lab)
    assert "Spiketrains" in tree._tree_widget.value

    tree.show_neo_obj("spiketrain")
    assert neo.SpikeTrain not in tree.NEO_OBJS_TO_SHOW
    assert "Spiketrains" not in tree._tree_widget.value

    tree.show_neo_obj("spiketrain")
    assert neo.SpikeTrain in tree.NEO_OBJS_TO_SHOW
    assert "Spiketrains" in tree._tree_widget.value


def test_handle_selection_selects_children(lab, tree, kernel_ns, block, fired):
    """Click selects node with children, ctrl-click deselects them again."""
    kernel_ns(blk=block)
    build_tree(lab)
    seg = block.segments[0]

    tree.handle_selection(node_id_of(lab, seg))
    assert selected(lab) == {"seg0", "st0", "st1", "lfp", "ev", "ep"}
    assert fired["count"] == 1

    tree.handle_selection(node_id_of(lab, seg))  # a plain click keeps the node selected
    assert selected(lab) == {"seg0", "st0", "st1", "lfp", "ev", "ep"}

    tree.handle_selection(node_id_of(lab, seg), multi_select=True)  # ctrl-click toggles it off
    assert selected(lab) == set()
    assert fired["count"] == 3


def test_handle_selection_single_vs_multi(lab, tree, kernel_ns, block):
    """Plain click replaces the selection, ctrl-click adds to it."""
    kernel_ns(blk=block)
    build_tree(lab)
    st0, st1 = block.segments[0].spiketrains

    tree.handle_selection(node_id_of(lab, st0))
    tree.handle_selection(node_id_of(lab, st1))
    assert selected(lab) == {"st1"}

    tree.handle_selection(node_id_of(lab, st0), multi_select=True)
    assert selected(lab) == {"st0", "st1"}


def test_handle_selection_range_fires_once(lab, tree, kernel_ns, block, fired):
    """Shift-click range selects all nodes and fires the event once."""
    kernel_ns(blk=block)
    build_tree(lab)
    seg = block.segments[0]
    ids = [node_id_of(lab, o) for o in [*seg.spiketrains, seg.analogsignals[0]]] + ["unknown"]

    tree.handle_selection_range(ids)
    assert selected(lab) == {"st0", "st1", "lfp"}
    assert fired["count"] == 1


@pytest.fixture
def three_trains(lab, kernel_ns):
    # firing rates: 4 / 10s = 0.4 Hz, 2 / 10s = 0.2 Hz, 4 / 20s = 0.2 Hz
    trains = {
        "a": make_spiketrain([1, 2, 3, 4], t_stop=10, name="a", group="x", snr=1.0),
        "b": make_spiketrain([1, 5], t_stop=10, name="b", group="x", snr=5.0),
        "c": make_spiketrain([1, 3, 7, 15], t_stop=20, name="c", group="y", snr=9.0),
    }
    kernel_ns(**trains)
    build_tree(lab)
    return trains


@pytest.mark.parametrize("filter_type, value, expected", [
    ("firing_rate", 0.4, {"a"}),
    ("firing_rate", 0.2, {"b", "c"}),
    ("t_stop", 20.0, {"c"}),
    ("cv", 0.0, {"a", "b"}),  # regular spiking (one ISI only for b) has CV 0
])
def test_select_by_stat(lab, tree, three_trains, capsys, filter_type, value, expected):
    """Selecting by firing rate, t_start, t_stop, duration or CV picks the matching trains."""
    tree.select_by_stat(filter_type, {"value": value})
    assert selected(lab) == expected
    assert len(result_ids(capsys)) == len(expected)


@pytest.mark.parametrize("expression, expected", [
    ("group == 'x'", {"a", "b"}),
    ("group == 'x' and snr > 2", {"b"}),
    ("group == 'y' OR snr < 2", {"a", "c"}),
    ("not group == 'x'", {"c"}),
    ("group == 'x' and max(snr)", {"b"}),
])
def test_select_by_annotation_filter(lab, tree, three_trains, capsys, expression, expected):
    """Annotation expressions with and/or/not, comparisons and max()/min() select the right trains."""
    tree.select_by_annotation_filter(expression)
    assert selected(lab) == expected
    assert len(result_ids(capsys)) == len(expected)


@pytest.mark.xfail(reason="max()/min() evaluate to a bool, so comparing an annotation to them never matches", strict=True)
def test_select_by_annotation_filter_compare_with_aggregate(lab, tree, three_trains, capsys):
    """Known bug: snr == max(snr) should select the train with the highest snr."""
    tree.select_by_annotation_filter("snr == max(snr)")
    assert selected(lab) == {"c"}


def test_select_by_annotation_filter_reports_syntax_error(lab, tree, three_trains, capsys, fired):
    """Invalid expressions print a filter error and select nothing."""
    tree.select_by_annotation_filter("snr >")
    assert capsys.readouterr().out.startswith("ELEPHANT_LAB_FILTER_ERROR:")
    assert fired["count"] == 0


def test_select_by_annotation_filter_rejects_function_calls(lab, tree, three_trains, capsys):
    """Calls other than max()/min() are not evaluated."""
    tree.select_by_annotation_filter("__import__('os')")
    assert selected(lab) == set()
