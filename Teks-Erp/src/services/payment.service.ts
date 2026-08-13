// =============================================================================
// TAHSİLAT / ÖDEME SERVİSİ
// =============================================================================
// Tek transaction: Payment + CariTransaction + CariBalance + kasa/banka bakiyesi
// + audit. Dördü ayrı yazılırsa biri patladığında para "kasadan çıkmış ama
// cariye işlenmemiş" halde kalır ve bunu fark etmenin tek yolu ay sonu sayımıdır.
// =============================================================================
import { Prisma, PaymentDirection, PaymentMethod, PaymentStatus, Currency, CariTxnSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import {
  D,
  D0,
  nextPaymentNo,
  resolveExchangeRate,
  ensureCariAccountTx,
  applyCariBalanceTx,
} from "./helpers/finance.helper";
import type { ApiResponse } from "../types/api.types";

export interface CreatePaymentInput {
  direction: PaymentDirection;
  method: PaymentMethod;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  exchangeRate?: Prisma.Decimal.Value | null;
  amount: Prisma.Decimal.Value;
  cashBoxId?: string | null;
  bankAccountId?: string | null;
  paymentDate?: Date;
  reference?: string | null;
  notes?: string | null;
  clientToken?: string | null;
}

export class PaymentService {
  /**
   * Tahsilat (IN) / ödeme (OUT) kaydeder.
   *
   * YÖN SÖZLEŞMESİ (bakiye POZİTİF = cari BİZE borçlu):
   *   IN  (müşteriden para aldık)  → carinin borcu AZALIR → ALACAK satırı
   *   OUT (fasona para ödedik)     → bizim borcumuz azalır → BORÇ satırı
   */
  async create(input: CreatePaymentInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    const hasCash = Boolean(input.cashBoxId);
    const hasBank = Boolean(input.bankAccountId);
    if (hasCash === hasBank) {
      throw AppError.badRequest("Kasa VEYA banka hesabı seçilmeli (ikisi birden değil).");
    }

    if (input.clientToken) {
      const existing = await prisma.payment.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, docNo: true },
      });
      if (existing) return { success: true, data: existing, message: "Kayıt zaten oluşturulmuş." };
    }

    const paymentDate = input.paymentDate ?? new Date();
    const currency = input.currency ?? Currency.TRY;

    const result = await withBarcodeRetry(async () =>
      prisma.$transaction(async (tx) => {
        const cari = await ensureCariAccountTx(tx, {
          customerId: input.customerId ?? null,
          subcontractorId: input.subcontractorId ?? null,
        });

        // ⚠️ KASA PARA BİRİMİ ≠ ÖDEME PARA BİRİMİ → RED. Kasa tek para
        // birimlidir; USD'yi TL kasasına yazmak, "kasada ne var" sorusunu
        // cevaplanamaz yapardı (bakiye iki farklı birimin toplamı olurdu).
        let accountCurrency: Currency;
        let accountLabel: string;
        if (hasCash) {
          const box = await tx.cashBox.findUnique({
            where: { id: input.cashBoxId as string },
            select: { currency: true, name: true, isActive: true },
          });
          if (!box) throw AppError.badRequest("Kasa bulunamadı.");
          if (!box.isActive) throw AppError.badRequest(`${box.name} kasası pasif durumda.`);
          accountCurrency = box.currency;
          accountLabel = box.name;
        } else {
          const acc = await tx.bankAccount.findUnique({
            where: { id: input.bankAccountId as string },
            select: { currency: true, name: true, isActive: true },
          });
          if (!acc) throw AppError.badRequest("Banka hesabı bulunamadı.");
          if (!acc.isActive) throw AppError.badRequest(`${acc.name} hesabı pasif durumda.`);
          accountCurrency = acc.currency;
          accountLabel = acc.name;
        }
        if (accountCurrency !== currency) {
          throw AppError.badRequest(
            `${accountLabel} ${accountCurrency} hesabıdır — ${currency} tahsilat/ödeme kaydedilemez. Aynı para biriminde bir kasa/hesap seçin.`,
          );
        }

        const rate =
          input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRate(tx, currency, paymentDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${currency} için ${paymentDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin veya elle belirtin.`,
          );
        }
        if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

        const amountTry = amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const docNo = await nextPaymentNo(tx, input.direction, paymentDate);

        const payment = await tx.payment.create({
          data: {
            docNo,
            direction: input.direction,
            method: input.method,
            cariId: cari.id,
            currency,
            exchangeRate: rate,
            amount,
            amountTry,
            cashBoxId: input.cashBoxId ?? null,
            bankAccountId: input.bankAccountId ?? null,
            paymentDate,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            createdById: userId ?? null,
            clientToken: input.clientToken ?? null,
          },
          select: { id: true, docNo: true },
        });

        const isIn = input.direction === PaymentDirection.IN;
        await tx.cariTransaction.create({
          data: {
            cariId: cari.id,
            currency,
            txnDate: paymentDate,
            debit: isIn ? D0() : amount,
            credit: isIn ? amount : D0(),
            amountTry,
            exchangeRate: rate,
            sourceType: CariTxnSource.PAYMENT,
            paymentId: payment.id,
            description: `${docNo}${input.reference ? ` — ${input.reference}` : ""}`,
            createdById: userId ?? null,
          },
        });

        await applyCariBalanceTx(tx, cari.id, currency, isIn ? amount.negated() : amount);

        // Kasa/banka: para girdiyse artar, çıktıysa azalır.
        const accDelta = isIn ? amount : amount.negated();
        if (hasCash) {
          await tx.cashBox.update({
            where: { id: input.cashBoxId as string },
            data: { balance: { increment: accDelta } },
          });
        } else {
          await tx.bankAccount.update({
            where: { id: input.bankAccountId as string },
            data: { balance: { increment: accDelta } },
          });
        }

        return payment;
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PAYMENT",
      recordId: result.id,
      newData: { docNo: result.docNo, direction: input.direction, amount: amount.toString() },
    });
    return {
      success: true,
      data: result,
      message: `${result.docNo} kaydedildi.`,
    };
  }

  /**
   * Tahsilat/ödeme iptali — STORNO.
   *
   * ⚠️ Kayıt SİLİNMEZ, ters defter satırı yazılır (fatura iptaliyle aynı kural).
   * Kasa/banka bakiyesi de ters yönde düzeltilir.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.ACTIVE },
        data: {
          status: PaymentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason ?? null,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.payment.findUnique({ where: { id }, select: { docNo: true } });
        if (!cur) throw AppError.notFound("Kayıt bulunamadı.");
        throw AppError.conflict(`${cur.docNo} zaten iptal edilmiş.`);
      }

      const p = await tx.payment.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          docNo: true,
          direction: true,
          cariId: true,
          currency: true,
          exchangeRate: true,
          amount: true,
          amountTry: true,
          cashBoxId: true,
          bankAccountId: true,
        },
      });

      const isIn = p.direction === PaymentDirection.IN;
      await tx.cariTransaction.create({
        data: {
          cariId: p.cariId,
          currency: p.currency,
          txnDate: new Date(),
          // Ters: tahsilat alacak yazmıştı → iptal borç yazar.
          debit: isIn ? D(p.amount) : D0(),
          credit: isIn ? D0() : D(p.amount),
          amountTry: D(p.amountTry),
          exchangeRate: D(p.exchangeRate),
          sourceType: CariTxnSource.PAYMENT_CANCEL,
          paymentId: p.id,
          description: `${p.docNo} İPTAL${reason ? ` — ${reason}` : ""}`,
          createdById: userId ?? null,
        },
      });

      await applyCariBalanceTx(tx, p.cariId, p.currency, isIn ? D(p.amount) : D(p.amount).negated());

      const accDelta = isIn ? D(p.amount).negated() : D(p.amount);
      if (p.cashBoxId) {
        await tx.cashBox.update({ where: { id: p.cashBoxId }, data: { balance: { increment: accDelta } } });
      } else if (p.bankAccountId) {
        await tx.bankAccount.update({ where: { id: p.bankAccountId }, data: { balance: { increment: accDelta } } });
      }

      return { id: p.id, docNo: p.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PAYMENT",
      recordId: id,
      newData: { event: "PAYMENT_CANCELLED", docNo: result.docNo, reason },
    });
    return { success: true, data: result, message: `${result.docNo} iptal edildi ve ters kayıtla geri alındı.` };
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    direction?: PaymentDirection;
    status?: PaymentStatus;
    cariId?: string;
    cashBoxId?: string;
    bankAccountId?: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.PaymentWhereInput = {};
    if (params.direction) where.direction = params.direction;
    if (params.status) where.status = params.status;
    if (params.cariId) where.cariId = params.cariId;
    if (params.cashBoxId) where.cashBoxId = params.cashBoxId;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    if (params.from || params.to) {
      where.paymentDate = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { docNo: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: {
          id: true,
          docNo: true,
          direction: true,
          method: true,
          status: true,
          currency: true,
          amount: true,
          amountTry: true,
          paymentDate: true,
          reference: true,
          cashBox: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
          cari: {
            select: {
              id: true,
              customer: { select: { code: true, name: true } },
              subcontractor: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.payment.count({ where }),
    ]);
    return { data, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}

export const paymentService = new PaymentService();
