// =============================================================================
// CARİ BİRLEŞTİRME VİRMANININ TERS YOLU (K3d) — storno, silme değil
// =============================================================================
// Birleşmenin her bacağı `CARI_TRANSFER_CANCEL` ile terslenir (`reversesTxnId` partial unique = çift storno
// imkânsız), kaynak yeniden aktif + `mergedIntoId` null. İleri kayıt ne silinir ne değişir; ters satır bugüne.
// Kaynakta birleşmeden SONRA hareket varsa 409 + liste (o hareket asıl hesapta yaşamalıydı — kullanıcı kararı).
// Taşınan TASLAK faturalar asıl hesapta kalır (aynı kartın taslağı; deftere yazmamış).
// =============================================================================
import { CariTxnSource, Currency, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { D, applyCariBalanceTx } from "./finance.helper";
import { assertPeriodsOpenTx } from "./period-guard.helper";

export interface CariMergeRevertResult {
  targetId: string;
  reversedLegs: number;
}

/** Birleşmiş kaynağı geri açar. Zaten açılmışsa 409 `CARI_MERGE_NOT_MERGED`. */
export async function revertCariMerge(sourceId: string, reason: string, userId?: string): Promise<CariMergeRevertResult> {
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw AppError.badRequest("Geri alma gerekçesi zorunlu (en az 3 karakter).");
  const source = await prisma.cariAccount.findUnique({ where: { id: sourceId }, select: { mergedIntoId: true } });
  if (!source) throw AppError.notFound("Cari hesap bulunamadı.");
  if (!source.mergedIntoId) throw AppError.conflict("Bu hesap birleşmiş değil.", { code: "CARI_MERGE_NOT_MERGED" });
  const targetId = source.mergedIntoId;
  // Birleşmenin bacakları: kaynaktaki terslenmemiş CARI_TRANSFER bacağının grubu (birleşme başına tek grup).
  const groupRows = await prisma.cariTransaction.findMany({
    where: { cariId: sourceId, sourceType: CariTxnSource.CARI_TRANSFER, reversedBy: { is: null } },
    select: { transferGroupId: true },
    distinct: ["transferGroupId"],
  });
  const groupIds = groupRows.map((g) => g.transferGroupId).filter((g): g is string => g != null);
  const legs = groupIds.length === 0 ? [] : await prisma.cariTransaction.findMany({
    where: { transferGroupId: { in: groupIds }, sourceType: CariTxnSource.CARI_TRANSFER, reversedBy: { is: null } },
    select: { id: true, cariId: true, currency: true, debit: true, credit: true, amountTry: true, exchangeRate: true, invoiceId: true, transferGroupId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const currencies = [...new Set(legs.map((l) => l.currency))].sort() as Currency[];
  const now = new Date();
  const reversed = await prisma.$transaction(async (tx) => {
    // TX'İN İLK İFADESİ: iki hesabın dönem kilitleri (sıralı) + bugün kapalıysa 409.
    await assertPeriodsOpenTx(tx, currencies.flatMap((currency) => [sourceId, targetId].map((cariId) => ({ cariId, currency, txnDate: now }))));
    if (legs.length > 0) {
      const mergedAt = legs[0]!.createdAt;
      const after = await tx.cariTransaction.findMany({
        where: { cariId: sourceId, createdAt: { gte: mergedAt }, OR: [{ transferGroupId: null }, { transferGroupId: { notIn: groupIds } }] },
        select: { sourceType: true, description: true, txnDate: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (after.length > 0) {
        throw AppError.conflict(`Kaynak hesapta birleşmeden sonra ${after.length} hareket var — geri alma yapılmaz.`, {
          code: "CARI_MERGE_MOVED_AFTER",
          movements: after.map((m) => `${m.sourceType} ${m.description ?? ""}`.trim()),
        });
      }
    }
    // ATOMİK CLAIM: hâlâ bu hedefe birleşmiş pasif kaynak; eşzamanlı ikinci geri alma 0 satır → 409.
    const claim = await tx.cariAccount.updateMany({ where: { id: sourceId, mergedIntoId: targetId, isActive: false }, data: { isActive: true, mergedIntoId: null } });
    if (claim.count === 0) throw AppError.conflict("Birleşme bu sırada geri alındı.", { code: "CARI_MERGE_NOT_MERGED" });
    const rows: Prisma.CariTransactionCreateManyInput[] = legs.map((l) => ({
      cariId: l.cariId,
      currency: l.currency,
      txnDate: now,
      debit: D(l.credit),
      credit: D(l.debit),
      amountTry: D(l.amountTry),
      exchangeRate: D(l.exchangeRate),
      sourceType: CariTxnSource.CARI_TRANSFER_CANCEL,
      invoiceId: l.invoiceId,
      transferGroupId: l.transferGroupId,
      reversesTxnId: l.id,
      description: `Birleştirme virmanı stornosu — ${why}`.slice(0, 300),
      createdById: userId ?? null,
    }));
    if (rows.length > 0) await tx.cariTransaction.createMany({ data: rows });
    const deltas = new Map<string, Prisma.Decimal>();
    for (const l of legs) {
      const k = `${l.cariId}|${l.currency}`;
      deltas.set(k, (deltas.get(k) ?? D(0)).plus(D(l.credit)).minus(D(l.debit)));
    }
    for (const [k, delta] of [...deltas.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const [cariId, currency] = k.split("|") as [string, Currency];
      await applyCariBalanceTx(tx, cariId, currency, delta);
    }
    return rows.length;
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: sourceId, newData: { event: "CARI_MERGE_REVERT", formerTargetId: targetId, reversedLegs: reversed, reason: why } });
  return { targetId, reversedLegs: reversed };
}
