import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer } from "../../src/server.js";

test("visitor supplies a key before an isolated browser starts and receives frames", async () => {
  const server = await startServer({ port: 0, host: "127.0.0.1", headless: true, startUrl: "https://example.com/" });
  const ws = new WebSocket(server.url.replace("http", "ws") + "/ws");
  const events = [];
  ws.on("message", (bytes) => events.push(JSON.parse(bytes.toString())));
  try {
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const state = await fetch(server.url + "/api/state").then((res) => res.json());
    assert.equal(state.keyRequired, true);
    assert.equal(state.activeSessions, 0);
    assert.equal(JSON.stringify(state).includes("dummy-test-key"), false);
    ws.send(JSON.stringify({ type: "set_key", key: "dummy-test-key" }));
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Browser session did not start")), 20000);
      const poll = setInterval(() => {
        if (events.some((e) => e.type === "key_status" && e.payload.ready) && events.some((e) => e.type === "frame")) {
          clearTimeout(deadline); clearInterval(poll); resolve();
        }
      }, 100);
    });
    assert.equal(events.some((e) => JSON.stringify(e).includes("dummy-test-key")), false);
    assert.match(events.find((e) => e.type === "frame").payload, /^data:image\/jpeg;base64,/);
  } finally {
    ws.terminate();
    await server.shutdown();
  }
});
