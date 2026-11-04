# OxideVM modules

The list of WebAssembly modules for [OxideVM](https://oxidevm.dev). The [module catalog](https://oxidevm.dev/docs/modules/) on oxidevm.dev and the landing page are built from this repository.

A module packages a WebAssembly program, such as Python or a PostgreSQL database, so that an application installs it with one command and runs it in its VM:

```sh
npm exec -- oxidevm wasm add github:spacia-ai/oxidevm-pyodide@v0.3.0
```

[WebAssembly modules](https://oxidevm.dev/docs/guides/wasm-modules/) explains how to use them, and [Author a module](https://oxidevm.dev/docs/guides/author-a-module/) how to make one.

## Files

| File | What it is |
| --- | --- |
| `modules.json` | The listed modules, one entry each. Changed by pull request. |
| `catalog.json` | Every entry with the facts of its latest release that passed the checks. Written by the nightly sync; never edit it by hand. |

An entry in `modules.json`:

```json
{
  "source": "github:you/oxidevm-tool",
  "tier": "community",
  "featured": false,
  "title": "Tool",
  "tagline": "One short sentence about what the module lets people do.",
  "publisher": "Your name",
  "icon": "terminal"
}
```

- `source` is the repository, in the form `oxidevm wasm add` takes.
- `tier` is `official` for modules published by `spacia-ai`, and `community` for every other module.
- `featured` puts an official module on the oxidevm.dev landing page. Community modules keep it `false`.
- `title` is the name people know (at most 40 characters). `tagline` is one sentence (at most 120). `publisher` is how the pages credit you.
- `icon` is one of `python`, `database`, `terminal` and `cube`.

## List your module

1. Publish the module from its own public GitHub repository with `oxidevm wasm release`, as an immutable release. Turn on immutable releases in the repository settings first.
2. Give the repository a description, a license and the `oxidevm-module` topic.
3. Optional: check it the way this repository will, from your own workflow:

   ```yaml
   on:
     release:
       types: [published]
   jobs:
     listing:
       runs-on: ubuntu-latest
       steps:
         - uses: spacia-ai/oxidevm-modules@v1
           with:
             tag: ${{ github.event.release.tag_name }}
   ```

4. Open a pull request that adds your entry to `modules.json` and changes nothing else, and fill in the checklist.

The `validate` check runs on the pull request. It confirms that you own the repository (you are its owner, or a public member of the organization that owns it), that the repository meets step 2, and that the latest release is listable:

- it is a published, immutable release;
- its `SHA256SUMS` pins its `module.json`;
- the OxideVM SDK accepts the manifest;
- a copyleft license names where its source is;
- no listed module already uses its module id.

A maintainer then reviews the entry and the module's declarations, and merges it. The next sync adds the module to `catalog.json`.

## Updates

You don't open a pull request for a new release. Every night the `sync` workflow reads the latest release of every listed module and opens one pull request that updates `catalog.json`. A maintainer merges it.

- When a release asks for more authority than the listed one, the pull request is marked **review required** and shows what was added. That means a new host operation, endpoint, Linux program or command, the same comparison `oxidevm wasm add` makes before it asks a user again.
- When a release fails a check, the module stays listed at its earlier release, and the pull request says why.

## Trust

A listing means the module passed these checks and a maintainer looked at it. It does not mean Spacia reviewed its code or maintains it. A module acts on a VM with the authority it declares, so review it as you would review any other dependency. **Official** modules are published by Spacia. **Community** modules are published and maintained by their authors.

To report a problem with a listed module, open an issue here.

## Development

```sh
pnpm install
pnpm run check
pnpm test
node src/cli.ts sync        # rebuild catalog.json
node src/cli.ts check you/oxidevm-tool
node src/cli.ts discover    # repositories with the topic that are not listed
```

Set `GITHUB_TOKEN` or `GH_TOKEN` for a higher API rate limit.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
