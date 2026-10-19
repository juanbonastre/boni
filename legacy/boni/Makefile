.DEFAULT_GOAL := help
.PHONY: help setup dev build check e2e desktop package

help: ## List available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Install the clients' dependencies (the server has its own: server/README.md)
	pnpm install

dev: ## UI dev server (http://localhost:5174); BONI_SERVER=https://... proxies the API
	pnpm dev

build: ## Build the web UI
	pnpm build

check: ## Lint, type-check and unit tests of the clients
	pnpm lint
	pnpm typecheck
	pnpm test

e2e: ## Playwright tests (system Chrome; screenshots in e2e/screenshots/)
	pnpm exec playwright test

desktop: build ## Run the desktop app from the build
	pnpm --filter boni prepare-web
	pnpm --filter boni start

package: build ## Build the .deb into release/
	pnpm --filter boni dist
