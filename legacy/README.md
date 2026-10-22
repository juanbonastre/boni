# legacy

Código anterior al núcleo de Boni, guardado como referencia mientras se porta (`docs/nucleo.md`, sección 12).

- **`boni/`**: el primer Boni, el repo privado `juanbonastre/boni`, renombrado `boni-pruebas` y archivado el
  2026-10-19. Tiene el servidor Python (FastAPI), los clientes web, Electron y Android de gráficas, atajos y widgets, y el
  contrato `api/`. Entró con sus 37 commits de `main` (decisión de Juan, 2026-10-19), pero con el nombre de la tailnet,
  las personas reales y un comercio real de sus ejemplos y pruebas cambiados por otros inventados. El repo archivado
  conserva el original.

- **`obsidian/`**: el plugin de Obsidian de Boni Calendar (`plugin/`), sus pruebas en el Obsidian instalado (`e2e/`) y su
  configuración de Playwright. Juan dejó el soporte de Obsidian el 2026-10-22 (todo pasa a Boni); se retomará con la
  versión para más gente. Para volver: moverlo a `apps/obsidian-plugin` y `e2e-obsidian`, y recuperar los objetivos
  `plugin`, `install-obsidian`, `e2e-obsidian` y `bench-obsidian` del Makefile (historial de git).

Aquí nada se compila, se analiza ni se prueba (queda fuera de Biome, del espacio de trabajo de pnpm, del CI y de la imagen
Docker). Cuando una pieza ya está portada al núcleo, se borra de aquí en el mismo PR.

Portado (y borrado de aquí): `apps/web` → `apps/boni-web`, `e2e` → `e2e-boni`, `api` → `apps/boni-web/api` (2026-10-20,
con su historial). Quedan como referencia el servidor Python y los envoltorios de escritorio y Android, que aún apuntan a
`apps/web`.
