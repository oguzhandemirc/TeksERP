// =============================================================================
// Hesap başına YUMUŞAK kova (VDS denetimi Y2, 2026-11-01)
// =============================================================================
// Dağıtık tahmin (her denemede yeni IP / IPv6 /64) IP kovalarına hiç takılmaz. Kullanıcı adı başına,
// IP'den BAĞIMSIZ sayaç: son 1 saatte SOFT_THRESHOLD hatadan sonra TANINMAYAN kaynaktan gelen her deneme
// kademeli bekleme ister (2^n sn, en çok MAX_DELAY_SEC) → 429 LOGIN_THROTTLED, bcrypt'e inmeden.
// SERT KİLİT YOK: dışarıdan hesap kilitleme DoS'u doğmasın. Bu hesaba son 30 günde başarıyla giriş yapmış
// kaynak (kanıtlı cihaz ya da aynı IP /64) beklemeden geçer — fabrika NAT'ı ve sahibin cihazı etkilenmez.
// Yalnız internete açık kurulumda (barındırılan sınıf ∨ kenar başlığı); LAN bayt-aynı. Bellek-içi (tek süreç).
// =============================================================================
import type { Request } from "express";
import { readWebHardeningConfig, resolveClientIp } from "./web-hardening";
import { isHostedInstallation } from "../services/helpers/install-class.helper";
import "../types/express-augment";

export const ACCOUNT_SOFT_THRESHOLD = 10;
export const ACCOUNT_ALERT_THRESHOLD = 50;
export const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
export const ACCOUNT_MAX_DELAY_SEC = 60;
const KNOWN_SOURCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KNOWN_SOURCES = 16;
const MAX_ACCOUNTS = 20_000;

type AccountEntry = {
  fails: number[];
  sources: Set<string>;
  known: Map<string, number>;
  alertedAt: number;
};

const accounts = new Map<string, AccountEntry>();

/** İnternete açık kurulum mu: kenar başlığı beyanlı ya da barındırılan sınıf. */
export function isInternetFacingInstallation(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readWebHardeningConfig(env, () => {}).clientIpHeader) || isHostedInstallation(env);
}

/** Kaynak kimliği: kanıtlı cihaz, yoksa istemci IP'si (/64). */
export function accountSourceOf(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  if (req.device?.proofVerified) return `dev:${req.device.id}`;
  return resolveClientIp(req, readWebHardeningConfig(env, () => {}).clientIpHeader) ?? "unknown";
}

function normalizeAccount(username: string): string {
  return username.trim().toLowerCase().slice(0, 80);
}

function entryOf(username: string, create: boolean): AccountEntry | null {
  const k = normalizeAccount(username);
  if (!k) return null;
  let e = accounts.get(k);
  if (!e && create) {
    if (accounts.size >= MAX_ACCOUNTS) sweep(Date.now());
    e = { fails: [], sources: new Set(), known: new Map(), alertedAt: 0 };
    accounts.set(k, e);
  }
  return e ?? null;
}

function liveFails(e: AccountEntry, now: number): number[] {
  const from = now - ACCOUNT_WINDOW_MS;
  let i = 0;
  while (i < e.fails.length && (e.fails[i] as number) <= from) i++;
  if (i > 0) e.fails = e.fails.slice(i);
  if (e.fails.length === 0) e.sources.clear();
  return e.fails;
}

function sweep(now: number): void {
  for (const [k, e] of accounts) {
    liveFails(e, now);
    for (const [src, at] of e.known) if (now - at > KNOWN_SOURCE_TTL_MS) e.known.delete(src);
    if (e.fails.length === 0 && e.known.size === 0) accounts.delete(k);
  }
  // Hâlâ doluysa en eski eklenenden buda — bellek tavanı saldırganın rastgele adlarına karşı.
  for (const k of accounts.keys()) {
    if (accounts.size < MAX_ACCOUNTS) break;
    accounts.delete(k);
  }
}

/** Eşik üstündeki tanınmayan kaynak için kalan bekleme (sn); 0 = geçebilir. Sayaç artırmaz. */
export function accountThrottleWaitSec(username: string, source: string, now = Date.now()): number {
  const e = entryOf(username, false);
  if (!e) return 0;
  const fails = liveFails(e, now);
  if (fails.length < ACCOUNT_SOFT_THRESHOLD) return 0;
  const seen = e.known.get(source);
  if (seen !== undefined && now - seen <= KNOWN_SOURCE_TTL_MS) return 0;
  const over = fails.length - ACCOUNT_SOFT_THRESHOLD;
  const delayMs = Math.min(ACCOUNT_MAX_DELAY_SEC, 2 ** Math.min(over, 10)) * 1000;
  const last = fails[fails.length - 1] as number;
  const wait = last + delayMs - now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/** Hatalı parola (401). `alert` = 1 saatte ACCOUNT_ALERT_THRESHOLD aşıldı (hesap başına saatte bir kez). */
export function noteAccountFailure(
  username: string,
  source: string,
  now = Date.now(),
): { alert: boolean; failCount: number; sourceCount: number } {
  const e = entryOf(username, true);
  if (!e) return { alert: false, failCount: 0, sourceCount: 0 };
  liveFails(e, now).push(now);
  if (e.sources.size < 1000) e.sources.add(source);
  const failCount = e.fails.length;
  const alert = failCount >= ACCOUNT_ALERT_THRESHOLD && now - e.alertedAt > ACCOUNT_WINDOW_MS;
  if (alert) e.alertedAt = now;
  return { alert, failCount, sourceCount: e.sources.size };
}

/** Başarılı giriş: kaynak bu hesap için TANINIR (sayaç silinmez — saldırı sürüyorsa yabancı kaynak yine bekler). */
export function noteAccountSuccess(username: string, source: string, now = Date.now()): void {
  const e = entryOf(username, true);
  if (!e) return;
  e.known.delete(source);
  e.known.set(source, now);
  while (e.known.size > MAX_KNOWN_SOURCES) e.known.delete(e.known.keys().next().value as string);
}

/** Yalnız bekçi. */
export function resetAccountThrottleForTests(): void {
  accounts.clear();
}
