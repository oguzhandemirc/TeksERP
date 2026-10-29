// =============================================================================
// İŞLEM ÇEŞİDİ KATALOĞU — gelen belge işlem önerisinin kurşun DIŞI grupları (D4-D1)
// =============================================================================
// Bir BAYRAĞA çeşit olarak bağlı (`variantOfPropertyId`) aktif SEÇİM özellikleri: brode deseni vb.
// Kurşun gramajı burada YOK — o grup `loadKursunGramajOptions` ile ayrı yürür (H9 yanıtı bayt-aynı kalır).
// Onayda öğretilen seçim (PROCESS sözlüğü) herhangi bir aktif çeşit değeri olabilir: kapı `assertProcessChoiceValue`.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
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
    where: { id: valueId, isActive: true, property: { isActive: true, valueType: "CHOICE", variantOfPropertyId: { not: null } } },
  });
  if (ok === 0) {
    throw AppError.badRequest("Seçilen değer bir işlem çeşidine ait değil ya da pasif.", { code: "PROCESS_VALUE_INVALID" });
  }
}
