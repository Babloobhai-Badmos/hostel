import { defineConfig } from "vite";

// The client lives in client/ and is built into dist/client, which the
// Express server serves on the same port as the game (3000).
export default defineConfig({
  root: "client",
  publicDir: "public",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
