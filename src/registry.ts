// The two files of this repository and their exact shapes:
//   modules.json  the modules that are listed, one entry each, edited by pull request;
//   catalog.json  written by `node src/cli.ts sync`: every entry joined with the facts of its
//                 latest release that passed the listing checks. Never edit it by hand.

export const MODULE_TIERS = ["official", "community"] as const;
export type ModuleTier = (typeof MODULE_TIERS)[number];

/** Line icons the OxideVM pages draw for a module. */
export const MODULE_ICONS = ["python", "database", "terminal", "cube"] as const;
export type ModuleIcon = (typeof MODULE_ICONS)[number];

export const MODULE_REACHES = ["none", "vm", "internet"] as const;
/** How far the module reaches on the network (OxideVM ADR 0029), as the SDK's `ModuleReach`. */
export type ModuleReach = (typeof MODULE_REACHES)[number];

/** The owner that publishes official modules. */
export const OFFICIAL_OWNER = "spacia-ai";

/** A module's source in the form `oxidevm wasm add` takes: `github:<owner>/<repo>`. */
export type ModuleSource = `github:${string}/${string}`;

export interface RegistryEntry {
  readonly source: ModuleSource;
  readonly tier: ModuleTier;
  /** Featured modules also appear on the oxidevm.dev landing page. */
  readonly featured: boolean;
  /** The name a visitor knows, such as "Python" rather than "Pyodide". */
  readonly title: string;
  /** One short sentence about what the module lets you do. */
  readonly tagline: string;
  /** Who publishes it, as the pages print it ("by Spacia"). */
  readonly publisher: string;
  readonly icon: ModuleIcon;
}

export type ModuleEndpoint =
  | { readonly name: string; readonly kind: "tcp"; readonly port: number }
  | { readonly name: string; readonly kind: "unix"; readonly path: string };

/**
 * What a release may do, in the terms `oxidevm wasm add` compares between releases: a release that
 * adds any of these asks the user again, and a catalog update that adds any needs a review.
 */
export interface ModuleAuthority {
  readonly host: readonly string[];
  readonly endpoints: readonly string[];
  readonly executables: readonly string[];
  readonly commands: readonly string[];
}

export interface ReleaseFacts {
  readonly repository: { readonly url: string; readonly description: string | null };
  readonly release: {
    readonly tag: string;
    readonly url: string;
    /** The commit the tag pointed to when the catalog was written. */
    readonly commit: string;
    /** The sha256 of the release's SHA256SUMS, as `oxidevm wasm add` names the release. */
    readonly id: string;
    readonly publishedAt: string;
  };
  readonly manifest: {
    readonly id: string;
    readonly version: string;
    readonly kind: "command" | "service";
    readonly commands: readonly string[];
    readonly endpoints: readonly ModuleEndpoint[];
    readonly reach: ModuleReach;
    readonly browser: readonly string[];
    readonly license: string;
    readonly upstream: readonly { readonly name: string; readonly version: string }[];
  };
  readonly authority: ModuleAuthority;
}

export type CatalogEntry = RegistryEntry & ReleaseFacts;

export interface ModuleCatalog {
  readonly schemaVersion: 1;
  readonly modules: readonly CatalogEntry[];
}

const SOURCE = /^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

const ENTRY_KEYS = ["source", "tier", "featured", "title", "tagline", "publisher", "icon"] as const;

export function sourceRepository(source: ModuleSource): { readonly owner: string; readonly repo: string } {
  const match = SOURCE.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) throw new TypeError(`Module source ${source} is not github:<owner>/<repo>`);
  return { owner: match[1], repo: match[2] };
}

/** Reads a `github:<owner>/<repo>` source from text, such as a command-line argument. */
export function parseSource(value: unknown): ModuleSource {
  return decodeSource(value, "source");
}

export function decodeRegistry(value: unknown): readonly RegistryEntry[] {
  const root = record(value, "modules.json");
  exactKeys(root, ["modules"], "modules.json");
  const modules = list(root["modules"], "modules.json modules").map((item, index) => decodeEntry(item, `modules.json modules[${String(index)}]`));
  unique(modules.map((module) => module.source.toLowerCase()), "modules.json");
  return modules;
}

export function decodeCatalog(value: unknown): ModuleCatalog {
  const root = record(value, "catalog.json");
  exactKeys(root, ["schemaVersion", "modules"], "catalog.json");
  if (root["schemaVersion"] !== 1) throw new TypeError("catalog.json has an unsupported schemaVersion");
  const modules = list(root["modules"], "catalog.json modules").map((item, index) => {
    const label = `catalog.json modules[${String(index)}]`;
    const entry = record(item, label);
    exactKeys(entry, [...ENTRY_KEYS, "repository", "release", "manifest", "authority"], label);
    return { ...decodeEntry(pick(entry, ENTRY_KEYS), label), ...decodeFacts(entry, label) };
  });
  unique(modules.map((module) => module.source.toLowerCase()), "catalog.json");
  unique(modules.map((module) => module.manifest.id), "catalog.json manifest ids");
  return { schemaVersion: 1, modules };
}

/** The registry's tier rule: official means published by the official owner, and only then. */
export function tierProblem(entry: RegistryEntry): string | null {
  const official = sourceRepository(entry.source).owner.toLowerCase() === OFFICIAL_OWNER;
  if (entry.tier === "official" && !official) return `${entry.source} is not published by ${OFFICIAL_OWNER}, so its tier must be community`;
  if (entry.tier === "community" && official) return `${entry.source} is published by ${OFFICIAL_OWNER}, so its tier must be official`;
  if (entry.featured && !official) return `${entry.source}: only official modules are featured on the landing page`;
  return null;
}

function decodeEntry(value: unknown, label: string): RegistryEntry {
  const entry = record(value, label);
  exactKeys(entry, ENTRY_KEYS, label);
  const featured = entry["featured"];
  if (typeof featured !== "boolean") throw new TypeError(`${label} featured must be true or false`);
  return {
    source: decodeSource(entry["source"], label),
    tier: oneOf(entry["tier"], MODULE_TIERS, `${label} tier`),
    featured,
    title: text(entry["title"], `${label} title`, 40),
    tagline: text(entry["tagline"], `${label} tagline`, 120),
    publisher: text(entry["publisher"], `${label} publisher`, 40),
    icon: oneOf(entry["icon"], MODULE_ICONS, `${label} icon`),
  };
}

function decodeFacts(facts: Readonly<Record<string, unknown>>, label: string): ReleaseFacts {
  const repository = record(facts["repository"], `${label} repository`);
  exactKeys(repository, ["url", "description"], `${label} repository`);
  const release = record(facts["release"], `${label} release`);
  exactKeys(release, ["tag", "url", "commit", "id", "publishedAt"], `${label} release`);
  const manifest = record(facts["manifest"], `${label} manifest`);
  exactKeys(manifest, ["id", "version", "kind", "commands", "endpoints", "reach", "browser", "license", "upstream"], `${label} manifest`);
  const authority = record(facts["authority"], `${label} authority`);
  exactKeys(authority, ["host", "endpoints", "executables", "commands"], `${label} authority`);
  const description = repository["description"];
  const texts = (value: unknown, name: string, max: number): readonly string[] => list(value, name).map((item) => text(item, name, max));
  return {
    repository: {
      url: githubUrl(repository["url"], `${label} repository url`),
      description: description === null ? null : text(description, `${label} repository description`, 350),
    },
    release: {
      tag: text(release["tag"], `${label} release tag`, 100),
      url: githubUrl(release["url"], `${label} release url`),
      commit: pattern(release["commit"], COMMIT, `${label} release commit`),
      id: pattern(release["id"], SHA256, `${label} release id`),
      publishedAt: pattern(release["publishedAt"], ISO_TIME, `${label} release publishedAt`),
    },
    manifest: {
      id: text(manifest["id"], `${label} manifest id`, 64),
      version: text(manifest["version"], `${label} manifest version`, 64),
      kind: oneOf(manifest["kind"], ["command", "service"] as const, `${label} manifest kind`),
      commands: texts(manifest["commands"], `${label} manifest commands`, 64),
      endpoints: list(manifest["endpoints"], `${label} manifest endpoints`).map((item) => decodeEndpoint(item, `${label} manifest endpoint`)),
      reach: oneOf(manifest["reach"], MODULE_REACHES, `${label} manifest reach`),
      browser: texts(manifest["browser"], `${label} manifest browser`, 64),
      license: text(manifest["license"], `${label} manifest license`, 1000),
      upstream: list(manifest["upstream"], `${label} manifest upstream`).map((item) => {
        const upstream = record(item, `${label} manifest upstream`);
        exactKeys(upstream, ["name", "version"], `${label} manifest upstream`);
        return { name: text(upstream["name"], `${label} upstream name`, 200), version: text(upstream["version"], `${label} upstream version`, 64) };
      }),
    },
    authority: {
      host: texts(authority["host"], `${label} authority host`, 64),
      endpoints: texts(authority["endpoints"], `${label} authority endpoints`, 300),
      executables: texts(authority["executables"], `${label} authority executables`, 255),
      commands: texts(authority["commands"], `${label} authority commands`, 64),
    },
  };
}

function decodeEndpoint(value: unknown, label: string): ModuleEndpoint {
  const endpoint = record(value, label);
  const name = text(endpoint["name"], `${label} name`, 64);
  if (endpoint["kind"] === "tcp") {
    exactKeys(endpoint, ["name", "kind", "port"], label);
    const port = endpoint["port"];
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError(`${label} port must be 1 to 65535`);
    return { name, kind: "tcp", port };
  }
  exactKeys(endpoint, ["name", "kind", "path"], label);
  if (endpoint["kind"] !== "unix") throw new TypeError(`${label} kind must be tcp or unix`);
  return { name, kind: "unix", path: text(endpoint["path"], `${label} path`, 255) };
}

function decodeSource(value: unknown, label: string): ModuleSource {
  const source = text(value, `${label} source`, 160);
  if (!isSource(source)) throw new TypeError(`${label} source must be github:<owner>/<repo>`);
  return source;
}

function isSource(value: string): value is ModuleSource {
  return SOURCE.test(value);
}

function githubUrl(value: unknown, label: string): string {
  const url = text(value, label, 300);
  if (!url.startsWith("https://github.com/")) throw new TypeError(`${label} must be a https://github.com/ address`);
  return url;
}

export function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(value: Readonly<Record<string, unknown>>, keys: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${label} has an unknown field ${key}`);
}

export function list(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a list`);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${label} must be text of at most ${String(max)} characters`);
  return value;
}

function pattern(value: unknown, expected: RegExp, label: string): string {
  if (typeof value !== "string" || !expected.test(value)) throw new TypeError(`${label} is malformed`);
  return value;
}

function oneOf<const T extends string>(value: unknown, values: readonly T[], label: string): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new TypeError(`${label} must be one of ${values.join(", ")}`);
  return found;
}

function unique(keys: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new TypeError(`${label} lists ${key} twice`);
    seen.add(key);
  }
}
