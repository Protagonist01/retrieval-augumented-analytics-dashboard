.PHONY: up down logs build \
        test test-unit test-integration test-e2e \
        eval lint format data help

# ── Config ────────────────────────────────────────────────────────────────────
COMPOSE      := docker compose --env-file .env -f infra/docker-compose.yml
COMPOSE_MON  := docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.monitoring.yml
BACKEND_DIR  := backend
FRONTEND_DIR := frontend
EVALS_DIR    := evals
PYTHON       := python

# ── Stack ─────────────────────────────────────────────────────────────────────

## Start backend stack (FastAPI + Redis)
up:
	$(COMPOSE) up -d --build
	@echo "✅  Stack running. Backend: http://localhost:8000  Docs: http://localhost:8000/docs"

## Start with monitoring overlay (+ Prometheus + Grafana)
up-mon:
	$(COMPOSE_MON) up -d --build
	@echo "✅  Stack + monitoring running."
	@echo "    Grafana:    http://localhost:3001  (admin/admin)"
	@echo "    Prometheus: http://localhost:9090"

## Stop all services
down:
	$(COMPOSE) down

## View backend logs
logs:
	$(COMPOSE) logs -f backend

## Rebuild images without cache
build:
	$(COMPOSE) build --no-cache

# ── Data ──────────────────────────────────────────────────────────────────────

## Regenerate sample e-commerce dataset (data/sample/*.csv)
data:
	$(PYTHON) data/generate_sample.py
	@echo "✅  Sample data written to data/sample/"

# ── Tests ─────────────────────────────────────────────────────────────────────

## Run all tests (unit + integration; e2e requires running stack)
test: test-unit test-integration

## Run unit tests only (no DB, no LLM)
test-unit:
	cd $(BACKEND_DIR) && python -m pytest tests/unit/ -v --tb=short

## Run integration tests (real DuckDB, mocked LLM)
test-integration:
	cd $(BACKEND_DIR) && python -m pytest tests/integration/ -v --tb=short

## Run Playwright e2e tests (requires: make up && cd frontend && npm run dev)
test-e2e:
	cd $(FRONTEND_DIR) && npx playwright test

## Run all tests with coverage
test-cov:
	cd $(BACKEND_DIR) && python -m pytest tests/unit/ tests/integration/ \
		--cov=src --cov-report=term-missing --cov-report=html

# ── Evals ─────────────────────────────────────────────────────────────────────

## Run NL→SQL evaluation against the 80-pair golden set
eval:
	$(PYTHON) $(EVALS_DIR)/run_evals.py
	@echo "✅  Eval results written to evals/results/"

## Run evals against a specific model: EVAL_MODEL=gpt-4o make eval
eval-model:
	EVAL_MODEL=$(EVAL_MODEL) $(PYTHON) $(EVALS_DIR)/run_evals.py

# ── Quality ───────────────────────────────────────────────────────────────────

## Lint Python (ruff) and TypeScript (tsc)
lint:
	cd $(BACKEND_DIR) && python -m ruff check src/ tests/
	cd $(FRONTEND_DIR) && npm run lint
	cd $(FRONTEND_DIR) && npx tsc --noEmit

## Format Python code
format:
	cd $(BACKEND_DIR) && python -m ruff format src/ tests/

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "RAA Dashboard — Available Targets"
	@echo "──────────────────────────────────"
	@grep -E '^##' Makefile | sed 's/## /  /'
	@echo ""
