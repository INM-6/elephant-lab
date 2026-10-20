export interface FigureDict {
    title: string;
    overlapping: boolean;
    changes_on_overlap: boolean;
    data_bundle: PlotResponse;
}

export interface PlotResponse {
    plotly_graph_data_list: PlotlyGraphData[];
    annotation_list: AnnotationListDict | null;

    compress: boolean;
    nGraphs: number;

    common_units_x?: string;
    common_units_y?: string;

    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface AnnotationListDict {
    xs: number[];
    texts: string[];
    durations: number[];
}

export interface PlotlyMarker {
    color?: string;
    size?: number;
    symbol?: string;
}

export interface PlotlyGraphData {
    name: string;
    index: number;
    mode: string;

    marker?: PlotlyMarker;
    line?: Record<string, any>;

    units_x?: string;
    units_y?: string;
    use_name_as_ticklabels: boolean;

    minX: number;
    maxX: number;
    minY: number;
    maxY: number;

    temp: PlotlyGraphDataTemp | undefined;
}

export interface ResampleResponse {
    x_y_values_list: XYValues[];
    x_y_values_list_changed: boolean;
    annotation_list: AnnotationListDict | null;
    annotation_list_changed: boolean;
}

export interface XYValues {
    index: number;
    temp: PlotlyGraphDataTemp;
}

export interface PlotlyGraphDataTemp {
    x: number[];
    y: number[];
}