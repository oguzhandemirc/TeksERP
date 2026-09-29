// Durum kaydı (`durum.json`) katmanı: kurulum anahtarıyla imzalı monotonik birikim + son kabul edilen
// kira/HAK izi + kapalı süre kredisi. Kayıt YALNIZ bu lisans kimliğine aitse okunur; bozuk/silinmiş
// kayıt aynı kira için sıfırdan başlatılmaz (saat hilesini açardı).
import { CLOCK_SKEW_MS, isoToMs, msToIso, type LeaseDoc, type VerifiedEntitlement } from "./protocol";
import { sanctionSnapshotOf } from "./state-rules";
import {
  accumulatedRuntime,
  rootKindOf,
  signStateRecord,
  verifyStateRecordSignature,
  type EntitlementPin,
  type StateRecord,
} from "./saat";
import { getLicenseStore, saveStateRecord } from "./store";
import { bumpLicenseSnapshotVersion } from "./license-signals";

export interface Accumulation {
  readonly jws: string;
  readonly keyX: string;
  /** İmzası bu kurulum anahtarıyla doğrulanmış kayıt (kurulum bağı `recordFor`da). */
  readonly record: StateRecord | null;
  /** Bu süreçte kayda son dokunulan hrtime — birikim buradan sayılır. */
  readonly baseHrNs: bigint;
  /** Kayıt tutarlı saatle yazılmışsa, yazımdan bu yüklemeye dek duvarla gözlenen kapalı süre. */
  readonly creditMs: number;
}
let accumulation: Accumulation | null = null;

/** Diskteki kaydı (bir kez) doğrular; anahtar ya da dosya değişince yeniden. */
export function currentAccumulation(): Accumulation | null {
  const store = getLicenseStore();
  if (!store?.key || !store.stateJws) return null;
  if (accumulation && accumulation.jws === store.stateJws && accumulation.keyX === store.key.x) return accumulation;
  const v = verifyStateRecordSignature(store.stateJws, { publicKeyX: store.key.x });
  const record = v.ok ? v.value : null;
  const creditMs = record?.duvarTutarli === true ? Math.max(0, Date.now() - isoToMs(record.yazildi)) : 0;
  accumulation = { jws: store.stateJws, keyX: store.key.x, record, baseHrNs: process.hrtime.bigint(), creditMs };
  return accumulation;
}

/** Kayıt YALNIZ bu lisans kimliğine aitse kullanılır (başka kurulumun birikimi okunmaz). */
export function recordFor(a: Accumulation | null, licenseId: string | null): StateRecord | null {
  const r = a?.record ?? null;
  return r && licenseId !== null && r.kurulumId === licenseId ? r : null;
}

export function elapsedOf(a: Accumulation): number {
  return a.record ? accumulatedRuntime({ storedMs: a.record.birikenMs, loadHrNs: a.baseHrNs, nowHrNs: process.hrtime.bigint() }) : 0;
}

/** Kapalı süre kredisi: kayıttaki birikmiş kredi + bu yüklemede duvarla gözlenen. */
export function downtimeCreditOf(a: Accumulation | null, record: StateRecord | null): number {
  return a && record ? (record.kapaliMs ?? 0) + a.creditMs : 0;
}

export function highWaterOf(record: StateRecord | null, lease: LeaseDoc | null, ledgerHighWaterMs: number | null): number {
  return Math.max(ledgerHighWaterMs ?? 0, record ? isoToMs(record.yuksekSu) : 0, lease ? isoToMs(lease.sunucuSaati) : 0);
}

function writeRecord(record: StateRecord): void {
  const store = getLicenseStore();
  if (!store?.key) throw new Error("Lisans deposu hazır değil");
  const jws = signStateRecord(record, store.key.privateKey, store.key.x);
  saveStateRecord(jws);
  accumulation = { jws, keyX: store.key.x, record, baseHrNs: process.hrtime.bigint(), creditMs: 0 };
  bumpLicenseSnapshotVersion();
}

export function entitlementPinOf(entitlement: VerifiedEntitlement): EntitlementPin {
  const d = entitlement.document;
  return { hakId: d.hakId, surum: d.surum, sinif: d.sinif, kokTuru: rootKindOf(entitlement.signer.rootKid) };
}

/**
 * Saatlik/kapanış yazımı. Saat o an tutarlıysa kayıt bir sonraki açılışa kapalı süre kredisi verir;
 * D2 öncesi kayıtta son kira ve HAK pini bu yazımda doldurulur.
 */
export function rewriteRecord(g: {
  readonly a: Accumulation;
  readonly record: StateRecord;
  readonly lease: LeaseDoc;
  readonly entitlement: VerifiedEntitlement | null;
  readonly clockConsistent: boolean;
  readonly ledgerHighWaterMs: number | null;
  readonly skewSeconds: number | null;
  /** Kayda yazılacak bütünlük çapası (ISO); `undefined` = kayıttakini koru. */
  readonly integrityFirst?: string | null;
  readonly nowMs: number;
}): void {
  const r = g.record;
  writeRecord({
    ...r,
    birikenMs: elapsedOf(g.a),
    yazildi: msToIso(g.nowMs),
    yuksekSu: msToIso(highWaterOf(r, g.lease, g.ledgerHighWaterMs)),
    sira: r.sira + 1,
    sonKira: r.sonKira ?? { kiraId: g.lease.kiraId, verilis: g.lease.verilis },
    sonHak: r.sonHak ?? (g.entitlement ? entitlementPinOf(g.entitlement) : null),
    kapaliMs: (r.kapaliMs ?? 0) + g.a.creditMs,
    duvarTutarli: g.clockConsistent,
    saticiSapmaSn: g.skewSeconds,
    butunlukIlk: g.integrityFirst === undefined ? (r.butunlukIlk ?? null) : g.integrityFirst,
  });
}

/**
 * Yeni kira kabul edildi: birikim sıfırdan; kira kararları (kip + yaptırım), kiranın kendisi ve
 * HAK pini kalıcı iz olarak — eski dosyayla değiştirilen kira/HAK geri alma sayılsın.
 */
export function beginRecordForLease(g: {
  readonly lease: LeaseDoc;
  readonly entitlement: VerifiedEntitlement;
  readonly licenseId: string;
  readonly ledgerHighWaterMs: number | null;
  readonly skewSeconds: number | null;
  readonly integrityFirst?: string | null;
  readonly nowMs: number;
}): void {
  const prev = recordFor(currentAccumulation(), g.licenseId);
  writeRecord({
    v: 1,
    kurulumId: g.licenseId,
    kiraId: g.lease.kiraId,
    birikenMs: 0,
    yazildi: msToIso(g.nowMs),
    yuksekSu: msToIso(highWaterOf(prev, g.lease, g.ledgerHighWaterMs)),
    sonKiraZorlamasi: g.lease.zorlama,
    sonYaptirim: sanctionSnapshotOf(g.lease),
    sira: prev ? prev.sira + 1 : 0,
    sonKira: { kiraId: g.lease.kiraId, verilis: g.lease.verilis },
    sonHak: entitlementPinOf(g.entitlement),
    kapaliMs: 0,
    // Kabul anında duvar saati satıcının İMZALI saatinden ileri kaçmışsa kayıt kredi vermez.
    duvarTutarli: g.nowMs - isoToMs(g.lease.sunucuSaati) <= CLOCK_SKEW_MS,
    saticiSapmaSn: g.skewSeconds,
    // Yeni kira bütünlük çapasını SIFIRLAMAZ (kira yenilemek ek süreyi uzatmasın).
    butunlukIlk: g.integrityFirst === undefined ? (prev?.butunlukIlk ?? null) : g.integrityFirst,
  });
}

/** Test-only. */
export function __resetAccumulationForTests(): void {
  accumulation = null;
}
