// =============================================================================
// TAHSİLAT / ÖDEME SERVİSİ
// =============================================================================
// Tek transaction: Payment + CariTransaction + CariBalance + kasa/banka bakiyesi
// + audit. Dördü ayrı yazılırsa biri patladığında para "kasadan çıkmış ama
// cariye işlenmemiş" halde kalır ve bunu fark etmenin tek yolu ay sonu sayımıdır.
// =============================================================================
import { Prisma, PaymentDirection, PaymentMethod, PaymentStatus, Currency, CariTxnSource, PrintedDocType } from "@prisma/client";
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
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import { renderPaymentReceiptHtml, type PaymentReceiptDoc } from "./document-render/finance-doc.html";
import { releaseAllocationsForPaymentTx } from "./payment-allocation.service";
import { assertPeriodOpenTx } from "./helpers/period-guard.helper";
import { assertCashPeriodOpenTx } from "./helpers/cash-period-guard.helper";
import { assertCashBalanceCoversTx } from "./helpers/cash-balance-guard.helper";
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

        // ⚠️ DÖNEM KİLİDİ — satır YAZILMADAN ÖNCE. Burada `txnDate` kullanıcının
        // seçtiği `paymentDate`'tir (now DEĞİL): geçmişe tarihli bir tahsilat
        // kapanmış bir döneme düşebilir ve o dönemin ilan edilmiş bakiyesini
        // geriye dönük değiştirirdi. Storno yolundan farkı tam olarak budur.
        await assertPeriodOpenTx(tx, { cariId: cari.id, currency, txnDate: paymentDate });
        // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1, 2026-08-14): tahsilat kasa bakiyesine
        // de yazar ve kasa defteri raporlanmış bir sayfadır — geçmişe tarihli
        // hareket o sayfayı sessizce değiştirirdi. Cari kilidiyle AYNI çıpa
        // (paymentDate), AYRI kilit uzayı (8028).
        await assertCashPeriodOpenTx(tx, {
          cashBoxId: input.cashBoxId ?? null,
          bankAccountId: input.bankAccountId ?? null,
          txnDate: paymentDate,
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

        // ⚠️ EKSİ KASA ENGELİ (finance.blockNegativeCashEnabled, default KAPALI):
        // yalnız İLERİ yönde para ÇIKARAN kasa yazımı kapılanır — banka MUAF
        // (kredili mevduat meşru), `cancel` (storno) MUAF (yanlış tahsilat
        // "kasa yetmez" diye iptal edilemez kalmasın). Guard bakiyeyi FOR
        // UPDATE ile kilitleyip okur; aşağıdaki increment aynı tx'te aynı
        // satıra yazar → araya ikinci bir çekim giremez (TOCTOU kapalı).
        if (!isIn) {
          await assertCashBalanceCoversTx(tx, { cashBoxId: input.cashBoxId ?? null, amount });
        }

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

        // ⚠️ MAKBUZ KAYIT ANINDA DONAR (faturadan farklı olarak taslak yok):
        // para EL DEĞİŞTİRDİĞİ an makbuz verilir; "onay" diye ikinci bir adım
        // yoktur. Freeze tx'in İÇİNDE — kasa/banka bakiyesi ile makbuz ya
        // birlikte doğar ya hiç.
        await printedDocumentService.freezeForSource(
          tx,
          PrintedDocType.PAYMENT_RECEIPT,
          payment.id,
          userId,
        );

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
          paymentDate: true,
        },
      });

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ — İPTALDE ÇIPA ORİJİNAL `paymentDate`,
      // `now` DEĞİL (cari tarafının tersi ve sebebi yapısal): cari defteri
      // append-only'dir, iptal BUGÜNE ters SATIR yazar → kapalı fotoğraf
      // değişmez. Kasa defteri ise toplam-bazlıdır: iptal, satırı CANCELLED'a
      // çekip geçmiş sayfanın toplamından GERİYE DÖNÜK düşürür. Kapalı dönemin
      // ödemesini iptal etmek o sayfayı değiştirmektir — kilit tam bunu sorar
      // ("önce dönemi yeniden açın").
      await assertCashPeriodOpenTx(tx, {
        cashBoxId: p.cashBoxId,
        bankAccountId: p.bankAccountId,
        txnDate: p.paymentDate,
      });

      // ⚠️ KAPAMA ÇÖZÜLMESİ TERS DEFTER SATIRINDAN ÖNCE. Bu tahsilat bir ya da
      // birkaç faturayı kapatmış olabilir; bağı çözmezsek fatura "kapalı"
      // görünmeye devam eder ama karşılığındaki para geri alınmıştır — yani
      // yaşlandırma ve "açık faturalar" listesi sessizce yalan söyler.
      // (Entegrasyon ana oturum tarafından eklendi: `payment-allocation.service`
      // yardımcıyı sunuyor, çağrı sahipliği bu dosyada.)
      //
      // ⚠️ Kapaması OLMAYAN tahsilatta bu çağrı NO-OP'tur (yardımcı satır
      // bulamazsa erken döner) — yani bugünkü kapamasız yol bayt-bayt aynı.
      // Bekçi: `test_payment_allocation` §7f (çağrı düşürülünce 3 kontrol
      // kırmızı verdiği ölçüldü — 2026-08-14).
      await releaseAllocationsForPaymentTx(tx, p.id, { userId, reason: "PAYMENT_CANCEL" });

      // ⚠️ DÖNEM KİLİDİ: kapanmış bir döneme storno satırı yazmak, kapanışta
      // ilan edilen bakiyeyi geriye dönük değiştirmektir. Satır YAZILMADAN ÖNCE
      // sorulur. `txnDate` = now olduğu için pratikte CARİ döneme düşer; kilit
      // yine de burada durur, çünkü "pratikte düşmez" bir invariant değildir.
      await assertPeriodOpenTx(tx, { cariId: p.cariId, currency: p.currency, txnDate: new Date() });

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

      // Storno → makbuz İPTAL filigranıyla VOIDED. Belge silinmez: elinde
      // makbuz olan müşteri için iptal edilmiş kopyanın da basılabilmesi gerekir.
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.PAYMENT_RECEIPT,
        p.id,
        reason ?? "Tahsilat/ödeme iptal edildi",
      );

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

// ---------------------------------------------------------------------------
// BELGE BUILDER — tahsilat / ödeme makbuzu
// ---------------------------------------------------------------------------
// ⚠️ Kayıt IMPORT YAN ETKİSİYLE oluşur (finance.routes → bu servis). Bekçilerde
// import satırı yoksa registry boş kalır ve testler vakumen yeşile döner.

/** Yön etiketi belgenin BAŞLIĞIDIR — tahsilat ile ödeme aynı kâğıt değildir. */
const DIRECTION_TITLE: Record<PaymentDirection, string> = {
  IN: "Tahsilat Makbuzu",
  OUT: "Ödeme Makbuzu",
};

// ⚠️ `Record<PaymentMethod, ...>` EXHAUSTIVE: enum'a değer eklenirse tsc burayı
// düşürür. Çek/senet bilinçli olarak YOK — C1'de ayrı bir `Cheque` modeli
// geliyor (çek bir AN değil bir VARLIKTIR; Payment sözleşmesine istisna sokmak
// en hassas yola sessiz bir `if` eklemek olurdu).
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi Kartı",
  OTHER: "Diğer",
};

registerPrintedDocBuilder(PrintedDocType.PAYMENT_RECEIPT, {
  fresh: async (db, sourceId) => {
    const p = await db.payment.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        id: true, docNo: true, direction: true, method: true, status: true,
        paymentDate: true, currency: true, exchangeRate: true, amount: true, amountTry: true,
        notes: true, cancelReason: true, cancelledAt: true, createdById: true,
        cari: {
          select: {
            customer: { select: { code: true, name: true } },
            subcontractor: { select: { code: true, name: true } },
          },
        },
        cashBox: { select: { name: true } },
        bankAccount: { select: { name: true } },
      },
    });
    const party = p.cari?.customer ?? p.cari?.subcontractor ?? null;
    const creator = p.createdById
      ? await db.user.findUnique({ where: { id: p.createdById }, select: { fullName: true, username: true } })
      : null;
    const doc: PaymentReceiptDoc = {
      header: {
        documentNo: p.docNo,
        date: p.paymentDate?.toISOString() ?? null,
        direction: p.direction,
        directionLabel: DIRECTION_TITLE[p.direction],
        partyName: party?.name ?? "—",
        partyCode: party?.code ?? null,
        method: p.method,
        methodLabel: METHOD_LABEL[p.method] ?? p.method,
        // Kasa XOR banka (şema CHECK'i) — hangisi doluysa o basılır.
        accountName: p.cashBox?.name ?? p.bankAccount?.name ?? null,
        currency: p.currency,
        exchangeRate: p.exchangeRate?.toString() ?? null,
        createdBy: creator?.fullName ?? creator?.username ?? null,
      },
      amount: p.amount.toString(),
      // TL karşılığı YALNIZ dövizli makbuzda anlamlı; TRY'de aynı sayıyı iki kez
      // basmak kâğıdı kirletir ve "iki farklı tutar mı" diye okunur.
      amountTry: p.currency === "TRY" ? null : p.amountTry.toString(),
      notes: p.notes,
    };
    return {
      documentNo: p.docNo,
      doc: doc as unknown as Record<string, unknown>,
      voidInfo:
        p.status === PaymentStatus.CANCELLED
          ? { reason: p.cancelReason, at: p.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderPaymentReceiptHtml,
});
