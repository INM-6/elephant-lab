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
			
		console.log('JupyterLab extension neo_elephant is activated!');
		let widget: Widget = new Widget();
		widget.id = 'neo_elephant';
		widget.title.label = 'Visualization';
		widget.title.closable = true;
		let var_place = document.createElement('div');
		var_place.setAttribute("id", "neo_ele_vars");
		widget.node.appendChild(var_place);


		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
			if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
				console.log("Stdout: ", msg.content.text);
				let text = document.createTextNode(msg.content.text as string);
				let old_text = var_place.childNodes[0];
				if(old_text != null){
					var_place.removeChild(old_text);
				}
				var_place.appendChild(text);
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

		// Adding content to my tab
		let new_content = document.createElement('div');
		let text = document.createTextNode("This a text.");
		new_content.appendChild(text);
		widget.node.appendChild(new_content);

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

//function add_text(text: string, parent_elem: any){
	//let new_content = document.createElement('div');
//}

export default extension;
