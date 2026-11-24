"""
Specific implementations of the Blueprints of PlotlyGraphContainer
for Neo data
"""

from .PlotlyGraphContainer import PlotlyGraphData, PlotlyGraphDataList, PlotlyGraphAnnotation

class SpikeTrainRasterPlot(PlotlyGraphData):
    """A raster-plot trace (tick marks at spike times) for a single neo SpikeTrain."""

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
    """A trace per channel across a list of neo AnalogSignals (LFPs), one PlotlyGraphDataType each."""

    class AnalogSignalChannelLFPPlot(PlotlyGraphData):
        """A line trace for a single channel of a single AnalogSignal."""

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
    """A trace per channel across a list of neo IrregularlySampledSignals."""

    class IrregularlySampledSignalPlot(PlotlyGraphData):
        """A markers+lines trace for a single channel."""

        def extract_data(self, dict_with_signal_info):
            self.name = dict_with_signal_info.get('name')
            self.mode = 'markers+lines'
            self.x = dict_with_signal_info.get('x')
            self.y = dict_with_signal_info.get('y')
            self.units_x = dict_with_signal_info.get('units_x')
            self.units_y = dict_with_signal_info.get('units_y')

    def extract_data(self, data, name_fallback):
        """Extracts traces from a list of IrregularlySampledSignals."""

        for iss in data:
            name = getattr(iss, 'name', None)
            if name is None:
                name = name_fallback(iss)

            signal_data = iss.magnitude

            # Normalize single-channel signals to 2D
            if signal_data.ndim == 1:
                signal_data = signal_data[:, np.newaxis]

            num_channels = signal_data.shape[1]

            for ch_idx in range(num_channels):
                channel_name = name
                if num_channels > 1:
                    channel_name = f'{name}-ch{ch_idx}'

                self.datas.append(
                    self.IrregularlySampledSignalPlot({
                        'x': iss.times.magnitude,
                        'y': signal_data[:, ch_idx],
                        'name': channel_name,
                        'units_x': iss.times.units,
                        'units_y': iss.units
                    })
                )


class EventAnnotation(PlotlyGraphAnnotation):
    import numpy as np

    """Point annotations built from a list of neo Events, one label per event time."""

    def __init__(self, event):
        labels = event.labels
        n_times = len(event.times.magnitude)

        np = EventAnnotation.np

        if labels is None:
            labels = np.full(n_times, '', dtype=str)
        else:
            labels = np.asarray(labels, dtype=str)
            labels = np.pad(
                labels[:n_times],
                (0, max(0, n_times - len(labels))),
                constant_values=''
            )

        super().__init__(event.times.magnitude, labels, event.times.units)

class EpochAnnotation(PlotlyGraphAnnotation):
    import numpy as np
    """Interval annotations built from a list of neo Epochs, one labeled x0-x1 span per epoch entry."""
    
    def __init__(self, epoch):
        labels = epoch.labels
        n_times = len(epoch.times.magnitude)

        np = EpochAnnotation.np

        if labels is None:
            labels = np.full(n_times, '', dtype=str)
        else:
            labels = np.asarray(labels, dtype=str)
            labels = np.pad(
                labels[:n_times],
                (0, max(0, n_times - len(labels))),
                constant_values=''
            )
        super().__init__(epoch.times.magnitude, labels, epoch.times.units, epoch.durations.magnitude)