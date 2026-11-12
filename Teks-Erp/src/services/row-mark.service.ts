// =============================================================================
// SATIR İŞARETİ + NOT — kişisel (varsayılan) ya da paylaşılan renk/not.
// Görünürlük: kişinin KENDİ satırı + aktif sahiplerin `shared:true` satırları.
// Yazma yalnız kendi satırına; boşalan satır silinir (KULLANICI_TERCIHI — defter değil,
// hiçbir rapor sayısı türemez; audit muafiyeti `scripts/lib/audit-muafiyeti.ts`).
// =============================================================================
import { Prisma, RowMarkColor } from "@prisma/client";
import prisma from "../lib/prisma";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { ROW_MARK_ENTITY_PERMISSIONS, type RowMarkEntity } from "../constants/row-mark-entities";

export interface RowMarkViewer {
  userId: string;
  permissions: readonly string[];
}

export interface RowMarkView {
  recordId: string;
  color: RowMarkColor | null;
  note: string | null;
  shared: boolean;
  mine: boolean;
  ownerName: string | null;
  updatedAt: Date;
}

/** Tür kapısı: tanınmayan tür 400, okuma izni yoksa 403 (işaret kaydın varlığını sızdırmasın). */
export function assertRowMarkAccess(viewer: RowMarkViewer, entityType: string): RowMarkEntity {
  if (!Object.prototype.hasOwnProperty.call(ROW_MARK_ENTITY_PERMISSIONS, entityType)) {
    throw AppError.badRequest(`İşaretlenemeyen kayıt türü: ${entityType}`, { code: "ROW_MARK_ENTITY_UNKNOWN" });
  }
  const entity = entityType as RowMarkEntity;
  const permission = ROW_MARK_ENTITY_PERMISSIONS[entity];
  if (!matchesPermission([...viewer.permissions], permission)) {
    throw AppError.forbidden(`Bu işlem için '${permission}' yetkisi gerekli.`);
  }
  return entity;
}

const VIEW_SELECT = {
  recordId: true,
  color: true,
  note: true,
  shared: true,
  userId: true,
  updatedAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.RowMarkSelect;

function toView(viewer: RowMarkViewer, r: Prisma.RowMarkGetPayload<{ select: typeof VIEW_SELECT }>): RowMarkView {
  const mine = r.userId === viewer.userId;
  return {
    recordId: r.recordId,
    color: r.color,
    note: r.note,
    shared: r.shared,
    mine,
    ownerName: mine ? null : r.user.fullName,
    updatedAt: r.updatedAt,
  };
}

/** Görünen kimliklerin işaretleri — kendi satırı önce, sonra paylaşılanlar (en yeni önce). */
export async function lookupRowMarks(viewer: RowMarkViewer, entityType: string, recordIds: string[]): Promise<RowMarkView[]> {
  const entity = assertRowMarkAccess(viewer, entityType);
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return [];
  const rows = await prisma.rowMark.findMany({
    where: {
      entityType: entity,
      recordId: { in: ids },
      OR: [{ userId: viewer.userId }, { shared: true, user: { isActive: true } }],
    },
    select: VIEW_SELECT,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const views = rows.map((r) => toView(viewer, r));
  return [...views.filter((v) => v.mine), ...views.filter((v) => !v.mine)];
}

export interface RowMarkInput {
  entityType: string;
  recordId: string;
  color: RowMarkColor | null;
  note: string | null;
  shared: boolean;
}

/** Kendi işaretini yaz: renk + not boşsa satır silinir; aksi halde tekil upsert (ON CONFLICT). */
export async function putRowMark(viewer: RowMarkViewer, input: RowMarkInput): Promise<RowMarkView | null> {
  const entity = assertRowMarkAccess(viewer, input.entityType);
  const note = input.note?.trim() ? input.note.trim() : null;
  const key = { userId: viewer.userId, entityType: entity, recordId: input.recordId };
  if (input.color === null && note === null) {
    // KULLANICI_TERCIHI: kişinin kendi boş işaret satırı — defter değil, silme durum geçişi gerektirmez.
    await prisma.rowMark.deleteMany({ where: key });
    return null;
  }
  const data = { color: input.color, note, shared: input.shared };
  const write = () =>
    prisma.rowMark.upsert({
      where: { userId_entityType_recordId: key },
      create: { ...key, ...data },
      update: data,
      select: VIEW_SELECT,
    });
  try {
    return toView(viewer, await write());
  } catch (e) {
    // Yerel upsert ON CONFLICT'tir; yine de yarışta P2002 dönerse satır artık var → ikinci deneme günceller.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return toView(viewer, await write());
    throw e;
  }
}

/** "İşaretlilerim" süzgeci: kendi işaretli kayıt kimlikleri (renk süzgeçli), cursor sayfalı. */
export async function listMyRowMarkIds(
  viewer: RowMarkViewer,
  entityType: string,
  opts: { color?: RowMarkColor; cursor?: string; limit: number },
): Promise<{ recordIds: string[]; nextCursor: string | null; hasMore: boolean }> {
  const entity = assertRowMarkAccess(viewer, entityType);
  const rows = await prisma.rowMark.findMany({
    where: { userId: viewer.userId, entityType: entity, ...(opts.color ? { color: opts.color } : {}) },
    select: { id: true, recordId: true },
    orderBy: { id: "asc" },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return { recordIds: page.map((r) => r.recordId), nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}
