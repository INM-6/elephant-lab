class ElephantLab_plot:
    from .PlotlyImageSequenceFigure import PlotlyImageSequenceFigure
    from .PlotlyGraphDatas import SpikeTrainRasterPlot, AnalogSignalLFPPlotList, EventAnnotation, EpochAnnotation, IrregularlySampledSignalPlotList
    from .PlotlyGraphContainer import PlotlyGraphDataBundle

    from neo import SpikeTrain, AnalogSignal, Event, Epoch, IrregularlySampledSignal, ImageSequence
    from enum import Enum
    from ipywidgets import Output, HTML
    from IPython.display import display
    from ipykernel.comm import Comm

    from typing import TypedDict, TYPE_CHECKING

    if TYPE_CHECKING:
        from .elephant_lab import ElephantLab  # only for type hints

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
        data_bundle: "ElephantLab_plot.PlotlyGraphDataBundle"

    class RawPlotDict(DefaultPlotDict):
        overlapping: bool
        zero_based: bool
        normalize_y_values: bool
        normalization_method: str
        changes_on_overlap: bool
    
    class ImageSequencePlotDict(DefaultPlotDict):
        color_grade: str

    def _base_plot_dict(self) -> "ElephantLab_plot.DefaultPlotDict":
        # Add all required options to each plot:
        #   - is_plotted: Is the plot plotted
        #   - changed: True if any value in the dict has changed, False otherwise;
        #              used to track if changes where by selecting different nodes or changing #              the settings (e.g., overlap)
        return {
            "is_plotted": False,
            "changed": False,
            "data_bundle": None
        }

    def __init__(self, elephant_lab_entity: "ElephantLab_plot.ElephantLab"):
        """
        Class to outsource some elephant lab logic:
            -all logic regarding the plotting of Elephant Lab
        Is a Class to minimize the amount of name clutter in the notebook
        """
        self.elephant_lab_entity: "ElephantLab_plot.ElephantLab" = elephant_lab_entity
        self.previous_neo_object_dict = {key: [] for key in self.NeoKey}
        self.plots: dict[
            str,
            ElephantLab_plot.RawPlotDict | ElephantLab_plot.ImageSequencePlotDict
        ] = {}
        self.update_counter = 0
        self.comm: "ElephantLab_plot.Comm" = None
        self._is_panel_active = False
        self._selection_changed = False

        #Setting extra options for each plot (also needs to be set with an empty dict if no extra option is wanted)
        for key in self.RawPlotKey:
            self.plots[key] = {
                **self._base_plot_dict(),
                "overlapping": False,
                "zero_based": False,
                "changes_on_overlap": True,
                "normalize_y_values": False,
                "normalization_method": "zscore"
            }
        self.plots[self.PLOT_IMGSEQUENCE]= {
            **self._base_plot_dict(),
            "color_grade": "Viridis"
        }

    def _string_key(self, plot_key):
        if isinstance(plot_key, str):
            return plot_key
        return plot_key.value
    
    def _enum_key(self, plot_key):
        if isinstance(plot_key, self.RawPlotKey):
            return plot_key
        try:
            return self.RawPlotKey(plot_key)
        except ValueError:
            return plot_key

    def _plot_configs(self, plot_key=None):
        configs = {
            self.RawPlotKey.RAW_ST: (
                self._create_rasterplot,
                [self.NeoKey.spiketrain],
                [self.NeoKey.event, self.NeoKey.epoch],
            ),
            self.RawPlotKey.RAW_ANASIG: (
                self._create_lfpplot,
                [self.NeoKey.analogsignal, self.NeoKey.irregularsignal],
                [self.NeoKey.event, self.NeoKey.epoch],
            ),
            self.PLOT_IMGSEQUENCE: (
                self._create_image_sequence,
                [self.NeoKey.imagesequence],
                [],
            ),
            self.RawPlotKey.RAW_EVENT: (
                self._create_annotation_plot,
                [self.NeoKey.event, self.NeoKey.epoch],
                self._keys_that_also_display_events(),
            ),
        }

        if plot_key is None:
            return configs

        return configs[plot_key]

    def _keys_that_also_display_events(self):
        return [
            self.NeoKey.spiketrain,
            self.NeoKey.analogsignal,
            self.NeoKey.irregularsignal,
        ]

    def _raw_plot(self):
        if not self._is_panel_active or (not self._selection_changed and not any(v["changed"] for v in self.plots.values())):
            return
        neo_object_dict = None
        selection_changed = self._selection_changed
        if selection_changed:
            self._selection_changed = False
            neo_object_dict = {
                self.NeoKey.spiketrain: self.SpikeTrain,
                self.NeoKey.analogsignal: self.AnalogSignal,
                self.NeoKey.irregularsignal: self.IrregularlySampledSignal,
                self.NeoKey.event: self.Event,
                self.NeoKey.epoch: self.Epoch,
                self.NeoKey.imagesequence: self.ImageSequence
            }
            neo_object_dict = self.elephant_lab_entity._get_selected_neo_objects_by_class(neo_object_dict)
            change_dict = {}
            for key, current_list in neo_object_dict.items():
                previous_list = self.previous_neo_object_dict[key]
                change_dict[key] = { self.elephant_lab_entity.get_neo_hash(o) for o in current_list
                } != {
                    self.elephant_lab_entity.get_neo_hash(o) for o in previous_list
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

            if plot_key == self.RawPlotKey.RAW_EVENT:
                if not all(empty_dict[key] for key in self._keys_that_also_display_events()):
                    plots_to_remove.add(plot_key)
                    return False

            # Case 1: nothing to show → close plot
            if all(empty_dict[k] for k in primary_keys):
                plots_to_remove.add(plot_key)
                return False

            # Case 2: needs update
            all_keys = primary_keys + secondary_keys
            if plot_dict["changed"] or (
                selection_changed and any(change_dict[k] for k in all_keys)
            ):
                return True

            return False

        plot_configs = self._plot_configs()

        for plot_key, (method, primary_keys, secondary_keys) in plot_configs.items():
            if should_update(plot_key, primary_keys, secondary_keys):
                plots_to_update.append((plot_key, method, primary_keys, secondary_keys))

        # -------- only remove the ones that are already plotted --------
        filtered_plots_to_remove = set()
        for plot_key in plots_to_remove:
            plot_dict = self.plots[plot_key]
            if plot_dict['is_plotted']:
                plot_dict['is_plotted'] = False
                plot_dict['data_bundle'] = None
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

            fig_dict = method(**plot_kwargs)
            plot_dict["is_plotted"] = True

            # store JSON for batch send
            updated_figs[self._string_key(plot_key) ] = fig_dict

            plot_dict["changed"] = False

        # -------- send updated figures --------
        if updated_figs:
            self.comm.send({
                "type": "plots_update",
                "plots": updated_figs
            })

    def on_selection_changed(self):
        self._selection_changed = True
        try:
            self._raw_plot()
        except Exception as e:
            if self.comm:
                self.comm.send({"type": "error", "message": str(e)})

    def set_explore_panel_active(self, is_active: bool):
        self._is_panel_active = is_active
        if is_active:
            self._raw_plot()

    def create_explorer_raw_plot(self):
        self.comm = self.Comm(target_name="plot_channel")
        self.elephant_lab_entity.on_selected_neo_objects_changed.add_listener(self.on_selection_changed)

    def get_normalized_data_for_plot_with_x_range(self, plot_key, x_range=None):
            plot_dict = self.plots[self._enum_key(plot_key)]
            data_bundle = plot_dict['data_bundle']
            if data_bundle is not None and self.comm:
                normalized_data = data_bundle.get_normalized_data_for_x_range(x_range=x_range)
                if normalized_data['plotly_graph_data_list_changed'] or normalized_data['annotation_list_changed']:
                    self.comm.send({"type": "plot_resample", "plot_key": plot_key, "data_bundle": normalized_data})

    def update_settings(self, **settings):
        overlap = settings.get("overlap")
        zero_based = settings.get("zero_based")
        color_grade = settings.get("color_grade")
        normalize_y_values = settings.get("normalize_y_values")
        normalization_method = settings.get("normalization_method")
        
        reload = False

        for key in self.RawPlotKey:
            plot_dict = self.plots[key]

            # overlap
            if overlap is not None and overlap != plot_dict['overlapping']:
                plot_dict['overlapping'] = overlap

                if (
                    plot_dict['is_plotted']
                    and plot_dict['changes_on_overlap']
                ):
                    plot_dict['changed'] = True
                    reload = True

            # zero_based
            if zero_based is not None and zero_based != plot_dict['zero_based']:
                plot_dict['zero_based'] = zero_based

                if (
                    plot_dict['is_plotted']
                    and not plot_dict['data_bundle'].is_default_zero_based
                ):
                    plot_dict['changed'] = True
                    reload = True

            # normalize_y_values
            if (
                normalize_y_values is not None
                and normalize_y_values != plot_dict['normalize_y_values']
            ):
                plot_dict['normalize_y_values'] = normalize_y_values

                if (
                    plot_dict['is_plotted']
                    and not plot_dict['data_bundle'].is_default_normalized_y
                ):
                    plot_dict['changed'] = True
                    reload = True

            # normalization_method
            if (
                normalization_method is not None
                and normalization_method != plot_dict['normalization_method']
            ):
                plot_dict['normalization_method'] = normalization_method

                if plot_dict['is_plotted']:
                    plot_dict['changed'] = True
                    reload = True

        # special case: image sequence plot
        if color_grade is not None:
            plot_dict = self.plots[self.PLOT_IMGSEQUENCE]

            if color_grade != plot_dict['color_grade']:
                plot_dict['color_grade'] = color_grade

                if plot_dict['is_plotted']:
                    plot_dict['changed'] = True
                    reload = True

        if reload:
            self._raw_plot()

    def _create_graph_plot(self, plot_key, data_list, annotation_list, title, overlap_on_compress=True):
        plot_dict = self.plots[plot_key]
        overlapping = plot_dict['overlapping']
        shift_to_0 = plot_dict['zero_based']
        normalize_y_values = plot_dict['normalize_y_values']
        normalization_method = plot_dict['normalization_method']
        data_bundle = self.PlotlyGraphDataBundle(data_list, annotation_list)
        data_bundle.normalize(offset_traces_on_compress= not overlapping or not overlap_on_compress, shift_to_0=shift_to_0, normalize_y_values=normalize_y_values, normalization_method=normalization_method)
        changes_on_overlap = plot_dict['changes_on_overlap']= (not data_bundle.compress or overlap_on_compress) and data_bundle.nGraphs != 1

        fig_dict = {
            "title": title,
            "overlapping": overlapping,
            "changes_on_overlap": changes_on_overlap,
            "data_bundle": data_bundle.get_normalized_data_for_x_range(setup=True),
        }

        plot_dict['changes_on_overlap'] = changes_on_overlap
        plot_dict['data_bundle'] = data_bundle
        return fig_dict
        
    def _create_rasterplot(self, spiketrain=None, event=None, epoch=None):
        data_list = [self.SpikeTrainRasterPlot(st, self.elephant_lab_entity.names_for) for st in spiketrain]
        annotation_list = (
            [self.EventAnnotation(e) for e in (event or [])]
            + [self.EpochAnnotation(e) for e in (epoch or [])]
        )
        return self._create_graph_plot(self.RawPlotKey.RAW_ST, data_list, annotation_list, title="Rasterplots", overlap_on_compress=False)

    def _create_lfpplot(self, analogsignal=None, irregularsignal=None, event=None, epoch=None):
        data_list = None
        if analogsignal is not None:
            data_list = self.AnalogSignalLFPPlotList(analogsignal, self.elephant_lab_entity.names_for)
        if irregularsignal is not None:
            irregular_data = self.IrregularlySampledSignalPlotList(irregularsignal, self.elephant_lab_entity.names_for)
            if data_list is None:
                data_list = irregular_data
            else:
                data_list.concat(irregular_data)
        annotation_list = (
            [self.EventAnnotation(e) for e in (event or [])]
            + [self.EpochAnnotation(e) for e in (epoch or [])]
        )
        return self._create_graph_plot(self.RawPlotKey.RAW_ANASIG, data_list, annotation_list, title="LFP-Plots")
    
    def _create_annotation_plot(self, event=None, epoch=None, spiketrain=None, analogsignal=None, irregularsignal=None):
        annotation_list = (
            [self.EventAnnotation(e) for e in (event or [])]
            + [self.EpochAnnotation(e) for e in (epoch or [])]
        )
        return self._create_graph_plot(self.RawPlotKey.RAW_EVENT, None, annotation_list, title="Plotted Events and Epochs", overlap_on_compress=False)

    def _create_image_sequence(self, imagesequence=None):
        plot_dict = self.plots[self.PLOT_IMGSEQUENCE]
        color_grade = plot_dict['color_grade']
        return self.PlotlyImageSequenceFigure(image_sequences=imagesequence, color_scale=color_grade, name_fallback=self.elephant_lab_entity.names_for)