# AGENTS.md

Guide for coding agents and human contributors working on storeshots-mcp.

## What this project is

A TypeScript toolkit that renders App Store and Google Play marketing screenshots. The deterministic render engine is a standalone core, exposed through three thin surfaces:

1. **MCP server** (primary distribution): standard stdio transport, so it works in every MCP client (Claude Code, Claude Desktop, Cursor, Windsurf, Antigravity, Codex, Gemini CLI, VS Code, Zed).
2. **CLI**: `npx storeshots <command>` for humans and scripts.
3. **Claude Code skill** (`skill/SKILL.md`): carries the guided workflow, delegates all rendering to the MCP tools or CLI.

The core does deterministic pixel work only. All copywriting, translation, and benefit selection is done by the calling agent. Read README.md first for the product surface.

## Architecture

```
src/
  index.ts          MCP server entry: registers tools, stdio transport
  cli.ts            CLI entry: same core, argv interface
  presets.ts        Platform presets (dimensions, layout metrics, safe areas)
  render/
    compose.ts      Single-screenshot composition pipeline
    frame.ts        Device frame loading and screenshot masking
    text.ts         Headline layout, sizing, luminance-based color
    showcase.ts     Multi-screenshot preview strip
  tools/            One file per MCP tool, thin wrappers over render/
skill/
  SKILL.md          Claude Code skill: workflow layer only, no code
assets/
  frames/           Device frame images (iPhone, Android, iPad, tablet)
  fonts/            Bundled OFL-licensed font files only
test/
```

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

## Testing expectations

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
