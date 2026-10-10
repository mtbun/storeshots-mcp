import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/run.js";
import { acceptsStar, isYes, markStarOffered, shouldOfferStar } from "../src/star.js";
import { ALL_TOOLS } from "../src/tools/definitions.js";
import { makeProject, tempDir } from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("STORESHOTS_NO_STAR", "");
  vi.stubEnv("CI", "");
  vi.stubEnv("STORESHOTS_STATE_DIR", tempDir());
});
afterEach(() => vi.unstubAllEnvs());

async function build(cwd: string, io: Parameters<typeof runCli>[1] = {}, ...args: string[]) {
  let out = "";
  const code = await runCli(["build", ...args], { cwd, stdout: (t) => (out += t), stderr: (t) => (out += t), ...io });
  return { code, out };
}

describe("star question", () => {
  it("is offered once per machine, and never in CI or when disabled", () => {
    expect(shouldOfferStar()).toBe(true);
    markStarOffered();
    expect(shouldOfferStar()).toBe(false);

    vi.stubEnv("STORESHOTS_STATE_DIR", tempDir());
    vi.stubEnv("CI", "true");
    expect(shouldOfferStar()).toBe(false);
    vi.stubEnv("CI", "");
    vi.stubEnv("STORESHOTS_NO_STAR", "1");
    expect(shouldOfferStar()).toBe(false);
  });

  it("understands yes in a few languages and treats anything else as no", () => {
    for (const a of ["y", "Yes", " evet ", "e", "ja", "sí", "oui"]) expect(isYes(a)).toBe(true);
    for (const a of ["", "n", "no", "hayır", "later", "yes please"]) expect(isYes(a)).toBe(false);
  });

  it("on a [Y/n] terminal prompt, Enter accepts and anything else but yes declines", () => {
    expect(acceptsStar("")).toBe(true);
    expect(acceptsStar("  ")).toBe(true);
    expect(acceptsStar("Y")).toBe(true);
    for (const a of ["n", "no", "hayır", "later"]) expect(acceptsStar(a)).toBe(false);
  });

  it("on a terminal: asks yes/no after the first build and stars only on yes", async () => {
    const dir = await makeProject({ languages: ["en"] });
    const starRepo = vi.fn(() => "starred" as const);
    const prompt = vi.fn(async () => "y");
    const first = await build(dir, { prompt, starRepo });
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0][0]).toMatch(/Would you like to star storeshots on GitHub\? \[Y\/n\]/);
    expect(first.out).toMatch(/★ storeshots is free, open source, and built by an indie developer/);
    expect(starRepo).toHaveBeenCalledOnce();
    expect(first.out).toMatch(/✓ Starred https:\/\/github\.com\/mtbun\/storeshots-mcp/);

    // Asked once: a later build, even in another project, stays quiet.
    const other = await makeProject({ languages: ["en"] });
    await build(other, { prompt, starRepo }, "--force");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("on a terminal: Enter stars, an explicit no does not", async () => {
    const enter = vi.fn(() => "starred" as const);
    await build(await makeProject({ languages: ["en"] }), { prompt: async () => "", starRepo: enter });
    expect(enter).toHaveBeenCalledOnce();

    vi.stubEnv("STORESHOTS_STATE_DIR", tempDir());
    const no = vi.fn(() => "starred" as const);
    const r = await build(await makeProject({ languages: ["en"] }), { prompt: async () => "n", starRepo: no });
    expect(no).not.toHaveBeenCalled();
    expect(r.out).toMatch(/won't ask again/);

    // Ctrl+C / Ctrl+D at the prompt: the build still succeeds and nothing is starred.
    vi.stubEnv("STORESHOTS_STATE_DIR", tempDir());
    const aborted = vi.fn(() => "starred" as const);
    const ctrlD = await build(await makeProject({ languages: ["en"] }), {
      prompt: () => Promise.reject(new Error("Aborted with Ctrl+D")),
      starRepo: aborted,
    });
    expect(ctrlD.code).toBe(0);
    expect(aborted).not.toHaveBeenCalled();
  });

  it("without a terminal: prints the question for the agent, or returns it in --json", async () => {
    const dir = await makeProject({ languages: ["en"] });
    const starRepo = vi.fn(() => "starred" as const);
    const human = await build(dir, { starRepo });
    expect(human.out).toMatch(/Would you like to star storeshots on GitHub\? \(yes\/no\)/);
    expect(human.out).toMatch(/Only on an explicit "yes", run: gh api -X PUT \/user\/starred\/mtbun\/storeshots-mcp/);
    expect(starRepo).not.toHaveBeenCalled();

    vi.stubEnv("STORESHOTS_STATE_DIR", tempDir());
    const json = JSON.parse((await build(dir, {}, "--json", "--force")).out);
    expect(json.star).toMatchObject({
      pitch: expect.stringMatching(/support/),
      question: expect.stringMatching(/\(yes\/no\)$/),
      url: "https://github.com/mtbun/storeshots-mcp",
    });
    expect(json.star.instructions).toMatch(/Never star without an explicit yes/);
    expect(JSON.parse((await build(dir, {}, "--json", "--force")).out).star).toBeUndefined();
  });

  it("is not offered when nothing was rendered", async () => {
    const dir = await makeProject({ languages: ["en"] });
    vi.stubEnv("STORESHOTS_NO_STAR", "1");
    await build(dir);
    vi.stubEnv("STORESHOTS_NO_STAR", "");
    const prompt = vi.fn(async () => "y");
    await build(dir, { prompt, starRepo: () => "starred" });
    expect(prompt).not.toHaveBeenCalled();
    expect(shouldOfferStar()).toBe(true);
  });

  it("build_project MCP tool returns the question once", async () => {
    const tool = ALL_TOOLS.find((t) => t.name === "build_project")!;
    const dir = await makeProject({ languages: ["en"] });
    const config = path.join(dir, "storeshots.json");
    expect(((await tool.handler({ config })) as { star?: unknown }).star).toBeDefined();
    expect(((await tool.handler({ config, force: true })) as { star?: unknown }).star).toBeUndefined();
  });
});
