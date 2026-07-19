import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets.js";
import { composeScreenshot } from "../src/render/compose.js";
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
    const meta = await sharp(output).metadata();
    expect(meta.height).toBe(600 + 72 * 2);
  });
});
