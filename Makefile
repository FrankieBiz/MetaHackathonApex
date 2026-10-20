# Apex OS. `make` runs the FastAPI backend (:8000) and the Next.js terminal (:3000) via start.sh.
.DEFAULT_GOAL := start
.PHONY: start install check help

PY := backend/.venv/bin/python
PIP := $(if $(shell command -v uv),uv pip install --quiet --python $(PY),$(PY) -m pip install --quiet --disable-pip-version-check)

start: ## Run backend :8000 and frontend :3000; installs missing dependencies first
	@./start.sh

install: ## Install backend/.venv and frontend/node_modules
	@./start.sh install

check: install ## Backend ruff and pytest, then frontend lint, typecheck, tests, and build
	$(PIP) -r backend/requirements-dev.txt
	$(PY) -m ruff check backend
	$(PY) -m ruff format --check backend
	$(PY) -m pytest backend -q
	cd frontend && npm run check

help: ## List targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-z]+:.*## / { printf "  make %-8s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
