import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (one level above dist/). */
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FONT_DIR = path.join(PKG_ROOT, "assets", "fonts");
export const FONT_FILE = path.join(FONT_DIR, "ArchivoBlack-Regular.ttf");
export const FONT_FAMILY = "Archivo Black";

let fontconfigReady = false;

/**
 * Points fontconfig at the bundled font directory via a generated fonts.conf.
 * Without this, libvips/pango silently falls back to a system font (or fails
 * outright on machines without a fontconfig setup), which would make output
 * depend on the host. Must run before the first text render in the process.
 */
export function ensureFontconfig(): void {
  if (fontconfigReady) return;
  if (!process.env.STORESHOTS_KEEP_FONTCONFIG) {
    const confDir = path.join(os.tmpdir(), "storeshots-fontconfig");
    const cacheDir = path.join(confDir, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const confFile = path.join(confDir, "fonts.conf");
    writeFileSync(
      confFile,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`,
    );
    process.env.FONTCONFIG_FILE = confFile;
  }
  fontconfigReady = true;
}

export function assertFontAvailable(): void {
  if (!existsSync(FONT_FILE)) {
    throw new Error(`Bundled font not found at ${FONT_FILE}. The package is corrupted; reinstall storeshots-mcp.`);
  }
  ensureFontconfig();
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Normalizes a hex color to "#rrggbb". Throws with an actionable message on bad input. */
export function normalizeHex(input: string): string {
  const m = HEX_RE.exec(input.trim());
  if (!m) {
    throw new Error(`Invalid hex color "${input}". Use a 6-digit hex color like "#E31837".`);
  }
  return `#${m[1].toLowerCase()}`;
}

/** WCAG relative luminance of a "#rrggbb" color, 0..1. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Picks a readable text color for the given background. */
export function textColorFor(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.5 ? "#131316" : "#ffffff";
}

/** Locale-aware uppercasing. "izle" with lang "tr" must become "İZLE", never "IZLE". */
export function toUpper(text: string, lang: string): string {
  try {
    return text.toLocaleUpperCase(lang);
  } catch {
    return text.toLocaleUpperCase("en");
  }
}

/** Escapes text for use inside Pango markup. */
export function escapePango(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
