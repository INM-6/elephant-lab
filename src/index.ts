import {
	ICommandPalette, IClientSession, WidgetTracker
} from '@jupyterlab/apputils';
import {
	 SplitPanel, Panel
} from '@phosphor/widgets';
//@ts-ignore
import {
  JSONExt
} from '@phosphor/coreutils';
import {
	INotebookTracker, NotebookActions, NotebookPanel
} from '@jupyterlab/notebook';
import {
	JupyterFrontEnd, JupyterFrontEndPlugin, ILayoutRestorer
} from '@jupyterlab/application';
import {
	KernelMessage
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
const extension: JupyterFrontEndPlugin<void> = {
	id: 'neo_elephant',
	autoStart: true,
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer],
	activate:
	(lab_: JupyterFrontEnd, palette_: ICommandPalette, consoles_: INotebookTracker, rendermime_, restorer_: ILayoutRestorer) => {	
		console.log('JupyterLab extension neo_elephant is activated!');

		const lab: JupyterFrontEnd = lab_;
		const palette: ICommandPalette = palette_;
		//@ts-ignore
		const consoles: INotebookTracker = consoles_;
		//@ts-ignore
		const rendermime: IRenderMimeRegistry = rendermime_;
		//@ts-ignore
		const restorer: ILayoutRestorer = restorer_;
		var myPanels: NotebookPanel[] = [];
		var myVisTabs: Panel[] = [];
		
		// Place command into CommandPalette
		// This command will open the tab			let widget = initializeTab(lab);
		let command = 'neo:open';

		createCommand(command);

		// Track and restore my tabs, needs to work together with restoration of main area
		// When Main Area is restored, I need to get all available Notebooks and Consoles
		// and then check all of them and connect each tab to the right one
		let tracker = new WidgetTracker<Panel>({ namespace: 'neo_jup_vis' });
  	restorer.restore(tracker, {
			command,
			//args: () => JSONExt.emptyObject,
			name: () => 'neo_jup_vis'
		});

		
		// Adds an OutputArea to the tab 'widget'
		function createOutput(session: IClientSession, rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string, code: string): OutputArea{
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
		//@ts-ignore
		function addTextToPanel(widget: Panel, text: string){
			// Adding content to my tab
			let new_content = document.createElement('div');
			let textField = document.createTextNode(text);
			new_content.appendChild(textField);
			widget.node.appendChild(new_content);
		}

		function initializeTab(){
			let widget: Panel = new SplitPanel({orientation: 'vertical'});
			widget.id = 'neo_elephant';
			widget.title.label = 'Visualization';
			widget.title.closable = true;
			let var_place = document.createElement('div');
			var_place.setAttribute("id", "neo_ele_vars");
			widget.node.appendChild(var_place);
			return widget;
		}

		function attachTab(tab: Panel, tracker: WidgetTracker<Panel>){
			// Attach tab if not yet attached
			if (!tab.isAttached) {
				lab.shell.add(tab);
			}
			if (!tracker.has(tab)) {
				// Track the state of the widget for later restoration
				tracker.add(tab);
			}
			lab.shell.activateById(tab.id);
		}

		function createCommand(command: string){
			lab.commands.addCommand(command, {
				label: 'Jupyphant',
				execute: () => {
					newTab();
				}
			});
			palette.addItem({command, category: 'NeuroScience'});
		}
		//@ts-ignore
		//		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
		//	console.log("Got return from Kernel");
		//	console.log(msg);
		//	if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
		//		console.log("Stdout: ", msg.content);
		//		let text = document.createTextNode(msg.content.text as string);
		//		let var_place = document.getElementById('neo_ele_vars');
		//		let old_text = var_place.childNodes[0];
		//		if(old_text != null){
		//			var_place.removeChild(old_text);
		//		}
		//		var_place.appendChild(text);
		//	}
		//}

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
		//@ts-ignore
		function executeCode(code: string, session: IClientSession, callback?: any){
			let request: KernelMessage.IExecuteRequestMsg['content'] = {
				code: code,
				stop_on_error: false,
				store_history: false,
			};

			let future = session.kernel.requestExecute(request);
			if(callback){
				future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) => {
					callback( msg );
				});
			}
		}
	
		/********************************************************************************************************************************/

		// Dummy code, might be needed to initialize in the beginning
		lab.restored.then((layout) => {
			//let newtab = initializeTab();
		});

		// Function to react on command to visualize
		// Called only after the command is clicked from CommandPalette
		function newTab() {
			// lab.shell.currentWidget is too general, now reducing down to NotebookPanels from NotebookTracker
			var newPanel: NotebookPanel = consoles.currentWidget;

			consoles.restored.then(()=>{
			newPanel = consoles.currentWidget;

			let index = myPanels.indexOf(newPanel);
			if(index != -1){
				attachTab(myVisTabs[index], tracker);
				return;
			}
			// Initialize new Tab in which everything will be displayed
			// Will be moved to Tab constructor
			let tab = initializeTab();
			// These are known now (TODO: Need to make this a dict, not use same index!!!)
			myVisTabs.push(tab);
			myPanels.push(newPanel);
			// Show tab if it was not yet shown
			attachTab(tab, tracker);


			var session: IClientSession = newPanel.session;
			console.log("Session.ready: ", session.ready);

			// If session is available in the notebook
			// And kernel is ready as well
			session.ready.then(() => {session.kernel.ready.then(() => {

				// Register a Comm channel (not needed currently, but might be)
				registerComm('test2', session);
				
				// Setup kernel to fulfill my requests
				executeCode(pythonCode['setupEnv'], session, console.log);
				console.log(pythonCode['setupEnv']);
				// Divide Tab in part for TreeView and part for Plots
				tab.addWidget(new Panel());
				tab.addWidget(new Panel());
				tab.widgets[0].node.style.cssText = tab.widgets[0].node.style.cssText + ' overflow-y: scroll;';
				tab.widgets[1].node.style.cssText = tab.widgets[1].node.style.cssText + ' overflow-y: scroll;';
				(<SplitPanel>tab).handles[0].style.cssText += " background-color: DarkGrey;";
				// Create OutputArea that will show TreeView
				let outarea_tree = createOutput(session, newPanel.content.rendermime, <Panel>tab.widgets[0], ['my-outarea-class'], 'jup_vis_out_id2', 'None');
				// Create 2 OutputAreas that will show plots
				let outarea = createOutput(session, newPanel.content.rendermime, <Panel>tab.widgets[1], ['my-outarea-classs'], 'jup_vis_out_id2', 'None');// pythonCode['neoPlot']);
				let outarea2 = createOutput(session, newPanel.content.rendermime, <Panel>tab.widgets[1], ['my-outarea-classs'], 'jup_vis_out_id2', 'None'); //pythonCode['rasterPlot']);
				
				// Also show plot as soon as being activated
				// This is what user expects
				OutputArea.execute(pythonCode['createTree'], outarea_tree, session);
				OutputArea.execute(pythonCode['rasterPlot'], outarea, session);
				OutputArea.execute(pythonCode['lfpPlot'], outarea2, session);
				executeCode(pythonCode['updateTree'], session, (msg: any)=>{});
				console.log("BEFORE REGISTERING");
				// React to codecell execution, update variable list
				NotebookActions.executed.connect((sender, exec_data) => {
					// Only react if codecell from watched notebook was executed
					// Maybe check via Session ID or something
					// Is this a secure check? Is content unique?
					if(exec_data.notebook != newPanel.content){
						return;
					}
					console.log("Cell executed"); 

					// Plot analogsignal (test)
					//OutputArea.execute(pythonCode['neoPlot'], outarea2, session);
					executeCode(pythonCode['updateTree'], session, (msg:any)=>{});
					OutputArea.execute(pythonCode['rasterPlot'], outarea, session);
					OutputArea.execute(pythonCode['lfpPlot'], outarea2, session);

					// Update list of variables
					//executeCode('print("AC")', session, ioCallback); // print(testfunc())
				});
				console.log("After registering");
			});});});
			
			console.log("Connected to currently active Notebook");
		
			// Add some random text, nothing useful here
			// addTextToPanel(tab, 'This is a text');
		}
		

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
