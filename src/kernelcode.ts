// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
let setup_env = 
`from jupyphant.jupyphant import JupyphantVisualization
my_jupyphant_vis_xxx = JupyphantVisualization()`	

// Dummy plot code for a single AnalogSignal
let neo_plot =
`import matplotlib.pyplot as plt
plt.plot(range(len(ew_block.segments[0].analogsignals[0])), ew_block.segments[0].analogsignals[0])
plt.show();
`;

// Dummy plot code for testing purposes
// Does not rely on any data or neo objects from the Python kernel
let plot_code = 
`import matplotlib.pyplot as plt
plt.plot([1,2,3], [4,5,6])
plt.show()
`;

// Call to the function that creates a rasterplot from all spike trains
let raster_plot =
`import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    my_jupyphant_vis_xxx.plot_sptr();
`;
// Call to the function that plots AnalogSignals
let lfp_plot = 
`my_jupyphant_vis_xxx.plot_anasig();
`;
// Call to the function that initializes the ipytree widget with an empty tree
let create_tree =
`import matplotlib.pyplot as plt
import IPython
from IPython.display import display
from ipywidgets import link, HBox, VBox, IntSlider, Text, Label, Output, Tab, Dropdown, Button, interact
import elephant
import inspect

elephant_functions_by_module = {
    'cell_assembly_detection': {},
    'change_point_detection': {},
    'conversion': {},
    'cubic': {},
    'current_source_density': {},
    'kernels': {},
    'neo_tools': {},
    'phase_analysis': {},
    'signal_processing': {},
    'spade': {},
    'spectral': {},
    'spike_train_correlation': {},
    'spike_train_dissimilarity': {},
    'spike_train_generation': {},
    'spike_train_surrogates': {},
    'spike_train_synchrony': {},
    'sta': {},
    'statistics': {},
    'unitary_event_analysis': {},
    'utils': {},
    'waveform_features': {}
}
for m in elephant_functions_by_module.keys():
    functions = eval(f'elephant.{m}.__all__')
    functions_dict = {f : inspect.getfullargspec(eval(f"elephant.{m}.{f}")).args for f in functions} # TODO: signature to list
    elephant_functions_by_module[m] = functions_dict

my_jupyphant_vis_xxx.create_tree()
my_jupyphant_vis_xxx.tree.layout.width = '50%'

output_node_info = Output(layout={'border': '1px solid orange'})
output_node_plot = Output(layout={'border': '1px solid orange'})
output_node_statistic = Output(layout={'border': '1px solid orange'})
output_node_analysis = Output(layout={'border': '1px solid orange'})

def on_selected_change(change):
    selected_ids = [my_jupyphant_vis_xxx.map[node._id] for node in my_jupyphant_vis_xxx.tree.selected_nodes if my_jupyphant_vis_xxx.map[node._id] is not None]
    with output_node_info:
        IPython.display.clear_output()
        # print('Some node selected!')
        # for i in range(len(change["new"])):
        #    print(f'{i}. {change["new"][i].name} -> urn_id = {change["new"][i]._id}')
        df_spt, df_evt, df_epc = my_jupyphant_vis_xxx.selected_nodes_to_dataframes(selected_ids=selected_ids)
        if df_spt is not None:
            display(df_spt)
        if df_evt is not None:
            display(df_evt)
        if df_epc is not None:
            display(df_epc)
    with output_node_plot:
        IPython.display.clear_output()
        # print(f'Python Ids of selected nodes {selected_ids}')
        my_jupyphant_vis_xxx.plot_sptr(selected_ids=selected_ids)
        plt.show()
        # print('after plot')
    with output_node_statistic:
        IPython.display.clear_output()
        my_jupyphant_vis_xxx.statistics_of_selected_nodes(selected_ids=selected_ids)
        plt.show()

my_jupyphant_vis_xxx.tree.observe(on_selected_change, names='selected_nodes')

drop_module = Dropdown(options=elephant_functions_by_module.keys(), description='Module:', disabled=False)
drop_function = Dropdown(options=elephant_functions_by_module[drop_module.value] , description='Function:', disabled=False)
drop_parameter = Dropdown(description='Parameter:', disabled=False)

@interact(module = drop_module, function = drop_function, parameter = drop_parameter)
def print_function(module, function, parameter):
    drop_function.options = elephant_functions_by_module[module].keys()
    drop_parameter.options = elephant_functions_by_module[module][drop_function.value]

def on_calculate_button_clicked(b):
    with output_node_analysis:
        IPython.display.clear_output()
        print("Calculation in progress!")

def on_clear_button_clicked(b):
    with output_node_analysis:
        IPython.display.clear_output()

calculate_button = Button(description='Calculate', disabled=False, button_style='', tooltip='Calculate', icon='check')
calculate_button.on_click(on_calculate_button_clicked)

clear_button = Button(description='Clear', disabled=False, button_style='', tooltip='Clear', icon='check')
clear_button.on_click(on_clear_button_clicked)

tab_analysis= VBox([output_node_analysis, HBox([drop_module, drop_function, drop_parameter]), HBox([calculate_button, clear_button])])

tab_node_explorer = Tab()
tab_node_explorer.children = [output_node_info, output_node_plot, output_node_statistic, tab_analysis]
tab_node_explorer.titles = ["INFO", "RAW PLOT", "STATISTICS", "ANALYSIS"]

right_side = VBox([Label("Node Explorer:"), tab_node_explorer])
right_side.layout.width = '50%'
HBox([my_jupyphant_vis_xxx.tree, right_side])
`;
// Call to the function that updates the ipytree tree view of the neo hierarchy
let update_tree =
`my_jupyphant_vis_xxx.update_tree();
`;

// Make all strings publicly available in a dict
// This dict is used in index.ts to actually execute the code
export const pythonCode = {
	'neoPlot': neo_plot,
	'plotCode': plot_code,
	'setupEnv': setup_env,
	'rasterPlot': raster_plot,
	'lfpPlot': lfp_plot,
	'createTree': create_tree,
	'updateTree': update_tree
};
