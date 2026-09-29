// Güven zinciri: kök → (ALT | İNDİRME | BAYİ) sertifikası → belge. Tek seviye.
// Sertifika, çocuk belgenin İMZA ANINDA (verilis) geçerli olmalıdır: süresi sonradan
// dolan alt anahtarın kiraları ek süre zarfında çalışmaya devam eder.
import type { KeyObject } from "node:crypto";
import { publicKeyFromX, parseJws, verifyJws } from "./jws";
import {
  EntitlementSchema,
  LeaseSchema,
  CertificateSchema,
  LICENSE_CLASSES,
  TYP,
  decodeDocument,
  type EntitlementDoc,
  type LeaseDoc,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
} from "./belgeler";
import { STAGING_ROOT_CLASSES, type RootKey } from "./kok-anahtarlar";
import { CLOCK_SKEW_MS, success, failure, forwardFailure, isoToMs, type Result } from "./ortak";

const ROOT_KID_PATTERN = /^(kok|hazirlik)-[a-z0-9-]{1,40}$/;
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

export interface VerifiedEntitlement {
  readonly document: EntitlementDoc;
  readonly signer: { readonly kind: "KOK" | "BAYI"; readonly kid: string; readonly rootKid: string };
}

export interface VerifiedLease {
  readonly document: LeaseDoc;
  readonly subCertificate: VerifiedCertificate;
}

/** Çapayı doğrular: boş liste, biçimsiz kid/anahtar ve TEST/DEMO dışına taşan hazırlık kökü RED. */
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
    if (root.kid.startsWith("hazirlik-") && root.classes.some((s) => !STAGING_ROOT_CLASSES.includes(s))) {
      return failure("GUVEN_CAPASI_BICIM", `Hazırlık kökü yalnız TEST/DEMO sınıflarına yetkili olabilir: ${root.kid}`);
    }
    lookup.set(root.kid, { key, classes: Object.freeze([...root.classes]) });
  }
  return success(lookup);
}

export function verifyCertificate(
  token: unknown,
  g: { readonly roots: readonly RootKey[]; readonly usage: CertUsage; readonly atMs: number },
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
  if (!root.classes.includes(b.value.sinif)) {
    return failure("KOK_SINIF_YETKISIZ", `Kök ${kid} ${b.value.sinif} sınıfı imzalamaya yetkili değil`);
  }
  return success({ document: b.value, signer: { kind: "KOK", kid, rootKid: kid } });
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
  return success({ document: entitlement, signer: { kind: "BAYI", kid, rootKid: cert.rootKid } });
}

/** HAK: kök imzalıysa kökün sınıf yetkisi, bayi imzalıysa bayi tavanı kriptografik uygulanır. */
export function verifyEntitlement(token: unknown, roots: readonly RootKey[]): Result<VerifiedEntitlement> {
  const anchor = prepareTrustAnchor(roots);
  if (!anchor.ok) return forwardFailure(anchor);
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (typeof token !== "string") return failure("JWS_BICIM", "HAK metin değil");
  if (parsed.value.header.typ !== TYP.HAK) return failure("JWS_TYP", `Beklenen ${TYP.HAK}, gelen ${parsed.value.header.typ}`);
  const kid = parsed.value.header.kid;
  const root = anchor.value.get(kid);
  if (root) return verifyRootSigned(token, kid, root);
  const embedded = embeddedCertificate(parsed.value.payload, "bayiSertifikasi");
  if (!embedded) return failure("KOK_BILINMIYOR", `HAK'ı imzalayan anahtar tanınmıyor: ${kid}`);
  const cert = verifyCertificate(embedded.token, { roots, usage: "BAYI", atMs: embedded.atMs });
  if (!cert.ok) return cert.code === "SERTIFIKA_KULLANIM" ? failure("BAYI_KIMLIK", cert.message) : forwardFailure(cert);
  return verifyDealerSigned(token, kid, cert.value);
}

/** KİRA: gömülü ALT sertifikası kökle, kira alt anahtarla doğrulanır. HAK bağı ayrıca denetlenir. */
export function verifyLease(token: unknown, roots: readonly RootKey[]): Result<VerifiedLease> {
  const parsed = parseJws(token);
  if (!parsed.ok) return forwardFailure(parsed);
  if (parsed.value.header.typ !== TYP.KIRA) return failure("JWS_TYP", `Beklenen ${TYP.KIRA}, gelen ${parsed.value.header.typ}`);
  const embedded = embeddedCertificate(parsed.value.payload, "altSertifika");
  if (!embedded) return failure("BELGE_SEMA", "Kira alt sertifika ya da veriliş zamanı taşımıyor");
  const cert = verifyCertificate(embedded.token, { roots, usage: "ALT", atMs: embedded.atMs });
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
  if (!lease.subCertificate.allowedClasses.includes(h.sinif)) {
    return failure("KIRA_SINIF_YETKISIZ", `Kirayı imzalayan alt anahtar ${h.sinif} sınıfına yetkili değil`);
  }
  return success(true);
}
