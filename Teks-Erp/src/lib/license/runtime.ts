// Lisans motorunun BELLEK çekirdeği: depo + DB olguları + ölçümler → durum anlık görüntüsü.
// Senkron okunur (kapı ve modül okuyucuları istek/tx içinde çağıracak) ve sistem ayarı
// servisini İMPORT ETMEZ — modül okuyucusu buna bağlandığında döngü doğmasın.
import {
  ROOT_PUBLIC_KEYS,
  compareFingerprints,
  isoToMs,
  type FingerprintDecision,
  type LeaseDoc,
  type LicenseMode,
  type RootKey,
  type VerifiedEntitlement,
  type VerifiedLease,
} from "./protocol";
import { computeLicenseState, verifyLicenseDocuments, type LicenseState } from "./state";
import { evaluateEntitlement, evaluateLease, type DocResult, type Finding, type LicenseStateInput } from "./state-rules";
import { evaluateRollback } from "./state-rules-trust";
import type { StateRecord } from "./saat";
import { LICENSE_FILES, getLicenseStore, type LicenseStoreSnapshot } from "./store";
import { STARTUP_VENDOR } from "./vendor-url";
import type { MeasuredFingerprint } from "./fingerprint";
import {
  __resetIntegrityStateForTests,
  buildDateMsForState,
  integrityAnchorMs,
  integrityRecordPatch,
  integrityStampMs,
  integrityStatusForState,
} from "./integrity-state";
import {
  beginRecordForLease,
  currentAccumulation,
  downtimeCreditOf,
  elapsedOf,
  highWaterOf,
  recordFor,
  rewriteRecord,
  __resetAccumulationForTests,
  type Accumulation,
} from "./accumulation";
import {
  bumpLicenseSnapshotVersion,
  licenseSnapshotVersion,
  peekVendorClockSkew,
  pollFailedRecently,
  __resetLicenseSignalsForTests,
} from "./license-signals";

// Sinyaller ayrı modülde yaşar; çağıranlar tarihsel olarak buradan içe aktarır.
export {
  POLL_FAILURE_WINDOW_MS, getDoorbellStatus, getDownloadTokens, getLicenseEngineStatus, getPollStatus,
  peekObservationCounters, pollFailedRecently, recordModuleObservation, recordObservation, recordPollOutcome,
  recordVendorClockSkew, resetObservationCounters, setDownloadTokens, setLicenseEngineStatus, setNextPollAt,
  onDownloadTokenStale, requestDownloadTokenRefresh,
  updateDoorbellStatus, type DoorbellStatus, type LicenseEngineState, type LicenseEngineStatus, type PollStatus,
} from "./license-signals";

/** Derleme varsayılan kipi — Faz 4'e dek GÖZLEM (hiçbir istek engellenmez, bant yok). */
export const DEFAULT_LICENSE_MODE: LicenseMode = "gozlem";
const SNAPSHOT_TTL_MS = 30_000;

export interface LicenseRuntimeConfig {
  /** Satıcı lisans sunucusu kökü (`vendor-url.ts`); null ise dışarı hiç çıkılmaz. */
  readonly vendorUrl: string | null;
  /** Güven çapası — üretimde `ROOT_PUBLIC_KEYS` (ÜRETİM sınıfları yalnız üretim kökünün zinciriyle; hazırlık kökü TEST/DEMO). */
  readonly roots: readonly RootKey[];
}

let config: LicenseRuntimeConfig = { vendorUrl: STARTUP_VENDOR.url, roots: ROOT_PUBLIC_KEYS };

export function getLicenseConfig(): LicenseRuntimeConfig {
  return config;
}

/** Test-only: sahte satıcı adresi ve test kökü. Üretimde env'den çapa OKUNMAZ (sahte kök = sahte lisans). */
export function configureLicenseRuntimeForTests(p: Partial<LicenseRuntimeConfig>): void {
  config = { ...config, ...p };
  invalidateLicenseSnapshot();
}

// ── DB'den türeyen olgular (dosya silmekle yenilenmez) ─────────────────────────
export interface LicenseDbFacts {
  /** DB'nin `system.installationId`si — YALNIZ BİLGİ (döküm/DR kopyası taşır); lisans kimliği DEĞİL. */
  readonly installationId: string | null;
  /** Kurulumun ilk açılışı: kimlik satırı ile en eski kullanıcının `createdAt`inin küçüğü. */
  readonly firstOpenMs: number | null;
  /** Defterdeki en büyük `createdAt` (yüksek su) — güvenilir saatin kendisi buraya YAZILMAZ. */
  readonly ledgerHighWaterMs: number | null;
}
let facts: LicenseDbFacts = { installationId: null, firstOpenMs: null, ledgerHighWaterMs: null };

export function setLicenseDbFacts(p: Partial<LicenseDbFacts>): void {
  facts = { ...facts, ...p };
  invalidateLicenseSnapshot();
}
export function getLicenseDbFacts(): LicenseDbFacts {
  return facts;
}
/**
 * Lisans kimliği (D14: LICENSE_DIR `kurulumId`) — imzalı istekler, zil, patron bulutu eşitleme ve
 * gelen kutusu TEK buradan okur; DB `installationId`si (döküm/DR kopyası taşır) kimlik DEĞİLDİR.
 */
export function getLicenseInstallationId(): string | null {
  return getLicenseSnapshot().licenseId;
}

// ── Ölçüm ─────────────────────────────────────────────────────────────────────
let fingerprint: MeasuredFingerprint | null = null;
export function setMeasuredFingerprint(fp: MeasuredFingerprint | null): void {
  fingerprint = fp;
  invalidateLicenseSnapshot();
}
export function getMeasuredFingerprint(): MeasuredFingerprint | null {
  return fingerprint;
}

// ── Satıcı saati sapması: bu süreçte ölçülmediyse durum kaydındaki son değer ────
export function getVendorClockSkewMs(): number | null {
  const mem = peekVendorClockSkew();
  if (mem.known) return mem.ms;
  const sn = currentAccumulation()?.record?.saticiSapmaSn;
  return typeof sn === "number" ? sn * 1000 : null;
}

function skewSecondsForRecord(): number | null {
  const ms = getVendorClockSkewMs();
  return ms === null ? null : Math.max(-1e9, Math.min(1e9, Math.round(ms / 1000)));
}

// ── Durum kaydı yazımı (katman `accumulation.ts`) ───────────────────────────────
/**
 * Birikimi diske yazar (saatlik + kapanışta). YALNIZ geçerli kayıt kullanılabilir kiraya
 * aitse: bozuk/silinmiş kayıt aynı kira için sıfırdan BAŞLATILMAZ (saat hilesini açardı).
 */
export function persistAccumulation(nowMs: number = Date.now()): boolean {
  const a = currentAccumulation();
  const snap = getLicenseSnapshot(nowMs);
  const lease = snap.lease?.document ?? null;
  const record = recordFor(a, snap.licenseId);
  if (!a || !record || !lease || record.kiraId !== lease.kiraId) return false;
  rewriteRecord({
    a,
    record,
    lease,
    entitlement: snap.entitlement,
    clockConsistent: snap.state.saat.finding === null,
    ledgerHighWaterMs: facts.ledgerHighWaterMs,
    skewSeconds: skewSecondsForRecord(),
    integrity: integrityRecordPatch(record),
    nowMs,
  });
  return true;
}

/** Yeni kira kabul edildi: birikim sıfırdan, kira kararları + HAK pini kalıcı iz olarak. */
export function startAccumulationForLease(g: {
  readonly lease: LeaseDoc;
  readonly entitlement: VerifiedEntitlement;
  readonly licenseId: string;
  readonly nowMs?: number;
}): void {
  beginRecordForLease({
    ...g,
    ledgerHighWaterMs: facts.ledgerHighWaterMs,
    skewSeconds: skewSecondsForRecord(),
    integrity: integrityRecordPatch(recordFor(currentAccumulation(), g.licenseId)),
    nowMs: g.nowMs ?? Date.now(),
  });
}

// ── Lisans kimliği (D14: LICENSE_DIR'de; DB kimliği yalnız bilgi) ────────────────
export type LicenseIdSource = "DOSYA" | "KIRA" | "DURUM";

/**
 * Kimlik dosyası yoksa (D14 öncesi etkinleşmiş kurulum) BU kurulum anahtarına bağlı imzalı kira ya
 * da bu anahtarla imzalı durum kaydı kimliği taşır — ikisini de yalnız satıcı/bu depo üretebilir.
 * Benimseme bellekte kalır; dosyaya yalnız doğrulanmış satıcı yanıtı yazar.
 */
function resolveLicenseId(
  store: LicenseStoreSnapshot | null,
  lease: DocResult<VerifiedLease>,
  a: Accumulation | null,
): { id: string | null; source: LicenseIdSource | null } {
  if (store?.identity) return { id: store.identity.kurulumId, source: "DOSYA" };
  const kid = store?.key?.kid ?? null;
  if (kid && lease.status === "GECERLI" && lease.value.document.kurulumAnahtarKimligi === kid) {
    return { id: lease.value.document.kurulumId, source: "KIRA" };
  }
  if (a?.record) return { id: a.record.kurulumId, source: "DURUM" };
  return { id: null, source: null };
}

// ── Anlık görüntü ───────────────────────────────────────────────────────────────
export interface LicenseSnapshot {
  /** Depo + kurulum anahtarı + DB olguları hazır mı — değilse durum yalnız bilgi amaçlıdır. */
  readonly hazir: boolean;
  /** Lisans kimliği (`kurulumId`, LICENSE_DIR); etkinleşmemişte null. DB `installationId`si DEĞİL. */
  readonly licenseId: string | null;
  readonly licenseIdSource: LicenseIdSource | null;
  /** Etkinleşmiş sayılır mı (kimlik ∧ (HAK ∨ kira ∨ geçerli durum kaydı) ∨ bekleyen taşıma). */
  readonly activated: boolean;
  readonly state: LicenseState;
  /** Kullanılabilir (bu kuruluma bağlı, doğrulanmış, geri alınmamış) belgeler. */
  readonly entitlement: VerifiedEntitlement | null;
  readonly lease: VerifiedLease | null;
  /** Bilinen en yeni kira: kullanılabilir kira ile durum kaydındaki son kabulün yenisi (kira zinciri ucu). */
  readonly lastKnownLease: { readonly kiraId: string; readonly verilisMs: number } | null;
  readonly fingerprintDecision: FingerprintDecision | null;
  readonly durumKaydi: { readonly gecerli: boolean; readonly sira: number | null };
  /** Bu paketin ilk bütünlük uyuşmazlığı (durum kaydı + süreç; yalnız yeni paket sıfırlar). */
  readonly integrityFirstMismatchMs: number | null;
  readonly computedAtMs: number;
}

let cached: { snap: LicenseSnapshot; version: number } | null = null;

export function invalidateLicenseSnapshot(): void {
  bumpLicenseSnapshotVersion();
}

function docStatus<T>(doc: DocResult<T>, file: string, store: LicenseStoreSnapshot | null): DocResult<T> {
  return store?.unreadable.includes(file) ? { status: "OKUNAMADI" } : doc;
}

interface BuiltInput {
  readonly input: LicenseStateInput;
  readonly entitlement: VerifiedEntitlement | null;
  readonly lease: VerifiedLease | null;
  readonly decision: FingerprintDecision | null;
  readonly record: StateRecord | null;
  readonly licenseId: { id: string | null; source: LicenseIdSource | null };
}

function buildInput(nowMs: number): BuiltInput {
  const store = getLicenseStore();
  const docs = verifyLicenseDocuments({
    entitlementJws: store?.entitlementJws ?? null,
    leaseJws: store?.leaseJws ?? null,
    roots: config.roots,
  });
  const kira = docStatus(docs.kira, LICENSE_FILES.LEASE, store);
  const a = currentAccumulation();
  const licenseId = resolveLicenseId(store, kira, a);
  const record = recordFor(a, licenseId.id);
  const base: LicenseStateInput = {
    kurulumId: licenseId.id,
    kurulumAnahtarKimligi: store?.key?.kid ?? null,
    hak: docStatus(docs.hak, LICENSE_FILES.ENTITLEMENT, store),
    kira,
    saat: {
      duvarMs: nowMs,
      yuksekSuMs: 0,
      monotonik: a && record ? { kiraId: record.kiraId, gecenMs: elapsedOf(a) } : null,
      durumDosyasiGecerli: record !== null,
      kapaliKrediMs: downtimeCreditOf(a, record),
    },
    parmakIziEslesme: "OLCULEMEDI",
    butunluk: integrityStatusForState(),
    butunlukIlkUyusmazlikMs: integrityAnchorMs(record),
    derlemeTarihiMs: buildDateMsForState(),
    ilkAcilisMs: facts.firstOpenMs,
    sonYoklamaBasarisizMi: pollFailedRecently(nowMs),
    varsayilanKip: DEFAULT_LICENSE_MODE,
    sonKiraZorlamasi: record?.sonKiraZorlamasi ?? null,
    sonYaptirim: record?.sonYaptirim ?? null,
    sonKira: record?.sonKira ? { kiraId: record.sonKira.kiraId, verilisMs: isoToMs(record.sonKira.verilis) } : null,
    sonHak: record?.sonHak ?? null,
    saticiSapmaMs: getVendorClockSkewMs(),
    depoOkunamadi: store?.unreadable ?? [],
  };
  // Kullanılabilirlik kararı durumun KENDİ kurallarından (tek kaynak); bulgular burada atılır.
  const scratch: Finding[] = [];
  const entitlement = evaluateEntitlement(base, scratch);
  const lease = evaluateRollback(base, entitlement, evaluateLease(base, entitlement, scratch), scratch);
  const decision =
    lease && fingerprint
      ? compareFingerprints(lease.document.parmakIzi, fingerprint.digest, { excludeF5: entitlement?.document.sinif === "DR" })
      : null;
  const input: LicenseStateInput = {
    ...base,
    saat: { ...base.saat, yuksekSuMs: highWaterOf(record, null, facts.ledgerHighWaterMs) },
    parmakIziEslesme: decision?.result ?? "OLCULEMEDI",
  };
  return { input, entitlement, lease, decision, record, licenseId };
}

function isActivated(store: LicenseStoreSnapshot | null, licenseId: string | null, record: StateRecord | null): boolean {
  if (!store || store.problem || !store.key) return false;
  if (store.transfer && store.transfer.durum !== "ONAYLANDI") return true;
  if (!licenseId) return false;
  const docPresent =
    store.entitlementJws !== null ||
    store.leaseJws !== null ||
    store.unreadable.includes(LICENSE_FILES.ENTITLEMENT) ||
    store.unreadable.includes(LICENSE_FILES.LEASE);
  return docPresent || record !== null;
}

function lastKnownLeaseOf(lease: VerifiedLease | null, record: StateRecord | null): LicenseSnapshot["lastKnownLease"] {
  const fromLease = lease ? { kiraId: lease.document.kiraId, verilisMs: isoToMs(lease.document.verilis) } : null;
  const fromRecord = record?.sonKira ? { kiraId: record.sonKira.kiraId, verilisMs: isoToMs(record.sonKira.verilis) } : null;
  if (!fromLease) return fromRecord;
  if (!fromRecord) return fromLease;
  return fromRecord.verilisMs > fromLease.verilisMs ? fromRecord : fromLease;
}

/** Senkron, önbellekli (30 sn ya da herhangi bir girdi değişene dek). */
export function getLicenseSnapshot(nowMs: number = Date.now()): LicenseSnapshot {
  const version = licenseSnapshotVersion();
  if (cached && cached.version === version && nowMs - cached.snap.computedAtMs < SNAPSHOT_TTL_MS && nowMs >= cached.snap.computedAtMs) {
    return cached.snap;
  }
  const { input, entitlement, lease, decision, record, licenseId } = buildInput(nowMs);
  const store = getLicenseStore();
  const snap: LicenseSnapshot = {
    hazir: Boolean(store && !store.problem && store.key && facts.installationId),
    licenseId: licenseId.id,
    licenseIdSource: licenseId.source,
    activated: isActivated(store, licenseId.id, record),
    state: computeLicenseState(input),
    entitlement,
    lease,
    lastKnownLease: lastKnownLeaseOf(lease, record),
    fingerprintDecision: decision,
    durumKaydi: { gecerli: record !== null, sira: record?.sira ?? null },
    integrityFirstMismatchMs: integrityStampMs(record),
    computedAtMs: nowMs,
  };
  cached = { snap, version };
  return snap;
}

/** Test-only: bellek durumunu sıfırlar. */
export function __resetLicenseRuntimeForTests(): void {
  facts = { installationId: null, firstOpenMs: null, ledgerHighWaterMs: null };
  fingerprint = null;
  __resetIntegrityStateForTests();
  __resetLicenseSignalsForTests();
  __resetAccumulationForTests();
  cached = null;
}
