# Automatizaciones: los flujos, rehechos como en n8n

**Decidido por Juan el 2026-11-15: «Sí, las recomendadas»** (las nueve del §10). Nada construido todavía. El arreglo
de «Antes» es la tarea 124 y las fases son las tareas 125 a 130 (F14a a F16), la 87 (F17), la 88 (F18) y la 89
(F19) (§8); la cola quedó adaptada ese día como dice el §9.

Propuesta (2026-11-15). Juan: «quiero algo muy similar a n8n, tanto en funcionalidad como manera de interaccionar…
que dé mucho control al usuario pero que al mismo tiempo sea usable, no un mar de opciones y desplegables
arbitrarios… la interfaz es muy importante». Lo que decidió está en el §10.

Sustituye el editor y el motor de `docs/flujos.md` (F1–F6) y rehace la parte de flujos de `docs/sistema.md` (F7–F13);
lo que se queda de los dos está en el §2. Cinco decisiones anteriores cambian, y cada una está en el §10: el
JavaScript libre, el sitio de las cajas en el lienzo, que un flujo llame a otro, la forma de «Función» y lo que un
flujo escribe solo en segundo plano. El resto de la seguridad del núcleo (`docs/nucleo.md` §7) no cambia: el modelo
sigue sin ser de fiar y toda escritura la sigue decidiendo el código (§6).

Las diez pantallas están dibujadas en `docs/maquetas/automatizaciones.html`: un boceto en HTML con datos inventados,
no la app (se abre en un navegador, en una ventana ancha). Se borra cuando la fase F14 tenga sus capturas de
referencia (I-07).

Los puntos del §5 van numerados (AU-nn) con su estado y su fase, como pide la tarea 66: una fase solo está hecha
cuando cada punto suyo tiene su prueba.

## 0. Resumen

- **Una automatización es un dibujo de pasos unidos por flechas, como en n8n.** Un paso que la inicia (el
  disparador), pasos que leen, transforman, deciden y escriben, y ramas. Por las flechas pasan filas. Se arrastra, se
  conecta, se prueba paso a paso y se ve lo que entra y lo que sale de cada uno.
- **Abrir un paso enseña tres columnas y pocas cosas**: lo que le entra, sus parámetros y lo que sale. Como mucho
  siete parámetros a la vista; lo opcional está detrás de «Añadir opción»; lo que vale para todos los pasos (qué
  hacer si falla, reintentar, una nota) está en una pestaña «Ajustes» igual en todos. Una prueba cuenta los
  parámetros de cada paso del catálogo: el «mar de opciones» no puede volver sin que falle.
- **JavaScript donde haga falta.** Cualquier valor puede ser una expresión `{{ }}`, y hay un paso «Código». El código
  recorre listas, consulta colecciones con filtros y cruza unas con otras. Corre en la caja, sin red; guarda en una
  colección solo si su conexión lo permite, y lo que puede cambiar se ve en su tarjeta antes de ejecutarlo (Juan,
  2026-11-16). Quien guarda es siempre el motor, con la política, como en los pasos «Colección».
- **El paso «Agente» es una IA conectada a las colecciones que tú digas, con límites.** Por cada colección: si puede
  leer, crear, modificar o eliminar («No», «Preguntar» o «Sí»), en qué filas y en qué campos. Cómo lee lo decide la
  IA o lo dice tu código. Una frase resume siempre lo que puede hacer. Esto n8n no lo tiene: allí el límite es la
  forma de cada nodo y hay que abrirlos uno a uno para saber qué puede hacer un agente.
- **La sección se llama «Automatizaciones» y el concepto llega a toda la app.** Un botón, un control o una página
  inician una automatización y le pasan sus valores; una automatización pone valores y enseña datos en los bloques
  de una página. Cada bloque tiene un nombre y un identificador por debajo, como cada paso.
- **Se copia de n8n la manera de trabajar, no sus tropiezos.** Lienzo, vista del paso con entrada y salida,
  arrastrar un campo para citarlo, probar un paso, fijar datos, publicar aparte de guardar, la pestaña de
  ejecuciones. No se copia: la misma acción en ocho sitios con nombres distintos, opciones que cambian el resultado
  escondidas en un desplegable, tres lenguajes que se parecen, que el orden dependa de dónde está dibujada cada caja.
- **El motor se rehace.** Hoy un flujo es una lista de pasos con una sola pieza de datos por paso; pasa a ser un
  grafo por el que corren filas. Se queda todo lo que protege: la política, las etiquetas, la caja, los lectores en
  cuarentena, el diario con Deshacer, la Bandeja, las versiones y el mapa calculado.
- **Seis fases (F14–F19)**, cada una con algo que Juan ve: el motor, el lienzo, el JavaScript y publicar (la F14, en
  cuatro partes); la IA con conexiones; lo de Boni y lo suyo, migrado, con el MCP nuevo y sin el editor viejo; las
  páginas; más disparadores y automatizaciones que llaman a otras; paquetes y la IA que propone. Antes, un arreglo
  pequeño: el resumen de la mañana que falla (§8).
- **«Modelos» deja de tener usos (decidido el 2026-11-18, §5.16).** Una lista de modelos cargados; el chat elige
  uno; un paso de IA elige uno o una etiqueta que Juan puso a varios; la evaluación pasa a ser una marca del modelo,
  una por modelo. Fase FM, sin construir; sus decisiones, en el §10 (22 a 25).
- **Salir fuera no está en estas fases** (peticiones HTTP, webhooks, credenciales, enviar un correo). Es mucho de lo
  que se hace con n8n y aquí queda para después, en una fase propia (F20) con su diseño (decisión 9 del §10).

## 1. Lo que pidió Juan (2026-11-15)

Sus condiciones, numeradas para poder comprobar el diseño contra ellas (la tabla del final del §5 dice dónde se
cumple cada una):

| | Condición | En sus palabras |
|---|---|---|
| C1 | Muy parecido a n8n, en lo que hace y en cómo se maneja | «algo muy similar a n8n, tanto en funcionalidad como manera de interaccionar, gestionar flujos» |
| C2 | Sin muchas opciones de golpe, ni en el flujo ni al abrir un paso | «muchas opciones de golpe, poco estructuradas… cuando hago clic en un paso hay muchas opciones también de golpe» |
| C3 | JavaScript embebido | «embeber javascript para hacer cosas como recorrer listas de datos, consultas a colecciones con filtros» |
| C4 | Un paso de IA conectado a colecciones, con código o decidiendo ella | «una ia que está conectada a X colecciones… meterle javascript sobre cómo hacer esas peticiones, referencias cruzadas… o que la ia decida cómo debería gestionar las lecturas» |
| C5 | Límites en esas conexiones | «evitar que puedan eliminar, crear, modificar, o aplicar filtros para ciertas acciones» |
| C6 | La sección se llama «Automatizaciones» | «creo que se entiende mejor» |
| C7 | Lo mismo dentro de una página y en toda la app: un botón que actúa sobre otros bloques; valores de un formulario que van a una IA, o que ajustan una búsqueda que calcula una gráfica | «creo un botón y ese botón puede relacionarse con otros elementos (… identificadores de elementos con ids por debajo…) de mi página, como gráficas, tomar valores de un formulario y pasárselos a una ia o que los tome para ajustar una búsqueda en colecciones para calcular gráficas… que el concepto de automatizaciones se pueda aplicar a todos los elementos de mi aplicación» |
| C8 | Mucho control, pero usable; la interfaz es lo más importante | «una buena interfaz usable pero que el usuario tenga control» |
| C9 | Lo pendiente de flujos e IA se concilia con esto o se desecha | «el resto que está en tareas o lo conciliamos con esto o lo desechamos» |
| C10 | Se puede rehacer el código y los datos | «no fuerces adaptar a nuestro código» |
| C11 | Estudiar n8n a fondo, documentación y código, y sacar de él lo que valga | «veas todo lo que puede hacer y cómo lo hace y pienses en qué cosas extraer para boni (probablemente sean muchas)» |

Con esto queda decidida la decisión 1 de la tarea 103 (ni A ni B ni C tal cual: un editor libre como el de n8n, con
«Agente» como un paso más de cualquier automatización) y se reabren cinco decisiones anteriores (§10).

## 2. Lo que hay hoy (T-05)

**Lo que se queda, porque es lo que hace que Boni sea de fiar y n8n no lo tiene:**

- La política (`packages/agent/src/policy.ts`, `docs/nucleo.md` §7.5): cada llamada pasa por `decide`, que permite,
  niega, pide confirmar o propone. Un dato de fuera nunca es un destino (P2, P14), una escritura con datos de fuera
  se propone (P4), eliminar se confirma (P5). En una automatización publicada, mandar a la papelera con el «Sí» de
  Juan para esa colección no pregunta (AU-186, 2026-11-16), y lo que un paso suyo escribe con ese «Sí» se guarda
  también si viene de fuera, con su etiqueta (decisión 11 del §10); borrar para siempre no existe en ella (AU-122).
- Las etiquetas: cada valor sabe de dónde viene (de Juan, propio, importado, de un modelo, de fuera) y cómo de
  sensible es, y al mezclarse gana lo peor. Lo privado no llega a un modelo.
- La caja (A-08): QuickJS en un contenedor sin red ni disco, un intérprete nuevo por llamada.
- Los lectores en cuarentena: el texto de fuera (un correo, una web) lo lee un modelo que solo puede devolver una
  forma cerrada. El modelo que planifica no lo ve nunca.
- El diario de operaciones con Deshacer, la Bandeja de propuestas y la fiabilidad por clases (A-13).
- Borrador y versiones (D-55): un borrador se guarda solo y nunca se ejecuta; lo que corre es una versión.
- «Probar» no escribe, no avisa y no propone (D-43).
- El mapa calculado de qué lee y qué escribe cada flujo (A-16, D-48), que a Juan le gustó (tarea 84).
- Las páginas conectadas (tarea 87): valores de página («Control»), botones que hacen algo (`/api/agent/press`),
  el chat de una página.
- Los filtros avanzados de las vistas (tarea 75, `FilterItem` en `packages/views/src/page.ts`): reglas por campo con
  doce operadores y grupos «y»/«o» de un nivel, con el valor fijo o tomado de un control de la página.
- Las piezas de Boni dentro de «Leer correo» (A-19) y lo que hace Boni como flujos a la vista (tarea 83).

**Lo que se rehace:**

- El formato. Un flujo es `{version, steps[]}`: una lista en orden, sin grafo; las «flechas» del editor se deducen
  de las referencias `$paso.campo`. Cada paso da un solo valor. Repetir es `each` (hasta 50), condicionar es `when`.
  No hay ramas de verdad, ni filas que pasen, ni salidas con nombre.
- Los valores. Un parámetro es un literal, una referencia o una de unas 25 funciones puras anidadas hasta tres
  niveles. No hay JavaScript: se decidió así el 2026-11-05 (`docs/flujos.md` §6, decisión 3).
- El editor (`FlowEditor.tsx`, 2.064 líneas; `FlowStepPanel.tsx`, 692): la barra tiene diez controles y hasta tres
  barras más debajo; el panel de un paso enseña a la vez entre 19 y 22 controles para un «Crear» corriente («Entra»,
  el cuerpo, «Solo si», «Para cada», «Junto con», «Sale»), con el identificador del paso y referencias `$…` a la
  vista. El panel del disparador solo ofrece dos de los ocho que existen. El editor no tiene la lista de sus propias
  ejecuciones.
- El lienzo se ordena solo y no se puede colocar (I-26).
- El «Agente» solo existe como chat de una página, con cinco acciones fijas; no es un paso de cualquier flujo.
- «Función» + «Aplicar cambios» (tarea 93, D-52) es la única forma de meter código, y solo como extensión.
- En segundo plano un flujo nunca escribe: todo va a la Bandeja (P7).

**Lo que se va:** el lenguaje de planes como formato de lo que el usuario guarda (se queda como lo que escribe un
modelo en un turno, §5.12), `flowLayout.ts`, `flowEdit.ts`, `FlowEditor.tsx`, `FlowStepPanel.tsx`, `ExprField.tsx` y
los pasos «Solo si», «Para cada» y «Junto con» como campos de todos los pasos.

## 3. n8n: lo que se toma, lo que se mejora y lo que no

Leído: su documentación y su código (el editor, la vista del nodo, el motor actual y el nuevo que están haciendo, los
nodos de IA, las expresiones y el nodo de código, el catálogo). Su licencia (Sustainable Use) no deja copiar código,
textos ni iconos: de aquí salen ideas y maneras de trabajar, escritas de nuevo.

### 3.1 Se toma

| De n8n | En Boni |
|---|---|
| El lienzo: cajas, flechas que se arrastran, «+» en una flecha para meter un paso, menú de clic derecho, ordenar, deshacer | Igual (§5.7). Lo de I-24 se queda |
| Los datos son filas que pasan por las flechas, y cada flecha dice cuántas pasaron | Igual (§5.1, §5.2) |
| Abrir un nodo: entrada a la izquierda, parámetros en el centro, salida a la derecha | Igual: es lo que más ordena (§5.7) |
| Cada valor es fijo o una expresión, y debajo se ve lo que vale con la fila actual | Igual (§5.3) |
| Arrastrar un campo de la entrada a un parámetro para citarlo | Igual |
| Pocos parámetros a la vista, lo opcional detrás de «Añadir opción», lo común en «Ajustes» | Igual, y con una prueba que lo guarda |
| Ejecutar un solo paso reutilizando lo ya calculado; fijar la salida de un paso para no repetirlo | «Probar paso» y «Fijar» (§5.8) |
| Guardado solo; «Publicar» aparte hace la versión que corre | Es lo que ya dice D-55, con la palabra de n8n |
| La pestaña de ejecuciones: la lista y el lienzo de cada una con sus datos | Igual, más «Deshacer lo que hizo» |
| El panel para añadir un nodo: buscar y elegir por lo que quieres hacer | Igual, con categorías que no se pisan |
| El nodo de código con dos modos (todas las filas, cada fila) | Igual (§5.4) |
| Una IA con herramientas colgando por debajo, cada parámetro fijo o «lo decide la IA» | El «Agente» y sus conexiones (§5.5, §5.6) |
| Aprobar antes de que la IA use una herramienta: permitir, preguntar, bloquear | Los estados de cada permiso de una conexión: «No», «Preguntar», «Sí» |
| Un disparador «lo llama otra automatización» que declara qué campos pide | «Disparado por el usuario» con sus campos (§5.9) |
| «Simular» en las escrituras de sus tablas: devuelve el antes y el después | «Probar» lo hace en todas |
| Su motor nuevo: el estado de cada paso en su fila, y un paso se decide cuando todo lo que le llega ha acabado | El motor (§5.2) |
| Sus apps: una pantalla enlazada a automatizaciones y tablas con permisos | Las páginas de Boni (§5.11) |

### 3.2 Se mejora

| En n8n | En Boni |
|---|---|
| No hay un objeto de permisos: lo que una IA puede hacer es la suma de sus nodos, uno por operación | Una conexión por colección, con sus permisos y una frase que los resume |
| El modo «rellenar todas las columnas» deja a la IA escribir cualquiera | Al conectar solo se lee; cada permiso se da a mano |
| Tres lenguajes parecidos (expresiones, código, ayudas que solo valen en uno) y dos motores (vista previa y ejecución) | Un lenguaje, las mismas ayudas y un solo motor: la caja |
| `console.log` sale en la consola del navegador | Sale en la «Consola» del propio paso, debajo de su salida |
| El nombre del nodo es su identidad: renombrar reescribe todo y a veces se deja algo | Identificador fijo por debajo y nombre encima |
| Qué rama corre antes depende de dónde está dibujada | El orden nunca depende del dibujo |
| Para volver a juntar ramas hace falta un nodo, y una salida sin conectar pierde filas en silencio | Las filas que llegan a un paso se juntan solas; una salida sin conectar enseña cuántas filas se quedaron ahí |
| Opciones que cambian el resultado escondidas en el desplegable de opciones (la rama por defecto, que corran todas las que coincidan) | Lo que cambia el resultado siempre está a la vista |
| El filtro de borrar une las condiciones con «o» por defecto: añadir una condición borra más | «Todas» por defecto; modificar y eliminar piden al menos una condición |
| Cinco maneras de filtrar según el nodo | Un filtro: el de las vistas |
| La misma acción con dos nombres (ejecutar el paso, probar el nodo) y en ocho sitios | Una palabra por acción, en toda la app |
| Un nodo guardado se queda en su versión para siempre; para pasar a la nueva hay que borrarlo y ponerlo otra vez | Boni migra las automatizaciones al desplegar |
| Saber que una fila cambió es cosa del usuario (elegir un campo de fecha, sondear cada minuto) | El diario de Boni sabe qué campo cambió, de qué a qué |
| Ajustes del flujo en un diálogo de 17 filas con su «Guardar» dentro de un editor que guarda solo | Pocos ajustes, guardados solos |

### 3.3 No se toma

- **Los datos fuera de las colecciones** (variables, datos estáticos del flujo, tablas propias): en Boni el almacén
  son las colecciones.
- **Nodos de cientos de servicios**: no se hacen.
- **Peticiones HTTP, webhooks, credenciales y enviar un correo**: no en estas fases. Una automatización no llama a
  servicios de fuera ni envía un correo hasta que eso tenga su diseño; cuando llegue, entra por la política: el
  destino lo escribe Juan y se confirma. Es mucho de lo que se hace con n8n: irá después, en una fase propia (F20)
  con su diseño (decisión 9 del §10).
- **El bucle clásico del agente**, donde el modelo ve tal cual lo que devuelve cada herramienta: en Boni el modelo
  escribe planes que el código interpreta, y el texto de fuera solo lo leen los lectores en cuarentena (A-01).
- **Que probar escriba de verdad**: en n8n ejecutar el borrador envía y escribe. En Boni «Probar» ensaya (D-43).
- **Sub-nodos para el modelo, la memoria y el formato de salida**: son parámetros del paso, no cajas.
- **Meter n8n dentro de Boni**: su licencia no lo permite para esto y no conoce etiquetas ni política.

## 4. Las palabras

| Palabra | Qué es | Antes |
|---|---|---|
| **Automatización** | Un dibujo de pasos que hace algo cuando algo pasa | Flujo |
| **Paso** | Una caja del lienzo. n8n dice «nodo» en su código y «step» en sus botones | Paso |
| **Disparador** | El paso que la inicia. El manual se llama «Disparado por el usuario» (I-24) | Disparador |
| **Flecha** | La línea de la salida de un paso a la entrada de otro | La que se deducía de una referencia |
| **Fila** | Lo que pasa por una flecha: un objeto con campos. Lo que n8n llama *item* | Un valor por paso |
| **Conexión** | El enlace de un paso con una colección, con lo que le deja hacer en ella | La lista fija de acciones del chat |
| **Expresión** | Un valor calculado con JavaScript entre `{{ }}` | Funciones anidadas |
| **Probar** / **Probar paso** | Un ensayo: lee y calcula de verdad, no escribe | Probar |
| **Publicar** | Hacer del borrador la versión que corre | Guardar |
| **Ejecución** | Una vez que corrió, con lo que hizo cada paso | Ejecución |
| **Bloque** | Una pieza de una página: botón, control, gráfica, tabla, chat. Con nombre | Bloque (solo los controles tenían nombre) |

Una palabra por cosa, la misma en el lienzo, la vista del paso, el registro, el mapa, la conversación y el MCP (I-27).

## 5. La estructura

El ejemplo que acompaña todo el capítulo (y el boceto), con datos inventados: **«Resumen semanal de gastos»**.

```
Disparado por     Buscar gastos       Agrupar por         Analista            ¿Algo raro?  ── sí ──▶ Avisar
el usuario   ──▶  (Colección)    ──▶  categoría      ──▶  (Agente)       ──▶  (Si)
                  128 filas           (Código) 6 filas       ┆  1 fila         └─ no (0 filas)
                                         ┆                   ┆
                                     Categorías     Gastos · Categorías · Notas
                                     (lee)          (lee)    (lee)        (pregunta antes de crear)
```

### 5.1 Una automatización es un grafo

```ts
interface Automation {
  format: number;                     // the version of this format: a deploy migrates what was saved (AU-08)
  id: string; version: number; name: string;
  steps: Step[];
  arrows: Arrow[];                    // from one output of a step to one input of another
  settings: AutomationSettings;       // limits and what to do when a run fails (§5.2)
}
interface Step {
  id: string;                         // fixed, never shown
  name: string;                       // unique in the automation; shown, and what expressions cite
  type: string;                       // one entry of the catalogue (§5.10)
  params: Record<string, Param>;      // a literal, or { expr: string }
  connections?: Connection[];         // the collections this step may touch (§5.5)
  settings?: StepSettings;            // the same for every step type (§5.7)
}
interface Arrow { from: { step: string; output: string }; to: { step: string; input: string } }
```

- **AU-01** (F14a, hecho) · Una automatización es un grafo de pasos y flechas guardado como datos, con versiones.
  En la F14a es el formato: lo guardado se lee y se vuelve a escribir igual, y lleva su número de versión. Publicar
  y guardar cada versión es de la F14d (AU-95, AU-98).
- **AU-02** (F14a, hecho) · Cada paso tiene un identificador fijo que no se ve y un nombre único que se ve. Las
  flechas y lo guardado usan el identificador; las expresiones citan el nombre. Cambiar el nombre reescribe las
  expresiones que lo citan (y el código, desde la F14c), y nada se rompe.
  Hecho en la F14c (E2): `renameStep` reescribe `$('…')` en el JavaScript de los `{{ }}` y en el «Código», con
  comillas simples, dobles o invertidas, sin tocar un texto ni un comentario que digan lo mismo.
- **AU-03** (F14a, hecho) · Un paso tiene una entrada y una o más salidas con nombre («sí» y «no» en «Si»,
  «error» si se pide). A una entrada pueden llegar varias flechas y de una salida pueden salir varias. Las
  excepciones las dice el catálogo: un disparador no tiene entrada, «Combinar» tiene dos con nombre (AU-124) y
  «Parar con error» no tiene salida.
- **AU-04** (F14a, hecho) · Por las flechas pasan filas: objetos con campos. Una fila leída de una colección
  recuerda de qué fila guardada viene, para poder modificarla o eliminarla después sin buscarla otra vez.
- **AU-05** (F14b, hecho) · El sitio de cada paso se guarda aparte de la automatización. Mover un paso no hace
  una versión ni enciende «Publicar»; un paso sin sitio lo coloca Boni junto al paso del que cuelga; «Ordenar»
  recoloca todo. (Cambia I-26; decisión 2 del §10.)
  En la F14b: los sitios se guardan en el servidor, por automatización y no por dispositivo, al soltar el paso (una
  llamada aparte de la del borrador). Mover y «Ordenar» entran en el Deshacer del lienzo (AU-68) como cualquier otro
  cambio. Un paso sin sitio va a la derecha del paso del que cuelga, a su altura, y debajo si ese hueco está ocupado;
  un disparador nuevo, debajo del último disparador. Un paso que no cuelga de nada (el «+» de arriba) va a la
  derecha de la caja más a la derecha de la primera fila; el del clic derecho, donde se hizo el clic. El sitio que
  Boni le da a un paso al añadirlo se guarda como si Juan lo hubiera soltado: ya no se mueve solo.
  Hecho en E: mover una caja no envejece ninguna prueba (AU-92). Falta: que una caja soltada siga ahí al recargar y
  en otra ventana, con el servidor de verdad (G, la app de escritorio).
  Hecho en C2: el sitio se guarda al soltar, aparte del borrador y sin «Guardando…»; un paso nuevo va junto al suyo y
  no mueve ningún otro; «Ordenar» y su Deshacer. Un disparador nuevo debajo del último y un paso que no cuelga de nada
  a la derecha de la caja más a la derecha los guarda la prueba de `places.ts` (en la F14b el catálogo tiene un solo
  disparador). Un paso sin sitio guardado se coloca por sus flechas cada vez que se pinta, hasta que se suelta o se
  añade un paso: así queda. Hecho en G: en la app de escritorio sobre el servidor real, una caja soltada sigue ahí al
  recargar, al cerrar la app y abrirla y en la app de otro ordenador de la cuenta; un sitio que el servidor rechaza
  (4xx) no se reintenta, y uno que no llega dice «Sin guardar · Reintentar» y se guarda al volver el servidor.
- **AU-06** (F14a, hecho) · Una automatización puede tener varios disparadores. Cada ejecución empieza en uno.
- **AU-07** (F14a, hecho) · No hay ciclos: el editor no deja conectar una flecha que vuelva atrás. Repetir por
  tandas será un paso («Por tandas», F18), no un dibujo. En la F14a lo dice la validación (una automatización
  con un ciclo no es válida) y el motor da la pregunta que el lienzo hará en la F14b: «¿esta flecha cerraría un
  ciclo?».
- **AU-08** (F14a, hecho) · Cada tipo de paso existe una sola vez. Cuando cambia, el despliegue migra las
  automatizaciones guardadas; no hay pasos «de una versión anterior».

### 5.2 Cómo se ejecuta

- **AU-10** (F14a, hecho) · Un paso se decide cuando han terminado todos los pasos de los que le llega una
  flecha. Se ejecuta si alguna trae filas; si no, queda «saltado», y lo que cuelga solo de él también. Un paso al
  que no se llega desde el disparador de esta ejecución cuenta como terminado sin filas (AU-06).
- **AU-11** (F14a, hecho) · Si a un paso le llegan filas por varias flechas, se juntan en un orden fijo y el paso
  corre una vez. No hace falta ningún paso para volver a juntar ramas.
- **AU-12** (F14a, hecho) · El orden de ejecución no depende de dónde está dibujado cada paso: dos
  automatizaciones iguales con las cajas en otro sitio hacen lo mismo, en el mismo orden.
- **AU-13** (F14a, hecho) · Cada tipo de paso dice si trabaja «por fila» o «con todas», y el motor da la vuelta.
  Cada fila que sale de un paso «por fila» sabe de qué fila de entrada viene, así que `$('Otro paso').item` siempre
  encuentra la suya; tras un paso «con todas» que rehace las filas, dice que no puede y propone `.first()` o `.all()`.
- **AU-14** (F14a, hecho) · Una flecha sin filas no arranca lo que sigue. El ajuste «Seguir sin filas» de un paso
  hace que lo que sigue corra con una lista vacía (para decir «no hay nada», por ejemplo). No se inventa una fila
  vacía, como hace n8n. Con una lista vacía, un paso «por fila» que lee o escribe («Crear una fila») corre una vez
  sin fila actual: sus valores fijos valen, y citar `$json` falla diciendo que no hay fila; uno que solo cambia o
  reparte las filas que le llegan («Si», «Filtrar») no da ninguna.
- **AU-15** (F14a, hecho) · De cada ejecución se guarda, por paso: su estado (en cola, en marcha, hecho, falló,
  saltado, parado, esperando), cuántas filas entraron y salieron por cada salida, cuánto tardó, lo que salió y, en
  los pasos de IA, lo que costó. En la F14a el motor devuelve ese registro; guardarlo es de la F14d, el coste
  llega con los pasos de IA (F15) y «esperando», con los pasos que esperan (F15, F18).
- **AU-16** (F14a, hecho) · Si falla un paso: «Parar» (por defecto), «Seguir» o «Salir por error», que le añade
  una salida «error» con las filas que fallaron y el motivo. Reintentar hasta 5 veces con espera. Lo dice el paso en
  «Ajustes».
- **AU-17** (F14d, en parte) · Los límites de una ejecución (pasos, llamadas a modelos, filas escritas, tiempo)
  están en los ajustes de la automatización con valores prudentes; el código tiene su techo (P12, P13). Parar por un
  límite dice cuál fue y lleva a ese ajuste.
  En la F14d: son cuatro números con nombre (`AUTOMATION_LIMITS`, `packages/automations`; `RUN_LIMITS` ya es el
  nombre de los de P12 en `packages/agent`), cada uno con su valor por defecto y su techo. Los valores están
  razonados, no medidos; el constructor los mide con el volumen de Juan y los corrige aquí. Los de tiempo y filas
  escritas los aceptó Juan el 2026-11-16 (decisión 12 del §10): si la medida pide otro número, el constructor lo
  dice en su PR como duda para él y no lo cambia.
  Hecho en E2: `AUTOMATION_LIMITS` y `limitsOf` (`format.ts`) con la tabla de arriba; `limit.over` en la validación
  (también deja la ejecución sin empezar); el motor para con `run.limit` (`LimitPassed`, sin reintentos ni «Si falla»)
  por tiempo y por pasos antes de empezar cada paso, y por filas escritas antes de preguntar a la política: un
  «Colección» cuenta sus filas de entrada antes de la primera, «Las que cumplan…» las que encontró, un «Código» las
  que pidió, y la puerta cuenta además cada cambio. Medido con 3.000 filas en el motor de pruebas, dentro de su
  tiempo; los números de la decisión 12 no piden otro. Las palabras de la parada y de `limit.over`, en las dos
  lenguas (`words.ts`). «Las que cumplan…» con varias filas de entrada para a medias, como dice arriba, y así lo
  sostiene `limits.test.ts` («AU-17 · «Las que cumplan…» with several rows arriving…»). Falta: las llamadas a modelos
  no tienen nada que contar hasta la F15 (desde E1 de la F15 las cuenta `countModelCall`, AU-206); deshacer lo que guardó una ejecución que paró a medias de un paso (AU-18,
  S2); `runs.test.ts` con el almacén de 12.000 registros (S2).
  Hecho en S2, en el servidor de verdad: con 3.000 filas que cumplen la condición en un almacén de 12.000 registros,
  la ejecución para por defecto sin una operación en el registro; «Las que cumplan…» con dos filas de entrada para
  a medias, lo que guardó la primera se queda y «Deshacer lo que hizo» deja el almacén como estaba (decisión 14).
  Hecho en la tarea 137: con el límite subido, «Las que cumplan…» guarda el cambio de cada fila de entrada en una
  transacción. La puerta de la ejecución (`writeAll` de `Run.gate`, `engine.ts`) pregunta a la política por cada fila,
  con la misma llamada que al guardar una sola (`collection-batch.test.ts`), antes de guardar ninguna, y guarda las que
  permite con `applyAll`; si niega una o una fila cambió desde que se leyó, no se guarda ninguna de ese cambio, y lo
  que guardaron las filas de entrada anteriores se queda (decisión 14). Las que pediría preguntar esperan a Juan y las
  demás se guardan, como antes. El índice de búsqueda ya no se recorre por fila (migración 31). Las dos `it.todo` son
  pruebas con su tiempo (`runs.test.ts`, `@boni/pace`). Medido a mano (`BONI_MEASURE`), en un portátil: 3.000 filas de
  un almacén de 12.000 se guardan en 2,3 s y se deshacen en 1,8 s; las 12.000, en cuatro cambios, en 8,7 s y 4,4 s;
  aceptar una propuesta de 3.000 cambios, 1,5 s. En el techo, 20.000 filas de un almacén de 20.000 en un cambio se
  guardan en 7,7 s y se deshacen en 7,5 s, y 20.000 creadas una por fila de entrada (una transacción cada una), en 25
  a 34 s. Durante ese tiempo el servidor no contesta a nada.
  Hecho en P1: «⋯ → Ajustes» enseña «Tiempo» y, si un paso escribe, «Filas escritas» (`shownLimits`), cada uno con
  «Por defecto … · máximo …»; por encima de su techo el campo dice «Como mucho …» y no lo guarda, y volver al valor
  por defecto lo quita del borrador (`withLimit`). Una prueba que paró por un límite dice en «Registro» «Cambiar el
  límite», que abre «Ajustes» en ese campo (`stoppedByLimit`). Lo sostienen `publishing.test.ts` y
  `automations-publish.spec.ts`.

  | Límite | Por defecto | Techo | Se ve en «Ajustes» cuando |
  |---|---|---|---|
  | Tiempo | 60 s | 10 min | siempre |
  | Filas escritas | 1.000 | 20.000 | algún paso escribe |
  | Llamadas a modelos | 20 | 40 | algún paso llama a un modelo (F15) |
  | Pasos | 200 | 1.000 | un paso puede repetirse (F18) |

  «El código tiene su techo» es la columna «Techo» de esta tabla, escrita en el código y fuera del alcance de un
  ajuste. P12 y P13 no cambian y siguen siendo de lo suyo: los números de P12 (200 pasos, 40 llamadas) topan el plan
  que escribe un modelo en un turno, y los de P13, cada lectura. Una automatización es un documento que Juan publica,
  así que sus pasos tienen el techo de esta tabla y no el de P12; sus llamadas a modelos tienen el mismo número que
  P12, y lo que un paso de IA haga por dentro (F15) sigue además bajo P12.
  Los cuatro se cumplen siempre, se vean o no. Los comprueba el motor, que es código puro: el tiempo y los pasos,
  antes de empezar cada paso (el reloj es el de la ejecución, inyectado); las filas escritas, antes de preguntar a
  la política por el cambio de un paso, contando también las que se propondrían. Así «Las que cumplan…» (AU-121)
  sin tope lee como mucho lo que da una lectura (5.000, AU-175) y, si se pasa, falla antes de guardar ninguna de las
  que encontró para esa fila de entrada. Con varias filas de entrada busca y guarda una tras otra, y una posterior
  encuentra lo que guardó la anterior (la primera pasa de «0» a «1» las 600 filas en «0»; la segunda, de «1» a «2»,
  encuentra esas 600: escribe 1.200, y contar antes de guardar habría dado 600), así que no se cuentan todas antes
  de la primera sin cambiar lo que hace el paso. Si el límite se pasa en una fila posterior, lo que guardaron las
  anteriores («Sí») se queda, cada fila con su operación en el registro, y lo que propusieron («Preguntar») queda en
  la ejecución; esa fila no guarda ni propone ninguna. Lo guardado se deshace con la ejecución entera (AU-18, S2). Un
  paso en marcha no se corta (la caja ya corta el suyo a los 5 s, AU-35), así que una ejecución puede pasarse del
  tiempo en lo que tarde un paso. Parar por un límite para la ejecución entera, diga lo que diga «Si falla» en el
  paso (AU-16): el motivo es `run.limit` con el nombre del límite y los dos números, en una prueba también. Lo que
  los pasos anteriores guardaron se queda y se deshace desde la ejecución (AU-18). Se lee «Paró: iba a escribir 3.000
  filas y el límite son 1.000 · Cambiar el límite», y el botón abre «⋯ → Ajustes» en ese número. Los límites son
  parte del documento (`settings.limits`), así que cambiar uno es un cambio del borrador y vale desde que se publica
  (AU-95). Un número por encima de su techo no pasa la validación (`limit.over`): nunca se recorta en silencio. El
  tope de escrituras de la política (P11) no cuenta en una ejecución de una versión publicada, la inicie quien la
  inicie (AU-195): su tope es este (AU-167).
  Lo sostienen `limits.test.ts` (`packages/automations`: cada límite para la ejecución, antes de guardar) y
  `runs.test.ts` (`apps/server/src/automations`: con el volumen de Juan, 3.000 filas que cumplen la condición en un
  almacén de 12.000 registros, para por defecto sin una operación en el registro; con el límite subido las guarda
  en una transacción dentro de su tiempo y «Deshacer lo que hizo» las devuelve).
- **AU-18** (F14d, en parte) · Todo lo que una ejecución escribe es un solo grupo en el diario: se deshace entero
  desde la ejecución.
  En la F14d: el grupo ya existe. Cada operación lleva la ejecución en el registro desde la F14c (AU-174), y
  `undoRun` del almacén las deshace todas, la última primero, en una transacción. «Deshacer lo que hizo» (AU-100) es
  esa llamada: todo o nada. Si una fila cambió después de la ejecución, no se deshace ninguna y se dice cuál («No se
  pudo deshacer: «Comprar pan» cambió después»); nada se pisa. Lo que Juan aceptó de la propuesta de esa ejecución
  (AU-193) se guardó con la misma ejecución y se deshace con ella. Deshecha, la ejecución lo dice con su hora y el
  botón desaparece: no hay «Rehacer». Vale también para una ejecución de la que solo queda el resumen (AU-103),
  porque deshacer lee el registro de operaciones y no el de la ejecución. Deshacer miles de filas tarda lo que
  guardarlas (AU-174) y entretanto el servidor no atiende: es la tarea aparte del `update` del almacén.
  Lo sostiene `runs.test.ts`: una ejecución de tres pasos que escriben (crear, modificar y mandar a la papelera) deja
  el almacén como estaba; con una fila cambiada después, no deshace ninguna.
  Hecho en S2: `undoAutomationRun` (`runs.ts`; la ruta `POST …/:id/runs/:run/undo` y la acción
  `automations.undo_run`) es el `undoRun` del almacén, todo o nada, y la ejecución guarda cuándo se deshizo; con una
  fila cambiada después lo niega con `changed` y dice cuál. Se deshacen enteras también una que paró a medias por su
  límite y una interrumpida (AU-190). Es el principio A-40.
  Hecho en S3: lo que Juan acepta de la propuesta de una ejecución se guarda con la misma ejecución en el registro
  (`acceptRun`, `apps/server/src/automations/proposal.ts`), así que «Deshacer lo que hizo» lo deshace con lo demás
  (`proposal.test.ts`); el «Deshacer» de la Bandeja no lo deshace aparte («cannot-undo»).
  Hecho en S4: una ejecución de la que solo queda el resumen se deshace igual (`runs.test.ts`), porque deshacer lee
  el registro de operaciones; lo que no tiene es «Fijar» sus datos (`pinFromRun` contesta `pruned`). Hecho en la
  tarea 137: deshacer 3.000 filas en un almacén de 12.000 tarda 1,8 s, con su tiempo en `runs.test.ts`; el servidor
  sigue sin atender mientras.
  Hecho en P2: «Deshacer lo que hizo» en la barra de una ejecución de «Ejecuciones», solo si escribió y no está
  deshecha; con `changed`, «No se pudo deshacer: «…» cambió después», y deshecha, «Deshecha hoy, 10:20» sin botón.
- **AU-19** (F14a, hecho) · Cada operación de un paso lleva en el catálogo si lee o escribe y si destruye, y de
  ahí salen su efecto para la política, el mapa y la lista de acciones (A-26, tarea 95). No hay una lista aparte.
  En la F14a: el catálogo, y lo que el motor le dice a la política de cada lectura y escritura; el mapa (AU-47) y
  las rutas llegan con sus fases y leen lo mismo.

### 5.3 Los valores: fijo o expresión

- **AU-20** (F14b, hecho) · Un parámetro que es un valor es «Fijo» (su control: texto, número, fecha, una opción
  del campo, una fila) o «Expresión». Se cambia con un botón pequeño, «{ }», que cierra la línea del valor y siempre
  está a la vista; arrastrarle un campo lo cambia también. Hasta la F14c una expresión es texto con citas (AU-21), que
  resuelve el servidor (AU-162); el JavaScript llega con la F14c (AU-22).
  En la F14b: soltar un campo en un valor de texto añade la cita donde está el cursor (al final si no lo hay); en un
  número, una fecha o una opción, la cita sustituye al valor. Pasar a «Expresión» con «{ }» conserva lo escrito,
  como texto de la expresión; volver a «Fijo» deja el control vacío, y las dos cosas se pueden deshacer. Después de una prueba, debajo de un valor que es una expresión se lee lo que da con la primera fila
  de la entrada («= 5 · con la fila 1 de 128»); sin prueba no se lee nada debajo.
  Hecho en F: «{ }» al final de cada valor de la vista, soltar en un texto donde está el cursor y en lo demás en lugar del valor, el paso a
  «Expresión» y vuelta con Deshacer, y lo que da con la primera fila de la última prueba, que se calcula en la app a
  cada tecla, sin preguntar al servidor (A-15).
  Hecho en G (Juan, 2026-11-16: «lo que mejor sea para la usabilidad»): «{ }» va al lado de su control en todos
  los valores, en una columna: el mismo borde derecho, tamaño y aspecto en un texto, un número, una fecha, una
  opción, una casilla o una expresión, de una condición o de «Campo · Valor», también tras pasar a expresión y
  volver; la papelera de «Campo · Valor» es la de una condición; Tab va de cada control a su «{ }».
- **AU-21** (F14b, hecho) · Arrastrar un campo de «Entrada» a un parámetro lo cita. Una cita sencilla se ve
  como una ficha con el icono de su paso y el nombre del campo («Importe mínimo»), nunca como código; si dos pasos
  tienen un campo que se llama igual, la ficha lleva también el paso («Buscar gastos › Importe»).
  En la F14b: se arrastran los campos de la entrada del paso y los de cualquier paso anterior de su camino, que se
  eligen en la cabecera de ENTRADA (AU-71). Un campo de la entrada directa se cita como `$json.campo`; el de un paso
  anterior, como `$('Paso').item.campo`, y como `$('Paso').first().campo` cuando entre los dos hay un paso que rehace
  las filas (AU-13). La ficha enseña el nombre del campo y nunca su clave (AU-25); en un resultado de «Agrupar» o de
  «Contar o sumar», el nombre se hace con la medida y el nombre del campo («Suma de Importe», «Número de filas»),
  desde `i18n.ts`. Una cita de un paso o de un campo que ya no existe se ve como una ficha en rojo con lo que citaba.
  El icono de la ficha es el del paso del que es el campo (en `$json`, el paso del que cuelga). La ficha lleva
  también el paso cuando otro paso del camino tiene un campo con el mismo nombre. Un paso con dos entradas
  («Combinar») no tiene fila actual: un campo soltado en un valor suyo se cita por su paso, con `first()`.
  Hecho en F: arrastrar desde «Esquema» (de la entrada y de un paso anterior elegido en la cabecera, y un campo de
  una fila relacionada), las tres formas de cita, la ficha con el icono y el nombre (con el paso cuando hace falta),
  la ficha en rojo con el motivo, y el nombre de los resultados. Donde se enseña un valor de una fila («Esquema»,
  «Tabla», «Haría esto», una ficha, lo que da una expresión), una opción se lee por su nombre, nunca por su id;
  «JSON» la deja como está.
- **AU-22** (F14c, hecho) · Una expresión es texto con JavaScript entre `{{ }}`:
  `Hola {{ $json.nombre }}, llevas {{ $('Sumar gastos').first().total }} € este mes`. Escribir `{{` en un valor fijo
  lo pasa a expresión.
  En la F14c: cada `{{ }}` es una cita sencilla (la resuelve el servidor, AU-162) o JavaScript (va a la caja), y las
  dos conviven en un mismo valor. Un `{{ }}` termina en el primer `}}` que deja antes una expresión de JavaScript
  entera, así que un objeto o un texto con `}}` dentro no lo cierran. Dentro va una expresión que da un valor, no
  sentencias. Un valor que es un solo `{{ }}` conserva el tipo de lo que da; con texto alrededor es texto (nada para
  `null`, el JSON para un objeto). Una expresión no lee colecciones: `$col` es solo de «Código» (AU-46). Mientras el
  servidor no le pasa la caja al motor, la validación sigue diciendo que el JavaScript está por llegar.
  Hecho en E1: la caja evalúa las expresiones de una petición para cada fila y las contesta en orden; `undefined` da
  `null`.
  Hecho en E2: leerlos (`codeParts`, `isWholeExpression`, `joinParts`): dónde termina cada `{{ }}`, uno sin cerrar
  da `code.syntax` con su sitio, una sentencia o una asignación no pasan, un valor de un solo `{{ }}` conserva su
  tipo, y `expr.code` solo sale sin caja.
  Hecho en P1: en el editor, un `{{ }}` de JavaScript se ve como su texto en letra de código, junto a las fichas de
  las citas sencillas, y escribir `{{` en un valor fijo lo pasa a expresión con el cursor donde estaba (la prueba de
  AU-22 en `e2e-boni/automations-code.spec.ts`). Con la caja del servidor (S1-b) el motor los manda a la caja al
  probar y al ejecutar: lo comprueba la prueba de AU-27 en la app de escritorio.
- **AU-23** (F14c, hecho) · Debajo de una expresión se ve lo que vale con la fila actual («= 5 · con la fila 3
  de 128»), y se pasa de fila. Si no se puede calcular dice qué hacer: «Sin datos de entrada».
  En la F14c: el valor lo calcula el servidor en la caja (AU-27) con las filas que guardó la prueba y con su hora y su
  semilla. Se pide cuando Juan deja de escribir, y la respuesta de un texto anterior nunca pisa la de uno posterior.
  Con un paso anterior sin probar o desfasado no se pide nada a la caja y dice cuáles probar. Un fallo se dice debajo,
  con sus palabras.
  Hecho en E3: `preview` (`preview.ts`) calcula el valor con `evaluate`, con la misma caja, con las filas que guardó
  la prueba y con su hora y su semilla (`Kept.clock`); con un paso anterior sin probar o desfasado no pide nada a la
  caja y dice cuáles, en el orden de probarlos; un fallo da su código.
  Hecho en S1: `previewExpression` (`apps/server/src/automations/service.ts`) da ese valor con las pruebas que guarda
  el almacén y con la hora y la semilla de la prueba del paso, sin leer una prueba desfasada: con el «Código» de antes
  cambiado da «sin probar» y cuál (la prueba de AU-27 sobre la caja real).
  Hecho en P1: la ruta `GET …/test/preview` (`routes.ts`, con su prueba), con la fila que se pide; una cita sencilla
  se resuelve en la app y el JavaScript se pide al servidor 300 ms después de la última tecla, y la respuesta de un
  texto anterior no pisa la de uno posterior (mientras llega, la línea se atenúa). «‹ ›» pasa por las filas que
  llegan al paso. Un paso anterior sin probar dice cuáles probar antes, y un fallo dice su línea y su mensaje como
  texto. Cada valor de la petición va escapado del todo (`queryValue`), así que cabe en los caminos que dejan
  pasar `Net.kt` y `paths.cjs` sin cambiarlos (`client.test.ts`). Con 3.000 filas, el servidor calcula cada línea
  mientras se escribe en menos de 600 ms (`box.test.ts`, A-15). Lo comprueban las pruebas de AU-23 en
  `e2e-boni/automations-code.spec.ts` y, en la app de escritorio sobre la caja real, la de AU-27.
  Hecho al cerrar la F14c: en el teléfono la línea dice el valor con la fila de la prueba y la expresión no se puede
  escribir (la prueba «AU-23 · AU-74 · on the phone…» de `e2e-boni/automations-code.spec.ts`).
- **AU-24** (F14c, hecho) · Lo que se puede citar, igual en expresiones y en «Código»: `$json` (la fila actual),
  `$input` (`.all()`, `.first()`, `.last()`, `.item`), `$('Nombre de un paso')`, `$now` y `$today`, `$run` (si es
  prueba, quién la inició), `$page` (los valores de la página que la inició: F17) y las ayudas de fechas, texto y
  listas.
  Los nombres son los de n8n donde la cosa es la misma (decisión menor del §10).
  En la F14c: la lista es `CODE_GLOBALS` (`javascript.ts`): los de arriba, `$date(valor)` y `console`. `$json` y
  `.item` no existen en un «Código» que corre una vez con todas las filas. `$run` dice si es una prueba y qué la
  inició (`"user"`), nunca un nombre ni un id. `$page` es `null` hasta la F17. Las ayudas de texto y de listas son las
  de JavaScript (`String`, `Array`, `Object`, `Math`, `JSON`), sin métodos añadidos a sus prototipos: los que n8n
  añade a los valores no se prometen. Un `$nombre` que no está en la lista no pasa la validación.
  Hecho en E1: en la caja, todo lo de la lista con su sentido, `$json` y `.item` fallan con todas las filas, un paso
  que la petición no trae falla por su nombre y nada se añade a los prototipos.
  Hecho en E2: `readCode` lee los mismos nombres en los dos sitios, y la validación da `code.unknownGlobal`,
  `expr.noCurrentRow`, `expr.notBefore`, `expr.cannotPair`, `code.readInExpression` y `code.cannotWait`.
  Hecho en P1: cada uno de esos problemas tiene sus palabras en los dos idiomas (`words.ts`, `words.test.ts`), y se
  ven en la tarjeta del paso en el lienzo, y los de la vista previa debajo de la expresión.
  Hecho en P2: en un «Código», cada problema con sitio se marca en él en su editor, y los demás se dicen debajo
  (AU-36; las pruebas de AU-36 en `code.test.ts` y en `e2e-boni/automations-code.spec.ts`).
- **AU-25** (F14c, en parte) · Los campos se citan por su clave (`$json.importe`); la entrada, el autocompletado y
  las fichas enseñan su nombre («Importe»). Una clave solo se ve donde se escribe código (excepción a I-08): en una
  expresión, en un «Código» y, en la vista de un paso «Código», al lado del nombre de cada campo de su entrada, que
  es donde hace falta para citarlo. Un campo que nace en un «Código» o en una expresión no tiene más nombre que el
  que ahí se le dio, y con ese se ve en los pasos siguientes (`gastado`).
  En la F14c: una clave que la fila no tiene da `undefined`, no un error; el editor la subraya si la última prueba del
  paso citado no dio ese campo (AU-36).
  Hecho en E1: en la caja, una clave que falta da `undefined` y una como `__proto__`, `constructor` o `toString` es un
  campo más, al entrar y al salir.
  Hecho en E2: `readCode` dice qué campos lee el código (`$json.importe`, `$json['importe']`, desestructurando) y, si
  pasa la fila entera o calcula la clave, que los lee todos.
  Hecho en E3: al salir, `rowsOf` toma las claves de lo que dio la caja como campos y nada más: `__proto__`,
  `constructor` o `toString` son campos de la fila y no tocan ningún objeto del motor; al entrar, una fila o la de un
  paso citado con esas claves se manda con ellas, y su etiqueta es la de sus campos, nunca un miembro heredado.
  Hecho en P2: en la vista de un «Código», cada campo de su ENTRADA lleva su clave al lado del nombre («Importe ·
  importe»); el autocompletado del editor es `completions` (tras `$json.`, `$input.first().` y
  `$('Paso').first().`, probado en E2) y escribe la clave enseñando el nombre; en la app lo prueba
  `$input.first().` (`e2e-boni/automations-code.spec.ts`). Falta, en la tarea 139 de la cola: arrastrar un campo a
  JavaScript escribe su clave, y ningún otro sitio enseña una.
- **AU-26** (F14a, hecho) · Lo que da forma al paso no puede ser una expresión: la colección, la acción, el modo.
  Se lee en el lienzo y el mapa lo sabe antes de ejecutar (D-48).
- **AU-27** (F14c, hecho) · La vista previa y la ejecución usan el mismo motor de JavaScript, la caja: lo que
  enseña la vista previa es lo que saldrá.
  En la F14c: la vista previa llama a la misma función del motor (`evaluate`, `box.ts`) con la misma caja y con la
  hora, la semilla y la fila de la prueba que guardó las filas. No hay un segundo intérprete en el navegador.
  Hecho en E3: `preview` llama a `evaluate` con la caja que se le da y con la hora, la semilla y la fila de la prueba
  guardada, y da lo mismo que dio la prueba; ningún fichero de la app web evalúa código ni trae un intérprete (lo
  comprueba `box.test.ts`).
  Hecho en S1: la misma igualdad sobre la caja real y el almacén, para una tabla de expresiones con fechas en la zona
  de Juan en los días de cambio de hora de 2026, también a la hora que no existe y a la que hay dos veces, y con azar
  (`apps/server/src/automations/box.test.ts`).
  Hecho en P1: la línea debajo de la expresión. En la app de escritorio sobre el servidor y la caja reales, con
  3.000 filas, lo que dice fila a fila es lo que dio la prueba a esa fila, y lo escrito después lo calcula la caja
  (`e2e-boni-desktop/automations-code.spec.ts`). Falta: que lo mismo valga para «Código» (AU-30, P2).
  Hecho en P2: un «Código» no tiene línea debajo; lo que enseña su SALIDA son las filas que guardó su prueba, y en la
  app de escritorio sobre el servidor y la caja reales, con el código del §5.4 y 3.000 filas, esas filas son lo que
  suman los gastos del almacén, categoría a categoría (la prueba del criterio, que lee las filas guardadas).
- **AU-28** (F14c, hecho) · Las fechas tienen una ayuda propia y pequeña sobre `packages/calendar/src/time.ts`
  (`$now.plus({days: 7})`, `.startOf('month')`, `.format(…)`), con la zona horaria de Juan. La caja no tiene `Intl`,
  así que no se promete la biblioteca de fechas de n8n entera.
  En la F14c: `$now`, `$today` y `$date(valor)` dan una fecha con `plus`, `minus`, `startOf`, `endOf`, `diff`,
  `format`, `toISO`, `toDay`, `toMillis` y sus partes (`DATE_HELP`). La semana empieza el lunes. `format` admite solo
  los patrones de la lista; otro falla diciendo cuál. Como la caja no tiene `Intl`, el servidor manda con cada llamada
  los cambios de hora de la zona (de 1970 a 2100) y los nombres de los meses y los días, calculados con `time.ts`; una
  prueba compara la caja con `time.ts` en los días de cambio de hora.
  Hecho en E1: la ayuda en la caja, comparada con `time.ts` en los días de cambio de hora de Madrid, Nueva York, Lord
  Howe y Calcuta; una fecha fuera de la tabla toma el desfase del extremo más cercano. Las horas propias de un `Date`
  (`getHours`) son las del contenedor, UTC: la ayuda es la que sabe de la zona.
  Hecho en S1: el servidor manda con cada llamada la tabla de la zona (`zoneTable`,
  `apps/server/src/automations/box.ts`), calculada con `time.ts` una vez por zona y guardada, y los nombres de los
  meses y los días (`dateNames`), la semana desde el lunes; una prueba compara la tabla con `time.ts` cada día de 1970
  a 2100 en Madrid, Nueva York, Lord Howe, Calcuta y UTC, y los nombres con los de `time.ts`.

### 5.4 El paso «Código»

```js
// Lo gastado por categoría, con el presupuesto de cada una
const categorias = $col('Categorías').find();
const gastado = {};
for (const gasto of $input.all()) {
  gastado[gasto.categoria] = (gastado[gasto.categoria] ?? 0) + gasto.importe;
}
console.log('categorías con gasto:', Object.keys(gastado).length);
return categorias.map((c) => ({
  categoria: c.nombre,
  gastado: gastado[c.id] ?? 0,
  presupuesto: c.presupuesto,
  pasada: (gastado[c.id] ?? 0) > c.presupuesto,
}));
```

- **AU-30** (F14c, hecho) · «Código» es JavaScript. Su parámetro «Se ejecuta» tiene dos modos, a la vista: «Una
  vez con todas las filas» (por defecto) y «Una vez por fila». Devuelve filas.
  En la F14c: el código es el cuerpo de una función: `return` da el resultado. Una lista de objetos son filas, un
  objeto es una fila, `null` o `[]` ninguna; otra cosa, o no devolver nada, falla diciendo cuál. «Una vez por fila»
  conserva de qué fila viene cada una (AU-13); «Una vez con todas las filas» las rehace y corre también con la lista
  vacía. El código no espera: `await`, `async`, `import` y los generadores no pasan la validación.
  Hecho en E1: en la caja, `return` da el resultado, y no devolver nada, una promesa o lo que no es JSON fallan
  diciendo cuál, en los dos modos.
  Hecho en E3: el paso en el motor, fuera de `CATALOGUE` (`CODE_STEP` y sus dos ejecutores): sus filas, de qué fila
  viene cada una en «Una vez por fila», la lista vacía en los dos modos y «Si falla» por fila. Falta: el paso en el
  editor (pantallas).
  Hecho en P2: «Código» en «Añadir paso», bajo «Transformar» y al buscar «código», sin estar en `CATALOGUE`
  (`BESIDE_CATALOGUE`); nace llamado «Código», con «Se ejecuta» a la vista como dos opciones («Una vez con todas las
  filas», la primera) y su editor (AU-36). En la app de escritorio, el código del §5.4 escrito en él corre sobre
  3.000 filas en la caja real.
- **AU-31** (F14c, hecho) · Lee colecciones solo por las conexiones del paso: `$col('Gastos').find({ where,
  sort, limit })`, `.get(id)`, `.count(…)`, `.sum('importe', …)`. `where` es el mismo filtro de las vistas, escrito
  como una lista de reglas: `[{ field: 'importe', op: 'gt', value: 50 }]`. Citar una colección que el paso no tiene
  conectada no pasa la validación (ni se prueba ni se publica): dice «Conecta «Gastos» a este paso», con el botón
  para hacerlo.
  En la F14c: `$col` cita la colección por su nombre, escrito ahí tal cual (un nombre calculado no se admite: AU-163);
  la conexión la guarda por su clave. Hay tres avisos distintos antes de probar: la colección no existe, no está
  conectada (con el botón) o se cita desde una expresión. `get` de una fila que no existe, o que el filtro de la
  conexión deja fuera, da `null`. Una relación llega como el id de la fila relacionada, nunca con sus campos. Cuando
  la caja no tiene una lectura, la evaluación se detiene ahí; el motor la hace y repite (§6, riesgo 4).
  Hecho en E1: en la caja, `find`, `get`, `count` y `sum` dan lo que trae la petición; sin ello la evaluación se para
  ahí, aunque el código atrape los errores, y dice la lectura tal como se escribió y su clave, y las demás filas de la
  tanda siguen.
  Hecho en E2: en la validación, `code.unknownCollection`, `code.notConnected` con la clave de la colección (lo que
  necesita el botón) y `code.readInExpression`; con cualquiera, el paso ni se prueba ni se publica.
  Hecho en E3: el motor hace cada lectura que pide la caja, por `narrow` y por la puerta de la política, y repite la
  llamada con lo leído hasta que ninguna evaluación necesita más; una operación que no es `find`, `get`, `count` ni
  `sum` es `code.read.query`.
  Hecho en S1: el código del §5.4, con colecciones de otros nombres, corre en una prueba sobre el almacén real con
  3.000 filas y la caja real, y da lo mismo dos veces. Falta: el aviso con su botón en la app (pantallas).
  Hecho en P2: debajo del editor, «Conecta «Gastos» a este paso», una vez por colección aunque se cite dos, con
  «Conectar», que le añade la conexión que lee sin filtros y no guarda nada (nunca con permiso de guardar: eso es
  AU-176); mientras está, «Probar paso» no se puede pulsar y dice por qué. En la app de escritorio, sobre la caja real
  y 3.000 filas, con el código del §5.4. La fila de la conexión en su tabla es AU-41 (P3).
- **AU-32** (F14c, hecho) · El código no escribe por sí mismo (lo de A-09 se queda: pide, y Boni comprueba y
  aplica). Devuelve filas y las escriben los pasos «Colección» que le siguen, que pasan por la política; o pide
  guardar por una conexión que lo permite, y lo guarda el motor (AU-172 a AU-176, Juan, 2026-11-16).
  En la F14c: `$col(…)` tiene `find`, `get`, `count` y `sum` y, para pedir guardar, `create`, `update` y `remove`
  (AU-172); el motor nunca escribe lo que no pasó por la conexión, el análisis y la política (AU-183). Las filas que
  salen de «Código» no son filas guardadas aunque copien su id: el paso «Colección» que le sigue las busca o las casa
  por un campo, no por «Las filas que llegan».
  Hecho en E1: `$col(…)` de la caja tiene solo `find`, `get`, `count` y `sum`, y una expresión no tiene `$col`.
  Hecho en E3: el motor no le pide a la puerta ninguna escritura por lo que responda la caja, y las filas de «Código»
  no tienen origen: un paso «Colección» con «Las filas que llegan» detrás falla con `row.notSaved`.
  Comprobado en P1: la vista previa no escribe (en una expresión no hay `$col`, AU-184).
  Hecho en la F14d (E1): lo que pide un «Código» por una conexión con «Sí» lo guarda el motor, y con «Preguntar»
  espera (las pruebas de AU-186 en `consent.test.ts` y `writes.test.ts`). Hecho en P3: la conexión que lo permite,
  en la app (AU-176).
- **AU-33** (F14c, hecho) · `console.log` se ve en la «Consola» del paso, una franja plegable debajo de su
  salida, con la línea que lo escribió. Un error señala su línea en el editor y dice el mensaje tal cual.
  En la F14c: la consola se guarda con la prueba del paso: hasta 200 líneas de 2.000 caracteres. Las que sobran se
  cuentan («y 340 líneas más») y no hacen fallar el paso. La consola y el mensaje de un error son texto de quien
  escribió el código: se pintan como texto plano y no van al registro del servidor.
  Hecho en E1: la caja da cada línea con su nivel, su texto, la línea del código y, por fila, la fila, cuenta las que
  pasan del tope y corta las largas; un error da su mensaje, su línea y su columna, y lo lanzado que no es un `Error`
  se dice como texto.
  Hecho en E3: la consola queda en el registro del paso (`StepRecord.console`), con sus topes y lo que sobra contado,
  y un paso reutilizado conserva la suya; el mensaje de un error va solo en el registro (`StepError.why`), nunca en
  `StepError.message`.
  Hecho en S1: la consola y el mensaje de un error quedan con la prueba del paso en el almacén de Juan, y ninguno se
  escribe en la salida del servidor (lo comprueba una prueba que escucha `console` y la salida del proceso). Falta
  (pantallas): darlos a la app con la prueba del paso, la «Consola» y la marca en el editor.
  Hecho en P2: el servidor da la consola con la prueba del paso (`StepTestView.console`); la «Consola», plegable
  debajo de la SALIDA, pinta cada línea como texto plano con su línea y, por fila, su fila, deja fuera lo que no es
  una línea de texto y dice «y 340 líneas más»; un fallo marca su línea en el editor y dice el mensaje tal cual. En la
  app de escritorio, el `console.log` del §5.4 se ve con su línea.
- **AU-34** (F14c, hecho) · Sin red, sin ficheros, sin reloj propio (`$now` es la hora de la ejecución) y con el
  azar sembrado: repetir una ejecución da lo mismo.
  En la F14c: `Date.now()` y `new Date()` dan también la hora de la ejecución. La hora se toma una vez al empezar la
  ejecución, y la semilla también; las dos se guardan con ella. El azar de una fila sale de la semilla, del id del
  paso y del sitio de la fila: no depende del tamaño de la tanda ni de los reintentos. «Repetir da lo mismo» vale con
  lo mismo guardado: una lectura de una colección da lo que haya en ese momento. En una prueba, un paso guardado que
  leyó la hora o el azar se reutiliza tal como quedó (AU-91), igual que uno que leyó una colección (su salida dice
  cuándo se probó, AU-72); cuando vuelve a correr recibe la hora y la semilla de la prueba nueva.
  Hecho en E1: en la caja, `Date.now()`, `new Date()` y `$now` dan la hora de la petición, no hay `performance`,
  temporizadores, `Atomics` ni `crypto`, el azar sale de la semilla y del sitio de la fila (igual sola que en una
  tanda), y la respuesta dice si cada evaluación leyó la hora o el azar.
  Hecho en E3: la hora se toma una vez al empezar (`Execution.started`) y la semilla también (`Execution.seed`, cuando
  corrió JavaScript); cada paso recibe una semilla hecha de la de la ejecución y de su id (`seedOf`), cada paso
  guardado guarda las dos (`Kept.clock`) y su registro dice si leyó la hora o el azar (`StepRecord.uses`).
  Hecho en S1: la prueba guarda en el almacén la hora y la semilla de cada paso (`KeptRecord.clock`); «Probar paso» en
  un paso posterior reutiliza lo que dio el «Código» anterior, con su hora, y al volver a correr el «Código» toma la
  hora y la semilla de la prueba nueva.
- **AU-35** (F14c, hecho) · La caja tiene tiempo, memoria y tamaño máximos. Pasarse dice cuál y por cuánto.
  En la F14c: cada tope es un número con nombre (`CODE_LIMITS`, `code.ts`): los caracteres de un «Código» (20.000) y
  de una expresión (2.000), que comprueba la validación; el tiempo de una llamada (5 s), sus operaciones, su memoria
  (64 MB) y su pila, lo que se le manda (8 MB), lo que devuelve (4 MB y 10.000 filas), las lecturas de una evaluación
  (20) y de un paso (100), las filas (5.000) y los bytes (2 MB) de una lectura, los bytes que lee un paso (4 MB) y las
  líneas de la consola, que se recortan sin hacer fallar el paso (AU-33). Son los de partida: se bajan si al medir
  (AU-38) no caben en la caja o en el servidor. «Por cuánto» se dice donde se puede saber (tamaños, filas, lecturas);
  el tiempo, las operaciones y la memoria se cortan en el tope, y se dice el tope. Sin caja, o con la caja ocupada, el
  paso falla diciéndolo y no corre nada.
  Hecho en E1: los topes de la caja (`EVAL_DEFAULT_LIMITS` y `EVAL_MAX_LIMITS`, `packages/sandbox`): tiempo,
  operaciones, memoria, pila, tamaño de la respuesta, líneas de la consola y lecturas distintas, y tras cada uno la
  caja sirve la llamada siguiente. La pila es de 256 KB: con 512 KB una recursión sin fin desbordaba antes la pila del
  hilo de la caja y rompía la llamada entera; con 256 KB es un error del código, a unas 1.500 llamadas de hondo.
  Hecho en E2: `code.long`, con el tope y lo que tiene, para un «Código» y para el JavaScript de un `{{ }}`.
  Hecho en E3: `code.limit` con el nombre del tope, el tope y, donde se sabe, lo alcanzado: lo que se manda a la caja
  (8 MB, antes de mandarlo), las filas que devuelve, las lecturas de una evaluación y de un paso, y los bytes de una
  lectura y de un paso.
  Hecho en S1: el servidor manda a la caja los topes del motor en cada llamada (`BOX_LIMITS`, ninguno por encima de
  `EVAL_MAX_LIMITS`), y cada falta de la caja es su código: tiempo, operaciones, memoria y respuesta son `code.limit`
  con el tope (un bucle sin fin lo para la cuenta de operaciones de la caja real); sin caja, con la puerta llena o con
  una respuesta que no es del protocolo (no es JSON, es de otra llamada o es demasiado larga), `code.unavailable` («busy»
  con la puerta llena), y no se lee nada; a una caja que no contesta no se la espera más que el tiempo de la llamada y
  un margen de 5 s. Una respuesta de 2 MB pasa y una de 5 MB falla.
  Hecho en P1: cada tope tiene sus palabras en los dos idiomas, con cuál y, donde se sabe, por cuánto (`words.ts`,
  `words.test.ts`), y un `{{ }}` demasiado largo lo dice debajo antes de probar, sin pedir nada al servidor (la
  prueba de AU-35 en `e2e-boni/automations-code.spec.ts`). Falta: que un «Código» lo diga en su editor (P2).
  Hecho en P2: debajo del editor de un «Código», cuántos caracteres tiene de los 20.000; pasarse lo dice en `--bad`
  con el tope y lo que tiene, sin marcar el código y sin dejar probar, y un tope pasado al probar se dice con sus
  palabras en la vista del paso.
- **AU-36** (F14c, hecho) · El editor completa los pasos anteriores, los campos por su nombre y las colecciones
  conectadas, y marca lo que no existe antes de probar.
  En la F14c: el editor lee el código con el mismo lector que el servidor (`readCode`, `javascript.ts`), así que lo
  que marca es lo que dirá la validación. Un campo que la última prueba del paso citado no dio se subraya como aviso y
  no impide probar.
  Hecho en E2: el modelo del editor. `completions` da los nombres de `CODE_GLOBALS`, los pasos que siempre corren
  antes, los campos que dio la última prueba (se escribe la clave y se enseña el nombre), también tras `$json.` y
  `$input.first().` con los de los pasos cuyas filas llegan a este, y las colecciones conectadas; tras otro punto no
  da nada; cada problema lleva su sitio (`line`, `column`, `from`, `to`), contado desde el principio del valor; y un
  campo que la última prueba no dio, del paso citado o de los que llegan, es `code.fieldNotGiven`, un aviso con el
  que `canRun` sigue. Falta: el editor que los pinta (pantallas).
  Hecho en P2: el editor (CodeMirror 6, cargado al abrir el primer «Código»; `CodeEditor.tsx`): completa con
  `completions`, marca cada problema en su sitio (los errores en `--bad`, los avisos en `--warn`), y un error deja
  «Probar paso» sin pulsar diciendo por qué; con los colores del tema de la app y con el teclado (Tab sangra, Escape
  cierra la lista sin salir del editor). Lo que marca es lo que da `validate` para el mismo borrador, sin más ni menos,
  en una tabla de códigos (`code.test.ts`). Sin probar, en el escritorio: que tecla a tecla, a la velocidad de una
  persona, el editor no se quede atrás con 3.000 filas (la prueba escribe línea a línea).
  En el teléfono (AU-74), un «Código» es para leer: su código no se cambia, «Se ejecuta» tampoco, el aviso de una
  colección sin conectar no lleva «Conectar» y no hay «Probar paso» (la prueba de AU-74 en
  `e2e-boni/automations-code.spec.ts`).
- **AU-37** (F14c, hecho) · Una evaluación no deja nada a la siguiente: ni variables ni prototipos cambiados. El
  código puede cambiar las filas que le llegan al paso (`for (const fila of $input.all()) fila.total = 1; return
  $input.all()`), y lo que devuelve es lo que da el paso. Cada evaluación tiene su propia copia de esas filas, así que
  un cambio no sale de ella: no llega a otra tanda, a otra evaluación, a lo que dio el paso anterior (la ENTRADA de una
  prueba enseña lo que llegó) ni a la colección, y una pasada repetida tras una lectura empieza de las filas como
  llegaron. Lo demás se mira y no se cambia: las filas de otros pasos (`$('…')`), lo leído de una colección y `$run`;
  para cambiarlo se cambia una copia (`{ ...fila }`). (Juan, 2026-11-16; antes tampoco se podían cambiar las filas que
  llegan.)
  En la F14c: vale entre dos llamadas (un intérprete nuevo cada vez) y entre dos filas de la misma tanda. Escribir en
  lo que no se cambia, o en lo que trae el intérprete, falla (`code.frozen`) diciendo que se cambie una copia. La
  respuesta de una tanda es la de sus filas mandadas de una en una.
  Hecho en E1: la caja. Lo deciden dos funciones juntas en `apps/sandbox/src/world.js`: `listOf` da a cada evaluación
  su copia de las filas del paso, fila a fila según las toca, y `received` congela todo lo demás. Medido con 3.000
  filas: copiar también las filas de otros pasos y lo leído hacía diez veces más lento buscar, desde cada fila, en
  otro paso de 3.000 filas (3,2 s contra 37; una tanda de 500 pasaba de los 5 s del tope), y por eso se quedan para
  mirar.
  Hecho en E3: el motor no guarda de una evaluación más que sus valores, su consola y su cuenta, y lo que dio el paso
  anterior, la ENTRADA de una prueba y la colección siguen siendo lo que llegó aunque el código cambie sus filas.
- **AU-38** (F14c, hecho) · Lo que cuesta evaluar una expresión por fila se mide con 3.000 filas antes de salir
  (A-15), y un paso «por fila» manda las filas a la caja por tandas, no de una en una.
  En la F14c: las expresiones de un paso se calculan para todas sus filas antes de trabajar las filas, por tandas de
  500 y todas las expresiones del paso en la misma llamada. El tiempo fijado se escribe en las pruebas al medir, que
  es lo primero que se hace: con eso se decide entre repetir la evaluación y un intérprete con pausas (§6, riesgo 4).
  Medido en E1 (2026-11-16, 3.000 filas, en el portátil), se queda **repetir la evaluación**: con todas las filas y
  una lectura, unos 70 ms; con 20 lecturas distintas, unos 780 (21 llamadas), y una lectura de 3.000 filas, unos 120.
  El intérprete con pausas es una vez y media más lento por evaluación (80 ms contra 55 una expresión en tandas de
  500; 118 contra 73 un «Código» por fila) y solo gana con muchas lecturas distintas, que el tope y su aviso ya
  evitan. Cada llamada por la puerta de la caja cuesta además unos 200 ms, sea cual sea su tamaño. La prueba de la
  caja fija los topes de los cuatro casos de la regla, en milisegundos de CPU (1.000, 1.000, 800 y 1.000, frente a
  unos 60, 80, 75 y 120 medidos); las demás cifras son las de esta medida.
  Hecho en E3: el motor calcula las expresiones de un paso para todas sus filas antes de trabajarlas, por tandas de
  500 (`CODE_LIMITS.batchRows`) y todas en la misma llamada: con 3.000 filas, 6 llamadas por paso con JavaScript, y
  ninguna con solo citas sencillas. Medido en E3 (2026-11-16, por la puerta de la caja, con el portátil muy cargado:
  carga 26 en 8 núcleos): cinco pasos con JavaScript sobre 3.000 filas (tres con expresiones, un «Código» por fila y
  uno con todas) hacen 25 llamadas y tardan 43 s; cada llamada, 1,5 s de media, de los que la caja cuenta 0,6. A unos
  205 ms por llamada serían unos 5 s.
  Medido en S1 (2026-11-16, sobre el servidor con la caja real y el almacén, carga 1,3 a 1,7 en 8 núcleos): los mismos
  cinco pasos sobre 3.000 filas hacen 27 llamadas (el «Código» con todas las filas lee dos colecciones) y la prueba
  entera tarda de 5,4 a 6,0 s; cada llamada, unos 140 ms de media, de los que la caja cuenta 47. Una llamada vacía
  cuesta 100 ms y la caja cuenta 11: unos 90 ms por llamada eran arrancar su hilo y su intérprete, casi dos tercios de
  una llamada media; con hilos de reserva arrancados antes (tarea 138, medido el mismo día con carga 2 a 3), la vacía
  cuesta de 68 a 74 ms, la media unos 98 y la prueba entera 3,3 s. La prueba fija 10 s de reloj (ensanchados por la
  carga, `under`) y que el montón del servidor no crezca 160 MB (creció entre 44 y 85). Falta: en la app de escritorio (pantallas).
  Hecho en P2: en la app de escritorio sobre el servidor y la caja reales, «Probar» de un paso con dos expresiones con
  JavaScript y de un «Código» «Una vez por fila», sobre 3.000 filas, termina dentro de los 15 s que fija esa prueba
  (los 10 s del servidor y lo que cuesta la app), y mientras corre un clic en una tarjeta la selecciona en menos de
  1 s.
**El código que guarda** (Juan, 2026-11-16, decisiones 1 y 4 del §10). Un «Código» puede pedir crear, modificar o
eliminar filas de una colección conectada, si su conexión lo permite (AU-176). Lo pide; lo guarda el motor, por el
mismo camino que un paso «Colección». Antes de ejecutarlo, Boni ya sabe qué puede cambiar, porque lee el código
(AU-183), y lo dice en su tarjeta y en su conexión.

```js
// Pone a cada gasto sin categoría la de su concepto, si alguna regla la conoce
const reglas = $col('Categorías').find();
for (const gasto of $col('Gastos').find({ where: [{ field: 'categoria', op: 'empty' }] })) {
  const regla = reglas.find((r) => gasto.concepto.includes(r.palabra));
  if (regla) $col('Gastos').update(gasto.id, { categoria: regla.id });
}
return [];
```

- **AU-172** (F14c, hecho) · El código pide guardar con tres métodos de `$col('Nombre')`, uno por acción de
  «Colección» y con su palabra: `.create({ campo: valor })` (Crear), `.update(id, { campo: valor })` (Modificar) y
  `.remove(id)` (Eliminar, a la papelera: AU-122). Los campos van por su clave (AU-25); `update` cambia solo los que
  se le dan. Una llamada es una petición: en ese momento no guarda nada y no devuelve nada (`undefined`), porque la
  fila no está guardada hasta que el paso acaba. Para usar una fila creada, un paso posterior la busca («Buscar
  filas»), y ya la encuentra guardada.
  En la F14c: el id es un dato como otro (el de una fila leída con `$col`, que llega con su id: AU-43; el de una
  relación; uno escrito); el motor comprueba al guardar que es una fila de esa colección que la conexión deja ver.
  Una lectura del mismo código no ve lo que acaba de pedir: lee lo guardado, como si las peticiones no existieran.
  Los métodos de escribir solo existen en «Código»; en una expresión no hay `$col` (AU-184).
  Hecho en W1: el análisis lee los tres métodos por su nombre, y cada llamada es una petición de su acción, en el
  orden del código. Hecho en W2: en la caja la llamada no guarda nada y devuelve `undefined`, una lectura no ve lo
  pedido, y un id que no es de una fila que la conexión deja ver hace fallar el paso (`code.write.outside`). Con dos
  llamadas anidadas (`.create({ x: $col('A').update(…) })`) las peticiones van en el orden en que corren, primero la
  de dentro; el análisis las da en el orden del texto, lo que no cambia lo que permite.
- **AU-173** (F14c, hecho) · Lo pide el código y lo guarda el motor. La caja sigue sin camino al almacén: una
  petición es un dato más de lo que devuelve la evaluación. Cuando el paso termina, el motor aplica sus peticiones en
  el orden en que se pidieron, por la misma puerta de la política y con el mismo ejecutor y la misma validación que
  la acción de un paso «Colección» (AU-120, AU-121, AU-168).
  En la F14c: el orden es el de las llamadas dentro de una evaluación y, en «Una vez por fila», el de las filas de la
  entrada. Con lecturas por repetición (§6, riesgo 4) una evaluación corre varias veces; solo cuentan las peticiones
  de su última pasada, la que acaba: las de una pasada parada en una lectura se tiran. Modificar y eliminar leen antes
  la fila guardada, sin otra pregunta a la política (como en AU-168), para comprobar sus límites (AU-177), para «Haría
  esto» y para la versión con la que se guarda (`row.changed` si cambió entretanto, AU-04).
  Hecho en W2: la evaluación devuelve sus peticiones con la respuesta (`writes`), solo las de la última pasada; el
  motor las aplica en ese orden con `applyWrites` (`writes.ts`), que lee cada fila una vez antes y guarda con su
  versión.
- **AU-174** (F14c, hecho) · Todo o nada. Lo que pide un paso es un solo cambio: se guarda entero o no se guarda
  nada. Si el código lanza un error, si el paso falla o si una sola petición no se puede guardar (no pasa la
  validación, su fila cambió, la política la niega, se sale de la conexión), no se guarda ninguna y el paso falla
  diciendo cuál. Reintentar el paso (AU-16) no escribe dos veces.
  En la F14c: el motor pregunta a la política por todas antes de guardar la primera, y las guarda en una sola
  transacción del almacén. Si la política pide preguntar alguna (algo de fuera o eliminar, sin lo que pide
  AU-186: P4, P5) o la conexión dice «Preguntar» en una acción que pide, el cambio entero del paso espera a Juan como
  una sola propuesta («Esta ejecución quiere modificar 12 filas en Gastos»), y no se guarda nada de él hasta que la
  acepta: modificar con «Sí» y eliminar con «Preguntar» en el mismo paso espera entero («todo junto», Juan,
  2026-11-16). En «Una vez por fila» con «Si falla: seguir» o «salir por error», lo que pidió una fila
  que falló se tira y lo de las demás es el cambio del paso. Cada escritura lleva la ejecución en el registro de
  operaciones, así que «Deshacer lo que hizo» (AU-18, AU-100: F14d) la deshace con todo lo de esa ejecución, como las
  de un paso «Colección».
  Hecho en W2: la política se pregunta por todas antes de guardar (`decideAll`), las guarda una sola transacción
  (`applyAll`, también en el almacén del servidor: dos cambios de una fila van en orden y, si el último falla, no
  queda ninguno), el cambio que espera es una sola propuesta del paso, y con «seguir» o «salir por error» lo de una
  fila que falló se tira.
  Hecho en S1-c: en el almacén de verdad, cada operación que guarda un paso lleva la ejecución en el registro
  (`runDeps`, `CollectionsFor.run`): el cambio de 3.000 filas de un paso va en una transacción; si la fila 3.000 cambió
  desde que se leyó no se guarda ninguna, leída otra vez se guardan todas, y `undoRun` deshace el paso entero. Lo
  mide su prueba: unos 3 s para guardar las 3.000 y otros tantos para deshacerlas, todo del `update` del almacén, que
  tarda más cuantos más registros tiene (una tarea aparte). Las rutas de una ejecución de verdad y «Deshacer lo que
  hizo» son de la F14d (AU-95, AU-18, AU-100).
- **AU-175** (F14c, hecho) · Lo que se puede pedir tiene topes, cada uno un número con nombre
  (`WRITE_LIMITS`, `writes.ts`): peticiones por evaluación (5.000) y por paso (5.000), el tamaño de una (64 KB) y el
  de todas las de un paso (4 MB). Pasarse hace fallar el paso, dice cuál y por cuánto, y no guarda nada: nunca se
  recorta, porque guardar la mitad de un cambio sería guardar otro.
  En la F14c: 5.000 porque es lo que da una lectura (`readRows`): lo que se lee de una vez se puede reescribir de
  una vez, y los miles de filas de Juan caben en un paso. La caja cuenta las de una evaluación mientras corre (para un
  bucle sin fin en cuanto se pasa); el motor, las del paso. Los topes de la ejecución (filas escritas, AU-17: F14d)
  las cuentan también.
  Hecho en W2: los cuatro topes, en la caja los de una evaluación y en el motor los del paso, y las peticiones
  cuentan en el tamaño de la respuesta (`outputBytes`).
  Hecho en S1: el adaptador de la caja del servidor da la falta `writes` como `code.limit`, y un «Código» que pide
  guardar 5.001 filas falla así en una prueba (que no escribe nunca).
  Hecho en S1-c: en una ejecución de verdad sobre el almacén y la caja reales, con «Preguntar» no se guarda nada: el
  cambio de 3.000 filas espera como una sola propuesta (con «Sí» se guarda desde la F14d, AU-186), y pasarse de las peticiones de una evaluación
  (5.001) o de las de un paso (dos por fila de 3.000) falla con `code.limit`, sin propuesta y sin una operación en el
  registro.
  Hecho en la F14d (E2): lo que pide un «Código» cuenta en las filas escritas de la ejecución (AU-17) antes de
  preguntar a la política, con «Sí» como con «Preguntar» (la prueba «AU-17 · a «Código» whose change…» de
  `writes.test.ts`).

- **AU-39** (F19, pendiente) · «Escribir con IA»: Juan dice lo que quiere y Boni propone el código viendo los nombres
  de los campos, nunca sus valores. Se acepta o no.

Lo que «Función» + «Aplicar cambios» hacía (tarea 93) pasa a ser «Código» + pasos «Colección» (decisión 4 del §10).

### 5.5 Conexiones con colecciones y sus límites

```ts
interface Connection {
  collection: string;        // a literal, so the map knows it before any run (D-48)
  read:   false | { where?: FilterItem[]; fields?: string[]; limit?: number };
  create: false | { mode: "ask" | "yes"; fields?: string[]; fixed?: Record<string, Param> };
  update: false | { mode: "ask" | "yes"; where?: FilterItem[]; fields?: string[] };
  remove: false | { mode: "ask" | "yes"; where?: FilterItem[] };   // to the trash (AU-122); "yes" by hand (AU-188)
}
```

- **AU-40** (F14c, hecho) · Una conexión une un paso con una colección y dice qué puede hacer en ella: leer,
  crear, modificar, eliminar. En el lienzo cuelga debajo del paso con una línea de puntos: una ficha por colección,
  con sus permisos en palabras («Lee · solo este año», «Crear: pregunta antes»).
  En la F14c: una conexión por colección, hasta 12 por paso, guardadas en el paso (`connections`).
  Hecho en E2: el formato (cerrado: una clave que no conoce no se lee), `connection.repeated`, `connection.unknown`
  y `connection.many`, y `permissions`, de donde salen sus palabras.
  Hecho en P3: bajo la tarjeta de un «Código», una ficha por conexión colgada de una línea de puntos, con el nombre
  de la colección y sus palabras (AU-178); va dentro de la caja del paso, así que la sigue cuando se mueve o Boni
  coloca las cajas.
- **AU-41** (F14c, hecho) · En la vista del paso es una tabla: una fila por colección y una columna por acción.
  Leer es «No» o «Sí»; crear, modificar y eliminar, «No», «Preguntar» o «Sí», cada una por su lado (Juan, 2026-11-16;
  antes eliminar era solo «No» o «Preguntar»). Eliminar manda siempre a la papelera (AU-122), y lo que no pregunta lo
  dice AU-186. Al conectar una colección solo se lee; cada permiso de escribir se da a mano. La fila se abre para
  poner los límites de cada acción (AU-43, AU-48), y un permiso con límites lo dice en su celda: «Sí · con filtro». En
  «Código» y en «Agente» la tabla es la misma, con las cuatro columnas (AU-176, Juan, 2026-11-16).
  En la F14c: en un «Código», leer es siempre «Sí» (sin leer no hay conexión) y las tres de escribir son las de
  arriba.
  Hecho en E2: `newConnection` solo lee, y un límite que no lo es (un campo que la colección no tiene, un límite de 0
  o de más de 5.000) es `connection.limits`.
  Hecho en W1: `connectionActions` de «Código» da las cuatro, y crear, modificar y eliminar se leen con «Preguntar» o
  «Sí», cada una por su lado; `connection.write`, el problema de un permiso de escribir en un «Código» hasta el
  2026-11-16, ya no existe.
  Hecho en P3: la tabla en la vista del «Código» (`AutomationConnections.tsx`): «Leer» dice «Sí» con sus límites
  («Sí · con filtro», «Sí · 4 campos · hasta 200 filas»), y cada celda de escribir es un «No / Preguntar / Sí» por su
  lado, que se guarda con el borrador; cada fila tiene «Desconectar» y abre sus límites (AU-43).
  Hecho en P1 de la F15: la misma tabla en la vista del «Agente»: «Leer» es «No» o «Sí», cada celda dice sus límites
  («Preguntar · hasta 20», «Sí · 1 campo · hasta 5»), y una colección se conecta con «Conectar», que solo ofrece las
  que un modelo puede leer (AU-166); conectada, solo lee (`connections.test.ts`, `automations-ai.spec.ts`).
- **AU-42** (F15, en parte) · «Preguntar» es una propuesta: en una conversación, una tarjeta para aceptar o no; en
  segundo plano, espera en la Bandeja. La ejecución no se queda esperando: termina, y en «Ejecuciones» dice «1
  propuesta sin responder». «Sí» escribe con Deshacer.
  En la F15: lo que un paso de IA quiere escribir con «Preguntar» entra en la propuesta de la ejecución, la de AU-193
  (una por ejecución, con los cambios de todos sus pasos, aceptada desde un dispositivo personal, con Deshacer): un
  paso de IA no trae otra clase de propuesta. De cada cambio dice qué paso lo pide y, si lo eligió una IA, «lo decidió
  la IA» (AU-200). La tarjeta dentro de una conversación llega con el disparador de chat (F16); en la F15 la propuesta
  espera en la Bandeja y en su ejecución. La prueba: `apps/server/src/automations/ai.test.ts`.
  Hecho en S1: en el servidor, lo que un «Agente» pide con «Preguntar» entra en la propuesta de la ejecución junto a
  lo de los otros pasos, y cada cambio de su vista (`AskedView`) dice su paso y `byAgent`, leído de la versión que
  corrió (la guardada, o el documento de una prueba) y nunca del cambio. Falta: pintar «lo decidió la IA» en la
  Bandeja y en la ejecución (P2; la P1 de la F15 no lo hizo). Hecho en P2 de la F15: la tarjeta de la propuesta de
  una ejecución en la Bandeja y la línea de la ejecución dicen «decidido por un modelo», el término de AU-200, en lo
  que decidió un «Agente» (`RunProposalCard`, `didWords`; la línea en `runs.test.ts`). Falta: una prueba en pantalla
  de la marca en la tarjeta (P3).
- **AU-43** (F14c, hecho) · Leer puede llevar «Solo estas filas» (el filtro de las vistas), «Solo estos campos»
  y un límite. El filtro se suma a todo lo que el paso busque: puede estrechar, nunca ensanchar.
  En la F14c: el filtro vale para `find`, `get`, `count` y `sum`. Con «Solo estos campos» la fila llega con esos
  campos y su id, y no se puede filtrar, ordenar ni sumar por un campo que no está entre ellos: preguntar «¿es mayor
  que 50?» por un campo que no se deja leer sería leerlo. El límite de la conexión, como el que pida el código,
  recorta sin fallar. El tope de 5.000 filas por lectura no recorta: una lectura que daría más falla diciéndolo,
  porque media colección dada como entera sumaría mal; `count` y `sum` no lo tienen. Cambiar un límite deja desfasada
  la prueba guardada del paso.
  Hecho en E2: `narrow` suma el filtro de la conexión al que pide el código, niega lo que toca un campo oculto
  (`code.read.query`) y pone el límite (uno pedido por encima del tope no lo levanta: al almacén se le piden como
  mucho 5.001 filas y más de 5.000 fallan); `cutRead` recorta o falla con `code.limit`, y `asRead` da la fila con su
  id y solo esos campos.
  Hecho en E3: la huella de un paso lleva sus conexiones: cambiar un límite o un filtro, o conectar o desconectar una
  colección, deja desfasada su prueba guardada.
  Hecho en S1: sobre el almacén real con 3.000 filas y con el filtro en la conexión, `find`, `get`, `count` y `sum` no
  dan ni cuentan una fila de fuera, un `get` de una fila de fuera da `null` como el de una que no existe, y una
  relación llega como el id de la fila relacionada.
- **AU-48** (F15, en parte) · Cada acción de escribir lleva los suyos: modificar y eliminar, «Solo estas filas»;
  crear y modificar, «Solo estos campos». Por ejemplo, modificar solo la «Categoría» de los gastos que no la tienen.
  Crear puede llevar valores fijos que la IA no elige, y modificar también (decisión 18 del §10).
  En la F15: se guardan en la conexión, en cada acción, donde el formato ya los tiene: `update.where` y
  `update.fields`, `remove.where`, `create.fields` y `create.fixed`; y `update.fixed`, con la misma forma que el de
  crear (decisión 18). Estrechan además de los de leer (AU-177): una fila
  tiene que cumplir el filtro de leer y el de la acción. Valen igual en «Código» y en «Agente», y los comprueba el
  motor con la conexión guardada (`insideConnection`), y para un paso de IA también la política (AU-205). En la
  pantalla van en la fila abierta de la conexión (AU-43), bajo cada acción que no está en «No», con los dos controles
  de leer («Solo estas filas», «Solo estos campos»); la celda lo dice como la de leer: «Preguntar · con filtro»,
  «Sí · 2 campos». Los valores fijos de crear y de modificar se ponen con el control de AU-52. La prueba:
  `packages/automations/src/action-limits.test.ts`.
  Hecho en E1, en el motor y para un «Código» también: `insideConnection` con la acción aplica su filtro además del
  de leer, a la fila guardada al modificar y eliminar y a la fila nueva al crear; `applyWrites` niega un campo fuera
  de los de esa acción (`code.write.notAllowed`, `field`) y pone los valores fijos de crear con la etiqueta de la
  automatización (`own`), y un campo fijo que el código intenta poner se niega igual. Una fila fuera del filtro de la
  acción falla como una que no está (`code.write.outside`, `row`): el fallo no dice si existe. La validación
  (`connection.limits`, `field`) niega un fijo de un campo que la colección no tiene, uno que también está en
  `fields` y uno que no es un valor escrito (una expresión espera a AU-52). `narrow` con la acción estrecha lo que
  un «Agente» verá como filas que puede modificar o eliminar (E3). Falta: la fila abierta en la pantalla (P1), el
  control de AU-52 (P2; las expresiones de `fixed` las resuelve el motor desde E3) y que el servidor ponga la conexión en la llamada de un paso
  de IA para que P29 la compruebe también (S1).
  Hecho en P1 de la F15: la fila abierta de un «Agente» (`AutomationConnections.tsx`): bajo «Leer» sus tres límites,
  y bajo cada acción que no está en «No» los suyos, «Solo estas filas» (modificar y eliminar), los campos (crear y
  modificar, con el control de AU-52) y «Como mucho»; cada uno se guarda en su acción, uno vacío no se guarda, y la
  celda los dice («Preguntar · con filtro · hasta 20», `writeLimitsOf`). Falta: las expresiones en los fijos (P2).
  Hecho en el segundo PR de E3 (decisión 18): `update.fixed`, con la misma forma, la misma validación (un campo que
  la colección no tiene, uno que también está en `fields` y, fuera de un «Agente», uno que no es un valor escrito) y
  el mismo trato que `create.fixed`: cada fila que el paso modifica acaba con esos valores, los pone el código al
  guardar con la etiqueta de la automatización o la de su expresión, y una petición que nombra uno se niega
  (`code.write.notAllowed`, `field`; al modelo, `outside-fields`). Con fijos, una petición de modificar puede no
  nombrar ningún campo suyo: solo pone los fijos. Un campo es de «Solo estos campos» o fijo, nunca las dos cosas. Lo
  que cuenta `create.fixed` cuenta igual `update.fixed`, cada uno con su prueba: cambiarlo al publicar baja el «Sí»
  del paso (AU-188, `consent.test.ts`), es un cambio de su conexión en «Versiones» (AU-96, `versions.test.ts`), y
  «Lo que hizo» y «Probar» lo dicen igual sin guardar nada (`action-limits.test.ts`). El motor lo lee del paso como
  está guardado (`fixedOf` de `engine.ts`), nunca de una petición, del modelo ni de la caja. Falta: el control bajo
  «Modificar» (P2), que la frase del paso diga los fijos (AU-44, P2: hoy no los dice ni para crear) y que el servidor
  lleve los de modificar en la celda de P29 (S1).
- **AU-196** (F15, hecho) · «Como mucho N filas». Cada acción de escribir de una conexión puede llevar un tope
  de filas por ejecución (`limit`, como el de leer, de 1 a 5.000). Cuenta las filas que el paso pide crear,
  modificar o mandar a la papelera con esa acción, se guarden o se propongan, por paso y ejecución, sumando sus
  unidades de trabajo, y se comprueba antes de guardar. En un «Código», la petición que lo pasa falla como
  cualquiera que no se puede guardar (AU-174) y lo dice con los dos números, «Quiso eliminar 240 filas en Tareas ·
  como mucho 20». En un «Agente», la llamada que lo pasaría se niega y se le dice al modelo, sin hacer fallar el
  paso (AU-198, AU-205): puede pedir menos. El tope de la ejecución (AU-17) sigue encima. En un «Agente», una acción
  de escribir nace con «Como mucho 20» en el momento en que su mano saca esa celda de «No», y se ve en la celda
  («Preguntar · hasta 20»): es el límite de Juan a lo que una IA decide. En un «Código» nace sin tope: lo que
  escribe su código lo ha escrito él. El «Permiso» de un paso «Colección» no lleva estos límites: ya tiene su
  condición, y encima el tope de la ejecución. Se
  quita o se cambia en la fila abierta, junto a los otros dos límites de la acción (AU-48). La prueba:
  `packages/automations/src/action-limits.test.ts`.
  Hecho en E1: `limit` en crear, modificar y eliminar (de 1 a 5.000, `ACTION_ROWS_MAX`; fuera, `connection.limits`,
  `limit`); el motor cuenta, antes de leer una fila o de preguntar a la política, todas las peticiones del paso a esa
  colección con esa acción más las que el paso ya pidió en la ejecución (`Run.actionRows`, que suma cada unidad
  después de que su cambio se guarde, se pruebe o se proponga), y la que lo pasa hace fallar el paso con
  `code.write.notAllowed`, `many`, y los dos números (`max`, `got`); no se guarda nada de él. La cuenta se suma
  cuando el cambio entero del paso ha pasado, así que vale igual si la tarea 137 guarda ese cambio en una sola
  transacción. A la política le llega con cada cambio lo que el paso llevaba antes (`written`) para el `over-limit`
  de P29. Un «Agente» nace con 20 en cada acción que sale de «No» (`bornCell`, `allowing` con `AGENT_TYPE`), un
  «Código» sin tope. Medido: 240 peticiones sobre 3.000 filas se niegan en 1 ms. Falta: las palabras «Quiso eliminar
  240 filas en Tareas · como mucho 20» y la celda «Preguntar · hasta 20» (P1; hoy salen las de
  `code.write.notAllowed`). Desde E3 la negación de un «Agente» se le dice al modelo (`over-limit`) sin hacer fallar el paso.
  Hecho en P1 de la F15: la celda «Preguntar · hasta 20» de un «Agente» (nace con 20 cuando la mano la saca de «No»;
  un «Código», sin tope), «Como mucho» en la fila abierta, y las palabras «Quiso eliminar 240 filas en Tareas · como
  mucho 20» en los dos idiomas (`connections.test.ts`, `words.test.ts`, `automations-ai.spec.ts`).
- **AU-44** (F14c, hecho) · Una frase calculada resume todas las conexiones de un paso, debajo de su tabla:
  «Puede leer Gastos (solo los de este año) y Categorías, y proponer filas nuevas en Notas. No puede modificar ni
  eliminar nada.» En la F14c dice lo que lee y lo que el código puede guardar (AU-178). Al
  publicar, otra igual resume la automatización entera («Lo que podrá hacer», AU-96).
  Hecho en E2: `permissions` da todo lo que la frase necesita (cada colección que se lee, con filtro, con menos
  campos o con límite) y nada para un paso sin conexiones.
  Hecho en P3: la frase bajo la tabla, que junta las conexiones que pueden lo mismo («Puede leer Libros (con filtro)
  y Autores. No puede crear, modificar ni eliminar nada.») y cambia con la tabla (`connectionsSentence`).
- **AU-45** (F15, en parte) · Una conexión solo restringe. Nunca deja hacer lo que la política no deja: una
  colección privada no se puede conectar a un paso de IA, y un destino nunca sale de un dato de fuera. Lo de fuera
  con «Sí» se guarda en una versión publicada porque lo dice la política, no la conexión (decisión 11 del §10,
  AU-186; hasta el 2026-11-16 se proponía aunque dijera «Sí»). Eliminar pregunta
  salvo en lo que dice AU-186, que es la política y no la conexión (hasta el 2026-11-16: «eliminar se pregunta
  siempre»).
  En la F15: lo cumple la política, no solo el motor (AU-205): la llamada de un paso de IA a una colección que no
  tiene conectada, a una acción en «No» o fuera de sus límites se niega en `decide`, con la conexión que el servidor
  lee de la versión guardada y pone en la llamada. Una colección privada (AU-166) no sale entre las que se pueden conectar a un paso de IA. Un destino no es
  un parámetro que una IA rellene: «Avisar» y «Responder» no tienen destinatario (AU-201, AU-202). Lo que guarda una
  IA con «Sí» lo dice AU-204: también lo que un «Agente» modifica o elimina cuando le llegó algo de fuera, dentro
  de su conexión (decisión 16 del §10). La prueba: `packages/agent/test/automation-ai.test.ts`.
  Hecho en E1: en `decide`, P29 (AU-205) niega la llamada de un paso de IA fuera de su conexión, y P2 y P14 van
  antes: un destino de fuera se niega por ellas aunque la conexión diga «Sí»; lo que se guarda con «Sí» lo deja P28,
  no la celda. Hecho en E4: «Avisar», «Responder» y «Preguntar» no tienen destinatario (ningún parámetro nombra a
  quién; «Dónde» es una lista cerrada de sus dispositivos, nunca una expresión), y lo de fuera en su texto no cambia
  a dónde va (`people.test.ts`). Falta: que una colección privada no salga entre las que se conectan a un paso de IA
  (P1). Hecho en P1 de la F15: «Conectar» de un «Agente» no ofrece ninguna colección cuyo nivel no sea `visible`, ni
  una de Boni, ni una ya conectada (`agentConnectable`; AU-166).
- **AU-46** (F14c, hecho) · Las usan «Código» (leer, y guardar con permiso: AU-176), «Agente» (todo: F15) y
  el chat de una página (F16: sustituyen a su lista fija de cinco acciones).
  En la F14c: una conexión en cualquier otro tipo de paso no pasa la validación.
  Hecho en E2: `connectionActions` no da nada a ningún otro tipo, una conexión en él es `connection.notAllowed`, y un
  «Código» sin conexiones valida y no lee ninguna colección.
  Hecho en W1: la conexión de un «Código» da permiso de guardar (AU-176). Hecho en W2: guardar.
- **AU-47** (F14d, hecho) · El mapa de Boni se calcula de las conexiones y de los pasos «Colección» (A-16): sigue
  diciendo antes de ejecutar qué lee y qué escribe cada automatización.
  En la F14d: lo da `abilities` (`versions.ts`, AU-96) sobre la versión publicada, la misma función que escribe «Lo
  que podrá hacer»: por cada colección, qué pasos la leen, crean, modifican o eliminan, y con qué se inicia. Una
  automatización entra en el mapa al publicarse (AU-61); un borrador no aparece nunca, y lo que cambia en él no mueve
  el mapa hasta publicar. Sus ejecuciones se cuentan por el índice (A-29), y una prueba no cuenta (A-16). Extiende
  el mapa de hoy (`FlowMap.tsx` y su cálculo), que sigue enseñando igual los flujos de antes.
  Lo sostienen `versions.test.ts` (todo cambio que un paso puede hacer, `stepChanges`, está en `abilities`) y
  `publish.test.ts` (el mapa lee la publicada y no el borrador).
  Hecho en E2: `abilities` nombra todo cambio de `stepChanges` y toda lectura de una conexión o de un «Colección»,
  también de un paso al que no llega ningún disparador.
  Hecho en S4: el cálculo del mapa (`flowMap.ts`) da un nodo `automation` por cada automatización publicada, con el
  nombre de la versión que corre, su número (`version`), sus disparadores (`trigger`), si está encendida y sus
  ejecuciones del periodo; y una flecha «lee» o «escribe» por cada colección de `abilities` sobre esa versión, con
  sus pasos. Las ejecuciones se cuentan con una consulta que contesta el índice `automation_runs_count` sin leer
  ninguna (`AUTOMATION_RUNS_IN_SQL`); las pruebas y las horas que no corrieron no cuentan. Con 200 automatizaciones,
  una de ellas con un año de ejecuciones cada hora, el mapa de un año va dentro de su tiempo (`runs.test.ts`).
  Hecho en P3b: `FlowMap.tsx` pinta el nodo: el rayo, su nombre, «Disparado por el usuario · Programada · versión 2»
  y sus ejecuciones del periodo; apagada, «Apagada» y en gris; sus flechas «lee» y «escribe»; elegido, «Abrir» lleva
  a ella. Una sin publicar no está nunca (`automations-publish.spec.ts`, AU-47); con 200 automatizaciones, una con
  un año de ejecuciones cada hora, el «Mapa» se pinta dentro de su tiempo, medido con `@boni/pace` (A-15).

**Los permisos de guardar de un «Código»** (Juan, 2026-11-16). Son los de esta tabla, no otros: los mismos permisos,
las mismas celdas y las mismas palabras que tendrá el «Agente» (T-05).

- **AU-176** (F14c, hecho) · El permiso está en la conexión. La de un «Código» siempre lee, dentro de sus límites
  (AU-43); además puede dejarle crear, modificar o eliminar, con las columnas de AU-41: cada una «No», «Preguntar»
  o «Sí», por su lado. Una conexión nueva solo lee: cada permiso de guardar se da a mano, y un «Sí» solo lo pone su
  mano (AU-188). «Sí» guarda sin preguntar cuando la política lo deja (AU-186: desde la decisión 11 del §10, también lo que
  viene de fuera; la política sigue siendo el suelo, AU-165); «Preguntar» manda el cambio del paso a Juan antes de guardarlo (AU-174).
  En la F14c: la tabla es una lista y cuenta como una de las siete cosas del paso (AU-75); los permisos se cambian
  dentro de su fila, no son controles aparte. Pedir con el código una acción que su conexión no permite no pasa la
  validación (`code.write.notAllowed`): dice «Permite modificar en «Gastos»», con el botón que pone esa celda en
  «Preguntar» (nunca en «Sí»: eso lo elige Juan). Una colección que no está conectada da el aviso de siempre (AU-31).
  Hecho en W1: las tres celdas, `code.write.notAllowed` con la colección, la acción y el sitio de cada llamada, y
  `allowing`, el arreglo, que pone «Preguntar» y deja como está una celda que ya lo permite. Hecho en W2: el motor
  comprueba cada petición con la conexión guardada, y una celda que no la permite hace fallar el paso aunque el código
  pasara la validación con otra. Desde la F14d (E1, AU-186) un «Sí» guarda sin preguntar, salvo cuando la política
  pregunta; con «Preguntar» el cambio del paso espera a Juan. Falta: las palabras del aviso, con las de `code.colUse` (están en
  `CODE_PROBLEMS`, sin palabras como los demás), la tabla y el botón (pantallas), y que «Sí» guarde (F14d).
  Hecho en P1: las palabras del aviso y las de `code.colUse`. Hecho en P3: la celda que el código usa sin permiso
  sale en rojo, con «Permite modificar en «Gastos»» y «Permitir», que pone «Preguntar» (`allowAction`, sobre
  `allowing`) y lo guarda; las celdas dicen «Preguntar» y «Sí» con las claves del «Permiso» de «Colección» (AU-85,
  AU-187). Hecho en la F14d (E1, el PR 484): un «Sí» guarda (AU-186).
- **AU-177** (F14c, hecho) · Los límites de la conexión valen también para guardar, y los comprueba el motor con
  la conexión guardada, nunca con lo que diga la caja: no se modifica ni se elimina una fila que «Solo estas filas»
  deja fuera, no se pone un campo que «Solo estos campos» no deja ver, y una fila creada tiene que cumplir «Solo
  estas filas». Pasarse hace fallar el paso y no guarda nada (AU-174).
  En la F14c: la fila creada se comprueba tal como quedaría, con los valores por defecto de la colección. Modificar
  puede sacar una fila del filtro: el filtro dice qué filas puede tocar, no cómo quedan (modificar la categoría de
  los gastos que no la tienen). Cuando lleguen los límites de cada acción (AU-48, F15), estrechan además de estos.
  Lo que una escritura devuelve no llega al código (AU-172), así que AU-171 no tiene nada que hacer aquí.
  Hecho en W2: los comprueba `insideConnection` con la conexión guardada; una fila que no existe y una que la conexión
  deja fuera fallan igual, con el mismo código y el mismo mensaje, para que el código no sepa cuál era. Una fila
  creada se comprueba con los campos que pide: hoy el almacén no pone valores por defecto, y cuando los ponga se
  comprobará con ellos.
- **AU-178** (F14c, hecho) · La conexión dice sin abrirla si el código puede cambiar esa colección. Su ficha
  (AU-40): «Solo lee» frente a «Lee y modifica», «Lee, crea y modifica», con «pregunta antes» cuando es «Preguntar»
  («Lee y elimina · pregunta antes»), y «sin preguntar» cuando elimina con «Sí» (AU-189). La frase del paso (AU-44):
  «Puede leer Categorías, y leer y modificar Gastos (solo los de este año). No puede crear ni eliminar nada.»
  En la F14c: las palabras de las acciones son las de AU-85 (Crear, Modificar, Eliminar, en minúscula en la frase),
  de `i18n.ts`, las mismas que la tabla; la ficha y la frase salen de `permissions` (`connections.ts`).
  Hecho en W1: `permissions` da cada acción con su modo.
  Hecho en P3: la ficha (`chipWords`) y la frase (`connectionsSentence`), en `apps/boni-web/src/automations/connections.ts`,
  con las palabras de `i18n.ts`; con «Sí» en crear o modificar la ficha no dice «pregunta antes».
- **AU-179** (F14c, hecho) · En la vista del paso, cada permiso de guardar dice si el código lo usa, según el
  análisis (AU-183): «Lo usa» o «Sin usar»; y lo que el código usa sin permiso sale en rojo en su fila, con el
  problema de AU-176. Nada más: ni explicaciones ni ayudas dentro de la app.
  En la F14c: es una palabra en la celda («Sí · lo usa»), no una columna más; un permiso «Sin usar» no es un problema
  y no impide probar ni publicar.
  Hecho en W1: `connectionUses`, que de cada acción permitida dice si el código la usa y dónde, y lista la que usa sin
  permiso.
  Hecho en P3: «lo usa» o «sin usar» bajo cada celda que permite o que el código usa, y el rojo de AU-176.

### 5.6 El paso «Agente»

Es el ejemplo de Juan: un disparador y, después, una IA conectada a unas colecciones.

**Lo que la F15 extiende** (T-05). Por dentro casi nada es nuevo; lo nuevo son las rondas, los límites por acción y
que un paso espere a Juan.

| Lo que ya hay | Dónde | Lo que la F15 hace con ello |
|---|---|---|
| El agente: el plan, su validación, la política y la vista del planificador | `packages/agent` (`agent.ts`, `plan.ts`, `policy.ts`, `view.ts`) | Las rondas del «Agente» lo llaman (AU-56, AU-198): no hay otro bucle ni otro lenguaje |
| Los lectores y sus formas cerradas | `packages/agent/src/readers.ts` | Los cuatro pasos lectores (AU-57) |
| Los usos de «Modelos», sus evaluaciones y `plannerChoices` | `apps/server/src/models.ts` | `modelChoices(cuenta, uso)` (AU-199) |
| Las conexiones: la tabla, las fichas, la frase, `narrow`, `insideConnection` | §5.5, `packages/automations/src/connections.ts` y `writes.ts`, `AutomationConnections.tsx` | La misma tabla en el «Agente», con los límites de cada acción (AU-48, AU-196) |
| «Código»: la caja, `$col` y el análisis | §5.4 | «Las hace este código» (AU-51) y «Herramientas de código» (AU-58) |
| La propuesta de una ejecución y la Bandeja | AU-193, AU-170 | El «Preguntar» de un permiso (AU-42); el paso «Preguntar» espera allí (AU-203) |
| Las tarjetas de pregunta | `docs/conversacion.md` §3.4 | La tarjeta del paso «Preguntar» (AU-125) |
| Los límites de la ejecución | AU-17, `AUTOMATION_LIMITS` | Las llamadas a modelos se cuentan (AU-206) |
| Las decisiones y la autonomía ganada | `docs/fiabilidad.md`, `packages/agent/src/decisions.ts` | Lo que Boni aprende de sus respuestas (§5.15) |

- **AU-50** (F15, en parte) · «Agente» enseña seis cosas: **Instrucciones** (texto, con expresiones), **Modelo**
  («El de la cuenta» o un modelo evaluado para su uso: AU-199), **Conexiones** (§5.5), **Lecturas**, **Respuesta** y
  **Se ejecuta** (AU-55). El tipo de paso fija el uso de «Modelos» que gasta: un «Agente», el uso «Agente». En un
  paso no hay claves, ni temperatura, ni tokens (Juan, 2026-11-15; hasta entonces «Modelo» era «uno de los papeles de
  «Modelos»»).
  En la F15: sin «Instrucciones» el paso tiene un problema («Escribe qué tiene que hacer») y no se publica. Las seis
  son sus parámetros (AU-75: como mucho siete); lo demás va detrás de «Añadir opción» (AU-58). La prueba:
  `e2e-boni/automations-ai.spec.ts`.
  En el motor desde E3 (sigue pendiente hasta que corra su prueba): `AGENT_STEP` (`catalogue.ts`), con sus
  parámetros (`AGENT_PARAMS`: «Instrucciones», obligatorio, «Modelo», «Lecturas», «Respuesta» y sus «Campos», «Se
  ejecuta» y «Rondas máximas»), y la validación lo deja entrar solo con un puerto para llamar a un modelo
  (`ValidationContext.ai`), como a los lectores. Falta: el paso en el editor y su prueba (P2).
  Hecho en P1 de la F15: el paso en el editor, bajo «Usar IA» con su icono: sus seis cosas en ese orden
  («Instrucciones», «Modelo», «Conexiones», «Lecturas», «Respuesta», «Se ejecuta»), ninguna clave, temperatura ni
  token, y «Las hace este código» enseña su código en un cuadro de texto (`automations-ai.spec.ts`, en el escritorio
  y en el teléfono, que solo lee). Falta: el editor del código (P2). Hecho en P2 de la F15: sin «Instrucciones» el problema dice «Escribe
  qué tiene que hacer», no «Falta este dato» (`BY_PARAM` de `words.ts`), y un paso de IA que falla dice cuál de sus
  fallos (`AI_FAILURES`: «Presupuesto del mes agotado», «Falta la clave de la conexión», «Respuesta del modelo no
  válida»…), nunca su `other` (`words.test.ts`, «AU-50 · AU-199 · AU-59 · an AI step's failures…»).
  Desde la tarea 154 (§5.16): «Modelos» deja de tener usos. Donde este punto dice «el uso «Agente»» será
  la clase de llamada «Agente», la evaluación es la del modelo (AU-234, AU-235) y «Modelo» admite también una
  etiqueta (AU-238).
- **AU-51** (F15, en parte) · «Lecturas» tiene dos modos. «Decididas por un modelo» (por defecto): busca en sus conexiones
  lo que necesite. «Las hace este código»: un editor como el de «Código» que lee, cruza colecciones y devuelve lo
  que la IA recibe; entonces la IA no busca por su cuenta.
  En la F15: con «Decididas por un modelo», el plan del modelo pide `find`, `get`, `count` y `sum` a sus conexiones, y cada
  lectura la estrecha `narrow` como a las de un «Código» (AU-43). Con «Las hace este código», el código es el de un
  «Código» (la caja, `$col`, el análisis de AU-183 y sus topes) y solo lee: una llamada de escribir en él es un
  problema (`agent.reads.write`). Corre una vez por unidad de trabajo, antes de la primera ronda, y lo que devuelve es
  lo que el modelo recibe como filas, por la vista del planificador; el esquema que recibe el modelo no tiene
  entonces lecturas, y un plan que pida una se le niega (AU-198). Cambiar de modo no borra el código. La frase del
  paso (AU-44) dice quién lee: «Lee lo que decida la IA en Gastos y Categorías» o «Lee lo que hace su código en…». La
  prueba: `packages/automations/src/agent.test.ts`.
  Hecho en E3: con «Decididas por un modelo» el plan pide `find`, `get`, `count` y `sum`, y cada lectura pasa por el mismo
  `Reader` que un «Código» (`box.ts`): `narrow` con la conexión guardada, la puerta de la política y los topes del
  paso; lo leído queda en `StepRecord.reads`. Hecho en el segundo PR de E3: con «Las hace este código» (`reads`
  `code`, el parámetro `code`) el código corre en la caja una vez por unidad de trabajo, antes de la primera ronda, con
  las conexiones del paso y por el mismo `Reader` que leerán sus herramientas; lo que devuelve (una lista da una fila
  por elemento) son las filas que el modelo recibe, por la vista, y «Lo que hizo» lo cuenta (`code`). A la ronda no
  se le ofrecen lecturas (`tools` va sin ellas), y una que el plan pida igual se le niega y se le dice (`read-off`): el
  plan vale y la ronda sigue. Que el código escriba es un problema al validar (`agent.reads.write`) y, si llegara a
  pedirlo, falla al ejecutar (`code.write.unseen`); si el código falla, falla la unidad con su código (`CodeFault`), y
  si la política le niega una lectura, también, la de P29 incluida, como en un «Código» (`policy.denied`, o
  `ai.private` si la colección se hizo privada). Cambiar a
  «Decididas por un modelo» guarda el código, y la versión cuenta los pasos que cita. Falta: la frase del paso y el editor
  del código (P2), y que renombrar un paso cambie su nombre dentro de este código, como en un «Código» (P2).
- **AU-52** (F15, en parte) · En cada permiso de escribir, los campos se rellenan con el control de «los campos de
  una fila» (AU-80), que aquí, y solo aquí, tiene un tercer estado: cada campo es «Fijo», «Expresión» o «Lo decide la
  IA», con una línea que le dice para qué es. Las opciones salen del propio campo: una IA no puede inventar una
  opción que el campo no tiene.
  En la F15: el control va en la fila abierta de la conexión, bajo «Crear» y bajo «Modificar», y de él salen los
  límites de AU-48: `fields` son los campos en «Decidido por un modelo», y `fixed`, los «Fijo» y las «Expresión», que pone el
  código al guardar y la IA no elige. Un campo sin marcar no se escribe. La línea de cada campo va al modelo dentro
  del esquema (AU-197). Un campo de opciones solo admite una de sus opciones, y una relación, una fila que el paso
  haya leído en esa ejecución: lo que no cumple se niega y se le dice al modelo (AU-198). Es el «que lo defina el
  modelo» de cada parámetro de n8n (§3), con el campo de la colección como forma. La prueba:
  `packages/automations/src/action-limits.test.ts`.
  Hecho en E3, en el motor: un «Agente» solo escribe los campos de `fields`; `fixed` admite expresiones solo en un
  «Agente», resueltas con la fila de su unidad de trabajo y con su etiqueta; la línea de cada campo (`lines`, solo de
  los de `fields`) va al modelo en el esquema. Una opción que el campo no tiene (`bad-option`) y una relación con una
  fila que el paso no leyó en esa ejecución (`not-read`) se niegan y se le dicen al modelo. Falta: las opciones de
  cada campo desde el servidor (`FieldShape.options`, S1: sin ellas no se comprueban) y el control en la fila abierta,
  bajo «Crear» y bajo «Modificar» (P2). Hecho en el segundo PR de E3 (decisión 18): los fijos bajo «Modificar»
  (`update.fixed`), con sus expresiones resueltas por unidad de trabajo como las de crear: un fijo que una expresión
  toma de un valor de fuera lleva la etiqueta de fuera (AU-170), el modelo recibe solo sus nombres en el esquema
  (`update.fixed`), nunca su valor, y si pide uno se le niega como a crear (`outside-fields`).
  Hecho en P1 de la F15: bajo «Crear» y bajo «Modificar» de la fila abierta, cada campo es «No lo escribe», «Decidido
  por un modelo» o «Fijo» con su valor, pintado por su tipo como en «los campos de una fila»: los de la IA son
  `fields` (todos, sin lista), los fijos `fixed`, nunca los dos, y un campo que deja de ser de la IA pierde su línea
  (`setWriteField`, `connections.test.ts`). Falta: «Expresión» y la línea de cada campo (P2).
- **AU-53** (F15, en parte) · «Respuesta» es «Texto» o «Campos» (una lista de campos con su tipo). Sale como una
  fila que los pasos siguientes citan como cualquier otra.
  En la F15: «Texto» da una fila con el campo `texto`; «Campos», hasta 12 campos, cada uno con su nombre, su tipo
  (texto, número, fecha, sí o no, opciones) y una línea. La respuesta del modelo se comprueba contra esa forma como la
  salida de un lector: si no vale, se pide otra vez dentro de la ronda (cuenta como llamada) y, si vuelve a no valer,
  el paso falla (`agent.reply`). Con «Una vez por fila» sale una fila por cada fila de entrada. La «Respuesta» lleva la
  etiqueta `model`; si cita por su asa un valor que el modelo no leyó (un texto de fuera), el código lo pone y la
  respuesta lleva también su etiqueta. La prueba: `packages/automations/src/agent.test.ts`.
  Hecho en E3: «Texto» da una fila con `texto` y «Campos» la de sus campos (`fieldsOf`, la lista de «Extraer
  datos»), cada valor derivado, con la etiqueta del modelo y la de lo que cita; una respuesta que no vale se pide otra
  vez en la ronda y luego hace fallar el paso (`agent.reply`). Con «Una vez por fila» sale la fila de entrada con la
  respuesta. Falta: el paso en el editor (P2).
- **AU-54** (F15, en parte) · La salida enseña «Lo que hizo» encima de la «Respuesta», y el registro lo mismo: en
  orden, con su coste y con el modelo que respondió («2 rondas · 3 llamadas al modelo · el nombre del modelo ·
  3,6 s»; Juan, 2026-11-15). «Buscó 41 filas en Gastos», con el filtro que usó y el límite de la conexión; «Propuso 1
  fila nueva en Notas · pendiente». En una prueba dice «Propondría…» y enseña la fila: no propone nada.
  En la F15: cada línea la escribe el código con lo que ejecutó del plan, nunca el modelo (A-01), en texto plano:
  «Buscó», «Contó», «Sumó», «Creó», «Modificó», «Eliminó», «Propuso», «Quiso… · su conexión no lo deja» (AU-198) y «No
  leyó… · viene de fuera» (AU-197). El nombre del modelo es el que respondió, como lo enseña «Modelos»: si «El de la
  cuenta» cambia, cada ejecución dice el suyo. Los cuatro lectores (AU-57) dicen lo mismo en una línea («1 llamada al
  modelo · el nombre del modelo · 0,8 s»). Se guarda en el registro del paso, acotado: 50 líneas por unidad de
  trabajo y «y 12 más». En una prueba el modelo se llama de verdad y nada se guarda ni se propone (AU-199). La
  prueba: `packages/automations/src/agent.test.ts` y `e2e-boni/automations-ai.spec.ts`.
  Hecho en E2, para los lectores: el registro del paso guarda `ai` (las llamadas, los modelos que respondieron, el
  tiempo y los textos recortados), también cuando la ejecución para a medias por «Llamadas a modelos». Hecho en E3,
  para el «Agente»: `StepRecord.agent` guarda, por unidad de trabajo, sus rondas, lo que la vista dejó fuera (`seen`)
  y sus líneas como claves y valores (`AgentLine`: la operación, la colección, las filas, el filtro y el límite; el
  estado de cada escritura, `planned`, `applied`, `tested`, `asked` o `failed`; lo negado y por qué; lo que fue como
  asa), hasta 50 y las demás contadas (`more`); `ai` lleva las llamadas, los modelos y el tiempo de todas sus
  unidades. En una prueba nada se guarda ni se propone, y sus escrituras dicen `tested`. Falta: las palabras de cada
  línea en la app y la fila que propondría (P2, de `writes`), y el modelo de verdad en una prueba (S1).
  Hecho en P1 de la F15: «Lo que hizo» en la «Salida» de la vista, encima de la respuesta y en texto plano
  (`didLines`): su coste primero («2 rondas · 3 llamadas al modelo · el modelo · 3,6 s»), luego las líneas de cada
  unidad, las escrituras iguales seguidas dichas juntas, las de una prueba por su celda («Propondría…» con
  «Preguntar», «Crearía…» con «Sí»), lo negado por su porqué, y «y 12 más». Con «Una vez por fila» enseña las 20
  primeras unidades, cada una con su fila, y cuenta las demás («y 4980 filas más»): 5.000 unidades de 50 líneas se
  dicen en 3 a 4 ms. El servidor guarda `agent` y `ai` con la prueba del paso y el editor los vuelve a leer
  (`apps/server/src/automations/ai.test.ts`). Falta: la fila que propondría y «Lo que hizo» en el registro de una
  ejecución (P2). Hecho en P2 de la F15: «Lo que hizo» en el registro de una ejecución, con lo que guardó el motor
  (`agent`, `ai`) pintado como el de una prueba, y las llamadas que «Reintentar si el modelo falla» repitió
  («1 reintento», `retried`) (`runs.test.ts`). Falta: la fila que propondría (P3).
- **AU-55** (F15, en parte) · «Se ejecuta» tiene dos modos, a la vista como en «Código» (AU-30): «Una vez con todas
  las filas» (por defecto) y «Una vez por fila». Es un parámetro suyo y no un ajuste: «Ajustes» es igual en todos los
  pasos (AU-78). Junto a él se ve lo que cuesta: cuántas filas llegaron en la última prueba y el tope de llamadas a
  modelos de la automatización.
  En la F15: con «Una vez con todas las filas» hay una unidad de trabajo, y las filas de entrada llegan al modelo por
  la vista, acotada (AU-198); con «Una vez por fila», cada fila es una unidad con sus propias rondas. La línea del
  coste: «Llegaron 41 filas en la última prueba · hasta 20 llamadas a modelos por ejecución»; se pone en rojo cuando
  con esas filas el tope no alcanza («Una vez por fila» con 41 filas y 20 llamadas), sin impedir publicar: lo que
  para es el tope, al ejecutar (AU-206). La prueba: `packages/automations/src/agent.test.ts`.
  Hecho en E3: «Se ejecuta» es el parámetro `mode`; «Una vez con todas las filas» es una unidad de trabajo con todas
  las filas de entrada por la vista, y «Una vez por fila», una unidad por fila con sus rondas. Falta: la línea del
  coste (P2).
- **AU-56** (F15, hecho) · Por dentro es el agente de Boni, no un bucle de herramientas: el modelo escribe un
  plan, el código lo interpreta con la política, y lo que las etiquetas dejan ver a un modelo que planifica (los
  datos propios; nunca lo de fuera ni lo privado) vuelve para la ronda siguiente, hasta «Pasos máximos». Hoy el
  chat de una página hace una sola ronda por mensaje; las rondas son lo nuevo.
  En la F15: las rondas viven en `packages/agent`, sobre lo que ya valida y decide un plan, y el motor las llama por
  un puerto (§7): `packages/automations` no importa ningún proveedor de modelos (A-02). El origen de cada llamada es
  `automation`, con el paso y su conexión leídos de la versión guardada (AU-204, AU-205). «Pasos máximos» pasa a
  llamarse «Rondas máximas» (AU-58). Cómo es una ronda, qué vuelve y cuándo se guarda lo dice AU-198. La prueba:
  `packages/agent/test/automation-ai.test.ts`.
  Hecho en E3: las rondas son `runRounds` (`packages/agent/src/rounds.ts`), y el motor las llama por
  `AiPort.agent` con una llamada cerrada (`AgentCall`) y las herramientas del paso; `packages/automations` no importa
  `packages/agent`. Hecho en S1: el puerto de verdad (`apps/server/src/automations/ai.ts`) da `.agent` con el
  proveedor del «Modelo» del paso, o el planificador de «Modelos», bajo el presupuesto (AU-199).
- **AU-57** (F15, en parte) · Los otros pasos de IA hacen una cosa cada uno, con los lectores que ya existen:
  «Extraer datos», «Clasificar», «Resumir» y «Escribir texto». El texto de fuera pasa por ellos, no por el agente.
  Los cuatro gastan el uso «Lector» de «Modelos», y su «Modelo» se elige como el del «Agente» (AU-199; Juan,
  2026-11-15).
  En la F15: lo que enseña cada uno, sin conexiones (AU-46) y sin nada más:

  | Paso | Enseña | Sale | Lector de hoy |
  |---|---|---|---|
  | «Extraer datos» | Texto, Campos (la lista de AU-53), Modelo | La fila de entrada con esos campos | `fill` |
  | «Clasificar» | Texto, Opciones (fijas, o una expresión que da la lista), Modelo | La fila con `clase`: una de las opciones, o vacío | `classify`, `label_each` |
  | «Resumir» | Texto, Modelo | La fila con `resumen` | `summarize`, `summarize_each` |
  | «Escribir texto» | Instrucciones, Texto (puede faltar), Modelo | La fila con `texto` | `rewrite` |

  Cada uno es un lector de `READERS` con su forma cerrada de `READER_SCHEMAS`; si a alguno le falta la forma, se
  añade allí y no en el motor. Reciben solo su «Texto» y, como opciones, lo que Juan puso: nunca datos propios junto
  a un texto de fuera (`docs/nucleo.md` §7.4). Con varias filas, los que leen una lista en una llamada (`label_each`,
  `summarize_each`) reciben hasta 50 filas por llamada (`READER_BATCH`, el `maxItems` de sus formas; medido en E2: lo
  que cuesta son las llamadas, no el motor) y los demás hacen una llamada por fila; un texto de más de 4.000 caracteres se recorta y la salida lo dice («Recortó 3 textos»). La
  salida lleva la etiqueta de la entrada: lo que sale de un texto de fuera sigue siendo de fuera. Una salida que no
  vale se reintenta una vez (AU-59). «Añadir opción» de «Resumir» tiene «Largo» (corto, medio, largo). La prueba:
  `packages/automations/src/ai-steps.test.ts`.
  Hecho en E2: los cuatro en el motor (`ai.ts`), junto al catálogo como «Código» (`specOf`, categoría `ai`), y
  la validación los deja entrar solo con un puerto para llamar a un modelo (`RunDeps.ai`, `ValidationContext.ai`).
  Antes de las unidades el motor lee todas las filas: resuelve el «Texto» de cada una, recorta lo que pasa de 4.000
  caracteres, manda por lotes de 50 a `label_each` y a `summarize_each` (agrupando las filas que llevan las mismas
  opciones) y una por llamada a los demás; cada llamada se cuenta antes (AU-206), y una respuesta que no vale se
  comprueba otra vez en el motor contra la forma del paso y se pide una vez más. La llamada lleva solo `use`
  («reader»), `model` (el del paso o null para «El de la cuenta»), el lector, los textos y lo que Juan puso. La salida
  es la fila de entrada con `clase`, `resumen`, `texto` o los campos de «Extraer datos», cada uno con la etiqueta de
  lo enviado y la del modelo, derivado; el registro del paso guarda `ai`: llamadas, los modelos que respondieron, el
  tiempo y los textos recortados. «Resumir» corto va por lotes (`summarize_each`); medio y largo, uno por llamada
  (`summarize`). Un texto vacío da el campo vacío sin llamar. Los fallos son claves aparte (`AI_FAILURES`:
  `ai.private`, `ai.reply`, `ai.refused`, `ai.unavailable`, `ai.params`). Medido con un lector simulado (2026-11-17,
  cinco veces): una ejecución de 2.000 filas (la búsqueda, 40 lotes y 2.000 unidades) tarda de 65 a 77 ms, y repartir
  3.000 filas en 60 llamadas, de 35 a 57 ms. Con 50 por llamada y el techo de 40 llamadas, una ejecución lee como
  mucho 2.000 filas con un lector de lista (1.000 con las 20 de serie).
  Hecho en S1: el puerto de verdad pide a cada lector con el proveedor del uso «Lector» o el del «Modelo» del paso,
  bajo el presupuesto, y con las formas cerradas de `packages/agent` (`extractSchema` con los campos de «Extraer
  datos», `classifySchema` y `labelEachSchema` con «nada encaja»); la lista cerrada de «Modelo» se comprueba al
  publicar (AU-199). Falta: el tiempo de un modelo de verdad por lote, que solo mide una evaluación a mano; y los
  pasos en el editor, con sus palabras y «Recortó 3 textos» (P2).
  Desde la tarea 154 (§5.16): donde este punto dice «el uso «Lector»» será la clase de llamada «Lectura», con la
  evaluación del modelo (AU-234, AU-235); su «Modelo» admite también una etiqueta (AU-238).
- **AU-58** (F15, en parte) · Detrás de «Añadir opción»: «Pasos máximos», «Memoria» (en un chat) y «Herramientas
  de código»: funciones con nombre y entradas declaradas que la IA puede llamar, y que corren en la caja.
  En la F15: «Rondas máximas» (nace en 5, hasta 10) es el nombre de «Pasos máximos»: un paso es ya una caja del
  lienzo, y una ronda es lo que «Lo que hizo» cuenta. «Herramientas de código»: hasta 8, cada una con su nombre, sus
  entradas (nombre y tipo) y su código, que corre en la caja con las conexiones del paso y solo lee, como el de «Las
  hace este código» (AU-51): el análisis de AU-183 dice qué colecciones usa, y lo que devuelve entra por la vista del
  planificador con sus etiquetas. Son la parte del ejemplo de Juan («javascript sobre cómo hacer esas peticiones,
  referencias cruzadas a distintas colecciones») cuando además quiere que la IA decida cuándo. «Memoria» solo existe
  con el disparador de chat (F16): en la F15 no sale. Si la fase se alarga, las herramientas son lo que pasa a la
  cola. La prueba: `packages/automations/src/agent.test.ts`.
  Hecho en E3: «Rondas máximas» (`maxRounds`: nace en 5, de 1 a 10; otro valor es `param.value`). Hecho en el
  segundo PR de E3: «Herramientas de código» (`tools`: hasta 8, cada una con `name`, `inputs` y `code`) van al modelo
  en `tools` y en el catálogo de cada ronda con sus entradas obligatorias, en los dos modos de «Lecturas»; una llamada
  sin sus entradas es un plan que no vale (`agent.plan`) y una con otras, `bad-request`. Cada una corre en la caja con
  sus entradas como `$json` y las conexiones del paso, por el mismo `Reader`; lo que devuelve vuelve al modelo
  (`rows` o `value`) y su línea queda en «Lo que hizo» (`tool`). Si falla, se le dice al modelo (`code-failed`) y la
  ronda sigue; si la política le niega una lectura, la de P29 incluida, falla la unidad, porque esa lectura la pidió
  código y no el modelo (AU-198, como en un «Código»). Un nombre repetido o tomado (`find`, `answer`…), un tipo que no existe o una escritura son
  problemas al validar. Falta: «Añadir opción» y el editor de cada herramienta (P2), y el nombre de un paso
  renombrado dentro de su código (P2).
- **AU-59** (Antes, hecho) · Tarea 124, en el motor de hoy (`docs/nucleo.md` §7.4). Un lector cuya salida no vale se reintenta una vez acortando la entrada y, si vuelve
  a fallar, el paso falla diciendo qué lector y por qué; no para la automatización con un código (hoy:
  `R2-reader-output-invalid`, el fallo del resumen de la mañana). Se arregla ya en el motor de hoy (decisión 7 del
  §10) y el motor nuevo lo hereda con los pasos de IA (F15).
- **AU-197** (F15, hecho) · Lo que recibe el modelo de un «Agente» es una lista cerrada, y una prueba se rompe
  si entra otra cosa (como A-12 con el contexto del chat): sus «Instrucciones»; el esquema de sus conexiones (de cada
  colección conectada, su nombre, su descripción y sus campos, y solo las acciones que no están en «No», con sus
  límites y la línea de cada campo de AU-52; con «Las hace este código», ninguna lectura); las filas de entrada de su
  unidad de trabajo y lo que devolvieron las rondas anteriores, por la vista del planificador (`toPlannerView`: lo
  propio se ve; lo de fuera y lo privado son asas); la forma de la «Respuesta»; y el día, la zona y el idioma. Una
  colección conectada con «Leer» en «No» sale con su nombre y dicho que no puede leerla, para que la respuesta pueda
  decirlo (el criterio del §8). No recibe claves, ni lo que Boni sabe de Juan, ni sus instrucciones para asistentes, ni otras colecciones, ni otras
  automatizaciones, ni ningún chat: un «Agente» sabe lo que dicen sus «Instrucciones» y lo que lee por sus
  conexiones. Una expresión de «Instrucciones» se resuelve antes de llamar, y un valor que su etiqueta no deja ver a
  un modelo que planifica entra como su asa y no como su texto: el agente puede dárselo a un lector o guardarlo en un
  campo, no leerlo, y «Lo que hizo» lo dice («No leyó «Asunto» · viene de fuera»). La prueba:
  `packages/automations/src/agent.test.ts`.
  Hecho en E3: la petición de cada ronda (`AgentRequest`) lleva solo `use`, `model`, `instructions`, `connections`,
  `rows`, `rounds`, `seen`, `answer`, `tools`, `today`, `zone` y `language` (y `again` al pedir otra vez), y la prueba
  se rompe si entra otra cosa. El esquema de cada conexión (`agentSchema`) lleva la colección, sus campos por clave y
  tipo (con sus opciones y su destino), `read: false` o los límites de leer, y solo las acciones que no están en «No»,
  cada una con sus límites y la línea de cada campo. Cada cita de «Instrucciones» se resuelve aparte, con su
  etiqueta, y lo que un planificador no puede ver va como asa; «Lo que hizo» lo dice (`hidden`, con el campo y si
  venía de las instrucciones o de las filas). Hecho en el segundo PR de E3: la lista cerrada lleva además
  `codeTools` (el nombre y las entradas de cada herramienta de código, nunca su código) solo cuando hay alguna, y con
  «Las hace este código» el esquema va sin lecturas (`reads: false`) y las filas son lo que devolvió el código.
  Hecho en S1: el servidor da el nombre y la descripción de cada colección y el nombre de cada opción, como los ve
  el planificador (lo que no puede ver no va).
- **AU-198** (F15, en parte) · Las rondas tienen fin y una sola forma. En cada ronda el modelo escribe un plan, en
  el lenguaje de planes de hoy sin preguntar (`ask`), sin memoria y sin nada que salga fuera. El código lo valida
  (`validatePlan`, `checkPlan`), pasa cada llamada por la política y lo ejecuta. Un plan sin respuesta abre otra ronda
  con lo que devolvió; un plan con respuesta termina el paso. Agotar «Rondas máximas» (AU-58) sin respuesta hace
  fallar el paso (`agent.rounds`) sin guardar nada. Lo que el constructor no tiene que preguntar:
  - Lo que vuelve a la ronda siguiente está acotado: 200 filas y 20.000 caracteres por ronda (`AGENT_VIEW`; medido en
    E3, 2026-11-17, cinco veces: leer 3.000 filas y cortar su vista para la ronda siguiente, de 79 a 136 ms con la
    prueba entera), diciendo al modelo y a Juan lo que faltó («Vio 200 de 3.000 filas»). `count` y `sum` no tienen ese
    tope: un agente que necesita un total lo pide así, y las instrucciones del sistema se lo dicen.
  - Lo que el modelo pide en su plan y no puede (una colección sin conectar, una acción en «No», una fila fuera de
    «Solo estas filas», un campo que no es suyo, una opción que el campo no tiene, más filas que «Como mucho») no hace
    fallar el paso: esa llamada se niega (AU-205), se le dice al modelo en la ronda siguiente, con el mismo mensaje
    para una fila que no existe y para una que no puede tocar (AU-177), y queda en «Lo que hizo» («Quiso leer Gastos
    · su conexión no lo deja»). Así, sin «Leer» en una colección, la respuesta dice que no puede (el criterio del
    §8). Toda otra negación hace fallar la unidad de trabajo, por el «Si falla» del paso: la de una regla que no es
    de su conexión (P2, P14, P9), con el código y la regla y sin detalle (AU-161); la de una colección que se hizo
    privada después de publicar, diciendo cuál (AU-166); y la de una llamada que no hizo el modelo sino código («Las
    hace este código», una herramienta de código), como en un «Código» (AU-161).
  - Las escrituras de una unidad de trabajo se juntan y se deciden al final, cuando hay respuesta, y son parte del
    cambio del paso como las de un «Código» (AU-174), todo o nada: si todas llevan «Sí» y la política las deja, se
    guardan en una transacción; si una sola pregunta (su celda dice «Preguntar», o la política la propone: AU-204),
    el cambio entero espera en la propuesta de la ejecución y no se guarda nada de él hasta que Juan la acepta
    («todo junto», AU-42, AU-193). Una ronda posterior no lee lo que una anterior pidió escribir; al modelo se le
    devuelve la cuenta («Creará 1 fila en Notas»). Un paso que falla no deja nada a medias.
  - Un plan que no vale (no es un plan, o pasa de los 40 pasos de P12) se pide otra vez dentro de la misma ronda, una
    vez, y cuenta como llamada (AU-206); si vuelve a no valer, el paso falla (`agent.plan`).
  La prueba: `packages/automations/src/agent.test.ts` y `packages/agent/test/automation-ai.test.ts`, con un modelo de
  guion: ninguna llamada real.
  Hecho en E3: cada llamada del plan pasa por las herramientas del paso (`AgentTools`, `agent.ts`). Lo que su conexión
  o la colección no dejan se niega con una clave que el modelo lee en la ronda siguiente y que queda en «Lo que hizo»
  (`read-off`, `not-connected`, `action-off`, `outside-rows`, `outside-fields`, `over-limit`, `bad-option`,
  `not-read`, `bad-query`, `bad-request`, `too-many`, y `code-failed` de una herramienta de código; cada una tiene su
  prueba, y la de una fila que no existe y la de una que no puede tocar dicen lo mismo); el «no» de P29 a una llamada
  del plan igual, salvo una colección privada (`ai.private`); cualquier otra regla hace fallar la unidad, y también
  cualquier «no» a una lectura que pidió código («Las hace este código», una herramienta de código), P29 incluida,
  como en un «Código». Cada escritura se comprueba al pedirla, con las
  anteriores del paso, contra la conexión y la colección y sin guardar nada; al final todas las de las unidades que
  terminaron se deciden juntas por el mismo `applyWrites` de un «Código» (`Run.save`): guardadas en una transacción o
  esperando todas. Probado en el segundo PR de E3: un reintento de «Ajustes» es otra unidad en el registro, con sus
  rondas y sus llamadas; y tras una respuesta que no vale, las escrituras del segundo plan se suman a las del primero,
  que el modelo ya recibió como pedidas («Creará…»), y se deciden todas juntas. Hecho en S1: el servidor pone
  `reach` y `byAgent` en la llamada desde la versión guardada (AU-205).
- **AU-199** (F15, en parte) · «Modelo» es una lista corta y cerrada: «El de la cuenta» (por defecto: el modelo
  que «Modelos» tiene puesto para el uso del paso) y, debajo, cada modelo evaluado hace poco para ese uso y con su
  clave puesta («hace poco» es lo que `evaluated` de `models.ts` ya exige, sin otro plazo). Es la puerta de
  `plannerChoices` hecha para cualquier uso, `modelChoices(cuenta, uso)`: el uso «Agente» (`planner`) para un
  «Agente» y «Lector» (`reader`) para los cuatro lectores (AU-57); el chat sigue leyendo la del uso «Agente».
  Ni el código ni este diseño nombran modelos: la lista sale de las evaluaciones de la cuenta. El paso guarda el id
  de la elección, o nada («El de la cuenta»): nunca una clave, una ruta ni un ajuste del modelo (Juan, 2026-11-15).
  Al publicar, un paso cuyo modelo ya no está en la lista es un problema («Elige otro modelo en «Clasificar»») y no
  se publica. Una versión publicada sigue con su modelo mientras su clave exista, aunque su evaluación envejezca;
  sin clave o sin modelo, el paso falla diciéndolo y sigue su «Si falla». El presupuesto del mes de «Modelos» para
  los pasos de IA de toda ejecución, la inicie quien la inicie, con el mensaje de siempre; no hay tope de dinero por
  automatización. «Probar» llama al modelo de verdad, gasta de ese presupuesto y no guarda ni propone nada (AU-54).
  La prueba: `apps/server/src/automations/ai.test.ts`.
  Hecho en S1: `modelChoices(cuenta, uso)` en `models.ts` (`plannerChoices` es su caso `planner` y da la misma
  lista), y `stepProvider`, el proveedor de un paso por el id que guardó la versión (o el del uso, sin id), que dice
  `no-model` o `no-key` en vez de llamar. El puerto del servidor (`apps/server/src/automations/ai.ts`) pregunta el
  presupuesto antes de cada llamada, de cada ronda de un «Agente» y de cada reintento, para una ejecución de
  cualquier origen y en «Probar» (sin aviso: `dry`), y sobre él la llamada no se hace (`ai.refused`, `budget`).
  Cada llamada va con un tope de tiempo y no se repite (una que se agotó pudo cobrarse), salvo con «Reintentar si
  el modelo falla» (decisión 28 del §10, tarea 129), que la repite una o dos veces tras un tope o un 5xx; la que
  vuelve, y la que
  falló cobrada, quedan en el diario con su gasto. Al publicar, un «Modelo» que no está en `modelChoices` de su uso
  es un problema del paso (`param.value`, `model`; `aiProblems` de `publish.ts`). Falta: la lista en el editor (P1).
  Hecho en P1 de la F15: «Modelo» del «Agente» es una lista de `modelChoices` de su uso (`GET …/agent/planners`, la
  ruta que ya tenía el chat): «El de la cuenta · el modelo» primero, sin guardar nada, y debajo los evaluados; el
  paso guarda el id de la elección, y uno que ya no está se dice en la misma lista («… · no disponible»).
  Falta: las palabras «Elige otro modelo en «Clasificar»» del problema al publicar (hoy «Este valor no vale aquí») y
  la lista de los cuatro lectores con su uso «Lector» (P2). Hecho en P2 de la F15: el problema dice «Elige otro
  modelo», con el paso nombrado como enlace al lado en «Antes de publicar» (`BY_PARAM` de `words.ts`,
  `words.test.ts`). Falta: la lista de los lectores, que es de «Modelos» (§5.16).
  Desde la tarea 154 (§5.16): la lista del editor toma la forma de AU-238 («El de la cuenta», etiquetas
  y modelos), `modelChoices(cuenta, uso)` pasa a preguntar por clase de llamada, y «evaluado» es tener la
  evaluación del modelo, que es una sola (AU-234, AU-235), y «El de la cuenta» es la
  fila «De la cuenta» de esa clase (AU-236). Lo demás de este punto no cambia.
- **AU-200** (F15, en parte) · Lo que decide una IA se dice con esas palabras donde Juan da el permiso y donde lo
  ve usado: «decidido por un modelo». En «Lo que podrá hacer» (AU-182) un «Agente» da una línea por colección y acción que su
  conexión no tiene en «No» (no hay análisis que diga menos: puede todo lo que su conexión deja), con las marcas de
  siempre y la nueva: «Elimina filas en Tareas · sin preguntar · decidido por un modelo · como mucho 20». Cuando al paso puede
  llegarle algo de fuera (por su camino, como en AU-182, o porque una colección que su conexión deja leer guarda
  valores de fuera: `holdsOutside`), la línea lo dice como en un «Código»: «Elimina filas en Tareas · sin preguntar
  · decidido por un modelo · como mucho 20 · con datos de fuera» (decisión 16 del §10).
  Sus lecturas dicen quién las elige: «Lee lo que decida la IA en Gastos y Categorías». La frase bajo la tabla del
  paso (AU-44) lo dice igual de lo que escribe: «Puede leer Gastos (solo los de este año) y Categorías, y proponer
  filas nuevas en Notas (como mucho 20), lo que decida la IA. No puede modificar ni eliminar nada.» La misma marca va en la ficha
  de su conexión (AU-178), en cada cambio suyo dentro de la propuesta de una ejecución (AU-42) y en la línea de la
  ejecución que guardó algo así sin preguntar. Son palabras, no un aviso ni una ayuda (AU-179): el riesgo se lee en
  la misma línea donde se acepta. `abilities` gana ese dato (`byAgent`) y nada más: lo siguen leyendo el mapa
  (AU-47) y las aceptaciones de la F16 y la F19. La prueba: `packages/automations/src/agent.test.ts` y
  `e2e-boni/automations-ai.spec.ts`.
  Hecho en E3: `abilities` da una línea por colección y acción que la conexión de un «Agente» no tiene en «No»,
  marcada `byAgent` («decidido por un modelo»), y «con datos de fuera» como en un «Código» (con «Sí» la línea lo lleva; con
  «Preguntar» no, porque propone). Falta: las palabras y «como mucho
  20» en «Lo que podrá hacer» (P2, que lee el tope de la conexión).
  Hecho en P1 de la F15: «Lo que podrá hacer» dice «decidido por un modelo» y «como mucho N» (la suma de los pasos de esa
  línea, y nada si alguno no tiene tope) antes de «con datos de fuera»; la ficha de la conexión en el lienzo lleva
  «decidido por un modelo» en lo que puede escribir, y la frase bajo la tabla «…(como mucho 20), lo que decida la IA»
  (`publishing.test.ts`, `connections.test.ts`, `automations-ai.spec.ts`). Falta: «Lee lo que decida la IA en…» en
  la frase, su «proponer filas nuevas», y la marca en la propuesta y en la línea de una ejecución (P2). Hecho en P2
  de la F15: la marca en la propuesta y en la línea de una ejecución (AU-42, AU-204); las lecturas de un «Agente»
  ya dicen «Lee Gastos · decidido por un modelo» en «Lo que podrá hacer». Falta: «proponer filas nuevas» en la
  frase bajo la tabla, que agrupa los verbos antes de los nombres y pide rehacerla (P3).

### 5.7 La pantalla

**La lista** (pantalla 1 del boceto)

- **AU-60** (F14b, hecho) · La sección se llama «Automatizaciones» en la barra lateral, la conversación, el mapa,
  el MCP y la documentación.
  En la F14b cambia el nombre que se lee: la barra lateral, la página de la colección y sus migas, «Buscar», la
  conversación, el mapa y los textos del MCP dicen «Automatizaciones» y «automatización». Los nombres de dentro
  (`flows.*`, las herramientas `flows_*` del MCP) siguen hasta la F16. «Flujo» solo queda en la marca «Formato
  anterior» (AU-151).
- **AU-61** (F14b, hecho) · La lista sigue siendo una página de colección, «Tabla | Mapa», con seis columnas:
  Nombre · Se inicia (su disparador) · Estado («Encendida», «Apagada» o «Sin publicar») · Última ejecución ·
  Ejecuciones · De («Tú», «Boni» o «Página «Gastos»»). «Nueva» abre el lienzo vacío. Las que inicia el usuario llevan
  «Ejecutar» en su fila desde que se puede publicar (AU-97, F14d). Hasta entonces, una del formato nuevo dice «Sin
  publicar» y no tiene ejecuciones; «Encendida» y «Apagada» las dicen solo los flujos de antes (AU-151).
  En la F14b: «Nueva» abre el lienzo vacío sin guardar nada; la automatización se crea al añadir su primer paso y se
  llama «Nueva automatización» hasta que Juan le cambie el nombre. Una sin disparador dice «—» en «Se inicia». Sin
  ninguna automatización, la página dice lo que cualquier colección vacía, con su «Nueva». El «Mapa» enseña lo
  mismo que hoy, los flujos de antes: una automatización sin publicar no corre, y entra en él al publicarse (F14d).

**El editor** (pantalla 2)

- **AU-62** (F14b, hecho) · La cabecera tiene seis cosas propias: volver y el nombre (se edita ahí), las pestañas
  «Editor | Ejecuciones», «Guardado» (el borrador se guarda solo; dice además «cambios sin publicar» o «publicada la
  versión 3»), el interruptor de encendida, «Publicar» y «⋯» (Ejecutar, Versiones, Duplicar, Ajustes, Eliminar).
  Debajo no hay más barras, y al lado solo lo que la barra de Boni lleva en todas las pantallas (plegar la barra
  lateral y la «Bandeja»). La F14b pone lo que no depende de publicar: volver y el nombre, «Guardado» y «⋯» con
  Duplicar y Eliminar. Las pestañas, el interruptor, «Publicar» y el resto de «⋯» llegan con la F14d (AU-17, AU-95 a
  AU-99), al sitio que aquí tienen.
  En la F14b, «Guardado» dice una de tres cosas: «Guardando…» mientras sale un cambio, «Guardado» cuando el servidor
  tiene el último, y «Sin guardar · Reintentar» si no pudo (Boni reintenta solo, como hoy: D-55). Cada cambio sale
  tras una pausa corta y al salir del editor; no hay botón de guardar. «Duplicar» crea «<nombre> (copia)» con los
  mismos pasos y sitios y la abre. «Eliminar» la quita de la lista sin preguntar y su aviso lleva «Deshacer».
  Hecho en C1: la cabecera, «Guardado» con sus tres estados, la pausa y la salida, «Duplicar» y «Eliminar» con su
  «Deshacer». Hecho en C2: en el lienzo, la copia tiene cada paso en el mismo sitio. Hecho en G: en la app de
  escritorio sobre el servidor real, la cabecera, «Guardado», «Duplicar» con los mismos sitios y «Eliminar» con su
  «Deshacer».
- **AU-63** (F14b, hecho) · El lienzo va de izquierda a derecha. Un paso es una tarjeta con su icono, su nombre y
  una línea que resume lo que hace («Gastos · este mes · hasta 500»). Las salidas están a la derecha con su nombre;
  las conexiones cuelgan debajo (desde la F14c: AU-40).
  En la F14b: la tarjeta tiene un ancho fijo; el nombre y el resumen ocupan una línea cada uno y se cortan con puntos
  suspensivos (el texto entero, al pasar el ratón por él y en la vista del paso). El resumen se hace con los
  parámetros a la vista que tienen valor, en su orden, separados por « · »; una cita se lee por el nombre de su campo.
  Un paso al que le falta algo obligatorio lleva una marca en la tarjeta desde que se marca el parámetro (AU-83). Un
  lienzo con solo su disparador no dice nada más: el «+» de su salida es lo que hay que hacer (AU-65).
  Hecho en C2: la tarjeta, su resumen, las salidas con su nombre y el lienzo con solo su disparador. Hecho en D: el
  nombre y el resumen enteros en la vista del paso y la marca de lo obligatorio que falta. Hecho en G: la tarjeta
  dice una cita sola por el nombre de su campo, como la cabecera de la vista, con lo que el borrador sabe de cada paso
  (sin la prueba); con 200 tarjetas que citan, el lienzo abre en 350 ms y una tecla se pinta en 20 ms (A-15), y su
  captura de referencia («automatizaciones-lienzo»).
- **AU-64** (F14b, hecho) · Abajo a la izquierda: acercar, alejar, encajar y «Ordenar». Abajo en el centro:
  «Probar», que ensaya la automatización entera. En el editor solo se prueba (entera aquí; un paso, con «Probar
  paso»: AU-66 y AU-73); «Ejecutar», que corre la versión publicada, está en «⋯» (AU-97). Arriba a la derecha: «+».
  Abajo, plegado, el «Registro», que resume la última prueba en una línea (se despliega desde la F14d: AU-101).
  En la F14b: con un solo disparador, «Probar» empieza en él; con varios, abre un menú para elegir cuál. Si el
  disparador tiene campos, los pide en un cuadro pequeño junto al botón, con los de la última prueba ya puestos
  (AU-94). Mientras ensaya dice «Probando…» y no se puede pulsar; el resultado llega entero al acabar (ver cada paso
  mientras corre llega con las ejecuciones, F14d). Si la automatización tiene problemas, no ensaya: marca cada paso
  con problema en su tarjeta y el «Registro» dice cuántos hay; un clic en él lleva al primero. El «Registro» dice «Sin
  probar» antes de la primera prueba; después, «Última prueba hace 2 min · bien · 6 pasos · 4,1 s · no escribió nada»,
  o «… · falló en «Filtrar»», y un clic selecciona ese paso.
  Hecho en E: todo lo de arriba; el «Registro» que se despliega es de la F14d (AU-101).
- **AU-65** (F14b, hecho) · Un paso se añade de cuatro maneras, y las cuatro abren el mismo panel: el «+» de
  arriba, el «+» de una salida sin conectar (o arrastrar desde ella), el «+» de una flecha seleccionada y el clic
  derecho en el lienzo (I-24 se queda).
  Hecho en C2: las cuatro maneras abren el mismo panel y el paso elegido queda conectado y seleccionado. Hecho en D:
  el paso elegido se abre en su vista. Hecho en G: en la app de escritorio sobre el servidor real, «Buscar filas» en
  una colección de 3.000 filas, «Filtrar» y «Si» añadidos desde el «+» de una salida y rellenados arrastrando campos,
  cada paso abierto con lo que entra y lo que sale, «Probar», y nada escrito en la colección (el criterio de la F14b).
- **AU-66** (F14b, hecho) · Un paso seleccionado enseña una barra corta: Probar paso · Apagar · Eliminar · ⋯; una
  flecha seleccionada, «+» y eliminar. El clic derecho da lo mismo y poco más (cambiar nombre, duplicar, copiar).
  Nada sale solo al pasar el ratón.
  En la F14b: el «⋯» de la barra tiene Cambiar nombre · Duplicar · Copiar. El clic derecho en un paso tiene siete
  cosas: Abrir · Probar paso · Apagar · Cambiar nombre · Duplicar · Copiar · Eliminar. «Apagar» dice «Encender» en un
  paso apagado. Eliminar un paso que tiene una flecha de entrada y una de salida une a sus dos vecinos; en los demás
  casos se van sus flechas.
  Hecho en C2: la barra, el «⋯», el menú del clic derecho con sus siete cosas, «Apagar» y «Encender», la flecha con
  «+» y quitar, y eliminar uniendo a los vecinos. Hecho en D: «Abrir» abre la vista. Hecho en E: «Probar paso» de la
  barra y del menú prueba el paso y dice «Probando…» mientras tanto (AU-73).
- **AU-67** (F14b, hecho) · Después de probar, cada flecha dice cuántas filas pasaron y cada paso cómo acabó. Una
  salida sin conectar también enseña su cuenta: ninguna fila desaparece sin que se vea. Un paso que falló lo dice en
  su tarjeta, con el motivo, y los que colgaban de él quedan «parados»; «saltado» es un paso al que no le llegaron
  filas.
  En la F14b: la cuenta de una flecha se lee en ella («128 filas»); con «0 filas» la flecha se atenúa. El estado de un
  paso es una marca en su tarjeta (bien, falló, saltado, parado). El motivo de un fallo se lee en tres sitios: en la
  tarjeta, en dos líneas como mucho; entero, en la SALIDA del paso, en lugar de las filas, con el parámetro que lo
  causa y «Ir al parámetro» (AU-84); y en el «Registro», que dice en qué paso fue (AU-64). Un paso parado dice en su
  SALIDA «Parado: la prueba paró en «Si»». Las flechas y las salidas de un paso que falló no dicen cuenta: no pasó
  ninguna fila por ellas.
  Hecho en E: todo lo de arriba. Hecho en F: sin cuenta en las flechas de un paso que falló.
- **AU-68** (F14b, hecho) · Deshacer y rehacer en el lienzo, y copiar y pegar pasos, con las teclas de siempre.
  En la F14b: `Ctrl`/`⌘`+`Z` deshace y `Ctrl`/`⌘`+`Mayús`+`Z` (o `Ctrl`+`Y`) rehace; `Ctrl`/`⌘`+`C`, `X` y `V` copian,
  cortan y pegan los pasos seleccionados con las flechas que hay entre ellos; `Supr` elimina lo seleccionado, `Intro`
  abre el paso y `Esc` cierra. Deshacer alcanza a todo lo que cambia el lienzo o un paso (añadir, eliminar, conectar,
  mover, cambiar el nombre, los parámetros y los ajustes) desde que se abrió el editor; no se guarda entre sesiones.
  Lo deshecho se guarda como cualquier otro cambio del borrador. Un paso pegado tiene un id nuevo y, si su nombre ya
  está, el nombre con un número («Filtrar 2»); se puede pegar en otra automatización.
  Hecho en C2: deshacer y rehacer añadir, eliminar, conectar, mover, «Ordenar», cambiar el nombre y apagar; copiar,
  cortar y pegar con las flechas de dentro y en otra automatización; `Supr` y `Esc`. Hecho en D: `Intro` abre la vista,
  y deshacer y rehacer lo que se cambia en ella (parámetros y ajustes; una tanda de teclas seguidas es un paso).

**Añadir un paso** (pantalla 3: «Disparador» y «Añadir un paso»)

- **AU-69** (F14b, hecho) · Un panel a la derecha con el buscador arriba. En un lienzo vacío pregunta «¿Cómo
  empieza?» y lista los disparadores; después, las ocho categorías del §5.10, dichas por lo que se quiere hacer:
  «Leer o escribir en una colección», «Transformar filas», «Decidir el camino», «Escribir código», «Usar IA»,
  «Preguntar o avisar», «Actuar en una página» y «Piezas de Boni»; al final, «Añadir otro disparador». Cada paso
  está en una sola categoría. «Colección» enseña después sus acciones como frases («Buscar filas», «Crear una
  fila»). Al elegir, el paso queda conectado y se abre. Una categoría aparece cuando su fase la construye (§5.10).
  En la F14b hay un disparador («Disparado por el usuario») y tres categorías: «Leer o escribir en una colección»,
  «Transformar filas» y «Decidir el camino». El buscador busca en todas a la vez por el nombre del paso y de sus
  acciones; sin resultados dice «Nada con «…»». Con menos de 1100 px de ancho (AU-74) el panel va encima del
  lienzo, no al lado.
  Hecho en C2: el panel, «Disparador», las tres categorías, «Añadir otro disparador», las acciones de «Colección»,
  el buscador y «Nada con «…»», y el panel encima del lienzo bajo 1100 px. Hecho en D: el paso elegido se abre.
  Hecho en G: su captura de referencia («automatizaciones-anadir»).

**La vista del paso** (pantallas 4 a 7 del boceto)

- **AU-70** (F14b, hecho) · Doble clic o Intro abre el paso encima del lienzo en tres columnas: ENTRADA ·
  «Parámetros | Ajustes» · SALIDA. `Esc` cierra. No hay «Guardar».
  En la F14b: la vista ocupa la ventana encima del lienzo, que queda atenuado detrás. Su cabecera tiene el icono y el
  nombre del paso (se edita ahí), «Probar paso» y cerrar. En un disparador, la columna ENTRADA son sus «Datos de
  prueba»: los campos que pide, con lo de la última prueba (AU-94).
  Hecho en D: la vista encima del lienzo atenuado, sus tres columnas, la cabecera con el icono, el nombre que se edita
  ahí, «Probar paso» y cerrar, `Esc`, ningún «Guardar», y los «Datos de prueba» de un disparador con los campos que
  pide. Hecho en E: lo de la última prueba en ellos (AU-94). Hecho en G: su captura de referencia
  («automatizaciones-paso»).
- **AU-71** (F14b, hecho) · ENTRADA dice de qué paso viene y se ve como «Esquema» (por defecto: los campos con un
  valor de muestra, que se arrastran), «Tabla» o «JSON». Vacía, dice «Sin datos de entrada» con su botón.
  En la F14b: la cabecera de ENTRADA dice «De «Buscar gastos» · 128 filas» y deja elegir cualquier paso anterior del
  camino para ver y arrastrar sus campos (AU-21). «Combinar» tiene una pestaña por entrada. «Esquema» lista todos los
  campos con el valor de la primera fila, cortado a una línea; con más de diez, lleva un buscador encima; un campo que
  es una fila relacionada o una lista se despliega un nivel. «Tabla» y «JSON» enseñan las primeras 50 filas y, debajo,
  «N filas más», que trae otras 50 del servidor: nunca llegan todas de golpe (A-15). Una tabla con muchos campos se
  desplaza de lado y sus celdas se cortan a una línea.
  Hecho en E: la cabecera con el paso y las filas, elegir un paso anterior, las pestañas de «Combinar», «Esquema»,
  «Tabla» y «JSON», el buscador, desplegar un nivel, 50 filas y «N filas más», y «Sin datos de entrada» con su
  botón. Hecho en F: arrastrar los campos de «Esquema», también los de una fila relacionada desplegada.
- **AU-72** (F14b, hecho) · SALIDA se ve como «Tabla» (por defecto; «Esquema» si sale una sola fila), «Esquema»
  o «JSON», con cuántas filas y una pestaña por salida («sí (3)», «no (125)»). En una prueba, un paso que escribe
  enseña «Haría esto», con el antes y el después de cada fila. Su cabecera lleva «Fijar» desde la F14d (AU-93);
  «Código» añade debajo su «Consola» (AU-33) y «Agente», encima, «Lo que hizo» (AU-54).
  En la F14b: el pie de SALIDA dice cuándo se probó y cuánto tardó («probado hace 2 min · 0,2 s»), y las filas se
  piden como en ENTRADA: 50 y «N filas más». Sin prueba dice «Sin probar», con «Probar paso». Un paso saltado dice
  «Saltado: no le llegaron filas»; uno que falló, el motivo (AU-67); uno que no dio filas, «0 filas». «Haría esto» es
  una tabla con una fila por fila escrita y, en cada campo que cambia, el valor de antes y el de después; al crear,
  solo el de después; al eliminar, la fila como estaba (AU-122).
  Hecho en E: todo lo de la F14b; «Fijar», «Consola» y «Lo que hizo» llegan con sus fases.
- **AU-73** (F14b, hecho) · Arriba a la derecha está «Probar paso». Si no se puede pulsar, dice por qué.
  En la F14b no se puede pulsar en dos casos, y lo dice al lado: «Falta: Colección» (los parámetros obligatorios
  vacíos, por su nombre) y «Probando…».
  Hecho en D: «Probar paso» arriba a la derecha y «Falta: Colección» a su lado. Hecho en E: se pulsa, y mientras
  prueba dice «Probando…» al lado y no se puede pulsar (AU-91).
- **AU-74** (F14b, hecho) · En una ventana estrecha, Entrada y Salida pasan a ser pestañas. En el teléfono las
  automatizaciones se ven y, desde que se pueden publicar (F14d), se ejecutan y se encienden o apagan (decisión 15);
  no se editan ni se publican (como hoy).
  En la F14b: con menos de 1100 px de ancho la vista del paso tiene dos columnas, «Entrada | Salida» en pestañas a la
  izquierda y «Parámetros | Ajustes» a la derecha. En el teléfono (menos de 640 px, la disposición de teléfono de la
  app) la lista es la página de la colección de siempre, y una automatización abre su lienzo solo para ver: se mueve y
  se acerca con los dedos, y tocar un paso abre su vista en una columna con tres pestañas, «Entrada | Parámetros |
  Salida», con los parámetros sin poder cambiarlos y lo que dio la última prueba. No hay «+», ni barras de paso, ni
  arrastrar, ni menús que cambien algo. «Probar» sí está (Juan, 2026-11-15: «Sí, también»): el de todo el borrador,
  abajo en el lienzo, con los campos del disparador si los pide; no hay «Probar paso» ni los botones de los estados
  vacíos: en el teléfono una ENTRADA o una SALIDA sin datos dice «Sin probar» y nada más.
  Hecho en D: bajo 1100 px, las dos columnas con «Entrada | Salida» en pestañas, sin nada cortado ni que se desplace
  de lado (a 1000 px y a 640 px; por debajo de 640 px la app es la del teléfono). Hecho en G: el teléfono, para ver y
  «Probar», probado a 360 px con los dedos (un dedo mueve el lienzo, dos lo acercan; un dedo sobre un paso mueve el
  lienzo, no el paso); el nombre es texto, sin «Guardado» ni «⋯», y la flecha de volver es la de la app. Lo que el
  tacto no hace, ni hace falta: arrastrar un campo de «Esquema» (el arrastre de HTML es del ratón) y el menú del
  botón derecho. En el teléfono el nombre de un parámetro va encima de su control, que ocupa todo el ancho. Sus
  capturas de referencia: «automatizaciones-estrecho», «automatizaciones-telefono» y
  «automatizaciones-telefono-paso».
  Hecho en P2 de la F14d: en el teléfono, una automatización publicada lleva en su cabecera el interruptor
  («Encendida» / «Apagada», la acción `automations.enable`) y «Ejecutar», bajo el nombre; sigue sin «Publicar» ni
  «⋯». Probado a 360 px con los dedos: se apaga y se enciende, y nada se sale de la cabecera.

**Contra el mar de opciones** (C2 y C8: cada regla con su prueba)

- **AU-75** (F14b, hecho) · Ninguna acción de ningún paso enseña más de siete parámetros antes de «Añadir
  opción». Una lista (condiciones, los campos de una fila, las conexiones) cuenta como uno, y lo que hay dentro de
  una de sus filas no se ve hasta abrirla. Una prueba recorre el catálogo y falla si alguna se pasa.
  Una «cosa» (el criterio de la F14b) es una fila del panel «Parámetros»: un parámetro con su control. Cuentan los que
  se ven a la vez con cualquier combinación de valores del paso, la colección y la acción de «Colección» incluidas;
  «Añadir opción» no cuenta. Una opción que Juan añadió es una fila más: con ellas un paso puede pasar de siete,
  porque las puso él. «Ajustes» son siempre sus seis filas (AU-78) y van en su pestaña, aparte. Lo que hay en ENTRADA
  y SALIDA son datos, no opciones, y no cuenta. Lo cuentan dos pruebas: una recorre el catálogo, acción por acción y
  con cada combinación de sus parámetros que cambian la forma; la otra abre en la pantalla cada tipo de paso con cada
  acción y cuenta las filas pintadas.
  Hecho en D: las dos pruebas; en la pantalla, cada tipo con cada acción y con cada valor de un parámetro que cambia
  la forma.
- **AU-76** (F14b, hecho) · Lo opcional se añade con «Añadir opción» y queda como una fila que se puede quitar.
  En la F14b: «Añadir opción» abre la lista de las opciones de esa acción que aún no están; cuando no queda ninguna,
  el botón no se ve. Quitar una opción la devuelve a su valor por defecto.
- **AU-77** (F14b, hecho) · Una opción que cambia qué filas salen o por dónde nunca está detrás de «Añadir
  opción»: es un parámetro a la vista. El catálogo la marca y una prueba lo comprueba.
- **AU-78** (F14b, hecho) · «Ajustes» es igual en todos los pasos y tiene seis filas (pantalla 7): Si falla ·
  Reintentos (las dos, AU-16) · Seguir sin filas (AU-14) · Solo la primera fila (el paso trabaja con la primera que
  llegue y no con las demás) · Nota (un texto de Juan para acordarse de algo) · Apagado (el paso no corre y las
  filas pasan tal cual).
  Hecho en D: las seis filas en todos los tipos de paso; la segunda se llama «Reintentos» porque «Reintentar» es la
  palabra de otra acción, «Sin guardar · Reintentar» (AU-85). Hecho en G: su captura de referencia
  («automatizaciones-ajustes»).
- **AU-79** (F14b, hecho) · Todo ajuste u opción que no esté en su valor por defecto se ve en la tarjeta del
  paso, como una etiqueta corta («Reintenta 2 veces», «Nota»), y en la pestaña «Ajustes», que cuenta lo cambiado. Si
  además cambia las filas que salen («Solo la primera fila», «Seguir sin filas», «Apagado»), lo dice también encima
  de la salida. Nada cambia lo que hace un paso desde un sitio que no se ve.
  En la F14b las etiquetas son: «Si falla: seguir» o «Si falla: salir por error», «Reintenta 2 veces», «Sigue sin
  filas», «Solo la primera fila», «Nota» y «Apagado» (la tarjeta, además, atenuada); una opción añadida se lee por su
  nombre («Incluir relacionadas»). Van en una línea bajo el resumen; las que no caben se juntan en «+2», que las dice
  al pasar el ratón.
- **AU-80** (F14b, hecho) · Todos los pasos se hacen con los mismos nueve controles: un valor (texto, número,
  fecha), elegir, sí o no, una lista de filas, condiciones, los campos de una fila, un selector (colección, fila,
  paso, automatización, bloque), código y la tabla de conexiones (los dos últimos llegan con la F14c). Un tipo de
  paso no puede traer un control suyo.
  Hecho en D: los siete controles de la F14b, uno por tipo de `ParamSpec`, y la vista no pinta otros.
- **AU-81** (F14b, hecho) · Las condiciones son siempre el filtro de las vistas: «todas» por defecto, grupos «y»
  u «o» de un nivel, operadores según el tipo del campo, y el valor, fijo o una expresión (AU-20); el de un control
  de la página se cita como cualquier otro (`$page.mes`, F17). Modificar y eliminar piden al menos una condición (lo
  comprueba la validación: AU-121).
  Hecho en D: en los cinco pasos que tienen condiciones, el editor del filtro de las vistas con «todas», un nivel de
  grupos («Filtro avanzado»), los operadores por el tipo del campo y el valor fijo o una expresión, que se escribe como
  texto. Hecho en F: la expresión con sus fichas y su «{ }».
- **AU-82** (F14b, hecho) · Cambiar la acción de un paso conserva lo que las dos comparten y dice lo que se va,
  con Deshacer. Nada escrito se pierde en silencio.
  En la F14b lo dice un aviso: «Se quitó: Ordenar por, Límite · Deshacer».
- **AU-83** (F14b, en parte) · Un parámetro obligatorio vacío no se marca hasta salir de él, probar o publicar.
  Hecho en D: sin marca al abrir el paso; al salir de él, la marca en el parámetro y en la tarjeta, que se va cuando
  tiene valor. Hecho en E: al «Probar» o «Probar paso» se marcan todos, también en su tarjeta; entrar en el editor de
  condiciones o en una lista de filas no es salir. Falta: marcarlos al publicar, que es de la F14d (llega con
  «Publicar», AU-17); la F14b no publica.
- **AU-84** (F14b, hecho) · Cada estado vacío, viejo o de error dice qué hacer después, y un error nombra el
  parámetro que lo causa.
  En la F14b: el motivo de un fallo es una clave de una lista cerrada (`STEP_FAILURES`), con el parámetro que lo causa
  cuando es de uno, y la pantalla lo dice con `i18n.ts`; la frase en inglés del motor es para el registro y no se
  enseña. Los estados y lo que dice cada uno: la lista vacía, lo de cualquier colección, con «Nueva»; el lienzo
  vacío, «Disparador»; ENTRADA sin datos, «Sin datos de entrada» con su botón; SALIDA sin probar, «Sin
  probar» con «Probar paso»; una salida vieja, «puede estar vieja» con «Probar paso»; un fallo, el motivo con «Ir al
  parámetro»; un buscador sin resultados, «Nada con «…»»; un borrador que no se guardó, «Sin guardar · Reintentar».
  Hecho en E: todos.
- **AU-85** (F14b, hecho) · Una palabra por acción: una prueba comprueba que cada acción («Probar paso», «Añadir
  opción» y, cuando lleguen, «Fijar» y «Publicar») sale de una sola clave de `i18n.ts`.
- **AU-86** (F14b, hecho) · Un paso nuevo se llama como lo que hace («Buscar filas en Gastos») y el nombre sigue
  a sus parámetros hasta que Juan lo cambia.
  En la F14b: el nombre sale de `i18n.ts` con la acción y, si la hay, la colección («Buscar filas en Gastos»; sin
  colección, «Buscar filas»). Dos pasos no se llaman igual, porque se citan por su nombre: al segundo se le añade un
  número («Filtrar 2»). Cambiar el nombre de un paso cambia las citas que lo nombran. El nombre es el automático
  mientras sea igual al que saldría de sus parámetros de antes del cambio: no se guarda una marca aparte.
  Hecho en C2: el nombre por la acción y la colección, el número de un nombre repetido, cambiar el nombre en la
  tarjeta y que las citas lo sigan. Hecho en D: el nombre sigue a la colección elegida en la vista del paso hasta que
  Juan lo cambia. Hecho en F: las fichas de las citas cambian con el nombre.
- **AU-87** (F14b, hecho) · Boni no mete pasos por su cuenta: lo que hay en el lienzo lo puso Juan o lo aceptó.
- **AU-180** (F14c, hecho) · La tarjeta de un paso que puede cambiar una colección lo dice sin abrirlo, con la
  colección: «Modifica Gastos», «Crea y modifica Gastos», «Cambia Gastos y Notas». Es la misma marca para todo paso
  que guarda: un «Colección» que crea, modifica o elimina, un «Código» que puede guardar y, desde la F15, un «Agente»
  con permiso de escribir. Un código que solo calcula no enseña nada. Eliminar sin preguntar lo dice (AU-189).
  En la F14c: de un «Código» enseña lo que dice el análisis (AU-183), aunque la conexión no lo permita todavía (eso
  es un problema y se marca como tal, AU-83). Cambiar en memoria las filas que le llegan al código (AU-37) no es
  guardar y nunca se marca. La marca va en la línea de las etiquetas de AU-79 y sale de un solo sitio
  (`stepChanges`, `writes.ts`), el mismo que usan «Publicar» y el mapa (AU-47, AU-182).
  Hecho en W2: `stepChanges` da de un «Código» las colecciones y acciones del análisis y de un «Colección» la suya.
  Hecho en P3: la marca va la primera en la línea de las etiquetas, con su propio color (`changeMark`, sobre
  `stepChanges`): la misma para un «Colección» y para un «Código».

### 5.8 Probar, publicar y ejecuciones

- **AU-90** (F14b, hecho) · «Probar» ensaya el borrador entero desde un disparador: lee y calcula de verdad,
  llama a los modelos de verdad, y no escribe, no avisa y no propone (D-43). Un paso que escribiría saca la fila que
  crearía, para que lo que sigue continúe.
- **AU-91** (F14b, hecho) · «Probar paso» ensaya ese paso y solo lo que le falte de los anteriores; reutiliza lo
  ya calculado si no ha cambiado. Qué está viejo lo decide el servidor comparando cada paso con el que produjo los
  datos.
  En la F14b: un paso «cambió» cuando cambia su tipo, su acción, un parámetro o un ajuste que no sea la «Nota», o
  cuando cambió alguno de los pasos de los que cuelga o que cita, o los datos con los que se probó el disparador.
  Mover un paso o cambiarle el nombre no lo cambia: una cita cuenta por el paso al que apunta. Que los datos de una
  colección sean otros tampoco: la salida dice cuándo se probó (AU-72). «Probar paso» siempre vuelve a ejecutar ese
  paso. De cada automatización se guarda la última prueba de cada paso; se guarda en el servidor, así que se ve igual
  en otro dispositivo.
- **AU-92** (F14b, hecho) · La salida de un paso que cambió después de probar se marca «puede estar vieja».
  En la F14b se lee en la cabecera de SALIDA y, en el lienzo, la cuenta de sus flechas queda atenuada. Lo dice el
  servidor al guardar cada cambio del borrador.
  Hecho en E: la marca en SALIDA con «Probar paso», las cuentas atenuadas del paso y de lo que cuelga de él, y nada
  al moverlo o cambiarle el nombre.
- **AU-93** (F14d, hecho) · «Fijar» guarda la salida de un paso para las pruebas: no se vuelve a ejecutar, y no
  gasta modelo. Lo fijado se ve en la tarjeta («Salida fijada») y nunca vale en una ejecución de verdad. Se suelta en
  el mismo botón.
  En la F14d: lo fijado vive junto al borrador, como las pruebas y el sitio de las cajas (`automation_pins`), y
  nunca dentro de una versión: una ejecución de verdad lee solo la versión publicada (AU-95), así que no tiene de
  dónde sacarlo. «Fijar» está en la cabecera de SALIDA (AU-72) y fija la última salida probada de ese paso, con las
  etiquetas de cada fila: un valor de fuera fijado sigue siendo de fuera en la prueba. Sin una salida probada, el
  botón no se puede pulsar. En «Probar» y «Probar paso», un paso fijado no corre (ni caja, ni lecturas, ni modelo):
  da sus filas fijadas y su tarjeta dice «Salida fijada». Si el paso cambió después de fijarlo, dice además «puede
  estar vieja» (AU-92). «Publicar» lo recuerda entre lo que conviene mirar (AU-96). Duplicar no copia lo fijado.
  Lo sostienen `runs.test.ts` (un paso con la salida fijada corre de verdad en una ejecución y no en una prueba; lo
  fijado conserva sus etiquetas) y `automations-publish.spec.ts` (el botón y la tarjeta).
  Hecho en S2: `PUT` y `DELETE …/:id/pins/:step` (`pinStep`, `unpinStep`; la acción `automations.pin`) fijan la
  última salida probada con las etiquetas de cada fila y la sueltan; la vista del borrador da `pins` con `stale`
  cuando el paso cambió después. En «Probar» y «Probar paso» un paso fijado no corre (ni caja ni lecturas) y la
  prueba lo dice en `pinned`; una ejecución de verdad lo corre. «Duplicar» no copia lo fijado. Falta: el botón, la
  tarjeta y el recuerdo en «Publicar» (pantalla, P1).
  Hecho en P2: «Fijar» en la cabecera de SALIDA (no en el teléfono), que fija y, pulsado, es «Soltar»; un paso que
  falló o sin probar no lo tiene (no se puede pulsar porque no está). La tarjeta dice «Salida fijada» (y «puede estar vieja»), «Probar» la da sin
  correrlo, y «Publicar» lo recuerda («salida fijada»: `publishView` lee los fijados, que S1 dejaba vacíos).
- **AU-94** (F14b, hecho) · Un disparador se prueba con datos: «Disparado por el usuario» pide sus campos; los de
  colección o de correo, cuando lleguen (F16, F18), dejan elegir una fila reciente («Probar con…», como hoy).
  En la F14b los campos se piden en el cuadro de «Probar» (AU-64) y en la columna ENTRADA del disparador (AU-70); un
  disparador sin campos empieza sin preguntar. Los campos de la última prueba son la fila que dio el disparador en
  ella: no se guardan aparte.
  Hecho en E: todo lo de la F14b.
  Desde S2 de la F14d (decisión 14, Juan, 2026-11-17): lo que escribe para «Probar» lleva su etiqueta también en
  un dispositivo compartido.

**Publicar, ejecutar y lo que corre solo (F14d): lo que extiende** (T-05). Nada de esto se inventa: es lo que los
flujos de antes ya hacen, puesto sobre el formato nuevo y sin tocar el suyo, que sigue como está hasta la F16.

| Lo que hace falta | Lo que ya hay | Lo que hace la F14d |
|---|---|---|
| Versiones | La tabla `flows`: una fila por versión, con su huella, quién la escribió (`by`) y `enabled`; `saveFlow`, `revertFlow` | `automation_versions`, igual; publicar el mismo documento no hace otra versión (AU-95, AU-98) |
| Que un borrador no corra | D-55: el borrador de un flujo se guarda aparte y no corre | La ejecución de verdad no admite un documento: lee la versión publicada (AU-95) |
| Ejecuciones guardadas | `runs` y `run_steps` del motor de antes; la última prueba de cada paso (`automation_tests`, F14b) | `automation_runs` y `automation_steps`, con las filas aparte de 50 en 50 como las de una prueba (AU-99, AU-103) |
| Deshacer una ejecución | Cada operación lleva la ejecución; `undoRun` del almacén | La ruta y el botón (AU-18, AU-100) |
| Correr a su hora | `flowScheduler.ts`: `dueSlot`, `graceOf`, una vuelta por minuto (D-44) | Las mismas funciones, con varias reglas por automatización (AU-114) |
| Proponer y aceptar | La Bandeja (`proposals`), `acceptProposal` con el origen «aceptado», cada valor con su etiqueta | Una propuesta por ejecución, con las etiquetas de cada valor (AU-193, AU-170) |
| Quién escribe solo | `decide`: P4, P15 y P7 (segundo plano solo propone) | El origen «automatización», el mismo la inicie quien la inicie, y la fila P28, que es la única excepción a P4 y a P15; la frase nueva de P5 (AU-167, AU-186, AU-195, decisión 11 del §10) |
| Avisar | `notify`: la app y el móvil | Un aviso por ejecución que escribió sola y uno por racha de fallos (AU-167, AU-102) |
| Recuperar una eliminada | El «Deshacer» de su aviso (`restoreFlowRow`, AU-62) | «Eliminadas», después de que el aviso se fue (AU-191) |

- **AU-95** (F14d, hecho) · «Publicar» hace del borrador la versión que corre. El borrador, que se guarda solo
  desde la F14b (AU-62), nunca corre de verdad (D-55): lo que escribe de verdad es siempre una versión publicada, así
  que cada escritura tiene su versión.
  En la F14d: una versión es una fila que no cambia nunca (`automation_versions`: el documento, su número, su
  huella, cuándo, desde qué dispositivo y de quién, `user` hoy y `preset` desde la F16), y la automatización dice
  cuál corre (`published`). Publicar pide el `rev` del borrador que se ve: si el borrador cambió entretanto (otro
  dispositivo), no publica y lo dice. Con el mismo documento que ya corre no hay nada que publicar, y el botón lo
  dice apagado. La función que ejecuta de verdad no tiene un parámetro por el que entre un documento: recibe la
  automatización y lee su versión publicada del almacén; «Probar» es otra función, que no tiene ejecución y no
  escribe (AU-90). Cada escritura lleva su ejecución en el registro de operaciones, y la ejecución guarda su
  versión. «Guardado» dice «publicada la versión 4» cuando el borrador es el documento que corre y «cambios sin
  publicar» cuando no (AU-62), comparando huellas. Las tablas están en el almacén del usuario (D-02) y ninguna pasa
  por el registro de operaciones: una versión no se deshace, se publica otra.
  Lo sostiene `publish.test.ts`: con un borrador que escribiría una cosa y una versión publicada que escribe otra,
  cada ruta de `automations/routes.ts` que ejecuta escribe solo lo de la publicada; sin publicar, ninguna ejecuta; el
  borrador que cambió no se publica.
  Hecho en S1: `automation_versions` (la migración 27, con dos disparadores de SQLite que niegan cambiar o quitar una
  fila) y `published` y `enabled` en `automations`; `publish.ts` en el servidor con `publish`, `publishView`,
  `versionsOf`, `versionOf`, `setEnabled` y `runPublished`, la única función que ejecuta de verdad:
  recibe el id y lee del almacén la versión que corre, y `runDeps` con una ejecución niega una automatización sin
  versión publicada. La versión guarda su documento con `version` igual a su número, y la huella se calcula con
  `version` a 0 para comparar un borrador con ella.
  Hecho en P1: la ruta que publica (`POST …/:id/publish`, acción `automations.publish`, tailnet) con su botón en la
  cabecera, y «Guardado» seguido de «· sin publicar», «· publicada la versión 4» o «· cambios sin publicar»
  (`publishWord`, con `diffAutomations` contra el documento de la versión que corre, `GET …/versions/:n`). La ruta que
  ejecuta la registró P2 (AU-97).
- **AU-96** (F14d, hecho) · «Publicar» (pantalla 10) enseña tres cosas: qué cambia respecto a la versión que
  corre; lo que falta o conviene mirar, con un enlace a cada paso (una salida sin conectar, por ejemplo); y «Lo que
  podrá hacer», la frase calculada de lo que lee, propone y escribe cuando corra sola. Con problemas en pasos a los
  que llega un disparador no se publica.
  En la F14d: las tres salen de funciones puras de `packages/automations` (`versions.ts`), las mismas en la app y en
  el servidor, que es quien decide si se publica. `diffAutomations(a, b)`: los pasos añadidos, quitados y cambiados
  (qué parámetros, qué conexiones, qué ajustes), las flechas, el nombre, el disparador y los límites; la usa también
  «Versiones» (AU-98). `publishChecks`: lo que impide publicar (un problema de la validación, o un parámetro
  obligatorio vacío, en un paso al que llega un disparador: abrir «Publicar» los marca todos, que es la mitad de
  AU-83 que faltaba) y lo que conviene mirar y no lo impide (una salida sin conectar, un paso al que no llega ningún
  disparador y que por eso no correrá, un paso sin probar o con la prueba vieja, una salida fijada, un límite
  cambiado). `abilities`: por colección, lo que lee, lo que crea, modifica o elimina, y de cada escritura si la
  guardará sola o la preguntará; lo que elimina sin preguntar lo dice con esas dos palabras (AU-189), y de cada
  escritura con «Sí» que puede recibir algo de fuera lo dice con cuatro, «con datos de fuera» (AU-182, decisión 11
  del §10). La primera vez, la pantalla dice además que publicar la
  enciende (AU-194). Los textos de un paso (su nombre, el de una colección) se pintan como texto.
  Lo sostienen `versions.test.ts` (las tres funciones, caso por caso), `publish.test.ts` (con un problema en un paso
  alcanzable no publica; en uno al que no llega nada, sí) y `automations-publish.spec.ts` (la pantalla).
  Hecho en E2: las tres funciones (`versions.ts`). `diffAutomations` no ve el orden de los pasos ni de las flechas, ni
  el número de versión, y un límite escrito con su valor por defecto no es un cambio; `publishChecks` impide
  publicar con un error de toda la automatización o de un paso alcanzable (`blocking`), y el motor deja de correr
  solo por eso, así que lo que se publica corre (un paso suelto con un error no para la ejecución; las pruebas del
  borrador siguen con `canRun`); lo que conviene mirar sale con su paso.
  Hecho en S1: el servidor contesta las tres para el borrador o, con `version`, para una versión vieja
  (`GET …/:id/publish`, por la acción `automations.read`), y `publish` repite `publishChecks` con las colecciones de
  hoy y los nombres guardados de la versión que corre (`keptKey`), así que niega publicar con un problema alcanzable
  mande lo que mande la app (`blocked`, con los problemas).
  Hecho en P1: la pantalla 10 (`AutomationPublish.tsx`): «Será la versión N» (la primera, «y quedará encendida»), «Qué
  cambia respecto a la versión N» (`diffLines`), «Antes de publicar» (`checkLines`: lo que lo impide primero, cada
  paso un enlace que lo abre) y «Lo que podrá hacer» (`abilityLine`), y el botón «Publicar versión N» o «Nada que
  publicar», apagado con algo que lo impide. Abrirla marca los parámetros obligatorios vacíos (`publishAsked`,
  AU-83).
  Hecho en P3b: abierta con una versión vieja para «Volver a esta» (AU-98): la pide con `version`, enseña el
  documento de esa versión en lugar del borrador y publica con `{ version }`.
- **AU-97** (F14d, hecho) · «Ejecutar» corre la versión publicada: en su fila de la lista, en «⋯» de la cabecera
  del editor y en el aviso que sale al publicar («Publicada la versión 4 · Ejecutar»). Desde la F17, también un
  bloque de una página (AU-131).
  En la F14d: con «Campos que pide», sale el mismo cuadro que en «Probar» (AU-64, AU-94). La ruta contesta enseguida
  con la ejecución, que sigue en el servidor: la app lleva a «Ejecuciones» (AU-99) y la ve avanzar por avisos
  pequeños (qué paso acabó y con cuántas filas; nunca las filas, que se piden aparte). Una automatización corre una
  ejecución a la vez: otra mientras tanto dice «Ya se está ejecutando». Las de una cuenta corren una detrás de otra,
  por orden de llegada. Sin publicar no hay «Ejecutar»; apagada, dice «Está apagada» con «Encender» (AU-194). Con
  cambios sin publicar, «Ejecutar» lo dice antes: corre la versión publicada, no lo que se ve. Un «Código» corre en
  la caja, como en una prueba (A-08); sin caja, el paso falla y lo dice. Qué deja guardar la política a una
  ejecución iniciada así está en AU-195.
  Lo sostienen `runs.test.ts` (corre la publicada; una a la vez; apagada no corre) y `automations-publish.spec.ts`
  (los tres sitios de «Ejecutar»).
  Hecho en S2: `startRun` (`runs.ts`), por la ruta `POST …/:id/run` y la acción `automations.run`, contesta con la
  ejecución («running», o «queued» detrás de otra de la cuenta) y la sigue en el servidor por `runPublished`; una a
  la vez por automatización (`running` con su id), y las de una cuenta en una fila, por orden de llegada. Sin
  publicar, apagada, eliminada o desde un dispositivo compartido, no empieza y no se guarda nada. Un «Código» corre
  en la caja con `run: { test: false, startedBy: "user" }`; sin caja falla con `code.unavailable` y no escribe nada.
  Los avisos pequeños son el evento `run` del SSE: estado, paso y filas por salida, nunca las filas.
  Hecho en P1, sobre el servidor simulado con la forma de la ruta de S2: «Ejecutar» en «⋯» de la cabecera, en el
  aviso de publicar y, en el teléfono, en un botón de la cabecera (AU-74); con «Campos que pide», el cuadro de «Probar»; con cambios sin publicar, «Corre la versión N, sin
  los cambios sin publicar»; apagada, «Está apagada» con «Encender»; otra en curso, «Ya se está ejecutando». Falta: registrar
  `automations.run` y su ruta (`withRunActions`, `RUN_ROUTES`) con `data-boni-action` en los controles, «Ejecutar» en la fila
  de la lista, llevar a «Ejecuciones» y verla avanzar (P2).
  Hecho en P2: `withRunActions` y `RUN_ROUTES` registrados, con `data-boni-action` en cada control; «Ejecutar» en
  la fila de la lista (abre la automatización y pide sus campos); al ejecutar, la app va a «Ejecuciones» con esa
  ejecución, que avanza por el evento `run` en el escritorio y, en el navegador, preguntando cada 2,5 s solo mientras
  está en marcha y se ve. El bloque de una página es de la F17 (AU-131).
- **AU-98** (F14d, hecho) · «Versiones»: la lista, ver una, compararla con otra en dos lienzos y volver a una.
  Las de Boni dicen «De Boni» y se puede volver a la suya, como hoy.
  En la F14d: está en «⋯ → Versiones». La lista dice de cada una su número, cuándo, de quién («Tú»; «De Boni» desde
  la F16, que trae las suyas: la columna y la palabra ya están) y cuál corre. Ver una es su lienzo solo para ver,
  como el de una ejecución (pantalla 8). Comparar dos pone un lienzo al lado del otro con lo de `diffAutomations`
  marcado: añadido, quitado, cambiado. No tiene pantalla dibujada en la maqueta: reutiliza la 8 y la 10. «Volver a
  esta» abre «Publicar» (AU-96) con el documento de esa versión en lugar del borrador: lo que cambia respecto a la
  que corre, lo que falta (las colecciones de hoy pueden no ser las de entonces) y lo que podrá hacer. Publicar ahí
  hace una versión nueva con ese documento; la historia no se reescribe. El borrador no se toca: se queda con lo
  último que Juan escribió y dice «cambios sin publicar», así que volver atrás por un fallo no le cuesta el trabajo
  que tenía a medias. Decidido por Juan el 2026-11-16 (decisión 12 del §10).
  Lo sostienen `publish.test.ts` (volver a la 2 desde la 4 hace la 5 con el documento de la 2 y deja el borrador
  como estaba) y `automations-publish.spec.ts` (la lista, ver, comparar, volver).
  Hecho en S1: la lista sin documentos (`GET …/:id/versions`: número, cuándo, desde qué dispositivo, de quién y la
  huella, la más nueva primero, con cuál corre y el interruptor), una entera (`GET …/:id/versions/:n`) y «Volver a
  esta» como `publish` con `version`: las mismas comprobaciones, una versión nueva con el documento de la vieja, el
  borrador sin tocar; volver a la que ya corre no publica nada, y a una cuya colección ya no está lo niega con el
  problema.
  Hecho en P3b: la pantalla (`AutomationVersions.tsx`, `automations/versions.ts`): «⋯ → Versiones» (solo publicada y
  no en el móvil) pone en el sitio del lienzo la lista, la más nueva primero, con número, cuándo, de quién y «La que
  corre»; la elegida en su lienzo solo para ver; «Comparar con» pone las dos lado a lado, la vieja a la izquierda,
  con cada tarjeta marcada «Añadido», «Quitado» o «Cambiado» (`compared`, sobre `diffAutomations`) y las líneas de
  «Publicar» encima; «Volver a esta» abre «Publicar» (AU-96) con su documento, y publicar ahí deja el borrador como
  estaba y la cabecera en «cambios sin publicar». Solo se pide el documento de las que se ven (200 versiones en la
  prueba de volumen, A-15).
- **AU-99** (F14d, hecho) · La pestaña «Ejecuciones» (pantalla 8): a la izquierda la lista, con «Todas | Fallos |
  Pruebas» (cuándo, cómo acabó, cuánto tardó, qué la inició, qué versión; las pruebas, marcadas); a la derecha el
  lienzo de esa ejecución, solo para ver, con sus filas en cada flecha y, encima, lo que hizo en una línea. Abrir un
  paso enseña lo que entró y lo que salió.
  En la F14d: el registro que el motor ya devuelve (AU-15) se guarda paso a paso mientras corre
  (`automation_runs`, `automation_steps`, las filas aparte de 50 en 50), así que una ejecución en marcha se ve
  avanzar y una interrumpida dice hasta dónde llegó (AU-190). Una ejecución acaba «Hecha», «Falló», «Interrumpida» o
  «No corrió» (AU-114), y puede estar además «Deshecha». La línea de encima sale del registro, con palabras de
  `i18n.ts`: «Creó 1 fila en Tareas», «Propuso modificar 12 filas en Gastos · Ver en la Bandeja», «Falló en «Buscar
  gastos»: …», «No hizo nada». El lienzo es el de la versión que corrió, no el borrador. La lista se pide de 50 en
  50 por el índice y no lee pasos ni filas (A-29); las filas de un paso se piden al abrirlo. Un «Probar» entero se
  guarda como una ejecución marcada como prueba, para «Pruebas»; «Probar paso» no. Una prueba no cuenta en la
  columna «Ejecuciones» ni en el mapa (A-16). En el móvil, la lista y, al tocar una, su detalle.
  Lo sostienen `runs.test.ts` (lo guardado es lo que el motor devolvió; la lista con un año de ejecuciones cada hora
  dentro de su tiempo, A-15) y `automations-publish.spec.ts` (la pestaña, los tres filtros, abrir un paso).
  Hecho en S2: `automation_runs`, `automation_steps` y sus filas de 50 en 50 (`automationRuns.ts` del almacén), que
  `record.ts` escribe al acabar cada paso; `GET …/:id/runs` (de 50 en 50 por el índice, `filter` «all», «failed» o
  «tests», y `before`), `GET …/:id/runs/:run` (la ejecución, sus pasos, el documento de la versión que corrió y su
  línea) y `GET …/:id/runs/:run/rows`. La línea sale del registro (`lineOf`: lo guardado por colección y acción, lo
  propuesto, lo que guardaría, dónde falló o que no hizo nada); sus palabras son de la pantalla. Un «Probar» entero
  se guarda como ejecución de prueba. Con un año de ejecuciones cada hora, la lista y una ejecución contestan dentro
  de su tiempo.
  Hecho en S4: «Ejecuciones» y «Última ejecución» de la lista de automatizaciones salen de una tabla que el almacén
  lleva con dos disparadores de SQL al guardar y borrar cada ejecución (`automation_run_counts`, migración 30), sin
  contar filas; con 200 automatizaciones, una con un año de ejecuciones cada hora, la lista va dentro de su tiempo.
  Las pruebas y las horas que no corrieron no cuentan.
  Hecho en P2: la pestaña (`AutomationRuns.tsx`): la lista de 50 en 50 con «Ver más» y «Todas | Fallos | Pruebas»,
  cada una con cuándo, cómo acabó, cuánto tardó (también si falló o se interrumpió), qué la inició y qué versión
  («Bien» y no «Hecha», la palabra de los pasos del lienzo, para que un paso y una ejecución que acabaron se digan
  igual); a la derecha la barra con su línea y
  el lienzo de la versión que corrió, solo para ver, con sus filas en las flechas; un paso abierto pide sus filas
  entonces. En el teléfono, la lista y, al tocar una, su detalle con «Todas las ejecuciones». Con 8.760 ejecuciones,
  la lista pide una página y no lee pasos. «Ver en la Bandeja» tras «Propuso…» llegó en P3b
  (AU-193).
- **AU-100** (F14d, hecho) · En una ejecución: «Deshacer lo que hizo», «Reintentar» y «Abrir en el editor con
  estos datos», que fija la salida del disparador para probar con ella.
  En la F14d: «Deshacer lo que hizo» es AU-18, y solo está si escribió algo. «Reintentar» inicia otra ejecución, de
  la mano de Juan, con los datos del disparador de aquella (sus campos, o la hora que le tocaba) y la versión
  publicada de hoy; si no es la de entonces, lo dice («Correrá la versión 5, no la 4»). Empieza desde el principio:
  si aquella guardó algo antes de fallar, el cuadro lo dice y ofrece «Deshacer y reintentar» además de
  «Reintentar», para no escribirlo dos veces. «Abrir en el editor con estos datos» fija en el borrador la salida que
  dio el disparador (AU-93) y abre el editor. Una prueba solo tiene este último.
  Lo sostienen `runs.test.ts` (reintentar usa los mismos datos y la versión publicada; «Deshacer y reintentar» no
  deja nada dos veces) y `automations-publish.spec.ts` (los tres botones).
  Hecho en S2: `retryRun` (`POST …/:id/runs/:run/retry`, y `automations.run` con `retry`) inicia otra ejecución de
  la mano de Juan con el disparador y los campos de aquella y la versión publicada de hoy, y contesta `version` y
  `was`; con `undo`, la deshace antes, todo o nada. Una prueba no se reintenta. `pinFromRun`
  (`POST …/:id/runs/:run/pin`) fija en el borrador la salida que dio el disparador en esa ejecución. Falta: los tres
  botones y el cuadro (P1).
  Hecho en P2: los tres botones en la barra de una ejecución. «Reintentar» corre enseguida si es la misma versión y
  no guardó nada; si no, un cuadro dice la versión («Correrá la versión 2, no la 1.») y lo que guardó, con «Deshacer
  y reintentar» primero cuando se puede deshacer. «Abrir en el editor con estos datos» fija la salida del disparador
  y abre el editor en él. Una prueba solo tiene este último; en el teléfono no está (AU-74).
- **AU-101** (F14d, en parte) · El «Registro» del editor, desplegado, enseña la última prueba como un árbol: una
  línea por paso y, dentro de un paso de IA, sus lecturas y escrituras.
  En la F14d: es un solo componente para el «Registro» del editor y para una ejecución de «Ejecuciones», sobre el
  mismo registro: una línea por paso en el orden en que corrió, con su estado, las filas que entraron y salieron y
  lo que tardó. Dentro de un «Código», sus lecturas (`$col`), su «Consola» y lo que guardó, propuso o guardaría
  (AU-181); dentro de un paso de IA, desde la F15. Tocar una línea abre ese paso. Todo se pinta como texto.
  Lo sostiene `automations-publish.spec.ts`: el árbol de una prueba y el de una ejecución son el mismo.
  Hecho en P2: «Ver cada paso» (`LogTree` en `AutomationTest.tsx`) en el «Registro» y en la barra de una ejecución:
  una línea por paso en el orden en que corrió, con su estado, «128 → 3» y su tiempo, y debajo sus lecturas, su
  «Consola» y lo que guardó, propuso o guardaría, como texto; tocar una línea abre su paso. Dentro de un paso de IA
  es de la F15. Falta: las lecturas en el árbol del «Registro» del editor, porque la prueba de un paso no las da
  (`StepTestView` no tiene `reads`; es del servidor). En una ejecución sí están.
- **AU-102** (F14d, en parte) · Una ejecución que falla en segundo plano avisa una vez, con el paso y el motivo en
  palabras, y el aviso lleva a ella.
  En la F14d: «en segundo plano» es la que empezó sola (AU-195); una que inició su mano falla en su pantalla, sin
  aviso. El aviso («Tarea de la mañana falló en «Crear una fila»: falta «Título»») lo escribe el código con el
  nombre de la automatización, el del paso y el motivo de las listas cerradas (`STEP_FAILURES`, `words.ts`): nunca
  el mensaje que lanzó un código ni el valor de una fila, que pueden venir de fuera. Avisa una vez por racha: tras
  un fallo, los siguientes de esa automatización no avisan hasta que una acaba bien o se publica otra versión, así
  que «Cada hora» no avisa veinticuatro veces; todas están en «Ejecuciones». Una interrumpida (AU-190) y una que no
  corrió a su hora (AU-114) cuentan como un fallo de la racha: avisan si la abren y callan si ya estaba abierta. Va
  a la app y al móvil, y es lo único de una ejecución que llega al móvil (decisión 12 del §10, de Juan,
  2026-11-16): lo que guardó sola se ve en la app (AU-167). El motivo no dice más de lo que ya decía al
  código: el aviso y el registro guardado de una escritura fuera del filtro de su conexión (`code.write.outside`)
  son los mismos exista o no esa fila (AU-177).
  Lo sostienen `scheduler.test.ts` (tres fallos seguidos, un aviso; tras una que acaba bien, el siguiente fallo
  avisa; un código que lanza un texto con HTML no lo deja en el aviso) y `runs.test.ts` (el registro y el aviso de
  `code.write.outside`, iguales con la fila y sin ella).
  Hecho en S4: `notices.ts` escribe el aviso al acabar la ejecución y lo guarda con ella (`notice`, migración 30),
  así que su línea lo dice aunque la app mire tarde; la racha la marca la ejecución anterior de la automatización
  que acabó bien o falló sola (`streakMark` del almacén). El motivo es una frase sin parámetros por código de las
  listas cerradas (`NOTICE_REASONS`: «el código falló»), más corta que el ejemplo de arriba para que nada de una
  fila pase al aviso. Un fallo va por `AgentHost.notify` con la ejecución que lo dio (`about`): a la app (el
  evento `notify`, que la app de escritorio enseña como aviso del sistema) y al móvil (`pushNotice`, solo el texto).
  Un reintento no avisa (`retryOf`).
  Hecho en P3b: tocar el aviso abre la ejecución en «Ejecuciones». En la app de escritorio, el aviso del sistema
  del evento `notify` lleva su `about` y abre `run:<automatización>:<ejecución>` (`notices.cjs`, `main.cjs`,
  `notices.test.cjs`); en la app, esa pantalla abre la automatización con esa ejecución elegida, y una que no está
  no abre nada (`automations-publish.spec.ts`, AU-102). Lo que guardó sola no salta (decisión 17 del §10). Falta:
  que tocarlo en el móvil abra la ejecución: el `pushNotice` del servidor lleva solo el texto; le falta llevar
  `about`, que `NoticeRules` de Android lo lea y que `Notices.show` abra `run:<a>:<r>` con su `Launcher`.
- **AU-103** (F14d, hecho) · Se guardan enteras las últimas 100 ejecuciones o 30 días de cada automatización; de
  las anteriores, solo el resumen (A-29).
  En la F14d: la «o» de la regla se lee como lo que antes acabe, para que lo guardado entero tenga tope por
  automatización: una ejecución está entera mientras es de las últimas 100 de su automatización y tiene menos de 30
  días. De las demás queda su fila (cuándo, cómo acabó, cuánto tardó, qué la inició,
  qué versión, lo que hizo en una línea) y se van sus pasos y sus filas. Su «Deshacer lo que hizo» sigue valiendo
  (AU-18). De las pruebas se guardan las últimas 20, y las anteriores se borran del todo: una prueba no hizo nada.
  Se recorta al acabar cada ejecución y al arrancar el servidor. «Última ejecución» y «Ejecuciones» de la lista
  (AU-61) se cuentan por el índice.
  Lo sostiene `runs.test.ts`: un año de ejecuciones cada hora de una automatización deja 100 enteras, y la lista,
  las cuentas y el recorte van dentro de su tiempo (A-15, `@boni/pace`).
  Hecho en S4: `keep.ts` y `pruneAutomationRuns` del almacén (migración 30). Se recorta esa automatización al acabar
  cada ejecución y cada prueba, en una escritura de 200 ejecuciones como mucho, y todas al abrir el almacén de una
  cuenta, en escrituras así con el servidor libre entre ellas (tarea 137). De una recortada queda su fila con
  `pruned`, su línea y su aviso. Una cuya propuesta espera en la Bandeja sigue entera hasta que se contesta,
  porque aceptarla lee lo que pidió. Con un año de ejecuciones cada hora: una escritura de 200, menos de 60 ms; el
  resto al arrancar, menos de 3 s.
  Hecho en P2, solo la pantalla: una ejecución de la que solo queda el resumen enseña su barra y «De esta ejecución
  solo queda el resumen…» en vez del lienzo.
- **AU-190** (F14d, hecho) · Una ejecución que el servidor dejó a medias al apagarse no se repite sola. Al
  arrancar, toda ejecución que seguía en marcha se cierra como «Interrumpida», diciendo en qué paso estaba. Lo que
  guardaron los pasos que acabaron se queda, y se deshace desde ella (AU-18); un paso nunca queda a medias, porque
  su cambio es una transacción (AU-174). Su hora cuenta como corrida (AU-114). Avisa como un fallo si empezó sola
  (AU-102), y «Reintentar» es de la mano de Juan (AU-100). Repetirla sola escribiría dos veces lo de los pasos que
  ya habían guardado. Decidido por Juan el 2026-11-16 (decisión 12 del §10).
  Lo sostiene `runs.test.ts`: un servidor que arranca con una ejecución en marcha la cierra, no la repite y deja lo
  que guardó.
  Hecho en S2: `interruptRuns` (`runs.ts`) al abrir por primera vez el almacén de una cuenta (`agent.ts`), y
  `main.ts` abre al arrancar el de cada cuenta: toda ejecución «queued» o «running» queda «interrupted», con el paso
  en que estaba y su hora de fin; no se repite, y lo que guardaron sus pasos se queda y se deshace desde ella.
  Hecho en S3: su hora cuenta como corrida, porque la ejecución interrumpida guarda la hora que le tocaba y el
  programador no empieza otra con la misma (`scheduler.test.ts`).
  Hecho en S4: si empezó sola, avisa como un fallo de su racha al cerrarse, con el paso en que estaba
  (`scheduler.test.ts`).
  Hecho en P2: en la lista y en su barra, «Interrumpida en «Si»», con lo que guardó, «Deshacer lo que hizo» y
  «Reintentar» de la mano de Juan.
  Hecho en P3b: en la app de escritorio sobre el servidor real, un servidor que se para con una ejecución en
  «Buscar filas» y vuelve a arrancar la enseña «Interrumpida en «Buscar filas en Tareas»», con «Reintentar», y no la
  corre otra vez (`e2e-boni-desktop/automations-publish.spec.ts`, AU-190). La parada se deja en el almacén como la
  deja un servidor que se apaga, porque ningún paso dura lo bastante para pararlo a mano; `runs.test.ts` para la
  caja de verdad a medias.
- **AU-191** (F14d, en parte) · Una automatización eliminada se recupera. «Eliminar» (AU-62) la apaga y la quita
  de la lista, y guarda su borrador, sus versiones y sus ejecuciones. Además del «Deshacer» de su aviso, que se va,
  la lista tiene «Eliminadas» (en su «⋯»): cada una con «Recuperar», que la devuelve apagada, con todo lo suyo. Una
  eliminada no corre nunca, la inicie quien la inicie, ni entra en el mapa. Borrarla del todo no está en la F14d.
  Extiende `setAutomationDeleted` y la ruta `restore`, que ya existen.
  Lo sostienen `publish.test.ts` (eliminada no corre a su hora ni a mano; recuperada vuelve apagada, con sus
  versiones y sus ejecuciones) y `automations-publish.spec.ts` («Eliminadas» y «Recuperar»).
  Hecho en S1: eliminarla la apaga (`enabled = 0`) y recuperarla no la enciende; `runPublished` no la encuentra;
  `deletedAutomations` del almacén da la lista, y «Recuperar» es la ruta `restore` que ya había.
  Hecho en P3b: «Eliminadas» en la app (`AutomationDeleted.tsx`): el «⋯» de la lista, junto a su título (no en el
  móvil), abre las eliminadas, leídas de la misma colección que la lista (`GET …/t_sys_flujos/rows?deleted=1`,
  `deletedAutomationRows`, sin leer ningún borrador), cada una con «Recuperar» (la ruta `restore`), que la devuelve a
  la lista «Apagada»; desde un dispositivo compartido lo niega. Falta: una prueba de que el programador no la corre a
  su hora y de que el mapa no la pinta (sus consultas ya piden `deleted = 0`).
- **AU-192** (F14d, hecho) · Cambiar el nombre de una colección no rompe lo publicado. Un «Colección» y una
  conexión guardan la clave de la colección; un «Código» la cita por su nombre (`$col('Gastos')`). Cada versión
  guarda, al publicarse, el nombre con que su código cita cada colección conectada y la clave que era. Al
  ejecutar, el nombre se resuelve primero por ahí, así que la versión publicada sigue leyendo y guardando en la
  misma colección aunque ahora se llame de otra manera. Esto nunca ensancha: la clave tiene que seguir siendo una
  conexión de ese paso, y una colección archivada o eliminada hace fallar el paso diciendo cuál. En el borrador, la
  cita con el nombre viejo es un problema de la validación («`$col('Gastos')`: ahora se llama «Compras»») con un
  botón que la reescribe: el código de Juan lo cambia su mano, no Boni por su cuenta.
  Lo sostienen `versions.test.ts` (lo que una versión guarda de sus nombres) y `runs.test.ts` (tras el cambio de
  nombre, la publicada guarda en la misma colección; sin la conexión, no).
  Hecho en E2: `keptNames` (por paso, el nombre y la clave de cada colección conectada que su código cita),
  `namedFor` (resuelve un nombre por lo guardado mientras la clave siga conectada a ese paso, y si no, por el de
  hoy), `code.collectionRenamed` en la validación con el nombre de hoy (`keptKey` en `CodeContext`) y
  `renameCollectionInCode`, que reescribe solo `$col('…')`.
  Hecho en S1: cada versión guarda sus `keptNames` al publicarse (la columna `names`), y publicar y «Publicar» le
  pasan a la validación el `keptKey` de la versión que corre. Falta: que el servidor le pase `namedFor` al motor por
  paso (hoy `collectionNamed` es uno para toda la ejecución) y `runs.test.ts` (S2), y el botón (P3).
  Hecho en S2: una ejecución de verdad resuelve cada nombre con `namedFor` por paso, de los `names` de la versión
  publicada (`collectionNamed(name, step)`): tras el cambio de nombre guarda en la misma colección; sin esa conexión
  en el paso, falla; con la colección archivada, falla diciendo cuál.
  Hecho en P3b: el botón. El editor lee los `names` de la versión que corre (`GET …/versions/:n`) y se los pasa a la
  validación del «Código» (`keptKey`): la cita vieja se subraya y un aviso dice «Lecturas» es el nombre de antes: la
  colección ahora se llama «Libros», con «Cambiar a «Libros»», que la reescribe con `renameCollectionInCode`.
- **AU-194** (F14d, hecho) · El interruptor dice si corre. Publicar por primera vez la enciende, y la pantalla
  lo dice antes (AU-96); publicar otra versión deja el interruptor como estaba. Apagada, no empieza ninguna
  ejecución de verdad: ni a su hora ni con «Ejecutar». «Probar» va siempre. Encenderla no corre lo que no corrió
  mientras estaba apagada (AU-114). La lista dice «Encendida», «Apagada» o «Sin publicar» (AU-61). Que la primera
  publicación la encienda lo decidió Juan el 2026-11-16 (decisión 12 del §10).
  Lo sostienen `publish.test.ts` (la primera publicación enciende, la segunda no cambia el interruptor; apagada no
  corre) y `automations-publish.spec.ts` (el interruptor y la columna «Estado»).
  Hecho en S1: `publishAutomation` enciende en la misma transacción solo si no había ninguna publicada,
  `setEnabled` (solo desde un dispositivo personal y solo con una publicada) no corre nada, y `runPublished` apagada
  contesta `off`.
  Hecho en P1: la ruta del interruptor (`PUT …/:id/enabled`, acción `automations.enable`, tailnet) con su control en
  la cabecera, «Encendida» o «Apagada», que solo sale publicada y no en el teléfono, y la columna «Estado» de la
  lista con las tres palabras (`flowsCollection.ts`).
- **AU-181** (F14c, en parte) · Probar nunca guarda lo que pide un código. «Probar» y «Probar paso» lo hacen
  pasar por todo lo de una ejecución (el análisis, la conexión y sus límites, la política, como prueba: AU-168) y no
  aplican nada; SALIDA enseña «Haría esto», como en un paso «Colección» (AU-72): una fila por fila que cambiaría, con
  el antes y el después, y si preguntaría (AU-189). Lo que el código devuelve sigue siendo su salida.
  En la F14c: «Haría esto» es una franja plegable como «Consola», encima de ella, con cuántas peticiones y en qué
  colecciones («Modificaría 12 filas en Gastos»). Una petición que haría fallar la ejecución hace fallar la prueba
  igual, con el mismo motivo. El registro de una ejecución de verdad (AU-99, AU-101) lista lo que el paso guardó, o
  lo que propuso, como el de un «Colección».
  Hecho en W2: en una prueba las peticiones pasan por el análisis, la conexión, sus límites y la política como prueba,
  no se guarda nada, y lo que haría cada una sale con el antes, el después y si preguntaría (`asks`); el paso de una
  ejecución de verdad lista lo mismo de lo que guardó o propuso.
  Hecho en P3: el servidor guarda con la prueba del paso lo que haría (`codeWould`: cuántas por colección y acción,
  y las 100 primeras filas con su antes y su después), y SALIDA lo enseña en «Haría esto», plegable, encima de
  «Consola», con «Al ejecutarse, preguntaría antes de guardar» cuando preguntaría y «y N filas más». Probado con
  3.000 filas en el servidor y en la app de escritorio. Falta: lo guardado en el registro de una ejecución de verdad,
  que llega cuando un «Código» corre publicado (F14d).
- **AU-182** (F14d, hecho) · Lo que se acepta sin haberlo escrito Juan dice lo que puede cambiar. «Lo que podrá
  hacer» de «Publicar» (AU-96) nombra cada colección que puede cambiar cada «Código», con la acción, según el análisis
  y sus conexiones, y si eliminará sin preguntar (AU-189); y lo mismo, antes de aceptarla, una automatización que
  propone el asistente (AU-140, F16), «Pedir a Boni» o «Escribir con IA» (AU-141, AU-39: F19) o un paquete (AU-145,
  F19). Un «Código» que guarda no corre nunca solo antes de eso: solo corre de verdad una versión publicada (AU-95), y
  «Publicar» llega con esto en la misma fase (F14d). Hasta entonces sus peticiones solo se prueban (AU-181).
  En la F14d: es `abilities` (AU-96). De cada «Código» nombra las colecciones que su análisis vio cambiar
  (`readCode`, AU-183) y su conexión permite, con la acción y con cómo: «la guarda», «la pregunta» o, al eliminar con
  «Sí», «sin preguntar». No hay otra lista: sale de `stepChanges` y de `permissions`, lo mismo que cumple el motor al
  ejecutar, así que la pantalla no puede decir menos de lo que el paso puede hacer. Las aceptaciones de la F16 y la
  F19 llaman a la misma función.
  Desde la decisión 11 (§10): una línea por colección y acción, de cada paso que escribe, sea «Código» o
  «Colección», y nada más largo que una línea. De cada escritura dice cómo («las guarda», «pregunta» o, al
  eliminar con «Sí», «sin preguntar») y, si lleva «Sí» y puede recibir algo de fuera, lo dice con las mismas
  palabras para crear, modificar y eliminar: «con datos de fuera». Son dos marcas distintas: «sin preguntar»
  sigue siendo solo de eliminar (AU-189: crear y modificar con «Sí» no la llevan) y «con datos de fuera» es de las
  tres. Un ejemplo de cómo se lee:
  Hecho en E2: `abilities` con una línea por colección y acción, `how` («saves», «asks», «noAsk» solo al eliminar
  con «Sí») y `outside` («con datos de fuera») solo en una escritura con «Sí» cuyo camino de filas o de control, o
  lo que cita, lee una colección que el servidor dice que guarda algo de fuera (`AbilitiesContext.outside`); el
  permiso se lee con `stepChanges`, que pasa por `permissionOf`. Probado contra el motor: con cada celda de cada
  acción de un «Código», y con cada «Permiso» de cada acción de un «Colección», lo que guarda nunca se nombra como
  «pregunta».
  Hecho en S1: `holdsOutside` del almacén (una consulta por colección, `EXISTS` sobre las etiquetas de sus filas por
  el índice `entities_type`, sin leer ninguna entera; no hay índice por integridad) y `outsideOf`, que la pregunta una
  vez por colección leída al abrir «Publicar», medida con 3.000 filas; con ella, una escritura con «Sí» a la que llegan
  sus filas dice «con datos de fuera». `runs.test.ts` llegó en S2.
  Hecho en P1: «Lo que podrá hacer» en la pantalla 10, una línea por colección y acción con su nombre, como la
  tabla de abajo (`abilityLine`; `publishing.test.ts` y `automations-publish.spec.ts`).

  | Lo que podrá hacer |
  |---|
  | Lee Notas |
  | Crea filas en Tareas · las guarda · con datos de fuera |
  | Elimina filas en Gastos · sin preguntar · con datos de fuera |
  | Modifica filas en Notas · pregunta |

  «Puede recibir algo de fuera» lo calcula `abilities` del grafo, sin ejecutar nada. Mira el camino del paso: de
  dónde le llegan filas y de qué depende que corra (P15). Vale si en él hay un disparador o un paso que el
  catálogo marca como fuente de fuera (ninguno en esta fase; «Al subir un archivo» y el correo en la F18, lo que
  sale fuera en la F20), o si se lee una colección que hoy guarda algún valor de fuera (AU-170), que es lo que hay
  en esta fase: eso lo dice el servidor al abrir «Publicar», con una consulta por colección leída, medida con 3.000
  filas (A-15), y la función sigue siendo pura. Lo que no puede saber: una colección que hoy no guarda nada de
  fuera puede guardarlo mañana, y lo publicado no vuelve a pasar por «Publicar». Por eso la ejecución también lo
  dice: la línea de una ejecución que guardó algo de fuera sin preguntar acaba en «con datos de fuera» (AU-99).
  Lo sostienen `versions.test.ts` (por cada ejemplo del catálogo que guarda, todo cambio que el motor aceptaría
  está nombrado en `abilities`, y uno que la conexión no permite no está; «con datos de fuera», caso por caso),
  Desde la decisión 13 (§10), un «Crear una fila» o un «Modificar filas» que añade su mano nace con «Sí», así que su
  línea dice «las guarda» sin que él haya tocado la celda: «Publicar» es donde lo ve, una vez, antes de que corra.
  `publish.test.ts` (la consulta de las colecciones que guardan algo de fuera, en su tiempo), `runs.test.ts` (la
  línea de la ejecución) y `automations-publish.spec.ts` (la pantalla).
- **AU-188** (F14d, hecho) · Un «Sí» solo lo pone la mano de Juan. Lo que llega sin haberlo escrito él (una
  automatización que propone el asistente, AU-140, o `automations_propose` del MCP, AU-144; «Pedir a Boni» y «Escribir
  con IA», AU-141, AU-39; un paquete o una plantilla, AU-145, AU-146) llega con cada «Sí» de guardar bajado a
  «Preguntar»: en crear, modificar y eliminar, en las conexiones y en «Eliminar filas» (AU-187), una sola regla para
  los tres. Su aceptación dice lo que podrá cambiar (AU-182). El botón que arregla un permiso que falta pone
  «Preguntar» (AU-176). Para que un paso guarde sin preguntar, Juan pone el «Sí» en su celda y publica.
  En la F14d: lo baja una sola función (`lowerYes`, `writes.ts`) por la que pasa todo lo que llega así antes de ser
  borrador. Un «Sí» que el borrador ya tenía de su mano se queda solo si su paso llega igual. Baja el nuevo, el
  cambiado de colección o de acción y, **decidido por Juan** (decisión 13 del §10), el de un paso que la llegada cambió (su
  código, sus parámetros, su conexión o de dónde le llegan filas): un «Sí» que Juan dio a un código no vale para
  otro código. El servidor lee el «Sí» de la versión publicada que tiene guardada, nunca de la caja, de un navegador
  ni de un modelo.
  Desde la decisión 11 (§10) esta regla lleva más peso: el «Sí» es lo único que separa lo que viene de fuera de
  guardarse sin preguntar. Cada manera en que una celda puede llegar a decir «Sí», y la prueba que la sostiene:

  | Cómo llega | Qué pasa con el «Sí» | Prueba |
  |---|---|---|
  | Su mano en la celda de una conexión o en «Permiso», en el editor (`keepDraft`) | Se queda | `publish.test.ts` («AU-188 · the ways a «Sí» stays…») |
  | Su mano añade un paso «Colección»: «Crear una fila» y «Modificar filas» nacen con «Sí» (AU-187, decisión 13) | Se queda. Es el único «Sí» que no es un toque suyo en la celda, y así lo decidió Juan | `consent.test.ts` («AU-187 · the value each action is born with…») |
  | «Duplicar» (`duplicateAutomation`) | Copia los suyos sin un toque nuevo; la copia nace sin publicar. Se quedan (decisión 13) | `publish.test.ts` («AU-188 · the ways a «Sí» stays…») |
  | «Volver a esta» (AU-98) | Vuelve un documento que él publicó: se quedan sin un toque nuevo, y «Publicar» los enseña antes. Se quedan (decisión 13) | la misma |
  | Recuperar una eliminada (AU-191), con «Recuperar» o con el «Deshacer» de su aviso | Devuelve lo que ya tuvo, sin un «Sí» más, y apagada. Se quedan (decisión 13) | la misma |
  | «Deshacer» (el del almacén, el de un turno, el de una ejecución) | No toca un borrador ni una versión, que no son operaciones del registro (AU-95): ni devuelve un «Sí» que él quitó ni quita uno que puso | `publish.test.ts` («AU-188 · no Undo gives a «Sí» back…») |
  | El asistente propone o cambia una (`automations.create`, `automations.edit`, A-35; F16) | Baja | `consent.test.ts` («AU-188 · `lowerYes` lowers every «Sí»…») y `publish.test.ts` («AU-188 · every function of the service that writes a draft…»); su caso propio entra con la F16 |
  | `automations_propose` del MCP (AU-144; F16) | Baja | las mismas; su caso, con la F16 |
  | «Pedir a Boni», «Escribir con IA» (F19) | Baja, y también el del paso que reescriben | las mismas y `consent.test.ts` («AU-188 · a «Sí» of a step whose code…»); su caso, con la F19 |
  | Un paquete, una plantilla, importar (AU-145, AU-146; F19) | Baja | las mismas; su caso, con la F19 |
  | Un flujo de antes convertido (F16) | Baja | las mismas; su caso, con la F16 |
  | El cuerpo de una petición, la respuesta de la caja, un borrador, un modelo | No cuenta: el servidor lee lo publicado | `publish.test.ts` («AU-188 · the «Sí» a run obeys…») |
  | Cambiar el nombre de una colección, o crear otra con el nombre de una eliminada (AU-192) | El «Sí» es de la colección por su clave: sigue a la misma y nunca pasa a otra | `runs.test.ts` («AU-188 AU-192 · a «Sí» belongs to its collection by key…») |

  **Decidido por Juan** (decisión 13 del §10, 2026-11-16): «Duplicar», «Volver a esta» y recuperar una eliminada
  dejan un «Sí» sin un toque nuevo en la celda, y se quedan: los tres devuelven un documento cuyo «Sí» puso él;
  «Duplicar» y «Volver a esta» pasan por «Publicar», que lo enseña (AU-182), y la recuperada vuelve apagada.

  **Decidido por Juan** (decisión 13 del §10): poner un «Sí» y publicar piden un dispositivo personal, como
  aceptar una propuesta (P21); desde uno compartido el editor deja ver y probar. Lo sostiene `publish.test.ts` («AU-188 · setting a «Sí»
  and publishing are refused…»).
  En la F14d todavía no llega nada sin haberlo escrito él (el asistente es de la F16; los paquetes, de la F19), así
  que la fase deja la función hecha y cerrado el camino: toda función del servidor que escribe un borrador está en
  una lista, como de su mano (el editor, «Duplicar») o como venida de fuera de ella, y las segundas pasan por
  `lowerYes`. Una función nueva que escriba un borrador y no esté en la lista hace fallar la prueba.
  Hecho en S1: el servidor lee el «Sí» de una ejecución de verdad de la versión publicada (`runDeps` con su
  ejecución), y «Probar», que no guarda, del borrador; `DRAFT_WRITERS` en `service.ts` y la prueba que la sostiene
  contra cada función del servidor que escribe un borrador; publicar y el interruptor se niegan desde un dispositivo
  compartido, en el servicio y en `http.ts`, que deja «Probar» y no deja guardar un borrador. Una prueba por fila de
  la tabla de arriba que es de esta fase. Los casos del asistente, del MCP y de los paquetes son de la F16 y la F19; el
  de `runs.test.ts` llegó en S2.
  Hecho en E1: `lowerYes`, con lo que baja y lo que deja, y el valor con el que nace cada acción (AU-187). Después
  de E1: `lowerYes` escribe «Preguntar» también donde faltaba el «Permiso», y cambiar la acción de un paso en el
  editor no lleva el «Sí» de la anterior (un «Sí» para crear no es uno para eliminar): nace con el de la nueva. La
  lista de quien escribe un borrador, cada caso de la tabla sobre el servidor y el dispositivo personal
  (`publish.test.ts`) llegaron en S1.
  Hecho en P1: desde un dispositivo compartido, «Publicar», el interruptor y «Ejecutar» dicen que eso se hace desde un
  dispositivo personal (la respuesta `personal-device-only` del servidor, con sus palabras) y no cambian nada
  (`automations-publish.spec.ts`).
  Lo sostienen `consent.test.ts` (`packages/automations`; `lowerYes`: baja crear, modificar y eliminar, en las
  conexiones y en «Permiso»; el que ya era suyo se queda si su paso llega igual; uno cambiado de colección o de
  acción, o de un paso cambiado, baja) y `publish.test.ts` del servidor (la lista de quien escribe un borrador; un
  caso por cada manera que ya existe en la F14d: el editor, «Duplicar», «Volver a esta», recuperar y «Deshacer»;
  las que llegan con la F16 y la F19 traen entonces el suyo, y hasta entonces las sostiene que ninguna función
  escribe un borrador sin estar en la lista; un «Sí» que dice la respuesta de la caja o el cuerpo de una petición
  no cuenta).
- **AU-189** (F14c, hecho) · Eliminar sin preguntar se ve a simple vista, aparte de lo que pregunta, con dos
  palabras, «sin preguntar»: en la ficha de la conexión («Lee y elimina · sin preguntar», AU-178), en la marca de la
  tarjeta («Elimina en Gastos · sin preguntar», AU-180), en «Haría esto» («Eliminaría 3 filas en Gastos · sin
  preguntar», AU-181) y en «Lo que podrá hacer» (AU-182, F14d). Crear y modificar con «Sí» no llevan nada: lo que se
  marca es lo que va a la papelera sin pasar por Juan. Las palabras salen de `i18n.ts`, sin explicaciones dentro de la
  app.
  En la F14c: la ficha, la marca y «Haría esto» salen de `permissions` y `stepChanges`, que dicen el modo de cada
  acción; un «Colección» con «Sí» en «Eliminar filas» (AU-187) se marca igual desde la F14d.
  Hecho en W1: `permissions` dice si eliminar es «Preguntar» o «Sí».
  Hecho en P3: «sin preguntar» en la ficha y en la marca de la tarjeta, que dicen lo que la celda permite (la decisión
  11); «Haría esto» dice lo que haría el motor: «sin preguntar» cuando ni la celda ni la política preguntarían, y si
  no, «Al ejecutarse, preguntaría antes de guardar». «Lo que podrá hacer» lo dice desde P1 de la F14d (AU-182).

### 5.9 Cómo empieza: los disparadores

| Disparador | Cuándo | Qué da | Fase |
|---|---|---|---|
| «Disparado por el usuario» | «Ejecutar» (F14d), un bloque de una página (F17), otra automatización o el asistente (F18) | Los «Campos que pide» | F14a (formato y motor); el lienzo, F14b |
| «Programada» | Reglas legibles: «Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora» | La fecha | F14d |
| «Llega un correo» | Cada correo nuevo que guarda «Traer correo», una vez por correo | El correo, como una fila, marcado como de fuera | F16 (AU-220) |
| Los de las automatizaciones de Boni: «Llega correo al buzón», «Cuando tus decisiones lo piden», «El gasto llega al aviso» | Como hoy, y solo en la suya | Lo de hoy | F16 (AU-220) |
| «Mensaje de chat» | Alguien escribe en el chat de una página | El mensaje y los valores de la página | F16 (AU-137) |
| «Cuando cambia una colección» | Se crea, se modifica (qué campos) o se elimina una fila; «Solo estas filas» | La fila, con su antes y su después | F18 |
| «Al subir un archivo» | Un archivo entra en una colección | El archivo | F18 |
| «Falla una automatización» | Otra falla | Cuál, en qué paso y por qué | F18 |

- **AU-110** (F14a, hecho) · Un disparador es un paso más, el primero. «Disparado por el usuario» puede declarar
  «Campos que pide» (nombre y tipo): son el formulario que sale al ejecutarla y lo que le pasan un botón u otra
  automatización. El formato y el motor lo tienen desde la F14a (con él empiezan sus pruebas); el lienzo lo dibuja
  en la F14b.
- **AU-111** (F17, pendiente) · «Disparado por el usuario» dice quién más puede iniciarla («La pueden iniciar»). Al
  crearla, nadie más. La primera opción es «Páginas» (sus botones, sus controles y el menú de una fila), y «Nueva
  automatización de esta página» la marca sola (AU-133). La F18 añade «Otras automatizaciones» (AU-112, que cambia
  D-44: decisión 3 del §10) y «El asistente» (AU-142).
- **AU-112** (F18, pendiente) · «Llamar automatización» elige una que lo permita y rellena sus campos; recibe lo que
  llegue a su paso «Devolver». Hasta tres de profundidad y sin llamarse a sí misma. La llamada es un literal, así
  que el mapa las enlaza y un ciclo no se puede publicar.
- **AU-113** (F18, pendiente) · «Cuando cambia una colección» lleva los topes de la tarea 88: tres eslabones por
  cadena, una automatización no se repite en su cadena, unas pocas ejecuciones por minuto.
- **AU-114** (F14d, hecho) · «Programada» tiene una o más reglas. Si el servidor estaba apagado a su hora, corre
  una vez al volver (lo que queda de D-44).
  En la F14d: una regla es «Cada hora», «Cada día a las 08:00» o «Cada lunes a las 09:00», la forma que ya tienen
  los flujos de antes (`Schedule`), y el disparador lleva una lista de ellas, al menos una. Las horas son de la zona
  de la cuenta (IANA), por `packages/calendar/src/time.ts`: una hora que el cambio de hora se salta o repite corre
  una vez. Da una fila con la fecha: la hora que tocaba, no la hora a la que corrió, así que dos ejecuciones de la
  misma hora calculan lo mismo. El planificador es el de hoy (`flowScheduler.ts`: `dueSlot`, `graceOf`, una vuelta
  por minuto), con las mismas funciones. Corre la última hora cumplida de cualquiera de sus reglas, una sola vez
  aunque coincidan varias, si es posterior a la publicación de la versión que corre, a que se encendió y a la
  última que corrió. Si el servidor estaba apagado, corre al volver solo esa última, y solo dentro del margen de
  D-44 (30 minutos las de cada hora, 3 horas las demás); pasada de margen, queda una línea «Omitida: Boni estaba
  apagado a su hora» en «Ejecuciones» y avisa como un fallo (AU-102). Nunca corre dos veces la misma hora: la
  ejecución guarda la hora que le tocaba y el almacén no admite otra con la misma. Si a su hora sigue corriendo la
  anterior, espera a la vuelta siguiente. Cada vuelta lee las horas de una columna de la automatización, escrita al
  publicar, y no los documentos. Empieza sola, así que la política la trata como dice AU-167. «Probar» le da la
  fecha de ahora (AU-115).
  Lo sostiene `scheduler.test.ts`, con un reloj de la prueba: corre a su hora y una vez; apagado tres horas con
  «Cada hora», corre una; fuera de margen, no corre y lo deja dicho; nada anterior a publicar o a encender; el
  cambio de hora; y una vuelta con 200 automatizaciones programadas dentro de su tiempo (A-15).
  Hecho en S3: «Programada» en el catálogo, con sus reglas comprobadas al publicar (una al menos, cada una con
  hora y día que existen); `scheduleColumn` escribe sus horas al publicar y `AutomationScheduler`
  (`apps/server/src/automations/scheduler.ts`, una vuelta por minuto, con `lastSlot` y `graceOf` de
  `flowScheduler.ts`) empieza la ejecución en la cola de la cuenta con `startedBy` `"schedule"`. La hora es única
  por automatización en el almacén (migración 29), así que dos vueltas o un reinicio no la repiten; fuera de margen
  queda «No corrió» (`missed`), sin «Reintentar» ni «Deshacer». A la escala de Juan: una vuelta sin nada que correr
  sobre 200 automatizaciones, menos de 50 ms; una página de «Ejecuciones» sobre un año de ejecuciones por hora,
  menos de 30 ms; la vuelta rara en que tocan las 200, en torno a 1,3 s (cada una lee y comprueba su versión).
  Hecho en P3: su panel dice cada regla en palabras, como los flujos de antes («Cada día a las 08:00», «Cada lunes a
  las 09:00», «Cada hora a y 15»), y pide «Día» solo con «Cada semana»; sin ninguna, falta (como la rechaza el
  servidor). Su tarjeta dice la primera y cuántas más; «Se inicia» de la lista, publicada, las dice todas, de la
  columna escrita al publicar. En «Ejecuciones», la suya dice «Programada», y la que no corrió, «Omitida: Boni
  estaba apagado a su hora». Lo sostienen `words.test.ts`, `flowsCollection.test.ts`, la prueba del navegador y la
  del escritorio sobre el servidor de verdad: publicada para el minuto siguiente, corre sola, crea su fila, se ve en
  «Ejecuciones» con la pantalla abierta y se deshace desde ahí.
  Hecho en S4: «No corrió» avisa como un fallo de su racha (`scheduler.test.ts`). La revisión de
  la fase (P3b-2) la comparó con AU-167 y la dio por hecha.
- **AU-115** (F14b, hecho) · Toda automatización se puede probar a mano, tenga el disparador que tenga.
- **AU-116** (F17, pendiente) · El panel de un disparador lista quién la inicia hoy: qué botones de qué páginas y
  qué automatizaciones. Se calcula, no se declara (A-16).
- **AU-117** (F18, pendiente) · «Al subir un archivo» elige una colección y, si se quiere, la clase de archivo. Da
  la fila con su archivo. Lo que se lee de un archivo cuenta como de fuera: lo que la automatización escriba a
  partir de él se guarda como de fuera, y sin preguntar solo con «Sí» (decisión 11 del §10; antes se proponía).
- **AU-118** (F18, pendiente) · «Falla una automatización» elige cuáles («Todas» o una lista) y da cuál falló, en
  qué paso y por qué. No se inicia por un fallo suyo ni por el de otra que este mismo disparador inició: un fallo no
  hace una cadena.
- **AU-119** (F18, pendiente) · «Esperar» deja la ejecución «esperando» (AU-15) hasta una hora o durante un tiempo,
  con un máximo a la vista, y la reanuda donde estaba aunque el servidor se haya reiniciado. «Por tandas» reparte
  las filas que le llegan en grupos de un tamaño, y los pasos que cuelgan de él corren una vez por grupo, uno
  detrás de otro (AU-07).
- **AU-220** (F16, en parte) · Los disparadores de Boni son pasos del catálogo, y los inicia el mismo camino que a
  los demás. «Llega un correo» se puede poner en cualquier automatización: da una fila, el correo como lo guarda la
  colección de correos, marcada entera como de fuera, y corre una vez por correo nuevo, en el orden en que llegan.
  En «Leer correo» esa fila lleva además lo que Boni prepara hoy para sus piezas (lo que el disparador de antes
  daba con el correo: la guía, lo ya sabido del remitente, las opciones), que calcula el código y solo citan ellas;
  en otra automatización no está.
  Los otros tres («Llega correo al buzón», «Cuando tus decisiones lo piden» y «El gasto llega al aviso») solo existen
  en su automatización de Boni (AU-221): el panel de añadir no los ofrece, y una copia de esa automatización nace con
  «Disparado por el usuario», como hoy.
  En la F16: quien hoy llama al motor de antes por cada uno (el conector del correo, la cuenta de decisiones, la
  mirada al gasto) llama a `runPublished` con la automatización y su entrada; ninguno pasa por `FlowScheduler`, que
  se va (AU-152). Lo que cada uno limita se queda en el código y no en el paso: una mirada al buzón que no encuentra
  correo no es una ejecución (D-50); la revisión, una vez al día como mucho (D-51); el aviso del gasto, una
  ejecución al mes (D-53). «Probar con…» de «Llega un correo» ofrece los últimos correos guardados (lo que AU-94
  dejó para esta fase). Una automatización de Juan que empieza con un correo sigue AU-186: con «Sí», quien escribe el
  correo elige dentro de lo que Juan dibujó; y el paso que no puso su mano nace con «Preguntar» (AU-230). Con un año
  de correo (11.000 ejecuciones de «Leer correo»), iniciar una ejecución, listarlas y recortarlas va dentro de su
  tiempo (A-15, AU-103). La prueba: `packages/automations/src/boni-steps.test.ts` y
  `apps/server/src/automations/boni.test.ts`.
  Hecho en E1: los disparadores de Boni y «Mensaje de chat» son pasos (`BONI_TRIGGERS`): «Llega un correo» da una fila
  marcada como de fuera y lo usa cualquier automatización; los otros tres validan solo en la suya
  (`boni-steps.test.ts`); y el traductor da a cada disparador de antes el suyo, con «08:00» cuando el programado no
  decía hora, como el programador de antes (`plan-to-automation.test.ts`). Falta (S1): que los inicie el camino
  publicado y no el programador de antes, y los tiempos con un año de correo.

### 5.10 El catálogo de pasos

| Categoría | Pasos | Fase |
|---|---|---|
| Disparadores | Los del §5.9 | |
| Datos | «Colección»: Buscar filas · Leer una fila · Crear una fila · Modificar filas · Crear o modificar · Eliminar filas · Contar o sumar | F14a |
| Transformar | Editar campos · Filtrar · Ordenar · Limitar · Quitar duplicados · Agrupar · Separar una lista · Juntar en una · Fecha · Combinar | F14a |
| Lógica | Si · Elegir rama · Parar con error · Esperar · Por tandas · Llamar automatización · Devolver | F14a; los cuatro últimos, F18 |
| Código | Código | F14c |
| IA | Agente · Extraer datos · Clasificar · Resumir · Escribir texto | F15 |
| Personas | Preguntar · Avisar · Responder | F15 |
| Página | Leer valores · Poner valor · Mostrar en un bloque · Abrir página | F17 |
| Boni | Las piezas de sus automatizaciones («Regla del remitente», «Lectora», «Decisora» y las demás), «Acción de Boni» y «Lector de Boni» | F16 |

- **AU-120** (F14a, hecho) · En «Colección» se eligen primero la colección y la acción, y de ellas salen los
  demás parámetros. «Buscar filas»: «Solo estas filas», «Ordenar por» y «Límite» (50); como opción, «Incluir
  relacionadas» (un nivel: `$json.categoria.nombre`). «Leer una fila» con una fila que no está falla el paso: no
  da una salida vacía, y «Si falla» decide qué pasa después. «Contar o sumar» da una fila por grupo y llama a cada
  resultado por su medida y su campo (`sum_importe`; contar filas es `count`), como «Agrupar»; dos resultados con el
  mismo nombre, o uno que se llama como un campo por el que agrupa, hacen que la automatización no sea válida.
- **AU-121** (F14a, hecho) · Crear y modificar enseñan el formulario de la fila: solo los campos que Juan añade,
  cada uno con el control de su tipo. Modificar y eliminar actúan sobre «Las filas que llegan» (por defecto si
  vienen de esa colección) o sobre «Las que cumplan…», que pide al menos una condición: sin ella la automatización
  no es válida. «Las que cumplan…» alcanza a todas las filas que cumplen la condición; el tope lo ponen los límites
  de la ejecución (AU-17). «Crear o modificar» con más de una fila que coincide falla el paso y dice cuántas: no
  elige una.
- **AU-122** (F14a, hecho) · «Eliminar filas» manda a la papelera. Borrar del todo no existe en una
  automatización. El paso da las filas como estaban antes de ir a la papelera.
- **AU-187** (F14d, hecho) · Las acciones de un paso «Colección» que escriben («Crear una fila», «Modificar
  filas», «Eliminar filas») llevan el mismo permiso que las columnas de una conexión: un parámetro «Permiso»,
  «Preguntar» o «Sí», con las palabras de AU-41. Con «Sí», lo que el paso guarda o manda a la papelera no pregunta en
  lo que dice AU-186. Hasta el 2026-11-16 eliminar preguntaba siempre (P5), y así un paso que escribió y publicó Juan
  preguntaba más que un código que hiciera lo mismo. Hasta la decisión 11 (§10) solo lo llevaba «Eliminar filas»:
  crear y modificar escribían solos lo propio y proponían lo de fuera, sin celda. Desde ella lo de fuera se guarda
  con un «Sí», y un paso sin celda no tendría ninguno que Juan hubiera puesto ni que `lowerYes` pudiera bajar
  (AU-188).
  **Decidido por Juan** (decisión 13 del §10, 2026-11-16): con qué valor nace. «Eliminar filas» nace con
  «Preguntar». «Crear una fila» y «Modificar filas» nacen con «Sí» cuando el paso lo añade su mano
  en el editor, a la vista en el paso: es lo que ya hacían (decisión 5: escriben con Deshacer), y «crea una fila
  cada mañana» no debe preguntar cada mañana. Lo que eso trae desde la decisión 11: un paso así guarda sin
  preguntar, desde su primera ejecución publicada, también lo que le llegue de fuera, sin que él haya tocado la
  celda; «Publicar» lo dice en su línea («con datos de fuera», AU-182). Llegados de otra manera nacen con
  «Preguntar» (AU-188). Es un valor del catálogo (`PERMISSION_BORN`) y una prueba.
  En la F14d: es un parámetro más de cada una de las tres acciones en el catálogo, a la vista (cambia el resultado:
  AU-77), con las dos palabras de las celdas de una conexión, de las mismas claves de `i18n.ts`. El valor con el que
  nace lo escribe el código en el paso cuando su mano lo añade o le cambia la acción (`bornParams`), y un paso
  guardado sin él se lee «Preguntar», venga de donde venga: un «Sí» nunca es un valor que falta. `stepChanges`
  deja de dar eliminar siempre como «Preguntar» y lee el parámetro en las tres, así que la tarjeta («Elimina en
  Gastos · sin preguntar»), «Haría esto» y «Lo que podrá hacer» lo dicen igual que de un «Código» (AU-189).
  `lowerYes` lo baja como una celda (AU-188).
  Hecho en E1: el parámetro en las tres y en «Crear o modificar», que también guarda (nace con «Sí», como crear y
  modificar), con las palabras de las celdas; con qué valor nace cada una; `stepChanges` lo lee en todas; `lowerYes`
  lo baja. Después de E1 (tarea 128): el valor con el que nace va escrito en el paso que añade su mano, y un paso
  sin él pregunta.
  Hecho en P1: la marca de la tarjeta («Elimina en Gastos · sin preguntar»), y «Haría esto» que dice «A la papelera ·
  sin preguntar» en cada fila de un «Eliminar filas» con «Sí», con su prueba en `automations-publish.spec.ts`.
  Hecho en P3b: el «Permiso» de «Eliminar filas» sobre el servidor real, en la app de escritorio: «Sí» tira sin
  preguntar y «Preguntar» propone (`e2e-boni-desktop/automations-publish.spec.ts`, AU-186 AU-187).
  Lo sostienen `consent.test.ts` (`packages/automations`: el parámetro en las tres acciones, con qué valor nace, que
  un paso sin él pregunta, y lo que `stepChanges` da con cada uno), `edit.test.ts` (`apps/boni-web`: el paso que
  añade su mano lleva su «Permiso» escrito; cambiar la acción no lleva el «Sí» de la otra) y
  `automations-publish.spec.ts` (el control y la marca de la tarjeta).
- **AU-123** (F14a, hecho) · «Si» tiene dos salidas, «sí» y «no». «Elegir rama» tiene una por regla y, a la
  vista, «Si ninguna coincide» (nada, o una salida «otras») y «La primera que coincida | Todas las que coincidan».
- **AU-124** (F14a, hecho) · «Combinar» tiene dos entradas con nombre y junta por un campo, por posición o todas
  con todas. Solo hace falta para cruzar; para juntar ramas, no (AU-11).
- **AU-125** (F15, en parte) · «Preguntar» pregunta a Juan (opciones o texto). En segundo plano espera con un
  «Límite de espera» a la vista; nunca espera para siempre.
  En la F15: enseña tres cosas. **Pregunta** (texto, con expresiones). **Respuesta**: «Sí o no», «Una opción»,
  «Varias opciones» o «Texto», con las opciones fijas o de una expresión que da la lista; son los controles que la
  Bandeja ya tiene (`FLOW_ASKS`), y número, fecha y «una fila de…» llegan con la conversación (F16). **Límite de
  espera** (nace en 1 día, hasta 30). Tiene dos salidas: la principal, con la fila de entrada y `respuesta`, y «sin
  respuesta», para cuando el límite pasa; sin nada conectado a ella, la ejecución acaba ahí y lo dice. Pregunta una
  vez con todas las filas; «Una vez por fila» está detrás de «Añadir opción» y admite hasta 20 preguntas por
  ejecución: con más, el paso falla antes de hacer ninguna («Son 41 preguntas · como mucho 20»). La tarjeta la pinta
  el código, en texto plano: qué automatización pregunta, la pregunta, sus controles y hasta cuándo espera, con la
  marca de lo que viene de fuera. La respuesta lleva la etiqueta de su mano cuando la escribe él, y la de la opción
  cuando elige una. Es lo que quedaba abierto de «las preguntas por paso y la Bandeja como paso» y de «contestar
  preguntas» de una función (tareas 83 y 93 de la cola). Cómo espera lo dice AU-203. La prueba:
  `packages/automations/src/people.test.ts` y `e2e-boni/automations-ai.spec.ts`.
  Hecho en E4: el paso `ask` en el motor (`people.ts`, `catalogue.ts`, `engine.ts`), alcanzable solo con su puerto
  (`ValidationContext.people`, `RunDeps.people`; sin él es `step.unknownType`). Sus tres parámetros a la vista y
  «Una vez por fila» detrás de una opción; la validación da `param.value` a un límite que no es un número entero de
  1 a 30 y a unas opciones fijas vacías, en blanco o repetidas. Sus dos salidas, `main` con `respuesta` y
  `noAnswer`. Pregunta una vez con todas las filas o una por fila, y con más de 20 falla antes de hacer ninguna
  (`ask.questions`); unas opciones de una expresión que no dan una lista de textos fallan (`ask.options`). La
  pregunta guarda su texto tal cual, plano, con la etiqueta de lo que cita, y cada opción la suya. Una respuesta que
  no encaja con su pregunta se niega antes de seguir (`answerFits`, `CannotRun`); la escrita lleva la etiqueta de su
  mano, la elegida la de la opción y «Sí o no» la de la automatización. Hecho en S2: la tarjeta en la Bandeja y
  quién da la mano de la respuesta (AU-203). Hecho en P2: el paso en el lienzo, en la categoría «Preguntar o avisar»
  con «Avisar» y «Responder», y sus palabras; «Opciones» solo con «Una opción» y «Varias opciones», una línea por
  opción con «Borrar» y «Añadir» debajo, guardadas como una lista de textos; el límite se llama «Días de espera»
  (confirmado por Juan el 2026-11-18; el diseño decía «Límite de espera»). La tarjeta de la Bandeja dice
  qué automatización pregunta («De «Archivar leídos»», el nombre de la versión que corrió, en texto plano: el
  servidor lo da con la lista, `automation` en `GET /api/agent/requests`), y sus controles salen de lo que el
  servidor dice que ese dispositivo puede hacer (`mayAnswer`, decisión 26: sin él, contesta y decide el servidor al
  recibirla). En SALIDA, tras una prueba, la pregunta y cómo acabó: «Esperando respuesta · hasta…», «Respondida» o
  «Sin respuesta». La prueba: `e2e-boni/automations-ai.spec.ts` («AU-125 · a «Preguntar» of a run waits as a card in
  the Bandeja…», «AU-125 · «Opciones» of a «Preguntar»…» y «AU-125 · A-15 · 200 questions…»). Falta: la línea de una
  ejecución que acabó sin respuesta lo dice solo como «Completada» (su registro dice `ended: "noAnswer"`).
- **AU-201** (F15, en parte) · «Avisar» enseña una cosa: **Texto** (con expresiones). Manda un aviso a Juan, por el
  `notify` de siempre: no tiene destinatario, así que nada de fuera ni ningún modelo elige a quién (P2, P14). Detrás
  de «Añadir opción», **Dónde**: «En el ordenador y el móvil» (nace así), «Solo en el ordenador» o «Solo en el
  móvil»; es una lista cerrada de sus dispositivos, fija en el paso y nunca una expresión (decisión 17 del §10: lo
  que guarda sola una ejecución no avisa, y un aviso es este paso). Uno por ejecución; «Una vez por fila», detrás de «Añadir opción», manda hasta 5 y después uno que
  los junta («y 12 más»). El texto se pinta plano, recortado a 300 caracteres, y tocarlo abre su ejecución. En una
  prueba dice «Avisaría…» y no manda nada. No es el aviso de AU-102 (el de un fallo, que manda Boni): este lo pone
  Juan en su grafo. La prueba: `packages/automations/src/people.test.ts`.
  Hecho en E4: el paso `notify` en el motor, con `text`, `mode` y `where` y ningún otro parámetro; `where` es una
  elección de `all`, `desktop` o `phone`, y una expresión o cualquier otro valor no pasa la validación
  (`param.shape`, `param.value`). Manda por `PeoplePort.notify` un aviso por ejecución con las filas, que siguen; por
  fila, 5 y uno que dice cuántos más (`more`, las palabras son de la app), cada texto recortado a 300 caracteres por
  puntos de código. El texto es el del paso tal cual, plano, con la etiqueta de lo que cita, y lo de fuera no cambia
  a dónde va. En una prueba no manda nada y su registro dice lo que mandaría (`notices`, `sent: false`). Hecho en
  S2: el `notify` del servidor (`waits.ts`, `peoplePort`) pasa por la política como una llamada sin destinatario
  (`noticeDecision`: P1, como desde un turno) y va a donde dice «Dónde»: al canal de la app (`notify`, con la
  ejecución que abre) con `all` y `desktop`, y al móvil con `all` y `phone`; uno que junta dice «y N más». Falta:
  el paso en el lienzo y «Avisaría…» (P2). Hecho en P2: el paso en el lienzo, con **Texto** a la vista y «Se
  ejecuta» y «Dónde» detrás de «Añadir opción» («Ordenador y móvil», «Solo ordenador», «Solo móvil»); en SALIDA,
  tras una prueba, «Avisaría» con cada aviso y a dónde iría («Archivados 3 · ordenador»), el que junta el resto
  como «y 12 más», todo en texto plano. La prueba: `e2e-boni/automations-ai.spec.ts` («AU-203 · AU-201 · AU-202 ·
  «Probar» that reaches a «Preguntar»…»). Falta: comprobar con la app que tocar el aviso abre su ejecución.
- **AU-202** (F15, en parte) · «Responder» enseña una cosa: **Respuesta** (texto, con expresiones). Pone la
  respuesta de la ejecución, que se ve donde se inició: en la F15, en el panel de «Ejecutar» y de «Probar» y en la
  línea de la ejecución (sus primeros 200 caracteres); con el disparador de chat será el mensaje (F16), y en una
  página, lo que enseña su bloque (F17). Una ejecución tiene una respuesta: la del último «Responder» que corrió. Se
  pinta plana y conserva la etiqueta de lo que cita. En una ejecución que empezó sola se queda en la ejecución: no
  es un aviso. La prueba: `packages/automations/src/people.test.ts`.
  Hecho en E4: el paso `reply` en el motor, con `text` y nada más, una vez con todas las filas, que siguen. La
  ejecución guarda `reply` (el paso, el texto entero y plano, la etiqueta de lo que cita): la del último que corrió,
  también a través de una espera. Ninguno manda un aviso, tampoco en una ejecución que empezó sola. Falta: enseñarla
  en el panel de «Ejecutar» y de «Probar» y en la línea de la ejecución (P2, con `REPLY_LINE`). Hecho en P2: en
  «Probar», la respuesta entera y en texto plano en SALIDA del «Responder» que la dio (`reply` de la prueba, también
  de una prueba que siguió tras una pregunta). La prueba: `e2e-boni/automations-ai.spec.ts` («AU-203 · AU-201 ·
  AU-202 · «Probar» that reaches a «Preguntar»…»). Falta: el panel de «Ejecutar» y la línea de la ejecución (sus
  primeros 200 caracteres): el servidor no da todavía la respuesta de una ejecución en su resumen ni en su vista.
- **AU-203** (F15, en parte) · Una ejecución que pregunta espera sin estorbar y nunca para siempre. Al llegar a un
  «Preguntar», el motor termina lo que no depende de la respuesta y la ejecución queda «Esperando» («Esperando tu
  respuesta · hasta mañana a las 9:40»), con su tarjeta en la Bandeja. Mientras espera:
  - Suelta su turno: las ejecuciones siguientes de esa automatización corren, y como mucho 20 esperan a la vez por
    automatización (la siguiente falla en ese paso: «Ya hay 20 preguntas sin responder»).
  - Guarda lo que necesita para seguir: las salidas de sus pasos hechos, con sus etiquetas, hasta 2 MB (razonado y
    no medido); si no cabe, el paso falla sin preguntar y lo dice. Van en el almacén del usuario, con las tablas de
    la ejecución (D-02), y se podan con ella.
  - Aguanta un reinicio del servidor: no es una ejecución interrumpida (AU-190), sigue esperando, y el planificador
    de horas mira los límites de espera vencidos.
  - El límite de tiempo de la ejecución (AU-17) cuenta lo que corre, no lo que espera; las filas escritas y las
    llamadas a modelos se cuentan juntas, antes y después.
  Contestar es un toque en un dispositivo con la sesión de la cuenta, personal o compartido (decisión 26 del §10;
  un altavoz no), salvo que el paso pida uno personal. La ejecución sigue desde
  ese paso, en su turno y con la versión con la que empezó, aunque haya otra publicada, y lo dice su línea. Sus
  pasos son los de esa versión; lo que guarda después de la espera se decide al guardar, con el «Sí» más bajo entre
  el de esa versión y el de la publicada en ese momento (una celda que Juan bajó o quitó desde entonces pregunta) y
  con la pausa de AU-210: esperar nunca conserva un permiso que él ya retiró. La propuesta de la ejecución (AU-193)
  se junta cuando la ejecución termina, también después de una espera: mientras espera una respuesta su línea dice
  «Esperando respuesta», y «1 propuesta sin responder» solo cuando ya terminó. Pasado el
  límite sale por «sin respuesta» y la tarjeta queda «Caducada». Apagar o eliminar la automatización, o deshacer
  la ejecución, cancela la espera («Cancelada»), y su tarjeta queda cancelada, aparte de las que
  caducan (decisión 27). En «Probar» la pregunta sale en el panel de la prueba y se contesta
  allí: no va a la Bandeja. La prueba: `packages/automations/src/people.test.ts` y
  `apps/server/src/automations/ai.test.ts`.
  Hecho en E4, en el motor: al llegar a un «Preguntar» termina lo que no depende de la respuesta, el paso queda
  `waiting` y los que siguen detrás de él por sus flechas, `queued` sin filas ni avisos; la ejecución acaba
  `waiting`, con `waits` (el límite más cercano y lo que contó). Varias preguntas esperan a la vez, y un fallo para
  lo que espera. `resume` sigue con lo guardado, leído otra vez como tras un reinicio: solo la misma versión, el
  mismo disparador, un paso que espera y respuestas que encajan (si no, `CannotRun`); no vuelve a correr lo hecho,
  `$('X').item` sigue emparejando, sin respuesta y dentro del límite sigue esperando, y pasado el límite sale por
  `noAnswer` aunque llegue una respuesta. El tiempo de la ejecución suma lo que corrió antes y después, no la espera;
  filas escritas y llamadas a modelos se cuentan juntas («Como mucho» es de cada paso, que corre a un solo lado de
  la espera). Como mucho 20 esperando por automatización (`ask.waiting`, que una prueba no cuenta) y 2 MB de lo
  guardado, medido cuando ya corrió todo lo que no depende de la respuesta (`ask.kept`, sin preguntar).
  Hecho en S2, en el servidor (`apps/server/src/automations/runs.ts` y `waits.ts`): una ejecución que espera suelta su
  turno (`openAutomationRun` solo cuenta las que están en cola o corriendo) y guarda lo suyo en el almacén del
  usuario, en `automation_run_waits` (migración 32: la ejecución guardada, sus respuestas y el límite más cercano),
  que la poda no toca mientras espera. Un reinicio no la corta (`interruptRuns` solo cierra las que estaban en cola
  o corriendo), y el planificador, en cada tick y antes de las programadas, sigue las que pasaron su límite
  (`expireWaits`, 50 cada vez), que salen por «sin respuesta». Cada pregunta es una tarjeta de la Bandeja
  (`RequestRow`, con `view.automation`: ejecución, paso y pregunta), pintada por código con los controles de la app
  («Sí o no», una opción, varias o texto); se contesta o se aparta solo desde un dispositivo personal, y la
  respuesta lleva su mano y su dispositivo (`GivenAnswer.by`). (Cambiado en la tarea 129, decisión 26: también desde
  uno compartido.) Cuando todas las preguntas de un paso tienen
  respuesta, la ejecución sigue en su turno con la versión con la que empezó y el «Sí» más bajo entre esa versión y
  la publicada en ese momento (`lowerYes`: un paso que cambió pregunta entero); la propuesta se hace al terminar.
  Apagar o eliminar la automatización, o deshacer la ejecución, la cancela («Cancelada») y sus tarjetas quedan
  «Caducada», igual que la de una ejecución que ya siguió o pasó su límite. Con los modelos apagados, la Bandeja
  sigue sirviendo lo que una ejecución puso en ella por código, su propuesta (`automations.accept_run`) y su
  «Preguntar», y se aceptan, rechazan y contestan igual (por la política y desde un dispositivo personal); una
  propuesta que escribió un modelo y el resto de `/api/agent` siguen apagados (`OFF_ROUTES` en `agent.ts`; decidido
  de noche, para que Juan lo confirme). Hecho en S3: al seguir, la ejecución lee también la pausa de AU-210
  (`resumePublished` con `pausedDoc`), que solo baja; esa lectura no tiene todavía una prueba propia. Falta, de la
  pantalla (P2), el límite en «Esperando respuesta · hasta…» y la pregunta en el panel de la prueba. Hecho en P2:
  en «Ejecuciones», la línea de una que espera dice «Esperando respuesta · hasta 18 nov 2026, 09:12» (`until` del
  resumen, a la zona del dispositivo) y no cuenta como un fallo. En «Probar», una prueba que llega a un «Preguntar»
  espera en el servidor, en memoria (decidido de noche, para que Juan lo confirme: no se guarda, y un reinicio la
  pierde), y sus preguntas salen encima de «Probar», en el panel de la prueba y nunca en la Bandeja: «Sí» y «No»,
  sus opciones, varias para marcar o un texto, «Enviar» cuando todas tienen respuesta y «Sin respuesta» para todas;
  el «Registro» dice «esperando respuesta». Contestar sigue la misma prueba (`POST …/test` con `answers`), y una que
  el servidor ya no tiene dice «Prueba caducada». La prueba: `apps/server/src/automations/ai.test.ts` («AU-203 AU-201
  AU-202 · «Probar» that reaches a «Preguntar» waits in its own panel…»), `apps/boni-web/src/automations/state.test.ts`
  y `runs.test.ts` («AU-203 · …») y `e2e-boni/automations-ai.spec.ts` («AU-203 · «Sin respuesta» answers every
  question…» y «AU-203 · a run that waits for an answer says until when…»). Falta: la prueba propia de la pausa al
  seguir (S3).
  Hecho en la tarea 129 (decisiones 26 y 27): contesta o aparta cualquier dispositivo de la cuenta menos un altavoz
  (`mayAnswer` de `waits.ts`, que `GET /api/agent/requests` da por tarjeta), y solo uno personal si el paso tiene
  «Solo desde un dispositivo personal» (`personal`, que la tarjeta guarda en `view.automation`); una respuesta
  escrita desde uno compartido lleva la etiqueta `ambient` con el dispositivo como fuente (`answerLabel` de
  `runs.ts`). Las tarjetas de una espera cancelada quedan `cancelled` (migración 34) y una respuesta a ellas vuelve
  con `run-cancelled`. Hecho en P2: la opción en el editor, «Solo desde un dispositivo personal» detrás de «Añadir
  opción» de «Preguntar», apagada al nacer; la tarjeta según `mayAnswer` (sin él, contesta: un servidor de antes), y
  una que ese dispositivo no contesta no tiene controles ni «Descartar» y dice «Solo desde un dispositivo personal»;
  una tarjeta cancelada dice «Pregunta cancelada». La prueba: `e2e-boni/automations-ai.spec.ts` («AU-125 · a
  «Preguntar» of a run waits as a card in the Bandeja…», «AU-125 · «Solo desde un dispositivo personal»…» y «AU-203 ·
  a card of a cancelled run says «Pregunta cancelada»…»).
- **AU-126** (F14a, hecho) · «Solo si», «Para cada» y «Junto con» dejan de ser campos de todos los pasos: son
  «Si» o «Filtrar», el trabajo por fila del motor y «Combinar».
- **AU-127** (F16, en parte) · Las piezas de Boni son pasos de la categoría «Boni»: se ven, se conectan y se
  configuran con lo que hoy dejan cambiar. Por dentro siguen siendo código de Boni (decisión 3a de la tarea 103).
  En la F16: cada paso de una automatización de Boni es un tipo de la categoría «Boni», con el nombre que hoy tiene
  en su lienzo: uno por pieza (`PIECES`, `apps/server/src/pieces.ts`), y sus lectores y sus «Crear» también, para
  que lo que proponen siga siendo lo del correo.

  | Automatización de Boni | Sus pasos, en orden | Lo que deja cambiar |
  |---|---|---|
  | «Traer correo» | «Llega correo al buzón» → «Guardar en Correos» | Encenderla y apagarla |
  | «Leer correo» | «Llega un correo» → «Regla del remitente» → «Ya propuesto» → «Leer invitación» → «Lectora» → «Decisora» → «Rellenadora» → «Buscar relaciones» → «Crear en la elegida» (y el «Crear» de la invitación) → «Plegar hilo» → «Aceptar solas» | El modelo de cada lector; entre qué colecciones elige la «Decisora» y en cuál crea cada «Crear», escritas en el paso como literales (D-48); los días de «Plegar hilo» (1 a 366); «Solo» de «Aceptar solas» |
  | «Revisar la guía» | «Cuando tus decisiones lo piden» → «Tus decisiones» → «Revisora» → «Medir releyendo» → «Sugerencia» | Cada cuántas decisiones (10 a 500); cuántos correos relee (hasta 20) |
  | «Aviso del presupuesto» | «El gasto llega al aviso» → «Avisar» | El texto del aviso |

  La tabla nombra las piezas; entre ellas la automatización lleva los «Si» y «Elegir rama» que hagan falta, donde el
  flujo tenía «Solo si» y `case`. En una automatización de Boni un lector es su pieza («Decisora», y no
  «Clasificar»): lleva lo que el correo le añade. La pregunta de la «Decisora» cuando duda es parte de su paso: no
  deja la ejecución esperando, y la respuesta de Juan inicia otra lectura de ese correo, como hoy. Convertida,
  la «Decisora» elige entre las mismas colecciones que hoy, todas (decisión 20): su panel las lista, y Juan quita
  una y publica cuando quiera.
  Una pieza solo existe en su automatización (A-19 se queda): el panel de añadir no la ofrece en otra, y una copia
  la pierde y lo dice. Por dentro es el código de hoy, que el motor llama por un puerto (`RunDeps.boni`, como
  `RunDeps.ai` para los modelos): `packages/automations` conoce su tipo, sus parámetros y sus salidas, y no importa
  nada de una app
  (A-02). No tiene celdas ni «Sí»: lo que una pieza cambia pasa por `decide` como hoy, con el origen del segundo
  plano de su automatización (P7: lo que crea se propone, con las tarjetas del correo de siempre; P28 no vale para
  ella), y en «Probar» no cambia nada y dice lo que haría (A-19, D-43). Así «Leer correo» sigue proponiendo lo
  mismo, y «Aceptar solas» sigue siendo lo único que acepta por su cuenta (`docs/fiabilidad.md`). Cambiar una
  automatización de Boni cambia lo que hace, nunca lo que se le permite: sus topes (una revisión al día, 20 correos
  por medida y 45 lecturas al día, un aviso al mes) están en el código de la pieza, no en un parámetro. Lo que Juan
  añade a una de ellas con su mano en el lienzo nuevo es un paso como en cualquier otra, con sus celdas.
  La categoría tiene dos tipos más, que no son piezas y dan paso a lo que el catálogo no tiene con nombre propio
  (AU-223): «Acción de Boni», una acción de la lista de acciones (`docs/sistema.md` §4.1) elegida como literal, con
  sus argumentos; y «Lector de Boni», un lector de `READERS` sin paso propio, con su entrada. Llegan por la
  conversión o al guardar un plan (AU-143): en esta fase el panel de añadir no los ofrece, y cuando una acción gane
  su paso (los de «Página», F17) el despliegue los migra (AU-08). La prueba:
  `packages/automations/src/boni-steps.test.ts`, `apps/server/src/automations/boni.test.ts` y
  `e2e-boni-desktop/automations-before.spec.ts`.
  Hecho en E1: la categoría «Boni» del catálogo (`packages/automations/src/boni.ts`): las 16 piezas, cada una con solo
  lo que deja cambiar, más lo que le pasaba su llamada de antes (`args`, datos para su código, nunca un destino) y su
  porqué; «Acción de Boni» y «Lector de Boni»; y el puerto `RunDeps.boni`: sin él ningún paso de Boni valida, ni una
  pieza fuera de su automatización; ninguno tiene celdas ni «Sí» (`boni-steps.test.ts`). Falta (S1): el puerto del
  servidor, que corre el código de hoy con el origen de su flujo, y «Leer correo» convertida leyendo un correo
  inventado (`boni.test.ts`).
- **AU-221** (F16, pendiente) · Las automatizaciones de Boni son las cuatro que hoy son flujos («Traer correo», «Leer
  correo», «Revisar la guía» y «Aviso del presupuesto») y una nueva, «Revisar los agentes» (AU-211). Están en la lista
  con «De: Boni», se abren en el lienzo, se cambian, se prueban y
  se apagan, y se puede volver a la de Boni; no se eliminan.
  En la F16: cada una tiene sus versiones en `automation_versions` con su autor: `preset` las que trae Boni y `user`
  las que publica Juan. «Volver al de Boni» es «Volver a esta» (AU-98) sobre la última «De Boni».
  Las versiones de antes se convierten con el traductor, como las de Juan; la «De Boni» que sale con la F16 no: Boni
  la dibuja a mano en el formato nuevo, con «Elegir rama» y el trabajo por fila donde la lista daba rodeos, y la
  misma prueba diferencial (AU-224) la compara con el flujo de antes sobre correos inventados. Es lo primero que
  Juan abre en el lienzo, y una traducción literal de doce pasos de lista no se lee. Un despliegue que
  trae una versión nueva de Boni la añade «De Boni»: corre si la que corría era de Boni; si corría una de Juan,
  espera en «Versiones» y la lista lo dice («Boni tiene una versión nueva»). Una cuenta nueva las recibe ya en este
  formato. Apagada, no corre y lo dice donde hoy (los ajustes del correo, «Modelos»): sin «Traer correo» no entra
  correo. «Mantenimiento» (las copias cada seis horas) sigue fuera: no es una automatización. La prueba:
  `apps/server/src/automations/boni.test.ts` y `e2e-boni/automations-before.spec.ts`.
- **AU-128** (sin fase) · Lo que sale fuera (una petición HTTP, un webhook, enviar un correo) no entra en estas
  fases: va después, en la F20 (decisión 9 del §10). Cuando entre, el destino lo escribe Juan y nunca sale de un
  dato ni de un modelo (P2), lo que vuelve cuenta como de fuera, y las claves se guardan en el servidor sin que el
  código ni un modelo las vean.

### 5.11 Páginas y toda la app

- **AU-130** (F17, pendiente) · Cada bloque de una página tiene un identificador fijo por debajo (ya lo tiene) y un
  nombre único en su página, que se ve y se cambia en la cabecera de su panel: «Gráfica de categorías», «Calcular».
  Hoy solo los controles tienen nombre.
- **AU-131** (F17, pendiente) · Un bloque dice en su panel qué pasa con sus eventos: un botón «Al pulsar», un control
  «Al cambiar», la página «Al abrir». Una de las cosas que puede pasar es «Ejecutar automatización» (pantalla 9).
- **AU-132** (F17, pendiente) · Al elegir una automatización, el panel enseña sus «Campos que pide» y de dónde sale
  cada uno: un control de la página, por su nombre, o un valor. Todos los valores de la página llegan además en
  `$page`. Debajo, «Actúa sobre» lista los bloques que esa automatización toca (calculado, AU-134), y con el botón
  seleccionado la página los marca con una línea discontinua.
- **AU-133** (F17, pendiente) · «Nueva automatización de esta página» la crea ya enlazada al bloque, con «La pueden
  iniciar: páginas» marcado (AU-111), y la abre en el editor. En la lista, su columna «De» dice «Página «Gastos»» y
  «Se inicia» nombra el bloque («Botón «Calcular» de «Gastos»»; si son varios, cuántos).
- **AU-134** (F17, pendiente) · Los pasos de «Página» actúan sobre bloques por su nombre: «Leer valores», «Poner
  valor» (en un control), «Mostrar en un bloque» (una gráfica, una cifra, una tabla o un texto reciben las filas) y
  «Abrir página». El bloque es un literal: el mapa sabe qué automatización toca qué bloque. Es la manera de que algo
  cambie porque Juan hizo algo: pulsa «Calcular» y la gráfica cambia; pulsa «Explicar» y la respuesta de un «Agente»
  sale en un bloque de texto, como texto llano.
- **AU-135** (F17, pendiente) · Un bloque de datos puede tomar sus datos «De una automatización» en vez de «De una
  colección»: la ejecuta solo para leer con los valores de la página, al abrirla y al cambiar un control, sin pulsar
  nada. Es la manera de que un bloque esté siempre al día, y solo valen para ella las automatizaciones que ni
  escriben ni llaman a un modelo: lo demás pasa cuando Juan pulsa algo (AU-134). Un bloque usa una de las dos
  maneras: el que toma sus datos de una automatización no se ofrece en «Mostrar en un bloque». En las dos guarda lo
  último que recibió y dice de cuándo es. Medido con el volumen de Juan antes de salir (A-15).
- **AU-136** (F17, pendiente) · El «formulario» del ejemplo de Juan son controles de una página y un botón. No hay
  otro constructor de formularios.
- **AU-137** (F16, pendiente) · El chat de una página es una automatización: «Mensaje de chat» → «Agente» →
  «Responder», con las colecciones que la página enseña como conexiones (D-61 y D-62 se quedan).
  En la F16: el bloque «Chat» sigue nombrando el mismo identificador, que ahora es el de una automatización, y su
  panel dice lo de siempre con «Abrir la automatización». «Mensaje de chat» guarda lo que hoy guarda el disparador
  «Chat»: la página, la bienvenida y hasta seis botones de arranque. El «Agente» nace con las colecciones que la
  página enseña como conexiones solo con «Leer» (AU-43), y tiene una conexión más, «Esta página», que solo existe con
  este disparador y deja lo que el chat de hoy: leer sus cifras (calculadas por código, D-62), poner un valor en un
  control suyo (P27, se deshace) y añadir un bloque, que se pregunta. En un «Agente» que empieza en «Mensaje de chat»
  las celdas de escribir ofrecen «No» y «Preguntar», nunca «Sí»: lo que el chat quiere escribir es una tarjeta en esa
  conversación, que solo acepta su mano en un dispositivo personal (P4 y P26 no cambian), y un mensaje, que puede
  llevar texto pegado de fuera, no llega a escribir solo. Lo comprueba el servidor al publicar y al correr, no el
  desplegable. Cada mensaje es una ejecución, con su fila en «Ejecuciones», y «Responder» es el mensaje que se ve,
  como texto llano. La conversación, sus mensajes y su memoria siguen donde están (`docs/conversacion.md`): la
  automatización recibe en `$chat` los últimos mensajes de ese chat, marcados como lo que son. Solo el chat de una
  página es una automatización; la conversación con el asistente no (decisión 19). La prueba:
  `apps/server/src/automations/chat.test.ts` y `e2e-boni/automations-before.spec.ts`.
- **AU-222** (F16, pendiente) · Dentro de una conversación, lo que una automatización pregunta y lo que responde se
  ve en esa conversación. Un «Preguntar» de una ejecución que empezó en un chat (el de una página, o el asistente al
  ejecutarla) es una tarjeta en ese chat y no una fila de la Bandeja (lo que AU-42 dejó para esta fase), con las
  respuestas que AU-125 dejó: un número, una fecha y «una fila de…» una colección, además de las que ya hay, y «Un
  archivo», que solo se puede pedir en una conversación. La
  ejecución espera como espera hoy (AU-42), y una respuesta que llega tarde se trata igual. «Responder» gana «Se ve
  como», detrás de «Añadir opción» (AU-75): Texto, Número, Lista, Tabla o Gráfica, los componentes de hoy, que pinta
  el código con lo que le llega y nunca un modelo (A-01). En un «Agente» de un chat, «Memoria» (AU-58) es cuántos
  mensajes de ese chat recibe (de 0 a 20). Fuera de un chat, «Responder» sigue siendo lo que la ejecución devuelve
  (AU-202). La prueba: `apps/server/src/automations/chat.test.ts`.
- **AU-138** (F17, pendiente) · En una tabla, el menú de una fila ofrece «Ejecutar automatización con esta fila»
  para las que piden una fila de esa colección y se dejan iniciar desde páginas (AU-111).
- **AU-139** (F17, pendiente) · Qué puede iniciar una automatización y sobre qué puede actuar sale de un solo
  registro de la app, del que leen el editor, el mapa, el asistente y el MCP. Un elemento nuevo de la app se apunta
  ahí y ya se puede automatizar: así el concepto llega a todo.

Lo que entra en ese registro con estas fases, y lo que no:

| Elemento de la app | Inicia una automatización | Le da valores | Una automatización actúa sobre él | Fase |
|---|---|---|---|---|
| Botón de una página | «Al pulsar» | Los «Campos que pide», de los controles | — | F17 |
| Control de una página (el «formulario») | «Al cambiar» | Su valor; todos, en `$page` | «Leer valores», «Poner valor» | F17 |
| Página | «Al abrir» | `$page` | «Abrir página» | F17 |
| Gráfica, cifra, tabla o texto de una página | — | — | «Mostrar en un bloque»; o toma sus datos «De una automatización» | F17 |
| Fila de una tabla | «Ejecutar automatización con esta fila» | La fila | Los pasos «Colección» | F17 |
| Chat de una página | «Mensaje de chat» | El mensaje y `$page` | «Responder» | F16 |
| Colección (también lo que sale en el calendario: sus tareas y eventos son filas) | «Cuando cambia una colección», «Al subir un archivo» | La fila, con su antes y su después | Los pasos «Colección» y las conexiones | F14a; los disparadores, F18 |
| La conversación | El asistente ejecuta las que lo permiten | Los «Campos que pide» | «Responder»; un plan se guarda como automatización | F16, F18 |
| La Bandeja y los avisos | — | — | «Preguntar», «Avisar» y las propuestas de una conexión | F15 |
| El correo | «Llega un correo» | Lo que leen sus lectores | — (enviar un correo es salir fuera: AU-128) | F16 |
| El reloj | «Programada» | La fecha | «Esperar» | F14d, F18 |
| Otra automatización | «Llamar automatización», «Falla una automatización» | Sus campos; lo que devuelve | — | F18 |

Fuera, sin fase: la app Boni Calendar (sus eventos entran como filas, pero no tiene bloques ni botones que inicien
nada), los ajustes de Boni y lo que está fuera de Boni (decisión 9 del §10).

### 5.12 La conversación, la IA que propone, el MCP y los paquetes

- **AU-140** (F16, pendiente) · Un modelo nunca activa ni cambia una automatización: propone un borrador que Juan
  abre en el lienzo y publica o no (P19, A-10).
  En la F16: en un turno, el asistente propone con dos acciones de la lista, `automations.create` y
  `automations.edit` (A-35), que sustituyen a `flows.save` y a «Activar» de la tarjeta de hoy. La propuesta es una
  tarjeta inerte en la conversación: el nombre, sus pasos en palabras y «Lo que podrá hacer» (AU-182), ya validada y
  probada en seco. Aceptarla, con su mano en un dispositivo personal, crea un **borrador** con cada «Sí» bajado a
  «Preguntar» (`lowerYes`, AU-188) y lo abre en el lienzo: ni publicado ni encendido. Una propuesta de cambio sobre
  un borrador que cambió desde entonces dice «Caducada». Ejecutar una automatización desde un turno
  (`automations.run`, antes `flows.run`) sigue como hoy, con confirmación (P8), hasta que la F18 traiga «La pueden
  iniciar» (AU-111, AU-142). Los botones de página con «Hace: Flujo» siguen pulsándose igual, por el mismo
  identificador. La prueba: `apps/server/src/automations/assistant.test.ts` y `e2e-boni/automations-before.spec.ts`.
- **AU-141** (F19, pendiente) · «Pedir a Boni» en el editor: Juan describe un cambio y Boni lo propone sobre el
  borrador, marcando cada paso nuevo, cambiado o quitado, para aceptarlo o no.
- **AU-142** (F18, pendiente) · El asistente puede ejecutar las automatizaciones que lo permiten (AU-111), con
  confirmación (P8).
- **AU-143** (F16, en parte) · En un turno de la conversación el modelo sigue escribiendo un plan. El plan se
  traduce a pasos de este mismo catálogo y lo corre este motor, así que «Guardar como automatización» lo abre en el
  lienzo tal cual (D-41).
  En la F16: un solo traductor, `planToAutomation` (`packages/agent`), con la tabla de AU-223, y tres usos: la
  conversión de los flujos guardados (AU-150), el plan de un turno y «Guardar como automatización», que crea un
  borrador (con `lowerYes`) y lo abre. El modelo sigue escribiendo el lenguaje de planes, y `validatePlan` y
  `checkPlan` lo siguen comprobando antes de traducir (A-01). El turno corre en el motor nuevo con el origen del
  turno, que pone el servidor y nunca es `automation`: P28 no vale para él, y cada acto recibe de `decide` lo mismo
  que hoy (P4, P5, P8; AU-230). Sus topes son los del turno de hoy, no los de una automatización. Lo que hizo un
  turno se sigue guardando donde hoy (`runs`, `run_steps`) y «Registro» no cambia: un turno no es una ejecución de
  «Ejecuciones», ni la conversación una automatización (decisión 19). La prueba:
  `packages/agent/test/plan-to-automation.test.ts` y
  `packages/agent/test/automation-before.test.ts`.
  Hecho en E1: el plan de un turno, validado por `validatePlan` como hoy, lo traduce la misma función (`from:
  "turn"`): «Disparado por el usuario» sin campos, lo que citó de Juan como su valor, cada escritura en «Preguntar» y
  sin «Sus límites son los de una automatización» (`plan-to-automation.test.ts`). Falta: «Guardar como
  automatización», que lo guarda como borrador (S1), y el turno sobre el motor nuevo con sus topes y su registro.
- **AU-144** (F16, pendiente) · MCP: `automations_describe`, `automations_propose`, `automations_test` y
  `automations_runs`. Los `flows_*` siguen una versión como alias.
  En la F16: `automations_describe` da el catálogo de pasos, las colecciones por su clave, los disparadores y sus
  automatizaciones como documentos publicados, nunca un borrador (D-55). `automations_propose` recibe un documento,
  lo valida, le baja cada «Sí» (`lowerYes`), lo prueba en seco y deja una propuesta inerte que Juan acepta o no en
  la app (AU-140): devuelve los problemas, o `{proposed, waitsFor}`. `automations_test` prueba en seco un documento
  o una automatización suya con una entrada, sin escribir, y devuelve hechos: qué pasos corrieron, cuántas filas, lo
  que habría escrito (el punto 13 de la tarea 63). `automations_runs` da hasta 20 ejecuciones con códigos y cuentas,
  sin textos. Los cuatro `flows_*` viven una versión más: llaman a su gemelo, dicen el nombre nuevo en su
  descripción, y `flows_propose` acepta el `{trigger, plan}` de antes, que pasa por el traductor. Los permisos son
  los de hoy (A-10), y las acciones `automations.*` dejan de estar en `NO_MCP_YET`. La prueba:
  `apps/server/src/automations/assistant.test.ts`.
- **AU-231** (F16, pendiente) · El chat y las automatizaciones se tocan de dos maneras, y son distintas (decisión
  19).
  **El chat de una página es una automatización.** Está en la lista, se abre en el lienzo y Juan cambia sus pasos.
  Ejemplo: en la página «Gastos» pregunta «¿cuánto llevo este mes?», y lo que le contesta lo decide «Chat de
  Gastos» («Mensaje de chat» → «Agente» → «Responder»), que él puede abrir y cambiar (AU-137).
  **La conversación con el asistente no es una automatización: las usa.** Ejecuta las que lo permiten, con
  confirmación (AU-142); propone una nueva o un cambio como borrador, que Juan publica o no (AU-140); y lo que acaba
  de hacer se guarda como una (AU-143). Ejemplo: le dice «resume mis notas de esta semana», el asistente lo hace, y
  «Guardar como automatización» lo deja como borrador en el lienzo para que corra cada lunes.
  Juan lo dejó así (decisión 19), porque el asistente tiene todas las acciones de Boni y las reglas de un turno (P4,
  P5, P8), que las conexiones de un paso no saben decir: como automatización sería un paso que se abre y no se puede
  cambiar de verdad. Así que la conversación no sale en la lista de automatizaciones ni tiene «Ejecuciones»; lo que
  hizo sigue en «Registro». La prueba: `apps/server/src/automations/chat.test.ts`.
- **AU-145** (F19, pendiente) · Un paquete (`docs/sistema.md`, F13; tarea 89) lleva automatizaciones además de
  colecciones, páginas y funciones. Al instalarlo llegan sin publicar: Juan abre cada una, ve «Lo que podrá hacer»
  (AU-96) y la publica o no. En la lista, su columna «De» dice el paquete.
- **AU-146** (F19, pendiente) · Una plantilla es una automatización de ejemplo que trae Boni o un paquete. «Nueva»
  las ofrece junto al lienzo vacío, y elegir una copia sus pasos a un borrador de Juan. No nombra colecciones suyas:
  las deja por elegir, y la validación dice cuáles faltan (D-14).
- **AU-147** (F19, pendiente) · Funciones guardadas: la colección «Funciones» de hoy (tarea 93) guarda código con
  nombre, entradas declaradas y sus pruebas. Un «Código» o una expresión la llama por su nombre y un «Agente» la
  puede tener como herramienta de código (AU-58). Corre en la caja con las conexiones del paso que la llama, nunca
  con otras. Al publicar, la versión se lleva la copia de las funciones que usa: cambiar una función no cambia lo
  que ya corre hasta que se publica otra vez (AU-95).

### 5.13 Migración

- **AU-150** (F16, pendiente) · Los flujos guardados se convierten por código a automatizaciones, con sus versiones:
  cada paso a su tipo, «Solo si» a un «Si», «Para cada» al trabajo por fila, «Función» + «Aplicar cambios» a «Código»
  + «Colección». La conversión se prueba antes de desplegar con copias de los flujos de Juan y con los de Boni. Lo
  que no se pueda convertir queda apagado con su aviso; nada se borra.
  En la F16: la conversión es el traductor de AU-143 (`planToAutomation`) aplicado a cada versión de cada flujo, con
  la tabla de AU-223; lo que hace igual lo dice AU-224, y cuándo pasa, qué ve Juan y cómo vuelve, AU-225. «Función» y
  «Aplicar cambios» no pasan todavía a «Código» + «Colección»: se convierten en dos «Acción de Boni» con sus acciones
  de hoy, que guardan lo que D-52 promete (se repite, la misma huella, todo o nada, una sola propuesta) y que un
  «Código» con `$col` no da. Pasarán a «Código» + «Colección» con las funciones guardadas (AU-147, F19), por la
  migración de tipos (AU-08). Antes de desplegar, sobre una copia de la cuenta de Juan y con el último commit que
  aún tiene los dos motores, se hacen dos cosas: la conversión en seco, y la repetición de las últimas ejecuciones
  de cada flujo (hasta 20) en los dos motores, sin escribir, con lo que los modelos contestaron entonces donde el
  registro lo guarda y con un modelo de guion donde no. El informe dice, por flujo, cuántas versiones convierte, qué
  pasos salen, «Lo que cambia» y en cuántas de esas ejecuciones los dos piden lo mismo, sin textos suyos; esa copia
  y ese informe nunca entran en el repositorio. Solo se despliega si todas coinciden o su diferencia es una de «Lo
  que cambia». No se corren los dos motores a la vez en su cuenta de verdad: doblaría las llamadas a modelos y
  retrasaría lo que quiere usar. La prueba: `apps/server/src/automations/convert.test.ts`.
  Desde la tarea 154 (§5.16): qué «Modelo» lleva cada paso convertido lo dice AU-245 (ninguno, salvo
  la «Revisora» de una cuenta cuyo «Revisor» no es su «Lector»).
- **AU-223** (F16, en parte) · La tabla de traducción: cada cosa que el lenguaje de planes sabe decir tiene su fila,
  con el paso al que va o, si no lo tiene, dicho con su nombre. Una prueba recorre el lenguaje (las cuatro
  operaciones, `READERS`, los controles de `ask`, `REPLY_COMPONENTS`, `FNS`, los disparadores y las acciones de la
  lista) y falla si a algo le falta su fila: una pieza nueva del lenguaje no entra sin decir a qué se convierte.

  | De antes | Paso nuevo |
  |---|---|
  | Disparador «A mano», con sus entradas | «Disparado por el usuario», con sus «Campos que pide» |
  | Disparador «Programado» (cada hora, cada día, cada semana) | «Programada», con una regla y su hora |
  | Disparadores «Llega un correo», «Llega correo al buzón», el de la revisión y el del gasto | Los de AU-220 |
  | Disparador «Chat» | «Mensaje de chat» (AU-137) |
  | Llamada a `entities.query` · `entities.get` · `entities.aggregate` | «Colección»: Buscar filas · Leer una fila · Contar o sumar |
  | Llamada a `entities.create` · `entities.update` · `entities.delete` | «Colección»: Crear una fila · Modificar filas · Eliminar filas, con su celda en «Preguntar» (AU-230) |
  | Llamada a `notify` | «Avisar» |
  | Llamada a una pieza (`PIECES`) | Su paso de «Boni» (AU-127) |
  | Llamada a cualquier otra acción de la lista («Función» y «Aplicar cambios» entre ellas) | «Acción de Boni» |
  | Lector `fill` | «Extraer datos» |
  | Lectores `classify`, `label_each` | «Clasificar» |
  | Lectores `summarize`, `summarize_each` | «Resumir» |
  | Lector `rewrite` | «Escribir texto» |
  | Lectores `read_message`, `review_reading`, y cualquier lector dentro de una automatización de Boni | Su pieza de «Boni» (AU-127): «Lectora», «Revisora», «Decisora», «Rellenadora» |
  | Lectores `extract_tasks`, `answer_about` | «Lector de Boni» |
  | `ask`: `yesno` · `choice` · `several` · `text` | «Preguntar»: Sí o no · Una opción · Varias opciones · Texto |
  | `ask`: `number` · `date` · `file` | «Preguntar»: Un número · Una fecha · Un archivo (AU-222) |
  | `ask`: `rehearsal` | «Preguntar» · Ensayo: solo nace del plan de un turno; el motor corre en seco lo que queda y la tarjeta lo enseña |
  | `reply`: `text` · `number` · `list` · `table` · `chart` | «Responder», con «Se ve como» (AU-222) |
  | `reply`: `run` | «Responder» · Ejecución: solo nace del plan de un turno |
  | «Solo si» (`when`) | Un «Si» delante: el paso cuelga de «sí», y lo que seguía, de las dos salidas |
  | «Para cada» (`each`) | El trabajo por fila (AU-13); con «Separar una lista» delante si la lista no eran filas |
  | «Junto con» (`zip`) | «Combinar» por posición |
  | Una referencia a otro paso (`{ref}`) | Una expresión que lo cita por su nombre: `{{ $('Buscar').first().json.titulo }}` |
  | Una referencia a una entrada del disparador | Una expresión que cita el disparador: `{{ $('Disparado por el usuario').first().json.mes }}` |
  | Un literal (`lit`) | El valor, tal cual |
  | Una cita de lo que escribió Juan (`quote`) | El valor, con la etiqueta de su mano: solo nace del plan de un turno |
  | El porqué de una llamada (`why`) | Se queda en el paso y se enseña donde hoy, como texto llano de quien lo escribió; no es la «Nota» de Juan |
  | Las 24 funciones (`FNS`) | Una expresión cada una (`count` es `.length`; `concat`, texto con `{{ }}`; `today` y `add_days`, `$today` y `.plus`), con una fila por función en el traductor |
  | `case` que elige una colección, una acción o un paso | «Elegir rama», con una rama por valor y en cada una el paso con su literal (AU-26) |

  La forma: los pasos quedan en fila, en su orden, cada uno unido al anterior. Un paso que corría una vez sigue
  corriendo una vez, lleguen las filas que lleguen («Solo la primera fila», o «Juntar en una» delante si leía la
  lista entera), y uno cuyo anterior no da filas sigue como seguía («Seguir sin filas»). Los topes de la lista
  (hasta 50 vueltas de «Para cada», 40 pasos, tres niveles) se quedan como validación de lo convertido: lo que
  cabía, cabe. Sin equivalente en una automatización publicada, y dicho así al convertir: nada de lo que hoy puede
  guardar un flujo (lo comprueba la prueba con `checkFlow`); el «Ensayo» y «Ejecución» solo existen en un turno. La
  prueba: `packages/agent/test/plan-to-automation.test.ts`.
  Hecho en E1: `planToAutomation` y su tabla `TRANSLATION` (`packages/agent/src/convert.ts`), pura: el mismo plan da
  el mismo documento. La prueba recorre operaciones, formas, átomos, `READERS`, los controles de `ask`,
  `REPLY_COMPONENTS`, `FNS`, los disparadores, cada acción de `coreTools` y cada pieza: todas tienen su fila, y un
  paso de cada una da su paso o dice por qué no lo tiene (`UNTRANSLATED_REASONS`, una lista cerrada); un argumento sin
  sitio se dice, no se pierde. Cada función es una expresión que da lo mismo que la de antes sobre los mismos valores,
  y falla donde fallaba. La forma: «Juntar en una» delante de lo que corría una vez si lo anterior puede dar más de
  una fila; «Solo si», un «Editar» que calcula la condición y un «Si»; «Para cada», siempre con «Separar una lista»
  delante (también sobre filas: cada vuelta lleva la etiqueta de toda la lista, más estricta, nunca menos); «Junto
  con», «Combinar» por posición. Sin paso todavía, y dicho así al convertir: `entities.get`, `entities.update` y
  `entities.delete` por id (el paso nuevo necesita la colección y el plan solo da la fila, `noCollection`; menos el
  `entities.get` del correo que la inició, que es la fila del disparador); el `case` que elige colección (`chooses`,
  «Elegir rama»); `ask` de número, fecha y archivo y `reply` de número, lista, tabla y gráfica (`laterPhase`, AU-222);
  el «Agente» del chat (AU-137); el porqué en «Colección» y «Avisar»; `question`, `ask` y `given` de `classify`; y
  `fill` fuera de «Leer correo», cuyos campos no son fijos; un «Cada cuántas decisiones» fuera de 10–500. Un paso con
  una forma que no conoce se dice y no rompe la conversión. Falta (S1): esos pasos, con `entities.get`,
  `entities.update` y `entities.delete` decididos sobre los flujos de verdad; la comprobación con `checkFlow` de que
  nada de lo que hoy puede guardar un flujo queda sin paso; y la de que lo que cabía en los topes del lenguaje (50
  vueltas, 40 pasos, 3 niveles) cabe convertido, donde un paso puede dar hasta siete.
- **AU-224** (F16, en parte) · Convertida, hace lo mismo. Con las mismas entradas y las mismas respuestas de los
  modelos, la automatización convertida hace las mismas llamadas a lectores con el mismo valor de entrada, las
  mismas lecturas, y pide a la política las mismas escrituras, en el mismo orden y con las mismas etiquetas de lo
  que viene de fuera, que el flujo de antes. Lo comprueba una prueba diferencial: el ensayo en seco del motor de
  antes contra «Probar» del nuevo, sobre cada fila de la tabla de AU-223, las cuatro de Boni y flujos inventados con
  la forma de los de un usuario (una búsqueda sin resultados, una lista de 50, un «Solo si» falso, un lector que
  falla). Donde el paso nuevo es más estrecho o se comporta distinto, la conversión no lo calla: lo calcula por
  automatización como «Lo que cambia», con frases de una lista cerrada. Las de esta fase: «Antes escribía sin
  preguntar cuando la iniciabas tú; ahora pregunta» (AU-230); «Los textos de más de 4.000 caracteres se recortan»
  (AU-57); «Lo que escribe una ejecución se deshace entero» (AU-18); «Sus límites son los de una automatización»
  (AU-17). Cuando el motor de antes se va (AU-152), la prueba se queda con lo que el motor de antes hacía, grabado en
  ficheros, para que el traductor del turno no cambie sin verse. La prueba:
  `packages/agent/test/plan-to-automation.test.ts`.
  Hecho en E1: «Lo que cambia» (`CHANGES`): las cuatro frases, calculadas por conversión: «asksNow» si un flujo que
  iniciaba él escribe, «textsCut» si lee con un modelo, «undoWhole» si escribe, «automationLimits» si es un flujo (un
  turno se queda sin ella). Y un flujo convertido corre en el motor nuevo con colecciones inventadas: cada lectura una
  vez, con tres filas y con ninguna, y lo que escribe propuesto (`plan-to-automation.test.ts`). Falta (S1): la prueba
  diferencial contra el ensayo en seco del motor de antes, con respuestas de modelo guionizadas, sobre la tabla de
  AU-223, las cuatro de Boni y los flujos inventados.
- **AU-225** (F16, pendiente) · Cuándo se convierte, qué ve Juan, cómo lo comprueba y cómo vuelve. Una vez: al abrir
  su almacén tras el despliegue que la trae, por código, sin modelo y sin que él haga nada. Para Juan es un solo
  momento: decidió (2026-11-17) que nada de estas fases se despliega hasta acabar la F16, así que ese despliegue es
  el primero que le trae «Automatizaciones» y el mismo que convierte todos sus flujos, los de Boni y los chats de
  sus páginas. Antes, una copia del almacén. Cada flujo se convierte en una transacción y la conversión se puede
  repetir sin duplicar nada: en `main`, mientras la fase se construye, alcanza a más flujos con cada PR (AU-228), y la
  franja lista los que lleva. Conserva
  el identificador (los botones de página, el bloque «Chat» y el mapa lo siguen nombrando), el nombre, encendido o
  apagado, y su horario. Cada versión del flujo es una versión de la automatización, con su número, su fecha y su
  autor, marcada «Convertida» en «Versiones»; la publicada es la que corría. Un borrador a medias (`flow_drafts`) es
  su borrador. Los sitios de los pasos no se guardan: los pone «Ordenar».
  Lo que ve: la primera vez que abre «Automatizaciones» (donde estaba «Flujos»), la lista con las suyas y las cuatro
  de Boni y, arriba, una franja: «Tus flujos son ahora automatizaciones». La franja lista las convertidas y dice de
  cada una «Hace lo mismo» o «Lo que cambia» (AU-224) y, desde entonces, cómo le va: «3 ejecuciones desde la
  conversión · ninguna falló». Se queda hasta que él la cierra, y después está en «⋯ → Conversión». Un aviso en la
  app, una vez, lleva a ella. En la lista, «Formato anterior» no sale: todo está convertido. Un flujo con una
  versión que no se puede convertir se queda sin esa versión y lo cuenta («2 versiones de antes no se pudieron
  convertir»); si es la que corría, la automatización nace apagada con el aviso de AU-150.
  Cómo lo comprueba: la abre, ve sus pasos, pulsa «Probar» con la última entrada con la que corrió (AU-94) y compara
  con las ejecuciones de antes, que siguen en «Ejecuciones» (AU-227).
  Cómo vuelve, de menos a más. Apagarla, con su interruptor: una convertida nunca escribe sola (AU-230), así que lo
  peor que hace una conversión mala es proponer algo que no toca, avisar de más o fallar, y se ve en la franja.
  Mientras el motor de antes sigue en la app (hasta el PR de AU-152), «⋯ → Volver al flujo de antes» en esa
  automatización: vuelve a correr el flujo como estaba y la automatización queda apagada, sin borrarse; «Convertir
  otra vez» lo deshace. Y entera, la copia de antes de convertir con la versión anterior de las apps. Después de
  AU-152 quedan la primera y la última, y un traductor corregido puede convertir otra vez desde el archivo. Nada se
  borra: las tablas `flows`
  y `flow_drafts` se quedan como archivo, sin que nada las lea para correr. La prueba:
  `apps/server/src/automations/convert.test.ts` y `e2e-boni/automations-before.spec.ts`.
- **AU-226** (F16, pendiente) · Lo que estaba a medias al convertir no se pierde ni se hace dos veces. Una propuesta
  de un flujo que espera en la Bandeja guarda el acto ya resuelto: se acepta o se rechaza como siempre, sin motor.
  Una ejecución de antes que espera (una pregunta, o una confirmación en una conversación: `waiting_runs`) la
  reanuda el motor que la empezó mientras exista, nunca el otro; al quitarlo (AU-152), la que aún espere se cierra
  con «Caducada · Ejecutar otra vez». Las preguntas y las propuestas del correo son datos del correo, no
  ejecuciones: siguen
  igual. Un flujo programado corre una vez en cada hueco: la conversión lleva a `AutomationScheduler` la última hora
  en que corrió, así que ni repite el hueco de hoy ni se salta el siguiente. El correo que llega durante la
  conversión se lee una vez: «Traer correo» y «Leer correo» cambian de motor en la misma transacción, y lo que dice
  si un correo ya se leyó es un dato del correo, no del motor, así que cambiar de motor ni lo relee ni lo salta. La
  prueba:
  `apps/server/src/automations/convert.test.ts`.
- **AU-227** (F16, pendiente) · El historial de antes y el volumen. Las ejecuciones de un flujo siguen en
  «Ejecuciones» de su automatización como filas de resumen, marcadas «De antes»: cuándo, cómo acabó, cuánto tardó y
  qué versión, como las recortadas de AU-103, sin sus pasos (que siguen en «Registro», donde están hoy). Se copian
  por tandas de 200, con el servidor libre entre una y otra, después de convertir y sin esperar por ellas. Conservan
  su identificador de ejecución: «Deshacer lo que hizo» sigue valiendo para ellas. No cuentan para las 100 enteras
  de AU-103. Medido con el volumen de un año antes de salir (A-15, `@boni/pace`): 50 flujos con 60 versiones cada
  uno se convierten en menos de 5 s; 20.000 ejecuciones con 200.000 pasos se copian sin que una petición espere más
  de 100 ms por ello; y abrir «Ejecuciones» de «Leer correo» con 11.000 filas va en el tiempo de AU-103. El turno
  también se mide: un plan de diez pasos sin lectores no tarda en el motor nuevo más de 250 ms más que en el de
  antes (sus expresiones corren en la caja). La prueba: `apps/server/src/automations/convert.test.ts`.
- **AU-228** (F16, pendiente) · El orden. En cada commit de `main`, a cada flujo o automatización lo corre un motor
  y solo uno, y todo lo que corría sigue corriendo. Primero entran el traductor y los pasos de «Boni», sin que nada
  los use. Luego la conversión, que en la misma transacción crea la automatización y deja de correr el flujo, y que
  convierte un flujo solo cuando quien lo inicia ya sabe iniciar su automatización: primero los de «A mano» y los
  programados, con los botones de página y `flows.run`; después, cada uno en el PR que muda a quien lo llama, los
  de Boni (el correo, la revisión, el gasto) y el chat de página; y el MCP y las propuestas del asistente. Un flujo
  aún sin convertir sigue en el motor de antes, con «Formato anterior». Eso es `main` mientras se construye: a
  Juan le llega todo junto (AU-225). Mientras conviven, los dos motores cuentan en el mismo presupuesto de modelos y
  en los mismos topes del día, y una ejecución la termina el motor que la empezó (AU-226). El turno pasa el último,
  detrás de la prueba diferencial de `decide`
  (AU-230). Y solo cuando nada importa ya el motor ni el editor de antes, se quitan (AU-152). Una prueba lo guarda
  mientras dura: ningún identificador tiene a la vez un flujo que corre y una automatización encendida, y los
  ficheros que ya se mudaron no importan `flows.ts` ni `Agent.background`. La prueba:
  `apps/server/src/automations/convert.test.ts`.
- **AU-151** (F14b, hecho) · Mientras tanto conviven: la lista enseña las dos clases y un flujo de antes abre el
  editor de antes, marcado «formato anterior».
  En la F14b: «Nueva» crea siempre una automatización del formato nuevo. Un flujo de antes abre su editor de siempre,
  con «Formato anterior» junto a su nombre, y sigue encendido, apagado y ejecutándose como estaba.
- **AU-152** (F16, pendiente) · Al terminar se quitan el motor de listas, el editor viejo y sus pruebas, y los
  principios y la guía de diseño se reescriben en el mismo PR.
  En la F16: es el último PR de la fase. El despliegue de la F16 sale con todo lo demás y con el motor de antes
  dormido: nada en la app dice «Formato anterior», porque todo está convertido, y el motor de antes solo corre si Juan
  pulsa «Volver al flujo de antes» (AU-225). Cuando él dice que las convertidas valen, se mezcla este PR y sale en el
  despliegue siguiente. Es contraer después de comprobar, y Juan lo decidió así (decisión 21). Se van: el editor de
  antes (`FlowEditor.tsx`, `FlowStepPanel.tsx`, `ExprField.tsx`, `FlowPreview.tsx`, `core/flowLayout.ts`,
  `core/flowEdit.ts`, de donde antes salen las dos esperas del borrador que usa el editor nuevo), el intérprete de
  listas de `packages/agent/src/agent.ts` (`turn`, `dryRun` y `background` quedan como entradas que traducen y llaman
  al motor nuevo), el catálogo y `checkFlow` de `apps/server/src/flows.ts`, `flowScheduler.ts`, las rutas y las
  acciones `flows.*`, la clave «Formato anterior» y las pruebas de todo ello. Se quedan: el lenguaje de planes con
  `validatePlan` y `checkPlan` (es lo que escribe el modelo, A-01), `rounds.ts`, los lectores, el código de las
  piezas, las tablas `flows` y `flow_drafts` como archivo, y `runs` y `run_steps` para los turnos. El mapa
  (`flowMap.ts`, `FlowMap.tsx`) se calcula solo de automatizaciones, y gana la flecha «avisa» (de la tarea 83). En el
  mismo PR se reescriben los principios que hablan de flujos (D-41, D-43, D-44, D-47 a D-53, D-55, D-61, A-16, A-19,
  I-24, I-27), cada uno con su prueba apuntando a la del motor nuevo, `docs/flujos.md` y `docs/sistema.md` dicen
  arriba que los sustituye este documento, y la guía de diseño pierde el editor de antes. La prueba:
  `e2e-boni/automations-before.spec.ts` (ningún «Formato anterior») y `apps/server/src/automations/convert.test.ts`
  (nada importa lo que se fue).
- **AU-229** (F16, pendiente) · El teléfono, el escritorio y el MCP no se quedan atrás. El teléfono ve, ejecuta,
  enciende y apaga las convertidas como cualquier otra (AU-74), ve el aviso de la conversión y sigue sin editar. Una
  app anterior al despliegue no se rompe: cuando el motor de antes se quita (AU-152), `GET /api/agent/flows` contesta
  una versión más con la lista vacía, y después se va. `Net.kt` y `paths.cjs` no cambian: dejan pasar `api/agent`
  entero; si un PR de la fase necesita una ruta fuera de ahí, entra en los dos a la vez. Cada cambio de
  `apps/boni-web` sale con su versión de escritorio (I-05). Para el MCP, AU-144. La prueba:
  `e2e-boni/automations-before.spec.ts`.

### 5.14 Dónde se cumple cada condición

| | Condición | Dónde |
|---|---|---|
| C1 | Como n8n | §3.1; el grafo y las filas (AU-01 a AU-19); el lienzo y la vista del paso (AU-62 a AU-74); probar, publicar y ejecuciones (§5.8) |
| C2 | Sin opciones de golpe | La cabecera de seis cosas (AU-62); las tres columnas (AU-70); las reglas AU-75 a AU-87 |
| C3 | JavaScript | Expresiones (AU-22 a AU-28) y «Código» (AU-30 a AU-39), con `$col` para consultar con filtros (AU-31) |
| C4 | IA conectada a colecciones | «Agente» (AU-50 a AU-59); «Lecturas»: las decide la IA o las hace el código (AU-51) |
| C5 | Límites en las conexiones | AU-40 a AU-48: No, Preguntar o Sí por acción; «Solo estas filas» y «Solo estos campos», también por acción |
| C6 | «Automatizaciones» | AU-60 |
| C7 | Páginas y toda la app | AU-130 a AU-139 y la tabla de elementos del §5.11. Los valores de un formulario van a una IA o ajustan una búsqueda que pinta una gráfica: AU-132, AU-134 y el criterio de la F17 |
| C8 | Control y usable | Las reglas con prueba (AU-75 a AU-87); el boceto; el lienzo se construye primero y Juan lo prueba antes de seguir (F14b) |
| C9 | La cola | §9 |
| C10 | Rehacer sin forzar | Formato y motor nuevos (§5.1, §5.2, §7); migración (§5.13) |
| C11 | Estudiar n8n | §3: lo que se toma, lo que se mejora y lo que no; lo que queda fuera va después, en una fase propia (decisión 9 del §10) |

### 5.15 Lo que Boni aprende de sus respuestas

Decisión 10 del §10: una automatización hace lo que es para y nunca se cambia a sí misma; lo que Boni aprende de
lo que Juan contesta lo junta Boni, fuera, y lo que cambie se propone a la vista. No es un sistema nuevo (T-05):

| Lo que ya hay | Lo que se extiende |
|---|---|
| Las decisiones por ámbito y sus cuentas (`docs/fiabilidad.md`; `earned` y `backOff` en `packages/agent/src/decisions.ts`) | Un ámbito más: la celda (automatización, paso, colección y acción), sea de una conexión o el «Permiso» de un «Colección» |
| «Solo» en un ámbito: se propone a las 20 decisiones con el 95 % y Boni lo apaga cuando falla | La sugerencia de AU-209 y la pausa de AU-210. El «Solo» de una automatización es la celda en «Sí», y esa solo la pone su mano (decisión 13) |
| Las sugerencias (`docs/preferencias.md`, clase 5), como mucho una al día, y el interruptor «Aprender» | Son las mismas (AU-212) |
| «Revisar la guía»: un revisor con un modelo | AU-211, que llega después, con la F16 (decisión 16) |

**Cómo se ve la seudoaceptación.** Boni no acepta por su cuenta la propuesta de una ejecución, tampoco con pruebas:
lo único que guarda sin preguntar es el «Sí» de una versión publicada, y ese lo pone su mano (decisión 13, AU-188).
Lo que AU-186 dejó abierto se cierra así. La seudoaceptación de `docs/fiabilidad.md` es, en una automatización, lo
que se ve: en la conexión, la cuenta bajo la celda; en la Bandeja, la misma cuenta en la tarjeta de la propuesta; y,
cuando las pruebas llegan, una sugerencia de abrir la celda (AU-208, AU-209).

- **AU-207** (F15, hecho) · Las señales las junta el código, sin ningún modelo, y solo de actos de su mano en un
  dispositivo personal. Por cada celda y cada ejecución hay una decisión, no una por fila: la propuesta aceptada
  (acierto) o rechazada (fallo); y, de lo que se guardó (aceptado, o con «Sí»), deshacer la ejecución, o que su mano
  cambie esos mismos campos o mande a la papelera una de sus filas en los 7 días siguientes (fallo: «corregida»). Lo
  guardado con «Sí» que nadie toca en 7 días es un acierto. Vale lo último: una propuesta aceptada y luego deshecha
  o corregida cuenta una vez, como fallo. «Su mano» es una operación del registro hecha a mano desde un dispositivo
  personal: no cuenta lo que cambia otra ejecución, un asistente ni una importación. Se guardan donde las decisiones de `docs/fiabilidad.md`,
  con la celda como ámbito y la huella del paso (AU-43): cambiar sus instrucciones, su código o sus conexiones
  empieza otra cuenta, porque lo aceptado era de otro paso. Aceptar, rechazar y deshacer cuentan en el momento; lo que
  cambió su mano se mira una vez al día en el registro de operaciones, por las operaciones de cada ejecución (AU-18),
  nunca en cada petición, y se mide con un año de ejecuciones (A-15). Se podan con sus ejecuciones. La prueba:
  `apps/server/src/automations/learning.test.ts`.
  Hecho en S3 (`automations/learning.ts`): `recordRun` deja una decisión por celda en «Sí» que guardó al terminar la
  ejecución; `learnAnswer` (rutas de aceptar y rechazar de la Bandeja, `agent.ts`) una por celda que preguntó, solo
  desde un dispositivo personal y una vez; `learnUndo` («Deshacer lo que hizo») las pasa a fallo; y `judgeCells`, una
  vez al día en el tick del planificador, mira el registro por los índices de las decisiones (`decisions_at`,
  migración 33), de cada ejecución y de sus filas, una consulta por ejecución (`handOpsOnRun`): su mano cambiando los mismos campos, mandando a la
  papelera, sacando de ella lo que la ejecución mandó o deshaciendo una de sus operaciones. El ámbito es la celda con
  la huella del paso sin los modos (`cellPrint`): pasar de «Preguntar» a «Sí» sigue la misma cuenta. Una ejecución
  cancelada mientras esperaba no llega a terminar y lo que guardó con «Sí» no cuenta.
- **AU-208** (F15, en parte) · La cuenta está a la vista y la pinta el código. Bajo la celda, en la tabla de
  conexiones (donde «lo usa», AU-179) y junto al «Permiso» de un «Colección»: «18 de 20 aceptadas» con «Preguntar»,
  «12 de 12 sin deshacer» con «Sí»; nada hasta que hay 5 decisiones. En la tarjeta de la propuesta de una ejecución,
  una línea por paso: «Has aceptado 18 de las últimas 20 de «Analista» en Notas». Es un número, no una ayuda. La
  prueba: `e2e-boni/automations-ai.spec.ts`.
  Hecho en P2 de la F15: `GET …/automations/:id/learning` (`automations.read`, parte `learning`) da cada celda
  publicada con su modo, sus decisiones, sus aciertos y si está en pausa (`learningOf`), y la tabla de conexiones lo
  pinta bajo la celda desde 5 decisiones: «18 de 20 aceptadas», «12 de 12 sin deshacer», y «Sí · en pausa» en
  pausa; nada si el borrador cambió el modo de la celda, porque la cuenta es de la publicada. Falta: la línea en la
  tarjeta de la propuesta y junto al «Permiso» de un «Colección» (P3).
- **AU-209** (F15, en parte) · Con 20 decisiones y el 95 % aceptadas en una celda con «Preguntar», Boni lo sugiere
  una vez, con la forma de una sugerencia de siempre: «Has aceptado 20 de 20 propuestas de «Analista» en Notas.
  ¿Quieres que guarde sin preguntar?» [Abrir] [No]. «Abrir» lleva a esa celda en el editor: ponerla en «Sí» es un
  toque suyo y publicar otro (decisión 13). Boni nunca pone un «Sí», ni en el borrador. Un «No» no se repite mientras
  el paso no cambie. No hay sugerencia para «Eliminar»: eso lo decide él sin que Boni lo empuje. Las celdas con su
  cuenta salen también en Ajustes › Decisiones, con las demás. Ese «No» y la pausa de AU-210 se guardan en el almacén
  del usuario, con las decisiones (D-02), con su registro y su Deshacer. La prueba:
  `apps/server/src/automations/learning.test.ts`.
  Hecho en S3: la sugerencia es un aviso de la ejecución que la ganó («suggested», `notices.ts`), con el día
  compartido con «Revisar la guía» (`maySuggest`, `learning/suggested`), y no toca la versión ni el borrador;
  `declineSuggestion` guarda el «No» y solo desde un dispositivo personal. Hecho en P2 de la F15: `GET /api/agent/requests` lista también lo que
  espera (`learning`: las sugerencias sin «No» de una celda que sigue en «Preguntar», y las pausas de una celda que
  sigue en «Sí» con la misma huella), con `mayDecide` por dispositivo; la Bandeja lo pinta como una tarjeta
  («Sugerencia», «Ordenar tareas: Analista en Tareas», «19 de 20 aceptadas») con [Abrir] y [No]; «No» va por
  `automations.learn` (`POST …/automations/:id/learning`, que nombra la celda y nunca su huella ni un «Sí»), y en un
  dispositivo compartido la tarjeta solo se lee («Solo desde un dispositivo personal»). «Abrir» abre la
  automatización, todavía no la celda. Falta: [Abrir] en la celda y las
  celdas en Ajustes › Decisiones (P3: hasta entonces `accuracy()` deja fuera esos ámbitos, que la app pintaría
  como texto crudo); y el «No» y la pausa se guardan en un ajuste del almacén (`automations/learning`), sin registro
  ni Deshacer (decidido de noche, para que Juan lo confirme; la otra, filas con su operación en el registro).
- **AU-210** (F15, en parte) · Cuando un «Sí» falla, Boni vuelve a preguntar. Con tres fallos seguidos, o uno de
  cada cinco en las últimas 20 decisiones (la regla de `docs/fiabilidad.md`), esa celda queda en pausa: las
  ejecuciones la tratan como «Preguntar». La versión publicada no cambia (decisión 10): la pausa se guarda aparte, el
  servidor la lee junto al «Sí» (AU-188) y solo puede bajar, nunca subir (como `lowerYes`). La celda dice «Sí · en
  pausa», y un aviso en la app lo cuenta una vez: «Boni vuelve a preguntar en «Analista» · Notas: deshiciste 3
  seguidas» [Quitar pausa]. Quitarla es un toque suyo en un dispositivo personal; publicar una versión con ese paso
  cambiado también la quita. La decisión 10 no nombra esta pausa: extiende a la celda lo que `docs/fiabilidad.md` ya
  hace cuando «Solo» falla, y que Boni baje un «Sí» que puso su mano lo decidió Juan el 2026-11-17 (decisión 16);
  la otra era quedarse en el aviso, sin pausa. La prueba: `apps/server/src/automations/learning.test.ts`.
  Hecho en S3: `backOff` de `@boni/agent` sobre las últimas 20 juzgadas de la celda (así, un fallo en las tres
  primeras ya es uno de cada cinco); la pausa se guarda aparte y `pausedDoc` la aplica al ejecutar y al seguir
  (`lowerCells`, que solo baja), por la huella del paso: publicar ese paso cambiado la deja atrás. `unpause` la quita
  solo desde un dispositivo personal y cuenta desde ahí. Hecho en P2 de la F15: «Sí · en pausa» en la celda
  (AU-208) y la tarjeta «En pausa» de la Bandeja, «3 seguidas deshechas, rechazadas o corregidas», con [Quitar
  pausa] por `automations.learn`, solo desde un dispositivo personal (`learning.test.ts`,
  `automations-ai.spec.ts`). Falta: el registro y el Deshacer de AU-209.
- **AU-211** (F16, pendiente) · Lo que necesita un modelo para aprender: un revisor que mira lo que Juan corrigió y
  propone
  un cambio en las «Instrucciones» de un «Agente», un ejemplo, o filas en una colección que el paso lee. Lo propone
  como un cambio del borrador que Juan ve con su antes y su después, acepta (con `lowerYes`) y publica: nunca cambia
  lo publicado. Es una de las automatizaciones de Boni, que se abren, se limitan y se apagan, como «Revisar la guía»,
  y llega con ellas (F16; decisión 16). La F15 le deja hecho lo que no necesita un modelo: las señales
  (AU-207) y dónde se ven (AU-208).
  En la F16: «Revisar la guía» se convierte con sus piezas y sus topes (AU-127) y sigue revisando la guía del correo
  igual. El revisor de un «Agente» es lo mismo sobre otra cosa, y es otra automatización de Boni, «Revisar los
  agentes», con sus propias piezas («Decisiones sobre un Agente» → «Revisora de instrucciones» → «Medir repitiendo» →
  «Sugerencia») y su interruptor: la inician las decisiones de su mano sobre lo que propuso un paso «Agente» (las
  señales de AU-207), cuando ese paso
  junta las que pide «Cada cuántas decisiones». Un lector en cuarentena (sin herramientas; lo que lee es dato,
  nunca una orden) recibe las «Instrucciones» de ese paso y los casos que Juan corrigió o rechazó, con lo que venía
  de fuera marcado, y propone un cambio. Antes de sugerirlo, Boni lo mide: repite en seco hasta 20 de esos casos con
  el cambio, sin escribir nada, y solo lo sugiere si acierta más que lo publicado. La sugerencia es un aviso en la
  app con «Ver el cambio»: un cambio del borrador con su antes y su después, que Juan acepta (con `lowerYes`) y
  publica él. Como mucho una al día, contando las de AU-212; apagada con «Aprender», o apagando la automatización.
  De lo que la decisión 10 dejó fuera de las automatizaciones, esto es lo único que entra en esta fase: el revisor
  que necesita un modelo. Lo demás no cambia de sitio: las señales, las cuentas, la sugerencia de abrir una celda y
  la pausa son de la F15 (AU-207 a AU-210, AU-212), código del servidor y no pasos, y ninguna de ellas pone ni quita
  un «Sí». La prueba: `apps/server/src/automations/boni.test.ts`.
- **AU-212** (F15, hecho) · Los límites de aprender. El interruptor «Aprender» lo para todo: ni sugerencias ni
  pausas nuevas (las señales se siguen guardando, que son de Juan). Como mucho una sugerencia al día que no nazca de
  un chat, contando las de `docs/preferencias.md`. Nada de fuera mueve una cuenta: solo cuentan actos de su mano en
  un dispositivo personal, y aceptar algo con texto de fuera cuenta el acto, no el texto (P9). Ningún modelo ve una
  cuenta ni la cambia, y ninguna cuenta entra en lo que recibe un «Agente» (AU-197). Aprender nunca cambia una
  versión publicada ni pone un «Sí». La prueba: `apps/server/src/automations/learning.test.ts`.
  Hecho en S3: con «Aprender» apagado se guardan las decisiones y no hay sugerencia ni pausa nueva; una sugerencia
  al día entre todos los que aprenden; aceptar y rechazar cuentan desde las rutas de la Bandeja con su
  dispositivo, y deshacer desde `undoAutomationRun`, que pide un dispositivo personal (también por la acción
  `automations.undo_run`, que la política confirma con él, P21); y nada de S3 llama a un modelo ni pasa una cuenta
  a un paso.

### 5.16 Modelos sin usos

**Decidido (Juan, 2026-11-18, tarea 154). Nada construido.** A las tres dudas del diseño Juan contestó con la
recomendada de cada una (decisiones 22 a 24 del §10) y pidió un cambio: una evaluación por modelo, no una por clase
de llamada (decisión 25, AU-234).

Juan, 2026-11-18: «en general no sé si seguirás con el mismo formato de modelos que teníamos hasta ahora: lector,
agente, etc. ¿Crees que con este workflow tiene sentido? A lo mejor habría que quitar ese tipo de roles y
simplemente en el chat de conversación puedo elegir entre modelos precargados (o agregar nuevo) y en automatizaciones
elegimos qué modelo o modelos usar en un paso de agente. Podría a lo mejor en la sección de modelos ver todos los que
se han cargado sin estar clasificando con lo de agente, lector, etc. Como mucho se me ocurre ponerle etiquetas a los
modelos para que pueda asignarle roles en las automatizaciones, tipo "este paso lo puede ejecutar cualquier modelo
de esta categoría"».

**La respuesta: no tiene sentido seguir con los usos, y se quitan.** Los cuatro usos de hoy («Agente», «Lector»,
«Decisor», «Revisor») nacieron cuando Boni hacía cuatro cosas fijas con un modelo cada una. Con el lienzo, quien
dice qué modelo hace qué es cada paso, y el chat ya elige el suyo. «Modelos» pasa a ser una lista de modelos
cargados; el chat elige uno; un paso de IA elige uno, o una etiqueta que Juan puso a varios.

Dos cosas de los usos se quedan, porque no eran de la pantalla:

- **La clase de llamada.** Un «Agente» llama al modelo por rondas, con herramientas dentro de sus conexiones; un
  lector («Extraer datos», «Clasificar», «Resumir», «Escribir texto», las piezas que leen) le da un texto sin
  herramientas y le pide una forma cerrada; la pieza «Decisora» le hace elegir entre opciones que pone el código.
  Son tres clases: «Agente», «Lectura» y «Decisión». La clase la fija el tipo del paso (AU-50, AU-57, AU-127), no
  el modelo, ni una etiqueta, ni Juan: leer lo de fuera sin herramientas es cómo llama el paso, y sigue igual lo
  conteste el modelo que lo conteste (`docs/nucleo.md` §7.4).
- **La evaluación antes de usar.** Cada modelo responde distinto, así que antes de usarse pasa su evaluación (Juan,
  2026-10-24). Deja de ser «la evaluación del uso» y pasa a ser una marca del modelo: una sola, que prueba de una
  vez todo lo que ese modelo puede contestar (AU-234; Juan, 2026-11-18, decisión 25). La puerta sigue también en
  el chat (decisión 24).

**Lo que hay hoy y lo que se extiende (T-05).**

| Hoy | Después |
|---|---|
| Cuatro usos, cada uno con su modelo elegido (`models/config` en los ajustes del almacén: `roles`) | Una lista de modelos cargados, con su orden; tres filas «De la cuenta» (AU-232, AU-236) |
| Un modelo es conexión + modelo + ruta, y su id es `conexión:modelo[:zdr]` (`choiceId` de `models.ts`) | Igual: el mismo id. Lo que una conversación o un paso guardaron sigue valiendo sin tocarlo (AU-244) |
| No hay lista de modelos cargados: «los evaluados hace poco para ese uso» hacen de lista (`modelChoices`) | La lista existe y es suya: «Añadir modelo», «Quitar» (AU-233) |
| La evaluación es de un uso: tres juegos de casos (`evalPlanner`, `evalReader`, `evalDecider`), cada uno lanzado aparte; se guardan las últimas 20 de la cuenta (`models/evals`) | Una evaluación por modelo, con todos los casos que ese modelo puede contestar, y un resultado; se guarda la última (AU-234) |
| Una pulsación de «Evaluar» evalúa también el modelo actual de ese uso, para comparar, si no tiene evaluación reciente | Una pulsación, un modelo, una ejecución (AU-234) |
| La puerta pide una evaluación reciente del uso y no mira su resultado (`evaluated`) | La puerta pide la evaluación vigente del modelo y no mira su resultado (AU-235) |
| «Revisor» se evalúa con los casos de «Lector» (`evalRole`: son los mismos) | «Revisor» desaparece: sus resultados cuentan como la parte de lectura de la evaluación (AU-244) |
| El chat lista `GET /api/agent/planners`: el del uso «Agente» y los evaluados para él | Lo mismo con otro nombre: «El de la cuenta» y los modelos evaluados que contestan como «Agente» (AU-242) |
| El «Modelo» de un paso guarda un id o nada («El de la cuenta»); en el editor, el «Agente» ya lo elige en una lista (P1 de la F15: «El de la cuenta · el modelo» y los evaluados) y los lectores aún no (P2) | La misma lista con las etiquetas en medio, en todos los pasos de IA; guarda nada, un id o una etiqueta (AU-238) |
| `stepProvider(cuenta, uso, id)` da el proveedor o dice `no-model` / `no-key` | La misma puerta, con la etiqueta resuelta delante (AU-239) |
| Las claves, selladas en «Claves»; el presupuesto del mes; la píldora de privacidad de cada ruta | No cambian |
| Los modelos que trae el servidor valen sin evaluación para su uso | Igual: «Del servidor», para su clase de llamada (AU-235) |

**Qué pasa con cada uso de hoy** (el cambio entero, en AU-244).

| Uso de hoy | Su modelo elegido pasa a | Sus resultados guardados pasan a | Lo que lo usaba |
|---|---|---|---|
| «Agente» (`planner`) | La fila «De la cuenta · Agente» | La parte «Agente» de la evaluación de ese modelo | El chat y cada «Agente» sin modelo elegido: siguen con él, por «El de la cuenta» |
| «Lector» (`reader`) | La fila «De la cuenta · Lectura» | La parte «Lectura» de la evaluación de ese modelo | Los lectores sin modelo elegido y los de un turno: siguen con él |
| «Decisor» (`decider`) | La fila «De la cuenta · Decisión» | La evaluación del modelo de decisión, entera | La pieza «Decisora»: sigue con él. Un `classify` de un flujo suyo, convertido, pasa a leerlo «Lectura» (AU-245) |
| «Revisor» (`reviewer`) | Ninguna fila. Si era otro modelo que el «Lector», la conversión lo deja escrito en la pieza «Revisora» (AU-245) | La parte «Lectura» (son sus mismos casos; de dos resultados, el más nuevo) | Lo que revisa lee con «Lectura» |

**Lo que se miró fuera (ideas, nada copiado).** n8n no tiene usos ni modelo de la cuenta: cada agente lleva colgado
su modelo con su credencial, y para elegir entre varios hay un nodo aparte con reglas en orden (gana la primera).
Dify tiene lista de modelos y un modelo por defecto por cada clase de trabajo, que vale donde el nodo no elige. Los
enrutadores (LiteLLM) agrupan modelos bajo un nombre o una etiqueta y prueban el siguiente cuando uno falla. Los
editores de código (Continue, Zed) tienen una lista plana y cada función cae al modelo por defecto. De ahí sale la
forma: lista plana, un valor por defecto por clase de llamada y la elección en el paso. Y cuatro tropiezos que las
reglas de abajo cierran: el salto callado a un modelo más caro cuando uno falla (decisión 23), la referencia a un
modelo que ya no está (AU-233, AU-241), no saber cuál contesta cuando un grupo tiene dos (AU-239) y un «automático»
que cambia de modelo sin que nadie lo toque (AU-239).

**Las palabras.**

| Palabra | Qué es |
|---|---|
| Modelo | Un modelo cargado en «Modelos»: su nombre, por una conexión y una ruta |
| Etiqueta | Un nombre que Juan pone a uno o varios modelos, para que un paso diga «cualquiera de estos» |
| Evaluación | La prueba de un modelo, una por modelo: corre de una vez todo lo que ese modelo puede contestar y da un resultado («22 de 24») |
| De la cuenta | El modelo, o la etiqueta, que vale donde un paso o una conversación no eligen: una fila por clase de llamada |
| El de la cuenta | La opción de un paso o de una conversación que no elige: la fila «De la cuenta» de su clase |
| Del servidor | Un modelo que trae el servidor configurado, sin clave de Juan |
| Sin evaluar · Caducada · Parcial | Un modelo sin evaluación · Una evaluación de más de 30 días · Una a la que le falta una parte (solo las que vienen de los usos de hoy, AU-244) |
| Sin modelo | Una etiqueta o una fila «De la cuenta» sin ningún modelo que valga |

**Un ejemplo.** Juan tiene cargados «m-ejemplo-grande» y «m-ejemplo-rápido» (los nombres son inventados: ni el
código ni este diseño nombran modelos). «De la cuenta» dice «Agente: m-ejemplo-grande» y «Lectura: m-ejemplo-rápido».
Su automatización «Ordenar gastos» tiene un «Clasificar» con «El de la cuenta» y un «Agente» con «m-ejemplo-grande».
Carga «m-ejemplo-nuevo», lo evalúa, le pone la etiqueta «Barato» y se la pone también a
«m-ejemplo-rápido». En el «Clasificar» elige «Barato»: la línea dice «Barato · m-ejemplo-rápido», porque es el
primero de los dos en su lista. Si un día sube «m-ejemplo-nuevo» por encima, ese «Clasificar» y cualquier otro paso
con «Barato» pasan a usarlo, sin abrir ninguna automatización; «Lo que hizo» de cada ejecución dice qué modelo
contestó.

**La pantalla.** Ajustes → Modelos, en el mismo sitio, con las dos formas que la página ya tiene: una lista, y lo
que se abre en su lugar al pulsar una fila (por eso no lleva boceto en `docs/maquetas/`):

```
Modelos                                                                     [ Añadir modelo ]

De la cuenta
  Agente    m-ejemplo-grande                                                          Cambiar
  Lectura   Barato · m-ejemplo-rápido                                                 Cambiar

  m-ejemplo-grande   OpenRouter   No guarda tus datos                22 de 24   4,10 €
  m-ejemplo-rápido   OpenRouter   No guarda tus datos       Barato   17 de 24   0,62 €
  m-ejemplo-nuevo    OpenRouter   Puede guardar tus datos   Barato   19 de 24   —

Gasto de noviembre · Presupuesto · Claves                                           (como hoy)
```

Al pulsar un modelo, en lugar de la lista: su nombre, su conexión y su ruta con la píldora de privacidad;
«Etiquetas»; «Evaluación» (el resultado, su fecha y lo que costó, o «Sin evaluar»; «Ver los casos», que los lista
en sus grupos con la cuenta de cada uno: «Agente · 14 de 15», «Lectura · 8 de 9»; y «Evaluar»); «Se usa en» (las
filas «De la cuenta», cuántas automatizaciones y cuántas conversaciones); su gasto del mes; y «Quitar». Nada de esto
explica nada dentro de la app: son nombres y valores.

- **AU-232** (FM, en parte) · «Modelos» es una lista de modelos cargados, sin usos. Cada fila: el nombre, la
  conexión, la píldora de privacidad de su ruta (la de hoy), sus etiquetas, el resultado de su evaluación y el
  gasto del mes. El mismo modelo por dos conexiones o dos rutas son dos filas. El orden es de Juan (arrastrar, o
  «Subir» y «Bajar» en el menú de la fila) y solo sirve para una cosa: decir cuál gana en una etiqueta (AU-239). Un
  modelo nuevo entra al final. Los que trae el servidor salen como «Del servidor» y no se quitan. Como mucho 30
  modelos. Encima de la lista, «De la cuenta» (AU-236); debajo, el gasto, el presupuesto y «Claves», como hoy. Toda
  escritura de «Modelos» pide un dispositivo personal, como hoy (D-05), y ninguna es una acción ni una herramienta
  (AU-243). La lista se pide una vez al abrir la página, con el gasto ya sumado por modelo: con 30 modelos y un año
  del diario de llamadas responde en su tiempo (A-15). Las pruebas: `apps/server/src/models.test.ts` («AU-232 · the
  list gives every loaded model once, in the person's order, with its tags, its evaluation and the month's cost»)
  y `e2e-boni/models.spec.ts` («AU-232 · «Modelos» is one list and no use is named in it», también a ancho de
  teléfono).
  Falta (M2): la pantalla, su prueba de `e2e-boni/models.spec.ts` y el arrastre; el servidor da la lista entera en una petición (`GET /api/agent/models/list`).
- **AU-233** (FM, en parte) · Añadir y quitar. «Añadir modelo» abre el buscador de hoy (la conexión y su catálogo,
  con la ruta sin retención cuando la hay); pide la clave de esa conexión en «Claves» si falta, con el aviso de hoy.
  El modelo entra «Sin evaluar» y no se puede elegir en ningún sitio hasta tener su evaluación (AU-235). «Quitar»
  pregunta antes cuando el modelo se usa, y dice dónde: «Se usa en 2 automatizaciones y en «De la cuenta ·
  Lectura»». Quitado, su evaluación y su gasto en el diario se quedan (volver a cargarlo la recupera si sigue
  vigente); una conversación que lo tenía vuelve a «El de la cuenta» (ya pasa hoy: `plannerFor` no lo encuentra);
  un paso publicado que lo nombraba falla diciéndolo y sigue su «Si falla» (AU-199); un borrador que lo nombraba
  tiene un problema en ese paso. Una fila «De la cuenta» que lo tenía vuelve al del servidor, o queda «Sin modelo»
  si el servidor no trae ninguno, y la pregunta lo dice. Quitar una clave en «Claves» pregunta lo mismo por los
  modelos de su conexión. Las pruebas: `apps/server/src/models.test.ts` («AU-233 · removing a model in use says
  where it is used, keeps its evaluation and leaves every reference answering «no-model»») y
  `e2e-boni/models.spec.ts` («AU-233 · a model added is «Sin evaluar» and is offered nowhere»).
  Falta (M2): el buscador y la pregunta en pantalla; el servidor ya pregunta antes (`409` con dónde se usa) y quitar una clave lo dice con `dry`.
- **AU-234** (FM, en parte) · Una evaluación por modelo (Juan, 2026-11-18, decisión 25). «Evaluar» en un modelo
  corre, de una vez, todos los casos que ese modelo puede contestar y da un resultado: «22 de 24». No se elige qué
  evaluar. Los casos son los inventados de hoy y no se escribe ninguno nuevo: para un modelo que contesta como
  «Agente» y como «Lectura» (todos menos los de decisión), los 15 de `evalPlanner` y los 9 de `evalReader`; para un
  modelo de decisión, que habla otro protocolo y solo contesta esa llamada, los 19 que puntúan de `evalDecider`.
  Qué casos le tocan lo dice el código por lo que el modelo es (una función de `models.ts`; hoy lo dicen el uso y
  la lista fija de modelos de decisión de `Models.tsx`), nunca Juan ni una etiqueta. Una función (`evalModel`, en
  `packages/agent/eval/lib`, sobre las tres de hoy) corre las partes y devuelve un resultado con ellas dentro. El
  resultado es una cuenta de casos, no una nota ni un aprobado: quien decide si el modelo le vale es Juan, como
  hoy, y ningún resultado apaga un modelo (decisión 25). En la lista se ve solo el resultado; al abrir el modelo,
  su fecha, lo que costó y «Ver los casos», que los lista en sus grupos con la cuenta de cada uno («Agente · 14 de
  15», «Lectura · 8 de 9») y la línea de cada fallo como hoy (I-40, que no cambia). El desglose se mira y no se
  lanza: no hay evaluación de una parte. Se lanza a mano, una cada vez por cuenta, y suma al gasto del mes, como
  hoy; nunca en CI. Una pulsación evalúa ese modelo y ninguno más (hoy evalúa también el modelo actual del uso,
  para comparar: sin usos no hay con cuál, y la lista ya enseña los resultados uno junto a otro). Se guarda la
  última de cada modelo (hoy, las últimas 20 de la cuenta); una que no termina no guarda nada y deja la anterior.
  Vale 30 días (`EVAL_DAYS`); pasada, dice «Caducada» junto a su resultado. Lo que cuesta, comparado con hoy, está
  debajo de estas reglas. Las pruebas: `apps/server/src/models.test.ts` («AU-234 · one evaluation of a model runs
  every case it can answer once and keeps one result with its parts, and one older than its days is marked
  expired», con el reloj de `@boni/pace` y un modelo de guion, sin modelo real).
  Falta (M2): «Ver los casos» en pantalla; el servidor guarda los casos de cada parte (`GET /api/agent/models/evaluation`).
- **AU-235** (FM, hecho) · «Evaluado» es tener esa evaluación, vigente: la puerta ya no nombra un uso. Un
  modelo se puede elegir (en el chat, en un «Agente», en un lector, en una fila «De la cuenta») solo con su clave
  puesta y su evaluación vigente, y para las clases de llamada cuyos casos están en ella. Uno evaluado vale a la
  vez para «Agente» y para «Lectura», sin evaluar nada más; uno de decisión, solo para «De la cuenta · Decisión».
  Es la puerta de hoy (`evaluated`, `needs-evaluation`) preguntando por el modelo donde preguntaba por el uso: mira
  que la evaluación exista y esté vigente, nunca su resultado. Uno del servidor vale sin evaluación para la clase
  en que el servidor lo trae, como hoy. Lo ya elegido sigue valiendo aunque su evaluación caduque: una versión
  publicada, una conversación y una fila «De la cuenta» siguen con su modelo (AU-199), y «Caducada» lo dice en
  «Modelos». Ni la evaluación ni la clase de llamada son un permiso o una guarda: qué puede hacer la llamada lo
  dicen las conexiones del paso y la política (AU-204, AU-205), igual con un modelo de «24 de 24» que con uno de «3
  de 24». Las pruebas: `apps/server/src/models.test.ts` («AU-235 · a model is offered only with its key and a
  current evaluation, for the kinds of call its evaluation has cases of, whatever its result») y
  `apps/server/src/automations/ai.test.ts` («AU-235 · a published step keeps its model when its evaluation
  expires»).
- **AU-236** (FM, en parte) · «De la cuenta» son tres filas, una por clase de llamada: «Agente», «Lectura» y
  «Decisión». Cada una es un modelo o una etiqueta, se cambia con «Cambiar» entre los que valen para su clase
  (AU-235) y es lo que usan un paso o una conversación con «El de la cuenta», resuelta en cada ejecución (AU-239).
  Un paso con «El de la cuenta» se publica siempre que su fila tenga modelo, como hoy.
  «Decisión» solo sale cuando hay cargado un modelo de decisión con su evaluación o el servidor trae uno; sin
  ella, o si falla, decide la lectura, como hoy. La usa la pieza «Decisora» (AU-127). No hay fila «Revisor»: las
  piezas que revisan leen con «Lectura». Cambiar una fila cambia desde la siguiente ejecución lo que hacen todas
  las automatizaciones y conversaciones que no eligieron, y «Cambiar» lo dice con su cuenta («La usan 6
  automatizaciones») antes de guardar. Que estas filas existan lo decidió Juan (decisión 22). Las pruebas:
  `apps/server/src/models.test.ts` («AU-236 · a step and a conversation that chose nothing use the account's row
  of their kind, read at each run»).
  Falta (M2): «Cambiar» con su cuenta en pantalla; el servidor da cuántas automatizaciones usan cada fila.
- **AU-237** (FM, en parte) · Una etiqueta es un nombre de Juan sobre modelos. La pone y la quita él en «Modelos»,
  en el modelo («Etiquetas» → escribir un nombre nuevo o elegir uno que ya existe); un modelo lleva las que él
  quiera y una etiqueta, los modelos que él quiera. Tiene un identificador por debajo: cambiarle el nombre no rompe
  los pasos que la usan. Hasta 20 etiquetas, de 24 caracteres como mucho, con nombres distintos entre sí. Boni no
  trae ninguna, el código no nombra ninguna y la migración no crea ninguna (D-14): «Barato» significa lo que él
  decida. Una etiqueta sin modelos desaparece sola si nadie la usa; si un paso o una fila «De la cuenta» la usan,
  se queda y dice «Sin modelo» (AU-241). Las pruebas: `apps/server/src/models.test.ts` («AU-237 · a tag renamed
  keeps every step that names it, and no tag exists that the person did not write»).
  Falta (M2): poner y quitar etiquetas en pantalla.
- **AU-238** (FM, en parte) · El «Modelo» de un paso de IA es un desplegable cerrado con tres partes: «El de la
  cuenta» (por defecto; no guarda nada), las etiquetas y los modelos que valen para la clase del paso. Cada
  etiqueta, y «El de la cuenta», dicen al lado el modelo que contestaría hoy: «Barato · m-ejemplo-rápido». Una
  etiqueta vale cuando ese modelo, el que contestaría (AU-239), vale (AU-235): elegirla no da más que elegirlo a
  él. Si no, sale apagada con su motivo: «Sin modelo» o «Caducada». El paso guarda nada, el id de un modelo o
  `tag:` con el identificador de una etiqueta: nunca una clave, una ruta ni un ajuste (AU-50). Un paso elige un
  modelo o una etiqueta, no una lista: «varios modelos» es una etiqueta. Es la lista que el «Agente» tiene desde P1
  de la F15 (AU-199), con las etiquetas añadidas, y la misma para los cuatro lectores y las piezas de Boni que
  enseñan «Modelo»; uno que ya no está se sigue diciendo en la propia lista, como hoy. La lista la da una
  ruta por clase de llamada (`GET /api/agent/models/choices?kind=…`, en `routes.ts`, solo en la red privada, A-03);
  `GET /api/agent/planners` se queda como su caso «Agente» mientras haya una versión de escritorio que la pida. Las
  pruebas: `e2e-boni/automations-ai.spec.ts` («AU-238 · «Modelo» offers «El de la cuenta», the tags and the models
  of the step's kind, each tag with the model that would answer», junto a las de AU-199 de ese archivo) y
  `packages/automations/src/catalogue.test.ts` («AU-238 · «Modelo» takes nothing, a model's id or a tag, and
  nothing else»).
  Falta (M2): el desplegable y su prueba de `e2e-boni/automations-ai.spec.ts`; el catálogo, `aiProblems` y la ruta de opciones ya lo saben.
- **AU-239** (FM, hecho) · Qué modelo contesta lo dice una sola función (`resolveModel(cuenta, clase, valor)`
  en `models.ts`, delante de `stepProvider`), para el chat, los pasos, las piezas y «De la cuenta». Con un modelo:
  ese. Con nada: la fila «De la cuenta» de la clase. Con una etiqueta: el primero, en el orden de la lista de
  «Modelos», de sus modelos con clave y con una evaluación que tenga los casos de esa clase, vigente o caducada
  (nunca uno sin evaluar; una etiqueta no da más de lo que daría elegir ese modelo directamente). Con dos modelos
  en una etiqueta gana el de arriba, siempre: el calendario no cambia cuál contesta, solo lo cambian actos de Juan
  (ordenar, etiquetar, cargar, quitar, una clave). Se resuelve una vez al empezar el paso y todas sus filas, sus
  rondas y sus reintentos van con ese modelo. Si la llamada falla, el paso falla y sigue su «Si falla»: no se
  prueba el
  siguiente de la etiqueta (decisión 23). El diario y «Lo que hizo» dicen el modelo que contestó y, si llegó por
  una etiqueta, cuál («m-ejemplo-rápido · Barato»); el diario sigue guardando la clase de llamada donde hoy guarda
  el uso (`model_calls.role`, sin migrar). Las pruebas: `apps/server/src/models.test.ts` («AU-239 · a tag with two
  models answers with the first in the list's order, an expired evaluation changes nothing and a model never
  evaluated is never taken») y `apps/server/src/automations/ai.test.ts` («AU-239 · a step resolves its model once
  and a failed call does not try the tag's next model»).
- **AU-240** (FM, hecho) · Una etiqueta o un sitio en la lista no dan ni quitan un permiso, y no son una
  guarda. La política juzga cada llamada por el modelo que la hace de verdad (su ruta, su clase de privacidad, «Lo
  que ve la IA», P29) y por las conexiones del paso, igual que si Juan hubiera elegido ese modelo a mano; la
  etiqueta no entra en lo que `decide` recibe. Resolver no consulta la política: si la política niega la llamada
  al modelo que salió, la llamada se niega y no se busca otro modelo de la etiqueta que sí pasaría. Lo privado
  sigue sin conectarse a una IA sea cual sea el modelo (AU-45), y lo que recibe el modelo de un «Agente» sigue
  siendo la lista cerrada de AU-197, que no cambia con el modelo ni con la etiqueta. Las pruebas:
  `apps/server/src/automations/ai.test.ts` («AU-240 · the same call gets the same decision whether its model came
  from a tag, from the account or by its id, and a denial tries no other model»).
- **AU-241** (FM, en parte) · Sin modelo. Una etiqueta o una fila «De la cuenta» sin ningún modelo con clave y
  evaluado que conteste esa clase de llamada (AU-235) dice «Sin modelo»: en el desplegable del paso sale apagada;
  al publicar, el paso tiene el problema de hoy («Elige otro modelo en «Clasificar»», AU-199) y no se publica,
  igual que con una etiqueta cuyo modelo tiene la evaluación caducada (AU-238); en una versión ya publicada, el
  paso falla con `no-model` o `no-key` y sigue su «Si falla», y en una conversación el turno lo dice con el aviso
  de hoy. Para que eso no
  llegue sin que él lo vea, lo que dejaría «Sin modelo» algo que se usa pregunta antes y dice dónde: quitar la
  etiqueta al último modelo que vale, quitar ese modelo o quitar su clave («Barato se queda sin modelo. La usan 3
  automatizaciones»). Las pruebas: `apps/server/src/models.test.ts` («AU-241 · what would leave a tag in use
  without a model says where it is used before it is done») y `apps/server/src/automations/ai.test.ts` («AU-241 ·
  a tag without a usable model is a problem of its step at publish and «no-model» in a published run»).
  Falta (M2): los textos de la pregunta y el apagado en pantalla; el servidor ya pregunta y el paso falla con `no-model`.
- **AU-242** (FM, en parte) · El chat elige un modelo cargado. El chip de la barra lista «El de la cuenta» y los
  modelos que valen para «Agente» (AU-235), y termina en «Añadir modelo», que abre Ajustes → Modelos (solo desde
  un dispositivo personal; en los demás no sale). Sin etiquetas: en el chat se elige un modelo. Una conversación
  nueva nace con «El de la cuenta» y guarda el id del modelo solo si él lo cambia (`conversations.model`, como
  hoy). Los lectores de un turno usan «De la cuenta · Lectura». El chat de una página es una automatización
  (decisión 19) y su modelo es el «Modelo» de su «Agente» (AU-238). Las pruebas:
  `apps/server/src/models.test.ts` («AU-242 · a conversation is offered the account's and the evaluated models
  that answer as an agent, and one whose model is gone answers with the account's») y `e2e-boni/models.spec.ts`
  («AU-242 · the chat's chip ends in «Añadir modelo» only on a personal device»).
  Falta (M2): el chip con «Añadir modelo» y su prueba; `GET /api/agent/planners` ya es el caso «Agente» de la puerta.
- **AU-243** (FM, en parte) · Un modelo no elige modelo. Qué modelo recibe un texto es decir adónde va ese texto y
  cuánto cuesta, así que lo pone la mano de Juan, como un «Sí» (AU-187). En un borrador que proponen el asistente,
  el MCP o «Pedir a Boni» (AU-140, AU-141, AU-144), un paso nuevo, o uno cuyo «Modelo» no es el que Juan le había
  puesto, llega con «El de la cuenta»; los pasos que la propuesta no toca conservan el suyo. Ninguna acción ni
  herramienta carga o quita un modelo, pone una etiqueta, cambia el orden ni cambia «De la cuenta», y «Modelos» no
  es una colección que una conexión pueda abrir. Las pruebas: `apps/server/src/automations/ai.test.ts` («AU-243 ·
  a proposed draft carries no model its author chose, and no action writes models, tags, order or the account's
  rows»).
  Falta: que las propuestas de AU-140, AU-141 y AU-144, cuando lleguen, pasen su documento por `keepOwnModels` (`packages/automations/src/ai.ts`), que ya está; ninguna ruta de «Modelos» es una acción (`JUAN_ONLY`).
- **AU-244** (FM, hecho) · El cambio no pierde nada. Al abrir el almacén, una vez, por código y sin modelo, la
  cuenta pasa a la forma nueva; repetirlo no cambia nada. La lista de modelos: el de cada uso de hoy, cada modelo
  que hoy sale en `modelChoices` (evaluado hace poco, con clave) y cada modelo que una conversación o un paso
  guardado nombran; primero los de «De la cuenta», después los demás por su última evaluación. «De la cuenta»:
  «Agente» ← el uso «Agente», «Lectura» ← «Lector», «Decisión» ← «Decisor»; lo que hoy es «El del servidor» sigue
  siéndolo. Los resultados guardados por uso pasan a ser la evaluación de su modelo, con su fecha y sus casos y
  sin correr nada: el más nuevo de «Agente» es su parte «Agente»; el más nuevo de «Lector» o de «Revisor» (son los
  mismos casos), su parte «Lectura»; el de «Decisor», la evaluación entera del modelo de decisión. Con las dos
  partes el resultado es su suma («14 de 15» y «9 de 9» dan «23 de 24»). Con una sola, el modelo dice «Parcial»
  junto a lo que tiene («9 de 9 · Parcial») y se ofrece donde se ofrecía, no en más sitios: la puerta lee cada
  parte con su fecha (AU-235), así que tras el cambio cada modelo sale en las mismas listas que antes y los mismos
  días, y ninguno pierde su marca ni gana una que no pasó. «Caducada» sale cuando una de sus partes pasó sus 30
  días. El siguiente «Evaluar» de ese modelo lo corre entero, con una sola fecha, y quita «Parcial». `models/evals`
  se queda como estaba, igual que `roles`. Ninguna etiqueta. El presupuesto, el cambio a euros, el aviso y el
  diario, sin tocar; las claves no se leen ni se mueven.
  Los ids que guardan las conversaciones y los pasos no se reescriben: son los mismos. El campo `roles` de hoy se
  queda como estaba, para la vuelta atrás y para el motor de antes mientras siga dentro (decisión 21); las rutas
  por uso de hoy (`…/models/roles/:uso`) siguen contestando a la versión de escritorio anterior hasta la entrega
  que trae la pantalla nueva. Si su «Revisor» de hoy es otro modelo que su «Lector», el motor de antes lo sigue
  usando hasta la conversión, y la conversión lo deja escrito en el paso (AU-245). Las pruebas:
  `apps/server/src/models.test.ts` («AU-244 · with settings shaped like a person's, every use, conversation and
  step answers with the same connection and model before and after, every model is offered where it was and
  nowhere else, twice run changes nothing, and the keys are not read»).
- **AU-245** (FM, en parte) · Lo que lleva de modelo un paso convertido (F16, AU-150, AU-223). Los flujos de hoy
  no guardan modelo en sus pasos: lo ponía el uso. La conversión no escribe «Modelo» en ningún paso («El de la
  cuenta»), con una excepción: la pieza «Revisora», cuando el «Revisor» de la cuenta es otro modelo que su
  «Lector», lleva el id de ese modelo, para que revise el mismo de siempre y se vea en su paso. Lo dice una
  función de `models.ts` (`modelRefOf(cuenta, uso)`: nada para «Agente», «Lector» y «Decisor»; nada o un id para
  «Revisor»), que la conversión llama en el servidor; el traductor puro (`planToAutomation`) no escribe modelos.
  Las versiones «De: Boni» de las automatizaciones de Boni no llevan modelo nunca (son las mismas para toda
  cuenta). La pieza «Decisora» sigue llamando a «De la cuenta · Decisión». Un `classify` de un flujo suyo se
  convierte en «Clasificar» (AU-223), que es una lectura: si la cuenta tiene un modelo de decisión, hoy ese
  `classify` lo contesta él y convertido lo contesta la lectura; es una línea de «Lo que cambia» (AU-224) que la
  conversión tiene que decir. Las pruebas: `apps/server/src/models.test.ts` («AU-245 · the model a converted step
  carries: none for the agent, the reader and the decider, and the reviewer's own only when it differs from the
  reader's»).
  Falta (S1 de la F16): que la conversión llame a `modelRefOf`; el mapa ya nombra el modelo de cada uso (`answers`).

**Lo que cuesta una evaluación, comparado con hoy.** Una evaluación gasta su dinero, así que va dicho en casos y
llamadas. En dólares y en minutos no hay cifra que dar: el repositorio no guarda lo que costó ninguna, y este diseño
no corrió ninguna con un modelo real.

| | Hoy | Después |
|---|---|---|
| Los cuatro usos, con un modelo para agente, lector y revisor y el de decisión | Cuatro evaluaciones: 15 turnos de agente, 9 lecturas, las mismas 9 otra vez y 19 decisiones | Dos: 15 turnos y 9 lecturas; 19 decisiones |
| Un modelo que solo iba a leer | Una: 9 lecturas | Una: 15 turnos y 9 lecturas |
| El modelo de decisión | Una: 19 decisiones | Igual |
| Una pulsación de «Evaluar» | El modelo y, si el actual del uso no tiene evaluación reciente, también ese | Ese modelo y ninguno más |

Casi todo el gasto está en los 15 casos de agente: cada uno es un turno entero, con varias llamadas, y cada lectura
y cada decisión es una sola. Una evaluación de después cuesta más o menos lo que hoy cuestan juntas la de «Agente» y
la de «Lector» de ese modelo. Para un modelo que hace de todo es menos que hoy (una en lugar de tres, sin repetir
las lecturas). Para un modelo que solo iba a leer es más que hoy: corre también los casos de agente, que hoy no
corría. Es el precio de que el resultado diga cómo se desempeña el modelo entero, y solo se repite, pasados los 30
días, para elegir ese modelo en un sitio nuevo (lo ya elegido sigue, AU-235). Antes de la primera evaluación de un
modelo no hay cifra, como hoy; después, lo que costó la última queda junto a su resultado.

**Qué cambia en lo ya construido.**

- De la F15 (pantallas): el «Modelo» del «Agente» ya es una lista desde su P1 (`AutomationStepView.tsx`, con
  `GET …/agent/planners`: «El de la cuenta · el modelo», los evaluados, y «… · no disponible»). Se le
  añaden las etiquetas y pasa a pedir la ruta de opciones de su clase; sus pruebas de AU-199 en
  `e2e-boni/automations-ai.spec.ts` se quedan. La lista de los cuatro lectores, que la F15 deja para su P2, es
  esta misma: si P2 llega antes que M2 la hace con las opciones de «Lectura» y M2 le añade las etiquetas.
  `aiProblems` (`publish.ts`) comprueba por `resolveModel`. La línea de «Lo que hizo» añade la etiqueta cuando la
  hubo. Nada más de la F15 cambia: conexiones, «Preguntar», Bandeja, topes y aprender no nombran modelos.
- Ajustes → Modelos: `Models.tsx` y `ModelsSettings.tsx` se rehacen (las tarjetas de uso se van; el buscador de
  modelos, el gasto, el presupuesto y «Claves» se quedan), los textos «Usos» de `i18n.ts` se retiran y
  `e2e-boni/models.spec.ts` se reescribe. `docs/design-guide.md` («Ajustes → Modelos» y el chip del chat) cambia
  en ese PR.
- El chip del chat (`Chat.tsx`, `ModelChip`): la misma lista con «Añadir modelo» al final.
- El mapa (`flowMap.ts`): los nodos de uso pasan a ser el modelo que contestaría cada paso.
- Extensiones (`docs/extensiones.md` §9): el papel que declara un paso de una extensión es su clase de llamada, y
  su modelo es el de «De la cuenta» de esa clase; `reviewer` lee con «Lectura».
- Android y escritorio: `Net.kt` y `paths.cjs` ya dejan pasar `api/agent` entero; no cambian.
- Principios: D-05 se queda (la configuración, solo en Ajustes → Modelos); entran las filas del §11.

**El plan de construcción: dos PR**, cada uno revisable entero, y una revisión de conformidad al final.

| PR | Qué | Antes de |
|---|---|---|
| **M1** Servidor y núcleo | La lista, las etiquetas, «De la cuenta», la evaluación del modelo (`evalModel` y la puerta de AU-235), `resolveModel`, la migración (AU-244), la ruta de opciones con `planners` como su caso, el valor `tag:` en el catálogo y en `aiProblems`, `modelRefOf` (AU-245), el mapa, y las rutas por uso de hoy contestando igual. Sin pantalla: en la app no cambia nada | La conversión de la F16 (su S1), que llama a `modelRefOf` y cuyo informe en seco compara modelos |
| **M2** Pantallas | Ajustes → Modelos, el desplegable «Modelo» del paso, el chip del chat, a ancho de teléfono; la guía de diseño; quita las rutas por uso si ya no hay quien las pida | El despliegue de la F16, para que salga todo en una entrega |

M1 no toca lo que construye ahora la F16 (su parte pura no escribe modelos) y puede ir en paralelo con ella. M2 toca
el mismo panel del paso que las pantallas de la F15: va después de ellas, no a la vez. Si M1 se desplegara antes que
la conversión, un «Revisor» distinto del «Lector» seguiría valiendo sin verse en la pantalla nueva hasta convertir:
el CHANGELOG de esa entrega lo diría. La evaluación por modelo (decisión 25) no cambia el plan: siguen siendo dos
PR, y M1 lleva `evalModel` y los resultados de hoy pasados a partes en lugar de tres evaluaciones.

## 6. Seguridad: qué aguanta y qué cambia

Juan no tiene por qué leer el código que acepta, y un modelo puede proponérselo. Así que la seguridad no puede
depender de revisar el JavaScript: depende de dónde corre, de qué puede tocar y de quién decide las escrituras.

- **AU-160** (F14c, hecho) · El JavaScript solo corre en la caja (A-08): sin red, sin ficheros, sin reloj, con
  un intérprete que no guarda nada de una evaluación a otra.
  En la F14c: es la caja de las extensiones (QuickJS compilado a WebAssembly, en su contenedor, sin red ni disco) con
  un protocolo más (`packages/sandbox/src/evaluate.ts`); el módulo `vm` de Node no se usa. A la caja no llegan
  etiquetas, ids ni nada que el código no cite, y lo que devuelve es un dato sin confianza.
  Hecho en E1: el protocolo 2 en la caja, por la misma puerta y el mismo contenedor; los casos de ataque de
  `apps/sandbox/test/cases/evaluacion`, como expresión y como «Código»; y un código que cierra la función en la que va
  no se ejecuta fuera de ella.
  Hecho en E3: el motor no ejecuta JavaScript: todo va a `RunDeps.box`, y ningún fichero del motor ni de las
  automatizaciones del servidor nombra `eval`, `Function(` ni `node:vm`. Una llamada lleva solo las filas, los pasos y
  los campos citados, la hora, la zona, el idioma, la semilla, `$run` y lo leído, sin etiquetas, orígenes ni ids.
  Hecho en S1: el servidor llama a la caja por su puerta (`sandboxBox`, `apps/server/src/automations/box.ts`) con el
  protocolo 2, y la petición lleva solo datos: lo del trabajo, la tabla de la zona, los nombres y los topes.
- **AU-161** (F14c, en parte) · El código solo lee por las conexiones de su paso. Cada lectura la hace el servidor,
  que comprueba la conexión y su filtro, la cuenta y la etiqueta.
  En la F14c: la conexión se lee de la automatización guardada, nunca de lo que diga la caja. Cada lectura pregunta a
  la política, y los valores de su filtro se juzgan como calculados, con la peor etiqueta de lo que esa evaluación
  había recibido hasta ahí. Una lectura negada, o una por la que la política preguntaría, es un fallo de la fila que
  la pidió y sigue el «Si falla» del paso (AU-16) como cualquier otro fallo de esa fila: con «Parar» (por defecto) se
  para el paso; con «Salir por error» esa fila sale por «error» con su motivo y las demás siguen; con «Seguir» esa
  fila se deja y las demás siguen, y el registro del paso cuenta las filas que fallaron y por qué. Con «Una vez con
  todas las filas» el paso es una unidad. El motivo es el código (`policy.denied` o `policy.waits`) y la regla de la
  política, nunca un detalle de lo que el código no pudo leer; el código no puede atraparlo y «Reintentos» no lo
  repite. Lo que `validate` rechaza antes de ejecutar (AU-184) no tiene salida «error», y las escrituras se siguen
  decidiendo para todo el paso a la vez (AU-174). (Juan, 2026-11-16: sustituye la elección de E3, en la que una
  lectura negada hacía fallar el paso entero). La cuenta de cada lectura (colección, operación, filas, bytes,
  tiempo) queda en el registro del paso.
  Hecho en E3: cada lectura que pide la caja pasa por `narrow` (la conexión del paso, nunca lo que diga la caja) y por
  la puerta, que pregunta a la política con los valores del filtro como calculados y con la peor etiqueta recibida
  hasta ahí; sin conexión es `code.read.notConnected` y no llega a la puerta; negada (`policy.denied`) o por preguntar
  (`policy.waits`) hacía fallar el paso; desde el 2026-11-16 hace fallar las filas que la pidieron, cada una por el
  «Si falla» del paso, sin reintento y sin el motivo de la política; la cuenta de cada lectura queda en `StepRecord.reads`.
  Hecho en S1: sobre el servidor real, una caja que pide una colección que el paso no tiene conectada no lee nada
  (`code.read.notConnected`): la conexión es la de la automatización guardada en el almacén, no la de la petición.
  En la F14c no había regla de la política que negara una lectura de una automatización: sobre el servidor real cada
  lectura de una ejecución se deja, y lo comprueba la prueba de AU-174. Desde la F15 hay una: P29 (AU-205).
  Hecho en S1 (cierra la tarea 144): sobre el servidor real, el código de «Las hace este código» de un «Agente» lee
  por la misma puerta, y la lectura de una colección que se hizo privada después de publicar la niega `decide`; la
  unidad sigue el «Si falla» del paso, sin decir qué leía (`ai.test.ts`). Para un «Código» sin IA sigue sin haber
  regla que niegue una lectura: este «en parte» es eso.
- **AU-162** (F14a, hecho) · Una cita sencilla (un campo de la fila actual o de un paso anterior: `$json.importe`,
  `$('Buscar gastos').first().total`; lo que deja arrastrar un campo) la resuelve el servidor, sin caja, y conserva
  la etiqueta exacta de ese campo.
- **AU-169** (F14c, en parte) · Todo lo calculado lleva la peor etiqueta de lo que recibió esa evaluación y queda
  marcado como derivado: nunca vale como destino (P14).
  En la F14c: «lo que recibió» son sus filas, las filas de cada paso citado que se le mandaron, la etiqueta de quien
  escribió el código y todo lo que leyó. Se calcula por evaluación (por fila en «Una vez por fila»), nunca más fino.
  Hecho en E3: `evaluate` da a cada evaluación la peor etiqueta de sus filas, de las de cada paso citado, de la del
  código y de lo leído, por fila en «Una vez por fila» y en las expresiones; lo calculado llega derivado a la política
  y a los campos de las filas que da «Código», y la etiqueta del camino (AU-164) pasa por él.
  Hecho en S1: sobre el servidor real, cada fila que da un «Código» con todas las filas lleva la peor etiqueta de lo
  que leyó, y también el campo que escribiría un paso «Colección» después. Falta: P14 sobre un destino, cuando una
  acción de una automatización lo tenga (F16, F20); ninguna de las de la F14c tiene destino, así que hoy solo lo
  sostienen las pruebas con una política que niega.
- **AU-163** (F14c, hecho) · Qué recibe una evaluación lo decide el servidor leyendo el código antes de correrlo:
  los pasos y los campos que cita. Un paso citado con un nombre calculado no se admite.
  En la F14c: tampoco se admite `$col` con un nombre calculado, ni darle otro nombre a `$` o a `$col`. El lector no es
  la barrera: la barrera es que el servidor solo manda lo que el lector listó, así que el código que esconde una cita
  no recibe nada.
  Hecho en E2: `readCode` lista los pasos citados y sus campos, sin contar comentarios ni textos, y da `code.computed`
  para un `$(…)` o un `$col(…)` con un nombre calculado, para `$` o `$col` con otro nombre y para los que se alcanzan
  por el objeto global (`globalThis`, `self` o un `this` que puede serlo), también si el objeto global se guarda con
  otro nombre o se le pasa a una función.
  Hecho en E3: la llamada que manda el motor lleva solo los pasos y los campos que el lector listó, y un `$` dentro de
  un texto que se da a `eval` o a `Function` no recibe nada.
- **AU-164** (F14a, hecho) · Las filas llevan también la etiqueta del camino: lo que sale de una condición o de
  unas filas que dependen de algo de fuera se trata como de fuera (P15).
- **AU-165** (F15, hecho) · La política es el suelo. Una conexión, un ajuste o un «Sí» nunca dejan hacer lo que
  `decide` no deja: un destino nunca sale de un dato de fuera ni de un modelo (P2, P14), lo de fuera no escribe lo
  que Boni sabe de Juan (P9), enviar y pagar nunca van solos (fuera de una automatización se confirman, P5; dentro
  de una no existen en estas fases y `decide` los niega, AU-167). Lo de fuera se propone (P4) y eliminar se
  pregunta (P5) salvo en lo que dice AU-186, que es una fila de la política (P28, decisión 11 del §10) y no un
  permiso de la celda.
  En la F15: la política cambia en dos sitios y en ninguno más. La tercera fila de P28 pasa a ser la tabla de AU-204
  (lo que guarda un paso de IA), y entra una fila nueva, P29 (AU-205: un paso de IA fuera de su conexión se niega).
  Ninguna abre P2, P14 ni P9, ni lo que en estas fases no existe (enviar, pagar, lo irreversible). `docs/nucleo.md`
  §7.5 las lleva como diseñadas hasta que el PR que las construya cambie su tabla. La prueba, una por fila:
  `packages/agent/test/automation-ai.test.ts`.
  Hecho en E1: las dos, y ninguna más (`byAutomation` y `byReach` en `packages/agent/src/policy.ts`), con su tabla en
  `docs/nucleo.md` §7.5. Una llamada que cumple su conexión sale de `decide` igual que sin ella, en cada acto de una
  colección, cada etiqueta y cada celda: P29 solo niega. Enviar y lo de lo que Boni sabe de Juan no los toca.
- **AU-186** (F14d, en parte) · Lo que no pregunta. Una escritura (crear, modificar o eliminar) se guarda sin
  preguntar si cumple dos cosas. Viene de un paso «Código», «Colección» o «Agente» de una versión publicada
  (AU-95). Y lleva el «Sí» de la mano de Juan para esa colección y esa acción (AU-188). Vale también para lo que
  viene de fuera, en sus valores o en su camino (AU-164, AU-169), y la inicie su mano o empiece sola (decisión 11
  del §10, 2026-11-16; hasta entonces había una tercera condición, que no hubiera nada de fuera): lo guardado
  conserva su etiqueta de fuera (AU-170). Si falta una, se propone o se confirma, y con ella todo el paso
  (AU-174). Eliminar es siempre mandar a la papelera con la ejecución (AU-122), así que «Deshacer lo que hizo» la
  devuelve (AU-18). Borrar para siempre no existe en una automatización, digan lo que digan las celdas. Lo que el
  asistente elimina fuera de una automatización sigue como hoy (P5, P24). Juan, 2026-11-16: «la logica de "no", "si",
  "preguntar" deberia ser la misma para modificar y eliminar, por separado», y del «Agente»: «es responsabilidad del
  usuario limitarlo si no quiere arriesgar».
  En la F14d: la política cambia en cinco filas de `docs/nucleo.md` §7.5, y en ninguna otra. P28 es nueva: lo que
  escribe un paso de una versión publicada (AU-167). P4 y P15 ganan «salvo lo que deja P28», que es su única
  excepción. P7 gana lo mismo. Y en P5, «borrar a petición del agente» pasa a «borrar a petición del agente, salvo
  lo que una automatización publicada manda a la papelera con el «Sí» de Juan para esa colección (AU-186) o dentro
  de la propuesta de una ejecución que él acepta (AU-193)». P2, P14, P9 y P24 no cambian. El acto «Eliminar filas»
  de `apps/server/src/automations/policy.ts` deja de llevar `alwaysConfirm` fijo: la llamada a `decide` lleva el
  «Sí» de la versión publicada, de su conexión o de su «Permiso» (AU-187), leído por el servidor de lo guardado
  (AU-188); sin él confirma, como hoy. Decide el código (A-01): el «Sí» es un dato que el servidor lee de la
  versión publicada, y ningún modelo lo pone, lo lee ni lo cambia. El asistente en un turno sigue con P4 y P5 tal
  cual: la excepción es solo de un paso de una versión publicada. Que Boni pueda un día aceptar una propuesta por
  su cuenta, con pruebas (la seudoaceptación de `docs/fiabilidad.md`), es del diseño de la F15, y esta regla no lo
  cierra (el §5.15 lo cerró: Boni no la acepta nunca por su cuenta).
  Una escritura pasa dos puertas, en este orden. La primera es la celda de Juan (la de la conexión, o el «Permiso»
  de un paso «Colección», AU-187): «No» hace fallar el paso; «Preguntar» hace esperar el cambio entero del paso como
  propuesta en cualquier ejecución; «Sí» pasa a la segunda. La segunda es la política, que es el suelo: lo que
  ningún «Sí» abre (un destino que sale de algo de fuera o de un modelo, P2 y P14; lo que Boni sabe de Juan, P9;
  enviar, pagar y lo irreversible) y P28, que deja guardar con el «Sí» que el servidor lee de lo guardado.
  Hecho en E1: las dos puertas en el motor (un paso «Colección» que escribe con «Permiso» en «Preguntar», o una
  celda «Preguntar» de su conexión, hace esperar el cambio entero del paso; «Sí» pasa a la política), P28 y la frase
  nueva de P5 en `decide` (`byAutomation`, `packages/agent/src/policy.ts`), y el servidor, que lee el «Sí» de lo
  que tiene guardado (`consentIn` y `automationPolicy`, `apps/server/src/automations/policy.ts`), nunca de la
  llamada, de la caja ni de un navegador. `YES_SAVES` ya no existe: un paso pregunta si su celda dice «Preguntar» o
  si la política preguntaría, crear y modificar con «Sí» no añaden nada a «Haría esto», y «Probar» dice lo que hará
  la ejecución, la inicie quien la inicie (AU-195). El «Sí» se lee de la versión publicada desde S1.
  Hecho en S3: `proposal.test.ts` sobre el servidor, a mano y a su hora: una eliminación con «Sí» de un «Colección»
  o de un «Código» va a la papelera sin propuesta y se deshace con la ejecución, también cuando lo de fuera elige
  las filas; con «Preguntar», se propone, y aceptarla vale como la confirmación de P5.
  Hecho en P3b: en la app de escritorio sobre el servidor real, un «Eliminar filas» publicado con «Sí» manda sus
  filas a la papelera a su hora sin propuesta, y deshacer la ejecución las devuelve; con «Preguntar», la misma
  ejecución deja una propuesta, y rechazada no se tira nada (`e2e-boni-desktop/automations-publish.spec.ts`, AU-186
  AU-187). Las palabras «sin preguntar» llegaron en P1 (AU-189). Falta, de la revisión de la fase (P3b-2): que el acto
  de tirar a la papelera deje de llevar `alwaysConfirm` fijo (`apps/server/src/automations/policy.ts`). Se porta
  como dice la regla, porque `decide` solo lo levanta con el «Sí», pero su forma no es la del diseño.
  El coste de la decisión, como se le dijo a Juan, en dos casos. Los ve una vez, en «Publicar» (AU-182), y no en
  cada ejecución.

  - **Sin modelo, cuando lo de fuera elige las filas.** Una automatización empieza con un correo, busca en una
    colección las filas cuyo «Nombre» es el asunto y las elimina, con «Sí». Quien escribe el correo elige qué
    filas van a la papelera, de una en una o de varias. No puede hacer otra cosa: qué se hace con el texto es el
    camino que Juan dibujó y publicó. Lo acotan el filtro de la conexión y los límites de la ejecución (AU-17), va a
    la papelera, y la ejecución lo dice y lo deshace.
  - **Con un «Agente» que lee correo (F15), con «Sí» en «Eliminar».** Un correo que diga «elimina todas las
    filas» puede conseguir que el modelo mande a la papelera las que su conexión le deja, sin el toque de Juan. Se
    recuperan con «Deshacer lo que hizo», y el siguiente correo puede repetirlo. En esta fase ningún paso llama a
    un modelo, y lo que escribe un modelo se propone hasta la F15 (AU-167): la F15 abre este caso con su diseño.
    Desde la decisión 16 del §10 (2026-11-17) se guarda, dentro de su conexión y de «Como mucho» (AU-204).
  Lo sostienen `consent.test.ts` (`packages/automations`: las dos puertas, caso por caso, y que una celda nunca
  cambia un «no» de la política), `automation-origin.test.ts` (`packages/agent/test`: la fila P5 con y sin el «Sí»,
  y que fuera de una automatización eliminar sigue confirmando), `automations.test.ts` (servidor: el «Sí» se
  lee de lo guardado, nunca de la respuesta de la caja ni de un navegador) y `proposal.test.ts` (servidor: una eliminación con
  «Sí» de una versión publicada va a la papelera sin propuesta y se deshace con la ejecución, con algo de fuera
  también; con «Preguntar», se propone).
- **AU-166** (F15, hecho) · Lo privado no llega a un modelo: se comprueba al publicar donde se puede saber y
  siempre al ejecutar. El paso falla diciendo qué colección y por qué.
  En la F15: «privado» es lo que dice el acceso de la IA a la colección (`ai_access`, `docs/nucleo.md` §7.3):
  `hidden` (para un modelo no existe) y `opaque` (sus valores llevan `noModel`: ni un modelo que planifica ni un lector
  los reciben). Donde se puede saber: una colección así no sale entre las que se pueden conectar a un «Agente»
  (AU-45), y al publicar, una que lo es desde entonces es un problema («Gastos es privada: quítala de «Analista»»).
  Siempre al ejecutar: la lectura de un paso de IA a una colección así se niega en `decide` (AU-205); un valor con
  `noModel` que llega a un «Agente» por sus filas de entrada entra como asa (AU-197); y uno que llega al «Texto» de un
  lector hace fallar esa fila (`ai.private`) por el «Si falla» del paso, diciendo el campo y, si su etiqueta la
  lleva, la colección, nunca el valor. Lo que no se sabe al publicar es lo que llega por las filas de otros pasos.
  La prueba: `packages/automations/src/ai-steps.test.ts` y `apps/server/src/automations/ai.test.ts`.
  Hecho en E2: en el lector. Un valor con `noModel` en el «Texto» o en otro parámetro de un lector (todos se resuelven
  por el mismo camino; la prueba lo hace con el «Texto») hace fallar su fila antes de cualquier llamada (`ai.private`), por el «Si falla» del paso, con el parámetro, el campo y, si la fila
  dice de qué colección se leyó, la colección; nunca el valor. Las otras filas del paso se leen. Desde E3, lo que
  un planificador no puede ver llega a un «Agente» como asa (AU-197).
  Hecho en S1: el servidor pone en la llamada de un paso de IA si la colección es privada para un modelo
  (`reachStore`: todo nivel que no sea `visible`, también `private`), y P29 niega su lectura: la del plan hace
  fallar la unidad con `ai.private` y la colección, la del código de «Las hace este código» con el parámetro. Al
  publicar, una colección así conectada a un «Agente» es un problema (`connection.notAllowed`, `why: "private"`) y
  no se publica. Falta: que el editor no la ofrezca entre las que se pueden conectar, y las palabras del problema (P1).
  Hecho en P1 de la F15: «Conectar» no la ofrece (`agentConnectable`), y el problema dice «Gastos es privada:
  quítala de este paso», con el paso de enlace en «Antes de publicar» (`words.test.ts`, `automations-ai.spec.ts`).
- **AU-167** (F14d, hecho) · Lo que una automatización escribe sola en segundo plano sigue la regla de la
  decisión 5 del §10.
  En la F14d: la decisión 11 del §10 (2026-11-16) cambia la frase de la decisión 5 sobre lo de fuera, y esta
  regla la sigue. `decide` conoce un origen más, `automation`: una ejecución de verdad de una versión publicada, la
  inicie la mano de Juan o empiece sola (AU-195). Su regla es una fila nueva de `docs/nucleo.md` §7.5, P28. Va
  después de P2, P14 y P9, que no cambian, y es la única excepción a P4 y a P15:

  | Lo que escribe un paso de una versión publicada | Qué pasa |
  |---|---|
  | Crear, modificar o mandar a la papelera con el «Sí» de la versión publicada para esa colección y esa acción | Se guarda con el Deshacer de la ejecución, también con algo de fuera en un valor (P4) o en el camino (P15), y conserva su etiqueta (AU-170) |
  | Lo mismo sin ese «Sí» | Crear y modificar se proponen; mandar a la papelera se confirma (P5). Van en la propuesta de la ejecución (AU-193) |
  | Un valor que escribió un modelo, o de un turno ambiental (`model`, `ambient`) | Se propone, hasta que la F15 diga cómo guarda un paso de IA (A11). En esta fase ningún paso llama a un modelo. Desde la F15 (E1) es la tabla de AU-204: el de un modelo sigue al «Sí» como cualquier otro valor, y el de un turno ambiental se propone |
  | Un destino que sale de algo de fuera o de un modelo (P2, P14); lo que Boni sabe de Juan (P9) | Se niega, como a cualquier origen |
  | Enviar, salir fuera, pagar, lo irreversible | No existe en estas fases (decisión 9); `decide` lo niega a este origen |

  La segunda fila es una guarda: una celda «Preguntar» ya hace esperar el cambio en la primera puerta (AU-186), y
  esta fila contesta lo mismo si la llamada llega sin el «Sí» leído de lo guardado. El segundo plano de antes no
  cambia: la fila P7 gana «salvo lo que deja P28», y un flujo de los de antes sigue proponiendo. P11 no cuenta para
  este origen: su tope son las filas escritas de la ejecución (AU-17), que Juan ve y cambia. Lo que se propone de
  una ejecución es una sola propuesta (AU-193). Una ejecución que empezó sola y escribió da un aviso por ejecución
  («Tarea de la mañana creó 1 fila en Tareas · Deshacer»), que escribe el código con cuentas y nombres de
  colección, nunca con valores; sale en la app, en su línea de «Ejecuciones» y sin saltar (decisión 17 del §10), y al móvil solo van los fallos (AU-102). La que inició su mano lo
  dice en su pantalla. P9 no se toca: un paso solo puede nombrar colecciones que no son del sistema (`shape`,
  `collectionNamed`), así que una automatización no tiene con qué escribir lo que Boni sabe de Juan, traiga lo
  que traiga. Lo que quedaba de AU-185 (la propuesta de P4 sobre el servidor real) lo sustituye la decisión 11:
  sobre el servidor real, una ejecución con algo de fuera lo guarda con su etiqueta si la celda dice «Sí» y lo
  propone si dice «Preguntar», empiece como empiece.
  Hecho en E1: el origen `automation` y la fila P28 en `decide` (`byAutomation`), una prueba por fila, con P11 fuera
  para este origen, y cada acto de `ACTS` contestado para él por una tabla escrita en la prueba.
  Hecho en S3: las mismas filas con una ejecución programada sobre el almacén de verdad (`proposal.test.ts`): lo
  propio y lo de fuera con «Sí» se guardan, con su etiqueta; con «Preguntar», una propuesta; ningún paso puede
  nombrar una colección del sistema. La tercera fila es de AU-204 (F15).
  Hecho en S4: el aviso por ejecución (`notices.ts`), con las cuentas y los nombres de su línea, se guarda con la
  ejecución y va en su último evento (`RunEvent.notice`); no va al móvil ni como aviso del sistema
  (`scheduler.test.ts`).
  Hecho en P3b: la app no lo saca como aviso (decisión 17 del §10, 2026-11-17): lo que guardó sola se ve en su
  línea de «Ejecuciones», «Programada · Creó 1 fila en Libros», con «Deshacer lo que hizo», que deshace esa
  ejecución (`automations-publish.spec.ts`, «AU-167 · decision 17»). Sobre el servidor real en la app de escritorio,
  a su hora: lo de fuera con «Preguntar» no guarda nada y deja una propuesta, y con «Sí» lo guarda con «con datos de
  fuera» en su línea, igual a mano (`e2e-boni-desktop/automations-publish.spec.ts`, AU-167 AU-193 AU-170 y AU-195
  AU-167).
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: una prueba por fila de la tabla),
  `automations.test.ts` (servidor: cada acto de `ACTS` con el origen nuevo), `proposal.test.ts` (servidor: las mismas filas con una ejecución programada sobre el
  almacén de verdad, y que ningún paso puede nombrar una colección del sistema) y `scheduler.test.ts` (el aviso por
  ejecución, sin valores).
- **AU-195** (F14d, hecho) · La misma versión publicada, con la misma entrada, recibe la misma decisión para
  cada escritura (permitir, proponer, confirmar o negar) la inicie Juan o su disparador (decisión 11 del §10,
  2026-11-16). Quién inicia una ejecución no llega a `decide`: llega a `$run`, a «Ejecuciones» y a los avisos.

  | Quién | Origen para `decide` | Qué pasa con una escritura |
  |---|---|---|
  | «Probar», «Probar paso» | `automation`, como prueba | Nada se guarda nunca (AU-90); «Haría esto» dice lo que hará la ejecución |
  | «Ejecutar», «Reintentar», o sola («Programada»; desde la F18, cada disparador) | `automation` | La celda, y después P28 (AU-186, AU-167). Con «Preguntar», todas proponen |
  | Aceptar la propuesta de una ejecución | `accepted` | AU-193 |

  Desde E1 una ejecución que inicia su mano ya no va con el origen `hand` (P25): `runPolicy` le da `automation`,
  como a la que empieza sola, y `handPolicy` ya no existe. Una ejecución de verdad de una versión sin publicar no existe: «Ejecutar» corre la publicada
  (AU-95) y un borrador solo se prueba, y la prueba pregunta a la política con las celdas del borrador, sin
  guardar. Así la prueba del principio es exacta: para cada acto de `ACTS`, cada etiqueta de valor y de camino y
  cada celda, `decide` contesta lo mismo sea cual sea `startedBy`.
  Lo que sí depende de cómo empezó no es una decisión sobre una escritura: el aviso (solo avisa la que empezó sola,
  AU-167 y AU-102) y `$run`. `$run.startedBy` es el «quién la inició» de AU-24, que hasta la F14d solo da
  `"user"`. Dice cómo empezó, de una lista cerrada, nunca un nombre ni un id: `"user"` para «Ejecutar»,
  `"schedule"` para la que empieza a su hora y, desde la F18, uno por disparador. «Reintentar» da el de la
  ejecución que repite, porque corre con los datos del disparador de aquella (AU-100): una rama que dependa de
  cómo empezó va por el mismo sitio; sigue siendo un toque suyo, así que falla en su pantalla y no avisa. «Probar»
  da el del disparador de la automatización (`"schedule"` en una «Programada», `"user"` en una que se inicia a
  mano), y que es una prueba lo dice `$run` aparte (AU-24): así esa rama se puede probar. La automatización que
  quiera hacer otra cosa según cómo empezó lo dice ella, como pidió Juan («deberia ser algo marcado por el
  flujo»): `$run` (AU-24) en un paso «Si», o una rama por disparador (AU-06). El «Si» elige el camino y nada más:
  lo que guarda cada rama lo decide su celda.
  Un suelo que la decisión hace necesario: nada de fuera se guarda sin preguntar antes de que el almacén guarde su
  etiqueta (AU-170); las dos cosas llegan en el mismo PR. Sin la etiqueta, guardar y volver a leer convertiría algo
  de fuera en propio, y el asistente, en un turno, escribiría con ello sin que P4 lo viera, o lo usaría como
  destino.
  Hecho en E1: un solo origen para toda ejecución de verdad, y la tabla del principio sobre el servidor (cada acto,
  cada etiqueta de valor y de camino y cada celda: lo mismo a mano y sola, y otra versión no da el «Sí» de esta).
  Hecho en S3: el mismo paso a mano y a su hora sobre el almacén (`proposal.test.ts`: lo mismo guardado, propuesto
  o, en «Probar», nada; y «Haría esto» de una «Programada» igual que el de su ejecución) y `$run.startedBy`, con
  `"schedule"` en la que empieza a su hora, en sus reintentos y en «Probar», y un «Si» sobre él que lleva a una
  rama a mano y a la otra a su hora (`scheduler.test.ts`).
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: que quién la inició no es una entrada de
  `decide`), `automations.test.ts` (servidor: el principio, con la tabla entera para cada manera de empezar), `proposal.test.ts` (servidor: el mismo paso y el mismo valor de fuera, a mano y a su hora;
  con «Sí» las dos lo guardan con su etiqueta, con «Preguntar» las dos lo proponen, y «Probar» no escribe) y
  `scheduler.test.ts` (`$run.startedBy` en cada manera de empezar, y un «Si» sobre él que lleva a una rama a mano
  y a la otra a su hora).
- **AU-168** (F14a, hecho) · Todas las rutas y herramientas de automatizaciones pasan por `decide` desde el
  primer día (A-26). En la F14a todavía no hay rutas ni herramientas: es el motor el que no tiene otro camino a las
  colecciones que la política, y cada lectura y cada escritura le pregunta antes, en una prueba también. En una
  prueba, una escritura permitida no escribe: da la fila como quedaría, y para eso lee la fila guardada sin otra
  pregunta a la política, porque es parte de la escritura que ya se permitió. Lo que sale de un paso que escribe
  lleva las etiquetas que daría leerlo: cada campo guardado la suya, cada campo escrito la del valor que se escribió.
- **AU-170** (F14d, hecho) · Lo que una automatización guarda conserva de dónde vino: un campo escrito con un
  valor de fuera queda guardado como de fuera, y cualquier lectura posterior (otra ejecución, otra automatización,
  el asistente) lo da como de fuera. Guardar y volver a leer nunca limpia una etiqueta. En la F14a el motor ya
  etiqueta lo que sale del paso que escribe; falta que el almacén lo guarde, porque el cambio que recibe lleva
  valores y no etiquetas.
  En la F14d: lo que el motor guarda directamente ya lleva la etiqueta de cada valor desde la F14c (`applyAll`
  recibe `ChangeWith`, AU-185). Falta el otro camino, la propuesta: lo que espera a Juan (`Asked`) lleva hoy el
  cambio sin sus etiquetas, así que aceptarlo lo guardaría como propio. `Asked` pasa a llevar los valores con su
  etiqueta, la propuesta los guarda así y aceptar los escribe con ella (AU-193). Lo fijado también las conserva
  (AU-93).
  Desde la decisión 11 (§10) esta regla es lo que hace que los suelos sigan valiendo después: lo que una versión
  publicada guarda sin preguntar con algo de fuera queda como de fuera, así que el asistente, en un turno, lo
  propone al escribir con ello (P4), nunca lo usa como destino (P2, P14) y nunca lo lleva a lo que Boni sabe de
  Juan (P9). Por eso llega en el mismo PR que P28 (AU-195), y ese PR prueba los dos caminos, el que guarda y el
  que propone.
  Hecho en E1: `Asked` lleva los valores con la etiqueta de cada uno, y lo que una ejecución guarda con «Sí» queda
  en el almacén con la suya (`box.test.ts`, 3.000 filas, de fuera y propias).
  Hecho en S3: la propuesta guarda cada valor con su etiqueta y aceptar lo escribe con ella; otra ejecución que lee
  lo guardado con «Sí» o aceptado lo recibe de fuera, lo guarda de fuera con «Sí» y lo propone marcado con
  «Preguntar» (`proposal.test.ts`).
  Hecho en P3b: lo mismo en la app de escritorio sobre el servidor real: aceptada en la Bandeja la propuesta de una
  ejecución programada con un valor de fuera, otra automatización que lee esas filas y las guarda con «Sí» dice
  «con datos de fuera» en su línea (`e2e-boni-desktop/automations-publish.spec.ts`, AU-167 AU-193 AU-170). Lo fijado
  conserva sus etiquetas (`runs.test.ts`, AU-93).
  Lo sostienen `consent.test.ts` (`packages/automations`: lo que se pregunta lleva la etiqueta de cada valor),
  `box.test.ts` (servidor: lo guardado con «Sí» conserva su etiqueta en el almacén) y
  `proposal.test.ts` (servidor: un valor de fuera guardado con «Sí», o propuesto y aceptado, y leído otra vez por
  otra ejecución sigue siendo de fuera; lo que esa escriba con él lo decide su celda, y el asistente lo propone).
- **AU-193** (F14d, hecho) · Lo que una ejecución pregunta es una sola propuesta en la Bandeja de siempre. Junta
  el cambio entero de cada paso que espera (AU-174), paso por paso, y la ejecución sigue: un paso que espera no da
  filas a los siguientes (AU-14). Espera lo que una celda «Preguntar» hace esperar y lo que escribió un modelo
  (AU-167; desde la F15, lo de un modelo solo sin el «Sí», y lo de un turno ambiental siempre: AU-204); desde la decisión 11 (§10), lo de fuera con «Sí» ya no, y es igual la inicie quien la inicie. La tarjeta la pinta el código, con texto y nunca con un resumen de un modelo:
  qué automatización y qué versión, cuántas filas crea, modifica o manda a la papelera en cada colección («Tarea de
  la mañana: crear 4 filas en Tareas»), y cada fila con su antes y su después y con la marca de lo que viene
  de fuera. Aceptar es un toque en un dispositivo personal: pasa otra vez por `decide` con el origen «aceptado»
  (satisface P4; nunca P2 ni P3), guarda todo en una transacción, con la ejecución en el registro y cada valor con
  su etiqueta (AU-170), y vale como la confirmación de P5 para las eliminaciones que la tarjeta nombra: hoy `decide`
  confirmaría otra vez un borrado aceptado, y la frase nueva de P5 (AU-186) lo dice para la propuesta de una
  ejecución, que ya es lo que P5 pide (pintada por el código desde el cambio real, aceptada en un dispositivo
  personal). Solo la papelera: lo irreversible sigue sin existir aquí, y ninguna otra propuesta gana esto. Lo aceptado
  se deshace con la ejecución (AU-18). Si una fila cambió desde que se propuso, no se guarda ninguna y la propuesta
  queda «Caducada · Ejecutar otra vez». Rechazar no guarda nada, y la ejecución lo dice. Nada de esto es nuevo en
  la Bandeja: extiende `proposals` y `acceptProposal`, con una acción más en la lista (A-26).
  Hecho en E1: la frase nueva de P5 en `decide` (`Call.ofRun`): una eliminación aceptada dentro de la propuesta de
  una ejecución, desde un dispositivo personal, no se confirma otra vez; en otra propuesta, desde uno compartido o
  algo irreversible, como antes (`automation-origin.test.ts`).
  Hecho en S3: `proposeRun` deja una propuesta por ejecución, con los pasos que esperan y
  lo que la tarjeta pinta (`RunProposalView`: automatización, versión, cuentas por colección y acción, cada fila con
  su antes y su después y la marca de fuera), y la acción `automations.accept_run` (`acceptsRun`), que solo llama
  aceptarla desde la Bandeja y pasa por `decide` con el origen aceptado (P28 y P5). Desde un dispositivo compartido
  no se acepta; una fila cambiada la deja «stale» sin guardar nada; rechazar no escribe; deshacer la ejecución deja
  sin valer la que esperaba (`proposal.test.ts`).
  Hecho en P3b: su tarjeta en la Bandeja (`RunProposalCard.tsx`, desde `InboxCards.tsx`), pintada por el código desde
  `view.run` y siempre como texto: «Revisar pendientes: modificar 3 filas en Libros y mandar a la papelera 125
  filas de Libros», «versión 2 · Programada · Pendiente en la Bandeja», cada fila con su antes y su después y «de
  fuera», y «Ver todo (128)», que lee el resto de 50 en 50 (`GET …/runs/:run/asked`, `runAsked`). Un valor con
  HTML, Markdown o un enlace se lee letra por letra. Aceptada, el aviso dice «Propuesta aceptada: …» sin
  «Deshacer»: lleva a la ejecución, que dice «Propuesta aceptada» y lo deshace con «Deshacer lo que hizo». Cambiada
  una fila, «Caducada · Ejecutar otra vez», en la tarjeta y en su ejecución. Desde un dispositivo compartido se lee
  y no se acepta (decisión 15). Ningún plan puede llamar `automations.accept_run`: `decide` lo niega a todo origen
  que no es la aceptación (P28, `automation-origin.test.ts`). Lo prueban `automations-publish.spec.ts` (`e2e-boni`)
  y, sobre el servidor real, `e2e-boni-desktop/automations-publish.spec.ts`.
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: un borrado aceptado en la propuesta de una
  ejecución no se confirma otra vez, y el de cualquier otra propuesta sí) y `proposal.test.ts` (servidor): una
  propuesta por ejecución con dos pasos que esperan; aceptar guarda
  todo o nada; una fila cambiada la deja sin valer; rechazar no escribe; desde un dispositivo que no es personal no
  se acepta; y un texto con HTML en un valor se lee letra por letra en la tarjeta (`automations-publish.spec.ts`).
- **AU-171** (F15, en parte) · Lo que devuelve una escritura pasa por los límites de lectura de quien la pide: solo
  las filas y los campos que su conexión le deja leer. Sin permiso de leer, devuelve lo que escribió y nada más, en
  una prueba también. Hasta la F15 solo escriben los pasos de «Colección» que pone Juan, que no llevan límites de
  conexión.
  En la F15: al modelo de un «Agente» una escritura le devuelve su cuenta («Creará 1 fila en Notas», AU-198), nunca
  la fila. En «Lo que hizo» y en el registro, cada fila escrita sale recortada con los límites de leer de esa
  conexión (`asRead`): con «Solo estos campos», esos campos y su id; con «Leer» en «No», los campos que el paso puso y
  su id, y nada más de la fila que modificó. En una prueba («Crearía…», «Propondría…») sale igual de recortada. La
  prueba: `packages/automations/src/action-limits.test.ts`.
  Hecho en E1: `cutRecord` (`writes.ts`) recorta así cada registro de una escritura, guardada, probada o propuesta,
  y para un «Código» también: lo que su ejecución y «Haría esto» enseñan de una fila ya no lleva un campo que su
  conexión no deja leer. El Deshacer no lo usa (lee el registro de operaciones del almacén). Desde E3, las
  escrituras de un «Agente» se recortan igual (pasan por el mismo `applyWrites`), «Lo que hizo» no lleva filas y a su
  modelo se le devuelve solo la cuenta («will create 1 row in …»).
- **AU-204** (F15, en parte) · Lo que guarda un paso de IA. Cambia la tercera fila de P28 (AU-167), que hasta
  aquí proponía todo valor escrito por un modelo. Desde la F15:

  | Lo que escribe un paso de una versión publicada | Qué pasa |
  |---|---|
  | Un «Código» o un «Colección», con el «Sí» de la versión, un valor que escribió un modelo (la salida de un lector, la «Respuesta» de un «Agente») | Se guarda con el Deshacer de la ejecución y queda guardado como escrito por un modelo (`model`, AU-170), con la etiqueta de fuera si la traía |
  | Un «Agente», con el «Sí» de su conexión para esa colección y esa acción | Se guarda igual: qué filas y qué valores los eligió la IA, dentro de su conexión y de «Como mucho» (nace en 20, AU-196), y lo dicen la ejecución y «Lo que podrá hacer» (AU-200). Juan, 2026-11-16: «es responsabilidad del usuario limitarlo si no quiere arriesgar» |
  | Lo mismo, cuando a esa unidad le llegó algo de fuera (en sus filas, en su camino o en lo que leyó): crear, modificar o mandar a la papelera | Se guarda igual, con su etiqueta de fuera (decisión 11; para modificar y eliminar, decisión 16) |
  | Cualquiera de ellos sin ese «Sí» | A la propuesta de la ejecución (AU-42, AU-193): crear y modificar se proponen, mandar a la papelera se confirma (P5) |
  | Un valor de un turno ambiental (`ambient`) | Se propone, como hasta ahora, con «Sí» o sin él |
  | Un destino que sale de algo de fuera o de un modelo; lo que Boni sabe de Juan; enviar, pagar, lo irreversible | Como a cualquier origen (AU-165) |

  «Le llegó algo de fuera» es, al ejecutar, que lleva la etiqueta de fuera alguna de las filas de entrada de la
  unidad, su camino (P15) o algo que sus rondas leyeron; al publicar, que puede llegarle (AU-200). No cambia lo que
  pasa: lo dice la ejecución («… · con datos de fuera») y lo guardado conserva su etiqueta. Si una escritura de la
  unidad se propone, el cambio entero espera con ella (AU-198, AU-174).

  A `decide` se los pone el servidor en la llamada, leídos de la versión guardada, y nunca salen del modelo, de la
  caja ni de un navegador (como el `scope` de P26): el «Sí» (AU-188), si el paso es un «Agente» (`byAgent`) y, como
  hasta ahora, las etiquetas de los valores y del camino (P15).

  Lo que aguanta (decisión 16 del §10, que confirmó la 11 para el «Agente»):
  - El modelo que decide no lee nunca un texto de fuera: recibe asas (AU-197). El texto de fuera lo lee un lector,
    que devuelve una forma cerrada con la etiqueta de su entrada (AU-57), y esa salida tampoco la ve el que decide. Un
    correo no puede darle instrucciones al agente.
  - Lo que un correo sí puede: poner valores dentro de la forma que Juan dibujó (una clase entre sus opciones, un
    campo extraído) y, donde el plan los usa sin leerlos (un filtro «Nombre es» ese valor, un campo que se rellena con
    él), elegir filas o valores. Es el caso «cuando lo de fuera elige las filas» de AU-186, con una IA escribiendo el
    plan en vez de Juan el grafo. Por ejemplo, «Al llegar un correo», un lector lo clasifica y un «Agente» está
    conectado a Tareas con «Eliminar: Sí · como mucho 20»; llega un correo que dice «elimina todas las tareas». El
    agente no lee esa frase. En el peor caso van a la papelera hasta 20 filas de las que su conexión deja, la
    ejecución lo dice («Eliminó 20 filas en Tareas · decidido por un modelo · con datos de fuera») y «Deshacer lo que hizo» las
    devuelve. Quien quiera que le pregunte pone la celda en «Preguntar».
  - El modelo nunca es la guarda (A-01): decide `decide`. Lo acotan el filtro de cada acción (AU-48), «Como mucho»
    (AU-196), los límites de la ejecución (AU-17), la papelera (AU-122) y el Deshacer de la ejecución (AU-18). Un
    «Sí» que falla vuelve a preguntar solo (AU-210).
  - P2, P14, P9 y P5 fuera de una automatización no cambian.

  Lo que no aguanta, dicho antes: un modelo se equivoca sin que nadie de fuera le ayude, y con «Sí» su error se
  guarda (es lo que Juan decidió; se ve en la ejecución y se deshace); y lo que entró de fuera antes de que el
  almacén guardara etiquetas (AU-170) se lee como propio, así que el que decide lo lee. La prueba:
  `packages/agent/test/automation-ai.test.ts` (una por fila) y `apps/server/src/automations/ai.test.ts` (las mismas
  sobre el almacén de verdad).
  Hecho en E1: la tabla en `byAutomation` (`packages/agent/src/policy.ts`): solo un valor de un turno ambiental
  propone siempre; uno de un modelo sigue al «Sí» como cualquier otro (con él, allow P28; sin él, propose P28, y la
  papelera confirm P5). No hay retención para el «Agente» con algo de fuera: la constante que el diseño dejaba para
  esa respuesta no se construyó. `Call.byAgent` llega a `decide` y solo lo usa P29 (AU-205). Cambian con ella la
  prueba de AU-167 (`automation-origin.test.ts`) y las filas de un modelo en la tabla de AU-195
  (`apps/server/src/automations/automations.test.ts`).
  Hecho en S1: sobre el almacén de verdad con 3.000 filas, el «Sí» y `byAgent` leídos por el servidor de la versión
  guardada: con «Sí» lo que crea un «Agente» se guarda con la ejecución, con su etiqueta, y se deshace con ella; con
  «Preguntar» no se guarda nada y espera en la propuesta de la ejecución; «Probar» no guarda nada. Falta: decir
  «decidido por un modelo» en la ejecución y en «Lo que podrá hacer» (AU-200, P1, P2). Hecho en P1 de la F15: en «Lo que podrá
  hacer». Falta: en la ejecución (P2). Hecho en P2 de la F15: la línea de
  una ejecución dice «decidido por un modelo» en lo que un «Agente» guardó sin preguntar, antes de «con datos de
  fuera» (`RunLine.byAgent`, del registro de la ejecución; `runs.test.ts` del servidor y de la app).
- **AU-205** (F15, hecho) · La conexión de un paso de IA la comprueba también la política: P29, una fila nueva
  de `docs/nucleo.md` §7.5. Una llamada de un «Agente» (de su plan, del código de «Las hace este código» o de una
  herramienta de código) se niega en `decide` si la colección no está conectada a ese paso, si la acción está en
  «No», si cae fuera de «Solo estas filas» o de «Solo estos campos» o si pasa de «Como mucho»; y la de cualquier
  paso de IA, si la colección es privada para un modelo (AU-166). La conexión, y lo que ese paso lleva escrito en la
  ejecución con cada acción (guardado o pendiente: lo que «Como mucho» cuenta), los pone el servidor en la llamada,
  leídos de la versión guardada y de la ejecución, como hoy pone el `scope` del chat de una página (P26: se niega la
  acción o la colección que su paso no da); nunca salen del modelo, de la caja ni de un navegador. P29 extiende esa
  regla con los límites de cada acción (T-05). Qué hace el motor con cada negación lo dice AU-198: la del plan de
  un modelo se le dice al modelo; la del código y la de lo privado hacen fallar la unidad. El motor sigue
  comprobando lo mismo (`narrow`, `insideConnection`): son dos puertas, y la del motor no basta porque aquí quien
  pide es un modelo (A-01). Para un «Código» sin IA nada cambia: su conexión la sigue comprobando el motor (AU-176).
  Con esto la F15 trae la primera regla de la política que niega una lectura de una automatización (AU-161): el PR
  del servidor trae la prueba de la tarea 144 sobre el servidor real, con el código de «Las hace este código», que
  lee por la misma puerta que un «Código» (la política niega la lectura, la unidad sigue el «Si falla» del paso y no
  se dice qué no pudo leer), y cierra esa tarea diciendo que para un «Código» sin IA sigue sin haber regla que niegue.
  La prueba: `packages/agent/test/automation-ai.test.ts` y `apps/server/src/automations/ai.test.ts`.
  Hecho en E1: P29 en `decide` (`byReach`), después de P0, P26, P14 y P2 y antes de la regla de cada origen, con la
  conexión en la llamada (`Call.reach`: la colección, la acción, si es privada, la celda con sus límites, la fila
  como está o como quedaría, sus campos, y lo que el paso llevaba escrito con esa acción). Niega con un motivo:
  `no-reach` (una llamada de un «Agente» a una colección sin conexión puesta), `not-the-action`,
  `private-collection`, `not-connected`, `action-off`, `outside-rows` (también una fila que no está),
  `outside-fields` y `over-limit`. `outsideReach` separa lo que se le dice al modelo (todos menos lo privado) de lo
  que hace fallar la unidad (lo privado, diciendo qué colección; cualquier otra regla, sin decir qué). El motor da a la política la fila y
  la cuenta con cada cambio (`PolicyCall.row`, `written`). Medido: 3.000 decisiones con 3.000 filas como las suyas,
  de 23 a 30 ms. Desde E3 el «Agente» le dice al modelo lo que se le negó, con su prueba en el motor (el «no» de P29
  a una lectura del plan, dicho al modelo; una colección que se hizo privada, `ai.private`); y desde su segundo PR,
  que el «no» a una lectura del código de «Las hace este código» o de una herramienta de código hace fallar la
  unidad, también el de P29.
  Hecho en S1: el servidor pone `byAgent` y `reach` en la llamada (`reachIn`, `apps/server/src/automations/policy.ts`),
  leídos de la versión guardada y de la ejecución: si el paso es un «Agente» lo dice el tipo del paso guardado, nunca
  el de la llamada; su conexión con esa colección (o ninguna), la fila, los campos que pide una lectura antes del
  filtro de la conexión (`PolicyCall.fields`), lo que llevaba escrito, si la colección es privada, sus tipos y el día.
  Una llamada de otra versión o de un paso que la versión no tiene va sin `reach` y se niega (`no-reach`). La prueba
  de la tarea 144 corre sobre el servidor real: la lectura del código de «Las hace este código» a una colección que
  se hizo privada se niega en `decide`, la unidad sigue el «Si falla» del paso y el fallo dice el parámetro, nunca
  qué leía. Para un «Código» sin IA sigue sin haber regla que niegue una lectura (AU-161).
- **AU-206** (F15, en parte) · Las llamadas a modelos de una ejecución se cuentan antes de hacerlas. El motor
  cuenta cada ronda de un «Agente», cada llamada de un lector y cada reintento (AU-59, AU-53, AU-198) contra el
  límite de la ejecución (AU-17: 20, hasta 40), y la que lo pasaría no se hace: la ejecución para con `run.limit`,
  el nombre del límite y los dos números, en una prueba también. Lo que el paso en curso tenía pendiente de guardar
  se tira (AU-174); lo que guardaron los pasos anteriores queda, con el Deshacer de la ejecución. P12 sigue topando el plan de cada ronda (40
  pasos). El límite se ve en «Ajustes» cuando algún paso llama a un modelo, y junto a «Se ejecuta» (AU-55). El
  presupuesto del mes es aparte y sigue (AU-199). La prueba: `packages/automations/src/agent.test.ts`.
  Hecho en E1: `countModelCall` (`engine.ts`) y `StepContext.modelCall`, la cuenta de la ejecución: se llama antes de
  cada llamada, y la que pasaría el límite lanza `LimitPassed` (`run.limit`, con `modelCalls` y los dos números) sin
  hacerse. Hecho en E2: los cuatro lectores la llaman antes de cada llamada, la repetida también, y una ejecución
  llega a `run.limit` por ella (`ai-steps.test.ts`). Hecho en E3: el «Agente» la llama antes de cada ronda y de cada plan pedido otra vez.
  Falta: el límite en «Ajustes» cuando un paso llama a un modelo (P1). Hecho en P1 de la F15: «Ajustes» enseña
  «Llamadas a modelos» cuando un paso llama a un modelo, un «Agente» o un lector, con su valor por defecto y su tope
  (`shownLimits`, `publishing.test.ts`). Falta: verlo junto a «Se ejecuta» (AU-55, P2).
- **AU-230** (F16, en parte) · La F16 no mueve el suelo: cambia quién interpreta, no quién decide. Cada acto de
  una automatización convertida, de una pieza de Boni y de un turno sigue pasando por `decide`, y recibe lo mismo
  que recibía.

  | Quién | Lo que decide hoy | Con la F16 |
  |---|---|---|
  | Un flujo de Juan convertido, en segundo plano | P7: lo que escribe se propone | P28: cada celda de escribir nace en «Preguntar» (decisión 13; `lowerYes` al convertir, también en sus versiones de antes) y propone lo mismo, en una sola tarjeta por ejecución (AU-193). Un «Sí» lo pone después su mano, en un dispositivo personal (AU-188) |
  | Un flujo de Juan convertido, iniciado por él | P5: algunas escrituras iban solas | Pregunta: quién la inicia no cambia lo que guarda (decisión 11). Es lo que la conversión cambia, y lo dice («Lo que cambia», AU-224) |
  | Una pieza de Boni y lo que traen sus automatizaciones | P7, con el origen de su flujo: propone; «Aceptar solas» es lo único que acepta | Igual: sin celdas, sin «Sí» y sin P28 (AU-127) |
  | «Acción de Boni» y «Lector de Boni» en una publicada | P7: las lecturas corren, lo que cambia se propone, salir fuera se niega | Igual. No tienen celda de «Sí», y lo que viene de fuera nunca vale como destino (P14) |
  | El chat de una página | P26 y P27: lee lo de su página; lo que escribe es una tarjeta, salvo un valor suyo | Igual: su «Agente» no tiene «Sí» (AU-137) |
  | Un turno de la conversación | P4, P5, P8 y las demás, con el origen del turno | Igual: el origen lo pone el servidor y nunca es `automation`; una prueba diferencial corre los mismos planes en los dos motores y compara cada llamada a `decide` y su respuesta |
  | Una propuesta de un modelo o del MCP | Inerte hasta que Juan la activa (A-10) | Inerte: un borrador con cada «Sí» bajado, que él publica o no (AU-140, AU-144) |

  El origen es de cada llamada, no de la ejecución: lo pone el servidor leyendo el tipo del paso en la versión
  guardada. Una llamada de un paso de «Boni» lleva el origen de segundo plano de su automatización (P7); la de
  cualquier otro paso, también dentro de una de Boni, lleva `automation` con su celda (P28). Lo que le llega a una
  pieza es dato: otro paso no puede hacerla actuar por él.
  Una colección del sistema sigue sin poder nombrarse en un paso (P9), y un paso de «Boni» no es la manera de
  llegar a ella desde una automatización de Juan: las piezas no se ofrecen fuera de la suya. La fila «Un flujo de
  antes convertido» de AU-188 tiene aquí su caso de prueba, y `automations.create`, `automations.edit` y
  `automations_propose`, el suyo. La prueba: `packages/agent/test/automation-before.test.ts` y
  `apps/server/src/automations/convert.test.ts`.
  Hecho en E1: el traductor escribe cada escritura con «Preguntar» y pasa el documento por `lowerYes`, y las pruebas
  cubren cada camino por el que una celda de lo traducido podría decir «Sí»: un `permission` entre los argumentos del
  plan (se dice como sin sitio, nunca es un parámetro), los argumentos de una pieza o de «Acción de Boni» (datos para
  el código de Boni, sin celda), un turno, un flujo programado, cada versión; y su ejecución propone. Lo que contesta
  el código de Boni llega a la escritura marcado como de fuera (`automation-before.test.ts`). Falta (S1): el puerto
  del servidor, que decide las piezas como el fondo de hoy, y la prueba diferencial de `decide` en los dos motores.
- **AU-183** (F14c, hecho) · El código se analiza sin ejecutarlo, y lo que dice el análisis se cumple. Boni lee
  el código con el mismo lector que la validación y el editor (`readCode`, `javascript.ts`) y sabe cada colección que
  puede cambiar y cómo (crear, modificar, eliminar), esté donde esté la llamada: en un `if`, en un bucle, en una
  función. Al ejecutar, el motor solo acepta una petición si el análisis del código guardado encontró esa colección
  con esa acción; una que llegó de otro modo (lo que un lector no puede seguir) hace fallar el paso y no se guarda
  nada. Lo que el análisis dice es así el máximo de lo que el código puede cambiar: lo lee la persona; la barrera es
  la puerta, que comprueba la conexión y la política en cada petición.
  En la F14c: para que el análisis sea exacto, `$col('Nombre')` solo vale llamado en seguida por uno de sus métodos y
  con su nombre escrito: `$col('Gastos').update(…)`. Guardar `$col('Gastos')` en una variable, pasarlo, devolverlo,
  o llamar a un método por un nombre calculado (`$col('Gastos')[accion](…)`) no pasa la validación
  (`code.colUse`), y el aviso dice cómo: «Llama a `$col('Gastos').update(…)` directamente». Vale igual para leer:
  una sola manera de usar `$col`. El servidor vuelve a leer el código guardado en cada ejecución, nunca se fía de lo
  que diga la caja ni el navegador; la caja recibe con el trabajo lo que el análisis encontró y su `$col` solo tiene
  esos métodos de guardar; y el motor lo comprueba otra vez con cada petición que vuelve. El máximo es por colección y
  acción, no por línea.
  Hecho en W1: `readCode` encuentra cada llamada que pide guardar, esté donde esté (`readWrites` da esa parte),
  `grantsOf` da un par por colección y acción, y `$col` usado de otra forma es `code.colUse`, con su porqué: guardado
  o pasado («kept»), un método por un nombre calculado («computed») o uno que no tiene («unknown»). Hecho en W2: la
  caja recibe con el trabajo lo que el análisis encontró y su `$col` solo tiene esos métodos; el motor rechaza una
  petición que el análisis no vio (`code.write.unseen`); y `code.colUse` y `code.write.notAllowed` están en
  `CODE_PROBLEMS` (A-34).
  Hecho en P1: `code.colUse` (con cada porqué), `code.write.notAllowed` y `code.write.unseen` tienen sus palabras en
  los dos idiomas, con las de los demás problemas y fallos del código (`words.ts`, `words.test.ts`).
- **AU-184** (F14c, hecho) · Las expresiones nunca guardan. En un `{{ }}` no hay `$col` (AU-22, AU-46): una
  expresión que lo usa, para leer o para guardar, no pasa la validación (`code.readInExpression`), y una petición en
  la respuesta de una evaluación de expresiones hace fallar el paso sin guardar nada.
  Hecho en W1: `{{ $col(…) }}` es `code.readInExpression`, para leer y para guardar, y el análisis no le da ninguna
  petición. Hecho en W2: una petición en la respuesta de una evaluación de expresiones hace fallar el paso
  (`code.write.unseen`) sin guardar nada.
- **AU-185** (F14c, hecho) · Lo que guarda un código es un cambio de su paso, como el de un «Colección»: lleva
  la ejecución, la versión y el paso, y la etiqueta de lo que la evaluación recibió (AU-169), así que lo que viene
  de fuera queda en el almacén como de fuera (AU-170); se propone si su celda dice «Preguntar» y se guarda si dice
  «Sí» (decisión 11 del §10, 2026-11-16; hasta entonces lo de fuera se proponía siempre, P4). Lo que evita que una escritura de una
  automatización la vuelva a iniciar (AU-113, F18) vale igual para estas, porque van por el mismo camino; hasta la
  F18 ningún cambio de una colección inicia nada.
  Hecho en W2: cada cambio lleva la versión, el paso y la etiqueta de lo que la evaluación recibió, y con algo de
  fuera se propone.
  Hecho en S1-c: en el almacén de verdad, cada operación del cambio lleva la ejecución en el registro, y un valor de
  fuera queda guardado como de fuera y se lee otra vez de fuera (AU-170): a mano, la política lo deja guardar (P25), y
  no se propone. Falta: la propuesta de P4 sobre el servidor real, que necesita una ejecución que empiece sola (F14d,
  AU-167); lo de AU-113 (F18).
  Desde la decisión 11 (2026-11-16): esa propuesta de P4 ya no es lo que falta. En su lugar, la F14d prueba sobre
  el servidor real que con «Sí» se guarda con su etiqueta y con «Preguntar» se propone, empiece como empiece
  (AU-167, AU-195).
  Hecho en S3 de la F14d: sobre el servidor, con una ejecución a mano y otra a su hora, lo de fuera de un código se
  guarda con su etiqueta con «Sí» y se propone con «Preguntar» (`proposal.test.ts`). Lo de AU-113 es de AU-113 (F18).

Lo que cambia, regla por regla:

| Regla | Hoy | Con esto |
|---|---|---|
| Código libre (`docs/flujos.md` §6, decisión 3) | «Nunca JavaScript libre en un nodo» | JavaScript en la caja, que lee por conexiones y, si la conexión lo permite, pide guardar: lo guarda el motor, solo lo que el análisis del código vio (AU-176, AU-183; Juan, 2026-11-16) |
| P7, segundo plano | Solo lee y propone | Una versión publicada escribe con Deshacer lo que su celda deja con «Sí», también lo de fuera, con su etiqueta (decisiones 5 y 11); el segundo plano de antes sigue proponiendo |
| P4 y P15, lo de fuera | Se propone siempre | Se guarda, con su etiqueta, lo que escribe un paso de una versión publicada con el «Sí» de Juan (P28, decisión 11); en todo lo demás, y para el asistente, como hoy |
| P5, eliminar | Se confirma siempre | Lo que una versión publicada manda a la papelera con el «Sí» de Juan para esa colección no pregunta (AU-186); lo que Juan acepta en la propuesta de una ejecución no se confirma otra vez (AU-193); todo lo demás, como hoy |
| P28 (nueva) y P11 | No hay origen «automatización»; más de 20 escrituras en una ejecución se confirman | Una fila para toda ejecución de una versión publicada, la inicie quien la inicie (AU-167, AU-195), cuyo tope de escrituras es el límite de la ejecución (AU-17) |
| D-44 | Un flujo no ejecuta otro | Llama a otra si esta lo permite; tres niveles, sin ciclos (decisión 3) |
| P26 y P27, el chat de una página | Una lista fija de cinco acciones | Las conexiones del «Agente»; escribir sigue preguntando salvo un valor de su página |
| I-26 | El lienzo se ordena solo; nada se coloca | El sitio se guarda aparte; Boni coloca lo que no tiene sitio (decisión 2) |
| D-52 | «Función» + «Aplicar cambios» | «Código» + «Colección»; lo que va a la Bandeja sigue yendo junto (decisión 4) |

**¿Aguanta?** Lo que puede salir mal, dicho antes:

1. *Las etiquetas por el código son más gruesas.* Lo calculado a partir de una mezcla lleva la peor etiqueta de
   toda la mezcla. Mezclar algo de fuera con lo propio hará que se proponga más de lo estrictamente necesario
   donde lo de fuera se propone: con «Preguntar» en la celda y, fuera de una automatización, siempre. Con «Sí» en
   una versión publicada se guarda (decisión 11 del §10) y queda marcado entero como de fuera. Es el lado seguro,
   y las citas sencillas, que son la mayoría, no lo sufren.
2. *Las rondas del agente son nuevas.* Hoy el modelo que planifica no ve datos entre un plan y otro. Para que «la IA
   decida cómo leer» tiene que ver lo que leyó. Solo verá lo que el código de exposición que ya existe deja ver a
   un planificador, y cada ronda cuenta contra el tope. Es la parte que pide más pruebas de la F15.
3. *El coste de evaluar por fila en la caja.* Miles de filas por una expresión es mucho ir y venir. Se manda por
   tandas y se mide con 3.000 filas antes de salir (AU-38). Si no da, las citas sencillas (que resuelve el servidor
   sin caja) ya cubren lo corriente y el JavaScript queda para «Código».
4. *Que el código pida datos a mitad de camino.* `$col(…)` dentro de la caja necesita que el intérprete espere al
   servidor, y la caja de hoy contesta una vez por petición con un intérprete que no sabe esperar. Primera opción:
   **repetir la evaluación con lo ya leído**. La caja se para en la primera lectura que no tiene (una parada que el
   código no puede atrapar) y dice cuál; el servidor la hace, comprobando la conexión, y vuelve a llamar con lo
   leído. Como el código no tiene reloj ni azar propios (AU-34), repetir da lo mismo. No cambia el intérprete ni
   abre un camino de la caja hacia fuera. Lo que cuesta: una vuelta por cada lectura distinta, así que leer fila a
   fila dentro de un bucle sale caro; hay un tope de lecturas por evaluación y el aviso dice cómo evitarlo («lee la
   colección una vez con `find` y busca en ella»). Si al medir con 3.000 filas no da, la segunda: el intérprete con
   pausas, que espera de verdad a cada lectura a cambio de otra versión del intérprete, más lenta, y de un protocolo
   de ida y vuelta con la caja. Se mide al empezar la F14c.
5. *El tamaño.* El editor de hoy son unas 7.000 líneas y el motor unas 18.000. Se rehace el editor entero y, del
   motor, el reparto de pasos y el modelo de datos; el camino vigilado de cada llamada (política, etiquetas,
   diario) se reutiliza. Los dos motores conviven de la F14 a la F16; si la F16 se alarga, conviven más tiempo.

## 7. Qué cambia en el código (cuando toque)

- **`packages/automations`** (nuevo): el formato y su validación, el grafo, el núcleo puro del motor (qué paso se
  decide, con los efectos inyectados), el catálogo de tipos de paso (parámetros, «por fila» o «con todas», si lee o
  escribe) y el análisis de lo que cita una expresión.
- **`packages/sandbox` y `apps/sandbox`**: protocolo 2: evaluar expresiones y código por tandas de filas, las
  lecturas `$col` que la caja pide y el servidor hace (riesgo 4 del §6), la consola recogida, `$now` y el azar
  fijados por ejecución.
- **`apps/server/src/automations/`**: las tablas (`automations`, `automation_drafts`, `automation_layout`,
  `automation_tests`, `automation_test_rows`, `automation_pins`, `automation_runs`, `automation_steps`, en el almacén
  del usuario: D-02), las rutas (todas en `routes.ts` y en la lista de acciones), el que ejecuta (política, diario,
  lectores, caja), los disparadores, el planificador de horas y la conversión de los flujos de antes.
  La F14b trae las cinco primeras tablas (`packages/store/src/automations.ts`: la automatización, su borrador con su
  `rev`, el sitio de sus cajas y la última prueba de cada paso, con sus filas aparte y de 50 en 50), las rutas del
  borrador y de probar (`automations/routes.ts`, cada una con su acción), las `Collections` de verdad sobre el
  almacén y la `Policy` de verdad sobre `decide`. Nada de ello pasa por el registro de operaciones: el borrador lo
  deshace el editor (AU-68), «Eliminar» se deshace desde su aviso (AU-62) y una prueba no escribe (AU-90).
  La F14d trae las demás (`automation_versions`, `automation_runs`, `automation_steps` con sus filas aparte,
  `automation_pins`) y, en `automations`, cuál versión corre, si está encendida y sus horas; tampoco pasan por el
  registro de operaciones, por el que sí pasa todo lo que una ejecución escribe en las colecciones, con su
  ejecución (AU-18). Sus rutas, todas bajo `/api/agent/automations/:id` y cada una con su acción: `publish` (leer lo
  que enseña «Publicar», y publicar), `versions` (la lista, una, volver a una), `enabled`, `run`, `runs` (la lista,
  una, las filas de un paso, deshacerla, reintentarla), `pins` y, en la lista, las eliminadas. Lo puro está en
  `packages/automations` (`versions.ts`: `diffAutomations`, `publishChecks`, `abilities`; `AUTOMATION_LIMITS` y su
  comprobación en el motor; `lowerYes`); el planificador usa `dueSlot` y `graceOf` de `flowScheduler.ts` (la segunda
  hoy no se exporta: pasa a exportarse).
- **`packages/agent`**: `decide` conoce el origen «automatización» y comprueba la conexión; el camino vigilado de
  una llamada queda disponible para los pasos; las rondas del «Agente»; en la F16, la traducción de un plan a pasos.
  En la F14d: el origen `automation` y su fila P28 (AU-167), y la llamada que dice si la versión publicada lleva el
  «Sí» de esa colección y esa acción (AU-186, decisión 11 del §10). La conexión la sigue comprobando el motor (AU-176) hasta que el «Agente» la necesite
  en `decide` (F15).
- **`packages/views`**: el filtro (`FilterItem`) admite una expresión como valor y es el modelo de condiciones de
  todos los pasos; los bloques de página ganan nombre, eventos y «De una automatización».
- **`apps/boni-web/src/automations/`**: la lista, el lienzo (con `@xyflow/react`, que ya está), el panel de añadir,
  la vista del paso, las ejecuciones. El editor de código es CodeMirror 6 (nuevo, MIT).
  La F14b pone ahí la lógica sin pantalla (el estado del editor, los cambios del grafo, el sitio de las cajas, las
  citas, las filas del panel y las palabras) y, encima, sus componentes. La app importa `@boni/automations`: el
  catálogo y la validación son el mismo código en la app y en el servidor. De lo de hoy se extiende la página de la
  colección «Flujos» (la lista y su mapa: `FlowsView.tsx`, `FlowMap.tsx`) y se reutilizan el filtro de las vistas
  (AU-81), el panel lateral, los menús y `@xyflow/react`; el editor de hoy se queda, sin tocar, para los flujos de
  antes (AU-151).
- **Fuera en la F16**: `FlowEditor.tsx`, `FlowStepPanel.tsx`, `ExprField.tsx`, `flowLayout.ts`, `flowEdit.ts` y el
  intérprete de listas para lo guardado. `FlowMap.tsx` se adapta: el mapa se queda.
- **Las apps**: las rutas nuevas entran en `Net.kt` de Android y en `paths.cjs` del escritorio. Las de la F14b
  están bajo `/api/agent/automations`, que los dos ya dejan pasar: no cambian.
- **En la F15** (los nombres son propuestas; el constructor los cambia si el código pide otros y lo dice en su PR):
  - `packages/automations`: los tipos de paso nuevos en el catálogo («Agente», los cuatro lectores, «Preguntar»,
    «Avisar», «Responder»); el `limit` de cada acción de escribir y los límites de AU-48 en `insideConnection`; las
    llamadas a modelos contadas en el motor; la ejecución que espera y sigue; `byAgent` en `abilities`. El motor
    llama a los modelos por un puerto que recibe (`RunDeps.ai`: planificar una ronda, llamar a un lector), así que
    este paquete sigue sin importar ningún proveedor (A-02) y sus pruebas corren con un modelo de guion.
  - `packages/agent`: las rondas (`rounds.ts`), sobre `validatePlan`, `checkPlan`, `toPlannerView` y los lectores;
    en `decide`, la tabla de AU-204 en `byAutomation` y P29 (AU-205), con la conexión puesta en la llamada por el
    servidor, leída de la versión guardada, como hoy va el `scope` del chat (P26).
  - `apps/server`: `modelChoices(cuenta, uso)` en `models.ts`, de la que `plannerChoices` pasa a ser un caso;
    `automations/ai.ts` (el puerto de verdad: proveedores, presupuesto, la conexión y el «Sí» leídos de la versión
    guardada); las ejecuciones que esperan (su estado, lo que guardan, el límite de espera en el planificador de
    horas) y sus tarjetas, sobre `proposals`; `automations/learning.ts` (las señales, la cuenta, la sugerencia y la
    pausa), sobre las decisiones que ya guarda `docs/fiabilidad.md`; y la prueba de la tarea 144 (AU-161, AU-205),
    que se cierra con ese PR.
  - `apps/boni-web/src/automations/`: la vista del «Agente» (la tabla de conexiones de siempre, con sus límites por
    acción), «Modelo», «Lo que hizo», las vistas de los otros pasos, «Esperando» en «Ejecuciones» y la cuenta bajo la
    celda; en la Bandeja, la tarjeta de «Preguntar». Las rutas siguen bajo `/api/agent/automations`: `Net.kt` y
    `paths.cjs` no cambian, salvo que contestar una pregunta pida una ruta de la Bandeja que no exista.
- **En la F16** (los nombres son propuestas; el constructor los cambia si el código pide otros y lo dice en su PR):
  - `packages/agent`: `planToAutomation` (un plan y su disparador a un documento, con la tabla de AU-223, sin
    importar `@boni/automations` más que por su formato); `turn`, `dryRun` y `background` como entradas que traducen
    y llaman al motor nuevo por un puerto; la prueba diferencial de `decide` (AU-230). `validatePlan`, `checkPlan`,
    los lectores y `rounds.ts` no cambian.
  - `packages/automations`: la categoría «Boni» en el catálogo (las piezas, «Acción de Boni», «Lector de Boni»), los
    disparadores de AU-220 y «Mensaje de chat», «Se ve como» en «Responder» y las respuestas nuevas de «Preguntar».
    El motor llama a lo de Boni por un puerto que recibe (`RunDeps.boni`), como a los modelos: el paquete sigue sin
    importar ninguna app (A-02) y sus pruebas corren con un puerto de guion.
  - `packages/store`: una migración que convierte (`flows` y `flow_drafts` a `automations`, `automation_versions`
    y `automation_drafts`, con el autor y la marca «Convertida») y otra, por tandas, para las filas «De antes» de
    `automation_runs`. Ninguna borra.
  - `apps/server`: `automations/convert.ts` (la conversión y su informe en seco), `automations/boni.ts` (el puerto
    de verdad sobre `pieces.ts` y `mail.ts`, las cuatro de Boni y sus versiones), `automations/chat.ts` (el chat de
    página sobre `pageChat.ts`); `mail.ts`, `learning.ts`, `models.ts`, `buttons.ts` y `agent.ts` pasan a
    `runPublished`; `mcp.ts` gana `automations_*` y deja `flows_*` como alias; al final se van `flowScheduler.ts`,
    el catálogo de `flows.ts` y sus rutas.
  - `apps/boni-web`: los pasos de «Boni» en el lienzo (su panel, «De: Boni», «Volver al de Boni»), el aviso de la
    conversión con «Lo que cambia», «Convertida» en «Versiones», «Volver al flujo de antes», el panel del bloque
    «Chat» y la tarjeta de una propuesta de automatización en la conversación; al final se va el editor de antes.
    Cada PR que la toca lleva su versión de escritorio (I-05).
  - `apps/boni-android` y `apps/boni-desktop`: `Net.kt` y `paths.cjs` no cambian (ya dejan pasar `api/agent` entero;
  AU-229).

## 8. Fases

Cada fase es una tarea de la cola, con una sesión propia en su árbol de trabajo. El primer PR de cada fase trae una
prueba pendiente por cada punto AU suyo (tarea 66, medida B), y antes de darla por hecha un agente que no la
construyó compara el §5 con el cambio, punto por punto (`docs/agents/conformance.md`). Juan, 2026-11-15: para estas
sesiones vale Fable o mucho esfuerzo; se usa Fable para abrir cada fase y para lo difícil, y Opus alto para construir.

El estado de cada fase está en la columna «Estado» de la tabla (pendiente, en curso desde su primer PR, en main,
hecha) y el de cada punto, en su etiqueta: `(F14a, pendiente)`, y después `en parte` (el punto dice qué falta),
`hecho` o `descartado` (dice por qué). `make check` los compara con las pruebas (T-10, `scripts/design-rules.mjs`):
un punto «hecho» o «en parte» sin una prueba que corra con su número en el nombre falla, una fase «en main» o
«hecha» con un punto «pendiente» falla, y una fase «en curso» con un punto sin prueba, pendiente o no, también.
`make rules` dice lo que queda de cada fase.

| Fase | Qué | Criterio de hecho (lo que verá Juan) | Estado |
|---|---|---|---|
| Antes | El resumen de la mañana que falla: el lector reintenta con la entrada acortada (AU-59, en el motor de hoy) | El resumen llega tres mañanas seguidas | en main |
| **F14a** El motor | El formato, la validación, el motor de filas, las citas sencillas, el disparador «Disparado por el usuario» y los pasos de Datos, Transformar y Lógica, con sus pruebas. Sin pantalla | Nada en la app. Una automatización con solo esos pasos («Disparado por el usuario» → «Buscar gastos» → «Agrupar» por categoría → «Si» → «Crear una fila») corre en una prueba con 3.000 filas, dos veces igual, con sus tiempos medidos | en main |
| **F14b** El lienzo | La sección «Automatizaciones», el lienzo, añadir un paso, la vista del paso, citar un campo arrastrándolo, «Probar» y «Probar paso», el borrador que se guarda solo, el sitio de las cajas | Crea «Buscar gastos» → «Filtrar» → «Si» arrastrando, abre cada paso, ve lo que entra y sale, y ningún paso le enseña más de siete cosas. Aún no se publica nada: sus flujos de hoy siguen corriendo como están | en main |
| **F14c** JavaScript | JavaScript en las expresiones, «Código», conexiones con sus límites, «Consola»; el código que guarda por su conexión, con su análisis (Juan, 2026-11-16) | Escribe el código del §5.4, lo prueba y ve su `console.log`; citar una colección sin conectar le dice cómo arreglarlo; un código que guarda lo dice en su tarjeta y en su conexión, «Probar» enseña lo que guardaría, y sin permiso le dice cómo arreglarlo | en main |
| **F14d** Publicar | Publicar y versiones, encender y «Ejecutar», «Ejecuciones», «Fijar», «Programada», los ajustes y topes de la automatización, la regla de segundo plano para lo que no es de modelo | Publica una programada que crea una fila cada mañana, la ve en «Ejecuciones» y la deshace desde ahí. Desde la F14c: «Publicar» dice lo que cada «Código» puede cambiar antes de que corra solo, y lo que pide con «Preguntar» llega a la Bandeja como una propuesta (AU-174, AU-182). Desde el 2026-11-16: lo que no pregunta (AU-186, que cambia la fila P5 para una automatización), «Eliminar filas» con «Sí» (AU-187), un «Sí» solo de su mano (AU-188) y «sin preguntar» en «Lo que podrá hacer» (AU-189). Desde su diseño (tarea 128): quién inicia una ejecución y con qué origen (AU-195), la propuesta de una ejecución (AU-193), el interruptor (AU-194), una eliminada se recupera (AU-191), una interrumpida no se repite sola (AU-190) y cambiar el nombre de una colección no rompe lo publicado (AU-192). Desde la decisión 11 (2026-11-16): quién la inicia no cambia lo que guarda, y con «Sí» guarda también lo que viene de fuera, con su etiqueta (AU-186, AU-167, AU-195, AU-170) Salvo, en la cola (la revisión de la fase, P3b-2): con el límite subido, 3.000 filas en una transacción y su deshacer (AU-17, AU-18, tarea 137); las lecturas y la «Consola» de un «Código» en el árbol del «Registro» (AU-101); que el aviso del teléfono abra su ejecución (AU-102); la prueba de que una eliminada no corre a su hora ni entra en el mapa (AU-191); `alwaysConfirm` del acto de tirar (AU-186) | en main |
| **F15** La IA | «Agente» con conexiones y límites, los otros pasos de IA, «Preguntar», «Avisar», «Responder» | Monta el «Analista» del ejemplo: lee Gastos y Categorías, propone una nota; quitarle «Leer» de Gastos hace que diga que no puede; ve cada lectura en el registro. Desde la F14c: el código dentro de un paso de IA («Las hace este código», «Herramientas de código»: AU-51, AU-58) tiene los mismos permisos y el mismo análisis que un «Código» (AU-176, AU-183); los límites de cada acción (AU-48) valen para los dos. Desde el 2026-11-16: la tabla del «Agente» es la de «Código», y eliminar también puede ser «Sí» (AU-41, AU-186); Juan lo limita con las celdas, los límites de la conexión y los de cada acción. La F15 abre con el diseño de lo que Boni aprende de sus respuestas, fuera de las automatizaciones (decisión 10 del §10). Desde su diseño (tarea 129): lo que guarda un paso de IA es la tabla de AU-204, y un «Agente» con «Sí» guarda también lo que modifica o elimina con algo de fuera, dentro de su conexión y de «Como mucho» (decisión 16); la conexión de un paso de IA la comprueba también la política (AU-205), con la prueba de la tarea 144; las llamadas a modelos se cuentan (AU-206); un «Preguntar» espera en la Bandeja sin parar las ejecuciones siguientes (AU-203); y lo que Boni aprende es el §5.15: cuenta, sugiere y vuelve a preguntar, y nunca pone un «Sí» | en curso |
| **F16** Lo de antes | Sus flujos y los de Boni convertidos; el chat de página como automatización; el editor y el motor viejos, fuera; el MCP | «Leer correo» abre en el lienzo nuevo con sus piezas y sigue leyendo el correo igual; no queda ningún «formato anterior». Desde su diseño (tarea 130): cada cosa del lenguaje de planes tiene su paso (AU-223) y convertida hace lo mismo (AU-224); la conversión pasa una vez, se ve en un aviso con «Lo que cambia» y se vuelve atrás por automatización mientras el motor de antes existe (AU-225); lo que escribía un flujo nace en «Preguntar» (AU-230, decisión 13); las cuatro de Boni son automatizaciones «De: Boni» con sus piezas como pasos (AU-127, AU-221); el turno corre en el motor nuevo con las mismas decisiones (AU-143); el motor y el editor de antes se quitan los últimos (AU-228, AU-152); y el revisor que necesita un modelo entra aquí (AU-211) | en curso |
| **F17** Páginas | Nombres de bloques, eventos, quién puede iniciarla («Páginas»), pasos de «Página», bloques con datos de una automatización, el menú de fila | En una página, un botón «Calcular» toma el mes y la categoría de dos controles y pinta una gráfica con lo que calcula una automatización; otro, «Explicar», se los pasa a un «Agente» y su respuesta sale en un texto de la página | pendiente |
| **F18** Más maneras | «Cuando cambia una colección» con sus topes, «Al subir un archivo», «Falla una automatización», «Llamar automatización», «Esperar», «Por tandas» | Los dos ejemplos de la tarea 88: el aviso por un movimiento grande llega una vez, y marcar hecha una tarea que se repite crea la siguiente con Deshacer; un ciclo no se puede publicar | pendiente |
| **F19** Lo demás | Paquetes (tarea 89), «Pedir a Boni», «Escribir con IA», plantillas, funciones guardadas | Pide en el editor «añade un aviso si se pasa del presupuesto» y acepta el cambio marcado paso a paso | pendiente |
| **FM** Modelos | «Modelos» sin usos (§5.16): una lista de modelos cargados, etiquetas, «De la cuenta», una evaluación por modelo, el «Modelo» de un paso con un modelo o una etiqueta, y el cambio desde los cuatro usos sin perder nada | En Ajustes → Modelos ve sus modelos de hoy en una lista, sin usos; pone «Barato» a dos, la elige en un «Clasificar» y «Lo que hizo» dice cuál contestó; su chat y sus automatizaciones siguen con el mismo modelo que antes | en curso |

El lienzo (F14b) se enseña a Juan en cuanto se puede tocar, antes de seguir: si la forma no le vale, se cambia ahí y
no cuatro fases después.

Lo que sale fuera (peticiones HTTP, webhooks, credenciales, enviar un correo) no está en estas fases (decisión 9 del
§10): irá después, en una fase propia (F20), con su diseño antes.

Las tareas de la cola (2026-11-15): «Antes» es la 124; la F14a, la 125; la F14b, la 126; la F14c, la 127; la F14d,
la 128; la F15, la 129; la F16, la 130; la F17, lo abierto de la 87; la F18, la 88; la F19, la 89.

La FM (2026-11-18) se diseñó en la tarea 154 y no sigue el orden de las otras: su primer PR (M1, §5.16) tiene que
estar en `main` antes de la conversión de la F16, y el segundo, antes de su despliegue.

## 9. La cola, adaptada

Decidido por Juan el 2026-11-15 (decisión 8 del §10) y aplicado a la cola ese día.

| Tarea | Qué le pasa |
|---|---|
| **103** La explicación de los flujos | Se cierra con este documento. Sus decisiones: la 1 la decide el mensaje de Juan; la 2 es la decisión 5 de aquí; la 3 queda en 3a (AU-127); la 4 es el «Antes» del §8; la 5 y la 7 son este apartado; la 6 (los destinos de la Decisora) es la decisión 20 de aquí |
| **61** Flujos F1–F6 | Se cierra: lo sustituyen la F14 y la F16. Lo que no se probó con sus datos (el resumen de las 8) va en «Antes» |
| **70** El editor con control | Se cierra. Lo abierto pasa a la F14b: el «+» en una flecha (AU-65), los valores de salida tras probar (AU-72) |
| **63** Lo que los diseños piden y no está | Cinco puntos suyos pasan a las fases: el 3 (los valores de salida tras «Probar») y el 4 («+» en una flecha), a la F14b; el 11 (código propio como paso), a la F14c; el 13 (probar por el MCP), a la F16; el 14 (en el teléfono, ver y ejecutar), a la F14b y la F14d. Se queda abierta solo con el 8 (proponer «Solo») y el 17 (la tarjeta «¿Lo recuerdo?»), que no son de automatizaciones |
| **83** Lo de Boni, a la vista | Se cierra. Lo abierto pasa a la F15 (preguntas por paso, la Bandeja como paso) y a la F16 (comparar con la versión que corre, «Conversación» como automatización, la flecha «avisa»). Sus dos fallos (una prueba titulada «Ejecución»; la columna «Disparador» sin traducir) mueren con AU-99 y AU-61 |
| **93** El paso «Función» | Se cierra: «Código» + «Colección» (F14c). La colección «Funciones» y sus pruebas guardadas pasan a la F19; contestar preguntas, a la F15; la tarjeta al subir un extracto, a la F18 |
| **88** Disparadores por cambios | Es la F18, con su criterio y sus topes |
| **89** Paquetes | Es la F19: un paquete lleva automatizaciones, colecciones, páginas y funciones |
| **87** Páginas conectadas | Lo hecho se queda. Lo abierto es la F17, con su criterio ampliado |
| **95** Una lista de acciones | Sigue, más pequeña: las rutas de flujos y `press` se rehacen en F14–F17 ya dentro de la lista (AU-19, AU-168); le quedan las de páginas, Bandeja, esquema, correo y extensiones |
| **104** Resaltar lo que cambió una escritura | Sigue, después de la F15: cada ejecución ya sabe qué filas tocó (AU-18), que es lo que le faltaba |
| **11** El Diseñador de páginas | Se aplaza a después de la F17 y se reescribe: será un «Agente» con los pasos de «Página» |
| **66** Diseños con puntos numerados | Sale del bloque. Este diseño ya está escrito así; la comprobación en `make check` se construye con la F14a |
| **94**, **81**, **4b** | No son de este bloque. «Traer del banco» (4b) será una automatización de un paquete cuando toque; como sale fuera, espera a la F20 (decisión 9) |

Tareas nuevas (2026-11-15), cada una con su criterio del §8 en la primera línea: la 124 («Antes») y las 125 a 130
(F14a, F14b, F14c, F14d, F15 y F16). La F17 es lo abierto de la 87; la F18, la 88; la F19, la 89.

**Orden**: «Antes» → F14a → F14b (Juan prueba el lienzo) → F14c → F14d → F15 → F16 → F17 → F18 → F19.

## 10. Decisiones de Juan

**Decididas el 2026-11-15: «Sí, las recomendadas».** En las nueve vale la recomendada; la otra se queda escrita para
que conste lo que se descartó.

Cada una con lo que vería al final. Las cinco primeras deshacen o cambian algo que ya decidió.

1. **JavaScript libre.** El 2026-11-05 decidió que el código solo entraba como funciones de extensión («nunca
   JavaScript libre en un nodo»). Su mensaje pide lo contrario, así que se da por decidido; va aquí para que conste.
   - Recomendada: **sí, en la caja**. En cualquier parámetro, `{{ $json.importe * 1.21 }}`; en un paso «Código»,
     el ejemplo del §5.4. ~~No puede escribir~~ ni salir a la red, y lo que calcula hereda de dónde vienen sus datos.
   - La otra: solo pasos visuales y funciones cerradas. Sumar los gastos por categoría sería un paso «Agrupar»; lo
     que no tenga paso no se puede hacer.
   - **Cambiada por Juan el 2026-11-16**: «Si, puede cambiarlas pero solo si la conexion con la coleccion tiene
     permiso para ello. Ademas, si el codigo puede modificar los datos originales de alguna forma, la interfaz
     deberia indiciarlo claramente». Sigue sin red y sin ficheros, y la caja sigue sin camino al almacén; lo que
     cambia es que un «Código» puede **pedir** guardar por una conexión que le da permiso, y el motor lo guarda con la
     política (AU-172 a AU-185). Las expresiones `{{ }}` siguen sin guardar nada (AU-184).

2. **El sitio de las cajas.** El 2026-11-05 pidió que el lienzo se ordenara solo y nada se guardara, porque «Leer
   correo» se abría amontonado y mover una caja encendía «Guardar».
   - Recomendada: **se colocan a mano y se guardan aparte**. Arrastra una caja y se queda; no enciende «Publicar»
     ni hace versión; una caja nueva la coloca Boni; «Ordenar» lo recoloca todo. Como n8n, sin sus dos molestias.
   - La otra: como hoy, siempre ordenado solo. No se puede poner un paso donde se quiere ni agrupar a ojo.

3. **Una automatización llama a otra.** El 2026-11-05 eligió que un flujo no ejecutara otro (D-44).
   - Recomendada: **sí, si la llamada lo permite**. «Sumar gastos del mes» marca «La pueden iniciar: otras
     automatizaciones»; «Resumen semanal» y el botón «Calcular» la usan las dos. Tres niveles como mucho, sin ciclos.
   - La otra: no. Lo común se copia en cada automatización y se cambia en cada sitio.

4. **El código devuelve filas y los pasos «Colección» escriben.** El 2026-11-06 eligió para «Función» la opción A
   (sus cambios, juntos a la Bandeja) frente a la B (devolver un valor y escribir con pasos).
   - Recomendada: **la forma de la B con lo que quería de la A**. El código de «Importar extracto» devuelve 40 filas;
     un paso «Crear filas en Movimientos» las escribe. Como vienen de un fichero, van a la Bandeja como una sola
     propuesta: «Esta ejecución quiere crear 40 filas en Movimientos», se acepta o no entera.
   - La otra: mantener «Función» + «Aplicar cambios» como un paso especial que no se parece a los demás.
   - **Cambiada por Juan el 2026-11-16**, preguntado si el código debía poder guardar en sus colecciones él mismo
     (`$col('Gastos').update(row.id, { total })` por una conexión que deja modificar): «Si, que guarde. A parte de
     que en la conexion se vea claramente si puede modificar o no, el codigo debe ser analizado para ver si
     potencialmente puede modificar.» Devolver filas para un paso «Colección» sigue valiendo; además el código puede
     pedir crear, modificar o eliminar por su conexión. Lo de la A que quería se queda: lo que pide un paso se
     guarda junto o no se guarda (AU-174), y si hay que preguntar, va a la Bandeja como una sola propuesta. Lo nuevo
     que no estaba en ninguna de las dos: Boni lee el código sin ejecutarlo y sabe qué puede cambiar (AU-183), lo
     dice en la tarjeta y en la conexión (AU-178 a AU-180), y lo que el análisis no vio no se guarda.
   - **Decidido por Juan el 2026-11-16**, preguntado si un paso que modifica 12 filas con «Sí» y elimina 1 con
     «Preguntar» debía esperar entero: «todo junto». AU-174 se queda como está, ahora por su palabra.

5. **Lo que una automatización escribe sola en segundo plano** (programada o por un cambio). Hoy, nada: todo se
   propone. El 2026-11-05 eligió que lo disparado por sus propios datos escribiera con Deshacer; la tarea 103 lo
   reabrió.
   - Recomendada: **según de dónde venga el dato, y solo de una versión que él publicó**. Todo propio y calculado por
     código: escribe con Deshacer y un aviso por ejecución («Tarea repetida creó 1 fila en Tareas · Deshacer»).
     Decidido por un modelo a partir de datos propios: solo si esa conexión dice «Sí»; si no, a la Bandeja.
     ~~Con algo de fuera (un correo, una web): siempre a la Bandeja.~~ Enviar, ~~eliminar~~ o lo irreversible:
     nunca solo.
   - La otra: todo a la Bandeja, como hoy. «Crear la tarea de la semana siguiente» esperaría cada vez a que la
     acepte.
   - **Cambiada por Juan el 2026-11-16** (eliminar): «entiendo que la conexion entre la coleccion y el codigo tiene
     varios tipos de permisos.: leer, modificar, eliminar. la logica de "no", "si", "preguntar" deberia ser la
     misma para modificar y eliminar, por separado.» Y del «Agente»: «Creo que el sistema deberia permitir que los
     agentes sean capaces de eliminar modificar o crear de forma autonoma, es responsabilidad del usuario limitarlo
     si no quiere arriesgar». Mandar a la papelera con el «Sí» de su mano en esa colección, en una versión publicada
     ~~y sin nada de fuera~~, va solo y se deshace con la ejecución (AU-186 a AU-188), sea un «Código», un «Colección»
     o un «Agente». Enviar y lo irreversible siguen sin ir nunca solos, y borrar para siempre no existe en una
     automatización. Antes eliminar era solo «No» o «Preguntar», y un código que eliminaba preguntaba siempre.
   - **Cambiada por Juan el 2026-11-16** (lo de fuera): la frase «Con algo de fuera (un correo, una web): siempre
     a la Bandeja» ya no vale para una versión publicada con su «Sí», y tampoco «sin nada de fuera» en el punto
     anterior (las dos, tachadas arriba): lo dice la decisión 11.

6. **Probar no escribe.** En n8n, ejecutar el borrador envía y escribe de verdad.
   - Recomendada: **como hoy en Boni**. «Probar» lee, calcula y llama a los modelos, y enseña «Haría esto: crear 1
     fila en Notas». Para que escriba se publica y se ejecuta.
   - La otra: como n8n. «Probar» crearía la nota de verdad cada vez (se podría deshacer).

7. **Arreglar ya el resumen de la mañana** (decisión 4 de la tarea 103), en el motor de hoy, sin esperar a la F16.
   - Recomendada: **sí**, es un cambio pequeño y falla cada pocos días.
   - La otra: esperar a que la F16 lo convierta.

8. **La cola y el orden** del §9.
   - Recomendada: **cerrar 103, 61, 70, 83 y 93, y seguir el orden del §9**.
   - La otra: hacer antes las páginas (F17) que la IA (F15): el botón «Calcular» llegaría antes y el «Analista»
     después.

9. **Salir fuera: peticiones HTTP, webhooks, credenciales y enviar un correo.** Es mucho de lo que se hace con n8n,
   y este diseño lo deja fuera de las seis fases (§3.3, AU-128): todo lo anterior trabaja con sus colecciones, sus
   páginas y la IA.
   - Recomendada: **después, en una fase propia (F20) con su diseño**. Hasta entonces lo de fuera entra por lo que
     Boni ya trae (el correo, un archivo que sube) y una automatización solo sale con avisos a él. «Cuando llega el
     correo de la factura de la luz, proponer su importe como una fila de Gastos» se monta en estas fases, porque
     ese correo ya entra en Boni; «Cada mañana, pedir a una web el precio de la luz» espera a la F20, y contestar a
     ese correo desde una automatización, también. Cuando llegue: un paso «Petición HTTP» cuyo destino escribe él y
     no puede salir de un dato ni de un modelo, lo que devuelve cuenta como de fuera, y las claves se guardan en el
     servidor sin que el código ni un modelo las vean.
   - La otra: **dentro de este bloque**, junto a la F18. «Cada mañana, pedir a una web el precio de la luz y
     guardarlo en una colección» se podría montar sin esperar a esa fase. A cambio, es la pieza por la que un dato
     puede salir de Boni, y se construiría antes de haber probado con sus datos las conexiones y la regla de segundo
     plano.

Menores; no dijo nada de ellas, así que van así: los nombres del código son los de n8n (`$json`, `$input`, `$now`) y
los datos conservan sus nombres en español; «Publicar» sustituye a «Guardar»; lo que pasa por una flecha se llama
«fila»; en el teléfono las automatizaciones se ven y se ejecutan, no se editan, como hoy (AU-74).

**Decidida el 2026-11-16.**

10. **Aprender de lo que contesta, fuera de las automatizaciones.** Preguntado si aprender de sus respuestas
    vive aparte de cada automatización: «Si, lo recomendado, las automatizaciones solo cumplen con su funcion, la
    logica de aprender va fuera». Una automatización hace lo que es para y nunca se cambia a sí misma. Lo que Boni
    aprende de sus respuestas (aceptar, rechazar o corregir una propuesta, deshacer, un botón) lo junta Boni, no
    cada automatización, y lo que cambie se propone a la vista: lo que sabe un agente (`docs/preferencias.md`),
    cuánto hace solo (`docs/fiabilidad.md`) o una versión nueva de la automatización. Su diseño, con sus reglas y
    sus pruebas, abre la F15 (§8).

11. **Quién inicia una ejecución no cambia lo que guarda; con «Sí», también lo que viene de fuera.** Hasta aquí,
    con «Sí» en la celda, una ejecución que iniciaba su mano guardaba todo (P25) y una que empezaba sola proponía
    lo que llevara algo de fuera (decisión 5): una automatización que empezara con un correo no guardaba sola
    nunca, dijera lo que dijera la celda.
    - Lo que preguntó antes: «por que se deberia comportar diferente el flujo si lo lanzo yo o por el trigger del
      correo? creo que ese cambio en el comportamiento deberia ser algo marcado por el flujo, si el flujo tiene
      puesto diferentes salidas en base a como se genere, pues si, ya sea con una variable interna del flujo o
      algo.»
    - La pregunta que se le hizo: «Con «Sí» en la conexión, ¿un flujo que empieza solo guarda también lo que viene
      de un correo?», con dos respuestas, «Sí, que guarde» y «No, que pregunte».
    - **Juan, 2026-11-16: «Sí, que guarde».**
    - Lo que decide: lo que guarda una automatización publicada no depende de quién la inicie; decide la celda.
      «Preguntar» propone en los dos casos. «Sí» guarda en los dos, también lo que viene de fuera, marcado como de
      fuera y deshecho con la ejecución. Vale para crear, modificar y mandar a la papelera (AU-186, AU-167,
      AU-195). La automatización que quiera hacer cosas distintas según cómo empezó lo dice ella: un «Si» sobre
      `$run`, o una rama por disparador.
    - Lo que no cambia, diga lo que diga la automatización: un «Sí» solo lo pone su mano (AU-188); lo de fuera
      nunca escribe lo que Boni sabe de él (P9); a quién o adónde se envía algo nunca sale de un dato de fuera ni
      de un modelo (P2, P14); enviar y pagar nunca van solos (fuera de una automatización se confirman, P5;
      dentro de una no existen en estas fases y `decide` los niega, AU-167); no hay borrado definitivo (AU-122);
      «Probar» nunca guarda; los límites de la ejecución (AU-17). El asistente en un chat sigue con P4 tal cual.
    - El coste, que se le dijo: con «Sí» en «Eliminar» en un «Agente» que lee correo, un correo malicioso puede
      conseguir que filas de esa colección vayan a la papelera sin su toque (se recuperan con Deshacer); en una
      automatización sin modelo, si el contenido del correo elige qué filas se tocan, las elige quien lo escribe.
      Lo ve una vez, en «Publicar» («Lo que podrá hacer», AU-182), y no en cada ejecución.

12. **Cinco puntos de «Publicar» (F14d), como se recomendaban.** El diseño de la fase (tarea 128) los dejó como
    propuestas. La pregunta que se le hizo: «¿Aceptas las cinco recomendaciones del diseño de «Publicar»
    (F14d)?». **Juan, 2026-11-16: «Sí, las recomendadas».** Cada una, con la otra respuesta que había y el PR de la
    construcción que trae su prueba en marcha y, con ella, su fila en `docs/principios.md`:
    - **Una ejecución que el servidor cortó al apagarse no se repite sola** (AU-190). Queda «Interrumpida» con el
      paso en que estaba, avisa una vez si empezó sola, lo que guardó se queda y se deshace desde ella, y
      «Reintentar» es su toque. La otra: repetirla al arrancar, que crearía dos veces la fila que ya había
      guardado. Prueba: `runs.test.ts` («AU-190 · a server that starts with a run still marked as running…»), en
      el PR del servidor que trae las ejecuciones.
    - **«Volver a esta» publica una versión nueva y no toca el borrador** (AU-98). Volver a la 2 desde la 4 hace la
      5 con el documento de la 2; el borrador se queda con lo último que escribió y dice «cambios sin publicar».
      La otra: que el borrador pasara a ser también el de la 2 y lo que tenía a medias se perdiera. Prueba:
      `publish.test.ts` (AU-98), en el PR del servidor que trae publicar y las versiones.
    - **Publicar por primera vez la enciende, y la pantalla lo dice antes** (AU-194). Publicada a las 07:50, corre
      a las 08:00. La otra: publicada y apagada hasta que él mueva el interruptor. Prueba: `publish.test.ts`
      (AU-194), en el mismo PR.
    - **Al móvil solo llega un fallo, una vez por racha** (AU-102). Lo que una ejecución guardó sola se ve en la
      app, en su línea con «Deshacer» (AU-167). La otra: un aviso en el móvil por cada ejecución que guarda,
      veinticuatro al día de una «Cada hora». Prueba: `scheduler.test.ts` (AU-102, AU-167), en el PR del servidor
      que trae los avisos. Sin comprobar en el código: que `notify` pueda avisar en la app sin avisar en el móvil;
      el constructor lo mira primero y, si no se puede, lo dice antes de construirlo.
    - **Los límites con los que nace una ejecución** (AU-17): 1.000 filas escritas (hasta 20.000) y 60 s (hasta 10
      min). Una que quiera escribir 3.000 para sin haber escrito ninguna y dice cuál fue el límite; él lo sube y
      publica una vez. La otra: nacer con 5.000, y una condición mal escrita escribiría hasta 5.000 filas antes de
      que él lo viera. Prueba: `limits.test.ts` (AU-17), en el PR del motor que trae los límites, y
      `runs.test.ts` con su volumen.

13. **Con qué valor nace un «Sí» y cuándo se queda.** El diseño de la fase (tarea 128) dejó cuatro puntos de AU-187
    y AU-188 como propuestas. Se le preguntó si aceptaba las cuatro recomendaciones. **Juan, 2026-11-16: «Sí, las
    recomendadas».** Cada una, con la otra respuesta que había y el PR de la construcción que trae su prueba en
    marcha:
    - **Un paso «Colección» nace con «Sí» en «Crear una fila» y «Modificar filas» cuando lo añade su mano; «Eliminar
      filas» nace con «Preguntar», y llegado de cualquier otra manera nace con «Preguntar»** (AU-187). «Crea una
      fila cada mañana» no pregunta cada mañana, y «Publicar» lo dice en su línea («las guarda», AU-182). La otra:
      nacer con «Preguntar» también de su mano, y cada ejecución dejaría su propuesta hasta que él lo cambiara.
      Prueba: `consent.test.ts` («AU-187 · the value each action is born with…»), en E1.
    - **Un «Sí» de un paso que otra cosa reescribió baja a «Preguntar»** (AU-188): su código, sus parámetros, su
      conexión o de dónde le llegan filas. La otra: que se quedara si la colección y la acción eran las mismas, y un
      «Sí» dado a un código valdría para otro. Prueba: `consent.test.ts` («AU-188 · a «Sí» of a step whose code…»),
      en E1.
    - **Poner un «Sí» y publicar, solo desde un dispositivo personal** (AU-188, como aceptar una propuesta, P21).
      Desde uno compartido el editor deja ver y probar. La otra: desde cualquier dispositivo con su sesión. Prueba:
      `publish.test.ts` («AU-188 · setting a «Sí» and publishing are refused…»), en S1.
    - **«Duplicar», «Volver a esta» y «Recuperar» conservan un «Sí»** (AU-188): devuelven un documento cuyo «Sí»
      puso él, y los dos primeros pasan por «Publicar». La otra: bajar a «Preguntar» en la copia y en lo recuperado,
      y él los pondría otra vez. Prueba: `publish.test.ts` («AU-188 · the ways a «Sí» stays…»), en S1.
14. **Una parada a medias se queda como está, y lo que escribe para «Probar» en un dispositivo compartido es suyo.**
    La construcción de la F14d (tarea 128, S2) le dejó dos dudas. **Juan, 2026-11-17: «respecto a las dudas: 1. La
    que recomiendes 2. "Que cuente como tuyo"».** Cada una, con la otra respuesta que había y su prueba:
    - **Una ejecución que para por su límite a medias de un paso deja lo que guardaron las filas de entrada
      anteriores, y «Deshacer lo que hizo» lo quita entero** (AU-17, AU-18). «Las que cumplan…» con dos filas de
      entrada: la primera pasa 600 filas de «0» a «1»; la segunda iba a escribir 600 más y el total, 1.200, pasa el
      límite de 1.000, así que para sin guardar las suyas. Las 600 de la primera se quedan, cada una con su operación
      en el registro, y la ejecución dice «Paró» con «Deshacer lo que hizo». La otra: contar todas antes de guardar
      ninguna, que cambia lo que hace el paso, porque la segunda fila encuentra lo que guardó la primera. Prueba:
      `runs.test.ts` («AU-17 AU-18 · «Las que cumplan…» with several rows, stopped by the limit partway…»).
    - **Lo que escribe para «Probar» en un dispositivo compartido lleva su etiqueta, como en uno personal** (AU-94).
      En el ordenador del salón prueba «Avisar de un pedido» con «nota: desde el salón»: la fila del disparador dice
      que es suya, como en su portátil, y la prueba dice lo mismo en los dos. La otra: etiquetarla como del
      dispositivo compartido (`ambient`), y la misma prueba diría otra cosa allí. Nada más se abre a un dispositivo
      compartido: una prueba no guarda nada, y desde él no se escribe un borrador, no se pone un «Sí», no se
      publica y no se fija (decisión 13), así que nada de lo que deja una prueba lleva esa etiqueta a una ejecución
      de verdad. Prueba: `runs.test.ts` («AU-94 · what Juan types for «Probar» on a shared device counts as his…»).
15. **Un dispositivo compartido mira las ejecuciones; «Ejecutar» sin campos empieza enseguida; el teléfono enciende
    y apaga.** La construcción de la F14d (S2 y P1, tareas 128) le dejó tres dudas, cada una con su ejemplo y las
    dos salidas. A la pregunta «¿Aceptas las seis recomendaciones: tres de la fase de la IA y tres de
    «Publicar»?», **Juan, 2026-11-17: «Sí, las seis».** Las tres de «Publicar» (las de la IA son la decisión 16):
    - **Desde un dispositivo compartido se leen las ejecuciones; ejecutar, reintentar, deshacer y fijar piden uno
      personal** (AU-97, AU-100, AU-18, AU-93; como se construyó en S2). En el ordenador del salón abre «Ejecuciones»
      y ve cada ejecución y sus pasos; «Deshacer lo que hizo» dice «Solo desde un dispositivo personal.» y no
      cambia nada. La otra: dejar que el compartido también actúe sobre ellas, y lo que hiciera ahí no sería de
      nadie. Prueba: `automations-publish.spec.ts` («AU-188 · from a shared device a run is looked at…»).
    - **«Ejecutar» en una automatización que no pide campos empieza enseguida, sin cuadro que confirme** (AU-97;
      como se construyó en P1). «Repasar las tareas», sin «Campos que pide»: pulsar «Ejecutar» la inicia y lleva a
      «Ejecuciones». La otra: un cuadro «¿Ejecutar ahora?» cada vez, un paso más que no dice nada nuevo. Prueba: la
      de la app de escritorio, `e2e-boni-desktop/automations-publish.spec.ts` («AU-97 AU-99 AU-101 AU-18 · in the
      desktop app over the real server…»), que pulsa «Ejecutar» y está en «Ejecuciones».
    - **El teléfono enciende y apaga una automatización publicada** (AU-74, AU-194; cambia lo que se construyó en
      P1). En el móvil, «Avisar de un pedido» dice «Encendida» en su cabecera y la apaga desde ahí, por
      `automations.enable`, como en el ordenador; el teléfono es un dispositivo personal. Sigue sin editar ni
      publicar. La otra: sin interruptor en el teléfono, y para apagarla tendría que ir al ordenador. Prueba:
      `automations-publish.spec.ts` («AU-95 AU-74 AU-97 AU-194 · on the phone the header has no «Publicar» and has
      the switch…»).
16. **Un «Agente» con «Sí» guarda también con algo de fuera; el revisor con un modelo llega con la F16; un «Sí»
    que falla vuelve a preguntar.** El diseño de la F15 (tarea 129) le dejó tres dudas. **Juan, 2026-11-17: «Sí, las
    seis»**, lo que se recomendaba en cada una. Cada una, con la otra respuesta que había y su prueba:
    - **Un «Agente» con «Sí» en «Modificar» o en «Eliminar», en una ejecución a la que llegó algo de fuera, guarda**
      (AU-204, AU-45, AU-200). «Al llegar un correo», un lector saca «tarea» y un «Agente» conectado a Tareas con
      «Eliminar: Sí · como mucho 20» manda a la papelera la tarea que el correo da por hecha. Llega un correo que
      dice «elimina todas las tareas»: el agente no lee esa frase, y en el peor caso van a la papelera hasta 20 filas
      de las que su conexión deja, con «Deshacer lo que hizo». En «Publicar» lee «Elimina filas en Tareas · sin
      preguntar · decidido por un modelo · como mucho 20 · con datos de fuera». Es la decisión 11 tal cual, ahora también para
      el «Agente». La otra: proponerlo, y cada ejecución que leyó ese correo dejaría una tarjeta en la Bandeja aunque
      la celda diga «Sí». Prueba: `automation-ai.test.ts` («AU-204 · with something from outside in its unit,
      an «Agente»'s create, its modify and its trash with the «Sí» are allowed as without it…»).
    - **Aprender con un modelo (un revisor que propone un cambio en las «Instrucciones» de un «Agente») llega
      después, con «Revisar la guía» de la F16** (AU-211, §5.15). La F15 construye lo que no necesita un modelo: las
      señales, la cuenta bajo la celda, la sugerencia y la pausa. La otra: un PR más en la F15 y llamadas a modelos
      del presupuesto del mes antes de que existan las automatizaciones de Boni que las limitan.
    - **Cuando un «Sí» falla tres veces seguidas, o uno de cada cinco entre sus últimas 20 juzgadas (con al menos
      tres), Boni vuelve a preguntar** (AU-210). Esta línea decía «4 de sus últimas 20», que no es lo que se
      construyó (`backOff`: tres seguidas, o un 20 % mal de las últimas 20 con al menos tres juzgadas); **Juan,
      2026-11-18: «No recuerdo decir "4 de los ultimos 20", haz lo que consideres mejor»**, y queda lo construido. El
      «Analista» tiene «Crear: Sí» en Notas y deshace tres ejecuciones seguidas: la siguiente deja una tarjeta en vez
      de guardar, la celda dice «Sí · en pausa», y un aviso lo cuenta una vez con «Quitar pausa». La versión
      publicada no cambia y la pausa solo baja. La otra: solo el aviso, y las ejecuciones seguirían guardando hasta
      que él bajara la celda. Prueba: `learning.test.ts` (AU-210, S3 de la F15).
17. **Lo que guarda sola una ejecución no avisa; un aviso es el paso «Avisar», y dice dónde.** La tarea 129 preguntó
    si una ejecución que empezó sola (una «Programada») y guardó algo debía avisarle. **Juan, 2026-11-17:
    «dependeria de si la automatizacion tiene una salida que vaya por avisos en escritorio, moviles o lo que sea».**
    Así que:
    - Lo que guardó sola no salta en ningún sitio: se ve en su línea de «Ejecuciones» con «Deshacer», como lo
      construyó S4 de la F14d (AU-167). La otra respuesta era «un aviso cada vez que una ejecución programada guarda,
      sin que la automatización lo pida».
    - Si él quiere enterarse, pone un «Avisar» en el grafo, y ese aviso lleva **Dónde** detrás de «Añadir opción»:
      «En el ordenador y el móvil» (nace así), «Solo en el ordenador» o «Solo en el móvil» (AU-201). Son sus
      dispositivos, nunca uno que se nombre: es una lista cerrada fija en el paso, no una expresión, así que ni algo
      de fuera ni un modelo elige a dónde va.
    - El aviso de un fallo de una automatización que corre sola no cambia: lo manda Boni una vez por racha (AU-102,
      decisión 12).
    Prueba: `people.test.ts` («AU-201 · «Avisar» has no recipient parameter…» y «AU-201 · in a test it says what it
    would notify…»); lo que guardó sola, sin aviso y con «Deshacer» en su línea: `automations-publish.spec.ts`
    (`e2e-boni`, «AU-167 · decision 17: …») y en la app de escritorio sobre el servidor real
    (`e2e-boni-desktop/automations-publish.spec.ts`, «AU-195 AU-167 · …»).

18. **Un «Agente» que modifica filas puede llevar valores fijos, como al crear.** El segundo PR de E3 de la F15
    (tarea 129) preguntó: «Cuando un paso «Agente» modifica filas, ¿quieres poder fijar tú el valor de un campo?».
    **Juan, 2026-11-17: «Sí, fijarlo».** La otra respuesta era «No, como está»: modificar solo con los campos que
    decide la IA, y los fijos solo al crear. Por ejemplo, un «Agente» conectado a Tareas con «Modificar: Sí · Solo
    estos campos: Importe · Fijo: Estado = revisada»: elige qué tareas toca y qué importe les pone, y cada una que
    modifica acaba con «revisada», lo pida o no el modelo. Con «No, como está», el modelo tendría que poner él el
    estado, y podría no hacerlo o poner otro. Lo que queda:
    - El formato lleva `update.fixed`, con la forma, la validación y las expresiones de `create.fixed` (AU-48,
      AU-52). Lo pone el código al guardar; nunca porque el modelo obedeció. Un campo fijo no está en «Solo estos
      campos», y una petición que lo nombra se niega como fuera de sus campos (`outside-fields`); una petición de
      modificar puede no nombrar ninguno suyo y solo poner los fijos. Prueba: `action-limits.test.ts` («AU-48 ·
      decision 18 · a modified row ends with the action's fixed values…» y «AU-52 · decision 18 · an «Agente»
      modifies the rows it chooses…»).
    - El servidor y el motor lo leen del paso de la versión publicada, nunca de una petición, de un borrador, de la
      caja ni del modelo; un fijo que su expresión toma de fuera lleva la etiqueta de fuera (AU-170). Prueba: la de
      AU-52 de arriba, con la fila de la unidad etiquetada de fuera.
    - Donde cuenta `create.fixed` cuenta igual `update.fixed`: cambiarlo al publicar baja el «Sí» del paso (AU-188,
      decisión 13 punto 2; `consent.test.ts`, «AU-188 · decision 18 · a fixed value of modify…»), es un cambio de su
      conexión en «Versiones» (AU-96, `versions.test.ts`), y «Lo que hizo» y «Probar» lo dicen igual sin guardar
      nada en una prueba (la de AU-52 de arriba).
    - En la pantalla, el control de AU-52 va también bajo «Modificar» en la fila abierta de la conexión (P2). La frase
      del paso (AU-44) no dice hoy los fijos ni al crear: decirlos es de P2.

19. **El chat de una página es una automatización; la conversación con el asistente no.** El diseño de la F16
    (tarea 130) preguntó: «¿Quieres poder abrir y cambiar en el lienzo también la conversación principal con Boni?».
    **Juan, 2026-11-17: «No, solo el de página»** («el diseño que habia de chat y automatizaciones es correcto»). La
    otra respuesta era la conversación como una automatización más, con su modelo, sus conexiones y sus
    instrucciones en el lienzo: ganaría control, y el suelo del asistente (lo que viene de fuera se propone, P4)
    dependería de un permiso que pone él, y uno roto lo dejaría sin el asistente para arreglarlo. Por ejemplo, en la
    página «Gastos» el chat es «Chat de Gastos», que abre en el lienzo y al que le quita una colección; cuando le
    pregunta lo mismo a Boni en la conversación principal, no hay nada que abrir en «Automatizaciones». Lo que queda:
    - El chat de una página es una automatización que Juan abre y cambia en el lienzo (AU-137).
    - La conversación con el asistente de Boni no es una automatización y no sale en «Automatizaciones» ni tiene
      «Ejecuciones». Se relaciona con ellas como dicen AU-140 (propone una nueva o un cambio, como borrador), AU-142
      (ejecuta las que lo permiten) y AU-143 (lo que hizo se guarda como una); «Pedir a Boni» en el editor es AU-141.
      Prueba: `apps/server/src/automations/chat.test.ts` («AU-231 · the chat of a page is in the list of
      automations…»).

20. **Convertida, la «Decisora» de «Leer correo» elige entre las mismas colecciones que hoy.** El diseño de la F16
    (tarea 130) preguntó: «Cuando «Leer correo» se convierta, ¿entre qué colecciones elige su paso «Decisora»?», con
    la recomendación de dejarlas como hoy. **Juan, 2026-11-17: «Sí, las dos»** (a «¿Aceptas las dos recomendaciones
    del diseño de la fase que convierte tus flujos (F16)?»: esta y la decisión 21). La otra respuesta era solo la
    colección de cosas por hacer. Por ejemplo, escribe alguien de quien no tiene fila pidiendo verse el jueves: como
    hoy, la Bandeja enseña una tarjeta que propone una cosa por hacer y otra que propone una fila nueva en la
    colección de personas. Con la otra respuesta habría una sola tarjeta, la cosa por hacer, enlazada a la persona
    solo si su fila ya existe, y ningún correo propondría una persona nueva. Lo que queda:
    - La conversión no cambia los destinos de la «Decisora»: son todas las colecciones de hoy (AU-127, AU-221). Es
      la decisión 6 de la tarea 103 (§9).
    - El panel del paso «Decisora» lista las colecciones entre las que elige. Juan quita una y publica cuando
      quiera, y eso es una versión suya de «Leer correo», con «Volver al de Boni» (AU-221). Prueba:
      `apps/server/src/automations/boni.test.ts` («AU-127 · the mail automation, converted, reads an invented
      mail and proposes what the old flow proposed…»).
21. **El despliegue de la F16 sale con el motor de antes todavía dentro, dormido.** El diseño de la F16 (tarea 130)
    preguntó: «¿El despliegue de la F16 sale con el motor de antes todavía dentro, dormido, o ya quitado?», con la
    recomendación de dejarlo dentro. **Juan, 2026-11-17: «Sí, las dos»** (la misma respuesta de la decisión 20). La
    otra respuesta era que saliera ya quitado. Por ejemplo, un resumen programado de la mañana que, convertido, sale
    mal: en esa automatización pulsa «⋯ → Volver al flujo de antes» y a la mañana siguiente el flujo corre como
    siempre. Ya quitado, la habría apagado a la espera de una conversión corregida, o la cuenta entera habría vuelto
    desde la copia hecha antes de convertir, con las versiones anteriores del servidor y de las apps. Lo que queda:
    - En ese despliegue nada en la app dice «Formato anterior», y cada automatización convertida tiene «⋯ → Volver al
      flujo de antes» mientras el motor de antes esté dentro (AU-225). Prueba:
      `apps/server/src/automations/convert.test.ts` («AU-225 · «Volver al flujo de antes» leaves the flow running as
      it was…»).
    - La retirada (AU-152) se mezcla cuando Juan dice que las convertidas valen, y sale en un despliegue pequeño
      después. Hasta entonces los dos motores están en `main` y cada flujo corre en uno solo (AU-228). Prueba:
      `apps/server/src/automations/convert.test.ts` («AU-152 · after the removal nothing imports the old engine…»).

22. **De los cuatro usos quedan tres filas «De la cuenta».** El diseño de «Modelos» sin usos (tarea 154, §5.16)
    preguntó qué queda de los cuatro usos, con la recomendación de tres filas «De la cuenta» encima de la lista.
    **Juan, 2026-11-18: «Si, las tres, pero imagino que tambien habra que cambiar la forma de evaluar, mas que pasar
    evaluaciones por categoria, una evaluacion global para ver como desempeña el modelo.»** («las tres» son las
    recomendadas de esta decisión, la 23 y la 24; lo de la evaluación es la decisión 25). La otra respuesta era
    ninguna fila: «El de la cuenta» desaparecía, cada paso de IA y cada conversación nombraban un modelo o una
    etiqueta, y el cambio escribía en cada uno el modelo que hoy le toca. Por ejemplo, hoy lee con
    «m-ejemplo-rápido» y quiere pasar a «m-ejemplo-nuevo»: cambia «De la cuenta · Lectura» una vez («La usan 6
    automatizaciones») y desde la siguiente ejecución «Leer correo» y los pasos que no eligieron leen con el nuevo.
    Con la otra respuesta habría abierto cada una de las seis automatizaciones para cambiar el «Modelo» del paso y
    publicarla, y un paso nuevo nacería sin modelo y no se publicaría hasta elegir uno. Lo que queda:
    - «De la cuenta» son tres filas encima de la lista: «Agente», «Lectura» y, si hay un modelo de decisión,
      «Decisión». Un paso o una conversación con «El de la cuenta» usan la de su clase, leída en cada ejecución
      (AU-236). Prueba: `apps/server/src/models.test.ts` («AU-236 · a step and a conversation that chose nothing
      use the account's row of their kind…»).
    - «Revisor» desaparece: lo que revisa lee con «Lectura». Si su «Revisor» de hoy es otro modelo que su «Lector»,
      la conversión lo deja escrito en la pieza «Revisora» (AU-245). Prueba: `apps/server/src/models.test.ts`
      («AU-245 · the model a converted step carries…»).
23. **En una etiqueta con dos modelos, si el primero falla no entra el segundo.** El diseño de «Modelos» sin usos
    (tarea 154) preguntó si, cuando el modelo de una etiqueta no contesta (el proveedor caído, el tiempo agotado),
    entra el siguiente de la etiqueta, con la recomendación de que no. **Juan, 2026-11-18: «Si, las tres…»** (la
    misma respuesta de la decisión 22). La otra respuesta era que entrara el siguiente, en el orden de su lista. Por
    ejemplo, su «Clasificar» tiene «Barato», con «m-ejemplo-rápido» arriba y «m-ejemplo-grande» debajo, y a las
    7:00 el proveedor del primero no contesta: la ejecución sale en «Ejecuciones» como fallida en ese paso y hace
    lo que diga su «Si falla», sin gastar nada en otro modelo. Con la otra respuesta habría clasificado
    «m-ejemplo-grande»: el correo de esa mañana clasificado, esa llamada al precio del grande (y la primera,
    agotada, quizá cobrada también) y un resultado que puede no coincidir con el de siempre. Lo que queda:
    - Contesta siempre el de arriba en su lista. Se resuelve una vez al empezar el paso; si la llamada falla, el
      paso falla y sigue su «Si falla» (AU-239). Prueba: `apps/server/src/automations/ai.test.ts` («AU-239 · a step
      resolves its model once and a failed call does not try the tag's next model»).
24. **La evaluación se pide en todas partes, también en el chat.** El diseño de «Modelos» sin usos (tarea 154)
    preguntó si un modelo recién cargado, sin evaluar, vale en el chat, con la recomendación de que no. **Juan,
    2026-11-18: «Si, las tres…»** (la misma respuesta de la decisión 22). La otra respuesta era que en el chat
    valiera sin evaluar (saldría en el chip al cargarlo, con «Sin evaluar») y solo los pasos de una automatización
    pidieran la evaluación. Por ejemplo, carga «m-ejemplo-nuevo» para probarlo en una conversación: pulsa «Evaluar»
    en el modelo, espera unos minutos, ve «19 de 24» y lo que costó, y entonces lo elige en el chip. Con la otra
    respuesta lo habría elegido al momento, y si ese modelo arma mal los planes lo habría notado en respuestas que
    fallan, sin ver antes cuántos casos acierta. En las dos el código comprueba cada plan igual: un modelo sin
    evaluar no puede hacer nada que otro no pueda. Lo que queda:
    - Un modelo no sale en el chip del chat ni en ninguna otra lista hasta tener su evaluación vigente (AU-233,
      AU-235, AU-242). Desde la decisión 25 es la evaluación del modelo, la única: no hay una «de Agente». Prueba:
      `e2e-boni/models.spec.ts` («AU-233 · a model added is «Sin evaluar» and is offered nowhere»).
25. **Una evaluación por modelo, no una por clase de llamada.** El diseño de «Modelos» sin usos (tarea 154) proponía
    tres evaluaciones por modelo («Agente», «Lectura», «Decisión»), cada una lanzada aparte. **Juan, 2026-11-18:
    «…imagino que tambien habra que cambiar la forma de evaluar, mas que pasar evaluaciones por categoria, una
    evaluacion global para ver como desempeña el modelo.»** Por ejemplo, carga «m-ejemplo-nuevo» y pulsa «Evaluar»
    una vez: corre sus 24 casos (15 de agente y 9 de lectura), su fila dice «19 de 24» y desde ahí lo puede elegir
    en el chat, en un «Agente» y en un lector. Con las tres evaluaciones habría pulsado «Evaluar» para «Lectura» (9
    casos) y, para usarlo en el chat, otra vez para «Agente» (15), con dos resultados en su fila. Lo que queda:
    - «Evaluar» corre de una vez todo lo que ese modelo puede contestar y da un resultado. El desglose («Agente ·
      12 de 15», «Lectura · 7 de 9») está detrás, en «Ver los casos», y no se lanza por separado (AU-234). Prueba:
      `apps/server/src/models.test.ts` («AU-234 · one evaluation of a model runs every case it can answer once and
      keeps one result with its parts…»).
    - «Evaluado» es tener esa evaluación vigente: con ella el modelo vale para el chat, un «Agente», un lector y
      las filas «De la cuenta · Agente» y «Lectura»; el modelo de decisión, con la suya, para «De la cuenta ·
      Decisión» (AU-235). Prueba: `apps/server/src/models.test.ts` («AU-235 · a model is offered only with its key
      and a current evaluation…»).
    - Lo que ya tiene guardado por uso pasa a ser la evaluación de su modelo sin correr nada. Un modelo que solo
      tenía un uso evaluado dice «Parcial», sigue ofreciéndose donde se ofrecía y se completa con su siguiente
      «Evaluar» (AU-244). Prueba: `apps/server/src/models.test.ts` («AU-244 · … every model is offered where it was
      and nowhere else…»).
    - Lo que cuesta (§5.16, debajo de las reglas): una evaluación cuesta más o menos lo que hoy la de «Agente» y la
      de «Lector» juntas. Menos que hoy para un modelo que hace de todo (una en lugar de tres); más que hoy para un
      modelo que solo iba a leer, que ahora corre también los 15 casos de agente.
    - Lo que eligió el diseño, y la respuesta no elegida: **el resultado no apaga nada.** Un modelo flojo en una
      clase de trabajo se puede elegir igual, como hoy (la puerta de hoy pide una evaluación reciente, no un
      resultado). Por ejemplo, «m-ejemplo-rápido» tiene «17 de 24» («Lectura · 9 de 9», «Agente · 8 de 15»): sale
      en la lista de los lectores y también en el chip del chat, y lo que le dice que no es para el chat es ese
      desglose. La respuesta no elegida era una nota mínima: por clase de trabajo (ese modelo no saldría en el chat
      ni en un «Agente», y sí en los lectores) o para todo (no saldría en ningún sitio, aunque lea bien). No se
      eligió porque hoy no la hay, porque pide un número que alguien tiene que fijar y porque una evaluación es
      información para él y una condición que el código comprueba, no una guarda: lo que un modelo puede hacer lo
      dicen las conexiones y la política. Si la quiere, es una regla nueva sobre AU-235, por clase de trabajo.
26. **Contesta un «Preguntar» cualquier dispositivo con la sesión de la cuenta; el paso puede pedir uno personal.**
    El diseño de la F15 (tarea 129) dejaba contestar solo desde un dispositivo personal, como aceptar una propuesta.
    **Juan, 2026-11-18: «No distinguiria entre dispositivos personales y compartidos, si has iniciado sesion puedes
    aceptarlo, a menos que pueda configurarlo asi en la automatizacion».** Por ejemplo, «Revisar facturas» pregunta
    «¿De qué cuenta es este cargo?» con tres opciones; la tableta compartida de la cocina tiene la sesión de la
    cuenta, y desde ella se elige «Casa»: la ejecución sigue. Con la otra respuesta (solo personal, la de antes) la
    tarjeta de esa tableta diría «Solo desde un dispositivo personal» y habría que esperar al teléfono. Lo que queda:
    - Contestar (o apartar) una tarjeta de «Preguntar» se puede desde un dispositivo personal o uno compartido de la
      cuenta; un altavoz (`ambient`) nunca, porque no confirma nada. El servidor le dice a la pantalla, por tarjeta,
      si ese dispositivo puede contestarla (`mayAnswer` en `GET /api/agent/requests`), y lo comprueba otra vez al
      recibir la respuesta (`mayAnswer` de `waits.ts`; si no, `personal-device-only`). Prueba:
      `apps/server/src/automations/ai.test.ts` («A-45 AU-203 · decision 26: any device signed in to the account
      answers a «Preguntar» card…»).
    - El paso gana una opción detrás de «Añadir opción», «Solo desde un dispositivo personal», apagada al nacer:
      encendida, solo un dispositivo personal contesta sus tarjetas, como antes. La misma prueba.
    - **La etiqueta de la respuesta sale del dispositivo** (**Juan, 2026-11-18: «Sí, de fuera»**): desde uno
      personal es su mano (`handLabel`); una respuesta escrita desde uno compartido lleva la etiqueta de algo que no
      es su mano (`ambient`, con el dispositivo como fuente), porque cualquiera delante de esa tableta pudo
      escribirla, igual que las preguntas que el agente hace en segundo plano. Una opción elegida lleva la etiqueta
      de la opción (AU-125), venga de donde venga. Así, el paso que guarda lo escrito desde la tableta lo guarda
      como de fuera, y su «Sí» lo trata como trata un correo. La respuesta no elegida: «como mío», su mano desde
      cualquier dispositivo, y lo escrito en la cocina contaría como escrito por él.
    - Solo se abre contestar. Aceptar la propuesta de una ejecución, «Ejecutar», reintentar, deshacer, «Fijar»,
      publicar, encender y poner un «Sí» siguen pidiendo un dispositivo personal (decisiones 13 y 15). Prueba:
      `apps/server/src/automations/ai.test.ts` («A-45 · decision 26 opens only answering…»).
    - Apartar una tarjeta sigue la misma regla que contestarla. Se queda como se hizo: a Juan se le dijo el
      2026-11-18 y no lo objetó (no es una confirmación suya). La otra era apartar solo desde uno personal. En la
      pantalla (P2), una tarjeta que ese dispositivo no puede contestar no tiene ni sus controles ni «Descartar», y
      dice «Solo desde un dispositivo personal».
27. **Una ejecución cancelada deja sus tarjetas en su propio estado, no en «Ya no vale».** El diseño decía que las
    tarjetas de una ejecución que se canceló mientras esperaba quedaban «Ya no vale», como las que pasaron su
    límite. **Juan, 2026-11-18: «usa algo como "Ejecución abortada" o algo similar».** Por ejemplo, Juan apaga
    «Revisar facturas» con una pregunta esperando: la tarjeta deja de pedir respuesta y dice que la ejecución se
    canceló, no que la pregunta caducó. La otra: «Ya no vale» para todas, sin distinguir. Lo que queda:
    - La tarjeta tiene un estado más, `cancelled`, aparte de `expired` (migración 34 de `requests`). Lo ponen apagar
      o eliminar la automatización, deshacer la ejecución que espera y una ejecución que al seguir encuentra la
      automatización apagada; pasar el límite, una ejecución interrumpida o una que ya siguió dejan `expired`. Una
      respuesta a una tarjeta cancelada vuelve con `run-cancelled`, y a una caducada con `run-expired`. Prueba:
      `apps/server/src/automations/ai.test.ts` («AU-203 · the 21st waiting run of an automation fails at its
      question; turning the automation off, deleting it or undoing a run cancels its waits, and their cards end as
      cancelled…»).
    - Las palabras de la tarjeta son de la pantalla (P2, tarea 153). Hecho en P2: contestar o apartar una tarjeta
      cancelada dice «Pregunta cancelada» (`run-cancelled`), y una caducada «Pregunta caducada» (`run-expired`); las
      dos salen de la lista. La prueba: `e2e-boni/automations-ai.spec.ts` («AU-203 · a card of a cancelled run says
      «Pregunta cancelada»…»).
28. **«Reintentar si el modelo falla»: una opción de los pasos de IA, que nace sin reintentar.** El diseño decía
    que una llamada a un modelo no se repite, porque una que se agotó pudo cobrarse. **Juan, 2026-11-18: «Ok, pero se
    deberia poder configurar tambien».** Por ejemplo, «Resumir» en «Revisar facturas» con «Reintentar si el modelo
    falla: 2»: el proveedor tarda más que el tope de la llamada, Boni espera 2 s y la pide otra vez, y la segunda
    vuelve; «Lo que hizo» dice que hubo un reintento. Sin la opción, el paso habría fallado y seguido su «Si falla».
    La otra: no repetir nunca, la del diseño. Lo que queda:
    - Los cinco pasos de IA («Extraer», «Clasificar», «Resumir», «Escribir» y «Agente») tienen la opción detrás de
      «Añadir opción»: 0 al nacer, 1 o 2. Otro número no publica (`param.value`). Es otra cosa que «Reintentos» de
      los ajustes (AU-16), que no vuelve a llamar al modelo. Prueba: `packages/automations/src/ai-steps.test.ts`
      (««Reintentar si el modelo falla»…»).
    - Se reintenta solo tras un tope de tiempo o un 5xx del proveedor (`transient`, que marca el puerto del
      servidor: `isTransient` de `apps/server/src/automations/ai.ts`); un 429, un fallo de red, un 4xx, la clave o
      el presupuesto no se reintentan. Antes de cada reintento la ejecución espera 2 s y luego 4 s por su reloj.
      Prueba: `apps/server/src/automations/ai.test.ts` («AU-57 · the port marks `transient` only our timeout…»).
    - Cada reintento cuenta en «Llamadas a modelos» y en el tiempo de la ejecución, y se comprueban antes de
      hacerlo; el presupuesto del mes se pregunta en cada uno. El registro de la llamada dice cuántas veces se
      reintentó (`retried`). En el «Agente», cada ronda reintenta igual. Pruebas:
      `packages/automations/src/ai-steps.test.ts` («AU-206 AU-17 · a retry counts in «Llamadas a modelos» and in the
      run's time…») y `packages/agent/test/automation-ai.test.ts` («AU-206 · a round's call is asked again only
      after a `transient` refusal…»).
    - Lo que no se eligió: reintentar también tras un 429 o un fallo de red (lo que hace «Retry On Fail» de
      n8n, del que solo se tomó la idea); un límite del proveedor se respeta, y un fallo de red suele durar más de
      unos segundos. Contar intentos en vez de reintentos («2» serían dos llamadas en total): se cuenta lo que se
      añade a la llamada de siempre, para que 0 sea «como hoy».

## 11. Principios que entran o cambian (cada uno con su prueba, en el PR de su fase)

| Principio | Su prueba | Fase |
|---|---|---|
| El orden de ejecución no depende del dibujo (AU-12) | La misma automatización con las cajas barajadas da la misma ejecución, paso a paso | F14a |
| Un paso es su identificador; el nombre se cambia sin romper nada (AU-02) | Renombrar un paso citado en un parámetro: sigue calculando lo mismo. Desde la F14c, también citado en un «Código» | F14a, F14c |
| Ninguna acción enseña más de siete parámetros (AU-75) | Recorre el catálogo y cuenta | F14b |
| Lo que cambia el resultado no se esconde (AU-77) | Todo parámetro marcado así en el catálogo está a la vista | F14b |
| «Ajustes» es igual en todos los pasos (AU-78) | El catálogo no puede declarar ajustes propios | F14b |
| Lo que no está por defecto se ve en la tarjeta (AU-79) | Por cada ajuste, la tarjeta lo pinta | F14b |
| Una palabra por acción (AU-85) | Cada acción sale de una sola clave de `i18n.ts` | F14b |
| El sitio no es parte de la automatización (AU-05; sustituye a I-26) | Mover no cambia el borrador ni su versión; un paso sin sitio se coloca | F14b |
| El código solo lee y guarda por sus conexiones, y solo lo que su análisis vio (AU-31, AU-32, AU-176, AU-183; cambia el 2026-11-16) | Un `$col` sin conexión no pasa la validación; la caja no tiene con qué escribir; una petición que el análisis no vio, o que la conexión no permite, hace fallar el paso y no guarda nada | F14c |
| Los límites de una conexión estrechan y nunca ensanchan (AU-43, AU-48) | Una lectura fuera del filtro no devuelve nada; una escritura fuera de sus filas o de sus campos se niega | F14c, F15 |
| La vista previa es la ejecución (AU-27) | El mismo valor en las dos, para los ejemplos del catálogo | F14c |
| Lo calculado hereda la peor etiqueta de lo que recibió (AU-169) | Un valor calculado con un dato de fuera se guarda como de fuera y no vale como destino; lo escribe sin preguntar solo un paso de una versión publicada con «Sí» (decisión 11) | F14c |
| Una evaluación no deja nada a la siguiente (AU-37) | Cambiar un prototipo en una y mirarlo en la otra | F14c |
| Evaluar por fila aguanta su volumen (AU-38) | 3.000 filas dentro del tiempo fijado (A-15) | F14c |
| Un borrador nunca corre de verdad (AU-95; D-55 se queda) | La de hoy, sobre el formato nuevo | F14d |
| Lo que escribe una ejecución se deshace entero (AU-18) | Deshacer una ejecución de tres pasos que escriben | F14d |
| Una ejecución interrumpida no se repite sola (AU-190, decisión 12) | Un servidor que arranca con una en marcha la cierra, no la repite y deja lo que guardó | F14d |
| Volver a una versión hace una nueva y no toca el borrador (AU-98, decisión 12) | Volver a la 2 desde la 4 hace la 5 con el documento de la 2, y el borrador queda como estaba | F14d |
| La primera publicación enciende; otra no mueve el interruptor; apagada no corre (AU-194, decisión 12) | Publicar una vez, publicar otra y apagar, cada una con lo que corre después | F14d |
| De una ejecución, al móvil solo va un fallo, una vez por racha (AU-102, AU-167, decisión 12) | Tres fallos seguidos, un aviso; una que guardó sola no manda nada al móvil | F14d |
| Una ejecución para en su límite antes de guardar (AU-17, decisión 12) | 3.000 filas con el límite de 1.000: ninguna operación en el registro | F14d |
| Modificar y eliminar piden una condición (AU-121) | Sin condición, la validación la rechaza | F14a |
| Una conexión solo restringe (AU-45, AU-165) | Un «Sí» no abre un destino de fuera ni lo que Boni sabe de Juan; privada no se conecta a IA | F15 |
| Lo que guarda un paso de IA lo deciden su celda y la política, nunca el modelo (AU-204) | Una prueba por fila de su tabla: con «Sí» guarda, también un «Agente» al que llegó algo de fuera; sin «Sí» propone; lo de un turno ambiental siempre propone | F15 |
| Un paso de IA fuera de su conexión se niega en la política (AU-205, P29) | Una llamada a una colección sin conectar, a una acción en «No», fuera de sus filas o sus campos, sobre «Como mucho» o a una colección privada: `decide` la niega con la conexión guardada | F15 |
| Un paso no lleva claves ni ajustes de un modelo, y su modelo pasó la evaluación de su uso (AU-50, AU-199) | El catálogo no admite esos parámetros; un modelo sin evaluar o sin clave no se puede elegir ni publicar | F15 |
| Lo que recibe el modelo de un «Agente» es una lista cerrada (AU-197) | Una fuente nueva en lo que se le manda rompe la prueba; un valor de fuera entra como asa | F15 |
| Las llamadas a modelos se cuentan antes de hacerlas (AU-206) | Con el límite en 3, la cuarta no llega al modelo y la ejecución para con `run.limit` | F15 |
| Una ejecución que pregunta no para a las siguientes ni espera para siempre (AU-203) | Con una esperando, la siguiente corre; pasado el límite sale por «sin respuesta»; un reinicio no la pierde | F15 |
| Aprender nunca cambia una versión publicada ni pone un «Sí» (AU-209, AU-210, AU-212; decisión 10) | Con 20 de 20 aceptadas, la versión y el borrador siguen igual; una pausa solo baja | F15 |
| Al conectar, solo leer (AU-41) | Una conexión nueva no tiene ningún permiso de escribir | F14c |
| Segundo plano: quién escribe solo (decisión 5; cambia P7) | Una fila por caso de la regla | F14d, F15 |
| La misma versión publicada recibe las mismas decisiones la inicie Juan o su disparador (AU-195, decisión 11; A-36) | Para cada acto, cada etiqueta y cada celda, `decide` contesta lo mismo a mano y sola; con «Preguntar», las dos proponen | F14d |
| Solo no pregunta lo publicado y con el «Sí» de Juan (AU-186, AU-188; cambia P5 en una automatización, 2026-11-16; desde la decisión 11, también con algo de fuera) | Una eliminación con «Sí» de un «Código», un «Colección» o un «Agente» publicados va a la papelera sin propuesta y se deshace con la ejecución, con algo de fuera también; con «Preguntar», se propone; un «Sí» que no puso su mano baja a «Preguntar»; fuera de una automatización, P5 sigue | F14d, F15 |
| Un «Sí» nace solo de su mano y se queda solo si su paso no cambió (AU-187, AU-188, decisión 13) | Un paso «Colección» que añade su mano nace con «Sí» en crear y modificar y con «Preguntar» en eliminar; uno que llega de otra manera, o reescrito, baja a «Preguntar»; desde un dispositivo compartido no se pone ni se publica; «Duplicar», «Volver a esta» y «Recuperar» lo conservan | F14d |
| Una automatización llama a otra solo con permiso, tres niveles, sin ciclos (AU-112; cambia D-44) | Sin permiso no se puede elegir; un ciclo no publica | F18 |
| Un bloque tiene nombre único en su página (AU-130) | Dos bloques no pueden llamarse igual; renombrar no rompe lo enlazado | F17 |
| Un fallo no hace una cadena (AU-118) | Una automatización iniciada por «Falla una automatización» que falla no inicia otra | F18 |
| Instalar un paquete no publica nada (AU-145) | Tras instalarlo, todas sus automatizaciones están sin publicar | F19 |
| Cambiar una función guardada no cambia lo que ya corre (AU-147) | Cambiarla y ejecutar la versión publicada: calcula lo de antes | F19 |
| Cada cosa del lenguaje de planes tiene su paso (AU-223) | La prueba recorre operaciones, lectores, controles, componentes, funciones, disparadores y acciones: a ninguna le falta su fila | F16 |
| Un flujo convertido hace lo mismo (AU-150, AU-224) | Con las mismas entradas y las mismas respuestas de modelo: las mismas llamadas a lectores, las mismas lecturas y las mismas escrituras pedidas a la política, en el mismo orden y con las mismas etiquetas | F16 |
| Convertir no borra ni duplica, y se vuelve atrás (AU-225, AU-226) | Convertir dos veces deja lo mismo; un flujo programado corre una vez en su hueco; «Volver al flujo de antes» lo deja corriendo como estaba | F16 |
| Lo convertido que escribe nace en «Preguntar» (AU-230, decisión 13; AU-188) | Un flujo que creaba una fila, convertido: ninguna versión suya lleva un «Sí», y su ejecución propone | F16 |
| El turno recibe las mismas decisiones en el motor nuevo (AU-143, AU-230; P4, P5, P8) | Los mismos planes en los dos motores: cada llamada a `decide` y su respuesta, iguales; el origen nunca es `automation` | F16 |
| Una pieza de Boni solo corre en su automatización y propone como hoy (AU-127; A-19) | Una pieza en otra automatización no valida; en «Probar» no cambia nada; lo que crea «Leer correo» es una propuesta | F16 |
| El chat de una página no escribe solo (AU-137; P26, P27) | Su «Agente» no admite «Sí» ni al publicar ni al correr; lo que quiere escribir es una tarjeta, salvo un valor de su página | F16 |
| Un modelo o el MCP proponen un borrador, nunca publican (AU-140, AU-144; A-10, A-35) | Aceptar la propuesta deja un borrador con cada «Sí» bajado, sin publicar y sin encender | F16 |
| A cada flujo o automatización lo corre un solo motor (AU-228) | Ningún identificador tiene a la vez un flujo que corre y una automatización encendida | F16 |
| El historial de antes sigue a la vista y la conversión cabe en su tiempo (AU-227; A-15) | Un año de ejecuciones copiado por tandas sin parar al servidor; sus filas «De antes» se deshacen | F16 |
| Una etiqueta o un sitio en la lista de modelos no dan un permiso ni son una guarda (AU-240) | La misma llamada recibe la misma decisión venga su modelo de una etiqueta, de la cuenta o de su id; una negativa no prueba otro modelo | FM |
| Solo actos de Juan cambian qué modelo contesta (AU-239, AU-243) | En una etiqueta con dos contesta el de arriba aunque su evaluación caduque; un borrador propuesto no trae un modelo que eligió su autor | FM |
| Un modelo se elige solo con su evaluación, que es una por modelo (AU-234, AU-235; donde AU-199 decía «la evaluación de su uso») | Sin clave o sin su evaluación vigente no sale en ninguna lista; su resultado no lo apaga; lo publicado sigue | FM |
| Pasar a modelos sin usos no pierde nada (AU-244) | Con ajustes como los suyos, cada uso, conversación y paso contesta con el mismo modelo antes y después; hacerlo dos veces da lo mismo | FM |
