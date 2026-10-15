import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:4173/?now=2025-09-17T14:29&tz=Europe/Madrid");
await page.waitForSelector(".ev");
await page.waitForTimeout(900);
const info = await page.evaluate(() => ({
  strip: getComputedStyle(document.querySelector(".cols-strip")).transform,
  colw: getComputedStyle(document.querySelector(".grid")).getPropertyValue("--colw"),
  armed: document.querySelector(".grid").classList.contains("zoom-armed"),
  label: document.querySelector(".hour-label").getBoundingClientRect().top,
}));
console.log(JSON.stringify(info));
await page.screenshot({ path: "/tmp/claude-1000/crisp-fixed.png" });
await page.keyboard.press("m");
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/claude-1000/crisp-fixed-month.png" });
await browser.close();
