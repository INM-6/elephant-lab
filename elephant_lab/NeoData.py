class NeoData:

    __slots__ = ("reference_name", "neo_object", "_hash", "tree_node", "primary_name")

    def __init__(self, reference_name, neo_object):
        self.reference_name = reference_name
        self.neo_object = neo_object
        self._hash = hash((self.reference_name, id(self.neo_object)))
        self.tree_node = None
        self.primary_name = self.get_primary_name()

    def get_primary_name(self):
        name = getattr(self.neo_object, "name", None)
        return name if name is not None else self.reference_name


    def __eq__(self, other):
        if not isinstance(other, NeoData):
            return False
        return (
            self.reference_name == other.reference_name and
            self.neo_object is other.neo_object
        )

    def __hash__(self):
        return self._hash

    def has_tree_node(self):
        return self.tree_node is not None
    
    def update(self):
        changed = False
        new_primary_name = self.get_primary_name()
        if new_primary_name != self.primary_name:
            self.primary_name = new_primary_name
            changed = True
        #elif self.tree_node.is_selected() and deephashChanged:
        #   changed = True
        return changed