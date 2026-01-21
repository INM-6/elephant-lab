import { ISessionContext, showDialog, Dialog } from '@jupyterlab/apputils';
import { FileDialog } from '@jupyterlab/filebrowser';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { OutputArea } from '@jupyterlab/outputarea';
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode } from 'litegraph.js';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { IRenderMimeRegistry, MimeModel } from '@jupyterlab/rendermime';
import { JupyphantNode, DraggableItem } from './jupyphant_node';
import { createWorkflowToolbar } from './workflowEngine_toolbar';
import { KernelBridge } from './kernel_bridge';
import 'litegraph.js/css/litegraph.css';
import '../style/workflow_engine.css';



// Workflow Engine Class / Widget
export class WorkflowEngineWidget extends Widget {
    private graph: LGraph | null;
    private graphCanvas: LGraphCanvas | null;
    private kernelBridge: KernelBridge;
    private canvasElement: HTMLCanvasElement;
    private outputArea: OutputArea;
    private notebook_tracker: INotebookTracker; // Current active Notebook -> used for Cell Injection
    public session: ISessionContext | null; // used to execute Python Code in same session as Jupyphant 
    private elephantMenu: any = { content: "Elephant (loading...)", disabled: true };
    private rendermime: IRenderMimeRegistry;
    private docManager: IDocumentManager;

    /*
    session, widget and notebook_tracker are used to keep track of the notebook status 
    and communicate with Jupyphant (since the WorkflowEngine is a Widget of its own)
    */
    constructor(session: ISessionContext | null = null, outputArea: OutputArea, notebook_tracker: INotebookTracker, rendermime: IRenderMimeRegistry, docManager: IDocumentManager) {
        super();
        this.id = 'workflowEngine';
        this.title.label = 'Workflow Engine';
        this.title.closable = true;
        this.session = session;
        this.outputArea = outputArea;
        this.notebook_tracker = notebook_tracker;
        this.rendermime = rendermime;
        this.docManager = docManager;
        this.graph = null;
        this.graphCanvas = null;
        this.addClass('jp-workflowEngine');

        const original_connect = LGraphNode.prototype.connect;
        LGraphNode.prototype.connect = function (this: LGraphNode, slot: string | number, target_node: LGraphNode, target_slot: string | number): any {
            const link: any = original_connect.call(this, slot, target_node, target_slot);
            if (link) {
                try {
                    const from_slot = this.outputs[link.origin_slot];
                    const to_slot = target_node.inputs[link.target_slot];
                    const exec_out_names = ['exec out', 'after loop', 'loop body', 'after if/else', 'if body', 'else body'];
                    if (from_slot && 
                        to_slot && 
                        from_slot.type === LiteGraph.EVENT && 
                        to_slot.type === LiteGraph.EVENT &&
                        exec_out_names.includes(from_slot.name) &&
                        to_slot.name === 'exec in') {
                        link.color = "#0004ff";
                    }
                } catch (e) {
                    console.error("Error coloring link:", e);
                }
            }
            return link;
        }

        if (this.session) {
            this.session.ready.then(() => {
                this._buildElephantMenu();
            });
        }
        this.kernelBridge = new KernelBridge(this.session!);
        this.node.appendChild(createWorkflowToolbar(this));

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
            this.graph.change = () => this._saveWorkflowToLocalStorage();
            this.graphCanvas = new LGraphCanvas(this.canvasElement, this.graph);
            this.graphCanvas.always_render_background = true;
            /*
            This prevents the default right click behavior of the lightgraph Canvas
            One may want to change this behavior but to prevent improper inputs, this will be prevented for now
            TODO: change this either back or overwrite with own JupyphantNodes as well as Quantity Nodes (which might actually be a good idea...)
            */

            this.graphCanvas.getCanvasMenuOptions = this._generateNodeMenu();


        } catch (e) {
            console.error("Error initializing LiteGraph:", e);
        }

    }

    // Executed after Widget is opened
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this._loadWorkflowFromLocalStorage();
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
                    const neoItem: DraggableItem = { id: item.id, name: item.name, code: item.id, is_class: false, parameters: [], type: 'neo-object' };
                    fullItems.push(neoItem); continue;
                }
            }
            if (typeof item === 'string') { name = item; }
            else if (Array.isArray(item) && typeof item[0] === 'string') {
                name = item[0];
            }

            if (name) {
                const details = await this.kernelBridge.getDetailsForName(name);
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
                    const methods = await this.kernelBridge.getMethodsFromTarget(item.code);
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

    /* This method returns a sorted list in what order the nodes should be executed
    /  Nodes without any input are treated as if they are variables, thus need to be executed first.
    */
    private _getExecutionOrder(): LGraphNode[] {
        if (!this.graph) {
            return [];
        }

        const nodes: LGraphNode[] = (this.graph as any)._nodes;
        const subgraphNodes = new Set<LGraphNode>();

        // Find all nodes within subgraphs (if/else/loop bodies)
        for (const node of nodes) {
            if (node instanceof JupyphantNode) {
                if (node.properties.item.code === '__UTIL_IF__' || node.properties.item.code === '__UTIL_LOOP__') {
                    const bodyOutputs = node.outputs.filter(o => o.name === 'if body' || o.name === 'else body' || o.name === 'loop body');
                    for (const output of bodyOutputs) {
                        if (output.links) {
                            for (const linkId of output.links) {
                                const link = this.graph.links[linkId];
                                if (link) {
                                    const startNode = this.graph.getNodeById(link.target_id);
                                    if (startNode) {
                                        const bodyNodes = this._getSubgraphExecutionOrder(startNode);
                                        bodyNodes.forEach(n => subgraphNodes.add(n));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        const sortedList: LGraphNode[] = [];
        const visited = new Set<LGraphNode>();

        // Find all nodes that are starting points of execution chains
        const startNodes = nodes.filter(node => {
            // A node is a start node if its 'exec in' slot is not connected
            const execInput = node.inputs.find(input => input.type === -1);
            return (!execInput || execInput.link === null) && !subgraphNodes.has(node);
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
            let execOutput;
            if ((currentNode as JupyphantNode).properties?.item.code === '__UTIL_LOOP__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after loop');
            } else if ((currentNode as JupyphantNode).properties?.item.code === '__UTIL_IF__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after if/else');
            } else {
                execOutput = currentNode.outputs.find(output => output.type === -1 && output.name !== 'loop body');
            }
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
            if (!visited.has(node) && !subgraphNodes.has(node)) {
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
        const collected_outputs: any[] = [];
        const result = await this.kernelBridge.executeCode(
            `import uuid, json, pickle, sys, gc\n${resultsDictName} = {}\ngc.collect()`,
            true
        );
        if (result && result.outputs) {
            collected_outputs.push(...result.outputs);
        }

        const executionOrder = this._getExecutionOrder();
        console.log("2. Execution order:", executionOrder.map(n => n.title));

        const executed_nodes = new Map<LGraphNode, string | null>();

        for (const node of executionOrder) {
            await this.executeNode(node, executed_nodes, outputArea, collected_outputs);
        }

        this.handleOutputs(collected_outputs, outputArea);

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

    private async executeNode(node: LGraphNode, executed_nodes: Map<LGraphNode, string | null>, outputArea: OutputArea, collected_outputs?: any[]): Promise<string | null> {
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

        if (item.code === '__UTIL_LOOP__') {
            const listInput = jupyphantNode.inputs.find(i => i.name === 'List');
            if (!listInput || listInput.link === null) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }
            const listLink = this.graph!.links[listInput.link];
            const listOriginNode = this.graph!.getNodeById(listLink.origin_id);
            if (!listOriginNode) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }
            const listKey = await this.executeNode(listOriginNode, executed_nodes, outputArea, collected_outputs);
            if (!listKey) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }

            const loopBodyExecOutput = jupyphantNode.outputs.find(o => o.name === 'loop body');
            if (!loopBodyExecOutput || !loopBodyExecOutput.links || loopBodyExecOutput.links.length === 0) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }
            const loopBodyStartLink = this.graph!.links[loopBodyExecOutput.links[0]];
            const loopBodyStartNode = this.graph!.getNodeById(loopBodyStartLink.target_id);

            if (!loopBodyStartNode) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }

            const loopBodyNodes = this._getSubgraphExecutionOrder(loopBodyStartNode);

            let loopBodyCode = "";
            const loopScopeExecutedNodes = new Map<LGraphNode, string | null>();

            for (const bodyNode of loopBodyNodes) {
                if (!(bodyNode instanceof JupyphantNode)) continue;

                const bodyNodeItem = bodyNode.properties.item;
                const bodyNodeArgs: (string | null)[] = [];

                if (bodyNodeItem.parameters) {
                    for (const param of bodyNodeItem.parameters) {
                        const inputIndex = bodyNode.inputs.findIndex(i => i.name === param.name);
                        let value: string | null = null;

                        if (inputIndex !== -1 && bodyNode.inputs[inputIndex].link !== null) {
                            const linkInfo = this.graph!.links[bodyNode.inputs[inputIndex].link!];
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);

                            if (originNode) {
                                if (originNode === jupyphantNode) {
                                    const outputSlot = jupyphantNode.outputs[linkInfo.origin_slot];
                                    if (outputSlot.name === 'item') {
                                        value = '__jupyphant_loop_item__';
                                    } else if (outputSlot.name === 'index') {
                                        value = '__jupyphant_loop_index__';
                                    }
                                } else if (loopScopeExecutedNodes.has(originNode)) {
                                    value = loopScopeExecutedNodes.get(originNode)!;
                                } else if (executed_nodes.has(originNode)) {
                                    value = executed_nodes.get(originNode)!;
                                } else {
                                    value = await this.executeNode(originNode, executed_nodes, outputArea, collected_outputs);
                                }
                            }
                        } else {
                            const propName = `param_${param.name}`;
                            value = (bodyNode.properties[propName] as string) || null;
                        }
                        bodyNodeArgs.push(value);
                    }
                }
                const bodyNodeResultId = `result_${crypto.randomUUID().replace(/-/g, '_')}`;
                const nodeCode = this._generatePythonCodeForNode(bodyNode as JupyphantNode, bodyNodeArgs, bodyNodeResultId);
                if (nodeCode) {
                    const indentedCode = nodeCode.split('\n').map(line => "    " + line).join('\n');
                    loopBodyCode += indentedCode + "\n";
                }
                loopScopeExecutedNodes.set(bodyNode, bodyNodeResultId);
            }

            const resultsDictName = "workflow_results";
            const codeToExecute = `
_list = ${resultsDictName}['${listKey}']
for __jupyphant_loop_index__, __jupyphant_loop_item__ in enumerate(_list):
    ${resultsDictName}['__jupyphant_loop_item__'] = __jupyphant_loop_item__
    ${resultsDictName}['__jupyphant_loop_index__'] = __jupyphant_loop_index__
${loopBodyCode}
`;

            console.log("Executing loop code:\n", codeToExecute);
            const loopResult = await this.kernelBridge.executeCode(codeToExecute, true);
            if (loopResult) {
                if (collected_outputs) {
                    collected_outputs.push(...loopResult.outputs);
                } else {
                    this.handleOutputs(loopResult.outputs, outputArea);
                }
            }

            executed_nodes.set(jupyphantNode, null); // Loop node itself has no result
            return null;
        } else if (item.code === '__UTIL_IF__') {
            const conditionInput = jupyphantNode.inputs.find(i => i.name === 'condition');
            if (!conditionInput || conditionInput.link === null) {
                console.error("If/Else node has no condition connected.");
                executed_nodes.set(jupyphantNode, null);
                return null;
            }
            const conditionLink = this.graph!.links[conditionInput.link];
            const conditionOriginNode = this.graph!.getNodeById(conditionLink.origin_id);
            if (!conditionOriginNode) {
                executed_nodes.set(jupyphantNode, null);
                return null;
            }

            const conditionKey = await this.executeNode(conditionOriginNode, executed_nodes, outputArea, collected_outputs);
            if (!conditionKey) {
                console.error("Condition for If/Else node did not execute properly.");
                executed_nodes.set(jupyphantNode, null);
                return null;
            }

            const checkConditionCode = `
_condition_val = workflow_results.get('${conditionKey}')
if isinstance(_condition_val, str):
    _is_true = _condition_val.lower() not in ('false', '0', 'f', '', 'none')
else:
    _is_true = bool(_condition_val)
if _is_true:
    print("JUPYPHANT_IF_TRUE")
`;
            const conditionResult = await this.kernelBridge.executeCode(checkConditionCode, true);
            let conditionIsTrue = false;
            if (conditionResult && conditionResult.outputs) {
                for (const output of conditionResult.outputs) {
                    if (output.output_type === 'stream' && output.name === 'stdout' && typeof output.text === 'string' && output.text.includes('JUPYPHANT_IF_TRUE')) {
                        conditionIsTrue = true;
                        break;
                    }
                }
            }
            
            const branch = conditionIsTrue ? 'if body' : 'else body';
            const bodyExecOutput = jupyphantNode.outputs.find(o => o.name === branch);
            
            if (bodyExecOutput && bodyExecOutput.links && bodyExecOutput.links.length > 0) {
                const bodyStartLink = this.graph!.links[bodyExecOutput.links[0]];
                const bodyStartNode = this.graph!.getNodeById(bodyStartLink.target_id);

                if (bodyStartNode) {
                    const bodyNodes = this._getSubgraphExecutionOrder(bodyStartNode);
                    for (const bodyNode of bodyNodes) {
                        await this.executeNode(bodyNode, executed_nodes, outputArea, collected_outputs);
                    }
                }
            }

            executed_nodes.set(jupyphantNode, null); 
            return null;
        }

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
                            value = await this.executeNode(originNode, executed_nodes, outputArea, collected_outputs);
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


        const resultId = `result_${crypto.randomUUID().replace(/-/g, '_')}`;
        const codeToExecute = this._generatePythonCodeForNode(jupyphantNode, args, resultId);

        if (!codeToExecute) {
            executed_nodes.set(jupyphantNode, null);
            return null;
        }

        console.log("Executing code for", item.name);
        const executionResult = await this.kernelBridge.executeCode(codeToExecute, true);
        
        let result_key: string | null = null;
        if (executionResult) {
            if (collected_outputs) {
                collected_outputs.push(...executionResult.outputs);
            } else {
                this.handleOutputs(executionResult.outputs, outputArea);
            }
            result_key = executionResult.resultKey;
        }

        if (result_key && result_key.startsWith("result_")) {
            console.log("Got result key for", item.name, ":", result_key);
            const dataOutputIndex = jupyphantNode.outputs.findIndex(o => o.name === 'result');
            if (dataOutputIndex !== -1) {
                jupyphantNode.setOutputData(dataOutputIndex, result_key);
            }
            executed_nodes.set(jupyphantNode, result_key);
            return result_key;
        } else {
            if (result_key) {
                console.warn("Got error or unexpected stdout for", item.name, ":", result_key);
            }
            executed_nodes.set(jupyphantNode, null);
            return null;
        }
    }

    private _generatePythonCodeForNode(node: JupyphantNode, args: (string | null)[], resultId: string): string {
        const item = node.properties.item;
        const args_json_string = JSON.stringify(args);
        const resultsDictName = "workflow_results";
        let codeToExecute = "";

        // Code is pickled python code
        if (item.code.startsWith("b'")) {
            console.log("...using INSTANCE (pickle) execution logic");
            codeToExecute = `try:
    data = pickle.loads(${item.code})
    jupyphant_result = data[0]
    ${resultsDictName}["${resultId}"] = jupyphant_result
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
        } else if (item.code === '__UTIL_GETITEM__') {
            console.log("...using UTILITY (Get Item) execution logic");
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
    
    jupyphant_target_list = processed_args[0]
    index = int(processed_args[1])

    if not isinstance(jupyphant_target_list, list):
        raise TypeError("Input 'list' must be a list.")

    jupyphant_result = jupyphant_target_list[index]
    
    ${resultsDictName}["${resultId}"] = jupyphant_result
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error in Get Item node: {e}", file=sys.stderr)`;
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
    for jupyphant_res in printed_results:
        print(jupyphant_res)
    ${resultsDictName}["${resultId}"] = printed_results
    print(f"JUPYPHANT_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error in Print node: {e}", file=sys.stderr)`;
        } else if (item.code === '__NEO_READ_FILE__') {
            console.log("...using NEO IO execution logic");

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
    import neo
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    
    io_class_name = processed_args[0]
    filename = processed_args[1]

    if not filename:
        raise ValueError("filename is required.")

    reader = None
    if io_class_name and io_class_name != "__REQUIRED__" and io_class_name.strip() != "":
        io_class = getattr(neo.io, io_class_name)
        reader = io_class(filename=filename)
    else:
        reader = neo.get_io(filename)

    blocks = reader.read()
    jupyphant_result = blocks[0] if blocks else None
    
    ${resultsDictName}["${resultId}"] = jupyphant_result
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error in Neo File Reader: {e}", file=sys.stderr)`;
        } else if (item.code.startsWith('__NEO_GET_')) {
            const type = item.code.replace('__NEO_GET_', '').slice(0, -2);
            const neoClassNameMap: { [key: string]: string } = {
                'SPIKETRAINS': 'SpikeTrain',
                'ANALOGSIGNALS': 'AnalogSignal',
                'SEGMENTS': 'Segment',
                'EVENTS': 'Event',
                'EPOCHS': 'Epoch'
            };
            const neoClassName = neoClassNameMap[type];
        
            if (!neoClassName) {
                console.error(`Invalid NEO_GET type: ${type}`);
                return "";
            }
            
            console.log(`...using NEO GET (${neoClassName}) execution logic`);
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
    
    jupyphant_neo_object = processed_args[0]
    
    if jupyphant_neo_object is None:
        raise ValueError("Input 'jupyphant_neo_object' is not connected or is None.")

    jupyphant_result = jupyphant_neo_object.list_children_by_class('${neoClassName}')
    
    ${resultsDictName}["${resultId}"] = jupyphant_result
    print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error in ${item.name} node: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_IF__') {
            return "";
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

    jupyphant_result = method_to_run(*processed_args)
        
    ${resultsDictName}["${resultId}"] = jupyphant_result
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
                return ""
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

        jupyphant_result = method_to_run(**kwargs)

        ${resultsDictName}["${resultId}"] = jupyphant_result
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
    jupyphant_result = None
    if 'jupyphant_entity' in globals() and hasattr(jupyphant_entity, 'map_ipytree_node_id_to_neo_obj_hash'):
        obj_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
        if obj_hash:
            jupyphant_result = jupyphant_entity.map_neo_obj_hash_to_neo_obj.get(obj_hash)

    if jupyphant_result is None:
        if node_id in globals():
            jupyphant_result = globals()[node_id]
        else:
            jupyphant_result = None
            print(f"Error: Variable or node id '{varName}' not found.", file=sys.stderr)
    
    if jupyphant_result is not None:
        ${resultsDictName}["${resultId}"] = jupyphant_result
        print(f"JUPYPHANT_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error getting object for variable '${varName}': {e}", file=sys.stderr)`;
        }
        return codeToExecute
    }


    private _getSubgraphExecutionOrder(startNode: LGraphNode): LGraphNode[] {
        if (!this.graph) {
            return [];
        }
        const sortedList: LGraphNode[] = [];
        if (!startNode) {
            return sortedList;
        }

        const visited = new Set<LGraphNode>();
        const queue: LGraphNode[] = [startNode];

        while (queue.length > 0) {
            const currentNode = queue.shift()!;

            if (visited.has(currentNode)) {
                continue;
            }
            visited.add(currentNode);
            sortedList.push(currentNode);

            let execOutput;
            if ((currentNode as JupyphantNode).properties?.item.code === '__UTIL_LOOP__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after loop');
            } else if ((currentNode as JupyphantNode).properties?.item.code === '__UTIL_IF__') {
                execOutput = currentNode.outputs.find(output => output.type === -1 && output.name !== 'if body' && output.name !== 'else body');
            } else {
                execOutput = currentNode.outputs.find(output => output.type === -1 && output.name !== 'loop body');
            }

            if (execOutput && execOutput.links) {
                for (const linkId of execOutput.links) {
                    const link = this.graph!.links[linkId];
                    if (link) {
                        const nextNode = this.graph!.getNodeById(link.target_id);
                        if (nextNode && !visited.has(nextNode)) {
                            queue.push(nextNode);
                        }
                    }
                }
            }
        }

        return sortedList;
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

    private handleOutputs(outputs: any[], outputArea: OutputArea) {
        for (const output of outputs) {
            if (output.output_type === 'clear_output') {
                outputArea.model.clear(false);
            } else {
                outputArea.model.add(output);
            }
        }
    }

    // Inserts given string below the current active Cell
    // This may be used for Code or Comments
    private _insertNotebookCellBelow(context: string) {
        if (!context) {
            return;
        }

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


    public async generateCodeFromWorkflow() {
        const nodeResultNames = new Map<LGraphNode, string>();
        const codeLines: string[] = [];
        const imports = new Set<string>();
        let varCounter = 0;
        const generatedNodes = new Set<LGraphNode>();
        const preExecutionPromises: Promise<any>[] = [];

        const sanitizeVarName = (name: string) => {
            const namePart = name.split(' ')[0];
            let sanitized = namePart.toLowerCase()
                .replace(/\(\)/g, '')
                .replace(/[^a-z0-9_]/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(/^[^a-z_]*/, '');
            if (!sanitized || sanitized === 'list' || sanitized === 'print' || sanitized === 'neo') {
                return `jupyphant_result_${varCounter++}`;
            }
            return sanitized;
        };

        const generateCodeForNode = (jupyphantNode: JupyphantNode, indent = "") => {
            if (generatedNodes.has(jupyphantNode)) {
                return;
            }

            const item = jupyphantNode.properties.item;

            if (item.variable_name && item.variable_name !== "") {
                nodeResultNames.set(jupyphantNode, item.variable_name);
                generatedNodes.add(jupyphantNode);
                return;
            }

            if (!item || !item.code) {
                generatedNodes.add(jupyphantNode);
                return;
            }

            if (item.code === '__UTIL_LOOP__') {
                generatedNodes.add(jupyphantNode);

                const listInput = jupyphantNode.inputs.find(i => i.name === 'List');
                if (!listInput || listInput.link === null) return;
                const listLink = this.graph!.links[listInput.link];
                const listOriginNode = this.graph!.getNodeById(listLink.origin_id);

                if (listOriginNode instanceof JupyphantNode) {
                    generateCodeForNode(listOriginNode, indent);
                    const listVarName = nodeResultNames.get(listOriginNode);
                    if (!listVarName) return;

                    const loopBodyExecOutput = jupyphantNode.outputs.find(o => o.name === 'loop body');
                    if (!loopBodyExecOutput || !loopBodyExecOutput.links || !loopBodyExecOutput.links.length) return;

                    const loopBodyStartLink = this.graph!.links[loopBodyExecOutput.links[0]];
                    const loopBodyStartNode = this.graph!.getNodeById(loopBodyStartLink.target_id);

                    if (loopBodyStartNode) {
                        const loopBodyNodes = this._getSubgraphExecutionOrder(loopBodyStartNode);

                        codeLines.push(indent + `for jupyphant_loop_index, jupyphant_loop_item in enumerate(${listVarName}):`);

                        for (const bodyNode of loopBodyNodes) {
                            if (bodyNode instanceof JupyphantNode) {
                                generateCodeForNode(bodyNode, indent + "    ");
                            }
                        }
                    }
                }
                return;
            } else if (item.code === '__UTIL_IF__') {
                generatedNodes.add(jupyphantNode);

                const conditionInput = jupyphantNode.inputs.find(i => i.name === 'condition');
                if (!conditionInput || conditionInput.link === null) return;
                const conditionLink = this.graph!.links[conditionInput.link];
                const conditionOriginNode = this.graph!.getNodeById(conditionLink.origin_id);

                if (conditionOriginNode instanceof JupyphantNode) {
                    generateCodeForNode(conditionOriginNode, indent);
                    const conditionVarName = nodeResultNames.get(conditionOriginNode);
                    if (!conditionVarName) return;

                    codeLines.push(indent + `if ${conditionVarName}:`);

                    const ifBodyExecOutput = jupyphantNode.outputs.find(o => o.name === 'if body');
                    if (ifBodyExecOutput && ifBodyExecOutput.links && ifBodyExecOutput.links.length > 0) {
                        const ifBodyStartLink = this.graph!.links[ifBodyExecOutput.links[0]];
                        const ifBodyStartNode = this.graph!.getNodeById(ifBodyStartLink.target_id);
                        if (ifBodyStartNode) {
                            const ifBodyNodes = this._getSubgraphExecutionOrder(ifBodyStartNode);
                            for (const bodyNode of ifBodyNodes) {
                                if (bodyNode instanceof JupyphantNode) {
                                    generateCodeForNode(bodyNode, indent + "    ");
                                }
                            }
                        }
                    }

                    codeLines.push(indent + `else:`);

                    const elseBodyExecOutput = jupyphantNode.outputs.find(o => o.name === 'else body');
                    if (elseBodyExecOutput && elseBodyExecOutput.links && elseBodyExecOutput.links.length > 0) {
                        const elseBodyStartLink = this.graph!.links[elseBodyExecOutput.links[0]];
                        const elseBodyStartNode = this.graph!.getNodeById(elseBodyStartLink.target_id);
                        if (elseBodyStartNode) {
                            const elseBodyNodes = this._getSubgraphExecutionOrder(elseBodyStartNode);
                            for (const bodyNode of elseBodyNodes) {
                                if (bodyNode instanceof JupyphantNode) {
                                    generateCodeForNode(bodyNode, indent + "    ");
                                }
                            }
                        }
                    } else {
                        codeLines.push(indent + "    pass");
                    }
                }
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
                                generateCodeForNode(originNode, indent);
                            }
                        }
                    }
                }
            }

            let resultVarName = item.code === '__NEO_READ_FILE__' ? 'neo_data' : sanitizeVarName(item.name);
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
                            if (originNode && (originNode as JupyphantNode).properties.item.code === '__UTIL_LOOP__') {
                                const outputSlot = originNode.outputs[linkInfo.origin_slot];
                                if (outputSlot.name === 'item') {
                                    argumentValue = 'jupyphant_loop_item';
                                } else if (outputSlot.name === 'index') {
                                    argumentValue = 'jupyphant_loop_index';
                                } else {
                                    argumentValue = 'None';
                                }
                            } else if (originNode && nodeResultNames.has(originNode)) {
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

            if (item.code.startsWith("b'")) {
            } else if (item.code === "__UTIL_LIST__") {
                const listItems = processedArgs.filter(arg => arg.value !== 'None').map(arg => arg.value).join(', ');
                lineOfCode = `${resultVarName} = [${listItems}]`;
            } else if (item.code === "__UTIL_INTEGER__") {
                const intValue = processedArgs.length > 0 ? processedArgs[0].value : "0";
                lineOfCode = `${resultVarName} = ${intValue}`;
            } else if (item.code === '__UTIL_PRINT__') {
                const arg_to_print = processedArgs.length > 0 ? processedArgs[0].value : "''";
                if (arg_to_print !== 'None') {
                    lineOfCode = `print(${arg_to_print})`;
                }
            } else if (item.code === '__NEO_READ_FILE__') {
                imports.add('import neo');
                const io_class_arg = processedArgs.find(p => p.name === 'io_class');
                const filename_arg = processedArgs.find(p => p.name === 'filename');

                const io_class_val = io_class_arg ? io_class_arg.value : 'None';
                const filename_val = filename_arg ? filename_arg.value : 'None';
                
                const reader_var = `reader_${varCounter++}`;

                let block: string[] = [];
                block.push(`_tmp_io_class = ${io_class_val}`);
                block.push(`_tmp_filename = ${filename_val}`);
                block.push(`${reader_var} = getattr(neo.io, _tmp_io_class)(filename=_tmp_filename)`);
                block.push(`_blocks = ${reader_var}.read()`);
                block.push(`${resultVarName} = _blocks[0] if _blocks else None`);
                lineOfCode = block.join(`\n${indent}`);
            } else if (item.code.startsWith('__NEO_GET_')) {
                const type = item.code.replace('__NEO_GET_', '').slice(0, -2);
                const neoClassName = {
                    'SPIKETRAINS': 'SpikeTrain',
                    'ANALOGSIGNALS': 'AnalogSignal',
                    'SEGMENTS': 'Segment',
                    'EVENTS': 'Event',
                    'EPOCHS': 'Epoch'
                }[type];

                if (neoClassName) {
                    const paramName = item.parameters[0]?.name;
                    const self_arg = processedArgs.find(arg => arg.name === paramName)?.value;
                    if (self_arg && self_arg !== 'None') {
                        lineOfCode = `${resultVarName} = ${self_arg}.list_children_by_class('${neoClassName}')`;
                    }
                }
            } else if (item.code === '__UTIL_GETITEM__') {
                const list_arg = processedArgs.find(p => p.name === 'list')?.value;
                const index_arg = processedArgs.find(p => p.name === 'index')?.value;
                if (list_arg && list_arg !== 'None' && index_arg && index_arg !== 'None') {
                    lineOfCode = `${resultVarName} = ${list_arg}[int(${index_arg})]`;
                }
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
                const varName = item.code;
                const isNeoObject = varName.length > 20 && varName.includes('-');

                if (isNeoObject) {
                    const tempVar = `jupyphant_var_${varCounter++}`;

                    const command = `${tempVar} = jupyphant_entity.map_neo_obj_hash_to_neo_obj.get(jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash.get('${varName}'))`;
                    
                    const executionPromise = this.kernelBridge.executeCode(command, true);
                    preExecutionPromises.push(executionPromise);
                    
                    lineOfCode = `${resultVarName} = ${tempVar}`;
                } else {
                    lineOfCode = `${resultVarName} = ${varName}`;
                }
            }

            if (lineOfCode) {
                codeLines.push(indent + lineOfCode);
            }

            generatedNodes.add(jupyphantNode);
        };

        const executionOrder = this._getExecutionOrder();
        for (const node of executionOrder) {
            if (node instanceof JupyphantNode) {
                generateCodeForNode(node);
            }
        }

        await Promise.all(preExecutionPromises);

        const importLines = Array.from(imports).join('\n');
        const fullCode = (importLines ? importLines + '\n\n' : '') + codeLines.join('\n');

        this._insertNotebookCellBelow(fullCode);
    }

    // Create docstring for given Node and display it
    public async showNodeInfo(node: JupyphantNode) {
        const code = node.properties.item.code;
        const docstring = await this.kernelBridge.getDocstring(code);

        const mimeType = 'text/markdown';
        const model = new MimeModel({
            data: { [mimeType]: docstring || "*No docstring found.*" }
        });

        const renderer = this.rendermime.createRenderer(mimeType);
        await renderer.renderModel(model);

        // Show the dialog
        showDialog({
            title: `Info for ${code}`,
            body: renderer
        });
    }

    // TODO: this code is hard to read / write, maybe there is another way?
    private _generateNodeMenu() {

        return () => {
                        return [
                            {
                                content: "Control Flow",
                                submenu: {
                                    options: [
                                        {
                                            content: "If/Else",
                                            callback: (value: any, options: any, event: any, parentMenu: any) => {
                                                const item: DraggableItem = {
                                                    id: "util/if_else",
                                                    name: "If/Else",
                                                    code: "__UTIL_IF__",
                                                    is_class: false,
                                                    parameters: [
                                                        // No standard parameters here, we will set up inputs/outputs manually
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
                                            content: "For Loop",
                                            callback: (value: any, options: any, event: any, parentMenu: any) => {
                                                const item: DraggableItem = {
                                                    id: "util/for_loop",
                                                    name: "For Loop",
                                                    code: "__UTIL_LOOP__",
                                                    is_class: false,
                                                    parameters: [
                                                        // No standard parameters here, we will set up inputs/outputs manually
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
                            {
                                content: "Get Item",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "util/getitem",
                                        name: "Get Item",
                                        code: "__UTIL_GETITEM__",
                                        is_class: false,
                                        parameters: [
                                            { name: "list", default: "__REQUIRED__" },
                                            { name: "index", default: "0" },
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
                                content: "Neo File Reader",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "neo/read_file",
                                        name: "Neo File Reader",
                                        code: "__NEO_READ_FILE__",
                                        is_class: true,
                                        parameters: [
                                            { name: "io_class", default: "" },
                                            { name: "filename", default: "__REQUIRED__" },
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
        const elephantData = await this.kernelBridge.getElephantMembers();
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
                        const details = await this.kernelBridge.getDetailsForName(fqn);
                        if (details) {
                            const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
                            if (this.graph && this.graphCanvas) {
                                node.properties.item = details;
                                node.setProperty("item", details);
                                node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                this.graph.add(node);
                                if (node.properties.item.is_class) {
                                    // Add DropDown for methods (if existing) 
                                    const methods = await this.kernelBridge.getMethodsFromTarget(node.properties.item.code);
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

    public clearGraph(): void {
        this.graph?.clear();
    }

    public resetZoom(): void {
        this.graphCanvas?.ds.reset();
    }

    public toggleExecPins(show: boolean): void {
        JupyphantNode.showExecPins = show;
        if (this.graph) {
        const nodes: LGraphNode[] = (this.graph as any)._nodes;

            for (const node of nodes) {
                if (node instanceof JupyphantNode) {
                    node.setupInputs();
                }
            }
        }
        this.graph!.setDirtyCanvas(true, true);
    }

    private _saveWorkflowToLocalStorage() {
        if (!this.graph) {
            return;
        }

        try {
            const data = this.graph.serialize();
            const dataStr = JSON.stringify(data, null, 2);
            localStorage.setItem('jupyphant-workflow', dataStr);
        } catch (err) {
            console.error("Error serializing workflow to localStorage:", err);
        }
    }

    private _loadWorkflowFromLocalStorage() {
        if (!this.graph) {
            return;
        }
        const dataStr = localStorage.getItem('jupyphant-workflow');
        if (!dataStr) {
            return;
        }

        try {
            const data = JSON.parse(dataStr);
            this._importWorkflowData(data);
        } catch (err) {
            console.error("Error parsing or configuring workflow from localStorage:", err);
        }
    }

    private _importWorkflowData(data: any) {
        if (this.graph) {
            this.toggleExecPins(true);

            const checkbox = document.getElementById('toggle-exec-pins') as HTMLInputElement;
            if (checkbox) {
                checkbox.checked = true;
            }

            this.graph.clear();

            if (data.nodes) {
                for (const node_info of data.nodes) {
                    if (!LiteGraph.registered_node_types[node_info.type]) {
                        console.error("Node type not found: " + node_info.type);
                        continue;
                    }
                    const node = LiteGraph.createNode(node_info.type) as JupyphantNode;
                    if (node) {
                        node.id = node_info.id;
                        node.pos = node_info.pos;
                        if (node_info.size) node.size = node_info.size;

                        if (node_info.properties) {
                            node.properties = Object.assign({}, node.properties, node_info.properties);

                            if (node.properties.item) {
                                node.setProperty("item", node.properties.item);
                            }
                        }

                        this.graph.add(node);
                    }
                }
            }

            if (data.links) {
                for (const link_info of data.links) {
                    const origin_node = this.graph.getNodeById(link_info[1]);
                    const target_node = this.graph.getNodeById(link_info[3]);
                    if (origin_node && target_node) {
                        const link = origin_node.connect(link_info[2], target_node, link_info[4]);
                        if (link) {
                            link.id = link_info[0];
                        }
                    } else {
                        console.warn("Could not find nodes for link:", link_info);
                    }
                }
            }
            this.graph.setDirtyCanvas(true, true);
        }
    }



    public exportWorkflow() {
        if (!this.graph) {
            return;
        }

        try {
            const data = this.graph.serialize();
            const dataStr = JSON.stringify(data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = 'workflow.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Error serializing workflow:", err);
            showDialog({
                title: 'Export Error',
                body: 'Could not serialize the workflow. Check console for details.',
                buttons: [Dialog.okButton()]
            });
        }
    }

    public importWorkflow() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }
            const reader = new FileReader();
            reader.onload = (e: ProgressEvent<FileReader>) => {
                try {
                    if (typeof e.target?.result !== 'string') {
                        throw new Error("File could not be read as text.");
                    }
                    const data = JSON.parse(e.target.result);
                    this._importWorkflowData(data);
                } catch (err) {
                    console.error("Error parsing or configuring workflow file:", err);
                    showDialog({
                        title: 'Import Error',
                        body: 'Could not parse or configure from the selected workflow file.',
                        buttons: [Dialog.okButton()]
                    });
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    public createNeoNode(ioClass: string, filePath: string) {
        const item: DraggableItem = {
            id: "neo/read_file",
            name: "Neo File Reader",
            code: "__NEO_READ_FILE__",
            is_class: true,
            parameters: [
                { name: "io_class", default: ioClass },
                { name: "filename", default: filePath },
            ]
        };

        const node = LiteGraph.createNode("workflow/jupyphant_node") as JupyphantNode;
        if (this.graph && this.graphCanvas) {
            node.properties.item = item;
            node.setProperty("item", item);
            
            node.properties['param_io_class'] = ioClass;
            node.properties['param_filename'] = filePath;

            let x = 100;
            let y = 100;
            const current_nodes = this.graph!.findNodesByClass(JupyphantNode as any);
            if(current_nodes && current_nodes.length > 0) {
                const last_node = current_nodes[current_nodes.length - 1];
                x = last_node.pos[0];
                y = last_node.pos[1] + last_node.size[1] + 20;
            }
            
            node.pos = [x, y];
            this.graph.add(node);
        }
    }

    public loadNeoFile() {
        FileDialog.getOpenFiles({
            manager: this.docManager
        }).then(result => {
            if (result.button.accept && result.value && result.value.length > 0) {
                const selectedFile = result.value[0];
                const filePath = selectedFile.path;

                const body = document.createElement('div');
                const input = document.createElement('input');
                input.className = 'jp-input';
                input.placeholder = 'e.g. Spike2IO';
                body.appendChild(input);

                showDialog({
                    title: 'Enter neo IO class',
                    body: new Widget({ node: body }),
                    buttons: [
                        Dialog.cancelButton(),
                        Dialog.okButton({ label: 'OK' }),
                        Dialog.createButton({ label: 'Automatic' })
                    ],
                    hasClose: true
                }).then(dialogResult => {
                    if (dialogResult.button.label === 'OK') {
                        const ioClass = input.value;
                        if (ioClass) {
                            this.createNeoNode(ioClass, filePath);
                        }
                    } else if (dialogResult.button.label === 'Automatic') {
                        this.kernelBridge.getNeoIOClass(filePath).then(ioClass => {
                            if (ioClass) {
                                this.createNeoNode(ioClass, filePath);
                            } else {
                                showDialog({
                                    title: 'Error',
                                    body: 'Could not automatically determine IO class.',
                                    buttons: [Dialog.okButton()]
                                });
                            }
                        });
                    }
                });
            }
        });
    }
}