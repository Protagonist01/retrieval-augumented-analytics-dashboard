# ADR-002: Use sqlglot for SQL Validation Before Execution

## Status
Accepted

## Context
LLMs generate SQL that is sometimes syntactically malformed, references nonexistent tables or columns, or — in adversarial cases — contains destructive statements. Executing unvalidated LLM-generated SQL against a database, even a read-only one, is a security and reliability risk.

Options considered:
1. **No validation** — execute whatever the LLM produces, catch exceptions from DuckDB
2. **Regex-based checks** — block keywords like `DROP`, `DELETE` with pattern matching
3. **sqlglot** — a pure-Python SQL parser and validator with multi-dialect support
4. **Dry-run execution** — run `EXPLAIN` on the query before executing it

## Decision
Use **sqlglot** for a two-stage validation pipeline, followed by a keyword-based safety check:

**Stage 1 — Syntactic validation:**
`sqlglot.parse(sql, error_level=ErrorLevel.RAISE)` — catches malformed SQL before it reaches DuckDB.

**Stage 2 — Structural validation:**
Parse the AST to extract all referenced table and column names, then verify each against the actual schema fetched from DuckDB's `information_schema`. Queries referencing nonexistent objects are rejected with a descriptive error message that is fed back to the LLM for a single self-correction attempt.

**Stage 3 — Safety denylist:**
Reject any query whose AST contains statement types other than `SELECT`: `DROP`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ATTACH`, `COPY`, `PRAGMA`.

Note: the read-only DuckDB connection also enforces this at the engine level. The validator is a defense-in-depth layer, not the sole safeguard.

## Consequences

**Why not regex:**
Regex keyword matching is bypassable (e.g., `DR/*comment*/OP`, mixed case, Unicode lookalikes). AST-based checking is immune to these evasions because it parses intent, not text.

**Why not dry-run EXPLAIN only:**
`EXPLAIN` catches structural errors but does not give programmatic access to what tables/columns are referenced, making it harder to generate helpful error messages for LLM self-correction.

**Gained:**
- Syntactic errors caught before touching DuckDB — faster failure, better error messages
- Structural errors produce specific feedback ("column 'revnue' does not exist in table 'orders', did you mean 'revenue'?") that improves self-correction success rate
- AST-level safety check is not bypassable via string manipulation
- sqlglot is dialect-aware — can transpile DuckDB SQL to other dialects if the engine is swapped later
- 40+ unit test cases covering the validator in isolation

**Trade-offs:**
- Adds a dependency (`sqlglot`)
- Structural validation requires a live schema fetch from DuckDB — adds ~20ms per query
- sqlglot's AST occasionally diverges from DuckDB's parser on edge cases; known discrepancies are documented in `tests/unit/test_sql_validator.py` as skipped tests with explanations
