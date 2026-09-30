// =============================================================================
// ERİŞİM KAPISI — satıcı portalının internetten yolu (portal.<alan>, Cloudflare proxy + Access). İstek portala
// YALNIZ geçerli `Cf-Access-Jwt-Assertion` ile ulaşır; kök parolalı uç bu yolda YOK; tailnet yolu değişmez.
//   §1 yapılandırma: PORT_ERISIM yoksa dinleyici yok · ERISIM_BIND joker RED · takım alanı yalnız
//      <takım>.cloudflareaccess.com · AUD 64 onaltılık · ikisinden biri yoksa kip KAPALI
//   §2 doğrulayıcı (DB'siz, gerçek RSA, JWKS ağı sahte): her saldırı KENDİ gerekçesiyle RED — başlıksız ·
//      biçimsiz · yinelenen başlık · alg none / HS256 (anahtar karışması) · crit · kid yok · bozuk imza · aynı
//      kid başka anahtar · jetona gömülü jwk/jku YOK SAYILIR · yanlış aud · yanlış iss · süresi dolmuş · nbf/iat
//      gelecekte · exp yok · e-posta yok; aud dizisi · geçerli jeton geçer (pozitif kontrol)
//   §3 JWKS önbelleği (TTL tazeliktir, geçerlilik değil): hiç dolmamış + erişilemez → RED · bayat ama dolu →
//      GEÇER ve tazeleme denenir · BAYAT ≠ BOŞ · onarım · bilinmeyen kid tek çekim, soğuma içinde ikincisi yok ·
//      anahtar dönümü tek çekimle kabul · zehirli JWKS (<2048 bit, use/alg uyumsuz) anahtar vermez · adres sabit
//   §4 statik: kök parolası anan her satıcı rotası `kokParolasi: true` beyanlı (ve tersi) · kapısız bağlama hata
//   §5 compose: portal yönlendiricisinin Traefik ipallowlist aralıkları = CLOUDFLARE_NETWORKS
//   §6 HTTP (süreç içi dinleyiciler, kendi `_test` DB'si) · §7 gerçek süreç: açılış satırı ve KAPALI kip
// ⭐ KALICI SONDA ✓K4 (her koşumda): (1) geçerli jeton GEÇER (§2a, §6c — her şeyi reddeden kör kapı yeşil veremez)
//    (2) BAYAT önbellek geçer, BOŞ önbellek reddeder (§3c) (3) AYNI kök parolalı istek tailnet'te 404 DEĞİL (§6k —
//    404 rotanın kapısından geliyor, eksik rotadan değil) (4) §4 çözümleyicisi sentetik beyansız rotada ısırır.
// Koşum: npx tsx scripts/test_erisim_kapisi.ts   (§6–§7 kendi _test DB'si)
// =============================================================================
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { AccessVerifier, JwksCache, accessSettingsOf, jwksUrlOf, type AccessResult, type JwksFetch } from "../src/http/access-jwt";
import { createAccessApp } from "../src/http/access-app";
import { CLOUDFLARE_NETWORKS } from "../src/http/client-address";
import { createPortalRouter, type PortalRouteDef } from "../src/http/portal-http";
import { VENDOR_PORTAL_ROUTES } from "../src/http/portal-routes";
import { createTailnetApp } from "../src/http/tailnet-app";
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

function dogrulayici(ag: ReturnType<typeof sahteAg>, g: { ttlMs?: number; cooldownMs?: number } = {}) {
  const cache = new JwksCache({ url: jwksUrlOf(TAKIM), fetchJwks: ag.fetchJwks, now: () => saat, ttlMs: g.ttlMs ?? 60_000, cooldownMs: g.cooldownMs ?? 10_000, warn: () => undefined });
  return new AccessVerifier({ teamDomain: TAKIM, aud: AUD }, cache, () => saat);
}

const neden = (r: AccessResult): string => (r.ok ? "GECTI" : r.reason);

// ---------------------------------------------------------------- §4 çözümleyicisi
/** Kök parolası anan (gövde alanı ya da KÖK imza kapısı) her rota beyanlı olmalı; beyanlı rota gerçekten anmalı. */
export function kokParolaBulgulari(routes: readonly PortalRouteDef[]): string[] {
  const out: string[] = [];
  for (const r of routes) {
    const src = r.handler.toString();
    const aniyor = /kokParolasi|kind:\s*"KOK"/.test(src);
    const key = `${r.method.toUpperCase()} ${r.path}`;
    if (aniyor && r.kokParolasi !== true) out.push(`${key} kök parolası taşıyor ama kokParolasi beyanı yok`);
    if (!aniyor && r.kokParolasi === true) out.push(`${key} kokParolasi beyanlı ama kök parolasını anmıyor`);
  }
  return out;
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
  kontrol(
    "§1f takım alanı ya da AUD eksikse kip KAPALI (null); ikisi varsa açık",
    accessSettingsOf(loadConfig(TABAN)) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM })) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, CF_ACCESS_AUD: AUD })) === null &&
      accessSettingsOf(loadConfig({ ...TABAN, CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD }))?.aud === AUD,
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
  const vHttp = new AccessVerifier({ teamDomain: TAKIM, aud: AUD }, new JwksCache({ url: jwksUrlOf(TAKIM), fetchJwks: agHttp, now: () => saat, warn: () => undefined }), () => saat);
  kontrol("§3f4 200 dışı yanıt (yönlendirme dahil) anahtar vermez → JWKS", neden(await vHttp.verify(gecerli())) === "JWKS");
  const agSrc = readFileSync(path.join(__dirname, "..", "src", "http", "access-jwt.ts"), "utf8");
  kontrol("§3g ağ çekimi yönlendirme İZLEMEZ (redirect: \"error\") ve tek adres jwksUrlOf'tan", /redirect:\s*"error"/.test(agSrc) && /url:\s*jwksUrlOf\(settings\.teamDomain\)/.test(agSrc));

  console.log("\n§4 kök parolalı rota beyanı (statik)");
  const bulgular = kokParolaBulgulari(VENDOR_PORTAL_ROUTES);
  const beyanli = VENDOR_PORTAL_ROUTES.filter((r) => r.kokParolasi === true);
  kontrol("§4a kök parolası anan her satıcı rotası beyanlı, beyanlı her rota anıyor", bulgular.length === 0, bulgular.join(" | "));
  kontrol("§4b en az bir beyanlı rota var (boş küme yeşil vermez): POST /haklar/:id/surum", beyanli.some((r) => r.method === "post" && r.path === "/haklar/:id/surum"), beyanli.map((r) => r.path).join(","));
  const sentetik: PortalRouteDef[] = [
    { method: "post", path: "/x", permission: "hak:yaz", kimlik: "ISLEM_KIMLIGI", handler: async (c) => ({ data: (c.req.body as { kokParolasi?: string }).kokParolasi ?? null }) },
    { method: "post", path: "/y", permission: "hak:yaz", kimlik: "ISLEM_KIMLIGI", kokParolasi: true, handler: async () => ({ data: null }) },
  ];
  const sonda = kokParolaBulgulari(sentetik);
  kontrol("§4c ✓K çözümleyici sentetik beyansız rotada ve anmayan beyanlı rotada ısırır", sonda.some((b) => b.startsWith("POST /x")) && sonda.some((b) => b.startsWith("POST /y")), `${sonda.length} bulgu`);

  console.log("\n§5 compose (Traefik ipallowlist = Cloudflare aralıkları)");
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

  // ---------------------------------------------------------------- §6 HTTP
  hedefDbKapisi();
  process.env.SATICI_ERISIM_GUNLUGU ??= "0";
  const webDizini = mkdtempSync(path.join(os.tmpdir(), "satici-erisim-web-"));
  mkdirSync(path.join(webDizini, "portal"), { recursive: true });
  writeFileSync(path.join(webDizini, "portal", "portal.html"), "<!doctype html><title>portal</title>");
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000", PORTAL_WEB_DIZINI: webDizini });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  saat = Date.now();
  const httpAg = sahteAg(jwks(jwk(ANA.publicKey, KID_ANA)));
  const httpV = new AccessVerifier({ teamDomain: TAKIM, aud: AUD }, new JwksCache({ url: jwksUrlOf(TAKIM), fetchJwks: httpAg.fetchJwks, warn: () => undefined }));
  let tailnetAdresi: AddressInfo | null = null;
  let erisimAdresi: AddressInfo | null = null;
  let kapaliAdresi: AddressInfo | null = null;
  const tailnet = http.createServer(createTailnetApp(ctx, null, () => tailnetAdresi, httpV));
  const erisimApp = createAccessApp(ctx, { listener: () => erisimAdresi, tailnetListener: () => tailnetAdresi, verifier: httpV });
  const erisim = http.createServer(erisimApp);
  const yanlisSoket = http.createServer(erisimApp);
  const kapali = http.createServer(createAccessApp(ctx, { listener: () => kapaliAdresi, tailnetListener: () => tailnetAdresi, verifier: null }));
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
    let kapisiz = false;
    try {
      createPortalRouter(ctx, "ERISIM", VENDOR_PORTAL_ROUTES);
    } catch {
      kapisiz = true;
    }
    kontrol("§6n kök parolalı rota kapısız bağlanamaz (yönlendirici kurulurken hata)", kapisiz);
    const saglik = await portalIstek(T, "/portal/saglik");
    const erisimDurumu = (saglik.veri.erisim ?? {}) as { kip?: string; jwks?: { filled?: boolean } };
    kontrol("§6o tailnet sağlığı ERİŞİM kipini ve JWKS durumunu gösterir (sır yok)", erisimDurumu.kip === "acik" && erisimDurumu.jwks?.filled === true && !/"n"|"d"|BEGIN/.test(JSON.stringify(saglik.veri)), JSON.stringify(erisimDurumu));
  } finally {
    for (const s of [tailnet, erisim, yanlisSoket, kapali]) await kapatSunucu(s);
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler });
  }

  console.log("\n§7 gerçek süreç — açılış satırı ve KAPALI kip");
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
