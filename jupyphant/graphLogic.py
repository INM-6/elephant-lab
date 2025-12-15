import inspect, sys

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
        return details
    except Exception as e:
        try: __import__(module_path)
        except Exception as e_import: 
            print(f"Failed to import {module_path}: {e_import}", file=sys.stderr)
        print(f"Error inspecting {fqn}: {e}", file=sys.stderr)
        return None

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
            global jupyphant_entity 
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

def generatePythonCodeForNodeStartWithB(item_code, item_name : str, resultId: str, resultsDictName):
    try:
        data = pickle.loads(item_code)
        result = data[0]
        resultsDictName[resultId] = result
        print(f"JUPYPHANT_RESULT_KEY:${resultId}") 
    except Exception as e:
        print(f"Error loading instance ${item_name}: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilList(args_json_string, resultId: str, resultsDictName):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            global resultsDictName
            if isinstance(arg_str, str):
                if arg_str in resultsDictName: return resultsDictName[arg_str]
                if arg_str == "" or arg_str == "__REQUIRED__": return None
                try: return eval(arg_str)
                except: return arg_str
            return arg_str

    try:
        raw_args = json.loads(args_json_string)
        processed_args = [_prepare_arg(arg) for arg in raw_args]
        final_list = [arg for arg in processed_args if arg is not None]
        
        resultsDictName[resultId] = final_list
        print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

    except Exception as e:
        print(f"Error creating list: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilInteger(args_json_string, resultId: str, resultsDictName):
    try:
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            global resultsDictName
            if isinstance(arg_str, str):
                if arg_str in resultsDictName: return resultsDictName[arg_str]
                if arg_str == "" or arg_str == "__REQUIRED__": return None
                try: return eval(arg_str)
                except: return arg_str
            return arg_str
    try:
        raw_args = json.loads(args_json_string)
        processed_args = [_prepare_arg(arg) for arg in raw_args]
        integer_value = int(processed_args[0])
        resultsDictName[resultId] = integer_value
        print(f"JUPYPHANT_RESULT_KEY:${resultId}")
    except Exception as e:
        print(f"Error in Integer node: {e}", file=sys.stderr)

def generatePythonCodeForNodeUtilPrint(args_json_string, resultId: str, resultsDictName):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            global resultsDictName
            if isinstance(arg_str, str):
                if arg_str in resultsDictName: return resultsDictName[arg_str]
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
        resultsDictName[resultId] = printed_results
        print(f"JUPYPHANT_RESULT_KEY:${resultId}")
    except Exception as e:
        print(f"Error in Print node: {e}", file=sys.stderr)

def generatePythonCodeForNodeStartWithDot(method_name, args_json_string, item_name : str, resultId: str, resultsDictName):
    try: 
        _prepare_arg
    except NameError:
        def _prepare_arg(arg_str):
            global resultsDictName
            if isinstance(arg_str, str):
                if arg_str in resultsDictName: return resultsDictName[arg_str]
            if arg_str == "" or arg_str == "__REQUIRED__": return None
            try: return eval(arg_str)
            except: return arg_str
            return arg_str

    try:
        target_obj = None
        raw_args = json.loads(args_json_string)
        self_id = raw_args[0] if len(raw_args) > 0 else None

        target_obj = _prepare_arg(self_id)

        if target_obj is None:
                raise ValueError(f"Method '${method_name}' called without a connected object instance.")

        method_to_run = getattr(target_obj, method_name)

        method_args = raw_args[1:]
        processed_args = [_prepare_arg(arg) for arg in method_args]

        result = method_to_run(*processed_args)
            
        resultsDictName[resultId] = result
        print(f"JUPYPHANT_RESULT_KEY:${resultId}") 

    except Exception as e:
        print(f"Error running method ${item_name}: {e}", file=sys.stderr)