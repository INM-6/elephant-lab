import * as Plotly from 'plotly.js-dist';
import { PlotContainer } from './plot_container';
import { ImageSequenceFigureDict, ImageSequenceData } from './plot_image_sequence_interfaces';

export class PlotImageSequence extends PlotContainer {
    public render(figDict: any, is_plot_theme_dark: boolean) {
        const figureDict = figDict as ImageSequenceFigureDict;
        const sequences = figureDict?.data_list?.plotly_imagesequence_data_list ?? [];

        if (!Array.isArray(sequences) || sequences.length === 0) {
            return;
        }

        const maxCols = 2;
        const cols = Math.min(sequences.length, maxCols);
        const rows = Math.ceil(sequences.length / cols);
        const figHeight = 500 * rows;
        const pixelSpacing = 140;
        const horizontalSpacing = 0.24;
        const verticalSpacing = pixelSpacing / figHeight;

        const totalFreeX = 1 - (cols - 1) * horizontalSpacing;
        const subplotWidth = totalFreeX / cols;
        const totalFreeY = 1 - (rows - 1) * verticalSpacing;
        const subplotHeight = totalFreeY / rows;

        const getXDomain = (colIndex: number): [number, number] => {
            const xStart = (colIndex - 1) * (subplotWidth + horizontalSpacing);
            return [xStart, xStart + subplotWidth];
        };

        const getYDomain = (rowIndex: number): [number, number] => {
            const yTop = 1 - ((rowIndex - 1) * (subplotHeight + verticalSpacing));
            const yBottom = yTop - subplotHeight;
            return [yBottom, yTop];
        };

        const getButtonX = (colIndex: number) => {
            const [xStart, xEnd] = getXDomain(colIndex);
            return xStart + (xEnd - xStart) * 0.5;
        };

        const getButtonY = (rowIndex: number) => {
            const [, yTop] = getYDomain(rowIndex);
            return yTop + 0.01;
        };

        const allData: Plotly.Data[] = [];
        const frames: Plotly.Frame[] = [];
        const updatemenus: any[] = [];

        sequences.forEach((seq: ImageSequenceData, idx: number) => {
            const row = Math.floor(idx / cols) + 1;
            const col = idx % cols + 1;
            const axisIndex = idx + 1;
            const xDomain = getXDomain(col);
            const yDomain = getYDomain(row);
            const colorScale = figureDict.color_grade ?? 'Viridis';

            const heatmapValues = seq.images[0] ?? [];

            const heatmap: Partial<Plotly.PlotData> = {
                type: 'heatmap',
                z: heatmapValues,
                colorscale: colorScale,
                zmin: seq.zmin,
                zmax: seq.zmax,
                showscale: true,
                colorbar: {
                    title: { text: seq.units },
                    x: xDomain[1] + 0.03,
                    y: (yDomain[0] + yDomain[1]) / 2,
                    len: subplotHeight * 0.8,
                    lenmode: 'fraction',
                },
                xaxis: `x${axisIndex}`,
                yaxis: `y${axisIndex}`,
            };
            allData.push(heatmap as Plotly.Data);

            for (let k = 0; k < seq.n_frames; k++) {
                frames.push({
                    data: [{
                        type: 'heatmap',
                        z: seq.images[k],
                        colorscale: colorScale,
                        zmin: seq.zmin,
                        zmax: seq.zmax,
                        xaxis: `x${axisIndex}`,
                        yaxis: `y${axisIndex}`,
                    }],
                    name: `${idx}_${k}`,
                    traces: [idx],
                } as any);
            }

            const frameNames = Array.from({ length: seq.n_frames }, (_, k) => `${idx}_${k}`);
            updatemenus.push({
                type: 'buttons',
                buttons: [{
                    label: `▶ ${seq.name}`,
                    method: 'animate',
                    args: [
                        frameNames,
                        {
                            frame: {
                                duration: Math.max(seq.duration_ms / Math.max(seq.n_frames, 1), 1),
                                redraw: true,
                            },
                            transition: { duration: 0 },
                            fromcurrent: true,
                            mode: 'immediate',
                        },
                    ],
                }],
                direction: 'left',
                showactive: true,
                x: getButtonX(col),
                y: getButtonY(row),
                xanchor: 'center',
                yanchor: 'bottom',
            });
        });

        const layout: Partial<Plotly.Layout> = {
            height: figHeight,
            title: {
                text: figureDict.title,
                x: 0.5,
                xanchor: 'center',
            },
            updatemenus: updatemenus as any,
            showlegend: false,
        };

        for (let i = 0; i < sequences.length; i++) {
            const row = Math.floor(i / cols) + 1;
            const col = (i % cols) + 1;

            const suffix = i === 0 ? "" : `${i + 1}`;

            const xAxisName = `xaxis${suffix}`;
            const yAxisName = `yaxis${suffix}`;

            const xAxisRef = `x${suffix}`
            const yAxisRef = `y${suffix}`;

            const spacialLabel =
                sequences[i].spacial_units ??
                "";

            (layout as any)[xAxisName] = {
                domain: getXDomain(col),
                title: spacialLabel ? { text: spacialLabel } : undefined,
                anchor: yAxisRef,
                scaleanchor: yAxisRef,
                scaleratio: 1,
            };

            (layout as any)[yAxisName] = {
                domain: getYDomain(row),
                anchor: xAxisRef,
            };
        }

        Plotly.react(this.container, allData, layout).then((gd: any) => {
            console.log(frames);
            Plotly.addFrames(gd, frames);
            this.setTheme(is_plot_theme_dark);
            this.resize();
        }).catch((error: Error) => {
            console.error('Image sequence render error:', error);
        }).finally(() => {
            this.hideLoading();
        });
    }
}