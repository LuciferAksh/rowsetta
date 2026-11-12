import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const profile = await mkdtemp(join(tmpdir(), "rowsetta-browser-cold-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
});
try {
  const page = context.pages()[0];
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 50_000_000 / 8,
    uploadThroughput: 10_000_000 / 8,
  });
  const results = [];
  for (const visit of ["cold", "warm"]) {
    let bytes = 0;
    const responses = [];
    const count = (response) =>
      responses.push(
        response.finished().then(async () => {
          const sizes = await response.request().sizes();
          // Cached responses can report a negative size; they transfer no body.
          bytes += Math.max(0, sizes.responseBodySize);
        }),
      );
    context.on("response", count);
    const start = performance.now();
    await page.goto(process.argv[2]);
    const cells = page.getByRole("table").locator("tbody").getByRole("button");
    await expect(cells.first()).toHaveText("Unlabelled", { timeout: 180_000 });
    const tableSeconds = (performance.now() - start) / 1000;
    let currentPage = 0;
    for (const [row, key] of [
      [0, "1"],
      [1, "1"],
      [152, "3"],
      [153, "3"],
      [276, "2"],
      [277, "2"],
    ]) {
      const targetPage = Math.floor(row / 100);
      while (currentPage < targetPage) {
        await page.getByRole("button", { name: "Next page" }).click();
        currentPage++;
        await expect(page.getByRole("rowheader").first()).toHaveText(
          String(currentPage * 100),
        );
      }
      const cell = cells.nth(row % 100);
      await cell.focus();
      await page.keyboard.press(key);
      await expect(cell).toHaveText(/Labelled/);
    }
    await expect(page.getByRole("status")).toHaveText("Proposals updated", {
      timeout: 180_000,
    });
    const firstProposalsSeconds = (performance.now() - start) / 1000;
    // Include lazy first-visit assets before starting the warm visit's byte count.
    await page.waitForLoadState("networkidle");
    await Promise.all(responses);
    context.off("response", count);
    results.push({
      visit,
      table_seconds: tableSeconds,
      first_proposals_seconds: firstProposalsSeconds,
      bytes,
    });
  }
  await writeFile(process.argv[3], JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await context.close();
  await rm(profile, { recursive: true });
}
