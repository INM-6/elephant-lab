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
	 Panel,
	 Widget,
	 DockPanel
} from '@lumino/widgets';

import {
	toArray
} from '@lumino/algorithm';

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
	private widget_tracker: WidgetTracker;
	private myPanels: NotebookPanel[];
	private myVisTabs: Widget[] ;
	private widget: DockPanel;
	private rendermime: IRenderMimeRegistry;

	// Construct a new JupyphantExtension
	public constructor(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
						widget_tracker: WidgetTracker, rendermime: IRenderMimeRegistry) {
		// save all constructor arguments
		this.app = app;
		this.command_palette = command_palette;
		this.notebook_tracker = notebook_tracker;
		this.widget_tracker = widget_tracker;
		// Store references to all tabs containing notebooks
		this.myPanels = [];
		// Store references to all tabs created by this extension
		this.myVisTabs = [];
		// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
		this.widget = new DockPanel();
		
		this.rendermime = rendermime;
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
	            this.attachTab();
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
	        this.attachTab();


	        // Get the IPython session (Python kernel) of the notebook
	        var session: ISessionContext = newPanel.sessionContext;  // TODO: rename to session_context
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

	            // get OutputAreas of panels that will show TreeView + NodeExplorer / raster + LFP plot
				let widgets_iter = toArray(this.widget.widgets());
	            let tree_content = <Panel>widgets_iter[0];
	            let explorer_content = <DockPanel>widgets_iter[1];
	            let overview_content = <Panel>widgets_iter[2];

	            let explorer_content_iter = toArray(explorer_content.widgets());
	            let explorer_content_info = <Panel>explorer_content_iter[0];
	            let explorer_content_raw = <Panel>explorer_content_iter[1];
	            let explorer_content_statistics = <Panel>explorer_content_iter[2];

	            let outarea_treeview= <OutputArea>tree_content.widgets[0];// TODO: use CamelCase instead of under_scores
	            let outarea_nodeexplorer_info = <OutputArea>explorer_content_info.widgets[0];
	            let outarea_nodeexplorer_raw = <OutputArea>explorer_content_raw.widgets[0];
	            let outarea_nodeexplorer_statistics = <OutputArea>explorer_content_statistics.widgets[0];

	            let outarea_rasterplot = <OutputArea>overview_content.widgets[0];
	            let outarea_lfpplot = <OutputArea>overview_content.widgets[1];

	            // Also show tree and plots immediately upon being activated
	            // This is what user expects
	            // Code is executed and the results displayed in the specified OutputArea
	            OutputArea.execute(pythonCode['createTree'], outarea_treeview, session);

	            // This code is executed without output that needs to be displayed
	            // Therefore, no OutputArea is necessary
	            // However, an arbitrary callback can be specified
	            // In this case, the callback does nothing as the code does not produce any output
	            this.executeCode(pythonCode['updateTree'], session);
				OutputArea.execute(pythonCode['createExplorerInfo'], outarea_nodeexplorer_info, session);
				OutputArea.execute(pythonCode['createExplorerRawPlot'], outarea_nodeexplorer_raw, session);
				OutputArea.execute(pythonCode['createExplorerStatistics'], outarea_nodeexplorer_statistics, session);
	            OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
	            OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);

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

				session.statusChanged.connect((context, status) => {
					if( status === "restarting" || status === "autorestarting") {
						console.log("KERNEL status changed in " + context + ". Status is:"+ status);
						context.ready.then(() => {
							this.executeCode(pythonCode['setupEnv'], session);
							console.log("Jupyphant was reset!");

							// get OutputAreas of panels that will show TreeView + NodeExplorer / raster + LFP plot
							let widgets_iter = toArray(this.widget.widgets());
				            let tree_content = <Panel>widgets_iter[0];
				            let explorer_content = <DockPanel>widgets_iter[1];
				            let overview_content = <Panel>widgets_iter[2];

				            let explorer_content_iter = toArray(explorer_content.widgets());
				            let explorer_content_info = <Panel>explorer_content_iter[0];
				            let explorer_content_raw = <Panel>explorer_content_iter[1];
				            let explorer_content_statistics = <Panel>explorer_content_iter[2];

				            let outarea_treeview= <OutputArea>tree_content.widgets[0];// TODO: use CamelCase instead of under_scores
				            let outarea_nodeexplorer_info = <OutputArea>explorer_content_info.widgets[0];
				            let outarea_nodeexplorer_raw = <OutputArea>explorer_content_raw.widgets[0];
				            let outarea_nodeexplorer_statistics = <OutputArea>explorer_content_statistics.widgets[0];

				            let outarea_rasterplot = <OutputArea>overview_content.widgets[0];
				            let outarea_lfpplot = <OutputArea>overview_content.widgets[1];

				            // Also show tree and plots immediately upon being activated
				            // This is what user expects
				            // Code is executed and the results displayed in the specified OutputArea
				            OutputArea.execute(pythonCode['createTree'], outarea_treeview, session);

				            // This code is executed without output that needs to be displayed
				            // Therefore, no OutputArea is necessary
				            // However, an arbitrary callback can be specified
				            // In this case, the callback does nothing as the code does not produce any output
				            this.executeCode(pythonCode['updateTree'], session);
							OutputArea.execute(pythonCode['createExplorerInfo'], outarea_nodeexplorer_info, session);
							OutputArea.execute(pythonCode['createExplorerRawPlot'], outarea_nodeexplorer_raw, session);
							OutputArea.execute(pythonCode['createExplorerStatistics'], outarea_nodeexplorer_statistics, session);
				            OutputArea.execute(pythonCode['rasterPlot'], outarea_rasterplot, session);
				            OutputArea.execute(pythonCode['lfpPlot'], outarea_lfpplot, session);
						});
					}
	             });
				//  this.createElephantUI(session);	
				 this.createElephantGui(session);
	        }); // end of session.ready.then()

		}); // end of notebook_tracker.restored.then()

		console.log("Connected to currently active Notebook");

	} // end of newTab()

	public attachTab() {
		/**
		  * Attach an existing  to the frontend to display it and add it to a tracker.
		  */

		// Attach tab to the frontend if not yet attached
		if (!this.widget.isAttached) {
			 this.app.shell.add(this.widget);
		}
		// Add the tab to the tracker for restoration
		if (!this.widget_tracker.has(this.widget)) {
			// Track the state of the widget for later restoration
			this.widget_tracker.add(this.widget);
		}
		// Display the tab, bring it to the foreground
		 this.app.shell.activateById(this.widget.id);
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
		
		const session = this.notebook_tracker.currentWidget?.sessionContext;

		if (!session) {
			console.error("Keine Notebook-Session gefunden!");
			return;
		}

		let tree_widget = new Panel();
		tree_widget.title.label = 'Neo Tree';
		tree_widget.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
        this.createOutputArea(rendermime, tree_widget, ['my-outarea-class'], 'jup_vis_out_id_1', session);

		let explorer_widget = new DockPanel({tabsMovable: false});
		explorer_widget.title.label = 'Node Explorer';
		explorer_widget.node.style.cssText = explorer_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
        // INFO
        let explorer_widget_info = new Panel();
		explorer_widget_info.title.label = 'Info';
		explorer_widget_info.node.style.cssText = explorer_widget_info.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.createOutputArea(rendermime, explorer_widget_info, ['my-outarea-class'], 'jup_vis_out_id_2.1', session);
		explorer_widget.addWidget(explorer_widget_info);
		// RAW
		let explorer_widget_raw_plot = new Panel();
		explorer_widget_raw_plot.title.label = 'Raw Plot';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class'], 'jup_vis_out_id_2.2', session);
		explorer_widget.addWidget(explorer_widget_raw_plot, {mode: 'tab-after', ref: explorer_widget_info});
		// STATISTICS
		let explorer_widget_statistics = new Panel();
		explorer_widget_statistics.title.label = 'Statistics';
		explorer_widget_statistics.node.style.cssText = explorer_widget_statistics.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.createOutputArea(rendermime, explorer_widget_statistics, ['my-outarea-class'], 'jup_vis_out_id_2.3', session);
		explorer_widget.addWidget(explorer_widget_statistics, {mode: 'tab-after', ref: explorer_widget_raw_plot});

		let overview_widget = new Panel();
		overview_widget.title.label = 'Overview Plots';
		overview_widget.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
        this.createOutputArea(rendermime, overview_widget, ['my-outarea-class'], 'jup_vis_out_id_3.1', session);
        this.createOutputArea(rendermime, overview_widget, ['my-outarea-class'], 'jup_vis_out_id_3.2', session);

        this.widget.addWidget(tree_widget);
        this.widget.addWidget(explorer_widget, {mode: 'split-right', ref: tree_widget});
        this.widget.addWidget(overview_widget, {mode: 'split-bottom', ref: explorer_widget});

	} // end of initializeTab()

	public createOutputArea(rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string, session: ISessionContext) {
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
		// console.log("Führe Neo-Tree Erstellung aus...");
		// OutputArea.execute("\njupyphant_entity.create_tree()", outarea, session, { displayId: true })
        // .then(() => console.log("Neo-Tree erfolgreich geladen!"))
        // .catch(err => console.error("Fehler beim Laden des Neo-Trees:", err));

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

	public async pingElephantServer(serverUrl: string): Promise<boolean> {
		try {
			const response = await fetch(`${serverUrl}/ping`, { method: "GET" });
			return response.ok;
		} catch (error) {
			console.error("Fehler beim Pingen des Servers:", error);
			return false;
		}
	}

	public async loadElephantModules(elephant_modules_dropdown: HTMLSelectElement, elephant_functions_dropdown: HTMLSelectElement, serverUrl: string) {
		console.log("Lade Elephant-Module");
		try {
			const response = await fetch(`${serverUrl}/get_elephant_modules`);
			if (!response.ok) {
				throw new Error(`Server antwortet mit Status: ${response.status}`);
			}
	
			const server_response = await response.json();
			console.log("Erhaltene Elephant-Module:", server_response);
			
			this.createElephantDropdowns(elephant_modules_dropdown, elephant_functions_dropdown, server_response);
			// elephant_modules_dropdown.innerHTML = "";
			
			// for (const [moduleName, functions] of Object.entries(server_response) as [string, string[]][]) {
			// 	console.log(`Modul: ${moduleName}`);
			// 	const option = document.createElement("option");
			// 	option.value = moduleName;
			// 	option.textContent = moduleName;
			// 	elephant_modules_dropdown.appendChild(option);				
				
			// 	functions.forEach((funcName) => {
			// 		console.log(`Funktion: ${funcName}`);
			// 		const option = document.createElement("option");
			// 		option.value = funcName;
			// 		option.textContent = funcName;
			// 		elephant_functions_dropdown.appendChild(option);
			// 	});
			// }
	
		} catch (error) {
			console.error("Fehler beim Abrufen der Elephant-Funktionen:", error);
			elephant_modules_dropdown.innerHTML = "<option>Fehler beim Laden</option>";
		}
	}

	public createElephantDropdowns(elephant_modules_dropdown: HTMLSelectElement, elephant_functions_dropdown: HTMLSelectElement, elephantModules: { [key: string]: string[] }) {
		console.log("Erstelle Dropdowns für Module & Funktionen...");
	
		elephant_modules_dropdown.id = "elephant-module-select";
		elephant_modules_dropdown.style.width = "100%";
		elephant_modules_dropdown.innerHTML = "<option>Modul auswählen...</option>";
	
		elephant_functions_dropdown.id = "elephant-function-select";
		elephant_functions_dropdown.style.width = "100%";
		elephant_functions_dropdown.innerHTML = "<option>Funktion auswählen...</option>";
	
		Object.keys(elephantModules).forEach((moduleName) => {
			const option = document.createElement("option");
			option.value = moduleName;
			option.textContent = moduleName;
			elephant_modules_dropdown.appendChild(option);
		});
	
		elephant_modules_dropdown.addEventListener("change", () => {
			const selectedModule = elephant_modules_dropdown.value;
			this.updateFunctionDropdown(elephant_functions_dropdown, elephantModules[selectedModule] || []);
		});
	}

	public updateFunctionDropdown(dropdown: HTMLSelectElement, functions: string[]) {
		console.log(`Lade Funktionen für Modul: ${dropdown.value}`);
	
		// Dropdown leeren und neue Funktionen einfügen
		dropdown.innerHTML = "<option>Funktion auswählen...</option>";
		functions.forEach((funcName) => {
			const option = document.createElement("option");
			option.value = funcName;
			option.textContent = funcName;
			dropdown.appendChild(option);
		});
	}
	
	
	

	public createElephantGui(session: ISessionContext) {
		console.log("Building Elephant-GUI Window");	
		const buttonOpenGUI = document.createElement("button");
		buttonOpenGUI.textContent = "🐘 Elephant-Analyse";
		// buttonOpenGUI.style.position = "absolute";
		buttonOpenGUI.style.top = "10px";
		buttonOpenGUI.style.right = "10px";
		buttonOpenGUI.style.padding = "10px";
		buttonOpenGUI.style.background = "#007bff";
		buttonOpenGUI.style.color = "white";
		buttonOpenGUI.style.border = "none";
		buttonOpenGUI.style.borderRadius = "5px";
		buttonOpenGUI.style.cursor = "pointer";

		buttonOpenGUI.onclick = () => {
			this.elephantMenue(session, this.rendermime);
		};

		const toolbar = document.getElementById("jp-top-panel");


		if (toolbar) {
			toolbar.appendChild(buttonOpenGUI);
		} else {
			console.log("Error while appending Button")
		}
		
	}


	public elephantMenue(session: ISessionContext, rendermime: IRenderMimeRegistry) {
		const menue = document.createElement("div");
		menue.style.position = "fixed";
		menue.style.top = "0";
		menue.style.left = "0";
		menue.style.width = "100%";
		menue.style.height = "100%";
		menue.style.backgroundColor = "rgba(0,0,0,0.5)";
		menue.style.display = "flex";
		menue.style.alignItems = "center";
		menue.style.justifyContent = "center";
		menue.style.zIndex = "1000";
		
		const menueBox = document.createElement("div");
		menueBox.style.background = "rgba(116, 106, 106, 0.38)";
		menueBox.style.padding = "20px";
		menueBox.style.borderRadius = "8px";
		menueBox.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
		menueBox.style.width = "400px";

		const closeButton = document.createElement("button");
		closeButton.textContent = "Schließen";
		closeButton.style.marginTop = "10px";
		closeButton.style.padding = "10px";
		closeButton.style.background = "#dc3545";
		closeButton.style.color = "white";
		closeButton.style.border = "none";
		closeButton.style.cursor = "pointer";
		closeButton.style.width = "100%";

		closeButton.onclick = () => {
			document.body.removeChild(menue);
		};

		const resultDiv = document.createElement("div");
		resultDiv.style.marginTop = "15px";
		resultDiv.style.padding = "10px";
		resultDiv.style.background = "rgba(28, 56, 47, 0.38)";
		resultDiv.style.border = "1px solid #ddd";
		resultDiv.style.borderRadius = "5px";
		resultDiv.style.maxHeight = "200px";
		resultDiv.style.overflowY = "auto";


		const dropdownElephantFunction = document.createElement("select");
		dropdownElephantFunction.id = "elephant-function-select";

		const dropdownElephantModule = document.createElement("select");
		dropdownElephantFunction.id = "elephant-module-select";

			
		const dropdownContainer = document.createElement("div");
		dropdownContainer.style.marginTop = "10px";
		dropdownContainer.appendChild(dropdownElephantModule);
		dropdownContainer.appendChild(dropdownElephantFunction);
	
		// Eingabe fuer KeyWord Args
		const inputKwargs = document.createElement("input");
		inputKwargs.type = "text";
		inputKwargs.placeholder = "Optionale Parameter";
		inputKwargs.style.display = "block";
		inputKwargs.style.width = "100%";
		inputKwargs.style.marginTop = "10px";
		inputKwargs.style.padding = "5px";

		
		const buttonGenerateCode = document.createElement("button");
		buttonGenerateCode.textContent = "Code generieren";
		buttonGenerateCode.style.marginTop = "10px";
		buttonGenerateCode.style.padding = "10px";
		buttonGenerateCode.style.background = "rgba(27, 0, 177, 0.6)";
		buttonGenerateCode.style.color = "white";
		buttonGenerateCode.style.border = "none";
		buttonGenerateCode.style.cursor = "pointer";
		buttonGenerateCode.style.width = "100%";

		buttonGenerateCode.onclick = async () => {
			console.log("Generate Code button pressed but currently no Implementation :(");
		};	

		const inputElephantServerAddress = document.createElement("input");
		inputElephantServerAddress.type = "text";
		inputElephantServerAddress.placeholder = "Server-Adresse (z.B. http://127.0.0.1:5000)";
		inputElephantServerAddress.style.width = "100%";
		inputElephantServerAddress.style.marginBottom = "10px";
		inputElephantServerAddress.value = localStorage.getItem("elephantServer") || "http://127.0.0.1:5000";

		const buttonPingServer = document.createElement("button");
		buttonPingServer.textContent = "Server anpingen";
		buttonPingServer.style.width = "100%";
		buttonPingServer.style.marginBottom = "10px";
		buttonPingServer.onclick = async () => {
			const serverUrl = inputElephantServerAddress.value;
			localStorage.setItem("elephantServer", serverUrl);
			const isAlive = await this.pingElephantServer(serverUrl);
			if (isAlive) {
				resultDiv.innerHTML = `<b style="color: green;">Server erreichbar!</b>`;
				buttonLoadFunctions.disabled = false;
				buttonRunAnalysis.disabled = false;
				buttonRunAnalysis.style.background = "rgb(59, 201, 95)";

			} else {
				resultDiv.innerHTML = `<b style="color: red;">Server nicht erreichbar!</b>`
				buttonLoadFunctions.disabled = true;
				buttonRunAnalysis.disabled = true;
			}
		};

		const buttonLoadFunctions = document.createElement("button");
		buttonLoadFunctions.textContent = "Elephant-Funktionen abrufen";
		buttonLoadFunctions.style.width = "100%";
		buttonLoadFunctions.disabled = true;
		buttonLoadFunctions.onclick = async () => {
			// await this.loadElephantFunctions(dropdownElephantFunction, inputElephantServerAddress.value);
			await this.loadElephantModules(dropdownElephantModule, dropdownElephantFunction, inputElephantServerAddress.value);
		};


		// Button zum Starten der Analyse
		const buttonRunAnalysis = document.createElement("button");
		buttonRunAnalysis.textContent = "Elephant-Analyse starten";
		buttonRunAnalysis.style.marginTop = "10px";
		buttonRunAnalysis.style.padding = "10px";
		buttonRunAnalysis.style.background = "rgb(25, 58, 6)";
		buttonRunAnalysis.style.color = "white";
		buttonRunAnalysis.style.border = "none";
		buttonRunAnalysis.style.cursor = "pointer";
		buttonRunAnalysis.style.width = "100%";
		buttonRunAnalysis.disabled = true;
		
		buttonRunAnalysis.onclick = async () => {
			const functionName = dropdownElephantFunction.value;
			const moduleName = dropdownElephantModule.value;
			
			const kwargsString = inputKwargs.value;
			console.log("KWARGS", kwargsString)
			
			console.log(`Button Clicked - Starte Analyse: ${functionName} mit Kwargs: ${kwargsString}`);
	
			if (!session?.session || !session.session.kernel) {
				console.error("Kernel nicht gefeunden.");
				return;
			}
	
			try {
				await session.ready;
				console.log("Kernel ist bereit");
				
				let code = `
				from jupyphant.kernelcode import get_selected_neo_ids, apply_elephant_analysis
				import elephant
				selected_ids = get_selected_neo_ids(jupyphant_entity)
				kwargs = dict(item.split("=") for item in "${kwargsString}".split(", "))
				apply_elephant_analysis(jupyphant_entity, ${moduleName}, "${functionName}", selected_ids, **kwargs)
				`;

				if (kwargsString.trim() === "") {
				code = `
					from jupyphant.kernelcode import get_selected_neo_ids, apply_elephant_analysis
					import elephant
					selected_ids = get_selected_neo_ids(jupyphant_entity)
					kwargs = {}
					apply_elephant_analysis(jupyphant_entity, ${moduleName}, "${functionName}", selected_ids, **kwargs)
				`;
				}

				
				console.log("Sende Anfrage an Kernel...");
				const future = session.session.kernel.requestExecute({ code });
	
				future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
					console.log("Kernel-Antwort erhalten:", msg);
				
					if (msg.header.msg_type === "stream" && "text" in msg.content) {
						resultDiv.innerHTML += `<br><b style="color: green;">Ergebnis:</b> ${msg.content["text"]}`;
					}
					else if (msg.header.msg_type === "error") {
						resultDiv.innerHTML += `<br><b style="color: red;">Fehler: ${msg.content}</b>`;
					}
					else if (msg.header.msg_type === "execute_result" && "data" in msg.content) {
						resultDiv.innerHTML += `<br><b style="color: green;">Ergebnis:</b> ${JSON.stringify(msg.content["data"])}`;
					}
					else if (msg.header.msg_type === "display_data" && "data" in msg.content) {
						resultDiv.innerHTML += `<br><b style="color: blue;"></b> ${JSON.stringify(msg.content["data"])}`;
					}
				};
						
			} catch (error) {
				console.error("Fehler beim Senden der Anfrage an den Kernel:", error);
			}
		}

		const treeContainer = new Panel();
		treeContainer.node.style.width = "40%";
		treeContainer.node.style.height = "400px";
		treeContainer.node.style.overflowY = "auto";
		treeContainer.node.style.borderRight = "1px solid #ddd";
		treeContainer.node.style.paddingRight = "10px";
		treeContainer.node.style.minHeight = "200px";
		treeContainer.node.style.display = "block";		

        // this.createOutputArea(this.rendermime, treeContainer, ["neo-tree-output"], "neo-tree-output-id", session);


		menueBox.appendChild(inputElephantServerAddress);
		menueBox.appendChild(buttonPingServer);
    	menueBox.appendChild(buttonLoadFunctions);
		menueBox.appendChild(dropdownContainer);
		// menueBox.appendChild(dropdownElephantModule);
		// menueBox.appendChild(dropdownElephantFunction);
		menueBox.appendChild(treeContainer.node);
		menueBox.appendChild(inputKwargs);
		menueBox.appendChild(buttonRunAnalysis);
		menueBox.appendChild(resultDiv);
		menueBox.appendChild(closeButton);
		menueBox.appendChild(buttonGenerateCode);
		menue.appendChild(menueBox)

		document.body.appendChild(menue);

	// public createElephantUI(session: ISessionContext) {
		// console.log("Creating Elephant UI...");
		
		// let code: string | null = null;
		// Dropdown-Menue für Elephant-Funktionen
		// const dropdownElephantFunction = document.createElement("select");
		// dropdownElephantFunction.id = "elephant-function-select";
		// ["instantaneous_rate", "time_histogram", "correlation_coefficient"].forEach(fn => {
		// 	const option = document.createElement("option");
		// 	option.value = fn;
		// 	option.textContent = fn;
		// 	dropdownElephantFunction.appendChild(option);
		// });
	
		// // Eingabe fuer KeyWord Args
		// const inputKwargs = document.createElement("input");
		// inputKwargs.type ="text";
		// inputKwargs.placeholder = "kwargs fuer Elephant-Funktion";
		// inputKwargs.style.marginLeft = "10px";
	    // inputKwargs.id = "elephant-kwargs-input";

		// // Button zum Starten der Analyse
		// const buttonRunAnalysis = document.createElement("button");
		// buttonRunAnalysis.textContent = "Elephant-Analyse starten";
		// buttonRunAnalysis.style.marginLeft = "10px";
	
		// buttonRunAnalysis.onclick = async () => {
		// 	const functionName = dropdownElephantFunction.value;

		// 	const kwargsString = inputKwargs.value;
		// 	console.log("KWARGS", kwargsString)

		// 	console.log(`Button Clicked - Starte Analyse: ${functionName} mit Kwargs: ${kwargsString}`);
	
		// 	if (!session?.session || !session.session.kernel) {
		// 		console.error("Kernel nicht gefeunden.");
		// 		return;
		// 	}
	
		// 	try {
		// 		await session.ready;
		// 		console.log("Kernel ist bereit");
				
		// 		let code = `
		// 		from jupyphant.kernelcode import get_selected_neo_ids, apply_elephant_analysis
		// 		selected_ids = get_selected_neo_ids(jupyphant_entity)
		// 		kwargs = dict(item.split("=") for item in "${kwargsString}".split(", "))
		// 		apply_elephant_analysis(jupyphant_entity, "${functionName}", selected_ids, **kwargs)
		// 		`;

		// 		if (kwargsString.trim() === "") {
		// 		code = `
		// 			from jupyphant.kernelcode import get_selected_neo_ids, apply_elephant_analysis
		// 			selected_ids = get_selected_neo_ids(jupyphant_entity)
		// 			kwargs = {}
		// 			apply_elephant_analysis(jupyphant_entity, "${functionName}", selected_ids, **kwargs)
		// 		`;
		// 		}

				
		// 		console.log("Sende Anfrage an Kernel...");
		// 		const future = session.session.kernel.requestExecute({ code });
	
		// 		future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
		// 			console.log("Kernel-Antwort erhalten:", msg);
		// 		};		
		// 	} catch (error) {
		// 		console.error("Fehler beim Senden der Anfrage an den Kernel:", error);
		// 	}
		// };
		
		// // Button zur Codegenerierung
		// const buttonGenerateCode = document.createElement("button");
		// buttonGenerateCode.textContent = "Elephant-Code generieren";
		// buttonGenerateCode.style.marginLeft = "10px";
		
		// buttonGenerateCode.onclick = async () => {
		// 	if (code!==null) {
		// 		return;
		// 	}
		// 	console.log(code);
		// };

		// const toolbar = document.getElementById("jp-top-panel");
		// if (toolbar) {
		// 	toolbar.appendChild(dropdownElephantFunction);
		// 	toolbar.appendChild(inputKwargs)
		// 	toolbar.appendChild(buttonRunAnalysis);
		// 	toolbar.appendChild(buttonGenerateCode);
		// } else {
		// 	console.error("Toolbar nicht gefunden!");
		// }

	}
}; // end of JupyphantWidget class




/*
* Activate the JupyphantWidget extension
*/
function activate(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
					render_mime_registry: IRenderMimeRegistry, restorer: ILayoutRestorer) {
	/**
	 * Performs the initialization of the extension
	 * Parameters:
	 *     app: Provides access and allows manipulation of the frontend, i.e., tabs and commands, etc. within JupyterLab
	 *     command_palette: Provides access to the CommandPalette panel on the left side, allowing to add new commands
	 *              that can be activated on click
	 *     notebook_tracker: Used to track notebooks and their actions, e.g., which one is active
	 *     restorer: Allows to restore the previous state of the extension at startup
	 */


	console.log('JupyterLab extension Jupyphant is activated! (OOP)');

	//Track and restore extension's tabs, needs to work together with restoration of main area
	// When Main Area is restored, it needs to get all available Notebooks and Consoles
	// and then check all of them and connect each tab to the right one
	// TODO: This is not yet completed
	// Tracker has a namespace where everything is saved;
	// this namespace needs to have the same name as in the last session
	// to restore the last session
	let widget_tracker = new WidgetTracker<Panel>({ namespace: 'jupyphant_namespace' });

	// create instance of JupyphantExtension
	const jupy_ext = new JupyphantExtension(app, command_palette, notebook_tracker, widget_tracker, render_mime_registry);

	// Add an application command: this is placed into CommandPalette and by clicking on the corresponding button
	// this command will open the jupyphant tab
	const command: string = 'jupyphant:open';
	jupy_ext.createCommand(command);

	// Restore from corresponding namespace
    restorer.restore(widget_tracker, {
		command,
		//args: () => JSONExt.emptyObject,
		name: () => 'jupyphant_namespace'
	});

}; // end of activate()

/*
* Initialization data for the Jupyphant extension
*/
const extension: JupyterFrontEndPlugin<void> = {
	id: 'Jupyphant',
	autoStart: true,
	// What to pass to the activate function
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;
