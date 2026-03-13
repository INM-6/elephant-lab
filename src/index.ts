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
}
	from '@jupyterlab/rendermime';
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
	PythonCodeKey,
	getPythonCode
} from './kernelcode';
// Style from css
import '../style/index.css';
import '../style/base.css'
import '../style/sidebar.css';
import { KernelBridge } from './kernel_bridge';
import jupyphantLogo from '../doc/Jupyphant-Logo.png';

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
	private outarea_nodeexplorer_info: OutputArea | null;
	private outarea_nodeexplorer_raw: OutputArea | null;
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
		this.outarea_nodeexplorer_info = null;
		this.outarea_nodeexplorer_raw = null;
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

		await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.SetupEnv), this.outarea_neo_tree!, session, false);

		console.log("Jupyphant: Environment setup complete.");
		try {
			// Execute Jupyphant Code to create Neo Tree / Information and Plots  
			await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.CreateTree), this.outarea_neo_tree!, session);
			await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.UpdateTree), this.outarea_neo_tree!, session, false);
			await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.CreateExplorerInfo), this.outarea_nodeexplorer_info!, session);
			await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.CreateExplorerRaw), this.outarea_nodeexplorer_raw!, session);
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
		this.notebook_tracker.forEach(notebookWidget => {
			if (notebookWidget.title.className.includes('jupyphant-active-notebook')) {
				notebookWidget.title.className = notebookWidget.title.className
					.replace('jupyphant-active-notebook', '')
					.trim();
			}
		});

		newPanel.title.className += ' jupyphant-active-notebook';

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

		this.initializeTab(newPanel.content.rendermime as any);
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
				await Promise.all([
					this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.UpdateTree), this.outarea_neo_tree!, initialSession, false),
				]);
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
		this.widget.title.iconClass = 'elephant-trunk-icon';
		// Adds the x to close the tab?
		this.widget.title.closable = true;
		const session = this.notebook_tracker.currentWidget?.sessionContext;
		if (!session) {
			console.error("Jupyphant: No notebook session found during UI initialization!");
			return;
		}

		this.createWidgets(rendermime, session);

	} // end of initializeTab()

	private getFilterStates(): Record<string, boolean> {
		const saved = sessionStorage.getItem('jupyphant-filter-states');
		return saved ? JSON.parse(saved) : {};
	}

	private saveFilterState(key: string, isChecked: boolean) {
		const states = this.getFilterStates();
		states[key] = isChecked;
		sessionStorage.setItem('jupyphant-filter-states', JSON.stringify(states));
	}

	public createTopBar(session: ISessionContext) {
		if (this.topBar) {
			this.topBar.dispose();
		}

		const currentFilename = session.path.split('/').pop() || "Unknown Notebook";

		const switchNotebookButton = document.createElement('button');
		switchNotebookButton.innerHTML = `<i class="fa fa-exchange" aria-hidden="true"></i> ${currentFilename}`;
		switchNotebookButton.title = 'Switch Jupyphant to current active notebook';
		switchNotebookButton.className = 'workflow-button workflow-button-io';
		switchNotebookButton.style.marginRight = '5px';
		switchNotebookButton.onclick = () => {
			this.newTab(true);
		};

		session.propertyChanged.connect((sender, prop) => {
			if (prop === 'path') {
				const newFilename = sender.path.split('/').pop() || "Unknown Notebook";
				switchNotebookButton.innerHTML = `<i class="fa fa-exchange" aria-hidden="true"></i> ${newFilename}`;
			}
		});

		const infoButton = document.createElement('button');
		infoButton.innerHTML = '<i class="fa fa-info-circle" aria-hidden="true"></i> Jupyphant';
		infoButton.title = 'About Jupyphant';
		infoButton.className = 'workflow-button workflow-button-io';
		infoButton.onclick = async () => {
			const result = await this.kernelBridge!.executeCode(getPythonCode(PythonCodeKey.Version), true);

			const body = document.createElement('div');
			body.style.textAlign = 'center';
			body.innerHTML = `
				<p>You are using <a href="https://github.com/INM-6/jupyphant">Jupyphant</a> ${result?.outputs[0].text}<br>
				This version is a public preview version. <br>Further Analysis functions will be added in later releases.</p>

				<p>Tobias Michels<br>Jan Nolten<br>Maximilian Kramer<br>Björn Müller<br>Michael Denker<br></p>
				<p><a href="https://www.fz-juelich.de/en/ias/ias-6">
				Institute for Advanced Simulation (IAS-6), <br>
				Computational and Systems Neuroscience, Forschungszentrum Jülich GmbH</a></p><br>
				<img src="${jupyphantLogo}" alt="Jupyphant Logo" style="display: block; width: 500px; margin: 10px auto 0 auto;">`;
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
			"event": "map-marker",
			"imagesequence": "images",
			"circularregionofinterest": "circle",
			"polygonregionofinterest": "draw-polygon",
			"rectangularregionofinterest": "square",
			"open_all": "check",
		}
		const currentFilterStates = this.getFilterStates();

		const filterContainer = document.createElement('div');
		filterContainer.className = 'neo-filter-container';
		filterContainer.textContent = " Filter  ";

		Object.keys(neo_obj_filter_dict).forEach(key => {
			const iconName = neo_obj_filter_dict[key as keyof typeof neo_obj_filter_dict];
			const label = document.createElement("label");
			label.dataset.key = key;

			const defaultState = (key === "open_all") ? false : true;
			const isChecked = currentFilterStates[key] ?? defaultState;

			label.dataset.checked = isChecked ? "true" : "false";
			label.classList.add(isChecked ? 'checked-label' : 'unchecked-label');


			const icon = document.createElement("i");
			icon.className = `fa fa-${iconName}`
			icon.setAttribute("aria-hidden", "true");
			label.prepend(icon);
			label.appendChild(document.createTextNode(`  `));
			label.onclick = () => {
				const isCurrentlyChecked = label.dataset.checked === "true";
				const isNowChecked = !isCurrentlyChecked;
				label.dataset.checked = isNowChecked ? "true" : "false";

				if (isNowChecked) {
					label.classList.replace('unchecked-label', 'checked-label');
				} else {
					label.classList.replace('checked-label', 'unchecked-label');
				}

				this.saveFilterState(key, isNowChecked);

				key === "open_all"
					? this.neo_tree_expand(isNowChecked, session)
					: this.neo_tree_filter(label.dataset.key!, session);

			};

			key == "open_all" ? label.title = `Expand all containers` : label.title = `Hide/Show ${key.charAt(0).toUpperCase() + key.slice(1)}(s)`;


			filterContainer.appendChild(label);
		});

		const flexBreak = document.createElement('div');
		flexBreak.style.flexBasis = "100%";
		flexBreak.style.height = "0";
		filterContainer.appendChild(flexBreak);

		const loadNeoFileButton = document.createElement('button');
		loadNeoFileButton.innerHTML = '<i class="fa fa-file-import" aria-hidden="true"></i> Load';
		loadNeoFileButton.title = 'Create a neoIO for given Path';
		loadNeoFileButton.className = 'workflow-button workflow-button-io';
		loadNeoFileButton.onclick = () => {
			FileDialog.getOpenFiles({
				manager: this.docManager
			}).then(result => {
				if (result.button.accept && result.value && result.value.length > 0) {
					const selectedFile = result.value[0];
					let filePath = selectedFile.path;
					const slashCount = (session.path.match(/\//g) || []).length;
					if (slashCount !== 0) {
						const prefix = '../'.repeat(slashCount);
						filePath = prefix+filePath;
					}
					
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
							const varsResult = await this.kernelBridge!.executeCode(getPythonCode(PythonCodeKey.GetVars), true);
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
							while (allVars.includes(varName)) {
								counter++;
								varName = `loaded_data_${counter}`;
							}

							let code = getPythonCode(PythonCodeKey.SetVarName, ioClass, filePath, varName);
							await this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false);
							await this.executeCodeInOutputArea(getPythonCode(PythonCodeKey.UpdateTree), this.outarea_neo_tree!, session, false);
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
		saveNeoObjectsButton.innerHTML = '<i class="fa fa-file-export" aria-hidden="true"></i> Save';
		saveNeoObjectsButton.title = 'Save selected neo objects to nix-file';
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

					const code = getPythonCode(PythonCodeKey.SaveSelectedNeoObjects, filePath);
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
		insertCodeButton.innerHTML = '<i class="fa fa-code" aria-hidden="true"></i> Insert';
		insertCodeButton.title = 'Insert selected neo objects into current notebook';
		insertCodeButton.className = 'workflow-button workflow-button-io';
		insertCodeButton.onclick = async () => {
			const currentNotebook = this.notebook_tracker.currentWidget;
			if (!currentNotebook || currentNotebook.sessionContext.path !== session.path) {
				showDialog({
					title: 'Incorrect Notebook',
					body: 'Jupyphant is not connected to this notebook. Please switch to the notebook Jupyphant is attached to.',
					buttons: [Dialog.okButton()]
				});
				return;
			}

			const result = await this.kernelBridge!.executeCode(getPythonCode(PythonCodeKey.InsertCode), true);

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
							const activeCell = notebookPanel.content.activeCell;
							if (activeCell && activeCell.editor) {
								activeCell.editor.replaceSelection!(data.code_to_insert);
								console.log(`Jupyphant: Inserted code at cursor.`);
							} else {
								console.log(`Jupyphant: No active cell or editor found. Could not insert code.`);
							}
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


	private defaultOutputErrorListerner(msg: any) {
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
	}

	public create_raw_plot_options(session: ISessionContext, raw_plot_widget: Panel) {
		const buttonContainer = document.createElement("div");
		buttonContainer.classList.add("jp-rawplot-button-container");

		const createToggle = (icon: string, label: string, description: string, initial: boolean, is_toggle: boolean, callback: (state: boolean) => void) => {
			const toggle = document.createElement("button");
			toggle.type = "button";
			toggle.classList.add("jp-rawplot-toggle");
			toggle.setAttribute("aria-pressed", String(initial));
			toggle.innerHTML = `<i class="fa ${icon}"></i> ${label}`;
			toggle.title = description;

			toggle.addEventListener("click", () => {
				if (!is_toggle) {
					callback(false);
					return;
				}

				const checked = toggle.getAttribute("aria-pressed") === "true";
				const newState = !checked;
				toggle.setAttribute("aria-pressed", String(newState));
				callback(newState);
			});

			return toggle;
		};

		const darkmodeToggle = createToggle('fa-moon', 'Dark', 'Switch between dark and light mode', true, true, (state) => {
			const code = getPythonCode(PythonCodeKey.DarkModeToggle, state);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		});

		const overlapToggle = createToggle('fa-layer-group', 'Overlap', 'Switch between stacking the graphs vertically or overlapping them', false, true, (state) => {
			const code = getPythonCode(PythonCodeKey.OverlapToggle, state);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		});

		const zeroBasedToggle = createToggle('fa-caret-square-o-left', 'Zero Based', 'Shifts the graphs to start at 0', true, true, (state) => {
			const code = getPythonCode(PythonCodeKey.ZeroBasedToggle, state);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		});

		const upscaleButton = createToggle('fa-expand-arrows-alt', 'Upscale', 'Replot the graph for the new x range or max points to increase detail', false, false, () => {
			let max_points = Number(numberInput.value);
			if (max_points < min_max_points) {
				max_points = min_max_points;
				numberInput.value = max_points.toString();
			}
			const code = getPythonCode(PythonCodeKey.UpscaleRawPlot, max_points);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		});

		const resetScaleButton = createToggle('fa-undo', 'Reset Scale', 'Reset the x_range to the starting one', false, false, () => {
			const code = getPythonCode(PythonCodeKey.ResetScale);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		});

		const optionsModal = document.createElement("div");
		optionsModal.classList.add("jp-rawplot-options-modal");

		// --- OPTIONS MODAL BUTTON ---
		const optionsToggle = createToggle('fa-cogs', 'Options', '', false, true, (state) => {
			optionsModal.classList.toggle("jp-visible", state);
		});

		// Hide options when clicked elsewhere
		raw_plot_widget.node.addEventListener("click", (e) => {
			const temp: Node = e.target as Node
			if (!optionsModal.contains(temp) && !optionsToggle.contains(temp)) {
				optionsModal.classList.remove("jp-visible");
				optionsToggle.setAttribute("aria-pressed", "false");
			}
		});

		// --- MAX POINTS INPUT ---
		const numberLabel = document.createElement('label');
		numberLabel.innerHTML = `<i class="fa fa-chart-line"></i> Max Points`;
		numberLabel.classList.add("jp-rawplot-label");

		const min_max_points = 10000;
		const numberInput = document.createElement('input');
		numberInput.type = "number";
		numberInput.value = "10000";
		numberInput.min = `${min_max_points}`;
		numberInput.step = "10000";
		numberInput.classList.add("jp-rawplot-input");

		const maxNumberInput = document.createElement("div");
		maxNumberInput.classList.add("jp-rawplot-row");
		maxNumberInput.title = "Maximum number of points to be plotted. Increasing this number can increase the detail of the plot, but also increases loading times.";

		maxNumberInput.appendChild(numberLabel);
		maxNumberInput.appendChild(numberInput);

		// --- COLOR GRADE SELECT ---
		const colorGradeLabel = document.createElement('label');
		colorGradeLabel.innerHTML = `<i class="fa fa-palette"></i> Color Grade`;
		colorGradeLabel.classList.add("jp-rawplot-label");

		const colorGradeSelect = document.createElement('select');
		colorGradeSelect.classList.add("jp-rawplot-select");
		["Viridis", "Plasma", "Inferno", "Magma", "Cividis", "Turbo"].forEach(grade => {
			const opt = document.createElement("option");
			opt.value = grade;
			opt.textContent = grade;
			colorGradeSelect.appendChild(opt);
		});
		colorGradeSelect.value = "Viridis";

		colorGradeSelect.onchange = () => {
			const code = getPythonCode(PythonCodeKey.SetColorGrade, colorGradeSelect.value);
			session.session!.kernel!.requestExecute({ code, store_history: false }).onIOPub = this.defaultOutputErrorListerner;
		};

		const colorGrade = document.createElement('div');
		colorGrade.classList.add("jp-rawplot-row");
		colorGrade.title = "Color grade for the image sequence plot";
		colorGrade.appendChild(colorGradeLabel);
		colorGrade.appendChild(colorGradeSelect);

		optionsModal.appendChild(maxNumberInput);
		optionsModal.appendChild(colorGrade);

		buttonContainer.append(
			darkmodeToggle,
			overlapToggle,
			zeroBasedToggle,
			upscaleButton,
			resetScaleButton,
			optionsToggle
		);

		// --- MAIN CONTAINER ---
		const toolbarContainer = document.createElement("div");
		toolbarContainer.classList.add("jp-rawplot-toolbar");

		toolbarContainer.append(buttonContainer, optionsModal);

		raw_plot_widget.node.prepend(toolbarContainer);
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
		explorer_widget_raw_plot.title.label = 'Explore';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_raw = this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class'], 'jup_vis_out_id_2.2', session);

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget_info, { mode: 'split-bottom', ref: tree_widget });
		this.widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
		this.create_raw_plot_options(session, explorer_widget_raw_plot);
	}

	public neo_tree_filter(checkbox_id: string, session: ISessionContext) {
		let code = getPythonCode(PythonCodeKey.ToggleNeoTreeFilter, checkbox_id);
		this.executeCodeInOutputArea(code, this.outarea_neo_tree!, session, false);
	}

	public neo_tree_expand(checked: boolean, session: ISessionContext) {
		let code = getPythonCode(PythonCodeKey.ExpandNeoTree, checked);
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
		let outarea = new OutputArea({ rendermime: rendermime as any, model });
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
		if (outputArea == null) {
			return;
		}
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

};

/*
* Initialization data for the Jupyphant extension
*/
const extension: JupyterFrontEndPlugin<void> = {
	id: 'jupyphant:extension',
	autoStart: true,
	// What to pass to the activate function
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer, IDocumentManager],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;