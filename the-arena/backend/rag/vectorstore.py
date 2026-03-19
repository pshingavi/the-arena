"""
ChromaDB vector store for per-guest RAG retrieval.
Each guest gets their own collection for targeted retrieval.
"""

import os
import warnings
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions
from typing import List, Dict, Optional
import hashlib

# Suppress noisy SyntaxWarnings from sentence_transformers internals
warnings.filterwarnings("ignore", category=SyntaxWarning, module="sentence_transformers")


class ArenaVectorStore:
    def __init__(self, persist_dir: str = "./chroma_db"):
        self.persist_dir = persist_dir
        os.makedirs(persist_dir, exist_ok=True)

        # Disable ChromaDB telemetry — stops the "capture() takes 1 positional argument"
        # spam that appears when ChromaDB tries to phone home
        self.client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False)
        )

        # Use sentence-transformers for embeddings (free, runs locally)
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )

        self._collections: Dict[str, chromadb.Collection] = {}
        print("✅ ChromaDB vector store initialized")

    def _collection_name(self, guest: str) -> str:
        """Sanitize guest name to valid collection name."""
        sanitized = guest.lower().replace(" ", "_").replace(".", "").replace("-", "_")
        sanitized = "".join(c for c in sanitized if c.isalnum() or c == "_")
        # ChromaDB collection names must be 3-63 chars
        return sanitized[:63] if len(sanitized) >= 3 else f"guest_{sanitized}"

    def get_or_create_collection(self, guest: str) -> chromadb.Collection:
        """Get or create a collection for a guest."""
        name = self._collection_name(guest)
        if name not in self._collections:
            self._collections[name] = self.client.get_or_create_collection(
                name=name,
                embedding_function=self.embedding_fn,
                metadata={"guest": guest}
            )
        return self._collections[name]

    def index_guest(self, guest_data: Dict) -> int:
        """Index all chunks for a guest. Returns number of chunks indexed."""
        guest = guest_data["guest"]
        chunks = guest_data.get("chunks", [])

        if not chunks:
            return 0

        collection = self.get_or_create_collection(guest)

        # Skip if already indexed
        existing = collection.count()
        if existing > 0:
            return existing

        documents = []
        metadatas = []
        ids = []

        for i, chunk in enumerate(chunks):
            text = chunk.get("text", "").strip()
            if not text or len(text) < 50:
                continue

            # Create deterministic ID
            chunk_id = hashlib.md5(f"{guest}_{i}_{text[:50]}".encode()).hexdigest()

            documents.append(text)
            metadatas.append({
                "guest": guest,
                "speaker": chunk.get("speaker", guest),
                "chunk_type": chunk.get("chunk_type", "individual"),
                "turn_index": chunk.get("turn_index", i),
                "title": guest_data.get("title", ""),
                "date": guest_data.get("date", ""),
                "tags": ",".join(guest_data.get("tags", [])) if isinstance(guest_data.get("tags"), list) else str(guest_data.get("tags", ""))
            })
            ids.append(chunk_id)

        if documents:
            # Batch insert in chunks of 100
            batch_size = 100
            for j in range(0, len(documents), batch_size):
                collection.add(
                    documents=documents[j:j+batch_size],
                    metadatas=metadatas[j:j+batch_size],
                    ids=ids[j:j+batch_size]
                )

        return len(documents)

    def retrieve(self, guest: str, query: str, n_results: int = 5) -> List[Dict]:
        """Retrieve top-k relevant chunks for a guest given a query."""
        try:
            collection = self.get_or_create_collection(guest)
            if collection.count() == 0:
                return []

            results = collection.query(
                query_texts=[query],
                n_results=min(n_results, collection.count())
            )

            chunks = []
            if results and results["documents"] and results["documents"][0]:
                for doc, meta, dist in zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["distances"][0]
                ):
                    chunks.append({
                        "text": doc,
                        "metadata": meta,
                        "relevance_score": 1 - dist  # Convert distance to similarity
                    })

            return sorted(chunks, key=lambda x: x["relevance_score"], reverse=True)
        except Exception as e:
            print(f"Retrieval error for {guest}: {e}")
            return []

    def list_guests(self) -> List[str]:
        """List all indexed guests."""
        collections = self.client.list_collections()
        guests = []
        for col in collections:
            meta = col.metadata or {}
            if "guest" in meta:
                guests.append(meta["guest"])
        return guests

    def get_collection_stats(self) -> Dict:
        """Get stats on all collections."""
        collections = self.client.list_collections()
        stats = {}
        for col in collections:
            meta = col.metadata or {}
            guest = meta.get("guest", col.name)
            actual_col = self.client.get_collection(col.name, embedding_function=self.embedding_fn)
            stats[guest] = actual_col.count()
        return stats
