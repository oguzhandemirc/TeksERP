// Güven zinciri: kök → (ALT | İNDİRME | BAYİ | HAK ara) sertifikası → belge; kök imzalı HAK da geçerlidir.
// Sertifika, çocuk belgenin İMZA ANINDA (verilis) geçerli olmalıdır: süresi sonradan
// dolan alt anahtarın kiraları ek süre zarfında çalışmaya devam eder. İptal (G4) ise TÜMDENDİR.
import type { KeyObject } from "node:crypto";
import { jwsDigest, publicKeyFromX, parseJws, verifyJws } from "./jws";
import {
  EntitlementSchema,
  LeaseSchema,
  CertificateSchema,
  RevocationSchema,
  LICENSE_CLASSES,
  OFFLINE_HORIZON_DEALER_DAYS,
  OFFLINE_HORIZON_SHORT_CLASS_DAYS,
  TYP,
  decodeDocument,
  type EntitlementDoc,
  type LeaseDoc,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
  type RevocationDoc,
} from "./belgeler";
import type { RootKey } from "./kok-anahtarlar";
import { CLOCK_SKEW_MS, success, failure, forwardFailure, isoToMs, type Result } from "./ortak";

const ROOT_KID_PATTERN = /^kok-[a-z0-9-]{1,40}$/;
const CLASS_SET: ReadonlySet<string> = new Set(LICENSE_CLASSES);

interface AnchorEntry {
  readonly key: KeyObject;
  readonly classes: readonly LicenseClass[];
}

export interface VerifiedCertificate {
  readonly document: CertificateDoc;
  readonly rootKid: string;
  /** Sertifikanın imzalayabileceği sınıflar (her zaman kökünkinin alt kümesi). */
  readonly allowedClasses: readonly LicenseClass[];
  readonly key: KeyObject;
}

/** HAK'ı imzalayan: kök · bayi (gömülü BAYI sertifikası) · ara imzacı (gömülü HAK sertifikası, G4). */
export type EntitlementSignerKind = "KOK" | "BAYI" | "ARA";

export interface VerifiedEntitlement {
  readonly document: EntitlementDoc;
  readonly signer: { readonly kind: EntitlementSignerKind; readonly kid: string; readonly rootKid: string };
  /** Doğrulanan compact metnin özeti (`jwsDigest`) — kiranın `hakOzeti` bağı buna bakar. */
  readonly digest: string;
}

export interface VerifiedLease {
  readonly document: LeaseDoc;
  readonly subCertificate: VerifiedCertificate;
}

export interface VerifiedRevocation {
  readonly document: RevocationDoc;
  readonly rootKid: string;
}

export interface ChainOptions {
  /** Doğrulanmış iptal belgesi; listelenen sertifika imza anından bağımsız geçersizdir (`SERTIFIKA_IPTAL`). */
  readonly revocation?: VerifiedRevocation | null;
}

export interface EntitlementVerifyOptions extends ChainOptions {
  /** Doğrulayanın "şimdi"si (duvar ∨ yüksek su; güvenilir saat değil — o belgelerden türer). Verilirse veriliş sınırı işler. */
  readonly nowMs?: number;
}

/** Çapayı doğrular: boş liste, `kok-` ailesi dışı ya da tekrarlı kid ve biçimsiz anahtar/sınıf RED. */
export function prepareTrustAnchor(roots: readonly RootKey[]): Result<ReadonlyMap<string, AnchorEntry>> {
  if (roots.length === 0) return failure("GUVEN_CAPASI_BOS", "Güven çapası boş: bu derlemede kök açık anahtarı yok");
  const lookup = new Map<string, AnchorEntry>();
  for (const root of roots) {
    if (!ROOT_KID_PATTERN.test(root.kid) || lookup.has(root.kid)) {
      return failure("GUVEN_CAPASI_BICIM", `Kök kimliği biçimsiz ya da tekrarlı: ${root.kid}`);
    }
    const key = publicKeyFromX(root.x);
    if (!key) return failure("GUVEN_CAPASI_BICIM", `Kök açık anahtarı biçimsiz: ${root.kid}`);
    if (root.classes.length === 0 || root.classes.some((s) => !CLASS_SET.has(s))) {
      return failure("GUVEN_CAPASI_BICIM", `Kökün sınıf listesi geçersiz: ${root.kid}`);
    }
    lookup.set(root.kid, { key, classes: Object.freeze([...root.classes]) });
  }
  return success(lookup);
}

/** Sertifika iptal listesinde mi: kimliğiyle ya da (kid, kullanım) çiftiyle — iptal ANAHTARIN iptalidir. */
export function isCertificateRevoked(cert: CertificateDoc, revocation: VerifiedRevocation | null | undefined): boolean {
  if (!revocation) return false;
  return revocation.document.iptaller.some((e) => e.sertifikaId === cert.sertifikaId || (e.kid === cert.kid && e.kullanim === cert.kullanim));
}

export function verifyCertificate(
  token: unknown,
  g: { readonly roots: readonly RootKey[]; readonly usage: CertUsage; readonly atMs: number; readonly revocation?: VerifiedRevocation | null },
): Result<VerifiedCertificate> {
  const anchor = prepareTrustAnchor(g.roots);
  if (!anchor.ok) return forwardFailure(anchor);
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  const rootKid = parsed.value.header.kid;
  const root = anchor.value.get(rootKid);
  if (!root) return failure("KOK_BILINMIYOR", `Sertifikayı imzalayan kök tanınmıyor: ${rootKid}`);
  const j = verifyJws(token, { typ: TYP.SERTIFIKA, findKey: (kid) => (kid === rootKid ? root.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(CertificateSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  const s = b.value;
  if (s.kullanim !== g.usage) return failure("SERTIFIKA_KULLANIM", `Beklenen ${g.usage} sertifikası, gelen ${s.kullanim}`);
  if (isCertificateRevoked(s, g.revocation)) return failure("SERTIFIKA_IPTAL", `Sertifika ${s.kid} iptal edilmiş`);
  if (s.siniflar.some((x) => !root.classes.includes(x))) {
    return failure("KOK_SINIF_YETKISIZ", `Kök ${rootKid} sertifikaya yetkisi olmayan sınıf vermiş`);
  }
  if (!Number.isFinite(g.atMs) || g.atMs < isoToMs(s.baslangic) - CLOCK_SKEW_MS || g.atMs > isoToMs(s.bitis) + CLOCK_SKEW_MS) {
    return failure("SERTIFIKA_ZAMAN", `Sertifika ${s.kid} imza anında geçerli değildi`);
  }
  const key = publicKeyFromX(s.x);
  if (!key) return failure("BELGE_SEMA", "Sertifikadaki açık anahtar biçimsiz");
  return success({ document: s, rootKid, allowedClasses: s.siniflar, key });
}

/** Doğrulanmamış yükten gömülü sertifikayı ve imza anını okur (zincir onları doğrulayacak). */
function embeddedCertificate(payload: Record<string, unknown>, field: string): { token: string; atMs: number } | null {
  const token = payload[field];
  const issued = payload.verilis;
  if (typeof token !== "string" || typeof issued !== "string") return null;
  return { token, atMs: isoToMs(issued) };
}

function verifyRootSigned(token: string, kid: string, root: AnchorEntry): Result<VerifiedEntitlement> {
  const j = verifyJws(token, { typ: TYP.HAK, findKey: (k) => (k === kid ? root.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(EntitlementSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  if (b.value.bayiSertifikasi) return failure("BAYI_KIMLIK", "Kök imzalı HAK bayi sertifikası taşıyamaz");
  if (b.value.imzaciSertifikasi) return failure("IMZACI_KIMLIK", "Kök imzalı HAK ara imzacı sertifikası taşıyamaz");
  if (!root.classes.includes(b.value.sinif)) {
    return failure("KOK_SINIF_YETKISIZ", `Kök ${kid} ${b.value.sinif} sınıfı imzalamaya yetkili değil`);
  }
  return success({ document: b.value, signer: { kind: "KOK", kid, rootKid: kid }, digest: jwsDigest(token) });
}

function verifyDealerSigned(token: string, kid: string, cert: VerifiedCertificate): Result<VerifiedEntitlement> {
  if (cert.document.kid !== kid) return failure("BAYI_KIMLIK", "HAK'ı imzalayan anahtar gömülü bayi sertifikasınınki değil");
  const j = verifyJws(token, { typ: TYP.HAK, findKey: (k) => (k === kid ? cert.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(EntitlementSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  const entitlement = b.value;
  const cap = cert.document.bayi;
  if (!cap || entitlement.bayiId !== cap.bayiId) return failure("BAYI_KIMLIK", "HAK'taki bayi kimliği sertifikayla uyuşmuyor");
  if (!cert.allowedClasses.includes(entitlement.sinif)) return failure("BAYI_TAVAN_SINIF", `Bayi ${entitlement.sinif} sınıfı veremez`);
  const exceeding = entitlement.moduller.filter((m) => !cap.moduller.includes(m));
  if (exceeding.length > 0) return failure("BAYI_TAVAN_MODUL", `Bayi tavanı dışında modül: ${exceeding.join(", ")}`);
  return success({ document: entitlement, signer: { kind: "BAYI", kid, rootKid: cert.rootKid }, digest: jwsDigest(token) });
}

function verifyIntermediateSigned(token: string, kid: string, cert: VerifiedCertificate): Result<VerifiedEntitlement> {
  if (cert.document.kid !== kid) return failure("IMZACI_KIMLIK", "HAK'ı imzalayan anahtar gömülü ara imzacı sertifikasınınki değil");
  const j = verifyJws(token, { typ: TYP.HAK, findKey: (k) => (k === kid ? cert.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(EntitlementSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  if (!cert.allowedClasses.includes(b.value.sinif)) {
    return failure("KOK_SINIF_YETKISIZ", `Ara imzacı ${kid} ${b.value.sinif} sınıfını imzalamaya yetkili değil`);
  }
  return success({ document: b.value, signer: { kind: "ARA", kid, rootKid: cert.rootKid }, digest: jwsDigest(token) });
}

function verifyEntitlementSignature(token: unknown, roots: readonly RootKey[], revocation: VerifiedRevocation | null | undefined): Result<VerifiedEntitlement> {
  const anchor = prepareTrustAnchor(roots);
  if (!anchor.ok) return forwardFailure(anchor);
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (typeof token !== "string") return failure("JWS_BICIM", "HAK metin değil");
  if (parsed.value.header.typ !== TYP.HAK) return failure("JWS_TYP", `Beklenen ${TYP.HAK}, gelen ${parsed.value.header.typ}`);
  const kid = parsed.value.header.kid;
  const root = anchor.value.get(kid);
  if (root) return verifyRootSigned(token, kid, root);
  const intermediate = embeddedCertificate(parsed.value.payload, "imzaciSertifikasi");
  if (intermediate) {
    const cert = verifyCertificate(intermediate.token, { roots, usage: "HAK", atMs: intermediate.atMs, revocation });
    return cert.ok ? verifyIntermediateSigned(token, kid, cert.value) : forwardFailure(cert);
  }
  const embedded = embeddedCertificate(parsed.value.payload, "bayiSertifikasi");
  if (!embedded) return failure("KOK_BILINMIYOR", `HAK'ı imzalayan anahtar tanınmıyor: ${kid}`);
  const cert = verifyCertificate(embedded.token, { roots, usage: "BAYI", atMs: embedded.atMs, revocation });
  if (!cert.ok) return cert.code === "SERTIFIKA_KULLANIM" ? failure("BAYI_KIMLIK", cert.message) : forwardFailure(cert);
  return verifyDealerSigned(token, kid, cert.value);
}

const SHORT_HORIZON_CLASSES: readonly LicenseClass[] = ["DEMO", "TEST"];
const UNBOUNDED_HORIZON_CLASSES: readonly LicenseClass[] = ["URETIM", "DR"];

/**
 * HAK çevrimdışı ufkunun tavanı (gün; `null` = tavansız, süresiz dahil) — K2 sınıf kısıtı: DEMO/TEST ≤ 45,
 * bayi imzalı ≤ 400, süresiz ya da 400 gün üstü yalnız ÜRETİM ve DR. Satıcı da imzalamadan önce buna bakar.
 */
export function offlineHorizonCeilingDays(sinif: LicenseClass, signer: EntitlementSignerKind): number | null {
  if (SHORT_HORIZON_CLASSES.includes(sinif)) return OFFLINE_HORIZON_SHORT_CLASS_DAYS;
  if (signer === "BAYI" || !UNBOUNDED_HORIZON_CLASSES.includes(sinif)) return OFFLINE_HORIZON_DEALER_DAYS;
  return null;
}

function checkHorizon(v: VerifiedEntitlement): Result<VerifiedEntitlement> {
  const horizon = v.document.cevrimdisiUfukGun;
  if (horizon === undefined) return success(v);
  const ceiling = offlineHorizonCeilingDays(v.document.sinif, v.signer.kind);
  if (ceiling !== null && (horizon === null || horizon > ceiling)) {
    return failure("UFUK_TAVANI_ASIMI", `${v.document.sinif} HAK'ı (${v.signer.kind}) en çok ${ceiling} günlük çevrimdışı ufuk taşıyabilir`);
  }
  return success(v);
}

/** Veriliş sınırı (G4 §2.5): "şimdi"den toleranstan fazla ileri tarihli HAK RED; biçimsiz şimdi de RED (fail-closed). */
function checkIssuance(v: VerifiedEntitlement, nowMs: number | undefined): Result<VerifiedEntitlement> {
  if (nowMs === undefined) return success(v);
  if (!Number.isFinite(nowMs) || !(isoToMs(v.document.verilis) <= nowMs + CLOCK_SKEW_MS)) {
    return failure("BELGE_ILERI_TARIHLI", "HAK'ın veriliş zamanı doğrulayanın saatinden ileride");
  }
  return success(v);
}

/**
 * HAK: kök imzalıysa kökün sınıf yetkisi, bayi imzalıysa bayi tavanı, ara imzalıysa ara sertifikanın sınıfları
 * kriptografik uygulanır; ardından ufuk tavanı (her imzacı) ve — `nowMs` verildiyse — veriliş sınırı.
 */
export function verifyEntitlement(token: unknown, roots: readonly RootKey[], options: EntitlementVerifyOptions = {}): Result<VerifiedEntitlement> {
  const signed = verifyEntitlementSignature(token, roots, options.revocation);
  if (!signed.ok) return signed;
  const horizon = checkHorizon(signed.value);
  return horizon.ok ? checkIssuance(horizon.value, options.nowMs) : horizon;
}

/** KİRA: gömülü ALT sertifikası kökle, kira alt anahtarla doğrulanır. HAK bağı ayrıca denetlenir. */
export function verifyLease(token: unknown, roots: readonly RootKey[], options: ChainOptions = {}): Result<VerifiedLease> {
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (parsed.value.header.typ !== TYP.KIRA) return failure("JWS_TYP", `Beklenen ${TYP.KIRA}, gelen ${parsed.value.header.typ}`);
  const embedded = embeddedCertificate(parsed.value.payload, "altSertifika");
  if (!embedded) return failure("BELGE_SEMA", "Kira alt sertifika ya da veriliş zamanı taşımıyor");
  const cert = verifyCertificate(embedded.token, { roots, usage: "ALT", atMs: embedded.atMs, revocation: options.revocation });
  if (!cert.ok) return forwardFailure(cert);
  const kid = parsed.value.header.kid;
  if (cert.value.document.kid !== kid) return failure("JWS_KID", "Kirayı imzalayan anahtar gömülü alt sertifikanınki değil");
  const j = verifyJws(token, { typ: TYP.KIRA, findKey: (k) => (k === kid ? cert.value.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(LeaseSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  return success({ document: b.value, subCertificate: cert.value });
}

/** Kira bu HAK'ın bu sürümüne mi ait, ve alt anahtarın zinciri HAK'ın sınıfına yetkili mi? */
export function checkLeaseBinding(lease: VerifiedLease, entitlement: VerifiedEntitlement): Result<true> {
  const k = lease.document;
  const h = entitlement.document;
  if (k.hakId !== h.hakId || k.hakSurum !== h.surum || k.kurulumId !== h.kurulumId) {
    return failure("KIRA_HAK_UYUSMAZ", "Kira bu HAK'a (ya da bu sürümüne) ait değil");
  }
  if (k.hakOzeti !== undefined && k.hakOzeti !== entitlement.digest) {
    return failure("KIRA_HAK_UYUSMAZ", "Kira bu HAK'ın baytına bağlı değil (aynı kimlikle başka HAK)");
  }
  if (!lease.subCertificate.allowedClasses.includes(h.sinif)) {
    return failure("KIRA_SINIF_YETKISIZ", `Kirayı imzalayan alt anahtar ${h.sinif} sınıfına yetkili değil`);
  }
  return success(true);
}

/** İPTAL belgesi: yalnız çapadaki bir KÖK imzalar (ara/alt anahtar iptal basamaz). Sıra seçimi `pickNewerRevocation`. */
export function verifyRevocation(token: unknown, roots: readonly RootKey[]): Result<VerifiedRevocation> {
  const anchor = prepareTrustAnchor(roots);
  if (!anchor.ok) return forwardFailure(anchor);
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (parsed.value.header.typ !== TYP.IPTAL) return failure("JWS_TYP", `Beklenen ${TYP.IPTAL}, gelen ${parsed.value.header.typ}`);
  const kid = parsed.value.header.kid;
  const root = anchor.value.get(kid);
  if (!root) return failure("KOK_BILINMIYOR", `İptal belgesini imzalayan kök tanınmıyor: ${kid}`);
  const j = verifyJws(token, { typ: TYP.IPTAL, findKey: (k) => (k === kid ? root.key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(RevocationSchema, j.value.payload);
  return b.ok ? success({ document: b.value, rootKid: kid }) : forwardFailure(b);
}

/** Kira bir iptal sırası beyan ediyorsa elde en az o sırada belge olmalı (yoksa iptal yanıttan ayıklanmış olabilir). */
export function isRevocationCurrent(lease: LeaseDoc, revocation: VerifiedRevocation | null | undefined): boolean {
  if (lease.iptalSira === undefined) return true;
  return !!revocation && revocation.document.sira >= lease.iptalSira;
}

/** Yüksek `sira` kazanır; eşit ya da düşük sıralı gelen yok sayılır (mevcut kalır — geri alınamaz, çırpınmaz). */
export function pickNewerRevocation(current: VerifiedRevocation | null, incoming: VerifiedRevocation | null): VerifiedRevocation | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.document.sira > current.document.sira ? incoming : current;
}
