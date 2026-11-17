import { Dialog, showDialog } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { Kernel, ServerConnection, ServiceManager, Session } from '@jupyterlab/services';
import { Signal, ISignal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import { IElephantSession } from './kernel_bridge';

/**
 * Where a kernel came from, from Elephant Lab's point of view:
 * - 'local': backs a notebook tab JupyterLab itself has open right now.
 * - 'external': backs a session (so it has a notebook path) but no local
 *   tab - e.g. the same notebook opened against this jupyter_server from
 *   VS Code, PyCharm, or another JupyterLab window.
 * - 'kernel-only': no session at all - e.g. a console, or a kernel started
 *   directly against /api/kernels.
 */
export type KernelOrigin = 'local' | 'external' | 'kernel-only';

/**
 * One row in the kernel picker: a kernel running on the Jupyter server,
 * whether or not JupyterLab itself ever opened it as a notebook tab.
 */
export interface IKernelEntry {
    id: string;
    name: string;
    /** The notebook path reported by the matching server session, if any. */
    path: string | null;
    /** Human-readable label: the notebook path, or a kernel id/name fallback. */
    label: string;
    origin: KernelOrigin;
}

const ORIGIN_RANK: Record<KernelOrigin, number> = { local: 0, external: 1, 'kernel-only': 2 };
const ORIGIN_BADGE: Record<KernelOrigin, { text: string; title: string }> = {
    local: { text: 'Local', title: 'Open as a notebook tab in this JupyterLab window' },
    external: { text: 'External', title: 'Backs a notebook, but opened elsewhere - e.g. VS Code, PyCharm, or another JupyterLab window' },
    'kernel-only': { text: 'Kernel only', title: 'No notebook session - e.g. a console, or a kernel started directly on the server' },
};

/**
 * GETs `endpoint` (e.g. `api/kernels`) directly against the Jupyter server,
 * bypassing `KernelManager`/`SessionManager`'s own cached, polled models.
 *
 * `listKernelEntries()` used to read `serviceManager.kernels.running()` and
 * `serviceManager.sessions.running()` instead, calling `refreshRunning()`
 * first to force a poll. That looked right, but testing turned up real
 * cases (a kernel belonging to a notebook opened earlier in a long-lived
 * JupyterLab tab) where those manager-side caches stayed stale - missing a
 * kernel/session the server clearly still had - for minutes even across
 * repeated `refreshRunning()` calls, and only a full page reload fixed it.
 * A direct, uncached fetch of the same REST endpoints those managers
 * themselves poll sidesteps whatever staleness/coalescing causes that,
 * since the server is always asked fresh instead of trusting a cache this
 * dialog doesn't control the lifecycle of.
 */
async function fetchJson<T>(serviceManager: ServiceManager.IManager, endpoint: string): Promise<T> {
    const settings = serviceManager.serverSettings;
    const response = await ServerConnection.makeRequest(settings.baseUrl + endpoint, {}, settings);
    if (!response.ok) {
        throw new ServerConnection.ResponseError(response);
    }
    return response.json();
}

/**
 * Classifies and labels every kernel in `kernelModels` as local, external,
 * or kernel-only (see `KernelOrigin`), using `sessionModels` to resolve each
 * one's notebook path where a matching session exists and `localKernelIds`
 * to tell which of those are backed by a notebook tab JupyterLab itself has
 * open right now. A kernel with neither a local tab nor a session (started
 * from a console, or an external client that didn't register one) falls
 * back to its kernel id and kernel name so it stays distinguishable from
 * other such kernels.
 *
 * Pure and synchronous - deliberately kept free of any `ServiceManager`/
 * `NotebookTracker`/network access so it can be unit tested with plain
 * fixture data. `listKernelEntries()` below is the thin, effectful wrapper
 * that gathers those inputs from a live JupyterLab session.
 */
export function buildKernelEntries(
    kernelModels: Kernel.IModel[],
    sessionModels: Session.IModel[],
    localKernelIds: ReadonlySet<string>
): IKernelEntry[] {
    const sessionByKernelId = new Map<string, Session.IModel>();
    for (const session of sessionModels) {
        if (session.kernel?.id) {
            sessionByKernelId.set(session.kernel.id, session);
        }
    }

    const entries: IKernelEntry[] = [];
    for (const kernel of kernelModels) {
        const session = sessionByKernelId.get(kernel.id);
        const path = session?.path ?? null;
        const label = path ? path : `${kernel.name} (${kernel.id.slice(0, 8)})`;
        const origin: KernelOrigin = localKernelIds.has(kernel.id)
            ? 'local'
            : path
                ? 'external'
                : 'kernel-only';
        entries.push({ id: kernel.id, name: kernel.name, path, label, origin });
    }
    // Local kernels first, then external, then kernel-only; alphabetical within each group.
    entries.sort((a, b) => {
        if (a.origin !== b.origin) return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
        return a.label.localeCompare(b.label);
    });
    return entries;
}

/**
 * Lists every kernel currently running on the server, labeling and
 * classifying each via `buildKernelEntries()` - see there for what that
 * means. Gathers that function's inputs from a live JupyterLab session: the
 * kernel/session models via a direct REST fetch (see `fetchJson()` for why
 * not `serviceManager.kernels.running()`), and which of those kernels back
 * a locally-open notebook tab via `notebookTracker`.
 */
export async function listKernelEntries(
    serviceManager: ServiceManager.IManager,
    notebookTracker: INotebookTracker
): Promise<IKernelEntry[]> {
    const [kernelModels, sessionModels] = await Promise.all([
        fetchJson<Kernel.IModel[]>(serviceManager, 'api/kernels'),
        fetchJson<Session.IModel[]>(serviceManager, 'api/sessions')
    ]);

    const localKernelIds = new Set<string>();
    notebookTracker.forEach(panel => {
        const id = panel.sessionContext.session?.kernel?.id;
        if (id) {
            localKernelIds.add(id);
        }
    });

    return buildKernelEntries(kernelModels, sessionModels, localKernelIds);
}

class KernelPickerBody extends Widget implements Dialog.IBodyWidget<string | null> {
    private getSelected: () => string | null;

    constructor(node: HTMLElement, getSelected: () => string | null) {
        super({ node });
        this.getSelected = getSelected;
    }

    getValue(): string | null {
        return this.getSelected();
    }
}

/**
 * Opens a dialog listing every kernel running on the Jupyter server and
 * resolves to the entry the user picked, or `null` if they cancelled.
 *
 * The list is fetched fresh from the server immediately when the dialog
 * opens, and again every few seconds while it stays open, so kernels/
 * sessions started or stopped from an external client (e.g.
 * `curl .../api/kernels`, VS Code, PyCharm) - or a local notebook opened
 * earlier in this same JupyterLab tab, see `listKernelEntries()` - show up
 * reliably.
 */
export async function openKernelPicker(
    serviceManager: ServiceManager.IManager,
    notebookTracker: INotebookTracker
): Promise<IKernelEntry | null> {
    const body = document.createElement('div');
    body.className = 'elephant-lab-kernel-picker';

    const info = document.createElement('div');
    info.className = 'elephant-lab-kernel-picker-info';
    body.appendChild(info);

    const list = document.createElement('div');
    list.className = 'elephant-lab-kernel-list';
    list.setAttribute('role', 'listbox');
    list.tabIndex = 0;
    body.appendChild(list);

    let entries: IKernelEntry[] = [];
    let selectedId: string | null = null;

    const selectRow = (id: string | null, scrollIntoView = false) => {
        selectedId = id;
        for (const row of Array.from(list.children) as HTMLElement[]) {
            const isSelected = row.dataset.id === id;
            row.classList.toggle('elephant-lab-kernel-row-selected', isSelected);
            row.setAttribute('aria-selected', String(isSelected));
            if (isSelected && scrollIntoView) {
                row.scrollIntoView({ block: 'nearest' });
            }
        }
    };

    const render = () => {
        const previous = selectedId;
        list.innerHTML = '';
        info.textContent = entries.length > 0
            ? `${entries.length} running kernel(s) on the server:`
            : 'No running kernels found on this server.';

        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'elephant-lab-kernel-row';
            row.dataset.id = entry.id;
            row.setAttribute('role', 'option');

            const main = document.createElement('div');
            main.className = 'elephant-lab-kernel-row-main';
            const label = document.createElement('div');
            label.className = 'elephant-lab-kernel-row-label';
            label.textContent = entry.label;
            const sub = document.createElement('div');
            sub.className = 'elephant-lab-kernel-row-sub';
            sub.textContent = entry.path
                ? `${entry.name} · ${entry.id.slice(0, 8)}`
                : entry.id.slice(0, 8);
            main.appendChild(label);
            main.appendChild(sub);

            const badge = document.createElement('span');
            const badgeInfo = ORIGIN_BADGE[entry.origin];
            badge.className = `elephant-lab-kernel-badge elephant-lab-kernel-badge-${entry.origin}`;
            badge.textContent = badgeInfo.text;
            badge.title = badgeInfo.title;

            row.appendChild(main);
            row.appendChild(badge);
            row.addEventListener('click', () => selectRow(entry.id));
            row.addEventListener('dblclick', () => {
                selectRow(entry.id);
                (document.querySelector('.jp-Dialog-button.jp-mod-accept') as HTMLElement | null)?.click();
            });

            list.appendChild(row);
        }

        const stillPresent = entries.some(e => e.id === previous);
        selectRow(stillPresent ? previous : entries[0]?.id ?? null);
    };

    const refresh = async () => {
        entries = await listKernelEntries(serviceManager, notebookTracker);
        render();
    };

    await refresh();

    list.addEventListener('keydown', event => {
        if (entries.length === 0) return;
        const currentIndex = entries.findIndex(e => e.id === selectedId);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectRow(entries[Math.min(currentIndex + 1, entries.length - 1)].id, true);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectRow(entries[Math.max(currentIndex - 1, 0)].id, true);
        }
    });

    const pollTimer = window.setInterval(() => void refresh(), 5000);

    const bodyWidget = new KernelPickerBody(body, () => selectedId);

    try {
        const result = await showDialog({
            title: 'Attach to Running Kernel',
            body: bodyWidget,
            buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Attach' })]
        });

        if (!result.button.accept || !result.value) {
            return null;
        }
        return entries.find(e => e.id === result.value) ?? null;
    } finally {
        window.clearInterval(pollTimer);
    }
}

/**
 * Wraps a `Kernel.IKernelConnection` targeted at an arbitrary kernel id
 * (rather than one derived from the currently focused notebook widget) as
 * an `IElephantSession`, so it can be handed to `KernelBridge` and the rest
 * of the Elephant Lab UI exactly like a notebook's real `ISessionContext`.
 */
export class AttachedKernelSession implements IElephantSession {
    readonly session: { kernel: Kernel.IKernelConnection };
    readonly path: string;
    readonly ready: Promise<void> = Promise.resolve();
    private _propertyChanged = new Signal<this, 'path' | 'name' | 'type'>(this);

    constructor(kernel: Kernel.IKernelConnection, path: string) {
        this.session = { kernel };
        this.path = path;
    }

    get propertyChanged(): ISignal<this, 'path' | 'name' | 'type'> {
        return this._propertyChanged;
    }
}
