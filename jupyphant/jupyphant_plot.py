class Jupyphant_plot:
    from .PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
    from .PlotlyGraphFigure import PlotlyGraphFigure
    from .PlotlyGraphDataTypes import SpikeTrainRasterPlot, AnalogSignalLFPPlotList, EventAnnotations, EpochIntervals, IrregularlySampledSignalPlotList

    from neo import SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence
    from enum import Enum
    from ipywidgets import Output

    class RawPlotKey(Enum):
        RAW_ST = 'raw_st'
        RAW_ANASIG = 'raw_anasig'

    RAW_IMGSEQUENCE = 'raw_imgsequence'

    def __init__(self, jupyphant_entity):
        """
        Class to outsource some jupyphant logic.
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity = jupyphant_entity
        self.output_node_raw_plot = self.Output(layout={'width': "100%", 'height': 'auto'})
        # Plots are saved in order not to require recreation at every cell execution
        self.spiketrain_overview = None
        self.spiketrains_hash = None
        self.signal_overview = None
        self.analogsignals_hash = None
        self.irregularsignals_hash = None
        self.image_sequence_overview = None
        self.image_sequences_hash = None
        self.plots = {}
        for key in self.RawPlotKey:
            self.plots[key] = {
                "fig": None,
                "overlapping": False,
                "x_range": None,
                "max_points": 10000
            }
    
    def create_rasterplot(self, selected_ids=None, other_changes=False):
        """
        Create for each top-node a rasterplot for the contained spike trains.

        Called at every cell execution
        """
        spiketrains = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids,
                                                                          neo_class=self.SpikeTrain)
        # compare contents of spiketrains per top node
        spiketrains_unchanged = True
        spiketrains_hash = self.jupyphant_entity.get_neo_hash(spiketrains, hash_name='sha1')
        if self.spiketrains_hash is None:
            self.spiketrains_hash = spiketrains_hash
        else:
            if self.spiketrains_hash != spiketrains_hash:
                spiketrains_unchanged = False

        # Return pre-existing rasterplot if content of spiketrains has NOT changed
        if (spiketrains_unchanged) and (self.spiketrain_overview is not None) and (selected_ids is None) and (not other_changes):
            return self.spiketrain_overview
        # Otherwise, create new plot
        else:
            n_subplots = sum(1 for v in spiketrains.values() if len(v) > 0)
            if n_subplots > 0:
                #subplot_titles = [key for key in spiketrains.keys() if spiketrains[key]]
                data = []
                for top_node, st_list in spiketrains.items():
                    if st_list:
                        for st in st_list:
                            data.append(self.SpikeTrainRasterPlot(st))
                events = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Event)
                event_annotations = None
                n_events = sum(1 for v in events.values() if len(v) > 0)
                if n_events > 0:
                    event_annotations = self.EventAnnotations(events)
                epochs = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Epoch)
                epoch_intervals = None
                n_epochs = sum(1 for v in epochs.values() if len(v) > 0)
                if n_epochs > 0:
                    epoch_intervals = self.EpochIntervals(epochs)
                plot_dict = self.plots[self.RawPlotKey.RAW_ST]
                overlapping = plot_dict['overlapping']
                x_range = plot_dict['x_range']
                max_points = plot_dict['max_points']
                plotlyGraphFigure = self.PlotlyGraphFigure(data, title=f"Rasterplot for selected SpikeTrains", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyphant_entity.jupyterlab_theme, overlap_on_compress=False, max_points=max_points)

                if selected_ids is None:
                    self.spiketrain_overview = plotlyGraphFigure
                return plotlyGraphFigure
            else:
                return None

    def create_lfpplot(self, selected_ids=None, other_changes=False):
        """
        Wrapper for plot_lfp to update the lfp plot

        Called at every cell execution
        """
        analogsignals = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.AnalogSignal)
        irregularsignals = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.IrregularlySampledSignal)
        # compare contents of AnalogSignals per top node
        analogsignals_unchanged = True
        analogsignals_hash = self.jupyphant_entity.get_neo_hash(analogsignals, hash_name='sha1')
        if self.analogsignals_hash is None:
            self.analogsignals_hash = analogsignals_hash
        else:
            if self.analogsignals_hash != analogsignals_hash:
                analogsignals_unchanged = False

        # compare contents of IrregularlySampledSignal per top node
        irregularsignals_unchanged = True
        irregularsignals_hash = self.jupyphant_entity.get_neo_hash(irregularsignals, hash_name='sha1')
        if self.irregularsignals_hash is None:
            self.irregularsignals_hash = irregularsignals_hash
        else:
            if self.irregularsignals_hash != irregularsignals_hash:
                irregularsignals_unchanged = False

        # Return pre-existing lfpplot if content of AnalogSignals has NOT changed
        if analogsignals_unchanged and irregularsignals_unchanged  and (self.signal_overview is not None) and (selected_ids is None) and (not other_changes):
            return self.signal_overview
        else:
            n_analog_subplots = sum(1 for v in analogsignals.values() if len(v) > 0)
            n_irregular_sublplots = sum(1 for v in irregularsignals.values() if len(v) > 0)
            if n_analog_subplots > 0 or n_irregular_sublplots > 0:
                plotly_data = None
                if n_analog_subplots > 0:
                    plotly_data = self.AnalogSignalLFPPlotList(analogsignals)
                if n_irregular_sublplots > 0:
                    irregular_plotly_data = self.IrregularlySampledSignalPlotList(irregularsignals)
                    if plotly_data is None:
                        plotly_data = irregular_plotly_data
                    else:
                        plotly_data.concat(irregular_plotly_data)
                events = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Event)
                event_annotations = None
                n_events = sum(1 for v in events.values() if len(v) > 0)
                if n_events > 0:
                    event_annotations = self.EventAnnotations(events)
                epochs = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.Epoch)
                epoch_intervals = None
                n_epochs = sum(1 for v in epochs.values() if len(v) > 0)
                if n_epochs > 0:
                    epoch_intervals = self.EpochIntervals(epochs)
                overlapping = False
                plot_dict = self.plots[self.RawPlotKey.RAW_ANASIG]
                overlapping = plot_dict['overlapping']
                x_range = plot_dict['x_range']
                max_points = plot_dict['max_points']
                plotlyGraphFigure = self.PlotlyGraphFigure(plotly_data, title=f"Normalized LFP-Plots for selected AnalogSignals and IrregularlySampledSignals", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyphant_entity.jupyterlab_theme, max_points=max_points)
                if selected_ids is None:
                    self.signal_overview = plotlyGraphFigure
                return plotlyGraphFigure
            else:
                pass

    def create_image_sequence(self, selected_ids=None):
        """
        Creates a PlotlyImageSequenceFiure for all selected ImageSequences

        Called at every cell execution
        """
        image_sequences = self.jupyphant_entity._extract_selected_neo_data_objects_by_top_node(selected_ids=selected_ids, neo_class=self.ImageSequence)
        # compare contents of image_sequences per top node
        image_sequences_unchanged = True
        image_sequences_hash = self.jupyphant_entity.get_neo_hash(image_sequences, hash_name='sha1')
        if self.image_sequences_hash is None:
            self.image_sequences_hash = image_sequences_hash
        else:
            if self.image_sequences_hash != image_sequences_hash:
                image_sequences_unchanged = False

        # Return pre-existing rasterplot if content of image_sequences has NOT changed
        if (image_sequences_unchanged) and (self.image_sequence_overview is not None) and (selected_ids is None):
            return self.image_sequence_overview
        # Otherwise, create new plot
        else:
            n_subplots = sum(1 for v in image_sequences.values() if len(v) > 0)
            if n_subplots > 0:
                image_sequences_list = []
                for top_node, st_list in image_sequences.items():
                    if st_list:
                        image_sequences_list += st_list
                plotlyImageSequenceFigure = self.PlotlyImageSequenceFigure(image_sequences=image_sequences_list, theme_name=self.jupyphant_entity.jupyterlab_theme)

                if selected_ids is None:
                    self.image_sequence_overview = plotlyImageSequenceFigure
                return plotlyImageSequenceFigure
            else:
                return None