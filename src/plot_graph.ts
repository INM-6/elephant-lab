import * as Plotly from 'plotly.js-dist';
import * as noUiSlider from 'nouislider';
import {
    PythonCodeKey,
    getPythonCode
} from './kernelcode';
import { PlotContainer } from './plot_container';
import { FigureDict, ResampleResponse, AnnotationListDict } from './plot_graph_interfaces';

/**
 * PlotGraph renders time-series plots using Plotly with support for:
 * - multiple subplots (grid layout)
 * - annotations rendered as translucent bars
 * - an X range slider and optional Y-range slider per subplot
 * - relative marker sizing and efficient resampling updates
 *
 * Extends `PlotContainer` and expects a `FigureDict` produced by the
 * Python kernel bridge.
 */
export class PlotGraph extends PlotContainer {

    private slider?: HTMLElement;

    // @ts-ignore
    private figureDict: FigureDict;

    private data: Plotly.Data[] = [];
    private layout: Partial<Plotly.Layout> = {};
    private hasCustomTickLabels = false;
    private hasRelativeMarkerSizes = false;
    private relativeMarkerTraceIndices: number[] = [];
    private hasAnnotations = false;
    private height: number = 0;
    private ticktext: string[] = [];
    private hideLegend?: boolean;
    private lastSampledXRange?: [number, number];
    private relayoutTimeout: ReturnType<typeof setTimeout> | null = null;
    private relativeMarkerSizeTimeout: ReturnType<typeof setTimeout> | null = null;
    private annotationDurations: number[] = [];

    private subplotCount(): number {
        const nGraphs = this.figureDict.data_bundle.nGraphs;
        return this.isSinglePlot() ? 1 : nGraphs;
    }

    private firstExtendTraceIndex(): number {
        return this.figureDict.data_bundle.nGraphs;
    }

    // @ts-ignore
    private extendTraceIndices(): number[] {
        const first = this.firstExtendTraceIndex();
        const count = this.subplotCount();

        return Array.from({ length: count }, (_, i) => first + i);
    }

    private firstAnnotationTraceIndex(): number {
        return this.firstExtendTraceIndex() + this.subplotCount();
    }

    private annotationTraceIndices(): number[] {
        const first = this.firstAnnotationTraceIndex();
        const count = this.subplotCount();

        return Array.from({ length: count }, (_, i) => first + i);
    }

    private calcWidthsForAnnotations(durations: number[]): number[] {
        const minX = this.lastSampledXRange ? this.lastSampledXRange[0] : this.figureDict.data_bundle.minX;
        const maxX = this.lastSampledXRange ? this.lastSampledXRange[1] : this.figureDict.data_bundle.maxX;
        const range = maxX - minX;
        const minAnnotationWidth = range / 300;
        return durations.map((duration) =>
            duration < minAnnotationWidth ? minAnnotationWidth : duration
        );
    }

    private calcTransformedBarAnnotationData(annotation_list: AnnotationListDict): [number[], number[], string[]] {
        const xs = annotation_list.xs;
        const texts = annotation_list.texts;
        const durations = annotation_list.durations;
        const x = xs.map((x, i) => x + durations[i] / 2);
        this.annotationDurations = durations;
        const width = this.calcWidthsForAnnotations(durations);
        const hovertemplate = durations.map((duration, i) =>
            duration === 0
                ? `<b>${texts[i]}</b><br>` +
                `Time&nbsp;&nbsp;&nbsp; <b>${xs[i].toPrecision(6)}</b>` +
                `<extra></extra>`
                : `<b>${texts[i]}</b><br>` +
                `Start&nbsp;&nbsp; ${xs[i].toPrecision(6)}<br>` +
                `End&nbsp;&nbsp;&nbsp;&nbsp; ${(xs[i] + duration).toPrecision(6)}` +
                `<extra></extra>`
        );
        return [x, width, hovertemplate];
    }

    private calcExtendedAnnotationYRange(yRange: [number, number]): [number, number] {
        if (!this.hasAnnotations) {
            return yRange;
        }
        const [minY, maxY] = yRange;
        const span = maxY - minY;
        if (span < 1e-6) {
            return [-1, 1];
        }
        return [minY, maxY + 0.05 * span]
    }

    private getAnnotationYRanges(): Array<[number, number]> {
        if (this.isSinglePlot()) {
            return [
                this.calcExtendedAnnotationYRange([
                    this.figureDict.data_bundle.minY,
                    this.figureDict.data_bundle.maxY,
                ]),
            ];
        }

        return this.figureDict.data_bundle.plotly_graph_data_list.map(
            (graphData) =>
                this.calcExtendedAnnotationYRange([
                    graphData.minY,
                    graphData.maxY,
                ])
        );
    }


    /**
     * Render the provided `FigureDict` into the container using Plotly.
     * This sets up traces, layout, sliders, annotation traces and event
     * handlers required for interactive behaviors.
     *
     * @param figDict - Serialized `FigureDict` coming from the kernel.
     * @param is_plot_theme_dark - Whether a dark plot theme should be applied.
     */
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

        if (this.hasSameY() && (this.figureDict.data_bundle.nGraphs <= 1 || this.shouldOverlap())) {
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
        this.hasAnnotations = this.figureDict.data_bundle.annotation_list !== null && this.figureDict.data_bundle.annotation_list.xs.length > 0;

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
        this.addAnnotationEvents();
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

                    if (this.annotationDurations.length > 0) {
                        Plotly.restyle(
                            this.container,
                            {
                                // @ts-ignore
                                width: Array(this.figureDict.data_bundle.nGraphs).fill(this.calcWidthsForAnnotations(this.annotationDurations)),
                            },
                            this.annotationTraceIndices()
                        );
                    }

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

    public resample(resampleResponse: ResampleResponse) {
        /**
         * Apply resampled data to existing traces and update annotation traces.
         * The `resampleResponse` may include updated x/y arrays for traces and
         * an updated annotation list.
         *
         * @param resampleResponse - Response containing updated trace/annotation data.
         */
        if (resampleResponse.x_y_values_list_changed) {
            const indices = [];
            const x = [];
            const y = [];
            for (const xYValues of resampleResponse.x_y_values_list) {
                indices.push(xYValues.index);
                x.push(xYValues.temp.x);
                y.push(xYValues.temp.y);
            }
            Plotly.restyle(
                this.container,
                { x: x, y: y },
                indices
            );
        }
        if (resampleResponse.annotation_list_changed && resampleResponse.annotation_list !== null) {
            const [x, width, hovertemplate] = this.calcTransformedBarAnnotationData(resampleResponse.annotation_list);
            const yRanges = this.getAnnotationYRanges();

            const indices = this.annotationTraceIndices();

            const nRanges = yRanges.length;
            const xs = Array(nRanges).fill(x);
            const widths = Array(nRanges).fill(width);
            const hovertemplates = Array(nRanges).fill(hovertemplate);

            const ys = yRanges.map(([minY, maxY]) =>
                Array(x.length).fill(maxY - minY)
            );

            const bases = yRanges.map(([minY]) =>
                Array(x.length).fill(minY)
            );

            Plotly.restyle(
                this.container,
                {
                    x: xs,
                    // @ts-ignore
                    width: widths,
                    y: ys,
                    base: bases,
                    // @ts-ignore
                    hovertemplate: hovertemplates,
                },
                indices
            );
        }
    }

    private createExtentTrace(minX: number, minY: number, maxX: number, maxY: number, yaxis: string | undefined = undefined): Partial<Plotly.PlotData> {
        /**
         * Create an invisible scatter trace used to fix the plot extents so that
         * slider interactions do not collapse the visible range. The trace is
         * rendered with zero-size markers and skipped hoverinfo.
         */
        const extentTrace: Partial<Plotly.PlotData> = {
            type: "scatter",
            mode: "markers",
            x: [minX, maxX],
            y: this.calcExtendedAnnotationYRange([minY, maxY]),
            marker: {
                size: 0,
                opacity: 0
            },
            showlegend: false,
            hoverinfo: "skip"
        };
        if (yaxis !== undefined) {
            extentTrace.yaxis = yaxis;
        }
        return extentTrace;
    }

    private addData(): void {
        /**
         * Build and push data traces to `this.data` for every graph in the
         * `figureDict.data_bundle.plotly_graph_data_list`. Handles per-trace
         * marker/line defaults, relative marker sizing, and per-subplot axis
         * configuration.
         */
        const subplotHeight = this.getSubplotHeight();
        for (let i = 0; i < this.figureDict.data_bundle.plotly_graph_data_list.length; i++) {
            const graphData = this.figureDict.data_bundle.plotly_graph_data_list[i];

            const default_marker = {
                size: 6,
            }
            const default_line = {
                width: 1,
            }

            const marker_settings = graphData.marker ? { ...default_marker, ...graphData.marker } : default_marker;
            // negative size means use abs(size) as a percentage of the subplot height
            if (marker_settings.size !== undefined && marker_settings.size < 0) {
                this.hasRelativeMarkerSizes = true;
                this.relativeMarkerTraceIndices.push(i);
                marker_settings.size = Math.max(1, subplotHeight * Math.abs(marker_settings.size) / 100);
            }
            const line_settings = graphData.line ? { ...default_line, ...graphData.line } : default_line;
            let trace: Partial<Plotly.ScatterData> = {
                type: "scattergl",
                x: graphData.temp!.x,
                y: graphData.temp!.y,
                name: graphData.name,
                mode: graphData.mode as any,
                marker: marker_settings,
                line: line_settings
            };
            graphData.temp = undefined; // free memory
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
        if (this.isSinglePlot()) {
            const extentTrace = this.createExtentTrace(
                this.figureDict.data_bundle.minX,
                this.figureDict.data_bundle.minY,
                this.figureDict.data_bundle.maxX,
                this.figureDict.data_bundle.maxY
            );
            this.data.push(extentTrace);
        } else {
            for (let i = 0; i < this.figureDict.data_bundle.plotly_graph_data_list.length; i++) {
                const graphData = this.figureDict.data_bundle.plotly_graph_data_list[i];
                const extentTrace = this.createExtentTrace(
                    this.figureDict.data_bundle.minX,
                    graphData.minY,
                    this.figureDict.data_bundle.maxX,
                    graphData.maxY,
                    `y${graphData.index + 1}`
                );
                this.data.push(extentTrace);
            }
        }
    }

    private addAnnotationEvents(): void {
        /**
         * Convert the stored annotation list into Plotly bar traces placed
         * behind the plotted data and with appropriate hovertemplates.
         */
        if (!this.hasAnnotations) {
            return
        }
        const annotation_list = this.figureDict.data_bundle.annotation_list;

        const [x, width, hovertemplate] = this.calcTransformedBarAnnotationData(annotation_list!);

        const yRanges = this.getAnnotationYRanges();

        for (const [i, [minY, maxY]] of yRanges.entries()) {
            const trace = {
                type: "bar",
                x: x,
                width: width,
                y: Array(x.length).fill(maxY - minY),
                // @ts-ignore
                base: Array(x.length).fill(minY),
                hovertemplate: hovertemplate,
                hoverlabel: {
                    bgcolor: '#222',
                    bordercolor: '#444',
                    font: {
                        color: '#fff'
                    }
                },
                marker: {
                    color: "red",
                },
                opacity: 0.3,
                showlegend: false,
            } as Partial<Plotly.PlotData>;

            if (!this.isSinglePlot()) {
                trace.yaxis = `y${i + 1}`;
            }

            this.data.push(trace);
        }

        this.figureDict.data_bundle.annotation_list = null; // free memory
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
        if (this.figureDict.data_bundle.nGraphs <= 1) {
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
        /**
         * Add a horizontal X-axis range slider to the layout. The slider is
         * always visible and sized relative to the overall plot height.
         */
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
        /**
         * Create or update a vertical Y-range slider used for zooming in the
         * single-plot (non-shared Y) case. The slider uses noUiSlider and
         * updates Plotly via `relayout`/`restyle` calls.
         */
        let sliderInstance;

        const extendedYRange = this.calcExtendedAnnotationYRange([this.figureDict.data_bundle.minY, this.figureDict.data_bundle.maxY]);
        let minY = extendedYRange[0];
        let maxY = extendedYRange[1];
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
                if (!gd?.data) return;

                const min = Number(values[0]);
                const max = Number(values[1]);

                const yaxis = gd.layout.yaxis;
                Object.assign(yaxis, {
                    range: [min, max],
                    autorange: false,
                });

                if (this.hasCustomTickLabels) {
                    const showticklabels = 26 > max - min;

                    Object.assign(yaxis, {
                        showticklabels,
                        zeroline: showticklabels,
                        showgrid: showticklabels,
                    });
                }

                // One restyle call for all traces whose marker size is relative.
                if (this.hasRelativeMarkerSizes) {
                    // Cancel any pending update
                    if (this.relativeMarkerSizeTimeout) {
                        clearTimeout(this.relativeMarkerSizeTimeout);
                    }

                    // Schedule a new one
                    this.relativeMarkerSizeTimeout = setTimeout(() => {
                        const traceIndices: number[] = [];
                        const markerSizes: number[] = [];

                        const dataBundle = this.figureDict.data_bundle.plotly_graph_data_list;
                        const height = max - min;
                        const maxZoomedInSuplotHeightForRelativeSize = 100;
                        const zoomedInSubplotHeight = (height < 1e-6) ? maxZoomedInSuplotHeightForRelativeSize : Math.min(maxZoomedInSuplotHeightForRelativeSize, (this.height - 150) / (this.figureDict.data_bundle.nGraphs * (height / (this.figureDict.data_bundle.maxY - this.figureDict.data_bundle.minY))));

                        for (const traceIndex of this.relativeMarkerTraceIndices) {
                            const originalSize = dataBundle[traceIndex]?.marker?.size;

                            if (typeof originalSize !== 'number' || originalSize >= 0) {
                                continue;
                            }

                            traceIndices.push(traceIndex);
                            markerSizes.push(
                                Math.max(
                                    1,
                                    zoomedInSubplotHeight * Math.abs(originalSize) / 100
                                )
                            );
                        }

                        if (traceIndices.length > 0) {
                            Plotly.restyle(
                                this.container,
                                { 'marker.size': markerSizes },
                                traceIndices
                            );
                        }

                        this.relativeMarkerSizeTimeout = null;
                    }, 225); // delay
                }

                // One relayout call.
                Plotly.relayout(this.container, {
                    yaxis: yaxis,
                });
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
        return this.isSinglePlot() && !this.hasSameY();
    }

    private hasSameY(): boolean {
        return this.figureDict.data_bundle.maxY - this.figureDict.data_bundle.minY < 1e-6;
    }

    private isSinglePlot(): boolean {
        return this.figureDict.overlapping || this.figureDict.data_bundle.compress || this.figureDict.data_bundle.nGraphs <= 1;
    }

    private canHaveCustomTickLabels(): boolean {
        return !this.shouldOverlap();
    }

    private getSubplotHeight(): number {
        if (this.figureDict.data_bundle.nGraphs === 0) {
            return 0;
        }
        const heightOfNonCoordinateSystem = 150;
        const subplot_height = (this.height - heightOfNonCoordinateSystem) / (this.shouldOverlap() ? 1 : this.figureDict.data_bundle.nGraphs);
        return subplot_height;
    }

}