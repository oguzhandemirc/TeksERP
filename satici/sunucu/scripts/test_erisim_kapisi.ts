// =============================================================================
// ERİŞİM KAPISI — satıcı portalının internetten yolu (portal.<alan>, Cloudflare proxy + Access). İstek portala
// YALNIZ geçerli `Cf-Access-Jwt-Assertion` ile ulaşır; bu yolda YALNIZ izin listesindeki rotalar var (opt-in; satıcı
// portalının her işlemi — imza, kullanıcı yönetimi, anahtar kayıtları dahil — listede, her tablo rotası listede ya da
// gerekçeli dışlamada); imza boğazı kök/ara imzasını bu yoldan GEÇİRİR, bayi yolundan (GENEL) değil; satıcı portalının başka yolu YOK (tünel kalktı, test_tunel_yok).
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
//   §4 izin listesi (BEYANA bakar, gövde metnine değil): liste ⊆ rota tablosu · KARAR TAMLIĞI: her tablo rotası listede
//      ya da `ERISIM_DISI_ROTALAR`da (ikisinde birden değil) · imza · kullanıcı yönetimi · anahtar kaydı rotaları listede ·
//      doğrulayıcı sentetik kusurlu listede ve kararsız sonda rotasında ısırır · tabloda olmayan satırlı listeyle
//      yönlendirici KURULMAZ · §4i `src/`te rota bayrağı `kokParolasi: true` ve `rootPasswordGate` yok (AST) ·
//      §4j `src/`teki parola/TOTP taşıyan HER Zod gövde anahtarı (AST) gövde özetine girmez (`SECRET_BODY_KEYS`) ·
//      §4g access-app BAĞLAMA ENVANTERİ: `createAccessApp`teki her `app.*` çağrısı (ara katman,
//      yönlendirici, rota, ayar) beklenen sıralı kümeyle BİREBİR — küme dışı bağlama (izin listesini atlayan yol) kırmızı
//   §5 compose: portal yönlendiricisinin Traefik ipallowlist aralıkları = CLOUDFLARE_NETWORKS · üst dosya satıcıya AĞ
//      EKLEMEZ, JWKS bağı satıcıda salt okunur · yan konteyner sertleştirilmiş, sırsız, yalnız kendi çıkış köprüsünde
//      · üretim kurulumu (ornek-uretim.env'in COMPOSE_FILE'ı = ana dosya + portal-genel) birleşik yapılandırmada satıcının
//      internal olmayan ağı YOK, yapılandırmanın tek çıkışlı ağı jwks-cikis (docker yoksa ÖLÇÜLEMEDİ beyanı)
//   §6 HTTP (süreç içi dinleyiciler, kendi `_test` DB'si): her tablo rotası ERİŞİM'de listeye göre bağlı (listede 401,
//      liste dışı 404) · HAK imzası ERİŞİM'de: yanlış parola 400 + sayaç, doğru parola 201; saklanan gövde özeti parolasız
//      gövdenin bağımsız özeti, aynı kimlik başka parolayla 201 tekrar (§6k6 · §6k7) · listede olmayan sonda rotası
//      404 (işleyici koşmaz) · imza yardımcısı ve imza parolası kapısı ERİŞİM'de imzalar · kullanıcı yönetimi ve yayıncı
//      kaydı ERİŞİM'de çalışır (TOTP sırrı yalnız canlı yanıtta) · denetim satırlarında Access e-postası (sır yok) +
//      ERISIM_YAZMA ayak izi · JWT kapısız bağlanmış ERİŞİM yönlendiricisi 404 · §7 gerçek süreç: açılış satırı, KAPALI
//      kip ve JWKS dosyalı AÇIK kip
// ⭐ KALICI SONDA ✓K9 (her koşumda): (1) geçerli jeton GEÇER (§2a, §6c — her şeyi reddeden kör kapı yeşil veremez)
//    (2) BAYAT önbellek geçer, BOŞ önbellek reddeder (§3c) (3) AYNI imza isteği ERİŞİM'de rotaya ULAŞIR ve doğru
//    parolayla GERÇEKTEN imzalar (§6k · §6k5) (4) §4 doğrulayıcısı sentetik kusurlu listede ve kararsız rotada ısırır
//    (5) dosya kaynağı geçerli dosyayla GEÇER (§3h4 · §3h7 — her dosyayı reddeden kör okuyucu yeşil veremez)
//    (6) yan konteyner geçerli yanıtı GERÇEKTEN yazar (§3i1 — hiç yazmayan çekici "eski dosya korundu" yeşili veremez)
//    (7) 8 günlük JWKS RED, aynı küme yenilenince GEÇER (§3j1 · §3j4) (8) listede OLMAYAN sonda rotası ERİŞİM'de 404,
//    işleyici koşmaz (§6q1 — açık-liste düzeni; GENEL'den imza reddi test_imza_parolasi §7b) (9) listedeki her rota
//    ERİŞİM'de 401 (§6p — bağlama ölçülüyor)
//    (10–12) §4h bağlama envanteri sentetik ek yönlendiricide · yerel Router'da · JWT kapısı yönlendiricilerin arkasına
//    alınınca ısırır.
// NEGATİF SONDA (sertleştirme 2, dosya DIŞI): access-app.ts'e diskte `app.use("/hata-ayikla", createPortalRouter(ctx,
//   "TAILNET", …))` → §4g ❌ (§6 HTTP sondaları görmedi); cp + shasum ile geri alındı.
// NEGATİF SONDA (portal internetten, 2026-10-04, dosya DIŞI, cp + shasum ile geri alındı): listeden "POST /kullanicilar"
//   silindi → §4a (karar yok) · §4b · §4c · §6r1 · §6r2 · §6s6 ❌ · listeye "POST /olmayan" → §4a · §4e2 ❌ + açılış düştü ·
//   HAK sürüm rotasına `kokParolasi: true` → §4i ❌ · `SIGNING_ORIGINS.KOK` eski [TAILNET, CLI] → §6k · §6k3 · §6k5 · §6q2a
//   · §6q3 ❌ · `allowlistGate` kaldırılıp her rota bağlandı → §6p3 · §6q1 ❌ · audit e-posta koşulu TAILNET → §6k5 · §6s1–
//   §6s6 ❌ · kullanıcı açma özetine `parola` → §6s6 ❌.
// NEGATİF SONDA (gövde özetinde parola, 2026-10-05, dosya DIŞI, cp + shasum ile geri alındı): `SECRET_BODY_KEYS`ten
//   `kokParolasi` + `imzaParolasi` çıkarıldı → §4j · §6k6 · §6k7 ❌ (145/148) · key-routes şemasına listesiz
//   `yedekParolasi: z.string()` → §4j ❌ (147/148).
// NEGATİF SONDA (tünel kapatma T1, 2026-10-05, dosya DIŞI, cp + shasum ile geri alındı): listeden "GET /saglik" silindi →
//   §4a · §4d2 · §6o ❌ (144/147) · resolveSession dinleyici denetimi kaldırıldı → bu bekçi YEŞİL (§6j'nin 401'leri rol
//   kuralından da gelir) — o bağı test_tunel_yok §5a ölçer.
// NEGATİF SONDA (tünel kapatma T2, 2026-10-05, deploy dosyalarında dosya DIŞI, cp + shasum ile geri alındı): ornek-uretim.env
//   COMPOSE_FILE yalnız ana dosya → §5e0 · §5e2 · §5e3 ❌ · ana dosyada kenar `internal: false` → §5e · §5e2 ❌ · portal-genel'e
//   tailnet ağlı portal-tunel servisi → §5e2 ❌ · portal-genel'e jwks-cikis'te ikinci servis → §5e3 ❌ (her biri 145–147/148).
// Koşum: npx tsx scripts/test_erisim_kapisi.ts   (§6–§7 kendi _test DB'si)
// =============================================================================
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
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
import { ERISIM_DISI_ROTALAR, ERISIM_HAM_ROTALARI, ERISIM_PORTAL_ROTALARI } from "../src/http/erisim-rotalari";
import { errorHandler, notFound } from "../src/http/error-handler";
import { SESSION_ROUTE_KEYS, createPortalRouter, erisimListesiBulgulari, routeKey, type PortalRequestContext, type PortalRouteDef } from "../src/http/portal-http";
import { VENDOR_PORTAL_ROUTES } from "../src/http/portal-routes";
import { createPublicApp } from "../src/http/public-app";
import { passwordBuffer } from "../src/keys/key-files";
import { portalBodyDigest } from "../src/portal/idempotency";
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
  temizleDagitim,
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

/**
 * Kaldırılan "kök parolalı rota" düzeninin geri dönüşü (§4i): rota bayrağı `kokParolasi: true` (nesne literalinde)
 * ya da tip alanı `kokParolasi` (arayüz/tip literali) ve `rootPasswordGate` adı. Gövde alanı `kokParolasi` (zod şeması,
 * `b.kokParolasi`, SECRET_BODY_KEYS dizgisi) bulgu DEĞİLDİR — o eski arayüzün gövde alanıdır.
 */
function kokBayragiBulgulari(metin: string, ad: string): string[] {
  const sf = ts.createSourceFile(ad, metin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const adi = (n: ts.PropertyName) => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : "");
  const gez = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && adi(n.name) === "kokParolasi" && n.initializer.kind === ts.SyntaxKind.TrueKeyword) out.push(`${ad}:${satir(n)} rota bayrağı kokParolasi: true`);
    if (ts.isPropertySignature(n) && adi(n.name) === "kokParolasi") out.push(`${ad}:${satir(n)} tip alanı kokParolasi`);
    if (ts.isIdentifier(n) && n.text === "rootPasswordGate") out.push(`${ad}:${satir(n)} rootPasswordGate`);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/** Zod şemasındaki (`x: z.…` ya da `x: Şema`) sır adlı gövde anahtarları — parola/TOTP taşıyan HER alan (§4j). */
function sirGovdeAnahtarlari(metin: string, ad: string): string[] {
  const sf = ts.createSourceFile(ad, metin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && /parola|totp/i.test(n.name.text) && /^z\./.test(n.initializer.getText(sf))) out.push(n.name.text);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/** idempotency.ts'ten BAĞIMSIZ beklenen özet: verilen sır anahtarları + clientToken çıkarılmış, anahtar sıralı gövde. */
function bagimsizOzet(govde: Record<string, unknown>, sirlar: readonly string[]): string {
  const sirali = Object.fromEntries(Object.keys(govde).filter((k) => k !== "clientToken" && !sirlar.includes(k)).sort().map((k) => [k, govde[k]]));
  return createHash("sha256").update(JSON.stringify(sirali), "utf8").digest("hex");
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
  const bulgular = erisimListesiBulgulari(VENDOR_PORTAL_ROUTES, ERISIM_PORTAL_ROTALARI, SESSION_ROUTE_KEYS, ERISIM_DISI_ROTALAR);
  kontrol(
    "§4a liste geçerli: her satır tabloda (ya da oturum ucu); KARAR TAMLIĞI — her tablo rotası listede ya da gerekçeli dışlamada, ikisinde birden değil",
    bulgular.length === 0,
    bulgular.join(" | "),
  );
  const ACILAN = [
    "GET /kullanicilar",
    "POST /kullanicilar",
    "POST /kullanicilar/:id/pasif",
    "POST /kullanicilar/:id/aktif",
    "POST /kullanicilar/:id/totp-sifirla",
    "POST /kullanicilar/:id/kilit-ac",
    "POST /kullanicilar/:id/parola",
    "POST /bayiler/:id/anahtar",
    "POST /yayincilar",
    "POST /haklar/:id/surum",
    "POST /haklar/toplu-yeniden-bas",
  ];
  kontrol(
    "§4b imza (HAK sürümü · ara imzacıyla toplu yeniden basım), kullanıcı yönetimi (liste · açma · pasif/aktif · TOTP sıfırlama · kilit açma · parola sıfırlama) ve anahtar kayıtları (bayi anahtarı bağlama · yayıncı kaydı) tabloda VE listede",
    ACILAN.every((k) => tablo.has(k) && ERISIM_PORTAL_ROTALARI.has(k)),
    ACILAN.filter((k) => !tablo.has(k) || !ERISIM_PORTAL_ROTALARI.has(k)).join(" · "),
  );
  kontrol(
    "§4c liste giriş/çıkış/oturum/parola değişimi uçlarını, temel okumayı, etkinleştirme kodunu, yayıncı pasife almayı, bildirimleri, kullanıcı açmayı ve HAK imzasını (bilinçli satır) taşır (boş liste yeşil vermez)",
    SESSION_ROUTE_KEYS.every((k) => ERISIM_PORTAL_ROTALARI.has(k)) &&
      [
        "GET /pano",
        "POST /kurulumlar/:id/yaptirim",
        "POST /kurulumlar/:id/etkinlestirme-kodu",
        "POST /yayincilar/:id/pasif",
        "GET /bildirimler",
        "GET /bildirimler/durum",
        "POST /bildirimler/deneme",
        "POST /kullanicilar",
        "POST /haklar/:id/surum",
      ].every((k) => ERISIM_PORTAL_ROTALARI.has(k)),
    `${liste.length} satır`,
  );
  const sentetikListe = new Set([...ERISIM_PORTAL_ROTALARI, "GET /olmayan-rota"]);
  const sonda = erisimListesiBulgulari(VENDOR_PORTAL_ROUTES, sentetikListe);
  kontrol("§4d ✓K doğrulayıcı sentetik kusurlu listede ısırır: tabloda olmayan satır", sonda.length === 1 && sonda[0]!.startsWith("GET /olmayan-rota"), sonda.join(" | "));
  const kararsiz: PortalRouteDef = { method: "post", path: "/sonda/kararsiz", permission: "portal:oku", kimlik: { muaf: "sonda" }, handler: async () => ({ data: null }) };
  const kararsizBulgu = erisimListesiBulgulari([...VENDOR_PORTAL_ROUTES, kararsiz], ERISIM_PORTAL_ROTALARI, SESSION_ROUTE_KEYS, {});
  const dislanan = erisimListesiBulgulari([...VENDOR_PORTAL_ROUTES, kararsiz], ERISIM_PORTAL_ROTALARI, SESSION_ROUTE_KEYS, { "POST /sonda/kararsiz": "sonda gerekçesi" });
  const disiKusurlu = erisimListesiBulgulari(VENDOR_PORTAL_ROUTES, ERISIM_PORTAL_ROTALARI, SESSION_ROUTE_KEYS, { "GET /pano": "sonda", "GET /olmayan-disi": "sonda" });
  kontrol(
    "§4d2 ✓K karar tamlığı: listede de dışlamada da olmayan sonda rotası BULGU; gerekçeli dışlamaya girince bulgu YOK (dışlama da karardır); dışlamada tabloda olmayan satır ve hem listede hem dışlamada satır BULGU",
    kararsizBulgu.length === 1 &&
      /^POST \/sonda\/kararsiz: .*karar yok/.test(kararsizBulgu[0]!) &&
      dislanan.length === 0 &&
      disiKusurlu.length === 2 &&
      disiKusurlu.some((b) => /^GET \/pano: hem listede hem dışlamada/.test(b)) &&
      disiKusurlu.some((b) => /^GET \/olmayan-disi: dışlamada ama rota tablosunda yok/.test(b)),
    [...kararsizBulgu, ...dislanan, ...disiKusurlu].join(" | "),
  );
  kontrol("§4d3 dışlama beyanı donmuş (çalışma anında genişletilemez)", Object.isFrozen(ERISIM_DISI_ROTALAR));
  const kurulamadi = (routes: readonly PortalRouteDef[]): string => {
    try {
      createPortalRouter({ config: loadConfig(TABAN) } as never, "ERISIM", routes);
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };
  const panosuz = VENDOR_PORTAL_ROUTES.filter((r) => routeKey(r.method, r.path) !== "GET /pano");
  const hata = kurulamadi(panosuz);
  kontrol("§4e listede tabloda olmayan satır varsa ERİŞİM yönlendiricisi KURULMAZ (açılış durur)", /GET \/pano: listede ama rota tablosunda yok/.test(hata), hata.slice(0, 120));
  const kararsizKurulum = kurulamadi([...VENDOR_PORTAL_ROUTES, kararsiz]);
  kontrol("§4e2 kararsız rota açılışı DURDURMAZ (liste dışı = 404, fail-closed; tamlık bekçide §4a)", kararsizKurulum === "", kararsizKurulum.slice(0, 120));
  kontrol("§4f ham ERİŞİM listesi ham yönlendiricinin rotalarının alt kümesi (parça PUT + dosya indirme)", [...ERISIM_HAM_ROTALARI].every((k) => RAW_ROUTE_KEYS.includes(k)) && ERISIM_HAM_ROTALARI.size === 2);
  const disarida = Object.entries(ERISIM_DISI_ROTALAR);
  console.log(`  ℹ️  ERİŞİM dışı ${disarida.length} tablo rotası (beyanlı): ${disarida.map(([k, g]) => `${k} (${g})`).join(" · ") || "yok"}`);
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
  const ekli = erisimBaglamalari(erisimUygulamasi.replace('  app.use("/portal", createWebAppRouter', '  app.use("/hata-ayikla", createPortalRouter(ctx, "GENEL", VENDOR_PORTAL_ROUTES));\n  app.use("/portal", createWebAppRouter'));
  const yerel = erisimBaglamalari(erisimUygulamasi.replace("  app.use(notFound);", '  const r = express.Router();\n  r.get("/ic", (_q: Request, s2: Response) => s2.end());\n  app.use(r);\n  app.use(notFound);'));
  const once = erisimBaglamalari(erisimUygulamasi.replace("  app.use(requireAccessJwt(deps.verifier));\n", "").replace("  app.use(notFound);", "  app.use(requireAccessJwt(deps.verifier));\n  app.use(notFound);"));
  kontrol(
    "§4h ✓K envanter ısırır: ek yönlendirici (izin listesiz GENEL portal yönlendiricisi) · yerel Router + ek bağlama · JWT kapısı yönlendiricilerin ARKASINA",
    farklar(ekli).some((x) => x.includes('/hata-ayikla')) && farklar(yerel).some((x) => x.includes("Router")) && farklar(once).length > 0 && ekli.baglamalar.length === ERISIM_BAGLAMALARI.length + 1,
    `${farklar(ekli).length} · ${farklar(yerel).length} · ${farklar(once).length}`,
  );
  const kokBayragi = tsDosyalari.flatMap((f) => kokBayragiBulgulari(kaynak(f), f));
  kontrol("§4i src/'te kök parolalı rota düzeni YOK: rota bayrağı `kokParolasi: true` · tip alanı · `rootPasswordGate` (yol kararı imza boğazında)", kokBayragi.length === 0, kokBayragi.join(" | "));
  const kokSonda = kokBayragiBulgulari(
    'interface D { readonly kokParolasi?: true }\nconst r = { method: "post", kokParolasi: true };\nconst o = { rootPasswordGate: g };\nconst z = { kokParolasi: s.optional() }; b.kokParolasi;',
    "sonda.ts",
  );
  kontrol("§4i2 ✓K çözümleyici sentetik metinde üç biçimi yakalar, gövde alanını (şema · erişim) bulgu saymaz", kokSonda.length === 3, kokSonda.join(" | "));
  // Kök parolası internetten de geçer: parola/TOTP taşıyan HER gövde anahtarı tuzsuz gövde özetine (PortalIslemi.govdeOzeti) girmemeli.
  const sirAnahtarlari = [...new Set(tsDosyalari.flatMap((f) => sirGovdeAnahtarlari(kaynak(f), f)))].sort();
  const ozeteGiren = sirAnahtarlari.filter((k) => portalBodyDigest({ a: 1, [k]: "sir-1" }) !== portalBodyDigest({ a: 1 }));
  kontrol(
    "§4j src/'teki parola/TOTP taşıyan HER gövde anahtarı gövde özetine GİRMEZ (kokParolasi · imzaParolasi dahil)",
    ozeteGiren.length === 0 && sirAnahtarlari.includes("kokParolasi") && sirAnahtarlari.includes("imzaParolasi") && sirAnahtarlari.length >= 7,
    `${sirAnahtarlari.join(", ")}${ozeteGiren.length ? ` · ÖZETE GİREN: ${ozeteGiren.join(", ")}` : ""}`,
  );
  const sirSonda = sirGovdeAnahtarlari('const S = z.strictObject({ yedekParolasi: z.string(), totpKodu: z.string(), ad: z.string() }); const t = { parolaOzeti: hash };', "sonda.ts");
  kontrol(
    "§4j2 ✓K tarayıcı sentetik şemada sır anahtarlarını bulur (şema dışı alanı saymaz); özet kör değil (sır olmayan alan özeti değiştirir)",
    JSON.stringify(sirSonda) === JSON.stringify(["yedekParolasi", "totpKodu"]) && portalBodyDigest({ a: 1, sebep: "x" }) !== portalBodyDigest({ a: 1 }),
    sirSonda.join(", "),
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
      // Üretim kurulumu ornek-uretim.env'in KENDİ COMPOSE_FILE listesiyle çözülür (tek portal üretimde, hazırlıkta yok).
      const uretimMetni = readFileSync(path.join(composeKoku, "ornek-uretim.env"), "utf8");
      const composeDosyalari = (/^COMPOSE_FILE=(.*)$/m.exec(uretimMetni)?.[1] ?? "").trim().replace(/^["']|["']$/g, "").split(":").filter(Boolean);
      const ortamMetni = uretimMetni
        .replace(/^SATICI_IMAJ=.*$/m, "SATICI_IMAJ=tekserp-satici:bekci")
        .replace(/^SATICI_YEDEK_IMAJ=.*$/m, "SATICI_YEDEK_IMAJ=tekserp-satici-yedek:bekci")
        .replace(/^PORTAL_HOST=.*$/m, "PORTAL_HOST=portal.bekci.test")
        .replace(/^CF_ACCESS_TAKIM_ALANI=.*$/m, `CF_ACCESS_TAKIM_ALANI=${TAKIM}`)
        .replace(/^CF_ACCESS_AUD=.*$/m, `CF_ACCESS_AUD=${AUD}`)
        .replace(/^ERISIM_JWKS_DIZINI_HOST=.*$/m, `ERISIM_JWKS_DIZINI_HOST=${gDizin}`);
      const envDosyasi = path.join(gDizin, "bekci.env");
      writeFileSync(envDosyasi, ortamMetni);
      type Birlesik = { services: Record<string, { networks?: Record<string, unknown>; volumes?: { target?: string; read_only?: boolean }[] }>; networks: Record<string, { internal?: boolean }> };
      const birlestir = (dosyalar: string[]): Birlesik | string => {
        const r = spawnSync("docker", ["compose", "--env-file", envDosyasi, ...dosyalar.flatMap((f) => ["-f", path.join(composeKoku, f)]), "config", "--format", "json"], { encoding: "utf8" });
        return r.status === 0 ? (JSON.parse(r.stdout) as Birlesik) : (r.stderr || "config başarısız").trim().slice(0, 300);
      };
      kontrol(
        "§5e0 ornek-uretim.env COMPOSE_FILE = docker-compose.yml + docker-compose.portal-genel.yml (portalın tek yolu; emekli örtü yok)",
        JSON.stringify(composeDosyalari) === JSON.stringify(["docker-compose.yml", "docker-compose.portal-genel.yml"]),
        composeDosyalari.join(":") || "COMPOSE_FILE yok",
      );
      const uretim = birlestir(composeDosyalari);
      const yalin = birlestir(["docker-compose.yml"]);
      if (typeof uretim === "string" || typeof yalin === "string") {
        kontrol("§5e birleşik yapılandırma çözüldü", false, typeof uretim === "string" ? uretim : String(yalin));
      } else {
        const aglar = (c: Birlesik, sv: string) => Object.keys(c.services[sv]?.networks ?? {}).sort();
        const dis = (c: Birlesik, sv: string) => aglar(c, sv).filter((n) => c.networks[n]?.internal !== true);
        const uyeler = (c: Birlesik, ag: string) => Object.entries(c.services).filter(([, s]) => ag in (s.networks ?? {})).map(([a]) => a);
        const bag = (c: Birlesik, sv: string) => (c.services[sv]?.volumes ?? []).find((v) => v.target === "/erisim-jwks");
        const disAglar = Object.entries(uretim.networks).filter(([, n]) => n.internal !== true).map(([a]) => a).sort();
        kontrol(
          "§5e ⭐ üretim kurulumu: satıcının internal olmayan ağı YOK — ağları tam kenar · ic · ic-api, üçü internal",
          JSON.stringify(aglar(uretim, "satici")) === JSON.stringify(["ic", "ic-api", "kenar"]) && dis(uretim, "satici").length === 0,
          `ağlar: ${aglar(uretim, "satici").join(",")} · internal olmayan: ${dis(uretim, "satici").join(",") || "yok"}`,
        );
        kontrol(
          "§5e2 üst dosya satıcıya ağ eklemedi (yalın ana dosyayla aynı küme); yapılandırmanın internal olmayan TEK ağı jwks-cikis; tailnet ağı / portal-tunel servisi yok",
          JSON.stringify(aglar(uretim, "satici")) === JSON.stringify(aglar(yalin, "satici")) &&
            JSON.stringify(disAglar) === JSON.stringify(["jwks-cikis"]) &&
            !Object.keys(uretim.networks).some((a) => /tailnet/i.test(a)) &&
            !("portal-tunel" in uretim.services),
          `internal olmayan: ${disAglar.join(",") || "yok"}`,
        );
        kontrol(
          "§5e3 çıkışlı köprünün (jwks-cikis) TEK üyesi satici-jwks; JWKS bağı satıcıda ro, yan konteynerde rw",
          JSON.stringify(uyeler(uretim, "jwks-cikis")) === JSON.stringify(["satici-jwks"]) &&
            uretim.networks["jwks-cikis"]?.internal !== true &&
            bag(uretim, "satici")?.read_only === true &&
            bag(uretim, "satici-jwks") !== undefined &&
            bag(uretim, "satici-jwks")?.read_only !== true,
          uyeler(uretim, "jwks-cikis").join(","),
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
  let erisimAdresi: AddressInfo | null = null;
  let kapaliAdresi: AddressInfo | null = null;
  const genel = http.createServer(createPublicApp(ctx, null));
  const erisimApp = createAccessApp(ctx, { listener: () => erisimAdresi, verifier: httpV });
  const erisim = http.createServer(erisimApp);
  const yanlisSoket = http.createServer(erisimApp);
  const kapali = http.createServer(createAccessApp(ctx, { listener: () => kapaliAdresi, verifier: null }));
  // Sentetik yönlendiriciler (§6q–§6t): ERİŞİM = JWT kapısı + opt-in yönlendirici; GENEL = yalnız yönlendirici.
  const sondaSunuculari: http.Server[] = [];
  const sondaKur = async (listener: "ERISIM" | "GENEL", routes: readonly PortalRouteDef[], jwtKapisi = true): Promise<string> => {
    const app = express();
    if (listener === "ERISIM" && jwtKapisi) app.use(requireAccessJwt(httpV));
    app.use("/portal/api", createPortalRouter(ctx, listener, routes));
    app.use(notFound);
    app.use(errorHandler);
    const srv = http.createServer(app);
    sondaSunuculari.push(srv);
    return `http://127.0.0.1:${(await dinle(srv)).port}`;
  };
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const kurulumlar: string[] = [];
  const yayinciKidler: string[] = [];
  try {
    const genelAdresi = await dinle(genel);
    erisimAdresi = await dinle(erisim);
    const yanlisAdres = await dinle(yanlisSoket);
    kapaliAdresi = await dinle(kapali);
    const G = `http://127.0.0.1:${genelAdresi.port}`;
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
    const eGirisJwtsiz = await portalGiris(E, "/portal/api", yonetici, { adimKaydir: 1 });
    kontrol("§6g giriş ucu da kapının arkasında: JWT'siz giriş 404, sayaç değişmez", eGirisJwtsiz.status === 404 && (await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id } })).basarisizGiris === 0, `${eGirisJwtsiz.status}`);
    const eGiris = await portalGiris(E, "/portal/api", yonetici, { adimKaydir: 1, basliklar: JWT });
    kontrol("§6h satıcı yöneticisi ERİŞİM'den girer (parola + TOTP) → 200", eGiris.status === 200, `${eGiris.status} ${eGiris.kod ?? ""}`);
    kontrol("§6h2 ERİŞİM çerezi HttpOnly + SameSite=Strict + Secure + Path=/portal", /HttpOnly/.test(eGiris.setCookie ?? "") && /SameSite=Strict/.test(eGiris.setCookie ?? "") && /Secure/.test(eGiris.setCookie ?? "") && /Path=\/portal(;|$)/.test(eGiris.setCookie ?? ""), (eGiris.setCookie ?? "").replace(/=[^;]+/, "=***"));
    kontrol("§6h3 oturum yanıtı dinleyiciyi ERISIM bildirir", eGiris.veri.dinleyici === "ERISIM", String(eGiris.veri.dinleyici));
    const eCerez = eGiris.cerez!;
    const oturumSatiri = await prisma.portalOturumu.findFirst({ where: { kullaniciId: yonetici.id, dinleyici: "ERISIM" } });
    kontrol("§6h4 DB'de oturum ERISIM dinleyicisine bağlı doğdu", oturumSatiri !== null);
    const pano = await portalIstek(E, "/portal/api/pano", { cerez: eCerez, basliklar: JWT });
    kontrol("§6i ERİŞİM oturumu + JWT → portal okunur (200)", pano.status === 200, `${pano.status} ${pano.kod ?? ""}`);
    const panoJwtsiz = await portalIstek(E, "/portal/api/pano", { cerez: eCerez });
    kontrol("§6i2 oturum çerezi TEK başına yetmez: JWT'siz her istek 404", panoJwtsiz.status === 404, `${panoJwtsiz.status}`);
    // Bayi, satıcı yöneticisinin ERİŞİM oturumuyla açılır; bayi oturumu yalnız GENEL'de (bayi alt-portalı) doğar.
    const bayiR = await portalIstek(E, "/portal/api/bayiler", {
      cerez: eCerez,
      basliklar: JWT,
      govde: { clientToken: randomUUID(), ad: "Erişim Bekçi Bayisi", tavan: { moduller: ["production.enabled"], siniflar: ["URETIM"], kurulumAdedi: 1 }, sebep: "bekçi" },
    });
    if (bayiR.status !== 201) throw new Error(`bayi açılamadı: ${bayiR.status} ${bayiR.kod ?? ""}`);
    bayiler.push(bayiR.veri.id as string);
    const bayi: PortalKimlik = await portalKullaniciAc(ctx, "BAYI", bayiR.veri.id as string);
    kullanicilar.push(bayi.id);
    const bayiG = await portalGiris(G, "/bayi/api", bayi);
    const bayiOturumu = await portalIstek(G, "/bayi/api/oturum", { cerez: bayiG.cerez ?? "" });
    const deger = (c: string | null): string => (c ?? "").slice((c ?? "").indexOf("=") + 1);
    const tasinanE = await portalIstek(G, "/bayi/api/oturum", { cerez: `bayi_oturum=${deger(eCerez)}` });
    const tasinanG = await portalIstek(E, "/portal/api/pano", { cerez: `satici_oturum=${deger(bayiG.cerez)}`, basliklar: JWT });
    kontrol(
      "§6j belirteç öbür dinleyicide geçmez: bayi GENEL'de girer (200), ERİŞİM belirteci GENEL'de 401, GENEL (bayi) belirteci ERİŞİM'de 401 (rol + dinleyici; aynı rolde dinleyici bağı: test_tunel_yok §5a)",
      bayiG.status === 200 && bayiOturumu.status === 200 && deger(eCerez).length > 0 && deger(bayiG.cerez).length > 0 && tasinanE.status === 401 && tasinanG.status === 401,
      `${bayiG.status}/${bayiOturumu.status} · ${tasinanE.status}/${tasinanG.status}`,
    );

    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const plan = await portalIstek(E, `/portal/api/haklar/${k.hakId}/imza-plani`, { cerez: eCerez, basliklar: JWT });
    const imzaci = String(plan.veri.imzaci ?? "");
    const yanlisGovde = { clientToken: randomUUID(), imzaci, imzaParolasi: "yanlis-parola-bekci", sebep: "erişim bekçisi" };
    const kokE = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: yanlisGovde });
    const kokEOturumsuz = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { basliklar: JWT, govde: { ...yanlisGovde, clientToken: randomUUID() } });
    kontrol(
      "§6k ⭐ HAK imzası ERİŞİM'de rotaya ULAŞIR: yanlış imza parolası 400 IMZA_PAROLASI_HATALI (oturumsuz 401 OTURUM_YOK — 404 değil)",
      imzaci === "KOK" && kokE.status === 400 && kokE.kod === "IMZA_PAROLASI_HATALI" && kokEOturumsuz.status === 401 && kokEOturumsuz.kod === "OTURUM_YOK",
      `plan ${imzaci} · ${kokE.status} ${kokE.kod ?? ""} / ${kokEOturumsuz.status} ${kokEOturumsuz.kod ?? ""}`,
    );
    const kokE2 = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: { ...yanlisGovde, clientToken: randomUUID() } });
    kontrol("§6k2 ikinci yanlış parola (yeni kimlik) ERİŞİM'de yine 400 IMZA_PAROLASI_HATALI", kokE2.status === 400 && kokE2.kod === "IMZA_PAROLASI_HATALI", `${kokE2.status} ${kokE2.kod ?? ""}`);
    const sayac = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id }, select: { imzaBasarisiz: true } });
    kontrol("§6k3 ERİŞİM'deki her yanlış parola imza sayacına girdi (1 + 1 = 2; kilit eşiği tek yolda)", sayac.imzaBasarisiz === 2, `${sayac.imzaBasarisiz}`);
    const hakSurum = await prisma.hakSurumu.count({ where: { hakId: k.hakId } });
    kontrol("§6k4 yanlış parolayla hiçbir yeni imzalı sürüm doğmadı", hakSurum === 1, `${hakSurum}`);
    const imzaGovdesi = { clientToken: randomUUID(), imzaci, imzaParolasi: TEST_KOK_PAROLASI, sebep: "erişim bekçisi imzası" };
    const imzaE = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: imzaGovdesi });
    const imzaSatiri = await prisma.denetim.findFirst({ where: { varlik: "Hak", varlikId: k.hakId, olay: "HAK_IMZALANDI" }, orderBy: { createdAt: "desc" } });
    const sayacSonra = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id }, select: { imzaBasarisiz: true } });
    kontrol(
      "§6k5 ✓K doğru imza parolasıyla ERİŞİM'de GERÇEKTEN imzalar: 201 · sürüm 2 · denetimde erisimKimligi · parola özette YOK · sayaç sıfırlandı",
      imzaE.status === 201 &&
        imzaE.veri.surum === 2 &&
        (await prisma.hakSurumu.count({ where: { hakId: k.hakId } })) === 2 &&
        (imzaSatiri?.ozet as { erisimKimligi?: string } | null)?.erisimKimligi === EPOSTA &&
        !JSON.stringify(imzaSatiri?.ozet ?? null).includes(TEST_KOK_PAROLASI) &&
        sayacSonra.imzaBasarisiz === 0,
      `${imzaE.status} ${imzaE.kod ?? ""} · ${JSON.stringify(imzaSatiri?.ozet ?? null)} · sayaç ${sayacSonra.imzaBasarisiz}`,
    );
    const islem = await prisma.portalIslemi.findUnique({ where: { clientToken: imzaGovdesi.clientToken } });
    kontrol(
      "§6k6 ⭐ saklanan gövde özeti = imza parolası ÇIKARILMIŞ gövdenin özeti (bağımsız hesap; parola tuzsuz SHA-256'ya girmez)",
      islem !== null && islem.govdeOzeti === bagimsizOzet({ ...imzaGovdesi, _yol: k.hakId }, ["imzaParolasi"]) && islem.govdeOzeti !== bagimsizOzet({ ...imzaGovdesi, _yol: k.hakId }, []),
      islem?.govdeOzeti ?? "işlem satırı yok",
    );
    const imzaTekrar = await portalIstek(E, `/portal/api/haklar/${k.hakId}/surum`, { cerez: eCerez, basliklar: JWT, govde: { ...imzaGovdesi, imzaParolasi: "baska-parola-bekci" } });
    kontrol(
      "§6k7 aynı kimlik BAŞKA parolayla aynı yanıtı alır (201 tekrar, 409 değil): parola gövde kapısına girmez, imza ikinci kez koşmaz",
      imzaTekrar.status === 201 && imzaTekrar.veri.surum === 2 && (await prisma.hakSurumu.count({ where: { hakId: k.hakId } })) === 2,
      `${imzaTekrar.status} ${imzaTekrar.kod ?? ""}`,
    );
    const yaz = await portalIstek(E, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, {
      cerez: eCerez,
      basliklar: JWT,
      govde: { clientToken: randomUUID(), kademe: "K0", mesaj: "Hatırlatma", sebep: "erişim bekçisi" },
    });
    kontrol("§6l kök parolasız yazma ERİŞİM'de çalışır (K0 → 201)", yaz.status === 201, `${yaz.status} ${yaz.kod ?? ""}`);

    // Yeni TOTP adımı: ret ancak dinleyici-rol kuralından gelebilir (GENEL girişinin adımı tekrar sayılamaz).
    const bayiE = await portalGiris(E, "/portal/api", bayi, { adimKaydir: 1, basliklar: JWT });
    const bilinmeyen = await portalIstek(E, "/portal/api/oturum/ac", { basliklar: JWT, govde: { kullaniciAdi: "hic-olmayan", parola: "x".repeat(20), totp: "123456" } });
    kontrol("§6m BAYI ERİŞİM'den giremez: 401, bilinmeyen hesapla AYNI ileti", bayiE.status === 401 && bayiE.json.message === bilinmeyen.json.message && bayiE.setCookie === null, `${bayiE.status}`);
    // Sağlık ucu (portal ana sayfası kartı): sunucunun çalışma tutamaçları bağlamda (server.ts gibi).
    let saglikAdresi: AddressInfo | null = null;
    const saglikSunucu = http.createServer(createAccessApp({ ...ctx, runtime: { hub: null, access: httpV } }, { listener: () => saglikAdresi, verifier: httpV }));
    sondaSunuculari.push(saglikSunucu);
    saglikAdresi = await dinle(saglikSunucu);
    const S = `http://127.0.0.1:${saglikAdresi.port}`;
    const saglik = await portalIstek(S, "/portal/api/saglik", { cerez: eCerez, basliklar: JWT });
    const saglikOturumsuz = await portalIstek(S, "/portal/api/saglik", { basliklar: JWT });
    const saglikJwtsiz = await portalIstek(S, "/portal/api/saglik", { cerez: eCerez });
    const erisimDurumu = (saglik.veri.erisim ?? {}) as { kip?: string; jwks?: { dolu?: boolean; dosyaYasiSn?: number | null; azamiYasSn?: number; yasDurumu?: string } };
    kontrol(
      "§6o portal sağlık ucu (oturum + JWT) ERİŞİM kipini, JWKS durumunu, DOSYA YAŞINI ve yaş tavanını gösterir (sır yok); oturumsuz 401, JWT'siz 404",
      saglik.status === 200 &&
        saglikOturumsuz.status === 401 &&
        saglikJwtsiz.status === 404 &&
        erisimDurumu.kip === "acik" &&
        erisimDurumu.jwks?.dolu === true &&
        typeof erisimDurumu.jwks?.dosyaYasiSn === "number" &&
        erisimDurumu.jwks?.azamiYasSn === 604_800 &&
        erisimDurumu.jwks?.yasDurumu === "TAZE" &&
        !/"n"|"d"|BEGIN/.test(JSON.stringify(saglik.veri)),
      `${saglik.status}/${saglikOturumsuz.status}/${saglikJwtsiz.status} · ${JSON.stringify(erisimDurumu)}`,
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
    kontrol("§6p ✓K listedeki her tablo rotası ERİŞİM'de oturumsuz 401 (bağlı), liste dışı (dışlamadaki) her rota 404", sapma.length === 0, sapma.slice(0, 5).join(" | ") || `${VENDOR_PORTAL_ROUTES.length} rota`);
    const hamPut = await portalIstek(E, `/portal/api/ham/giden-oturum/${UUID0}/parca/0`, { yontem: "PUT", basliklar: JWT, govde: "x", icerikTuru: "application/octet-stream" });
    const hamGet = await portalIstek(E, `/portal/api/ham/dosyalar/${UUID0}`, { basliklar: JWT });
    const hamYok = await portalIstek(E, `/portal/api/ham/olmayan/${UUID0}`, { basliklar: JWT });
    kontrol("§6p2 ham uçlar: listedeki parça PUT ve dosya indirme bağlı (401), liste dışı ham yol 404", hamPut.status === 401 && hamGet.status === 401 && hamYok.status === 404, `${hamPut.status}/${hamGet.status}/${hamYok.status}`);
    const formlu = await portalIstek(E, `/portal/api/liste-disi/${UUID0}/parola`, { cerez: eCerez, basliklar: JWT, govde: "parola=x", icerikTuru: "application/x-www-form-urlencoded" });
    const formluListede = await portalIstek(E, `/portal/api/kullanicilar/${UUID0}/parola`, { cerez: eCerez, basliklar: JWT, govde: "parola=x", icerikTuru: "application/x-www-form-urlencoded" });
    kontrol(
      "§6p3 liste dışı yazma gövde OKUNMADAN 404 (JSON dışı gövde 400 değil 404); AYNI gövde listedeki rotada gövde kapısına takılır (400 — kapı kör değil)",
      formlu.status === 404 && formluListede.status === 400 && formluListede.kod === "GOVDE_GECERSIZ",
      `${formlu.status} ${formlu.kod ?? ""} / ${formluListede.status} ${formluListede.kod ?? ""}`,
    );

    console.log("\n§6q açık-liste düzeni (liste dışı sonda rotası) ve imza boğazı ERİŞİM kapsamında");
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
    kontrol("§6q1 ⭐ listede OLMAYAN sonda rotası ERİŞİM'de 404, işleyici KOŞMADI — açık-liste düzeni (liste ≈ tablo iken de)", dev.status === 404 && devredenKostu === 0, `${dev.status} · koştu ${devredenKostu}`);
    const SIZAN = "POST /kurulumlar/:id/yaptirim";
    const yerine = (handler: PortalRouteDef["handler"]): PortalRouteDef[] => [
      { method: "post", path: "/kurulumlar/:id/yaptirim", permission: "hak:yaz", kimlik: { muaf: "sonda" }, handler },
      ...VENDOR_PORTAL_ROUTES.filter((r) => routeKey(r.method, r.path) !== SIZAN),
    ];
    const hatalar: string[] = [];
    const gercekHata = console.error;
    const eYardimci = await sondaKur("ERISIM", yerine(async (c) => ({ data: { surum: (await kokImzaYardimcisi(c)).version } })));
    console.error = (...a: unknown[]) => void hatalar.push(a.map(String).join(" "));
    let yardimciE;
    try {
      yardimciE = await portalIstek(eYardimci, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: eCerez, basliklar: JWT, govde: {} });
    } finally {
      console.error = gercekHata;
    }
    kontrol(
      "§6q2a ✓K listedeki rotadan imza yardımcısına devreden kök imzası ERİŞİM'de GERÇEKTEN imzalar (200, sürüm hazırlandı) — boğaz ERİŞİM kapsamını reddetmedi",
      yardimciE.status === 200 && typeof yardimciE.veri.surum === "number" && !hatalar.some((h) => /yolundan istendi — RED/.test(h)),
      `${yardimciE.status} ${yardimciE.kod ?? ""} · ${hatalar.join(" / ").slice(0, 120)}`,
    );
    const oncekiSayac = await imzaSayaci();
    const korunan = yerine(async (c) => ({
      data: await withSigningPasswordGuard(c.ctx, { userId: c.session.user.id, actor: c.session.actor, kind: "KOK" }, async () => (await kokImzaYardimcisi(c)).version),
    }));
    const eKorunan = await sondaKur("ERISIM", korunan);
    const korunanE = await portalIstek(eKorunan, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, { cerez: eCerez, basliklar: JWT, govde: {} });
    kontrol("§6q3 imza parolası kapısı (withSigningPasswordGuard) ERİŞİM'de kök imzasını geçirir (200), sayaç artmaz", korunanE.status === 200 && (await imzaSayaci()) === oncekiSayac, `${korunanE.status} ${korunanE.kod ?? ""}`);
    const jwtsizSonda = await sondaKur("ERISIM", VENDOR_PORTAL_ROUTES, false);
    const jwtsiz = await portalIstek(jwtsizSonda, "/portal/api/pano", { cerez: eCerez });
    kontrol("§6q4 JWT kapısı OLMADAN bağlanmış ERİŞİM yönlendiricisi her isteğe 404 (Access kimliği yok)", jwtsiz.status === 404, `${jwtsiz.status}`);

    console.log("\n§6r kullanıcı yönetimi ve anahtar kayıtları ERİŞİM'de (TOTP sırrı yalnız canlı yanıtta)");
    const sondaAdi = `erisim-sonda-${randomUUID().slice(0, 8)}`;
    const sondaParola = `erisim-sonda-parola-${randomUUID()}`;
    const acmaGovde = { clientToken: randomUUID(), kullaniciAdi: sondaAdi, adSoyad: "Sonda", rol: "SATICI_OPERATOR", parola: sondaParola };
    const acma = await portalIstek(E, "/portal/api/kullanicilar", { cerez: eCerez, basliklar: JWT, govde: acmaGovde });
    const sondaId = String((acma.veri.kullanici as { id?: string } | undefined)?.id ?? "");
    if (sondaId) kullanicilar.push(sondaId);
    const acmaTekrar = await portalIstek(E, "/portal/api/kullanicilar", { cerez: eCerez, basliklar: JWT, govde: acmaGovde });
    kontrol(
      "§6r1 ⭐ ERİŞİM'de kullanıcı açma 201 + TOTP sırrı canlı yanıtta; aynı işlem kimliği tekrarında sır YOK (totpGosterilemez)",
      acma.status === 201 && sondaId !== "" && acma.veri.totp !== null && acma.veri.totp !== undefined && acmaTekrar.veri.totp === null && acmaTekrar.veri.totpGosterilemez === true,
      `${acma.status} ${acma.kod ?? ""} / tekrar ${acmaTekrar.status} ${String(acmaTekrar.veri.totpGosterilemez)}`,
    );
    const kulListe = await portalIstek(E, "/portal/api/kullanicilar", { cerez: eCerez, basliklar: JWT });
    const kul = (yol: string, govde: Record<string, unknown>) => portalIstek(E, `/portal/api/kullanicilar/${sondaId}/${yol}`, { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), ...govde } });
    const pasif = await kul("pasif", { sebep: "erişim bekçisi" });
    const aktif = await kul("aktif", { sebep: "erişim bekçisi" });
    const totpS = await kul("totp-sifirla", { sebep: "erişim bekçisi" });
    const kilit = await kul("kilit-ac", {});
    const parolaS = await kul("parola", { parola: `${sondaParola}-2`, sebep: "erişim bekçisi" });
    const durumlar = [kulListe, pasif, aktif, totpS, kilit, parolaS].map((y) => y.status);
    kontrol(
      "§6r2 ERİŞİM'de liste · pasif · aktif · TOTP sıfırlama (yeni sır canlı yanıtta) · kilit açma · parola sıfırlama → 200",
      durumlar.every((d) => d === 200) && JSON.stringify(kulListe.veri).includes(sondaAdi) && totpS.veri.totp !== null && totpS.veri.totp !== undefined,
      durumlar.join("/"),
    );
    const bayiAnahtarE = await portalIstek(E, `/portal/api/bayiler/${bayiler[0] ?? UUID0}/anahtar`, { cerez: eCerez, basliklar: JWT, govde: { clientToken: randomUUID(), kid: "bayi-erisim-sonda" } });
    kontrol(
      "§6r3 bayi anahtarı bağlama ERİŞİM'de işleyiciye ULAŞIR (dizinde olmayan anahtar → 400 iş kuralı, 404 değil)",
      bayiAnahtarE.status === 400 && /anahtar dizininde yok/.test(String(bayiAnahtarE.json.message ?? "")),
      `${bayiAnahtarE.status} ${bayiAnahtarE.kod ?? ""}`,
    );
    const yayinciKid = `erisim-sonda-${randomUUID().slice(0, 8)}`;
    yayinciKidler.push(yayinciKid);
    const yayinciE = await portalIstek(E, "/portal/api/yayincilar", {
      cerez: eCerez,
      basliklar: JWT,
      govde: { clientToken: randomUUID(), kid: yayinciKid, ad: "Erişim sonda yayıncısı", acikAnahtar: generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x },
    });
    kontrol("§6r4 yayıncı anahtarı kaydı ERİŞİM'de 201", yayinciE.status === 201, `${yayinciE.status} ${yayinciE.kod ?? ""}`);

    console.log("\n§6s denetim: ERİŞİM'den gelen her satırda Access e-postası; denetimsiz yazmaya ayak izi");
    type Ozet = { dinleyici?: string; erisimKimligi?: string; rota?: string } | null;
    const girisE = (await prisma.denetim.findMany({ where: { olay: "PORTAL_GIRIS", varlikId: yonetici.id } })).find((g) => (g.ozet as Ozet)?.dinleyici === "ERISIM");
    const girisG = (await prisma.denetim.findMany({ where: { olay: "PORTAL_GIRIS", varlikId: bayi.id } })).find((g) => (g.ozet as Ozet)?.dinleyici === "GENEL");
    kontrol(
      "§6s1 PORTAL_GIRIS: ERİŞİM girişinde erisimKimligi = Access e-postası; bayinin GENEL girişinde YOK",
      (girisE?.ozet as Ozet)?.erisimKimligi === EPOSTA && girisG !== undefined && !("erisimKimligi" in ((girisG.ozet as object | null) ?? {})),
      `${(girisE?.ozet as Ozet)?.erisimKimligi ?? "YOK"} · genel ${girisG ? JSON.stringify(girisG.ozet) : "satır yok"}`,
    );
    const yaptirimSatiri = await prisma.denetim.findFirst({ where: { varlik: "Kurulum", varlikId: k.kurulumDbId, olay: { startsWith: "YAPTIRIM_" } }, orderBy: { createdAt: "desc" } });
    kontrol("§6s2 ERİŞİM'den yapılan yazmanın (K0) denetim satırında erisimKimligi", (yaptirimSatiri?.ozet as Ozet)?.erisimKimligi === EPOSTA, JSON.stringify(yaptirimSatiri?.ozet ?? null));
    const kulSatirlari = await prisma.denetim.findMany({ where: { varlik: "PortalKullanici", varlikId: sondaId } });
    const yayinciSatiri = await prisma.denetim.findFirst({ where: { olay: "YAYINCI_EKLENDI", varlikId: String(yayinciE.veri.id ?? "") } });
    const sirSizdi = kulSatirlari.filter((r) => {
      const metin = JSON.stringify(r.ozet ?? null);
      return metin.includes(sondaParola) || /"(parola|totp|sir|tohum|uri)"/i.test(metin);
    });
    kontrol(
      "§6s6 ERİŞİM'den kullanıcı yönetimi (açma · pasif · aktif · TOTP · kilit · parola) ve yayıncı kaydı satırlarında erisimKimligi; kullanıcı satırlarında parola/TOTP sırrı YOK",
      kulSatirlari.length >= 6 && kulSatirlari.every((r) => (r.ozet as Ozet)?.erisimKimligi === EPOSTA) && sirSizdi.length === 0 && (yayinciSatiri?.ozet as Ozet)?.erisimKimligi === EPOSTA,
      `${kulSatirlari.length} satır · ${kulSatirlari.map((r) => r.olay).join(",")} · sızan ${sirSizdi.length} · yayıncı ${JSON.stringify(yayinciSatiri?.ozet ?? null)}`,
    );
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
    for (const s of [genel, erisim, yanlisSoket, kapali, ...sondaSunuculari]) await kapatSunucu(s);
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler });
    await temizleDagitim({ yayinciKidler });
  }

  console.log("\n§7 gerçek süreç — açılış satırı, KAPALI kip, JWKS dosyalı AÇIK kip");
  const kapaliSurec = await sunucuBaslat(ortam, {}, { erisim: false });
  kontrol("§7a PORT_ERISIM verilmeyen süreç ERİŞİM dinleyicisini AÇMAZ (erisim=kapali)", /SATICI_DINLIYOR [^\n]* erisim=kapali/.test(kapaliSurec.cikti()), kapaliSurec.cikti().match(/SATICI_DINLIYOR[^\n]*/)?.[0] ?? "");
  await kapaliSurec.durdur();
  const acikSurec = await sunucuBaslat(ortam, { PORT_ERISIM: "0", ERISIM_BIND: "127.0.0.1" }, { erisim: false });
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
  const tamSurec = await sunucuBaslat(ortam, { PORT_ERISIM: "0", ERISIM_BIND: "127.0.0.1", CF_ACCESS_TAKIM_ALANI: TAKIM, CF_ACCESS_AUD: AUD, CF_ACCESS_JWKS_DOSYASI: surecJwks }, { erisim: false });
  try {
    const port = /SATICI_DINLIYOR [^\n]* erisim=(\d+)/.exec(tamSurec.cikti())?.[1];
    const simdiGercek = Math.floor(Date.now() / 1000);
    const basliklar = { "cf-access-jwt-assertion": gecerli({ iat: simdiGercek - 5, nbf: simdiGercek - 5, exp: simdiGercek + 3600 }) };
    const gecti = port ? await portalIstek(`http://127.0.0.1:${port}`, "/portal/api/oturum", { basliklar }) : null;
    const jwtsiz = port ? await portalIstek(`http://127.0.0.1:${port}`, "/portal/api/oturum", { erisimJetonu: false }) : null;
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
