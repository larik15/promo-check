import { configDefaults, defineConfig } from "vitest/config";

// The live test calls the real API, so it only runs through `npm run test:live`.
const live = process.env.PROMO_CHECK_LIVE === "1";

export default defineConfig({
  test: {
    include: live ? ["test/live.test.ts"] : ["test/**/*.test.ts"],
    exclude: live ? configDefaults.exclude : [...configDefaults.exclude, "test/live.test.ts"],
    testTimeout: live ? 600_000 : 30_000,
  },
});
