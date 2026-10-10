import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PRESETS } from "../presets.js";
import type { ComposeOptions, LayoutVariant } from "../render/compose.js";
import type { CustomFrame } from "../render/frame.js";
import { setFileName } from "../render/set.js";
import { formatZodIssues, frameObject, variantEnum } from "../schemas.js";
import { normalizeHex } from "../util.js";

/**
 * Project config (storeshots.json): one file describing a whole store listing
 * — every platform, every language — so `storeshots build` can render it in
 * one go and re-render only what changed.
 */

export const DEFAULT_CONFIG_FILE = "storeshots.json";
export const FEATURE_PRESET = "play-feature-graphic";
export const SHOWCASE_ITEM_HEIGHT = 1000;

const copySchema = z
  .union([
    z.object({ verb: z.string(), descriptor: z.string() }).strict(),
    z.tuple([z.string(), z.string()]),
  ])
  .describe('Headline as {"verb", "descriptor"} or ["verb", "descriptor"]');

/** A path, a path template ({lang}, {preset}, {platform}), or one per preset id (+ "default"). */
const screenshotSchema = z.union([z.string().min(1), z.record(z.string().min(1))]);

const screenSchema = z
  .object({
    screenshot: screenshotSchema,
    copy: z.record(copySchema),
    variant: variantEnum.optional(),
    background: z.string().optional(),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    background: z.string(),
    presets: z.array(z.string()).min(1).default(["ios-phone", "android-phone"]),
    languages: z.array(z.string().min(1)).min(1).optional(),
    outputDir: z.string().min(1).default("output"),
    variant: variantEnum.default("text-top"),
    noGradient: z.boolean().default(false),
    panorama: z.object({ to: z.string() }).strict().optional(),
    frame: z.union([frameObject.strict(), z.record(frameObject.strict())]).optional(),
    screens: z.array(screenSchema).min(1).max(10),
    featureGraphic: z
      .object({
        screen: z.number().int().min(1).optional(),
        screenshot: screenshotSchema.optional(),
        copy: z.record(copySchema).optional(),
        background: z.string().optional(),
      })
      .strict()
      .optional(),
    showcase: z.boolean().default(false),
  })
  .strict();

export type ProjectConfig = z.infer<typeof configSchema>;
type Copy = z.infer<typeof copySchema>;
type ScreenshotSpec = z.infer<typeof screenshotSchema>;

/** Config problems: every issue is collected so the user can fix them in one pass. */
export class ConfigError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`${file} has ${issues.length} problem${issues.length === 1 ? "" : "s"}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export interface PlannedImage {
  kind: "screen" | "feature";
  /** Path relative to the output dir, always with forward slashes. */
  file: string;
  output: string;
  lang: string;
  preset: string;
  /** 1-based screen number; 0 for the feature graphic. */
  index: number;
  compose: Omit<ComposeOptions, "backgroundImage">;
  /** Present when this panel is one slice of a panoramic gradient. */
  panorama?: { from: string; to: string; count: number; index: number };
}

export interface PlannedShowcase {
  file: string;
  output: string;
  lang: string;
  preset: string;
  /** Files (relative to the output dir) of the images in the strip, in order. */
  inputs: string[];
  itemHeight: number;
}

export interface Plan {
  configPath: string;
  outputDir: string;
  languages: string[];
  presets: string[];
  images: PlannedImage[];
  showcases: PlannedShowcase[];
  /** Every input file the plan reads: screenshots and frames. */
  inputs: string[];
  /** True when the plan covers the whole config (no --lang/--preset filter). */
  complete: boolean;
}

export interface PlanFilter {
  langs?: string[];
  presets?: string[];
}

export function readConfig(configPath: string): ProjectConfig {
  if (!existsSync(configPath)) {
    throw new ConfigError(configPath, [
      `Config file not found. Create one with "storeshots init" or pass --config <file>.`,
    ]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new ConfigError(configPath, [`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(configPath, formatZodIssues(parsed.error));
  return parsed.data;
}

/** Loads and validates a config, then expands it into concrete render jobs. */
export function loadPlan(configPath: string, filter: PlanFilter = {}): Plan {
  const absConfig = path.resolve(configPath);
  return planFromConfig(readConfig(absConfig), absConfig, filter);
}

export function planFromConfig(config: ProjectConfig, configPath: string, filter: PlanFilter = {}): Plan {
  const issues: string[] = [];
  const baseDir = path.dirname(configPath);
  const resolveIn = (p: string) => path.resolve(baseDir, p);

  const hex = (value: string, where: string): string => {
    try {
      return normalizeHex(value);
    } catch (err) {
      issues.push(`${where}: ${(err as Error).message}`);
      return "#000000";
    }
  };

  const background = hex(config.background, "background");
  const panoramaTo = config.panorama ? hex(config.panorama.to, "panorama.to") : undefined;

  // Presets
  const presets: string[] = [];
  for (const [i, id] of config.presets.entries()) {
    if (id === FEATURE_PRESET) {
      issues.push(
        `presets[${i}]: "${FEATURE_PRESET}" is a single header image, not a set. Remove it from "presets" and add a "featureGraphic" section instead.`,
      );
    } else if (!PRESETS[id]) {
      issues.push(`presets[${i}]: unknown preset "${id}". Valid presets: ${portraitPresets().join(", ")}`);
    } else if (!presets.includes(id)) {
      presets.push(id);
    }
  }

  // Languages: explicit, or inferred from the first screen's copy.
  const languages = config.languages ?? Object.keys(config.screens[0].copy);
  if (languages.length === 0) {
    issues.push(`screens[0].copy: add at least one language, e.g. {"en": ["Track", "your daily mood"]}`);
  }

  const copyFor = (copies: Record<string, Copy>, lang: string, where: string) => {
    const c = copies[lang];
    if (!c) {
      issues.push(`${where}.copy.${lang}: missing. Every screen needs copy for each language (${languages.join(", ")}).`);
      return null;
    }
    const [verb, descriptor] = Array.isArray(c) ? c : [c.verb, c.descriptor];
    if (!verb.trim() || !descriptor.trim()) {
      issues.push(`${where}.copy.${lang}: verb and descriptor must both be non-empty.`);
      return null;
    }
    if (/\bTODO\b/i.test(verb) || /\bTODO\b/i.test(descriptor)) {
      issues.push(`${where}.copy.${lang}: still has a TODO placeholder; write the real headline.`);
      return null;
    }
    return { verb, descriptor };
  };

  // Frames: one for every preset, or one per preset id.
  const frames: Record<string, CustomFrame> = {};
  if (config.frame) {
    if ("image" in config.frame && typeof config.frame.image === "string") {
      const f = config.frame as CustomFrame;
      for (const id of presets) frames[id] = { ...f, image: resolveIn(f.image) };
    } else {
      for (const [id, f] of Object.entries(config.frame as Record<string, CustomFrame>)) {
        if (!PRESETS[id]) issues.push(`frame.${id}: unknown preset id. Key frames by preset, e.g. "ios-phone".`);
        frames[id] = { ...f, image: resolveIn(f.image) };
      }
    }
  }

  const inputs = new Set<string>();
  const missing = new Set<string>();
  const screenshotFor = (spec: ScreenshotSpec, lang: string, preset: string, where: string): string => {
    let template: string | undefined;
    if (typeof spec === "string") {
      template = spec;
    } else {
      template = spec[preset] ?? spec.default;
      if (!template) {
        issues.push(`${where}.screenshot: no entry for "${preset}" and no "default".`);
        return "";
      }
    }
    const platform = PRESETS[preset]?.store === "app-store" ? "ios" : "android";
    const file = resolveIn(
      template.replaceAll("{lang}", lang).replaceAll("{preset}", preset).replaceAll("{platform}", platform),
    );
    inputs.add(file);
    if (!existsSync(file)) missing.add(`${where}.screenshot: file not found: ${path.relative(baseDir, file) || file}`);
    return file;
  };

  if (config.screens.some((s) => s.background) && config.panorama) {
    issues.push(`screens[].background cannot be combined with "panorama"; the panorama sets every panel's background.`);
  }

  // Filters
  const langFilter = filter.langs?.length ? filter.langs : undefined;
  const presetFilter = filter.presets?.length ? filter.presets : undefined;
  for (const l of langFilter ?? []) {
    if (!languages.includes(l)) issues.push(`--lang ${l}: not in this config's languages (${languages.join(", ")}).`);
  }
  const knownTargets = config.featureGraphic ? [...presets, FEATURE_PRESET] : presets;
  for (const p of presetFilter ?? []) {
    if (!knownTargets.includes(p)) issues.push(`--preset ${p}: not in this config (${knownTargets.join(", ")}).`);
  }
  const wantLang = (l: string) => !langFilter || langFilter.includes(l);
  const wantPreset = (p: string) => !presetFilter || presetFilter.includes(p);

  const outputDir = resolveIn(config.outputDir);
  const images: PlannedImage[] = [];
  const showcases: PlannedShowcase[] = [];
  const count = config.screens.length;

  for (const lang of languages) {
    for (const preset of presets) {
      const setFiles: string[] = [];
      for (const [i, screen] of config.screens.entries()) {
        const where = `screens[${i}]`;
        const copy = copyFor(screen.copy, lang, where);
        const screenshot = screenshotFor(screen.screenshot, lang, preset, where);
        const bg = screen.background ? hex(screen.background, `${where}.background`) : background;
        const file = `${lang}/${preset}/${setFileName(lang, i)}`;
        setFiles.push(file);
        if (!copy || !wantLang(lang) || !wantPreset(preset)) continue;
        images.push({
          kind: "screen",
          file,
          output: path.join(outputDir, file),
          lang,
          preset,
          index: i + 1,
          compose: {
            preset,
            background: bg,
            verb: copy.verb,
            descriptor: copy.descriptor,
            screenshot,
            output: path.join(outputDir, file),
            lang,
            variant: (screen.variant ?? config.variant) as LayoutVariant,
            frame: frames[preset],
            noGradient: config.noGradient,
          },
          panorama: panoramaTo ? { from: background, to: panoramaTo, count, index: i } : undefined,
        });
      }
      if (config.showcase && wantLang(lang) && wantPreset(preset)) {
        const file = `showcase/${lang}_${preset}.png`;
        showcases.push({
          file,
          output: path.join(outputDir, file),
          lang,
          preset,
          inputs: setFiles,
          itemHeight: SHOWCASE_ITEM_HEIGHT,
        });
      }
    }
  }

  const fg = config.featureGraphic;
  if (fg) {
    const where = "featureGraphic";
    let source: z.infer<typeof screenSchema> | undefined;
    if (fg.screen !== undefined) {
      source = config.screens[fg.screen - 1];
      if (!source) issues.push(`${where}.screen: there is no screen ${fg.screen} (have ${count}).`);
    }
    const spec = fg.screenshot ?? source?.screenshot;
    const copies = fg.copy ?? source?.copy;
    if (!spec || !copies) {
      issues.push(`${where}: set "screen" (reuse a screen's screenshot and copy) or both "screenshot" and "copy".`);
    } else {
      // The feature graphic shows an Android phone, so prefer Android-side screenshots.
      const shotPreset = typeof spec === "string" || spec[FEATURE_PRESET] ? FEATURE_PRESET : "android-phone";
      for (const lang of languages) {
        const copy = copyFor(copies, lang, where);
        const screenshot = screenshotFor(spec, lang, shotPreset, where);
        if (!copy || !wantLang(lang) || !wantPreset(FEATURE_PRESET)) continue;
        const file = `${lang}/${FEATURE_PRESET}/${lang}_feature.png`;
        images.push({
          kind: "feature",
          file,
          output: path.join(outputDir, file),
          lang,
          preset: FEATURE_PRESET,
          index: 0,
          compose: {
            preset: FEATURE_PRESET,
            background: fg.background ? hex(fg.background, `${where}.background`) : background,
            verb: copy.verb,
            descriptor: copy.descriptor,
            screenshot,
            output: path.join(outputDir, file),
            lang,
            frame: frames[FEATURE_PRESET],
            noGradient: config.noGradient,
          },
        });
      }
    }
  }

  for (const f of Object.values(frames)) {
    inputs.add(f.image);
    if (!existsSync(f.image)) missing.add(`frame: file not found: ${path.relative(baseDir, f.image)}`);
  }

  issues.push(...missing);
  if (issues.length > 0) throw new ConfigError(configPath, [...new Set(issues)]);

  return {
    configPath,
    outputDir,
    languages: languages.filter(wantLang),
    presets: presets.filter(wantPreset),
    images,
    showcases,
    inputs: [...inputs],
    complete: !langFilter && !presetFilter,
  };
}

function portraitPresets(): string[] {
  return Object.values(PRESETS)
    .filter((p) => p.layout === "portrait")
    .map((p) => p.id);
}
