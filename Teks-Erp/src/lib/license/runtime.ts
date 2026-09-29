// Lisans motorunun BELLEK çekirdeği: depo + DB olguları + ölçümler → durum anlık görüntüsü.
// Senkron okunur (kapı ve modül okuyucuları istek/tx içinde çağıracak) ve sistem ayarı
// servisini İMPORT ETMEZ — modül okuyucusu buna bağlandığında döngü doğmasın.
import {
  ROOT_PUBLIC_KEYS,
  compareFingerprints,
  isoToMs,
  msToIso,
  type FingerprintDecision,
  type LeaseDoc,
  type LicenseMode,
  type RootKey,
  type VerifiedEntitlement,
  type VerifiedLease,
} from "./protocol";
import { computeLicenseState, sanctionSnapshotOf, verifyLicenseDocuments, type LicenseState } from "./state";
import { evaluateEntitlement, evaluateLease, type Finding, type LicenseStateInput } from "./state-rules";
import { accumulatedRuntime, signStateRecord, verifyStateRecord, type StateRecord } from "./saat";
import { getLicenseStore, saveStateRecord } from "./store";
import type { MeasuredFingerprint } from "./fingerprint";

/** Derleme varsayılan kipi — Faz 4'e dek GÖZLEM (hiçbir istek engellenmez, bant yok). */
export const DEFAULT_LICENSE_MODE: LicenseMode = "gozlem";
const SNAPSHOT_TTL_MS = 30_000;
/** "Son yoklama başarısız" penceresi (zamanın getirdiği kısıtlamanın ikinci anahtarı). */
export const POLL_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LicenseRuntimeConfig {
  /** Satıcı lisans sunucusu kökü (`LICENSE_SERVER_URL`); yoksa dışarı hiç çıkılmaz. */
  readonly vendorUrl: string | null;
  /** Güven çapası — üretimde `ROOT_PUBLIC_KEYS` (boş doğar ⇒ hiçbir HAK geçerli değil). */
  readonly roots: readonly RootKey[];
}

function readVendorUrl(env: NodeJS.ProcessEnv): string | null {
  const v = env.LICENSE_SERVER_URL?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}

let config: LicenseRuntimeConfig = { vendorUrl: readVendorUrl(process.env), roots: ROOT_PUBLIC_KEYS };
let version = 0;

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

// ── Ölçüm ─────────────────────────────────────────────────────────────────────
let fingerprint: MeasuredFingerprint | null = null;
export function setMeasuredFingerprint(fp: MeasuredFingerprint | null): void {
  fingerprint = fp;
  invalidateLicenseSnapshot();
}
export function getMeasuredFingerprint(): MeasuredFingerprint | null {
  return fingerprint;
}

// ── Yoklama ve zil durumu ───────────────────────────────────────────────────────
export interface PollStatus {
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastFailureCode: string | null;
  readonly nextAttemptAt: number | null;
}
let poll: PollStatus = { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, nextAttemptAt: null };

/** Başarılı yoklama = geçerli YENİ kira alındı; başka her sonuç başarısızdır (protokol §5). */
export function recordPollOutcome(o: { ok: boolean; code?: string; atMs?: number }): void {
  const at = o.atMs ?? Date.now();
  poll = o.ok
    ? { ...poll, lastAttemptAt: at, lastSuccessAt: at }
    : { ...poll, lastAttemptAt: at, lastFailureAt: at, lastFailureCode: o.code ?? "BILINMIYOR" };
  invalidateLicenseSnapshot();
}
export function setNextPollAt(ms: number | null): void {
  poll = { ...poll, nextAttemptAt: ms };
}
export function getPollStatus(): PollStatus {
  return poll;
}

export interface DoorbellStatus {
  readonly connected: boolean;
  readonly lastConnectedAt: number | null;
  readonly lastEventAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly lastErrorCode: string | null;
}
let doorbell: DoorbellStatus = { connected: false, lastConnectedAt: null, lastEventAt: null, lastHeartbeatAt: null, lastErrorCode: null };
export function updateDoorbellStatus(p: Partial<DoorbellStatus>): void {
  doorbell = { ...doorbell, ...p };
}
export function getDoorbellStatus(): DoorbellStatus {
  return doorbell;
}

// ── Gözlem sayaçları (kapı "reddederdim" dediğinde artar; yoklamayla bize gider) ──
let observation = { reddedilecekIstek: 0, reddedilecekModul: 0 };
export function recordObservation(kind: "istek" | "modul"): void {
  if (kind === "istek") observation.reddedilecekIstek++;
  else observation.reddedilecekModul++;
}
export function peekObservationCounters(): { reddedilecekIstek: number; reddedilecekModul: number } {
  return { ...observation };
}
export function resetObservationCounters(): void {
  observation = { reddedilecekIstek: 0, reddedilecekModul: 0 };
}

// ── İndirme belirteçleri (satıcıdan kiraya eşlik eder; Faz 3 istemcileri okur) ───
let downloadTokens: ReadonlyArray<{ yolOneki: string; belirtec: string }> = [];
export function setDownloadTokens(tokens: ReadonlyArray<{ yolOneki: string; belirtec: string }>): void {
  downloadTokens = [...tokens];
}
export function getDownloadTokens(): ReadonlyArray<{ yolOneki: string; belirtec: string }> {
  return downloadTokens;
}

// ── Durum kaydı (monotonik birikim) ─────────────────────────────────────────────
interface Accumulation {
  readonly jws: string;
  readonly installationId: string;
  readonly record: StateRecord | null;
  /** Bu süreçte kayda son dokunulan hrtime — birikim buradan sayılır. */
  readonly baseHrNs: bigint;
}
let accumulation: Accumulation | null = null;

/** Diskteki kaydı (bir kez) doğrular; kurulum kimliği ya da dosya değişince yeniden. */
function currentAccumulation(): Accumulation | null {
  const store = getLicenseStore();
  const installationId = facts.installationId;
  if (!store?.key || !store.stateJws || !installationId) return null;
  if (accumulation && accumulation.jws === store.stateJws && accumulation.installationId === installationId) return accumulation;
  const v = verifyStateRecord(store.stateJws, { publicKeyX: store.key.x, installationId });
  accumulation = { jws: store.stateJws, installationId, record: v.ok ? v.value : null, baseHrNs: process.hrtime.bigint() };
  return accumulation;
}

function elapsedOf(a: Accumulation): number {
  return a.record ? accumulatedRuntime({ storedMs: a.record.birikenMs, loadHrNs: a.baseHrNs, nowHrNs: process.hrtime.bigint() }) : 0;
}

function highWaterOf(record: StateRecord | null, lease: LeaseDoc | null): number {
  return Math.max(
    facts.ledgerHighWaterMs ?? 0,
    record ? isoToMs(record.yuksekSu) : 0,
    lease ? isoToMs(lease.sunucuSaati) : 0,
  );
}

function writeRecord(record: StateRecord): void {
  const store = getLicenseStore();
  if (!store?.key) throw new Error("Lisans deposu hazır değil");
  const jws = signStateRecord(record, store.key.privateKey, store.key.x);
  saveStateRecord(jws);
  accumulation = { jws, installationId: record.kurulumId, record, baseHrNs: process.hrtime.bigint() };
  invalidateLicenseSnapshot();
}

/**
 * Birikimi diske yazar (saatlik + kapanışta). YALNIZ geçerli kayıt kullanılabilir kiraya
 * aitse: bozuk/silinmiş kayıt aynı kira için sıfırdan BAŞLATILMAZ (saat hilesini açardı).
 */
export function persistAccumulation(nowMs: number = Date.now()): boolean {
  const a = currentAccumulation();
  const lease = getLicenseSnapshot(nowMs).lease?.document ?? null;
  if (!a?.record || !lease || a.record.kiraId !== lease.kiraId) return false;
  writeRecord({
    ...a.record,
    birikenMs: elapsedOf(a),
    yazildi: msToIso(nowMs),
    yuksekSu: msToIso(highWaterOf(a.record, lease)),
    sira: a.record.sira + 1,
  });
  return true;
}

/** Yeni kira kabul edildi: birikim sıfırdan, kira kararları (kip + yaptırım) kalıcı iz olarak. */
export function startAccumulationForLease(lease: LeaseDoc, nowMs: number = Date.now()): void {
  if (!facts.installationId) throw new Error("Kurulum kimliği hazır değil");
  const prev = currentAccumulation()?.record ?? null;
  writeRecord({
    v: 1,
    kurulumId: facts.installationId,
    kiraId: lease.kiraId,
    birikenMs: 0,
    yazildi: msToIso(nowMs),
    yuksekSu: msToIso(highWaterOf(prev, lease)),
    sonKiraZorlamasi: lease.zorlama,
    sonYaptirim: sanctionSnapshotOf(lease),
    sira: prev ? prev.sira + 1 : 0,
  });
}

// ── Anlık görüntü ───────────────────────────────────────────────────────────────
export interface LicenseSnapshot {
  /** Kurulum kimliği ve depo hazır mı — değilse durum yalnız bilgi amaçlıdır. */
  readonly hazir: boolean;
  readonly state: LicenseState;
  /** Kullanılabilir (bu kuruluma bağlı, doğrulanmış) belgeler. */
  readonly entitlement: VerifiedEntitlement | null;
  readonly lease: VerifiedLease | null;
  readonly fingerprintDecision: FingerprintDecision | null;
  readonly durumKaydi: { readonly gecerli: boolean; readonly sira: number | null };
  readonly computedAtMs: number;
}

let cached: { snap: LicenseSnapshot; version: number } | null = null;

export function invalidateLicenseSnapshot(): void {
  version++;
}

function buildInput(nowMs: number): { input: LicenseStateInput; entitlement: VerifiedEntitlement | null; lease: VerifiedLease | null; decision: FingerprintDecision | null; record: StateRecord | null } {
  const store = getLicenseStore();
  const docs = verifyLicenseDocuments({
    entitlementJws: store?.entitlementJws ?? null,
    leaseJws: store?.leaseJws ?? null,
    roots: config.roots,
  });
  const a = currentAccumulation();
  const record = a?.record ?? null;
  const base: LicenseStateInput = {
    kurulumId: facts.installationId,
    kurulumAnahtarKimligi: store?.key?.kid ?? null,
    hak: docs.hak,
    kira: docs.kira,
    saat: {
      duvarMs: nowMs,
      yuksekSuMs: 0,
      monotonik: a && record ? { kiraId: record.kiraId, gecenMs: elapsedOf(a) } : null,
      durumDosyasiGecerli: record !== null,
    },
    parmakIziEslesme: "OLCULEMEDI",
    butunluk: "KAPSAM_DISI",
    derlemeTarihiMs: null,
    ilkAcilisMs: facts.firstOpenMs,
    sonYoklamaBasarisizMi: pollFailedRecently(nowMs),
    varsayilanKip: DEFAULT_LICENSE_MODE,
    sonKiraZorlamasi: record?.sonKiraZorlamasi ?? null,
    sonYaptirim: record?.sonYaptirim ?? null,
  };
  // Kullanılabilirlik kararı durumun KENDİ kurallarından (tek kaynak); bulgular burada atılır.
  const scratch: Finding[] = [];
  const entitlement = evaluateEntitlement(base, scratch);
  const lease = evaluateLease(base, entitlement, scratch);
  const decision =
    lease && fingerprint
      ? compareFingerprints(lease.document.parmakIzi, fingerprint.digest, { excludeF5: entitlement?.document.sinif === "DR" })
      : null;
  const input: LicenseStateInput = {
    ...base,
    saat: { ...base.saat, yuksekSuMs: highWaterOf(record, null) },
    parmakIziEslesme: decision?.result ?? "OLCULEMEDI",
  };
  return { input, entitlement, lease, decision, record };
}

/** Kurulum hiç etkinleşmemişse (ya da kullanılabilir kira yoksa) yoklama yapılamaz ⇒ başarısız sayılır. */
export function pollFailedRecently(nowMs: number): boolean {
  const store = getLicenseStore();
  if (!store?.leaseJws) return true;
  const failed = poll.lastFailureAt;
  if (failed === null || nowMs - failed > POLL_FAILURE_WINDOW_MS) return false;
  return poll.lastSuccessAt === null || poll.lastSuccessAt < failed;
}

/** Senkron, önbellekli (30 sn ya da herhangi bir girdi değişene dek). */
export function getLicenseSnapshot(nowMs: number = Date.now()): LicenseSnapshot {
  if (cached && cached.version === version && nowMs - cached.snap.computedAtMs < SNAPSHOT_TTL_MS && nowMs >= cached.snap.computedAtMs) {
    return cached.snap;
  }
  const { input, entitlement, lease, decision, record } = buildInput(nowMs);
  const store = getLicenseStore();
  const snap: LicenseSnapshot = {
    hazir: Boolean(store && !store.problem && store.key && facts.installationId),
    state: computeLicenseState(input),
    entitlement,
    lease,
    fingerprintDecision: decision,
    durumKaydi: { gecerli: record !== null, sira: record?.sira ?? null },
    computedAtMs: nowMs,
  };
  cached = { snap, version };
  return snap;
}

/** `/api/admin/health` lisans bloğu — durum ÖZETİ (belge içeriği ve anahtar yok). */
export function licenseHealthBlock(): Record<string, unknown> {
  try {
    const snap = getLicenseSnapshot();
    const poll = getPollStatus();
    const bell = getDoorbellStatus();
    const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
    return {
      hazir: snap.hazir,
      kip: snap.state.kip,
      gecerlilik: snap.state.gecerlilik,
      hesaplananKademe: snap.state.hesaplananKademe,
      uygulananKademe: snap.state.uygulananKademe,
      nedenler: snap.state.nedenler.map((n) => n.kod),
      sonYoklama: iso(poll.lastAttemptAt),
      sonBasariliYoklama: iso(poll.lastSuccessAt),
      zilBagli: bell.connected,
    };
  } catch {
    return { hazir: false };
  }
}

/** Test-only: bellek durumunu sıfırlar. */
export function __resetLicenseRuntimeForTests(): void {
  facts = { installationId: null, firstOpenMs: null, ledgerHighWaterMs: null };
  fingerprint = null;
  poll = { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, nextAttemptAt: null };
  doorbell = { connected: false, lastConnectedAt: null, lastEventAt: null, lastHeartbeatAt: null, lastErrorCode: null };
  observation = { reddedilecekIstek: 0, reddedilecekModul: 0 };
  downloadTokens = [];
  accumulation = null;
  cached = null;
  version++;
}
