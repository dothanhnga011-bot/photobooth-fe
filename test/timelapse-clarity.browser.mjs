// Real Canvas pixels, before video compression: native-size crops must not blur edges.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, page;
before(async () => {
  const modules = new Map(await Promise.all(["clip-recorder.js", "live-preview-layout.js"].map(async name =>
    [`/${name}`, await readFile(new URL(`../src/kiosk/${name}`, import.meta.url), "utf8")])));
  server = createServer((req, res) => {
    const source = modules.get(req.url);
    res.writeHead(200, { "Content-Type": source ? "text/javascript" : "text/html" });
    res.end(source || "<!doctype html><title>Native video crop test</title>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

test("native HDMI pixels retain fine edge contrast without the old fractional crop blur", async () => {
  const rows = await page.evaluate(async () => {
    const { timelapseCrop, timelapseSize } = await import("/clip-recorder.js");
    const { visibleRegion } = await import("/live-preview-layout.js");
    const source = document.createElement("canvas"); source.width = 1920; source.height = 1080;
    const original = source.getContext("2d", { alpha: false });
    for (let y = 0; y < source.height; y++) {
      original.fillStyle = y % 2 ? "#e6e6e6" : "#141414";
      original.fillRect(0, y, source.width, 1);
    }
    const result = [];
    for (const zoom of [0.08, 0.23]) {
      const region = visibleRegion(zoom), [width, height] = timelapseSize(1920, 1080, region);
      const crop = timelapseCrop(1920, 1080, region, width, height);
      const reference = original.getImageData(crop.x, crop.y, width, height).data;
      const errors = {};
      for (const variant of ["old", "new"]) {
        const target = document.createElement("canvas"); target.width = width; target.height = height;
        const context = target.getContext("2d", { alpha: false });
        context.imageSmoothingQuality = "high";
        if (variant === "old") {
          // The exact drawing geometry used before the integer-pixel fix.
          const sw = source.width * region.w, sh = source.height * region.h;
          const scale = Math.max(width / sw, height / sh);
          context.drawImage(source, source.width * region.x, source.height * region.y, sw, sh,
            (width - sw * scale) / 2, (height - sh * scale) / 2, sw * scale, sh * scale);
        } else {
          context.imageSmoothingEnabled = crop.resize;
          context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
        }
        const actual = context.getImageData(0, 0, width, height).data;
        let absolute = 0;
        for (let index = 0; index < actual.length; index += 4) absolute += Math.abs(actual[index] - reference[index]);
        errors[variant] = absolute / (width * height);
      }
      result.push({ zoom, width, height, meanLumaError: errors });
    }
    return result;
  });
  for (const row of rows) {
    assert.equal(row.meanLumaError.new, 0, JSON.stringify(row));
    assert.ok(row.meanLumaError.old > 20, JSON.stringify(row));
  }
});
