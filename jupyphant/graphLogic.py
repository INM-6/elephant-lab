import inspect, sys, json

def getDetailsForName(fqn : str):
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
        parts = fqn.split('.')
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
        print(f"Error inspecting {fqn}: {e}", file=sys.stderr)

def getMethodsFromTarget(target_id_str : str):
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
    
    try:
        target_obj = None
        # result_*HASH* is the structure internally used to track objects / results
        # so they dont need to be parsed everytime the get passed
        from IPython import get_ipython
        user_ns = get_ipython().user_ns
        if target_id_str.startswith("result_"):
            workflow_results = user_ns.get('workflow_results', None)
            if workflow_results is not None and target_id_str in workflow_results:
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
            jupyphant_entity = user_ns.get('jupyphant_entity', None)
            neo_hash_obj_dict = get_neo_to_hash_dict(jupyphant_entity)
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

def generatePythonCodeForNodeStartWithB(item_code, item_name : str, resultId: str, results):
    try:
        import pickle
        data = pickle.loads(item_code)
        result = data[0]
        results[resultId] = result
        print(f"JUPYPHANT_RESULT_KEY:{resultId}") 
    except Exception as e:
        print(f"Error loading instance {item_name}: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilList(args_json_string, resultId: str, results):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            if isinstance(arg_str, str):
                if arg_str in results: return results[arg_str]
                if arg_str == "" or arg_str == "__REQUIRED__": return None
                try: return eval(arg_str)
                except: return arg_str
            return arg_str

    try:
        raw_args = json.loads(args_json_string)
        processed_args = [_prepare_arg(arg) for arg in raw_args]
        final_list = [arg for arg in processed_args if arg is not None]
        
        results[resultId] = final_list
        print(f"JUPYPHANT_RESULT_KEY:{resultId}") 

    except Exception as e:
        print(f"Error creating list: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilInteger(args_json_string, resultId: str, results):
    try:
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            if isinstance(arg_str, str):
                if arg_str in results: return results[arg_str]
                if arg_str == "" or arg_str == "__REQUIRED__": return None
                try: return eval(arg_str)
                except: return arg_str
            return arg_str
    try:
        raw_args = json.loads(args_json_string)
        processed_args = [_prepare_arg(arg) for arg in raw_args]
        integer_value = int(processed_args[0])
        results[resultId] = integer_value
        print(f"JUPYPHANT_RESULT_KEY:{resultId}")
    except Exception as e:
        print(f"Error in Integer node: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilPrint(args_json_string, resultId: str, results):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            if isinstance(arg_str, str):
                if arg_str in results: return results[arg_str]
                if arg_str == "" or arg_str == "__REQUIRED__": return None
                try: return eval(arg_str)
                except: return arg_str
            return arg_str
    try:
        raw_args = json.loads(args_json_string)
        processed_args = [_prepare_arg(arg) for arg in raw_args]
        printed_results = [arg for arg in processed_args if arg is not None]
        for res in printed_results:
            print(res)
        results[resultId] = printed_results
        print(f"JUPYPHANT_RESULT_KEY:{resultId}")
    except Exception as e:
        print(f"Error in Print node: {e}", file=sys.stderr)

def generatePythonCodeForNodeStartWithDot(method_name, args_json_string, item_name : str, resultId: str, results):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            if isinstance(arg_str, str):
                if arg_str in results: return results[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            try: return eval(arg_str)
            except: return arg_str

    try:
        target_obj = None
        raw_args = json.loads(args_json_string)
        self_id = raw_args[0] if len(raw_args) > 0 else None

        target_obj = _prepare_arg(self_id)

        if target_obj is None:
                raise ValueError(f"Method '{method_name}' called without a connected object instance.")

        method_to_run = getattr(target_obj, method_name)

        method_args = raw_args[1:]
        processed_args = [_prepare_arg(arg) for arg in method_args]

        result = method_to_run(*processed_args)
            
        results[resultId] = result
        print(f"JUPYPHANT_RESULT_KEY:{resultId}") 

    except Exception as e:
        print(f"Error running method {item_name}: {e}", file=sys.stderr)

def generatePythonCodeForNodeIncludesDot(modulePath: str, results, functionName: str, resultId: str, item_name: str, args_json_string, paramNamesJson):
    import elephant.statistics, neo
    import quantities as pq
    import numpy as np

    try:
        __import__(modulePath)
        module_obj = sys.modules[modulePath]
    except ImportError:
        print(f"Error: Could not import module ${modulePath}", file=sys.stderr)
        module_obj = None

    def _prepare_arg(arg_str):
        if isinstance(arg_str, str):
            if arg_str in results:
                return results[arg_str]
        if arg_str == "" or arg_str == "__REQUIRED__":
            return None
        try:
            return eval(arg_str)
        except:
            return arg_str

    try:
        if module_obj:
            method_to_run = getattr(module_obj, functionName)
            raw_args = json.loads(args_json_string)
            param_names = json.loads(paramNamesJson)
            processed_args = [_prepare_arg(arg) for arg in raw_args]

            kwargs = dict(zip(param_names, processed_args))

            if functionName == "SpikeTrain" and isinstance(kwargs.get('times'), list):
                kwargs['times'] = np.array(kwargs['times'], dtype=np.float64)

            result = method_to_run(**kwargs)

            results[resultId] = result
            print(f"JUPYPHANT_RESULT_KEY:{resultId}") 
        else:
            print(f"Error: Module {modulePath} not loaded.", file=sys.stderr)
    except Exception as e:
        print(f"Error running {item_name} (name): {e}", file=sys.stderr)

def generatePythonCodeForNodeOther(varName: str, results, resultId: str):
    try:
        node_id = varName
        from IPython import get_ipython
        user_ns = get_ipython().user_ns
        jupyphant_entity = user_ns.get('jupyphant_entity', None)
        if node_id in jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash:
            neo_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash[node_id]
            result = jupyphant_entity.map_neo_obj_hash_to_neo_obj[neo_hash]
        elif node_id in user_ns:
            result = user_ns[node_id]
        else:
            result = None
            print(f"Error: Variable or node id '{varName}' not found.", file=sys.stderr)
        
        if result is not None:
            results[resultId] = result
            print(f"JUPYPHANT_RESULT_KEY:{resultId}")
    except Exception as e:
        print(f"Error getting object for variable {varName}: {e}", file=sys.stderr)

def getDocstring(fqn : str):
    import inspect, json, sys, pprint, html

    target_obj = None
    html_output = []

    try:
        parts = fqn.split('.')
        func_name = parts.pop()
        module_path = ".".join(parts)

        if module_path:
            try:
                __import__(module_path)
                module_obj = sys.modules[module_path]
                target_obj = getattr(module_obj, func_name, None)
            except ImportError:
                pass # Module not found, will try eval

        if target_obj is None:
            try:
                target_obj = eval(fqn)
            except Exception:
                safe_name = html.escape(fqn)
                html_output.append(f"<p>Could not find object '<b>{safe_name}</b>'</p>")

        if target_obj is not None:
            # Get pretty-printed representation first
            try:
                representation = pprint.pformat(target_obj)
                safe_rep = html.escape(representation)
                
                html_output.append("<h4>Representation:</h4>")
                html_output.append(
                    f"<pre style='background-color: var(--jp-layout-color2); padding: 8px; border-radius: 4px;'>{safe_rep}</pre>"
                )
            except Exception as e:
                html_output.append(f"<p><i>Could not get representation: {html.escape(str(e))}</i></p>")

            # Then get docstring
            docstring = inspect.getdoc(target_obj)
            if docstring:
                safe_doc = html.escape(docstring)
                html_output.append("<hr><h4>Docstring:</h4>")
                html_output.append(
                    f"<pre style='white-space: pre-wrap; font-family: var(--jp-code-font-family);'>{safe_doc}</pre>"
                )
            else:
                html_output.append("<p><i>No docstring found.</i></p>")
        
        final_html = "".join(html_output)
        print(json.dumps(final_html if final_html else None))

    except Exception as e:
        print(json.dumps(f"<p style='color:var(--jp-error-color)'>An error occurred: {html.escape(str(e))}</p>"))

def getElephantMembers():
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