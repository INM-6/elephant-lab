# jupyphant

A JupyterLab extension for visualizing Neo objects and Elephant results

Development install, assuming a fresh conda environment:

Required: npm, jupyter-lab (<2.0.0 currently, tested on 1.0.2), ipython, neo, viziphant, seaborn
Install compatible version of Jupyter Lab using:
```conda install -c conda-forge nodejs jupyterlab=1.0.2 jupyterlab_server=1.0.0```
Omit the version numbers to get the latest version for updating the dependencies

```conda install -c conda-forge python-neo seaborn matplotlib```

```pip install elephant```

Install viziphant (old version!) <br>

```git clone git@github.com:INM-6/viziphant.git```

```cd viziphant```

```pip install -e .```

Install ipywidgets

```conda install -c conda-forge ipywidgets```

```jupyter labextension install @jupyter-widgets/jupyterlab-manager```

For further information, see https://ipywidgets.readthedocs.io/en/stable/user_install.html

Install ipytree:
Python package:

```conda install -c conda-forge ipytree```

Jupyter-Lab extension

```jupyter labextension install ipytree```

```jupyter labextension install ipytree```

For further information, see https://github.com/QuantStack/ipytree


Install jupyphant itself:

```git clone git@github.com:INM-6/jupyphant.git```

```cd jupyphant```

```pip install -e .```

```jlpm install```

```jlpm run build```

```jupyter labextension install .```

For further information, see https://jupyterlab.readthedocs.io/en/stable/developer/extension_tutorial.html#extension-tutorial


Run Jupyterlab with

```jupyter lab --watch```

so current changes are reflected immediately upon reloading the JupyterLab tab.

Development:
For an update to the latest versions of JupyterLab, manually edit dependencies in package.json
For more information on this, see: https://docs.npmjs.com/cli/v6/configuring-npm/package-json

Python:
- `./jupyphant/` contains the Python code
- `setup.py` is the install script for the Python module

JupyterLab extension:
- `./src/` contains the TypeScript code
- `./style/` contains CSS
- `package.json` and `tsconfig.json` contain important configs for the extension

Additional notes for debugging:
- Outputs of Python Code are printed to the Web Console (Firefox: Ctrl+Shift+K), displayed as JSON objects.<br>
=> "message type: error" contains errors in execution of Python code<br>
=> "messsage_type: output" contains information printed in the Python code
- Errors in activating the extension are displayed there by default as well
- console.log() in the TypeScript code is a very helpful tool


Usage:
In the commands menu on the left, a new headline "Neuroscience" appears and below it the command "Jupyphant".
Clicking on "Jupyphant" opens a new tab within JupyterLab that is connected to the currently opened Notebook.
It will immediately start displaying the neo object tree and 
