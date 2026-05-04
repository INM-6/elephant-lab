from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("elephant-lab")
except PackageNotFoundError:
    __version__ = "unknown"



def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "elephant-lab"
    }]