// Sunucu kesintisi — sunucu güncellemesinden önce ekran şeridi + kesintide istek bekletme (saf, bağımlılıksız).
// Bu dosya Electron · mobil `src/lib/sunucu-kesintisi.ts` olarak BAYT-EŞİT durur; değişiklik Electron'da yapılır,
// sonra `cp -p` (bekçi: Teks-Erp/scripts/test_sunucu_kesintisi.ts). Bekletme yalnız GÖNDERİLMEMİŞ isteği tutar;
// gönderilip yanıtsız kalan isteğin işlem kimliği yapışır (mevcut kural) — bağlantı gelince yeniden kayıt çift olmaz.

/** `GET /api/guncelleme/ozet` → `kesinti` (backend `plannedOutage`). */
export interface OutageNotice {
  readonly planlanan: string | null;
  readonly kalanSn: number;
  readonly suruyor: boolean;
}

/** Ekranların uyarmaya başladığı eşik — backend ön duyurusuyla (`UPDATE_APPROVAL_NOTICE_MS`) aynı. */
export const OUTAGE_NOTICE_SECONDS = 300;
/** Planlanan an bu kadar geçtiyse duyuru bayattır — backend `UPDATE_OUTAGE_STALE_MS`. */
export const OUTAGE_STALE_SECONDS = 900;
/** Kesintide bir isteğin en uzun bekletilmesi; sonra istek normal yoluna (hata) bırakılır. */
export const REQUEST_HOLD_MAX_MS = 3 * 60 * 1000;
/** Bekletme sırasında sunucu sağlık yoklamasının aralığı. */
export const HEALTH_PROBE_INTERVAL_MS = 3000;
/** `/ozet` yoklama aralığı. */
export const OUTAGE_POLL_MS = 30_000;

export const OUTAGE_TEXT_ONGOING = "Sunucu güncelleniyor, yeniden bağlanıyor…";
export const OUTAGE_TEXT_SOON = "Sunucu birazdan yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin";

/** Yerel saate çevrilmiş hedef: `kalanSn` + yanıtın alındığı an (sunucu/istemci saat farkı etkilemez). */
export interface OutageTarget {
  readonly atMs: number;
  readonly ongoing: boolean;
}

export function outageTarget(notice: OutageNotice | null | undefined, receivedAtMs: number): OutageTarget | null {
  if (!notice) return null;
  return { atMs: receivedAtMs + Math.max(0, notice.kalanSn) * 1000, ongoing: notice.suruyor };
}

/** Duyuru etkin: hedefe 5 dk ya da daha az kaldı (ya da sürüyor) ve hedef 15 dk'dan fazla geçmedi. */
export function noticeActive(target: OutageTarget | null, nowMs: number): boolean {
  if (!target) return false;
  const left = target.atMs - nowMs;
  return left <= OUTAGE_NOTICE_SECONDS * 1000 && -left <= OUTAGE_STALE_SECONDS * 1000;
}

export interface OutageStrip {
  readonly kind: "warning" | "outage";
  readonly text: string;
}

/** Şerit: sunucuya ulaşılamıyorsa "güncelleniyor", değilse kalan dakikayla uyarı; duyuru yoksa null. */
export function outageStrip(target: OutageTarget | null, nowMs: number, unreachable: boolean): OutageStrip | null {
  if (!target || !noticeActive(target, nowMs)) return null;
  if (unreachable) return { kind: "outage", text: OUTAGE_TEXT_ONGOING };
  const left = target.atMs - nowMs;
  if (target.ongoing || left < 60_000) return { kind: "warning", text: OUTAGE_TEXT_SOON };
  const minutes = Math.ceil(left / 60_000);
  return { kind: "warning", text: `Sunucu ${minutes} dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin` };
}

/** İstek bekletilsin mi: duyuru etkin VE sunucu yanıtsız (duyuru yokken her kesinti normal hata yolundadır). */
export function shouldHoldRequests(target: OutageTarget | null, nowMs: number, unreachable: boolean): boolean {
  return unreachable && noticeActive(target, nowMs);
}

let current: OutageTarget | null = null;
const listeners = new Set<() => void>();

/** `/ozet` yoklamasının yazdığı tek kaynak (useSyncExternalStore uyumlu). */
export function setOutageTarget(target: OutageTarget | null): void {
  if (current?.atMs === target?.atMs && current?.ongoing === target?.ongoing) return;
  current = target;
  for (const l of listeners) l();
}

export function getOutageTarget(): OutageTarget | null {
  return current;
}

export function subscribeOutage(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export interface RequestHoldDeps {
  /** Sunucu şu an yanıtsız mı (istemcinin kendi ulaşılabilirlik sinyali). */
  readonly unreachable: () => boolean;
  /** Tek sağlık yoklaması: sunucu yanıt verdiyse true. */
  readonly probeHealth: () => Promise<boolean>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * İstek öncesi bekletici: duyuru etkinken sunucu yanıtsızsa istek GÖNDERİLMEDEN bağlantı beklenir (en çok
 * `REQUEST_HOLD_MAX_MS`). Aynı anda bekleyen istekler tek sağlık döngüsünü paylaşır; süre dolan hedef için bir daha
 * bekletilmez. Sağlık yoklamasının kendisi bekletilmez.
 */
export function createRequestHold(deps: RequestHoldDeps): (url: string | undefined) => Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let inflight: Promise<void> | null = null;
  let exhausted: OutageTarget | null = null;
  const waitForServer = async (target: OutageTarget): Promise<void> => {
    const start = now();
    for (;;) {
      if (!deps.unreachable()) return;
      if (await deps.probeHealth().catch(() => false)) return;
      if (now() - start >= REQUEST_HOLD_MAX_MS) {
        exhausted = target;
        return;
      }
      await sleep(HEALTH_PROBE_INTERVAL_MS);
    }
  };
  return async (url) => {
    if (url && url.includes("/health")) return;
    const target = current;
    if (!target || target === exhausted || !shouldHoldRequests(target, now(), deps.unreachable())) return;
    if (!inflight) {
      inflight = waitForServer(target).finally(() => {
        inflight = null;
      });
    }
    await inflight;
  };
}
