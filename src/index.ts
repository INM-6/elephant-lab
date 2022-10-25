// Imports for Jupyter
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';
import {
	ICommandPalette,
	IClientSession,
	WidgetTracker
} from '@jupyterlab/apputils';
import {
	INotebookTracker,
	NotebookActions,
	NotebookPanel
} from '@jupyterlab/notebook';
import {
	KernelMessage
} from '@jupyterlab/services';

// Note: SimplifiedOutputArea seems to simply behave like
// the regular OutputAreas inside the notebook
// Currently trying to use regular OutputAreas
// because they *might* have more features
// In caseof problems, use Simplified
import {
	OutputArea,
	OutputAreaModel
} from '@jupyterlab/outputarea';

import {
	IRenderMimeRegistry
} from '@jupyterlab/rendermime';

// Lumino imports for dealing with the tabs within JupyterLab
// These are called Panels
import {
	 SplitPanel, Panel
} from '@lumino/widgets';
//@ts-ignore: TODO: Why is this necessary?
import {
  JSONExt
} from '@lumino/coreutils';

// Own imports
// Python Code to execute in the kernel
import {
	pythonCode
} from './kernelcode';
// Style from css
import '../style/index.css';


/**
 * Initialization data for the jupyphant extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyphant:plugin',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyphant is activated!');
  }
};

export default plugin;
