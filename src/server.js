/** Control page and isolated browser sessions. Each visitor supplies their own key. */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { BrowserManager } from "./browser.js";
import { Controller } from "./controller.js";
import { createDecider } from "./jev.js";
import { MODEL, QUESTIONS, T } from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_SESSIONS = Math.max(1, Math.min(3, Number(process.env.VOICE_BROWSER_MAX_SESSIONS) || 3));
const IDLE_MS = 30 * 60 * 1000;

export function parseArgs(argv) {
  const out = {
    port: Number(process.env.PORT) || 8787,
    host: process.env.HOST || "127.0.0.1",
    headless: false,
    cdp: null,
    startUrl: "https://example.com/",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--headless") out.headless = true;
    else if (a === "--cdp") out.cdp = argv[++i];
    else if (a === "--start-url") out.startUrl = argv[++i];
  }
  return out;
}

export async function startServer(opts = {}) {
  const app = express();
  app.disable("x-powered-by");
  let activeSessions = 0;
  app.get("/api/state", (_req, res) => res.json({ service: "ready", keyRequired: true, activeSessions }));
  app.get("/api/questions", (_req, res) => res.json({ model: MODEL, thresholds: T, questions: QUESTIONS }));
  app.use(express.static(path.join(__dirname, "public")));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8192 });
  const disposers = new Set();

  wss.on("connection", (ws, request) => {
    const origin = request.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== request.headers.host) {
          ws.close(1008, "Origin rejected");
          return;
        }
      } catch {
        ws.close(1008, "Origin rejected");
        return;
      }
    }

    let session = null;
    let starting = false;
    let reserved = false;
    let closed = false;
    let frameBusy = false;
    let frameTimer = null;
    let lastActive = Date.now();
    const send = (type, payload) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
    };
    const sendFrame = async () => {
      if (closed || frameBusy || !session || ws.bufferedAmount > 1_000_000) return;
      frameBusy = true;
      try {
        const bytes = await session.browser.screenshot();
        send("frame", `data:image/jpeg;base64,${bytes.toString("base64")}`);
      } catch {
        // Navigation may briefly invalidate a frame; the next frame retries.
      } finally {
        frameBusy = false;
      }
    };
    const dispose = async () => {
      if (closed) return;
      closed = true;
      clearInterval(frameTimer);
      disposers.delete(dispose);
      await session?.controller.close().catch(() => {});
      await session?.browser.close().catch(() => {});
      if (reserved) activeSessions--;
    };
    disposers.add(dispose);
    send("key_status", { ready: false });

    ws.on("message", async (raw) => {
      lastActive = Date.now();
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "set_key") {
        if (session || starting || closed) return;
        let key = typeof msg.key === "string" ? msg.key.trim() : "";
        if (!key || key.length > 512) {
          send("key_status", { ready: false, error: "请输入有效的 Jev API Key" });
          return;
        }
        if (activeSessions >= (opts.cdp ? 1 : MAX_SESSIONS)) {
          send("key_status", { ready: false, error: "当前使用人数已满，请稍后再试" });
          return;
        }
        starting = true;
        reserved = true;
        activeSessions++;
        const browser = new BrowserManager();
        try {
          const decideFn = createDecider(key);
          key = "";
          await browser.launch({ headless: opts.headless, cdp: opts.cdp, startUrl: opts.startUrl, ephemeral: !opts.cdp });
          if (closed) { await browser.close(); return; }
          const controller = new Controller({ browser, decideFn });
          session = { browser, controller };
          controller.on("transcript", (p) => send("transcript", p));
          controller.on("decision", (p) => send("decision", p));
          controller.on("action", (p) => { send("action", { ...p, ui: controller.uiState() }); void sendFrame(); });
          controller.on("snapshot", (p) => { send("snapshot", p); void sendFrame(); });
          controller.on("log", (p) => send("log", p));
          controller.on("error", (err) => send("log", { t: Date.now(), level: "error", msg: String(err?.message || err).replaceAll(String(msg.key), "[redacted]") }));
          controller.on("candidates", (p) => send("candidates", p));
          controller.on("pending", (p) => send("pending", p));
          controller.on("tabs", (p) => { send("tabs", p); void sendFrame(); });
          await controller.start();
          if (closed) { await controller.close(); await browser.close(); return; }
          send("hello", controller.uiState());
          send("key_status", { ready: true });
          void sendFrame();
          frameTimer = setInterval(() => {
            if (Date.now() - lastActive > IDLE_MS) ws.close(1000, "Session idle");
            else void sendFrame();
          }, 1500);
        } catch (err) {
          await browser.close().catch(() => {});
          session = null;
          if (reserved) { activeSessions--; reserved = false; }
          const message = String(err?.message || err).replaceAll(String(msg.key), "[redacted]");
          send("key_status", { ready: false, error: `无法启动浏览器：${message}` });
        } finally {
          starting = false;
        }
        return;
      }
      if (!session || closed) return;
      const controller = session.controller;
      switch (msg.type) {
        case "transcript":
          controller.handleTranscript({ text: msg.text, final: Boolean(msg.final), utteranceId: msg.utteranceId });
          break;
        case "command":
          controller.handleCommand(msg.text);
          break;
        case "undo":
          controller.undo();
          break;
        case "snapshot":
          controller.refreshSnapshot();
          break;
        case "state":
          send("hello", controller.uiState());
          void sendFrame();
          break;
        default:
          break;
      }
    });
    ws.on("close", () => { void dispose(); });
    ws.on("error", () => { void dispose(); });
  });

  const host = opts.host || "127.0.0.1";
  await new Promise((resolve) => server.listen(opts.port, host, resolve));
  const url = `http://${host}:${server.address().port}`;
  console.log(`Jev 中文语音浏览器已启动：${url}`);
  const shutdown = async () => {
    for (const client of wss.clients) client.close();
    await Promise.allSettled([...disposers].map((dispose) => dispose()));
    await new Promise((resolve) => server.close(resolve));
  };
  return { app, server, wss, url, shutdown };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await startServer(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  process.on("SIGINT", () => void running.shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void running.shutdown().then(() => process.exit(0)));
}
