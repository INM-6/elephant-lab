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

    def setVarNameIOClass(self, ioClass, filePath, varName, extra_kwargs=None, split_channels=False):
        io_class = getattr(self.neo.io, ioClass)
        kwargs = self.json.loads(extra_kwargs) if extra_kwargs else {}
        reader = io_class(filename=filePath, **kwargs)
        block = self._read_block_with_optional_split(reader, split_channels)
        self.__main__.__dict__[varName] = block

    def setVarNameNotIOClass(self, filePath, varName, split_channels=False):
        reader = self.neo.get_io(filePath)
        if hasattr(reader, 'read_block'):
            var = self._read_block_with_optional_split(reader, split_channels)
        else:
            var = reader.read()
            if isinstance(var, list):
                var = var[0]
            elif isinstance(var, dict):
                var = var['blocks'][0]
            if split_channels:
                self._split_analog_signal_channels(var)
        self.__main__.__dict__[varName] = var
        print(var, type(var))

    def _read_block_with_optional_split(self, reader, split_channels):
        if split_channels:
            try:
                return reader.read_block(signal_group_mode='split-all')
            except TypeError:
                pass
        block = reader.read_block()
        if split_channels:
            self._split_analog_signal_channels(block)
        return block

    def _split_analog_signal_channels(self, block):
        for seg in block.segments:
            new_signals = []
            for sig in seg.analogsignals:
                if sig.shape[1] > 1:
                    for i in range(sig.shape[1]):
                        ch_sig = sig[:, i:i+1]
                        ch_sig.segment = seg
                        ann = getattr(ch_sig, 'array_annotations', {})
                        if 'channel_names' in ann:
                            ch_sig.name = str(ann['channel_names'][0])
                        elif 'channel_ids' in ann:
                            ch_sig.name = f"ch_{ann['channel_ids'][0]}"
                        else:
                            ch_sig.name = f"{sig.name}_ch{i}" if sig.name else f"channel_{i}"
                        new_signals.append(ch_sig)
                else:
                    new_signals.append(sig)
            seg.analogsignals = new_signals

    def getNeoIOClass(self, filename):
        try:
            io = self.neo.get_io(filename)
            print(self.json.dumps(io.__class__.__name__))
        except Exception as e:
            print(f"Error getting IO for {filename}: {e}", file=self.sys.stderr)
            print(self.json.dumps(None))