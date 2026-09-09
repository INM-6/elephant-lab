// Imports for Jupyter
import {
	JupyterFrontEnd,
	JupyterFrontEndPlugin,
	ILayoutRestorer
} from '@jupyterlab/application';

import {
	ICommandPalette,
	WidgetTracker,
	showDialog,
	Dialog
} from '@jupyterlab/apputils';

import {
	IDocumentManager
} from '@jupyterlab/docmanager';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { FileDialog } from '@jupyterlab/filebrowser';

import {
	INotebookModel,
	INotebookTracker,
	NotebookActions,
	NotebookPanel
} from '@jupyterlab/notebook';

import { ToolbarButton } from '@jupyterlab/ui-components';

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
import { MessageLoop } from '@lumino/messaging';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';

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
import { KernelBridge, IElephantSession } from './kernel_bridge';
import { PlotlyFrontend } from './plot';
import { PlotSettings } from './plot_settings';
import { AttachedKernelSession, IKernelEntry, listKernelEntries, openKernelPicker } from './kernel_picker';
import { createAttachedWidgetManager, IAttachedWidgetManager } from './ipywidgets_support';
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
	private output_tabs: DockPanel | null;
	private docManager: IDocumentManager;
	private settingRegistry: ISettingRegistry;
	private rendermime: IRenderMimeRegistry;
	private kernelBridge: KernelBridge | null;
	private topBar: Widget | null = null;
	private plotlyFrontend: PlotlyFrontend | null;
	// The kernel id/name Elephant Lab is currently attached to, however it
	// got there (the active-notebook quick action or the kernel picker).
	// Used to tell whether the notebook currently in the foreground is the
	// one Elephant Lab is watching, and to restore the same attachment
	// after a page reload (see restoreAttachment()).
	private attachedKernelId: string | null = null;
	private attachedKernelName: string | null = null;
	// The Kernel.IKernelConnection attachToKernel() opened via
	// serviceManager.kernels.connectTo(). Unlike a notebook's kernel
	// connection (owned by its NotebookPanel/sessionContext), this one is
	// ours alone - disposed on the next switch so we don't accumulate one
	// open websocket per kernel the picker was ever pointed at.
	private pickedKernelConnection: Kernel.IKernelConnection | null = null;
	// The ipywidgets manager built for pickedKernelConnection - see
	// ipywidgets_support.ts for why this is needed at all. Its rendermime
	// clone (not this.rendermime) is what gets passed to initializeTab() in
	// attachToKernel().
	private pickedWidgetManager: IAttachedWidgetManager | null = null;
	private _lastClickedNode: string | null = null;
	private _explorerWidget: Panel | null = null;
	private _detailsWidget: Panel | null = null;
	private suppressSettingsChanged: boolean = false;
	private updateSettingsCallbacks: UpdateSettingsCallback[] = [];
	private toolbarButtons: ToolbarButton[] = [];

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
		this.rendermime = rendermime;
		// Store references to all tabs containing notebooks
		this.myPanels = [];
		// Store references to all tabs created by this extension
		this.myVisTabs = [];
		// Create SplitPanel, i.e., tab within JupyterLab, with a split view (top part and bottom part)
		this.widget = this.createWidget();
		this.outarea_nodeexplorer_info = null;
		this.outarea_nodeexplorer_raw = null;
		this.outarea_neo_tree = null;
		this.output_tabs = null;
		this.kernelBridge = null;
		this.plotlyFrontend = null;
	}; // end of constructor()

	private createWidget(): DockPanel {
		const widget = new DockPanel({ tabsMovable: false });

		MessageLoop.installMessageHook(widget, (_handler, msg) => {
			if (msg.type === 'after-show') {
				this.topBar?.show();
				this.toolbarButtons.forEach(b => b.node.classList.add('elephant-lab-open'));
			} else if (msg.type === 'before-hide' || msg.type === 'before-detach') {
				this.topBar?.hide();
				this.toolbarButtons.forEach(b => b.node.classList.remove('elephant-lab-open'));
			} else if (msg.type === 'close-request') {
				void this.confirmAndCloseWidget(widget);
				return false;
			}
			return true;
		});

		widget.disposed.connect(() => {
			this.clearActiveNotebookBadge();
		});

		return widget;
	} // end of createWidget()

	private async confirmAndCloseWidget(widget: DockPanel) {
		const result = await showDialog({
			title: 'Close Elephant Lab',
			body: 'Are you sure you want to close Elephant Lab? This will stop the '
				+ 'running Elephant Lab instance. If you only want to hide Elephant Lab, '
				+ 'you can instead hide it by clicking its tab in the sidebar.',
			buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Close' })]
		});
		if (result.button.accept) {
			widget.dispose();
		}
	}

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
	private async initializeKernelState(session: IElephantSession) {
		console.log("Elephant Lab: Initializing kernel state...");
		this.kernelBridge = new KernelBridge(session);
		this.attachedKernelId = session.session?.kernel?.id ?? null;
		this.attachedKernelName = session.session?.kernel?.name ?? null;
		// WidgetTracker only captures getRestoreArgs() once, when a widget is
		// first add()-ed - switching kernels on an already-tracked widget
		// (e.g. via attachToKernel()) doesn't re-trigger that capture on its
		// own. Without this explicit save(), a page reload would restore
		// whatever was attached the first time the panel opened, not the
		// current attachment - defeating restoreAttachment() entirely.
		void this.widget_tracker.save(this.widget);

		await this.kernelBridge.executeCode(PythonCodeKey.SetupEnv);

		console.log("Elephant Lab: Environment setup complete.");
		try {
			// Execute Elephant Lab code to create Neo Tree / Information and Plots
			await this.kernelBridge.executeCode(PythonCodeKey.CreateTree, this.outarea_neo_tree!);
			await this.kernelBridge.executeCode(PythonCodeKey.UpdateTree, this.outarea_neo_tree!, false);
			await this.kernelBridge.executeCode(PythonCodeKey.CreateDetailsPanel, this.outarea_nodeexplorer_info!);
			this.plotlyFrontend = new PlotlyFrontend(session.session!.kernel!, this.outarea_nodeexplorer_raw!);
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
			execute: args => {
				// On restore after a page reload, the layout restorer passes back
				// whatever getRestoreArgs() last recorded (see restoreAttachment()).
				// A manual invocation (command palette, toolbar button) passes none.
				const kernelId = (args?.kernelId as string) || null;
				if (kernelId) {
					return this.restoreAttachment(kernelId, (args?.kernelName as string) || '');
				}
				// The newTab function that contains the main code is called from the command
				return this.newTab();
			}
		});
		// Add the command to the CommandPalette, to make it available on click
		this.command_palette.addItem({ command, category: 'NeuroScience' });
	} // end of createCommand()

	// Add an "Elephant Lab" button to every notebook's own toolbar, so it can
	// be launched without going through the CommandPalette.
	public registerToolbarButton(command: string) {
		this.app.docRegistry.addWidgetExtension('Notebook', {
			createNew: (panel: NotebookPanel, _context: DocumentRegistry.IContext<INotebookModel>): IDisposable => {
				const button = new ToolbarButton({
					iconClass: 'elephant-lab-toolbar-icon',
					tooltip: 'Open Elephant Lab',
					onClick: () => {
						if (this.widget.isAttached && this.widget.isVisible) {
							// close() sends a close-request, which our message hook
							// in createWidget() intercepts to confirm and dispose.
							this.widget.close();
							return;
						}
						this.app.shell.activateById(panel.id);
						this.app.commands.execute(command);
					}
				});
				if (!panel.toolbar.insertBefore('spacer', 'elephantLab', button)) {
					panel.toolbar.addItem('elephantLab', button);
				}
				if (this.widget.isAttached && this.widget.isVisible) {
					button.node.classList.add('elephant-lab-open');
				}
				this.toolbarButtons.push(button);
				return new DisposableDelegate(() => {
					this.toolbarButtons = this.toolbarButtons.filter(b => b !== button);
					button.dispose();
				});
			}
		});
	} // end of registerToolbarButton()

	private clearActiveNotebookBadge() {
		this.notebook_tracker.forEach(notebookWidget => {
			if (notebookWidget.title.className.includes('elephant-lab-active-notebook')) {
				notebookWidget.title.className = notebookWidget.title.className
					.replace('elephant-lab-active-notebook', '')
					.trim();
			}
		});
	}

	// The args getRestoreArgs()/restoreAttachment() pass through the
	// 'elephant-lab:open' command so a page reload can restore the same
	// attachment (see restore Layout wiring in activate()), rather than
	// always falling back to whatever notebook happens to be focused.
	public getRestoreArgs(): { kernelId: string; kernelName: string } {
		return {
			kernelId: this.attachedKernelId ?? '',
			kernelName: this.attachedKernelName ?? '',
		};
	}

	// Restores Elephant Lab's attachment to kernelId after a page reload.
	// Tries, in order: the plain newTab() quick-action path, if the notebook
	// currently focused already happens to be backed by that same kernel
	// (the common case - nothing to do beyond what newTab() already does,
	// and it's the well-exercised path so there's no reason to route around
	// it); the kernel picker's raw-connection path, if the kernel is still
	// running on the server but isn't what's currently focused (this is
	// what fixes the "reload switches an externally-controlled notebook"
	// case, since an externally-controlled kernel has no local tab to focus
	// in the first place); and finally the plain newTab() fallback if the
	// kernel is gone.
	//
	// Deliberately does NOT hunt through notebook_tracker for some other,
	// not-currently-focused local tab backed by kernelId and force newTab()
	// to target it directly: during restoration, notebook_tracker can
	// contain panels whose sessionContext has a kernel id already but whose
	// own initialize() JupyterLab hasn't gotten around to running yet, and
	// targeting one of those makes newTab() hang forever awaiting
	// `sessionContext.ready`. Going through attachToKernel()'s raw
	// KernelConnection instead sidesteps that race entirely.
	private async restoreAttachment(kernelId: string, kernelName: string) {
		await this.notebook_tracker.restored;

		if (this.notebook_tracker.currentWidget?.sessionContext.session?.kernel?.id === kernelId) {
			await this.newTab();
			return;
		}

		await this.app.serviceManager.kernels.ready;
		await this.app.serviceManager.kernels.refreshRunning();
		const entries = listKernelEntries(this.app.serviceManager, this.notebook_tracker);
		const entry = entries.find(e => e.id === kernelId);
		if (entry) {
			await this.attachToKernel(entry);
			return;
		}

		console.log(`Elephant Lab: Previously attached kernel ${kernelId} (${kernelName}) is no longer running; falling back to the active notebook.`);
		await this.newTab();
	}

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
		if (this.widget.isDisposed) {
			this.widget = this.createWidget();
		}

		this.clearActiveNotebookBadge();

		newPanel.title.className += ' elephant-lab-active-notebook';

		if (!force && this.widget.isAttached) {
			console.log("Elephant Lab: Existing widgets found, activating them.");
			this.app.shell.activateById(this.widget.id);
			return;
		}

		console.log("Elephant Lab: Creating new Elephant Lab instance.");

		this.disposePickedKernelConnection();

		// Clear the panel before adding new widgets
		const oldWidgets = Array.from(this.widget.widgets());
		for (const w of oldWidgets) {
			w.dispose();
		}
		if (this.output_tabs) {
			this.output_tabs.dispose();
			this.output_tabs = null;
		}

		const initialSession = newPanel.sessionContext;
		await this.initializeTab(newPanel.content.rendermime as any, initialSession);
		this.myVisTabs.push(this.widget);
		this.myPanels.push(newPanel);
		this.attachTab();

		await initialSession.ready;
		await this.initializeKernelState(initialSession);

		this.registerTabSyncListener();
		this.registerTreeInteractionListeners();

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

	// Keeps the backend in sync when the user switches between the Details
	// and Explore tabs. Shared by newTab() and attachToKernel() since neither
	// this nor its captured state (this.kernelBridge, this._detailsWidget,
	// this._explorerWidget) depends on how Elephant Lab got attached to a kernel.
	private registerTabSyncListener() {
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
	}

	// Handle HTML tree interactions (expand/collapse + selection) and Details
	// panel stat clicks. Shared by newTab() and attachToKernel() - purely a
	// function of this.outarea_neo_tree / this.outarea_nodeexplorer_info /
	// this.kernelBridge, none of which depend on how Elephant Lab got
	// attached to a kernel.
	private registerTreeInteractionListeners() {
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
	}

	/**
	 * Attaches Elephant Lab to an arbitrary kernel running on the Jupyter
	 * server, selected via the kernel picker - as opposed to newTab(), which
	 * always attaches to the currently focused notebook widget. This covers
	 * kernels that JupyterLab itself never opened as a notebook tab, e.g. a
	 * notebook opened against the same jupyter_server from VS Code or
	 * PyCharm, or a kernel started directly against /api/kernels.
	 *
	 * Cell-execution auto-refresh and kernel-restart recovery (registered in
	 * newTab() via NotebookActions.executed / sessionContext.kernelChanged)
	 * are notebook-tab features and are intentionally not replicated here:
	 * JupyterLab has no visibility into cells executed by another client, so
	 * there is nothing for it to listen to. The tree still refreshes on the
	 * next explicit interaction (e.g. reopening Elephant Lab).
	 */
	// Disposes the kernel connection opened by a previous attachToKernel()
	// call, if any. Called before switching to a new target (another picked
	// kernel, or back to a notebook via the quick action) so repeated
	// switches don't leave one open websocket per kernel ever visited.
	private disposePickedKernelConnection() {
		if (this.pickedWidgetManager) {
			this.pickedWidgetManager.dispose();
			this.pickedWidgetManager = null;
		}
		if (this.pickedKernelConnection && !this.pickedKernelConnection.isDisposed) {
			this.pickedKernelConnection.dispose();
		}
		this.pickedKernelConnection = null;
	}

	public async attachToKernel(entry: IKernelEntry) {
		if (this.widget.isDisposed) {
			this.widget = this.createWidget();
		}

		this.clearActiveNotebookBadge();
		// If the picked kernel also happens to back a notebook tab that's
		// open locally, badge it too, consistent with the quick-action flow.
		this.notebook_tracker.forEach(notebookWidget => {
			if (notebookWidget.sessionContext.session?.kernel?.id === entry.id) {
				notebookWidget.title.className += ' elephant-lab-active-notebook';
			}
		});

		this.disposePickedKernelConnection();

		// Clear the panel before adding new widgets
		const oldWidgets = Array.from(this.widget.widgets());
		for (const w of oldWidgets) {
			w.dispose();
		}
		if (this.output_tabs) {
			this.output_tabs.dispose();
			this.output_tabs = null;
		}

		const kernel = this.app.serviceManager.kernels.connectTo({ model: { id: entry.id, name: entry.name } });
		this.pickedKernelConnection = kernel;
		const session = new AttachedKernelSession(kernel, entry.label);

		// A real notebook gets an ipywidgets manager for free, attached to its
		// own rendermime clone by JupyterLab's ipywidgets extension. This
		// kernel has no notebook, so build the same thing ourselves - without
		// it, the Neo Tree and Details panels (both ipywidgets-based) would
		// render nothing but a permanent "Loading widget..." placeholder.
		this.pickedWidgetManager = createAttachedWidgetManager(kernel, this.rendermime);

		await this.initializeTab(this.pickedWidgetManager.rendermime, session);
		this.myVisTabs.push(this.widget);
		this.attachTab();

		await this.initializeKernelState(session);

		this.registerTabSyncListener();
		this.registerTreeInteractionListeners();

		console.log(`Elephant Lab: Attached to kernel ${entry.id} (${entry.label}).`);
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

	public async initializeTab(rendermime: IRenderMimeRegistry, session: IElephantSession) {
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

	public createTopBar(session: IElephantSession) {
		if (this.topBar) {
			this.topBar.dispose();
		}

		// What Elephant Lab is actually attached to right now - a notebook
		// path when reached via the quick action (or a kernel-picker entry
		// that resolved to a session path), or a kernel id/name fallback when
		// attached via the picker to a kernel with no matching session.
		const attachedLabel = document.createElement('span');
		attachedLabel.className = 'elephant-lab-attached-label';
		attachedLabel.style.marginRight = '8px';
		attachedLabel.title = 'The kernel Elephant Lab is currently attached to';
		const setAttachedLabel = (path: string) => {
			attachedLabel.innerHTML = `<i class="fa fa-link" aria-hidden="true"></i> ${path.split('/').pop() || path}`;
		};
		setAttachedLabel(session.path);
		session.propertyChanged.connect((sender, prop) => {
			if (prop === 'path') {
				setAttachedLabel(sender.path);
			}
		});

		// Split button: the wide part is the quick action (always names the
		// notebook currently focused in JupyterLab, since that - not
		// whatever Elephant Lab happens to be attached to - is what clicking
		// it switches Elephant Lab to); the narrow caret opens the full
		// kernel picker. Joined into one control to save toolbar space.
		const switchNotebookButton = document.createElement('button');
		switchNotebookButton.title = 'Switch Elephant Lab to current active notebook';
		switchNotebookButton.className = 'workflow-button workflow-button-io elephant-lab-split-main';
		const setSwitchButtonLabel = () => {
			const activeName = this.notebook_tracker.currentWidget?.sessionContext.path.split('/').pop();
			switchNotebookButton.innerHTML = `<i class="fa fa-exchange" aria-hidden="true"></i> ${activeName ?? 'Active Notebook'}`;
		};
		setSwitchButtonLabel();
		this.notebook_tracker.currentChanged.connect(setSwitchButtonLabel);
		switchNotebookButton.onclick = () => {
			this.newTab(true);
		};

		const browseKernelsButton = document.createElement('button');
		browseKernelsButton.innerHTML = '<i class="fa fa-caret-down" aria-hidden="true"></i>';
		browseKernelsButton.title = 'Attach Elephant Lab to any kernel running on this Jupyter server '
			+ '(including ones opened from VS Code, PyCharm, or another external client)';
		browseKernelsButton.className = 'workflow-button workflow-button-io elephant-lab-split-arrow';
		browseKernelsButton.onclick = async () => {
			const entry = await openKernelPicker(this.app.serviceManager, this.notebook_tracker);
			if (entry) {
				await this.attachToKernel(entry);
			}
		};

		const switcherContainer = document.createElement('div');
		switcherContainer.className = 'elephant-lab-split-button';
		switcherContainer.appendChild(switchNotebookButton);
		switcherContainer.appendChild(browseKernelsButton);

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
		container.appendChild(attachedLabel);
		container.appendChild(switcherContainer);
		container.appendChild(infoButton);

		this.topBar = new Widget();
		this.topBar.node.appendChild(container);
		this.topBar.id = 'elephant-lab-top-bar';
		this.topBar.node.style.marginLeft = 'auto';

		this.app.shell.add(this.topBar, 'top', { rank: 1000 });
		if (!this.widget.isVisible) {
			this.topBar.hide();
		}
	}

	public create_tree_filter(session: IElephantSession, tree_widget: Panel) {
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
			// Compare kernel ids rather than session paths: when Elephant Lab
			// is attached via the kernel picker there may be no local
			// notebook path to compare against at all, but the check still
			// needs to hold - inserting code only makes sense into a notebook
			// tab that is actually backed by the kernel we're attached to.
			const currentNotebook = this.notebook_tracker.currentWidget;
			if (!currentNotebook || currentNotebook.sessionContext.session?.kernel?.id !== this.attachedKernelId) {
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

	public async create_raw_plot_options(session: IElephantSession, raw_plot_widget: Panel) {
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

	public async createWidgets(rendermime: IRenderMimeRegistry, session: IElephantSession) {
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
		await this.create_raw_plot_options(session, explorer_widget_raw_plot);
		this._explorerWidget = explorer_widget_raw_plot;

		this.widget.addWidget(tree_widget);
		this.widget.addWidget(explorer_widget_info, { mode: 'split-bottom', ref: tree_widget });
		this.widget.addWidget(explorer_widget_raw_plot, { mode: 'tab-after', ref: explorer_widget_info });
	}

	public neo_tree_filter(checkbox_id: string, session: IElephantSession) {
		let code = getPythonCode(PythonCodeKey.ToggleNeoTreeFilter, checkbox_id);
		this.kernelBridge!.executeCode(code, this.outarea_neo_tree!, false);
	}

	public neo_tree_expand(checked: boolean, session: IElephantSession) {
		let code = getPythonCode(PythonCodeKey.ExpandNeoTree, checked);
		this.kernelBridge!.executeCode(code, this.outarea_neo_tree!, false);
	}

	public createOutputArea(rendermime: IRenderMimeRegistry, tab: Panel, cls: string[], id: string, session: IElephantSession): OutputArea {
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
	jupy_ext.registerToolbarButton(command);

	// Restore from corresponding namespace
	restorer.restore(widget_tracker, {
		command,
		args: () => jupy_ext.getRestoreArgs(),
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