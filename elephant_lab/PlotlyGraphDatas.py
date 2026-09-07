from .PlotlyGraphContainer import PlotlyGraphData, PlotlyGraphDataList, PlotlyGraphAnnotation

class SpikeTrainRasterPlot(PlotlyGraphData):
    import numpy as np

    def extract_data(self, spiketrain):
        """Extracts SpikeTrainRasterPlotData from a SpikeTrain"""
        self.name = getattr(spiketrain,'name', None)
        self.mode = 'markers'
        # negative size means use abs(size) as a percentage of the subplot height
        self.marker = dict(symbol='line-ns-open', size=-35, line=dict(width=0.2))
        self.x = spiketrain.times.magnitude
        self.y = self.np.zeros(len(self.x))
        self.units_x = spiketrain.times.units
        self.use_name_as_ticklabels = True

class AnalogSignalLFPPlotList(PlotlyGraphDataList):
    class AnalogSignalChannelLFPPlot(PlotlyGraphData):
        def extract_data(self, dict_with_signal_info):
            """Extracts AnalogSignalChannelLFPPlot from a dict containing info about an AnalogSignal"""
            self.name = dict_with_signal_info.get('name')
            self.mode = 'lines'
            self.x = dict_with_signal_info.get('x')
            self.y = dict_with_signal_info.get('y')
            self.units_x = dict_with_signal_info.get('units_x')
            self.units_y = dict_with_signal_info.get('units_y')

    def extract_data(self, data, name_fallback):
        """Extracts AnalogSignalLFPPlotData from a list of AnalogSignals"""
            
        for lfp in data:
            name = getattr(lfp, 'name', None)
            if name is None:
                name = name_fallback(lfp)

            data = lfp.magnitude
            
            num_channels = data.shape[1]

            for ch_idx in range(num_channels):
                
                channel_data = data[:, ch_idx]

                channel_name = name
                if num_channels > 1:
                    channel_name = f'{channel_name}-ch{ch_idx}'
                # Plot
                self.datas.append(self.AnalogSignalChannelLFPPlot({ 'x': lfp.times.magnitude, 'y': channel_data, 'name': channel_name, 'units_x': lfp.times.units, 'units_y': lfp.units}))

class IrregularlySampledSignalPlotList(PlotlyGraphDataList):
    class IrregularlySampledSignalPlot(PlotlyGraphData):
        def extract_data(self, irregular_signal):
            """Extracts IrregularlySampledSignalPlotData from a IrregularlySampledSignal"""
            self.name = getattr(irregular_signal,'name', None)
            self.mode = 'markers+lines'

            self.x=irregular_signal.times.magnitude.flatten()
            self.y=irregular_signal.magnitude.flatten()
            self.units_x = irregular_signal.times.units
            self.units_y = irregular_signal.units

    def extract_data(self, data, name_fallback):
        """Extracts IrregularlySampledSignalData from a list of IrregularlySampledSignals"""
        for iss in data:
            self.datas.append(self.IrregularlySampledSignalPlot(iss, name_fallback))


class EventAnnotation(PlotlyGraphAnnotation):
    def __init__(self, event):
        super().__init__(event.times.magnitude, event.labels, event.times.units)

class EpochAnnotation(PlotlyGraphAnnotation):
    def __init__(self, epoch):
        super().__init__(epoch.times.magnitude, epoch.labels, epoch.times.units, epoch.durations.magnitude)