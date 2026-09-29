// Lisans motorunun BELLEK SİNYALLERİ: yoklama/zil/motor durumu, satıcı saati sapması, gözlem
// sayaçları, indirme belirteçleri ve anlık görüntü sürümü. Başka lisans modülünü İMPORT ETMEZ —
// hem `runtime.ts` hem durum kaydı katmanı buradan okur (döngü doğmasın).

// ── Anlık görüntü sürümü: herhangi bir girdi değişince artar, önbellek bayatlar ──
let version = 0;
export function bumpLicenseSnapshotVersion(): void {
  version++;
}
export function licenseSnapshotVersion(): number {
  return version;
}

// ── Yoklama ve zil durumu ───────────────────────────────────────────────────────
/** "Son yoklama başarısız" penceresi (zamanın getirdiği kısıtlamanın ikinci anahtarı). */
export const POLL_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PollStatus {
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastFailureCode: string | null;
  readonly nextAttemptAt: number | null;
}
const EMPTY_POLL: PollStatus = { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, nextAttemptAt: null };
let poll: PollStatus = EMPTY_POLL;

/** Başarılı yoklama = geçerli YENİ kira alındı; başka her sonuç başarısızdır (protokol §5). */
export function recordPollOutcome(o: { ok: boolean; code?: string; atMs?: number }): void {
  const at = o.atMs ?? Date.now();
  poll = o.ok
    ? { ...poll, lastAttemptAt: at, lastSuccessAt: at }
    : { ...poll, lastAttemptAt: at, lastFailureAt: at, lastFailureCode: o.code ?? "BILINMIYOR" };
  version++;
}
export function setNextPollAt(ms: number | null): void {
  poll = { ...poll, nextAttemptAt: ms };
}
export function getPollStatus(): PollStatus {
  return poll;
}

/**
 * Son 24 saatte GERÇEK bir yoklama denemesi başarısız oldu mu (ve sonra başarı yok mu)? Kira
 * dosyasının yokluğu tek başına başarısızlık DEĞİLDİR: iki anahtarın ikincisi yalnız denemeyle doğar.
 */
export function pollFailedRecently(nowMs: number): boolean {
  const failed = poll.lastFailureAt;
  if (failed === null || nowMs - failed > POLL_FAILURE_WINDOW_MS) return false;
  return poll.lastSuccessAt === null || poll.lastSuccessAt < failed;
}

export interface DoorbellStatus {
  readonly connected: boolean;
  readonly lastConnectedAt: number | null;
  readonly lastEventAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly lastErrorCode: string | null;
}
const EMPTY_DOORBELL: DoorbellStatus = { connected: false, lastConnectedAt: null, lastEventAt: null, lastHeartbeatAt: null, lastErrorCode: null };
let doorbell: DoorbellStatus = EMPTY_DOORBELL;
export function updateDoorbellStatus(p: Partial<DoorbellStatus>): void {
  doorbell = { ...doorbell, ...p };
}
export function getDoorbellStatus(): DoorbellStatus {
  return doorbell;
}

// ── Motor durumu (sağlık ucu "başlamadı / çalışıyor" der) ───────────────────────
export type LicenseEngineState = "BASLAMADI" | "BASLIYOR" | "CALISIYOR" | "DURDU";
export interface LicenseEngineStatus {
  readonly durum: LicenseEngineState;
  /** Başlamadıysa neden (kod): `KIMLIK_YOK` · `DB_OLGULARI` … */
  readonly neden: string | null;
  readonly sonDeneme: number | null;
}
let engine: LicenseEngineStatus = { durum: "BASLAMADI", neden: null, sonDeneme: null };
export function setLicenseEngineStatus(durum: LicenseEngineState, neden: string | null = null): void {
  engine = { durum, neden, sonDeneme: Date.now() };
}
export function getLicenseEngineStatus(): LicenseEngineStatus {
  return engine;
}

// ── Satıcı saati sapması (D4: İMZASIZ bilgi — güvenilir saate/kademeye girmez) ──
/** `known`: bu süreçte ölçüldü (ya da tutarlı bulundu); değilse durum kaydındaki son değer okunur. */
let vendorSkew: { readonly ms: number | null; readonly known: boolean } = { ms: null, known: false };

/** `ms` = duvar − satıcı; null = satıcı düzeltmesiz isteği kabul etti (saat tutarlı). */
export function recordVendorClockSkew(ms: number | null): void {
  vendorSkew = { ms: ms === null ? null : Math.round(ms), known: true };
  version++;
}
export function peekVendorClockSkew(): { readonly ms: number | null; readonly known: boolean } {
  return vendorSkew;
}

// ── Gözlem sayaçları (kapı "reddederdim" dediğinde artar; yoklamayla bize gider) ──
let observation = { reddedilecekIstek: 0, reddedilecekModul: 0 };
export function recordObservation(kind: "istek" | "modul"): void {
  if (kind === "istek") observation.reddedilecekIstek++;
  else observation.reddedilecekModul++;
}

/** İstek bağlamı yoksa (iş, betik) aynı modül bu pencerede bir kez sayılır. */
const MODULE_OBSERVATION_WINDOW_MS = 60_000;
const MODULE_OBSERVATION_MEMORY = 1024;
const seenModuleObservations = new Map<string, number>();

/**
 * Modül okuyucusu bir istekte defalarca çağrılır: "reddederdim" sayacı ÇAĞRI değil İSTEK × modül
 * başına artar (istek bağlamı yoksa modül × dakika). Sayıldıysa true.
 */
export function recordModuleObservation(settingKey: string, requestId: string | null, nowMs: number = Date.now()): boolean {
  const key = requestId ? `r:${requestId}:${settingKey}` : `p:${Math.floor(nowMs / MODULE_OBSERVATION_WINDOW_MS)}:${settingKey}`;
  if (seenModuleObservations.has(key)) return false;
  if (seenModuleObservations.size >= MODULE_OBSERVATION_MEMORY) {
    for (const [k, at] of seenModuleObservations) if (nowMs - at > 5 * MODULE_OBSERVATION_WINDOW_MS) seenModuleObservations.delete(k);
    if (seenModuleObservations.size >= MODULE_OBSERVATION_MEMORY) seenModuleObservations.clear();
  }
  seenModuleObservations.set(key, nowMs);
  recordObservation("modul");
  return true;
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

/** İstemci belirteç isteğinin yoklamayı dürtmesi en çok bu aralıkla (satıcıyı istemci sayısıyla dövmemek). */
export const DOWNLOAD_TOKEN_NUDGE_GAP_MS = 5 * 60 * 1000;
let downloadTokenNudge: (() => void) | null = null;
let lastDownloadTokenNudgeAt = Number.NEGATIVE_INFINITY;
/** Yoklama işi kaydeder (servis işi içe aktarmaz). */
export function onDownloadTokenStale(fn: () => void): void {
  downloadTokenNudge = fn;
}
/** Belirteç yok ya da dolmak üzere: yoklamayı dürt (kısıtlı). Dürtüldüyse true. */
export function requestDownloadTokenRefresh(nowMs: number = Date.now()): boolean {
  if (!downloadTokenNudge || nowMs - lastDownloadTokenNudgeAt < DOWNLOAD_TOKEN_NUDGE_GAP_MS) return false;
  lastDownloadTokenNudgeAt = nowMs;
  downloadTokenNudge();
  return true;
}

/** Test-only: sinyalleri sıfırlar. */
export function __resetLicenseSignalsForTests(): void {
  poll = EMPTY_POLL;
  doorbell = EMPTY_DOORBELL;
  engine = { durum: "BASLAMADI", neden: null, sonDeneme: null };
  vendorSkew = { ms: null, known: false };
  observation = { reddedilecekIstek: 0, reddedilecekModul: 0 };
  seenModuleObservations.clear();
  downloadTokens = [];
  downloadTokenNudge = null;
  lastDownloadTokenNudgeAt = Number.NEGATIVE_INFINITY;
  version++;
}
