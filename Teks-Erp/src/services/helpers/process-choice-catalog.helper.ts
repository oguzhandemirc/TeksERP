// =============================================================================
// İŞLEM ÇEŞİDİ KATALOĞU — gelen belge işlem önerisinin kurşun DIŞI grupları (D4-D1)
// =============================================================================
// Bir BAYRAĞA çeşit olarak bağlı (`variantOfPropertyId`) aktif SEÇİM özellikleri: brode deseni vb.
// Kurşun gramajı burada YOK — o grup `loadKursunGramajOptions` ile ayrı yürür (H9 yanıtı bayt-aynı kalır).
// Onayda öğretilen seçim (PROCESS sözlüğü) herhangi bir aktif çeşit değeri olabilir: kapı `assertProcessChoiceValue`.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { decodeOffsetCursor, encodeOffsetCursor } from "../../utils/cursor";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

export interface ProcessChoiceGroup {
  readonly propertyId: string;
  readonly propertyCode: string;
  readonly propertyName: string;
  readonly options: ReadonlyArray<{ id: string; code: string; name: string }>;
}

/**
 * "İşlem değeri" (kurşun gramajı dahil her çeşit değeri) TEK where parçası: aktif değer, aktif SEÇİM özelliği, bir
 * bayrağa çeşit olarak bağlı. Bayrağın kendi `isActive`i bilinçli OKUNMAZ (bugünkü onay/öneri davranışı; ölçüm D4-D2).
 */
export const PROCESS_CHOICE_VALUE_WHERE = {
  isActive: true,
  property: { isActive: true, valueType: "CHOICE", variantOfPropertyId: { not: null } },
} as const satisfies Prisma.FabricPropertyValueWhereInput;

export interface ProcessValueSearchQuery {
  readonly propertyId: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit: number;
}

/**
 * Yüzlerce değerli desen kataloğunda SUNUCU araması (D4-D2): liste + toplam + cursor TEK where'den.
 * Çeşit özelliği değilse 400 (fail-closed) — boş liste "aradığın yok" ile karışmasın.
 */
export async function searchProcessChoiceValues(query: ProcessValueSearchQuery) {
  const property = await prisma.fabricProperty.findFirst({
    where: { id: query.propertyId, ...PROCESS_CHOICE_VALUE_WHERE.property },
    select: { id: true, name: true },
  });
  if (!property) throw AppError.badRequest("Özellik bir işlem çeşidi değil ya da pasif.", { code: "PROCESS_PROPERTY_INVALID" });
  const term = query.q?.trim();
  const where: Prisma.FabricPropertyValueWhereInput = {
    ...PROCESS_CHOICE_VALUE_WHERE,
    propertyId: property.id,
    ...(term ? { OR: [{ code: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] } : {}),
  };
  const offset = decodeOffsetCursor(query.cursor);
  const total = await prisma.fabricPropertyValue.count({ where });
  const rows = await prisma.fabricPropertyValue.findMany({
    where,
    select: { id: true, code: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    skip: offset,
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  return {
    property,
    items: rows.slice(0, query.limit),
    total,
    nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
  };
}

/** Kurşun dışı aktif çeşit özellikleri ve aktif değerleri (değeri olmayan özellik dönmez), sıralı. */
export async function loadProcessChoiceGroups(): Promise<ProcessChoiceGroup[]> {
  const rows = await prisma.fabricProperty.findMany({
    where: { isActive: true, valueType: "CHOICE", variantOf: { code: { not: KURSUN_PROPERTY_CODE } } },
    select: {
      id: true, code: true, name: true,
      values: { where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.filter((r) => r.values.length > 0).map((r) => ({ propertyId: r.id, propertyCode: r.code, propertyName: r.name, options: r.values }));
}

/** Onayda öğretilecek işlem seçimi: bir bayrağın aktif çeşit özelliğinin aktif değeri olmalı (kurşun gramajı dahil) — değilse 400. */
export async function assertProcessChoiceValue(db: Reader, valueId: string): Promise<void> {
  const ok = await db.fabricPropertyValue.count({
    where: { id: valueId, ...PROCESS_CHOICE_VALUE_WHERE },
  });
  if (ok === 0) {
    throw AppError.badRequest("Seçilen değer bir işlem çeşidine ait değil ya da pasif.", { code: "PROCESS_VALUE_INVALID" });
  }
}
