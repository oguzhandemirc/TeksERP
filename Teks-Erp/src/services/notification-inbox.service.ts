// =============================================================================
// GELEN KUTUSU OKUMA SERVİSİ — liste · özet · okundu/okunmadı · ertele · katalog (plan §5.6 F1)
// =============================================================================
// Liste, cursor ve sayılar TEK where kurucusundan (`buildInboxWhere`) doğar: özet şeridi tabloyla
// çelişemez. Görme kümesi HER istekte `visibleKindsFor`dan gelir: izni giden türün satırı listede,
// sayıda ve okundu uçlarında yoktur (404 — varlığı da sızmaz). Okundu ATOMİK (`updateMany` beklenen
// durumla); yazım yalnız kişinin kendi satırına (`userId` WHERE'de). Süzme sunucudadır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { factoryMinuteOfDay } from "../constants/time";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKind } from "../constants/notification-catalog";
import { loadNotificationVisibilityEnv, permissionDeniedKindCount, visibleKindsFor } from "./helpers/notification-visibility.helper";
import { renderNotification } from "./helpers/notification-render.helper";
import { narrowKinds, readInboxListFilter, rowFlagWhere, type InboxListFilter } from "./helpers/notification-list-filter.helper";
import { loadCurrentShift } from "./helpers/loom-alarm-shift.helper";
import { readNotificationInboxEnabled } from "./system-setting.service";
import { ring, bellVersion } from "./notification-bell-hub";

export const INBOX_TABS = ["tumu", "okunmamis", "alarmlar", "ertelenen"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const SNOOZE_DURATIONS = ["1s", "yarin-sabah", "shift-sonu"] as const;
export type SnoozeDuration = (typeof SNOOZE_DURATIONS)[number];
/** "Yarın sabah" = ertesi fabrika günü 08:00 (duvar saati). */
const TOMORROW_MORNING_MINUTE = 24 * 60 + 8 * 60;
const UNDO_LIMIT = 500;

export interface InboxViewer {
  userId: string;
  permissions: readonly string[];
}

/** Bayrak kapalıysa (özet dışı) uçlar 409 — davranış bayrağı, modül değil. */
export async function assertInboxEnabled(): Promise<void> {
  if (!(await readNotificationInboxEnabled())) {
    throw AppError.conflict("Bildirim gelen kutusu bu kurulumda kapalı.", { code: "BILDIRIM_KAPALI" });
  }
}

/** Kişinin şu an görebildiği türler — TEK görme süzgecinden. */
export async function viewerKinds(viewer: InboxViewer): Promise<NotificationKind[]> {
  const env = await loadNotificationVisibilityEnv(prisma);
  return visibleKindsFor({ permissions: viewer.permissions }, env);
}

/**
 * TEK where: liste, cursor sayfası, sekme sayısı ve özet şeridi bundan türer.
 * `filter` verilirse tür/kanal süzgeci görme kümesiyle KESİŞİR (süzgeç yetki genişletmez); satır bayrağı
 * süzgeçleri (`ozet`, `tablet`) aynı AND'e girer — liste, cursor ve `sayi` yine tek where'den.
 */
export function buildInboxWhere(
  userId: string,
  kinds: readonly string[],
  sekme: InboxTab,
  opts: { now: Date; filter?: InboxListFilter },
): Prisma.NotificationInboxWhereInput {
  const { now, filter } = opts;
  const visibleKinds = filter ? narrowKinds(kinds, filter) : [...kinds];
  const notSnoozed: Prisma.NotificationInboxWhereInput = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const tabWhere: Record<InboxTab, Prisma.NotificationInboxWhereInput> = {
    tumu: notSnoozed,
    // Rozet = okunmamış BİLDİRİM: ALARM kendi hapında (`LoomAlarmBell`) ve Alarmlar sekmesinde sayılır (plan §6.1).
    // Gün özeti satırı (`ozet=true`, N4) rozete girmez; zil onu "Gün özeti" kartında gruplar (plan §5.4).
    okunmamis: { AND: [notSnoozed, { readAt: null }, { klass: "BILDIRIM" }, { ozet: false }] },
    alarmlar: { klass: "ALARM" },
    ertelenen: { snoozedUntil: { gt: now } },
  };
  return { AND: [{ userId, kind: { in: visibleKinds } }, tabWhere[sekme], ...(filter ? rowFlagWhere(filter) : [])] };
}

// ---- liste ------------------------------------------------------------------

export const InboxListQuery = z.object({
  sekme: z.enum(INBOX_TABS, "Tanınmayan sekme").default("tumu"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

function encodeCursor(lastAt: Date, id: string): string {
  return Buffer.from(`${lastAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(c: string): { lastAt: Date; id: string } {
  const [iso, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  const lastAt = new Date(iso ?? "");
  if (!id || Number.isNaN(lastAt.getTime()) || !z.uuid().safeParse(id).success) {
    throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "INVALID_CURSOR" });
  }
  return { lastAt, id };
}

const LIST_SELECT = {
  id: true, kind: true, klass: true, subjectType: true, subjectId: true, count: true, firstAt: true,
  lastAt: true, payload: true, reason: true, readAt: true, snoozedUntil: true, resolvedAt: true,
  ozet: true, kanalTablet: true,
} satisfies Prisma.NotificationInboxSelect;

type InboxRow = Prisma.NotificationInboxGetPayload<{ select: typeof LIST_SELECT }>;

function toItem(r: InboxRow, soundOn: boolean) {
  const kind = r.kind as NotificationKind;
  const entry = getNotificationEntry(kind);
  const text = renderNotification(kind, r.payload as Record<string, unknown>, r.resolvedAt ? "KAPANDI" : "OLAY");
  return {
    id: r.id,
    tur: r.kind,
    sinif: r.klass,
    altTur: entry.altTur,
    grup: entry.grup,
    baslik: text.baslik,
    govde: text.govde,
    yol: text.yol,
    tabletRota: entry.tabletRota ?? null,
    konu: { tip: r.subjectType, id: r.subjectId },
    sayac: r.count,
    ilkAn: r.firstAt,
    sonAn: r.lastAt,
    neden: r.reason,
    okunduAn: r.readAt,
    erteleBitis: r.snoozedUntil,
    cozulduAn: r.resolvedAt,
    ozet: r.ozet,
    kanalTablet: r.kanalTablet,
    // Tablet sesi: satırın kanal kararı (sessiz saat dahil, dağıtımda çözülmüş) ∧ kişinin ses ayarı.
    sesli: r.kanalTablet && soundOn,
  };
}

export async function listInbox(viewer: InboxViewer, query: Record<string, unknown>) {
  const q = InboxListQuery.parse(query);
  const filter = readInboxListFilter(query);
  const kinds = await viewerKinds(viewer);
  const where = buildInboxWhere(viewer.userId, kinds, q.sekme, { now: new Date(), filter });
  const c = q.cursor ? decodeCursor(q.cursor) : null;
  const pageWhere: Prisma.NotificationInboxWhereInput = c
    ? { AND: [where, { OR: [{ lastAt: { lt: c.lastAt } }, { lastAt: c.lastAt, id: { lt: c.id } }] }] }
    : where;
  const rows = await prisma.notificationInbox.findMany({
    where: pageWhere,
    orderBy: [{ lastAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    select: LIST_SELECT,
  });
  const total = await prisma.notificationInbox.count({ where });
  const setting = await prisma.notificationUserSetting.findUnique({ where: { userId: viewer.userId }, select: { sound: true } });
  const soundOn = setting?.sound ?? true;
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => toItem(r, soundOn)),
    nextCursor: hasMore && last ? encodeCursor(last.lastAt, last.id) : null,
    sayi: total,
    ...bellVersion(viewer.userId),
  };
}

// ---- özet -------------------------------------------------------------------

export async function inboxSummary(viewer: InboxViewer) {
  if (!(await readNotificationInboxEnabled())) return { enabled: false as const };
  const kinds = await viewerKinds(viewer);
  const now = new Date();
  const unread = await prisma.notificationInbox.count({ where: buildInboxWhere(viewer.userId, kinds, "okunmamis", { now }) });
  const openAlarms = await prisma.notificationInbox.count({
    where: { AND: [buildInboxWhere(viewer.userId, kinds, "alarmlar", { now }), { resolvedAt: null }] },
  });
  // Erteleme menüsü "Vardiya sonu"nu buna göre pasifler; ertele ucuyla AYNI helper (tek kaynak).
  const shift = await loadCurrentShift(prisma, now);
  return {
    enabled: true as const, okunmamis: unread, alarmAcik: openAlarms, vardiyaBitis: shift?.endsAt ?? null,
    ...bellVersion(viewer.userId),
  };
}

// ---- okundu / okunmadı / ertele --------------------------------------------

/** count 0 sonrası ayrım: satır kişinin ve görünür türdeyse "değişmedi", değilse 404. */
async function assertOwnVisible(viewer: InboxViewer, id: string, kinds: readonly string[]): Promise<void> {
  const row = await prisma.notificationInbox.findFirst({
    where: { id, userId: viewer.userId, kind: { in: [...kinds] } },
    select: { id: true },
  });
  if (!row) throw AppError.notFound("Bildirim bulunamadı.", { code: "BILDIRIM_YOK" });
}

function parseId(id: unknown): string {
  const r = z.uuid().safeParse(id);
  if (!r.success) throw AppError.notFound("Bildirim bulunamadı.", { code: "BILDIRIM_YOK" });
  return r.data;
}

export async function markRead(viewer: InboxViewer, rawId: unknown, read: boolean): Promise<{ degisti: boolean }> {
  const id = parseId(rawId);
  const kinds = await viewerKinds(viewer);
  const r = await prisma.notificationInbox.updateMany({
    where: { id, userId: viewer.userId, kind: { in: kinds }, readAt: read ? null : { not: null } },
    data: { readAt: read ? new Date() : null },
  });
  if (r.count === 0) {
    await assertOwnVisible(viewer, id, kinds);
    return { degisti: false };
  }
  ring([viewer.userId], "kutu");
  return { degisti: true };
}

export const SnoozeBody = z.object({ sure: z.enum(SNOOZE_DURATIONS, "Erteleme süresi: 1s · yarin-sabah · shift-sonu") });

async function snoozeUntil(sure: SnoozeDuration, now: Date): Promise<Date> {
  if (sure === "1s") return new Date(now.getTime() + 60 * 60_000);
  if (sure === "yarin-sabah") return factoryMinuteOfDay(now, TOMORROW_MORNING_MINUTE);
  const shift = await loadCurrentShift(prisma, now);
  if (!shift) throw AppError.badRequest("Şu an süren bir shift yok; başka bir süre seçin.", { code: "VARDIYA_YOK" });
  return shift.endsAt;
}

export async function snooze(viewer: InboxViewer, rawId: unknown, body: unknown): Promise<{ erteleBitis: Date }> {
  const id = parseId(rawId);
  const { sure } = SnoozeBody.parse(body);
  const until = await snoozeUntil(sure, new Date());
  const kinds = await viewerKinds(viewer);
  const r = await prisma.notificationInbox.updateMany({
    where: { id, userId: viewer.userId, kind: { in: kinds } },
    data: { snoozedUntil: until },
  });
  if (r.count === 0) throw AppError.notFound("Bildirim bulunamadı.", { code: "BILDIRIM_YOK" });
  ring([viewer.userId], "kutu");
  return { erteleBitis: until };
}

/** Okunmamış sekmesinin TAMAMI (aynı where) okundu olur; dönen `ids` 6 sn geri al için. */
export async function markAllRead(viewer: InboxViewer): Promise<{ ids: string[] }> {
  const kinds = await viewerKinds(viewer);
  const now = new Date();
  const rows = await prisma.notificationInbox.updateManyAndReturn({
    where: buildInboxWhere(viewer.userId, kinds, "okunmamis", { now }),
    data: { readAt: now },
    select: { id: true },
  });
  if (rows.length) ring([viewer.userId], "kutu");
  return { ids: rows.map((r) => r.id).sort() };
}

export const UndoReadBody = z.object({
  ids: z.array(z.uuid("Geçersiz bildirim kimliği")).min(1, "En az bir bildirim seçin").max(UNDO_LIMIT, `En fazla ${UNDO_LIMIT} bildirim`),
});

export async function undoMarkRead(viewer: InboxViewer, body: unknown): Promise<{ ids: string[] }> {
  const { ids } = UndoReadBody.parse(body);
  const kinds = await viewerKinds(viewer);
  const rows = await prisma.notificationInbox.updateManyAndReturn({
    where: { id: { in: ids }, userId: viewer.userId, kind: { in: kinds }, readAt: { not: null } },
    data: { readAt: null },
    select: { id: true },
  });
  if (rows.length) ring([viewer.userId], "kutu");
  return { ids: rows.map((r) => r.id).sort() };
}

// ---- katalog (F1: tercihsiz) ------------------------------------------------

export async function visibleCatalog(viewer: InboxViewer) {
  const env = await loadNotificationVisibilityEnv(prisma);
  const kinds = visibleKindsFor({ permissions: viewer.permissions }, env);
  const yetkiDisi = permissionDeniedKindCount({ permissions: viewer.permissions }, env);
  return {
    turler: kinds.map((k) => {
      const e = getNotificationEntry(k);
      return {
        kod: e.kod, ad: e.ad, sinif: e.sinif, altTur: e.altTur, grup: e.grup, kilit: e.kilit,
        kilitGerekcesi: e.kilitGerekcesi ?? null, kanallar: e.kanallar, varsayilanKanallar: e.varsayilanKanallar,
        kapsam: e.kapsam ?? null,
      };
    }),
    yetkiDisi,
  };
}

// ---- akış oturum doğrulaması -------------------------------------------------

/** Açık ring akışının oturumu hâlâ geçerli mi (verifyToken'ın oturum/tokenVersion ayağı). */
export async function isStreamSessionValid(userId: string, jti: string, tokenVersion: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, tokenVersion: true } });
  if (!user || !user.isActive || user.tokenVersion !== tokenVersion) return false;
  const s = await prisma.session.findUnique({ where: { jti }, select: { userId: true, revokedAt: true, expiresAt: true } });
  return !!s && s.userId === userId && s.revokedAt === null && s.expiresAt.getTime() > Date.now();
}
