"use client";

import React, { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
} from "recharts";
import { QueryValue } from "@/types";
import ResultTable from "./ResultTable";

interface ChartRendererProps {
  columns: string[];
  rows: QueryValue[][];
  columnTypes: Record<string, string>;
  isStreaming: boolean;
}

export default function ChartRenderer({
  columns,
  rows,
  columnTypes,
  isStreaming,
}: ChartRendererProps) {
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");

  // Determine chart compatibility
  const hasData = rows.length > 0 && columns.length > 0;
  const isKpi = columns.length === 1 && rows.length === 1;
  
  const isNumeric = (val: QueryValue) => typeof val === "number" && !isNaN(val);
  
  const hasTwoCols = columns.length === 2;
  const isCol1Numeric = hasTwoCols && rows.every(r => isNumeric(r[1]) || r[1] === null);
  
  const col0Name = hasTwoCols ? columns[0].toLowerCase() : "";
  const isCol0Date = hasTwoCols && (
    col0Name.includes("date") || 
    col0Name.includes("month") || 
    col0Name.includes("year") || 
    col0Name.includes("day") || 
    /^\d{4}-\d{2}$/.test(String(rows[0]?.[0]))
  );

  const canShowLineChart = hasTwoCols && isCol1Numeric && isCol0Date;
  const canShowBarChart = hasTwoCols && isCol1Numeric && !isCol0Date && rows.length <= 20;
  
  const hasChart = isKpi || canShowLineChart || canShowBarChart;
  const selectedTab = hasChart ? activeTab : "table";

  if (!hasData) {
    return (
      <ResultTable
        columns={columns}
        rows={rows}
        columnTypes={columnTypes}
        isStreaming={isStreaming}
      />
    );
  }

  // Format data for Recharts
  const chartData = rows.map((row) => ({
    name: String(row[0]),
    value: Number(row[1]),
  }));

  const valueName = columns[1] || "Value";

  const renderKpi = () => {
    const kpiVal = rows[0][0];
    const kpiLabel = columns[0];
    const formattedKpi = typeof kpiVal === "number" 
      ? kpiVal.toLocaleString() 
      : String(kpiVal);

    return (
      <div className="kpi-card glass-card fade-in">
        <style jsx>{`
          .kpi-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem 2rem;
            text-align: center;
            width: 100%;
            margin-top: 1rem;
            min-height: 200px;
          }
          .kpi-value {
            font-size: 3.5rem;
            font-weight: 800;
            color: var(--accent-primary);
            line-height: 1.1;
            margin-bottom: 0.5rem;
          }
          .kpi-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 600;
          }
        `}</style>
        <span className="kpi-value">{formattedKpi}</span>
        <span className="kpi-label">{kpiLabel}</span>
      </div>
    );
  };

  const renderChart = () => {
    if (isKpi) return renderKpi();

    return (
      <div className="chart-wrapper glass-card fade-in">
        <style jsx>{`
          .chart-wrapper {
            padding: 1.5rem;
            margin-top: 1rem;
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            width: 100%;
            height: 350px;
          }
        `}</style>

        <ResponsiveContainer width="100%" height="100%">
          {canShowLineChart ? (
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="var(--text-secondary)" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  background: "#ffffff", 
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  boxShadow: "var(--shadow-card)"
                }}
                labelStyle={{ color: "var(--text-secondary)", fontWeight: "bold" }}
                formatter={(value: unknown) => [Number(value).toLocaleString(), valueName]}
              />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke="var(--accent-primary)" 
                strokeWidth={3}
                dot={{ fill: "var(--accent-primary)", r: 4 }}
                activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2 }}
              />
            </LineChart>
          ) : (
            <BarChart data={chartData} layout="horizontal" margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="var(--text-secondary)" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  background: "#ffffff", 
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  boxShadow: "var(--shadow-card)"
                }}
                labelStyle={{ color: "var(--text-secondary)", fontWeight: "bold" }}
                formatter={(value: unknown) => [Number(value).toLocaleString(), valueName]}
              />
              <Bar 
                dataKey="value" 
                fill="var(--accent-primary)" 
                radius={[4, 4, 0, 0]}
                maxBarSize={50}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="tab-chart-renderer">
      <style jsx>{`
        .tab-chart-renderer {
          width: 100%;
        }
        .tabs {
          display: flex;
          gap: 0.5rem;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 0.5rem;
          margin-top: 1.5rem;
        }
        .tab-btn {
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-secondary);
          padding: 0.5rem 1rem;
          font-weight: 500;
          font-size: 0.9rem;
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: background var(--transition), color var(--transition);
        }
        .tab-btn:hover:not(:disabled) {
          color: var(--text-primary);
          background: var(--bg-card-hover);
        }
        .tab-btn.active {
          color: var(--accent-primary);
          background: rgba(31, 138, 91, 0.08);
          font-weight: 600;
        }
        .tab-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
      `}</style>

      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${selectedTab === "chart" ? "active" : ""}`}
          onClick={() => setActiveTab("chart")}
          disabled={!hasChart}
        >
          Chart
        </button>
        <button
          type="button"
          className={`tab-btn ${selectedTab === "table" ? "active" : ""}`}
          onClick={() => setActiveTab("table")}
        >
          Table
        </button>
      </div>

      <div className="tab-content">
        {selectedTab === "chart" ? renderChart() : (
          <ResultTable
            columns={columns}
            rows={rows}
            columnTypes={columnTypes}
            isStreaming={isStreaming}
          />
        )}
      </div>
    </div>
  );
}
