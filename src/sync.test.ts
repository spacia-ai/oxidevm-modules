import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewRequired, syncCatalog, syncSummary } from "./sync.ts";
import { entry, fakeGithub, manifestBytes, sums } from "./testing.ts";

const EMPTY = { schemaVersion: 1, modules: [] } as const;

void test("a newly registered module is listed at its latest release", async () => {
  const result = await syncCatalog([entry()], EMPTY, fakeGithub());
  assert.equal(result.catalog.modules[0]?.release.tag, "v1.2.0");
  assert.deepEqual(result.changes, [{ source: "github:acme/oxidevm-db", from: null, to: "v1.2.0", added: [] }]);
  assert.equal(reviewRequired(result), false);
});

void test("an unchanged release produces no change, and new words still apply", async () => {
  const first = await syncCatalog([entry()], EMPTY, fakeGithub());
  const second = await syncCatalog([entry({ tagline: "A better database." })], first.catalog, fakeGithub());
  assert.deepEqual(second.changes, []);
  assert.equal(second.catalog.modules[0]?.tagline, "A better database.");
  assert.match(syncSummary(second), /No module has a new release/u);
});

void test("a release that asks for more authority needs a review", async () => {
  const first = await syncCatalog([entry()], EMPTY, fakeGithub());
  const wider = manifestBytes({ version: "1.3.0", requires: { host: ["files.sync", "net.internet"] } });
  const github = fakeGithub({ repositories: [{ manifest: wider, sums: sums({ "module.json": wider }), release: { tag_name: "v1.3.0" } }] });
  const second = await syncCatalog([entry()], first.catalog, github);
  assert.deepEqual(second.changes, [{ source: "github:acme/oxidevm-db", from: "v1.2.0", to: "v1.3.0", added: ["host: net.internet"] }]);
  assert.equal(reviewRequired(second), true);
  assert.match(syncSummary(second), /\*\*`host: net.internet`\*\*/u);
});

void test("a release that fails its checks keeps the listed release and is reported", async () => {
  const first = await syncCatalog([entry()], EMPTY, fakeGithub());
  const second = await syncCatalog([entry()], first.catalog, fakeGithub({ repositories: [{ release: { tag_name: "v2.0.0", immutable: false } }] }));
  assert.equal(second.catalog.modules[0]?.release.tag, "v1.2.0");
  assert.equal(second.failures[0]?.kept, true);
  assert.equal(reviewRequired(second), true);
  const unlisted = await syncCatalog([entry()], EMPTY, fakeGithub({ repositories: [{ release: { immutable: false } }] }));
  assert.deepEqual(unlisted.catalog.modules, []);
  assert.equal(unlisted.failures[0]?.kept, false);
});

void test("two modules may not declare the same module id", async () => {
  const github = fakeGithub({ repositories: [{}, { fullName: "zed/oxidevm-db2" }] });
  const result = await syncCatalog([entry(), entry({ source: "github:zed/oxidevm-db2" })], EMPTY, github);
  assert.equal(result.catalog.modules.length, 1);
  assert.match(result.failures[0]?.reason ?? "", /already uses/u);
});
