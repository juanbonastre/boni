# legacy

Código anterior al núcleo de Boni, guardado como referencia mientras se porta (`docs/nucleo.md`, sección 12).

- **`boni/`**: el primer Boni, el repo privado `juanbonastre/boni`, renombrado `boni-pruebas` y archivado el
  2026-10-19. Tiene el servidor Python (FastAPI), los clientes web, Electron y Android de gráficas, atajos y widgets, y el
  contrato `api/`. Entró con sus 37 commits de `main` (decisión de Juan, 2026-10-19), pero con el nombre de la tailnet,
  las personas reales y un comercio real de sus ejemplos y pruebas cambiados por otros inventados. El repo archivado
  conserva el original.

Aquí nada se compila, se analiza ni se prueba (queda fuera de Biome, del espacio de trabajo de pnpm, del CI y de la imagen
Docker). Cuando una pieza ya está portada al núcleo, se borra de aquí en el mismo PR.

Portado (y borrado de aquí): `apps/web` → `apps/boni-web`, `e2e` → `e2e-boni`, `api` → `apps/boni-web/api` (2026-10-20,
con su historial); el envoltorio de escritorio → `apps/boni-desktop` (2026-10-22) y el de Android → `apps/boni-android`
(2026-10-23). Queda como referencia el servidor Python (retirado del NAS el 2026-10-23).
El plugin de Obsidian de Boni Calendar (`obsidian/`) se borró el 2026-10-28 con el modo sin servidor de Boni Calendar (PR
«Fuera el vault», parte B): leía un vault, que ya no existe. Si vuelve, se rehace sobre el servidor (historial de git).
