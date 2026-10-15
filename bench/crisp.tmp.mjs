import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const variants = {
  base: async () => {},
  roundX: async (page) =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll(".cols-strip,.head-strip,.strip")) {
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
        if (m)
          el.style.transform = `translate3d(${Math.round(+m[1])}px, ${Math.round(+m[2])}px, 0)`;
      }
    }),
  roundX_noLayersText: async (page) => {
    await variants.roundX(page);
    await page.addStyleTag({
      content:
        ".ev-body,.hour-label,.now-label{will-change:auto!important;transform:none!important}",
    });
  },
  roundX_intCol: async (page) => {
    await variants.roundX(page);
    await page.evaluate(() => {
      document.querySelector(".grid").style.setProperty("--colw", "183px");
    });
  },
  allOff: async (page) => {
    await variants.roundX(page);
    await page.addStyleTag({
      content:
        ".ev-body,.hour-label,.now-label,.strip,.gutter-inner,.lines{will-change:auto!important}.ev-body,.hour-label,.now-label{transform:none!important}",
    });
  },
};
const res = {};
for (const [name, fn] of Object.entries(variants)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto("http://localhost:4173/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await page.waitForSelector(".ev");
  await page.waitForTimeout(900);
  await fn(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/claude-1000/crisp-${name}.png` });
  await page.close();
}
await browser.close();
