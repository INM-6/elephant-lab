class ElephantLab_info:

    from IPython.display import display, clear_output, HTML
    from ipywidgets import Output
    import numpy as np
    from elephant import statistics
    from neo.core.regionofinterest import CircularRegionOfInterest, RectangularRegionOfInterest, PolygonRegionOfInterest
    from neo import SpikeTrain, AnalogSignal, Event, Epoch, ImageSequence, IrregularlySampledSignal, Segment
    from neo.core.baseneo import BaseNeo
    from neo.core.container import Container
    from neo.core.spiketrainlist import SpikeTrainList
    from collections import Counter, defaultdict
    from io import StringIO
    import re

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .elephant_lab import ElephantLab  # only for type hints

    # Shared Style
    _CSS = """
    <style>
    .jup-info { font-family: var(--jp-ui-font-family); font-size: var(--jp-ui-font-size1); color: var(--jp-ui-font-color1); padding-left: 8px; }
    .jup-info h3 { margin: 5px 0 6px 0; font-size: 1.05em; border-top: 2px solid var(--jp-border-color2); border-bottom: none; padding-bottom: 3px; padding-top: 4px;}
    .jup-info .section { margin-bottom: 10px; }
    .jup-info .kv { display: flex; flex-wrap: wrap; gap: 2px 12px; }
    .jup-info .kv-row { display: flex; gap: 4px; }
    .jup-info .key { font-weight: bold; white-space: nowrap; }
    .jup-info .val { color: var(--jp-ui-font-color1); }
    .jup-info .dim { color: var(--jp-ui-font-color2); font-size: 0.9em; }
    .jup-info table { border-collapse: collapse; font-size: var(--jp-ui-font-size1); }
    .jup-info th { padding: 2px 8px; border-bottom: 2px solid var(--jp-border-color1); text-align: left; white-space: nowrap; font-weight: bold; }
    .jup-info td { padding: 2px 8px; border-bottom: 1px solid var(--jp-border-color2); white-space: nowrap; }
    .jup-info td.dim { color: var(--jp-ui-font-color2); }
    .jup-info .scroll { overflow-x: auto; max-width: 100%; margin-top: 4px; }
    .jup-info .tag { display: inline-block; padding: 0px 4px; background: var(--jp-layout-color2); border-radius: 4px; font-size: 0.9em; }
    .jup-info .anno-section { margin-top: 6px; }
    .jup-info .selectable-stat { cursor: pointer; border-bottom: 1px dashed var(--jp-brand-color1); }
    .jup-info .selectable-stat:hover { background: var(--jp-brand-color3); border-radius: 3px; }
    </style>
    """

    def __init__(self, elephant_lab_entity: "ElephantLab_info.ElephantLab"):
        """
        Class to outsource some elephant lab logic:
            -all logic regarding the neo info of Elephant Lab
        Is a Class to minimize the amount of name clutter in the notebook
        """
        self.elephant_lab_entity: "ElephantLab_info.ElephantLab" = elephant_lab_entity
        self._is_panel_active = True
        self._pending_info_update = False
        self._output_node_info = None

    def create_details_panel(self):
        def on_selected_change_info():
            if not self._is_panel_active:
                self._pending_info_update = True
                return
            self._render_info()

        output_node_info = self.Output()
        self._output_node_info = output_node_info
        self.elephant_lab_entity.on_selected_tree_nodes_changed.add_listener(on_selected_change_info)
        ElephantLab_info.display(output_node_info)

    def _render_info(self):
        with self._output_node_info:
            ElephantLab_info.clear_output()
            with self.np.errstate(invalid='ignore', divide='ignore'):
                self.pretty_print_of_selected_tree_nodes()

    def set_details_panel_active(self, is_active: bool):
        self._is_panel_active = is_active
        if is_active and self._pending_info_update:
            self._pending_info_update = False
            self._render_info()

    def pretty_print_of_selected_tree_nodes(self):
        if not self.elephant_lab_entity.selected_tree_nodes:
            return

        # When exactly one folder node is selected, show a summary of its children
        if len(self.elephant_lab_entity.selected_tree_nodes) == 1:
            node = next(iter(self.elephant_lab_entity.selected_tree_nodes))
            if node._id.startswith('folder-'):
                self._display(self._html_folder_node(node))
                return

        selected_objects_with_node_name = [
            {
                'obj': self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj.get(node._id),
                'node_name': node.name,
                'variable_name': node.metadata.get('variable_name', '')
            }
            for node in self.elephant_lab_entity.selected_tree_nodes
            if node._id in self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj
        ]

        if len(selected_objects_with_node_name) <= 1:
            if selected_objects_with_node_name:
                item = selected_objects_with_node_name[0]
                html = self._html_neo_object(item['obj'], item['node_name'])
                self._display(html)
            return

        grouped_objects = self.defaultdict(list)
        for item in selected_objects_with_node_name:
            if isinstance(item['obj'], list):
                grouped_objects[list].append(item)
            else:
                grouped_objects[type(item['obj'])].append(item)

        parts = []
        if len(grouped_objects) > 1:
            parts.append(self._html_mixed_overview(selected_objects_with_node_name))

        for obj_type, items in grouped_objects.items():
            if len(items) > 1:
                if issubclass(obj_type, self.SpikeTrain):
                    parts.append(self._html_spiketrain_overview(items))
                elif issubclass(obj_type, self.IrregularlySampledSignal):
                    parts.append(self._html_irregularlysampledsignal_overview(items))
                elif issubclass(obj_type, self.AnalogSignal):
                    parts.append(self._html_analogsignal_overview(items))
                else:
                    parts.append(self._html_generic_overview(items))

        self._display(''.join(parts))

    # Helper methods to generate HTML for different objects and sections
    def _display(self, html_body: str):
        from IPython.display import display, HTML
        display(HTML(self._CSS + f'<div class="jup-info">{html_body}</div>'))

    def _h3(self, text: str) -> str:
        return f'<h3>{text}</h3>'

    def _kv(self, key: str, value) -> str:
        return f'<div class="kv-row"><span class="key">{key}:</span><span class="val">{value}</span></div>'

    def _tag(self, text: str) -> str:
        return f'<span class="tag">{text}</span>'

    def _kv_selectable(self, key: str, value, filter_type: str, filter_data: dict) -> str:
        import json
        try:
            data_attr = json.dumps(filter_data).replace('"', '&quot;')
        except:
            data_attr = filter_data
        return f'''<div class="kv-row">
            <span class="key">{key}:</span>
            <span class="val selectable-stat"
                data-filter-type="{filter_type}"
                data-filter="{data_attr}"
                title="Click to select matching objects">{value}</span>
        </div>'''
    
    def _section(self, *content) -> str:
        return f'<div class="section">{"".join(content)}</div>'

    def _table_html(self, data) -> str:
        if not data:
            return ''
        header = data[0]
        rows = data[1:]
        th = ''.join(f'<th>{col}</th>' for col in header)
        rows_html = ''
        for row in rows:
            is_ellipsis = all(str(c) == '...' for c in row)
            tds = ''.join(
                f'<td class="dim">{c}</td>' if is_ellipsis else f'<td>{c}</td>'
                for c in row
            )
            rows_html += f'<tr>{tds}</tr>'
        return f'<div class="scroll"><table><thead><tr>{th}</tr></thead><tbody>{rows_html}</tbody></table></div>'

    
    # Single object annotations
    def _html_annotations(self, annotations: dict) -> str:
        if not annotations:
            return ''
        rows = ''.join(self._kv(k, v) for k, v in annotations.items())
        return self._section(self._h3('Annotations'), f'<div class="kv">{rows}</div>')

    # Multiple objects annotations
    # Splits into Identical, Diverging and Unique annotations
    def _html_annotations_overview(self, all_annotations: list, count: int) -> str:
        if not all_annotations:
            return ''

        all_keys = set()
        for anno in all_annotations:
            if anno:
                all_keys.update(anno.keys())

        common, different, partial = {}, [], []
        for key in all_keys:
            values_with_key = [anno.get(key) for anno in all_annotations if anno and key in anno]
            if len(values_with_key) == count:
                try:
                    first = str(values_with_key[0])
                    if all(str(v) == first for v in values_with_key[1:]):
                        common[key] = values_with_key[0]
                    else:
                        different.append(key)
                except:
                    different.append(key)
            else:
                partial.append(key)

        parts = []
        if common:
            rows = ''.join(self._kv(k, v) for k, v in common.items())
            parts.append(self._section(self._h3('Identical Annotations'), f'<div class="kv">{rows}</div>'))
        if different:
            parts.append(self._section(self._h3('Diverging Annotations'),
                ' '.join(self._tag(k) for k in different)))
        if partial:
            parts.append(self._section(self._h3('Unique Annotations'),
                ' '.join(self._tag(k) for k in partial)))
        return ''.join(parts)

    def _html_array_annotations(self, neo_obj) -> str:
        aa = getattr(neo_obj, 'array_annotations', {})
        if not aa:
            return ''
        rows = ''.join(self._kv(k, self._format_array_annotation_value(v)) for k, v in aa.items())
        return self._section(self._h3('Array Annotations'), f'<div class="kv">{rows}</div>')

    def _format_array_annotation_value(self, value) -> str:
        if isinstance(value, self.np.ndarray):
            if value.ndim == 1:
                if len(value) > 10:
                    return f"{', '.join(map(str, value[:5]))}, ..., {', '.join(map(str, value[-5:]))}"
                return ', '.join(map(str, value))
            return f'{value.ndim}D array of shape {value.shape}'
        return str(value)

    def _fmt(self, v, decimals=4) -> str:
        try:
            if self.np.iscomplexobj(v):
                r, im = float(v.real), float(v.imag)
                if self.np.isnan(r) and self.np.isnan(im):
                    return 'nan'
                if self.np.isinf(r) and self.np.isinf(im):
                    return f'{"+" if r > 0 else "-"}inf{"+" if im > 0 else "-"}infj'
                return f'{r:.{decimals}f}{im:+.{decimals}f}j'
            return f'{float(v):.{decimals}f}'
        except (TypeError, ValueError):
            return str(v)

    # Overview panels (multiple selected)
    def _html_mixed_overview(self, items: list) -> str:
        type_counts = self.Counter(type(item['obj']).__name__ for item in items)
        rows = ''.join(self._kv(t, c) for t, c in type_counts.items())
        return self._section(
            self._h3('Multiple Object Types Selected'),
            self._kv('Total Objects', len(items)),
            self._section(self._h3('Object Types'), f'<div class="kv">{rows}</div>')
        )

    def _html_spiketrain_overview(self, items: list) -> str:
        spiketrains = [item['obj'] for item in items]
        count = len(spiketrains)
        total_spikes = sum(len(st) for st in spiketrains)
        units = set(str(st.units.dimensionality) for st in spiketrains)
        all_t_starts = [st.t_start for st in spiketrains]
        all_t_stops = [st.t_stop for st in spiketrains]

        tree = self.elephant_lab_entity.elephant_lab_tree
        for st in spiketrains:
            hash_id = self.elephant_lab_entity.get_neo_hash(st, hash_name='sha1')
            tree.cache_stat(hash_id, 't_start', float(st.t_start.magnitude))
            tree.cache_stat(hash_id, 't_stop', float(st.t_stop.magnitude))

        parts = [
            self._h3(f'SpikeTrain Overview ({count})'),
            self._kv('Total Spikes', total_spikes),
            self._kv('Units', ', '.join(units)),
            self._kv('t_start min', min(all_t_starts)),
            self._kv('t_stop max', max(all_t_stops)),
        ]

        # Spike times
        all_times_list = []
        target_units = spiketrains[0].units
        for st in spiketrains:
            if len(st) > 0:
                all_times_list.append(st.times.rescale(target_units))
        if all_times_list:
            all_mag = self.np.concatenate([q.magnitude for q in all_times_list])
            unit_str = target_units.dimensionality
            parts += [
                self._kv('Spike Time Min', f'{self._fmt(self.np.min(all_mag))} {unit_str}'),
                self._kv('Spike Time Max', f'{self._fmt(self.np.max(all_mag))} {unit_str}'),
            ]
            parts += [
            self._h3('Time Range'),
            self._kv_selectable('t_start Min', str(min(all_t_starts)), 't_start',
            {'value': float(min(all_t_starts).magnitude)}),
            self._kv_selectable('t_stop Max', str(max(all_t_stops)), 't_stop',
                {'value': float(max(all_t_stops).magnitude)}),
            ]
                    
        # Firing rates
        firing_rates_per_st = {
            self.elephant_lab_entity.get_neo_hash(st, hash_name='sha1'):
                float(self.statistics.mean_firing_rate(st).magnitude)
            for st in spiketrains if st.t_stop > st.t_start
        }
        for hash_id, fr in firing_rates_per_st.items():
            tree.cache_stat(hash_id, 'firing_rate', fr)

        if firing_rates_per_st:
            mags = list(firing_rates_per_st.values())
            rate_units = self.statistics.mean_firing_rate(spiketrains[0]).units.dimensionality
            parts += [
                self._h3(f'Firing Rates ({rate_units})'),
                self._kv_selectable('Min', self._fmt(min(mags)), 'firing_rate',
                    {'value': float(min(mags))}),
                self._kv_selectable('Max', self._fmt(max(mags)), 'firing_rate',
                    {'value': float(max(mags))}),
                self._kv('Average', self._fmt(self.np.mean(mags))),
            ]

        # CV
        cv_per_st = {}
        for st in spiketrains:
            if len(st) > 1:
                hash_id = self.elephant_lab_entity.get_neo_hash(st, hash_name='sha1')
                cv = float(self.statistics.cv(self.statistics.isi(st)))
                cv_per_st[hash_id] = cv
                tree.cache_stat(hash_id, 'cv', cv)

        if cv_per_st:
            cvs = list(cv_per_st.values())
            parts += [
                self._h3('Coefficient of Variation (CV)'),
                self._kv_selectable('Min', self._fmt(min(cvs)), 'cv',
                    {'value': float(min(cvs))}),
                self._kv_selectable('Max', self._fmt(max(cvs)), 'cv',
                    {'value': float(max(cvs))}),
                self._kv('Average', self._fmt(self.np.mean(cvs))),
            ]


        all_annotations = [st.annotations for st in spiketrains]
        return self._section(*parts) + self._html_annotations_overview(all_annotations, count)

    def _html_analogsignal_overview(self, items: list) -> str:
        signals = [item['obj'] for item in items]
        count = len(signals)
        sampling_rates = set(str(s.sampling_rate) for s in signals)
        durations = [s.duration for s in signals]
        all_t_starts = [s.t_start for s in signals]
        all_t_stops = [s.t_stop for s in signals]

        parts = [
            self._h3(f'AnalogSignal Overview ({count})'),
            self._kv('Total Channels', sum(s.shape[1] for s in signals)),
            self._kv('Sampling Rates', ', '.join(sampling_rates)),
            self._kv_selectable('Duration Min', str(min(durations)), 'duration',
            {'value': float(min(durations).magnitude), 'op': 'min'}),
            self._kv_selectable('Duration Max', str(max(durations)), 'duration',
            {'value': float(max(durations).magnitude), 'op': 'max'}),
            self._kv_selectable('t_start Min', str(min(all_t_starts)), 't_start',
            {'value': float(min(all_t_starts).magnitude), 'op': 'min'}),
            self._kv_selectable('t_stop Max', str(max(all_t_stops)), 't_stop',
            {'value': float(max(all_t_stops).magnitude), 'op': 'max'}),
        ]

        all_annotations = [s.annotations for s in signals]
        return self._section(*parts) + self._html_annotations_overview(all_annotations, count)

    def _html_irregularlysampledsignal_overview(self, items: list) -> str:
        signals = [item['obj'] for item in items]
        count = len(signals)
        durations = [s.duration for s in signals]
        all_t_starts = [s.t_start for s in signals]
        all_t_stops = [s.t_stop for s in signals]
        all_sample_counts = [s.shape[0] for s in signals]
        units = set(str(s.units.dimensionality) for s in signals)

        # Sampling intervals across all signals
        all_intervals = self.np.concatenate([s.sampling_intervals.magnitude for s in signals])
        interval_unit = signals[0].sampling_intervals.units.dimensionality

        parts = [
            self._h3(f'IrregularlySampledSignal Overview ({count})'),
            self._kv('Total Channels', sum(s.shape[1] for s in signals)),
            self._kv('Units', ', '.join(units)),
            self._kv('Total Samples', sum(all_sample_counts)),
            self._kv('Samples Min / Max', f'{min(all_sample_counts)} / {max(all_sample_counts)}'),
            self._kv('Duration Min', min(durations)),
            self._kv('Duration Max', max(durations)),
            self._kv('t_start Min', min(all_t_starts)),
            self._kv('t_stop Max', max(all_t_stops)),
            self._kv(f'Sampling Interval Min ({interval_unit})', self._fmt(self.np.min(all_intervals))),
            self._kv(f'Sampling Interval Max ({interval_unit})', self._fmt(self.np.max(all_intervals))),
            self._kv(f'Sampling Interval Mean ({interval_unit})', self._fmt(self.np.mean(all_intervals))),
        ]

        all_annotations = [s.annotations for s in signals]
        return self._section(*parts) + self._html_annotations_overview(all_annotations, count)

    def _html_generic_overview(self, items: list) -> str:
        count = len(items)
        obj_type_name = items[0]['obj'].__class__.__name__
        all_annotations = [item['obj'].annotations for item in items if hasattr(item['obj'], 'annotations')]
        parts = [
            self._h3(f'{obj_type_name} Overview ({count})'),
            self._kv('Count', count),
        ]
        return self._section(*parts) + self._html_annotations_overview(all_annotations, count)

    def _html_folder_node(self, folder_node) -> str:
        children = [
            self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj[child._id]
            for child in folder_node.nodes
            if child._id in self.elephant_lab_entity.map_ipytree_node_id_to_neo_obj
        ]

        count = len(children)
        obj_type_name = type(children[0]).__name__ if children else '—'
        parts = [
            self._h3(folder_node.name),
            self._kv('Type', obj_type_name),
            self._kv('Items', count),
            f'<div class="dim" style="margin-top:6px;">Double-click to inspect all {count} items</div>',
        ]
        return self._section(*parts)

    # Single object detail view
    def _html_neo_object(self, neo_obj, node_name: str) -> str:
        clean_name = self.re.sub(r'<[^>]+>', '', node_name)
        header_parts = []
        header_parts.append(self._h3(clean_name))
        header = ''.join(header_parts)

        if isinstance(neo_obj, self.Container):
            return header + self._html_container(neo_obj)
        if isinstance(neo_obj, self.SpikeTrainList):
            return header + self._html_spiketrainlist(neo_obj)
        if isinstance(neo_obj, self.CircularRegionOfInterest):
            return header + self._section(f'Circular ROI — center: {neo_obj.center}, radius: {neo_obj.radius}')
        if isinstance(neo_obj, self.PolygonRegionOfInterest):
            return header + self._section(f'Polygon ROI — vertices: {neo_obj.vertices}')
        if isinstance(neo_obj, self.RectangularRegionOfInterest):
            return header + self._section(f'Rectangular ROI — center: ({neo_obj.x},{neo_obj.y}), width: {neo_obj.width}, height: {neo_obj.height}')
        if isinstance(neo_obj, list):
            return header + self._html_list(neo_obj)
        if neo_obj.__class__.__name__ == 'ObjectList':
            return header + self._html_objectlist(neo_obj)
        if isinstance(neo_obj, self.ImageSequence):
            return header + self._html_imagesequence(neo_obj)
        if isinstance(neo_obj, self.IrregularlySampledSignal):
            return header + self._html_irregularlysampledsignal(neo_obj)
        if isinstance(neo_obj, self.AnalogSignal):
            return header + self._html_analogsignal(neo_obj)
        if isinstance(neo_obj, self.SpikeTrain):
            return header + self._html_spiketrain(neo_obj)
        if isinstance(neo_obj, self.Epoch):
            return header + self._html_epoch(neo_obj)
        if isinstance(neo_obj, self.Event):
            return header + self._html_event(neo_obj)
        if isinstance(neo_obj, self.BaseNeo):
            return header + self._section(str(neo_obj))
        return header + self._section(f'Object of type {type(neo_obj)} could not be rendered.')

    def _html_container(self, neo_obj) -> str:
        parts = []
        container_info = ', '.join(
            f'{len(getattr(neo_obj, n))} {n}'
            for n in neo_obj._child_containers
            if getattr(neo_obj, n)
        )
        t_start = neo_obj.t_start if isinstance(neo_obj, self.Segment) else None
        t_stop = neo_obj.t_stop if isinstance(neo_obj, self.Segment) else None
        parts.append(self._section(
            self._kv('Type', neo_obj.__class__.__name__),
            self._kv('Contents', container_info) if container_info else '',
            self._kv('Name', neo_obj.name) if neo_obj.name else '',
            self._kv('t_start', t_start) if t_start is not None else '',
            self._kv('t_stop', t_stop) if t_stop is not None else '',
            self._kv('Duration', t_stop - t_start) if t_start is not None and t_stop is not None else '',
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
        ))
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))
        return ''.join(parts)

    def _html_spiketrainlist(self, neo_obj) -> str:
        if neo_obj._items is None:
            if neo_obj._spike_time_array is None:
                info = 'empty'
            else:
                info = f'{neo_obj._spike_time_array.size} spikes across {len(neo_obj._all_channel_ids)} neurons'
        else:
            info = f'{len(neo_obj._items)} SpikeTrains'
        parts = [self._section(self._kv('SpikeTrainList', info))]
        if neo_obj.description:
            parts.append(self._section(self._kv('Description', neo_obj.description)))
        return ''.join(parts)

    def _html_list(self, neo_obj) -> str:
        type_counter = self.Counter(type(ele).__name__ for ele in neo_obj)
        table = self._table_html([['Type', 'Count']] + [[t, c] for t, c in type_counter.items()])
        return self._section(self._h3('List Contents'), table)

    def _html_objectlist(self, neo_obj) -> str:
        if len(neo_obj) > 0:
            info = f'{len(neo_obj)} × {neo_obj[0].__class__.__name__}'
        else:
            info = 'empty'
        return self._section(self._kv('ObjectList', info))

    def _html_spiketrain(self, neo_obj) -> str:
        parts = [self._section(
            self._kv('Spikes', len(neo_obj)),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('t_start', neo_obj.t_start),
            self._kv('t_stop', neo_obj.t_stop),
            self._kv('Duration', neo_obj.t_stop - neo_obj.t_start),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        times = neo_obj.times
        table_data = [[f'Index ({len(neo_obj)} spikes)', f'Time ({neo_obj.units.dimensionality})']]

        aa = getattr(neo_obj, 'array_annotations', {})
        aa_keys = list(aa.keys())
        table_data[0] += aa_keys

        def make_row(i):
            row = [i, self._fmt(times[i].magnitude)]
            for k in aa_keys:
                v = aa[k]
                row.append(self._format_array_annotation_value(v[i]) if i < len(v) else '')
            return row

        if len(times) > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(table_data[0]))
            for i in range(len(times) - 10, len(times)): table_data.append(make_row(i))
        else:
            for i in range(len(times)): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Data'), self._table_html(table_data)))
        return ''.join(parts)

    def _html_analogsignal(self, neo_obj) -> str:
        parts = [self._section(
            self._kv('Shape', f'{neo_obj.shape[1]} channels × {neo_obj.shape[0]} samples'),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('Sampling Rate', neo_obj.sampling_rate),
            self._kv('t_start', neo_obj.t_start),
            self._kv('t_stop', neo_obj.t_stop),
            self._kv('Duration', neo_obj.duration.simplified),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        num_channels = neo_obj.shape[1]
        channel_indices = list(range(num_channels))
        note = ''
        if num_channels > 4:
            channel_indices = list(range(2)) + list(range(num_channels - 2, num_channels))
            note = f'<div class="dim">Showing first 2 and last 2 of {num_channels} channels</div>'
        elif num_channels > 1:
            note = f'<div class="dim">Showing all {num_channels} channels</div>'

        header = ['Index', f'Time ({neo_obj.times.units.dimensionality.string})'] + [f'Ch{i}' for i in channel_indices]
        table_data = [header]
        times = neo_obj.times

        def make_row(i):
            return [i, self._fmt(times[i].magnitude, 3)] + [self._fmt(neo_obj[i, ch].item(), 3) for ch in channel_indices]

        if len(times) > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(header))
            for i in range(len(times) - 10, len(times)): table_data.append(make_row(i))
        else:
            for i in range(len(times)): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Data'), note, self._table_html(table_data)))
        parts.append(self._html_array_annotations(neo_obj))
        return ''.join(parts)

    def _html_epoch(self, neo_obj) -> str:
        parts = [self._section(
            self._kv('Epochs', len(neo_obj)),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('t_start', neo_obj.times[0] if len(neo_obj) else '—'),
            self._kv('t_stop', neo_obj.times[-1] if len(neo_obj) else '—'),
            self._kv('Duration', neo_obj.times[-1] - neo_obj.times[0] if len(neo_obj) > 1 else '—'),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        times = neo_obj.times
        durations = neo_obj.durations
        labels = neo_obj.labels

        aa = getattr(neo_obj, 'array_annotations', {})
        aa_keys = list(aa.keys())

        header = ['Index', f'Time ({neo_obj.units.dimensionality.string})',
                  f'Duration ({neo_obj.units.dimensionality.string})', 'Label'] + aa_keys
        table_data = [header]

        def make_row(i):
            row = [i, self._fmt(times[i].magnitude), self._fmt(durations[i].magnitude), labels[i]]
            for k in aa_keys:
                v = aa[k]
                row.append(self._format_array_annotation_value(v[i]) if i < len(v) else '')
            return row

        num = len(times)
        if num > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(header))
            for i in range(num - 10, num): table_data.append(make_row(i))
        else:
            for i in range(num): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Data'), self._table_html(table_data)))
        return ''.join(parts)

    def _html_imagesequence(self, neo_obj) -> str:
        n_frames, height, width = neo_obj.shape
        parts = [self._section(
            self._kv('Shape', f'{n_frames} frames × {height} rows × {width} cols'),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('Sampling Rate', neo_obj.sampling_rate),
            self._kv('Spatial Scale', neo_obj.spatial_scale),
            self._kv('t_start', neo_obj.t_start),
            self._kv('t_stop', neo_obj.t_stop),
            self._kv('Duration', neo_obj.duration),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        times = neo_obj.times
        header = ['Frame', f'Time ({times.units.dimensionality.string})',
                  f'Mean ({neo_obj.units.dimensionality})']
        table_data = [header]

        def make_row(i):
            return [i, self._fmt(times[i].magnitude), self._fmt(self.np.mean(neo_obj[i].magnitude))]

        if n_frames > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(header))
            for i in range(n_frames - 10, n_frames): table_data.append(make_row(i))
        else:
            for i in range(n_frames): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Frames'), self._table_html(table_data)))
        return ''.join(parts)

    def _html_irregularlysampledsignal(self, neo_obj) -> str:
        n_samples, n_channels = neo_obj.shape
        channel_indices = list(range(n_channels))
        note = ''
        if n_channels > 4:
            channel_indices = list(range(2)) + list(range(n_channels - 2, n_channels))
            note = f'<div class="dim">Showing first 2 and last 2 of {n_channels} channels</div>'
        elif n_channels > 1:
            note = f'<div class="dim">Showing all {n_channels} channels</div>'

        parts = [self._section(
            self._kv('Shape', f'{n_channels} channels × {n_samples} samples'),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('t_start', neo_obj.t_start),
            self._kv('t_stop', neo_obj.t_stop),
            self._kv('Duration', neo_obj.duration),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        times = neo_obj.times
        header = ['Index', f'Time ({times.units.dimensionality.string})'] + [f'Ch{i}' for i in channel_indices]
        table_data = [header]

        def make_row(i):
            return [i, self._fmt(times[i].magnitude)] + [self._fmt(neo_obj[i, ch].item()) for ch in channel_indices]

        if n_samples > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(header))
            for i in range(n_samples - 10, n_samples): table_data.append(make_row(i))
        else:
            for i in range(n_samples): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Data'), note, self._table_html(table_data)))
        parts.append(self._html_array_annotations(neo_obj))
        return ''.join(parts)

    def _html_event(self, neo_obj) -> str:
        parts = [self._section(
            self._kv('Events', len(neo_obj)),
            self._kv('Units', str(neo_obj.units.dimensionality)),
            self._kv('dtype', str(neo_obj.dtype)),
            self._kv('t_start', neo_obj.times[0] if len(neo_obj) else '—'),
            self._kv('t_stop', neo_obj.times[-1] if len(neo_obj) else '—'),
            self._kv('Duration', neo_obj.times[-1] - neo_obj.times[0] if len(neo_obj) > 1 else '—'),
            self._kv('Description', neo_obj.description) if neo_obj.description else '',
            self._kv('File Origin', neo_obj.file_origin) if getattr(neo_obj, 'file_origin', None) else '',
        )]
        if neo_obj.annotations:
            parts.append(self._html_annotations(neo_obj.annotations))

        times = neo_obj.times
        labels = neo_obj.labels

        aa = getattr(neo_obj, 'array_annotations', {})
        aa_keys = list(aa.keys())

        header = ['Index', f'Time ({neo_obj.units.dimensionality.string})', 'Label'] + aa_keys
        table_data = [header]

        def make_row(i):
            row = [i, self._fmt(times[i].magnitude), labels[i]]
            for k in aa_keys:
                v = aa[k]
                row.append(self._format_array_annotation_value(v[i]) if i < len(v) else '')
            return row

        num = len(times)
        if num > 20:
            for i in range(10): table_data.append(make_row(i))
            table_data.append(['...'] * len(header))
            for i in range(num - 10, num): table_data.append(make_row(i))
        else:
            for i in range(num): table_data.append(make_row(i))

        parts.append(self._section(self._h3('Data'), self._table_html(table_data)))
        return ''.join(parts)