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
import { ChartConfig, ChartType, QueryValue } from "@/types";
import ResultTable from "./ResultTable";

interface ChartRendererProps {
  columns: string[];
  rows: QueryValue[][];
  columnTypes: Record<string, string>;
  isStreaming: boolean;
  config?: ChartConfig;
  onConfigChange?: (config: ChartConfig) => void;
  showControls?: boolean;
  compact?: boolean;
}

const DEFAULT_CONFIG: ChartConfig = {
  title: "",
  chartType: "auto",
  xAxisLabel: "",
  yAxisLabel: "",
  color: "#1f8a5b",
};

function isNumeric(val: QueryValue) {
  return typeof val === "number" && !isNaN(val);
}

function getAutoChartType(columns: string[], rows: QueryValue[][]): Exclude<ChartType, "auto"> {
  const isKpi = columns.length === 1 && rows.length === 1;
  const hasTwoCols = columns.length === 2;
  const isCol1Numeric = hasTwoCols && rows.every((row) => isNumeric(row[1]) || row[1] === null);
  const col0Name = hasTwoCols ? columns[0].toLowerCase() : "";
  const isCol0Date = hasTwoCols && (
    col0Name.includes("date") ||
    col0Name.includes("month") ||
    col0Name.includes("year") ||
    col0Name.includes("day") ||
    /^\d{4}-\d{2}$/.test(String(rows[0]?.[0]))
  );

  if (isKpi) return "kpi";
  if (hasTwoCols && isCol1Numeric && isCol0Date) return "line";
  if (hasTwoCols && isCol1Numeric && rows.length <= 20) return "bar";
  return "table";
}

export default function ChartRenderer({
  columns,
  rows,
  columnTypes,
  isStreaming,
  config,
  onConfigChange,
  showControls = true,
  compact = false,
}: ChartRendererProps) {
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");
  const chartConfig = { ...DEFAULT_CONFIG, ...config };
  const hasData = rows.length > 0 && columns.length > 0;
  const autoType = getAutoChartType(columns, rows);
  const selectedChartType = chartConfig.chartType === "auto" ? autoType : chartConfig.chartType;
  const hasChart = selectedChartType !== "table";
  const selectedTab = hasChart ? activeTab : "table";
  const chartColor = chartConfig.color || DEFAULT_CONFIG.color;

  const updateConfig = (patch: Partial<ChartConfig>) => {
    onConfigChange?.({ ...chartConfig, ...patch });
  };

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

  const chartData = rows.map((row) => ({
    name: String(row[0]),
    value: Number(row[1]),
  }));

  const valueName = chartConfig.yAxisLabel || columns[1] || "Value";
  const displayTitle = chartConfig.title || columns.join(" by ");

  const renderKpi = () => {
    const kpiVal = rows[0][0];
    const kpiLabel = chartConfig.title || columns[0];
    const formattedKpi = typeof kpiVal === "number" ? kpiVal.toLocaleString() : String(kpiVal);

    return (
      <div className={`kpi-card glass-card fade-in ${compact ? "compact" : ""}`}>
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
          .kpi-card.compact {
            min-height: 150px;
            padding: 2rem 1rem;
          }
          .kpi-value {
            font-size: ${compact ? "2.35rem" : "3.5rem"};
            font-weight: 800;
            color: ${chartColor};
            line-height: 1.1;
            margin-bottom: 0.5rem;
          }
          .kpi-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            font-weight: 600;
          }
        `}</style>
        <span className="kpi-value">{formattedKpi}</span>
        <span className="kpi-label">{kpiLabel}</span>
      </div>
    );
  };

  const renderChart = () => {
    if (selectedChartType === "kpi") return renderKpi();
    if (selectedChartType === "table") {
      return (
        <ResultTable
          columns={columns}
          rows={rows}
          columnTypes={columnTypes}
          isStreaming={isStreaming}
        />
      );
    }

    return (
      <div className={`chart-wrapper glass-card fade-in ${compact ? "compact" : ""}`}>
        <style jsx>{`
          .chart-wrapper {
            padding: 1.5rem;
            margin-top: 1rem;
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            width: 100%;
            height: ${compact ? "260px" : "350px"};
          }
          .chart-title {
            font-weight: 800;
            color: var(--text-primary);
            margin-bottom: 0.75rem;
          }
        `}</style>

        <div className="chart-title">{displayTitle}</div>
        <ResponsiveContainer width="100%" height="85%">
          {selectedChartType === "line" ? (
            <LineChart data={chartData} margin={{ top: 15, right: 30, left: 10, bottom: 12 }}>
              <XAxis
                dataKey="name"
                stroke="var(--text-secondary)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                label={chartConfig.xAxisLabel ? { value: chartConfig.xAxisLabel, position: "insideBottom", offset: -8 } : undefined}
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
                  boxShadow: "var(--shadow-card)",
                }}
                labelStyle={{ color: "var(--text-secondary)", fontWeight: "bold" }}
                formatter={(value: unknown) => [Number(value).toLocaleString(), valueName]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={3}
                dot={{ fill: chartColor, r: 4 }}
                activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2 }}
              />
            </LineChart>
          ) : (
            <BarChart data={chartData} layout="horizontal" margin={{ top: 15, right: 30, left: 10, bottom: 12 }}>
              <XAxis
                dataKey="name"
                stroke="var(--text-secondary)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                label={chartConfig.xAxisLabel ? { value: chartConfig.xAxisLabel, position: "insideBottom", offset: -8 } : undefined}
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
                  boxShadow: "var(--shadow-card)",
                }}
                labelStyle={{ color: "var(--text-secondary)", fontWeight: "bold" }}
                formatter={(value: unknown) => [Number(value).toLocaleString(), valueName]}
              />
              <Bar dataKey="value" fill={chartColor} radius={[4, 4, 0, 0]} maxBarSize={50} />
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
        .controls {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .controls input,
        .controls select {
          width: 100%;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          background: #ffffff;
          font: inherit;
          font-size: 0.8rem;
          padding: 0.45rem 0.55rem;
          outline: none;
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
        @media (max-width: 900px) {
          .controls {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {showControls && onConfigChange && (
        <div className="controls">
          <input
            value={chartConfig.title}
            onChange={(event) => updateConfig({ title: event.target.value })}
            placeholder="Chart title"
          />
          <select
            value={chartConfig.chartType}
            onChange={(event) => updateConfig({ chartType: event.target.value as ChartType })}
          >
            <option value="auto">Auto</option>
            <option value="kpi">KPI</option>
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="table">Table</option>
          </select>
          <input
            value={chartConfig.xAxisLabel}
            onChange={(event) => updateConfig({ xAxisLabel: event.target.value })}
            placeholder="X-axis label"
          />
          <input
            value={chartConfig.yAxisLabel}
            onChange={(event) => updateConfig({ yAxisLabel: event.target.value })}
            placeholder="Y-axis label"
          />
          <input
            type="color"
            value={chartColor}
            onChange={(event) => updateConfig({ color: event.target.value })}
            aria-label="Chart color"
          />
        </div>
      )}

      {!compact && (
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
      )}

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
