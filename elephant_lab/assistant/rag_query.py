from llama_index.core import (
    Settings,
    StorageContext,
    load_index_from_storage,
)
from llama_index.embeddings.openai import OpenAIEmbedding
from .config import API_BASE, EMBEDDING_MODEL, API_KEY, PATH_TO_RAG_INDEX_STORAGE

from pydantic import BaseModel


# --------------------------------------------------
# Configure models
# --------------------------------------------------

Settings.embed_model = OpenAIEmbedding(
    model=EMBEDDING_MODEL,
    api_base=API_BASE,
    api_key=API_KEY,
)


# --------------------------------------------------
# Load existing index
# --------------------------------------------------

storage_context = StorageContext.from_defaults(
    persist_dir=str(PATH_TO_RAG_INDEX_STORAGE)
)

vector_index = load_index_from_storage(
    storage_context
)

retriever = vector_index.as_retriever(
    similarity_top_k=5
)
# Maybe increase the number of similarity_top_k (looks for semantic similarity) to 10 and then rerank (looks for actual relevance to the specific question (does by llm or specific neural model)) to 3, but for now just use 5


class RetrievedChunk(BaseModel):
    content: str
    score: float
    metadata: dict


def search_knowledge_base(question: str) -> list[RetrievedChunk]:
    nodes = retriever.retrieve(question)
    return [
        RetrievedChunk(
            content=node.get_content(),
            score=node.score or 0.0,
            metadata=node.metadata,
        )
        for node in nodes
    ]