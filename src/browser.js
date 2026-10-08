/**
 * Browser management: launch a headed Playwright Chromium with a persistent profile
 * (so it feels like "your browser"), or attach to a running Chrome via --cdp ws://...
 * Tracks tabs and exposes the active page.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { installOverlay } from "./overlay.js";
import { collectElementsInPage, buildSnapshot } from "./snapshot.js";
import { installPublicWebGuard } from "./network-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROFILE_DIR = path.join(__dirname, "..", ".browser-profile");

export function installedChromium() {
  const expected = chromium.executablePath();
  if (fs.existsSync(expected)) return undefined; // let Playwright use its matching version
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(cache)) return undefined;
  const versions = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const version of versions) {
    const executable = path.join(cache, version, "chrome-win64", "chrome.exe");
    if (fs.existsSync(executable)) return executable;
  }
  return undefined;
}

export class BrowserManager {
  constructor() {
    this.context = null;
    this.browser = null;
    this.active = null;
    this.pages = [];
    this.listeners = new Set();
    this.launchOptions = null;
    this.relaunchPromise = null;
    this.closing = false;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  async launch({ headless = false, cdp = null, profileDir = DEFAULT_PROFILE_DIR, startUrl = "about:blank", ephemeral = false } = {}) {
    this.launchOptions = { headless, cdp, profileDir, startUrl, ephemeral };
    this.closing = false;
    this.pages = [];
    this.active = null;
    if (cdp) {
      this.browser = await chromium.connectOverCDP(cdp);
      this.context = this.browser.contexts()[0] || (await this.browser.newContext());
    } else if (ephemeral) {
      this.browser = await chromium.launch({
        headless,
        executablePath: process.env.VOICE_BROWSER_CHROMIUM_PATH || installedChromium(),
        args: headless ? [] : ["--window-size=1280,900"],
      });
      this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    } else {
      this.context = await chromium.launchPersistentContext(profileDir, {
        headless,
        executablePath: process.env.VOICE_BROWSER_CHROMIUM_PATH || installedChromium(),
        viewport: headless ? { width: 1280, height: 900 } : null,
        args: headless ? [] : ["--window-size=1280,900", "--window-position=40,40"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    }
    const context = this.context;
    if (ephemeral) await installPublicWebGuard(context);
    await context.addInitScript(installOverlay);

    context.on("page", (page) => this._track(page));
    context.on("close", () => {
      if (this.context !== context) return;
      this.active = null;
      this.pages = [];
      this._emit();
    });
    for (const p of context.pages()) this._track(p);
    if (this.pages.length === 0) await context.newPage();
    this.active = this.pages[this.pages.length - 1];
    if (startUrl && startUrl !== "about:blank") {
      await this.active.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    this._emit();
    return this;
  }

  _track(page) {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    this.active = page;
    page.on("close", () => {
      this.pages = this.pages.filter((p) => p !== page);
      if (this.active === page) this.active = this.pages[this.pages.length - 1] || null;
      this._emit();
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this._emit();
    });
    this._emit();
  }

  get page() {
    if (!this.active || this.active.isClosed()) this.active = this.pages.find((p) => !p.isClosed()) || null;
    return this.active;
  }

  async ensurePage() {
    if (this.closing) throw new Error("Controlled browser is shutting down");
    if (this.relaunchPromise) await this.relaunchPromise;
    if (!this.context || this.context.isClosed()) await this.relaunch();
    if (!this.page) {
      try {
        await this.context.newPage();
      } catch (err) {
        if (!this.context.isClosed()) throw err;
        await this.relaunch();
      }
    }
    return this.page;
  }

  async relaunch() {
    if (this.closing) throw new Error("Controlled browser is shutting down");
    if (!this.launchOptions) throw new Error("Controlled browser has not been started");
    if (!this.relaunchPromise) {
      this.relaunchPromise = this.launch(this.launchOptions).finally(() => {
        this.relaunchPromise = null;
      });
    }
    await this.relaunchPromise;
  }

  async setActive(page) {
    this.active = page;
    await page.bringToFront().catch(() => {});
    this._emit();
  }

  tabInfo() {
    return this.pages.map((p, i) => ({ index: i, url: p.url(), active: p === this.active }));
  }

  /** URL of the active page, or null (sync; used to record what an action led to). */
  currentUrl() {
    try {
      return this.active && !this.active.isClosed() ? this.active.url() : null;
    } catch {
      return null;
    }
  }

  /** Snapshot the active page (URL, title, compact element list, search box, site). */
  async snapshot() {
    const page = await this.ensurePage();
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
      const data = await page.evaluate(collectElementsInPage);
      return buildSnapshot(data, { tabs: this.tabInfo() });
    } catch (err) {
      // e.g. navigation in progress; return a minimal snapshot
      return buildSnapshot({ url: page.url(), title: "", scrollY: 0, scrollHeight: 0, viewportHeight: 0, elements: [] }, { tabs: this.tabInfo(), error: String(err.message || err) });
    }
  }

  /** Remote viewers receive pixels from their own isolated browser only. */
  async screenshot() {
    const page = await this.ensurePage();
    return page.screenshot({ type: "jpeg", quality: 58, timeout: 3000 });
  }

  /** Call window.__vb.<fn>(...args) in the active page, swallowing errors. */
  async overlay(fn, ...args) {
    const page = this.page;
    if (!page) return;
    await page.evaluate(installOverlay).catch(() => {}); // no-op if already installed by the init script
    await page
      .evaluate(
        ([fn, args]) => {
          if (!window.__vb) return false;
          return window.__vb[fn](...args);
        },
        [fn, args],
      )
      .catch(() => {});
  }

  async close() {
    this.closing = true;
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
