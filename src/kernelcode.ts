// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
let setup_env =
	`# only available in conda env MyJupyphantClone; ipympl was additionally installed to this env
%matplotlib inline
from jupyphant.kernelcode import setup_env
jupyphant_entity = setup_env()`;

// Call to the function that initializes the ipytree widget with an empty tree
let create_tree =
	`from jupyphant.kernelcode import create_tree
create_tree(jupyphant_entity)
`;

// Call to the function that shows metadata info of selected nodes in Info-tab of the node-explorer Dockpanel
let create_explorer_info =
	`from jupyphant.kernelcode import create_explorer_info
create_explorer_info(jupyphant_entity)
`;

// Call to the function that shows statistics plots of selected nodes in Statistics-tab of the node-explorer Dockpanel
let create_explorer_statistics =
	`from jupyphant.kernelcode import create_explorer_statistics
create_explorer_statistics(jupyphant_entity)
`;

// Call to the function that updates the ipytree tree view of the neo hierarchy
let update_tree =
	`from jupyphant.kernelcode import update_tree
update_tree(jupyphant_entity)
`;

// Make all strings publicly available in a dict
// This dict is used in index.ts to actually execute the code
export const pythonCode = {
	'setupEnv': setup_env,
	'createTree': create_tree,
	'createExplorerInfo': create_explorer_info,
	'createExplorerStatistics': create_explorer_statistics,
	'updateTree': update_tree,
};
