from ._version import __version__ as __version__



def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "elephant-lab"
    }]