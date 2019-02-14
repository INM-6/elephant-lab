let setup_env = 
`class JupyphantVisualization:
    import json
    from IPython.core.magics.namespace import NamespaceMagics
    from IPython import get_ipython
    from IPython.display import display
    # Need to import those actually, need to find out how to do so
    # Probably with also import sys and append path, so should be fine usually
    from neo.core.baseneo import BaseNeo
    from neo import Block, SpikeTrain
		from neo.test.tools import assert_same_sub_schema
		assert_same_sub_schema = staticmethod(assert_same_sub_schema)
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
		from viziphant.viziphant.rasterplot import rasterplot
		rasterplot = staticmethod(rasterplot)
    def __init__(self):
        self.blocks = []
        self.other_objs = []
        
    def update(self):
        vals = self.nsm.who_ls()
        values = {v: eval(v) for v in vals if isinstance(eval(v), (self.BaseNeo, list))} # in ['Block', 'Segment', 'ChannelIndex', 
        self.blocks = [v for v in values.values() if isinstance(v, self.Block)]
        self.other_objs = [v for v in values.values() if isinstance(v, self.BaseNeo) and not isinstance(v, self.Block)]

    def plot_sptr(self):
        old_blocks = self.blocks[:]
        old_objs = self.other_objs[:]
        self.update()
        # Static variable is preserved when running again
        self.plot = None
        # If already plotted
        # TODO: Check block content as well, this might change!!!
        curr_blocks = self.blocks
        old_len = len(old_blocks)
        curr_len = len(curr_blocks)
        changes = [self.assert_same_sub_schema(old_blocks[i], curr_blocks[i]) for i in range(old_len)] if old_len == curr_len else [False]
        curr_objs = self.other_objs
        old_len = len(old_objs)
        curr_len = len(curr_objs)
        changes_objs = [self.assert_same_sub_schema(old_objs[i], curr_objs[i]) for i in range(old_len)] if old_len == curr_len else [False]
        if all(changes) and all(changes_objs)\
            and self.plot is not None:
            return self.plot
        else:
            spiketrains = []
            for bl in curr_blocks:
                spiketrains.extend(bl.list_children_by_class(self.SpikeTrain))
            spiketrains.extend([obj for obj in curr_objs if isinstance(obj, self.SpikeTrain)])
            if spiketrains:
                self.plot = self.rasterplot(spiketrains)  
        return self.plot


    def testfunc(self):
        vals = nsm.who_ls()
        values = [v for v in vals if isinstance(eval(v), (self.BaseNeo, list))] # in ['Block', 'Segment', 'ChannelIndex', 
        for value in list(values):
            val = eval(value)
            if isinstance(val, list):
                if len(val) > 0 and isinstance(val[0], self.BaseNeo):
                        pass
                else:
                    values.remove(value)
            if isinstance(val, self.Block):
                for i, seg in enumerate(val.list_children_by_class("Segment")):
                    #globals()[''.join(['blchidx', str(i)])] = chidx
                    values.append(''.join([value, '.segmets[', str(i), ']']))
                    for j, sig in enumerate(seg.analogsignals):
                        #pass
                        values.append(''.join([values[-1-j], '.analogsigs[', str(j), ']']))

        return json.dumps(values)

my_jupyphant_vis_xxx = JupyphantVisualization()
`;

let neo_plot =
`import matplotlib.pyplot as plt
plt.plot(range(len(ew_block.segments[0].analogsignals[0])), ew_block.segments[0].analogsignals[0])
plt.show();
`;

let plot_code = 
`import matplotlib.pyplot as plt
plt.plot([1,2,3], [4,5,6])
plt.show()
`;

let raster_plot =
`import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    my_jupyphant_vis_xxx.plot_sptr();
`;

export const pythonCode = {
	'neoPlot': neo_plot,
	'plotCode': plot_code,
	'setupEnv': setup_env,
	'rasterPlot': raster_plot
};
