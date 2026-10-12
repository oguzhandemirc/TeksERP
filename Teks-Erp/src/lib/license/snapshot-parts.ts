// Lisans anlık görüntüsünün türetilmiş parçaları (runtime.ts'ten ayrı: dosya boyu sınırı) — saf, G/Ç yok.
import { activationLockEnabled, classifyActivationLock, type ActivationLockDecision } from "./activation-lock";
import { foreignTraceOf } from "./activation-trace";
import { exemptionHolds } from "./exemption";
import type { MeasuredFingerprint } from "./fingerprint";
import { isoToMs, type RootKey, type VerifiedLease } from "./protocol";
import type { StateRecord } from "./saat";
import { LICENSE_FILES, type LicenseStoreSnapshot } from "./store";

/** Bekleyen taşıma talebi (imzasız yerel dosya) etkin SAYMAZ: yeni makine onay + taşıma koduyla etkinleşir. */
export function isActivated(store: LicenseStoreSnapshot | null, licenseId: string | null, record: StateRecord | null): boolean {
  if (!store || (store.problem && store.problem !== "OKUNAMADI")) return false;
  if (!licenseId) return false;
  const docPresent =
    store.entitlementJws !== null ||
    store.leaseJws !== null ||
    store.unreadable.includes(LICENSE_FILES.ENTITLEMENT) ||
    store.unreadable.includes(LICENSE_FILES.LEASE);
  return docPresent || record !== null;
}

/**
 * Lisans deposu kurulum hatası: program/yedek dizini içinde ya da yazılamaz; okunamayan depo yalnız DB izi de kurulum
 * anahtarını veremiyorsa (G12 yolu hazır kalır). İz henüz okunmadıysa (BILINMIYOR) hata sayılmaz — açılışta yanıp sönmesin.
 */
export function licenseStoreSetupError(store: LicenseStoreSnapshot | null, kurulumAnahtarKimligi: string | null, traceKnown: boolean): boolean {
  if (!store?.problem) return false;
  if (store.problem === "OKUNAMADI") return kurulumAnahtarKimligi === null && traceKnown;
  return true;
}

export function lastKnownLeaseOf(lease: VerifiedLease | null, record: StateRecord | null): { readonly kiraId: string; readonly verilisMs: number } | null {
  const fromLease = lease ? { kiraId: lease.document.kiraId, verilisMs: isoToMs(lease.document.verilis) } : null;
  const fromRecord = record?.sonKira ? { kiraId: record.sonKira.kiraId, verilisMs: isoToMs(record.sonKira.verilis) } : null;
  if (!fromLease) return fromRecord;
  if (!fromRecord) return fromLease;
  return fromRecord.verilisMs > fromLease.verilisMs ? fromRecord : fromLease;
}

/** G2 etkinleştirme kilidi kararı: muafiyet ve yabancı iz yalnız kilit açık ve kurulum etkin değilken ölçülür. */
export function decideActivationLock(g: {
  readonly ready: boolean;
  readonly setupError: boolean;
  readonly activated: boolean;
  readonly store: LicenseStoreSnapshot | null;
  readonly fingerprint: MeasuredFingerprint | null;
  readonly roots: readonly RootKey[];
}): ActivationLockDecision {
  const on = activationLockEnabled();
  const probe = on && !g.activated;
  return classifyActivationLock({
    enabled: on,
    setupError: g.setupError,
    ready: g.ready,
    activated: g.activated,
    exempt: probe && exemptionHolds({ store: g.store, fingerprint: g.fingerprint, roots: g.roots }),
    trace: probe ? foreignTraceOf({ roots: g.roots }) : "BILINMIYOR",
  });
}
