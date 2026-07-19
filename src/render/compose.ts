import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getPreset } from "../presets.js";
import { normalizeHex, textColorFor, toUpper } from "../util.js";
import { renderDevice } from "./frame.js";
import { renderLine } from "./text.js";

export interface ComposeOptions {
  preset: string;
  background: string;
  verb: string;
  descriptor: string;
  screenshot: string;
  output: string;
  /** BCP-47 language code used for locale-aware uppercasing. Default "en". */
  lang?: string;
  /** Disables the subtle vertical gradient overlay. */
  noGradient?: boolean;
}

export interface ComposeResult {
  output: string;
  width: number;
  height: number;
  preset: string;
  headline: string;
  textColor: string;
  overwrote: boolean;
  warnings: string[];
}

const MIN_TEXT_DEVICE_GAP = 40;

export async function composeScreenshot(opts: ComposeOptions): Promise<ComposeResult> {
  const preset = getPreset(opts.preset);
  const bg = normalizeHex(opts.background);
  const lang = opts.lang ?? "en";
  const warnings: string[] = [];

  const verb = toUpper(opts.verb.trim(), lang);
  const descriptor = toUpper(opts.descriptor.trim(), lang);
  if (!verb || !descriptor) {
    throw new Error("Both verb and descriptor are required and must be non-empty.");
  }

  const color = textColorFor(bg);
  const maxTextWidth = Math.round(preset.width * preset.textMaxWidthRatio);
  const verbLine = await renderLine(verb, preset.verbFontPx, color, maxTextWidth);
  const descLine = await renderLine(descriptor, preset.descFontPx, color, maxTextWidth);

  const device = await renderDevice(preset, opts.screenshot);

  const lineGap = Math.round(preset.descFontPx * 0.4);
  const deviceTop = Math.round(preset.height * preset.deviceTopRatio);

  let verbLeft: number;
  let descLeft: number;
  let textTop: number;
  let deviceLeft: number;
  if (preset.layout === "landscape") {
    // Feature graphic: left-aligned headline vertically centered, device right.
    const marginX = Math.round(preset.width * 0.07);
    const blockH = verbLine.height + lineGap + descLine.height;
    textTop = Math.round((preset.height - blockH) / 2);
    verbLeft = marginX;
    descLeft = marginX;
    deviceLeft = Math.round(preset.width * (preset.deviceLeftRatio ?? 0.64));
  } else {
    textTop = Math.round(preset.height * preset.textTopRatio);
    verbLeft = Math.round((preset.width - verbLine.width) / 2);
    descLeft = Math.round((preset.width - descLine.width) / 2);
    deviceLeft = Math.round((preset.width - device.width) / 2);
    const textBottom = textTop + verbLine.height + lineGap + descLine.height;
    if (deviceTop - textBottom < MIN_TEXT_DEVICE_GAP) {
      warnings.push(
        `Headline block ends ${deviceTop - textBottom}px above the device; ` +
          `minimum is ${MIN_TEXT_DEVICE_GAP}px. Consider a shorter headline.`,
      );
    }
  }
  const descTop = textTop + verbLine.height + lineGap;

  const overlays: sharp.OverlayOptions[] = [];
  if (!opts.noGradient) {
    const gradientSvg = `<svg width="${preset.width}" height="${preset.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
  </defs>
  <rect width="${preset.width}" height="${preset.height}" fill="url(#g)"/>
</svg>`;
    overlays.push({ input: Buffer.from(gradientSvg), left: 0, top: 0 });
  }
  // The device intentionally bleeds off the canvas edge; sharp rejects overlays
  // larger than the base, so crop it to the visible region first.
  let deviceBuffer = device.buffer;
  const visibleW = Math.min(device.width, preset.width - deviceLeft);
  const visibleH = Math.min(device.height, preset.height - deviceTop);
  if (visibleW < device.width || visibleH < device.height) {
    deviceBuffer = await sharp(device.buffer)
      .extract({ left: 0, top: 0, width: visibleW, height: visibleH })
      .png()
      .toBuffer();
  }

  overlays.push(
    { input: verbLine.buffer, left: verbLeft, top: textTop },
    { input: descLine.buffer, left: descLeft, top: descTop },
    { input: deviceBuffer, left: deviceLeft, top: deviceTop },
  );

  const overwrote = existsSync(opts.output);
  mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });

  // Two passes: sharp applies composite at the end of its pipeline, so alpha
  // removal must happen in a second pass. Stores reject alpha channels.
  const composed = await sharp({
    create: { width: preset.width, height: preset.height, channels: 4, background: bg },
  })
    .composite(overlays)
    .png()
    .toBuffer();
  await sharp(composed).removeAlpha().png().toFile(opts.output);

  if (overwrote) {
    warnings.push(`Overwrote existing file: ${opts.output}`);
  }
  return {
    output: path.resolve(opts.output),
    width: preset.width,
    height: preset.height,
    preset: preset.id,
    headline: `${verb} ${descriptor}`,
    textColor: color,
    overwrote,
    warnings,
  };
}
