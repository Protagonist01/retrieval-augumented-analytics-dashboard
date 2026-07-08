import { useState, useCallback, useRef } from "react";
import { QueryState, QueryValue } from "@/types";

const initialState: QueryState = {
  sql: null,
  columns: [],
  columnTypes: {},
  rows: [],
  explanation: "",
  meta: null,
  error: null,
  isStreaming: false,
  phase: "idle",
};

interface ParsedEvent {
  type: string;
  data: Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function toColumnTypes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [key, String(val)])
  );
}

function toQueryRow(value: unknown): QueryValue[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      return item;
    }

    return String(item);
  });
}

function parseSSEBuffer(buffer: string): { parsed: ParsedEvent[]; remainder: string } {
  const parsed: ParsedEvent[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() || "";

  for (const part of parts) {
    if (!part.trim()) continue;
    let eventType = "message";
    let dataStr = "";
    
    const lines = part.split("\n");
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.substring(6).trim();
      } else if (line.startsWith("data:")) {
        dataStr = line.substring(5).trim();
      }
    }
    
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr);
        parsed.push({ type: eventType, data });
      } catch (e) {
        console.error("Failed to parse event JSON data:", dataStr, e);
      }
    }
  }

  return { parsed, remainder };
}

function handleEvent(event: ParsedEvent, setState: React.Dispatch<React.SetStateAction<QueryState>>) {
  const { type, data } = event;
  
  setState(s => {
    switch (type) {
      case "sql":
        return { ...s, sql: String(data.sql ?? ""), phase: "executing" };
      case "meta":
        return { 
          ...s, 
          meta: {
            rowCount: Number(data.row_count ?? 0),
            durationMs: Number(data.duration_ms ?? 0),
            cached: Boolean(data.cached),
            columns: toStringArray(data.columns),
            columnTypes: toColumnTypes(data.column_types)
          }, 
          columns: toStringArray(data.columns),
          columnTypes: toColumnTypes(data.column_types),
          phase: "explaining" 
        };
      case "row":
        return { ...s, rows: [...s.rows, toQueryRow(data.row)] };
      case "token":
        return { ...s, explanation: s.explanation + String(data.token ?? "") };
      case "error":
        return { ...s, error: String(data.message ?? ""), phase: "error", isStreaming: false };
      case "done":
        return { ...s, phase: "done", isStreaming: false };
      default:
        return s;
    }
  });
}

export function useQueryStream() {
  const [state, setState] = useState<QueryState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const submitQuery = useCallback(async (question: string, sqlOverride?: string) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state, set phase to generating_sql
    setState({ ...initialState, isStreaming: true, phase: "generating_sql" });

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sql: sqlOverride || undefined }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const events = parseSSEBuffer(buffer);
        buffer = events.remainder;
        for (const event of events.parsed) {
          handleEvent(event, setState);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState(s => ({ 
          ...s, 
          error: (err as Error).message || "Connection failed", 
          phase: "error", 
          isStreaming: false 
        }));
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState(s => ({ ...s, isStreaming: false, phase: "idle" }));
  }, []);

  return { state, submitQuery, cancel };
}
