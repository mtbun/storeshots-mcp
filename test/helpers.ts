import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** Writes a solid-color raw screenshot at `file` (dirs created). */
export async function solidScreenshot(file: string, color: string, width = 1080, height = 2340): Promise<string> {
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: color } }).png().toFile(file);
  return file;
}

/** A project dir with three raw screenshots and a storeshots.json built from `config`. */
export async function makeProject(config: Record<string, unknown> = {}): Promise<string> {
  const dir = tempDir();
  await solidScreenshot(path.join(dir, "shots", "home.png"), "#2b6cb0");
  await solidScreenshot(path.join(dir, "shots", "stats.png"), "#e5484d");
  await solidScreenshot(path.join(dir, "shots", "plan.png"), "#30a46c");
  writeConfig(dir, { ...baseConfig(), ...config });
  return dir;
}

export function baseConfig(): Record<string, unknown> {
  return {
    background: "#E31837",
    presets: ["android-phone"],
    screens: [
      { screenshot: "shots/home.png", copy: { en: ["Track", "your daily mood"], tr: ["İzle", "günlük ruh halini"] } },
      { screenshot: "shots/stats.png", copy: { en: { verb: "Discover", descriptor: "weekly insights" }, tr: ["Keşfet", "haftalık içgörüler"] } },
      { screenshot: "shots/plan.png", copy: { en: ["Plan", "your best week"], tr: ["Planla", "en iyi haftanı"] } },
    ],
  };
}

export function writeConfig(dir: string, config: unknown, name = "storeshots.json"): string {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

export function readJson<T = Record<string, unknown>>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
