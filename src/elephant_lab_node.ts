import { LiteGraph, LGraphNode, LGraphCanvas } from 'litegraph.js';
import { WorkflowEngineWidget } from './workflow_engine';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog } from '@jupyterlab/filebrowser';

// Attributes of an Elephant Lab Node to distinguish different types of nodes
export type DraggableItem = {
    id: string;
    name: string;
    code: string;
    is_class: boolean;
    parameters: { name: string, default: string }[];
    type?: string;
    variable_name?: string;
    source_file?: string;
    source_io_class?: string;
};

export type ElephantLabNodeProperties = {
    item: DraggableItem;
    [key: string]: any;
}

function toKernelRelativePath(notebookDir: string, fileServerPath: string): string {
    const fromParts = notebookDir.split('/').filter(p => p.length > 0);
    const toParts = fileServerPath.split('/').filter(p => p.length > 0);

    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
        i++;
    }

    const upCount = fromParts.length - i;
    const relativeParts = new Array(upCount).fill('..').concat(toParts.slice(i));
    return relativeParts.length > 0 ? relativeParts.join('/') : '.';
}

function deriveItemLabel(rawLabel: string | undefined, index: number): string {
    const isUnusable = (s: string) => !s || s === 'list' || s === 'print' || s === 'neo';
    if (rawLabel) {
        const match = rawLabel.match(/[A-Za-z_][A-Za-z0-9_]*/);
        const word = match ? match[0].toLowerCase() : '';
        if (!isUnusable(word)) {
            return `${word}_${index}`;
        }
    }
    return `list_item_${index}`;
}

// Own ElephantLab Node Class which adds additional properties to the regular LGraphNode
export class ElephantLabNode extends LGraphNode {
    public static showExecPins = false;
    public docManager?: IDocumentManager;
    properties: ElephantLabNodeProperties = {
        item: { id: '', name: '', code: '', is_class: false, parameters: [] }
    };
    constructor() {
        super();
    }

    private _isOutputNode(): boolean {
        const itemName = this.properties.item?.name.toLowerCase() || '';
        return itemName === 'print' || itemName === 'plot';
    }

    private _isProcessingNode(): boolean {
        const itemCode = this.properties.item?.code || '';
        const itemName = this.properties.item?.name || '';

        if (itemCode.startsWith('__UTIL_') && itemCode !== '__UTIL_INTEGER__' && itemCode !== '__UTIL_LIST__') {
            return true;
        }
        if (itemName.startsWith('.')) {
            return true;
        }
        if (itemCode.startsWith('elephant.')) {
            return true;
        }
        if (itemCode.startsWith('__NEO_')) {
            return true;
        }
        if (itemCode.startsWith('__NOTEBOOK_FUNC__')) {
            return true;
        }
        return false;
    }

    private updateNodeColor(): void {
        if (this.properties.item?.is_class) {
            this.color = '#3b72b148';
            this.bgcolor = '#4a91e23b';
        } else if (this._isOutputNode()) {
            this.color = '#a6742d3f';
            this.bgcolor = '#d99b3d46';
        } else if (this._isProcessingNode()) {
            this.color = '#3b813b3f';
            this.bgcolor = '#4caf4f36';
        }
        else {
            this.color = "";
            this.bgcolor = "";
        }
    }

    // Method used to set up input for classes / functions 
    public setupInputs(): void {
        if (ElephantLabNode.showExecPins) {
            if (this._isProcessingNode() && !this.outputs.find(o => o.name === 'exec out')) {
                this.addOutput("exec out", "jupy_exec");
            }
        } else {
            const execOut = this.outputs.findIndex(o => o.name === 'exec out');
            if (execOut !== -1) { this.removeOutput(execOut); }
        }
    }

    private rebuildNode() {
        const graph = this.graph;
        const preservedInputs: { name: string; originNode: LGraphNode; originSlot: number }[] = [];
        if (graph && this.inputs) {
            for (const inp of this.inputs) {
                if (!inp || inp.link == null) { continue; }
                const link = graph.links[inp.link];
                if (!link) { continue; }
                const originNode = graph.getNodeById(link.origin_id);
                if (originNode) { preservedInputs.push({ name: inp.name, originNode, originSlot: link.origin_slot }); }
            }
        }
        const preservedOutputs: { name: string; targetNode: LGraphNode; targetSlot: number }[] = [];
        if (graph && this.outputs) {
            for (const out of this.outputs) {
                if (!out || !out.links) { continue; }
                for (const linkId of out.links) {
                    const link = graph.links[linkId];
                    if (!link) { continue; }
                    const targetNode = graph.getNodeById(link.target_id);
                    if (targetNode) { preservedOutputs.push({ name: out.name, targetNode, targetSlot: link.target_slot }); }
                }
            }
        }

        this._rebuildNodePins();

        if (graph) {
            for (const p of preservedInputs) {
                const slot = this.inputs.findIndex(i => i.name === p.name);
                if (slot !== -1) { p.originNode.connect(p.originSlot, this, slot); }
            }
            for (const p of preservedOutputs) {
                const slot = this.outputs.findIndex(o => o.name === p.name);
                if (slot !== -1) { this.connect(slot, p.targetNode, p.targetSlot); }
            }
        }
    }

    private _rebuildNodePins() {
        this.inputs.length = 0;
        (this as any).widgets = [];
        this.outputs.length = 0;

        if (this.properties.item?.code === '__UTIL_LOOP__') {
            this.title = "For Loop";
            this.addInput("exec in", "jupy_exec");
            this.addInput("List", "", { shape: LiteGraph.BOX_SHAPE });
            this.addInput("item to collect", "", { shape: LiteGraph.BOX_SHAPE });

            this.addOutput("after loop", "jupy_exec");
            this.addOutput("loop body", "jupy_exec");
            this.addOutput("item", "", { shape: LiteGraph.BOX_SHAPE });
            this.addOutput("index", "", { shape: LiteGraph.BOX_SHAPE });
            this.addOutput("collected", "", { shape: LiteGraph.BOX_SHAPE });
            return;
        } else if (this.properties.item?.code === '__UTIL_REPEAT_LOOP__') {
            this.title = "Repeat Loop";
            this.addInput("exec in", "jupy_exec");
            this.addInput("count", -1, { label: "count", shape: LiteGraph.BOX_SHAPE });
            if (this.properties['param_count'] === undefined) {
                this.properties['param_count'] = "10";
            }
            this.addWidget("text", "count", this.properties['param_count'], (value: string) => {
                this.properties['param_count'] = value;
            }, {});

            this.addOutput("after loop", "jupy_exec");
            this.addOutput("loop body", "jupy_exec");
            this.addOutput("index", "", { shape: LiteGraph.BOX_SHAPE });
            this.addOutput("collected", "", { shape: LiteGraph.BOX_SHAPE });
            return;
        } else if (this.properties.item?.code === '__UTIL_IF__') {
            this.title = "If/Else";
            this.addInput("exec in", "jupy_exec");
            this.addInput("condition", "", { shape: LiteGraph.BOX_SHAPE });

            this.addOutput("after if/else", "jupy_exec");
            this.addOutput("if body", "jupy_exec");
            this.addOutput("else body", "jupy_exec");
            return;
        }

        const isProcessingNode = this._isProcessingNode()

        if (isProcessingNode) {
            this.addInput("exec in", "jupy_exec");
            if (ElephantLabNode.showExecPins) {
                this.addOutput("exec out", "jupy_exec");
            }
        }

        const params = this.properties.item?.parameters;
        const isCompactListNode = this.properties.item?.code === '__UTIL_LIST__' &&
            !!params && params.length > 0 &&
            params.every(p => p.default && p.default !== '' && p.default !== '__REQUIRED__');

        if (isCompactListNode && params) {
            for (const param of params) {
                const propName = `param_${param.name}`;
                if (this.properties[propName] === undefined) {
                    this.properties[propName] = param.default;
                }
            }
            this.addWidget("text", "items", `${params.length} items (right-click: Extract Items)`, () => { }, {});
        } else if (params && Array.isArray(params)) {
            params.forEach(param => {
                const propName = `param_${param.name}`;
                const defaultValue = (param.default === "__REQUIRED__") ? "" : param.default;
                if (this.properties[propName] === undefined) {
                    this.properties[propName] = defaultValue;
                }

                this.addInput(param.name, -1, { label: param.name, shape: LiteGraph.BOX_SHAPE });

                if (param.name !== "__self__") {
                    const widget = this.addWidget("text", param.name, this.properties[propName], (value: string) => {
                        this.properties[propName] = value;
                    }, {});

                    if (this.properties.item?.code === '__NEO_READ_FILE__' && param.name === 'filename') {
                        this.addWidget("button", "Browse...", "", () => {
                            if (!this.docManager && this.graph && (this.graph as any).widget) {
                                this.docManager = ((this.graph as any).widget as WorkflowEngineWidget).docManager;
                            }

                            if (this.docManager) {
                                const dialogPromise = FileDialog.getOpenFiles({
                                    manager: this.docManager
                                });

                                // Prevent double-click from triggering JupyterLab's file-open handler
                                let dialogNode: Element | null = null;
                                const stopDblClick = (e: Event) => {
                                    const item = (e.target as Element).closest('.jp-DirListing-item');
                                    // Allow double-click on folders so navigation still works
                                    if (item?.getAttribute('data-isdir') === 'true') {
                                        return;
                                    }
                                    e.stopImmediatePropagation();
                                    e.stopPropagation();
                                    const acceptBtn = dialogNode?.querySelector('.jp-Dialog-button.jp-mod-accept') as HTMLElement | null;
                                    acceptBtn?.click();
                                };
                                setTimeout(() => {
                                    dialogNode = document.querySelector('.jp-Dialog');
                                    if (dialogNode) {
                                        dialogNode.addEventListener('dblclick', stopDblClick, true);
                                    }
                                }, 0);

                                dialogPromise.then(result => {
                                    if (dialogNode) {
                                        (dialogNode as Element).removeEventListener('dblclick', stopDblClick, true);
                                    }
                                    if (result.button.accept && result.value && result.value.length > 0) {
                                        const selectedFile = result.value[0];
                                        let filePath = selectedFile.path;

                                        const notebookPath = ((this.graph as any)?.widget as WorkflowEngineWidget)?.session?.path;
                                        if (notebookPath) {
                                            const notebookDir = notebookPath.includes('/') ? notebookPath.slice(0, notebookPath.lastIndexOf('/')) : '';
                                            filePath = toKernelRelativePath(notebookDir, filePath);
                                        }

                                        widget.value = filePath;
                                        this.properties['param_filename'] = filePath;
                                        if (this.graph) {
                                            (this.graph as any).setDirtyCanvas(true, true);
                                        }
                                    }
                                });
                            } else {
                                console.error("docManager is not available on this ElephantLabNode.");
                            }
                        });
                    }
                }
            });
        }
        this.addOutput("result", -1, { shape: LiteGraph.BOX_SHAPE });

        if (this.properties.item?.code?.startsWith('__NOTEBOOK_FUNC__')) {
            this._addNotebookFunctionSelector();
        }
    }

    // Fetches the notebook's own top-level functions and adds a dropdown to pick one
    private _addNotebookFunctionSelector(): void {
        const graphWidget = (this.graph as any)?.widget as WorkflowEngineWidget | undefined;
        const kernelBridge = graphWidget && (graphWidget as any).kernelBridge;
        if (!kernelBridge) { return; }

        const isPlaceholder = this.properties.item?.code === '__NOTEBOOK_FUNC__';
        const label = isPlaceholder ? "+ select function" : (this.properties.item?.name || "+ select function");

        this.addWidget(
            "button",
            label,
            "",
            (widgetInstance: any, graphCanvasInstance: any, node: LGraphNode, pos: any, event: MouseEvent | undefined) => {
                kernelBridge.getNotebookFunctions().then((functions: DraggableItem[] | null) => {
                    if (!functions || !this.graph) { return; }
                    new (LiteGraph as any).ContextMenu(functions.map((f: DraggableItem) => f.name), {
                        event,
                        callback: (selectedName: string) => {
                            const selected = functions.find(f => f.name === selectedName);
                            if (selected) {
                                this.setProperty("item", selected);
                            }
                        }
                    });
                });
            }
        );
    }

    getExtraMenuOptions(): any[] | null {
        if (this.properties.item?.code !== '__UTIL_LIST__') { return null; }
        const node = this;

        return [
            {
                content: "Extract Items",
                callback: () => {
                    if (!node.graph) { return; }
                    const count = node.properties.item.parameters?.length || 0;
                    if (count === 0) { return; }

                    const revealedNodes: LGraphNode[] = [];
                    const createdNodes: ElephantLabNode[] = [];
                    const outputSlot = node.outputs.findIndex(o => o.name === 'result');
                    let x = node.pos[0] + node.size[0] + 30;
                    let y = node.pos[1];

                    for (let index = 0; index < count; index++) {
                        const inputInfo = node.inputs[index];
                        if (inputInfo && inputInfo.link !== null && inputInfo.link !== undefined) {
                            const linkInfo = (node.graph as any).links[inputInfo.link];
                            const originNode = linkInfo ? node.graph.getNodeById(linkInfo.origin_id) : null;
                            if (originNode) {
                                originNode.flags = originNode.flags || {};
                                originNode.flags.collapsed = false;
                                revealedNodes.push(originNode);
                                continue;
                            }
                        }

                        const originalLabels = (node as ElephantLabNode).properties['item_labels'] as string[] | undefined;
                        const getItemItem: DraggableItem = {
                            id: `util/getitem_${index}`,
                            name: deriveItemLabel(originalLabels?.[index], index),
                            code: "__UTIL_GETITEM__",
                            is_class: false,
                            parameters: [
                                { name: "list", default: "__REQUIRED__" },
                                { name: "index", default: String(index) }
                            ]
                        };

                        const getItemNode = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                        getItemNode.properties.item = getItemItem;
                        getItemNode.setProperty("item", getItemItem);

                        while (node.graph.getNodeOnPos(x, y)) {
                            y += 30;
                        }
                        getItemNode.pos = [x, y];
                        node.graph.add(getItemNode);
                        createdNodes.push(getItemNode);
                        y += 60;

                        const inputSlot = getItemNode.inputs.findIndex(i => i.name === 'list');
                        if (outputSlot !== -1 && inputSlot !== -1) {
                            node.connect(outputSlot, getItemNode, inputSlot);
                        }
                    }

                    const engineWidget = (node.graph as any).widget as WorkflowEngineWidget | undefined;
                    if (engineWidget) {
                        if (revealedNodes.length > 0) {
                            engineWidget.refitGroupsContaining(revealedNodes);
                        }
                        if (createdNodes.length > 1) {
                            engineWidget.wrapNodesInGroup(createdNodes, `${node.title} items (${createdNodes.length})`);
                            for (const createdNode of createdNodes) {
                                createdNode.flags = createdNode.flags || {};
                                createdNode.flags.collapsed = true;
                            }
                        }
                    }

                    if ((node.graph as any)._canvas) {
                        (node.graph as any)._canvas.draw(true, true);
                    }
                }
            }
        ];
    }

    // called when a new Node gets created
    override onAdded(): void {
        if (this.properties.item && this.properties.item.name) {
            this.title = this.properties.item.name;
            this.rebuildNode();
            this.updateNodeColor();

            if (this.properties.item.code === '__NEO_READ_FILE__') {
                const extractable = ['spiketrains', 'analogsignals', 'segments', 'events', 'epochs'];
                this.addWidget(
                    "combo",
                    "Extract",
                    "+ extract",
                    (value: string, widget: any, node: LGraphNode) => {
                        if (value === "+ extract" || !node.graph) {
                            setTimeout(() => { widget.value = "+ extract"; }, 0);
                            return;
                        }

                        const extractorItem: DraggableItem = {
                            id: `neo/get_${value}`,
                            name: `Get ${value}`,
                            code: `__NEO_GET_${value.toUpperCase()}__`,
                            is_class: false,
                            parameters: [{ name: 'neo_object', default: '__REQUIRED__' }]
                        };

                        const extractorNode = LiteGraph.createNode("workflow/elephant_lab_node") as ElephantLabNode;
                        extractorNode.properties.item = extractorItem;
                        extractorNode.setProperty("item", extractorItem);

                        let x = node.pos[0] + node.size[0] + 30;
                        let y = node.pos[1];

                        // avoid collision
                        while (node.graph.getNodeOnPos(x, y)) {
                            y += 30;
                        }
                        extractorNode.pos = [x, y];

                        node.graph.add(extractorNode);

                        // connect output of reader to input of extractor
                        const outputSlot = node.outputs.findIndex(o => o.name === 'result');
                        const inputSlot = extractorNode.inputs.findIndex(i => i.name === 'neo_object');
                        if (outputSlot !== -1 && inputSlot !== -1) {
                            node.connect(outputSlot, extractorNode, inputSlot);
                        }

                        setTimeout(() => {
                            widget.value = "+ extract";
                            if ((node.graph as any)._canvas) {
                                (node.graph as any)._canvas.draw(true, true);
                            }
                        }, 0);
                    },
                    { values: ["+ extract", ...extractable] }
                );
            }
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
                this.rebuildNode();
                this.updateNodeColor();
            }
        }
    }

    // This function is overwritten so that one can add additional items on the node (currently used for the information "i")
    override onDrawForeground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
        super.onDrawForeground?.(ctx, canvas);
        if (this.flags.collapsed) {
            return;
        }

        const icon_size = 16;
        const margin = 5;
        const y = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - icon_size) / 2;

        // Draw the 'X' icon on the far right
        const delete_x = this.size[0] - icon_size - margin;
        ctx.save();
        ctx.fillStyle = "#E24A4A";
        ctx.beginPath();
        ctx.arc(delete_x + icon_size / 2, y + icon_size / 2, icon_size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("X", delete_x + icon_size / 2, y + icon_size / 2);
        ctx.restore();

        // Draw the 'i' icon to the left of the 'X' icon
        const info_x = this.size[0] - (icon_size + margin) * 2;
        ctx.save();
        ctx.fillStyle = "#4A90E2";
        ctx.beginPath();
        ctx.arc(info_x + icon_size / 2, y + icon_size / 2, icon_size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("i", info_x + icon_size / 2, y + icon_size / 2);
        ctx.restore();

        // Refresh icon - Notebook Function nodes only, since it re-fetches that function's
        // current signature (in case it was edited after this node was configured).
        if (this.properties.item?.code?.startsWith('__NOTEBOOK_FUNC__')) {
            const refresh_x = this.size[0] - (icon_size + margin) * 3;
            ctx.save();
            ctx.fillStyle = "#3DBE6C";
            ctx.beginPath();
            ctx.arc(refresh_x + icon_size / 2, y + icon_size / 2, icon_size / 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "white";
            ctx.font = "bold 12px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↻", refresh_x + icon_size / 2, y + icon_size / 2);
            ctx.restore();
        }
    };

    override onMouseDown(e: MouseEvent, local_pos: [number, number], graphcanvas: LGraphCanvas): boolean {
        const icon_size = 16;
        const margin = 5;
        const y = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - icon_size) / 2;

        const delete_x = this.size[0] - icon_size - margin;
        if (local_pos[0] >= delete_x && local_pos[0] <= delete_x + icon_size &&
            local_pos[1] >= y && local_pos[1] <= y + icon_size) {
            if ((graphcanvas.graph as any)) {
                (graphcanvas.graph as any).remove(this);
            }
            return true;
        }

        const info_x = this.size[0] - (icon_size + margin) * 2;
        if (local_pos[0] >= info_x && local_pos[0] <= info_x + icon_size &&
            local_pos[1] >= y && local_pos[1] <= y + icon_size) {
            const widget = (graphcanvas.graph as any).widget as WorkflowEngineWidget;
            widget.showNodeInfo(this);
            return true;
        }

        if (this.properties.item?.code?.startsWith('__NOTEBOOK_FUNC__')) {
            const refresh_x = this.size[0] - (icon_size + margin) * 3;
            if (local_pos[0] >= refresh_x && local_pos[0] <= refresh_x + icon_size &&
                local_pos[1] >= y && local_pos[1] <= y + icon_size) {
                this._refreshNotebookFunction();
                return true;
            }
        }
        return false;

    }

    // Re-fetches this node's own function from the notebook and reconfigures the node if its
    // signature changed (params added/removed/renamed) - without needing to reselect it from
    // the dropdown
    private _refreshNotebookFunction(): void {
        const graphWidget = (this.graph as any)?.widget as WorkflowEngineWidget | undefined;
        const kernelBridge = graphWidget && (graphWidget as any).kernelBridge;
        const currentName = this.properties.item?.name;
        if (!kernelBridge || !currentName) { return; }

        kernelBridge.getNotebookFunctions().then((functions: DraggableItem[] | null) => {
            const refreshed = functions?.find(f => f.name === currentName);
            if (refreshed) {
                this.setProperty("item", refreshed);
            } else {
                console.warn(`Elephant Lab: could not refresh '${currentName}' - it no longer appears to be defined in the notebook.`);
            }
        });
    }
}
LiteGraph.registerNodeType("workflow/elephant_lab_node", ElephantLabNode);