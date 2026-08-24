class ElephantLab:
    # All imports are hidden inside the class in order not to pollute the
    # Python kernel's namespace used by the user of the notebook
    from .elephant_lab_util import ElephantLab_util
    from .elephant_lab_tree import ElephantLab_tree
    from .elephant_lab_info import ElephantLab_info
    from .elephant_lab_plot import ElephantLab_plot

    # Dealing with the Python kernel's namespace, e.g.,
    # listing all defined variables
    from IPython.core.magics.namespace import NamespaceMagics
    # Access to the Python kernel
    from IPython import get_ipython
    # nsm object provides access to the actual kernel's variables
    # And is used to query and manipulate them
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    # Neo classes need to be imported to work with them
    # Depending on the usage situation, import using
    # sys.path.append might be necessary
    from neo.io import NixIO
    from neo.core.baseneo import BaseNeo
    from neo.core.container import Container
    from neo.core.regionofinterest import RegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    from neo import Block, Segment, Group, SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal
    import sys
    import traceback
    # XXX: In general this is bad practice but might be useful for this exact usecase
    # Importing main namespace in order to be able to access objects created in JupyterLab Python kernel
    import __main__
    import json

    import hashlib as _hashlib

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
        Constructor of ElephantLabVisualization
        Called upon activation of the extension.
        Initializes some persistent variables that store references to the current neo objects
        and plots.
        They are used to check for changes in neo objects and to display the current structure.
        """

        self.neo_objs_and_lists_of_neo_objs_with_var_name = {}
        self.neo_objs_changed_after_update = False
        self.selected_neo_objects = set()
        self.on_selected_neo_objects_changed: ElephantLab.SimpleEvent = self.SimpleEvent()
        self.map_ipytree_node_id_to_neo_obj_hash = {}
        self.map_ipytree_node_id_to_neo_obj = {}
        self.map_neo_obj_hash_to_neo_obj = {}
        self.filter_changed = False
        self.last_known_hashes = []
        self.hash_cache = {}
        self.elephant_lab_util: ElephantLab.ElephantLab_util = self.ElephantLab_util()
        self.elephant_lab_tree: ElephantLab.ElephantLab_tree = self.ElephantLab_tree(self)
        self.elephant_lab_info: ElephantLab.ElephantLab_info = self.ElephantLab_info(self)
        self.elephant_lab_plot: ElephantLab.ElephantLab_plot = self.ElephantLab_plot(self)

    def set_panel_visibility(self, explore_active: bool, details_active: bool):
        self.elephant_lab_plot.set_explore_panel_active(explore_active)
        self.elephant_lab_info.set_details_panel_active(details_active)

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
            for attr in ('analogsignals', 'spiketrains', 'events', 'epochs', 'irregularlysampledsignals', 'imagesequences', 'channel_indexes'):
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
        
    def get_neo_hash(self, neo_obj, hash_name="sha1"):
        """
        Returns a stable, unique identifier for a neo object.
        """
        obj_id = id(neo_obj)

        if isinstance(neo_obj, self.Segment):
            parts = [f"{obj_id:016x}", "Segment"]
            if neo_obj.name:
                parts.append(neo_obj.name)
            for container_name in neo_obj._child_containers:
                parts.append(f"{container_name}:{len(getattr(neo_obj, container_name, []))}")
            return self._hashlib.sha1("|".join(parts).encode()).hexdigest()

        if isinstance(neo_obj, self.Block):
            parts = [f"{obj_id:016x}", "Block"]
            if neo_obj.name:
                parts.append(neo_obj.name)
            for container_name in neo_obj._child_containers:
                container = getattr(neo_obj, container_name, [])
                if container_name == 'segments':
                    parts.append(f"segments:{len(container)}")
                    for seg in container:
                        parts.append(self.get_neo_hash(seg, hash_name))
                else:
                    parts.append(f"{container_name}:{len(container)}")
            return self._hashlib.sha1("|".join(parts).encode()).hexdigest()

        # Leaf objects: cache by object identity
        if obj_id in self.hash_cache:
            return self.hash_cache[obj_id]

        try:
            parts = [f"{obj_id:016x}", neo_obj.__class__.__name__]
            if hasattr(neo_obj, 'name') and neo_obj.name:
                parts.append(str(neo_obj.name))
            result = self._hashlib.sha1("|".join(parts).encode()).hexdigest()
        except Exception:
            result = f"{obj_id:040x}"

        self.hash_cache[obj_id] = result
        return result
        
    def update(self):
        """
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        neo_objs_hash_before_update = self._hashlib.sha1("|".join(self.last_known_hashes).encode()).hexdigest()

        self.neo_objs_and_lists_of_neo_objs_with_var_name.clear()

        # Get ALL variables in current kernel namespace
        all_variable_names_in_current_kernel_namespace = self.nsm.who_ls()
        for variable_name in all_variable_names_in_current_kernel_namespace:
            if variable_name.startswith("elephant_lab"):
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


        live_ids = {id(obj) for obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values()}
        for stale_id in list(self.hash_cache.keys()):
            if stale_id not in live_ids:
                del self.hash_cache[stale_id]

        current_hashes = [self.get_neo_hash(obj, 'sha1') for obj in self.neo_objs_and_lists_of_neo_objs_with_var_name.values()]
        neo_objs_hash_after_update = self._hashlib.sha1("|".join(current_hashes).encode()).hexdigest()

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
        neo_objs_to_export = [self.get_neo_obj_from_id(selected_id) for selected_id in selected_ids]

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
                list_creation_code = ""
                if len(paths) > 1:
                    all_vars = list(self.__main__.__dict__.keys())
                    list_base_name = "elephant_lab_list"
                    counter = 0
                    list_var_name = f"{list_base_name}_{counter}"
                    while list_var_name in all_vars:
                        counter += 1
                        list_var_name = f"{list_base_name}_{counter}"

                    self.__main__.__dict__[list_var_name] = objects_for_list

                    code_to_insert = list_var_name
                    list_creation_code = f"{list_var_name} = [{', '.join(paths)}]"
                elif len(paths) == 1:
                    code_to_insert = paths[0]

                print(self.json.dumps({"code_to_insert": code_to_insert, "list_creation_code": list_creation_code}))

        except Exception as e:
            print(self.json.dumps({"code_to_insert": "", "error": str(e), "traceback": self.traceback.format_exc()}), file=self.sys.stdout)

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

        walk(self.elephant_lab_tree.ipytree_of_neo_objects)

        return result
        

    def _get_neo_obj_hash_and_node_name_of_selected_nodes(self):
        return {self.get_neo_hash(self.map_ipytree_node_id_to_neo_obj[node._id]): node.name
            for node in self.selected_neo_objects if node._id in self.map_ipytree_node_id_to_neo_obj}