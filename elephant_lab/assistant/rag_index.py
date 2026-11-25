from llama_index.core import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    Settings,
)

from llama_index.core.node_parser import TokenTextSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from config import API_BASE, EMBEDDING_MODEL, API_KEY, PATH_TO_RAG_INDEX_DATA, PATH_TO_RAG_INDEX_STORAGE


# --------------------------------------------------
# Configure embedding model
# --------------------------------------------------

Settings.embed_model = OpenAIEmbedding(
    model=EMBEDDING_MODEL,
    api_base=API_BASE,
    api_key=API_KEY,
)


# --------------------------------------------------
# Load documents
# --------------------------------------------------

documents = SimpleDirectoryReader(
    str(PATH_TO_RAG_INDEX_DATA)
).load_data()


# --------------------------------------------------
# Chunk documents
# --------------------------------------------------

node_parser = TokenTextSplitter(
    chunk_size=512,
    chunk_overlap=50,
)

nodes = node_parser.get_nodes_from_documents(documents)


# --------------------------------------------------
# Build vector index
# --------------------------------------------------

vector_index = VectorStoreIndex(nodes)


# --------------------------------------------------
# Persist index
# --------------------------------------------------

vector_index.storage_context.persist(
    persist_dir=str(PATH_TO_RAG_INDEX_STORAGE)
)