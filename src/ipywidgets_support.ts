import { Kernel } from '@jupyterlab/services';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { KernelWidgetManager, WidgetRenderer, output as ipywidgetsOutput } from '@jupyter-widgets/jupyterlab-manager';
import * as base from '@jupyter-widgets/base';
import * as controls from '@jupyter-widgets/controls';
import { JUPYTER_CONTROLS_VERSION } from '@jupyter-widgets/controls/lib/version';

const WIDGET_VIEW_MIMETYPE = 'application/vnd.jupyter.widget-view+json';

export interface IAttachedWidgetManager {
    /** A rendermime clone with the widget-view renderer bound to `manager`. Pass this to createOutputArea(), not the app-wide registry. */
    rendermime: IRenderMimeRegistry;
    dispose(): void;
}

/**
 * A real notebook gets a Jupyter Widgets manager for free: the
 * @jupyter-widgets/jupyterlab-manager extension attaches one automatically
 * to every NotebookPanel's own rendermime clone as soon as the panel opens.
 * A kernel attached via the kernel picker has no such notebook, so without
 * this, Elephant Lab's ipywidgets-based Neo Tree and Details panel output
 * (see elephant_lab_tree.py / elephant_lab_info.py, which display
 * ipywidgets.HTML / ipywidgets.Output) would render nothing but a permanent
 * "Loading widget..." placeholder - the comm_open messages ipywidgets sends
 * have no manager listening for them, so they're silently dropped.
 *
 * This builds Elephant Lab's own, self-contained widget manager for an
 * arbitrary kernel: a fresh rendermime clone (so the app-wide registry is
 * never mutated) plus a KernelWidgetManager - the same class JupyterLab's
 * own ipywidgets extension uses for console panels - registered with the
 * same base/controls/output widget sets that extension registers for real
 * notebooks. There's no supported way to reuse that extension's own
 * manager instance from outside it (its widget-class registry and its
 * kernel-id-to-manager map are both private module state), but a widget
 * manager only needs to speak the standard Jupyter widget comm protocol to
 * interoperate correctly - it doesn't need to be that same instance.
 */
export function createAttachedWidgetManager(
    kernel: Kernel.IKernelConnection,
    baseRendermime: IRenderMimeRegistry
): IAttachedWidgetManager {
    const rendermime = baseRendermime.clone();
    const manager = new KernelWidgetManager(kernel, rendermime);

    manager.register({
        name: '@jupyter-widgets/base',
        version: base.JUPYTER_WIDGETS_VERSION,
        exports: {
            WidgetModel: base.WidgetModel,
            WidgetView: base.WidgetView,
            DOMWidgetView: base.DOMWidgetView,
            DOMWidgetModel: base.DOMWidgetModel,
            LayoutModel: base.LayoutModel,
            LayoutView: base.LayoutView,
            StyleModel: base.StyleModel,
            StyleView: base.StyleView,
            ErrorWidgetView: base.ErrorWidgetView,
        },
    });
    manager.register({
        name: '@jupyter-widgets/controls',
        version: JUPYTER_CONTROLS_VERSION,
        // The controls module exports plain functions/classes beyond the
        // {name: WidgetModel | WidgetView} shape ExportMap declares (e.g.
        // version constants); ipywidgets' own registration of this same
        // module takes the same liberty.
        exports: controls as unknown as base.ExportMap,
    });
    manager.register({
        name: '@jupyter-widgets/output',
        version: ipywidgetsOutput.OUTPUT_WIDGET_VERSION,
        exports: {
            OutputModel: ipywidgetsOutput.OutputModel,
            OutputView: ipywidgetsOutput.OutputView,
        },
    });

    // Replace the placeholder widget renderer with one bound to our manager,
    // exactly as registerWidgetHandler() does for a real notebook/console -
    // just on our own rendermime clone instead of a notebook's.
    rendermime.removeMimeType(WIDGET_VIEW_MIMETYPE);
    rendermime.addFactory(
        {
            safe: false,
            mimeTypes: [WIDGET_VIEW_MIMETYPE],
            createRenderer: options => new WidgetRenderer(options, manager),
        },
        -10
    );

    return {
        rendermime,
        dispose: () => {
            rendermime.removeMimeType(WIDGET_VIEW_MIMETYPE);
            manager.dispose();
        },
    };
}
