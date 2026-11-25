from pathlib import Path

API_BASE = "https://api.blablador.fz-juelich.de/v1"
CHAT_COMPLETION_MODEL = "alias-large"
CONTEXT_WINDOW = 131072
EMBEDDING_MODEL = "text-embedding-ada-002"

# Directory containing config.py
ASSISTANT_DIR = Path(__file__).resolve().parent
PATH_TO_RAG_INDEX_DATA = ASSISTANT_DIR / "data"
PATH_TO_RAG_INDEX_STORAGE = ASSISTANT_DIR / "storage"
PATH_TO_MCP_SERVER = "elephant_lab.assistant.mcp_server"

MAX_AGENT_RUNS = 50
MCP_SERVER_TIMEOUT = 60

import os
try:
    API_KEY = os.getenv("ELEPHANT_LAB_API_KEY")
except:
    API_KEY = None
if not API_KEY:
    raise ValueError("API_KEY is not configured")