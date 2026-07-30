import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets.js";
import { composeScreenshot } from "../src/render/compose.js";
import { panoramaSlices } from "../src/render/panorama.js";
import { createShowcase } from "../src/render/showcase.js";
import { validateScreenshot } from "../src/render/validate.js";
import { fakeScreenshot, tempDir } from "./helpers.js";

let dir: string;
let raw: string;

beforeAll(async () => {
  dir = tempDir();
  raw = await fakeScreenshot(dir);
});

describe("composeScreenshot", () => {
  it.each(Object.keys(PRESETS))(
    "renders %s at exact store dimensions without alpha",
    async (presetId) => {
      const preset = PRESETS[presetId];
      const output = path.join(dir, `${presetId}.png`);
      const result = await composeScreenshot({
        preset: presetId,
        background: "#E31837",
        verb: "track",
        descriptor: "your daily mood",
        screenshot: raw,
        output,
      });
      expect(result.width).toBe(preset.width);
      expect(result.height).toBe(preset.height);
      const meta = await sharp(output).metadata();
      expect(meta.width).toBe(preset.width);
      expect(meta.height).toBe(preset.height);
      expect(meta.hasAlpha).toBe(false);
    },
    30000,
  );

  it("uppercases the headline with Turkish locale rules", async () => {
    const output = path.join(dir, "tr_01.png");
    const result = await composeScreenshot({
      preset: "android-phone",
      background: "#131316",
      verb: "izle",
      descriptor: "günlük ilerlemeni",
      screenshot: raw,
      output,
      lang: "tr",
    });
    expect(result.headline).toBe("İZLE GÜNLÜK İLERLEMENİ");
    expect(result.textColor).toBe("#ffffff");
  });

  it.each(["text-top", "text-bottom", "tilted"] as const)(
    "renders the %s variant at exact dimensions",
    async (variant) => {
      const output = path.join(dir, `variant-${variant}.png`);
      const result = await composeScreenshot({
        preset: "ios-phone",
        background: "#5B5BD6",
        verb: "plan",
        descriptor: "your best week",
        screenshot: raw,
        output,
        variant,
      });
      expect(result.variant).toBe(variant);
      const meta = await sharp(output).metadata();
      expect(meta.width).toBe(1320);
      expect(meta.height).toBe(2868);
      expect(meta.hasAlpha).toBe(false);
    },
    30000,
  );

  it("produces visually different output per variant", async () => {
    const [a, b, c] = await Promise.all(
      (["text-top", "text-bottom", "tilted"] as const).map((v) =>
        sharp(path.join(dir, `variant-${v}.png`)).raw().toBuffer(),
      ),
    );
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(false);
    expect(b.equals(c)).toBe(false);
  });

  it("ignores variants on the landscape feature graphic and says so", async () => {
    const result = await composeScreenshot({
      preset: "play-feature-graphic",
      background: "#5B5BD6",
      verb: "plan",
      descriptor: "your best week",
      screenshot: raw,
      output: path.join(dir, "feature-tilted.png"),
      variant: "tilted",
    });
    expect(result.variant).toBe("text-top");
    expect(result.warnings.join(" ")).toMatch(/fixed landscape layout/);
  });

  it("shows the screenshot through a custom frame's transparent screen", async () => {
    // Charcoal body with a REAL transparent screen window, punched via dest-out.
    const frameImg = path.join(dir, "frame.png");
    const body = await sharp(
      Buffer.from(
        `<svg width="600" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="1200" rx="80" fill="#111111"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const holeMask = Buffer.from(
      `<svg width="600" height="1200" xmlns="http://www.w3.org/2000/svg"><rect x="40" y="40" width="520" height="1120" rx="48" fill="#fff"/></svg>`,
    );
    await sharp(body).composite([{ input: holeMask, blend: "dest-out" }]).png().toFile(frameImg);

    const output = path.join(dir, "custom-frame.png");
    const result = await composeScreenshot({
      preset: "ios-phone",
      background: "#5B5BD6",
      verb: "custom",
      descriptor: "framed device",
      screenshot: raw, // fakeScreenshot is #2b6cb0 with a light top band
      output,
      frame: { image: frameImg, screenX: 40, screenY: 40, screenWidth: 520, screenHeight: 1120 },
    });
    expect(result.width).toBe(1320);
    expect(result.height).toBe(2868);
    const meta = await sharp(output).metadata();
    expect(meta.hasAlpha).toBe(false);

    // The screen center must show the screenshot's blue, not the frame's charcoal.
    const center = await sharp(output)
      .extract({ left: 660, top: 1600, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(center[2]).toBeGreaterThan(center[0]); // blue channel dominant
  });

  it("rejects a frame whose screen rectangle falls outside the image", async () => {
    const frameImg = path.join(dir, "small-frame.png");
    await sharp({ create: { width: 200, height: 400, channels: 4, background: "#111" } })
      .png()
      .toFile(frameImg);
    await expect(
      composeScreenshot({
        preset: "ios-phone",
        background: "#5B5BD6",
        verb: "bad",
        descriptor: "frame rect",
        screenshot: raw,
        output: path.join(dir, "bad-frame.png"),
        frame: { image: frameImg, screenX: 0, screenY: 0, screenWidth: 999, screenHeight: 999 },
      }),
    ).rejects.toThrowError(/outside the 200x400 frame/);
  });

  it("panorama slices tile back into one continuous gradient", async () => {
    const slices = await panoramaSlices("#000000", "#FFFFFF", 3, 100, 20);
    expect(slices).toHaveLength(3);
    // Left edge of slice 0 is near-black; right edge of slice 2 is near-white.
    const first = await sharp(slices[0]).extract({ left: 0, top: 10, width: 1, height: 1 }).raw().toBuffer();
    const last = await sharp(slices[2]).extract({ left: 99, top: 10, width: 1, height: 1 }).raw().toBuffer();
    expect(first[0]).toBeLessThan(40);
    expect(last[0]).toBeGreaterThan(215);
  });

  it("rejects unreadable screenshots with an actionable error", async () => {
    await expect(
      composeScreenshot({
        preset: "ios-phone",
        background: "#E31837",
        verb: "TRACK",
        descriptor: "YOUR MOOD",
        screenshot: path.join(dir, "does-not-exist.png"),
        output: path.join(dir, "x.png"),
      }),
    ).rejects.toThrowError(/Could not read screenshot/);
  });

  it("flags overwrites instead of failing silently", async () => {
    const output = path.join(dir, "overwrite.png");
    const opts = {
      preset: "android-phone" as const,
      background: "#E31837",
      verb: "PLAN",
      descriptor: "YOUR WEEK",
      screenshot: raw,
      output,
    };
    const first = await composeScreenshot(opts);
    expect(first.overwrote).toBe(false);
    const second = await composeScreenshot(opts);
    expect(second.overwrote).toBe(true);
    expect(second.warnings.join(" ")).toMatch(/Overwrote/);
  });
});

describe("validateScreenshot", () => {
  it("accepts composed output and identifies its preset", async () => {
    const output = path.join(dir, "ios-phone.png");
    const result = await validateScreenshot(output);
    expect(result.valid).toBe(true);
    expect(result.matchesPreset).toBe("ios-phone");
  });

  it("rejects wrong dimensions against an explicit preset", async () => {
    const result = await validateScreenshot(path.join(dir, "ios-phone.png"), "android-phone");
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toMatch(/Expected 1080x1920/);
  });
});

describe("createShowcase", () => {
  it("builds a strip from composed screenshots", async () => {
    const output = path.join(dir, "showcase.png");
    const result = await createShowcase({
      inputs: [path.join(dir, "ios-phone.png"), path.join(dir, "android-phone.png")],
      output,
      itemHeight: 600,
    });
    expect(result.count).toBe(2);
    expect(result.note).toMatch(/github\.com\/mtbun\/storeshots-mcp/);
    const meta = await sharp(output).metadata();
    expect(meta.height).toBe(600 + 72 * 2);
  });
});
