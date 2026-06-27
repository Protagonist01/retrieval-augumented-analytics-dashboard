"use client";

import React, { useState, useEffect } from "react";
import { useQueryStream } from "@/hooks/useQueryStream";
import QueryInput from "@/components/QueryInput";
import SqlPanel from "@/components/SqlPanel";
import ChartRenderer from "@/components/ChartRenderer";
import ExplanationPanel from "@/components/ExplanationPanel";
import { SchemaTable } from "@/types";

export default function Home() {
  const { state, submitQuery, cancel } = useQueryStream();
  const [schema, setSchema] = useState<{ tables: SchemaTable[] } | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(true);

  // Fetch database schema on mount
  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const response = await fetch("/api/schema");
        if (response.ok) {
          const data = await response.json();
          setSchema(data);
        }
      } catch (err) {
        console.error("Failed to load database schema metadata: ", err);
      }
    };
    fetchSchema();
  }, []);

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
        .main-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .schema-sidebar {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
          height: fit-content;
          max-height: 80vh;
          overflow-y: auto;
        }
        .schema-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 0.5rem;
          cursor: pointer;
        }
        .table-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }
        .table-header {
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
        .column-item {
          display: flex;
          justify-content: space-between;
          padding: 0.15rem 0.25rem;
        }
        .column-type {
          color: var(--text-muted);
        }
        .status-container {
          min-height: 28px;
          display: flex;
          align-items: center;
        }
      `}</style>

      {/* Header Bar */}
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

      {/* Main Workspace Layout */}
      <div className="layout-grid">
        {/* Main query interaction track */}
        <div className="main-content">
          <QueryInput
            onSubmit={submitQuery}
            isStreaming={state.isStreaming}
            onCancel={cancel}
          />
          
          <SqlPanel
            sql={state.sql}
            isLoading={state.phase === "generating_sql"}
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

        {/* Database schema explorer sidebar */}
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
    </main>
  );
}
