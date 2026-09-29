// =============================================================================
// PORTAL WEB STATİK SERVİSİ — derlenmiş `satici/web` arayüzü API ile aynı kökenden sunulur ve
// ROL × DİNLEYİCİ ayrımı korunur: satıcı arayüzü yalnız TAILNET'te `/portal` (tailnet kapısının
// ARKASINDA), bayi arayüzü yalnız GENEL'de `/bayi`; bir dinleyici ötekinin arayüzünü hiç sunmaz.
// `/api` altı HTML'e düşmez (bilinmeyen uç JSON 404, oturumsuz uç 401 kalır); istemci yönlendirmesi
// uzantısız yolda giriş HTML'ini alır, eksik varlık 404; dizin dışına çıkılamaz; güvenlik başlıkları
// (CSP, çerçeve yasağı) her yanıtta; derlenmemiş arayüz 404 döner, API çalışır.
// ⭐ KALICI SONDA ✓K (her koşumda): §2a/§2b/§4a doğru dinleyicide arayüz GERÇEKTEN sunulur (her
//    şeyi 404'leyen kör bir servis de "sızmıyor" yeşili verirdi).
// Koşum: npx tsx scripts/test_portal_web_statik.ts   (DB sorgusu yok)
// =============================================================================
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { KeyStore } from "../src/keys/key-store";
import { createPublicApp } from "../src/http/public-app";
import { createTailnetApp } from "../src/http/tailnet-app";
import { PortalSecretBox } from "../src/portal/secret-box";
import type { VendorContext } from "../src/services/context";
import { fiksturKur } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { kontrol, sonuc } from "./lib/test-ortam";

interface Ham {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** Ham yol (fetch `..` ve `%2e%2e`yi normalleştirir; kaçış denemesi olduğu gibi gitmeli). */
function iste(port: number, yol: string, method = "GET"): Promise<Ham> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: yol, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function listen(server: http.Server): Promise<AddressInfo> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address() as AddressInfo)));
}

const SATICI_ISARET = "SATICI-ARAYUZU-7f3a";
const BAYI_ISARET = "BAYI-ARAYUZU-9c1e";
const GIZLI_ISARET = "DIZIN-DISI-GIZLI-4b2d";

async function main(): Promise<void> {
  const kok = mkdtempSync(path.join(os.tmpdir(), "satici-web-"));
  const dist = path.join(kok, "dist");
  mkdirSync(path.join(dist, "portal", "assets"), { recursive: true });
  mkdirSync(path.join(dist, "bayi", "assets"), { recursive: true });
  writeFileSync(path.join(dist, "portal", "portal.html"), `<!doctype html><title>${SATICI_ISARET}</title>`);
  writeFileSync(path.join(dist, "portal", "assets", "uygulama-a1b2.js"), "console.log('satici');");
  writeFileSync(path.join(dist, "portal", ".env"), "GIZLI=1");
  writeFileSync(path.join(dist, "bayi", "bayi.html"), `<!doctype html><title>${BAYI_ISARET}</title>`);
  writeFileSync(path.join(dist, "bayi", "assets", "bayi-c3d4.js"), "console.log('bayi');");
  writeFileSync(path.join(kok, "gizli.txt"), GIZLI_ISARET);

  const f = fiksturKur(Date.now());
  writeFileSync(path.join(kok, "capa.json"), JSON.stringify(f.kokler));
  const taban = { DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test", ANAHTAR_DIZINI: kok, GUVEN_CAPASI_DOSYASI: path.join(kok, "capa.json") };
  const baglam = (webDizini: string): VendorContext => {
    const config = loadConfig({ ...taban, PORTAL_WEB_DIZINI: webDizini });
    return { config, keys: KeyStore.load(config), portalSecrets: PortalSecretBox.load(kok, { create: true }) };
  };

  console.log("\n§0 yapılandırma");
  kontrol("§0a varsayılan web dizini satici/web/dist (sunucu klasörüne göre)", loadConfig({ DATABASE_URL: taban.DATABASE_URL }, "/x/satici/sunucu").PORTAL_WEB_DIZINI === "/x/satici/web/dist");

  process.env.SATICI_ERISIM_GUNLUGU = "0";
  const ctx = baglam(dist);
  let tailnetAdresi: AddressInfo | null = null;
  const tailnetApp = createTailnetApp(ctx, null, () => tailnetAdresi);
  const tailnet = http.createServer(tailnetApp);
  const yanlisSoket = http.createServer(tailnetApp);
  const genel = http.createServer(createPublicApp(ctx, null));
  const eksikCtx = baglam(path.join(kok, "yok"));
  let eksikAdres: AddressInfo | null = null;
  const eksikTailnet = http.createServer(createTailnetApp(eksikCtx, null, () => eksikAdres));
  const eksikGenel = http.createServer(createPublicApp(eksikCtx, null));
  try {
    tailnetAdresi = await listen(tailnet);
    const t = tailnetAdresi.port;
    const y = (await listen(yanlisSoket)).port;
    const g = (await listen(genel)).port;
    eksikAdres = await listen(eksikTailnet);
    const eg = (await listen(eksikGenel)).port;

    console.log("\n§1 tailnet: satıcı arayüzü, kapının arkasında");
    const ana = await iste(t, "/portal/");
    kontrol("§1a ✓K /portal/ → 200 satıcı arayüzü", ana.status === 200 && ana.body.includes(SATICI_ISARET), `${ana.status}`);
    const csp = String(ana.headers["content-security-policy"] ?? "");
    kontrol(
      "§1b güvenlik başlıkları: CSP (satır içi betik yok, çerçeve yok) + DENY + nosniff + no-store",
      /script-src 'self'(;|$)/.test(csp) && csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe") &&
        ana.headers["x-frame-options"] === "DENY" && ana.headers["x-content-type-options"] === "nosniff" && ana.headers["cache-control"] === "no-store",
      csp,
    );
    const derin = await iste(t, "/portal/kurulumlar/5b0c6a4e-0000-4000-8000-000000000000");
    const kok0 = await iste(t, "/portal");
    kontrol("§1c istemci yönlendirmesi: derin bağlantı ve /portal → giriş HTML'i", derin.status === 200 && derin.body.includes(SATICI_ISARET) && kok0.status === 200 && kok0.body.includes(SATICI_ISARET), `${derin.status} ${kok0.status}`);
    const varlik = await iste(t, "/portal/assets/uygulama-a1b2.js");
    kontrol("§1d özetli varlık → 200 + değişmez önbellek", varlik.status === 200 && String(varlik.headers["cache-control"]).includes("immutable"), `${varlik.status} ${String(varlik.headers["cache-control"])}`);
    const eksikVarlik = await iste(t, "/portal/assets/olmayan-9999.js");
    kontrol("§1e eksik varlık → 404 (HTML'e düşmez)", eksikVarlik.status === 404 && !eksikVarlik.body.includes(SATICI_ISARET), `${eksikVarlik.status}`);
    const apiYok = await iste(t, "/portal/api/olmayan-uc");
    const apiOturum = await iste(t, "/portal/api/pano");
    kontrol(
      "§1f /portal/api altı HTML'e düşmez: bilinmeyen uç JSON 404, oturumsuz uç JSON 401",
      apiYok.status === 404 && apiYok.body.includes('"BULUNAMADI"') && apiOturum.status === 401 && apiOturum.body.includes('"OTURUM_YOK"'),
      `${apiYok.status} ${apiOturum.status}`,
    );
    const post = await iste(t, "/portal/kurulumlar", "POST");
    kontrol("§1g arayüz yolunda GET dışı → 404", post.status === 404 && !post.body.includes(SATICI_ISARET), `${post.status}`);
    const tailnetBayi = [await iste(t, "/bayi/"), await iste(t, "/bayi/bayi.html"), await iste(t, "/bayi/assets/bayi-c3d4.js")];
    kontrol("§1h tailnet dinleyicisi bayi arayüzünü SUNMAZ", tailnetBayi.every((r) => r.status === 404 && !r.body.includes(BAYI_ISARET)), tailnetBayi.map((r) => r.status).join(","));
    const yanlis = await iste(y, "/portal/");
    kontrol("§1i aynı uygulama BAŞKA sokette → 404 (arayüz tailnet kapısının arkasında)", yanlis.status === 404 && !yanlis.body.includes(SATICI_ISARET), `${yanlis.status}`);

    console.log("\n§2 genel: bayi arayüzü");
    const bayi = await iste(g, "/bayi/");
    kontrol("§2a ✓K /bayi/ → 200 bayi arayüzü + CSP", bayi.status === 200 && bayi.body.includes(BAYI_ISARET) && String(bayi.headers["content-security-policy"]).includes("default-src 'self'"), `${bayi.status}`);
    const bayiDerin = await iste(g, "/bayi/musteriler");
    kontrol("§2b ✓K derin bağlantı → bayi giriş HTML'i", bayiDerin.status === 200 && bayiDerin.body.includes(BAYI_ISARET), `${bayiDerin.status}`);
    const genelSatici = [await iste(g, "/portal/"), await iste(g, "/portal/portal.html"), await iste(g, "/portal/assets/uygulama-a1b2.js"), await iste(g, "/portal/api/pano")];
    kontrol("§2c genel dinleyici satıcı arayüzünü ve API'sini SUNMAZ", genelSatici.every((r) => r.status === 404 && !r.body.includes(SATICI_ISARET)), genelSatici.map((r) => r.status).join(","));
    const bayiApi = await iste(g, "/bayi/api/olmayan-uc");
    kontrol("§2d /bayi/api altı HTML'e düşmez", bayiApi.status === 404 && bayiApi.body.includes('"BULUNAMADI"'), `${bayiApi.status}`);

    console.log("\n§3 dizin dışına çıkış yok");
    const kacis = [
      await iste(g, "/bayi/..%2fportal/portal.html"),
      await iste(g, "/bayi/%2e%2e/portal/portal.html"),
      await iste(g, "/bayi/..%2f..%2fgizli.txt"),
      await iste(g, "/bayi/%2e%2e%2f%2e%2e%2fgizli.txt"),
      await iste(t, "/portal/..%2f..%2fgizli.txt"),
    ];
    kontrol(
      "§3a kodlanmış '..' ile öteki uygulamaya ya da dist dışına ulaşılamaz",
      kacis.every((r) => r.status !== 200 || (!r.body.includes(SATICI_ISARET) && !r.body.includes(GIZLI_ISARET))) && kacis.every((r) => !r.body.includes(GIZLI_ISARET)),
      kacis.map((r) => r.status).join(","),
    );
    const nokta = await iste(t, "/portal/.env");
    kontrol("§3b nokta dosyası sunulmaz", !nokta.body.includes("GIZLI=1"), `${nokta.status}`);

    console.log("\n§4 derlenmemiş arayüz");
    const eksikPortal = await iste(eksikAdres.port, "/portal/");
    const eksikApi = await iste(eksikAdres.port, "/portal/api/pano");
    const eksikBayi = await iste(eg, "/bayi/");
    kontrol("§4a ✓K arayüz yoksa /portal ve /bayi → 404, API yine yanıt verir (401)", eksikPortal.status === 404 && eksikBayi.status === 404 && eksikApi.status === 401, `${eksikPortal.status} ${eksikBayi.status} ${eksikApi.status}`);
  } finally {
    for (const s of [tailnet, yanlisSoket, genel, eksikTailnet, eksikGenel]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
    rmSync(kok, { recursive: true, force: true });
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
