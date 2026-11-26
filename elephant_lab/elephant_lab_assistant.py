import asyncio
import inspect
import logging
import traceback

from ipykernel.comm import Comm

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
_listener_entity = None
_comm_tasks: set[asyncio.Task] = set()
_closing = False
_COMM_CANCELLATION_TIMEOUT = 10
_KERNEL_SHUTDOWN_CLEANUP_TIMEOUT = 2
_logger = logging.getLogger(__name__)


def _register_kernel_shutdown_hook(kernel=None):
    if kernel is None:
        from IPython import get_ipython

        shell = get_ipython()
        kernel = getattr(shell, "kernel", None)
    if kernel is None or getattr(
        kernel, "_elephant_lab_shutdown_hook_installed", False
    ):
        return

    original_do_shutdown = kernel.do_shutdown

    async def do_shutdown(restart):
        entity = elephant_lab_entity
        if entity is not None:
            try:
                await asyncio.wait_for(
                    entity.dispose(),
                    timeout=_KERNEL_SHUTDOWN_CLEANUP_TIMEOUT,
                )
            except asyncio.CancelledError:
                _logger.warning(
                    "Elephant Lab cleanup was canceled during kernel shutdown."
                )
            except Exception:
                _logger.exception("Elephant Lab cleanup failed during kernel shutdown.")
        shutdown_result = original_do_shutdown(restart)
        if inspect.isawaitable(shutdown_result):
            return await shutdown_result
        return shutdown_result

    kernel.do_shutdown = do_shutdown
    kernel._elephant_lab_shutdown_hook_installed = True


def _send_comm(data):
    current_comm = comm
    if current_comm is not None and not _closing:
        current_comm.send(data)

def on_selection_changed():
    try:
        if elephant_lab_entity is not None:
            _send_comm({
                "type": "selection_changed",
                "selected_count": len(elephant_lab_entity.get_selected_neo_ids()),
            })
    except Exception as e:
        _send_comm({"type": "error", "message": str(e)})

def create_assistant_comm(_elephant_lab_entity):

    global comm, elephant_lab_entity, _listener_entity, _closing

    if comm is not None:
        raise RuntimeError("The assistant comm is already open for this kernel.")
    _register_kernel_shutdown_hook()
    _closing = False
    elephant_lab_entity = _elephant_lab_entity
    new_comm = Comm(target_name="assistant_channel")
    comm = new_comm
    try:
        new_comm.on_msg(_schedule_comm_message)
        new_comm.on_close(_dispose_entity_on_comm_close)
        if elephant_lab_entity is not None:
            _listener_entity = elephant_lab_entity
            elephant_lab_entity.on_selected_neo_objects_changed.add_listener(
                on_selection_changed
            )
        return new_comm
    except BaseException:
        if _listener_entity is not None:
            try:
                _listener_entity.on_selected_neo_objects_changed.remove_listener(
                    on_selection_changed
                )
            except BaseException:
                traceback.print_exc()
            _listener_entity = None
        elephant_lab_entity = None
        comm = None
        _closing = True
        try:
            new_comm.close()
        except BaseException:
            traceback.print_exc()
        raise


def _schedule_comm_message(msg):
    if _closing:
        return
    _track_comm_task(asyncio.create_task(handle_comm_message(msg)))


def _track_comm_task(task):
    _comm_tasks.add(task)
    task.add_done_callback(_comm_task_finished)


def _comm_task_finished(task):
    _comm_tasks.discard(task)
    if not task.cancelled():
        error = task.exception()
        if error is not None:
            traceback.print_exception(error)


def _dispose_entity_on_comm_close(_msg):
    if _closing or elephant_lab_entity is None:
        return
    _track_comm_task(asyncio.create_task(elephant_lab_entity.dispose()))


async def handle_comm_message(msg):

    if _closing:
        return
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
                _send_comm({
                    "type": "error",
                    "message": (
                        "Undefined comm message data type: "
                        f"{data.get('type')}"
                    ),
                })

    except Exception as error:
        traceback.print_exc()
        _send_comm({
            "type": "error",
            "message": str(error),
        })


async def configure_assistant(settings):
    try:
        if elephant_lab_entity is None:
            raise RuntimeError("The Elephant Lab instance is no longer available.")
        configuration = AssistantConfiguration.from_settings(settings)
        await shutdown()
        await initialize(elephant_lab_entity, configuration)
    except Exception as error:
        _send_comm({
            "type": "configuration_result",
            "ok": False,
            "message": str(traceback.format_exc()),
        })
        return

    _send_comm({
        "type": "configuration_result",
        "ok": True,
    })


async def handle_user_message(generation, message, include_selection):
    try:
        if elephant_lab_entity is None:
            raise RuntimeError("The Elephant Lab instance is no longer available.")
        if include_selection and elephant_lab_entity.has_selected_neo_objects():
            message += """\nMake sure to answer the question based on the selected objects in the current context."
            These objects already exist in the Kernel, but may have to be accessed through their parent which can be figured out by the metadata."
            You may also get the context of the surrounding objects of the selected objects."
            These are only so you can understand the context and the ones marked as selected should be prioritized."""
        # Run with conversation history.
        result = await run_agent(message)

        _send_comm({
            "type": "assistant_response",
            "generation": generation,
            "message": result.final_output,
        })
    except Exception as e:
        _send_comm({
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
    global comm, elephant_lab_entity, _listener_entity, _closing

    _closing = True
    current_comm = comm
    comm = None
    cleanup_errors = []

    if _listener_entity is not None:
        try:
            _listener_entity.on_selected_neo_objects_changed.remove_listener(
                on_selection_changed
            )
        except Exception as error:
            cleanup_errors.append(error)
        _listener_entity = None
    elephant_lab_entity = None

    current_task = asyncio.current_task()
    pending_tasks = [
        task for task in _comm_tasks
        if task is not current_task and not task.done()
    ]
    for task in pending_tasks:
        task.cancel()
    if pending_tasks:
        completed, pending = await asyncio.wait(
            pending_tasks,
            timeout=_COMM_CANCELLATION_TIMEOUT,
        )
        await asyncio.gather(*completed, return_exceptions=True)
        if pending:
            cleanup_errors.append(
                TimeoutError(
                    f"{len(pending)} assistant comm task(s) did not cancel in time."
                )
            )

    try:
        await shutdown()
    except Exception as error:
        cleanup_errors.append(error)
    finally:
        if current_comm is not None:
            try:
                current_comm.close()
            except Exception as error:
                cleanup_errors.append(error)

    if cleanup_errors:
        details = "; ".join(str(error) for error in cleanup_errors)
        raise RuntimeError(f"Assistant comm cleanup failed: {details}") from cleanup_errors[0]