# Flujos: lo que Boni hace con los modelos, como datos que el usuario edita

Propuesta (2026-11-05), a raíz de la vuelta que pidió Juan a «Mis datos» y «Modelos» (tareas 59a y 59b): «todo lo que
pueda hacer la IA debería ser hecho, eliminado, replicado o modificado por el usuario; estas vistas de diagrama
deberían permitirle hacer modificaciones del pipeline de los modelos, y lo mismo para la vista de datos»; y, elegida
entre tres profundidades, «un motor de flujo libre como n8n: mira código, guías y cómo hacerlo bien para integrarlo
en nuestro sistema siguiendo buenas prácticas de UX».

Amplía `docs/nucleo.md` §7 (el lenguaje de planes, el motor de políticas, el programador, las mini-apps) y
`docs/extensiones.md` §11 (las funciones en la caja y los `flows` del manifiesto). Ninguna regla de
`docs/principios.md` cambia: el modelo sigue planeando y el código sigue decidiendo (A-01); lo que cambia es quién
más escribe planes: el usuario, con un lienzo.

## 0. Resumen

- **Un flujo es un plan con disparador**, guardado como datos en la cuenta: «cuando llega un correo, léelo, elige la
  colección, rellena los campos y propón». El plan es el mismo lenguaje que hoy escribe el planificador (§7.2 de
  `nucleo.md`): pasos planos (`call`, `read`, `ask`, `reply`), referencias entre pasos, funciones puras cerradas,
  `when`, `each`. Lo ejecuta el mismo intérprete, bajo las mismas políticas (P1–P18), con el mismo diario.
- **El lienzo edita planes.** Cada paso es un nodo; cada referencia (`$r.tasks`) es una flecha; los argumentos de un
  nodo se editan en su panel a partir del esquema de la herramienta o del lector, con un selector de lo que llega de
  los nodos anteriores. Guardar es una versión; «Probar» ejecuta en seco con un ejemplo y enseña la salida de cada
  nodo sobre el lienzo; una ejecución del Registro se ve sobre el mismo lienzo (el Recorrido, tarea 52).
- **La lectura del correo es el primer flujo**: el plan que hoy construye `apps/server/src/mail.ts` (`mailPlan`)
  pasa a ser un flujo de serie, guardado y versionado, que Juan puede cambiar o duplicar, y volver al de Boni.
- **Quién escribe flujos:** el usuario, desde un dispositivo personal. Un modelo (el planificador en un turno, una IA
  de fuera por el MCP) solo los **propone**, como propone extensiones: una tarjeta con el cambio dibujado, y Juan
  activa. Nada que venga de contenido externo crea ni cambia un flujo (P16).
- **«Mis datos» lo refleja:** cada colección dice qué flujos y qué modelos la leen o la escriben, sacado de los
  pasos de los flujos guardados y de la auditoría, con filtros; el diagrama es una vista más de cualquier colección.
- **Principio nuevo (D-41):** lo que la IA puede hacer, el usuario lo puede hacer, deshacer, repetir y cambiar desde
  la misma pantalla; lo que el usuario cambia, la IA solo lo propone.

## 1. Lo que pidió Juan (2026-11-04 y 05)

1. «Una vista de diagramas a nivel general, sobre ver qué hace exactamente todos los modelos y cómo interaccionan
   entre sí» (hecha como «Modelos», 59b: el flujo declarado en código, con los números del diario).
2. «El diagrama de colecciones, no me gusta lo de lo que ve la IA y lo que no; creo que debería haber filtros; es
   más, creo que debería ser una vista más de la colección, incluso que dentro de las vistas de cualquier colección
   se pueda ver como diagrama (de esa colección y sus hijas)… que se pueda filtrar por qué modelos ven».
3. «Por diseño de la aplicación, todo lo que pueda hacer la IA debería ser hecho/eliminado/replicado/modificado por
   el usuario. Estas vistas de diagrama deberían permitirle al usuario hacer modificaciones del pipeline de los
   modelos, lo mismo para la vista de datos».
4. Elegida la profundidad: «un motor de flujo libre como n8n… integrarlo en nuestro sistema siguiendo buenas
   prácticas de UX». Y sobre la vista de colección: «si tengo mucha libertad para lo que pueden hacer los modelos,
   tiene sentido que se vea reflejado en la vista de colección; decide tú».

## 2. Cómo lo hacen otros (código leído el 2026-11-05)

- **n8n** (`packages/workflow`, `packages/core/src/execution-engine`, el editor en
  `packages/frontend/editor-ui/src/features/workflows/canvas` y `features/ndv`). Un workflow es JSON: `nodes`
  (id, nombre, tipo, versión del tipo, posición, `parameters`, `disabled`, `notes`) y `connections` (de qué salida
  de qué nodo a qué entrada de cuál). Cada tipo de nodo declara su descripción: entradas, salidas y `properties`,
  que son el esquema del formulario de ajustes (nombre, tipo de control, valor por defecto, cuándo se muestra); el
  editor pinta el panel del nodo desde ahí, sin código por nodo. Los valores pueden ser expresiones
  (`{{ $json.x }}`, `$('Nodo').item`) evaluadas en una caja. El motor (`WorkflowExecute`) recorre el grafo desde el
  disparador con una pila, guarda `runData` por nodo (cada ejecución del nodo con sus elementos), permite ejecutar
  parcialmente («Test step», desde un nodo, con datos fijados, `partial-execution-utils`) y enseña cada ejecución
  sobre el mismo lienzo (estado por nodo, cuántos elementos por conexión). El panel del nodo (NDV) tiene tres
  columnas: lo que entra, los ajustes, lo que sale. Lo que tomamos: **el flujo es datos y el lienzo lo pinta**; los
  ajustes de un nodo salen de su esquema; ejecutar en seco con un ejemplo y ver la salida de cada nodo; cada versión
  guardada; la ejecución sobre el lienzo. Lo que no: expresiones en JavaScript (nuestras funciones son una lista
  cerrada que propaga etiquetas), nodos con código libre (lo nuestro va en la caja de las extensiones), y un nodo
  por servicio de fuera (Boni no es un integrador).
- **Dify** (`web/app/components/workflow`, React Flow como el nuestro; `api/core/workflow/nodes`). Un catálogo de
  nodos pensado para aplicaciones con modelos: `llm`, `question-classifier`, `parameter-extractor`,
  `knowledge-retrieval`, `code`, `if-else`, `iteration`, `variable-aggregator`, `human-input`, `answer`, `end`.
  Es casi uno a uno con lo nuestro: el clasificador es la Decisora, el extractor de parámetros es `fill`, los
  lectores son `llm` con un esquema, `human-input` es `ask`, `answer` es `reply`. Cada nodo tiene su panel a la
  derecha (modelo, instrucción, variables), un selector de variables de los nodos anteriores con su tipo, una «lista
  de comprobación» que impide publicar un flujo roto, y «Ejecutar» con un panel de depuración que enseña cada nodo.
  Lo que tomamos: el catálogo de nodos por lo que hacen, no por servicio; el selector de variables tipado; la lista
  de comprobación; el panel de depuración. Lo que no: la rama paralela y el bucle libre (nuestro `each` tiene tope).
- **Node-RED y Windmill** (solo su documentación): el primero enseña a «desplegar» una versión y a mantener la
  anterior; el segundo, flujos de pasos con scripts en una caja y aprobaciones de un humano como paso. Coinciden
  con lo que ya decidimos en `extensiones.md` §11.

## 3. Lo que ya tenemos (T-05: lo que existe, primero)

- **El lenguaje de planes** (`packages/agent/src/plan.ts`; `nucleo.md` §7.2): `Plan { version: 1, steps }`, con
  `Step = { id, when?, each?, zip? } & (call | read | ask | reply)`, expresiones `lit | quote | ref | fn`, 40 pasos
  y 50 iteraciones como mucho, validado contra el registro de herramientas (`validatePlan`). Es plano a propósito:
  se audita bien y cabe en salidas estructuradas.
- **El intérprete** (`packages/agent/src/agent.ts`, `advance`): ejecuta paso a paso, evalúa `when` y `each`
  (P15: lo que decide una iteración es control), guarda cada paso y cada llamada a modelo en el diario, y **vincula
  valores por código** (`preset`: el id del correo, la guía, las opciones), que es como un flujo recibe lo que lo
  dispara.
- **Las políticas** (`nucleo.md` §7.5, P1–P18): una función pura por llamada, con el origen de la ejecución (turno
  de Juan, segundo plano, mini-app), las etiquetas de cada argumento y el plan entero. No cambian.
- **El diario y el Recorrido** (tarea 52, `packages/agent/src/trace.ts`): ejecuciones, pasos, llamadas, propuestas
  y decisiones; las dependencias entre pasos salen de las referencias. Es lo que un lienzo necesita para enseñar una
  ejecución encima.
- **La lectura del correo como plan** (`apps/server/src/mail.ts`, `mailPlan`): `entities.get` del correo →
  `read_message` con los módulos y la guía → `classify` (si hay varias colecciones) → por cada elemento, `fill` y
  `entities.create` con `zip`; lo que el código decide antes (las relaciones por el remitente, D-38; la invitación
  de un `.ics`) entra como valores vinculados (`$prefill`, `$inv`). Ya es un flujo; solo que está escrito en código.
- **Las extensiones** (`docs/extensiones.md`; `apps/server/src/extensions.ts`): un manifiesto con `flows`
  (`{ on: { created: "correo" }, plan: "read-and-propose" }`), `routes`, módulos de lectura, y (§11) funciones puras
  en una caja sin red ni disco, con sus pruebas; propuestas por un modelo (`extensions_propose`), probadas
  (`extensions_test`), activadas solo por Juan desde un dispositivo personal; cada versión guardada y reversible. La
  lectura del correo está instalada como preset de ese sistema.
- **El programador y las mini-apps** (`nucleo.md` §7.12 y §7.13; sin código todavía): trabajos declarativos (un plan
  plantilla más un horario), creados desde un turno con confirmación (P8), ejecutados como segundo plano (P7);
  mini-apps y atajos como especificaciones, nunca desde contenido externo (P16).
- **«Modelos»** (59b): el flujo declarado en `packages/agent/src/pipeline.ts`, con la prueba que obliga a que cada
  lector, papel, herramienta, clase de ejecución y área de decisión tenga su nodo (A-16), dibujado con React Flow y
  dagre de arriba abajo con los números del diario, y lo que configura los modelos debajo.
- **«Mis datos»** (59a): las colecciones como diagrama (tarjetas, marcos de madres, flechas por relación), calculado
  del esquema (D-40).

## 4. La estructura

### 4.1 Un flujo es un plan con disparador

```ts
interface Flow {
  id: string;            // "leer-correo"
  name: string;          // «Leer correo»
  on: Trigger;           // { created: "correo" } | { schedule: "0 8 * * *" } | { manual: true } | { request: true }
  inputs: FlowInput[];   // lo que el disparador vincula: { id: "m", what: "record" }, { id: "guide", what: "guide" }…
  plan: Plan;            // el lenguaje de planes de hoy, tal cual
  layout?: Record<string, { x: number; y: number }>;  // dónde dejó cada nodo el usuario (solo presentación)
  by: "preset" | "user" | { extension: string };
  version: number;       // cada guardado es una versión; las anteriores se conservan
  enabled: boolean;
}
```

- Se guarda en el almacén de la cuenta (D-02), en una colección de sistema «Flujos» de solo lectura para los modelos
  (como «Ejecuciones»): se ve en «Mis datos», se cuenta en páginas, y ningún plan del planificador la escribe.
- **Las entradas** son lo que hoy hace `preset`: el disparador «correo nuevo» vincula `$m` (el registro), `$guide`,
  `$options`, `$modules`, `$adjuntos`, `$inv` y `$prefill_*`; «cada día a las 8» vincula `$today`; «a mano» lo que
  el usuario escriba en un formulario pequeño (el catálogo de `ask`). El lienzo enseña las entradas como el primer
  nodo, el disparador, con lo que trae y su forma (tipo y campos), como Dify enseña el nodo `start`.
- **Las entradas por colección** van por la clave de la colección (`$fill.tarea`, `$prefill.tarea`), no por su
  posición: así el plan de «Leer correo» es el mismo para todos los correos de una configuración (la regla de la
  guía «directo a una colección» es una entrada, `$only`, no otro plan), y cambiar la colección de un paso en el
  editor cambia también esas referencias. Un registro se hace con `merge` (las relaciones del código, lo que rellenó
  el lector, lo del propio elemento; gana lo último que tenga valor), así que el plan no nombra los campos que el
  lector rellena.
- **El plan no cambia de lenguaje.** Lo que el planificador sabe escribir, el usuario lo puede dibujar, y al revés
  (D-41). Un flujo guardado valida con `validatePlan` contra el registro completo; uno inválido se guarda como
  borrador, nunca encendido.

### 4.2 El catálogo de nodos

Es lo que el intérprete sabe ejecutar, y nada más (falla en cerrado, como el registro de herramientas):

| Nodo | Paso del plan | Ajustes (del esquema) | Ejemplo |
|---|---|---|---|
| Disparador | las entradas | qué dispara y qué trae | «Correo nuevo» → `$m` |
| Lector («Lectora», «Rellenadora», «Resumir»…) | `read` | el lector, su entrada (expresión), sus parámetros | `read_message` con la guía |
| Decisora | `read classify` (Jev o lector) | la pregunta, las opciones (expresión), preguntar si duda | la colección |
| Herramienta (`entities.create`, `entities.query`, `notify`…) | `call` | los argumentos por su papel (`type`, `values`, `query`…) | crear la tarea |
| Función de extensión | `call` a `extensions.run` (§11 de `extensiones.md`) | la función, su entrada | `importar(extractos)` |
| Pregunta | `ask` | el control del catálogo, el texto, las opciones | «¿A qué colección va?» |
| Respuesta | `reply` | el componente del catálogo, sus datos | una cifra, una tabla |

Y en cada nodo, como ajustes y no como nodos aparte: **«Solo si»** (`when`), **«Para cada»** (`each`, con `zip`),
y el porqué que ve la tarjeta (`why`). Las expresiones se editan con un selector de lo que llega de los nodos
anteriores (`$m.asunto`, `$r.tasks`, `$item.title`), tipado desde la forma de cada salida (el esquema del lector o
de la herramienta), y las funciones puras como una lista corta (`concat`, `first`, `list`, `obj`, `eq`, `or`…), con
sus argumentos a su vez con el selector. Nunca texto libre que se evalúe.

### 4.3 Disparadores

| Disparador | Origen de la ejecución | Políticas | Primero |
|---|---|---|---|
| `created: <colección>` (llega un correo, se sube un extracto) | segundo plano | P7: leer y proponer; P13: límites por día | F1 |
| `manual` («Ejecutar» en el lienzo, un botón en una página) | turno de Juan, dispositivo personal | P1: escrituras reversibles con Deshacer; P5: confirmar lo irreversible | F2 |
| `schedule` (cron; `nucleo.md` §7.12) | segundo plano | P7, P8 (lo crea Juan, confirmado) | F4 |
| `request` (el planificador lo llama en un turno: «ejecuta mi flujo de cierre») | el del turno | el flujo es una herramienta `flows.run` con clase de efecto la peor de sus pasos; confirm | F4 |

Un flujo nunca se dispara a sí mismo ni crea trabajos (regla dura de §7.12), y una ejecución tiene los límites de
P12 (pasos, llamadas, coste).

### 4.4 Cómo se ejecuta y se registra

- El mismo intérprete, con `newState(flujo.plan)` y las entradas vinculadas por `preset`; el origen dice el
  disparador y la confianza. Cada ejecución guarda en el diario el flujo y su versión (`runs.flow`, `runs.flowVersion`),
  así el Registro dice «Leer correo v3» y el Recorrido se pinta sobre el lienzo de esa versión.
- **Las etiquetas no cambian:** lo que sale de un lector sigue siendo `external`, así que una escritura con ello es
  una propuesta (P4) aunque el flujo lo haya dibujado Juan; «Solo» (docs/fiabilidad.md) sigue decidiendo cuándo Boni
  acepta sola. Un nodo que lea una colección opaca o privada falla por política (R1, R3) y el editor lo avisa antes.
- **«Probar»** (n8n «Test step», Dify «Run»): ejecuta el flujo con un ejemplo (un correo que el usuario elija, o el
  último) en seco: los lectores y la decisora se llaman de verdad (cuesta lo que cuesta una lectura), las
  escrituras se enseñan como «haría esto» y no se guardan, como `extensions_run` en seco. Cada nodo enseña su salida.
- **Las llamadas cuentan igual** en «Modelos» y en el gasto; la prueba de A-16 pasa a comprobar que todo nodo que un
  flujo pueda usar tiene sitio en el lienzo general (lo declarado en `pipeline.ts` se deriva de los flujos
  guardados, no al revés).

### 4.5 El editor (UX; fuentes: n8n, Dify, docs/design-guide.md, Apple HIG y Material para los paneles)

- **Una sección «Flujos»** en la barra lateral (en lugar de «Modelos», que pasa a ser una vista dentro: lo que
  configura los modelos y el lienzo general con los números). La lista: cada flujo con su nombre, su disparador,
  encendido o apagado, cuántas ejecuciones y la última. «Nuevo flujo» y «Duplicar».
- **El lienzo de un flujo:** React Flow y dagre, de arriba abajo (como en 59b: diez pasos caben en una ventana), el
  disparador arriba; un nodo es una tarjeta con su icono, su nombre en una o dos palabras, lo esencial de sus ajustes
  («Lectora · con la guía», «Crear en Tarea») y, con una ejecución encima, su salida («3 elementos», «propuesta»).
  Una flecha por referencia. «+» en una flecha o al final añade un nodo del catálogo (buscador, grupos por lo que
  hacen: Leer, Decidir, Datos, Preguntar, Responder, Funciones). Arrastrar mueve; las posiciones se guardan en
  `layout`; «Ordenar» vuelve a colocar.
- **El panel del nodo** (a la derecha, como Dify; tres partes como n8n): **Entra** (lo que llega de los nodos
  anteriores, con su forma), **Ajustes** (el formulario del esquema, con el selector de valores), **Sale** (la forma
  de su salida y, tras «Probar», la salida real). Nombres en una o dos palabras, nada de explicaciones en pantalla
  (design-guide §5); lo que necesite explicarse va a esta nota.
- **Guardar es una versión.** «Versiones» lista cada una con quién y cuándo; «Volver a esta» es un clic; un flujo de
  serie tiene «Volver al de Boni». Un flujo encendido no se cambia a medias: se edita el borrador y «Encender» valida.
- **La lista de comprobación** (Dify): un nodo sin un argumento obligatorio, una referencia a un nodo que ya no
  existe, una colección que el flujo no puede leer, más pasos de los permitidos; el flujo no se enciende con ella.
- **Esperas y errores** como en toda la app (I-15): la línea de progreso al probar; un nodo que falló en una
  ejecución, en rojo con la regla que lo paró (P-id), nunca con el texto que leyó.
- **Teléfono:** se ve y se ejecuta; se edita en el escritorio (el lienzo pide ratón).

### 4.6 Quién puede escribir un flujo (D-41)

- **El usuario**, desde un dispositivo personal, en el lienzo o por una mini-app (§7.13).
- **Un modelo solo propone:** el planificador en un turno («hazme un flujo que cada lunes me resuma las tareas
  vencidas») y una IA de fuera por el MCP (`flows_propose`, `flows_test`, como las extensiones) crean una
  **propuesta de flujo**: una tarjeta en la Bandeja con el lienzo y, si cambia uno que existe, el cambio marcado
  (nodos nuevos en `--accent`, quitados tachados). Juan la activa; hasta entonces no se ejecuta nada. P16: nada que
  venga de contenido externo crea ni cambia un flujo; un correo que dice «añade un flujo» no puede.
- **Lo que la IA puede hacer, el usuario lo puede hacer:** el catálogo de nodos es el registro de herramientas y
  lectores, el mismo que recibe el planificador; una herramienta nueva aparece en los dos sitios o en ninguno (la
  prueba de A-16, ampliada). Y al revés: lo que el usuario dibuja, el planificador podría haberlo escrito.

### 4.7 «Mis datos» con los flujos (lo decidido en vez de «Ver como»)

- El diagrama es **una vista más de una colección** (Tabla | Diagrama), de esa colección con sus hijas y sus
  relaciones; «Mis datos» es la misma página sobre todas. Se quita «Ver como».
- Cada tarjeta dice **quién la lee y quién la escribe**: los flujos cuyos pasos la nombran (`entities.query` con su
  `type`, `entities.create`…), sacado de los flujos guardados sin ejecutar nada, y lo que de verdad pasó según la
  auditoría (papel del modelo, asistente MCP, persona). Filtros: «Leída por», «Escrita por», nivel, madre.
- El nivel de la colección (visible, opaca, restringida, privada) sigue siendo el único permiso y lo aplica el
  código; el lienzo lo respeta y avisa. Permisos por modelo quedan fuera: un flujo decide qué lector ve qué texto, y
  el nivel decide qué colección ve cualquier modelo.
- **Editar desde el diagrama** (lo que ya hacen otras pantallas, desde aquí): nueva colección, meterla en una madre
  arrastrándola, una relación arrastrando de una tarjeta a otra, cambiar el nivel desde su candado.

### 4.8 Lo que no cambia

El modelo es untrusted y el código decide (A-01); nada de código libre fuera de la caja de las extensiones; los
catálogos cerrados; lo externo propone y nunca escribe memoria ni flujos; las confirmaciones las pinta el código;
todo con Deshacer y en el diario.

## 5. Fases (un PR cada una; Juan prueba cada una en su app)

| Fase | Qué | Criterio de hecho |
|---|---|---|
| F1 Flujos como datos (hecha el 2026-11-05, tarea 61) | La colección de sistema «Flujos»; el flujo de serie «Leer correo» guardado y versionado, que `mail.ts` ejecuta en vez de construir el plan (las entradas vinculadas como hoy); el diario con flujo y versión; «Modelos» pasa a «Flujos»: la lista y el lienzo de cada flujo, de solo lectura; el lienzo general con los números se calcula de los flujos | El correo se lee igual que hoy (las pruebas de `mail.test.ts` sin cambios), y en «Flujos» se ve «Leer correo» con sus nodos y sus números |
| F2 El editor (hecha el 2026-11-05) | Añadir, quitar y conectar nodos; el panel del nodo desde los esquemas; el selector de valores; la lista de comprobación; guardar como versión, encender y apagar, volver a una versión; «Nuevo flujo» y «Duplicar»; «Ejecutar» a mano | Juan cambia la colección a la que van las tareas del correo desde el lienzo y vuelve al de Boni con un clic |
| F3 Probar y ver (hecha el 2026-11-05) | «Probar» en seco con un ejemplo; la salida de cada nodo sobre el lienzo; el Recorrido de una ejecución sobre el lienzo de su versión (59c) | Una lectura del Registro se abre sobre el lienzo con lo que salió en cada paso |
| F4 Disparadores | Cron y «a mano» con formulario; un flujo como herramienta del planificador (`flows.run`, confirmado) | Un resumen diario a las 8 que Juan dibuja sin tocar código |
| F5 Propuestas de la IA | `flows_propose` por MCP y desde un turno; la tarjeta con el cambio dibujado; activación solo de Juan | Pedir un flujo en la conversación lo deja en la Bandeja dibujado, y activarlo lo enciende |
| F6 «Mis datos» | La vista Diagrama en cualquier colección; quién lee y escribe, con filtros; editar desde el diagrama | En Agenda, el diagrama enseña Tarea y Evento con quién las escribe, y una relación nueva se dibuja arrastrando |

Lo que ya existe se mueve, no se duplica: `pipeline.ts` deja de declararse a mano cuando los flujos existan (F1);
`mailPlan` deja de ser código cuando el flujo de serie lo sustituya (F1); «Modelos» se queda dentro de «Flujos».

## 6. Decisiones de Juan

1. **La lectura del correo como primer flujo editable** (F1): sí, con «Volver al de Boni» y versiones; o dejar la
   lectura en código y empezar los flujos por los nuevos. Recomendado: sí; si no, el lienzo enseña algo que no se
   puede tocar, que es lo que no quería.
2. **«Modelos» pasa a llamarse «Flujos»** (la lista de flujos, cada lienzo, y dentro lo de los modelos): recomendado;
   o dos secciones, «Flujos» y «Modelos».
3. **Nodos de código solo como funciones de extensión en la caja** (lo decidido en `extensiones.md` §11), nunca
   JavaScript libre en un nodo: recomendado.
4. **El planificador puede ejecutar flujos del usuario** (F4, con confirmación): recomendado.
5. **Empezar por F1 ahora.**
