from .PlotlyGraphContainer import PlotlyGraphDataType, PlotlyGraphDataTypeList, PlotlyGraphAnnotations, PlotlyGraphAnnotationIntervals

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
        """Extracts AnalogSignalLFPPlotData from a list of AnalogSignals"""
        max_duration_limit = 10 * self.pq.s 
    
        durations = [(sig.t_stop - sig.t_start) for sig in data]
        
        min_available_duration = min(durations)

        cut_duration = min(max_duration_limit, min_available_duration)

        sliced_signals = [
            sig.time_slice(sig.t_start, sig.t_start + cut_duration) 
            for sig in data
        ]

        plot_times = sliced_signals[0].times - sliced_signals[0].t_start
        
        self.plot_lfp(
            sliced_signals, 
            times=plot_times,
            names=[sig.name for sig in data]
        )

class IrregularlySampledSignalPlotList(PlotlyGraphDataTypeList):
    class IrregularlySampledSignalPlot(PlotlyGraphDataType):
        def extract_data(self, irregular_signal):
            """Extracts IrregularlySampledSignalPlotData from a IrregularlySampledSignal"""
            self.name = getattr(irregular_signal,'name', 'IrregularSignal')
            self.mode = 'markers+lines'

            self.x=irregular_signal.times.magnitude.flatten()
            self.y=irregular_signal.magnitude.flatten()
            self.units_x = irregular_signal.times.units
            self.units_y = irregular_signal.units

    def extract_data(self, data):
        """Extracts IrregularlySampledSignalData from a list of IrregularlySampledSignals"""
        for iss in data:
            self.data_list.append(self.IrregularlySampledSignalPlot(iss))


class EventAnnotations(PlotlyGraphAnnotations):
    import numpy as np

    def __init__(self, events):
        x=[]
        text=[]
        unit=[]
        for event in events:
            x.append(event.times.magnitude)
            text.append(event.labels)
            n = len(event.times.magnitude)
            unit.append(self.np.full(n, event.times.units, dtype=object))
        super().__init__(self.np.concatenate(x), self.np.concatenate(text), self.np.concatenate(unit))

class EpochIntervals(PlotlyGraphAnnotationIntervals):
    import numpy as np

    def __init__(self, epochs):
        x=[]
        duration=[]
        text=[]
        unit=[]
        for epoch in epochs:
            x.append(epoch.times.magnitude)
            duration.append(epoch.durations.magnitude)
            text.append(epoch.labels)
            n = len(epoch.times.magnitude)
            unit.append(self.np.full(n, epoch.times.units, dtype=object))
        x = self.np.concatenate(x)
        duration = self.np.concatenate(duration)
        super().__init__(x, x+duration, self.np.concatenate(text), self.np.concatenate(unit))