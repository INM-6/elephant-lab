class SimpleEvent:
    def __init__(self):
        self._listeners = []

    def add_listener(self, fn):
        """Register a callback function."""
        self._listeners.append(fn)

    def remove_listener(self, fn):
        """Unregister a callback function."""
        self._listeners.remove(fn)

    def fire(self):
        """Call all registered callbacks."""
        for fn in self._listeners:
            fn()