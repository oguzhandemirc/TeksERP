import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// ESM config — __dirname yok; import.meta.url'den türet (no-undef'i de giderir).
const rootDir = dirname(fileURLToPath(import.meta.url));

// Renderer (React) birim/bileşen testleri için Vitest yapılandırması.
// electron.vite.config.ts'ten bağımsız — yalnız renderer src'i hedefler;
// alias'lar (@ → src, @shared → shared) ile birebir aynı import yolları çalışır.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
      "@shared": resolve(rootDir, "shared"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
