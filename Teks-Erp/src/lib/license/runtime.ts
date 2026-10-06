// Lisans motorunun BELLEK çekirdeği: depo + DB olguları + ölçümler → durum anlık görüntüsü.
// Senkron okunur (kapı ve modül okuyucuları istek/tx içinde çağıracak) ve sistem ayarı
// servisini İMPORT ETMEZ — modül okuyucusu buna bağlandığında döngü doğmasın.
import {
  compareFingerprints,
  isoToMs,
  type FingerprintDecision,
  type LicenseMode,
  type RootKey,
  type VerifiedEntitlement,
  type VerifiedLease,
} from "./protocol";
import { computeLicenseState, verifyLicenseDocuments, type LicenseState } from "./state";
import { evaluateEntitlement, evaluateLease, type DocResult, type Finding, type LicenseStateInput } from "./state-rules";
import { evaluateRollback } from "./state-rules-trust";
import { LADDER_WARNING_MS } from "./state-rules-trace";
import type { StateRecord } from "./saat";
import { getLicenseTraceRow, __resetLicenseTraceRowForTests } from "./trace-row";
import { raiseLadder, resetLadder, setLadderRunning, syncLadder, __resetLadderCountersForTests } from "./ladder-counters";
import { getLicenseCore } from "./native";
import { LICENSE_FILES, getLicenseStore, type LicenseStoreSnapshot } from "./store";
import { STARTUP_VENDOR } from "./vendor-url";
import { ROOT_PUBLIC_KEYS } from "./trust-anchor";
import type { MeasuredFingerprint } from "./fingerprint";
import {
  __resetIntegrityStateForTests,
  buildDateMsForState,
  integrityAnchorMs,
  integrityStampMs,
  integrityStatusForState,
} from "./integrity-state";
import {
  currentAccumulation,
  downtimeCreditOf,
  verificationFloorOf,
  elapsedOf,
  epochOf,
  highWaterOf,
  installationPublicX,
  lastKnownCeiling,
  mergedFingerprintMs,
  mergedTraceLoss,
  mergedUncertaintyMs,
  recordView,
  rememberedAnchorsOf,
  __resetAccumulationForTests,
  type Accumulation,
  type RecordView,
} from "./accumulation";
import { installationKeyId } from "./protocol";
import { revocationHolding, __resetRevocationStoreForTests, type HeldRevocation, type RevocationHolding } from "./revocation-store";
import { revocationPin } from "./state-rules-revocation";
import {
  bumpLicenseSnapshotVersion,
  licenseSnapshotVersion,
  peekVendorClockSkew,
  __resetLicenseSignalsForTests,
} from "./license-signals";

// Sinyaller ayrı modülde yaşar; çağıranlar tarihsel olarak buradan içe aktarır.
export {
  getDoorbellStatus, getDownloadTokens, getLicenseEngineStatus, getPollStatus,
  peekObservationCounters, recordModuleObservation, recordObservation, recordPollOutcome,
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
  /** Güven çapası — derlemenin kipinden `ROOT_PUBLIC_KEYS` (`trust-anchor.ts`; tek kip: yalnız `kok-*` kökleri). */
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
/** Defterin yüksek suyu (durum kaydının alt sınırı) — kimlik değil, yalnız saat olgusu. */
export function getLedgerHighWaterMs(): number | null {
  return facts.ledgerHighWaterMs;
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
  const a = currentAccumulation();
  const sn = (a?.file ?? a?.trace)?.saticiSapmaSn;
  return typeof sn === "number" ? sn * 1000 : null;
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
  kid: string | null,
): { id: string | null; source: LicenseIdSource | null } {
  if (store?.identity) return { id: store.identity.kurulumId, source: "DOSYA" };
  if (kid && lease.status === "GECERLI" && lease.value.document.kurulumAnahtarKimligi === kid) {
    return { id: lease.value.document.kurulumId, source: "KIRA" };
  }
  const own = a?.file ?? a?.trace ?? null;
  if (own) return { id: own.kurulumId, source: "DURUM" };
  return { id: null, source: null };
}

// ── Anlık görüntü ───────────────────────────────────────────────────────────────
export interface LicenseSnapshot {
  /**
   * İMZA hazır: depo + kurulum anahtarı + DB olguları — yoklama, istek imzası ve kayıt yazımı buna bakar
   * (G12 §3.1-1: depo sorunu YALNIZ imzayı durdurur).
   */
  readonly imzaHazir: boolean;
  /**
   * DURUM hazır: belgeler gömülü çapayla doğrulanabiliyor (depo okunuyor, kurulum açık anahtarı dosyadan ya da DB
   * izinden biliniyor, DB olguları var) — kapı, modül tavanı ve yaptırım buna bakar; değilse ham davranış (fail-open).
   */
  readonly durumHazir: boolean;
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
  /** Durum kaydının iki kopyası (dosya · DB izi) ve en yenisi. */
  readonly view: RecordView;
  /** Bu paketin ilk bütünlük uyuşmazlığı (durum kaydı + süreç; yalnız yeni paket sıfırlar). */
  readonly integrityFirstMismatchMs: number | null;
  /** G4 iptal belgesi: elde tutulan etkin belge, durum kaydı pini, kopya okunamadı mı. */
  readonly iptal: { readonly belge: HeldRevocation | null; readonly sira: number | null; readonly pin: number | null; readonly okunamadi: boolean };
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
  readonly view: RecordView;
  readonly licenseId: { id: string | null; source: LicenseIdSource | null };
  readonly revocation: RevocationHolding;
}

/** Lisans izlerinin hâli (G12): durum kaydı dosyası, DB izi ve kalıcı iz kaybı bayrağı. */
function traceInput(store: LicenseStoreSnapshot | null, licenseId: string | null, view: RecordView): NonNullable<LicenseStateInput["izler"]> {
  const row = getLicenseTraceRow();
  const dbIzi = row.durum === "BILINMIYOR" ? "BILINMIYOR" : view.traceValid ? "GECERLI" : "YOK";
  return {
    etkin: licenseId !== null && Boolean(store && (store.entitlementJws !== null || store.unreadable.includes(LICENSE_FILES.ENTITLEMENT))),
    durumDosyasi: view.fileValid,
    dbIzi,
    dbIziKurulu: view.copies.some((c) => c.izKurulu === true),
    kayip: mergedTraceLoss(view),
  };
}

function buildInput(nowMs: number): BuiltInput {
  const store = getLicenseStore();
  const a = currentAccumulation();
  const revocation = revocationHolding(config.roots);
  const paths = { entitlementJws: store?.entitlementJws ?? null, leaseJws: store?.leaseJws ?? null, roots: config.roots };
  const docs = verifyLicenseDocuments({ ...paths, revocation: revocation.effective?.jws ?? null, nowFloorMs: verificationFloorOf(nowMs, facts.ledgerHighWaterMs, a) });
  const kira = docStatus(docs.kira, LICENSE_FILES.LEASE, store);
  const x = installationPublicX();
  const kid = x === null ? null : installationKeyId(x);
  const licenseId = resolveLicenseId(store, kira, a, kid);
  const view = recordView(a, licenseId.id);
  const record = view.record;
  const base: LicenseStateInput = {
    kurulumId: licenseId.id,
    kurulumAnahtarKimligi: kid,
    hak: docStatus(docs.hak, LICENSE_FILES.ENTITLEMENT, store),
    kira,
    saat: {
      duvarMs: nowMs,
      yuksekSuMs: 0,
      monotonik:
        a && record && record.kiraId !== null
          ? { kiraId: record.kiraId, gecenMs: elapsedOf(a, record), tabanMs: record.saatTabani ? isoToMs(record.saatTabani) : null }
          : null,
      durumDosyasiGecerli: record !== null,
      kapaliKrediMs: downtimeCreditOf(a, record),
    },
    parmakIziEslesme: "OLCULEMEDI",
    butunluk: integrityStatusForState(),
    butunlukIlkUyusmazlikMs: integrityAnchorMs(record),
    derlemeTarihiMs: buildDateMsForState(),
    ilkAcilisMs: facts.firstOpenMs,
    varsayilanKip: DEFAULT_LICENSE_MODE,
    sonKiraZorlamasi: record?.sonKiraZorlamasi ?? null,
    sonYaptirim: record?.sonYaptirim ?? null,
    sonKira: record?.sonKira ? { kiraId: record.sonKira.kiraId, verilisMs: isoToMs(record.sonKira.verilis) } : null,
    sonHak: record?.sonHak ?? null,
    saticiSapmaMs: getVendorClockSkewMs(),
    depoOkunamadi: store?.unreadable ?? [],
    izler: traceInput(store, licenseId.id, view),
    belirsizlikMs: syncLadder("belirsizlik", epochOf(view), mergedUncertaintyMs(view)),
    parmakIziUyusmazMs: syncLadder("parmakIzi", epochOf(view), mergedFingerprintMs(view)),
    sonCapalar: rememberedAnchorsOf(view),
    sonBilinenTavan: lastKnownCeiling(view),
    imzaYok: store?.problem === "OKUNAMADI",
    ekSureCapasiMs: record?.ekSureCapasi ? isoToMs(record.ekSureCapasi) : null,
    // DB kopyası bilinmiyorsa (okunamadı) eksik belge "kayıp" değil "okunamadı"dır.
    iptal: { sira: revocation.effective?.view.document.sira ?? null, okunamadi: revocation.fileUnreadable || !revocation.dbKnown },
    iptalPini: revocationPin(...view.copies.map((c) => c.iptalSira)),
  };
  // Kullanılabilirlik kararı durumun KENDİ kurallarından (tek kaynak); bulgular burada atılır.
  const scratch: Finding[] = [];
  const entitlement = evaluateEntitlement(base, scratch);
  const lease = evaluateRollback(base, entitlement, evaluateLease(base, entitlement, scratch), scratch);
  const rule = lease?.document.parmakIziKurali;
  // Karar lisans çekirdeğinden (üretimde native); kural kiradan — yoksa v1 (eski kural).
  const decision =
    lease && fingerprint
      ? getLicenseCore().compareFingerprints(lease.document.parmakIzi, fingerprint.digest, { excludeF5: entitlement?.document.sinif === "DR", ...(rule ? { rule } : {}) })
      : null;
  const input: LicenseStateInput = {
    ...base,
    saat: { ...base.saat, yuksekSuMs: highWaterOf(record, null, facts.ledgerHighWaterMs) },
    parmakIziEslesme: decision?.result ?? "OLCULEMEDI",
    ...(decision ? { parmakIziKurali: decision.rule } : {}),
  };
  return { input, entitlement, lease, decision, view, licenseId, revocation };
}

function isActivated(store: LicenseStoreSnapshot | null, licenseId: string | null, record: StateRecord | null): boolean {
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

function lastKnownLeaseOf(lease: VerifiedLease | null, record: StateRecord | null): LicenseSnapshot["lastKnownLease"] {
  const fromLease = lease ? { kiraId: lease.document.kiraId, verilisMs: isoToMs(lease.document.verilis) } : null;
  const fromRecord = record?.sonKira ? { kiraId: record.sonKira.kiraId, verilisMs: isoToMs(record.sonKira.verilis) } : null;
  if (!fromLease) return fromRecord;
  if (!fromRecord) return fromLease;
  return fromRecord.verilisMs > fromLease.verilisMs ? fromRecord : fromLease;
}

/** Merdiven sayaçlarını durumun söylediği koşula göre akıtır/dondurur (K7: birikim en az 14 gün). */
function driveLadders(state: LicenseState): void {
  if (state.belirsizlik.ucIzYok) raiseLadder("belirsizlik", LADDER_WARNING_MS);
  setLadderRunning("belirsizlik", state.belirsizlik.suruyor);
  if (state.parmakIziMerdiveni.eslesti) resetLadder("parmakIzi");
  setLadderRunning("parmakIzi", state.parmakIziMerdiveni.uyusmaz);
}

/** Senkron, önbellekli (30 sn ya da herhangi bir girdi değişene dek). */
export function getLicenseSnapshot(nowMs: number = Date.now()): LicenseSnapshot {
  const version = licenseSnapshotVersion();
  if (cached && cached.version === version && nowMs - cached.snap.computedAtMs < SNAPSHOT_TTL_MS && nowMs >= cached.snap.computedAtMs) {
    return cached.snap;
  }
  const { input, entitlement, lease, decision, view, licenseId, revocation } = buildInput(nowMs);
  const store = getLicenseStore();
  const state = computeLicenseState(input);
  const signingReady = Boolean(store && !store.problem && store.key && facts.installationId);
  const stateReady = signingReady || Boolean(store && store.problem === "OKUNAMADI" && input.kurulumAnahtarKimligi && facts.installationId);
  const snap: LicenseSnapshot = {
    imzaHazir: signingReady,
    durumHazir: stateReady,
    licenseId: licenseId.id,
    licenseIdSource: licenseId.source,
    activated: isActivated(store, licenseId.id, view.record),
    state,
    entitlement,
    lease,
    lastKnownLease: lastKnownLeaseOf(lease, view.record),
    fingerprintDecision: decision,
    durumKaydi: { gecerli: view.record !== null, sira: view.record?.sira ?? null },
    view,
    integrityFirstMismatchMs: integrityStampMs(view.record),
    iptal: { belge: revocation.effective, sira: input.iptal?.sira ?? null, pin: input.iptalPini ?? null, okunamadi: input.iptal?.okunamadi ?? false },
    computedAtMs: nowMs,
  };
  if (snap.activated) driveLadders(state);
  cached = { snap, version: licenseSnapshotVersion() };
  return snap;
}

/** Test-only: bellek durumunu sıfırlar. */
export function __resetLicenseRuntimeForTests(): void {
  facts = { installationId: null, firstOpenMs: null, ledgerHighWaterMs: null };
  fingerprint = null;
  __resetIntegrityStateForTests();
  __resetLicenseSignalsForTests();
  __resetAccumulationForTests();
  __resetLadderCountersForTests();
  __resetLicenseTraceRowForTests();
  __resetRevocationStoreForTests();
  cached = null;
}
