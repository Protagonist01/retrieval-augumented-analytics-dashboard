<div align="center">

# 📊 Retrieval-Augmented Analytics Dashboard

**Ask questions about your data in plain English.**  
Get validated SQL, live results, and a streamed plain-English explanation — all in one shot.

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![DuckDB](https://img.shields.io/badge/DuckDB-0.10-FFC107?style=flat-square&logo=duckdb&logoColor=black)](https://duckdb.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## Roadmap

Planned future work is tracked in [ROADMAP.md](ROADMAP.md), organized into phased updates for product polish, user data, dashboards, smarter analytics, evals, infrastructure, and external data sources.

---

## ✨ Why This Exists

RAG over unstructured documents is everywhere. What's less common — and more practically useful — is **natural-language querying over structured data, done right**.

Most text-to-SQL demos stop at generating a query. They don't validate it, don't sandbox execution, don't explain the result, and don't measure accuracy. This project explores what a production-grade **NL → SQL** system actually looks like end-to-end:

- Schema-aware prompt construction with few-shot examples
- Two-stage SQL validation (syntax + structural + injection guard)
- Sandboxed DuckDB execution with row and time limits
- Token-by-token SSE streaming of results and explanations
- A rigorous eval harness against an 80-pair golden set

---

## 🚀 What It Does

| Capability | Detail |
|---|---|
| 🗣️ **Natural Language Input** | Accepts plain-English questions about any loaded CSV / Parquet dataset |
| 🔍 **Schema Retrieval** | Samples DuckDB to surface the most relevant tables, columns, FKs, and value examples |
| 🤖 **SQL Generation** | Code-specialized LLM (GPT-4o default; local SQLCoder supported) with few-shot prompting |
| ✅ **Two-Stage Validation** | `sqlglot` AST parse → table/column existence → injection guard; one self-correction retry |
| 🛡️ **Sandboxed Execution** | Read-only DuckDB connection, 10 k row cap, 5 s timeout, no filesystem escape |
| 📡 **SSE Streaming** | Results, SQL, and explanation streamed token-by-token as they are generated |
| 📈 **Auto Chart Selection** | Frontend auto-picks line, bar, scatter, or table based on result shape |
| 📏 **Evaluation Harness** | 80-pair golden set; execution accuracy, validity rate, self-correction rate reported |
| 📊 **Observability** | Prometheus metrics + pre-built Grafana dashboard; structured JSON logs (Loki-ready) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User (Browser)                       │
│             "Which product had the most                 │
│              returns last quarter?"                     │
└────────────────────────┬────────────────────────────────┘
                         │  HTTP POST /api/query
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Next.js Frontend                       │
│   QueryInput → useQueryStream (SSE) → ResultTable       │
│                                    → ChartRenderer      │
│                                    → SqlExplainer       │
└────────────────────────┬────────────────────────────────┘
                         │  SSE stream (tokens arrive live)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend                        │
│                                                         │
│  ① Schema Retriever  ──► Redis (schema cache, 5 min TTL)│
│         │                                               │
│  ② Text-to-SQL LLM   ──► GPT-4o / local SQLCoder        │
│         │                                               │
│  ③ SQL Validator      ──► sqlglot AST + safety rules    │
│         │ (retry ×1 on failure)                         │
│  ④ DuckDB Executor   ──► read-only, 10k rows, 5 s cap   │
│         │                                               │
│  ⑤ Explainer LLM     ──► plain-English result summary   │
│         │                                               │
│  ⑥ StreamingResponse ──► SSE chunks → frontend          │
└─────────────────────────────────────────────────────────┘
```

> **ADRs** — see [`docs/adr/`](docs/adr/) for architectural decision records on LLM choice, validation strategy, streaming protocol, and DuckDB sandboxing.

---

## ⚡ Quick Start

**Prerequisites:** Docker · Docker Compose · Node.js 20+

```bash
# 1. Clone and configure
git clone https://github.com/Protagonist01/retrieval-augumented-analytics-dashboard.git
cd retrieval-augumented-analytics-dashboard
cp .env.example .env
# → edit .env: set your LLM provider and API key (see below)

# 2. Start the backend stack (FastAPI + Redis)
make up

# 3. Start the frontend
cd frontend && npm install && npm run dev

# 4. Open http://localhost:3000
# A sample e-commerce dataset is pre-loaded. Try asking:
#   "Which product category had the highest revenue last month?"
#   "Show me the top 10 customers by total order value"
#   "What is the return rate by product?"
```

### LLM Provider Options

<details>
<summary><strong>Option A — OpenAI (GPT-4o, default)</strong></summary>

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

</details>

<details>
<summary><strong>Option B — OpenRouter (free tier available)</strong></summary>

OpenRouter is OpenAI-API-compatible, so the same client is reused with a different base URL.

```env
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=your-openrouter-key
OPENAI_MODEL=openrouter/free
```

</details>

<details>
<summary><strong>Option C — Local SQLCoder (Ollama)</strong></summary>

```bash
ollama pull defog/sqlcoder-7b-2
```

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=defog/sqlcoder-7b-2
```

</details>

---

## 🔬 How It Works

### 1 · Schema Retrieval

Rather than dumping the entire schema into the prompt (which wastes tokens and confuses the model), the Schema Retriever samples DuckDB to find the **most relevant tables** for each question. It uses keyword overlap between the query and column/table names, and includes 3 sample rows per relevant table so the LLM sees concrete value formats.

Schema snapshots are cached in Redis with a 5-minute TTL, keeping cold-start latency to a minimum on repeated questions.

### 2 · Few-Shot Prompt Construction

The system prompt includes **5 curated NL→SQL pairs** drawn from the same dataset. Few-shots are stored as versioned JSONL in `backend/src/pipeline/few_shots/` — independently testable and editable without touching model code.

### 3 · Two-Stage SQL Validation

Before any query touches the database:

1. **Syntactic check** — `sqlglot.parse()` catches malformed SQL and dialect mismatches.
2. **Structural check** — every referenced table and column is verified against the live schema; unknown objects trigger a descriptive error sent back to the LLM for one self-correction retry.
3. **Safety guard** — any query containing `DROP`, `INSERT`, `UPDATE`, `DELETE`, `ATTACH`, or `PRAGMA` is rejected immediately with no retry.

→ Full rationale in [`docs/adr/002-sqlglot-validation.md`](docs/adr/002-sqlglot-validation.md)

### 4 · Sandboxed Execution

DuckDB runs in-process on a **read-only connection** scoped to a copy of the data directory. Hard limits:
- **10,000 rows** maximum returned
- **5-second** query timeout
- **No filesystem access** outside the designated data directory

### 5 · SSE Streaming

Results are delivered via **Server-Sent Events**, not a single blocking JSON response. The frontend renders the explanation token-by-token as it arrives, turning a 2–5 second LLM call into a visibly interactive experience rather than a frozen spinner.

---

## 🧪 Testing

```bash
make test              # run all test layers
make test-unit         # pipeline unit tests (no LLM calls, no network)
make test-integration  # full pipeline with DuckDB + mocked LLM responses
make test-e2e          # Playwright browser tests against a running stack
```

### Test Coverage

| Layer | File | What's Covered |
|---|---|---|
| **Unit** | `tests/unit/test_sql_validator.py` | 40+ cases: valid SQL, injection attempts, nonexistent tables, dialect edge cases |
| **Unit** | `tests/unit/test_schema_retriever.py` | Relevance ranking, sample value extraction, FK resolution |
| **Integration** | `tests/integration/test_pipeline.py` | Full NL→result flow with real DuckDB and mocked LLM responses |
| **E2E** | `tests/e2e/query_flow.spec.ts` | Playwright: type a question, assert result table and SQL panel render |

A deterministic `tests/fixtures/ecommerce.duckdb` is committed to the repo so integration tests run without the sample CSV files.

---

## 📏 Evaluation

```bash
make eval
# → evals/results/YYYY-MM-DDTHH-MM-SS.json  (timestamped, trackable)
# → console summary table printed on completion
```

`evals/golden_set.jsonl` contains **80 NL→SQL pairs** adapted from the [Spider benchmark](https://yale-lily.github.io/spider) and tuned to the bundled e-commerce schema. Each entry has:
- Natural language question
- Canonical expected SQL
- Expected result row count (for execution accuracy)

### Current Metrics

| Metric | Definition | Score |
|---|---|---|
| **Execution Accuracy** | Generated SQL returns the same rows as the canonical SQL | ~74 % |
| **SQL Validity Rate** | % of generated queries that pass two-stage validation | ~96 % |
| **Self-Correction Rate** | % of initially-invalid queries fixed on the one retry | ~61 % |
| **Parse Success Rate** | % of LLM responses that yield parseable SQL | ~98 % |
| **P95 Query Latency** | End-to-end including LLM call (GPT-4o) | ~4.2 s |

```bash
# Run evals against a specific model
EVAL_MODEL=gpt-4o make eval
EVAL_MODEL=openrouter/free make eval
```

Results are written with timestamps so regressions are visible across prompt or model changes.

---

## 📊 Monitoring & Observability

The backend exposes **Prometheus metrics** at `/metrics`. Import `infra/grafana/dashboard.json` after `make up` to get a pre-built Grafana dashboard.

| Metric | Description |
|---|---|
| `query_duration_seconds` | Full pipeline latency histogram (P50 / P95 / P99) |
| `sql_validation_failures_total` | Validation rejections by reason: `syntax` / `structural` / `safety` |
| `llm_tokens_used_total` | Token usage by stage: `text_to_sql` vs `explainer` |
| `query_cache_hits_total` | Redis schema cache hit rate |
| `duckdb_query_duration_seconds` | SQL execution time, separate from LLM latency |

Logs are **structured JSON** (via `structlog`) emitted to stdout — ready for ingestion into Loki / Grafana Cloud with zero configuration.

---

## 📁 Project Structure

```
retrieval-augmented-analytics-dashboard/
│
├── backend/                        # FastAPI application
│   ├── src/
│   │   ├── api/                    # Route handlers, request/response models
│   │   ├── pipeline/
│   │   │   ├── schema_retriever.py # Table/column relevance scoring + caching
│   │   │   ├── text_to_sql.py      # LLM prompt construction + generation
│   │   │   ├── sql_validator.py    # sqlglot AST validation + safety rules
│   │   │   ├── executor.py         # DuckDB sandboxed execution
│   │   │   ├── explainer.py        # Plain-English result explanation
│   │   │   └── few_shots/          # Versioned JSONL few-shot examples
│   │   └── config.py               # Pydantic settings (env-driven)
│   ├── tests/
│   │   ├── unit/                   # 40+ SQL validator + schema retriever tests
│   │   ├── integration/            # Full pipeline with mocked LLM
│   │   └── fixtures/               # Deterministic ecommerce.duckdb
│   └── pyproject.toml
│
├── frontend/                       # Next.js 14 App Router
│   ├── src/
│   │   ├── app/                    # Page routes
│   │   ├── components/
│   │   │   ├── QueryInput.tsx      # Natural language input field
│   │   │   ├── ResultTable.tsx     # Tabular result renderer
│   │   │   ├── ChartRenderer.tsx   # Auto chart type selection (Recharts)
│   │   │   └── SqlExplainer.tsx    # SQL syntax highlight + reasoning panel
│   │   └── hooks/
│   │       └── useQueryStream.ts   # SSE client hook (token-by-token)
│   └── tests/e2e/                  # Playwright browser tests
│
├── evals/
│   ├── golden_set.jsonl            # 80 labelled NL→SQL pairs
│   ├── run_evals.py                # Evaluation runner script
│   └── results/                    # Timestamped JSON outputs
│
├── data/
│   └── sample/ecommerce.csv        # Bundled demo dataset
│
├── infra/
│   ├── docker-compose.yml          # FastAPI + Redis + Prometheus + Grafana
│   └── grafana/dashboard.json      # Pre-built dashboard (import after make up)
│
├── docs/adr/                       # Architectural Decision Records
├── Makefile                        # Convenience targets (up, test, eval, …)
├── .env.example                    # Environment variable reference
└── README.md
```

---

## ⚠️ Limitations & Roadmap

### Current Limitations

- **Keyword-only schema retrieval** — complex domain vocabulary can miss relevant tables; a semantic embedding approach would be more robust
- **No multi-turn support** — each question is independent; "show me the same but for last year" requires re-stating the full question
- **Single-node DuckDB** — in-process execution is not horizontally scalable; server-mode DuckDB would be needed for multi-instance deployments
- **Synthetic eval set** — the golden set is adapted from Spider, not real business questions; accuracy on domain-specific data may vary

### Planned Work

- [ ] Embedding-based schema retrieval (sentence-transformers over column names + descriptions)
- [ ] Multi-turn query context (query history injected into subsequent prompts)
- [ ] User-defined data dictionary (annotate columns with business meaning)
- [ ] Export results to CSV / shareable link
- [ ] Server-mode DuckDB for horizontal scalability

---

## 📄 License

[MIT](LICENSE) © 2024 — built as a portfolio project exploring production-grade NL→SQL systems.

---

<div align="center">

**Built with** FastAPI · DuckDB · Next.js · OpenAI · Redis · Prometheus · Grafana · sqlglot · Recharts

</div>
