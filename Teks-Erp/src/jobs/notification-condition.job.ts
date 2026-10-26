// =============================================================================
// BİLDİRİM KOŞUL TARAYICISI — KOSUL türlerinin aç/kapa motoru (plan §3.5, §3.8; kaynaklar N1-KOSUL-*)
// =============================================================================
// Kaynak `evaluate()` ile "şu an doğru olan konu kümesini" döner; fark açılır/kapanır. Tur kaynak
// başına TEK tx: İLK ifade 8040 kilidi `hashtext('bildirim-kosul:'||kind)` → yeni doğrular
// `INSERT … ON CONFLICT DO NOTHING RETURNING` (yalnız gerçekten açılan ACILDI alır) → artık doğru
// olmayanlar `UPDATE … WHERE resolvedAt IS NULL RETURNING` (yalnız gerçekten kapanan KAPANDI alır).
// `evaluate` fırlatırsa HİÇBİR koşul kapanmaz (fail-closed; sahte "çözüldü" yok) — log + sonraki tur.
// Bayrak kapalıyken tur no-op; zamanlayıcıyı `notification-dispatch.job` bayrağa göre açar/kapar.
// SU DAMGASI: bayrak açıldıktan sonra türün İLK turu taban turudur — doğrular sessizce açılır/kapanır,
// bildirim ÜRETMEZ (birikmiş geçmiş sel olmasın; `notification-baseline.helper`).
// =============================================================================
import prisma from "../lib/prisma";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../constants/notification-catalog";
import { NOTIFICATION_DISPATCH_LOCK_NS } from "../services/notification-dispatch.service";
import { emitNotification } from "../services/helpers/notification-emit.helper";
import { refreshNotificationParams } from "../services/helpers/notification-params.helper";
import { readNotificationInboxEnabled } from "../services/system-setting.service";
import { hasNotificationBaseline, markNotificationBaseline } from "../services/helpers/notification-baseline.helper";
import { reportJobFailure } from "./job-failure";
import { uyari } from "../lib/logger";

export interface ConditionSubject {
  /** `notification_conditions.subjectKey` (≤160); katalog `tekilKalibi`yle aynı kimlik. */
  key: string;
  type: string;
  id?: string | null;
  payload: Record<string, unknown>;
}

export interface ConditionSource {
  kind: NotificationKind;
  periodMs: number;
  evaluate: () => Promise<ConditionSubject[]>;
}

/** `baseline` yalnız taban turunda: o turda sessizce açılan konu sayısı (opened/closed 0 kalır). */
export type ConditionRunResult = "disabled" | "error" | { opened: number; closed: number; baseline?: number };

const sources = new Map<NotificationKind, ConditionSource>();

/** Kaynak kaydı (modül yüklenirken). Yalnız KOSUL türü kaydedilir; ikinci kayıt öncekini değiştirir. */
export function registerConditionSource(src: ConditionSource): void {
  if (NOTIFICATION_CATALOG[src.kind]?.altTur !== "KOSUL") throw new Error(`koşul kaynağı yalnız KOSUL türü olabilir: ${src.kind}`);
  sources.set(src.kind, src);
  if (started) schedule(src);
}

export function registeredConditionKinds(): NotificationKind[] {
  return [...sources.keys()];
}

/** Bir kaynağın TEK turu (bekçi doğrudan çağırır). */
export async function runConditionSourceOnce(kind: NotificationKind): Promise<ConditionRunResult> {
  const src = sources.get(kind);
  if (!src) throw new Error(`kayıtlı koşul kaynağı yok: ${kind}`);
  if (!(await readNotificationInboxEnabled())) return "disabled";
  let truths: ConditionSubject[];
  try {
    // Fabrika eşiği (N4) kaynakların senkron okuyucusuna değerlendirmeden önce yansır; okuma düşerse koşul kapanmaz.
    await refreshNotificationParams(prisma);
    truths = await src.evaluate();
  } catch (err) {
    uyari("bildirim", `koşul kaynağı ${kind} değerlendirilemedi — açık koşullar KAPATILMADI`, err);
    return "error";
  }
  const byKey = new Map<string, ConditionSubject>();
  for (const t of truths) byKey.set(t.key.slice(0, 160), t);
  const keys = [...byKey.keys()];

  return prisma.$transaction(async (tx): Promise<ConditionRunResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NOTIFICATION_DISPATCH_LOCK_NS}::int, hashtext(${"bildirim-kosul:" + kind}))`;
    // Bayrak evaluate sırasında kapanmış olabilir: açık koşul outbox'sız doğmasın.
    if (!(await readNotificationInboxEnabled(tx))) return "disabled";
    const isBaseline = !(await hasNotificationBaseline(tx, kind));
    let opened = 0;
    let closed = 0;
    if (keys.length > 0) {
      const subs = keys.map((k) => byKey.get(k)!);
      const rows = await tx.$queryRaw<Array<{ id: string; subjectKey: string }>>`
        INSERT INTO notification_conditions (id, kind, "subjectKey", "subjectType", "subjectId", "openedAt", payload, "createdAt", "updatedAt")
        SELECT gen_random_uuid(), ${kind}, d.k, d.t, d.i::uuid, now(), d.p::jsonb, now(), now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
        FROM unnest(${keys}::text[], ${subs.map((s) => s.type.slice(0, 32))}::text[], ${subs.map((s) => s.id ?? null)}::text[],
                    ${subs.map((s) => JSON.stringify(s.payload ?? {}))}::text[]) AS d(k, t, i, p)
        ON CONFLICT (kind, "subjectKey") WHERE "resolvedAt" IS NULL DO NOTHING
        RETURNING id, "subjectKey"`;
      for (const r of rows) {
        opened++;
        if (isBaseline) continue;
        const s = byKey.get(r.subjectKey)!;
        await emitNotification(tx, kind, { type: s.type, id: s.id ?? null, key: r.subjectKey }, s.payload, { phase: "ACILDI", conditionId: r.id });
      }
    }
    const gone = await tx.$queryRaw<Array<{ id: string; subjectKey: string; subjectType: string; subjectId: string | null; payload: unknown }>>`
      UPDATE notification_conditions SET "resolvedAt" = now(), "updatedAt" = now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
      WHERE kind = ${kind} AND "resolvedAt" IS NULL AND NOT ("subjectKey" = ANY(${keys}::text[]))
      RETURNING id, "subjectKey", "subjectType", "subjectId", payload`;
    if (isBaseline) {
      await markNotificationBaseline(tx, kind);
      return { opened: 0, closed: 0, baseline: opened };
    }
    for (const g of gone) {
      const payload = (g.payload && typeof g.payload === "object" ? g.payload : {}) as Record<string, unknown>;
      await emitNotification(tx, kind, { type: g.subjectType, id: g.subjectId, key: g.subjectKey }, payload, { phase: "KAPANDI", conditionId: g.id });
      closed++;
    }
    return { opened, closed };
  });
}

// ── Zamanlayıcı (kaynak başına kendi periyodu; tur üst üste binmez) ──────────────────────────────
let started = false;
const timers = new Map<NotificationKind, NodeJS.Timeout>();
const running = new Set<NotificationKind>();

function tick(kind: NotificationKind): void {
  if (running.has(kind)) return;
  running.add(kind);
  void runConditionSourceOnce(kind)
    .catch((err) => reportJobFailure(`bildirim-kosul:${kind}`, err))
    .finally(() => running.delete(kind));
}

function schedule(src: ConditionSource): void {
  const prev = timers.get(src.kind);
  if (prev) clearInterval(prev);
  const t = setInterval(() => tick(src.kind), Math.max(5_000, src.periodMs));
  t.unref();
  timers.set(src.kind, t);
  setImmediate(() => tick(src.kind));
}

export function startNotificationConditionScanner(): void {
  if (started) return;
  started = true;
  for (const src of sources.values()) schedule(src);
}

export function stopNotificationConditionScanner(): void {
  started = false;
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}

export function isNotificationConditionScannerRunning(): boolean {
  return started;
}
