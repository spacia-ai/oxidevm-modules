import assert from "node:assert/strict";
import { test } from "node:test";

import { syncCatalog } from "./sync.ts";
import { entry, fakeGithub } from "./testing.ts";
import { discoverCandidates, validateSubmission, type Submission } from "./validate.ts";

const EMPTY = { schemaVersion: 1, modules: [] } as const;

function submission(overrides: Partial<Submission> = {}): Submission {
  return { base: [], head: { modules: [entry()] }, changedFiles: ["modules.json"], author: "acme", maintainer: false, catalog: EMPTY, ...overrides };
}

void test("the repository owner can add a module that passes the checks", async () => {
  const result = await validateSubmission(submission(), fakeGithub());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.checked, ["github:acme/oxidevm-db@v1.2.0 (service, network: none)"]);
});

void test("a public member of the owning organization can add it; anyone else cannot", async () => {
  const github = fakeGithub({ repositories: [{ ownerType: "Organization" }], publicMembers: ["alice"] });
  assert.deepEqual((await validateSubmission(submission({ author: "alice" }), github)).errors, []);
  const errors = (await validateSubmission(submission({ author: "mallory" }), github)).errors;
  assert.match(errors.join("\n"), /@mallory is not its owner or a public member of acme/u);
});

void test("a submission changes only modules.json and removes nothing", async () => {
  const other = await validateSubmission(submission({ changedFiles: ["modules.json", "src/cli.ts"] }), fakeGithub());
  assert.match(other.errors.join("\n"), /changes only modules.json/u);
  const removal = await validateSubmission(submission({ base: [entry()], head: { modules: [] } }), fakeGithub());
  assert.match(removal.errors.join("\n"), /Only maintainers remove modules/u);
  const maintainer = await validateSubmission(submission({ base: [entry()], head: { modules: [] }, maintainer: true, changedFiles: ["modules.json", "README.md"] }), fakeGithub());
  assert.deepEqual(maintainer.errors, []);
});

void test("the tier rule, a malformed file, an empty change and an id clash are refused", async () => {
  const official = await validateSubmission(submission({ head: { modules: [entry({ tier: "official" })] } }), fakeGithub());
  assert.match(official.errors.join("\n"), /must be community/u);
  const malformed = await validateSubmission(submission({ head: { modules: [{ source: "x" }] } }), fakeGithub());
  assert.match(malformed.errors.join("\n"), /^modules.json:/u);
  const unchanged = await validateSubmission(submission({ base: [entry()], head: { modules: [entry()] } }), fakeGithub());
  assert.match(unchanged.errors.join("\n"), /no added or changed entry/u);
  const github = fakeGithub({ repositories: [{}, { fullName: "zed/oxidevm-db2" }] });
  const listed = await syncCatalog([entry()], EMPTY, github);
  const clash = await validateSubmission(submission({ base: [entry()], head: { modules: [entry(), entry({ source: "github:zed/oxidevm-db2" })] }, author: "zed", catalog: listed.catalog }), github);
  assert.match(clash.errors.join("\n"), /already uses/u);
});

void test("discovery lists topic repositories that modules.json does not", async () => {
  const github = { ...fakeGithub(), json: () => Promise.resolve({ items: [{ full_name: "acme/oxidevm-db" }, { full_name: "zed/oxidevm-tool" }] }) };
  assert.deepEqual(await discoverCandidates([entry()], github), ["github:zed/oxidevm-tool"]);
});
