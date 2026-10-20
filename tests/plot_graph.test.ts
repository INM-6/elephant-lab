import { describe, it, expect } from 'vitest';

import { PlotGraph } from '../src/plot_graph';
import { PlotImageSequence } from '../src/plot_image_sequence';
import { KernelBridge } from '../src/kernel_bridge';

describe('PlotGraph and PlotImageSequence internal logic', () => {
    it('computes correct layout height for simple and multi-graph figures', async () => {
        const kb = new KernelBridge({} as any);
        const pg = new PlotGraph('k', kb, null);

        // Case 1: single graph, same Y -> height 200
        const fig1: any = {
            title: 'single',
            overlapping: false,
            changes_on_overlap: false,
            data_bundle: {
                plotly_graph_data_list: [
                    { temp: { x: [0], y: [0] }, index: 0, name: 'g', mode: 'lines', use_name_as_ticklabels: false, minX: 0, maxX: 0, minY: 0, maxY: 0 }
                ],
                annotation_list: null,
                compress: false,
                nGraphs: 1,
                minX: 0,
                maxX: 1,
                minY: 0,
                maxY: 0
            }
        };

        pg.render(fig1, false);
        // Inspect layout passed to Plotly.react
        expect((pg as any).height).toBe(200);

        // Case 2: three graphs, different Y, not overlapping -> height 800
        const fig2: any = {
            title: 'three',
            overlapping: false,
            changes_on_overlap: false,
            data_bundle: {
                plotly_graph_data_list: [
                    { temp: { x: [10], y: [0] }, index: 0, name: 'g1', mode: 'lines', use_name_as_ticklabels: false, minX: 10, maxX: 10, minY: 0, maxY: 0 },
                    { temp: { x: [0], y: [1] }, index: 1, name: 'g2', mode: 'lines', use_name_as_ticklabels: false, minY: 0, maxY: 1 },
                    { temp: { x: [0], y: [0] }, index: 2, name: 'g3', mode: 'lines', use_name_as_ticklabels: false, minY: 0, maxY: 0 }
                ],
                annotation_list: null,
                compress: false,
                nGraphs: 3,
                minX: 0,
                maxX: 10,
                minY: 0,
                maxY: 1
            }
        };

        pg.render(fig2, false);
        expect((pg as any).height).toBe(800);
    });

    it('calculates annotation positions, widths, and extended Y ranges', () => {
        const pg = new PlotGraph('k', new KernelBridge({} as any), null);
        (pg as any).figureDict = {
            data_bundle: { minX: 0, maxX: 3, minY: 2, maxY: 5 },
        };
        (pg as any).hasAnnotations = true;

        expect((pg as any).calcTransformedBarAnnotationData({
            xs: [0.5, 2], texts: ['event', 'instant'], durations: [1, 0],
        })).toEqual([
            [1, 2], [1, 0.01], [
                '<b>event</b><br>Start&nbsp;&nbsp; 0.500000<br>End&nbsp;&nbsp;&nbsp;&nbsp; 1.50000<extra></extra>',
                '<b>instant</b><br>Time&nbsp;&nbsp;&nbsp; <b>2.00000</b><extra></extra>',
            ],
        ]);
        expect((pg as any).calcExtendedAnnotationYRange([2, 5])).toEqual([2, 5.15]);
        expect((pg as any).calcExtendedAnnotationYRange([3, 3])).toEqual([-1, 1]);
    });

    it('calculates annotation widths for resampling ranges', () => {
        const pg = new PlotGraph('k', new KernelBridge({} as any), null);
        (pg as any).figureDict = {
            data_bundle: { minX: 0, maxX: 4 },
        };

        expect((pg as any).calcWidthsForAnnotations([0, 0.01, 2])).toEqual([4 / 300, 4 / 300, 2]);
        (pg as any).lastSampledXRange = [10, 20];
        expect((pg as any).calcWidthsForAnnotations([0])).toEqual([10 / 300]);
    });

    it('exposes graph trace index helpers for single and multi plots', () => {
        const pg = new PlotGraph('k', new KernelBridge({} as any), null);
        (pg as any).figureDict = { overlapping: false, data_bundle: { nGraphs: 3 } };

        expect((pg as any).isSinglePlot()).toBe(false);
        expect((pg as any).firstExtendTraceIndex()).toBe(3);
        expect((pg as any).extendTraceIndices()).toEqual([3, 4, 5]);
        expect((pg as any).firstAnnotationTraceIndex()).toBe(6);
        expect((pg as any).annotationTraceIndices()).toEqual([6, 7, 8]);
        expect((pg as any).shouldHaveYSlider()).toBe(false);
    });

    it('renders image sequences without data when the sequence list is empty', () => {
        const pis = new PlotImageSequence('k', new KernelBridge({} as any), null);
        pis.render({ data_list: { plotly_imagesequence_data_list: [] } }, false);
        expect((pis as any).container).toBeTruthy();
    });
});
