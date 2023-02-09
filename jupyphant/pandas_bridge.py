# -*- coding: utf-8 -*-
"""
Bridge to the pandas library. Extends existing pandas_bridge.py in elephant. Since elephant plans to remove the
pandas_bridge module, the existing functionality might be migrated into this module.
"""

from __future__ import division, print_function, unicode_literals

import numpy as np
import pandas as pd
import warnings
import quantities as pq

from elephant.neo_tools import (extract_neo_attributes, get_all_epochs,
                                get_all_events, get_all_spiketrains, _get_all_objs)
from elephant.pandas_bridge import _extract_neo_attrs_safe, _multiindex_from_dict, _sort_inds, _multi_objs_to_dataframe, \
    _convert_value_safe

# sets the number of rows to display in the pandas.Dataframe table
# pd.set_option('display.max_rows', None)


def analogsignal_to_dataframe(analogsignal, parents=True, child_first=True):
    """Convert a `neo.AnalogSignal` to a `pandas.DataFrame`.

    The `pandas.DataFrame` object has a single column, with each element
    being the signal value in given physical unit.

    The column heading is a `pandas.MultiIndex` with one index
    for each of the scalar attributes and annotations.  The `index`
    is the time.

    Parameters
    ----------

    analogsignal : neo AnalogSignal
                 The AnalogSignal to convert.
    parents : bool, optional
              Also include attributes and annotations from parent neo
              objects (if any).
    child_first : bool, optional
                  If True (default True), values of child attributes are used
                  over parent attributes in the event of a name conflict.
                  If False, parent attributes are used.
                  This parameter does nothing if `parents` is False.

    Returns
    -------

    pandas DataFrame
        A DataFrame containing the signal values from `analog_signal`.

    Notes
    -----

    The index name is `time`.

    Attributes that contain non-scalar values are skipped.  So are
    annotations or attributes containing a value of `None`.

    `quantity.Quantities` types are incompatible with `pandas`, so attributes
    and annotations of that type are converted to a tuple where the first
    element is the scalar value and the second is the string representation of
    the units.

    """
    attrs = _extract_neo_attrs_safe(analogsignal,
                                    parents=parents, child_first=child_first)
    if 'units' not in attrs:
        attrs['units'] = _convert_value_safe(analogsignal.units)
    names, indexes = zip(*sorted(attrs.items()))
    names = list(names)
    names.append('channels')
    n_times = analogsignal.shape[0]
    n_channels = analogsignal.shape[1]

    col_attr = [[indexes[i] for _ in range(n_channels)] for i in range(len(indexes))]
    col_attr.append([f'ch{i}' for i in range(n_channels)])
    columns = pd.MultiIndex.from_arrays(col_attr, names=names)

    index = pd.Index(analogsignal.times, name='Time')

    pdobj = pd.DataFrame(analogsignal.magnitude, index=index, columns=columns)

    return _sort_inds(pdobj, axis=1)


def multi_analogsignals_to_dataframe(container, parents=True, child_first=True):
    """Convert one or more `neo.AnalogSignal` objects to a `pandas.DataFrame`.

    The objects can be any list, dict, or other iterable or mapping containing
    analogsignals, as well as any neo object that can hold analogsignals:
    `neo.Block`, `neo.ChannelIndex`, `neo.Unit`, and `neo.Segment`.
    Objects are searched recursively, so the objects can be nested (such as a
    list of blocks).

    The `pandas.DataFrame` object has one column for each analogsignal, with each
    element being the signal value in given physical unit.
    Columns are padded to the same length with `NaN` values.

    The column heading is a `pandas.MultiIndex` with one index
    for each of the scalar attributes and annotations of the respective
    analogsignal.  The `index` is the time.

    Parameters
    ----------

    container : list, tuple, iterable, dict,
                neo Block, neo Segment, neo Unit, neo ChannelIndex
                The container for the analogsignals to convert.
    parents : bool, optional
              Also include attributes and annotations from parent neo
              objects (if any).
    child_first : bool, optional
                  If True (default True), values of child attributes are used
                  over parent attributes in the event of a name conflict.
                  If False, parent attributes are used.
                  This parameter does nothing if `parents` is False.

    Returns
    -------

    pandas DataFrame
        A DataFrame containing the spike times from `container`.

    Notes
    -----

    The index name is `time`.

    Attributes that contain non-scalar values are skipped.  So are
    annotations or attributes containing a value of `None`.

    `quantity.Quantities` types are incompatible with `pandas`, so attributes
    and annotations of that type are converted to a tuple where the first
    element is the scalar value and the second is the string representation of
    the units.

    """
    return _multi_objs_to_dataframe(container,
                                    analogsignal_to_dataframe,
                                    get_all_analogsignals,
                                    parents=parents, child_first=child_first)


def get_all_analogsignals(container):
    """
    Get all `neo.AnalogSignal` objects from a container.

    The objects can be any list, dict, or other iterable or mapping containing
    analogsignals, as well as any Neo object that can hold analogsignals:
    `neo.Block`, `neo.ChannelIndex`, `neo.Unit`, and `neo.Segment`.

    Containers are searched recursively, so the objects can be nested
    (such as a list of blocks).

    Parameters
    ----------
    container : list, tuple, iterable, dict, neo.Block, neo.Segment, neo.Unit,
        neo.ChannelIndex
        The container for the analogsignals.

    Returns
    -------
    list
        A list of the unique `neo.AnalogSignal` objects in `container`.

    """
    return _get_all_objs(container, 'AnalogSignal')
