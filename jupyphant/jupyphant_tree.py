class Jupyphant_tree:

    from IPython.display import display
    from ipytree import Tree, Node
    from neo import Block, Segment, Group, ChannelView, IrregularlySampledSignal, AnalogSignal, SpikeTrain, Epoch, Event, ImageSequence, CircularRegionOfInterest, PolygonRegionOfInterest, RectangularRegionOfInterest
    from neo.core.baseneo import BaseNeo
    from neo.core.regionofinterest import RegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    import time
    import sys

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .jupyphant import Jupyphant  # only for type hints

    def __init__(self, jupyphant_entity: "Jupyphant_tree.Jupyphant"):
        """
        Class to outsource some jupyphant logic:
            -all logic regarding the Neo tree structure of Jupyphant
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity: "Jupyphant_tree.Jupyphant" = jupyphant_entity

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

        self.ipytree_of_neo_objects: Jupyphant_tree.Tree = None
        self.expand_all = False

    def expand_neo_tree(self, opened):
        self.expand_all = opened
        self.jupyphant_entity.filter_changed = True
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
        self.jupyphant_entity.filter_changed = True
        self.update_tree()

    def update_tree(self):
        """  # TODO: rewrite docstring
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = self.time.time()
        
        # Update all neo objects
        self.jupyphant_entity.update()
        print(f"After update of all neo objects: {self.time.time() - start}")
        
        if self.ipytree_of_neo_objects is not None and self.jupyphant_entity.neo_objs_changed_after_update:
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for variable_name, neo_obj in self.jupyphant_entity.neo_objs_and_lists_of_neo_objs_with_var_name.items():
                if type(neo_obj) not in self.NEO_OBJS_TO_SHOW:
                    continue
                if hasattr(neo_obj, 'block') and neo_obj.block is not None:
                    continue
                if hasattr(neo_obj, 'segment') and neo_obj.segment is not None:
                    continue
                hash_neo_obj = self.jupyphant_entity.get_neo_hash(neo_obj, hash_name='sha1')
                self.jupyphant_entity.map_neo_obj_hash_to_neo_obj[hash_neo_obj] = neo_obj
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
                    self.jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node_neo_obj._id] = hash_neo_obj
                    self.jupyphant_entity.map_ipytree_node_id_to_neo_obj[node_neo_obj._id] = neo_obj
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
                    self.jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node_neo_obj._id] = hash_neo_obj
                    self.jupyphant_entity.map_ipytree_node_id_to_neo_obj[node_neo_obj._id] = neo_obj

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
                        attr_value_hash = self.jupyphant_entity.get_neo_hash(attr_value_list, hash_name='sha1')
                        self.jupyphant_entity.map_neo_obj_hash_to_neo_obj[attr_value_hash] = attr_value_list

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
                        self.jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[attr_node._id] = attr_value_hash
                        self.jupyphant_entity.map_ipytree_node_id_to_neo_obj[attr_node._id] = attr_value_list
                        
                        self._add_sub_nodes(attr_node, attr_value_list)

                        parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, (list, self.SpikeTrainList)) or obj.__class__.__name__ == 'ObjectList':
            
            for i, child_obj in enumerate(obj):
                if type(child_obj) not in self.NEO_OBJS_TO_SHOW:
                    continue
                child_obj_hash = self.jupyphant_entity.get_neo_hash(child_obj, hash_name='sha1')
                self.jupyphant_entity.map_neo_obj_hash_to_neo_obj[child_obj_hash] = child_obj
                
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
                self.jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[child_node._id] = child_obj_hash
                self.jupyphant_entity.map_ipytree_node_id_to_neo_obj[child_node._id] = child_obj
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
                for node in self.jupyphant_entity.selected_neo_objects:
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
                        self.jupyphant_entity.selected_neo_objects.add(node)
                        fire_event = True
                    else:
                        # Since leafs never get selected in the UI it is more intuative, that they are always selected, when parent is selected
                        if not is_leaf or node not in just_deselected or not parent_selected(node):
                            self.jupyphant_entity.selected_neo_objects.discard(node)
                            fire_event = True
                    stack.extend(children)
                return fire_event

            all_selected_in_neo = just_selected.issubset(self.jupyphant_entity.selected_neo_objects)
            none_deselected_in_neo = just_deselected.isdisjoint(self.jupyphant_entity.selected_neo_objects)

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
                self.jupyphant_entity.on_selected_neo_objects_changed.fire()

            self.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')
        self.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')

        Jupyphant_tree.display(self.ipytree_of_neo_objects)