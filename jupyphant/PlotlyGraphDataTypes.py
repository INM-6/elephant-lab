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
    def extract_data(self, analogsignal):
        """Extracts AnalogSignalLFPPlotData from an AnalogSignal"""
        self.name = getattr(analogsignal,'name', 'AnalogSignal')
        self.mode = 'lines'

        channel_data = analogsignal[0]

        min_val = self.np.min(channel_data)
        max_val = self.np.max(channel_data)
        range_val = max_val - min_val

        if range_val > 0:
            norm_data = (channel_data - min_val) / range_val
        else:
            norm_data = channel_data - min_val
        
        self.x = analogsignal[1]
        self.y = norm_data