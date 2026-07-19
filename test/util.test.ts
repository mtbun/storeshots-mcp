import { describe, expect, it } from "vitest";
import { normalizeHex, relativeLuminance, textColorFor, toUpper } from "../src/util.js";

describe("toUpper", () => {
  it("uses Turkish casing rules: i becomes dotted İ", () => {
    expect(toUpper("izle", "tr")).toBe("İZLE");
    expect(toUpper("güçlü izleme", "tr")).toBe("GÜÇLÜ İZLEME");
  });

  it("keeps English casing for English", () => {
    expect(toUpper("izle", "en")).toBe("IZLE");
    expect(toUpper("track your mood", "en")).toBe("TRACK YOUR MOOD");
  });

  it("preserves German and accented characters", () => {
    expect(toUpper("überblick", "de")).toBe("ÜBERBLICK");
    expect(toUpper("éxito", "es")).toBe("ÉXITO");
  });
});

describe("colors", () => {
  it("normalizes hex input and rejects garbage", () => {
    expect(normalizeHex("E31837")).toBe("#e31837");
    expect(normalizeHex("#E31837")).toBe("#e31837");
    expect(() => normalizeHex("red")).toThrowError(/6-digit hex/);
    expect(() => normalizeHex("#fff")).toThrowError(/6-digit hex/);
  });

  it("picks white text on dark backgrounds and dark text on light ones", () => {
    expect(textColorFor("#111111")).toBe("#ffffff");
    expect(textColorFor("#E31837")).toBe("#ffffff");
    expect(textColorFor("#f5f0e8")).toBe("#131316");
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBeCloseTo(0);
  });
});
