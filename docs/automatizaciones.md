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
- **AU-17** (F14d, pendiente) · Los límites de una ejecución (pasos, llamadas a modelos, filas escritas, tiempo)
  están en los ajustes de la automatización con valores prudentes; el código tiene su techo (P12, P13). Parar por un
  límite dice cuál fue y lleva a ese ajuste.
  En la F14d: son cuatro números con nombre (`AUTOMATION_LIMITS`, `packages/automations`; `RUN_LIMITS` ya es el
  nombre de los de P12 en `packages/agent`), cada uno con su valor por defecto y su techo. Los valores están
  razonados, no medidos; el constructor los mide con el volumen de Juan y los corrige aquí. Los de tiempo y filas
  escritas los aceptó Juan el 2026-11-16 (decisión 12 del §10): si la medida pide otro número, el constructor lo
  dice en su PR como duda para él y no lo cambia.

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
  sin tope lee como mucho lo que da una lectura (5.000, AU-175) y, si se pasa, falla antes de guardar ninguna. Un
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
- **AU-18** (F14d, pendiente) · Todo lo que una ejecución escribe es un solo grupo en el diario: se deshace entero
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
- **AU-23** (F14c, en parte) · Debajo de una expresión se ve lo que vale con la fila actual («= 5 · con la fila 3
  de 128»), y se pasa de fila. Si no se puede calcular dice qué hacer: «Prueba los pasos anteriores».
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
  `e2e-boni/automations-code.spec.ts` y, en la app de escritorio sobre la caja real, la de AU-27. Falta: en el
  móvil, que se vea sin poder escribir (AU-74, con la vista del paso en el móvil).
- **AU-24** (F14c, en parte) · Lo que se puede citar, igual en expresiones y en «Código»: `$json` (la fila actual),
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
  ven en la tarjeta del paso en el lienzo, y los de la vista previa debajo de la expresión. Falta: marcarlos en su
  sitio del editor y en la vista del paso (AU-36, P2).
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
  Falta: las claves en la vista de un «Código» y en el autocompletado (P2).
- **AU-26** (F14a, hecho) · Lo que da forma al paso no puede ser una expresión: la colección, la acción, el modo.
  Se lee en el lienzo y el mapa lo sabe antes de ejecutar (D-48).
- **AU-27** (F14c, en parte) · La vista previa y la ejecución usan el mismo motor de JavaScript, la caja: lo que
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

- **AU-30** (F14c, en parte) · «Código» es JavaScript. Su parámetro «Se ejecuta» tiene dos modos, a la vista: «Una
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
- **AU-31** (F14c, en parte) · Lee colecciones solo por las conexiones del paso: `$col('Gastos').find({ where,
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
- **AU-32** (F14c, en parte) · El código no escribe por sí mismo (lo de A-09 se queda: pide, y Boni comprueba y
  aplica). Devuelve filas y las escriben los pasos «Colección» que le siguen, que pasan por la política; o pide
  guardar por una conexión que lo permite, y lo guarda el motor (AU-172 a AU-176, Juan, 2026-11-16).
  En la F14c: `$col(…)` tiene `find`, `get`, `count` y `sum` y, para pedir guardar, `create`, `update` y `remove`
  (AU-172); el motor nunca escribe lo que no pasó por la conexión, el análisis y la política (AU-183). Las filas que
  salen de «Código» no son filas guardadas aunque copien su id: el paso «Colección» que le sigue las busca o las casa
  por un campo, no por «Las filas que llegan».
  Hecho en E1: `$col(…)` de la caja tiene solo `find`, `get`, `count` y `sum`, y una expresión no tiene `$col`.
  Hecho en E3: el motor no le pide a la puerta ninguna escritura por lo que responda la caja, y las filas de «Código»
  no tienen origen: un paso «Colección» con «Las filas que llegan» detrás falla con `row.notSaved`.
  Comprobado en P1: la vista previa no escribe (en una expresión no hay `$col`, AU-184). Falta: pedir guardar por una
  conexión, que lo guarda el motor (AU-175, F14d), y la conexión que lo permite en la app (AU-176, P3).
- **AU-33** (F14c, en parte) · `console.log` se ve en la «Consola» del paso, una franja plegable debajo de su
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
- **AU-35** (F14c, en parte) · La caja tiene tiempo, memoria y tamaño máximos. Pasarse dice cuál y por cuánto.
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
- **AU-36** (F14c, en parte) · El editor completa los pasos anteriores, los campos por su nombre y las colecciones
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
- **AU-38** (F14c, en parte) · Lo que cuesta evaluar una expresión por fila se mide con 3.000 filas antes de salir
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
  cuesta 100 ms y la caja cuenta 11: unos 90 ms por llamada son arrancar su hilo y su intérprete, casi dos tercios de
  una llamada media. La prueba fija 15 s de reloj (ensanchados por la carga, `under`) y que el montón del servidor no
  crezca 160 MB (creció entre 44 y 85). Falta: en la app de escritorio (pantallas).
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
- **AU-175** (F14c, en parte) · Lo que se puede pedir tiene topes, cada uno un número con nombre
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
  Hecho en S1-c: en una ejecución de verdad sobre el almacén y la caja reales tampoco se guarda nada: con «Sí», el
  cambio de 3.000 filas espera como una sola propuesta (`YES_SAVES`), y pasarse de las peticiones de una evaluación
  (5.001) o de las de un paso (dos por fila de 3.000) falla con `code.limit`, sin propuesta y sin una operación en el
  registro. Falta (F14d): los topes de la ejecución, con AU-17.

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

- **AU-40** (F14c, en parte) · Una conexión une un paso con una colección y dice qué puede hacer en ella: leer,
  crear, modificar, eliminar. En el lienzo cuelga debajo del paso con una línea de puntos: una ficha por colección,
  con sus permisos en palabras («Lee · solo este año», «Crear: pregunta antes»).
  En la F14c: una conexión por colección, hasta 12 por paso, guardadas en el paso (`connections`).
  Hecho en E2: el formato (cerrado: una clave que no conoce no se lee), `connection.repeated`, `connection.unknown`
  y `connection.many`, y `permissions`, de donde salen sus palabras. Falta: la ficha en el lienzo (pantallas).
- **AU-41** (F14c, en parte) · En la vista del paso es una tabla: una fila por colección y una columna por acción.
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
  2026-11-16, ya no existe. Falta: la tabla (pantallas).
- **AU-42** (F15, pendiente) · «Preguntar» es una propuesta: en una conversación, una tarjeta para aceptar o no; en
  segundo plano, espera en la Bandeja. La ejecución no se queda esperando: termina, y en «Ejecuciones» dice «1
  propuesta sin responder». «Sí» escribe con Deshacer.
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
- **AU-48** (F15, pendiente) · Cada acción de escribir lleva los suyos: modificar y eliminar, «Solo estas filas»;
  crear y modificar, «Solo estos campos». Por ejemplo, modificar solo la «Categoría» de los gastos que no la tienen.
  Crear puede llevar valores fijos que la IA no elige.
- **AU-44** (F14c, en parte) · Una frase calculada resume todas las conexiones de un paso, debajo de su tabla:
  «Puede leer Gastos (solo los de este año) y Categorías, y proponer filas nuevas en Notas. No puede modificar ni
  eliminar nada.» En la F14c dice lo que lee y lo que el código puede guardar (AU-178). Al
  publicar, otra igual resume la automatización entera («Lo que podrá hacer», AU-96).
  Hecho en E2: `permissions` da todo lo que la frase necesita (cada colección que se lee, con filtro, con menos
  campos o con límite) y nada para un paso sin conexiones. Falta: la frase con sus palabras (pantallas).
- **AU-45** (F15, pendiente) · Una conexión solo restringe. Nunca deja hacer lo que la política no deja: una
  colección privada no se puede conectar a un paso de IA, y un destino nunca sale de un dato de fuera. Lo de fuera
  con «Sí» se guarda en una versión publicada porque lo dice la política, no la conexión (decisión 11 del §10,
  AU-186; hasta el 2026-11-16 se proponía aunque dijera «Sí»). Eliminar pregunta
  salvo en lo que dice AU-186, que es la política y no la conexión (hasta el 2026-11-16: «eliminar se pregunta
  siempre»).
- **AU-46** (F14c, hecho) · Las usan «Código» (leer, y guardar con permiso: AU-176), «Agente» (todo: F15) y
  el chat de una página (F16: sustituyen a su lista fija de cinco acciones).
  En la F14c: una conexión en cualquier otro tipo de paso no pasa la validación.
  Hecho en E2: `connectionActions` no da nada a ningún otro tipo, una conexión en él es `connection.notAllowed`, y un
  «Código» sin conexiones valida y no lee ninguna colección.
  Hecho en W1: la conexión de un «Código» da permiso de guardar (AU-176). Hecho en W2: guardar.
- **AU-47** (F14d, pendiente) · El mapa de Boni se calcula de las conexiones y de los pasos «Colección» (A-16): sigue
  diciendo antes de ejecutar qué lee y qué escribe cada automatización.
  En la F14d: lo da `abilities` (`versions.ts`, AU-96) sobre la versión publicada, la misma función que escribe «Lo
  que podrá hacer»: por cada colección, qué pasos la leen, crean, modifican o eliminan, y con qué se inicia. Una
  automatización entra en el mapa al publicarse (AU-61); un borrador no aparece nunca, y lo que cambia en él no mueve
  el mapa hasta publicar. Sus ejecuciones se cuentan por el índice (A-29), y una prueba no cuenta (A-16). Extiende
  el mapa de hoy (`FlowMap.tsx` y su cálculo), que sigue enseñando igual los flujos de antes.
  Lo sostienen `versions.test.ts` (todo cambio que un paso puede hacer, `stepChanges`, está en `abilities`) y
  `publish.test.ts` (el mapa lee la publicada y no el borrador).

**Los permisos de guardar de un «Código»** (Juan, 2026-11-16). Son los de esta tabla, no otros: los mismos permisos,
las mismas celdas y las mismas palabras que tendrá el «Agente» (T-05).

- **AU-176** (F14c, en parte) · El permiso está en la conexión. La de un «Código» siempre lee, dentro de sus límites
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
  pasara la validación con otra. Hasta la F14d (AU-186 a AU-188) un «Sí» pregunta como «Preguntar» (`YES_SAVES`,
  `writes.ts`): el cambio del paso espera a Juan. Falta: las palabras del aviso, con las de `code.colUse` (están en
  `CODE_PROBLEMS`, sin palabras como los demás), la tabla y el botón (pantallas), y que «Sí» guarde (F14d).
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
- **AU-178** (F14c, en parte) · La conexión dice sin abrirla si el código puede cambiar esa colección. Su ficha
  (AU-40): «Solo lee» frente a «Lee y modifica», «Lee, crea y modifica», con «pregunta antes» cuando es «Preguntar»
  («Lee y elimina · pregunta antes»), y «sin preguntar» cuando elimina con «Sí» (AU-189). La frase del paso (AU-44):
  «Puede leer Categorías, y leer y modificar Gastos (solo los de este año). No puede crear ni eliminar nada.»
  En la F14c: las palabras de las acciones son las de AU-85 (Crear, Modificar, Eliminar, en minúscula en la frase),
  de `i18n.ts`, las mismas que la tabla; la ficha y la frase salen de `permissions` (`connections.ts`).
  Hecho en W1: `permissions` da cada acción con su modo. Falta: la ficha y la frase con sus palabras (pantallas).
- **AU-179** (F14c, en parte) · En la vista del paso, cada permiso de guardar dice si el código lo usa, según el
  análisis (AU-183): «Lo usa» o «Sin usar»; y lo que el código usa sin permiso sale en rojo en su fila, con el
  problema de AU-176. Nada más: ni explicaciones ni ayudas dentro de la app.
  En la F14c: es una palabra en la celda («Sí · lo usa»), no una columna más; un permiso «Sin usar» no es un problema
  y no impide probar ni publicar.
  Hecho en W1: `connectionUses`, que de cada acción permitida dice si el código la usa y dónde, y lista la que usa sin
  permiso. Falta: la palabra en la celda y el rojo (pantallas).

### 5.6 El paso «Agente»

Es el ejemplo de Juan: un disparador y, después, una IA conectada a unas colecciones.

- **AU-50** (F15, pendiente) · «Agente» enseña seis cosas: **Instrucciones** (texto, con expresiones), **Modelo**
  (uno de los papeles de «Modelos», con su valor por defecto), **Conexiones** (§5.5), **Lecturas**, **Respuesta** y
  **Se ejecuta** (AU-55).
- **AU-51** (F15, pendiente) · «Lecturas» tiene dos modos. «Las decide la IA» (por defecto): busca en sus conexiones
  lo que necesite. «Las hace este código»: un editor como el de «Código» que lee, cruza colecciones y devuelve lo
  que la IA recibe; entonces la IA no busca por su cuenta.
- **AU-52** (F15, pendiente) · En cada permiso de escribir, los campos se rellenan con el control de «los campos de
  una fila» (AU-80), que aquí, y solo aquí, tiene un tercer estado: cada campo es «Fijo», «Expresión» o «Lo decide la
  IA», con una línea que le dice para qué es. Las opciones salen del propio campo: una IA no puede inventar una
  opción que el campo no tiene.
- **AU-53** (F15, pendiente) · «Respuesta» es «Texto» o «Campos» (una lista de campos con su tipo). Sale como una
  fila que los pasos siguientes citan como cualquier otra.
- **AU-54** (F15, pendiente) · La salida enseña «Lo que hizo» encima de la «Respuesta», y el registro lo mismo: en
  orden y con su coste («2 rondas · 2 llamadas al modelo»). «Buscó 41 filas en Gastos», con el filtro que usó y el
  límite de la conexión; «Propuso 1 fila nueva en Notas: espera tu permiso». En una prueba dice «Propondría…» y
  enseña la fila: no propone nada.
- **AU-55** (F15, pendiente) · «Se ejecuta» tiene dos modos, a la vista como en «Código» (AU-30): «Una vez con todas
  las filas» (por defecto) y «Una vez por fila». Es un parámetro suyo y no un ajuste: «Ajustes» es igual en todos los
  pasos (AU-78). Junto a él se ve lo que cuesta: cuántas filas llegaron en la última prueba y el tope de llamadas a
  modelos de la automatización.
- **AU-56** (F15, pendiente) · Por dentro es el agente de Boni, no un bucle de herramientas: el modelo escribe un
  plan, el código lo interpreta con la política, y lo que las etiquetas dejan ver a un modelo que planifica (los
  datos propios; nunca lo de fuera ni lo privado) vuelve para la ronda siguiente, hasta «Pasos máximos». Hoy el
  chat de una página hace una sola ronda por mensaje; las rondas son lo nuevo.
- **AU-57** (F15, pendiente) · Los otros pasos de IA hacen una cosa cada uno, con los lectores que ya existen:
  «Extraer datos», «Clasificar», «Resumir» y «Escribir texto». El texto de fuera pasa por ellos, no por el agente.
- **AU-58** (F15, pendiente) · Detrás de «Añadir opción»: «Pasos máximos», «Memoria» (en un chat) y «Herramientas
  de código»: funciones con nombre y entradas declaradas que la IA puede llamar, y que corren en la caja.
- **AU-59** (Antes, hecho) · Tarea 124, en el motor de hoy (`docs/nucleo.md` §7.4). Un lector cuya salida no vale se reintenta una vez acortando la entrada y, si vuelve
  a fallar, el paso falla diciendo qué lector y por qué; no para la automatización con un código (hoy:
  `R2-reader-output-invalid`, el fallo del resumen de la mañana). Se arregla ya en el motor de hoy (decisión 7 del
  §10) y el motor nuevo lo hereda con los pasos de IA (F15).

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

**Añadir un paso** (pantalla 3: «¿Cómo empieza?» y «Añadir un paso»)

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
  Hecho en C2: el panel, «¿Cómo empieza?», las tres categorías, «Añadir otro disparador», las acciones de «Colección»,
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
  valor de muestra, que se arrastran), «Tabla» o «JSON». Vacía, dice «Prueba los pasos anteriores» con su botón.
  En la F14b: la cabecera de ENTRADA dice «De «Buscar gastos» · 128 filas» y deja elegir cualquier paso anterior del
  camino para ver y arrastrar sus campos (AU-21). «Combinar» tiene una pestaña por entrada. «Esquema» lista todos los
  campos con el valor de la primera fila, cortado a una línea; con más de diez, lleva un buscador encima; un campo que
  es una fila relacionada o una lista se despliega un nivel. «Tabla» y «JSON» enseñan las primeras 50 filas y, debajo,
  «N filas más», que trae otras 50 del servidor: nunca llegan todas de golpe (A-15). Una tabla con muchos campos se
  desplaza de lado y sus celdas se cortan a una línea.
  Hecho en E: la cabecera con el paso y las filas, elegir un paso anterior, las pestañas de «Combinar», «Esquema»,
  «Tabla» y «JSON», el buscador, desplegar un nivel, 50 filas y «N filas más», y «Prueba los pasos anteriores» con su
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
  automatizaciones se ven y, desde que se pueden publicar (F14d), se ejecutan; no se editan (como hoy).
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
  vacío, «¿Cómo empieza?»; ENTRADA sin datos, «Prueba los pasos anteriores» con su botón; SALIDA sin probar, «Sin
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
- **AU-180** (F14c, en parte) · La tarjeta de un paso que puede cambiar una colección lo dice sin abrirlo, con la
  colección: «Modifica Gastos», «Crea y modifica Gastos», «Cambia Gastos y Notas». Es la misma marca para todo paso
  que guarda: un «Colección» que crea, modifica o elimina, un «Código» que puede guardar y, desde la F15, un «Agente»
  con permiso de escribir. Un código que solo calcula no enseña nada. Eliminar sin preguntar lo dice (AU-189).
  En la F14c: de un «Código» enseña lo que dice el análisis (AU-183), aunque la conexión no lo permita todavía (eso
  es un problema y se marca como tal, AU-83). Cambiar en memoria las filas que le llegan al código (AU-37) no es
  guardar y nunca se marca. La marca va en la línea de las etiquetas de AU-79 y sale de un solo sitio
  (`stepChanges`, `writes.ts`), el mismo que usan «Publicar» y el mapa (AU-47, AU-182).
  Hecho en W2: `stepChanges` da de un «Código» las colecciones y acciones del análisis y de un «Colección» la suya.
  Falta: la marca en la tarjeta (pantallas).

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
- **AU-93** (F14d, pendiente) · «Fijar» guarda la salida de un paso para las pruebas: no se vuelve a ejecutar, y no
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
- **AU-94** (F14b, hecho) · Un disparador se prueba con datos: «Disparado por el usuario» pide sus campos; los de
  colección o de correo, cuando lleguen (F16, F18), dejan elegir una fila reciente («Probar con…», como hoy).
  En la F14b los campos se piden en el cuadro de «Probar» (AU-64) y en la columna ENTRADA del disparador (AU-70); un
  disparador sin campos empieza sin preguntar. Los campos de la última prueba son la fila que dio el disparador en
  ella: no se guardan aparte.
  Hecho en E: todo lo de la F14b.

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

- **AU-95** (F14d, pendiente) · «Publicar» hace del borrador la versión que corre. El borrador, que se guarda solo
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
- **AU-96** (F14d, pendiente) · «Publicar» (pantalla 10) enseña tres cosas: qué cambia respecto a la versión que
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
- **AU-97** (F14d, pendiente) · «Ejecutar» corre la versión publicada: en su fila de la lista, en «⋯» de la cabecera
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
- **AU-98** (F14d, pendiente) · «Versiones»: la lista, ver una, compararla con otra en dos lienzos y volver a una.
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
- **AU-99** (F14d, pendiente) · La pestaña «Ejecuciones» (pantalla 8): a la izquierda la lista, con «Todas | Fallos |
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
- **AU-100** (F14d, pendiente) · En una ejecución: «Deshacer lo que hizo», «Reintentar» y «Abrir en el editor con
  estos datos», que fija la salida del disparador para probar con ella.
  En la F14d: «Deshacer lo que hizo» es AU-18, y solo está si escribió algo. «Reintentar» inicia otra ejecución, de
  la mano de Juan, con los datos del disparador de aquella (sus campos, o la hora que le tocaba) y la versión
  publicada de hoy; si no es la de entonces, lo dice («Correrá la versión 5, no la 4»). Empieza desde el principio:
  si aquella guardó algo antes de fallar, el cuadro lo dice y ofrece «Deshacer y reintentar» además de
  «Reintentar», para no escribirlo dos veces. «Abrir en el editor con estos datos» fija en el borrador la salida que
  dio el disparador (AU-93) y abre el editor. Una prueba solo tiene este último.
  Lo sostienen `runs.test.ts` (reintentar usa los mismos datos y la versión publicada; «Deshacer y reintentar» no
  deja nada dos veces) y `automations-publish.spec.ts` (los tres botones).
- **AU-101** (F14d, pendiente) · El «Registro» del editor, desplegado, enseña la última prueba como un árbol: una
  línea por paso y, dentro de un paso de IA, sus lecturas y escrituras.
  En la F14d: es un solo componente para el «Registro» del editor y para una ejecución de «Ejecuciones», sobre el
  mismo registro: una línea por paso en el orden en que corrió, con su estado, las filas que entraron y salieron y
  lo que tardó. Dentro de un «Código», sus lecturas (`$col`), su «Consola» y lo que guardó, propuso o guardaría
  (AU-181); dentro de un paso de IA, desde la F15. Tocar una línea abre ese paso. Todo se pinta como texto.
  Lo sostiene `automations-publish.spec.ts`: el árbol de una prueba y el de una ejecución son el mismo.
- **AU-102** (F14d, pendiente) · Una ejecución que falla en segundo plano avisa una vez, con el paso y el motivo en
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
- **AU-103** (F14d, pendiente) · Se guardan enteras las últimas 100 ejecuciones o 30 días de cada automatización; de
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
- **AU-190** (F14d, pendiente) · Una ejecución que el servidor dejó a medias al apagarse no se repite sola. Al
  arrancar, toda ejecución que seguía en marcha se cierra como «Interrumpida», diciendo en qué paso estaba. Lo que
  guardaron los pasos que acabaron se queda, y se deshace desde ella (AU-18); un paso nunca queda a medias, porque
  su cambio es una transacción (AU-174). Su hora cuenta como corrida (AU-114). Avisa como un fallo si empezó sola
  (AU-102), y «Reintentar» es de la mano de Juan (AU-100). Repetirla sola escribiría dos veces lo de los pasos que
  ya habían guardado. Decidido por Juan el 2026-11-16 (decisión 12 del §10).
  Lo sostiene `runs.test.ts`: un servidor que arranca con una ejecución en marcha la cierra, no la repite y deja lo
  que guardó.
- **AU-191** (F14d, pendiente) · Una automatización eliminada se recupera. «Eliminar» (AU-62) la apaga y la quita
  de la lista, y guarda su borrador, sus versiones y sus ejecuciones. Además del «Deshacer» de su aviso, que se va,
  la lista tiene «Eliminadas» (en su «⋯»): cada una con «Recuperar», que la devuelve apagada, con todo lo suyo. Una
  eliminada no corre nunca, la inicie quien la inicie, ni entra en el mapa. Borrarla del todo no está en la F14d.
  Extiende `setAutomationDeleted` y la ruta `restore`, que ya existen.
  Lo sostienen `publish.test.ts` (eliminada no corre a su hora ni a mano; recuperada vuelve apagada, con sus
  versiones y sus ejecuciones) y `automations-publish.spec.ts` («Eliminadas» y «Recuperar»).
- **AU-192** (F14d, pendiente) · Cambiar el nombre de una colección no rompe lo publicado. Un «Colección» y una
  conexión guardan la clave de la colección; un «Código» la cita por su nombre (`$col('Gastos')`). Cada versión
  guarda, al publicarse, el nombre con que su código cita cada colección conectada y la clave que era. Al
  ejecutar, el nombre se resuelve primero por ahí, así que la versión publicada sigue leyendo y guardando en la
  misma colección aunque ahora se llame de otra manera. Esto nunca ensancha: la clave tiene que seguir siendo una
  conexión de ese paso, y una colección archivada o eliminada hace fallar el paso diciendo cuál. En el borrador, la
  cita con el nombre viejo es un problema de la validación («`$col('Gastos')`: ahora se llama «Compras»») con un
  botón que la reescribe: el código de Juan lo cambia su mano, no Boni por su cuenta.
  Lo sostienen `versions.test.ts` (lo que una versión guarda de sus nombres) y `runs.test.ts` (tras el cambio de
  nombre, la publicada guarda en la misma colección; sin la conexión, no).
- **AU-194** (F14d, pendiente) · El interruptor dice si corre. Publicar por primera vez la enciende, y la pantalla
  lo dice antes (AU-96); publicar otra versión deja el interruptor como estaba. Apagada, no empieza ninguna
  ejecución de verdad: ni a su hora ni con «Ejecutar». «Probar» va siempre. Encenderla no corre lo que no corrió
  mientras estaba apagada (AU-114). La lista dice «Encendida», «Apagada» o «Sin publicar» (AU-61). Que la primera
  publicación la encienda lo decidió Juan el 2026-11-16 (decisión 12 del §10).
  Lo sostienen `publish.test.ts` (la primera publicación enciende, la segunda no cambia el interruptor; apagada no
  corre) y `automations-publish.spec.ts` (el interruptor y la columna «Estado»).
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
  ejecución de verdad lista lo mismo de lo que guardó o propuso. Falta: «Haría esto» en SALIDA y en el registro
  (pantallas).
- **AU-182** (F14d, pendiente) · Lo que se acepta sin haberlo escrito Juan dice lo que puede cambiar. «Lo que podrá
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
  `publish.test.ts` (la consulta de las colecciones que guardan algo de fuera, en su tiempo), `runs.test.ts` (la
  línea de la ejecución) y `automations-publish.spec.ts` (la pantalla).
- **AU-188** (F14d, pendiente) · Un «Sí» solo lo pone la mano de Juan. Lo que llega sin haberlo escrito él (una
  automatización que propone el asistente, AU-140, o `automations_propose` del MCP, AU-144; «Pedir a Boni» y «Escribir
  con IA», AU-141, AU-39; un paquete o una plantilla, AU-145, AU-146) llega con cada «Sí» de guardar bajado a
  «Preguntar»: en crear, modificar y eliminar, en las conexiones y en «Eliminar filas» (AU-187), una sola regla para
  los tres. Su aceptación dice lo que podrá cambiar (AU-182). El botón que arregla un permiso que falta pone
  «Preguntar» (AU-176). Para que un paso guarde sin preguntar, Juan pone el «Sí» en su celda y publica.
  En la F14d: lo baja una sola función (`lowerYes`, `writes.ts`) por la que pasa todo lo que llega así antes de ser
  borrador. Un «Sí» que el borrador ya tenía de su mano se queda solo si su paso llega igual. Baja el nuevo, el
  cambiado de colección o de acción y, **propuesto en este diseño**, el de un paso que la llegada cambió (su
  código, sus parámetros, su conexión o de dónde le llegan filas): un «Sí» que Juan dio a un código no vale para
  otro código. El servidor lee el «Sí» de la versión publicada que tiene guardada, nunca de la caja, de un navegador
  ni de un modelo.
  Desde la decisión 11 (§10) esta regla lleva más peso: el «Sí» es lo único que separa lo que viene de fuera de
  guardarse sin preguntar. Cada manera en que una celda puede llegar a decir «Sí», y la prueba que la sostiene:

  | Cómo llega | Qué pasa con el «Sí» | Prueba |
  |---|---|---|
  | Su mano en la celda de una conexión o en «Permiso», en el editor (`keepDraft`) | Se queda | `publish.test.ts` («AU-188 · the ways a «Sí» stays…») |
  | Su mano añade un paso «Colección»: «Crear una fila» y «Modificar filas» nacen con «Sí» (AU-187, propuesto) | Se queda. Es el único «Sí» que no es un toque suyo en la celda: duda para Juan | `consent.test.ts` («AU-187 · the value each action is born with…») |
  | «Duplicar» (`duplicateAutomation`) | Copia los suyos sin un toque nuevo; la copia nace sin publicar. Duda para Juan | `publish.test.ts` («AU-188 · the ways a «Sí» stays…») |
  | «Volver a esta» (AU-98) | Vuelve un documento que él publicó: se quedan sin un toque nuevo, y «Publicar» los enseña antes. Duda para Juan | la misma |
  | Recuperar una eliminada (AU-191), con «Recuperar» o con el «Deshacer» de su aviso | Devuelve lo que ya tuvo, sin un «Sí» más, y apagada. Duda para Juan | la misma |
  | «Deshacer» (el del almacén, el de un turno, el de una ejecución) | No toca un borrador ni una versión, que no son operaciones del registro (AU-95): ni devuelve un «Sí» que él quitó ni quita uno que puso | `publish.test.ts` («AU-188 · no Undo gives a «Sí» back…») |
  | El asistente propone o cambia una (`automations.create`, `automations.edit`, A-35; F16) | Baja | `consent.test.ts` («AU-188 · `lowerYes` lowers every «Sí»…») y `publish.test.ts` («AU-188 · every function of the service that writes a draft…»); su caso propio entra con la F16 |
  | `automations_propose` del MCP (AU-144; F16) | Baja | las mismas; su caso, con la F16 |
  | «Pedir a Boni», «Escribir con IA» (F19) | Baja, y también el del paso que reescriben | las mismas y `consent.test.ts` («AU-188 · a «Sí» of a step whose code…»); su caso, con la F19 |
  | Un paquete, una plantilla, importar (AU-145, AU-146; F19) | Baja | las mismas; su caso, con la F19 |
  | Un flujo de antes convertido (F16) | Baja | las mismas; su caso, con la F16 |
  | El cuerpo de una petición, la respuesta de la caja, un borrador, un modelo | No cuenta: el servidor lee lo publicado | `publish.test.ts` («AU-188 · the «Sí» a run obeys…») |
  | Cambiar el nombre de una colección, o crear otra con el nombre de una eliminada (AU-192) | El «Sí» es de la colección por su clave: sigue a la misma y nunca pasa a otra | `runs.test.ts` («AU-188 AU-192 · a «Sí» belongs to its collection by key…») |

  **Sin decidir por Juan** (duda del PR de la tarea 128): «Duplicar», «Volver a esta» y recuperar una eliminada
  dejan un «Sí» sin un toque nuevo en la celda. Se propone que se queden: los tres devuelven un documento cuyo
  «Sí» puso él; «Duplicar» y «Volver a esta» pasan por «Publicar», que lo enseña (AU-182), y la recuperada vuelve
  apagada. La otra respuesta: en la copia y en lo recuperado bajan a «Preguntar», y él los pone otra vez.

  **Propuesto en este diseño**: poner un «Sí» y publicar piden un dispositivo personal, como aceptar una propuesta
  (P21); desde uno compartido el editor deja ver y probar. Lo sostiene `publish.test.ts` («AU-188 · setting a «Sí»
  and publishing are refused…»).
  En la F14d todavía no llega nada sin haberlo escrito él (el asistente es de la F16; los paquetes, de la F19), así
  que la fase deja la función hecha y cerrado el camino: toda función del servidor que escribe un borrador está en
  una lista, como de su mano (el editor, «Duplicar») o como venida de fuera de ella, y las segundas pasan por
  `lowerYes`. Una función nueva que escriba un borrador y no esté en la lista hace fallar la prueba.
  Lo sostienen `consent.test.ts` (`packages/automations`; `lowerYes`: baja crear, modificar y eliminar, en las
  conexiones y en «Permiso»; el que ya era suyo se queda si su paso llega igual; uno cambiado de colección o de
  acción, o de un paso cambiado, baja) y `publish.test.ts` del servidor (la lista de quien escribe un borrador; un
  caso por cada manera que ya existe en la F14d: el editor, «Duplicar», «Volver a esta», recuperar y «Deshacer»;
  las que llegan con la F16 y la F19 traen entonces el suyo, y hasta entonces las sostiene que ninguna función
  escribe un borrador sin estar en la lista; un «Sí» que dice la respuesta de la caja o el cuerpo de una petición
  no cuenta).
- **AU-189** (F14c, en parte) · Eliminar sin preguntar se ve a simple vista, aparte de lo que pregunta, con dos
  palabras, «sin preguntar»: en la ficha de la conexión («Lee y elimina · sin preguntar», AU-178), en la marca de la
  tarjeta («Elimina en Gastos · sin preguntar», AU-180), en «Haría esto» («Eliminaría 3 filas en Gastos · sin
  preguntar», AU-181) y en «Lo que podrá hacer» (AU-182, F14d). Crear y modificar con «Sí» no llevan nada: lo que se
  marca es lo que va a la papelera sin pasar por Juan. Las palabras salen de `i18n.ts`, sin explicaciones dentro de la
  app.
  En la F14c: la ficha, la marca y «Haría esto» salen de `permissions` y `stepChanges`, que dicen el modo de cada
  acción; un «Colección» con «Sí» en «Eliminar filas» (AU-187) se marca igual desde la F14d.
  Hecho en W1: `permissions` dice si eliminar es «Preguntar» o «Sí». Falta: `stepChanges` y las palabras (P2, P3).

### 5.9 Cómo empieza: los disparadores

| Disparador | Cuándo | Qué da | Fase |
|---|---|---|---|
| «Disparado por el usuario» | «Ejecutar» (F14d), un bloque de una página (F17), otra automatización o el asistente (F18) | Los «Campos que pide» | F14a (formato y motor); el lienzo, F14b |
| «Programada» | Reglas legibles: «Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora» | La fecha | F14d |
| «Llega un correo» y los demás de Boni | Como hoy | Lo de hoy | F16 |
| «Mensaje de chat» | Alguien escribe en el chat de una página | El mensaje y los valores de la página | F16 |
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
- **AU-114** (F14d, pendiente) · «Programada» tiene una o más reglas. Si el servidor estaba apagado a su hora, corre
  una vez al volver (lo que queda de D-44).
  En la F14d: una regla es «Cada hora», «Cada día a las 08:00» o «Cada lunes a las 09:00», la forma que ya tienen
  los flujos de antes (`Schedule`), y el disparador lleva una lista de ellas, al menos una. Las horas son de la zona
  de la cuenta (IANA), por `packages/calendar/src/time.ts`: una hora que el cambio de hora se salta o repite corre
  una vez. Da una fila con la fecha: la hora que tocaba, no la hora a la que corrió, así que dos ejecuciones de la
  misma hora calculan lo mismo. El planificador es el de hoy (`flowScheduler.ts`: `dueSlot`, `graceOf`, una vuelta
  por minuto), con las mismas funciones. Corre la última hora cumplida de cualquiera de sus reglas, una sola vez
  aunque coincidan varias, si es posterior a la publicación de la versión que corre, a que se encendió y a la
  última que corrió. Si el servidor estaba apagado, corre al volver solo esa última, y solo dentro del margen de
  D-44 (30 minutos las de cada hora, 3 horas las demás); pasada de margen, queda una línea «No corrió: Boni estaba
  apagado a su hora» en «Ejecuciones» y avisa como un fallo (AU-102). Nunca corre dos veces la misma hora: la
  ejecución guarda la hora que le tocaba y el almacén no admite otra con la misma. Si a su hora sigue corriendo la
  anterior, espera a la vuelta siguiente. Cada vuelta lee las horas de una columna de la automatización, escrita al
  publicar, y no los documentos. Empieza sola, así que la política la trata como dice AU-167. «Probar» le da la
  fecha de ahora (AU-115).
  Lo sostiene `scheduler.test.ts`, con un reloj de la prueba: corre a su hora y una vez; apagado tres horas con
  «Cada hora», corre una; fuera de margen, no corre y lo deja dicho; nada anterior a publicar o a encender; el
  cambio de hora; y una vuelta con 200 automatizaciones programadas dentro de su tiempo (A-15).
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
| Boni | Las piezas de Boni («Leer correo» y las demás) | F16 |

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
- **AU-187** (F14d, pendiente) · Las acciones de un paso «Colección» que escriben («Crear una fila», «Modificar
  filas», «Eliminar filas») llevan el mismo permiso que las columnas de una conexión: un parámetro «Permiso»,
  «Preguntar» o «Sí», con las palabras de AU-41. Con «Sí», lo que el paso guarda o manda a la papelera no pregunta en
  lo que dice AU-186. Hasta el 2026-11-16 eliminar preguntaba siempre (P5), y así un paso que escribió y publicó Juan
  preguntaba más que un código que hiciera lo mismo. Hasta la decisión 11 (§10) solo lo llevaba «Eliminar filas»:
  crear y modificar escribían solos lo propio y proponían lo de fuera, sin celda. Desde ella lo de fuera se guarda
  con un «Sí», y un paso sin celda no tendría ninguno que Juan hubiera puesto ni que `lowerYes` pudiera bajar
  (AU-188).
  **Propuesto en este diseño y sin decidir por Juan** (duda del PR de la tarea 128): con qué valor nace. «Eliminar
  filas» nace con «Preguntar». «Crear una fila» y «Modificar filas» nacen con «Sí» cuando el paso lo añade su mano
  en el editor, a la vista en el paso: es lo que ya hacían (decisión 5: escriben con Deshacer), y «crea una fila
  cada mañana» no debe preguntar cada mañana. Lo que eso trae desde la decisión 11: un paso así guarda sin
  preguntar, desde su primera ejecución publicada, también lo que le llegue de fuera, sin que él haya tocado la
  celda; «Publicar» lo dice en su línea («con datos de fuera», AU-182). Llegados de otra manera nacen con
  «Preguntar» (AU-188). La otra respuesta: nacen con «Preguntar» también de su mano, y hasta que él lo cambie cada
  ejecución deja su propuesta. Es un valor del catálogo y una prueba: su respuesta cambia eso y nada más.
  En la F14d: es un parámetro más de cada una de las tres acciones en el catálogo, a la vista (cambia el resultado:
  AU-77), con las dos palabras de las celdas de una conexión, de las mismas claves de `i18n.ts`. Un documento
  guardado sin él se lee con el valor con el que nace: hasta aquí todo borrador lo escribió su mano. `stepChanges`
  deja de dar eliminar siempre como «Preguntar» y lee el parámetro en las tres, así que la tarjeta («Elimina en
  Gastos · sin preguntar»), «Haría esto» y «Lo que podrá hacer» lo dicen igual que de un «Código» (AU-189).
  `lowerYes` lo baja como una celda (AU-188).
  Lo sostienen `consent.test.ts` (`packages/automations`: el parámetro en las tres acciones, con qué valor nace y lo
  que `stepChanges` da con cada uno) y `automations-publish.spec.ts` (el control y la marca de la tarjeta).
- **AU-123** (F14a, hecho) · «Si» tiene dos salidas, «sí» y «no». «Elegir rama» tiene una por regla y, a la
  vista, «Si ninguna coincide» (nada, o una salida «otras») y «La primera que coincida | Todas las que coincidan».
- **AU-124** (F14a, hecho) · «Combinar» tiene dos entradas con nombre y junta por un campo, por posición o todas
  con todas. Solo hace falta para cruzar; para juntar ramas, no (AU-11).
- **AU-125** (F15, pendiente) · «Preguntar» pregunta a Juan (opciones o texto). En segundo plano espera con un
  «Límite de espera» a la vista; nunca espera para siempre.
- **AU-126** (F14a, hecho) · «Solo si», «Para cada» y «Junto con» dejan de ser campos de todos los pasos: son
  «Si» o «Filtrar», el trabajo por fila del motor y «Combinar».
- **AU-127** (F16, pendiente) · Las piezas de Boni son pasos de la categoría «Boni»: se ven, se conectan y se
  configuran con lo que hoy dejan cambiar. Por dentro siguen siendo código de Boni (decisión 3a de la tarea 103).
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
- **AU-141** (F19, pendiente) · «Pedir a Boni» en el editor: Juan describe un cambio y Boni lo propone sobre el
  borrador, marcando cada paso nuevo, cambiado o quitado, para aceptarlo o no.
- **AU-142** (F18, pendiente) · El asistente puede ejecutar las automatizaciones que lo permiten (AU-111), con
  confirmación (P8).
- **AU-143** (F16, pendiente) · En un turno de la conversación el modelo sigue escribiendo un plan. El plan se
  traduce a pasos de este mismo catálogo y lo corre este motor, así que «Guardar como automatización» lo abre en el
  lienzo tal cual (D-41).
- **AU-144** (F16, pendiente) · MCP: `automations_describe`, `automations_propose`, `automations_test` y
  `automations_runs`. Los `flows_*` siguen una versión como alias.
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
- **AU-151** (F14b, hecho) · Mientras tanto conviven: la lista enseña las dos clases y un flujo de antes abre el
  editor de antes, marcado «formato anterior».
  En la F14b: «Nueva» crea siempre una automatización del formato nuevo. Un flujo de antes abre su editor de siempre,
  con «Formato anterior» junto a su nombre, y sigue encendido, apagado y ejecutándose como estaba.
- **AU-152** (F16, pendiente) · Al terminar se quitan el motor de listas, el editor viejo y sus pruebas, y los
  principios y la guía de diseño se reescriben en el mismo PR.

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
  Falta (la fase que traiga la primera regla de la política que niegue una lectura de una automatización, según la
  tarea 127): esa negación sobre el servidor real. En la F14c no hay ninguna: sobre el servidor real cada lectura de
  una ejecución se deja, y lo comprueba la prueba de AU-174. Su camino por el «Si falla» ya lo prueba E3 con una
  política que niega.
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
- **AU-165** (F15, pendiente) · La política es el suelo. Una conexión, un ajuste o un «Sí» nunca dejan hacer lo que
  `decide` no deja: un destino nunca sale de un dato de fuera ni de un modelo (P2, P14), lo de fuera no escribe lo
  que Boni sabe de Juan (P9), enviar y pagar nunca van solos (fuera de una automatización se confirman, P5; dentro
  de una no existen en estas fases y `decide` los niega, AU-167). Lo de fuera se propone (P4) y eliminar se
  pregunta (P5) salvo en lo que dice AU-186, que es una fila de la política (P28, decisión 11 del §10) y no un
  permiso de la celda.
- **AU-186** (F14d, pendiente) · Lo que no pregunta. Una escritura (crear, modificar o eliminar) se guarda sin
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
  cierra.
  Una escritura pasa dos puertas, en este orden. La primera es la celda de Juan (la de la conexión, o el «Permiso»
  de un paso «Colección», AU-187): «No» hace fallar el paso; «Preguntar» hace esperar el cambio entero del paso como
  propuesta en cualquier ejecución; «Sí» pasa a la segunda. La segunda es la política, que es el suelo: lo que
  ningún «Sí» abre (un destino que sale de algo de fuera o de un modelo, P2 y P14; lo que Boni sabe de Juan, P9;
  enviar, pagar y lo irreversible) y P28, que deja guardar con el «Sí» que el servidor lee de lo guardado.
  Lo que lee una celda «Sí» antes y después. Hasta el primer PR del motor de esta fase, un «Sí» pregunta como
  «Preguntar» (`YES_SAVES` es falso) y, como nada se publica, nada corre de verdad: «Haría esto» dice de un paso
  con «Sí» que preguntaría. Las palabras «sin preguntar» de AU-189 (F14c, en parte: la app aún no las pinta) dirán
  lo contrario en la ficha de la conexión y en la tarjeta de un paso que elimina con «Sí». Si llegan antes que ese
  PR, las dos frases no coinciden en ese rato, y por eso ese PR es el primero. Con él `YES_SAVES` desaparece: un
  paso pregunta si su celda dice «Preguntar», y nada más. Desde entonces crear y modificar con «Sí» no añaden nada
  a «Haría esto», eliminar con «Sí» dice «sin preguntar», y «Probar» dice lo que hará la ejecución, la inicie quien
  la inicie (AU-195).
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
  Lo sostienen `consent.test.ts` (`packages/automations`: las dos puertas, caso por caso, y que una celda nunca
  cambia un «no» de la política), `automation-origin.test.ts` (`packages/agent/test`: la fila P5 con y sin el «Sí»,
  y que fuera de una automatización eliminar sigue confirmando) y `proposal.test.ts` (servidor: una eliminación con
  «Sí» de una versión publicada va a la papelera sin propuesta y se deshace con la ejecución, con algo de fuera
  también; con «Preguntar», se propone).
- **AU-166** (F15, pendiente) · Lo privado no llega a un modelo: se comprueba al publicar donde se puede saber y
  siempre al ejecutar. El paso falla diciendo qué colección y por qué.
- **AU-167** (F14d, pendiente) · Lo que una automatización escribe sola en segundo plano sigue la regla de la
  decisión 5 del §10.
  En la F14d: la decisión 11 del §10 (2026-11-16) cambia la frase de la decisión 5 sobre lo de fuera, y esta
  regla la sigue. `decide` conoce un origen más, `automation`: una ejecución de verdad de una versión publicada, la
  inicie la mano de Juan o empiece sola (AU-195). Su regla es una fila nueva de `docs/nucleo.md` §7.5, P28. Va
  después de P2, P14 y P9, que no cambian, y es la única excepción a P4 y a P15:

  | Lo que escribe un paso de una versión publicada | Qué pasa |
  |---|---|
  | Crear, modificar o mandar a la papelera con el «Sí» de la versión publicada para esa colección y esa acción | Se guarda con el Deshacer de la ejecución, también con algo de fuera en un valor (P4) o en el camino (P15), y conserva su etiqueta (AU-170) |
  | Lo mismo sin ese «Sí» | Crear y modificar se proponen; mandar a la papelera se confirma (P5). Van en la propuesta de la ejecución (AU-193) |
  | Un valor que escribió un modelo, o de un turno ambiental (`model`, `ambient`) | Se propone, hasta que la F15 diga cómo guarda un paso de IA (A11). En esta fase ningún paso llama a un modelo |
  | Un destino que sale de algo de fuera o de un modelo (P2, P14); lo que Boni sabe de Juan (P9) | Se niega, como a cualquier origen |
  | Enviar, salir fuera, pagar, lo irreversible | No existe en estas fases (decisión 9); `decide` lo niega a este origen |

  La segunda fila es una guarda: una celda «Preguntar» ya hace esperar el cambio en la primera puerta (AU-186), y
  esta fila contesta lo mismo si la llamada llega sin el «Sí» leído de lo guardado. El segundo plano de antes no
  cambia: la fila P7 gana «salvo lo que deja P28», y un flujo de los de antes sigue proponiendo. P11 no cuenta para
  este origen: su tope son las filas escritas de la ejecución (AU-17), que Juan ve y cambia. Lo que se propone de
  una ejecución es una sola propuesta (AU-193). Una ejecución que empezó sola y escribió da un aviso por ejecución
  («Tarea de la mañana creó 1 fila en Tareas · Deshacer»), que escribe el código con cuentas y nombres de
  colección, nunca con valores; sale en la app, y al móvil solo van los fallos (AU-102). La que inició su mano lo
  dice en su pantalla. P9 no se toca: un paso solo puede nombrar colecciones que no son del sistema (`shape`,
  `collectionNamed`), así que una automatización no tiene con qué escribir lo que Boni sabe de Juan, traiga lo
  que traiga. Lo que quedaba de AU-185 (la propuesta de P4 sobre el servidor real) lo sustituye la decisión 11:
  sobre el servidor real, una ejecución con algo de fuera lo guarda con su etiqueta si la celda dice «Sí» y lo
  propone si dice «Preguntar», empiece como empiece.
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: una prueba por fila de la tabla, y cada acto de
  `ACTS` con el origen nuevo), `proposal.test.ts` (servidor: las mismas filas con una ejecución programada sobre el
  almacén de verdad, y que ningún paso puede nombrar una colección del sistema) y `scheduler.test.ts` (el aviso por
  ejecución, sin valores).
- **AU-195** (F14d, pendiente) · La misma versión publicada, con la misma entrada, recibe la misma decisión para
  cada escritura (permitir, proponer, confirmar o negar) la inicie Juan o su disparador (decisión 11 del §10,
  2026-11-16). Quién inicia una ejecución no llega a `decide`: llega a `$run`, a «Ejecuciones» y a los avisos.

  | Quién | Origen para `decide` | Qué pasa con una escritura |
  |---|---|---|
  | «Probar», «Probar paso» | `automation`, como prueba | Nada se guarda nunca (AU-90); «Haría esto» dice lo que hará la ejecución |
  | «Ejecutar», «Reintentar», o sola («Programada»; desde la F18, cada disparador) | `automation` | La celda, y después P28 (AU-186, AU-167). Con «Preguntar», todas proponen |
  | Aceptar la propuesta de una ejecución | `accepted` | AU-193 |

  Hoy una ejecución que inicia su mano va con el origen `hand` (P25, `handPolicy`): el primer PR del motor lo cambia
  en `runPolicy`. Una ejecución de verdad de una versión sin publicar no existe: «Ejecutar» corre la publicada
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
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: el principio, con la tabla entera para cada
  manera de empezar), `proposal.test.ts` (servidor: el mismo paso y el mismo valor de fuera, a mano y a su hora;
  con «Sí» las dos lo guardan con su etiqueta, con «Preguntar» las dos lo proponen, y «Probar» no escribe) y
  `scheduler.test.ts` (`$run.startedBy` en cada manera de empezar, y un «Si» sobre él que lleva a una rama a mano
  y a la otra a su hora).
- **AU-168** (F14a, hecho) · Todas las rutas y herramientas de automatizaciones pasan por `decide` desde el
  primer día (A-26). En la F14a todavía no hay rutas ni herramientas: es el motor el que no tiene otro camino a las
  colecciones que la política, y cada lectura y cada escritura le pregunta antes, en una prueba también. En una
  prueba, una escritura permitida no escribe: da la fila como quedaría, y para eso lee la fila guardada sin otra
  pregunta a la política, porque es parte de la escritura que ya se permitió. Lo que sale de un paso que escribe
  lleva las etiquetas que daría leerlo: cada campo guardado la suya, cada campo escrito la del valor que se escribió.
- **AU-170** (F14d, pendiente) · Lo que una automatización guarda conserva de dónde vino: un campo escrito con un
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
  Lo sostienen `consent.test.ts` (`packages/automations`: lo que se pregunta lleva la etiqueta de cada valor) y
  `proposal.test.ts` (servidor: un valor de fuera guardado con «Sí», o propuesto y aceptado, y leído otra vez por
  otra ejecución sigue siendo de fuera; lo que esa escriba con él lo decide su celda, y el asistente lo propone).
- **AU-193** (F14d, pendiente) · Lo que una ejecución pregunta es una sola propuesta en la Bandeja de siempre. Junta
  el cambio entero de cada paso que espera (AU-174), paso por paso, y la ejecución sigue: un paso que espera no da
  filas a los siguientes (AU-14). Espera lo que una celda «Preguntar» hace esperar y lo que escribió un modelo
  (AU-167); desde la decisión 11 (§10), lo de fuera con «Sí» ya no, y es igual la inicie quien la inicie. La tarjeta la pinta el código, con texto y nunca con un resumen de un modelo:
  qué automatización y qué versión, cuántas filas crea, modifica o manda a la papelera en cada colección («Tarea de
  la mañana quiere crear 4 filas en Tareas»), y cada fila con su antes y su después y con la marca de lo que viene
  de fuera. Aceptar es un toque en un dispositivo personal: pasa otra vez por `decide` con el origen «aceptado»
  (satisface P4; nunca P2 ni P3), guarda todo en una transacción, con la ejecución en el registro y cada valor con
  su etiqueta (AU-170), y vale como la confirmación de P5 para las eliminaciones que la tarjeta nombra: hoy `decide`
  confirmaría otra vez un borrado aceptado, y la frase nueva de P5 (AU-186) lo dice para la propuesta de una
  ejecución, que ya es lo que P5 pide (pintada por el código desde el cambio real, aceptada en un dispositivo
  personal). Solo la papelera: lo irreversible sigue sin existir aquí, y ninguna otra propuesta gana esto. Lo aceptado
  se deshace con la ejecución (AU-18). Si una fila cambió desde que se propuso, no se guarda ninguna y la propuesta
  queda «Ya no vale · Ejecutar otra vez». Rechazar no guarda nada, y la ejecución lo dice. Nada de esto es nuevo en
  la Bandeja: extiende `proposals` y `acceptProposal`, con una acción más en la lista (A-26).
  Lo sostienen `automation-origin.test.ts` (`packages/agent/test`: un borrado aceptado en la propuesta de una
  ejecución no se confirma otra vez, y el de cualquier otra propuesta sí) y `proposal.test.ts` (servidor): una
  propuesta por ejecución con dos pasos que esperan; aceptar guarda
  todo o nada; una fila cambiada la deja sin valer; rechazar no escribe; desde un dispositivo que no es personal no
  se acepta; y un texto con HTML en un valor se lee letra por letra en la tarjeta (`automations-publish.spec.ts`).
- **AU-171** (F15, pendiente) · Lo que devuelve una escritura pasa por los límites de lectura de quien la pide: solo
  las filas y los campos que su conexión le deja leer. Sin permiso de leer, devuelve lo que escribió y nada más, en
  una prueba también. Hasta la F15 solo escriben los pasos de «Colección» que pone Juan, que no llevan límites de
  conexión.
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
- **AU-185** (F14c, en parte) · Lo que guarda un código es un cambio de su paso, como el de un «Colección»: lleva
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
| **F14c** JavaScript | JavaScript en las expresiones, «Código», conexiones con sus límites, «Consola»; el código que guarda por su conexión, con su análisis (Juan, 2026-11-16) | Escribe el código del §5.4, lo prueba y ve su `console.log`; citar una colección sin conectar le dice cómo arreglarlo; un código que guarda lo dice en su tarjeta y en su conexión, «Probar» enseña lo que guardaría, y sin permiso le dice cómo arreglarlo | en curso |
| **F14d** Publicar | Publicar y versiones, encender y «Ejecutar», «Ejecuciones», «Fijar», «Programada», los ajustes y topes de la automatización, la regla de segundo plano para lo que no es de modelo | Publica una programada que crea una fila cada mañana, la ve en «Ejecuciones» y la deshace desde ahí. Desde la F14c: «Publicar» dice lo que cada «Código» puede cambiar antes de que corra solo, y lo que pide con «Preguntar» llega a la Bandeja como una propuesta (AU-174, AU-182). Desde el 2026-11-16: lo que no pregunta (AU-186, que cambia la fila P5 para una automatización), «Eliminar filas» con «Sí» (AU-187), un «Sí» solo de su mano (AU-188) y «sin preguntar» en «Lo que podrá hacer» (AU-189). Desde su diseño (tarea 128): quién inicia una ejecución y con qué origen (AU-195), la propuesta de una ejecución (AU-193), el interruptor (AU-194), una eliminada se recupera (AU-191), una interrumpida no se repite sola (AU-190) y cambiar el nombre de una colección no rompe lo publicado (AU-192). Desde la decisión 11 (2026-11-16): quién la inicia no cambia lo que guarda, y con «Sí» guarda también lo que viene de fuera, con su etiqueta (AU-186, AU-167, AU-195, AU-170) | en curso |
| **F15** La IA | «Agente» con conexiones y límites, los otros pasos de IA, «Preguntar», «Avisar», «Responder» | Monta el «Analista» del ejemplo: lee Gastos y Categorías, propone una nota; quitarle «Leer» de Gastos hace que diga que no puede; ve cada lectura en el registro. Desde la F14c: el código dentro de un paso de IA («Las hace este código», «Herramientas de código»: AU-51, AU-58) tiene los mismos permisos y el mismo análisis que un «Código» (AU-176, AU-183); los límites de cada acción (AU-48) valen para los dos. Desde el 2026-11-16: la tabla del «Agente» es la de «Código», y eliminar también puede ser «Sí» (AU-41, AU-186); Juan lo limita con las celdas, los límites de la conexión y los de cada acción. La F15 abre con el diseño de lo que Boni aprende de sus respuestas, fuera de las automatizaciones (decisión 10 del §10) | pendiente |
| **F16** Lo de antes | Sus flujos y los de Boni convertidos; el chat de página como automatización; el editor y el motor viejos, fuera; el MCP | «Leer correo» abre en el lienzo nuevo con sus piezas y sigue leyendo el correo igual; no queda ningún «formato anterior» | pendiente |
| **F17** Páginas | Nombres de bloques, eventos, quién puede iniciarla («Páginas»), pasos de «Página», bloques con datos de una automatización, el menú de fila | En una página, un botón «Calcular» toma el mes y la categoría de dos controles y pinta una gráfica con lo que calcula una automatización; otro, «Explicar», se los pasa a un «Agente» y su respuesta sale en un texto de la página | pendiente |
| **F18** Más maneras | «Cuando cambia una colección» con sus topes, «Al subir un archivo», «Falla una automatización», «Llamar automatización», «Esperar», «Por tandas» | Los dos ejemplos de la tarea 88: el aviso por un movimiento grande llega una vez, y marcar hecha una tarea que se repite crea la siguiente con Deshacer; un ciclo no se puede publicar | pendiente |
| **F19** Lo demás | Paquetes (tarea 89), «Pedir a Boni», «Escribir con IA», plantillas, funciones guardadas | Pide en el editor «añade un aviso si se pasa del presupuesto» y acepta el cambio marcado paso a paso | pendiente |

El lienzo (F14b) se enseña a Juan en cuanto se puede tocar, antes de seguir: si la forma no le vale, se cambia ahí y
no cuatro fases después.

Lo que sale fuera (peticiones HTTP, webhooks, credenciales, enviar un correo) no está en estas fases (decisión 9 del
§10): irá después, en una fase propia (F20), con su diseño antes.

Las tareas de la cola (2026-11-15): «Antes» es la 124; la F14a, la 125; la F14b, la 126; la F14c, la 127; la F14d,
la 128; la F15, la 129; la F16, la 130; la F17, lo abierto de la 87; la F18, la 88; la F19, la 89.

## 9. La cola, adaptada

Decidido por Juan el 2026-11-15 (decisión 8 del §10) y aplicado a la cola ese día.

| Tarea | Qué le pasa |
|---|---|
| **103** La explicación de los flujos | Se cierra con este documento. Sus decisiones: la 1 la decide el mensaje de Juan; la 2 es la decisión 5 de aquí; la 3 queda en 3a (AU-127); la 4 es el «Antes» del §8; la 5 y la 7 son este apartado; la 6 (los destinos de la Decisora) sigue siendo suya y se pregunta al convertir «Leer correo» (F16) |
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
| Al conectar, solo leer (AU-41) | Una conexión nueva no tiene ningún permiso de escribir | F14c |
| Segundo plano: quién escribe solo (decisión 5; cambia P7) | Una fila por caso de la regla | F14d, F15 |
| La misma versión publicada recibe las mismas decisiones la inicie Juan o su disparador (AU-195, decisión 11; A-36) | Para cada acto, cada etiqueta y cada celda, `decide` contesta lo mismo a mano y sola; con «Preguntar», las dos proponen | F14d |
| Solo no pregunta lo publicado y con el «Sí» de Juan (AU-186, AU-188; cambia P5 en una automatización, 2026-11-16; desde la decisión 11, también con algo de fuera) | Una eliminación con «Sí» de un «Código», un «Colección» o un «Agente» publicados va a la papelera sin propuesta y se deshace con la ejecución, con algo de fuera también; con «Preguntar», se propone; un «Sí» que no puso su mano baja a «Preguntar»; fuera de una automatización, P5 sigue | F14d, F15 |
| Una automatización llama a otra solo con permiso, tres niveles, sin ciclos (AU-112; cambia D-44) | Sin permiso no se puede elegir; un ciclo no publica | F18 |
| Un bloque tiene nombre único en su página (AU-130) | Dos bloques no pueden llamarse igual; renombrar no rompe lo enlazado | F17 |
| Un fallo no hace una cadena (AU-118) | Una automatización iniciada por «Falla una automatización» que falla no inicia otra | F18 |
| Instalar un paquete no publica nada (AU-145) | Tras instalarlo, todas sus automatizaciones están sin publicar | F19 |
| Cambiar una función guardada no cambia lo que ya corre (AU-147) | Cambiarla y ejecutar la versión publicada: calcula lo de antes | F19 |
