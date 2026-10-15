# Rendimiento y eleccion del contenedor

Medido el 2026-10-15 en el portatil de Juan (Linux Mint Cinnamon, X11, i5-10300H, GTX 1650 Optimus + Intel UHD, 60 Hz,
ventana de 1600x900) con el banco integrado (`?bench=auto`): reproduce rueda, Ctrl+rueda y Shift+rueda sobre la rejilla
real y mide el tiempo entre fotogramas. "jank" = fotogramas de mas de 25 ms (un fotograma perdido a 60 Hz). Cada
escenario dura 3 s con la rueda girando sin parar (mas duro que el uso real). Datos completos en
`docs/medidas/2026-10-15-contenedor.json`.

| Escenario | Chrome (ventana) | Electron 44 | Tauri 2 (WebKitGTK) |
|---|---|---|---|
| Fotograma en reposo | 16,7 ms | 16,7 ms | **32 ms** (30 Hz) |
| Rueda, saltos de 100 px | 0 perdidos de 194 | 0 de 194 | 65-72 de 66-74 |
| Rueda, flujo tipo touchpad | 0 de 195 | 0 de 194 | 61-87 de 61-88 |
| Ctrl+rueda (zoom) | 2-4 de ~190 | 8-11 de ~185 | 68-82 de 68-82 |
| Shift+rueda (dias) | 0 de 195 | 1-2 de ~194 | 70-80 de 88-107 |
| 14 dias, scroll + zoom | 0-2 de ~190 | 1-2 de ~194 | 65-95 de 70-96 |
| Mes, rueda | 2 de 192 | 1-5 de ~192 | 61-75 de 105-120 |

Tauri se probo con las variables habituales de WebKitGTK (`WEBKIT_DISABLE_DMABUF_RENDERER`,
`WEBKIT_DISABLE_COMPOSITING_MODE`, offload a NVIDIA) y no mejoro: el motor limita a 30 fotogramas y cada fotograma
tarda 30-90 ms con la misma pagina que en Chromium va a 60.

**Decision: Electron.** Mismo motor que Chrome (las pruebas headless y de ventana valen para el escritorio), mismo
rendimiento en el portatil, mas pesado en disco y memoria pero irrelevante frente a la fluidez. Tauri queda descartado
mientras WebKitGTK siga asi; si se revisa, el banco ya esta hecho (`bench/`).

## Que hizo falta para llegar a 60 fps (leccion que se queda)
- Mover la rejilla solo con `transform` escrito directamente al DOM en cada fotograma; nada de estado de React ni de
  variables CSS en cascada.
- Posiciones de eventos y etiquetas en porcentaje de la altura de la columna (no `calc(var(--hh) * ...)` por elemento):
  cambiar la altura de la hora cambia el estilo de unos pocos elementos, no de cientos.
- Renderizar solo unos dias alrededor de lo visible.
- Zoom: mientras dura la animacion la rejilla se escala en el compositor (`scaleY`) y se recalcula el diseno real una
  vez al terminar (o si el estiramiento pasa del 50 %). Recalcular el diseno en cada fotograma costaba 27-35 fotogramas
  perdidos por escenario; con el escalado, 2-4.
- El texto no se estira durante el zoom: el cuerpo de cada evento y las etiquetas de hora se contraescalan (`--inv`) y
  tienen capa propia (`will-change: transform`). Sin capa propia (o activandola solo durante el zoom) costaba 20-23
  fotogramas perdidos por escenario y un pico de 233 ms al crear las capas; con capa permanente, 8-9 (igual que antes).
- Vista mes: las filas se colocan respecto a una "epoca" que solo cambia cada 26 semanas y su `top` no depende de la
  posicion en la lista; si una fila cambia de posicion, el navegador repinta toda la capa en cada paso y las filas
  vuelven a renderizarse todas. Con eso el desplazamiento constante de la rueda paso de 16-19 a 6-7 fotogramas perdidos
  de ~190 (con filas llenas de eventos: las series continuan para siempre, antes las filas lejanas estaban vacias).
- Repeticiones: los objetos de ocurrencia se cachean por serie y dia (`OccurrenceCache`) para no recalcular segmentos, y
  el desfase horario de cada zona se cachea por tramos de 15 minutos (`Intl` es lo mas lento de toda la expansion).

## Texto nitido (2026-10-15)
Juan noto el texto algo difuminado. Causa: los contenedores con capa de GPU (`will-change: transform`) se movian a posiciones
con fracciones de pixel (desplazamiento horizontal con el ancho de columna `ancho/7`, altura de hora fraccionaria,
`translateY(-50%)` sobre una caja de altura impar) y la capa se remuestrea. Ademas, el texto de cada evento tenia su propia
capa permanente. Cambios: desplazamientos en pixeles enteros, ancho de columna y alto de fila del mes en pixeles de
dispositivo enteros, altura de hora multiplo de 4 px, cajas de etiqueta con altura par y capas de texto solo mientras dura
el zoom. Medido (gradiente maximo del borde del texto, mayor = mas nitido): cabecera de dias 108 a 166, tarjetas 112 a 132,
etiquetas de hora 107 a 112. Coste: con la rueda y Ctrl pulsado el zoom queda igual (8-11 fotogramas perdidos de ~185); con el
gesto de pellizco del touchpad (que no pulsa Ctrl) las capas se crean en el primer fotograma y hay un tiron de ~100 ms al empezar.
