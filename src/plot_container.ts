import * as Plotly from 'plotly.js-dist';
import * as noUiSlider from 'nouislider';
import { OutputArea } from '@jupyterlab/outputarea';

export class PlotContainer {
    wrapper: HTMLDivElement;
    container: HTMLDivElement;
    loading: HTMLDivElement;
    updateId: number;
    private slider?: HTMLElement;
    private ticklabel_limit?: number;
    private tickvals?: number[];
    private ticktext?: string[];

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
            if (figJson.ticklabel_limit) {
                this.ticklabel_limit = figJson.ticklabel_limit;
                this.tickvals = figJson.layout.yaxis.tickvals as number[];
                this.ticktext = figJson.layout.yaxis.ticktext as string[];
            } else {
                this.ticklabel_limit = undefined
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

            let update: Partial<Plotly.Layout>;
            if (!this.ticklabel_limit) {
                update = {
                    yaxis: {
                        range: [min, max],
                    }
                };
            } else {
                const showticklabels = this.ticklabel_limit > max - min;
                if (showticklabels) {
                    update = {
                        yaxis: {
                            range: [min, max],
                            showticklabels: showticklabels,
                            zeroline: showticklabels,
                            showgrid: showticklabels,
                            tickvals: this.tickvals,
                            ticktext: this.ticktext
                        }
                    };
                } else {
                    update = {
                        yaxis: {
                            range: [min, max],
                            showticklabels: showticklabels,
                            zeroline: showticklabels,
                            showgrid: showticklabels,
                        }
                    };
                }
            }
            Plotly.relayout(this.container, update);
        });
        this.slider = slider;
    }

    removeYRangeSlider() {
        if (!this.slider) return;
        this.slider.remove()
        this.slider = undefined
    }

    resize() {
        Plotly.Plots.resize(this.container);
    }

    destroy() {
        Plotly.purge(this.container);
        this.wrapper.remove();
    }
}