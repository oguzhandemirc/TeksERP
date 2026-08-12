/**
 * SAF WEB build'i — Electron İÇERMEZ.
 *
 * Aynı renderer kodunun tarayıcıda çalışan ikinci build hedefi (electron.vite.config.ts'in
 * `renderer` bloğunun karşılığı; main/preload derlenmez, `window.api` tarayıcıda undefined
 * kalır — tüketiciler zaten `api?` + zarif geri düşüş ile yazılı, secure-store için tek
 * istisna `src/lib/secure-store.ts` adapter'ıdır).
 *
 * API adresi sözleşmesi (bilinçli, deterministik):
 * - `build`  → VARSAYILAN SAME-ORIGIN (`VITE_API_BASE_URL = ""` gömülür): web paneli
 *   backend'in kendisinden statik servis edilir, axios istekleri göreli gider. Diskteki
 *   `.env` (Electron dev içindir) build'e SIZMAZ — aksi hâlde geliştirici makinesindeki
 *   `localhost:4000` production paketine gömülürdü.
 * - Farklı origin'den servis GEREKİYORSA açık değişkenle ezilir:
 *   `VITE_WEB_API_BASE_URL=https://api.ornek.com npm run build:web`
 * - `dev` (npm run dev:web) → normal Vite env zinciri (.env → VITE_API_BASE_URL →
 *   apiClient'ın localhost:4000 varsayılanı); backend CORS'u origin kısıtsız olduğu için
 *   5175 → 4000 çapraz istek çalışır.
 */
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  define:
    command === "build"
      ? {
          "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
            process.env.VITE_WEB_API_BASE_URL ?? "",
          ),
        }
      : undefined,
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  // Electron renderer dev sunucusu 5174'te — ikisi yan yana koşabilsin.
  server: { port: 5175 },
}));
