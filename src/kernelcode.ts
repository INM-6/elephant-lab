// This file contains Python code as TypeScript strings.
// These strings are passed to the Python kernel to be executed.
// Python method that are called can be found in the jupyphant
// Python module, delivered with this extension

// Create an object of the Visualization class
// It is used to access and visualize the neo objects
const setup_env =
	`# only available in conda env MyJupyphantClone; ipympl was additionally installed to this env
%matplotlib inline
from jupyphant.kernelcode import setup_env
jupyphant_entity = setup_env()`;

// Call to the function that initializes the ipytree widget with an empty tree
const create_tree =
	`from jupyphant.kernelcode import create_tree
create_tree(jupyphant_entity)
`;

// Call to the function that shows metadata info of selected nodes in Info-tab of the node-explorer Dockpanel
const create_explorer_info =
	`from jupyphant.kernelcode import create_explorer_info
create_explorer_info(jupyphant_entity)
`;

// Call to the function that updates the ipytree tree view of the neo hierarchy
const update_tree =
	`from jupyphant.kernelcode import update_tree
update_tree(jupyphant_entity)
`;

const createExplorerRawPlot = 'jupyphant_entity.jupyphant_plot.create_explorer_raw_plot()'

const version =
	`from jupyphant import __version__
print(__version__)
`;

const getVars = `import json, __main__; print(json.dumps(list(__main__.__dict__.keys())))`;

const insertCode = `
import json
import __main__

try:
    if 'jupyphant_entity' in __main__.__dict__:
        jupyphant = __main__.__dict__['jupyphant_entity']
        selected_nodes = jupyphant.ipytree_of_neo_objects.selected_nodes
        
        if not selected_nodes:
            print(json.dumps({"code_to_insert": "", "error": "No nodes selected in the Neo tree." }))
        else:
            paths = []
            objects_for_list = []
            for node in selected_nodes:
                if node._id in jupyphant.map_ipytree_node_id_to_neo_obj:
                    neo_obj = jupyphant.map_ipytree_node_id_to_neo_obj[node._id]
                    
                    variable_name = node.metadata.get('variable_name', '')
                    path = jupyphant._get_obj_path(neo_obj, variable_name=variable_name)
                    if path:
                        paths.append(path)
                        objects_for_list.append(neo_obj)

            code_to_insert = ""
            if len(paths) > 1:
                all_vars = list(__main__.__dict__.keys())
                list_base_name = "jupyphant_list"
                counter = 0
                list_var_name = f"{list_base_name}_{counter}"
                while list_var_name in all_vars:
                    counter += 1
                    list_var_name = f"{list_base_name}_{counter}"
                
                __main__.__dict__[list_var_name] = objects_for_list
                
                code_to_insert = list_var_name
            elif len(paths) == 1:
                code_to_insert = paths[0]

            print(json.dumps({"code_to_insert": code_to_insert}))
    else:
        print(json.dumps({"code_to_insert": "", "error": "jupyphant_entity not found"}))

except Exception as e:
    import sys, traceback
    print(json.dumps({"code_to_insert": "", "error": str(e), "traceback": traceback.format_exc()}), file=sys.stdout)
			`;

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
