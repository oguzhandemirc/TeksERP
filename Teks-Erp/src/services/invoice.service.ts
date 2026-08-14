// =============================================================================
// FATURA SERVİSİ — taslak · onay · storno
// =============================================================================
// SÖZLEŞME (sektör standardı, koda gömülü):
//   TASLAK serbestçe düzenlenir ve silinebilir — deftere HİÇBİR ŞEY yazmaz.
//   ONAY tek yönlüdür: cari deftere satır düşer, bakiye değişir, belge donar.
//   ONAYLANMIŞ FATURA ASLA DÜZENLENMEZ/SİLİNMEZ — düzeltme = STORNO + yeni.
//
// Bu üçlü, `CariTransaction`'ın append-only olmasının da sebebidir: geçmişi
// değiştirilebilen bir defter denetimde hiçbir şey kanıtlamaz.
// =============================================================================
import { Prisma, InvoiceStatus, InvoiceType, Currency, CariTxnSource, PrintedDocType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import {
  D,
  D0,
  computeLineAmounts,
  computeInvoiceTotals,
  invoiceLedgerSide,
  nextInvoiceNo,
  resolveExchangeRate,
  ensureCariAccountTx,
  applyCariBalanceTx,
} from "./helpers/finance.helper";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import { renderInvoiceInternalHtml, type InvoiceDoc } from "./document-render/finance-doc.html";
import { releaseAllocationsForInvoiceTx } from "./payment-allocation.service";
import { assertPeriodOpenTx } from "./helpers/period-guard.helper";
import type { ApiResponse } from "../types/api.types";

export interface InvoiceLineInput {
  itemId?: string | null;
  description: string;
  qty: Prisma.Decimal.Value;
  unit?: string;
  unitPrice: Prisma.Decimal.Value;
  discountRate?: Prisma.Decimal.Value;
  vatRate?: Prisma.Decimal.Value;
  withholdingRate?: Prisma.Decimal.Value;
}

export interface CreateInvoiceInput {
  type: InvoiceType;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  exchangeRate?: Prisma.Decimal.Value | null;
  issueDate?: Date;
  dueDate?: Date | null;
  externalNo?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
  /** Kaynak belge bağları — otomatik taslak üretimi bunları doldurur. */
  shipmentId?: string | null;
  directShipmentId?: string | null;
  returnGroupId?: string | null;
  subcontractorReceiptId?: string | null;
  goodsReceiptId?: string | null;
  clientToken?: string | null;
}

const LIST_SELECT = {
  id: true,
  docNo: true,
  type: true,
  status: true,
  currency: true,
  exchangeRate: true,
  issueDate: true,
  dueDate: true,
  externalNo: true,
  grandTotal: true,
  grandTotalTry: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  cari: {
    select: {
      id: true,
      kind: true,
      customer: { select: { code: true, name: true } },
      subcontractor: { select: { code: true, name: true } },
    },
  },
} as const;

export class InvoiceService {
  // ---------------------------------------------------------------------------
  // TASLAK
  // ---------------------------------------------------------------------------

  /**
   * Fatura taslağı oluşturur. Deftere HİÇBİR ŞEY yazmaz.
   *
   * ⚠️ Belge numarası TASLAK anında verilir (onayda değil). Sebep pratik:
   * muhasebeci taslağı yazdırıp kontrol ediyor ve numarasız kâğıt takip
   * edilemiyor. Numara sarf edilmiş olur ve iptal edilen taslağın numarası
   * BOŞTA KALIR — bu, muhasebede olağandır (iptal edilen belge de numaralıdır).
   */
  async createDraft(input: CreateInvoiceInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    if (input.lines.length === 0) throw AppError.badRequest("Fatura en az bir satır içermeli.");

    // İdempotency: aynı token ile ikinci POST MEVCUT faturayı döner, ikincisini
    // AÇMAZ (timeout-retry'de çift taslak doğmasın).
    if (input.clientToken) {
      const existing = await prisma.invoice.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, docNo: true },
      });
      if (existing) return { success: true, data: existing, message: "Fatura zaten oluşturulmuş." };
    }

    const issueDate = input.issueDate ?? new Date();
    const currency = input.currency ?? Currency.TRY;

    return withBarcodeRetry(async () => {
      const result = await prisma.$transaction(async (tx) => {
        const cari = await ensureCariAccountTx(tx, {
          customerId: input.customerId ?? null,
          subcontractorId: input.subcontractorId ?? null,
        });

        // KUR: açıkça verildiyse o, verilmediyse tablodan çözülür.
        // ⚠️ Çözülemezse 400 — sessizce 1'e düşmek 1000 USD'lik faturayı
        // 1000 TL olarak deftere yazardı (bakiye ~30 kat yanlış, hata yok).
        let rate = input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRate(tx, currency, issueDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${currency} için ${issueDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin veya faturada elle belirtin.`,
          );
        }
        if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

        await this.assertSourceFree(tx, input);

        const docNo = await nextInvoiceNo(tx, input.type, issueDate);
        const totals = computeInvoiceTotals(input.lines);

        const invoice = await tx.invoice.create({
          data: {
            docNo,
            type: input.type,
            status: InvoiceStatus.DRAFT,
            cariId: cari.id,
            currency,
            exchangeRate: rate,
            issueDate,
            dueDate: input.dueDate ?? null,
            externalNo: input.externalNo ?? null,
            notes: input.notes ?? null,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            vatTotal: totals.vatTotal,
            withholdingTotal: totals.withholdingTotal,
            grandTotal: totals.grandTotal,
            grandTotalTry: totals.grandTotal.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            shipmentId: input.shipmentId ?? null,
            directShipmentId: input.directShipmentId ?? null,
            returnGroupId: input.returnGroupId ?? null,
            subcontractorReceiptId: input.subcontractorReceiptId ?? null,
            goodsReceiptId: input.goodsReceiptId ?? null,
            createdById: userId ?? null,
            clientToken: input.clientToken ?? null,
            lines: {
              create: input.lines.map((l, i) => {
                const a = computeLineAmounts(l);
                return {
                  lineNo: i + 1,
                  itemId: l.itemId ?? null,
                  description: l.description,
                  qty: D(l.qty),
                  unit: l.unit ?? "m",
                  unitPrice: D(l.unitPrice),
                  discountRate: D(l.discountRate ?? 0),
                  vatRate: D(l.vatRate ?? 0),
                  withholdingRate: D(l.withholdingRate ?? 0),
                  lineTotal: a.lineTotal,
                  vatAmount: a.vatAmount,
                };
              }),
            },
          },
          select: { id: true, docNo: true },
        });
        return invoice;
      });

      void AuditService.log({
        userId,
        action: "CREATE",
        tableName: "INVOICE",
        recordId: result.id,
        newData: { docNo: result.docNo, type: input.type },
      });
      return { success: true, data: result, message: `${result.docNo} taslağı oluşturuldu.` };
    });
  }

  /**
   * MAL KABUL FİŞİNDEN ALIŞ FATURASI TASLAĞI.
   *
   * Muhasebecinin 20 kalemlik fişi satır satır yeniden yazmasını önler —
   * persona denetiminde "kritik" işaretlenen sürtünmelerden biri.
   *
   * ⚠️ SATIRLAR GRUPLANIR (ürün + renk + FİYAT): fiş 20 top doğurmuş olabilir
   * ama fatura satırı 20 olmamalı — tedarikçi faturası "Patos gri 10.000 m"
   * der, "500 m × 20 satır" demez. Gruplama anahtarına FİYAT dahildir: aynı
   * kumaşın farklı fiyatlı partileri tek satırda toplanamaz (ortalama fiyat
   * uydurmak olurdu).
   *
   * ⚠️ İPTAL EDİLMİŞ TOPLAR DIŞARIDA: iptal "bu mal hiç gelmedi" demektir
   * (softDelete qtyOut=0 semantiği) — faturaya girerse gelmeyen mala para
   * ödenir.
   *
   * ⚠️ Miktar `currentQty` DEĞİL `initialQty`: fatura MAL KABUL ANINI belgeler;
   * top sonradan kesilir/sevk edilirse tedarikçiye borcumuz değişmez.
   */
  async createDraftFromGoodsReceipt(
    goodsReceiptId: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      select: {
        id: true,
        receiptNo: true,
        status: true,
        currency: true,
        supplierId: true,
        deliveryNoteNo: true,
        createdAt: true,
        rolls: {
          where: { status: { not: "CANCELLED" } },
          select: {
            initialQty: true,
            purchasePrice: true,
            item: { select: { id: true, name: true, unit: true } },
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === "CANCELLED") {
      throw AppError.conflict(`${receipt.receiptNo} iptal edilmiş — faturası kesilemez.`);
    }
    if (!receipt.supplierId) {
      throw AppError.badRequest(
        `${receipt.receiptNo} fişinde tedarikçi seçilmemiş — alış faturası için tedarikçi gerekli.`,
      );
    }
    if (receipt.rolls.length === 0) {
      throw AppError.badRequest(`${receipt.receiptNo} fişinde faturalanacak top yok.`);
    }

    const groups = new Map<
      string,
      { itemId: string; description: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal; unit: string }
    >();
    for (const r of receipt.rolls) {
      const price = D(r.purchasePrice ?? 0);
      const key = `${r.item.id}|${r.color?.name ?? ""}|${price.toString()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.qty = existing.qty.plus(D(r.initialQty));
      } else {
        groups.set(key, {
          itemId: r.item.id,
          description: r.color?.name ? `${r.item.name} · ${r.color.name}` : r.item.name,
          qty: D(r.initialQty),
          unitPrice: price,
          unit: r.item.unit ?? "m",
        });
      }
    }

    return this.createDraft(
      {
        type: InvoiceType.PURCHASE,
        customerId: receipt.supplierId,
        currency: receipt.currency,
        issueDate: receipt.createdAt,
        externalNo: receipt.deliveryNoteNo,
        notes: `${receipt.receiptNo} mal kabul fişinden üretildi.`,
        goodsReceiptId: receipt.id,
        lines: [...groups.values()].map((g) => ({
          itemId: g.itemId,
          description: g.description,
          qty: g.qty,
          unit: g.unit,
          unitPrice: g.unitPrice,
          vatRate: 20,
        })),
      },
      userId,
    );
  }

  /**
   * Kaynak belge zaten faturalanmış mı?
   *
   * ⚠️ Bu kontrol partial unique'i YEDEKLEMEZ, ONU AÇIKLAR: DB seddi yarışı
   * kapatır ama kullanıcıya "unique ihlali" der; burası anlamlı mesaj üretir.
   * İkisi birlikte gerekli — yalnız bu kontrol yarışa açık, yalnız sed ise
   * anlaşılmaz.
   */
  private async assertSourceFree(tx: Prisma.TransactionClient, input: CreateInvoiceInput): Promise<void> {
    const src: Array<[keyof CreateInvoiceInput, string, string]> = [
      ["shipmentId", "shipmentId", "Bu sevkiyat"],
      ["directShipmentId", "directShipmentId", "Bu doğrudan sevk"],
      ["returnGroupId", "returnGroupId", "Bu iade"],
      ["subcontractorReceiptId", "subcontractorReceiptId", "Bu fason kabul"],
      ["goodsReceiptId", "goodsReceiptId", "Bu mal kabul fişi"],
    ];
    for (const [key, col, label] of src) {
      const value = input[key] as string | null | undefined;
      if (!value) continue;
      const dup = await tx.invoice.findFirst({
        where: { [col]: value, status: { not: InvoiceStatus.CANCELLED } } as Prisma.InvoiceWhereInput,
        select: { docNo: true, status: true },
      });
      if (dup) {
        throw AppError.conflict(
          `${label} için zaten bir fatura var: ${dup.docNo} (${dup.status === "DRAFT" ? "taslak" : "onaylı"}). Yeni fatura için önce onu iptal edin.`,
        );
      }
    }
  }

  /** Taslak satırlarını TOPTAN değiştirir (onaylıda 409). */
  async updateDraft(
    id: string,
    input: {
      lines?: InvoiceLineInput[];
      dueDate?: Date | null;
      externalNo?: string | null;
      notes?: string | null;
      exchangeRate?: Prisma.Decimal.Value;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, docNo: true, currency: true, exchangeRate: true },
    });
    if (!existing) throw AppError.notFound("Fatura bulunamadı.");
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw AppError.conflict(
        `${existing.docNo} ${existing.status === "CONFIRMED" ? "onaylanmış" : "iptal edilmiş"} — düzenlenemez. Düzeltme için iptal edip yeni fatura kesin.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      const rate = input.exchangeRate != null ? D(input.exchangeRate) : D(existing.exchangeRate);
      if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

      if (input.lines) {
        if (input.lines.length === 0) throw AppError.badRequest("Fatura en az bir satır içermeli.");
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        for (const [i, l] of input.lines.entries()) {
          const a = computeLineAmounts(l);
          await tx.invoiceLine.create({
            data: {
              invoiceId: id,
              lineNo: i + 1,
              itemId: l.itemId ?? null,
              description: l.description,
              qty: D(l.qty),
              unit: l.unit ?? "m",
              unitPrice: D(l.unitPrice),
              discountRate: D(l.discountRate ?? 0),
              vatRate: D(l.vatRate ?? 0),
              withholdingRate: D(l.withholdingRate ?? 0),
              lineTotal: a.lineTotal,
              vatAmount: a.vatAmount,
            },
          });
        }
      }

      const lines = input.lines ?? (await this.loadLinesForTotals(tx, id));
      const totals = computeInvoiceTotals(lines);
      await tx.invoice.update({
        where: { id },
        data: {
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.externalNo !== undefined ? { externalNo: input.externalNo } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          exchangeRate: rate,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          vatTotal: totals.vatTotal,
          withholdingTotal: totals.withholdingTotal,
          grandTotal: totals.grandTotal,
          grandTotalTry: totals.grandTotal.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        },
      });
    });

    void AuditService.log({ userId, action: "UPDATE", tableName: "INVOICE", recordId: id });
    return { success: true, data: { id }, message: "Taslak güncellendi." };
  }

  private async loadLinesForTotals(tx: Prisma.TransactionClient, invoiceId: string): Promise<InvoiceLineInput[]> {
    const rows = await tx.invoiceLine.findMany({
      where: { invoiceId },
      select: { qty: true, unitPrice: true, discountRate: true, vatRate: true, withholdingRate: true, description: true },
      orderBy: { lineNo: "asc" },
    });
    return rows.map((r) => ({
      description: r.description,
      qty: r.qty,
      unitPrice: r.unitPrice,
      discountRate: r.discountRate,
      vatRate: r.vatRate,
      withholdingRate: r.withholdingRate,
    }));
  }

  /** Taslak SİLİNEBİLİR (deftere hiçbir şey yazmadı). Onaylı fatura silinemez. */
  async deleteDraft(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.invoice.findUnique({ where: { id }, select: { status: true, docNo: true } });
    if (!existing) throw AppError.notFound("Fatura bulunamadı.");
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw AppError.conflict(`${existing.docNo} taslak değil — silinemez. Onaylı fatura ancak İPTAL (storno) edilir.`);
    }
    await prisma.invoice.delete({ where: { id } });
    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "INVOICE",
      recordId: id,
      oldData: { docNo: existing.docNo },
    });
    return { success: true, data: { id }, message: `${existing.docNo} taslağı silindi.` };
  }

  // ---------------------------------------------------------------------------
  // ONAY
  // ---------------------------------------------------------------------------

  /**
   * Faturayı ONAYLAR — cari deftere işler.
   *
   * ⚠️ ATOMİK CLAIM: `updateMany WHERE {id, status: DRAFT}` + `count === 0` →
   * 409. İki eşzamanlı onay isteği (çift tıklama / offline flush) `findUnique →
   * if → update` deseninde İKİ defter satırı yazar ve bakiyeyi iki katına
   * çıkarırdı — hata çıkmadan.
   *
   * ⚠️ Toplamlar SATIRLARDAN YENİDEN hesaplanır. Taslaktaki damgalı toplama
   * güvenmek, satırların taslak yolundan farklı bir yolla değiştiği (veri
   * düzeltmesi, eski istemci) her durumda deftere yanlış tutar yazardı.
   */
  async confirm(id: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id, status: InvoiceStatus.DRAFT },
        data: { status: InvoiceStatus.CONFIRMED, confirmedAt: new Date(), confirmedById: userId ?? null },
      });
      if (claimed.count === 0) {
        const cur = await tx.invoice.findUnique({ where: { id }, select: { status: true, docNo: true } });
        if (!cur) throw AppError.notFound("Fatura bulunamadı.");
        throw AppError.conflict(
          cur.status === "CONFIRMED"
            ? `${cur.docNo} zaten onaylanmış.`
            : `${cur.docNo} iptal edilmiş — onaylanamaz.`,
        );
      }

      // Claim SONRASI içerik tx İÇİNDE taze yüklenir (check-then-act değil).
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          docNo: true,
          type: true,
          cariId: true,
          currency: true,
          exchangeRate: true,
          issueDate: true,
          shipmentId: true,
          directShipmentId: true,
        },
      });

      const lineRows = await tx.invoiceLine.findMany({
        where: { invoiceId: id },
        select: { qty: true, unitPrice: true, discountRate: true, vatRate: true, withholdingRate: true, description: true },
      });
      if (lineRows.length === 0) throw AppError.badRequest("Satırsız fatura onaylanamaz.");
      // ⚠️ FİYATSIZ SATIRLA ONAY REDDEDİLİR: 0 fiyatlı satır deftere 0 yazar ve
      // "faturalandı" görünür — alacak sessizce kaybolur. Taslakta 0 serbesttir
      // (fiyat sonradan girilecek), onayda değildir.
      const zero = lineRows.find((l) => D(l.unitPrice).lte(0));
      if (zero) {
        throw AppError.badRequest(`"${zero.description}" satırının birim fiyatı girilmemiş — fiyatsız fatura onaylanamaz.`);
      }

      const totals = computeInvoiceTotals(lineRows);
      const rate = D(inv.exchangeRate);
      const grandTry = totals.grandTotal.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      await tx.invoice.update({
        where: { id },
        data: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          vatTotal: totals.vatTotal,
          withholdingTotal: totals.withholdingTotal,
          grandTotal: totals.grandTotal,
          grandTotalTry: grandTry,
        },
      });

      // ⚠️ DÖNEM KİLİDİ — satır YAZILMADAN ÖNCE. `txnDate` faturanın
      // `issueDate`'i (now DEĞİL): geçmişe tarihli bir faturanın onayı kapanmış
      // bir döneme düşebilir ve o dönemin ilan edilmiş bakiyesini geriye dönük
      // değiştirirdi. Kapanış bir FOTOĞRAFTIR; sonradan içine kayıt sokulamaz.
      await assertPeriodOpenTx(tx, {
        cariId: inv.cariId,
        currency: inv.currency,
        txnDate: inv.issueDate,
      });

      // DEFTER SATIRI — yön tek kaynaktan (`invoiceLedgerSide`).
      const side = invoiceLedgerSide(inv.type);
      await tx.cariTransaction.create({
        data: {
          cariId: inv.cariId,
          currency: inv.currency,
          txnDate: inv.issueDate,
          debit: side === "debit" ? totals.grandTotal : D0(),
          credit: side === "credit" ? totals.grandTotal : D0(),
          amountTry: grandTry,
          exchangeRate: rate,
          sourceType: CariTxnSource.INVOICE,
          invoiceId: inv.id,
          description: `${inv.docNo}`,
          createdById: userId ?? null,
        },
      });

      // Bakiye: POZİTİF = cari BİZE borçlu.
      const delta = side === "debit" ? totals.grandTotal : totals.grandTotal.negated();
      await applyCariBalanceTx(tx, inv.cariId, inv.currency, delta);

      // ── KAYNAK SEVKİYAT DAMGASI — "iki faturalandı gerçeği" birleşir ─────
      // `Shipment.invoiceNo` dış muhasebe programındaki belgenin izi olarak
      // doğdu (2026-08-02). İç fatura modülü gelince aynı soru ("bu sevkiyat
      // faturalandı mı") İKİ kaynaktan cevaplanır oldu ve ayrışabilirlerdi:
      // muhasebe ekranı işaretsiz gösterirken içeride onaylı fatura durabilir,
      // storno guard'ı (faturalı sevk geri alınamaz) da devreye girmezdi.
      // Onay artık kaynağı AYNI tx'te damgalar; iptal (aşağıda) yalnız KENDİ
      // damgasını temizler — elle basılmış dış-program işaretine dokunmaz.
      if (inv.shipmentId) {
        const shp = await tx.shipment.findUniqueOrThrow({
          where: { id: inv.shipmentId },
          select: { status: true, invoiceNo: true, shipmentNo: true },
        });
        if (shp.invoiceNo && shp.invoiceNo !== inv.docNo) {
          // Elle farklı bir belge numarası işaretlenmiş — çift faturalama
          // sinyali; sessizce üstüne yazmak dış muhasebedeki izi yok ederdi.
          throw AppError.conflict(
            `${shp.shipmentNo} zaten "${shp.invoiceNo}" ile faturalanmış işaretli — önce Muhasebe ekranından o işareti kaldırın.`,
          );
        }
        // PLANNED sevkiyat damgalanmaz (fatura irsaliyeden kesilir; işaret
        // sözleşmesi "yalnız DISPATCHED" — 2026-08-02 kuralı). Fatura yine
        // geçerlidir; sevk edildiğinde işaret muhasebe ekranından basılabilir.
        if (shp.status === "DISPATCHED" && !shp.invoiceNo) {
          await tx.shipment.update({
            where: { id: inv.shipmentId },
            data: { invoiceNo: inv.docNo, invoicedAt: new Date(), invoicedById: userId ?? null },
          });
        }
      }
      if (inv.directShipmentId) {
        const ds = await tx.directShipment.findUniqueOrThrow({
          where: { id: inv.directShipmentId },
          select: { invoiceNo: true, dispatchNo: true },
        });
        if (ds.invoiceNo && ds.invoiceNo !== inv.docNo) {
          throw AppError.conflict(
            `${ds.dispatchNo} zaten "${ds.invoiceNo}" ile faturalanmış işaretli — önce Muhasebe ekranından o işareti kaldırın.`,
          );
        }
        if (!ds.invoiceNo) {
          await tx.directShipment.update({
            where: { id: inv.directShipmentId },
            data: { invoiceNo: inv.docNo, invoicedAt: new Date(), invoicedById: userId ?? null },
          });
        }
      }

      // ⚠️ BELGE ONAY ANINDA DONAR, taslakta DEĞİL. Taslak serbestçe düzenlenip
      // silinebilir; resmi kayıt onayla doğar. Freeze tx'in İÇİNDE: fatura
      // deftere işlerken belge de donmalı, ikisi ya birlikte olur ya hiç.
      // (Emsal: transfer irsaliyesi — mal kabul fişinin LAZY-INIT yolu burada
      // YANLIŞ olurdu, çünkü fatura bir KAP değil, onaylanmış bir beyandır.)
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.INVOICE_INTERNAL,
        inv.id,
        userId,
      );

      return { id: inv.id, docNo: inv.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "INVOICE",
      recordId: id,
      newData: { event: "INVOICE_CONFIRMED", docNo: result.docNo },
    });
    return { success: true, data: result, message: `${result.docNo} onaylandı ve cari hesaba işlendi.` };
  }

  // ---------------------------------------------------------------------------
  // İPTAL (STORNO)
  // ---------------------------------------------------------------------------

  /**
   * Faturayı iptal eder.
   *
   * TASLAK → yalnız statü değişir (deftere hiç girmemişti).
   * ONAYLI → STORNO: TERS defter satırı yazılır, bakiye geri alınır.
   *
   * ⚠️ Orijinal defter satırı SİLİNMEZ. Append-only defterin tüm anlamı budur:
   * ekstrede hem fatura hem storno satırı görünür ve "bu tutar neden değişti"
   * sorusu belgelerle cevaplanır. Satırı silmek, geçmişi yeniden yazmaktır.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id, status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.CONFIRMED] } },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason ?? null,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.invoice.findUnique({ where: { id }, select: { docNo: true } });
        if (!cur) throw AppError.notFound("Fatura bulunamadı.");
        throw AppError.conflict(`${cur.docNo} zaten iptal edilmiş.`);
      }

      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          docNo: true,
          type: true,
          cariId: true,
          currency: true,
          exchangeRate: true,
          grandTotal: true,
          grandTotalTry: true,
          shipmentId: true,
          directShipmentId: true,
        },
      });

      // ⚠️ KAPAMA ÇÖZÜLMESİ: bu fatura tahsilat/çekle kapatılmış olabilir.
      // Bağı çözmezsek ödeme "kullanılmış" kalır (allocatedTotal düşmez) ve o
      // para başka bir faturayı kapatmak için bir daha kullanılamaz — sessiz
      // bir kayıp. Taslak iptalinde satır zaten yoktur, yardımcı no-op döner.
      await releaseAllocationsForInvoiceTx(tx, id, { reason: "INVOICE_CANCEL" });

      // Deftere işlemiş miydi? (taslak iptalinde ters satır YOK — yoksa hiç
      // olmamış bir borcu sıfırlayan hayalet satır doğardı.)
      const posted = await tx.cariTransaction.findFirst({
        where: { invoiceId: id, sourceType: CariTxnSource.INVOICE },
        select: { id: true },
      });
      if (posted) {
        // Storno satırı CARİ döneme düşer (`txnDate: new Date()`), yine de
        // kilit sorulur: "pratikte açık döneme düşer" bir invariant değildir.
        await assertPeriodOpenTx(tx, {
          cariId: inv.cariId,
          currency: inv.currency,
          txnDate: new Date(),
        });
        const side = invoiceLedgerSide(inv.type);
        // TERS satır: borç yazılmışsa alacak, alacak yazılmışsa borç.
        await tx.cariTransaction.create({
          data: {
            cariId: inv.cariId,
            currency: inv.currency,
            txnDate: new Date(),
            debit: side === "credit" ? D(inv.grandTotal) : D0(),
            credit: side === "debit" ? D(inv.grandTotal) : D0(),
            amountTry: D(inv.grandTotalTry),
            exchangeRate: D(inv.exchangeRate),
            sourceType: CariTxnSource.INVOICE_CANCEL,
            invoiceId: inv.id,
            description: `${inv.docNo} İPTAL${reason ? ` — ${reason}` : ""}`,
            createdById: userId ?? null,
          },
        });
        const delta = side === "debit" ? D(inv.grandTotal).negated() : D(inv.grandTotal);
        await applyCariBalanceTx(tx, inv.cariId, inv.currency, delta);
      }

      // Kaynak damgası YALNIZ bizimse temizlenir (updateMany koşulu bunu
      // atomik yapar): elle basılmış dış-program işareti bizim iptalimizle
      // silinmemeli. Tarih de birlikte temizlenir — yarım durum yok
      // (setShipmentInvoice sözleşmesiyle aynı).
      if (inv.shipmentId) {
        await tx.shipment.updateMany({
          where: { id: inv.shipmentId, invoiceNo: inv.docNo },
          data: { invoiceNo: null, invoicedAt: null, invoicedById: null },
        });
      }
      if (inv.directShipmentId) {
        await tx.directShipment.updateMany({
          where: { id: inv.directShipmentId, invoiceNo: inv.docNo },
          data: { invoiceNo: null, invoicedAt: null, invoicedById: null },
        });
      }

      // Storno → resmi belge İPTAL filigranıyla VOIDED'e çekilir. Belge SİLİNMEZ
      // (donmuş belge kuralı): dosyaya bakan kişi iptal edilmiş faturayı da
      // yeniden basabilmeli. Taslak iptalinde belge zaten hiç doğmamıştır ve
      // `voidForSource` sessizce no-op olur.
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.INVOICE_INTERNAL,
        inv.id,
        reason ?? "Fatura iptal edildi",
      );

      return { id: inv.id, docNo: inv.docNo, wasPosted: Boolean(posted) };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "INVOICE",
      recordId: id,
      newData: { event: "INVOICE_CANCELLED", docNo: result.docNo, reason, storno: result.wasPosted },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: result.wasPosted
        ? `${result.docNo} iptal edildi ve cari hesaptan ters kayıtla geri alındı.`
        : `${result.docNo} taslağı iptal edildi.`,
    };
  }

  // ---------------------------------------------------------------------------
  // OKUMA
  // ---------------------------------------------------------------------------

  async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    type?: InvoiceType;
    status?: InvoiceStatus;
    cariId?: string;
    from?: Date;
    to?: Date;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.InvoiceWhereInput = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.cariId) where.cariId = params.cariId;
    if (params.from || params.to) {
      where.issueDate = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { docNo: { contains: q, mode: "insensitive" } },
        { externalNo: { contains: q, mode: "insensitive" } },
        { cari: { customer: { name: { contains: q, mode: "insensitive" } } } },
        { cari: { subcontractor: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);
    return {
      data,
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findById(id: string) {
    const row = await prisma.invoice.findUnique({
      where: { id },
      include: {
        cari: {
          select: {
            id: true,
            kind: true,
            taxOffice: true,
            customer: { select: { id: true, code: true, name: true, taxNumber: true } },
            subcontractor: { select: { id: true, code: true, name: true, taxNumber: true } },
          },
        },
        goodsReceipt: { select: { id: true, receiptNo: true, deliveryNoteNo: true } },
        lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (!row) throw AppError.notFound("Fatura bulunamadı.");
    return { success: true, data: row };
  }
}

export const invoiceService = new InvoiceService();

// ---------------------------------------------------------------------------
// BELGE BUILDER — iç fatura
// ---------------------------------------------------------------------------
// ⚠️ Kayıt IMPORT YAN ETKİSİYLE oluşur: `app.ts` → finance.routes → bu servis.
// Bekçilerde (`test_printed_doc_builders`, `test_document_style`) import satırı
// yoksa registry boş kalır ve testler vakumen yeşile döner.

/** Belge başlığı TÜRDEN gelir — "aldık" ile "sattık" aynı kâğıtta olamaz. */
const INVOICE_TYPE_TITLE: Record<InvoiceType, string> = {
  SALES: "Satış Faturası",
  PURCHASE: "Alış Faturası",
  SALES_RETURN: "Satış İade Faturası",
  PURCHASE_RETURN: "Alış İade Faturası",
};

registerPrintedDocBuilder(PrintedDocType.INVOICE_INTERNAL, {
  fresh: async (db, sourceId) => {
    const inv = await db.invoice.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        id: true, docNo: true, type: true, status: true, issueDate: true, dueDate: true,
        currency: true, exchangeRate: true, externalNo: true, notes: true,
        subtotal: true, vatTotal: true, withholdingTotal: true, grandTotal: true, grandTotalTry: true,
        cancelReason: true, cancelledAt: true,
        // Ad/kod cari kartın BAĞLI OLDUĞU taraftan gelir (CariAccount kendi adını
        // taşımaz — `cari.service.partyOf` ile aynı kural). Vergi dairesi ise
        // CariAccount'ta: müşteri/fason kartlarına dokunulmadı.
        cari: {
          select: {
            taxOffice: true,
            customer: { select: { code: true, name: true, taxNumber: true } },
            subcontractor: { select: { code: true, name: true, taxNumber: true } },
          },
        },
        createdById: true,
        lines: {
          orderBy: { lineNo: "asc" },
          select: {
            description: true, qty: true, unit: true, unitPrice: true,
            discountRate: true, vatRate: true, lineTotal: true, vatAmount: true,
          },
        },
      },
    });
    const party = inv.cari?.customer ?? inv.cari?.subcontractor ?? null;
    const creator = inv.createdById
      ? await db.user.findUnique({
          where: { id: inv.createdById },
          select: { fullName: true, username: true },
        })
      : null;
    const doc: InvoiceDoc = {
      header: {
        documentNo: inv.docNo,
        date: inv.issueDate?.toISOString() ?? null,
        dueDate: inv.dueDate?.toISOString() ?? null,
        type: inv.type,
        typeLabel: INVOICE_TYPE_TITLE[inv.type],
        partyName: party?.name ?? "—",
        partyCode: party?.code ?? null,
        // Vergi bilgisi TEK satırda birleştirilir; ikisi de boşsa alan HİÇ basılmaz
        // (boş "Vergi: —" satırı belgeyi kirletir).
        partyTaxInfo:
          [inv.cari?.taxOffice, party?.taxNumber].filter(Boolean).join(" · ") || null,
        currency: inv.currency,
        exchangeRate: inv.exchangeRate?.toString() ?? null,
        externalNo: inv.externalNo,
        // ⚠️ `Invoice`ta createdBy İLİŞKİSİ yok (yalnız `createdById` kolonu) —
        // ad ayrı sorguyla çözülür. Belge donarken tek ek okuma; snapshot'a
        // AD yazılır, id değil: kullanıcı sonradan yeniden adlandırılsa bile
        // basılı belge o günkü adı taşımalı (donmuş belge kuralı).
        createdBy: creator?.fullName ?? creator?.username ?? null,
      },
      lines: inv.lines.map((l) => ({
        description: l.description,
        qty: l.qty.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toString(),
        discountRate: l.discountRate.toString(),
        vatRate: l.vatRate.toString(),
        lineNet: l.lineTotal.toString(),
        lineVat: l.vatAmount.toString(),
      })),
      totals: {
        net: inv.subtotal.toString(),
        vat: inv.vatTotal.toString(),
        withholding: inv.withholdingTotal.toString(),
        grand: inv.grandTotal.toString(),
        grandTry: inv.grandTotalTry?.toString() ?? null,
      },
      notes: inv.notes,
    };
    return {
      documentNo: inv.docNo,
      doc: doc as unknown as Record<string, unknown>,
      // İptal edilmiş fatura ilk kez basılıyorsa belge DOĞRUDAN VOIDED doğar —
      // İPTAL filigranıyla (mal kabul fişi emsali).
      voidInfo:
        inv.status === InvoiceStatus.CANCELLED
          ? { reason: inv.cancelReason, at: inv.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderInvoiceInternalHtml,
});
