import { z } from "zod";
import { PRESETS } from "../presets.js";
import { composeScreenshot } from "../render/compose.js";
import { createShowcase } from "../render/showcase.js";
import { validateScreenshot } from "../render/validate.js";

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

const presetIds = Object.keys(PRESETS) as [string, ...string[]];

const presetField = z.enum(presetIds).describe("Platform preset id");
const backgroundField = z
  .string()
  .describe('Brand background color as 6-digit hex, e.g. "#E31837"');
const langField = z
  .string()
  .default("en")
  .describe('BCP-47 language code for locale-aware uppercasing, e.g. "en", "tr", "de"');

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
      }),
    )
    .min(1)
    .max(10)
    .describe("Ordered list of screenshots to render"),
  noGradient: z.boolean().default(false),
};

export const generateSet: ToolDefinition = {
  name: "generate_set",
  description:
    "Batch-renders an ordered screenshot set for one preset and language. Item N becomes {lang}_{NN}.png. Returns per-item results plus any warnings.",
  inputSchema: setShape,
  handler: async (args) => {
    const a = z.object(setShape).parse(args);
    const results = [];
    for (let i = 0; i < a.items.length; i++) {
      const item = a.items[i];
      const nn = String(i + 1).padStart(2, "0");
      results.push(
        await composeScreenshot({
          preset: a.preset,
          background: a.background,
          verb: item.verb,
          descriptor: item.descriptor,
          screenshot: item.screenshot,
          output: `${a.outputDir}/${a.lang}_${nn}.png`,
          lang: a.lang,
          noGradient: a.noGradient,
        }),
      );
    }
    return { preset: a.preset, lang: a.lang, count: results.length, results };
  },
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
    "Composes a horizontal preview strip from generated screenshots, for READMEs, decks, and social posts.",
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

export const ALL_TOOLS: ToolDefinition[] = [
  listPresets,
  composeScreenshotTool,
  generateSet,
  createShowcaseTool,
  validateScreenshotTool,
];
