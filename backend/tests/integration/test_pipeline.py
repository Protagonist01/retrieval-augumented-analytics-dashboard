from unittest.mock import AsyncMock, MagicMock

import pytest

from src.pipeline.executor import QueryExecutor, QueryTimeoutError
from src.pipeline.orchestrator import SSEEvent, run_query
from src.pipeline.sql_validator import SqlValidator


async def collect_events(gen) -> list[SSEEvent]:
    events = []
    async for event in gen:
        events.append(event)
    return events


@pytest.mark.asyncio
async def test_happy_path(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    sql_generator.generate.return_value = "SELECT * FROM orders LIMIT 2"

    sql_validator = SqlValidator()

    executor = QueryExecutor(mock_settings)
    executor._get_connection = MagicMock(return_value=in_memory_duckdb)

    explainer = AsyncMock()

    async def mock_stream(question, sql, result_summary):
        yield "This "
        yield "is "
        yield "working."

    explainer.stream = mock_stream

    events = await collect_events(
        run_query(
            "Show orders",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "sql" in types
    assert "meta" in types
    assert "row" in types
    assert "token" in types
    assert "done" in types

    # Assert sql comes before rows
    sql_idx = types.index("sql")
    row_idx = types.index("row")
    assert sql_idx < row_idx


@pytest.mark.asyncio
async def test_self_correction_success(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    # First returns invalid, second returns valid
    sql_generator.generate.side_effect = [
        "SELECT fake_col FROM orders",
        "SELECT order_id FROM orders LIMIT 1",
    ]

    sql_validator = SqlValidator()

    executor = QueryExecutor(mock_settings)
    executor._get_connection = MagicMock(return_value=in_memory_duckdb)

    explainer = AsyncMock()

    async def mock_stream(question, sql, result_summary):
        yield "OK"

    explainer.stream = mock_stream

    events = await collect_events(
        run_query(
            "Show order_id",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "sql" in types
    assert "done" in types
    assert "error" not in types

    # Second generated query was actually executed
    sql_evt = next(e for e in events if e.type == "sql")
    assert sql_evt.data["sql"] == "SELECT order_id FROM orders LIMIT 1"


@pytest.mark.asyncio
async def test_self_correction_failure(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    # Both fail validation
    sql_generator.generate.return_value = "SELECT fake_col FROM orders"

    sql_validator = SqlValidator()

    executor = QueryExecutor(mock_settings)
    executor._get_connection = MagicMock(return_value=in_memory_duckdb)

    explainer = AsyncMock()

    events = await collect_events(
        run_query(
            "Show orders",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "error" in types
    assert "done" not in types
    error_evt = next(e for e in events if e.type == "error")
    assert error_evt.data["code"] == "validation_error"


@pytest.mark.asyncio
async def test_safety_rejection(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    sql_generator.generate.return_value = "DROP TABLE orders"

    sql_validator = SqlValidator()

    executor = QueryExecutor(mock_settings)
    executor._get_connection = MagicMock(return_value=in_memory_duckdb)

    explainer = AsyncMock()

    events = await collect_events(
        run_query(
            "Delete orders table",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "error" in types
    assert "done" not in types
    error_evt = next(e for e in events if e.type == "error")
    assert error_evt.data["code"] == "validation_error"


@pytest.mark.asyncio
async def test_query_timeout(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    sql_generator.generate.return_value = "SELECT * FROM orders"

    sql_validator = SqlValidator()

    executor = AsyncMock()
    executor.execute.side_effect = QueryTimeoutError("Query timed out")

    explainer = AsyncMock()

    events = await collect_events(
        run_query(
            "Slow query",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "error" in types
    assert "done" not in types
    error_evt = next(e for e in events if e.type == "error")
    assert error_evt.data["code"] == "timeout"


@pytest.mark.asyncio
async def test_empty_results(mock_settings, in_memory_duckdb, schema_context, mock_redis):
    schema_retriever = AsyncMock()
    schema_retriever.get_context.return_value = schema_context

    sql_generator = AsyncMock()
    # Where clause returns nothing
    sql_generator.generate.return_value = "SELECT * FROM orders WHERE total_amount < 0"

    sql_validator = SqlValidator()

    executor = QueryExecutor(mock_settings)
    executor._get_connection = MagicMock(return_value=in_memory_duckdb)

    explainer = AsyncMock()

    async def mock_stream(question, sql, result_summary):
        yield "None"

    explainer.stream = mock_stream

    events = await collect_events(
        run_query(
            "Show cheap orders",
            mock_settings,
            schema_retriever,
            sql_generator,
            sql_validator,
            executor,
            explainer,
            mock_redis,
        )
    )

    types = [e.type for e in events]
    assert "meta" in types
    assert "done" in types

    meta_evt = next(e for e in events if e.type == "meta")
    assert meta_evt.data["row_count"] == 0
