class ElephantLab:
    # All imports are hidden inside the class in order not to pollute the
    # Python kernel's namespace used by the user of the notebook
    from .elephant_lab_util import ElephantLab_util
    from .elephant_lab_tree import ElephantLab_tree
    from .elephant_lab_info import ElephantLab_info
    from .elephant_lab_plot import ElephantLab_plot
    from .SimpleEvent import SimpleEvent
    from .TreeNode import TreeNode, RootNode, NeoNode

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

    def __init__(self):
        """   # TODO: rewrite docstring
        Constructor of ElephantLabVisualization
        Called upon activation of the extension.
        Initializes some persistent variables that store references to the current neo objects
        and plots.
        They are used to check for changes in neo objects and to display the current structure.
        """

        self.root_node: ElephantLab.RootNode = self.RootNode()
        self.neo_nodes: dict[ElephantLab.NeoNode, ElephantLab.NeoNode] = {}
        self.changed_neo_nodes: set[ElephantLab.NeoNode] = set()
        self.added_neo_nodes: set[ElephantLab.NeoNode] = set()
        self.selected_tree_nodes: set[ElephantLab.TreeNode] = set()
        self.on_selected_tree_nodes_changed: ElephantLab.SimpleEvent = self.SimpleEvent()
        self.filter_changed = False
        self.elephant_lab_util: ElephantLab.ElephantLab_util = self.ElephantLab_util()
        self.elephant_lab_tree: ElephantLab.ElephantLab_tree = self.ElephantLab_tree(self)
        self.elephant_lab_info: ElephantLab.ElephantLab_info = self.ElephantLab_info(self)
        self.elephant_lab_plot: ElephantLab.ElephantLab_plot = self.ElephantLab_plot(self)

    def set_panel_visibility(self, explore_active: bool, details_active: bool):
        self.elephant_lab_plot.set_explore_panel_active(explore_active)
        self.elephant_lab_info.set_details_panel_active(details_active)
    
    def _get_obj_path(self, neo_node):
        path = []
        curr = neo_node.neo_object
        variable_name = neo_node.reference_name

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
            if variable_name:
                path.insert(0, variable_name)
                return '.'.join(path)

            if hasattr(curr, 'name') and curr.name:
                path.insert(0, curr.name)
            else:
                path.insert(0, 'unnamed_root')
            return '.'.join(path)

        for n_d in self.neo_nodes.values():
            l = n_d.neo_object
            name = n_d.reference_name
            if isinstance(l, (list, self.SpikeTrainList)) or l.__class__.__name__ == 'ObjectList':
                for i, item in enumerate(l):
                    if item is curr:
                        return f'{name}[{i}]'

        if variable_name:
            return variable_name

        return neo_node.primary_name
        
    def update(self):
        """
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        # Get ALL variables in current kernel namespace
        self.changed_neo_nodes.clear()
        self.added_neo_nodes.clear()
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
            is_neo = (
                isinstance(obj_from_kernel_ns, self.BaseNeo)
                or issubclass(type(obj_from_kernel_ns), self.RegionOfInterest)
                or (
                    isinstance(obj_from_kernel_ns, (list, self.SpikeTrainList))
                    and any(isinstance(x, (self.BaseNeo, self.SpikeTrainList)) for x in obj_from_kernel_ns)
                )
            )
            if is_neo:
                neo_node = self.NeoNode(variable_name, obj_from_kernel_ns)

                existing_neo_node = self.neo_nodes.get(neo_node)

                if existing_neo_node is None:
                    self.neo_nodes[neo_node] = neo_node
                    self.added_neo_nodes.add(neo_node)
                else:
                    if existing_neo_node.update():
                        self.changed_neo_nodes.add(existing_neo_node)
        self.filter_changed = False
        
    def save_selected_tree_nodes(self, filepath="output_file.nix"):
        if not filepath.endswith('.nix'):
            filepath += '.nix'
        
        neo_objs_to_export = [neo_node.neo_object for neo_node in self.selected_tree_nodes]

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
    
    def insert_selected_tree_nodes(self):
        try:
            if not self.selected_tree_nodes:
                print(self.json.dumps({"code_to_insert": "", "error": "No nodes selected in the Neo tree." }))
            else:
                paths = []
                objects_for_list = []
                for neo_node in self.selected_tree_nodes:
                    neo_obj = neo_node.neo_object
                    path = self._get_obj_path(neo_node)
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
    
    def _get_selected_tree_nodes_by_class(self, neo_class_dict):
        """
        neo_class_dict: {NeoKey: neo.class (eg. neo.SpikeTrain)}
        Returns: {NeoKey: [selected neo objects in tree order]}
        """

        neo_class_dict = dict(neo_class_dict)

        # Prepare result dict
        result = {key: [] for key in neo_class_dict}

        selected_neo_nodes = self.selected_tree_nodes

        def walk(node):
            # If node maps to a neo object and is selected
            if node in selected_neo_nodes and node._id in self.map_ipytree_node_id_to_neo_obj:
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