# Create an object of the JupyphantVisualization class
# It is used to access and visualize the neo objects

def jupyphant_setup_env():
    jupyphant_entity = Jupyphant()
    return jupyphant_entity
class Jupyphant:
    # All imports are hidden inside the class in order not to pollute the
    # Python kernel's namespace used by the user of the notebook
    from .jupyphant_plot import Jupyphant_plot

    # Dealing with the Python kernel's namespace, e.g.,
    # listing all defined variables
    from IPython.core.magics.namespace import NamespaceMagics
    # Access to the Python kernel
    from IPython import get_ipython
    # nsm object provides access to the actual kernel's variables
    # And is used to query and manipulate them
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from IPython.lib.pretty import RepresentationPrinter
    from IPython.display import display, clear_output
    from ipywidgets import Output
    # Neo classes need to be imported to work with them
    # Depending on the usage situation, import using
    # sys.path.append might be necessary
    from neo.core.baseneo import BaseNeo
    from neo.core.container import Container
    from neo.core.regionofinterest import RegionOfInterest, CircularRegionOfInterest, RectangularRegionOfInterest, PolygonRegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    from neo import Block, Segment, Group, SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence, ChannelView
    from neo.io import NixIO
    from collections import Counter, defaultdict
    import numpy as np
    import quantities as pq
    from elephant import statistics
    # ipytree provides a tree structure widget
    # Used to display the Neo object hierarchy
    from ipytree import Tree, Node
    from io import StringIO
    import re
    import sys
    import traceback
    # XXX: In general this is bad practice but might be useful for this exact usecase
    # Importing main namespace in order to be able to access objects created in JupyterLab Python kernel
    import __main__
    import json
    import time

    import joblib

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
        # neo abbreviations and font-awesome icons
        # TODO: maybe create own icons or use more accurate ones from newer fontawesome version (see suggestions in comments)
        self.NEO_ABBREVIATIONS = {"Block": {"abbr": "", "icon": "cube"},  # folder-grid
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

        self.STRING_TO_NEO_OBJ = {
            "spiketrain": self.SpikeTrain, 
            "analogsignal": self.AnalogSignal, 
            "block": self.Block, 
            "segment": self.Segment, 
            "epoch": self.Epoch, 
            "channelview": self.ChannelView, 
            "group": self.Group,
            "irregularlysampledsignal": self.IrregularlySampledSignal,
            "event": self.Event,
            "imagesequence": self.ImageSequence,
            "circularregionofinterest": self.CircularRegionOfInterest,
            "polygonregionofinterest": self.PolygonRegionOfInterest,
            "rectangularregionofinterest": self.RectangularRegionOfInterest
        }
        self.NEO_OBJS_TO_SHOW = [
            self.AnalogSignal, 
            self.SpikeTrain, 
            self.Block, 
            self.Segment, 
            self.Epoch, 
            self.ChannelView,
            self.Group,
            self.IrregularlySampledSignal,
            self.Event,
            self.ImageSequence,
            self.CircularRegionOfInterest,
            self.PolygonRegionOfInterest,
            self.RectangularRegionOfInterest
        ]

        self.neo_objs_and_lists_of_neo_objs_with_var_name = {}
        self.neo_objs_changed_after_update = False
        self.ipytree_of_neo_objects = None
        self.selected_neo_objects = set()
        self.on_selected_neo_objects_changed = self.SimpleEvent()
        self.map_ipytree_node_id_to_neo_obj_hash = {}
        self.map_ipytree_node_id_to_neo_obj = {}
        self.map_neo_obj_hash_to_neo_obj = {}
        self.filter_changed = False
        self.expand_all = False
        self.last_known_hashes = []
        self.hash_cache = {}
        self.jupyphant_plot = self.Jupyphant_plot(self)

    def get_selected_neo_ids(self):
        selected_ids = [
            self.map_ipytree_node_id_to_neo_obj_hash[node._id]
            for node in self.selected_neo_objects
            if node._id in self.map_ipytree_node_id_to_neo_obj_hash
        ]
        return selected_ids
    
    def get_object_of_ids(self):
        selected_ids = self.get_selected_neo_ids()
        if (isinstance(selected_ids, list)):
            return [self.map_neo_obj_hash_to_neo_obj[selected_id] for selected_id in selected_ids]
        return self.map_neo_obj_hash_to_neo_obj[selected_ids]
        
    def get_neo_obj_from_id(self, obj_id):
        return self.map_neo_obj_hash_to_neo_obj[obj_id]

    def get_neo_to_hash_dict(self):
        return self.map_neo_obj_hash_to_neo_obj

    def names_for(self, obj):
        for key, value in self.neo_objs_and_lists_of_neo_objs_with_var_name.items():
            if obj is value:
                return key
        return ""

    def _get_obj_path(self, obj, variable_name=''):
        path = []
        curr = obj

        if hasattr(curr, 'segment') and curr.segment is not None:
            segment = curr.segment
            found_in_segment = False
            for attr in ('analogsignals', 'spiketrains', 'events', 'epochs', 'irregularlysampledsignals', 'imagesequences'):
                if hasattr(segment, attr):
                    container = getattr(segment, attr)
                    for i, item in enumerate(container):
                        if item is curr:
                            path.insert(0, f'{attr}[{i}]')
                            curr = segment
                            found_in_segment = True
                            break
                if found_in_segment:
                    break
        
        if hasattr(curr, 'block') and curr.block is not None:
            block = curr.block
            if isinstance(curr, self.Segment):
                for i, item in enumerate(block.segments):
                    if item is curr:
                        path.insert(0, f'segments[{i}]')
                        curr = block
                        break
            elif isinstance(curr, self.Group):
                for i, item in enumerate(block.groups):
                    if item is curr:
                        path.insert(0, f'groups[{i}]')
                        curr = block
                        break
        
        if path:
            if not variable_name:
                variable_name = self.names_for(curr)
            if variable_name:
                path.insert(0, variable_name)
                return '.'.join(path)

            if hasattr(curr, 'name') and curr.name:
                path.insert(0, curr.name)
            else:
                path.insert(0, 'unnamed_root')
            return '.'.join(path)

        for name, l in self.neo_objs_and_lists_of_neo_objs_with_var_name.items():
            if isinstance(l, (list, self.SpikeTrainList)) or l.__class__.__name__ == 'ObjectList':
                for i, item in enumerate(l):
                    if item is obj:
                        return f'{name}[{i}]'

        if not variable_name:
            variable_name = self.names_for(obj)
        if variable_name:
            return variable_name

        if hasattr(obj, 'name') and obj.name:
            return obj.name
    
    def expand_neo_tree(self, opened):
        self.expand_all = opened
        self.filter_changed = True
        self.update_tree()
    
    def show_neo_obj(self, neo_obj_string):
        try:
            neo_obj_type = self.STRING_TO_NEO_OBJ[neo_obj_string]
        except KeyError:
            return
        
        if neo_obj_type in self.NEO_OBJS_TO_SHOW:
            self.NEO_OBJS_TO_SHOW.remove(neo_obj_type)
        else:
            self.NEO_OBJS_TO_SHOW.append(neo_obj_type)
        self.filter_changed = True
        self.update_tree()
        
    def get_neo_hash(self, neo_obj, hash_name="sha1"):
        """
        Creates a hash value for neo objects,
        taking into account the data, units and metadata.
        """
        try:
            obj_id = id(neo_obj)
            if obj_id in self.hash_cache:
                return self.hash_cache[obj_id]
        except Exception:
            pass

        if isinstance(neo_obj, self.AnalogSignal):
            hashable_summary = (
                neo_obj.magnitude,
                str(neo_obj.units),
                float(neo_obj.sampling_rate),
                str(neo_obj.sampling_rate),
                float(neo_obj.t_start),
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            )
            result = self.joblib.hash(hashable_summary, hash_name=hash_name)

        elif isinstance(neo_obj, self.IrregularlySampledSignal):
            hashable_summary = (
                neo_obj.magnitude,
                str(neo_obj.units),
                float(neo_obj.t_start),
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            )
            result = self.joblib.hash(hashable_summary, hash_name=hash_name)

        elif isinstance(neo_obj, self.SpikeTrain):
            hashable_summary = (
                neo_obj.times,
                str(neo_obj.units),
                float(neo_obj.t_start),
                float(neo_obj.t_stop),
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            )
            result = self.joblib.hash(hashable_summary, hash_name=hash_name)

        elif isinstance(neo_obj, (self.Epoch, self.Event)):
            hashable_summary = (
                neo_obj.times,
                neo_obj.labels,
                str(neo_obj.units),
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            )
            result = self.joblib.hash(hashable_summary, hash_name=hash_name)

        elif isinstance(neo_obj, (self.Block, self.Segment)):
            hashable_summary = [
                neo_obj.name,
                neo_obj.description,
                neo_obj.annotations
            ]
            for child_container_name in neo_obj._child_containers:
                child_container = getattr(neo_obj, child_container_name)
                for child in child_container:
                    hashable_summary.append(self.get_neo_hash(child, hash_name))

            result = self.joblib.hash(tuple(hashable_summary), hash_name=hash_name)

        else:
            result = self.joblib.hash(neo_obj, hash_name)

        try:
            self.hash_cache[obj_id] = result
        except Exception:
            pass
        return result
        
    def update(self):
        """
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        self.hash_cache = {}
        neo_objs_hash_before_update = self.joblib.hash(self.last_known_hashes, hash_name='sha1')

        self.neo_objs_and_lists_of_neo_objs_with_var_name.clear()

        # Get ALL variables in current kernel namespace
        all_variable_names_in_current_kernel_namespace = self.nsm.who_ls()
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
            try:
                obj_from_kernel_ns = self.__main__.__dict__[variable_name]
            except KeyError:
                continue
            # Select only neo objects and SpikeTrainLists / lists with neo objects
            is_BaseNeo_instance = isinstance(obj_from_kernel_ns, self.BaseNeo)
            is_RegionOfInterest_subclass = issubclass(type(obj_from_kernel_ns), self.RegionOfInterest)
            is_list_with_neo_objs = \
                isinstance(obj_from_kernel_ns, (list, self.SpikeTrainList)) and \
                (any(isinstance(obj_from_kernel_ns[i], self.BaseNeo) for i in range(len(obj_from_kernel_ns))) or
                 any(isinstance(obj_from_kernel_ns[i], self.SpikeTrainList) for i in range(len(obj_from_kernel_ns))))
            if is_BaseNeo_instance or is_RegionOfInterest_subclass or is_list_with_neo_objs:
                self.neo_objs_and_lists_of_neo_objs_with_var_name[variable_name] = obj_from_kernel_ns


        current_hashes = [self.get_neo_hash(obj, 'sha1') for obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values()]
        neo_objs_hash_after_update = self.joblib.hash(current_hashes, hash_name='sha1')

        if neo_objs_hash_before_update != neo_objs_hash_after_update or self.filter_changed:
            self.neo_objs_changed_after_update = True
        else:
            self.neo_objs_changed_after_update = False
        
        self.last_known_hashes = current_hashes
        self.filter_changed = False
        
    def save_selected_neo_objects(self, filepath="output_file.nix"):
        if not filepath.endswith('.nix'):
            filepath += '.nix'
        
        selected_ids = self.get_selected_neo_ids()
        neo_objs_to_export = [self.get_neo_obj_from_id(self, selected_id) for selected_id in selected_ids]

        export_block = self.Block(name="Exported Data")
        export_segment = self.Segment(name="Exported Segment")
        export_block.segments.append(export_segment)

        blocks_to_write = []

        for obj in neo_objs_to_export:
            if isinstance(obj, self.Block):
                blocks_to_write.append(obj)
            
            elif isinstance(obj, self.Segment):
                export_block.segments.append(obj)
                
            elif isinstance(obj, (self.SpikeTrain, self.AnalogSignal)):
                obj_copy = obj.copy() 
                
                if isinstance(obj, self.SpikeTrain):
                    export_segment.spiketrains.append(obj_copy)
                else:
                    export_segment.analogsignals.append(obj_copy)

        if len(export_segment.spiketrains) > 0 or len(export_segment.analogsignals) > 0:
            blocks_to_write.append(export_block)

        with self.NixIO(filename=filepath, mode='ow') as nix_io:
            nix_io.write_all_blocks(blocks_to_write)

    def update_tree(self):
        """  # TODO: rewrite docstring
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = self.time.time()
        
        # Update all neo objects
        self.update()
        print(f"After update of all neo objects: {self.time.time() - start}")
        
        if self.ipytree_of_neo_objects is not None and self.neo_objs_changed_after_update:
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for variable_name, neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.items():
                if type(neo_obj) not in self.NEO_OBJS_TO_SHOW:
                    continue
                if hasattr(neo_obj, 'block') and neo_obj.block is not None:
                    continue
                if hasattr(neo_obj, 'segment') and neo_obj.segment is not None:
                    continue
                hash_neo_obj = self.get_neo_hash(neo_obj, hash_name='sha1')
                self.map_neo_obj_hash_to_neo_obj[hash_neo_obj] = neo_obj
                class_name = neo_obj.__class__.__name__

                # Define styles for node names
                NODE_STYLE = "border: 1px dotted var(--jp-border-color2); padding: 1px 4px; background-color: var(--jp-layout-color2); border-radius: 4px;"
                SECONDARY_STYLE = "color:var(--jp-ui-font-color2);"

                if hasattr(neo_obj, 'name') and neo_obj.name:
                    if variable_name and variable_name != neo_obj.name:
                        main_text = f"<b>{variable_name}</b> → <b>{neo_obj.name}</b>"
                    else:
                        main_text = neo_obj.name
                    node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <i style='{SECONDARY_STYLE}'>({class_name})</i> <small style='{SECONDARY_STYLE}'>[{hash_neo_obj[:4]}]</small>"
                    plain_description = f"{variable_name} -> {neo_obj.name} :: ({class_name}) [{hash_neo_obj[:4]}]"
                    node_neo_obj = self.Node(node_name)
                    if neo_obj.name.lower() == "block":
                        node_neo_obj.opened = self.expand_all or (len(neo_obj.segments) < 5)
                    node_neo_obj.metadata = {"data-neo-object": "true", "variable_name": variable_name,
                                             "plain_description": plain_description}
                    node_neo_obj.icon = self.NEO_ABBREVIATIONS[class_name]['icon']
                    node_neo_obj.open_icon_style = 'success'
                    node_neo_obj.close_icon_style = 'danger'
                    self._add_sub_nodes(node_neo_obj, neo_obj)
                    if any(node.name == node_neo_obj.name for node in nodes):
                        continue
                    nodes.append(node_neo_obj)
                    self.map_ipytree_node_id_to_neo_obj_hash[node_neo_obj._id] = hash_neo_obj
                    self.map_ipytree_node_id_to_neo_obj[node_neo_obj._id] = neo_obj
                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                else:
                    is_analog_signal_list = isinstance(neo_obj, list) and len(neo_obj) > 0 and all(
                        isinstance(item, self.AnalogSignal) for item in neo_obj)
                    is_spike_train_list = isinstance(neo_obj, (list, self.SpikeTrainList)) and len(
                        neo_obj) > 0 and all(isinstance(item, self.SpikeTrain) for item in neo_obj)
                    if is_analog_signal_list or is_spike_train_list:
                        container_name = "AnalogSignals" if is_analog_signal_list else "SpikeTrains"
                        main_text = f'{container_name}'
                        node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <b style='color:var(--jp-brand-color1);'>[{len(neo_obj)}]</b>"
                        plain_description = f"{container_name} [{len(neo_obj)}]"
                        node_neo_obj = self.Node(node_name)
                    else:
                        main_text = f'{variable_name}'
                        node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <i style='{SECONDARY_STYLE}'>({class_name})</i> <small style='{SECONDARY_STYLE}'>[{hash_neo_obj[:4]}]</small>"
                        plain_description = f"{variable_name} :: ({class_name}) [{hash_neo_obj[:4]}]"
                        node_neo_obj = self.Node(node_name)
                    node_neo_obj.opened = True
                    node_neo_obj.metadata = {"data-neo-object": "true", "variable_name": variable_name, "plain_description": plain_description}
                    node_neo_obj.icon = self.NEO_ABBREVIATIONS[class_name]['icon']
                    node_neo_obj.open_icon_style = 'success'
                    node_neo_obj.close_icon_style = 'danger'
                    self._add_sub_nodes(node_neo_obj, neo_obj)
                    if any(node.name == node_neo_obj.name for node in nodes):
                        continue
                    nodes.append(node_neo_obj)
                    self.map_ipytree_node_id_to_neo_obj_hash[node_neo_obj._id] = hash_neo_obj
                    self.map_ipytree_node_id_to_neo_obj[node_neo_obj._id] = neo_obj

            print(f"After Blocks: {self.time.time() - start}")
            # print(f"Nodes After Blocks: {nodes}")

            print(f"After Independent: {self.time.time() - start}")
            # print(f"Nodes After Independent: {nodes}")

            print(f"Calculation finished: {self.time.time() - start}")
            self.sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.ipytree_of_neo_objects.nodes = nodes
            print(f"Rendered: {self.time.time() - start}")
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
                        if self.STRING_TO_NEO_OBJ[str(attr_name[:-1].lower())] not in self.NEO_OBJS_TO_SHOW:
                            continue
                    except KeyError:
                        pass
                    if attr_value_list is not None and len(attr_value_list) > 0:
                        attr_value_hash = self.get_neo_hash(attr_value_list, hash_name='sha1')
                        self.map_neo_obj_hash_to_neo_obj[attr_value_hash] = attr_value_list

                        # Define styles
                        NODE_STYLE = "border: 1px dotted var(--jp-border-color2); padding: 1px 4px; background-color: var(--jp-layout-color2); border-radius: 4px;"
                        COUNT_STYLE = "color:var(--jp-brand-color1);"

                        # Capitalize name, and handle special cases
                        capitalized_name = attr_name.capitalize()
                        if attr_name == 'irregularlysampledsignals':
                            capitalized_name = 'IrregularlySampledSignals'
                        elif attr_name == 'channel_indexes':
                            capitalized_name = 'Channel Indexes'

                        main_text = f'{capitalized_name}'
                        node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <b style='{COUNT_STYLE}'>[{len(attr_value_list)}]</b>"
                        attr_node = self.Node(node_name)
                        attr_node.opened = self.expand_all or (len(attr_value_list) < 5)
                        attr_node.icon = 'folder' 
                        attr_node.metadata = {"data-neo-object": "true", "container-for": attr_name}
                        attr_node.open_icon_style = 'success'
                        attr_node.close_icon_style = 'danger'
                        self.map_ipytree_node_id_to_neo_obj_hash[attr_node._id] = attr_value_hash
                        self.map_ipytree_node_id_to_neo_obj[attr_node._id] = attr_value_list
                        
                        self._add_sub_nodes(attr_node, attr_value_list)

                        parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, (list, self.SpikeTrainList)) or obj.__class__.__name__ == 'ObjectList':
            
            for i, child_obj in enumerate(obj):
                if type(child_obj) not in self.NEO_OBJS_TO_SHOW:
                    continue
                child_obj_hash = self.get_neo_hash(child_obj, hash_name='sha1')
                self.map_neo_obj_hash_to_neo_obj[child_obj_hash] = child_obj
                
                class_name = child_obj.__class__.__name__
                if class_name not in self.NEO_ABBREVIATIONS:
                    class_name = 'list' if isinstance(child_obj, list) else 'SpikeTrainList'
                    if class_name not in self.NEO_ABBREVIATIONS:
                         class_name = 'Block'
                # Define styles
                NODE_STYLE = "border: 1px dotted var(--jp-border-color2); padding: 1px 4px; background-color: var(--jp-layout-color2); border-radius: 4px;"
                SECONDARY_STYLE = "color:var(--jp-ui-font-color2);"

                # subclases of RegionOfInterest and list/SpikeTrainList have no 'name' attribute
                if hasattr(child_obj, 'name') and child_obj.name:
                    main_text = f'<b>#{i}</b> → <b>{child_obj.name}</b>'
                    node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <i style='{SECONDARY_STYLE}'>({class_name})</i> <small style='{SECONDARY_STYLE}'>[{child_obj_hash[:4]}]</small>"
                    child_node = self.Node(node_name)
                else:
                    main_text = f'#{i}'
                    node_name = f"<span style='{NODE_STYLE}'>{main_text}</span> <i style='{SECONDARY_STYLE}'>({class_name})</i> <small style='{SECONDARY_STYLE}'>[{child_obj_hash[:4]}]</small>"
                    child_node = self.Node(node_name)
                
                child_node.metadata = {"data-neo-object": "true"}
                child_node.icon = self.NEO_ABBREVIATIONS[class_name]['icon']
                child_node.open_icon_style = 'success'
                child_node.close_icon_style = 'danger'
                child_node.data = {"neo_id": id(obj), "neo_type": type(obj).__name__}
                self.map_ipytree_node_id_to_neo_obj_hash[child_node._id] = child_obj_hash
                self.map_ipytree_node_id_to_neo_obj[child_node._id] = child_obj
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
        # Alternating dark and light stripes for better better visibility
        self.ipytree_of_neo_objects = self.Tree()
        self.ipytree_of_neo_objects.stripes = True

        self.ipytree_of_neo_objects.layout.width = '100%'

        def on_selected_change_tree(change, do_not_select_leafs=True):
            """
            Selects/Deselects all Childs on Parent select/deselect

            If you want to listen to the change of selected_nodes, then listen to
            jupyphant_entity.on_selected_neo_objects_changed with add_listener(self, fn)
            """

            """
            Calling node.selected is extremly inefficient, because it makes a trip from Python -> Javascript -> Python
            So there need to be as less calls as possible.
            However by doing that, the ipytree does not store the correct selected nodes anymore, so the python now stores the truth
            about which node is selected
            """
            self.ipytree_of_neo_objects.unobserve(on_selected_change_tree, names='selected_nodes')
            old_selected_nodes = change['old']
            new_selected_nodes = change['new']

            # old_selected_nodes and new_selected_nodes are lists of Node objects
            old_set = set(old_selected_nodes)
            new_set = set(new_selected_nodes)

            # Nodes that were newly selected
            just_selected = new_set - old_set
            just_deselected = old_set - new_set

            def parent_selected(child):
                for node in self.selected_neo_objects:
                    if child in getattr(node, 'nodes', []):
                        return True
                return False


            # Function to propagate selection iteratively
            def propagate(nodes, selected, all_selected_in_neo):
                fire_event = False
                stack = list(nodes)
                while stack:
                    node = stack.pop()
                    if node in visited or (not selected and all_selected_in_neo and node in just_selected):
                        continue
                    visited.add(node)

                    children = getattr(node, 'nodes', [])
                    is_leaf = not children

                    # Only update node.selected if not a leaf
                    if not (is_leaf and do_not_select_leafs):
                        if node.selected != selected:
                            node.selected = selected

                    # Keep selected_neo_objects in sync
                    if selected:
                        self.selected_neo_objects.add(node)
                        fire_event = True
                    else:
                        # Since leafs never get selected in the UI it is more intuative, that they are always selected, when parent is selected
                        if not is_leaf or node not in just_deselected or not parent_selected(node):
                            self.selected_neo_objects.discard(node)
                            fire_event = True
                    stack.extend(children)
                return fire_event

            all_selected_in_neo = just_selected.issubset(self.selected_neo_objects)
            none_deselected_in_neo = just_deselected.isdisjoint(self.selected_neo_objects)

            visited = set()  # Keep track of processed nodes

            fire_event = False
            if all_selected_in_neo:
                if not none_deselected_in_neo:
                    fire_event = propagate(just_deselected, False, all_selected_in_neo) or fire_event
            else:
                fire_event = propagate(just_selected, True, all_selected_in_neo) or fire_event
                if not none_deselected_in_neo:
                    fire_event = propagate(just_deselected, False, all_selected_in_neo) or fire_event
            if fire_event:
                self.on_selected_neo_objects_changed.fire()

            self.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')
        self.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')
        Jupyphant.display(self.ipytree_of_neo_objects)

        return self.ipytree_of_neo_objects
    
    def insert_selected_neo_objects(self):
        try:
            selected_nodes = self.selected_neo_objects
            
            if not selected_nodes:
                print(self.json.dumps({"code_to_insert": "", "error": "No nodes selected in the Neo tree." }))
            else:
                paths = []
                objects_for_list = []
                for node in selected_nodes:
                    if node._id in self.map_ipytree_node_id_to_neo_obj:
                        neo_obj = self.map_ipytree_node_id_to_neo_obj[node._id]
                        
                        variable_name = node.metadata.get('variable_name', '')
                        path = self._get_obj_path(neo_obj, variable_name=variable_name)
                        if path:
                            paths.append(path)
                            objects_for_list.append(neo_obj)

                code_to_insert = ""
                if len(paths) > 1:
                    all_vars = list(self.__main__.__dict__.keys())
                    list_base_name = "jupyphant_list"
                    counter = 0
                    list_var_name = f"{list_base_name}_{counter}"
                    while list_var_name in all_vars:
                        counter += 1
                        list_var_name = f"{list_base_name}_{counter}"
                    
                    self.__main__.__dict__[list_var_name] = objects_for_list
                    
                    code_to_insert = list_var_name
                elif len(paths) == 1:
                    code_to_insert = paths[0]

                print(self.json.dumps({"code_to_insert": code_to_insert}))

        except Exception as e:
            print(self.json.dumps({"code_to_insert": "", "error": str(e), "traceback": self.traceback.format_exc()}), file=self.sys.stdout)
    
    def create_explorer_info(self):
        def on_selected_change_info():
            with output_node_info:
                Jupyphant.clear_output()
                self.pretty_print_of_selected_neo_objects()

        output_node_info = self.Output(layout={'border': '1px solid orange'})
        self.on_selected_neo_objects_changed.add_listener(on_selected_change_info)
        Jupyphant.display(output_node_info)

    def _extract_selected_neo_data_objects_by_top_node(self, selected_ids=None, neo_class=None):
        collected_neo_objs = {}
        # iterate over 'neo_objs_and_lists_of_neo_objs_with_var_name' and
        # extract those neo objects that are instances of the given 'neo_class'
        for neo_obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values():
            if isinstance(neo_obj, neo_class):
                collected_neo_objs[f"{self.names_for(neo_obj)} {neo_obj.name} :: {self.get_neo_hash(neo_obj, hash_name='sha1')}"] = [neo_obj]
            elif issubclass(type(neo_obj), self.Container):
                collected_neo_objs[f"{self.names_for(neo_obj)} {neo_obj.name} :: {self.get_neo_hash(neo_obj, hash_name='sha1')}"] = neo_obj.list_children_by_class(neo_class)
            else:
                pass
        # keep only neo_obj which are selected, i.e. their hash ID was provided via 'selected_ids'
        if selected_ids is not None:
            for top_node in collected_neo_objs.keys():
                collected_neo_objs[top_node] = [neo_obj for neo_obj in collected_neo_objs[top_node] if
                                                self.get_neo_hash(neo_obj, hash_name='sha1') in selected_ids]
                
        # remove duplicate neo objects (e.g., if same neo object is referenced in multiple containers)
        processed_hashes = set()
        for key in list(collected_neo_objs.keys()):
            unique_objs = []
            for neo_obj in collected_neo_objs[key]:
                obj_hash = self.get_neo_hash(neo_obj, hash_name='sha1')
                if obj_hash not in processed_hashes:
                    unique_objs.append(neo_obj)
                    processed_hashes.add(obj_hash)
            collected_neo_objs[key] = unique_objs

        # remove top-nodes / neo-containers with no object of the specified neo_class
        for key in list(collected_neo_objs):
            if len(collected_neo_objs[key]) == 0:
                del collected_neo_objs[key]
        return collected_neo_objs
    
    def _get_selected_neo_objects_by_class(self, neo_class_dict):
        """
        neo_class_dict: {NeoKey: neo.class (eg. neo.SpikeTrain)}
        Returns: {NeoKey: [selected neo objects in tree order]}
        """

        neo_class_dict = dict(neo_class_dict)

        # Prepare result dict
        result = {key: [] for key in neo_class_dict}

        selected_nodes = self.selected_neo_objects

        def walk(node):
            # If node maps to a neo object and is selected
            if node in selected_nodes and node._id in self.map_ipytree_node_id_to_neo_obj:
                obj = self.map_ipytree_node_id_to_neo_obj[node._id]

                # Classify
                for key, cls in neo_class_dict.items():
                    if isinstance(obj, cls):
                        result[key].append(obj)
                        break  # one class only

            # Recurse
            for child in getattr(node, "nodes", []):
                walk(child)

        walk(self.ipytree_of_neo_objects)

        return result
        

    def _get_neo_obj_hash_and_node_name_of_selected_nodes(self):
        return {self.get_neo_hash(self.map_ipytree_node_id_to_neo_obj[node._id]): node.name
            for node in self.selected_neo_objects if node._id in self.map_ipytree_node_id_to_neo_obj}

    def _print_as_table(self, data, pp):
        """
        Prints a list of lists as a formatted table using the provided pretty-printer.
        """
        if not data:
            return

        num_columns = len(data[0]) if data else 0
        if num_columns == 0:
            return

        table_data = []
        for row in data:
            str_row = [str(item) for item in row]
            padded_row = str_row[:num_columns] + [''] * (num_columns - len(str_row))
            table_data.append(padded_row)

        col_widths = [0] * num_columns
        for row in table_data:
            for i, cell in enumerate(row):
                if len(cell) > col_widths[i]:
                    col_widths[i] = len(cell)

        bold = '\033[1m'
        reset = '\033[0m'
        
        header_cells = [
            f"{{:<{col_widths[i]}}}".format(table_data[0][i])
            for i in range(num_columns)
        ]
        bold_header_line = " | ".join([f"{bold}{cell}{reset}" for cell in header_cells])
        pp.text(bold_header_line)
        pp.text("\n")

        separator = "-+-".join("-" * width for width in col_widths)
        pp.text(separator)
        pp.text("\n")

        row_format = " | ".join(f"{{:<{width}}}" for width in col_widths)
        for row in table_data[1:]:
            pp.text(row_format.format(*row))
            pp.text("\n")

    def _repr_pretty_annotations_overview(self, all_annotations, count, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        if not all_annotations:
            return
            
        all_keys = set()
        for anno in all_annotations:
            if anno:
                all_keys.update(anno.keys())
        
        common_annos = {}
        different_annos = []
        partial_annos = []

        for key in all_keys:
            values_with_key = [anno.get(key) for anno in all_annotations if anno and key in anno]
            
            if len(values_with_key) == count: # present in all
                try:
                    first_val_str = str(values_with_key[0])
                    if all(str(v) == first_val_str for v in values_with_key[1:]):
                        common_annos[key] = values_with_key[0]
                    else:
                        different_annos.append(key)
                except:
                    different_annos.append(key)
            else:
                partial_annos.append(key)
        
        if common_annos:
            pp.text(f"  \n{bold}Identical Annotations:{reset}\n")
            for k, v in common_annos.items():
                pp.text(f"    {bold}{k}:{reset} {v}\n")
        
        if different_annos:
            pp.text(f"  \n{bold}Diverging Annotations:{reset} {', '.join(different_annos)}\n")
        
        if partial_annos:
            pp.text(f"  \n{bold}Unique Annotations:{reset} {', '.join(partial_annos)}\n")

    def _repr_pretty_spiketrain_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        spiketrains = [item['obj'] for item in items]
        count = len(spiketrains)
        total_spikes = sum(len(st) for st in spiketrains)
        
        pp.text(f"{bold}SpikeTrain Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        pp.text(f"  {bold}Total Spikes:{reset} {total_spikes}\n")

        # Units Check
        units = set(str(st.units.dimensionality) for st in spiketrains)
        pp.text(f"  {bold}Units:{reset} {', '.join(units)}\n")

        all_annotations = [st.annotations for st in spiketrains]
        self._repr_pretty_annotations_overview(all_annotations, count, pp)
        
        # Time Range
        all_t_starts = [st.t_start for st in spiketrains]
        all_t_stops = [st.t_stop for st in spiketrains]
        pp.text(f"  \n{bold}Time Range (t_start to t_stop):{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(all_t_starts)}\n")
        pp.text(f"    {bold}Max:{reset} {max(all_t_stops)}\n")

        if spiketrains:
            target_units = spiketrains[0].units
            all_times_list = []
            for st in spiketrains:
                if len(st) > 0:
                    all_times_list.append(st.times.rescale(target_units))

            if all_times_list:
                all_spike_times_magnitude = self.np.concatenate([q.magnitude for q in all_times_list])
                all_spike_times = self.pq.Quantity(all_spike_times_magnitude, units=target_units)
                
                unit_str = all_spike_times.units.dimensionality
                min_val = self.np.min(all_spike_times).magnitude
                max_val = self.np.max(all_spike_times).magnitude

                pp.text(f"  {bold}Spike Times:{reset}\n")
                pp.text(f"    {bold}Min:{reset} {min_val} {unit_str}\n")
                pp.text(f"    {bold}Max:{reset} {max_val} {unit_str}\n")

        # Firing Rate Statistics
        firing_rates = [self.statistics.mean_firing_rate(st) for st in spiketrains if st.t_stop > st.t_start]
        if firing_rates:
            rate_units = firing_rates[0].units.dimensionality
            pp.text(f"  {bold}Firing Rates ({rate_units}):{reset}\n")
            pp.text(f"    {bold}Min:{reset} {min(fr.magnitude for fr in firing_rates):.4f}\n")
            pp.text(f"    {bold}Max:{reset} {max(fr.magnitude for fr in firing_rates):.4f}\n")
            pp.text(f"    {bold}Average:{reset} {self.np.mean([fr.magnitude for fr in firing_rates]):.4f}\n")

        # ISI Statistics
        isis_list = [self.statistics.isi(st) for st in spiketrains if len(st) > 1]
        if isis_list:
            cvs = [self.statistics.cv(isis) for isis in isis_list]
                        
            if cvs:
                pp.text(f"  {bold}Coefficient of Variation (CV):{reset}\n")
                pp.text(f"    {bold}Min:{reset} {min(cvs):.4f}\n")
                pp.text(f"    {bold}Max:{reset} {max(cvs):.4f}\n")
                pp.text(f"    {bold}Average:{reset} {self.np.mean(cvs):.4f}\n")

        pp.text("\n")

    def _repr_pretty_analogsignal_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        signals = [item['obj'] for item in items]
        count = len(signals)
        
        pp.text(f"{bold}AnalogSignal Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        pp.text(f"  {bold}Total Channels:{reset} {sum(s.shape[1] for s in signals)}\n")

        sampling_rates = set(str(s.sampling_rate) for s in signals)
        pp.text(f"  {bold}Sampling Rates:{reset} {', '.join(map(str, sampling_rates))}\n")

        durations = [s.duration for s in signals]
        pp.text(f"  {bold}Durations:{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(durations)}\n")
        pp.text(f"    {bold}Max:{reset} {max(durations)}\n")

        all_t_starts = [s.t_start for s in signals]
        all_t_stops = [s.t_stop for s in signals]
        pp.text(f"  {bold}Time Range (t_start to t_stop):{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(all_t_starts)}\n")
        pp.text(f"    {bold}Max:{reset} {max(all_t_stops)}\n")

        all_annotations = [s.annotations for s in signals]
        self._repr_pretty_annotations_overview(all_annotations, count, pp)

        pp.text("\n")

    def _repr_pretty_mixed_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        pp.text(f"{bold}Multiple Object Types Selected{reset}\n")
        pp.text(f"  {bold}Total Objects:{reset} {len(items)}\n")
        
        type_counts = self.Counter(type(item['obj']).__name__ for item in items)
        
        pp.text(f"  {bold}Object Types:{reset}\n")
        for type_name, count in type_counts.items():
            pp.text(f"    - {type_name}: {count}\n")
        pp.text("\n")

    def _repr_pretty_generic_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        count = len(items)
        obj_type_name = items[0]['obj'].__class__.__name__
        
        pp.text(f"{bold}{obj_type_name} Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        
        all_annotations = [item['obj'].annotations for item in items if hasattr(item['obj'], 'annotations')]
        if all_annotations:
             self._repr_pretty_annotations_overview(all_annotations, count, pp)
        
        pp.text("\n")

    def _format_array_annotation_value(self, value):
        if isinstance(value, self.np.ndarray):
            if value.ndim == 1:
                if len(value) > 10:
                    return f"{', '.join(map(str, value[:5]))}, ..., {', '.join(map(str, value[-5:]))}"
                return ', '.join(map(str, value))
            else:
                return f"{value.ndim}D array of shape {value.shape}"
        return str(value)

    def _repr_pretty_array_annotations(self, neo_obj, pp):
        bold = '\033[1m'
        reset = '\033[0m'

        if hasattr(neo_obj, 'array_annotations') and neo_obj.array_annotations:
            pp.text(f"\n{bold}Array Annotations:{reset}\n")
            for key, value in neo_obj.array_annotations.items():
                formatted_value = self._format_array_annotation_value(value)
                pp.text(f"  {bold}{key}{reset}: {formatted_value}\n")

    def _repr_pretty_neo_objects(self, neo_obj, node_name, pp, cycle):
        """
        Handle pretty-printing of any neo class and python built-in list.

        Parameter:
            obj: neo-object
            pp: instance of RepresentationPrinter
            cyle: boolean; False -> no self-recursion; True -> self-recursion
        """
        bold = '\033[1m'
        reset = '\033[0m'

        def _repr_pretty_recommended_attrs(neo_obj):
            if hasattr(neo_obj, '_recommended_attrs'):
                pp.text("\n")
                pp.text("\n".join([f"{bold}{attr[0]}{reset}: {getattr(neo_obj, attr[0])}"
                                   for attr in neo_obj._recommended_attrs if attr[0] not in neo_obj._repr_pretty_attrs_keys_
                                   and getattr(neo_obj, attr[0]) is not None]))

        path = self._get_obj_path(neo_obj)
        if path:
            pp.text(f"{bold}{path}\n")
        
        clean_node_name = self.re.sub(r'<[^>]+>', '', node_name)
        pp.text(f"{bold}{clean_node_name}{reset}\n")

        # neo-container: Block, Segment, Group
        if isinstance(neo_obj, self.Container):
            pp.text(f"{bold}{neo_obj.__class__.__name__}{reset} with ")

            container_lenghts_and_names = []
            for container_name in neo_obj._child_containers:
                child_container = getattr(neo_obj, container_name)
                if child_container:
                    container_lenghts_and_names.append('{} {}'.format(len(child_container), container_name))
            pp.text(', '.join(container_lenghts_and_names))

            if neo_obj.name:
                pp.text(f"\n{bold}Name:{reset} {neo_obj.name}")
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"\n  {bold}{key}{reset}: {value}")

            _repr_pretty_recommended_attrs(neo_obj)
            pp.text("\n\n")
            return

        # SpikeTrainList
        if isinstance(neo_obj, self.SpikeTrainList):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")

            pp.text(f"{bold}SpikeTrainList{reset}")
            if neo_obj._items is None:
                if neo_obj._spike_time_array is None:
                    pp.text(" (empty)")
                else:
                    pp.text(f"\n  {bold}Spikes:{reset} {neo_obj._spike_time_array.size}")
                    pp.text(f"\n  {bold}Neurons:{reset} {len(neo_obj._all_channel_ids)}")
            else:
                pp.text(f"\n  {bold}SpikeTrains:{reset} {len(neo_obj._items)}")
            pp.text("\n\n")
            return

        # Regions of Interest: Circular, Polygon, Rectangular
        if isinstance(neo_obj, self.CircularRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with center at {neo_obj.center} and radius {neo_obj.radius}")
            pp.text("\n\n")
            return
        if isinstance(neo_obj, self.PolygonRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with vertices at ({neo_obj.vertices})")
            pp.text("\n\n")
            return
        if isinstance(neo_obj, self.RectangularRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with center at ({neo_obj.x},{neo_obj.y}), width {neo_obj.width} and height {neo_obj.height}")
            pp.text("\n\n")
            return

        # built-in: list
        if isinstance(neo_obj, list):
            python_list_type_occurences = [type(ele) for ele in neo_obj]
            type_counter = self.Counter(python_list_type_occurences)
            pp.text(f"{bold}{neo_obj.__class__.__name__} contents:{reset}\n")
            table_data = [["Type", "Count"]]
            for type_obj, count in type_counter.items():
                table_data.append([type_obj.__name__, count])
            self._print_as_table(table_data, pp)
            pp.text("\n")
            return

        if neo_obj.__class__.__name__ == 'ObjectList':
            class_name = neo_obj.__class__.__name__
            pp.text(f"{bold}{class_name}{reset}")
            
            if len(neo_obj) > 0:
                item_type = neo_obj[0].__class__.__name__
                pp.text(f"\n  {bold}Items:{reset} {len(neo_obj)}")
                pp.text(f"\n  {bold}Type:{reset} {item_type}")
            else:
                pp.text(" (empty)")
            pp.text("\n\n")
            return
            
        if isinstance(neo_obj, self.AnalogSignal):
            pp.text(f"{neo_obj.shape[1]} channels, {neo_obj.shape[0]} samples\n\n")

            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")

            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            pp.text(f"{bold}Time Range:{reset} {neo_obj.t_start} to {neo_obj.t_stop}\n")
            
            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Sampling Rate:{reset} {neo_obj.sampling_rate}\n\n")
            
            num_channels = neo_obj.shape[1]
            channel_indices = list(range(num_channels))
            
            if num_channels > 4:
                pp.text(f"(Showing data for first 2 and last 2 of {num_channels} channels)\n")
                channel_indices = list(range(2)) + list(range(num_channels - 2, num_channels))
            elif num_channels > 1:
                pp.text(f"(Showing data for all {num_channels} channels)\n")

            header = ["Index", f"Time ({neo_obj.times.units.dimensionality.string})"]
            for i in channel_indices:
                header.append(f"Ch{i}")
            
            table_data = [header]
            times = neo_obj.times

            if len(times) > 20:
                # Add first 10 rows
                for i in range(10):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
                
                # Add ellipsis
                table_data.append(["..."] * len(header))
                
                # Add last 10 rows
                for i in range(len(times) - 10, len(times)):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
            else:
                for i in range(len(times)):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
            
            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.SpikeTrain):
            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")

            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            pp.text(f"{bold}Time Range:{reset} {neo_obj.t_start} to {neo_obj.t_stop}\n")
            
            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")
            else:
                pp.text("\n")

            
            table_data = [[f"Index ({len(neo_obj)} spikes)", f"Time (in {neo_obj.units.dimensionality}, {neo_obj.dtype})"]]
            times = neo_obj.times

            if len(times) > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}"])
                table_data.append(["...", "..."])
                for i in range(len(times) - 10, len(times)):
                    table_data.append([i, f"{times[i]:.4f}"])
            else:
                for i in range(len(times)):
                    table_data.append([i, f"{times[i]:.4f}"])

            self._print_as_table(table_data, pp)
            self._repr_pretty_array_annotations(neo_obj, pp)
            
            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.Epoch):
            pp.text(f"{len(neo_obj)} epochs\n\n")

            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")
            
            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Data:{reset}\n")
            table_data = [["Index", f"Time (in {neo_obj.units.dimensionality.string}, {neo_obj.dtype})", f"Duration (in {neo_obj.units.dimensionality.string})", "Label"]]
            times = neo_obj.times
            durations = neo_obj.durations
            labels = neo_obj.labels

            num_epochs = len(times)
            if num_epochs > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])
                table_data.append(["...", "...", "...", "..."])
                for i in range(num_epochs - 10, num_epochs):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])
            else:
                for i in range(num_epochs):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])

            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.Event):
            pp.text(f"{len(neo_obj)} events\n\n")
            
            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")
            
            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Data:{reset}\n")
            table_data = [["Index", f"Time (in {neo_obj.units.dimensionality.string}, {neo_obj.dtype})", "Label"]]
            times = neo_obj.times
            labels = neo_obj.labels

            num_events = len(times)
            if num_events > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])
                table_data.append(["...", "...", "..."])
                for i in range(num_events - 10, num_events):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])
            else:
                for i in range(num_events):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])

            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.BaseNeo):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(str(neo_obj))
            pp.text("\n\n")
            return

        # any other neo object will be represented with their own / inherited '_repr_pretty_' method
        try:
            neo_obj._repr_pretty_(pp, cycle)
            pp.text("\n\n")
        except AttributeError:
            pp.text(f"Object of type {type(neo_obj)} could not be pretty-printed.")
            pp.text("\n\n")

    def pretty_print_of_selected_neo_objects(self):
        output = self.StringIO()
        pp = self.RepresentationPrinter(output)

        if not self.selected_neo_objects:
            return

        selected_objects_with_node_name = [
            {'obj': self.map_ipytree_node_id_to_neo_obj.get(node._id), 'node_name': node.name, 'variable_name': node.metadata.get('variable_name', '')}
            for node in self.selected_neo_objects if node._id in self.map_ipytree_node_id_to_neo_obj
        ]

        if len(selected_objects_with_node_name) <= 1:
            # Existing logic for single selection or no selection
            if selected_objects_with_node_name:
                item = selected_objects_with_node_name[0]
                self._repr_pretty_neo_objects(item['obj'], item['node_name'], pp, cycle=False)
            print(output.getvalue())
            return
        
        grouped_objects = self.defaultdict(list)
        for item in selected_objects_with_node_name:
            # Handle lists of objects as a special type
            if isinstance(item['obj'], list):
                grouped_objects[list].append(item)
            else:
                grouped_objects[type(item['obj'])].append(item)

        if len(grouped_objects) > 1:
            self._repr_pretty_mixed_overview(selected_objects_with_node_name, pp)
        
        for obj_type, items in grouped_objects.items():
            if len(items) > 1:
                # Multiple objects of the same type
                if issubclass(obj_type, self.SpikeTrain):
                    self._repr_pretty_spiketrain_overview(items, pp)
                elif issubclass(obj_type, self.AnalogSignal):
                    self._repr_pretty_analogsignal_overview(items, pp)
                else:
                    self._repr_pretty_generic_overview(items, pp)
                print(output.getvalue())