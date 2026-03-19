import { KernelMessage, Session } from '@jupyterlab/services';
import { OutputArea } from '@jupyterlab/outputarea';
import * as Plotly from 'plotly.js-dist';
import * as noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';

class PlotContainer {
    wrapper: HTMLDivElement;
    container: HTMLDivElement;
    loading: HTMLDivElement;
    updateId: number;
    private slider?: HTMLElement;
    private resizeObserver?: ResizeObserver;
    private destroyed = false;

    constructor(outputArea: OutputArea | null) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('plot-wrapper');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'stretch'; // ensure children stretch vertically

        // Loading overlay
        const loading = document.createElement('div');
        loading.classList.add('plot-loading');
        loading.innerHTML = '⏳ <b>Loading...</b>';
        wrapper.appendChild(loading);

        // Plot container
        const container = document.createElement('div');
        container.classList.add('plot-container');
        container.style.flex = '1'; // fill remaining space
        container.style.minWidth = '0'; // allow shrinking in flex
        wrapper.appendChild(container);

        if (outputArea) {
            outputArea.node.appendChild(wrapper);
        } else {
            document.body.appendChild(wrapper);
        }

        this.wrapper = wrapper;
        this.container = container;
        this.loading = loading;
        this.updateId = -1;
    }

    showLoading() {
        this.loading.style.display = 'block';
    }

    hideLoading() {
        this.loading.style.display = 'none';
    }

    setUpdateId(id: number) {
        this.updateId = id;
    }

    canUpdate(newId: number) {
        return newId > this.updateId;
    }

    render(figJson: any, updateId: number) {
        const currentId = updateId;

        Plotly.react(this.container, figJson.data, figJson.layout).then((gd) => {
            if (this.updateId !== currentId) return;

            if (figJson.frames) {
                Plotly.addFrames(gd, figJson.frames);
            }
            if (figJson.y_slider) {
                const [minY, maxY] = figJson.y_slider as [number, number];
                this.addYRangeSlider(minY, maxY);
            } else {
                this.removeYRangeSlider()
            }
        })
            .catch((err) => {
                console.error('Plotly render error:', err);
            });
    }

    addYRangeSlider(minY: number, maxY: number) {
        if (this.slider) return;

        const slider = document.createElement('div');
        slider.classList.add('my-slider');
        slider.style.width = '20px';
        slider.style.flexShrink = '0';
        slider.style.marginTop = `100px`;
        slider.style.marginBottom = `100px`;
        slider.style.marginLeft = '15px'
        this.wrapper.insertBefore(slider, this.container);
        const sliderInstance = noUiSlider.create(slider, {
            start: [minY, maxY], // initial range
            connect: true,   // enables colored range between handles
            orientation: 'vertical',
            direction: 'rtl', // makes lower value at bottom (feels natural for Y)
            range: {
                min: minY,
                max: maxY
            }
        });
        sliderInstance.on('update', (values) => {
            const min = Number(values[0]);
            const max = Number(values[1]);

            Plotly.relayout(this.container, {
                'yaxis.range': [min, max]
            });
        });
        this.slider = slider;
    }

    removeYRangeSlider() {
        if (!this.slider) return;
        this.slider.remove()
        this.slider = undefined
    }

    attachResizeObserver() {
        if (this.resizeObserver) return;

        let retryTimeout: number | null = null;

        const safeResizePlot = () => {
            if (this.destroyed) return;
            const rect = this.container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                Plotly.Plots.resize(this.container);
            } else if (retryTimeout === null) {
                retryTimeout = window.setTimeout(() => {
                    retryTimeout = null;
                    safeResizePlot();
                }, 100);
            }
        };

        this.resizeObserver = new ResizeObserver(safeResizePlot);
        this.resizeObserver.observe(this.container);
    }

    destroy() {
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        Plotly.purge(this.container);
        this.wrapper.remove();
    }
}

export class PlotlyFrontend {
    private session: Session.ISessionConnection;
    private plots: Map<string, PlotContainer> = new Map();
    private outputArea: OutputArea | null;

    constructor(session: Session.ISessionConnection, outputArea: OutputArea | null = null) {
        this.session = session;
        this.outputArea = outputArea;

        // Register the comm target to receive messages from Python
        this.session.kernel?.registerCommTarget(
            'plot_channel',
            (comm, msg) => {
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );
    }

    private handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
        const data = msg.content.data;

        switch (data.type) {
            case 'plots_remove':
                const plotsRaw1 = data.plots as unknown[];
                // filter only strings
                const plots1: string[] = Array.isArray(plotsRaw1)
                    ? plotsRaw1.filter((x): x is string => typeof x === 'string')
                    : [];
                this.handleRemove(plots1);
                break;
            case 'plots_loading':
                const plotsRaw2 = data.plots as unknown[];
                const plots2: string[] = Array.isArray(plotsRaw2)
                    ? plotsRaw2.filter((x): x is string => typeof x === 'string')
                    : [];
                this.handleLoading(plots2);
                break;
            case 'plots_update':
                const figs = (data.plots as Record<string, any>) ?? {};
                const updateId = typeof data.update_id === 'number' ? data.update_id : -1;
                this.handleUpdate(figs, updateId);
                break;
            default:
                console.warn('Unknown plot message type', data.type);
        }
    }

    private handleRemove(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            const state = this.plots.get(key);
            if (state) {
                state.destroy()
                this.plots.delete(key);
            }
        });
    }

    private handleLoading(plotKeys: string[]) {
        plotKeys.forEach((key) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotContainer(this.outputArea);
                this.plots.set(key, state);
            }
            state.showLoading()
        });
    }

    private handleUpdate(figs: Record<string, any>, updateId: number) {
        Object.entries(figs).forEach(([key, figJson]) => {
            let state = this.plots.get(key);
            if (!state) {
                state = new PlotContainer(this.outputArea);
                this.plots.set(key, state);
            }
            if (!state.canUpdate(updateId)) return;

            state.hideLoading()

            state.setUpdateId(updateId)
            state.render(figJson, updateId)

            state.attachResizeObserver();
        });
    }
}