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
        print(self.__version__)

    def getVars(self):
        print(self.json.dumps(list(self.__main__.__dict__.keys())))

    def setVarNameIOClass(self, ioClass, filePath, varName):
        io_class = getattr(self.neo.io, ioClass)
        reader = io_class(filename=filePath)
        self.__main__.__dict__[varName] = reader.read_block()

    def setVarNameNotIOClass(self, filePath, varName):
        var = self.neo.get_io(filePath).read()
        if (isinstance(var, list)):
            var = var[0]
        elif (isinstance(var, dict)):
            var = var['blocks'][0]
        self.__main__.__dict__[varName] = var
        print(var, type(var))

    def getNeoIOClass(self, filename):
        try:
            io = self.neo.get_io(filename)
            print(self.json.dumps(io.__class__.__name__))
        except Exception as e:
            print(f"Error getting IO for {filename}: {e}", file=self.sys.stderr)
            print(self.json.dumps(None))