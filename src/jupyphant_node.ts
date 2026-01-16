import { LiteGraph, LGraphNode, LGraphCanvas } from 'litegraph.js';
import { WorkflowEngineWidget } from './workflow_engine';

// Attributes of a Jupyphant Node to distinguish different types of nodes
export type DraggableItem = {
    id: string;
    name: string;
    code: string;
    is_class: boolean;
    parameters: { name: string, default: string }[];
    type?: string;
    variable_name?: string;
};

export type JupyphantNodeProperties = {
    item: DraggableItem;
    [key: string]: any;
}

// Own Jupyphant Node Class which adds additional properties to the regular LGraphNode
export class JupyphantNode extends LGraphNode {
    public static showExecPins = true;
    properties: JupyphantNodeProperties = {
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
            this.color = '#3B73B1';
            this.bgcolor = '#4A90E2';
        } else if (this._isOutputNode()) {
            this.color = '#A6742D';
            this.bgcolor = '#D99A3D';
        } else if (this._isProcessingNode()) {
            this.color = '#3B813B';
            this.bgcolor = '#4CAF50';
        }
        else {
            this.color = "";
            this.bgcolor = "";
        }
    }

    // Method used to set up input for classes / functions 
    public setupInputs(): void {
        if (JupyphantNode.showExecPins) {
            if (this.inputs.find(i => i.name === 'exec in')) { return; }
            if (this.properties.item?.code === '__UTIL_LOOP__') {
                this.addInput("exec in", "jupy_exec");
                this.addOutput("after loop", "jupy_exec");
                this.addOutput("loop body", "jupy_exec");
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
            if (JupyphantNode.showExecPins) {
                this.addInput("exec in", "jupy_exec");
            }
            this.addInput("List", "");

            if (JupyphantNode.showExecPins) {
                this.addOutput("after loop", "jupy_exec");
                this.addOutput("loop body", "jupy_exec");
            }
            this.addOutput("item", "");
            this.addOutput("index", "number");
            return;
        }

        const isProcessingNode = this._isProcessingNode()

        if (isProcessingNode) {
            if (JupyphantNode.showExecPins) {
                this.addInput("exec in", "jupy_exec");
                this.addOutput("exec out", "jupy_exec");
            }
        }

        const params = this.properties.item?.parameters;
        if (params && Array.isArray(params)) {
            params.forEach(param => {
                const propName = `param_${param.name}`;
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
            this.rebuildNode();
            this.updateNodeColor();
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