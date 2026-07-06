from .PlotlyGraphContainer import PlotlyGraphDataType, PlotlyGraphDataTypeList, PlotlyGraphAnnotations, PlotlyGraphAnnotationIntervals

def _raster_calc_size(subplot_height):
    """Calculate marker size for raster plot based on subplot height.

    This is defined at module level so it can be pickled when included
    as a function reference on data objects sent to worker processes.
    """
    return max(min(30, subplot_height * 0.9), 1)

class SpikeTrainRasterPlot(PlotlyGraphDataType):
    import numpy as np

    def extract_data(self, spiketrain):
        """Extracts SpikeTrainRasterPlotData from a SpikeTrain"""
        self.name = getattr(spiketrain,'name', None)
        self.mode = 'markers'
        self.marker = dict(symbol='line-ns-open', size=_raster_calc_size, line=dict(width=0.2))
        self.x = spiketrain.times.magnitude
        self.y = self.np.zeros(len(self.x))
        self.units_x = spiketrain.times.units
        self.use_name_as_ticklabels = True

class AnalogSignalLFPPlotList(PlotlyGraphDataTypeList):
    class AnalogSignalChannelLFPPlot(PlotlyGraphDataType):
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
                    channel_name += f' Ch{ch_idx}'
                # Plot
                self.data_list.append(self.AnalogSignalChannelLFPPlot({ 'x': lfp.times.magnitude, 'y': channel_data, 'name': channel_name, 'units_x': lfp.times.units, 'units_y': lfp.units}))

class IrregularlySampledSignalPlotList(PlotlyGraphDataTypeList):
    class IrregularlySampledSignalPlot(PlotlyGraphDataType):
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
            self.data_list.append(self.IrregularlySampledSignalPlot(iss, name_fallback))


class EventAnnotations(PlotlyGraphAnnotations):
    import numpy as np

    def __init__(self, events):
        x=[]
        text=[]
        unit_indice=[]
        units=[]
        for i, event in enumerate(events):
            x.append(event.times.magnitude)
            text.append(event.labels)
            n = len(event.times.magnitude)
            unit_indice.append(self.np.full(n, i))
            units.append(event.times.units)
        super().__init__(self.np.concatenate(x), self.np.concatenate(text), self.np.concatenate(unit_indice), units)

class EpochIntervals(PlotlyGraphAnnotationIntervals):
    import numpy as np

    def __init__(self, epochs):
        x=[]
        duration=[]
        text=[]
        unit_indice=[]
        units=[]
        for i, epoch in enumerate(epochs):
            x.append(epoch.times.magnitude)
            duration.append(epoch.durations.magnitude)
            text.append(epoch.labels)
            n = len(epoch.times.magnitude)
            unit_indice.append(self.np.full(n, i))
            units.append(epoch.times.units)
        x = self.np.concatenate(x)
        duration = self.np.concatenate(duration)
        super().__init__(x, x+duration, self.np.concatenate(text), self.np.concatenate(unit_indice), units)