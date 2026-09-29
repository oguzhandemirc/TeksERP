// Bütünlük denetiminin BELLEK durumu (açılışta + günlük; `integrity-check.ts` üretir) ve lisans
// durumuna giden iki türevi: ölçüm sonucu ve ek süre çapası. Çapa imzalı durum kaydında kalıcıdır;
// yeniden başlatmak ya da kirayı yenilemek ek süreyi uzatmaz.
import { isoToMs, msToIso } from "./protocol";
import type { IntegrityOutcome } from "./integrity-check";
import type { PackageKey } from "./integrity";
import type { IntegrityStatus } from "./state-rules";
import type { StateRecord } from "./saat";
import { bumpLicenseSnapshotVersion } from "./license-signals";
import { NATIVE_REQUIRED } from "./native";

let integrity: IntegrityOutcome | null = null;
let firstMismatchMs: number | null = null;
let testTarget: { readonly root?: string; readonly keys?: readonly PackageKey[] } | null = null;

/** Test-only (Senaryo L): denetlenecek kök ve PAKET anahtarı. Zorunlu kipte (korumalı paket) YOK SAYILIR. */
export function configureIntegrityForTests(t: { readonly root?: string; readonly keys?: readonly PackageKey[] } | null): void {
  testTarget = t;
}

/** Denetim hedefi: paket kökü = süreç kökü (`app/`), gömülü PAKET çapası. */
export function integrityCheckTarget(required: boolean = NATIVE_REQUIRED): { readonly root: string; readonly keys: readonly PackageKey[] | undefined } {
  if (required || testTarget === null) return { root: process.cwd(), keys: undefined };
  return { root: testTarget.root ?? process.cwd(), keys: testTarget.keys };
}

export function setIntegrityOutcome(o: IntegrityOutcome | null, nowMs: number = Date.now()): void {
  integrity = o;
  if (o?.durum === "GECERSIZ") firstMismatchMs ??= nowMs;
  else if (o && o.durum !== "OLCULEMEDI") firstMismatchMs = null;
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

/** Ek süre çapası: kayıttaki ile bu süreçtekinin ERKENİ; uyuşmazlık yoksa null. */
export function integrityAnchorMs(record: StateRecord | null): number | null {
  if (integrity?.durum !== "GECERSIZ") return null;
  const persisted = record?.butunlukIlk ? isoToMs(record.butunlukIlk) : null;
  const all = [persisted, firstMismatchMs].filter((x): x is number => x !== null && Number.isFinite(x));
  return all.length > 0 ? Math.min(...all) : null;
}

/** Kayda yazılacak değer: GEÇERSİZ → çapa · ölçülemedi/henüz yok → kayıttakini koru (`undefined`) · aksi null. */
export function integrityRecordValue(record: StateRecord | null): string | null | undefined {
  if (!integrity || integrity.durum === "OLCULEMEDI") return undefined;
  if (integrity.durum !== "GECERSIZ") return null;
  const ms = integrityAnchorMs(record);
  return ms === null ? undefined : msToIso(ms);
}

/** Test-only. */
export function __resetIntegrityStateForTests(): void {
  integrity = null;
  firstMismatchMs = null;
  testTarget = null;
}
