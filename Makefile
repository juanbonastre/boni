.DEFAULT_GOAL := help
.PHONY: help setup dev build check test e2e bench-chrome desktop package bench-electron plugin \
	install-obsidian e2e-obsidian bench-obsidian server

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

e2e: ## Run Playwright tests (system Chrome)
	pnpm exec playwright test

bench-chrome: build ## Smoothness benchmark in a real Chrome window
	@(pnpm --filter @boni-calendar/web exec vite preview --port 4173 --strictPort >/dev/null 2>&1 & echo $$! > .preview.pid); sleep 3; \
	node bench/run-chrome.mjs; kill `cat .preview.pid`; rm -f .preview.pid

desktop: build ## Run the desktop app (Electron) from the build
	pnpm --filter boni-calendar-desktop prepare-web
	pnpm --filter boni-calendar-desktop start

plugin: ## Build the Obsidian plugin into apps/obsidian-plugin/dist (main.js + manifest.json)
	pnpm --filter boni-calendar-obsidian build

server: ## Run the server locally (BONI_DB, BONI_PORT, BONI_WEB: see apps/server/src/main.ts)
	pnpm --filter boni-calendar-server start

install-obsidian: plugin ## Copy the plugin into a vault: make install-obsidian VAULT=/path/to/vault
	@test -n "$(VAULT)" || (echo "Usage: make install-obsidian VAULT=/path/to/vault" && exit 1)
	node apps/obsidian-plugin/install.mjs "$(VAULT)"

e2e-obsidian: plugin ## The plugin in the installed Obsidian (temporary profile and invented vault)
	pnpm exec playwright test -c playwright.obsidian.config.ts plugin.spec.ts

bench-obsidian: plugin ## Smoothness benchmark inside the installed Obsidian (opens a window)
	BONI_BENCH=1 pnpm exec playwright test -c playwright.obsidian.config.ts bench.spec.ts

package: build ## Build the .deb and AppImage into release/
	pnpm --filter boni-calendar-desktop dist

bench-electron: build ## Smoothness benchmark inside Electron (opens a window)
	BONI_START_QUERY="bench=auto&now=2025-09-17T14:29&tz=Europe/Madrid" BONI_BENCH_OUT=bench/results/electron.json \
		pnpm --filter boni-calendar-desktop exec electron . --no-sandbox
