import { existsSync } from "node:fs";
import sharp from "sharp";
import { PRESETS } from "../presets.js";

export interface ValidationResult {
  file: string;
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  matchesPreset: string | null;
  valid: boolean;
  problems: string[];
}

/**
 * Checks an image against store screenshot requirements.
 * If `presetId` is given, validates against that preset; otherwise
 * reports which preset (if any) the dimensions match.
 */
export async function validateScreenshot(file: string, presetId?: string): Promise<ValidationResult> {
  if (!existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }
  const meta = await sharp(file).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const format = meta.format ?? "unknown";
  const hasAlpha = Boolean(meta.hasAlpha);
  const problems: string[] = [];

  const match = Object.values(PRESETS).find((p) => p.width === width && p.height === height) ?? null;

  if (presetId) {
    const preset = PRESETS[presetId];
    if (!preset) {
      throw new Error(`Unknown preset "${presetId}". Valid presets: ${Object.keys(PRESETS).join(", ")}`);
    }
    if (width !== preset.width || height !== preset.height) {
      problems.push(`Expected ${preset.width}x${preset.height} for ${presetId}, got ${width}x${height}.`);
    }
  } else if (!match) {
    problems.push(`Dimensions ${width}x${height} do not match any known store preset.`);
  }

  if (format !== "png" && format !== "jpeg") {
    problems.push(`Format "${format}" is not accepted by the stores; use PNG or JPEG.`);
  }
  if (hasAlpha) {
    problems.push("Image has an alpha channel; App Store Connect rejects transparency. Flatten it.");
  }

  return {
    file,
    width,
    height,
    format,
    hasAlpha,
    matchesPreset: match?.id ?? null,
    valid: problems.length === 0,
    problems,
  };
}
