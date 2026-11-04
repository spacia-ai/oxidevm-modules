// A fake GitHub for the tests: one module repository with one release, built from a manifest the
// SDK itself encodes, so the release checks run exactly as they do against GitHub.
import { createHash } from "node:crypto";

import { decodeResolvedManifest, encodeModuleManifest } from "@oxidevm/sdk/wasm";

import type { GithubSource } from "./github.ts";
import type { RegistryEntry } from "./registry.ts";

export const COMMIT = "c".repeat(40);

export function manifestBytes(overrides: Readonly<Record<string, unknown>> = {}): Uint8Array {
  return encodeModuleManifest(decodeResolvedManifest({
    schemaVersion: 1,
    id: "db",
    version: "1.2.0",
    abi: "emscripten",
    adapter: { api: 1, sha256: "a".repeat(64), bytes: 10 },
    artifacts: [],
    process: { kind: "service", exclusive: "workspace" },
    expose: { pg: { kind: "tcp", port: 5432, protocol: "postgres-3.0" } },
    requires: { host: ["files.sync"] },
    license: { spdx: "Apache-2.0" },
    upstream: [{ name: "Upstream DB", version: "18.0", source: "https://example.org/db" }],
    ...overrides,
  }));
}

export function sums(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const lines = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
  return new TextEncoder().encode(lines.join(""));
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface FakeRepository {
  readonly fullName?: string;
  readonly ownerType?: "User" | "Organization";
  readonly repository?: Readonly<Record<string, unknown>>;
  readonly release?: Readonly<Record<string, unknown>>;
  readonly manifest?: Uint8Array;
  readonly sums?: Uint8Array;
}

export interface FakeGithub {
  readonly repositories?: readonly FakeRepository[];
  readonly publicMembers?: readonly string[];
}

/** Every repository answers with one release; `manifest`, `sums` and the records can be replaced. */
export function fakeGithub(fake: FakeGithub = {}): GithubSource {
  const repositories = fake.repositories ?? [{}];
  const resolve = (owner: string, repo: string): FakeRepository | undefined => repositories.find((candidate) => (candidate.fullName ?? "acme/oxidevm-db") === `${owner}/${repo}`);
  const parts = (path: string): { owner: string; repo: string; rest: string } | null => {
    const match = /^\/repos\/([^/]+)\/([^/]+)(.*)$/u.exec(path);
    return match?.[1] === undefined || match[2] === undefined ? null : { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]), rest: match[3] ?? "" };
  };
  const files = (repository: FakeRepository): { manifest: Uint8Array; sums: Uint8Array } => {
    const manifest = repository.manifest ?? manifestBytes();
    return { manifest, sums: repository.sums ?? sums({ "adapter.mjs": new Uint8Array(10), "module.json": manifest }) };
  };
  return {
    json: (path) => {
      const found = parts(path);
      const repository = found === null ? undefined : resolve(found.owner, found.repo);
      if (found === null || repository === undefined) return Promise.resolve(null);
      const fullName = `${found.owner}/${found.repo}`;
      if (found.rest === "") {
        return Promise.resolve({
          private: false,
          archived: false,
          description: "A database",
          license: { spdx_id: "Apache-2.0" },
          topics: ["oxidevm-module"],
          html_url: `https://github.com/${fullName}`,
          owner: { login: found.owner, type: repository.ownerType ?? "User" },
          ...repository.repository,
        });
      }
      if (found.rest === "/releases/latest" || found.rest.startsWith("/releases/tags/")) {
        const { manifest, sums: sumBytes } = files(repository);
        return Promise.resolve({
          tag_name: "v1.2.0",
          html_url: `https://github.com/${fullName}/releases/tag/v1.2.0`,
          published_at: "2026-11-01T10:00:00Z",
          draft: false,
          prerelease: false,
          immutable: true,
          assets: [{ id: 1, name: "SHA256SUMS", size: sumBytes.byteLength }, { id: 2, name: "module.json", size: manifest.byteLength }],
          ...repository.release,
        });
      }
      return Promise.resolve(null);
    },
    asset: (owner, repo, id) => {
      const repository = resolve(owner, repo);
      if (repository === undefined) return Promise.reject(new Error("no repository"));
      const { manifest, sums: sumBytes } = files(repository);
      return Promise.resolve(id === 1 ? sumBytes : manifest);
    },
    commit: () => Promise.resolve(COMMIT),
    exists: (path) => Promise.resolve((fake.publicMembers ?? []).some((member) => path.endsWith(`/public_members/${member}`))),
  };
}

export function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return { source: "github:acme/oxidevm-db", tier: "community", featured: false, title: "DB", tagline: "A database.", publisher: "Acme", icon: "database", ...overrides };
}
