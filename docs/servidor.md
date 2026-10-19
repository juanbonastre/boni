# Boni Calendar Server

Servidor propio para que todos los dispositivos usen el mismo calendario, como Notion Calendar (plan aprobado por Juan el
2026-10-17). Codigo en `apps/server`.

## Principios
- **La verdad son las notas del vault.** El servidor lee y escribe el vault con las mismas reglas que las apps (reutiliza
  `packages/calendar`, el lector del vault de la web y el acceso a archivos del escritorio). No hay base de datos paralela de eventos.
- **SQLite solo para lo que no son datos del calendario:** cuentas, sesiones y, mas adelante, ajustes y secretos por cuenta.
- **El modo local sigue existiendo:** las apps pueden trabajar con una carpeta del vault sin servidor.
- **Cuentas creadas por el administrador** (sin registro abierto). Primero solo por Tailscale; Funnel en la fase 6.

## Fases
1. Servidor de solo lectura: cuentas, foto del calendario, cambios por version y en vivo, app web servida (hecho).
2. Clientes en modo servidor (Ajustes, Datos), con copia sin conexion (hecho).
3. Escritura a traves del servidor (cola de cambios, conflictos) (hecho).
4. Ajustes y calendarios externos por cuenta en el servidor (hecho).
5. Avisos: los muestra la app; el servidor la mantiene al dia (sincronizacion en segundo plano y UnifiedPush).
6. Funnel, limites de intentos, copias de SQLite (en marcha; varios usuarios: no por ahora, decision de Juan).

## API (fase 1)
Todo en JSON bajo `/api`; salvo el inicio de sesion, con `Authorization: Bearer <token>`.

| Llamada | Que hace |
|---|---|
| `POST /api/login` `{ user, password, device }` | Inicia sesion en un dispositivo: `{ token }` |
| `POST /api/logout` | Cierra esa sesion |
| `GET /api/snapshot` | El calendario ahora: definiciones, filas, `version`, notas que no se pueden colocar |
| `GET /api/changes?since=N` | Filas cambiadas o quitadas despues de la version N (o `full: true`: pedir foto nueva) |
| `GET /api/stream` | Eventos en vivo (Server-Sent Events): un `changes` por version nueva |
| `GET /api/me` | `{ user, write }`: la cuenta y si el servidor escribe en el vault |
| `POST /api/apply` `{ base, changes }` | Escribe cambios de filas (fase 3, con `BONI_WRITE=1`): `{ version, aliases }`, 409 `{ conflict }` si alguna nota cambio en otro sitio despues de `base`, 403 si el servidor es de solo lectura |
| `GET /api/account` | Lo que la cuenta comparte entre sus dispositivos: `{ prefs, externals, updated }` (fase 4) |
| `PUT /api/account/prefs` `{ prefs }` | Guarda las preferencias de la cuenta |
| `PUT /api/account/externals` `{ externals }` | Guarda la lista de calendarios externos (cifrada) |
| `GET /api/external?id=X[&fresh=1]` | Ese calendario externo, descargado por el servidor: `{ text, at }` |
| `PUT /api/collections/reminders` `{ collectionId, reminders?, eventColumn? }` | Avisos de un calendario, escritos en su definicion (fase 5, con `BONI_WRITE`) |
| `GET /api/reminders?tz=&hours=&locale=&h24=` | Los avisos de la cuenta de las proximas horas, ya redactados para el dispositivo (fase 5) |
| `PUT /api/push` `{ endpoint }` / `DELETE /api/push` | Direccion UnifiedPush de este dispositivo (solo en los hosts de `BONI_PUSH_HOSTS`) |
| Cualquier otra ruta | La app web (para abrir el calendario desde un navegador) |

Una nota sin cambios conserva la misma fila, asi que el servidor sabe exactamente que cambio comparando filas. El vigilante del
vault (el mismo del escritorio) detecta lo que llega por Syncthing. Las versiones parten del reloj al arrancar, asi que siguen
creciendo tras un reinicio: un dispositivo con una version anterior pide una foto nueva.

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

## Escritura (fase 3)
- Solo si el servidor arranca con `BONI_WRITE=1` (y el vault montado con escritura); si no, los calendarios llegan de solo
  lectura y `POST /api/apply` responde 403.
- El servidor escribe con el mismo escritor que las apps (`apps/calendar-web/src/vault/provider.ts`): solo las propiedades cambiadas,
  notas nuevas con el nombre de la definicion, mover entre calendarios, papelera `.trash` del vault, nunca encima de una
  nota que cambio en disco desde que se leyo.
- Conflictos: cada lote lleva la version que tenia el dispositivo (`base`). Si una de sus notas cambio despues por otra via
  (Obsidian por Syncthing, otro dispositivo), no se escribe nada y responde 409; lo que escribio la propia sesion no cuenta.
  Limitacion: lo que cambio mientras el servidor estaba parado no se detecta asi (solo la comprobacion de disco).
- El cliente (`apps/calendar-web/src/serverWriter.ts`) aplica el cambio en pantalla al momento y lo guarda en una cola del
  dispositivo (IndexedDB); la envia en orden, en una sola peticion, ahora o al volver la conexion (tambien tras cerrar y
  abrir la app). Lo pendiente se sigue viendo encima de lo que manda el servidor hasta que llega su version. Un evento
  nuevo se conoce por un id temporal hasta que el servidor dice la ruta de su nota (`aliases`); mientras no tiene titulo
  no es nota, asi que vive solo en el dispositivo (no desaparece al responder el servidor).
- Si el servidor rechaza un lote (conflicto u otro error), la app lo dice ("La nota cambio fuera de la app...") y recarga
  la foto del servidor; ese cambio se pierde.
- Cerrar sesion intenta enviar lo pendiente; si no hay conexion, queda en el dispositivo para la proxima vez.
- Las series abiertas (una nota por repeticion) las prolonga el propio servidor, con la misma regla que la app en modo
  carpeta (hasta unos 12 meses, sin rellenar huecos): cada vez que cambia el vault y cada pocas horas. Asi ningun
  dispositivo en modo servidor tiene que hacerlo y dos de ellos nunca crean las mismas notas.

## Cuenta: preferencias y calendarios externos (fase 4)
- Con servidor, los calendarios externos y algunas preferencias son de la cuenta, no del dispositivo: se ven y se cambian
  igual desde todos. Preferencias de la cuenta: idioma, reloj de 24 horas, primer dia de la semana, segunda zona horaria,
  numeros de semana, duracion por defecto e intervalo al arrastrar. Se quedan en cada dispositivo: tema, densidad y zona
  horaria (un movil y un portatil, un viaje).
- Las direcciones de los calendarios son secretas: el servidor guarda la lista cifrada (AES-256-GCM) en SQLite. La clave es
  `BONI_SECRET_KEY` (32 bytes en base64) o, sin ella, `secret.key` junto a la base de datos, creada al primer arranque
  (permisos 600). **Guarda una copia de la clave aparte de las copias de la base de datos**: sin ella no se pueden leer.
- El servidor descarga los calendarios (los dispositivos solo hablan con el): guarda una copia unos minutos y el boton de
  actualizar pide una nueva. Solo descarga direcciones publicas: nunca la red local, el NAS ni la tailnet (comprobado tambien
  en cada redireccion), con limite de tamano y de tiempo. Desde el 2026-10-19 (`packages/net`) la comprobacion se hace al
  conectar, con la misma resolucion del nombre que usa la conexion: un nombre no puede pasar la comprobacion y despues
  apuntar a una direccion interna (DNS rebinding). Una IPv4 escondida dentro de una IPv6 cuenta como esa IPv4.
- La primera vez que un dispositivo se conecta a la cuenta, sus propios calendarios externos se unen a los de la cuenta
  (por direccion; la app avisa de cuantos), y si la cuenta no tenia nada toma sus preferencias. Despues manda la cuenta,
  salvo lo cambiado sin conexion en ese dispositivo, que se envia al volver.
- Los cambios llegan en vivo a los demas dispositivos (evento `account` del flujo).

## Avisos (fase 5, en marcha)
- Cada calendario tiene avisos por defecto (uno para eventos con hora y otro para los de todo el dia) en su definicion:
  `reminders: { timed: "10m", allDay: "0d@09:00" }`. Por defecto ninguno avisa. Un evento puede tener los suyos en la
  propiedad `avisos` de su nota ("1h, 10m", "none"); la columna se anade a la definicion la primera vez.
- Los calendarios externos guardan sus avisos en la cuenta (junto a su direccion).
- Hecho: configuracion (Ajustes, Avisos; detalle del evento), notificaciones en la app de escritorio mientras esta abierta.
- El servidor calcula los avisos de la cuenta de los proximos dias (`GET /api/reminders`), redactados en la zona horaria e
  idioma del dispositivo, incluidos los calendarios externos que avisan (los descarga el).
- UnifiedPush: cada sesion de un dispositivo puede registrar la direccion que le dio su distribuidor (la app ntfy). Cuando
  cambia el vault o la cuenta, el servidor publica ahi un mensaje corto ("reminders") y el dispositivo pide sus avisos otra
  vez. Solo se aceptan direcciones de `BONI_PUSH_HOSTS` (el servidor ntfy); `BONI_PUSH_TOKEN` es el token de una cuenta de
  ntfy con permiso de escritura en los temas `up*`. Si el distribuidor responde 404 o 410, la direccion se olvida.
- App de Android: los avisos son alarmas exactas del sistema que muestran una notificacion aunque la app este cerrada
  (canal "Avisos"; pide permiso de notificaciones la primera vez); al tocarla se abre el calendario en ese evento. Con
  carpeta local, la pagina le pasa la lista de las proximas 48 h. Con servidor, la app la pide ella misma
  (`GET /api/reminders`, 7 dias): al llegar un mensaje UnifiedPush (la app ntfy como distribuidor, si esta instalada),
  al reiniciar el movil y cada pocas horas por si se perdio alguno. Las alarmas se vuelven a poner tras reiniciar.
- Para UnifiedPush en el NAS: `BONI_PUSH_HOSTS` con el host de ntfy y `BONI_PUSH_TOKEN` (cuenta de ntfy con escritura en
  `up*`); en ntfy, la cuenta del movil necesita lectura en `up*`.

## Abierto a internet (fase 6)
Decision de Juan (2026-10-17): Funnel con protecciones, un solo vault (sin varios usuarios por ahora).
- **Limites al iniciar sesion** (`limits.ts`): 5 fallos de un usuario en 15 min hacen esperar 15 min a los nuevos inicios
  de ese usuario (las sesiones ya abiertas siguen funcionando: el movil no se queda fuera); 10 fallos desde una direccion
  en 15 min, lo mismo para esa direccion; como mucho 30 intentos por minuto en total. Responde 429 con `retry-after`. La
  direccion es la de `X-Forwarded-For` solo si la peticion llega del proxy local (Tailscale serve); cada fallo queda en el
  log con su direccion, para comprobar que Funnel la pasa.
- **Sesiones:** una sesion que no se usa en 90 dias deja de valer. `cli.ts revoke <usuario>` cierra todas al momento.
- **Cabeceras:** CSP estricta para la app web (solo sus scripts; no se puede incrustar en otra pagina), `nosniff`,
  `no-referrer`, HSTS. Tiempo maximo para recibir una peticion (30 s).
- **Copias de la base de datos** (`backups.ts`): una al dia en `backups/` junto a la base de datos, coherente aunque el
  servidor este escribiendo (`VACUUM INTO`), se guardan las ultimas `BONI_BACKUPS` (14). La clave `secret.key` no se copia
  ahi: guardala aparte (Vaultwarden).
- Revision de seguridad hecha antes de abrirlo: tokens solo como hash y comparacion en tiempo constante; mismas respuestas
  y tiempos para usuario inexistente o contrasena mala; CORS abierto pero sin cookies (token bearer); el servidor nunca
  descarga direcciones privadas (tampoco tras redirecciones) ni publica en hosts no permitidos; los cambios de filas solo
  tocan notas que el indice conoce o notas nuevas en la carpeta de su coleccion, siempre dentro del vault y nunca en
  `private/` ni `restricted/`; consultas SQL preparadas; tamano maximo de peticion 8 MB. Riesgo residual: un fallo de
  Node o del servidor seria alcanzable desde internet; mantener la imagen al dia.

## Dos entradas (2026-10-20)
Decision de Juan (2026-10-19): el nucleo entero por la tailnet y, por Funnel, solo una lista blanca. El servidor puede
escuchar por dos entradas que comparten todo (limites de inicio de sesion, cambios en vivo):
- `BONI_PORT` / `BONI_HOST` (por defecto `127.0.0.1:8787`): todas las rutas. Es la entrada de la tailnet.
- `BONI_PUBLIC_PORT` / `BONI_PUBLIC_HOST` (opcional; por defecto `0.0.0.0`): solo las rutas que `apps/server/src/routes.ts`
  marca como publicas. Cualquier otra responde 404 antes de mirar la sesion. Es la entrada para Funnel.
Hoy todas las rutas son las del calendario y estan marcadas como publicas, asi que sin `BONI_PUBLIC_PORT` el servidor hace
lo mismo que antes. Las rutas del agente seran solo de la tailnet; antes de que existan, el NAS tendra que llevar Funnel a la
entrada publica (se prepara en el PR de despliegue).

