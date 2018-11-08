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
			console.log("Got return from Kernel");
			console.log(msg);
			if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
				console.log("Stdout: ", msg.content);
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
				//let array = Object.getOwnPropertyNames(session);
				//console.log(array);

				session.kernel.registerCommTarget('test2', (comm:any, commMsg:any):any => {
					if(commMsg.content.target_name !== 'test2'){
						return;
					}
					comm.onMsg = (msg:any) => {
						var c = msg.buffers[0].buffer;
						c;
						console.log("Message received");
						//console.log(c[0]);
						//console.log("MEEESSSAAAGGEEE ", msg.buffers[0]);
						//console.log(new Float32Array(msg.buffers[0].buffer));
					};
					comm.onClose = (msg:any) => {};
				});

				// Initialize function that returns variable list
				let code: string;
				fetch('packages/python/test.py').then(response => {
					console.log("Reading code: ", response)
					return response.json();
				}).then(data => {
					code = data;
				});

				code = 
`import json
from IPython.core.magics.namespace import NamespaceMagics
from IPython import get_ipython
#from neo.core import BaseNeo
nsm = NamespaceMagics()
nsm.shell = get_ipython().kernel.shell

def testfunc():
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from neo.core.baseneo import BaseNeo
    from neo.core.block import Block
    vals = nsm.who_ls()
    values = [v for v in vals if isinstance(eval(v), (BaseNeo, list))] # in ['Block', 'Segment', 'ChannelIndex', 
    for value in list(values):
        val = eval(value)
        if isinstance(val, list):
            if len(val) > 0 and isinstance(val[0], BaseNeo):
                    pass
            else:
                values.remove(value)
        if isinstance(val, Block):
            for i, seg in enumerate(val.list_children_by_class("Segment")):
                #globals()[''.join(['blchidx', str(i)])] = chidx
                values.append(''.join([value, '.segmets[', str(i), ']']))
                for j, sig in enumerate(seg.analogsignals):
                    #pass
                    values.append(''.join([values[-1-j], '.analogsigs[', str(j), ']']))

    return json.dumps(values)`
				
				console.log('Python Code: ', code);
				let request_init: KernelMessage.IExecuteRequest = {
					code: code,
					stop_on_error: false,
					store_history: false,
				};
				session.kernel.requestExecute(request_init);

				// React to codecell execution, update variable list
				NotebookActions.executed.connect(() => {

					console.log("Cell executed"); 

					let request: KernelMessage.IExecuteRequest = {
						code: "print(testfunc())",
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
