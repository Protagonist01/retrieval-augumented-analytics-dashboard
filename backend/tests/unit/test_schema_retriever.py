from unittest.mock import MagicMock

import pytest

from src.pipeline.schema_retriever import SchemaColumn, SchemaRetriever, SchemaTable


@pytest.mark.asyncio
async def test_relevant_tables_for_revenue_query(mock_settings, schema_context):
    retriever = SchemaRetriever(mock_settings)
    # Mock _fetch_schema_from_db to return our full schema
    retriever._fetch_schema_from_db = MagicMock(return_value=schema_context.tables)

    context = await retriever.get_context("What is the total revenue?")
    # revenue should rank order_items and orders highly
    table_names = [t.name for t in context.tables]
    assert "orders" in table_names or "order_items" in table_names


@pytest.mark.asyncio
async def test_relevant_tables_for_customer_query(mock_settings, schema_context):
    retriever = SchemaRetriever(mock_settings)
    retriever._fetch_schema_from_db = MagicMock(return_value=schema_context.tables)

    context = await retriever.get_context("Show me customers by country")
    table_names = [t.name for t in context.tables]
    assert "customers" == table_names[0]


@pytest.mark.asyncio
async def test_relevant_tables_for_product_query(mock_settings, schema_context):
    retriever = SchemaRetriever(mock_settings)
    retriever._fetch_schema_from_db = MagicMock(return_value=schema_context.tables)

    context = await retriever.get_context("product category list")
    table_names = [t.name for t in context.tables]
    assert "products" == table_names[0]


def test_schema_context_prompt_text(schema_context):
    prompt = schema_context.get_prompt_text()
    assert "Table: customers" in prompt
    assert "customer_id" in prompt
    assert "Foreign Keys:" in prompt


@pytest.mark.asyncio
async def test_redis_cache_hit_skips_duckdb(mock_settings, mock_redis):
    # Mock Redis return value to be a serialized schema
    mock_schema_data = [
        {
            "name": "mock_table",
            "columns": [{"name": "id", "type": "INT", "sample_values": ["1"]}],
            "foreign_keys": [],
        }
    ]
    import json

    mock_redis.get.return_value = json.dumps(mock_schema_data)

    retriever = SchemaRetriever(mock_settings, mock_redis)
    retriever._fetch_schema_from_db = MagicMock()

    context = await retriever.get_context("test query")

    # Assert Redis was checked
    mock_redis.get.assert_called_once_with("raa:schema")
    # Assert DuckDB fetch was NOT called
    retriever._fetch_schema_from_db.assert_not_called()
    assert context.tables[0].name == "mock_table"


@pytest.mark.asyncio
async def test_redis_cache_miss_fetches_schema(mock_settings, mock_redis, schema_context):
    mock_redis.get.return_value = None

    retriever = SchemaRetriever(mock_settings, mock_redis)
    retriever._fetch_schema_from_db = MagicMock(return_value=schema_context.tables)

    await retriever.get_context("test query")

    # Assert Redis was checked and set
    mock_redis.get.assert_called_once_with("raa:schema")
    retriever._fetch_schema_from_db.assert_called_once()
    mock_redis.set.assert_called_once()


@pytest.mark.asyncio
async def test_max_tables_returned(mock_settings):
    # Create 6 tables
    tables = [
        SchemaTable(
            name=f"t{i}",
            columns=[SchemaColumn(name="id", type="INT", sample_values=[])],
            foreign_keys=[],
        )
        for i in range(6)
    ]
    retriever = SchemaRetriever(mock_settings)
    retriever._fetch_schema_from_db = MagicMock(return_value=tables)

    context = await retriever.get_context("test question")
    # Should restrict to top 4 tables
    assert len(context.tables) <= 4


@pytest.mark.asyncio
async def test_empty_question(mock_settings, schema_context):
    retriever = SchemaRetriever(mock_settings)
    retriever._fetch_schema_from_db = MagicMock(return_value=schema_context.tables)

    context = await retriever.get_context("")
    # Should fallback to returning first 4 tables
    assert len(context.tables) == 4
