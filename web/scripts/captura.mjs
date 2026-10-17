import puppeteer from "puppeteer-core";

const BIN =
  process.env.CHROME_BIN ??
  "/home/nando/.cache/browser/chrome-headless-shell-linux64/chrome-headless-shell";
const BASE = process.argv[2] ?? "http://localhost:3000";
const PAUSA = 1600;

const browser = await puppeteer.launch({
  executablePath: BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

async function shot(path, url, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, PAUSA));
  await page.screenshot({ path, fullPage: true });
  await page.close();
  console.log(`ok ${path}`);
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };

await shot(".impeccable/review/desktop.png", `${BASE}/`, DESKTOP);
await shot(".impeccable/review/mobile.png", `${BASE}/`, MOBILE);
await shot("/tmp/opencode/shots/catalogo-desktop.png", `${BASE}/catalogo`, DESKTOP);
await shot(
  "/tmp/opencode/shots/producto-desktop.png",
  `${BASE}/producto/vestido-abril`,
  DESKTOP
);
await shot("/tmp/opencode/shots/producto-mobile.png", `${BASE}/producto/vestido-abril`, MOBILE);
await shot("/tmp/opencode/shots/catalogo-mobile.png", `${BASE}/catalogo`, MOBILE);

{
  const page = await browser.newPage();
  await page.setViewport(DESKTOP);
  await page.goto(`${BASE}/panel`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() =>
    fetch("/api/panel/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "angibell360" }),
    })
  );
  await page.reload({ waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, PAUSA));
  await page.screenshot({ path: "/tmp/opencode/shots/panel-desktop.png", fullPage: true });
  console.log("ok panel");
  await page.close();
}

await browser.close();
console.log("capturas listas");
