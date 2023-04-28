# This file contains Python code used as TypeScript strings in 'kernelcode.ts'..
# The TypeScript strings are passed to the Python kernel to be executed.

# Create an object of the JupyphantVisualization class
# It is used to access and visualize the neo objects
import ipympl
import matplotlib


def setup_env():
    from jupyphant.jupyphant import JupyphantVisualization
    my_jupyphant_vis_xxx = JupyphantVisualization()
    return my_jupyphant_vis_xxx


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
def raster_plot(my_jupyphant_vis_xxx):
    import matplotlib.pyplot as plt
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fig = my_jupyphant_vis_xxx.create_rasterplot()
        plt.figure(fig)
        plt.show()


# Call to the function that plots AnalogSignals
def lfp_plot(my_jupyphant_vis_xxx):
    import matplotlib.pyplot as plt
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fig = my_jupyphant_vis_xxx.create_lfpplot()
        plt.figure(fig)
        plt.show()


# Call to the function that initializes the ipytree widget with an empty tree
def create_tree(my_jupyphant_vis_xxx):
    from IPython.display import display
    my_jupyphant_vis_xxx.create_tree()
    my_jupyphant_vis_xxx.tree.layout.width = '100%'
    display(my_jupyphant_vis_xxx.tree)


def create_explorer_info(my_jupyphant_vis_xxx):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_info(change):
        selected_ids = [my_jupyphant_vis_xxx.map[node._id] for node in my_jupyphant_vis_xxx.tree.selected_nodes if
                        my_jupyphant_vis_xxx.map[node._id] is not None]
        with output_node_info:
            IPython.display.clear_output()
            # print('Some node selected!')
            # for i in range(len(change["new"])):
            #    print(f'{i}. {change["new"][i].name} -> urn_id = {change["new"][i]._id}')
            df_anasig, df_spt, df_evt, df_epc = my_jupyphant_vis_xxx.selected_nodes_to_dataframes(
                selected_ids=selected_ids)
            neo_containers = my_jupyphant_vis_xxx._extract_pretty_print_of_selected_neo_container_objects(
                selected_ids=selected_ids)
            if df_anasig:
                for df in df_anasig:
                    display(df)
            if df_spt:
                for df in df_spt:
                    display(df)
            if df_epc:
                for df in df_epc:
                    display(df)
            if df_evt:
                for df in df_evt:
                    display(df)
            if neo_containers:
                for container in neo_containers:
                    display(container)

    output_node_info = Output(layout={'border': '1px solid orange'})
    my_jupyphant_vis_xxx.tree.observe(on_selected_change_info, names='selected_nodes')
    display(output_node_info)


def create_explorer_raw_plot(my_jupyphant_vis_xxx):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import matplotlib.pyplot as plt
    import IPython
    from IPython.display import display
    from ipywidgets import Output

    def on_selected_change_raw(change):
        selected_ids = [my_jupyphant_vis_xxx.map[node._id] for node in my_jupyphant_vis_xxx.tree.selected_nodes if
                        my_jupyphant_vis_xxx.map[node._id] is not None]
        with output_node_raw_plot:
            IPython.display.clear_output()
            # print(f'Python Ids of selected nodes {selected_ids}')
            raw_st = my_jupyphant_vis_xxx.create_rasterplot(selected_ids=selected_ids)
            if raw_st:
                plt.show()
            raw_anasig = my_jupyphant_vis_xxx.create_lfpplot(selected_ids=selected_ids)
            if raw_anasig:
                plt.show()
            # print('after plot')

    output_node_raw_plot = Output(layout={'border': '1px solid orange', 'width': '900px' })
    my_jupyphant_vis_xxx.tree.observe(on_selected_change_raw, names='selected_nodes')
    display(output_node_raw_plot)


def create_explorer_statistics(my_jupyphant_vis_xxx):
    import warnings
    # warnings.filterwarnings("ignore", category=DeprecationWarning)
    # warnings.filterwarnings("ignore", category=UserWarning)
    import matplotlib.pyplot as plt
    import IPython
    from IPython.display import display
    from ipywidgets import Output, Layout

    def on_selected_change_statistics(change):
        selected_ids = [my_jupyphant_vis_xxx.map[node._id] for node in my_jupyphant_vis_xxx.tree.selected_nodes if
                        my_jupyphant_vis_xxx.map[node._id] is not None]
        with output_node_statistic:
            IPython.display.clear_output()
            fig = my_jupyphant_vis_xxx.statistics_of_selected_nodes(selected_ids=selected_ids)
            if fig:
                plt.show()

    output_node_statistic = Output(layout=Layout(border='1px solid orange', width='3572px'))  # 4 * 8inch * 96px/inch
    my_jupyphant_vis_xxx.tree.observe(on_selected_change_statistics, names='selected_nodes')
    display(output_node_statistic)

def create_explorer_dropdown(my_jupyphant_vis_xxx):
    import warnings
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    warnings.filterwarnings("ignore", category=UserWarning)
    import elephant
    import inspect

    # elephant_functions_by_module = {
    #     'cell_assembly_detection': {},
    #     'change_point_detection': {},
    #     'conversion': {},
    #     'cubic': {},
    #     'current_source_density': {},
    #     'kernels': {},
    #     'neo_tools': {},
    #     'phase_analysis': {},
    #     'signal_processing': {},
    #     'spade': {},
    #     'spectral': {},
    #     'spike_train_correlation': {},
    #     'spike_train_dissimilarity': {},
    #     'spike_train_generation': {},
    #     'spike_train_surrogates': {},
    #     'spike_train_synchrony': {},
    #     'sta': {},
    #     'statistics': {},
    #     'unitary_event_analysis': {},
    #     'utils': {},
    #     'waveform_features': {}
    # }
    # for m in elephant_functions_by_module.keys():
    #     functions = eval(f'elephant.{m}.__all__')
    #     functions_dict = {f : inspect.getfullargspec(eval(f"elephant.{m}.{f}")).args for f in functions} # TODO: signature to list
    #     elephant_functions_by_module[m] = functions_dict

    # drop_module = Dropdown(options=elephant_functions_by_module.keys(), description='Module:', disabled=False)
    # drop_function = Dropdown(options=elephant_functions_by_module[drop_module.value] , description='Function:', disabled=False)
    # drop_parameter = Dropdown(description='Parameter:', disabled=False)
    #
    # @interact(module = drop_module, function = drop_function, parameter = drop_parameter)
    # def print_function(module, function, parameter):
    #     drop_function.options = elephant_functions_by_module[module].keys()
    #     drop_parameter.options = elephant_functions_by_module[module][drop_function.value]
    #
    # def on_calculate_button_clicked(b):
    #     with output_node_analysis:
    #         IPython.display.clear_output()
    #         print("Calculation in progress!")
    #
    # def on_clear_button_clicked(b):
    #     with output_node_analysis:
    #         IPython.display.clear_output()
    #
    # output_node_analysis = Output(layout={'border': '1px solid orange'})
    # calculate_button = Button(description='Calculate', disabled=False, button_style='', tooltip='Calculate', icon='check')
    # calculate_button.on_click(on_calculate_button_clicked)
    #
    # clear_button = Button(description='Clear', disabled=False, button_style='', tooltip='Clear', icon='check')
    # clear_button.on_click(on_clear_button_clicked)
    #
    # tab_analysis= VBox([output_node_analysis, HBox([drop_module, drop_function, drop_parameter]), HBox([calculate_button, clear_button])])


# Call to the function that updates the ipytree tree view of the neo hierarchy
def update_tree(my_jupyphant_vis_xxx):
    my_jupyphant_vis_xxx.update_tree()

