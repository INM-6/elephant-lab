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
	Dialog,
	MainAreaWidget
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

import { ISettingRegistry } from '@jupyterlab/settingregistry';
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
import { PlotlyFrontend } from './plot';
import { PlotSettings } from './plot_settings';
import { WorkflowEngineWidget } from './workflow_engine';
import elephantLabLogo from '../doc/Elephant-Lab-Logo.png';

type PlotSettingsKey = keyof PlotSettings;
interface UpdateSettingsCallback {
	ids: PlotSettingsKey[];
	callback: (plotSettings: PlotSettings) => void;
}

class ElephantLabExtension {
	// declaring members of the class
	private app: JupyterFrontEnd;
	private command_palette: ICommandPalette;
	private notebook_tracker: INotebookTracker;
	private widget_tracker: WidgetTracker<Widget>;
	private myPanels: NotebookPanel[];
	private myVisTabs: Widget[];
	private widget: DockPanel;
	private _updateTimer: number | null = null;
	private _clickTimer: number | null = null;
	private outarea_nodeexplorer_info: OutputArea | null;
	private outarea_nodeexplorer_raw: OutputArea | null;
	private outarea_neo_tree: OutputArea | null;
	private outarea_workflow: OutputArea | null;
	private workflowEngine: WorkflowEngineWidget | null;
	private output_tabs: DockPanel | null;
	private docManager: IDocumentManager;
	private settingRegistry: ISettingRegistry;
	private kernelBridge: KernelBridge | null;
	private topBar: Widget | null = null;
	private plotlyFrontend: PlotlyFrontend | null;
	private _lastClickedNode: string | null = null;
	private _explorerWidget: Panel | null = null;
	private _detailsWidget: Panel | null = null;
	private suppressSettingsChanged: boolean = false;
	private updateSettingsCallbacks: UpdateSettingsCallback[] = [];

	// Construct a new ElephantLabExtension
	public constructor(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
		widget_tracker: WidgetTracker<Widget>, rendermime: IRenderMimeRegistry, docManager: IDocumentManager, settingRegistry: ISettingRegistry) {
		// save all constructor arguments
		this.app = app;
		this.command_palette = command_palette;
		this.notebook_tracker = notebook_tracker;
		this.widget_tracker = widget_tracker;
		this.docManager = docManager;
		this.settingRegistry = settingRegistry;
		// Store references to all tabs containing notebooks
		this.myPanels = [];
		// Store references to all tabs created by this extension
		this.myVisTabs = [];
		// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
		this.widget = new DockPanel({ tabsMovable: false });
		this.outarea_nodeexplorer_info = null;
		this.outarea_nodeexplorer_raw = null;
		this.outarea_neo_tree = null;
		this.outarea_workflow = null;
		this.workflowEngine = null;
		this.output_tabs = null;
		this.kernelBridge = null;
		this.plotlyFrontend = null;
	}; // end of constructor()

	private async initializeSettings() {
		const settings = await this.settingRegistry.load('elephant-lab:plugin');

		const applySettings = async () => {

			const plotSettings: PlotSettings = {};

			for (const { ids, callback } of this.updateSettingsCallbacks) {

				for (const id of ids) {
					const value = settings.get(id).composite;

					(plotSettings as Record<PlotSettingsKey, unknown>)[id] = value;
				}

				callback(plotSettings);
			}

			await this.kernelBridge!.executeCode(getPythonCode(PythonCodeKey.UpdatePlotSettings, plotSettings));
		}

		// Listen for changes
		settings.changed.connect(async () => {
			if (!this.suppressSettingsChanged) {
				await applySettings();
			}
		});
		await applySettings();
	}


	/******************************************************************************************************************/
	// Define utility functions
	/******************************************************************************************************************/
	// Create OutputAreas where Python-Code can be executed
	private async initializeKernelState(session: ISessionContext) {
		console.log("Elephant Lab: Initializing kernel state...");
		this.kernelBridge = new KernelBridge(session);

		await this.kernelBridge.executeCode(PythonCodeKey.SetupEnv);

		console.log("Elephant Lab: Environment setup complete.");
		try {
			// Execute Elephant Lab code to create Neo Tree / Information and Plots
			await this.kernelBridge.executeCode(PythonCodeKey.CreateTree, this.outarea_neo_tree!);
			await this.kernelBridge.executeCode(PythonCodeKey.UpdateTree, this.outarea_neo_tree!, false);
			await this.kernelBridge.executeCode(PythonCodeKey.CreateDetailsPanel, this.outarea_nodeexplorer_info!);
			this.plotlyFrontend = new PlotlyFrontend(session.session!, this.outarea_nodeexplorer_raw!);
			await this.kernelBridge.executeCode(PythonCodeKey.CreateExplorerRaw, this.outarea_nodeexplorer_raw!);
			// Notify backend of initial panel active state
			await this.kernelBridge.executeCode(
				getPythonCode(PythonCodeKey.SetPanelVisibility, this._explorerWidget?.isVisible ?? false, this._detailsWidget?.isVisible ?? false),
				null, false
			);

			await this.initializeSettings();

			console.log("Elephant Lab: Kernel state and UI plots initialized.");
		} catch (error) {
			console.error("Elephant Lab: FAILED to initialize kernel state:", error);
		}
	}
	// Command on which to execute Elephant Lab
	public createCommand(command: string) {
		/**
		  * Creates a hardcoded command to start this extension
		  * And places it as a button in the CommandPalette on the left-hand side
		  * of the JupyterLab interface.
		  * Clicking 'Elephant Lab' in the Commands tab on the left activates the Elephant Lab extension
		  */
		// Add the specified command to the commands known by JupyterLab
		this.app.commands.addCommand(command, {
			label: 'Elephant Lab',
			execute: () => {
				// The newTab function that contains the main code is called from the command
				this.newTab();
			}
		});
		// Add the command to the CommandPalette, to make it available on click
		this.command_palette.addItem({ command, category: 'NeuroScience' });
	} // end of createCommand()


	// Function to react on command 'Elephant Lab'
	// Called only after the command is clicked from CommandPalette
	public async newTab(force: boolean = false) {
		/**
	  * This function actually starts the extension itself.
	  * It creates a new Elephant Lab tab that is connected to the notebook active when this function is executed
	  * and therefore displays data from this notebook and reacts to its cell executions.
	  * This function is executed when the command 'Elephant Lab' in the CommandPalette is clicked by the user.
	  * Consequently, the notebook that should be visualized using Elephant Lab needs to be opened and its tab
	  * needs to be in the foreground when the command is clicked.
	  */
		// Wait for all notebooks to be restored in case newTab is executed early
		// This is probably important for restoring the Elephant Lab tabs (not yet implemented)

		console.log("Elephant Lab: newTab() started.");
		await this.notebook_tracker.restored;
		console.log("Elephant Lab: Notebook tracker restored.");

		// Only execute Elephant Lab if a Notebook is currently open
		const newPanel = this.notebook_tracker.currentWidget;
		if (!newPanel) {
			console.error("Elephant Lab: No active notebook found.");
			return;
		}
		this.notebook_tracker.forEach(notebookWidget => {
			if (notebookWidget.title.className.includes('elephant-lab-active-notebook')) {
				notebookWidget.title.className = notebookWidget.title.className
					.replace('elephant-lab-active-notebook', '')
					.trim();
			}
		});

		newPanel.title.className += ' elephant-lab-active-notebook';

		if (!force && this.widget.isAttached) {
			console.log("Elephant Lab: Existing widgets found, activating them.");
			this.app.shell.activateById(this.widget.id);
			return;
		}

		console.log("Elephant Lab: Creating new Elephant Lab instance.");

		// Clear the panel before adding new widgets
		const oldWidgets = Array.from(this.widget.widgets());
		for (const w of oldWidgets) {
			w.dispose();
		}
		if (this.output_tabs) {
			this.output_tabs.dispose();
			this.output_tabs = null;
		}

		await this.initializeTab(newPanel.content.rendermime as any);
		this.myVisTabs.push(this.widget);
		this.myPanels.push(newPanel);
		this.attachTab();

		const initialSession = newPanel.sessionContext;
		await initialSession.ready;
		await this.initializeKernelState(initialSession);

		// Keep backend in sync when the user switches between Details and Explore tabs
		for (const tabBar of this.widget.tabBars()) {
			const hasOurPanels = Array.from(tabBar.titles).some(
				t => t.owner === this._detailsWidget || t.owner === this._explorerWidget
			);
			if (hasOurPanels) {
				tabBar.currentChanged.connect((_sender, args) => {
					const curr = args.currentTitle?.owner;
					if (this.kernelBridge) {
						this.kernelBridge.executeCode(
							getPythonCode(PythonCodeKey.SetPanelVisibility, curr === this._explorerWidget, curr === this._detailsWidget),
							null, false
						);
					}
				});
				break;
			}
		}

		// Handle HTML tree interactions (expand/collapse + selection)
		// All clicks go through a 250ms timer so dblclick can cancel before any Python call fires.
		this.outarea_neo_tree!.node.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;

			// Expand/collapse -> pure JS
			const toggle = target.closest('.jup-toggle') as HTMLElement;
			if (toggle) {
				const row = toggle.closest('.jup-row') as HTMLElement;
				const children = row?.nextElementSibling as HTMLElement;
				if (children?.classList.contains('jup-children')) {
					const isOpen = children.classList.contains('jup-open');
					children.classList.toggle('jup-open', !isOpen);
					toggle.innerHTML = isOpen ? '<i class="fa fa-plus"></i>' : '<i class="fa fa-minus"></i>';
				}
				return;
			}

			const row = target.closest('.jup-row[data-node-id]') as HTMLElement;
			if (!row) return;

			const nodeId = row.getAttribute('data-node-id')!;
			const isShift = (e as MouseEvent).shiftKey;
			const isCtrl = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey;
			const anchorId = this._lastClickedNode; // capture anchor before timer fires

			if (this._clickTimer) {
				window.clearTimeout(this._clickTimer);
				this._clickTimer = null;
			}

			this._clickTimer = window.setTimeout(() => {
				this._clickTimer = null;

				if (isShift && anchorId) {
					// Shift+Click: select range of parents only
					const allRows = Array.from(
						this.outarea_neo_tree!.node.querySelectorAll('.jup-row[data-node-id]')
					) as HTMLElement[];
					const ids = allRows.map(r => r.getAttribute('data-node-id')!);
					const fromIdx = ids.indexOf(anchorId);
					const toIdx = ids.indexOf(nodeId);

					if (fromIdx !== -1 && toIdx !== -1) {
						const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];

						this.outarea_neo_tree!.node
							.querySelectorAll('.jup-row.jup-selected')
							.forEach(el => el.classList.remove('jup-selected'));

						const rangeIds: string[] = [];
						for (let i = start; i <= end; i++) {
							allRows[i].classList.add('jup-selected');
							rangeIds.push(ids[i]);
						}

						const idsJson = JSON.stringify(rangeIds);
						const code = getPythonCode(PythonCodeKey.HandleSelectionRange, idsJson);
						this.kernelBridge!.executeCode(code, null, false);
					}
				} else if (isCtrl) {
					// Ctrl+Click: toggle parent only
					row.classList.toggle('jup-selected');
					const code = getPythonCode(PythonCodeKey.HandleTreeSelection, nodeId, 'True', 'False');
					this.kernelBridge!.executeCode(code, null, false);
					this._lastClickedNode = nodeId;
				} else {
					// Single click: select parent only
					this.outarea_neo_tree!.node
						.querySelectorAll('.jup-row.jup-selected')
						.forEach(el => el.classList.remove('jup-selected'));
					row.classList.add('jup-selected');
					const code = getPythonCode(PythonCodeKey.HandleTreeSelection, nodeId, 'False', 'False');
					this.kernelBridge!.executeCode(code, null, false);
					this._lastClickedNode = nodeId;
				}
			}, 250);
		});

		// Double-click: cancel the pending timer then select with children
		this.outarea_neo_tree!.node.addEventListener('dblclick', (e) => {
			const target = e.target as HTMLElement;

			if (target.closest('.jup-toggle')) return;

			const row = target.closest('.jup-row[data-node-id]') as HTMLElement;
			if (!row) return;

			const nodeId = row.getAttribute('data-node-id')!;
			const isShift = (e as MouseEvent).shiftKey;
			const isCtrl = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey;
			const anchorId = this._lastClickedNode;

			if (this._clickTimer) {
				window.clearTimeout(this._clickTimer);
				this._clickTimer = null;
			}

			if (isShift && anchorId) {
				// Shift+Double-Click: select range + all children recursively
				const allRows = Array.from(
					this.outarea_neo_tree!.node.querySelectorAll('.jup-row[data-node-id]')
				) as HTMLElement[];
				const ids = allRows.map(r => r.getAttribute('data-node-id')!);
				const fromIdx = ids.indexOf(anchorId);
				const toIdx = ids.indexOf(nodeId);

				if (fromIdx !== -1 && toIdx !== -1) {
					const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];

					this.outarea_neo_tree!.node
						.querySelectorAll('.jup-row.jup-selected')
						.forEach(el => el.classList.remove('jup-selected'));

					const rangeIds: string[] = [];
					for (let i = start; i <= end; i++) {
						allRows[i].classList.add('jup-selected');
						rangeIds.push(ids[i]);
						const childContainer = allRows[i].nextElementSibling as HTMLElement;
						if (childContainer?.classList.contains('jup-children')) {
							childContainer.querySelectorAll('.jup-row[data-node-id]')
								.forEach(el => el.classList.add('jup-selected'));
						}
					}

					const idsJson = JSON.stringify(rangeIds);
					const code = getPythonCode(PythonCodeKey.HandleSelectionRange, idsJson, true);
					this.kernelBridge!.executeCode(code, null, false);
				}
			} else if (isCtrl) {
				// Ctrl+Double-Click: toggle parent + all children recursively
				row.classList.toggle('jup-selected');
				const isNowSelected = row.classList.contains('jup-selected');
				const childContainer = row.nextElementSibling as HTMLElement;
				if (childContainer?.classList.contains('jup-children')) {
					childContainer.querySelectorAll('.jup-row[data-node-id]')
						.forEach(el => isNowSelected
							? el.classList.add('jup-selected')
							: el.classList.remove('jup-selected'));
				}
				const code = getPythonCode(PythonCodeKey.HandleTreeSelection, nodeId, 'True', 'True');
				this.kernelBridge!.executeCode(code, null, false);
				this._lastClickedNode = nodeId;
			} else {
				// Regular double-click: clear selection, select parent + all children
				this.outarea_neo_tree!.node
					.querySelectorAll('.jup-row.jup-selected')
					.forEach(el => el.classList.remove('jup-selected'));
				row.classList.add('jup-selected');
				const childContainer = row.nextElementSibling as HTMLElement;
				if (childContainer?.classList.contains('jup-children')) {
					childContainer.querySelectorAll('.jup-row[data-node-id]')
						.forEach(el => el.classList.add('jup-selected'));
				}
				const code = getPythonCode(PythonCodeKey.HandleTreeSelection, nodeId, 'False', 'True');
				this.kernelBridge!.executeCode(code, null, false);
				this._lastClickedNode = nodeId;
			}
		});

		// Click listener on the Details panel
		this.outarea_nodeexplorer_info!.node.addEventListener('click', async (e) => {
			const target = e.target as HTMLElement;

			const stat = target.closest('.selectable-stat') as HTMLElement;
			if (stat) {
				const filterType = stat.getAttribute('data-filter-type');
				const filterDataRaw = stat.getAttribute('data-filter');
				if (!filterType || !filterDataRaw) return;

				const filterJson = filterDataRaw.replace(/&quot;/g, '"');

				const code = `elephant_lab_entity.elephant_lab_tree.select_by_stat('${filterType}', ${filterJson})`;
				const result = await this.kernelBridge!.executeCode(code, null, false);
				this._applyTreeSelection(result);
			}

		});


		// Listener for cell execution
		NotebookActions.executed.connect((sender, exec_data) => {
			if (exec_data.notebook !== newPanel.content) {
				return;
			}
			console.log("Elephant Lab: Cell executed, updating plots.");

			if (this._updateTimer) {
				window.clearTimeout(this._updateTimer);
			}

			this._updateTimer = window.setTimeout(async () => {
				await Promise.all([
					this.kernelBridge!.executeCode(PythonCodeKey.UpdateTree, this.outarea_neo_tree!, false, true, initialSession),
				]);
			}, 500);
		});

		// Listener for changed Kernel, waits for Kernel to be ready
		newPanel.sessionContext.kernelChanged.connect(async (sender, args) => {
			console.log("Elephant Lab: Kernel has changed (restarted).");
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
				console.log("Elephant Lab: New kernel is idle and ready. Re-initializing state.");
			}
		});

		console.log("Elephant Lab: Event listeners registered.");
	}

	private _applyTreeSelection(result: any) {
		if (!result?.resultKey) return;
		const selectedIds: string[] = JSON.parse(result.resultKey);

		this.outarea_neo_tree!.node
			.querySelectorAll('.jup-row.jup-selected')
			.forEach(el => el.classList.remove('jup-selected'));

		selectedIds.forEach(id => {
			const row = this.outarea_neo_tree!.node
				.querySelector(`.jup-row[data-node-id="${id}"]`) as HTMLElement;
			if (row) {
				row.classList.add('jup-selected');
				let parent = row.parentElement;
				while (parent) {
					if (parent.classList.contains('jup-children')) {
						parent.classList.add('jup-open');
						const toggle = parent.previousElementSibling
							?.querySelector('.jup-toggle') as HTMLElement;
						if (toggle) toggle.innerHTML = '<i class="fa fa-minus"></i>';
					}
					parent = parent.parentElement;
				}
			}
		});

		if (selectedIds.length > 0) {
			this._lastClickedNode = selectedIds[selectedIds.length - 1];
		}
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

	public async initializeTab(rendermime: IRenderMimeRegistry) {
		/**
		  * Initialize a new tab for this extension.
		  */

		this.widget.addClass('my-elephant-lab-widget');
		// Set HTML/DOM id
		this.widget.id = 'elephant-lab-right-panel';
		// Title of the tab
		this.widget.title.label = 'Elephant Lab';
		this.widget.title.iconClass = 'elephant-trunk-icon';
		// Adds the x to close the tab?
		this.widget.title.closable = true;
		const session = this.notebook_tracker.currentWidget?.sessionContext;
		if (!session) {
			console.error("Elephant Lab: No notebook session found during UI initialization!");
			return;
		}

		await this.createWidgets(rendermime, session);

	} // end of initializeTab()

	private getFilterStates(): Record<string, boolean> {
		const saved = sessionStorage.getItem('elephant-lab-filter-states');
		return saved ? JSON.parse(saved) : {};
	}

	private saveFilterState(key: string, isChecked: boolean) {
		const states = this.getFilterStates();
		states[key] = isChecked;
		sessionStorage.setItem('elephant-lab-filter-states', JSON.stringify(states));
	}

	public createTopBar(session: ISessionContext) {
		if (this.topBar) {
			this.topBar.dispose();
		}

		const currentFilename = session.path.split('/').pop() || "Unknown Notebook";

		const switchNotebookButton = document.createElement('button');
		switchNotebookButton.innerHTML = `<i class="fa fa-exchange" aria-hidden="true"></i> ${currentFilename}`;
		switchNotebookButton.title = 'Switch Elephant Lab to current active notebook';
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
		infoButton.innerHTML = '<i class="fa fa-info-circle" aria-hidden="true"></i> Elephant Lab';
		infoButton.title = 'About Elephant Lab';
		infoButton.className = 'workflow-button workflow-button-io';
		infoButton.onclick = async () => {
			const result = await this.kernelBridge!.executeCode(PythonCodeKey.Version);

			const body = document.createElement('div');
			body.style.textAlign = 'center';
			body.innerHTML = `
				<p>You are using <a href="https://github.com/INM-6/elephant-lab">Elephant Lab</a> ${result?.outputs[0].text}<br>
				This version is a public preview version. <br>Further Analysis functions will be added in later releases.</p>

				<p>Tobias Michels<br>Jan Nolten<br>Maximilian Kramer<br>Björn Müller<br>Michael Denker<br></p>
				<p><a href="https://www.fz-juelich.de/en/ias/ias-6">
				Institute for Advanced Simulation (IAS-6), <br>
				Computational and Systems Neuroscience, Forschungszentrum Jülich GmbH</a></p><br>
				<img src="${elephantLabLogo}" alt="Elephant Lab Logo" style="display: block; width: 500px; margin: 10px auto 0 auto;">`;
			showDialog({
				title: 'About Elephant Lab',
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
		this.topBar.id = 'elephant-lab-top-bar';
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
			const dialogPromise = FileDialog.getOpenFiles({
				manager: this.docManager
			});

			// Prevent double-click from triggering JupyterLab's file-open handler
			let dialogNode: Element | null = null;
			const stopDblClick = (e: Event) => {
				const item = (e.target as Element).closest('.jp-DirListing-item');
				// Allow double-click on folders so navigation still works
				if (item?.getAttribute('data-isdir') === 'true') {
					return;
				}
				e.stopImmediatePropagation();
				e.stopPropagation();
				const acceptBtn = dialogNode?.querySelector('.jp-Dialog-button.jp-mod-accept') as HTMLElement | null;
				acceptBtn?.click();
			};
			setTimeout(() => {
				dialogNode = document.querySelector('.jp-Dialog');
				if (dialogNode) {
					dialogNode.addEventListener('dblclick', stopDblClick, true);
				}
			}, 0);

			dialogPromise.then(result => {
				if (dialogNode) {
					dialogNode.removeEventListener('dblclick', stopDblClick, true);
				}
				if (result.button.accept && result.value && result.value.length > 0) {
					const selectedFile = result.value[0];
					let filePath = selectedFile.path;
					const slashCount = (session.path.match(/\//g) || []).length;
					if (slashCount !== 0) {
						const prefix = '../'.repeat(slashCount);
						filePath = prefix + filePath;
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
							const varsResult = await this.kernelBridge!.executeCode(PythonCodeKey.GetVars, this.outarea_neo_tree!, false);
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
							await this.kernelBridge!.executeCode(code, this.outarea_neo_tree!, false);
							await this.kernelBridge!.executeCode(PythonCodeKey.UpdateTree, this.outarea_neo_tree!, false);
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
					this.kernelBridge!.executeCode(code, this.outarea_neo_tree, false)
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
					body: 'Elephant Lab is not connected to this notebook. Please switch to the notebook Elephant Lab is attached to.',
					buttons: [Dialog.okButton()]
				});
				return;
			}

			const result = await this.kernelBridge!.executeCode(PythonCodeKey.InsertCode, this.outarea_neo_tree!, false);

			if (result && result.outputs.length > 0) {
				const output = result.outputs[0];
				if (output.output_type === 'stream' && output.name === 'stdout') {
					const data = JSON.parse(output.text);

					if (data.error) {
						console.error("Elephant Lab: Error creating variables from selection:", data.error);
						if (data.traceback) {
							console.error(data.traceback);
						}
						return;
					}

					if (data.code_to_insert) {
						const notebookPanel = this.notebook_tracker.currentWidget;
						if (notebookPanel) {
							const notebook = notebookPanel.content;

							if (data.list_creation_code) {
								// Insert a new code cell above the current cell containing
								// the list creation code, so the list can be recreated
								// after kernel restart by simply re-running that cell.
								const originalCellIndex = notebook.activeCellIndex;
								NotebookActions.insertAbove(notebook);
								const newCell = notebook.activeCell;
								if (newCell) {
									newCell.model.sharedModel.setSource(data.list_creation_code);
								}
								// Move focus back to the original cell (shifted down by 1)
								notebook.activeCellIndex = originalCellIndex + 1;
							}

							const activeCell = notebook.activeCell;
							if (activeCell && activeCell.editor) {
								activeCell.editor.replaceSelection!(data.code_to_insert);
								console.log(`Elephant Lab: Inserted code at cursor.`);
							} else {
								console.log(`Elephant Lab: No active cell or editor found. Could not insert code.`);
							}
						}
					}
				}
			}
		}


		// Annotation filter row
		const annoFilterRow = document.createElement('div');
		annoFilterRow.style.cssText = 'display:flex;gap:4px;align-items:center;padding-top:6px;width:100%;';

		const annoFilterInput = document.createElement('input');
		annoFilterInput.className = 'jp-rawplot-input';
		annoFilterInput.style.flex = '1';
		annoFilterInput.style.minWidth = '0';
		annoFilterInput.placeholder = 'e.g. sua==True AND spike_count>500';
		annoFilterInput.title = 'Filter by annotations: key==value AND/OR key>value ...';

		const annoFilterButton = document.createElement('button');
		annoFilterButton.className = 'workflow-button';
		annoFilterButton.innerHTML = '<i class="fa fa-filter" aria-hidden="true"></i>';
		annoFilterButton.title = 'Apply annotation filter';
		annoFilterButton.onclick = async () => {
			const expression = annoFilterInput.value.trim();

			if (!expression) return;

			const code = getPythonCode(PythonCodeKey.SelectByAnnotationFilter, expression);
			const result = await this.kernelBridge!.executeCode(code, null, false);
			this._applyTreeSelection(result);
			const matched = result?.resultKey ? (JSON.parse(result.resultKey) as string[]) : null;
			if (matched !== null && matched.length === 0) {
				annoFilterInput.classList.remove('anno-filter-no-match');
				void annoFilterInput.offsetWidth;
				annoFilterInput.classList.add('anno-filter-no-match');
			} else {
				annoFilterInput.classList.remove('anno-filter-no-match');
			}
		};
		annoFilterInput.addEventListener('input', () => {
			annoFilterInput.classList.remove('anno-filter-no-match');
		});
		annoFilterInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				annoFilterButton.click();
			}
		});

		annoFilterRow.appendChild(annoFilterInput);
		annoFilterRow.appendChild(annoFilterButton);

		filterContainer.classList.add('sticky-filter');
		filterContainer.appendChild(annoFilterRow);
		filterContainer.appendChild(document.createElement('br'));
		filterContainer.appendChild(document.createElement('br'));
		filterContainer.appendChild(loadNeoFileButton);
		filterContainer.appendChild(saveNeoObjectsButton);
		filterContainer.appendChild(insertCodeButton);

		tree_widget.node.prepend(filterContainer);
	}

	public async create_raw_plot_options(session: ISessionContext, raw_plot_widget: Panel) {
		const settings = await this.settingRegistry.load('elephant-lab:plugin');

		const buttonContainer = document.createElement("div");
		buttonContainer.classList.add("jp-rawplot-button-container");

		const createButton = (icon: string, label: string, description: string, callback: (button: HTMLButtonElement) => void) => {
			const button = document.createElement("button");
			button.type = "button";
			button.classList.add("jp-rawplot-toggle");
			button.innerHTML = `<i class="fa ${icon}"></i> ${label}`;
			button.title = description;
			button.addEventListener("click", () => {
				callback(button);
			});
			buttonContainer.appendChild(button);
			return button;
		}
		const createToggle = (default_value: boolean, icon: string, label: string, description: string, callback: (state: boolean) => void) => {
			const toggle = createButton(icon, label, description, (button: HTMLButtonElement) => {
				let checked = button.getAttribute("aria-pressed") === "false";
				button.setAttribute("aria-pressed", String(checked));
				callback(checked);
			});
			toggle.setAttribute("aria-pressed", String(default_value));
			return toggle;
		};
		const createSavedToggle = (id: PlotSettingsKey, icon: string, label: string, description: string, callback: (state: boolean) => void = (state: boolean) => { }) => {
			const savedToggle = createToggle(false, icon, label, description, async (state: boolean) => {
				await settings.set(id, state);
			});
			this.updateSettingsCallbacks.push({
				ids: [id],
				callback: (newSettings: PlotSettings) => {
					const newValue = newSettings[id] as boolean;
					savedToggle.setAttribute("aria-pressed", String(newValue));
					callback(newValue);
				}
			});
			return savedToggle;
		}

		const darkmodeToggle = createSavedToggle('dark', 'fa-moon', 'Dark', 'Switch between dark and light mode', (state: boolean) => {
			this.plotlyFrontend?.setThemes(state);
		});

		const overlapToggle = createSavedToggle('overlap', 'fa-layer-group', 'Overlap', 'Switch between stacking the graphs vertically or overlapping them');

		const zeroBasedToggle = createSavedToggle('zero_based', 'fa-caret-square-o-left', 'Zero Based', 'Shifts the graphs to start at 0');

		const upscaleButton = createButton('fa-expand-arrows-alt', 'Upscale', 'Replot the graph for the new x range to increase detail', (button: HTMLButtonElement) => {
			const code = getPythonCode(PythonCodeKey.UpscaleRawPlot, this.plotlyFrontend?.getXRanges());
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const resetScaleButton = createButton('fa-undo', 'Reset Scale', 'Reset the x_range to the starting one', (button: HTMLButtonElement) => {
			const code = getPythonCode(PythonCodeKey.ResetScale);
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const normalizeYValuesToggle = createSavedToggle('normalize_y_values', 'fa-compress', 'Normalize Y', 'Normalize the y-values of the plots');

		const optionsModal = document.createElement("div");
		optionsModal.classList.add("jp-rawplot-options-modal");

		// --- OPTIONS MODAL BUTTON ---
		const optionsToggle = createToggle(false, 'fa-cogs', 'Options', '', (state) => {
			optionsModal.classList.toggle("jp-visible", state);
		});

		// Hide options when clicked elsewhere (currently disabled because it seems to annoy more than help)
		/*raw_plot_widget.node.addEventListener("click", (e) => {
			const temp: Node = e.target as Node
			if (!optionsModal.contains(temp) && !optionsToggle.contains(temp)) {
				optionsModal.classList.remove("jp-visible");
				optionsToggle.setAttribute("aria-pressed", "false");
			}
		});*/

		// --- MAX POINTS INPUT ---

		const max_points_id = 'max_points';
		const full_resolution_id = 'full_resolution';

		const applyMaxPoints = async () => {

			let max_points = 0;
			max_points = Number(numberInput.value);
			if (max_points < min_max_points) {
				numberInput.value = min_max_points.toString();
				max_points = min_max_points;
			}

			const fullResolutionChanged =
				(settings.get(full_resolution_id).composite as boolean) !== fullResolutionCheckbox.checked;
			this.suppressSettingsChanged = fullResolutionChanged;
			try {
				await settings.set(max_points_id, max_points);

				if (fullResolutionChanged) {
					// Enable the listener before the final change.
					this.suppressSettingsChanged = false;

					await settings.set(full_resolution_id, fullResolutionCheckbox.checked);
				}
			} finally {
				this.suppressSettingsChanged = false;
			}
		};

		const numberLabel = document.createElement('label');
		numberLabel.innerHTML = `<i class="fa fa-chart-line"></i> Max Points`;
		numberLabel.classList.add("jp-rawplot-label");

		const min_max_points = 10000;
		const numberInput = document.createElement('input');
		numberInput.type = "number";
		const savedMaxPoints = min_max_points;
		numberInput.value = savedMaxPoints.toString();
		numberInput.min = min_max_points.toString();
		numberInput.step = "10000";
		numberInput.classList.add("jp-rawplot-input");

		const maxNumberInput = document.createElement("div");
		maxNumberInput.classList.add("jp-rawplot-row");
		maxNumberInput.title = "Maximum number of points to be plotted. Increasing this number can increase the detail of the plot, but also increases loading times.";

		const savedFullResolution = false;
		const fullResolutionCheckbox = document.createElement("input");
		fullResolutionCheckbox.type = "checkbox";
		fullResolutionCheckbox.checked = savedFullResolution;
		numberInput.disabled = fullResolutionCheckbox.checked;

		const fullResolutionLabel = document.createElement("label");
		fullResolutionLabel.textContent = "Full Resolution";
		fullResolutionLabel.classList.add("jp-rawplot-label");

		numberInput.addEventListener("change", async () => {
			await applyMaxPoints();
		});

		fullResolutionCheckbox.addEventListener("change", async () => {
			numberInput.disabled = fullResolutionCheckbox.checked;
			await applyMaxPoints();
		});

		maxNumberInput.appendChild(numberLabel);
		maxNumberInput.appendChild(numberInput);
		maxNumberInput.appendChild(fullResolutionLabel);
		maxNumberInput.appendChild(fullResolutionCheckbox);

		this.updateSettingsCallbacks.push({
			ids: [max_points_id, full_resolution_id],
			callback: (newSettings: PlotSettings) => {
				numberInput.value = (newSettings.max_points as number).toString();
				fullResolutionCheckbox.checked = newSettings.full_resolution as boolean;
				numberInput.disabled = fullResolutionCheckbox.checked;
			}
		});

		const createLabeledSelect = (options: {
			id: PlotSettingsKey;
			label: string;
			icon?: string;
			selectOptions: string[];
			title?: string;
		}): HTMLDivElement => {
			// Create label
			const labelEl = document.createElement('label');
			labelEl.classList.add("jp-rawplot-label");
			labelEl.innerHTML = options.icon ? `<i class="fa ${options.icon}"></i> ${options.label}` : options.label;

			// Create select
			const selectEl = document.createElement('select');
			selectEl.classList.add("jp-rawplot-select");

			options.selectOptions.forEach(optValue => {
				const opt = document.createElement("option");
				opt.value = optValue;
				opt.textContent = optValue;
				selectEl.appendChild(opt);
			});

			selectEl.onchange = async () => {
				await settings.set(options.id, selectEl.value);
			};

			// Create container
			const container = document.createElement('div');
			container.classList.add("jp-rawplot-row");
			if (options.title) container.title = options.title;
			container.appendChild(labelEl);
			container.appendChild(selectEl);

			this.updateSettingsCallbacks.push({
				ids: [options.id],
				callback: (newSettings: PlotSettings) => {
					selectEl.value = newSettings[options.id] as string;
				}
			});

			return container;
		}

		const normalizationMethod = createLabeledSelect({
			id: "normalization_method",
			label: "Normalization Method",
			icon: "fa-compress",
			selectOptions: ['minmax', 'zscore', 'l2'],
			title: "Method used to normalize the y-values when 'Normalize Y' is enabled"
		});

		type SelectOptionGroup = {
			group: string;
			options: string[];
			collapsed?: boolean;
		};

		const createCollapsibleSelect = (options: {
			id: PlotSettingsKey;
			label: string;
			icon?: string;
			selectOptions: SelectOptionGroup[];
			title?: string;
		}): HTMLDivElement => {

			let currentValue = "";

			// Main container
			const container = document.createElement("div");
			container.classList.add("jp-rawplot-row");

			if (options.title) {
				container.title = options.title;
			}

			// Label
			const labelEl = document.createElement("label");
			labelEl.classList.add("jp-rawplot-label");

			labelEl.innerHTML = options.icon
				? `<i class="fa ${options.icon}"></i> ${options.label}`
				: options.label;

			// Dropdown wrapper
			const wrapper = document.createElement("div");
			wrapper.classList.add("jp-collapsible-select");

			// Current value button
			const button = document.createElement("button");
			button.type = "button";
			button.classList.add("jp-collapsible-select-button");
			button.textContent = currentValue || "Select...";

			// Dropdown panel
			const panel = document.createElement("div");
			panel.classList.add("jp-collapsible-select-panel");
			panel.style.display = "none";

			// Groups
			options.selectOptions.forEach(group => {

				const details = document.createElement("details");

				if (!group.collapsed) {
					details.open = true;
				}

				const summary = document.createElement("summary");
				summary.textContent = group.group;

				details.appendChild(summary);

				group.options.forEach(value => {

					const item = document.createElement("div");
					item.classList.add("jp-collapsible-select-item");

					item.textContent = value;

					item.onclick = async () => {
						await settings.set(options.id, value);
					};

					details.appendChild(item);
				});

				panel.appendChild(details);
			});

			// Toggle dropdown
			button.onclick = (event) => {

				panel.style.display =
					panel.style.display === "none"
						? "block"
						: "none";
			};

			document.addEventListener("click", (event) => {

				const target = event.target as Node;

				const clickedInsideButton = button.contains(target);
				const clickedInsidePanel = panel.contains(target);

				if (!clickedInsideButton && !clickedInsidePanel) {
					panel.style.display = "none";
				}
			});

			document.addEventListener("keydown", (event) => {

				if (event.key === "Escape") {

					panel.style.display = "none";

				}
			});

			wrapper.appendChild(button);
			wrapper.appendChild(panel);

			container.appendChild(labelEl);
			container.appendChild(wrapper);

			this.updateSettingsCallbacks.push({
				ids: [options.id],
				callback: (newSettings: PlotSettings) => {
					currentValue = newSettings[options.id] as string;
					button.textContent = currentValue;
					panel.style.display = "none";
				}
			});

			return container;
		}

		const colorGrade = createCollapsibleSelect({
			id: "color_grade",
			label: "Color Grade",
			icon: "fa-palette",

			selectOptions: [
				{
					group: "Sequential",
					options: [
						"Viridis",
						"Cividis",
						"Inferno",
						"Magma",
						"Plasma",
						"Turbo",
						"Blackbody",
						"Bluered",
						"Electric",
						"Hot",
						"Jet",
						"Rainbow",
						"Plotly3"
					],
					collapsed: false
				},

				{
					group: "Diverging",
					options: [
						"BrBG",
						"RdGy",
						"oxy",
						"Fall",
						"Earth",
						"Picnic",
						"Portland"
					],
					collapsed: true
				},

				{
					group: "Cyclic",
					options: [
						"Twilight",
						"IceFire",
						"Edge",
						"Phase",
						"HSV",
						"mrybm",
						"mygbm"
					],
					collapsed: true
				},
			]
		});

		const resetOptionsButton = createButton('fa-undo-alt', 'Reset Options', 'Reset all options to their default values', async (button: HTMLButtonElement) => {
			const userSettings = settings.user;
			const keys = Object.keys(userSettings);

			this.suppressSettingsChanged = true;

			try {
				for (let i = 0; i < keys.length; i++) {
					// Allow the last remove() to trigger the listener
					if (i === keys.length - 1) {
						this.suppressSettingsChanged = false;
					}

					await settings.remove(keys[i]);
				}
			} finally {
				this.suppressSettingsChanged = false;
			}
		});

		optionsModal.appendChild(maxNumberInput);
		optionsModal.appendChild(normalizationMethod);
		optionsModal.appendChild(colorGrade);
		optionsModal.appendChild(resetOptionsButton);

		buttonContainer.append(
			darkmodeToggle,
			overlapToggle,
			zeroBasedToggle,
			normalizeYValuesToggle,
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

	// Sets up the DragAndDrop Listeners on the Neo Tree Objects
	public setupDragAndDrop(treeWidget: Panel) {
		const observer = new MutationObserver((mutationsList, observer) => {
			// Selector for the elements that represent each node in the Neo tree that hasn't been processed yet
			const treeNodes = treeWidget.node.querySelectorAll('.jup-row:not([data-dnd-setup="true"])');

			if (treeNodes.length > 0) {
				console.log(`Elephant Lab: Found ${treeNodes.length} new tree nodes, setting up drag and drop.`);

				treeNodes.forEach(nodeElement => {
					const htmlElement = nodeElement as HTMLElement;
					htmlElement.dataset.dndSetup = 'true'; // Mark as processed

					// Make the entire node row draggable
					htmlElement.draggable = true;

					htmlElement.addEventListener('dragstart', (event) => {
						const nodeId = htmlElement.dataset.nodeId;
						if (nodeId && event.dataTransfer) {
							const nodeName = (htmlElement.textContent || "").trim().replace(/\s+/g, ' ');

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

							event.stopPropagation();
						}
					});
				});
			}
		});

		// Start observing the tree widget's DOM for changes, and don't disconnect
		observer.observe(treeWidget.node, { childList: true, subtree: true });
	}

	public async createWidgets(rendermime: IRenderMimeRegistry, session: ISessionContext) {
		// NEO TREE 
		let tree_widget = new Panel();
		tree_widget.title.label = 'Neo Tree';
		tree_widget.node.style.cssText = tree_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_neo_tree = this.createOutputArea(rendermime, tree_widget, ['my-outarea-class'], 'jup_vis_out_id_1', session);
		this.create_tree_filter(session, tree_widget);
		this.setupDragAndDrop(tree_widget);
		this.createTopBar(session);

		// INFO
		let explorer_widget_info = new Panel();
		explorer_widget_info.title.label = 'Details';
		explorer_widget_info.node.style.cssText = explorer_widget_info.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_info = this.createOutputArea(rendermime, explorer_widget_info, ['my-outarea-class'], 'jup_vis_out_id_2.1', session);
		this._detailsWidget = explorer_widget_info;

		// RAW
		let explorer_widget_raw_plot = new Panel();
		explorer_widget_raw_plot.title.label = 'Explore';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_raw = this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class'], 'jup_vis_out_id_2.2', session);
		await this.create_raw_plot_options(session, explorer_widget_raw_plot);
		this._explorerWidget = explorer_widget_raw_plot;

		// WORKFLOW OUTPUT (backing OutputArea for the workflow engine's print/error output)
		let workflow_output_widget = new Panel();
		workflow_output_widget.title.label = 'Workflow Output';
		workflow_output_widget.node.style.cssText = workflow_output_widget.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_workflow = this.createOutputArea(rendermime, workflow_output_widget, ['my-outarea-class'], 'jup_vis_out_id_workflow', session);

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget_info, { mode: 'split-bottom', ref: tree_widget });
		this.widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
		this.widget.addWidget(workflow_output_widget, { mode: 'tab-after', ref: explorer_widget_raw_plot });

		// WORKFLOW ENGINE (its own tab in the main area, next to the notebook)
		this.workflowEngine = new WorkflowEngineWidget(session, this.outarea_workflow!, this.notebook_tracker, rendermime, this.docManager);
		const workflowMain = new MainAreaWidget({ content: this.workflowEngine });
		workflowMain.id = 'elephant-lab-workflow-main-widget';
		workflowMain.title.label = 'Elephant Lab Workflow';
		workflowMain.title.closable = true;
		this.app.shell.add(workflowMain, 'main');
		if (!this.widget_tracker.has(workflowMain)) {
			this.widget_tracker.add(workflowMain);
		}
		this.app.shell.activateById(workflowMain.id);
	}

	public neo_tree_filter(checkbox_id: string, session: ISessionContext) {
		let code = getPythonCode(PythonCodeKey.ToggleNeoTreeFilter, checkbox_id);
		this.kernelBridge!.executeCode(code, this.outarea_neo_tree!, false);
	}

	public neo_tree_expand(checked: boolean, session: ISessionContext) {
		let code = getPythonCode(PythonCodeKey.ExpandNeoTree, checked);
		this.kernelBridge!.executeCode(code, this.outarea_neo_tree!, false);
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

	//@ts-ignore
	public registerComm(name: string, context: ISessionContext) {
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

			if (!this.kernelBridge) {
				console.error("KernelBridge not initialized.");
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
			const result = await this.kernelBridge.executeCode(code);
			if (result && result.outputs) {
				const msg_content = result.outputs.map(o => o.text || '').join('');
				if (msg_content) {
					try {
						let validJsonString = msg_content.replace(/'/g, '"');
						let stringArray: string[] = JSON.parse(validJsonString);
						this.createElephantDropdowns(elephant_modules_dropdown, stringArray);
					} catch (e) {
						console.error("Failed to parse elephant modules list from kernel:", e, msg_content);
					}
				}
			}


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
				if (!this.kernelBridge) {
					console.error("KernelBridge not initialized.");
					return;
				}
				const result = await this.kernelBridge.executeCode(code);
				if (result && result.outputs) {
					const msg_content = result.outputs.map(o => o.text || '').join('');
					if (msg_content) {
						try {
							let validJsonString = msg_content.replace(/'/g, '"');
							let stringArray: string[] = JSON.parse(validJsonString);
							console.log("FUNCTIONS: " + stringArray);
							this.updateFunctionDropdown(elephant_functions_dropdown, stringArray);
						} catch (e) {
							console.error("Failed to parse elephant functions list from kernel:", e, msg_content);
						}
					}
				}
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
				if (!this.kernelBridge) {
					console.error("KernelBridge not initialized.");
					return;
				}
				const result = await this.kernelBridge.executeCode(code);
				if (result && result.outputs) {
					const msg_content = result.outputs.map(o => o.text || '').join('');
					if (msg_content) {
						try {
							const data = JSON.parse(msg_content);
							console.log("PARAMS: " + data)
							console.log("PARAMS_type: " + typeof data)
							this.createInputFields(data, paramContainer, session);
						} catch (e) {
							console.error("Failed to parse schema from kernel:", e, msg_content);
						}
					}
				}
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
				                        if (!this.kernelBridge) {
				                            console.error("KernelBridge not initialized.");
				                            return;
				                        }
				                        let code = `
				                            node_id = "${nodeId}"
				                            neo_hash = elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
				                            if neo_hash:
				                                print(neo_hash)
				                            `;
				                        const result = await this.kernelBridge.executeCode(code);
				                        if (result && result.outputs.length > 0 && result.outputs[0].text) {
				                            input.value = result.outputs[0].text.replace("\n", "");
				                        }
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
						if (!this.kernelBridge) {
							console.error("KernelBridge not initialized.");
							return;
						}
						let code = `
							node_id = "${nodeId}"
							neo_hash = elephant_lab_entity.map_ipytree_node_id_to_neo_obj_hash.get(node_id)
							if neo_hash:
								print(neo_hash)
							`;
						const result = await this.kernelBridge.executeCode(code);
						if (result && result.outputs.length > 0 && result.outputs[0].text) {
							input.value = result.outputs[0].text.replace("\n", "");
						}
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

}; // end of ElephantLabExtension class

/*
* Activate the ElephantLabExtension extension
*/
function activate(app: JupyterFrontEnd, command_palette: ICommandPalette, notebook_tracker: INotebookTracker,
	render_mime_registry: IRenderMimeRegistry, restorer: ILayoutRestorer, docManager: IDocumentManager, settingRegistry: ISettingRegistry) {
	/**
	 * Performs the initialization of the extension
	 * Parameters:
	 *     app: Provides access and allows manipulation of the frontend, i.e., tabs and commands, etc. within JupyterLab
	 *     command_palette: Provides access to the CommandPalette panel on the left side, allowing to add new commands
	 *              that can be activated on click
	 *     notebook_tracker: Used to track notebooks and their actions, e.g., which one is active
	 *     restorer: Allows to restore the previous state of the extension at startup
	 */


	console.log('JupyterLab extension Elephant Lab is activated! (OOP)');

	//Track and restore extension's tabs, needs to work together with restoration of main area
	// When Main Area is restored, it needs to get all available Notebooks and Consoles
	// and then check all of them and connect each tab to the right one
	// Tracker has a namespace where everything is saved;
	// this namespace needs to have the same name as in the last session
	// to restore the last session
	let widget_tracker = new WidgetTracker<Widget>({ namespace: 'elephant_lab_namespace' });

	// create instance of ElephantLabExtension
	const jupy_ext = new ElephantLabExtension(app, command_palette, notebook_tracker, widget_tracker, render_mime_registry, docManager, settingRegistry);

	// Add an application command: this is placed into CommandPalette and by clicking on the corresponding button
	// this command will open the elephant lab tab
	const command: string = 'elephant-lab:open';
	jupy_ext.createCommand(command);

	// Restore from corresponding namespace
	restorer.restore(widget_tracker, {
		command,
		name: widget => 'elephant-lab:' + widget.id
	});

};

/*
* Initialization data for the Elephant Lab extension
*/
const extension: JupyterFrontEndPlugin<void> = {
	id: 'elephant-lab:extension',
	autoStart: true,
	// What to pass to the activate function
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer, IDocumentManager, ISettingRegistry],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;