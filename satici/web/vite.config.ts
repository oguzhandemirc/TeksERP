// İki AYRI derleme (bir kod tabanı): `--mode portal` satıcı arayüzü (base /portal/, ERİŞİM dinleyicisi)
// ve `--mode bayi` bayi arayüzü (base /bayi/, genel dinleyici). Bayi paketi satıcı arayüzünün kodunu
// TAŞIMAZ (giriş dosyası ayrı; bekçi src/test/app-isolation.test.ts). Çıktıyı satıcı sunucusu aynı
// kökenden sunar (satici/sunucu src/http/web-static.ts); satır içi betik/stil yok — CSP 'self'.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const APPS = ["portal", "bayi"] as const;
type App = (typeof APPS)[number];

/** Geliştirme vekili: satıcı sunucusunun yerel dinleyicileri (satici/sunucu/.env PORT_ERISIM / PORT_GENEL). */
const DEV_TARGET: Record<App, string> = {
  portal: process.env.SATICI_ERISIM_URL ?? "http://127.0.0.1:4613",
  bayi: process.env.SATICI_GENEL_URL ?? "http://127.0.0.1:4610",
};

/** Portal yalnız Access arkasından açılır: yerel jeton (`npm run dev:erisim`, satici/sunucu) her isteğe eklenir. */
function portalHeaders(): Record<string, string> | undefined {
  const jeton = process.env.SATICI_ERISIM_JETON;
  if (jeton) return { "Cf-Access-Jwt-Assertion": jeton };
  console.warn("[vite] SATICI_ERISIM_JETON tanımsız: portal istekleri Access jetonsuz gider ve sunucu reddeder. Jetonu `npm run dev:erisim` (satici/sunucu) basar.");
  return undefined;
}

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
      proxy: { [`/${app}/api`]: { target: DEV_TARGET[app], changeOrigin: false, headers: app === "portal" ? portalHeaders() : undefined } },
    },
  };
});
