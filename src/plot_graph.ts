import * as Plotly from 'plotly.js-dist';
import * as noUiSlider from 'nouislider';
import {
    PythonCodeKey,
    getPythonCode
} from './kernelcode';
import { PlotContainer } from './plot_container';
import { FigureDict, PlotResponse } from './plot_graph_interfaces';

export class PlotGraph extends PlotContainer {

    //private static readonly vertical_spacing = 0.075

    private slider?: HTMLElement;

    // @ts-ignore
    private figureDict: FigureDict;

    private data: Plotly.Data[] = [];
    private layout: Partial<Plotly.Layout> = {};
    private hasCustomTickLabels = false;
    private height: number = 0;
    private ticktext: string[] = [];
    private hideLegend?: boolean;
    private lastSampledXRange?: [number, number];
    private relayoutTimeout: ReturnType<typeof setTimeout> | null = null;


    public render(figDict: any, is_plot_theme_dark: boolean) {
        const gd = this.container as any;
        if (!gd) return;

        this.figureDict = figDict as FigureDict;

        this.data = [];
        this.layout = {};
        this.hasCustomTickLabels = false;
        this.ticktext = [];
        this.hideLegend = undefined;
        this.lastSampledXRange = undefined;

        if (this.hasSameY() && (this.figureDict.data_bundle.nGraphs == 1 || this.shouldOverlap())) {
            this.height = 200;
        } else if (this.figureDict.data_bundle.nGraphs > 2 && !this.shouldOverlap()) {
            this.height = 800;
        } else {
            this.height = 600;
        }
        if (!this.isSinglePlot()) {
            this.layout.grid = {
                rows: this.figureDict.data_bundle.nGraphs,
                columns: 1,
                roworder: "bottom to top"
            };
        }

        this.addData();

        this.layout.title = {
            'text': this.figureDict.title,
            'x': 0.5,
            'xanchor': 'center'
        }
        this.layout.dragmode = 'pan';
        this.layout.height = this.height;
        this.layout.autosize = true;

        this.manageTickLabels();
        this.manageLegend();
        this.manageAxisUnits();
        this.createXSlider();
        /*for (let i = 1; i <= this.figureDict.data_bundle.nGraphs; i++) {
            this.updateLayoutAxis(`xaxis${i}`, {
                range: [this.figureDict.data_bundle.minX, this.figureDict.data_bundle.maxX],
            });
        }*/

        Plotly.react(this.container, this.data, this.layout).then((gd) => {
            this.setTheme(is_plot_theme_dark);
            if (this.shouldHaveYSlider()) {
                this.addYRangeSlider();
            } else {
                this.removeYRangeSlider()
            }
            this.resize();
            this.saveXRange(gd.layout?.xaxis?.range as [number, number] | undefined);
            gd.on('plotly_relayout', async (event) => {
                const xRange = gd.layout?.xaxis?.range as [number, number] | undefined;

                if (
                    !this.lastSampledXRange ||
                    !xRange ||
                    (Math.abs(this.lastSampledXRange[0] - xRange[0]) <= 1e-6 &&
                        Math.abs(this.lastSampledXRange[1] - xRange[1]) <= 1e-6)
                ) {
                    return;
                }

                // Cancel any pending update
                if (this.relayoutTimeout) {
                    clearTimeout(this.relayoutTimeout);
                }

                // Schedule a new one
                this.relayoutTimeout = setTimeout(() => {
                    this.saveXRange(xRange);

                    const code = getPythonCode(
                        PythonCodeKey.GetNormalizedDataForPlotWithXRange,
                        this.plotKey,
                        xRange
                    );

                    this.kernelBridge.executeCode(code);

                    this.relayoutTimeout = null;
                }, 75); // delay
            });
        }).catch((err) => {
            console.error('Plotly render error:', err);
        }).finally(() => {
            this.hideLoading();
            this.data = [];
            this.layout = {};
        });
    }

    public resample(dataBundle: PlotResponse) {
        if (dataBundle.plotly_graph_data_list_changed) {
            const indices = [];
            const x = [];
            const y = [];
            for (const plotGraphData of dataBundle.plotly_graph_data_list) {
                indices.push(plotGraphData.index);
                const currentPlotGraphData = this.figureDict.data_bundle.plotly_graph_data_list[plotGraphData.index];
                currentPlotGraphData.x = plotGraphData.x;
                currentPlotGraphData.y = plotGraphData.y;
                x.push(plotGraphData.x);
                y.push(plotGraphData.y);
            }
            Plotly.restyle(
                this.container,
                { x, y },
                indices
            );
        }
    }

    private addData(): void {
        for (let i = 0; i < this.figureDict.data_bundle.plotly_graph_data_list.length; i++) {
            const graphData = this.figureDict.data_bundle.plotly_graph_data_list[i];

            const default_marker = {
                size: 6,
            }
            const default_line = {
                width: 1,
            }

            const marker_settings = graphData.marker ? { ...default_marker, ...graphData.marker } : default_marker;
            const line_settings = graphData.line ? { ...default_line, ...graphData.line } : default_line;
            let trace: Partial<Plotly.ScatterData> = {
                type: "scattergl",
                x: graphData.x,
                y: graphData.y,
                name: graphData.name,
                mode: graphData.mode as any,
                marker: marker_settings,
                line: line_settings
            };
            const global_index = graphData.index;
            if (this.isSinglePlot()) {
                if (this.canHaveCustomTickLabels() && graphData.use_name_as_ticklabels) {
                    if (this.figureDict.data_bundle.compress) {
                        this.ticktext.push(graphData.name);
                    } else {
                        this.layout.yaxis = {
                            ...this.layout.yaxis,
                            tickvals: [0],
                            ticktext: [graphData.name],
                        };
                    }
                }
            } else {
                const row = global_index + 1;
                trace = {
                    ...trace,
                    yaxis: `y${row}`,
                };

                if (graphData.units_y !== undefined) {
                    this.updateLayoutAxis(`yaxis${row}`, {
                        title: {
                            text: graphData.units_y,
                        }
                    });
                }
                if (this.canHaveCustomTickLabels() && graphData.use_name_as_ticklabels) {
                    this.hasCustomTickLabels = true;

                    this.updateLayoutAxis(`yaxis${row}`, {
                        tickvals: [0],
                        ticktext: [graphData.name],
                    });

                    if (this.hideLegend !== undefined) {
                        if (!graphData.use_name_as_ticklabels) {
                            this.hideLegend = false;
                        }
                    } else {
                        this.hideLegend = graphData.use_name_as_ticklabels;
                    }
                }
            }
            this.data.push(trace);
        }
        // add a trace with (minX, minY) and (maxX, maxY), so the view does not change after using the sliders
        let extentTrace: Partial<Plotly.PlotData> = {
            type: "scatter",
            mode: "markers",
            x: [this.figureDict.data_bundle.minX, this.figureDict.data_bundle.maxX],
            y: [this.figureDict.data_bundle.extended_minY, this.figureDict.data_bundle.extended_maxY],
            marker: {
                size: 0,
                opacity: 0
            },
            showlegend: false,
            hoverinfo: "skip"
        };
        if (!this.isSinglePlot()) {
            extentTrace = {
                ...extentTrace,
                yaxis: `y1`,
            };
        }
        this.data.push(extentTrace);
    }

    private manageTickLabels(): void {
        if (this.figureDict.data_bundle.compress) {
            if (this.canHaveCustomTickLabels()) {
                if (this.ticktext.length === this.figureDict.data_bundle.nGraphs) {
                    this.hasCustomTickLabels = true;

                    this.layout.yaxis = {
                        ...this.layout.yaxis,
                        showticklabels: false,
                        tickvals: [...Array(this.figureDict.data_bundle.nGraphs).keys()],
                        ticktext: this.ticktext,
                    };
                }
            }

            if (!this.hasCustomTickLabels && !this.shouldOverlap()) {
                this.layout.yaxis = {
                    ...this.layout.yaxis,
                    showticklabels: false,
                    zeroline: false,
                    showgrid: false,
                };
            }
        }

        if (this.isSinglePlot()) {
            if (this.hasSameY() && !this.hasCustomTickLabels) {
                this.layout.yaxis = {
                    ...this.layout.yaxis,
                    visible: false,
                };
            }
        } else {
            for (let i = 1; i <= this.figureDict.data_bundle.nGraphs; i++) {
                const graphData = this.figureDict.data_bundle.plotly_graph_data_list[i - 1];

                const ymin = graphData.minY;
                const ymax = graphData.maxY;

                if (
                    ymax! - ymin! < 1e-9 &&
                    (!this.canHaveCustomTickLabels() ||
                        !graphData.use_name_as_ticklabels)
                ) {
                    this.updateLayoutAxis(`yaxis${i}`, {
                        visible: false,
                    });
                }
            }
        }
    }

    private manageLegend(): void {
        if (this.figureDict.data_bundle.nGraphs === 1) {
            this.layout.showlegend = false;
            return;
        }

        if (this.figureDict.data_bundle.compress) {
            this.layout.showlegend = false;
            return;
        }

        if (this.figureDict.overlapping) {
            this.layout.showlegend = true;
        }

        if (this.hideLegend === true) {
            this.layout.showlegend = false;
        }
    }

    private manageAxisUnits(): void {
        if (this.figureDict.data_bundle.common_units_x !== undefined) {
            this.layout.xaxis = {
                ...this.layout.xaxis,
                title: {
                    text: this.figureDict.data_bundle.common_units_x,
                },
            };
        }

        if (this.isSinglePlot()) {

            if (this.figureDict.data_bundle.common_units_y !== undefined) {
                this.layout.yaxis = {
                    ...this.layout.yaxis,
                    title: {
                        text: this.figureDict.data_bundle.common_units_y,
                    },
                };
            }
        }
    }

    private createXSlider(): void {
        const xBgColor = "#1e7fcc";
        const pixels = 25;
        const xHeight = Math.max(0.02, pixels / this.height);

        this.layout.xaxis = {
            ...this.layout.xaxis,
            rangeslider: {
                visible: true,
                bgcolor: xBgColor,
                thickness: xHeight,
            },
        };
    }

    private addYRangeSlider() {
        let sliderInstance;

        let minY = this.figureDict.data_bundle.extended_minY;
        let maxY = this.figureDict.data_bundle.extended_maxY;
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

                if (this.hasCustomTickLabels) {
                    const showticklabels = 26 > max - min;
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

    private removeYRangeSlider() {
        if (!this.slider) return;
        this.slider.remove()
        this.slider = undefined
    }

    private updateLayoutAxis(axisKey: string, axis: Partial<Plotly.LayoutAxis>) {
        (
            this.layout as Record<string, Partial<Plotly.LayoutAxis> | undefined>
        )[axisKey] = {
            ...((this.layout as Record<string, Partial<Plotly.LayoutAxis> | undefined>)[axisKey] ?? {}),
            ...axis
        };
    }

    private saveXRange(xRange: [number, number] | undefined) {
        if (xRange) {
            this.lastSampledXRange = [xRange[0], xRange[1]];
        } else {
            this.lastSampledXRange = undefined;
        }
    }

    private shouldOverlap(): boolean {
        return this.figureDict.overlapping && this.figureDict.changes_on_overlap;
    }

    private shouldHaveYSlider(): boolean {
        return (this.figureDict.overlapping || this.figureDict.data_bundle.compress) && this.figureDict.data_bundle.nGraphs > 1;
    }

    private hasSameY(): boolean {
        return this.figureDict.data_bundle.maxY - this.figureDict.data_bundle.minY < 1e-6;
    }

    private isSinglePlot(): boolean {
        return this.figureDict.overlapping || this.figureDict.data_bundle.compress || this.figureDict.data_bundle.nGraphs === 1;
    }

    private canHaveCustomTickLabels(): boolean {
        return !this.shouldOverlap();
    }

    /*
    private getSubplotHeight(height: number | null = null): number {
        if (this.figureDict.data_bundle.nGraphs === 0) {
            return 0;
        }
        if (height === null) {
            height = this.height;
        }
        const total_gap = PlotGraph.vertical_spacing * (this.figureDict.data_bundle.nGraphs - 1);
        const subplot_height = (height - total_gap) / this.figureDict.data_bundle.nGraphs;
        if (this.figureDict.data_bundle.compress) {
            return subplot_height / 3.;
        }
        return subplot_height;
    }*/

}