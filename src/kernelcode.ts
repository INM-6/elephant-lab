let setup_env = 
`import json
from IPython.core.magics.namespace import NamespaceMagics
from IPython import get_ipython
from neo.core import BaseNeo, Block
nsm = NamespaceMagics()
nsm.shell = get_ipython().kernel.shell
from types import SimpleNamespace
jupyphant_visualization_namespace = SimpleNamespace()
jupyphant_visualization_namespace.blocks = []
jupyphant_visualization_namespace.other_objs = []
def jupyphant_visualization_update():
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from neo.core.baseneo import BaseNeo
    from neo.core.block import Block
    vals = nsm.who_ls()
    values = {v: eval(v) for v in vals if isinstance(eval(v), (BaseNeo, list))} # in ['Block', 'Segment', 'ChannelIndex', 
    jupyphant_visualization_namespace.blocks = [v for v in values.values() if isinstance(v, Block)]
    jupyphant_visualization_namespace.other_objs = [v for v in values.values() if isinstance(v, BaseNeo) and not isinstance(v, Block)]
    
def jupyphant_visualization_plot_sptr():
    old_blocks = jupyphant_visualization_namespace.blocks[:]
    old_objs = jupyphant_visualization_namespace.other_objs[:]
    jupyphant_visualization_update()
    # Static variable is preserved when running again
    jupyphant_visualization_plot_sptr.plot = None
    # If already plotted
    if jupyphant_visualization_namespace.blocks == old_blocks and\
    jupyphant_visualization_namespace.other_objs == old_objs\
        and jupyphant_visualization_plot_sptr.plot is not None:
            return jupyphant_visualization_plot_sptr.plot
    else:
        spiketrains = [bl.list_children_by_class(SpikeTrain) for bl in jupyphant_visualization_namespace.blocks]
        spiketrains.extend([obj for obj in jupyphant_visualization_namespace.other_objs if isinstance(obj, SpikeTrain)])
        jupyphant_visualization_plot_sptr.plot = rasterplot(spiketrains)
    return jupyphant_visualization_plot_sptr.plot

def testfunc():
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from neo.core.baseneo import BaseNeo
    from neo.core.block import Block
    vals = nsm.who_ls()
    values = [v for v in vals if isinstance(eval(v), (BaseNeo, list))] # in ['Block', 'Segment', 'ChannelIndex', 
    for value in list(values):
        val = eval(value)
        if isinstance(val, list):
            if len(val) > 0 and isinstance(val[0], BaseNeo):
                    pass
            else:
                values.remove(value)
        if isinstance(val, Block):
            for i, seg in enumerate(val.list_children_by_class("Segment")):
                #globals()[''.join(['blchidx', str(i)])] = chidx
                values.append(''.join([value, '.segmets[', str(i), ']']))
                for j, sig in enumerate(seg.analogsignals):
                    #pass
                    values.append(''.join([values[-1-j], '.analogsigs[', str(j), ']']))

    return json.dumps(values)`;

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
`jupyphant_visualization_plot_sptr()
`;

export const pythonCode = {
	'neoPlot': neo_plot,
	'plotCode': plot_code,
	'setupEnv': setup_env,
	'rasterPlot': raster_plot
};
