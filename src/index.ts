// Imports for Jupyter
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';
import {
	ICommandPalette,
	ISessionContext,
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

class JupyphantExtension {
	// declaring members of the class
	private app: JupyterFrontEnd;
	private command_palette: ICommandPalette;
	private notebook_tracker: INotebookTracker;
	private myPanels: NotebookPanel[];
	private myVisTabs: Panel[] ;
	private widget: SplitPanel;

	// Construct a new JupyphantExtension
	public constructor(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker) {
		// save all constructor arguments
		this.app = app;
		this.command_palette = command_palette;
		this.notebook_tracker = notebook_tracker;
		// Store references to all tabs containing notebooks
		this.myPanels = [];
		// Store references to all tabs created by this extension
		this.myVisTabs = [];
		// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
		this.widget = new SplitPanel({orientation: 'vertical'});
	}; // end of constructor()


	/******************************************************************************************************************/
	// Define utility functions
	/******************************************************************************************************************/

	public createCommand(command: string){
		/**
		  * Creates a hardcoded command to start this extension
		  * And places it as a button in the CommandPalette on the left-hand side
		  * of the JupyterLab interface.
		  * Clicking 'Jupyphant' in the Commands tab on the left activates the Jupyphant extension
		  */
		// Add the specified command to the commands known by JupyterLab
		 this.app.commands.addCommand(command, {
			label: 'Jupyphant',
			execute: () => {
				// The newTab function that contains the main code is called from the command
				this.newTab();
			}
		});
		// Add the command to the CommandPalette, to make it available on click
		this.command_palette.addItem({command, category: 'NeuroScience'});
	} // end of createCommand()


	// Function to react on command 'Jupyphant'
	// Called only after the command is clicked from CommandPalette
	public newTab() {
		/**
		  * This function actually starts the extension itself.
		  * It creates a new Jupyphant tab that is connected to the notebook active when this function is executed
		  * and therefore displays data from this notebook and reacts to its cell executions.
		  * This function is executed when the command 'Jupyphant' in the CommandPalette is clicked by the user.
		  * Consequently, the notebook that should be visualized using Jupyphant needs to be opened and its tab
		  * needs to be in the foreground when the command is clicked.
		  */

		// Wait for all notebooks to be restored in case newTab is executed early
		// This is probably important for restoring the Jupyphant tabs (not yet implemented)
		this.notebook_tracker.restored.then(()=>{
	        // Get the current notebook
	        // TODO: Why is this done twice? Maybe a scope issue?
	        var newPanel = this.notebook_tracker.currentWidget as NotebookPanel;

	        // If newPanel already has a corresponding Jupyphant tab,
	        // simply show this tab
	        let index = this.myPanels.indexOf(newPanel);
	        if(index != -1){
	            // Open existing tab in the frontend and bring it to the foreground
	            this.attachTab(this.myVisTabs[index], tracker);
	            // Nothing else to do
	            return;
	        }

	        // Otherwise initialize new tab in which everything will be displayed
	        // TODO: Introduce OOP, Tab class => move this to Tab constructor
	        this.initializeTab(newPanel.content.rendermime)
	        // Save the tab and corresponding notebook panel to lists
	        // This indicates that a Jupyphant tab already exists for the notebook
	        // and creates a mapping between the notebook and the tab
	        // TODO: Dict would be a better data structure: newPanel -> tab
	        this.myVisTabs.push(this.widget);
	        this.myPanels.push(newPanel);
	        // Show tab if it was not yet shown; i. e., open in frontend and bring it to the foreground
	        this.attachTab(this.widget, tracker);


	        // Get the IPython session (Python kernel) of the notebook
	        var session: ISessionContext = newPanel.sessionContext;
	        // Debug output
	        console.log("Session.ready: ", session.ready);

	        // If session (kernel) is available in the notebook
	        // And kernel is ready as well
	        session.ready.then(() => {
	            // Register a Comm channel (not needed currently, but might be)
	            // This enables manually exchanging messages from kernel to extension and back
	            this.registerComm('test2', session);

	            // Setup kernel environment, i. e., activate the jupyphant Python module
	            // in order to be able to execute the Jupyphant Python code
	            // Includes, e. g., imports and creating an object
	            // For details, see kernelcode.ts
	            this.executeCode(pythonCode['setupEnv'], session);

	            // get OutputAreas of upper/lower panel that will show TreeView + NodeExplorer / raster + LFP plot
	            let upperPanel = <Panel>this.widget.widgets[0];
	            let lowerPanel = <Panel>this.widget.widgets[1];
	            let outarea_treeview_nodeexplorer = <OutputArea>upperPanel.widgets[0];
	            let outarea_rasterplot = <OutputArea>lowerPanel.widgets[0];
	            let outarea_lfpplot = <OutputArea>lowerPanel.widgets[1];

	            // Also show tree and plots immediately upon being activated
	            // This is what user expects
	            // Code is executed and the results displayed in the specified OutputArea
	            OutputArea.execute(pythonCode['createTree'], outarea_treeview_nodeexplorer, session);
	            OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
	            OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);

	            // This code is executed without output that needs to be displayed
	            // Therefore, no OutputArea is necessary
	            // However, an arbitrary callback can be specified
	            // In this case, the callback does nothing as the code does not produce any output
	            this.executeCode(pythonCode['updateTree'], session);


	            // Debug output
	            console.log("BEFORE REGISTERING");

		        // Create a listener that waits for any notebook cell to be executed
		        // and reacts by updating the tree and the plots, if the notebook
		        // whose cell was executed is the notebook this Jupyphant tab is connected to
		        // Recall that newPanel is the notebook for which this Jupyphant tab was created
		        NotebookActions.executed.connect((sender, exec_data) => {
		            // Only react if codecell from connected notebook was executed
		            // TODO: Maybe check via Session ID or something
		            // TODO: Is this a secure check? Is content unique?
		            if(exec_data.notebook != newPanel.content){
		              return;
		            }
		            // Debug output
		            console.log("Cell executed");

		            // Update tree and plots
		            this.executeCode(pythonCode['updateTree'], session);
		            OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
		            OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);

		        }); // end of NotebookActions.executed.connect()

		        console.log("After registering");

	        }); // end of session.ready.then()

		}); // end of notebook_tracker.restored.then()

		console.log("Connected to currently active Notebook");

	} // end of newTab()

	public attachTab(tab: Panel, tracker: WidgetTracker<Panel>){
		/**
		  * Attach an existing tab to the frontend to display it and add it to a tracker
		  *
		  * Parameters:
		  * tab: The tab to be attached to the frontend
		  * tracker: The tracker passed to the activate function
		  */

		// Attach tab to the frontend if not yet attached
		if (!tab.isAttached) {
			 this.app.shell.add(tab);
		}
		// Add the tab to the tracker for restoration
		if (!tracker.has(tab)) {
			// Track the state of the widget for later restoration
			tracker.add(tab);
		}
		// Display the tab, bring it to the foreground
		 this.app.shell.activateById(tab.id);
	} // end of attachTab()

	public initializeTab(rendermime: IRenderMimeRegistry){
		/**
		  * Initialize a new tab for this extension, used for display of visualizations and widgets
		  */

		this.widget.addClass('my-jupyphantWidget')
		// Set HTML/DOM id
		let dateTime: string = new Date().toLocaleString();
		this.widget.id = 'Jupyphant, ' + dateTime;
		// Title of the tab
		this.widget.title.label = 'Jupyphant';
		// Adds the x to close the tab?
		this.widget.title.closable = true;

		// Divide Tab in upper part for TreeView / NodeExplorer and lower part for OverviewPlots
        this.widget.addWidget(new Panel());
        this.widget.addWidget(new Panel());
        // Scrollbar in both parts in x and y axis
        this.widget.widgets[0].node.style.cssText = this.widget.widgets[0].node.style.cssText +
                                                     ' overflow-x: scroll; overflow-y: scroll;';
        this.widget.widgets[1].node.style.cssText = this.widget.widgets[1].node.style.cssText +
                                                    ' overflow-x: scroll; overflow-y: scroll;';
        // Styling
        (<SplitPanel>this.widget).handles[0].style.cssText += " background-color: DarkGrey;";

		// Create OutputArea in upper panel that will show TreeView and NodeExplorer
        this.createOutputArea(rendermime, <Panel>this.widget.widgets[0], ['my-outarea-class'], 'jup_vis_out_id1');
        // Create 2 OutputAreas in lower panel that will show overview raster/lfp plots
        this.createOutputArea(rendermime, <Panel>this.widget.widgets[1], ['my-outarea-class'], 'jup_vis_out_id2');
        this.createOutputArea(rendermime, <Panel>this.widget.widgets[1], ['my-outarea-class'], 'jup_vis_out_id3');
	} // end of initializeTab()

	public createOutputArea(rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string){
		/**
		  * Creates an OutputArea inside 'tab', in which the output of executed pythonCode will displayed
		  *
		  * Parameters:
		  * rendermime: Required for rendering the output
		  * tab: The tab the OutputArea is created in
		  * cls: HTML/DOM classes the OutputArea belongs to; used for styling with CSS and possibly DOM manipulation
		          later on
		  * id: HTML/DOM id of the OutputArea; used for styling with CSS and possibly DOM manipulation later on
		  */
		// Create an OutputArea
		// OutputAreas are used to display stuff, just like the outputs below every cell
		let model = new OutputAreaModel({trusted: true});
		let outarea = new OutputArea({rendermime, model});
		// Add OutputArea to the specified tab
		tab.addWidget(outarea);
		// Set HTML/DOM id and classes
		outarea.id = id;
		for(let currCls of cls){
			outarea.addClass(currCls);
		}
	}

	//@ts-ignore
	public registerComm(name: string, context: SessionContext){
		/**
		  * Registers a communication channel that allows sending messages
		  * back and forth between the TypeScript code and the IPython session, i.e., the Python kernel
		  * name: Name of the channel
		  * session: IPython session (Python kernel) to communicate with
		  */
		//TODO: Remove hardcoded stuff
        console.log("Communication channel created")
		// Registers something like a callback that acts when the kernel sends a message
		context.session.kernel.registerCommTarget('test2', (comm:any, commMsg:any):any => {
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
	} // end of registerComm()

	//@ts-ignore: May be unused
	public executeCode(code: string, context: SessionContext, callback?: any){
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
        console.log("within executeCode: code = " + code)
		// Request execution, stored as a future
		let future = context.session.kernel.requestExecute(request);
		// In case a callback function was provided, execute it upon completion of the request
		if(callback){
			// When output is published from the request's future
			future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) => {
			    console.log("within executeCode: output is published with msg = " + msg)
				// Execute callback
				callback( msg );
			});
		}
	} // end of executeCode()

}; // end of JupyphantWidget class




/*
* Activate the JupyphantWidget extension
*/
function activate(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker) {
	/**
	 * Performs the initialization of the extension
	 * Parameters:
	 *     app: Provides access and allows manipulation of the frontend, i.e., tabs and commands, etc. within JupyterLab
	 *     command_palette: Provides access to the CommandPalette panel on the left side, allowing to add new commands
	 *              that can be activated on click
	 *     notebook_tracker: Used to track notebooks and their actions, e.g., which one is active
	 *     restorer: Allows to restore the previous state of the extension at startup
	 */


	console.log('JupyterLab extension Jupyphant is activated!');

	// create instance of JupyphantExtension
	const jupy_ext = new JupyphantExtension(app, command_palette, notebook_tracker);

	// Add an application command: this is placed into CommandPalette and by clicking on the corresponding button
	// this command will open the jupyphant tab
	const command: string = 'jupyphant:open';
	jupy_ext.createCommand(command);
}; // end of activate()

/*
* Initialization data for the Jupyphant extension
*/
const extension: JupyterFrontEndPlugin<void> = {
	id: 'Jupyphant',
	autoStart: true,
	// What to pass to the activate function
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry],
	optional: [ILayoutRestorer],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;

// /**
//  * Definition of the jupyphant extension.
//  */
// const extension: JupyterFrontEndPlugin<void> = {
// 	// Metadata, for details see the tutorial linked in README.md
// 	id: 'Jupyphant',
// 	autoStart: true,
// 	// What to pass to the activate function
// 	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer],
// 	// activate: Function that is called upon startup of the extension
// 	// Parameters are passed by the extension framework as specified in 'requires'
// 	activate:
// 	(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
// 	render_mime_registry: IRenderMimeRegistry, restorer: ILayoutRestorer) => {
// 		/**
// 		 * Performs the initialization of the extension
// 		 * Parameters:
// 		 * app: Provides access and allows manipulation of the frontend, i.e., tabs and commands, etc. within JupyterLab
// 		 * command_palette: Provides access to the CommandPalette panel on the left side, allowing to add new commands
// 		 *           that can be activated on click
// 		 * notebook_tracker: Used to track notebooks and their actions, e.g., which one is active
// 		 * restorer: Allows to restore the previous state of the extension at startup
// 		 */
// 		// Debug log
// 		console.log('JupyterLab extension Jupyphant is activated!');
//
// 		// Store references to all tabs containing notebooks
// 		var myPanels: NotebookPanel[] = [];
// 		// Store references to all tabs created by this extension
// 		var myVisTabs: Panel[] = [];
//
// 		// Define functions used below
//
// 		// Adds an OutputArea to the tab 'widget'
// 		function createOutputArea(rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string){
// 			/**
// 			  * Creates an OutputArea inside 'tab', in which the output of executed pythonCode will displayed
// 			  *
// 			  * Parameters:
// 			  * rendermime: Required for rendering the output
// 			  * tab: The tab the OutputArea is created in
// 			  * cls: HTML/DOM classes the OutputArea belongs to; used for styling with CSS and possibly DOM manipulation
// 			          later on
// 			  * id: HTML/DOM id of the OutputArea; used for styling with CSS and possibly DOM manipulation later on
// 			  */
// 			// Create an OutputArea
// 			// OutputAreas are used to display stuff, just like the outputs below every cell
// 			let model = new OutputAreaModel({trusted: true});
// 			let outarea = new OutputArea({rendermime, model});
// 			// Add OutputArea to the specified tab
// 			tab.addWidget(outarea);
// 			// Set HTML/DOM id and classes
// 			outarea.id = id;
// 			for(let currCls of cls){
// 				outarea.addClass(currCls);
// 			}
// 		}
//
// 		function initializeTab(rendermime: IRenderMimeRegistry){
// 			/**
// 			  * Initialize a new tab for this extension, used for display of visualizations and widgets
// 			  */
//
// 			// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
// 			let widget: Panel = new SplitPanel({orientation: 'vertical'});
// 			widget.addClass('my-jupyphantWidget')
// 			// Set HTML/DOM id
// 			let dateTime: string = new Date().toLocaleString();
// 			widget.id = 'Jupyphant, ' + dateTime;
// 			// Title of the tab
// 			widget.title.label = 'Jupyphant';
// 			// Adds the x to close the tab?
// 			widget.title.closable = true;
//
// 			// Divide Tab in upper part for TreeView / NodeExplorer and lower part for OverviewPlots
//             widget.addWidget(new Panel());
//             widget.addWidget(new Panel());
//             // Scrollbar in both parts in x and y axis
//             widget.widgets[0].node.style.cssText = widget.widgets[0].node.style.cssText +
//                                                 ' overflow-x: scroll; overflow-y: scroll;';
//             widget.widgets[1].node.style.cssText = widget.widgets[1].node.style.cssText +
//                                                 ' overflow-x: scroll; overflow-y: scroll;';
//             // Styling
//             (<SplitPanel>widget).handles[0].style.cssText += " background-color: DarkGrey;";
//
// 			// Create OutputArea in upper panel that will show TreeView and NodeExplorer
//             createOutputArea(rendermime, <Panel>widget.widgets[0], ['my-outarea-class'], 'jup_vis_out_id1');
//             // Create 2 OutputAreas in lower panel that will show overview raster/lfp plots
//             createOutputArea(rendermime, <Panel>widget.widgets[1], ['my-outarea-class'], 'jup_vis_out_id2');
//             createOutputArea(rendermime, <Panel>widget.widgets[1], ['my-outarea-class'], 'jup_vis_out_id3');
//
// 			return widget;
// 		}
//
// 		function attachTab(tab: Panel, tracker: WidgetTracker<Panel>){
// 			/**
// 			  * Attach an existing tab to the frontend to display it and add it to a tracker
// 			  *
// 			  * Parameters:
// 			  * tab: The tab to be attached to the frontend
// 			  * tracker: The tracker passed to the activate function
// 			  */
//
// 			// Attach tab to the frontend if not yet attached
// 			if (!tab.isAttached) {
// 				 app.shell.add(tab);
// 			}
// 			// Add the tab to the tracker for restoration
// 			if (!tracker.has(tab)) {
// 				// Track the state of the widget for later restoration
// 				tracker.add(tab);
// 			}
// 			// Display the tab, bring it to the foreground
// 			 app.shell.activateById(tab.id);
// 		}
//
// 		function createCommand(command: string){
// 			/**
// 			  * Creates a hardcoded command to start this extension
// 			  * And places it as a button in the CommandPalette on the left-hand side
// 			  * of the JupyterLab interface.
// 			  * Clicking 'Jupyphant' in the Commands tab on the left activates the Jupyphant extension
// 			  */
// 			// Add the specified command to the commands known by JupyterLab
// 			 app.commands.addCommand(command, {
// 				label: 'Jupyphant',
// 				execute: () => {
// 					// The newTab function that contains the main code is called from the command
// 					newTab();
// 				}
// 			});
// 			// Add the command to the CommandPalette, to make it available on click
// 			command_palette.addItem({command, category: 'NeuroScience'});
// 		}
// 		//@ts-ignore
// 		//		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
// 		//	console.log("Got return from Kernel");
// 		//	console.log(msg);
// 		//	if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
// 		//		console.log("Stdout: ", msg.content);
// 		//		let text = document.createTextNode(msg.content.text as string);
// 		//		let var_place = document.getElementById('neo_ele_vars');
// 		//		let old_text = var_place.childNodes[0];
// 		//		if(old_text != null){
// 		//			var_place.removeChild(old_text);
// 		//		}
// 		//		var_place.appendChild(text);
// 		//	}
// 		//}
//
// 		function registerComm(name: string, context: SessionContext){
// 			/**
// 			  * Registers a communication channel that allows sending messages
// 			  * back and forth between the TypeScript code and the IPython session, i.e., the Python kernel
// 			  * name: Name of the channel
// 			  * session: IPython session (Python kernel) to communicate with
// 			  */
// 			//TODO: Remove hardcoded stuff
//             console.log("Communication channel created")
// 			// Registers something like a callback that acts when the kernel sends a message
// 			context.session.kernel.registerCommTarget('test2', (comm:any, commMsg:any):any => {
// 				// Only react if the message is sent to the channel/target named 'test2'
// 				if(commMsg.content.target_name !== 'test2'){
// 					return;
// 				}
// 				// React to the message
// 				// Callback that deals with the message
// 				comm.onMsg = (msg:any) => {
// 					var c = msg.buffers[0].buffer;
// 					c;
// 					console.log("Message received");
// 					//console.log(c[0]);
// 					//console.log("MEEESSSAAAGGEEE ", msg.buffers[0]);
// 					//console.log(new Float32Array(msg.buffers[0].buffer));
// 				};
// 				// Callback that reacts to closing of the communication channel (possibly by the Python kernel)
// 				comm.onClose = (msg:any) => {};
// 			});
// 		}
// 		//@ts-ignore: May be unused
// 		function executeCode(code: string, context: SessionContext, callback?: any){
// 			/**
// 			  * Executes Python code in the specified IPython session and executes a callback
// 			  * processing the output after finishing the execution
//
// 			  * Parameters:
// 			  * code: Code to be executed, provided as a string; possibly from kernelcode.ts
// 			  * session: The IPython session (i. e., Python kernel) that will execute the code
// 			  */
// 			// Create a request that will be sent to the kernel
// 			let request: KernelMessage.IExecuteRequestMsg['content'] = {
// 				code: code,
// 				stop_on_error: false,
// 				store_history: false,
// 			};
//             console.log("within executeCode: code = " + code)
// 			// Request execution, stored as a future
// 			let future = context.session.kernel.requestExecute(request);
// 			// In case a callback function was provided, execute it upon completion of the request
// 			if(callback){
// 				// When output is published from the request's future
// 				future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) => {
// 				    console.log("within executeCode: output is published with msg = " + msg)
// 					// Execute callback
// 					callback( msg );
// 				});
// 			}
// 		}
//
// 		// Function to react on command 'Jupyphant'
// 		// Called only after the command is clicked from CommandPalette
// 		function newTab() {
// 			/**
// 			  * This function actually starts the extension itself.
// 			  * It creates a new Jupyphant tab that is connected to the notebook active when this function is executed
// 			  * and therefore displays data from this notebook and reacts to its cell executions.
// 			  * This function is executed when the command 'Jupyphant' in the CommandPalette is clicked by the user.
// 			  * Consequently, the notebook that should be visualized using Jupyphant needs to be opened and its tab
// 			  * needs to be in the foreground when the command is clicked.
// 			  */
//
// 			// Wait for all notebooks to be restored in case newTab is executed early
// 			// This is probably important for restoring the Jupyphant tabs (not yet implemented)
// 			notebook_tracker.restored.then(()=>{
//                 // Get the current notebook
//                 // TODO: Why is this done twice? Maybe a scope issue?
//                 var newPanel = notebook_tracker.currentWidget as NotebookPanel;
//
//                 // If newPanel already has a corresponding Jupyphant tab,
//                 // simply show this tab
//                 let index = myPanels.indexOf(newPanel);
//                 if(index != -1){
//                     // Open existing tab in the frontend and bring it to the foreground
//                     attachTab(myVisTabs[index], tracker);
//                     // Nothing else to do
//                     return;
//                 }
//
//                 // Otherwise initialize new tab in which everything will be displayed
//                 // TODO: Introduce OOP, Tab class => move this to Tab constructor
//                 let tab = initializeTab(newPanel.content.rendermime);
//                 // Save the tab and corresponding notebook panel to lists
//                 // This indicates that a Jupyphant tab already exists for the notebook
//                 // and creates a mapping between the notebook and the tab
//                 // TODO: Dict would be a better data structure: newPanel -> tab
//                 myVisTabs.push(tab);
//                 myPanels.push(newPanel);
//                 // Show tab if it was not yet shown; i. e., open in frontend and bring it to the foreground
//                 attachTab(tab, tracker);
//
//
//                 // Get the IPython session (Python kernel) of the notebook
//                 var session: ISessionContext = newPanel.sessionContext;
//                 // Debug output
//                 console.log("Session.ready: ", session.ready);
//
//                 // If session (kernel) is available in the notebook
//                 // And kernel is ready as well
//                 session.ready.then(() => {
//                     // Register a Comm channel (not needed currently, but might be)
//                     // This enables manually exchanging messages from kernel to extension and back
//                     registerComm('test2', session);
//
//                     // Setup kernel environment, i. e., activate the jupyphant Python module
//                     // in order to be able to execute the Jupyphant Python code
//                     // Includes, e. g., imports and creating an object
//                     // For details, see kernelcode.ts
//                     executeCode(pythonCode['setupEnv'], session);
//
//                     // get OutputAreas of upper/lower panel that will show TreeView + NodeExplorer / raster + LFP plot
//                     let upperPanel = <Panel>tab.widgets[0];
//                     let lowerPanel = <Panel>tab.widgets[1];
//                     let outarea_treeview_nodeexplorer = <OutputArea>upperPanel.widgets[0];
//                     let outarea_rasterplot = <OutputArea>lowerPanel.widgets[0];
//                     let outarea_lfpplot = <OutputArea>lowerPanel.widgets[1];
//
//                     // Also show tree and plots immediately upon being activated
//                     // This is what user expects
//                     // Code is executed and the results displayed in the specified OutputArea
//                     OutputArea.execute(pythonCode['createTree'], outarea_treeview_nodeexplorer, session);
//                     OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
//                     OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);
//
//                     // This code is executed without output that needs to be displayed
//                     // Therefore, no OutputArea is necessary
//                     // However, an arbitrary callback can be specified
//                     // In this case, the callback does nothing as the code does not produce any output
//                     executeCode(pythonCode['updateTree'], session);
//
//
//                     // Debug output
//                     console.log("BEFORE REGISTERING");
//
// 			        // Create a listener that waits for any notebook cell to be executed
// 			        // and reacts by updating the tree and the plots, if the notebook
// 			        // whose cell was executed is the notebook this Jupyphant tab is connected to
// 			        // Recall that newPanel is the notebook for which this Jupyphant tab was created
// 			        NotebookActions.executed.connect((sender, exec_data) => {
// 			            // Only react if codecell from connected notebook was executed
// 			            // TODO: Maybe check via Session ID or something
// 			            // TODO: Is this a secure check? Is content unique?
// 			            if(exec_data.notebook != newPanel.content){
// 			              return;
// 			            }
// 			            // Debug output
// 			            console.log("Cell executed");
//
// 			            // Update tree and plots
// 			            executeCode(pythonCode['updateTree'], session);
// 			            OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
// 			            OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);
//
// 			        }); // end of NotebookActions.executed.connect()
//
// 			        console.log("After registering");
//
//                 }); // end of session.ready.then()
//
// 			}); // end of notebook_tracker.restored.then()
//
// 			console.log("Connected to currently active Notebook");
//
// 		} // end of newTab()
//
// /**********************************************************************************************************************/
// 		// Place command into CommandPalette, can then be executed by clicking on the corresponding button
// 		// This command will open the tab
// 		const command: string = 'jupyphant:open';
// 		createCommand(command);
//
// 		// Track and restore extension's tabs, needs to work together with restoration of main area
// 		// When Main Area is restored, it needs to get all available Notebooks and Consoles
// 		// and then check all of them and connect each tab to the right one
// 		// TODO: This is not yet completed
// 		// Tracker has a namespace where everything is saved;
// 		// this namespace needs to have the same name as in the last session
// 		// to restore the last session
// 		let tracker = new WidgetTracker<Panel>({ namespace: 'jupyphant_namespace' });
// 		// Restore from corresponding namespace
//   		restorer.restore(tracker, {
// 			command,
// 			//args: () => JSONExt.emptyObject,
// 			name: () => 'jupyphant_namespace'
// 		});
//
// 		// Dummy code, might be needed to initialize in the beginning,
// 		// e.g., restore all extension tabs that are linked to Notebook tabs
// 		// These Notebook tabs are restored upon starting JupyterLab, once this task is finished,
// 		// app.restored will activate => Then everything that depends on the full startup of JupyterLab can be performed
// 		 app.restored.then((layout) => {
// 			//let newtab = initializeTab();
// 		});
//
// 	} // end of activate()
//
// }; // end of extension()
//
// // This is code that is not yet in use
// // But can be used as template in case anything needs to be fetched
// // @ts-ignore
// function fetchText(){
// 	/**
// 	  * Fetch text from the interwebs
// 	  */
// 	fetch('packages/python/test.py').then(response => {
// 		// Output the text to the console
// 		// Dummy code, replace with something useful
// 		console.log("Reading code: ", response);
// 		return response.json();
// 	}).then(data => {
// 		return data;
// 	});
// }
// // Export the extension to make it known to the extension framework
// export default extension;
