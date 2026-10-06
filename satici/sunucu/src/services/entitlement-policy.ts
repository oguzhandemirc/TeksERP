// HAK İMZA POLİTİKASI (SAF; lisans v2 · G4 · K2) — yetenek kapısı (imzacı planı), çevrimdışı ufkun çözümü ve uzun ufuk
// onayı. DB'ye, ağa, dosyaya dokunmaz: HAK sürümü (`entitlement-version.service.ts`), kök kuyruğu ve toplu yeniden basım
// bu kararları buradan alır — aynı soru tek yerde cevaplanır.
import type { Hak } from "@prisma/client";
import {
  CapabilityListSchema,
  ModuleKeySchema,
  OFFLINE_HORIZON_DEALER_DAYS,
  OFFLINE_HORIZON_MAX_DAYS,
  hasCapability,
  offlineHorizonCeilingDays,
  parseJws,
  type EntitlementDoc,
  type EntitlementSignerKind,
  type LicenseClass,
} from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { VendorError, badRequest } from "../lib/errors";

export function checkModuleFormat(modules: readonly string[]): string[] {
  const unique = [...new Set(modules)];
  if (unique.length > 64) throw badRequest("En çok 64 modül");
  for (const m of unique) if (!ModuleKeySchema.safeParse(m).success) throw badRequest(`Modül anahtarı biçimsiz: ${m}`);
  return unique;
}

/** Ara imzacının sınırsız ufuk verebildiği eşik: üstü (ya da süresiz) "uzun ufuk"tur (K2). */
export const DEFAULT_OFFLINE_HORIZON_DAYS = OFFLINE_HORIZON_DEALER_DAYS;

export function isLongHorizon(days: number | null): boolean {
  return days === null || days > OFFLINE_HORIZON_DEALER_DAYS;
}

/**
 * Sürümün ufku (SAF). İstenen değer imzacının sınıf tavanını (`offlineHorizonCeilingDays`) aşarsa 400
 * `UFUK_TAVANI_ASIMI`; istenmediyse mevcut değer (tavanı aşıyorsa — sınıf/imzacı değişti — tavana DARALTILIR, genişletme
 * yalnız açık istekle); HAK'ta hiç yoksa varsayılan. `granted`: uzun ufuk bu sürümle YENİ veriliyor (ikinci onay ister).
 */
export function resolveOfflineHorizon(
  hak: Pick<Hak, "cevrimdisiUfukGun" | "cevrimdisiUfukSuresiz">,
  requested: number | null | undefined,
  licenseClass: LicenseClass,
  signer: EntitlementSignerKind,
): { days: number | null; long: boolean; granted: boolean } {
  const ceiling = offlineHorizonCeilingDays(licenseClass, signer);
  const hasStored = hak.cevrimdisiUfukSuresiz || hak.cevrimdisiUfukGun !== null;
  const stored = hak.cevrimdisiUfukSuresiz ? null : hak.cevrimdisiUfukGun;
  let days: number | null;
  if (requested !== undefined) {
    if (requested !== null && (!Number.isInteger(requested) || requested < 1 || requested > OFFLINE_HORIZON_MAX_DAYS)) {
      throw badRequest(`Çevrimdışı ufuk 1–${OFFLINE_HORIZON_MAX_DAYS} gün ya da süresiz olmalı`);
    }
    if (ceiling !== null && (requested === null || requested > ceiling)) {
      throw new VendorError(400, "UFUK_TAVANI_ASIMI", `${licenseClass} sınıfında (${signer} imzası) çevrimdışı ufuk en çok ${ceiling} gün olabilir`);
    }
    days = requested;
  } else if (hasStored) {
    days = ceiling !== null && (stored === null || stored > ceiling) ? ceiling : stored;
  } else {
    days = ceiling === null ? DEFAULT_OFFLINE_HORIZON_DAYS : Math.min(DEFAULT_OFFLINE_HORIZON_DAYS, ceiling);
  }
  const long = isLongHorizon(days);
  const alreadyGranted = hasStored && isLongHorizon(stored) && stored === days;
  return { days, long, granted: long && !alreadyGranted };
}

// ---------------------------------------------------------------- geçerlilik bitişi zorunlu sınıflar (K5)

/** Bu sınıfların hakkı geçerlilik bitişi (`gecerlilikBitis`) olmadan kaydedilmez: doğuş · bitiş değişimi · kalıcıya çevirme · sınıf değişimi. */
export const VALIDITY_END_REQUIRED_CLASSES: readonly LicenseClass[] = ["DEMO"];

export function isValidityEndRequired(licenseClass: string): boolean {
  return (VALIDITY_END_REQUIRED_CLASSES as readonly string[]).includes(licenseClass);
}

/** Tek boğaz: zorunlu sınıfta bitişsiz kayıt 400. */
export function requireValidityEnd(licenseClass: string, validUntil: Date | null | undefined): void {
  if (isValidityEndRequired(licenseClass) && (validUntil === null || validUntil === undefined)) {
    throw badRequest(`${licenseClass} sınıfı lisansın geçerlilik bitişi zorunludur; bitiş tarihi olmadan kaydedilemez`);
  }
}

/** Gömülü imzacı sertifikası: bayi (BAYİ sertifikası + bayi kimliği) ya da ara imzacı (HAK sertifikası); kökte yok. */
export type EmbeddedSigner =
  | { readonly kind: "KOK" }
  | { readonly kind: "BAYI"; readonly dealerId: string; readonly certificate: string }
  | { readonly kind: "ARA"; readonly certificate: string };

// ---------------------------------------------------------------- yetenek kapısı + imza planı

export type SignerPlanKind = "ARA" | "KOK" | "KUYRUK";

export type EntitlementSignerPlan =
  | { readonly kind: "ARA"; readonly kid: string; readonly keyFile: string; readonly certificate: string }
  | { readonly kind: "KOK"; readonly kid: string; readonly keyFile: string }
  | { readonly kind: "KUYRUK"; readonly reason: "YETENEK_YOK" | "ARA_IMZACI_YOK" };

/**
 * Kurulumun bildirdiği yetenekler — TEK okuma yeri: `Kurulum.yetenekler` kolonu (zincir sahibinin yoklaması ve
 * etkinleştirme yazar). Alan zorunlu (kolonu seçmeyen okuma derlenmez); biçimsizse boş liste (fail-closed: yetenek yok →
 * kök/kuyruk, eski derleme davranışı).
 */
export function installationCapabilities(installation: { readonly yetenekler: unknown }): string[] {
  const parsed = CapabilityListSchema.safeParse((installation as { yetenekler?: unknown }).yetenekler);
  return parsed.success ? parsed.data : [];
}

/**
 * Yetenek kapısı (SAF): `hak-ara` bildiren kuruluma geçerli ara imzacı; yoksa (ya da yetenek yoksa) VDS'te duran kök
 * (A düzeni); o da yoksa kök kuyruğu. Yeni biçim (ara imzalı HAK) eski derlemeye ASLA gitmez: onu yalnız
 * `hak-ara` bildiren kurulum alır.
 */
export function planEntitlementSigner(keys: KeyStore, licenseClass: LicenseClass, capabilities: readonly string[], nowMs: number): EntitlementSignerPlan {
  const capable = hasCapability(capabilities, "hak-ara");
  if (capable) {
    const ara = keys.intermediateFor(licenseClass, nowMs);
    if (ara) return { kind: "ARA", kid: ara.kid, keyFile: ara.path, certificate: ara.certificate };
  }
  const root = keys.rootFileFor(licenseClass);
  if (root) return { kind: "KOK", kid: root.kid, keyFile: root.path };
  return { kind: "KUYRUK", reason: capable ? "ARA_IMZACI_YOK" : "YETENEK_YOK" };
}

// ---------------------------------------------------------------- genişlik kapısı (yetenek düşüşü)

/** HAK belgesinin imzacısı ara imzacı mı (gömülü `imzaciSertifikasi`)? İmza burada doğrulanmaz — yalnız yük okunur. */
export function isIntermediateSignedToken(token: string): boolean {
  const p = parseJws(token);
  return p.ok && typeof p.value.payload.imzaciSertifikasi === "string";
}

/**
 * Eski (yetenek bildirmeyen) derlemeye gidebilecek ADAY — en yeni ARA İMZASIZ sürüm (≤ güncel), girdi sırasından bağımsız.
 * TEK seçim: teslim seçimi (`deliverableEntitlement`, aday genişlik kapısından geçerse teslim edilir) ve iptal dağıtım
 * kapısının engel denetimi (`revocation.service`, adayın imzacısı iptal ediliyorsa belge bekler) aynı adayı okur.
 */
export function newestLegacyVersion<T extends { readonly surum: number; readonly belge: string }>(versions: readonly T[], currentVersion: number): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.surum > currentVersion || isIntermediateSignedToken(v.belge)) continue;
    if (best === null || v.surum > best.surum) best = v;
  }
  return best;
}

/** HAK belgesinin genişlik ölçüsüne giren alanları. */
export type EntitlementBreadth = Pick<EntitlementDoc, "sinif" | "moduller" | "kalici" | "bakimBitis" | "cevrimdisiUfukGun" | "kipAltSiniri">;

/** Ufkun genişlik sırası: alan yok (P modeli işlemez, eski çapa) < gün < süresiz. */
function horizonRank(days: number | null | undefined): number {
  if (days === undefined) return -1;
  return days === null ? Number.POSITIVE_INFINITY : days;
}

/**
 * Genişlik kapısı (SAF): `older` güncel sürümden GENİŞ DEĞİL mi — aynı sınıf · modüller ⊆ · kalıcı yalnız güncel
 * kalıcıysa · bakım sonu ≤ · çevrimdışı ufuk ≤ · güncelin kip alt sınırı korunur. Yeteneksiz alıcıya eski kök imzalı
 * sürüm yalnız bu doğruysa teslim edilir: aksi hâlde sonradan daraltılmış hak (çıkarılmış modül, kısaltılmış ufuk,
 * kaldırılmış kalıcılık) yeteneği bildirmeyen kuruluma geri dönerdi.
 */
export function isEntitlementWithin(older: EntitlementBreadth, current: EntitlementBreadth): boolean {
  if (older.sinif !== current.sinif) return false;
  const allowed = new Set(current.moduller);
  if (!older.moduller.every((m) => allowed.has(m))) return false;
  if (older.kalici && !current.kalici) return false;
  if (Date.parse(older.bakimBitis) > Date.parse(current.bakimBitis)) return false;
  if (horizonRank(older.cevrimdisiUfukGun) > horizonRank(current.cevrimdisiUfukGun)) return false;
  return !(current.kipAltSiniri === "zorla" && older.kipAltSiniri !== "zorla");
}

/** Uzun ufku VERMEK (K2): yalnız yönetici, kurulumun lisans numarası yazılarak — parola alt sürece gitmeden ÖNCE. */
export interface LongHorizonApproval {
  readonly admin: boolean;
  readonly confirmation?: string;
}

export function assertLongHorizonApproval(hak: Hak, approval: LongHorizonApproval | undefined): void {
  if (!approval?.admin) throw new VendorError(403, "YETKISIZ", "400 günü aşan ya da süresiz çevrimdışı ufuk yalnız yöneticinin işidir");
  if ((approval.confirmation ?? "").trim() !== hak.lisansNo) {
    throw new VendorError(400, "IKINCI_ONAY_GEREKLI", "Uzun çevrimdışı ufuk ikinci onay ister: kurulumun lisans numarasını aynen yazın");
  }
}
