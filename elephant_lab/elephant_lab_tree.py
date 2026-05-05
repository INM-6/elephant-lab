# Node class which represents a node in the neo tree
class SimpleNode:
    def __init__(self, node_id, name='', metadata=None):
        self._id = node_id
        self.name = name
        self.metadata = metadata or {}
        self.nodes = []
    def __hash__(self):
        return hash(self._id)
    def __eq__(self, other):
        return isinstance(other, SimpleNode) and self._id == other._id

class ElephantLab_tree:

    from IPython.display import display
    from neo import Block, Segment, Group, ChannelView, IrregularlySampledSignal, AnalogSignal, SpikeTrain, Epoch, Event, ImageSequence, CircularRegionOfInterest, PolygonRegionOfInterest, RectangularRegionOfInterest
    from neo.core.baseneo import BaseNeo
    from neo.core.regionofinterest import RegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    import ipywidgets as widgets
    import json
    import ast
    import re


    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .elephant_lab import ElephantLab  # only for type hints
        
    # Current workaround to keep compatibility
    @property
    def ipytree_of_neo_objects(self):
        return self._root_node
    
    def __init__(self, elephant_lab_entity: "ElephantLab_tree.ElephantLab"):
        """
        Class to outsource some elephant lab logic:
            -all logic regarding the Neo tree structure of Elephant Lab
        Is a Class to minimize the amount of name clutter in the notebook
        """
        self.elephant_lab_entity: "ElephantLab_tree.ElephantLab" = elephant_lab_entity
        self._root_node = SimpleNode('root', name='root')
        
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

        self.NODE_STYLE = "padding:0px 3px 1px 3px;background:var(--jp-layout-color2);border-radius:2px;line-height:1.5;\
            display:inline-block;vertical-align:middle;max-width:200px;overflow:hidden;\
            text-overflow:ellipsis;white-space:nowrap;"
        self.SECOND_STYLE = "color:var(--jp-ui-font-color2);"
        self.CS = "color:var(--jp-brand-color1);"
        
        
        self._tree_widget = None  # ipywidgets.HTML
        self._node_registry: dict = {}  # hash_id -> SimpleNode, for selection
        self._stat_cache: dict = {}
        self.expand_all = False

    def expand_neo_tree(self, opened):
        self.expand_all = opened
        self.elephant_lab_entity.filter_changed = True
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
        self.elephant_lab_entity.filter_changed = True
        self.update_tree()

    def cache_stat(self, hash_id: str, stat_name: str, value: float):
        if hash_id not in self._stat_cache:
            self._stat_cache[hash_id] = {}
        self._stat_cache[hash_id][stat_name] = value

    def update_tree(self):
        self.elephant_lab_entity.update()
        self._stat_cache.clear()
        if self._tree_widget is None or not self.elephant_lab_entity.neo_objs_changed_after_update:
            return

        # Clear maps
        self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.clear()
        self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj.clear()
        self._node_registry.clear()

        nodes_html = []
        top_level_simple_nodes = []
        for variable_name, neo_obj in self.elephant_lab_entity.neo_objs_and_lists_of_neo_objs_with_var_name.items():
            if type(neo_obj) not in self.NEO_OBJS_TO_SHOW:
                continue
            if hasattr(neo_obj, 'block') and neo_obj.block is not None:
                continue
            if hasattr(neo_obj, 'segment') and neo_obj.segment is not None:
                continue
            html, simple_node = self._build_node_html(neo_obj, variable_name=variable_name)
            nodes_html.append(html)
            top_level_simple_nodes.append(simple_node)

        self._root_node.nodes = top_level_simple_nodes

        self._tree_widget.value = f'''
        <style>
        .jup-tree {{ font-family: var(--jp-ui-font-family); font-size: var(--jp-ui-font-size1); line-height: 1.5; }}
        .jup-node {{ margin: 0; }}
        .jup-row {{ display: flex; align-items: center; gap: 4px; padding: 1px 2px;
                    border-radius: 3px; cursor: pointer; user-select: none; }}
        .jup-row:hover {{ background: var(--jp-layout-color2); }}
        .jup-row.jup-selected {{ background: var(--jp-brand-color3); }}
        .jup-toggle {{ width: 14px; text-align: center; flex-shrink: 0; font-size: 10px; }}
        .jup-toggle-empty {{ width: 14px; flex-shrink: 0; }}
        .jup-children {{ padding-left: 18px; display: none; }}
        .jup-children.jup-open {{ display: block; }}
        </style>
        <div class="jup-tree">{"".join(nodes_html)}</div>
        '''

    def _build_node_html(self, neo_obj, variable_name='', list_index=None):
        hash_id = self.elephant_lab_entity.get_neo_hash(neo_obj, hash_name='sha1')
        self.elephant_lab_entity.map_neo_obj_hash_to_neo_obj[hash_id] = neo_obj
        self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj[hash_id] = neo_obj
        self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash[hash_id] = hash_id

        class_name = neo_obj.__class__.__name__
        icon = self.NEO_ABBREVIATIONS.get(class_name, {}).get('icon', 'circle')

        if list_index is not None:
            name_part = f"<b>#{list_index}</b>" + (f" → <b>{neo_obj.name}</b>" if hasattr(neo_obj, 'name') and neo_obj.name else "")
        elif hasattr(neo_obj, 'name') and neo_obj.name:
            name_part = f"<b>{variable_name}</b> → <b>{neo_obj.name}</b>" if variable_name and variable_name != neo_obj.name else neo_obj.name
        else:
            name_part = variable_name or class_name

        if list_index is not None:
            plain_name = f"#{list_index}" + (f" → {neo_obj.name}" if hasattr(neo_obj, 'name') and neo_obj.name else "")
        elif hasattr(neo_obj, 'name') and neo_obj.name:
            plain_name = f"{variable_name} -> {neo_obj.name} :: ({class_name}) [{hash_id[:4]}]"
        else:
            plain_name = f"{variable_name} :: ({class_name}) [{hash_id[:4]}]"

        simple_node = SimpleNode(
            hash_id,
            name=plain_name,
            metadata={"variable_name": variable_name, "data-neo-object": "true"}
        )
        
        label = f"<span style='{self.NODE_STYLE}'>{name_part}</span> <i style='{self.SECOND_STYLE}'>({class_name})</i> <small style='{self.SECOND_STYLE}'>[{hash_id[:4]}]</small>"

        children_html, child_simple_nodes = self._build_children_html(neo_obj)
        has_children = bool(children_html)
        
        simple_node.nodes = child_simple_nodes
        self._node_registry[hash_id] = simple_node

        if has_children:
            auto_open = self.expand_all or len(child_simple_nodes) < 5
            arrow = '<i class="fa fa-minus"></i>' if auto_open else '<i class="fa fa-plus"></i>'
            open_class = ' jup-open' if auto_open else ''
            toggle = f'<span class="jup-toggle">{arrow}</span>'
            children_div = f'<div class="jup-children{open_class}">{children_html}</div>'
        else:
            toggle = '<span class="jup-toggle-empty"></span>'
            children_div = ''

        html = f'''<div class="jup-node">
            <div class="jup-row" data-node-id="{hash_id}">
                {toggle}
                <i class="fa fa-{icon}"></i>
                {label}
            </div>
            {children_div}
        </div>'''

        return html, simple_node

    def _build_children_html(self, neo_obj):
        NEO_CONTAINER_ATTRIBUTES = [
            'segments', 'analogsignals', 'spiketrains', 'events',
            'epochs', 'channel_indexes', 'irregularlysampledsignals', 'imagesequences'
        ]
        parts = []
        all_child_nodes = []

        if issubclass(type(neo_obj), (self.BaseNeo, self.RegionOfInterest)):
            for attr_name in NEO_CONTAINER_ATTRIBUTES:
                if not hasattr(neo_obj, attr_name):
                    continue
                try:
                    if self.STRING_TO_NEO_OBJ[str(attr_name[:-1].lower())] not in self.NEO_OBJS_TO_SHOW:
                        continue
                except KeyError:
                    pass
                attr_list = getattr(neo_obj, attr_name)
                if not attr_list or len(attr_list) == 0:
                    continue

                folder_html, folder_node, _ = self._build_folder_html(attr_name, attr_list)
                parts.append(folder_html)
                all_child_nodes.append(folder_node)

        elif isinstance(neo_obj, (list, self.SpikeTrainList)) or neo_obj.__class__.__name__ == 'ObjectList':
            for i, child in enumerate(neo_obj):
                if type(child) not in self.NEO_OBJS_TO_SHOW:
                    continue
                child_html, child_node = self._build_node_html(child, list_index=i)
                parts.append(child_html)
                all_child_nodes.append(child_node)

        return ''.join(parts), all_child_nodes

    def _build_folder_html(self, attr_name, attr_list):
        cap = attr_name.capitalize()
        if attr_name == 'irregularlysampledsignals': cap = 'IrregularlySampledSignals'
        elif attr_name == 'channel_indexes': cap = 'Channel Indexes'

        label = f"<span style='{self.NODE_STYLE}'>{cap}</span> <b style='{self.CS}'>[{len(attr_list)}]</b>"

        children_parts = []
        child_nodes = []
        for i, child in enumerate(attr_list):
            if type(child) not in self.NEO_OBJS_TO_SHOW:
                continue
            child_html, child_node = self._build_node_html(child, list_index=i)
            children_parts.append(child_html)
            child_nodes.append(child_node)

        children_html = ''.join(children_parts)

        auto_open = self.expand_all or len(child_nodes) < 5
        arrow = '<i class="fa fa-minus"></i>' if auto_open else '<i class="fa fa-plus"></i>'

        open_class = ' jup-open' if auto_open else ''

        html = f'''<div class="jup-node">
        <div class="jup-row" data-node-id="folder-{attr_name}-{id(attr_list)}">
            <span class="jup-toggle">{arrow}</span>
            <i class="fa fa-folder"></i>
            {label}
        </div>
            <div class="jup-children{open_class}">{children_html}</div>
        </div>'''

        folder_node = SimpleNode(
            f"folder-{attr_name}-{id(attr_list)}",
            name=cap,
            metadata={"container-for": attr_name, "data-neo-object": "true"}
        )
        folder_node.nodes = child_nodes
        self._node_registry[folder_node._id] = folder_node

        return html, folder_node, child_nodes
            
    def handle_selection(self, node_id, multi_select=False, select_children=True):
        """Called from TypeScript when user clicks a node."""
        if node_id not in self._node_registry:
            return

        clicked_node = self._node_registry[node_id]

        if not multi_select:
            self.elephant_lab_entity.selected_neo_objects.clear()

        if clicked_node in self.elephant_lab_entity.selected_neo_objects:
            self.elephant_lab_entity.selected_neo_objects.discard(clicked_node)
            if select_children:
                def deselect_recurse(node):
                    for child in node.nodes:
                        self.elephant_lab_entity.selected_neo_objects.discard(child)
                        deselect_recurse(child)
                deselect_recurse(clicked_node)
        else:
            self.elephant_lab_entity.selected_neo_objects.add(clicked_node)
            if select_children:
                def select_recurse(node):
                    for child in node.nodes:
                        self.elephant_lab_entity.selected_neo_objects.add(child)
                        select_recurse(child)
                select_recurse(clicked_node)

        self.elephant_lab_entity.on_selected_neo_objects_changed.fire()
    
    # First collect all selected nodes, then fire the event only once
    # this prevents continous analyzing and plotting for multiple node selection
    # used when Shift+Clicking 
    def handle_selection_range(self, node_ids: list, with_children: bool = False):
        """Selects a range of nodes and fires the event only once at the end."""
        self.elephant_lab_entity.selected_neo_objects.clear()
        
        for node_id in node_ids:
            if node_id not in self._node_registry:
                continue
            node = self._node_registry[node_id]
            self.elephant_lab_entity.selected_neo_objects.add(node)
            if with_children:
                def select_recurse(n):
                    for child in n.nodes:
                        self.elephant_lab_entity.selected_neo_objects.add(child)
                        select_recurse(child)
                select_recurse(node)

        # Fire only once after all nodes are selected
        self.elephant_lab_entity.on_selected_neo_objects_changed.fire()

    def _get_candidates(self) -> dict:
        selected = self.elephant_lab_entity.selected_neo_objects
        source = selected if selected else self._node_registry.values()
        return {
            node._id: self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj[node._id]
            for node in source
            if not node._id.startswith('folder-')
            and node._id in self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj
        }

    def select_by_stat(self, filter_type: str, filter_data: dict):
        import json
        from elephant import statistics as elephant_stats

        candidates = self._get_candidates()

        self.elephant_lab_entity.selected_neo_objects.clear()
        selected_ids = []
        tol = 1e-4
        value = filter_data['value']

        for hash_id, neo_obj in candidates.items():
            if neo_obj is None:
                continue
            match = False
            try:
                cached = self._stat_cache.get(hash_id, {})

                if filter_type == 'firing_rate':
                    computed = cached.get('firing_rate')
                    if computed is None:
                        if hasattr(neo_obj, 't_start') and neo_obj.t_stop > neo_obj.t_start:
                            computed = float(elephant_stats.mean_firing_rate(neo_obj).magnitude)
                    match = computed is not None and abs(computed - value) < tol

                elif filter_type == 'cv':
                    computed = cached.get('cv')
                    if computed is None:
                        if hasattr(neo_obj, 'times') and len(neo_obj) > 1:
                            computed = float(elephant_stats.cv(elephant_stats.isi(neo_obj)))
                    match = computed is not None and abs(computed - value) < tol

                elif filter_type == 't_start':
                    computed = cached.get('t_start')
                    if computed is None and hasattr(neo_obj, 't_start'):
                        computed = float(neo_obj.t_start.magnitude)
                    match = computed is not None and abs(computed - value) < tol

                elif filter_type == 't_stop':
                    computed = cached.get('t_stop')
                    if computed is None and hasattr(neo_obj, 't_stop'):
                        computed = float(neo_obj.t_stop.magnitude)
                    match = computed is not None and abs(computed - value) < tol

                elif filter_type == 'duration':
                    computed = cached.get('duration')
                    if computed is None and hasattr(neo_obj, 'duration'):
                        computed = float(neo_obj.duration.magnitude)
                    match = computed is not None and abs(computed - value) < tol

            except Exception:
                pass

            if match:
                node = self._node_registry.get(hash_id)
                if node:
                    self.elephant_lab_entity.selected_neo_objects.add(node)
                    selected_ids.append(hash_id)

        self.elephant_lab_entity.on_selected_neo_objects_changed.fire()
        print(f"ELEPHANT_LAB_RESULT_KEY:{json.dumps(selected_ids)}")
    
    def select_by_annotation_filter(self, expression: str):
        def _eval_node(node, annotations, agg_values):
            if isinstance(node, self.ast.Expression):
                return _eval_node(node.body, annotations, agg_values)
            if isinstance(node, self.ast.BoolOp):
                if isinstance(node.op, self.ast.And):
                    return all(_eval_node(v, annotations, agg_values) for v in node.values)
                if isinstance(node.op, self.ast.Or):
                    return any(_eval_node(v, annotations, agg_values) for v in node.values)
            if isinstance(node, self.ast.UnaryOp) and isinstance(node.op, self.ast.Not):
                return not _eval_node(node.operand, annotations, agg_values)
            if isinstance(node, self.ast.Compare):
                left = _eval_node(node.left, annotations, agg_values)
                for op, comp in zip(node.ops, node.comparators):
                    right = _eval_node(comp, annotations, agg_values)
                    if isinstance(op, self.ast.Eq)    and not (left == right): return False
                    if isinstance(op, self.ast.NotEq) and not (left != right): return False
                    if isinstance(op, self.ast.Gt)    and not (left >  right): return False
                    if isinstance(op, self.ast.Lt)    and not (left <  right): return False
                    if isinstance(op, self.ast.GtE)   and not (left >= right): return False
                    if isinstance(op, self.ast.LtE)   and not (left <= right): return False
                    left = right
                return True
            if isinstance(node, self.ast.Call):
                if (isinstance(node.func, self.ast.Name) and
                        node.func.id in ('max', 'min') and
                        len(node.args) == 1 and
                        isinstance(node.args[0], self.ast.Name)):
                    func, key = node.func.id, node.args[0].id
                    if agg_values is None:
                        return True  # first run: ignore aggregates
                    agg_val = agg_values.get((func, key))
                    if agg_val is None:
                        return False
                    ann_val = annotations.get(key)
                    try:
                        return float(ann_val) == agg_val
                    except (TypeError, ValueError):
                        return ann_val == agg_val
                raise ValueError(f'Unsupported function: {self.ast.dump(node.func)}')
            if isinstance(node, self.ast.Name):
                if node.id in ('True', 'False', 'None'):
                    return {'True': True, 'False': False, 'None': None}[node.id]
                # look up annotation value
                return annotations.get(node.id)
            if isinstance(node, self.ast.Constant):
                return node.value
            raise ValueError(f'Unsupported expression node: {type(node).__name__}')

        normalized = self.re.sub(r'\bAND\b', 'and', expression.strip())
        normalized = self.re.sub(r'\bOR\b', 'or', normalized)
        normalized = self.re.sub(r'\bNOT\b', 'not', normalized)
        try:
            tree = self.ast.parse(normalized, mode='eval')
        except SyntaxError as e:
            print(f"ELEPHANT_LAB_FILTER_ERROR:Syntax error — {e}")
            return

        # Collect all max/min aggregate calls present in the expression
        agg_keys = set()
        for node in self.ast.walk(tree):
            if (isinstance(node, self.ast.Call) and
                    isinstance(node.func, self.ast.Name) and
                    node.func.id in ('max', 'min') and
                    len(node.args) == 1 and
                    isinstance(node.args[0], self.ast.Name)):
                agg_keys.add((node.func.id, node.args[0].id))

        candidates = self._get_candidates()

        # evaluate with max/min -> True to get base candidates
        base_candidates = {}
        for hash_id, neo_obj in candidates.items():
            if neo_obj is None:
                continue
            annotations = getattr(neo_obj, 'annotations', {}) or {}
            try:
                if bool(_eval_node(tree, annotations, agg_values=None)):
                    base_candidates[hash_id] = (neo_obj, annotations)
            except Exception:
                pass

        # Compute aggregate values across base candidates
        agg_values = {}
        for func, key in agg_keys:
            values = []
            for _, (_, annotations) in base_candidates.items():
                v = annotations.get(key)
                if v is not None:
                    try:
                        values.append(float(v))
                    except (TypeError, ValueError):
                        pass
            if values:
                agg_values[(func, key)] = (max if func == 'max' else min)(values)

        self.elephant_lab_entity.selected_neo_objects.clear()
        selected_ids = []

        for hash_id, (neo_obj, annotations) in base_candidates.items():
            try:
                # re-evaluate with aggregate values substituted (skip if no aggregates)
                if agg_keys and not bool(_eval_node(tree, annotations, agg_values)):
                    continue
                node = self._node_registry.get(hash_id)
                if node:
                    self.elephant_lab_entity.selected_neo_objects.add(node)
                    selected_ids.append(hash_id)
            except Exception:
                pass

        self.elephant_lab_entity.on_selected_neo_objects_changed.fire()
        print(f"ELEPHANT_LAB_RESULT_KEY:{self.json.dumps(selected_ids)}")

    def create_tree(self):
        self._tree_widget = self.widgets.HTML(value='')
        self._tree_widget.layout.width = '100%'
        ElephantLab_tree.display(self._tree_widget)
