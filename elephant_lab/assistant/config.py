from collections.abc import Mapping
from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class AssistantConfiguration:
    api_base: str
    api_key: str
    model: str

    @classmethod
    def from_settings(cls, settings: object) -> "AssistantConfiguration":
        if not isinstance(settings, Mapping):
            raise ValueError("Assistant configuration must be an object.")

        values = {
            "apiUrl": cls._resolve_setting(settings, "apiUrl"),
            "apiKey": cls._resolve_setting(settings, "apiKey"),
            "model": cls._resolve_setting(settings, "model"),
        }
        parsed_url = urlparse(values["apiUrl"])
        if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
            raise ValueError("Assistant API URL must be a valid HTTP or HTTPS URL.")

        return cls(
            api_base=values["apiUrl"],
            api_key=values["apiKey"],
            model=values["model"],
        )

    @staticmethod
    def _resolve_setting(settings: Mapping, name: str) -> str:
        setting = settings.get(name)
        if not isinstance(setting, Mapping):
            raise ValueError(f"Assistant {name} configuration is missing.")

        value = setting.get("value")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Enter a value for assistant {name}.")
        value = value.strip()

        source = setting.get("source")
        if source == "environment":
            value = os.environ.get(value)
            if not value:
                raise ValueError(f"Environment variable for assistant {name} is not set.")
            value = value.strip()
            if not value:
                raise ValueError(f"Environment variable for assistant {name} is empty.")
        elif source != "value":
            raise ValueError(
                f"Assistant {name} source must be a direct value or environment variable."
            )

        return value


# The retrieval subprocess reads these values from its environment.
API_BASE = os.getenv("ELEPHANT_LAB_API_BASE", "https://api.blablador.fz-juelich.de/v1")
API_KEY = os.getenv("ELEPHANT_LAB_API_KEY")
CONTEXT_WINDOW = 131072
EMBEDDING_MODEL = "text-embedding-ada-002"

# Directory containing config.py
ASSISTANT_DIR = Path(__file__).resolve().parent
PATH_TO_RAG_INDEX_DATA = ASSISTANT_DIR / "data"
PATH_TO_RAG_INDEX_STORAGE = ASSISTANT_DIR / "storage"
PATH_TO_MCP_SERVER = "elephant_lab.assistant.mcp_server"

MAX_AGENT_RUNS = 50
MCP_SERVER_TIMEOUT = 60