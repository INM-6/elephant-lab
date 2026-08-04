export interface FigureDict {
    title: string;
    overlapping: boolean;
    changes_on_overlap: boolean;
    data_bundle: PlotResponse;
}

export interface PlotResponse {
    plotly_graph_data_list: PlotlyGraphData[];
    annotation_list_dict: AnnotationListDict | null;

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
    mode: string;

    marker?: PlotlyMarker;
    line?: Record<string, any>;

    units_x?: string;
    units_y?: string;
    use_name_as_ticklabels?: boolean;

    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;

    x: number[];
    y: number[];
}