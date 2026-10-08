import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, hasApiKey } from "../../src/jev.js";
import { evaluatePolicy } from "../../src/policy.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), "utf8"));

const cases = [
  { text: "打开维基百科", page: "example", intent: "navigate_url", action: "navigate_url", url: "wikipedia.org" },
  { text: "搜索北京天气", page: "example", intent: "search_web", action: "navigate_url", query: "北京天气" },
  { text: "向下滚动一页", page: "wikipedia-article", intent: "scroll_down", action: "scroll_down" },
  { text: "点击了解更多", page: "example", intent: "click_element", action: "click_element", target: "e01" },
  { text: "打开一个新标签页", page: "example", intent: "open_new_tab", action: "open_new_tab" },
  { text: "在搜索框输入你好世界", page: "wikipedia-main", intent: "type_into_field", action: "type_into_field", target: "e02", typed: "你好世界" },
  { text: "返回上一页", page: "wikipedia-article", intent: "go_back", action: "go_back" },
];

for (const c of cases) {
  test(`Chinese command: ${c.text}`, { skip: !hasApiKey() }, async () => {
    const snapshot = fixture(c.page);
    const result = await decide({ transcript: c.text, snapshot });
    const policy = evaluatePolicy({ answers: result.answers, candidates: result.candidates, snapshot, isFinal: true });
    assert.equal(result.answers.intent.choice, c.intent, `intent for ${c.text}`);
    assert.equal(policy.decision, "act", `${c.text}: ${policy.summary}`);
    assert.equal(policy.action.type, c.action);
    if (c.url) assert.ok(policy.action.url.includes(c.url), policy.action.url);
    if (c.query) assert.equal(policy.action.query, c.query);
    if (c.target) assert.equal(policy.action.targetId, c.target);
    if (c.typed) assert.equal(policy.action.text, c.typed);
  });
}
