import json
import logging
import re
from pathlib import Path

import httpx
from openai import AsyncOpenAI

from src.config import Settings
from src.metrics import llm_tokens_used_total
from src.pipeline.schema_retriever import SchemaContext

logger = logging.getLogger("raa.text_to_sql")


class TextToSqlGenerator:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.few_shots: list[dict[str, str]] = []
        self._load_few_shots()

    def _load_few_shots(self):
        few_shots_path = Path(__file__).parent / "few_shots" / "ecommerce.jsonl"
        if few_shots_path.exists():
            try:
                with open(few_shots_path, encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            self.few_shots.append(json.loads(line))
                logger.info(f"Loaded {len(self.few_shots)} few-shot examples")
            except Exception as e:
                logger.error(f"Failed to load few-shots from {few_shots_path}: {e}")
        else:
            logger.warning(f"Few-shots file not found at {few_shots_path}")

    def _build_prompt(
        self, question: str, schema_context: SchemaContext, error: str | None = None
    ) -> list[dict[str, str]]:
        schema_text = schema_context.get_prompt_text()

        system_content = (
            "You are a SQL expert for a DuckDB analytics database.\n"
            "Generate only valid DuckDB SELECT SQL. No markdown, no explanation, "
            "no comments. Just the SQL query itself.\n\n"
            "Here is the database schema:\n"
            f"{schema_text}"
        )

        messages = [{"role": "system", "content": system_content}]

        # Add few-shot examples
        for example in self.few_shots:
            messages.append({"role": "user", "content": example["nl"]})
            messages.append({"role": "assistant", "content": example["sql"]})

        # Add the current question
        user_content = question
        if error:
            user_content += (
                f"\nYour previous attempt had this error: {error}. "
                "Please fix the query and try again."
            )

        messages.append({"role": "user", "content": user_content})
        return messages

    async def generate(self, question: str, schema: SchemaContext, error: str | None = None) -> str:
        messages = self._build_prompt(question, schema, error)
        sql_response = ""

        if self.settings.llm_provider == "openai":
            api_key = self.settings.openai_compatible_api_key
            if not api_key or api_key == "sk-...":
                logger.warning("Using mock OpenAI-compatible response because API key is not set.")
                sql_response = self._get_mock_sql_for_question(question)
            else:
                client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=self.settings.openai_base_url,
                    default_headers=self.settings.openai_compatible_headers,
                )
                try:
                    response = await client.chat.completions.create(
                        model=self.settings.openai_model,
                        messages=messages,  # type: ignore
                        temperature=0.0,
                        max_tokens=self.settings.openai_max_tokens,
                    )
                    sql_response = response.choices[0].message.content or ""
                    if response.usage:
                        llm_tokens_used_total.labels(stage="text_to_sql").inc(
                            response.usage.total_tokens
                        )
                except Exception as e:
                    logger.error(f"OpenAI completion failed: {e}")
                    raise
        elif self.settings.llm_provider == "ollama":
            try:
                async with httpx.AsyncClient() as client:
                    res = await client.post(
                        f"{self.settings.ollama_base_url}/api/chat",
                        json={
                            "model": self.settings.ollama_model,
                            "messages": messages,
                            "stream": False,
                            "options": {"temperature": 0.0},
                        },
                        timeout=30.0,
                    )
                    res.raise_for_status()
                    data = res.json()
                    sql_response = data["message"]["content"]
                    prompt_tokens = data.get("prompt_eval_count", 0)
                    completion_tokens = data.get("eval_count", 0)
                    llm_tokens_used_total.labels(stage="text_to_sql").inc(
                        prompt_tokens + completion_tokens
                    )
            except Exception as e:
                logger.error(f"Ollama completion failed: {e}")
                raise

        # Clean the response
        cleaned_sql = self._clean_sql(sql_response)
        logger.info(f"Generated SQL: {cleaned_sql}")
        return cleaned_sql

    def _clean_sql(self, sql: str) -> str:
        # Match ```sql ... ``` or ``` ... ```
        match = re.search(r"```(?:sql)?\s*(.*?)\s*```", sql, re.DOTALL | re.IGNORECASE)
        if match:
            sql = match.group(1)
        # Remove any leading/trailing whitespace or backticks
        sql = sql.replace("`", "")
        return sql.strip()

    def _get_mock_sql_for_question(self, question: str) -> str:
        # Return few-shot mappings or fallback SQL if openai key is missing (for safety / testing)
        q = question.lower()
        if "category" in q and "revenue" in q:
            return (
                "SELECT p.category, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue "
                "FROM order_items oi JOIN products p ON oi.product_id = p.product_id "
                "JOIN orders o ON oi.order_id = o.order_id WHERE o.status = 'completed' "
                "GROUP BY p.category ORDER BY revenue DESC LIMIT 1"
            )
        if "monthly" in q or "month" in q:
            return (
                "SELECT STRFTIME(order_date, '%Y-%m') AS month, COUNT(*) AS order_count "
                "FROM orders WHERE YEAR(order_date) = 2024 GROUP BY month ORDER BY month"
            )
        if "customer" in q and "spend" in q:
            return (
                "SELECT c.name, c.email, ROUND(SUM(o.total_amount), 2) AS total_spend "
                "FROM orders o JOIN customers c ON o.customer_id = c.customer_id "
                "WHERE o.status = 'completed' GROUP BY c.customer_id, c.name, c.email "
                "ORDER BY total_spend DESC LIMIT 10"
            )
        if "average order value" in q or "avg order value" in q:
            return (
                "SELECT c.country, ROUND(AVG(o.total_amount), 2) AS avg_order_value, "
                "COUNT(*) AS order_count FROM orders o JOIN customers c "
                "ON o.customer_id = c.customer_id WHERE o.status = 'completed' "
                "GROUP BY c.country ORDER BY avg_order_value DESC"
            )
        if "cancel" in q or "return" in q:
            return (
                "SELECT STRFTIME(order_date, '%Y-%m') AS month, "
                "ROUND(100.0 * COUNT(CASE WHEN status IN ('cancelled','returned') "
                "THEN 1 END) / COUNT(*), 1) AS pct_cancelled_or_returned "
                "FROM orders WHERE YEAR(order_date) = 2024 GROUP BY month ORDER BY month"
            )

        # Simple fallback
        return "SELECT * FROM orders LIMIT 10"


async def generate_sql(question: str, schema: SchemaContext, error: str | None = None) -> str:
    # Use standard default settings
    from src.config import settings

    gen = TextToSqlGenerator(settings)
    return await gen.generate(question, schema, error)
