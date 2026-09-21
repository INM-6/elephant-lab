import * as Plotly from 'plotly.js-dist';
import {
    Widget,
} from '@lumino/widgets';
import { KernelBridge } from './kernel_bridge';

export abstract class PlotContainer {
    /**
     * Creates a fitting container for the plots and
     * all its accessories like loading text
     *
     */
    protected plotKey: string;
    protected kernelBridge: KernelBridge;
    protected wrapper: HTMLDivElement;
    protected container: HTMLDivElement;
    private loading: HTMLDivElement;

    public constructor(plotKey: string, kernelBridge: KernelBridge, outputWidget: Widget | null) {
        this.plotKey = plotKey;
        this.kernelBridge = kernelBridge;
        const wrapper = document.createElement('div');
        wrapper.classList.add('plot-wrapper');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'stretch'; // ensure children stretch vertically
        wrapper.style.minHeight = '300px';

        // Plot container
        const container = document.createElement('div');
        container.classList.add('plot-container');
        container.style.flex = '1'; // fill remaining space
        container.style.minWidth = '0'; // allow shrinking in flex
        wrapper.appendChild(container);

        // Loading overlay
        const loading = document.createElement('div');
        loading.classList.add('plot-loading');
        loading.innerHTML = '⏳ <b>Loading...</b>';
        Object.assign(loading.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.8)',
            color: '#333',
            fontSize: '1.2em',
            zIndex: '10',
            pointerEvents: 'none', // allow interaction if needed
            transition: 'opacity 0.2s',
            opacity: '0',
        });
        wrapper.appendChild(loading);

        if (outputWidget) {
            outputWidget.node.appendChild(wrapper);
        }

        this.wrapper = wrapper;
        this.container = container;
        this.loading = loading;
    }

    public startLoading() {
        /**
         * Displays a loading box
         *
         */
        const gd = this.container as any;
        if (!gd || !gd.data || gd.data.length === 0) {
            // Get the current JupyterLab theme background color
            const rootStyles = getComputedStyle(document.documentElement);
            const layoutColor = rootStyles.getPropertyValue('--jp-layout-color0').trim() || '#f0f0f0';
            const textColor = rootStyles.getPropertyValue('--jp-ui-font-color1').trim() || '#333';
            // No plot yet → loading overlay behaves like "placeholder"
            this.loading.style.backgroundColor = layoutColor;
            this.loading.style.color = textColor;
        } else {
            // Existing plot → dark overlay
            this.loading.style.backgroundColor = 'rgba(0,0,0,0.3)';
            this.loading.style.color = '#fff';
        }
        this.loading.style.opacity = '1';
        this.loading.style.pointerEvents = 'all';
    }

    protected hideLoading() {
        this.loading.style.opacity = '0';
        this.loading.style.pointerEvents = 'none';
    }

    /**
     * Renders the figure out of the figDict
     *
     */
    public abstract render(figDict: any, is_plot_theme_dark: boolean): void;

    public resize() {
        Plotly.Plots.resize(this.container);
    }

    public setTheme(is_dark: boolean) {
        const gd = this.container as any;
        if (!gd || !gd.data) return;

        const theme = is_dark
            ? { paper_bgcolor: '#111111', plot_bgcolor: '#111111', fontColor: '#fff', gridColor: '#444' }
            : { paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', fontColor: '#000', gridColor: '#e5e5e5' };

        const layoutCopy: Partial<Plotly.Layout> = {
            paper_bgcolor: theme.paper_bgcolor,
            plot_bgcolor: theme.plot_bgcolor,
            font: { ...gd.layout?.font, color: theme.fontColor },
        };

        // Cast to any for dynamic axis assignment
        const layoutAny = layoutCopy as any;

        // Loop over all keys in layout that start with "xaxis" or "yaxis"
        Object.keys(gd.layout).forEach((key) => {
            if (key.startsWith('xaxis') || key.startsWith('yaxis')) {
                layoutAny[key] = {
                    ...gd.layout[key], // preserve existing range, tickvals, ticktext
                    gridcolor: theme.gridColor,
                    zerolinecolor: theme.gridColor,
                    color: theme.fontColor,
                };
            }
        });

        // Apply the theme without overwriting ranges, ticks, etc.
        Plotly.relayout(this.container, layoutCopy);
    }

    public destroy() {
        Plotly.purge(this.container);
        this.wrapper.remove();
    }
}