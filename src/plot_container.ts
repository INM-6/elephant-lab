import * as Plotly from 'plotly.js-dist';
import * as noUiSlider from 'nouislider';
import { OutputArea } from '@jupyterlab/outputarea';

export class PlotContainer {
    /**
     * Creates a fitting container for the plots and
     * all its accessories like loading text
     * and y-slider
     *
     */
    private wrapper: HTMLDivElement;
    private container: HTMLDivElement;
    private loading: HTMLDivElement;
    private updateId: number;
    private hasFrames: boolean;
    private slider?: HTMLElement;
    private ticklabel_limit?: number;

    constructor(outputArea: OutputArea | null) {
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

        if (outputArea) {
            outputArea.node.appendChild(wrapper);
        } else {
            document.body.appendChild(wrapper);
        }

        this.wrapper = wrapper;
        this.container = container;
        this.loading = loading;
        this.updateId = -1;
        this.hasFrames = false;
    }

    showLoading() {
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

    hideLoading() {
        this.loading.style.opacity = '0';
        this.loading.style.pointerEvents = 'none';
    }
    setUpdateId(id: number) {
        this.updateId = id;
    }

    canUpdate(newId: number) {
        return newId > this.updateId;
    }

    render(figJson: any, updateId: number, is_plot_theme_dark: boolean) {
        const currentId = updateId;
        const gd = this.container as any;
        if (!gd) return;

        if (this.hasFrames) {
            this.hasFrames = false;
            Plotly.purge(this.container);
        }

        Plotly.react(this.container, figJson.data, figJson.layout).then((gd) => {
            if (this.updateId !== currentId) return;

            if (figJson.frames) {
                this.hasFrames = true;
                Plotly.addFrames(gd, figJson.frames);
            }
            if (figJson.ticklabel_limit) {
                this.ticklabel_limit = figJson.ticklabel_limit;
            } else {
                this.ticklabel_limit = undefined
            }
            if (figJson.y_slider) {
                const [minY, maxY] = figJson.y_slider as [number, number];
                this.addYRangeSlider(minY, maxY);
            } else {
                this.removeYRangeSlider()
            }

            this.setTheme(is_plot_theme_dark)
            this.resize();
        }).catch((err) => {
            console.error('Plotly render error:', err);
        }).finally(() => {
            this.hideLoading();
        });
    }

    addYRangeSlider(minY: number, maxY: number) {
        let sliderInstance;

        // If slider already exists → reuse it
        if (this.slider) {
            sliderInstance = (this.slider as any).noUiSlider;
            if (!sliderInstance) return;

            const currentRange = sliderInstance.options.range;
            const currentMin = currentRange.min;
            const currentMax = currentRange.max;

            const EPSILON = 1e-6;

            const isDifferent =
                Math.abs(currentMin - minY) > EPSILON ||
                Math.abs(currentMax - maxY) > EPSILON;

            // Update only if range changed
            if (isDifferent) {
                sliderInstance.updateOptions({
                    range: {
                        min: minY,
                        max: maxY
                    }
                });
            } else {
                const values = sliderInstance.get(); // returns [min, max] as strings
                minY = Number(values[0]);
                maxY = Number(values[1]);
            }
        } else {
            // --- Create slider (only once) ---
            const slider = document.createElement('div');
            slider.classList.add('my-slider');
            slider.style.width = '20px';
            slider.style.flexShrink = '0';
            slider.style.marginTop = `100px`;
            slider.style.marginBottom = `100px`;
            slider.style.marginLeft = '15px';

            this.wrapper.insertBefore(slider, this.container);

            sliderInstance = noUiSlider.create(slider, {
                start: [minY, maxY],
                connect: true,
                orientation: 'vertical',
                direction: 'rtl',
                range: {
                    min: minY,
                    max: maxY
                }
            });

            sliderInstance.on('update', (values) => {
                const gd = this.container as any;
                if (!gd || !gd.data) return;

                const min = Number(values[0]);
                const max = Number(values[1]);

                const yaxis = gd.layout.yaxis;
                yaxis.range = [min, max];
                yaxis.autorange = false;

                if (this.ticklabel_limit) {
                    const showticklabels = this.ticklabel_limit > max - min;
                    yaxis.showticklabels = showticklabels;
                    yaxis.zeroline = showticklabels;
                    yaxis.showgrid = showticklabels;
                }

                Plotly.relayout(this.container, { yaxis });
            });

            this.slider = slider;
        }

        // ALWAYS trigger update logic
        sliderInstance.set([minY, maxY]);
    }

    removeYRangeSlider() {
        if (!this.slider) return;
        this.slider.remove()
        this.slider = undefined
    }

    resize() {
        Plotly.Plots.resize(this.container);
    }

    setTheme(is_dark: boolean) {
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

    getXRange(): [number, number] | undefined {
        const gd = this.container as any;
        return gd?.layout?.xaxis?.range;
    }

    destroy() {
        Plotly.purge(this.container);
        this.wrapper.remove();
    }
}