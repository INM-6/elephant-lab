import asyncio

import pytest

from elephant_lab.assistant import main_agent
from elephant_lab.assistant.config import AssistantConfiguration
from elephant_lab import elephant_lab_assistant


class _FakeClient:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


class _FakeSession:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class _FakeExitStack:
    def __init__(self, *, error=None):
        self.error = error
        self.closed = False

    async def aclose(self):
        self.closed = True
        if self.error:
            raise self.error


def _reset_agent_state():
    main_agent.agent = None
    main_agent.session = None
    main_agent._exit_stack = None
    main_agent._client = None
    main_agent._active_runs.clear()


@pytest.mark.asyncio
async def test_closing_assistant_comm_removes_listener_cancels_tasks_and_closes_comm(
    monkeypatch,
):
    class FakeEvent:
        def __init__(self):
            self.listeners = []

        def remove_listener(self, listener):
            self.listeners.remove(listener)

    class FakeEntity:
        def __init__(self):
            self.on_selected_neo_objects_changed = FakeEvent()

    class FakeComm:
        def __init__(self):
            self.close_count = 0

        def close(self):
            self.close_count += 1

    entity = FakeEntity()
    entity.on_selected_neo_objects_changed.listeners.append(
        elephant_lab_assistant.on_selection_changed
    )
    fake_comm = FakeComm()
    elephant_lab_assistant.comm = fake_comm
    elephant_lab_assistant.elephant_lab_entity = entity
    elephant_lab_assistant._listener_entity = entity
    elephant_lab_assistant._closing = False
    elephant_lab_assistant._comm_tasks.clear()

    stopped = asyncio.Event()

    async def fake_shutdown():
        stopped.set()

    monkeypatch.setattr(elephant_lab_assistant, "shutdown", fake_shutdown)
    task = asyncio.create_task(asyncio.Event().wait())
    elephant_lab_assistant._comm_tasks.add(task)
    try:
        await elephant_lab_assistant.close_assistant_comm()
        await elephant_lab_assistant.close_assistant_comm()

        assert task.cancelled()
        assert fake_comm.close_count == 1
        assert stopped.is_set()
        assert entity.on_selected_neo_objects_changed.listeners == []
        assert elephant_lab_assistant.comm is None
        assert elephant_lab_assistant.elephant_lab_entity is None
    finally:
        elephant_lab_assistant._comm_tasks.clear()
        elephant_lab_assistant.comm = None
        elephant_lab_assistant.elephant_lab_entity = None
        elephant_lab_assistant._listener_entity = None
        elephant_lab_assistant._closing = False


@pytest.mark.asyncio
async def test_unexpected_frontend_comm_close_disposes_python_entity():
    class FakeEntity:
        def __init__(self):
            self.disposed = False

        async def dispose(self):
            self.disposed = True

    entity = FakeEntity()
    elephant_lab_assistant.elephant_lab_entity = entity
    elephant_lab_assistant._closing = False
    elephant_lab_assistant._comm_tasks.clear()
    try:
        elephant_lab_assistant._dispose_entity_on_comm_close({})
        await asyncio.gather(*tuple(elephant_lab_assistant._comm_tasks))
        assert entity.disposed
    finally:
        elephant_lab_assistant._comm_tasks.clear()
        elephant_lab_assistant.elephant_lab_entity = None
        elephant_lab_assistant._closing = False


@pytest.mark.asyncio
async def test_kernel_shutdown_disposes_entity_before_ipykernel_shutdown():
    class FakeEntity:
        def __init__(self):
            self.disposed = False

        async def dispose(self):
            self.disposed = True

    class FakeKernel:
        def __init__(self):
            self.original_shutdown_called = False

        async def do_shutdown(self, restart):
            self.original_shutdown_called = True
            return {"restart": restart}

    entity = FakeEntity()
    kernel = FakeKernel()
    elephant_lab_assistant.elephant_lab_entity = entity
    try:
        elephant_lab_assistant._register_kernel_shutdown_hook(kernel)
        elephant_lab_assistant._register_kernel_shutdown_hook(kernel)

        result = await kernel.do_shutdown(True)

        assert entity.disposed
        assert kernel.original_shutdown_called
        assert result == {"restart": True}
    finally:
        elephant_lab_assistant.elephant_lab_entity = None


@pytest.mark.asyncio
async def test_kernel_shutdown_cleanup_timeout_does_not_block_ipykernel(monkeypatch):
    class FakeEntity:
        async def dispose(self):
            await asyncio.Event().wait()

    class FakeKernel:
        async def do_shutdown(self, restart):
            return {"restart": restart}

    monkeypatch.setattr(
        elephant_lab_assistant,
        "_KERNEL_SHUTDOWN_CLEANUP_TIMEOUT",
        0.01,
    )
    kernel = FakeKernel()
    elephant_lab_assistant.elephant_lab_entity = FakeEntity()
    try:
        elephant_lab_assistant._register_kernel_shutdown_hook(kernel)

        result = await asyncio.wait_for(kernel.do_shutdown(False), timeout=0.1)

        assert result == {"restart": False}
    finally:
        elephant_lab_assistant.elephant_lab_entity = None


@pytest.mark.asyncio
async def test_kernel_shutdown_supports_synchronous_ipykernel_hook():
    class FakeKernel:
        def do_shutdown(self, restart):
            return {"restart": restart}

    kernel = FakeKernel()
    elephant_lab_assistant.elephant_lab_entity = None
    try:
        elephant_lab_assistant._register_kernel_shutdown_hook(kernel)
        result = await kernel.do_shutdown(False)
        assert result == {"restart": False}
    finally:
        elephant_lab_assistant.elephant_lab_entity = None


@pytest.mark.asyncio
async def test_shutdown_cancels_active_run_and_closes_every_resource():
    _reset_agent_state()
    stack = _FakeExitStack(error=RuntimeError("MCP close failed"))
    client = _FakeClient()
    session = _FakeSession()
    main_agent.agent = object()
    main_agent.session = session
    main_agent._exit_stack = stack
    main_agent._client = client

    started = asyncio.Event()

    async def running_request(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    original_run = main_agent.Runner.run
    main_agent.Runner.run = running_request
    request = asyncio.create_task(main_agent.run_agent("hello", use_session=False))
    try:
        await started.wait()
        with pytest.raises(RuntimeError, match="MCP close failed"):
            await main_agent.shutdown()

        assert request.cancelled()
        assert stack.closed
        assert session.closed
        assert client.closed
        assert main_agent.agent is None
        assert main_agent.session is None
        assert main_agent._exit_stack is None
        assert main_agent._client is None

        await main_agent.shutdown()
    finally:
        main_agent.Runner.run = original_run
        if not request.done():
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)
        _reset_agent_state()


@pytest.mark.asyncio
async def test_partial_initialization_closes_started_mcp_and_client(monkeypatch):
    _reset_agent_state()
    client = _FakeClient()
    closed_servers = []
    server_count = 0

    class FakeServer:
        def __init__(self, **kwargs):
            nonlocal server_count
            server_count += 1
            self.should_fail = server_count == 2

        async def __aenter__(self):
            if self.should_fail:
                raise RuntimeError("MCP startup failed")
            return self

        async def __aexit__(self, *args):
            closed_servers.append(self)

    monkeypatch.setattr(main_agent, "AsyncOpenAI", lambda **kwargs: client)
    monkeypatch.setattr(main_agent, "OpenAIChatCompletionsModel", lambda **kwargs: object())
    monkeypatch.setattr(main_agent, "MCPServerStdio", FakeServer)
    monkeypatch.setattr(main_agent, "create_static_tool_filter", lambda **kwargs: None)

    with pytest.raises(RuntimeError, match="MCP startup failed"):
        await main_agent.initialize(
            None,
            AssistantConfiguration(
                api_base="https://api.example.test/v1",
                api_key="test-key",
                model="test-model",
            ),
        )

    assert len(closed_servers) == 1
    assert client.closed
    assert main_agent.agent is None
    assert main_agent._exit_stack is None
    assert main_agent._client is None
    _reset_agent_state()
