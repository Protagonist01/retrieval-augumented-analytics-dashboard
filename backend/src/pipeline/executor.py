import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb

from src.config import Settings
from src.metrics import duckdb_query_duration_seconds

logger = logging.getLogger("raa.executor")


class QueryTimeoutError(Exception):
    """Raised when a query takes longer than the timeout limit."""

    pass


class QueryExecutionError(Exception):
    """Raised when query execution fails in DuckDB."""

    pass


@dataclass
class ExecutionResult:
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    duration_ms: float
    truncated: bool


class QueryExecutor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._duckdb_conn: duckdb.DuckDBPyConnection | None = None

    def _get_connection(self) -> duckdb.DuckDBPyConnection:
        if self._duckdb_conn is None:
            # Connect to :memory: and register CSV views for sandboxed reads.
            conn = duckdb.connect(":memory:")
            for csv_path in self._iter_csv_paths():
                table_name = csv_path.stem
                safe_path = str(csv_path.resolve()).replace("\\", "/")
                create_view_sql = (
                    f"CREATE OR REPLACE VIEW {table_name} AS "
                    f"SELECT * FROM read_csv_auto('{safe_path}')"
                )
                conn.execute(create_view_sql)
                logger.info(f"Executor registered view: {table_name} -> {safe_path}")
            self._duckdb_conn = conn
        return self._duckdb_conn

    def _iter_csv_paths(self) -> list[Path]:
        paths: list[Path] = []
        data_dirs = (Path(self.settings.duckdb_data_dir), Path(self.settings.duckdb_upload_dir))
        for data_dir in data_dirs:
            if data_dir.exists():
                paths.extend(sorted(data_dir.glob("*.csv")))
        return paths

    def refresh(self) -> None:
        if self._duckdb_conn is not None:
            self._duckdb_conn.close()
            self._duckdb_conn = None

    async def execute(self, sql: str) -> ExecutionResult:
        loop = asyncio.get_event_loop()
        start_time = time.perf_counter()

        # Run DuckDB query in a separate thread to prevent blocking the event loop
        def run_query():
            conn = self._get_connection()
            # Fetch up to MAX_RESULT_ROWS + 1 to detect truncation
            limit_rows = self.settings.max_result_rows

            # Execute query and get cursor
            cursor = conn.execute(sql)
            columns = [col[0] for col in cursor.description]

            # Fetch limit_rows + 1
            rows = cursor.fetchmany(limit_rows + 1)
            return columns, rows

        try:
            # Enforce execution timeout
            columns, rows = await asyncio.wait_for(
                loop.run_in_executor(None, run_query), timeout=self.settings.query_timeout_seconds
            )
        except TimeoutError as e:
            logger.error(f"Query execution timed out after {self.settings.query_timeout_seconds}s")
            raise QueryTimeoutError(
                f"Query timed out after {self.settings.query_timeout_seconds} seconds"
            ) from e
        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            raise QueryExecutionError(str(e)) from e

        duration_ms = (time.perf_counter() - start_time) * 1000.0
        duckdb_query_duration_seconds.observe(duration_ms / 1000.0)

        # Handle truncation
        limit_rows = self.settings.max_result_rows
        truncated = len(rows) > limit_rows
        if truncated:
            rows = rows[:limit_rows]

        # Convert rows (tuples) to list of lists
        rows_list = [list(r) for r in rows]

        return ExecutionResult(
            columns=columns,
            rows=rows_list,
            row_count=len(rows_list),
            duration_ms=round(duration_ms, 2),
            truncated=truncated,
        )
