class PlotlyImageSequenceData:

    from .utils import OutputUtils

    def __init__(self, data, name_fallback='Trace'):
        self.n_frames = None
        self.name = None
        self.duration_ms = None
        self.units = None
        self.spacial_units = None
        self.images = None
        self.extract_data(data)
        if self.name is None:
            if callable(name_fallback):
                self.name = name_fallback(data)
            else:
                self.name = str(name_fallback)

    def extract_data(self, data):
        pass

    def to_dict(self):
        plotly_image_sequence_dict = {
            'n_frames': self.n_frames,
            'name': self.name,
            'duration_ms': self.duration_ms,
            'units': self.units_str,
            'images': self.images.tolist(),
            'zmin': self.zmin,
            'zmax': self.zmax
        }
        if self.spacial_units is not None:
            plotly_image_sequence_dict['spacial_units'] = (
                    f"{self.spacial_units} X {self.spacial_units}<br>"
                    f"({self.OutputUtils.get_text_label(self.spacial_units)})"
                )
        return plotly_image_sequence_dict

class PlotlyImageSequenceDataList:

    from .utils import OutputUtils
    import numpy as np

    def __init__(self, data, name_fallback='Trace'):
        self.datas = []
        self.extract_data(data, name_fallback)

    def extract_data(self, data, name_fallback):
        if data is None:
            self.datas = []
        elif isinstance(data, list):
            for d in data:
                try:
                    if not isinstance(d, PlotlyImageSequenceData):
                        d = PlotlyImageSequenceData(d, name_fallback)
                    self.datas.append(d)
                except Exception as e:
                    self.OutputUtils.print_warning(f"Failed to convert data to PlotlyImageSequenceData: {e}")
        else:
            try:
                if not isinstance(data, PlotlyImageSequenceData):
                    data = PlotlyImageSequenceData(data, name_fallback)
                self.datas = [data]
            except Exception as e:
                self.OutputUtils.print_warning(f"Failed to convert data to PlotlyImageSequenceData: {e}")

    def normalize(self):
        for imagesequence_data in self.datas:
            images = imagesequence_data.images
            images = self.np.where(self.np.isinf(images), self.np.nan, images)
            units_str = self.OutputUtils.convert_unit_to_label(imagesequence_data.units, short=True)
            if self.np.iscomplexobj(images):
                images = self.np.abs(images)
                units_str = f"|{units_str}|"

            units_str = self.OutputUtils.center_text_for_length(units_str, 5)
            
            zmin, zmax = self.np.nanmin(images), self.np.nanmax(images)
            if not self.np.isfinite(zmin) or not self.np.isfinite(zmax):
                zmin, zmax = 0, 1  # fallback
            imagesequence_data.images = images
            imagesequence_data.units_str = units_str
            imagesequence_data.zmin = zmin
            imagesequence_data.zmax = zmax

    def to_dict(self):
        return {
            'plotly_imagesequence_data_list': [plotly_image_sequence_data.to_dict() for plotly_image_sequence_data in self.datas],
        }