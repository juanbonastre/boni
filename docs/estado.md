# Estado de Boni Calendar

Fase 1: interfaz de escritorio con datos de ejemplo (sin datos reales ni sincronizacion). Actualizado: 2026-10-16.

## Hecho
- **Contenedor**: Electron (medido contra Tauri en el portatil, ver `rendimiento.md`).
- **Vistas**: dia, semana, N dias (2-14, teclas 2-9) y mes. Primer dia de la semana lunes o domingo.
- **Rueda**: vertical, Ctrl+rueda (zoom de horas anclado al raton), Shift+rueda (dias), con suavizado y 60 fps medidos.
- **Barra lateral**: mini mes con los dias visibles resaltados, calendarios por cuenta con color, ojo y editor de propiedades.
- **Eventos**: detalle en ventana o panel lateral, propiedades por calendario (texto, numero, opcion, varias opciones,
  casilla, fecha, enlace, proyecto), tareas con casilla, todo el dia y multidia.
- **Interaccion**: arrastrar para crear, mover y estirar (pasos configurables), Esc cancela, doble clic crea, deshacer y
  rehacer, borrar con aviso para deshacer, autodesplazamiento al arrastrar cerca de los bordes.
- **Clic derecho**: menu para eventos, huecos de la rejilla, celdas del mes y calendarios.
- **Seleccion multiple**: Ctrl+clic anade o quita, Mayus+clic anade el rango cronologico desde el ultimo evento
  pulsado, Ctrl+Mayus+clic anade el rango solo del calendario del evento pulsado. Ctrl+A selecciona lo visible, Esc o clic
  en vacio la quitan. Arrastrar uno mueve todos; Supr, el menu contextual y la barra inferior actuan sobre todos.
- **Paleta (Ctrl+K)**: comandos, buscar eventos, ir a una fecha y creacion rapida ("clase FUP manana 10-12 #docencia").
- **Ajustes**: tema, idioma (es/en), formato 12/24 h, zona horaria y segunda zona, numero de semana, duracion por defecto,
  ajuste al arrastrar, densidad.
- **Paquetes**: `.deb` y AppImage (`make package`).

## Cerrado en esta ronda
- **Todo el dia**: mover por dias arrastrando, estirar por cualquiera de los dos extremos y crear arrastrando por la fila
  de todo el dia (semana, dia y N dias) y por las celdas del mes. Los calendarios de solo lectura no se pueden mover.
- **Mes**: mover chips y barras a otro dia (conservando la hora), estirar barras, crear arrastrando por las celdas,
  Esc cancela. Con varios seleccionados se mueven todos.
- **Repeticiones**: diaria, semanal (con dias), mensual y anual, cada N, hasta una fecha o N veces; ajustes rapidos y
  editor personalizado en el detalle ("Repetir"). Al editar o borrar una repeticion se pregunta si afecta a este evento,
  a este y los siguientes, o a todos. Duplicar una ocurrencia crea un evento suelto. Los datos de ejemplo usan series
  reales para las clases fijas.

## Ajustes tras probarlo (0.3.1)
- Los textos largos de los desplegables ya no saltan de linea ni se salen de su fila o del detalle.
- Un evento con hora se puede estirar mas alla de medianoche (y hacia atras) arrastrando su borde inferior o superior a la
  columna del dia siguiente o anterior; los eventos que cruzan medianoche se mueven enteros desde cualquiera de sus dos partes.
- El detalle (ventana y panel) tiene "Tipo: Evento / Tarea" y la casilla "Hecha".

## Pendiente
- Excepciones por ocurrencia mas finas (hoy "solo este" separa el evento de la serie, no la modifica dentro de ella).
- Repeticiones mensuales "el segundo martes" y zonas horarias distintas por evento recurrente.
- Revisar con Juan colores, densidad y atajos.

## Fase 2 (en marcha)
Plan aprobado: la verdad son notas del vault con propiedades; colecciones con esquema, vistas con mapeo de columnas y
repeticiones en `packages/core`; la app, un plugin de Obsidian y mas adelante un servidor son anfitriones.
- **Paso 1, nucleo de colecciones** (hecho, PR 9 a 11). PR 1 (#9): `Collection`, `Row`, `CalendarView` con mapeo (fecha y hora
  separadas o inicio/fin ISO, tarea por casilla o estado, repeticion como texto RRULE), proyeccion fila a evento y
  vuelta, `reconcileRows`, `CollectionProvider`, validacion y la muestra como colecciones. PR 2: la app guarda filas y
  deriva eventos, calendarios y proyectos de ellas (todos los e2e anteriores pasan sin cambios); cada cambio se entrega a
  un `CollectionProvider` (en memoria por ahora). PR 3: el dialogo de propiedades del calendario gana la seccion "Vista de calendario" (columnas de fecha, horas y tareas; estado con "Hecha cuando"); los calendarios sin columna de tarea no ofrecen Evento / Tarea.
- **Paso 2, la app lee y escribe el vault** (hecho, PR 12 a 16): (1) puente de archivos y lector/editor de notas (`notes.ts`,
  `vault-fs.cjs`, `window.boniVault`), sin interfaz nueva; (2) lectura del vault: definiciones de coleccion en
  `_system/colecciones/`, carga de las notas de `agenda/` (solo lectura), Ajustes → Datos y lista de notas ignoradas
  (medido con el vault real: ~2.750 notas en ~1,1 s sin indice); (3) indice
  local y vigilancia (hecho: arranque en caliente con ~2.750 notas en ~0,24 s frente a ~0,64 s en frio, y un cambio hecho
  fuera de la app se ve en ~0,3 s); (4) escritura en el vault (opcional en Ajustes), "Abrir nota en Obsidian", notas nuevas con contador en el nombre del archivo, mover entre calendarios, borrar a la papelera con deshacer y aviso si la nota cambio fuera (hecho); (5) series como notas individuales enlazadas por `series` (hecho: crear con "Repetir", 12 meses por delante, ampliar al leer con la escritura activada, ambito este/siguientes/todos).
- Texto que no cabe (PR 17): una regla general en `styles.css` y la guarda `e2e/overflow.spec.ts` para todas las superficies.
- **Paso 3, plugin de Obsidian** (plan aprobado el 2026-10-16; PR 1 hecho: la app acepta otro anfitrion sin cambiar
  nada visible: `host.ts` y `mountApp` inyectan el puente, el almacenamiento de ajustes y donde escuchan los atajos; menus,
  ventanas y avisos quedan dentro del contenedor; el CSS se encierra bajo `.boni` al compilar; prueba `e2e/embed.spec.ts`
  con la app dentro de una pagina ajena, tambien en shadow DOM. PR 2: el plugin en `apps/obsidian-plugin/` (`make plugin`):
  pestana con icono y comando "Abrir Boni Calendar", la app dentro de un shadow DOM, puente sobre la API de Obsidian
  con tests contra una API falsa, escritura activada, indice en IndexedDB del dispositivo; probado a mano en un Obsidian
  real con perfil y vault temporales. Las cabeceras de dia ya caben en columnas estrechas. PR 3: pruebas automaticas en el
  Obsidian instalado (`make e2e-obsidian`, perfil y vault temporales e inventados), medidas de apertura y fluidez
  (`make bench-obsidian`, ver `rendimiento.md`) e instalacion con `make install-obsidian VAULT=...`): la misma app en una pestana de Obsidian con un
  puente sobre la API de Obsidian; solo escritorio, escritura activada por defecto, instalacion con un comando que copia el
  plugin a `.obsidian/plugins/boni-calendar/`. PRs: (1) preparar la app para otro anfitrion (puente inyectado, atajos solo con
  el foco en el calendario, ventanas y menus dentro del contenedor, CSS encerrable); (2) el plugin en `apps/obsidian-plugin/`;
  (3) pruebas en un Obsidian real con perfil y vault temporales, medidas e instalacion. Full Calendar ya esta desactivado en el
  portatil.
- Pasos 4 y 5 de la fase 2: servidor en el NAS y SQLite, solo si hay un caso real.
