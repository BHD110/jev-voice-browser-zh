import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installedChromium } from "../../src/browser.js";

const controlUrl = process.env.VOICE_BROWSER_URL;

test("Chinese speech selection sends recognized text through the live controller", { skip: !controlUrl }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: installedChromium() });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      class FakeSpeechRecognition {
        start() { window.__lastSpeech = this; }
        stop() {}
      }
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeSpeechRecognition });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeSpeechRecognition });
    });
    await page.goto(controlUrl);
    await page.waitForFunction(() => document.querySelector("#ws")?.textContent === "已连接");
    assert.equal(await page.locator("#speechlang").inputValue(), "zh-CN");
    assert.equal(await page.locator("#micbtn").isDisabled(), true);
    await page.locator("#apikey").fill("dummy-ui-test-key");
    await page.locator("#keybtn").click();
    await page.waitForFunction(() => !document.querySelector("#micbtn")?.disabled);

    await page.locator("#micbtn").click();
    assert.equal(await page.evaluate(() => window.__lastSpeech.lang), "zh-CN");
    await page.evaluate(() => window.__lastSpeech.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: "打开一个新标签页" }, isFinal: true }],
    }));
    await page.waitForFunction(() => document.querySelector("#transcript")?.textContent?.includes("打开一个新标签页"));
    assert.match(await page.locator("#transcript").textContent(), /打开一个新标签页/);

    await page.locator("#micbtn").click();
    await page.locator("#speechlang").selectOption("en-US");
    await page.locator("#micbtn").click();
    assert.equal(await page.evaluate(() => window.__lastSpeech.lang), "en-US");
    await page.locator("#micbtn").click();
  } finally {
    await browser.close();
  }
});
