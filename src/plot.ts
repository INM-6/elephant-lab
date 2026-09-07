import { KernelMessage, Session } from '@jupyterlab/services';
import {
    Widget,
} from '@lumino/widgets';
import 'nouislider/dist/nouislider.css';
import { PlotContainer } from './plot_container';
import { PlotGraph } from './plot_graph';
import { PlotImageSequence } from './plot_image_sequence';
import { KernelBridge } from './kernel_bridge';
import { ResampleResponse } from './plot_graph_interfaces';

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
                const plotKeysRaw1 = data.plot_keys as unknown[];
                // filter only strings
                const plotKeys1: string[] = Array.isArray(plotKeysRaw1)
                    ? plotKeysRaw1.filter((x): x is string => typeof x === 'string')
                    : [];
                this.handleRemove(plotKeys1);
                break;
            case 'plots_loading':
                const plotKeysRaw2 = data.plot_keys as unknown[];
                const plotKeys2: string[] = Array.isArray(plotKeysRaw2)
                    ? plotKeysRaw2.filter((x): x is string => typeof x === 'string')
                    : [];
                const plotTypesRaw = data.plot_types as unknown[];
                const plotTypes: string[] = Array.isArray(plotTypesRaw)
                    ? plotTypesRaw.filter((x): x is string => typeof x === 'string')
                    : [];
                await this.handleLoading(plotKeys2, plotTypes);
                break;
            case 'plots_update':
                const figs = (data.plots as Record<string, any>) ?? {};
                this.handleUpdate(figs);
                break;
            case 'plot_resample':
                const plotKey = data.plot_key as string;
                const resampleResponse = data.resample_response as unknown as ResampleResponse;
                this.handleResample(plotKey, resampleResponse);
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

    private async handleLoading(plotKeys: string[], plotTypes: string[]) {

        await Promise.all(plotKeys.map(async (key, index) => {

            let state = this.plots.get(key);

            if (!state) {

                const plotType = plotTypes[index];

                if (plotType === "graph") {
                    state = new PlotGraph(
                        key,
                        this.kernelBridge,
                        this.outputWidget
                    );
                } else if (plotType === "image_sequence") {
                    state = new PlotImageSequence(
                        key,
                        this.kernelBridge,
                        this.outputWidget
                    );
                } else {
                    throw new Error(`Unknown plot type: ${plotType}`);
                }

                this.plots.set(key, state!);
            }

            state!.startLoading();

        }));

    }

    private handleUpdate(figs: Record<string, any>) {
        Object.entries(figs).forEach(([key, figDict]) => {
            let state = this.plots.get(key);
            if (!state) {
                throw new Error(`state does not exist for ${key}`);
            }
            state.render(figDict, this.is_plot_theme_dark)
        });
    }

    private handleResample(plotKey: string, resampleResponse: ResampleResponse) {
        let state = this.plots.get(plotKey) as PlotGraph;
        if (state) {
            state.resample(resampleResponse);
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