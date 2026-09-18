// =============================================================================
// KASA/BANKA DEFTERİ — TEK YAZAR (2026-09-18, kullanıcı kararı; finans "tek kaynak satır" sınıfı)
// =============================================================================
// `CashBox.balance` / `BankAccount.balance` YALNIZ buradan oynar: her ileri hareket bir `CashTransaction` satırı +
// bakiye artışı (`applyCashTxTx`), her geri alma DURUM_IPTAL (status CANCELLED, `cancelledAt`) + bakiyenin geri alınması
// (`cancelCashTxTx`). Carili tahsilat/ödeme (`Payment`) de buradan geçer (kind COLLECTION/PAYMENT, `paymentId`); çek
// olayları bakiyeyi `moveAccountBalanceTx` ile oynatır (defteri `ChequeEvent`). Eskiden `payment.service` bakiyeye
// doğrudan yazıyordu ve kasa defteri o hareketi görmüyordu (d9 C7/J3). Bekçi: `test_cash_single_writer` — AST:
// `balance: { increment` yalnız bu dosyada. Dönem kapısı ve eksi-kasa kapısı da burada koşar (yazan her yol geçer).
// =============================================================================
import { CashTxnKind, PaymentDirection, PaymentStatus, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../../utils/code-format";
import { assertCashBalanceCoversTx } from "./cash-balance-guard.helper";
import { assertCashPeriodOpenTx, assertCashPeriodsOpenTx } from "./cash-period-guard.helper";

type Tx = Prisma.TransactionClient;

export interface AccountRef {
  cashBoxId?: string | null;
  bankAccountId?: string | null;
}

export const CASH_PREFIX = "KH";

/** Türün yönü — DB CHECK'in ve `direction` kolonunun tek kaynağı. */
export const KIND_DIRECTION: Record<CashTxnKind, PaymentDirection> = {
  EXPENSE: PaymentDirection.OUT,
  TRANSFER_OUT: PaymentDirection.OUT,
  PAYMENT: PaymentDirection.OUT,
  INCOME: PaymentDirection.IN,
  TRANSFER_IN: PaymentDirection.IN,
  OPENING: PaymentDirection.IN,
  COLLECTION: PaymentDirection.IN,
};

/** Günlük belge numarası KH+GGAAYY+NNNN — P2002 yarışı çağıranın `withBarcodeRetry`inde. */
export async function nextCashNoTx(tx: Tx, date: Date): Promise<string> {
  const prefix = dailyCodePrefix(CASH_PREFIX, date);
  const rows = await tx.cashTransaction.findMany({ where: { docNo: { gte: prefix, startsWith: prefix } }, select: { docNo: true } });
  return buildDailyCode(CASH_PREFIX, nextDailySeq(rows.map((r) => r.docNo), prefix), date);
}

/** Bakiyeyi ATOMİK oynatır — kod tabanında `balance: { increment }`in TEK yeri (okuyup-yazmak eşzamanlıyı yutardı). */
export async function moveAccountBalanceTx(tx: Tx, ref: AccountRef, delta: Prisma.Decimal): Promise<void> {
  if (ref.cashBoxId) {
    await tx.cashBox.update({ where: { id: ref.cashBoxId }, data: { balance: { increment: delta } } });
  } else if (ref.bankAccountId) {
    await tx.bankAccount.update({ where: { id: ref.bankAccountId }, data: { balance: { increment: delta } } });
  }
}

export interface CashLedgerInput extends AccountRef {
  kind: CashTxnKind;
  currency: Prisma.CashTransactionCreateInput["currency"];
  exchangeRate: Prisma.Decimal;
  amount: Prisma.Decimal;
  txnDate: Date;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
  transferGroupId?: string | null;
  paymentId?: string | null;
  createdById?: string | null;
  clientToken?: string | null;
}

/**
 * İLERİ hareket: dönem kapısı → (çıkan kasa hareketinde) eksi-kasa kapısı → defter satırı → bakiye. Hepsi aynı tx'te;
 * satır ile bakiye ya birlikte doğar ya hiç. `negativeGuard: false` yalnız kapının bilerek kapatıldığı yerde (yok).
 */
export async function applyCashTxTx(tx: Tx, input: CashLedgerInput, opts: { negativeGuard?: boolean } = {}): Promise<{ id: string; docNo: string; direction: PaymentDirection }> {
  const amount = new Prisma.Decimal(input.amount);
  if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");
  const direction = KIND_DIRECTION[input.kind];
  await assertCashPeriodOpenTx(tx, { cashBoxId: input.cashBoxId ?? null, bankAccountId: input.bankAccountId ?? null, txnDate: input.txnDate });
  if (direction === PaymentDirection.OUT && opts.negativeGuard !== false) {
    await assertCashBalanceCoversTx(tx, { cashBoxId: input.cashBoxId ?? null, amount });
  }
  const docNo = await nextCashNoTx(tx, input.txnDate);
  const row = await tx.cashTransaction.create({
    data: {
      docNo,
      kind: input.kind,
      direction,
      cashBoxId: input.cashBoxId ?? null,
      bankAccountId: input.bankAccountId ?? null,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      amount,
      amountTry: amount.mul(input.exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      txnDate: input.txnDate,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      reference: input.reference?.trim() || null,
      transferGroupId: input.transferGroupId ?? null,
      paymentId: input.paymentId ?? null,
      createdById: input.createdById ?? null,
      clientToken: input.clientToken ?? null,
    },
    select: { id: true, docNo: true },
  });
  await moveAccountBalanceTx(tx, input, direction === PaymentDirection.IN ? amount : amount.negated());
  return { ...row, direction };
}

export interface CashLedgerRowRef extends AccountRef {
  id: string;
  docNo: string;
  direction: PaymentDirection;
  amount: Prisma.Decimal | number | string;
  txnDate: Date;
}

/**
 * GERİ ALMA (DURUM_IPTAL): atomik claim ACTIVE → CANCELLED (count 0 → 409), dönem kapısı, bakiye geri. Satırlar ÇAĞIRANIN
 * verdiği sırada oynar — virman bacaklarını kanonik sırada (`accountLockKey`) veren çağıran ABBA'yı kapatır. Eksi-kasa kapısı
 * MUAF (storno "kasa yetmez" diye takılmaz). Satır silinmez, ileri damgası değişmez.
 */
export async function cancelCashTxTx(
  tx: Tx,
  rows: CashLedgerRowRef[],
  meta: { reason?: string | null; userId?: string | null; alreadyMessage?: string; changedMessage?: string },
): Promise<void> {
  if (rows.length === 0) return;
  const claimed = await tx.cashTransaction.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: PaymentStatus.ACTIVE },
    data: { status: PaymentStatus.CANCELLED, cancelledAt: new Date(), cancelledById: meta.userId ?? null, cancelReason: meta.reason?.trim() || null },
  });
  if (claimed.count === 0) throw AppError.conflict(meta.alreadyMessage ?? `${rows[0]!.docNo} zaten iptal edilmiş.`);
  if (claimed.count !== rows.length) throw AppError.conflict(meta.changedMessage ?? "Kayıtlar bu sırada değişti — yenileyip tekrar deneyin.");
  await assertCashPeriodsOpenTx(tx, rows.map((r) => ({ cashBoxId: r.cashBoxId ?? null, bankAccountId: r.bankAccountId ?? null, txnDate: r.txnDate })));
  for (const row of rows) {
    const amount = new Prisma.Decimal(row.amount);
    await moveAccountBalanceTx(tx, row, row.direction === PaymentDirection.IN ? amount.negated() : amount);
  }
}
