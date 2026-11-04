// Checks a pull request that changes modules.json, from data only: the validator never runs code
// from the pull request. A submission changes only modules.json, and its author owns each module it
// adds or changes (the repository owner, or a public member of the owning organization). Maintainers
// (owners, members and collaborators of this repository) may also edit other files and remove entries.
import type { GithubSource } from "./github.ts";
import { checkRelease, checkRepository } from "./release.ts";
import { decodeRegistry, sourceRepository, tierProblem, type ModuleCatalog, type RegistryEntry } from "./registry.ts";

export interface Submission {
  readonly base: readonly RegistryEntry[];
  /** The pull request's modules.json, still unknown. */
  readonly head: unknown;
  readonly changedFiles: readonly string[];
  readonly author: string;
  readonly maintainer: boolean;
  readonly catalog: ModuleCatalog;
}

export interface Validation {
  readonly errors: readonly string[];
  readonly checked: readonly string[];
}

export async function validateSubmission(submission: Submission, github: GithubSource): Promise<Validation> {
  const errors: string[] = [];
  const checked: string[] = [];
  let head: readonly RegistryEntry[];
  try {
    head = decodeRegistry(submission.head);
  } catch (error) {
    return { errors: [`modules.json: ${error instanceof Error ? error.message : String(error)}`], checked };
  }
  const others = submission.changedFiles.filter((file) => file !== "modules.json");
  if (!submission.maintainer && others.length > 0) errors.push(`A submission changes only modules.json; this pull request also changes ${others.join(", ")}`);
  const key = (entry: RegistryEntry): string => entry.source.toLowerCase();
  const baseBySource = new Map(submission.base.map((entry) => [key(entry), entry]));
  const headSources = new Set(head.map(key));
  const removed = submission.base.filter((entry) => !headSources.has(key(entry)));
  if (!submission.maintainer && removed.length > 0) errors.push(`Only maintainers remove modules; this pull request removes ${removed.map((entry) => entry.source).join(", ")}`);
  const touched = head.filter((entry) => JSON.stringify(baseBySource.get(key(entry))) !== JSON.stringify(entry));
  for (const entry of touched) {
    const problem = tierProblem(entry);
    if (problem !== null) errors.push(problem);
    try {
      const repository = await checkRepository(entry.source, github);
      if (!submission.maintainer && !(await ownsRepository(submission.author, repository.owner, repository.ownerType, github))) {
        errors.push(`${entry.source}: @${submission.author} is not its owner or a public member of ${repository.owner}`);
      }
      const facts = await checkRelease(entry.source, github, repository);
      const clash = submission.catalog.modules.find((module) => module.manifest.id === facts.manifest.id && key(module) !== key(entry));
      if (clash !== undefined) errors.push(`${entry.source} declares module id ${facts.manifest.id}, which ${clash.source} already uses`);
      checked.push(`${entry.source}@${facts.release.tag} (${facts.manifest.kind}, network: ${facts.manifest.reach})`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (touched.length === 0 && removed.length === 0 && !submission.maintainer) errors.push("modules.json has no added or changed entry");
  return { errors, checked };
}

async function ownsRepository(author: string, owner: string, ownerType: "User" | "Organization", github: GithubSource): Promise<boolean> {
  if (author.toLowerCase() === owner.toLowerCase()) return true;
  return ownerType === "Organization" && github.exists(`/orgs/${encodeURIComponent(owner)}/public_members/${encodeURIComponent(author)}`);
}

/** Repositories with the module topic that modules.json does not list. */
export async function discoverCandidates(listed: readonly RegistryEntry[], github: GithubSource): Promise<readonly string[]> {
  const result = await github.json("/search/repositories?q=topic:oxidevm-module+is:public+archived:false&per_page=100");
  if (typeof result !== "object" || result === null || !("items" in result) || !Array.isArray(result.items)) throw new Error("The topic search returned no item list");
  const known = new Set(listed.map((entry) => { const { owner, repo } = sourceRepository(entry.source); return `${owner}/${repo}`.toLowerCase(); }));
  const names: string[] = [];
  for (const item of result.items as readonly unknown[]) {
    if (typeof item === "object" && item !== null && "full_name" in item && typeof item.full_name === "string" && !known.has(item.full_name.toLowerCase())) names.push(`github:${item.full_name}`);
  }
  return names.sort();
}
