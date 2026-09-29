// İki AYRI derleme (bir kod tabanı): `--mode portal` satıcı arayüzü (base /portal/, tailnet dinleyicisi)
// ve `--mode bayi` bayi arayüzü (base /bayi/, genel dinleyici). Bayi paketi satıcı arayüzünün kodunu
// TAŞIMAZ (giriş dosyası ayrı; bekçi src/test/app-isolation.test.ts). Çıktıyı satıcı sunucusu aynı
// kökenden sunar (satici/sunucu src/http/web-static.ts); satır içi betik/stil yok — CSP 'self'.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const APPS = ["portal", "bayi"] as const;
type App = (typeof APPS)[number];

/** Geliştirme vekili: satıcı sunucusunun yerel dinleyicileri (satici/sunucu/.env PORT_TAILNET / PORT_GENEL). */
const DEV_TARGET: Record<App, string> = {
  portal: process.env.SATICI_TAILNET_URL ?? "http://127.0.0.1:4611",
  bayi: process.env.SATICI_GENEL_URL ?? "http://127.0.0.1:4610",
};

export default defineConfig(({ mode }) => {
  if (!(APPS as readonly string[]).includes(mode)) throw new Error(`Bilinmeyen uygulama kipi: ${mode} (portal | bayi)`);
  const app = mode as App;
  return {
    plugins: [react()],
    base: `/${app}/`,
    build: {
      outDir: `dist/${app}`,
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false },
      rollupOptions: { input: `${app}.html` },
    },
    server: {
      open: `/${app}/${app}.html`,
      proxy: { [`/${app}/api`]: { target: DEV_TARGET[app], changeOrigin: false } },
    },
  };
});
