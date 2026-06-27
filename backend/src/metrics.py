from prometheus_client import Counter, Histogram

# Define metrics
query_duration_seconds = Histogram(
    "query_duration_seconds",
    "End-to-end query latency",
    ["stage"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)

sql_validation_failures_total = Counter(
    "sql_validation_failures_total", "SQL validation rejections", ["reason"]
)

llm_tokens_used_total = Counter("llm_tokens_used_total", "LLM token usage", ["stage"])

query_cache_hits_total = Counter("query_cache_hits_total", "Cache lookups", ["cache", "result"])

duckdb_query_duration_seconds = Histogram(
    "duckdb_query_duration_seconds",
    "DuckDB execution time",
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0],
)

self_correction_total = Counter(
    "self_correction_total", "LLM self-correction attempts", ["outcome"]
)
