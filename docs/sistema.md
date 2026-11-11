# Boni como un sistema de flujos: todo lo que hace, a la vista; las mismas acciones para todos; Boni sobre la pantalla

**Decidido por Juan el 2026-11-05: «Las recomendadas»** (las nueve de §10), con un cambio: el atajo de Boni sobre la
pantalla es `Ctrl+E`, no `Ctrl+J` (§4.7). Las fases F7 a F13 son las tareas 83 a 89 (§8): la primera parte de F7 está
en main desde el 2026-11-05 y F8 (el mapa) en main y hecha desde el 2026-11-06, con lo que Juan vio al probarla (la
90; §4.4, «Cómo quedó»).

Propuesta (2026-11-05). Juan: «Creo que la aplicación de Boni ha crecido bastante y de una forma poco
planificada, sobre todo por mi parte… Hasta ahora hemos metido la vista de flujos y modelos de la aplicación pero no
me convence». Y durante la revisión: «también quiero que pienses si tiene sentido hablar de extensiones como tal, ya
que más bien son modificaciones del flujo de Boni, no están completamente aisladas».

Amplía `docs/flujos.md` (F1–F6, en main), `docs/extensiones.md` (§3 la extensión, §6 el Lienzo, §8 el asistente que ve
la pantalla, §11 las funciones), `docs/conversacion.md` (C3–C7) y `docs/nucleo.md` §7.5 y §7.9 (el registro de
herramientas). Ninguna regla de seguridad cambia: el modelo planea y el código decide (A-01). Lo que cambia es cuánto
de Boni se ve, quién puede hacer cada cosa y desde dónde.

## 0. Resumen

- **Una lista de acciones para todos.** Hoy la app cambia cosas por 76 rutas de su API y la IA tiene 14 herramientas
  (`packages/agent/src/tools.ts`): no puede crear una página, poner un bloque, cambiar una vista ni abrir nada en la
  pantalla. Cada cosa que se puede hacer en Boni pasa a ser una **acción** con su nombre, sus argumentos, su clase de
  efecto y su Deshacer, y la llaman igual un botón de la app, un paso de un flujo, el planificador y el MCP. «Lo que
  hace la IA lo puede hacer el usuario, y al revés» lo comprueba el CI. Lo que solo decide Juan (aceptar, encender,
  abrir lo cerrado a la IA, la zona peligrosa) la IA lo prepara y Juan lo confirma con un toque, o lo hace él en su
  sitio.
- **Todo lo que Boni hace solo es un flujo, y se ve.** Traer el correo, leerlo, revisar la guía, aprender de las
  decisiones, la conversación y los avisos son flujos de Boni con sus pasos. Lo que tiene que seguir siendo código
  (leer un buzón IMAP, abrir un `.ics`, plegar un hilo) es un paso más, una **pieza de Boni** con sus ajustes a la
  vista, como un nodo de n8n: se ve, se configura, se quita o se cambia de sitio, y su interior no se edita. Pasa a
  ser dato lo que hoy está escondido entre las piezas: el orden, las condiciones y a dónde va cada resultado.
- **Un mapa en lugar de «Flujos» y «Modelos».** Boni entero es un grafo: conectores que traen datos a colecciones,
  disparadores que ponen en marcha flujos, pasos que leen y escriben colecciones, modelos que hacen pasos, bloques y
  botones de páginas que leen o lanzan cosas. El mapa se calcula de lo guardado y de la auditoría (nunca se dibuja a
  mano) y se abre desde una pregunta: «¿qué pasa cuando llega un correo?», «¿qué hace este botón?», «¿qué crea
  eventos?», «¿de dónde salió esta tarea?». El clic derecho en cualquier cosa de la app da «Ver en el mapa», y una
  ejecución se ve encima con lo que salió de cada paso.
- **Las extensiones dejan de ser un sistema aparte.** Cada pieza vive en su sitio: el conector con los conectores, la
  colección en «Mis datos», los flujos en el mapa, las funciones como pasos y su chat como un flujo con disparador
  «Chat». Queda el **paquete**: lo que llegó junto y se propone, se enciende, se versiona y se quita junto. En el mapa
  es un grupo («Correo», «Conciliación»).
- **Páginas conectadas.** Una página tiene **valores** (Categoría, Mes) que ponen sus controles; los bloques los usan
  en sus filtros, un enlace los pasa a otra página y el chat de la página los cambia. «¿Cuánto gasté en restaurantes
  en octubre?» pone los dos valores, las gráficas cambian y la cifra la calcula el código.
- **Boni sobre la pantalla.** Un círculo abajo a la derecha y `Ctrl+E` abren la conversación en una ventana sobre lo
  que esté abierto. Boni ve lo que ve Juan como datos (la página, los bloques, las tarjetas de la Bandeja, las filas,
  con sus valores), no como píxeles; hace lo que haría Juan con las mismas acciones de los botones, resaltando lo que
  toca; `Ctrl+Shift+E` es «Señalar»: lo que Juan marca entra en la conversación como «esto». Lo cerrado a la IA no
  llega, y lo de fuera llega como asas.
- **Primero, depurar** (Juan: «esto me va a venir sobre todo bien ahora para debuggear el sistema»). El orden
  propuesto: lo de Boni a la vista (F7) y el mapa (F8); Boni sobre la pantalla (F9), con las herramientas de hoy; la
  lista de acciones por áreas (F10), que Boni sobre la pantalla gana según llegan; y después páginas conectadas (F11),
  disparadores por colección (F12) y paquetes (F13).

## 1. Lo que pidió Juan (2026-11-05)

1. Ver exactamente lo que hace la IA, con flujos al estilo de n8n, «incluso los flujos que son propios de Boni, no de
   modificaciones dinámicas a posteriori».
2. Seguir con «todo lo que puede hacer la IA lo puede hacer el usuario», aunque más tarde se cierre lo que se puede
   cambiar de un flujo «para evitar errores humanos y hacer la aplicación de Boni más robusta»; y al revés: lo que
   hace el usuario, la IA.
3. Las extensiones: hasta qué punto la del correo se integra con el resto de flujos, si tiene sentido aislarlas y si
   tiene sentido hablar de extensiones.
4. «Al final Boni es un conjunto de flujos en el que prácticamente todos se relacionan entre sí de alguna forma, o
   modificando colecciones, o por conectores, o agentes que hablan entre sí».
5. No dividir «Flujos» y «Modelos»: entrar por lo que se quiere ver. Agrupar y filtrar por disparadores; ver qué pasa
   con unos conectores; desde el clic derecho en un botón, el diagrama del flujo que lo usa; poner en el centro una
   acción («qué acciones crean en el calendario eventos») y ver cómo se conecta; ver los flujos que nacen de una
   entrada de datos. «Piensa bien la taxonomía de todo esto porque a lo mejor estoy mezclando conceptos».
6. Páginas como paneles: un formulario que controla los filtros de una gráfica por ids (en la misma página o en otra),
   su diagrama con el clic derecho, y un chat dentro de la página con su meta-prompt que, al preguntarle «cuánto he
   gastado en tal categoría», actualice las gráficas.
7. Boni superpuesto, como el chat de Notion: un icono abajo a la derecha o una combinación de teclas; que pueda hacer
   todo lo que hace el usuario (pulsar botones, desplazar, crear, eliminar) salvo en lo que no tenga permiso; que vea
   lo mismo que el usuario (la pantalla principal con la Bandeja abierta, una página, la barra lateral); y otra
   combinación para un modo selector que marque una parte de la interfaz.
8. Pensar si se puede hacer bien y mantener estable que nada esté «hardcodeado» sino en un formato estructurado y
   modificable; mirar n8n; probarlo en la interfaz; refactorizar lo que haga falta; adaptar la cola.

## 2. Lo que hay hoy (T-05)

### 2.1 Lo que ya va en esta dirección

| Pieza | Dónde | Lo que ya da |
|---|---|---|
| Planes, intérprete y políticas | `nucleo.md` §7.2 y §7.5; `plan.ts`, `agent.ts`, `policy.ts` | Todo lo que hace un modelo es un plan que el código interpreta bajo P1–P19. Es la base de lo que sigue y no cambia |
| Flujos como datos | `flujos.md` F1–F6; `apps/server/src/flows.ts` | Plan con disparador, por versiones; editor; «Probar» en seco; horarios; la IA solo propone flujos; quién lee y escribe cada colección (D-41 a D-45) |
| «Leer correo» corre desde su flujo | `mail.ts` (`mailFlow`), D-42 | La lectura de cada correo ya es un plan guardado |
| El Recorrido | `trace.ts`, D-39, F3 | Una ejecución paso a paso; desde la 90, con palabras en el Registro y dibujada sobre el mapa |
| «Mis datos» como colección con «Diagrama» | F6b; D-04, D-40, D-45 | Una vista que se calcula del esquema y de la auditoría, nunca a mano |
| Extensiones con funciones en una caja | `extensiones.md` §11; E1–E3; A-08 a A-10 | Código de un modelo, aislado, que solo Juan activa |
| La conversación guardada y en vivo | `conversacion.md` C1 y C2 | Turnos con sus pasos, parar, Deshacer por turno |
| Diseñado y sin hacer | `extensiones.md` §6 y §8; `conversacion.md` C3–C5 y C7; la 63 (puntos 1, 2 y 12) | `data-boni-ref` en cada componente; el asistente que ve la pantalla con «modo señalar»; la ventana, el bloque «Chat» y el círculo; «Flujos» como colección; el lienzo general calculado; un botón que ejecuta un flujo |

### 2.2 Lo que no cuadra (leído en el código y probado en la app)

Probado el 2026-11-05 en un servidor local con la web de main y una cuenta inventada: Tarea y Evento dentro de Agenda,
«Leer correo» tal como lo guarda Boni con esas dos colecciones, y un «Resumen diario» a las 8.

1. **Hay dos dibujos de Boni y ninguno está entero.** «Flujos» enseña los flujos guardados; «Modelos» enseña
   `packages/agent/src/pipeline.ts`, declarado a mano (A-16 obliga a que no le falte un nodo, pero no sale de los
   flujos: la 63, punto 2).
2. **Lo que rodea a «Leer correo» no se ve.** El lienzo enseña 9 pasos (Leer, Lectora, Decisora y seis «Crear»).
   Fuera, en `mail.ts` (2.041 líneas), van: traer el correo cada 5 minutos; las reglas de la guía que saltan a un
   remitente o lo llevan a una colección; lo pendiente del remitente; la invitación `.ics`; las relaciones que
   encuentra el código; plegar el hilo (D-29); «Aceptar solas»; y después, la revisora (cada 20 decisiones) y los
   aprendices. Es justo lo que Juan necesita ver para depurar.
3. **El lienzo habla como el código.** El disparador enseña once nombres internos (`$mail`, `$userIn`, `$prefill`…,
   contra I-08). Los seis «Crear» son colecciones × módulos más la invitación («Crear Tarea» tres veces): lo que
   genera `mailPlan`, no un flujo pensado para leerse. Y al abrirlo, el lienzo sale tan alejado que no se lee (a 860 y
   a 1.440 px de ancho) hasta pulsar el botón de encajar.
4. **La IA puede mucho menos que la app.** La API tiene 76 rutas que cambian algo (33 del agente, 23 de datos, 8 del
   correo, 6 de calendarios, 4 de páginas y 2 de la cuenta); la IA, 14 herramientas. «Añadir paso» ofrece los
   lectores, la decisora, datos (consultar, leer, calcular, buscar, ver tipos, crear, cambiar, borrar, crear tipo,
   añadir campo y recordar), avisar, preguntar y responder: nada de páginas, vistas, botones ni otros flujos. D-41
   solo se comprueba para los pasos de un flujo.
5. **Nada en la pantalla dice qué es.** Ningún componente lleva `data-boni-ref`, y el botón de una página solo abre
   «Apuntar gasto», de la v1 (`packages/views/src/catalogue.ts`).
6. **Una extensión, cuatro sitios.** La del correo declara su flujo en su manifiesto (`flows: [{ on: { created:
   "correo" }, plan: "read-and-propose" }]`) y además es «Leer correo» en el diario; su buzón y su guía están en
   Ajustes → Correo, su estado en Ajustes → Extensiones y su colección en «Mis datos».
7. **Lo que configura a la IA está repartido** entre Ajustes (Modelos, Privacidad, Decisiones, Extensiones, Correo) y
   «Flujos → Modelos». Sin modelo, «Modelos» pinta `agent-off` en rojo y una frase que lo explica (I-08 y
   `design-guide.md` §5).

## 3. Las palabras

Lo que se cruza en lo que dice Juan es que unas palabras nombran **de dónde llega algo**, otras **qué lo pone en
marcha** y otras **qué se hace**. Ocho palabras, cada una para una cosa:

| Palabra | Qué es | Ejemplos | Hoy |
|---|---|---|---|
| **Conector** | Una conexión configurada con algo de fuera, que trae datos a una colección | Correo (un buzón), Calendarios de fuera, Bancos (la 4b), los asistentes por el MCP | `sources` de una extensión; Ajustes → Correo |
| **Colección** | Los datos; lo que los flujos comparten | Correos, Tarea, Movimientos | Igual |
| **Disparador** | Lo que pone en marcha un flujo | Llega un correo; cada día a las 8; pulsas un botón; escribes en un chat; una tarea se marca hecha | `on` de un flujo |
| **Flujo** | Un disparador y sus pasos | Leer correo, Resumen diario, Conversación | Igual |
| **Paso** | Una cosa que hace un flujo | Una acción, una lectora, la decisora, un agente, una pregunta, una respuesta, una función, una pieza de Boni | Nodo |
| **Acción** | Algo que se puede hacer en Boni, lo haga quien lo haga | Crear en una colección, mover, avisar, abrir una página, cambiar un valor de una página | 14 herramientas y 76 rutas |
| **Modelo** | Quién hace un paso que piensa | Haiku lee, Jev decide, Opus planea | Papeles (`models.ts`) |
| **Superficie** | Donde Juan ve y toca | Una página, un bloque, un botón, una tarjeta de la Bandeja, un chat, un aviso | Componentes de la web |

Y dos palabras que no son una cosa nueva:

- **Agente** es un flujo con un paso «Agente»: un modelo que escribe el plan al ejecutarse, con sus instrucciones y
  solo con las acciones que se le dan. Boni en la conversación es el flujo «Conversación»; el chat de una página es
  otro, con sus instrucciones y las acciones de esa página.
- **Extensión** es un paquete de las piezas de arriba (§4.5).

Las preguntas de Juan, con estas palabras:

| Pregunta | En el mapa |
|---|---|
| «¿Qué pasa cuando se activa este disparador?» | El disparador en el centro y lo que viene después |
| «¿Qué pasa con estos conectores?» | El conector en el centro: la colección que llena, los flujos que pone en marcha y lo que acaban escribiendo |
| «¿Qué hace este botón?» | Clic derecho en el botón → «Ver en el mapa»: el botón, su acción o su flujo y lo que cambia |
| «¿Qué acciones crean eventos en el calendario?» | Las colecciones con papel Calendario en el centro y, antes, quién escribe en ellas: flujos, la conversación, Juan desde sus apps, Claude por el MCP; cada uno con cuántas veces |
| «¿Qué flujos nacen de esta entrada de datos?» | Un conector o una colección en el centro y lo que viene después |
| (nueva) «¿De dónde salió esta tarea?» | Clic derecho en la fila → la ejecución que la hizo, sobre el mapa |

## 4. La estructura

### 4.1 Una lista de acciones para todos

Amplía el registro de herramientas (`nucleo.md` §7.5 y §7.9). Una **acción** declara lo que hoy declara una
herramienta (nombre, argumentos con su papel, clase de efecto, título) y además:

- **Quién la puede pedir:** Juan desde un dispositivo personal, el planificador en un turno de Juan, un flujo en
  segundo plano, un asistente por el MCP. La política sigue decidiendo cada llamada (P1–P19).
- **Cómo se deshace** y **cómo se confirma** (la tarjeta la pinta el código con los argumentos reales, como hoy).
- **Su nombre en una o dos palabras** (`i18n.ts`) y su icono: lo que sale en «Añadir paso», en «Buscar» (`Ctrl+K`) y
  en los pasos de un turno.

Lo que entra en la lista además de las 14 de hoy:

- **Lo que ya hace la app y la IA no:** páginas y bloques, vistas (filtros, orden, columnas), mover o renombrar
  colecciones, la Bandeja (aceptar, rechazar, corregir), flujos (encender, ejecutar), calendarios (añadir, separar,
  colores), los ajustes de un conector. Unas 60 o 70 acciones: varias rutas son la misma.
- **Las de pantalla:** abrir una página, una fila o la Bandeja, desplazarse hasta algo, resaltarlo, filtrar la vista
  abierta, cambiar un valor de la página (§4.6). No tocan datos ni pasan por el almacén; las registra la app, como
  WebMCP (`navigator.modelContext.registerTool`) o las App Intents de Apple, y solo las pide un turno de Juan en ese
  dispositivo.
- **Las rutas de la API pasan a ser un camino más** hacia una acción, con el origen «Juan desde este dispositivo». Una
  ruta que cambia datos sin su acción no pasa el CI.

**Lo que solo decide Juan.** Es el suelo de seguridad de siempre, dicho en un sitio:

- **Con su toque:** aceptar o rechazar propuestas, encender un flujo o un paquete, ejecutar un flujo (P8), borrar (P5)
  y lo que la política manda confirmar. La IA lo prepara y Juan lo confirma en una tarjeta que pinta el código con los
  argumentos reales: «Aceptar «Reunión con secretaría» (jueves 6, 12:00)» [Aceptar].
- **Solo él, en su sitio:** bajar el nivel de una colección para la IA (A-04: lo privado se abre en su página), la
  zona peligrosa y las claves (A-05), entrar y los dispositivos. La IA puede llevarle allí («te abro su página para
  que la desbloquees»), nunca hacerlo.

**La prueba** (amplía D-41, A-16 y A-18): cada acción tiene su control en la app o su entrada en «Buscar», su
herramienta para la IA (o está en la lista de arriba con su porqué) y su escenario. Una acción nueva sale en los dos
sitios o en ninguno.

**Ejemplo.** «Boni, hazme una página Gastos con el gasto de este mes por categoría.» Hoy no puede: no hay acción de
páginas. Con la lista, su plan es crear la página y añadirle una gráfica, lo mismo que haría Juan con «/» y «Gráfica»,
con Deshacer.

**Lo que hay (la 86, primera parte: 2026-11-11).** El registro es la lista (`apps/server/src/actions.ts`,
`serverRegistry()`): cada acción dice su **área** (datos, páginas, Bandeja, flujos, Boni, extensiones, conectores…).

- **Páginas y vistas:** `pages.create`, `pages.add_block` (texto, título, gráfica o tabla de una colección por su
  nombre, con sus campos por nombre), `pages.set_view` (diseño, orden, filtro, agrupación de una tabla),
  `pages.update` (nombre, icono, sitio) y `pages.delete` (siempre con su tarjeta). Las mismas que el editor: la
  página la escribe el sistema con quién la pidió (`by`) y la ejecución, así que el registro dice «Boni» o el
  asistente y Deshacer de la ejecución la deja como estaba (`apps/server/src/pageActions.ts`).
- **Bandeja:** `inbox.pending`, y `inbox.accept` / `inbox.reject`, que son **su toque** (efecto `touch`, regla P21):
  la IA las prepara, en un turno de Juan desde un dispositivo personal, y la tarjeta las pinta con el título de cada
  propuesta y su colección; nunca en un flujo ni por el MCP, y con argumentos que vienen de fuera no se piden.
  «Acepta estas dos» señala las tarjetas de la pantalla (`$screen.inbox`).
- **Rutas:** cada ruta de la API que cambia algo dice su acción, su Deshacer, que es solo de Juan (con su porqué) o
  que no es una acción (preguntar, confirmar, calcular). Las que aún no están en una acción van en `NOT_YET`, una
  lista que solo puede encoger (60 hoy).
- **App:** cada control dice su acción (`data-boni-action`), lo que Boni sobre la pantalla también señala; «Buscar»
  (`Ctrl+K`) ofrece las acciones que no tienen otro sitio («Nueva página», «Abrir la Bandeja»). Tras un turno que
  cambió algo, y tras Deshacer, la app vuelve a leer las páginas y la Bandeja. Las acciones aún sin control
  (`NO_CONTROL_YET`, 14: las de datos, colecciones, flujos y la guía) también solo pueden encoger.
- **MCP:** `pages_create`, `pages_add_block`, `pages_set_view`, `pages_update`, cada una con su Deshacer. Su toque y
  borrar no tienen herramienta (su porqué en `ACTION_MCP`); las piezas de Boni y las de una extensión solo corren en
  un flujo (A-19).
- **«Añadir paso»:** las acciones de su toque no son pasos (P21 las rechaza en un flujo); el resto, sí.

Queda (la 86, siguientes partes): flujos y datos (filas, colecciones, campos, `flows_test` en el MCP), y después
calendarios, conectores, conversaciones, preferencias y extensiones, hasta que `NOT_YET` y `NO_CONTROL_YET` queden
vacías.

### 4.2 Todo lo que Boni hace solo es un flujo

Un **flujo de Boni** (hoy `by: "preset"`) es un flujo como los de Juan: se ve en el mapa, se abre en el editor y tiene
versiones y «Volver al de Boni». Los de hoy, con su disparador:

| Flujo | Disparador | Pasos que se verían | Hoy, en el código |
|---|---|---|---|
| Traer correo | Llega correo al buzón (el conector mira cada 5 minutos) | Guardar en Correos (pieza), con sus adjuntos, el original, la invitación y el hilo | Un flujo de Boni desde el 2026-11-06 (D-50); `Mails.run` |
| Leer correo | Llega un correo | Reglas de la guía → Lo pendiente del remitente → Invitación → Lectora → Decisora → Rellenadora → Relaciones → Crear en la elegida → Plegar hilo → Bandeja → Aceptar solas | `mailPlan` y el código de alrededor |
| Revisar la guía | Cuando tus decisiones lo piden: cada 20 decisiones nuevas (su ajuste, de 10 a 500) o «Revisar ahora»; una vez al día como mucho | Tus decisiones (pieza, con las reglas que ya muestran sus correcciones) → Revisora → Medir releyendo (pieza, 20 correos con cada guía, su ajuste, de 1 a 20; 45 al día) → Sugerencia (pieza) | Un flujo de Boni desde el 2026-11-06 (D-51); `mailReview.ts` |
| Conversación | Un mensaje de Juan | Contexto (historial, memoria, colecciones, pantalla) → Agente → el plan que escribió → Respuesta | `agent.ts` |
| Aviso del presupuesto | El gasto llega al aviso (se mira antes de cada llamada de segundo plano a un modelo; una vez al mes) | Avisar, con su texto | Un flujo de Boni desde el 2026-11-11 (D-53); `models.ts` |
| Mantenimiento | Cada 6 horas | Copias, alargar series | `backups.ts`, `calendarStore.ts`; fuera del mapa salvo «Mostrar mantenimiento» |

**La pieza de Boni** es el paso que es código: sus entradas y su salida con su forma, sus ajustes en el panel, su
clase de efecto y sus números, como un nodo de n8n (el de Gmail es código: se configura, no se edita). Por ejemplo:
«Reglas de la guía» (entra el correo; sale «saltar», «llevar a Tarea» o «seguir»), «Invitación» (sale el evento del
`.ics`), «Relaciones» (salen los registros que nombra el correo), «Plegar hilo» (entran las propuestas; salen las que
quedan; ajuste: 60 días), «Aceptar solas» (ajuste: el interruptor «Solo»). La diferencia con una **función** (§4.5):
una pieza es código de Boni, revisado en un PR; una función es código que escribió un modelo o Juan y corre en la caja
(A-08, A-09).

**Lo que no es un paso:** el intérprete, la política, el programador de horarios, el almacén y la caja. No hacen una
cosa de un flujo: son el suelo sobre el que corren todos. Por eso cambiar un flujo de Boni puede cambiar lo que hace,
nunca lo que se le permite.

**Cambiar un flujo de Boni** se puede desde ya, como uno propio: versiones, «Volver al de Boni», la lista de
comprobación y «Probar» con ejemplos de verdad, que dice la diferencia con la versión que corre («con este cambio, de
los 40 últimos correos, 3 propuestas repetidas más»). Los candados por paso («más tarde cerremos las modificaciones»)
llegan después, sin cambiar nada de esto.

**Ejemplo: «Leer correo», como se vería.** Cada paso con lo de los últimos 7 días («212 correos · 31 propuestas · 4
preguntas · 0,41 €»):

1. **Llega un correo** (disparador; viene del conector Correo).
2. **Reglas de la guía** (pieza): si dice «saltar», acaba aquí; si dice «llevar a Tarea», la colección ya está
   elegida.
3. **Invitación** (pieza): si trae un `.ics`, sale su evento con su día y sus horas, sin modelo.
4. **Lectora** (Haiku, con la guía): lo que el correo pide a Juan.
5. **Decisora** (Jev): Tarea o Evento; si duda, una pregunta en la Bandeja.
6. **Rellenadora**, por cada cosa: los demás campos y la nota.
7. **Relaciones** (pieza): la Persona del remitente, si la hay.
8. **Crear en la elegida**: la propuesta.
9. **Plegar hilo** (pieza, 60 días): lo que una respuesta repite no sale otra vez.
10. **Bandeja**, y **Aceptar solas** (pieza; «Solo» apagado).

**Cómo quedó (2026-11-06, la 83).**
- Una sola «Rellenadora» y un solo «Crear» para todo lo que encuentra la Lectora, sus tareas y sus eventos en una
  lista («cada cosa»). La invitación tiene su propio «Crear», porque no la lee ningún modelo (Juan: «Haz la B»; D-49).
- Solo cuando una clase de cosa va a otro sitio (una ruta a una colección fija) recorre cada clase su propia lista.
  «Leer correo» pasa de 14 pasos a 12.
- El panel de la Decisora, en el mapa y en el editor, dice bajo su línea (que ya dice que, si duda, pregunta en la
  Bandeja):
  - entre qué colecciones elige (las del `case` sobre su respuesta en la colección de los pasos, D-48);
  - «Reglas de tu guía»: las que eligen por ella sin preguntar al modelo («remitente → Tarea»). Son las que mandan a
    una de sus colecciones y a las que no se adelanta una anterior (la primera que encaja manda). Solo salen en un
    flujo cuya Decisora toma la respuesta de «Regla del remitente». Las que mandan no leer a un remitente son de
    «Regla del remitente», no suyas.

  Juan, al ver el mapa: «dentro de los detalles del modelo veo las reglas que tiene».
- Lo que dejó la revisión de la primera parte:
  - «Buscar relaciones» corre en el orden de la lista de arriba: tras la «Rellenadora», justo antes del primer
    «Crear».
  - **Los ajustes de las piezas, en su panel:**
    - «Plegar hilo» mira hacia atrás los días que dice su paso (`days`: un número entero entre 1 y 366; si no, 60),
      que se cambian en el editor como cualquier ajuste. Su panel dice los que toma el servidor («Mira 60 días atrás
      en el hilo»).
    - «Aceptar solas» enseña el interruptor «Solo», el mismo de Ajustes → Decisiones. Se vuelve a pedir al abrir su
      panel, y debajo dice lo que dice Ajustes («Apagado por Boni el …»).
  - En su tarjeta del editor, cada pieza dice «De Boni · lee» o «De Boni · cambia la Bandeja».
  - El disparador de «Leer correo» dice «Viene del conector Correo».
  - Siguen en la cola:
    - «Bandeja» como paso: ya es una caja del mapa, y como paso no haría nada;
    - los números de preguntas por paso;
    - «Probar» comparando con la versión que corre.
- **«Traer correo» es un flujo de Boni** (D-50; Juan dejó la decisión en «como tú recomendarías»):
  - Su disparador es «Llega correo al buzón». El conector mira el buzón cada 5 minutos; la carpeta está en Ajustes →
    Correo.
  - Su paso es «Guardar en Correos», una pieza que guarda el correo nuevo con sus adjuntos, el original, la
    invitación (leída de su `.ics`) y el hilo. Así se ve lo que antes pasaba escondido al traer el correo.
  - Solo una mirada que encuentra correo nuevo es una ejecución; las demás no dejan nada en el Registro ni en el mapa.
    El repaso único del correo perdido (la 34) va dentro de esa ejecución cuando coincide con correo nuevo; si no,
    trae lo que encuentra sin ejecución.
  - Apagado, no se mira el buzón, no se trae nada y Ajustes → Correo dice «Traer correo está apagado»; lo que esperaba a
    ser leído se lee igual.
  - Su disparador no se cambia (el servidor lo guarda como el de «Leer correo»), y solo «Traer correo» lo tiene.
  - La lista de comprobación pide «Guardar en Correos» sin condición. Si una versión guardada de otra forma para antes
    de él, hace una ejecución, Ajustes dice «Traer correo paró sin traer el correo» y no hace más hasta que el flujo
    cambie. Un corte del buzón a medias termina la ejecución y se dice como antes.
  - En «Probar», «Guardar en Correos» sabe que es una prueba y no trae nada.
  - Sin modelos para la cuenta, el correo se trae igual, sin ejecución.
  - En el mapa, el correo va del conector a «Traer correo» y de ahí a Correos. El Recorrido de una lectura pasa por
    él.
- **«Revisar la guía» es un flujo de Boni** (D-51):
  - Su disparador es «Cuando tus decisiones lo piden», con las condiciones de siempre: 20 decisiones nuevas o
    «Revisar ahora», y una vez al día como mucho.
  - **Cuándo y cuánto aprende son ajustes del flujo** (decidido por Juan el 2026-11-11, «la recomendada»; la 83):
    - «Decisiones nuevas», en el panel del disparador (`every`, 20 al venir de Boni): cuántas decisiones nuevas le
      hacen mirar solo.
    - «Correos», en el panel de «Medir releyendo» (`mails`, 20 al venir de Boni): cuántos correos decididos relee
      con cada guía.
    - El código pone el techo (`learning.ts` `reviewEvery`, `mailReview.ts` `measureMails`): nunca mira con menos
      de 10 decisiones nuevas (las que necesita una revisión) ni pasa de 500, y nunca relee más de 20 correos con
      cada guía (dos lecturas por correo caben en las 45 del día). Un ajuste fuera se recorta, venga del editor o
      de donde venga: cambiar un flujo de Boni cambia lo que hace, nunca lo que se le permite.
    - Lo demás del disparador no se cambia, y lo sigue teniendo solo él.
  - **«Aprender» no es un flujo aparte** (decidido por Juan el 2026-11-11): lo que aprende es «Revisar la guía» y
    lo que acepta solo es la pieza «Aceptar solas» de «Leer correo»; un flujo «Aprender» no tendría ningún paso
    que no esté ya en esos dos. El interruptor «Aprender» de Ajustes se queda como pausa general de todos los
    aprendices (`learning.ts`, `mayReview`): apagado, «Revisar la guía» no mira solo. Poner un aprendiz a un
    flujo de Juan queda fuera: pide su propio diseño.
  - Sus pasos son las fases de la revisora de siempre:
    - «Tus decisiones» (pieza): tus decisiones como las lee la Revisora, y cuántas reglas halló ya el código (las
      mide «Medir releyendo» con lo que diga la Revisora);
    - la «Revisora» (su modelo);
    - «Medir releyendo» (pieza): relee correos decididos con la guía de hoy y con la nueva;
    - «Sugerencia» (pieza): la deja esperándote en Ajustes → Correo solo si acierta más.
  - La sugerencia cuelga de esa ejecución.
  - Apagado, o sin modelos, la revisora no mira y nada cuenta como revisado; «Revisar ahora» dice «Revisar la guía
    está apagado». Con pocas decisiones no hay revisión (ni ejecución).
  - Si la Revisora para (una respuesta que el código no acepta, un modelo caído), no se mide nada y las reglas que
    halló el código no se apartan: se prueban en la siguiente.
  - En «Probar», la Revisora lee de verdad (una llamada) si hay decisiones bastantes. «Medir releyendo» solo dice
    cuántos correos releería, y «Sugerencia» no guarda nada. Una prueba nunca toca una revisión en marcha.
  - Su lista de comprobación pide «Medir releyendo» y «Sugerencia» sin condición. Sus piezas solo están en él, y
    «Guardar en Correos» solo en «Traer correo». Al duplicarlo, la copia empieza a mano.
  - En el mapa es ese flujo: aprende de la Bandeja y mejora «Leer correo». Las relecturas al medir cuentan en sus
    llamadas y su coste, nunca como ejecuciones suyas.
- **«Aviso del presupuesto» es un flujo de Boni** (D-53; la propuesta recomendada de la 83, «Lo que queda de F7»,
  2026-11-10; en main el 2026-11-11):
  - Su disparador es «El gasto llega al aviso»: el gasto del mes en modelos llega a la fracción de aviso del
    presupuesto (Ajustes → Modelos: «aviso al 80 %»). Se mira donde siempre, antes de cada llamada de segundo plano a
    un modelo.
  - El gasto se relee cada 30 s, también en una ráfaga de llamadas. Antes, mientras llegaban seguidas, se miraba una
    cifra vieja: ni el aviso ni el tope saltaban hasta 30 s de calma.
  - El disparador da a sus pasos dos valores, «Gasto del mes» y «Presupuesto» (en euros, como texto). Su tarjeta y su
    panel dicen los dos siempre.
  - Su paso es «Avisar», la herramienta de siempre, con su texto («Los modelos llevan 8.55 € de 10 € este mes.»). El
    texto es del flujo: se cambia en el editor como el de cualquier paso, y se le pueden añadir pasos.
  - Hay una ejecución al mes, cuando salta, sin llamar a ningún modelo. Sale en el Registro con el nombre del flujo y
    cuenta en el mapa como una ejecución suya.
  - Apagado, no avisa, no hay ejecución y el mes no queda marcado: encendido más tarde ese mes, avisa en la siguiente
    llamada de segundo plano a un modelo. Ajustes → Modelos dice «aviso apagado» junto al presupuesto.
  - El tope no es un paso: encendido, apagado o cambiado, al llegar al presupuesto el trabajo de segundo plano deja
    de llamar a modelos igual. También el de este flujo: un paso con modelo que se le añada se para como cualquier
    otro. Cambiar un flujo de Boni cambia lo que hace, nunca lo que se le permite.
  - Encendido, el aviso del mes no se pierde: si su ejecución para antes de «Avisar» (un paso con modelo parado por
    el tope, un modelo caído), avisa el código como antes, con su texto. Si paró después de avisar, no se repite.
  - Sin recursión: el mes se marca antes de empezar la ejecución. Así hay una al mes pase lo que pase en ella (si
    para, no se repite), y la mirada al presupuesto de la propia ejecución no empieza otra.
  - Su disparador no se cambia (el servidor lo guarda), solo él lo tiene y no se ejecuta a mano; un modelo no puede
    proponer un flujo con él ni un cambio de este. Al duplicarlo, la copia empieza a mano y apagada; su lista de
    comprobación marca su «Avisar», porque a mano nadie le da las dos cifras («toma un valor que no existe antes»).
  - Su lista de comprobación pide «Avisar» sin condición, y no admite un paso que se llame como una de sus cifras.
  - En «Probar» no avisa: dice lo que avisaría, con las cifras del mes (nunca con las que traiga la petición), y no
    cuenta como ejecución. Se puede probar una parte («Probar hasta aquí» en un paso anterior a «Avisar»); lo mismo
    vale ya para «Traer correo» y «Revisar la guía», que lo rechazaban.
  - Un «Probar» que llama a un modelo, de este flujo o de otro, mira el tope igual y no pone en marcha el aviso: lo
    hará la siguiente llamada que no sea una prueba.
  - Sin modelos para la cuenta no hay quien ejecute el flujo: el aviso sale como antes, por código y sin ejecución
    (hoy no llega a pasar, porque el presupuesto solo se mira antes de una llamada a un modelo). Lo mismo si el flujo
    no se pudiera guardar. Apagado, tampoco ahí avisa. Sin almacén no hay ni agente ni quien mire el presupuesto:
    nada cambia.
  - Sin presupuesto (0 €) no hay aviso que pasar (antes avisaba «0.00 € de 0 €» cada mes), y Ajustes → Modelos dice
    «Sin presupuesto».
  - En el mapa es un flujo de Boni con sus ejecuciones. No lee ni escribe ninguna colección: su flecha es lo que
    avisa, «avisa», hacia «Dispositivos» (§4.4), y con ella sale en el mapa entero. Una ejecución suya se ve
    desplegada desde su disparador hasta «Avisar», y de ahí a «Dispositivos».
- Falta, como flujo, «Conversación»: su trabajo ya se ve en el mapa (la conversación); como flujo con pasos pide
  diseño (es la F11). «Aprender» no será un flujo (arriba, en «Revisar la guía»).

### 4.3 Los disparadores

| Disparador | Ejemplo | Origen de la ejecución | Hoy |
|---|---|---|---|
| Llega a una colección por un conector | Llega un correo | Segundo plano (P7) | `created: correo` (F1) |
| Cambia una colección | Se crea un movimiento; una tarea se marca hecha | Segundo plano | Nuevo (F12) |
| Horario | Cada día a las 8 | Segundo plano | F4 |
| Un botón o un formulario de una página | «Cerrar mes» | Turno de Juan en ese dispositivo | Nuevo (F11; la 63, punto 12) |
| Un chat | La conversación, el chat de una página, Boni sobre la pantalla | Turno de Juan | La conversación, aún no como flujo |
| A mano | «Ejecutar» en el editor | Turno de Juan | F2 («Disparado por el usuario») |
| Lo pide el planificador | «Ejecuta mi cierre de mes» | Turno de Juan, confirmado (P8) | F4 (`flows.run`) |
| Algo de Boni | 20 decisiones nuevas; el gasto llega al aviso | Segundo plano | «Revisar la guía» (`learning: "mail"`, D-51) y «Aviso del presupuesto» (`spending: "warn"`, D-53) |

Para que no se enreden (F12):

- **Una cadena por datos tiene tope.** Si un flujo escribe en una colección que dispara otro, la ejecución lleva su
  cadena: como mucho 3 eslabones, y un flujo no vuelve a correr en la misma cadena. La lista de comprobación enseña un
  ciclo del mapa antes de encender.
- **Un tope por disparador:** como mucho unas pocas ejecuciones por minuto y por flujo, con su línea en el log al
  pasarlo (A-14).
- **Lo que hace solo.** Hoy un flujo en segundo plano solo lee, avisa y propone (P7). Para un flujo de Juan disparado
  por sus propios datos, donde nada de lo que usa viene de fuera, se propone que escriba con Deshacer y avisando
  (decisión 5). Lo que viene de fuera sigue proponiendo (P4).

### 4.4 El mapa

**Qué es.** Un grafo que se calcula (sustituye a `pipeline.ts` y a A-16), nunca se dibuja, a partir de:

- los flujos guardados: sus disparadores, lo que leen y escriben, las acciones que llaman y los modelos de sus pasos;
- los conectores: qué traen y a dónde;
- las páginas: qué colección pinta cada bloque, qué hace cada botón, qué valores usa cada bloque;
- la auditoría: quién hizo qué en 7 o 30 días (los números de cada nodo y de cada flecha, como hoy «Modelos»), con
  Juan y con Claude por el MCP.

**Qué se ve.**

| Nodos | Flechas |
|---|---|
| Conector, colección, disparador, flujo (plegado o con sus pasos), modelo, página, bloque, botón, la Bandeja, Juan, los asistentes, los dispositivos | trae, pone en marcha, lee, escribe, propone, acepta, pinta, controla, avisa |

Lo que viene de fuera va marcado en la flecha que lo lleva (lo dicen las etiquetas, `nucleo.md` §4.2): se ve por dónde
viaja el texto de un correo y dónde deja de ser una propuesta para ser un dato de Juan.

**Cómo se abre.** Siempre desde algo, nunca entero: con 22 colecciones y una docena de flujos, entero no se lee.

- **En el centro:** lo que se elija, con un buscador o con el clic derecho → «Ver en el mapa» desde cualquier sitio.
- **Profundidad:** de 1 a lo más lejos que llega el centro («5 (máx.)»), hacia atrás y hacia delante a la vez, como el
  linaje de dbt o de Dagster (primero fueron «Antes» y «Después»; una sola barra desde la 90, hasta su máximo desde la
  91).
- **Agrupar por:** disparador, flujo, colección o paquete.
- **Filtros:** solo los pasos con IA, solo lo que escribe, solo lo encendido, solo lo que ha pasado en 7 o 30 días.
- **Una ejecución encima:** desde el Registro, una fila o una tarjeta, el camino que siguió, con lo que salió de cada
  paso (el Recorrido de F3, sobre el mapa y no solo sobre su flujo).

**Dónde vive.** «Flujos» pasa a ser una colección de Boni (la 63, punto 1) con dos vistas: «Tabla» (la lista de hoy:
nombre, disparador, estado, ejecuciones) y «Mapa». Un flujo se abre en su editor (el de F2, que no cambia). «Modelos»
desaparece: su configuración ya está en Ajustes → Modelos (D-05), sus números pasan a los pasos que hacen los modelos,
y «Uso de la IA» sigue como página. En el teléfono, el mapa se ve y un flujo se ejecuta; se edita en el escritorio (la
63, punto 14).

**«Ver en el mapa»** entra en el menú del clic derecho (I-17) de una colección, una fila, una página, un bloque, un
botón, un flujo y un turno de la conversación; el de una tarjeta de la Bandeja tiene «Recorrido», que es su ejecución en
el mapa (la 90).

**Para que el mapa no mienta** (lo que le pasa a «Relacionado» de Home Assistant, que no ve lo que pasa por una
variable): la colección en la que lee o escribe un paso es un literal, o una de una lista literal («Tarea o Evento»).
La lista de comprobación avisa de lo demás antes de encender.

**Ejemplos.**

- «¿Qué pasa cuando llega un correo?»: Correo (conector) → Correos → Leer correo (con sus pasos) → Bandeja → Juan
  acepta → Tarea y Evento; y, en vuelta, Juan → sus decisiones → Revisar la guía → la guía → Leer correo. Cada nodo
  con sus números de la semana.
- Clic derecho en la colección Evento → «Ver en el mapa», «Profundidad: 1»: Leer correo (propone, 23), Conversación (crea,
  4), Boni Calendar (Juan, 61), Claude por el MCP (2).
- Clic derecho en una tarea → «¿De dónde viene?»: el correo, la lectura que la propuso (Leer correo v3), lo que
  contestó cada modelo y el «Aceptar» de Juan.

**Cómo quedó (F8, 2026-11-06).** Lo que se decidió al hacerlo, para que se pueda discutir:

- **El disparador va en el flujo**, no es un nodo aparte: la tarjeta del flujo lo dice («Llega a Correos», «Cada día a
  las 08:00», «Disparado por el usuario») y «Agrupar por disparador» enmarca los flujos que comparten uno. Un nodo
  más por flujo duplicaba lo que ya dice la flecha «pone en marcha».
- **La Bandeja es un nodo que se cruza** (primero fue en las flechas; cambiado el mismo día, porque así «¿Qué pasa
  cuando llega un correo?» no llegaba ni a la Bandeja ni a la revisora): lo que un flujo en segundo plano o la
  conversación propone entra en ella («propone · 12», discontinua) y sale a cada colección lo aceptado («aceptadas ·
  7»); tus decisiones en ella («decides · 11») van a la revisora («tus decisiones · 11»), que mejora «Leer correo».
  Para que «Profundidad: 1» de Evento siga diciendo quién la escribe, el mapa la cruza sin contarla: desde Evento llega a la
  Bandeja y, en el mismo paso, a lo que propone en Evento, no a lo que propone en otra colección, con lo que propuso
  en Evento (cada flecha que entra en la Bandeja dice a qué colecciones van sus propuestas y cuántas a cada una).
  «decides» son tus decisiones (no lo que Boni aceptó solo); «tus decisiones», las de las propuestas del correo, las
  únicas de las que aprende la revisora. Tú no sales «después» del correo: tus decisiones son las palabras de esas
  flechas, y así lo que escribes por tu cuenta no inunda el camino del correo.
- **Una ejecución encima, por todo el mapa**: desde su Recorrido, una propuesta o una fila, su flujo desplegado con lo
  que salió de cada paso y su camino encendido (el conector y la colección del correo, el flujo, la Bandeja, la colección
  donde se aceptó lo que propuso, donde escribió), con una tarjeta que lo cuenta con palabras.
- **El Recorrido es el mapa** (la 90, Juan, 2026-11-06, al probarlo: «teniendo el mapa, no tiene sentido tener lo del
  recorrido»; el del Registro empezaba en el disparador y el del mapa en el conector, con otros nombres para los mismos
  pasos): el lienzo propio de una ejecución (F3) desaparece; su «Recorrido», desde el Registro, una tarjeta de la
  Bandeja, la página de una propuesta o un turno, la abre en el mapa. Su flujo desplegado empieza en lo que lo empezó
  (una primera caja con el disparador y lo que trae, como en el editor), y su camino va en naranja, del conector a
  donde acabó, cada caja y flecha encendida a su turno y una luz que corre por sus flechas (quieta si el sistema pide
  menos movimiento). Su camino está entero en el mapa sea cual sea la «Profundidad», y una ejecución de una versión
  anterior de su flujo se dibuja sobre la suya (sus pasos, como corrieron: tras «Crear en la elegida», las lecturas de
  antes tenían otros pasos). El Registro lo dice con palabras, sin dibujo; la tarjeta del mapa, con «Detalles» (cada
  paso con lo que hace) y «Copiar». Lo que lleva texto de fuera se marca con un sobre en sus palabras y una línea punteada, sin color propio (la 91:
  el rosa se leía como algo encendido).
- **Un paso se llama igual en todas partes** (I-27): el editor, el mapa, la vista previa de un flujo, el Registro y
  «Copiar» toman su nombre de un solo sitio («Lectora», «Crear», «Regla del remitente»), nunca el id de una herramienta,
  una referencia `$` o el código de una regla; cada paso dice en una línea lo que hace; por qué paró, con palabras («una
  regla de seguridad lo impide»), y el código solo en «Copiar».
- **El recorrido, segunda vuelta** (la 91, Juan, 2026-11-06, al probar la 36): el camino va por los pasos que hicieron
  algo y, entre dos, por el trayecto más corto de las flechas del lienzo, nunca por las calles que no tomó (antes se
  encendían todas); lo que la ejecución solo leyó no es su camino; una luz lo recorre una y otra vez, despacio, del
  conector a la colección. Al pulsar una caja se ve lo que salió de ella en esa ejecución: el correo, lo que cada paso
  dio al siguiente (guardado con el paso desde la 91; de antes, sacado de la respuesta del modelo), la tarjeta de la Bandeja, la fila que quedó al
  aceptarla. Lo de esa ejecución va en naranja, sus llamadas y su coste también; lo demás son las cifras del periodo,
  dicho debajo del mapa. «Profundidad» llega a su máximo («5 (máx.)»), «Explicación» se oculta, y lo de fuera se marca
  con un sobre en la flecha y no con un color.
- **El recorrido en la conversación** (la 92): la respuesta «run» del lenguaje de planes dibuja el camino de una
  ejecución que dieron `entities.origin` o `inbox.pending`, con «Ampliar» al mapa; esas herramientas dicen quién por su
  nombre (`who`) y dan su ejecución (`run`). La lista de conversaciones se pliega y se ensancha.
- **Las llamadas y el coste de cada paso** (lo que la revisión de F8 echó en falta): cada llamada a un modelo guarda el
  paso en el que contestó (la migración 19; las de antes del 2026-11-06 no lo tienen), y cada paso que piensa dice en el
  mapa y en el editor sus llamadas y su coste del periodo («42 llamadas · 0,21 US$»), contados con un índice que no lee
  los textos (A-15).
- **«¿De dónde viene?»** está en el menú de una fila: lo que propuso un flujo lleva a la ejecución que lo propuso, a su
  correo y al «Aceptar» (aceptar una propuesta guarda desde el 2026-11-06 qué propuesta aplicó; las de antes se
  encuentran por la hora); lo que escribió alguien lo dice en un aviso. Lo que contestó cada modelo está en los pasos
  de la ejecución, en el Registro y en «Detalles» de su tarjeta en el mapa. **También en la conversación y por el MCP**
  (de la 86, adelantado el 2026-11-06: Juan preguntó en la conversación de dónde venía una tarea propuesta en la
  Bandeja y el planificador solo pudo buscar correos con ese nombre): el planificador tiene `entities.origin` (de un
  registro) e `inbox.pending` (lo que espera en la Bandeja, por las palabras de su título), y el MCP `origin` e
  `inbox`, con los mismos hechos que la tarjeta (`originFacts` y `pendingFacts`, de `origin.ts`): quién lo hizo o lo
  propuso y cuándo, el flujo, el correo que lo empezó, cuándo se aceptó. Lo que los modelos no pueden ver no tiene
  origen para ellos, un correo cerrado no se nombra, y el título de una propuesta va marcado como de fuera.
- **Los modelos van en los pasos**: cada flujo dice sus modelos y lo que costaron en el periodo; desplegado, cada paso
  que piensa dice su modelo. Lo que no es flujo todavía (la conversación, la revisora de la guía) son nodos de Boni con
  sus números del diario, hasta que F7 los haga flujos.
- **Lo que no es de nadie no sale**: sin centro, el mapa enseña lo que está unido a algo; una colección sola sale al
  ponerla en el centro. Las páginas, con «Con páginas» (con 20 páginas tapaban el resto).
- **Lo que Boni avisa va a «Dispositivos»** (la 83, Juan, 2026-11-11: «Sí, añádela»; un flujo que solo avisa no
  salía en el mapa entero):
  - «Dispositivos» es un nodo propio, el de tus dispositivos, donde llegan los avisos (A-17). Dice los avisos del
    periodo («3 avisos»: la suma de sus flechas) y de él no sale nada. No es «Tú»: si los avisos fueran a «Tú», el
    mapa seguiría desde ahí a todo lo que escribes.
  - La flecha «avisa» sale de cada flujo que tiene un paso «Avisar», de Boni o tuyo, con los avisos que dieron sus
    ejecuciones en el periodo. Un flujo que aún no avisó la tiene igual, sin número. Desplegado el flujo, sale de
    su «Avisar» (de cada uno, si tiene varios).
  - Un aviso es una llamada a «Avisar» que salió: la regla la permitió y la herramienta no la rechazó después (un
    texto vacío no avisa a nadie). Lo que un «Probar» habría avisado no es un aviso.
  - Se cuenta de las líneas del diario, que dicen qué herramienta corrió cada una: no depende de cómo se llame el
    paso ni de la versión del flujo que corrió. Lo que avisó en el periodo una versión anterior cuenta también, y
    un flujo que hoy ya no avisa conserva la flecha mientras queden avisos suyos en el periodo.
  - De la conversación sale cuando un turno suyo avisó en el periodo.
  - Un flujo que borraste se va del mapa con lo que avisó, como con sus ejecuciones.
  - Se calcula, como todo el mapa: las flechas, de los planes guardados; los números, del diario, en una sola
    consulta para todo el mapa.
  - No cambia datos: «Solo lo que escribe» la quita, y con «Solo lo que ha pasado» se va si no hubo avisos.
  - Una ejecución que avisó la recorre: su camino acaba en «Dispositivos», por la flecha del paso que avisó (otro
    «Avisar» del flujo que esa ejecución se saltó se queda apagado), y su explicación dice «Avisó a tus
    dispositivos»; dibujada en la conversación, acaba igual. También cuando el mapa del periodo no tiene esa
    flecha (la ejecución es anterior, o su flujo ya no avisa): se dibuja para ella, sin número, y se va con ella.
  - Lo que avisó una ejecución lo dice el servidor, con la misma cuenta que el mapa; la app no lo deduce de sus
    pasos. El recorrido de un «Probar» no llega a «Dispositivos», aunque su «Avisar» conste como permitido.
  - Lo que avisa el código sin ejecución (el aviso del presupuesto cuando no hay quien ejecute su flujo, los
    recordatorios de Boni Calendar) no es una ejecución y no sale.
  - Falta: marcar la flecha por las etiquetas de lo que llevó cada aviso. Hoy va marcada «de fuera» cuando al
    flujo lo pone en marcha un correo, y la de la conversación nunca: es el mismo «Faltan» de la F8 (§8) para
    todo el mapa.
- **Las posiciones no se guardan en ningún lienzo** (I-26): el de un flujo va en el orden en que corre, con las
  elecciones lado a lado, y el mapa de izquierda a derecha; ni se arrastran ni piden «Guardar».
- **Una prueba en seco no es una ejecución**: no cuenta en el mapa ni en «Flujos».

### 4.5 Las extensiones pasan a paquetes

**Lo que es hoy una extensión** (`extensiones.md` §3 y §11): un manifiesto con colecciones (`types`), un conector
(`sources`), módulos de lectura (`readers`), flujos (`flows`), rutas (`routes`), guía, aprendizaje, ajustes (`ui`), lo
que pide (`needs`) y funciones con sus pruebas; y un modo de conversación (C5). Con §4.1–§4.4, cada parte ya tiene su
sitio:

| Parte | Dónde vive |
|---|---|
| `types` | Colecciones, en «Mis datos» |
| `sources` | Un conector |
| `flows`, `routes` | Flujos (las rutas son sus últimos pasos) |
| `readers` (módulos) | Los ajustes de la lectora, en su paso |
| `guide`, `learning` | Los ajustes del paquete (la clase 3 de `preferencias.md`), en Ajustes con su nombre: Ajustes → Correo, como hoy |
| `functions`, `tests` | Pasos «Función», con su código y sus pruebas en una colección de Boni, «Funciones» |
| Modo de conversación (C5) | Un flujo con disparador «Chat» y un paso «Agente» con sus instrucciones y sus acciones |
| `needs` | Lo que pide el paquete al activarse (A-10) |

Juan tiene razón: no están aisladas, y casi todo lo que traen es lo mismo que lo de Boni. Lo único que no tiene otro
sitio es **qué llegó junto**: lo que un asistente propone de una vez, lo que Juan activa de una vez, lo que se
versiona y se quita junto, y lo que pide. Eso es un **paquete**.

Recomendación: la palabra «extensión» sale de la app. No hay sección «Extensiones» ni Ajustes → Extensiones; un
paquete se ve como grupo en el mapa («De Correo», «De Conciliación», «Tuyos», «Propuestos»), como tarjeta cuando se
propone o se activa, y con sus ajustes, si los tiene, en Ajustes con su nombre. La seguridad no cambia: nada se activa
solo (A-10), el código de una función sigue en la caja (A-08) y nunca escribe (A-09).

**Cómo quedó el paso «Función» (2026-11-06, la 93; Juan eligió «A: a la Bandeja»; D-52).**
- Son dos pasos:
  - **«Función»** corre en la caja una función de una extensión activa, nombrada en el paso tal cual («banco/importar»),
    sobre lo que declaró que lee y lo que el paso le da («Datos»). Dice lo que cambiaría (cuántas nuevas y cambiadas,
    sus preguntas y su resumen) y no escribe nada (A-09). Todo lo que dice lleva la etiqueta de lo que leyó: un número
    suyo nunca llega a un modelo como si fuera de Boni. Guarda lo que necesita para volver a correrla igual (sus datos,
    que cuentan otra vez en el tope de una ejecución y van enteros con la propuesta, su día y su semilla) y la huella
    de su conjunto, nunca el conjunto.
  - **«Aplicar cambios»** toma su resultado entero y es una escritura como cualquier otra:
    - no se fía de lo que le da un plan: vuelve a correr la función (A-09, «se repite») sobre lo que hay ahora y hace su
      conjunto solo si es el propuesto (la misma huella) y si lo que Juan lee es lo que corre (el nombre de la función,
      su resumen, sus números y sus preguntas), con lo que leyó del almacén; si no, no hace nada y, si era una
      propuesta, «Ya no vale» en la Bandeja (nunca queda aceptada sin hacer nada);
    - en un flujo en segundo plano, el conjunto entero espera en la Bandeja como una sola propuesta: «Banco ·
      importar: 2 nuevos» (su nombre y su resumen), con sus números y sus preguntas por nombre, nunca el JSON;
    - aceptada, se hace en esa ejecución, toda o nada (una transacción: un valor que una colección no admite detiene
      el conjunto entero), y Deshacer la quita entera; si al aceptarla la caja no contesta, no se hace nada y vuelve a
      esperar en la Bandeja;
    - a mano, decide la política (lo que hace una función nunca es palabra de Juan), contando cada fila: con muchas
      (más de 20, P11) pide confirmar antes; aceptada en la Bandeja no se pregunta otra vez;
    - lo que ningún modelo puede leer (lo que leyó de una colección opaca) nunca va a una colección más abierta (A-09).
- En «Probar», «Función» corre en la caja (es pura) y dice su resumen; «Aplicar cambios» dice lo que haría.
- La lista de comprobación pide la función por su nombre literal y activa, y «Aplicar cambios» sobre una «Función».
- En el editor, «Añadir paso» los ofrece en el grupo «Funciones» cuando hay alguna función activa; el panel de
  «Función» elige entre ellas y enseña su código y los nombres de sus pruebas, para leerlos.
- El MCP (`flows_describe`) dice qué funciones activas puede nombrar un paso y cómo.
- Falta:
  - la colección «Funciones» (siguen en el manifiesto de su extensión);
  - correr sus pruebas desde el panel (las nombra; pasaron al activarla y pasan en cada versión);
  - contestar las preguntas de una función (la tarjeta las dice; no se aplican);
  - la tarjeta en seco al subir un extracto (§11.1 de `extensiones.md`: hace falta el disparador «al subir un
    fichero»);
  - la lista de comprobación de un flujo que se acepta desde una conversación no pide aún la función literal (lo
    hace la del editor y la del MCP); «Aplicar cambios» no depende de ella: nunca hace un conjunto que no dé la
    función;
  - en el mapa, las colecciones que lee y escribe una función.

**Ejemplos.**

- **Correo:** el conector Correo (el buzón), la colección Correos, los flujos Traer correo, Leer correo y Revisar la
  guía, y la guía como ajustes del paquete. Apagarlo apaga los tres flujos; «Versiones» lo devuelve entero a una
  anterior.
- **Conciliación** (la 3, E4): las funciones «importar» y «cerrar mes», el flujo «Subir extracto» (disparador: un
  archivo en la carpeta de extractos) y el chat «Conciliación» (disparador: chat; botones «Subir extracto» y «Cerrar
  mes»). Claude lo propone por el MCP como hoy; Juan lo activa entero.
- **Bancos** (la 4b): el conector Bancos, la colección Banco y el flujo «Traer del banco» (dos veces al día), en el
  paquete de Conciliación o en el suyo.

### 4.6 Páginas conectadas

- **Valores de una página**, como las variables de un panel de Grafana o los filtros enlazados de Metabase: una página
  declara valores con nombre y tipo (una opción de una lista, un registro, un mes o un periodo, un número, un texto).
  Un bloque «Control» enseña cada uno (un selector, unas fechas); los bloques de datos los usan en sus filtros
  («Categoría es [Categoría]»); se guardan con la página, iguales en todos los dispositivos, como sus vistas (I-22).
- **Entre páginas:** un enlace o un botón abre otra página con valores («Abrir Gastos con Categoría = Comida»). Lo que
  tiene que durar (lo que Juan apunta en un formulario) va a una colección, y cualquier página lo lee: el mapa lo
  enseña.
- **Botones con acción o con flujo:** un botón llama a una acción de la lista o pone en marcha un flujo (disparador
  «Botón»), con valores de la página como argumentos («Nueva tarea con Persona = [Persona]»). Sustituye al botón de
  «Apuntar gasto».
- **El chat de la página** (la 79, C5, con el meta-prompt que pide Juan): un bloque «Chat» es un flujo con disparador
  «Chat» (su bienvenida y sus botones) y un paso «Agente» con sus instrucciones y sus acciones: leer las colecciones
  de la página y cambiar sus valores (y, con confirmación, añadir un bloque). Las cifras las calcula el código
  (`entities.aggregate`), nunca el modelo, y un clic en ellas lista sus filas (D-08).
- **Clic derecho en un bloque → «Ver en el mapa»:** los valores que lo controlan, la colección que pinta y los flujos
  que escriben en ella.

**Ejemplo: la página Gastos.** Arriba, dos controles: Categoría y Mes. Debajo, «Gasto del mes», «Gasto por día» y
«Movimientos», filtrados por los dos. En su chat, «¿cuánto gasté en restaurantes en octubre?»: el agente pone
Categoría en Restaurantes y Mes en octubre, los tres bloques cambian y contesta «312,40 € en 14 movimientos»,
calculado por el código. Juan pulsa la cifra y ve los 14.

### 4.7 Boni sobre la pantalla

Reúne C4 (la ventana), C7 (el círculo, sin la voz) y el asistente que ve la pantalla (`extensiones.md` §8).

- **Abrir.** El círculo abajo a la derecha en todas las pantallas y `Ctrl+E`. La ventana sale del círculo (C4) sobre
  lo que haya abierto, con la última conversación o una nueva; se lleva a la derecha, se amplía o se cierra con `Esc`.
  Es la misma conversación de siempre (`conversacion.md` §3.2): un solo Boni, un historial.
- **Por qué `Ctrl+E`** (Juan, 2026-11-05: en vez de `Ctrl+J`, «una letra cercana a la mano izquierda (q w e a s d z x
  c), la que tú veas mejor»). `Ctrl+A`, `Ctrl+S`, `Ctrl+Z`, `Ctrl+X` y `Ctrl+C` son de todas las apps; `Ctrl+W` cierra
  la pestaña en el navegador; `Ctrl+Q` cierra otras apps de Linux (la mano acostumbrada a pulsarlo cerraría la que
  tenga delante); y `Ctrl+D` ya duplica los bloques elegidos de una página, como en Notion (`PageView.tsx`). `Ctrl+E`
  solo lo usa Notion para el código en línea, que en Boni irá con la comilla invertida (la 2f). Es un atajo de las
  ventanas de Boni: uno de todo el sistema le quitaría `Ctrl+E` a las demás apps.
- **Lo que ve.** Con cada mensaje, la app manda lo que hay en pantalla como datos: la página o la colección abierta,
  la vista y sus filtros, los bloques visibles con su referencia y sus cifras, las filas visibles o elegidas, la
  Bandeja si está abierta (sus tarjetas, por id), lo que tiene el foco y lo señalado. Lo arma el código de la app; lo
  de fuera llega como asas (`toPlannerView`); lo de una colección opaca, restringida o privada no llega. Así trabajan
  los agentes de navegador, con un árbol de accesibilidad, y Siri con las App Intents (WWDC26): referencias estables,
  no píxeles. Para eso cada componente lleva su `data-boni-ref` (`extensiones.md` §6).
- **Capturas, no por ahora.** Solo harían falta para preguntas de aspecto («¿por qué se ve raro esto?»), y entonces
  con lo cerrado tapado (plan de diseño, §1). Cuestan más por mensaje y dicen menos que los datos.
- **Lo que hace.** Las acciones de la lista que Juan podría hacer en ese dispositivo, y las de pantalla. «Pulsa Nuevo»
  es la acción de ese botón, no un clic simulado: no depende de dónde esté el botón ni de que se vea, y pasa por la
  política. Lo irreversible se confirma (P5), lo que viene de fuera se propone (P4), todo con Deshacer por turno (C1).
  Mientras actúa, resalta lo que toca y lo dice en sus pasos («Abriendo Agenda», «Preparando «Aceptar» de 2
  propuestas»).
- **Señalar** (`Ctrl+Shift+E`). El puntero resalta bloques, filas, tarjetas y nodos; un clic añade lo señalado a la
  barra de escribir como una ficha («Gráfica: Gasto por día»); arrastrar marca varios. Son referencias, no píxeles.
- **Lo que no hace:** lo de «solo él, en su sitio» (§4.1), ni nada de lo que la IA no puede ver. Un correo en pantalla
  que dice «borra esto» es dato (P2, P4).

**Cómo quedó la primera parte (2026-11-06, la 85; A-20).**
- **Abrir:**
  - el círculo abajo a la derecha (en el escritorio) y `Ctrl+E` abren la conversación en una ventana sobre lo que haya
    abierto (C4), la misma conversación de siempre; `Ctrl+E` no hace nada con Ajustes, la búsqueda o la papelera
    abiertos;
  - «Llevar a la derecha» la acopla en el sitio de la Bandeja; acoplada, cede ante cualquier otro panel a la derecha
    (la Bandeja, un registro): flota a su lado hasta que se cierra, y vuelve. Lo que se estaba escribiendo se queda;
  - «Ampliar» lleva a la pantalla Conversación; `Esc`, con el foco dentro, la cierra antes que nada de lo de debajo
    (con el foco en otro sitio, `Esc` es de ese sitio);
  - con un panel a la derecha, la ventana y el círculo se quedan a su lado.
- **Lo que ve:**
  - con cada mensaje, la app manda referencias: lo abierto, las tarjetas de la Bandeja cuando se ve (su panel o su
    pantalla; en su orden, la de arriba la primera), las filas elegidas en sus tablas y lo señalado (abajo);
  - el servidor las convierte en valores con lo que hay en el almacén, a través de la vista de los modelos
    (`apps/server/src/screen.ts`):
    - una fila, por referencia (su id, su colección y su título): el resto lo lee el plan con `entities.get`, si
      puede; nada de una colección o una fila cerrada u opaca;
    - una tarjeta, como la da `inbox.pending`: su título como palabras de fuera (un asa), su colección, cuándo y
      quién; nunca lo que escribiría;
  - el planificador lo ve como «screen» y su plan lo nombra como `$screen`. Así «¿qué me pide el de arriba?» contesta
    con la primera tarjeta sin que el modelo lea las palabras del correo.
- **Lo que hace (I-30):**
  - «ábreme Libros» abre la colección en la pantalla. Es la respuesta «Abrir» del plan, que nombra una sola cosa: una
    colección que los modelos ven, un registro que dio una herramienta o la pantalla, o un sitio de la app (la
    Bandeja, Flujos, el Registro, Mis datos);
  - una sola cosa por respuesta, nunca una por cada elemento; nada que eligiera algo de fuera (un `when` o un
    `each` sobre los valores de un correo): eso no se abre ni se dice;
  - la app lo abre una vez, al llegar el turno, y lo resalta: el área principal con el borde de acento un momento. La
    conversación dice «Abierto: Libros». Releer la conversación no abre nada, ni seguir la ejecución (una respuesta o
    una confirmación repiten sus respuestas, no su apertura);
  - desde la pantalla Conversación, la conversación sigue en la ventana, sobre lo que abrió; en el teléfono se abre en
    la pestaña que lo enseña, sin el resalte;
  - un flujo que se ejecuta a mano también puede abrir (es un turno de Juan), aunque el editor no lo ofrece: un flujo
    solo no tiene pantalla.
- **Señalar (tercera parte, 2026-11-10; A-21, I-31):**
  - `Ctrl+Shift+E`, o «Señalar» en la barra de la ventana, convierte el puntero en uno que señala: una cruz sobre la
    pantalla, y lo que se puede señalar queda con el borde de acento al pasar por encima. Se puede señalar lo que
    lleva su `data-boni-ref`:
    - un bloque de una página (un número, unas barras, una gráfica, una gráfica de las primeras páginas, una vista de
      una colección, un texto, un botón, un enlace, una subpágina, un archivo);
    - una fila, en cualquier vista de una colección (la línea de una tabla, una tarjeta de un tablero o una galería,
      una línea de una lista, una entrada de un calendario); no las de los registros de Boni (sus llamadas, su
      actividad), que no son datos de Juan;
    - una tarjeta de la Bandeja (una propuesta o una pregunta), también la propuesta que se dibuja entre las filas.
  - un clic añade lo señalado a la barra como una ficha («Gráfica: Gasto del mes»: qué es y cómo se llama), abre la
    ventana y deja el cursor en ella; arrastrar dibuja un rectángulo y añade lo que coge:
    - lo que queda entero dentro cuenta como una cosa (una tabla, no sus filas);
    - lo que solo cruza cede ante lo que tiene dentro (tres filas de una tabla, no la tabla);
    - como mucho veinte por mensaje, cada cosa una vez.
  - mientras señala, nada de la pantalla responde al puntero (ni un clic abre, ni un arrastre mueve, ni sale un menú):
    solo la ventana de Boni, y la rueda sigue desplazando. Un clic donde no hay nada que señalar no hace nada y el
    puntero sigue señalando. `Esc` deja de señalar y no hace nada más;
  - un gesto que empezó señalando es del puntero hasta el final: ni el clic con el que se coge algo ni el segundo de
    un doble clic llegan a lo que hay debajo (el «Aceptar» de una tarjeta, un botón), y soltar el botón después de un
    `Esc` en mitad de un arrastre tampoco. Un clic en otro sitio vale al momento;
  - con la ventana acoplada a la derecha y la Bandeja abierta, señalar una tarjeta deja las dos como están;
  - la ficha se quita con su «×». Lo señalado es parte del mensaje que se está escribiendo: se guarda con él, por
    conversación, y se va con él al enviarlo;
  - lo que se está escribiendo no se pierde al cerrar la ventana, ni al ampliarla o llevarla a la derecha: es un
    borrador por conversación, con su texto y sus fichas (`core/drafts.ts`). Lo que se escribe mientras el servidor
    hace una conversación nueva es de esa conversación, no de la siguiente;
  - la app manda solo referencias (`{kind: "block", page, block}`, `{kind: "row", id}`, `{kind: "proposal" |
    "question", id}`) y el servidor dice qué es cada una con lo que hay en el almacén, en `$screen.pointed`, en el
    orden en que se señaló (`apps/server/src/screen.ts`):
    - una fila, por referencia, como las elegidas; una tarjeta, como las de la Bandeja;
    - un bloque, con lo que es (`kind`: `number`, `bars`, `chart`, `view`, `text`, `button`, `link`, `page`, `file`),
      su título, su página y su bloque;
    - un número, unas barras o una gráfica, además con **su consulta** (la colección, la medida, el campo, el grupo,
      el periodo, la fecha y el filtro, con las claves que el planificador usa en sus herramientas) y **sus cifras**
      (el total, y los nombres y los valores de sus puntos, hasta 60);
    - una vista de una colección, con su colección y su vista (la distribución, el grupo, el orden y los filtros);
  - las cifras se calculan en el servidor sobre las filas que los modelos pueden leer, y llevan la etiqueta de lo
    que leyeron (los campos que usa el bloque, en cada fila): lo de fuera llega como asa, igual que una suma de
    `entities.aggregate`. Una colección con miles de filas se lee una vez para todos los bloques señalados (A-15);
  - una fila cerrada por una regla no cuenta. Cuando eso hace que las cifras no sean las que Juan ve en pantalla,
    el bloque lo dice (`partial`), para que Boni no dé un total que él no ve; nunca cuántas filas ni cuáles. Una
    regla que cierra filas que el bloque no cuenta no cambia nada, y no se dice;
  - una gráfica de las primeras páginas (las del dinero) da las mismas cifras que ve Juan: el mismo código
    (`V1Service.computeOver`) sobre el dinero tal como lo ven los modelos (`MoneyReads`), con la colección que
    cuenta para seguir mirando con las herramientas. Si una colección que cuenta está cerrada u opaca, no hay
    gráfica; si se le quitó alguna fila, lo que nombra su filtro (una categoría, una persona) no se dice;
  - lo que los modelos no pueden ver (un bloque de una colección cerrada u opaca, una fila cerrada, una propuesta a
    una colección cerrada) llega solo como `{kind: "closed"}`: Boni puede decir que está cerrado, y no sabe nada
    más. Lo que ya no está (una tarjeta decidida desde que se señaló, una fila o un bloque borrados), como `{kind:
    "gone"}`. Las referencias solo las manda la app, nunca un modelo: distinguir las dos cosas no sirve para tantear.
- **Falta:**
  - señalar nodos (del mapa y del lienzo de un flujo): espera a las acciones de flujos (F10), que es cuando Boni
    podrá hacer algo con uno;
  - señalar un párrafo de una nota (el texto de un registro): sus bloques se hacen al leerla y no tienen referencia;
  - que el mensaje enviado enseñe lo que se señaló con él;
  - `data-boni-ref` en lo demás (los nodos, la pantalla de una gráfica, la página de un registro, la barra lateral),
    y lo que se ve sin señalarlo: los bloques y las filas visibles, la vista con sus filtros, el foco y lo abierto
    en el panel de la derecha (un correo, un registro);
  - abrir la ventana con la última conversación tras reiniciar la app (hoy, una nueva);
  - las demás acciones de pantalla (desplazarse, resaltar una fila o un bloque, filtrar la vista), que pasen por la
    política; resaltar lo que toca, no toda el área, y decirlo en sus pasos mientras actúa («Abriendo Agenda»);
  - el ejemplo de «Flujos»: abrir una ejecución sobre el mapa con el paso que la paró resaltado;
  - «Ver en el mapa» en un turno (F8, con F9);
  - de una pregunta de la Bandeja, más que su id;
  - de la ventana (§3.2 de `conversacion.md`): moverla y soltar archivos en ella;
  - el círculo en el teléfono y como widget del escritorio;
  - la decisión 3 de `conversacion.md` (la ventana, superficie por defecto): la fila «Conversación» abre aún la
    pantalla entera.

**Ejemplos.**

- En Agenda, con la Bandeja abierta: «acepta las dos del correo de secretaría y ponlas el jueves». Boni ve las dos
  tarjetas, prepara el cambio de día en cada una y pinta una tarjeta de confirmación con las dos: [Aceptar las 2].
  Juan pulsa; las dos se deshacen de una vez si hace falta.
- Señalando la cifra «Gasto del mes»: «¿por qué no cuadra con el banco?». Boni recibe el bloque y su consulta, lista
  los movimientos que suma (D-08) y señala los que no tienen línea del banco.
- En «Flujos», con un correo abierto: «¿por qué este no me propuso nada?». Boni abre su ejecución sobre el mapa y
  resalta el paso que la paró («Reglas de la guía: saltar a este remitente»).

### 4.8 Agentes que se hablan

En Boni los modelos no se mandan mensajes que se conviertan en órdenes: lo que sale de un modelo es un valor con su
etiqueta, y lo de fuera sigue siendo de fuera a través de cualquier número de pasos (`nucleo.md` §4.2). Un flujo le
pasa algo a otro **por datos**: un registro de una colección o una propuesta, con su procedencia. El mapa enseña cada
uno de esos traspasos y cuáles llevan texto de fuera. Es la defensa contra la propagación que avisó la revisión del
principio (plan de diseño, §7: «el almacén compartido es un bus de propagación»; Morris II).

n8n deja que un agente sea herramienta de otro (`AgentTool`) y que un flujo llame a otro con entradas declaradas y una
lista de quién puede llamarlo (`callerPolicy`). Se propone mantener por ahora «un flujo no ejecuta otro» (D-44): las
cadenas van por datos, a la vista y con tope (§4.3). Es la decisión 8.

## 5. ¿Se puede hacer bien, y que aguante?

Sí, con lo que ya hay como base: el plan como lenguaje cerrado, la política como función pura y el diario. Lo que no
deja de ser código, a propósito: el suelo de seguridad, el intérprete, los protocolos (IMAP, iCal, Enable Banking), la
caja y el almacén (`extensiones.md` §2, capas 0 y 1); y las instrucciones fijas de las lectoras, que se evalúan antes
de cambiar (`preferencias.md`, clase 1; lo de Juan va en su guía). Lo demás (el orden, las condiciones, los
parámetros, a dónde va cada cosa, qué botón lanza qué) pasa a ser dato. Los riesgos, y cómo se cubre cada uno:

| Riesgo | Cómo se cubre |
|---|---|
| Juan rompe lo que hace un flujo de Boni al cambiarlo (no lo que se le permite: la política no es un paso) | Versiones, «Volver al de Boni», la lista de comprobación y «Probar» comparando con la versión que corre sobre ejemplos de verdad; los candados por paso, después |
| Bucles entre flujos que se disparan por colecciones | Los ciclos se ven en el mapa antes de encender; 3 eslabones por cadena; un flujo no se repite en su cadena; un tope por minuto con su línea en el log |
| Lentitud con su volumen (A-15) | El mapa se calcula al cambiar flujos, páginas o el esquema, y se guarda; los números salen de las sumas de la auditoría que ya existen (`recentActivity`); un disparador por colección se busca en un índice de qué flujo escucha qué colección, sin leer colecciones |
| El mapa miente si una referencia se decide al ejecutar | Una colección es un literal o una de una lista literal; la lista de comprobación lo exige |
| El lenguaje de planes se queda corto para lo de Boni | Ya expresa la lectura del correo. Los seis «Crear» se vuelven uno («Crear en la elegida», con su colección de una lista literal): un cambio pequeño del lenguaje, y el mapa sigue sabiendo dónde puede escribir |
| Rehacer `mail.ts` (2.041 líneas) rompe el correo | Pieza a pieza, un PR por pieza, con las pruebas de `mail.test.ts` sin tocar, como en F1 |
| La paridad se pudre con el tiempo | La prueba de §4.1 en el CI: una acción sin control ni herramienta, o una ruta sin acción, no se fusiona |
| Boni sobre la pantalla hace algo que Juan no quería | La misma política; lo de «con su toque», siempre con su tarjeta; resalta lo que toca; Deshacer por turno |
| Una inyección en lo que hay en pantalla | El contexto lo arma el código; lo de fuera llega como asas |
| Coste | El mapa y el contexto de pantalla no llaman a modelos; el contexto se recorta (por ejemplo, 30 bloques y 50 filas) |

## 6. Cómo lo hacen otros (revisado el 2026-11-05)

- **n8n** (código leído hoy, commit `e87308e`; lo nuevo respecto a `flujos.md` §2):
  - El agente es un nodo con subnodos tipados debajo: el modelo (obligatorio), la memoria, las herramientas y el
    formato de salida (`NodeConnectionTypes`: `ai_languageModel`, `ai_memory`, `ai_tool`, `ai_outputParser`), y un
    agente puede ser herramienta de otro (`AgentToolV3`). → El paso «Agente» enseña su modelo, sus instrucciones y sus
    acciones como sus partes.
  - El disparador de chat (`ChatTrigger`): mensajes de bienvenida, título, sugerencias, incrustado en una página o
    público, seguir la sesión anterior, y el «Chat Hub» con nombre, icono y descripción de cada agente. → El
    disparador «Chat» del chat de una página y de Boni sobre la pantalla.
  - Subflujos: «Execute Workflow» llama a otro flujo con las entradas que declara su disparador
    (`ExecuteWorkflowTrigger`), y cada flujo dice quién puede llamarlo (`callerPolicy`). → Fuera por ahora (decisión
    8).
  - Lo que n8n no tiene: un mapa entre flujos. Cada flujo es su lienzo.
- **Home Assistant:** «Relacionado», en cada entidad, automatización o dispositivo, dice qué automatizaciones y
  scripts la usan. Sus usuarios cuentan su límite: no ve lo que pasa por una variable o una plantilla. → La regla del
  literal (§4.4).
- **dbt y Dagster:** el linaje se abre desde un nodo, con cuánto antes y cuánto después (`+modelo+`), nunca entero. →
  «En el centro» y «Profundidad».
- **Grafana y Metabase:** valores del panel, arriba, que filtran sus bloques (las variables de Grafana, los filtros
  enlazados a tarjetas de Metabase). → Los valores de una página.
- **Notion:** automatizaciones de base de datos (cuando se añade o se cambia una página) y botones con acciones;
  Notion AI abajo a la derecha, con `⌘J` y la página abierta como contexto. → Disparadores por colección, botones con
  acción, Boni sobre la pantalla.
- **Apple App Intents** (WWDC26, sesiones 240, 343 y 344): la app anota qué entidades hay en pantalla y dónde
  (`appEntityIdentifier`, `NSUserActivity`) y declara sus acciones como herramientas (`@AppIntent(.tool)`); Siri
  entiende «este mensaje» sin que se nombre. **WebMCP** (borrador del W3C, en prueba en Chrome desde la 146): una
  página registra sus herramientas (`navigator.modelContext.registerTool`) para que un agente las llame en vez de
  pulsar botones. → Boni sobre la pantalla: acciones declaradas y lo que hay en pantalla como datos.
- **VS Code:** cada cosa que se hace es un comando con su id, y los menús, los atajos y la paleta llaman a comandos. →
  La lista de acciones, y «Buscar» (`Ctrl+K`) como paleta.

## 7. Qué cambia en el código (cuando toque)

| Hoy | Después |
|---|---|
| 14 herramientas (`tools.ts`) y 76 rutas que cambian algo | La lista de acciones (el registro, ampliado); cada ruta llama a una acción; la web llama por id; las de pantalla, registradas en la web |
| `pipeline.ts` declarado a mano; «Flujos \| Modelos» | El mapa calculado; «Flujos» como colección con «Tabla \| Mapa»; A-16 pasa a comprobar que lo calculado cubre cada acción, lector y papel |
| `mail.ts`: traer, leer, reglas, hilo, «Aceptar solas», la revisora | El conector Correo; los flujos Traer correo, Leer correo y Revisar la guía; piezas de Boni |
| `mailPlan` genera seis «Crear» | «Leer correo» guardado como datos, con «Crear en la elegida» |
| El turno de la conversación (`agent.ts`) | El flujo «Conversación»: el mismo código, descrito con sus piezas |
| El manifiesto de una extensión (`flows`, `routes`, `ui`) | Un paquete: la lista de sus piezas (flujos, colecciones, conectores, funciones) y lo que pide |
| `catalogue.ts`: un botón que abre «Apuntar gasto» | Botones con acción o flujo; valores de página y el bloque «Control»; `data-boni-ref` en cada componente |
| La conversación en su pantalla | La ventana y el círculo (C4, C7), el contexto de pantalla, señalar y resaltar |

## 8. Fases

Siguen a las de `flujos.md`. Cada una está «en main» al fusionarse con el CI en verde, y «hecha» cuando Juan la prueba
con sus datos (`AGENTS.md`, paso 4).

| Fase | Qué | Criterio de hecho (lo que verá Juan) |
|---|---|---|
| F7 Lo de Boni, a la vista (la 83; primera parte en main el 2026-11-05: «Leer correo» con sus piezas como pasos, A-19 y D-47, el disparador con nombres de persona, el lienzo encajado al abrir y «Probar con…»; el 2026-11-06, las piezas con nombres de verbo, «Regla del remitente», «Ya propuesto», «Leer invitación», «Buscar relaciones», y «Probar» diciendo lo que encontró cada una; «Crear en la elegida» el 2026-11-06 (la colección con `case`, D-48: una «Rellenadora» y un «Crear» para todo lo que lee la Lectora y el de la invitación aparte, D-49, y el panel de la Decisora con sus colecciones y las reglas de la guía: «Leer correo» pasa de 27 pasos a 12; y lo que dejó la revisión de la primera parte: «Buscar relaciones» en su orden, los ajustes de las piezas en su panel, su clase en la tarjeta y el disparador que dice que viene del conector Correo, salvo «Bandeja» como paso, las preguntas por paso y «Probar» comparando con la versión que corre); «Traer correo» (D-50) y «Revisar la guía» (D-51) como flujos de Boni; el 2026-11-11, «Aviso del presupuesto» (D-53), con su flecha «avisa» a «Dispositivos» en el mapa, y cuándo y cuánto aprende «Revisar la guía» como ajustes del flujo, con el techo del código (D-54; «Aprender» sin flujo propio, decidido por Juan); «Conversación» queda para F11) | Los flujos de Boni de §4.2 con sus piezas; «Leer correo» con «Crear en la elegida»; el disparador con nombres de persona; el lienzo encajado al abrir | En «Flujos», «Leer correo» enseña cada paso que corre hoy; Traer correo, Revisar la guía y Aviso del presupuesto son flujos con su disparador; el correo se lee igual (las pruebas de `mail.test.ts` sin cambios); la lectura de uno de sus correos se ve paso a paso |
| F8 El mapa (la 84; en main y hecha el 2026-11-06: Juan la probó con sus datos, «bastante bien lo que veo», y lo que vio fue a la 90, en main el mismo día: el Recorrido es el mapa, el camino en naranja desde el disparador, un nombre por paso, «Profundidad», las llamadas y el coste de cada paso. En la 84: «Flujos» como colección con «Tabla \| Mapa», el mapa calculado con en el centro, antes y después, agrupar, filtros y periodo, una ejecución encima con su camino por el mapa, «¿De dónde viene?» desde una fila, la Bandeja como nodo con «aceptadas» y la revisora en el camino del correo, «Ver en el mapa» en los menús (el de una tarjeta de la Bandeja, «Recorrido» desde la 90), fuera «Modelos» y `pipeline.ts`; además el lienzo de un flujo que se ordena solo, I-26, y «Flujos» en el teléfono para mirar y ejecutar. El 2026-11-11 (la 83, en main; hecha cuando Juan la pruebe): «Dispositivos» y la flecha «avisa», lo que avisan los flujos y la conversación, salvo marcar «de fuera» por las etiquetas de cada aviso. Faltan, según la revisión independiente: el disparador, el modelo, el bloque y el botón como nodos propios; lo de fuera marcado por sus etiquetas y no por de dónde arranca el flujo; el conector y el paquete «Correo» leídos de la extensión y no escritos en el código; «Ver en el mapa» en un turno (con F9); y el mapa entero al abrirlo, que §4.4 no quería: se dejó así por «un solo flujo donde se ve todo y vamos agrupando, filtrando», y Juan decide) | El grafo calculado; «Flujos» como colección con «Tabla \| Mapa»; en el centro, antes y después, agrupar y filtros; una ejecución encima; «Ver en el mapa» en los menús; fuera «Modelos» y `pipeline.ts` | Clic derecho en Tarea → quién la escribe, con sus números; «¿Qué pasa cuando llega un correo?» enseña el camino hasta la Bandeja y la revisora |
| F9 Boni sobre la pantalla (la 85; primera parte en main el 2026-11-06: el círculo, `Ctrl+E`, la ventana y la pantalla como datos, A-20; segunda, «Abrir» resaltando, I-30; tercera, el 2026-11-10: Señalar bloques, filas y tarjetas con un clic o arrastrando, las fichas, la consulta y las cifras de lo señalado y el borrador que no se pierde, A-21 e I-31; faltan señalar nodos y párrafos de una nota, `data-boni-ref` en lo que no se señala, las demás acciones de pantalla y lo demás de «Falta» en §4.7) | El círculo y `Ctrl+E`; la ventana (C4); `data-boni-ref` y el contexto de pantalla; señalar; las acciones de pantalla; resaltar. Con las herramientas de hoy | Con la Bandeja abierta, «¿qué me pide el de arriba?» contesta sobre esa tarjeta; señalando una gráfica, Boni sabe cuál es; «ábreme Agenda» la abre |
| F10 Una lista de acciones (la 86; adelantada el 2026-11-06 una: «¿De dónde viene?», en el menú de una fila, en la conversación con `entities.origin` e `inbox.pending` y en el MCP con `origin` e `inbox`) | Por áreas (datos, páginas y vistas, Bandeja, flujos, calendarios, conectores), cada una a la vez en la app, en «Añadir paso», en Boni sobre la pantalla y en el MCP; la prueba de paridad | «Hazme una página Gastos con el gasto por categoría» la hace, con Deshacer; «acepta estas dos» pinta su tarjeta. **En main la primera parte** (registro por áreas, páginas y vistas, Bandeja, la prueba de paridad; §4.1 «Lo que hay»); quedan flujos y datos, y calendarios y conectores |
| F11 Páginas conectadas (la 87) | Valores y el bloque «Control»; botones con acción o flujo; enlaces con valores; el chat de la página (la 79, C5) | En Gastos, cambiar Categoría cambia las gráficas; en su chat, «¿cuánto gasté en restaurantes en octubre?» pone los valores y contesta con la cifra |
| F12 Disparadores por colección (la 88) | «Cambia una colección»; los topes; lo que puede hacer solo (decisión 5) | «Cuando se crea un movimiento de más de 100 €, avísame» llega una vez por movimiento; un ciclo no se puede encender |
| F13 Paquetes (la 89) | Las extensiones pasan a paquetes; la Conciliación (E4b, C6) como el primer paquete nuevo | En el mapa, «De Correo» agrupa su conector, su colección y sus tres flujos; Ajustes → Extensiones ya no está |

## 9. La cola, adaptada (aplicada en Boni el 2026-11-05)

| Tarea | Qué le pasa |
|---|---|
| 2f, 2g, 2h (el editor de texto) | Nada; siguen en espera |
| 3 Extensiones (E1–E5) | E1–E3 se quedan como son (la caja, las funciones, proponer por el MCP); E4b/C6 y E5 pasan a F13. Fundida en la 89 |
| 4 Interfaces (Fechable, Completable, Importe) | Nada; sus papeles son los que usa el mapa para «¿qué crea eventos?» |
| 4b Bancos | Su «extensión preset `bancos`» pasa a ser el conector Bancos y el flujo «Traer del banco»; su decisión pendiente (§4.3, la colección «Banco») sigue |
| 9 Gráficas y atajos v1 | Fundida en la 87 (F11): los atajos de la v1 pasan a ser botones con acción |
| 11 El Diseñador de páginas | Después de F10: con las acciones de páginas, el planificador ya hace páginas; queda su revisión |
| 27 Conversación (C4, C3, C1) | C4 pasa a la 85 (F9); la 27 sigue con C3 y lo que falta de C1 |
| 59 «Mis datos» y «Modelos» | «Modelos» lo sustituye la 84 (F8); lo de «Mis datos» (el diagrama, D-40) sigue y es lo que Juan prueba |
| 61 Flujos F1–F6 | Nada; sigue esperando la prueba de Juan (el resumen de las 8, el diagrama de su Agenda); F7–F13 la continúan |
| 62 Avisos con la app cerrada | Nada |
| 63 Lo que piden los diseños | Los puntos 1, 2 y 14 pasan a F8; el 6, a F7; el 12, a F11; el 13, a F10; el 11, a F13; el resto sigue |
| 64 Que lo hecho cumpla el diseño | Nada; se aplica a F7–F13 |
| 66 Puntos numerados | Los puntos de este diseño se numeran al empezar cada fase (F7, la primera), con una prueba pendiente por punto (las medidas A y B de la 64) |
| 68, 69, 72, 77 (en main) | Nada; la 77 gana «Ver en el mapa» en su clic derecho con F8 |
| 70 El editor de flujos | Gana un punto: el lienzo no encaja al abrir (visto el 2026-11-05) |
| 71 Los correos de más | Nada (`entities.search` es una acción más) |
| 73 La Bandeja vuelve a comprobar | Nada; su decisión sigue pendiente |
| 75, 76 Filtros avanzados y menú de columna | Nada; los filtros de la 75 son los que usarán los valores de página y los disparadores por colección |
| 79 El chat dentro de una página (C5) | Fundida en la 87 (F11), detrás de la 85 (necesita la ventana); su diseño cambia: es un flujo con disparador «Chat» |
| 80 Nombre desde la lista y guardar solo | Su decisión sigue pendiente; el nombre desde la lista llega solo con «Flujos» como colección (F8) |
| 81 El círculo y la voz (C7) | El círculo pasa a la 85 (F9); la 81 se queda con la voz |

**Orden** (decisión 9): la 83 (F7) → la 84 (F8) → la 85 (F9) → la 86 (F10, por áreas) → la 27 (C3, C1) → la 87
(F11, con la 79 y la 9) → la 76, la 75 y la 71 → la 88 (F12) → la 89 (F13, con la 3) → la 66, lo que queda de la 63,
la 4, la 4b, la 11 y la 81 (la voz) → la 2g, la 2h y la 2f.

## 10. Decisiones de Juan (2026-11-05: «Las recomendadas»)

Juan eligió las nueve recomendadas, y en la 7, en vez de `Ctrl+J`, «una letra cercana a la mano izquierda (q w e a s d
z x c), la que tú veas mejor»: `Ctrl+E` (§4.7). Cada una, con el resultado de la recomendada primero.

1. **Una lista de acciones para la app, la IA, los flujos y el MCP** (§4.1).
   - Recomendada: sí, con lo de «con su toque» y «solo él, en su sitio». Juan dice «hazme una página Gastos con el
     gasto por categoría» y la tiene, con Deshacer; dice «acepta estas dos» y le sale una tarjeta [Aceptar las 2].
   - La otra: añadir herramientas a la IA según se pidan. «Hazme una página» seguiría sin poder hasta que alguien
     añada esa herramienta, y la paridad no la comprobaría nadie.
2. **Los flujos de Boni, a la vista y editables desde ya** (§4.2).
   - Recomendada: editables, con versiones, «Volver al de Boni» y «Probar» que compara; los candados por paso, más
     adelante. Juan quita «Plegar hilo» de «Leer correo»: la lista de comprobación avisa, «Probar» con los 40 últimos
     dice «3 propuestas repetidas más», guarda, y vuelve con un clic si no le gusta.
   - La otra: de solo lectura hasta tener los candados. Lo ve todo, pero no puede quitar «Plegar hilo».
3. **Una sola sección, «Flujos», con el mapa** (§4.4).
   - Recomendada: «Flujos» como colección con «Tabla | Mapa»; «Modelos» desaparece (su configuración sigue en Ajustes
     → Modelos y sus números, en los pasos). Una sola entrada en la barra lateral.
   - La otra: «Mapa» como sección aparte, junto a «Flujos» (la lista y el editor). Dos entradas en la barra lateral
     para lo mismo visto de dos formas.
4. **Las extensiones pasan a paquetes** (§4.5).
   - Recomendada: la palabra sale de la app; cada pieza en su sitio; un paquete se ve como grupo en el mapa, como
     tarjeta al proponerlo o activarlo y con sus ajustes en Ajustes con su nombre (Ajustes → Correo, como hoy).
     Ajustes → Extensiones desaparece.
   - La otra: «Extensiones» como sección propia de la barra lateral, con una página por extensión (lo que decía
     `conversacion.md` §3.3). El correo seguiría en dos sitios: su página de extensión y sus flujos.
5. **Disparadores por cambios en una colección, y lo que pueden hacer solos** (§4.3).
   - Recomendada: sí, con los topes; un flujo de Juan disparado por sus propios datos escribe con Deshacer y avisa, y
     lo que viene de fuera sigue proponiendo. «Cuando marco hecha una tarea que se repite, crea la de la semana
     siguiente»: se crea y llega un aviso con Deshacer.
   - La otra: sí, pero siempre proponiendo (P7 como hoy): una tarjeta en la Bandeja cada vez que marca una.
6. **Valores de página** (§4.6).
   - Recomendada: valores con nombre en cada página, guardados con ella, que sus bloques usan en sus filtros y sus
     enlaces pasan a otra. En Gastos, Categoría y Mes arriba; el chat los cambia.
   - La otra: un formulario que guarda un registro en una colección y gráficas que leen el último. Funciona entre
     páginas sin enlaces, pero cada cambio de filtro es un registro nuevo en sus datos.
7. **Boni sobre la pantalla: los atajos y lo que ve** (§4.7).
   - Recomendada: el círculo y `Ctrl+E`; señalar con `Ctrl+Shift+E`; ve la pantalla como datos, sin capturas por
     ahora.
   - La otra: con capturas desde el principio (con lo cerrado tapado): entiende también el aspecto («esto se ve
     raro»), pero cada mensaje cuesta más, tarda más y manda una imagen de su pantalla al proveedor del modelo.
8. **Agentes que se hablan** (§4.8).
   - Recomendada: solo por datos, a la vista en el mapa; un flujo no llama a otro (D-44 sigue).
   - La otra: subflujos, como en n8n: «Resumen diario» llama a «Resumen del correo» con sus entradas, y cada flujo
     dice quién puede llamarlo. Más cómodo para componer; más difícil de seguir, y con más formas de encadenar lo de
     fuera.
9. **El orden** (§9).
   - Recomendada: F7 → F8 → F9 → F10, como en §9: primero ver y depurar, luego Boni sobre la pantalla con lo de hoy, y
     la lista de acciones haciéndolo capaz de todo.
   - La otra: F9 primero («quiero que metamos ya el chat de Boni superpuesto»): Boni sobre la pantalla antes, pero lo
     de Boni seguiría sin verse hasta F7 y F8.

## 11. Principios que entrarían (cada uno con su prueba, en el PR de su fase)

- **D-41, ampliado:** la lista de acciones es una para la app, los flujos, el planificador y el MCP; cada acción tiene
  su control y su herramienta, o está en la lista de lo que solo decide Juan, con su porqué; una ruta que cambia datos
  llama a una acción (F10).
- **A-16, sustituido:** el mapa de Boni se calcula de los flujos, las páginas, los conectores y la auditoría; nada se
  declara a mano (F8).
- **Nuevo (D):** todo lo que Boni hace solo es un flujo de Boni que se ve en el mapa; una pieza de código es un paso,
  con sus entradas, su salida y sus ajustes (F7).
- **Nuevo (D):** la colección en la que lee o escribe un paso es un literal o una de una lista literal (F7, F8).
- **Nuevo (A):** una cadena de flujos por datos tiene tope, y un flujo no se repite en ella (F12).
- **Nuevo (I):** «Ver en el mapa» está en el clic derecho de todo lo que el mapa conoce (F8).
- **Nuevo (I):** Boni sobre la pantalla ve datos y no píxeles, sin lo cerrado a la IA, y actúa con las acciones de la
  app, nunca con clics simulados (F9).
