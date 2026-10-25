// =============================================================================
// BİLDİRİM ZİL HUB'I — içeriksiz SSE "kapı zili" + uzun yoklama (plan §3.9)
// =============================================================================
// Zil yalnız "kutun değişti / alarm değişti" der ve sürüm sayacını taşır; içerik HER ZAMAN REST'ten
// okunur (yetki süzgeci orada). Sürüm: süreç `epoch` (açılış damgası) + kullanıcı başı `rev`/`alarmRev`
// (bellek) — epoch değişince istemci tam yeniden çeker. Tavanlar: kullanıcı başı 5 akış (6.'da EN ESKİ
// kapanır), genel 500 (aşımda 503 `BILDIRIM_ZIL_DOLU`). Akış başına 25 sn `: ping`, 60 sn'de oturum
// yeniden doğrulaması, 30 dk ömür. Kapanışta `closeAll()` dinleyiciler kapanmadan ÖNCE çağrılır
// (açık akış server.close'u bekletip 5 sn zorla çıkışa yol açardı). Tek süreç (server.ts TEK-PROCESS).
// =============================================================================
import type { Response } from "express";
import { AppError } from "../utils/app-error";
import { uyari } from "../lib/logger";
import { setNotificationDeliveredHook } from "./notification-dispatch.service";

export type BellKind = "kutu" | "alarm";
export type BellCloseReason = "yetki" | "oturum" | "lifetime" | "kapanis" | "fazla";

export const BELL_PER_USER_LIMIT = 5;
export const BELL_GLOBAL_LIMIT = 500;
export const LONG_POLL_MAX_MS = 25_000;

/** Aralıklar ortamdan okunabilir: bekçi ping/doğrulama/ömrü kısaltır (üretimde ayarlanmaz). */
function envMs(env: string, def: number): number {
  const n = Number(process.env[env]);
  return Number.isFinite(n) && n > 0 ? n : def;
}
const pingMs = () => envMs("TEKSERP_BILDIRIM_ZIL_PING_MS", 25_000);
const revalidateMs = () => envMs("TEKSERP_BILDIRIM_ZIL_DOGRULAMA_MS", 60_000);
const lifetimeMs = () => envMs("TEKSERP_BILDIRIM_ZIL_OMUR_MS", 30 * 60_000);

export interface BellVersion {
  epoch: number;
  rev: number;
  alarmRev: number;
}

interface Subscriber {
  no: number;
  userId: string;
  res: Response;
  timers: NodeJS.Timeout[];
  done: boolean;
}

const EPOCH = Date.now();
let seq = 0;
let closing = false;
const versions = new Map<string, { rev: number; alarmRev: number }>();
const subscribers = new Map<string, Subscriber[]>();
let total = 0;
const waiters = new Map<string, Set<() => void>>();
let waiterCount = 0;

export function bellVersion(userId: string): BellVersion {
  const s = versions.get(userId);
  return { epoch: EPOCH, rev: s?.rev ?? 0, alarmRev: s?.alarmRev ?? 0 };
}

function sendEvent(a: Subscriber, ad: string, data: unknown): void {
  if (a.done) return;
  a.res.write(`event: ${ad}\ndata: ${JSON.stringify(data)}\n\n`);
}

function release(a: Subscriber): void {
  if (a.done) return;
  a.done = true;
  for (const t of a.timers) clearTimeout(t);
  const list = subscribers.get(a.userId);
  if (list) {
    const rest = list.filter((x) => x !== a);
    if (rest.length) subscribers.set(a.userId, rest);
    else subscribers.delete(a.userId);
  }
  total -= 1;
}

function terminate(a: Subscriber, neden: BellCloseReason): void {
  if (a.done) return;
  try {
    sendEvent(a, "kapat", { neden });
    release(a);
    a.res.end();
  } catch {
    release(a);
  }
}

function wake(userId: string): void {
  const s = waiters.get(userId);
  if (!s) return;
  waiters.delete(userId);
  for (const f of s) f();
}

/**
 * Akış aç: başlıkları yazar, `merhaba` gönderir. Genel tavan doluysa (ve kullanıcının kendi eski akışı
 * yer açmıyorsa) başlık YAZILMADAN 503 fırlatır. `dogrula` false dönerse akış kapanır; hata atarsa
 * (DB erişilemiyor) akış sürer — zil içeriksizdir, oturum kararı bir sonraki REST isteğinde zaten verilir.
 */
export function subscribe(userId: string, res: Response, dogrula: () => Promise<boolean>): void {
  if (closing) throw new AppError("Sunucu kapanıyor.", 503, true, { code: "BILDIRIM_ZIL_KAPANIYOR" });
  const existing = subscribers.get(userId) ?? [];
  const freesSlot = existing.length >= BELL_PER_USER_LIMIT;
  if (!freesSlot && total >= BELL_GLOBAL_LIMIT) {
    throw new AppError("Zil bağlantı tavanı dolu; biraz sonra yeniden deneyin.", 503, true, { code: "BILDIRIM_ZIL_DOLU" });
  }
  // Kullanıcı başı tavan: en eski akış kapanır (çok sekmede next sekme çalışır, eskisi yoklamaya düşer).
  while ((subscribers.get(userId)?.length ?? 0) >= BELL_PER_USER_LIMIT) {
    terminate(subscribers.get(userId)![0]!, "fazla");
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  // no-transform: sıkıştırma ve ara vekiller akışı tamponlamasın (plan §3.9 tuzak 1).
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const a: Subscriber = { no: ++seq, userId, res, timers: [], done: false };
  subscribers.set(userId, [...(subscribers.get(userId) ?? []), a]);
  total += 1;
  res.on("close", () => release(a));

  const ping = setInterval(() => {
    if (!a.done) a.res.write(": ping\n\n");
  }, pingMs());
  const revalidate = setInterval(() => {
    void dogrula().then(
      (valid) => {
        if (!valid) terminate(a, "oturum");
      },
      (err: unknown) => uyari("bildirim", "zil oturum doğrulaması yapılamadı — akış sürüyor", err),
    );
  }, revalidateMs());
  const lifetime = setTimeout(() => terminate(a, "lifetime"), lifetimeMs());
  for (const t of [ping, revalidate, lifetime]) t.unref();
  a.timers.push(ping, revalidate, lifetime);

  sendEvent(a, "merhaba", bellVersion(userId));
}

/** Kutusu (ya da alarmı) değişen kullanıcılara içeriksiz zil; uzun yoklamaları uyandırır. */
export function ring(userIds: readonly string[], k: BellKind = "kutu"): void {
  for (const userId of new Set(userIds)) {
    const s = versions.get(userId) ?? { rev: 0, alarmRev: 0 };
    if (k === "alarm") s.alarmRev += 1;
    else s.rev += 1;
    versions.set(userId, s);
    const data = { k, rev: s.rev, alarmRev: s.alarmRev };
    for (const a of subscribers.get(userId) ?? []) {
      try {
        sendEvent(a, "zil", data);
      } catch (err) {
        uyari("bildirim", "zil yazılamadı", err);
      }
    }
    wake(userId);
  }
}

/** Kullanıcının bütün akışlarını kapatır (yetki değişti → istemci yeniden bağlanıp next kümeyle okur). */
export function closeUser(userId: string, neden: BellCloseReason): void {
  for (const a of [...(subscribers.get(userId) ?? [])]) terminate(a, neden);
  wake(userId);
}

/** Kapanış: bütün akışlar biter, bekleyen uzun yoklamalar hemen döner; next abone 503. */
export function closeAll(): number {
  closing = true;
  const everyone = [...subscribers.values()].flat();
  for (const a of everyone) terminate(a, "kapanis");
  for (const userId of [...waiters.keys()]) wake(userId);
  return everyone.length;
}

/**
 * Uzun yoklama (SSE kurulamayan istemci): istemcinin bildiği sürüm güncelse ≤25 sn bekler, zil gelince
 * hemen döner. `onCancel` istek kapanınca çağrılır (bekleyen bırakılır). Tavan zil ile ortak genel tavandır.
 */
export function waitForChange(
  userId: string,
  known: { rev?: number; alarmRev?: number; epoch?: number },
  onCancel: (release: () => void) => void,
  timeoutMs: number = LONG_POLL_MAX_MS,
): Promise<BellVersion & { degisti: boolean }> {
  const current = bellVersion(userId);
  const stale = (known.epoch !== undefined && known.epoch !== EPOCH)
    || (known.rev !== undefined && known.rev !== current.rev)
    || (known.alarmRev !== undefined && known.alarmRev !== current.alarmRev);
  if (stale || closing) return Promise.resolve({ ...current, degisti: stale });
  if (total + waiterCount >= BELL_GLOBAL_LIMIT) {
    return Promise.reject(new AppError("Zil bağlantı tavanı dolu; biraz sonra yeniden deneyin.", 503, true, { code: "BILDIRIM_ZIL_DOLU" }));
  }
  return new Promise((resolve) => {
    let done = false;
    const set = waiters.get(userId) ?? new Set<() => void>();
    waiters.set(userId, set);
    waiterCount += 1;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(t);
      set.delete(finish);
      if (set.size === 0 && waiters.get(userId) === set) waiters.delete(userId);
      waiterCount -= 1;
      const next = bellVersion(userId);
      resolve({ ...next, degisti: next.rev !== current.rev || next.alarmRev !== current.alarmRev });
    };
    const t = setTimeout(finish, Math.min(Math.max(timeoutMs, 0), LONG_POLL_MAX_MS));
    t.unref();
    set.add(finish);
    onCancel(finish);
  });
}

/** YALNIZ BEKÇİ — sayaçlar. */
export function bellHubStateForTest(): { total: number; perUser: Record<string, number>; bekleyen: number; closing: boolean } {
  const perUser: Record<string, number> = {};
  for (const [u, l] of subscribers) perUser[u] = l.length;
  return { total, perUser, bekleyen: waiterCount, closing };
}

/** YALNIZ BEKÇİ — kapanış ölçümünden sonra hub'ı yeniden kabul kipine alır. */
export function bellHubResetForTest(): void {
  closing = false;
}

// Dağıtıcı turu commit olduktan sonra kutusu değişen kullanıcılarla çağırır (N1-MOTOR kancası).
setNotificationDeliveredHook((userIds, alarmUserIds) => {
  ring(userIds, "kutu");
  ring(alarmUserIds, "alarm");
});
