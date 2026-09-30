// BİLDİRİM GÖNDERİMİ — kuyruk ATOMİK CLAIM ile alınır (`FOR UPDATE SKIP LOCKED` CTE; süresi dolan claim yeniden
// alınabilir), ağ çağrısı tx DIŞINDA yapılır, sonuç yalnız kendi claim'imiz hâlâ duruyorsa yazılır (count 0 → başka
// tur almış, dokunulmaz). Gönderim anında kural YENİDEN verilir: hesap aktif mi · bildirim/tür açık mı · izin yetiyor
// mu (doğuştan sonra düşürülen izin/ayar da tutar) · sessiz saat (sessizde gönderilmez, bitişe ertelenir; deneme
// hakkı yanmaz). Geçersiz cihaz pasife çekilir; Expo bileti alınan teslim makbuz yoklamasına girer (`notification-receipts`). Günlüğe yalnız sayı ve kısa kod düşer — belirteç/anahtar DÜŞMEZ.
import { Prisma, type DevicePlatform } from "@prisma/client";
import { effectivePermissions } from "../catalog/permissions";
import { NOTIFICATION_KINDS, type NotificationKind } from "../wire/api";
import { quietUntil } from "../lib/istanbul";
import { withTesis } from "../lib/tenant";
import type { PushOutcome, PushTransport } from "../push/transports";
import type { CloudContext } from "./context";
import { ruleVerdict } from "./notification-events";
import { RECEIPT_DELAY_MS } from "./notification-receipts";
import { loadFacilitySettings, resolveSettings } from "./notification-settings.service";

export const MAX_ATTEMPTS = 5;
const CLAIM_MS = 2 * 60_000;
const BATCH = 50;
const BACKOFF_MIN = [1, 5, 15, 60];

interface Claimed {
  id: string;
  account_id: string;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  attempts: number;
}

export interface DeliveryTotals {
  sent: number;
  skipped: number;
  deferred: number;
  retried: number;
  failed: number;
}

type Decision =
  | { readonly kind: "ATLA"; readonly reason: string }
  | { readonly kind: "ERTELE"; readonly until: Date }
  | { readonly kind: "GONDER"; readonly devices: readonly { id: string; platform: DevicePlatform; token: string }[] };

async function claim(ctx: CloudContext, tesisId: string, nowMs: number, until: Date): Promise<Claimed[]> {
  const now = new Date(nowMs);
  return withTesis(ctx.app, { tesisId }, (tx) =>
    tx.$queryRaw<Claimed[]>`
      WITH due AS (
        SELECT id FROM notifications
         WHERE tesis_id = ${tesisId}::uuid
           AND ((status = 'BEKLIYOR' AND next_attempt_at <= ${now}::timestamptz) OR (status = 'GONDERILIYOR' AND claim_until < ${now}::timestamptz))
         ORDER BY next_attempt_at, id LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
      UPDATE notifications n SET status = 'GONDERILIYOR', claim_until = ${until}::timestamptz, attempts = n.attempts + 1, updated_at = now()
        FROM due WHERE n.id = due.id
      RETURNING n.id, n.account_id, n.kind, n.title, n.body, n.route, n.attempts`,
  );
}

async function decide(ctx: CloudContext, tesisId: string, n: Claimed, nowMs: number): Promise<Decision> {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(n.kind)) return { kind: "ATLA", reason: "TUR_BILINMIYOR" };
  return withTesis(ctx.app, { tesisId }, async (tx) => {
    const account = await tx.account.findUnique({ where: { id: n.account_id }, select: { status: true, permissions: true } });
    if (!account || account.status !== "AKTIF") return { kind: "ATLA", reason: "HESAP_KAPALI" };
    const cfg = await loadFacilitySettings(tx, tesisId);
    const settings = resolveSettings(cfg.byAccount.get(n.account_id) ?? null, cfg.facility).settings;
    const skip = ruleVerdict(settings, n.kind as NotificationKind, effectivePermissions(account.permissions));
    if (skip) return { kind: "ATLA", reason: skip };
    const quiet = quietUntil(settings.sessiz, nowMs);
    if (quiet !== null) return { kind: "ERTELE", until: new Date(quiet) };
    const devices = await tx.pushDevice.findMany({ where: { tesisId, accountId: n.account_id, active: true }, select: { id: true, platform: true, token: true }, orderBy: { id: "asc" } });
    if (devices.length === 0) return { kind: "ATLA", reason: "CIHAZ_YOK" };
    return { kind: "GONDER", devices };
  });
}

/** Sonucu yaz — yalnız claim hâlâ bizdeyse (atomik; count 0 = başka tur almış). */
async function finish(ctx: CloudContext, claimOf: { tesisId: string; id: string; until: Date }, data: Prisma.NotificationUpdateManyMutationInput): Promise<boolean> {
  const { tesisId, id, until } = claimOf;
  const r = await withTesis(ctx.app, { tesisId }, (tx) => tx.notification.updateMany({ where: { id, tesisId, status: "GONDERILIYOR", claimUntil: until }, data: { ...data, claimUntil: null } }));
  return r.count === 1;
}

async function sendAll(transport: PushTransport, n: Claimed, devices: readonly { id: string; platform: DevicePlatform; token: string }[]) {
  const results: { id: string; outcome: PushOutcome }[] = [];
  for (const d of devices) {
    let outcome: PushOutcome;
    try {
      outcome = await transport.send({ platform: d.platform, token: d.token }, { id: n.id, title: n.title, body: n.body, route: n.route });
    } catch {
      outcome = { kind: "GECICI", code: "TASIYICI_HATASI" };
    }
    results.push({ id: d.id, outcome });
  }
  return results;
}

/** Bir tesisin vadesi gelen bildirimlerini gönder. */
export async function deliverDue(ctx: CloudContext, transport: PushTransport, tesisId: string, nowMs: number): Promise<DeliveryTotals> {
  const t: DeliveryTotals = { sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0 };
  const until = new Date(nowMs + CLAIM_MS);
  for (const n of await claim(ctx, tesisId, nowMs, until)) {
    const mine = { tesisId, id: n.id, until };
    const d = await decide(ctx, tesisId, n, nowMs);
    if (d.kind === "ATLA") {
      if (await finish(ctx, mine, { status: "ATLANDI", skipReason: d.reason })) t.skipped++;
      continue;
    }
    if (d.kind === "ERTELE") {
      if (await finish(ctx, mine, { status: "BEKLIYOR", nextAttemptAt: d.until, attempts: Math.max(0, n.attempts - 1) })) t.deferred++;
      continue;
    }
    const results = await sendAll(transport, n, d.devices);
    const invalid = results.filter((r) => r.outcome.kind === "GECERSIZ_CIHAZ").map((r) => r.id);
    if (invalid.length > 0) await withTesis(ctx.app, { tesisId }, (tx) => tx.pushDevice.updateMany({ where: { tesisId, id: { in: invalid }, active: true }, data: { active: false } }));
    const deliveries = results.map((r) => ({ cihazId: r.id, sonuc: r.outcome.kind === "OK" ? "OK" : `${r.outcome.kind}:${r.outcome.code}`, ...(r.outcome.kind === "OK" && r.outcome.ticket ? { bilet: r.outcome.ticket } : {}) }));
    const receiptDueAt = deliveries.some((d) => "bilet" in d) ? new Date(nowMs + RECEIPT_DELAY_MS) : null;
    const firstError = results.find((r) => r.outcome.kind !== "OK")?.outcome;
    const lastError = firstError && firstError.kind !== "OK" ? firstError.code : null;
    if (results.some((r) => r.outcome.kind === "OK")) {
      if (await finish(ctx, mine, { status: "GONDERILDI", sentAt: new Date(nowMs), deliveries, lastError, receiptDueAt })) t.sent++;
    } else if (results.some((r) => r.outcome.kind === "GECICI") && n.attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MIN[Math.min(n.attempts - 1, BACKOFF_MIN.length - 1)]! * 60_000;
      if (await finish(ctx, mine, { status: "BEKLIYOR", nextAttemptAt: new Date(nowMs + wait), deliveries, lastError })) t.retried++;
    } else if (await finish(ctx, mine, { status: "BASARISIZ", deliveries, lastError: lastError ?? "GONDERILEMEDI" })) {
      t.failed++;
    }
  }
  return t;
}
