// Rebuilds catalog.json from modules.json and each module's latest release. A release that asks for
// more authority than the listed one (a new host operation, endpoint, Linux program or command) is
// flagged for review, the same comparison `oxidevm wasm add` makes before it asks a user again. A
// module whose latest release fails the checks keeps its listed release and is reported.
import type { GithubSource } from "./github.ts";
import { addedAuthority, checkRelease, checkRepository } from "./release.ts";
import type { CatalogEntry, ModuleCatalog, ModuleSource, RegistryEntry } from "./registry.ts";

export interface SyncChange {
  readonly source: ModuleSource;
  /** The tag listed before, or null for a module that was not listed yet. */
  readonly from: string | null;
  readonly to: string;
  /** Authority the new release adds; non-empty means a person must review the update. */
  readonly added: readonly string[];
}

export interface SyncFailure {
  readonly source: ModuleSource;
  readonly reason: string;
  /** Whether the catalog still lists the module, at its earlier release. */
  readonly kept: boolean;
}

export interface SyncResult {
  readonly catalog: ModuleCatalog;
  readonly changes: readonly SyncChange[];
  readonly failures: readonly SyncFailure[];
}

export async function syncCatalog(registry: readonly RegistryEntry[], previous: ModuleCatalog, github: GithubSource): Promise<SyncResult> {
  const modules: CatalogEntry[] = [];
  const changes: SyncChange[] = [];
  const failures: SyncFailure[] = [];
  for (const entry of registry) {
    const listed = previous.modules.find((module) => module.source.toLowerCase() === entry.source.toLowerCase());
    try {
      const facts = await checkRelease(entry.source, github, await checkRepository(entry.source, github));
      const conflict = modules.find((module) => module.manifest.id === facts.manifest.id);
      if (conflict !== undefined) throw new Error(`declares module id ${facts.manifest.id}, which ${conflict.source} already uses`);
      if (listed === undefined || listed.release.id !== facts.release.id) {
        changes.push({ source: entry.source, from: listed?.release.tag ?? null, to: facts.release.tag, added: listed === undefined ? [] : addedAuthority(listed.authority, facts.authority) });
      }
      modules.push({ ...entry, ...facts });
    } catch (error) {
      failures.push({ source: entry.source, reason: error instanceof Error ? error.message : String(error), kept: listed !== undefined });
      if (listed !== undefined) modules.push({ ...listed, ...entry });
    }
  }
  return { catalog: { schemaVersion: 1, modules }, changes, failures };
}

export function reviewRequired(result: SyncResult): boolean {
  return result.failures.length > 0 || result.changes.some((change) => change.added.length > 0);
}

/** A Markdown summary for the sync pull request and the workflow run. */
export function syncSummary(result: SyncResult): string {
  const lines: string[] = [];
  if (result.changes.length === 0 && result.failures.length === 0) return "No module has a new release.\n";
  if (result.changes.length > 0) {
    lines.push("## Releases", "", "| Module | From | To | New authority |", "| --- | --- | --- | --- |");
    for (const change of result.changes) {
      const added = change.added.length === 0 ? "none" : `**${change.added.map((item) => `\`${item}\``).join(", ")}**`;
      lines.push(`| \`${change.source}\` | ${change.from ?? "not listed"} | ${change.to} | ${added} |`);
    }
    lines.push("");
  }
  if (result.failures.length > 0) {
    lines.push("## Not updated", "");
    for (const failure of result.failures) lines.push(`- \`${failure.source}\`: ${failure.reason}${failure.kept ? " (still listed at its earlier release)" : " (not listed)"}`);
    lines.push("");
  }
  lines.push(reviewRequired(result) ? "**Review required:** a release asks for more authority, or a module failed its checks." : "Every update asks for no more authority than the listed release.");
  return `${lines.join("\n")}\n`;
}
