from ipykernel.comm import Comm
import asyncio
import traceback

from .assistant.config import AssistantConfiguration
from .assistant.main_agent import (
    initialize,
    reset_session,
    run_agent,
    shutdown,
)

# =============================================================
# Jupyter Comm
# =============================================================

comm = None
elephant_lab_entity = None

def on_selection_changed():
    try:
        if comm:
            comm.send({"type": "selection_changed", "selected_count": len(elephant_lab_entity.get_selected_neo_ids())})
    except Exception as e:
        if comm:
            comm.send({"type": "error", "message": str(e)})

def create_assistant_comm(_elephant_lab_entity):

    global comm

    comm = Comm(
        target_name="assistant_channel"
    )

    comm.on_msg(
        lambda msg: asyncio.create_task(handle_comm_message(msg))
    )

    global elephant_lab_entity
    elephant_lab_entity = _elephant_lab_entity
    elephant_lab_entity.on_selected_neo_objects_changed.add_listener(on_selection_changed)
    return comm


async def handle_comm_message(msg):

    try:

        data = msg["content"]["data"]

        match data.get("type"):

            case "configure":
                await configure_assistant(data.get("configuration"))

            case "user_message":
                await handle_user_message(
                    data.get("generation"),
                    data.get("message"),
                    data.get("include_selection"),
                )

            case "clear_context":
                await clear_conversation()

            case _:
                comm.send({
                    "type": "error",
                    "message": (
                        "Undefined comm message data type: "
                        f"{data.get('type')}"
                    ),
                })

    except Exception as error:
        traceback.print_exc()
        comm.send({
            "type": "error",
            "message": str(error),
        })


async def configure_assistant(settings):
    try:
        configuration = AssistantConfiguration.from_settings(settings)
        await shutdown()
        await initialize(elephant_lab_entity, configuration)
    except Exception as error:
        comm.send({
            "type": "configuration_result",
            "ok": False,
            "message": str(traceback.format_exc()),
        })
        return

    comm.send({
        "type": "configuration_result",
        "ok": True,
    })


async def handle_user_message(generation, message, include_selection):
    if include_selection and elephant_lab_entity.has_selected_neo_objects():
        message += """\nMake sure to answer the question based on the selected objects in the current context."
            These objects already exist in the Kernel, but may have to be accessed through their parent which can be figured out by the metadata."
            You may also get the context of the surrounding objects of the selected objects."
            These are only so you can understand the context and the ones marked as selected should be prioritized."""
    try:
        # Run with conversation history.
        result = await run_agent(message)

        comm.send({
            "type": "assistant_response",
            "generation": generation,
            "message": result.final_output,
        })
    except Exception as e:
        comm.send({
            "type": "assistant_response",
            "generation": generation,
            "message": str(traceback.format_exc()),
        })


async def clear_conversation():

    await reset_session()

    """
    comm.send({
        "type": "context_cleared",
    })
    """


async def close_assistant_comm():

    await shutdown()

    global comm

    if comm is not None:
        comm.close()
        comm = None