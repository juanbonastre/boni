# Clientes de Boni

Proyecto Gradle con Kotlin Multiplatform y Compose Multiplatform. `shared/` tiene casi todo el codigo, el que usaran el
escritorio y Android: modelos del contrato, cliente de la API, cola sin conexion, graficas y pantallas. `desktop/` es la app de
escritorio. Android llegara mas adelante, como otro modulo que usa `shared/`.

## Escritorio
- **Ventana principal**: boton "Apuntar gasto" y las graficas. El formulario lo describe el servidor; las listas largas
  (categorias, personas) se buscan en el servidor mientras escribes.
- **Graficas**: dibujadas a mano, animadas al aparecer, con el importe exacto al pasar el raton. Al tocar una barra de
  "Gasto del mes" se ve el detalle de ese grupo. Siguen el tema claro u oscuro.
- **Widgets**: una ventana pequena sin bordes por grafica. Se mueven arrastrando y se redimensionan; recuerdan su sitio. Con
  el boton derecho: abrir Boni, actualizar u ocultar. En Linux con X11 (Cinnamon) quedan por debajo de las ventanas, en todos
  los escritorios y fuera de la barra de tareas, si esta instalado `wmctrl` (`sudo apt install wmctrl`).
- **Icono en la bandeja**: abrir Boni, mostrar u ocultar widgets, arrancar al iniciar sesion, actualizar, ajustes y salir.
  Cerrar la ventana principal no cierra Boni: los widgets siguen.
- **Arranque al iniciar sesion** (Linux, con Boni instalado desde el `.deb`): crea `~/.config/autostart/boni.desktop`,
  que abre solo los widgets y el icono (`--background`).
- **Sin conexion**: los widgets muestran los ultimos datos guardados y los gastos se guardan en el equipo y se envian
  solos al volver la red (sin duplicarse).
- Archivos (Linux): ajustes y token en `~/.config/boni/settings.json` (solo legible por tu usuario); cola y datos guardados
  en `~/.local/share/boni/`.

## Instalar
GitHub Actions genera un `.deb` en cada cambio (artefacto `boni-deb` del workflow `clients`). Instalar con
`sudo apt install ./boni_*.deb`; queda en el menu como "boni". La primera vez pide la URL del servidor y el token del equipo
(se crea en el servidor con `boni device add portatil`).

## Desarrollo
```
./gradlew check                    # pruebas (incluye leer api/examples, las respuestas reales del servidor)
./gradlew :desktop:run             # abrir la app
./gradlew :desktop:screenshots     # PNG de graficas, widgets y formulario en desktop/build/screenshots
./gradlew :desktop:packageDeb      # paquete .deb
```
Las capturas de cada build de CI tambien se publican en la rama `ci-screenshots` del repositorio.
