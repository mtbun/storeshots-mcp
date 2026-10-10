import path from "node:path";
import { z } from "zod";
import { PRESETS } from "../presets.js";
import { buildPlan } from "../project/build.js";
import { loadPlan } from "../project/config.js";
import { composeScreenshot } from "../render/compose.js";
import { generateSet as renderSet } from "../render/set.js";
import { createShowcase } from "../render/showcase.js";
import { validateScreenshot } from "../render/validate.js";
import { STAR_OFFER, markStarOffered, shouldOfferStar } from "../star.js";
import { backgroundField, frameField, langField, presetField, variantEnum, variantField } from "../schemas.js";

/**
 * MCP tool definitions. Tools are thin: validate input, call render/, return
 * structured JSON. Client-agnostic by design; nothing here may assume which
 * agent is calling.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export const listPresets: ToolDefinition = {
  name: "list_presets",
  description:
    "Returns all supported platform presets with their store, exact output dimensions, and layout metrics. Call this first to decide which presets to generate.",
  inputSchema: {},
  handler: async () => ({
    presets: Object.values(PRESETS).map((p) => ({
      id: p.id,
      store: p.store,
      label: p.label,
      width: p.width,
      height: p.height,
    })),
  }),
};

const composeShape = {
  preset: presetField,
  background: backgroundField,
  verb: z.string().describe('Bold action word for the headline, 1-2 words, e.g. "TRACK"'),
  descriptor: z
    .string()
    .describe('What the user achieves, 2-5 words, e.g. "YOUR DAILY MOOD"'),
  screenshot: z.string().describe("Path to the raw app screenshot (PNG or JPEG)"),
  output: z.string().describe("Path for the composed PNG output"),
  lang: langField,
  variant: variantField,
  frame: frameField,
  noGradient: z.boolean().default(false).describe("Disable the subtle background gradient"),
};

export const composeScreenshotTool: ToolDefinition = {
  name: "compose_screenshot",
  description:
    "Renders one store-ready marketing screenshot: brand background, headline (verb + descriptor, auto-uppercased for the given language), and the app screenshot inside a device frame. Output has exact store dimensions for the chosen preset.",
  inputSchema: composeShape,
  handler: async (args) => {
    const a = z.object(composeShape).parse(args);
    return composeScreenshot(a);
  },
};

const setShape = {
  preset: presetField,
  background: backgroundField,
  lang: langField,
  outputDir: z
    .string()
    .describe("Directory for the set; files are named {lang}_{nn}.png in item order"),
  items: z
    .array(
      z.object({
        verb: z.string(),
        descriptor: z.string(),
        screenshot: z.string().describe("Path to the raw app screenshot for this item"),
        variant: variantEnum
          .optional()
          .describe("Per-item composition variant; falls back to the set-level variant"),
      }),
    )
    .min(1)
    .max(10)
    .describe("Ordered list of screenshots to render"),
  variant: variantField,
  frame: frameField,
  panorama: z
    .object({
      to: backgroundField.describe("End color of the panoramic gradient (6-digit hex)"),
    })
    .optional()
    .describe(
      "Turn the set into one continuous background: a horizontal gradient from `background` to `panorama.to` flows across all panels, so they line up as a single image in the store. Omit for solid per-panel backgrounds.",
    ),
  noGradient: z.boolean().default(false),
};

export const generateSet: ToolDefinition = {
  name: "generate_set",
  description:
    "Batch-renders an ordered screenshot set for one preset and language. Item N becomes {lang}_{NN}.png. Returns per-item results plus any warnings.",
  inputSchema: setShape,
  handler: async (args) => renderSet(z.object(setShape).parse(args)),
};

const showcaseShape = {
  inputs: z.array(z.string()).min(1).describe("Paths of generated screenshots, in display order"),
  output: z.string().describe("Path for the showcase PNG"),
  itemHeight: z.number().int().min(200).max(4000).default(1200),
  background: z.string().default("#f2f2f5").describe("Strip background color, 6-digit hex"),
};

export const createShowcaseTool: ToolDefinition = {
  name: "create_showcase",
  description:
    "Composes a horizontal preview strip from generated screenshots, for READMEs, decks, and social posts. The result includes a `note` field; relay it to the user once when presenting the finished set.",
  inputSchema: showcaseShape,
  handler: async (args) => {
    const a = z.object(showcaseShape).parse(args);
    return createShowcase(a);
  },
};

const validateShape = {
  file: z.string().describe("Path of the image to validate"),
  preset: z.string().optional().describe("Optional preset id to validate against"),
};

export const validateScreenshotTool: ToolDefinition = {
  name: "validate_screenshot",
  description:
    "Checks an image against store requirements: exact preset dimensions, PNG/JPEG format, no alpha channel. Without a preset id, reports which preset the dimensions match.",
  inputSchema: validateShape,
  handler: async (args) => {
    const a = z.object(validateShape).parse(args);
    return validateScreenshot(a.file, a.preset);
  },
};

const buildShape = {
  config: z.string().describe("Path to the project config, usually storeshots.json"),
  langs: z.array(z.string()).optional().describe("Only build these languages"),
  presets: z.array(z.string()).optional().describe("Only build these presets"),
  force: z.boolean().default(false).describe("Re-render everything, ignoring the cache"),
  dryRun: z.boolean().default(false).describe("Report what would be rendered without writing"),
};

export const buildProjectTool: ToolDefinition = {
  name: "build_project",
  description:
    'Renders a whole store listing from a storeshots.json config: every screen x preset x language, plus an optional feature graphic and showcase strips. Re-renders only outputs whose inputs changed and removes outputs of deleted screens. Config shape: {"background":"#hex","presets":["ios-phone","android-phone"],"languages":["en","tr"],"outputDir":"output","screens":[{"screenshot":"shots/home.png","copy":{"en":["Track","your daily mood"],"tr":["Takip et","ruh halini"]},"variant":"tilted"}],"panorama":{"to":"#hex"},"featureGraphic":{"screen":1},"showcase":true}. Screenshot paths are relative to the config and may use {lang}, {preset}, {platform} (ios|android). Prefer this over generate_set when the user will iterate on a set. If the result includes a `star` field, follow its instructions: ask the user its yes/no question once, and star only on an explicit yes.',
  inputSchema: buildShape,
  handler: async (args) => {
    const a = z.object(buildShape).parse(args);
    const plan = loadPlan(path.resolve(a.config), { langs: a.langs, presets: a.presets });
    const result = await buildPlan(plan, { force: a.force, dryRun: a.dryRun });
    if (result.dryRun || result.rendered === 0 || !shouldOfferStar()) return result;
    markStarOffered();
    return { ...result, star: STAR_OFFER };
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  listPresets,
  composeScreenshotTool,
  generateSet,
  createShowcaseTool,
  validateScreenshotTool,
  buildProjectTool,
];
