# XXX: In general this is bad practice but might be useful for this exact usecase
# Importing main namespace in order to be able to access objects created in
# JupyterLab Python kernel
import __main__
import time

import joblib
import matplotlib.pyplot as plt
import numpy as np
from elephant.pandas_bridge import multi_spiketrains_to_dataframe, multi_events_to_dataframe, multi_epochs_to_dataframe
from jupyphant.pandas_bridge import multi_analogsignals_to_dataframe

NEO_ABBREVIATIONS = {"Block": "BLK",
                     "Segment": "SEG",
                     "Group": "GRP",
                     "ChannelView": "CHV",
                     "IrregularlySampledSignal": "ISS",
                     "AnalogSignal": "ASG",
                     "SpikeTrain": "SPT",
                     "SpikeTrainList": "SPL",
                     "Epoch": "EPC",
                     "Event": "EVT",
                     "ImageSequence": "ISQ",
                     "RegionOfInterest": "ROI",
                     "CircularRegionOfInterest": "CRI",
                     "PolygonRegionOfInterest": "PRI",
                     "RectangularRegionOfInterest": "RRI",
                     }


class JupyphantVisualization:
    # All imports are hidden inside the class in order not to pollute the 
    # Python kernel's namespace used by the user of the notebook
    import json
    # Dealing with the Python kernel's namespace, e.g., 
    # listing all defined variables
    from IPython.core.magics.namespace import NamespaceMagics
    # Access to the Python kernel
    from IPython import get_ipython
    # nsm object provides access to the actual kernel's variables
    # And is used to query and manipulate them
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    # For displaying widgets
    from IPython.display import display
    # Neo classes need to be imported to work with them
    # Depending on the usage situation, import using 
    # sys.path.append might be necessary
    from neo.core.baseneo import BaseNeo
    from neo.core.container import Container
    from neo.core.regionofinterest import RegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    from neo import Block, SpikeTrain, AnalogSignal, Event, Epoch
    from neo.test.tools import assert_same_sub_schema
    assert_same_sub_schema = staticmethod(assert_same_sub_schema)
    import numpy as np
    import quantities as pq
    from elephant import statistics, kernels
    from elephant.conversion import BinnedSpikeTrain
    from elephant.spike_train_correlation import correlation_coefficient
    correlation_coefficient = staticmethod(correlation_coefficient)
    # TODO: Use new viziphant for plotting
    # This relies on the initial version of viziphant
    from viziphant.rasterplot import rasterplot
    rasterplot = staticmethod(rasterplot)
    from viziphant.statistics import plot_isi_histogram, plot_time_histogram, plot_instantaneous_rates_colormesh
    from viziphant.spike_train_correlation import plot_corrcoef
    plot_isi_histogram = staticmethod(plot_isi_histogram)
    plot_time_histogram = staticmethod(plot_time_histogram)
    plot_instantaneous_rates_colormesh =staticmethod(plot_instantaneous_rates_colormesh)
    plot_corrcoef = staticmethod(plot_corrcoef)
    import matplotlib.pyplot as plt
    # Widgets used for display
    from ipywidgets import Output
    # ipytree provides a tree structure widget
    # Used to display the Neo object hierarchy
    from ipytree import Tree, Node

    def __init__(self):
        """ 
        Constructor of JupyphantVisualization
        Called upon activation of the extension.
        Initializes some persistent variables that store references to the current neo objects
        and plots.
        They are used to check for changes in neo objects and to display the current structure.
        """
        self.blocks = []
        self.other_objs = []
        self.old_blocks = []
        self.old_other_objs = []
        # Plots are saved in order not to require recreation at every cell execution
        self.plot = None
        self.spiketrain_overview = None
        self.analogsignal_overview = None
        self.tree = None
        self.map = {}

    def update(self):
        """
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        self.old_blocks = self.blocks[:]
        self.old_other_objs = self.other_objs[:]
        # Get ALL variables in current kernel namespace
        vals = self.nsm.who_ls()
        values = {}
        for v in vals:
            # Access objects created within the notebook
            # XXX Importing __main__ is in general considered bad practice
            # However here the explicit goal is to have access to
            # the surrounding namespace and working with it, thus making this necessary
            # TODO: It could be possible to just create the class in the same namespace
            # I.e. no imports, by running this code directly inside the notebook
            # This requires to have this whole file as a string in the TypeScript code
            
            # Objects are accessed using their name returned by who_ls() and the dict
            obj = __main__.__dict__[v]
            # Select only Neo objects and lists
            if isinstance(obj, (self.BaseNeo, list)) or issubclass(type(obj), self.RegionOfInterest):
                values[v] = obj
        # Get only blocks
        self.blocks = [v for v in values.values() if isinstance(v, self.Block)]
        # Get all other objects, i.e., neo objects with references independent of a Block
        self.other_objs = [v for v in values.values() if (isinstance(v, self.BaseNeo) or issubclass(type(v), self.RegionOfInterest)) and not isinstance(v, self.Block)]
        # get lists of neo objects or mixed lists
        neo_objs_in_list = [v for v in values.values() if isinstance(v, list) and any(isinstance(v[i], self.BaseNeo) for i in range(len(v)))]
        # neo_objs_in_list = [ele for l in neo_objs_in_list for ele in l if isinstance(ele, self.BaseNeo) and not isinstance(ele, self.Block)]
        self.other_objs.extend(neo_objs_in_list)

    def update_tree(self):
        """
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = time.time()
        # Update all neo objects
        self.update()
        print(f"After Update: {time.time() - start}")
        # Currently the tree is created from scratch every time
        # TODO: Reuse the existing tree if there is one
        if self.tree is not None or True:
            print("HERE")
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for bl in self.blocks:
                bl_hash = joblib.hash(bl, hash_name='sha1')
                bl_node = self.Node(f"{NEO_ABBREVIATIONS[bl.__class__.__name__]}::{bl.name}::{bl_hash}")
                bl_node.opened = False
                self._add_sub_nodes(bl_node, bl)
                nodes.append(bl_node)
                self.map[bl_node._id] = bl_hash
            print(f"After Blocks: {time.time() - start}")
            # print(f"Nodes After Blocks: {nodes}")

            # Top-level node for every independent neo object
            for obj in self.other_objs:
                obj_hash = joblib.hash(obj, hash_name='sha1')
                if issubclass(type(obj), self.RegionOfInterest):
                    obj_node = self.Node(f"{NEO_ABBREVIATIONS[obj.__class__.__name__]}::{obj_hash} ")
                elif isinstance(obj, list):
                    obj_node = self.Node(f"{obj.__class__.__name__}::{obj_hash}")
                else:
                    obj_node = self.Node(f"{NEO_ABBREVIATIONS[obj.__class__.__name__]}::{obj.name}::{obj_hash}")
                self.map[obj_node._id] = obj_hash
                obj_node.opened = False
                self._add_sub_nodes(obj_node, obj)
                nodes.append(obj_node)

            print(f"After Independent: {time.time() - start}")
            # print(f"Nodes After Independent: {nodes}")

            print(f"Calculation finished: {time.time() - start}")
            import sys
            sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.tree.nodes = nodes
            print(f"Rendered: {time.time() - start}")
        else:
            pass

    def _add_sub_nodes(self, parent, obj):
        """
        Adding child objects of a neo container as sub nodes of the tree node 
        that corresponds to the container

        Parameters
        ----------
        parent : Node
            Parent node of ipytree
        obj : Neo container or standard python container i.e. list, dict
            Parent container object
        """
        # print(f"parent: {parent}, obj: {obj}")
        if issubclass(type(obj), (self.BaseNeo, self.RegionOfInterest)):
            # iterate over object attributes and create nodes recursively
            for attr_name, attr_value in obj.__dict__.items():
                if isinstance(attr_value, (dict, list, self.SpikeTrainList)):
                    attr_node = self.Node(attr_name)
                    self.map[attr_node._id] = None
                    attr_node.opened = False
                    self._add_sub_nodes(attr_node, attr_value)
                    parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, dict):
            for key, value in obj.items():
                sub_dict_node = self.Node(f"{key}: {value}")
                self.map[sub_dict_node._id] = None
                sub_dict_node.opened = False
                parent.add_node(sub_dict_node)
        elif isinstance(obj, (list, self.SpikeTrainList)):
            for i, child_obj in enumerate(obj):
                if issubclass(type(child_obj), self.BaseNeo):
                    child_obj_hash = joblib.hash(child_obj, hash_name='sha1')
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[child_obj.__class__.__name__]}#{i}::{child_obj.name}::{child_obj_hash}")
                    child_node.opened = False
                    self.map[child_node._id] = child_obj_hash
                    self._add_sub_nodes(child_node, child_obj)
                    parent.add_node(child_node)
                else:
                    pass
        else:
            raise TypeError(f"unsupported class/type: {type(obj)}")

    def create_tree(self):
        """
        Initialize the tree

        """
        self.tree = None
        # Alternating dark and light stripes for better better visibility
        self.tree = self.Tree()
        self.tree.stripes = True
        return self.tree

    def selected_nodes_to_dataframes(self, selected_ids=None):
        """
        Convert the selected tree nodes representing neo objects to 'pandas.DataFrame' objects.

        """
        analogsignals = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                       neo_class=self.AnalogSignal)
        spiketrains = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                     neo_class=self.SpikeTrain)
        events = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                neo_class=self.Event)
        epochs = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                neo_class=self.Epoch)
        df_anasig = []
        df_spt = []
        df_evt = []
        df_epc = []

        for i, top_node in enumerate(analogsignals.keys()):
            if analogsignals[top_node]:
                df_anasig.append(multi_analogsignals_to_dataframe(container=analogsignals[top_node], parents=False))
        for i, top_node in enumerate(spiketrains.keys()):
            if spiketrains[top_node]:
                df_spt.append(multi_spiketrains_to_dataframe(container=spiketrains[top_node], parents=False))
        for i, top_node in enumerate(events.keys()):
            if events[top_node]:
                df_evt.append(multi_events_to_dataframe(container=events[top_node], parents=False))
        for i, top_node in enumerate(epochs.keys()):
            if epochs[top_node]:
                df_epc.append(multi_epochs_to_dataframe(container=epochs[top_node], parents=False))

        return df_anasig, df_spt, df_evt, df_epc

    def statistics_of_selected_nodes(self, selected_ids=None):
        spiketrains = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                     neo_class=self.SpikeTrain)
        n_st_statistics = 4  # ISI, time-histogram, IFR, correlation
        n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
        if n_subplots > 0:
            fig, axs = plt.subplots(n_subplots, n_st_statistics, figsize=(n_st_statistics * 8, n_subplots * 4),
                                    squeeze=False)
            fig.suptitle(f"Basic statistics for {'selected' if selected_ids else 'all'} SpikeTrains in Top-Nodes")
            for i, top_node in enumerate(spiketrains.keys()):
                if spiketrains[top_node]:
                    # plot ISI
                    axs[i, 0] = self.plot_isi_histogram(spiketrains=spiketrains[top_node], axes=axs[i, 0],
                                                        title=f"ISI-distribution:\n {top_node}")
                    # plot time histogram
                    time_histogram = self.statistics.time_histogram(spiketrains[top_node], bin_size=0.1 * self.pq.s,
                                                                    output='rate')
                    axs[i, 1] = self.plot_time_histogram(histogram=time_histogram, axes=axs[i, 1])
                    axs[i, 1].set_title(f"Time-histogram:\n {top_node}")
                    # plot IFR
                    kernel = self.kernels.GaussianKernel(sigma=100 * self.pq.ms)
                    rates = self.statistics.instantaneous_rate(spiketrains[top_node], sampling_period=10 * self.pq.ms,
                                                               kernel=kernel)
                    axs[i, 2] = self.plot_instantaneous_rates_colormesh(rates, axes=axs[i, 2])
                    axs[i, 2].set_title(f"IFR:\n {top_node}")
                    # plot correlation
                    if len(spiketrains[top_node]) > 1:
                        binned_spiketrains = self.BinnedSpikeTrain(spiketrains[top_node], bin_size=100 * self.pq.ms)
                        corrcoef_matrix = self.correlation_coefficient(binned_spiketrains)
                        axs[i, 3] = self.plot_corrcoef(corrcoef_matrix, axes=axs[i, 3])
                        axs[i, 3].set_xlabel('Neuron')
                        axs[i, 3].set_ylabel('Neuron')
                        axs[i, 3].set_title(f"Correlation coefficient matrix:\n {top_node}")
                    else:
                        axs[i, 0].set_title(f"ISI-distribution:\n {top_node}")
                        axs[i, 1].set_title(f"Time-histogram:\n {top_node}")
                        axs[i, 2].set_title(f"IFR:\n {top_node}")
                        axs[i, 3].set_xlabel('Neuron')
                        axs[i, 3].set_ylabel('Neuron')
                        axs[i, 3].set_title(f"Correlation coefficient matrix:\n {top_node}")
            fig.tight_layout(pad=1.0)
            return fig
        else:
            return None

    def create_rasterplot(self, selected_ids=None):
        """
        Create for each top-node a rasterplot for the contained spike trains.

        Called at every cell execution
        """
        old_spiketrains = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                         neo_class=self.SpikeTrain, updated=False)
        new_spiketrains = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                         neo_class=self.SpikeTrain)
        # compare contents of spiketrains per top node
        spiketrains_changed = False
        if old_spiketrains != new_spiketrains:
            spiketrains_changed = True

        # Return pre-existing rasterplot if content of spiketrains has NOT changed
        if (not spiketrains_changed) and (self.spiketrain_overview is not None) and (selected_ids is None) and True:
            return self.spiketrain_overview
        # Otherwise, create new plot
        else:
            # Extract all spike trains
            spiketrains = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids,
                                                                         neo_class=self.SpikeTrain)

            n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
            if n_subplots > 0:
                fig, axs = plt.subplots(1, n_subplots, figsize=(n_subplots*8, 4))
                fig.suptitle(f"Rasterplot for {'selected' if selected_ids else 'all'} SpikeTrains in")
                # Rasterplot using viziphant
                if n_subplots > 1:
                    for i, top_node in enumerate(spiketrains.keys()):
                        if spiketrains[top_node]:
                            axs[i] = self.rasterplot(spiketrains[top_node], axes=axs[i], s=0.1, title=f"{top_node}")
                        else:
                            axs[i].set_title(f"{top_node}")
                else:
                    top_node = list(spiketrains.keys())[0]
                    axs = self.rasterplot(spiketrains[top_node], axes=axs, s=0.1,  title=f"{top_node}")
                if selected_ids is None:
                    self.spiketrain_overview = fig
                return fig
            else:
                pass

    # Pre-existing routine for plotting AnalogSignals, developed by Robin Gutzen
    def plot_lfp(self, lfps, times, title=None, spacing=5, color=None, axes=None):
        """
        Plot LFPs.

        lfps:       LFP signals with trial_id as first dimension and sample_id as second dimension.
                    LFP signals must be arranged according to trial ID.
        times:      time stamps of the recorded LFP samples. Must be of same length as second dimenion of lfps
        title:      title of the figure
        spacing:    vertical spacing between two LFP signals
        color:      color to used for plotting
        axes :      matplotlib.axes.Axes or None, optional
                    Matplotlib axes handle. If None, new axes are created and returned.
                    Default: None
        """

        if axes is None:
            fig, axes = plt.subplots(nrows=1, ncols=1)

        # Plots lfp signals for each trial
        for trial_id, lfp in enumerate(lfps):
            # plot each channel
            if np.shape(lfp)[1] != 1:
                # transpose to get values per channel
                lfp = np.transpose(lfp)
                # normalize by maximum
                lfp = np.divide(lfp, np.max(lfp, axis=1).reshape(len(lfp), 1))
                for ch in lfp:
                    axes.plot(times, ch, color=color)
            else:
                axes.plot(times, lfp.magnitude / np.max(lfp.magnitude), color=color)

        axes.set_title(title)
        # Defines plot parameters for x-axis
        axes.set_xlabel('Time ({0})'.format(times.dimensionality))

        # Defines plot parameters for y-axis
        axes.set_ylabel(f'AnaSig ({lfps[0][0].units.__str__()})')

        return axes

    def create_lfpplot(self, selected_ids=None):
        """
        Wrapper for plot_lfp to update the lfp plot

        Called at every cell execution
        """
        # Extract all AnalogSignals
        anasigs = self._extract_selected_neo_objects_by_top_node(selected_ids=selected_ids, neo_class=self.AnalogSignal)

        n_subplots = sum(1 for v in anasigs.values() if len(v) > 0)
        if n_subplots > 0:
            fig, axs = plt.subplots(1, n_subplots, figsize=(n_subplots * 8, 4))
            fig.suptitle(f"Normalized LFP-Plots for {'selected' if selected_ids else 'all'} AnalogSignals in")
            # Rasterplot using viziphant
            if n_subplots > 1:
                for i, top_node in enumerate(anasigs.keys()):
                    if anasigs[top_node]:
                        axs[i] = self.plot_lfp(anasigs[top_node], times=self.np.arange(len(anasigs[top_node][0])) * self.pq.s,
                                               title=f"{top_node}", spacing=75, axes=axs[i])
                    else:
                        axs[i].set_title(f"{top_node}")
            else:
                top_node = list(anasigs.keys())[0]
                axs = self.plot_lfp(anasigs[top_node], times=self.np.arange(len(anasigs[top_node][0])) * self.pq.s,
                                    title=f"{top_node}", spacing=75, axes=axs)
            if selected_ids is None:
                self.analogsignal_overview = fig
            return fig
        else:
            pass

    def _extract_selected_neo_objects_by_top_node(self, selected_ids=None, neo_class=None, updated=True):
        neo_objs = {}
        # iterate/extract form blocks
        for bl in self.blocks if updated else self.old_blocks:
            neo_objs[f"{bl.name}::{joblib.hash(bl, hash_name='sha1')}"] = bl.list_children_by_class(neo_class)
        # iterate/extract form other_objs
        for obj in self.other_objs if updated else self.old_other_objs:
            if isinstance(obj, neo_class):
                neo_objs[f"{obj.name}::{joblib.hash(obj, hash_name='sha1')}"] = [obj]
            elif issubclass(type(obj), self.Container):
                neo_objs[f"{obj.name}::{joblib.hash(obj, hash_name='sha1')}"] = obj.list_children_by_class(neo_class)
            else:
                pass
        # keep neo_obj which are selected
        if selected_ids is not None:
            for top_node in neo_objs.keys():
                neo_objs[top_node] = [neo_obj for neo_obj in neo_objs[top_node] if joblib.hash(neo_obj, hash_name='sha1') in selected_ids]
        # remove top-nodes with no object of the specified neo_class
        for key in list(neo_objs):
            if len(neo_objs[key]) == 0:
                del neo_objs[key]
        return neo_objs

    def testfunc(self):
        """
        Debugging function that lists all Neo objects and returns them as a JSON string
        Lists independent neo objects and blocks with all their segments and analogsignals
        """
        # List namespace
        vals = self.nsm.who_ls()
        # Extract neo objects
        values = [v for v in vals if
                  isinstance(__main__.__dict__[v], (self.BaseNeo, list))]  # in ['Block', 'Segment', 'ChannelIndex',
        for value in list(values):
            # Get variables corresponding to the names
            val = __main__.__dict__[value]
            # Remove lists of non-neo objects
            if isinstance(val, list):
                if len(val) > 0 and isinstance(val[0], self.BaseNeo):
                    pass
                else:
                    values.remove(value)
            # Add enumeration of all Segments and AnalogSignals of blocks to the list of strings
            if isinstance(val, self.Block):
                for i, seg in enumerate(val.list_children_by_class("Segment")):
                    # globals()[''.join(['blchidx', str(i)])] = chidx
                    values.append(''.join([value, '.segmets[', str(i), ']']))
                    for j, sig in enumerate(seg.analogsignals):
                        # pass
                        values.append(''.join([values[-1 - j], '.analogsigs[', str(j), ']']))

        return self.json.dumps(values)
