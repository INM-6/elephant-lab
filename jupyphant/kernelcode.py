# This file contains Python code used as TypeScript strings in 'kernelcode.ts'..
# The TypeScript strings are passed to the Python kernel to be executed.

# Create an object of the JupyphantVisualization class
# It is used to access and visualize the neo objects
def setup_env():
    from jupyphant.jupyphant import Jupyphant
    jupyphant_entity = Jupyphant()
    return jupyphant_entity


# Call to the function that creates a rasterplot from all spike trains
def raster_plot(jupyphant_entity):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        plotlyGraphFig = jupyphant_entity.create_rasterplot()
        if plotlyGraphFig:
            plotlyGraphFig.display()

# Call to the function that plots AnalogSignals
def lfp_plot(jupyphant_entity):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        plotlyGraphFig = jupyphant_entity.create_lfpplot()
        if plotlyGraphFig:
            plotlyGraphFig.display()


# Call to the function that initializes the ipytree widget with an empty tree
def create_tree(jupyphant_entity):
    from IPython.display import display
    jupyphant_entity.create_tree()
    jupyphant_entity.ipytree_of_neo_objects.layout.width = '100%'
    def on_selected_change_tree(change):
        jupyphant_entity.ipytree_of_neo_objects.unobserve(on_selected_change_tree, names='selected_nodes')
        old_selected_nodes = change['old']
        new_selected_nodes = change['new']

        # old_selected_nodes and new_selected_nodes are lists of Node objects
        old_set = set(old_selected_nodes)
        new_set = set(new_selected_nodes)

        def select_iteratively(nodes, selected):
            first_stack = list(nodes)

            second_stack = []
            while first_stack:
                node = first_stack.pop()
                second_stack.extend(getattr(node, 'nodes', []))
                    
            while second_stack:
                node = second_stack.pop()
                children = getattr(node, 'nodes', [])
                n_children = len(children)
                if selected:
                    jupyphant_entity.selected_neo_objects.add(node)
                else:
                    jupyphant_entity.selected_neo_objects.discard(node)
                if n_children > 0:
                    second_stack.extend(children)

        # Nodes that were newly selected
        just_selected = new_set - old_set
        just_deselected = old_set - new_set

        jupyphant_entity.selected_neo_objects.difference_update(just_deselected)
        select_iteratively(just_deselected, False)
        jupyphant_entity.selected_neo_objects.update(just_selected)
        select_iteratively(just_selected, True)

        def sync_selection_to_ui(nodes, selected_set):
            for node in nodes:
                selected = node in selected_set
                children = getattr(node, 'nodes', [])
                if children and len(children) > 0:
                    if node.selected != selected:
                        node.selected = selected
                    sync_selection_to_ui(children, selected_set)

        # Usage
        sync_selection_to_ui(jupyphant_entity.ipytree_of_neo_objects.nodes,
                            jupyphant_entity.selected_neo_objects)

        jupyphant_entity.on_selected_neo_objects_changed.fire()

        jupyphant_entity.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')
    jupyphant_entity.ipytree_of_neo_objects.observe(on_selected_change_tree, names='selected_nodes')
    display(jupyphant_entity.ipytree_of_neo_objects)


def create_explorer_info(jupyphant_entity):
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_info():
        with output_node_info:
            IPython.display.clear_output()
            jupyphant_entity.pretty_print_of_selected_neo_objects()

    output_node_info = Output(layout={'border': '1px solid orange'})
    jupyphant_entity.on_selected_neo_objects_changed.add_listener(on_selected_change_info)
    display(output_node_info)


def create_explorer_raw_plot(jupyphant_entity):
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_raw():
        selected_ids = get_selected_neo_ids(jupyphant_entity)
        with output_node_raw_plot:
            IPython.display.clear_output()
            raw_st = jupyphant_entity.create_rasterplot(selected_ids=selected_ids)
            jupyphant_entity.raw_st = raw_st
            if raw_st:
                raw_st.display()
            raw_anasig = jupyphant_entity.create_lfpplot(selected_ids=selected_ids)
            jupyphant_entity.raw_anasig = raw_anasig
            if raw_anasig:
                raw_anasig.display()

    output_node_raw_plot = Output(layout={'width': "100%", 'height': 'auto'})
    jupyphant_entity.on_selected_neo_objects_changed.add_listener(on_selected_change_raw)
    display(output_node_raw_plot)


def create_explorer_statistics(jupyphant_entity):
    import IPython
    from IPython.display import display
    from ipywidgets import Output, Layout

    def on_selected_change_statistics():
        selected_ids = get_selected_neo_ids(jupyphant_entity)
        with output_node_statistic:
            IPython.display.clear_output()
            fig = jupyphant_entity.statistics_of_selected_nodes(selected_ids=selected_ids)
            if fig:
                display(fig)

    output_node_statistic = Output(layout=Layout(border='1px solid orange', width='auto', height='auto'))
    jupyphant_entity.on_selected_neo_objects_changed.add_listener(on_selected_change_statistics)
    display(output_node_statistic)

def get_selected_neo_ids(jupyphant_entity):
    selected_ids = [
        jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id]
        for node in jupyphant_entity.selected_neo_objects
        if node._id in jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash
    ]
    return selected_ids

def get_object_of_ids(jupyphant_entity):
    selected_ids = get_selected_neo_ids(jupyphant_entity)
    if (isinstance(selected_ids, list)):
        return [jupyphant_entity.map_neo_obj_hash_to_neo_obj[selected_id] for selected_id in selected_ids]
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj[selected_ids]
    
def get_neo_obj_from_id(jupyphant_entity, obj_id):
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj[obj_id]

def get_neo_to_hash_dict(jupyphant_entity):
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj

# Call to the function that updates the ipytree tree view of the neo hierarchy
def update_tree(jupyphant_entity):
    jupyphant_entity.update_tree()

def toggle_neo_tree_objs(jupyphant_entity, neo_obj):
    jupyphant_entity.show_neo_obj(neo_obj)

def expand_neo_tree(jupyphant_entity, opened):
    jupyphant_entity.expand_neo_tree(opened)

def set_raw_plot_overlap(jupyphant_entity, overlap):
    jupyphant_entity.raw_plot_overlap = overlap
    def update_overlap(fig):
        if overlap:
            fig.overlap()
        else:
            fig.stack()
    update_plotly_figures(jupyphant_entity, update_overlap)

def update_jupyterlab_theme(jupyphant_entity, theme_name):
    jupyphant_entity.jupyterlab_theme = theme_name
    update_plotly_figures(jupyphant_entity, lambda fig: fig.update_jupyterlab_theme(theme_name))

def update_plotly_figures(jupyphant_entity, to_update):
    raw_st = None
    if hasattr(jupyphant_entity, 'raw_st'):
        raw_st = jupyphant_entity.raw_st
    if raw_st:
        to_update(raw_st)
    raw_anasig = None
    if hasattr(jupyphant_entity, 'raw_anasig'):
        raw_anasig = jupyphant_entity.raw_anasig
    if raw_anasig:
        to_update(raw_anasig)