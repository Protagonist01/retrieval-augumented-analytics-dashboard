import json
from collections.abc import AsyncIterator

import structlog
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.config import settings
from src.pipeline import orchestrator

logger = structlog.get_logger("raa.api.routes")

router = APIRouter()


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


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
