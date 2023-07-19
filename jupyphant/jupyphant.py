# XXX: In general this is bad practice but might be useful for this exact usecase
# Importing main namespace in order to be able to access objects created in
# JupyterLab Python kernel
# TODO: move all imports inside the class
import __main__
import time

import joblib
import matplotlib.pyplot as plt
import numpy as np
from elephant.pandas_bridge import multi_spiketrains_to_dataframe, multi_events_to_dataframe, multi_epochs_to_dataframe
from jupyphant.pandas_bridge import multi_analogsignals_to_dataframe

# neo abbreviations and font-awesome icons
# TODO: maybe create own icons or use more accurate ones from newer fontawesome version (see suggestions in comments)
NEO_ABBREVIATIONS = {"Block": {"abbr": "BLK", "icon": "cube"},  # folder-grid
                     "Segment": {"abbr": "SEG", "icon": "columns"},  # grid-divider
                     "Group": {"abbr": "GRP", "icon": "object-group"},  # chart-tree-map
                     "ChannelView": {"abbr": "CHV", "icon": "eye"},
                     "IrregularlySampledSignal": {"abbr": "ISS", "icon": "wave-square"},
                     "AnalogSignal": {"abbr": "ASG", "icon": "water"},  # waveform
                     "SpikeTrain": {"abbr": "SPT", "icon": "braille"},
                     "SpikeTrainList": {"abbr": "SPL", "icon": "bars"},  # barcode-scan
                     "Epoch": {"abbr": "EPC", "icon": "hourglass"},  # timeline , ruler-horizontal
                     "Event": {"abbr": "EVT", "icon": "map-marker"},  # location-dot
                     "ImageSequence": {"abbr": "ISQ", "icon": "images"},
                     "RegionOfInterest": {"abbr": "ROI", "icon": "map"},
                     "CircularRegionOfInterest": {"abbr": "CRI", "icon": "circle"},
                     "PolygonRegionOfInterest": {"abbr": "PRI", "icon": "draw-polygon"},
                     "RectangularRegionOfInterest": {"abbr": "RRI", "icon": "square"},
                     # python built-in containters
                     "list": {"abbr": "PYL", "icon": "list"}
                     }


class Jupyphant:
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
    plot_instantaneous_rates_colormesh = staticmethod(plot_instantaneous_rates_colormesh)
    plot_corrcoef = staticmethod(plot_corrcoef)
    import matplotlib.pyplot as plt
    # Widgets used for display
    from ipywidgets import Output
    # ipytree provides a tree structure widget
    # Used to display the Neo object hierarchy
    from ipytree import Tree, Node

    def __init__(self):
        """   # TODO: rewrite docstring
        Constructor of JupyphantVisualization
        Called upon activation of the extension.
        Initializes some persistent variables that store references to the current neo objects
        and plots.
        They are used to check for changes in neo objects and to display the current structure.
        """
        self.neo_objs_and_lists_of_neo_objs_with_var_name = {}
        self.neo_objs_changed_after_update = False
        # Plots are saved in order not to require recreation at every cell execution
        self.spiketrain_overview = None
        self.spiketrains_hash = None
        self.analogsignal_overview = None
        self.analogsignals_hash = None
        self.ipytree_of_neo_objects = None
        self.map_ipytree_node_id_to_neo_obj_hash = {}

    def update(self):
        """  # TODO: rewrite docstring
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        neo_objs_hash_before_update = joblib.hash(list(self.neo_objs_and_lists_of_neo_objs_with_var_name.values()),
                                                  hash_name='sha1')

        # Get ALL variables in current kernel namespace
        all_variable_names_in_current_kernel_namespace = self.nsm.who_ls()
        print(f"all_variable_names_in_current_kernel_namespace = {all_variable_names_in_current_kernel_namespace}")
        for variable_name in all_variable_names_in_current_kernel_namespace:
            # Access objects created within the notebook
            # XXX Importing __main__ is in general considered bad practice
            # However here the explicit goal is to have access to
            # the surrounding namespace and working with it, thus making this necessary
            # TODO: It could be possible to just create the class in the same namespace
            # I.e. no imports, by running this code directly inside the notebook
            # This requires to have this whole file as a string in the TypeScript code
            # Objects are accessed using their name returned by who_ls() and the dict
            obj_from_kernel_ns = __main__.__dict__[variable_name]
            # Select only neo objects and SpikeTrainLists / lists with neo objects
            is_BaseNeo_instance = isinstance(obj_from_kernel_ns, self.BaseNeo)
            is_RegionOfInterest_subclass = issubclass(type(obj_from_kernel_ns), self.RegionOfInterest)
            is_list_with_neo_objs = \
                isinstance(obj_from_kernel_ns, (list, self.SpikeTrainList)) and \
                (any(isinstance(obj_from_kernel_ns[i], self.BaseNeo) for i in range(len(obj_from_kernel_ns))) or
                 any(isinstance(obj_from_kernel_ns[i], self.SpikeTrainList) for i in range(len(obj_from_kernel_ns))))
            if is_BaseNeo_instance or is_RegionOfInterest_subclass or is_list_with_neo_objs:
                self.neo_objs_and_lists_of_neo_objs_with_var_name[variable_name] = obj_from_kernel_ns

        print(f"self.neo_objs_and_lists_of_neo_objs_with_var_name = {self.neo_objs_and_lists_of_neo_objs_with_var_name}")
        neo_objs_hash_after_update = joblib.hash(list(self.neo_objs_and_lists_of_neo_objs_with_var_name.values()),
                                                 hash_name='sha1')

        if neo_objs_hash_before_update != neo_objs_hash_after_update:
            self.neo_objs_changed_after_update = True

    def update_tree(self):
        """  # TODO: rewrite docstring
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = time.time()
        
        # Update all neo objects
        self.update()
        print(f"After update of all neo objects: {time.time() - start}")
        
        # Currently the tree is created from scratch every time
        # TODO: Reuse the existing tree if there is one
        if self.ipytree_of_neo_objects is not None or True:
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
                hash_neo_obj = joblib.hash(neo_obj, hash_name='sha1')
                if hasattr(neo_obj, 'name'):
                    node_neo_obj = self.Node(f"{NEO_ABBREVIATIONS[neo_obj.__class__.__name__]['abbr']}::{neo_obj.name}::{hash_neo_obj}")
                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                else:
                    node_neo_obj = self.Node(f"{NEO_ABBREVIATIONS[neo_obj.__class__.__name__]['abbr']}::{hash_neo_obj}")
                node_neo_obj.icon = NEO_ABBREVIATIONS[neo_obj.__class__.__name__]['icon']
                node_neo_obj.open_icon_style = 'success'
                node_neo_obj.close_icon_style = 'danger'
                node_neo_obj.opened = False
                self._add_sub_nodes(node_neo_obj, neo_obj)
                nodes.append(node_neo_obj)
                self.map_ipytree_node_id_to_neo_obj_hash[node_neo_obj._id] = hash_neo_obj
            print(f"After Blocks: {time.time() - start}")
            # print(f"Nodes After Blocks: {nodes}")

            print(f"After Independent: {time.time() - start}")
            # print(f"Nodes After Independent: {nodes}")

            print(f"Calculation finished: {time.time() - start}")
            import sys
            sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.ipytree_of_neo_objects.nodes = nodes
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
        """  # TODO: rewrite docstring
        # print(f"parent: {parent}, obj: {obj}")
        if issubclass(type(obj), (self.BaseNeo, self.RegionOfInterest)):
            # iterate over object attributes and create nodes recursively
            for attr_name, attr_value in obj.__dict__.items():
                if isinstance(attr_value, (list, self.SpikeTrainList)):
                    attr_value_hash = joblib.hash(attr_value, hash_name='sha1')
                    attr_node = self.Node(f"{NEO_ABBREVIATIONS[attr_value.__class__.__name__]['abbr']}::{attr_name}::{attr_value_hash}")
                    attr_node.icon = NEO_ABBREVIATIONS[attr_value.__class__.__name__]['icon']
                    attr_node.open_icon_style = 'success'
                    attr_node.close_icon_style = 'danger'
                    attr_node.opened = False
                    self.map_ipytree_node_id_to_neo_obj_hash[attr_node._id] = attr_value_hash
                    self._add_sub_nodes(attr_node, attr_value)
                    parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, (list, self.SpikeTrainList)):
            for i, child_obj in enumerate(obj):
                child_obj_hash = joblib.hash(child_obj, hash_name='sha1')
                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                if hasattr(child_obj, 'name'):
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[child_obj.__class__.__name__]['abbr']}#{i}::{child_obj.name}::{child_obj_hash}")
                else:
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[child_obj.__class__.__name__]['abbr']}#{i}::{child_obj_hash}")
                child_node.icon = NEO_ABBREVIATIONS[child_obj.__class__.__name__]['icon']
                child_node.open_icon_style = 'success'
                child_node.close_icon_style = 'danger'
                child_node.opened = False
                self.map_ipytree_node_id_to_neo_obj_hash[child_node._id] = child_obj_hash
                self._add_sub_nodes(child_node, child_obj)
                parent.add_node(child_node)
        else:
            raise TypeError(f"unsupported class/type: {type(obj)}")

    def create_tree(self):
        """
        Initialize the tree

        """  # TODO: rewrite docstring
        self.ipytree_of_neo_objects = None
        # Alternating dark and light stripes for better better visibility
        self.ipytree_of_neo_objects = self.Tree()
        self.ipytree_of_neo_objects.stripes = True
        return self.ipytree_of_neo_objects

    def selected_nodes_to_dataframes(self, selected_ids=None):
        """
        Convert the selected tree nodes representing neo objects to 'pandas.DataFrame' objects.

        """
        analogsignals = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                            neo_class=self.AnalogSignal)
        spiketrains = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                          neo_class=self.SpikeTrain)
        events = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                     neo_class=self.Event)
        epochs = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
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
        spiketrains = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
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
        spiketrains = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                          neo_class=self.SpikeTrain)
        # compare contents of AnalogSignals per top node
        spiketrains_unchanged = True
        spiketrains_hash = joblib.hash(spiketrains, hash_name='sha1')
        if self.spiketrains_hash is None:
            self.spiketrains_hash = spiketrains_hash
        else:
            if self.spiketrains_hash != spiketrains_hash:
                spiketrains_unchanged = False

        # Return pre-existing rasterplot if content of spiketrains has NOT changed
        if (spiketrains_unchanged) and (self.spiketrain_overview is not None) and (selected_ids is None) and True:
            return self.spiketrain_overview
        # Otherwise, create new plot
        else:
            n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
            if n_subplots > 0:
                fig, axs = plt.subplots(1, n_subplots, figsize=(n_subplots * 8, 4))
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
                    axs = self.rasterplot(spiketrains[top_node], axes=axs, s=0.1, title=f"{top_node}")
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
                lfp = np.divide(lfp, np.max(lfp, axis=1).reshape(len(lfp), 1))  ## TODO: causes error in Christianos example notebook of V4A data
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
        analogsignals = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                            neo_class=self.AnalogSignal)
        # compare contents of AnalogSignals per top node
        analogsignals_unchanged = True
        analogsignals_hash = joblib.hash(analogsignals, hash_name='sha1')
        if self.analogsignals_hash is None:
            self.analogsignals_hash = analogsignals_hash
        else:
            if self.analogsignals_hash != analogsignals_hash:
                analogsignals_unchanged = False

        # Return pre-existing lfpplot if content of AnalogSignals has NOT changed
        if analogsignals_unchanged and (self.analogsignal_overview is not None) and (selected_ids is None) and True:
            return self.analogsignal_overview
        # Otherwise, create new plot
        else:
            n_subplots = sum(1 for v in analogsignals.values() if len(v) > 0)
            if n_subplots > 0:
                fig, axs = plt.subplots(1, n_subplots, figsize=(n_subplots * 8, 4))
                fig.suptitle(f"Normalized LFP-Plots for {'selected' if selected_ids else 'all'} AnalogSignals in")
                # Rasterplot using viziphant
                if n_subplots > 1:
                    for i, top_node in enumerate(analogsignals.keys()):
                        if analogsignals[top_node]:
                            axs[i] = self.plot_lfp(analogsignals[top_node], times=self.np.arange(
                                len(analogsignals[top_node][0])) * self.pq.s,
                                                   title=f"{top_node}", spacing=75, axes=axs[i])
                        else:
                            axs[i].set_title(f"{top_node}")
                else:
                    top_node = list(analogsignals.keys())[0]
                    axs = self.plot_lfp(analogsignals[top_node],
                                        times=self.np.arange(len(analogsignals[top_node][0])) * self.pq.s,
                                        title=f"{top_node}", spacing=75, axes=axs)
                if selected_ids is None:
                    self.analogsignal_overview = fig
                return fig
            else:
                pass

    def _extract_selected_neo_data_objects_by_top_node(self, selected_ids=None, neo_class=None):
        collected_neo_objs = {}
        # iterate over 'neo_objs_and_lists_of_neo_objs_with_var_name' and
        # extract those neo objects that are instances of the given 'neo_class'
        for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
            if isinstance(neo_obj, neo_class):
                collected_neo_objs[f"{neo_obj.name}::{joblib.hash(neo_obj, hash_name='sha1')}"] = [neo_obj]
            elif issubclass(type(neo_obj), self.Container):
                collected_neo_objs[f"{neo_obj.name}::{joblib.hash(neo_obj, hash_name='sha1')}"] = neo_obj.list_children_by_class(neo_class)
            else:
                pass
        # keep only neo_obj which are selected, i.e. their hash ID was provided via 'selected_ids'
        if selected_ids is not None:
            for top_node in collected_neo_objs.keys():
                collected_neo_objs[top_node] = [neo_obj for neo_obj in collected_neo_objs[top_node] if
                                                joblib.hash(neo_obj, hash_name='sha1') in selected_ids]
        # remove top-nodes / neo-containers with no object of the specified neo_class
        for key in list(collected_neo_objs):
            if len(collected_neo_objs[key]) == 0:
                del collected_neo_objs[key]
        return collected_neo_objs

    def _extract_pretty_print_of_selected_neo_container_objects(self, selected_ids=None):
        from io import StringIO
        from contextlib import redirect_stdout
        from IPython.display import display

        neo_containers = []
        for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
            if issubclass(type(neo_obj), self.Container):
                if joblib.hash(neo_obj, hash_name='sha1') in selected_ids:
                    out = StringIO()
                    with redirect_stdout(out):
                        display(neo_obj)
                    neo_containers.append(out.getvalue())

                for child_container_name in neo_obj._child_containers:
                    child_container = getattr(neo_obj, child_container_name)
                    for child_obj in child_container:
                        if joblib.hash(child_obj, hash_name='sha1') in selected_ids:
                            out = StringIO()
                            with redirect_stdout(out):
                                display(child_obj)
                            neo_containers.append(out.getvalue())
            else:
                pass
        return neo_containers

    def _extract_selected_neo_objects(self, selected_ids):
        neo_objs = {}

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
