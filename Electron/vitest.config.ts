import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// ESM config — __dirname yok; import.meta.url'den türet (no-undef'i de giderir).
const rootDir = dirname(fileURLToPath(import.meta.url));

// Renderer (React) birim/bileşen testleri için Vitest yapılandırması.
// electron.vite.config.ts'ten bağımsız — yalnız renderer src'i hedefler;
// alias'lar (@ → src, @shared → shared) ile birebir aynı import yolları çalışır.

// Zaman aşımı KİPE bağlı (1e hükmü 2026-09-14): commit kapısı 8 oturumun paylaştığı
// makinede yük altında koşar — load ≈ 25'te üç test 5000 ms'yi aştı, tek başına 21 sn
// (kod hatası değil, CPU açlığı). Kapı kipinde 20 sn askıyı yine yakalar, sahte
// kırmızıyı keser; bayraksız (CI, elle `npm test`) 5 sn kalır — asıl sınır boş koşucuda.
const KAPI_KIPI = process.env.TEKSERP_KAPI_ADIMI === "commit";

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
    testTimeout: KAPI_KIPI ? 20_000 : 5_000,
  },
});
