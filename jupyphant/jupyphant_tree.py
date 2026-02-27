class Jupyphant_tree:

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .jupyphant import Jupyphant  # only for type hints

    def __init__(self, jupyphant_entity: "Jupyphant_tree.Jupyphant"):
        """
        Class to outsource some jupyphant logic:
            -all logic regarding the Neo tree structure of Jupyphant
        Is a Class to minimize the amount of name clutter in the notebook
        """ 
        self.jupyphant_entity: "Jupyphant_tree.Jupyphant" = jupyphant_entity