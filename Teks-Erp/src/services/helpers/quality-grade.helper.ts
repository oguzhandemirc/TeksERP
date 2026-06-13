import { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type TxOrPrisma = PrismaClient | Prisma.TransactionClient;

/**
 * `Roll.qualityGrade` (snapshot string) yazıldığında karşılık gelen
 * `QualityGrade.id`'yi (canonical FK) bulur. Katalog değişse bile
 * eski roll'lar referansını korur.
 *
 * Bilinmeyen kod / null döner: yeni Roll satırında `qualityGradeId = null`
 * kalır; rapor tarafında `qualityGradeRef` join'i null gelir, snapshot
 * string fallback olarak gösterilir.
 */
export async function resolveQualityGradeId(
  code: string,
  client: TxOrPrisma = prisma,
): Promise<string | null> {
  const row = await client.qualityGrade.findUnique({
    where: { code },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * OPERATÖR GİRDİSİ kalite kodları için SIKI çözümleme (soft-delete giriş
 * guard'ı): katalogda yoksa veya pasifse Türkçe 400. Typo'lu bir kod ("FİRE"
 * gibi) sessizce katalog-dışı snapshot olarak yazılıp FIRE-dışlama
 * filtrelerinden kaçamaz; pasifleştirilmiş kaliteyle yeni top üretilemez.
 * Sistem-türetimli kodlar (parent snapshot'ı, "1.KALITE"/"FIRE" sabitleri)
 * için lenient `resolveQualityGradeId` kullanılmaya devam eder.
 */
export async function resolveQualityGradeIdStrict(
  code: string,
  client: TxOrPrisma = prisma,
): Promise<string> {
  const row = await client.qualityGrade.findUnique({
    where: { code },
    select: { id: true, isActive: true },
  });
  if (!row) {
    throw AppError.badRequest(`Kalite sınıfı bulunamadı: ${code}`);
  }
  if (!row.isActive) {
    throw AppError.badRequest(`Kalite sınıfı pasif: ${code}`);
  }
  return row.id;
}
