import numpy as np
import quantities as pq
from types import SimpleNamespace

from elephant_lab.PlotlyImageSequenceContainer import PlotlyImageSequenceDataList
from elephant_lab.PlotlyImageSequenceDatas import ImageSequencePlot


def make_image_sequence(values, name='images', spatial_scale=None):
	images = np.asarray(values) * pq.mV
	if images.ndim == 2:
		images = images[:, None, :]
	return SimpleNamespace(
		shape=images.shape,
		name=name,
		t_start=0 * pq.s,
		t_stop=images.shape[0] / 2 * pq.s,
		units=pq.mV,
		magnitude=images.magnitude,
		spatial_scale=spatial_scale,
	)


def test_image_sequence_plot_extracts_metadata_and_images():
	image_sequence = make_image_sequence([[1, 2], [3, 4]], spatial_scale=5 * pq.um)
	image_plot = ImageSequencePlot(image_sequence)

	assert image_plot.n_frames == 2
	assert image_plot.name == 'images'
	assert image_plot.duration_ms == 1000
	assert image_plot.units == pq.mV
	assert image_plot.spacial_units == 5 * pq.um
	assert np.array_equal(image_plot.images, image_sequence.magnitude)


def test_image_sequence_list_normalizes_complex_and_infinite_values():
	first = ImageSequencePlot(make_image_sequence([[1, 2], [3, 4]]))
	first.images = np.array([[[1 + 2j, np.inf], [np.nan, 4 - 3j]]])
	second = ImageSequencePlot(make_image_sequence([[0, 0], [0, 0]], name='zeros'))
	second.images = np.full((1, 2, 2), np.inf)

	data_list = PlotlyImageSequenceDataList([first, second])
	data_list.normalize()

	assert np.allclose(first.images[0, 0, 0], np.sqrt(5))
	assert np.isnan(first.images[0, 0, 1])
	assert '|' in first.units_str
	assert first.zmin == np.sqrt(5)
	assert first.zmax == 5
	assert second.zmin == 0
	assert second.zmax == 1


def test_image_sequence_list_accepts_single_values_and_serializes_normalized_data():
	image_plot = ImageSequencePlot(make_image_sequence([[1, 2], [3, 4]], spatial_scale=2 * pq.um))
	data_list = PlotlyImageSequenceDataList(image_plot)
	data_list.normalize()

	serialized = data_list.to_dict()
	assert len(serialized['plotly_imagesequence_data_list']) == 1
	result = serialized['plotly_imagesequence_data_list'][0]
	assert result['name'] == 'images'
	assert result['n_frames'] == 2
	assert result['images'] == image_plot.images.tolist()
	assert result['zmin'] == 1
	assert result['zmax'] == 4
	assert result['spacial_units'].startswith('2.0 um X 2.0 um')


def test_image_sequence_list_handles_none_and_callable_name_fallback():
	assert PlotlyImageSequenceDataList(None).datas == []

	image_sequence = make_image_sequence([[1, 2]], name=None)
	image_plot = ImageSequencePlot(image_sequence, name_fallback=lambda _: 'generated')
	assert image_plot.name == 'generated'
