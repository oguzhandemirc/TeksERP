// =============================================================================
// TAHSİLAT / ÖDEME SERVİSİ
// =============================================================================
// Tek transaction: Payment + CariTransaction + CariBalance + kasa/banka bakiyesi
// + audit. Dördü ayrı yazılırsa biri patladığında para "kasadan çıkmış ama
// cariye işlenmemiş" halde kalır ve bunu fark etmenin tek yolu ay sonu sayımıdır.
// =============================================================================
import { Prisma, PaymentDirection, PaymentMethod, PaymentStatus, Currency, CariTxnSource, PrintedDocType, CashTxnKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import {
  D,
  D0,
  nextPaymentNoTx,
  resolveExchangeRateTx,
  ensureCariAccountTx,
  applyCariBalanceTx,
} from "./helpers/finance.helper";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import { renderPaymentReceiptHtml, type PaymentReceiptDoc } from "./document-render/finance-doc.html";
import { releaseAllocationsForPaymentTx, autoAllocatePaymentFifo } from "./payment-allocation.service";
import {
  readFinanceEnabled,
  readFinanceAutoAllocateOnPaymentEnabled,
} from "./system-setting.service";
import { assertPeriodOpenTx } from "./helpers/period-guard.helper";
import { assertCashPeriodOpenTx } from "./helpers/cash-period-guard.helper";
import { assertCashBalanceCoversTx } from "./helpers/cash-balance-guard.helper";
// B4 — liste filtreleri: CSV çoklu seçim tek kaynaktan çözülür (ham CSV bir
// uuid kolonuna giderse P2007 → 400; CLAUDE.md 2026-08-06).
import { buildTurkishSearch, isEnumMember, readFilterList, readIdCondition } from "../utils/query-parser";
import { tokenReplay } from "./helpers/token-replay.helper";
import { factoryYmd } from "../constants/time";
import { resolvePartyToCardTx } from "./helpers/party-card.helper";
import type { ApiResponse } from "../types/api.types";
import { applyCashTxTx, cancelCashTxTx, moveAccountBalanceTx } from "./helpers/cash-ledger.helper";

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

// -----------------------------------------------------------------------------
// OTOMATİK FIFO KAPAMA KANCASI — `finance.autoAllocateOnPaymentEnabled`
// -----------------------------------------------------------------------------
/**
 * Kayıt BAŞARILI olduktan SONRA çalışan ayrı adım; yanıt mesajına eklenecek
 * özet cümleyi döner (bayrak kapalıysa boş string → mesaj bayt-bayt bugünkü).
 *
 * ⚠️ TX'İN DIŞINDA ve HATASI YUTULUR — tahsilat ASLA kapama yüzünden düşmez.
 * Para el değiştirdi; "hangi faturaya sayılacağı" ikinci bir sorudur ve yanlış
 * cevabı düzeltilebilir (kapama elle çözülür), oysa kaydın hiç yazılmaması
 * düzeltilemez. Aynı gerekçe `financeAutoDraftFromShipmentEnabled` JSDoc'unda
 * da yazılı ("taslak üretimi başarısız olursa sevk DÜŞMEZ").
 *
 * ⚠️ YUTMAK ≠ SUSMAK: başarısızlık hem audit'e yazılır hem de mesajda operatöre
 * söylenir ve yol gösterilir. Sessiz yutma, tam da "kapandı sanıp bir daha
 * bakmama" davranışını üretirdi.
 *
 * ⚠️ REPLAY YOLLARINDA ÇAĞRILMAZ ve bu YAPISAL: `clientToken` ile gelen ikinci
 * istek `create`'in başındaki (ya da P2002 catch'indeki) cached yanıtla ERKEN
 * döner, buraya hiç ulaşmaz. Ulaşsaydı aynı tahsilat ikinci kez dağıtılmaya
 * çalışılır ve I2 sözleşmesi ("replay yanıtı BİREBİR aynı") bozulurdu.
 *
 * ⚠️ BAYRAK SIRASI: önce ÖZEL bayrak, sonra modül şalteri. İkisi de gerekli;
 * özel olan önce okunur ki dokunulmamış kurulumda (varsayılan KAPALI) toplam
 * maliyet TEK `system_settings` SELECT'i olsun.
 */
async function autoAllocateNoteAfterPayment(
  paymentId: string,
  currency: Currency,
  userId?: string,
): Promise<string> {
  if (!(await readFinanceAutoAllocateOnPaymentEnabled())) return "";
  if (!(await readFinanceEnabled())) return "";

  try {
    const summary = await autoAllocatePaymentFifo(paymentId, userId);
    if (summary.count === 0) return "";
    const leftover = summary.leftover.gt(0)
      ? ` Kalan ${summary.leftover.toFixed(2)} ${currency} avans olarak açıkta.`
      : "";
    return (
      ` ${summary.count} faturaya otomatik kapandı (${summary.total.toFixed(2)} ${currency}).${leftover}` +
      ` Kapamalar Fatura Kapama ekranından çözülebilir; otomasyon: Ayarlar → Muhasebe → Otomasyon.`
    );
  } catch (e) {
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PAYMENT",
      recordId: paymentId,
      newData: { event: "AUTO_ALLOCATE_FAILED", error: (e as Error).message },
    });
    return (
      " Otomatik kapama YAPILAMADI (tahsilat/ödeme kaydedildi) —" +
      " kapamayı Fatura Kapama ekranından elle yapabilirsiniz."
    );
  }
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

    return this.paymentReplay(input).run(input.clientToken, () => this.createFresh(input, { amount, hasCash }, userId));
  }

  /**
   * Tahsilat/ödeme replay'i. Kimlik: yön · yöntem · tutar · kasa/banka · taraf (karta ÇÖZÜLMÜŞ; saklanan cari de
   * kart kimliğidir) · para birimi; kur ve tarih YALNIZ gönderildiyse (varsayılan alırlar, gelen boşsa saklanan
   * doludur; tarih fabrika günüyle). 4. durum: iptal edilmiş tahsilat/ödeme → 409 `PAYMENT_CANCELLED`. Replay FIFO
   * kapama kancasını koşmaz.
   */
  private paymentReplay(input: CreatePaymentInput) {
    type P = {
      id: string; docNo: string; status: PaymentStatus; direction: PaymentDirection; method: PaymentMethod;
      amount: Prisma.Decimal; currency: Currency; exchangeRate: Prisma.Decimal; paymentDate: Date;
      cashBoxId: string | null; bankAccountId: string | null; storedParty: string; incomingParty: string;
    };
    return tokenReplay<P, ApiResponse<{ id: string; docNo: string }>>({
      find: async (db, clientToken) => {
        const p = await db.payment.findUnique({
          where: { clientToken },
          select: {
            id: true, docNo: true, status: true, direction: true, method: true, amount: true, currency: true,
            exchangeRate: true, paymentDate: true, cashBoxId: true, bankAccountId: true,
            cari: { select: { customerId: true, subcontractorId: true } },
          },
        });
        if (!p) return null;
        const incoming = await resolvePartyToCardTx(db, { customerId: input.customerId, subcontractorId: input.subcontractorId });
        const { cari, ...rest } = p;
        return { ...rest, storedParty: `${cari.customerId ?? ""}|${cari.subcontractorId ?? ""}`, incomingParty: `${incoming.customerId ?? ""}|${incoming.subcontractorId ?? ""}` };
      },
      alive: (p) => {
        if (p.status !== PaymentStatus.CANCELLED) return;
        throw AppError.conflict(
          `Bu form daha önce kaydedilmiş ve ${p.docNo} İPTAL edilmiş — aynı gönderim tekrar edilemez. Yeni kayıt için formu kapatıp yeniden açın.`,
          { code: "PAYMENT_CANCELLED", paymentId: p.id, docNo: p.docNo },
        );
      },
      identity: (p) => [
        { ad: "direction", mevcut: p.direction, gelen: input.direction },
        { ad: "method", mevcut: p.method, gelen: input.method },
        { ad: "amount", mevcut: p.amount, gelen: input.amount },
        { ad: "cashBoxId", mevcut: p.cashBoxId, gelen: input.cashBoxId },
        { ad: "bankAccountId", mevcut: p.bankAccountId, gelen: input.bankAccountId },
        { ad: "taraf", mevcut: p.storedParty, gelen: p.incomingParty },
        { ad: "currency", mevcut: p.currency, gelen: input.currency ?? Currency.TRY },
        ...(input.exchangeRate != null ? [{ ad: "exchangeRate", mevcut: p.exchangeRate, gelen: input.exchangeRate }] : []),
        ...(input.paymentDate ? [{ ad: "paymentDate", mevcut: factoryYmd(p.paymentDate), gelen: factoryYmd(input.paymentDate) }] : []),
      ],
      collision: "Bu istemci anahtarı FARKLI bir tahsilat/ödeme için kullanılmış. Ekranı yenileyip tekrar deneyin.",
      collisionEk: (p) => ({ paymentId: p.id }),
      respond: (p) => ({ success: true, data: { id: p.id, docNo: p.docNo }, message: "Kayıt zaten oluşturulmuş." }),
    });
  }

  private async createFresh(
    input: CreatePaymentInput,
    { amount, hasCash }: { amount: Prisma.Decimal; hasCash: boolean },
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const paymentDate = input.paymentDate ?? new Date();
    const currency = input.currency ?? Currency.TRY;

    // Yarışı kaybedenin token P2002'si RETRY EDİLMEZ (aynı token'ı 5 tur boşa yazardı); boğazın `run`ı cevabı token'dan verir.
    const result = await withBarcodeRetry(
        async () =>
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
          input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRateTx(tx, currency, paymentDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${currency} için ${paymentDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin veya elle belirtin.`,
          );
        }
        if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

        const amountTry = amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const docNo = await nextPaymentNoTx(tx, input.direction, paymentDate);

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

        // KASA/BANKA DEFTERİ — TEK YAZAR: satır (COLLECTION/PAYMENT, paymentId bağı) + bakiye helper'dan; eksi-kasa
        // kapısı (yalnız çıkan kasa hareketi) ve dönem kapısı helper'ın içinde. Cari defter ile kasa defteri aynı tx'te doğar.
        await applyCashTxTx(tx, {
          kind: isIn ? CashTxnKind.COLLECTION : CashTxnKind.PAYMENT,
          cashBoxId: hasCash ? (input.cashBoxId as string) : null,
          bankAccountId: hasCash ? null : (input.bankAccountId as string),
          currency, exchangeRate: rate, amount, txnDate: paymentDate,
          description: `${docNo}${input.reference ? ` — ${input.reference}` : ""}`,
          reference: input.reference ?? null,
          paymentId: payment.id,
          createdById: userId ?? null,
        });

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
        undefined,
        (err) => !isClientTokenP2002(err),
      );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PAYMENT",
      recordId: result.id,
      newData: { docNo: result.docNo, direction: input.direction, amount: amount.toString() },
    });
    // Otomatik FIFO kapama — kaydın DIŞINDA, ayrı adım (yukarıdaki nota bak).
    const autoNote = await autoAllocateNoteAfterPayment(result.id, currency, userId);
    return {
      success: true,
      data: result,
      message: `${result.docNo} kaydedildi.${autoNote}`,
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

      // Kasa defteri satırı DURUM_IPTAL + bakiye geri — tek yazardan. Backfill öncesi eski ödemede satır yoktur: bakiye
      // eski yazar tarafından işlenmişti, yalnız geri alınır (`moveAccountBalanceTx`), satır uydurulmaz.
      const ledgerRow = await tx.cashTransaction.findUnique({
        where: { paymentId: p.id },
        select: { id: true, docNo: true, direction: true, amount: true, cashBoxId: true, bankAccountId: true, txnDate: true },
      });
      if (ledgerRow) {
        await cancelCashTxTx(tx, [ledgerRow], { reason, userId, alreadyMessage: `${p.docNo} kasa defteri satırı zaten iptal edilmiş.` });
      } else if (p.cashBoxId || p.bankAccountId) {
        await moveAccountBalanceTx(tx, { cashBoxId: p.cashBoxId, bankAccountId: p.bankAccountId }, isIn ? D(p.amount).negated() : D(p.amount));
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

  /**
   * TAHSİLAT / ÖDEME LİSTESİ — filtreler (B4, 2026-08-15).
   *
   * Süzme SUNUCUDADIR. İstemcide süzmek yalnız O ANKİ SAYFAYI süzer ve
   * muhasebeci "kayıt yok" sanar — oysa kayıt bir sonraki sayfadadır (top
   * listesi filtresi dersinin finans ikizi).
   *
   * ⚠️ ÇOKLU SEÇİM YALNIZ ANLAMLI OLDUĞU YERDE (CLAUDE.md 2026-08-06 kuralı):
   *   • `cariId` ve `method` → CSV kabul eder (`readIdCondition`/`readFilterList`).
   *     ⚠️ `cariId` bir UUID kolonudur: ham CSV geçirilirse Postgres
   *     "invalid input syntax for type uuid" → Prisma P2007 → 400. Elle okunan
   *     HER id filtresi `readIdCondition`ten geçmeli.
   *   • `direction` (IN/OUT) ve `status` (ACTIVE/CANCELLED) → TEKİL. İki değerli
   *     NOT NULL enum'da "ikisini de seç", "filtre yok" ile aynı sonucu verir;
   *     çoklu seçim kullanıcıya anlamsız bir kombinasyon vaat eder.
   *
   * ⚠️ TARİH ÇIPASI `paymentDate` (kaydın `createdAt`i DEĞİL): geçmişe tarihli
   * bir tahsilat bugün girilebilir ve muhasebecinin sorduğu şey paranın EL
   * DEĞİŞTİRDİĞİ gündür. Sınır İSTEMCİNİNDİR (`resolveDateRange` sözleşmesi):
   * panel seçilen günün YEREL 00:00 / 23:59:59.999 anını gönderir, backend
   * ayrıca gün yuvarlaması YAPMAZ — yaparsa istemcinin niyeti iki kez
   * yorumlanır.
   */
  async list(params: {
    page?: number;
    pageSize?: number;
    direction?: PaymentDirection;
    status?: PaymentStatus;
    /** Tek değer ya da CSV/çoklu (`readFilterList` sözleşmesi). */
    method?: string | string[];
    /** Tek uuid ya da CSV/çoklu. */
    cariId?: string | string[];
    cashBoxId?: string | string[];
    bankAccountId?: string | string[];
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.PaymentWhereInput = {};
    if (params.direction) where.direction = params.direction;
    if (params.status) where.status = params.status;

    // YÖNTEM: katalog 4 değerli (NAKİT/HAVALE/KART/DİĞER) → çoklu seçim
    // ANLAMLIDIR ("nakit + kart").
    // ⚠️ GEÇERSİZ DEĞER SESSİZCE ATILMAZ, 400 OLUR. Süzüp atmak en tehlikeli
    // davranıştır: filtre ekranda seçili görünürken sorgudan DÜŞER ve liste
    // "filtresizmiş gibi" döner — boş listeden kötüsü, YANLIŞ liste (CSV
    // tuzağının üçüncü arıza modu).
    // ⚠️ Route Zod'u `method`i ENUM OLARAK DOĞRULAMAZ (CSV parçalama burada
    // yapıldığı için orada `z.string()`tir) — yani bu satır tek kapıdır, "ikinci
    // hat" değil.
    // ⚠️ `m in PaymentMethod` YAZMA: `in` prototip zincirini de tarar ve
    // `?method=toString` guard'ı geçip ham Prisma hatasına düşerdi
    // (`isEnumMember` başlığında ölçümüyle yazılı).
    const methods = readFilterList(params.method);
    const unknownMethod = methods.find((m) => !isEnumMember(PaymentMethod, m));
    if (unknownMethod) {
      throw AppError.badRequest(
        `Geçersiz ödeme yöntemi: "${unknownMethod}". Beklenen: ${Object.keys(PaymentMethod).join(", ")}.`,
      );
    }
    const methodList = methods as PaymentMethod[];
    if (methodList.length === 1) where.method = methodList[0];
    else if (methodList.length > 1) where.method = { in: methodList };

    const cari = readIdCondition(params.cariId);
    if (cari) where.cariId = cari;
    const cashBox = readIdCondition(params.cashBoxId);
    if (cashBox) where.cashBoxId = cashBox;
    const bankAccount = readIdCondition(params.bankAccountId);
    if (bankAccount) where.bankAccountId = bankAccount;
    if (params.from || params.to) {
      where.paymentDate = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    }
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI: `reference` serbest metindir (dekont açıklaması).
      where.OR = buildTurkishSearch(params.search, ["docNo", "reference"]);
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
          cashTransaction: { select: { id: true, docNo: true, txnDate: true, status: true } },
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
