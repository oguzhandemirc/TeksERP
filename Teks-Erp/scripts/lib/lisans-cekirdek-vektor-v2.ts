// Lisans v2 TEST VEKTÖRLERİ (L2-1) — `protokol-v2.json`. `test_` öneki yok → koşucu bunu bekçi saymaz.
// v1 dosyasından (`protokol.json`) AYRI: native çekirdek bu aileleri L2-2'de tüketmeye başlar; o güne dek
// `cargo test` v1 dosyasını okumaya devam eder ve main yeşil kalır (açık borç: iki dosya L2-2 sonrası tek
// dosyada birleşir, VEKTOR_BICIMI artar). Bugün tüketen tek yer `test_lisans_native_kahin` §2'' (bayatlık).
//
// Değerlendirme LicenseCore'dan DEĞİL doğrudan protokol işlevlerinden: v2 parametreleri (`nowMs`, iptal,
// parmak izi kuralı) çekirdek arayüzünde henüz yok (L2-2). Tür → TS işlevi:
//   hak2 → verifyEntitlement(token, roots, {nowMs, revocation})      · kira2 → verifyLease(token, roots, {revocation})
//   bag2 → verifyLease + verifyEntitlement + checkLeaseBinding        · iptal → verifyRevocation(token, roots)
//   iptalSec → pickNewerRevocation (seçilenin sırası)                 · iptalGuncel → isRevocationCurrent
//   parmakIziKarar → compareFingerprints(a, b, {excludeF5, rule})     · tanima → assessIdentification
//   ogrenme → canAutoLearnFingerprint                                  · ufukTavani → offlineHorizonCeilingDays
//   istek → verifyRequest (yalnız satıcı/patron kâhini; native istek doğrulamaz)
// İptal belgesi vektörde JWS metni olarak durur ve aynı çapayla doğrulanır. JSON'da sayı olmayan "şimdi"
// `nowMs: "NaN" | "Infinity"` dizgesiyle yazılır.
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  CLOCK_SKEW_MS,
  DAY_MS,
  TRUST_ANCHOR_MODES,
  TYP,
  assessIdentification,
  bodyDigest,
  canAutoLearnFingerprint,
  checkLeaseBinding,
  compareFingerprints,
  digestFingerprint,
  generateNonce,
  isRevocationCurrent,
  jwsDigest,
  msToIso,
  offlineHorizonCeilingDays,
  pickNewerRevocation,
  rootPublicKeysFor,
  signRequest,
  verifyEntitlement,
  verifyLease,
  verifyRequest,
  verifyRevocation,
  type EntitlementSignerKind,
  type Fingerprint,
  type FingerprintRule,
  type LicenseClass,
  type RequestPurpose,
  type Result,
  type RootKey,
  type TrustAnchorMode,
  type VerifiedRevocation,
} from "../../src/lib/license/protocol";
import { kipKokKidi } from "./lisans-vektor-kip";
import {
  anahtarUret,
  araHakBas,
  araSertifikasi,
  fiksturKur,
  hakBas,
  hakYuku,
  hamImzala,
  iptalBas,
  iptalYuku,
  kiraBas,
  kiraYuku,
  sertifikaBas,
  sertifikaYuku,
  type Fikstur,
} from "./lisans-fikstur";

export const VEKTOR_V2_BICIMI = 1;

export function vektorV2DosyasiYolu(teksKok: string): string {
  return path.join(teksKok, "native", "lisans-cekirdek", "test-vektorleri", "protokol-v2.json");
}

type SimdiDegeri = number | "NaN" | "Infinity";
interface Kipli {
  readonly kip?: TrustAnchorMode;
}

export type VektorV2 =
  | ({ readonly tur: "hak2"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] | null; readonly nowMs?: SimdiDegeri; readonly iptal?: string } & Kipli)
  | ({ readonly tur: "kira2"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] | null; readonly iptal?: string } & Kipli)
  | { readonly tur: "bag2"; readonly ad: string; readonly lease: unknown; readonly entitlement: unknown; readonly roots: RootKey[] }
  | ({ readonly tur: "iptal"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] | null } & Kipli)
  | { readonly tur: "iptalSec"; readonly ad: string; readonly mevcut: string | null; readonly gelen: string | null; readonly roots: RootKey[] }
  | { readonly tur: "iptalGuncel"; readonly ad: string; readonly lease: string; readonly iptal: string | null; readonly roots: RootKey[] }
  | { readonly tur: "parmakIziKarar"; readonly ad: string; readonly accepted: Fingerprint; readonly measured: Fingerprint; readonly excludeF5: boolean; readonly rule: FingerprintRule | null }
  | { readonly tur: "tanima"; readonly ad: string; readonly fingerprint: Fingerprint; readonly excludeF5: boolean }
  | { readonly tur: "ogrenme"; readonly ad: string; readonly accepted: Fingerprint; readonly measured: Fingerprint; readonly excludeF5: boolean }
  | { readonly tur: "ufukTavani"; readonly ad: string; readonly sinif: LicenseClass; readonly signer: EntitlementSignerKind }
  | {
      readonly tur: "istek";
      readonly ad: string;
      readonly token: string;
      readonly publicKeyX: string;
      readonly body: string;
      readonly nowMs: number;
      readonly purposes: RequestPurpose[];
      readonly installationId: string | null;
      readonly path: string | null;
    };

export interface VektorV2Kaydi {
  readonly vektor: VektorV2;
  readonly beklenen: unknown;
}

export interface VektorV2Dosyasi {
  readonly bicim: number;
  readonly not: string;
  readonly kayitlar: VektorV2Kaydi[];
}

// ── Değerlendirme ───────────────────────────────────────────────────────────────
function jsonKopya(x: unknown): unknown {
  return x === undefined ? null : JSON.parse(JSON.stringify(x));
}

function sonuc<T>(r: Result<T>, gorunum: (v: T) => unknown): unknown {
  return r.ok ? { ok: true, value: jsonKopya(gorunum(r.value)) } : { ok: false, code: r.code };
}

function capa(roots: RootKey[] | null, kip: TrustAnchorMode | undefined): readonly RootKey[] {
  if (roots) return roots;
  if (!kip) throw new Error("gömülü çapa vektörü kip taşımalı");
  return rootPublicKeysFor(kip);
}

function simdi(v: SimdiDegeri | undefined): number | undefined {
  if (v === "NaN") return Number.NaN;
  if (v === "Infinity") return Number.POSITIVE_INFINITY;
  return v;
}

/** İptal metni doğrulanamazsa vektör yanlış kurulmuştur (programcı hatası, fırlatır). */
function iptalCoz(token: string | null | undefined, roots: readonly RootKey[]): VerifiedRevocation | null {
  if (!token) return null;
  const r = verifyRevocation(token, roots);
  if (!r.ok) throw new Error(`vektör iptal belgesi doğrulanamadı: ${r.code}`);
  return r.value;
}

function belgeVektoru(v: VektorV2): unknown {
  switch (v.tur) {
    case "hak2": {
      const roots = capa(v.roots, v.kip);
      const nowMs = simdi(v.nowMs);
      const r = verifyEntitlement(v.token, roots, { revocation: iptalCoz(v.iptal, roots), ...(nowMs !== undefined ? { nowMs } : {}) });
      return sonuc(r, (h) => ({ document: h.document, signer: h.signer, digest: h.digest }));
    }
    case "kira2": {
      const roots = capa(v.roots, v.kip);
      const r = verifyLease(v.token, roots, { revocation: iptalCoz(v.iptal, roots) });
      return sonuc(r, (k) => ({ document: k.document, subCertificate: { document: k.subCertificate.document, rootKid: k.subCertificate.rootKid, allowedClasses: k.subCertificate.allowedClasses } }));
    }
    case "bag2": {
      const k = verifyLease(v.lease, v.roots);
      if (!k.ok) return { ok: false, code: k.code };
      const h = verifyEntitlement(v.entitlement, v.roots);
      if (!h.ok) return { ok: false, code: h.code };
      return sonuc(checkLeaseBinding(k.value, h.value), (x) => x);
    }
    case "iptal":
      return sonuc(verifyRevocation(v.token, capa(v.roots, v.kip)), (r) => r);
    default:
      return null;
  }
}

/** Vektörü TS kâhininde değerlendirir (beklenen sonuç bu çıktıdır). */
export function degerlendirV2(v: VektorV2): unknown {
  switch (v.tur) {
    case "hak2":
    case "kira2":
    case "bag2":
    case "iptal":
      return belgeVektoru(v);
    case "iptalSec": {
      const secilen = pickNewerRevocation(iptalCoz(v.mevcut, v.roots), iptalCoz(v.gelen, v.roots));
      return { sira: secilen?.document.sira ?? null, iptalId: secilen?.document.iptalId ?? null };
    }
    case "iptalGuncel": {
      const k = verifyLease(v.lease, v.roots);
      if (!k.ok) throw new Error(`vektör kirası doğrulanamadı: ${k.code}`);
      return { guncel: isRevocationCurrent(k.value.document, iptalCoz(v.iptal, v.roots)) };
    }
    case "parmakIziKarar":
      return jsonKopya(compareFingerprints(v.accepted, v.measured, { excludeF5: v.excludeF5, ...(v.rule ? { rule: v.rule } : {}) }));
    case "tanima":
      return jsonKopya(assessIdentification(v.fingerprint, { excludeF5: v.excludeF5 }));
    case "ogrenme":
      return { ogrenir: canAutoLearnFingerprint(v.accepted, v.measured, { excludeF5: v.excludeF5 }) };
    case "ufukTavani":
      return { gun: offlineHorizonCeilingDays(v.sinif, v.signer) };
    case "istek": {
      const r = verifyRequest(v.token, { publicKeyX: v.publicKeyX, body: v.body, nowMs: v.nowMs, purposes: v.purposes, installationId: v.installationId, ...(v.path ? { path: v.path } : {}) });
      return sonuc(r, (x) => x);
    }
  }
}

// ── Aileler ─────────────────────────────────────────────────────────────────────
function kiplereV2<T extends VektorV2 & Kipli>(v: T): T[] {
  return TRUST_ANCHOR_MODES.map((kip) => ({ ...v, ad: `${v.ad} [${kip}]`, kip }));
}

function araZinciri(f: Fikstur): VektorV2[] {
  const v = (ad: string, token: unknown, ek: { nowMs?: SimdiDegeri; iptal?: string } = {}): VektorV2 => ({ tur: "hak2", ad, token, roots: f.kokler, ...ek });
  const eski = araSertifikasi(f, { baslangic: msToIso(f.simdi - 300 * DAY_MS), bitis: msToIso(f.simdi - 180 * DAY_MS) });
  const altSert = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT"));
  const bayiSert = sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { bayi: { bayiId: f.musteriId, moduller: [] } }));
  return [
    v("ara: geçerli ÜRETİM", araHakBas(f)),
    v("ara: DR", araHakBas(f, { sinif: "DR" })),
    v("ara: sınıf dışı (DEMO/TEST sertifikası ÜRETİM imzalar)", araHakBas(f, {}, { sertifika: araSertifikasi(f, { siniflar: ["DEMO", "TEST"] }) })),
    v("ara: pencere dışı (sertifika imza anında dolmuş)", araHakBas(f, {}, { sertifika: eski })),
    v("ara: sertifika bugün dolmuş, HAK imza anında geçerliyken", araHakBas(f, { verilis: msToIso(f.simdi - 200 * DAY_MS) }, { sertifika: eski })),
    v("ara: HAK'ı gömülü sertifikanın anahtarı imzalamamış", araHakBas(f, {}, { imzalayan: anahtarUret("ara-2026-9") })),
    v("ara: kök imzalı HAK ara sertifikası taşıyamaz", hakBas(f, { imzaciSertifikasi: araSertifikasi(f) })),
    v("ara: ALT sertifikası gömülü (kullanım)", araHakBas(f, {}, { sertifika: altSert, imzalayan: f.alt })),
    v("ara: hem bayi hem ara sertifikası", hamImzala(TYP.HAK, f.ara, { ...hakYuku(f), bayiId: f.musteriId, bayiSertifikasi: bayiSert, imzaciSertifikasi: araSertifikasi(f) })),
    v("ara: sertifikayı tanınmayan kök imzalamış", araHakBas(f, {}, { sertifika: araSertifikasi(f, {}, anahtarUret("kok-2099-3")) })),
    v("ara: hazırlık kökü ÜRETİM yetkili ara sertifika basamaz", araHakBas(f, {}, { sertifika: araSertifikasi(f, { siniflar: ["URETIM"] }, f.hazirlik) })),
    v("ara: sertifikada kid öneki ara- değil", araHakBas(f, {}, { sertifika: hamImzala(TYP.SERTIFIKA, f.kok, { ...sertifikaYuku(f, f.bayi, "HAK") }), imzalayan: f.bayi })),
    v("ara: imzaciSertifikasi metin değil (kök yolu dışı → tanınmayan imzacı)", hamImzala(TYP.HAK, f.ara, { ...hakYuku(f), imzaciSertifikasi: 7 })),
    { tur: "kira2", ad: "ara: HAK sertifikası kira imzalayamaz", token: kiraBas(f, { altSertifika: araSertifikasi(f) }, f.ara), roots: f.kokler },
    ...kiplereV2<VektorV2 & Kipli>({ tur: "hak2", ad: "ara: gömülü çapa, ara sertifikanın kökü üretim kid'li yabancı anahtar", token: araHakBas(f, {}, { sertifika: araSertifikasi(f, {}, anahtarUret(kipKokKidi("uretim"))) }), roots: null }),
  ];
}

function ufukVektorleri(f: Fikstur): VektorV2[] {
  const v = (ad: string, token: unknown): VektorV2 => ({ tur: "hak2", ad, token, roots: f.kokler });
  const tavan = { bayiId: f.musteriId, moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"] };
  const bayiSert = sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { siniflar: ["URETIM"], bayi: tavan }));
  const bayi = (ufuk: number | null) => hakBas(f, { bayiId: tavan.bayiId, bayiSertifikasi: bayiSert, cevrimdisiUfukGun: ufuk }, f.bayi);
  const tablo: VektorV2[] = (["URETIM", "DR", "DEMO", "TEST", "BAYI", "BARINDIRILAN"] as const).flatMap((sinif) =>
    (["KOK", "BAYI", "ARA"] as const).map((signer): VektorV2 => ({ tur: "ufukTavani", ad: `ufuk tavanı ${sinif}/${signer}`, sinif, signer })),
  );
  return [
    ...tablo,
    v("ufuk: kök ÜRETİM süresiz", hakBas(f, { cevrimdisiUfukGun: null })),
    v("ufuk: kök ÜRETİM 3650 + kip alt sınırı (alanlar korunur)", hakBas(f, { cevrimdisiUfukGun: 3650, kipAltSiniri: "zorla" })),
    v("ufuk: ara ÜRETİM süresiz (K2)", araHakBas(f, { cevrimdisiUfukGun: null })),
    v("ufuk: ara DEMO 45 (sınır)", araHakBas(f, { sinif: "DEMO", cevrimdisiUfukGun: 45 })),
    v("ufuk: ara DEMO 46", araHakBas(f, { sinif: "DEMO", cevrimdisiUfukGun: 46 })),
    v("ufuk: ara TEST süresiz", araHakBas(f, { sinif: "TEST", cevrimdisiUfukGun: null })),
    v("ufuk: kök DEMO 46 (sınıf kısıtı her imzacıda)", hakBas(f, { sinif: "DEMO", cevrimdisiUfukGun: 46 })),
    v("ufuk: kök BARINDIRILAN 401", hakBas(f, { sinif: "BARINDIRILAN", cevrimdisiUfukGun: 401 })),
    v("ufuk: bayi ÜRETİM 400 (sınır)", bayi(400)),
    v("ufuk: bayi ÜRETİM 401", bayi(401)),
    v("ufuk: bayi ÜRETİM süresiz", bayi(null)),
    v("ufuk: 0 (şema)", hamImzala(TYP.HAK, f.kok, { ...hakYuku(f), cevrimdisiUfukGun: 0 })),
    v("ufuk: 3651 (şema)", hamImzala(TYP.HAK, f.kok, { ...hakYuku(f), cevrimdisiUfukGun: 3651 })),
    v("ufuk: kesirli (şema)", hamImzala(TYP.HAK, f.kok, { ...hakYuku(f), cevrimdisiUfukGun: 1.5 })),
    v("kip alt sınırı gozlem (şema)", hamImzala(TYP.HAK, f.kok, { ...hakYuku(f), kipAltSiniri: "gozlem" })),
  ];
}

function verilisVektorleri(f: Fikstur): VektorV2[] {
  const v = (ad: string, token: unknown, nowMs?: SimdiDegeri): VektorV2 => ({ tur: "hak2", ad, token, roots: f.kokler, ...(nowMs !== undefined ? { nowMs } : {}) });
  return [
    v("veriliş: şimdi + tolerans (sınır)", hakBas(f, { verilis: msToIso(f.simdi + CLOCK_SKEW_MS) }), f.simdi),
    v("veriliş: şimdi + tolerans + 1 ms", hakBas(f, { verilis: msToIso(f.simdi + CLOCK_SKEW_MS + 1) }), f.simdi),
    v("veriliş: ara yolunda ileri tarih", araHakBas(f, { verilis: msToIso(f.simdi + 30 * DAY_MS) }), f.simdi),
    v("veriliş: şimdi NaN", hakBas(f), "NaN"),
    v("veriliş: şimdi +∞", hakBas(f), "Infinity"),
    v("veriliş: şimdi verilmez (eski çağrı) ileri tarih geçer", hakBas(f, { verilis: msToIso(f.simdi + 30 * DAY_MS) })),
  ];
}

function iptalSatiri(kid: string, sertifikaId: string, kullanim: "ALT" | "BAYI" | "HAK" | "INDIRME") {
  return { kid, sertifikaId, kullanim, tarih: "2026-09-28T00:00:00.000Z", neden: "VDS ele geçti" };
}

function iptalVektorleri(f: Fikstur): VektorV2[] {
  const sert = araSertifikasi(f, { sertifikaId: f.tesisId });
  const hak = araHakBas(f, {}, { sertifika: sert });
  const iptal = (sira: number, satirlar: ReturnType<typeof iptalSatiri>[]) => iptalBas(f.kok, iptalYuku(f, { sira, iptaller: satirlar }));
  const araIptal = iptal(1, [iptalSatiri(f.ara.kid, f.tesisId, "HAK")]);
  const kidIptal = iptal(2, [iptalSatiri(f.ara.kid, f.hakId, "HAK")]);
  const satir = iptalSatiri(f.ara.kid, f.hakId, "HAK");
  const ham = (ad: string, ek: Record<string, unknown>): VektorV2 => ({ tur: "iptal", ad: `iptal şema: ${ad}`, token: hamImzala(TYP.IPTAL, f.kok, { ...iptalYuku(f), ...ek }), roots: f.kokler });
  const tavan = { bayiId: f.musteriId, moduller: ["production.enabled"] };
  const bayiHak = hakBas(f, { bayiId: tavan.bayiId, bayiSertifikasi: sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { bayi: tavan })), moduller: ["production.enabled"] }, f.bayi);
  return [
    { tur: "iptal", ad: "iptal: geçerli (boş liste, sıra 1)", token: iptalBas(f.kok, iptalYuku(f)), roots: f.kokler },
    { tur: "iptal", ad: "iptal: geçerli (dört kullanım)", token: iptal(3, [satir, iptalSatiri(f.alt.kid, randomUUID(), "ALT"), iptalSatiri(f.ind.kid, randomUUID(), "INDIRME"), iptalSatiri(f.bayi.kid, randomUUID(), "BAYI")]), roots: f.kokler },
    { tur: "iptal", ad: "iptal: ara imzacı imzalamış (kök değil)", token: iptalBas(f.ara, iptalYuku(f)), roots: f.kokler },
    { tur: "iptal", ad: "iptal: kök kid'i başka anahtar (imza)", token: iptalBas(anahtarUret(f.kok.kid), iptalYuku(f)), roots: f.kokler },
    { tur: "iptal", ad: "iptal: sertifika belgesi iptal yerine (typ)", token: sert, roots: f.kokler },
    ham("sıra 0", { sira: 0 }),
    ham("tekrarlı sertifika", { iptaller: [satir, satir] }),
    ham("kid öneki kullanımla uyuşmuyor", { iptaller: [{ ...satir, kid: "alt-2026-1" }] }),
    ham("neden 201", { iptaller: [{ ...satir, neden: "x".repeat(201) }] }),
    ham("kullanım tanınmayan", { iptaller: [{ ...satir, kullanim: "KOK" }] }),
    ham("v:2", { v: 2 }),
    ...kiplereV2<VektorV2 & Kipli>({ tur: "iptal", ad: "iptal: gömülü çapa, üretim kök kid'i yabancı anahtar", token: iptalBas(anahtarUret(kipKokKidi("uretim")), iptalYuku(f)), roots: null }),
    { tur: "hak2", ad: "iptal: iptalsiz ara HAK (karşı)", token: hak, roots: f.kokler },
    { tur: "hak2", ad: "iptal: ara sertifikası kimliğiyle iptal", token: hak, roots: f.kokler, iptal: araIptal },
    { tur: "hak2", ad: "iptal: anahtar (kid+kullanım) iptali", token: hak, roots: f.kokler, iptal: kidIptal },
    { tur: "hak2", ad: "iptal: başka anahtarın iptali etkilemez", token: hak, roots: f.kokler, iptal: iptal(1, [iptalSatiri("ara-2026-9", f.hakId, "HAK")]) },
    { tur: "hak2", ad: "iptal: geri tarihli HAK iptali atlatamaz", token: araHakBas(f, { verilis: msToIso(f.simdi - 5 * DAY_MS) }, { sertifika: sert }), roots: f.kokler, iptal: araIptal },
    { tur: "hak2", ad: "iptal: bayi anahtarı iptali", token: bayiHak, roots: f.kokler, iptal: iptal(1, [iptalSatiri(f.bayi.kid, f.hakId, "BAYI")]) },
    { tur: "hak2", ad: "iptal: kök imzalı HAK etkilenmez", token: hakBas(f), roots: f.kokler, iptal: kidIptal },
    { tur: "kira2", ad: "iptal: ALT anahtarı iptali", token: kiraBas(f), roots: f.kokler, iptal: iptal(1, [iptalSatiri(f.alt.kid, f.hakId, "ALT")]) },
    { tur: "kira2", ad: "iptal: iptalsiz kira (karşı)", token: kiraBas(f), roots: f.kokler, iptal: araIptal },
    { tur: "iptalSec", ad: "iptal sırası: yüksek kazanır", mevcut: araIptal, gelen: kidIptal, roots: f.kokler },
    { tur: "iptalSec", ad: "iptal sırası: düşük yok sayılır", mevcut: kidIptal, gelen: araIptal, roots: f.kokler },
    { tur: "iptalSec", ad: "iptal sırası: eşit sıra mevcut kalır", mevcut: araIptal, gelen: iptal(1, []), roots: f.kokler },
    { tur: "iptalSec", ad: "iptal sırası: mevcut yok", mevcut: null, gelen: araIptal, roots: f.kokler },
    { tur: "iptalGuncel", ad: "kira iptal sırası 2, elde 1", lease: kiraBas(f, { iptalSira: 2 }), iptal: araIptal, roots: f.kokler },
    { tur: "iptalGuncel", ad: "kira iptal sırası 2, elde 2", lease: kiraBas(f, { iptalSira: 2 }), iptal: kidIptal, roots: f.kokler },
    { tur: "iptalGuncel", ad: "kira iptal sırası 1, elde yok", lease: kiraBas(f, { iptalSira: 1 }), iptal: null, roots: f.kokler },
    { tur: "iptalGuncel", ad: "kira iptal sırası beyan etmez", lease: kiraBas(f), iptal: null, roots: f.kokler },
  ];
}

function kiraAlanlari(f: Fikstur): VektorV2[] {
  const v = (ad: string, token: unknown): VektorV2 => ({ tur: "kira2", ad, token, roots: f.kokler });
  const ham = (ek: Record<string, unknown>) => hamImzala(TYP.KIRA, f.alt, { ...kiraYuku(f), ...ek });
  const k3 = { kademe: "K3", mesaj: null, kisitlamaTarihi: msToIso(f.simdi + 30 * DAY_MS), donmusModuller: [], guncellemeDonuk: false };
  const gercek = hakBas(f);
  const sahte = hakBas(f, { moduller: ["production.enabled", "finance.enabled", "ticaret.enabled", "iplik.enabled"] });
  const bag = (ad: string, lease: string, entitlement: string): VektorV2 => ({ tur: "bag2", ad, lease, entitlement, roots: f.kokler });
  return [
    v("kira: v2 alanları korunur", kiraBas(f, { odenmisTarih: msToIso(f.simdi + 200 * DAY_MS), parmakIziKurali: "standart", hakOzeti: jwsDigest(gercek), iptalSira: 4 })),
    v("kira: ödenmiş tarih null (süresiz), zayıf kural", ham({ odenmisTarih: null, parmakIziKurali: "zayif" })),
    v("kira: ödenmiş tarih saatsiz", ham({ odenmisTarih: "2027-01-01" })),
    v("kira: parmak izi kuralı tanınmayan", ham({ parmakIziKurali: "gevsek" })),
    v("kira: kapanış K3 ile", ham({ kapanis: "KOPYA", yaptirim: k3 })),
    v("kira: kapanış K3'süz", ham({ kapanis: "TASIMA" })),
    v("kira: kapanış nedeni tanınmayan", ham({ kapanis: "SATIS", yaptirim: k3 })),
    v("kira: iptal sırası 0", ham({ iptalSira: 0 })),
    v("kira: HAK özeti biçimsiz", ham({ hakOzeti: "kisa" })),
    bag("bağ: HAK bayt özetiyle gerçek HAK", kiraBas(f, { hakOzeti: jwsDigest(gercek) }), gercek),
    bag("bağ: aynı kimlik + sürümle başka HAK", kiraBas(f, { hakOzeti: jwsDigest(gercek) }), sahte),
    bag("bağ: bayt özeti taşımayan (eski) kira", kiraBas(f), sahte),
    bag("bağ: ara imzalı HAK'a bayt bağı", kiraBas(f, { hakOzeti: jwsDigest(araHakBas(f)) }), araHakBas(f)),
  ];
}

function parmakIziVektorleri(f: Fikstur): VektorV2[] {
  const b = digestFingerprint({ f1: "11111111222233334444555566667777", f2: "8888aaaabbbbccccddddeeee00001234", f3: "BASKADISK99", f4: "MXL9921ZZQ", f5: "1234567" }, f.tuz);
  const a = f.parmakIzi;
  const hic: Fingerprint = { f1: null, f2: null, f3: null, f4: null, f5: null };
  const m = (ek: Partial<Fingerprint>): Fingerprint => ({ ...a, ...ek });
  const k = (ad: string, measured: Fingerprint, rule: FingerprintRule | null, g: { excludeF5?: boolean; accepted?: Fingerprint } = {}): VektorV2 => ({
    tur: "parmakIziKarar", ad, accepted: g.accepted ?? a, measured, excludeF5: g.excludeF5 ?? false, rule,
  });
  const zayifKabul: Fingerprint = { ...hic, f1: a.f1, f5: a.f5 };
  const kararlar = [
    k("v1: 5/5", a, null),
    k("v1: kopya (f3+f4 farklı) 3/5 geçer", m({ f3: b.f3, f4: b.f4 }), null),
    k("v1: ölçülemeyen sayılmaz (f3+f4 yok)", m({ f3: null, f4: null }), null),
    k("v1: hiç ölçülemedi", hic, null),
    k("standart: 5/5", a, "standart"),
    k("standart: güçlü şartı (f1+f2+f5 tutar, f3+f4 tutmaz) RED", m({ f3: b.f3, f4: b.f4 }), "standart"),
    k("standart: f1+f5 değişti, güçlüler tutar", m({ f1: b.f1, f5: b.f5 }), "standart"),
    k("standart: tek kayıp etken, eşik tutar", m({ f4: null }), "standart"),
    k("standart: iki güçlü kayıp RED", m({ f3: null, f4: null }), "standart"),
    k("standart: hiçbir etken okunamıyor", hic, "standart"),
    k("standart: kabul kümesinde olmayan etken karşılaştırılmaz", a, "standart", { accepted: { ...a, f5: null } }),
    k("standart DR: f5 hariç", m({ f5: b.f5 }), "standart", { excludeF5: true }),
    k("standart DR: iki güçlü + f1 farklı RED", m({ f1: b.f1, f4: b.f4 }), "standart", { excludeF5: true }),
    k("zayıf: iki etkenli küme, ikisi tutar", a, "zayif", { accepted: zayifKabul }),
    k("zayıf: kayıp uyuşmazlıktır", m({ f5: null }), "zayif", { accepted: zayifKabul }),
    k("zayıf: boş kabul kümesi ÖLÇÜLEMEDİ", a, "zayif", { accepted: hic }),
    k("zayıf: beş etkenli kümede 2 tutar RED", m({ f2: b.f2, f3: b.f3, f4: b.f4 }), "zayif"),
    k("zayıf: beş etkenli kümede 3 tutar", m({ f3: b.f3, f4: b.f4 }), "zayif"),
    k("zayıf DR: f5 hariç tek etken", a, "zayif", { accepted: zayifKabul, excludeF5: true }),
  ];
  const t = (ad: string, fingerprint: Fingerprint, excludeF5 = false): VektorV2 => ({ tur: "tanima", ad, fingerprint, excludeF5 });
  const o = (ad: string, measured: Fingerprint, excludeF5 = false): VektorV2 => ({ tur: "ogrenme", ad, accepted: a, measured, excludeF5 });
  return [
    ...kararlar,
    t("tanıma: beş okunabilir", a),
    t("tanıma: güçlü okunabilen 1 (f1+f4+f5)", m({ f2: null, f3: null })),
    t("tanıma: okunabilen 2 (f2+f3)", { ...hic, f2: a.f2, f3: a.f3 }),
    t("tanıma: üç güçlü (sınır)", { ...hic, f2: a.f2, f3: a.f3, f4: a.f4 }),
    t("tanıma DR: f1+f2+f5 zayıf", { ...hic, f1: a.f1, f2: a.f2, f5: a.f5 }, true),
    t("tanıma: hiçbiri", hic),
    o("öğrenme: f1+f5 değişti", m({ f1: b.f1, f5: b.f5 })),
    o("öğrenme: f3+f4 değişti", m({ f3: b.f3, f4: b.f4 })),
    o("öğrenme: f2 kayıp, f3+f4 tutar", m({ f2: null })),
    o("öğrenme DR: f5 hariç", m({ f5: b.f5, f1: b.f1 }), true),
  ];
}

function istekVektorleri(f: Fikstur): VektorV2[] {
  const govde = JSON.stringify({ v: 1, parmakIzi: f.parmakIzi, kayip: ["f4"], gerekce: null });
  const bas = (amac: RequestPurpose, yol?: string) =>
    signRequest({ installationId: f.kurulumId, purpose: amac, body: govde, key: { privateKey: f.kurulum.privateKey, nowMs: f.simdi, nonce: generateNonce() }, ...(yol ? { path: yol } : {}) });
  const v = (ad: string, token: string, g: { purposes?: RequestPurpose[]; path?: string | null } = {}): VektorV2 => ({
    tur: "istek", ad, token, publicKeyX: f.kurulum.x, body: govde, nowMs: f.simdi, purposes: g.purposes ?? ["yokla"], installationId: f.kurulumId, path: g.path ?? null,
  });
  const ham = (yuk: Record<string, unknown>) => hamImzala(TYP.ISTEK, f.kurulum, { v: 1, kurulumId: f.kurulumId, zaman: msToIso(f.simdi), nonce: generateNonce(), amac: "yokla", govdeOzeti: bodyDigest(govde), ...yuk });
  return [
    v("istek: yol kendi ucunda", bas("yokla", "/v1/yokla"), { path: "/v1/yokla" }),
    v("istek: yol başka uca", bas("yokla", "/v1/yokla"), { path: "/v1/destek" }),
    v("istek: eski doğrulayıcı yolu denetlemez", bas("yokla", "/v1/yokla")),
    v("istek: yolsuz (eski) istek yeni doğrulayıcıda", bas("yokla"), { path: "/v1/yokla" }),
    v("istek: zarfla taşınan (yol /v1/cevrimdisi)", bas("yokla", "/v1/cevrimdisi"), { path: "/v1/cevrimdisi", purposes: ["yokla", "cevrimdisi"] }),
    v("istek: biçimsiz yol (sorgu dizgeli)", ham({ yol: "/v1/yokla?x=1" }), { path: "/v1/yokla" }),
    v("istek: patron iki parçalı yol", ham({ amac: "esitle", yol: "/v1/gelen-kutusu/al" }), { path: "/v1/gelen-kutusu/al", purposes: ["esitle"] }),
    v("istek: donanım amacı kendi ucunda", bas("donanim", "/v1/donanim"), { path: "/v1/donanim", purposes: ["donanim"] }),
    v("istek: donanım amacı yoklama ucunda", bas("donanim"), { purposes: ["yokla"] }),
    v("istek: kimliksiz donanım", ham({ amac: "donanim", kurulumId: "" }), { purposes: ["donanim"] }),
  ];
}

/** Verilen "şimdi" ile taze anahtarlı TAM v2 vektör listesi. */
export function vektorleriKurV2(simdiMs: number): VektorV2[] {
  const f = fiksturKur(simdiMs);
  return [...araZinciri(f), ...ufukVektorleri(f), ...verilisVektorleri(f), ...iptalVektorleri(f), ...kiraAlanlari(f), ...parmakIziVektorleri(f), ...istekVektorleri(f)];
}

export function vektorV2DosyasiUret(simdiMs: number): VektorV2Dosyasi {
  return {
    bicim: VEKTOR_V2_BICIMI,
    not: "Üreten: Teks-Erp/scripts/test_lisans_native_kahin.ts --vektor-yaz (TS kâhini, lisans v2 aileleri). Elle düzenlenmez; native L2-2'de tüketir.",
    kayitlar: vektorleriKurV2(simdiMs).map((vektor) => ({ vektor, beklenen: degerlendirV2(vektor) })),
  };
}
