# Roadmap

This roadmap tracks the planned evolution of Retrieval-Augmented Analytics Dashboard. Each phase is intended to be built through small GitHub issues and pull requests so progress is visible over time.

## Phase 1: Product Polish

- Add query history with generated SQL, runtime, and result metadata.
- Add saved questions for commonly used analytics prompts.
- Add SQL edit mode for advanced users before execution.
- Add CSV export for result tables.
- Improve loading, empty, and error states across the query workflow.
- Add GitHub Actions CI for backend tests, Ruff, frontend lint, build, and audit.

## Phase 2: User Data

- Add CSV upload from the web app.
- Add dataset preview before querying.
- Add schema refresh after dataset changes.
- Add a data dictionary editor for column descriptions, synonyms, and business terms.
- Persist dataset metadata for reuse across sessions.

## Phase 3: Dashboards

- Save charts, tables, and KPIs to dashboards.
- Rename dashboard cards and metrics.
- Reorder dashboard cards.
- Add chart customization for chart type, labels, axes, and formatting.
- Export dashboards as PDF or image.

## Phase 4: Smarter Analytics

- Ask clarifying questions when prompts are ambiguous.
- Add a semantic metrics layer for reusable definitions.
- Define metrics such as revenue, average order value, retention, and margin.
- Show how each answer was calculated.
- Add source table and column traceability for generated answers.

## Phase 5: Model and Eval System

- Build an evaluation dashboard for the existing golden set.
- Add failed-case review and retry workflows.
- Add model comparison runs for OpenRouter, OpenAI, and Ollama.
- Store eval result history over time.
- Track SQL validity, execution accuracy, and latency trends.

## Phase 6: Real App Infrastructure

- Add authentication.
- Add workspaces or projects.
- Add role-based table and column access controls.
- Add a Redis cache inspector.
- Add an admin monitoring page.

## Phase 7: External Data Sources

- Add a Postgres connector.
- Add a MySQL connector.
- Add a Supabase connector.
- Explore BigQuery and Snowflake support.
- Add scheduled syncs or live querying.
