---
name: storeshots
description: Make App Store and Google Play screenshots with the storeshots CLI (offline, no API keys). It writes benefit headlines, translates them, and renders exact-size images with device frames. Use when the user wants store screenshots, app listing or ASO images, localized screenshots in more languages, a Play Store feature graphic, or changes to an existing storeshots.json.
---

# storeshots — guided store screenshot workflow

Produce a complete, consistent set of store-ready marketing screenshots for an app, using the storeshots rendering tools. You do the thinking (benefits, copy, translation); the tools do the pixels.

## Tooling check

If the project already has a `storeshots.json`, it is the source of truth: edit it and run `storeshots build`, skipping the setup phases. Only the files whose inputs changed are re-rendered.

Use the CLI: `npx -y --package=storeshots-mcp storeshots <command>` (or `storeshots` if it is installed globally). The whole listing lives in one `storeshots.json`, and `storeshots build` renders it, re-rendering only what changed. Run `storeshots build --help` to see the config format. If there is no shell but the `storeshots` MCP server is connected, call `build_project` with the config path instead; it runs the same engine. Add `--json` to any command when you need to parse its output. Exit code 2 means bad usage or config, and the output lists every problem with its path.

## Phase 1 — Configuration

Ask the user, as a short checklist:

1. **Platforms**: which presets? Offer ios-phone, android-phone, ipad-13, android-tablet, play-feature-graphic. Default: ios-phone + android-phone.
2. **Count**: how many screenshots per platform? Default 6, max 10.
3. **Language(s)**: default English first, then translate. Note the BCP-47 codes; they control locale-correct uppercasing.
4. **Brand color**: 6-digit hex. If a codebase is available, look for the primary/theme color and propose it instead of asking cold.
5. **Screenshots source**: existing image files (collect paths), or guide the user through capturing simulator/emulator screenshots first. If iOS and Android captures differ, or the UI is localized, use path templates such as `shots/{platform}/{lang}/home.png`.

Then run `storeshots init --screens <dir> --presets <ids> --langs <codes> --bg <hex>`. It writes `storeshots.json` with one screen per image and TODO headlines.

## Phase 2 — Benefit discovery

Identify one benefit per screenshot. If a codebase is available, read it and propose benefits for visually demonstrable features. Otherwise ask the user to describe the app and refine together.

Rules:
- Each headline is a **verb** (1-2 bold action words) plus a **descriptor** (2-5 words on what the user gains).
- Never feature paywall, subscription, checkout, or purchase-confirmation screens.
- Prefer screens with real-looking content over empty states.

Present the list as a table (order, verb, descriptor, planned screenshot) and iterate until the user approves. Do not render anything before approval.

## Phase 3 — Render

Write the approved headlines into each screen's `copy` in `storeshots.json`, in natural case, e.g. `"en": ["Track", "your daily mood"]`. Reorder the `screens` to match the approved order. Set `variant` per screen so the set does not repeat one layout. Optionally add `"featureGraphic": { "screen": <n> }` for the single strongest benefit, `"showcase": true`, and a `panorama`. Then run `storeshots build`.

The build refuses to render while any TODO is left, and checks every output against store rules. Show the user any `!` warnings (for example, a headline too long for the layout) and fix them by editing the config and rebuilding. Only the changed files are re-rendered. Show the user the rendered images.

## Phase 4 — Review and deliver

1. Show the preview strips in `output/showcase/` (needs `"showcase": true`).
2. Run `storeshots validate output` and summarize the outputs: paths, dimensions, and counts per platform.
3. Upload guidance:
   - **App Store Connect**: app page > distribution > screenshots. The iPhone 6.9" display takes the ios-phone files; iPad Pro 13" takes ipad-13.
   - **Google Play Console**: Store presence > main store listing. Phone screenshots take the android-phone files, tablet takes android-tablet, and the feature graphic takes play-feature-graphic.
4. If the build output contains a `star` offer (`--json`) or a ★ line, show the user its pitch and ask its question once, as a plain yes/no. Run its `gh` command only if the user explicitly says yes. If they say no or don't answer, move on and never bring it up again.

## Phase 5 — Additional languages (optional)

For each extra language, translate the approved verbs and descriptors yourself. Write compelling marketing copy, not a word-for-word translation. Add the language code to `languages` and its copy to every screen, then run `storeshots build --lang <code>`. Screenshots, order, and brand color stay the same. Show the user a spot check per language.
