# Servidor de Boni

Python 3.12, FastAPI, SDK oficial de MCP (`mcp==2.3.0`, protocolo 2026-07-28, el mismo que vault-mcp) y SQLite.

## Que hace (version minima)
- **Apuntar gasto**: el formulario lo describe el servidor (`GET /api/v1/screens/capture-expense`); al guardar
  (`POST /api/v1/actions`) valida, genera la nota de movimiento con el mismo formato que la app de gastos y la escribe en
  el vault con la herramienta `create_note` de vault-mcp (`status: pendiente`, `source: manual`). Si vault-mcp no responde,
  el gasto queda en la cola de salida (SQLite) y se reintenta cada minuto. Cada captura lleva un `client_id`: reenviarla no
  la duplica.
- **Graficas**: gasto del mes por grupo de categoria (con detalle por categoria), gasto por mes (12 meses, linea de media)
  y comida fuera. Lee los movimientos con `query_notes` (un mes por consulta, con cache de 2 minutos). Si vault-mcp no
  responde, sirve los ultimos datos marcados como `stale`.
- **Widgets**: lista de graficas para cada dispositivo (la posicion la guarda el cliente).

## Configuracion (variables de entorno)
| Variable | Que es |
|---|---|
| `BONI_VAULT_MCP_URL` | URL de vault-mcp, p. ej. `http://vault-mcp:8000/mcp` en la red interna del NAS |
| `BONI_VAULT_MCP_TOKEN` | Token de vault-mcp (secreto: solo en el `.env` del NAS, copia en Vaultwarden) |
| `BONI_DB` | Archivo SQLite (en la imagen: `/data/boni.sqlite3`) |
| `BONI_TZ` | Zona horaria (por defecto `Europe/Madrid`) |

## Cuentas y sesiones (como el servidor de Boni Calendar)
Las cuentas las crea el administrador en el servidor (no hay registro). Cada equipo entra una vez desde Ajustes con
usuario, contrasena y un nombre para el equipo, y guarda un token de sesion (el servidor solo guarda su hash). Los widgets
y preferencias son de cada equipo (por su nombre). Una sesion sin usar 90 dias se cierra; cambiar la contrasena cierra
todas las de ese usuario. Intentos fallidos limitados: 5 por usuario y 10 por direccion en 15 minutos, 30 por minuto en
total.
```
boni user add juan            # pide la contrasena dos veces (12 caracteres minimo)
boni user list
boni user passwd juan
boni user remove juan
```
Los tokens de dispositivo de antes (`boni device add`) siguen valiendo hasta borrarlos: `boni device list`,
`boni device remove portatil` cuando todos los equipos hayan entrado con usuario.

## En directo
`GET /api/v1/events` (server-sent events): `event: changed` con `{"what": "charts" | "widgets" | "data" | "shortcuts"}` cuando
cambian las graficas, los widgets, los datos o los atajos (un gasto escrito, o cambios en el vault que detecta el refresco de cada 2 minutos).
Los clientes recargan solo lo que cambio.

## Desarrollo
```
uv venv -p 3.12 && uv pip install -e '.[dev]'
pytest            # sin red: un vault-mcp falso con el SDK real (en memoria y por HTTP con token)
ruff check .
python -m boni.contract --write                  # regenera api/schema tras cambiar el contrato
BONI_UPDATE_EXAMPLES=1 pytest tests/test_contract.py   # regenera api/examples
```
