// Imports for Jupyter
import {
	JupyterFrontEnd,
	JupyterFrontEndPlugin,
	ILayoutRestorer
} from '@jupyterlab/application';

import {
	ICommandPalette,
	ISessionContext,
	WidgetTracker,
	showDialog,
	Dialog
} from '@jupyterlab/apputils';

import {
	IDocumentManager
} from '@jupyterlab/docmanager';

import { FileDialog } from '@jupyterlab/filebrowser';

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
// Lumino imports for dealing with the tabs within JupyterLab
// These are called Panels
import {
	Panel,
	Widget,
	DockPanel
} from '@lumino/widgets';

// Own imports
// Python Code to execute in the kernel
import {
	pythonCode
} from './kernelcode';
// Style from css
import '../style/index.css';
import '../style/sidebar.css';
import { KernelBridge } from './kernel_bridge';
import { COLORS } from "./style/colors";

class JupyphantExtension {
	// declaring members of the class
	private app: JupyterFrontEnd;
	private command_palette: ICommandPalette;
	private notebook_tracker: INotebookTracker;
	private widget_tracker: WidgetTracker<Widget>;
	private myPanels: NotebookPanel[];
	private myVisTabs: Widget[];
	private widget: DockPanel;
	private _updateTimer: number | null = null;
	private outarea_content_rasterplot: OutputArea | null;
	private outarea_content_lfpplot: OutputArea | null;
	private outarea_nodeexplorer_info: OutputArea | null;
	private outarea_nodeexplorer_raw: OutputArea | null;
	private outarea_nodeexplorer_statistics: OutputArea | null;
	private outarea_neo_tree: OutputArea | null;
	private output_tabs: DockPanel | null;
	private docManager: IDocumentManager;
	private kernelBridge: KernelBridge | null;
	private topBar: Widget | null = null;


	// Construct a new JupyphantExtension
	public constructor(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
		widget_tracker: WidgetTracker<Widget>, rendermime: IRenderMimeRegistry, docManager: IDocumentManager) {
		// save all constructor arguments
		this.app = app;
		this.command_palette = command_palette;
		this.notebook_tracker = notebook_tracker;
		this.widget_tracker = widget_tracker;
		this.docManager = docManager;
		// Store references to all tabs containing notebooks
		this.myPanels = [];
		// Store references to all tabs created by this extension
		this.myVisTabs = [];
		// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
		this.widget = new DockPanel({ tabsMovable: false });
		this.outarea_content_rasterplot = null;
		this.outarea_content_lfpplot = null;
		this.outarea_nodeexplorer_info = null;
		this.outarea_nodeexplorer_raw = null;
		this.outarea_nodeexplorer_statistics = null;
		this.outarea_neo_tree = null;
		this.output_tabs = null;
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
	public async newTab(force: boolean = false) {
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

		if (!force && this.widget.isAttached) {
			console.log("Jupyphant: Existing widgets found, activating them.");
			this.app.shell.activateById(this.widget.id);
			return;
		}

		console.log("Jupyphant: Creating new Jupyphant instance.");

		// Clear the panel before adding new widgets
		const oldWidgets = Array.from(this.widget.widgets());
		for (const w of oldWidgets) {
			w.dispose();
		}
		if (this.output_tabs) {
			this.output_tabs.dispose();
			this.output_tabs = null;
		}

		this.initializeTab(newPanel.content.rendermime);
		this.myVisTabs.push(this.widget);
		this.myPanels.push(newPanel);
		this.attachTab();

		const initialSession = newPanel.sessionContext;
		await initialSession.ready;
		await this.initializeKernelState(initialSession);

		// Listener for cell execution
		NotebookActions.executed.connect((sender, exec_data) => {
			if (exec_data.notebook !== newPanel.content) {
				return;
			}
			console.log("Jupyphant: Cell executed, updating plots.");

			if (this._updateTimer) {
				window.clearTimeout(this._updateTimer);
			}
	
			this._updateTimer = window.setTimeout(async () => {
				await this.executeCodeInOutputArea(pythonCode['updateTree'], this.outarea_neo_tree!, initialSession, false);
				await this.executeCodeInOutputArea(pythonCode['rasterPlot'], this.outarea_content_rasterplot!, initialSession);
				await this.executeCodeInOutputArea(pythonCode['lfpPlot'], this.outarea_content_lfpplot!, initialSession);
			}, 500);
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
		this.app.shell.activateById(this.widget.id);
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

	public createTopBar(session: ISessionContext) {
		if (this.topBar) {
			this.topBar.dispose();
		}

		const currentFilename = session.path.split('/').pop() || "Unknown Notebook";

		const switchNotebookButton = document.createElement('button');
		switchNotebookButton.innerHTML = `${currentFilename} <i class="fa fa-exchange" aria-hidden="true"></i>`;
		switchNotebookButton.title = 'Switch Jupyphant to current active notebook';
		switchNotebookButton.style.backgroundColor = COLORS["Orange"];
		switchNotebookButton.className = 'workflow-button workflow-button-io';
		switchNotebookButton.style.marginRight = '5px';
		switchNotebookButton.onclick = () => {
			this.newTab(true);
		};

		session.propertyChanged.connect((sender, prop) => {
			if (prop === 'path') {
				const newFilename = sender.path.split('/').pop() || "Unknown Notebook";
				switchNotebookButton.innerHTML = `${newFilename} <i class="fa fa-exchange" aria-hidden="true"></i>`;
			}
		});

		const infoButton = document.createElement('button');
		infoButton.innerHTML = 'About Jupyphant <i class="fa fa-info-circle" aria-hidden="true"></i>';
		infoButton.title = 'About Jupyphant';
		infoButton.style.backgroundColor = COLORS["Bright Blue"];
		infoButton.className = 'workflow-button workflow-button-io';
		infoButton.onclick = () => {
			const body = document.createElement('div');
			body.style.textAlign = 'center';
			// TODO: hardcoded version number
			body.innerHTML = `
				<p>You are using Jupyphant Version 0.1.0</p>
				<img src="https://user-images.githubusercontent.com/56024817/227979272-bfdf6c7e-4102-4990-9f7e-08108616459d.png" alt="Jupyphant Logo" style="width: 400px; margin-top: 10px;">
			`;
			showDialog({
				title: 'About Jupyphant',
				body: new Widget({ node: body }),
				buttons: [Dialog.okButton()]
			});
		};

		const container = document.createElement('div');
		container.style.display = 'flex';
		container.style.alignItems = 'center';
		container.style.padding = '2px';
		container.appendChild(switchNotebookButton);
		container.appendChild(infoButton);

		this.topBar = new Widget();
		this.topBar.node.appendChild(container);
		this.topBar.id = 'jupyphant-top-bar';
		this.topBar.node.style.marginLeft = 'auto';

		this.app.shell.add(this.topBar, 'top', { rank: 1000 });
	}

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
		
		const loadNeoFileButton = document.createElement('button');
		loadNeoFileButton.innerHTML = 'Load <i class="fa fa-file-import" aria-hidden="true"></i>';
        loadNeoFileButton.title = 'Create a neoIO for given Path';
		loadNeoFileButton.style.backgroundColor = COLORS["Teal"]
        loadNeoFileButton.className = 'workflow-button workflow-button-io';
		loadNeoFileButton.onclick = () => {
			FileDialog.getOpenFiles({
				manager: this.docManager
			}).then(result => {
				if (result.button.accept && result.value && result.value.length > 0) {
					const selectedFile = result.value[0];
					const filePath = selectedFile.path;
	
					const body = document.createElement('div');
					const input = document.createElement('input');
					input.className = 'jp-input';
					input.placeholder = 'e.g. Spike2IO';
					body.appendChild(input);
	
					showDialog({
						title: 'Enter neo IO class',
						body: new Widget({ node: body }),
						buttons: [
							Dialog.cancelButton(),
							Dialog.okButton({ label: 'OK' }),
							Dialog.createButton({ label: 'Automatic' })
						],
						hasClose: true
					}).then(async dialogResult => {
						let ioClass: string | null = null;
						if (dialogResult.button.label === 'OK') {
							ioClass = input.value;
						} else if (dialogResult.button.label === 'Automatic') {
							ioClass = await this.kernelBridge!.getNeoIOClass(filePath);
						}
	
						if (ioClass !== null) {
							const getVarsCode = `import json, __main__; print(json.dumps(list(__main__.__dict__.keys())))`;
							const varsResult = await this.kernelBridge!.executeCode(getVarsCode, true);
							let allVars: string[] = [];
							if (varsResult && varsResult.outputs.length > 0) {
								const output = varsResult.outputs[0];
								if (output.output_type === 'stream' && output.name === 'stdout') {
									try {
										allVars = JSON.parse(output.text);
									} catch (e) {
										console.error("Failed to parse kernel variables", e);
									}
								}
							}
							
							let counter = 0;
							let varName = `loaded_data_${counter}`;
							while(allVars.includes(varName)) {
								counter++;
								varName = `loaded_data_${counter}`;
							}

							let code = '';
							if (ioClass) {
								code = `
import neo
io_class = getattr(neo.io, '${ioClass}')
reader = io_class(filename='${filePath}')
${varName} = reader.read_block()
									`;
							} else {
								code = `
import neo
${varName} = neo.get_io('${filePath}').read()
if (isinstance(${varName}, list)):
	${varName} = ${varName}[0]
elif (isinstance(${varName}, dict)):
	${varName} = ${varName}['blocks'][0]
print(${varName}, type(${varName}))
self.update_tree()

`;
							}
							await this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false);
							await this.executeCodeInOutputArea(pythonCode['updateTree'], this.outarea_neo_tree!, session, false);
						} else if (dialogResult.button.label === 'Automatic') {
							showDialog({
								title: 'Error',
								body: 'Could not automatically determine IO class.',
								buttons: [Dialog.okButton()]
							});
						}
					});
				}
			});
		};

		const saveNeoObjectsButton = document.createElement('button');
		saveNeoObjectsButton.innerHTML = 'Save <i class="fa fa-file-export" aria-hidden="true"></i>';
		saveNeoObjectsButton.title = 'Save selected neo objects to nix-file';
		saveNeoObjectsButton.style.backgroundColor = COLORS["Teal"]
		saveNeoObjectsButton.className = 'workflow-button workflow-button-io';
		saveNeoObjectsButton.onclick = () => {
			const body = document.createElement('div');
			const input = document.createElement('input');
			input.className = 'jp-input';
			input.placeholder = 'e.g. output_file.nix';
			body.appendChild(input);
			showDialog({
				title: 'Enter file name',
				body: new Widget({ node: body }),
				buttons: [
					Dialog.cancelButton(),
					Dialog.okButton({ label: 'OK' })
				],
				hasClose: true
			}).then(dialogResult => {
				if (dialogResult.button.label === 'OK') {
					const filePath = input.value;
					if (!filePath) {
						showDialog({
							title: 'Error',
							body: 'No file path provided.',
							buttons: [Dialog.okButton()]
						});
						return;
					}

					const code = `
from jupyphant.kernelcode import save_selected_neo_objects
save_selected_neo_objects(jupyphant_entity, '${filePath}')
					`;
					this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false)
					.then(() => {
                    showDialog({
                        title: 'Export Successful',
                        body: `The Neo objects have been saved to: ${filePath}`,
                        buttons: [Dialog.okButton()]
                    });
                })
                .catch(err => {
                    showDialog({
                        title: 'Export Failed',
                        body: `An error occurred: ${err}`,
                        buttons: [Dialog.okButton()]
                    });
                });
				}
			});
		};
		const insertCodeButton = document.createElement('button');
		insertCodeButton.innerHTML = 'Insert <i class="fa fa-code" aria-hidden="true"></i>';
		insertCodeButton.style.backgroundColor = COLORS["Teal"];
		insertCodeButton.className = 'workflow-button workflow-button-io';
		insertCodeButton.onclick = async () => {
			const code = `
import json
import __main__
import re

try:
    if 'jupyphant_entity' in __main__.__dict__:
        jupyphant = __main__.__dict__['jupyphant_entity']
        selected_nodes = jupyphant.ipytree_of_neo_objects.selected_nodes
        
        if not selected_nodes:
            print(json.dumps({"code_to_insert": "", "error": "No nodes selected in the Neo tree."}))
        else:
            new_vars = []
            all_vars = list(__main__.__dict__.keys())
            
            for node in selected_nodes:
                if node._id in jupyphant.map_ipytree_node_id_to_neo_obj_hash:
                    obj_hash = jupyphant.map_ipytree_node_id_to_neo_obj_hash[node._id]
                    neo_obj = jupyphant.map_neo_obj_hash_to_neo_obj[obj_hash]
                    
                    base_name = ""
                    if hasattr(neo_obj, 'name') and neo_obj.name:
                        sanitized_name = re.sub(r'[^\\w_]', '', neo_obj.name.replace(' ', '_')).lower()
                        if re.match(r'^\\d', sanitized_name):
                            sanitized_name = '_' + sanitized_name
                        if not sanitized_name:
                             sanitized_name = "unnamed"
                        base_name = f"jupyphant_{sanitized_name}"
                    else:
                        class_name = neo_obj.__class__.__name__
                        if 'list' in class_name.lower():
                            base_name = f"jupyphant_list"
                        else:
                            base_name = f"jupyphant_{class_name.lower()}"

                    new_var_name = base_name
                    counter = 1
                    while new_var_name in all_vars:
                        new_var_name = f"{base_name}_{counter}"
                        counter += 1
                    
                    __main__.__dict__[new_var_name] = neo_obj
                    new_vars.append(new_var_name)
                    all_vars.append(new_var_name)
            
            code_to_insert = ""
            if len(new_vars) > 1:
                list_base_name = "jupyphant_list"
                counter = 0
                list_var_name = f"{list_base_name}_{counter}"
                while list_var_name in all_vars:
                    counter += 1
                    list_var_name = f"{list_base_name}_{counter}"

                __main__.__dict__[list_var_name] = [__main__.__dict__[var_name] for var_name in new_vars]
                
                code_to_insert = f"{list_var_name} = [{', '.join(new_vars)}]"
            elif len(new_vars) == 1:
                code_to_insert = new_vars[0]

            print(json.dumps({"code_to_insert": code_to_insert}))
    else:
        print(json.dumps({"code_to_insert": "", "error": "jupyphant_entity not found"}))

except Exception as e:
    import sys, traceback
    print(json.dumps({"code_to_insert": "", "error": str(e), "traceback": traceback.format_exc()}), file=sys.stdout)
			`;
			
			const result = await this.kernelBridge!.executeCode(code, true);

			if (result && result.outputs.length > 0) {
				const output = result.outputs[0];
				if (output.output_type === 'stream' && output.name === 'stdout') {
					const data = JSON.parse(output.text);

					if (data.error) {
						console.error("Jupyphant: Error creating variables from selection:", data.error);
						if (data.traceback) {
							console.error(data.traceback);
						}
						return;
					}

					if (data.code_to_insert) {
						const notebookPanel = this.notebook_tracker.currentWidget;
						if (notebookPanel) {
							NotebookActions.insertBelow(notebookPanel.content);
							const activeCell = notebookPanel.content.activeCell;
							if (activeCell) {
								activeCell.model.sharedModel.setSource(data.code_to_insert);
							}
	
							console.log(`Jupyphant: Created and inserted code in new cell.`);
						}
					}
				}
			}
		}

		
		filterContainer.classList.add('sticky-filter');
		filterContainer.appendChild(document.createElement('br'));
		filterContainer.appendChild(document.createElement('br'));
		filterContainer.appendChild(loadNeoFileButton);
		filterContainer.appendChild(saveNeoObjectsButton);
		filterContainer.appendChild(insertCodeButton);

		tree_widget.node.prepend(filterContainer);
	}

	public createWidgets(rendermime: IRenderMimeRegistry, session: ISessionContext) {
		// NEO TREE 
		let tree_widget = new Panel();
		tree_widget.title.label = 'Neo Tree';
		tree_widget.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_neo_tree = this.createOutputArea(rendermime, tree_widget, ['my-outarea-class'], 'jup_vis_out_id_1', session);
		this.create_tree_filter(session, tree_widget);
		this.createTopBar(session);

		// INFO
		let explorer_widget_info = new Panel();
		explorer_widget_info.title.label = 'Details';
		explorer_widget_info.node.style.cssText = explorer_widget_info.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_info = this.createOutputArea(rendermime, explorer_widget_info, ['my-outarea-class'], 'jup_vis_out_id_2.1', session);
		
		// RAW
		let explorer_widget_raw_plot = new Panel();
		explorer_widget_raw_plot.title.label = 'Visualize';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_raw = this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class'], 'jup_vis_out_id_2.2', session);
		
		// STATISTICS
		let explorer_widget_statistics = new Panel();
		explorer_widget_statistics.title.label = 'Statistics';
		explorer_widget_statistics.node.style.cssText = explorer_widget_statistics.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_statistics = this.createOutputArea(rendermime, explorer_widget_statistics, ['my-outarea-class'], 'jup_vis_out_id_2.3', session);

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget_info, { mode: 'split-bottom', ref: tree_widget });
		this.widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
		this.widget.addWidget(explorer_widget_statistics, { mode: 'tab-after', ref: explorer_widget_raw_plot });
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

}; // end of JupyphantWidget class

/*
* Activate the JupyphantWidget extension
*/
function activate(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
	render_mime_registry: IRenderMimeRegistry, restorer: ILayoutRestorer, docManager: IDocumentManager) {
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
	const jupy_ext = new JupyphantExtension(app, command_palette, notebook_tracker, widget_tracker, render_mime_registry, docManager);

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
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer, IDocumentManager],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;
