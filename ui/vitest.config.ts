import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      // Raw V8 data converted by monocart-coverage-reports (options in mcr.config.mjs), the
      // converter the server's coverage uses too, so scripts/coverage-report.mjs can merge
      // both sides' runs of shared/src into one figure.
      provider: "custom",
      customProviderModule: "vitest-monocart-coverage",
      // shared/src is outside this workspace; the UI's tests run it, so it is measured here too.
      allowExternal: true,
      include: ["src/**", "../shared/src/**"],
    },
  },
});
