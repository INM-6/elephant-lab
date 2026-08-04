import { ISessionContext } from '@jupyterlab/apputils';
import { KernelMessage } from '@jupyterlab/services';

// Python Code to execute in the kernel
import {
    PythonCodeKey,
    getPythonCode
} from './kernelcode';

import {
    OutputArea
} from '@jupyterlab/outputarea';

export interface IExecutionResult {
    resultKey: string | null;
    outputs: any[];
}

export class KernelBridge {
    private session: ISessionContext;

    constructor(session: ISessionContext) {
        this.session = session;
    }

    public async getNeoIOClass(filename: string): Promise<string | null> {
        if (!this.session || !this.session.session) { return null; }
        const code = getPythonCode(PythonCodeKey.GetIOClass, filename);
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
     * This method is decoupled from the UI.
     * @param pythonCodeKey The Python code key for the code.
     * @param outputArea The Jupyter OutputArea widget where the execution results will be displayed. If null, the output will be logged.
     * @param showOutput A boolean flag that determines whether to display the output. Defaults to `true`.
     * @param executeCode If true, execute the code as is. If false, wrap it in a print statement.
     * @returns A promise that resolves to an IExecutionResult object, containing the result key
     * and an array of output messages. Returns null if the session is not available.
     */
    public async executeCode(pythonCode: PythonCodeKey | string, outputArea: OutputArea | null = null, showOutput = true, executeCode = true, session: ISessionContext | null = null): Promise<IExecutionResult | null> {
        if (!session) {
            session = this.session;
        }
        if (!session || !session.session) {
            return null;
        }
        const kernel = session.session?.kernel;
        if (!kernel) {
            console.error("Kernel not available for execution.");
            return null;
        }

        const code = Object.values(PythonCodeKey).includes(pythonCode as PythonCodeKey)
            ? getPythonCode(pythonCode as PythonCodeKey)
            : pythonCode;
        console.log("Executing code in kernel:", code);

        let codeToRun: string;
        if (executeCode) {
            codeToRun = "import gc as elephant_lab_gc; elephant_lab_gc.collect()\n" + code;
        }
        else {
            codeToRun = `print(${JSON.stringify(code)})`;
        }

        const future = session.session.kernel!.requestExecute({ code: codeToRun, store_history: false });

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
                        if (line.trim().startsWith("ELEPHANT_LAB_RESULT_KEY:")) {
                            if (resultKey === null) {
                                resultKey = "";
                            }
                            resultKey += line.trim().substring("ELEPHANT_LAB_RESULT_KEY:".length);
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

        let result: IExecutionResult = { resultKey: resultKey ? resultKey : null, outputs };

        if (result) {
            this.handleOutputs(result.outputs, outputArea, showOutput);
        }

        return result;
    }

    private handleOutputs(outputs: any[], outputArea: OutputArea | null, showOutput: boolean) {
        if (outputArea != null && showOutput) outputArea.model.clear();
        for (const output of outputs) {
            if (output.output_type === 'clear_output') {
                if (outputArea != null && showOutput) {
                    outputArea.model.clear(false);
                }
            } else if ((output.output_type === 'stream' && output.name === 'stderr') || output.output_type === 'error') {
                console.error("Error output from kernel:", output);
            } else {
                if (showOutput) {
                    if (outputArea == null) {
                        console.log("Output from kernel:", output);
                    }
                    else {
                        outputArea.model.add(output);
                    }
                }
            }
        }
    }
}
