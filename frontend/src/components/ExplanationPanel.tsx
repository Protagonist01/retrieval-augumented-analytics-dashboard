"use client";

import React from "react";
import { QueryMeta } from "@/types";

interface ExplanationPanelProps {
  explanation: string;
  isStreaming: boolean;
  meta: QueryMeta | null;
}

export default function ExplanationPanel({ explanation, isStreaming, meta }: ExplanationPanelProps) {
  if (!explanation && !isStreaming && !meta) return null;

  const durationSec = meta ? (meta.durationMs / 1000.0).toFixed(2) : null;

  return (
    <div className="explanation-panel glass-card fade-in" data-testid="explanation-panel">
      <style jsx>{`
        .explanation-panel {
          width: 100%;
          padding: 1.5rem;
          margin-top: 1.5rem;
          border-left: 4px solid var(--accent-purple);
          background: linear-gradient(90deg, rgba(139, 90, 122, 0.08) 0%, rgba(255, 255, 255, 0.82) 100%);
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--accent-purple-light);
        }
        .body-text {
          font-size: 1rem;
          line-height: 1.6;
          color: var(--text-primary);
          white-space: pre-wrap;
        }
        .meta-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border-subtle);
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        .cached-badge {
          background: rgba(35, 138, 88, 0.12);
          color: #1f7a4f;
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 700;
        }
      `}</style>

      <div className="header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span>AI Analysis</span>
      </div>

      <div className="body-text">
        {explanation}
        {isStreaming && <span className="cursor" />}
      </div>

      {meta && (
        <div className="meta-bar">
          <div className="meta-item">
            <strong>Rows:</strong>
            <span>{meta.rowCount}</span>
          </div>
          <div className="meta-item">
            <strong>Latency:</strong>
            <span>{durationSec}s</span>
          </div>
          {meta.cached && (
            <div className="meta-item">
              <span className="cached-badge">CACHED</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
