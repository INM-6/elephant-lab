import sys, json

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