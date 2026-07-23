import { KernelMessage, Session } from '@jupyterlab/services';
import {
    Widget,
} from '@lumino/widgets';
import 'nouislider/dist/nouislider.css';
import { PlotContainer } from './plot_container';
import { KernelBridge } from './kernel_bridge';
import {
    PythonCodeKey,
} from './kernelcode';
import {
    IRenderMimeRegistry,
}
    from '@jupyterlab/rendermime';

export class PlotlyFrontend {
    private session: Session.ISessionConnection;
    private kernelBridge: KernelBridge;
    private rendermime: IRenderMimeRegistry;
    private plots: Map<string, PlotContainer> = new Map();
    private outputWiget: Widget | null;

    constructor(session: Session.ISessionConnection, kernelBridge: KernelBridge, rendermime: IRenderMimeRegistry, outputWiget: Widget | null = null) {
        this.session = session;
        this.kernelBridge = kernelBridge;
        this.rendermime = rendermime;
        this.outputWiget = outputWiget;

        // Register the comm target to receive messages from Python
        this.session.kernel?.registerCommTarget(
            'plot_channel',
            (comm, msg) => {
                comm.onMsg = async (msg) => await this.handleCommMessage(msg);
            }
        );

        let resizeTimeout: ReturnType<typeof setTimeout> | undefined;

        const resizePlots = () => {
            clearTimeout(resizeTimeout);

            resizeTimeout = setTimeout(() => {
                kernelBridge.executeCode(PythonCodeKey.ResizePlots);
            }, 200); // Wait 200ms after the last resize event
        };

        const resizeObserver = new ResizeObserver(resizePlots);
        resizeObserver.observe(outputWiget!.node);
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
                state = new PlotContainer(this.kernelBridge, this.rendermime, this.outputWiget);
                this.plots.set(key, state);
            }
            await state.startLoading(key)
        }));
    }
}