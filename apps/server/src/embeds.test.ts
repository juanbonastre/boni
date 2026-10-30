import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { embedCounts, embedDoubts } from "./embeds.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";

/** Invented notes with the embeds Obsidian leaves: images by their path or name, a PDF, notes and a view. */
const TYPES: TypeSpec[] = [
  { key: "tarea", name: "Tarea", folder: "agenda/" },
  { key: "wiki", name: "Wiki", folder: "wiki/" },
  { key: "archivos", name: "Archivos", folder: "", files: true },
];
const NOTES: Record<string, string> = {
  "agenda/foto.md":
    "Texto inventado.\n\n![[agenda/attachments/image 2.png|image 2.png]]\n![[image 3.png]]\n![[otra/carpeta/image 9.png]]\n",
  "agenda/area.md": "![[area.base]]\n",
  "wiki/tema.md": "# Tema inventado\n\n![[wiki/doc.pdf]]\n![[Otra nota#Sección]]\n![[No existe]]\n",
  "wiki/Otra nota.md": "Sin título propio.\n",
  "agenda/attachments/image 2.png": "png inventado",
  "agenda/attachments/image 3.png": "png inventado",
  "wiki/doc.pdf": "%PDF-1.7 inventado",
};

describe("the vault's embeds, counted (D-16)", () => {
  it("by class and collection, with what finds its file or note; never what a text says", () => {
    const store = openUserStore(":memory:");
    seed(store, TYPES, NOTES);
    const lines = embedCounts(store);
    expect(lines).toEqual([
      "Incrustaciones de Obsidian (![[…]]): 7 en 3 registros.",
      "  Imágenes: 3; 1 encuentra su fichero en Boni, 1 solo por el nombre.",
      "  PDF: 1; 1 encuentra su fichero en Boni.",
      "  Notas: 2; 1 encuentra su nota en Boni.",
      "  Vistas de Obsidian (.base): 1.",
      "Por colección: «Tarea» 4, «Wiki» 3.",
    ]);
    expect(lines.join("\n")).not.toMatch(/image|Tema|doc\.pdf|Otra nota/);
    store.close();
  });
});

describe("the embedded files still to choose (Juan, 2026-10-30)", () => {
  it("one line each, with the folders of the files called so; a collection kept from the models only counts", () => {
    const store = openUserStore(":memory:");
    seed(
      store,
      [
        { key: "tarea", name: "Tarea", folder: "agenda/" },
        { key: "diario", name: "Diario", folder: "diario/", ai: "private" },
        { key: "archivos", name: "Archivos", folder: "", files: true },
      ],
      {
        "agenda/disfraz.md": "# Disfraz\n\n![[image 2.png]]\n![[falta.png]]\n![[Una nota]]\n",
        "diario/hoy.md": "# Hoy\n\n![[image 2.png]]\n",
        "agenda/gestiones/attachments/image 2.png": "png",
        "wiki/temas/attachments/image 2.png": "png",
      },
    );
    expect(embedDoubts(store)).toEqual([
      "Ficheros incrustados que quedan (![[…]]): 3 en 2 registros.",
      "«Tarea» «Disfraz»: image 2.png — 2 ficheros se llaman así: agenda/gestiones/attachments · wiki/temas/attachments",
      "«Tarea» «Disfraz»: falta.png — no está en Boni",
      "«Diario»: 1 (cerrada a la IA: no se listan)",
    ]);
    store.close();
  });
});
