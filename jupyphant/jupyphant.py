# XXX: In general this is bad practice but might be useful for this exact usecase
import __main__
import time
class JupyphantVisualization:
    import json
    from IPython.core.magics.namespace import NamespaceMagics
    from IPython import get_ipython
    from IPython.display import display
    # Need to import those actually, need to find out how to do so
    # Probably with also import sys and append path, so should be fine usually
    from neo.core.baseneo import BaseNeo
    from neo import Block, SpikeTrain, AnalogSignal
    from neo.test.tools import assert_same_sub_schema
    assert_same_sub_schema = staticmethod(assert_same_sub_schema)
    import numpy as np
    import quantities as pq
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from viziphant.rasterplot import rasterplot
    rasterplot = staticmethod(rasterplot)
    import matplotlib.pyplot as plt
    from ipywidgets import Output
    from ipytree import Tree, Node
    def __init__(self):
        self.blocks = []
        self.other_objs = []
        self.plot = None
        self.out = self.Output()
        self.fig = None
        self.tree = None

    def update(self):
        vals = self.nsm.who_ls()
        values = {}
        for v in vals:
            # Access objects created within the notebook
            # XXX Importing __main__ is in general considered bad practice
            # However here the explicit goal is to have access to
            # the surrounding namespace and working with it, thus making this necessary
            # TODO: It could be possible to just create the class in the same namespace
            # I.e. no imports, by running this code directly inside the notebook
            # This requires to have this whole file as a string in the TypeScript code
            obj = __main__.__dict__[v]
            if isinstance(obj, (self.BaseNeo, list)):
                values[v] = obj
        self.blocks = [v for v in values.values() if isinstance(v, self.Block)]
        self.other_objs = [v for v in values.values() if isinstance(v, self.BaseNeo) and not isinstance(v, self.Block)]

    def update_tree(self):
        start = time.time()
        self.update()
        print("After update", time.time() - start)
        print("Here")
        if self.tree is not None or True:
            print("HERE2")
            nodes = [self.Node(bl.name) for bl in self.blocks]
            print("Toplevel", time.time() - start)
            print(nodes)
            # self.tree.nodes = nodes
            for i, node in enumerate(nodes):
                node.opened = False
                segs_node = self.Node("Segments")
                segs_node.opened = False
                node.add_node(segs_node)

                for seg in self.blocks[i].segments:
                    curr_seg = self.Node(str(seg.name))
                    segs_node.add_node(curr_seg)
                    curr_seg.opened = False
                    self._add_sub_nodes(curr_seg, seg, 'analogsignals', "AnalogSignals")
                    print("After anasig", time.time() - start)
                    self._add_sub_nodes(curr_seg, seg, 'spiketrains', "SpikeTrains")
                    print("After sptr", time.time() - start)

                chidxs = self.Node("ChannelIndexes")
                node.add_node(chidxs)
                for chidx in self.blocks[i].channel_indexes:
                    chidx_node = self.Node(str(chidx.name))
                    chidxs.add_node(chidx_node)
                    self._add_sub_nodes(chidx_node, chidx, 'units')
                    for unit_node, unit in zip(chidx_node.nodes, chidx.units):
                        self._add_sub_nodes(unit_node, unit, 'spiketrains')
                    self._add_sub_nodes(chidx_node, chidx, 'analogsignals')
                    self._add_sub_nodes(chidx_node, chidx, 'irregularlysampledsignals')
            nodes.extend([self.Node(str(obj.name)) for obj in self.other_objs])
            # print(nodes)
            print("Calculation finished", time.time() - start)
            import sys
            sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.tree.nodes = nodes
            print("Rendered", time.time() - start)
        else:
            # Update the tree incrementally, do NOT do the whole neo block at once
            pass

    def _add_sub_nodes(self, parent, obj, attr, name=None):
        attr_list = getattr(obj, attr.lower(), None)
        if attr_list:
            parent.opened = False
            if name is not None:
                attrs_node = self.Node(name)
                attrs_node.opened = False
                parent.add_node(attrs_node)
            else:
                attrs_node = parent
            for obj in attr_list:
                attrs_node.add_node(self.Node(str(obj.name)))

    def create_tree(self):
        self.tree = None
        self.tree = self.Tree(stripes=True)
        return self.tree

    def plot_sptr(self):
        old_blocks = self.blocks[:]
        old_objs = self.other_objs[:]
        self.update()
        # Static variable is preserved when running again
        # If already plotted
        # TODO: Check block content as well, this might change!!!
        curr_blocks = self.blocks
        changes = len(curr_blocks) != len(old_blocks)
        curr_objs = self.other_objs
        if len(curr_objs) != len(old_objs):
            changes = True
        if not changes:
            try:
                [self.assert_same_sub_schema(old_blocks[i], curr_blocks[i]) for i in range(len(old_blocks))]
                [self.assert_same_sub_schema(old_objs[i], curr_objs[i]) for i in range(len(old_objs))]
            # TODO: Make more precise in neo
            except BaseException as e:
                changes = True
        if (not changes) and (self.plot is not None) and False:
            pass
            # TODO: Get plot to be displayed again
            return self.plot
            # return self.fig
        else:
            spiketrains = []
            for bl in curr_blocks:
                spiketrains.append(bl.list_children_by_class(self.SpikeTrain))
            spiketrains.append([obj for obj in curr_objs if isinstance(obj, self.SpikeTrain)])
            #             for row in spiketrains:
            #                 for i, sptr in enumerate(row):
            #                     row[i] = sptr.time_slice(0, 50)
            if spiketrains:
                from matplotlib import rcParams
                size = rcParams['figure.figsize']
                # figure size in inches
                rcParams['figure.figsize'] = 11.7, 8.7
                rcParams['figure.figsize'] = 5.85, 4.35
                try:
                    ax = self.plot[0]
                except TypeError:
                    ax = None
                self.plot = self.rasterplot(spiketrains, context='paper',
                                            markerargs={'animated': True, 'markersize': .1, 'marker': '.'})  # , ax=ax)
                rcParams['figure.figsize'] = size
                # self.fig = self.plt.figure()
        # self.plt.show()
        # return self.fig
        return self.plot

    def plot_lfp(self, lfps, times, title=None, spacing=5, color=None):
        '''
        Plot LFPs.

        lfps: LFP signals with trial_id as first dimension and sample_id as second dimension.
              LFP signals must be arranged according to trial ID.
        times: time stamps of the recorded LFP samples. Must be of same length as second dimenion of lfps
        title: title of the figure
        spacing: vertical spacing between two LFP signals
        color: color to used for plotting
        '''

        # Plots lfp signals for each trial
        for trial_id, lfp in enumerate(lfps):
            self.plt.plot(times, lfp.magnitude / 1000 + trial_id * spacing, color=color)
            xmin, xmax = times[[0, -1]]  # use first and last time stamp for xlim values

        # Defines plot parameters for x-axis
        self.plt.xlabel('t ({0})'.format(times.dimensionality), size=16)

        # Defines plot parameters for y-axis
        self.plt.ylabel('trials', size=16)
        ymin, ymax = 0, len(lfps) * spacing
        self.plt.ylim(ymin - spacing, ymax + spacing)
        yticks = self.np.arange(ymin, ymax + 1, spacing * 10)
        yticklabels = [str(i) for i in self.np.arange(0, len(lfps) + 1, 10, dtype=int)]
        self.plt.yticks(yticks, yticklabels)

        # Adjusts axis
        self.plt.axis('tight')

        # Adds the title to the figure
        self.plt.suptitle(title, size=18)

    def plot_anasig(self):
        anasigs = []
        for bl in self.blocks:
            anasigs.extend(bl.list_children_by_class(self.AnalogSignal))
        anasigs.extend([obj for obj in self.other_objs if isinstance(obj, self.AnalogSignal)])
        self.anasig_plot = None
        self.plot_lfp(anasigs[:20], times=self.np.arange(len(anasigs[0])) * self.pq.s, spacing=50)
        return self.anasig_plot

    def testfunc(self):
        vals = nsm.who_ls()
        values = [v for v in vals if
                  isinstance(eval(v), (self.BaseNeo, list))]  # in ['Block', 'Segment', 'ChannelIndex',
        for value in list(values):
            val = eval(value)
            if isinstance(val, list):
                if len(val) > 0 and isinstance(val[0], self.BaseNeo):
                    pass
                else:
                    values.remove(value)
            if isinstance(val, self.Block):
                for i, seg in enumerate(val.list_children_by_class("Segment")):
                    # globals()[''.join(['blchidx', str(i)])] = chidx
                    values.append(''.join([value, '.segmets[', str(i), ']']))
                    for j, sig in enumerate(seg.analogsignals):
                        # pass
                        values.append(''.join([values[-1 - j], '.analogsigs[', str(j), ']']))

        return json.dumps(values)
