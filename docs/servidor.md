# Boni Calendar Server

Servidor propio para que todos los dispositivos usen el mismo calendario, como Notion Calendar (plan aprobado por Juan el
2026-10-17). Codigo en `apps/server`.

## Principios
- **La verdad son las notas del vault.** El servidor lee y escribe el vault con las mismas reglas que las apps (reutiliza
  `packages/core`, el lector del vault de la web y el acceso a archivos del escritorio). No hay base de datos paralela de eventos.
- **SQLite solo para lo que no son datos del calendario:** cuentas, sesiones y, mas adelante, ajustes y secretos por cuenta.
- **El modo local sigue existiendo:** las apps pueden trabajar con una carpeta del vault sin servidor.
- **Cuentas creadas por el administrador** (sin registro abierto). Primero solo por Tailscale; Funnel en la fase 6.

## Fases
1. Servidor de solo lectura: cuentas, foto del calendario, cambios por version y en vivo, app web servida (hecho).
2. Clientes en modo servidor (Ajustes, Datos), con copia sin conexion (hecho: solo lectura hasta la fase 3).
3. Escritura a traves del servidor (cola de cambios, conflictos).
4. Ajustes y calendarios externos por cuenta en el servidor.
5. Avisos: los muestra la app; el servidor la mantiene al dia (sincronizacion en segundo plano y UnifiedPush).
6. Funnel, limites de intentos, copias de SQLite, varios usuarios.

## API (fase 1)
Todo en JSON bajo `/api`; salvo el inicio de sesion, con `Authorization: Bearer <token>`.

| Llamada | Que hace |
|---|---|
| `POST /api/login` `{ user, password, device }` | Inicia sesion en un dispositivo: `{ token }` |
| `POST /api/logout` | Cierra esa sesion |
| `GET /api/snapshot` | El calendario ahora: definiciones, filas, `version`, notas que no se pueden colocar |
| `GET /api/changes?since=N` | Filas cambiadas o quitadas despues de la version N (o `full: true`: pedir foto nueva) |
| `GET /api/stream` | Eventos en vivo (Server-Sent Events): un `changes` por version nueva |
| Cualquier otra ruta | La app web (para abrir el calendario desde un navegador) |

Una nota sin cambios conserva la misma fila, asi que el servidor sabe exactamente que cambio comparando filas. El vigilante del
vault (el mismo del escritorio) detecta lo que llega por Syncthing.

## Funcionamiento
- Arrancar en local: `make server` (vault y base de datos segun las variables de `apps/server/src/main.ts`).
- Cuentas: `node apps/server/src/cli.ts add-user <nombre> <carpeta del vault>` (pide la contrasena, 12 caracteres o mas),
  `users`, `revoke <nombre>` (cierra todas sus sesiones, por ejemplo si se pierde un movil).
- Contenedor: `docker build -f apps/server/Dockerfile -t boni-calendar-server .` desde la raiz del repo. Datos en `/data`
  (SQLite); el vault se monta donde diga la cuenta. En el NAS va detras de su propio nodo de Tailscale, como el resto de
  servicios; los ficheros de despliegue viven en el vault (`wiki/infra/configs/`), no en este repo.

## Clientes (fase 2)
- Ajustes, Datos: con carpeta del vault (escritorio, Android) se elige "Origen: Carpeta local | Servidor"; en un navegador
  solo hay servidor; el plugin de Obsidian usa siempre su vault. Con servidor: direccion, usuario y contrasena; el
  dispositivo guarda solo su token de sesion (nunca la contrasena), en su propio almacenamiento.
- La app muestra la ultima copia al abrirse (IndexedDB del dispositivo) y luego la del servidor; sigue los cambios en vivo y,
  si se corta la conexion, se reconecta sola (esperando cada vez mas, hasta un minuto) y pide lo que se perdio.
- Si la sesion se revoca (`cli.ts revoke`), la app lo dice y pide volver a iniciarla. "Cerrar sesion" vuelve a la carpeta
  local (o a los datos de ejemplo en un navegador).
- El servidor admite peticiones de cualquier origen (CORS): las apps de escritorio y Android no se sirven desde el.
