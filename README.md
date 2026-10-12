# Boni

App propia de Juan, cliente + servidor. El **servidor** (en el NAS) recoge y escribe datos a traves de servidores MCP
(hoy solo vault-mcp, el vault de Obsidian; Boni no sabe que existe Obsidian), calcula estadisticas y, mas adelante, habla
con el agente (Hermes). Los **clientes** (escritorio y Android, mismo codigo en Kotlin + Compose Multiplatform) solo
muestran y capturan: dibujan lo que el servidor describe.

Diseno completo y decisiones: nota `proyectos/boni.md` del vault y `docs/arquitectura.md`.

## Estructura
| Carpeta | Que hay |
|---|---|
| `server/` | Servidor en Python 3.12: API para los clientes, cliente MCP de las fuentes, estadisticas, SQLite, `Dockerfile` |
| `clients/` | Proyecto Gradle (Kotlin Multiplatform): `shared/` (casi todo el codigo), `desktop/` (ventana y widgets), `android/` (mas adelante) |
| `api/` | El contrato entre servidor y clientes: esquemas JSON y ejemplos |
| `docs/` | Documentacion para Juan (espanol) |

Reglas para IAs: `AGENTS.md`.

## Estado
Version minima en construccion (2026-10-12): apuntar un gasto y tres graficas (gasto del mes por categoria, evolucion
mensual, comida fuera) en el escritorio, con widgets que se ven al iniciar sesion.
