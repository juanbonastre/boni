# legacy

Código anterior al núcleo de Boni, guardado como referencia mientras se porta (`docs/nucleo.md`, sección 12).

- **`boni/`**: el primer Boni, el repo privado `juanbonastre/boni`, renombrado `boni-pruebas` y archivado el
  2026-10-19. Tiene el servidor Python (FastAPI), los clientes web, Electron y Android de gráficas, atajos y widgets, y el
  contrato `api/`. Entró con sus 37 commits de `main` (decisión de Juan, 2026-10-19), pero con el nombre de la tailnet,
  las personas reales y un comercio real de sus ejemplos y pruebas cambiados por otros inventados. El repo archivado
  conserva el original.

Aquí nada se compila, se analiza ni se prueba (queda fuera de Biome, del espacio de trabajo de pnpm, del CI y de la imagen
Docker). Cuando una pieza ya está portada al núcleo, se borra de aquí en el mismo PR.
