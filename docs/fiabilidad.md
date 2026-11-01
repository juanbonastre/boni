# Decisiones con fiabilidad: hacer, preguntar o nada

Propuesta (2026-11-01). Juan, al elegir si lo que Boni aprende se guarda solo o con su «sí»: «¿podría ser que,
dependiendo de la fiabilidad de la predicción, pida comprobación o lo haga de forma automática? A lo mejor se podría usar
Jev, y a lo mejor esta manera de trabajar usando la fiabilidad se podría extrapolar a otros procesos y que sea un
procedimiento core de Boni».

Sí a las tres cosas, y Boni ya lo hace en cuatro sitios sin llamarlo así (§1). Esto lo convierte en un solo
procedimiento, con lo que la gente que lo estudió hace años dejó claro (§2). Ninguna regla de `docs/principios.md`
cambia: lo que la política manda confirmar o proponer lo sigue mandando, sea cual sea la fiabilidad (§5).

## 0. Resumen

- **Una decisión de Boni lleva una fiabilidad** (de 0 a 1) **y un coste de equivocarse.** Con las dos, el código elige
  entre tres salidas: **hacerlo** y avisar, con Deshacer; **preguntar**, con una tarjeta; o **nada**.
- **La fiabilidad sale de Jev** cuando hay que entender un texto (qué colección, qué categoría) y **del historial de
  Juan**, calculado por el código, cuando la pregunta es «¿querrá este cambio?». Nunca de lo que el planificador diga
  de sí mismo.
- **Los umbrales se miden, no se inventan**, y **la autonomía se gana:** Boni empieza preguntando, enseña cuánto
  acierta y, cuando acierta lo bastante en un ámbito, propone hacerlo solo. Juan lo enciende.
- **Lo irreversible y lo que sale fuera nunca se hace solo**, por alta que sea la fiabilidad.

## 1. Lo que hay hoy

| Dónde | La fiabilidad | El umbral | De dónde salió el umbral | Qué pasa |
|---|---|---|---|---|
| **Qué colección** para lo que pide un correo (`decideChoice`) | Jev, preguntado dos veces con las opciones en orden contrario | Las dos respuestas iguales y ambas ≥ 0,6 | A mano, comprobado en la evaluación (`eval/decide.ts`): «su confianza distingue el acierto del error» | Si no, «unsure» y se le pregunta a Juan por el panel de peticiones |
| **Rellenar una propuesta** (`FILL_THRESHOLDS`) | Jev, por campo; sí o no para las casillas y para si merece nota | 0,5 | Medido el 2026-10-23 en 144 valores inventados: a 0,5 rellena lo más sin ningún valor mal; a 0,4 aparece uno | Lo que no llega al umbral se deja vacío |
| **Pseudoaceptación** (`autoAccept.ts`) | El código: mismo remitente y colección, 3 decisiones o más y las 5 últimas aceptadas tal cual | Todo o nada | Juan (2026-10-23): «medir primero; lo enciende cuando acierte lo bastante» | Solo se mide: la Bandeja enseña la predicción y el Registro cuántas veces habría acertado |
| **La revisora del correo** | Un modelo, sobre decisiones de Juan: una regla solo con 3 decisiones o más que la muestren | 3 decisiones | A mano | Propone, Juan acepta; antes de proponer se comprueba releyendo |
| **La política** (P2-P16) | — | — | Decidido | Borrar se confirma; lo que nace de un correo se propone; enviar se confirma siempre |

Cuatro formas de lo mismo, cada una con su número y su medida. Falta lo que las une: dónde se apuntan las
predicciones y lo que pasó después, para saber cuánto acierta cada una y mover sus umbrales con datos.

## 2. Lo que se sabe de esto (revisado el 2026-11-01)

- **Horvitz, 1999 (Microsoft Research):** la decisión de un asistente entre actuar, preguntar o callar se toma con la
  utilidad esperada: la probabilidad de que el usuario quiera la acción, lo que gana si acierta, lo que pierde si se
  equivoca y **lo que cuesta molestarle** con una pregunta. Las tres zonas quedan marcadas por dos umbrales sobre la
  probabilidad. Su sistema LookOut, sobre Outlook, programaba reuniones solo, preguntaba o no hacía nada según eso.
- **Niveles de automatización (Sheridan y Verplank, 1978; Parasuraman, Sheridan y Wickens, 2000):** del 5 al 7 está
  lo que importa aquí: **5**, el sistema hace la sugerencia si el humano la aprueba; **6**, la hace si el humano no la
  veta en un plazo; **7**, la hace y después avisa sin falta. Las tres salidas de Boni son el 5 (preguntar), el 7
  (hacer y avisar, con Deshacer) y el 6 como opción (lo propuesto caduca y se hace si Juan no dice nada).
- **El modo automático de Claude Code (Anthropic, 2026):** un clasificador mira cada acción antes de hacerla y para
  las irreversibles, destructivas o dirigidas fuera; lo demás pasa solo. Tras 3 bloqueos seguidos o 20 en una sesión,
  vuelve a preguntar. Anthropic midió que los humanos aprueban el 97 % de las peticiones de permiso (casi un acto
  reflejo) y que el automático paró el 89 % de las acciones malas de su prueba. La lección: **el coste de la acción
  manda tanto como la fiabilidad**, y preguntar por todo deja de servir cuando se aprueba sin mirar.
- **Guías de 2026 sobre agentes con supervisión:** el umbral es «la confianza a partir de la cual la tasa de error es
  aceptable», se combina con el riesgo (confianza alta y riesgo bajo → solo; riesgo alto → revisión), y **la
  confianza que un modelo dice de sí mismo no vale** si no está calibrada: tres pasos al 90 % declarado pero
  descalibrados dan un 42 % real. El Consenso de Singapur de 2026 sobre seguridad de la IA lo dice como principio:
  **la autonomía se gana con el rendimiento demostrado, no se concede por defecto**, y los puntos de intervención se
  calibran con el riesgo, la reversibilidad y la sensibilidad de la acción.
- **Lo que Boni ya hace bien respecto a eso:** no usa la confianza del planificador (un modelo con puerta trasera
  diría «seguro» de todo); Jev solo elige entre opciones del código y no escribe texto; la política pone el suelo por
  coste; la pseudoaceptación se midió antes de encenderse.

## 3. La propuesta: un procedimiento del núcleo

### 3.1 La decisión

Cada vez que Boni decide algo por Juan sin que él lo haya pedido en ese momento (dónde va una tarea, qué valor lleva un
campo, si acepta sola una propuesta, si cambia una preferencia, si apunta algo que ha notado), el código construye una
**decisión**: qué es, la **fiabilidad** `p`, el **coste** de equivocarse y las tres salidas posibles. Y la resuelve:

| Coste de equivocarse | Qué es | `p` alta | `p` media | `p` baja |
|---|---|---|---|---|
| **A. Se deshace sin más** | Un parámetro de la interfaz, un ejemplo de la guía, una etiqueta, dónde va una tarea propuesta | Hacer y avisar, con Deshacer, si Juan ha encendido el automático en ese ámbito (§3.4) | Preguntar | Nada |
| **B. Se deshace, pero toca sus datos** | Aceptar sola una propuesta, rellenar un campo, crear una regla | Hacer y avisar solo con el automático ganado (§3.4); si no, preguntar | Preguntar | Nada |
| **C. Irreversible, o sale fuera** | Enviar, borrar, pagar, permisos, lo que ve la IA, el código de Boni | **Preguntar siempre** (la política ya lo manda) | Preguntar | Nada |

- Los umbrales de «alta» y «media» son por clase de decisión, y empiezan por los de hoy: 0,6 para preguntar en vez de
  callar (Jev) y 0,9 para hacer solo. Cambian solo con medida (§3.3).
- **Preguntar** es la tarjeta de siempre, con [Sí] [No] y las palabras de Juan (`docs/preferencias.md` §5); lo que se
  pregunta en segundo plano va al panel de peticiones y espera, como hoy.
- **Hacer y avisar** es un aviso corto con Deshacer; lo hecho queda en el registro con su `p`, como todo.

### 3.2 De dónde sale la fiabilidad

| La pregunta | Quién da `p` | Cómo |
|---|---|---|
| Qué opción encaja con un texto (una colección, una categoría, un comercio) | **Jev** | Como hoy: dos preguntas con las opciones en orden contrario, `p` = la menor de las dos si coinciden, 0 si no |
| Sí o no sobre un texto (¿merece nota?, ¿es una tarea?) | **Jev** | Su probabilidad |
| ¿Querrá Juan este cambio? (una preferencia, una regla, aceptar sola) | **El código, de su historial** | La proporción de veces que decidió igual en casos iguales, con un mínimo de casos y contada con cautela (el límite inferior de Wilson, no la media: 3 de 3 no es un 100 %) |
| ¿Está bien lo que hizo un modelo? | **El código** | Si Juan lo deshizo, lo corrigió al poco o lo cambió otra vez: las señales de la tarea 13 |

Nunca la confianza que el planificador declare de sus propios planes.

### 3.3 Medir, y mover los umbrales con datos

- **Todo se apunta:** cada decisión con su clase, su `p`, su salida y, después, lo que pasó (Juan aceptó, dijo no,
  deshizo, corrigió). Es el diario de hoy con dos campos más.
- **El Registro enseña, por ámbito:** cuántas decisiones, cuántas solas, cuántas deshechas o corregidas, y el acierto
  a cada nivel de `p`. Si Jev dice 0,8 y acierta el 60 %, se ve; el código corrige la `p` con esa tabla antes de usarla
  (calibración), y cada evaluación de un modelo mide también eso.
- **Un umbral solo baja (más automático) con datos y con Juan:** cuando un ámbito lleva al menos 20 decisiones y
  acierta el 95 % o más, Boni propone bajarlo o encender el automático. **Sube solo** cuando el acierto cae: tres
  deshechos seguidos o un 20 % en el mes vuelven a preguntar, como el modo automático de Claude Code vuelve a pedir
  permiso tras sus bloqueos.

### 3.4 La autonomía se gana, por ámbito

- Cada ámbito (dónde van las tareas del correo, rellenar propuestas, las preferencias de la interfaz, aceptar
  propuestas solas…) empieza en **preguntar**.
- En Ajustes, cada ámbito enseña su acierto y un interruptor **«Solo»** (hacer solo lo de fiabilidad alta): Juan lo
  enciende cuando Boni se lo propone con los números, como decidió para la pseudoaceptación. Puede apagarlo cuando
  quiera, y el interruptor «Aprender» de `docs/preferencias.md` apaga todo.
- La clase C no tiene interruptor.

### 3.5 Qué cambia en lo que hay

- `decideChoice`, el relleno, la pseudoaceptación y la revisora pasan a construir una decisión del procedimiento; sus
  números de hoy son los umbrales iniciales. La pseudoaceptación deja de ser un caso aparte: es un ámbito de clase B
  con su interruptor.
- La decisión 2 de `docs/preferencias.md` queda así: **lo que Boni aprende se guarda con el «sí» de Juan, salvo lo de
  clase A en un ámbito donde él ha encendido «Solo»**; entonces se hace y se avisa, con Deshacer. El choque con la
  tarea 13 queda resuelto: los aprendices producen decisiones de este procedimiento.
- Las extensiones declaran la clase de coste de cada decisión suya en su manifiesto; una que no la declara es C.

## 4. Ejemplos

- **Dónde va una tarea que pide un correo.** Jev: «Docencia» en los dos órdenes, 0,93. Clase A (es una propuesta, se
  deshace). Con «Solo» encendido en ese ámbito, la propuesta va a Docencia sin preguntar y la tarjeta lo dice; si Juan
  la cambia a Gestiones, cuenta como fallo. Con 0,7, Boni pregunta; con 0,4, no propone colección y Juan la elige.
- **La gráfica en barras.** Juan la ha puesto en barras 3 veces en 3 ocasiones: `p` con cautela, 0,56: media. Tarjeta:
  «¿La dejo en barras?». A la quinta vez seguida, 0,76; con «Solo» encendido en «interfaz» y el umbral ganado en 0,75,
  se queda en barras y avisa: «Ahora sale en barras · Deshacer».
- **Un correo que pide enviar algo.** Clase C: por mucho que Jev esté seguro de a quién, enviar se confirma. Como hoy.

## 5. Seguridad: lo que no cambia

- La política pone el suelo: lo que manda confirmar o proponer se confirma o se propone, sea cual sea `p` (P2-P16).
- Jev elige entre opciones del código y no escribe texto; el planificador nunca da su propia fiabilidad (A-01, A11).
- Lo que se hace solo queda en el registro con su `p` y se deshace entero; un ámbito vuelve a preguntar solo con
  datos, nunca por decir un modelo que acierta.
- Nada de fuera mueve un umbral ni enciende un interruptor (P9).

## 6. Para decidir (Juan)

1. **Las tres clases de coste y que la C nunca se haga sola** (propuesto). Ejemplo: cambiar una gráfica es A; aceptar
   sola una propuesta de correo es B; enviar un correo es C, siempre con confirmación.
2. **La autonomía se gana y la enciendes tú**, ámbito a ámbito, cuando Boni te enseña 20 decisiones con un 95 % de
   acierto (propuesto, como decidiste para la pseudoaceptación); o que Boni la encienda sola al llegar ahí, avisando.
   Ejemplo: «En dónde van las tareas del correo llevo 24 decisiones y 23 aciertos: ¿lo hago solo a partir de ahora?».
3. **El nivel 6 como tercera salida** para la clase B: «lo haré el viernes si no dices nada», con la tarjeta esperando
   (propuesto: no por ahora; preguntar y esperar, como hoy, es más simple).

## 7. Fases

| Fase | Qué | Va con |
|---|---|---|
| F1 | El procedimiento en el núcleo (`packages/agent`): la decisión, las clases, los umbrales por ámbito, el diario con `p` y resultado, la `p` del historial con cautela; `decideChoice`, el relleno y la pseudoaceptación sobre él | Sin interfaz |
| F2 | El Registro con el acierto por ámbito y por nivel de `p`; la calibración de Jev medida en cada evaluación | «Modelos» y el Registro |
| F3 | Ajustes: el acierto y el interruptor «Solo» por ámbito; la propuesta de encenderlo; el aviso con Deshacer | Con maqueta (I-09) |
| F4 | Los aprendices de la tarea 13 y las sugerencias de `docs/preferencias.md` sobre el procedimiento | P3 de `docs/preferencias.md` |

Fuentes: [Horvitz, «Principles of Mixed-Initiative User Interfaces» (CHI 1999)](https://erichorvitz.com/chi99horvitz.pdf),
[Parasuraman, Sheridan y Wickens (2000), los niveles de automatización](https://www.mitre.org/sites/default/files/2021-11/pr-16-3426-lessons-lost-automation-in-aviation-definition-of-automation.pdf)
(tabla 1), [el modo automático de Claude Code](https://claude.com/blog/auto-mode) y
[por qué pasó a ser el modo por defecto](https://claude.com/resources/articles/auto-mode-default-in-claude-code),
[escalado con supervisión humana en agentes (2026)](https://www.digitalapplied.com/blog/human-in-the-loop-escalation-design-ai-agents-2026),
[umbrales de confianza y matrices de riesgo](https://belovroman.medium.com/human-in-the-loop-ai-confidence-thresholds-and-risk-matrices-5684a7498fd2),
[el Consenso de Singapur de 2026 sobre seguridad de la IA](https://arxiv.org/pdf/2608.14611).
