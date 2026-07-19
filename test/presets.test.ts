import { describe, expect, it } from "vitest";
import { PRESETS, getPreset } from "../src/presets.js";

describe("presets", () => {
  it("exposes the store presets with exact store dimensions", () => {
    expect(getPreset("ios-phone")).toMatchObject({ width: 1320, height: 2868 });
    expect(getPreset("android-phone")).toMatchObject({ width: 1080, height: 1920 });
    expect(getPreset("ipad-13")).toMatchObject({ width: 2064, height: 2752 });
    expect(getPreset("android-tablet")).toMatchObject({ width: 1600, height: 2560 });
    expect(getPreset("play-feature-graphic")).toMatchObject({ width: 1024, height: 500, layout: "landscape" });
  });

  it("rejects unknown presets with the list of valid ids", () => {
    expect(() => getPreset("ios-mega")).toThrowError(/Valid presets: .*ios-phone/);
  });

  it("keeps portrait text and device zones from overlapping by construction", () => {
    for (const p of Object.values(PRESETS).filter((p) => p.layout === "portrait")) {
      expect(p.textTopRatio).toBeLessThan(p.deviceTopRatio);
      expect(p.deviceWidthRatio).toBeGreaterThan(0.5);
      expect(p.deviceWidthRatio).toBeLessThan(1);
    }
  });
});
