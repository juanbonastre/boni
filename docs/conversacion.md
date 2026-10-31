# La conversación con Boni

Propuesta (2026-10-31), a raíz de la maqueta de la conciliación (E4b, `docs/extensiones.md` §11.6). Juan la aprobó el
mismo día con tres aclaraciones, ya incluidas: el historial se ve como en otras IA (§3.1), agrupar las preguntas o
hacerlas de una en una depende de lo segura que esté Boni (§3.4), y los asistentes no son un concepto aparte: son el
modo de conversación de una extensión (§3.3).

Amplía `docs/nucleo.md` §7 (el agente), y en `docs/extensiones.md` el Lienzo (§6), el asistente que
ve la pantalla (§8) y los papeles de modelo (§9). Ninguna regla de `docs/principios.md` cambia: el modelo sigue
planeando y el código sigue decidiendo (A-01).

## 0. Resumen

Hoy la conversación es una pantalla con un historial que se pierde al reiniciar el servidor, y un turno solo se ve
cuando ha acabado. La propuesta la hace la pieza central de Boni:

- **Las conversaciones se guardan** en el almacén de Juan, con su lista, su historial y Deshacer por turno.
- **Cada turno se ve mientras ocurre:** los pasos y lo que piensa, y se puede parar.
- **Siempre hay una barra para escribir,** aunque Boni esté enseñando tarjetas con opciones.
- **Una misma conversación se ve en varias superficies:** una ventana flotante, el panel de la derecha, la pantalla
  Conversación, un bloque en una página, el móvil y, más adelante, la voz.
- **Una extensión puede traer su modo de conversación:** instrucciones, bienvenida, botones de inicio y sus
  herramientas. No hay un concepto aparte de «asistente» (§3.3).

La conciliación (E4b) pasa a ser la primera extensión con modo de conversación.

## 1. Lo que enseñó la maqueta

La segunda maqueta preguntaba de una en una con tarjetas, y Juan encontró sus límites (2026-10-31):

- **Una tarjeta cerrada no lo prevé todo.**
  - En «¿en qué categoría va?» no se podía crear una categoría.
  - En el reembolso, fuera de las opciones solo había «Luego»: no había manera de explicarlo con sus palabras.
  - Con las reglas, solo se podía crear las marcadas o ninguna. Faltaba poder cambiar una regla, decir que algo es
    esporádico y no lleva regla, o pedir una regla más general.
- **Hace falta un chat de verdad.** Con una barra donde escribir cualquier cosa aunque haya tarjetas, siempre se puede
  decir algo que no está entre las opciones. Además, son los cimientos de un Boni manejado por voz en tiempo real.
- **El historial guardado** permite volver atrás, ver qué se dijo y corregir: «antes te he dicho X, pero es Y».
- **La conciliación no debe ocupar el sitio de la Bandeja,** que es otra cosa. Mejor una ventana de chat que aparece
  dentro de Boni con una animación agradable: un mensaje breve para empezar, el botón «Subir extracto», la barra de
  escribir y poder arrastrar el archivo. La ventana se puede ampliar a la pantalla Conversación o llevar a la derecha.
- **Un bloque de página que sea un chat ya preparado,** con sus instrucciones, su bienvenida y su botón.
- **Más adelante, el chat universal:** un círculo abajo a la derecha, como Notion AI, y un widget en el escritorio.
  «Quiero añadir los extractos del mes», escrito o dicho por voz, abre esa misma ventana.
- **El chat de hoy necesita:**
  - ver lo que piensa, con los pasos que sigue y una animación a su izquierda;
  - el botón dentro de la barra (hoy hay unas rayas abajo, junto al botón: es el asa de cambiar el tamaño del área de
    texto, que deja el navegador);
  - poder interrumpir;
  - tener varios chats;
  - poder cambiar de modelo.

## 2. Cómo lo hacen otros (revisado el 2026-10-31)

| Quién | Cómo | Lo que tomamos |
|---|---|---|
| ChatGPT, Claude, Gemini | Lista de chats con búsqueda; el turno llega a trozos, con el razonamiento resumido y plegable («pensó durante 8 s»); botón de parar dentro de la barra; selector de modelo; editar un mensaje y volver a generar desde ahí | La forma del chat: lista, turno en vivo, parar, modelo, corregir |
| GPTs (ChatGPT), Gems (Gemini), Custom Agents (Notion) | Un asistente es un chat preconfigurado: instrucciones, conocimiento, herramientas y frases para empezar. En Notion, un botón puede mandar un mensaje a un agente, y un agente puede ir incrustado en una página como caja de chat que, al escribir, abre su ventana ([Notion Agent](https://www.notion.com/help/notion-agent)) | El modo de conversación de una extensión (§3.3) y el bloque «Chat» de una página |
| Notion AI | Una cara abajo a la derecha en todas las páginas abre el chat. Se elige verlo flotante o a la derecha, y desde la barra lateral pasa a pantalla completa. Usa la página abierta como contexto | Las superficies (§3.2) y el contexto de la pantalla (`extensiones.md` §8) |
| MCP Apps (estándar abierto desde enero de 2026; Claude y ChatGPT) | Una herramienta devuelve una interfaz que se pinta dentro de la conversación. Lo que se pulsa vuelve como llamada a una herramienta o como mensaje ([MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/), [WorkOS](https://workos.com/blog/2026-01-27-mcp-apps)) | La idea, sin su forma: ellos pintan HTML ajeno en un iframe; Boni pinta solo componentes de su catálogo, como el Lienzo (§3.4) |
| ChatKit (OpenAI) | Widgets declarados en JSON (tarjeta, lista, botón, formulario, selector, fecha); sus acciones llegan al servidor sin que el usuario escriba. Avisan del riesgo de las acciones viejas: pulsar «Confirmar» en una tarjeta de hace cuatro mensajes ([ChatKit widgets](https://developers.openai.com/api/docs/guides/chatkit-widgets)) | Tarjetas declarativas, y que el código vuelva a comprobar una tarjeta vieja antes de actuar |
| Claude Code (`AskUserQuestion`) | Cada pregunta con opciones trae siempre una opción «Otra» para escribir la respuesta | La regla de §3.4: hay una salida libre donde tenga sentido |
| Vercel AI SDK | Las llamadas a herramientas se pintan como componentes, y las peligrosas esperan el visto bueno del usuario | El ciclo herramienta → tarjeta → respuesta, con la política de Boni en medio |
| OpenAI Realtime, Gemini Live | Voz en tiempo real con herramientas: se puede interrumpir a mitad de frase, y la conversación es la misma que la escrita | §3.7: la voz es otra forma de entrada a la misma conversación |

Lo que no tomamos:
- Pintar HTML ajeno, aunque vaya en un iframe (`nucleo.md` §7.14).
- Que el modelo llame a herramientas directamente: en Boni el modelo escribe un plan y el código lo interpreta (§7.2).
- Ramificar la conversación al editar un mensaje (las flechas «1/2» de ChatGPT). Una corrección es un turno nuevo que
  deshace y rehace (§3.1): así lo que pasó queda en el registro, y la cuenta de dinero no queda con dos versiones de
  la historia.

## 3. La estructura

### 3.1 Las conversaciones son datos

- **Lo que ve Juan.** La pantalla Conversación es como la de ChatGPT, Claude o Gemini:
  - a la izquierda, el historial de conversaciones, con «Nueva conversación», un buscador y la lista por fechas (hoy,
    ayer, los últimos 7 días, antes);
  - a la derecha, la conversación abierta.

  Cada conversación tiene su título, que Boni pone a partir del primer mensaje y que Juan puede cambiar.
- **Dónde se guardan.** «Almacén» es la base de datos de la cuenta de Juan en Boni, donde ya están todas sus
  colecciones. No es el navegador ni el dispositivo. Dos tipos de sistema en el almacén del usuario (D-02):
  - `conversation`: título, la extensión en cuyo modo está (si lo está), modelo elegido, creada, última vez,
    archivada.
  - `turn`: la conversación, lo que dijo Juan, la ejecución (`run`), las respuestas pintadas como componentes con sus
    etiquetas (como ya las guarda el agente en memoria, §7.3) y la tarjeta que quedó esperando.

  Se exportan y se auditan como todo lo demás. Por eso el historial no se pierde al reiniciar, y Juan lo ve en el
  portátil y en el móvil. No salen entre las colecciones: se ven en su pantalla.
- **Lo que recibe el planificador del historial.** Los últimos turnos de esa conversación, pasados por
  `toPlannerView`, igual que hoy. Lo de fuera sigue llegando como asas (§7.3).
- **Corregir, sin versiones paralelas.**
  - Si Juan cambia un mensaje antiguo, Boni no crea una conversación paralela, como hace ChatGPT con sus flechas «1/2».
    Lo trata como una corrección: deshace lo que hizo aquel mensaje y lo rehace con lo nuevo, y las dos cosas quedan en
    el historial.
  - Cada turno tiene su ejecución, así que «Deshacer este turno» sigue siendo un clic.
  - Además, un mensaje de Juan se puede **editar**. Eso crea un turno de corrección que lleva el turno original y lo
    nuevo. El planificador lo convierte en deshacer lo afectado (`runs.undo`, por la política) y rehacer con el dato
    bueno.
  - «Antes te he dicho X, pero es Y», escrito tal cual, hace lo mismo: el turno anterior está en el historial, con su
    ejecución.
- **Varios chats.** «Conversaciones» en la barra lateral: buscar, fijar, cambiar el nombre, archivar (a la papelera).
  Una conversación nueva empieza vacía; la de un modo de extensión empieza con su bienvenida.

### 3.2 Un motor, muchas superficies

Una conversación es la misma esté donde esté; la superficie solo cambia cómo se ve:

| Superficie | Cuándo | Cómo |
|---|---|---|
| **Ventana flotante** | Desde un botón, un bloque o el círculo de Boni | Sale del botón que la abrió: crece y aparece en unos 200 ms; sin animación si el sistema pide movimiento reducido. Se mueve, admite archivos arrastrados y se puede minimizar al círculo |
| **A la derecha** | «Llevar a la derecha» en la ventana | Ocupa la columna de la derecha. **No sustituye a la Bandeja:** son dos cosas, cada una con su botón, y se puede pasar de una a otra |
| **Pantalla Conversación** | «Ampliar» en la ventana | La conversación entera, con la lista de chats al lado |
| **Bloque «Chat» en una página** | Una conversación centrada en una extensión (§3.3) | Su bienvenida, sus botones y la barra. Al escribir o pulsar, se abre la ventana con esa conversación, como los agentes incrustados de Notion |
| **Móvil** | Las mismas entradas | Pantalla completa, con la barra abajo |
| **Círculo de Boni** (más adelante) | En todas las pantallas y como widget del escritorio, con su atajo | Abre la última conversación o una nueva. Es el «botón abajo a la derecha» de `extensiones.md` §8, con el contexto de la pantalla |
| **Voz** (más adelante) | Desde el círculo | §3.7 |

### 3.3 Sin «asistentes» aparte: el modo de conversación de una extensión

Juan (2026-10-31): el sistema tiene que ser claro, con un modelo mental sencillo, y Juan tiene que tener el control de
lo que pasa. Una colección de asistentes se solaparía con las extensiones. Por eso hay solo tres conceptos:

| Concepto | Qué es | Dónde se ve |
|---|---|---|
| **Boni** | Un solo asistente, siempre el mismo | El círculo, la pantalla Conversación |
| **Extensiones** | Lo que Boni sabe hacer además de lo básico: el Correo, la Conciliación… | Su sección propia |
| **Conversaciones** | Lo que Juan habla con Boni, a veces centrado en una extensión | El historial (§3.1) |

- **El modo de conversación de una extensión.** Una extensión puede traerlo en su manifiesto:
  - sus **instrucciones** para el modelo (texto que se lee en su página);
  - su **bienvenida**;
  - sus **botones de inicio**, como «Subir extracto» o «Cerrar el mes». Cada botón es una acción del catálogo (subir un
    archivo a una carpeta, o mandar un mensaje), no texto libre;
  - las **herramientas** que puede usar: sus funciones y las del catálogo que declara;
  - los **archivos** que acepta.
- **Juan ve siempre en qué modo está Boni.** Una conversación centrada en una extensión lo dice en la barra de escribir,
  con una etiqueta («Conciliación») que se quita con un clic. Sin ella, Boni es el de siempre.
- **Una extensión de Juan puede ser solo eso:** instrucciones, bienvenida y botones, sin código. Es el equivalente a un
  GPT o un Gem, pero sin un concepto nuevo.
- **Su sección propia.** «Extensiones» pasa de Ajustes a un sitio propio en la barra lateral. Cada extensión tiene una
  página:
  - qué hace;
  - qué lee y qué escribe;
  - su modo de conversación, con las instrucciones a la vista;
  - sus funciones y sus pruebas;
  - sus versiones;
  - y encenderla o apagarla.

  Se activa como hoy (E3): nada se activa solo, y una versión que pide más lo dice.
- **Dónde aparece el modo.**
  - En el bloque «Chat» de una página, que es una conversación centrada en una extensión, con su bienvenida y sus
    botones.
  - En un botón de página que manda un mensaje a Boni en ese modo.
  - Cuando Juan pide algo que le toca a una extensión («quiero añadir los extractos del mes»): Boni lo propone y Juan
    lo acepta con un clic.

### 3.4 Tarjetas dentro de la conversación

Las respuestas de Boni mezclan texto y **tarjetas**. Una tarjeta es una especificación del Lienzo (§6): componentes del
catálogo, nunca HTML. Tipos:

- **Pregunta.** Cada una lleva la línea o el dato del que trata, y su control:
  - elegir una, o varias (con casillas);
  - escribir con sus palabras;
  - un número o una fecha;
  - una fila de una colección (con «Nueva…» para crearla en el sitio);
  - un archivo (subir o arrastrar);
  - sí o no.
- **Ensayo.** Lo que haría, con su lista plegable y los botones «Guardar» y «Revisar».
- **Hecho.** Lo que hizo, con «Deshacer».
- **Confirmación.** La de hoy (§7.14), sin cambios: solo componentes del código.

Las reglas:

1. **La barra de escribir nunca se bloquea.** Lo que Juan escribe con una pregunta abierta es un turno más, y el
   planificador decide si es la respuesta («la segunda, la de Tienda B») o algo nuevo («espera, eso es un reembolso»).
   Las tarjetas atajan; no limitan.
2. **Una salida libre donde tenga sentido,** como la opción «Otra» de `AskUserQuestion`:
   - Una elección entre filas o categorías trae «Nueva…».
   - Una elección entre opciones trae «Otra cosa…», que abre una línea para escribir.
   - Una regla trae «Cambiarla…», «Es esporádico: sin regla» y «Más general…».
   - El sí o no y la confirmación no llevan salida libre.
3. **Una tarjeta vieja se vuelve a comprobar.** Al pulsarla, el código mira si lo que leyó ha cambiado (como `stale` en
   los conjuntos de cambios). Si ha cambiado, lo dice y la vuelve a hacer. Una pregunta ya contestada se queda como
   texto, con su respuesta debajo.
4. **Agrupar o preguntar de una en una depende de lo segura que esté Boni** (Juan, 2026-10-31).
   - Lo que tiene bastante claro lo junta en una sola tarjeta para revisar («estas 5 las pongo así»), con casillas
     para quitar alguna o corregirla.
   - Lo dudoso lo pregunta de una en una.
   - El umbral no se fija ahora. Boni aprende de lo que Juan corrige, como la revisora del correo, y agrupa más a medida
     que acierta.
5. **Sin modelo también funciona.** Las preguntas de una función (la conciliación) llegan con su control, así que, sin
   modelo configurado, Boni pregunta con tarjetas como en la maqueta. Con modelo, además entiende lo que Juan escriba.
   Elegir entre opciones cerradas lo puede hacer un `decider` barato, como Jev (`extensiones.md` §9).

### 3.5 El turno en vivo

- **Eventos.** Hoy el turno vuelve entero al acabar. Pasa a ser un flujo de eventos por ejecución, por SSE (el servidor
  ya tiene `/api/agent/events`):
  - «pensando», con el razonamiento resumido cuando el proveedor lo da;
  - «paso» al empezar y al acabar, con su nombre en palabras de Juan («Leyendo 2026-09-revolut.csv», «Buscando tus
    movimientos de septiembre»);
  - el texto según llega;
  - una tarjeta;
  - «esperando a Juan»;
  - «hecho».

  La app pinta los pasos en una lista con una animación a la izquierda del que está en marcha, y al acabar los pliega
  en «pensó y dio 4 pasos».
- **Lo que el modelo piensa es texto `model`.** Se pinta como texto plano (A-01), igual que el resto.
- **Parar.** El botón de enviar se convierte en «parar» mientras hay turno.
  - El intérprete mira la señal entre paso y paso, y la llamada al modelo se corta (`AbortController`).
  - Lo que ya se hizo queda hecho, con su Deshacer, y el turno dice dónde se paró.
- **Modelo.** Un selector en la barra elige el modelo del `planner` para esa conversación, entre los que Juan tiene en
  «Modelos». Las clases de privacidad (§9 y E5) siguen mandando: un modelo que guarda datos no ve lo que Juan ha cerrado.

### 3.6 La barra de escribir

- **Forma.** Un área de texto que crece con lo escrito, sin el asa de cambiar el tamaño (son las rayas de hoy), con el
  botón dentro, a la derecha: enviar, o parar cuando hay turno.
- **Debajo, dentro de la barra:**
  - adjuntar (y arrastrar a toda la ventana);
  - el modelo;
  - la etiqueta del modo, si lo hay;
  - más adelante, el micrófono.
- **Atajos.** Intro envía y Mayúsculas+Intro hace un salto de línea, como hoy. «/» abre las acciones de los
  modos de las extensiones, como `/conciliar`.

### 3.7 La voz, más adelante

La voz es otra entrada a la misma conversación, no otro sistema. Va en dos pasos:

1. **Pulsar para hablar.** Se transcribe con el papel `voice` (en el dispositivo si se puede) y entra como texto en la
   barra.
2. **Tiempo real,** con una sesión del proveedor (como OpenAI Realtime o Gemini Live) conectada a la misma
   conversación, las mismas herramientas y la misma política:
   - se puede interrumpir a Boni mientras habla;
   - Boni lee en alto las tarjetas;
   - lo que pida confirmación se confirma con un toque en la pantalla, nunca solo con la voz.

Por eso las piezas de §3.1 a §3.5 se hacen pensando en ella: eventos en vivo, turnos guardados, tarjetas con su texto, y
poder parar.

## 4. La conciliación dentro de esta estructura

El modo «Conciliación» lo trae la extensión `conciliacion`.

- **Cómo empieza.**
  - Desde Gastos, su bloque «Chat» o un botón abre la ventana con la bienvenida: «Sube el extracto del banco y lo
    repasamos juntos».
  - Debajo, «Subir extracto», «Cerrar el mes» y la barra. Se puede arrastrar el archivo encima.
- **Lo que hace Boni solo.**
  - La función `importar` (en la caja, la de E4a) lee el extracto, une lo que está claro y devuelve los hechos y las
    **preguntas abiertas**, cada una con su referencia y su control.
  - Boni lo cuenta en dos líneas y una lista plegable, y pregunta de una en una lo que no sabe.
- **Respuestas.**
  - Con una tarjeta o escribiendo. Cada respuesta vuelve a la función como `data.answers[ref]`, y la función se repite
    con ellas (unos 0,1 s en la caja): no hay estado escondido.
  - Lo que escribe Juan («para el mercadillo») va al texto del movimiento. El modelo puede proponer la categoría (la
    pone la primera de las opciones), pero no la elige.
- **Lo nuevo que pidió Juan.**
  - **Crear una categoría** desde la pregunta. Es una fila nueva en Categorías, con su tipo, y se confirma en la misma
    tarjeta.
  - **Reglas.**
    - «Cambiarla…» deja editar el texto, el comercio o la categoría.
    - «Es esporádico» la guarda como excepción, para que Boni no vuelva a proponerla.
    - «Más general…»: el modelo propone un patrón y el código enseña qué movimientos de los últimos meses cogería antes
      de guardarla («cogería 14; estos 2 no deberían»).
  - **Lo que Boni nota solo,** como el Bizum que salda la deuda de Ana, se pregunta como sí o no.
- **Guardar.** Un ensayo con «Guardar», todo en una ejecución, con Deshacer.
  - Lo que queda para luego se guarda en la conversación con sus respuestas. La próxima vez, Boni empieza por ahí:
    «te quedaban 2 cosas de septiembre».
  - Si Juan cierra la ventana a medias, es lo mismo: la conversación sigue en la lista.
- **Sin modelo,** la misma conversación con tarjetas, como la maqueta 2 (§3.4, regla 5).

## 5. Seguridad: lo que no cambia

- **El modelo escribe planes y el código los interpreta (A-01).**
  - Una tarjeta solo tiene componentes del catálogo, y sus acciones son referencias que pasan por la política.
  - Lo que Juan pulsa en una tarjeta entra como lo que escribe: integridad `user`, desde ese dispositivo.
- **Lo que viene de los extractos llega como datos citados, nunca como instrucciones.**
  - Los textos del banco los escribe el comercio: son `imported`.
  - El planificador los ve dentro de la pregunta estructurada.
  - Un nombre de comercio con instrucciones dentro no puede hacer nada que no pase por la política, y no vale como
    destino (P2).
- **Las conversaciones son datos de Juan:**
  - están en su almacén, con etiquetas, exportación y auditoría;
  - los niveles de «Lo que ve la IA» valen también para lo que se cita en ellas;
  - una conversación borrada va a la papelera.
- **La voz no confirma sola.** Toda confirmación es un toque en un dispositivo personal (§3.7).

## 6. Qué cambia en el código

| Hoy | Después |
|---|---|
| Historial en memoria del agente (20 turnos por dispositivo) y en el estado de la web | Tipos `conversation` y `turn` en el almacén; el agente lee de ahí |
| `POST /api/agent/turn` devuelve el turno entero | Devuelve el `run` al empezar; los eventos llegan por SSE; `POST /api/agent/runs/:id/stop` |
| Una conversación por dispositivo | Varias, con su lista (crear, nombrar, archivar, buscar) |
| `ask` del plan con elegir o escribir | Tarjetas de pregunta del Lienzo (§3.4), con salida libre y comprobación al pulsar |
| La barra con el asa del navegador y el botón fuera | §3.6 |
| La conversación ocupa la pantalla o el panel en lugar de la Bandeja | Superficies independientes (§3.2) |
| Modelo por papel, fijo | Selector por conversación entre los permitidos |
| Las preguntas de las funciones, solo en la maqueta | `ask` con `ref`, control y la línea de la que trata; respuestas en `data.answers` |

## 7. Fases

Juan (2026-10-31): varias fases juntas, sin esperar un PR por cada una. Un PR puede llevar varias, cada una con sus
pruebas; lo que cambia la interfaz de forma nueva sigue empezando por una maqueta (I-09).

| Fase | Qué | Va con |
|---|---|---|
| C1 | **Conversaciones guardadas:** los tipos `conversation` y `turn`, el historial a la izquierda de la pantalla Conversación, Deshacer y corregir | C2, en un PR |
| C2 | **El turno en vivo:** los pasos según ocurren, parar, la barra nueva y el selector de modelo | C1 |
| C3 | **Tarjetas en la conversación:** la tarjeta de pregunta con sus controles y su salida libre, agrupar lo seguro, el ensayo y el hecho, y la comprobación de una tarjeta vieja | C4 y C5, tras la maqueta 3 |
| C4 | **Superficies:** la ventana flotante con su animación y los archivos arrastrados, llevarla a la derecha (aparte de la Bandeja), ampliarla y el móvil | C3 |
| C5 | **Modos de conversación de las extensiones:** en el manifiesto, la sección Extensiones, el bloque «Chat» y el botón que manda un mensaje | C3 |
| C6 | **La conciliación en modo conversación** (es E4b): las preguntas de las funciones, las respuestas en `data.answers`, crear una categoría, las reglas (cambiar, esporádica, más general con su prueba) y lo que nota solo | C5, E4a |
| C7 | **El círculo de Boni y la voz:** el círculo en todas las pantallas y en el escritorio, pulsar para hablar y después tiempo real | C4 |

La maqueta 3 junta lo que se ve de C3 a C5: la ventana flotante con la conciliación dentro, la barra con su etiqueta
de modo, las tarjetas con su salida libre, lo agrupado y el bloque «Chat» en Gastos.

## 8. Decidido (Juan, 2026-10-31)

1. **Las conversaciones se guardan** en la cuenta de Juan, y su historial se ve en la pantalla Conversación como en
   otras IA (§3.1).
2. **Corregir sin versiones paralelas,** con un turno nuevo que deshace y rehace (§3.1). Agrupar las preguntas o hacerlas
   una a una depende de lo segura que esté Boni, y lo aprende con el uso (§3.4).
3. **La ventana flotante como superficie por defecto,** que se lleva a la derecha o se amplía, siempre aparte de la
   Bandeja (§3.2).
4. **No hay asistentes aparte:** una extensión puede traer su modo de conversación, y las extensiones tienen su sección
   propia (§3.3).
5. **Con modelo, Boni entiende lo que se escribe; sin modelo, pregunta con tarjetas** (§3.4).
6. **El orden de C1 a C7, en lotes:** C1 y C2 juntas; C3 a C5 tras la maqueta 3; luego la conciliación (C6) y la voz
   (C7).
