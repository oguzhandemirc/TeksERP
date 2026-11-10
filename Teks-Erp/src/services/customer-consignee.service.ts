// =============================================================================
// Alıcı kataloğu (`CustomerConsignee`, 2026-11-10) — müşterimizin müşterisi; etikete basılan ad.
// =============================================================================
// Bizim carimiz DEĞİL (MV-01): sahip `Customer`ın altında bir ad; sahip başına katlanmış ad tekil
// (DB partial unique, mezar taşı hariç). `ensure` doğal anahtarla idempotenttir (aynı ad = aynı kayıt;
// clientToken gerekmez). Pasife alma MV-06 kapılı: canlı top → 409 + liste, çıkış yolu birleştirme
// (`customer-consignee-merge.service.ts`). Canlı top tanımı TEK kaynak `consigneeLiveRollWhere`.
// Audit tx dışında, best-effort.
// =============================================================================
import { LabelKind, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { normalizeDisplayName } from "./helpers/name-normalize.helper";
import { LABEL_TEXT_LOCKED_STATUSES } from "./inventory/label-texts";
import { assertTemplateAssignable } from "./label-template.service";

const TABLE = "CUSTOMER_CONSIGNEE";
export const CONSIGNEE_NAME_MAX = 80;

/** Alıcı satırının istemciye dönen biçimi. */
export const CONSIGNEE_SELECT = {
  id: true, customerId: true, name: true, isActive: true, mergedIntoId: true, labelTemplateId: true,
  labelTemplate: { select: { id: true, name: true } }, createdAt: true, updatedAt: true,
} satisfies Prisma.CustomerConsigneeSelect;
export type ConsigneeRow = Prisma.CustomerConsigneeGetPayload<{ select: typeof CONSIGNEE_SELECT }>;

/** Alıcı adı: müşteri adı zinciriyle aynı biçim (trim + tek boşluk + TR büyük harf); 1–80. */
export function normalizeConsigneeName(raw: unknown): string {
  const t = typeof raw === "string" ? normalizeDisplayName(raw) : "";
  if (t.length === 0) throw AppError.badRequest("Alıcı adı boş olamaz.", { code: "CONSIGNEE_NAME_INVALID" });
  if (t.length > CONSIGNEE_NAME_MAX) {
    throw AppError.badRequest(`Alıcı adı en çok ${CONSIGNEE_NAME_MAX} karakter olabilir.`, { code: "CONSIGNEE_NAME_INVALID" });
  }
  return t;
}

/**
 * CANLI TOP (MV-06) — kapı, önizleme ve birleştirmenin TEK tanımı: alıcısı bu kümeden olan ve etiketi
 * hâlâ düzeltilebilir top (sevk/fason/kartela dışarıda ya da ölü değil; `labelTextFixBlock` kümesi).
 */
export function consigneeLiveRollWhere(consigneeIds: string[]): Prisma.RollWhereInput {
  return { labelConsigneeId: { in: consigneeIds }, status: { notIn: [...LABEL_TEXT_LOCKED_STATUSES] } };
}

/** Canlı topların ön izleme satırları (her top tek tek; sayıya indirgenmez). */
export async function liveRollsOf(consigneeIds: string[]) {
  const rows = await prisma.roll.findMany({
    where: consigneeLiveRollWhere(consigneeIds),
    select: { id: true, barcode: true, currentQty: true, status: true, labelPrintedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, barcode: r.barcode, meters: Number(r.currentQty), status: r.status, printed: r.labelPrintedAt != null }));
}

async function assertOwnerUsable(customerId: string): Promise<void> {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, mergedIntoId: true } });
  if (!c) throw AppError.notFound("Müşteri bulunamadı");
  if (c.mergedIntoId) throw AppError.conflict("Bu müşteri başka bir karta birleştirilmiş — alıcıyı güncel kartta tanımlayın.", { code: "CUSTOMER_MERGED" });
}

async function loadLive(id: string): Promise<ConsigneeRow> {
  const row = await prisma.customerConsignee.findUnique({ where: { id }, select: CONSIGNEE_SELECT });
  if (!row) throw AppError.notFound("Alıcı bulunamadı");
  if (row.mergedIntoId) throw AppError.conflict("Bu alıcı başka bir alıcıya birleştirilmiş.", { code: "CONSIGNEE_MERGED", mergedIntoId: row.mergedIntoId });
  return row;
}

/** Mezar taşı zincirini canlı kayda çözer (birleştirme zinciri kısa; döngüye karşı 8 adım sınırı). */
export async function resolveConsigneeChain(id: string): Promise<{ id: string; customerId: string; isActive: boolean; name: string } | null> {
  let cur = await prisma.customerConsignee.findUnique({ where: { id }, select: { id: true, customerId: true, isActive: true, name: true, mergedIntoId: true } });
  for (let i = 0; cur?.mergedIntoId && i < 8; i++) {
    cur = await prisma.customerConsignee.findUnique({ where: { id: cur.mergedIntoId }, select: { id: true, customerId: true, isActive: true, name: true, mergedIntoId: true } });
  }
  return cur && !cur.mergedIntoId ? { id: cur.id, customerId: cur.customerId, isActive: cur.isActive, name: cur.name } : null;
}

/** Sahibin alıcıları — son kullanılan önce (canlı + geçmiş toplarda en yeni kesim), sonra ada göre. */
export async function listConsignees(customerId: string, opts: { search?: string; includeInactive?: boolean }) {
  const search = opts.search?.trim() ?? "";
  const rows = await prisma.$queryRaw<Array<{ id: string; lastUsedAt: Date | null; liveRollCount: number }>>`
    SELECT c.id,
           (SELECT max(r."createdAt") FROM "rolls" r WHERE r."labelConsigneeId" = c.id) AS "lastUsedAt",
           (SELECT count(*)::int FROM "rolls" r WHERE r."labelConsigneeId" = c.id
              AND r."status" <> ALL(${[...LABEL_TEXT_LOCKED_STATUSES] as string[]}::"RollStatus"[])) AS "liveRollCount"
      FROM "customer_consignees" c
     WHERE c."customerId" = ${customerId}::uuid AND c."mergedIntoId" IS NULL
       AND (${opts.includeInactive === true} OR c."isActive")
       AND (${search} = '' OR c."nameFold" LIKE '%' || public.tr_fold(${search}) || '%')
     ORDER BY "lastUsedAt" DESC NULLS LAST, c."nameFold" ASC, c.id ASC
     LIMIT 200`;
  const byId = new Map((await prisma.customerConsignee.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: CONSIGNEE_SELECT })).map((r) => [r.id, r]));
  return rows.flatMap((r) => {
    const c = byId.get(r.id);
    return c ? [{ ...c, lastUsedAt: r.lastUsedAt, liveRollCount: r.liveRollCount }] : [];
  });
}

/**
 * Doğal anahtarla idempotent doğum: canlı aynı katlanmış ad → o kayıt (pasifse yeniden aktifleşir) ·
 * yalnız mezar taşında varsa → hedefi · yoksa `INSERT … ON CONFLICT DO NOTHING` (paralel iki istek tek satır).
 */
export async function ensureConsignee(customerId: string, rawName: unknown, userId?: string): Promise<{ consignee: ConsigneeRow; created: boolean; reactivated: boolean }> {
  const name = normalizeConsigneeName(rawName);
  await assertOwnerUsable(customerId);
  const findLive = () => prisma.$queryRaw<Array<{ id: string; isActive: boolean }>>`
    SELECT id, "isActive" FROM "customer_consignees"
     WHERE "customerId" = ${customerId}::uuid AND "mergedIntoId" IS NULL AND "nameFold" = public.tr_fold(${name}) LIMIT 1`;
  let live = (await findLive())[0];
  if (!live) {
    const tomb = (await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "customer_consignees"
       WHERE "customerId" = ${customerId}::uuid AND "mergedIntoId" IS NOT NULL AND "nameFold" = public.tr_fold(${name})
       ORDER BY "mergedAt" DESC NULLS LAST, id ASC LIMIT 1`)[0];
    const target = tomb ? await resolveConsigneeChain(tomb.id) : null;
    if (target) live = { id: target.id, isActive: target.isActive };
  }
  if (!live) {
    const born = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "customer_consignees" ("id", "customerId", "name", "isActive", "createdById", "updatedById", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${customerId}::uuid, ${name}, true, ${userId ?? null}::uuid, ${userId ?? null}::uuid, now(), now()) -- tz-ok: timestamptz damgası
      ON CONFLICT ("customerId", "nameFold") WHERE "mergedIntoId" IS NULL DO NOTHING
      RETURNING id`;
    if (born[0]) {
      const consignee = await loadLive(born[0].id);
      await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: consignee.id, newData: { customerId, name, event: "CONSIGNEE_ENSURE" } });
      return { consignee, created: true, reactivated: false };
    }
    live = (await findLive())[0];
    if (!live) throw AppError.conflict("Alıcı kaydı bu arada değişti — tekrar deneyin.", { code: "CONSIGNEE_CHANGED" });
  }
  let reactivated = false;
  if (!live.isActive) {
    const { count } = await prisma.customerConsignee.updateMany({ where: { id: live.id, isActive: false, mergedIntoId: null }, data: { isActive: true, updatedById: userId ?? null } });
    reactivated = count === 1;
    if (reactivated) await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: live.id, oldData: { isActive: false }, newData: { isActive: true, event: "CONSIGNEE_REACTIVATE_BY_ENSURE" } });
  }
  return { consignee: await loadLive(live.id), created: false, reactivated };
}

/** Yeniden adlandır — atomik claim; katlanmış ad çakışırsa 409 + `conflictId` ("birleştirin"). Basılmış canlı top bayatlar. */
export async function renameConsignee(id: string, rawName: unknown, userId?: string): Promise<ConsigneeRow> {
  const name = normalizeConsigneeName(rawName);
  const cur = await loadLive(id);
  const clash = (await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "customer_consignees" WHERE "customerId" = ${cur.customerId}::uuid AND "mergedIntoId" IS NULL
       AND "nameFold" = public.tr_fold(${name}) AND id <> ${id}::uuid LIMIT 1`)[0];
  if (clash) throw AppError.conflict("Bu adla başka bir alıcı var — ikisini birleştirin.", { code: "CONSIGNEE_NAME_TAKEN", conflictId: clash.id });
  if (cur.name === name) return cur;
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.customerConsignee.updateMany({ where: { id, mergedIntoId: null, name: cur.name }, data: { name, updatedById: userId ?? null } });
      if (count === 0) throw AppError.conflict("Alıcı bu arada değişti — yenileyip tekrar deneyin.", { code: "CONSIGNEE_CHANGED" });
      await tx.roll.updateMany({ where: { ...consigneeLiveRollWhere([id]), labelPrintedAt: { not: null }, labelDirty: false }, data: { labelDirty: true } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw AppError.conflict("Bu adla başka bir alıcı var — ikisini birleştirin.", { code: "CONSIGNEE_NAME_TAKEN" });
    }
    throw e;
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { name: cur.name }, newData: { name, event: "CONSIGNEE_RENAME" } });
  return loadLive(id);
}

/** Pasife al (MV-06): canlı topu varsa 409 `CONSIGNEE_IN_USE` + toplar tek tek; çıkış yolu birleştirme. */
export async function deactivateConsignee(id: string, userId?: string): Promise<ConsigneeRow> {
  const cur = await loadLive(id);
  if (!cur.isActive) return cur;
  const rolls = await liveRollsOf([id]);
  if (rolls.length > 0) {
    throw AppError.conflict(`Bu alıcının ${rolls.length} canlı topu var — pasife almak yerine başka bir alıcıyla birleştirin.`, { code: "CONSIGNEE_IN_USE", rolls });
  }
  const { count } = await prisma.customerConsignee.updateMany({ where: { id, isActive: true, mergedIntoId: null }, data: { isActive: false, updatedById: userId ?? null } });
  if (count === 0) throw AppError.conflict("Alıcı bu arada değişti — yenileyip tekrar deneyin.", { code: "CONSIGNEE_CHANGED" });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { isActive: true }, newData: { isActive: false, event: "CONSIGNEE_DEACTIVATE" } });
  return loadLive(id);
}

export async function activateConsignee(id: string, userId?: string): Promise<ConsigneeRow> {
  const cur = await loadLive(id);
  if (cur.isActive) return cur;
  const { count } = await prisma.customerConsignee.updateMany({ where: { id, isActive: false, mergedIntoId: null }, data: { isActive: true, updatedById: userId ?? null } });
  if (count === 0) throw AppError.conflict("Alıcı bu arada değişti — yenileyip tekrar deneyin.", { code: "CONSIGNEE_CHANGED" });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { isActive: false }, newData: { isActive: true, event: "CONSIGNEE_ACTIVATE" } });
  return loadLive(id);
}

/** Alıcıya bağlı etiket şablonu (K4) — null kaldırır. Atama kuralı diğer setter'larla aynı (`assertTemplateAssignable`). */
export async function setConsigneeTemplate(id: string, templateId: string | null, userId?: string): Promise<ConsigneeRow> {
  const cur = await loadLive(id);
  if (templateId) {
    const t = await prisma.labelTemplate.findFirst({ where: { id: templateId, deletedAt: null, isActive: true }, select: { id: true } });
    if (!t) throw AppError.badRequest("Etiket şablonu bulunamadı ya da pasif.", { code: "TEMPLATE_NOT_FOUND" });
    await assertTemplateAssignable(templateId, LabelKind.ROLL_FINISHED);
  }
  if (cur.labelTemplateId === templateId) return cur;
  const { count } = await prisma.customerConsignee.updateMany({ where: { id, mergedIntoId: null, labelTemplateId: cur.labelTemplateId }, data: { labelTemplateId: templateId, updatedById: userId ?? null } });
  if (count === 0) throw AppError.conflict("Alıcı bu arada değişti — yenileyip tekrar deneyin.", { code: "CONSIGNEE_CHANGED" });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { labelTemplateId: cur.labelTemplateId }, newData: { labelTemplateId: templateId, event: "CONSIGNEE_TEMPLATE" } });
  return loadLive(id);
}
