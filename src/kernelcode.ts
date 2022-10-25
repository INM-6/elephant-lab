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
`my_setup_greeting1 = "Hello Jupyphant (from create_tree before import)"
from IPython.display import display
my_setup_greeting2 = "Hello Jupyphant (from create_tree after import)"
display(my_jupyphant_vis_xxx.create_tree())
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
