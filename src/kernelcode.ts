// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

function convert_bool_to_python_bool(bool: boolean): string {
	return bool ? "True" : "False";
}

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
const setup_env =
	`# only available in conda env MyJupyphantClone; ipympl was additionally installed to this env
%matplotlib inline
from jupyphant.jupyphant import Jupyphant
jupyphant_entity = Jupyphant()`;

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

function setVarName(ioClass: string, filePath: string, varName: string): string {
	if (ioClass) {
		return `
import neo
io_class = getattr(neo.io, '${ioClass}')
reader = io_class(filename='${filePath}')
${varName} = reader.read_block()
									`;
	} else {
		return `
import neo
${varName} = neo.get_io('${filePath}').read()
if (isinstance(${varName}, list)):
	${varName} = ${varName}[0]
elif (isinstance(${varName}, dict)):
	${varName} = ${varName}['blocks'][0]
print(${varName}, type(${varName}))
self.update_tree()
`;
	}
}

function saveSelectedNeoObjects(filePath: string): string {
	return `jupyphant_entity.save_selected_neo_objects('${filePath}')`;
}

function darkModeToggle(state: boolean): string {
	return `jupyphant_entity.jupyphant_plot.update_jupyterlab_plot_theme("${state ? "dark" : "white"}")`;
}

function overlapToggle(state: boolean): string {
	return `jupyphant_entity.jupyphant_plot.set_raw_plot_overlap(${convert_bool_to_python_bool(state)})`;
}

function zeroBasedToggle(state: boolean): string {
	return `jupyphant_entity.jupyphant_plot.set_zero_based(${convert_bool_to_python_bool(state)})`
}

function upscaleRawPlot(max_points: number): string {
	return `jupyphant_entity.jupyphant_plot.upscale_raw_plot(${max_points})`
}

const resetScale = `jupyphant_entity.jupyphant_plot.reset_scale()`;

function setColorGrade(colorGrade: string): string {
	return `jupyphant_entity.jupyphant_plot.set_color_grade("${colorGrade}")`
}

function toggleNeoTreeFilter(checkbox_id: string): string {
	return `jupyphant_entity.show_neo_obj("${checkbox_id}")`
}

function expandNeoTree(checked: boolean): string {
	return `jupyphant_entity.expand_neo_tree(${convert_bool_to_python_bool(checked)})`
}

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
	SetVarName = 'setVarName',
	SaveSelectedNeoObjects = 'saveSelectedNeoObjects',
	DarkModeToggle = 'darkModeToggle',
	OverlapToggle = 'overlapToggle',
	ZeroBasedToggle = 'zeroBasedToggle',
	UpscaleRawPlot = 'upscaleRawPlot',
	ResetScale = 'resetScale',
	SetColorGrade = 'setColorGrade',
	ToggleNeoTreeFilter = 'toggleNeoTreeFilter',
	ExpandNeoTree = 'expandNeoTree',
}

const pythonCode: Record<PythonCodeKey, string | ((...args: any[]) => string)> = {
	[PythonCodeKey.SetupEnv]: setup_env,
	[PythonCodeKey.CreateTree]: create_tree,
	[PythonCodeKey.CreateExplorerInfo]: create_explorer_info,
	[PythonCodeKey.UpdateTree]: update_tree,
	[PythonCodeKey.CreateExplorerRaw]: createExplorerRawPlot,
	[PythonCodeKey.Version]: version,
	[PythonCodeKey.GetVars]: getVars,
	[PythonCodeKey.InsertCode]: insertCode,
	[PythonCodeKey.SetVarName]: (...args: any[]) => setVarName(args[0], args[1], args[2]),
	[PythonCodeKey.SaveSelectedNeoObjects]: (...args: any[]) => saveSelectedNeoObjects(args[0]),
	[PythonCodeKey.DarkModeToggle]: (...args: any[]) => darkModeToggle(args[0]),
	[PythonCodeKey.OverlapToggle]: (...args: any[]) => overlapToggle(args[0]),
	[PythonCodeKey.ZeroBasedToggle]: (...args: any[]) => zeroBasedToggle(args[0]),
	[PythonCodeKey.UpscaleRawPlot]: (...args: any[]) => upscaleRawPlot(args[0]),
	[PythonCodeKey.ResetScale]: resetScale,
	[PythonCodeKey.SetColorGrade]: (...args: any[]) => setColorGrade(args[0]),
	[PythonCodeKey.ToggleNeoTreeFilter]: (...args: any[]) => toggleNeoTreeFilter(args[0]),
	[PythonCodeKey.ExpandNeoTree]: (...args: any[]) => expandNeoTree(args[0]),
};

export function getPythonCode(key: PythonCodeKey, ...args: any[]): string {
	const code = pythonCode[key];
	const codeStr = typeof code === 'function' ? code(...args) : code;
	return codeStr;
}
