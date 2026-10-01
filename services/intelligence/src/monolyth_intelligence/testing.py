"""Test doubles for code that calls the OpenAI embeddings API. Not used at runtime."""

import hashlib
import json
import math
import re

import httpx2
import openai

from monolyth_db import EMBEDDING_DIMENSIONS
from monolyth_intelligence.embed import EMBEDDING_MODEL


def fake_vector(text: str) -> list[float]:
    """Hashed bag of words, normalised: texts sharing words point in similar directions,
    so similarity search behaves meaningfully without a real model."""
    v = [0.0] * EMBEDDING_DIMENSIONS
    for word in re.findall(r"[a-z]+", text.lower()):
        v[int(hashlib.md5(word.encode()).hexdigest(), 16) % EMBEDDING_DIMENSIONS] += 1
    norm = math.sqrt(sum(x * x for x in v)) or 1
    return [x / norm for x in v]


class FakeOpenAI:
    def __init__(self, status=200):
        self.status = status
        self.batches: list[list[str]] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        assert request.url.path.endswith("/embeddings") and body["model"] == EMBEDDING_MODEL
        self.batches.append(body["input"])
        if self.status != 200:
            return httpx2.Response(self.status, json={"error": {"message": "nope", "type": "server_error"}})
        # Return items in reverse order to prove we sort by index
        data = [{"object": "embedding", "index": i, "embedding": fake_vector(t)} for i, t in enumerate(body["input"])]
        return httpx2.Response(
            200,
            json={"object": "list", "model": EMBEDDING_MODEL, "data": data[::-1], "usage": {"prompt_tokens": 1, "total_tokens": 1}},
        )

    def client(self) -> openai.OpenAI:
        return openai.OpenAI(
            api_key="sk-test",
            max_retries=0,
            http_client=openai.DefaultHttpx2Client(transport=httpx2.MockTransport(self.handler)),
        )
