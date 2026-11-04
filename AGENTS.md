# oxidevm-modules: instructions for coding agents

This public repository lists OxideVM WebAssembly modules. `modules.json` is edited by pull request; `catalog.json` is written only by `node src/cli.ts sync`.

- Commit as the repository owner, with no tool or assistant attribution in commits, pull requests or tags.
- Keep `src/` strict TypeScript that Node runs directly: no `any`, everything from GitHub starts as `unknown` and is decoded.
- The validator must never run code from a pull request; it reads only data.
- Verify with `pnpm run check` and `pnpm test`. Tests use the fake GitHub in `src/testing.ts`, never the network.
