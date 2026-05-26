import { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../lib/prisma";

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
