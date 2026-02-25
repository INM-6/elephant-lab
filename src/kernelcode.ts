// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
const setup_env =
	`# only available in conda env MyJupyphantClone; ipympl was additionally installed to this env
%matplotlib inline
from jupyphant.jupyphant import jupyphant_setup_env
jupyphant_entity = jupyphant_setup_env()`;

// Call to the function that initializes the ipytree widget with an empty tree
const create_tree = `jupyphant_entity.create_tree()`;

// Call to the function that shows metadata info of selected nodes in Info-tab of the node-explorer Dockpanel
const create_explorer_info = `jupyphant_entity.create_explorer_info()`;

// Call to the function that updates the ipytree tree view of the neo hierarchy
const update_tree = `jupyphant_entity.update_tree()`;

const createExplorerRawPlot = 'jupyphant_entity.jupyphant_plot.create_explorer_raw_plot()'

const version =
	`from jupyphant import __version__
print(__version__)
`;

const getVars = `import json, __main__; print(json.dumps(list(__main__.__dict__.keys())))`;

const insertCode = `jupyphant_entity.insert_selected_neo_objects()`;

// Make all strings publicly available in a dict
// This dict is used in index.ts to actually execute the code
export enum PythonCodeKey {
	SetupEnv = 'setupEnv',
	CreateTree = 'createTree',
	CreateExplorerInfo = 'createExplorerInfo',
	UpdateTree = 'updateTree',
	CreateExplorerRaw = 'createExplorerRaw',
	Version = 'version',
	GetVars = 'getVars',
	InsertCode = 'insertCode',
}

export const pythonCode: Record<PythonCodeKey, string> = {
	[PythonCodeKey.SetupEnv]: setup_env,
	[PythonCodeKey.CreateTree]: create_tree,
	[PythonCodeKey.CreateExplorerInfo]: create_explorer_info,
	[PythonCodeKey.UpdateTree]: update_tree,
	[PythonCodeKey.CreateExplorerRaw]: createExplorerRawPlot,
	[PythonCodeKey.Version]: version,
	[PythonCodeKey.GetVars]: getVars,
	[PythonCodeKey.InsertCode]: insertCode,
};
