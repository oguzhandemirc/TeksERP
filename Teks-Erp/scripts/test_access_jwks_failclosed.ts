// =============================================================================
// BEKÇİ — JWKS ÖNBELLEĞİ: "bayatlık ≠ boşluk" (TTL tazeliktir, geçerlilik değil)
// =============================================================================
// ÖLÇTÜĞÜ ÇEKİRDEK CÜMLE (kök CLAUDE.md): *"önbellekte TTL tazeliktir geçerlilik
// değil (bayat döner + tazeler; HİÇ DOLMADIYSA fail-closed kalır)"*.
//
// ⚠️ CÜMLENİN YERİ ÖLÇÜLDÜ (d5, 2026-09-13) ve ilk sandığım yer YANLIŞTI:
// `FEATURE_FLAGS_TTL_MS` (`system-setting.service.ts:1586`) DÜZ bir son-kullanma
// önbelleğidir — süre dolunca senkron taze okur, bayat DÖNMEZ, arka planda
// tazelemez (`:1751` `expiresAt > now ? cache : taze`). Oraya sonda koymak
// VAR OLMAYAN bir dalı ölçmek olurdu. Doktrinin gerçek yeri
// `remote-access.middleware.ts:207-221` (JWKS) ve `reason-preset.service.ts:104`.
//
// NEDEN BU BEKÇİ BUGÜNE KADAR YOKTU — ve sınıfı: `resetAccessJwksCacheForTest()`
// ile `expireAccessJwksCacheForTest()` ÜRÜN KODUNDA ZATEN VARDI (`:283`, `:290`),
// ama TARAMA SONUCU: onları çağıran tek satır yoktu (2026-09-13, d5 ölçtü,
// doğruladım). Yani bu bir **"ölçülmedi" (bilgi eksiği) DEĞİL, "bekçiye
// bağlanmadı" (KAPSAM eksiği)** idi. Kanca yazılmadı — zaten duruyordu.
//
// ÜÇ DURUM, ÜÇ FARKLI CEVAP — ve ayrımın tamamı §1 ile §2b arasındadır:
//   §2a TAZE  önbellek dolu, anahtar taze   → KABUL  (pozitif kontrol)
//   §2b BAYAT önbellek dolu, TTL geçmiş     → KABUL  ("bayat döner")
//   §1  BOŞ   önbellek hiç dolmamış         → RED    ("hiç dolmadıysa fail-closed")
// §2b ile §1 aynı cevabı verirse doktrin YOK demektir: ya ikisi de reddediyordur
// (patronu kapıda bırakan eski davranış) ya ikisi de geçiriyordur (fail-OPEN).
//
// ⚠️ NEYİ SAHTELİYORUM: yalnız `globalThis.fetch` — yani AĞI. SUT (`verifyAccessJwt`
// → `getSigningKey` → `jwt.verify`) GERÇEK koşuyor ve gerçek RSA imzası doğruluyor.
// "Sondayı sahte nesneyle kurma, gerçek çağrıyı yanlış girdiyle koştur" kuralı
// korunuyor: sahte olan Cloudflare'in kendisi, ölçülen kod değil.
//
// DB'ye DOKUNMAZ, sunucu AÇMAZ (middleware süreç-içi çağrılır) — `hedefDbEngeli`
// gerekmiyor, yazma yok.
// =============================================================================
import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import {
  verifyAccessJwt,
  resetAccessJwksCacheForTest,
  expireAccessJwksCacheForTest,
} from "../src/middlewares/remote-access.middleware";

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}

const TEAM = "tst-bekci.cloudflareaccess.com";
const AUD = `tst-aud-${randomUUID()}`;
const KID = `tst-kid-${Date.now().toString(36)}`;

// ── Gerçek RSA çifti: JWKS de imza da SAHİCİ ────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkPublic = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: KID, kty: "RSA", alg: "RS256", use: "sig" };
const JWKS_BODY = JSON.stringify({ keys: [jwkPublic] });

function tokenUret(): string {
  return jwt.sign({ email: "bekci@tst.local", sub: "tst-sub" }, privateKey.export({ type: "pkcs8", format: "pem" }) as string, {
    algorithm: "RS256", audience: AUD, issuer: `https://${TEAM}`, keyid: KID, expiresIn: "5m",
  });
}

// ── Ağ sahtesi: yalnız JWKS ucu. `mod`u değiştirerek ağ kesintisi kurulur ────
type AgMod = "calisir" | "duser";
let agMod: AgMod = "calisir";
let agCagrisi = 0;
const gercekFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String(input);
  if (url.includes("/cdn-cgi/access/certs")) {
    agCagrisi++;
    if (agMod === "duser") throw new Error("TST: ağ yok (JWKS çekilemiyor)");
    return new Response(JWKS_BODY, { status: 200, headers: { "content-type": "application/json" } });
  }
  return gercekFetch(input as never, init as never);
}) as typeof globalThis.fetch;

// ── Red GEREKÇESİ yakalayıcı (`uyari()` → `console.warn`) ───────────────────
// ⚠️ NEDEN GEREKLİ — negatif sonda ölçtü (2026-09-13): fail-closed satırını
// (`if (jwksKeys === null) return null;`) SİLİNCE sonda YİNE 12/0 YEŞİL kaldı.
// Sebep: silince `jwksKeys.get(kid)` bir TypeError fırlatıyor, dış try/catch onu
// yakalıyor ve AYNI 403'ü üretiyor. Yani kapı ölür, cevap aynı kalır — gözlenen
// davranış kapının VARLIĞINI ayırt etmiyor. Ayıran tek şey GEREKÇE:
//     sağlam  → "imza anahtarı çözülemedi"            (kasıtlı dal)
//     silinmiş→ "Cannot read properties of null ..."  (kaza eseri çökme)
// ⚠️ TÜM uyarılar toplanır, "sonuncusu" DEĞİL: aynı istekte iki uyarı düşüyor
// (arka plan tazeleme hatası + red gerekçesi) ve SIRALARI zamanlamaya bağlı.
// "Sonuncusuna bak" deseydim yeşil/kırmızı log sırasına bağlı olurdu — yüklem
// ölçtüğü şeye değil, yarışa bağlanırdı.
let uyarilar: string[] = [];
const gercekWarn = console.warn;
console.warn = ((...a: unknown[]) => { uyarilar.push(a.map(String).join(" ")); gercekWarn(...(a as [])); }) as typeof console.warn;
const redGerekcesi = (): string => uyarilar.filter((u) => u.includes("Access JWT reddedildi")).join(" | ");

/** Middleware'i süreç-içi koşturur; `next()` mi `res` mi önce biterse onu döner. */
async function istek(handler: RequestHandler, token: string | null): Promise<{ sonuc: "gecti" | "reddedildi"; status: number; body: Record<string, unknown>; kimlik: unknown }> {
  uyarilar = [];
  return new Promise((resolve) => {
    let status = 0;
    const req = {
      isRemote: true,
      headers: token ? { "cf-access-jwt-assertion": token } : {},
      accessIdentity: undefined as unknown,
    };
    const res = {
      status(c: number) { status = c; return this; },
      json(b: Record<string, unknown>) { resolve({ sonuc: "reddedildi", status, body: b, kimlik: req.accessIdentity }); return this; },
    };
    const next = () => resolve({ sonuc: "gecti", status: 200, body: {}, kimlik: req.accessIdentity });
    handler(req as never, res as never, next as never);
  });
}

async function main(): Promise<void> {
  console.log("=== BEKÇİ: JWKS önbelleği — bayatlık ≠ boşluk ===\n");
  const handler = verifyAccessJwt({ accessTeamDomain: TEAM, accessAud: AUD, accessWallDisabled: false } as never);
  const token = tokenUret();

  // ═══ §0 — TESİSAT KONTROLÜ: sonda "her şeye RED diyen sabit" değil ════════
  console.log("── §0 Tesisat ──");
  const duvarKapali = verifyAccessJwt({ accessTeamDomain: TEAM, accessAud: AUD, accessWallDisabled: true } as never);
  const k0 = await istek(duvarKapali, null);
  check("§0a duvar KAPALI iken geçiyor (sonda sabit RED üretmiyor)", k0.sonuc === "gecti", k0.sonuc);
  resetAccessJwksCacheForTest();
  agMod = "calisir";
  const k0b = await istek(handler, null);
  check("§0b duvar AÇIK + başlık YOK → 403 ACCESS_ASSERTION_MISSING",
    k0b.sonuc === "reddedildi" && k0b.status === 403 && (k0b.body.details as { code?: string })?.code === "ACCESS_ASSERTION_MISSING",
    `${k0b.status} ${JSON.stringify(k0b.body.details ?? k0b.body.message)}`);

  // ═══ §2a — POZİTİF KONTROL: TAZE önbellek geçirir ═════════════════════════
  // Bu kırmızıysa §1'in kırmızısı da yeşili de anlamsız: imza/claim kurulumum
  // bozuk demektir, önbellek doktrini hakkında hiçbir şey öğrenemeyiz.
  console.log("\n── §2a TAZE (pozitif kontrol) ──");
  resetAccessJwksCacheForTest();
  agMod = "calisir";
  agCagrisi = 0;
  const t1 = await istek(handler, token);
  check("§2a ⭐ taze önbellekle geçerli JWT KABUL edilir", t1.sonuc === "gecti", `${t1.sonuc} ${t1.status} ${JSON.stringify(t1.body.message ?? "")}`);
  check("§2a kimlik yazıldı (`req.accessIdentity`)",
    (t1.kimlik as { email?: string } | undefined)?.email === "bekci@tst.local", JSON.stringify(t1.kimlik));
  check("§2a JWKS GERÇEKTEN çekildi (önbellek dolduğu ölçüldü, varsayılmadı)", agCagrisi >= 1, `ağ çağrısı=${agCagrisi}`);

  // ═══ §2b — BAYAT: TTL geçmiş ama önbellek DOLU → yine KABUL ═══════════════
  console.log("\n── §2b BAYAT (TTL geçti, önbellek dolu) ──");
  expireAccessJwksCacheForTest();   // yalnız `jwksFetchedAt=0` — anahtarlar DURUYOR
  agMod = "duser";                  // ⚠️ arka plan tazeleme artık DÜŞECEK
  agCagrisi = 0;
  const t2 = await istek(handler, token);
  check("§2b ⭐ BAYAT önbellek yine KABUL eder (TTL tazeliktir, geçerlilik değil)",
    t2.sonuc === "gecti",
    t2.sonuc === "gecti" ? `ağ düşerken bile geçti (arka plan tazeleme başarısız, ağ çağrısı=${agCagrisi})` : `REDDEDİLDİ ${t2.status} — "bayat döner" cümlesi tutmuyor`);
  check("§2b bayatlık gerçekten TETİKLENDİ (tazeleme denendi, sessizce düştü)", agCagrisi >= 1, `ağ çağrısı=${agCagrisi}`);

  // ═══ §1 — BOŞ: önbellek HİÇ dolmamış → fail-closed RED ════════════════════
  console.log("\n── §1 BOŞ (hiç dolmamış) ──");
  resetAccessJwksCacheForTest();    // anahtarlar SİLİNDİ
  agMod = "duser";                  // ve doldurulamıyor
  agCagrisi = 0;
  const t3 = await istek(handler, token);
  check("§1a ⭐ HİÇ dolmamış önbellek fail-closed: geçerli JWT bile REDDEDİLİR",
    t3.sonuc === "reddedildi",
    t3.sonuc === "gecti" ? "GEÇTİ — fail-OPEN: boş önbellek imzayı doğrulamadan kabul etti" : `${t3.status}`);
  check("§1b ⭐ red 403 + `details.code` ACCESS_ASSERTION_INVALID (kod details ALTINDA)",
    t3.status === 403 && (t3.body.details as { code?: string })?.code === "ACCESS_ASSERTION_INVALID",
    `${t3.status} details=${JSON.stringify(t3.body.details)}`);
  check("§1c kimlik YAZILMADI (reddedilen istek `accessIdentity` bırakmaz)", t3.kimlik === undefined, JSON.stringify(t3.kimlik));
  const gerekce1 = redGerekcesi();
  // ⚠️ İKİ YÖNLÜ: hem kasıtlı gerekçeyi ARAR hem çökme imzasını REDDEDER.
  // Tek yönlü yazsaydım ("çökme değilse geçer") sınırsız eşleşme olurdu.
  check("§1d ⭐ red KASITLI daldan geldi ('imza anahtarı çözülemedi'), çökmeden DEĞİL",
    /imza anahtarı çözülemedi/.test(gerekce1) && !/Cannot read|is not a function|undefined \(reading/i.test(gerekce1),
    gerekce1.replace(/^.*Access JWT reddedildi: /, "").slice(0, 120) || `(red gerekçesi yakalanamadı — toplanan uyarı: ${uyarilar.length})`);

  // ═══ §3 — AYRIM: §2b ile §1 AYNI cevabı vermiyor ══════════════════════════
  // Doktrinin tamamı bu farkta. İkisi aynı olsaydı ya "bayat döner" ya
  // "hiç dolmadıysa fail-closed" cümlesi YALAN olurdu — hangisi olduğunu da
  // tek tek bakan bir bekçi SÖYLEYEMEZDİ.
  console.log("\n── §3 Ayrım ──");
  check("§3 ⭐ BAYAT ≠ BOŞ: aynı token, aynı ağ kesintisi, FARKLI cevap",
    t2.sonuc === "gecti" && t3.sonuc === "reddedildi",
    `bayat=${t2.sonuc} · boş=${t3.sonuc}`);

  // ═══ §4 — ONARIM: ağ dönünce boş önbellek yeniden dolar ═══════════════════
  console.log("\n── §4 Onarım ──");
  agMod = "calisir";
  const t4 = await istek(handler, token);
  check("§4 fail-closed KALICI DEĞİL: ağ dönünce aynı token KABUL edilir", t4.sonuc === "gecti", t4.sonuc);
}

main()
  .catch((e) => { fail++; console.error(`  ✗ FAIL: sonda çöktü — ${e instanceof Error ? e.message : String(e)}`); })
  .finally(() => {
    globalThis.fetch = gercekFetch;
    console.warn = gercekWarn;
    resetAccessJwksCacheForTest();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===\n`);
    process.exit(fail > 0 ? 1 : 0);
  });
