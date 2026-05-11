from typing import Callable, Generic, TypeVar

TEventArgs = TypeVar("TEventArgs")


class EventArgs:
    """Base class for event arguments."""
    pass


class Event(Generic[TEventArgs]):
    def __init__(self):
        self._listeners: list[Callable[[TEventArgs], None]] = []

    def add_listener(self, fn: Callable[[TEventArgs], None]) -> None:
        """Register a callback function."""
        self._listeners.append(fn)

    def remove_listener(self, fn: Callable[[TEventArgs], None]) -> None:
        """Unregister a callback function."""
        self._listeners.remove(fn)

    def fire(self, args: TEventArgs) -> None:
        """Call all registered callbacks."""
        for fn in self._listeners:
            fn(args)