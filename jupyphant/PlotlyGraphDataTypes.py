from .PlotlyGraphContainer import PlotlyGraphDataType, PlotlyGraphDataTypeList, PlotlyGraphAnnotations, PlotlyGraphAnnotationIntervals

class SpikeTrainRasterPlot(PlotlyGraphDataType):
    import numpy as np

    def extract_data(self, spiketrain):
        """Extracts SpikeTrainRasterPlotData from a SpikeTrain"""
        self.name = getattr(spiketrain,'name', None)
        self.mode = 'markers'

        def calcSize(subplot_height):
            return max(
                min(
                30,  # cap size to avoid absurdly large lines
                subplot_height * 0.9
                )
            , 0.5)  # ensure at least this size

        self.marker = dict(symbol='line-ns-open', size=calcSize)
        self.x = spiketrain.times.magnitude
        self.y = self.np.zeros(len(self.x))
        self.units_x = spiketrain.times.units
        self.use_name_as_ticklabels = True

class AnalogSignalLFPPlotList(PlotlyGraphDataTypeList):
    import quantities as pq
    class AnalogSignalChannelLFPPlot(PlotlyGraphDataType):
        import numpy as np
        def extract_data(self, dict_with_signal_info):
            """Extracts AnalogSignalChannelLFPPlot from a dict containing info about an AnalogSignal"""
            self.name = dict_with_signal_info.get('name')
            self.mode = 'lines'
            self.x = dict_with_signal_info.get('x')
            self.y = dict_with_signal_info.get('y')

    # Pre-existing routine for plotting AnalogSignals, developed by Robin Gutzen
    def plot_lfp(self, lfps, times, names):
        """
        Plot LFPs using plotly.

        fig:        plotly figure
        row, col:   subplot location
        lfps:       LFP signals with trial_id as first dimension and sample_id as second dimension.
                    LFP signals must be arranged according to trial ID.
        times:      time stamps of the recorded LFP samples. Must be of same length as second dimenion of lfps
        title:      title of the figure
        spacing:    vertical spacing between two LFP signals
        color:      color to used for plotting
        """
        
        for lfp, name in zip(lfps, names):
            data = lfp.magnitude
            
            if data.ndim == 1:
                data = data.reshape(-1, 1)
            
            num_channels = data.shape[1]
            
            for ch_idx in range(num_channels):
                
                channel_data = data[:, ch_idx]

                min_val = self.np.min(channel_data)
                max_val = self.np.max(channel_data)
                range_val = max_val - min_val

                if range_val > 0:
                    norm_data = (channel_data - min_val) / range_val
                else:
                    norm_data = channel_data - min_val

                channel_name = name
                if num_channels > 1:
                    channel_name += f' Ch{ch_idx}'
                # Plot
                self.data_list.append(self.AnalogSignalChannelLFPPlot({ 'x': times, 'y': norm_data, 'name': channel_name }))

    def extract_data(self, data, name_fallback):
        """Extracts AnalogSignalLFPPlotData from a list of AnalogSignals"""
        max_duration_limit = 10 * self.pq.s
        for sig in data:

            durations = [(sig.t_stop - sig.t_start)]
            
            min_available_duration = min(durations)

            cut_duration = min(max_duration_limit, min_available_duration)

            sliced_signals = [
                sig.time_slice(sig.t_start, sig.t_start + cut_duration) 
            ]

            plot_times = sliced_signals[0].times - sliced_signals[0].t_start

            names = []
            name = getattr(sig, 'name', None)
            if name is None:
                name = name_fallback(sig)
            names.append(name)
            
            self.plot_lfp(
                sliced_signals, 
                plot_times,
                names
            )

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