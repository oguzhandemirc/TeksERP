// =============================================================================
// TeksERP — Tedarikçi kalem kodu ↔ iplik kartı eşlemesi (Seyitoğlu d5)
// =============================================================================
// Tedarikçi irsaliyesindeki kalem kodu ("153.01.0652") mal kabulde bizim iplik kartımıza ÖNERİLİR;
// kabul kaydında (tedarikçi, kod) → kart ÖĞRENİLİR (son kabul kazanır). Saf yapılandırma pivotu:
// kaldırma sert silmedir + audit. Öğrenme mal kabul tx'inin DIŞINDA ve best-effort — eşleme yazılamazsa
// kabul düşmez. Anahtar katlaması TEK kaynak `supplierItemCodeKey` (öğrenme ve öneri aynı fonksiyon).
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { uyari } from "../lib/logger";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assertItemUsable } from "./helpers/item-usage.helper";

export const SUPPLIER_ITEM_CODE_TABLE = "SUPPLIER_ITEM_CODE";
/** `SupplierItemCode.codeKey/rawCode` VarChar(64). */
export const SUPPLIER_ITEM_CODE_MAX = 64;

/** Ham kodun saklanan yazımı — TRIM + iç boşluk tekleşir; boş → null. */
export function normalizeSupplierItemCode(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SUPPLIER_ITEM_CODE_MAX);
  return s.length > 0 ? s : null;
}

/** Eşleme anahtarı — TEK kaynak: boşluklar silinir, büyük harf ("ab-12 " = "AB-12"). Kod ASCII; TR katlaması gerekmez. */
export function supplierItemCodeKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase().slice(0, SUPPLIER_ITEM_CODE_MAX);
}

const ROW_SELECT = {
  id: true,
  supplierId: true,
  codeKey: true,
  rawCode: true,
  itemId: true,
  hitCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  item: { select: { id: true, code: true, name: true, itemType: true } },
} satisfies Prisma.SupplierItemCodeSelect;

export type SupplierItemCodeDto = Prisma.SupplierItemCodeGetPayload<{ select: typeof ROW_SELECT }>;

export interface SupplierItemCodeSuggestion {
  code: string | null;
  /** Eşli ve kullanılabilir kart; yoksa null (kullanıcı seçer, kayıtta öğrenilir). */
  match: { id: string; itemId: string; itemCode: string; itemName: string; hitCount: number } | null;
}

/** Öneri — YAZMAZ. Pasif/arşiv ya da iplik olmayan karta düşmüş eşleme önerilmez. */
export async function suggestSupplierItemCode(supplierId: string, code: string): Promise<SupplierItemCodeSuggestion> {
  const raw = normalizeSupplierItemCode(code);
  const codeKey = supplierItemCodeKey(raw);
  if (!raw || !codeKey) return { code: null, match: null };
  const row = await prisma.supplierItemCode.findUnique({
    where: { supplierId_codeKey: { supplierId, codeKey } },
    select: { id: true, itemId: true, hitCount: true, item: { select: { code: true, name: true, itemType: true } } },
  });
  if (!row || row.item.itemType !== ItemType.YARN) return { code: raw, match: null };
  const usable = await assertItemUsable(prisma, row.itemId, "NEW_STOCK").then(() => true, () => false);
  if (!usable) return { code: raw, match: null };
  return { code: raw, match: { id: row.id, itemId: row.itemId, itemCode: row.item.code, itemName: row.item.name, hitCount: row.hitCount } };
}

export async function listSupplierItemCodes(filter: { supplierId?: string; itemId?: string }): Promise<SupplierItemCodeDto[]> {
  return prisma.supplierItemCode.findMany({
    where: { ...(filter.supplierId ? { supplierId: filter.supplierId } : {}), ...(filter.itemId ? { itemId: filter.itemId } : {}) },
    orderBy: [{ rawCode: "asc" }, { id: "asc" }],
    take: 1000,
    select: ROW_SELECT,
  });
}

type LearnRow = { id: string; hitCount: number; inserted: boolean; prevItemId: string | null };

/**
 * Tek eşleme öğrenmesi — TEK İFADE: eşzamanlı iki kabul aynı kodu yazarsa çift satır doğmaz, ikisi de sayılır
 * (`supplier_item_codes_supplierId_codeKey_key`). Son yazan kazanır. Kart doğrulaması çağıranda (mal kabul satırı).
 */
export async function learnSupplierItemCode(input: { supplierId: string; rawCode: string; itemId: string }, userId?: string): Promise<void> {
  const rawCode = normalizeSupplierItemCode(input.rawCode);
  const codeKey = supplierItemCodeKey(rawCode);
  if (!rawCode || !codeKey) return;
  // `prevItemId` yalnız audit için (ifadenin anlık görüntüsü; ayak izi, karar değil).
  const [row] =await prisma.$queryRaw<LearnRow[]>(Prisma.sql`
    WITH prev AS (
      SELECT "itemId" FROM "supplier_item_codes" WHERE "supplierId" = ${input.supplierId}::uuid AND "codeKey" = ${codeKey}
    )
    INSERT INTO "supplier_item_codes" ("id", "supplierId", "codeKey", "rawCode", "itemId", "hitCount", "lastUsedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${input.supplierId}::uuid, ${codeKey}, ${rawCode}, ${input.itemId}::uuid, 1, now(), now(), now()) -- tz-ok: kolonlar timestamptz; ham INSERT @default/@updatedAt kancasını atlar
    ON CONFLICT ("supplierId", "codeKey") DO UPDATE
      SET "itemId" = EXCLUDED."itemId", "rawCode" = EXCLUDED."rawCode", "hitCount" = "supplier_item_codes"."hitCount" + 1,
          "lastUsedAt" = now(), "updatedAt" = now() -- tz-ok: kolonlar timestamptz; ham UPDATE @updatedAt kancasını atlar
    RETURNING "id", "hitCount", (xmax = 0) AS "inserted", (SELECT "itemId" FROM prev) AS "prevItemId"`);
  if (!row) return;
  const newData = { supplierId: input.supplierId, codeKey, rawCode, itemId: input.itemId, hitCount: row.hitCount };
  if (row.inserted) {
    await AuditService.log({ userId, action: "CREATE", tableName: SUPPLIER_ITEM_CODE_TABLE, recordId: row.id, newData });
  } else if (row.prevItemId !== input.itemId) {
    await AuditService.log({ userId, action: "UPDATE", tableName: SUPPLIER_ITEM_CODE_TABLE, recordId: row.id, oldData: { itemId: row.prevItemId }, newData });
  }
}

/** Mal kabul sonrası toplu öğrenme — best-effort: hata kabulü DÜŞÜRMEZ, yalnız uyarı loglanır. */
export async function learnSupplierItemCodesSafely(
  supplierId: string | null,
  pairs: Array<{ rawCode: string | null | undefined; itemId: string }>,
  userId?: string,
): Promise<void> {
  if (!supplierId) return;
  for (const p of pairs) {
    if (!normalizeSupplierItemCode(p.rawCode)) continue;
    try {
      await learnSupplierItemCode({ supplierId, rawCode: p.rawCode as string, itemId: p.itemId }, userId);
    } catch (err) {
      uyari("supplier-item-code", "Tedarikçi kalem kodu öğrenilemedi (kabul etkilenmedi)", err instanceof Error ? err.message : err);
    }
  }
}

async function assertYarnTarget(itemId: string): Promise<void> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { name: true, itemType: true } });
  if (!item) throw AppError.badRequest("İplik kartı bulunamadı.", { code: "SUPPLIER_ITEM_CODE_ITEM_NOT_FOUND" });
  if (item.itemType !== ItemType.YARN) {
    throw AppError.badRequest(`"${item.name}" iplik kartı değil — tedarikçi kalem kodu yalnız iplik kartına eşlenir.`, { code: "SUPPLIER_ITEM_CODE_NOT_YARN" });
  }
  await assertItemUsable(prisma, itemId, "DEFINITION");
}

const notFound = () => AppError.notFound("Tedarikçi kalem kodu bulunamadı.", { code: "SUPPLIER_ITEM_CODE_NOT_FOUND" });
const changed = () => AppError.conflict("Eşleme bu arada değişti — listeyi yenileyip tekrar deneyin.", { code: "SUPPLIER_ITEM_CODE_CHANGED" });

/** Düzelt — eşlemeyi başka iplik kartına bağlar. Okunan satıra bağlı koşullu yazım (arada değiştiyse 409). */
export async function updateSupplierItemCode(id: string, input: { itemId: string }, userId?: string): Promise<SupplierItemCodeDto> {
  const before = await prisma.supplierItemCode.findUnique({ where: { id }, select: { id: true, itemId: true, supplierId: true, codeKey: true } });
  if (!before) throw notFound();
  await assertYarnTarget(input.itemId);
  if (before.itemId !== input.itemId) {
    const c = await prisma.supplierItemCode.updateMany({ where: { id, itemId: before.itemId }, data: { itemId: input.itemId } });
    if (c.count === 0) throw changed();
    await AuditService.log({
      userId, action: "UPDATE", tableName: SUPPLIER_ITEM_CODE_TABLE, recordId: id,
      oldData: { itemId: before.itemId }, newData: { supplierId: before.supplierId, codeKey: before.codeKey, itemId: input.itemId },
    });
  }
  return prisma.supplierItemCode.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
}

/** Kaldır — saf yapılandırma pivotu SERT SİLMESİ (mal kabul hareketindeki ham kod izi kalır). */
export async function removeSupplierItemCode(id: string, userId?: string): Promise<{ id: string }> {
  const before = await prisma.supplierItemCode.findUnique({ where: { id }, select: { id: true, itemId: true, supplierId: true, codeKey: true, rawCode: true } });
  if (!before) throw notFound();
  const c = await prisma.supplierItemCode.deleteMany({ where: { id, itemId: before.itemId } });
  if (c.count === 0) throw changed();
  await AuditService.log({
    userId, action: "DELETE", tableName: SUPPLIER_ITEM_CODE_TABLE, recordId: id,
    oldData: { supplierId: before.supplierId, codeKey: before.codeKey, rawCode: before.rawCode, itemId: before.itemId },
  });
  return { id };
}
