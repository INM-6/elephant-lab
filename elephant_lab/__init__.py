"""
Package entry point for elephant-lab.

Resolves the installed package version and registers the compiled JupyterLab
extension so JupyterLab can find and load it on startup.
"""

from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("elephant-lab")
except PackageNotFoundError:
    __version__ = "unknown"



def _jupyter_labextension_paths():
    """Tell JupyterLab where to find the built labextension assets."""
    return [{
        "src": "labextension",
        "dest": "elephant-lab"
    }]