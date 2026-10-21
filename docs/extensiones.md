# Boni extensible: extensiones, memoria y autoconocimiento

Propuesta (Claude, 2026-10-21) a petición de Juan, pendiente de su aprobación. Amplía `docs/nucleo.md`: aquel define el
núcleo seguro (entidades, procedencia, agente con planes, políticas, lectores en cuarentena); este define **cómo se
construye todo lo demás encima** sin que el código se llene de casos especiales. Prioridad: el escritorio (Electron y
Chrome); el móvil, más adelante.

## 1. El problema, visto en el correo

El lector de correos de hoy funciona, pero está hecho a mano de punta a punta:

| Pieza | Dónde está hoy | Problema |
|---|---|---|
| Conector IMAP | `apps/server/src/mail.ts` | Bien: tocar la red es código |
| Colección "Correos" y sus campos | `FIELDS` en `mail.ts` | Fijo en el código |
| Qué buscar (tareas, eventos) | `MODULES` en `packages/agent/src/reading.ts` | Para buscar otra cosa hace falta un PR |
| El plan de cada correo | `mailPlan()` en `mail.ts` | Fijo en el código |
| Cuándo se ejecuta | el bucle de `Mails` | Fijo en el código |
| La guía, las reglas, la revisora | `mail.ts`, `mailReview.ts` | Solo sirven para el correo |
| Sus ajustes | `SettingsModal.tsx`, a mano | Cada función nueva, más React a mano |
| Dónde se guarda cada cosa | `account_data` (ajustes, guía, estado), el almacén (correos, propuestas), el registro | Repartido en cinco sitios |

Si mañana Juan quiere "lee mis PDF de la carpeta X y apunta los plazos", o "avísame si un correo es urgente", habría que
repetir todo. Y Boni no podría hacerlo por sí mismo, porque lo que haría falta cambiar es código.

**La idea:** separar lo que es **seguridad y capacidad** (código revisado, pocas piezas) de lo que es **composición**
(datos que Boni puede crear y cambiar con el visto bueno de Juan). El correo pasa a ser la primera **extensión**: un
paquete de datos hecho solo con piezas del catálogo.

## 2. Cuatro capas, de lo abstracto a lo concreto

Cada capa solo puede usar lo que le da la de arriba, y la de arriba la valida. Así la coherencia (robustez, estilo
visual, forma de razonar, usabilidad) no depende de que cada función nueva se haga bien: depende de las capas.

| Capa | Qué es | Quién la cambia | Ejemplos |
|---|---|---|---|
| **0. Principios** | Las reglas de todo Boni | Juan (decisiones), con PR | Modelo de amenazas y políticas P1-P18 (`nucleo.md`), guía de diseño, "decide el código, no el modelo", "lo común primero" |
| **1. Catálogos** | Las piezas, en código revisado y probado | Desarrollo (Claude Code + Juan), con PR | Herramientas, conectores, funciones de los planes, lectores base, componentes de interfaz, tipos de tarjeta, papeles de modelo |
| **2. Extensiones** | Paquetes declarativos hechos con piezas del catálogo | Boni, **siempre como propuesta que Juan acepta**; o vienen hechas ("presets") | Correo, Calendario, Libros, "Plazos de mis PDF" |
| **3. Datos** | Lo de Juan | Juan, y Boni dentro de las políticas | Entidades, la guía de lectura con sus reglas y ejemplos, valores de ajustes, decisiones |

**La regla que lo ordena:** nada de la capa 2 o 3 puede hacer algo que el catálogo no permita. Una extensión no trae
código: trae datos que el código interpreta, igual que un plan. Por eso Boni puede crear extensiones sin que eso sea
"ejecutar lo que dice el modelo".

## 3. La extensión

Un **manifiesto** guardado en el almacén del usuario (una entidad de un tipo de sistema `extension`, con procedencia,
versión, Deshacer y exportación como todo lo demás). Sus partes, todas opcionales:

| Parte | Qué declara | Pieza del catálogo que usa |
|---|---|---|
| `types` | Las colecciones que trae (p. ej. "Correos" con sus campos) | Operaciones de esquema (`nucleo.md` 4.3) |
| `sources` | De dónde vienen los datos: conector + configuración + referencia al secreto | Catálogo de conectores: IMAP, iCal, vault, carpeta de archivos, web… |
| `readers` | Qué buscar al leer contenido de fuera: módulos de lectura (su trozo de prompt, los campos del elemento, la clase) | El lector base `read_message` (7.4b) |
| `flows` | Cuándo y qué: un disparador y un plan plantilla | Disparadores (al llegar un elemento, a una hora, al cambiar algo) y el lenguaje de planes |
| `routes` | Qué hace el código con cada elemento leído: proponer en una colección, avisar, nada | Acciones de ruta (todas pasan por la política: P4, P7) |
| `guide` | Indicaciones de Juan, reglas y ejemplos para sus lectores | Memoria con ámbito (sección 5) |
| `learning` | Si sus decisiones alimentan a la revisora y cada cuántas | La revisora genérica (7.4b, punto 3) |
| `ui` | Sus ajustes, sus vistas y las tarjetas de sus peticiones | Componentes del catálogo (sección 6) |
| `needs` | Lo que pide: colecciones que lee y escribe, clases de efecto, papeles de modelo, presupuesto diario | Capacidades (las impone el código, como las de las herramientas) |

**El correo como extensión** (esquema, abreviado):

```jsonc
{
  "id": "correo", "name": "Correo", "version": 3,
  "types": [{ "key": "correo", "name": "Correos", "fields": ["asunto", "de", "de_nombre", "para", "cc", "fecha", "adjuntos"] }],
  "sources": [{ "connector": "imap", "config": { "folder": "INBOX", "every": "5m" }, "secret": "mail-password", "into": "correo" }],
  "readers": [
    { "module": "tasks",  "kind": "task",  "prompt": "something the message asks the user to do…", "fields": ["title", "due"] },
    { "module": "events", "kind": "event", "prompt": "something the user is expected to attend…",  "fields": ["title", "due"] }
  ],
  "flows": [{ "on": "created:correo", "plan": "read-and-propose" }],
  "routes": { "tasks": { "propose": "chosen-collection" }, "events": { "propose": "chosen-collection" } },
  "learning": { "every": 20 },
  "ui": { "settings": [ "status", { "group": "targets" }, { "group": "guide" }, { "group": "more", "items": ["reread", "mailbox"] } ] },
  "needs": { "reads": ["correo"], "proposesInto": "user-chosen", "roles": { "reader": "cheap", "reviewer": "cheap" }, "budget": { "readersPerDay": 150 } }
}
```

Lo que **sigue siendo código** (capa 1) y la extensión solo nombra: el cliente IMAP, el lector base con su validación,
la decisión de qué elementos pasan (`actor = recipient`), la política, la revisora y sus comprobaciones, y los
componentes de los ajustes. Lo que **pasa a ser dato**: la colección, los módulos, el plan, el disparador, las rutas, la
estructura de los ajustes y el presupuesto.

**"Lee mis PDF y apunta los plazos"** sería otra extensión con el conector `files` (una carpeta, solo lectura), el
mismo lector base con un módulo `deadlines`, el mismo flujo y la misma revisora. Ninguna línea de código nueva si el
conector existe; si no existe, eso sí es un PR (capa 1).

**Cómo crea o cambia Boni una extensión** (Juan: "quiero que omitas los boletines"):
1. El planificador, que conoce el catálogo y las extensiones instaladas (sección 7), arma un **cambio de manifiesto**
   (p. ej. una regla en la guía del correo) con la herramienta `extensions.propose`.
2. El código lo valida contra el catálogo y contra `needs` (un cambio que pide más capacidades lo dice en grande).
3. Si cambia lo que hace (flujos, rutas, fuentes), el código lo **ensaya** en seco sobre datos ya existentes (p. ej.
   los correos de la última semana) y enseña el resultado: "con este cambio, de 45 correos, 12 dejarían de dar
   propuestas".
4. Juan lo acepta en una tarjeta. Queda en el registro con Deshacer. Un correo nunca puede crear ni cambiar una
   extensión (P16, ampliada a manifiestos).

## 4. Dónde se guarda cada cosa

Una sola regla: **lo del usuario, en su almacén** (SQLite por usuario, cifrado con su clave, exportable, con procedencia
y Deshacer); **lo del servidor, en `system.db`** (cuentas, dispositivos, sesiones y claves). Hoy hay cosas del usuario
fuera de su almacén (ajustes del correo, guía, estado, preferencias, gráficas y atajos de v1 en `system.db`). Se mueven.

| Qué | Dónde | Tipo de sistema |
|---|---|---|
| Datos de Juan | almacén | sus tipos |
| Extensiones | almacén | `extension` (manifiesto versionado) |
| Ajustes de una extensión (valores) | almacén | dentro de su instancia de `extension` |
| Secretos (contraseña del correo, claves de modelos) | almacén, cifrados con su clave; nunca vuelven a un dispositivo | `secret` (solo el código los lee) |
| Estado de una fuente (cursor IMAP, último UID) | almacén | `source_state` |
| Memoria (sección 5) | almacén | `memory` con ámbito y clase |
| Propuestas, peticiones, decisiones, ejecuciones | registro del almacén (ya está) | journal |
| Vistas, páginas, atajos | almacén | `view`, `page`, `miniapp` (PR 16, 18) |

Ventajas: una exportación lo lleva todo; Deshacer funciona igual para un ajuste que para un dato; el agente lee con la
misma vista filtrada (`readStore`, "Lo que ve la IA") todo lo que no es secreto; y migrar a otro servidor es copiar un
fichero.

## 5. Memoria

**Hoy** hay tres "memorias" sin relación:
- En el núcleo, `memory`: notas de texto sueltas que guarda `memory.save` y que el planificador recibe (las
  confirmadas).
- La guía de lectura del correo: indicaciones, reglas y ejemplos, solo del correo, en `account_data`.
- Fuera de Boni, en el trabajo con Claude Code: notas Markdown del vault (`AGENTS.md`, notas de proyecto) y la memoria
  por proyecto de Claude. Es memoria del desarrollo, no de Boni.

No es Markdown dentro de Boni, pero sí es demasiado simple para lo que viene: cada extensión necesita sus indicaciones,
sus reglas y sus ejemplos, el planificador necesita saber qué prefiere Juan en general, y todo tiene que poder
corregirse y medirse.

**Propuesta: una memoria con ámbito y clase**, en el almacén:

| Clase | Qué es | Quién la escribe | Quién la usa |
|---|---|---|---|
| `instruction` | Una indicación de Juan en lenguaje natural ("los boletines no me interesan") | Juan, o Boni como propuesta que Juan acepta | El modelo del ámbito (planificador o lector) |
| `rule` | Una regla de un catálogo cerrado que aplica el código ("de @x.com: no leer") | Igual | El código, sin modelo |
| `example` | Un caso decidido: entrada (de fuera, entre marcas) y lo que Juan quiso | La revisora, como propuesta | El lector del ámbito |
| `fact` | Un dato sobre Juan o su mundo que no es una entidad ("prefiere las reuniones por la mañana") | Juan o el planificador (`model`: no entra en contexto hasta que Juan lo confirma, 7.13) | El planificador |
| `decision` | Una decisión de Juan sobre una propuesta o petición | El código | La revisora |

Cada memoria tiene un **ámbito**: `global`, una extensión (`correo`), un módulo (`correo/tasks`), una colección o una
vista. Al preparar una llamada a un modelo, el código reúne la memoria **de su ámbito y de los de arriba**, con un
presupuesto de tokens por papel, y nunca la de otros ámbitos. La guía del correo de hoy pasa a ser, sin cambiar lo que
hace, `instruction` + `rule` + `example` con ámbito `correo`; y la revisora, una pieza genérica para cualquier extensión
con `learning`.

**Lo que no cambia:** ningún texto de fuera escribe memoria (P9); lo que llega a un lector de contenido externo es solo
la memoria de su ámbito, con la etiqueta `guide` (la excepción de A14 de 7.4b, generalizada a "la guía del ámbito"); lo
que escribe un modelo no vuelve a su contexto sin el sí de Juan.

**Estudiar a fondo (Juan lo pide):** recuperar memoria por búsqueda (FTS y, más adelante, embeddings locales) cuando
crezca; caducidad y conflictos entre indicaciones ("Juan dijo X en marzo y lo contrario en junio": gana la última y se
le pregunta); y una pantalla "Lo que Boni sabe de ti", por ámbito, donde todo se lee, se corrige y se borra.

## 6. Interfaz: catálogo de componentes y especificaciones

Para que Boni pueda construir funciones con un estilo coherente, la interfaz se divide igual que el resto:

- **Catálogo (código, capa 1):** componentes de la guía de diseño, y solo ellos: sección, grupo plegable con resumen,
  fila de ajuste, interruptor, desplegable, área de texto, lista con Quitar, fila de "añadir", tarjeta de petición,
  vistas (tabla, tablero, calendario, gráfica…), formulario. Cada uno con sus reglas (lo común primero, el texto cabe,
  accesible) y sus pruebas.
- **Especificaciones (datos, capa 2):** qué componentes y con qué datos. Los ajustes del correo dejan de ser React a
  mano y pasan a ser `ui.settings` de su manifiesto. Una extensión nueva trae sus ajustes sin tocar `SettingsModal.tsx`.
- **Peticiones** (la idea de Juan del panel de la derecha): una petición es algo que Boni necesita de Juan. Un catálogo
  cerrado de clases, cada una con su tarjeta: sí/no, elegir entre opciones (las que la IA cree más probables primero),
  "¿es esta persona o la creo?" (buscar + crear), selección múltiple, escribir, completar campos que faltan, aceptar un
  cambio de manifiesto o de guía (con su ensayo y su medida). Las propuestas de la bandeja y la sugerencia de la
  revisora de hoy son dos de esas clases. Todas viven en el registro y salen en el panel de la derecha.

**Cada componente lleva su referencia** (`data-boni-ref="ext:correo/settings/guide/rules"`): la ruta de la
especificación que lo pintó. Es lo que permite el asistente de la sección 8 sin capturas de pantalla.

## 7. Boni se conoce a sí mismo

Para que Boni sepa qué puede cambiar cuando Juan se lo pide, necesita un **mapa de sí mismo** que no dependa de leer el
código fuente en cada turno:

- **Generado al compilar** (como hoy el esquema de herramientas): el catálogo entero con descripciones y esquemas
  (herramientas, conectores, lectores, funciones de los planes, componentes con sus propiedades, clases de petición,
  papeles), las políticas resumidas por id, y los principios de la guía de diseño. Va en la imagen, con su hash.
- **En tiempo de ejecución:** las extensiones instaladas con sus manifiestos, la memoria por ámbito y la pantalla en la
  que está Juan (sección 8).
- **Herramientas de lectura** para el planificador: `boni.describe(qué)` (una pieza del catálogo o una extensión) y
  `boni.docs.search(texto)` (los documentos de diseño, troceados). Son `read`, sin efectos.

**Hasta dónde se modifica a sí mismo:**
- **Capa 2 y 3 (extensiones, memoria, ajustes, vistas):** sí, con propuestas que Juan acepta, validadas y ensayadas.
- **Capa 1 (código):** no en marcha. Si lo que Juan pide necesita una pieza nueva del catálogo (un conector de Gmail
  API, un componente nuevo), Boni lo dice y redacta una **petición de cambio** (qué pieza falta, por qué, un borrador de
  su contrato) que acaba en un PR hecho por un agente de desarrollo (Claude Code) y revisado como hoy. Un servidor que
  reescribiera su propio código en marcha rompería todo el modelo de seguridad: el código es la única frontera.

## 8. El asistente que ve la pantalla (escritorio; más adelante)

- **Botón abajo a la derecha** (y un atajo de teclado): texto o voz. La voz se transcribe (un modelo local o el del
  proveedor elegido por papel `voice`) y entra como un turno normal de Juan.
- **Contexto de pantalla sin capturas:** la app manda con el turno un **contexto de interfaz** estructurado: la ruta
  (sección y grupo abiertos), los `data-boni-ref` visibles y el que tiene el foco, y los valores de esos componentes
  (de confianza: son de la app). El planificador recibe la especificación de esa parte (sección 6) y su extensión. "Quiero
  que omitas este tipo de correos" en Ajustes → Correo se entiende como un cambio en la guía de `correo`; si no está
  claro, Boni pregunta con una tarjeta de elegir.
- **Modo señalar** (Ctrl+Shift): el ratón resalta componentes; un clic o un área seleccionada añade sus referencias al
  contexto del turno ("esto", "estas filas"). Lo que se señala es una referencia a la especificación, no píxeles.
- **Seguridad:** el contexto de interfaz lo arma el código de la app, no el modelo; los valores externos que se vean en
  pantalla (el texto de un correo) siguen llegando al planificador como asas, igual que desde cualquier otra parte
  (`toPlannerView`).

## 9. Papeles de modelo

Ya está decidido elegir modelo por papel (7.10, PR 20). Con las extensiones, cada paso declara un **papel**, no un
modelo, y el papel tiene un **perfil**:

| Papel | Para qué | Perfil por defecto |
|---|---|---|
| `planner` | Entender a Juan y armar planes | Potente |
| `reader` | Leer contenido de fuera con esquema fijo | Barato (Haiku 4.5: 40/40 en `eval/mail.ts`) |
| `reader-strong` | Lectores que lo necesiten (documentos largos, varias páginas) | Medio |
| `reviewer` | La revisora | Barato |
| `voice` | Transcribir | Local si se puede |
| `builder` | Proponer extensiones y cambios de manifiesto | Potente |

Cada perfil dice proveedor, modelo, clase de privacidad (`local`, `external-api`) y coste. El router elige con dos reglas
del código: lo que "Lo que ve la IA" restringa por clase de privacidad, y el presupuesto de la extensión. Cambiar de
modelo un papel es un ajuste, y antes de usarlo se pasa su evaluación (`eval/*.ts`).

## 10. Qué cambia en el plan de PRs

Esto no es otro proyecto: es la forma de hacer los PR 16 a 21 sin duplicar código. Propuesta de orden (escritorio):

| # | PR | Recoge |
|---|---|---|
| A1 | **Extensiones:** tipo `extension`, registro y validador de manifiestos contra el catálogo, `needs` como capacidades; el correo pasa a ser la primera (preset), sin cambiar lo que hace; `mailPlan`, módulos y rutas salen de su manifiesto | — |
| A2 | **Todo lo del usuario a su almacén:** ajustes, secretos (cifrados con su clave), estado de las fuentes, guía; `account_data` se queda para lo del servidor | — |
| A3 | **Memoria con ámbito y clase:** `instruction`, `rule`, `example`, `fact`, `decision`; la guía del correo migra; la revisora pasa a ser genérica | 7.13 |
| A4 | **Interfaz por especificaciones:** catálogo de componentes con `data-boni-ref`; los ajustes de cada extensión salen de su manifiesto; las peticiones con sus clases de tarjeta en el panel de la derecha | 16 (parte), 18-19 (base) |
| 16 | Lo que queda del 16: fuera "Apuntar gasto" y lo fijo de Juan, como extensiones o vistas | 16 |
| A5 | **Autoconocimiento:** el mapa generado, `boni.describe`, `boni.docs.search`, y `extensions.propose` con ensayo en seco | — |
| 17 | Reglas de lo que ve la IA dentro de una colección | 17 |
| 18-19 | La app como Notion, con el catálogo de A4 | 18-19 |
| 20 | Papeles con perfiles (sección 9) | 20 |
| 21 | Automatizaciones = los `flows` de las extensiones, creados hablando | 21 |
| A6 | El asistente que ve la pantalla, voz y modo señalar (escritorio) | — |

## 11. Para decidir (Juan)

1. **Nombre** de la pieza: "extensión" (como en un navegador), "módulo" o "habilidad". Recomendado: **extensión**.
2. **Frontera de la automodificación:** Boni cambia datos (extensiones, memoria, ajustes, vistas) con propuestas; el
   código solo con PR revisado. Recomendado: **sí**.
3. **Orden:** A1-A4 antes de lo que queda del PR 16. Recomendado: **sí**, porque el 16 se hace dentro de A4.
4. **Memoria:** aprobar la memoria con ámbito y clase (sección 5) como base, y estudiar después búsqueda, caducidad y la
   pantalla "Lo que Boni sabe de ti".
