import {
	ICommandPalette, IClientSession
} from '@jupyterlab/apputils';
import {
	Widget
} from '@phosphor/widgets';
import {
	INotebookTracker, NotebookActions
} from '@jupyterlab/notebook';
import {
	JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';
import {
	KernelMessage, Kernel
} from '@jupyterlab/services';

import '../style/index.css';


/**
 * Initialization data for the neo_elephant extension.
 */
const extension: JupyterLabPlugin<void> = {
	id: 'neo_elephant',
	autoStart: true,
	requires: [ICommandPalette, INotebookTracker],
	activate: 
	(app: JupyterLab, palette: ICommandPalette, consoles: INotebookTracker) => {

		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
			if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
				console.log("Stdout: ", msg.content.text);
			}
		}

		consoles.widgetAdded.connect((sender, consolePanel) => {

			var session: IClientSession = consolePanel.session;
			console.log("Session.ready: ", session.ready);

			session.ready.then(() => {session.kernel.ready.then(() => {

				console.log("Kernel: ", session.kernel);

				NotebookActions.executed.connect(() => {

					console.log("Cell executed"); 

					let request: KernelMessage.IExecuteRequest = {
						code: "print('This was printed by the Python Kernel')",
						stop_on_error: false,
						store_history: false,
					};

					let future: Kernel.IFuture = session.kernel.requestExecute(request);

					future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) =>
						{ ioCallback( msg );});

				});

			});});
			
			console.log("Connected to currently active Notebook");
		
		});

		console.log('JupyterLab extension neo_elephant is activated!');
		console.log('ICommandPalette:', palette);
		let widget: Widget = new Widget();
		widget.id = 'neo_elephant';
		widget.title.label = 'Visualization';
		widget.title.closable = true;
		const command: string = 'neo:open';

		app.commands.addCommand(command, {
			label: 'Visualize neo and elephant',
			execute: () => {
				if (!widget.isAttached) {
					app.shell.addToMainArea(widget);
				}
				app.shell.activateById(widget.id);
			}
		});

		palette.addItem({command, category: 'Tutorial'});

	}
};

export default extension;
