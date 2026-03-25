class Jupyphant_info:

    from IPython.lib.pretty import RepresentationPrinter
    from IPython.display import display, clear_output
    from ipywidgets import Output
    import numpy as np
    import quantities as pq
    from elephant import statistics
    from neo.core.regionofinterest import CircularRegionOfInterest, RectangularRegionOfInterest, PolygonRegionOfInterest
    from neo import SpikeTrain, AnalogSignal, Event, Epoch
    from neo.core.baseneo import BaseNeo
    from neo.core.container import Container
    from neo.core.spiketrainlist import SpikeTrainList
    from collections import Counter, defaultdict
    from io import StringIO
    import re

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .jupyphant import Jupyphant  # only for type hints

    def __init__(self, jupyphant_entity: "Jupyphant_info.Jupyphant"):
        """
        Class to outsource some jupyphant logic:
            -all logic regarding the neo info of Jupyphant
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity: "Jupyphant_info.Jupyphant" = jupyphant_entity

    def create_details_panel(self):
        def on_selected_change_info():
            with output_node_info:
                Jupyphant_info.clear_output()
                self.pretty_print_of_selected_neo_objects()

        output_node_info = self.Output(layout={'border': '1px solid orange'})
        self.jupyphant_entity.on_selected_neo_objects_changed.add_listener(on_selected_change_info)
        Jupyphant_info.display(output_node_info)

    def _print_as_table(self, data, pp):
        """
        Prints a list of lists as a formatted table using the provided pretty-printer.
        """
        if not data:
            return

        num_columns = len(data[0]) if data else 0
        if num_columns == 0:
            return

        table_data = []
        for row in data:
            str_row = [str(item) for item in row]
            padded_row = str_row[:num_columns] + [''] * (num_columns - len(str_row))
            table_data.append(padded_row)

        col_widths = [0] * num_columns
        for row in table_data:
            for i, cell in enumerate(row):
                if len(cell) > col_widths[i]:
                    col_widths[i] = len(cell)

        bold = '\033[1m'
        reset = '\033[0m'
        
        header_cells = [
            f"{{:<{col_widths[i]}}}".format(table_data[0][i])
            for i in range(num_columns)
        ]
        bold_header_line = " | ".join([f"{bold}{cell}{reset}" for cell in header_cells])
        pp.text(bold_header_line)
        pp.text("\n")

        separator = "-+-".join("-" * width for width in col_widths)
        pp.text(separator)
        pp.text("\n")

        row_format = " | ".join(f"{{:<{width}}}" for width in col_widths)
        for row in table_data[1:]:
            pp.text(row_format.format(*row))
            pp.text("\n")

    def _repr_pretty_annotations_overview(self, all_annotations, count, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        if not all_annotations:
            return
            
        all_keys = set()
        for anno in all_annotations:
            if anno:
                all_keys.update(anno.keys())
        
        common_annos = {}
        different_annos = []
        partial_annos = []

        for key in all_keys:
            values_with_key = [anno.get(key) for anno in all_annotations if anno and key in anno]
            
            if len(values_with_key) == count: # present in all
                try:
                    first_val_str = str(values_with_key[0])
                    if all(str(v) == first_val_str for v in values_with_key[1:]):
                        common_annos[key] = values_with_key[0]
                    else:
                        different_annos.append(key)
                except:
                    different_annos.append(key)
            else:
                partial_annos.append(key)
        
        if common_annos:
            pp.text(f"  \n{bold}Identical Annotations:{reset}\n")
            for k, v in common_annos.items():
                pp.text(f"    {bold}{k}:{reset} {v}\n")
        
        if different_annos:
            pp.text(f"  \n{bold}Diverging Annotations:{reset} {', '.join(different_annos)}\n")
        
        if partial_annos:
            pp.text(f"  \n{bold}Unique Annotations:{reset} {', '.join(partial_annos)}\n")

    def _repr_pretty_spiketrain_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        spiketrains = [item['obj'] for item in items]
        count = len(spiketrains)
        total_spikes = sum(len(st) for st in spiketrains)
        
        pp.text(f"{bold}SpikeTrain Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        pp.text(f"  {bold}Total Spikes:{reset} {total_spikes}\n")

        # Units Check
        units = set(str(st.units.dimensionality) for st in spiketrains)
        pp.text(f"  {bold}Units:{reset} {', '.join(units)}\n")

        all_annotations = [st.annotations for st in spiketrains]
        self._repr_pretty_annotations_overview(all_annotations, count, pp)
        
        # Time Range
        all_t_starts = [st.t_start for st in spiketrains]
        all_t_stops = [st.t_stop for st in spiketrains]
        pp.text(f"  \n{bold}Time Range (t_start to t_stop):{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(all_t_starts)}\n")
        pp.text(f"    {bold}Max:{reset} {max(all_t_stops)}\n")

        if spiketrains:
            target_units = spiketrains[0].units
            all_times_list = []
            for st in spiketrains:
                if len(st) > 0:
                    all_times_list.append(st.times.rescale(target_units))

            if all_times_list:
                all_spike_times_magnitude = self.np.concatenate([q.magnitude for q in all_times_list])
                all_spike_times = self.pq.Quantity(all_spike_times_magnitude, units=target_units)
                
                unit_str = all_spike_times.units.dimensionality
                min_val = self.np.min(all_spike_times).magnitude
                max_val = self.np.max(all_spike_times).magnitude

                pp.text(f"  {bold}Spike Times:{reset}\n")
                pp.text(f"    {bold}Min:{reset} {min_val} {unit_str}\n")
                pp.text(f"    {bold}Max:{reset} {max_val} {unit_str}\n")

        # Firing Rate Statistics
        firing_rates = [self.statistics.mean_firing_rate(st) for st in spiketrains if st.t_stop > st.t_start]
        if firing_rates:
            rate_units = firing_rates[0].units.dimensionality
            pp.text(f"  {bold}Firing Rates ({rate_units}):{reset}\n")
            pp.text(f"    {bold}Min:{reset} {min(fr.magnitude for fr in firing_rates):.4f}\n")
            pp.text(f"    {bold}Max:{reset} {max(fr.magnitude for fr in firing_rates):.4f}\n")
            pp.text(f"    {bold}Average:{reset} {self.np.mean([fr.magnitude for fr in firing_rates]):.4f}\n")

        # ISI Statistics
        isis_list = [self.statistics.isi(st) for st in spiketrains if len(st) > 1]
        if isis_list:
            cvs = [self.statistics.cv(isis) for isis in isis_list]
                        
            if cvs:
                pp.text(f"  {bold}Coefficient of Variation (CV):{reset}\n")
                pp.text(f"    {bold}Min:{reset} {min(cvs):.4f}\n")
                pp.text(f"    {bold}Max:{reset} {max(cvs):.4f}\n")
                pp.text(f"    {bold}Average:{reset} {self.np.mean(cvs):.4f}\n")

        pp.text("\n")

    def _repr_pretty_analogsignal_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        signals = [item['obj'] for item in items]
        count = len(signals)
        
        pp.text(f"{bold}AnalogSignal Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        pp.text(f"  {bold}Total Channels:{reset} {sum(s.shape[1] for s in signals)}\n")

        sampling_rates = set(str(s.sampling_rate) for s in signals)
        pp.text(f"  {bold}Sampling Rates:{reset} {', '.join(map(str, sampling_rates))}\n")

        durations = [s.duration for s in signals]
        pp.text(f"  {bold}Durations:{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(durations)}\n")
        pp.text(f"    {bold}Max:{reset} {max(durations)}\n")

        all_t_starts = [s.t_start for s in signals]
        all_t_stops = [s.t_stop for s in signals]
        pp.text(f"  {bold}Time Range (t_start to t_stop):{reset}\n")
        pp.text(f"    {bold}Min:{reset} {min(all_t_starts)}\n")
        pp.text(f"    {bold}Max:{reset} {max(all_t_stops)}\n")

        all_annotations = [s.annotations for s in signals]
        self._repr_pretty_annotations_overview(all_annotations, count, pp)

        pp.text("\n")

    def _repr_pretty_mixed_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        pp.text(f"{bold}Multiple Object Types Selected{reset}\n")
        pp.text(f"  {bold}Total Objects:{reset} {len(items)}\n")
        
        type_counts = self.Counter(type(item['obj']).__name__ for item in items)
        
        pp.text(f"  {bold}Object Types:{reset}\n")
        for type_name, count in type_counts.items():
            pp.text(f"    - {type_name}: {count}\n")
        pp.text("\n")

    def _repr_pretty_generic_overview(self, items, pp):
        bold = '\033[1m'
        reset = '\033[0m'
        
        count = len(items)
        obj_type_name = items[0]['obj'].__class__.__name__
        
        pp.text(f"{bold}{obj_type_name} Overview{reset}\n")
        pp.text(f"  {bold}Count:{reset} {count}\n")
        
        all_annotations = [item['obj'].annotations for item in items if hasattr(item['obj'], 'annotations')]
        if all_annotations:
             self._repr_pretty_annotations_overview(all_annotations, count, pp)
        
        pp.text("\n")

    def _format_array_annotation_value(self, value):
        if isinstance(value, self.np.ndarray):
            if value.ndim == 1:
                if len(value) > 10:
                    return f"{', '.join(map(str, value[:5]))}, ..., {', '.join(map(str, value[-5:]))}"
                return ', '.join(map(str, value))
            else:
                return f"{value.ndim}D array of shape {value.shape}"
        return str(value)

    def _repr_pretty_array_annotations(self, neo_obj, pp):
        bold = '\033[1m'
        reset = '\033[0m'

        if hasattr(neo_obj, 'array_annotations') and neo_obj.array_annotations:
            pp.text(f"\n{bold}Array Annotations:{reset}\n")
            for key, value in neo_obj.array_annotations.items():
                formatted_value = self._format_array_annotation_value(value)
                pp.text(f"  {bold}{key}{reset}: {formatted_value}\n")

    def _repr_pretty_neo_objects(self, neo_obj, node_name, pp, cycle):
        """
        Handle pretty-printing of any neo class and python built-in list.

        Parameter:
            obj: neo-object
            pp: instance of RepresentationPrinter
            cyle: boolean; False -> no self-recursion; True -> self-recursion
        """
        bold = '\033[1m'
        reset = '\033[0m'

        def _repr_pretty_recommended_attrs(neo_obj):
            if hasattr(neo_obj, '_recommended_attrs'):
                pp.text("\n")
                pp.text("\n".join([f"{bold}{attr[0]}{reset}: {getattr(neo_obj, attr[0])}"
                                   for attr in neo_obj._recommended_attrs if attr[0] not in neo_obj._repr_pretty_attrs_keys_
                                   and getattr(neo_obj, attr[0]) is not None]))

        path = self.jupyphant_entity._get_obj_path(neo_obj)
        if path:
            pp.text(f"{bold}{path}\n")
        
        clean_node_name = self.re.sub(r'<[^>]+>', '', node_name)
        pp.text(f"{bold}{clean_node_name}{reset}\n")

        # neo-container: Block, Segment, Group
        if isinstance(neo_obj, self.Container):
            pp.text(f"{bold}{neo_obj.__class__.__name__}{reset} with ")

            container_lenghts_and_names = []
            for container_name in neo_obj._child_containers:
                child_container = getattr(neo_obj, container_name)
                if child_container:
                    container_lenghts_and_names.append('{} {}'.format(len(child_container), container_name))
            pp.text(', '.join(container_lenghts_and_names))

            if neo_obj.name:
                pp.text(f"\n{bold}Name:{reset} {neo_obj.name}")
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"\n  {bold}{key}{reset}: {value}")

            _repr_pretty_recommended_attrs(neo_obj)
            pp.text("\n\n")
            return

        # SpikeTrainList
        if isinstance(neo_obj, self.SpikeTrainList):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")

            pp.text(f"{bold}SpikeTrainList{reset}")
            if neo_obj._items is None:
                if neo_obj._spike_time_array is None:
                    pp.text(" (empty)")
                else:
                    pp.text(f"\n  {bold}Spikes:{reset} {neo_obj._spike_time_array.size}")
                    pp.text(f"\n  {bold}Neurons:{reset} {len(neo_obj._all_channel_ids)}")
            else:
                pp.text(f"\n  {bold}SpikeTrains:{reset} {len(neo_obj._items)}")
            pp.text("\n\n")
            return

        # Regions of Interest: Circular, Polygon, Rectangular
        if isinstance(neo_obj, self.CircularRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with center at {neo_obj.center} and radius {neo_obj.radius}")
            pp.text("\n\n")
            return
        if isinstance(neo_obj, self.PolygonRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with vertices at ({neo_obj.vertices})")
            pp.text("\n\n")
            return
        if isinstance(neo_obj, self.RectangularRegionOfInterest):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(f"{neo_obj.__class__.__name__} with center at ({neo_obj.x},{neo_obj.y}), width {neo_obj.width} and height {neo_obj.height}")
            pp.text("\n\n")
            return

        # built-in: list
        if isinstance(neo_obj, list):
            python_list_type_occurences = [type(ele) for ele in neo_obj]
            type_counter = self.Counter(python_list_type_occurences)
            pp.text(f"{bold}{neo_obj.__class__.__name__} contents:{reset}\n")
            table_data = [["Type", "Count"]]
            for type_obj, count in type_counter.items():
                table_data.append([type_obj.__name__, count])
            self._print_as_table(table_data, pp)
            pp.text("\n")
            return

        if neo_obj.__class__.__name__ == 'ObjectList':
            class_name = neo_obj.__class__.__name__
            pp.text(f"{bold}{class_name}{reset}")
            
            if len(neo_obj) > 0:
                item_type = neo_obj[0].__class__.__name__
                pp.text(f"\n  {bold}Items:{reset} {len(neo_obj)}")
                pp.text(f"\n  {bold}Type:{reset} {item_type}")
            else:
                pp.text(" (empty)")
            pp.text("\n\n")
            return
            
        if isinstance(neo_obj, self.AnalogSignal):
            pp.text(f"{neo_obj.shape[1]} channels, {neo_obj.shape[0]} samples\n\n")

            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")

            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            pp.text(f"{bold}Time Range:{reset} {neo_obj.t_start} to {neo_obj.t_stop}\n")
            
            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Sampling Rate:{reset} {neo_obj.sampling_rate}\n\n")
            
            num_channels = neo_obj.shape[1]
            channel_indices = list(range(num_channels))
            
            if num_channels > 4:
                pp.text(f"(Showing data for first 2 and last 2 of {num_channels} channels)\n")
                channel_indices = list(range(2)) + list(range(num_channels - 2, num_channels))
            elif num_channels > 1:
                pp.text(f"(Showing data for all {num_channels} channels)\n")

            header = ["Index", f"Time ({neo_obj.times.units.dimensionality.string})"]
            for i in channel_indices:
                header.append(f"Ch{i}")
            
            table_data = [header]
            times = neo_obj.times

            if len(times) > 20:
                # Add first 10 rows
                for i in range(10):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
                
                # Add ellipsis
                table_data.append(["..."] * len(header))
                
                # Add last 10 rows
                for i in range(len(times) - 10, len(times)):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
            else:
                for i in range(len(times)):
                    row = [i, f"{times[i]:.3f}"]
                    for ch_idx in channel_indices:
                        row.append(f"{neo_obj[i, ch_idx].item():.3f}")
                    table_data.append(row)
            
            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.SpikeTrain):
            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")

            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            pp.text(f"{bold}Time Range:{reset} {neo_obj.t_start} to {neo_obj.t_stop}\n")
            
            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")
            else:
                pp.text("\n")

            
            table_data = [[f"Index ({len(neo_obj)} spikes)", f"Time (in {neo_obj.units.dimensionality}, {neo_obj.dtype})"]]
            times = neo_obj.times

            if len(times) > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}"])
                table_data.append(["...", "..."])
                for i in range(len(times) - 10, len(times)):
                    table_data.append([i, f"{times[i]:.4f}"])
            else:
                for i in range(len(times)):
                    table_data.append([i, f"{times[i]:.4f}"])

            self._print_as_table(table_data, pp)
            self._repr_pretty_array_annotations(neo_obj, pp)
            
            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.Epoch):
            pp.text(f"{len(neo_obj)} epochs\n\n")

            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")
            
            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Data:{reset}\n")
            table_data = [["Index", f"Time (in {neo_obj.units.dimensionality.string}, {neo_obj.dtype})", f"Duration (in {neo_obj.units.dimensionality.string})", "Label"]]
            times = neo_obj.times
            durations = neo_obj.durations
            labels = neo_obj.labels

            num_epochs = len(times)
            if num_epochs > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])
                table_data.append(["...", "...", "...", "..."])
                for i in range(num_epochs - 10, num_epochs):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])
            else:
                for i in range(num_epochs):
                    table_data.append([i, f"{times[i]:.4f}", f"{durations[i]:.4f}", labels[i]])

            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.Event):
            pp.text(f"{len(neo_obj)} events\n\n")
            
            if neo_obj.description:
                pp.text(f"{bold}Description:{reset} {neo_obj.description}\n")
            
            if hasattr(neo_obj, 'file_origin') and neo_obj.file_origin:
                pp.text(f"{bold}File Origin:{reset} {neo_obj.file_origin}\n")

            if neo_obj.annotations:
                pp.text(f"\n{bold}Annotations:{reset}\n")
                for key, value in neo_obj.annotations.items():
                    pp.text(f"{bold}{key}{reset}: {value}\n")
                pp.text("\n")

            pp.text(f"{bold}Data:{reset}\n")
            table_data = [["Index", f"Time (in {neo_obj.units.dimensionality.string}, {neo_obj.dtype})", "Label"]]
            times = neo_obj.times
            labels = neo_obj.labels

            num_events = len(times)
            if num_events > 20:
                for i in range(10):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])
                table_data.append(["...", "...", "..."])
                for i in range(num_events - 10, num_events):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])
            else:
                for i in range(num_events):
                    table_data.append([i, f"{times[i]:.4f}", labels[i]])

            self._print_as_table(table_data, pp)

            self._repr_pretty_array_annotations(neo_obj, pp)

            pp.text("\n\n")
            return

        if isinstance(neo_obj, self.BaseNeo):
            if neo_obj.description:
                pp.text(f"\n{bold}Description:{reset} {neo_obj.description}")
            pp.text(str(neo_obj))
            pp.text("\n\n")
            return

        # any other neo object will be represented with their own / inherited '_repr_pretty_' method
        try:
            neo_obj._repr_pretty_(pp, cycle)
            pp.text("\n\n")
        except AttributeError:
            pp.text(f"Object of type {type(neo_obj)} could not be pretty-printed.")
            pp.text("\n\n")

    def pretty_print_of_selected_neo_objects(self):
        output = self.StringIO()
        pp = self.RepresentationPrinter(output)

        if not self.jupyphant_entity.selected_neo_objects:
            return

        selected_objects_with_node_name = [
            {'obj': self.jupyphant_entity.map_ipytree_node_id_to_neo_obj.get(node._id), 'node_name': node.name, 'variable_name': node.metadata.get('variable_name', '')}
            for node in self.jupyphant_entity.selected_neo_objects if node._id in self.jupyphant_entity.map_ipytree_node_id_to_neo_obj
        ]

        if len(selected_objects_with_node_name) <= 1:
            # Existing logic for single selection or no selection
            if selected_objects_with_node_name:
                item = selected_objects_with_node_name[0]
                self._repr_pretty_neo_objects(item['obj'], item['node_name'], pp, cycle=False)
            print(output.getvalue())
            return
        
        grouped_objects = self.defaultdict(list)
        for item in selected_objects_with_node_name:
            # Handle lists of objects as a special type
            if isinstance(item['obj'], list):
                grouped_objects[list].append(item)
            else:
                grouped_objects[type(item['obj'])].append(item)

        if len(grouped_objects) > 1:
            self._repr_pretty_mixed_overview(selected_objects_with_node_name, pp)
        
        for obj_type, items in grouped_objects.items():
            if len(items) > 1:
                # Multiple objects of the same type
                if issubclass(obj_type, self.SpikeTrain):
                    self._repr_pretty_spiketrain_overview(items, pp)
                elif issubclass(obj_type, self.AnalogSignal):
                    self._repr_pretty_analogsignal_overview(items, pp)
                else:
                    self._repr_pretty_generic_overview(items, pp)
                print(output.getvalue())