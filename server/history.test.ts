import assert from "node:assert/strict";
import test from "node:test";
import type { AssayResult, Finding, Item } from "../shared/types.js";
import { cleanShare, diff, isEmpty } from "./history.js";

const item = (id: string, version: string, parts = 4): Item => ({
  id, layer: "apps", kind: "app", name: id, version, evidence: "", meta: {},
  parts: Array.from({ length: parts }, (_, k) => ({ ecosystem: "npm" as const, name: `lib${k}`, version: "1.0.0" })),
});
const vuln = (itemId: string, adv: string, lib = "lib0"): Finding => ({
  id: `${itemId}:${adv}`, itemId, kind: "vulnerability", severity: "high", title: "", detail: "", evidence: "",
  part: { ecosystem: "npm", name: lib, version: "1.0.0" }, advisory: { id: adv, aliases: [], url: "" },
});
const result = (id: number, items: Item[], findings: Finding[]): AssayResult => ({
  id, startedAt: 0, finishedAt: id, host: "t", items, findings, layers: [], vulnCheck: { ran: true, queried: 0 },
});

test("an update that fixes advisories, a new app, a removed one, and a new advisory", () => {
  const prev = result(1, [item("Slack", "1.0"), item("Old", "2.0"), item("Zoom", "5.0")], [vuln("Slack", "GHSA-a"), vuln("Slack", "GHSA-b"), vuln("Zoom", "GHSA-z")]);
  const next = result(2, [item("Slack", "1.1"), item("Zoom", "5.0"), item("New", "0.1")], [vuln("Zoom", "GHSA-z"), vuln("Zoom", "GHSA-y", "lib1")]);
  const c = diff(prev, next);
  assert.deepEqual(c.updated.map((u) => [u.name, u.fromVersion, u.version, u.fixed, u.introduced]), [["Slack", "1.0", "1.1", ["GHSA-a", "GHSA-b"], []]]);
  assert.deepEqual(c.added.map((a) => a.name), ["New"]);
  assert.deepEqual(c.removed.map((a) => a.name), ["Old"]);
  assert.deepEqual(c.newlyPublished.map((n) => [n.name, n.introduced]), [["Zoom", ["GHSA-y"]]]);
  assert.equal(c.cleanBefore, cleanShare(prev));
  assert.ok(c.cleanAfter > 0);
});

test("two identical assays have no changes", () => {
  const r = result(1, [item("Slack", "1.0")], [vuln("Slack", "GHSA-a")]);
  assert.ok(isEmpty(diff(r, { ...r, id: 2 })));
});
