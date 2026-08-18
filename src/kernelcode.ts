// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python methods that are called can be found in the elephant_lab
// Python module, delivered with this extension
import { PlotSettings } from './plot_settings';

function pythonValue(value: unknown): string {
	if (typeof value === "boolean") {
		return value ? "True" : "False";
	}

	if (typeof value === "string") {
		return JSON.stringify(value);
	}

	return String(value);
}

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
const setup_env =
	`# only available in conda env MyElephantLabClone; ipympl was additionally installed to this env
from elephant_lab.elephant_lab import ElephantLab
elephant_lab_entity = ElephantLab()`;

// Call to the function that initializes the ipytree widget with an empty tree
const create_tree = `elephant_lab_entity.elephant_lab_tree.create_tree()`;

// Call to the function that shows metadata info of selected nodes in Info-tab of the node-explorer Dockpanel
const create_details_panel = `elephant_lab_entity.elephant_lab_info.create_details_panel()`;

// Call to the function that updates the ipytree tree view of the neo hierarchy
const update_tree = `elephant_lab_entity.elephant_lab_tree.update_tree()`;

const createExplorerRawPlot = 'elephant_lab_entity.elephant_lab_plot.create_explorer_raw_plot()'

const version = `elephant_lab_entity.elephant_lab_util.version()`;

const getVars = `elephant_lab_entity.elephant_lab_util.getVars()`;

const insertCode = `elephant_lab_entity.insert_selected_neo_objects()`;

function setVarName(ioClass: string, filePath: string, varName: string): string {
	if (ioClass) {
		return `elephant_lab_entity.elephant_lab_util.setVarNameIOClass('${ioClass}','${filePath}', '${varName}')`;
	} else {
		return `elephant_lab_entity.elephant_lab_util.setVarNameNotIOClass('${filePath}', '${varName}')`;
	}
}

function getNeoIOClass(filename: string): string {
	return `elephant_lab_entity.elephant_lab_util.getNeoIOClass('${filename}')`;
}

function saveSelectedNeoObjects(filePath: string): string {
	return `elephant_lab_entity.save_selected_neo_objects('${filePath}')`;
}

function updatePlotSettings(settings: PlotSettings): string {
	const args = Object.entries(settings)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}=${pythonValue(value)}`);

	return `elephant_lab_entity.elephant_lab_plot.update_settings(${args.join(", ")})`;
}

function upscaleRawPlot(x_ranges: string): string {
	return `elephant_lab_entity.elephant_lab_plot.upscale_raw_plot(${x_ranges})`
}

const resetScale = `elephant_lab_entity.elephant_lab_plot.reset_scale()`;

function setPanelVisibility(exploreActive: boolean, detailsActive: boolean): string {
	return `elephant_lab_entity.set_panel_visibility(${pythonValue(exploreActive)}, ${pythonValue(detailsActive)})`;
}

function toggleNeoTreeFilter(checkbox_id: string): string {
	return `elephant_lab_entity.elephant_lab_tree.show_neo_obj("${checkbox_id}")`
}

function expandNeoTree(checked: boolean): string {
	return `elephant_lab_entity.elephant_lab_tree.expand_neo_tree(${pythonValue(checked)})`
}

function handleTreeSelection(nodeId: string, multiSelectPy: string, selectChildrenPy: string = 'True'): string {
	return `elephant_lab_entity.elephant_lab_tree.handle_selection('${nodeId}', ${multiSelectPy}, ${selectChildrenPy})`;
}

function handleSelectionRange(idsJson: string, withChildren: boolean = false): string {
	return `elephant_lab_entity.elephant_lab_tree.handle_selection_range(${idsJson}, ${withChildren ? 'True' : 'False'})`;
}

function selectByAnnotationFilter(expression: string): string {
	return `elephant_lab_entity.elephant_lab_tree.select_by_annotation_filter(${JSON.stringify(expression)})`;
}

function createGroupFromSelection(name: string): string {
	return `elephant_lab_entity.create_group_from_selection(${JSON.stringify(name)})`;
}

// Make all strings publicly available in a dict
// This dict is used in index.ts to actually execute the code
export enum PythonCodeKey {
	SetupEnv = 'setupEnv',
	CreateTree = 'createTree',
	CreateDetailsPanel = 'create_details_panel',
	UpdateTree = 'updateTree',
	CreateExplorerRaw = 'createExplorerRaw',
	Version = 'version',
	GetVars = 'getVars',
	InsertCode = 'insertCode',
	SetVarName = 'setVarName',
	SaveSelectedNeoObjects = 'saveSelectedNeoObjects',
	UpscaleRawPlot = 'upscaleRawPlot',
	ResetScale = 'resetScale',
	ToggleNeoTreeFilter = 'toggleNeoTreeFilter',
	ExpandNeoTree = 'expandNeoTree',
	GetIOClass = 'getIOClass',
	HandleTreeSelection = 'handleTreeSelection',
	HandleSelectionRange = 'handleSelectionRange',
	SelectByAnnotationFilter = 'selectByAnnotationFilter',
	CreateGroupFromSelection = 'createGroupFromSelection',
	SetPanelVisibility = 'setPanelVisibility',
	UpdatePlotSettings = 'updatePlotSettings',
}

const pythonCode: Record<PythonCodeKey, string | ((...args: any[]) => string)> = {
	[PythonCodeKey.SetupEnv]: setup_env,
	[PythonCodeKey.CreateTree]: create_tree,
	[PythonCodeKey.CreateDetailsPanel]: create_details_panel,
	[PythonCodeKey.UpdateTree]: update_tree,
	[PythonCodeKey.CreateExplorerRaw]: createExplorerRawPlot,
	[PythonCodeKey.Version]: version,
	[PythonCodeKey.GetVars]: getVars,
	[PythonCodeKey.InsertCode]: insertCode,
	[PythonCodeKey.SetVarName]: (...args: any[]) => setVarName(args[0], args[1], args[2]),
	[PythonCodeKey.SaveSelectedNeoObjects]: (...args: any[]) => saveSelectedNeoObjects(args[0]),
	[PythonCodeKey.UpscaleRawPlot]: (...args: any[]) => upscaleRawPlot(args[0]),
	[PythonCodeKey.ResetScale]: resetScale,
	[PythonCodeKey.ToggleNeoTreeFilter]: (...args: any[]) => toggleNeoTreeFilter(args[0]),
	[PythonCodeKey.ExpandNeoTree]: (...args: any[]) => expandNeoTree(args[0]),
	[PythonCodeKey.GetIOClass]: (...args: any[]) => getNeoIOClass(args[0]),
	[PythonCodeKey.HandleTreeSelection]: (...args: any[]) => handleTreeSelection(args[0], args[1], args[2]),
	[PythonCodeKey.HandleSelectionRange]: (...args: any[]) => handleSelectionRange(args[0], args[1]),
	[PythonCodeKey.SelectByAnnotationFilter]: (...args: any[]) => selectByAnnotationFilter(args[0]),
	[PythonCodeKey.CreateGroupFromSelection]: (...args: any[]) => createGroupFromSelection(args[0]),
	[PythonCodeKey.SetPanelVisibility]: (...args: any[]) => setPanelVisibility(args[0], args[1]),
	[PythonCodeKey.UpdatePlotSettings]: (...args: any[]) => updatePlotSettings(args[0]),
};

export function getPythonCode(key: PythonCodeKey, ...args: any[]): string {
	const code = pythonCode[key];
	const codeStr = typeof code === 'function' ? code(...args) : code;
	return codeStr;
}
