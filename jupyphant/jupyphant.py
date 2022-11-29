# XXX: In general this is bad practice but might be useful for this exact usecase
# Importing main namespace in order to be able to access objects created in
# JupyterLab Python kernel
import __main__
import time
class JupyphantVisualization:
    # All imports are hidden inside the class in order not to pollute the 
    # Python kernel's namespace used by the user of the notebook
    import json
    # Dealing with the Python kernel's namespace, e.g., 
    # listing all defined variables
    from IPython.core.magics.namespace import NamespaceMagics
    # Access to the Python kernel
    from IPython import get_ipython
    # nsm object provides access to the actual kernel's variables
    # And is used to query and manipulate them
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    # For displaying widgets
    from IPython.display import display
    # Neo classes need to be imported to work with them
    # Depending on the usage situation, import using 
    # sys.path.append might be necessary
    from neo.core.baseneo import BaseNeo
    from neo import Block, SpikeTrain, AnalogSignal
    from neo.test.tools import assert_same_sub_schema
    assert_same_sub_schema = staticmethod(assert_same_sub_schema)
    import numpy as np
    import quantities as pq
    # TODO: Use new viziphant for plotting
    # This relies on the initial version of viziphant
    from viziphant.rasterplot import rasterplot
    rasterplot = staticmethod(rasterplot)
    import matplotlib.pyplot as plt
    # Widgets used for display
    from ipywidgets import Output
    # ipytree provides a tree structure widget
    # Used to display the Neo object hierarchy
    from ipytree import Tree, Node

    def __init__(self):
        """ 
        Constructor of JupyphantVisualization
        Called upon activation of the extension.
        Initializes some persistent variables that store references to the current neo objects
        and plots.
        They are used to check for changes in neo objects and to display the current structure.
        """
        self.blocks = []
        self.other_objs = []
        # Plots are saved in order not to require recreation at every cell execution
        self.plot = None
        self.out = self.Output()
        self.fig = None
        self.tree = None
        self.map = {}

    def update(self):
        """
        Updates the neo persistent neo structure to represent the current neo structure
        created by the notebook user.
        Called before updating plots, thus, usually at every cell execution.
        """
        # Get ALL variables in current kernel namespace
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
            
            # Objects are accessed using their name returned by who_ls() and the dict
            obj = __main__.__dict__[v]
            # Select only Neo objects and lists
            if isinstance(obj, (self.BaseNeo, list)):
                values[v] = obj
        # Get only blocks
        self.blocks = [v for v in values.values() if isinstance(v, self.Block)]
        # Get all other objects, i.e., neo objects with references independent of a Block
        self.other_objs = [v for v in values.values() if isinstance(v, self.BaseNeo) and not isinstance(v, self.Block)]
        # TODO: how to treat lists of neo objects or mixed lists?
        # neo_objs_in_list = [v for v in values.values() if isinstance(v, list) and any(isinstance(v[i], self.BaseNeo) for i in range(len(v)))]
        # neo_objs_in_list = [ele for l in neo_objs_in_list for ele in l if isinstance(ele, self.BaseNeo) and not isinstance(ele, self.Block)]
        # self.other_objs.extend(neo_objs_in_list)

    def update_tree(self):
        """
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = time.time()
        # Update all neo objects
        self.update()
        print("After update", time.time() - start)
        print("Here")
        # Currently the tree is created from scratch every time
        # TODO: Reuse the existing tree if there is one
        if self.tree is not None or True:
            print("HERE2")
            # Create one tree node per neo block
            # Name of node is name of block
            nodes = []
            for bl in self.blocks:
                bl_node = self.Node(bl.name)
                nodes.append(bl_node)
                self.map[bl_node._id] = bl._id
            print("Toplevel", time.time() - start)
            print(nodes)
            # self.tree.nodes = nodes
            # Create sub-nodes
            for i, node in enumerate(nodes):
                # Tree is collapsed in the beginning
                node.opened = False
                segs_node = self.Node("Segments")
                self.map[segs_node._id] = None
                segs_node.opened = False
                node.add_node(segs_node)
                # One node for each segment in the i-th block
                for seg in self.blocks[i].segments:
                    # Name of node is name of segment
                    curr_seg = self.Node(str(seg.name))
                    self.map[curr_seg._id] = seg._id
                    segs_node.add_node(curr_seg)
                    curr_seg.opened = False
                    # Sub-nodes for AnalogSignals, SpikeTrains and Events of the corresponding segment
                    self._add_sub_nodes(curr_seg, seg, 'analogsignals', "AnalogSignals")
                    print("After anasig", time.time() - start)
                    self._add_sub_nodes(curr_seg, seg, 'spiketrains', "SpikeTrains")
                    print("After sptr", time.time() - start)
                    self._add_sub_nodes(curr_seg, seg, 'events', "Events")
                    print("After evts", time.time() - start)

                # One Node for each group in the i-th block
                for j, grp in enumerate(self.blocks[i].groups):
                    # Name of node is name of group
                    curr_grp = self.Node(f"Group {j}")
                    self.map[curr_grp._id] = grp._id
                    segs_node.add_node(curr_grp)
                    curr_grp.opened = False
                    # Sub-nodes for AnalogSignals, SpikeTrains and Events of the corresponding segment
                    self._add_sub_nodes(curr_grp, grp, 'analogsignals', "AnalogSignals")
                    print("After anasig", time.time() - start)
                    self._add_sub_nodes(curr_grp, grp, 'spiketrains', "SpikeTrains")
                    print("After sptr", time.time() - start)
                    self._add_sub_nodes(curr_grp, grp, 'events', "Events")
                    print("After evts", time.time() - start)

            # Top-level node for every independent neo object
            nodes.extend([self.Node(str(obj.name)) for obj in self.other_objs])
            # print(nodes)
            print("Calculation finished", time.time() - start)
            import sys
            sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.tree.nodes = nodes
            print("Rendered", time.time() - start)
        else:
            pass

    def _add_sub_nodes(self, parent, obj, attr, name=None):
        """
        Adding child objects of a neo container as sub nodes of the tree node 
        that corresponds to the container

        Parameters
        ----------
        parent : Node
            Parent node of ipytree
        obj : Neo container
            Parent container object
        attr : str
            Type of the child objects (e. g., 'AnalogSignal')
        name : str
            Optional name of an in-between node (e. g. 'AnalogSignal' in order
            to create a node between 'parent' and the child object nodes)
        """
        # get obj.<attr>, for neo containers this is a list of the child objects
        attr_list = getattr(obj, attr.lower(), None)
        if attr_list:
            parent.opened = False
            # Add node with name as an in between
            # With all childs as sub nodes
            if name is not None:
                # Single node with the passed name
                attrs_node = self.Node(name)
                self.map[attrs_node._id] = None
                attrs_node.opened = False
                parent.add_node(attrs_node)
            # No in between node, parent object as parent node for sub nodes
            else:
                attrs_node = parent
            # Add the sub nodes
            for obj in attr_list:
                if attr.lower() == "analogsignals" or attr.lower() == "spiketrains":
                    # Add annotations for AnalogSignals/SpikeTrains
                    annot_node = self.Node("annotations")
                    self.map[annot_node._id] = None
                    annot_node.opened = False
                    for key, value in obj.annotations.items():
                        sub_annot_node = self.Node(f"{key}: {value}")
                        self.map[sub_annot_node._id] = None
                        annot_node.add_node(sub_annot_node)
                    anasig_node = self.Node(str(obj.name))
                    self.map[anasig_node._id] = obj._id
                    anasig_node.opened = False
                    anasig_node.add_node(annot_node)
                    attrs_node.add_node(anasig_node)
                else:
                    attrs_node.add_node(self.Node(str(obj.name)))

    def create_tree(self):
        """
        Initialize the tree

        """
        self.tree = None
        # Alternating dark and light stripes for better better visibility
        self.tree = self.Tree(stripes=True, multiple_selection=True)
        # self.tree.observe(self.on_selected_change(), names='selected_nodes')
        return self.tree

    def plot_sptr(self, selected_ids=None):
        """
        Rasterplot for spike trains

        Called at every cell execution
        """
        # Keep references to the existing tree
        # In order to update plot only after an actual change
        old_blocks = self.blocks[:]
        old_objs = self.other_objs[:]
        # Query for changed objects
        self.update()
        # Static variable is preserved when running again
        # If already plotted
        # TODO: Check block content as well, this might change!!!
        # New blocks
        curr_blocks = self.blocks
        # Check for differences in number of blocks
        changes = len(curr_blocks) != len(old_blocks)
        # Difference in number of other objects
        curr_objs = self.other_objs
        if len(curr_objs) != len(old_objs):
            changes = True
        # If no length differences, make sure the objects are indeed the same
        if not changes:
            # TODO: Make sure this actually compares the previous to the current state
            # I.e., checks content instead of references
            # So far, this is more of a dummy implementation
            try:
                [self.assert_same_sub_schema(old_blocks[i], curr_blocks[i]) for i in range(len(old_blocks))]
                [self.assert_same_sub_schema(old_objs[i], curr_objs[i]) for i in range(len(old_objs))]
            except BaseException as e:
                changes = True
        # Return pre-existing plot if nothing has changed
        # print(f'Python Ids of selected nodes {selected_ids} in plot_sptr()')
        # print(f'{not changes} AND {self.plot is not None} AND {selected_ids is not None} AND False')
        if (not changes) and (self.plot is not None) and (selected_ids is not None) and False:
            pass
            # TODO: Get plot to be displayed again
            print('before return pre-existing plot')
            return self.plot
            # return self.fig
        # Otherwise, create new plot
        else:
            # Extract all spike trains
            spiketrains = []
            for bl in curr_blocks:
                spiketrains.append(bl.list_children_by_class(self.SpikeTrain))
            spiketrains.append([obj for obj in curr_objs if isinstance(obj, self.SpikeTrain)])
            if selected_ids is not None:
                # print(f'selected ids = {selected_ids}')
                spiketrains = [st for st_list in spiketrains for st in st_list if st._id in selected_ids]
                # print(f'selected spiketrains to be plotted: {spiketrains}')
            # TODO: Add user-adaptive time slicing
            #             for row in spiketrains:
            #                 for i, sptr in enumerate(row):
            #                     row[i] = sptr.time_slice(0, 50)
            # If there are any spike trains
            if spiketrains:
                # Set matplotlib parameters
                # TODO: adaptive to user's layout, screen width etc.
                from matplotlib import rcParams
                size = rcParams['figure.figsize']
                # figure size in inches
                rcParams['figure.figsize'] = 11.7, 8.7
                rcParams['figure.figsize'] = 5.85, 4.35
                try:
                    ax = self.plot[0]
                except TypeError:
                    ax = None
                # Rasterplot using viziphant
                self.plot = self.rasterplot(spiketrains, s=0.1, title="Rasterplot for SpikeTrains")
                # Reset figsize for later plots
                rcParams['figure.figsize'] = size
                # self.fig = self.plt.figure()
        # self.plt.show()
        # return self.fig
        return self.plot

    # Pre-existing routine for plotting AnalogSignals, developed by Robin Gutzen
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

        self.plt.title("Plotting LFPs for AnalogSignals")
        # Defines plot parameters for x-axis
        self.plt.xlabel('Time ({0})'.format(times.dimensionality))

        # Defines plot parameters for y-axis
        self.plt.ylabel('trials')
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
        """
        Wrapper for plot_lfp to update the lfp plot

        Called at every cell execution
        """
        # Extract all AnalogSignals
        anasigs = []
        for bl in self.blocks:
            anasigs.extend(bl.list_children_by_class(self.AnalogSignal))
        anasigs.extend([obj for obj in self.other_objs if isinstance(obj, self.AnalogSignal)])
        # Create plot from scratch
        self.anasig_plot = None
        self.plot_lfp(anasigs[:20], times=self.np.arange(len(anasigs[0])) * self.pq.s, spacing=50)
        # Return it for display
        return self.anasig_plot

    def testfunc(self):
        """
        Debugging function that lists all Neo objects and returns them as a JSON string
        Lists independent neo objects and blocks with all their segments and analogsignals
        """
        # List namespace
        vals = nsm.who_ls()
        # Extract neo objects
        values = [v for v in vals if
                  isinstance(__main__.__dict__[v], (self.BaseNeo, list))]  # in ['Block', 'Segment', 'ChannelIndex',
        for value in list(values):
            # Get variables corresponding to the names
            val = __main__.__dict__[value]
            # Remove lists of non-neo objects
            if isinstance(val, list):
                if len(val) > 0 and isinstance(val[0], self.BaseNeo):
                    pass
                else:
                    values.remove(value)
            # Add enumeration of all Segments and AnalogSignals of blocks to the list of strings
            if isinstance(val, self.Block):
                for i, seg in enumerate(val.list_children_by_class("Segment")):
                    # globals()[''.join(['blchidx', str(i)])] = chidx
                    values.append(''.join([value, '.segmets[', str(i), ']']))
                    for j, sig in enumerate(seg.analogsignals):
                        # pass
                        values.append(''.join([values[-1 - j], '.analogsigs[', str(j), ']']))

        return json.dumps(values)
