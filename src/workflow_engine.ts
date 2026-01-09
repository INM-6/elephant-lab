import { ISessionContext, showDialog, Dialog } from '@jupyterlab/apputils';
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

    /*
    session, widget and notebook_tracker are used to keep track of the notebook status 
    and communicate with Jupyphant (since the WorkflowEngine is a Widget of its own)
    */
    constructor(session: ISessionContext | null = null, outputArea: OutputArea, notebook_tracker: INotebookTracker, rendermime: IRenderMimeRegistry) {
        super();
        this.id = 'workflowEngine';
        this.title.label = 'Workflow Engine';
        this.title.closable = true;
        this.session = session;
        this.outputArea = outputArea;
        this.notebook_tracker = notebook_tracker;
        this.rendermime = rendermime;
        this.graph = null;
        this.graphCanvas = null;
        this.addClass('jp-workflowEngine');

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
                    const neoItem: DraggableItem = { id: item.id, name: item.name, code: item.id, is_class: false, parameters: [] };
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

    /*Method used to generate python code string that should be run on the Jupyter Kernel
    fqn: function that should be called (needs to exist in jupyphant.graphLogic)
    fqnParam: parameter that should be passed to the function (needs to displayed as a string)
    extra: additional code to be included in the generated Python code
    */
    private _generateCodeForFqn(fqn: string, fqnParam: string): string {
        return `
    from jupyphant.graphLogic import ${fqn}
    import json
    ${fqn}(${fqnParam})
    `;
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
            let execOutput;
            if ((currentNode as JupyphantNode).properties?.item.code === '__UTIL_LOOP__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after loop');
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
        const result = await this.kernelBridge.executeCode(
            `import uuid, json, pickle, sys\n${resultsDictName} = {}`,
            true
        );
        if (result) {
            this.handleOutputs(result.outputs, outputArea);
        }

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
            const listKey = await this.executeNode(listOriginNode, executed_nodes, outputArea);
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
                                    value = await this.executeNode(originNode, executed_nodes, outputArea);
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
                this.handleOutputs(loopResult.outputs, outputArea);
            }

            executed_nodes.set(jupyphantNode, null); // Loop node itself has no result
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
            this.handleOutputs(executionResult.outputs, outputArea);
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
            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeStartWithB", `"${item.code}", "${item.name}", "${resultId}", ${resultsDictName}`);
        }

        // Code logic for a list
        else if (item.code === "__UTIL_LIST__") {
            console.log("...using UTILITY (List) execution logic");
            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeUtilList", `'''${args_json_string}''', "${resultId}", ${resultsDictName}`);
        } else if (item.code === '__UTIL_INTEGER__') {
            console.log("...using UTILITY (Integer) execution logic");
            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeUtilInteger", `'''${args_json_string}''', "${resultId}", ${resultsDictName}`);
        } else if (item.code === '__UTIL_PRINT__') {
            console.log("...using UTILITY (Print) execution logic");
            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeUtilPrint", `'''${args_json_string}''', "${resultId}", ${resultsDictName}`);
        }

        // Node is class method logic
        else if (item.name.startsWith(".")) {
            console.log("...using METHOD execution logic for:", item.code);

            const parts = item.code.split('.');
            const method_name = parts.pop();

            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeStartWithDot", `"${method_name}", '''${args_json_string}''', "${item.name}", "${resultId}", ${resultsDictName}`);
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

            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeIncludesDot", `"${modulePath}", ${resultsDictName}, "${functionName}", "${resultId}", "${item.name}", '''${args_json_string}''', '''${paramNamesJson}'''`);
        }

        // Get Object by variable name from notebook scope
        else {
            console.log("...using VARIABLE NAME (neo) execution logic");
            const varName = item.code;
            codeToExecute = this._generateCodeForFqn("generatePythonCodeForNodeOther", `"${varName}", ${resultsDictName}, "${resultId}"`);
        }
        return codeToExecute
    }


    private _getSubgraphExecutionOrder(startNode: LGraphNode): LGraphNode[] {
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


    public generateCodeFromWorkflow() {
        const nodeResultNames = new Map<LGraphNode, string>();
        const codeLines: string[] = [];
        const imports = new Set<string>();
        let varCounter = 0;
        const generatedNodes = new Set<LGraphNode>();

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

        const generateCodeForNode = (jupyphantNode: JupyphantNode, indent = "") => {
            if (generatedNodes.has(jupyphantNode)) {
                return;
            }

            const item = jupyphantNode.properties.item;

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
                // loadedObjects.set(resultVarName, item.name);
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
                    content: "Loop",
                    submenu: {
                        options: [
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
}