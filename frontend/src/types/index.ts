export type QueryValue = string | number | boolean | null;

export interface QueryState {
  sql: string | null;
  columns: string[];
  columnTypes: Record<string, string>;
  rows: QueryValue[][];
  explanation: string;
  meta: QueryMeta | null;
  error: string | null;
  isStreaming: boolean;
  phase: "idle" | "generating_sql" | "executing" | "explaining" | "done" | "error";
}

export interface QueryMeta {
  rowCount: number;
  durationMs: number;
  cached: boolean;
  columns: string[];
  columnTypes: Record<string, string>;
}

export type ChartType = "auto" | "kpi" | "bar" | "line" | "table";

export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string }>;
}

export interface QueryHistoryEntry {
  id: string;
  question: string;
  sql: string | null;
  status: "done" | "error";
  rowCount: number;
  durationMs: number;
  createdAt: string;
  error?: string | null;
}

export interface SavedQuestion {
  id: string;
  question: string;
  createdAt: string;
}

export interface DatasetSummary {
  tableName: string;
  fileName: string;
  source: "sample" | "uploaded";
  sizeBytes: number;
  rowCount: number;
  columns: Array<{ name: string; type: string }>;
}

export interface DataDictionaryEntry {
  description: string;
  synonyms: string;
}

export interface ChartConfig {
  title: string;
  chartType: ChartType;
  xAxisLabel: string;
  yAxisLabel: string;
  color: string;
}

export interface DashboardCard {
  id: string;
  title: string;
  question: string;
  sql: string | null;
  columns: string[];
  rows: QueryValue[][];
  columnTypes: Record<string, string>;
  explanation: string;
  meta: QueryMeta | null;
  chartConfig: ChartConfig;
  createdAt: string;
}

export interface MetricDefinition {
  id: string;
  name: string;
  formula: string;
  description: string;
  createdAt: string;
}

export interface AnswerTrace {
  tables: string[];
  columns: string[];
  calculation: string;
}
