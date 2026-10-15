.DEFAULT_GOAL := help
.PHONY: help setup dev build check test e2e bench-chrome desktop package bench-electron

help: ## List available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies
	pnpm install

dev: ## Start the UI dev server (http://localhost:5173)
	pnpm dev

build: ## Build the web UI
	pnpm build

check: ## Lint, type-check and run unit tests
	pnpm lint
	pnpm typecheck
	pnpm test

e2e: ## Run Playwright tests (system Chrome)
	pnpm exec playwright test

bench-chrome: build ## Smoothness benchmark in a real Chrome window
	@(pnpm --filter @boni-calendar/web exec vite preview --port 4173 --strictPort >/dev/null 2>&1 & echo $$! > .preview.pid); sleep 3; \
	node bench/run-chrome.mjs; kill `cat .preview.pid`; rm -f .preview.pid

desktop: build ## Run the desktop app (Electron) from the build
	pnpm --filter boni-calendar-desktop prepare-web
	pnpm --filter boni-calendar-desktop start

package: build ## Build the .deb and AppImage into release/
	pnpm --filter boni-calendar-desktop dist

bench-electron: build ## Smoothness benchmark inside Electron (opens a window)
	BONI_START_QUERY="bench=auto&now=2025-09-17T14:29&tz=Europe/Madrid" BONI_BENCH_OUT=bench/results/electron.json \
		pnpm --filter boni-calendar-desktop exec electron . --no-sandbox
