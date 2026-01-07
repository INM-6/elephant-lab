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
};

export type JupyphantNodeProperties = {
    item: DraggableItem;
    [key: string]: any;
}

// Own Jupyphant Node Class which adds additional properties to the regular LGraphNode
export class JupyphantNode extends LGraphNode {
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

        if (this.properties.item?.code === '__UTIL_LOOP__') {
            this.title = "For Loop";
            this.addInput("exec in", LiteGraph.EVENT);
            this.addInput("List", "");

            this.addOutput("after loop", LiteGraph.EVENT);
            this.addOutput("loop body", LiteGraph.EVENT);
            this.addOutput("item", "");
            this.addOutput("index", "number");
            return;
        }

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