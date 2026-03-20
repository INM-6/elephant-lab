class Jupyphant_plot:
    from .PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
    from .PlotlyGraphFigure import PlotlyGraphFigure
    from .PlotlyGraphDataTypes import SpikeTrainRasterPlot, AnalogSignalLFPPlotList, EventAnnotations, EpochIntervals, IrregularlySampledSignalPlotList

    from neo import SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence
    from enum import Enum
    import numpy as np
    from ipywidgets import Output, HTML
    from IPython.display import clear_output, display
    from ipykernel.comm import Comm

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
        is_plotted: bool
        changed: bool

    class RawPlotDict(DefaultPlotDict):
        overlapping: bool
        og_x_range: list[float] | None
        x_range: list[float] | None
        max_points: int
        zero_based: bool
        is_default_zero_based: bool
        is_downscaled: bool
        changes_on_overlap: bool
    
    class ImageSequencePlotDict(DefaultPlotDict):
        color_grade: str

    def _base_plot_dict(self) -> "Jupyphant_plot.DefaultPlotDict":
        # Add all required options to each plot:
        #   - is_plotted: Is the plot plotted
        #   - changed: True if any value in the dict has changed, False otherwise;
        #              used to track if changes where by selecting different nodes or changing #              the settings (e.g., overlap)
        return {
            "is_plotted": False,
            "changed": False,
        }

    def __init__(self, jupyphant_entity: "Jupyphant_plot.Jupyphant"):
        """
        Class to outsource some jupyphant logic:
            -all logic regarding the plotting of Jupyphant
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity: "Jupyphant_plot.Jupyphant" = jupyphant_entity
        self.previous_neo_object_dict = {key: [] for key in self.NeoKey}
        self.plots: dict[
            str,
            Jupyphant_plot.RawPlotDict | Jupyphant_plot.ImageSequencePlotDict
        ] = {}
        self.update_counter = 0
        self.comm: "Jupyphant_plot.Comm" = None

        #Setting extra options for each plot (also needs to be set with an empty dict if no extra option is wanted)
        for key in self.RawPlotKey:
            self.plots[key] = {
                **self._base_plot_dict(),
                "overlapping": False,
                "og_x_range": None,
                "x_range": None,
                "max_points": 10000,
                "zero_based": False,
                "is_default_zero_based": True,
                "is_downscaled": False,
                "changes_on_overlap": True
            }
        self.plots[self.PLOT_IMGSEQUENCE]= {
            **self._base_plot_dict(),
            "color_grade": "Viridis"
        }

    def _string_key(self, plot_key):
        if isinstance(plot_key, str):
            return plot_key
        return plot_key.value

    def _plot_configs(self):
        return [
        (
            self.RawPlotKey.RAW_ST,
            self._create_rasterplot,
            [self.NeoKey.spiketrain],
            [self.NeoKey.event, self.NeoKey.epoch],
        ),
        (
            self.RawPlotKey.RAW_ANASIG,
            self._create_lfpplot,
            [self.NeoKey.analogsignal, self.NeoKey.irregularsignal],
            [self.NeoKey.event, self.NeoKey.epoch],
        ),
        (
            self.PLOT_IMGSEQUENCE,
            self._create_image_sequence,
            [self.NeoKey.imagesequence],
            [],
        ),
        (
            self.RawPlotKey.RAW_EVENT,
            self._create_annotation_plot,
            [self.NeoKey.event, self.NeoKey.epoch],
            self._keys_that_also_display_events(),
        )
    ]

    def _keys_that_also_display_events(self):
        return [
            self.NeoKey.spiketrain,
            self.NeoKey.analogsignal,
            self.NeoKey.irregularsignal,
        ]

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

        empty_dict = {}
        for key, current_set in self.previous_neo_object_dict.items():
            empty_dict[key] = len(current_set) == 0

        plots_to_remove = set()
        plots_to_update = []

        def should_update(plot_key, primary_keys, secondary_keys):
            if not isinstance(primary_keys, list):
                primary_keys = [primary_keys]
            if not isinstance(secondary_keys, list):
                secondary_keys = [secondary_keys]

            plot_dict = self.plots[plot_key]

            def remove_x_range():
                for key in ('og_x_range', 'x_range'):
                    if key in plot_dict:
                        plot_dict[key] = None

            if plot_key == self.RawPlotKey.RAW_EVENT:
                if not all(empty_dict[key] for key in self._keys_that_also_display_events()):
                    remove_x_range()
                    plots_to_remove.add(plot_key)
                    return False

            # Case 1: nothing to show → close plot
            if all(empty_dict[k] for k in primary_keys):
                remove_x_range()
                plots_to_remove.add(plot_key)
                return False

            # Case 2: needs update
            all_keys = primary_keys + secondary_keys
            if plot_dict["changed"] or (
                selection_changed and any(change_dict[k] for k in all_keys)
            ):
                if selection_changed:
                    remove_x_range()
                return True

            return False

        plot_configs = self._plot_configs()

        for plot_key, method, primary_keys, secondary_keys in plot_configs:
            if should_update(plot_key, primary_keys, secondary_keys):
                plots_to_update.append((plot_key, method, primary_keys, secondary_keys))

        # -------- only remove the ones that are already plotted --------
        filtered_plots_to_remove = set()
        for plot_key in plots_to_remove:
            plot_dict = self.plots[plot_key]
            if plot_dict['is_plotted']:
                plot_dict['is_plotted'] = False
                filtered_plots_to_remove.add(plot_key)
        plots_to_remove = filtered_plots_to_remove

        # -------- notify frontend (loading state) --------
        if plots_to_remove:
            self.comm.send({
                "type": "plots_remove",
                "plots": [self._string_key(plot_key) for plot_key in plots_to_remove]
            })

        if plots_to_update:
            self.comm.send({
                "type": "plots_loading",
                "plots": [self._string_key(plot_key)  for plot_key, *_ in plots_to_update]
            })

        # -------- compute --------
        updated_figs = {}

        for plot_key, method, primary_keys, secondary_keys in plots_to_update:
            plot_dict = self.plots[plot_key]

            all_keys = primary_keys + secondary_keys

            plot_kwargs = {
                self._string_key(key) : self.previous_neo_object_dict[key]
                for key in all_keys if not empty_dict[key]
            }

            fig: Jupyphant_plot.PlotlyGraphFigure | Jupyphant_plot.PlotlyImageSequenceFigure = method(**plot_kwargs)
            plot_dict["is_plotted"] = True

            # store JSON for batch send
            updated_figs[self._string_key(plot_key) ] = fig.to_dict()

            plot_dict["changed"] = False

        # -------- send updated figures --------
        current_update_id = self.update_counter
        if updated_figs:
            self.comm.send({
                "type": "plots_update",
                "update_id": current_update_id,
                "plots": updated_figs
            })
        self.update_counter += 1

    def on_selection_changed(self):
        try:
            self._raw_plot()
        except Exception as e:
            if self.comm:
                self.comm.send({"type": "error", "message": str(e)})

    def create_explorer_raw_plot(self):
        self.comm = self.Comm(target_name="plot_channel")
        self.jupyphant_entity.on_selected_neo_objects_changed.add_listener(self.on_selection_changed)

    def set_raw_plot_overlap(self, overlap):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            if not plot_dict['changes_on_overlap']:
                continue
            if overlap == plot_dict['overlapping']:
                continue
            plot_dict['overlapping']=overlap
            is_plotted = plot_dict['is_plotted']
            if not is_plotted:
                continue
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
                is_plotted = plot_dict['is_plotted']
                if not is_plotted or plot_dict['is_default_zero_based']:
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
            is_plotted = plot_dict['is_plotted']
            if is_plotted:
                plot_dict['changed']=True
                reload = True
        if reload:
            self._raw_plot()

    def upscale_raw_plot(self, max_points, x_ranges):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            temp_reload = False
            if(max_points != plot_dict['max_points']):
                plot_dict['max_points']=max_points
                temp_reload = True
            is_plotted = plot_dict['is_plotted']
            if not is_plotted:
                continue
            previous_x_range = plot_dict['x_range']
            x_range = x_ranges[key.value]
            if not self.np.allclose(x_range, previous_x_range, rtol=1e-3):
                plot_dict['x_range']=x_range
                temp_reload = True
            if(not plot_dict['is_downscaled']):
                temp_reload = False
            plot_dict['changed']=temp_reload
            reload = reload or temp_reload
        if reload:
            self._raw_plot()
    
    def reset_scale(self):
        reload = False
        for key in self.RawPlotKey:
            plot_dict = self.plots[key]
            is_plotted = plot_dict['is_plotted']
            if not is_plotted:
                continue
            if not self.np.allclose(plot_dict['og_x_range'], plot_dict['x_range'], rtol=1e-3):
                plot_dict['x_range']=plot_dict['og_x_range']
                plot_dict['changed']=True
                reload = True
        if reload:
            self._raw_plot()

    def _set_plot_dict_for_raw_plot(self, plot_dict, fig: PlotlyGraphFigure):
        x_range = fig.getXRange()
        plot_dict['x_range']=x_range
        if plot_dict['og_x_range'] is None:
            plot_dict['og_x_range']=x_range
        plot_dict['is_default_zero_based']=fig.isDefaultZeroBased()
        plot_dict['is_downscaled']=fig.isDownscaled()
        plot_dict['changes_on_overlap']=fig.changesOnOverlap()
        
    def _create_rasterplot(self, spiketrain=None, event=None, epoch=None):
        data = [self.SpikeTrainRasterPlot(st) for st in spiketrain]
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_ST]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        fig = self.PlotlyGraphFigure(data, title=f"Rasterplot for selected SpikeTrains", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, overlap_on_compress=False, max_points=max_points, shift_to_0=zero_based)
        self._set_plot_dict_for_raw_plot(plot_dict, fig)
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
        fig = self.PlotlyGraphFigure(data, title=f"Normalized LFP-Plots for selected AnalogSignals and IrregularlySampledSignals", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, max_points=max_points, shift_to_0=zero_based)
        self._set_plot_dict_for_raw_plot(plot_dict, fig)
        return fig
    
    def _create_annotation_plot(self, event=None, epoch=None, spiketrain=None, analogsignal=None, irregularsignal=None):
        event_annotations = self.EventAnnotations(event) if event is not None else None
        epoch_intervals = self.EpochIntervals(epoch) if epoch is not None else None
        plot_dict = self.plots[self.RawPlotKey.RAW_EVENT]
        overlapping = plot_dict['overlapping']
        x_range = plot_dict['x_range']
        max_points = plot_dict['max_points']
        zero_based = plot_dict['zero_based']
        fig = self.PlotlyGraphFigure(None, title=f"Plot for selected Events and Epochs", overlapping=overlapping, x_range=x_range, annotation_data=event_annotations, annotation_interavals_data=epoch_intervals, overlap_on_compress=False, max_points=max_points, shift_to_0=zero_based)
        self._set_plot_dict_for_raw_plot(plot_dict, fig)
        return fig

    def _create_image_sequence(self, imagesequence=None):
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        color_grade = plot_dict['color_grade']
        return self.PlotlyImageSequenceFigure(image_sequences=imagesequence, color_scale=color_grade)