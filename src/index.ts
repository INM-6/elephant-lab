import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

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
