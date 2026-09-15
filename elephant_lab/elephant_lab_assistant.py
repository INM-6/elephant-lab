import requests
import json
from ipykernel.comm import Comm
from .config import API_KEY


class ChatCompletions:

    url = "https://api.blablador.fz-juelich.de/v1/chat/completions"

    def __init__(
        self,
        api_key,
        model,
        system_prompt=None,
        temperature=0.7,
        choices=1,
        max_tokens=100,
        user="default",
        top_p=1,
        presence_penalty=0,
        frequency_penalty=0,
        max_messages=None,
    ):
        self.api_key = api_key
        self.model = model
        self.user = user

        self.temperature = temperature
        self.choices = choices
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.presence_penalty = presence_penalty
        self.frequency_penalty = frequency_penalty

        # Maximum number of messages retained in the conversation.
        # None = unlimited.
        self.max_messages = max_messages

        self.headers = {
            "accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        # -----------------------------------------------------
        # The conversation belongs to this object.
        # -----------------------------------------------------

        self.messages = []

        if system_prompt is not None:
            self.messages.append({
                "role": "system",
                "content": system_prompt,
            })

    # =========================================================
    # Low-level API call
    # =========================================================

    def get_completion(
        self,
        messages=None,
        temperature=None,
        max_tokens=None,
        choices=None,
        top_p=None,
        presence_penalty=None,
        frequency_penalty=None,
        response_format=None,
        tools=None,
        tool_choice=None,
        stream=False,
    ):
        """
        Make a raw Chat Completions API request.

        This method does NOT modify conversation history.

        If messages=None, the current conversation is used.
        """

        if messages is None:
            messages = self.messages

        payload = {
            "model": self.model,
            "messages": messages,
        }
        """
            "temperature": (
                self.temperature
                if temperature is None
                else temperature
            ),
            "max_tokens": (
                self.max_tokens
                if max_tokens is None
                else max_tokens
            ),
            "n": (
                self.choices
                if choices is None
                else choices
            ),
            "top_p": (
                self.top_p
                if top_p is None
                else top_p
            ),
            "presence_penalty": (
                self.presence_penalty
                if presence_penalty is None
                else presence_penalty
            ),
            "frequency_penalty": (
                self.frequency_penalty
                if frequency_penalty is None
                else frequency_penalty
            ),
            "stream": stream,
        }
        """

        if response_format is not None:
            payload["response_format"] = response_format

        if tools is not None:
            payload["tools"] = tools

        if tool_choice is not None:
            payload["tool_choice"] = tool_choice

        response = requests.post(
            url=self.url,
            headers=self.headers,
            json=payload,
            timeout=120,
        )

        response.raise_for_status()

        return response.json()

    # =========================================================
    # Normal conversation
    # =========================================================

    def send(self, message, **kwargs):
        """
        Add a user message, send the complete conversation to
        the model, and add the assistant response to history.
        """

        self.messages.append({
            "role": "user",
            "content": message,
        })

        response = self.get_completion(
            messages=self.messages,
            **kwargs,
        )

        assistant_message = response["choices"][0]["message"]

        self.messages.append(assistant_message)

        self._manage_context()

        return response

    # =========================================================
    # Add arbitrary messages
    # =========================================================

    def add_message(self, role, content):
        """
        Manually add a message to the conversation.

        Useful for:
        - user messages
        - assistant messages
        - system messages
        - tool messages
        """

        self.messages.append({
            "role": role,
            "content": content,
        })

        self._manage_context()

    # =========================================================
    # External context
    # =========================================================

    def add_context(self, context):
        """
        Add external context to the conversation.

        This is useful for RAG, documents, database results,
        retrieved information, etc.
        """

        self.messages.append({
            "role": "system",
            "content": (
                "Additional context for this conversation:\n\n"
                f"{context}"
            ),
        })

        self._manage_context()

    # =========================================================
    # Ask using temporary context
    # =========================================================

    def send_with_context(self, message, context, **kwargs):
        """
        Send a message with external context without permanently
        adding the context to the conversation history.

        Useful when retrieved documents should only apply to
        one particular question.
        """

        messages = list(self.messages)

        messages.append({
            "role": "user",
            "content": (
                "Use the following context to answer the question.\n\n"
                "----- CONTEXT -----\n"
                f"{context}\n"
                "----- END CONTEXT -----\n\n"
                f"Question: {message}"
            ),
        })

        response = self.get_completion(
            messages=messages,
            **kwargs,
        )

        # Only the actual conversation interaction is retained.
        self.messages.append({
            "role": "user",
            "content": message,
        })

        self.messages.append(
            response["choices"][0]["message"]
        )

        self._manage_context()

        return response

    # =========================================================
    # Few-shot examples
    # =========================================================

    def add_example(self, user_message, assistant_message):
        """
        Add a few-shot example to the conversation.

        Example:

            chat.add_example(
                "Classify: SQL query is slow",
                "database"
            )
        """

        self.messages.append({
            "role": "user",
            "content": user_message,
        })

        self.messages.append({
            "role": "assistant",
            "content": assistant_message,
        })

        self._manage_context()

    # =========================================================
    # JSON
    # =========================================================

    def send_json(self, message, **kwargs):
        """
        Request a JSON response.

        Requires backend/model support for response_format.
        """

        return self.send(
            message,
            response_format={
                "type": "json_object"
            },
            **kwargs,
        )

    # =========================================================
    # Context management
    # =========================================================

    def _manage_context(self):
        """
        Manage the conversation length.

        This example uses message count rather than token count.
        """

        if self.max_messages is None:
            return

        if len(self.messages) <= self.max_messages:
            return

        system_messages = [
            m for m in self.messages
            if m.get("role") == "system"
        ]

        other_messages = [
            m for m in self.messages
            if m.get("role") != "system"
        ]

        remaining = self.max_messages - len(system_messages)

        self.messages = (
            system_messages[:1]
            + other_messages[-remaining:]
        )

    # =========================================================
    # Conversation management
    # =========================================================

    def clear(self):
        """
        Clear conversation history while keeping the system prompt.
        """

        system_messages = [
            m for m in self.messages
            if m.get("role") == "system"
        ]

        self.messages = system_messages[:1]

    def get_messages(self):
        """
        Return a copy of the current conversation.
        """

        return list(self.messages)

    def get_last_response(self):
        """
        Return the last assistant message, if available.
        """

        for message in reversed(self.messages):

            if message.get("role") == "assistant":
                return message

        return None

    # =========================================================
    # Response helpers
    # =========================================================

    @staticmethod
    def get_text(response, choice=0):
        return response["choices"][choice]["message"]["content"]

    @staticmethod
    def repr_response(response):
        return json.dumps(
            response,
            indent=2,
            ensure_ascii=False,
        )


# =============================================================
# Jupyter Comm
# =============================================================

comm = None
chat_completions = None
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
    global chat_completions

    comm = Comm(
        target_name="assistant_channel"
    )

    # ONE object = ONE conversation
    chat_completions = ChatCompletions(
        api_key=API_KEY,
        model="alias-fast",
        system_prompt=(
            "You are a helpful assistant. "
            "Maintain consistency with the conversation."
        ),
        temperature=0.7,
        max_tokens=500,
        max_messages=30,
    )

    comm.on_msg(
        lambda msg: handle_comm_message(msg)
    )

    global elephant_lab_entity
    elephant_lab_entity = _elephant_lab_entity
    elephant_lab_entity.on_selected_neo_objects_changed.add_listener(on_selection_changed)

    return comm


def handle_comm_message(msg):

    try:

        data = msg["content"]["data"]

        match data.get("type"):

            case "user_message":
                handle_user_message(
                    data.get("generation"),
                    data.get("message"),
                    data.get("include_selection"),
                )

            case "clear_context":
                clear_conversation()

            case _:
                comm.send({
                    "type": "error",
                    "message": (
                        "Undefined comm message data type: "
                        f"{data.get('type')}"
                    ),
                })

    except Exception as e:

        comm.send({
            "type": "error",
            "message": str(e),
        })


def handle_user_message(generation, message, include_selection):

    if include_selection and elephant_lab_entity.has_selected_neo_objects():
        context = elephant_lab_entity.get_selected_neo_metadata()

        comm.send({
            "type": "error",
            "message": context,
        })

        response = chat_completions.send_with_context(
            message,
            context
        )
    else:
        response = chat_completions.send(
            message
        )

    comm.send({
        "type": "assistant_response",
        "generation": generation,
        "message": chat_completions.get_text(response),
    })


def clear_conversation():

    chat_completions.clear()

    """
    comm.send({
        "type": "context_cleared",
    })
    """


def close_assistant_comm():

    global comm

    if comm is not None:
        comm.close()
        comm = None