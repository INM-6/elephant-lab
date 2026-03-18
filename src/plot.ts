import { KernelMessage, Session } from '@jupyterlab/services';
import { OutputArea } from '@jupyterlab/outputarea';
import * as Plotly from 'plotly.js-dist';

// Store state for currently rendered plots
interface PlotState {
    container: HTMLDivElement;
    isLoading: boolean;
    updateId: number;
}

export class PlotlyFrontend {
    private session: Session.ISessionConnection;
    private plots: Map<string, PlotState> = new Map();
    private outputArea: OutputArea | null;

    constructor(session: Session.ISessionConnection, outputArea: OutputArea | null = null) {
        this.session = session;
        this.outputArea = outputArea;

        // Register the comm target to receive messages from Python
        this.session.kernel?.registerCommTarget(
            'plot_channel',
            (comm, msg) => {
                console.log('comm opened', msg)
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );
    }

    private handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
        console.log('handle message', msg)
        const data = msg.content.data;

        switch (data.type) {
            case 'plots_remove':
                const plotsRaw1 = data.plots as unknown[];
                // filter only strings
                const plots1: string[] = Array.isArray(plotsRaw1)
                    ? plotsRaw1.filter((x): x is string => typeof x === 'string')
                    : [];
                this.handleRemove(plots1);
                break;
            case 'plots_loading':
                const plotsRaw2 = data.plots as unknown[];
                const plots2: string[] = Array.isArray(plotsRaw2)
                    ? plotsRaw2.filter((x): x is string => typeof x === 'string')
                    : [];
                this.handleLoading(plots2);
                break;
            case 'plots_update':
                const figs = (data.plots as Record<string, any>) ?? {};
                const updateId = typeof data.update_id === 'number' ? data.update_id : -1;
                this.handleUpdate(figs, updateId);
                break;
            default:
                console.warn('Unknown plot message type', data.type);
        }
    }

    private getContainer(): HTMLDivElement {
        const container = document.createElement('div');
        container.classList.add('plot-container');

        if (this.outputArea) {
            // Render inside the output area's node
            this.outputArea.node.appendChild(container);
        } else {
            // Fallback to body
            document.body.appendChild(container);
        }

        return container;
    }

    private handleRemove(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            const state = this.plots.get(key);
            if (state) {
                state.container.remove(); // remove from DOM
                this.plots.delete(key);
            }
        });
    }

    private handleLoading(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            let state = this.plots.get(key);
            if (!state) {
                const container = this.getContainer();
                container.innerHTML = '⏳ <b>Loading...</b>';
                state = { container, isLoading: true, updateId: -1 };
                this.plots.set(key, state);
            } else {
                state.container.innerHTML = '⏳ <b>Loading...</b>';
                state.isLoading = true;
            }
        });
    }

    private handleUpdate(figs: Record<string, any>, updateId: number) {
        Object.entries(figs).forEach(([key, figJson]) => {
            let state = this.plots.get(key);

            // Ignore stale updates
            if (state && state.updateId >= updateId) {
                return;
            }

            // Create container if missing
            if (!state) {
                const container = this.getContainer();
                state = { container, isLoading: false, updateId };
                this.plots.set(key, state);
            }

            // Render or update plot
            Plotly.react(state.container, figJson.data, figJson.layout);

            state.updateId = updateId;
            state.isLoading = false;
        });
    }
}