// Imports for Jupyter
import {
	JupyterFrontEnd,
	JupyterFrontEndPlugin,
	ILayoutRestorer
} from '@jupyterlab/application';

import {
	ICommandPalette,
	ISessionContext,
	SessionContext,
	WidgetTracker,
	MainAreaWidget,
} from '@jupyterlab/apputils';

import {
	INotebookTracker,
	NotebookActions,
	NotebookPanel
} from '@jupyterlab/notebook';

import {
	KernelMessage,
	Kernel
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
	IRenderMimeRegistry,
} from '@jupyterlab/rendermime';
import { WorkflowEngineWidget } from './workflow_engine';
// Lumino imports for dealing with the tabs within JupyterLab
// These are called Panels
import {
	Panel,
	Widget,
	DockPanel
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
import '../style/sidebar.css';
import { KernelBridge } from './kernel_bridge';

export interface IJupyterMessage {
	content: {
		text: string;
	};
}

class JupyphantExtension {
	// declaring members of the class
	private app: JupyterFrontEnd;
	private command_palette: ICommandPalette;
	private notebook_tracker: INotebookTracker;
	private widget_tracker: WidgetTracker<Widget>;
	private myPanels: NotebookPanel[];
	private myVisTabs: Widget[];
	private widget: DockPanel;
	private workflowEngine: WorkflowEngineWidget | null;
	private outarea_content_rasterplot: OutputArea | null;
	private outarea_content_lfpplot: OutputArea | null;
	private outarea_nodeexplorer_info: OutputArea | null;
	private outarea_nodeexplorer_raw: OutputArea | null;
	private outarea_nodeexplorer_statistics: OutputArea | null;
	private outarea_neo_tree: OutputArea | null;
	private output_tabs: DockPanel | null;
	private outarea_workflow: OutputArea | null;
	private kernelBridge: KernelBridge | null;


	// Construct a new JupyphantExtension
	public constructor(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
		widget_tracker: WidgetTracker<Widget>, rendermime: IRenderMimeRegistry) {
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
		this.workflowEngine = null;
		this.outarea_content_rasterplot = null;
		this.outarea_content_lfpplot = null;
		this.outarea_nodeexplorer_info = null;
		this.outarea_nodeexplorer_raw = null;
		this.outarea_nodeexplorer_statistics = null;
		this.outarea_neo_tree = null;
		this.output_tabs = null;
		this.outarea_workflow = null;
		this.kernelBridge = null;
	}; // end of constructor()


	/******************************************************************************************************************/
	// Define utility functions
	/******************************************************************************************************************/
	// Create OutputAreas where Python-Code can be executed
	private async initializeKernelState(session: ISessionContext) {
		console.log("Jupyphant: Initializing kernel state...");
		this.kernelBridge = new KernelBridge(session);

		await this.executeCodeInOutputArea(pythonCode['setupEnv'], this.outarea_neo_tree!, session, false);

		console.log("Jupyphant: Environment setup complete.");
		try {
			// Execute Jupyphant Code to create Neo Tree / Information and Plots  
			await this.executeCodeInOutputArea(pythonCode['createTree'], this.outarea_neo_tree!, session);
			await this.executeCodeInOutputArea(pythonCode['updateTree'], this.outarea_neo_tree!, session, false);
			await this.executeCodeInOutputArea(pythonCode['createExplorerInfo'], this.outarea_nodeexplorer_info!, session);
			await this.executeCodeInOutputArea(pythonCode['createExplorerRawPlot'], this.outarea_nodeexplorer_raw!, session);
			await this.executeCodeInOutputArea(pythonCode['createExplorerStatistics'], this.outarea_nodeexplorer_statistics!, session);
			await this.executeCodeInOutputArea(pythonCode['rasterPlot'], this.outarea_content_rasterplot!, session);
			await this.executeCodeInOutputArea(pythonCode['lfpPlot'], this.outarea_content_lfpplot!, session);
			this.widget.title.label += ' (ready)'; // Indicates that the Jupyphant Extension is completly loaded

			console.log("Jupyphant: Kernel state and UI plots initialized.");
		} catch (error) {
			console.error("Jupyphant: FAILED to initialize kernel state:", error);
		}
	}
	// Command on which to execute Jupyphant Extension
	public createCommand(command: string) {
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
		this.command_palette.addItem({ command, category: 'NeuroScience' });
	} // end of createCommand()


	// Function to react on command 'Jupyphant'
	// Called only after the command is clicked from CommandPalette
	public async newTab() {
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

		console.log("Jupyphant: newTab() started.");
		await this.notebook_tracker.restored;
		console.log("Jupyphant: Notebook tracker restored.");

		// Only execute Jupyphant Extension if a Notebook is currently open
		const newPanel = this.notebook_tracker.currentWidget;
		if (!newPanel) {
			console.error("Jupyphant: No active notebook found.");
			return;
		}

		const workflowId = 'jupyphant-workflow-main-widget';
		const elephantId = 'jupyphant-elephant-analysis-widget';
		const mainWidgets = Array.from(this.app.shell.widgets('main'));
		const workflowWidget = mainWidgets.find(w => w.id === workflowId);
		const elephantWidget = mainWidgets.find(w => w.id === elephantId);

		if (workflowWidget && elephantWidget) {
			console.log("Jupyphant: Existing widgets found, activating them.");
			this.app.shell.activateById(workflowId);
			return;
		}

		console.log("Jupyphant: Creating new Jupyphant instance.");

		// Clear the panel before adding new widgets
		const oldWidgets = Array.from(this.widget.widgets());
		for (const w of oldWidgets) {
			w.dispose();
		}

		this.initializeTab(newPanel.content.rendermime);
		this.myVisTabs.push(this.widget);
		this.myPanels.push(newPanel);
		this.attachTab();

		const initialSession = newPanel.sessionContext;
		await initialSession.ready;
		await this.initializeKernelState(initialSession);

		// Listener for cell execution
		NotebookActions.executed.connect(async (sender, exec_data) => {
			if (exec_data.notebook !== newPanel.content) {
				return;
			}
			console.log("Jupyphant: Cell executed, updating plots.");

			await this.executeCodeInOutputArea(pythonCode['updateTree'], this.outarea_neo_tree!, initialSession, false);
			await this.executeCodeInOutputArea(pythonCode['rasterPlot'], this.outarea_content_rasterplot!, initialSession);
			await this.executeCodeInOutputArea(pythonCode['lfpPlot'], this.outarea_content_lfpplot!, initialSession);
		});

		// Listener for changed Kernel, waits for Kernel to be ready
		newPanel.sessionContext.kernelChanged.connect(async (sender, args) => {
			console.log("Jupyphant: Kernel has changed (restarted).");
			const newKernel = args.newValue;
			if (newKernel) {
				const waitForIdle = new Promise<void>(resolve => {
					if (newKernel.status === 'idle') {
						resolve();
						return;
					}
					const listener = (kernel: Kernel.IKernelConnection, status: KernelMessage.Status) => {
						if (status === 'idle') {
							newKernel.statusChanged.disconnect(listener);
							resolve();
						}
					};
					newKernel.statusChanged.connect(listener);
				});
				await waitForIdle;
				console.log("Jupyphant: New kernel is idle and ready. Re-initializing state.");
			}
		});

		console.log("Jupyphant: Event listeners registered.");
	}

	public attachTab() {
		/**
		  * Attach an existing  to the frontend to display it and add it to a tracker.
		  */

		// Attach tab to the frontend if not yet attached
		if (!this.widget.isAttached) {
			this.app.shell.add(this.widget, 'right', { rank: 300 });
		}
		// Add the tab to the tracker for restoration
		if (!this.widget_tracker.has(this.widget)) {
			// Track the state of the widget for later restoration
			this.widget_tracker.add(this.widget);
		}
		// Display the tab, bring it to the foreground
		this.app.shell.activateById('jupyphant-workflow-main-widget');
	} // end of attachTab()

	public initializeTab(rendermime: IRenderMimeRegistry) {
		/**
		  * Initialize a new tab for this extension.
		  */

		this.widget.addClass('my-jupyphantWidget');
		// Set HTML/DOM id
		this.widget.id = 'jupyphant-right-panel';
		// Title of the tab
		this.widget.title.label = 'Jupyphant';
		// Adds the x to close the tab?
		this.widget.title.closable = true;
		const session = this.notebook_tracker.currentWidget?.sessionContext;
		if (!session) {
			console.error("Jupyphant: No notebook session found during UI initialization!");
			return;
		}

		this.createWidgets(rendermime, session);

	} // end of initializeTab()

	public create_tree_filter(session: ISessionContext, tree_widget: Panel) {
		const neo_obj_filter_dict = {
			"block": "cube",
			"segment": "columns",
			"spiketrain": "braille",
			"analogsignal": "water",
			"epoch": "hourglass",
			"channelview": "eye",
			"group": "object-group",
			"irregularlysampledsignal": "wave-square",
			"spiketrainlist": "bars",
			"event": "map-marker",
			"imagesequence": "images",
			"regionofinterest": "map",
			"circularregionofinterest": "circle",
			"polygonregionofinterest": "draw-polygon",
			"rectangularregionofinterest": "square",
			"open_all": "check",
			"hide_all": "eye-slash"
		}

		const checked_style = {
			color: "#2cbb00ff",
			fontWeight: "bold",
			cursor: "pointer",
			padding: "4px",
			userSelect: "none",
		}

		const unchecked_style = {
			color: "#727272ff",
			fontWeight: "normal",
			cursor: "pointer",
			padding: "4px",
			userSelect: "none",
		}

		const filterContainer = document.createElement('div');
		filterContainer.textContent = "Filter  ";

		Object.keys(neo_obj_filter_dict).forEach(key => {
			const iconName = neo_obj_filter_dict[key as keyof typeof neo_obj_filter_dict];
			const label = document.createElement("label");
			label.dataset.key = key;
			if (key === "open_all") {
				label.dataset.checked = "false";
				Object.assign(label.style, unchecked_style);
			} else {
				label.dataset.checked = "true";
				Object.assign(label.style, checked_style);
			}
			const icon = document.createElement("i");
			icon.className = `fa fa-${iconName}`
			icon.setAttribute("aria-hidden", "true");
			label.prepend(icon);
			label.appendChild(document.createTextNode(`  `));
			label.onclick = () => {
				const isCurrentlyChecked = label.dataset.checked === "true";
				const isNowChecked = !isCurrentlyChecked;
				label.dataset.checked = isNowChecked ? "true" : "false";
				isNowChecked ? Object.assign(label.style, checked_style) : Object.assign(label.style, unchecked_style);
				key === "open_all" ? this.neo_tree_expand(isNowChecked, session) : this.neo_tree_filter(label.dataset.key!, session);
			};

			filterContainer.appendChild(label);
		});
		filterContainer.classList.add('sticky-filter');
		tree_widget.node.prepend(filterContainer);
	}

	public create_raw_plot_options(session: ISessionContext, raw_plot_widget: Panel) {
		const checked_style = {
			color: "#2cbb00ff",
			fontWeight: "bold",
			cursor: "pointer",
			padding: "4px",
			userSelect: "none",
		}

		const unchecked_style = {
			color: "#727272ff",
			fontWeight: "normal",
			cursor: "pointer",
			padding: "4px",
			userSelect: "none",
		}

		const myButtonContainer = document.createElement('div');
		myButtonContainer.classList.add('sticky-filter');

		const myToggle = document.createElement('label');
		myToggle.dataset.checked = 'false';
		Object.assign(myToggle.style, unchecked_style);
		myToggle.innerHTML = `<i class="fa fa-bolt"></i> Overlap`;

		myToggle.onclick = () => {
			const isNowChecked = myToggle.dataset.checked === 'false';
			myToggle.dataset.checked = isNowChecked ? 'true' : 'false';
			isNowChecked ? Object.assign(myToggle.style, checked_style) : Object.assign(myToggle.style, unchecked_style);
			console.log(isNowChecked)
			// Send Python command to flip the boolean
			const code = `
			from jupyphant.kernelcode import set_raw_plot_overlap
			set_raw_plot_overlap(jupyphant_entity, ${isNowChecked ? "True" : "False"})
			`

			// Send to kernel
			const future = session.session!.kernel!.requestExecute({ code, store_history: false });

			// Listen for output / errors
			future.onIOPub = (msg: any) => {
				const msgType = msg.header.msg_type;
				switch (msgType) {
					case "stream":
						console.log("stdout:", msg.content.text);
						break;
					case "error":
						console.error("Python error:", msg.content.ename, msg.content.evalue);
						console.error(msg.content.traceback.join("\n"));
						break;
					case "execute_result":
					case "display_data":
						console.log("Result:", msg.content.data);
						break;
				}
			};
		};

		myButtonContainer.appendChild(myToggle);
		raw_plot_widget.node.prepend(myButtonContainer);
	}

	// Sets up the DragAndDrop Listeners on the Neo Tree Objects 
	public setupDragAndDrop(treeWidget: Panel) {
		const observer = new MutationObserver((mutationsList, observer) => {
			// Selector for the <li> elements that represent each node in the jsTree that hasn't been processed yet
			const treeNodes = treeWidget.node.querySelectorAll('.jstree-node:not([data-dnd-setup="true"])');

			if (treeNodes.length > 0) {
				console.log(`Jupyphant: Found ${treeNodes.length} new jsTree nodes, setting up drag and drop.`);

				treeNodes.forEach(nodeElement => {
					const htmlElement = nodeElement as HTMLElement;
					htmlElement.dataset.dndSetup = 'true'; // Mark as processed

					// Make the entire node row draggable
					htmlElement.draggable = true;

					htmlElement.addEventListener('dragstart', (event) => {
						// Find the anchor tag within the node to get the ID and name
						const anchor = htmlElement.querySelector('.jstree-anchor');
						if (anchor && event.dataTransfer) {
							const nodeName = (anchor.textContent || "").trim();
							const nodeId = htmlElement.id;

							const item = {
								id: nodeId,
								name: nodeName,
								code: nodeId,
								is_class: false,
								parameters: []
							};

							// Set the drag data
							event.dataTransfer.setData('text/plain', JSON.stringify(item));
							console.log(`Dragging node: ${nodeName} (ID: ${nodeId})`);

							// Stop jstree's own handlers from interfering with the drag
							event.stopPropagation();
						}
					});
				});
			}
		});

		// Start observing the tree widget's DOM for changes, and don't disconnect
		observer.observe(treeWidget.node, { childList: true, subtree: true });
	}

	public createWidgets(rendermime: IRenderMimeRegistry, session: ISessionContext) {
		// NEO TREE 
		let tree_widget = new Panel();
		tree_widget.title.label = 'Neo Tree';
		tree_widget.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_neo_tree = this.createOutputArea(rendermime, tree_widget, ['my-outarea-class'], 'jup_vis_out_id_1', session);
		this.create_tree_filter(session, tree_widget);
		this.setupDragAndDrop(tree_widget);

		// NODE EXPLORER
		let explorer_widget = new DockPanel({ tabsMovable: false });
		explorer_widget.title.label = 'Node Explorer';
		explorer_widget.node.style.cssText = explorer_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		// INFO
		let explorer_widget_info = new Panel();
		explorer_widget_info.title.label = 'Info';
		explorer_widget_info.node.style.cssText = explorer_widget_info.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_info = this.createOutputArea(rendermime, explorer_widget_info, ['my-outarea-class'], 'jup_vis_out_id_2.1', session);
		explorer_widget.addWidget(explorer_widget_info);
		// RAW
		let explorer_widget_raw_plot = new Panel();
		explorer_widget_raw_plot.title.label = 'Raw Plot';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_raw = this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class', 'no-left-spacing'], 'jup_vis_out_id_2.2', session);
		explorer_widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
		this.create_raw_plot_options(session, explorer_widget_raw_plot);
		// STATISTICS
		let explorer_widget_statistics = new Panel();
		explorer_widget_statistics.title.label = 'Statistics';
		explorer_widget_statistics.node.style.cssText = explorer_widget_statistics.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_statistics = this.createOutputArea(rendermime, explorer_widget_statistics, ['my-outarea-class'], 'jup_vis_out_id_2.3', session);
		explorer_widget.addWidget(explorer_widget_statistics, { mode: 'tab-after', ref: explorer_widget_raw_plot });

		// ELEPHANT
		let elephant_widget = new Panel();
		elephant_widget.title.label = 'Elephant Analysis';
		elephant_widget.node.style.cssText = elephant_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.createElephantElements(session, elephant_widget, tree_widget);
		const elephantMain = new MainAreaWidget({ content: elephant_widget });
		elephantMain.id = 'jupyphant-elephant-analysis-widget';
		elephantMain.title.label = 'Elephant Analysis';
		elephantMain.title.closable = true;
		this.app.shell.add(elephantMain, 'main');
		if (!this.widget_tracker.has(elephantMain)) {
			this.widget_tracker.add(elephantMain);
		}


		// OUTPUT-TABS (Plot, Error, Output)
		if (!this.output_tabs) {
			const output_tabs = new DockPanel({ tabsMovable: false });
			output_tabs.id = 'jupyphant-output-tabs';
			output_tabs.title.label = 'Output-Area';
			let output_widget_plot = new Panel();
			output_widget_plot.title.label = 'Overview Plots';
			output_widget_plot.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
			this.outarea_content_rasterplot = this.createOutputArea(rendermime, output_widget_plot, ['my-outarea-class'], 'jup_vis_out_id_3.1', session);
			this.outarea_content_lfpplot = this.createOutputArea(rendermime, output_widget_plot, ['my-outarea-class'], 'jup_vis_out_id_3.2', session);

			// Text Output used for Analysis Results
			let output_widget_text = new Panel();
			output_widget_text.title.label = 'Output';
			output_widget_text.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
			this.outarea_workflow = this.createOutputArea(rendermime, output_widget_text, ['my-outarea-class'], 'jup_vis_out_id_3.3', session);

			// Error Output used mainly for debugging 
			// TODO: implement this (if necessary?) 
			let output_widget_error = new Panel();
			output_widget_error.title.label = 'Error';
			output_widget_error.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
			this.createOutputArea(rendermime, output_widget_error, ['my-outarea-class'], 'jup_vis_out_id_3.4', session);

			output_tabs.addWidget(output_widget_plot);
			output_tabs.addWidget(output_widget_text);
			output_tabs.addWidget(output_widget_error);
			this.app.shell.add(output_tabs, 'right', { rank: 400 });
			output_tabs.addClass('my-jupyphantWidget');
			this.output_tabs = output_tabs;
			if (!this.widget_tracker.has(output_tabs)) {
				this.widget_tracker.add(output_tabs);
			}
		}

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget, { mode: 'split-bottom', ref: tree_widget });
		this.workflowEngine = new WorkflowEngineWidget(session, this.outarea_workflow!, this.notebook_tracker, rendermime);
		const main = new MainAreaWidget({ content: this.workflowEngine });
		main.id = 'jupyphant-workflow-main-widget';
		main.title.label = 'Jupyphant Workflow';
		main.title.closable = true;
		this.app.shell.add(main, 'main');
		if (!this.widget_tracker.has(main)) {
			this.widget_tracker.add(main);
		}
		this.app.shell.activateById(main.id);
	}

	public neo_tree_filter(checkbox_id: string, session: ISessionContext) {
		let code = `
			from jupyphant.kernelcode import toggle_neo_tree_objs, update_tree
			toggle_neo_tree_objs(jupyphant_entity, "${checkbox_id}")
			update_tree(jupyphant_entity)
			`
		this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false);
	}

	public neo_tree_expand(checked: boolean, session: ISessionContext) {
		let code = `
			from jupyphant.kernelcode import expand_neo_tree
			# TODO: is there a better way to convert ts bool into python bool?
			if "${checked}" == "true":
				checked = True
			else:
				checked = False
			expand_neo_tree(jupyphant_entity, checked)
			`
		this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false);
	}

	public createElephantElements(session: ISessionContext, elephant_widget: Panel, tree_widget: Panel) {

		// Menue is the main container for the Analysis Windows elements
		const menue = document.createElement("div");
		menue.style.position = "center";
		menue.style.width = "90%";
		menue.style.minWidth = "302px";
		menue.style.maxWidth = "800px";
		menue.style.height = "100%";
		menue.style.backgroundColor = "rgba(0, 0, 0, 0)";
		menue.style.display = "flex";
		menue.style.alignItems = "center";
		menue.style.justifyContent = "center";
		menue.style.zIndex = "1000";

		const menueBox = document.createElement("div");
		menueBox.style.backgroundColor = "rgba(0, 0, 0, 0)";
		menueBox.style.padding = "20px";
		menueBox.style.borderRadius = "8px";
		menueBox.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0)";
		menueBox.style.width = "400px";


		// Radio buttons used for remote and local analysis execution
		const radioContainer = document.createElement("div");

		// Radio button for remote Elephant Analysis
		const remoteRadioButton = document.createElement("input");
		remoteRadioButton.type = "radio";
		remoteRadioButton.name = "location";
		remoteRadioButton.value = "remote";
		const remoteLabel = document.createElement("label");
		remoteLabel.textContent = "Remote";
		remoteLabel.style.marginRight = "20px";
		remoteLabel.prepend(remoteRadioButton);

		// Radio button for local Elephant Analysis
		const localRadioButton = document.createElement("input");
		localRadioButton.type = "radio";
		localRadioButton.name = "location";
		localRadioButton.value = "local";
		localRadioButton.checked = true;
		const localLabel = document.createElement("label");
		localLabel.textContent = "Local";
		localLabel.prepend(localRadioButton);

		radioContainer.appendChild(localLabel);
		radioContainer.appendChild(remoteLabel);

		// function used to change state of radio buttons
		function toggleRadioButtons() {
			if (remoteRadioButton.checked) {
				remoteDiv.style.display = "block";
				localDiv.style.display = "none";
			} else {
				remoteDiv.style.display = "none";
				localDiv.style.display = "block";

			}
		}

		// EventListeners for activating / deactivating radio buttons
		remoteRadioButton.addEventListener("change", () => {
			toggleRadioButtons();
		})

		localRadioButton.addEventListener("change", () => {
			toggleRadioButtons();
		})

		// Local Div is used for grouping elements used for local analysis
		const localDiv = document.createElement("div");
		localDiv.id = "localDiv";

		// Remote Div is used for grouping elements used for local analysis
		const remoteDiv = document.createElement("div");
		remoteDiv.id = "remoteDiv";

		// Result Div used to display output
		// TODO: may be removed due to the existence of Output Container
		const resultDiv = document.createElement("div");
		resultDiv.style.marginTop = "15px";
		resultDiv.style.padding = "10px";
		resultDiv.style.background = "rgba(28, 56, 47, 0.38)";
		resultDiv.style.border = "1px solid #ddd";
		resultDiv.style.borderRadius = "5px";
		resultDiv.style.maxHeight = "200px";
		resultDiv.style.overflowY = "auto";

		// Dropdown Menus for Elephant Module and Function
		const dropdownElephantModule = document.createElement("select");
		dropdownElephantModule.id = "elephant-module-select";

		const dropdownElephantFunction = document.createElement("select");
		dropdownElephantFunction.id = "elephant-function-select";

		const dropdownContainer = document.createElement("div");
		dropdownContainer.style.marginTop = "10px";
		dropdownContainer.appendChild(dropdownElephantModule);
		dropdownContainer.appendChild(dropdownElephantFunction);

		// Button for Code generation in a new Jupyter Cell
		const buttonGenerateCode = document.createElement("button");
		buttonGenerateCode.textContent = "Generate Code";
		buttonGenerateCode.style.marginTop = "10px";
		buttonGenerateCode.style.padding = "10px";
		buttonGenerateCode.style.background = "rgba(104, 33, 203, 1)";
		buttonGenerateCode.style.color = "white";
		buttonGenerateCode.style.border = "none";
		buttonGenerateCode.style.cursor = "pointer";
		buttonGenerateCode.style.width = "100%";

		// Elephant Server Address, only used for remote Analysis
		const inputElephantServerAddress = document.createElement("input");
		inputElephantServerAddress.type = "text";
		inputElephantServerAddress.placeholder = "Server address  (z.B. http://127.0.0.1:5000)";
		inputElephantServerAddress.style.width = "100%";
		inputElephantServerAddress.style.marginBottom = "10px";
		inputElephantServerAddress.value = localStorage.getItem("elephantServer") || "http://127.0.0.1:5000";

		// Button used to either ping server and load functions from there or search for available functions in local installation
		const buttonLoadFunctions = document.createElement("button");
		buttonLoadFunctions.textContent = "Fetch elephant functions";
		buttonLoadFunctions.style.width = "100%";
		buttonLoadFunctions.onclick = async () => {
			await this.loadElephantModules(dropdownElephantModule, dropdownElephantFunction, paramContainer, inputElephantServerAddress.value, remoteRadioButton.checked);

			if (localRadioButton.checked) {
				let code = `
				import elephant
				from importlib.metadata import version, PackageNotFoundError
				try:
					print(version("elephant"))
				except PackageNotFoundError:
					print("nicht installiert")								
				`
				if (!session?.session || !session.session.kernel) {
					console.error("Kernel not found.");
					return;
				}
				let future = session.session.kernel.requestExecute({ code, store_history: false });
				let msg_content: string
				future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
					if (msg.header.msg_type === "stream" && "text" in msg.content)
						msg_content = (msg as IJupyterMessage).content.text;
					buttonRunAnalysisLocal.innerHTML = `run elephant analysis (locally)<br>Current local Elephant Version: "${msg_content.trim()}"`;
				}
				await future.done;
			} else {
				const response = await fetch(`${inputElephantServerAddress.value}`, { method: "GET" });
				const data = await response.json();
				buttonRunAnalysisRemote.innerHTML = `run elephant analysis<br>Current remote Elephant Version: "${data.elephant_version}"`;
			}
		};


		// Button to start remote Analysis
		const buttonRunAnalysisRemote = document.createElement("button");
		buttonRunAnalysisRemote.textContent = "run elephant analysis";
		buttonRunAnalysisRemote.style.marginTop = "10px";
		buttonRunAnalysisRemote.style.padding = "10px";
		buttonRunAnalysisRemote.style.background = "rgb(25, 58, 6)";
		buttonRunAnalysisRemote.style.color = "white";
		buttonRunAnalysisRemote.style.border = "none";
		buttonRunAnalysisRemote.style.cursor = "pointer";
		buttonRunAnalysisRemote.style.width = "100%";
		buttonRunAnalysisRemote.disabled = true;

		buttonRunAnalysisRemote.onclick = async () => {
			const outarea_content_text = this.outarea_workflow!;


			const functionName = dropdownElephantFunction.value;
			const moduleName = dropdownElephantModule.value;

			let params: { [key: string]: any } = {};

			paramContainer.querySelectorAll("input, select").forEach((input) => {
				if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
					console.log(`input: ${input}`)
					console.log(`${input.id}: ${input.value}`);
				}
				const paramName = input.id.replace("param-", "");

				let value: any = (input as HTMLInputElement).value;

				if (!isNaN(value) && value.trim() !== "") {
					value = Number(value);
				} else if (value.toLowerCase() === "true") {
					value = true;
				} else if (value.toLowerCase() === "false") {
					value = false;
				}
				params[paramName] = value;
			});
			// Extract input parameters
			const entriesArray = Object.entries(params)
			const pythonListString = `[${Object.values(entriesArray).map(v => `'${v}'`).join(', ')}]`;

			// Code logic to send data to server using pickle
			let code = `
			import requests
			import pickle
			import neo
			import types
			import json
			from pprint import pprint

			from jupyphant.kernelcode import get_neo_to_hash_dict
			
			def parse_list_to_dict(data_list):
				result_dict = {}
				for item_string in data_list:
					parts = item_string.split(',', 1)
								
					key = parts[0].strip()
									
					if len(parts) > 1 and parts[1].strip():
						value = parts[1].strip()
					else:
						value = ""			
					result_dict[key] = value
					
				return result_dict

			def get_notebook_variable(allowed_types=None):
				g = globals()
				variables = {}

				for name, val in g.items():
					if allowed_types is not None and not isinstance(val, allowed_types):
						continue
					if isinstance(val, types.ModuleType):
						continue
					variables[name] = val
				return variables


			inputObjects = parse_list_to_dict(${pythonListString})
			neo_hash_obj_dict = get_neo_to_hash_dict(jupyphant_entity)
			variables_in_notebook = get_notebook_variable()

			for key, value in inputObjects.items():
				if value in neo_hash_obj_dict:
					jupyphant_result = neo_hash_obj_dict[value]
					inputObjects[key] = jupyphant_result
				elif value in variables_in_notebook.keys():
					jupyphant_result = variables_in_notebook.get(value)
					inputObjects[key] = jupyphant_result
			url = "${inputElephantServerAddress.value}/execute_pickle"
			pickled_data = pickle.dumps(inputObjects)

			text_data = {
				"module_name": "${moduleName}",
				"function_name": "${functionName}"
			}

			binary_data = {
				'params': ('data.pkl', pickled_data, 'application/octet-stream')
			}

			try:
				response = requests.post(url, data=text_data, files=binary_data)
				pprint(f"Server response: {response.text}")

			except requests.exceptions.RequestException as e:
				pprint(f"Ein Verbindungsfehler ist aufgetreten: {e}")
			`
			await this.executeCodeInOutputArea(code, outarea_content_text, session);
		};

		// Ping Server button and check for reachability
		const buttonPingServer = document.createElement("button");
		buttonPingServer.textContent = "Ping server";
		buttonPingServer.style.width = "100%";
		buttonPingServer.style.marginBottom = "10px";
		buttonPingServer.onclick = async () => {
			const serverUrl = inputElephantServerAddress.value;
			localStorage.setItem("elephantServer", serverUrl);
			if (await this.pingElephantServer(serverUrl)) {
				resultDiv.innerHTML = `<b style="color: green;">Server reachable!</b>`;
				buttonRunAnalysisRemote.disabled = false;
				buttonRunAnalysisRemote.style.background = "rgb(59, 201, 95)";
			} else {
				resultDiv.innerHTML = `<b style="color: red;">Server not reachable!</b>`
				buttonRunAnalysisRemote.disabled = true;
			}
		};

		// Button to start local Analysis
		const buttonRunAnalysisLocal = document.createElement("button");
		buttonRunAnalysisLocal.textContent = "run elephant analysis (locally)";
		buttonRunAnalysisLocal.style.marginTop = "10px";
		buttonRunAnalysisLocal.style.padding = "10px";
		buttonRunAnalysisLocal.style.background = "rgb(59, 201, 95)";
		buttonRunAnalysisLocal.style.color = "white";
		buttonRunAnalysisLocal.style.border = "none";
		buttonRunAnalysisLocal.style.cursor = "pointer";
		buttonRunAnalysisLocal.style.width = "100%";

		buttonRunAnalysisLocal.onclick = async () => {
			const outarea_content_text = this.outarea_workflow!;

			const functionName = dropdownElephantFunction.value;
			const moduleName = dropdownElephantModule.value;

			let params: { [key: string]: any } = {};

			paramContainer.querySelectorAll("input, select").forEach((input) => {
				if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
					console.log(`input: ${input}`)
					console.log(`${input.id}: ${input.value}`);
				}
				const paramName = input.id.replace("param-", "");

				let value: any = (input as HTMLInputElement).value;

				if (!isNaN(value) && value.trim() !== "") {
					value = Number(value);
				} else if (value.toLowerCase() === "true") {
					value = true;
				} else if (value.toLowerCase() === "false") {
					value = false;
				}
				params[paramName] = value;
			});

			// Extract input parameters
			const entriesArray = Object.entries(params)
			const pythonListString = `[${Object.values(entriesArray).map(v => `'${v}'`).join(', ')}]`;
			let methods_to_execute: Array<string> = [];
			const methodSelect = paramContainer.querySelector("#method-select") as HTMLSelectElement;

			if (methodSelect && methodSelect.value && methodSelect.value !== "Select a method...") {
				methods_to_execute.push(methodSelect.value.toLowerCase());
			}

			let code = `
			import requests
			import pickle
			import neo
			import types
			import json

			from jupyphant.kernelcode import get_neo_to_hash_dict
			elephant_objs = []
			
			def parse_list_to_dict(data_list):
				result_dict = {}
				for item_string in data_list:
					parts = item_string.split(',', 1)
								
					key = parts[0].strip()
									
					if len(parts) > 1 and parts[1].strip():
						value = parts[1].strip()
					else:
						value = ""			
					result_dict[key] = value
					
				return result_dict

			def get_notebook_variable(allowed_types=None):
				g = globals()
				variables = {}

				for name, val in g.items():
					if allowed_types is not None and not isinstance(val, allowed_types):
						continue
					if isinstance(val, types.ModuleType):
						continue
					variables[name] = val
				return variables


			inputObjects = parse_list_to_dict(${pythonListString})
			neo_hash_obj_dict = get_neo_to_hash_dict(jupyphant_entity)
			variables_in_notebook = get_notebook_variable()

			for key, value in inputObjects.copy().items():
				if key.lower().startswith('method'):
					inputObjects.pop(key)
				elif value in neo_hash_obj_dict:
					jupyphant_result = neo_hash_obj_dict[value]
					inputObjects[key] = jupyphant_result
				elif value in variables_in_notebook.keys():
					jupyphant_result = variables_in_notebook.get(value)
					inputObjects[key] = jupyphant_result
				else: inputObjects[key] = None
			methods_to_execute = ${JSON.stringify(methods_to_execute)} 
			if (methods_to_execute):
				method_parts = []
				try:
					object_name = "${moduleName}.${functionName}(**inputObjects)"
					for method_name in methods_to_execute:
						method_parts.append(f".{method_name}()")
					chained_call_string = object_name + "".join(method_parts)
					result = eval(chained_call_string)
					elephant_objs.append(result)
					print(result)

				except requests.exceptions.RequestException as e:
					print(f"Ein Verbindungsfehler ist aufgetreten: {e}")
			else:
				try:
					object_name = f"${moduleName}.${functionName}(**inputObjects)" 
					try:
						result = eval(object_name)
						elephant_objs.append(result)
						print(result)
					except:
						object_name = f"${moduleName}.${functionName}" 
						elephant_objs.append(object_name)
						print(object_name)
				except requests.exceptions.RequestException as e:
					print(f"Ein Verbindungsfehler ist aufgetreten: {e}")
			`
			await this.executeCodeInOutputArea(code, outarea_content_text, session);

			if (!session?.session || !session.session.kernel) {
				console.error("Kernel not found.");
				return null;
			}

			let my_code =
				`
			import elephant
			import json
			import pickle
			
			elephant_object = globals()["elephant_objs"]
			object_list = []
			object_list.append({
							"id": elephant_object.__class__.__name__, 
							"name": f"{elephant_object}",
							"is_class": True,
							"code": f"{pickle.dumps(elephant_object)}"
			})
			print(json.dumps(object_list))
			`

			const future = session.session.kernel.requestExecute({ code: my_code, store_history: false });
			let msg_content: string
			future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
				if (msg.header.msg_type === "stream" && "text" in msg.content) {
					msg_content = (msg as IJupyterMessage).content.text.replace("\n", "");
					this.workflowEngine!.updateItems(JSON.parse(msg_content));
				}
			}
			await future.done;
		}


		const paramContainer = document.createElement("div");
		paramContainer.style.marginTop = "10px";
		paramContainer.innerHTML = "";

		// TODO: maybe unnecessary -> change to onChange Listener on Functions dropdown in order to remove one button (better for user)
		const fetchParamsButton = document.createElement("button");
		fetchParamsButton.textContent = "Retrieve parameter"
		fetchParamsButton.onclick = async () => {
			if (dropdownElephantFunction.value === "") {
				return;
			}

			const moduleName = dropdownElephantModule.value;
			const functionName = dropdownElephantFunction.value;
			const response = await fetch(`${inputElephantServerAddress.value}/get_model_schema/${moduleName}.${functionName}`)
			const data = await response.json();
			// create input fields with default parameter and description
			this.createInputFields(data, paramContainer, session);

		};

		buttonGenerateCode.onclick = async () => {
			let selected_elephant_module = dropdownElephantModule.value;
			let selected_elephant_function = dropdownElephantFunction.value;

			if (!selected_elephant_module && !selected_elephant_function) {
				return;
			}

			const paramArray = Array.from(paramContainer.children).map(async child => {
				let param = child.querySelector('.form-row-input') as HTMLInputElement | HTMLSelectElement;
				if (param.value !== "") {
					try {
						await session.ready;
						if (!session?.session || !session.session.kernel) {
							console.error("Kernel not found.");
							return null;
						}
						console.log(`Param Value: ${param.value.trim()}`);
						let code = `
						import types
						from jupyphant.kernelcode import get_neo_obj_from_id
						
						jupyphant_neo_obj = get_neo_obj_from_id(jupyphant_entity, "${param.value}")
						variables_in_notebook = globals().copy().items()
						if jupyphant_neo_obj is not None:
							matches = []
							for key, jupyphant_value in variables_in_notebook:
								if jupyphant_neo_obj is jupyphant_value:
									matches.append(key)
							
							if matches:
								non_jupyphant_keys = [k for k in matches if not k.startswith("jupyphant")]
								if non_jupyphant_keys:
									print(non_jupyphant_keys[0])
								else:
									print(matches[0])
						`;

						let future = session.session.kernel.requestExecute({ code, store_history: false });

						const outputPromise = new Promise<string | null>((resolve, reject) => {
							future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
								if (msg.header.msg_type === 'stream' && "text" in msg.content) {
									const streamMsg = msg as KernelMessage.IStreamMsg;
									resolve(streamMsg.content.text);
								} else {
									console.log(msg);
								}
							};

							future.done.then(() => {
								resolve(null);
							}).catch(err => {
								reject(err);
							});
						});

						const kernelOutput = await outputPromise;
						console.log(`Kernel output was: ${kernelOutput}`);

						return kernelOutput ? kernelOutput.trim() : param.value;

					} catch (error) {
						console.error("Fehler beim Senden der Anfrage an den Kernel:", error);
						return null;
					}
				}
				return null;
			})
			console.log(selected_elephant_module, selected_elephant_function, paramArray);

			const resolvedValues = await Promise.all(paramArray);
			const paramValues = resolvedValues.filter(value => value !== null) as string[];

			let currentNotebook = this.notebook_tracker.currentWidget?.content;
			if (!currentNotebook) {
				return;
			}
			NotebookActions.insertBelow(currentNotebook);
			const activeCell = currentNotebook.activeCell;

			if (activeCell) {
				activeCell.model.sharedModel.setSource(`# Code generated using Elephant-Interface\n${selected_elephant_module}.${selected_elephant_function}(${[...paramValues]})`);
			}

		}

		// Cobble together the Frontend
		menueBox.appendChild(radioContainer);
		menueBox.appendChild(buttonLoadFunctions);
		menueBox.appendChild(dropdownContainer);
		menueBox.appendChild(localDiv);
		menueBox.appendChild(remoteDiv);
		menueBox.appendChild(resultDiv);
		menueBox.appendChild(buttonGenerateCode);
		menue.appendChild(menueBox);


		remoteDiv.appendChild(inputElephantServerAddress);
		remoteDiv.appendChild(buttonPingServer);
		remoteDiv.appendChild(fetchParamsButton);
		remoteDiv.appendChild(paramContainer);
		remoteDiv.appendChild(buttonRunAnalysisRemote);

		localDiv.appendChild(buttonRunAnalysisLocal);
		localDiv.appendChild(paramContainer);

		toggleRadioButtons();

		const menuWidget = new Widget();
		menuWidget.node.appendChild(menueBox);
		elephant_widget.addWidget(menuWidget);
	}


	public createOutputArea(rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string, session: ISessionContext): OutputArea {
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
		let model = new OutputAreaModel({ trusted: true });
		let outarea = new OutputArea({ rendermime, model });
		// Add OutputArea to the specified tab
		tab.addWidget(outarea);
		// Set HTML/DOM id and classes
		outarea.id = id;
		for (let currCls of cls) {
			outarea.addClass(currCls);
		}
		return outarea;
	}

	//@ts-ignore
	public registerComm(name: string, context: SessionContext) {
		/**
		  * Registers a communication channel that allows sending messages
		  * back and forth between the TypeScript code and the IPython session, i.e., the Python kernel
		  * name: Name of the channel
		  * session: IPython session (Python kernel) to communicate with
		  */
		//TODO: Remove hardcoded stuff
		console.log("Communication channel created")
		// Registers something like a callback that acts when the kernel sends a message

		if (context.session?.kernel == null) {
			return;
		}

		context.session.kernel.registerCommTarget('test2', (comm: any, commMsg: any): any => {
			// Only react if the message is sent to the channel/target named 'test2'
			if (commMsg.content.target_name !== 'test2') {
				return;
			}
			// React to the message
			// Callback that deals with the message
			comm.onMsg = (msg: any) => {
				var c = msg.buffers[0].buffer;
				c;
				console.log("Message received");
				//console.log(c[0]);
				//console.log("MEEESSSAAAGGEEE ", msg.buffers[0]);
				//console.log(new Float32Array(msg.buffers[0].buffer));
			};
			// Callback that reacts to closing of the communication channel (possibly by the Python kernel)
			comm.onClose = (msg: any) => { };
		});
	} // end of registerComm()

	/**
	 * Executes a code snippet in a designated OutputArea and displays the results.
	 *
	 * @param code The string of code to be executed by the kernel.
	 * @param outputArea The Jupyter OutputArea widget where the execution results will be displayed.
	 * @param sessionContext The session context, used to access the active kernel session.
	 * @param showOutput A boolean flag that determines whether to display the output. Defaults to `true`.
	 * @private
	 */
	private async executeCodeInOutputArea(code: string, outputArea: OutputArea, sessionContext: ISessionContext, showOutput: boolean = true) {
		const kernel = sessionContext.session?.kernel;
		if (!kernel) {
			console.error("Kernel not available for execution.");
			return;
		}

		let output = await this.kernelBridge?.executeCode(code, true);

		if (output && showOutput) {
			this.handleOutputs(output.outputs, outputArea);
		}
	}

	private handleOutputs(outputs: any[], outputArea: OutputArea) {
		outputArea.model.clear();
		for (const output of outputs) {
			if (output.output_type === 'clear_output') {
				outputArea.model.clear(false);
			} else {
				outputArea.model.add(output);
			}
		}
	}


	public async pingElephantServer(serverUrl: string): Promise<boolean> {
		try {
			const response = await fetch(`${serverUrl}`, { method: "GET" });
			console.log(response.ok);
			return true;
		} catch (error) {
			console.error(`Error while pinging the server ${serverUrl}!:`, error);
			return false;
		}
	}

	// Load Elephant Modules either locally or remotely
	// TODO: change function as many things are passed and depending on use case
	public async loadElephantModules(elephant_modules_dropdown: HTMLSelectElement, elephant_functions_dropdown: HTMLSelectElement, paramContainer: HTMLDivElement, serverUrl: string, remote: Boolean = false) {
		console.log("Loading Elephant modules");
		// load elephant modules from remote server
		if (remote) {
			try {
				let response = await fetch(`${serverUrl}/get_elephant_modules`);
				if (!response.ok) {
					throw new Error(`Error: Server responded with: ${response.status}`);
				}

				let server_response: string[] = await response.json();
				console.log(server_response)
				this.createElephantDropdowns(elephant_modules_dropdown, server_response);

				elephant_modules_dropdown.onchange = async () => {
					response = await fetch(`${serverUrl}/get_elephant_functions/${elephant_modules_dropdown.value}`);
					server_response = await response.json()
					console.log(server_response)
					this.updateFunctionDropdown(elephant_functions_dropdown, server_response)
				}

			} catch (error) {
				console.error("Error getting elephant functions:", error);
				elephant_modules_dropdown.innerHTML = "<option>error on loading</option>";
			}
			// load elephant modules from local elephant installation
		} else {
			var newPanel = this.notebook_tracker.currentWidget as NotebookPanel;
			var session: ISessionContext = newPanel.sessionContext as unknown as ISessionContext;

			if (!session?.session || !session.session.kernel) {
				console.error("Kernel not found.");
				return;
			}

			// get elephant modules
			let code = `
			import sys
			modules = [
			name
			for name in sys.modules
			if name == "elephant" or name.startswith("elephant.")
			]
			print(modules)
			`
			let future = session.session.kernel.requestExecute({ code, store_history: false });
			let msg_content: string
			future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
				if (msg.header.msg_type === "stream" && "text" in msg.content)
					msg_content = (msg as IJupyterMessage).content.text;
				let validJsonString = msg_content.replace(/'/g, '"');
				let stringArray: string[] = JSON.parse(validJsonString);
				this.createElephantDropdowns(elephant_modules_dropdown, stringArray);
			}
			await future.done;


			elephant_modules_dropdown.onchange = async () => {
				// get elephant functions
				code = `
				import sys
				import inspect
				
				def is_function_or_class(obj):
					return inspect.isfunction(obj) or inspect.isclass(obj)

				module = sys.modules.get("${elephant_modules_dropdown.value}")
				if module is None:
					raise ValueError("Elephant-Module not found")

				function_names = [
					name
					for name, obj in inspect.getmembers(module, is_function_or_class)
					if not name.startswith("_")
				]
				print(function_names)
				
			`
				if (!session?.session || !session.session.kernel) {
					console.error("Kernel not found.");
					return;
				}
				future = session.session.kernel.requestExecute({ code, store_history: false });
				future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
					if (msg.header.msg_type === "stream" && "text" in msg.content)
						msg_content = (msg as IJupyterMessage).content.text;
					let validJsonString = msg_content.replace(/'/g, '"');
					let stringArray: string[] = JSON.parse(validJsonString);
					console.log("FUNCTIONS: " + stringArray);
					this.updateFunctionDropdown(elephant_functions_dropdown, stringArray);
				}
				await future.done;
			};


			elephant_functions_dropdown.onchange = async () => {
				if (paramContainer.children.length > 0) {
					paramContainer.innerHTML = "";
				}
				console.log(`${elephant_modules_dropdown.value}.${elephant_functions_dropdown.value}`);

				let function_name_to_pydantic_name = elephant_functions_dropdown.value.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
				console.log(`function_name_to_pydantic_name ${function_name_to_pydantic_name}`);
				let code = `
				from elephant import schemas
				import json

				schema_data = schemas.schema_${elephant_modules_dropdown.value.replace("elephant.", "")}.Pydantic${function_name_to_pydantic_name}.model_json_schema()

				if isinstance(schema_data, str):
					try:
						schema_dict = json.loads(schema_data)
					except json.JSONDecodeError:
						print(json.dumps({"error": "Invalid JSON schema"}))
						schema_dict = {}
				else:
					schema_dict = schema_data


				def get_separated_properties(schema_dict):
					main_props = schema_dict.get('properties', {})
					definitions = schema_dict.get('$defs', {})
					
					output = {
						"init_params": {},
						"instance_methods": {}
					}

					if 'is_class_model' not in main_props:
						output["init_params"] = main_props
						print(json.dumps(output))
						return

					for prop_name, prop_schema in main_props.items():
						
						if prop_name == 'constructor' and '$ref' in prop_schema:
							try:
								def_name = prop_schema['$ref'].split('/')[-1]
								referenced_model_schema = definitions[def_name]
								init_properties = referenced_model_schema.get('properties', {})
								output["init_params"].update(init_properties)
								
							except (KeyError, IndexError):
								pass
						
						elif prop_name not in ('constructor', 'is_class_model'):
							output["instance_methods"][prop_name] = prop_schema
							
					print(json.dumps(output))

				get_separated_properties(schema_dict)
				`
				if (!session?.session || !session.session.kernel) {
					console.error("Kernel not found.");
					return;
				}
				future = session.session.kernel.requestExecute({ code, store_history: false });
				let data: unknown;
				future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
					if (msg.header.msg_type === "stream" && "text" in msg.content) {
						data = JSON.parse((msg as IJupyterMessage).content.text);
						console.log("PARAMS: " + data)
						console.log("PARAMS_type: " + typeof data)

					}
				}
				await future.done.then(() => {
					this.createInputFields(data, paramContainer, session);
				})
			};

		}

	}

	public createInputFields(data: any, paramContainer: HTMLDivElement, session: ISessionContext) {
		if (!data) {
			paramContainer.innerHTML = '<p style="color: red;">Error: Could not load parameters for the selected function. The data object is undefined.</p>';
			console.error("createInputFields was called with undefined 'data'. This might happen if the Python script for fetching the schema failed to produce output.");
			return;
		}
		const params = data.init_params || data;

		const methods = data.instance_methods || null;
		// remove existing parameter input fields
		for (const [key, value] of Object.entries(params as Record<string, any>)) {
			console.log(`KEY: ${key}, VALUE: ${value}`)
			const row = document.createElement("div");
			row.className = "form-row";

			console.log("Key:", key, "Value:", value, "type:", value.type);

			const label = document.createElement("label");
			// TODO: Separation of concerns -> style into css
			label.innerHTML = `<br><span style="color: LightSkyBlue; font-weight: bold;">${value.title || key}</span><br>
				<span style="color: LightSlateGrey;">\n${value.description || ""}</span>`;

			let input: HTMLInputElement | HTMLSelectElement;

			// different input fields for different types of data
			// TODO: input default values from pydantic models
			if (value.type === "integer" || value.type === "number") {
				input = document.createElement("input");
				input.type = "range";
				input.min = "0";
				input.max = "100";
				input.step = "1";
				input.value = value.default ?? "50";

			} else if (value.type === "string") {
				input = document.createElement("input");
				input.type = "text";
				input.placeholder = value.default ? `default: ${value.default}` : "";
				input.addEventListener("dragover", (event) => {
					event.preventDefault();
				});
				input.addEventListener("drop", async (event) => {
					event.preventDefault();
					const itemString = event.dataTransfer?.getData('text/plain');
					if (!itemString) {
						return;
					}
					try {
						const item = JSON.parse(itemString);
						const nodeId = item.id;
						if (!session?.session || !session.session.kernel) {
							console.error("Kernel not found.");
							return;
						}
						let code = `
							node_id = "${nodeId}"
							neo_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
							if neo_hash:
								print(neo_hash)
							`;
						const future = session.session.kernel.requestExecute({ code, store_history: false });
						let msg_content: string
						future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
							if (msg.header.msg_type === "stream" && "text" in msg.content)
								msg_content = (msg as IJupyterMessage).content.text.replace("\n", "");
							console.log(msg_content);
							input.value = msg_content;
						}
						await future.done;
					} catch (e) {
						console.error("Failed to handle drop", e)
					}
				});

			} else if (value.type === "boolean") {
				input = document.createElement("select");
				const trueOption = document.createElement("option");
				trueOption.value = "true";
				trueOption.textContent = "True";
				const falseOption = document.createElement("option");
				falseOption.value = "false";
				falseOption.textContent = "False";
				input.appendChild(trueOption);
				input.appendChild(falseOption);

			} else {
				input = document.createElement("input");
				input.type = "text";
				console.log("value.default: " + value.default)
				input.placeholder = value.default ? `default: ${value.default}` : "";
				input.addEventListener("dragover", (event) => {
					event.preventDefault();
				});
				input.addEventListener("drop", async (event) => {
					event.preventDefault();
					const itemString = event.dataTransfer?.getData('text/plain');
					if (!itemString) {
						return;
					}
					try {
						const item = JSON.parse(itemString);
						const nodeId = item.id;
						if (!session?.session || !session.session.kernel) {
							console.error("Kernel not found.");
							return;
						}
						let code = `
							node_id = "${nodeId}"
							neo_hash = jupyphant_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
							if neo_hash:
								print(neo_hash)
							`;
						const future = session.session.kernel.requestExecute({ code, store_history: false });
						let msg_content: string
						future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
							if (msg.header.msg_type === "stream" && "text" in msg.content)
								msg_content = (msg as IJupyterMessage).content.text.replace("\n", "");
							console.log(msg_content);
							input.value = msg_content;
						}
						await future.done;
					} catch (e) {
						console.error("Failed to handle drop", e)
					}
				});
			}

			for (const entry of Object.entries(data.init_params[key])) {
				if (entry[0] !== "description" && entry[0] !== "default" && entry[0] !== "title") {
					if (input instanceof HTMLInputElement) {
						input.placeholder += (entry[0] ? ` ${entry[0]}: ${entry[1]}` : "");
					} else if (input instanceof HTMLSelectElement) {
						input.title = input.title + (value.default ?? "") + (entry[0] ? ` ${entry[0]}: ${entry[1]}` : "");
					}
				}
			}

			input.id = `param-${key}`;
			input.className = "form-row-input";
			row.appendChild(label);
			row.appendChild(input);
			paramContainer.appendChild(row);
		}

		if (methods && Object.keys(methods).length > 0) {

			const row = document.createElement("div");
			row.className = "form-row";

			const label = document.createElement("label");
			label.innerHTML = `<br><span style="color: LightSkyBlue; font-weight: bold;">Method</span><br>
    		<span style="color: LightSlateGrey;">\nSelect a method to execute</span>`;

			const select = document.createElement("select");
			select.id = "method-select";
			select.className = "form-row-input";

			const defaultOption = document.createElement("option");
			defaultOption.value = "";
			defaultOption.textContent = "Select a method...";
			defaultOption.selected = true;
			select.appendChild(defaultOption);


			for (const [key, value] of Object.entries(methods as Record<string, any>)) {
				const option = document.createElement("option");
				option.id = `method-${key}`;
				option.value = key;
				option.textContent = value.title || key;
				select.appendChild(option);
			}
			row.appendChild(label);
			row.appendChild(select);
			paramContainer.appendChild(row);
		}
	}

	// Helper function to create Module Dropdown
	public createElephantDropdowns(elephant_modules_dropdown: HTMLSelectElement, elephantModules: string[]) {
		console.log("Creating Dropdowns for modules & functions...");

		elephant_modules_dropdown.id = "elephant-module-select";
		elephant_modules_dropdown.style.width = "100%";
		elephant_modules_dropdown.innerHTML = "<option>Choose a module...</option>";

		Object.values(elephantModules).forEach((moduleName) => {
			const option = document.createElement("option");
			option.value = moduleName;
			option.textContent = moduleName;
			elephant_modules_dropdown.appendChild(option);
		});
	}

	// Function used in EventListener to update Functions according to module
	public updateFunctionDropdown(dropdown: HTMLSelectElement, elephant_functions: string[]) {
		dropdown.id = "elephant-function-select";
		dropdown.style.width = "100%";
		dropdown.innerHTML = "<option>Choose a function...</option>";
		console.log(`Loading functions from module: ${dropdown.value}`);

		dropdown.innerHTML = "<option>Choose a function...</option>";

		Object.values(elephant_functions).forEach((funcName) => {
			const option = document.createElement("option");
			option.value = funcName;
			option.textContent = funcName;
			dropdown.appendChild(option);
		});
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
	let widget_tracker = new WidgetTracker<Widget>({ namespace: 'jupyphant_namespace' });

	// create instance of JupyphantExtension
	const jupy_ext = new JupyphantExtension(app, command_palette, notebook_tracker, widget_tracker, render_mime_registry);

	// Add an application command: this is placed into CommandPalette and by clicking on the corresponding button
	// this command will open the jupyphant tab
	const command: string = 'jupyphant:open';
	jupy_ext.createCommand(command);

	// Restore from corresponding namespace
	restorer.restore(widget_tracker, {
		command,
		name: widget => 'jupyphant:' + widget.id
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
