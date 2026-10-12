// Lisans anlık görüntüsünün türetilmiş parçaları (runtime.ts'ten ayrı: dosya boyu sınırı) — saf, G/Ç yok.
import { activationLockEnabled, classifyActivationLock, type ActivationLockDecision } from "./activation-lock";
import { foreignTraceOf } from "./activation-trace";
import { exemptionHolds } from "./exemption";
import type { MeasuredFingerprint } from "./fingerprint";
import { isoToMs, type RootKey, type VerifiedLease } from "./protocol";
import type { StateRecord } from "./saat";
import { LICENSE_FILES, type LicenseStoreSnapshot } from "./store";

export function isActivated(store: LicenseStoreSnapshot | null, licenseId: string | null, record: StateRecord | null): boolean {
  if (!store || (store.problem && store.problem !== "OKUNAMADI")) return false;
  if (store.transfer && store.transfer.durum !== "ONAYLANDI") return true;
  if (!licenseId) return false;
  const docPresent =
    store.entitlementJws !== null ||
    store.leaseJws !== null ||
    store.unreadable.includes(LICENSE_FILES.ENTITLEMENT) ||
    store.unreadable.includes(LICENSE_FILES.LEASE);
  return docPresent || record !== null;
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
  readonly activated: boolean;
  readonly store: LicenseStoreSnapshot | null;
  readonly fingerprint: MeasuredFingerprint | null;
  readonly roots: readonly RootKey[];
}): ActivationLockDecision {
  const on = activationLockEnabled();
  const probe = on && !g.activated;
  return classifyActivationLock({
    enabled: on,
    ready: g.ready,
    activated: g.activated,
    exempt: probe && exemptionHolds({ store: g.store, fingerprint: g.fingerprint, roots: g.roots }),
    trace: probe ? foreignTraceOf({ roots: g.roots }) : "BILINMIYOR",
  });
}
