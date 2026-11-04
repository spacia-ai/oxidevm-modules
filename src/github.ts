// The GitHub REST calls the registry makes. Tests pass a fake `GithubSource`; the commands use
// `githubClient`, which sends the token (when there is one) only to api.github.com.

const API = "https://api.github.com";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export interface GithubSource {
  /** A REST response body, still unknown; `null` when GitHub answers 404. */
  json(path: string): Promise<unknown>;
  /** The bytes of one release asset. */
  asset(owner: string, repo: string, id: number, maxBytes: number): Promise<Uint8Array>;
  /** The commit a tag points to. */
  commit(owner: string, repo: string, tag: string): Promise<string>;
  /** Whether a path answers 2xx, such as a public organization membership (204) or not (404). */
  exists(path: string): Promise<boolean>;
}

export function githubClient(token: string | undefined): GithubSource {
  const headers = (accept: string): Record<string, string> => ({
    Accept: accept,
    "User-Agent": "oxidevm-modules",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
  });
  return {
    async json(path) {
      const bytes = await fetchBytes(new URL(`${API}${path}`), headers("application/vnd.github+json"), MAX_JSON_BYTES, true);
      return bytes === null ? null : (JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    },
    async asset(owner, repo, id, maxBytes) {
      const url = new URL(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${String(id)}`);
      const bytes = await fetchBytes(url, headers("application/octet-stream"), maxBytes, false);
      if (bytes === null) throw new Error(`${owner}/${repo} asset ${String(id)} is missing`);
      return bytes;
    },
    async exists(path) {
      const response = await fetch(new URL(`${API}${path}`), { headers: headers("application/vnd.github+json"), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) return true;
      if (response.status === 404 || (response.status >= 300 && response.status < 400)) return false;
      throw new Error(`${path} answered ${String(response.status)}`);
    },
    async commit(owner, repo, tag) {
      const url = new URL(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(tag)}`);
      const bytes = await fetchBytes(url, headers("application/vnd.github.sha"), 128, false);
      const sha = bytes === null ? "" : new TextDecoder().decode(bytes).trim();
      if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${owner}/${repo}@${tag} does not name a commit`);
      return sha;
    },
  };
}

/** Follows at most three redirects by hand, so the token never leaves api.github.com. */
async function fetchBytes(url: URL, headers: Record<string, string>, maxBytes: number, allowMissing: boolean): Promise<Uint8Array | null> {
  let target = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const sent = target.hostname === "api.github.com" ? headers : { Accept: headers["Accept"] ?? "*/*", "User-Agent": "oxidevm-modules" };
    const response = await fetch(target, { headers: sent, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      target = new URL(location, target);
      const github = target.hostname === "api.github.com" || target.hostname === "github.com" || target.hostname.endsWith(".githubusercontent.com");
      if (target.protocol !== "https:" || !github) throw new Error(`${url.href} redirects outside GitHub`);
      continue;
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`${target.href} answered ${String(response.status)}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`${target.href} is larger than ${String(maxBytes)} bytes`);
    return bytes;
  }
  throw new Error(`${url.href} redirects too often`);
}

/** GITHUB_TOKEN or GH_TOKEN; without one the public API still answers, at a lower rate limit. */
export function githubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
