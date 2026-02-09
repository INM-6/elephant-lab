# XXX: In general this is bad practice but might be useful for this exact usecase
# Importing main namespace in order to be able to access objects created in
# JupyterLab Python kernel
# TODO: move all imports inside the class
import __main__
import time

import joblib

from .PlotlyGraphFigure import PlotlyGraphFigure
from .PlotlyGraphDataTypes import *

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import neo

# neo abbreviations and font-awesome icons
# TODO: maybe create own icons or use more accurate ones from newer fontawesome version (see suggestions in comments)
NEO_ABBREVIATIONS = {"Block": {"abbr": "", "icon": "cube"},  # folder-grid
                     "Segment": {"abbr": "", "icon": "columns"},  # grid-divider
                     "Group": {"abbr": "", "icon": "object-group"},  # chart-tree-map
                     "ChannelView": {"abbr": "", "icon": "eye"},
                     "IrregularlySampledSignal": {"abbr": "", "icon": "wave-square"},
                     "AnalogSignal": {"abbr": "", "icon": "water"},  # waveform
                     "SpikeTrain": {"abbr": "", "icon": "braille"},
                     "SpikeTrainList": {"abbr": "", "icon": "bars"},  # barcode-scan
                     "Epoch": {"abbr": "", "icon": "hourglass"},  # timeline , ruler-horizontal
                     "Event": {"abbr": "", "icon": "map-marker"},  # location-dot
                     "ImageSequence": {"abbr": "", "icon": "images"},
                     "RegionOfInterest": {"abbr": "", "icon": "map"},
                     "CircularRegionOfInterest": {"abbr": "", "icon": "circle"},
                     "PolygonRegionOfInterest": {"abbr": "", "icon": "draw-polygon"},
                     "RectangularRegionOfInterest": {"abbr": "", "icon": "square"},
                     # python built-in containters
                     "list": {"abbr": "", "icon": "list"}
                     }

STRING_TO_NEO_OBJ = {
    "spiketrain": neo.SpikeTrain, 
    "analogsignal": neo.AnalogSignal, 
    "block": neo.Block, 
    "segment": neo.Segment, 
    "epoch": neo.Epoch, 
    "channelview": neo.ChannelView, 
    "group": neo.Group,
    "irregularlysampledsignal": neo.IrregularlySampledSignal,
    "event": neo.Event,
    "imagesequence": neo.ImageSequence,
    "circularregionofinterest": neo.CircularRegionOfInterest,
    "polygonregionofinterest": neo.PolygonRegionOfInterest,
    "rectangularregionofinterest": neo.RectangularRegionOfInterest
}
NEO_OBJS_TO_SHOW = [
    neo.AnalogSignal, 
    neo.SpikeTrain, 
    neo.Block, 
    neo.Segment, 
    neo.Epoch, 
    neo.ChannelView,
    neo.Group,
    neo.IrregularlySampledSignal,
    neo.Event,
    neo.ImageSequence,
    neo.CircularRegionOfInterest,
    neo.PolygonRegionOfInterest,
    neo.RectangularRegionOfInterest
]
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
    from neo.core.regionofinterest import RegionOfInterest, CircularRegionOfInterest, RectangularRegionOfInterest, \
        PolygonRegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    from neo import Block, SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal
    from collections import Counter
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
    # Widgets used for display
    from ipywidgets import Output
    # ipytree provides a tree structure widget
    # Used to display the Neo object hierarchy
    from ipytree import Tree, Node
    from enum import Enum

    class PlotKey(Enum):
        RAW_ST = 'raw_st'
        RAW_ANASIG = 'raw_anasig'

    class SimpleEvent:
        def __init__(self):
            self._listeners = []

        def add_listener(self, fn):
            """Register a callback function."""
            self._listeners.append(fn)

        def remove_listener(self, fn):
            """Unregister a callback function."""
            self._listeners.remove(fn)

        def fire(self):
            """Call all registered callbacks."""
            for fn in self._listeners:
                fn()

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
        self.signal_overview = None
        self.analogsignals_hash = None
        self.irregularsignals_hash = None
        self.ipytree_of_neo_objects = None
        self.selected_neo_objects = set()
        self.on_selected_neo_objects_changed = self.SimpleEvent()
        self.map_ipytree_node_id_to_neo_obj_hash = {}
        self.map_neo_obj_hash_to_neo_obj = {}
        self.filter_changed = False
        self.expand_all = False
        self.jupyterlab_theme = 'plotly_dark'
        self.plots = {}
        for key in self.PlotKey:
            self.plots[key] = {
                "fig": None,
                "overlapping": False,
                "x_range": None
            }

    def names_for(self, obj):
        for key, value in self.neo_objs_and_lists_of_neo_objs_with_var_name.items():
            if obj is value:
                return key
        return ""
    
    def expand_neo_tree(self, opened):
        self.expand_all = opened
        self.filter_changed = True
        self.update_tree()
    
    def show_neo_obj(self, neo_obj_string):
        neo_obj_type = STRING_TO_NEO_OBJ[neo_obj_string]
        if neo_obj_type in NEO_OBJS_TO_SHOW:
            NEO_OBJS_TO_SHOW.remove(neo_obj_type)
        else:
            NEO_OBJS_TO_SHOW.append(neo_obj_type)
        self.filter_changed = True
        
    def get_neo_hash(self, neo_obj, hash_name="sha1"):
        """
        Creates a hash value for neo objects, 
        taking into account the data, units and metadata.
        """
        if isinstance(neo_obj, neo.AnalogSignal):
            hashable_summary = (
                neo_obj.magnitude,
                str(neo_obj.units),
                float(neo_obj.sampling_rate),
                str(neo_obj.sampling_rate),
                float(neo_obj.t_start)
            )
            return joblib.hash(hashable_summary, hash_name=hash_name)
        
        elif isinstance(neo_obj, neo.IrregularlySampledSignal):
            hashable_summary = (
                neo_obj.magnitude,
                str(neo_obj.units),
                float(neo_obj.t_start)
            )
            return joblib.hash(hashable_summary, hash_name=hash_name)
        
        elif isinstance(neo_obj, neo.SpikeTrain):
            hashable_summary = (
                neo_obj.times,
                str(neo_obj.units),
                float(neo_obj.t_start),
                float(neo_obj.t_stop)
            )
            return joblib.hash(hashable_summary, hash_name=hash_name)

        elif isinstance(neo_obj, (neo.Epoch, neo.Event)):
            hashable_summary = (
                neo_obj.times,
                neo_obj.labels,
                str(neo_obj.units)
            )
            return joblib.hash(hashable_summary, hash_name=hash_name)
        
        elif isinstance(neo_obj, (neo.Block, neo.Segment)):
            hashable_summary = (
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            )
            return joblib.hash(hashable_summary, hash_name=hash_name)
            
        return joblib.hash(neo_obj, hash_name)
        
    def update(self):
        """  # TODO: rewrite docstring
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        neo_objs_hash_before_update = self.get_neo_hash(list(self.neo_objs_and_lists_of_neo_objs_with_var_name.values()),
                                                  hash_name='sha1')

        # Get ALL variables in current kernel namespace
        all_variable_names_in_current_kernel_namespace = self.nsm.who_ls()
        print(f"all_variable_names_in_current_kernel_namespace = {all_variable_names_in_current_kernel_namespace}")
        for variable_name in all_variable_names_in_current_kernel_namespace:
            if variable_name.startswith("jupyphant"):
                continue
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
        neo_objs_hash_after_update = self.get_neo_hash(list(self.neo_objs_and_lists_of_neo_objs_with_var_name.values()),
                                                 hash_name='sha1')

        if neo_objs_hash_before_update != neo_objs_hash_after_update or self.filter_changed:
            self.neo_objs_changed_after_update = True
        else:
            self.neo_objs_changed_after_update = False
        self.filter_changed = False

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
        
        if self.ipytree_of_neo_objects is not None and self.neo_objs_changed_after_update:
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
                if type(neo_obj) not in NEO_OBJS_TO_SHOW:
                    continue
                if hasattr(neo_obj, 'block') and neo_obj.block is not None:
                    continue
                if hasattr(neo_obj, 'segment') and neo_obj.segment is not None:
                    continue
                hash_neo_obj = self.get_neo_hash(neo_obj, hash_name='sha1')
                self.map_neo_obj_hash_to_neo_obj[hash_neo_obj] = neo_obj
                class_name = neo_obj.__class__.__name__
                
                if hasattr(neo_obj, 'name') and neo_obj.name:
                    node_neo_obj = self.Node(f"{NEO_ABBREVIATIONS[class_name]['abbr']} {neo_obj.name} :: [{hash_neo_obj[:5]}]")
                    if neo_obj.name.lower() == "block":
                        node_neo_obj.opened = self.expand_all or (len(neo_obj.segments) < 5)
                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                else:
                    node_neo_obj = self.Node(f"{NEO_ABBREVIATIONS[class_name]['abbr']} {self.names_for(neo_obj)} [{hash_neo_obj[:5]}]")
                    node_neo_obj.opened = True
                node_neo_obj.metadata = {"data-neo-object": "true"}
                node_neo_obj.icon = NEO_ABBREVIATIONS[class_name]['icon']
                node_neo_obj.open_icon_style = 'success'
                node_neo_obj.close_icon_style = 'danger'
                self._add_sub_nodes(node_neo_obj, neo_obj)
                if any(node.name == node_neo_obj.name for node in nodes):
                    continue
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
        NEO_CONTAINER_ATTRIBUTES = [
            'segments', 'analogsignals', 'spiketrains', 'events', 
            'epochs', 'channel_indexes', 'irregularlysampledsignals', 'imagesequences'
        ]
        if issubclass(type(obj), (self.BaseNeo, self.RegionOfInterest)):
            # iterate over object attributes and create nodes recursively

            for attr_name in NEO_CONTAINER_ATTRIBUTES:
                if hasattr(obj, attr_name):
                    attr_value_list = getattr(obj, attr_name)
                    try:
                        if STRING_TO_NEO_OBJ[str(attr_name[:-1].lower())] not in NEO_OBJS_TO_SHOW:
                            continue
                    except KeyError:
                        pass
                    if attr_value_list is not None and len(attr_value_list) > 0:
                        attr_value_hash = self.get_neo_hash(attr_value_list, hash_name='sha1')
                        self.map_neo_obj_hash_to_neo_obj[attr_value_hash] = attr_value_list                
                        attr_node = self.Node(f"{attr_name.capitalize()} [{len(attr_value_list)}] :: [{attr_value_hash[:5]}]")
                        attr_node.opened = self.expand_all or (len(attr_value_list) < 5)
                        attr_node.icon = 'folder' 
                        attr_node.metadata = {"data-neo-object": "true", "container-for": attr_name}
                        attr_node.open_icon_style = 'success'
                        attr_node.close_icon_style = 'danger'
                        self.map_ipytree_node_id_to_neo_obj_hash[attr_node._id] = attr_value_hash
                        
                        self._add_sub_nodes(attr_node, attr_value_list)

                        parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, (list, self.SpikeTrainList)) or obj.__class__.__name__ == 'ObjectList':
            
            for i, child_obj in enumerate(obj):
                if type(child_obj) not in NEO_OBJS_TO_SHOW:
                    continue
                child_obj_hash = self.get_neo_hash(child_obj, hash_name='sha1')
                self.map_neo_obj_hash_to_neo_obj[child_obj_hash] = child_obj
                
                class_name = child_obj.__class__.__name__
                if class_name not in NEO_ABBREVIATIONS:
                    class_name = 'list' if isinstance(child_obj, list) else 'SpikeTrainList'
                    if class_name not in NEO_ABBREVIATIONS:
                         class_name = 'Block'
                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                if hasattr(child_obj, 'name') and child_obj.name:
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[class_name]['abbr']} {self.names_for(child_obj)} #{i} :: {child_obj.name}::[{child_obj_hash[:5]}]")
                else:
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[class_name]['abbr']} {self.names_for(child_obj)} #{i} :: [{child_obj_hash[:5]}]")
                
                child_node.metadata = {"data-neo-object": "true"}
                child_node.icon = NEO_ABBREVIATIONS[class_name]['icon']
                child_node.open_icon_style = 'success'
                child_node.close_icon_style = 'danger'
                child_node.data = {"neo_id": id(obj), "neo_type": type(obj).__name__}
                self.map_ipytree_node_id_to_neo_obj_hash[child_node._id] = child_obj_hash
                self._add_sub_nodes(child_node, child_obj)
                child_node.opened = self.expand_all or (len(parent.nodes) < 5) 
                parent.add_node(child_node)
        
        elif obj is None or isinstance(obj, (str, int, float, bool, dict)):
            pass
        
        else:
            print(f"Warning: unsupported class/type for recursion: {type(obj)}")

    def create_tree(self):
        """
        Initialize the tree

        """  # TODO: rewrite docstring
        self.ipytree_of_neo_objects = None
        # Alternating dark and light stripes for better better visibility
        self.ipytree_of_neo_objects = self.Tree()
        self.ipytree_of_neo_objects.stripes = True
        return self.ipytree_of_neo_objects

    def statistics_of_selected_nodes(self, selected_ids=None):
        spiketrains = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                          neo_class=self.SpikeTrain)
        n_st_statistics = 4  # ISI, time-histogram, IFR, correlation
        n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
        if n_subplots > 0:
            
            subplot_titles = []
            for top_node in spiketrains.keys():
                if spiketrains[top_node]:
                    subplot_titles.extend([f"ISI-distribution: {top_node}", f"Time-histogram: {top_node}", f"IFR: {top_node}", f"Correlation: {top_node}"])

            fig = make_subplots(rows=n_subplots, cols=n_st_statistics, subplot_titles=subplot_titles)
            fig.update_layout(title_text=f"Basic statistics for {'selected' if selected_ids else 'all'} SpikeTrains in Top-Nodes", showlegend=False)
            
            plot_row = 1
            for i, top_node in enumerate(spiketrains.keys()):
                if spiketrains[top_node]:
                    # plot ISI
                    for st in spiketrains[top_node]:
                        isi = self.statistics.interspike_interval(st)
                        fig.add_trace(go.Histogram(x=isi.magnitude, name=f"ISI of {st.name or 'unnnamed'}"), row=plot_row, col=1)
                    
                    # plot time histogram
                    time_histogram = self.statistics.time_histogram(spiketrains[top_node], bin_size=0.1 * self.pq.s,
                                                                    output='rate')
                    fig.add_trace(go.Bar(x=time_histogram.times.magnitude, y=time_histogram.magnitude.flatten()), row=plot_row, col=2)
                    
                    # plot IFR
                    kernel = self.kernels.GaussianKernel(sigma=100 * self.pq.ms)
                    rates = self.statistics.instantaneous_rate(spiketrains[top_node], sampling_period=10 * self.pq.ms,
                                                               kernel=kernel)
                    fig.add_trace(go.Heatmap(z=rates.magnitude.T, x=rates.times.magnitude, y=list(range(len(spiketrains[top_node])))), row=plot_row, col=3)

                    # plot correlation
                    if len(spiketrains[top_node]) > 1:
                        binned_spiketrains = self.BinnedSpikeTrain(spiketrains[top_node], bin_size=100 * self.pq.ms)
                        corrcoef_matrix = self.correlation_coefficient(binned_spiketrains)
                        fig.add_trace(go.Heatmap(z=corrcoef_matrix, x=list(range(corrcoef_matrix.shape[1])), y=list(range(corrcoef_matrix.shape[0]))), row=plot_row, col=4)
                        fig.update_xaxes(title_text='Neuron', row=plot_row, col=4)
                        fig.update_yaxes(title_text='Neuron', row=plot_row, col=4)
                    
                    plot_row += 1

            return fig
        else:
            return None

    def create_rasterplot(self, selected_ids=None, other_changes=False):
        """
        Create for each top-node a rasterplot for the contained spike trains.

        Called at every cell execution
        """
        spiketrains = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                          neo_class=self.SpikeTrain)
        # compare contents of spiketrains per top node
        spiketrains_unchanged = True
        spiketrains_hash = self.get_neo_hash(spiketrains, hash_name='sha1')
        if self.spiketrains_hash is None:
            self.spiketrains_hash = spiketrains_hash
        else:
            if self.spiketrains_hash != spiketrains_hash:
                spiketrains_unchanged = False

        # Return pre-existing rasterplot if content of spiketrains has NOT changed
        if (spiketrains_unchanged) and (self.spiketrain_overview is not None) and (selected_ids is None) and (not other_changes):
            return self.spiketrain_overview
        # Otherwise, create new plot
        else:
            n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
            if n_subplots > 0:
                #subplot_titles = [key for key in spiketrains.keys() if spiketrains[key]]
                data = []
                for top_node, st_list in spiketrains.items():
                    if st_list:
                        for st in st_list:
                            data.append(SpikeTrainRasterPlot(st))
                events = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Event)
                event_annotations = None
                n_events = sum(1 for v in events.values() if len(v) > 0)
                if n_events > 0:
                    event_annotations = EventAnnotations(events)
                epochs = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Epoch)
                epoch_intervals = None
                n_epochs = sum(1 for v in epochs.values() if len(v) > 0)
                if n_epochs > 0:
                    epoch_intervals = EpochIntervals(epochs)
                plot_dict = self.plots[self.PlotKey.RAW_ST]
                overlapping = plot_dict['overlapping']
                x_range = plot_dict['x_range']
                plotlyGraphFigure = PlotlyGraphFigure(data, title=f"Rasterplot for {'selected' if selected_ids else 'all'} SpikeTrains in", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, overlap_on_compress=False)

                if selected_ids is None:
                    self.spiketrain_overview = plotlyGraphFigure
                return plotlyGraphFigure
            else:
                return None

    def create_lfpplot(self, selected_ids=None, other_changes=False):
        """
        Wrapper for plot_lfp to update the lfp plot

        Called at every cell execution
        """
        analogsignals = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.AnalogSignal)
        irregularsignals = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.IrregularlySampledSignal)
        # compare contents of AnalogSignals per top node
        analogsignals_unchanged = True
        analogsignals_hash = self.get_neo_hash(analogsignals, hash_name='sha1')
        if self.analogsignals_hash is None:
            self.analogsignals_hash = analogsignals_hash
        else:
            if self.analogsignals_hash != analogsignals_hash:
                analogsignals_unchanged = False

        # compare contents of IrregularlySampledSignal per top node
        irregularsignals_unchanged = True
        irregularsignals_hash = self.get_neo_hash(irregularsignals, hash_name='sha1')
        if self.irregularsignals_hash is None:
            self.irregularsignals_hash = irregularsignals_hash
        else:
            if self.irregularsignals_hash != irregularsignals_hash:
                irregularsignals_unchanged = False

        # Return pre-existing lfpplot if content of AnalogSignals has NOT changed
        if analogsignals_unchanged and irregularsignals_unchanged  and (self.signal_overview is not None) and (selected_ids is None) and (not other_changes):
            return self.signal_overview
        else:
            n_analog_subplots = sum(1 for v in analogsignals.values() if len(v) > 0)
            n_irregular_sublplots = sum(1 for v in irregularsignals.values() if len(v) > 0)
            if n_analog_subplots > 0 or n_irregular_sublplots > 0:
                plotly_data = None
                if n_analog_subplots > 0:
                    plotly_data = AnalogSignalLFPPlotList(analogsignals)
                if n_irregular_sublplots > 0:
                    irregular_plotly_data = IrregularlySampledSignalPlotList(irregularsignals)
                    if plotly_data is None:
                        plotly_data = irregular_plotly_data
                    else:
                        plotly_data.concat(irregular_plotly_data)
                events = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Event)
                event_annotations = None
                n_events = sum(1 for v in events.values() if len(v) > 0)
                if n_events > 0:
                    event_annotations = EventAnnotations(events)
                epochs = self._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Epoch)
                epoch_intervals = None
                n_epochs = sum(1 for v in epochs.values() if len(v) > 0)
                if n_epochs > 0:
                    epoch_intervals = EpochIntervals(epochs)
                overlapping = False
                plot_dict = self.plots[self.PlotKey.RAW_ANASIG]
                overlapping = plot_dict['overlapping']
                x_range = plot_dict['x_range']
                plotlyGraphFigure = PlotlyGraphFigure(plotly_data, title=f"Normalized LFP-Plots for {'selected' if selected_ids else 'all'} AnalogSignals", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme)
                if selected_ids is None:
                    self.signal_overview = plotlyGraphFigure
                return plotlyGraphFigure
            else:
                pass

    def _extract_selected_neo_data_objects_by_top_node(self, selected_ids=None, neo_class=None):
        collected_neo_objs = {}
        # iterate over 'neo_objs_and_lists_of_neo_objs_with_var_name' and
        # extract those neo objects that are instances of the given 'neo_class'
        for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
            if isinstance(neo_obj, neo_class):
                collected_neo_objs[f"{neo_obj.name} :: {self.get_neo_hash(neo_obj, hash_name='sha1')}"] = [neo_obj]
            elif issubclass(type(neo_obj), self.Container):
                collected_neo_objs[f"{neo_obj.name} :: {self.get_neo_hash(neo_obj, hash_name='sha1')}"] = neo_obj.list_children_by_class(neo_class)
            else:
                pass
        # keep only neo_obj which are selected, i.e. their hash ID was provided via 'selected_ids'
        if selected_ids is not None:
            for top_node in collected_neo_objs.keys():
                collected_neo_objs[top_node] = [neo_obj for neo_obj in collected_neo_objs[top_node] if
                                                self.get_neo_hash(neo_obj, hash_name='sha1') in selected_ids]
        # remove top-nodes / neo-containers with no object of the specified neo_class
        for key in list(collected_neo_objs):
            if len(collected_neo_objs[key]) == 0:
                del collected_neo_objs[key]
        return collected_neo_objs

    def _get_neo_obj_hash_and_node_name_of_selected_nodes(self):
        return {self.map_ipytree_node_id_to_neo_obj_hash[node._id]: node.name
                for node in self.selected_neo_objects}

    def _repr_pretty_neo_objects(self, neo_obj, node_name, pp, cycle):
        """
        Handle pretty-printing of any neo class and python built-in list.

        Parameter:
            obj: neo-object
            pp: instance of RepresentationPrinter
            cyle: boolean; False -> no self-recursion; True -> self-recursion
        """

        def _repr_pretty_recommended_attrs(neo_obj):
            if hasattr(neo_obj, '_recommended_attrs'):
                pp.text("\n")
                pp.text("\n".join([f"{attr[0]}: {getattr(neo_obj, attr[0])}"
                                   for attr in neo_obj._recommended_attrs if attr[0] not in neo_obj._repr_pretty_attrs_keys_
                                   and getattr(neo_obj, attr[0]) is not None]))

        pp.text(f"selected node: {node_name}\n")

        # neo-container: Block, Segment, Group
        if isinstance(neo_obj, self.Container):
            pp.text(neo_obj.__class__.__name__)
            pp.text(" with ")

            container_lenghts_and_names = []
            for container_name in neo_obj._child_containers:
                child_container = getattr(neo_obj, container_name)
                if child_container:
                    container_lenghts_and_names.append('{} {}'.format(len(child_container), container_name))
            pp.text(', '.join(container_lenghts_and_names))

            if neo_obj._has_repr_pretty_attrs_():
                pp.breakable()
                neo_obj._repr_pretty_attrs_(pp, cycle)

            _repr_pretty_recommended_attrs(neo_obj)
            pp.text("\n\n")

        # SpikeTrainList
        elif isinstance(neo_obj, self.SpikeTrainList):
            if neo_obj._items is None:
                if neo_obj._spike_time_array is None:
                    pp.text(str([]))
                else:
                    pp.text(f"SpikeTrainList containing {neo_obj._spike_time_array.size} spikes from\
                            {len(neo_obj._all_channel_ids)} neurons")
            else:
                pp.text(f"SpikeTrainList containing {len(neo_obj._items)} Spiketrains")
            pp.text("\n\n")

        # Regions of Interest: Circular, Polygon, Rectangular
        elif isinstance(neo_obj, self.CircularRegionOfInterest):
            pp.text(f"{neo_obj.__class__.__name__} with center at {neo_obj.center} and radius {neo_obj.radius}")
            pp.text("\n\n")
        elif isinstance(neo_obj, self.PolygonRegionOfInterest):
            pp.text(f"{neo_obj.__class__.__name__} with vertices at ({neo_obj.vertices})")
            pp.text("\n\n")
        elif isinstance(neo_obj, self.RectangularRegionOfInterest):
            pp.text(f"{neo_obj.__class__.__name__} with center at ({neo_obj.x},{neo_obj.y}), width {neo_obj.width} and height {neo_obj.height}")
            pp.text("\n\n")

        # built-in: list
        elif isinstance(neo_obj, list):
            python_list_type_occurences = [type(ele) for ele in neo_obj]
            type_counter = self.Counter(python_list_type_occurences)
            pp.text(f"{neo_obj.__class__.__name__} with the type occurrence frequencies:\n")
            for key, value in type_counter.items():
                pp.text(f"type: {key} --> #occ: {value}\n")
            pp.text("\n\n")
        
        elif neo_obj.__class__.__name__ == 'ObjectList':
            class_name = neo_obj.__class__.__name__
            
            if len(neo_obj) > 0:
                item_type = neo_obj[0].__class__.__name__
                pp.text(f"{class_name} containing {len(neo_obj)} {item_type} object(s)")
            else:
                pp.text(f"{class_name} (empty)")
            pp.text("\n\n")

        elif isinstance(neo_obj, self.BaseNeo):
            pp.text(str(neo_obj))
            pp.text("\n\n")

        # any other neo object will be represented with their own / inherited '_repr_pretty_' method
        else:
            neo_obj._repr_pretty_(pp, cycle)
            pp.text("\n")
            # display also first and last five data values
            if isinstance(neo_obj, self.AnalogSignal):
                if len(neo_obj.magnitude) > 10:
                    pp.text(f"signal: {neo_obj.magnitude[:5]} ... {neo_obj.magnitude[-5:]} {neo_obj.units}\n")
                else:
                    pp.text(f"signal: {neo_obj.magnitude} {neo_obj.units}\n")
                if len(neo_obj.times) > 10:
                    pp.text(f"times: {neo_obj.times[:5]} ... {neo_obj.times[-5:]}\n")
                else:
                    pp.text(f"times: {neo_obj.times}\n")
            if isinstance(neo_obj, self.SpikeTrain):
                if len(neo_obj.times) > 10:
                    pp.text(f"times: {neo_obj.times[:5]} ... {neo_obj.times[-5:]}\n")
                else:
                    pp.text(f"times: {neo_obj.times}\n")
            if isinstance(neo_obj, self.Epoch):
                if len(neo_obj.times) > 10:
                    pp.text(f"times: {neo_obj.times[:5]} ... {neo_obj.times[-5:]}\n")
                else:
                    pp.text(f"times: {neo_obj.times}\n")
                if len(neo_obj.durations) > 10:
                    pp.text(f"durations: {neo_obj.durations[:5]} ... {neo_obj.durations[-5:]}\n")
                else:
                    pp.text(f"durations: {neo_obj.durations}\n")
                if len(neo_obj.labels) > 10:
                    pp.text(f"labels: {neo_obj.labels[:5]} ... {neo_obj.labels[-5:]}\n")
                else:
                    pp.text(f"labels: {neo_obj.labels}\n")
            if isinstance(neo_obj, self.Event):
                if len(neo_obj.times) > 10:
                    pp.text(f"times: {neo_obj.times[:5]} ... {neo_obj.times[-5:]}\n")
                else:
                    pp.text(f"times: {neo_obj.times}\n")
                if len(neo_obj.labels) > 10:
                    pp.text(f"labels: {neo_obj.labels[:5]} ... {neo_obj.labels[-5:]}\n")
                else:
                    pp.text(f"labels: {neo_obj.labels}\n")
            pp.text("\n\n")

    def pretty_print_of_selected_neo_objects(self):
        from io import StringIO
        from contextlib import redirect_stdout
        from IPython.display import display
        from IPython.lib.pretty import RepresentationPrinter

        def _iterate_over_neo_objects(neo_objs):
            for neo_obj in neo_objs:
                if len(hashes_and_names_of_selected_nodes) == 0:
                    break
                hash_neo_obj = self.get_neo_hash(neo_obj, hash_name='sha1')
                # neo data objects, containers, lists / SpikeTrainList
                if hash_neo_obj in hashes_and_names_of_selected_nodes.keys():
                    with redirect_stdout(output):
                        self._repr_pretty_neo_objects(neo_obj=neo_obj, pp=pp, cycle=False,
                                                      node_name=hashes_and_names_of_selected_nodes[hash_neo_obj])
                    hashes_and_names_of_selected_nodes.pop(hash_neo_obj)
                if issubclass(type(neo_obj), self.Container):
                    for child_container_name in neo_obj._child_containers:
                        if len(hashes_and_names_of_selected_nodes) == 0:
                            break
                        child_container = getattr(neo_obj, child_container_name)
                        hash_child_container = self.get_neo_hash(child_container, hash_name='sha1')
                        if hash_child_container in hashes_and_names_of_selected_nodes.keys():
                            with redirect_stdout(output):
                                self._repr_pretty_neo_objects(neo_obj=child_container, pp=pp, cycle=False,
                                                              node_name=hashes_and_names_of_selected_nodes[hash_child_container])
                            hashes_and_names_of_selected_nodes.pop(hash_child_container)
                        _iterate_over_neo_objects(child_container)
                if isinstance(neo_obj, (list, self.SpikeTrainList)):
                    _iterate_over_neo_objects(neo_obj)

        output = StringIO()
        pp = RepresentationPrinter(output)

        hashes_and_names_of_selected_nodes = self._get_neo_obj_hash_and_node_name_of_selected_nodes()

        _iterate_over_neo_objects(self.neo_objs_and_lists_of_neo_objs_with_var_name.values())

        display(print(output.getvalue()))