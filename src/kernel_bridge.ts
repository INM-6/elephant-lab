import { ISessionContext } from '@jupyterlab/apputils';
import { KernelMessage } from '@jupyterlab/services';
import { DraggableItem } from './jupyphant_node';

export interface IExecutionResult {
    resultKey: string | null;
    outputs: any[];
}

export class KernelBridge {
    private session: ISessionContext;

    constructor(session: ISessionContext) {
        this.session = session;
    }

    /*Method used to generate python code string that should be run on the Jupyter Kernel
    fqn: function that should be called (needs to exist in jupyphant.graphLogic)
    fqnParam: parameter that should be passed to the function (needs to displayed as a string)
    extra: additional code to be included in the generated Python code
    */
    private _generateCodeForFqn(fqn: string, fqnParam: string): string {
        return `
    from jupyphant.kernel_bridgeLogic import ${fqn}
    import json
    ${fqn}(${fqnParam})
    `;
    }

    /**
     * Fetches details for a fully qualified Python object name (e.g., 'elephant.statistics.isi').
     * It executes Python's `inspect` module in the kernel to determine if the object is a
     * class or function and to get its parameters.
     * @param fqn The fully qualified name of the Python object.
     * @returns A promise that resolves to a DraggableItem object, or null if inspection fails.
     */
    public async getDetailsForName(fqn: string): Promise<DraggableItem | null> {
        if (!this.session || !this.session.session) { return null; }
        const code = this._generateCodeForFqn("getDetailsForName", `"${fqn}"`);
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
        catch (e) { console.error("Failed to parse details from kernel:", e, msg_content); return null; }
    }


    /**
     * For a given class instance in the kernel, get all of its public methods.
     * This is used to populate the dropdown on class nodes in the workflow.
     * @param target_id The identifier for the object in the kernel (e.g., 'result_123' or a fqn).
     * @returns A promise that resolves to an array of items representing the methods.
     */
    public async getMethodsFromTarget(target_id: string): Promise<any[] | null> {
        if (!this.session || !this.session.session) { return null; }

        const code = this._generateCodeForFqn("getMethodsFromTarget", `"${target_id}"`);

        let msg_content: string = "";
        const future = this.session.session.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg) && msg.content.name === 'stdout') {
                msg_content += msg.content.text;
            } else if (KernelMessage.isStreamMsg(msg)) {
                console.warn("Kernel STDERR:", msg.content.text);
            }
        };
        await future.done;
        try {
            const items = JSON.parse(msg_content.trim());
            return items;
        }
        catch (e) {
            console.error("Failed to parse method list from kernel:", e, msg_content);
            return null;
        }
    }

    // Get all available elephant modules + functions using Python Kernel
    public async getElephantMembers(): Promise<{ [moduleName: string]: { name: string, is_class: boolean }[] } | null> {
        let code = this._generateCodeForFqn("getElephantMembers", "");
        let msg_content: string = "";
        if (!this.session || !this.session.session) { return null; }
        let future = this.session!.session!.kernel!.requestExecute({ code });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg) && msg.content.name === 'stdout') {
                msg_content += msg.content.text;
            } else if (KernelMessage.isStreamMsg(msg)) {
                console.warn("Kernel STDERR:", msg.content.text);
            }
        };
        await future.done;
        try {
            const result = JSON.parse(msg_content.trim());
            if (Object.keys(result).length === 0) {
                return null;
            }
            return result;
        }
        catch (e) {
            console.error("Failed to parse elephant members from kernel:", e, msg_content);
            return null;
        }
    }
    // Extract Docstring of passed code
    public async getDocstring(code: string): Promise<string | null> {
        if (!this.session || !this.session.session) { return null; }
        const pythonCode = this._generateCodeForFqn("getDocstring", `"${code}"`);
        let msg_content: string = "";
        let future = this.session.session.kernel!.requestExecute({ code: pythonCode });
        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
            if (KernelMessage.isStreamMsg(msg)) {
                if (msg.content.name === 'stdout') { msg_content += msg.content.text; }
                else { console.warn("Kernel STDERR:", msg.content.text); }
            }
        };
        await future.done;
        try { return JSON.parse(msg_content.trim()); }
        catch (e) { console.error("Failed to parse docstring from kernel:", e, msg_content); return null; }
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
        let codeToRun: string;
        if (executeCode) {
            codeToRun = code;
        }
        else {
            codeToRun = `print(${JSON.stringify(code)})`;
        }
        if (!this.session || !this.session.session) {
            return null;
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