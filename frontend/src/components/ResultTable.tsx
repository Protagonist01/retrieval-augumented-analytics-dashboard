"use client";

import React from "react";
import { QueryValue } from "@/types";

interface ResultTableProps {
  columns: string[];
  rows: QueryValue[][];
  columnTypes: Record<string, string>;
  isStreaming: boolean;
}

export default function ResultTable({ columns, rows, columnTypes, isStreaming }: ResultTableProps) {
  const escapeCsvValue = (value: QueryValue) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  };

  const exportCsv = () => {
    const csv = [
      columns.map(escapeCsvValue).join(","),
      ...rows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `query-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const isDateColumn = (colName: string, colType?: string): boolean => {
    const type = (colType || "").toUpperCase();
    const name = colName.toLowerCase();
    return type.includes("DATE") || type.includes("TIMESTAMP") || name.includes("date");
  };

  const isNumericColumn = (colName: string, colType?: string): boolean => {
    const type = (colType || "").toUpperCase();
    return (
      type.includes("INT") || 
      type.includes("DECIMAL") || 
      type.includes("DOUBLE") || 
      type.includes("FLOAT") || 
      type.includes("NUMERIC") || 
      type.includes("BIGINT")
    );
  };

  const isCurrencyColumn = (colName: string): boolean => {
    const name = colName.toLowerCase();
    return (
      name.includes("revenue") || 
      name.includes("spend") || 
      name.includes("price") || 
      name.includes("amount") || 
      name.includes("value") ||
      name.includes("cost")
    );
  };

  const formatCellValue = (val: QueryValue, colName: string, colType?: string) => {
    if (val === null || val === undefined) {
      return <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>NULL</span>;
    }

    const name = colName.toLowerCase();

    // 1. Status Column Formatting
    if (name === "status") {
      const valStr = String(val).toLowerCase();
      let colorClass = "badge-plum";
      if (valStr === "completed" || valStr === "shipped") colorClass = "badge-green";
      else if (valStr === "cancelled" || valStr === "returned") colorClass = "badge-red";
      else if (valStr === "pending") colorClass = "badge-yellow";
      
      return <span className={`badge ${colorClass}`}>{String(val)}</span>;
    }

    // 2. Date Column Formatting
    if (isDateColumn(colName, colType)) {
      try {
        const d = new Date(String(val));
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        }
      } catch {
        // Fallback
      }
    }

    // 3. Numeric & Currency Formatting
    if (typeof val === "number" || isNumericColumn(colName, colType)) {
      const num = Number(val);
      if (!isNaN(num)) {
        if (isCurrencyColumn(colName)) {
          return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (Number.isInteger(num)) {
          return num.toLocaleString();
        }
        return num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
      }
    }

    return String(val);
  };

  const getAlignment = (colName: string, colType?: string): "right" | "left" | "center" => {
    if (isNumericColumn(colName, colType)) return "right";
    if (colName.toLowerCase() === "status") return "center";
    return "left";
  };

  if (columns.length === 0) {
    return (
      <div className="empty-state glass-card fade-in" data-testid="result-table">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M3 3h18v18H3z"/><path d="M21 9H3"/><path d="M21 15H3"/><path d="M12 3v18"/></svg>
        <span>No results returned</span>
      </div>
    );
  }

  return (
    <div className={`table-container glass-card fade-in ${isStreaming ? "streaming-pulse" : ""}`} data-testid="result-table">
      <style jsx>{`
        .table-container {
          width: 100%;
          max-height: 400px;
          overflow: auto;
          margin-top: 1rem;
          position: relative;
        }
        .table-actions {
          position: sticky;
          top: 0;
          display: flex;
          justify-content: flex-end;
          padding: 0.6rem 0.75rem;
          background: rgba(255, 255, 255, 0.92);
          border-bottom: 1px solid var(--border-subtle);
          z-index: 15;
        }
        .export-btn {
          border: 1px solid var(--border-subtle);
          background: rgba(31, 138, 91, 0.08);
          color: var(--accent-primary);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.35rem 0.65rem;
        }
        .export-btn:hover {
          background: rgba(31, 138, 91, 0.14);
        }
        .streaming-pulse {
          border-color: rgba(31, 138, 91, 0.4);
          animation: pulse-border 2s infinite ease-in-out;
        }
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(31, 138, 91, 0.15); }
          50% { border-color: rgba(31, 138, 91, 0.5); }
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }
        th {
          position: sticky;
          top: 0;
          background: #f3f6ee;
          color: var(--text-secondary);
          font-weight: 600;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-subtle);
          z-index: 10;
        }
        td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        tr:nth-child(even) {
          background: rgba(237, 243, 232, 0.45);
        }
        tr:hover {
          background: rgba(31, 138, 91, 0.06);
        }
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 3rem;
          color: var(--text-muted);
          border-radius: var(--radius-lg);
          margin-top: 1rem;
        }
        .badge {
          display: inline-block;
          padding: 0.15rem 0.5rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
        }
        .badge-green {
          background: rgba(35, 138, 88, 0.12);
          color: #1f7a4f;
          border: 1px solid rgba(35, 138, 88, 0.22);
        }
        .badge-red {
          background: rgba(194, 65, 61, 0.12);
          color: #a63835;
          border: 1px solid rgba(194, 65, 61, 0.22);
        }
        .badge-yellow {
          background: rgba(182, 106, 0, 0.12);
          color: #955800;
          border: 1px solid rgba(182, 106, 0, 0.22);
        }
        .badge-plum {
          background: rgba(139, 90, 122, 0.12);
          color: #7b4e6c;
          border: 1px solid rgba(139, 90, 122, 0.22);
        }
      `}</style>

      <div className="table-actions">
        <button type="button" className="export-btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th 
                key={idx} 
                style={{ textAlign: getAlignment(col, columnTypes[col]) }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => {
                const colName = columns[cellIdx];
                return (
                  <td 
                    key={cellIdx} 
                    style={{ textAlign: getAlignment(colName, columnTypes[colName]) }}
                  >
                    {formatCellValue(cell, colName, columnTypes[colName])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
