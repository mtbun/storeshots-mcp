import { z } from "zod";
import { PRESETS } from "./presets.js";
import { LAYOUT_VARIANTS, type LayoutVariant } from "./render/compose.js";

/**
 * Zod fields shared by the MCP tools and the project config, so both surfaces
 * accept exactly the same values.
 */

export const presetIds = Object.keys(PRESETS) as [string, ...string[]];

export const presetField = z.enum(presetIds).describe("Platform preset id");

export const backgroundField = z
  .string()
  .describe('Brand background color as 6-digit hex, e.g. "#E31837"');

export const langField = z
  .string()
  .default("en")
  .describe('BCP-47 language code for locale-aware uppercasing, e.g. "en", "tr", "de"');

export const variantEnum = z.enum(LAYOUT_VARIANTS as [LayoutVariant, ...LayoutVariant[]]);

export const variantField = variantEnum
  .default("text-top")
  .describe(
    "Composition variant (portrait presets only): text-top = headline above a device that bleeds off the bottom; text-bottom = whole device visible with the headline underneath; tilted = text-top with the device rotated. Vary it across a set so the screenshots do not all look identical.",
  );

export const frameObject = z
  .object({
    image: z.string().describe("Path to a transparent PNG device frame"),
    screenX: z.number().int().describe("Left of the screen rectangle in the frame image, px"),
    screenY: z.number().int().describe("Top of the screen rectangle in the frame image, px"),
    screenWidth: z.number().int().positive().describe("Screen rectangle width in the frame image, px"),
    screenHeight: z.number().int().positive().describe("Screen rectangle height in the frame image, px"),
  });

export const frameField = frameObject
  .optional()
  .describe(
    "Custom device frame. Supply your own frame PNG and the pixel rectangle where the screenshot goes; overrides the built-in frame. Omit to use the built-in frame.",
  );

/** Turns a zod error into one "path: message" line per issue. */
export function formatZodIssues(error: z.ZodError, prefix = ""): string[] {
  return error.issues.map((issue) => {
    const where = formatPath([...issue.path]);
    // Union errors carry the useful detail in the closest-matching branch.
    if (issue.code === "invalid_union" && issue.unionErrors.length > 0) {
      const best = [...issue.unionErrors].sort((a, b) => a.issues.length - b.issues.length)[0];
      return formatZodIssues(best, prefix)[0];
    }
    return `${prefix}${where || "(root)"}: ${issue.message}`;
  });
}

export function formatPath(parts: (string | number)[]): string {
  return parts
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`))
    .join("");
}
