import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the same build runs at the root and under the repository path on GitHub Pages
  // (https://grady89.github.io/tidewater/). The dev server ignores it.
  base: "./",
  server: { port: 5180, strictPort: true },
});
