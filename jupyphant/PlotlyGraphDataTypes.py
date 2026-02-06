from .PlotlyGraphFigure import PlotlyGraphDataType, PlotlyGraphDataTypeList, PlotlyGraphAnnotations, PlotlyGraphAnnotationIntervals

class SpikeTrainRasterPlot(PlotlyGraphDataType):
    import numpy as np

    def extract_data(self, spiketrain):
        """Extracts SpikeTrainRasterPlotData from a SpikeTrain"""
        self.name = getattr(spiketrain,'name', 'SpikeTrain')
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
    class AnalogSignalLFPPlot(PlotlyGraphDataType):
        import numpy as np
        def extract_data(self, analogsignal_dict):
            """Extracts AnalogSignalLFPPlotData from a dict containing info about an AnalogSignal"""
            self.name = analogsignal_dict.get('name', 'AnalogSignal')
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

    # Pre-existing routine for plotting AnalogSignals, developed by Robin Gutzen
    def plot_lfp(self,lfps, times, names):
        """
        Plot LFPs using plotly.

        lfps:       LFP signals with trial_id as first dimension and sample_id as second dimension.
                    LFP signals must be arranged according to trial ID.
        times:      time stamps of the recorded LFP samples. Must be of same length as second dimenion of lfps
        """
        
        for trial_id, lfp in enumerate(lfps):
            data = lfp.magnitude
            
            if data.ndim == 1:
                data = data.reshape(-1, 1)
            
            num_channels = data.shape[1]
            
            for ch_idx in range(num_channels):
                
                channel_data = data[:, ch_idx]

                self.data_list.append(self.AnalogSignalLFPPlot(dict(
                        channel_data=channel_data,
                        times=times, 
                        name=f"{names[trial_id]}",
                    ), 
                    units_x = times.units,
                    units_y = lfp.units
                ))

    def extract_data(self, data):
        """Extracts AnalogSignalLFPPlotData from a dict containing AnalogSignal Data"""
        max_duration_limit = 10 * self.pq.s 

        subplot_col = 1
        for i, top_node in enumerate(data.keys()):
            raw_signals = data[top_node]
            
            if raw_signals:
                durations = [(sig.t_stop - sig.t_start) for sig in raw_signals]
                
                min_available_duration = min(durations)

                cut_duration = min(max_duration_limit, min_available_duration)

                sliced_signals = [
                    sig.time_slice(sig.t_start, sig.t_start + cut_duration) 
                    for sig in raw_signals
                ]

                plot_times = sliced_signals[0].times - sliced_signals[0].t_start
                
                self.plot_lfp(
                    sliced_signals, 
                    times=plot_times,
                    names=[sig.name for sig in raw_signals]
                )
                subplot_col += 1


class IrregularlySampledSignalPlotList(PlotlyGraphDataTypeList):
    import quantities as pq
    class IrregularlySampledSignalPlot(PlotlyGraphDataType):
        import numpy as np
        def extract_data(self, irregular_signal):
            """Extracts IrregularlySampledSignalPlotData from a SpikeTrain"""
            self.name = getattr(irregular_signal,'name', 'IrregularSignal')
            self.mode = 'markers+lines'

            """signal = irregular_signal.magnitude.flatten()
            times = irregular_signal.times

            min_val = self.np.min(signal)
            max_val = self.np.max(signal)
            range_val = max_val - min_val

            if range_val > 0:
                norm_data = (signal - min_val) / range_val
            else:
                norm_data = signal - min_val"""

            self.x=irregular_signal.times.magnitude.flatten()
            self.y=irregular_signal.magnitude.flatten()
            self.units_x = irregular_signal.times.units
            self.units_y = irregular_signal.units

    def extract_data(self, data):
        """Extracts IrregularlySampledSignalData from a dict containing IrregularlySampledSignal Data"""
        for top_node, iss_list in data.items():
            if iss_list:
                for iss in iss_list:
                    self.data_list.append(self.IrregularlySampledSignalPlot(iss))


class EventAnnotations(PlotlyGraphAnnotations):
    import numpy as np

    def __init__(self, events):
        x=[]
        text=[]
        unit=[]
        for top_node, event_list in events.items():
            if event_list:
                for event in event_list:
                    x.append(event.times.magnitude)
                    text.append(event.labels)
                    n = len(event.times.magnitude)
                    unit = unit + ([event.times.units]*n)
        super().__init__(self.np.concatenate(x), self.np.concatenate(text), unit)

class EpochIntervals(PlotlyGraphAnnotationIntervals):
    import numpy as np

    def __init__(self, epochs):
        x=[]
        duration=[]
        text=[]
        unit=[]
        for top_node, epoch_list in epochs.items():
            if epoch_list:
                for epoch in epoch_list:
                    x.append(epoch.times.magnitude)
                    duration.append(epoch.durations.magnitude)
                    text.append(epoch.labels)
                    n = len(epoch.times.magnitude)
                    unit = unit + ([epoch.times.units]*n)
        x = self.np.concatenate(x)
        duration = self.np.concatenate(duration)
        super().__init__(x, x+duration, self.np.concatenate(text), unit)