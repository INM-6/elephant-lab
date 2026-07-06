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
import { PlotlyFrontend } from './plot';
import elephantLabLogo from '../doc/Elephant-Lab-Logo.png';

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
	private output_tabs: DockPanel | null;
	private docManager: IDocumentManager;
	private kernelBridge: KernelBridge | null;
	private topBar: Widget | null = null;
	private plotlyFrontend: PlotlyFrontend | null;
	private _lastClickedNode: string | null = null;
	private _explorerWidget: Panel | null = null;
	private _detailsWidget: Panel | null = null;

	// Construct a new ElephantLabExtension
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
		this.plotlyFrontend = null;
	}; // end of constructor()


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

		this.initializeTab(newPanel.content.rendermime as any);
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

	public initializeTab(rendermime: IRenderMimeRegistry) {
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

		this.createWidgets(rendermime, session);

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
			this.plotlyFrontend?.setThemes(state);
		});

		const overlapToggle = createToggle('fa-layer-group', 'Overlap', 'Switch between stacking the graphs vertically or overlapping them', false, true, (state) => {
			const code = getPythonCode(PythonCodeKey.OverlapToggle, state);
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const zeroBasedToggle = createToggle('fa-caret-square-o-left', 'Zero Based', 'Shifts the graphs to start at 0', false, true, (state) => {
			const code = getPythonCode(PythonCodeKey.ZeroBasedToggle, state);
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const getMaxPoints = () => {
			if (useAllCheckbox.checked) {
				return -1; // convention: all points
			}

			const max_points = Number(numberInput.value);
			if (max_points < min_max_points) {
				numberInput.value = min_max_points.toString();
				return min_max_points;
			} else {
				return max_points;
			}
		}

		const upscaleButton = createToggle('fa-expand-arrows-alt', 'Upscale', 'Replot the graph for the new x range or max points to increase detail', false, false, () => {
			const code = getPythonCode(PythonCodeKey.UpscaleRawPlot, getMaxPoints(), this.plotlyFrontend?.getXRanges());
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const resetScaleButton = createToggle('fa-undo', 'Reset Scale', 'Reset the x_range to the starting one', false, false, () => {
			const code = getPythonCode(PythonCodeKey.ResetScale);
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const normalizeYValuesToggle = createToggle('fa-compress', 'Normalize Y', 'Normalize the y-values of the plots', false, true, (state) => {
			const code = getPythonCode(PythonCodeKey.NormalizeYValuesToggle, state);
			this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
		});

		const optionsModal = document.createElement("div");
		optionsModal.classList.add("jp-rawplot-options-modal");

		// --- OPTIONS MODAL BUTTON ---
		const optionsToggle = createToggle('fa-cogs', 'Options', '', false, true, (state) => {
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

		const applyMaxPoints = () => {

			const code = getPythonCode(
				PythonCodeKey.UpdateMaxPoints,
				getMaxPoints()
			);

			this.kernelBridge!.executeCode(
				code,
				this.outarea_nodeexplorer_raw!,
				false
			);
		};

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

		const useAllCheckbox = document.createElement("input");
		useAllCheckbox.type = "checkbox";

		const useAllLabel = document.createElement("label");
		useAllLabel.textContent = "Use all";
		useAllLabel.classList.add("jp-rawplot-label");

		numberInput.addEventListener("change", () => {
			applyMaxPoints();
		});

		useAllCheckbox.addEventListener("change", () => {
			numberInput.disabled = useAllCheckbox.checked;
			applyMaxPoints();
		});

		maxNumberInput.appendChild(numberLabel);
		maxNumberInput.appendChild(numberInput);
		maxNumberInput.appendChild(useAllLabel);
		maxNumberInput.appendChild(useAllCheckbox);

		function createLabeledSelect(options: {
			label: string;
			icon?: string;
			selectOptions: string[];
			defaultValue?: string;
			title?: string;
			onChange: (value: string) => void;
		}): HTMLDivElement {
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

			if (options.defaultValue) {
				selectEl.value = options.defaultValue;
			}

			selectEl.onchange = () => {
				options.onChange(selectEl.value);
			};

			// Create container
			const container = document.createElement('div');
			container.classList.add("jp-rawplot-row");
			if (options.title) container.title = options.title;
			container.appendChild(labelEl);
			container.appendChild(selectEl);

			return container;
		}

		const normalizationMethod = createLabeledSelect({
			label: "Normalization Method",
			icon: "fa-compress",
			selectOptions: ['minmax', 'zscore', 'l2'],
			defaultValue: 'zscore',
			title: "Method used to normalize the y-values when 'Normalize Y' is enabled",
			onChange: (value) => {
				const code = getPythonCode(PythonCodeKey.SetNormalizationMethod, value);
				this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
			}
		});

		type SelectOptionGroup = {
			group: string;
			options: string[];
			collapsed?: boolean;
		};

		function createCollapsibleSelect(options: {
			label: string;
			icon?: string;
			selectOptions: SelectOptionGroup[];
			defaultValue?: string;
			title?: string;
			onChange: (value: string) => void;
		}): HTMLDivElement {

			let currentValue = options.defaultValue ?? "";

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

					item.onclick = () => {

						currentValue = value;

						button.textContent = value;

						panel.style.display = "none";

						options.onChange(value);
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

			return container;
		}

		const colorGrade = createCollapsibleSelect({
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
			],

			defaultValue: "Viridis",

			onChange: value => {
				const code = getPythonCode(PythonCodeKey.SetColorGrade, value);
				this.kernelBridge!.executeCode(code, this.outarea_nodeexplorer_raw!, false);
			}
		});

		optionsModal.appendChild(maxNumberInput);
		optionsModal.appendChild(normalizationMethod);
		optionsModal.appendChild(colorGrade);

		buttonContainer.append(
			darkmodeToggle,
			overlapToggle,
			zeroBasedToggle,
			upscaleButton,
			resetScaleButton,
			normalizeYValuesToggle,
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
		this._detailsWidget = explorer_widget_info;

		// RAW
		let explorer_widget_raw_plot = new Panel();
		explorer_widget_raw_plot.title.label = 'Explore';
		explorer_widget_raw_plot.node.style.cssText = explorer_widget_raw_plot.node.style.cssText + ' overflow-x: scroll; overflow-y: scroll;';
		this.outarea_nodeexplorer_raw = this.createOutputArea(rendermime, explorer_widget_raw_plot, ['my-outarea-class'], 'jup_vis_out_id_2.2', session);
		this._explorerWidget = explorer_widget_raw_plot;

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget_info, { mode: 'split-bottom', ref: tree_widget });
		this.widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
		this.create_raw_plot_options(session, explorer_widget_raw_plot);
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
}; // end of ElephantLabExtension class

/*
* Activate the ElephantLabExtension extension
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


	console.log('JupyterLab extension Elephant Lab is activated! (OOP)');

	//Track and restore extension's tabs, needs to work together with restoration of main area
	// When Main Area is restored, it needs to get all available Notebooks and Consoles
	// and then check all of them and connect each tab to the right one
	// Tracker has a namespace where everything is saved;
	// this namespace needs to have the same name as in the last session
	// to restore the last session
	let widget_tracker = new WidgetTracker<Widget>({ namespace: 'elephant_lab_namespace' });

	// create instance of ElephantLabExtension
	const jupy_ext = new ElephantLabExtension(app, command_palette, notebook_tracker, widget_tracker, render_mime_registry, docManager);

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
	requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry, ILayoutRestorer, IDocumentManager],
	// activate: Function that is called upon startup of the extension
	// Parameters are passed by the extension framework as specified in 'requires'
	activate: activate
};

// Export the extension to make it known to the extension framework
export default extension;