// =============================================================================
// ERİŞİM KAPISI — satıcı portalının internetten yolu (portal.<alan>, Cloudflare proxy + Access). İstek portala
// YALNIZ geçerli `Cf-Access-Jwt-Assertion` ile ulaşır; bu yolda YALNIZ izin listesindeki rotalar var (opt-in: kök
// parolalı ve kullanıcı yönetimi uçları yok, kök imzası imza boğazında da reddedilir); tailnet yolu değişmez.
//   §1 yapılandırma: PORT_ERISIM yoksa dinleyici yok · ERISIM_BIND joker RED · takım alanı yalnız
//      <takım>.cloudflareaccess.com · AUD 64 onaltılık · ikisinden biri yoksa kip KAPALI
//   §2 doğrulayıcı (DB'siz, gerçek RSA, JWKS ağı sahte): her saldırı KENDİ gerekçesiyle RED — başlıksız ·
//      biçimsiz · yinelenen başlık · alg none / HS256 (anahtar karışması) · crit · kid yok · bozuk imza · aynı
//      kid başka anahtar · jetona gömülü jwk/jku YOK SAYILIR · yanlış aud · yanlış iss · süresi dolmuş · nbf/iat
//      gelecekte · exp yok · e-posta yok; aud dizisi · geçerli jeton geçer (pozitif kontrol)
//   §3 JWKS önbelleği (TTL tazeliktir, geçerlilik değil): hiç dolmamış + erişilemez → RED · bayat ama dolu →
//      GEÇER ve tazeleme denenir · BAYAT ≠ BOŞ · onarım · bilinmeyen kid tek çekim, soğuma içinde ikincisi yok ·
//      anahtar dönümü tek çekimle kabul · zehirli JWKS (<2048 bit, use/alg uyumsuz) anahtar vermez · adres sabit
//      §3h DOSYA kaynağı (satıcının TEK kaynağı; satıcı ağa çıkmaz): dosya yok / bozuk / boş küme → RED · eski ama
//      geçerli → kabul + yaş görünür · dolduktan sonra bozulursa bayat sürer · bilinmeyen kid dosyayı bir kez okur ·
//      sunucunun doğrulayıcısı ağa HİÇ çıkmaz · §3i yan konteyner (jwks-cekici): yalnız doğrulanmış anahtarı atomik
//      yazar, her başarısızlıkta eski dosya bayt-eşit kalır, geçici dosya bırakmaz · §3j yaş tavanı: tavanı aşan dosya
//      RED (JWKS_ESKI), yarısında uyarı, yenilenen dosya onarır, tavan ortamdan (1–30 gün, varsayılan 7)
//   §4 izin listesi (BEYANA bakar, gövde metnine değil): liste ⊆ rota tablosu · kök parolalı ve hassas izinli
//      (TAILNET_ONLY_PERMISSIONS) rota listede yok · doğrulayıcı sentetik kusurlu listede ısırır · kusurlu listeyle
//      yönlendirici KURULMAZ · §4g access-app BAĞLAMA ENVANTERİ: `createAccessApp`teki her `app.*` çağrısı (ara katman,
//      yönlendirici, rota, ayar) beklenen sıralı kümeyle BİREBİR — küme dışı bağlama (izin listesini atlayan yol) kırmızı
//   §5 compose: portal yönlendiricisinin Traefik ipallowlist aralıkları = CLOUDFLARE_NETWORKS · üst dosya satıcıya AĞ
//      EKLEMEZ, JWKS bağı satıcıda salt okunur · yan konteyner sertleştirilmiş, sırsız, yalnız kendi çıkış köprüsünde
//      · birleşik yapılandırmada (docker compose config) satıcının HER ağı internal (docker yoksa ÖLÇÜLEMEDİ beyanı)
//   §6 HTTP (süreç içi dinleyiciler, kendi `_test` DB'si): her tablo rotası ERİŞİM'de listeye göre bağlı (listede 401,
//      liste dışı 404) · yardımcıya devreden kök imza rotası 404 · listeye sızmış kök imzası İMZA BOĞAZINDA reddedilir ·
//      kullanıcı yönetimi 404 · denetim satırlarında Access e-postası + ERISIM_YAZMA ayak izi · JWT kapısız bağlanmış
//      ERİŞİM yönlendiricisi 404 · §7 gerçek süreç: açılış satırı, KAPALI kip ve JWKS dosyalı AÇIK kip
// ⭐ KALICI SONDA ✓K9 (her koşumda): (1) geçerli jeton GEÇER (§2a, §6c — her şeyi reddeden kör kapı yeşil veremez)
//    (2) BAYAT önbellek geçer, BOŞ önbellek reddeder (§3c) (3) AYNI kök parolalı istek tailnet'te 404 DEĞİL (§6k —
//    404 rotanın kapısından geliyor, eksik rotadan değil) (4) §4 doğrulayıcısı sentetik kusurlu listede ısırır
//    (5) dosya kaynağı geçerli dosyayla GEÇER (§3h4 · §3h7 — her dosyayı reddeden kör okuyucu yeşil veremez)
//    (6) yan konteyner geçerli yanıtı GERÇEKTEN yazar (§3i1 — hiç yazmayan çekici "eski dosya korundu" yeşili veremez)
//    (7) 8 günlük JWKS RED, aynı küme yenilenince GEÇER (§3j1 · §3j4) (8) listeye sızmış kök imza rotası TAILNET'te
//    GERÇEKTEN imzalar (§6q2 — boğazın reddi kör RED değil) (9) listedeki her rota ERİŞİM'de 401 (§6p — bağlama ölçülüyor)
//    (10–12) §4h bağlama envanteri sentetik ek yönlendiricide · yerel Router'da · JWT kapısı yönlendiricilerin arkasına
//    alınınca ısırır.
// NEGATİF SONDA (sertleştirme 2, dosya DIŞI): access-app.ts'e diskte `app.use("/hata-ayikla", createPortalRouter(ctx,
//   "TAILNET", …))` → §4g ❌ (§6 HTTP sondaları görmedi); cp + shasum ile geri alındı.
// Koşum: npx tsx scripts/test_erisim_kapisi.ts   (§6–§7 kendi _test DB'si)
// =============================================================================
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import ts from "typescript";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import {
  AccessVerifier,
  JwksCache,
  accessSettingsOf,
  createAccessVerifier,
  jwksFromFile,
  jwksUrlOf,
  missingAccessSettings,
  normalizeJwks,
  type AccessResult,
  type JwksFetch,
} from "../src/http/access-jwt";
import { cekiciAyari, jwksCekVeYaz } from "../src/jwks-cekici";
import express from "express";
import { createAccessApp, requireAccessJwt } from "../src/http/access-app";
import { CLOUDFLARE_NETWORKS } from "../src/http/client-address";
import { RAW_ROUTE_KEYS } from "../src/http/distribution-raw";
import { ERISIM_HAM_ROTALARI, ERISIM_PORTAL_ROTALARI } from "../src/http/erisim-rotalari";
import { errorHandler, notFound } from "../src/http/error-handler";
import { SESSION_ROUTE_KEYS, createPortalRouter, erisimListesiBulgulari, routeKey, type PortalRequestContext, type PortalRouteDef } from "../src/http/portal-http";
import { VENDOR_PORTAL_ROUTES } from "../src/http/portal-routes";
import { createTailnetApp } from "../src/http/tailnet-app";
import { passwordBuffer } from "../src/keys/key-files";
import { TAILNET_ONLY_PERMISSIONS } from "../src/portal/roles";
import { withSigningPasswordGuard } from "../src/portal/signing-guard";
import { prepareEntitlementVersion } from "../src/services/entitlement.service";
import {
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  temizlePortal,
  TEST_KOK_PAROLASI,
  totpKodu,
  type PortalKimlik,
} from "./lib/test-ortam";

const TABAN = { DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test" };
const TAKIM = "bekci-erisim.cloudflareaccess.com";
const AUD = randomBytes(32).toString("hex");
const EPOSTA = "bekci@ornek.test";

// ---------------------------------------------------------------- jeton ve JWKS düzeneği (gerçek RSA)
const rsa = (bit = 2048) => generateKeyPairSync("rsa", { modulusLength: bit });
const ANA = rsa();
const DONUM = rsa();
const SALDIRGAN = rsa();
const ZAYIF = rsa(1024);
const KID_ANA = `kid-ana-${randomUUID().slice(0, 8)}`;
const KID_DONUM = `kid-donum-${randomUUID().slice(0, 8)}`;

const jwk = (k: KeyObject, kid: string, ek: Record<string, unknown> = {}) => ({ ...(k.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "RS256", use: "sig", ...ek });
const jwks = (...keys: Record<string, unknown>[]) => JSON.stringify({ keys });
const b64u = (x: Buffer | string): string => Buffer.from(x).toString("base64url");

function jeton(ozel: KeyObject, baslik: Record<string, unknown>, yuk: Record<string, unknown>): string {
  const h = b64u(JSON.stringify(baslik));
  const p = b64u(JSON.stringify(yuk));
  return `${h}.${p}.${b64u(sign("sha256", Buffer.from(`${h}.${p}`), ozel))}`;
}

let saat = Date.parse("2026-09-30T12:00:00Z");
const simdiSn = (): number => Math.floor(saat / 1000);
const gecerliYuk = (ek: Record<string, unknown> = {}) => ({
  aud: [AUD],
  email: EPOSTA,
  sub: "sub-1",
  iss: `https://${TAKIM}`,
  iat: simdiSn() - 10,
  nbf: simdiSn() - 10,
  exp: simdiSn() + 3600,
  type: "app",
  ...ek,
});
const gecerli = (ek: Record<string, unknown> = {}) => jeton(ANA.privateKey, { alg: "RS256", kid: KID_ANA, typ: "JWT" }, gecerliYuk(ek));

/** Sahte JWKS ağı: istenen adres kaydedilir, `mod` ile kesinti kurulur, gövde değiştirilebilir. */
function sahteAg(govde: string) {
  const d = { mod: "calisir" as "calisir" | "duser", govde, cagri: 0, adresler: [] as string[] };
  const fetchJwks: JwksFetch = async (url) => {
    d.cagri++;
    d.adresler.push(url);
    if (d.mod === "duser") throw new Error("TST: ağ yok");
    return { status: 200, body: d.govde };
  };
  return { d, fetchJwks };
}

/** Önbellek kuralları kaynaktan bağımsızdır: ağ benzeri sahte kaynakla ölçülür; gerçek dosya kaynağı §3h'de. */
const AYAR = { teamDomain: TAKIM, aud: AUD, jwksFile: "(sahte kaynak)" };
function dogrulayici(ag: ReturnType<typeof sahteAg>, g: { ttlMs?: number; cooldownMs?: number } = {}) {
  const cache = new JwksCache({ source: jwksUrlOf(TAKIM), fetchJwks: ag.fetchJwks, now: () => saat, ttlMs: g.ttlMs ?? 60_000, cooldownMs: g.cooldownMs ?? 10_000, warn: () => undefined });
  return new AccessVerifier(AYAR, cache, () => saat);
}

/** Satırlar arasından üst dosyanın bir servis bloğu (iki boşluk girintili ad → sonraki servis ya da üst düzey anahtar). */
function servisBlogu(yaml: string, ad: string): string {
  const satirlar = yaml.split("\n");
  const bas = satirlar.findIndex((l) => l === `  ${ad}:`);
  if (bas < 0) return "";
  const son = satirlar.findIndex((l, i) => i > bas && (/^  [a-z0-9-]+:\s*$/.test(l) || /^[a-z]/.test(l)));
  return satirlar.slice(bas + 1, son < 0 ? undefined : son).join("\n");
}

const neden = (r: AccessResult): string => (r.ok ? "GECTI" : r.reason);

/** access-app'in beklenen `app.*` çağrıları (boşluksuz metin, sıra dahil) — yeni bağlama bilinçli satırla eklenir. */
const ERISIM_BAGLAMALARI: readonly string[] = [
  'disable("x-powered-by")',
  'set("etag",false)',
  "use(accessLog)",
  "use(requireOwnListener(deps.listener))",
  "use(requireAccessJwt(deps.verifier))",
  'use("/portal/api/ham",createDistributionRawRouter(ctx,"ERISIM"))',
  'use("/portal/api",createPortalRouter(ctx,"ERISIM",VENDOR_PORTAL_ROUTES))',
  'get("/",(_req:Request,res:Response)=>{res.set("Cache-Control","no-store").redirect(302,"/portal/");})',
  'use("/portal",createWebAppRouter(ctx.config.PORTAL_WEB_DIZINI,"portal"))',
  "use(notFound)",
  "use(errorHandler)",
];

const BAGLAMA_YONTEMLERI = new Set(["use", "get", "post", "put", "patch", "delete", "all", "head", "options", "route", "param", "set", "enable", "disable", "engine", "listen"]);
/** Yalnız uygulama/yönlendiricide olan yöntemler (Map'in get/set/delete'i karışmasın): `app` dışı alıcıda görülürse bulgu. */
const YALNIZ_YONLENDIRICI = new Set(["use", "route", "param", "all", "listen", "post", "put", "patch"]);

/**
 * access-app.ts'in `createAccessApp`indeki her `app.<yöntem>(…)` çağrısı (boşluksuz metin, sırayla) + yapı bulguları:
 * dosyada ikinci `express()` · `Router(` üretimi · `app` dışı alıcıya bağlama yöntemi çağrısı · `app`in başka ada aktarılması.
 */
function erisimBaglamalari(metin: string): { baglamalar: string[]; bulgular: string[] } {
  const sf = ts.createSourceFile("access-app.ts", metin, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const baglamalar: string[] = [];
  const bulgular: string[] = [];
  let expressCagrisi = 0;
  let fonksiyon = false;
  const yaz = (n: ts.Node) => n.getText(sf).replace(/\s+/g, "");
  const visit = (n: ts.Node, icinde: boolean): void => {
    const buIcinde = icinde || (ts.isFunctionDeclaration(n) && n.name?.text === "createAccessApp");
    if (ts.isFunctionDeclaration(n) && n.name?.text === "createAccessApp") fonksiyon = true;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && c.text === "express") expressCagrisi++;
      if ((ts.isIdentifier(c) && c.text === "Router") || (ts.isPropertyAccessExpression(c) && c.name.text === "Router")) bulgular.push(`Router üretimi: ${yaz(n).slice(0, 60)}`);
      if (ts.isPropertyAccessExpression(c)) {
        const alici = c.expression.getText(sf);
        if (alici === "app" && BAGLAMA_YONTEMLERI.has(c.name.text)) {
          if (buIcinde) baglamalar.push(`${c.name.text}(${n.arguments.map(yaz).join(",")})`);
          else bulgular.push(`createAccessApp dışında app çağrısı: ${yaz(n).slice(0, 80)}`);
        } else if (alici !== "app" && YALNIZ_YONLENDIRICI.has(c.name.text)) bulgular.push(`app dışı bağlama çağrısı: ${yaz(n).slice(0, 80)}`);
      }
    }
    if (buIcinde && ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.initializer) && n.initializer.text === "app") bulgular.push(`app başka ada aktarıldı: ${yaz(n)}`);
    n.forEachChild((k) => visit(k, buIcinde));
  };
  visit(sf, false);
  if (!fonksiyon) bulgular.push("createAccessApp bulunamadı");
  if (expressCagrisi !== 1) bulgular.push(`express() ${expressCagrisi} kez çağrıldı (beklenen 1)`);
  return { baglamalar, bulgular };
}

function dinle(server: http.Server): Promise<AddressInfo> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address() as AddressInfo)));
}
const kapatSunucu = (s: http.Server) => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())));

async function main(): Promise<void> {
  console.log("\n§1 yapılandırma");
  const reddeder = (env: Record<string, string>): boolean => {
    try {
      loadConfig({ ...TABAN, ...env });
      return false;
    } catch {
      return true;
    }
  };
  kontrol("§1a PORT_ERISIM verilmezse ERİŞİM dinleyicisi tanımsız", loadConfig(TABAN).PORT_ERISIM === undefined);
  kontrol("§1b ERISIM_BIND joker adres (0.0.0.0 · :: · boş) açılışta RED", ["0.0.0.0", "::", ""].every((j) => reddeder({ ERISIM_BIND: j })));
  kontrol(
    "§1c takım alanı yalnız <takım>.cloudflareaccess.com (başka alan · alt yol · kullanıcı bilgisi RED)",
    ["evil.com", "x.cloudflareaccess.com.evil.com", "cloudflareaccess.com", "a.b.cloudflareaccess.com", "https://x.cloudflareaccess.com/yol", "u@x.cloudflareaccess.com"].every((v) => reddeder({ CF_ACCESS_TAKIM_ALANI: v })),
  );
  const norm = loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: " https://Bekci-Erisim.cloudflareaccess.com/ ", CF_ACCESS_AUD: AUD.toUpperCase() });
  kontrol("§1d https:// öneki, sondaki / ve büyük harf normalleşir", norm.CF_ACCESS_TAKIM_ALANI === TAKIM && norm.CF_ACCESS_AUD === AUD, `${norm.CF_ACCESS_TAKIM_ALANI}`);
  kontrol("§1e AUD 64 onaltılık değilse RED", reddeder({ CF_ACCESS_AUD: "abc" }) && reddeder({ CF_ACCESS_AUD: `${AUD}0` }) && reddeder({ CF_ACCESS_AUD: "g".repeat(64) }));
  const uclu = { CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: "/erisim-jwks/certs.json" };
  kontrol(
    "§1f takım alanı, AUD ya da JWKS dosyası eksikse kip KAPALI (null); üçü varsa açık; eksikler ADIYLA sayılır",
    accessSettingsOf(loadConfig(TABAN)) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, ...uclu, CF_ACCESS_TAKIM_ALANI: "" })) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, ...uclu, CF_ACCESS_AUD: "" })) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD })) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, ...uclu }))?.jwksFile === "/erisim-jwks/certs.json" &&
      missingAccessSettings(loadConfig({ ...TABAN, CF_ACCESS_AUD: AUD })).join(",") === "CF_ACCESS_TAKIM_ALANI,CF_ACCESS_JWKS_DOSYASI",
  );

  console.log("\n§2 doğrulayıcı — her saldırı kendi gerekçesiyle");
  const ag = sahteAg(jwks(jwk(ANA.publicKey, KID_ANA)));
  const v = dogrulayici(ag);
  const ok = await v.verify(gecerli());
  kontrol("§2a ✓K geçerli jeton GEÇER, kimlik e-postası okunur", ok.ok && ok.identity.email === EPOSTA, neden(ok));
  kontrol("§2a2 JWKS YALNIZ takım alanından türeyen sabit adresten çekildi", ag.d.adresler.length > 0 && ag.d.adresler.every((a) => a === `https://${TAKIM}/cdn-cgi/access/certs`), ag.d.adresler.join(","));
  const [h, p, s] = gecerli().split(".") as [string, string, string];
  const vakalar: [string, string | string[] | undefined, string][] = [
    ["§2b başlıksız", undefined, "BASLIK_YOK"],
    ["§2b2 boş başlık", "", "BASLIK_YOK"],
    ["§2c iki parça", `${h}.${p}`, "BICIM"],
    ["§2c2 base64url dışı karakter", `${h}.${p}.${s}+`, "BICIM"],
    ["§2c3 yinelenen başlık (Node virgülle birleştirir)", `${gecerli()}, ${gecerli()}`, "BICIM"],
    ["§2c4 dizi başlık", [gecerli()], "BICIM"],
    ["§2c5 aşırı uzun", `${h}.${"A".repeat(9000)}.${s}`, "BICIM"],
    ["§2c6 alg none, imzasız", `${b64u(JSON.stringify({ alg: "none", kid: KID_ANA }))}.${p}.`, "BICIM"],
    ["§2d alg none, sahte imzalı", `${b64u(JSON.stringify({ alg: "none", kid: KID_ANA }))}.${p}.${s}`, "ALG"],
    ["§2d2 alg RS512", jeton(ANA.privateKey, { alg: "RS512", kid: KID_ANA }, gecerliYuk()), "ALG"],
    ["§2d3 crit başlığı", jeton(ANA.privateKey, { alg: "RS256", kid: KID_ANA, crit: ["exp"] }, gecerliYuk()), "ALG"],
    ["§2e kid yok", jeton(ANA.privateKey, { alg: "RS256" }, gecerliYuk()), "KID"],
    ["§2f yük değiştirilmiş (imza eski)", `${h}.${b64u(JSON.stringify(gecerliYuk({ email: "saldirgan@kotu.test" })))}.${s}`, "IMZA"],
    ["§2f2 aynı kid, saldırganın anahtarı", jeton(SALDIRGAN.privateKey, { alg: "RS256", kid: KID_ANA }, gecerliYuk()), "IMZA"],
    [
      "§2f3 jetona gömülü jwk + jku YOK SAYILIR (saldırganın anahtarı)",
      jeton(SALDIRGAN.privateKey, { alg: "RS256", kid: KID_ANA, jwk: jwk(SALDIRGAN.publicKey, KID_ANA), jku: "https://kotu.test/certs", x5u: "https://kotu.test/x5" }, gecerliYuk()),
      "IMZA",
    ],
    ["§2f4 kısaltılmış imza", `${h}.${p}.${s.slice(0, 40)}`, "IMZA"],
    ["§2g yanlış aud", gecerli({ aud: [randomBytes(32).toString("hex")] }), "AUD"],
    ["§2g2 aud yok", gecerli({ aud: undefined }), "AUD"],
    ["§2g3 aud dizide sayı", gecerli({ aud: [AUD, 5] }), "AUD"],
    ["§2h yanlış iss (başka takım)", gecerli({ iss: "https://baska.cloudflareaccess.com" }), "ISS"],
    ["§2h2 iss http şemalı", gecerli({ iss: `http://${TAKIM}` }), "ISS"],
    ["§2i süresi dolmuş", gecerli({ exp: simdiSn() - 3600, iat: simdiSn() - 7200, nbf: simdiSn() - 7200 }), "SURE"],
    ["§2i2 exp yok", gecerli({ exp: undefined }), "SURE"],
    ["§2i3 exp metin", gecerli({ exp: String(simdiSn() + 3600) }), "SURE"],
    ["§2i4 nbf gelecekte", gecerli({ nbf: simdiSn() + 600 }), "SURE"],
    ["§2i5 iat gelecekte", gecerli({ iat: simdiSn() + 600 }), "SURE"],
    ["§2j e-posta yok (hizmet belirteci)", gecerli({ email: undefined, common_name: "hizmet" }), "KIMLIK"],
    ["§2j2 boş e-posta", gecerli({ email: "" }), "KIMLIK"],
  ];
  for (const [ad, deger, beklenen] of vakalar) {
    const r = await v.verify(deger);
    kontrol(`${ad} → ${beklenen}`, neden(r) === beklenen, neden(r));
  }
  const hs = (() => {
    const hh = b64u(JSON.stringify({ alg: "HS256", kid: KID_ANA }));
    const pem = ANA.publicKey.export({ type: "spki", format: "pem" });
    return `${hh}.${p}.${b64u(createHmac("sha256", pem).update(`${hh}.${p}`).digest())}`;
  })();
  kontrol("§2d4 HS256 (açık anahtar HMAC sırrı — anahtar karışması) → ALG", neden(await v.verify(hs)) === "ALG", neden(await v.verify(hs)));
  const uydurmaSatir = await v.verify(`${b64u(JSON.stringify({ alg: "RS256\n[satici] erisim: SAHTE SATIR", kid: KID_ANA }))}.${p}.${s}`);
  kontrol(
    "§2d5 saldırganın alg değeri günlüğe HAM girmez (satır uydurma yok)",
    !uydurmaSatir.ok && uydurmaSatir.reason === "ALG" && uydurmaSatir.detail === "alg ?",
    uydurmaSatir.ok ? "GECTI" : JSON.stringify(uydurmaSatir.detail),
  );
  const dizi = await v.verify(gecerli({ aud: ["baska-uygulama", AUD] }));
  kontrol("§2k aud dizisi bu uygulamayı içeriyorsa geçer; tek metin aud da geçer", dizi.ok && (await v.verify(gecerli({ aud: AUD }))).ok, neden(dizi));
  const kenar = await v.verify(gecerli({ exp: simdiSn() + 5 }));
  kontrol("§2l süresi dolmak üzere ama dolmamış jeton geçer (saat payı ters yönde açmaz)", kenar.ok, neden(kenar));

  console.log("\n§3 JWKS önbelleği — bayatlık ≠ boşluk");
  const agBos = sahteAg(jwks(jwk(ANA.publicKey, KID_ANA)));
  agBos.d.mod = "duser";
  const vBos = dogrulayici(agBos);
  const bos = await vBos.verify(gecerli());
  kontrol("§3a HİÇ dolmamış + erişilemeyen JWKS: geçerli jeton bile RED (JWKS)", neden(bos) === "JWKS" && agBos.d.cagri === 1, `${neden(bos)} · çekim ${agBos.d.cagri}`);
  const bos2 = await vBos.verify(gecerli());
  kontrol("§3a2 soğuma içinde ikinci istek yeni çekim TETİKLEMEZ (sel Cloudflare'e yansımaz)", neden(bos2) === "JWKS" && agBos.d.cagri === 1, `çekim ${agBos.d.cagri}`);
  agBos.d.mod = "calisir";
  saat += 11_000;
  const onarim = await vBos.verify(gecerli());
  kontrol("§3b onarım: ağ dönünce (soğumadan sonra) boş önbellek dolar, jeton geçer", onarim.ok && agBos.d.cagri === 2, `${neden(onarim)} · çekim ${agBos.d.cagri}`);

  const agBayat = sahteAg(jwks(jwk(ANA.publicKey, KID_ANA)));
  const vBayat = dogrulayici(agBayat, { ttlMs: 60_000 });
  kontrol("§3c0 taze önbellek doldu", (await vBayat.verify(gecerli())).ok && agBayat.d.cagri === 1);
  saat += 120_000; // TTL geçti
  agBayat.d.mod = "duser";
  const bayat = await vBayat.verify(gecerli());
  await new Promise((r) => setImmediate(r));
  const durum = vBayat.jwks.state();
  kontrol(
    "§3c ✓K BAYAT ama dolu önbellek GEÇER; tazeleme arka planda denendi ve düştü",
    bayat.ok && agBayat.d.cagri === 2 && durum.filled && durum.lastError !== null,
    `${neden(bayat)} · çekim ${agBayat.d.cagri} · hata ${durum.lastError ?? "yok"}`,
  );
  kontrol("§3c2 ⭐ BAYAT ≠ BOŞ: aynı jeton, aynı kesinti, farklı cevap", bayat.ok && neden(bos) === "JWKS");

  const agKid = sahteAg(jwks(jwk(ANA.publicKey, KID_ANA)));
  const vKid = dogrulayici(agKid);
  await vKid.verify(gecerli());
  const donumJetonu = jeton(DONUM.privateKey, { alg: "RS256", kid: KID_DONUM }, gecerliYuk());
  saat += 11_000; // son çekimden soğuma süresi geçti
  const bilinmeyen = await vKid.verify(donumJetonu);
  kontrol("§3d bilinmeyen kid: bir kez tazeler, yine yoksa RED (KID)", neden(bilinmeyen) === "KID" && agKid.d.cagri === 2, `${neden(bilinmeyen)} · çekim ${agKid.d.cagri}`);
  const uydurma = await vKid.verify(jeton(DONUM.privateKey, { alg: "RS256", kid: `uydurma-${randomUUID()}` }, gecerliYuk()));
  kontrol("§3d2 soğuma içinde uydurma kid yeni çekim TETİKLEMEZ", neden(uydurma) === "KID" && agKid.d.cagri === 2, `çekim ${agKid.d.cagri}`);
  agKid.d.govde = jwks(jwk(ANA.publicKey, KID_ANA), jwk(DONUM.publicKey, KID_DONUM));
  saat += 11_000;
  const donum = await vKid.verify(donumJetonu);
  kontrol("§3e anahtar dönümü: yeni kid tek çekimle öğrenilir, jeton geçer; eski kid de geçer", donum.ok && agKid.d.cagri === 3 && (await vKid.verify(gecerli())).ok, `${neden(donum)} · çekim ${agKid.d.cagri}`);

  const zehir = async (govde: string): Promise<string> => neden(await dogrulayici(sahteAg(govde)).verify(gecerli()));
  kontrol("§3f zehirli JWKS: 1024 bit anahtar alınmaz → JWKS", (await zehir(jwks(jwk(ZAYIF.publicKey, KID_ANA)))) === "JWKS");
  kontrol("§3f2 use=enc ya da alg=RS512 anahtarı alınmaz → JWKS", (await zehir(jwks(jwk(ANA.publicKey, KID_ANA, { use: "enc" })))) === "JWKS" && (await zehir(jwks(jwk(ANA.publicKey, KID_ANA, { alg: "RS512" })))) === "JWKS");
  kontrol("§3f3 biçimsiz JWKS (keys yok / JSON değil) → JWKS", (await zehir(JSON.stringify({ anahtarlar: [] }))) === "JWKS" && (await zehir("<html>")) === "JWKS");
  const agHttp: JwksFetch = async () => ({ status: 302, body: jwks(jwk(ANA.publicKey, KID_ANA)) });
  const vHttp = new AccessVerifier(AYAR, new JwksCache({ source: jwksUrlOf(TAKIM), fetchJwks: agHttp, now: () => saat, warn: () => undefined }), () => saat);
  kontrol("§3f4 200 dışı yanıt (yönlendirme dahil) anahtar vermez → JWKS", neden(await vHttp.verify(gecerli())) === "JWKS");
  const SRC = path.join(__dirname, "..", "src");
  const kaynak = (f: string): string => readFileSync(path.join(SRC, f), "utf8");
  const agSrc = kaynak("http/access-jwt.ts");
  kontrol(
    "§3g ağ çekimi yönlendirme İZLEMEZ (redirect: \"error\"); sunucunun doğrulayıcısı YALNIZ dosya kaynağından, varsayılan ağ çekimi yok",
    /redirect:\s*"error"/.test(agSrc) && /fetchJwks:\s*jwksFromFile\(settings\.jwksFile\)/.test(agSrc) && !/\?\?\s*fetchJwksOverNetwork/.test(agSrc),
  );
  const tsDosyalari = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => f.split(path.sep).join("/"));
  const agiKullanan = tsDosyalari.filter((f) => kaynak(f).includes("fetchJwksOverNetwork")).sort();
  // Dosya düzeyi süzgeç tanımın KENDİ dosyasındaki ikinci kullanımı göremez: orada yalnız tanımın kendisi (1 kez) olmalı.
  const tanimDosyasindaki = (agSrc.match(/fetchJwksOverNetwork/g) ?? []).length;
  kontrol(
    "§3g2 ağ çekimini src/'de YALNIZ tanımı (kendi dosyasında 1 kez) ve yan konteynerin girişi anar (sunucu ağa çıkmaz)",
    tsDosyalari.length > 30 && JSON.stringify(agiKullanan) === JSON.stringify(["http/access-jwt.ts", "jwks-cekici.ts"]) && tanimDosyasindaki === 1,
    `${agiKullanan.join(", ")} · tanım dosyasında ${tanimDosyasindaki}`,
  );

  console.log("\n§3h JWKS DOSYA kaynağı (satıcının tek kaynağı) — aynı fail-closed kurallar");
  const jDizin = mkdtempSync(path.join(os.tmpdir(), "satici-jwks-"));
  const jDosya = path.join(jDizin, "certs.json");
  const gecerliKume = normalizeJwks(jwks(jwk(ANA.publicKey, KID_ANA))).json;
  const dosyaDogrulayici = () =>
    new AccessVerifier({ teamDomain: TAKIM, aud: AUD, jwksFile: jDosya }, new JwksCache({ source: jDosya, fetchJwks: jwksFromFile(jDosya), now: () => saat, ttlMs: 60_000, cooldownMs: 1_000, warn: () => undefined }), () => saat);
  const beklet = () => new Promise((r) => setTimeout(r, 30));
  try {
    kontrol("§3h1 dosya YOK (hiç dolmadı) → RED (JWKS)", neden(await dosyaDogrulayici().verify(gecerli())) === "JWKS");
    writeFileSync(jDosya, "{bozuk");
    kontrol("§3h2 BOZUK dosya (JSON değil) → RED (JWKS)", neden(await dosyaDogrulayici().verify(gecerli())) === "JWKS");
    writeFileSync(jDosya, JSON.stringify({ keys: [] }));
    kontrol("§3h3 BOŞ anahtar kümesi → RED (JWKS)", neden(await dosyaDogrulayici().verify(gecerli())) === "JWKS");
    mkdirSync(path.join(jDizin, "dizin.json"));
    const dizinV = new AccessVerifier({ teamDomain: TAKIM, aud: AUD, jwksFile: "x" }, new JwksCache({ source: "x", fetchJwks: jwksFromFile(path.join(jDizin, "dizin.json")), now: () => saat, warn: () => undefined }), () => saat);
    kontrol("§3h3b düz dosya olmayan yol → RED (JWKS)", neden(await dizinV.verify(gecerli())) === "JWKS");
    writeFileSync(jDosya, gecerliKume);
    const ikiGunOnce = (saat - 2 * 86_400_000) / 1000;
    utimesSync(jDosya, ikiGunOnce, ikiGunOnce);
    const dEski = dosyaDogrulayici();
    const eski = await dEski.verify(gecerli());
    const yas = dEski.jwks.state().sourceAgeSec ?? -1;
    kontrol("§3h4 ESKİ ama geçerli dosya → KABUL; dosya yaşı durumda görünür (~2 gün, mtime'dan)", eski.ok && Math.abs(yas - 172_800) < 120, `${neden(eski)} · yaş ${yas} sn`);
    writeFileSync(jDosya, "{bozuk");
    saat += 61_000;
    const bayatDosya = await dEski.verify(gecerli());
    await beklet();
    kontrol("§3h5 dolduktan sonra dosya bozulursa BAYAT küme sürer (kabul), hata durumda görünür", bayatDosya.ok && dEski.jwks.state().lastError !== null, `${neden(bayatDosya)} · ${dEski.jwks.state().lastError ?? "hata yok"}`);
    writeFileSync(jDosya, gecerliKume);
    const dKid = dosyaDogrulayici();
    await dKid.verify(gecerli());
    writeFileSync(jDosya, normalizeJwks(jwks(jwk(ANA.publicKey, KID_ANA), jwk(DONUM.publicKey, KID_DONUM))).json);
    saat += 2_000;
    const kidDosya = await dKid.verify(jeton(DONUM.privateKey, { alg: "RS256", kid: KID_DONUM }, gecerliYuk()));
    kontrol("§3h6 bilinmeyen kid → dosya BİR KEZ yeniden okunur, yeni anahtarla geçer (ağa gidilmez)", kidDosya.ok, neden(kidDosya));
    const gercekFetch = globalThis.fetch;
    let agCagrisi = 0;
    globalThis.fetch = (async () => {
      agCagrisi++;
      throw new Error("TST: ağ yasak");
    }) as typeof fetch;
    try {
      const simdiGercek = Math.floor(Date.now() / 1000);
      const gercekJeton = gecerli({ iat: simdiGercek - 5, nbf: simdiGercek - 5, exp: simdiGercek + 3600 });
      const sunucuV = createAccessVerifier(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: jDosya }));
      const r1 = sunucuV ? await sunucuV.verify(gercekJeton) : null;
      const yokV = createAccessVerifier(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: path.join(jDizin, "yok.json") }));
      const r2 = yokV ? await yokV.verify(gercekJeton) : null;
      kontrol(
        "§3h7 ⭐ sunucunun doğrulayıcısı dosyadan geçer, dosya yoksa RED — ve ağa HİÇ çıkmaz",
        r1?.ok === true && r2 !== null && neden(r2) === "JWKS" && agCagrisi === 0,
        `${r1 ? neden(r1) : "-"} / ${r2 ? neden(r2) : "-"} · ağ çağrısı ${agCagrisi}`,
      );
    } finally {
      globalThis.fetch = gercekFetch;
    }
  } finally {
    rmSync(jDizin, { recursive: true, force: true });
  }

  console.log("\n§3i yan konteyner (jwks-cekici): tek çekim, atomik yazım, başarısızlıkta eski dosya korunur");
  const cDizin = mkdtempSync(path.join(os.tmpdir(), "satici-jwks-cekici-"));
  const cDosya = path.join(cDizin, "certs.json");
  try {
    let istenen = "";
    const cAg =
      (cevap: () => { status: number; body: string }): JwksFetch =>
      async (u) => {
        istenen = u;
        return cevap();
      };
    const ilkGovde = JSON.stringify({ keys: [jwk(ANA.publicKey, KID_ANA), jwk(ZAYIF.publicKey, "zayif")], public_cert: { kid: "x", cert: "-----BEGIN CERTIFICATE-----" } });
    const ilk = await jwksCekVeYaz({ teamDomain: TAKIM, file: cDosya }, cAg(() => ({ status: 200, body: ilkGovde })));
    const yazilan = JSON.parse(readFileSync(cDosya, "utf8")) as { keys: { kid: string }[] } & Record<string, unknown>;
    kontrol(
      "§3i1 başarı: dosya yazılır, YALNIZ doğrulanmış anahtar (1024 bit ve fazlalık alanlar atılır), adres takım alanından",
      ilk.ok && yazilan.keys.length === 1 && yazilan.keys[0]?.kid === KID_ANA && !("public_cert" in yazilan) && istenen === `https://${TAKIM}/cdn-cgi/access/certs`,
      JSON.stringify({ ok: ilk.ok, n: yazilan.keys.length }),
    );
    const once = readFileSync(cDosya);
    const oku = (f: string): Buffer | null => {
      try {
        return readFileSync(f);
      } catch {
        return null;
      }
    };
    const hatalar: [string, JwksFetch][] = [
      ["HTTP 500", cAg(() => ({ status: 500, body: "x" }))],
      ["HTML gövde", cAg(() => ({ status: 200, body: "<html>" }))],
      ["boş küme", cAg(() => ({ status: 200, body: JSON.stringify({ keys: [] }) }))],
      ["yalnız zayıf anahtar", cAg(() => ({ status: 200, body: jwks(jwk(ZAYIF.publicKey, KID_ANA)) }))],
      [
        "ağ hatası",
        async () => {
          throw new Error("TST: ağ yok");
        },
      ],
    ];
    for (const [ad, f] of hatalar) {
      const r = await jwksCekVeYaz({ teamDomain: TAKIM, file: cDosya }, f);
      const simdiki = oku(cDosya);
      kontrol(
        `§3i2 ${ad}: eski dosya BAYT-EŞİT kalır, geçici dosya bırakılmaz`,
        !r.ok && simdiki !== null && simdiki.equals(once) && readdirSync(cDizin).length === 1,
        `${r.ok ? "YAZDI" : r.error}${simdiki === null ? " · eski dosya SİLİNDİ" : ""}`,
      );
      if (simdiki === null) writeFileSync(cDosya, once);
    }
    const ayarRed = (env: Record<string, string>): boolean => {
      try {
        cekiciAyari(env);
        return false;
      } catch {
        return true;
      }
    };
    const ayarTamam = cekiciAyari({ CF_ACCESS_TAKIM_ALANI: ` https://${TAKIM.toUpperCase()}/ `, JWKS_DOSYASI: "/erisim-jwks/certs.json" });
    kontrol(
      "§3i3 çekici ayarı: takım alanı sabitli (başka alan RED), dosya mutlak yol, aralık 1–60 dk (varsayılan 10)",
      ayarTamam.teamDomain === TAKIM &&
        ayarTamam.intervalMs === 600_000 &&
        ayarRed({ CF_ACCESS_TAKIM_ALANI: "evil.com", JWKS_DOSYASI: "/x" }) &&
        ayarRed({ CF_ACCESS_TAKIM_ALANI: TAKIM, JWKS_DOSYASI: "goreli.json" }) &&
        ayarRed({ CF_ACCESS_TAKIM_ALANI: TAKIM, JWKS_DOSYASI: "/x", JWKS_CEKIM_DK: "0" }),
    );
    const cekiciSrc = kaynak("jwks-cekici.ts");
    kontrol(
      "§3i4 yazım ATOMİK: aynı dizinde geçici dosya + fsync + rename; hedefe doğrudan yazım yok",
      /path\.join\(path\.dirname\(ayar\.file\)/.test(cekiciSrc) && /fsyncSync\(fd\)/.test(cekiciSrc) && /renameSync\(gecici, ayar\.file\)/.test(cekiciSrc) && !/writeFileSync\(ayar\.file/.test(cekiciSrc),
    );
  } finally {
    rmSync(cDizin, { recursive: true, force: true });
  }

  console.log("\n§3j JWKS yaş tavanı — eski ama geçerli küme tavana dek (varsayılan 7 gün), aşan RED");
  const yDizin = mkdtempSync(path.join(os.tmpdir(), "satici-jwks-yas-"));
  const yDosya = path.join(yDizin, "certs.json");
  try {
    writeFileSync(yDosya, gecerliKume);
    const gunOnce = (n: number): number => (saat - n * 86_400_000) / 1000;
    const uyarilar: string[] = [];
    const yasDogrulayici = () =>
      new AccessVerifier({ teamDomain: TAKIM, aud: AUD, jwksFile: yDosya }, new JwksCache({ source: yDosya, fetchJwks: jwksFromFile(yDosya), now: () => saat, ttlMs: 60_000, cooldownMs: 1_000, warn: (m) => uyarilar.push(m) }), () => saat);
    utimesSync(yDosya, gunOnce(8), gunOnce(8));
    const v8 = yasDogrulayici();
    const r8 = await v8.verify(gecerli());
    kontrol(
      "§3j1 ✓K 8 günlük dosya → RED (JWKS_ESKI); durum ASILDI, tavan 604800 sn; günlükte AŞILDI uyarısı",
      neden(r8) === "JWKS_ESKI" && v8.jwks.state().ageLevel === "ASILDI" && v8.jwks.state().maxSourceAgeSec === 604_800 && uyarilar.some((u) => /AŞILDI/.test(u)),
      `${neden(r8)} · ${v8.jwks.state().ageLevel} · ${uyarilar.length} uyarı`,
    );
    uyarilar.length = 0;
    utimesSync(yDosya, gunOnce(5), gunOnce(5));
    const v5 = yasDogrulayici();
    const r5 = await v5.verify(gecerli());
    kontrol("§3j2 5 günlük dosya (tavanın yarısı geçti) → KABUL, durum UYARI, günlükte uyarı", r5.ok && v5.jwks.state().ageLevel === "UYARI" && uyarilar.some((u) => /yarısı geçti/.test(u)), `${neden(r5)} · ${v5.jwks.state().ageLevel}`);
    uyarilar.length = 0;
    utimesSync(yDosya, gunOnce(2), gunOnce(2));
    const v2 = yasDogrulayici();
    const r2 = await v2.verify(gecerli());
    kontrol("§3j3 2 günlük dosya → KABUL, durum TAZE, uyarı YOK", r2.ok && v2.jwks.state().ageLevel === "TAZE" && uyarilar.length === 0, `${neden(r2)} · ${v2.jwks.state().ageLevel}`);
    writeFileSync(yDosya, gecerliKume);
    utimesSync(yDosya, saat / 1000, saat / 1000);
    saat += 2_000;
    const onarim8 = await v8.verify(gecerli());
    kontrol("§3j4 ✓K aynı doğrulayıcı: yan konteyner dosyayı yenileyince (mtime şimdi) küme yeniden okunur ve GEÇER", onarim8.ok && v8.jwks.state().ageLevel === "TAZE", `${neden(onarim8)} · ${v8.jwks.state().ageLevel}`);
    const tavanRed = (deger: string): boolean => {
      try {
        loadConfig({ ...TABAN, CF_ACCESS_JWKS_AZAMI_YAS_GUN: deger });
        return false;
      } catch {
        return true;
      }
    };
    kontrol(
      "§3j5 tavan ortamdan: varsayılan 7 gün, 1–30 dışı açılışta RED",
      loadConfig(TABAN).CF_ACCESS_JWKS_AZAMI_YAS_GUN === 7 && loadConfig({ ...TABAN, CF_ACCESS_JWKS_AZAMI_YAS_GUN: "2" }).CF_ACCESS_JWKS_AZAMI_YAS_GUN === 2 && tavanRed("0") && tavanRed("31") && tavanRed("x"),
    );
    const simdiG = Date.now();
    const gercekJ = gecerli({ iat: Math.floor(simdiG / 1000) - 5, nbf: Math.floor(simdiG / 1000) - 5, exp: Math.floor(simdiG / 1000) + 3600 });
    utimesSync(yDosya, (simdiG - 3 * 86_400_000) / 1000, (simdiG - 3 * 86_400_000) / 1000);
    const ayarli = (gun?: string) => createAccessVerifier(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: yDosya, ...(gun ? { CF_ACCESS_JWKS_AZAMI_YAS_GUN: gun } : {}) }));
    const r3g2 = await ayarli("2")?.verify(gercekJ);
    const r3g7 = await ayarli()?.verify(gercekJ);
    kontrol("§3j6 sunucunun doğrulayıcısı tavanı yapılandırmadan alır: 3 günlük dosya tavan 2 günde RED, varsayılanla KABUL", !!r3g2 && neden(r3g2) === "JWKS_ESKI" && !!r3g7 && r3g7.ok, `${r3g2 ? neden(r3g2) : "-"} / ${r3g7 ? neden(r3g7) : "-"}`);
  } finally {
    rmSync(yDizin, { recursive: true, force: true });
  }

  console.log("\n§4 ERİŞİM izin listesi (opt-in) — beyana bakar, gövde metnine değil");
  const liste = [...ERISIM_PORTAL_ROTALARI];
  const tablo = new Map(VENDOR_PORTAL_ROUTES.map((r) => [routeKey(r.method, r.path), r]));
  const bulgular = erisimListesiBulgulari(VENDOR_PORTAL_ROUTES, ERISIM_PORTAL_ROTALARI);
  kontrol("§4a liste geçerli: her satır tabloda (ya da oturum ucu), kök parolalı ve hassas izinli rota YOK", bulgular.length === 0, bulgular.join(" | "));
  const kokluler = VENDOR_PORTAL_ROUTES.filter((r) => r.kokParolasi).map((r) => routeKey(r.method, r.path));
  const hassaslar = VENDOR_PORTAL_ROUTES.filter((r) => TAILNET_ONLY_PERMISSIONS.includes(r.permission)).map((r) => routeKey(r.method, r.path));
  kontrol(
    "§4b kök imzası, kullanıcı yönetimi (açma · TOTP sıfırlama · parola sıfırlama · liste) ve güven kökü ekleyen anahtar kayıtları (bayi anahtarı bağlama · yayıncı anahtarı kaydı) listede DEĞİL; kümeler boş değil",
    kokluler.includes("POST /haklar/:id/surum") &&
      ["GET /kullanicilar", "POST /kullanicilar", "POST /kullanicilar/:id/totp-sifirla", "POST /kullanicilar/:id/parola", "POST /bayiler/:id/anahtar", "POST /yayincilar"].every((k) =>
        hassaslar.includes(k),
      ) &&
      [...kokluler, ...hassaslar].every((k) => !ERISIM_PORTAL_ROTALARI.has(k)),
    `${kokluler.length} kök · ${hassaslar.length} hassas`,
  );
  kontrol(
    "§4c liste giriş/çıkış/oturum/parola değişimi uçlarını, temel okumayı, etkinleştirme kodunu, yayıncı pasife almayı ve bildirimleri (bilinçli satır) taşır (boş liste yeşil vermez)",
    SESSION_ROUTE_KEYS.every((k) => ERISIM_PORTAL_ROTALARI.has(k)) &&
      ["GET /pano", "POST /kurulumlar/:id/yaptirim", "POST /kurulumlar/:id/etkinlestirme-kodu", "POST /yayincilar/:id/pasif", "GET /bildirimler", "GET /bildirimler/durum", "POST /bildirimler/deneme"].every((k) =>
        ERISIM_PORTAL_ROTALARI.has(k),
      ),
    `${liste.length} satır`,
  );
  const sentetikListe = new Set([...ERISIM_PORTAL_ROTALARI, "POST /haklar/:id/surum", "POST /kullanicilar/:id/totp-sifirla", "GET /olmayan-rota"]);
  const sonda = erisimListesiBulgulari(VENDOR_PORTAL_ROUTES, sentetikListe);
  kontrol(
    "§4d ✓K doğrulayıcı sentetik kusurlu listede ısırır: kök parolalı · hassas izinli · tabloda olmayan satır",
    sonda.length === 3 && sonda.some((b) => b.startsWith("POST /haklar/:id/surum")) && sonda.some((b) => b.startsWith("POST /kullanicilar/:id/totp-sifirla")) && sonda.some((b) => b.startsWith("GET /olmayan-rota")),
    sonda.join(" | "),
  );
  const kurulamadi = (routes: readonly PortalRouteDef[]): string => {
    try {
      createPortalRouter({} as never, "ERISIM", routes);
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };
  const kokBeyanli = VENDOR_PORTAL_ROUTES.map((r) => (routeKey(r.method, r.path) === "POST /kurulumlar/:id/yaptirim" ? { ...r, kokParolasi: true as const } : r));
  const hata = kurulamadi(kokBeyanli);
  kontrol("§4e listede kök parolalı rota varsa ERİŞİM yönlendiricisi KURULMAZ (açılış durur)", /kök parolalı rota ERİŞİM'e açılamaz/.test(hata), hata.slice(0, 120));
  kontrol("§4f ham ERİŞİM listesi ham yönlendiricinin rotalarının alt kümesi (parça PUT + dosya indirme)", [...ERISIM_HAM_ROTALARI].every((k) => RAW_ROUTE_KEYS.includes(k)) && ERISIM_HAM_ROTALARI.size === 2);
  const disarida = [...tablo.keys()].filter((k) => !ERISIM_PORTAL_ROTALARI.has(k));
  console.log(`  ℹ️  ERİŞİM dışı ${disarida.length} tablo rotası (tailnet/geri döngüden): ${disarida.join(" · ")}`);
  const erisimUygulamasi = readFileSync(path.join(__dirname, "..", "src", "http", "access-app.ts"), "utf8");
  const envanter = erisimBaglamalari(erisimUygulamasi);
  const farklar = (e: typeof envanter) => [
    ...e.bulgular,
    ...e.baglamalar.filter((b, i) => b !== ERISIM_BAGLAMALARI[i]).map((b) => `beklenmeyen: ${b}`),
    ...ERISIM_BAGLAMALARI.filter((b, i) => e.baglamalar[i] !== b).map((b) => `eksik/yer değiştirmiş: ${b}`),
  ];
  const baglamaFarki = farklar(envanter);
  kontrol(
    `§4g access-app bağlama envanteri beklenen ${ERISIM_BAGLAMALARI.length} çağrıyla BİREBİR (sıra dahil: soket → JWT → yönlendiriciler → 404)`,
    baglamaFarki.length === 0,
    baglamaFarki.join(" | ").slice(0, 300) || `${envanter.baglamalar.length} çağrı`,
  );
  const ekli = erisimBaglamalari(erisimUygulamasi.replace('  app.use("/portal", createWebAppRouter', '  app.use("/hata-ayikla", createPortalRouter(ctx, "TAILNET", VENDOR_PORTAL_ROUTES));\n  app.use("/portal", createWebAppRouter'));
  const yerel = erisimBaglamalari(erisimUygulamasi.replace("  app.use(notFound);", '  const r = express.Router();\n  r.get("/ic", (_q: Request, s2: Response) => s2.end());\n  app.use(r);\n  app.use(notFound);'));
  const once = erisimBaglamalari(erisimUygulamasi.replace("  app.use(requireAccessJwt(deps.verifier));\n", "").replace("  app.use(notFound);", "  app.use(requireAccessJwt(deps.verifier));\n  app.use(notFound);"));
  kontrol(
    "§4h ✓K envanter ısırır: ek yönlendirici (izin listesiz TAILNET portalı) · yerel Router + ek bağlama · JWT kapısı yönlendiricilerin ARKASINA",
    farklar(ekli).some((x) => x.includes('/hata-ayikla')) && farklar(yerel).some((x) => x.includes("Router")) && farklar(once).length > 0 && ekli.baglamalar.length === ERISIM_BAGLAMALARI.length + 1,
    `${farklar(ekli).length} · ${farklar(yerel).length} · ${farklar(once).length}`,
  );

  console.log("\n§5 compose (Traefik ipallowlist = Cloudflare aralıkları · satıcı dış bağlantısız · yan konteyner)");
  const composeYolu = path.join(__dirname, "..", "..", "..", "deploy", "satici", "docker-compose.portal-genel.yml");
  const compose = readFileSync(composeYolu, "utf8");
  const aralik = /ipallowlist\.sourcerange=([^"\n]+)/.exec(compose)?.[1]?.split(",").map((x) => x.trim()) ?? [];
  const fark = [...aralik.filter((x) => !CLOUDFLARE_NETWORKS.includes(x)), ...CLOUDFLARE_NETWORKS.filter((x) => !aralik.includes(x))];
  kontrol("§5a portal yönlendiricisinin kaynak listesi CLOUDFLARE_NETWORKS ile birebir", aralik.length > 0 && fark.length === 0, fark.join(",") || `${aralik.length} aralık`);
  const R = "routers\\.tekserp-satici-\\$\\{ORTAM\\}-portal";
  const mw = new RegExp(`${R}\\.middlewares=([^\\s"]+)`).exec(compose)?.[1] ?? "";
  const mwTanimli = mw !== "" && compose.includes(`middlewares.${mw}.ipallowlist.sourcerange=`);
  kontrol(
    "§5b portal yönlendiricisi: Host kuralı · kendi servisi 4613 · ipallowlist ara katmanı BAĞLI · ana yönlendirici kendi servisine açık bağlı",
    new RegExp(`${R}\\.rule=Host\\(\`\\$\\{PORTAL_HOST`).test(compose) &&
      new RegExp(`${R}\\.service=tekserp-satici-\\$\\{ORTAM\\}-portal`).test(compose) &&
      /services\.tekserp-satici-\$\{ORTAM\}-portal\.loadbalancer\.server\.port=4613/.test(compose) &&
      mwTanimli &&
      /routers\.tekserp-satici-\$\{ORTAM\}\.service=tekserp-satici-\$\{ORTAM\}\s*$/m.test(compose),
    mw || "ara katman yok",
  );
  kontrol("§5c ERİŞİM portu yayımlanmaz, dinleyici kenar adresinde, Access ayarı zorunlu (:?)", !/^\s*ports:/m.test(compose) && /ERISIM_BIND:\s*\$\{KENAR_IP\}/.test(compose) && /CF_ACCESS_TAKIM_ALANI:\s*\$\{CF_ACCESS_TAKIM_ALANI:\?/.test(compose) && /CF_ACCESS_AUD:\s*\$\{CF_ACCESS_AUD:\?/.test(compose));
  const saticiB = servisBlogu(compose, "satici");
  const jwksB = servisBlogu(compose, "satici-jwks");
  kontrol(
    "§5d üst dosya satıcıya AĞ EKLEMEZ; JWKS bağı satıcıda SALT OKUNUR ve dizin önceden kurulmalı (create_host_path: false)",
    saticiB !== "" && !/^    networks:/m.test(saticiB) && /target: \/erisim-jwks\n\s+read_only: true\n\s+bind: \{ create_host_path: false \}/.test(saticiB) && /CF_ACCESS_JWKS_DOSYASI: \/erisim-jwks\//.test(saticiB),
  );
  kontrol(
    "§5d2 yan konteyner: aynı imaj, satici-baslat atlanır, root değil, salt okunur kök FS, yetenek yok, sır/anahtar birimi/port yok, YALNIZ kendi çıkış köprüsünde",
    jwksB !== "" &&
      /image: \$\{SATICI_IMAJ/.test(jwksB) &&
      /entrypoint: \["node", "\/uygulama\/dist\/jwks-cekici\.js"\]/.test(jwksB) &&
      /user: "10001:10001"/.test(jwksB) &&
      /read_only: true/.test(jwksB) &&
      /cap_drop: \["ALL"\]/.test(jwksB) &&
      /no-new-privileges:true/.test(jwksB) &&
      /networks: \[jwks-cikis\]/.test(jwksB) &&
      !/secrets:|anahtarlar|ports:|DATABASE_URL/.test(jwksB),
  );
  kontrol("§5d3 eski satıcı çıkış ağı (ERISIM_CIKIS_AGI / erisim-cikis) YOK", !/ERISIM_CIKIS_AGI|erisim-cikis/.test(compose));
  const composeKoku = path.dirname(composeYolu);
  const dockerVar = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;
  if (!dockerVar) {
    console.log("  ⏭ §5e ÖLÇÜLEMEDİ: docker compose yok — birleşik yapılandırma ölçülmedi (statik §5d koştu)");
  } else {
    const gDizin = mkdtempSync(path.join(os.tmpdir(), "satici-compose-"));
    try {
      const ortamMetni = readFileSync(path.join(composeKoku, "ornek.env"), "utf8")
        .replace(/^SATICI_IMAJ=.*$/m, "SATICI_IMAJ=tekserp-satici:bekci")
        .replace(/^SATICI_YEDEK_IMAJ=.*$/m, "SATICI_YEDEK_IMAJ=tekserp-satici-yedek:bekci")
        .replace(/^TAILNET_IP=.*$/m, "TAILNET_IP=100.64.0.9");
      const envDosyasi = path.join(gDizin, "bekci.env");
      writeFileSync(envDosyasi, `${ortamMetni}\nPORTAL_HOST=portal.bekci.test\nCF_ACCESS_TAKIM_ALANI=${TAKIM}\nCF_ACCESS_AUD=${AUD}\nERISIM_JWKS_DIZINI_HOST=${gDizin}\nJWKS_CIKIS_AGI=172.31.255.0/29\n`);
      type Birlesik = { services: Record<string, { networks?: Record<string, unknown>; volumes?: { target?: string; read_only?: boolean }[] }>; networks: Record<string, { internal?: boolean }> };
      const birlestir = (dosyalar: string[]): Birlesik | string => {
        const r = spawnSync("docker", ["compose", "--env-file", envDosyasi, ...dosyalar.flatMap((f) => ["-f", path.join(composeKoku, f)]), "config", "--format", "json"], { encoding: "utf8" });
        return r.status === 0 ? (JSON.parse(r.stdout) as Birlesik) : (r.stderr || "config başarısız").trim().slice(0, 300);
      };
      const loop = birlestir(["docker-compose.yml", "docker-compose.loopback.yml", "docker-compose.portal-genel.yml"]);
      const ana = birlestir(["docker-compose.yml", "docker-compose.portal-genel.yml"]);
      if (typeof loop === "string" || typeof ana === "string") {
        kontrol("§5e birleşik yapılandırma çözüldü", false, typeof loop === "string" ? loop : String(ana));
      } else {
        const aglar = (c: Birlesik, sv: string) => Object.keys(c.services[sv]?.networks ?? {});
        const dis = (c: Birlesik, sv: string) => aglar(c, sv).filter((n) => c.networks[n]?.internal !== true);
        const uyeler = (c: Birlesik, ag: string) => Object.entries(c.services).filter(([, s]) => ag in (s.networks ?? {})).map(([a]) => a);
        const bag = (c: Birlesik, sv: string) => (c.services[sv]?.volumes ?? []).find((v) => v.target === "/erisim-jwks");
        kontrol(
          "§5e ⭐ geri döngü kipi (bugünkü kurulum): satıcının katıldığı HER ağ internal — dış bağlantı yok",
          aglar(loop, "satici").length >= 4 && dis(loop, "satici").length === 0,
          `ağlar: ${aglar(loop, "satici").join(",")} · internal olmayan: ${dis(loop, "satici").join(",") || "yok"}`,
        );
        kontrol(
          "§5e2 ana kip: satıcının internal olmayan TEK ağı tailnet (Tailscale yayını; DOCKER-USER ile çıkışı kapalı) — üst dosya ağ eklemedi",
          JSON.stringify(dis(ana, "satici")) === JSON.stringify(["tailnet"]),
          dis(ana, "satici").join(","),
        );
        kontrol(
          "§5e3 çıkışlı köprünün (jwks-cikis) TEK üyesi satici-jwks; JWKS bağı satıcıda ro, yan konteynerde rw",
          JSON.stringify(uyeler(loop, "jwks-cikis")) === JSON.stringify(["satici-jwks"]) &&
            loop.networks["jwks-cikis"]?.internal !== true &&
            bag(loop, "satici")?.read_only === true &&
            bag(loop, "satici-jwks") !== undefined &&
            bag(loop, "satici-jwks")?.read_only !== true,
          uyeler(loop, "jwks-cikis").join(","),
        );
      }
    } finally {
      rmSync(gDizin, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- §6 HTTP
  hedefDbKapisi();
  process.env.SATICI_ERISIM_GUNLUGU ??= "0";
  const webDizini = mkdtempSync(path.join(os.tmpdir(), "satici-erisim-web-"));
  mkdirSync(path.join(webDizini, "portal"), { recursive: true });
  writeFileSync(path.join(webDizini, "portal", "portal.html"), "<!doctype html><title>portal</title>");
  const jwksDosyasi = path.join(webDizini, "certs.json");
  writeFileSync(jwksDosyasi, normalizeJwks(jwks(jwk(ANA.publicKey, KID_ANA))).json);
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000", PORTAL_WEB_DIZINI: webDizini });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  saat = Date.now();
  // Sunucunun kurduğu doğrulayıcının AYNISI: yapılandırmadan, JWKS yan konteynerin dosyasından.
  const httpV = createAccessVerifier(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: jwksDosyasi }));
  if (!httpV) throw new Error("doğrulayıcı kurulamadı");
  let tailnetAdresi: AddressInfo | null = null;
  let erisimAdresi: AddressInfo | null = null;
  let kapaliAdresi: AddressInfo | null = null;
  const tailnet = http.createServer(createTailnetApp(ctx, null, () => tailnetAdresi, httpV));
  const erisimApp = createAccessApp(ctx, { listener: () => erisimAdresi, verifier: httpV });
  const erisim = http.createServer(erisimApp);
  const yanlisSoket = http.createServer(erisimApp);
  const kapali = http.createServer(createAccessApp(ctx, { listener: () => kapaliAdresi, verifier: null }));
  // Sentetik yönlendiriciler (§6q–§6t): ERİŞİM = JWT kapısı + opt-in yönlendirici; TAILNET = geçiren kök kapısı.
  const sondaSunuculari: http.Server[] = [];
  const sondaKur = async (listener: "ERISIM" | "TAILNET", routes: readonly PortalRouteDef[], jwtKapisi = true): Promise<string> => {
    const app = express();
    if (listener === "ERISIM" && jwtKapisi) app.use(requireAccessJwt(httpV));
    app.use("/portal/api", createPortalRouter(ctx, listener, routes, listener === "TAILNET" ? { rootPasswordGate: (_q, _r, n) => n() } : {}));
    app.use(notFound);
    app.use(errorHandler);
    const srv = http.createServer(app);
    sondaSunuculari.push(srv);
    return `http://127.0.0.1:${(await dinle(srv)).port}`;
  };
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const kurulumlar: string[] = [];
  try {
    tailnetAdresi = await dinle(tailnet);
    erisimAdresi = await dinle(erisim);
    const yanlisAdres = await dinle(yanlisSoket);
    kapaliAdresi = await dinle(kapali);
    const T = `http://127.0.0.1:${tailnetAdresi.port}`;
    const E = `http://127.0.0.1:${erisimAdresi.port}`;
    const JWT = { "cf-access-jwt-assertion": gecerli({ exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) - 5, nbf: Math.floor(Date.now() / 1000) - 5 }) };

    console.log("\n§6 HTTP — ERİŞİM dinleyicisi");
    const r0 = await portalIstek(E, "/portal/api/oturum");
    kontrol("§6a başlıksız istek → 404 (portal var mı sızdırılmaz)", r0.status === 404 && r0.kod === "BULUNAMADI", `${r0.status} ${r0.kod}`);
    const r0b = await portalIstek(E, "/portal/api/oturum", { basliklar: { "cf-access-jwt-assertion": jeton(SALDIRGAN.privateKey, { alg: "RS256", kid: KID_ANA }, gecerliYuk()) } });
    kontrol("§6b sahte imzalı başlık → 404", r0b.status === 404, `${r0b.status}`);
    const r1 = await portalIstek(E, "/portal/api/oturum", { basliklar: JWT });
    kontrol("§6c ✓K geçerli JWT kapıyı geçer: oturumsuz portal ucu 401 OTURUM_YOK (404 değil)", r1.status === 401 && r1.kod === "OTURUM_YOK", `${r1.status} ${r1.kod}`);
    const kp = await portalIstek(`http://127.0.0.1:${kapaliAdresi.port}`, "/portal/api/oturum", { basliklar: JWT });
    kontrol("§6d Access ayarı yok (KAPALI) → geçerli görünen istek de 404", kp.status === 404, `${kp.status}`);
    const ys = await portalIstek(`http://127.0.0.1:${yanlisAdres.port}`, "/portal/api/oturum", { basliklar: JWT });
    kontrol("§6e aynı uygulama BAŞKA sokette → 404 (soket koşulu okunuyor)", ys.status === 404, `${ys.status}`);
    const html = await fetch(`${E}/portal/`, { headers: JWT });
    const htmlYok = await fetch(`${E}/portal/`);
    kontrol("§6f web arayüzü de kapının ARKASINDA: JWT'li 200 HTML, JWT'siz 404", html.status === 200 && /portal/.test(await html.text()) && htmlYok.status === 404, `${html.status}/${htmlYok.status}`);
    const kok = await fetch(`${E}/`, { headers: JWT, redirect: "manual" });
    kontrol("§6f2 kök adres /portal/'e yönlenir (yalnız JWT'li)", kok.status === 302 && kok.headers.get("location") === "/portal/" && (await fetch(`${E}/`, { redirect: "manual" })).status === 404);

    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const tGiris = await portalGiris(T, "/portal/api", yonetici);
    const eGirisJwtsiz = await portalGiris(E, "/portal/api", yonetici, { adimKaydir: 1 });
    kontrol("§6g giriş ucu da kapının arkasında: JWT'siz giriş 404, sayaç değişmez", eGirisJwtsiz.status === 404 && (await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id } })).basarisizGiris === 0, `${eGirisJwtsiz.status}`);
    const eGiris = await portalGiris(E, "/portal/api", yonetici, { adimKaydir: 1, basliklar: JWT });
    kontrol("§6h satıcı yöneticisi ERİŞİM'den girer (parola + TOTP) → 200", tGiris.status === 200 && eGiris.status === 200, `${tGiris.status}/${eGiris.status} ${eGiris.kod ?? ""}`);
    kontrol("§6h2 ERİŞİM çerezi HttpOnly + SameSite=Strict + Secure + Path=/portal", /HttpOnly/.test(eGiris.setCookie ?? "") && /SameSite=Strict/.test(eGiris.setCookie ?? "") && /Secure/.test(eGiris.setCookie ?? "") && /Path=\/portal(;|$)/.test(eGiris.setCookie ?? ""), (eGiris.setCookie ?? "").replace(/=[^;]+/, "=***"));
    kontrol("§6h3 oturum yanıtı dinleyiciyi ERISIM bildirir", eGiris.veri.dinleyici === "ERISIM", String(eGiris.veri.dinleyici));
    const eCerez = eGiris.cerez!;
    const tCerez = tGiris.cerez!;
    const oturumSatiri = await prisma.portalOturumu.findFirst({ where: { kullaniciId: yonetici.id, dinleyici: "ERISIM" } });
    kontrol("§6h4 DB'de oturum ERISIM dinleyicisine bağlı doğdu", oturumSatiri !== null);
    const pano = await portalIstek(E, "/portal/api/pano", { cerez: eCerez, basliklar: JWT });
    kontrol("§6i ERİŞİM oturumu + JWT → portal okunur (200)", pano.status === 200, `${pano.status} ${pano.kod ?? ""}`);
    const panoJwtsiz = await portalIstek(E, "/portal/api/pano", { cerez: eCerez });
    kontrol("§6i2 oturum çerezi TEK başına yetmez: JWT'siz her istek 404", panoJwtsiz.status === 404, `${panoJwtsiz.status}`);
    const tasinanE = await portalIstek(T, "/portal/api/pano", { cerez: eCerez });
    const tasinanT = await portalIstek(E, "/portal/api/pano", { cerez: tCerez, basliklar: JWT });
    kontrol("§6j oturum dinleyiciye bağlı: ERİŞİM oturumu tailnet'te 401, tailnet oturumu ERİŞİM'de 401", tasinanE.status === 401 && tasinanT.status === 401, `${tasinanE.status}/${tasinanT.status}`);

    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const kokGovde = { clientToken: randomUUID(), kokParolasi: "yanlis-parola-bekci", sebep: "erişim bekçisi" };
    const kokE = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: kokGovde });
    const kokEOturumsuz = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { basliklar: JWT, govde: kokGovde });
    const kokEFormsuz = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: "x=1", icerikTuru: "application/x-www-form-urlencoded" });
    kontrol(
      "§6k ⭐ kök parolalı uç ERİŞİM'de 404 (oturumlu · oturumsuz · JSON dışı gövdeyle de — tailnet kapısı gövdeden ÖNCE)",
      kokE.status === 404 && kokEOturumsuz.status === 404 && kokEFormsuz.status === 404,
      `${kokE.status}/${kokEOturumsuz.status}/${kokEFormsuz.status}`,
    );
    const kokT = await portalIstek(T, `/portal/api/haklar/${k.hakId}/surum`, { cerez: tCerez, govde: { ...kokGovde, clientToken: randomUUID() } });
    kontrol("§6k2 ✓K AYNI istek tailnet'te rotaya ULAŞIR (400 IMZA_PAROLASI_HATALI — 404 rotanın kapısından)", kokT.status === 400 && kokT.kod === "IMZA_PAROLASI_HATALI", `${kokT.status} ${kokT.kod ?? ""}`);
    const sayac = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id }, select: { imzaBasarisiz: true } });
    kontrol("§6k3 ERİŞİM'deki denemeler imza sayacına girmedi (yalnız tailnet'teki tek deneme)", sayac.imzaBasarisiz === 1, `${sayac.imzaBasarisiz}`);
    const hakSurum = await prisma.hakSurumu.count({ where: { hakId: k.hakId } });
    kontrol("§6k4 hiçbir yeni imzalı sürüm doğmadı", hakSurum === 1, `${hakSurum}`);
    const yaz = await portalIstek(E, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, {
      cerez: eCerez,
      basliklar: JWT,
      govde: { clientToken: randomUUID(), kademe: "K0", mesaj: "Hatırlatma", sebep: "erişim bekçisi" },
    });
    kontrol("§6l kök parolasız yazma ERİŞİM'de çalışır (K0 → 201)", yaz.status === 201, `${yaz.status} ${yaz.kod ?? ""}`);

    const bayiR = await portalIstek(T, "/portal/api/bayiler", {
      cerez: tCerez,
      govde: { clientToken: randomUUID(), ad: "Erişim Bekçi Bayisi", tavan: { moduller: ["production.enabled"], siniflar: ["URETIM"], kurulumAdedi: 1 }, sebep: "bekçi" },
    });
    bayiler.push(bayiR.veri.id as string);
    const bayi: PortalKimlik = await portalKullaniciAc(ctx, "BAYI", bayiR.veri.id as string);
    kullanicilar.push(bayi.id);
    const bayiE = await portalGiris(E, "/portal/api", bayi, { basliklar: JWT });
    const bilinmeyen = await portalIstek(E, "/portal/api/oturum/ac", { basliklar: JWT, govde: { kullaniciAdi: "hic-olmayan", parola: "x".repeat(20), totp: "123456" } });
    kontrol("§6m BAYI ERİŞİM'den giremez: 401, bilinmeyen hesapla AYNI ileti", bayiE.status === 401 && bayiE.json.message === bilinmeyen.json.message && bayiE.setCookie === null, `${bayiE.status}`);
    let kapisiz = "";
    try {
      createPortalRouter(ctx, "TAILNET", VENDOR_PORTAL_ROUTES);
    } catch (err) {
      kapisiz = (err as Error).message;
    }
    kontrol("§6n TAILNET'te kök parolalı rota kapısız bağlanamaz (yönlendirici kurulurken hata)", /kapısız bağlanamaz/.test(kapisiz), kapisiz.slice(0, 100));
    const saglik = await portalIstek(T, "/portal/saglik");
    const erisimDurumu = (saglik.veri.erisim ?? {}) as { kip?: string; jwks?: { dolu?: boolean; dosyaYasiSn?: number | null; azamiYasSn?: number; yasDurumu?: string } };
    kontrol(
      "§6o tailnet sağlığı ERİŞİM kipini, JWKS durumunu, DOSYA YAŞINI ve yaş tavanını gösterir (sır yok)",
      erisimDurumu.kip === "acik" &&
        erisimDurumu.jwks?.dolu === true &&
        typeof erisimDurumu.jwks?.dosyaYasiSn === "number" &&
        erisimDurumu.jwks?.azamiYasSn === 604_800 &&
        erisimDurumu.jwks?.yasDurumu === "TAZE" &&
        !/"n"|"d"|BEGIN/.test(JSON.stringify(saglik.veri)),
      JSON.stringify(erisimDurumu),
    );
    const eskiJwks = path.join(webDizini, "eski-certs.json");
    writeFileSync(eskiJwks, normalizeJwks(jwks(jwk(ANA.publicKey, KID_ANA))).json);
    const sekizGun = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(eskiJwks, sekizGun, sekizGun);
    const eskiV = createAccessVerifier(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: eskiJwks }));
    let eskiAdres: AddressInfo | null = null;
    const eskiSunucu = http.createServer(createAccessApp(ctx, { listener: () => eskiAdres, verifier: eskiV }));
    sondaSunuculari.push(eskiSunucu);
    eskiAdres = await dinle(eskiSunucu);
    const eskiY = await portalIstek(`http://127.0.0.1:${eskiAdres.port}`, "/portal/api/oturum", { basliklar: JWT });
    kontrol("§6o2 8 günlük JWKS dosyasıyla genel portal 404 (geçerli JWT de); sağlık durumu ASILDI", eskiY.status === 404 && eskiV?.jwks.state().ageLevel === "ASILDI", `${eskiY.status} · ${eskiV?.jwks.state().ageLevel ?? "-"}`);

    console.log("\n§6p ERİŞİM'de bağlama = izin listesi (her tablo rotası)");
    const UUID0 = "00000000-0000-4000-8000-000000000000";
    const ornekYol = (p: string): string => p.replace(/:[A-Za-z]+/g, UUID0);
    const sapma: string[] = [];
    for (const r of VENDOR_PORTAL_ROUTES) {
      const key = routeKey(r.method, r.path);
      const y = await portalIstek(E, `/portal/api${ornekYol(r.path)}`, { yontem: r.method.toUpperCase(), basliklar: JWT, ...(r.method === "get" ? {} : { govde: {} }) });
      const bek = ERISIM_PORTAL_ROTALARI.has(key) ? 401 : 404;
      if (y.status !== bek) sapma.push(`${key} → ${y.status} (beklenen ${bek})`);
    }
    kontrol("§6p ✓K listedeki her tablo rotası ERİŞİM'de oturumsuz 401 (bağlı), liste dışı her rota 404", sapma.length === 0, sapma.slice(0, 5).join(" | ") || `${VENDOR_PORTAL_ROUTES.length} rota`);
    const hamPut = await portalIstek(E, `/portal/api/ham/giden-oturum/${UUID0}/parca/0`, { yontem: "PUT", basliklar: JWT, govde: "x", icerikTuru: "application/octet-stream" });
    const hamGet = await portalIstek(E, `/portal/api/ham/dosyalar/${UUID0}`, { basliklar: JWT });
    const hamYok = await portalIstek(E, `/portal/api/ham/olmayan/${UUID0}`, { basliklar: JWT });
    kontrol("§6p2 ham uçlar: listedeki parça PUT ve dosya indirme bağlı (401), liste dışı ham yol 404", hamPut.status === 401 && hamGet.status === 401 && hamYok.status === 404, `${hamPut.status}/${hamGet.status}/${hamYok.status}`);
    const formlu = await portalIstek(E, `/portal/api/kullanicilar/${UUID0}/parola`, { cerez: eCerez, basliklar: JWT, govde: "parola=x", icerikTuru: "application/x-www-form-urlencoded" });
    kontrol("§6p3 liste dışı yazma gövde OKUNMADAN 404 (JSON dışı gövde 400 değil 404)", formlu.status === 404, `${formlu.status} ${formlu.kod ?? ""}`);

    console.log("\n§6q kök imzası: yardımcıya devreden rota ve listeye sızmış rota — imza boğazı");
    const surumSayisi = () => prisma.hakSurumu.count({ where: { hakId: k.hakId } });
    const imzaSayaci = async () => (await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id }, select: { imzaBasarisiz: true } })).imzaBasarisiz;
    let devredenKostu = 0;
    const kokImzaYardimcisi = (c: PortalRequestContext) =>
      prepareEntitlementVersion(c.ctx, { entitlementId: k.hakId, password: passwordBuffer(TEST_KOK_PAROLASI), reason: "sonda: yardımcıya devreden kök imzası", actor: c.session.actor });
    const devreden: PortalRouteDef = {
      method: "post",
      path: "/sonda/kok-imza",
      permission: "hak:yaz",
      kimlik: { muaf: "sonda" },
      handler: async (c) => {
        devredenKostu++;
        return { data: { surum: (await kokImzaYardimcisi(c)).version } };
      },
    };
    const eSonda = await sondaKur("ERISIM", [...VENDOR_PORTAL_ROUTES, devreden]);
    const dev = await portalIstek(eSonda, "/portal/api/sonda/kok-imza", { cerez: eCerez, basliklar: JWT, govde: {} });
    kontrol("§6q1 ⭐ beyansız (kokParolasi YOK) yardımcıya devreden kök imza rotası ERİŞİM'de 404 — listede değil, işleyici KOŞMADI", dev.status === 404 && devredenKostu === 0, `${dev.status} · koştu ${devredenKostu}`);
    const SIZAN = "POST /kurulumlar/:id/yaptirim";
    const sizmis = (handler: PortalRouteDef["handler"]): PortalRouteDef[] => [
      { method: "post", path: "/kurulumlar/:id/yaptirim", permission: "hak:yaz", kimlik: { muaf: "sonda" }, handler },
      ...VENDOR_PORTAL_ROUTES.filter((r) => routeKey(r.method, r.path) !== SIZAN),
    ];
    const sizanRotalar = sizmis(async (c) => ({ data: { surum: (await kokImzaYardimcisi(c)).version } }));
    const hatalar: string[] = [];
    const gercekHata = console.error;
    const oncekiSurum = await surumSayisi();
    const oncekiSayac = await imzaSayaci();
    const eSizan = await sondaKur("ERISIM", sizanRotalar);
    console.error = (...a: unknown[]) => void hatalar.push(a.map(String).join(" "));
    let sizanE;
    try {
      sizanE = await portalIstek(eSizan, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: eCerez, basliklar: JWT, govde: {} });
    } finally {
      console.error = gercekHata;
    }
    kontrol(
      "§6q2a ⭐ listeye SIZMIŞ kök imza rotası ERİŞİM'de işleyiciye ulaşsa da İMZA BOĞAZI reddeder (404, 'ERISIM yolundan istendi'), sürüm doğmaz, imza sayacı değişmez",
      sizanE.status === 404 && hatalar.some((h) => /KOK anahtarı ERISIM yolundan istendi — RED/.test(h)) && (await surumSayisi()) === oncekiSurum && (await imzaSayaci()) === oncekiSayac,
      `${sizanE.status} · ${hatalar.join(" / ").slice(0, 120)}`,
    );
    const tSizan = await sondaKur("TAILNET", sizanRotalar);
    const sizanT = await portalIstek(tSizan, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: tCerez, govde: {} });
    kontrol("§6q2b ✓K AYNI sızmış rota TAILNET'te GERÇEKTEN imzalar (200, yeni sürüm hazırlandı) — boğazın reddi kör RED değil", sizanT.status === 200 && typeof sizanT.veri.surum === "number", `${sizanT.status} ${sizanT.kod ?? ""}`);
    const korunan = sizmis(async (c) => ({
      data: await withSigningPasswordGuard(c.ctx, { userId: c.session.user.id, actor: c.session.actor, kind: "KOK" }, async () => (await kokImzaYardimcisi(c)).version),
    }));
    const eKorunan = await sondaKur("ERISIM", korunan);
    const korunanE = await portalIstek(eKorunan, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: eCerez, basliklar: JWT, govde: {} });
    kontrol("§6q3 imza parolası kapısı da (withSigningPasswordGuard) ERİŞİM'de sayaçlara dokunmadan reddeder", korunanE.status === 404 && (await imzaSayaci()) === oncekiSayac, `${korunanE.status}`);
    const jwtsizSonda = await sondaKur("ERISIM", VENDOR_PORTAL_ROUTES, false);
    const jwtsiz = await portalIstek(jwtsizSonda, "/portal/api/pano", { cerez: eCerez });
    kontrol("§6q4 JWT kapısı OLMADAN bağlanmış ERİŞİM yönlendiricisi her isteğe 404 (Access kimliği yok)", jwtsiz.status === 404, `${jwtsiz.status}`);

    console.log("\n§6r kullanıcı yönetimi yalnız tailnet (TOTP tohumu / parola Cloudflare'den geçmez)");
    const sondaAdi = `erisim-sonda-${randomUUID().slice(0, 8)}`;
    const kulE = await Promise.all([
      portalIstek(E, "/portal/api/kullanicilar", { cerez: eCerez, basliklar: JWT }),
      portalIstek(E, "/portal/api/kullanicilar", { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), kullaniciAdi: sondaAdi, adSoyad: "Sonda", rol: "SATICI_OPERATOR", parola: "x".repeat(20) } }),
      portalIstek(E, `/portal/api/kullanicilar/${yonetici.id}/totp-sifirla`, { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), sebep: "sonda" } }),
      portalIstek(E, `/portal/api/kullanicilar/${yonetici.id}/parola`, { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), parola: "y".repeat(20), sebep: "sonda" } }),
    ]);
    const kulT = await portalIstek(T, "/portal/api/kullanicilar", { cerez: tCerez });
    const sizanKullanici = await prisma.portalKullanici.findUnique({ where: { kullaniciAdi: sondaAdi } });
    if (sizanKullanici) kullanicilar.push(sizanKullanici.id);
    kontrol(
      "§6r ERİŞİM'de kullanıcı listesi · açma · TOTP sıfırlama · parola sıfırlama 404; tailnet'te liste 200 (pozitif)",
      kulE.every((y) => y.status === 404) && kulT.status === 200 && sizanKullanici === null,
      `${kulE.map((y) => y.status).join("/")} · tailnet ${kulT.status}`,
    );

    console.log("\n§6s denetim: ERİŞİM'den gelen her satırda Access e-postası; denetimsiz yazmaya ayak izi");
    type Ozet = { dinleyici?: string; erisimKimligi?: string; rota?: string } | null;
    const girisler = await prisma.denetim.findMany({ where: { olay: "PORTAL_GIRIS", varlikId: yonetici.id } });
    const girisE = girisler.find((g) => (g.ozet as Ozet)?.dinleyici === "ERISIM");
    const girisT = girisler.find((g) => (g.ozet as Ozet)?.dinleyici === "TAILNET");
    kontrol(
      "§6s1 PORTAL_GIRIS: ERİŞİM girişinde erisimKimligi = Access e-postası; tailnet girişinde YOK",
      (girisE?.ozet as Ozet)?.erisimKimligi === EPOSTA && girisT !== undefined && !("erisimKimligi" in ((girisT.ozet as object | null) ?? {})),
      `${(girisE?.ozet as Ozet)?.erisimKimligi ?? "YOK"} · tailnet ${girisT ? JSON.stringify(girisT.ozet) : "satır yok"}`,
    );
    const yaptirimSatiri = await prisma.denetim.findFirst({ where: { varlik: "Kurulum", varlikId: k.kurulumDbId, olay: { startsWith: "YAPTIRIM_" } }, orderBy: { createdAt: "desc" } });
    kontrol("§6s2 ERİŞİM'den yapılan yazmanın (K0) denetim satırında erisimKimligi", (yaptirimSatiri?.ozet as Ozet)?.erisimKimligi === EPOSTA, JSON.stringify(yaptirimSatiri?.ozet ?? null));
    const izSayisi = () => prisma.denetim.count({ where: { olay: "ERISIM_YAZMA", yapan: `satici:${yonetici.kullaniciAdi}` } });
    const izOnce = await izSayisi();
    const izRotalari: PortalRouteDef[] = [
      { method: "post", path: "/kanallar", permission: "kanal:yonet", kimlik: { muaf: "sonda" }, handler: async () => ({ status: 201, data: { sonda: true } }) },
      { method: "get", path: "/pano", permission: "portal:oku", kimlik: "OKUMA", handler: async () => ({ data: { sonda: true } }) },
      ...VENDOR_PORTAL_ROUTES.filter((r) => !["POST /kanallar", "GET /pano"].includes(routeKey(r.method, r.path))),
    ];
    const eIz = await sondaKur("ERISIM", izRotalari);
    const izYaz = await portalIstek(eIz, "/portal/api/kanallar", { cerez: eCerez, basliklar: JWT, govde: {} });
    const izOku = await portalIstek(eIz, "/portal/api/pano", { cerez: eCerez, basliklar: JWT });
    const izSatiri = await prisma.denetim.findFirst({ where: { olay: "ERISIM_YAZMA", yapan: `satici:${yonetici.kullaniciAdi}` }, orderBy: { createdAt: "desc" } });
    kontrol(
      "§6s3 ✓K kendi denetimini yazmayan ERİŞİM yazması tek ERISIM_YAZMA satırı alır (rota · e-posta · yapan); okuma almaz",
      izYaz.status === 201 && izOku.status === 200 && (await izSayisi()) === izOnce + 1 && (izSatiri?.ozet as Ozet)?.rota === "POST /kanallar" && (izSatiri?.ozet as Ozet)?.erisimKimligi === EPOSTA,
      `${izYaz.status}/${izOku.status} · ${(await izSayisi()) - izOnce} satır · ${JSON.stringify(izSatiri?.ozet ?? null)}`,
    );
    const yazOnce = await izSayisi();
    const yaz2 = await portalIstek(E, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), kademe: "K0", mesaj: "İkinci", sebep: "erişim bekçisi" } });
    kontrol("§6s4 kendi denetimini yazan ERİŞİM yazması (K0) ayrıca ayak izi ALMAZ (satır çiftlenmez)", yaz2.status === 201 && (await izSayisi()) === yazOnce, `${yaz2.status}`);
    const operator = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(operator.id);
    const opGiris = await portalGiris(E, "/portal/api", operator, { basliklar: JWT });
    const yeniParola = `bekci-yeni-${randomUUID()}`;
    const parolaDeg = await portalIstek(E, "/portal/api/oturum/parola", {
      cerez: opGiris.cerez ?? "",
      basliklar: JWT,
      govde: { mevcutParola: operator.parola, yeniParola, totp: await totpKodu(operator.sir, 1) },
    });
    const parolaSatiri = await prisma.denetim.findFirst({ where: { olay: "PORTAL_PAROLA_DEGISTI", varlikId: operator.id } });
    kontrol(
      "§6s5 ERİŞİM'den kendi parolasını değiştirme denetime PORTAL_PAROLA_DEGISTI yazar (e-postalı); ayrıca ayak izi yok",
      opGiris.status === 200 && parolaDeg.status === 200 && (parolaSatiri?.ozet as Ozet)?.erisimKimligi === EPOSTA && (await prisma.denetim.count({ where: { olay: "ERISIM_YAZMA", yapan: `satici:${operator.kullaniciAdi}` } })) === 0,
      `${opGiris.status}/${parolaDeg.status} ${parolaDeg.kod ?? ""} · ${JSON.stringify(parolaSatiri?.ozet ?? null)}`,
    );
  } finally {
    for (const s of [tailnet, erisim, yanlisSoket, kapali, ...sondaSunuculari]) await kapatSunucu(s);
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler });
  }

  console.log("\n§7 gerçek süreç — açılış satırı, KAPALI kip, JWKS dosyalı AÇIK kip");
  const kapaliSurec = await sunucuBaslat(ortam);
  kontrol("§7a PORT_ERISIM verilmeyen süreç ERİŞİM dinleyicisini AÇMAZ (erisim=kapali)", /SATICI_DINLIYOR [^\n]* erisim=kapali/.test(kapaliSurec.cikti()), kapaliSurec.cikti().match(/SATICI_DINLIYOR[^\n]*/)?.[0] ?? "");
  await kapaliSurec.durdur();
  const acikSurec = await sunucuBaslat(ortam, { PORT_ERISIM: "0", ERISIM_BIND: "127.0.0.1" });
  try {
    const port = /SATICI_DINLIYOR [^\n]* erisim=(\d+)/.exec(acikSurec.cikti())?.[1];
    const r = port ? await portalIstek(`http://127.0.0.1:${port}`, "/portal/api/oturum", { basliklar: { "cf-access-jwt-assertion": gecerli() } }) : null;
    kontrol(
      "§7b Access ayarsız ERİŞİM dinleyicisi açılır, her isteğe 404 ve KAPALI uyarısı basar",
      port !== undefined && r?.status === 404 && /genel portal KAPALI/.test(acikSurec.cikti()),
      `${port ?? "port yok"} · ${r?.status ?? "-"}`,
    );
  } finally {
    await acikSurec.durdur();
  }
  // Açık kip, gerçek süreç: JWKS yan konteynerin dosyasından (süreç ağa çıkmaz — sahte takım alanı DNS'e hiç sorulmaz).
  const surecJwks = path.join(webDizini, "surec-certs.json");
  writeFileSync(surecJwks, normalizeJwks(jwks(jwk(ANA.publicKey, KID_ANA))).json);
  const tamSurec = await sunucuBaslat(ortam, { PORT_ERISIM: "0", ERISIM_BIND: "127.0.0.1", CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: surecJwks });
  try {
    const port = /SATICI_DINLIYOR [^\n]* erisim=(\d+)/.exec(tamSurec.cikti())?.[1];
    const simdiGercek = Math.floor(Date.now() / 1000);
    const basliklar = { "cf-access-jwt-assertion": gecerli({ iat: simdiGercek - 5, nbf: simdiGercek - 5, exp: simdiGercek + 3600 }) };
    const gecti = port ? await portalIstek(`http://127.0.0.1:${port}`, "/portal/api/oturum", { basliklar }) : null;
    const jwtsiz = port ? await portalIstek(`http://127.0.0.1:${port}`, "/portal/api/oturum") : null;
    kontrol(
      "§7c gerçek süreç, JWKS dosyadan: kapı AÇIK günlüğü; geçerli JWT → 401 (kapı geçti), JWT'siz → 404",
      port !== undefined && gecti?.status === 401 && gecti.kod === "OTURUM_YOK" && jwtsiz?.status === 404 && /Cloudflare Access kapısı AÇIK/.test(tamSurec.cikti()),
      `${port ?? "port yok"} · ${gecti?.status ?? "-"}/${jwtsiz?.status ?? "-"}`,
    );
  } finally {
    await tamSurec.durdur();
    ortam.temizle();
    rmSync(webDizini, { recursive: true, force: true });
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
