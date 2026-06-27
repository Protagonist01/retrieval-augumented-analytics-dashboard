# 📊 Retrieval-Augmented Analytics (RAA) Dashboard

> Ask questions about your data in plain English. Get SQL, results, and a human-readable explanation — streamed in real time.

![demo](docs/assets/demo.gif)

---

## Why I Built This

RAG over unstructured documents is everywhere. What's less common — and more practically useful — is natural language querying over *structured* data, done right. Most text-to-SQL demos stop at generating a query. They don't validate it, don't sandbox execution, don't explain the result, and don't measure accuracy. I built this to explore what a production-grade NL→SQL system actually looks like end to end: from schema-aware prompt construction to SQL injection prevention to streaming explainability. The eval harness was the most important part to get right.

---

## What It Does

- Accepts natural language questions about any CSV or Parquet dataset loaded into DuckDB
- Retrieves relevant schema context (tables, columns, sample values, foreign keys) automatically
- Generates SQL using a code-specialized LLM with few-shot examples
- Validates generated SQL syntactically and structurally before execution
- Executes queries in a read-only, sandboxed DuckDB connection with row and time limits
- Streams results, the generated SQL, and a plain-English explanation to the frontend simultaneously
- Auto-selects the appropriate chart type based on result shape (line, bar, table, single value)

---

## Architecture

```
User (NL question)
        │
        ▼
Next.js Frontend  ←── SSE stream (tokens arrive as generated)
        │
        ▼
FastAPI Backend
  │
  ├── Schema Retriever   → samples DuckDB for relevant tables/columns/FK relationships
  ├── Text-to-SQL LLM    → SQLCoder (local) or GPT-4o, with few-shot prompt
  ├── SQL Validator      → sqlglot: syntax check + table/column existence + injection guard
  ├── DuckDB Executor    → read-only connection, 10k row cap, 5s timeout
  └── Explainer LLM      → generates plain-English summary of result + SQL reasoning
        │
        ▼
  ┌─────────────┐    ┌──────────────┐
  │   DuckDB    │    │  Redis Cache │
  │ (in-process)│    │ (schema +    │
  │  read-only  │    │  query cache)│
  └─────────────┘    └──────────────┘
```

---

## Quick Start

**Prerequisites:** Docker, Docker Compose, Node.js 20+

```bash
# 1. Clone and configure
git clone https://github.com/you/raa-dashboard
cd raa-dashboard
cp .env.example .env
# Edit .env: set LLM provider (OpenAI/OpenRouter or local SQLCoder)

# 2. Start the backend stack
make up

# 3. Install and start the frontend
cd frontend && npm install && npm run dev

# 4. Open http://localhost:3000
# A sample e-commerce dataset is pre-loaded. Try:
# "Which product category had the highest revenue last month?"
# "Show me the top 10 customers by order value"
```

**OpenRouter free setup:** keep `LLM_PROVIDER=openai`, then set:

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=your-openrouter-key
OPENAI_MODEL=openrouter/free
```

OpenRouter is OpenAI-compatible, so the backend uses the existing OpenAI client with a
different base URL. The `openrouter/free` router chooses an available free model for
each request.

---

## How It Works

### 1. Schema Retrieval
Rather than dumping the entire schema into the prompt (which wastes tokens and confuses the LLM), the Schema Retriever samples the database to find the most relevant tables for the question. It uses keyword overlap between the query and column names, and includes 3 sample rows per relevant table to give the LLM concrete value format examples.

### 2. Few-Shot Prompt Construction
The prompt includes 5 curated NL→SQL examples from the same dataset. These few-shots are stored in `backend/src/pipeline/few_shots/` as structured JSONL files — versioned, editable, and testable independently of the model.

### 3. SQL Validation (Two-Stage)
Before any query touches the database:
- **Syntactic check** via `sqlglot.parse()` — catches malformed SQL
- **Structural check** — every referenced table and column is verified against the actual schema; queries referencing nonexistent objects are rejected with a descriptive error sent back to the LLM for self-correction (one retry)
- **Safety check** — any query containing `DROP`, `INSERT`, `UPDATE`, `DELETE`, `ATTACH`, or `PRAGMA` is rejected immediately

See `docs/adr/002-sqlglot-validation.md` for the full rationale.

### 4. Sandboxed Execution
DuckDB runs in-process but on a **read-only connection** opened against a copy of the data. Limits enforced:
- Max 10,000 rows returned
- 5-second query timeout
- No file system access beyond the designated data directory

### 5. SSE Streaming
Results are streamed to the frontend using Server-Sent Events rather than a single blocking response. The frontend renders the explanation token-by-token as it arrives, making the 2–5 second LLM call feel interactive rather than frozen.

---

## Testing

```bash
make test             # all tests
make test-unit        # pipeline unit tests (no LLM calls)
make test-integration # full pipeline with DuckDB + mocked LLM
make test-e2e         # Playwright browser tests against running stack
```

**Test strategy:**

| Layer | What's tested |
|-------|--------------|
| `tests/unit/test_sql_validator.py` | 40+ cases: valid SQL, injection attempts, nonexistent tables, dialect edge cases |
| `tests/unit/test_schema_retriever.py` | Relevance ranking, sample value extraction |
| `tests/integration/test_pipeline.py` | Full NL→result flow with a real DuckDB instance and mocked LLM responses |
| `tests/e2e/query_flow.spec.ts` | Playwright: types a query, asserts result table and SQL panel appear |

**Fixtures:** `tests/fixtures/ecommerce.duckdb` is a deterministic test database committed to the repo so integration tests don't depend on the sample data files.

---

## Evaluation

This is the most important section for understanding system quality.

```bash
make eval
# Outputs: evals/results/latest.json + console summary
```

`evals/golden_set.jsonl` contains **80 NL→SQL pairs** derived from a subset of the [Spider benchmark](https://yale-lily.github.io/spider), adapted to the bundled e-commerce dataset. Each entry has:
- Natural language question
- Expected SQL (canonical form)
- Expected result row count (for execution accuracy)

**Metrics reported:**

| Metric | Definition | Current |
|--------|-----------|---------|
| Execution Accuracy | Generated SQL returns same rows as expected SQL | ~74% |
| SQL Validity Rate | % of generated queries that pass validation | ~96% |
| Self-Correction Rate | % of invalid queries fixed on retry | ~61% |
| Parse Success Rate | % of LLM responses that parse to valid SQL | ~98% |
| P95 Query Latency | End-to-end including LLM call | ~4.2s |

Results are written to `evals/results/` with a timestamp so regressions are trackable across model or prompt changes.

**To run evals against a different model:**
```bash
EVAL_MODEL=gpt-4o make eval
```

---

## Monitoring

The backend exposes Prometheus metrics at `/metrics`.

**Key metrics:**

| Metric | Description |
|--------|-------------|
| `query_duration_seconds` | Full pipeline latency histogram |
| `sql_validation_failures_total` | Validation rejections by reason (syntax/structural/safety) |
| `llm_tokens_used_total` | Token usage by pipeline stage (text-to-sql vs explainer) |
| `query_cache_hits_total` | Redis cache hit rate |
| `duckdb_query_duration_seconds` | SQL execution time (separate from LLM latency) |

A pre-built Grafana dashboard is at `infra/grafana/dashboard.json`. Import it after `make up` to see live panels.

Logs are structured JSON (stdout), compatible with Loki/Grafana Cloud ingestion out of the box.

---

## Project Structure

```
raa-dashboard/
├── backend/
│   ├── src/
│   │   ├── pipeline/
│   │   │   ├── schema_retriever.py
│   │   │   ├── text_to_sql.py
│   │   │   ├── sql_validator.py
│   │   │   ├── executor.py
│   │   │   ├── explainer.py
│   │   │   └── few_shots/          # versioned few-shot examples
│   │   └── api/
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── fixtures/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── QueryInput.tsx
│   │   │   ├── ResultTable.tsx
│   │   │   ├── SqlExplainer.tsx    # shows SQL + reasoning panel
│   │   │   └── ChartRenderer.tsx   # auto chart type selection
│   │   └── hooks/
│   │       └── useQueryStream.ts   # SSE client hook
│   └── tests/e2e/
├── evals/
│   ├── golden_set.jsonl            # 80 labelled NL→SQL pairs
│   ├── run_evals.py
│   └── results/                    # timestamped eval outputs
├── data/sample/
│   └── ecommerce.csv               # bundled demo dataset
├── infra/
│   ├── docker-compose.yml
│   └── grafana/dashboard.json
├── docs/adr/
├── Makefile
└── README.md
```

---

## Limitations & Future Work

**Current limitations:**
- Schema retriever uses keyword heuristics, not semantic embedding — complex domain vocabulary can miss relevant tables
- No multi-turn query support — each question is independent (no "show me the same but for last year")
- DuckDB in-process means the backend is single-node; not horizontally scalable without moving to a server-mode deployment
- Eval set is adapted from Spider, not real business questions — accuracy may differ on domain-specific data

**Planned work:**
- [ ] Embedding-based schema retrieval (sentence-transformers over column names + descriptions)
- [ ] Multi-turn conversation with query history as context
- [ ] User-defined data dictionary (let teams annotate columns with business meaning)
- [ ] Export query results to CSV / share link

---

## License

MIT
