import { Kernel, KernelMessage } from '@jupyterlab/services';
import { OutputArea } from '@jupyterlab/outputarea';
import 'nouislider/dist/nouislider.css';
import { PlotContainer } from './plot_container';

export class PlotlyFrontend {
    /**
     * Manages the creation and insertion of Plot Containers.
     *
     */
    private kernel: Kernel.IKernelConnection;
    private plots: Map<string, PlotContainer> = new Map();
    private outputArea: OutputArea | null;
    private is_plot_theme_dark: boolean;
    private resizeObserver: ResizeObserver;

    constructor(kernel: Kernel.IKernelConnection, outputArea: OutputArea | null = null) {
        this.kernel = kernel;
        this.outputArea = outputArea;
        this.is_plot_theme_dark = true

        // Register the comm target to receive messages from Python
        this.kernel.registerCommTarget(
            'plot_channel',
            (comm, msg) => {
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );

        const resizePlots = () => {
            for (const plot of this.plots.values()) {
                plot.resize()
            }
        };

        this.resizeObserver = new ResizeObserver(resizePlots);
        this.resizeObserver.observe(outputArea!.node);
    }

    /**
     * Tears down every plot this instance created (removing their DOM nodes
     * from `outputArea` - they were appended directly to it, outside the
     * OutputAreaModel, so nothing else clears them - see PlotContainer) and
     * disconnects the resize observer. Call this before replacing an
     * attachment's PlotlyFrontend with a new one (e.g. on a kernel restart):
     * without it, the old instance's plots simply stay on screen forever,
     * abandoned, since a fresh PlotlyFrontend starts from an empty `plots`
     * map and has no way to know about them.
     */
    public dispose() {
        this.resizeObserver.disconnect();
        for (const plot of this.plots.values()) {
            plot.destroy();
        }
        this.plots.clear();
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

    private handleLoading(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotContainer(this.outputArea);
                this.plots.set(key, state);
            }
            state.showLoading()
        });
    }

    private handleUpdate(figs: Record<string, any>, updateId: number) {
        Object.entries(figs).forEach(([key, figJson]) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotContainer(this.outputArea);
                this.plots.set(key, state);
            }
            if (!state.canUpdate(updateId)) return;

            state.setUpdateId(updateId)
            state.render(figJson, updateId, this.is_plot_theme_dark)
        });
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

    public getXRanges(): string {
        const result: Record<string, [number, number] | null> = {};

        for (const [key, plot] of this.plots.entries()) {
            result[key] = plot.getXRange() ?? null;
        }

        const json = JSON.stringify(result).replace(/\bnull\b/g, "None");
        return json;
    }
}