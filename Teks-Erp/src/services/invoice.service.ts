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
import {
  Prisma,
  InvoiceStatus,
  InvoiceType,
  Currency,
  CariTxnSource,
  GoodsReceiptStatus,
  ItemType,
  PriceKind,
  PrintedDocType,
  RollStatus,
  YarnMovementKind,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
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
import {
  readFinanceAllowZeroPriceLineEnabled,
  readFinanceDefaultVatRate,
  readFinanceRiskLimitBlockEnabled,
  readFinanceYarnOutOnInvoiceEnabled,
} from "./system-setting.service";
import { assertNotFutureDatedTx } from "./helpers/future-date-guard.helper";
// ⚠️ İPLİK DEFTERİNE TEK YAZAR `yarn.service`tir (dosya başlığındaki "tek yazar"
// kuralı). Buradan YALNIZ `applyYarnMovementTx` çağrılır; `yarn_stocks`/
// `yarn_movements` tablolarına doğrudan yazan tek satır bile eklenmez — bakiye
// ile hareket satırı ayrışırsa defter sessizce yalan söyler.
import { applyYarnMovementTx, yarnMovementSign } from "./yarn.service";
import { getDefaultWarehouseId } from "./helpers/warehouse.helper";
import { renderInvoiceInternalHtml, type InvoiceDoc } from "./document-render/finance-doc.html";
import { releaseAllocationsForInvoiceTx } from "./payment-allocation.service";
// D2 — kalem fiyatı ÇÖZÜM SIRASININ TEK KAYNAĞI. Sıra burada KOPYALANMAZ.
import { resolveItemPricesFor } from "./item-price.service";
// Sınıf 5 — fişin satırları TEK KAYNAK assembler'dan okunur; `rolls`/`yarnMovements`
// tablolarına doğrudan gitmek (eski davranış) her tüketicide ayrı bir "hangi
// tablo" kararı doğuruyordu. (Döngü yok: goods-receipt.service bu dosyayı
// import ETMEZ — fatura kontrolünü prisma üzerinden yapar.)
import {
  goodsReceiptService,
  type ReceiptFabricLine,
  type ReceiptYarnLine,
} from "./goods-receipt.service";
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

/** Bir fatura yolunun iplik defterine yaptığı etki (çıkış ya da ters kayıt). */
interface YarnLedgerEffect {
  itemId: string;
  itemName: string;
  warehouseId: string;
  qtyKg: Prisma.Decimal;
  /** Hareketten SONRAKİ bakiye — DB'nin döndürdüğü değer. */
  balanceKg: Prisma.Decimal;
}

/**
 * Kullanıcıya dönen mesajın iplik eki.
 *
 * ⚠️ Etki YOKSA BOŞ STRING döner — bayrak kapalıyken (ya da faturada iplik
 * satırı yokken) mesaj bugünküyle BAYT-BAYT aynı kalır.
 *
 * ⚠️ EKSİ BAKİYE ENGEL DEĞİL, UYARIDIR ve mutlaka SÖYLENİR (`yarn.service`
 * başlığındaki kural + mal kabul iptalinin `yarnNote` emsali): sessiz eksi
 * bakiye, sayım yapılana kadar kimsenin fark etmediği bir hatadır.
 */
function describeYarnOut(effects: YarnLedgerEffect[], verb = "stoktan düşüldü"): string {
  if (effects.length === 0) return "";
  const negative = effects.filter((e) => e.balanceKg.lt(0));
  return (
    ` ${effects.length} iplik kalemi ${verb} (${effects.map((e) => `${e.itemName}: ${e.qtyKg.toString()} kg`).join(", ")}).` +
    (negative.length > 0
      ? ` ⚠️ ${negative.length} kalemde bakiye EKSİDE — açılış/sayım girişi eksik olabilir.`
      : "")
  );
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
  // H1 (2026-08-14): kapama görünürlüğü. AÇIK/KISMİ/KAPALI liste yanıtında
  // KOLON değil TÜRETMEDİR (payment-allocation.service başlığı: `paidTotal` ↔
  // `grandTotal` karşılaştırması) — burada yalnız ham sayaç taşınır, durumu
  // istemci türetir. İkinci bir durum alanı eklemek iki denormalize alanın
  // ayrışması demekti.
  paidTotal: true,
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

/**
 * DETAY yüzeyi (I4, 2026-08-14) — `include` DEĞİL `select`.
 *
 * ⚠️ Çıplak `include` TÜM skaler kolonları döndürür: `clientToken` (idempotency
 * iç anahtarı — istemcinin İŞİ OLMAYAN ve loglanan yanıtlarda gezmemesi gereken
 * değer) + çıplak iç FK'ler (`cariId`/`shipmentId`/`directShipmentId`/
 * `returnGroupId`/`subcontractorReceiptId`/`goodsReceiptId`/`confirmedById`/
 * `cancelledById`/`createdById`). Panel bunların HİÇBİRİNİ okumuyor (ölçüm
 * 2026-08-14: Electron fatura detay ucunu hiç çağırmıyor; kaynak bağı insanca
 * adıyla `goodsReceipt` ilişkisinden basılır). Kural: LIST_SELECT + detay
 * alanları + ilişkiler; iç kimlikler ilişkinin KENDİ `id`'siyle taşınır.
 *
 * ⚠️ Alan kümesi bekçiyle SABİTLENDİ (`test_finance_invoice` detay bölümü) —
 * alan ekleyip/düşürürken bekçiyi de güncelle; sessiz alan kaybı ekranda hata
 * değil BOŞ HÜCRE üretir.
 */
const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  subtotal: true,
  discountTotal: true,
  vatTotal: true,
  withholdingTotal: true,
  cancelReason: true,
  updatedAt: true,
  // Listedekinden ZENGİN cari: detay vergi no/dairesi de basar (spread'den
  // SONRA yazıldığı için LIST_SELECT.cari'yi ezer — sıra load-bearing).
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
  // KAYNAK BAĞLARI İNSANCA ADIYLA (2026-08-15, fatura detay yüzeyinin bulgusu):
  // sevkiyattan/fasondan doğan faturada detay ekranı kaynak satırı basamıyordu —
  // çıplak FK bilinçli dışarıda kalmaya devam eder, bağ ilişkinin kendi id'si +
  // belge numarasıyla taşınır (goodsReceipt emsali). `returnGroupId` İSTİSNA:
  // ilişkisi yok (grup lideri RollReturn id'sidir, ayrı model değil) → skaler
  // olarak döner; istemci onu yalnız "İade grubu" satırı basmak için kullanır.
  shipment: { select: { id: true, shipmentNo: true } },
  directShipment: { select: { id: true, shipmentNo: true } },
  subcontractorReceipt: { select: { id: true, receiptNo: true } },
  returnGroupId: true,
  lines: {
    orderBy: { lineNo: "asc" },
    select: {
      id: true,
      lineNo: true,
      description: true,
      qty: true,
      unit: true,
      unitPrice: true,
      discountRate: true,
      vatRate: true,
      withholdingRate: true,
      lineTotal: true,
      vatAmount: true,
      item: { select: { id: true, code: true, name: true } },
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

    // ── İLERİ TARİHLİ BELGE ENGELİ (finance.futureDatedDocumentBlockEnabled) ─
    // ⚠️ KAPI BURASIDIR, `confirm` DEĞİL — ve bu bilinçli:
    //  • `issueDate` yalnız burada belirlenir (`updateDraft` onu KABUL ETMEZ) ve
    //    belge numarası da ondan türer (`nextInvoiceNo(tx, type, issueDate)`).
    //    Yanlış tarih daha numara sarf edilmeden reddedilir.
    //  • Onayda kilitlemek ÇIKMAZ üretirdi: bayrak açılmadan ÖNCE doğmuş ileri
    //    tarihli bir taslağın tarihi düzeltilemez (düzenleme ucu tarih almıyor),
    //    yani tek çıkış yolu taslağı silmek olurdu. Guard bir yolu kapatırken
    //    kullanıcıya başka bir yol bırakmalı.
    //  • Bedeli yazılıdır: bayrak AÇILMADAN önce girilmiş ileri tarihli taslak
    //    onaylanabilir ve defter satırı o tarihe düşer. Rejim anahtarı ileriye
    //    dönük çalışır; geçmişi yeniden yazmaz.
    // Replay (aynı clientToken) YUKARIDA cevaplanır: mevcut bir faturayı geri
    // döndüren idempotent yanıt, bugün açılan bir bayrak yüzünden 400'e
    // dönmemeli — o istek yeni belge yaratmıyor.
    await assertNotFutureDatedTx(undefined, { date: issueDate, label: "Fatura tarihi" });

    // ⚠️ ÖN KONTROL TEK BAŞINA YETMEZ (check-then-act): aynı token'la İKİ
    // PARALEL istek ikisi de "token yok" görür, ikisi de INSERT eder ve biri
    // `clientToken` unique'ine çarpar. O P2002 RETRY EDİLMEZ (retry aynı
    // token'ı 5 tur boşa yazardı → yanıltıcı "Barkod üretimi ... başarısız"
    // 409'u); aşağıdaki catch onu cached yanıta çevirir (purchase-order emsali).
    try {
      return await withBarcodeRetry(async () => {
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
      },
      undefined,
      // Belge numarası yarışı (P2002 `docNo`) RETRY EDİLİR; `clientToken`
      // P2002'si retry EDİLMEZ — catch cached yanıta çevirir.
      (err) => !isClientTokenP2002(err));
    } catch (err) {
      // Catch tx DIŞINDA (aborted-transaction tuzağı). Cached yanıt ön
      // kontroldekiyle AYNI şekil + AYNI mesaj — replay ayırt edilemez.
      if (input.clientToken && isClientTokenP2002(err)) {
        const existing = await prisma.invoice.findUnique({
          where: { clientToken: input.clientToken },
          select: { id: true, docNo: true },
        });
        if (existing) return { success: true, data: existing, message: "Fatura zaten oluşturulmuş." };
      }
      throw err;
    }
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

    // ── SATIRLAR TEK KAYNAKTAN (Sınıf 5, 2026-08-14) ────────────────────────
    // ⚠️ İPLİK SATIRLARI DA FATURAYA GİRER (aynı günün denetim bulgusu,
    // KRİTİK). Eskiden buradaki select YALNIZ `rolls` okuyordu: karma bir fişte
    // (2 top kumaş + 500 kg iplik) taslak SADECE kumaşı taşıyor, iplik ne satır
    // ne uyarı olarak görünüyordu → cari borç eksik kalıyor, iplik depoda ama
    // karşılığında yükümlülük yok; hata da log da çıkmıyordu. Düzeltme önce
    // buraya ikinci bir el-yazımı select olarak girdi; aynı akşam satır okuma
    // `assembleReceiptLines`e TEKLEŞTİ — tabloya giden her kopya, bir sonraki
    // satır tipinde (CONSUMABLE) aynı deliği yeniden açar.
    //
    // Süzgeçler assembler SÖZLEŞMESİNİN tüketici tarafı:
    //  • Kumaşta CANCELLED dışarıda — iptal "bu mal hiç gelmedi" demektir
    //    (softDelete qtyOut=0 semantiği); faturaya girerse gelmeyen mala para
    //    ödenir.
    //  • İplikte yalnız `IN` — fiş iptali `ADJUST_OUT` yazar ve aynı fiş bağını
    //    taşır; süzgeç olmasa ters kayıt da faturaya satır olarak girerdi
    //    (iptalli fiş yukarıda zaten reddediliyor; bu derinlik savunmasıdır).
    const asm = await goodsReceiptService.assembleReceiptLines(receipt.id);
    const fabricLines = asm.lines.filter(
      (l): l is ReceiptFabricLine => l.kind === "FABRIC" && l.status !== RollStatus.CANCELLED,
    );
    const yarnInLines = asm.lines.filter(
      (l): l is ReceiptYarnLine => l.kind === "YARN" && l.movementKind === YarnMovementKind.IN,
    );

    // ⚠️ "top YOK" değil "faturalanacak SATIR yok": iplik-ONLY bir fiş eskiden
    // burada 400 alıyordu ("faturalanacak top yok") ve generic fatura ucu
    // `.strict()` şemasında `goodsReceiptId` KABUL ETMEDİĞİ için o fişe BAĞLI
    // fatura kesmenin hiçbir yolu kalmıyordu — 500 kg mal fiilen gelmişken.
    // Bağsız fatura kesilirse `invoices_one_active_per_goods_receipt` koruması
    // da devre dışı kalır, yani aynı iplik İKİ KEZ faturalanabilirdi.
    if (fabricLines.length === 0 && yarnInLines.length === 0) {
      throw AppError.badRequest(`${receipt.receiptNo} fişinde faturalanacak satır yok.`);
    }

    // ── FİYAT ÖN-DOLUMU (D2) ────────────────────────────────────────────────
    // Fişte fiyat girilmemiş satırlar için kalem kartının ALIŞ fiyatı çözülür
    // (tedarikçi istisnası > kart varsayılanı > null).
    // ⚠️ ASLA EZMEZ: fişte donan fiyat DOLUYSA o kazanır — sıfır dahil, çünkü
    // sıfır depocunun bilinçli girdisi olabilir (bedava numune).
    // ⚠️ Çözülemezse ESKİ DAVRANIŞ korunur (`0`) — bu, faturayı "bedava" ilan
    // etmek değil, `confirm`in sıfır fiyatlı satırı REDDEDEN seddine düşürmektir
    // (o sed 2026-08 öncesinden beri var). Buradan uydurma bir fiyat üretmek,
    // muhasebecinin göreceği tek uyarıyı susturmuş olurdu.
    // ⚠️ TEK sorgu (perf kuralı 9): fişte kaç satır olursa olsun tek lookup.
    // ⚠️ İPLİK KUMAŞLA BİREBİR AYNI ZİNCİRE GİRDİ: `movement.unitPrice ?? kart
    // ?? 0`. TARİHÇE: `YarnMovement.unitPrice` kolonu 2026-08-14'e kadar YOKTU
    // — iplik satırının fiyatı yalnız kalem kartından gelebiliyor, fişte açıkça
    // yazılan fiyat ise 400 yiyordu. Kolon geldi (Sınıf 5 migration'ı), fiyat
    // artık kabul ANINDA donuyor; kart fallback'i kolon-öncesi/fiyatsız
    // hareketler için duruyor.
    const missingPrice = [
      ...new Set([
        ...fabricLines.filter((l) => l.purchasePrice == null).map((l) => l.itemId),
        ...yarnInLines.filter((l) => l.unitPrice == null).map((l) => l.itemId),
      ]),
    ];
    const priceMap =
      missingPrice.length > 0
        ? await resolveItemPricesFor({
            itemIds: missingPrice,
            kind: PriceKind.PURCHASE,
            currency: receipt.currency,
            customerId: receipt.supplierId,
          })
        : null;

    const groups = new Map<
      string,
      { itemId: string; description: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal; unit: string }
    >();
    for (const r of fabricLines) {
      const price = D(r.purchasePrice ?? priceMap?.get(r.itemId)?.price ?? 0);
      const key = `${r.itemId}|${r.colorName ?? ""}|${price.toString()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.qty = existing.qty.plus(D(r.initialQty));
      } else {
        groups.set(key, {
          itemId: r.itemId,
          description: r.colorName ? `${r.itemName} · ${r.colorName}` : r.itemName,
          qty: D(r.initialQty),
          unitPrice: price,
          unit: r.itemUnit ?? "m",
        });
      }
    }

    // ── İPLİK SATIRLARI ──────────────────────────────────────────────────────
    // ⚠️ Kumaşla AYNI `groups` haritasına yazılır ama anahtarı `yarn|` ile
    // ön eklenir: iplik kalemi teorik olarak kumaş kalemiyle aynı `itemId`yi
    // taşıyamaz (ItemType farklı) ama renk alanı boş olduğu için anahtarlar
    // çakışabilirdi ve iki farklı BİRİMDEKİ (m ↔ kg) miktar tek satırda
    // toplanırdı — sessizce yanlış bir fatura tutarı.
    // ⚠️ Gruplama anahtarına FİYAT dahil (kumaş kuralının aynısı): aynı ipliğin
    // farklı fiyatlı partileri tek satırda toplanamaz — ortalama fiyat uydurmak
    // olurdu.
    // ⚠️ Birim SABİT "kg": iplik defterinin birimi kg'dir (`YarnMovement.qtyKg`)
    // ve `Item.unit` bundan farklı olabilir; kalem kartındaki birime güvenmek,
    // deftere kg yazılıp faturaya metre basmak demekti.
    for (const y of yarnInLines) {
      const price = D(y.unitPrice ?? priceMap?.get(y.itemId)?.price ?? 0);
      const key = `yarn|${y.itemId}|${price.toString()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.qty = existing.qty.plus(D(y.qtyKg));
      } else {
        groups.set(key, {
          itemId: y.itemId,
          description: y.itemName,
          qty: D(y.qtyKg),
          unitPrice: price,
          unit: "kg",
        });
      }
    }

    // KDV oranı FİRMA PARAMETRESİNDEN (finance.defaultVatRate; kayıt yoksa 20 =
    // eski hardcode, sıfır fark). Electron fatura formunun yeni satırı da aynı
    // ayardan okur — oran iki yerde ayrı sürüklenmez. Yalnız ÖN-DOLUM: taslak
    // satırında değiştirilebilir, `confirm` satır bazında geleni kullanır.
    const defaultVatRate = await readFinanceDefaultVatRate();

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
          vatRate: defaultVatRate,
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

  /**
   * Taslak satırlarını TOPTAN değiştirir (onaylıda 409).
   *
   * ⚠️ ATOMİK CLAIM tx İÇİNDE (Sınıf 4, 2026-08-14): statü kontrolü eskiden tx
   * DIŞINDA düz okumaydı ve son yazım koşulsuzdu — `confirm` ile yarışta
   * CONFIRMED faturanın satırları SESSİZCE yeniden yazılıyordu (defter eski
   * tutar, satırlar yeni tutar; hiçbir CHECK yakalamaz). Claim'in no-op yazımı
   * fatura satırının KİLİDİNİ tx sonuna kadar tutar: eşzamanlı `confirm` bu
   * kilitte bekler ve commit'imizden sonra YENİ satırlardan hesaplar; `confirm`
   * önce davrandıysa claim 0 döner ve 409 veririz. Satır deleteMany+create ve
   * toplam güncellemesi aynı tx'te — yarım yeniden-yazım kalamaz.
   */
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
    await prisma.$transaction(async (tx) => {
      // No-op yazım (`status: DRAFT` → DRAFT) bilinçli: `updateMany` satır
      // kilidini alır ve WHERE yüklemi statüyü ATOMİK doğrular — `findUnique →
      // if → update` check-then-act'i tam da kapatılan hataydı.
      const claimed = await tx.invoice.updateMany({
        where: { id, status: InvoiceStatus.DRAFT },
        data: { status: InvoiceStatus.DRAFT },
      });
      if (claimed.count === 0) {
        const cur = await tx.invoice.findUnique({ where: { id }, select: { status: true, docNo: true } });
        if (!cur) throw AppError.notFound("Fatura bulunamadı.");
        throw AppError.conflict(
          `${cur.docNo} ${cur.status === "CONFIRMED" ? "onaylanmış" : "iptal edilmiş"} — düzenlenemez. Düzeltme için iptal edip yeni fatura kesin.`,
        );
      }
      // Claim SONRASI içerik tx İÇİNDE taze yüklenir (`confirm` ile aynı desen).
      const existing = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { exchangeRate: true },
      });

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

  /**
   * Taslak SİLİNEBİLİR (deftere hiçbir şey yazmadı). Onaylı fatura silinemez.
   *
   * ⚠️ CLAIM'Lİ SİLME (Sınıf 4, 2026-08-14): eski hâli `findUnique → if →
   * delete` idi — `confirm` ile yarışta statü kontrolü DRAFT görüp koşulsuz
   * delete, o sırada onaylanmış (defter satırı doğmuş) faturayı silmeye
   * kalkıyor ve kullanıcıya `CariTransaction` FK'sının HAM P2003'ü çıkıyordu.
   * `deleteMany WHERE {id, status: DRAFT}` tek ifadede hem doğrular hem siler;
   * yarışı kaybedince anlamlı 409 döner. (Üstteki hızlı-yol okuma yalnız
   * `docNo`/mesaj içindir — yüklemi TAŞIMAZ, silme kararını deleteMany verir.)
   */
  async deleteDraft(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.invoice.findUnique({ where: { id }, select: { status: true, docNo: true } });
    if (!existing) throw AppError.notFound("Fatura bulunamadı.");
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw AppError.conflict(`${existing.docNo} taslak değil — silinemez. Onaylı fatura ancak İPTAL (storno) edilir.`);
    }
    const del = await prisma.invoice.deleteMany({ where: { id, status: InvoiceStatus.DRAFT } });
    if (del.count === 0) {
      // Yarışı kaybettik: hızlı-yol DRAFT gördü ama silme anında statü
      // değişmişti (eşzamanlı onay/iptal) ya da kayıt başka uçtan silindi.
      const cur = await prisma.invoice.findUnique({ where: { id }, select: { status: true, docNo: true } });
      if (!cur) throw AppError.notFound("Fatura bulunamadı.");
      throw AppError.conflict(`${cur.docNo} taslak değil — silinemez. Onaylı fatura ancak İPTAL (storno) edilir.`);
    }
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
          goodsReceiptId: true,
        },
      });
      // ⚠️ KAYNAK FİŞ SATIR KİLİDİYLE OKUNUR (Sınıf 4, 2026-08-14 akşam).
      // Sabah eklenen ilk hâli kilitsiz bir ilişki okumasıydı — o da
      // check-then-act: `goods-receipt.cancel` ile yarışta okuma ACTIVE görür,
      // iptal hemen ardından commit'ler ve onay hiç gelmemiş mal için tedarikçi
      // carisine borç yazardı (belge donar, hata da log da çıkmaz). `FOR UPDATE`
      // iki tarafı AYNI satırda serileştirir: iptalin claim'i (UPDATE
      // goods_receipts) bu kilidi bekler; iptal önce commit'lediyse bu okuma
      // CANCELLED'ı görür ve 409 veririz. Kontrol ayrıca fiş-iptal guard'ından
      // ÖNCE doğmuş faturalar için de tek hattır (canlı veride örneği vardı).
      // Kilit sırası: fatura satırı (claim) → goods_receipts (FOR UPDATE);
      // iptal tarafı goods_receipts (claim) → fatura OKUMASI (kilitsiz) — ortak
      // kilitli kaynak tek olduğu için ABBA çevrimi yok. (Zaman fonksiyonu yok
      // → `-- tz-ok` gerekmez.)
      if (inv.goodsReceiptId) {
        const grRows = await tx.$queryRaw<Array<{ receiptNo: string; status: string }>>`
          SELECT "receiptNo", "status"::text AS "status"
          FROM "goods_receipts" WHERE "id" = ${inv.goodsReceiptId}::uuid
          FOR UPDATE
        `;
        const gr = grRows[0];
        if (gr && gr.status === GoodsReceiptStatus.CANCELLED) {
          throw AppError.conflict(
            `${inv.docNo}: kaynak mal kabul fişi ${gr.receiptNo} İPTAL EDİLMİŞ — ` +
              `bu fatura onaylanamaz (mal fiilen girmedi). Faturayı iptal edin.`,
          );
        }
      }

      const lineRows = await tx.invoiceLine.findMany({
        where: { invoiceId: id },
        select: { qty: true, unitPrice: true, discountRate: true, vatRate: true, withholdingRate: true, description: true },
      });
      if (lineRows.length === 0) throw AppError.badRequest("Satırsız fatura onaylanamaz.");
      // ── FİYAT SEDDİ (finance.allowZeroPriceLineEnabled) ────────────────────
      // VARSAYILAN (bayrak KAPALI) davranış bayt-bayt korunur: `<= 0` olan İLK
      // satır aynı mesajla reddedilir. Gerekçe değişmedi — 0 fiyatlı satır
      // deftere 0 yazar ve "faturalandı" görünür; alacak sessizce kaybolur.
      // Taslakta 0 serbesttir (fiyat sonradan girilecek), onayda değildir.
      //
      // BAYRAK AÇIK: yalnız SIFIR serbestleşir (promosyon · numune · bedelsiz
      // sevk). ⚠️ NEGATİF FİYAT HER HÂLÜKÂRDA REDDEDİLİR ve bu pazarlık dışı:
      // eksi satır bir "indirim/iade" belgesidir, satış faturasına gizlenmiş
      // eksi kalem ise deftere yanlış yönde tutar yazmanın en sessiz yoludur
      // (iade ayrı belge tipidir: SALES_RETURN). İki dal AYRI yazıldı ki bayrak
      // kapalıyken mesaj da bugünküyle birebir aynı kalsın.
      const allowZeroPrice = await readFinanceAllowZeroPriceLineEnabled(tx);
      if (allowZeroPrice) {
        const negative = lineRows.find((l) => D(l.unitPrice).lt(0));
        if (negative) {
          throw AppError.badRequest(
            `"${negative.description}" satırının birim fiyatı EKSİ (${D(negative.unitPrice).toFixed(2)}) — ` +
              `eksi fiyatlı satır faturaya yazılamaz. Sıfır fiyata izin ayarı yalnız BEDELSİZ (0) kalem içindir; ` +
              `iade/indirim için ayrı bir iade faturası kesin.`,
          );
        }
      } else {
        const zero = lineRows.find((l) => D(l.unitPrice).lte(0));
        if (zero) {
          throw AppError.badRequest(`"${zero.description}" satırının birim fiyatı girilmemiş — fiyatsız fatura onaylanamaz.`);
        }
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

      // ── RİSK LİMİTİ ENGELİ (finance.riskLimitBlockEnabled) ────────────────
      // ⚠️ KİLİT SIRASI LOAD-BEARING (Sınıf 3 — ABBA): guard `cari_balances`
      // satırını FOR UPDATE ile kilitler ve bu, dönem guard'ının advisory
      // kilidinden (8026) SONRA olmak ZORUNDA. `payment.service` sırası
      // "advisory → bakiye satırı"dır; buradaki çağrı `assertPeriodOpenTx`ten
      // ÖNCE yapılsaydı fatura onayı ile tahsilat kaydı kilitleri ters sırada
      // alır ve aynı carinin eşzamanlı iki işlemi deadlock üretirdi.
      await this.assertRiskLimitTx(tx, {
        type: inv.type,
        cariId: inv.cariId,
        currency: inv.currency,
        amount: totals.grandTotal,
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

      // ── İPLİK STOK ÇIKIŞI (finance.yarnOutOnInvoiceEnabled) ───────────────
      // Defter satırlarından SONRA: bir 4xx guard'ına takılacaksa stok
      // hareketi hiç doğmasın (tx geri sarılırdı ama sıralama niyeti de
      // okunabilir olmalı). Kilit sırası: fatura satırı → goods_receipts →
      // advisory 8026 → cari_balances → yarn_stocks; iptal yolu da AYNI sırayı
      // izler (ikisi de fatura satırını en başta claim'ler) → ABBA yok.
      const yarnOut = await this.applyYarnOutOnInvoiceTx(tx, {
        invoiceId: inv.id,
        docNo: inv.docNo,
        type: inv.type,
        userId,
      });

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

      return { id: inv.id, docNo: inv.docNo, yarnOut };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "INVOICE",
      recordId: id,
      newData: {
        event: "INVOICE_CONFIRMED",
        docNo: result.docNo,
        // İz: iplik düşümü BAYRAĞA bağlı bir rejim kararıdır; "bu fatura stoğu
        // düşürdü mü" sorusu altı ay sonra da cevaplanabilmeli.
        ...(result.yarnOut.length > 0
          ? {
              yarnOut: result.yarnOut.map((y) => ({
                itemId: y.itemId,
                warehouseId: y.warehouseId,
                qtyKg: y.qtyKg.toString(),
                balanceAfter: y.balanceKg.toString(),
              })),
            }
          : {}),
      },
    });
    // Bayrak kapalıyken (ya da iplik satırı yokken) `yarnNote` BOŞ STRING'tir →
    // mesaj bugünküyle bayt-bayt aynı kalır.
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} onaylandı ve cari hesaba işlendi.${describeYarnOut(result.yarnOut)}`,
    };
  }

  /**
   * RİSK LİMİTİ — satış faturası ONAYINDA cari açık bakiyeyi kontrol eder.
   *
   * Bugün limit yalnız bir UYARIDIR (`CariAccount.riskLimit` şema notu: "satışı
   * durdurma kararı TİCARİ bir karardır"); bayrak açıkken o karar sistemleşir.
   *
   * ⚠️ KAPSAM (MUAF listesi bayrağın JSDoc'undan birebir):
   *  • Yalnız `SALES`. ALIŞ faturası bizim borcumuzdur — müşterinin risk limiti
   *    onu ilgilendirmez; İADE (SALES_RETURN/PURCHASE_RETURN) ise bakiyeyi
   *    DÜŞÜRÜR, onu limitle engellemek riski azaltan işlemi yasaklamak olurdu.
   *  • TASLAK yolları muaf: guard onaydadır, çünkü deftere yazan adım odur;
   *    taslak hazırlamayı engellemek, muhasebecinin limiti görmesini de
   *    engellerdi.
   *  • İPTAL/storno muaf: limiti aşmış bir faturayı geri alamamak çıkmazdır.
   *  • `riskLimit` NULL → LİMİTSİZ, kontrol hiç koşmaz (kayıt yokluğu "sıfır
   *    limit" DEĞİLDİR; öyle okunsaydı limit girilmemiş her cariye satış
   *    yapılamazdı).
   *
   * ⚠️ TOCTOU: bakiye `increment` ile yazılır, yani düz okumayla yarışa açıktır
   * (iki paralel onay aynı bakiyeyi okur, ikisi de "yeter" der). Bakiye satırı
   * `FOR UPDATE` ile kilitlenerek okunur — `assertCashBalanceCoversTx` ile aynı
   * desen ve aynı gerekçe. Satır YOKSA (carinin o para biriminde ilk hareketi)
   * bakiye 0 kabul edilir; kilitlenecek satır da yoktur.
   *
   * ⚠️ `riskLimit` PARA BİRİMİ TAŞIMAZ (Decimal, kolon başka bir şey demiyor).
   * Karşılaştırma FATURANIN para biriminde yapılır: 1.000 USD'lik fatura,
   * TRY düşünülerek girilmiş 50.000'lik bir limite karşı ölçülür ve ERKEN
   * engeller — yani hata güvenli yöndedir (satışı durdurur, sessizce geçirmez).
   * Limit para birimi kazanacaksa kural burada tek noktada değişir.
   */
  private async assertRiskLimitTx(
    tx: Prisma.TransactionClient,
    ref: { type: InvoiceType; cariId: string; currency: Currency; amount: Prisma.Decimal },
  ): Promise<void> {
    if (ref.type !== InvoiceType.SALES) return;
    // Bayrak ÖNCE okunur: kapalıyken maliyet TEK ayar okumasıdır (cari kartı ve
    // bakiye satırı hiç sorgulanmaz).
    const enabled = await readFinanceRiskLimitBlockEnabled(tx);
    if (!enabled) return;

    const cari = await tx.cariAccount.findUnique({
      where: { id: ref.cariId },
      select: {
        riskLimit: true,
        customer: { select: { name: true } },
        subcontractor: { select: { name: true } },
      },
    });
    if (!cari?.riskLimit) return; // limitsiz cari — kontrol yok

    const rows = await tx.$queryRaw<Array<{ balance: string | number | Prisma.Decimal }>>`
      SELECT balance FROM cari_balances
       WHERE "cariId" = ${ref.cariId}::uuid AND currency = ${ref.currency}::"Currency"
       FOR UPDATE
    `;
    const balance = rows[0] ? D(String(rows[0].balance)) : D0();
    // POZİTİF bakiye = cari BİZE borçlu (`applyCariBalanceTx` sözleşmesi).
    // Risk = mevcut borç + kesilecek faturanın tutarı.
    const exposure = balance.plus(ref.amount);
    const limit = D(cari.riskLimit);
    if (exposure.lte(limit)) return;

    const name = cari.customer?.name ?? cari.subcontractor?.name ?? "Cari";
    throw AppError.conflict(
      `"${name}" risk limiti aşılıyor: limit ${limit.toFixed(2)} ${ref.currency}, ` +
        `mevcut bakiye ${balance.toFixed(2)}, bu fatura ${ref.amount.toFixed(2)} → toplam ${exposure.toFixed(2)}. ` +
        `Risk limiti engeli açık — limiti Cari Kartından güncelleyebilir, tahsilat girip tekrar deneyebilir ` +
        `ya da Ayarlar > Muhasebe > "Risk limiti aşımında satış faturası onayını engelle" ayarını kapatabilirsiniz.`,
    );
  }

  /**
   * İPLİK STOK ÇIKIŞI — satış faturası onayında `YARN` satırlarını düşer.
   *
   * ⚠️ REJİM SORUSU, EK GÜVENCE DEĞİL: stok ya sevkte ya faturada düşer. Sevkten
   * de düşen bir kurulumda bu bayrağı açmak AYNI kg'yi iki kez düşürür
   * (bayrağın JSDoc'undaki "çifte düşüm" uyarısı).
   *
   * ⚠️ DEPO SEÇİMİ YOK — VARSAYILAN depo kullanılır ve bu bilinçlidir: fatura
   * satırı depo TAŞIMAZ (`InvoiceLine`'da kolon yok) ve uydurmak yerine tek,
   * yazılı bir kural seçildi (`resolveTargetWarehouseId` ile aynı felsefe).
   * Çok depolu bir kurulum bu bayrağı açmadan önce ya satıra depo alanı
   * eklemeli ya da stoğu sevk tarafından düşürmeli. Varsayılan depo YOKSA
   * FAIL-CLOSED (400): sessizce "düşmedim" demek, açıkça isteneni yapmamanın
   * en zararlı biçimidir — stok ekranı doğru görünür, gerçek yanlıştır.
   *
   * ⚠️ `itemId` TAŞIMAYAN serbest satır HİÇ etkilenmez (hizmet/nakliye satırı).
   * Kalemin iplik olup olmadığı `Item.itemType`'tan çözülür — satır açıklaması
   * ya da birim METNİNDEN değil (ikisi de serbest metin; "kg" yazan bir kumaş
   * satırı iplik defterine yazılırdı).
   */
  private async applyYarnOutOnInvoiceTx(
    tx: Prisma.TransactionClient,
    ref: { invoiceId: string; docNo: string; type: InvoiceType; userId?: string },
  ): Promise<YarnLedgerEffect[]> {
    if (ref.type !== InvoiceType.SALES) return [];
    const enabled = await readFinanceYarnOutOnInvoiceEnabled(tx);
    if (!enabled) return [];

    const lines = await tx.invoiceLine.findMany({
      where: { invoiceId: ref.invoiceId, itemId: { not: null } },
      select: { itemId: true, qty: true },
    });
    if (lines.length === 0) return [];

    const yarnItems = await tx.item.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.itemId as string))] }, itemType: ItemType.YARN },
      select: { id: true, name: true },
    });
    if (yarnItems.length === 0) return [];
    const yarnById = new Map(yarnItems.map((i) => [i.id, i.name]));

    // Kalem bazında TOPLANIR: aynı ipliğin iki satırı tek harekete iner. Sebep
    // simetri — iptal tarafı NET üzerinden ters kayıt yazar (idempotentlik
    // oradan gelir); çıkışı satır satır yazıp iptali net yazmak, iki tarafın
    // aynı defteri farklı granülerlikte anlatması olurdu.
    const totalsByItem = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const name = yarnById.get(l.itemId as string);
      if (!name) continue;
      const qty = D(l.qty);
      // Miktarı ≤ 0 olan satır stok hareketi doğurmaz: `applyYarnMovementTx`
      // onu zaten 400'ler ve bir "0 adet" satırı yüzünden ONAYI düşürmek
      // orantısız olurdu.
      if (qty.lte(0)) continue;
      totalsByItem.set(l.itemId as string, (totalsByItem.get(l.itemId as string) ?? D0()).plus(qty));
    }
    if (totalsByItem.size === 0) return [];

    const warehouseId = await getDefaultWarehouseId(tx);
    if (!warehouseId) {
      throw AppError.badRequest(
        `${ref.docNo}: iplik satırları stoktan düşülemedi — sistemde VARSAYILAN depo tanımlı değil. ` +
          `Tanımlar > Depolar'dan bir depoyu varsayılan yapın ya da Ayarlar > Muhasebe > ` +
          `"Satış faturası onayında iplik satırlarını stoktan düş" ayarını kapatın.`,
      );
    }

    const applied: YarnLedgerEffect[] = [];
    // ⚠️ SIRALI döngü: `tx.*` ile `Promise.all` YASAK (pg adapter tek bağlantıyı
    // seri çalıştırır; ESLint de yakalar).
    for (const [itemId, qtyKg] of totalsByItem) {
      const res = await applyYarnMovementTx(tx, {
        itemId,
        warehouseId,
        kind: YarnMovementKind.OUT,
        qtyKg,
        // ÇIPA: iptal, düşülen kg'yi bu bağdan bulur (`@@index([invoiceId])`).
        invoiceId: ref.invoiceId,
        reason: `${ref.docNo} satış faturası`,
        userId: ref.userId ?? null,
      });
      applied.push({
        itemId,
        itemName: yarnById.get(itemId) ?? itemId,
        warehouseId,
        qtyKg,
        balanceKg: res.balanceKg,
      });
    }
    return applied;
  }

  /**
   * İPLİK ÇIKIŞININ TERS KAYDI — fatura iptalinde düşülen kg geri yazılır.
   *
   * ⚠️ BAYRAĞA BAKMAZ ve BAKMAMALI: bayrak "bundan sonra düş" der; DÜŞÜLMÜŞ bir
   * kg'nin geri yazılması ise bir VERİ gerçeğidir. Bayrak koşulu konsaydı,
   * düşümden sonra bayrağı kapatan bir kurulumda iptal edilen faturanın malı
   * stokta HİÇ geri gelmezdi (hata yok, log yok, yalnız eksik stok).
   *
   * ⚠️ NET üzerinden tek satır (`reverseGoodsReceiptYarnTx` ile aynı desen ve
   * aynı gerekçe): ikinci çağrıda net 0 çıkar ve hiçbir satır doğmaz — yani
   * işlem idempotenttir. Satır-satır terslemek, kısmi bir hatadan sonra tekrar
   * denendiğinde malı İKİ KEZ geri yazardı.
   *
   * ⚠️ Ters kayıt `ADJUST_IN`'dir, `IN` DEĞİL: mal depoya yeniden GİRMEDİ,
   * hiç çıkmamış sayıldı. `IN` yazmak "bu iplik satın alındı/geldi" raporunu
   * şişirirdi (mal kabul iptalinin `ADJUST_OUT` seçimiyle simetrik).
   */
  private async reverseInvoiceYarnTx(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    reason: string,
    userId?: string,
  ): Promise<YarnLedgerEffect[]> {
    const rows = await tx.yarnMovement.findMany({
      where: { invoiceId },
      select: { itemId: true, warehouseId: true, kind: true, qtyKg: true, item: { select: { name: true } } },
    });
    if (rows.length === 0) return [];

    const nets = new Map<string, { itemId: string; itemName: string; warehouseId: string; net: Prisma.Decimal }>();
    for (const r of rows) {
      const key = `${r.itemId}|${r.warehouseId}`;
      const cur =
        nets.get(key) ?? { itemId: r.itemId, itemName: r.item?.name ?? r.itemId, warehouseId: r.warehouseId, net: D0() };
      cur.net = cur.net.plus(D(r.qtyKg).mul(yarnMovementSign(r.kind)));
      nets.set(key, cur);
    }

    const applied: YarnLedgerEffect[] = [];
    for (const n of nets.values()) {
      if (n.net.isZero()) continue;
      const res = await applyYarnMovementTx(tx, {
        itemId: n.itemId,
        warehouseId: n.warehouseId,
        kind: n.net.gt(0) ? YarnMovementKind.ADJUST_OUT : YarnMovementKind.ADJUST_IN,
        qtyKg: n.net.abs(),
        invoiceId,
        reason,
        userId: userId ?? null,
      });
      applied.push({
        itemId: n.itemId,
        itemName: n.itemName,
        warehouseId: n.warehouseId,
        qtyKg: n.net.abs(),
        balanceKg: res.balanceKg,
      });
    }
    return applied;
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

      // ── İPLİK ÇIKIŞININ TERS KAYDI ────────────────────────────────────────
      // ⚠️ BAYRAKTAN BAĞIMSIZ (gerekçe `reverseInvoiceYarnTx` başlığında):
      // düşülmüş kg'yi geri yazmak bir VERİ gerçeğidir, rejim tercihi değil.
      // Hiç düşülmemişse (bayrak hiç açılmamış / iplik satırı yok) sorgu boş
      // döner ve TEK BAYT yazılmaz — mevcut iptal davranışı korunur.
      const yarnBack = await this.reverseInvoiceYarnTx(
        tx,
        id,
        reason?.trim() || `${inv.docNo} fatura iptali`,
        userId,
      );

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

      return { id: inv.id, docNo: inv.docNo, wasPosted: Boolean(posted), yarnBack };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "INVOICE",
      recordId: id,
      newData: {
        event: "INVOICE_CANCELLED",
        docNo: result.docNo,
        reason,
        storno: result.wasPosted,
        ...(result.yarnBack.length > 0
          ? {
              yarnReversed: result.yarnBack.map((y) => ({
                itemId: y.itemId,
                warehouseId: y.warehouseId,
                qtyKg: y.qtyKg.toString(),
                balanceAfter: y.balanceKg.toString(),
              })),
            }
          : {}),
      },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message:
        (result.wasPosted
          ? `${result.docNo} iptal edildi ve cari hesaptan ters kayıtla geri alındı.`
          : `${result.docNo} taslağı iptal edildi.`) + describeYarnOut(result.yarnBack, "ters kayıtla stoğa geri yazıldı"),
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
    // I4: `include` → `select` (gerekçe DETAIL_SELECT başlığında — clientToken
    // ve çıplak iç FK'ler yanıtta gezmez).
    const row = await prisma.invoice.findUnique({
      where: { id },
      select: DETAIL_SELECT,
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
