// =============================================================================
// KASA HAREKETİ SERVİSİ — carisiz para hareketleri
// =============================================================================
// Kapsam: masraf/gelir fişi · kasalar arası virman · açılış (devir) bakiyesi.
//
// ⚠️ NEDEN `Payment` DEĞİL: `Payment`'ın sözleşmesi "cari deftere satır +
// cari bakiye + kasa bakiyesi AYNI tx'te oynar"dır ve bu sözleşme storno,
// kapama ve ekstre yollarının hepsinde varsayılır. Kira ödemesinin carisi
// YOKTUR; `cariId`yi nullable yapmak en hassas yolun her okumasına sessiz bir
// dal eklerdi. Ayrım ekranı da doğru böler: Tahsilat/Ödeme = CARİ hareketi,
// Kasa Hareketleri = kasanın kendi defteri.
//
// ⚠️ KASA BAKİYESİNİN İKİNCİ YAZARI BURASIDIR. `test_consistency` §23/§24
// sorguları Payment + CashTransaction'ı BİRLİKTE toplar — yalnız birine bakan
// bir mutabakat, diğer yazarın hareketlerini "drift" sanardı.
// =============================================================================
import { Prisma, CashTxnKind, PaymentDirection, PaymentStatus, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { D, resolveExchangeRate } from "./helpers/finance.helper";
import type { ApiResponse } from "../types/api.types";

const CASH_PREFIX = "KH";

/** Türün yönü — CHECK constraint ile AYNI kural (tek kaynak burada). */
const KIND_DIRECTION: Record<CashTxnKind, PaymentDirection> = {
  EXPENSE: PaymentDirection.OUT,
  TRANSFER_OUT: PaymentDirection.OUT,
  INCOME: PaymentDirection.IN,
  TRANSFER_IN: PaymentDirection.IN,
  OPENING: PaymentDirection.IN,
};

export interface AccountRef {
  cashBoxId?: string | null;
  bankAccountId?: string | null;
}

export interface CashTxnInput extends AccountRef {
  kind: Extract<CashTxnKind, "EXPENSE" | "INCOME" | "OPENING">;
  amount: Prisma.Decimal.Value;
  txnDate?: Date;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
  exchangeRate?: Prisma.Decimal.Value | null;
  clientToken?: string | null;
}

export interface TransferInput {
  fromCashBoxId?: string | null;
  fromBankAccountId?: string | null;
  toCashBoxId?: string | null;
  toBankAccountId?: string | null;
  amount: Prisma.Decimal.Value;
  txnDate?: Date;
  description?: string | null;
  clientToken?: string | null;
}

async function nextCashNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const prefix = dailyCodePrefix(CASH_PREFIX, date);
  const rows = await tx.cashTransaction.findMany({
    where: { docNo: { gte: prefix, startsWith: prefix } },
    select: { docNo: true },
  });
  return buildDailyCode(CASH_PREFIX, nextDailySeq(rows.map((r) => r.docNo), prefix), date);
}

/** Hesabı çözer + aktifliğini doğrular; para birimini DÖNER (tek kaynak). */
async function loadAccount(
  tx: Prisma.TransactionClient,
  ref: AccountRef,
  label: string,
): Promise<{ currency: Currency; name: string }> {
  const hasCash = Boolean(ref.cashBoxId);
  const hasBank = Boolean(ref.bankAccountId);
  if (hasCash === hasBank) {
    throw AppError.badRequest(`${label}: kasa VEYA banka hesabı seçilmeli (ikisi birden değil).`);
  }
  if (hasCash) {
    const box = await tx.cashBox.findUnique({
      where: { id: ref.cashBoxId as string },
      select: { currency: true, name: true, isActive: true },
    });
    if (!box) throw AppError.badRequest(`${label}: kasa bulunamadı.`);
    if (!box.isActive) throw AppError.badRequest(`${label}: "${box.name}" kasası pasif durumda.`);
    return { currency: box.currency, name: box.name };
  }
  const acc = await tx.bankAccount.findUnique({
    where: { id: ref.bankAccountId as string },
    select: { currency: true, name: true, isActive: true },
  });
  if (!acc) throw AppError.badRequest(`${label}: banka hesabı bulunamadı.`);
  if (!acc.isActive) throw AppError.badRequest(`${label}: "${acc.name}" hesabı pasif durumda.`);
  return { currency: acc.currency, name: acc.name };
}

/** Kasa/banka bakiyesini atomik oynatır (okuyup-yazmak eşzamanlıyı yutardı). */
async function moveAccountBalance(
  tx: Prisma.TransactionClient,
  ref: AccountRef,
  delta: Prisma.Decimal,
): Promise<void> {
  if (ref.cashBoxId) {
    await tx.cashBox.update({ where: { id: ref.cashBoxId }, data: { balance: { increment: delta } } });
  } else if (ref.bankAccountId) {
    await tx.bankAccount.update({ where: { id: ref.bankAccountId }, data: { balance: { increment: delta } } });
  }
}

export class CashTransactionService {
  /**
   * Masraf / gelir / açılış fişi.
   *
   * ⚠️ Para birimi HESAPTAN gelir, girdide SORULMAZ: kasa tek para birimlidir
   * ve iki yerden sormak kullanıcıya sonradan reddedilecek kombinasyon
   * kurdurmaktı (PaymentService ile aynı karar).
   */
  async create(input: CashTxnInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    if (input.clientToken) {
      const existing = await prisma.cashTransaction.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, docNo: true },
      });
      if (existing) return { success: true, data: existing, message: "Kayıt zaten oluşturulmuş." };
    }

    const txnDate = input.txnDate ?? new Date();
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const acc = await loadAccount(tx, input, "Kasa hareketi");

        const rate =
          input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRate(tx, acc.currency, txnDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${acc.currency} için ${txnDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin.`,
          );
        }
        if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

        // Açılış hesap başına TEK — DB'de partial unique ile kilitli; burada
        // anlamlı mesaj üretilir (sed kullanıcıya "unique ihlali" derdi).
        if (input.kind === CashTxnKind.OPENING) {
          const dup = await tx.cashTransaction.findFirst({
            where: {
              kind: CashTxnKind.OPENING,
              status: { not: PaymentStatus.CANCELLED },
              ...(input.cashBoxId ? { cashBoxId: input.cashBoxId } : { bankAccountId: input.bankAccountId }),
            },
            select: { docNo: true },
          });
          if (dup) {
            throw AppError.conflict(
              `"${acc.name}" için açılış bakiyesi zaten girilmiş (${dup.docNo}). Düzeltmek için önce onu iptal edin.`,
            );
          }
        }

        const docNo = await nextCashNo(tx, txnDate);
        const row = await tx.cashTransaction.create({
          data: {
            docNo,
            kind: input.kind,
            direction: KIND_DIRECTION[input.kind],
            cashBoxId: input.cashBoxId ?? null,
            bankAccountId: input.bankAccountId ?? null,
            currency: acc.currency,
            exchangeRate: rate,
            amount,
            amountTry: amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            txnDate,
            category: input.category?.trim() || null,
            description: input.description?.trim() || null,
            reference: input.reference?.trim() || null,
            createdById: userId ?? null,
            clientToken: input.clientToken ?? null,
          },
          select: { id: true, docNo: true },
        });

        const signed = KIND_DIRECTION[input.kind] === PaymentDirection.IN ? amount : amount.negated();
        await moveAccountBalance(tx, input, signed);
        return row;
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CASH_TRANSACTION",
      recordId: result.id,
      newData: { docNo: result.docNo, kind: input.kind, amount: amount.toString() },
    });
    return { success: true, data: result, message: `${result.docNo} kaydedildi.` };
  }

  /**
   * VİRMAN — kasadan bankaya / bankadan kasaya.
   *
   * ⚠️ TEK uç, İKİ satır, AYNI tx: çıkan (TRANSFER_OUT) + giren (TRANSFER_IN),
   * `transferGroupId` ile bağlı. İki ayrı fiş olarak yazdırmak, biri patlarsa
   * "para kasadan çıktı ama bankaya girmedi" durumunu üretirdi.
   *
   * ⚠️ Para birimi EŞİT olmalı: farklı birimler arası transfer bir KUR
   * İŞLEMİDİR (alış/satış kuru farkı, kur farkı gelir/gideri) ve onu "virman"
   * diye kaydetmek kur farkını sessizce yok sayardı. Faz 2 işi.
   */
  async transfer(input: TransferInput, userId?: string): Promise<ApiResponse<{ ids: string[]; docNos: string[] }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    const from: AccountRef = { cashBoxId: input.fromCashBoxId ?? null, bankAccountId: input.fromBankAccountId ?? null };
    const to: AccountRef = { cashBoxId: input.toCashBoxId ?? null, bankAccountId: input.toBankAccountId ?? null };
    if (
      (from.cashBoxId && from.cashBoxId === to.cashBoxId) ||
      (from.bankAccountId && from.bankAccountId === to.bankAccountId)
    ) {
      throw AppError.badRequest("Kaynak ve hedef hesap aynı olamaz.");
    }

    if (input.clientToken) {
      const existing = await prisma.cashTransaction.findUnique({
        where: { clientToken: input.clientToken },
        select: { transferGroupId: true },
      });
      if (existing?.transferGroupId) {
        const rows = await prisma.cashTransaction.findMany({
          where: { transferGroupId: existing.transferGroupId },
          select: { id: true, docNo: true },
        });
        return {
          success: true,
          data: { ids: rows.map((r) => r.id), docNos: rows.map((r) => r.docNo) },
          message: "Virman zaten kaydedilmiş.",
        };
      }
    }

    const txnDate = input.txnDate ?? new Date();
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const fromAcc = await loadAccount(tx, from, "Çıkan hesap");
        const toAcc = await loadAccount(tx, to, "Giren hesap");
        if (fromAcc.currency !== toAcc.currency) {
          throw AppError.badRequest(
            `"${fromAcc.name}" ${fromAcc.currency}, "${toAcc.name}" ${toAcc.currency} — farklı para birimleri arasında virman yapılamaz (kur işlemi ayrı kaydedilmeli).`,
          );
        }

        const rate = await resolveExchangeRate(tx, fromAcc.currency, txnDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${fromAcc.currency} için ${txnDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin.`,
          );
        }
        const amountTry = amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const groupId = crypto.randomUUID();
        const outNo = await nextCashNo(tx, txnDate);

        const outRow = await tx.cashTransaction.create({
          data: {
            docNo: outNo,
            kind: CashTxnKind.TRANSFER_OUT,
            direction: PaymentDirection.OUT,
            cashBoxId: from.cashBoxId,
            bankAccountId: from.bankAccountId,
            currency: fromAcc.currency,
            exchangeRate: rate,
            amount,
            amountTry,
            txnDate,
            description: input.description?.trim() || `Virman → ${toAcc.name}`,
            transferGroupId: groupId,
            createdById: userId ?? null,
            clientToken: input.clientToken ?? null,
          },
          select: { id: true, docNo: true },
        });
        // ⚠️ İkinci numara İLK satır yazıldıktan SONRA çözülür — aynı gün ilk
        // virmansa iki bacak da aynı sırayı alırdı (nextDailySeq canlı okur).
        const inNo = await nextCashNo(tx, txnDate);
        const inRow = await tx.cashTransaction.create({
          data: {
            docNo: inNo,
            kind: CashTxnKind.TRANSFER_IN,
            direction: PaymentDirection.IN,
            cashBoxId: to.cashBoxId,
            bankAccountId: to.bankAccountId,
            currency: toAcc.currency,
            exchangeRate: rate,
            amount,
            amountTry,
            txnDate,
            description: input.description?.trim() || `Virman ← ${fromAcc.name}`,
            transferGroupId: groupId,
            createdById: userId ?? null,
          },
          select: { id: true, docNo: true },
        });

        await moveAccountBalance(tx, from, amount.negated());
        await moveAccountBalance(tx, to, amount);
        return { ids: [outRow.id, inRow.id], docNos: [outRow.docNo, inRow.docNo], groupId };
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CASH_TRANSACTION",
      recordId: result.ids[0] as string,
      newData: { event: "TRANSFER", docNos: result.docNos, amount: amount.toString() },
    });
    return {
      success: true,
      data: { ids: result.ids, docNos: result.docNos },
      message: `Virman kaydedildi (${result.docNos.join(" / ")}).`,
    };
  }

  /**
   * İptal — STORNO değil SİLME de değil: kayıt CANCELLED işaretlenir ve bakiye
   * ters yönde düzeltilir (Payment.cancel ile aynı sözleşme).
   *
   * ⚠️ VİRMAN İPTALİ İKİ BACAĞI BİRDEN alır: tek bacağı iptal etmek "para
   * kasadan çıktı ama bankaya hiç girmedi" durumunu KALICI hale getirirdi.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<{ ids: string[] }>> {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.cashTransaction.findUnique({
        where: { id },
        select: { id: true, docNo: true, transferGroupId: true, status: true },
      });
      if (!target) throw AppError.notFound("Kayıt bulunamadı.");

      // Virmansa grubun TAMAMI; değilse yalnız kendisi.
      const scope = target.transferGroupId
        ? await tx.cashTransaction.findMany({
            where: { transferGroupId: target.transferGroupId },
            select: { id: true, docNo: true, direction: true, amount: true, cashBoxId: true, bankAccountId: true },
          })
        : await tx.cashTransaction.findMany({
            where: { id },
            select: { id: true, docNo: true, direction: true, amount: true, cashBoxId: true, bankAccountId: true },
          });

      const claimed = await tx.cashTransaction.updateMany({
        where: { id: { in: scope.map((r) => r.id) }, status: PaymentStatus.ACTIVE },
        data: {
          status: PaymentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claimed.count === 0) throw AppError.conflict(`${target.docNo} zaten iptal edilmiş.`);
      if (claimed.count !== scope.length) {
        throw AppError.conflict("Virmanın bacakları bu sırada değişti — yenileyip tekrar deneyin.");
      }

      for (const row of scope) {
        const back = row.direction === PaymentDirection.IN ? D(row.amount).negated() : D(row.amount);
        await moveAccountBalance(tx, { cashBoxId: row.cashBoxId, bankAccountId: row.bankAccountId }, back);
      }
      return { ids: scope.map((r) => r.id), docNos: scope.map((r) => r.docNo) };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CASH_TRANSACTION",
      recordId: id,
      newData: { event: "CANCELLED", docNos: result.docNos, reason },
    });
    return {
      success: true,
      data: { ids: result.ids },
      message:
        result.ids.length > 1
          ? `Virman iptal edildi (${result.docNos.join(" / ")}) — her iki bacak da geri alındı.`
          : `${result.docNos[0]} iptal edildi.`,
    };
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    kind?: CashTxnKind;
    status?: PaymentStatus;
    cashBoxId?: string;
    bankAccountId?: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.CashTransactionWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.status) where.status = params.status;
    if (params.cashBoxId) where.cashBoxId = params.cashBoxId;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    if (params.from || params.to) {
      where.txnDate = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { docNo: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.cashTransaction.findMany({
        where,
        select: {
          id: true,
          docNo: true,
          kind: true,
          direction: true,
          status: true,
          currency: true,
          amount: true,
          txnDate: true,
          category: true,
          description: true,
          reference: true,
          transferGroupId: true,
          cashBox: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
        },
        orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cashTransaction.count({ where }),
    ]);
    return { data, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}

export const cashTransactionService = new CashTransactionService();
