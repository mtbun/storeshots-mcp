import sharp from "sharp";
import { normalizeHex } from "../util.js";

/**
 * Builds one continuous horizontal gradient spanning a whole set, then cuts it
 * into `count` equal panels. Placed side by side in the store, the panels read
 * as a single flowing background instead of `count` separate tiles.
 *
 * Returns one PNG buffer per panel, in order.
 */
export async function panoramaSlices(
  fromHex: string,
  toHex: string,
  count: number,
  panelWidth: number,
  panelHeight: number,
): Promise<Buffer[]> {
  const from = normalizeHex(fromHex);
  const to = normalizeHex(toHex);
  const fullWidth = panelWidth * count;
  const gradientSvg = `<svg width="${fullWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${fullWidth}" height="${panelHeight}" fill="url(#p)"/>
</svg>`;
  const full = await sharp(Buffer.from(gradientSvg)).png().toBuffer();

  const slices: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    slices.push(
      await sharp(full)
        .extract({ left: i * panelWidth, top: 0, width: panelWidth, height: panelHeight })
        .png()
        .toBuffer(),
    );
  }
  return slices;
}
