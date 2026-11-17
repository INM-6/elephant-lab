import __main__
import json

import numpy as np
import quantities as pq
import neo

from helpers import make_spiketrain, node_id_of


def build_tree(lab):
    lab.filter_changed = True
    lab.elephant_lab_tree.update_tree()


def select(lab, *neo_objs):
    lab.selected_neo_objects.clear()
    for obj in neo_objs:
        lab.selected_neo_objects.add(lab.elephant_lab_tree._node_registry[node_id_of(lab, obj)])


def test_update_collects_only_neo_objects_and_lists_of_them(lab, kernel_ns, block):
    """update() tracks neo objects and lists of them, skips other variables and elephant_lab internals."""
    st = make_spiketrain([1, 2])
    kernel_ns(
        blk=block,
        st=st,
        st_list=[st, make_spiketrain([3])],
        numbers=[1, 2, 3],
        text="not neo",
        elephant_lab_internal=make_spiketrain([1]),
    )
    lab.update()

    tracked = lab.neo_objs_and_lists_of_neo_objs_with_var_name
    assert set(tracked) == {"blk", "st", "st_list"}
    assert tracked["blk"] is block


def test_update_detects_changes(lab, kernel_ns):
    """Change flag is set for new variables or a changed filter, not for repeated updates."""
    kernel_ns(st=make_spiketrain([1, 2]))
    lab.update()
    assert lab.neo_objs_changed_after_update

    lab.update()
    assert not lab.neo_objs_changed_after_update

    kernel_ns(st2=make_spiketrain([3]))
    lab.update()
    assert lab.neo_objs_changed_after_update

    lab.filter_changed = True
    lab.update()
    assert lab.neo_objs_changed_after_update
    assert not lab.filter_changed


def test_insert_single_selection(lab, kernel_ns, block, capsys):
    """Insert Code returns the path of a single selected object."""
    kernel_ns(blk=block)
    build_tree(lab)
    select(lab, block.segments[0].spiketrains[0])

    lab.insert_selected_neo_objects()
    result = json.loads(capsys.readouterr().out)
    assert result == {"code_to_insert": "blk.segments[0].spiketrains[0]", "list_creation_code": ""}


def test_insert_multi_selection_creates_list_variable(lab, kernel_ns, block, capsys):
    """Multiple selections are put into the next free elephant_lab_list_<n> variable."""
    kernel_ns(blk=block, elephant_lab_list_0="already taken")
    build_tree(lab)
    sts = block.segments[0].spiketrains
    select(lab, sts[0], sts[1])

    lab.insert_selected_neo_objects()
    result = json.loads(capsys.readouterr().out)
    assert result["code_to_insert"] == "elephant_lab_list_1"
    assert result["list_creation_code"].startswith("elephant_lab_list_1 = [")
    assert "blk.segments[0].spiketrains[0]" in result["list_creation_code"]
    assert "blk.segments[0].spiketrains[1]" in result["list_creation_code"]
    created = __main__.__dict__["elephant_lab_list_1"]
    assert {id(o) for o in created} == {id(sts[0]), id(sts[1])}


def test_save_selected_objects_round_trips_through_nix(lab, kernel_ns, block, tmp_path):
    """Exported spike trains and signals read back from NIX with the same data."""
    kernel_ns(blk=block)
    build_tree(lab)
    seg = block.segments[0]
    select(lab, seg.spiketrains[0], seg.analogsignals[0])

    out = tmp_path / "export"
    lab.save_selected_neo_objects(str(out))

    with neo.NixIO(str(out) + ".nix", mode="ro") as io:
        blocks = io.read_all_blocks()
    assert len(blocks) == 1
    exported = blocks[0].segments[0]
    assert len(exported.spiketrains) == 1
    assert len(exported.analogsignals) == 1
    np.testing.assert_allclose(exported.spiketrains[0].rescale(pq.s).magnitude, [1, 2, 3, 4])
    np.testing.assert_allclose(exported.analogsignals[0].magnitude, seg.analogsignals[0].magnitude)
    assert exported.analogsignals[0].sampling_rate == seg.analogsignals[0].sampling_rate
