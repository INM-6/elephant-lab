// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
let setup_env =
`# only available in conda env MyJupyphantClone; ipympl was additionally installed to this env
%matplotlib ipympl
from jupyphant.kernelcode import setup_env
my_jupyphant_vis_xxx = setup_env()`;

// Dummy plot code for a single AnalogSignal
let neo_plot =
`from jupyphant.kernelcode import neo_plot
neo_plot()
`;

// Dummy plot code for testing purposes
// Does not rely on any data or neo objects from the Python kernel
let plot_code = 
`from jupyphant.kernelcode import plot_code
plot_code()
`;

// Call to the function that creates a rasterplot from all spike trains
let raster_plot =
`from jupyphant.kernelcode import raster_plot
raster_plot(my_jupyphant_vis_xxx)
`;

// Call to the function that plots AnalogSignals
let lfp_plot = 
`from jupyphant.kernelcode import lfp_plot
lfp_plot(my_jupyphant_vis_xxx)
`;

// Call to the function that initializes the ipytree widget with an empty tree
let create_tree =
`from jupyphant.kernelcode import create_tree
create_tree(my_jupyphant_vis_xxx)
`;

// Call to the function that initilaizes the node explorer for the ipytree
let create_explorer =
`from jupyphant.kernelcode import create_explorer
create_explorer(my_jupyphant_vis_xxx)
`;

// Call to the function that updates the ipytree tree view of the neo hierarchy
let update_tree =
`from jupyphant.kernelcode import update_tree
update_tree(my_jupyphant_vis_xxx)
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
	'createExplorer': create_explorer,
	'updateTree': update_tree
};
