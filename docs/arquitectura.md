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
| `GET /shortcuts`, `POST /shortcuts`, `PUT /shortcuts/{id}`, `PUT /shortcuts/order`, `DELETE /shortcuts/{id}` | Atajos: una pantalla del servidor con valores para su formulario (`open` = abrir el formulario relleno, `save` = guardar directamente); compartidos por todos los equipos, como las gráficas |

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

## Ventana principal (como Boni Calendar)
- Barra lateral: Inicio, tus graficas (punto de color, ojo = en la pantalla de inicio, ajustes = editar, arrastrar para
  ordenar), los widgets de este equipo (ojo = mostrar aqui) y, abajo, Ajustes y el usuario.
- Zona principal: las graficas de inicio llenan la ventana (sin hueco abajo; con muchas, se desplaza), o una grafica sola
  al pulsar su titulo.
- Panel derecho: apuntar un gasto (el formulario del servidor; tecla N) y el editor de graficas (la tarjeta que se edita
  muestra la vista previa; una grafica nueva tiene su tarjeta provisional).
- Controles de cada grafica al pasar el raton, como en Notion: periodo, filtros, orden, tipo, color y menu (editar,
  duplicar, en inicio, al escritorio, borrar). Se guardan al momento y se pueden deshacer desde el aviso.
- Cuenta como en Boni Calendar: direccion, usuario, contrasena y nombre del equipo; el equipo guarda solo un token de sesion.

## Móvil (y la app Android)
Por debajo de 640 px la app usa otra disposición (`MobileApp.tsx`), pensada para apuntar y no para mirar gráficas
(Juan, 2026-10-18). Dos pestañas abajo: **Apuntar** (los botones de captura del servidor y los atajos) y **Gráficas**
(lista con la cifra de cada una; al tocar, la gráfica a pantalla completa con su periodo; crear y editar en una hoja).
Formularios y editores son hojas a pantalla completa con los botones fijos abajo; los campos opcionales quedan bajo
"Más detalles". Letra de 16 px y zonas táctiles de 48 px (desviación escrita de la guía de Boni Calendar, pensada para el
ratón). Atrás (Esc ahora, el botón de Android después) cierra lo de encima.

**Atajos**: una pantalla del servidor más unos valores para su formulario. Al tocarlo, o se abre el formulario relleno o
se guarda directamente (pasa por la cola sin conexión y espera los segundos del "Deshacer"). Se crean desde el aviso de un
gasto guardado ("Guardar como atajo"), desde el propio formulario o con "Nuevo atajo"; se editan y borran desde su menú o
manteniéndolo pulsado. Se guardan en el servidor (`/api/v1/shortcuts`), compartidos por todos los equipos.

## Android (`apps/android`)
La misma web en un WebView, como la app Android de Boni Calendar: se sirve desde los assets del APK, así que abre sin
red con los últimos datos guardados. La app (Kotlin) hace lo que en el escritorio hace el proceso principal: el login
(el token de sesión cifrado con una clave del Keystore de Android; la página nunca lo ve), todas las peticiones al
servidor (no tiene CORS), los ajustes, los archivos de la cola y las copias, el directo mientras está delante y el
"minuto". Con la app cerrada, la cola sin conexión la envía WorkManager en cuanto hay red (mismas reglas que la web,
también la espera del "Deshacer"). Atrás cierra lo de encima; sin nada abierto, la app pasa a segundo plano.
**Accesos en la pantalla de inicio:** en el menú de un atajo o de una gráfica, "Añadir a la pantalla de inicio" crea un
acceso directo (Android lo confirma). Al tocarlo, Boni se abre y hace lo mismo que tocar el atajo dentro (abrir el
formulario relleno o guardar con "Deshacer"), o abre esa gráfica. Los cuatro primeros atajos salen también al mantener
pulsado el icono de Boni. Si se renombra un atajo, su acceso cambia de nombre; si se borra, queda desactivado.
**Widgets de inicio:** una imagen de la misma tarjeta de la gráfica que se ve en la app (la dibuja la propia web en un
WebView que no se muestra, al tamaño del widget). Al ponerlo se elige la gráfica (se puede cambiar manteniéndolo
pulsado); al tocarlo, Boni abre esa gráfica. Se redibujan al abrir la app, cuando el servidor avisa de cambios con la
app abierta, después de enviar la cola sin conexión y cada 30 minutos.
El CI (`android.yml`) compila el APK; con los secretos del keystore, cada cambio en `main` publica una release
`android-v0.1.N` que instala Obtainium.

## Escritorio: widgets
Cada widget es una ventana pequena, sin bordes y transparente, con una grafica interactiva: al pasar el raton se ve el valor y
sus controles (periodo y menu), al tocar un punto su detalle; se mueve arrastrandola, se cambia de tamano desde la esquina y
el boton derecho abre el mismo menu (abrir o editar en Boni, actualizar, ocultar aqui, quitar). En Linux con X11 es una ventana de tipo "dock" que el gestor de ventanas mantiene debajo de las demas y en todos los
escritorios (`wmctrl -b add,below,sticky`): queda justo encima del fondo, sobrevive a "Mostrar escritorio" y a los clics en el
escritorio, y no sale en la barra ni en Alt+Tab. Se probo en muffin (el gestor de Cinnamon) el 2026-10-17: una ventana de tipo
"desktop" se queda detras del fondo al hacer clic en el escritorio y una normal "debajo" se oculta con Super+D. Sin wmctrl, o
en Wayland, son ventanas normales sin bordes.

Boni arranca al iniciar sesion (`~/.config/autostart/boni.desktop`, con `--background`) con los widgets y el icono de la
bandeja; cerrar la ventana principal la libera y Boni sigue en la bandeja. Los cambios llegan en directo (`/api/v1/events`, una
conexion para toda la app); sin ella, una sola pagina (la ventana principal, o el primer widget si no esta abierta) recarga
todo cada 15 minutos. Esa misma pagina envia la cola sin conexion cada minuto. Sin conexion los widgets muestran los
ultimos datos guardados. Coste medido (2026-10-17, tres widgets sin la ventana principal): 334 MB en total (unos 35 MB por
widget mas lo comun de Electron), frente a 373 MB del primer cliente, y un 0,4 % de CPU en reposo.

Los ajustes son el mismo archivo que usaba el primer cliente (`~/.config/boni/settings.json`): al cambiar de app se conservan
servidor, token y posiciones; la primera vez los widgets aparecen donde estaban los desklets de Cinnamon del primer cliente.
