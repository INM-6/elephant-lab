class Jupyphant_plot:
    from .PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
    from .PlotlyGraphFigure import PlotlyGraphFigure
    from .PlotlyGraphDataTypes import SpikeTrainRasterPlot, AnalogSignalLFPPlotList, EventAnnotations, EpochIntervals, IrregularlySampledSignalPlotList

    from neo import SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence
    from enum import Enum
    import numpy as np
    from ipywidgets import Output, HTML
    from IPython.display import clear_output, display

    from typing import TypedDict, TYPE_CHECKING

    if TYPE_CHECKING:
        from .jupyphant import Jupyphant  # only for type hints

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
        RAW_EVENT = 'raw_event'

    PLOT_IMGSEQUENCE = 'raw_imgsequence'

    class DefaultPlotDict(TypedDict):
        fig: Jupyphant_plot.PlotlyGraphFigure | Jupyphant_plot.PlotlyImageSequenceFigure | None
        output: Jupyphant_plot.Output
        changed: bool

    class RawPlotDict(DefaultPlotDict):
        overlapping: bool
        og_x_range: list[float] | None
        x_range: list[float] | None
        max_points: int
        zero_based: bool
    
    class ImageSequencePlotDict(DefaultPlotDict):
        color_grade: str

    def _base_plot_dict(self) -> Jupyphant_plot.DefaultPlotDict:
        # Add all required options to each plot:
        #   - fig: a wrapper of the figure with extra functionality (needs fig.display())
        #   - output: the output area where the figure is displayed;
        #             each figure has its own output so it can be cleared separately
        #   - changed: True if any value in the dict has changed, False otherwise;
        #              used to track if changes where by selecting different nodes or changing #              the settings (e.g., overlap)
        return {
            "fig": None,
            "output": self.Output(layout={'width': "100%", 'height': 'auto'}),
            "changed": False,
        }

    def __init__(self, jupyphant_entity: "Jupyphant_plot.Jupyphant"):
        """
        Class to outsource some jupyphant logic.
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity: "Jupyphant_plot.Jupyphant" = jupyphant_entity
        self.previous_neo_object_dict = {key: [] for key in self.NeoKey}
        self.jupyterlab_theme = 'plotly_dark'
        self.plots: dict[
            str,
            Jupyphant_plot.RawPlotDict | Jupyphant_plot.ImageSequencePlotDict
        ] = {}

        #Setting extra options for each plot (also needs to be set with an empty dict if no extra option is wanted)
        for key in self.RawPlotKey:
            self.plots[key] = {
                **self._base_plot_dict(),
                "overlapping": False,
                "og_x_range": None,
                "x_range": None,
                "max_points": 10000,
                "zero_based": True
            }
        self.plots[self.PLOT_IMGSEQUENCE]= {
            **self._base_plot_dict(),
            "color_grade": "Viridis"
        }

    def _raw_plot(self):
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
                plot_dict = self.plots[key]
                plot_dict['x_range']=None
                plot_dict['og_x_range']=None

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
                    output = plot_dict["output"]
                    with output:
                        Jupyphant_plot.clear_output()
                        output.layout.display = 'none'
            else:
                all_keys = primary_keys + secondary_keys
                if plot_dict["changed"] or (selection_changed and any(change_dict[k] for k in all_keys)):
                    output = plot_dict["output"]
                    with output:
                        if plot_dict["fig"] is not None:
                            Jupyphant_plot.clear_output(wait=True)
                        else:
                            output.layout.display = 'block'
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

        create_plot(self.RawPlotKey.RAW_ST, self._create_rasterplot, self.NeoKey.spiketrain, [self.NeoKey.event, self.NeoKey.epoch])

        create_plot(self.RawPlotKey.RAW_ANASIG, self._create_lfpplot, [self.NeoKey.analogsignal, self.NeoKey.irregularsignal], [self.NeoKey.event, self.NeoKey.epoch])

        keys_that_also_display_events = [self.NeoKey.spiketrain, self.NeoKey.analogsignal, self.NeoKey.irregularsignal]
        if all(empty_dict[key] for key in keys_that_also_display_events):
            create_plot(self.RawPlotKey.RAW_EVENT, self._create_annotation_plot, [self.NeoKey.event, self.NeoKey.epoch], keys_that_also_display_events)
        else:
            plot_dict = self.plots[self.RawPlotKey.RAW_EVENT]
            if plot_dict["fig"] is not None:
                plot_dict["fig"]=None
                with plot_dict["output"]:
                    Jupyphant_plot.clear_output()

        create_plot(self.PLOT_IMGSEQUENCE, self._create_image_sequence, self.NeoKey.imagesequence)


    def create_explorer_raw_plot(self):
        for plot_dict in self.plots.values():
            output = plot_dict["output"]
            Jupyphant_plot.display(output)
            output.layout.display = 'none'
        self.jupyphant_entity.on_selected_neo_objects_changed.add_listener(self._raw_plot)

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
            self._raw_plot()
    
    def set_zero_based(self, zero_based):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            if zero_based != plot_dict['zero_based']:
                plot_dict['zero_based']=zero_based
                fig = plot_dict['fig']
                if fig is None:
                    continue
                plot_dict['og_x_range']=None
                plot_dict['x_range']=None
                plot_dict['changed']=True
                reload = True
        if reload:
            self._raw_plot()

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
            self._raw_plot()

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
            self._raw_plot()

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
            if not self.np.allclose(x_range, previous_x_range, atol=1e-1):
                plot_dict['x_range']=x_range
                temp_reload = True
            if(not fig.isDownscaled()):
                temp_reload = False
            plot_dict['changed']=temp_reload
            reload = reload or temp_reload
        if reload:
            self._raw_plot()
    
    def reset_scale(self):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            fig = plot_dict['fig']
            if fig is None:
                continue
            if not self.np.allclose(plot_dict['og_x_range'], plot_dict['x_range'], atol=1e-1):
                plot_dict['x_range']=plot_dict['og_x_range']
                plot_dict['changed']=True
                reload = True
        if reload:
            self._raw_plot()
        
    def _create_rasterplot(self, spiketrain=None, event=None, epoch=None):
        data = [self.SpikeTrainRasterPlot(st) for st in spiketrain]
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_ST]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        fig = self.PlotlyGraphFigure(data, title=f"Rasterplot for selected SpikeTrains", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, overlap_on_compress=False, max_points=max_points, shift_to_0=zero_based)
        x_range = fig.getXRange()
        plot_dict['x_range']=x_range
        if plot_dict['og_x_range'] is None:
            plot_dict['og_x_range']=x_range
        return fig

    def _create_lfpplot(self, analogsignal=None, irregularsignal=None, event=None, epoch=None):
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
        fig = self.PlotlyGraphFigure(data, title=f"Normalized LFP-Plots for selected AnalogSignals and IrregularlySampledSignals", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, max_points=max_points, shift_to_0=zero_based)
        x_range = fig.getXRange()
        plot_dict['x_range']=x_range
        if plot_dict['og_x_range'] is None:
            plot_dict['og_x_range']=x_range
        return fig
    
    def _create_annotation_plot(self, event=None, epoch=None, spiketrain=None, analogsignal=None, irregularsignal=None):
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_EVENT]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        fig = self.PlotlyGraphFigure(None, title=f"Plot for selected Events and Epochs", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, theme_name=self.jupyterlab_theme, overlap_on_compress=False, max_points=max_points, shift_to_0=zero_based)
        x_range = fig.getXRange()
        plot_dict['x_range']=x_range
        if plot_dict['og_x_range'] is None:
            plot_dict['og_x_range']=x_range
        return fig

    def _create_image_sequence(self, imagesequence=None):
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        color_grade = plot_dict['color_grade']
        return self.PlotlyImageSequenceFigure(image_sequences=imagesequence, theme_name=self.jupyterlab_theme, color_scale=color_grade)