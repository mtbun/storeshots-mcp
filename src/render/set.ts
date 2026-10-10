import path from "node:path";
import { getPreset } from "../presets.js";
import { type ComposeResult, type LayoutVariant, composeScreenshot } from "./compose.js";
import type { CustomFrame } from "./frame.js";
import { panoramaSlices } from "./panorama.js";

export interface SetItem {
  verb: string;
  descriptor: string;
  screenshot: string;
  /** Per-item variant; falls back to the set-level variant. */
  variant?: LayoutVariant;
}

export interface SetOptions {
  preset: string;
  background: string;
  lang?: string;
  outputDir: string;
  items: SetItem[];
  variant?: LayoutVariant;
  frame?: CustomFrame;
  /** End color of a gradient that flows across every panel of the set. */
  panorama?: { to: string };
  noGradient?: boolean;
}

export interface SetResult {
  preset: string;
  lang: string;
  count: number;
  panorama: boolean;
  results: ComposeResult[];
}

/** File name of item `index` (0-based) in a set: "{lang}_{NN}.png". */
export function setFileName(lang: string, index: number): string {
  return `${lang}_${String(index + 1).padStart(2, "0")}.png`;
}

/** Renders an ordered set for one preset and language. */
export async function generateSet(opts: SetOptions): Promise<SetResult> {
  const preset = getPreset(opts.preset);
  const lang = opts.lang ?? "en";
  // Panorama: pre-render one gradient sliced across every panel.
  const slices = opts.panorama
    ? await panoramaSlices(opts.background, opts.panorama.to, opts.items.length, preset.width, preset.height)
    : null;
  const results: ComposeResult[] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const item = opts.items[i];
    results.push(
      await composeScreenshot({
        preset: opts.preset,
        background: opts.background,
        verb: item.verb,
        descriptor: item.descriptor,
        screenshot: item.screenshot,
        output: path.join(opts.outputDir, setFileName(lang, i)),
        lang,
        variant: item.variant ?? opts.variant,
        frame: opts.frame,
        backgroundImage: slices ? slices[i] : undefined,
        noGradient: opts.noGradient,
      }),
    );
  }
  return { preset: preset.id, lang, count: results.length, panorama: Boolean(opts.panorama), results };
}
