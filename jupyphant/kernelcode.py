# This file contains Python code used as TypeScript strings in 'kernelcode.ts'..
# The TypeScript strings are passed to the Python kernel to be executed.

# Create an object of the JupyphantVisualization class
# It is used to access and visualize the neo objects
import ipympl
import matplotlib
import elephant
import neo
import numpy as np
import quantities as pq

def setup_env():
    from jupyphant.jupyphant import Jupyphant
    jupyphant_entity = Jupyphant()
    return jupyphant_entity


# Dummy plot code for a single AnalogSignal
def neo_plot():
    import matplotlib.pyplot as plt
    plt.plot(range(len(ew_block.segments[0].analogsignals[0])), ew_block.segments[0].analogsignals[0])
    plt.show()


# Dummy plot code for testing purposes
# Does not rely on any data or neo objects from the Python kernel
def plot_code():
    import matplotlib.pyplot as plt
    plt.plot([1, 2, 3], [4, 5, 6])
    plt.show()


# Call to the function that creates a rasterplot from all spike trains
def raster_plot(jupyphant_entity):
    import matplotlib.pyplot as plt
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fig = jupyphant_entity.create_rasterplot()
        plt.figure(fig)
        plt.show()


# Call to the function that plots AnalogSignals
def lfp_plot(jupyphant_entity):
    import matplotlib.pyplot as plt
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fig = jupyphant_entity.create_lfpplot()
        plt.figure(fig)
        plt.show()


# Call to the function that initializes the ipytree widget with an empty tree
def create_tree(jupyphant_entity):
    from IPython.display import display
    from ipywidgets import widgets, interactive    
    jupyphant_entity.create_tree()
    jupyphant_entity.ipytree_of_neo_objects.layout.width = '100%'
    display(jupyphant_entity.ipytree_of_neo_objects)


def create_explorer_info(jupyphant_entity):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_info(change):
        with output_node_info:
            IPython.display.clear_output()
            jupyphant_entity.pretty_print_of_selected_neo_objects()

    output_node_info = Output(layout={'border': '1px solid orange'})
    jupyphant_entity.ipytree_of_neo_objects.observe(on_selected_change_info, names='selected_nodes')
    display(output_node_info)


def create_explorer_raw_plot(jupyphant_entity):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import matplotlib.pyplot as plt
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_raw(change):
        selected_ids = [jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id] for node in jupyphant_entity.ipytree_of_neo_objects.selected_nodes if
                        jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id] is not None]
        with output_node_raw_plot:
            IPython.display.clear_output()
            # print(f'Python Ids of selected nodes {selected_ids}')
            raw_st = jupyphant_entity.create_rasterplot(selected_ids=selected_ids)
            if raw_st:
                plt.show()
            raw_anasig = jupyphant_entity.create_lfpplot(selected_ids=selected_ids)
            if raw_anasig:
                plt.show()
            # print('after plot')

    output_node_raw_plot = Output(layout={'border': '1px solid orange', 'width': '900px' })
    jupyphant_entity.ipytree_of_neo_objects.observe(on_selected_change_raw, names='selected_nodes')
    display(output_node_raw_plot)

import matplotlib.pyplot as plt

def apply_elephant_analysis(jupyphant_entity, module_name: str, function_name: str, selected_ids=None, **kwargs):
    results = jupyphant_entity.apply_elephant_function(module_name, f"{function_name}", selected_ids, **kwargs)
    return results


def create_explorer_statistics(jupyphant_entity):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import matplotlib.pyplot as plt
    import IPython
    from IPython.display import display
    from ipywidgets import Output, Layout

    def on_selected_change_statistics(change):
        selected_ids = [jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id] for node in jupyphant_entity.ipytree_of_neo_objects.selected_nodes if
                        jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id] is not None]
        with output_node_statistic:
            IPython.display.clear_output()
            fig = jupyphant_entity.statistics_of_selected_nodes(selected_ids=selected_ids)
            if fig:
                plt.show()

    output_node_statistic = Output(layout=Layout(border='1px solid orange', width='3572px'))  # 4 * 8inch * 96px/inch
    jupyphant_entity.ipytree_of_neo_objects.observe(on_selected_change_statistics, names='selected_nodes')
    display(output_node_statistic)

import sys

def get_selected_neo_ids(jupyphant_entity):
    selected_ids = [
        jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node._id]
        for node in jupyphant_entity.ipytree_of_neo_objects.selected_nodes
        if node._id in jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash
    ]
    return selected_ids

def get_object_of_ids(jupyphant_entity):
    selected_ids = get_selected_neo_ids(jupyphant_entity)
    if (isinstance(selected_ids, list)):
        return [jupyphant_entity.map_neo_obj_hash_to_neo_obj[selected_id] for selected_id in selected_ids];
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj[selected_ids];
    
def get_neo_obj_from_id(jupyphant_entity, obj_id):
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj[obj_id]

def get_neo_to_hash_dict(jupyphant_entity):
    return jupyphant_entity.map_neo_obj_hash_to_neo_obj

# Call to the function that updates the ipytree tree view of the neo hierarchy
def update_tree(jupyphant_entity):
    jupyphant_entity.update_tree()

def toggle_neo_tree_objs(jupyphant_entity, neo_obj):
    jupyphant_entity.show_neo_obj(neo_obj)