# Arquitectura

Resumen tecnico. Las decisiones y su historia estan en la nota del vault `proyectos/boni.md`.

## Piezas
```
 escritorio (Electron + React) / Android (WebView, mas adelante)
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
- **Clientes** (misma arquitectura que Boni Calendar): `apps/web` dibuja pantallas, formularios y graficas a partir de lo
  que manda el servidor; `apps/desktop` (Electron) es la ventana principal, los widgets y el icono de la bandeja, y hace las
  peticiones al servidor (el token no llega nunca a la pagina).

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
| `GET /options/{source}?q=` | Listas que rellena el servidor: `categories`, `people`, `groups`, `accounts`, `merchants`, `related`, `statuses`, `sources` |
| `POST /actions` | `{action, client_id, values}` -> `ok`, `queued` o `invalid` (errores por campo). `client_id` (UUID) hace la llamada idempotente: la cola sin conexion no duplica gastos |
| `GET /charts`, `GET /charts/{id}`, `GET /charts/{id}/data?drill=` | Definiciones de las graficas y sus datos calculados |
| `POST /charts`, `PUT /charts/{id}`, `DELETE /charts/{id}` | Crear, editar y borrar graficas (borrar quita tambien sus widgets) |
| `PUT /charts/order` | Orden de las graficas (`{ids}`) |
| `POST /charts/preview` | Calcula una definicion sin guardarla (vista previa del editor) |
| `GET /charts/catalog` | Lo que ofrece el editor: campos, tipos, medidas, periodos, comparaciones |
| `GET /widgets`, `POST /widgets`, `PUT /widgets/{id}`, `DELETE /widgets/{id}` | Widgets de este dispositivo (que grafica, tamano) |

- Catalogo de componentes: `text`, `button`, `form` (campos `amount`, `text`, `date`, `choice`, `multi_choice`, `toggle`),
  `chart_card`. Un cliente que recibe un tipo que no conoce muestra "actualiza la app".
- Una grafica es una **definicion** (`ChartSpec`), no los datos: la calcula el servidor (`server/boni/stats/engine.py`) y el
  cliente la dibuja. El editor de la app construye la definicion:
  - **Tipo**: barras, barras apiladas, barras horizontales, linea, area, anillo, cifra, tabla.
  - **Medida**: gasto, ingresos, numero de gastos, gasto medio.
  - **Eje** (`x`): cualquier campo del movimiento (fecha por dia, semana, mes, trimestre, ano o dia de la semana; grupo,
    categoria, cuenta, comercio, concepto, con quien, invitados, proyecto o evento, estado, origen).
  - **Series** (`split`): una serie por cada valor de otro campo (maximo 6, el resto en "Otros").
  - **Periodo**: este mes, mes pasado, ultimos N meses o dias, este ano, ano pasado, entre fechas, todo.
  - **Filtros**: cualquier campo, con es / no es / empieza por / contiene / vacio / mayor o igual / menor o igual.
  - **Comparar** con el periodo anterior o el mismo del ano anterior (si el periodo no ha terminado, el mismo tramo).
  - Los N primeros (el resto en "Resto"), orden, abrir un punto para ver su detalle, mostrar en inicio o no.

## Pruebas y CI
- Servidor (`server.yml`): ruff, pytest contra un vault-mcp falso hecho con el SDK real (en memoria y por HTTP con token) y
  construccion de la imagen Docker. Comprueba tambien que `api/schema` y `api/examples` estan al dia.
- Clientes (`apps.yml`): Biome, tipos y pruebas unitarias (incluye leer todos los `api/examples`), pruebas de la interfaz
  con Playwright contra un servidor falso que responde con `api/examples` (capturas en la rama `ci-screenshots`) y el
  paquete `.deb`.

## Definicion de gasto
La de `tools/finanzas.py` (repo `gastos-app`) y `registros/finanzas/README.md`: movimientos negativos de categorias de gasto
(no `ingreso/`, `inversion`, `transferencia/`), usando `my_share` si existe, menos reembolsos (positivos de una categoria de
gasto con `settles` al gasto; si `settles` apunta a una deuda es un amigo devolviendo su parte y no cuenta). Las deudas
`perdonada` o `invitacion` suman como gasto de Juan en la fecha y categoria del gasto original. Codigo:
`server/boni/stats/spending.py`.

## Escritorio: widgets
Cada widget es una ventana pequena, sin bordes y transparente, con una grafica interactiva: al pasar el raton se ve el valor,
al tocar un punto su detalle; se mueve arrastrandola, se cambia de tamano desde la esquina y tiene su menu con el boton
derecho. En Linux con X11 es una ventana de tipo "dock" que el gestor de ventanas mantiene debajo de las demas y en todos los
escritorios (`wmctrl -b add,below,sticky`): queda justo encima del fondo, sobrevive a "Mostrar escritorio" y a los clics en el
escritorio, y no sale en la barra ni en Alt+Tab. Se probo en muffin (el gestor de Cinnamon) el 2026-10-17: una ventana de tipo
"desktop" se queda detras del fondo al hacer clic en el escritorio y una normal "debajo" se oculta con Super+D. Sin wmctrl, o
en Wayland, son ventanas normales sin bordes.

Boni arranca al iniciar sesion (`~/.config/autostart/boni.desktop`, con `--background`) con los widgets y el icono de la
bandeja; cerrar la ventana principal la libera y Boni sigue en la bandeja. Una sola pagina (la ventana principal, o el primer
widget si no esta abierta) envia la cola sin conexion cada minuto y recarga todo cada 15. Sin conexion los widgets muestran los
ultimos datos guardados. Coste medido (2026-10-17, tres widgets sin la ventana principal): 334 MB en total (unos 35 MB por
widget mas lo comun de Electron), frente a 373 MB del primer cliente, y un 0,4 % de CPU en reposo.

Los ajustes son el mismo archivo que usaba el primer cliente (`~/.config/boni/settings.json`): al cambiar de app se conservan
servidor, token y posiciones; la primera vez los widgets aparecen donde estaban los desklets de Cinnamon del primer cliente.
