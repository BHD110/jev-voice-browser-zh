import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserManager } from "../../src/browser.js";
import { execute } from "../../src/executor.js";

test("closing the last tab keeps the browser usable; closing Chromium recovers on the next action", async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-recovery-"));
  const browser = new BrowserManager();
  try {
    await browser.launch({ headless: true, profileDir, startUrl: "about:blank" });
    const closedTab = await execute({ type: "close_tab" }, browser);
    assert.equal(closedTab.ok, true);
    assert.equal(browser.pages.length, 1);
    assert.equal(browser.context.isClosed(), false);

    await browser.context.close(); // simulate the user closing the controlled Chromium window
    assert.equal(browser.context.isClosed(), true);
    const newTab = await execute({ type: "open_new_tab" }, browser);
    assert.equal(newTab.ok, true);
    assert.equal(browser.pages.length, 2);
    assert.equal(browser.context.isClosed(), false);

    await browser.context.close();
    const [first, second] = await Promise.all([browser.ensurePage(), browser.ensurePage()]);
    assert.equal(first, second, "concurrent requests share one recovered context");
    assert.equal(browser.context.isClosed(), false);
  } finally {
    await browser.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
