// =============================================================================
// BEKÇİ — LİSANS PROTOKOLÜ: JWS/EdDSA · güven zinciri · İSTEK · parmak izi · gövde şemaları
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_protokol   (DB'SİZ)
//
// NE ÖLÇER: `src/lib/license/protocol/` sözleşmesi — satıcı sunucusu ve fabrika motoru
// bu klasörü DONMUŞ kontrat olarak kullanır; burada kırmızı, iki tarafın ayrışması demektir.
//   §0 klasör KAPALI (yalnız node:crypto + zod + kardeş dosya), değişken modül durumu yok,
//      src'de anahtar malzemesi yok, iki kipin çapası donuk ve geçerli, tanınmayan kip boş çapa (fail-closed)
//   §0' çapanın İKİ kipi: üretim listesi yalnız kok-*, hazırlık listesi yalnız hazirlik-* (ikisi de dolu,
//      ayrık) · hazırlık sınıfları ⊆ {TEST, DEMO} · derin donuk · hazırlık satırıyla ÜRETİM/DR/BAYI/
//      BARINDIRILAN HAK'ı ve ÜRETİM yetkili alt sertifika RED, TEST geçer · başka anahtar gerçek açık
//      yarıda RED · ÜRETİM'e genişletilmiş çapa RED · ⭐ hazırlık kökünün SAHİBİNİN HAK'ı/kirası üretim
//      çapasında KOK_BILINMIYOR, üretim kökünün sahibininki hazırlık çapasında KOK_BILINMIYOR
//   §0'' derlemenin çapası: kip derleme sabitinden (geliştirmede üretim), `trust-anchor.ts` ortamdan/dosyadan
//      OKUMAZ, sabitin ve kip listelerinin TEK okuyucusu (src taraması + ✓K sentetik sonda)
//   §1 JWS: geçerli · alg none · alg HS256 (anahtar karışması) · typ yanlış/eksik · kid
//      bilinmez · başlıkta gömülü anahtar/crit · gövde/imza kurcalı · kanonik olmayan
//      base64 · uzunluk tavanı · v:2 · süresi dolmuş · ±10 dk tolerans · indirme yolu
//   §2 zincir: alt sertifika imza anında geçerli (sonradan dolan kirayı öldürmez) ·
//      süresi geçmiş alt sertifika · yanlış kullanım · hazırlık kökü ÜRETİM imzalayamaz ·
//      bayi tavanı (modül/sınıf/kimlik) · boş çapa · kira↔HAK bağı · kira ömür tavanı
//   §3 İSTEK: tolerans · gövde özeti · amaç · anahtar · kurulum · typ karışması · nonce
//      defteri 20 dk penceresi · zarf
//   §4 parmak izi: eşik sınırları · ölçülemeyen uyuşmazlık sayılmaz · DR f5 · normalleştirme
//   §5 gövde şemaları: istek KATI (allowlist), yanıt GEVŞEK · etkinleştirme kodu
//   §7 P0 (D4 · D8 · D14): yalnız etkinleştirme/taşıma kimliksiz imzalanır (yok · "" · null),
//      taşınan kimlik hep bağlar · taşıma talebi kod taşımaz, yanıtı lisanssız · ortam bilgi
//      kimliği · yanıtta kurulumId/kodTuru · ISTEK_ZAMAN sunucuSaati (biçimsizse yok) ·
//      TASIMA_KODU_GEREKLI · saticiSapmaSn · 16 karakterlik kod üretimi + 12'lik tanınır
//
// NEGATİF SONDA — dosya DIŞI mutasyon zinciri (bir kezlik, ✓B; her biri cp + shasum ile
// birebir geri alındı; sayılar commit mesajında):
//   B1  jws.ts `alg` denetimi kaldırıldı                 → 2 ❌ (§1b none · §1c HS256)
//   B2  kökün sınıf yetkisi (HAK) kaldırıldı            → 1 ❌ (§2g hazırlık ÜRETİM)
//   B2b çapada hazırlık kökü sınırı kaldırıldı          → 1 ❌ (§2i)
//   B3  bayi modül tavanı kaldırıldı                    → 1 ❌ (§2q)
//   B4  nonce saklama "ilk görülüş + 15 dk"             → 2 ❌ (§3n 20 dk penceresi · §3o)
//   B5  parmak izi eşiği 3 → 2                          → 2 ❌ (§4c · §4e)
//   B6  protocol/ dosyasına `express` importu           → 1 ❌ (§0c kapalılık)
//   B7  çapadaki hazırlık kökü sınıflarına URETIM        → 6 ❌ (§0g · §0k · §0m · §0n · §0o · §0p)
//   B8  çapa satırı ve sınıf listesi iç freeze'siz       → 1 ❌ (§0l)
//   B9  çapa boşaltıldı (hazırlık döngüsü kör kalır)     → 2 ❌ (§0j körlük zemini · §0q)
//   G3 dilimi (sayılar commit mesajında): hazırlık kökü üretim listesine · trust-anchor.ts ortamdan okur ·
//   src'de ikinci kip okuyucusu · tanınmayan kip üretim listesine düşer.
//   P0 dilimi:
//   B10 İSTEK refine'ı devre dışı (kimliksiz yoklama)   → 3 ❌ (§7f · §7f2 · §7h)
//   B11 bağ yalnız sunucu kimliği varken                → 1 ❌ (§7c2)
//   B12 kimliksiz şemasından `null` kolu kaldırıldı     → 2 ❌ (§7g3 · §7i4)
//   B13 üretici 12 karakter üretir                      → 1 ❌ (§7p)
//   B14 önek tespiti yalnız "TKS ile başlar + uzun"     → 1 ❌ (§7r4)
//   B15 hata gövdesinde sunucuSaati `.catch`siz         → 1 ❌ (§7m2)
//   Her mutasyonun UYGULANDIĞI (sha farkı) ve geri alındığı (sha eşitliği) ayrıca ölçüldü.
// ⚠️ Gerekli mi (reçete md. 20): kapı doğduğu gün ağaçta ısırılacak bir kusur YOKTU (klasör
//   bu dilimde doğdu); gerekçe ÖLÇÜLMEDİ — satıcı/fabrika dilimleri buna karşı yazılacak.
// =============================================================================
import { createHmac, generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVATION_CODE_KINDS,
  ACTIVATION_CODE_LENGTH,
  ActivateRequestSchema,
  ActivationCodeSchema,
  EnvironmentSchema,
  TransferRequestSchema,
  TransferResponseSchema,
  VENDOR_ERROR_CODES,
  VendorErrorResponseSchema,
  bodyDigest,
  generateActivationCode,
  installationKeyId,
  OfflineRequestSchema,
  DAY_MS,
  PRODUCTION_ROOT_PUBLIC_KEYS,
  STAGING_ROOT_PUBLIC_KEYS,
  TRUST_ANCHOR_MODES,
  rootPublicKeysFor,
  LICENSE_CLASSES,
  STAGING_ROOT_CLASSES,
  LicenseResponseSchema,
  NonceLedger,
  CLOCK_SKEW_MS,
  TYP,
  PollRequestSchema,
  b64uEncode,
  normalizeActivationCode,
  normalizeFactor,
  prepareTrustAnchor,
  verifyEntitlement,
  verifyDownloadToken,
  signDownloadToken,
  isDownloadPathAllowed,
  verifyRequest,
  signRequest,
  readRequestIdentity,
  verifyJws,
  verifyLease,
  checkLeaseBinding,
  msToIso,
  generateNonce,
  compareFingerprints,
  digestFingerprint,
  openEnvelope,
  wrapEnvelope,
  type Fingerprint,
  type Result,
  type RootKey,
  type TrustAnchorMode,
} from "../src/lib/license/protocol";
import { signStateRecord } from "../src/lib/license/saat";
import { BUILD_ANCHOR_MODE, ROOT_PUBLIC_KEYS } from "../src/lib/license/trust-anchor";
import {
  HAM_PARMAK_IZI,
  anahtarUret,
  fiksturKur,
  hakBas,
  hakYuku,
  hamImzala,
  kiraBas,
  kiraYuku,
  sertifikaBas,
  sertifikaYuku,
  siniflar,
} from "./lib/lisans-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}
function kod<T>(s: Result<T>): string {
  return s.ok ? "OK" : s.code;
}
function beklenen<T>(label: string, s: Result<T>, k: string): void {
  check(label, kod(s) === k, `beklenen ${k}, gelen ${kod(s)}${s.ok ? "" : ` (${s.message})`}`);
}

const SIMDI = Date.parse("2026-10-01T09:00:00.000Z");
const f = fiksturKur(SIMDI);
const DAKIKA = 60 * 1000;

function kapalilik(): void {
  console.log("\n§0 — protokol klasörü KAPALI, anahtar malzemesi src'de YOK");
  const dizin = join(__dirname, "../src/lib/license/protocol");
  const dosyalar = readdirSync(dizin).filter((d) => d.endsWith(".ts"));
  check("§0a körlük zemini: protokol dosyaları okundu", dosyalar.length >= 9, `${dosyalar.length} dosya`);
  let importSayisi = 0;
  const ihlal: string[] = [];
  const degisken: string[] = [];
  for (const d of dosyalar) {
    const metin = readFileSync(join(dizin, d), "utf8");
    for (const m of metin.matchAll(/(?:from\s+|require\(\s*|import\(\s*)["']([^"']+)["']/g)) {
      importSayisi++;
      const hedef = m[1];
      if (hedef !== "node:crypto" && hedef !== "zod" && !/^\.\/[a-z-]+$/.test(hedef)) ihlal.push(`${d} → ${hedef}`);
    }
    if (/^(export\s+)?(let|var)\s/m.test(metin)) degisken.push(d);
  }
  check("§0b körlük zemini: import satırı sayıldı", importSayisi >= 15, `${importSayisi} import`);
  check("§0c ⭐ yalnız node:crypto + zod + kardeş dosya import edilir", ihlal.length === 0, ihlal.join(" · ") || "temiz");
  check("§0d modül düzeyinde değiştirilebilir durum (let/var) yok", degisken.length === 0, degisken.join(", ") || "temiz");
  const lisansDizini = join(__dirname, "../src/lib/license");
  const tum = [...readdirSync(lisansDizini).filter((d) => d.endsWith(".ts")).map((d) => join(lisansDizini, d)), ...dosyalar.map((d) => join(dizin, d))];
  const sir = tum.filter((p) => /-----BEGIN|PRIVATE KEY|"d"\s*:\s*"/.test(readFileSync(p, "utf8")));
  check("§0e src/lib/license altında anahtar malzemesi (PEM/JWK d) yok", sir.length === 0, sir.join(", ") || `${tum.length} dosya temiz`);
  for (const kip of TRUST_ANCHOR_MODES) {
    const capa = rootPublicKeysFor(kip);
    check(`§0f ${kip} güven çapası donuk (Object.isFrozen)`, Object.isFrozen(capa));
    check(`§0g ${kip} çapası dolu ve biçimce geçerli`, capa.length > 0 && prepareTrustAnchor(capa).ok, kod(prepareTrustAnchor(capa)));
  }
  beklenen("§0g' ⭐ tanınmayan kip BOŞ çapa: hiçbir HAK geçerli olamaz (fail-closed)", verifyEntitlement(hakBas(f), rootPublicKeysFor("test" as TrustAnchorMode)), "GUVEN_CAPASI_BOS");
  const typlar = Object.values(TYP);
  check("§0h belge türleri (typ) birbirinden farklı", new Set(typlar).size === typlar.length, typlar.join(", "));
}

/** `kid` satırının açık yarısını vekil anahtarınkiyle değiştirir: vekil, o kökün özel yarısını ELİNDE TUTAN taraftır. */
function vekilli(capa: readonly RootKey[], kid: string, x: string): RootKey[] {
  return capa.map((k) => (k.kid === kid ? { ...k, x } : k));
}

/**
 * Çapanın İKİ kipi. Özel yarı repoda olmadığından davranış sondası listenin gerçek kid + sınıf satırını kullanır,
 * yalnız açık yarısını fikstür anahtarıyla değiştirir (vekil = o kökün sahibi); gerçek açık yarının kullanıldığı
 * ayrıca ölçülür (§0o). Asıl soru §0s/§0t: kökün SAHİBİ öteki kipin derlemesine belge geçirebilir mi?
 */
function capaKipleri(): void {
  console.log("\n§0' — güven çapası İKİ kip: üretim listesi hazırlık kökü TAŞIMAZ, hazırlık listesi yalnız TEST/DEMO");
  const tum = [...PRODUCTION_ROOT_PUBLIC_KEYS, ...STAGING_ROOT_PUBLIC_KEYS];
  const kidler = tum.map((r) => r.kid);
  const bicimsiz = kidler.filter((k) => !/^(kok|hazirlik)-\d{4}-\d{1,3}$/.test(k));
  check("§0i iki listedeki her kid kok-/hazirlik-<yıl>-<n> biçiminde ve tekrarsız", bicimsiz.length === 0 && new Set(kidler).size === kidler.length, bicimsiz.join(", ") || kidler.join(", "));
  check(
    "§0j ⭐ üretim listesi YALNIZ kok-* (hazırlık kökü YOK) · hazırlık listesi YALNIZ hazirlik-* · körlük zemini: ikisi de dolu, hazırlıkta hazirlik-2026-1",
    PRODUCTION_ROOT_PUBLIC_KEYS.length > 0 &&
      STAGING_ROOT_PUBLIC_KEYS.some((r) => r.kid === "hazirlik-2026-1") &&
      PRODUCTION_ROOT_PUBLIC_KEYS.every((r) => r.kid.startsWith("kok-")) &&
      STAGING_ROOT_PUBLIC_KEYS.every((r) => r.kid.startsWith("hazirlik-")),
    `üretim ${PRODUCTION_ROOT_PUBLIC_KEYS.map((r) => r.kid).join(",")} · hazırlık ${STAGING_ROOT_PUBLIC_KEYS.map((r) => r.kid).join(",")}`,
  );
  const tasan = STAGING_ROOT_PUBLIC_KEYS.filter((r) => r.classes.length === 0 || r.classes.some((c) => !STAGING_ROOT_CLASSES.includes(c)));
  check("§0k ⭐ hazırlık köklerinin sınıfları ⊆ {TEST, DEMO} (ÜRETİM yok)", tasan.length === 0, tasan.map((r) => `${r.kid}: ${r.classes.join("+")}`).join(" · ") || "temiz");
  check("§0l iki liste DERİN donuk (her satır ve sınıf listesi)", tum.every((r) => Object.isFrozen(r) && Object.isFrozen(r.classes)));
  check("§0r iki liste AYRIK: ortak kid ya da açık anahtar yok", PRODUCTION_ROOT_PUBLIC_KEYS.every((p) => STAGING_ROOT_PUBLIC_KEYS.every((s) => s.kid !== p.kid && s.x !== p.x)));
  const yasakSiniflar = LICENSE_CLASSES.filter((c) => !STAGING_ROOT_CLASSES.includes(c));
  for (const r of STAGING_ROOT_PUBLIC_KEYS) {
    const vekil = anahtarUret(r.kid);
    const capa = vekilli(STAGING_ROOT_PUBLIC_KEYS, r.kid, vekil.x);
    const gecen = yasakSiniflar.filter((s) => kod(verifyEntitlement(hakBas(f, { sinif: s }, vekil), capa)) !== "KOK_SINIF_YETKISIZ");
    check(`§0m ⭐ ${r.kid} ${yasakSiniflar.join("/")} HAK'ı imzalayamaz (listenin kendi sınıf satırıyla)`, gecen.length === 0, gecen.join(", ") || `${yasakSiniflar.length} sınıf KOK_SINIF_YETKISIZ`);
    beklenen(`§0n ${r.kid} TEST HAK'ı imzalayabilir (karşı kontrol)`, verifyEntitlement(hakBas(f, { sinif: "TEST" }, vekil), capa), "OK");
    beklenen(`§0o ${r.kid} adına başka anahtarla basılmış HAK gerçek hazırlık listesinde RED (açık yarı gerçekten kullanılıyor)`, verifyEntitlement(hakBas(f, { sinif: "TEST" }, vekil), STAGING_ROOT_PUBLIC_KEYS), "JWS_IMZA");
    const altUretim = sertifikaBas(vekil, sertifikaYuku(f, f.alt, "ALT", { siniflar: siniflar("URETIM") }));
    beklenen(`§0p ${r.kid} ÜRETİM yetkili alt sertifika basamaz`, verifyLease(kiraBas(f, { altSertifika: altUretim }), capa), "KOK_SINIF_YETKISIZ");
    // Asıl tehdit: hazırlık kökünün özel yarısı sızdı. Sahibinin bastığı DEMO HAK'ı ve TEST kirası hazırlık çapasında
    // geçer (karşı kontrol) ama üretim çapasında kid HİÇ tanınmaz.
    const demo = hakBas(f, { sinif: "DEMO" }, vekil);
    const altTest = sertifikaBas(vekil, sertifikaYuku(f, f.alt, "ALT", { siniflar: siniflar("TEST", "DEMO") }));
    beklenen(`§0s karşı kontrol: ${r.kid} sahibinin DEMO HAK'ı hazırlık çapasında GEÇER`, verifyEntitlement(demo, capa), "OK");
    beklenen(`§0s ⭐ ${r.kid} sahibinin DEMO HAK'ı ÜRETİM çapasında RED (kök tanınmaz)`, verifyEntitlement(demo, PRODUCTION_ROOT_PUBLIC_KEYS), "KOK_BILINMIYOR");
    beklenen(`§0s ⭐ ${r.kid} sahibinin alt sertifikasıyla kira ÜRETİM çapasında RED`, verifyLease(kiraBas(f, { altSertifika: altTest }), PRODUCTION_ROOT_PUBLIC_KEYS), "KOK_BILINMIYOR");
  }
  for (const r of PRODUCTION_ROOT_PUBLIC_KEYS) {
    const vekil = anahtarUret(r.kid);
    const hak = hakBas(f, { sinif: "TEST" }, vekil);
    beklenen(`§0t karşı kontrol: ${r.kid} sahibinin HAK'ı üretim çapasında GEÇER`, verifyEntitlement(hak, vekilli(PRODUCTION_ROOT_PUBLIC_KEYS, r.kid, vekil.x)), "OK");
    beklenen(`§0t ⭐ ${r.kid} sahibinin HAK'ı HAZIRLIK çapasında RED (hazırlık derlemesi üretim belgesini tanımaz)`, verifyEntitlement(hak, STAGING_ROOT_PUBLIC_KEYS), "KOK_BILINMIYOR");
  }
  const genis = STAGING_ROOT_PUBLIC_KEYS.map((k) => ({ ...k, classes: [...k.classes, "URETIM" as const] }));
  beklenen("§0q ⭐ hazırlık listesindeki kök ÜRETİM'e genişletilirse çapa RED", prepareTrustAnchor(genis), "GUVEN_CAPASI_BICIM");
}

/** src altında çapa kipini seçen/okuyan yer: sabitin, kip listelerinin ve seçicilerin TEK sahibi. */
const KIP_SAHIPLERI: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/__TEKSERP_GUVEN_CAPASI__/, ["lib/license/trust-anchor.ts"]],
  [/\brootPublicKeysFor\(/, ["lib/license/trust-anchor.ts", "lib/license/protocol/kok-anahtarlar.ts"]],
  [/\bpackagePublicKeysFor\(/, ["lib/license/integrity.ts"]],
  [/\b(?:PRODUCTION|STAGING)_ROOT_PUBLIC_KEYS\b/, ["lib/license/protocol/kok-anahtarlar.ts"]],
  [/\b(?:PRODUCTION|STAGING)_PACKAGE_PUBLIC_KEYS\b/, ["lib/license/integrity.ts"]],
];

/** Göreli yol → içerik; kip okuyucusu sahibinin dışında geçerse ihlal satırı. */
export function kipOkuyuculari(dosyalar: Readonly<Record<string, string>>): string[] {
  const ihlal: string[] = [];
  for (const [yol, metin] of Object.entries(dosyalar)) {
    for (const [desen, sahipler] of KIP_SAHIPLERI) if (desen.test(metin) && !sahipler.includes(yol)) ihlal.push(`${yol} → ${desen.source}`);
  }
  return ihlal;
}

function srcDosyalari(kok: string, alt = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(join(kok, alt), { withFileTypes: true })) {
    const rel = alt ? `${alt}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, srcDosyalari(kok, rel));
    else if (e.name.endsWith(".ts")) out[rel] = readFileSync(join(kok, rel), "utf8");
  }
  return out;
}

function derlemeCapasi(): void {
  console.log("\n§0'' — derlemenin çapası: kip derleme sabitinden, ortamdan OKUNMAZ, tek okuyucu");
  check(
    "§0u geliştirmede (sabit tanımsız) derleme kipi üretim; ROOT_PUBLIC_KEYS = üretim listesi (hazırlık kökü yok)",
    BUILD_ANCHOR_MODE === "uretim" && ROOT_PUBLIC_KEYS === PRODUCTION_ROOT_PUBLIC_KEYS && !ROOT_PUBLIC_KEYS.some((r) => r.kid.startsWith("hazirlik-")),
  );
  const kaynak = readFileSync(join(__dirname, "../src/lib/license/trust-anchor.ts"), "utf8");
  const okuma = ["process.env", "readFileSync", "require(", "import(", "existsSync"].filter((d) => kaynak.includes(d));
  check("§0v ⭐ trust-anchor.ts kipi ortamdan ya da dosyadan OKUMAZ (yalnız derleme sabiti)", okuma.length === 0 && kaynak.includes("__TEKSERP_GUVEN_CAPASI__"), okuma.join(", ") || "temiz");
  const dosyalar = srcDosyalari(join(__dirname, "../src"));
  const ihlal = kipOkuyuculari(dosyalar);
  check("§0w ⭐ çapa kipinin TEK okuyucusu trust-anchor.ts; kip listelerini başka src dosyası seçmez", ihlal.length === 0 && Object.keys(dosyalar).length > 100, ihlal.join(" · ") || `${Object.keys(dosyalar).length} dosya`);
  const sentetik = kipOkuyuculari({ "services/x.ts": "verifyEntitlement(t, STAGING_ROOT_PUBLIC_KEYS)", "lib/y.ts": "const k = process.env.__TEKSERP_GUVEN_CAPASI__", "lib/z.ts": "ROOT_PUBLIC_KEYS" });
  check("§0x ✓K tarayıcı yabancı kip okuyucusunu yakalar (liste · sabit), derlemenin çapasını kullanan dosyada susar", sentetik.length === 2, sentetik.join(" · "));
}

function parca(nesne: unknown): string {
  return b64uEncode(JSON.stringify(nesne));
}

function jwsBolumu(): void {
  console.log("\n§1 — JWS compact + EdDSA");
  const hak = hakBas(f);
  beklenen("§1a geçerli HAK doğrulanır", verifyEntitlement(hak, f.kokler), "OK");
  const [b, y, s] = hak.split(".");
  beklenen("§1b ⭐ alg none RED", verifyEntitlement(`${parca({ alg: "none", typ: TYP.HAK, kid: f.kok.kid })}.${y}.`, f.kokler), "JWS_ALG");
  const hsBaslik = parca({ alg: "HS256", typ: TYP.HAK, kid: f.kok.kid });
  const hsImza = b64uEncode(createHmac("sha256", Buffer.from(f.kok.x, "base64url")).update(`${hsBaslik}.${y}`).digest());
  beklenen("§1c ⭐ alg HS256 (açık anahtar sır diye kullanılır) RED", verifyEntitlement(`${hsBaslik}.${y}.${hsImza}`, f.kokler), "JWS_ALG");
  beklenen("§1d typ yanlış (KİRA türü HAK diye) RED", verifyEntitlement(kiraBas(f), f.kokler), "JWS_TYP");
  const typsiz = `${parca({ alg: "EdDSA", kid: f.kok.kid })}.${y}.${s}`;
  beklenen("§1e typ eksik RED", verifyEntitlement(typsiz, f.kokler), "JWS_TYP");
  beklenen("§1f kid bilinmez (çapada yok) RED", verifyEntitlement(hakBas(f, {}, anahtarUret("kok-2099-9")), f.kokler), "KOK_BILINMIYOR");
  const jwkBaslik = `${parca({ alg: "EdDSA", typ: TYP.HAK, kid: f.kok.kid, jwk: { kty: "OKP" } })}.${y}.${s}`;
  beklenen("§1g başlıkta gömülü anahtar (jwk) RED", verifyEntitlement(jwkBaslik, f.kokler), "JWS_BASLIK");
  const critBaslik = `${parca({ alg: "EdDSA", typ: TYP.HAK, kid: f.kok.kid, crit: ["exp"] })}.${y}.${s}`;
  beklenen("§1h başlıkta crit RED", verifyEntitlement(critBaslik, f.kokler), "JWS_BASLIK");
  const kurcaliYuk = parca({ ...hakYuku(f), moduller: ["production.enabled", "finance.enabled", "iplik.enabled"] });
  beklenen("§1i ⭐ gövde kurcalı (modül eklendi) RED", verifyEntitlement(`${b}.${kurcaliYuk}.${s}`, f.kokler), "JWS_IMZA");
  const imza = Buffer.from(s, "base64url");
  imza[5] ^= 0x01;
  beklenen("§1j imza kurcalı (tek bit) RED", verifyEntitlement(`${b}.${y}.${b64uEncode(imza)}`, f.kokler), "JWS_IMZA");
  beklenen("§1k aynı kid başka anahtar RED", verifyEntitlement(hakBas(f, {}, anahtarUret(f.kok.kid)), f.kokler), "JWS_IMZA");
  beklenen("§1l kanonik olmayan base64 (dolgu) RED", verifyEntitlement(`${b}=.${y}.${s}`, f.kokler), "JWS_BICIM");
  beklenen("§1m uzunluk tavanı (33 KB) RED", verifyEntitlement(`${b}.${"A".repeat(33 * 1024)}.${s}`, f.kokler), "JWS_BICIM");
  beklenen("§1n dört parça RED", verifyEntitlement(`${hak}.x`, f.kokler), "JWS_BICIM");
  beklenen("§1o v:2 sürüm hatası olarak AYRI kodlanır", verifyEntitlement(hamImzala(TYP.HAK, f.kok, { ...hakYuku(f), v: 2 }), f.kokler), "BELGE_SURUM");
  const eksik: Record<string, unknown> = { ...hakYuku(f) };
  delete eksik.bakimBitis;
  beklenen("§1p şemaya uymayan (bakimBitis yok) RED", verifyEntitlement(hamImzala(TYP.HAK, f.kok, eksik), f.kokler), "BELGE_SEMA");
  let imzalamadi = false;
  try {
    hakBas(f, { lisansNo: "YANLIS" });
  } catch {
    imzalamadi = true;
  }
  check("§1q şemadan geçmeyen belge İMZALANMAZ (imzalayan fırlatır)", imzalamadi);
  const genel = verifyJws(hak, { typ: TYP.HAK, findKey: () => undefined });
  beklenen("§1r genel doğrulayıcıda bilinmeyen kid JWS_KID", genel, "JWS_KID");
}

function indirmeBolumu(): void {
  console.log("\n§1' — İNDİRME belirteci: süre, tolerans, ömür, yol");
  const anahtarlar = [{ kid: f.ind.kid, x: f.ind.x }];
  const bas = (expMs: number, simdiMs = SIMDI): string =>
    signDownloadToken({
      payload: { v: 1, kanal: "deneme-kanal", yolOneki: "/deneme-kanal/electron/", kurulumId: f.kurulumId, exp: msToIso(expMs) },
      key: f.ind,
      nowMs: simdiMs,
    });
  const gecerli = bas(SIMDI + 60 * DAKIKA);
  beklenen("§1s geçerli belirteç", verifyDownloadToken(gecerli, { keys: anahtarlar, nowMs: SIMDI }), "OK");
  const eski = bas(SIMDI - 30 * DAKIKA, SIMDI - 90 * DAKIKA);
  beklenen("§1t ⭐ süresi dolmuş (30 dk önce) RED", verifyDownloadToken(eski, { keys: anahtarlar, nowMs: SIMDI }), "BELGE_SURESI_DOLDU");
  const toleransli = bas(SIMDI - 9 * DAKIKA, SIMDI - 60 * DAKIKA);
  beklenen("§1u saat toleransı: 9 dk geçmiş kabul", verifyDownloadToken(toleransli, { keys: anahtarlar, nowMs: SIMDI }), "OK");
  const tolerans = bas(SIMDI - 11 * DAKIKA, SIMDI - 60 * DAKIKA);
  beklenen("§1v saat toleransı: 11 dk geçmiş RED", verifyDownloadToken(tolerans, { keys: anahtarlar, nowMs: SIMDI }), "BELGE_SURESI_DOLDU");
  const uzun = hamImzala(TYP.INDIRME, f.ind, { v: 1, kanal: "deneme-kanal", yolOneki: "/deneme-kanal/mobil/", kurulumId: f.kurulumId, exp: msToIso(SIMDI + 3 * 60 * DAKIKA) });
  beklenen("§1w ömür 70 dk'yı aşan belirteç RED", verifyDownloadToken(uzun, { keys: anahtarlar, nowMs: SIMDI }), "INDIRME_OMUR");
  beklenen("§1x başka anahtar (alt) imzalı belirteç RED", verifyDownloadToken(gecerli, { keys: [{ kid: f.ind.kid, x: f.alt.x }], nowMs: SIMDI }), "JWS_IMZA");
  const b = verifyDownloadToken(gecerli, { keys: anahtarlar, nowMs: SIMDI });
  if (b.ok) {
    check("§1y yol öneki altındaki dosya izinli", isDownloadPathAllowed(b.value, "/deneme-kanal/electron/latest.yml"));
    check("§1z ⭐ `..` kaçışı RED", !isDownloadPathAllowed(b.value, "/deneme-kanal/electron/../mobil/x.apk"));
    check("§1z2 kodlanmış kaçış (%2e%2e) RED", !isDownloadPathAllowed(b.value, "/deneme-kanal/electron/%2E%2E/x"));
    check("§1z3 başka kanal öneki RED", !isDownloadPathAllowed(b.value, "/baska-kanal/electron/latest.yml"));
    check("§1z4 önekin kendisi (dizin listesi) RED", !isDownloadPathAllowed(b.value, "/deneme-kanal/electron/"));
  } else check("§1y belirteç çözülemedi", false);
}

function zincirBolumu(): void {
  console.log("\n§2 — güven zinciri: kök → alt/indirme/bayi sertifikası");
  const kira = verifyLease(kiraBas(f), f.kokler);
  const hak = verifyEntitlement(hakBas(f), f.kokler);
  beklenen("§2a geçerli kira zinciri", kira, "OK");
  if (kira.ok && hak.ok) beklenen("§2b kira ↔ HAK bağı", checkLeaseBinding(kira.value, hak.value), "OK");
  const eskiAlt = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(SIMDI - 200 * DAY_MS), bitis: msToIso(SIMDI - 20 * DAY_MS) }));
  const eskiKira = kiraBas(f, { altSertifika: eskiAlt, verilis: msToIso(SIMDI - 25 * DAY_MS), bitis: msToIso(SIMDI + 5 * DAY_MS) });
  beklenen("§2c alt sertifika bugün dolmuş ama İMZA ANINDA geçerli → kira geçerli", verifyLease(eskiKira, f.kokler), "OK");
  const olu = kiraBas(f, { altSertifika: eskiAlt });
  beklenen("§2d ⭐ süresi geçmiş alt sertifikayla basılmış kira RED", verifyLease(olu, f.kokler), "SERTIFIKA_ZAMAN");
  const indSert = sertifikaBas(f.kok, sertifikaYuku(f, f.ind, "INDIRME"));
  beklenen("§2e yanlış kullanım (İNDİRME sertifikası kira imzalıyor) RED", verifyLease(kiraBas(f, { altSertifika: indSert }, f.ind), f.kokler), "SERTIFIKA_KULLANIM");
  const yabanciKok = anahtarUret("kok-2099-1");
  const yabanciAlt = sertifikaBas(yabanciKok, sertifikaYuku(f, f.alt, "ALT"));
  beklenen("§2f tanınmayan kökün sertifikası RED", verifyLease(kiraBas(f, { altSertifika: yabanciAlt }), f.kokler), "KOK_BILINMIYOR");
  beklenen("§2g ⭐ hazırlık kökü ÜRETİM HAK'ı imzalayamaz", verifyEntitlement(hakBas(f, {}, f.hazirlik), f.kokler), "KOK_SINIF_YETKISIZ");
  beklenen("§2h hazırlık kökü TEST HAK'ı imzalayabilir", verifyEntitlement(hakBas(f, { sinif: "TEST" }, f.hazirlik), f.kokler), "OK");
  const hazirlikUretim = [{ kid: f.hazirlik.kid, x: f.hazirlik.x, classes: siniflar("TEST", "URETIM") }];
  beklenen("§2i ⭐ ÜRETİM yetkili tanımlanmış hazırlık kökü çapada RED", prepareTrustAnchor(hazirlikUretim), "GUVEN_CAPASI_BICIM");
  const hazirlikAlt = sertifikaBas(f.hazirlik, sertifikaYuku(f, f.alt, "ALT", { siniflar: siniflar("URETIM") }));
  beklenen("§2j hazırlık kökü ÜRETİM yetkili alt sertifika basamaz", verifyLease(kiraBas(f, { altSertifika: hazirlikAlt }), f.kokler), "KOK_SINIF_YETKISIZ");
  const testAlt = sertifikaBas(f.hazirlik, sertifikaYuku(f, f.alt, "ALT", { siniflar: siniflar("TEST", "DEMO") }));
  const testKira = verifyLease(kiraBas(f, { altSertifika: testAlt }), f.kokler);
  if (testKira.ok && hak.ok) {
    beklenen("§2k ⭐ hazırlık alt anahtarı ÜRETİM HAK'ına kira veremez", checkLeaseBinding(testKira.value, hak.value), "KIRA_SINIF_YETKISIZ");
  } else check("§2k hazırlık kirası kurulamadı", false, kod(testKira));
  beklenen("§2l boş çapa: geçerli HAK bile RED", verifyEntitlement(hakBas(f), []), "GUVEN_CAPASI_BOS");
  const surumKira = verifyLease(kiraBas(f, { hakSurum: 2 }), f.kokler);
  if (surumKira.ok && hak.ok) beklenen("§2m kira HAK'ın başka sürümüne ait → RED", checkLeaseBinding(surumKira.value, hak.value), "KIRA_HAK_UYUSMAZ");
  const uzunKira = hamImzala(TYP.KIRA, f.alt, { ...kiraYuku(f), bitis: msToIso(SIMDI + 60 * DAY_MS) });
  beklenen("§2n kira ömrü 45 günü aşamaz", verifyLease(uzunKira, f.kokler), "BELGE_SEMA");
  const k3 = hamImzala(TYP.KIRA, f.alt, { ...kiraYuku(f), yaptirim: { kademe: "K3", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } });
  beklenen("§2o K3 kısıtlama tarihi taşımalı", verifyLease(k3, f.kokler), "BELGE_SEMA");
  bayiBolumu();
}

function bayiBolumu(): void {
  const tavan = { bayiId: f.musteriId, moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"] };
  const bayiSert = sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { siniflar: siniflar("URETIM", "DEMO"), bayi: tavan }));
  const bas = (ek: Parameters<typeof hakBas>[1], imzalayan = f.bayi): string =>
    hakBas(f, { bayiId: tavan.bayiId, bayiSertifikasi: bayiSert, ...ek }, imzalayan);
  beklenen("§2p bayi tavanı içindeki HAK geçerli", verifyEntitlement(bas({}), f.kokler), "OK");
  beklenen("§2q ⭐ bayi tavanı dışı modül RED", verifyEntitlement(bas({ moduller: ["production.enabled", "iplik.enabled"] }), f.kokler), "BAYI_TAVAN_MODUL");
  beklenen("§2r ⭐ bayi tavanı dışı sınıf RED", verifyEntitlement(bas({ sinif: "TEST" }), f.kokler), "BAYI_TAVAN_SINIF");
  beklenen("§2s başka bayi kimliği RED", verifyEntitlement(bas({ bayiId: f.tesisId }), f.kokler), "BAYI_KIMLIK");
  beklenen("§2t gömülü sertifikanın anahtarıyla imzalanmamış HAK RED", verifyEntitlement(bas({}, anahtarUret("bayi-b2")), f.kokler), "BAYI_KIMLIK");
  const altSert = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT"));
  beklenen("§2u bayi yerine ALT sertifikası gömülü HAK RED", verifyEntitlement(hakBas(f, { bayiId: tavan.bayiId, bayiSertifikasi: altSert }, f.alt), f.kokler), "BAYI_KIMLIK");
  beklenen("§2v kök imzalı HAK bayi sertifikası taşıyamaz", verifyEntitlement(hakBas(f, { bayiId: tavan.bayiId, bayiSertifikasi: bayiSert }), f.kokler), "BAYI_KIMLIK");
}

function istekBolumu(): void {
  console.log("\n§3 — İSTEK: kimlik, tazelik, gövde, tekrar");
  const govde = JSON.stringify({ v: 1, sonKiraId: null });
  const bas = (simdiMs: number, amac: "yokla" | "zil" = "yokla"): string =>
    signRequest({ installationId: f.kurulumId, purpose: amac, body: govde, key: { privateKey: f.kurulum.privateKey, nowMs: simdiMs } });
  const dogrula = (t: string, ek: Partial<Parameters<typeof verifyRequest>[1]> = {}): Result<unknown> =>
    verifyRequest(t, { publicKeyX: f.kurulum.x, body: govde, nowMs: SIMDI, purposes: ["yokla"], installationId: f.kurulumId, ...ek });
  beklenen("§3a geçerli istek", dogrula(bas(SIMDI)), "OK");
  beklenen("§3b istek 9 dk ileride — tolerans içinde", dogrula(bas(SIMDI + 9 * DAKIKA)), "OK");
  beklenen("§3c ⭐ istek 11 dk ileride RED", dogrula(bas(SIMDI + 11 * DAKIKA)), "ISTEK_ZAMAN");
  beklenen("§3d istek 11 dk geride RED", dogrula(bas(SIMDI - 11 * DAKIKA)), "ISTEK_ZAMAN");
  beklenen("§3e ⭐ gövde değişti RED", dogrula(bas(SIMDI), { body: `${govde} ` }), "ISTEK_GOVDE_OZETI");
  beklenen("§3f amaç uyuşmaz (zil yokla ucuna) RED", dogrula(bas(SIMDI, "zil")), "ISTEK_AMAC");
  beklenen("§3g başka kurulumun anahtarı RED", dogrula(bas(SIMDI), { publicKeyX: anahtarUret("kur-x").x }), "ISTEK_KID");
  beklenen("§3h anahtar başka kurulum kimliğine kayıtlı RED", dogrula(bas(SIMDI), { installationId: f.hakId }), "ISTEK_KURULUM");
  const durum = signStateRecord(
    { v: 1, kurulumId: f.kurulumId, kiraId: f.hakId, birikenMs: 0, yazildi: msToIso(SIMDI), yuksekSu: msToIso(SIMDI), sonKiraZorlamasi: null, sonYaptirim: null, sira: 0 },
    f.kurulum.privateKey,
    f.kurulum.x,
  );
  beklenen("§3i ⭐ aynı anahtarın imzaladığı durum kaydı istek yerine geçemez (typ)", dogrula(durum), "JWS_TYP");
  const kimlik = readRequestIdentity(bas(SIMDI));
  check("§3j imza doğrulanmadan kurulum kimliği okunur (anahtar araması için)", kimlik.ok && kimlik.value.installationId === f.kurulumId);
  const n = generateNonce();
  check("§3k nonce 128 bit base64url, tekrar etmez", /^[A-Za-z0-9_-]{22}$/.test(n) && n !== generateNonce(), n);
  const defter = new NonceLedger();
  const ileri = SIMDI + 10 * DAKIKA;
  check("§3l ilk görülüş kaydedilir", defter.record({ installationId: f.kurulumId, nonce: n, requestTimeMs: ileri, nowMs: SIMDI }));
  check("§3m tekrar RED", !defter.record({ installationId: f.kurulumId, nonce: n, requestTimeMs: ileri, nowMs: SIMDI + DAKIKA }));
  // 10 dk ileri damgalı istek 19 dk sonra hâlâ zaman denetiminden geçer: defter onu HATIRLAMALI.
  check("§3n ⭐ 20 dk penceresi: 19. dakikadaki tekrar da RED", !defter.record({ installationId: f.kurulumId, nonce: n, requestTimeMs: ileri, nowMs: SIMDI + 19 * DAKIKA }));
  defter.record({ installationId: f.kurulumId, nonce: generateNonce(), requestTimeMs: SIMDI + 30 * DAKIKA, nowMs: SIMDI + 30 * DAKIKA });
  check("§3o süresi geçen nonce budanır", defter.size === 1, `${defter.size} kayıt`);
  const zarf = openEnvelope(wrapEnvelope(bas(SIMDI), govde));
  check("§3p zarf gidiş-dönüş: istek + ham gövde korunur", zarf.ok && zarf.value.body.toString("utf8") === govde);
  beklenen("§3q bozuk zarf RED", openEnvelope("bozuk!"), "ZARF_BICIM");
}

function pi(ek: Partial<Fingerprint>): Fingerprint {
  return { ...f.parmakIzi, ...ek };
}

function parmakIziBolumu(): void {
  console.log("\n§4 — parmak izi: eşik, ölçülemeyen, normalleştirme");
  const baska = digestFingerprint({ f1: "11111111222233334444555566667777", f2: "8888aaaabbbbccccddddeeee00001234", f3: "BASKADISK99", f4: "MXL9921ZZQ", f5: "1234567" }, f.tuz);
  const k = (a: Fingerprint, b: Fingerprint, f5Haric = false): string => compareFingerprints(a, b, { excludeF5: f5Haric }).result;
  check("§4a 5/5 eşleşme", k(f.parmakIzi, f.parmakIzi) === "ESLESTI");
  check("§4b ⭐ 3/5 eşleşme (2 uyuşmaz) yeter", k(f.parmakIzi, pi({ f4: baska.f4, f5: baska.f5 })) === "ESLESTI");
  check("§4c ⭐ 2/5 eşleşme yetmez", k(f.parmakIzi, pi({ f3: baska.f3, f4: baska.f4, f5: baska.f5 })) === "ESLESMEDI");
  check("§4d ⭐ ölçülemeyen uyuşmazlık sayılmaz: 3 ölçülebilir, 3 eşleşme", k(f.parmakIzi, pi({ f2: null, f5: null })) === "ESLESTI");
  check("§4e 3 ölçülebilir, 2 eşleşme yetmez", k(f.parmakIzi, pi({ f2: null, f5: null, f4: baska.f4 })) === "ESLESMEDI");
  check("§4f 2 ölçülebilir, ikisi eşleşir → geçerli", k(f.parmakIzi, pi({ f2: null, f3: null, f5: null })) === "ESLESTI");
  check("§4g 2 ölçülebilir, biri uyuşmaz → geçersiz", k(f.parmakIzi, pi({ f2: null, f3: null, f5: null, f4: baska.f4 })) === "ESLESMEDI");
  check("§4h ⭐ tek ölçülebilir → ÖLÇÜLEMEDİ (üç sonuç, iki değil)", k(f.parmakIzi, { f1: f.parmakIzi.f1, f2: null, f3: null, f4: null, f5: null }) === "OLCULEMEDI");
  check("§4i DR: f5 dışarıda, f5 uyuşmazlığı sayılmaz", compareFingerprints(f.parmakIzi, pi({ f4: baska.f4, f5: baska.f5 }), { excludeF5: true }).matched === 3);
  const ayni = digestFingerprint({ ...HAM_PARMAK_IZI, f1: "6f1c2b9a0d3e4b579a113c5e7d9f0b24", f4: "pf3-k7q2a", f3: " s4evnx0n912345 " }, f.tuz);
  check("§4j normalleştirme: GUID süsü/seri ayırıcısı/boşluk aynı özeti verir", ayni.f1 === f.parmakIzi.f1 && ayni.f4 === f.parmakIzi.f4 && ayni.f3 === f.parmakIzi.f3);
  check(
    "§4k RAID birimi genel serisi (f3 `Volume1`) ve yer tutucu sistem serisi (f4) ölçülemedi sayılır",
    normalizeFactor("f3", "Volume1") === null && normalizeFactor("f3", "VOLUME0") === null &&
      normalizeFactor("f4", "System Serial Number") === null && normalizeFactor("f4", "Default string") === null,
  );
  check("§4k2 karşı: gerçek disk kimliği ve sistem serisi ölçülür", normalizeFactor("f3", "eui.0025388191B46B2E") !== null && normalizeFactor("f4", "PF3K7Q2A") === "pf3k7q2a");
  check("§4l yer tutucu SMBIOS değeri ölçülemedi sayılır", normalizeFactor("f2", "00000000-0000-0000-0000-000000000000") === null && normalizeFactor("f3", "To Be Filled By O.E.M.") === null);
  const tuzlu = digestFingerprint(HAM_PARMAK_IZI, Buffer.alloc(32, 9));
  check("§4m başka kurulum tuzu başka özet üretir (ham kimlik dışarı çıkmaz)", tuzlu.f1 !== f.parmakIzi.f1);
  const alan = digestFingerprint({ f1: "abcdef0123456789abcdef0123456789", f2: "abcdef0123456789abcdef0123456789" }, f.tuz);
  check("§4n aynı değer iki etkende farklı özet (alan ayrımı)", alan.f1 !== null && alan.f1 !== alan.f2);
  let kisa = false;
  try {
    digestFingerprint(HAM_PARMAK_IZI, Buffer.alloc(8));
  } catch {
    kisa = true;
  }
  check("§4o 16 bayttan kısa tuz reddedilir", kisa);
}

function yoklaGovdesi(): Record<string, unknown> {
  return {
    v: 1,
    sonKiraId: null,
    hak: null,
    parmakIzi: f.parmakIzi,
    durum: { gecerlilik: "GECERLI", nedenler: [], kip: "gozlem", hesaplananKademe: "NORMAL", uygulananKademe: "NORMAL" },
    saat: { duvar: msToIso(SIMDI), guvenilir: msToIso(SIMDI), bulgu: null },
    ortam: { platform: "win32", mimari: "x64", isletimSistemi: "Windows Server 2022", nodeSurum: "v24.18.0", uygulamaSurum: "2.11.2", derlemeTarihi: null, konteyner: false },
    saglik: {
      surum: "2.11.2",
      calismaSn: 3600,
      dbBoyutBayt: 1024,
      yedek: { hukum: "ok", yasSaat: 5 },
      offsite: { yapilandirildi: true, ok: true, eksikSayisi: 0 },
      diskDolulukYuzde: 40,
      auditYazmaHatasi: 0,
      havuzZamanAsimi: 0,
      istemciler: [{ tur: "tablet", surum: "1.3.2", adet: 4 }],
      isHatalari: [],
    },
    gozlem: { reddedilecekIstek: 0, reddedilecekModul: 0 },
  };
}

function govdeBolumu(): void {
  console.log("\n§5 — uç gövdeleri: istek KATI, yanıt GEVŞEK");
  check("§5a geçerli yoklama gövdesi", PollRequestSchema.safeParse(yoklaGovdesi()).success);
  const sizinti = yoklaGovdesi();
  const saglik = sizinti.saglik;
  if (typeof saglik === "object" && saglik !== null) Object.assign(saglik, { kullanicilar: ["ali"] });
  check("§5b ⭐ sağlık özetine allowlist dışı anahtar RED", !PollRequestSchema.safeParse(sizinti).success);
  check("§5c kök gövdeye allowlist dışı anahtar RED", !PollRequestSchema.safeParse({ ...yoklaGovdesi(), siparisler: [] }).success);
  const yanit = { v: 1, hak: null, kira: kiraBas(f), indirmeBelirtecleri: [], sunucuSaati: msToIso(SIMDI), yeniBilgi: 1 };
  check("§5d yanıtta tanınmayan bilgi alanı kabul (ileri uyum)", LicenseResponseSchema.safeParse(yanit).success);
  check("§5e çevrimdışı istek zarf taşır", OfflineRequestSchema.safeParse({ v: 1, zarf: "abc" }).success);
  check("§5f etkinleştirme kodu normalleştirme", normalizeActivationCode(" tks abcd efgh jkmn ") === "TKS-ABCD-EFGH-JKMN");
  check("§5g O→0 ve I/L→1 dönüşümü", normalizeActivationCode("TKS-OOOO-IIII-LLLL") === "TKS-0000-1111-1111");
}

function p0Bolumu(): void {
  console.log("\n§7 — P0: lisans kimliği portalda (D14) · taşıma kodu (D8) · saat kayması (D4) · 16 karakterlik kod");
  const govde = JSON.stringify({ v: 1, kod: "TKS-0000-0000-0000-0000" });
  const bas = (kimlik: string | null, amac: "etkinlestir" | "tasima" | "yokla" = "etkinlestir"): string =>
    signRequest({ installationId: kimlik, purpose: amac, body: govde, key: { privateKey: f.kurulum.privateKey, nowMs: SIMDI } });
  const dogrula = (t: string, kimlik: string | null, amac: "etkinlestir" | "tasima" | "yokla" = "etkinlestir"): Result<unknown> =>
    verifyRequest(t, { publicKeyX: f.kurulum.x, body: govde, nowMs: SIMDI, purposes: [amac], installationId: kimlik });
  beklenen("§7a ⭐ etkinleştirme isteği kurulum kimliği TAŞIMADAN imzalanır ve doğrulanır", dogrula(bas(null), null), "OK");
  beklenen("§7b kimliksiz etkinleştirme, satıcının koddan bulduğu kurulumla doğrulanır (bağ kodda)", dogrula(bas(null), f.kurulumId), "OK");
  beklenen("§7c ⭐ kimlik TAŞIYAN istek başka kurulumla doğrulanamaz (bağ sürer)", dogrula(bas(f.kurulumId), f.hakId), "ISTEK_KURULUM");
  beklenen("§7c2 kimlik TAŞIYAN istek kimliksiz (kod yolu) doğrulamada da RED — taşınan kimlik hep bağlar", dogrula(bas(f.kurulumId), null), "ISTEK_KURULUM");
  beklenen("§7d taşıma talebi de kimliksiz imzalanabilir (yeni makine kimliği bilmeyebilir)", dogrula(bas(null, "tasima"), null, "tasima"), "OK");
  const kimliksiz = readRequestIdentity(bas(null));
  check("§7e imzasız okuma kimliksiz istekte null döner", kimliksiz.ok && kimliksiz.value.installationId === null);
  const anahtar = { ...f.kurulum, kid: installationKeyId(f.kurulum.x) };
  const ham = (yuk: Record<string, unknown>): string => hamImzala(TYP.ISTEK, anahtar, { v: 1, zaman: msToIso(SIMDI), nonce: generateNonce(), govdeOzeti: bodyDigest(govde), ...yuk });
  beklenen("§7f ⭐ kimliksiz YOKLAMA RED (yalnız etkinleştirme/taşıma kimliksiz olabilir)", dogrula(ham({ amac: "yokla" }), null, "yokla"), "BELGE_SEMA");
  beklenen("§7f2 boş dizge kimlikli YOKLAMA da RED ('boş' = 'yok')", dogrula(ham({ amac: "yokla", kurulumId: "" }), null, "yokla"), "BELGE_SEMA");
  const bos = ham({ amac: "etkinlestir", kurulumId: "" });
  beklenen("§7g boş dizge kurulum kimliği 'yok' sayılır (etkinleştirme)", dogrula(bos, null), "OK");
  const bosKimlik = readRequestIdentity(bos);
  check("§7g2 boş dizge imzasız okumada da null", bosKimlik.ok && bosKimlik.value.installationId === null);
  const nullIstek = ham({ amac: "etkinlestir", kurulumId: null });
  beklenen("§7g3 null kurulum kimliği de 'yok' sayılır (etkinleştirme)", dogrula(nullIstek, null), "OK");
  const nullKimlik = readRequestIdentity(nullIstek);
  check("§7g4 null kimlik imzasız okumada null", nullKimlik.ok && nullKimlik.value.installationId === null);
  const sayiKimlik = readRequestIdentity(ham({ amac: "etkinlestir", kurulumId: 42 }));
  check("§7g5 dizge olmayan kimlik biçimsiz (BELGE_SEMA)", !sayiKimlik.ok && sayiKimlik.code === "BELGE_SEMA");
  let firlatti = false;
  try {
    bas(null, "yokla");
  } catch {
    firlatti = true;
  }
  check("§7h kimliksiz yoklama İMZALANMAZ (programcı hatası)", firlatti);
  const ortam = { platform: "win32", mimari: "x64", isletimSistemi: "Windows Server 2022", nodeSurum: "v24.18.0", uygulamaSurum: "2.11.2", derlemeTarihi: null, konteyner: false };
  const etkinGovde = { v: 1, kod: "TKS-ABCD-EFGH-JKMN-PQRS", acikAnahtar: f.kurulum.x, parmakIzi: f.parmakIzi, ortam };
  check("§7i etkinleştirme gövdesi kurulum kimliği olmadan geçer", ActivateRequestSchema.safeParse(etkinGovde).success);
  const bosGovde = ActivateRequestSchema.safeParse({ ...etkinGovde, kurulumId: "" });
  check("§7i2 boş kurulum kimliği 'yok'a iner", bosGovde.success && bosGovde.data.kurulumId === undefined);
  const nullGovde = ActivateRequestSchema.safeParse({ ...etkinGovde, kurulumId: null });
  check("§7i4 null kurulum kimliği de 'yok'a iner", nullGovde.success && nullGovde.data.kurulumId === undefined);
  check("§7i3 biçimsiz kurulum kimliği RED", !ActivateRequestSchema.safeParse({ ...etkinGovde, kurulumId: "abc" }).success);
  check("§7j taşıma talebi kod ve kimlik taşımadan geçer", TransferRequestSchema.safeParse({ v: 1, acikAnahtar: f.kurulum.x, parmakIzi: f.parmakIzi, ortam, gerekce: null }).success);
  check("§7j2 taşıma talebi kod TAŞIYAMAZ (katı gövde)", !TransferRequestSchema.safeParse({ v: 1, kod: "TKS-ABCD-EFGH-JKMN-PQRS", acikAnahtar: f.kurulum.x, parmakIzi: f.parmakIzi, ortam, gerekce: null }).success);
  check(
    "§7j3 taşıma yanıtı lisanssız (null) ve üç durumlu",
    ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"].every((durum) => TransferResponseSchema.safeParse({ v: 1, talepId: f.hakId, durum, lisans: null }).success),
  );
  check("§7k ortam.installationId bilgi alanı kabul, yokken de geçer", EnvironmentSchema.safeParse({ ...ortam, installationId: f.kurulumId }).success && EnvironmentSchema.safeParse(ortam).success);
  check("§7k2 biçimsiz ortam.installationId RED", !EnvironmentSchema.safeParse({ ...ortam, installationId: "fabrika-1" }).success);
  const yanit = { v: 1, hak: null, kira: kiraBas(f), indirmeBelirtecleri: [], sunucuSaati: msToIso(SIMDI) };
  const tamYanit = LicenseResponseSchema.safeParse({ ...yanit, kurulumId: f.kurulumId, kodTuru: "tasima" });
  check("§7l etkinleştirme yanıtı kurulum kimliğini ve kod türünü taşır", tamYanit.success && tamYanit.data.kurulumId === f.kurulumId && tamYanit.data.kodTuru === "tasima");
  const ileriTur = LicenseResponseSchema.safeParse({ ...yanit, kodTuru: "gelecek-tur" });
  check("§7l2 tanınmayan kod türü yanıtı düşürmez, yok sayılır (ileri uyum)", ileriTur.success && ileriTur.data.kodTuru === undefined);
  check("§7l3 biçimsiz yanıt kurulum kimliği RED (kimlik alanı gevşemez)", !LicenseResponseSchema.safeParse({ ...yanit, kurulumId: "abc" }).success);
  check("§7l4 kod türleri: ilk · tasima", ACTIVATION_CODE_KINDS.join(",") === "ilk,tasima");
  const hataGovdesi = (sunucuSaati: unknown) => ({ success: false, message: "istek zamanı sapıyor", details: { code: "ISTEK_ZAMAN", sunucuSaati } });
  const saatli = VendorErrorResponseSchema.safeParse(hataGovdesi(msToIso(SIMDI)));
  check("§7m ⭐ ISTEK_ZAMAN hatası details.sunucuSaati taşır ve okunur", saatli.success && saatli.data.details.sunucuSaati === msToIso(SIMDI));
  const bozukSaat = VendorErrorResponseSchema.safeParse(hataGovdesi("dün"));
  check("§7m2 biçimsiz sunucuSaati yok sayılır, hata kodu yine okunur", bozukSaat.success && bozukSaat.data.details.code === "ISTEK_ZAMAN" && bozukSaat.data.details.sunucuSaati === undefined);
  check("§7n satıcı kodu TASIMA_KODU_GEREKLI tanımlı", (VENDOR_ERROR_CODES as readonly string[]).includes("TASIMA_KODU_GEREKLI"));
  const saatliYokla = yoklaGovdesi();
  Object.assign(saatliYokla.saat as object, { saticiSapmaSn: -742 });
  check("§7o yoklama saat sapmasını (sn) taşıyabilir", PollRequestSchema.safeParse(saatliYokla).success);
  Object.assign(saatliYokla.saat as object, { saticiSapmaSn: 1.5 });
  check("§7o2 kesirli sapma RED (tam saniye)", !PollRequestSchema.safeParse(saatliYokla).success);
  const kodlar = Array.from({ length: 200 }, () => generateActivationCode());
  check(
    "§7p ⭐ üretilen kod 16 karakter (4 blok, Crockford) ve şemadan geçer",
    ACTIVATION_CODE_LENGTH === 16 && kodlar.every((k) => /^TKS(-[0-9A-HJKMNP-TV-Z]{4}){4}$/.test(k) && ActivationCodeSchema.safeParse(k).success),
    kodlar[0],
  );
  check("§7p2 200 üretimde tekrar yok", new Set(kodlar).size === kodlar.length);
  check("§7q ⭐ eski 12 karakterlik kod bir sürüm daha TANINIR", ActivationCodeSchema.safeParse("TKS-ABCD-EFGH-JKMN").success);
  check(
    "§7q2 8 ve 20 karakter, yabancı harf (U/I/L/O) RED",
    !ActivationCodeSchema.safeParse("TKS-ABCD-EFGH").success &&
      !ActivationCodeSchema.safeParse("TKS-ABCD-EFGH-JKMN-PQRS-TVWX").success &&
      !ActivationCodeSchema.safeParse("TKS-ABCD-EFGH-JKMN-PQRU").success,
  );
  check("§7r 16 karakterlik kod normalleşir (önek, boşluk, küçük harf)", normalizeActivationCode(" tks abcd efgh jkmn pqrs ") === "TKS-ABCD-EFGH-JKMN-PQRS");
  check("§7r2 öneksiz 16 karakter + O→0, I/L→1", normalizeActivationCode("oooo-iiii-llll-abcd") === "TKS-0000-1111-1111-ABCD");
  check("§7r3 öneksiz 12 karakter (eski biçim) de normalleşir", normalizeActivationCode("abcdefghjkmn") === "TKS-ABCD-EFGH-JKMN");
  check("§7r4 'TKS' ile BAŞLAYAN öneksiz 16 karakter önek sanılmaz", normalizeActivationCode("tksa-bcde-fghj-kmnp") === "TKS-TKSA-BCDE-FGHJ-KMNP");
  check("§7r5 ara uzunluk (13) normalleşmez, şemadan geçmez", !ActivationCodeSchema.safeParse(normalizeActivationCode("abcdefghjkmnp")).success);
}

function zamanTutarliligi(): void {
  check("§6a tolerans 10 dk, gün 24 sa", CLOCK_SKEW_MS === 10 * DAKIKA && DAY_MS === 24 * 60 * DAKIKA);
  const { privateKey } = generateKeyPairSync("ed448");
  let ed448 = false;
  try {
    hamImzala(TYP.HAK, { kid: f.kok.kid, privateKey, acik: privateKey, x: "" }, hakYuku(f));
  } catch {
    ed448 = true;
  }
  check("§6b Ed25519 dışı anahtarla imza atılmaz", ed448);
}

kapalilik();
capaKipleri();
derlemeCapasi();
jwsBolumu();
indirmeBolumu();
zincirBolumu();
istekBolumu();
parmakIziBolumu();
govdeBolumu();
p0Bolumu();
zamanTutarliligi();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
