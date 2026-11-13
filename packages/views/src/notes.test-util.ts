/**
 * (test) Invented notes shaped like a user's (never real ones): what a vault of Obsidian and an export of Notion left
 * in Boni's rows, and what Boni's own editor writes, for the tests that a note's text does not change by being read
 * (task 2g): every construct the editor paints, the ones it keeps as written, the ways each can be spelled, a page's
 * blocks in «boni» fences, Boni's files, and long notes of the size a person's journal reaches.
 */

/** A file row's id as the server makes them (`f_` and a ULID-like tail). */
const FILE = "f_01m5ztq8w3k2v7n4b9c6x1d0aa";

export const NOTES: Record<string, string> = {
  empty: "",
  "only a newline": "\n",
  "blank lines only": "\n\n  \n",
  "one line, no final newline": "Comprar pan",
  "what Boni's editor writes": `## Material

- Proyector
- [ ] Fotocopias
- [x] Reservar el aula

1. Repasar el tema
2. Preparar los ejercicios

> Una cita
> en dos líneas

\`\`\`python
print("hola")
\`\`\`

---

Llevar el proyector.
`,
  "spelled every other way": `#  Título con espacios   ##
Texto pegado al título.
* viñeta con asterisco
+ viñeta con más
	- anidada con tabulador
      - seis espacios
- [X] hecha con X mayúscula
-   [ ]   con espacios de más
1) con paréntesis
7. empieza en siete
3. y salta
***
___
- - -


Tres líneas en blanco arriba.
Línea con dos espacios al final (salto duro).
Fin sin salto de línea`,
  "kept as written": `#### Un título de cuarto nivel
###### y de sexto

| Fecha | Importe | Nota |
|---|---:|:--|
| 2026-10-01 | 12,50 € | café |
| 2026-10-02 | 3 € | pan \\| leche |

![captura](https://example.com/imagen.png)
Una imagen ![en línea](adjuntos/foto.jpg) dentro de una frase.
Un [enlace](https://example.com/a?b=c&d=e) y un [[Nota enlazada|alias]] y #etiqueta.
Una nota al pie[^1] y un bloque ^b1c2d3.

[^1]: El texto de la nota al pie.

> [!note] Un aviso de Obsidian
> con su texto

<details><summary>Más</summary>

Dentro de HTML.

</details>

$$
E = mc^2
$$

Texto con *cursiva*, **negrita**, ~~tachado~~, \`código\` y <u>subrayado</u>.
\\# no es un título, \\- ni una viñeta
`,
  "fences of every kind": `~~~
con virgulillas
~~~

\`\`\`\`markdown
\`\`\`
un fence dentro
\`\`\`
\`\`\`\`

  \`\`\`js
  // un bloque sangrado
  \`\`\`

\`\`\`
sin cerrar hasta el final
- esto no es una viñeta
`,
  "Boni's files and blocks": `# Viaje

![foto del billete|320](boni:${FILE})
![](boni:f_01m5ztq8w3k2v7n4b9c6x1d0ab)

\`\`\`boni
{"id":"b1","type":"number","title":"Gasto","collection":"t_movimiento","measure":"count","period":"month","bg":true,"at":{"row":"r1","col":0,"w":3}}
\`\`\`

\`\`\`boni
{"id":"md2","type":"divider"}
\`\`\`

\`\`\`boni
esto no es JSON: se queda como código
\`\`\`

\`\`\`boni
{"id":"x","type":"nada"}
\`\`\`
`,
  "quotes and lists mixed": `> uno
>
> tres, tras una línea vacía de la cita
>> anidada
Una línea justo después.
- a
1. b
- [ ] c
  1. d
    - e
        - muy honda
- f

1. otra lista
`,
  "windows line ends": "# Título\r\n\r\n- uno\r\n- dos\r\n\r\nPárrafo\r\ncon dos líneas\r\n",
  "old mac line ends": "Uno\rDos\r\rTres",
  "spaces and tabs at the edges": "   \n\t\nTexto\t\n   \n",
  unicode: `Ñandú, pingüino, café ☕, 日本語, عربي, emoji 👩🏽‍💻 y 🇪🇸.
Caracteres de control: ​   fin.
`,
  "a heading alone with trailing hashes": "### Hecho ###",
  "a paragraph that looks like a slash command": "/tabla no es una orden\n",
  "code ending in blank lines, tabs and no-break spaces inside":
    "```js\nif (a) {\n\treturn b;\n}\n\n\n```\nTexto\u00a0con\u00a0espacios duros y\ttabuladores\t.\n",
};

/** A journal of `days` entries, as a person's long note reaches (a year has 365), with every kind of block. */
export function longNote(days: number): string {
  const out: string[] = ["# Diario", ""];
  for (let d = 1; d <= days; d++) {
    const day = `2026-${String(((d - 1) % 12) + 1).padStart(2, "0")}-${String(((d - 1) % 28) + 1).padStart(2, "0")}`;
    out.push(`## ${day}`, "");
    out.push(
      `Hoy, el día ${d}, escribí un párrafo algo largo para que la nota pese como las de verdad: reuniones, clases, ` +
        `recados y alguna idea suelta que apuntar antes de que se olvide.`,
      "",
    );
    out.push(`- Tarea ${d}`, `  - Detalle ${d}`, `- [${d % 2 ? "x" : " "}] Pendiente ${d}`, "");
    if (d % 5 === 0) out.push(`| a | b |`, `|---|---|`, `| ${d} | ${d * 2} |`, "");
    if (d % 7 === 0)
      out.push(`![foto ${d}](boni:f_01m5ztq8w3k2v7n4b9c6x${String(d).padStart(4, "0")})`, "");
    if (d % 11 === 0) out.push("```", `codigo(${d})`, "```", "");
    if (d % 13 === 0) out.push(`> Cita del día ${d}`, "");
  }
  return out.join("\n");
}
