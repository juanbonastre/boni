# Lo que Boni sabe de Juan y cómo lo aprende

Propuesta (2026-11-01). Juan, al leer `docs/correo.md`: «nuestro sistema actual ya tenía alguna lógica para ir
aprendiendo de las preferencias del usuario; ¿cómo encaja con lo que proponemos? Quiero que esté bien estructurado y
que no se solapen».

Ordena lo que ya hay (Memoria, la guía del correo, la revisora, la pseudoaceptación, las descripciones de colección) y
lo propuesto (los ajustes del chat de la maqueta 3b, aprender del chat de `docs/correo.md`). Ninguna regla de
`docs/principios.md` cambia: lo de fuera no escribe en la memoria (P9) y lo que escribe un modelo no se usa hasta que
Juan lo acepta (A11).

## 0. Resumen

- **Hoy hay diez sitios** donde Boni guarda o aprende algo de Juan (§1), y cuatro se solapan (§2). Por ejemplo, la
  guía del correo y los ajustes de chat de la maqueta 3b serían dos sitios para lo mismo, y «aprender del chat» y la
  herramienta `memory.save` son lo mismo con dos nombres.
- **Lo que hacen ChatGPT, Claude, Gemini y Notion** (§3): separan cómo quieres que te hablen, lo que saben de ti y cómo
  se hace cada cosa. Lo de un proyecto manda sobre lo general y no se mezcla con otros. Todo se ve y se edita, y se
  puede parar.
- **Propuesta** (§4): cinco clases, cada una con un solo sitio.
  1. **El saber de Boni**: fijo, en el código.
  2. **Sobre ti**: cómo quiere Juan que le hable Boni.
  3. **Los ajustes de cada extensión**: correo, conciliación… Valen para todo lo que hace la extensión, en segundo plano
     y en su chat.
  4. **Hechos**: lo que Boni sabe de él.
  5. **Sugerencias**: nada de lo aprendido entra en 2, 3 o 4 sin su «sí».
- **Qué cambia** (§5): la guía del correo pasa a ser los ajustes de Correo; `memory.save` propone con una tarjeta en
  vez de guardar en silencio; las sugerencias se presentan todas igual; el planificador y el decisor leen las
  descripciones de las colecciones.

## 1. Lo que hay hoy

| | Qué guarda | Quién lo escribe | Quién lo lee | Dónde lo ve Juan |
|---|---|---|---|---|
| **Prompts del producto** | Cómo planear, cómo leer un correo, sus módulos | El código | Los modelos | El repo |
| **Memoria** (colección de sistema) | Cualquier texto, hechos e instrucciones mezclados | Juan, Boni, lo importado; el planificador con `memory.save` | El planificador, en cada turno; lo que escribió un modelo, solo cuando Juan lo confirma (A11) | La colección «Memoria» y un aviso en el turno |
| **Guía del correo** | Sus indicaciones (hasta 2.000 caracteres), reglas de un catálogo cerrado y ejemplos de correos que decidió | Juan; la revisora, con su visto bueno | El lector de correos en segundo plano | Ajustes → Correo |
| **La revisora** | Sugerencias de reglas y ejemplos a partir de lo que Juan acepta, corrige o rechaza; un «no» no se repite | Un modelo, sobre sus decisiones | — | Ajustes → Correo |
| **Pseudoaceptación** | Si Boni acertaría al aceptar solo: mismo remitente y colección, 3 decisiones, las 5 últimas sin corregir. Solo se mide | El código | — | La Bandeja y el Registro |
| **Correcciones** | Lo que Juan cambió al aceptar una propuesta | Juan | La revisora, como error de lectura | La propuesta |
| **Descripción de cada colección** | Qué va en ella | Juan o una IA (`set_description`) | Solo los asistentes de fuera, por el `guide` del MCP: **ni el planificador ni el decisor** | La colección |
| **Instrucciones para asistentes** (una nota de Boni) | Cómo trabajar con Juan | Juan | Los asistentes de fuera (Claude Code…) | La nota |
| **Historial** | Los últimos 10 turnos | — | El planificador | La conversación |
| **Privacidad** | Lo que puede ver cada modelo | Juan | El código | Ajustes → Privacidad |

Y lo propuesto: los ajustes del chat (maqueta 3b: instrucciones, bienvenida, archivos), la guía también en la
conversación y aprender de lo que Juan dice en el chat (`docs/correo.md`).

## 2. Dónde se solapan

1. **Memoria mezcla dos cosas:** hechos («Ana es mi hermana») e instrucciones («contéstame corto»).
2. **Lo que escribe el planificador se pierde:** queda guardado y sin usar, con un aviso en el turno, pero no hay dónde
   confirmarlo de un toque.
3. **Dos sitios para lo mismo:** la guía del correo y los ajustes de chat de la maqueta 3b dicen ambos cómo quiere
   Juan que Boni lea su correo y hable de él. Y «aprender del chat» repetiría `memory.save`.
4. **Sugerencias en tres sitios y con tres formas:** la revisora en Ajustes → Correo, la pseudoaceptación en la
   Bandeja y el Registro, y la tarjeta del chat propuesta.

Y un hueco: las descripciones de colección dicen qué va en cada una, pero el decisor elige la colección de una tarea
solo por los nombres.

## 3. Cómo lo hacen otros (revisado el 2026-11-01)

| | Cómo quieres que te hable | Lo que sabe de ti | Un ámbito | Cómo se hace cada cosa | Control |
|---|---|---|---|---|---|
| **ChatGPT** | Instrucciones propias: entran enteras en cada chat | Memoria: la aprende y la guarda sola, con el aviso «memoria actualizada»; se ve y se borra | Proyectos: sus instrucciones mandan sobre las generales, y su memoria puede quedarse dentro | — | Apagar la memoria; chats temporales |
| **Claude** | Preferencias del perfil | Memoria con un resumen que se ve y se edita | Proyectos: cada uno con su memoria, que nunca pasa a otro | **Skills**: se carga su nombre, y el resto cuando hace falta | Pausar o borrar; chats de incógnito |
| **Gemini** | Instrucciones de Workspace, las mismas en todas sus apps | — | Gems | Skills de Workspace Studio, que se llaman con `@` | Activarlas o no |
| **Notion** | La página de instrucciones del agente | La misma página: el agente propone añadir lo que aprende, a la vista | Varias páginas, una activa | — | Editarla |

Lo que tienen en común:
1. **Tres cosas distintas:** cómo quieres que te hable, lo que sabe de ti y cómo se hace cada cosa.
2. **Ámbitos:** lo de un proyecto manda sobre lo general y no se mezcla con otros.
3. **Todo a la vista y editable**, y el aprendizaje se puede parar.
4. **La memoria es un blanco.** OWASP la pone en su lista de riesgos de los agentes (ASI06, «envenenamiento de memoria
   y contexto»): texto de fuera que se guarda como si fuera de confianza, o un agente que guarda como cierto lo que él
   mismo dijo. Aconseja separar las clases de memoria, guardar de dónde viene cada cosa y poder volver atrás. Boni ya lo
   hace (P9, A11, el registro con Deshacer). ChatGPT guarda solo y avisa; Boni pide el «sí», y sigue así.

## 4. Propuesta: cinco clases, un sitio cada una

| Clase | Qué es | Dónde vive | Quién la escribe | Quién la lee | Ejemplo |
|---|---|---|---|---|---|
| **1. El saber de Boni** | Cómo funciona Boni y cómo se hace cada cosa | El código: los prompts, los módulos de lectura y las instrucciones de cada extensión en su manifiesto | Un PR con su evaluación | Los modelos; lo de una extensión, solo cuando su ámbito aplica, como las Skills | «Un correo por línea, agrupados por lo que piden» |
| **2. Sobre ti** | Cómo quiere Juan que Boni le hable, en general | Memoria, apartado «Sobre ti» | Juan; Boni lo propone | El planificador, en cada turno | «Contéstame corto, y con una gráfica cuando haya cifras» |
| **3. Ajustes de cada extensión** | Lo que Juan quiere en un ámbito: indicaciones, reglas que aplica el código y ejemplos | La página de la extensión | Juan; la revisora y el chat lo proponen | Todo lo que hace la extensión: en segundo plano y en su chat | Correo: «lo de la secretaría, primero»; la regla «de boletines@…, nunca». Conciliación: «pregúntame el comercio antes que la categoría» |
| **4. Hechos** | Lo que Boni sabe de Juan y su mundo | Memoria, apartado «Hechos», o mejor en sus colecciones (una persona va en Personas) | Juan; Boni lo propone | El planificador | «Ana es mi hermana» |
| **5. Sugerencias** | Lo que Boni ha notado y quiere guardar en 2, 3 o 4 | Una tarjeta donde nace (el chat, la Bandeja) y la lista en Ajustes | La revisora, el planificador (`memory.save`) y la pseudoaceptación | Juan, que dice sí o no | «Has rechazado 4 de boletines@…: ¿no te propongo más?» |

Y dos cosas que no son preferencias pero se leen con ellas: **la descripción de cada colección** (qué va en cada una;
la leerán también el planificador y el decisor) y **Privacidad** (lo que puede ver cada modelo, como hoy).

**Qué manda sobre qué:**
1. Las reglas de seguridad del código, siempre.
2. Lo que Juan pide en ese turno.
3. Los ajustes de la extensión.
4. «Sobre ti».
5. El estilo por defecto del producto.

## 5. Qué cambia, para que nada se solape

- **Un sitio por extensión.** La guía del correo pasa a ser los ajustes de la extensión Correo (el mismo contenido y el
  mismo cifrado), y vale también cuando la conversación lee correos. Los ajustes del chat de la maqueta 3b son los de
  la extensión Conciliación. No hay unos ajustes del chat aparte.
- **`memory.save` propone en vez de guardar en silencio.** Una tarjeta en el turno: «¿Lo recuerdo?» [Sí] [No]. Al
  decir sí va a «Sobre ti», a los ajustes de una extensión o a «Hechos», según de qué hable. Es el «aprender del chat»
  de `docs/correo.md` §4.3: no hay otro mecanismo.
- **Todas las sugerencias iguales:** qué propone, por qué (las decisiones que lo muestran) y [Sí] [No]. Un «no» no se
  vuelve a proponer, y lo aceptado se deshace como cualquier cambio.
- **Memoria ordenada** en «Sobre ti» y «Hechos», cada cosa con de dónde viene.
- **Las descripciones de colección** llegan también al planificador y al decisor.
- **Un interruptor «Aprender»** para pausar las sugerencias; más adelante, conversaciones que no dejan recuerdos.
- **Las instrucciones para asistentes** siguen siendo para los asistentes de fuera. Lo general de «Sobre ti» (el
  idioma, cómo contestar) puede ir también en el `guide` del MCP, para no escribirlo dos veces.

## 6. Seguridad: lo que no cambia

- Nada de fuera escribe en 2, 3 o 4 (P9). Lo que escribe un modelo es una sugerencia hasta que Juan dice sí (A11).
- Las reglas de un ámbito son de un catálogo cerrado y las aplica el código; unas indicaciones nunca amplían lo que Boni
  puede hacer.
- Lo de una extensión solo se lee en su ámbito.
- Todo queda en el registro con su origen, y se deshace.

## 7. Para decidir (Juan)

1. **Las cinco clases, un sitio cada una** (propuesto). Ejemplo: tu «no me interesan los boletines» va a los ajustes de
   Correo y vale en segundo plano y en el chat. Tu «contéstame corto» va a «Sobre ti» y vale en todo.
2. **Aprender siempre con tu «sí»** (propuesto, como hoy), o guardar solo y avisar, como ChatGPT. Ejemplo: dices «Ana es
   mi hermana» y aparece «¿Lo recuerdo?», o se guarda y sale «Recordado» con Deshacer.
3. **«Sobre ti» también para los asistentes de fuera** por el MCP (propuesto: lo general sí; lo de cada extensión, no).

## 8. Fases

| Fase | Qué |
|---|---|
| P1 | La tarjeta «¿Lo recuerdo?» para `memory.save`; Memoria en «Sobre ti» y «Hechos»; las descripciones para el planificador y el decisor |
| P2 | Los ajustes de cada extensión (Correo, con la guía de hoy; Conciliación), también en su chat. Es la M2 de `docs/correo.md` |
| P3 | Las sugerencias con una sola forma (revisora, chat, pseudoaceptación) y el interruptor «Aprender», con maqueta antes |

Fuentes: [memoria e instrucciones de ChatGPT](https://iceberglakehouse.com/posts/2026-03-context-chatgpt/) (resumen de
un tercero), [memoria de Claude](https://claude.com/blog/memory),
[Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview),
[instrucciones de Gemini en Workspace](https://workspaceupdates.googleblog.com/2026/09/custom-instructions-for-gemini-in-Workspace-now-available-in-more-apps.html),
[el agente de Notion](https://www.notion.com/help/notion-agent),
[OWASP: amenazas de los agentes](https://witness.ai/blog/owasp-agentic-ai-threats-and-mitigations/) (resumen de un
tercero) y [la prueba de envenenamiento de memoria de promptfoo](https://www.promptfoo.dev/docs/red-team/plugins/memory-poisoning).
