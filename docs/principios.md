# Principios de Boni (lo que no se puede romper)

Las reglas vigentes de Boni, cortas, cada una con su fecha y **la prueba que la vigila**. Se leen antes de cada paso
(Juan, 2026-10-25: «que a medida que avancemos no se rompa la aplicación»). El porqué y el detalle están en
`docs/nucleo.md`, `docs/clases.md`, `docs/contexto.md`, `docs/extensiones.md`, `docs/design-guide.md` y, en Boni, la
nota de diseño de interfaces (§9).

Cómo se usa:
- **Una decisión nueva de Juan que se pueda comprobar con código entra aquí con su prueba, en el mismo PR.** Si un cambio
  futuro la rompe, el CI falla y no se fusiona.
- **Una regla que cambia no se borra:** se marca «Sustituida por …» con la fecha, y la nueva va debajo.
- «Pendiente» = decidida pero aún no está en el código; su prueba entra con el PR que la hace.
- «Sin prueba» = no se puede comprobar con código: se revisa a mano en cada PR que la toque.

## A. Arquitectura y seguridad

| Id | Regla | Desde | Prueba |
|---|---|---|---|
| A-01 | El modelo no es de fiar: produce planes que el código interpreta; toda llamada pasa por las políticas (deny by default); lo derivado de fuera va a la bandeja | 2026-10-19 | `packages/agent/test/adversarial.ts` (corpus de inyecciones), `random-plans.test.ts` |
| A-02 | El núcleo (entidades, almacén, agente, vistas) no depende del vault, del calendario, de las apps ni de Obsidian | 2026-10-20 | `packages/agent/test/boundary.test.ts` |
| A-03 | Todo por la tailnet; por Funnel solo la lista blanca de rutas; una ruta nueva es de la tailnet | 2026-10-19 | `apps/server/src/routes.test.ts` |
| A-04 | Lo que ve la IA lo decide Juan, por colección y por reglas; lo privado solo se desbloquea desde la página de su colección | 2026-10-20 | `packages/store`, `packages/agent` (`readStore`), `apps/server/src/data.test.ts` |
| A-05 | Boni no cambia su propio código; la configuración peligrosa (proveedores, presupuestos, capacidades) solo con fricción, en Ajustes | 2026-10-21 | Sin prueba (revisión) |
| A-06 | Lo privado se hereda: una colección es al menos tan cerrada a la IA como su madre, y una consulta de un modelo sobre la madre no devuelve ni cuenta lo de una hija cerrada para él (`docs/clases.md` §2.8) | 2026-10-27 | Pendiente (PR «Clases en el núcleo») |

## D. Datos

| Id | Regla | Desde | Prueba |
|---|---|---|---|
| D-01 | Todo dato es una colección, salvo los adjuntos; nada de listas dentro de una nota ni CSV | 2026-10-23 | Sin prueba (revisión) |
| D-02 | Lo del usuario vive en su almacén, con registro y Deshacer; `system.db` solo guarda cuentas, dispositivos, sesiones y claves (las tablas v1 heredadas solo pueden desaparecer) | 2026-10-21 | `apps/server/src/principles.test.ts`. Pendiente: la configuración de modelos, hoy en `settings` (auditoría, paso 4). Las páginas plantilla ya son páginas del almacén (con Deshacer) |
| D-03 | Un valor que no está en los datos del usuario nunca se cambia por otro que sí: se dice | 2026-10-24 | `packages/views/src/catalogue.test.ts` («refuses values that are not in the data») |
| D-04 | Lo que se muestra son consultas de colecciones; lo que Boni guarda de sí mismo se ve como colecciones de sistema de solo lectura («Llamadas a modelos», «Actividad de Boni»), que ningún modelo ve | 2026-10-25 | `apps/boni-web/src/core/principles.test.ts` (D-04: sin fuentes con nombre), `apps/server/src/data.test.ts` («read-only collections no model sees»), `apps/server/src/pages.test.ts` (las plantillas se calculan) |
| D-05 | La configuración se cambia en Ajustes, nunca desde un bloque (Ajustes → Modelos; «Uso de la IA» solo enseña) | 2026-10-25 | `apps/boni-web/src/core/principles.test.ts` (D-05), `e2e-boni/models.spec.ts` |
| D-06 | Una sola clase de página: las notas son páginas de una colección (con propiedades), con el mismo editor (los bloques que el Markdown no dice viajan marcados y vuelven igual) | 2026-10-25 | `apps/boni-web/src/core/principles.test.ts` (D-06: sin editor «solo texto»), `packages/views/src/markdown.test.ts` (ida y vuelta), `e2e-boni/notes.spec.ts` |
| D-07 | El motor de gráficas da exactamente los números del original en Python | 2026-10-19 | `packages/views` (`golden/cases.json`), `apps/server/src/v1/v1.test.ts` |
| D-08 | Lo que cuenta un bloque se puede ver: un clic lista sus filas (o las de una barra o un punto), las mismas que suma, elegidas por el mismo motor | 2026-10-25 | `packages/views/src/catalogue.test.ts` (300 páginas al azar: las filas suman lo mismo), `apps/server/src/data.test.ts`, `e2e-boni/models.spec.ts` |
| D-09 | Una página guardada con un bloque que ya no existe pierde solo ese bloque, nunca el resto | 2026-10-26 | `packages/views/src/templates.test.ts`, `apps/server/src/pages.test.ts` («a retired block keeps the rest») |
| D-10 | Las colecciones son clases: una raíz con los campos nativos (título, nota, creado, editado, quién) y cada colección hereda los campos de su madre, con el mismo id; una sola madre (`docs/clases.md`) | 2026-10-27 | Pendiente (PR «Clases en el núcleo») |
| D-11 | La tabla, las consultas y las gráficas de una colección incluyen los registros de sus descendientes; la colección de cada registro es una columna nativa | 2026-10-27 | Pendiente (PR «Clases en el núcleo») |
| D-12 | Mover un registro de colección (o una colección de rama) conserva su id y su historia; los valores que se quedan sin campo se archivan, nunca se pierden | 2026-10-27 | Pendiente (PR «Clases en el núcleo») |
| D-13 | El árbol enseña colecciones y registros con nota (una plantilla vacía no cuenta); cada colección elige si sus notas salen en él | 2026-10-27 | Pendiente (PR «Un solo árbol») |
| D-14 | Nada del dominio del usuario en el código ni en los prompts: cualquier colección con fecha puede ser calendario y se separa o colorea por el campo que elija el usuario | 2026-10-20 | Pendiente (prueba con el PR que quite los nombres de calendario fijos) |
| D-15 | Cada colección tiene una descripción (qué va en ella), que sustituye a los README; la escriben el usuario o una IA y se deshace | 2026-10-27 | `packages/entities/src/ops.test.ts` («describe_type»), `apps/server/src/mcp.test.ts` («the guide is computed») |

## I. Interfaz

| Id | Regla | Desde | Prueba |
|---|---|---|---|
| I-01 | Un solo catálogo de bloques: todo lo que la IA puede poner, el usuario lo cambia con un control normal | 2026-10-24 | `packages/views/src/catalogue.test.ts`, `e2e-boni-desktop` («a page of numbers and charts…») |
| I-02 | Los textos de la interfaz solo en `i18n.ts`, en español y en inglés (también las etiquetas del catálogo) | 2026-10-15 | `apps/boni-web/src/core/principles.test.ts`, `contract.test.ts` (`missingIn`) |
| I-03 | El texto cabe en su caja en todas las superficies, en los dos idiomas y con ventana estrecha; una superficie nueva entra en la prueba | 2026-10-16 | `e2e-boni/overflow.spec.ts`, `worst-case.spec.ts` |
| I-04 | El clic usa un bloque o abre su detalle; su menú sale igual en todos por el asa ⋮⋮ y el clic derecho; ningún bloque tiene opciones de menú propias | 2026-10-25 | `e2e-boni/models.spec.ts` («a click lists what a number or a bar counts»). Sustituye a «un clic en un elemento abre su menú» (2026-10-24) |
| I-05 | Cada cambio de `apps/boni-web` sale en una versión nueva de Boni de escritorio | 2026-10-22 | CI, trabajo `desktop-version` |
| I-06 | La app de escritorio real funciona como la usa Juan: entrar, páginas, colecciones, Ajustes → Modelos, las plantillas, copia diaria, enlaces `boni://` | 2026-10-22 | CI, trabajo `e2e-boni-desktop` (`e2e-boni-desktop/desktop.spec.ts`, con pantalla virtual) |
| I-07 | Las pantallas principales no cambian de aspecto sin querer | 2026-10-25 | `e2e-boni/screens.spec.ts` (capturas de referencia) |
| I-08 | Nada interno a la vista: ni ids, ni rutas del vault, ni nombres de campos de Boni | 2026-10-24 | Sin prueba (revisión de capturas) |
| I-09 | Maqueta con la app real antes de programar una pantalla nueva | 2026-10-24 | Sin prueba (forma de trabajar) |
| I-10 | Un bloque de enlace solo abre una página real; si su destino ya no existe, lo dice en vez de abrir una vista fija | 2026-10-27 | `packages/views/src/catalogue.test.ts`, `packages/views/src/templates.test.ts`, `apps/server/src/pages.test.ts`, `e2e-boni/audit.spec.ts` |

## T. Forma de trabajar

| Id | Regla | Desde | Prueba |
|---|---|---|---|
| T-01 | Las instrucciones para desarrollar Boni viven en el repo: `AGENTS.md` corto y sin inventarios, y estos principios; lo personal (NAS, despliegue) y cómo trabajar con Juan, en Boni (`docs/contexto.md`) | 2026-10-27 | `scripts/map.test.mjs` («AGENTS.md stays short») |
| T-02 | Lo que se puede calcular no se escribe a mano: el mapa del código sale de `make map` (la descripción de cada paquete y la primera frase de cada fichero) y la estructura de los datos, del `guide` del MCP | 2026-10-27 | `scripts/map.test.mjs` («every package and file says what it is»), `apps/server/src/mcp.test.ts` («the guide is computed») |
| T-03 | Cada principio apunta a pruebas que existen | 2026-10-27 | `scripts/map.test.mjs` («principles name files that exist») |
| T-04 | El estado y la Cola del desarrollo son registros de Boni, no notas largas ni ficheros del repo | 2026-10-27 | Sin prueba (forma de trabajar) |

## Sustituidas

| Id | Regla | Desde | Sustituida por |
|---|---|---|---|
| — | Un clic en un elemento abre su menú, el mismo que el asa | 2026-10-24 | I-04 (2026-10-25) |
