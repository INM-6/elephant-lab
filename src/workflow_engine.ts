import { ISessionContext, showDialog, Dialog } from '@jupyterlab/apputils';
import { KernelMessage } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { OutputArea } from '@jupyterlab/outputarea';
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';

// Attributes of a Jupyphant Node to distinguish different types of nodes
export type DraggableItem = {
    id: string;
    name: string;
    code: string;
    is_class: boolean;
    parameters: { name: string, default: string }[];
    type?: string;
};
type JupyphantNodeProperties = {
    item: DraggableItem;
    [key: string]: any;
}

// Own Jupyphant Node Class which adds additional properties to the regular LGraphNode
class JupyphantNode extends LGraphNode {
    properties: JupyphantNodeProperties = {
        item: { id: '', name: '', code: '', is_class: false, parameters: [] }
    };
    constructor() {
        super();
    }

    // Method used to set up input for classes / functions 
    private setupInputs(): void {
        this.inputs.length = 0;
        // remove any already existing inputs and UI widgets 
        // that might be present from a previous configuration 
        if ((this as any).widgets) {
            while ((this as any).widgets.length > 0) {
                (this as any).removeWidget(0);
            }
        }
        // reset outputs
        this.outputs.length = 0;

        // Add execution pins only to "processing" nodes, not "source/variable" nodes.
        // This avoids cluttering the UI for nodes that just represent data.
        let isProcessingNode = false;
        const itemCode = this.properties.item?.code || '';
        const itemName = this.properties.item?.name || '';

        // Utility nodes (List, Print) are for processing, Data Types not 
        // TODO: rename to distinguish between Data type and non Data type
        if (itemCode.startsWith('__UTIL_') && itemCode !== '__UTIL_INTEGER__' && itemCode !== '__UTIL_LIST__') {
            isProcessingNode = true;
        }
        // Method calls (like .mean()) are processing steps.
        if (itemName.startsWith('.')) {
            isProcessingNode = true;
        }
        // Most analysis functions are processing steps.
        if (itemCode.startsWith('elephant.')) {
            isProcessingNode = true;
        }

        if (isProcessingNode) {
            this.addInput("exec in", -1);
            this.addOutput("exec out", -1);
        }

        const params = this.properties.item?.parameters;
        if (params && Array.isArray(params)) {
            params.forEach(param => {
                const propName = `param_${param.name}`;
                // if parameter is required -> set it to the default (if existing) 
                const defaultValue = (param.default === "__REQUIRED__") ? "" : param.default;
                if (this.properties[propName] === undefined) {
                    this.properties[propName] = defaultValue;
                }

                this.addInput(param.name, -1, { label: param.name });

                if (param.name !== "__self__") {
                    this.addWidget("text", param.name, this.properties[propName], (value: string) => {
                        this.properties[propName] = value;
                    }, {});
                }
            });
        }
        this.addOutput("result", -1);
    }

    // called when a new Node gets created
    override onAdded(): void {
        if (this.properties.item && this.properties.item.name) {
            this.title = this.properties.item.name;
            this.setupInputs();
        } else {
            console.warn("Node added without valid item property", this.properties);
            this.title = "Error: Invalid Item";
        }
    }

    // called when the node property changes
    override onPropertyChanged(name: string, value: any): void {
        if (name === "item") {
            if (value && value.name) {
                this.title = value.name;
                this.setupInputs();
            }
        }
    }

    // This function is overwritten so that one can add additional items on the node (currently used for the information "i")
    override onDrawForeground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
        super.onDrawForeground?.(ctx, canvas);
        if (this.flags.collapsed) {
            return;
        }

        var icon_size = 16;
        var margin = 5;
        var x = this.size[0] - icon_size - margin;
        var y = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - icon_size) / 2;

        ctx.save();
        ctx.fillStyle = "#4A90E2";
        ctx.beginPath();
        ctx.arc(x + icon_size / 2, y + icon_size / 2, icon_size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("i", x + icon_size / 2, y + icon_size / 2);
        ctx.restore();
    };

    override onMouseDown(e: MouseEvent, local_pos: [number, number], graphcanvas: LGraphCanvas): boolean {
        const ctx = graphcanvas.canvas.getContext("2d")!;
        ctx.font = 'bold 14px Arial';

        var icon_size = 16;
        var margin = 5;
        var x = this.size[0] - icon_size - margin;
        var y = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - icon_size) / 2;

        if (local_pos[0] >= x && local_pos[0] <= x + icon_size &&
            local_pos[1] >= y && local_pos[1] <= y + icon_size) {
            const widget = (graphcanvas.graph as any).widget as WorkflowEngineWidget;
            widget.showNodeInfo(this);
            return true;
        }
        return false;

    }
}
LiteGraph.registerNodeType("workflow/jupyphant_node", JupyphantNode);

// Workflow Engine Class / Widget
export class WorkflowEngineWidget extends Widget {
    private graph: LGraph | null;
    private graphCanvas: LGraphCanvas | null;
    private canvasElement: HTMLCanvasElement;
    private outputArea: OutputArea;
    private notebook_tracker: INotebookTracker; // Current active Notebook -> used for Cell Injection
    public session: ISessionContext | null; // used to execute Python Code in same session as Jupyphant 
    private elephantMenu: any = { content: "Elephant (loading...)", disabled: true };

    /*
    session, widget and notebook_tracker are used to keep track of the notebook status 
    and communicate with Jupyphant (since the WorkflowEngine is a Widget of its own)
    */
    constructor(session: ISessionContext | null = null, outputArea: OutputArea, notebook_tracker: INotebookTracker) {
        super();
        this.id = 'workflowEngine';
        this.title.label = 'Workflow Engine';
        this.title.closable = true;
        this.session = session;
        this.outputArea = outputArea;
        this.notebook_tracker = notebook_tracker;
        this.graph = null;
        this.graphCanvas = null;
        this.addClass('jp-workflowEngine');

        if (this.session) {
            this.session.ready.then(() => {
                this._buildElephantMenu();
            });
        }

        // Define general objects of the UI (Buttons & DropDowns)
        // TODO: maybe outsource this to own function?
        const header = document.createElement('h3');
        header.textContent = 'Analysis Workflow';
        header.style.textAlign = 'center';
        this.node.appendChild(header);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'workflow-button-container';

        const runWorkflowButton = document.createElement('button');
        runWorkflowButton.textContent = '▶ Run Workflow';
        runWorkflowButton.title = 'Execute the entire workflow';
        runWorkflowButton.className = 'workflow-button workflow-button-run';
        runWorkflowButton.onclick = () => { this.execute_workflow(); };
        buttonContainer.appendChild(runWorkflowButton);

        const clearWorkflowButton = document.createElement('button');
        clearWorkflowButton.textContent = '✖ Clear';
        clearWorkflowButton.title = 'Clear the workflow canvas';
        clearWorkflowButton.className = 'workflow-button workflow-button-clear';
        clearWorkflowButton.onclick = () => { this.graph?.clear(); };
        buttonContainer.appendChild(clearWorkflowButton)

        const resetZoomButton = document.createElement('button');
        resetZoomButton.textContent = '🔍 Reset Zoom';
        resetZoomButton.title = 'Reset the zoom level of the canvas';
        resetZoomButton.className = 'workflow-button workflow-button-debug';
        resetZoomButton.onclick = () => { this.graphCanvas?.ds.reset(); };
        buttonContainer.appendChild(resetZoomButton);

        const generateCodeButton = document.createElement('button');
        generateCodeButton.textContent = '</> Generate Code';
        generateCodeButton.title = 'Generate Python code from the workflow and add it to a new notebook cell';
        generateCodeButton.className = 'workflow-button workflow-button-generate';
        generateCodeButton.onclick = () => {
            this._generateCodeFromWorkflow();

        };
        buttonContainer.appendChild(generateCodeButton);

        this.node.appendChild(buttonContainer);

        this.canvasElement = document.createElement('canvas');
        this.canvasElement.id = 'workflow-canvas';
        this.node.appendChild(this.canvasElement);

        this.canvasElement.addEventListener('dragover', (event) => {
            event.preventDefault();
        });

        this.canvasElement.addEventListener('drop', (event) => {
            event.preventDefault();
            const itemString = event.dataTransfer?.getData('text/plain');
            if (itemString && itemString.trim().startsWith('{')) {
                try {
                    const item: DraggableItem = JSON.parse(itemString);
                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                    if (this.graph && this.graphCanvas) {
                        node.properties.item = item;
                        node.setProperty("item", item);
                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                        this.graph.add(node);
                    }
                } catch (e) {
                    console.error("Failed to parse dropped item:", e);
                }
            }
        });

        try {
            this.graph = new LGraph();
            (this.graph as any).widget = this;
            this.graphCanvas = new LGraphCanvas(this.canvasElement, this.graph);
            /*
            This prevents the default right click behavior of the lightgraph Canvas
            One may want to change this behavior but to prevent improper inputs, this will be prevented for now
            TODO: change this either back or overwrite with own JupyphantNodes as well as Quantity Nodes (which might actually be a good idea...)
            */

            this.graphCanvas.getCanvasMenuOptions = this._generateNodeMenu();


        } catch (e) {
            console.error("Error initializing LiteGraph:", e);
        }

        // TODO: Outsource the whole style of buttons etc. into own .css
        const style = document.createElement('style');
        style.textContent = `
        html, body, #main {
            height: 100%;
        }
        .jp-workflowEngine {
            display: flex;
            flex-direction: column;
            height: 100%;
            background-color: var(--jp-layout-color0);
        }
        .workflow-button-container {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 8px;
            background-color: var(--jp-layout-color1);
            border-bottom: 1px solid var(--jp-border-color2);
            box-shadow: 0px 1px 2px 0px rgba(0,0,0,0.1);
        }
        .workflow-button, .workflow-select {
            border: 1px solid var(--jp-border-color2);
            border-radius: 3px;
            padding: 5px 12px;
            background-color: var(--jp-layout-color2);
            color: var(--jp-ui-font-color1);
            cursor: pointer;
            font-size: var(--jp-ui-font-size1);
            transition: background-color 0.15s, border-color 0.15s;
        }
        .workflow-button:hover, .workflow-select:hover {
            background-color: var(--jp-layout-color3);
            border-color: var(--jp-border-color1);
        }
        .workflow-button:active, .workflow-select:active {
            background-color: var(--jp-layout-color1);
        }
        .workflow-button-run {
            background-color: var(--jp-brand-color1);
            color: white;
            border-color: var(--jp-brand-color1);
        }
        .workflow-button-run:hover {
            background-color: var(--jp-brand-color2);
            border-color: var(--jp-brand-color2);
        }
        .workflow-button-clear {
            background-color: var(--jp-error-color1);
            color: white;
            border-color: var(--jp-error-color1);
        }
        .workflow-button-clear:hover {
            background-color: var(--jp-error-color2);
            border-color: var(--jp-error-color2);
        }
        .workflow-button-debug {
            background-color: var(--jp-border-color2);
            color: var(--jp-ui-font-color1);
            border-color: var(--jp-border-color2);
        }
        .workflow-button-debug:hover {
            background-color: var(--jp-border-color1);
        }
        .workflow-button-generate {
            background-color: var(--jp-accent-color1);
            color: var(--jp-ui-inverse-font-color1);
            border-color: var(--jp-accent-color1);
        }
        .workflow-button-generate:hover {
            background-color: var(--jp-accent-color2);
            border-color: var(--jp-accent-color2);
        }
        .workflow-button-debug {
            background-color: var(--jp-warn-color2);
            color: var(--jp-ui-font-color0);
            border-color: var(--jp-warn-color1);
        }
        .workflow-button-debug:hover {
            background-color: var(--jp-warn-color1);
        }
        .jp-workflowEngine > #workflow-canvas {
            flex: 1 1 auto;
            border-top: 1px solid var(--jp-border-color1);
        }
        .litegraph .graphnode {
            background: var(--jp-layout-color1);
            border: 1px solid var(--jp-border-color1);
            color: var(--jp-ui-font-color1);
        }
        .litegraph .graphnode .node_title {
            color: var(--jp-ui-font-color0);
        }
        `;
        this.node.appendChild(style);
    }

    // Executed after Widget is opened
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        if (this.graph) { this.graph.start(); }
        this.onResize(Widget.ResizeMessage.UnknownSize);
    }
    // Dynamically resizing is important to keep the hitboxes of the Nodes correct
    protected onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        if (this.graphCanvas) { this.graphCanvas.resize(); }
    }

    // hide the graph after hiding the widget -> more memory efficient (?) 
    protected onAfterHide(msg: Message): void {
        super.onAfterHide(msg);
        if (this.graph) { this.graph.stop(); }
    }
    protected onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        if (this.graph) { this.graph.start(); }
        this.onResize(Widget.ResizeMessage.UnknownSize);
    }

    // Method to be called when graph Items should be updated, clearGraph will remove any existing nodes
    public async updateItems(items: any[], clearGraph: boolean = false): Promise<void> {

        if (!this.graph || !items || items.length === 0) { return; }
        console.log("Updating graph items:", items);

        if (clearGraph) {
            this.graph.clear();
            console.log("Graph cleared by 'updateItems'.");
        }

        const fullItems: DraggableItem[] = [];

        // Iterate through passed items and determine its type
        for (const item of items) {
            let name: string | null = null;
            if (typeof item === 'object' && item.name && Array.isArray(item.parameters)) {
                fullItems.push(item); continue;
            }
            // If item is a pickled object, it will be a string starting with "b'"
            if (typeof item === 'string' && item.startsWith("b'")) {
                const pickledItem: DraggableItem = { id: item, name: "Instance", code: item, is_class: false, parameters: [] };
                fullItems.push(pickledItem); continue;
            }

            // If item is a list it is probably passed from Jupyphant (passing elephant objects as list)
            if (typeof item === 'object' && item.name) {
                if (typeof item.name === 'string' && item.name.startsWith("['") && item.name.endsWith("']")) {
                    try {
                        const parsedName = JSON.parse(item.name.replace(/'/g, '"'));
                        if (Array.isArray(parsedName) && typeof parsedName[0] === 'string') {
                            name = parsedName[0];
                        }
                    } catch (e) { }
                }
                // If item starts with "[<" it is considered to be a class
                else if (typeof item.name === 'string' && item.name.startsWith("[<") && item.name.endsWith(">]")) {
                    const niceName = item.name.substring(2, item.name.length - 2).split(' object at ')[0];
                    const instanceItem: DraggableItem = { id: item.id, name: niceName, code: item.code, is_class: true, parameters: [] };
                    fullItems.push(instanceItem); continue;
                }
                else if (typeof item.id === 'string' && item.id.length > 20) {
                    const neoItem: DraggableItem = { id: item.id, name: item.name, code: item.id, is_class: false, parameters: [] };
                    fullItems.push(neoItem); continue;
                }
            }
            if (typeof item === 'string') { name = item; }
            else if (Array.isArray(item) && typeof item[0] === 'string') {
                name = item[0];
            }

            if (name) {
                const details = await this._getDetailsForName(name);
                if (details) {
                    details.code = name; fullItems.push(details);
                } else {
                    console.error(`Failed to get details for ${name}`);
                }
            } else if (!fullItems.some(fi => fi.id === item.id)) {
                console.warn("Could not parse item:", item);
            }
        }

        // Create and configure a node for each Workflow Item
        for (const [index, item] of fullItems.entries()) {
            const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
            if (node) {
                node.properties.item = item;
                node.setProperty("item", item);

                // Calculate the position for the new node depending on its parent node
                let parent_pos: [number, number] | null = (item as any).parent_pos || null;
                if (parent_pos) {
                    node.pos = [parent_pos[0] + 300, parent_pos[1] + (index * 40)];
                } else {
                    node.pos = [100, 100 + (index * (item.parameters.length > 3 ? 200 : 150))];
                }

                this.graph!.add(node);

                // If item is a class additional information (such as methods) have to be examined
                if (item.is_class) {
                    // Add DropDown for methods (if existing) 
                    const methods = await this._getMethodsFromTarget(item.code, node.pos);
                    if (methods && methods.length > 0) {
                        const methodNames = methods.map(m => m.name);
                        node.addWidget(
                            "combo",
                            "Add method",
                            "+ add method",
                            (methodName: string, widget: any, node: LGraphNode) => {
                                if (methodName === "+ add method") return;

                                // If a method (except placeholder) is selected -> create a new node for that method
                                const selectedMethod = methods.find(m => m.name === methodName);
                                if (selectedMethod) {
                                    const methodNode = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    methodNode.properties.item = selectedMethod;
                                    methodNode.setProperty("item", selectedMethod);

                                    // Paste node slightly to the right of existing parent node
                                    let x = node.pos[0] + node.size[0] + 30;
                                    let y = node.pos[1];

                                    while (this.graph!.getNodeOnPos(x, y)) {
                                        y += 30;
                                    }
                                    methodNode.pos = [x, y];

                                    this.graph!.add(methodNode);
                                    node.connect(0, methodNode, 0);
                                }

                                setTimeout(() => {
                                    widget.value = "+ add method";
                                    this.graphCanvas?.draw(true, true);
                                }, 0);
                            },
                            { values: ["+ add method", ...methodNames] }
                        );
                    }
                }
            }
        }
    }

    /* Method used to get Details for given Object (determine whether Object is a class)
    and get the Details (thus arguments) for this Object
    TODO: currently inspect is used to gather all information of the parameters -> rewrite to use PyDantic models */
    private async _getDetailsForName(fqn: string): Promise<DraggableItem | null> {
        if (!this.session || !this.session.session) { return null; }
        const code = `
        import inspect, json, sys
        def _get_params_for_obj(obj):
            param_list_for_json = []
            try:
                if inspect.isclass(obj): 
                    sig = inspect.signature(obj.__init__)
                    params = list(sig.parameters.values())[1:]
                else: 
                    sig = inspect.signature(obj) 
                    params = sig.parameters.values()
            except (ValueError, TypeError): 
                return []
            for param in params:
                if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                    default_val = param.default
                    if default_val is inspect.Parameter.empty: 
                        default_val = "__REQUIRED__" 
                    param_list_for_json.append({"name": param.name, "default": str(default_val)})
            return param_list_for_json
        try:
            fqn = "${fqn}"; parts = fqn.split('.')
            func_name = parts.pop()
            module_path = ".".join(parts)
            __import__(module_path) 
            import sys 
            module_obj = sys.modules[module_path] 
            target_obj = getattr(module_obj, func_name)
            details = {"id": fqn, "name": fqn, "is_class": inspect.isclass(target_obj), "code": fqn, "parameters": _get_params_for_obj(target_obj)}
            print(json.dumps(details))
        except Exception as e:
            try: __import__(module_path)
            except Exception as e_import: 
                print(f"Failed to import {module_path}: {e_import}", file=sys.stderr)
            print(f"Error inspecting {fqn}: {e}", file=sys.stderr); print(json.dumps(None))
        `;
        let msg_content: string = "";
        let future = this.session.session.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') { msg_content += msg.content.text; }
                else { console.warn("Kernel STDERR:", msg.content.text); }
            }
        };
        await future.done;
        try { return JSON.parse(msg_content.trim()); }
        catch (e) { console.error("Failed to parse details from kernel:", e, msg_content); return null; }
    }

    // If a Node is a class (thus is_class is true) we need to create a Dropdown for the methods
    // and create new Nodes for them
    private async _getMethodsFromTarget(target_id: string, parent_pos: [number, number]): Promise<any[] | null> {
        if (!this.session || !this.session.session) { return null; }

        const code = `
        import inspect, json, sys, pickle
        from jupyphant.kernelcode import get_neo_to_hash_dict

        # Examine parameters for a given Object
        def _get_params_for_obj(obj):
            param_list_for_json = []
            try:
                sig = inspect.signature(obj)
                params = sig.parameters.values()
            except (ValueError, TypeError): 
                return []

            param_list_for_json.append({"name": "__self__", "default": "CONNECTION_REQUIRED"})
            
            for param in params:
                if param.name == 'self': 
                    continue 
                if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                    default_val = param.default
                    if default_val is inspect.Parameter.empty: 
                        default_val = "__REQUIRED__" 
                    param_list_for_json.append({"name": param.name, "default": str(default_val)})
            return param_list_for_json
        
        item_list = []
        target_id_str = "${target_id}"
        
        try:
            target_obj = None
            # result_*HASH* is the structure internally used to track objects / results
            # so they dont need to be parsed everytime the get passed
            if target_id_str.startswith("result_"):
                global workflow_results
                if 'workflow_results' in globals() and target_id_str in workflow_results:
                    target_obj = workflow_results[target_id_str]
                else:
                    print(f"Info: Workflow not run, cannot inspect result key {target_id_str}", file=sys.stderr)

            # Target is neo Object or Elephant Function / Class
            elif "." in target_id_str and (target_id_str.startswith("neo.") or target_id_str.startswith("elephant.")):
                parts = target_id_str.split('.')
                func_name = parts.pop()
                module_path = ".".join(parts)
                __import__(module_path)
                module_obj = sys.modules[module_path]
                target_obj = getattr(module_obj, func_name)

            # Target is a pickled string
            elif target_id_str.startswith("b'"):
                target_obj = pickle.loads(eval(target_id_str)) 
                if isinstance(target_obj, list):
                    target_obj = target_obj[0]

            else:
                # Try to get Object using Neo Hash
                global jupyphant_entity 
                neo_hash_obj_dict = get_neo_to_hash_dict(jupyphant_entity)
                target_obj = neo_hash_obj_dict[target_id_str]

            if target_obj is not None:
                all_members = inspect.getmembers(target_obj)
                for name, member_obj in all_members:
                    # leave out private methods and the ones which are not callable
                    if not name.startswith("_") and callable(member_obj):
                        if inspect.isclass(member_obj):
                            continue
                        
                        new_code = f"{target_id_str}.{name}"
                        item_list.append({
                            "id": f"{target_id_str}.{name}",
                            "name": f".{name}()",
                            "is_class": False,
                            "code": new_code, 
                            "parameters": _get_params_for_obj(member_obj)
                        })
            
            print(json.dumps(item_list))

        except Exception as e:
            print(f"Error inspecting target {target_id_str}: {e}", file=sys.stderr)
            print(json.dumps([]))
        `;

        let msg_content: string = "";
        let future = this.session.session.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg) && msg.content.name === 'stdout') {
                msg_content += msg.content.text;
            } else if (KernelMessage.isStreamMsg(msg)) {
                console.warn("Kernel STDERR:", msg.content.text);
            }
        };
        await future.done;
        try {
            const items = JSON.parse(msg_content.trim());
            return items.map((item: any) => ({ ...item, parent_pos: parent_pos }));
        }
        catch (e) {
            console.error("Failed to parse method list from kernel:", e, msg_content);
            return null;
        }
    }

    /* This method returns a sorted list in what order the nodes should be executed
    /  Nodes without any input are treated as if they are variables, thus need to be executed first.
    */
    private _getExecutionOrder(): LGraphNode[] {
        if (!this.graph) {
            return [];
        }

        const nodes: LGraphNode[] = (this.graph as any)._nodes;
        const sortedList: LGraphNode[] = [];
        const visited = new Set<LGraphNode>();

        // Find all nodes that are starting points of execution chains
        const startNodes = nodes.filter(node => {
            // A node is a start node if its 'exec in' slot is not connected
            const execInput = node.inputs.find(input => input.type === -1);
            return !execInput || execInput.link === null;
        });

        if (startNodes.length === 0 && nodes.length > 0) {
            console.warn("Could not find a starting node for the workflow. Defaulting to all nodes.");
            // Fallback: return all nodes if no start node is found
            return nodes;
        }

        const queue: LGraphNode[] = [...startNodes];

        while (queue.length > 0) {
            const currentNode = queue.shift()!;

            if (visited.has(currentNode)) {
                continue;
            }
            visited.add(currentNode);
            sortedList.push(currentNode);

            // Find the 'exec out' slot and see what it's connected to
            const execOutput = currentNode.outputs.find(output => output.type === -1);
            if (execOutput && execOutput.links) {
                for (const linkId of execOutput.links) {
                    const link = this.graph.links[linkId];
                    if (link) {
                        const nextNode = this.graph.getNodeById(link.target_id);
                        if (nextNode && !visited.has(nextNode)) {
                            queue.push(nextNode);
                        }
                    }
                }
            }
        }

        for (const node of nodes) {
            if (!visited.has(node)) {
                sortedList.push(node);
                console.warn(`Node "${node.title}" is not connected to the execution path and will be appended to the end.`);
            }
        }

        return sortedList;
    }

    // Main function to execute the workflow
    // TODO: maybe split this function a bit into parts
    public async execute_workflow() {
        console.log("1. Workflow execution started.");
        const outputArea = this._getWorkflowOutputArea();
        if (!outputArea) {
            console.error("Could not find output area to run workflow.");
            return;
        }
        if (!this.graph) { return; }

        outputArea.model.clear();

        const resultsDictName = "workflow_results";
        await this.executeCode(
            `import uuid, json, pickle, sys\n${resultsDictName} = {}`,
            true,
            outputArea
        );

        const executionOrder = this._getExecutionOrder();
        console.log("2. Execution order:", executionOrder.map(n => n.title));

        const executed_nodes = new Map<LGraphNode, string | null>();

        for (const node of executionOrder) {
            await this.executeNode(node, executed_nodes, outputArea);
        }

        let last_result_key: string | null = null;
        if (executionOrder.length > 0) {
            last_result_key = executed_nodes.get(executionOrder[executionOrder.length - 1]) || null;
        }

        if (last_result_key) {
            console.log(`8. Workflow finished. The last result is stored in key: ${last_result_key}`);
        } else {
            console.log("8. Workflow finished. No final result key was captured.");
        }
    }

    private async executeNode(node: LGraphNode, executed_nodes: Map<LGraphNode, string | null>, outputArea: OutputArea): Promise<string | null> {
        if (executed_nodes.has(node)) {
            return executed_nodes.get(node) || null;
        }

        if (!(node instanceof JupyphantNode)) {
            console.log("3a. Skipping non-Jupyphant node:", node.title);
            executed_nodes.set(node, null);
            return null;
        }

        const jupyphantNode = node as JupyphantNode;
        const item = jupyphantNode.properties.item;

        if (!item || !item.code || !this.session || !this.session.session) {
            console.log("3b. Skipping node, invalid item/code/session:", item.name);
            executed_nodes.set(jupyphantNode, null);
            return null;
        }

        console.log("4. Processing node:", item.name);

        // resolve Dependencies of previous graph nodes to correctly execute 
        const args: (string | null)[] = [];
        if (item.parameters && item.parameters.length > 0) {
            console.log("...collecting parameters for", item.name);
            for (const param of item.parameters) {
                const inputIndex = jupyphantNode.inputs.findIndex(i => i.name === param.name);
                let value: string | null = null;

                if (inputIndex !== -1 && jupyphantNode.inputs[inputIndex].link !== null) {
                    const linkInfo = this.graph!.links[jupyphantNode.inputs[inputIndex].link!];
                    if (linkInfo) {
                        const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                        if (originNode) {
                            console.log(`... ${item.name} depends on ${originNode.title}`);
                            value = await this.executeNode(originNode, executed_nodes, outputArea);
                        }
                    }
                } else {
                    const propName = `param_${param.name}`;
                    value = (jupyphantNode.properties[propName] as string) || null;
                }
                args.push(value);
            }
        }
        console.log("5. Collected string args/keys:", args);


        let codeToExecute = "";
        const resultId = `result_${crypto.randomUUID().replace(/-/g, '_')}`;
        const args_json_string = JSON.stringify(args);
        const resultsDictName = "workflow_results";


        // Code is pickled python code
        if (item.code.startsWith("b'")) {
            console.log("...using INSTANCE (pickle) execution logic");
            codeToExecute = `try:
    data = pickle.loads(${item.code})
    result = data[0]
    ${resultsDictName}["${resultId}"] = result
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 
except Exception as e:
    print(f"Error loading instance ${item.name}: {e}", file=sys.stderr)`;
        }

        // Code logic for a list
        else if (item.code === "__UTIL_LIST__") {
            console.log("...using UTILITY (List) execution logic");
            codeToExecute = `try: 
    _prepare_arg
except NameError:
    def _prepare_arg(arg_str):
        global ${resultsDictName}
        if isinstance(arg_str, str):
            if arg_str in ${resultsDictName}: return ${resultsDictName}[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            try: return eval(arg_str)
            except: return arg_str
        return arg_str

try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    final_list = [arg for arg in processed_args if arg is not None]
    
    ${resultsDictName}["${resultId}"] = final_list
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error creating list: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_INTEGER__') {
            console.log("...using UTILITY (Integer) execution logic");
            codeToExecute = `try:
    _prepare_arg
except NameError:
    def _prepare_arg(arg_str):
        global ${resultsDictName}
        if isinstance(arg_str, str):
            if arg_str in ${resultsDictName}: return ${resultsDictName}[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            try: return eval(arg_str)
            except: return arg_str
        return arg_str
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    integer_value = int(processed_args[0])
    ${resultsDictName}["${resultId}"] = integer_value
    print(f"JUPYPHANT_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error in Integer node: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_PRINT__') {
            console.log("...using UTILITY (Print) execution logic");
            codeToExecute = `try: 
    _prepare_arg
except NameError:
    def _prepare_arg(arg_str):
        global ${resultsDictName}
        if isinstance(arg_str, str):
            if arg_str in ${resultsDictName}: return ${resultsDictName}[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            try: return eval(arg_str)
            except: return arg_str
        return arg_str
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    printed_results = [arg for arg in processed_args if arg is not None]
    for res in printed_results:
        print(res)
    ${resultsDictName}["${resultId}"] = printed_results
    print(f"JUPYPHANT_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error in Print node: {e}", file=sys.stderr)`;
        }

        // Node is class method logic
        else if (item.name.startsWith(".")) {
            console.log("...using METHOD execution logic for:", item.code);

            const parts = item.code.split('.');
            const method_name = parts.pop();

            codeToExecute = `try: 
    _prepare_arg
except NameError:
    def _prepare_arg(arg_str):
        global ${resultsDictName}
        if isinstance(arg_str, str):
            if arg_str in ${resultsDictName}: return ${resultsDictName}[arg_str]
        if arg_str == "" or arg_str == "__REQUIRED__": return None
        try: return eval(arg_str)
        except: return arg_str
        return arg_str

try:
    target_obj = None
    raw_args = json.loads('''${args_json_string}''')
    self_id = raw_args[0] if len(raw_args) > 0 else None

    target_obj = _prepare_arg(self_id)

    if target_obj is None:
            raise ValueError(f"Method '${method_name}' called without a connected object instance.")

    method_to_run = getattr(target_obj, "${method_name}")

    method_args = raw_args[1:]
    processed_args = [_prepare_arg(arg) for arg in method_args]

    result = method_to_run(*processed_args)
        
    ${resultsDictName}["${resultId}"] = result
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error running method ${item.name}: {e}", file=sys.stderr)`;
        }

        else if (item.code.includes(".")) {
            console.log("...using NAME (function/class) execution logic");
            const parts = item.code.split('.');
            const functionName = parts.pop();
            const modulePath = parts.join('.');

            if (!modulePath || !functionName) {
                console.error("Invalid item.code:", item.code);
                executed_nodes.set(jupyphantNode, null);
                return null;
            }

            const paramNames = item.parameters.map(p => p.name);
            const paramNamesJson = JSON.stringify(paramNames);

            codeToExecute = `import elephant.statistics, neo
import quantities as pq
import numpy as np

try:
    __import__("${modulePath}")
    module_obj = sys.modules["${modulePath}"]
except ImportError:
    print(f"Error: Could not import module ${modulePath}", file=sys.stderr)
    module_obj = None

def _prepare_arg(arg_str):
    global ${resultsDictName}
    if isinstance(arg_str, str):
        if arg_str in ${resultsDictName}:
            return ${resultsDictName}[arg_str]
    if arg_str == "" or arg_str == "__REQUIRED__":
        return None
    try:
        return eval(arg_str)
    except:
        return arg_str

try:
    if module_obj:
        method_to_run = getattr(module_obj, "${functionName}")
        raw_args = json.loads('''${args_json_string}''')
        param_names = json.loads('''${paramNamesJson}''')
        processed_args = [_prepare_arg(arg) for arg in raw_args]

        kwargs = dict(zip(param_names, processed_args))

        if "${functionName}" == "SpikeTrain" and isinstance(kwargs.get('times'), list):
            kwargs['times'] = np.array(kwargs['times'], dtype=np.float64)

        result = method_to_run(**kwargs)

        ${resultsDictName}["${resultId}"] = result
        print(f"JUPYPHANT_RESULT_KEY:${resultId}") 
    else:
        print(f"Error: Module ${modulePath} not loaded.", file=sys.stderr)
except Exception as e:
    print(f"Error running ${item.name} (name): {e}", file=sys.stderr)`;
        }

        // Get Object by variable name from notebook scope
        else {
            console.log("...using VARIABLE NAME (neo) execution logic");
            const varName = item.code;
            codeToExecute = `try:
    node_id = "${varName}"
    if node_id in jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash:
        neo_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node_id]
        result = jupyphant_entity.map_neo_obj_hash_to_neo_obj[neo_hash]
    elif node_id in globals():
        result = globals()[node_id]
    else:
        result = None
        print(f"Error: Variable or node id '{varName}' not found.", file=sys.stderr)
    
    if result is not None:
        ${resultsDictName}["${resultId}"] = result
        print(f"JUPYPHANT_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error getting object for variable ${varName}: {e}", file=sys.stderr)`;
        }

        console.log("6. Executing code for", item.name);
        const result_key = await this.executeCode(codeToExecute, true, outputArea);

        if (result_key && result_key.startsWith("result_")) {
            console.log("7. Got result key for", item.name, ":", result_key);
            const dataOutputIndex = jupyphantNode.outputs.findIndex(o => o.name === 'result');
            if (dataOutputIndex !== -1) {
                jupyphantNode.setOutputData(dataOutputIndex, result_key);
            }
            executed_nodes.set(jupyphantNode, result_key);
            return result_key;
        } else {
            if (result_key) {
                console.warn("7. Got error or unexpected stdout for", item.name, ":", result_key);
            }
            executed_nodes.set(jupyphantNode, null);
            return null;
        }
    }


    // Run Code in specific OutputArea (e.g. Jupyphants-Text-Output or -Plot-Output)
    private async executeCode(code: string, executeCode = false, outputArea: OutputArea): Promise<string | null> {
        let codeToRun: string;
        if (executeCode) {
            codeToRun = code;
        }
        else {
            codeToRun = `print(${JSON.stringify(code)})`;
        }
        if (!this.session || !this.session.session) {
            return null;
        }

        let future = this.session.session.kernel!.requestExecute({ code: codeToRun });

        let stdout_accumulator: string = "";

        // this code is in principal just used to execute Python Code in kernel
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            const msg_type = msg.header.msg_type;
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') {
                    const text = msg.content.text;
                    const lines = text.split('\n');
                    const lines_to_print: string[] = [];
                    for (const line of lines) {
                        if (line.trim().startsWith("JUPYPHANT_RESULT_KEY:")) {
                            stdout_accumulator += line.trim().substring("JUPYPHANT_RESULT_KEY:".length);
                        } else {
                            lines_to_print.push(line);
                        }
                    }
                    if (lines_to_print.length > 0) {
                        const new_text = lines_to_print.join('\n');
                        if (new_text.trim().length > 0) {
                            const output: any = { ...msg.content, text: new_text, output_type: msg_type };
                            outputArea.model.add(output);
                        }
                    }
                } else if (msg.content.name === 'stderr') {
                    console.warn("Kernel STDERR:", msg.content.text);
                    const output: any = { ...msg.content, output_type: msg_type };
                    outputArea.model.add(output);
                }
            } else if (msg_type === 'display_data' || msg_type === 'execute_result' || msg_type === 'error') {
                const output: any = { ...msg.content, output_type: msg_type };
                outputArea.model.add(output);
            } else if (msg_type === 'clear_output') {
                outputArea.model.clear(false);
            }
        };

        await future.done;

        return stdout_accumulator ? stdout_accumulator.trim() : null;
    }

    // Helper function to get Text-OutputArea of Jupyphant (for Plot you may use another one)
    private _getWorkflowOutputArea(): OutputArea | null {
        try {
            return this.outputArea;
        } catch (e) {
            console.error("Could not find OutputArea!", e);
            return null;
        }
    }

    // Inserts given string below the current active Cell
    // This may be used for Code or Comments
    private _insertNotebookCellBelow(context: string) {
        let currentNotebook = this.notebook_tracker.currentWidget?.content;
        if (!currentNotebook) {
            return;
        }
        NotebookActions.insertBelow(currentNotebook);
        const activeCell = currentNotebook.activeCell;
        if (activeCell) {
            activeCell.model.sharedModel.setSource(`# Code generated using Workflow Engine\n${context}`)
        }
    }


    private _generateCodeFromWorkflow() {
        const allNodes = (this.graph as any)._nodes as JupyphantNode[];
        const nodeResultNames = new Map<LGraphNode, string>();
        const codeLines: string[] = [];
        const imports = new Set<string>();
        let varCounter = 0;
        const generatedNodes = new Set<LGraphNode>();
        const loadedObjects = new Map<string, string>();

        const sanitizeVarName = (name: string) => {
            const namePart = name.split(' ')[0];
            let sanitized = namePart.toLowerCase()
                .replace(/\(\)/g, '')
                .replace(/[^a-z0-9_]/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(/^[^a-z_]*/, '');
            if (!sanitized || sanitized === 'list' || sanitized === 'print') {
                return `result_${varCounter++}`;
            }
            return sanitized;
        };

        const generateCodeForNode = (jupyphantNode: JupyphantNode) => {
            if (generatedNodes.has(jupyphantNode)) {
                return;
            }

            const item = jupyphantNode.properties.item;

            if (!item || !item.code) {
                generatedNodes.add(jupyphantNode);
                return;
            }

            // Recursively generate code for dependencies first
            if (item.parameters) {
                for (const param of item.parameters) {
                    const input = jupyphantNode.inputs.find(inp => inp.name === param.name);
                    if (input && input.link != null) {
                        const linkInfo = this.graph!.links[input.link];
                        if (linkInfo) {
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                            if (originNode instanceof JupyphantNode) {
                                generateCodeForNode(originNode);
                            }
                        }
                    }
                }
            }

            let resultVarName = sanitizeVarName(item.name);
            const originalName = resultVarName;
            let counter = 1;
            while (Array.from(nodeResultNames.values()).includes(resultVarName)) {
                resultVarName = `${originalName}_${counter++}`;
            }
            nodeResultNames.set(jupyphantNode, resultVarName);

            const processedArgs: { name: string, value: string, isSelf: boolean }[] = [];
            if (item.parameters) {
                for (const param of item.parameters) {
                    const propName = `param_${param.name}`;
                    let argumentValue: string;

                    const input = jupyphantNode.inputs.find(inp => inp.name === param.name);

                    if (input && input.link != null) {
                        const linkInfo = this.graph!.links[input.link];
                        if (linkInfo) {
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                            if (originNode && nodeResultNames.has(originNode)) {
                                argumentValue = nodeResultNames.get(originNode)!;
                            } else {
                                argumentValue = 'None';
                            }
                        } else {
                            argumentValue = 'None';
                        }
                    } else {
                        const value = String(jupyphantNode.properties[propName] ?? '');
                        if (value === "" || value === "__REQUIRED__") {
                            argumentValue = "None";
                        } else if (value === "None" || value === "True" || value === "False") {
                            argumentValue = value;
                        } else if (!isNaN(parseFloat(value)) && isFinite(Number(value))) {
                            argumentValue = value;
                        } else if (value.startsWith("[") && value.endsWith("]")) {
                            argumentValue = value;
                        } else if (value.includes("pq.")) {
                            argumentValue = value;
                            imports.add("import quantities as pq");
                        } else {
                            argumentValue = `'${value.replace(/'/g, "\\'")}'`;
                        }
                    }

                    processedArgs.push({
                        name: param.name,
                        value: argumentValue,
                        isSelf: param.name === '__self__'
                    });
                }
            }

            let lineOfCode = '';

            if (item.code.startsWith("b'") || (item.id.length > 20 && !item.code.includes("."))) {
                loadedObjects.set(resultVarName, item.name);
            } else if (item.code === "__UTIL_LIST__") {
                const listItems = processedArgs.filter(arg => arg.value !== 'None').map(arg => arg.value).join(', ');
                lineOfCode = `${resultVarName} = [${listItems}]`;
            } else if (item.code === "__UTIL_INTEGER__") {
                const intValue = processedArgs.length > 0 ? processedArgs[0].value : "0";
                lineOfCode = `${resultVarName} = ${intValue}`;
            } else if (item.code === '__UTIL_PRINT__') {
                const arg_to_print = processedArgs.length > 0 ? processedArgs[0].value : "''";
                lineOfCode = `print(${arg_to_print})`;
            } else if (item.name.startsWith(".")) {
                const methodName = item.name.substring(1).replace('()', '');
                const self_arg = processedArgs.find(arg => arg.isSelf)?.value;

                if (!self_arg) {
                    console.warn(`'self' argument not found for method ${methodName}`);
                    generatedNodes.add(jupyphantNode);
                    return;
                }

                const method_args = processedArgs
                    .filter(arg => !arg.isSelf && arg.value !== 'None')
                    .map(arg => `${arg.name}=${arg.value}`)
                    .join(', ');

                lineOfCode = `${resultVarName} = ${self_arg}.${methodName}(${method_args})`;
            } else if (item.code.includes(".")) {
                const fqn = item.code;
                const parts = fqn.split('.');
                const modulePath = parts.slice(0, -1).join('.');
                if (modulePath) {
                    imports.add(`import ${modulePath}`);
                }
                const processed_args = processedArgs
                    .filter(arg => arg.value !== 'None')
                    .map(arg => `${arg.name}=${arg.value}`)
                    .join(', ');
                lineOfCode = `${resultVarName} = ${fqn}(${processed_args})`;
            } else {
                loadedObjects.set(resultVarName, item.name);
            }

            if (lineOfCode) {
                codeLines.push(lineOfCode);
            }

            generatedNodes.add(jupyphantNode);
        };

        for (const node of allNodes) {
            if (node instanceof JupyphantNode) {
                generateCodeForNode(node);
            }
        }

        const importLines = Array.from(imports).join('\n');
        const fullCode = (importLines ? importLines + '\n\n' : '') + codeLines.join('\n');

        this._insertNotebookCellBelow(fullCode);
    }

    // Extract Docstring of passed code
    private async _getDocstring(code: string): Promise<string | null> {
        if (!this.session || !this.session.session) { return null; }
        const pythonCode = `
import inspect, json, sys, pprint

target_obj = None
info_parts = []

try:
    fqn = "${code}"
    parts = fqn.split('.')
    func_name = parts.pop()
    module_path = ".".join(parts)

    if module_path:
        try:
            __import__(module_path)
            module_obj = sys.modules[module_path]
            target_obj = getattr(module_obj, func_name, None)
        except ImportError:
            pass # Module not found, will try eval

    if target_obj is None:
        try:
            # Fallback for notebook variables or other non-module objects
            target_obj = eval(fqn)
        except Exception:
            info_parts.append(f"Could not find object '{fqn}'")

    if target_obj is not None:
        # Get pretty-printed representation first
        try:
            representation = pprint.pformat(target_obj)
            info_parts.append(representation)
        except Exception as e_pprint:
            info_parts.append(f"Could not get representation for '{fqn}': {e_pprint}")

        # Then get docstring
        docstring = inspect.getdoc(target_obj)
        if docstring:
            info_parts.append("\\n\\n--- Docstring ---\\n")
            info_parts.append(docstring)
    
    final_info = "".join(info_parts)
    print(json.dumps(final_info if final_info else None))

except Exception as e:
    print(json.dumps(f"An error occurred while trying to get info for '{code}': {str(e)}"))
        `;
        let msg_content: string = "";
        let future = this.session.session.kernel!.requestExecute({ code: pythonCode });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') { msg_content += msg.content.text; }
                else { console.warn("Kernel STDERR:", msg.content.text); }
            }
        };
        await future.done;
        try { return JSON.parse(msg_content.trim()); }
        catch (e) { console.error("Failed to parse docstring from kernel:", e, msg_content); return null; }
    }

    // Create docstring for given Node and display it
    public async showNodeInfo(node: JupyphantNode) {
        const code = node.properties.item.code;
        const docstring = await this._getDocstring(code);

        const body = document.createElement('pre');
        body.textContent = docstring || "No docstring found.";
        body.style.whiteSpace = 'pre-wrap';
        body.style.wordWrap = 'break-word';
        body.style.maxHeight = '50vh';
        body.style.overflowY = 'auto';


        showDialog({
            title: `Documentation for ${node.properties.item.name}`,
            body: new Widget({ node: body }),
            buttons: [Dialog.okButton({ label: 'Close' })]
        });
    }

    // TODO: this code is hard to read / write, maybe there is another way?
    private _generateNodeMenu() {

        return () => {
            return [
                {
                    content: "Output",
                    submenu: {
                        options: [
                            {
                                content: "Print",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/print_node",
                                        name: "Print",
                                        code: "__UTIL_PRINT__",
                                        is_class: false,
                                        parameters: [
                                            { name: "item to print", default: "" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            },
                            {
                                content: "Plot",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/plot_node",
                                        name: "Plot",
                                        code: "__UTIL_PLOT__",
                                        is_class: false,
                                        parameters: [
                                            { name: "item to plot", default: "" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            }
                        ]
                    }
                },
                {
                    content: "Data Types",
                    submenu: {
                        options: [
                            {
                                content: "List",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/list_node",
                                        name: "List",
                                        code: "__UTIL_LIST__",
                                        is_class: false,
                                        parameters: [
                                            { name: "item 0", default: "" },
                                            { name: "item 1", default: "" },
                                            { name: "item 2", default: "" },
                                            { name: "item 3", default: "" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            },
                            {
                                content: "Integer",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/integer",
                                        name: "Integer",
                                        code: "__UTIL_INTEGER__",
                                        is_class: false,
                                        parameters: [
                                            { name: "value", default: "__REQUIRED__" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            },

                        ]
                    }
                },
                {
                    content: "Neo",
                    submenu: {
                        options: [
                            {
                                content: "neo.io.nixio",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/neoio",
                                        name: "to be implemented...",
                                        code: "NeoIO",
                                        is_class: false,
                                        parameters: []
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }

                            },
                            {
                                content: "neo.SpikeTrain",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "neo/spiketrain",
                                        name: "neo.SpikeTrain",
                                        code: "neo.SpikeTrain",
                                        is_class: true,
                                        parameters: [
                                            { name: "times", default: "__REQUIRED__" },
                                            { name: "t_stop", default: "__REQUIRED__" },
                                            { name: "units", default: "s" },
                                            { name: "t_start", default: "0 * pq.s" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            }
                        ]
                    }
                },
                {
                    content: "Quantity",
                    callback: (value: any, options: any, event: any, parentMenu: any) => {
                        const item: DraggableItem = {
                            id: "util/quantity",
                            name: "Quantity",
                            code: "quantities.Quantity",
                            is_class: true,
                            parameters: [
                                { name: "data", default: "__REQUIRED__" },
                                { name: "units", default: "__REQUIRED__" }
                            ]
                        };
                        const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                        if (this.graph && this.graphCanvas) {
                            node.properties.item = item;
                            node.setProperty("item", item);
                            node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                            this.graph.add(node);
                        }
                    }
                },
                this.elephantMenu
            ].filter(Boolean);
        };
    }

    private async _buildElephantMenu() {
        const elephantData = await this._getElephantMembers();
        if (elephantData) {
            this.elephantMenu = this._createElephantMenu(elephantData);
        } else {
            this.elephantMenu = { content: "Elephant (error loading)", disabled: true };
        }
    }

    // Automatically create nodes for every elephant module and function
    private _createElephantMenu(elephantData: { [moduleName: string]: { name: string, is_class: boolean }[] }): any {
        const moduleOptions: any[] = [];

        const sortedModuleNames = Object.keys(elephantData).sort();

        for (const moduleName of sortedModuleNames) {
            const members = elephantData[moduleName];
            const functionOptions: any[] = [];

            const sortedMembers = members.sort((a, b) => a.name.localeCompare(b.name));

            for (const member of sortedMembers) {
                const fqn = `${moduleName}.${member.name}`;
                functionOptions.push({
                    content: member.name,
                    callback: async (value: any, options: any, event: any, parentMenu: any) => {
                        const details = await this._getDetailsForName(fqn);
                        if (details) {
                            const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                            if (this.graph && this.graphCanvas) {
                                node.properties.item = details;
                                node.setProperty("item", details);
                                node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                this.graph.add(node);
                                if (node.properties.item.is_class) {
                                    // Add DropDown for methods (if existing) 
                                    const methods = await this._getMethodsFromTarget(node.properties.item.code, node.pos);
                                    if (methods && methods.length > 0) {
                                        const methodNames = methods.map(m => m.name);
                                        node.addWidget(
                                            "combo",
                                            "Add method",
                                            "+ add method",
                                            (methodName: string, widget: any, node: LGraphNode) => {
                                                if (methodName === "+ add method") return;

                                                // If a method (except placeholder) is selected -> create a new node for that method
                                                const selectedMethod = methods.find(m => m.name === methodName);
                                                if (selectedMethod) {
                                                    const methodNode = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                                                    methodNode.properties.item = selectedMethod;
                                                    methodNode.setProperty("item", selectedMethod);
                                                    // Paste node slightly to the right of existing parent node
                                                    let x = node.pos[0] + node.size[0] + 30;
                                                    let y = node.pos[1];

                                                    while (this.graph!.getNodeOnPos(x, y)) {
                                                        y += 30;
                                                    }
                                                    methodNode.pos = [x, y];

                                                    this.graph!.add(methodNode);
                                                    node.connect(0, methodNode, 0);
                                                }

                                                setTimeout(() => {
                                                    widget.value = "+ add method";
                                                    this.graphCanvas?.draw(true, true);
                                                }, 0);
                                            },
                                            { values: ["+ add method", ...methodNames] }
                                        );
                                    }
                                }
                            }
                        } else {
                            console.error(`Could not get details for ${fqn}`);
                            showDialog({
                                title: 'Error',
                                body: `Could not get details for ${fqn}. Check the browser console for more information.`,
                                buttons: [Dialog.okButton()]
                            });
                        }
                    }
                });
            }

            const displayModuleName = moduleName.split('.').pop();

            moduleOptions.push({
                content: displayModuleName,
                submenu: {
                    options: functionOptions
                }
            });
        }

        return {
            content: "Elephant",
            submenu: {
                options: moduleOptions
            }
        };
    }

    // Get all available elephant modules + functions using Python Kernel
    private async _getElephantMembers(): Promise<{ [moduleName: string]: { name: string, is_class: boolean }[] } | null> {
        let code = `
        import inspect
        import pkgutil
        import json
        import elephant
        import importlib
        import sys

        elephant_module_func_dict = {}
        try:
            library = importlib.import_module("elephant")
            library_path = library.__path__
            for _, module_name, _ in pkgutil.iter_modules(library_path, prefix=library.__name__ + '.'):
                try:
                    module = importlib.import_module(module_name)
                    for name, func in (inspect.getmembers(module, inspect.isfunction) + 
                                    inspect.getmembers(module, inspect.isclass)):
                        if func.__module__ == module_name:
                            if not func.__name__.startswith("_"):
                                is_class = inspect.isclass(func)
                                elephant_module_func_dict.setdefault(module_name, []).append(
                                    {"name": func.__name__, "is_class": is_class}
                                )
                except Exception as e:
                    print(f"An error occurred while processing {module_name}: {e}", file=sys.stderr)
            print(json.dumps(elephant_module_func_dict))
        except ImportError:
            print("Elephant not found!", file=sys.stderr)
        except Exception as e:
            print(f"An error occurred: {e}", file=sys.stderr)
        `
        let msg_content: string = "";
        if (!this.session || !this.session.session) { return null; }
        let future = this.session!.session!.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg) && msg.content.name === 'stdout') {
                msg_content += msg.content.text;
            } else if (KernelMessage.isStreamMsg(msg)) {
                console.warn("Kernel STDERR:", msg.content.text);
            }
        };
        await future.done;
        try {
            const result = JSON.parse(msg_content.trim());
            if (Object.keys(result).length === 0) {
                return null;
            }
            return result;
        }
        catch (e) {
            console.error("Failed to parse elephant members from kernel:", e, msg_content);
            return null;
        }
    }
}