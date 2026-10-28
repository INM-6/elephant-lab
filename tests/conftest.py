"""
Shared fixtures for the Python-side tests.

ElephantLab normally runs inside an IPython kernel and grabs the kernel shell
at class-definition time (``get_ipython().kernel.shell``). To test it outside
a kernel, a fake IPython object is installed while the module is imported.
Its shell namespace is ``__main__.__dict__``, which is the same namespace
ElephantLab reads notebook variables from.
"""

import __main__
import types

import IPython
import numpy as np
import pytest
import quantities as pq
import neo

from helpers import make_spiketrain, make_analogsignal


class _FakeShell:
    """Just enough of an InteractiveShell for NamespaceMagics.who_ls()."""

    def __init__(self):
        self.user_ns = __main__.__dict__
        self.user_ns_hidden = {}


_fake_ipython = types.SimpleNamespace(kernel=types.SimpleNamespace(shell=_FakeShell()))

_original_get_ipython = IPython.get_ipython
IPython.get_ipython = lambda: _fake_ipython
try:
    from elephant_lab.elephant_lab import ElephantLab
finally:
    IPython.get_ipython = _original_get_ipython


class FakeComm:
    """Records messages instead of sending them to the frontend."""

    def __init__(self):
        self.messages = []

    def send(self, data):
        self.messages.append(data)

    def types(self):
        return [m["type"] for m in self.messages]


@pytest.fixture
def kernel_ns(monkeypatch):
    """
    Puts variables into the (fake) notebook namespace. Every variable is
    removed again after the test, including list variables that
    ElephantLab.insert_selected_neo_objects creates on its own.
    """

    def define(**variables):
        for name, value in variables.items():
            monkeypatch.setitem(__main__.__dict__, name, value)

    yield define

    for name in [n for n in __main__.__dict__ if n.startswith("elephant_lab_list_")]:
        del __main__.__dict__[name]


@pytest.fixture
def lab():
    """An ElephantLab instance with a headless tree widget and a fake plot comm."""
    elephant_lab = ElephantLab()
    elephant_lab.elephant_lab_tree._tree_widget = types.SimpleNamespace(value="")
    elephant_lab.elephant_lab_plot.comm = FakeComm()
    return elephant_lab


@pytest.fixture
def fired(lab):
    """Counts how often on_selected_neo_objects_changed fires."""
    counter = {"count": 0}

    def listener():
        counter["count"] += 1

    lab.on_selected_neo_objects_changed.add_listener(listener)
    return counter


@pytest.fixture
def block():
    """A block with one segment holding two spike trains, an analog signal, an event and an epoch."""
    blk = neo.Block(name="blk")
    seg = neo.Segment(name="seg0")
    blk.segments.append(seg)
    seg.spiketrains.append(make_spiketrain([1, 2, 3, 4], name="st0", quality="good", snr=3.0))
    seg.spiketrains.append(make_spiketrain([1, 5], name="st1", quality="bad", snr=7.5))
    seg.analogsignals.append(make_analogsignal(name="lfp"))
    seg.events.append(neo.Event([1, 2] * pq.s, labels=np.array(["a", "b"]), name="ev"))
    seg.epochs.append(neo.Epoch([1, 4] * pq.s, durations=[0.5, 1] * pq.s, labels=np.array(["x", "y"]), name="ep"))
    blk.check_relationships()
    return blk
