import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

export function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "storeshots-test-"));
}

/** Generates a fake app screenshot: solid color with a lighter header band. */
export async function fakeScreenshot(dir: string, width = 1320, height = 2868): Promise<string> {
  const file = path.join(dir, `raw-${width}x${height}.png`);
  const headerSvg = `<svg width="${width}" height="${Math.round(height * 0.15)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${Math.round(height * 0.15)}" fill="#ffffff" opacity="0.9"/>
</svg>`;
  await sharp({
    create: { width, height, channels: 3, background: "#2b6cb0" },
  })
    .composite([{ input: Buffer.from(headerSvg), top: 0, left: 0 }])
    .png()
    .toFile(file);
  return file;
}
