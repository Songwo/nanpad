import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The Electron renderer build.
 *
 * Deliberately separate from `vite.config.ts`: the desktop app has no server,
 * no router and no SSR — it is one screen driven by the store — while the web
 * preview keeps its TanStack Start pipeline untouched. `base: "./"` matters
 * because the packaged app loads the bundle over `file://`.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./electron/renderer", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [tailwindcss(), viteReact()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-desktop", import.meta.url)),
    emptyOutDir: true,
    target: "chrome128",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 8090,
    strictPort: true,
  },
});
