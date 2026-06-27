import asyncio
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Add backend to path so we can import src modules
sys.path.append(str(Path(__file__).parent.parent / "backend"))

import duckdb
from src.config import settings
from src.pipeline.schema_retriever import get_schema_retriever
from src.pipeline.text_to_sql import TextToSqlGenerator
from src.pipeline.sql_validator import SqlValidator
from src.pipeline.executor import QueryExecutor
from src.pipeline.explainer import ExplanationStreamer
from src.pipeline.orchestrator import run_query

def compare_results(res1, res2) -> bool:
    """Compare two query result sets in an order-insensitive way."""
    if len(res1) != len(res2):
        return False
    try:
        # Convert all values to string for safe sorting comparison
        sorted1 = sorted([tuple(str(c) for c in row) for row in res1])
        sorted2 = sorted([tuple(str(c) for c in row) for row in res2])
        return sorted1 == sorted2
    except Exception:
        return False

async def run_evaluation():
    print("🚀 Starting RAA Dashboard Golden Set Evaluation...")
    print(f"LLM Provider: {settings.llm_provider.upper()}")
    print(f"Database Directory: {settings.duckdb_data_dir.resolve()}")

    # Setup database connection for expected queries verification
    db_conn = duckdb.connect(":memory:")
    data_dir = Path(settings.duckdb_data_dir)
    if data_dir.exists():
        for csv_path in data_dir.glob("*.csv"):
            db_conn.execute(f"CREATE VIEW {csv_path.stem} AS SELECT * FROM read_csv_auto('{csv_path.as_posix()}')")

    # Load Golden Set
    golden_set_path = Path(__file__).parent / "golden_set.jsonl"
    if not golden_set_path.exists():
        print(f"❌ Golden set file not found at {golden_set_path}")
        sys.exit(1)

    eval_pairs = []
    with open(golden_set_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                eval_pairs.append(json.loads(line))

    print(f"Loaded {len(eval_pairs)} evaluation cases.")

    # Initialize components
    schema_retriever = await get_schema_retriever(settings)
    sql_generator = TextToSqlGenerator(settings)
    sql_validator = SqlValidator()
    executor = QueryExecutor(settings)
    explainer = ExplanationStreamer(settings)

    results = []
    correct_count = 0
    valid_sql_count = 0
    total_latency = 0.0
    latencies = []

    # Run evaluations sequentially to avoid rate limits
    for idx, pair in enumerate(eval_pairs, 1):
        print(f"\n[{idx}/{len(eval_pairs)}] Question: {pair['nl']}")
        
        # 1. Run expected SQL to get baseline
        try:
            expected_res = db_conn.execute(pair["expected_sql"]).fetchall()
        except Exception as e:
            print(f"  ⚠️ Failed to execute expected SQL: {e}")
            expected_res = []

        # 2. Run question through our orchestrator pipeline
        start_time = time.perf_counter()
        pipeline_sql = None
        pipeline_rows = []
        validation_failed = False
        self_corrected = False

        try:
            # Collect SSE events
            async for event in run_query(
                question=pair["nl"],
                settings=settings,
                schema_retriever=schema_retriever,
                sql_generator=sql_generator,
                sql_validator=sql_validator,
                executor=executor,
                explainer=explainer,
                redis_client=None
            ):
                if event.type == "sql":
                    pipeline_sql = event.data["sql"]
                elif event.type == "row":
                    pipeline_rows.append(event.data["row"])
                elif event.type == "error":
                    print(f"  ❌ Pipeline Error: {event.data}")
                    validation_failed = True
        except Exception as e:
            print(f"  ❌ Pipeline crashed: {e}")
            validation_failed = True

        latency_ms = (time.perf_counter() - start_time) * 1000.0
        latencies.append(latency_ms)
        total_latency += latency_ms

        # 3. Compare Results
        match = False
        if not validation_failed and pipeline_sql:
            valid_sql_count += 1
            match = compare_results(expected_res, pipeline_rows)
            if match:
                correct_count += 1
                print("  ✅ Match!")
            else:
                print("  ❌ Mismatch.")
                print(f"    Expected: {len(expected_res)} rows")
                print(f"    Got:      {len(pipeline_rows)} rows")
                print(f"    Gen SQL:  {pipeline_sql}")
        else:
            print("  ❌ Failed validation or SQL generation")

        results.append({
            "id": pair["id"],
            "nl": pair["nl"],
            "expected_sql": pair["expected_sql"],
            "generated_sql": pipeline_sql,
            "match": match,
            "validation_failed": validation_failed,
            "latency_ms": round(latency_ms, 2)
        })
        
        # Sleep briefly to be nice to APIs
        await asyncio.sleep(0.05)

    # Compute aggregate metrics
    accuracy = correct_count / len(eval_pairs)
    sql_validity = valid_sql_count / len(eval_pairs)
    avg_latency = total_latency / len(eval_pairs)
    
    sorted_latencies = sorted(latencies)
    p50 = sorted_latencies[len(sorted_latencies) // 2]
    p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)]

    # Print summary
    print("\n" + "="*50)
    print("📊 EVALUATION SUMMARY")
    print("="*50)
    print(f"Total Questions:      {len(eval_pairs)}")
    print(f"Execution Accuracy:   {accuracy*100:.1f}%")
    print(f"SQL Validity Rate:    {sql_validity*100:.1f}%")
    print(f"Avg Latency:          {avg_latency:.0f} ms")
    print(f"P50 Latency:          {p50:.0f} ms")
    print(f"P95 Latency:          {p95:.0f} ms")
    print("="*50)

    # Save results
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = results_dir / f"eval_results_{timestamp}.json"
    
    summary_data = {
        "timestamp": timestamp,
        "metrics": {
            "accuracy": accuracy,
            "sql_validity": sql_validity,
            "avg_latency_ms": avg_latency,
            "p50_latency_ms": p50,
            "p95_latency_ms": p95
        },
        "details": results
    }
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(summary_data, f, indent=2)
    print(f"Saved detailed results to {output_path}")

    # Exit code
    if accuracy >= 0.65:
        print("🎉 Evaluation PASSED (accuracy >= 65%)")
        sys.exit(0)
    else:
        print("❌ Evaluation FAILED (accuracy < 65%)")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(run_evaluation())
