import json
import logging
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import duckdb
import redis.asyncio as aioredis

from src.config import Settings
from src.metrics import query_cache_hits_total

logger = logging.getLogger("raa.schema_retriever")


@dataclass
class SchemaColumn:
    name: str
    type: str
    sample_values: list[str]


@dataclass
class SchemaTable:
    name: str
    columns: list[SchemaColumn]
    foreign_keys: list[dict[str, Any]]


@dataclass
class SchemaContext:
    tables: list[SchemaTable]

    def get_prompt_text(self) -> str:
        lines = []
        for table in self.tables:
            lines.append(f"Table: {table.name}")
            lines.append("Columns:")
            for col in table.columns:
                samples = ", ".join(f"'{v}'" for v in col.sample_values if v is not None)
                sample_str = f" (Sample values: [{samples}])" if samples else ""
                lines.append(f"  - {col.name} ({col.type}){sample_str}")
            if table.foreign_keys:
                lines.append("Foreign Keys:")
                for fk in table.foreign_keys:
                    lines.append(f"  - {fk['column']} -> {fk['ref_table']}.{fk['ref_column']}")
            lines.append("")
        return "\n".join(lines)


class SchemaRetriever:
    def __init__(self, settings: Settings, redis_client: aioredis.Redis | None = None):
        self.settings = settings
        self.redis_client = redis_client
        self._duckdb_conn: duckdb.DuckDBPyConnection | None = None

    def _get_connection(self) -> duckdb.DuckDBPyConnection:
        if self._duckdb_conn is None:
            # Connect to in-memory DuckDB
            conn = duckdb.connect(":memory:")
            self._register_csv_views(conn)
            self._duckdb_conn = conn
        return self._duckdb_conn

    def _iter_csv_paths(self) -> list[Path]:
        paths: list[Path] = []
        data_dirs = (Path(self.settings.duckdb_data_dir), Path(self.settings.duckdb_upload_dir))
        for data_dir in data_dirs:
            if data_dir.exists():
                paths.extend(sorted(data_dir.glob("*.csv")))
        return paths

    def _register_csv_views(self, conn: duckdb.DuckDBPyConnection) -> None:
        for csv_path in self._iter_csv_paths():
            table_name = csv_path.stem
            safe_path = str(csv_path.resolve()).replace("\\", "/")
            create_view_sql = (
                f"CREATE OR REPLACE VIEW {table_name} AS "
                f"SELECT * FROM read_csv_auto('{safe_path}')"
            )
            conn.execute(create_view_sql)
            logger.info(f"Registered view: {table_name} for path {safe_path}")

    async def refresh(self) -> None:
        if self._duckdb_conn is not None:
            self._duckdb_conn.close()
            self._duckdb_conn = None
        if self.redis_client:
            await self.redis_client.delete("raa:schema")

    async def get_context(self, question: str) -> SchemaContext:
        full_schema: list[SchemaTable] | None = None

        # 1. Try Redis cache for full schema
        if self.redis_client:
            try:
                cached_data = await self.redis_client.get("raa:schema")
                if cached_data:
                    query_cache_hits_total.labels(cache="schema", result="hit").inc()
                    schema_dicts = json.loads(cached_data)
                    full_schema = []
                    for table_dict in schema_dicts:
                        cols = [SchemaColumn(**c) for c in table_dict["columns"]]
                        fks = table_dict.get("foreign_keys", [])
                        full_schema.append(
                            SchemaTable(name=table_dict["name"], columns=cols, foreign_keys=fks)
                        )
                    logger.info("Schema retrieved from Redis cache")
                else:
                    query_cache_hits_total.labels(cache="schema", result="miss").inc()
            except Exception as e:
                logger.warning(f"Failed to read schema from Redis: {e}")

        # 2. If cache miss, query DuckDB
        if not full_schema:
            try:
                full_schema = self._fetch_schema_from_db()
                if self.redis_client and full_schema:
                    # Cache the full schema
                    schema_json = json.dumps([asdict(t) for t in full_schema])
                    await self.redis_client.set(
                        "raa:schema", schema_json, ex=self.settings.schema_cache_ttl_seconds
                    )
                    logger.info("Schema cached to Redis")
            except Exception as e:
                logger.error(f"Failed to fetch schema from DuckDB: {e}")
                full_schema = []

        # 3. Compute relevance and select top 4 tables
        relevant_tables = self._rank_tables(question, full_schema)
        return SchemaContext(tables=relevant_tables)

    def _fetch_schema_from_db(self) -> list[SchemaTable]:
        conn = self._get_connection()
        # Query columns information
        columns_res = conn.execute("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'main'
        """).fetchall()

        tables_cols: dict[str, list[SchemaColumn]] = {}
        for table_name, column_name, data_type in columns_res:
            if table_name not in tables_cols:
                tables_cols[table_name] = []

            # Fetch 3 sample values for this column
            sample_values: list[str] = []
            try:
                sample_query = (
                    f"SELECT DISTINCT {column_name} FROM {table_name} "
                    f"WHERE {column_name} IS NOT NULL LIMIT 3"
                )
                samples = conn.execute(sample_query).fetchall()
                sample_values = [str(s[0]) for s in samples]
            except Exception as e:
                logger.warning(f"Could not fetch sample values for {table_name}.{column_name}: {e}")

            tables_cols[table_name].append(
                SchemaColumn(name=column_name, type=data_type, sample_values=sample_values)
            )

        # DuckDB CSVs do not enforce FKs, so define heuristic relationships.
        # The schema tables are: customers, products, orders, order_items
        fks_map = {
            "orders": [
                {"column": "customer_id", "ref_table": "customers", "ref_column": "customer_id"}
            ],
            "order_items": [
                {"column": "order_id", "ref_table": "orders", "ref_column": "order_id"},
                {"column": "product_id", "ref_table": "products", "ref_column": "product_id"},
            ],
        }

        tables: list[SchemaTable] = []
        for name, cols in tables_cols.items():
            tables.append(SchemaTable(name=name, columns=cols, foreign_keys=fks_map.get(name, [])))
        return tables

    def _tokenize(self, text: str) -> set[str]:
        # Simple tokenization: lowercase alphanumeric words
        return set(re.findall(r"\b\w+\b", text.lower()))

    def _rank_tables(self, question: str, tables: list[SchemaTable]) -> list[SchemaTable]:
        question_tokens = self._tokenize(question)
        if not question_tokens:
            return tables[:4]

        ranked: list[tuple[float, SchemaTable]] = []
        for table in tables:
            # Table tokens include table name and column names
            table_tokens = self._tokenize(table.name)
            for col in table.columns:
                table_tokens.update(self._tokenize(col.name))

            # Jaccard similarity
            intersection = len(question_tokens & table_tokens)
            union = len(question_tokens | table_tokens)
            score = intersection / union if union > 0 else 0.0
            ranked.append((score, table))

        # Sort by Jaccard score descending, keep original order for ties
        ranked.sort(key=lambda x: x[0], reverse=True)
        return [t for _, t in ranked[:4]]


async def get_schema_retriever(
    settings: Settings, redis_client: aioredis.Redis | None = None
) -> SchemaRetriever:
    return SchemaRetriever(settings, redis_client)
