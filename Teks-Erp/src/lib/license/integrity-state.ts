// Bütünlük denetiminin BELLEK durumu (açılışta + günlük; `integrity-check.ts` üretir) ve lisans
// durumuna giden iki türevi: ölçüm sonucu ve ek süre çapası. Çapa imzalı durum kaydında kalıcıdır ve
// ait olduğu paketId'yle yazılır: yeniden başlatmak, kirayı yenilemek ya da dosyaları kısa süre geri
// yüklemek ek süreyi uzatmaz; yalnız yeni imzalı paket kurulunca sıfırlanır.
import { isoToMs, msToIso, type RootKey } from "./protocol";
import type { IntegrityOutcome } from "./integrity-check";
import type { PackageKey } from "./integrity";
import type { IntegrityStatus } from "./state-rules";
import type { StateRecord } from "./saat";
import { bumpLicenseSnapshotVersion } from "./license-signals";
import { NATIVE_REQUIRED } from "./native";

let integrity: IntegrityOutcome | null = null;
/** Bu süreçte görülen ilk uyuşmazlık ve ait olduğu imzalı paket (yalnız paket DEĞİŞİNCE sıfırlanır). */
let firstMismatch: { readonly ms: number; readonly paketId: string | null } | null = null;
interface IntegrityTestTarget {
  readonly root?: string;
  readonly keys?: readonly PackageKey[];
  /** Zincirli (`pkt-*`) listenin PAKET sertifikasını doğrulayan kök çapası (fikstür kökü). */
  readonly roots?: readonly RootKey[];
}
let testTarget: IntegrityTestTarget | null = null;

/** Test-only (Senaryo L): denetlenecek kök, PAKET anahtarı ve kök çapası. Zorunlu kipte (korumalı paket) YOK SAYILIR. */
export function configureIntegrityForTests(t: IntegrityTestTarget | null): void {
  testTarget = t;
}

/** Denetim hedefi: paket kökü = süreç kökü (`app/`), gömülü PAKET + kök çapası. */
export function integrityCheckTarget(required: boolean = NATIVE_REQUIRED): {
  readonly root: string;
  readonly keys: readonly PackageKey[] | undefined;
  readonly roots: readonly RootKey[] | undefined;
} {
  if (required || testTarget === null) return { root: process.cwd(), keys: undefined, roots: undefined };
  return { root: testTarget.root ?? process.cwd(), keys: testTarget.keys, roots: testTarget.roots };
}

/** İmzası doğrulanmış listenin paket kimliği; imza/şema düşmüşse null (paket bilinmiyor). */
function packageIdOf(o: IntegrityOutcome | null): string | null {
  return o?.rapor?.paket?.paketId ?? null;
}

/** İki paket kimliği FARKLI bir paketi mi gösteriyor (biri bilinmiyorsa aynı sayılır — sıfırlama yok). */
function isNewPackage(known: string | null | undefined, current: string | null): boolean {
  return known !== null && known !== undefined && current !== null && known !== current;
}

export function setIntegrityOutcome(o: IntegrityOutcome | null, nowMs: number = Date.now()): void {
  integrity = o;
  const pkg = packageIdOf(o);
  if (firstMismatch && isNewPackage(firstMismatch.paketId, pkg)) firstMismatch = null;
  if (o?.durum === "GECERSIZ") {
    if (firstMismatch === null) firstMismatch = { ms: nowMs, paketId: pkg };
    else if (firstMismatch.paketId === null && pkg !== null) firstMismatch = { ms: firstMismatch.ms, paketId: pkg };
  }
  bumpLicenseSnapshotVersion();
}

export function getIntegrityOutcome(): IntegrityOutcome | null {
  return integrity;
}

/** Henüz ölçülmediyse: korumalı pakette ÖLÇÜLEMEDİ (fail-closed), geliştirmede KAPSAM DIŞI (bugünkü davranış). */
export function integrityStatusForState(required: boolean = NATIVE_REQUIRED): IntegrityStatus {
  if (integrity) return integrity.durum;
  return required ? "OLCULEMEDI" : "KAPSAM_DISI";
}

/** İmzalı künyedeki derleme tarihi; imzasız/eksik künye null (bakım kuralı `DERLEME_TARIHI_YOK`). */
export function buildDateMsForState(): number | null {
  const iso = integrity?.kunye?.derlemeTarihi ?? null;
  if (iso === null) return null;
  const ms = isoToMs(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Bu paketin ilk uyuşmazlık damgası: kayıttaki ile bu süreçtekinin ERKENİ. Başka pakete ait
 * damga sayılmaz; paket bilinmiyorsa (imza düştü, eski kayıt) damga korunur — fail-closed.
 */
function stampFor(record: StateRecord | null, pkg: string | null): number | null {
  const all: number[] = [];
  if (record?.butunlukIlk && !isNewPackage(record.butunlukPaketId, pkg)) all.push(isoToMs(record.butunlukIlk));
  if (firstMismatch && !isNewPackage(firstMismatch.paketId, pkg)) all.push(firstMismatch.ms);
  const finite = all.filter((x) => Number.isFinite(x));
  return finite.length > 0 ? Math.min(...finite) : null;
}

/** Bu paketin ilk uyuşmazlık damgası (şu an uyuşsa bile) — panel ayrıntısı gösterir. */
export function integrityStampMs(record: StateRecord | null): number | null {
  return stampFor(record, packageIdOf(integrity));
}

/** Ek süre çapası (yalnız uyuşmazlık sürerken); dosyalar yeniden uyuşup bozulursa ek süre YENİDEN BAŞLAMAZ. */
export function integrityAnchorMs(record: StateRecord | null): number | null {
  if (integrity?.durum !== "GECERSIZ") return null;
  return stampFor(record, packageIdOf(integrity));
}

export interface IntegrityRecordPatch {
  readonly butunlukIlk: string | null;
  readonly butunlukPaketId: string | null;
}

/**
 * Kayda yazılacak çapa: ölçülemedi/kapsam dışı/henüz yok → kayıttakini koru (`undefined`) ·
 * aksi bu paketin damgası (uyuşma damgayı SİLMEZ; yalnız yeni imzalı paket — farklı paketId — sıfırlar).
 */
export function integrityRecordPatch(record: StateRecord | null): IntegrityRecordPatch | undefined {
  if (!integrity || integrity.durum === "OLCULEMEDI" || integrity.durum === "KAPSAM_DISI") return undefined;
  const pkg = packageIdOf(integrity);
  const ms = stampFor(record, pkg);
  return { butunlukIlk: ms === null ? null : msToIso(ms), butunlukPaketId: pkg ?? record?.butunlukPaketId ?? null };
}

/** Test-only. */
export function __resetIntegrityStateForTests(): void {
  integrity = null;
  firstMismatch = null;
  testTarget = null;
}
