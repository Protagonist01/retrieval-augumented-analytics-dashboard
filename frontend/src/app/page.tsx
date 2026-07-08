"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryStream } from "@/hooks/useQueryStream";
import QueryInput from "@/components/QueryInput";
import SqlPanel from "@/components/SqlPanel";
import ChartRenderer from "@/components/ChartRenderer";
import ExplanationPanel from "@/components/ExplanationPanel";
import {
  AnswerTrace,
  ChartConfig,
  DataDictionaryEntry,
  DashboardCard,
  DatasetSummary,
  MetricDefinition,
  QueryHistoryEntry,
  SavedQuestion,
  SchemaTable,
} from "@/types";

const HISTORY_KEY = "raa.queryHistory";
const SAVED_KEY = "raa.savedQuestions";
const DICTIONARY_KEY = "raa.dataDictionary";
const DASHBOARD_KEY = "raa.dashboardCards";
const METRICS_KEY = "raa.metricDefinitions";

const DEFAULT_CHART_CONFIG: ChartConfig = {
  title: "",
  chartType: "auto",
  xAxisLabel: "",
  yAxisLabel: "",
  color: "#1f8a5b",
};

function loadStoredList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getClarifyingQuestions(value: string) {
  const normalized = value.trim().toLowerCase();
  const prompts = [];
  if (normalized.length > 0 && normalized.length < 18) {
    prompts.push("Which table or metric should this query use?");
  }
  if (/\b(revenue|orders|customers|products|sales)\b/.test(normalized) && !/\bby\b/.test(normalized)) {
    prompts.push("Should the answer be grouped by time, category, customer, or region?");
  }
  if (/\b(recent|latest|last|this month|this year)\b/.test(normalized) && !/\b20\d{2}|day|week|month|quarter|year\b/.test(normalized)) {
    prompts.push("What exact date range should be used?");
  }
  if (/\b(best|top|highest|lowest)\b/.test(normalized) && !/\b\d+\b/.test(normalized)) {
    prompts.push("How many results should be returned?");
  }
  return prompts;
}

function deriveTrace(sql: string | null, columns: string[], schema: { tables: SchemaTable[] } | null): AnswerTrace {
  if (!sql) return { tables: [], columns: [], calculation: "No SQL has been generated yet." };

  const tableMatches = Array.from(sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi)).map(
    (match) => match[1]
  );
  const tables = Array.from(new Set(tableMatches));
  const schemaColumns = new Set(schema?.tables.flatMap((table) => table.columns.map((col) => col.name)) || []);
  const sqlTokens = new Set(
    Array.from(sql.matchAll(/\b[a-zA-Z_][\w]*\b/g)).map((match) => match[0])
  );
  const sourceColumns = Array.from(
    new Set([
      ...columns,
      ...Array.from(sqlTokens).filter((token) => schemaColumns.has(token)),
    ])
  );
  const calculations = [];
  if (/\bcount\s*\(/i.test(sql)) calculations.push("counts matching rows");
  if (/\bsum\s*\(/i.test(sql)) calculations.push("sums numeric values");
  if (/\bavg\s*\(/i.test(sql)) calculations.push("averages numeric values");
  if (/\bgroup\s+by\b/i.test(sql)) calculations.push("groups rows before returning results");
  if (/\bwhere\b/i.test(sql)) calculations.push("filters rows before calculation");

  return {
    tables,
    columns: sourceColumns,
    calculation: calculations.length ? calculations.join(", ") : "selects rows or derived values from the referenced tables",
  };
}

export default function Home() {
  const { state, submitQuery, cancel } = useQueryStream();
  const [question, setQuestion] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [schema, setSchema] = useState<{ tables: SchemaTable[] } | null>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>(() =>
    loadStoredList<SavedQuestion>(SAVED_KEY)
  );
  const [history, setHistory] = useState<QueryHistoryEntry[]>(() =>
    loadStoredList<QueryHistoryEntry>(HISTORY_KEY)
  );
  const [dictionary, setDictionary] = useState<Record<string, DataDictionaryEntry>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(DICTIONARY_KEY) || "{}") as Record<
        string,
        DataDictionaryEntry
      >;
    } catch {
      return {};
    }
  });
  const [dashboardCards, setDashboardCards] = useState<DashboardCard[]>(() =>
    loadStoredList<DashboardCard>(DASHBOARD_KEY)
  );
  const [metrics, setMetrics] = useState<MetricDefinition[]>(() =>
    loadStoredList<MetricDefinition>(METRICS_KEY)
  );
  const [chartConfig, setChartConfig] = useState<ChartConfig>(DEFAULT_CHART_CONFIG);
  const [metricDraft, setMetricDraft] = useState({ name: "", formula: "", description: "" });
  const [schemaOpen, setSchemaOpen] = useState(true);
  const [uploadStatus, setUploadStatus] = useState("");
  const lastRecordedKey = useRef("");

  const persistHistory = (entries: QueryHistoryEntry[]) => {
    setHistory(entries);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  };

  const persistSavedQuestions = (entries: SavedQuestion[]) => {
    setSavedQuestions(entries);
    localStorage.setItem(SAVED_KEY, JSON.stringify(entries));
  };

  const persistDashboardCards = (entries: DashboardCard[]) => {
    setDashboardCards(entries);
    localStorage.setItem(DASHBOARD_KEY, JSON.stringify(entries));
  };

  const persistMetrics = (entries: MetricDefinition[]) => {
    setMetrics(entries);
    localStorage.setItem(METRICS_KEY, JSON.stringify(entries));
  };

  const updateDictionary = (
    key: string,
    field: keyof DataDictionaryEntry,
    value: string
  ) => {
    const next = {
      ...dictionary,
      [key]: {
        description: dictionary[key]?.description || "",
        synonyms: dictionary[key]?.synonyms || "",
        [field]: value,
      },
    };
    setDictionary(next);
    localStorage.setItem(DICTIONARY_KEY, JSON.stringify(next));
  };

  const fetchSchema = useCallback(async () => {
    try {
      const response = await fetch("/api/schema");
      if (response.ok) {
        const data = await response.json();
        setSchema(data);
      }
    } catch (err) {
      console.error("Failed to load database schema metadata: ", err);
    }
  }, []);

  const fetchDatasets = useCallback(async () => {
    try {
      const response = await fetch("/api/datasets");
      if (response.ok) {
        const data = await response.json();
        setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
      }
    } catch (err) {
      console.error("Failed to load dataset metadata: ", err);
    }
  }, []);

  useEffect(() => {
    const loadWorkspace = async () => {
      await Promise.all([fetchSchema(), fetchDatasets()]);
    };

    void loadWorkspace();
  }, [fetchDatasets, fetchSchema]);

  useEffect(() => {
    if (!activeQuestion || state.isStreaming || !["done", "error"].includes(state.phase)) return;

    const recordKey = `${activeQuestion}:${state.phase}:${state.sql || ""}:${state.error || ""}`;
    if (lastRecordedKey.current === recordKey) return;
    lastRecordedKey.current = recordKey;

    const entry: QueryHistoryEntry = {
      id: crypto.randomUUID(),
      question: activeQuestion,
      sql: state.sql,
      status: state.phase === "done" ? "done" : "error",
      rowCount: state.meta?.rowCount || 0,
      durationMs: state.meta?.durationMs || 0,
      createdAt: new Date().toISOString(),
      error: state.error,
    };

    persistHistory([entry, ...history].slice(0, 20));
  }, [activeQuestion, history, state.error, state.isStreaming, state.meta, state.phase, state.sql]);

  const getPhaseText = () => {
    switch (state.phase) {
      case "generating_sql":
        return "Generating schema-aware SQL...";
      case "executing":
        return "Executing query against DuckDB...";
      case "explaining":
        return "Streaming results and explaining...";
      case "done":
        return "Query completed successfully";
      case "error":
        return `Error: ${state.error || "Something went wrong"}`;
      default:
        return "";
    }
  };

  const getPhaseClass = () => {
    switch (state.phase) {
      case "generating_sql":
      case "executing":
      case "explaining":
        return "status-badge generating pulse";
      case "done":
        return "status-badge success";
      case "error":
        return "status-badge error";
      default:
        return "";
    }
  };

  const runQuestion = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setActiveQuestion(trimmed);
    lastRecordedKey.current = "";
    submitQuery(trimmed);
  };

  const saveToDashboard = () => {
    if (!state.meta || !state.sql) return;
    const title = chartConfig.title || activeQuestion || "Dashboard card";
    const card: DashboardCard = {
      id: crypto.randomUUID(),
      title,
      question: activeQuestion || question,
      sql: state.sql,
      columns: state.columns,
      rows: state.rows,
      columnTypes: state.columnTypes,
      explanation: state.explanation,
      meta: state.meta,
      chartConfig: { ...chartConfig, title },
      createdAt: new Date().toISOString(),
    };
    persistDashboardCards([card, ...dashboardCards]);
  };

  const updateDashboardCard = (id: string, patch: Partial<DashboardCard>) => {
    persistDashboardCards(
      dashboardCards.map((card) => (card.id === id ? { ...card, ...patch } : card))
    );
  };

  const moveDashboardCard = (id: string, direction: -1 | 1) => {
    const index = dashboardCards.findIndex((card) => card.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= dashboardCards.length) return;
    const next = [...dashboardCards];
    const [card] = next.splice(index, 1);
    next.splice(nextIndex, 0, card);
    persistDashboardCards(next);
  };

  const addMetric = () => {
    if (!metricDraft.name.trim() || !metricDraft.formula.trim()) return;
    persistMetrics([
      {
        id: crypto.randomUUID(),
        name: metricDraft.name.trim(),
        formula: metricDraft.formula.trim(),
        description: metricDraft.description.trim(),
        createdAt: new Date().toISOString(),
      },
      ...metrics,
    ]);
    setMetricDraft({ name: "", formula: "", description: "" });
  };

  const exportDashboard = () => {
    window.print();
  };

  const runEditedSql = (sql: string) => {
    const fallbackQuestion = question.trim() || activeQuestion || "Run edited SQL";
    setActiveQuestion(fallbackQuestion);
    lastRecordedKey.current = "";
    submitQuery(fallbackQuestion, sql);
  };

  const saveCurrentQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed || savedQuestions.some((item) => item.question === trimmed)) return;
    persistSavedQuestions([
      { id: crypto.randomUUID(), question: trimmed, createdAt: new Date().toISOString() },
      ...savedQuestions,
    ]);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadStatus("Uploading dataset...");
    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/datasets/upload", { method: "POST", body });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Upload failed");
      }
      await Promise.all([fetchSchema(), fetchDatasets()]);
      setUploadStatus("Dataset uploaded and schema refreshed");
    } catch (error) {
      setUploadStatus((error as Error).message);
    } finally {
      event.target.value = "";
    }
  };

  const refreshSchema = async () => {
    setUploadStatus("Refreshing schema...");
    try {
      await fetch("/api/schema/refresh", { method: "POST" });
      await Promise.all([fetchSchema(), fetchDatasets()]);
      setUploadStatus("Schema refreshed");
    } catch {
      setUploadStatus("Schema refresh failed");
    }
  };

  const clarifyingQuestions = getClarifyingQuestions(question);
  const trace = deriveTrace(state.sql, state.columns, schema);

  return (
    <main className="container">
      <style jsx>{`
        .layout-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
          width: 100%;
        }
        @media (min-width: 992px) {
          .layout-grid {
            grid-template-columns: 8fr 3fr;
          }
        }
        .main-content,
        .sidebar-stack {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .schema-sidebar,
        .side-panel {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
          height: fit-content;
          max-height: 80vh;
          overflow-y: auto;
        }
        .schema-title,
        .panel-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 0.5rem;
        }
        .schema-title {
          cursor: pointer;
        }
        .panel-title button,
        .small-btn,
        .upload-label {
          border: 1px solid var(--border-subtle);
          background: rgba(31, 138, 91, 0.08);
          color: var(--accent-primary);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.35rem 0.55rem;
        }
        .panel-title button:hover,
        .small-btn:hover,
        .upload-label:hover {
          background: rgba(31, 138, 91, 0.14);
        }
        .table-item,
        .dataset-item,
        .list-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .table-header,
        .dataset-name {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--accent-primary);
          padding: 0.25rem 0.5rem;
          background: rgba(31, 138, 91, 0.08);
          border-radius: 4px;
        }
        .column-list {
          padding-left: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }
        .column-item,
        .dataset-meta {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.15rem 0.25rem;
        }
        .column-type,
        .muted {
          color: var(--text-muted);
        }
        .status-container {
          min-height: 28px;
          display: flex;
          align-items: center;
        }
        .workspace-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .insight-panel,
        .dashboard-panel {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
        }
        .section-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 0.6rem;
        }
        .section-heading h2 {
          font-size: 1rem;
          line-height: 1.2;
        }
        .clarifier-list,
        .trace-grid,
        .metric-list,
        .dashboard-grid {
          display: grid;
          gap: 0.75rem;
        }
        .trace-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .trace-item {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.62);
          padding: 0.75rem;
        }
        .trace-item span {
          display: block;
          color: var(--text-muted);
          font-size: 0.72rem;
          font-weight: 700;
          margin-bottom: 0.35rem;
          text-transform: uppercase;
        }
        .trace-item strong {
          color: var(--text-primary);
          font-size: 0.9rem;
        }
        .dashboard-grid {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }
        .dashboard-card {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: rgba(255, 255, 255, 0.72);
          padding: 1rem;
        }
        .dashboard-card-header,
        .metric-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
        }
        .dashboard-title-input,
        .metric-input {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          background: #ffffff;
          font: inherit;
          font-size: 0.82rem;
          padding: 0.4rem 0.5rem;
          outline: none;
          width: 100%;
        }
        .metric-form {
          display: grid;
          grid-template-columns: 1fr 1.2fr 1.4fr auto;
          gap: 0.5rem;
        }
        .sidebar-stack .metric-form {
          grid-template-columns: 1fr;
        }
        .metric-card {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.58);
          padding: 0.7rem;
        }
        .print-only {
          display: none;
        }
        .list-item {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 0.65rem;
          background: rgba(255, 255, 255, 0.58);
        }
        .list-item strong {
          font-size: 0.82rem;
          line-height: 1.35;
        }
        .item-actions {
          display: flex;
          gap: 0.4rem;
          margin-top: 0.35rem;
        }
        .upload-input {
          display: none;
        }
        .upload-status {
          font-size: 0.78rem;
          color: var(--text-secondary);
        }
        .column-preview {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          padding: 0 0.25rem;
        }
        .column-chip {
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--text-secondary);
          font-size: 0.7rem;
          padding: 0.1rem 0.45rem;
        }
        .dictionary-field {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 0.65rem;
          background: rgba(255, 255, 255, 0.58);
        }
        .dictionary-field label {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          color: var(--text-secondary);
          font-size: 0.72rem;
          font-weight: 700;
        }
        .dictionary-field input {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          background: #ffffff;
          font: inherit;
          font-size: 0.78rem;
          padding: 0.35rem 0.45rem;
          outline: none;
        }
        .dictionary-field input:focus {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-glow);
        }
        @media (max-width: 900px) {
          .trace-grid,
          .metric-form {
            grid-template-columns: 1fr;
          }
        }
        @media print {
          body {
            background: #ffffff !important;
          }
          .app-header,
          .sidebar-stack,
          .query-input-container,
          .workspace-actions,
          .insight-panel,
          .status-container {
            display: none !important;
          }
          .layout-grid {
            display: block;
          }
          .print-only {
            display: block;
          }
        }
      `}</style>

      <header className="app-header">
        <div className="logo-section">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <h1>Retrieval-Augmented Analytics <span className="gradient-text">Dashboard</span></h1>
        </div>
        <div className="status-container">
          {state.phase !== "idle" && (
            <div className={getPhaseClass()}>
              {state.phase === "done" && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {state.phase === "error" && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              )}
              <span>{getPhaseText()}</span>
            </div>
          )}
        </div>
      </header>

      <div className="layout-grid">
        <div className="main-content">
          <QueryInput
            question={question}
            onQuestionChange={setQuestion}
            onSubmit={runQuestion}
            isStreaming={state.isStreaming}
            onCancel={cancel}
          />

          <div className="workspace-actions">
            <button type="button" className="small-btn" onClick={saveCurrentQuestion}>
              Save question
            </button>
            <button type="button" className="small-btn" onClick={refreshSchema}>
              Refresh schema
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={saveToDashboard}
              disabled={!state.meta || !state.sql}
            >
              Save to dashboard
            </button>
          </div>

          {clarifyingQuestions.length > 0 && state.phase === "idle" && (
            <section className="insight-panel glass-card">
              <div className="section-heading">
                <h2>Clarify Before Running</h2>
              </div>
              <div className="clarifier-list">
                {clarifyingQuestions.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="small-btn"
                    onClick={() => setQuestion(`${question.trim()} (${prompt})`)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}
          
          <SqlPanel
            key={state.sql || "sql-panel"}
            sql={state.sql}
            isLoading={state.phase === "generating_sql"}
            isStreaming={state.isStreaming}
            onRunSql={runEditedSql}
          />
          
          {state.meta && (
            <ChartRenderer
              columns={state.columns}
              rows={state.rows}
              columnTypes={state.columnTypes}
              isStreaming={state.isStreaming}
              config={chartConfig}
              onConfigChange={setChartConfig}
            />
          )}

          <ExplanationPanel
            explanation={state.explanation}
            isStreaming={state.isStreaming && state.phase === "explaining"}
            meta={state.meta}
          />

          {state.phase === "error" && state.error && (
            <div className="glass-card fade-in" style={{ padding: "1.25rem", borderLeft: "4px solid var(--error)", background: "rgba(194, 65, 61, 0.08)", marginTop: "1rem" }} data-testid="error-message">
              <strong style={{ color: "var(--error)", display: "block", marginBottom: "0.25rem" }}>Query Failed</strong>
              <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{state.error}</p>
            </div>
          )}

          {state.sql && (
            <section className="insight-panel glass-card">
              <div className="section-heading">
                <h2>Answer Trace</h2>
              </div>
              <div className="trace-grid">
                <div className="trace-item">
                  <span>Source tables</span>
                  <strong>{trace.tables.length ? trace.tables.join(", ") : "Not detected"}</strong>
                </div>
                <div className="trace-item">
                  <span>Columns</span>
                  <strong>{trace.columns.length ? trace.columns.join(", ") : "Not detected"}</strong>
                </div>
                <div className="trace-item">
                  <span>Calculation</span>
                  <strong>{trace.calculation}</strong>
                </div>
              </div>
            </section>
          )}

          <section className="dashboard-panel glass-card">
            <div className="section-heading">
              <h2>Dashboard</h2>
              <div className="workspace-actions">
                <button type="button" className="small-btn" onClick={exportDashboard}>
                  Export PDF
                </button>
                <button type="button" className="small-btn" onClick={() => persistDashboardCards([])}>
                  Clear
                </button>
              </div>
            </div>
            <div className="print-only">
              <h1>Retrieval-Augmented Analytics Dashboard</h1>
            </div>
            {dashboardCards.length === 0 && <span className="muted">No dashboard cards saved yet.</span>}
            <div className="dashboard-grid">
              {dashboardCards.map((card, index) => (
                <article key={card.id} className="dashboard-card">
                  <div className="dashboard-card-header">
                    <input
                      className="dashboard-title-input"
                      value={card.title}
                      onChange={(event) => updateDashboardCard(card.id, {
                        title: event.target.value,
                        chartConfig: { ...card.chartConfig, title: event.target.value },
                      })}
                    />
                    <div className="item-actions">
                      <button type="button" className="small-btn" onClick={() => moveDashboardCard(card.id, -1)} disabled={index === 0}>Up</button>
                      <button type="button" className="small-btn" onClick={() => moveDashboardCard(card.id, 1)} disabled={index === dashboardCards.length - 1}>Down</button>
                      <button type="button" className="small-btn" onClick={() => persistDashboardCards(dashboardCards.filter((item) => item.id !== card.id))}>Remove</button>
                    </div>
                  </div>
                  <span className="muted">{card.question}</span>
                  <ChartRenderer
                    columns={card.columns}
                    rows={card.rows}
                    columnTypes={card.columnTypes}
                    isStreaming={false}
                    config={card.chartConfig}
                    onConfigChange={(nextConfig) => updateDashboardCard(card.id, { chartConfig: nextConfig, title: nextConfig.title || card.title })}
                    compact
                  />
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="sidebar-stack">
          <aside className="side-panel glass-card">
            <div className="panel-title">
              <span>Metric Layer</span>
              <button type="button" onClick={addMetric}>Add</button>
            </div>
            <div className="metric-form">
              <input
                className="metric-input"
                value={metricDraft.name}
                onChange={(event) => setMetricDraft({ ...metricDraft, name: event.target.value })}
                placeholder="Metric name"
              />
              <input
                className="metric-input"
                value={metricDraft.formula}
                onChange={(event) => setMetricDraft({ ...metricDraft, formula: event.target.value })}
                placeholder="SQL formula"
              />
              <input
                className="metric-input"
                value={metricDraft.description}
                onChange={(event) => setMetricDraft({ ...metricDraft, description: event.target.value })}
                placeholder="Business definition"
              />
            </div>
            {metrics.length === 0 && <span className="muted">No reusable metrics yet.</span>}
            <div className="metric-list">
              {metrics.map((metric) => (
                <div key={metric.id} className="metric-card">
                  <div className="metric-row">
                    <strong>{metric.name}</strong>
                    <button
                      type="button"
                      className="small-btn"
                      onClick={() => setQuestion(`Show ${metric.name} using ${metric.formula}`)}
                    >
                      Use
                    </button>
                  </div>
                  <span className="muted">{metric.formula}</span>
                  {metric.description && <p className="muted">{metric.description}</p>}
                </div>
              ))}
            </div>
          </aside>

          <aside className="side-panel glass-card">
            <div className="panel-title">
              <span>Datasets</span>
              <label className="upload-label">
                Upload CSV
                <input className="upload-input" type="file" accept=".csv,text/csv" onChange={handleUpload} />
              </label>
            </div>
            {uploadStatus && <span className="upload-status">{uploadStatus}</span>}
            {datasets.map((dataset) => (
              <div key={`${dataset.source}-${dataset.tableName}`} className="dataset-item">
                <div className="dataset-name">{dataset.tableName}</div>
                <div className="dataset-meta muted"><span>{dataset.source}</span><span>{dataset.rowCount.toLocaleString()} rows</span></div>
                <div className="dataset-meta muted"><span>{dataset.fileName}</span><span>{formatBytes(dataset.sizeBytes)}</span></div>
                <div className="column-preview">
                  {dataset.columns.slice(0, 6).map((column) => (
                    <span key={column.name} className="column-chip">{column.name}</span>
                  ))}
                  {dataset.columns.length > 6 && (
                    <span className="column-chip">+{dataset.columns.length - 6}</span>
                  )}
                </div>
              </div>
            ))}
          </aside>

          <aside className="side-panel glass-card">
            <div className="panel-title">
              <span>Saved Questions</span>
              <button type="button" onClick={() => persistSavedQuestions([])}>Clear</button>
            </div>
            {savedQuestions.length === 0 && <span className="muted">No saved questions yet.</span>}
            {savedQuestions.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.question}</strong>
                <span className="muted">{formatDate(item.createdAt)}</span>
                <div className="item-actions">
                  <button type="button" className="small-btn" onClick={() => setQuestion(item.question)}>Use</button>
                  <button type="button" className="small-btn" onClick={() => runQuestion(item.question)}>Run</button>
                </div>
              </div>
            ))}
          </aside>

          <aside className="side-panel glass-card">
            <div className="panel-title">
              <span>Query History</span>
              <button type="button" onClick={() => persistHistory([])}>Clear</button>
            </div>
            {history.length === 0 && <span className="muted">No query history yet.</span>}
            {history.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.question}</strong>
                <span className="muted">
                  {item.status} · {item.rowCount.toLocaleString()} rows · {formatDate(item.createdAt)}
                </span>
                {item.sql && <span className="muted">{item.sql}</span>}
                <div className="item-actions">
                  <button type="button" className="small-btn" onClick={() => setQuestion(item.question)}>Use</button>
                  <button type="button" className="small-btn" onClick={() => runQuestion(item.question)}>Run</button>
                </div>
              </div>
            ))}
          </aside>

          <aside className="side-panel glass-card">
            <div className="panel-title">
              <span>Data Dictionary</span>
              <button
                type="button"
                onClick={() => {
                  setDictionary({});
                  localStorage.removeItem(DICTIONARY_KEY);
                }}
              >
                Clear
              </button>
            </div>
            {!schema && <span className="muted">Load schema to edit dictionary metadata.</span>}
            {schema?.tables.map((table) => (
              <div key={table.name} className="table-item">
                <div className="table-header">{table.name}</div>
                {table.columns.map((column) => {
                  const key = `${table.name}.${column.name}`;
                  return (
                    <div key={key} className="dictionary-field">
                      <strong>{column.name}</strong>
                      <span className="muted">{column.type}</span>
                      <label>
                        Description
                        <input
                          value={dictionary[key]?.description || ""}
                          onChange={(event) =>
                            updateDictionary(key, "description", event.target.value)
                          }
                          placeholder="Business meaning"
                        />
                      </label>
                      <label>
                        Synonyms
                        <input
                          value={dictionary[key]?.synonyms || ""}
                          onChange={(event) =>
                            updateDictionary(key, "synonyms", event.target.value)
                          }
                          placeholder="Comma-separated aliases"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </aside>

          <aside className="schema-sidebar glass-card">
            <div className="schema-title" onClick={() => setSchemaOpen(!schemaOpen)}>
              <span>Schema Explorer</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: schemaOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            {schemaOpen && schema && (
              <div className="fade-in">
                {schema.tables.map((table, tIdx) => (
                  <div key={tIdx} className="table-item">
                    <div className="table-header">{table.name}</div>
                    <div className="column-list">
                      {table.columns.map((col, cIdx) => (
                        <div key={cIdx} className="column-item">
                          <span>{col.name}</span>
                          <span className="column-type">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
