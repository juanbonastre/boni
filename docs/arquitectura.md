# Arquitectura

Resumen tecnico. Las decisiones y su historia estan en la nota del vault `proyectos/boni.md`.

## Piezas
```
 escritorio / Android (Kotlin, Compose Multiplatform)
        |  HTTP + JSON  /api/v1   (token por dispositivo; SSE mas adelante para el chat)
        v
 servidor Boni (Python 3.12, NAS, solo tailnet) -- SQLite propio (dispositivos, cola de salida, graficas, widgets)
        |  MCP (Streamable HTTP, spec 2026-07-28, SDK oficial `mcp`)
        v
 vault-mcp (hoy)   ...   otras fuentes MCP (manana)
```
- **Servidor**: modulos `sources/` (cliente MCP generico + adaptador de finanzas, el unico que conoce el formato de las notas),
  `expenses/` (formulario y nota de movimiento), `stats/` (definicion de "gasto", graficas), `store` (SQLite), `api` (FastAPI).
  Mas adelante: servidor MCP hacia las IAs y el agente (Hermes, perfil `boni`).
- **Clientes**: `shared/` dibuja pantallas, formularios y graficas a partir de lo que manda el servidor; `desktop/` es la
  ventana principal, los widgets y el icono de la bandeja.

## Por que una API propia y no MCP hasta el cliente (revisado 2026-10-12)
- **Elicitation** (spec 2026-07-28): el servidor pide datos con un formulario plano (texto, numero, si/no, una o varias
  opciones de una lista) o manda a una URL. Desde la 2026-07-28 ya no es una peticion del servidor al cliente: el servidor
  responde `InputRequiredResult` y el cliente repite la llamada con las respuestas (MRTR, sin sesiones). No cubre graficas,
  chat, listas largas con busqueda, widgets ni cola sin conexion.
- **MCP Apps** (extension estable 2026-01-26, SEP-1865): interfaces en HTML (`text/html;profile=mcp-app`) dentro de un
  iframe aislado. La soportan Claude, VS Code, Cursor, Goose, ChatGPT; nada nativo para Compose.
- Decision: API propia hacia los clientes; MCP hacia las fuentes y hacia las IAs. Para no cerrar puertas, los campos de
  formulario de Boni son un superconjunto del esquema de elicitation (cada campo tiene su equivalente JSON Schema), y la
  futura herramienta MCP "preguntar a Juan" seguira el patron `InputRequiredResult`.

## Contrato (`api/`)
- Fuente: los modelos Pydantic de `server/boni/contract.py`. `api/schema/*.json` se genera desde ellos y una prueba falla si
  no coinciden. `api/examples/*.json` los leen las pruebas del servidor y de los clientes.
- Endpoints (`/api/v1`, cabecera `Authorization: Bearer <token del dispositivo>`):

| Metodo y ruta | Que hace |
|---|---|
| `GET /home` | Pantalla de inicio: tarjetas de graficas y boton "Apuntar gasto" |
| `GET /screens/{id}` | Una pantalla descrita por el servidor (p. ej. `capture-expense`) |
| `GET /options/{source}?q=` | Listas largas que rellena el servidor: `categories`, `people` |
| `POST /actions` | `{action, client_id, values}` -> `ok`, `queued` o `invalid` (errores por campo). `client_id` (UUID) hace la llamada idempotente: la cola sin conexion no duplica gastos |
| `GET /charts`, `GET /charts/{id}/data` | Definicion de cada grafica y su serie calculada |
| `GET /widgets` | Widgets de este dispositivo (que grafica, tamano) |

- Catalogo de componentes: `text`, `button`, `form` (campos `amount`, `text`, `date`, `choice`, `multi_choice`, `toggle`),
  `chart_card`. Un cliente que recibe un tipo que no conoce muestra "actualiza la app".
- Una grafica es una **definicion** (tipo, medida, agrupar por, periodo, filtros), no los datos: la calcula el servidor y el
  cliente la dibuja.

## Pruebas y CI
- Servidor (`server.yml`): ruff, pytest contra un vault-mcp falso hecho con el SDK real (en memoria y por HTTP con token) y
  construccion de la imagen Docker. Comprueba tambien que `api/schema` y `api/examples` estan al dia.
- Clientes (`clients.yml`): `gradlew check` (incluye leer todos los `api/examples`), capturas PNG en claro y oscuro (se
  publican en la rama `ci-screenshots`) y el paquete `.deb`.

## Definicion de gasto
La de `tools/finanzas.py` (repo `gastos-app`) y `registros/finanzas/README.md`: movimientos negativos de categorias de gasto
(no `ingreso/`, `inversion`, `transferencia/`), usando `my_share` si existe, menos reembolsos (positivos de una categoria de
gasto con `settles` al gasto; si `settles` apunta a una deuda es un amigo devolviendo su parte y no cuenta). Las deudas
`perdonada` o `invitacion` suman como gasto de Juan en la fecha y categoria del gasto original. Codigo:
`server/boni/stats/spending.py`.

## Escritorio: widgets
Cada widget es una ventana pequena sin bordes ni barra de tareas, que recuerda su posicion. Boni arranca al iniciar sesion
(Linux: `~/.config/autostart/boni.desktop`) con los widgets y un icono en la bandeja. En Linux con X11 (Cinnamon) los widgets
se quedan debajo de las demas ventanas; en Wayland, Mac y Windows de momento son ventanas normales sin bordes. Sin conexion
muestran los ultimos datos guardados.
