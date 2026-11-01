# Colecciones como clases

**Decidido por Juan el 2026-10-27** (lo marcado «Propuesto» espera su OK). Amplía el modelo de entidades de
`docs/nucleo.md` (§4) y deja como historia su §9 (importación del vault y espejo): ya no hay vault. Las reglas que se
pueden comprobar con código están en `docs/principios.md` (A-06, D-10 a D-15) con la prueba que las vigila.

## 1. La idea

En Notion todo es una página; en Boni todo es un registro. Cada registro pertenece a una colección, y las colecciones
forman un árbol, como las clases de un lenguaje orientado a objetos:

- Una **colección raíz** tiene los campos nativos de todo registro: título, nota (el texto de su página), creado,
  editado y quién lo creó o lo editó. En la interfaz van ocultos por defecto.
- Cada colección **hereda los campos de su madre** y puede añadir los suyos. Un campo que se añade a una colección
  aparece en todas sus descendientes.
- Las hijas de una colección son **registros o subcolecciones**. Un registro no tiene hijos.
- Una colección sin campos propios (ni heredados, salvo los nativos) es una **carpeta de notas sueltas**.

Comparables: Tana («Extend» en sus supertags), Logseq DB (etiquetas como clases con «Extends» y una etiqueta raíz),
ServiceNow (tablas que extienden `Task`) y Fibery (todo es una base de datos; el documento es un campo del registro).
La diferencia: allí las clases clasifican; aquí el árbol de clases es también la navegación, y cada registro tiene una
sola clase.

## 2. Reglas

1. **Herencia simple.** Una colección tiene una sola madre. Lo transversal (salir en el calendario, poder completarse)
   se hará con interfaces (§6), no con varias madres: en Logseq, que las permite, un segundo «Extends» pisa al primero.
2. **Campos.** Los valores se guardan por id de campo, y un campo definido en una antecesora tiene el mismo id en todas
   sus descendientes. No puede haber dos campos con el mismo nombre en una misma rama.
3. **Polimorfismo.** La tabla de una colección incluye los registros de sus descendientes. La colección de cada registro
   es una columna nativa («Colección») que se filtra y se agrupa como cualquier otra. Lo mismo para las consultas, las
   gráficas y las vistas sobre una colección.
4. **Cambiar una madre afecta a toda su rama.** Quitar un campo enseña antes cuántos valores se pierden; los valores
   quedan en el registro de operaciones y el cambio se deshace.
5. **Mover sin perder.** Un registro que cambia de colección (de Tarea a Evento) conserva su id, su historia y los
   valores de los campos que comparten; los que su nueva colección no tiene se archivan, nunca se pierden. Lo mismo al
   mover una colección de rama. (Hoy, mover un evento a otro calendario crea otra entidad y manda la vieja a la
   papelera: se acaba con esto.)
6. **Notas.** Cualquier registro puede tener nota, su página. La mayoría no la tendrá (un gasto suele ser solo sus
   campos); si la tiene, es una página más con su información. Un cuerpo que solo es una plantilla vacía no cuenta.
7. **El árbol.** Enseña las colecciones y, dentro, los registros con nota. Cada colección decide si sus notas salen en
   el árbol y el usuario lo cambia; por defecto no salen en las que tienen campos propios, para que no haya ruido. Un
   registro sin nota se ve en la tabla de su colección y en las vistas que lo incluyen. «Colecciones» y «Todas las
   páginas» pasan a ser este único árbol.
8. **Privacidad heredada.** Una colección es al menos tan cerrada a la IA como su madre. Una consulta de un modelo sobre
   una madre nunca devuelve ni cuenta los registros de una hija cerrada para él. Bajar el nivel de algo privado sigue
   pidiendo desbloquearlo en su página. Sustituye a las «zonas» por carpeta del vault.
9. **Descripción.** Cada colección tiene una descripción corta: qué va en ella. Sustituye a los README de las carpetas;
   la ve el usuario al abrir la colección y el MCP se la da a las IA, así que el índice nunca hay que mantenerlo a mano.
10. **Nada del dominio del usuario en el código.** Cualquier colección con un campo de fecha puede ser un calendario, y
    el usuario elige si se separa o se colorea por alguno de sus campos. «Área», «Docencia» o «Tarea» son datos del
    usuario, nunca nombres que el código conozca.

## 3. Páginas (propuesto)

Una página (un panel de cifras y gráficas, como el que vino del primer Boni) es un registro con nota de una colección;
por ejemplo, un panel de gastos dentro de una colección «Finanzas» sin campos propios. No hay páginas dentro de páginas:
lo que se anida son colecciones. Las plantillas de Boni viven en la rama de sistema («Boni»), de solo lectura.

## 4. Lo que se va con el vault

- La ruta de la nota como identidad (`f_vault_path`): un registro se identifica por su id, también en Boni Calendar, en
  los enlaces `boni://` y en el MCP.
- El espejo, la importación del vault, `_system/`, las notas README e índices, las zonas por carpeta y Boni Calendar
  sin servidor (leyendo una carpeta del disco).
- Las convenciones de Obsidian en los datos: `type` y `summary` en las propiedades, incrustaciones `![[…base]]`,
  enlaces escritos como texto (`"[[…]]"`), cuerpos que solo son la plantilla.

## 5. Un ejemplo

```
Registro            raíz: título, nota, creado, editado, quién (ocultos)
├── Agenda          fecha, horas, todo el día, zona horaria, lugar, proyecto → Proyectos
│   ├── Evento
│   │   └── Cita    privada
│   └── Tarea       + hecha, estimación
├── Proyectos · Personas
├── Finanzas        sin campos: aquí vive su panel
│   └── Movimientos · Deudas · Categorías · Reglas
├── Conocimiento    sin campos: notas sueltas
└── Boni            de sistema, solo lectura: llamadas a modelos, actividad, ejecuciones, plantillas
```

La tabla de Agenda tiene tareas y eventos (la columna «Colección» dice cuál es cada uno); el calendario puede enseñar
Agenda entera, separada por el campo que elija el usuario; una cita es privada aunque Agenda no lo sea.

## 6. Interfaces (propuesta, 2026-11-01; tareas 4 y 5)

La herencia dice lo que algo **es** (una madre); una interfaz dice lo que **sabe hacer** (puede tener varias): un
nombre y unos papeles que la colección cumple con sus campos. Boni ya tiene el embrión: el mapeo de papeles de un
calendario (`packages/calendar/src/mappingRoles.ts`, en la definición de cada calendario) y los perfiles de las
gráficas (`moneyProfile`, que nombra las colecciones del dinero en el código, y `entityProfile`).

**El resultado.** Cada colección dice qué sabe hacer y las apps la usan por eso, nunca por su nombre:
- Agenda (y con ella Tarea y Evento) «sale en el calendario» y «se marca hecha»; Movimiento «cuenta como dinero».
- Boni Calendar enseña cada colección fechable como calendarios, **separados por el campo que Juan elija** (tarea 5):
  Agenda por «área» da los calendarios de hoy (Docencia, Gestiones, Planes…); por «proyecto» daría uno por proyecto.
- La casilla de las listas del móvil, «Hoy» en Inicio y lo que la conversación marca hecho salen de *Completable*;
  hoy salen de la columna de tareas de un calendario (`taskDoneField`).
- Las gráficas y la conciliación trabajan sobre *Importe*: otra colección con importe, fecha y categoría (los gastos de
  un viaje, por ejemplo) entra en ellas sin código nuevo.

**Las tres interfaces y sus papeles** (un campo por papel; la colección los guarda y sus hijas los heredan, como los
campos):

| Interfaz | Papeles | Se usa en |
|---|---|---|
| *Fechable* | `fecha` (o `inicio`), y si los tiene `hora`, `fin`, `zona` | el calendario, «Hoy», los avisos |
| *Completable* | `hecha` (una casilla) | las listas, «Hoy», las tareas del calendario |
| *Importe* | `importe`, `fecha` y `categoría` | las gráficas de dinero, la conciliación |

**Lo que cambiaría:**
- Los papeles pasan de la definición de cada calendario y del código del dinero a la colección. La definición del
  calendario se queda con lo suyo: el color, los avisos y por qué campo se separa.
- Una reestructuración pasa a las colecciones de Juan los papeles de sus calendarios y del dinero, con ensayo antes y
  aplicada por él, como las anteriores (D-16).
- En la app, la página de una colección dice qué sabe hacer, con un control por papel (como hoy «Fecha» y «Hecha» en los
  ajustes de un calendario); en Boni Calendar, «Separar por» y «Colorear por» en los ajustes de un calendario.

**Ejemplos:**
- Una colección nueva «Viajes» con un campo de fecha: con su papel `fecha`, sale en Boni Calendar sin tocar nada más.
- Separar Agenda por «área»: un calendario por cada área (los que hay hoy); un valor nuevo de «área» trae su
  calendario; lo que no tiene área va a «Sin área».
- «Libros» con una casilla «Leído» como `hecha`: el móvil la tacha al deslizar, como una tarea.

**Para decidir (Juan):**
1. Los papeles en la colección (propuesto), heredados por sus hijas, o en cada calendario como hoy.
2. Separar por un campo crea un calendario por valor también para los valores nuevos, y uno «Sin …» para los vacíos
   (propuesto), o solo los valores que Juan marque.
3. Cómo se dice en la app: «Sale en el calendario», «Se marca hecha», «Cuenta como dinero» (propuesto).

Con esas tres respuestas, el orden: la interfaz en el núcleo (papeles, herencia, API y MCP, con sus principios y
pruebas); la reestructuración de sus datos; Boni Calendar y el móvil sobre ellas; «Separar por» en Boni Calendar, con
maqueta antes (I-09).

## 7. Orden

Cada paso es un PR con sus pruebas, y se despliega al cerrarse:

1. Forma de trabajar: `AGENTS.md` corto, `make map`, el `guide` calculado del MCP y la descripción de cada colección
   (`docs/contexto.md`).
2. Fuera el vault: espejo, importación, la lectura del vault en el servidor, Boni Calendar sin servidor, `legacy/`.
3. Clases en el núcleo: madre de cada colección, raíz con los campos nativos, campos heredados, consultas que incluyen a
   las hijas, mover sin perder, privacidad heredada y la API del árbol. **Hecho (2026-10-28):** `TypeDef.parent`, los
   campos heredados como copias marcadas `from` que las operaciones mantienen al día, `set_parent` (lo que la nueva madre
   no da queda archivado y se deshace exacto), `store.retype` (mover un registro conservando su id) y las listas de una
   rama (`deep`); el nivel de la IA se hereda y las reglas de una madre alcanzan a sus hijas; la API de datos y el MCP
   dan la madre de cada colección y las filas de las hijas; Boni Calendar mueve un evento sin crear otro. La raíz es
   implícita: sus campos nativos son los de toda entidad (título, nota, creado, editado; quién, en la auditoría).
4. Un solo árbol en la interfaz, en lugar de «Colecciones» y «Todas las páginas». **Hecho (2026-10-28):** la barra
   lateral tiene arriba Buscar, Conversación y «Todas las páginas» (el árbol entero para gestionarlo: buscar, filtrar
   por lo que ve la IA, el ojo, crear, mover y eliminar), y debajo «Recientes» y «Páginas» (para abrir, añadir y
   eliminar, con el ojo), plegables. Las páginas de antes siguen arriba de «Páginas» hasta el paso 5.
5. Migrar los datos de cada cuenta a su árbol (ensayo antes y una sola ejecución que se deshace entera). **Hecho el
   código (2026-10-28):** `cli.ts reshape <cuenta> --plan-note <id>` lee el plan de una nota de la cuenta (datos, con sus
   nombres: nada del dominio en el código) y crea colecciones, mueve registros conservando su id (lo que el destino no
   tiene viaja archivado), pone colecciones dentro de otras, apunta los calendarios a una rama separada por un campo
   (`where`, `make`) y archiva lo que queda vacío; el ensayo trabaja sobre una copia y solo da cuentas, y lo aplicado es
   una transacción que `--undo` deshace entera. Una hija con título propio lo conserva (no hereda el de su madre).
6. Sin rutas: fuera `f_vault_path`. **Hecho (2026-10-29):** un registro se conoce por su id en Boni Calendar (sus
   filas), en los enlaces `boni://note?id=`, en el MCP (ni lee ni enseña rutas) y en el dinero: la conciliación, las
   gráficas y «Apuntar gasto» trabajan con ids, y las personas de un movimiento, lo que salda y la madre de un proyecto
   son relaciones (una relación con una madre acepta toda su rama, D-18). Lo que dejó el vault lo limpia la
   reestructuración, en la misma ejecución que se deshace entera: los enlaces por nombre de fichero pasan a relaciones,
   un registro sin título toma el encabezado de su texto o el nombre de su fichero, una rama se reparte por el prefijo de
   su ruta (la wiki en colecciones), los campos de Obsidian se archivan, las incrustaciones `![[…]]` salen del texto y,
   al final, se archiva la ruta. Desde ahí nada la lee (`paths.test.ts`).
7. Interfaces.
