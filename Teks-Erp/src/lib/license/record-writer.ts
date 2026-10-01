// Durum kaydının YAZIMI (saatlik · açılış · kapanış · yeni kira): motorun anlık görüntüsünden sonraki kaydı kurar
// (`record-builder.ts`) ve iki kopyaya yazar (`accumulation.ts`: durum.json + DB izi). Anlık görüntüyü okur, motor
// (`runtime.ts`) bu modülü içe aktarmaz — döngü yok.
import type { LeaseDoc, VerifiedEntitlement } from "./protocol";
import type { StateRecord } from "./saat";
import { entitlementPinBroken } from "./state-rules-trust";
import { integrityRecordPatch } from "./integrity-state";
import { ladderValue } from "./ladder-counters";
import { leaseRecord, nextHourlyRecord, orphanRecord, type LadderFields } from "./record-builder";
import { currentAccumulation, elapsedOf, highWaterOf, recordView, writeRecord } from "./accumulation";
import { getLicenseStore } from "./store";
import { getLedgerHighWaterMs, getLicenseSnapshot, getVendorClockSkewMs, type LicenseSnapshot } from "./runtime";

function skewSecondsForRecord(): number | null {
  const ms = getVendorClockSkewMs();
  return ms === null ? null : Math.max(-1e9, Math.min(1e9, Math.round(ms / 1000)));
}

let fingerprintCacheCopy: StateRecord["parmakIziOnbellegi"] | undefined;
/** Parmak izi 24 sa önbelleğinin kayda girecek kopyası (ölçüm tazeler; K8). */
export function setFingerprintCacheCopy(c: StateRecord["parmakIziOnbellegi"] | undefined): void {
  fingerprintCacheCopy = c;
}

function ladderFields(snap: LicenseSnapshot): LadderFields {
  return {
    belirsizlikMs: snap.state.belirsizlik.birikenMs,
    parmakIziUyusmazMs: ladderValue("parmakIzi"),
    izKaybi: snap.state.belirsizlik.izKaybi,
    ucIzYok: snap.state.belirsizlik.ucIzYok,
    izDogrulandi: snap.view.traceValid,
    parmakIziOnbellegi: fingerprintCacheCopy,
  };
}

/**
 * Birikimi ve merdivenleri yazar (saatlik, açılışta, kapanışta): `durum.json` + DB izi. Ayakta kalan kopya SÜRDÜRÜR
 * (bozuk/silinmiş kayıt aynı kira için sıfırdan BAŞLATILMAZ); hiç kopya yoksa etkin kurulumda KİRASIZ kayıt doğar.
 * Kurulum anahtarı okunamıyorsa yazılmaz (imza durur, kararlar sürer).
 */
export function persistAccumulation(nowMs: number = Date.now()): boolean {
  const snap = getLicenseSnapshot(nowMs);
  const a = currentAccumulation();
  if (!a || !getLicenseStore()?.key || !snap.licenseId || !snap.activated) return false;
  const lease = snap.lease?.document ?? null;
  const prev = snap.view.record;
  const common = { skewSeconds: skewSecondsForRecord(), ladder: ladderFields(snap), nowMs };
  const highWaterMs = highWaterOf(prev, lease, getLedgerHighWaterMs());
  if (!prev) {
    writeRecord(orphanRecord({ ...common, licenseId: snap.licenseId, lease, entitlement: snap.entitlement, highWaterMs }));
    return true;
  }
  const entitlementUsable = snap.entitlement !== null && !(prev.sonHak && entitlementPinBroken(snap.entitlement, prev.sonHak));
  writeRecord(
    nextHourlyRecord({
      ...common,
      prev,
      lease,
      entitlement: snap.entitlement,
      hakGecerli: entitlementUsable,
      elapsedMs: elapsedOf(a, prev),
      creditMs: a.creditMs,
      clockConsistent: snap.state.saat.finding === null,
      highWaterMs,
      integrity: integrityRecordPatch(prev),
    }),
  );
  return true;
}

/** Yeni kira kabul edildi: birikim ve iz kaybı sıfırdan, kira kararları + HAK pini + süre çapası kalıcı iz olarak. */
export function startAccumulationForLease(g: {
  readonly lease: LeaseDoc;
  readonly entitlement: VerifiedEntitlement;
  readonly licenseId: string;
  readonly nowMs?: number;
}): void {
  const view = recordView(currentAccumulation(), g.licenseId);
  writeRecord(
    leaseRecord({
      ...g,
      prev: view.record,
      highWaterMs: highWaterOf(view.record, g.lease, getLedgerHighWaterMs()),
      skewSeconds: skewSecondsForRecord(),
      integrity: integrityRecordPatch(view.record),
      ladder: { parmakIziUyusmazMs: ladderValue("parmakIzi"), izDogrulandi: view.traceValid, parmakIziOnbellegi: fingerprintCacheCopy },
      nowMs: g.nowMs ?? Date.now(),
    }),
  );
}

/** Test-only. */
export function __resetRecordWriterForTests(): void {
  fingerprintCacheCopy = undefined;
}
