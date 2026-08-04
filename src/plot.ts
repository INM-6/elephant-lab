import { KernelMessage, Session } from '@jupyterlab/services';
import {
    Widget,
} from '@lumino/widgets';
import 'nouislider/dist/nouislider.css';
import { PlotContainer } from './plot_container';
import { PlotGraph } from './plot_graph';
import { KernelBridge } from './kernel_bridge';
import { PlotResponse } from './plot_graph_interfaces';

export class PlotlyFrontend {
    private session: Session.ISessionConnection;
    private kernelBridge: KernelBridge;
    private plots: Map<string, PlotContainer> = new Map();
    private outputWidget: Widget | null;
    private is_plot_theme_dark: boolean;

    constructor(session: Session.ISessionConnection, kernelBridge: KernelBridge, outputWidget: Widget | null = null) {
        this.session = session;
        this.kernelBridge = kernelBridge;
        this.outputWidget = outputWidget;
        this.is_plot_theme_dark = false;

        // Register the comm target to receive messages from Python
        this.session.kernel?.registerCommTarget(
            'plot_channel',
            (comm, msg) => {
                comm.onMsg = async (msg) => await this.handleCommMessage(msg);
            }
        );

        const resizePlots = () => {
            for (const plot of this.plots.values()) {
                plot.resize()
            }
        };

        const resizeObserver = new ResizeObserver(resizePlots);
        resizeObserver.observe(outputWidget!.node);
    }

    private async handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
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
                await this.handleLoading(plots2);
                break;
            case 'plots_update':
                const figs = (data.plots as Record<string, any>) ?? {};
                this.handleUpdate(figs);
                break;
            case 'plot_resample':
                const plotKey = data.plot_key as string;
                const dataBundle = data.data_bundle as unknown as PlotResponse;
                this.handleResample(plotKey, dataBundle);
                break;
            default:
                console.warn('Unknown plot message type', data.type, data.message);
        }
    }

    private handleRemove(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            const state = this.plots.get(key);
            if (state) {
                state.destroy()
                this.plots.delete(key);
            }
        });
    }

    private async handleLoading(plotKeys: string[]) {
        await Promise.all(plotKeys.map(async (key) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotGraph(key, this.kernelBridge, this.outputWidget);
                this.plots.set(key, state);
            }
            state.startLoading();
        }));
    }

    private handleUpdate(figs: Record<string, any>) {
        Object.entries(figs).forEach(([key, figDict]) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotGraph(key, this.kernelBridge, this.outputWidget);
                this.plots.set(key, state);
            }
            state.render(figDict, this.is_plot_theme_dark)
        });
    }

    private handleResample(plotKey: string, dataBundle: PlotResponse) {
        let state = this.plots.get(plotKey) as PlotGraph;
        if (state) {
            state.resample(dataBundle);
        }
    }

    public setThemes(is_dark: boolean) {
        if (this.is_plot_theme_dark == is_dark) {
            return;
        }
        this.is_plot_theme_dark = is_dark;
        for (const plot of this.plots.values()) {
            plot.setTheme(is_dark)
        }
    }
}