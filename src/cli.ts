// node src/cli.ts <command>
//   sync                         rebuild catalog.json from modules.json and the latest releases
//   validate --head <file> --changed-files <file> --author <login> [--maintainer]
//                                check a pull request's modules.json against the base modules.json
//   check <owner>/<repo> [--tag <tag>]
//                                check that a repository and its release can be listed
//   discover                     repositories with the oxidevm-module topic that are not listed
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";

import { githubClient, githubToken } from "./github.ts";
import { checkRelease, checkRepository } from "./release.ts";
import { decodeCatalog, decodeRegistry, parseSource } from "./registry.ts";
import { reviewRequired, syncCatalog, syncSummary } from "./sync.ts";
import { discoverCandidates, validateSubmission } from "./validate.ts";

const ROOT = new URL("../", import.meta.url);

async function readJson(path: string | URL): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function required(args: readonly string[], name: string): string {
  const value = option(args, name);
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

async function output(name: string, value: string): Promise<void> {
  const file = process.env["GITHUB_OUTPUT"];
  if (file !== undefined && file !== "") await appendFile(file, `${name}=${value}\n`);
}

async function summary(markdown: string): Promise<void> {
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") await appendFile(file, markdown);
}

async function main(args: readonly string[]): Promise<number> {
  const github = githubClient(githubToken());
  const registry = (): Promise<ReturnType<typeof decodeRegistry>> => readJson(new URL("modules.json", ROOT)).then(decodeRegistry);
  const catalog = (): Promise<ReturnType<typeof decodeCatalog>> => readJson(new URL("catalog.json", ROOT)).then(decodeCatalog);
  switch (args[0]) {
    case "sync": {
      const result = await syncCatalog(await registry(), await catalog(), github);
      const target = new URL("catalog.json", ROOT);
      const temporary = new URL("catalog.json.tmp", ROOT);
      await writeFile(temporary, `${JSON.stringify(result.catalog, null, 2)}\n`);
      await rename(temporary, target);
      const markdown = syncSummary(result);
      await writeFile(new URL("sync-summary.md", ROOT), markdown);
      await summary(markdown);
      await output("review_required", String(reviewRequired(result)));
      console.log(markdown);
      return 0;
    }
    case "validate": {
      const changedFiles = (await readFile(required(args, "--changed-files"), "utf8")).split("\n").map((line) => line.trim()).filter((line) => line !== "");
      const result = await validateSubmission({
        base: await registry(),
        head: await readJson(required(args, "--head")),
        changedFiles,
        author: required(args, "--author"),
        maintainer: args.includes("--maintainer"),
        catalog: await catalog(),
      }, github);
      const lines = [
        ...(result.checked.length > 0 ? ["Checked:", ...result.checked.map((item) => `- ${item}`), ""] : []),
        ...(result.errors.length > 0 ? ["Problems:", ...result.errors.map((item) => `- ${item}`)] : ["The submission passes the listing checks. A maintainer reviews it next."]),
      ];
      await summary(`${lines.join("\n")}\n`);
      console.log(lines.join("\n"));
      return result.errors.length > 0 ? 1 : 0;
    }
    case "check": {
      const repository = args[1];
      if (repository === undefined || !/^[^/\s]+\/[^/\s]+$/u.test(repository)) throw new Error("check needs <owner>/<repo>");
      const source = parseSource(`github:${repository}`);
      const facts = await checkRelease(source, github, await checkRepository(source, github), option(args, "--tag"));
      const line = `${source}@${facts.release.tag} can be listed: ${facts.manifest.kind} ${facts.manifest.id} ${facts.manifest.version}, network ${facts.manifest.reach}, release ${facts.release.id}`;
      await summary(`${line}\n`);
      console.log(line);
      return 0;
    }
    case "discover": {
      const candidates = await discoverCandidates(await registry(), github);
      console.log(candidates.length === 0 ? "No unlisted repository carries the oxidevm-module topic." : candidates.join("\n"));
      return 0;
    }
    default:
      console.error("usage: node src/cli.ts sync | validate | check <owner>/<repo> | discover");
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
