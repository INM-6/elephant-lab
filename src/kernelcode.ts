let setup_env = 
`from jupyphant.jupyphant import JupyphantVisualization
my_jupyphant_vis_xxx = JupyphantVisualization()`	

let neo_plot =
`import matplotlib.pyplot as plt
plt.plot(range(len(ew_block.segments[0].analogsignals[0])), ew_block.segments[0].analogsignals[0])
plt.show();
`;

let plot_code = 
`import matplotlib.pyplot as plt
plt.plot([1,2,3], [4,5,6])
plt.show()
`;

let raster_plot =
`import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    my_jupyphant_vis_xxx.plot_sptr();
`;
let lfp_plot = 
`my_jupyphant_vis_xxx.plot_anasig();
`;
let create_tree = 
`from IPython.display import display
display(my_jupyphant_vis_xxx.create_tree())
`;
let update_tree =
`my_jupyphant_vis_xxx.update_tree();
`;
export const pythonCode = {
	'neoPlot': neo_plot,
	'plotCode': plot_code,
	'setupEnv': setup_env,
	'rasterPlot': raster_plot,
	'lfpPlot': lfp_plot,
	'createTree': create_tree,
	'updateTree': update_tree
};
