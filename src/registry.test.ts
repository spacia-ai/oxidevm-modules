import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { decodeCatalog, decodeRegistry, tierProblem } from "./registry.ts";
import { entry } from "./testing.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")) as unknown;

void test("the committed modules.json and catalog.json decode, and the catalog lists only registered modules", () => {
  const registry = decodeRegistry(read("modules.json"));
  const catalog = decodeCatalog(read("catalog.json"));
  for (const module of catalog.modules) assert.ok(registry.some((item) => item.source === module.source), module.source);
  for (const item of registry) assert.equal(tierProblem(item), null, item.source);
});

void test("modules.json refuses unknown fields, bad sources, unknown icons and duplicates", () => {
  assert.throws(() => decodeRegistry({ modules: [{ ...entry(), extra: 1 }] }), /unknown field extra/u);
  assert.throws(() => decodeRegistry({ modules: [{ ...entry(), source: "https://github.com/acme/db" }] }), /github:<owner>\/<repo>/u);
  assert.throws(() => decodeRegistry({ modules: [{ ...entry(), icon: "rocket" }] }), /icon must be one of/u);
  assert.throws(() => decodeRegistry({ modules: [entry(), entry({ source: "github:ACME/oxidevm-db" })] }), /twice/u);
});

void test("official means published by spacia-ai, and only official modules are featured", () => {
  assert.equal(tierProblem(entry()), null);
  assert.match(tierProblem(entry({ tier: "official" })) ?? "", /must be community/u);
  assert.match(tierProblem(entry({ source: "github:spacia-ai/oxidevm-db" })) ?? "", /must be official/u);
  assert.match(tierProblem(entry({ featured: true })) ?? "", /only official modules are featured/u);
  assert.equal(tierProblem(entry({ source: "github:spacia-ai/oxidevm-db", tier: "official", featured: true })), null);
});
