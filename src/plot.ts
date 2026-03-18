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
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );
    }

    private handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
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

    private getContainer(): { wrapper: HTMLDivElement; container: HTMLDivElement; loading: HTMLDivElement } {
        const wrapper = document.createElement('div');
        wrapper.classList.add('plot-wrapper');

        const loading = document.createElement('div');
        loading.classList.add('plot-loading');
        loading.innerHTML = '⏳ <b>Loading...</b>';
        wrapper.appendChild(loading);

        const container = document.createElement('div');
        container.classList.add('plot-container');
        wrapper.appendChild(container);

        if (this.outputArea) {
            this.outputArea.node.appendChild(wrapper);
        } else {
            document.body.appendChild(wrapper);
        }

        return { wrapper, container, loading };
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
                const { container, loading } = this.getContainer();
                state = { container, isLoading: true, updateId: -1 };
                // store loading div reference
                (state as any).loading = loading;
                this.plots.set(key, state);
            }
            (state as any).loading.style.display = 'block';
        });
    }

    private handleUpdate(figs: Record<string, any>, updateId: number) {
        Object.entries(figs).forEach(([key, figJson]) => {
            let state = this.plots.get(key);

            if (!state) {
                const { container, loading } = this.getContainer();
                state = { container, isLoading: false, updateId };
                (state as any).loading = loading;
                this.plots.set(key, state);
            }

            // hide loading indicator
            (state as any).loading.style.display = 'none';

            // render plot
            Plotly.react(state.container, figJson.data, figJson.layout);

            function safeResizePlot(container: HTMLDivElement) {
                const rect = container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    Plotly.Plots.resize(container);
                } else {
                    // Retry later when it becomes visible
                    setTimeout(() => safeResizePlot(container), 100);
                }
            }

            const ro = new ResizeObserver(() => safeResizePlot(state!.container));

            ro.observe(state.container);

            state.updateId = updateId;
            state.isLoading = false;
        });
    }
}