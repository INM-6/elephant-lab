# XXX: In general this is bad practice but might be useful for this exact usecase
# Importing main namespace in order to be able to access objects created in
# JupyterLab Python kernel
import __main__
import time
from elephant.pandas_bridge import multi_spiketrains_to_dataframe, multi_events_to_dataframe, multi_epochs_to_dataframe, spiketrain_to_dataframe, event_to_dataframe, epoch_to_dataframe

NEO_ABBREVIATIONS = {"Block": "BLK",
                     "Segment": "SEG",
                     "Group": "GRP",
                     "ChannelView": "CHV",
                     "IrregularlySampledSignal": "ISS",
                     "AnalogSignal": "ASG",
                     "SpikeTrain": "SPT",
                     "SpikeTrainList": "SPL",
                     "Epoch": "EPC",
                     "Event": "EVT",
                     "ImageSequence": "ISQ",
                     "RegionOfInterest": "ROI",
                     "CircularRegionOfInterest": "CRI",
                     "PolygonRegionOfInterest": "PRI",
                     "RectangularRegionOfInterest": "RRI",
                     }


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
    from neo.core.regionofinterest import RegionOfInterest
    from neo.core.spiketrainlist import SpikeTrainList
    from neo import Block, SpikeTrain, AnalogSignal, Event, Epoch
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
            if isinstance(obj, (self.BaseNeo, list)) or issubclass(type(obj), self.RegionOfInterest):
                values[v] = obj
        # Get only blocks
        self.blocks = [v for v in values.values() if isinstance(v, self.Block)]
        # Get all other objects, i.e., neo objects with references independent of a Block
        self.other_objs = [v for v in values.values() if (isinstance(v, self.BaseNeo) or issubclass(type(v), self.RegionOfInterest)) and not isinstance(v, self.Block)]
        # get lists of neo objects or mixed lists
        neo_objs_in_list = [v for v in values.values() if isinstance(v, list) and any(isinstance(v[i], self.BaseNeo) for i in range(len(v)))]
        # neo_objs_in_list = [ele for l in neo_objs_in_list for ele in l if isinstance(ele, self.BaseNeo) and not isinstance(ele, self.Block)]
        self.other_objs.extend(neo_objs_in_list)

    def update_tree(self):
        """
        Updates the ipytree tree view of the neo hierarchy

        Called at every cell execution
        """
        # Timer used for debugging only
        start = time.time()
        # Update all neo objects
        self.update()
        print(f"After Update: {time.time() - start}")
        # Currently the tree is created from scratch every time
        # TODO: Reuse the existing tree if there is one
        if self.tree is not None or True:
            print("HERE")
            # Create one tree node per neo block and name of node is name of block
            nodes = []
            for bl in self.blocks:
                bl_node = self.Node(f"{NEO_ABBREVIATIONS[bl.__class__.__name__]}: {bl.name}")
                bl_node.opened = False
                self._add_sub_nodes(bl_node, bl)
                nodes.append(bl_node)
                self.map[bl_node._id] = bl._id
            print(f"After Blocks: {time.time() - start}")
            # print(f"Nodes After Blocks: {nodes}")

            # Top-level node for every independent neo object
            for obj in self.other_objs:
                if issubclass(type(obj), self.RegionOfInterest):
                    obj_node = self.Node(f"{NEO_ABBREVIATIONS[obj.__class__.__name__]}: ")
                    self.map[obj_node._id] = None
                elif isinstance(obj, list):
                    obj_node = self.Node(f"{obj.__class__.__name__}: ")
                    self.map[obj_node._id] = None
                else:
                    obj_node = self.Node(f"{NEO_ABBREVIATIONS[obj.__class__.__name__]}: {obj.name}")
                    self.map[obj_node._id] = obj._id
                obj_node.opened = False
                self._add_sub_nodes(obj_node, obj)
                nodes.append(obj_node)

            print(f"After Independent: {time.time() - start}")
            # print(f"Nodes After Independent: {nodes}")

            print(f"Calculation finished: {time.time() - start}")
            import sys
            sys.stdout.flush()
            # Runs asynchronously for Python kernel but blocks output via JS
            self.tree.nodes = nodes
            print(f"Rendered: {time.time() - start}")
        else:
            pass

    def _add_sub_nodes(self, parent, obj):
        """
        Adding child objects of a neo container as sub nodes of the tree node 
        that corresponds to the container

        Parameters
        ----------
        parent : Node
            Parent node of ipytree
        obj : Neo container or standard python container i.e. list, dict
            Parent container object
        """
        # print(f"parent: {parent}, obj: {obj}")
        if issubclass(type(obj), (self.BaseNeo, self.RegionOfInterest)):
            # iterate over object attributes and create nodes recursively
            for attr_name, attr_value in obj.__dict__.items():
                if isinstance(attr_value, (dict, list, self.SpikeTrainList)):
                    attr_node = self.Node(attr_name)
                    self.map[attr_node._id] = None
                    attr_node.opened = False
                    self._add_sub_nodes(attr_node, attr_value)
                    parent.add_node(attr_node)
                else:
                    pass
        elif isinstance(obj, dict):
            for key, value in obj.items():
                sub_dict_node = self.Node(f"{key}: {value}")
                self.map[sub_dict_node._id] = None
                sub_dict_node.opened = False
                parent.add_node(sub_dict_node)
        elif isinstance(obj, (list, self.SpikeTrainList)):
            for child_obj in obj:
                if issubclass(type(child_obj), self.BaseNeo):
                    child_node = self.Node(f"{NEO_ABBREVIATIONS[child_obj.__class__.__name__]}: {child_obj.name}")
                    child_node.opened = False
                    self.map[child_node._id] = child_obj._id
                    self._add_sub_nodes(child_node, child_obj)
                    parent.add_node(child_node)
                else:
                    pass
        else:
            raise TypeError(f"unsupported class/type: {type(obj)}")

    def create_tree(self):
        """
        Initialize the tree

        """
        self.tree = None
        # Alternating dark and light stripes for better better visibility
        self.tree = self.Tree(stripes=True, multiple_selection=True)
        return self.tree

    def selected_nodes_to_dataframes(self, selected_ids=None):
        """
        Convert the selected tree nodes representing neo objects to 'pandas.DataFrame' objects.

        """
        spiketrains = []
        events = []
        epochs = []

        # extract all SpikeTrains, Events and Epochs from the blocks
        for bl in self.blocks:
            spiketrains.append(bl.list_children_by_class(self.SpikeTrain))
            events.append(bl.list_children_by_class(self.Event))
            epochs.append(bl.list_children_by_class(self.Epoch))
        # extract all SpikeTrains, Events and Epochs from the other (independet) objekts
        spiketrains.append([obj for obj in self.other_objs if isinstance(obj, self.SpikeTrain)])
        events.append([obj for obj in self.other_objs if isinstance(obj, self.Event)])
        epochs.append([obj for obj in self.other_objs if isinstance(obj, self.Epoch)])

        df_spt = None
        df_evt = None
        df_epc = None

        if selected_ids is not None:
            spiketrains = [st for st_list in spiketrains for st in st_list if st._id in selected_ids]
            events = [ev for ev_list in events for ev in ev_list if ev._id in selected_ids]
            epochs = [ep for ep_list in epochs for ep in ep_list if ep._id in selected_ids]

            if len(spiketrains) > 0:
                df_spt = multi_spiketrains_to_dataframe(container=spiketrains, parents=False)
            if len(events) > 0:
                df_evt = multi_events_to_dataframe(container=events, parents=False)
            if len(epochs) > 0:
                df_epc = multi_epochs_to_dataframe(container=epochs, parents=False)

        return df_spt, df_evt, df_epc

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
