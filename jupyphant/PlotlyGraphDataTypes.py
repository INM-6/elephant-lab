from .PlotlyGraphFigure import PlotlyGraphDataType, PlotlyGraphDataTypeList

class SpikeTrainRasterPlot(PlotlyGraphDataType):
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
        self.y = [0] * len(self.x)
        self.title_x = 'Time ({0})'.format(spiketrain.times.dimensionality)
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
                    title_x = 'Time ({0})'.format(times.dimensionality),
                    title_y = lfp.units.__str__()
                ))

    def extract_data(self, data):
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