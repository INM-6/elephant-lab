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

import { DraggableItem } from './elephant_lab_node';

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
     * Fetches details for a fully qualified Python object name (e.g., 'elephant.statistics.isi').
     * It executes Python's `inspect` module in the kernel to determine if the object is a
     * class or function and to get its parameters.
     *
     * Restored from the pre-rewrite workflow engine; still targets the legacy
     * `elephant_lab_entity`/`jupyphant.kernelcode` backend names, so it will not resolve
     * against the current `elephant_lab` backend until those references are updated.
     * @param fqn The fully qualified name of the Python object.
     * @returns A promise that resolves to a DraggableItem object, or null if inspection fails.
     */
    public async getDetailsForName(fqn: string): Promise<DraggableItem | null> {
        if (!this.session || !this.session.session) { return null; }
        const code = `
        import inspect, json, sys
        def _get_params_for_obj(obj):
            param_list_for_json = []
            try:
                if inspect.isclass(obj):
                    sig = inspect.signature(obj.__init__)
                    params = list(sig.parameters.values())[1:]
                else:
                    sig = inspect.signature(obj)
                    params = sig.parameters.values()
            except (ValueError, TypeError):
                return []
            for param in params:
                if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                    default_val = param.default
                    if default_val is inspect.Parameter.empty:
                        default_val = "__REQUIRED__"
                    param_list_for_json.append({"name": param.name, "default": str(default_val)})
            return param_list_for_json
        try:
            fqn = "${fqn}"; parts = fqn.split('.')
            func_name = parts.pop()
            module_path = ".".join(parts)
            __import__(module_path)
            import sys
            module_obj = sys.modules[module_path]
            target_obj = getattr(module_obj, func_name)
            details = {"id": fqn, "name": fqn, "is_class": inspect.isclass(target_obj), "code": fqn, "parameters": _get_params_for_obj(target_obj)}
            print(json.dumps(details))
        except Exception as e:
            try: __import__(module_path)
            except Exception as e_import:
                print(f"Failed to import {module_path}: {e_import}", file=sys.stderr)
            print(f"Error inspecting {fqn}: {e}", file=sys.stderr); print(json.dumps(None))
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
        catch (e) { console.error("Failed to parse details from kernel:", e, msg_content); return null; }
    }

    /**
     * For a given class instance in the kernel, get all of its public methods.
     * This is used to populate the dropdown on class nodes in the workflow.
     * Restored from the legacy workflow engine; still references the old
     * `elephant_lab_entity`/`jupyphant.kernelcode` backend names.
     * @param target_id The identifier for the object in the kernel (e.g., 'result_123' or a fqn).
     * @returns A promise that resolves to an array of items representing the methods.
     */
    public async getMethodsFromTarget(target_id: string): Promise<any[] | null> {
        if (!this.session || !this.session.session) { return null; }

        const code = `
        import inspect, json, sys, pickle
        from jupyphant.kernelcode import get_neo_to_hash_dict

        # Examine parameters for a given Object
        def _get_params_for_obj(obj):
            param_list_for_json = []
            try:
                sig = inspect.signature(obj)
                params = sig.parameters.values()
            except (ValueError, TypeError):
                return []

            param_list_for_json.append({"name": "__self__", "default": "CONNECTION_REQUIRED"})

            for param in params:
                if param.name == 'self':
                    continue
                if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                    default_val = param.default
                    if default_val is inspect.Parameter.empty:
                        default_val = "__REQUIRED__"
                    param_list_for_json.append({"name": param.name, "default": str(default_val)})
            return param_list_for_json

        item_list = []
        target_id_str = "${target_id}"

        try:
            target_obj = None
            # result_*HASH* is the structure internally used to track objects / results
            # so they dont need to be parsed everytime the get passed
            if target_id_str.startswith("result_"):
                global workflow_results
                if 'workflow_results' in globals() and target_id_str in workflow_results:
                    target_obj = workflow_results[target_id_str]
                else:
                    print(f"Info: Workflow not run, cannot inspect result key {target_id_str}", file=sys.stderr)

            # Target is neo Object or Elephant Function / Class
            elif "." in target_id_str and (target_id_str.startswith("neo.") or target_id_str.startswith("elephant.")):
                parts = target_id_str.split('.')
                func_name = parts.pop()
                module_path = ".".join(parts)
                __import__(module_path)
                module_obj = sys.modules[module_path]
                target_obj = getattr(module_obj, func_name)

            # Target is a pickled string
            elif target_id_str.startswith("b'"):
                target_obj = pickle.loads(eval(target_id_str))
                if isinstance(target_obj, list):
                    target_obj = target_obj[0]

            else:
                # Try to get Object using Neo Hash
                global elephant_lab_entity
                neo_hash_obj_dict = get_neo_to_hash_dict(elephant_lab_entity)
                target_obj = neo_hash_obj_dict[target_id_str]

            if target_obj is not None:
                all_members = inspect.getmembers(target_obj)
                for name, member_obj in all_members:
                    # leave out private methods and the ones which are not callable
                    if not name.startswith("_") and callable(member_obj):
                        if inspect.isclass(member_obj):
                            continue

                        new_code = f"{target_id_str}.{name}"
                        item_list.append({
                            "id": f"{target_id_str}.{name}",
                            "name": f".{name}()",
                            "is_class": False,
                            "code": new_code,
                            "parameters": _get_params_for_obj(member_obj)
                        })

            print(json.dumps(item_list))

        except Exception as e:
            print(f"Error inspecting target {target_id_str}: {e}", file=sys.stderr)
            print(json.dumps([]))
        `;

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

    // Get all available elephant modules + functions using the Python kernel.
    // Restored from the legacy workflow engine.
    public async getElephantMembers(): Promise<{ [moduleName: string]: { name: string, is_class: boolean }[] } | null> {
        let code = `
        import inspect
        import pkgutil
        import json
        import elephant
        import importlib
        import sys

        elephant_module_func_dict = {}
        try:
            library = importlib.import_module("elephant")
            library_path = library.__path__
            for _, module_name, _ in pkgutil.iter_modules(library_path, prefix=library.__name__ + '.'):
                try:
                    module = importlib.import_module(module_name)
                    for name, func in (inspect.getmembers(module, inspect.isfunction) +
                                    inspect.getmembers(module, inspect.isclass)):
                        if func.__module__ == module_name:
                            if not func.__name__.startswith("_"):
                                is_class = inspect.isclass(func)
                                elephant_module_func_dict.setdefault(module_name, []).append(
                                    {"name": func.__name__, "is_class": is_class}
                                )
                except Exception as e:
                    print(f"An error occurred while processing {module_name}: {e}", file=sys.stderr)
            print(json.dumps(elephant_module_func_dict))
        except ImportError:
            print("Elephant not found!", file=sys.stderr)
        except Exception as e:
            print(f"An error occurred: {e}", file=sys.stderr)
        `
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

    // Extract Docstring of passed code. Restored from the legacy workflow engine;
    // still references the old `elephant_lab_entity`/`jupyphant.kernelcode` backend names.
    public async getDocstring(code: string): Promise<string | null> {
        if (!this.session || !this.session.session) { return null; }
        const pythonCode = `
        import inspect, json, sys, pprint
        from jupyphant.kernelcode import get_neo_to_hash_dict

        target_id_str = "${code}"

        # Manual docstrings for utility nodes
        util_docstrings = {
            'UTIL_LOOP': '### For Loop\\n\\nIterates over a list of items.\\n\\n**Inputs:**\\n- \`exec in\`: Execution input\\n- \`List\`: The list to iterate over\\n\\n**Outputs:**\\n- \`after loop\`: Execution output after the loop is finished\\n- \`loop body\`: Execution path for each iteration\\n- \`item\`: The current item in the iteration\\n- \`index\`: The index of the current item.',
            'UTIL_IF': '### If/Else\\n\\nExecutes one of two branches based on a condition.\\n\\n**Inputs:**\\n- \`exec in\`: Execution input\\n- \`condition\`: The boolean condition to evaluate.\\n\\n**Outputs:**\\n- \`if body\`: Execution path if the condition is true.\\n- \`else body\`: Execution path if the condition is false.\\n- \`after if/else\`: Execution output after either branch is finished.',
            'UTIL_PRINT': '### Print Node\\n\\nPrints the string representation of the input value.',
            'UTIL_LIST': '### List Node\\n\\nCreates a Python list from the inputs.',
            'NEO_READ_FILE': '### Neo File Reader\\n\\nReads a neo-supported file and provides the content as a neo object.',
            'UTIL_GETITEM': '### Get Item\\n\\nGets an item from an iterable at a specified index.',
            'NEO_GET_SPIKETRAINS': '### Get Spiketrains\\n\\nExtracts spiketrains from a neo object.',
            'NEO_GET_ANALOGSIGNALS': '### Get Analogsignals\\n\\nExtracts analogsignals from a neo object.',
            'NEO_GET_EVENTS': '### Get Events\\n\\nExtracts events from a neo object.',
            'NEO_GET_EPOCHS': '### Get Epochs\\n\\nExtracts epochs from a neo object.',
            'NEO_GET_SEGMENTS': '### Get Segments\\n\\nExtracts segments from a neo object.'
        }

        util_docstrings['__UTIL_LOOP__'] = util_docstrings['UTIL_LOOP']
        util_docstrings['__UTIL_IF__'] = util_docstrings['UTIL_IF']
        util_docstrings['__UTIL_LIST__'] = util_docstrings['UTIL_LIST']
        util_docstrings['__UTIL_PRINT__'] = util_docstrings['UTIL_PRINT']
        util_docstrings['__NEO_READ_FILE__'] = util_docstrings['NEO_READ_FILE']
        util_docstrings['__UTIL_GETITEM__'] = util_docstrings['UTIL_GETITEM']
        util_docstrings['__NEO_GET_SPIKETRAINS__'] = util_docstrings['NEO_GET_SPIKETRAINS']
        util_docstrings['__NEO_GET_ANALOGSIGNALS__'] = util_docstrings['NEO_GET_ANALOGSIGNALS']
        util_docstrings['__NEO_GET_EVENTS__'] = util_docstrings['NEO_GET_EVENTS']
        util_docstrings['__NEO_GET_EPOCHS__'] = util_docstrings['NEO_GET_EPOCHS']
        util_docstrings['__NEO_GET_SEGMENTS__'] = util_docstrings['NEO_GET_SEGMENTS']

        if target_id_str in util_docstrings:
            print(json.dumps(util_docstrings[target_id_str]))
        else:
            target_obj = None
            md_output = []

            try:
                if target_id_str.startswith("result_"):
                    global workflow_results
                    if 'workflow_results' in globals() and target_id_str in workflow_results:
                        target_obj = workflow_results[target_id_str]
                    else:
                        md_output.append(f"Info: Workflow not run, cannot inspect result key {target_id_str}")

                elif "." in target_id_str:
                    try:
                        parts = target_id_str.split('.')
                        func_name = parts.pop()
                        module_path = ".".join(parts)
                        __import__(module_path)
                        module_obj = sys.modules[module_path]
                        target_obj = getattr(module_obj, func_name)
                    except (ImportError, AttributeError):
                        pass

                if target_obj is None:
                    try:
                        target_obj = eval(target_id_str)
                    except Exception:
                        pass

                if target_obj is None:
                    try:
                        global elephant_lab_entity
                        if 'elephant_lab_entity' in globals():
                            neo_hash_obj_dict = get_neo_to_hash_dict(elephant_lab_entity)

                            if target_id_str in jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash:
                                sha1_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[target_id_str]
                                if sha1_hash in neo_hash_obj_dict:
                                    target_obj = neo_hash_obj_dict[sha1_hash]
                            elif target_id_str in neo_hash_obj_dict:
                                target_obj = neo_hash_obj_dict[target_id_str]

                    except Exception as e:
                        md_output.append(f"*Error during neo hash lookup: {e}*")

                if target_obj is None:
                     md_output.append(f"Could not find object '**{target_id_str}**'")

                if target_obj is not None:
                    try:
                        representation = pprint.pformat(target_obj)
                        md_output.append("#### Representation:")
                        md_output.append(f"\`\`\`python\\n{representation}\\n\`\`\`")
                    except Exception as e:
                        md_output.append(f"*Could not get representation: {e}*")

                    docstring = inspect.getdoc(target_obj)
                    if docstring:
                        md_output.append("---")
                        md_output.append("#### Docstring:")
                        md_output.append(docstring)
                    else:
                        md_output.append("*No docstring found.*")

                final_md = "\\n\\n".join(md_output)
                print(json.dumps(final_md if final_md else None))

            except Exception as e:
                print(json.dumps(f"An error occurred: {e}"))
        `;
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
