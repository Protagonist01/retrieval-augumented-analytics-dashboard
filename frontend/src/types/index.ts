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

export type ChartType = "kpi" | "bar" | "line" | "table";

export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string }>;
}
