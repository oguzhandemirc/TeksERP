// K3d: virmanla birleşmiş (pasif + `mergedIntoId`) hesap DONMUŞTUR — kalemleri hedefe taşındı.
// Kaynağa yeni defter satırı ya da kapama yazmak bakiyeyi çözücülerin görmediği hesapta parçalar
// (risk/kilit süzgeci `mergedIntoId: null`); yazım/kapama yolları bu TEK yüklemle 409 verir.
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

export async function assertCariNotMergedTx(tx: Prisma.TransactionClient, cariIds: string[]): Promise<void> {
  const ids = [...new Set(cariIds)];
  if (ids.length === 0) return;
  const merged = await tx.cariAccount.findFirst({ where: { id: { in: ids }, mergedIntoId: { not: null } }, select: { id: true } });
  if (merged) {
    throw AppError.conflict("Bu cari hesap başka bir hesaba birleştirilmiş (virman) — işlemi asıl hesapta yapın ya da önce birleştirmeyi geri alın.", { code: "CARI_MERGED", cariId: merged.id });
  }
}
