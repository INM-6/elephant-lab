class TreeNode:

    def __init__(self):
        self.children = []

    def add_child(self, child):
        self.children.append(child)

class FolderNode(TreeNode):

    __slots__ = ("name",)

    def __init__(self, name):
        super().__init__()
        self.name = name

class NeoNode(TreeNode):

    __slots__ = ("variable_name", "neo_object", "_hash", "tree_node", "primary_name")

    def __init__(self, variable_name, neo_object):
        super().__init__()
        self.variable_name = variable_name
        self.neo_object = neo_object
        self._hash = hash(self.variable_name)
        self.primary_name = self.get_primary_name()

    def get_primary_name(self):
        name = getattr(self.neo_object, "name", None)
        return name if name is not None else self.variable_name


    def __eq__(self, other):
        if not isinstance(other, NeoNode):
            return False
        return (
            self.variable_name == other.variable_name and
            self.neo_object is other.neo_object
        )

    def __hash__(self):
        return self._hash

    def has_tree_node(self):
        return self.tree_node is not None
    
    def update(self, neo_object):
        #if hash is only name then check here if neo_object id changed
        changed = False
        if id(self.neo_object) != id(neo_object):
            self.neo_object = neo_object
            changed = True
        else:
            new_primary_name = self.get_primary_name()
            if new_primary_name != self.primary_name:
                self.primary_name = new_primary_name
                changed = True
            #elif self.tree_node.is_selected() and deephashChanged:
            #   changed = True
        return changed