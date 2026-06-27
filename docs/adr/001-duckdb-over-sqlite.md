# ADR-001: Use DuckDB Instead of SQLite as the Analytics Engine

## Status
Accepted

## Context
The RAA Dashboard needs an embedded SQL engine that:
- Runs in-process (no separate database server to manage)
- Handles analytical queries efficiently (aggregations, window functions, GROUP BY at scale)
- Reads CSV and Parquet files directly without an import step
- Supports a read-only connection mode for safety
- Is familiar enough that contributors can reason about it

The main candidates were SQLite and DuckDB.

## Decision
Use **DuckDB** as the in-process analytics engine.

## Consequences

**Why not SQLite:**
- SQLite is OLTP-oriented — row-based storage means analytical aggregations (SUM, GROUP BY, window functions) over large CSVs are significantly slower
- SQLite requires importing CSV data into tables; DuckDB can query CSVs and Parquet files directly with `SELECT * FROM 'data.csv'`
- SQLite lacks several analytical SQL features used in the golden eval set (e.g., `QUALIFY`, certain window function variants)
- DuckDB's in-process model is identical to SQLite's — same operational simplicity

**Gained:**
- Columnar execution engine: 5–50x faster on analytical queries over the same data
- Direct CSV/Parquet querying: no ETL step to load the demo dataset
- Read-only connection via `duckdb.connect(read_only=True)` — one flag enforces the safety sandbox
- Rich SQL dialect including `PIVOT`, `UNPIVOT`, `LIST`, `STRUCT` — supports more NL question types
- Active development, Python-native API, well-documented

**Trade-offs:**
- Less universally known than SQLite — contributors may be unfamiliar
- DuckDB's in-process model is not horizontally scalable; addressed in README limitations
- Slightly larger binary footprint than SQLite

**Mitigation:**
A brief DuckDB primer is included in `docs/setup.md`. The SQL dialect differences from SQLite that affect the golden eval set are documented in `evals/README.md`.
