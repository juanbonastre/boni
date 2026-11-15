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
  recorre listas, consulta colecciones con filtros y cruza unas con otras. Corre en la caja y nunca escribe:
  escribir es cosa de los pasos «Colección» y de las conexiones del agente, que decide la política.
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
  se propone (P4), eliminar se confirma (P5).
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
- **AU-03** (F14a, hecho) · Un paso tiene una entrada y una o más salidas con nombre («sí» y «no» en «Si»,
  «error» si se pide). A una entrada pueden llegar varias flechas y de una salida pueden salir varias. Las
  excepciones las dice el catálogo: un disparador no tiene entrada, «Combinar» tiene dos con nombre (AU-124) y
  «Parar con error» no tiene salida.
- **AU-04** (F14a, hecho) · Por las flechas pasan filas: objetos con campos. Una fila leída de una colección
  recuerda de qué fila guardada viene, para poder modificarla o eliminarla después sin buscarla otra vez.
- **AU-05** (F14b, pendiente) · El sitio de cada paso se guarda aparte de la automatización. Mover un paso no hace
  una versión ni enciende «Publicar»; un paso sin sitio lo coloca Boni junto al paso del que cuelga; «Ordenar»
  recoloca todo. (Cambia I-26; decisión 2 del §10.)
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
- **AU-18** (F14d, pendiente) · Todo lo que una ejecución escribe es un solo grupo en el diario: se deshace entero
  desde la ejecución.
- **AU-19** (F14a, hecho) · Cada operación de un paso lleva en el catálogo si lee o escribe y si destruye, y de
  ahí salen su efecto para la política, el mapa y la lista de acciones (A-26, tarea 95). No hay una lista aparte.
  En la F14a: el catálogo, y lo que el motor le dice a la política de cada lectura y escritura; el mapa (AU-47) y
  las rutas llegan con sus fases y leen lo mismo.

### 5.3 Los valores: fijo o expresión

- **AU-20** (F14b, pendiente) · Un parámetro que es un valor es «Fijo» (su control: texto, número, fecha, una opción
  del campo, una fila) o «Expresión». Se cambia con un botón pequeño, «{ }», dentro del propio control y siempre a
  la vista; arrastrarle un campo lo cambia también. Hasta la F14c una expresión es texto con citas (AU-21), que
  resuelve el servidor (AU-162); el JavaScript llega con la F14c (AU-22).
- **AU-21** (F14b, pendiente) · Arrastrar un campo de «Entrada» a un parámetro lo cita. Una cita sencilla se ve
  como una ficha con el icono de su paso y el nombre del campo («Importe mínimo»), nunca como código; si dos pasos
  tienen un campo que se llama igual, la ficha lleva también el paso («Buscar gastos › Importe»).
- **AU-22** (F14c, pendiente) · Una expresión es texto con JavaScript entre `{{ }}`:
  `Hola {{ $json.nombre }}, llevas {{ $('Sumar gastos').first().total }} € este mes`. Escribir `{{` en un valor fijo
  lo pasa a expresión.
- **AU-23** (F14c, pendiente) · Debajo de una expresión se ve lo que vale con la fila actual («= 5 · con la fila 3
  de 128»), y se pasa de fila. Si no se puede calcular dice qué hacer: «Prueba los pasos anteriores».
- **AU-24** (F14c, pendiente) · Lo que se puede citar, igual en expresiones y en «Código»: `$json` (la fila actual),
  `$input` (`.all()`, `.first()`, `.last()`, `.item`), `$('Nombre de un paso')`, `$now` y `$today`, `$run` (si es
  prueba, quién la inició), `$page` (los valores de la página que la inició: F17) y las ayudas de fechas, texto y
  listas.
  Los nombres son los de n8n donde la cosa es la misma (decisión menor del §10).
- **AU-25** (F14c, pendiente) · Los campos se citan por su clave (`$json.importe`); la entrada, el autocompletado y
  las fichas enseñan su nombre («Importe»). Una clave solo se ve donde se escribe código (excepción a I-08): en una
  expresión, en un «Código» y, en la vista de un paso «Código», al lado del nombre de cada campo de su entrada, que
  es donde hace falta para citarlo. Un campo que nace en un «Código» o en una expresión no tiene más nombre que el
  que ahí se le dio, y con ese se ve en los pasos siguientes (`gastado`).
- **AU-26** (F14a, hecho) · Lo que da forma al paso no puede ser una expresión: la colección, la acción, el modo.
  Se lee en el lienzo y el mapa lo sabe antes de ejecutar (D-48).
- **AU-27** (F14c, pendiente) · La vista previa y la ejecución usan el mismo motor de JavaScript, la caja: lo que
  enseña la vista previa es lo que saldrá.
- **AU-28** (F14c, pendiente) · Las fechas tienen una ayuda propia y pequeña sobre `packages/calendar/src/time.ts`
  (`$now.plus({days: 7})`, `.startOf('month')`, `.format(…)`), con la zona horaria de Juan. La caja no tiene `Intl`,
  así que no se promete la biblioteca de fechas de n8n entera.

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

- **AU-30** (F14c, pendiente) · «Código» es JavaScript. Su parámetro «Se ejecuta» tiene dos modos, a la vista: «Una
  vez con todas las filas» (por defecto) y «Una vez por fila». Devuelve filas.
- **AU-31** (F14c, pendiente) · Lee colecciones solo por las conexiones del paso: `$col('Gastos').find({ where,
  sort, limit })`, `.get(id)`, `.count(…)`, `.sum('importe', …)`. `where` es el mismo filtro de las vistas, escrito
  como una lista de reglas: `[{ field: 'importe', op: 'gt', value: 50 }]`. Citar una colección que el paso no tiene
  conectada no pasa la validación (ni se prueba ni se publica): dice «Conecta «Gastos» a este paso», con el botón
  para hacerlo.
- **AU-32** (F14c, pendiente) · El código nunca escribe (A-09 se queda). Devuelve filas y las escriben los pasos
  «Colección» que le siguen, que pasan por la política.
- **AU-33** (F14c, pendiente) · `console.log` se ve en la «Consola» del paso, una franja plegable debajo de su
  salida, con la línea que lo escribió. Un error señala su línea en el editor y dice el mensaje tal cual.
- **AU-34** (F14c, pendiente) · Sin red, sin ficheros, sin reloj propio (`$now` es la hora de la ejecución) y con el
  azar sembrado: repetir una ejecución da lo mismo.
- **AU-35** (F14c, pendiente) · La caja tiene tiempo, memoria y tamaño máximos. Pasarse dice cuál y por cuánto.
- **AU-36** (F14c, pendiente) · El editor completa los pasos anteriores, los campos por su nombre y las colecciones
  conectadas, y marca lo que no existe antes de probar.
- **AU-37** (F14c, pendiente) · Una evaluación no deja nada a la siguiente: ni variables ni prototipos cambiados.
- **AU-38** (F14c, pendiente) · Lo que cuesta evaluar una expresión por fila se mide con 3.000 filas antes de salir
  (A-15), y un paso «por fila» manda las filas a la caja por tandas, no de una en una.
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
  remove: false | { mode: "ask"; where?: FilterItem[] };   // to the trash; never "yes"
}
```

- **AU-40** (F14c, pendiente) · Una conexión une un paso con una colección y dice qué puede hacer en ella: leer,
  crear, modificar, eliminar. En el lienzo cuelga debajo del paso con una línea de puntos: una ficha por colección,
  con sus permisos en palabras («Lee · solo este año», «Crear: pregunta antes»).
- **AU-41** (F14c, pendiente) · En la vista del paso es una tabla: una fila por colección y una columna por acción.
  Leer es «No» o «Sí»; crear y modificar, «No», «Preguntar» o «Sí»; eliminar, solo «No» o «Preguntar», y manda a la
  papelera. Al conectar una colección solo se lee; cada permiso de escribir se da a mano. La fila se abre para poner
  los límites de cada acción (AU-43, AU-48), y un permiso con límites lo dice en su celda: «Sí · con filtro». En
  «Código» la tabla solo tiene la columna de leer; las de escribir llegan con el «Agente» (F15).
- **AU-42** (F15, pendiente) · «Preguntar» es una propuesta: en una conversación, una tarjeta para aceptar o no; en
  segundo plano, espera en la Bandeja. La ejecución no se queda esperando: termina, y en «Ejecuciones» dice «1
  propuesta sin responder». «Sí» escribe con Deshacer.
- **AU-43** (F14c, pendiente) · Leer puede llevar «Solo estas filas» (el filtro de las vistas), «Solo estos campos»
  y un límite. El filtro se suma a todo lo que el paso busque: puede estrechar, nunca ensanchar.
- **AU-48** (F15, pendiente) · Cada acción de escribir lleva los suyos: modificar y eliminar, «Solo estas filas»;
  crear y modificar, «Solo estos campos». Por ejemplo, modificar solo la «Categoría» de los gastos que no la tienen.
  Crear puede llevar valores fijos que la IA no elige.
- **AU-44** (F14c, pendiente) · Una frase calculada resume todas las conexiones de un paso, debajo de su tabla:
  «Puede leer Gastos (solo los de este año) y Categorías, y proponer filas nuevas en Notas. No puede modificar ni
  eliminar nada.» En la F14c dice solo lo que lee; lo de proponer y escribir llega con el «Agente» (F15). Al
  publicar, otra igual resume la automatización entera («Lo que podrá hacer», AU-96).
- **AU-45** (F15, pendiente) · Una conexión solo restringe. Nunca deja hacer lo que la política no deja: un dato de
  fuera se propone aunque diga «Sí», una colección privada no se puede conectar a un paso de IA, eliminar se
  pregunta siempre.
- **AU-46** (F14c, pendiente) · Las usan «Código» (solo leer: sus colecciones, cada una con sus límites de lectura),
  «Agente» (todo: F15) y el chat de una página (F16: sustituyen a su lista fija de cinco acciones).
- **AU-47** (F14d, pendiente) · El mapa de Boni se calcula de las conexiones y de los pasos «Colección» (A-16): sigue
  diciendo antes de ejecutar qué lee y qué escribe cada automatización.

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

- **AU-60** (F14b, pendiente) · La sección se llama «Automatizaciones» en la barra lateral, la conversación, el mapa,
  el MCP y la documentación.
- **AU-61** (F14b, pendiente) · La lista sigue siendo una página de colección, «Tabla | Mapa», con seis columnas:
  Nombre · Se inicia (su disparador) · Estado («Encendida», «Apagada» o «Sin publicar») · Última ejecución ·
  Ejecuciones · De («Tú», «Boni» o «Página «Gastos»»). «Nueva» abre el lienzo vacío. Las que inicia el usuario llevan
  «Ejecutar» en su fila desde que se puede publicar (AU-97, F14d). Hasta entonces, una del formato nuevo dice «Sin
  publicar» y no tiene ejecuciones; «Encendida» y «Apagada» las dicen solo los flujos de antes (AU-151).

**El editor** (pantalla 2)

- **AU-62** (F14b, pendiente) · La cabecera tiene seis cosas propias: volver y el nombre (se edita ahí), las pestañas
  «Editor | Ejecuciones», «Guardado» (el borrador se guarda solo; dice además «cambios sin publicar» o «publicada la
  versión 3»), el interruptor de encendida, «Publicar» y «⋯» (Ejecutar, Versiones, Duplicar, Ajustes, Eliminar).
  Debajo no hay más barras, y al lado solo lo que la barra de Boni lleva en todas las pantallas (plegar la barra
  lateral y la «Bandeja»). La F14b pone lo que no depende de publicar: volver y el nombre, «Guardado» y «⋯» con
  Duplicar y Eliminar. Las pestañas, el interruptor, «Publicar» y el resto de «⋯» llegan con la F14d (AU-17, AU-95 a
  AU-99), al sitio que aquí tienen.
- **AU-63** (F14b, pendiente) · El lienzo va de izquierda a derecha. Un paso es una tarjeta con su icono, su nombre y
  una línea que resume lo que hace («Gastos · este mes · hasta 500»). Las salidas están a la derecha con su nombre;
  las conexiones cuelgan debajo (desde la F14c: AU-40).
- **AU-64** (F14b, pendiente) · Abajo a la izquierda: acercar, alejar, encajar y «Ordenar». Abajo en el centro:
  «Probar», que ensaya la automatización entera. En el editor solo se prueba (entera aquí; un paso, con «Probar
  paso»: AU-66 y AU-73); «Ejecutar», que corre la versión publicada, está en «⋯» (AU-97). Arriba a la derecha: «+».
  Abajo, plegado, el «Registro», que resume la última prueba en una línea (se despliega desde la F14d: AU-101).
- **AU-65** (F14b, pendiente) · Un paso se añade de cuatro maneras, y las cuatro abren el mismo panel: el «+» de
  arriba, el «+» de una salida sin conectar (o arrastrar desde ella), el «+» de una flecha seleccionada y el clic
  derecho en el lienzo (I-24 se queda).
- **AU-66** (F14b, pendiente) · Un paso seleccionado enseña una barra corta: Probar paso · Apagar · Eliminar · ⋯; una
  flecha seleccionada, «+» y eliminar. El clic derecho da lo mismo y poco más (cambiar nombre, duplicar, copiar).
  Nada sale solo al pasar el ratón.
- **AU-67** (F14b, pendiente) · Después de probar, cada flecha dice cuántas filas pasaron y cada paso cómo acabó. Una
  salida sin conectar también enseña su cuenta: ninguna fila desaparece sin que se vea. Un paso que falló lo dice en
  su tarjeta, con el motivo, y los que colgaban de él quedan «saltados».
- **AU-68** (F14b, pendiente) · Deshacer y rehacer en el lienzo, y copiar y pegar pasos, con las teclas de siempre.

**Añadir un paso** (pantalla 3: «¿Cómo empieza?» y «Añadir un paso»)

- **AU-69** (F14b, pendiente) · Un panel a la derecha con el buscador arriba. En un lienzo vacío pregunta «¿Cómo
  empieza?» y lista los disparadores; después, las ocho categorías del §5.10, dichas por lo que se quiere hacer:
  «Leer o escribir en una colección», «Transformar filas», «Decidir el camino», «Escribir código», «Usar IA»,
  «Preguntar o avisar», «Actuar en una página» y «Piezas de Boni»; al final, «Añadir otro disparador». Cada paso
  está en una sola categoría. «Colección» enseña después sus acciones como frases («Buscar filas», «Crear una
  fila»). Al elegir, el paso queda conectado y se abre. Una categoría aparece cuando su fase la construye (§5.10).

**La vista del paso** (pantallas 4 a 7 del boceto)

- **AU-70** (F14b, pendiente) · Doble clic o Intro abre el paso encima del lienzo en tres columnas: ENTRADA ·
  «Parámetros | Ajustes» · SALIDA. `Esc` cierra. No hay «Guardar».
- **AU-71** (F14b, pendiente) · ENTRADA dice de qué paso viene y se ve como «Esquema» (por defecto: los campos con un
  valor de muestra, que se arrastran), «Tabla» o «JSON». Vacía, dice «Prueba los pasos anteriores» con su botón.
- **AU-72** (F14b, pendiente) · SALIDA se ve como «Tabla» (por defecto; «Esquema» si sale una sola fila), «Esquema»
  o «JSON», con cuántas filas y una pestaña por salida («sí (3)», «no (125)»). En una prueba, un paso que escribe
  enseña «Haría esto», con el antes y el después de cada fila. Su cabecera lleva «Fijar» desde la F14d (AU-93);
  «Código» añade debajo su «Consola» (AU-33) y «Agente», encima, «Lo que hizo» (AU-54).
- **AU-73** (F14b, pendiente) · Arriba a la derecha está «Probar paso». Si no se puede pulsar, dice por qué.
- **AU-74** (F14b, pendiente) · En una ventana estrecha, Entrada y Salida pasan a ser pestañas. En el teléfono las
  automatizaciones se ven y, desde que se pueden publicar (F14d), se ejecutan; no se editan (como hoy).

**Contra el mar de opciones** (C2 y C8: cada regla con su prueba)

- **AU-75** (F14b, pendiente) · Ninguna acción de ningún paso enseña más de siete parámetros antes de «Añadir
  opción». Una lista (condiciones, los campos de una fila, las conexiones) cuenta como uno, y lo que hay dentro de
  una de sus filas no se ve hasta abrirla. Una prueba recorre el catálogo y falla si alguna se pasa.
- **AU-76** (F14b, pendiente) · Lo opcional se añade con «Añadir opción» y queda como una fila que se puede quitar.
- **AU-77** (F14b, pendiente) · Una opción que cambia qué filas salen o por dónde nunca está detrás de «Añadir
  opción»: es un parámetro a la vista. El catálogo la marca y una prueba lo comprueba.
- **AU-78** (F14b, pendiente) · «Ajustes» es igual en todos los pasos y tiene seis filas (pantalla 7): Si falla ·
  Reintentar (las dos, AU-16) · Seguir sin filas (AU-14) · Solo la primera fila (el paso trabaja con la primera que
  llegue y no con las demás) · Nota (un texto de Juan para acordarse de algo) · Apagado (el paso no corre y las
  filas pasan tal cual).
- **AU-79** (F14b, pendiente) · Todo ajuste u opción que no esté en su valor por defecto se ve en la tarjeta del
  paso, como una etiqueta corta («Reintenta 2 veces», «Nota»), y en la pestaña «Ajustes», que cuenta lo cambiado. Si
  además cambia las filas que salen («Solo la primera fila», «Seguir sin filas», «Apagado»), lo dice también encima
  de la salida. Nada cambia lo que hace un paso desde un sitio que no se ve.
- **AU-80** (F14b, pendiente) · Todos los pasos se hacen con los mismos nueve controles: un valor (texto, número,
  fecha), elegir, sí o no, una lista de filas, condiciones, los campos de una fila, un selector (colección, fila,
  paso, automatización, bloque), código y la tabla de conexiones (los dos últimos llegan con la F14c). Un tipo de
  paso no puede traer un control suyo.
- **AU-81** (F14b, pendiente) · Las condiciones son siempre el filtro de las vistas: «todas» por defecto, grupos «y»
  u «o» de un nivel, operadores según el tipo del campo, y el valor, fijo o una expresión (AU-20); el de un control
  de la página se cita como cualquier otro (`$page.mes`, F17). Modificar y eliminar piden al menos una condición (lo
  comprueba la validación: AU-121).
- **AU-82** (F14b, pendiente) · Cambiar la acción de un paso conserva lo que las dos comparten y dice lo que se va,
  con Deshacer. Nada escrito se pierde en silencio.
- **AU-83** (F14b, pendiente) · Un parámetro obligatorio vacío no se marca hasta salir de él, probar o publicar.
- **AU-84** (F14b, pendiente) · Cada estado vacío, viejo o de error dice qué hacer después, y un error nombra el
  parámetro que lo causa.
- **AU-85** (F14b, pendiente) · Una palabra por acción: una prueba comprueba que cada acción («Probar paso», «Añadir
  opción» y, cuando lleguen, «Fijar» y «Publicar») sale de una sola clave de `i18n.ts`.
- **AU-86** (F14b, pendiente) · Un paso nuevo se llama como lo que hace («Buscar filas en Gastos») y el nombre sigue
  a sus parámetros hasta que Juan lo cambia.
- **AU-87** (F14b, pendiente) · Boni no mete pasos por su cuenta: lo que hay en el lienzo lo puso Juan o lo aceptó.

### 5.8 Probar, publicar y ejecuciones

- **AU-90** (F14b, pendiente) · «Probar» ensaya el borrador entero desde un disparador: lee y calcula de verdad,
  llama a los modelos de verdad, y no escribe, no avisa y no propone (D-43). Un paso que escribiría saca la fila que
  crearía, para que lo que sigue continúe.
- **AU-91** (F14b, pendiente) · «Probar paso» ensaya ese paso y solo lo que le falte de los anteriores; reutiliza lo
  ya calculado si no ha cambiado. Qué está viejo lo decide el servidor comparando cada paso con el que produjo los
  datos.
- **AU-92** (F14b, pendiente) · La salida de un paso que cambió después de probar se marca «puede estar vieja».
- **AU-93** (F14d, pendiente) · «Fijar» guarda la salida de un paso para las pruebas: no se vuelve a ejecutar, y no
  gasta modelo. Lo fijado se ve en la tarjeta («Salida fijada») y nunca vale en una ejecución de verdad. Se suelta en
  el mismo botón.
- **AU-94** (F14b, pendiente) · Un disparador se prueba con datos: «Disparado por el usuario» pide sus campos; los de
  colección o de correo, cuando lleguen (F16, F18), dejan elegir una fila reciente («Probar con…», como hoy).
- **AU-95** (F14d, pendiente) · «Publicar» hace del borrador la versión que corre. El borrador, que se guarda solo
  desde la F14b (AU-62), nunca corre de verdad (D-55): lo que escribe de verdad es siempre una versión publicada, así
  que cada escritura tiene su versión.
- **AU-96** (F14d, pendiente) · «Publicar» (pantalla 10) enseña tres cosas: qué cambia respecto a la versión que
  corre; lo que falta o conviene mirar, con un enlace a cada paso (una salida sin conectar, por ejemplo); y «Lo que
  podrá hacer», la frase calculada de lo que lee, propone y escribe cuando corra sola. Con problemas en pasos a los
  que llega un disparador no se publica.
- **AU-97** (F14d, pendiente) · «Ejecutar» corre la versión publicada: en su fila de la lista, en «⋯» de la cabecera
  del editor y en el aviso que sale al publicar («Publicada la versión 4 · Ejecutar»). Desde la F17, también un
  bloque de una página (AU-131).
- **AU-98** (F14d, pendiente) · «Versiones»: la lista, ver una, compararla con otra en dos lienzos y volver a una.
  Las de Boni dicen «De Boni» y se puede volver a la suya, como hoy.
- **AU-99** (F14d, pendiente) · La pestaña «Ejecuciones» (pantalla 8): a la izquierda la lista, con «Todas | Fallos |
  Pruebas» (cuándo, cómo acabó, cuánto tardó, qué la inició, qué versión; las pruebas, marcadas); a la derecha el
  lienzo de esa ejecución, solo para ver, con sus filas en cada flecha y, encima, lo que hizo en una línea. Abrir un
  paso enseña lo que entró y lo que salió.
- **AU-100** (F14d, pendiente) · En una ejecución: «Deshacer lo que hizo», «Reintentar» y «Abrir en el editor con
  estos datos», que fija la salida del disparador para probar con ella.
- **AU-101** (F14d, pendiente) · El «Registro» del editor, desplegado, enseña la última prueba como un árbol: una
  línea por paso y, dentro de un paso de IA, sus lecturas y escrituras.
- **AU-102** (F14d, pendiente) · Una ejecución que falla en segundo plano avisa una vez, con el paso y el motivo en
  palabras, y el aviso lleva a ella.
- **AU-103** (F14d, pendiente) · Se guardan enteras las últimas 100 ejecuciones o 30 días de cada automatización; de
  las anteriores, solo el resumen (A-29).

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
- **AU-115** (F14b, pendiente) · Toda automatización se puede probar a mano, tenga el disparador que tenga.
- **AU-116** (F17, pendiente) · El panel de un disparador lista quién la inicia hoy: qué botones de qué páginas y
  qué automatizaciones. Se calcula, no se declara (A-16).
- **AU-117** (F18, pendiente) · «Al subir un archivo» elige una colección y, si se quiere, la clase de archivo. Da
  la fila con su archivo. Lo que se lee de un archivo cuenta como de fuera: lo que la automatización escriba a
  partir de él se propone (decisión 5 del §10).
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
  relacionadas» (un nivel: `$json.categoria.nombre`).
- **AU-121** (F14a, hecho) · Crear y modificar enseñan el formulario de la fila: solo los campos que Juan añade,
  cada uno con el control de su tipo. Modificar y eliminar actúan sobre «Las filas que llegan» (por defecto si
  vienen de esa colección) o sobre «Las que cumplan…», que pide al menos una condición: sin ella la automatización
  no es válida.
- **AU-122** (F14a, hecho) · «Eliminar filas» manda a la papelera. Borrar del todo no existe en una
  automatización.
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
- **AU-151** (F14b, pendiente) · Mientras tanto conviven: la lista enseña las dos clases y un flujo de antes abre el
  editor de antes, marcado «formato anterior».
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

- **AU-160** (F14c, pendiente) · El JavaScript solo corre en la caja (A-08): sin red, sin ficheros, sin reloj, con
  un intérprete que no guarda nada de una evaluación a otra.
- **AU-161** (F14c, pendiente) · El código solo lee por las conexiones de su paso. Cada lectura la hace el servidor,
  que comprueba la conexión y su filtro, la cuenta y la etiqueta.
- **AU-162** (F14a, hecho) · Una cita sencilla (un campo de la fila actual o de un paso anterior: `$json.importe`,
  `$('Buscar gastos').first().total`; lo que deja arrastrar un campo) la resuelve el servidor, sin caja, y conserva
  la etiqueta exacta de ese campo.
- **AU-169** (F14c, pendiente) · Todo lo calculado lleva la peor etiqueta de lo que recibió esa evaluación y queda
  marcado como derivado: nunca vale como destino (P14).
- **AU-163** (F14c, pendiente) · Qué recibe una evaluación lo decide el servidor leyendo el código antes de correrlo:
  los pasos y los campos que cita. Un paso citado con un nombre calculado no se admite.
- **AU-164** (F14a, hecho) · Las filas llevan también la etiqueta del camino: lo que sale de una condición o de
  unas filas que dependen de algo de fuera se trata como de fuera (P15).
- **AU-165** (F15, pendiente) · La política es el suelo. Una conexión, un ajuste o un «Sí» nunca dejan hacer lo que
  `decide` no deja: lo de fuera se propone (P4), un destino nunca sale de un dato de fuera ni de un modelo (P2),
  eliminar se pregunta (P5).
- **AU-166** (F15, pendiente) · Lo privado no llega a un modelo: se comprueba al publicar donde se puede saber y
  siempre al ejecutar. El paso falla diciendo qué colección y por qué.
- **AU-167** (F14d, pendiente) · Lo que una automatización escribe sola en segundo plano sigue la regla de la
  decisión 5 del §10.
- **AU-168** (F14a, hecho) · Todas las rutas y herramientas de automatizaciones pasan por `decide` desde el
  primer día (A-26). En la F14a todavía no hay rutas ni herramientas: es el motor el que no tiene otro camino a las
  colecciones que la política, y cada lectura y cada escritura le pregunta antes, en una prueba también.

Lo que cambia, regla por regla:

| Regla | Hoy | Con esto |
|---|---|---|
| Código libre (`docs/flujos.md` §6, decisión 3) | «Nunca JavaScript libre en un nodo» | JavaScript en la caja, que lee por conexiones y no escribe |
| P7, segundo plano | Solo lee y propone | Escribe con Deshacer lo que es todo propio; lo de fuera se sigue proponiendo (decisión 5) |
| D-44 | Un flujo no ejecuta otro | Llama a otra si esta lo permite; tres niveles, sin ciclos (decisión 3) |
| P26 y P27, el chat de una página | Una lista fija de cinco acciones | Las conexiones del «Agente»; escribir sigue preguntando salvo un valor de su página |
| I-26 | El lienzo se ordena solo; nada se coloca | El sitio se guarda aparte; Boni coloca lo que no tiene sitio (decisión 2) |
| D-52 | «Función» + «Aplicar cambios» | «Código» + «Colección»; lo que va a la Bandeja sigue yendo junto (decisión 4) |

**¿Aguanta?** Lo que puede salir mal, dicho antes:

1. *Las etiquetas por el código son más gruesas.* Lo calculado a partir de una mezcla lleva la peor etiqueta de
   toda la mezcla. Mezclar algo de fuera con lo propio hará que se proponga más de lo estrictamente necesario. Es
   el lado seguro, y las citas sencillas, que son la mayoría, no lo sufren.
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
  `automation_pins`, `automation_runs`, `automation_steps`, en el almacén del usuario: D-02), las rutas (todas en
  `routes.ts` y en la lista de acciones), el que ejecuta (política, diario, lectores, caja), los disparadores, el
  planificador de horas y la conversión de los flujos de antes.
- **`packages/agent`**: `decide` conoce el origen «automatización» y comprueba la conexión; el camino vigilado de
  una llamada queda disponible para los pasos; las rondas del «Agente»; en la F16, la traducción de un plan a pasos.
- **`packages/views`**: el filtro (`FilterItem`) admite una expresión como valor y es el modelo de condiciones de
  todos los pasos; los bloques de página ganan nombre, eventos y «De una automatización».
- **`apps/boni-web/src/automations/`**: la lista, el lienzo (con `@xyflow/react`, que ya está), el panel de añadir,
  la vista del paso, las ejecuciones. El editor de código es CodeMirror 6 (nuevo, MIT).
- **Fuera en la F16**: `FlowEditor.tsx`, `FlowStepPanel.tsx`, `ExprField.tsx`, `flowLayout.ts`, `flowEdit.ts` y el
  intérprete de listas para lo guardado. `FlowMap.tsx` se adapta: el mapa se queda.
- **Las apps**: las rutas nuevas entran en `Net.kt` de Android y en `paths.cjs` del escritorio.

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
| **F14b** El lienzo | La sección «Automatizaciones», el lienzo, añadir un paso, la vista del paso, citar un campo arrastrándolo, «Probar» y «Probar paso», el borrador que se guarda solo, el sitio de las cajas | Crea «Buscar gastos» → «Filtrar» → «Si» arrastrando, abre cada paso, ve lo que entra y sale, y ningún paso le enseña más de siete cosas. Aún no se publica nada: sus flujos de hoy siguen corriendo como están | pendiente |
| **F14c** JavaScript | JavaScript en las expresiones, «Código», conexiones de lectura con sus límites, «Consola» | Escribe el código del §5.4, lo prueba y ve su `console.log`; citar una colección sin conectar le dice cómo arreglarlo | pendiente |
| **F14d** Publicar | Publicar y versiones, encender y «Ejecutar», «Ejecuciones», «Fijar», «Programada», los ajustes y topes de la automatización, la regla de segundo plano para lo que no es de modelo | Publica una programada que crea una fila cada mañana, la ve en «Ejecuciones» y la deshace desde ahí | pendiente |
| **F15** La IA | «Agente» con conexiones y límites, los otros pasos de IA, «Preguntar», «Avisar», «Responder» | Monta el «Analista» del ejemplo: lee Gastos y Categorías, propone una nota; quitarle «Leer» de Gastos hace que diga que no puede; ve cada lectura en el registro | pendiente |
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
     el ejemplo del §5.4. No puede escribir ni salir a la red, y lo que calcula hereda de dónde vienen sus datos.
   - La otra: solo pasos visuales y funciones cerradas. Sumar los gastos por categoría sería un paso «Agrupar»; lo
     que no tenga paso no se puede hacer.

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

5. **Lo que una automatización escribe sola en segundo plano** (programada o por un cambio). Hoy, nada: todo se
   propone. El 2026-11-05 eligió que lo disparado por sus propios datos escribiera con Deshacer; la tarea 103 lo
   reabrió.
   - Recomendada: **según de dónde venga el dato, y solo de una versión que él publicó**. Todo propio y calculado por
     código: escribe con Deshacer y un aviso por ejecución («Tarea repetida creó 1 fila en Tareas · Deshacer»).
     Decidido por un modelo a partir de datos propios: solo si esa conexión dice «Sí»; si no, a la Bandeja. Con
     algo de fuera (un correo, una web): siempre a la Bandeja. Enviar, eliminar o lo irreversible: nunca solo.
   - La otra: todo a la Bandeja, como hoy. «Crear la tarea de la semana siguiente» esperaría cada vez a que la
     acepte.

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
| El código no escribe y solo lee por sus conexiones (AU-31, AU-32) | Un `$col` sin conexión no pasa la validación; la caja no tiene con qué escribir | F14c |
| Los límites de una conexión estrechan y nunca ensanchan (AU-43, AU-48) | Una lectura fuera del filtro no devuelve nada; una escritura fuera de sus filas o de sus campos se niega | F14c, F15 |
| La vista previa es la ejecución (AU-27) | El mismo valor en las dos, para los ejemplos del catálogo | F14c |
| Lo calculado hereda la peor etiqueta de lo que recibió (AU-169) | Un valor calculado con un dato de fuera se propone al escribirlo y no vale como destino | F14c |
| Una evaluación no deja nada a la siguiente (AU-37) | Cambiar un prototipo en una y mirarlo en la otra | F14c |
| Evaluar por fila aguanta su volumen (AU-38) | 3.000 filas dentro del tiempo fijado (A-15) | F14c |
| Un borrador nunca corre de verdad (AU-95; D-55 se queda) | La de hoy, sobre el formato nuevo | F14d |
| Lo que escribe una ejecución se deshace entero (AU-18) | Deshacer una ejecución de tres pasos que escriben | F14d |
| Modificar y eliminar piden una condición (AU-121) | Sin condición, la validación la rechaza | F14a |
| Una conexión solo restringe (AU-45, AU-165) | «Sí» con un dato de fuera sigue proponiendo; privada no se conecta a IA | F15 |
| Al conectar, solo leer (AU-41) | Una conexión nueva no tiene ningún permiso de escribir | F14c |
| Segundo plano: quién escribe solo (decisión 5; cambia P7) | Una fila por caso de la regla | F14d, F15 |
| Una automatización llama a otra solo con permiso, tres niveles, sin ciclos (AU-112; cambia D-44) | Sin permiso no se puede elegir; un ciclo no publica | F18 |
| Un bloque tiene nombre único en su página (AU-130) | Dos bloques no pueden llamarse igual; renombrar no rompe lo enlazado | F17 |
| Un fallo no hace una cadena (AU-118) | Una automatización iniciada por «Falla una automatización» que falla no inicia otra | F18 |
| Instalar un paquete no publica nada (AU-145) | Tras instalarlo, todas sus automatizaciones están sin publicar | F19 |
| Cambiar una función guardada no cambia lo que ya corre (AU-147) | Cambiarla y ejecutar la versión publicada: calcula lo de antes | F19 |
