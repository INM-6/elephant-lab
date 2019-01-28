import {
	ICommandPalette, IClientSession, InstanceTracker
} from '@jupyterlab/apputils';
import {
	 Panel, Widget
} from '@phosphor/widgets';
import {
  JSONExt
} from '@phosphor/coreutils';
import {
	INotebookTracker, NotebookActions
} from '@jupyterlab/notebook';
import {
	JupyterLab, JupyterLabPlugin, ILayoutRestorer
} from '@jupyterlab/application';
import {
	KernelMessage, Kernel
} from '@jupyterlab/services';

// Note: SimplifiedOutputArea seems to simply behave like 
// the regular OutputAreas inside the notebook
// Currently trying to use regular OutputAreas
// because they *might* have more features
// In caseof problems, use Simplified
import {
	OutputArea, OutputAreaModel
} from '@jupyterlab/outputarea';

import {
	IRenderMimeRegistry
} from '@jupyterlab/rendermime';

import {
	pythonCode
} from './kernelcode';

import '../style/index.css';

/**
 * Initialization data for the neo_elephant extension.
 */
const extension: JupyterLabPlugin<void> = {
	id: 'neo_elephant',
	autoStart: true,
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer],
	activate: 
	(lab_: JupyterLab, palette_: ICommandPalette, consoles_: INotebookTracker, rendermime_, restorer_: ILayoutRestorer) => {	
		console.log('JupyterLab extension neo_elephant is activated!');

		
		const lab: JupyterLab = lab_;
		const palette: ICommandPalette = palette_;
		const consoles: INotebookTracker = consoles_;
		const rendermime: IRenderMimeRegistry = rendermime_;
		const restorer: ILayoutRestorer = restorer_;

		
		// Adds an OutputArea to the tab 'widget'
		function createOutput(session: IClientSession, tab: Panel, cls: string[], id: string, code: string): OutputArea{
			// OutputArea
			let model = new OutputAreaModel({trusted: true});
			let outarea = new OutputArea({rendermime, model});
			console.log(outarea);
			tab.addWidget(outarea);
			OutputArea.execute(code, outarea, session);
			outarea.id = id;
			for(let currCls of cls){
				outarea.addClass(currCls);
			}
			return outarea;
		}

		function addTextToPanel(widget: Panel, text: string){
			// Adding content to my tab
			let new_content = document.createElement('div');
			let textField = document.createTextNode(text);
			new_content.appendChild(textField);
			widget.node.appendChild(new_content);
		}

		function initializeTab(){
			let widget: Panel = new Panel();
			widget.id = 'neo_elephant';
			widget.title.label = 'Visualization';
			widget.title.closable = true;
			let var_place = document.createElement('div');
			var_place.setAttribute("id", "neo_ele_vars");
			widget.node.appendChild(var_place);
			return widget;
		}

		function attachTab(widget: Panel, tracker: InstanceTracker<Widget>){
			// Attach tab if not yet attached
			if (!widget.isAttached) {
				lab.shell.addToRightArea(widget);
			}
			if (!tracker.has(widget)) {
				// Track the state of the widget for later restoration
				tracker.add(widget);
			}
			lab.shell.activateById(widget.id);
		}

		function createCommand(command: string, widget: Panel, tracker: InstanceTracker<Widget>){
			lab.commands.addCommand(command, {
				label: 'Visualize neo and elephant',
				execute: () => {
					attachTab(widget, tracker)
				}
			});
			palette.addItem({command, category: 'Tutorial'});
		}

		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
			console.log("Got return from Kernel");
			console.log(msg);
			if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
				console.log("Stdout: ", msg.content);
				let text = document.createTextNode(msg.content.text as string);
				let var_place = document.getElementById('neo_ele_vars');
				let old_text = var_place.childNodes[0];
				if(old_text != null){
					var_place.removeChild(old_text);
				}
				var_place.appendChild(text);
			}
		}

		function registerComm(name: string, session: IClientSession){
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
		}

		function executeCode(code: string, session: IClientSession, callback?: any){
			let request: KernelMessage.IExecuteRequest = {
				code: code,
				stop_on_error: false,
				store_history: false,
			};

			let future: Kernel.IFuture = session.kernel.requestExecute(request);

			if(callback){
				future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) => {
					callback( msg );
				});
			}
		}
	
		/********************************************************************************************************************************/
		// Initialize new Tab in which everything will be displayed
		// Will be moved to Tab constructor
		let tab = initializeTab();

		// Dummy code, might be needed to initialize in the beginning
		lab.restored.then((layout) => {
			//let newtab = initializeTab();
		});
		// Register event to react on new tab
		consoles.widgetAdded.connect((sender, consolePanel) => {

			// Show tab if it was not yet shown
			attachTab(tab, tracker);

			var session: IClientSession = consolePanel.session;
			console.log("Session.ready: ", session.ready);

			// If session is available in the notebook
			// And kernel is ready as well
			session.ready.then(() => {session.kernel.ready.then(() => {

				// Register a Comm channel (not needed currently, but might be)
				registerComm('test2', session);

				// Create 2 OutputAreas that will show plots
				let outarea = createOutput(session, tab, ['my-outarea-classs'], 'jup_vis_out_id1', pythonCode['plotCode']);
				let outarea2 = createOutput(session, tab, ['my-outarea-classs'], 'jup_vis_out_id2', pythonCode['neoPlot']);

	
				// Execute code in kernel
				executeCode(pythonCode['testfunc'], session);

				// React to codecell execution, update variable list
				NotebookActions.executed.connect(() => {

					console.log("Cell executed"); 

					// Plot analogsignal (test)
					OutputArea.execute(pythonCode['neoPlot'], outarea, session);
					OutputArea.execute(pythonCode['plotCode'], outarea2, session);

					// Update list of variables
					executeCode('print(testfunc())', session, ioCallback);
				});

			});});
			
			console.log("Connected to currently active Notebook");
		
		});
		
		// Add some random text, nothing useful here
		addTextToPanel(tab, 'This is a text');

		// Place command into CommandPalette
		// This command will open the tab			let widget = initializeTab(lab);
		let command = 'neo:open';
		
		let tracker = new InstanceTracker<Widget>({ namespace: 'neo_jup_vis' });
  		restorer.restore(tracker, {
    	command,
    	args: () => JSONExt.emptyObject,
    	name: () => 'neo_jup_vis'
		});

		createCommand(command, tab, tracker);
	}
};

// This is code that is not yet in use
// But can be used as template in case anything needs to be fetched
// @ts-ignore
function fetchText(){
	fetch('packages/python/test.py').then(response => {
		console.log("Reading code: ", response);
		return response.json();
	}).then(data => {
		return data;
	});
}
export default extension;
