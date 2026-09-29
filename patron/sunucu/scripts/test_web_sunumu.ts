// =============================================================================
// WEB SÜRÜMÜ SUNUMU BEKÇİSİ — patron uygulamasının web çıktısı API ile aynı kökenden (`/`):
//   §1 kök + istemci yönlendirmesi: uzantısız GET/HEAD giriş HTML'ini alır, önbelleğe girmez
//   §2 önbellek: özetli dizinler (`_expo/static`, `assets`) uzun ömürlü, diğerleri no-store
//   §3 CSP: satır içi stil yalnız KENDİ özetiyle + react-native-web'in boş ögesi (unsafe-inline yok)
//   §4 API sınırı: `/api` · `/v1` altı ASLA HTML'e düşmez (JSON 404), `/saglik` ve hesap API'si çalışır
//   §5 iç ad alanı (`IC_ONEKLER`) web'de de 404; önek sınırı kelime değil bölüm
//   §6 eksik varlık · GET/HEAD dışı yöntem · noktalı bölüm → 404
//   §7 web dizini verilmezse yalnız API (kök 404) · dizin boşsa açılış DURUR (fail-closed)
//   §8 ⭐ Traefik kuralı (deploy/patron/docker-compose.yml) dışarıda tuttuğu önekler = IC_ONEKLER
// Koşum: npx tsx scripts/test_web_sunumu.ts
// =============================================================================
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_ONEKLER, BOS_STIL_OZETI, IC_ONEKLER, TAZE, UZUN_ONBELLEK, createWebRouter } from "../src/http/web-static";
import { PATRON_KOKU, kontrol, ortamKur, sonuc } from "./lib/test-ortam";

const STIL = "\n      html, body { height: 100%; }\n      #root { display: flex; }\n    ";
const HTML = `<!DOCTYPE html><html><head><title>Patron</title><style id="expo-reset">${STIL}</style></head><body><div id="root"></div><script src="/_expo/static/js/web/entry-abc123.js" defer></script></body></html>`;

function fikstur(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "patron-web-"));
  mkdirSync(path.join(d, "_expo/static/js/web"), { recursive: true });
  mkdirSync(path.join(d, "assets/node_modules/x"), { recursive: true });
  writeFileSync(path.join(d, "index.html"), HTML);
  writeFileSync(path.join(d, "_expo/static/js/web/entry-abc123.js"), "console.log(1)");
  writeFileSync(path.join(d, "assets/node_modules/x/logo.d41d8cd9.png"), "PNG");
  writeFileSync(path.join(d, "favicon.ico"), "ICO");
  writeFileSync(path.join(d, ".gizli"), "SIR");
  return d;
}

async function al(adres: string, yol: string, yontem = "GET"): Promise<{ status: number; tip: string; cc: string; csp: string; xfo: string; govde: string; kod?: string }> {
  const r = await fetch(adres + yol, { method: yontem, redirect: "manual" });
  const govde = yontem === "HEAD" ? "" : await r.text();
  let kod: string | undefined;
  try {
    kod = (JSON.parse(govde) as { details?: { code?: string } }).details?.code;
  } catch {
    kod = undefined;
  }
  const h = (n: string): string => r.headers.get(n) ?? "";
  return { status: r.status, tip: h("content-type"), cc: h("cache-control"), csp: h("content-security-policy"), xfo: h("x-frame-options"), govde, kod };
}

async function main(): Promise<void> {
  const web = fikstur();
  const o = await ortamKur({ PATRON_WEB_DIZINI: web });
  const yalnizApi = await ortamKur();
  try {
    console.log("\n§1 kök + istemci yönlendirmesi");
    const kok = await al(o.adres, "/");
    kontrol("§1a GET / → 200 giriş HTML'i, no-store", kok.status === 200 && kok.tip.startsWith("text/html") && kok.govde.includes('<div id="root">') && kok.cc === TAZE, `${kok.status} ${kok.tip} ${kok.cc}`);
    const derin = await al(o.adres, "/cariler/5f1c");
    kontrol("§1b ⭐ uzantısız derin yol (/cariler/:id) → aynı giriş HTML'i", derin.status === 200 && derin.govde === kok.govde && derin.cc === TAZE, `${derin.status}`);
    const bas = await al(o.adres, "/siparisler", "HEAD");
    kontrol("§1c HEAD da giriş HTML'ini döner", bas.status === 200 && bas.tip.startsWith("text/html"), `${bas.status}`);

    console.log("\n§2 önbellek");
    const js = await al(o.adres, "/_expo/static/js/web/entry-abc123.js");
    kontrol("§2a ⭐ _expo/static paketi uzun ömürlü (immutable)", js.status === 200 && js.cc === UZUN_ONBELLEK, js.cc);
    const png = await al(o.adres, "/assets/node_modules/x/logo.d41d8cd9.png");
    kontrol("§2b assets/ uzun ömürlü", png.status === 200 && png.cc === UZUN_ONBELLEK, png.cc);
    const ico = await al(o.adres, "/favicon.ico");
    kontrol("§2c özetsiz dosya (favicon) no-store", ico.status === 200 && ico.cc === TAZE, ico.cc);

    console.log("\n§3 güvenlik başlıkları");
    const ozet = `'sha256-${createHash("sha256").update(STIL, "utf8").digest("base64")}'`;
    const stilSrc = kok.csp.split(";").map((p) => p.trim()).find((p) => p.startsWith("style-src")) ?? "";
    kontrol("§3a ⭐ style-src yalnız 'self' + boş öge (react-native-web) + satır içi stilin KENDİ özeti", stilSrc === `style-src 'self' ${BOS_STIL_OZETI} ${ozet}`, stilSrc);
    kontrol("§3a' boş içeriğin özeti gerçekten boş dizgenin sha256'sı", BOS_STIL_OZETI === "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='", BOS_STIL_OZETI);
    kontrol("§3b unsafe-inline/unsafe-eval YOK, dış kaynak YOK", !/unsafe-(inline|eval)|https?:|\*/.test(kok.csp), kok.csp);
    kontrol("§3c çerçeveye gömülmez + bağlantı yalnız aynı köken", /frame-ancestors 'none'/.test(kok.csp) && /connect-src 'self'(;|$)/.test(kok.csp) && kok.xfo === "DENY", kok.xfo);
    kontrol("§3d varlık ve derin yol da aynı CSP'yi taşır", js.csp === kok.csp && derin.csp === kok.csp);

    console.log("\n§4 API sınırı");
    for (const onek of API_ONEKLER) {
      const r = await al(o.adres, `/${onek}/yok-boyle-bir-uc`);
      kontrol(`§4 ⭐ /${onek}/<bilinmeyen> → JSON 404 BULUNAMADI (HTML değil)`, r.status === 404 && r.tip.startsWith("application/json") && r.kod === "BULUNAMADI", `${r.status} ${r.tip}`);
    }
    const saglik = await al(o.adres, "/saglik");
    kontrol("§4c /saglik → 200 JSON", saglik.status === 200 && saglik.govde === '{"success":true}', saglik.govde);
    const oturum = await al(o.adres, "/api/oturum");
    kontrol("§4d hesap API'si web'le birlikte çalışır (oturumsuz → 401 JSON)", oturum.status === 401 && oturum.tip.startsWith("application/json"), `${oturum.status}`);

    console.log("\n§5 iç ad alanı");
    for (const onek of IC_ONEKLER) {
      for (const yol of [`/${onek}`, `/${onek}/v1/kurulum/x`]) {
        const r = await al(o.adres, yol);
        kontrol(`§5 ⭐ ${yol} → JSON 404 (web'e düşmez)`, r.status === 404 && r.kod === "BULUNAMADI", `${r.status}`);
      }
    }
    const icerik = await al(o.adres, "/icerik");
    kontrol("§5c önek sınırı bölümdür: /icerik iç ad alanı DEĞİL (giriş HTML'i)", icerik.status === 200 && icerik.tip.startsWith("text/html"), `${icerik.status}`);

    console.log("\n§6 eksik varlık · yöntem · noktalı bölüm");
    kontrol("§6a eksik varlık (/yok.js) → 404", (await al(o.adres, "/yok.js")).status === 404);
    for (const y of ["POST", "PUT", "DELETE"]) kontrol(`§6b ${y} / → 404`, (await al(o.adres, "/", y)).status === 404);
    for (const yol of ["/.gizli", "/a/.git/config", "/.env"]) {
      const r = await al(o.adres, yol);
      kontrol(`§6c ${yol} → 404, içerik sızmaz`, r.status === 404 && !r.govde.includes("SIR"), `${r.status}`);
    }
    const kacis = await al(o.adres, "/%2e%2e/%2e%2e/etc/passwd");
    kontrol("§6d dizin dışına kaçış dosya okumaz", !kacis.govde.includes("root:"), `${kacis.status}`);

    console.log("\n§7 yapılandırma");
    const apiKok = await al(yalnizApi.adres, "/");
    kontrol("§7a web dizini verilmezse kök → JSON 404 (yalnız API)", apiKok.status === 404 && apiKok.kod === "BULUNAMADI", `${apiKok.status}`);
    const bos = mkdtempSync(path.join(os.tmpdir(), "patron-web-bos-"));
    let durdu = false;
    try {
      createWebRouter(bos);
    } catch {
      durdu = true;
    }
    rmSync(bos, { recursive: true, force: true });
    kontrol("§7b giriş HTML'i olmayan dizin → açılış DURUR (fail-closed)", durdu);

    console.log("\n§8 Traefik kuralı ↔ IC_ONEKLER");
    const compose = readFileSync(path.join(PATRON_KOKU, "..", "..", "deploy", "patron", "docker-compose.yml"), "utf8");
    const kurallar = [...compose.matchAll(/traefik\.http\.routers\.[^.]+\.rule=(.*)$/gm)].map((m) => m[1]!.replace(/"$/, ""));
    const disarida = kurallar.map((k) => /!PathRegexp\(`\^\/\(([a-z|]+)\)\(\/\|\$\$?\)`\)/.exec(k)?.[1]?.split("|") ?? null);
    kontrol("§8a tek yönlendirici, Host kuralı + iç önek dışlaması taşır", kurallar.length === 1 && /^Host\(`\$\{PATRON_HOST[^}]*\}`\) && /.test(kurallar[0]!) && disarida[0] !== null, kurallar.join(" | ") || "YOK");
    const dis = [...(disarida[0] ?? [])].sort().join(",");
    kontrol("§8b ⭐ Traefik'in dışarıda tuttuğu önekler = IC_ONEKLER (kod ↔ kenar tek liste)", dis === [...IC_ONEKLER].sort().join(","), `traefik: ${dis || "YOK"} · kod: ${[...IC_ONEKLER].join(",")}`);
  } finally {
    await o.kapat();
    await yalnizApi.kapat();
    rmSync(web, { recursive: true, force: true });
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.message}`);
  process.exit(1);
});
