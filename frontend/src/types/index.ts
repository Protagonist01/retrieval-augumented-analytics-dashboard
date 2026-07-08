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

export interface EvalRunSummary {
  fileName: string;
  timestamp: string;
  metrics: Record<string, number>;
  failedCases: Array<{
    id: string;
    nl: string;
    expected_sql: string;
    generated_sql: string | null;
    match: boolean;
    validation_failed: boolean;
    latency_ms: number;
  }>;
}

export interface EvalSummary {
  totalCases: number;
  difficulties: Record<string, number>;
  latestRun: EvalRunSummary | null;
  runs: EvalRunSummary[];
}

export interface ModelComparison {
  model: string;
  status: string;
  accuracy?: number | null;
  sqlValidity?: number | null;
  p95LatencyMs?: number | null;
  notes: string;
}

export interface AdminStatus {
  status: string;
  version: string;
  generatedAt: string;
  cache: {
    enabled: boolean;
    schemaKeys: number;
    queryKeys: number;
  };
  datasets: {
    count: number;
    uploaded: number;
  };
  connectors: {
    count: number;
  };
  authMode: string;
}

export interface ConnectorConfig {
  id?: string;
  name: string;
  kind: "postgres" | "mysql" | "supabase" | "bigquery" | "snowflake";
  host: string;
  database: string;
  username: string;
  project: string;
  notes: string;
  status?: string;
  createdAt?: string;
}

export interface WorkspaceProfile {
  name: string;
  role: "admin" | "analyst" | "viewer";
  allowedTables: string[];
}
