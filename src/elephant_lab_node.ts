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
};

export type ElephantLabNodeProperties = {
    item: DraggableItem;
    [key: string]: any;
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
            if (this.inputs.find(i => i.name === 'exec in')) { return; }
            if (this.properties.item?.code === '__UTIL_LOOP__') {
                this.addInput("exec in", "jupy_exec");
                this.addOutput("after loop", "jupy_exec");
                this.addOutput("loop body", "jupy_exec");
            } else if (this.properties.item?.code === '__UTIL_IF__') {
                this.addInput("exec in", "jupy_exec");
                this.addOutput("after if/else", "jupy_exec");
                this.addOutput("if body", "jupy_exec");
                this.addOutput("else body", "jupy_exec");
            } else if (this._isProcessingNode()) {
                this.addInput("exec in", "jupy_exec");
                this.addOutput("exec out", "jupy_exec");
            }
        } else {
            const execIn = this.inputs.findIndex(i => i.name === 'exec in');
            if (execIn !== -1) { this.removeInput(execIn); }

            const execOut = this.outputs.findIndex(o => o.name === 'exec out');
            if (execOut !== -1) { this.removeOutput(execOut); }

            const afterLoop = this.outputs.findIndex(o => o.name === 'after loop');
            if (afterLoop !== -1) { this.removeOutput(afterLoop); }

            const loopBody = this.outputs.findIndex(o => o.name === 'loop body');
            if (loopBody !== -1) { this.removeOutput(loopBody); }

            const afterIf = this.outputs.findIndex(o => o.name === 'after if/else');
            if (afterIf !== -1) { this.removeOutput(afterIf); }

            const ifBody = this.outputs.findIndex(o => o.name === 'if body');
            if (ifBody !== -1) { this.removeOutput(ifBody); }

            const elseBody = this.outputs.findIndex(o => o.name === 'else body');
            if (elseBody !== -1) { this.removeOutput(elseBody); }
        }
    }

    private rebuildNode() {
        this.inputs.length = 0;
        if ((this as any).widgets) {
            while ((this as any).widgets.length > 0) {
                (this as any).removeWidget(0);
            }
        }
        this.outputs.length = 0;

        if (this.properties.item?.code === '__UTIL_LOOP__') {
            this.title = "For Loop";
            if (ElephantLabNode.showExecPins) {
                this.addInput("exec in", "jupy_exec");
            }
            this.addInput("List", "");

            if (ElephantLabNode.showExecPins) {
                this.addOutput("after loop", "jupy_exec");
                this.addOutput("loop body", "jupy_exec");
            }
            this.addOutput("item", "");
            this.addOutput("index", "number");
            return;
        } else if (this.properties.item?.code === '__UTIL_IF__') {
            this.title = "If/Else";
            if (ElephantLabNode.showExecPins) {
                this.addInput("exec in", "jupy_exec");
            }
            this.addInput("condition", "");

            if (ElephantLabNode.showExecPins) {
                this.addOutput("after if/else", "jupy_exec");
                this.addOutput("if body", "jupy_exec");
                this.addOutput("else body", "jupy_exec");
            }
            return;
        }

        const isProcessingNode = this._isProcessingNode()

        if (isProcessingNode) {
            if (ElephantLabNode.showExecPins) {
                this.addInput("exec in", "jupy_exec");
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

                this.addInput(param.name, -1, { label: param.name });

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
                                FileDialog.getOpenFiles({
                                    manager: this.docManager
                                }).then(result => {
                                    if (result.button.accept && result.value && result.value.length > 0) {
                                        const selectedFile = result.value[0];
                                        const filePath = selectedFile.path;
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
        this.addOutput("result", -1);
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
        return false;

    }
}
LiteGraph.registerNodeType("workflow/elephant_lab_node", ElephantLabNode);