import { KernelMessage, Session } from '@jupyterlab/services';
import { OutputArea } from '@jupyterlab/outputarea';

export class TreeFrontend {
    private session: Session.ISessionConnection;
    private outputArea: OutputArea | null;

    constructor(session: Session.ISessionConnection, outputArea: OutputArea | null = null) {
        this.session = session;
        this.outputArea = outputArea;

        // Register the comm target to receive messages from Python
        this.session.kernel?.registerCommTarget(
            'tree_channel',
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
                console.warn('Unknown plot message type', data.type, data.message);
        }
    }
}