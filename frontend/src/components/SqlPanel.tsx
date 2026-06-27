"use client";

import React, { useState } from "react";

interface SqlPanelProps {
  sql: string | null;
  isLoading: boolean;
}

export default function SqlPanel({ sql, isLoading }: SqlPanelProps) {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  const handleCopy = async () => {
    if (sql) {
      try {
        await navigator.clipboard.writeText(sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy text: ", err);
      }
    }
  };

  const tokenizeSql = (text: string) => {
    const regex = /(\s+)|(--.*)|('.*?')|(\b(?:SELECT|FROM|JOIN|ON|WHERE|GROUP BY|ORDER BY|LIMIT|ROUND|SUM|COUNT|AVG|AS|AND|OR|IN|WITH|LEFT|RIGHT|INNER|OUTER|STRFTIME|YEAR|MONTH|CASE|WHEN|THEN|ELSE|END|RANK|OVER|PARTITION BY)\b)|(\b\d+(?:\.\d+)?\b)|(\w+)|([^\s\w]+)/gi;
    let match;
    const elements = [];
    let key = 0;
    
    // Reset regex lastIndex just in case
    regex.lastIndex = 0;
    
    while ((match = regex.exec(text)) !== null) {
      const [
        ,
        space,
        comment,
        str,
        keyword,
        num,
        word,
        symbol
      ] = match;
      
      if (space) {
        elements.push(<span key={key++}>{space}</span>);
      } else if (comment) {
        elements.push(<span key={key++} style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{comment}</span>);
      } else if (str) {
        elements.push(<span key={key++} style={{ color: "var(--success)" }}>{str}</span>);
      } else if (keyword) {
        elements.push(<span key={key++} style={{ color: "var(--accent-primary)", fontWeight: "bold" }}>{keyword.toUpperCase()}</span>);
      } else if (num) {
        elements.push(<span key={key++} style={{ color: "var(--warning)" }}>{num}</span>);
      } else if (word) {
        elements.push(<span key={key++}>{word}</span>);
      } else if (symbol) {
        elements.push(<span key={key++} style={{ color: "var(--text-secondary)" }}>{symbol}</span>);
      }
    }
    return elements.length > 0 ? elements : [text];
  };

  if (!sql && !isLoading) return null;

  return (
    <div className="sql-panel glass-card fade-in" data-testid="sql-panel">
      <style jsx>{`
        .sql-panel {
          width: 100%;
          overflow: hidden;
          margin-top: 1rem;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1.25rem;
          background: rgba(237, 243, 232, 0.72);
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
        }
        .header-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .db-chip {
          background: rgba(31, 138, 91, 0.12);
          color: var(--accent-primary);
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .btn-action {
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 0.3rem;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--transition), color var(--transition);
        }
        .btn-action:hover {
          background: var(--bg-card-hover);
          color: var(--text-primary);
        }
        .btn-copy-text {
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          background: rgba(31, 138, 91, 0.08);
        }
        .content {
          max-height: ${isOpen ? "300px" : "0px"};
          overflow: auto;
          transition: max-height var(--transition-slow);
        }
        .code-container {
          padding: 1.25rem;
          margin: 0;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.9rem;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
          background: var(--bg-code);
          color: var(--text-code);
        }
        .skeleton {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          padding: 1.25rem;
          background: var(--bg-code);
        }
        .shimmer-line {
          height: 12px;
          background: linear-gradient(90deg, #e5eadf 25%, #f6f8f2 50%, #e5eadf 75%);
          background-size: 200% 100%;
          animation: loading-shimmer 1.5s infinite linear;
          border-radius: 4px;
        }
        @keyframes loading-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div className="header" onClick={() => setIsOpen(!isOpen)}>
        <div className="header-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}><polyline points="9 18 15 12 9 6"/></svg>
          <span>Generated SQL</span>
          <span className="db-chip">DUCKDB</span>
        </div>
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {sql && (
            <button className="btn-action btn-copy-text" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      </div>

      <div className="content">
        {isLoading ? (
          <div className="skeleton">
            <div className="shimmer-line" style={{ width: "80%" }}></div>
            <div className="shimmer-line" style={{ width: "95%" }}></div>
            <div className="shimmer-line" style={{ width: "60%" }}></div>
          </div>
        ) : (
          <pre className="code-container">
            <code>{sql ? tokenizeSql(sql) : ""}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
