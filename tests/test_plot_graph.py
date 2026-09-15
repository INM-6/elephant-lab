import pytest
import numpy as np
import quantities as pq
import neo
from elephant_lab.PlotlyGraphContainer import *
from elephant_lab.PlotlyGraphDatas import *
from elephant_lab.PlotlyImageSequenceContainer import *
from elephant_lab.PlotlyImageSequenceDatas import *
from elephant_lab.utils import OutputUtils


def test_plotly_graph_data_extracts_supported_inputs_and_applies_fallbacks():
	trace = PlotlyGraphData({'x': [1, 2], 'y': [3, 4]}, name_fallback='fallback')
	assert trace.x == [1, 2]
	assert trace.y == [3, 4]
	assert trace.name == 'fallback'

	points = PlotlyGraphData([(1, 2), (3, 4)], name_fallback=lambda _: 'points')
	assert points.x == [1, 3]
	assert points.y == [2, 4]
	assert points.name == 'points'

	empty = PlotlyGraphData(None)
	assert empty.x == []
	assert empty.y == []
	assert empty.name == 'nothing'
	assert empty.mode == 'markers'


def test_plotly_graph_data_copies_metadata_and_truncates_long_names():
	source = type('Trace', (), {
		'x': np.array([0, 1]),
		'y': np.array([2, 3]),
		'name': 'long-prefix-channel-name',
		'mode': 'lines',
		'marker': {'size': 3},
		'line': {'width': 2},
		'units_x': pq.s,
		'units_y': pq.mV,
	})()

	trace = PlotlyGraphData(source, use_name_as_ticklabels=True)
	assert trace.name == 'long-p...name'
	assert trace.mode == 'lines'
	assert trace.marker == {'size': 3}
	assert trace.line == {'width': 2}
	assert trace.units_x == pq.s
	assert trace.units_y == pq.mV
	assert trace.use_name_as_ticklabels is True


def test_plotly_graph_data_list_distinguishes_points_from_traces_and_concats():
	points = PlotlyGraphDataList([(0, 1), (1, 2)])
	assert len(points.datas) == 1
	assert points.datas[0].x == [0, 1]

	traces = PlotlyGraphDataList([
		{'x': [0, 1], 'y': [1, 2], 'name': 'a'},
		{'x': [0, 1], 'y': [2, 3], 'name': 'b'},
	])
	assert [trace.name for trace in traces.datas] == ['a', 'b']

	traces.concat(PlotlyGraphDataList({'x': [0], 'y': [4], 'name': 'c'}))
	assert [trace.name for trace in traces.datas] == ['a', 'b', 'c']


def test_plotly_graph_data_normalizes_and_unnormalizes_values():
	trace = PlotlyGraphData({'x': [1, 2], 'y': [2, 4]})
	trace.shift_x_to_0 = -1
	trace.unit_x_conversion_factor = 1000
	trace.unit_y_conversion_factor = 2

	x_values = trace.normalize_x(np.array([1.0, 2.0]))
	y_values = trace.normalize_y(np.array([2.0, 4.0]))

	assert np.array_equal(x_values, [0, 1000])
	assert np.array_equal(y_values, [4, 8])
	assert np.array_equal(trace.un_normalize_x(x_values), [1, 2])


def test_plotly_graph_data_bundle_normalizes_units_ranges_and_complex_values():
	signal = PlotlyGraphData({'x': [2, 1, 3], 'y': [1, 2, 3], 'name': 'signal'})
	signal.units_x = pq.ms
	signal.units_y = pq.mV
	complex_trace = PlotlyGraphData({'x': [1, 2, 3], 'y': [1 + 2j, 2 + 4j, 3 + 6j], 'name': 'complex'})
	complex_trace.units_x = pq.ms
	complex_trace.units_y = pq.mV
	traces = PlotlyGraphDataList([signal, complex_trace])
	bundle = PlotlyGraphDataBundle(traces)
	bundle.normalize(False, True, True, 'minmax')

	assert bundle.nGraphs == 3
	assert bundle.common_units_x == pq.ms
	assert bundle.common_units_y == pq.mV
	assert bundle.minX == 0
	assert bundle.maxX == 2
	assert bundle.is_default_zero_based is False
	assert [trace.name for trace in bundle.datas] == ['signal', 'complex (real)', 'complex (imag)']
	assert np.all(np.diff(bundle.datas[0].x) >= 0)
	assert np.allclose(bundle.datas[1].y, [1, 2, 3])
	assert np.allclose(bundle.datas[2].y, [2, 4, 6])


def test_plotly_graph_data_bundle_normalizes_annotations_and_serializes_data():
	trace = PlotlyGraphData({'x': [0, 1, 2], 'y': [1, 2, 3], 'name': 'trace'})
	annotation = PlotlyGraphAnnotation(
		np.array([1, 1, 2]),
		np.array(['first', 'second', 'third']),
		pq.s,
		np.array([0, 0, 1]),
	)
	bundle = PlotlyGraphDataBundle(PlotlyGraphDataList(trace), [annotation])
	bundle.normalize(False, False, False, 'minmax')

	annotations = bundle.get_normalized_annotations(None)
	assert annotations['xs'].tolist() == [1, 2]
	assert annotations['durations'].tolist() == [0, 1]
	assert annotations['texts'].tolist() == ['first<br>second', 'third']

	result = bundle.get_normalized_data_for_x_range([0, 1.5], max_points=10)
	assert result['x_y_values_list_changed'] is True
	assert result['annotation_list_changed'] is True
	serialized = bundle.to_dict()
	assert serialized['plotly_graph_data_list'][0]['temp'] == {
		'x': [0, 1, 2],
		'y': [1, 2, 3],
	}


def test_neo_graph_adapters_extract_expected_data():
	spike_train = neo.SpikeTrain([1, 2, 3] * pq.s, t_stop=4 * pq.s, name='spikes')
	raster = SpikeTrainRasterPlot(spike_train)
	assert raster.name == 'spikes'
	assert raster.mode == 'markers'
	assert raster.use_name_as_ticklabels is True
	assert np.array_equal(raster.x, [1, 2, 3])
	assert np.array_equal(raster.y, [0, 0, 0])
	assert raster.units_x == pq.s

	signal = neo.AnalogSignal(
		np.array([[1, 2], [3, 4], [5, 6]]) * pq.mV,
		sampling_rate=1 * pq.Hz,
		name='lfp',
	)
	lfp = AnalogSignalLFPPlotList([signal], name_fallback=lambda _: 'fallback')
	assert [trace.name for trace in lfp.datas] == ['lfp-ch0', 'lfp-ch1']
	assert all(trace.mode == 'lines' for trace in lfp.datas)
	assert np.array_equal(lfp.datas[1].y, [2, 4, 6])

	irregular = neo.IrregularlySampledSignal(
		signal=[10, 20, 30] * pq.mV,
		times=[0, 2, 5] * pq.s,
		name='irregular',
	)
	irregular_plot = IrregularlySampledSignalPlotList([irregular])
	assert irregular_plot.datas[0].mode == 'markers+lines'
	assert np.array_equal(irregular_plot.datas[0].x, [0, 2, 5])


def test_neo_annotations_extract_times_labels_and_durations():
	event = neo.Event(times=[1, 2] * pq.s, labels=['a', 'b'])
	event_annotation = EventAnnotation(event)
	assert np.array_equal(event_annotation.xs, [1, 2])
	assert event_annotation.texts.tolist() == ['a', 'b']
	assert event_annotation.unit == pq.s

	epoch = neo.Epoch(
		times=[1, 3] * pq.s,
		durations=[0.5, 1] * pq.s,
		labels=['first', 'second'],
	)
	epoch_annotation = EpochAnnotation(epoch)
	assert np.array_equal(epoch_annotation.xs, [1, 3])
	assert np.array_equal(epoch_annotation.durations, [0.5, 1])

