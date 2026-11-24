// Önizleme sunucusu ÇEREZ KİPİ (YALNIZ GELİŞTİRME): web config'i + /api ve /health'i backend'e vekiller,
// panel API'yi aynı kökenden (göreli) çağırır — bulut web panelinin httpOnly çerez oturumu (F5'te kalır)
// burada da çalışsın. Backend tarafı `WEB_DIST_DIR` doluyken çerez kipine geçer.
// Düz http önizlemede tarayıcı `Secure` çerezi reddeder; vekil yalnız bu öznitelği düşürür (üretimde vekil yok).
// Kullanım: cd Electron && ONIZLEME_API_HEDEF=http://127.0.0.1:4100 npx vite --config onizleme/vite.cerez.config.mjs
import base from "../vite.config.web.ts";

const hedef = process.env.ONIZLEME_API_HEDEF || "http://127.0.0.1:4100";

function secureDusur(proxy) {
  proxy.on("proxyRes", (res) => {
    const c = res.headers["set-cookie"];
    if (Array.isArray(c)) res.headers["set-cookie"] = c.map((s) => s.replace(/;\s*Secure(?=;|$)/gi, ""));
  });
}

const vekil = { target: hedef, changeOrigin: false, ws: false, configure: secureDusur };

export default (env) => {
  const c = typeof base === "function" ? base(env) : base;
  return {
    ...c,
    define: { ...c.define, "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
    server: { ...c.server, proxy: { "/api": vekil, "/health": vekil } },
  };
};
