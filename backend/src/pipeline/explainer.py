import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from openai import AsyncOpenAI

from src.config import Settings
from src.metrics import llm_tokens_used_total

logger = logging.getLogger("raa.explainer")


class ExplanationStreamer:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def stream(
        self, question: str, sql: str, result_summary: dict[str, Any]
    ) -> AsyncIterator[str]:
        columns = result_summary.get("columns", [])
        rows = result_summary.get("preview_rows", [])
        row_count = result_summary.get("row_count", 0)

        preview = f"Columns: {columns}\nRows:\n" + "\n".join(str(r) for r in rows)

        system_content = (
            "You are a data analyst. Given a natural language question, a SQL query that "
            "was run, and a preview of the results, write a 2-3 sentence plain English "
            "explanation of what the data shows. Be specific about the numbers. "
            "Do not repeat the question verbatim."
        )

        user_content = (
            f"Question: {question}\n"
            f"SQL: {sql}\n"
            f"Total rows returned: {row_count}\n"
            f"Results preview (first {len(rows)} rows):\n"
            f"{preview}"
        )

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

        token_count = 0

        if self.settings.llm_provider == "openai":
            api_key = self.settings.openai_compatible_api_key
            if not api_key or api_key == "sk-...":
                logger.warning("Using mock explanation streamer because OPENAI_API_KEY is not set.")
                mock_explanation = self._get_mock_explanation(question, result_summary)
                for word in mock_explanation.split(" "):
                    await asyncio.sleep(0.05)
                    yield word + " "
                    token_count += 1
            else:
                client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=self.settings.openai_base_url,
                    default_headers=self.settings.openai_compatible_headers,
                )
                try:
                    response_stream = await client.chat.completions.create(
                        model=self.settings.openai_model,
                        messages=messages,  # type: ignore
                        temperature=0.3,
                        max_tokens=256,
                        stream=True,
                    )
                    async for chunk in response_stream:
                        token = chunk.choices[0].delta.content
                        if token:
                            yield token
                            token_count += 1
                except Exception as e:
                    logger.error(f"OpenAI explanation stream failed: {e}")
                    yield f"Error generating explanation: {e}"

        elif self.settings.llm_provider == "ollama":
            try:
                # Use httpx to stream response from Ollama API
                async with httpx.AsyncClient() as client:
                    async with client.stream(
                        "POST",
                        f"{self.settings.ollama_base_url}/api/chat",
                        json={
                            "model": self.settings.ollama_model,
                            "messages": messages,
                            "stream": True,
                            "options": {"temperature": 0.3},
                        },
                        timeout=30.0,
                    ) as response:
                        response.raise_for_status()
                        async for line in response.iter_lines():
                            if line.strip():
                                data = json.loads(line)
                                token = data.get("message", {}).get("content", "")
                                if token:
                                    yield token
                                    token_count += 1
            except Exception as e:
                logger.error(f"Ollama explanation stream failed: {e}")
                yield f"Error generating explanation: {e}"

        # Increment metric
        llm_tokens_used_total.labels(stage="explainer").inc(token_count)

    def _get_mock_explanation(self, question: str, result_summary: dict[str, Any]) -> str:
        rows = result_summary.get("preview_rows", [])
        row_count = result_summary.get("row_count", 0)

        if not rows:
            return f"The query returned no results for your question about '{question}'."

        # Generates a basic mock explanation depending on the table columns
        first_row = rows[0]

        # Build explanation description
        desc = f"The query successfully retrieved {row_count} rows of data. "
        if len(first_row) >= 2:
            desc += f"The top result is '{first_row[0]}' with a value of {first_row[1]}. "
        else:
            desc += f"The first returned value is {first_row[0]}. "
        desc += "This answers your natural language question based on the e-commerce database."
        return desc


async def explain_result(
    question: str, sql: str, result_summary: dict[str, Any]
) -> AsyncIterator[str]:
    from src.config import settings

    streamer = ExplanationStreamer(settings)
    async for token in streamer.stream(question, sql, result_summary):
        yield token
