import { ISessionContext } from '@jupyterlab/apputils';
import { KernelMessage } from '@jupyterlab/services';

export interface IExecutionResult {
    resultKey: string | null;
    outputs: any[];
}

export type DraggableItem = {
    id: string;
    name: string;
    code: string;
    is_class: boolean;
    parameters: { name: string, default: string }[];
    type?: string;
    variable_name?: string;
};

export class KernelBridge {
    private session: ISessionContext;

    constructor(session: ISessionContext) {
        this.session = session;
    }

    public async getNeoIOClass(filename: string): Promise<string | null> {
        if (!this.session || !this.session.session) { return null; }
        const code = `
import neo, json, sys
try:
    io = neo.get_io("${filename}")
    print(json.dumps(io.__class__.__name__))
except Exception as e:
    print(f"Error getting IO for {filename}: {e}", file=sys.stderr)
    print(json.dumps(null))
        `;
        let msg_content: string = "";
        const future = this.session.session.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') { msg_content += msg.content.text; }
                else { console.warn("Kernel STDERR:", msg.content.text); }
            }
        };
        await future.done;
        try { return JSON.parse(msg_content.trim()); }
        catch (e) { console.error("Failed to parse io class from kernel:", e, msg_content); return null; }
    }

    /**
     * Executes Python code in the kernel and returns the result and any output.
     * This method is decoupled from the UI and does not directly interact with OutputArea.
     * @param code The Python code to execute.
     * @param executeCode If true, execute the code as is. If false, wrap it in a print statement.
     * @returns A promise that resolves to an IExecutionResult object, containing the result key
     * and an array of output messages. Returns null if the session is not available.
     */
    public async executeCode(code: string, executeCode = false): Promise<IExecutionResult | null> {
        if (!this.session || !this.session.session) {
            return null;
        }
        let codeToRun: string;
        if (executeCode) {
            codeToRun = "import gc; gc.collect()\n" + code;
        }
        else {
            codeToRun = `print(${JSON.stringify(code)})`;
        }

        const future = this.session.session.kernel!.requestExecute({ code: codeToRun, store_history: false });

        let resultKey: string | null = null;
        const outputs: any[] = [];

        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            const msg_type = msg.header.msg_type;
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') {
                    const text = msg.content.text;
                    const lines = text.split('\n');
                    const lines_to_print: string[] = [];
                    for (const line of lines) {
                        if (line.trim().startsWith("JUPYPHANT_RESULT_KEY:")) {
                            if (resultKey === null) {
                                resultKey = "";
                            }
                            resultKey += line.trim().substring("JUPYPHANT_RESULT_KEY:".length);
                        } else {
                            lines_to_print.push(line);
                        }
                    }
                    if (lines_to_print.length > 0) {
                        const new_text = lines_to_print.join('\n');
                        if (new_text.trim().length > 0) {
                            const output: any = { ...msg.content, text: new_text, output_type: msg_type };
                            outputs.push(output);
                        }
                    }
                } else if (msg.content.name === 'stderr') {
                    console.warn("Kernel STDERR:", msg.content.text);
                    const output: any = { ...msg.content, output_type: msg_type };
                    outputs.push(output);
                }
            } else if (msg_type === 'display_data' || msg_type === 'execute_result' || msg_type === 'error') {
                const output: any = { ...msg.content, output_type: msg_type };
                outputs.push(output);
            } else if (msg_type === 'clear_output') {
                outputs.push({ output_type: 'clear_output' });
            }
        };

        await future.done;

        return { resultKey: resultKey ? resultKey : null, outputs };
    }
}
