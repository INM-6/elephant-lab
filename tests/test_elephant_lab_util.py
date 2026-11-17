import __main__
import json

import numpy as np
import quantities as pq
import neo
import pytest

from elephant_lab.elephant_lab_util import ElephantLab_util
from helpers import make_spiketrain


@pytest.fixture
def util():
    return ElephantLab_util()


@pytest.fixture
def nix_file(tmp_path):
    """A NIX file containing one block with a single spike train."""
    path = tmp_path / "data.nix"
    blk = neo.Block(name="saved")
    seg = neo.Segment()
    blk.segments.append(seg)
    seg.spiketrains.append(make_spiketrain([1, 2, 3], t_stop=10, name="st"))
    with neo.NixIO(str(path), mode="ow") as io:
        io.write_block(blk)
    return path


def test_load_with_explicit_io_class(util, kernel_ns, nix_file):
    """Loading with a given IO class puts the block into the notebook."""
    kernel_ns(loaded=None)
    util.setVarNameIOClass("NixIO", str(nix_file), "loaded")
    blk = __main__.__dict__["loaded"]
    assert isinstance(blk, neo.Block)
    assert blk.name == "saved"
    np.testing.assert_allclose(blk.segments[0].spiketrains[0].rescale(pq.s).magnitude, [1, 2, 3])


def test_load_with_automatic_io_detection(util, kernel_ns, nix_file, capsys):
    """Loading with automatic IO detection puts the block into the notebook."""
    kernel_ns(loaded=None)
    util.setVarNameNotIOClass(str(nix_file), "loaded")
    assert isinstance(__main__.__dict__["loaded"], neo.Block)
    assert "Block" in capsys.readouterr().out


def test_get_neo_io_class(util, nix_file, capsys):
    """Detects NixIO for .nix files."""
    util.getNeoIOClass(str(nix_file))
    assert json.loads(capsys.readouterr().out) == "NixIO"