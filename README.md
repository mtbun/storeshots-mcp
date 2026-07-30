# storeshots-mcp

**Ship App Store and Google Play screenshots without opening a design tool.**

storeshots-mcp turns raw app screenshots into finished store-listing visuals — device frames, benefit-driven headlines, brand backgrounds, and exact store dimensions for iOS and Android. It runs as an [MCP](https://modelcontextprotocol.io) server, so the AI agent you already use writes and translates the copy while storeshots renders the pixels. No design tool, no subscription, no API keys.

<p align="center">
  <img src="assets/showcase.png" alt="App Store and Google Play screenshots generated with storeshots-mcp" width="100%" />
</p>

<p align="center">
  <sub>Real screens from two shipped apps: <a href="https://apps.apple.com/app/id6774954831">bombo</a> (panels 1–3) and <a href="https://apps.apple.com/app/id6756270620">Studio Zero</a> (panel 4). Panel 3 is the Android preset with Turkish headlines, uppercased with locale-correct <code>İ</code> and <code>Ğ</code>.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/storeshots-mcp"><img src="https://img.shields.io/npm/v/storeshots-mcp?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://github.com/mtbun/storeshots-mcp/actions/workflows/ci.yml"><img src="https://github.com/mtbun/storeshots-mcp/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
  <img src="https://img.shields.io/badge/MCP-stdio-8A2BE2" alt="MCP stdio" />
</p>

---

## The idea

Store screenshots are two jobs pretending to be one. There's a **creative** job (what to say, which screen sells which feature, how to phrase it in six languages) and a **production** job (frames, typography, exact pixel dimensions, no alpha channel). Design tools make you do both by hand; screenshot SaaS locks the production job behind a subscription.

storeshots-mcp splits them and gives each to whatever is best at it:

| Your AI agent decides | storeshots renders |
|---|---|
| Which screens to feature | Device frames at exact scale |
| The headline for each one | Typography, contrast, and layout |
| Idiomatic translations | Correct casing per language (Turkish `İ`, German `ß`) |
| Brand color and order | Deterministic PNGs at exact store dimensions |

Because the render path is pure and local, the same inputs always produce the same pixels — no model in the loop, nothing uploaded anywhere.

## Install

**Claude Code**

```bash
claude mcp add storeshots -- npx -y storeshots-mcp
```

**Cursor / Windsurf / Claude Desktop / Antigravity / VS Code** — add to your MCP config:

```json
{
  "mcpServers": {
    "storeshots": { "command": "npx", "args": ["-y", "storeshots-mcp"] }
  }
}
```

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.storeshots]
command = "npx"
args = ["-y", "storeshots-mcp"]
```

It's a plain stdio MCP server with zero client-specific behavior, so it works in any MCP-capable agent. No server at all? The same engine is a CLI: `npx storeshots --help`.

## Use it

Point your agent at your raw screenshots and describe the set you want:

> "Take the screenshots in `./raw-shots` and generate a full App Store and Play Store set. Brand color `#E31837`, 6 screenshots, English and Turkish."

The agent reads the screens, writes the headlines, and calls `generate_set` once per platform and language. You get back finished PNGs, already the right size, ready to upload. Ask for changes in plain language and it re-renders only what moved.

## What it produces

**5 presets, each at the exact size its store requires:**

| Preset | Store | Dimensions |
|---|---|---|
| `ios-phone` | App Store, iPhone 6.9" | 1320 × 2868 |
| `android-phone` | Google Play, phone | 1080 × 1920 |
| `ipad-13` | App Store, iPad Pro 13" | 2064 × 2752 |
| `android-tablet` | Google Play, 10" tablet | 1600 × 2560 |
| `play-feature-graphic` | Google Play feature graphic | 1024 × 500 |

**And the finishing touches that make a set look designed:**

- **Built-in device frames** — iPhone (dynamic island), Pixel-style Android (punch hole), iPad, and tablet, drawn programmatically at exact scale. Bring your own with [custom frames](#custom-frames).
- **Layout variants** — `text-top`, `text-bottom`, and `tilted`; mix them across a set so it doesn't look like one template copied six times.
- **Panoramic sets** — one gradient flowing continuously across every panel, so the row reads as a single image in the store. See [panoramas](#panoramic-sets).
- **Benefit-first headlines** — a bold verb plus a short descriptor, auto-uppercased with locale-correct special characters and contrast-aware color.
- **Showcase composer** — one wide preview image of the whole set for your repo, launch post, or client deck.

Every output is flattened to remove the alpha channel that App Store Connect rejects, and validated against its preset before it's written.

## Tools

| Tool | What it does |
|---|---|
| `list_presets` | List every preset with its store and exact dimensions |
| `compose_screenshot` | Render one screenshot (background, frame, headline, source image) |
| `generate_set` | Batch-render an ordered set for one platform + language; supports panoramas |
| `create_showcase` | Stitch generated screenshots into one preview strip |
| `validate_screenshot` | Check an image against store dimension and format rules |

Each tool returns file paths plus a structured summary, so the agent can review and iterate.

## Multi-language sets

Translation lives in the agent, not the server. Generate English once, then:

> "Now do the same set in Turkish and German."

The agent translates each headline idiomatically; storeshots renders it with correct locale casing. Files follow a predictable convention:

```
output/
  en/ios-phone/en_01.png … en_06.png
  tr/ios-phone/tr_01.png … tr_06.png
  de/android-phone/de_01.png … de_06.png
```

## Panoramic sets

Pass `panorama` to `generate_set` and the per-panel solid background becomes one horizontal gradient sliced across the whole set — so placed side by side in the store, the screenshots form a single continuous image.

```jsonc
// generate_set arguments
{
  "preset": "ios-phone",
  "background": "#27AF99",           // gradient start
  "panorama": { "to": "#1E3A8A" },   // gradient end, flowing across all panels
  "outputDir": "output/en/ios-phone",
  "items": [ /* one entry per screenshot */ ]
}
```

## Custom frames

Prefer a specific device look? Supply your own frame PNG (transparent where the screen shows through) and the pixel rectangle the screenshot fills:

```jsonc
{
  "frame": {
    "image": "./frames/iphone-16-pro.png",
    "screenX": 40, "screenY": 40,
    "screenWidth": 1080, "screenHeight": 2280
  }
}
```

Works on `compose_screenshot` and as a set-wide option on `generate_set`; omit it to use the built-in frames.

## Claude Code skill (optional)

The tools work on their own, but the bundled skill adds a guided workflow — benefit discovery from your codebase, headline approval before rendering, per-language sets, and upload guidance:

```bash
mkdir -p ~/.claude/skills/storeshots
curl -o ~/.claude/skills/storeshots/SKILL.md \
  https://raw.githubusercontent.com/mtbun/storeshots-mcp/main/skill/SKILL.md
```

Then ask Claude Code for "store screenshots for this app" and it walks the whole flow.

## Design principles

1. **Deterministic** — no AI image generation in the render path; same input, same pixels.
2. **Zero config** — no API keys, no accounts, fully offline.
3. **Store-correct by construction** — dimensions are enforced and validated, not suggested.
4. **Agent-native** — tools expose structured data; the copywriting stays in the model where it belongs.

## Roadmap

- [x] Claude Code skill with a guided benefit-discovery workflow
- [x] Play Store feature graphic preset (1024 × 500)
- [x] Layout variants — text-top, text-bottom, tilted
- [x] Custom device frames
- [x] Panoramic sets
- [ ] App preview video frames
- [ ] More stores (Mac App Store, Chrome Web Store)

## Contributing

Issues and PRs welcome. [AGENTS.md](AGENTS.md) documents the architecture and conventions, for human contributors and coding agents alike.

## License

[MIT](LICENSE)
