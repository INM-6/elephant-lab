export interface ImageSequenceFigureDict {
    title: string;
    color_grade: string;
    data_list: ImageSequenceDataListDict;
}

export interface ImageSequenceDataListDict {
    plotly_imagesequence_data_list: ImageSequenceData[];
}

export interface ImageSequenceData {
    n_frames: number;
    name: string;
    duration_ms: number;
    units: string;
    images: number[][][];
    zmin: number;
    zmax: number;
    spacial_units?: string;
}