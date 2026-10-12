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

## Dispositivos
Cada cliente usa su propio token. Se crea en el servidor y se muestra **una sola vez** (solo se guarda su hash):
```
boni device add portatil      # imprime el token: guardalo en Vaultwarden y en el cliente
boni device list
boni device remove portatil
```

## Desarrollo
```
uv venv -p 3.12 && uv pip install -e '.[dev]'
pytest            # sin red: un vault-mcp falso con el SDK real (en memoria y por HTTP con token)
ruff check .
python -m boni.contract --write                  # regenera api/schema tras cambiar el contrato
BONI_UPDATE_EXAMPLES=1 pytest tests/test_contract.py   # regenera api/examples
```
