"""
Miscellaneous standalone helpers for elephant lab that don't depend on
neo object state: version reporting, kernel namespace inspection, and
loading files into the notebook via neo IO.
"""

class ElephantLab_util:

    import json
    import __main__
    import neo
    import sys
    from elephant_lab import __version__

    def __init__(self):
        """
        Class to outsource some elephant lab logic:
            -all logic that does not work with the elephant_lab_entity and just has to be executed
        Is a Class to minimize the amount of name clutter in the notebook
        """

    def version(self):
        """Prints the installed elephant-lab version."""
        print(self.__version__)

    def getVars(self):
        """Prints the names of all variables currently defined in the notebook kernel, as a JSON list."""
        print(self.json.dumps(list(self.__main__.__dict__.keys())))

    def setVarNameIOClass(self, ioClass, filePath, varName):
        """Reads filePath with the given neo.io class name and assigns the resulting block to varName in the notebook."""
        io_class = getattr(self.neo.io, ioClass)
        reader = io_class(filename=filePath)
        self.__main__.__dict__[varName] = reader.read_block()

    def setVarNameNotIOClass(self, filePath, varName):
        """
        Reads filePath using neo's automatic IO detection and assigns the
        result to varName in the notebook. Unwraps single-item lists and
        dicts with a 'blocks' key to get the underlying neo object.
        """
        var = self.neo.get_io(filePath).read()
        if (isinstance(var, list)):
            var = var[0]
        elif (isinstance(var, dict)):
            var = var['blocks'][0]
        self.__main__.__dict__[varName] = var
        print(var, type(var))

    def getNeoIOClass(self, filename):
        """Prints the name of the neo IO class that would be used to read filename, or None on error."""
        try:
            io = self.neo.get_io(filename)
            print(self.json.dumps(io.__class__.__name__))
        except Exception as e:
            print(f"Error getting IO for {filename}: {e}", file=self.sys.stderr)
            print(self.json.dumps(None))