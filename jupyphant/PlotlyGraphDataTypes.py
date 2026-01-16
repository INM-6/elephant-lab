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