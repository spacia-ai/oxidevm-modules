import assert from "node:assert/strict";
import { test } from "node:test";

import { addedAuthority, checkRelease, checkRepository, moduleReach, pinnedDigest } from "./release.ts";
import { COMMIT, fakeGithub, manifestBytes, sha256, sums } from "./testing.ts";

const SOURCE = "github:acme/oxidevm-db";

void test("lists an immutable release with the facts and authority its manifest declares", async () => {
  const github = fakeGithub();
  const facts = await checkRelease(SOURCE, github, await checkRepository(SOURCE, github));
  assert.equal(facts.release.tag, "v1.2.0");
  assert.equal(facts.release.commit, COMMIT);
  assert.equal(facts.release.id, sha256(sums({ "adapter.mjs": new Uint8Array(10), "module.json": manifestBytes() })));
  assert.deepEqual(facts.manifest.endpoints, [{ name: "pg", kind: "tcp", port: 5432 }]);
  assert.equal(facts.manifest.reach, "none");
  assert.deepEqual(facts.authority, { host: ["files.sync"], endpoints: ["tcp:5432"], executables: [], commands: [] });
});

void test("the repository must be public, active, described, licensed and carry the topic", async () => {
  const check = (repository: Readonly<Record<string, unknown>>): Promise<unknown> => checkRepository(SOURCE, fakeGithub({ repositories: [{ repository }] }));
  await assert.rejects(check({ private: true }), /is not public/u);
  await assert.rejects(check({ archived: true }), /is archived/u);
  await assert.rejects(check({ description: null }), /has no description/u);
  await assert.rejects(check({ license: null }), /has no license/u);
  await assert.rejects(check({ topics: [] }), /lacks the oxidevm-module topic/u);
  await assert.rejects(checkRepository("github:acme/missing", fakeGithub()), /does not exist or is not public/u);
});

void test("refuses a mutable release, a prerelease, unpinned manifests and copyleft without source", async () => {
  const run = async (fake: Parameters<typeof fakeGithub>[0]): Promise<unknown> => {
    const github = fakeGithub(fake);
    return checkRelease(SOURCE, github, await checkRepository(SOURCE, github));
  };
  await assert.rejects(run({ repositories: [{ release: { immutable: false } }] }), /not an immutable release/u);
  await assert.rejects(run({ repositories: [{ release: { prerelease: true } }] }), /draft or a prerelease/u);
  await assert.rejects(run({ repositories: [{ sums: sums({ "module.json": new TextEncoder().encode("{}") }) }] }), /does not pin/u);
  const gpl = manifestBytes({ license: { spdx: "GPL-3.0-only" } });
  await assert.rejects(run({ repositories: [{ manifest: gpl, sums: sums({ "module.json": gpl }) }] }), /copyleft and names no license.source/u);
  const broken = new TextEncoder().encode('{"id":"x"}');
  await assert.rejects(run({ repositories: [{ manifest: broken, sums: sums({ "module.json": broken }) }] }), /OxideVM SDK refuses/u);
});

void test("authority grows only by what a release adds", () => {
  const before = { host: ["files.sync"], endpoints: ["tcp:5432"], executables: [], commands: [] };
  assert.deepEqual(addedAuthority(before, before), []);
  assert.deepEqual(addedAuthority(before, { host: ["files.sync"], endpoints: [], executables: [], commands: [] }), []);
  assert.deepEqual(addedAuthority(before, { host: ["files.sync", "net.internet"], endpoints: ["tcp:5432"], executables: ["/usr/bin/git"], commands: ["db"] }), ["host: net.internet", "executables: /usr/bin/git", "commands: db"]);
});

void test("reads network reach the way the SDK does, and finds pinned digests", () => {
  assert.equal(moduleReach(["files.sync"]), "none");
  assert.equal(moduleReach(["sockets.connect"]), "vm");
  assert.equal(moduleReach(["net.vm"]), "vm");
  assert.equal(moduleReach(["net.internet", "net.vm"]), "internet");
  assert.equal(pinnedDigest(sums({ "module.json": new Uint8Array([1]) }), "module.json"), sha256(new Uint8Array([1])));
  assert.throws(() => pinnedDigest(sums({ "module.json": new Uint8Array([1]) }), "adapter.mjs"), /does not pin adapter.mjs/u);
});
