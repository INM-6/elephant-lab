from contextlib import AsyncExitStack
from typing import Optional
import sys

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
    API_BASE,
    CHAT_COMPLETION_MODEL,
    API_KEY,
    PATH_TO_MCP_SERVER,
    MAX_AGENT_RUNS,
    MCP_SERVER_TIMEOUT,
)

set_tracing_disabled(True)

# Shared application state
agent: Optional[Agent] = None
session: Optional[SQLiteSession] = None

_mcp_servers:list[Optional[MCPServerStdio]] = None
_exit_stack: Optional[AsyncExitStack] = None
_client: Optional[AsyncOpenAI] = None


async def initialize(elephant_lab_entity=None) -> Agent:
    """
    Initialize the OpenAI client, start the MCP server,
    and create the agent.

    Safe to call multiple times; subsequent calls reuse
    the existing initialized agent.
    """
    global agent, _mcp_servers, _exit_stack, _client

    if agent is not None:
        return agent

    _client = AsyncOpenAI(
        base_url=API_BASE,
        api_key=API_KEY,
    )

    model = OpenAIChatCompletionsModel(
        model=CHAT_COMPLETION_MODEL,
        openai_client=_client,
    )

    stack = AsyncExitStack()

    @function_tool
    def get_selected_neo_metadata() -> str:
        """
        Get the metadata of the currently selected neo objects.
        """
        if elephant_lab_entity is None:
            return {}
        return elephant_lab_entity.get_selected_neo_metadata()

    try:
        ALLOWED_JUPYTER_TOOLS = {
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
                        "args": [
                            "-m",
                            PATH_TO_MCP_SERVER,
                        ],
                        "env": {
                            "ELEPHANT_LAB_API_KEY": API_KEY,
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
                        allowed_tool_names=list(ALLOWED_JUPYTER_TOOLS)
                    ),
                    client_session_timeout_seconds=MCP_SERVER_TIMEOUT,
                )
            )
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
        await stack.aclose()
        await _client.close()
        _client = None
        raise

    # Keep the MCP server running beyond this function's return.
    _exit_stack = stack
    _mcp_servers = mcp_servers
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
    current_agent = await initialize()

    if use_session:
        global session

        if session is None:
            await reset_session()

        current_session = session
    else:
        current_session = None

    if current_session is None:
        result = await Runner.run(
            current_agent,
            message,
            max_turns=MAX_AGENT_RUNS,
        )
    else:
        result = await Runner.run(
            current_agent,
            message,
            session=current_session,
            max_turns=MAX_AGENT_RUNS,
        )

    return result


async def shutdown() -> None:
    """
    Close the MCP server and OpenAI client.

    Call this when your application is shutting down.
    """
    global agent, session, _mcp_servers, _exit_stack, _client

    try:
        if _exit_stack is not None:
            await _exit_stack.aclose()
    finally:
        _exit_stack = None
        _mcp_servers = None
        agent = None
        session = None

        if _client is not None:
            await _client.close()
            _client = None