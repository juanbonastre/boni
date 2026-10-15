# Estado de Boni Calendar

Fase 1: interfaz de escritorio con datos de ejemplo (sin datos reales ni sincronizacion). Actualizado: 2026-10-15.

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

## Pendiente
- Excepciones por ocurrencia mas finas (hoy "solo este" separa el evento de la serie, no la modifica dentro de ella).
- Repeticiones mensuales "el segundo martes" y zonas horarias distintas por evento recurrente.
- Revisar con Juan colores, densidad y atajos.

## Fase 2 (no empezada)
Almacen de datos, migracion de `agenda/`, otros calendarios, MCP y avisos (ver la nota del proyecto en el vault).
