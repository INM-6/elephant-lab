from .PlotlyImageSequenceContainer import PlotlyImageSequenceData

class ImageSequencePlot(PlotlyImageSequenceData):

     import quantities as pq

     def extract_data(self, imagesequence):
            """Extracts ImageSequencePlotData from a imagesequence"""
            self.n_frames, height, width = imagesequence.shape
            self.name = getattr(imagesequence,'name', None)
            self.duration_ms = float((imagesequence.t_stop - imagesequence.t_start).rescale(self.pq.ms).magnitude)
            self.units = imagesequence.units
            self.spacial_units = getattr(imagesequence, 'spatial_scale', None)
            self.images = imagesequence.magnitude