from contextlib import AsyncExitStack
from typing import Optional
import sys
import asyncio
import logging

from agents import (
    Agent,
    Runner,
    SQLiteSession,
    OpenAIChatCompletionsModel,
    set_tracing_disabled,
    function_tool,
)
from agents.mcp import MCPServerStdio, create_static_tool_filter
from openai import AsyncOpenAI

from .config import (
    AssistantConfiguration,
    PATH_TO_MCP_SERVER,
    MAX_AGENT_RUNS,
    MCP_SERVER_TIMEOUT,
)

set_tracing_disabled(True)

# Shared application state
agent: Optional[Agent] = None
session: Optional[SQLiteSession] = None

_exit_stack: Optional[AsyncExitStack] = None
_client: Optional[AsyncOpenAI] = None
_lifecycle_lock = asyncio.Lock()
_active_runs: set[asyncio.Task] = set()
_logger = logging.getLogger(__name__)
_RUN_CANCELLATION_TIMEOUT = 10


async def initialize(
    elephant_lab_entity,
    configuration: AssistantConfiguration,
) -> Agent:
    """
    Initialize the OpenAI client, start the MCP server,
    and create the agent.

    Safe to call multiple times; subsequent calls reuse
    the existing initialized agent.
    """
    global agent, _exit_stack, _client

    async with _lifecycle_lock:
        if agent is not None:
            return agent

        client = AsyncOpenAI(
            base_url=configuration.api_base,
            api_key=configuration.api_key,
        )
        model = OpenAIChatCompletionsModel(
            model=configuration.model,
            openai_client=client,
        )
        stack = AsyncExitStack()

        @function_tool
        def get_selected_neo_metadata() -> str:
            """Get the metadata of the currently selected neo objects."""
            if elephant_lab_entity is None:
                return {}
            return elephant_lab_entity.get_selected_neo_metadata()

        try:
            allowed_jupyter_tools = {
                "list_files",
                "list_notebooks",
                "use_notebook",
                "read_notebook",
                "read_cell",
                "insert_cell",
                "edit_cell_source",
                "overwrite_cell_source",
            }

            mcp_servers = [
                await stack.enter_async_context(
                    MCPServerStdio(
                        name="RAG Index",
                        params={
                            "command": sys.executable,
                            "args": ["-m", PATH_TO_MCP_SERVER],
                            "env": {
                                "ELEPHANT_LAB_API_BASE": configuration.api_base,
                                "ELEPHANT_LAB_API_KEY": configuration.api_key,
                            },
                        },
                    )
                ),
                await stack.enter_async_context(
                    MCPServerStdio(
                        name="JupyterLab",
                        params={
                            "command": "uvx",
                            "args": [
                                "jupyter-mcp-server@latest",
                                "--start-new-code-sandbox",
                                "false",
                            ],
                            "env": {
                                "JUPYTER_URL": "http://localhost:8888",
                                "JUPYTER_TOKEN": "MY_TOKEN",
                                "ALLOW_IMG_OUTPUT": "false",
                            },
                        },
                        tool_filter=create_static_tool_filter(
                            allowed_tool_names=list(allowed_jupyter_tools)
                        ),
                        client_session_timeout_seconds=MCP_SERVER_TIMEOUT,
                    )
                ),
            ]

            new_agent = Agent(
                name="Assistant",
                instructions="""
                You are a scientific assistant working with Neo and Elephant.

                The user works in JupyterLab.

                ## Jupyter notebook rules

                You have access to an existing Jupyter notebook through MCP.

                You may read and modify notebook cells.

                You MUST NEVER execute code.

                ### Workflow

                When modifying a notebook:

                1. If the target notebook is unknown, call list_files ONCE.
                2. Call use_notebook ONCE to connect to the existing notebook.
                3. Call read_notebook ONCE to inspect its contents.
                4. Determine the appropriate cell index.
                5. Call insert_cell or edit_cell_source.
                6. Call read_notebook ONCE to verify the modification.

                ### Strict restrictions

                - Never create a new notebook unless explicitly requested.
                - Never execute code.
                - Never call execute_cell or execute_code.
                - Never restart kernels.
                - Never delete cells unless explicitly requested.
                - Never switch notebooks unnecessarily.
                - Never repeatedly retry a failed MCP call.
                - Never invent tool parameters.
                - Never call multiple notebook-modification tools in parallel.
                - Always specify notebook_name when the tool supports it.
                - Prefer insert_cell over overwriting existing cells.
                - Use cell_index=-1 to append a cell.

                ### Scientific code

                Use elephant, viziphant, neo and quantities where appropriate.
                KEEP IT SIMPLE AND SAFE!!!

                You can write Python code into notebook cells.
                You must not execute or test that code.

                Be concise and avoid unnecessary tool calls.
                """,
                tools=[get_selected_neo_metadata],
                mcp_servers=mcp_servers,
                model=model,
            )
        except BaseException:
            try:
                await stack.aclose()
            except BaseException:
                _logger.exception("Failed to close partially initialized MCP servers.")
            try:
                await client.close()
            except BaseException:
                _logger.exception("Failed to close the partially initialized OpenAI client.")
            raise

        _client = client
        _exit_stack = stack
        agent = new_agent
        return agent


async def reset_session() -> SQLiteSession:
    """
    Create a fresh conversation session.
    """
    global session

    if session is None:
        session_id = "default_session"
        session = SQLiteSession(session_id)
    else:
        await session.clear_session()
    return session


async def run_agent(
    message: str,
    *,
    use_session: bool = True,
):
    """
    Run the agent with or without conversation history.

    Args:
        message: User's input.
        use_session: Whether to use conversation history.
        session_id: SQLite session ID when creating a session.
        conversation: An explicitly supplied session object.

    Returns:
        The result returned by Runner.run().
    """
    current_agent = agent
    if current_agent is None:
        raise ValueError("Configure the assistant API URL, API key, and model first.")

    current_task = asyncio.current_task()
    if current_task is None:
        raise RuntimeError("Assistant requests must run inside an asyncio task.")
    _active_runs.add(current_task)
    try:
        if use_session:
            global session

            if session is None:
                await reset_session()

            current_session = session
        else:
            current_session = None

        if current_session is None:
            return await Runner.run(
                current_agent,
                message,
                max_turns=MAX_AGENT_RUNS,
            )
        return await Runner.run(
            current_agent,
            message,
            session=current_session,
            max_turns=MAX_AGENT_RUNS,
        )
    finally:
        _active_runs.discard(current_task)


async def shutdown() -> None:
    """
    Close the MCP server and OpenAI client.

    Call this when your application is shutting down.
    """
    global agent, session, _exit_stack, _client

    async with _lifecycle_lock:
        cleanup_errors: list[BaseException] = []
        current_task = asyncio.current_task()
        active_runs = [
            task for task in _active_runs
            if task is not current_task and not task.done()
        ]
        for task in active_runs:
            task.cancel()
        if active_runs:
            completed, pending = await asyncio.wait(
                active_runs,
                timeout=_RUN_CANCELLATION_TIMEOUT,
            )
            await asyncio.gather(*completed, return_exceptions=True)
            if pending:
                cleanup_errors.append(
                    TimeoutError(
                        f"{len(pending)} assistant request(s) did not cancel in time."
                    )
                )

        stack, client, current_session = _exit_stack, _client, session
        _exit_stack = None
        _client = None
        agent = None
        session = None

        if stack is not None:
            try:
                await stack.aclose()
            except BaseException as error:
                cleanup_errors.append(error)
        if current_session is not None:
            try:
                current_session.close()
            except BaseException as error:
                cleanup_errors.append(error)
        if client is not None:
            try:
                await client.close()
            except BaseException as error:
                cleanup_errors.append(error)

        if cleanup_errors:
            details = "; ".join(str(error) for error in cleanup_errors)
            raise RuntimeError(f"Assistant cleanup failed: {details}") from cleanup_errors[0]