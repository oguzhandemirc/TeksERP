// =============================================================================
// BİLDİRİM DAĞITICISI — outbox → gelen kutusu (plan §3.5, §3.6, §3.8)
// =============================================================================
// Tur = TEK tx: İLK ifade 8040 kilidi (tek dağıtıcı) → işlenmemiş ≤100 satır `FOR UPDATE SKIP
// LOCKED` → alıcı çözümü (izin sahipleri [katalog `varsayilan`] ∩ görme süzgeci ∖ aktör) → toplu
// `INSERT … ON CONFLICT (userId, groupKey) WHERE resolvedAt IS NULL DO UPDATE` → KAPANDI çözümü
// → günlük sayaç → `processedAt` claim'i (WHERE processedAt IS NULL; eksik claim = tur geri alınır).
// Tur düşerse satırlar TEKER yeniden denenir; düşen satıra ayrı kısa tx'te `attempts++` +
// `lastErrorCode` yazılır — iş işlemine hiç dokunulmaz. Zil kancası tx SONRASI çağrılır.
// Tablolar telemetridir (audit muaf, `scripts/lib/audit-muafiyeti.ts`).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  NOTIFICATION_CATALOG,
  type NotificationCatalogEntry,
  type NotificationKind,
} from "../constants/notification-catalog";
import { factoryYmd } from "../constants/time";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { loadEffectiveGrants } from "./helpers/loom-alarm-recipient.helper";
import {
  loadNotificationVisibilityEnv,
  visibilityPermissionCodes,
  visibleUsersFor,
  type NotificationVisibilityEnv,
} from "./helpers/notification-visibility.helper";
import { addRecipients, type Agg, type BatchState } from "./helpers/notification-aggregate.helper";
import { hata, uyari } from "../lib/logger";

/** Advisory kilit uzayı — envanter `helpers/period-guard.helper.ts` başlığında. */
export const NOTIFICATION_DISPATCH_LOCK_NS: number = 8040;
export const NOTIFICATION_DISPATCHER_LOCK_KEY = "bildirim-dagitici";
/** Tur başına en çok outbox satırı (≈100 × kullanıcı sayısı upsert; plan risk 8). */
export const DISPATCH_BATCH_LIMIT = 100;
/** Bu kadar düşen satır süpürmeden çıkar (zehirli satır kuyruğu tıkamasın); budama 7 günde siler. */
export const DISPATCH_MAX_ATTEMPTS = 5;
const GROUP_KEY_MAX = 200;
const ERROR_CODE_MAX = 64;

type Tx = Prisma.TransactionClient;
export type InboxReason = "IZIN" | "TAKIPCI" | "OLUSTURAN" | "NOBET" | "LISTE" | "ALARM_ALICISI";

export interface OutboxRow {
  id: string;
  kind: string;
  phase: string;
  subjectType: string;
  subjectId: string | null;
  subjectKey: string;
  conditionId: string | null;
  actorUserId: string | null;
  payload: unknown;
  dedupeKey: string;
  occurredAt: Date;
}

export interface RecipientContext {
  tx: Tx;
  row: OutboxRow;
  kind: NotificationKind;
  entry: NotificationCatalogEntry;
  env: NotificationVisibilityEnv;
  /** Turun izin fotoğrafı (aktif, sistem dışı kullanıcılar; görme + varsayılan kodları). */
  grants: ReadonlyMap<string, readonly string[]>;
}
export type RecipientResolver = (ctx: RecipientContext) => Promise<Array<{ userId: string; reason: InboxReason }>>;

/** Geniş tipli okuma: outbox'taki ham `kind` katalog dışıysa `undefined`. */
function entryOf(kind: string): NotificationCatalogEntry | undefined {
  return (NOTIFICATION_CATALOG as Record<string, NotificationCatalogEntry>)[kind];
}

const resolvers = new Map<NotificationKind, RecipientResolver>();

/** Türe özel alıcı çözücü (N2: tezgah alarmı DONMUŞ `LoomAlarmRecipient`ten okur). Sonuç yine görme süzgecinden geçer. */
export function registerRecipientResolver(kind: NotificationKind, resolver: RecipientResolver): void {
  resolvers.set(kind, resolver);
}

/** F1 varsayılanı: görebilenler ∩ katalog `varsayilan` ∖ aktör (ALARM'da aktör düşmez). */
async function resolveByPermission(ctx: RecipientContext): Promise<Array<{ userId: string; reason: InboxReason }>> {
  const { entry, row } = ctx;
  if (entry.varsayilan === "KAPALI") return [];
  // ALARM sınıfının alıcısı donmuş listedir (N2 çözücüsü); çözücüsüz alarm kimseye dağıtılmaz.
  if (entry.sinif === "ALARM") return [];
  const varsayilan = entry.varsayilan;
  return ctx.grants.size === 0 ? [] : (await visibleUsersFor(ctx.tx, ctx.kind, ctx.env, { grants: ctx.grants }))
    .filter((userId) => varsayilan === "HERKES" || varsayilan.some((c) => matchesPermission([...(ctx.grants.get(userId) ?? [])], c)))
    .filter((userId) => userId !== row.actorUserId)
    .map((userId) => ({ userId, reason: "IZIN" as const }));
}

/** Birleştirme anahtarı (plan §3.6): ALARM `alarm:<id>` · KOSUL `kind:subjectKey:conditionId` · OLAY dedupeKey (+ pencere kovası). */
export function notificationGroupKey(row: Pick<OutboxRow, "kind" | "subjectId" | "subjectKey" | "conditionId" | "dedupeKey" | "occurredAt">): string {
  const entry = entryOf(row.kind);
  let key: string;
  if (entry?.sinif === "ALARM") key = `alarm:${row.subjectId ?? row.subjectKey}`;
  else if (entry?.altTur === "KOSUL") key = `${row.kind}:${row.subjectKey}:${row.conditionId ?? "-"}`;
  else if (entry && entry.pencereSn > 0) key = `${row.dedupeKey}:${Math.floor(row.occurredAt.getTime() / 1000 / entry.pencereSn)}`;
  else key = row.dedupeKey;
  return key.slice(0, GROUP_KEY_MAX);
}

export interface DispatchResult {
  /** İşlenmiş (claim edilmiş) outbox satırı. */
  processed: number;
  /** Yazılan/birleşen gelen kutusu satırı (kullanıcı × groupKey). */
  upserts: number;
  /** KAPANDI ile çözülen gelen kutusu satırı. */
  resolved: number;
  /** Bu turda düşen (attempts++) satır. */
  failed: number;
  /** Zil kancasına giden kullanıcılar (tekil, sıralı). */
  userIds: string[];
}

interface BatchOptions {
  limit: number;
  onlyId?: string;
  /** Bekçi kancası: claim'den sonra, commit'ten önce (hata enjeksiyonu). */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

async function selectBatch(tx: Tx, o: BatchOptions): Promise<OutboxRow[]> {
  return o.onlyId
    ? await tx.$queryRaw<OutboxRow[]>`
        SELECT id, kind, phase, "subjectType", "subjectId", "subjectKey", "conditionId", "actorUserId", payload, "dedupeKey", "occurredAt"
        FROM notification_outbox WHERE id = ${o.onlyId}::uuid AND "processedAt" IS NULL FOR UPDATE SKIP LOCKED`
    : await tx.$queryRaw<OutboxRow[]>`
        SELECT id, kind, phase, "subjectType", "subjectId", "subjectKey", "conditionId", "actorUserId", payload, "dedupeKey", "occurredAt"
        FROM notification_outbox WHERE "processedAt" IS NULL AND attempts < ${DISPATCH_MAX_ATTEMPTS}
        ORDER BY "createdAt", id LIMIT ${o.limit} FOR UPDATE SKIP LOCKED`;
}

async function loadRecipientContext(tx: Tx, known: OutboxRow[]) {
  const kinds = [...new Set(known.map((r) => r.kind as NotificationKind))];
  const env = await loadNotificationVisibilityEnv(tx, kinds);
  const codes = new Set(visibilityPermissionCodes(kinds));
  for (const k of kinds) {
    const v = entryOf(k)!.varsayilan;
    if (Array.isArray(v)) for (const c of v) codes.add(c);
  }
  const grants = codes.size === 0 ? new Map<string, string[]>() : await loadEffectiveGrants(tx, [...codes], new Date());
  return { env, grants };
}

async function aggregateRows(tx: Tx, rows: OutboxRow[], known: OutboxRow[]): Promise<BatchState> {
  const { env, grants } = await loadRecipientContext(tx, known);
  const state: BatchState = { agg: new Map(), counts: new Map(), errors: new Map(), closeKeys: new Map(), stats: new Map() };
  const { counts, errors, closeKeys, stats } = state;
  for (const row of rows) {
    const kind = row.kind as NotificationKind;
    const entry = entryOf(kind);
    if (!entry) {
      // Katalogdan çıkmış tür (sürüm düşüşü): yeniden denemek düzeltmez → işlenir, iz kalır.
      counts.set(row.id, 0);
      errors.set(row.id, "BILINMEYEN_TUR");
      continue;
    }
    const groupKey = notificationGroupKey(row);
    if (row.phase === "KAPANDI") {
      closeKeys.set(groupKey, [...(closeKeys.get(groupKey) ?? []), row.id]);
      continue;
    }
    const resolver = resolvers.get(kind) ?? resolveByPermission;
    const recipients = await resolver({ tx, row, kind, entry, env, grants });
    counts.set(row.id, addRecipients(state, { row, entry, groupKey }, recipients));
    errors.set(row.id, null);
    const day = factoryYmd(row.occurredAt);
    const sk = `${day}\u0000${kind}`;
    stats.set(sk, { day, kind, n: (stats.get(sk)?.n ?? 0) + 1 });
  }
  return state;
}

async function upsertInbox(tx: Tx, a: Agg[]): Promise<void> {
  if (a.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO notification_inbox
      (id, "userId", kind, klass, "subjectType", "subjectId", "groupKey", count, "firstAt", "lastAt",
       "lastOutboxId", payload, reason, "kanalMasaustu", "kanalTablet", ozet, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), d.u::uuid, d.k, d.c, d.st, d.si::uuid, d.g, d.n, d.f::timestamptz, d.l::timestamptz,
           d.o::uuid, d.p::jsonb, d.r, d.km, d.kt, false, now(), now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    FROM unnest(${a.map((x) => x.userId)}::text[], ${a.map((x) => x.kind)}::text[], ${a.map((x) => x.klass)}::text[],
                ${a.map((x) => x.subjectType)}::text[], ${a.map((x) => x.subjectId)}::text[], ${a.map((x) => x.groupKey)}::text[],
                ${a.map((x) => x.n)}::int[], ${a.map((x) => x.firstAt.toISOString())}::text[], ${a.map((x) => x.lastAt.toISOString())}::text[],
                ${a.map((x) => x.lastOutboxId)}::text[], ${a.map((x) => x.payload)}::text[], ${a.map((x) => x.reason)}::text[],
                ${a.map((x) => x.km)}::bool[], ${a.map((x) => x.kt)}::bool[])
      AS d(u, k, c, st, si, g, n, f, l, o, p, r, km, kt)
    ON CONFLICT ("userId", "groupKey") WHERE "resolvedAt" IS NULL DO UPDATE SET
      count = notification_inbox.count + EXCLUDED.count,
      "lastAt" = GREATEST(notification_inbox."lastAt", EXCLUDED."lastAt"),
      payload = EXCLUDED.payload,
      "lastOutboxId" = EXCLUDED."lastOutboxId",
      "readAt" = NULL,
      "snoozedUntil" = NULL,
      "updatedAt" = now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar`;
}

async function addLateCloses(tx: Tx, known: OutboxRow[], closeKeys: Map<string, string[]>): Promise<void> {
  const condIds = [...new Set(known.filter((r) => r.phase !== "KAPANDI" && r.conditionId).map((r) => r.conditionId!))];
  if (condIds.length > 0) {
    const gone = await tx.notificationCondition.findMany({ where: { id: { in: condIds }, resolvedAt: { not: null } }, select: { id: true } });
    const goneIds = new Set(gone.map((g) => g.id));
    for (const r of known) {
      if (r.phase === "KAPANDI" || !r.conditionId || !goneIds.has(r.conditionId)) continue;
      const g = notificationGroupKey(r);
      if (!closeKeys.has(g)) closeKeys.set(g, []);
    }
  }
}

/** KAPANDI upsert'lerden SONRA: aynı turda açılıp kapanan koşulun satırı da çözülür. */
async function resolveClosed(tx: Tx, state: BatchState, users: Set<string>): Promise<number> {
  const { counts, errors, closeKeys } = state;
  if (closeKeys.size === 0) return 0;
  const closed = await tx.$queryRaw<Array<{ userId: string; groupKey: string }>>`
    UPDATE notification_inbox SET "resolvedAt" = now(), "readAt" = COALESCE("readAt", now()), "updatedAt" = now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    WHERE "groupKey" = ANY(${[...closeKeys.keys()]}::text[]) AND "resolvedAt" IS NULL
    RETURNING "userId", "groupKey"`;
  for (const c of closed) users.add(c.userId);
  for (const [g, ids] of closeKeys) {
    const n = closed.filter((c) => c.groupKey === g).length;
    ids.forEach((id, i) => {
      counts.set(id, i === ids.length - 1 ? n : 0);
      errors.set(id, null);
    });
  }
  return closed.length;
}

async function bumpDailyStats(tx: Tx, s: Array<{ day: string; kind: string; n: number }>): Promise<void> {
  if (s.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO notification_daily_stats (id, "factoryDay", kind, events, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), d.day::date, d.kind, d.n, now(), now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    FROM unnest(${s.map((x) => x.day)}::text[], ${s.map((x) => x.kind)}::text[], ${s.map((x) => x.n)}::int[]) AS d(day, kind, n)
    ON CONFLICT ("factoryDay", kind) DO UPDATE SET events = notification_daily_stats.events + EXCLUDED.events, "updatedAt" = now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar`;
}

/** Atomik claim: kilitli satırlar yalnız bu turda işlenir; eksik sayı = başka yazar → tur geri alınır. */
async function claimBatch(tx: Tx, rows: OutboxRow[], state: BatchState): Promise<void> {
  const { counts, errors } = state;
  const ids = rows.map((r) => r.id);
  const claimed = await tx.$executeRaw`
    UPDATE notification_outbox AS o SET "processedAt" = now(), "claimedAt" = now(), "recipientCount" = d.n, -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
           "lastErrorCode" = d.e, "updatedAt" = now() -- tz-ok: notification_* zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    FROM unnest(${ids}::text[], ${ids.map((id) => counts.get(id) ?? 0)}::int[], ${ids.map((id) => errors.get(id) ?? null)}::text[]) AS d(id, n, e)
    WHERE o.id = d.id::uuid AND o."processedAt" IS NULL`;
  if (claimed !== rows.length) throw new Error(`outbox claim eksik: ${claimed}/${rows.length}`);
}

async function dispatchBatchTx(tx: Tx, o: BatchOptions): Promise<DispatchResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NOTIFICATION_DISPATCH_LOCK_NS}::int, hashtext(${NOTIFICATION_DISPATCHER_LOCK_KEY}))`;
  const rows = await selectBatch(tx, o);
  if (rows.length === 0) return { processed: 0, upserts: 0, resolved: 0, failed: 0, userIds: [] };
  const known = rows.filter((r) => entryOf(r.kind) !== undefined);
  const state = await aggregateRows(tx, rows, known);
  const a = [...state.agg.values()];
  await upsertInbox(tx, a);
  const users = new Set(a.map((x) => x.userId));
  // Geciken ACILDI (yeniden denenen satır) koşulu çoktan kapanmışsa açık satır bırakmaz.
  await addLateCloses(tx, known, state.closeKeys);
  const resolved = await resolveClosed(tx, state, users);
  await bumpDailyStats(tx, [...state.stats.values()]);
  await claimBatch(tx, rows, state);
  if (o.beforeCommit) await o.beforeCommit(tx);
  return { processed: rows.length, upserts: a.length, resolved, failed: 0, userIds: [...users].sort() };
}

function errorCode(err: unknown): string {
  const e = err as { code?: unknown; meta?: { code?: unknown }; name?: unknown };
  const code = typeof e?.meta?.code === "string" ? e.meta.code : typeof e?.code === "string" ? e.code : typeof e?.name === "string" ? e.name : "HATA";
  return code.slice(0, ERROR_CODE_MAX);
}

async function markFailed(id: string, err: unknown): Promise<void> {
  // Ayrı kısa tx: düşen tur geri alındı, sayaç yine de ilerlemeli (zehirli satır sonsuza dek denenmesin).
  await prisma.notificationOutbox.updateMany({
    where: { id, processedAt: null },
    data: { attempts: { increment: 1 }, lastErrorCode: errorCode(err) },
  });
}

let deliveredHook: ((userIds: string[]) => void) | null = null;

/** Zil kancası (N1-ZIL hub'ı bağlar): tur commit olduktan SONRA, kutusu değişen kullanıcılarla çağrılır. */
export function setNotificationDeliveredHook(hook: ((userIds: string[]) => void) | null): void {
  deliveredHook = hook;
}

function onDelivered(userIds: string[]): void {
  if (!deliveredHook || userIds.length === 0) return;
  try {
    deliveredHook(userIds);
  } catch (err) {
    uyari("bildirim", "zil kancası hata verdi", err);
  }
}

/**
 * Bir dağıtım turu. Bütün tur düşerse kuyruk satırları TEKER denenir; yalnız düşen satır `attempts++` alır.
 * Bayrağa bakmaz — bayrak kapısı işi başlatan zamanlayıcıdadır (bekçi de doğrudan çağırır).
 */
export async function runNotificationDispatchOnce(
  opts: { limit?: number; beforeCommit?: (tx: Tx) => Promise<void> } = {},
): Promise<DispatchResult> {
  const limit = opts.limit ?? DISPATCH_BATCH_LIMIT;
  try {
    const r = await prisma.$transaction((tx) => dispatchBatchTx(tx, { limit, beforeCommit: opts.beforeCommit }));
    onDelivered(r.userIds);
    return r;
  } catch (batchErr) {
    uyari("bildirim", `dağıtım turu düştü (${errorCode(batchErr)}) — satırlar tek tek deneniyor`);
    const pending = await prisma.notificationOutbox.findMany({
      where: { processedAt: null, attempts: { lt: DISPATCH_MAX_ATTEMPTS } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true },
    });
    const total: DispatchResult = { processed: 0, upserts: 0, resolved: 0, failed: 0, userIds: [] };
    const users = new Set<string>();
    for (const { id } of pending) {
      try {
        const r = await prisma.$transaction((tx) => dispatchBatchTx(tx, { limit: 1, onlyId: id, beforeCommit: opts.beforeCommit }));
        total.processed += r.processed;
        total.upserts += r.upserts;
        total.resolved += r.resolved;
        for (const u of r.userIds) users.add(u);
      } catch (rowErr) {
        total.failed += 1;
        try {
          await markFailed(id, rowErr);
        } catch (markErr) {
          hata("bildirim", `outbox ${id} hata sayacı yazılamadı`, markErr);
        }
      }
    }
    total.userIds = [...users].sort();
    onDelivered(total.userIds);
    return total;
  }
}
