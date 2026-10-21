# Boni extensible: extensiones, memoria y autoconocimiento

Diseño aprobado por Juan (2026-10-21); las decisiones están en la sección 11. Amplía `docs/nucleo.md`: aquel define el
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

| Capa | Qué es | Dónde vive | Quién la cambia |
|---|---|---|---|
| **0. Principios** | Las reglas de todo Boni | El repo (`docs/`, y las políticas en código) | Juan con Claude Code, por PR. Desde Boni, solo los **parámetros** que el código expone, en la "Zona peligrosa" |
| **1. Primitivas** | Lo que solo el código puede hacer con seguridad | El repo (código revisado y probado) | Juan con Claude Code, por PR |
| **2. Definiciones y extensiones** | Lo que se compone con primitivas: conectores, componentes, herramientas compuestas, extensiones | El almacén del usuario (datos) | Boni, **siempre como propuesta que Juan acepta**; o vienen hechas ("presets") |
| **3. Datos** | Lo de Juan | El almacén del usuario | Juan, y Boni dentro de las políticas |

**"Código" y "datos", en concreto:** el código es el repositorio `juanbonastre/boni` de GitHub, del que sale la app;
se cambia con un PR (lo hace Claude Code, lo revisa Juan, pasa el CI y se despliega). Los datos son lo que vive dentro
de Boni, en el almacén de Juan; se cambian desde Boni, con su permiso. **Boni da los bloques** (primitivas) y construye
con ellos; como solo puede usar esos bloques, lo que construye no puede ser raro, inseguro ni salirse del estilo.

**La regla que lo ordena:** nada de la capa 2 o 3 puede hacer algo que las primitivas no permitan. Una extensión no
trae código: trae datos que el código interpreta, igual que un plan. Por eso Boni puede crear extensiones sin que eso
sea "ejecutar lo que dice el modelo".

### 2.1 Zona peligrosa (Ajustes)

Los principios se cambian con Claude Code por PR. Pero algunos tienen **parámetros** que el código deja ajustar, y
esos sí pueden cambiarse desde Boni, en una sección propia, "Zona peligrosa", al final de Ajustes:

| Se puede ajustar ahí | Nunca, ni ahí |
|---|---|
| Qué clases de efecto se confirman siempre (hoy: toda salida a la red) | Que un contenido de fuera ordene algo (P2, P4, P9, P16) |
| Presupuestos diarios por extensión y por papel | Que un literal del modelo sea un destino (P2, P14) |
| Que una extensión use una red privada (un modelo en la LAN) | Que el planificador vea contenido externo (`toPlannerView`) |
| Conceder a una extensión una capacidad que pide (`needs`) | Que algo se borre sin Deshacer o sin confirmar |
| Proveedores de modelo y sus clases de privacidad | Que Boni cambie su propio código |

Con fricción a propósito: solo desde un dispositivo personal, con el código de su app de autenticación (como
agent-sudo), cada cambio explicado con su riesgo en una frase, apuntado en el registro y con Deshacer. Boni puede
**proponer** un cambio de la zona peligrosa, pero nunca aplicarlo: siempre lo acepta Juan ahí.

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

### 3.1 Ampliar el catálogo desde Boni

Juan: "a lo mejor hay algún conector que no se nos había ocurrido y se podría agregar desde Boni". Sí: el catálogo
también tiene dos niveles. Las **primitivas** son código; las **definiciones** hechas con ellas son datos, y Boni puede
proponerlas como cualquier extensión.

| Pieza | Primitiva (código, PR) | Definición (dato, desde Boni) |
|---|---|---|
| Conector | Los protocolos: HTTP/JSON con sus tipos de autenticación (clave, OAuth, básica), IMAP, iCal, RSS, carpeta de archivos, webhooks de entrada, servidores MCP | "La API de X": dirección (la pone Juan), autenticación, rutas, paginación, qué campo va a qué columna. Así hace Airbyte sus conectores de bajo código: la mayoría de las API son formulaicas |
| Componente | Los de la guía de diseño (sección 6) | Componentes compuestos: "tarjeta de tarea con su fecha y dos botones", hechos de componentes base |
| Herramienta | Las del registro, con su clase de efecto | Herramientas compuestas: un plan guardado con parámetros ("archivar los correos de X") |
| Lector | El lector base y su validación | Módulos de lectura (qué buscar) |

Las definiciones heredan las garantías de su primitiva: un conector HTTP definido desde Boni descarga por `@boni/net`
(solo direcciones públicas), su dirección la pone Juan (P18), lo que trae es `external`, y su clave se guarda cifrada.
Un servidor MCP de terceros se da de alta como dice 7.10b: con su clasificación puesta a mano y su esquema fijado por
hash; con esto, ese alta se hace desde la zona peligrosa en vez de en el código. Solo hace falta un PR cuando falta una
**primitiva**: un protocolo nuevo, un componente base nuevo, una clase de efecto nueva.

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

### 5.1 ¿Texto en una base de datos, o un grafo? (investigado, 2026-10-21)

**Lo que se usa hoy en sistemas de memoria para agentes:**
- **Tipos de memoria** tomados de las ciencias cognitivas: de trabajo (lo que entra en el contexto de cada llamada),
  episódica (lo que pasó, con su fecha), semántica (hechos y relaciones) y procedimental (cómo hacer las cosas: reglas,
  flujos, ejemplos).
- **Grafos de conocimiento temporales**: Zep y su motor Graphiti guardan hechos como aristas de un grafo con dos
  tiempos (cuándo fue verdad y cuándo se supo). Un hecho que otro contradice no se borra: se marca como dejó de ser
  verdad (`invalid_at`). Es lo que mejor responde preguntas que dependen del tiempo.
- **Bloques de memoria y consolidación en reposo** (Letta, antes MemGPT): unos pocos bloques pequeños siempre en
  contexto ("sobre el usuario", "esta tarea"), un archivo grande que se busca, y un agente que, mientras el principal
  no trabaja, repasa y consolida. Mem0 combina vectores, grafo y clave-valor.
- **Lo que advierte la investigación de 2026:** la memoria estructurada cuesta (latencia por turno de hasta decenas de
  segundos y millones de tokens para construir los índices en algunos sistemas), y muchos bancos de pruebas ya no
  miden bien porque los modelos de contexto largo los resuelven sin memoria. Moraleja: medir con datos propios.

**Lo que propongo para Boni:**
1. **El almacén ya es un grafo.** Entidades con tipo, relaciones (`links`), procedencia por campo y un registro de
   operaciones con fecha. La memoria no necesita otra base de datos: cada memoria es una entidad de un tipo de sistema
   **enlazada a lo que trata** (un hecho sobre Ana enlaza a la persona Ana; una regla del correo, a la extensión).
2. **Dos tiempos, como Graphiti:** cada memoria lleva desde cuándo vale y, si otra la contradice, hasta cuándo valió
   (nunca se borra; se ve en "Lo que Boni sabe de ti" con su historia). Ante una contradicción, gana la última y Boni
   lo pregunta con una tarjeta.
3. **Tres niveles, como Letta:** el **núcleo** de cada ámbito (pocos bloques, siempre en contexto: "sobre Juan", "guía
   del correo"), el **archivo** (todo lo demás, buscado) y el **registro** (lo que pasó: ejecuciones, decisiones).
4. **Recuperación híbrida dentro de SQLite:** texto (FTS5, ya está), similitud por significado (embeddings de un
   modelo local guardados como bloques binarios y comparados en el propio servidor: para miles de memorias basta, sin
   extensiones nativas ni servicios aparte), vecinos en el grafo (lo enlazado a lo que se está tratando) y lo reciente.
   Con un presupuesto de tokens por papel.
5. **Consolidación en reposo:** la revisora del correo es justo eso para la memoria procedimental (reglas y
   ejemplos). Se generaliza: trabajos nocturnos que proponen fusionar memorias repetidas, marcar las contradichas o
   subir al núcleo lo que se usa mucho. Siempre como propuesta.
6. **No depender de Mem0 ni de Zep:** son servicios aparte (Python, Neo4j u otros) que no conocen nuestras etiquetas de
   procedencia ni "Lo que ve la IA", y su gracia es la que el almacén ya tiene. Se toman sus ideas, no su código.
7. **Medir:** una evaluación con decisiones reales de Juan (como `eval/mail.ts` y la medida de la revisora) antes de
   cada cambio de cómo se recupera.

Fuentes (consultadas el 2026-10-21): Zep, "A Temporal Knowledge Graph Architecture for Agent Memory"
(arXiv 2501.13956); "Anatomy of Agentic Memory" (arXiv 2602.19320); Letta, "Memory blocks" y sleep-time compute
(letta.com/blog/memory-blocks); "Graph-based Agent Memory: Taxonomy, Techniques, and Applications" (arXiv 2602.05665);
Google, "Introducing A2UI" (developers.googleblog.com); Airbyte, "Low-code connector development" (docs.airbyte.com).

## 6. El Lienzo: la capacidad de pintar

Juan: Boni tiene la capacidad general de crear componentes interactivos (gráficas, paneles, botones, acciones) de forma
segura, y las extensiones la usan; también para widgets en el escritorio que cambian según el día. Es una pieza del
núcleo, el **Lienzo**, con tres partes:

**1. Catálogo de componentes (primitivas, código).** Los de la guía de diseño y solo ellos: texto, cifra, lista,
tabla, gráfica, calendario, tarjeta, sección, grupo plegable con resumen, fila de ajuste, interruptor, desplegable, área
de texto, botón, formulario, selector de entidad (buscar + crear)… Cada uno con sus reglas (lo común primero, el texto
cabe, accesible) y sus pruebas. Más los compuestos que se definan como datos (3.1).

**2. Especificaciones (datos).** Un árbol de componentes del catálogo en JSON, como el protocolo A2UI que publicó Google
(diciembre de 2025): el agente o una extensión describe qué pintar y la app lo pinta con sus propios componentes, sin
recibir nunca código. Tres reglas del código:
- **Los datos se enlazan, no se escriben:** una cifra o una lista se declara como una consulta (`$query`: el lenguaje de
  vistas, sección 8 de `nucleo.md`) que calcula el código. Un modelo no puede inventarse un número en un widget.
- **Las acciones son referencias:** un botón dice qué herramienta o plan guardado lanza; al pulsarlo pasa por la
  política como cualquier llamada (confirmar, proponer, Deshacer).
- **Lo de fuera, como texto** (7.14): nunca HTML ni enlaces activos.

**3. Superficies: dónde se pinta.** La misma especificación puede ir a cualquiera:

| Superficie | Ejemplo |
|---|---|
| Página de la app | Una página tipo Notion con una vista y unos botones |
| Panel de la derecha | Las peticiones de Boni (la idea de Juan) |
| Tarjeta de petición | Sí/no, elegir entre opciones, "¿es esta persona o la creo?", selección múltiple, escribir, aceptar un cambio con su ensayo y su medida |
| Respuesta de la conversación | Una tabla o una gráfica que contesta a una pregunta |
| Ajustes de una extensión | Los del correo, sacados de su manifiesto |
| **Widget en el escritorio** | Una ventana de Electron sin marco (como los widgets de gráficas de hoy) |
| Aviso | Una notificación con dos botones |

**Superficies dinámicas:** una superficie puede estar enlazada a un **flujo** que vuelve a decidir qué pintar cuando
toca: cada mañana, al cambiar las tareas, al llegar un correo. Ejemplo: el widget "Hoy" del escritorio. A las 7:00 un
flujo con el papel `builder` elige, entre las piezas del catálogo, qué enseñar ese día ("tres tareas que vencen, la
primera reunión, el gasto de la semana"); los datos los calcula el código con sus consultas, y la ventana se actualiza
sola por el canal en vivo. Si lo que pinta solo **muestra**, se aplica sin preguntar. Si añade **acciones** que no
estaban, la primera vez es una petición que Juan acepta (como P16: lo que puede actuar no nace solo).

**Cada componente pintado lleva su referencia** (`data-boni-ref="ext:correo/settings/guide/rules"`): la ruta de la
especificación que lo pintó. Es lo que permite el asistente de la sección 8 sin capturas de pantalla.

**La extensión de correo** usa el Lienzo así: sus propuestas son tarjetas en el panel de la derecha, sus ajustes son
una especificación, y la sugerencia de la revisora es una tarjeta "aceptar un cambio con su medida".

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

**`decider` (medido el 2026-10-21, `packages/agent/eval/decide.ts`):** un modelo de decisiones como Jev (TypeSafe,
por OpenRouter, `/api/alpha/decisions`) no escribe: elige entre opciones cerradas con probabilidades y una confianza.
En 27 correos inventados en español (2 pasadas): colección 35/38 frente a 36/38 de Haiku 4.5, estable al invertir el
orden de las opciones, y **la confianza separa aciertos (0,87 de media) de fallos (0,34)**: con un umbral de 0,6 decide
solo 30 de 38, todos bien, y los 8 restantes (incluidos los 3 fallos) serían una pregunta a Juan. Como filtro "¿pide
algo?" ahorra poco (10 de 54 lecturas, sin perder ninguna petición). Unas 25 veces más barato que Haiku. Uso propuesto:
elegir la colección (y lo dudoso, al panel de peticiones), detectar duplicados; la extracción sigue en un `reader`.

Cada perfil dice proveedor, modelo, clase de privacidad (`local`, `external-api`) y coste. El router elige con dos reglas
del código: lo que "Lo que ve la IA" restringa por clase de privacidad, y el presupuesto de la extensión. Cambiar de
modelo un papel es un ajuste, y antes de usarlo se pasa su evaluación (`eval/*.ts`).

## 10. Qué cambia en el plan de PRs

Esto no es otro proyecto: es la forma de hacer los PR 16 a 21 sin duplicar código. Propuesta de orden (escritorio):

| # | PR | Recoge |
|---|---|---|
| A1 | **Extensiones:** tipo `extension`, registro y validador de manifiestos contra el catálogo, `needs` como capacidades; el correo pasa a ser la primera (preset), sin cambiar lo que hace; `mailPlan`, módulos y rutas salen de su manifiesto | — |
|  | **A1 hecho (2026-10-21):** `@boni/extensions` (manifiesto cerrado y su validación), el tipo de sistema `extension`, el correo como primer preset (sus módulos, rutas, cada cuánto aprende y su presupuesto salen del manifiesto; apagado no trae ni lee nada), módulos de lectura propios en el manifiesto (los ata el código como `$modules`), presupuesto diario por extensión (P13), Ajustes → Extensiones. Las fuentes y los flujos los sigue ejecutando el código del correo; el motor genérico de flujos llega con el PR 21 | |
| A2 | **Todo lo del usuario a su almacén:** ajustes, secretos (cifrados con su clave), estado de las fuentes, guía; `account_data` se queda para lo del servidor | — |
|  | **A2 hecho en parte (2026-10-21):** tabla `settings` en el almacén de cada usuario (fuera del registro de operaciones y de `readQuery`); los ajustes del correo (con la contraseña), su estado y la guía viven ahí, lo secreto sellado con la clave de datos del usuario, y lo que había en `system.db` se pasa solo la primera vez. Queda en `system.db`, por ahora, lo del calendario (preferencias de la cuenta y calendarios externos) y lo de la API v1 (gráficas, atajos), hasta que pasen a extensiones o se retire v1 (T6) | |
| A3 | **Memoria con ámbito y clase:** `instruction`, `rule`, `example`, `fact`, `decision`; la guía del correo migra; la revisora pasa a ser genérica | 7.13 |
| A4 | **El Lienzo:** catálogo de componentes con `data-boni-ref`, especificaciones con datos enlazados y acciones por referencia, superficies (página, panel de la derecha, tarjeta, ajustes, respuesta); los ajustes del correo salen de su manifiesto; las peticiones en el panel de la derecha | 16 (parte), 18-19 (base) |
|  | **A4a hecho (2026-10-21):** las páginas. Tipo de sistema `page` en el almacén del usuario (título, icono, página madre, posición y sus bloques), `PageSpec` cerrado en `@boni/views` (título, texto, gráfica, botón; `pageErrors`), `/api/pages` (cualquier dispositivo lee, uno personal cambia; borrar va a la papelera con «Deshacer»; las subpáginas suben; nunca una página bajo sí misma). En la web: la barra lateral es la conversación y el árbol de páginas, la ventana abre en la última página vista, sin páginas una bienvenida, «Editar página» para añadir, mover y quitar bloques; fuera el inicio fijo, «Tus gráficas», el botón fijo «Apuntar gasto» y la tecla N; los widgets pasan a Ajustes → Escritorio. Una cuenta que usó el primer Boni recibe una vez la página «Gastos» con lo de su inicio. Queda de A4: el panel de peticiones de la derecha con la elección de colección por `decider` (A4b), los componentes con `data-boni-ref` y más bloques |
| 16 | Lo que queda del 16: fuera "Apuntar gasto" y lo fijo de Juan, como extensiones o vistas. **Juan (2026-10-21):** la pantalla de inicio de hoy (las gráficas y el botón "Apuntar gasto") y la sección "Tus gráficas" de la barra lateral están fijas en el código y no deben salir de partida: el inicio y la barra lateral son las páginas que define el usuario; un panel con gráficas y un botón es una página suya más. Lo de Juan de hoy pasa, como datos, a una página "Gastos" (sus gráficas y su atajo), para no perderlo | 16 |
| A5 | **Autoconocimiento:** el mapa generado, `boni.describe`, `boni.docs.search`, y `extensions.propose` con ensayo en seco | — |
| 17 | Reglas de lo que ve la IA dentro de una colección | 17 |
| 18-19 | La app como Notion, con el catálogo de A4 | 18-19 |
| 20 | Papeles con perfiles (sección 9) | 20 |
| 21 | Automatizaciones = los `flows` de las extensiones, creados hablando | 21 |
| A6 | Widgets dinámicos en el escritorio (superficie Electron enlazada a un flujo) | — |
| A7 | Zona peligrosa (parámetros de los principios, con código de autenticación) y definiciones de conectores HTTP desde Boni | — |
| A8 | El asistente que ve la pantalla, voz y modo señalar (escritorio) | — |

## 11. Decisiones

1. **Nombre: "extensión".** Decidido (Juan, 2026-10-21).
2. **Frontera:** código = el repo de GitHub, por PR (Claude Code, revisado por Juan); datos = lo que vive en Boni, con
   su permiso. Boni da los bloques y construye con ellos. Decidido (Juan, 2026-10-21), con la zona peligrosa (2.1) y las
   definiciones de catálogo desde Boni (3.1) como matiz suyo.
3. **Orden:** A1-A4 antes de lo que queda del PR 16. Decidido (Juan, 2026-10-21).
4. **Memoria:** por ámbito y clase, y con la forma de 5.1 (grafo del propio almacén, dos tiempos, tres niveles,
   recuperación híbrida, consolidación). Decidido (Juan, 2026-10-21).
5. **El Lienzo** con sus superficies dinámicas (sección 6), la **zona peligrosa** (2.1) y las **definiciones de
   catálogo desde Boni** (3.1). Decidido (Juan, 2026-10-21).
6. **Índices de APIs** (p. ej. `public-apis`): como consulta del papel `builder` para descubrir APIs al definir
   conectores (A7); el conector se arma mejor desde el OpenAPI de cada API. Propuesto (2026-10-21).
