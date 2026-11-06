# Boni como un sistema de flujos: todo lo que hace, a la vista; las mismas acciones para todos; Boni sobre la pantalla

**Decidido por Juan el 2026-11-05: «Las recomendadas»** (las nueve de §10), con un cambio: el atajo de Boni sobre la
pantalla es `Ctrl+E`, no `Ctrl+J` (§4.7). Las fases F7 a F13 son las tareas 83 a 89 (§8): la primera parte de F7 está
en main desde el 2026-11-05 y F8 (el mapa) desde el 2026-11-06 (§4.4, «Cómo quedó»).

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
| El Recorrido | `trace.ts`, D-39, F3 | Una ejecución paso a paso, pintada sobre el lienzo de su flujo |
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

### 4.2 Todo lo que Boni hace solo es un flujo

Un **flujo de Boni** (hoy `by: "preset"`) es un flujo como los de Juan: se ve en el mapa, se abre en el editor y tiene
versiones y «Volver al de Boni». Los de hoy, con su disparador:

| Flujo | Disparador | Pasos que se verían | Hoy, en el código |
|---|---|---|---|
| Traer correo | Cada 5 minutos | Buzón (pieza: carpeta, cada cuánto) → guardar en Correos, con sus adjuntos, el original, la invitación y el hilo | `Mails.start` |
| Leer correo | Llega un correo | Reglas de la guía → Lo pendiente del remitente → Invitación → Lectora → Decisora → Rellenadora → Relaciones → Crear en la elegida → Plegar hilo → Bandeja → Aceptar solas | `mailPlan` y el código de alrededor |
| Revisar la guía | 20 decisiones nuevas o «Revisar ahora»; una vez al día como mucho | Reglas que ya muestran sus correcciones (pieza) → Revisora → Medir releyendo (45 al día) → Sugerencia | `mailReview.ts` |
| Aprender | Las decisiones de Juan | Señales → Sugerencia o «Solo» | `learning.ts`, `autoAccept.ts` |
| Conversación | Un mensaje de Juan | Contexto (historial, memoria, colecciones, pantalla) → Agente → el plan que escribió → Respuesta | `agent.ts` |
| Aviso del presupuesto | El gasto en IA del mes pasa del aviso | Avisar | `agent.ts` |
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
| Algo de Boni | 20 decisiones nuevas | Segundo plano | Código (la revisora) |

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
| Conector, colección, disparador, flujo (plegado o con sus pasos), modelo, página, bloque, botón, la Bandeja, Juan, los asistentes | trae, pone en marcha, lee, escribe, propone, acepta, pinta, controla |

Lo que viene de fuera va marcado en la flecha que lo lleva (lo dicen las etiquetas, `nucleo.md` §4.2): se ve por dónde
viaja el texto de un correo y dónde deja de ser una propuesta para ser un dato de Juan.

**Cómo se abre.** Siempre desde algo, nunca entero: con 22 colecciones y una docena de flujos, entero no se lee.

- **En el centro:** lo que se elija, con un buscador o con el clic derecho → «Ver en el mapa» desde cualquier sitio.
- **Antes y después:** 1, 2 o todo, como el linaje de dbt o de Dagster.
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
botón, una tarjeta de la Bandeja, un flujo y un turno de la conversación.

**Para que el mapa no mienta** (lo que le pasa a «Relacionado» de Home Assistant, que no ve lo que pasa por una
variable): la colección en la que lee o escribe un paso es un literal, o una de una lista literal («Tarea o Evento»).
La lista de comprobación avisa de lo demás antes de encender.

**Ejemplos.**

- «¿Qué pasa cuando llega un correo?»: Correo (conector) → Correos → Leer correo (con sus pasos) → Bandeja → Juan
  acepta → Tarea y Evento; y, en vuelta, Juan → sus decisiones → Revisar la guía → la guía → Leer correo. Cada nodo
  con sus números de la semana.
- Clic derecho en la colección Evento → «Ver en el mapa», «Antes: 1»: Leer correo (propone, 23), Conversación (crea,
  4), Boni Calendar (Juan, 61), Claude por el MCP (2).
- Clic derecho en una tarea → «¿De dónde viene?»: el correo, la lectura que la propuso (Leer correo v3), lo que
  contestó cada modelo y el «Aceptar» de Juan.

**Cómo quedó (F8, 2026-11-06).** Lo que se decidió al hacerlo, para que se pueda discutir:

- **El disparador va en el flujo**, no es un nodo aparte: la tarjeta del flujo lo dice («Llega a Correos», «Cada día a
  las 08:00», «Disparado por el usuario») y «Agrupar por disparador» enmarca los flujos que comparten uno. Un nodo
  más por flujo duplicaba lo que ya dice la flecha «pone en marcha».
- **La Bandeja va en las flechas**: lo que un flujo en segundo plano escribe es «propone · 8», discontinua (espera en la
  Bandeja); el panel del flujo dice cuántas aceptó Juan. Así «Antes: 1» de una colección enseña quién la escribe, como
  en el ejemplo de Evento, y no la Bandeja.
- **Los modelos van en los pasos**: cada flujo dice sus modelos y lo que costaron en el periodo; desplegado, cada paso
  que piensa dice su modelo. Lo que no es flujo todavía (la conversación, la revisora de la guía) son nodos de Boni con
  sus números del diario, hasta que F7 los haga flujos.
- **Lo que no es de nadie no sale**: sin centro, el mapa enseña lo que está unido a algo; una colección sola sale al
  ponerla en el centro. Las páginas, con «Con páginas» (con 20 páginas tapaban el resto).
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
  «En el centro», «Antes» y «Después».
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
| F7 Lo de Boni, a la vista (la 83; primera parte en main el 2026-11-05: «Leer correo» con sus piezas como pasos, A-19 y D-47, el disparador con nombres de persona, el lienzo encajado al abrir y «Probar con…»; el 2026-11-06, las piezas con nombres de verbo, «Regla del remitente», «Ya propuesto», «Leer invitación», «Buscar relaciones», y «Probar» diciendo lo que encontró cada una; faltan «Crear en la elegida» y los demás flujos de Boni: Traer correo, Revisar la guía, Aprender, Conversación, Aviso del presupuesto) | Los flujos de Boni de §4.2 con sus piezas; «Leer correo» con «Crear en la elegida»; el disparador con nombres de persona; el lienzo encajado al abrir | En «Flujos», «Leer correo» enseña cada paso que corre hoy; Traer correo y Revisar la guía son flujos con su disparador; el correo se lee igual (las pruebas de `mail.test.ts` sin cambios); la lectura de uno de sus correos se ve paso a paso |
| F8 El mapa (la 84; en main el 2026-11-06: «Flujos» como colección con «Tabla \| Mapa», el mapa calculado con en el centro, antes y después, agrupar, filtros y periodo, una ejecución encima de su flujo, «Ver en el mapa» en los menús, fuera «Modelos» y `pipeline.ts`; además el lienzo de un flujo que se ordena solo, I-26, y «Flujos» en el teléfono para mirar y ejecutar. Faltan, según la revisión independiente: «¿De dónde viene?» desde una fila, que necesita que aceptar una propuesta guarde la ejecución que la propuso; el camino de una ejecución más allá de su flujo; el disparador, el modelo, la Bandeja, el bloque y el botón como nodos propios, y la flecha «acepta»; lo de fuera marcado por sus etiquetas y no por de dónde arranca el flujo; las llamadas y el coste de cada paso; el conector y el paquete «Correo» leídos de la extensión y no escritos en el código; «Ver en el mapa» en un turno y con el clic derecho en una tarjeta de la Bandeja; y el mapa entero al abrirlo, que §4.4 no quería: se dejó así por «un solo flujo donde se ve todo y vamos agrupando, filtrando», y Juan decide) | El grafo calculado; «Flujos» como colección con «Tabla \| Mapa»; en el centro, antes y después, agrupar y filtros; una ejecución encima; «Ver en el mapa» en los menús; fuera «Modelos» y `pipeline.ts` | Clic derecho en Tarea → quién la escribe, con sus números; «¿Qué pasa cuando llega un correo?» enseña el camino hasta la Bandeja y la revisora |
| F9 Boni sobre la pantalla (la 85) | El círculo y `Ctrl+E`; la ventana (C4); `data-boni-ref` y el contexto de pantalla; señalar; las acciones de pantalla; resaltar. Con las herramientas de hoy | Con la Bandeja abierta, «¿qué me pide el de arriba?» contesta sobre esa tarjeta; señalando una gráfica, Boni sabe cuál es; «ábreme Agenda» la abre |
| F10 Una lista de acciones (la 86) | Por áreas (datos, páginas y vistas, Bandeja, flujos, calendarios, conectores), cada una a la vez en la app, en «Añadir paso», en Boni sobre la pantalla y en el MCP; la prueba de paridad | «Hazme una página Gastos con el gasto por categoría» la hace, con Deshacer; «acepta estas dos» pinta su tarjeta |
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
