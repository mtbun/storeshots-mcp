import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never ask the star question or touch ~/.config during tests; star.test.ts opts back in.
    env: { STORESHOTS_NO_STAR: "1" },
  },
});
