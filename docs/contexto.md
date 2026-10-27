# Contexto para los agentes: qué se escribe y qué se calcula

**Decidido por Juan el 2026-10-27.** Cómo encuentra un agente (Claude Code, Kimi o el propio Boni) lo que necesita para
trabajar en Boni sin que nadie mantenga a mano listas que se quedan viejas. Las reglas que se pueden comprobar están en
`docs/principios.md` (T-01 a T-04).

## Por qué

- **Lo que se describe a mano se desvía.** El `AGENTS.md` del repo llegó a 55 KB, casi el 80 % un inventario de
  carpetas escrito a mano; el README seguía presentando el plugin de Obsidian; una herramienta del MCP decía leer un
  CSV que ya era una colección. Leer lo obligatorio al empezar una sesión costaba unos 40.000 tokens.
- **Lo dice también la investigación.** El estudio de ETH Zürich sobre `AGENTS.md` (arXiv 2602.11988) encontró que
  los resúmenes de carpetas no ayudan a los agentes a encontrar ficheros, que lo redundante empeora los resultados y
  que cada instrucción innecesaria encarece la tarea. Anthropic recomienda poco contexto fijo y el resto «justo a
  tiempo» con herramientas («Effective context engineering for AI agents», 2025). MCP tiene un campo `instructions`
  pensado como manual del servidor, y las *Agent Skills* solo cargan nombre y descripción hasta que hacen falta.

## Dónde vive cada cosa

| Qué | Dónde | Cómo se mantiene |
|---|---|---|
| Cómo desarrollar Boni: ciclo de PR, pruebas, reglas de código | Repo: `AGENTS.md` corto, `docs/agents/calendar.md` para el calendario, `docs/principios.md` | Fijo, revisado en cada PR, con pruebas |
| Diseño y decisiones | Repo: `docs/` (en español) | Fijo; una decisión sustituida se marca, no se borra |
| Mapa del código | `make map`: la descripción de cada paquete y la primera frase de cada fichero | Calculado; el CI exige que existan |
| Cómo trabajar con Juan (idioma, comandos completos, verificar antes de pedir, agent-sudo) | Boni: sus instrucciones para asistentes, cortas | Fijo; lo devuelve el `guide` del MCP |
| Lo personal de operaciones (NAS, ssh, despliegue) | Boni (el repo es público) | Fijo; el repo solo dice dónde preguntarlo |
| Estructura de los datos: colecciones, qué va en cada una, cuántas, lo que ve la IA | El MCP de Boni, en cada llamada | Calculado; la descripción de cada colección sustituye a los README |
| Qué sabe hacer el MCP | Su lista de herramientas, generada desde el código | Calculado |
| Estado y Cola del desarrollo | Registros de una colección de Boni | Se sustituyen, no se acumulan |
| Historia | git y el registro de operaciones de Boni | Solo se consulta |

## En el repo

- `AGENTS.md` cabe en una pantalla larga: qué es Boni, dónde está el diseño, comandos, cómo se hace un cambio y las
  reglas duras de una línea, cada una con su enlace. Ningún inventario (una prueba lo vigila).
- `make map` lista los paquetes y apps con su `description`; `make map P=<ruta>` lista sus ficheros con la primera frase
  del comentario con que empieza cada uno. Quien añade un paquete le pone descripción; quien añade un fichero, su
  comentario. Así el mapa nunca miente.
- `docs/principios.md`: cada regla con su prueba, y una prueba comprueba que lo que nombra existe.

## En Boni

- El `guide` del MCP devuelve tres cosas: las instrucciones para asistentes, las colecciones con su descripción y
  cuántos registros tienen (solo lo que ese modelo puede ver) y la lista de herramientas. Todo calculado al momento.
- Cada colección tiene su descripción, que escriben el usuario o una IA (`set_description`); al crear una colección con
  su descripción (`create_collection`), el índice ya está al día.
- Ni README, ni `AGENTS.md`, ni `CLAUDE.md` como notas: son convenciones de un sistema de ficheros.
- El estado del desarrollo y su Cola son filas (estado, orden, PR); la historia sale de git y del registro de Boni.
