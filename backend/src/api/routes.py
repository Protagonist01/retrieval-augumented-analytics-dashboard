import json
import re
import shutil
from collections.abc import AsyncIterator
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
