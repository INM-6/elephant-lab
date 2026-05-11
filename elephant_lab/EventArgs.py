from .Event import EventArgs
from .TreeNode import TreeNode, NeoNode

class TNeoNodesChangedEventArgs(EventArgs):

    def __init__(self, changed_neo_nodes: set[NeoNode], added_neo_nodes: set[NeoNode], removed_neo_nodes: set[NeoNode]):
        self.changed_neo_nodes = changed_neo_nodes
        self.added_neo_nodes = added_neo_nodes
        self.removed_neo_nodes = removed_neo_nodes

class SelectedTreeNodesChangedEventArgs(EventArgs):

    def __init__(self, new_selected_tree_nodes: set[TreeNode], deselected_tree_nodes: set[TreeNode]):
        self.new_selected_tree_nodes = new_selected_tree_nodes
        self.deselected_tree_nodes = deselected_tree_nodes