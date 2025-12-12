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
