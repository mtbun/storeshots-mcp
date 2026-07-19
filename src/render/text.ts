import sharp from "sharp";
import { FONT_FAMILY, FONT_FILE, assertFontAvailable, escapePango } from "../util.js";

export interface RenderedText {
  buffer: Buffer;
  width: number;
  height: number;
  fontPx: number;
}

/**
 * Renders a single line of text with the bundled font via Pango.
 * Starts at `fontPx` and shrinks until the line fits within `maxWidth`,
 * so output is deterministic for a given input.
 */
export async function renderLine(
  text: string,
  fontPx: number,
  color: string,
  maxWidth: number,
): Promise<RenderedText> {
  assertFontAvailable();
  let size = fontPx;
  for (let attempt = 0; attempt < 4; attempt++) {
    const markup = `<span foreground="${color}">${escapePango(text)}</span>`;
    const image = sharp({
      text: {
        text: markup,
        font: `${FONT_FAMILY} ${size}`,
        fontfile: FONT_FILE,
        rgba: true,
        dpi: 72,
      },
    });
    const buffer = await image.png().toBuffer();
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= maxWidth || size <= 12) {
      return { buffer, width, height, fontPx: size };
    }
    size = Math.max(12, Math.floor((size * maxWidth) / width));
  }
  throw new Error(`Could not fit text "${text}" within ${maxWidth}px.`);
}
