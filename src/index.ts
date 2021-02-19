// Imports for Jupyter
import {
	ICommandPalette, IClientSession, WidgetTracker
} from '@jupyterlab/apputils';
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

// Phosphor imports for dealing with the tabs within JupyterLab
// These are called Panels
import {
	 SplitPanel, Panel
} from '@phosphor/widgets';
//@ts-ignore: TODO: Why is this necessary?
import {
  JSONExt
} from '@phosphor/coreutils';

// Own imports
// Python Code to execute in the kernel
import {
	pythonCode
} from './kernelcode';
// Style from css
import '../style/index.css';

/**
 * Definition of the extension
 */
const extension: JupyterFrontEndPlugin<void> = {
	// Metadata, for details see the tutorial linked in README.md
	id: 'neo_elephant',
	autoStart: true,
	// What to pass to the activate function
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate:
	(lab_: JupyterFrontEnd, palette_: ICommandPalette, consoles_: INotebookTracker, rendermime_, restorer_: ILayoutRestorer) => {
		/**
		 * Performs the initialization of the extension
		 * Parameters:
		 * lab_: Provides access and allows manipulation of the frontend, i.e., tabs and commands, etc. within JupyterLab
		 * palette_: Provides access to the CommandPalette panel on the left side, allowing to add new commands
		 *           that can be activated on click
		 * consoles_: Used to track notebooks and their actions, e.g., which one is active
		 * restorer_: Allows to restore the previous state of the extension at startup
		 */
		// Debug log
		console.log('JupyterLab extension neo_elephant is activated!');
		// The following statements were used for debugging purposes only
		// TODO: Remove them
		const lab: JupyterFrontEnd = lab_;
		const palette: ICommandPalette = palette_;
		//@ts-ignore
		const consoles: INotebookTracker = consoles_;
		//@ts-ignore
		const rendermime: IRenderMimeRegistry = rendermime_;
		//@ts-ignore
		const restorer: ILayoutRestorer = restorer_;
		// Store references to all tabs containing notebooks
		var myPanels: NotebookPanel[] = [];
		// Store references to all tabs created by this extension
		var myVisTabs: Panel[] = [];
		
		// Define functions used below
		
		// Adds an OutputArea to the tab 'widget'
		function createOutput(session: IClientSession, rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string, code: string): OutputArea{
			/**
			  * Creates an OutputArea and executes code, the output of the code is displayed in the OutputArea
			  * 
			  * Parameters:
			  * session: The IPython session (i.e., the Python kernel) to execute the code in
			  * rendermime: Required for rendering the output
			  * tab: The tab the OutputArea is created in
			  * cls: HTML/DOM classes the OutputArea belongs to; used for styling with CSS and possibly DOM manipulation later on
			  * id: HTML/DOM id of the OutputArea; used for styling with CSS and possibly DOM manipulation later on
			  * code: The code to be executed in the IPython session
			  */
			// Create an OutputArea
			// OutputAreas are used to display stuff, just like the outputs below every cell
			let model = new OutputAreaModel({trusted: true});
			let outarea = new OutputArea({rendermime, model});
			console.log(outarea);
			// Add OutputArea to the specified tab
			tab.addWidget(outarea);
			// Execute code and display its output
			OutputArea.execute(code, outarea, session);
			// Set HTML/DOM id and classes
			outarea.id = id;
			for(let currCls of cls){
				outarea.addClass(currCls);
			}
			return outarea;
		}
		//@ts-ignore: Unused; only for debugging purposes
		function addTextToPanel(widget: Panel, text: string){
			/**
			  * Adds a new div to a Phosphor Panel (e.g., a JupyterLab tab) that contains some text
			  * in a TextNode
			  *
			  * Parameters:
			  * widget: Tab which the text will be added to
			  * text: Text to be added to widget
			  */
			// Create div and TextNode
			let new_content = document.createElement('div');
			let textField = document.createTextNode(text);
			// Add div and TextNode into the DOM using DOM manipulation
			new_content.appendChild(textField);
			// widget is a DOM object that childs can be added to
			// like when using HTML
			widget.node.appendChild(new_content);
		}

		function initializeTab(){
			/**
			  * Initialize a new tab for this extension, used for display of visualizations and widgets
			  */
			// Create new Phosphor Panel, i.e., tab within JupyterLab,
			// with a split view (top part and bottom part)
			let widget: Panel = new SplitPanel({orientation: 'vertical'});
			// Set HTML/DOM id
			widget.id = 'neo_elephant';
			// Title of the tab
			widget.title.label = 'Visualization';
			// Adds the x to close the tab?
			widget.title.closable = true;
			// Create a div element that other subelements can be added to and add it to the tab
			let var_place = document.createElement('div');
			var_place.setAttribute("id", "neo_ele_vars");
			widget.node.appendChild(var_place);
			return widget;
		}

		function attachTab(tab: Panel, tracker: WidgetTracker<Panel>){
			/**
			  * Attach an existing tab to the frontend to display it and add it to a tracker
			  * 
			  * Parameters:
			  * tab: The tab to be attached to the frontend
			  * tracker: The tracker passed to the activate function
			  */

			// Attach tab to the frontend if not yet attached
			if (!tab.isAttached) {
				lab.shell.add(tab);
			}
			// Add the tab to the tracker for restoration
			if (!tracker.has(tab)) {
				// Track the state of the widget for later restoration
				tracker.add(tab);
			}
			// Display the tab, bring it to the foreground
			lab.shell.activateById(tab.id);
		}

		function createCommand(command: string){
			/**
			  * Creates a hardcoded command to start this extension
			  * And places it as a button in the CommandPalette on the left-hand side
			  * of the JupyterLab interface.
			  * Clicking 'Jupyphant' in the Commands tab on the left activates the Jupyphant extension
			  */
			// Add the specified commant to the commands known by JupyterLab
			lab.commands.addCommand(command, {
				label: 'Jupyphant',
				execute: () => {
					// The newTab function that contains the main code is called from the command 
					newTab();
				}
			});
			// Add the command to the CommandPalette, to make it available on click
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
			/**
			  * Registers a communication channel that allows sending messages
			  * back and forth between the TypeScript code and the IPython session, i.e., the Python kernel
			  * name: Name of the channel
			  * session: IPython session (Python kernel) to communicate with
			  */
			//TODO: Remove hardcoded stuff
			
			// Registers something like a callback that acts when the kernel sends a message
			session.kernel.registerCommTarget('test2', (comm:any, commMsg:any):any => {
				// Only react if the message is sent to the channel/target named 'test2'
				if(commMsg.content.target_name !== 'test2'){
					return;
				}
				// React to the message
				// Callback that deals with the message
				comm.onMsg = (msg:any) => {
					var c = msg.buffers[0].buffer;
					c;
					console.log("Message received");
					//console.log(c[0]);
					//console.log("MEEESSSAAAGGEEE ", msg.buffers[0]);
					//console.log(new Float32Array(msg.buffers[0].buffer));
				};
				// Callback that reacts to closing of the communication channel (possibly by the Python kernel)
				comm.onClose = (msg:any) => {};
			});
		}
		//@ts-ignore: May be unused
		function executeCode(code: string, session: IClientSession, callback?: any){
			/**
			  * Executes Python code in the specified IPython session and executes a callback
			  * processing the output after finishing the execution

			  * Parameters:
			  * code: Code to be executed, provided as a string; possibly from kernelcode.ts
			  * session: The IPython session (i. e., Python kernel) that will execute the code
			  */
			// Create a request that will be sent to the kernel
			let request: KernelMessage.IExecuteRequestMsg['content'] = {
				code: code,
				stop_on_error: false,
				store_history: false,
			};

			// Request execution, stored as a future
			let future = session.kernel.requestExecute(request);
			// In case a callback function was provided, execute it upon completion of the request
			if(callback){
				// When output is published from the request's future
				future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) => {
					// Execute callback
					callback( msg );
				});
			}
		}
	
		/********************************************************************************************************************************/
		// let widget = initializeTab(lab);
		// Place command into CommandPalette, can then be executed by clicking on the corresponding button
		// This command will open the tab			
		let command = 'neo:open';
		createCommand(command);

		// Track and restore extension's tabs, needs to work together with restoration of main area
		// When Main Area is restored, it needs to get all available Notebooks and Consoles
		// and then check all of them and connect each tab to the right one
		// TODO: This is not yet completed
		// Tracker has a namespace where everything is saved
		let tracker = new WidgetTracker<Panel>({ namespace: 'neo_jup_vis' });
		// Restore from corresponding namespace
  		restorer.restore(tracker, {
			command,
			//args: () => JSONExt.emptyObject,
			name: () => 'neo_jup_vis'
		});

		// Dummy code, might be needed to initialize in the beginning,
		// e.g., restore all extension tabs that are linked to Notebook tabs
		// These Notebook tabs are restored upon starting JupyterLab, once this task is finished,
		// lab.restored will activate => Then everything that depends on the full startup of JupyterLab can be performed
		lab.restored.then((layout) => {
			//let newtab = initializeTab();
		});

		// Function to react on command 'Jupyphant'
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
	/**
	  * Fetch text from the interwebs
	  */
	fetch('packages/python/test.py').then(response => {
		// Output the text to the console
		// Dummy code, replace with something useful
		console.log("Reading code: ", response);
		return response.json();
	}).then(data => {
		return data;
	});
}
// Export the extension to make it known to the extension framework
export default extension;
