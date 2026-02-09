![Jupyphant Logo](./doc/Jupyphant-Logo.png)

# jupyphant

[![Github Actions Status](https://github.com/ojoenlanuca/jupyphant/workflows/Build/badge.svg)](https://github.com/ojoenlanuca/jupyphant/actions/workflows/build.yml)[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/ojoenlanuca/jupyphant/main?urlpath=lab)
A JupyterLab extension for interactive exploration, analysis and visualization of electrophysiological data.

## Requirements

- JupyterLab >= 4.0

## User Installation
**Note** jupyphant is yet not published on pypi, so please use the development install described below.
### Install

To install the extension, execute:

```bash
pip install jupyphant
```

### Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyphant
```

## Contributing

### Development install

Note: **You will need NodeJS to build the extension package.**
**Please follow the official installation guide https://nodejs.org/en/download**

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash

# Make sure NodeJS is installed. You can check your version with node -v

# 1. Clone the repo to your local environment, e.g. with
git clone git@github.com:INM-6/jupyphant.git

# 2. Change directory to the jupyphant directory
cd jupyphant

# 3. Create virtual environment with your preferred virtual environment
python3 -m venv .venv

# 4. Activate the newly created environment, e.g. with
source .venv/bin/activate

# 5. Install package in development mode
pip install -e .

# 6. Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite

# 7. Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab  --watch --ServerApp.iopub_msg_rate_limit=1.0e7
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
pip uninstall jupyphant
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `jupyphant` within that folder.

### Testing the extension

#### Frontend tests

This extension is using [Jest](https://jestjs.io/) for JavaScript code testing.

To execute them, execute:

```sh
jlpm
jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro/) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)
