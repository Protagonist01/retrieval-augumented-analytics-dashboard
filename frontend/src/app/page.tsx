"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryStream } from "@/hooks/useQueryStream";
import QueryInput from "@/components/QueryInput";
import SqlPanel from "@/components/SqlPanel";
import ChartRenderer from "@/components/ChartRenderer";
import ExplanationPanel from "@/components/ExplanationPanel";
import {
  DataDictionaryEntry,
  DatasetSummary,
  QueryHistoryEntry,
  SavedQuestion,
  SchemaTable,
} from "@/types";

const HISTORY_KEY = "raa.queryHistory";
const SAVED_KEY = "raa.savedQuestions";
const DICTIONARY_KEY = "raa.dataDictionary";

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
          </div>
          
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
        </div>

        <div className="sidebar-stack">
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
