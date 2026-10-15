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

## Pendiente de la fase 1
- Arrastrar y estirar eventos de todo el dia y mover eventos en la vista mes.
- Eventos recurrentes en la interfaz (el modelo ya los admite como ampliacion; hoy los datos de ejemplo son sueltos).
- Revisar con Juan: colores, densidad, textos, atajos.

## Fase 2 (no empezada)
Almacen de datos, migracion de `agenda/`, otros calendarios, MCP y avisos (ver la nota del proyecto en el vault).
