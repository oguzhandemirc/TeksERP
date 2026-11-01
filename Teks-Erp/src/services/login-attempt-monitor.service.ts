// =============================================================================
// Parola girişi gözlemi — hesap başına yumuşak kova + uyarı + LOGIN_FAILED özeti (VDS denetimi Y2 + D4)
// =============================================================================
// Yalnız internete açık kurulumda etkin (`isInternetFacingInstallation`); LAN'da her fonksiyon bugünkü
// davranışı verir (kova yok, her hata ayrı LOGIN_FAILED satırı). Çağıranlar: parola girişi ve yerinde onay.
// =============================================================================
import type { Request } from "express";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { uyari } from "../lib/logger";
import { AuditService } from "./audit.service";
import { emitSuspiciousLogin } from "./notification-sources/kimlik";
import {
  accountSourceOf,
  accountThrottleWaitSec,
  isInternetFacingInstallation,
  noteAccountFailure,
  noteAccountSuccess,
} from "../middlewares/account-soft-throttle";

/** Eşik üstünde tanınmayan kaynaktan deneme → 429 LOGIN_THROTTLED (bcrypt'ten ÖNCE çağrılır); geçerse null. */
export function accountThrottleError(req: Request, username: string): { error: AppError; retryAfterSec: number } | null {
  if (!isInternetFacingInstallation()) return null;
  const wait = accountThrottleWaitSec(username, accountSourceOf(req));
  if (wait <= 0) return null;
  return {
    retryAfterSec: wait,
    error: AppError.tooManyRequests(
      `Bu hesaba çok sayıda hatalı giriş denemesi yapıldı. ${wait} saniye sonra tekrar deneyin.`,
      { code: "LOGIN_THROTTLED", retryAfterSec: wait },
    ),
  };
}

/** Hatalı parola: sayaç + gerekirse sahibe ve kullanıcı yöneticilerine uyarı (best-effort, isteği bekletmez). */
export function recordAccountFailure(req: Request, username: string): void {
  if (!isInternetFacingInstallation()) return;
  const r = noteAccountFailure(username, accountSourceOf(req));
  if (r.alert) void notifySuspiciousLogin(username, r.failCount, r.sourceCount);
}

/** Başarılı giriş: kaynak bu hesap için tanınır (sonraki yoğun saldırıda beklemez). */
export function recordAccountSuccess(req: Request, username: string): void {
  if (!isInternetFacingInstallation()) return;
  noteAccountSuccess(username, accountSourceOf(req));
}

async function notifySuspiciousLogin(username: string, failCount: number, sourceCount: number): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true, fullName: true, username: true } });
    if (!user) return; // var olmayan ad: uyarılacak sahip yok (kova yine işler — ad keşfi farkı doğmaz)
    await prisma.$transaction((tx) =>
      emitSuspiciousLogin(tx, {
        userId: user.id,
        displayName: user.fullName?.trim() || user.username,
        failCount,
        sourceCount,
        at: new Date(),
      }),
    );
  } catch (err) {
    uyari("login-monitor", "şüpheli giriş uyarısı yazılamadı:", err instanceof Error ? err.message : err);
  }
}

// ─── D4: LOGIN_FAILED kullanıcı + IP başına dakikalık özet ───────────────────────────────────────
const SUMMARY_WINDOW_MS = 60_000;
const MAX_SUMMARY_KEYS = 5000;
type SummaryEntry = { username: string; ip: string | null; windowStart: number; suppressed: number; lastReason: string };
const summaries = new Map<string, SummaryEntry>();
let summaryTimer: NodeJS.Timeout | null = null;

/**
 * Bu hata için LOGIN_FAILED satırı şimdi yazılsın mı. İnternete açık kurulumda aynı kullanıcı + IP için
 * dakikada İLK hata yazılır; kalanlar sayılır ve pencere kapanınca tek özet satırı (`suppressedCount`) düşer.
 */
export function shouldWriteLoginFailure(username: string, ip: string | null, reason: string, now = Date.now()): boolean {
  if (!isInternetFacingInstallation()) return true;
  const key = `${username.trim().toLowerCase().slice(0, 80)}|${ip ?? "-"}`;
  const e = summaries.get(key);
  if (e && now - e.windowStart < SUMMARY_WINDOW_MS) {
    e.suppressed += 1;
    e.lastReason = reason;
    ensureSummaryTimer();
    return false;
  }
  if (e) flushSummary(key, e);
  if (summaries.size >= MAX_SUMMARY_KEYS) flushLoginFailureSummaries(Number.POSITIVE_INFINITY);
  summaries.set(key, { username, ip, windowStart: now, suppressed: 0, lastReason: reason });
  ensureSummaryTimer();
  return true;
}

function flushSummary(key: string, e: SummaryEntry): void {
  summaries.delete(key);
  if (e.suppressed === 0) return;
  void AuditService.logEvent({
    category: "AUTH",
    action: "LOGIN_FAILED",
    recordId: e.username,
    ipAddress: e.ip,
    payload: { summary: true, suppressedCount: e.suppressed, windowSec: SUMMARY_WINDOW_MS / 1000, reason: e.lastReason },
  });
}

/** Penceresi kapanan özetleri yazar (zamanlayıcı · bekçi); `now=∞` hepsini boşaltır. */
export function flushLoginFailureSummaries(now = Date.now()): void {
  for (const [key, e] of summaries) {
    if (now - e.windowStart >= SUMMARY_WINDOW_MS) flushSummary(key, e);
  }
}

function ensureSummaryTimer(): void {
  if (summaryTimer) return;
  summaryTimer = setInterval(() => {
    flushLoginFailureSummaries();
    if (summaries.size === 0 && summaryTimer) {
      clearInterval(summaryTimer);
      summaryTimer = null;
    }
  }, SUMMARY_WINDOW_MS / 2);
  summaryTimer.unref();
}
