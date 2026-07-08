import json
import re
import shutil
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import structlog
from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.config import settings
from src.pipeline import orchestrator

logger = structlog.get_logger("raa.api.routes")

router = APIRouter()


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)
    sql: str | None = Field(default=None, max_length=10000)


class ConnectorRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    kind: str = Field(..., pattern="^(postgres|mysql|supabase|bigquery|snowflake)$")
    host: str = Field("", max_length=200)
    database: str = Field("", max_length=120)
    username: str = Field("", max_length=120)
    project: str = Field("", max_length=120)
    notes: str = Field("", max_length=500)


@router.post("/api/query")
async def query_endpoint(request: QueryRequest, req: Request) -> StreamingResponse:
    logger.info("Received query request", question=request.question)

    async def event_generator() -> AsyncIterator[str]:  # type: ignore
        try:
            # Re-fetch dependencies from app state
            async for event in orchestrator.run_query(
                question=request.question,
                settings=settings,
                schema_retriever=req.app.state.schema_retriever,
                sql_generator=req.app.state.sql_generator,
                sql_validator=req.app.state.sql_validator,
                executor=req.app.state.executor,
                explainer=req.app.state.explainer,
                redis_client=req.app.state.redis_client,
                sql_override=request.sql,
            ):
                yield f"event: {event.type}\ndata: {json.dumps(event.data)}\n\n"
        except Exception as e:
            logger.exception("Error in SSE event stream generation")
            error_data = {"code": "internal_error", "message": str(e)}
            yield f"event: error\ndata: {json.dumps(error_data)}\n\n"

    # Set appropriate headers for SSE streaming
    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # Prevents Nginx from buffering the stream
    }

    return StreamingResponse(event_generator(), headers=headers, media_type="text/event-stream")


def _safe_table_name(filename: str) -> str:
    stem = Path(filename).stem.lower()
    name = re.sub(r"[^a-z0-9_]+", "_", stem).strip("_")
    if not name:
        raise HTTPException(status_code=400, detail="CSV filename must contain a table name")
    if name[0].isdigit():
        name = f"dataset_{name}"
    return name[:64]


async def _clear_query_cache(redis_client) -> None:
    if not redis_client:
        return
    async for key in redis_client.scan_iter("raa:query_cache:*"):
        await redis_client.delete(key)


async def _cache_counts(redis_client) -> dict:
    if not redis_client:
        return {"enabled": False, "schemaKeys": 0, "queryKeys": 0}
    schema_keys = 0
    query_keys = 0
    async for key in redis_client.scan_iter("raa:schema"):
        schema_keys += 1
    async for key in redis_client.scan_iter("raa:query_cache:*"):
        query_keys += 1
    return {"enabled": True, "schemaKeys": schema_keys, "queryKeys": query_keys}


async def _refresh_runtime_state(req: Request) -> None:
    await req.app.state.schema_retriever.refresh()
    req.app.state.executor.refresh()
    await _clear_query_cache(req.app.state.redis_client)


def _dataset_summary(csv_path: Path, source: str) -> dict:
    table_name = csv_path.stem
    row_count = 0
    columns = []
    try:
        safe_path = str(csv_path.resolve()).replace("\\", "/")
        conn = duckdb.connect(":memory:")
        row_count = conn.execute(f"SELECT COUNT(*) FROM read_csv_auto('{safe_path}')").fetchone()[0]
        describe_sql = f"DESCRIBE SELECT * FROM read_csv_auto('{safe_path}')"
        describe_rows = conn.execute(describe_sql).fetchall()
        columns = [{"name": row[0], "type": row[1]} for row in describe_rows]
        conn.close()
    except Exception as exc:
        logger.warning("Failed to inspect dataset", path=str(csv_path), error=str(exc))

    return {
        "tableName": table_name,
        "fileName": csv_path.name,
        "source": source,
        "sizeBytes": csv_path.stat().st_size,
        "rowCount": row_count,
        "columns": columns,
    }


@router.get("/api/datasets")
async def datasets_endpoint() -> dict:
    datasets = []
    for source, data_dir in (
        ("sample", Path(settings.duckdb_data_dir)),
        ("uploaded", Path(settings.duckdb_upload_dir)),
    ):
        if data_dir.exists():
            datasets.extend(
                _dataset_summary(path, source) for path in sorted(data_dir.glob("*.csv"))
            )
    return {"datasets": datasets}


@router.post("/api/datasets/upload")
async def upload_dataset(req: Request, file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV uploads are supported")

    table_name = _safe_table_name(file.filename)
    upload_dir = Path(settings.duckdb_upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    target_path = upload_dir / f"{table_name}.csv"

    with target_path.open("wb") as out_file:
        shutil.copyfileobj(file.file, out_file)

    try:
        safe_path = str(target_path.resolve()).replace("\\", "/")
        conn = duckdb.connect(":memory:")
        conn.execute(f"SELECT * FROM read_csv_auto('{safe_path}') LIMIT 1").fetchall()
        conn.close()
    except Exception as exc:
        target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"CSV could not be read: {exc}") from exc

    await _refresh_runtime_state(req)
    return {"dataset": _dataset_summary(target_path, "uploaded")}


@router.post("/api/schema/refresh")
async def refresh_schema_endpoint(req: Request) -> dict:
    await _refresh_runtime_state(req)
    return {"status": "ok"}


def _eval_results_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "evals" / "results"


def _golden_set_path() -> Path:
    return Path(__file__).resolve().parents[3] / "evals" / "golden_set.jsonl"


def _load_eval_runs() -> list[dict]:
    results_dir = _eval_results_dir()
    runs = []
    if not results_dir.exists():
        return runs
    for path in sorted(results_dir.glob("eval_results_*.json"), reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            runs.append(
                {
                    "fileName": path.name,
                    "timestamp": data.get("timestamp", path.stem),
                    "metrics": data.get("metrics", {}),
                    "failedCases": [
                        item
                        for item in data.get("details", [])
                        if not item.get("match") or item.get("validation_failed")
                    ],
                }
            )
        except Exception as exc:
            logger.warning("Failed to read eval result", path=str(path), error=str(exc))
    return runs


@router.get("/api/evals")
async def evals_endpoint() -> dict:
    golden_path = _golden_set_path()
    total_cases = 0
    difficulties: dict[str, int] = {}
    if golden_path.exists():
        for line in golden_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            total_cases += 1
            item = json.loads(line)
            difficulty = item.get("difficulty", "unknown")
            difficulties[difficulty] = difficulties.get(difficulty, 0) + 1

    runs = _load_eval_runs()
    return {
        "totalCases": total_cases,
        "difficulties": difficulties,
        "latestRun": runs[0] if runs else None,
        "runs": runs[:8],
    }


@router.post("/api/evals/compare")
async def compare_models_endpoint(payload: dict) -> dict:
    models = [str(model).strip() for model in payload.get("models", []) if str(model).strip()]
    latest = _load_eval_runs()[0] if _load_eval_runs() else None
    baseline_metrics = latest.get("metrics", {}) if latest else {}
    comparisons = []
    for model in models[:5]:
        comparisons.append(
            {
                "model": model,
                "status": "ready",
                "accuracy": baseline_metrics.get("accuracy"),
                "sqlValidity": baseline_metrics.get("sql_validity"),
                "p95LatencyMs": baseline_metrics.get("p95_latency_ms"),
                "notes": "Run make eval with this model to replace baseline placeholders.",
            }
        )
    return {"comparisons": comparisons}


def _connectors_path() -> Path:
    config_dir = Path(settings.app_config_dir)
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "connectors.json"


def _load_connectors() -> list[dict]:
    path = _connectors_path()
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_connectors(connectors: list[dict]) -> None:
    _connectors_path().write_text(json.dumps(connectors, indent=2), encoding="utf-8")


@router.get("/api/connectors")
async def connectors_endpoint() -> dict:
    return {"connectors": _load_connectors()}


@router.post("/api/connectors")
async def create_connector_endpoint(connector: ConnectorRequest) -> dict:
    connectors = _load_connectors()
    item = connector.model_dump()
    item.update(
        {
            "id": re.sub(r"[^a-z0-9_]+", "_", connector.name.lower()).strip("_"),
            "status": "configured",
            "createdAt": datetime.now(UTC).isoformat(),
        }
    )
    connectors = [existing for existing in connectors if existing.get("id") != item["id"]]
    connectors.insert(0, item)
    _save_connectors(connectors)
    return {"connector": item}


@router.post("/api/connectors/test")
async def test_connector_endpoint(connector: ConnectorRequest) -> dict:
    required = connector.project if connector.kind in ("bigquery", "snowflake") else connector.host
    if not required:
        raise HTTPException(status_code=400, detail="Connector is missing a host or project")
    return {
        "status": "ready",
        "message": f"{connector.kind} connector settings are complete enough to save.",
    }


@router.get("/api/admin/status")
async def admin_status_endpoint(req: Request) -> dict:
    datasets = await datasets_endpoint()
    cache = await _cache_counts(req.app.state.redis_client)
    return {
        "status": "ok",
        "version": "1.0.0",
        "generatedAt": datetime.now(UTC).isoformat(),
        "cache": cache,
        "datasets": {
            "count": len(datasets["datasets"]),
            "uploaded": len(
                [item for item in datasets["datasets"] if item["source"] == "uploaded"]
            ),
        },
        "connectors": {"count": len(_load_connectors())},
        "authMode": "local demo",
    }


@router.post("/api/cache/clear")
async def clear_cache_endpoint(req: Request) -> dict:
    await _refresh_runtime_state(req)
    return {"status": "ok"}


@router.get("/api/schema")
async def schema_endpoint(req: Request) -> dict:
    logger.info("Fetching database schema metadata")
    schema_retriever = req.app.state.schema_retriever
    # Pass empty string to retrieve full cached schema context
    schema_context = await schema_retriever.get_context("")

    return {
        "tables": [
            {"name": t.name, "columns": [{"name": c.name, "type": c.type} for c in t.columns]}
            for t in schema_context.tables
        ]
    }


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


@router.get("/metrics")
async def metrics_endpoint():
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
