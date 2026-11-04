// The listing checks for one module repository and its release, and the facts the catalog keeps.
// A release is listed only when it is a published, immutable GitHub release, its SHA256SUMS pins
// its module.json, the SDK's own decoder accepts that manifest, and a copyleft license names its
// source: the rules `oxidevm wasm add` applies before it installs anything.
import { createHash } from "node:crypto";

import { classifyLicense, decodeModuleManifest, type ResolvedManifest } from "@oxidevm/sdk/wasm";

import type { GithubSource } from "./github.ts";
import { list, record, sourceRepository, type ModuleAuthority, type ModuleEndpoint, type ModuleReach, type ModuleSource, type ReleaseFacts } from "./registry.ts";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SUMS_BYTES = 64 * 1024;
const SUMS_LINE = /^([0-9a-f]{64}) {2}(.+)$/u;

/** The topic every listed repository carries, so `discover` can find modules that are not listed. */
export const MODULE_TOPIC = "oxidevm-module";

export class ListingError extends Error {
  override readonly name = "ListingError";
}

/** The repository facts the listing rules need. */
export interface RepositoryFacts {
  readonly owner: string;
  readonly ownerType: "User" | "Organization";
  readonly url: string;
  readonly description: string | null;
}

/** Checks the repository itself: public, active, described, licensed and tagged with the topic. */
export async function checkRepository(source: ModuleSource, github: GithubSource): Promise<RepositoryFacts> {
  const { owner, repo } = sourceRepository(source);
  const found = await github.json(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (found === null) throw new ListingError(`${source} does not exist or is not public`);
  const repository = record(found, `${source} repository`);
  const problems: string[] = [];
  if (repository["private"] !== false) problems.push("is not public");
  if (repository["archived"] === true) problems.push("is archived");
  const description = repository["description"];
  if (typeof description !== "string" || description.trim() === "") problems.push("has no description");
  if (repository["license"] === null || repository["license"] === undefined) problems.push("has no license GitHub recognizes");
  const topics = repository["topics"];
  if (!Array.isArray(topics) || !topics.includes(MODULE_TOPIC)) problems.push(`lacks the ${MODULE_TOPIC} topic`);
  if (problems.length > 0) throw new ListingError(`${source} ${problems.join(", ")}`);
  const ownerRecord = record(repository["owner"], `${source} owner`);
  return {
    owner: stringField(ownerRecord, "login", source),
    ownerType: ownerRecord["type"] === "Organization" ? "Organization" : "User",
    url: stringField(repository, "html_url", source),
    description: typeof description === "string" ? description : null,
  };
}

/** Checks a release (the latest, or `tag`) and returns its catalog facts. */
export async function checkRelease(source: ModuleSource, github: GithubSource, repository: RepositoryFacts, tag?: string): Promise<ReleaseFacts> {
  const { owner, repo } = sourceRepository(source);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const found = await github.json(tag === undefined ? `${base}/releases/latest` : `${base}/releases/tags/${encodeURIComponent(tag)}`);
  if (found === null) throw new ListingError(`${source} has no ${tag === undefined ? "published release" : `release ${tag}`}`);
  const release = record(found, `${source} release`);
  const name = stringField(release, "tag_name", source);
  const fail = (reason: string): never => {
    throw new ListingError(`${source}@${name} ${reason}`);
  };
  if (release["draft"] !== false || release["prerelease"] !== false) fail("is a draft or a prerelease");
  if (release["immutable"] !== true) fail("is not an immutable release: turn on immutable releases in the repository settings, then publish a new tag");
  const assets = list(release["assets"], `${source} release assets`).map((item) => {
    const asset = record(item, `${source} release asset`);
    const id = asset["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id)) return fail("has a malformed asset");
    return { id, name: stringField(asset, "name", source) };
  });
  const find = (file: string): number => assets.find((asset) => asset.name === file)?.id ?? fail(`has no ${file} asset`);
  const sums = await github.asset(owner, repo, find("SHA256SUMS"), MAX_SUMS_BYTES);
  const manifestBytes = await github.asset(owner, repo, find("module.json"), MAX_MANIFEST_BYTES);
  if (pinnedDigest(sums, "module.json") !== sha256(manifestBytes)) fail("has a module.json that its SHA256SUMS does not pin");
  let manifest: ResolvedManifest;
  try {
    manifest = decodeModuleManifest(manifestBytes);
  } catch (error) {
    return fail(`has a module.json the OxideVM SDK refuses: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (classifyLicense(manifest.license.spdx).copyleft && manifest.license.source === undefined) fail("is copyleft and names no license.source");
  return {
    repository: { url: repository.url, description: repository.description },
    release: {
      tag: name,
      url: stringField(release, "html_url", source),
      commit: await github.commit(owner, repo, name),
      id: sha256(sums),
      publishedAt: stringField(release, "published_at", source),
    },
    manifest: manifestFacts(manifest),
    authority: moduleAuthority(manifest),
  };
}

export function manifestFacts(manifest: ResolvedManifest): ReleaseFacts["manifest"] {
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.process.kind,
    commands: [...(manifest.commands ?? [])],
    endpoints: endpoints(manifest),
    reach: moduleReach(manifest.requires.host),
    browser: [...(manifest.requires.browser ?? [])],
    license: manifest.license.spdx,
    upstream: (manifest.upstream ?? []).map(({ name, version }) => ({ name, version })),
  };
}

/** The authority `oxidevm wasm add` compares: host operations, endpoints, Linux programs and commands. */
export function moduleAuthority(manifest: ResolvedManifest): ModuleAuthority {
  const sorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();
  return {
    host: sorted(manifest.requires.host),
    endpoints: sorted(endpoints(manifest).map((endpoint) => (endpoint.kind === "tcp" ? `tcp:${String(endpoint.port)}` : `unix:${endpoint.path}`))),
    executables: sorted(manifest.requires.guest?.executables ?? []),
    commands: sorted(manifest.commands ?? []),
  };
}

/** What `next` may do that `previous` may not; empty when the new release asks for nothing more. */
export function addedAuthority(previous: ModuleAuthority, next: ModuleAuthority): readonly string[] {
  const added: string[] = [];
  for (const key of ["host", "endpoints", "executables", "commands"] as const) {
    for (const item of next[key]) if (!previous[key].includes(item)) added.push(`${key}: ${item}`);
  }
  return added;
}

/**
 * The SDK's reach rule (`moduleReach` in @oxidevm/sdk wasm/reach.js, OxideVM ADR 0029), which the
 * SDK does not export: `net.internet` reaches the internet, `net.vm` or a bare `sockets.connect`
 * reaches programs in the VM, anything else reaches nothing.
 */
export function moduleReach(host: readonly string[]): ModuleReach {
  if (host.includes("net.internet")) return "internet";
  return host.includes("net.vm") || host.includes("sockets.connect") ? "vm" : "none";
}

/** The sha256 a SHA256SUMS file pins for `name`. */
export function pinnedDigest(sums: Uint8Array, name: string): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(sums);
  for (const line of text.split("\n")) {
    const match = SUMS_LINE.exec(line);
    if (match?.[1] !== undefined && match[2] === name) return match[1];
  }
  throw new ListingError(`SHA256SUMS does not pin ${name}`);
}

function endpoints(manifest: ResolvedManifest): ModuleEndpoint[] {
  if (!("expose" in manifest)) return [];
  return Object.entries(manifest.expose).map(([name, endpoint]) => (endpoint.kind === "tcp" ? { name, kind: "tcp", port: endpoint.port } : { name, kind: "unix", path: endpoint.path }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stringField(value: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new ListingError(`${label} has no ${key}`);
  return field;
}
