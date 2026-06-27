import asyncio
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.middleware import PrometheusMiddleware, RequestIdMiddleware
from src.api.routes import router
from src.config import settings
from src.logging_config import configure_logging
from src.pipeline.executor import QueryExecutor
from src.pipeline.explainer import ExplanationStreamer
from src.pipeline.schema_retriever import get_schema_retriever
from src.pipeline.sql_validator import SqlValidator
from src.pipeline.text_to_sql import TextToSqlGenerator

logger = structlog.get_logger("raa.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Configure structured logging
    configure_logging(settings.log_level, settings.log_format)
    logger.info("Initializing RAA Dashboard application services...")

    # 2. Setup Redis client
    redis_client = None
    try:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        # Test connection
        await asyncio.wait_for(redis_client.ping(), timeout=2.0)
        logger.info("Redis connection established successfully", url=settings.redis_url)
    except Exception as e:
        logger.warning("Redis is unavailable; caching will be disabled.", error=str(e))
        redis_client = None

    # 3. Create pipeline components
    schema_retriever = await get_schema_retriever(settings, redis_client)
    sql_generator = TextToSqlGenerator(settings)
    sql_validator = SqlValidator()
    executor = QueryExecutor(settings)
    explainer = ExplanationStreamer(settings)

    # 4. Attach to FastAPI state
    app.state.redis_client = redis_client
    app.state.schema_retriever = schema_retriever
    app.state.sql_generator = sql_generator
    app.state.sql_validator = sql_validator
    app.state.executor = executor
    app.state.explainer = explainer

    yield

    # 5. Clean up resources
    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed")
    logger.info("RAA Dashboard API shutdown complete")


app = FastAPI(
    title="RAA Dashboard API",
    description="Natural Language to SQL analytics pipeline using DuckDB",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Middlewares
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestIdMiddleware)

# Include API Router
app.include_router(router)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level.lower(),
        reload=True,
    )
