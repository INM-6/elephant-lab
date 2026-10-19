"""Factories and lookups shared by the Python-side tests."""

import base64

import numpy as np
import quantities as pq
import neo


def make_spiketrain(times, t_stop=10, name=None, **annotations):
    return neo.SpikeTrain(np.asarray(times, dtype=float) * pq.s, t_stop=t_stop * pq.s, name=name, **annotations)


def make_analogsignal(n_samples=100, n_channels=2, rate=1000, name=None, **annotations):
    data = np.arange(n_samples * n_channels, dtype=float).reshape(n_samples, n_channels)
    return neo.AnalogSignal(data, units="mV", sampling_rate=rate * pq.Hz, name=name, **annotations)


def node_id_of(lab, neo_obj):
    """Returns the tree node id that belongs to neo_obj."""
    for node_id, obj in lab.map_ipytree_node_id_to_neo_obj.items():
        if obj is neo_obj:
            return node_id
    raise KeyError(f"{neo_obj!r} is not part of the tree")


def plotly_array(value):
    """Decodes a trace array from a figure dict; Plotly >= 6 sends numpy arrays base64-encoded."""
    if isinstance(value, dict) and "bdata" in value:
        array = np.frombuffer(base64.b64decode(value["bdata"]), dtype=value["dtype"])
        if "shape" in value:
            array = array.reshape([int(n) for n in str(value["shape"]).split(",")])
        return array
    return np.asarray(value)
