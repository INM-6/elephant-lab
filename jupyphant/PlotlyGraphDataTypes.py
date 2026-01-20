from .PlotlyGraphFigure import PlotlyGraphDataType

class SpikeTrainRasterPlot(PlotlyGraphDataType):
    def extract_data(self, spiketrain):
        """Extracts SpikeTrainRasterPlotData from a SpikeTrain"""
        self.name = getattr(spiketrain,'name', 'SpikeTrain')
        self.mode = 'markers'

        def calcSize(subplot_height):
            return min(
                30,  # cap size to avoid absurdly large lines
                subplot_height * 0.8
            )

        self.marker = dict(symbol='line-ns-open', size=calcSize)
        self.x = spiketrain.times.magnitude
        self.y = [0] * len(self.x)

class AnalogSignalLFPPlot(PlotlyGraphDataType):
    import numpy as np
    def extract_data(self, analogsignal_dict):
        """Extracts AnalogSignalLFPPlotData from a dict containing info about an AnalogSignal"""
        self.name = analogsignal_dict.get('name', 'AnalogSignal')
        if 'title_x' in analogsignal_dict:
            self.title_x = analogsignal_dict['title_x']
        if 'title_y' in analogsignal_dict:
            self.title_y = analogsignal_dict['title_y']
        self.mode = 'lines'

        channel_data = analogsignal_dict['channel_data']

        min_val = self.np.min(channel_data)
        max_val = self.np.max(channel_data)
        range_val = max_val - min_val

        if range_val > 0:
            norm_data = (channel_data - min_val) / range_val
        else:
            norm_data = channel_data - min_val
        
        self.x = analogsignal_dict['times']
        self.y = norm_data