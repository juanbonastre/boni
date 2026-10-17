# Boni

App propia de Juan, cliente + servidor. El **servidor** (en el NAS) recoge y escribe datos a traves de servidores MCP
(hoy solo vault-mcp, el vault de Obsidian; Boni no sabe que existe Obsidian), calcula estadisticas y, mas adelante, habla
con el agente (Hermes). Los **clientes** solo muestran y capturan: dibujan lo que el servidor describe. Tienen la misma
arquitectura que Boni Calendar: una interfaz web (React) dentro de Electron en el escritorio (y, mas adelante, de un WebView en
Android), con widgets de escritorio interactivos.

Diseno completo y decisiones: nota `proyectos/boni.md` del vault y `docs/arquitectura.md`.

## Estructura
| Carpeta | Que hay |
|---|---|
| `server/` | Servidor en Python 3.12: API para los clientes, cliente MCP de las fuentes, estadisticas, SQLite, `Dockerfile` |
| `apps/web/` | La interfaz (React + TypeScript): inicio, apuntar gasto, graficas, editor, ajustes, widgets |
| `apps/desktop/` | App de escritorio (Electron): ventana, widgets en el escritorio, bandeja, arranque al iniciar sesion, paquete `.deb` |
| `e2e/` | Pruebas de la interfaz (Playwright) |
| `clients/` | El primer cliente (Kotlin + Compose), sustituido por `apps/`; se borrara |
| `api/` | El contrato entre servidor y clientes: esquemas JSON y ejemplos |
| `docs/` | Documentacion para Juan (espanol) |

Reglas para IAs: `AGENTS.md`.

## Estado
En uso desde 2026-10-13 (servidor en el NAS). 2026-10-17: cliente nuevo con la arquitectura de Boni Calendar y widgets
interactivos (`make` para ver los comandos). Detalles: `server/README.md` y `docs/arquitectura.md`. Capturas de cada build en
la rama `ci-screenshots`.
