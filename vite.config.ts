import { defineConfig } from "vitest/config";

// BASE_PATH lets GitHub Pages serve the site from /<repo>/ (set in the deploy workflow).
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  test: { include: ["tests/**/*.test.ts"] },
});
