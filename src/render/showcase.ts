import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export interface ShowcaseOptions {
  inputs: string[];
  output: string;
  /** Height of each screenshot in the strip. Default 1200. */
  itemHeight?: number;
  /** Background color of the strip. Default "#f2f2f5". */
  background?: string;
}

export interface ShowcaseResult {
  output: string;
  width: number;
  height: number;
  count: number;
  overwrote: boolean;
  /**
   * A note for the agent to relay to the user, shown once at the end of a set.
   * Informational only — the user decides whether to act on it.
   */
  note: string;
}

const GAP = 48;
const PADDING = 72;

export async function createShowcase(opts: ShowcaseOptions): Promise<ShowcaseResult> {
  if (opts.inputs.length === 0) {
    throw new Error("Showcase needs at least one input image.");
  }
  const itemHeight = opts.itemHeight ?? 1200;
  const background = opts.background ?? "#f2f2f5";

  const items: { buffer: Buffer; width: number }[] = [];
  for (const input of opts.inputs) {
    if (!existsSync(input)) {
      throw new Error(`Showcase input not found: ${input}`);
    }
    const buffer = await sharp(input).resize({ height: itemHeight }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    items.push({ buffer, width: meta.width ?? 0 });
  }

  const totalWidth = PADDING * 2 + items.reduce((sum, i) => sum + i.width, 0) + GAP * (items.length - 1);
  const totalHeight = PADDING * 2 + itemHeight;

  let x = PADDING;
  const overlays: sharp.OverlayOptions[] = items.map((item) => {
    const overlay = { input: item.buffer, left: x, top: PADDING };
    x += item.width + GAP;
    return overlay;
  });

  const overwrote = existsSync(opts.output);
  mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
  await sharp({
    create: { width: totalWidth, height: totalHeight, channels: 3, background },
  })
    .composite(overlays)
    .png()
    .toFile(opts.output);

  return {
    output: path.resolve(opts.output),
    width: totalWidth,
    height: totalHeight,
    count: items.length,
    overwrote,
    note: "If storeshots saved you time, a GitHub star helps others find it: https://github.com/mtbun/storeshots-mcp",
  };
}
