class Jupyphant_plot:
    from .PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
    from .PlotlyGraphFigure import PlotlyGraphFigure
    from .PlotlyGraphDataTypes import SpikeTrainRasterPlot, AnalogSignalLFPPlotList, EventAnnotations, EpochIntervals, IrregularlySampledSignalPlotList

    from neo import SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence
    from enum import Enum
    import math
    from ipywidgets import Output, HTML
    from IPython.display import clear_output, display

    class NeoKey(Enum):
        spiketrain = 'spiketrain'
        analogsignal = 'analogsignal'
        irregularsignal = 'irregularsignal'
        event = 'event'
        epoch = 'epoch'
        imagesequence = 'imagesequence'

    class RawPlotKey(Enum):
        RAW_ST = 'raw_st'
        RAW_ANASIG = 'raw_anasig'

    PLOT_IMGSEQUENCE = 'raw_imgsequence'

    def __init__(self, jupyphant_entity):
        """
        Class to outsource some jupyphant logic.
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity = jupyphant_entity
        self.previous_neo_object_dict = {key: [] for key in self.NeoKey}
        self.jupyterlab_theme = 'plotly_dark'
        self.plots = {}

        #Setting extra options for each plot (also needs to be set with an empty dict if no extra option is wanted)
        for key in self.RawPlotKey:
            self.plots[key] = {
                "overlapping": False,
                "x_range": None,
                "max_points": 10000,
                "zero_based": True
            }
        self.plots[self.PLOT_IMGSEQUENCE]= {
            "color_grade": "Viridis"
        }

        # Add all required options to each plot:
        #   - fig: a wrapper of the figure with extra functionality (needs fig.display())
        #   - output: the output area where the figure is displayed;
        #             each figure has its own output so it can be cleared separately
        #   - changed: True if any value in the dict has changed, False otherwise;
        #              used to track if changes where by selecting different nodes or changing #              the settings (e.g., overlap)
        for plot in self.plots.values():
            output = self.Output(layout={'width': "100%", 'height': 'auto'})
            plot.update({
                "fig": None,
                "output": output,
                "changed": False,
            })

    def raw_plot(self):
        neo_object_dict = None
        selection_changed = not any(v["changed"] for v in self.plots.values())
        if selection_changed:
            neo_object_dict = {
                self.NeoKey.spiketrain: self.SpikeTrain,
                self.NeoKey.analogsignal: self.AnalogSignal,
                self.NeoKey.irregularsignal: self.IrregularlySampledSignal,
                self.NeoKey.event: self.Event,
                self.NeoKey.epoch: self.Epoch,
                self.NeoKey.imagesequence: self.ImageSequence
            }
            neo_object_dict = self.jupyphant_entity._get_selected_neo_objects_by_class(neo_object_dict)
            change_dict = {}
            for key, current_list in neo_object_dict.items():
                previous_list = self.previous_neo_object_dict[key]
                change_dict[key] = { self.jupyphant_entity.get_neo_hash(o) for o in current_list
                } != {
                    self.jupyphant_entity.get_neo_hash(o) for o in previous_list
                }
            self.previous_neo_object_dict = neo_object_dict

            for key in self.RawPlotKey:
                self.plots[key]['x_range']=None

        empty_dict = {}
        for key, current_set in self.previous_neo_object_dict.items():
            empty_dict[key] = len(current_set) == 0

        def create_plot(plot_key, plot_method, primary_keys, secondary_keys=[]):
            if not isinstance(primary_keys, list):
                primary_keys = [primary_keys]
            if not isinstance(secondary_keys, list):
                secondary_keys = [secondary_keys]

            plot_dict = self.plots[plot_key]
            if all(empty_dict[k] for k in primary_keys):
                if plot_dict["fig"] is not None:
                    plot_dict["fig"]=None
                    with plot_dict["output"]:
                        Jupyphant_plot.clear_output()
            else:
                all_keys = primary_keys + secondary_keys
                if plot_dict["changed"] or (selection_changed and any(change_dict[k] for k in all_keys)):
                    with plot_dict["output"]:
                        if plot_dict["fig"] is not None:
                            Jupyphant_plot.clear_output(wait=True)
                        loading = self.HTML("⏳ <b>Rendering plots...</b>")
                        Jupyphant_plot.display(loading)
                        Jupyphant_plot.clear_output(wait=True)
                        plot_kwargs = {
                            key.value: self.previous_neo_object_dict[key]
                            for key in all_keys if not empty_dict[key]
                        }
                        fig = plot_method(**plot_kwargs)
                        plot_dict["fig"]=fig
                        fig.display()
            plot_dict["changed"] = False

        create_plot(self.RawPlotKey.RAW_ST, self.create_rasterplot, self.NeoKey.spiketrain, [self.NeoKey.event, self.NeoKey.epoch])

        create_plot(self.RawPlotKey.RAW_ANASIG, self.create_lfpplot, [self.NeoKey.analogsignal, self.NeoKey.irregularsignal], [self.NeoKey.event, self.NeoKey.epoch])

        create_plot(self.PLOT_IMGSEQUENCE, self.create_image_sequence, self.NeoKey.imagesequence)

    def create_explorer_raw_plot(self):
        for plot_dict in self.plots.values():
            Jupyphant_plot.display(plot_dict["output"])
        self.jupyphant_entity.on_selected_neo_objects_changed.add_listener(self.raw_plot)

    def set_raw_plot_overlap(self, overlap):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            if overlap == plot_dict['overlapping']:
                continue
            plot_dict['overlapping']=overlap
            fig = plot_dict['fig']
            if fig is None:
                continue
            if overlap:
                fig.overlap()
            else:
                fig.stack()
            if fig.compress and fig.overlap_on_compress:
                plot_dict['changed']=True
                reload = True
        if reload:
            self.raw_plot()
    
    def set_zero_based(self, zero_based):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            if zero_based != plot_dict['zero_based']:
                plot_dict['zero_based']=zero_based
                fig = plot_dict['fig']
                if fig is None:
                    continue
                plot_dict['changed']=True
                reload = True
        if reload:
            self.raw_plot()

    def set_color_grade(self, color_grade):
        reload = False
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        if color_grade != plot_dict['color_grade']:
            plot_dict['color_grade']=color_grade
            fig = plot_dict['fig']
            if fig:
                plot_dict['changed']=True
                reload = True
        if reload:
            self.raw_plot()

    def update_jupyterlab_plot_theme(self, theme_name):
        if self.jupyterlab_theme == theme_name:
            return
        self.jupyterlab_theme = theme_name
        for key in self.RawPlotKey:
            fig = self.plots[key]['fig']
            if fig is not None:
                fig.update_jupyterlab_theme(theme_name)
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        if plot_dict['fig'] is not None:
            plot_dict['changed']=True
            self.raw_plot()

    def upscale_raw_plot(self, max_points):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            temp_reload = False
            if(max_points != plot_dict['max_points']):
                plot_dict['max_points']=max_points
                temp_reload = True
            fig = plot_dict['fig']
            if fig is None:
                continue
            x_range = fig.getXRange()
            previous_x_range = plot_dict['x_range']
            if previous_x_range is None or not all(self.math.isclose(a, b, abs_tol=1e-1) for a, b in zip(x_range, previous_x_range)):
                plot_dict['x_range']=x_range
                temp_reload = True
            if(not fig.isDownscaled()):
                temp_reload = False
            plot_dict['changed']=temp_reload
            reload = reload or temp_reload
        if reload:
            self.raw_plot()
    
    def reset_scale(self):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            temp_reload = False
            if plot_dict['x_range'] is not None:
                plot_dict['x_range']=None
                temp_reload = True
            fig = plot_dict['fig']
            if fig is None:
                continue
            plot_dict['changed']=temp_reload
            reload = reload or temp_reload
        if reload:
            self.raw_plot()
        
    def create_rasterplot(self, spiketrain=None, event=None, epoch=None):
        data = [self.SpikeTrainRasterPlot(st) for st in spiketrain]
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_ST]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        return self.PlotlyGraphFigure(data, title=f"Rasterplot for selected SpikeTrains", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, overlap_on_compress=False, max_points=max_points, shift_to_0=zero_based)

    def create_lfpplot(self, analogsignal=None, irregularsignal=None, event=None, epoch=None):
        data = None
        if analogsignal is not None:
            data = self.AnalogSignalLFPPlotList(analogsignal)
        if irregularsignal is not None:
            irregular_data = self.IrregularlySampledSignalPlotList(irregularsignal)
            if data is None:
                data = irregular_data
            else:
                data.concat(irregular_data)
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_ANASIG]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        return self.PlotlyGraphFigure(data, title=f"Normalized LFP-Plots for selected AnalogSignals and IrregularlySampledSignals", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, max_points=max_points, shift_to_0=zero_based)

    def create_image_sequence(self, imagesequence=None):
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        color_grade = plot_dict['color_grade']
        return self.PlotlyImageSequenceFigure(image_sequences=imagesequence, theme_name=self.jupyterlab_theme, color_scale=color_grade)