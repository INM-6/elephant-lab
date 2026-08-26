import { ISessionContext, showDialog, Dialog } from '@jupyterlab/apputils';
import { FileDialog } from '@jupyterlab/filebrowser';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { OutputArea } from '@jupyterlab/outputarea';
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode, LGraphGroup } from 'litegraph.js';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { IRenderMimeRegistry, MimeModel } from '@jupyterlab/rendermime';
import { ElephantLabNode, DraggableItem } from './elephant_lab_node';
import { createWorkflowToolbar } from './workflowEngine_toolbar';
import { KernelBridge } from './kernel_bridge';
import 'litegraph.js/css/litegraph.css';
import '../style/workflow_engine.css';



// Workflow Engine Class / Widget
export class WorkflowEngineWidget extends Widget {
    private static readonly PREPARE_ARG_SNIPPET = `try:
    _prepare_arg
except NameError:
    def _prepare_arg(arg_str):
        global workflow_results
        if isinstance(arg_str, str):
            if arg_str in workflow_results: return workflow_results[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            if len(arg_str) == 40 and all(c in "0123456789abcdef" for c in arg_str):
                if 'elephant_lab_entity' in globals():
                    obj_hash = elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get(arg_str, arg_str)
                    resolved = elephant_lab_entity.map_neo_obj_hash_to_neo_obj.get(obj_hash)
                    if resolved is not None:
                        return resolved
                raise ValueError(f"Elephant Lab: referenced object '{arg_str}' is no longer available in this kernel session (likely because the kernel was restarted). Re-run or re-select the node that produced it.")
            try: return eval(arg_str)
            except: return arg_str
        return arg_str`;

    private graph: LGraph | null;
    private graphCanvas: LGraphCanvas | null;
    private kernelBridge: KernelBridge;
    private canvasElement: HTMLCanvasElement;
    private minimapElement: HTMLCanvasElement;
    private _minimapRafId: number | null = null;
    private _history: string[] = [];
    private _historyIndex: number = -1;
    private _isRestoringHistory: boolean = false;
    private _historySaveTimeout: number | null = null;
    private outputArea: OutputArea;
    private notebook_tracker: INotebookTracker; // Current active Notebook -> used for Cell Injection
    public session: ISessionContext | null; // used to execute Python Code in same session as Elephant Lab 
    private elephantMenu: any = { content: "Elephant (loading...)", disabled: true };
    private rendermime: IRenderMimeRegistry;
    public docManager: IDocumentManager;

    /*
    session, widget and notebook_tracker are used to keep track of the notebook status 
    and communicate with Elephant Lab (since the WorkflowEngine is a Widget of its own)
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
                        from_slot.type === 'jupy_exec' &&
                        to_slot.type === 'jupy_exec' &&
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

        const original_renderLink = (LGraphCanvas.prototype as any).renderLink;
        (LGraphCanvas.prototype as any).renderLink = function (this: LGraphCanvas, ctx: CanvasRenderingContext2D, ...rest: any[]) {
            const link = rest[2];
            const isExecLink = link && link.color === "#0004ff";
            if (isExecLink) {
                ctx.setLineDash([6, 6]);
                ctx.lineDashOffset = -(Date.now() / 30) % 12;
            }
            original_renderLink.call(this, ctx, ...rest);
            if (isExecLink) {
                ctx.setLineDash([]);
            }
        };

        const original_getGroupMenuOptions = (LGraphCanvas.prototype as any).getGroupMenuOptions;
        (LGraphCanvas.prototype as any).getGroupMenuOptions = function (this: LGraphCanvas, group: LGraphGroup): any[] {
            const options: any[] = original_getGroupMenuOptions.call(this, group);
            group.recomputeInsideNodes();
            const groupNodes = (group as any)._nodes as LGraphNode[];
            const anyExpanded = groupNodes.some(n => !n.flags?.collapsed);
            options.unshift({
                content: anyExpanded ? "Collapse Nodes" : "Expand Nodes",
                callback: () => {
                    group.recomputeInsideNodes();
                    for (const node of (group as any)._nodes as LGraphNode[]) {
                        node.flags = node.flags || {};
                        node.flags.collapsed = anyExpanded;
                    }
                    if (this.graph) { (this.graph as any).change?.(); }
                    this.setDirty(true, true);
                }
            }, null);
            return options;
        };

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
                    const parsed = JSON.parse(itemString);
                    if (parsed && parsed.type === 'multi' && Array.isArray(parsed.items)) {
                        this._createListNodeFromItems(parsed.items as DraggableItem[], event);
                        return;
                    }

                    const item: DraggableItem = parsed;
                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                    if (this.graph && this.graphCanvas) {
                        node.docManager = this.docManager;
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

        this.canvasElement.tabIndex = 0;
        this.canvasElement.style.outline = 'none';
        this.canvasElement.addEventListener('keydown', (event) => {
            const modifier = event.metaKey || event.ctrlKey;
            if (!modifier) { return; }
            const key = event.key.toLowerCase();
            if (key === 'z' && event.shiftKey) {
                event.preventDefault();
                this.redo();
            } else if (key === 'z') {
                event.preventDefault();
                this.undo();
            } else if (key === 'y') {
                event.preventDefault();
                this.redo();
            }
        });

        this.minimapElement = document.createElement('canvas');
        this.minimapElement.id = 'workflow-minimap';
        this.minimapElement.className = 'workflow-minimap';
        this.minimapElement.width = 180;
        this.minimapElement.height = 130;
        this.node.appendChild(this.minimapElement);
        this._setupMinimapInteraction();

        try {
            this.graph = new LGraph();
            (this.graph as any).widget = this;
            this.graph.change = () => {
                this._saveWorkflowToLocalStorage();
                this._scheduleHistorySnapshot();
            };
            this.graphCanvas = new LGraphCanvas(this.canvasElement, this.graph);
            this.graphCanvas.always_render_background = true;
            // Disable litegraph's default near-black tile; _syncCanvasThemeColors() replaces it with a theme-aware grid once attached.
            (this.graphCanvas as any).background_image = null;
            /*
            This prevents the default right click behavior of the lightgraph Canvas
            One may want to change this behavior but to prevent improper inputs, this will be prevented for now
            TODO: change this either back or overwrite with own ElephantLabNodes as well as Quantity Nodes (which might actually be a good idea...)
            */

            this.graphCanvas.getCanvasMenuOptions = this._generateNodeMenu();


        } catch (e) {
            console.error("Error initializing LiteGraph:", e);
        }

    }

    // Builds a List node wired up to one object node per dropped item, so dragging
    // multiple selected Neo Tree rows produces a ready-to-use list of those objects.
    private _createListNodeFromItems(items: DraggableItem[], event: DragEvent): void {
        if (!this.graph || !this.graphCanvas || items.length === 0) { return; }

        const dropPos = this.graphCanvas.convertEventToCanvasOffset(event);

        const listItem: DraggableItem = {
            id: "util/list_node",
            name: `List (${items.length} items)`,
            code: "__UTIL_LIST__",
            is_class: false,
            parameters: items.map((item, index) => ({ name: `item ${index}`, default: item.variable_name || item.code }))
        };
        const listNode = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
        listNode.docManager = this.docManager;
        listNode.properties.item = listItem;
        listNode.setProperty("item", listItem);
        listNode.properties['item_labels'] = items.map(i => i.name);
        listNode.properties['item_source_files'] = items.map(i => i.source_file || null);
        listNode.properties['item_source_io_classes'] = items.map(i => i.source_io_class || null);
        listNode.properties['item_is_reference'] = items.map(i => !!i.variable_name);
        listNode.pos = dropPos;
        this.graph.add(listNode);
    }

    // Executed after Widget is opened
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this._loadWorkflowFromLocalStorage();
        this._pushHistorySnapshot();
        if (this.graph) { this.graph.start(); }
        this.onResize(Widget.ResizeMessage.UnknownSize);
        this._startMinimapLoop();
        this._syncCanvasThemeColors();
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
        this._stopMinimapLoop();
    }
    protected onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        if (this.graph) { this.graph.start(); }
        this.onResize(Widget.ResizeMessage.UnknownSize);
        this._startMinimapLoop();
        this._syncCanvasThemeColors();
    }

    // Syncs the canvas fill and grid to the current JupyterLab theme colors
    private _syncCanvasThemeColors(): void {
        if (!this.graphCanvas || !this.node.isConnected) { return; }
        const styles = getComputedStyle(this.node);
        const themeColor = styles.getPropertyValue('--jp-layout-color0').trim();
        if (themeColor) {
            (this.graphCanvas as any).clear_background_color = themeColor;
        }
        const gridColor = styles.getPropertyValue('--jp-border-color2').trim();
        if (gridColor) {
            (this.graphCanvas as any).background_image = this._buildGridPatternTile(gridColor);
            // litegraph caches its pattern and never invalidates it when background_image changes, so force a rebuild here.
            (this.graphCanvas as any)._pattern = null;
        }
        if (this.graph) { this.graph.setDirtyCanvas(true, true); }
    }

    // Draws a small tileable grid-line pattern
    private _buildGridPatternTile(lineColor: string): string {
        const size = 50;
        const tile = document.createElement('canvas');
        tile.width = size;
        tile.height = size;
        const ctx = tile.getContext('2d');
        if (!ctx) { return ''; }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0.5, 0);
        ctx.lineTo(0.5, size);
        ctx.moveTo(0, 0.5);
        ctx.lineTo(size, 0.5);
        ctx.stroke();
        return tile.toDataURL();
    }

    private _startMinimapLoop(): void {
        if (this._minimapRafId !== null) { return; }
        const loop = () => {
            this._drawMinimap();
            this._minimapRafId = requestAnimationFrame(loop);
        };
        this._minimapRafId = requestAnimationFrame(loop);
    }

    private _stopMinimapLoop(): void {
        if (this._minimapRafId !== null) {
            cancelAnimationFrame(this._minimapRafId);
            this._minimapRafId = null;
        }
    }

    private _getMinimapBounds(): { minX: number; minY: number; mmScale: number; paddingX: number; paddingY: number } | null {
        if (!this.graph || !this.graphCanvas) { return null; }

        const nodes = (this.graph as any)._nodes as LGraphNode[];
        this.graphCanvas.ds.computeVisibleArea();
        const visibleArea = this.graphCanvas.ds.visible_area;

        let minX = visibleArea[0];
        let minY = visibleArea[1];
        let maxX = visibleArea[0] + visibleArea[2];
        let maxY = visibleArea[1] + visibleArea[3];

        for (const node of nodes) {
            minX = Math.min(minX, node.pos[0]);
            minY = Math.min(minY, node.pos[1]);
            maxX = Math.max(maxX, node.pos[0] + node.size[0]);
            maxY = Math.max(maxY, node.pos[1] + node.size[1]);
        }

        const marginX = (maxX - minX) * 0.05 || 20;
        const marginY = (maxY - minY) * 0.05 || 20;
        minX -= marginX; minY -= marginY;
        maxX += marginX; maxY += marginY;

        const boundingW = Math.max(maxX - minX, 1);
        const boundingH = Math.max(maxY - minY, 1);

        const mmScale = Math.min(this.minimapElement.width / boundingW, this.minimapElement.height / boundingH);
        const paddingX = (this.minimapElement.width - boundingW * mmScale) / 2;
        const paddingY = (this.minimapElement.height - boundingH * mmScale) / 2;

        return { minX, minY, mmScale, paddingX, paddingY };
    }

    private _drawMinimap(): void {
        if (!this.graph || !this.graphCanvas) { return; }
        const ctx = this.minimapElement.getContext('2d');
        if (!ctx) { return; }

        ctx.clearRect(0, 0, this.minimapElement.width, this.minimapElement.height);

        const bounds = this._getMinimapBounds();
        if (!bounds) { return; }
        const { minX, minY, mmScale, paddingX, paddingY } = bounds;

        const toMinimap = (x: number, y: number): [number, number] => [
            (x - minX) * mmScale + paddingX,
            (y - minY) * mmScale + paddingY
        ];

        const nodes = (this.graph as any)._nodes as LGraphNode[];
        ctx.fillStyle = 'rgba(120, 170, 255, 0.85)';
        for (const node of nodes) {
            const [nx, ny] = toMinimap(node.pos[0], node.pos[1]);
            const nw = Math.max(node.size[0] * mmScale, 2);
            const nh = Math.max(node.size[1] * mmScale, 2);
            ctx.fillRect(nx, ny, nw, nh);
        }

        // Current viewport
        this.graphCanvas.ds.computeVisibleArea();
        const visibleArea = this.graphCanvas.ds.visible_area;
        const [vx, vy] = toMinimap(visibleArea[0], visibleArea[1]);
        const vw = visibleArea[2] * mmScale;
        const vh = visibleArea[3] * mmScale;
        ctx.strokeStyle = '#ff6d00';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx, vy, vw, vh);
    }

    // Clicking/dragging on the minimap re-centers the main canvas on that point
    private _setupMinimapInteraction(): void {
        let dragging = false;

        const navigateTo = (event: MouseEvent) => {
            if (!this.graph || !this.graphCanvas) { return; }
            const bounds = this._getMinimapBounds();
            if (!bounds) { return; }

            const rect = this.minimapElement.getBoundingClientRect();
            const clickX = (event.clientX - rect.left) * (this.minimapElement.width / rect.width);
            const clickY = (event.clientY - rect.top) * (this.minimapElement.height / rect.height);

            const graphX = (clickX - bounds.paddingX) / bounds.mmScale + bounds.minX;
            const graphY = (clickY - bounds.paddingY) / bounds.mmScale + bounds.minY;

            this.graphCanvas.ds.computeVisibleArea();
            const visibleArea = this.graphCanvas.ds.visible_area;
            this.graphCanvas.ds.offset[0] = visibleArea[2] / 2 - graphX;
            this.graphCanvas.ds.offset[1] = visibleArea[3] / 2 - graphY;
            this.graphCanvas.draw(true, true);
        };

        this.minimapElement.addEventListener('mousedown', (event) => {
            dragging = true;
            navigateTo(event);
        });
        window.addEventListener('mousemove', (event) => {
            if (dragging) { navigateTo(event); }
        });
        window.addEventListener('mouseup', () => { dragging = false; });
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

            // If item is a list it is probably passed from Elephant Lab (passing elephant objects as list)
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
            const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
            if (node) {
                node.docManager = this.docManager;
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
                                    const methodNode = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                                    methodNode.docManager = this.docManager;
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
            if (node instanceof ElephantLabNode) {
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
            if ((currentNode as ElephantLabNode).properties?.item.code === '__UTIL_LOOP__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after loop');
            } else if ((currentNode as ElephantLabNode).properties?.item.code === '__UTIL_IF__') {
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
        const runButton = document.getElementById('workflow-run-button') as HTMLButtonElement | null;
        if (runButton?.disabled) {
            // Already running, ignore the click because a new run would clear the output
            return;
        }
        if (runButton) {
            runButton.disabled = true;
            runButton.textContent = '⏳ Running...';
            runButton.style.backgroundColor = '#7d7c84';
        }
        try {
            await this._execute_workflow_inner();
        } finally {
            if (runButton) {
                runButton.disabled = false;
                runButton.textContent = '▶ Run Workflow';
                // Restores the toolbar's own styling
                runButton.style.backgroundColor = '';
            }
        }
    }

    private async _execute_workflow_inner() {
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
            `import uuid, json, pickle, sys, gc\n${resultsDictName} = {}\n_ = gc.collect()`
        );
        if (result && result.outputs) {
            collected_outputs.push(...result.outputs);
        }

        const executionOrder = this._getExecutionOrder();
        console.log("2. Execution order:", executionOrder.map(n => n.title));

        const executed_nodes = new Map<LGraphNode, string | null>();

        let pendingCode: string[] = [];
        let pendingNodes: { node: ElephantLabNode; resultId: string }[] = [];

        const flushBatch = async () => {
            if (pendingCode.length === 0) { return; }
            const batchResult = await this.kernelBridge.executeCode(pendingCode.join('\n\n'));
            if (batchResult) {
                collected_outputs.push(...batchResult.outputs);
                const foundKeys = new Set(batchResult.resultKeys);
                for (const { node, resultId } of pendingNodes) {
                    if (foundKeys.has(resultId)) {
                        const dataOutputIndex = node.outputs.findIndex(o => o.name === 'result');
                        if (dataOutputIndex !== -1) { node.setOutputData(dataOutputIndex, resultId); }
                        executed_nodes.set(node, resultId);
                    } else {
                        executed_nodes.set(node, null);
                    }
                }
            }
            pendingCode = [];
            pendingNodes = [];
        };

        for (const node of executionOrder) {
            if (executed_nodes.has(node)) { continue; }

            if (!(node instanceof ElephantLabNode)) {
                executed_nodes.set(node, null);
                continue;
            }

            const item = node.properties.item;
            if (!item || !item.code || !this.session || !this.session.session ||
                item.code === '__UTIL_LOOP__' || item.code === '__UTIL_IF__') {
                await flushBatch();
                await this.executeNode(node, executed_nodes, outputArea, collected_outputs);
                continue;
            }

            const args: (string | null)[] = [];
            if (item.parameters) {
                for (const param of item.parameters) {
                    const inputIndex = node.inputs.findIndex(i => i.name === param.name);
                    let value: string | null = null;

                    if (inputIndex !== -1 && node.inputs[inputIndex].link !== null) {
                        const linkInfo = this.graph!.links[node.inputs[inputIndex].link!];
                        if (linkInfo) {
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                            if (originNode) {
                                value = await this.executeNode(originNode, executed_nodes, outputArea, collected_outputs);
                            }
                        }
                    } else {
                        const propName = `param_${param.name}`;
                        value = (node.properties[propName] as string) || null;
                    }
                    args.push(value);
                }
            }

            const resultId = `result_${crypto.randomUUID().replace(/-/g, '_')}`;
            const codeToExecute = this._generatePythonCodeForNode(node, args, resultId);

            if (!codeToExecute) {
                executed_nodes.set(node, null);
                continue;
            }

            pendingCode.push(codeToExecute);
            pendingNodes.push({ node, resultId });
            executed_nodes.set(node, resultId);
        }

        await flushBatch();

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

        if (!(node instanceof ElephantLabNode)) {
            console.log("3a. Skipping non-Elephant Lab node:", node.title);
            executed_nodes.set(node, null);
            return null;
        }

        const elephant_labNode = node as ElephantLabNode;
        const item = elephant_labNode.properties.item;

        if (!item || !item.code || !this.session || !this.session.session) {
            console.log("3b. Skipping node, invalid item/code/session:", item.name);
            executed_nodes.set(elephant_labNode, null);
            return null;
        }

        console.log("4. Processing node:", item.name);

        if (item.code === '__UTIL_LOOP__') {
            const listInput = elephant_labNode.inputs.find(i => i.name === 'List');
            if (!listInput || listInput.link === null) {
                executed_nodes.set(elephant_labNode, null);
                return null;
            }
            const listLink = this.graph!.links[listInput.link];
            const listOriginNode = this.graph!.getNodeById(listLink.origin_id);
            if (!listOriginNode) {
                executed_nodes.set(elephant_labNode, null);
                return null;
            }
            const listKey = await this.executeNode(listOriginNode, executed_nodes, outputArea, collected_outputs);
            if (!listKey) {
                executed_nodes.set(elephant_labNode, null);
                return null;
            }

            const loopBodyExecOutput = elephant_labNode.outputs.find(o => o.name === 'loop body');
            if (!loopBodyExecOutput || !loopBodyExecOutput.links || loopBodyExecOutput.links.length === 0) {
                executed_nodes.set(elephant_labNode, null);
                return null;
            }

            const loopBodyNodes = this._getBodyNodesFromOutput(loopBodyExecOutput);

            let loopBodyCode = "";
            const loopScopeExecutedNodes = new Map<LGraphNode, string | null>();

            for (const bodyNode of loopBodyNodes) {
                if (!(bodyNode instanceof ElephantLabNode)) continue;

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
                                if (originNode === elephant_labNode) {
                                    const outputSlot = elephant_labNode.outputs[linkInfo.origin_slot];
                                    if (outputSlot.name === 'item') {
                                        value = '__elephant_lab_loop_item__';
                                    } else if (outputSlot.name === 'index') {
                                        value = '__elephant_lab_loop_index__';
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
                const nodeCode = this._generatePythonCodeForNode(bodyNode as ElephantLabNode, bodyNodeArgs, bodyNodeResultId);
                if (nodeCode) {
                    const indentedCode = nodeCode.split('\n').map(line => "    " + line).join('\n');
                    loopBodyCode += indentedCode + "\n";
                }
                loopScopeExecutedNodes.set(bodyNode, bodyNodeResultId);
            }

            const resultsDictName = "workflow_results";
            const codeToExecute = `
_list = ${resultsDictName}['${listKey}']
for __elephant_lab_loop_index__, __elephant_lab_loop_item__ in enumerate(_list):
    ${resultsDictName}['__elephant_lab_loop_item__'] = __elephant_lab_loop_item__
    ${resultsDictName}['__elephant_lab_loop_index__'] = __elephant_lab_loop_index__
${loopBodyCode}
`;

            console.log("Executing loop code:\n", codeToExecute);
            const loopResult = await this.kernelBridge.executeCode(codeToExecute);
            if (loopResult) {
                if (collected_outputs) {
                    collected_outputs.push(...loopResult.outputs);
                } else {
                    this.handleOutputs(loopResult.outputs, outputArea);
                }
            }

            executed_nodes.set(elephant_labNode, null); // Loop node itself has no result
            return null;
        } else if (item.code === '__UTIL_IF__') {
            const conditionInput = elephant_labNode.inputs.find(i => i.name === 'condition');
            if (!conditionInput || conditionInput.link === null) {
                console.error("If/Else node has no condition connected.");
                executed_nodes.set(elephant_labNode, null);
                return null;
            }
            const conditionLink = this.graph!.links[conditionInput.link];
            const conditionOriginNode = this.graph!.getNodeById(conditionLink.origin_id);
            if (!conditionOriginNode) {
                executed_nodes.set(elephant_labNode, null);
                return null;
            }

            const conditionKey = await this.executeNode(conditionOriginNode, executed_nodes, outputArea, collected_outputs);
            if (!conditionKey) {
                console.error("Condition for If/Else node did not execute properly.");
                executed_nodes.set(elephant_labNode, null);
                return null;
            }

            const checkConditionCode = `
_condition_val = workflow_results.get('${conditionKey}')
if isinstance(_condition_val, str):
    _is_true = _condition_val.lower() not in ('false', '0', 'f', '', 'none')
else:
    _is_true = bool(_condition_val)
if _is_true:
    print("ELEPHANT_LAB_IF_TRUE")
`;
            const conditionResult = await this.kernelBridge.executeCode(checkConditionCode);
            let conditionIsTrue = false;
            if (conditionResult && conditionResult.outputs) {
                for (const output of conditionResult.outputs) {
                    if (output.output_type === 'stream' && output.name === 'stdout' && typeof output.text === 'string' && output.text.includes('ELEPHANT_LAB_IF_TRUE')) {
                        conditionIsTrue = true;
                        break;
                    }
                }
            }
            
            const branch = conditionIsTrue ? 'if body' : 'else body';
            const bodyExecOutput = elephant_labNode.outputs.find(o => o.name === branch);

            const bodyNodes = this._getBodyNodesFromOutput(bodyExecOutput);
            for (const bodyNode of bodyNodes) {
                await this.executeNode(bodyNode, executed_nodes, outputArea, collected_outputs);
            }

            executed_nodes.set(elephant_labNode, null); 
            return null;
        }

        const args: (string | null)[] = [];
        if (item.parameters && item.parameters.length > 0) {
            console.log("...collecting parameters for", item.name);
            for (const param of item.parameters) {
                const inputIndex = elephant_labNode.inputs.findIndex(i => i.name === param.name);
                let value: string | null = null;

                if (inputIndex !== -1 && elephant_labNode.inputs[inputIndex].link !== null) {
                    const linkInfo = this.graph!.links[elephant_labNode.inputs[inputIndex].link!];
                    if (linkInfo) {
                        const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                        if (originNode) {
                            console.log(`... ${item.name} depends on ${originNode.title}`);
                            value = await this.executeNode(originNode, executed_nodes, outputArea, collected_outputs);
                        }
                    }
                } else {
                    const propName = `param_${param.name}`;
                    value = (elephant_labNode.properties[propName] as string) || null;
                }
                args.push(value);
            }
        }
        console.log("5. Collected string args/keys:", args);


        const resultId = `result_${crypto.randomUUID().replace(/-/g, '_')}`;
        const codeToExecute = this._generatePythonCodeForNode(elephant_labNode, args, resultId);

        if (!codeToExecute) {
            executed_nodes.set(elephant_labNode, null);
            return null;
        }

        console.log("Executing code for", item.name);
        const executionResult = await this.kernelBridge.executeCode(codeToExecute);
        
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
            const dataOutputIndex = elephant_labNode.outputs.findIndex(o => o.name === 'result');
            if (dataOutputIndex !== -1) {
                elephant_labNode.setOutputData(dataOutputIndex, result_key);
            }
            executed_nodes.set(elephant_labNode, result_key);
            return result_key;
        } else {
            if (result_key) {
                console.warn("Got error or unexpected stdout for", item.name, ":", result_key);
            }
            executed_nodes.set(elephant_labNode, null);
            return null;
        }
    }

    private _buildNeoReloadSnippet(
        rootVar: string,
        sourceFile: string,
        sourceIoClass: string | undefined,
        indent: string,
        readerVar: string = '_elephant_lab_reader',
        blocksVar: string = '_elephant_lab_blocks'
    ): string {
        const readerExpr = (sourceIoClass && sourceIoClass !== "")
            ? `getattr(neo.io, "${sourceIoClass}")(filename="${sourceFile}")`
            : `neo.get_io("${sourceFile}")`;
        const lines = [
            `if '${rootVar}' not in globals() or ${rootVar} is None:`,
            `    ${readerVar} = ${readerExpr}`,
            `    ${blocksVar} = ${readerVar}.read()`,
            `    ${rootVar} = ${blocksVar}[0] if ${blocksVar} else None`
        ];
        return lines.map(l => indent + l).join('\n');
    }

    private _generatePythonCodeForNode(node: ElephantLabNode, args: (string | null)[], resultId: string): string {
        const item = node.properties.item;
        const args_json_string = JSON.stringify(args);
        const resultsDictName = "workflow_results";
        let codeToExecute = "";

        // Code is pickled python code
        if (item.code.startsWith("b'")) {
            console.log("...using INSTANCE (pickle) execution logic");
            codeToExecute = `try:
    data = pickle.loads(${item.code})
    elephant_lab_result = data[0]
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 
except Exception as e:
    print(f"Error loading instance ${item.name}: {e}", file=sys.stderr)`;
        }

        // Code logic for a list
        else if (item.code === "__UTIL_LIST__") {
            console.log("...using UTILITY (List) execution logic");

            const sourceFiles = (node.properties['item_source_files'] as (string | null)[]) || [];
            const sourceIoClasses = (node.properties['item_source_io_classes'] as (string | null)[]) || [];
            const reloadedRoots = new Set<string>();
            const reloadSnippets: string[] = [];
            (item.parameters || []).forEach((param, i) => {
                const sourceFile = sourceFiles[i];
                if (!sourceFile) { return; }
                const rootMatch = (param.default || '').match(/^[A-Za-z_][A-Za-z0-9_]*/);
                const rootVar = rootMatch ? rootMatch[0] : null;
                if (!rootVar || reloadedRoots.has(rootVar)) { return; }
                reloadedRoots.add(rootVar);
                reloadSnippets.push(this._buildNeoReloadSnippet(rootVar, sourceFile, sourceIoClasses[i] || undefined, '    '));
            });
            const reloadCode = reloadSnippets.length > 0 ? `    import neo\n${reloadSnippets.join('\n')}\n` : '';

            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}

try:
${reloadCode}    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    final_list = [arg for arg in processed_args if arg is not None]

    ${resultsDictName}["${resultId}"] = final_list
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")

except Exception as e:
    print(f"Error creating list: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_INTEGER__') {
            console.log("...using UTILITY (Integer) execution logic");
            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    integer_value = int(processed_args[0])
    ${resultsDictName}["${resultId}"] = integer_value
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error in Integer node: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_GETITEM__') {
            console.log("...using UTILITY (Get Item) execution logic");
            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]

    elephant_lab_target_list = processed_args[0]
    index = int(processed_args[1])

    if not isinstance(elephant_lab_target_list, list):
        raise TypeError("Input 'list' must be a list.")

    elephant_lab_result = elephant_lab_target_list[index]
    
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error in Get Item node: {e}", file=sys.stderr)`;
        } else if (item.code === '__UTIL_PRINT__') {
            console.log("...using UTILITY (Print) execution logic");
            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]
    printed_results = [arg for arg in processed_args if arg is not None]
    for elephant_lab_res in printed_results:
        print(elephant_lab_res)
    ${resultsDictName}["${resultId}"] = printed_results
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")
except Exception as e:
    print(f"Error in Print node: {e}", file=sys.stderr)`;
        } else if (item.code === '__NEO_READ_FILE__') {
            console.log("...using NEO IO execution logic");

            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}

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
    elephant_lab_result = blocks[0] if blocks else None
    
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 

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
            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]

    elephant_lab_neo_object = processed_args[0]
    
    if elephant_lab_neo_object is None:
        raise ValueError("Input 'elephant_lab_neo_object' is not connected or is None.")

    elephant_lab_result = elephant_lab_neo_object.list_children_by_class('${neoClassName}')
    
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 

except Exception as e:
    print(f"Error in ${item.name} node: {e}", file=sys.stderr)`;
        } else if (item.code === '__NEO_FILTER__') {
            console.log(`...using NEO FILTER execution logic`);
            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}
import ast
try:
    raw_args = json.loads('''${args_json_string}''')
    processed_args = [_prepare_arg(arg) for arg in raw_args]

    elephant_lab_neo_object = processed_args[0]
    criteria_str = processed_args[1] if len(processed_args) > 1 else ""

    if elephant_lab_neo_object is None:
        raise ValueError("Input 'neo_object' is not connected or is None.")

    filter_kwargs = {}
    criteria_str = str(criteria_str).strip()
    if criteria_str:
        # Accept a dict-literal ('sua': True, 'name': 'Vm') as well as kwargs-style (sua=True / sua==True)
        # ast.literal_eval only accepts literal constants (no arbitrary code)
        try:
            parsed = ast.literal_eval("{" + criteria_str + "}")
            if not isinstance(parsed, dict):
                raise ValueError("criteria did not evaluate to a dict")
            filter_kwargs = parsed
        except Exception:
            for part in criteria_str.split(','):
                part = part.strip()
                if not part:
                    continue
                if '=' not in part:
                    print(f"Warning: skipping filter criterion '{part}' (expected key=value)", file=sys.stderr)
                    continue
                key, _, value = part.replace('==', '=').partition('=')
                try:
                    filter_kwargs[key.strip()] = ast.literal_eval(value.strip())
                except Exception as parse_error:
                    print(f"Warning: skipping filter criterion '{part}': {parse_error}", file=sys.stderr)

    elephant_lab_result = elephant_lab_neo_object.filter(**filter_kwargs)

    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")

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

            codeToExecute = `${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}

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

    elephant_lab_result = method_to_run(*processed_args)
        
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 

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

${WorkflowEngineWidget.PREPARE_ARG_SNIPPET}

try:
    if module_obj:
        method_to_run = getattr(module_obj, "${functionName}")
        raw_args = json.loads('''${args_json_string}''')
        param_names = json.loads('''${paramNamesJson}''')
        processed_args = [_prepare_arg(arg) for arg in raw_args]

        kwargs = dict(zip(param_names, processed_args))

        if "${functionName}" == "SpikeTrain" and isinstance(kwargs.get('times'), list):
            kwargs['times'] = np.array(kwargs['times'], dtype=np.float64)

        elephant_lab_result = method_to_run(**kwargs)

        ${resultsDictName}["${resultId}"] = elephant_lab_result
        print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}") 
    else:
        print(f"Error: Module ${modulePath} not loaded.", file=sys.stderr)
except Exception as e:
    print(f"Error running ${item.name} (name): {e}", file=sys.stderr)`;
        }

        else if (item.variable_name && item.variable_name !== "" && item.source_file) {
            console.log("...using SELF-CONTAINED PATH (reload + navigate) execution logic");
            const path = item.variable_name;
            const rootVarMatch = path.match(/^[A-Za-z_][A-Za-z0-9_]*/);
            const rootVar = rootVarMatch ? rootVarMatch[0] : 'elephant_lab_loaded_root';
            const filename = item.source_file;
            const ioClassName = item.source_io_class;
            const reloadSnippet = this._buildNeoReloadSnippet(rootVar, filename, ioClassName, '    ');
            codeToExecute = `try:
    import neo
${reloadSnippet}
    if ${rootVar} is None:
        raise ValueError(f"Elephant Lab: could not load any data from '${filename}'.")
    elephant_lab_result = ${path}
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")
except (NameError, AttributeError, IndexError, KeyError) as e:
    print(f"Error: Elephant Lab: could not resolve '${path}' after reloading '${filename}' ({type(e).__name__}: {e}).", file=sys.stderr)
except Exception as e:
    print(f"Error loading/resolving '${path}': {e}", file=sys.stderr)`;
        }

        // Get Object by variable name from notebook scope
        else if (item.variable_name && item.variable_name !== "") {
            console.log("...using PATH EXPRESSION (neo) execution logic");
            const path = item.variable_name;
            codeToExecute = `try:
    elephant_lab_result = ${path}
    ${resultsDictName}["${resultId}"] = elephant_lab_result
    print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")
except (NameError, AttributeError, IndexError, KeyError) as e:
    print(f"Error: Elephant Lab: could not resolve '${path}' ({type(e).__name__}: {e}). Make sure the cell that defines it has been (re-)run.", file=sys.stderr)
except Exception as e:
    print(f"Error getting object for '${path}': {e}", file=sys.stderr)`;
        }
        else {
            console.log("...using VARIABLE NAME (neo) execution logic");
            const varName = item.code;
            codeToExecute = `try:
    node_id = "${varName}"
    elephant_lab_result = None
    if 'elephant_lab_entity' in globals() and hasattr(elephant_lab_entity, 'map_ipytree_node_id_to_neo_obj_hash'):
        obj_hash = elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
        if obj_hash:
            elephant_lab_result = elephant_lab_entity.map_neo_obj_hash_to_neo_obj.get(obj_hash)

    if elephant_lab_result is None:
        if node_id in globals():
            elephant_lab_result = globals()[node_id]
        else:
            elephant_lab_result = None
            print(f"Error: Variable or node id '{node_id}' not found.", file=sys.stderr)

    if elephant_lab_result is not None:
        ${resultsDictName}["${resultId}"] = elephant_lab_result
        print(f"ELEPHANT_LAB_RESULT_KEY:${resultId}")
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
            if ((currentNode as ElephantLabNode).properties?.item.code === '__UTIL_LOOP__') {
                execOutput = currentNode.outputs.find(output => output.name === 'after loop');
            } else if ((currentNode as ElephantLabNode).properties?.item.code === '__UTIL_IF__') {
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

    // A body output (e.g. "loop body") can have several nodes wired to it directly (parallel
    // branches, not a single chain), so this walks every link out of it, not just the first.
    private _getBodyNodesFromOutput(output: { links?: number[] | null } | undefined): LGraphNode[] {
        if (!this.graph || !output || !output.links) { return []; }

        const nodes: LGraphNode[] = [];
        const seen = new Set<LGraphNode>();
        for (const linkId of output.links) {
            const link = this.graph.links[linkId];
            if (!link) { continue; }
            const branchStartNode = this.graph.getNodeById(link.target_id);
            if (!branchStartNode) { continue; }
            for (const n of this._getSubgraphExecutionOrder(branchStartNode)) {
                if (!seen.has(n)) {
                    seen.add(n);
                    nodes.push(n);
                }
            }
        }
        return nodes;
    }

    // Helper function to get Text-OutputArea of Elephant Lab (for Plot you may use another one)
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
        const usedResultNames = new Set<string>();
        const neoResolveCommands: string[] = [];
        const loadedSourceRoots = new Set<string>();

        const isUnusable = (s: string) => !s || s === 'list' || s === 'print' || s === 'neo';

        const sanitizeVarName = (name: string) => {
            const namePart = name.split(' ')[0];
            const sanitized = namePart.toLowerCase()
                .replace(/\(\)/g, '')
                .replace(/[^a-z0-9_]/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(/^[^a-z_]*/, '');

            if (!isUnusable(sanitized)) {
                return sanitized;
            }

            const fallbackMatch = name.match(/[A-Za-z_][A-Za-z0-9_]*/);
            const fallback = fallbackMatch ? fallbackMatch[0].toLowerCase() : '';
            if (!isUnusable(fallback)) {
                return fallback;
            }

            return `elephant_lab_result_${varCounter++}`;
        };

        const generateCodeForNode = (elephant_labNode: ElephantLabNode, indent = "") => {
            if (generatedNodes.has(elephant_labNode)) {
                return;
            }

            const item = elephant_labNode.properties.item;

            if (item.variable_name && item.variable_name !== "") {
                if (item.source_file) {
                    const rootMatch = item.variable_name.match(/^[A-Za-z_][A-Za-z0-9_]*/);
                    const rootVar = rootMatch ? rootMatch[0] : `elephant_lab_loaded_root_${varCounter++}`;
                    if (!loadedSourceRoots.has(rootVar)) {
                        loadedSourceRoots.add(rootVar);
                        imports.add('import neo');
                        const readerVar = `reader_${varCounter++}`;
                        const blocksVar = `_blocks_${rootVar}`;
                        codeLines.push(this._buildNeoReloadSnippet(rootVar, item.source_file, item.source_io_class, indent, readerVar, blocksVar));
                    }
                }
                nodeResultNames.set(elephant_labNode, item.variable_name);
                generatedNodes.add(elephant_labNode);
                return;
            }

            if (!item || !item.code) {
                generatedNodes.add(elephant_labNode);
                return;
            }

            if (item.code === '__UTIL_LOOP__') {
                generatedNodes.add(elephant_labNode);

                const listInput = elephant_labNode.inputs.find(i => i.name === 'List');
                if (!listInput || listInput.link === null) return;
                const listLink = this.graph!.links[listInput.link];
                const listOriginNode = this.graph!.getNodeById(listLink.origin_id);

                if (listOriginNode instanceof ElephantLabNode) {
                    generateCodeForNode(listOriginNode, indent);
                    const listVarName = nodeResultNames.get(listOriginNode);
                    if (!listVarName) return;

                    const loopBodyExecOutput = elephant_labNode.outputs.find(o => o.name === 'loop body');
                    if (!loopBodyExecOutput || !loopBodyExecOutput.links || !loopBodyExecOutput.links.length) return;

                    const loopBodyNodes = this._getBodyNodesFromOutput(loopBodyExecOutput);

                    if (loopBodyNodes.length > 0) {
                        codeLines.push(indent + `for elephant_lab_loop_index, elephant_lab_loop_item in enumerate(${listVarName}):`);

                        for (const bodyNode of loopBodyNodes) {
                            if (bodyNode instanceof ElephantLabNode) {
                                generateCodeForNode(bodyNode, indent + "    ");
                            }
                        }
                    }
                }
                return;
            } else if (item.code === '__UTIL_IF__') {
                generatedNodes.add(elephant_labNode);

                const conditionInput = elephant_labNode.inputs.find(i => i.name === 'condition');
                if (!conditionInput || conditionInput.link === null) return;
                const conditionLink = this.graph!.links[conditionInput.link];
                const conditionOriginNode = this.graph!.getNodeById(conditionLink.origin_id);

                if (conditionOriginNode instanceof ElephantLabNode) {
                    generateCodeForNode(conditionOriginNode, indent);
                    const conditionVarName = nodeResultNames.get(conditionOriginNode);
                    if (!conditionVarName) return;

                    codeLines.push(indent + `if ${conditionVarName}:`);

                    const ifBodyExecOutput = elephant_labNode.outputs.find(o => o.name === 'if body');
                    const ifBodyNodes = this._getBodyNodesFromOutput(ifBodyExecOutput);
                    if (ifBodyNodes.length > 0) {
                        for (const bodyNode of ifBodyNodes) {
                            if (bodyNode instanceof ElephantLabNode) {
                                generateCodeForNode(bodyNode, indent + "    ");
                            }
                        }
                    } else {
                        codeLines.push(indent + "    pass");
                    }

                    codeLines.push(indent + `else:`);

                    const elseBodyExecOutput = elephant_labNode.outputs.find(o => o.name === 'else body');
                    const elseBodyNodes = this._getBodyNodesFromOutput(elseBodyExecOutput);
                    if (elseBodyNodes.length > 0) {
                        for (const bodyNode of elseBodyNodes) {
                            if (bodyNode instanceof ElephantLabNode) {
                                generateCodeForNode(bodyNode, indent + "    ");
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
                    const input = elephant_labNode.inputs.find(inp => inp.name === param.name);
                    if (input && input.link != null) {
                        const linkInfo = this.graph!.links[input.link];
                        if (linkInfo) {
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                            if (originNode instanceof ElephantLabNode) {
                                generateCodeForNode(originNode, indent);
                            }
                        }
                    }
                }
            }

            let resultVarName = item.code === '__NEO_READ_FILE__' ? 'neo_data' : sanitizeVarName(item.name);
            const originalName = resultVarName;
            let counter = 1;
            while (usedResultNames.has(resultVarName)) {
                resultVarName = `${originalName}_${counter++}`;
            }
            usedResultNames.add(resultVarName);
            nodeResultNames.set(elephant_labNode, resultVarName);

            const processedArgs: { name: string, value: string, isSelf: boolean }[] = [];
            if (item.parameters) {
                let paramIndex = 0;
                for (const param of item.parameters) {
                    const propName = `param_${param.name}`;
                    let argumentValue: string;

                    const input = elephant_labNode.inputs.find(inp => inp.name === param.name);

                    if (input && input.link != null) {
                        const linkInfo = this.graph!.links[input.link];
                        if (linkInfo) {
                            const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                            if (originNode && (originNode as ElephantLabNode).properties.item.code === '__UTIL_LOOP__') {
                                const outputSlot = originNode.outputs[linkInfo.origin_slot];
                                if (outputSlot.name === 'item') {
                                    argumentValue = 'elephant_lab_loop_item';
                                } else if (outputSlot.name === 'index') {
                                    argumentValue = 'elephant_lab_loop_index';
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
                        const value = String(elephant_labNode.properties[propName] ?? '');
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
                        } else if (/^[a-f0-9]{40}$/.test(value)) {
                            const neoVarName = `elephant_lab_neo_${varCounter++}`;
                            neoResolveCommands.push(`${neoVarName} = elephant_lab_entity.map_neo_obj_hash_to_neo_obj.get(elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get('${value}'))`);
                            argumentValue = neoVarName;
                        } else if (
                            (elephant_labNode.properties['item_is_reference'] as boolean[] | undefined)?.[paramIndex] &&
                            /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/.test(value)
                        ) {
                            const rootMatch = value.match(/^[A-Za-z_][A-Za-z0-9_]*/);
                            const rootVar = rootMatch ? rootMatch[0] : null;
                            const sourceFile = (elephant_labNode.properties['item_source_files'] as (string | null)[] | undefined)?.[paramIndex];
                            if (rootVar && sourceFile && !loadedSourceRoots.has(rootVar)) {
                                loadedSourceRoots.add(rootVar);
                                imports.add('import neo');
                                const sourceIoClass = (elephant_labNode.properties['item_source_io_classes'] as (string | null)[] | undefined)?.[paramIndex];
                                codeLines.push(this._buildNeoReloadSnippet(rootVar, sourceFile, sourceIoClass || undefined, indent));
                            }
                            argumentValue = value;
                        } else {
                            argumentValue = `'${value.replace(/'/g, "\\'")}'`;
                        }
                    }

                    processedArgs.push({
                        name: param.name,
                        value: argumentValue,
                        isSelf: param.name === '__self__'
                    });
                    paramIndex++;
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
                    generatedNodes.add(elephant_labNode);
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
                const isNeoObject = /^[a-f0-9]{40}$/.test(varName);

                if (isNeoObject) {
                    // Resolve the object into a nicely-named kernel variable behind the scenes
                    neoResolveCommands.push(`${resultVarName} = elephant_lab_entity.map_neo_obj_hash_to_neo_obj.get(elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get('${varName}'))`);
                    lineOfCode = "";
                } else {
                    lineOfCode = `${resultVarName} = ${varName}`;
                }
            }

            if (lineOfCode) {
                codeLines.push(indent + lineOfCode);
            }

            generatedNodes.add(elephant_labNode);
        };

        const executionOrder = this._getExecutionOrder();
        for (const node of executionOrder) {
            if (node instanceof ElephantLabNode) {
                generateCodeForNode(node);
            }
        }

        if (neoResolveCommands.length > 0) {
            await this.kernelBridge.executeCode(neoResolveCommands.join('\n'));
        }

        const importLines = Array.from(imports).join('\n');
        const fullCode = (importLines ? importLines + '\n\n' : '') + codeLines.join('\n');

        this._insertNotebookCellBelow(fullCode);
    }

    // Create docstring for given Node and display it
    public async showNodeInfo(node: ElephantLabNode) {
        const item = node.properties.item;
        const code = item.code;
        const docstring = await this.kernelBridge.getDocstring(code, item.variable_name, item.source_file, item.source_io_class);

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
                                                const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                                                if (this.graph && this.graphCanvas) {
                                                    node.docManager = this.docManager;
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
                                                const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                                                if (this.graph && this.graphCanvas) {
                                                    node.docManager = this.docManager;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                                    if (this.graph && this.graphCanvas) {
                                        node.properties.item = item;
                                        node.setProperty("item", item);
                                        node.pos = this.graphCanvas.convertEventToCanvasOffset(event);
                                        this.graph.add(node);
                                    }
                                }
                            }, 
                            {
                                content: "neo.filter",
                                callback: (value: any, options: any, event: any, parentMenu: any) => {
                                    const item: DraggableItem = {
                                        id: "neo/",
                                        name: "neo.filter",
                                        code: "__NEO_FILTER__",
                                        is_class: true,
                                        parameters: [
                                            { name: "neo_object", default: "__REQUIRED__" },
                                            { name: "criteria", default: "" },
                                        ]
                                    };
                                    const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                        const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                            const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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
                                                    const methodNode = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
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

    private _scheduleHistorySnapshot(): void {
        if (this._isRestoringHistory) { return; }
        if (this._historySaveTimeout !== null) {
            window.clearTimeout(this._historySaveTimeout);
        }
        this._historySaveTimeout = window.setTimeout(() => {
            this._historySaveTimeout = null;
            this._pushHistorySnapshot();
        }, 400);
    }

    private _pushHistorySnapshot(): void {
        if (!this.graph || this._isRestoringHistory) { return; }

        let snapshot: string;
        try {
            snapshot = JSON.stringify(this.graph.serialize());
        } catch (err) {
            console.error("Error capturing undo snapshot:", err);
            return;
        }

        if (this._historyIndex >= 0 && this._history[this._historyIndex] === snapshot) {
            return;
        }

        this._history = this._history.slice(0, this._historyIndex + 1);
        this._history.push(snapshot);

        const HISTORY_LIMIT = 50;
        if (this._history.length > HISTORY_LIMIT) {
            this._history.shift();
        }
        this._historyIndex = this._history.length - 1;
    }

    private _restoreHistorySnapshot(snapshot: string): void {
        if (!this.graph) { return; }
        this._isRestoringHistory = true;
        try {
            const data = JSON.parse(snapshot);
            this._importWorkflowData(data);
            this._saveWorkflowToLocalStorage();
        } catch (err) {
            console.error("Error restoring undo/redo snapshot:", err);
        } finally {
            this._isRestoringHistory = false;
        }
    }

    public undo(): void {
        if (this._historyIndex <= 0) { return; }
        this._historyIndex--;
        this._restoreHistorySnapshot(this._history[this._historyIndex]);
    }

    public redo(): void {
        if (this._historyIndex >= this._history.length - 1) { return; }
        this._historyIndex++;
        this._restoreHistorySnapshot(this._history[this._historyIndex]);
    }

    // Arranges nodes into left-to-right columns by dependency depth
    // reflects how data actually flows through the graph.
    public autoLayout(): void {
        if (!this.graph) { return; }
        const nodes = (this.graph as any)._nodes as LGraphNode[];
        if (nodes.length === 0) { return; }

        const groups = ((this.graph as any)._groups || []) as LGraphGroup[];
        const nodeToGroup = new Map<LGraphNode, LGraphGroup>();
        for (const group of groups) {
            group.recomputeInsideNodes();
            for (const node of (group as any)._nodes as LGraphNode[]) {
                if (!nodeToGroup.has(node)) {
                    nodeToGroup.set(node, group);
                }
            }
        }

        const depthCache = new Map<LGraphNode, number>();
        const computeDepth = (node: LGraphNode, visiting: Set<LGraphNode>): number => {
            if (depthCache.has(node)) { return depthCache.get(node)!; }
            if (visiting.has(node)) { return 0; }
            visiting.add(node);

            let maxParentDepth = -1;
            for (const input of node.inputs || []) {
                if (input.link === null || input.link === undefined) { continue; }
                const linkInfo = this.graph!.links[input.link];
                if (!linkInfo) { continue; }
                const originNode = this.graph!.getNodeById(linkInfo.origin_id);
                if (originNode && originNode !== node) {
                    maxParentDepth = Math.max(maxParentDepth, computeDepth(originNode, visiting));
                }
            }

            visiting.delete(node);
            const depth = maxParentDepth + 1;
            depthCache.set(node, depth);
            return depth;
        };

        type LayoutUnit = { depth: number; nodes: LGraphNode[]; group: LGraphGroup | null };
        const unitsByGroup = new Map<LGraphGroup, LayoutUnit>();
        const units: LayoutUnit[] = [];

        for (const node of nodes) {
            const depth = computeDepth(node, new Set());
            const group = nodeToGroup.get(node) || null;
            if (group) {
                let unit = unitsByGroup.get(group);
                if (!unit) {
                    unit = { depth, nodes: [], group };
                    unitsByGroup.set(group, unit);
                    units.push(unit);
                }
                unit.depth = Math.max(unit.depth, depth);
                unit.nodes.push(node);
            } else {
                units.push({ depth, nodes: [node], group: null });
            }
        }

        const layers = new Map<number, LayoutUnit[]>();
        for (const unit of units) {
            if (!layers.has(unit.depth)) { layers.set(unit.depth, []); }
            layers.get(unit.depth)!.push(unit);
        }

        const COLUMN_GAP = 60;
        const ROW_GAP = 30;
        const START_X = 40;
        const START_Y = 40;
        const GROUP_PADDING = 24;
        const GROUP_TITLE_SPACE = 30;

        let x = START_X;
        for (const depth of Array.from(layers.keys()).sort((a, b) => a - b)) {
            const columnUnits = layers.get(depth)!;
            let y = START_Y;
            let columnWidth = 0;

            for (const unit of columnUnits) {
                if (unit.group) {
                    let groupMinX = Infinity, groupMinY = Infinity;
                    for (const node of unit.nodes) {
                        groupMinX = Math.min(groupMinX, node.pos[0]);
                        groupMinY = Math.min(groupMinY, node.pos[1]);
                    }
                    const targetX = x + GROUP_PADDING;
                    const targetY = y + GROUP_PADDING + GROUP_TITLE_SPACE;
                    const dx = targetX - groupMinX;
                    const dy = targetY - groupMinY;
                    for (const node of unit.nodes) {
                        node.pos = [node.pos[0] + dx, node.pos[1] + dy];
                    }

                    let groupMaxX = -Infinity, groupMaxY = -Infinity;
                    for (const node of unit.nodes) {
                        groupMaxX = Math.max(groupMaxX, node.pos[0] + node.size[0]);
                        groupMaxY = Math.max(groupMaxY, node.pos[1] + node.size[1]);
                    }
                    const groupWidth = (groupMaxX - targetX) + GROUP_PADDING * 2;
                    const groupHeight = (groupMaxY - targetY) + GROUP_PADDING * 2 + GROUP_TITLE_SPACE;
                    (unit.group as any).pos = [x, y];
                    (unit.group as any).size = [groupWidth, groupHeight];

                    y += groupHeight + ROW_GAP;
                    columnWidth = Math.max(columnWidth, groupWidth);
                } else {
                    const node = unit.nodes[0];
                    node.pos = [x, y];
                    y += (node.size[1] || 60) + ROW_GAP;
                    columnWidth = Math.max(columnWidth, node.size[0] || 180);
                }
            }
            x += columnWidth + COLUMN_GAP;
        }

        this.graph.setDirtyCanvas(true, true);
        this._saveWorkflowToLocalStorage();
        this._pushHistorySnapshot();
    }

    public groupSelectedNodes(title: string = "Group"): void {
        if (!this.graph || !this.graphCanvas) { return; }
        const selected = Object.values(this.graphCanvas.selected_nodes || {}) as LGraphNode[];
        if (selected.length === 0) {
            console.warn("No nodes selected to group.");
            return;
        }
        this.wrapNodesInGroup(selected, title);
    }

    public wrapNodesInGroup(nodes: LGraphNode[], title: string): void {
        if (!this.graph || nodes.length === 0) { return; }

        const group = new (LGraphGroup as any)(title) as LGraphGroup;
        (this.graph as any).add(group);
        this._resizeGroupToFitNodes(group, nodes);
        group.recomputeInsideNodes();

        this.graph.setDirtyCanvas(true, true);
        this._saveWorkflowToLocalStorage();
        this._pushHistorySnapshot();
    }

    private _resizeGroupToFitNodes(group: LGraphGroup, nodes: LGraphNode[]): void {
        if (nodes.length === 0) { return; }

        const PADDING = 24;
        const TITLE_SPACE = 30;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of nodes) {
            minX = Math.min(minX, node.pos[0]);
            minY = Math.min(minY, node.pos[1]);
            maxX = Math.max(maxX, node.pos[0] + node.size[0]);
            maxY = Math.max(maxY, node.pos[1] + node.size[1]);
        }

        (group as any).pos = [minX - PADDING, minY - PADDING - TITLE_SPACE];
        (group as any).size = [(maxX - minX) + PADDING * 2, (maxY - minY) + PADDING * 2 + TITLE_SPACE];
    }

    public refitGroupsContaining(nodes: LGraphNode[]): void {
        if (!this.graph || nodes.length === 0) { return; }

        const groups = ((this.graph as any)._groups || []) as LGraphGroup[];
        const nodeSet = new Set(nodes);
        let changed = false;

        for (const group of groups) {
            group.recomputeInsideNodes();
            const members = (group as any)._nodes as LGraphNode[];
            if (members.some(n => nodeSet.has(n))) {
                this._resizeGroupToFitNodes(group, members);
                changed = true;
            }
        }

        if (changed) {
            this.graph.setDirtyCanvas(true, true);
            this._saveWorkflowToLocalStorage();
            this._pushHistorySnapshot();
        }
    }

    public toggleExecPins(show: boolean): void {
        ElephantLabNode.showExecPins = show;
        if (this.graph) {
        const nodes: LGraphNode[] = (this.graph as any)._nodes;

            for (const node of nodes) {
                if (node instanceof ElephantLabNode) {
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
            localStorage.setItem('elephant_lab-workflow', dataStr);
        } catch (err) {
            console.error("Error serializing workflow to localStorage:", err);
        }
    }

    private _loadWorkflowFromLocalStorage() {
        if (!this.graph) {
            return;
        }
        const dataStr = localStorage.getItem('elephant_lab-workflow');
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
                    const node = LiteGraph.createNode(node_info.type) as ElephantLabNode;
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

                        if (node_info.flags) {
                            node.flags = Object.assign({}, node.flags, node_info.flags);
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

            if (data.groups) {
                for (const group_info of data.groups) {
                    const group = new (LGraphGroup as any)() as LGraphGroup;
                    (group as any).configure(group_info);
                    (this.graph as any).add(group);
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

        const node = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
        if (this.graph && this.graphCanvas) {
            node.properties.item = item;
            node.setProperty("item", item);
            
            node.properties['param_io_class'] = ioClass;
            node.properties['param_filename'] = filePath;

            let x = 100;
            let y = 100;
            const current_nodes = this.graph!.findNodesByClass(ElephantLabNode as any);
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