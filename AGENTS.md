# AGENTS.md

Guide for coding agents and human contributors working on storeshots-mcp.

## What this project is

A TypeScript toolkit that renders App Store and Google Play marketing screenshots. The deterministic render engine is a standalone core, exposed through three thin surfaces:

1. **CLI** (primary surface): `npx storeshots <command>`. A project config (`storeshots.json`) describes a whole listing, and `storeshots build` renders it incrementally. This serves humans, scripts, CI, and every agent that has a shell.
2. **MCP server**: standard stdio transport for clients without a shell (Claude Desktop and others). It exposes the same core, including `build_project`.
3. **Claude Code plugin** (`.claude-plugin/`, `skills/storeshots/SKILL.md`): carries the guided workflow and delegates all rendering to the CLI, or to the MCP tools when there is no shell.

The core does deterministic pixel work only. All copywriting, translation, and benefit selection is done by the calling agent. Read README.md first for the product surface.

## Architecture

```
src/
  index.ts          MCP server entry: registers tools, stdio transport
  cli.ts            CLI entry: sets exit code from cli/run.ts, wires the TTY prompt
  cli/run.ts        runCli(argv, io): commands, help, human/--json output (testable in-process)
  schemas.ts        Zod fields shared by MCP tools and the project config
  star.ts           One-time GitHub star ask (state in ~/.config/storeshots/state.json)
  presets.ts        Platform presets (dimensions, layout metrics, safe areas)
  project/
    config.ts       storeshots.json schema + loadPlan(): validates, expands into render jobs
    build.ts        buildPlan(): incremental render via content-hash manifest, pruning, pool
    init.ts         initProject(): scaffold a config from a screenshot folder
    agents.ts       Marker-delimited storeshots section for the user's AGENTS.md / CLAUDE.md
  render/
    compose.ts      Single-screenshot composition pipeline + layout variants
    frame.ts        Built-in programmatic frames + renderCustomDevice (BYO frame)
    panorama.ts     Continuous gradient sliced across a set
    set.ts          generateSet(): ordered set for one preset + language
    text.ts         Headline layout, sizing, luminance-based color
    showcase.ts     Multi-screenshot preview strip
    validate.ts     Store dimension/format checks
  tools/            MCP tool definitions, thin wrappers over render/ and project/
.claude-plugin/       Claude Code plugin + marketplace manifests (repo root is the plugin)
skills/storeshots/
  SKILL.md          Claude Code skill: workflow layer only, no code
llms.txt            Agent-facing summary of commands and config; keep in sync with the CLI
assets/
  fonts/            Bundled OFL-licensed font files only
  showcase.png      README hero image, rendered from real app screens (sources
                    live outside this repo; scripts/make-demo.mjs regenerates an
                    equivalent strip from generated mock screens instead)
test/
scripts/
  make-demo.mjs     Generates mock app screens, demo set, and the showcase
```

Device frames are drawn programmatically as SVG in `render/frame.ts` (body, bezel, dynamic island or punch hole); there are no binary frame assets. Text rendering uses the bundled font through a generated fontconfig file (`ensureFontconfig` in `util.ts`); without it, pango silently falls back to host fonts and output stops being deterministic.

- **Runtime**: Node >= 18, ESM.
- **MCP SDK**: `@modelcontextprotocol/sdk`, stdio transport only. Nothing client-specific: no Claude-only extensions, no assumptions about which agent is calling.
- **Rendering**: `sharp` for raster ops, SVG strings for text and shapes composited via sharp. No headless browser, no canvas native deps beyond sharp.
- **Distribution**: npm package with two `bin` entries: `storeshots-mcp` (server) and `storeshots` (CLI). The MCP server and CLI are thin wrappers; all logic lives in the core so the surfaces can never drift apart.

## Non-negotiable principles

1. **Deterministic output.** No network calls, no AI generation, no randomness in the render path. Same input must produce byte-stable pixels across runs on the same platform.
2. **No secrets.** The server must never require or accept API keys.
3. **Exact dimensions.** Output is resized and validated against the preset before writing. A wrong-sized PNG is a bug, never a warning.
4. **Font licensing.** Only OFL or similarly redistributable fonts may be bundled. Never add SF Pro or other Apple/Google proprietary fonts.
5. **Unicode correctness.** Headlines render in caps via explicit locale-aware uppercasing (`toLocaleUpperCase(lang)`). Turkish `i` must become `İ`, never `I`. Never strip or ASCII-fold special characters.
6. **Agent-friendly returns.** Every tool returns structured JSON: output paths, dimensions, and any warnings. Errors must say what to fix, not just what failed.

## Layout contract (compose)

- Canvas: solid brand color background, optional subtle vertical gradient.
- Headline block: verb line (largest) plus descriptor line, centered, within the middle 70% of canvas width, top-aligned zone.
- Device: framed screenshot in the lower zone, bottom edge intentionally cropped by the canvas for a dynamic look.
- Minimum 40 px gap between text block and device top.
- Text color: white or near-black chosen by background luminance (relative luminance threshold 0.5).

Change these values only in `presets.ts`, never inline in render code.

## Commands

```bash
npm install
npm run build        # tsc
npm test             # vitest
npm run dev          # server on stdio for manual testing
npx @modelcontextprotocol/inspector node dist/index.js   # interactive tool testing
```

## Incremental builds

`build` keys every output by a sha256 over everything that affects its pixels: compose options, the contents of the input screenshot and frame, panorama slice info, and the package version. It stores these keys in `<outputDir>/.storeshots-cache.json`. An output is skipped when its key matches and the file still exists. This is only safe because rendering is deterministic, so any new input that affects pixels must be added to the key in `imageKey()`. Only a full build (no `--lang`/`--preset` filter) prunes, and it deletes only files listed in the manifest, never anything else in the output dir.

## Testing expectations

- CLI tests drive `runCli` in-process with a captured io. One test spawns `dist/cli.js` to check real exit codes and `--watch`, so `npm test` builds first.
- Every preset has a dimension test: composed output matches the preset exactly.
- Typography test renders Turkish (`GÜÇLÜ İZLEME`) and German (`ÜBERBLICK`) headlines and asserts non-empty glyph rendering, no tofu boxes (compare against a known-bad reference crop).
- Tool schema tests: every tool validates inputs with zod and rejects bad paths, bad hex colors, and unknown presets with actionable messages.
- Golden-image tests are allowed but must tolerate platform-level antialiasing differences (use pixelmatch with a small threshold).

## Conventions

- TypeScript strict mode, no `any` in exported signatures.
- Tool names and parameters: snake_case (MCP convention). Internal code: camelCase.
- Keep tools thin. Logic lives in `render/`, tools only validate input and format output.
- No new runtime dependencies without a strong reason; the install footprint is a feature.
- README is user-facing marketing plus setup. Deep technical detail belongs here, not there.

## What not to do

- Do not add a Gemini, OpenAI, or any generative-image step to the pipeline. Enhancement experiments belong in a separate opt-in tool or a different project.
- Do not fetch fonts, frames, or assets at runtime. Everything ships in the package.
- Do not write outside the user-specified output directory.
- Do not silently overwrite existing outputs; return a warning flag when overwriting.
- Do not instruct agents to take actions on the user's accounts (starring, following, posting) without an explicit yes. The star ask (`src/star.ts`) is offered once per machine after a build that rendered something. On a terminal it is a `[Y/n]` prompt that the user answers directly. Agents get a yes/no question in the output and may run the star command only on an explicit yes. It is never offered in CI or when `STORESHOTS_NO_STAR` is set, and tests set that variable globally (vitest.config.ts).
- When bumping the version, update package.json, server.json (twice), and .claude-plugin/plugin.json; a test enforces this.
