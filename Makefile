.DEFAULT_GOAL := help
.PHONY: help setup dev build check test e2e bench-chrome desktop package bench-electron \
	server e2e-boni boni-desktop package-boni e2e-boni-desktop e2e-calendar-desktop

help: ## List available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

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

e2e: ## Run Playwright tests (system Chrome): Boni Calendar, then Boni
	pnpm exec playwright test
	pnpm exec playwright test -c playwright.boni.config.ts

e2e-boni: ## Only Boni's Playwright tests (apps/boni-web)
	pnpm exec playwright test -c playwright.boni.config.ts

boni-desktop: ## Run Boni's desktop app (Electron) with the built web app
	pnpm --filter @boni/boni-web build
	pnpm --filter boni prepare-web
	pnpm --filter boni start

package-boni: ## Build Boni's desktop .deb into release/
	pnpm --filter @boni/boni-web build
	pnpm --filter boni dist

e2e-calendar-desktop: ## Boni Calendar's desktop app driven for real, its note peek included (opens windows; not in CI)
	pnpm --filter @boni/boni-web build
	pnpm --filter @boni/calendar-web build
	node apps/calendar-desktop/scripts/copy-web.mjs
	pnpm exec playwright test -c playwright.calendar-desktop.config.ts

e2e-boni-desktop: ## Boni's desktop app driven for real (opens a window; not in CI)
	pnpm --filter @boni/boni-web build
	pnpm --filter boni prepare-web
	pnpm exec playwright test -c playwright.boni-desktop.config.ts

bench-chrome: build ## Smoothness benchmark in a real Chrome window
	@(pnpm --filter @boni/calendar-web exec vite preview --port 4173 --strictPort >/dev/null 2>&1 & echo $$! > .preview.pid); sleep 3; \
	node bench/run-chrome.mjs; kill `cat .preview.pid`; rm -f .preview.pid

desktop: build ## Run the desktop app (Electron) from the build
	pnpm --filter boni-calendar-desktop prepare-web
	pnpm --filter boni-calendar-desktop start

server: ## Run the server locally (BONI_DB, BONI_PORT, BONI_WEB: see apps/server/src/main.ts)
	pnpm --filter @boni/server start

package: build ## Build the .deb and AppImage into release/
	pnpm --filter boni-calendar-desktop dist

bench-electron: build ## Smoothness benchmark inside Electron (opens a window)
	BONI_START_QUERY="bench=auto&now=2025-09-17T14:29&tz=Europe/Madrid" BONI_BENCH_OUT=bench/results/electron.json \
		pnpm --filter boni-calendar-desktop exec electron . --no-sandbox
