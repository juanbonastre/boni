import { expect, test } from "@playwright/test";
import {
  AUDIT_ACTIONS_WORST,
  AUDIT_DETAIL_WORST,
  AUDIT_SUMMARY_WORST,
  EXTENSIONS,
  GUIDE,
  MAIL,
  MAIL_SUGGESTED,
  MODELS_CATALOGUE_WORST,
  MODELS_WORST,
  PROPOSALS,
  VISIBILITY,
} from "./agent-scenarios.ts";
import { activityAudit, audit, MODELS_TEXT, modelsAudit, settingsAudit } from "./audit.ts";
import { openApp } from "./fixtures.ts";

/**
 * The worst realistic data (docs/design-guide.md, "Calidad"): long hyphenated names with accents, addresses
 * of sixty characters with nothing to break on, one-word and one-letter values, counts of 1 and of
 * thousands, empty lists. Not nonsense: what a real account can hold. Entered where data enters (the fake
 * server), never by editing the page. Every Settings section with its groups open, and the inbox.
 */
const LONG_ADDRESS = "aleksandra.wisniewska-kowalczyk@departamento-de-informatica.example.com";
const LONG_DOMAIN = "@boletines-de-la-facultad-de-ciencias-sociales.example.com";

const VISIBILITY_WORST = {
  types: [
    { id: "t_a", name: "Á", level: "visible", count: 1 },
    {
      id: "t_b",
      name: "Proyectos de investigación del grupo de inteligencia artificial aplicada",
      level: "opaque",
      count: 1284,
    },
    { id: "t_c", name: "Diario", level: "private", count: 0 },
    ...VISIBILITY.types,
  ],
};
const MAIL_WORST = {
  mail: {
    ...MAIL_SUGGESTED.mail,
    user: LONG_ADDRESS,
    host: "imap.servidor-de-correo-de-la-universidad.example.com",
    folder: "INBOX/Docencia/Trabajos de fin de grado/2026-2027",
    collections: ["t_a", "t_b"],
    state: {
      ...MAIL_SUGGESTED.mail.state,
      count: 1,
      suggestion: {
        ...MAIL_SUGGESTED.mail.state.suggestion,
        rules: [{ id: "s1", from: LONG_DOMAIN, action: "skip" }],
        examples: [
          {
            id: "x1",
            subject:
              "RE: RE: RV: Convocatoria extraordinaria de evaluación — cambios de aula y horario (urgente)",
            from: LONG_ADDRESS,
            mail: "…",
            want: [
              {
                title:
                  "Comunicar a Aleksandra Wiśniewska-Kowalczyk el cambio de aula del examen de recuperación",
              },
            ],
          },
        ],
      },
    },
  },
};
const GUIDE_WORST = {
  guide: {
    instructions:
      "Los avisos automáticos de la plataforma de cursos solo me interesan si un alumno pregunta algo concreto sobre una entrega o una nota; el resto, nunca. ".repeat(
        4,
      ),
    rules: [
      { id: "r1", from: LONG_DOMAIN, action: "skip" },
      { id: "r2", from: LONG_ADDRESS, action: "collection", collection: "t_b" },
      { id: "r3", from: "@x.example", action: "skip" },
    ],
    examples: [
      {
        id: "x1",
        subject: "a",
        from: "a@x.example",
        want: [],
      },
    ],
  },
};
const EXTENSIONS_WORST = {
  extensions: [
    ...EXTENSIONS.extensions,
    {
      id: "plazos-documentos-del-departamento",
      name: "Plazos de entrega de los documentos del departamento y de la comisión",
      description: "",
      version: 12,
      preset: null,
      enabled: true,
      needs: {
        reads: ["Proyectos de investigación del grupo de inteligencia artificial aplicada"],
        proposes: false,
        budget: { readersPerDay: 1 },
      },
      sources: [],
      modules: ["fechas_de_entrega_de_actas"],
    },
  ],
};
const longTitle = (id: string, title: string) => ({
  ...PROPOSALS.proposals[0],
  id,
  view: {
    ...PROPOSALS.proposals[0]?.view,
    rows: [
      {
        arg: "type",
        role: "type",
        value: "proyectos",
        detail: "Proyectos de investigación del grupo de inteligencia artificial aplicada",
        integrity: "model",
        sources: ["model"],
        marks: [],
      },
      {
        arg: "values.title",
        role: "content",
        name: "Título",
        value: title,
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
      {
        arg: "values.date",
        role: "content",
        name: "Fecha",
        value: "2026-11-30",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
    ],
  },
  sources: [`mail:${LONG_ADDRESS}`],
});
const PROPOSALS_WORST = {
  proposals: [
    longTitle(
      "w1",
      "Enviar a Aleksandra Wiśniewska-Kowalczyk la rúbrica corregida del trabajo de fin de grado sobre «Modelos de predicción de series temporales con redes neuronales recurrentes»",
    ),
    longTitle("w2", "Ir"),
  ],
};

const v = (value: unknown, integrity: string) => ({
  t: "v",
  value,
  integrity,
  sensitivity: "public",
});
/** Questions with long accented words, long options and a long sender (the panel of requests). */
const REQUESTS_WORST = {
  requests: [
    {
      id: "wq1",
      run: "run-wq1",
      view: {
        kind: "ask",
        id: "wq1",
        control: "choice",
        prompt: v(
          "¿A qué colección va «Convocatoria extraordinaria de evaluación de la asignatura Interacción Persona-Ordenador»?",
          "model",
        ),
        options: [
          v("Docencia — Organización y planificación académica del curso", "user"),
          v("Gestiones administrativas y trámites de la universidad", "user"),
          v("Ir", "user"),
        ],
      },
      created: 0,
      expires: Date.now() + 6 * 24 * 60 * 60_000,
      about: {
        kind: "mail",
        subject:
          "Convocatoria extraordinaria: calendario de evaluación, rúbricas y criterios de corrección",
        from: "Vicerrectorado de Ordenación Académica y Profesorado de Ejemplo",
        account: LONG_ADDRESS,
      },
      open: { type: "t_correo", id: "e_correo1" },
    },
    {
      id: "wq2",
      run: "run-wq2",
      view: {
        kind: "ask",
        id: "wq2",
        control: "text",
        prompt: v(
          "¿Qué compraste en «Electrodomésticos Hernández-Martínez e Hijos, Sociedad Limitada» el día 12 (1.234,56 €)?",
          "model",
        ),
        options: [],
      },
      created: 0,
      expires: Date.now() + 60_000,
      about: null,
      open: null,
    },
  ],
};

for (const width of [1440, 900]) {
  test(`the worst realistic data fits (Settings and inbox, ${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await openApp(page, "/?still", {
      agent: {
        "GET api/agent/visibility": [VISIBILITY_WORST],
        "GET api/mail": [MAIL_WORST],
        "GET api/mail/guide": [GUIDE_WORST],
        "GET api/agent/extensions": [EXTENSIONS_WORST],
        "GET api/agent/proposals": [PROPOSALS_WORST],
        "GET api/agent/requests": [REQUESTS_WORST],
      },
    });
    const issues: string[] = [];
    await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
    await page.locator(".modal").waitFor();
    issues.push(...(await settingsAudit(page)));
    // Counts of 1 read as 1, never "1 elementos" or "1 correos".
    await page.locator(".modal [role=tab]", { hasText: "Lo que ve la IA" }).click();
    await expect(page.locator(".modal")).toContainText("1 elemento");
    expect(await page.locator(".modal").textContent()).not.toMatch(/(^|[^0-9.])1 elementos/);
    await page.locator(".modal [role=tab]", { hasText: "Correo" }).click();
    await expect(page.locator(".modal")).toContainText("· 1 correo");
    await page.screenshot({ path: `e2e-boni/screenshots/worst-settings-${width}.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Conversación" }).click();
    await page
      .locator(".chat-tools")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    await page.locator(".proposal").first().waitFor();
    issues.push(...(await audit(page, `${width} inbox`)));
    await page.screenshot({ path: `e2e-boni/screenshots/worst-inbox-${width}.png` });
    expect(issues).toEqual([]);
  });
}

for (const width of [1440, 900]) {
  test(`the worst realistic data fits («Modelos», «Actividad», «Auditoría», ${width} px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 860 });
    await openApp(page, "/?still", {
      agent: {
        "GET api/agent/models": [MODELS_WORST],
        "GET api/agent/models/catalogue": [MODELS_CATALOGUE_WORST],
        "GET api/data/audit/summary": [AUDIT_SUMMARY_WORST],
        "GET api/data/audit/actions": [AUDIT_ACTIONS_WORST],
        "GET api/data/audit/actions/:seq": [AUDIT_DETAIL_WORST],
      },
    });
    const issues = await modelsAudit(page, MODELS_TEXT.es, `${width}`);
    await page.screenshot({ path: `e2e-boni/screenshots/worst-models-${width}.png` });
    issues.push(...(await activityAudit(page, MODELS_TEXT.es, `${width}`)));
    await page.screenshot({ path: `e2e-boni/screenshots/worst-audit-${width}.png` });
    expect(issues).toEqual([]);
  });
}
