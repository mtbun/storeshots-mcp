---
name: storeshots
description: Guided workflow for generating App Store and Google Play marketing screenshots with the storeshots-mcp tools. Use when the user wants store screenshots, app listing visuals, ASO screenshot sets, or a Play Store feature graphic.
---

# storeshots — guided store screenshot workflow

Produce a complete, consistent set of store-ready marketing screenshots for an app, using the storeshots rendering tools. You do the thinking (benefits, copy, translation); the tools do the pixels.

## Tooling check

Prefer the MCP tools if the `storeshots` MCP server is connected (`list_presets`, `compose_screenshot`, `generate_set`, `create_showcase`, `validate_screenshot`). If not connected, use the CLI instead: `npx -y --package=storeshots-mcp storeshots <command>` (run `storeshots help` for usage). Every step below maps 1:1 to either surface.

## Phase 1 — Configuration

Ask the user, as a short checklist:

1. **Platforms**: which presets? Offer ios-phone, android-phone, ipad-13, android-tablet, play-feature-graphic. Default: ios-phone + android-phone.
2. **Count**: how many screenshots per platform? Default 6, max 10.
3. **Language(s)**: default English first, then translate. Note the BCP-47 codes; they control locale-correct uppercasing.
4. **Brand color**: 6-digit hex. If a codebase is available, look for the primary/theme color and propose it instead of asking cold.
5. **Screenshots source**: existing image files (collect paths), or guide the user through capturing simulator/emulator screenshots first.

## Phase 2 — Benefit discovery

Identify one benefit per screenshot. If a codebase is available, read it and propose benefits for visually demonstrable features. Otherwise ask the user to describe the app and refine together.

Rules:
- Each headline is a **verb** (1-2 bold action words) plus a **descriptor** (2-5 words on what the user gains).
- Never feature paywall, subscription, checkout, or purchase-confirmation screens.
- Prefer screens with real-looking content over empty states.

Present the list as a table (order, verb, descriptor, planned screenshot) and iterate until the user approves. Do not render anything before approval.

## Phase 3 — Render

For each platform, call `generate_set` with the approved items in order (or one `compose_screenshot`/CLI `compose` per item). Use the same brand color and item order across platforms so the sets match. Pass the language code via `lang`; supply headline text in natural case and let the tool handle uppercasing (Turkish İ, German umlauts, etc. are locale-aware).

For `play-feature-graphic`, render exactly one image using the single strongest benefit; it is the Play listing header, not part of the numbered set.

After rendering, run `validate_screenshot` on each output and show the user the results plus the images. Fix any warnings (headline too long, unexpected overwrite) before continuing.

## Phase 4 — Review and deliver

1. Build a preview with `create_showcase` from the final set and show it.
2. Summarize outputs: paths, dimensions, per-platform counts.
3. Upload guidance:
   - **App Store Connect**: app page > distribution > screenshots; iPhone 6.9" display accepts the ios-phone files, iPad Pro 13" accepts ipad-13.
   - **Google Play Console**: Store presence > main store listing; phone screenshots take android-phone files, tablet takes android-tablet, feature graphic takes play-feature-graphic.

## Phase 5 — Additional languages (optional)

For each extra language: translate the approved verbs and descriptors idiomatically yourself (compelling marketing copy, not word-for-word), then re-run Phase 3 with the translated text, the new `lang` code, and an output directory per language (`output/<lang>/<preset>/`). Keep the same screenshots, order, and brand color. Show a per-language spot check to the user.
