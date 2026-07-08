import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import redis.asyncio as aioredis

from src.config import Settings
from src.metrics import (
    query_cache_hits_total,
    query_duration_seconds,
    self_correction_total,
    sql_validation_failures_total,
)
from src.pipeline.executor import QueryExecutionError, QueryTimeoutError

logger = logging.getLogger("raa.orchestrator")


@dataclass
class SSEEvent:
    type: str
    data: dict[str, Any]


async def run_query(
    question: str,
    settings: Settings,
    schema_retriever: Any,
    sql_generator: Any,
    sql_validator: Any,
    executor: Any,
    explainer: Any,
    redis_client: aioredis.Redis | None = None,
    sql_override: str | None = None,
) -> AsyncIterator[SSEEvent]:
    total_start = time.perf_counter()
    question_clean = question.strip().lower()
    cache_basis = f"{question_clean}:{sql_override or ''}"
    question_hash = hashlib.md5(cache_basis.encode("utf-8")).hexdigest()
    cache_key = f"raa:query_cache:{question_hash}"

    # 1. Check Redis query cache
    if redis_client:
        try:
            cached_events = await redis_client.get(cache_key)
            if cached_events:
                query_cache_hits_total.labels(cache="query", result="hit").inc()
                events_list = json.loads(cached_events)
                logger.info("Replaying query results from Redis cache")
                for evt in events_list:
                    # Update cache flag in meta event
                    if evt["type"] == "meta":
                        evt["data"]["cached"] = True
                    yield SSEEvent(type=evt["type"], data=evt["data"])

                # Observe total duration
                total_duration = time.perf_counter() - total_start
                query_duration_seconds.labels(stage="total").observe(total_duration)
                return
            else:
                query_cache_hits_total.labels(cache="query", result="miss").inc()
        except Exception as e:
            logger.warning(f"Failed to fetch from query cache: {e}")

    events_to_cache = []

    def yield_and_collect(evt_type: str, data: dict[str, Any]):
        evt = SSEEvent(type=evt_type, data=data)
        events_to_cache.append({"type": evt_type, "data": data})
        return evt

    # 2. Get schema context
    schema_start = time.perf_counter()
    try:
        schema_context = await schema_retriever.get_context(question)
    except Exception as e:
        logger.error(f"Failed to retrieve schema context: {e}")
        yield SSEEvent(
            "error", {"code": "schema_error", "message": f"Schema retrieval failed: {e}"}
        )
        return
    query_duration_seconds.labels(stage="validation").observe(time.perf_counter() - schema_start)

    # 3. Generate SQL, or use a user-edited SQL override.
    sql_start = time.perf_counter()
    if sql_override:
        sql = sql_override
    else:
        try:
            sql = await sql_generator.generate(question, schema_context)
        except Exception as e:
            logger.error(f"SQL generation failed: {e}")
            yield SSEEvent(
                "error", {"code": "generation_error", "message": f"SQL generation failed: {e}"}
            )
            return

    # 4. Validate SQL
    val_start = time.perf_counter()
    validation_result = sql_validator.validate(sql, schema_context)
    query_duration_seconds.labels(stage="validation").observe(time.perf_counter() - val_start)

    self_corrected = False
    if not validation_result.ok and sql_override:
        sql_validation_failures_total.labels(reason=validation_result.stage or "unknown").inc()
        yield SSEEvent(
            "error",
            {
                "code": "validation_error",
                "message": validation_result.error or "Edited SQL failed validation",
            },
        )
        return

    if not validation_result.ok:
        sql_validation_failures_total.labels(reason=validation_result.stage or "unknown").inc()
        logger.warning(
            f"SQL validation failed: {validation_result.error}. Attempting self-correction..."
        )

        # Self-correction attempt
        self_corrected = True
        try:
            sql = await sql_generator.generate(
                question, schema_context, error=validation_result.error
            )
        except Exception as e:
            logger.error(f"SQL regeneration failed: {e}")
            yield SSEEvent(
                "error", {"code": "generation_error", "message": f"SQL regeneration failed: {e}"}
            )
            return

        # Re-validate
        val_start2 = time.perf_counter()
        validation_result = sql_validator.validate(sql, schema_context)
        query_duration_seconds.labels(stage="validation").observe(time.perf_counter() - val_start2)

        if not validation_result.ok:
            self_correction_total.labels(outcome="failure").inc()
            logger.error(f"Self-correction failed: {validation_result.error}")
            yield SSEEvent(
                "error",
                {
                    "code": "validation_error",
                    "message": validation_result.error or "Validation failed",
                },
            )
            return

        self_correction_total.labels(outcome="success").inc()
        logger.info("Self-correction succeeded!")
    elif self_corrected:
        self_correction_total.labels(outcome="success").inc()

    # Observe text-to-sql total latency
    query_duration_seconds.labels(stage="llm_text_to_sql").observe(time.perf_counter() - sql_start)

    # 5. Yield the SQL event
    yield yield_and_collect("sql", {"sql": sql})

    # 6. Execute SQL
    exec_start = time.perf_counter()
    try:
        execution_result = await executor.execute(sql)
    except QueryTimeoutError as e:
        yield SSEEvent("error", {"code": "timeout", "message": str(e)})
        return
    except QueryExecutionError as e:
        yield SSEEvent("error", {"code": "execution_error", "message": str(e)})
        return
    except Exception as e:
        yield SSEEvent(
            "error", {"code": "execution_error", "message": f"Database execution error: {e}"}
        )
        return
    finally:
        query_duration_seconds.labels(stage="duckdb").observe(time.perf_counter() - exec_start)

    # Fetch column types from executor mapping if needed, or build default types
    # DuckDB returns column names, so map types from matching schema columns.
    col_types = {}
    schema_cols = {c.name.lower(): c.type for t in schema_context.tables for c in t.columns}
    for col in execution_result.columns:
        col_types[col] = schema_cols.get(col.lower(), "UNKNOWN")

    # 7. Yield metadata event
    yield yield_and_collect(
        "meta",
        {
            "row_count": execution_result.row_count,
            "columns": execution_result.columns,
            "column_types": col_types,
            "duration_ms": execution_result.duration_ms,
            "cached": False,
        },
    )

    # 8. Yield row events
    for row in execution_result.rows:
        yield yield_and_collect("row", {"row": row})

    # 9. Yield explanation tokens
    exp_start = time.perf_counter()
    # Build summary for explainer
    result_summary = {
        "row_count": execution_result.row_count,
        "columns": execution_result.columns,
        "preview_rows": execution_result.rows[:5],
    }

    explanation_text = ""
    try:
        async for token in explainer.stream(question, sql, result_summary):
            explanation_text += token
            yield yield_and_collect("token", {"token": token})
    except Exception as e:
        logger.error(f"Error streaming explanation: {e}")
        yield yield_and_collect("token", {"token": f"Error generating explanation: {e}"})
    finally:
        query_duration_seconds.labels(stage="llm_explainer").observe(
            time.perf_counter() - exp_start
        )

    # 10. Yield done event
    yield yield_and_collect("done", {})

    # 11. Cache results in Redis
    if redis_client:
        try:
            # Save to Redis
            await redis_client.set(
                cache_key, json.dumps(events_to_cache), ex=settings.query_cache_ttl_seconds
            )
            logger.info("Query results successfully cached to Redis")
        except Exception as e:
            logger.warning(f"Failed to cache query results in Redis: {e}")

    # Observe total duration
    total_duration = time.perf_counter() - total_start
    query_duration_seconds.labels(stage="total").observe(total_duration)
