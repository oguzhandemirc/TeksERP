// =============================================================================
// TeksERP - Label Service
// =============================================================================
// Etiket payload'unu (effective name cascade ile) inşa eder ve OrderLine
// üzerindeki müşteri-isim override'larını yazar. Asıl baskı tarayıcıda olur;
// burada sadece veri ve audit izi.
//
// Effective name cascade (her okumada):
//   OrderLine.customerItemName  (varsa, 1-shot override)  ←  source: "OVERRIDE"
//     ↓ yoksa
//   CustomerItemAlias.alias     (master, live)            ←  source: "MASTER"
//     ↓ yoksa
//   Item.name                   (default)                 ←  source: "DEFAULT"
//
// Aynı sıra color için. Allocation (Roll→OrderLine) modülü kaldırıldı —
// customer/order alanları şu an sabit null döner. Sevkiyat modülü yeniden
// yazıldığında bu cascade order context'inden beslenecek.
// =============================================================================

import bwipjs from "bwip-js";
import { readLabelCopies, readLabelNativeSendEnabled } from "./system-setting.service";
import { LabelKind, PrinterLanguage, Prisma, RollStatus, type LabelTemplate, type LabelTemplateVariant } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  resolveName,
  normalizeOverride,
  NameSource,
  batchLoadAliases,
  type BatchAliasResult,
} from "./helpers/customer-name.helper";
import { buildRollLabelHtml } from "./helpers/label-html.helper";
import { resolveLabelFormat, loadMachinePrinter, type ResolvedLabelFormat } from "./helpers/label-format.resolver";
import { resolveLabelRouting, findContextDefaultTemplate } from "./helpers/label-routing.resolver";
import { pickVariant } from "./helpers/label-variant.resolver";
import { templateTextLines } from "./helpers/native-label.shared";
import { renderLabel, renderedBytes, shouldRasterize, type LabelRenderInput, type RenderedLabel } from "./helpers/label-renderer.registry";
import { renderCanvasRaster, type RasterLanguage } from "./helpers/raster/raster-render";
import { rasterPreviewHtml } from "./helpers/raster/raster-bmp";
import { readCanvasLayout } from "../config/label-elements";
import { mockPayload } from "./helpers/label-rawcode";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./helpers/native-preview";
import { mmToDots } from "./helpers/native-label.shared";
import { dispatchNativeSend, type PrinterTransportResult } from "./helpers/printer-transport";

const TABLE_ORDER_LINE = "ORDER_LINE";
const TABLE_LABEL_PRINT = "LABEL_PRINT_EVENT";

export type { NameSource };

export interface LabelPayload {
  // Roll core
  rollId: string;
  barcode: string;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  // Tambur'da kartela için işaretlendi mi — true ise etikette mor "KARTELALIK"
  // damgası basılır (kartelaMark alanı template'te açıksa).
  markedForKartela: boolean;

  // Item/Color (effective ↔ default ayrı tutulur, frontend istediğini gösterir)
  itemCode: string;
  itemName: string;             // effective (cascade)
  itemNameDefault: string;       // bizim isim (Item.name)
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;      // effective (cascade) — colorId null ise null
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;

  // Customer/Order — allocation YOKSA HEPSİ NULL (frontend bloğu render etmez)
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  // Batch (parti) + İş Emri
  batchNumber: string | null;
  workOrderNumber?: string | null;
  printedAt: string;

  // --- SWATCH (kartela) için opsiyonel alanlar — roll payload'unda undefined.
  //     Builder'lar yalnız `kind === SWATCH` iken basar; roll çağrıları dokunmaz. ---
  /** Etiket türü ayırt edici — verilmezse roll (ROLL_RAW/ROLL_FINISHED) kabul edilir. */
  kind?: LabelKind;
  /** Kartela kart no (KRT...). */
  cardNumber?: string | null;
  /** Kartela Boy (cm) — roll'da metraj (lengthMeters) kullanılır. */
  lengthCm?: number | null;
  /** Kartelanın doğduğu bitmiş topun barkodu. */
  parentRollBarcode?: string | null;

  // --- SACK (çuval) için opsiyonel alanlar — roll/swatch payload'unda undefined.
  //     Yalnız `kind === SACK` iken doldurulur. Çuvalda ÜRÜN/RENK alanı YOK
  //     (karışık içerik → tek ürün adı sessizce yanlış olur). ---
  /** Çuval kodu (CV+GGAAYY+NNNN) — barkod/QR ile AYNI değer (tek kod kuralı). */
  sackNo?: string | null;
  /** Çuvaldaki (ölü olmayan) top adedi. */
  rollCount?: number | null;
  /** Çuvalın müşteri şubesi. */
  branchName?: string | null;
  /** Çuval yorumu (iç not) — şablona sürüklenmişse basılır, boşsa eleman atlanır. */
  sackNote?: string | null;
}

export interface SwatchLabelPayload {
  swatchId: string;
  cardNumber: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;
  widthCm: number | null;
  lengthCm: number | null;
  weightKg: number | null;
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;
  batchNumber: string | null;
  parentRollBarcode: string | null;
  printedAt: string;
}

export interface UpdateOrderLineCustomerNamesInput {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

/** Baskıda çözülen şablon/varyant izi — audit + tanılama header'ları (fail-open). */
export interface LabelResolutionMeta {
  templateId: string | null;
  templateName: string | null;
  variantId: string | null;
  /** exact = medya boyutu eşleşti; fallback = primary varyant; null = akış/bulk. */
  variantMatch: "exact" | "fallback" | null;
}

/** Top etiketi render opsiyonları — müşteri bağlamı + kopya + format profili/makine. */
export interface RollLabelRenderOpts {
  orderLineId?: string | null;
  customerId?: string | null;
  stock?: boolean;
  /** Saha #6: kopya adedi override (1-5). Verilmezse label.copies ayarı (default 2). */
  copies?: number;
  /** İstasyon makinesi — yazıcı medyası + dil oto çözülür (mobil: req.device.machineId). */
  machineId?: string | null;
  /** Cihaz kaydı (PeripheralDevice) — explicit hedef yazıcı (dil/profil/şablon yönlendirmesi). */
  peripheralId?: string | null;
  /** Tablet Device id (req.device.id) — tablete-bağlı BT yazıcıyı çözmek için. */
  deviceId?: string | null;
  /** Şablon explicit override (cihaz yönlendirmesini ezer). */
  templateId?: string | null;
  /** İstemci raster (binary/base64) baytları KABUL EDİYOR mu (encoding=b64 gönderdi).
   *  false/yok → eski istemci: raster cihazda bile komut üretilir (bozulmaz). */
  rasterCapable?: boolean;
}

/** Rulo/kartela FABRİKA AKIŞI kopya tavanı (1-5) — emit-katmanı clampCopies 100'e
 *  çıktı (Etiket Stüdyosu şablon baskısı); akış uçlarının ?copies= girişi BURADA
 *  kırpılır ki 100'lük tavan top/kartela hattına SIZMASIN (bulk uçlarda Zod max(5)
 *  zaten var — burası tekil ?copies= query yolunun kapısı). */
function clampRollCopies(copies: number): number {
  return Math.max(1, Math.min(5, Math.floor(copies) || 1));
}

/**
 * SwatchLabelPayload → LabelPayload eşlemesi — landscape/native builder'ları
 * (kind=SWATCH) kartela alanlarını (cardNumber/Boy/parentRollBarcode) basabilsin
 * diye. Roll'a özgü alanlar nötr doldurulur (markedForKartela=false, lengthMeters=0,
 * qualityGrade=""). Kartela her zaman 100×60 landscape düzeninde basılır.
 */
function swatchPayloadToLabelPayload(sw: SwatchLabelPayload): LabelPayload {
  return {
    rollId: sw.swatchId,
    barcode: sw.barcode,
    status: "WAREHOUSE",
    qualityGrade: "",
    widthCm: sw.widthCm,
    lengthMeters: 0,
    weightKg: sw.weightKg,
    markedForKartela: false,
    itemCode: sw.itemCode,
    itemName: sw.itemName,
    itemNameDefault: sw.itemNameDefault,
    itemNameSource: sw.itemNameSource,
    colorCode: sw.colorCode,
    colorName: sw.colorName,
    colorNameDefault: sw.colorNameDefault,
    colorNameSource: sw.colorNameSource,
    customerName: sw.customerName,
    customerId: sw.customerId,
    orderNumber: sw.orderNumber,
    orderLineId: sw.orderLineId,
    batchNumber: sw.batchNumber,
    printedAt: sw.printedAt,
    kind: LabelKind.SWATCH,
    cardNumber: sw.cardNumber,
    lengthCm: sw.lengthCm,
    parentRollBarcode: sw.parentRollBarcode,
  };
}

// getRollLabel'in Q1 include ağacı — getBulkRollLabelsHtml prefetch'i ile BİREBİR
// paylaşılır (drift = yanlış etiket riski; tek const → garanti aynı). Tüm Roll
// scalar'ları (colorId, lastLabelSnapshot, barcode...) + item/color + WO parti no
// gelir. NOT: WO orderLinks KASTEN çekilmez — etiket müşterisi artık WO siparişinden
// TAHMİN EDİLMEZ (yalnız explicit baskı bağlamı ya da snapshot). Bkz. getRollLabel'deki
// "EXPLICIT-ONLY" notu.
const ROLL_LABEL_INCLUDE = {
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, code: true, name: true } },
  // Etiketteki parti no (P…) topun PARTİSİNDEN gelir. Eskiden producedInStep.workOrder
  // (İş Emri) "batchNumber"ı taşırdı; parti modelinde parti ayrı nesne (roll.batch).
  batch: {
    select: { batchNumber: true, workOrder: { select: { workOrderNumber: true } } },
  },
} satisfies Prisma.RollInclude;

type RollWithLabelIncludes = Prisma.RollGetPayload<{ include: typeof ROLL_LABEL_INCLUDE }>;

/** Branch ① (orderLineId) lookup'unun select projeksiyonu (getRollLabel:260-267). */
interface OrderLineLabelCtx {
  id: string;
  customerItemName: string | null;
  customerColorName: string | null;
  order: { orderNumber: string; customerId: string; customer: { name: string } };
}

// Toplu etiket basımında (getBulkRollLabelsHtml) TÜM toplar için bir kez çözülen
// bağlam — getRollLabel/buildRollRenderInput'a opsiyonel `preloaded` olarak geçer
// (param yoksa = eski per-roll sorgu yolu, geriye uyumlu). N+1 → O(1).
interface BulkLabelContext {
  rollById: Map<string, RollWithLabelIncludes>;
  orderLineById: Map<string, OrderLineLabelCtx>;
  customerById: Map<string, { id: string; name: string }>;
  aliasByCustomer: Map<string, BatchAliasResult>;
  format: ResolvedLabelFormat;
  templateByKind: Partial<Record<LabelKind, LabelTemplate | null>>;
  /** Kind-başına seçili boyut varyantı (kanvas) — templateByKind ile aynı çözümden. */
  variantByKind: Partial<Record<LabelKind, LabelTemplateVariant | null>>;
  /** `${kind}|${customerId}` → müşteriye özel şablon+varyant (yalnız route'u OLAN
   *  müşteriler; tekil yoldaki CustomerTemplateRoute halkasının batch karşılığı). */
  customerTemplateByKey: Map<string, { template: LabelTemplate; variant: LabelTemplateVariant | null }>;
  copies: number;
  /** Cihaz raster modu (finishedRouting'den) — bulk raster; false → bugünkü komut. */
  rasterMode: boolean;
}

export class LabelService {
  /**
   * Bir rulonun etiket payload'unu döner. Allocation modülü kaldırıldı —
   * customer/order alanları sabit null. Sevkiyat modülü yeniden yazıldığında
   * order context'i parametre olarak alınacak.
   */
  async getRollLabel(
    rollId: string,
    opts?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean },
    // Toplu basım bağlamı (getBulkRollLabelsHtml). Verilirse DB sorguları yerine
    // önceden çekilmiş Map'lerden okunur; verilmezse (tek-top yolu) eski sorgular.
    preloaded?: BulkLabelContext
  ): Promise<ApiResponse<LabelPayload>> {
    const roll =
      preloaded?.rollById.get(rollId) ??
      (await prisma.roll.findUnique({ where: { id: rollId }, include: ROLL_LABEL_INCLUDE }));
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.barcode) {
      throw AppError.badRequest(
        "Bu Roll için etiket basılamaz — açık kumaş Roll'ları (Kurşun/KK2 öncesi) fiziksel etiket almaz."
      );
    }

    // Müşteri context çözümü — EXPLICIT-ONLY (sektör standardı: fiziksel etikete
    // YALNIZ açıkça belirlenmiş müşteri basılır; dolaylı WO→sipariş ilişkisinden
    // TAHMİN edilmez). Müşteri yalnız iki yoldan gelir:
    //   ① opts.orderLineId / opts.customerId  → operatör baskı anında "Kime?" seçti
    //   ② lastLabelSnapshot                   → daha önce ① ile basılıp donmuş bağlam
    // Başka hiçbir durumda müşteri yoktur → STOK (müşterisiz, spec-only etiket).
    // Gerekçe: yanlış müşterili fiziksel etiket = yanlış sevk riski; bilinmiyorsa
    // boş bas. (Kesim-anı baskısı zaten "Kime? boş = stok" ile böyle davranıyordu.)
    let customerId: string | null = null;
    let customerName: string | null = null;
    let orderNumber: string | null = null;
    let orderLineId: string | null = null;
    let itemOverride: string | null = null;
    let colorOverride: string | null = null;
    let itemMasterAlias: string | null = null;
    let colorMasterAlias: string | null = null;

    // Baskı bağlamı çözümü. Çağrı explicit opts verdiyse (Tambur baskı anı veya
    // relabel) onu kullan. Vermediyse (Electron "Etiket" butonu / mobil görüntüleme)
    // topun ÜSTÜNDEKİ son basılan etiketi (lastLabelSnapshot) yansıt. Snapshot da
    // yoksa STOK bas — WO siparişinden müşteri TAHMİN ETME.
    const snap = (roll.lastLabelSnapshot ?? null) as Record<string, unknown> | null;
    // Explicit "Stok" baskı (opts.stock): müşteriyi ZORLA null bırak — snapshot'ı
    // VE WO tek-müşteri tahminini ATLA. Operatör "Stok" dediyse topun üstündeki
    // eski müşteri etiketi tekrar basılmamalı; müşterisiz spec-only etiket çıkar.
    const forceStock = opts?.stock === true;
    const hasExplicit = forceStock || !!(opts?.orderLineId || opts?.customerId);
    let effOrderLineId: string | null = forceStock ? null : (opts?.orderLineId ?? null);
    let effCustomerId: string | null = forceStock ? null : (opts?.customerId ?? null);
    if (!hasExplicit && snap) {
      // Snapshot'tan SON explicit bağlamı yansıt. Snapshot var ama müşterisiz
      // ("stok" baskı) → effOrderLineId/effCustomerId null kalır → aşağıda STOK basılır.
      if (typeof snap.orderLineId === "string") {
        effOrderLineId = snap.orderLineId;
      } else if (typeof snap.customerId === "string") {
        effCustomerId = snap.customerId;
      }
    }

    if (effOrderLineId) {
      // ① Baskı bağlamı: sipariş kalemi (tambur kesim / relabel / snapshot). Bu bir
      // BAĞ DEĞİL — yalnız bu baskının müşteri/sipariş bağlamı (gevşek model: top fungible).
      const tgt =
        preloaded?.orderLineById.get(effOrderLineId) ??
        (await prisma.orderLine.findUnique({
          where: { id: effOrderLineId },
          select: {
            id: true,
            customerItemName: true,
            customerColorName: true,
            order: {
              select: { orderNumber: true, customerId: true, customer: { select: { name: true } } },
            },
          },
        }));
      if (tgt) {
        customerId = tgt.order.customerId;
        customerName = tgt.order.customer.name;
        orderNumber = tgt.order.orderNumber;
        orderLineId = tgt.id;
        itemOverride = tgt.customerItemName;
        colorOverride = tgt.customerColorName;
      }
    } else if (effCustomerId) {
      // ① Manuel/snapshot müşteri (WO dışı) — sipariş yok; isimler master alias'tan türetilir.
      const cust =
        preloaded?.customerById.get(effCustomerId) ??
        (await prisma.customer.findUnique({
          where: { id: effCustomerId },
          select: { id: true, name: true },
        }));
      if (cust) {
        customerId = cust.id;
        customerName = cust.name;
      }
    } else {
      // STOK (müşterisiz): ne explicit baskı bağlamı ne de snapshot müşterisi var.
      // WO siparişinden tek-müşteri TAHMİNİ KASTEN YAPILMAZ — eski "geri uyum"
      // davranışı kaldırıldı. Gevşek modelde (top→sipariş bağı yok) bir topun hangi
      // müşteriye etiketleneceği baskı-anı kararıdır; yanlış müşteri basmak (yanlış
      // sevk riski) müşterisiz basmaktan kötüdür. Kesim-anı baskısı zaten "Kime?
      // boş = stok" ile müşterisiz davranıyordu — reprint/önizleme/Electron artık
      // onunla TUTARLI. Müşteri istenen top için operatör "Kime?"den açıkça seçer.
      customerId = null;
      customerName = null;
    }

    // Master alias'lar — customer × item / customer × color (yoksa null).
    // preloaded'da batchLoadAliases sonucu Map'ten okunur (aynı sonuç: itemAlias
    // yoksa undefined→null; colorAlias null/yok → batchLoadAliases zaten düşürür).
    if (customerId) {
      if (preloaded) {
        const alias = preloaded.aliasByCustomer.get(customerId);
        itemMasterAlias = alias?.itemAliasByItemId.get(roll.item.id) ?? null;
        if (roll.color) {
          colorMasterAlias = alias?.colorAliasByColorId.get(roll.color.id) ?? null;
        }
      } else {
        const itemAlias = await prisma.customerItemAlias.findUnique({
          where: {
            customerId_itemId: { customerId, itemId: roll.item.id },
          },
          select: { alias: true },
        });
        itemMasterAlias = itemAlias?.alias ?? null;

        if (roll.color) {
          const colorAlias = await prisma.customerColorAlias.findUnique({
            where: {
              customerId_colorId: { customerId, colorId: roll.color.id },
            },
            select: { alias: true },
          });
          colorMasterAlias = colorAlias?.alias ?? null;
        }
      }
    }

    const itemNameResolved = resolveName(
      itemOverride,
      itemMasterAlias,
      roll.item.name,
    );

    let colorName: string | null = null;
    let colorNameDefault: string | null = null;
    let colorNameSource: NameSource | null = null;
    if (roll.color) {
      colorNameDefault = roll.color.name;
      const r = resolveName(colorOverride, colorMasterAlias, roll.color.name);
      colorName = r.name;
      colorNameSource = r.source;
    }

    const payload: LabelPayload = {
      rollId: roll.id,
      barcode: roll.barcode,
      status: roll.status,
      qualityGrade: roll.qualityGrade ?? "",
      widthCm: roll.width !== null ? Number(roll.width) : null,
      lengthMeters: Number(roll.currentQty),
      weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
      markedForKartela: roll.markedForKartela,

      itemCode: roll.item.code,
      itemName: itemNameResolved.name,
      itemNameDefault: roll.item.name,
      itemNameSource: itemNameResolved.source,

      colorCode: roll.color?.code ?? null,
      colorName,
      colorNameDefault,
      colorNameSource,

      customerName,
      customerId,
      orderNumber,
      orderLineId,

      batchNumber: roll.batch?.batchNumber ?? null,
      workOrderNumber: roll.batch?.workOrder?.workOrderNumber ?? null,
      printedAt: new Date().toISOString(),
    };

    return { success: true, data: payload };
  }

  /**
   * Şablon düzenleme önizlemesi — Electron LabelPreview iframe'i bu HTML'i
   * gösterir. Henüz kaydedilmemiş template field değişikliklerini önizlemek
   * için kullanılır; gerçek bir Roll seçmeden mock payload ile çalışır.
   * Hem KK1 hem Tambur etiketlerinin tam yelpazesi için aynı mock dolu.
   */
  async getPreviewHtml(input: {
    kind: LabelKind;
    fields: Array<{
      key: string;
      label: string;
      order: number;
      isVisible: boolean;
      isBold?: boolean;
      fontSize?: "sm" | "md" | "lg" | "xl";
    }>;
  }): Promise<ApiResponse<{ html: string }>> {
    // Mock'ta customer alias farklı tutuluyor — admin "Müşterideki ad" ile
    // "Bizdeki ad" alanlarının ayrı işlediğini önizlemede net görsün.
    const mockPayload: LabelPayload = {
      rollId: "preview",
      barcode: "T120726H0001",
      status: "STOCK",
      qualityGrade: "1. Kalite",
      widthCm: 152,
      lengthMeters: 47.5,
      weightKg: 14.8,
      // Önizlemede kartela damgası görünsün — admin kartelaMark alanını
      // açıp kapatınca etkisini canlı görür.
      markedForKartela: true,
      itemCode: "PA-60S",
      itemName: "Cotton Lining 60s",      // müşterideki ad
      itemNameDefault: "Pamuk Astar 60s",  // bizdeki ad
      itemNameSource: "OVERRIDE" as NameSource,
      colorCode: "BJ",
      colorName: "Beige",                  // müşterideki ad
      colorNameDefault: "Bej",             // bizdeki ad
      colorNameSource: "OVERRIDE" as NameSource,
      customerName: "Demo Tekstil A.Ş.",
      customerId: "preview",
      orderNumber: "SIP1207260001",
      orderLineId: "preview",
      batchNumber: "P1207260001",
      printedAt: new Date().toISOString(),
      // SWATCH önizlemesinde kartela alanları görünsün (roll düzeninde yok sayılır).
      kind: input.kind,
      cardNumber: "KRT1207260001",
      lengthCm: 30,
      parentRollBarcode: "T120726H0001",
    };
    const mockTemplate = {
      id: "preview",
      name: "preview",
      kind: input.kind,
      isDefault: false,
      isActive: true,
      fields: input.fields,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Parameters<typeof buildRollLabelHtml>[0]["template"];

    const barcodeSvg = bwipjs.toSVG({
      bcid: "code128",
      text: mockPayload.barcode,
      scale: 3,
      height: 10,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });
    const qrSvg = bwipjs.toSVG({
      bcid: "qrcode",
      text: mockPayload.barcode,
      scale: 3,
      backgroundcolor: "FFFFFF",
    });

    // Önizleme sistem-default formatını (reseed sonrası 100×60 yatay) kullanır —
    // editör yeni boyutu/düzeni canlı göstersin (yoksa kod fallback 100×148 dikey).
    const format = await resolveLabelFormat({});
    const html = buildRollLabelHtml({
      payload: mockPayload,
      template: mockTemplate,
      barcodeSvg,
      qrSvg,
      format,
    });
    return { success: true, data: { html } };
  }

  /**
   * Editör native (PPLA/ZPL) metin-zone önizlemesi — şablona göre sıralı satırlar
   * + boyut/bold. HTML önizlemesinin native karşılığı; admin alanı kapatıp sıralayınca
   * termal yazıcı çıktısının yaklaşık halini görür. (Sol QR+barkod tarama kolonu hariç.)
   */
  async getPreviewNativeText(input: {
    kind: LabelKind;
    fields: Array<{ key: string; label: string; order: number; isVisible: boolean; isBold?: boolean; fontSize?: "sm" | "md" | "lg" | "xl" }>;
  }): Promise<ApiResponse<{ lines: Array<{ text: string; size: string; bold: boolean }> }>> {
    const payload: LabelPayload = {
      rollId: "preview",
      barcode: "T120726H0001",
      status: "STOCK",
      qualityGrade: "1. Kalite",
      widthCm: 152,
      lengthMeters: 47.5,
      weightKg: 14.8,
      markedForKartela: true,
      itemCode: "PA-60S",
      itemName: "Cotton Lining 60s",
      itemNameDefault: "Pamuk Astar 60s",
      itemNameSource: "OVERRIDE" as NameSource,
      colorCode: "BJ",
      colorName: "Beige",
      colorNameDefault: "Bej",
      colorNameSource: "OVERRIDE" as NameSource,
      customerName: "Demo Tekstil A.S.",
      customerId: "preview",
      orderNumber: "SIP1207260001",
      orderLineId: "preview",
      batchNumber: "P1207260001",
      printedAt: new Date().toISOString(),
      kind: input.kind,
      cardNumber: "KRT1207260001",
      lengthCm: 30,
      parentRollBarcode: "T120726H0001",
    };
    const template = {
      id: "preview",
      name: "preview",
      kind: input.kind,
      isDefault: false,
      isActive: true,
      fields: input.fields,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Parameters<typeof templateTextLines>[1];
    const lines = templateTextLines(payload, template);
    return { success: true, data: { lines } };
  }

  /**
   * Rolün etiket HTML'i — tek doğru kaynak. Hem mobil (expo-print) hem Electron
   * (LabelPreview iframe) bu HTML'i tüketir. Kind otomatik tespit edilir:
   * RENKSİZ (colorId == null) = ham kumaş → ROLL_RAW, aksi halde ROLL_FINISHED.
   * Renk = boyanmış = bitmiş; renksiz top hangi statüde olursa olsun (tedarikçi
   * ham stoğu, tambur'da kesilen ham parça, ham talep eden müşteriye giden
   * ham-bitmiş depo topu) ham etiketle basılır. Caller `?kind=` ile override eder.
   */
  /**
   * Ortak render girdisi — payload + kind (ROLL_RAW/FINISHED) + default template +
   * barkod/QR SVG + kopya + format profili. Tüm diller (html/ppla/pplb/zpl) paylaşır.
   */
  private async buildRollRenderInput(
    rollId: string,
    kindOverride: LabelKind | undefined,
    opts?: RollLabelRenderOpts,
    preloaded?: BulkLabelContext,
  ): Promise<{
    input: LabelRenderInput;
    kind: LabelKind;
    meta: LabelResolutionMeta;
    // F179: çözülen yönlendirme cihazının native gönderim hedefi (preloaded/bulk'ta null).
    routing: { peripheralId: string | null; address: string | null; port: number | null } | null;
  }> {
    const payloadResp = await this.getRollLabel(rollId, opts, preloaded);
    const payload = payloadResp.data;

    // colorId: preloaded'da Aşama-A roll'unda zaten var → ikinci sorgu YOK.
    // (preloaded'da roll eksikse — beklenmez — güvenli tarafta sorguya düş.)
    let colorId: string | null;
    const preRoll = preloaded?.rollById.get(rollId);
    if (preRoll) {
      colorId = preRoll.colorId;
    } else {
      const r = await prisma.roll.findUnique({
        where: { id: rollId },
        select: { colorId: true },
      });
      if (!r) throw AppError.notFound("Top bulunamadı");
      colorId = r.colorId;
    }

    const kind: LabelKind =
      kindOverride ?? (colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED);

    // Bulk → preloaded SABİT template+format (Electron toplu baskı; cihaz bağlamı yok).
    // Tekil → birleşik yönlendirme: cihaz→{format, template, dil}. Cihaz eşleşmezse
    // bugünkü davranış (resolveLabelFormat + kind default şablon) — geri uyum.
    let template: LabelTemplate | null;
    let variant: LabelTemplateVariant | null;
    let format: ResolvedLabelFormat;
    let variantMatch: "exact" | "fallback" | null = null;
    // Cihaz raster modu — routing'den (tekil) / bulk bağlamından. false → komut yolu.
    let rasterMode = false;
    // F179: native hedef adresi yalnız tekil (non-preloaded) yönlendirmede çözülür.
    let routingPeripheral: { peripheralId: string | null; address: string | null; port: number | null } | null = null;
    if (preloaded) {
      // Müşteri-şablon halkasının bulk karşılığı: route'u olan müşterinin topu
      // kendi şablonuyla basılır (tekil yolla AYNI öncelik: müşteri > cihaz > default).
      const custom = payload.customerId
        ? preloaded.customerTemplateByKey.get(`${kind}|${payload.customerId}`)
        : undefined;
      template = custom?.template ?? preloaded.templateByKind[kind] ?? null;
      variant = custom ? custom.variant : preloaded.variantByKind[kind] ?? null;
      format = preloaded.format;
      rasterMode = preloaded.rasterMode;
    } else {
      const routing = await resolveLabelRouting({
        kind,
        peripheralId: opts?.peripheralId,
        templateId: opts?.templateId,
        machineId: opts?.machineId,
        deviceId: opts?.deviceId,
        // Müşteri şablonu halkası — payload ÖNCE çözüldü (explicit-only):
        // stok/müşterisiz baskıda null → halka hiç sorgulanmaz.
        customerId: payload.customerId ?? null,
      });
      template = routing.template;
      variant = routing.variant;
      format = routing.format;
      variantMatch = routing.variantMatch;
      rasterMode = routing.rasterMode;
      routingPeripheral = {
        peripheralId: routing.peripheralId,
        address: routing.peripheralAddress,
        port: routing.peripheralPort,
      };
    }
    const barcodeSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" })
      : "";
    const qrSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" })
      : "";
    // Saha #6: kopya adedi — istek override > bulk-sabit > ayar (default 2).
    // Akış tavanı 1-5 (clampRollCopies) — emit clampCopies artık 100 (stüdyo).
    const copies = clampRollCopies(opts?.copies ?? preloaded?.copies ?? (await readLabelCopies()));
    const meta: LabelResolutionMeta = {
      templateId: template?.id ?? null,
      templateName: template?.name ?? null,
      variantId: variant?.id ?? null,
      variantMatch,
    };
    return { input: { payload, template, variant, barcodeSvg, qrSvg, copies, format, rasterMode }, kind, meta, routing: routingPeripheral };
  }

  async getRollLabelHtml(
    rollId: string,
    kindOverride?: LabelKind,
    opts?: RollLabelRenderOpts,
    preloaded?: BulkLabelContext,
  ): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const { input, kind } = await this.buildRollRenderInput(rollId, kindOverride, opts, preloaded);
    const html = (await renderLabel(PrinterLanguage.RASTER_HTML, input)).content;
    return { success: true, data: { html, kind } };
  }

  /**
   * Rolün Argox PPLA native komut string'i (explicit). Faz-1: yalnız ÜRETİLİR
   * (saf string); ham gönderim `printer-transport` ile SİMÜLE (Faz-2). Dilden
   * bağımsız PPLA verir — incelemeye yönelik. Seçili dil için `getRollLabelNative`.
   */
  async getRollLabelPpla(
    rollId: string,
    kindOverride?: LabelKind,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ ppla: string }>> {
    const { input } = await this.buildRollRenderInput(rollId, kindOverride, opts);
    // İnceleme ucu: HER ZAMAN komut (raster cihazda bile) — dilden-bağımsız PPLA metni.
    const ppla = (await renderLabel(PrinterLanguage.PPLA, { ...input, rasterMode: false })).content;
    return { success: true, data: { ppla } };
  }

  /**
   * Rolün etiketini SEÇİLİ dilde render eder — cihaz kaydındaki dil (cihazsız → RASTER_HTML)
   * (default PPLA) veya istasyon yazıcı modelinin dili (resolver çözer). RASTER_HTML
   * → HTML; PPLA/PPLB/ZPL → native komut. Faz-1: üretim gerçek, ham gönderim simüle.
   */
  async getRollLabelNative(
    rollId: string,
    kindOverride?: LabelKind,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ content: string; contentB64: string; encoding: "text" | "binary"; language: PrinterLanguage; contentType: string; kind: LabelKind; meta: LabelResolutionMeta }>> {
    const { input, kind, meta } = await this.buildRollRenderInput(rollId, kindOverride, opts);
    // rasterCapable değilse (eski istemci) raster'ı bastır → komut üret (bozulmaz).
    // rasterCapable (b64) → binary-güvenli → ikon GW emit edilir (iconGraphicsOk); değilse
    // ham text yolu → ikon atlanır (UTF-8 GW binary'sini bozardı), komut temiz ASCII kalır.
    const r = await renderLabel(
      input.format.language,
      opts?.rasterCapable ? { ...input, iconGraphicsOk: true } : { ...input, rasterMode: false },
    );
    return {
      success: true,
      data: {
        content: r.content,
        contentB64: renderedBytes(r).toString("base64"),
        encoding: r.encoding,
        language: r.language,
        contentType: r.contentType,
        kind,
        meta,
      },
    };
  }

  /**
   * WYSIWYG önizleme — gerçek topu AKTİF DİLDE render eder. Native dil için komutları
   * görsele çevirir (mode="svg", baskıyla birebir); HTML dili → html; çizilemeyen native
   * → ham komut (mode="text"). Baskı diyalogları (RollLabelDialog/Relabel/toplu) bunu iframe'ler.
   */
  async getRollPreview(
    rollId: string,
    kindOverride?: LabelKind,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ mode: "svg" | "html" | "text"; language: PrinterLanguage; content: string; kind: LabelKind; meta: LabelResolutionMeta }>> {
    const { input, kind, meta } = await this.buildRollRenderInput(rollId, kindOverride, opts);
    const language = input.format.language;
    if (language === PrinterLanguage.RASTER_HTML) {
      return { success: true, data: { mode: "html", language, content: (await renderLabel(language, input)).content, kind, meta } };
    }
    // RASTER cihaz + kanvas varyantı → önizleme AYNI 1bpp bitmap (BMP data-URI) →
    // önizleme=baskı tanım gereği. Envelope patlarsa (PPLA F0 / font eksik) komut
    // SVG ters-parser'ına düşer (dual-mode; baskıyla tutarlı — o da komuta düşer).
    if (shouldRasterize(language, input)) {
      const layout = readCanvasLayout(input.variant?.elements);
      if (layout) {
        try {
          const { bitmap } = await renderCanvasRaster(language as RasterLanguage, {
            payload: input.payload, format: input.format, copies: 1, layout,
          });
          return {
            success: true,
            data: { mode: "html", language, content: rasterPreviewHtml(bitmap, input.format.widthMm, input.format.heightMm), kind, meta },
          };
        } catch { /* raster envelope başarısız → aşağıdaki komut SVG'sine düş */ }
      }
    }
    // Önizleme in-process SVG'ye parse edilir (printer'a ham text gitmez) → ikon GW
    // güvenle emit edilir; PPLB parser'ı GW header'ından ayak-izi placeholder çizer.
    const native = (await renderLabel(language, { ...input, iconGraphicsOk: true })).content;
    const svg = renderNativePreviewSvg(
      language,
      native,
      mmToDots(input.format.widthMm, input.format.dpi),
      mmToDots(input.format.heightMm, input.format.dpi),
    );
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg), kind, meta } };
    return { success: true, data: { mode: "text", language, content: native, kind, meta } };
  }

  /** HTML dilinde doğrudan gönderim yok (OS sürücü); aksi halde transport'a delege. */
  private async dispatchOrGuard(
    rendered: RenderedLabel,
    opts: { enabled: boolean; printerIp?: string | null; port?: number },
  ): Promise<PrinterTransportResult> {
    if (rendered.language === PrinterLanguage.RASTER_HTML) {
      return {
        delivered: false,
        simulated: !opts.enabled,
        language: rendered.language,
        bytes: Buffer.byteLength(rendered.content, "utf8"),
        target: opts.printerIp ? `${opts.printerIp}:${opts.port ?? 9100}` : "—",
        note: "HTML dilinde doğrudan gönderim yok — OS yazıcı sürücüsü kullanılır.",
      };
    }
    // Raster → ham bitmap zarfı baytları; komut → latin1 string (renderedBytes tek geçit).
    return dispatchNativeSend(renderedBytes(rendered), {
      language: rendered.language,
      enabled: opts.enabled,
      printerIp: opts.printerIp,
      port: opts.port,
    });
  }

  /**
   * FAZ-2 PRODUCTION: rolün etiketini seçili native dilde üretip İSTASYONUN yazıcısına
   * RAW TCP (9100) ile gönderir — `label.nativeSendEnabled` AÇIKKEN. Kapalıyken simüle
   * eder (Faz-1, hiç socket yok). Hedef IP istasyonun makineye-bağlı yazıcı cihazından
   * (PeripheralDevice.address) — MachineHardware emekliye ayrıldı.
   */
  async printRollNative(
    rollId: string,
    userId?: string,
    opts?: RollLabelRenderOpts & { port?: number },
  ): Promise<ApiResponse<PrinterTransportResult & { kind: LabelKind }>> {
    const { input, kind, routing } = await this.buildRollRenderInput(rollId, undefined, opts);
    // RAW TCP (9100) → renderedBytes bayt gönderir (binary-güvenli) → ikon GW emit edilir.
    const rendered = await renderLabel(input.format.language, { ...input, iconGraphicsOk: true });
    const enabled = await readLabelNativeSendEnabled();
    // F179: çözülen yönlendirme cihazının (explicit peripheralId / tablet deviceId /
    // machineId hepsi routing'de çözüldü) adresi BİRİNCİL hedef; loadMachinePrinter
    // yalnız defansif fallback (routing adres vermezse).
    let printerIp: string | null = routing?.address ?? null;
    let printerPort: number | undefined = opts?.port ?? routing?.port ?? undefined;
    if (printerIp == null && opts?.machineId) {
      const printer = await loadMachinePrinter(opts.machineId);
      printerIp = printer?.address ?? null;
      if (printerPort == null && printer?.port != null) printerPort = printer.port;
    }
    const result = await this.dispatchOrGuard(rendered, { enabled, printerIp, port: printerPort });
    // İz (best-effort, tx dışı).
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "LABEL_NATIVE_PRINT",
      recordId: rollId,
      newData: {
        language: result.language,
        delivered: result.delivered,
        simulated: result.simulated,
        target: result.target,
        ...(result.error ? { error: result.error } : {}),
      },
    }).catch(() => undefined);
    return { success: true, data: { ...result, kind } };
  }

  /**
   * Test Et: seçili yazıcının medyasında ÖRNEK etiket HTML'i — boyut/pay görsel
   * doğrulaması (Faz-1, her zaman güvenli). Gerçek top gerekmez; mock veri.
   * peripheralId verilmezse sistem varsayılan medyası kullanılır.
   */
  async getSampleLabelHtml(peripheralId?: string | null): Promise<ApiResponse<{ html: string }>> {
    const input = await this.buildSampleRenderInput(peripheralId);
    const html = (await renderLabel(PrinterLanguage.RASTER_HTML, input)).content;
    return { success: true, data: { html } };
  }

  /**
   * Test Et: ÖRNEK etiketi seçili dilde üretip verilen yazıcı IP'sine gönderir.
   * `label.nativeSendEnabled` açıkken gerçek gönderir, kapalıyken simüle — admin'in
   * gerçek yazıcıyı (Faz-2) doğrulama aracı.
   */
  async testNativeSend(opts: {
    peripheralId?: string | null;
    printerIp: string;
    port?: number;
    language?: PrinterLanguage;
  }): Promise<ApiResponse<PrinterTransportResult>> {
    const input = await this.buildSampleRenderInput(opts.peripheralId);
    const lang = opts.language ?? input.format.language;
    const rendered = await renderLabel(lang, { ...input, iconGraphicsOk: true }); // RAW TCP bayt → binary-güvenli
    const enabled = await readLabelNativeSendEnabled();
    const result = await this.dispatchOrGuard(rendered, {
      enabled,
      printerIp: opts.printerIp,
      port: opts.port,
    });
    return { success: true, data: result };
  }

  /** Örnek (mock) top etiketi render girdisi — Test Et için. peripheralId medyayı (geometri) belirler. */
  private async buildSampleRenderInput(peripheralId?: string | null): Promise<LabelRenderInput> {
    const sampleBarcode = "T120726F0001";
    const payload: LabelPayload = {
      rollId: "ornek-id",
      barcode: sampleBarcode,
      status: "WAREHOUSE",
      qualityGrade: "1.KALITE",
      widthCm: 150,
      lengthMeters: 320,
      weightKg: 42,
      markedForKartela: false,
      itemCode: "ORNEK",
      itemName: "ÖRNEK ÜRÜN",
      itemNameDefault: "ÖRNEK ÜRÜN",
      itemNameSource: "DEFAULT",
      colorCode: "MV",
      colorName: "MAVİ",
      colorNameDefault: "MAVİ",
      colorNameSource: "DEFAULT",
      customerName: "ÖRNEK MÜŞTERİ",
      customerId: null,
      orderNumber: "SIP1207260001",
      orderLineId: null,
      batchNumber: "P1207260001",
      printedAt: new Date().toISOString(),
    };
    const template = await findContextDefaultTemplate(LabelKind.ROLL_FINISHED);
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: sampleBarcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: sampleBarcode, scale: 3, backgroundcolor: "FFFFFF" });
    // Örnek baskı: peripheralId verilirse o cihazın medyası, yoksa sistem varsayılan medyası.
    const format = await resolveLabelFormat({ peripheralId });
    // Örnek baskı = gerçek baskı: şablonun medyaya uyan varyantı da seçilir (WYSIWYG).
    const { variant } = pickVariant(template?.variants, { widthMm: format.widthMm, heightMm: format.heightMm });
    return { payload, template, variant, barcodeSvg, qrSvg, copies: 1, format };
  }

  /**
   * Saha #7: TOPLU etiket — bir sevkiyatın (veya seçili çuvalların) tüm toplarının
   * etiketlerini TEK belgede birleştirir (her etiket kendi A6 sayfası). Tek baskıda
   * yüzlerce top etiketi çıkarmak için. İlk etiketin <head>/<style>'ı paylaşılır;
   * sonraki etiketlerin yalnız <body> içeriği eklenir.
   */
  async getBulkRollLabelsHtml(
    rollIds: string[],
    /** `customerId`: TÜM topları bu müşteri bağlamıyla bas (çuval müşterisi değişti
     *  → yeni müşterinin şablonu/alias'ı). Verilmezse her top kendi snapshot'ıyla. */
    opts?: { copies?: number; peripheralId?: string; deviceId?: string; customerId?: string | null },
  ): Promise<ApiResponse<{ html: string; count: number }>> {
    const ids = [...new Set(rollIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir top seçilmeli");
    const copies = clampRollCopies(opts?.copies ?? (await readLabelCopies()));

    // N+1 → O(1): format/template/copies'i bir kez çöz + tüm top + ilişki verisini
    // toplu prefetch et. Render (aşağıdaki döngü) DEĞİŞMEDEN preloaded bağlamı kullanır;
    // çıktı per-roll yolla BYTE-IDENTİK (bkz. test_bulk_label_batched.ts).
    // F183: cihaz bağlamı (peripheralId/deviceId) native handler ile parite — iş
    // istasyonunun kendi yazıcı dilinde/şablonunda toplu bassın.
    const ctx = await this.buildBulkContext(
      ids,
      copies,
      { peripheralId: opts?.peripheralId, deviceId: opts?.deviceId },
      opts?.customerId ?? null,
    );

    const bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/i;
    let head = "";
    const bodies: string[] = [];
    // F178: her top buildRollRenderInput içinde bwipjs.toSVG'yi (Code128+QR) 2 SENKRON
    // çağırır → çok sayıda topta event-loop starvation (istasyon donması). ~25 topta bir
    // setImmediate ile check fazına dön → LAN'daki diğer operatörlerin bekleyen soketleri servis edilir.
    let yielded = 0;
    for (const id of ids) {
      const res = await this.getRollLabelHtml(id, undefined, { copies, customerId: opts?.customerId ?? undefined }, ctx);
      const full = res.data.html;
      if (!head) {
        // İlk belgenin <head> dahil <body ...> açılışına kadarki kısmı.
        const openIdx = full.search(/<body[^>]*>/i);
        head = openIdx >= 0 ? full.slice(0, full.match(/<body[^>]*>/i)![0].length + openIdx) : "";
      }
      const m = full.match(bodyRe);
      if (m) bodies.push(m[1]);
      if (++yielded % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    // Her topu kendi sayfasında tut (etiket .label zaten A6; topu ayır).
    const combinedBody = bodies
      .map((b, i) => (i === 0 ? b : `<div style="page-break-before: always;">${b}</div>`))
      .join("\n");
    const html = head
      ? `${head}\n${combinedBody}\n</body></html>`
      : `<!doctype html><html><head><meta charset="utf-8"></head><body>${combinedBody}</body></html>`;
    return { success: true, data: { html, count: bodies.length } };
  }

  /**
   * TOPLU NATIVE — N FARKLI topun native (PPLA/ZPL) bloklarını TEK komut akışına
   * birleştirir (her blok kendi Q<kopya> + bitiş komutuyla). Diyalogsuz tek seri/COM
   * (Electron) veya BT (mobil) gönderiminde N etiket basılır → per-top ayrı bağlantı
   * yok. `buildBulkContext` ile N+1→O(1); render per-roll yolla byte-identik. Tüm
   * toplar bulk format dilinde — RASTER_HTML ise istemci reddeder (native değil).
   */
  async getBulkRollLabelsNative(
    rollIds: string[],
    /** `customerId`: TÜM topları bu müşteri bağlamıyla bas (bkz. getBulkRollLabelsHtml). */
    opts?: { copies?: number; peripheralId?: string; deviceId?: string; rasterCapable?: boolean; customerId?: string | null },
  ): Promise<ApiResponse<{ content: string; contentB64: string; encoding: "text" | "binary"; language: PrinterLanguage; contentType: string; count: number }>> {
    const ids = [...new Set(rollIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir top seçilmeli");
    const copies = clampRollCopies(opts?.copies ?? (await readLabelCopies()));
    const ctx = await this.buildBulkContext(
      ids,
      copies,
      { peripheralId: opts?.peripheralId, deviceId: opts?.deviceId },
      opts?.customerId ?? null,
    );
    const language = ctx.format.language;
    let contentType = "text/plain; charset=utf-8";
    const textBlocks: string[] = [];
    const buffers: Buffer[] = [];
    let anyBinary = false;
    // F178: getBulkRollLabelsHtml ile aynı — ~25 topta bir event-loop'a nefes aldır.
    let yieldedN = 0;
    for (const id of ids) {
      const { input } = await this.buildRollRenderInput(
        id,
        undefined,
        { copies, customerId: opts?.customerId ?? undefined },
        ctx,
      );
      // rasterCapable değilse komut zorla (eski istemci binary alamaz). rasterCapable (b64)
      // → binary-güvenli → ikon GW emit; değilse ham text → ikon atlanır (temiz ASCII).
      const r = await renderLabel(
        language,
        opts?.rasterCapable ? { ...input, iconGraphicsOk: true } : { ...input, rasterMode: false },
      );
      contentType = r.contentType;
      // Her blok kendi zarfını taşır (N/GW…/P veya ^XA…^XZ) → karışık raster/komut concat güvenli.
      buffers.push(renderedBytes(r));
      if (r.encoding === "binary") anyBinary = true;
      else if (r.content) textBlocks.push(r.content);
      if (++yieldedN % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return {
      success: true,
      data: {
        content: textBlocks.join(""),
        contentB64: Buffer.concat(buffers).toString("base64"),
        encoding: anyBinary ? "binary" : "text",
        language,
        contentType: anyBinary ? "application/octet-stream" : contentType,
        count: buffers.length,
      },
    };
  }

  /**
   * Toplu etiket basımı için bir kez çözülen bağlam (N+1 → O(1)). Sabitler (format,
   * kind-başına template, copies) + toplu top/orderLine/customer/alias verisi. Müşteri
   * çözümü için getRollLabel'in KENDİSİ (branch ①②③④ tek-doğru-kaynak) kullanılır —
   * dal mantığı KOPYALANMAZ (drift = yanlış etiket riski).
   */
  /**
   * @param overrideCustomerId Verilirse TÜM toplar bu müşteri bağlamıyla basılır
   *   (çuval müşterisi değişince "yeni müşteri için hepsini bas"). Bu müşteri
   *   `byCustomer`'a ZORLA tohumlanır — aksi halde alias/rota haritalarında
   *   bulunmaz ve baskı SESSİZCE varsayılan şablona düşer (fiziksel yanlış etiket,
   *   üstelik labelDirty temizlendiği için uyarı da kaybolur).
   */
  private async buildBulkContext(
    ids: string[],
    copies: number,
    routing?: { peripheralId?: string; deviceId?: string },
    overrideCustomerId?: string | null,
  ): Promise<BulkLabelContext> {
    // §1 Sabitler — seri (pg adapter tek-connection; Promise.all yok). Format + şablonlar
    // tekli /native ile AYNI zincirden (resolveLabelRouting): explicit cihaz > tablete-bağlı
    // yazıcı > global. Cihaz eşleşmezse resolver bugünkü davranışa düşer (BAYT-stabil).
    const rawRouting = await resolveLabelRouting({
      kind: LabelKind.ROLL_RAW,
      peripheralId: routing?.peripheralId ?? null,
      deviceId: routing?.deviceId ?? null,
    });
    const finishedRouting = await resolveLabelRouting({
      kind: LabelKind.ROLL_FINISHED,
      peripheralId: routing?.peripheralId ?? null,
      deviceId: routing?.deviceId ?? null,
    });
    const format = finishedRouting.format;
    const templateByKind: Partial<Record<LabelKind, LabelTemplate | null>> = {
      [LabelKind.ROLL_RAW]: rawRouting.template,
      [LabelKind.ROLL_FINISHED]: finishedRouting.template,
    };
    const variantByKind: Partial<Record<LabelKind, LabelTemplateVariant | null>> = {
      [LabelKind.ROLL_RAW]: rawRouting.variant,
      [LabelKind.ROLL_FINISHED]: finishedRouting.variant,
    };

    // §2-A: tüm top'ları tek findMany (getRollLabel ile AYNI include const → drift yok).
    const rolls = await prisma.roll.findMany({ where: { id: { in: ids } }, include: ROLL_LABEL_INCLUDE });
    const rollById = new Map<string, RollWithLabelIncludes>(rolls.map((r) => [r.id, r]));

    // §2-A1: snapshot'lardan branch ①(orderLineId)/②(customerId) lookup ihtiyaçları.
    const needOrderLineIds = new Set<string>();
    const needCustomerIds = new Set<string>();
    for (const r of rolls) {
      const snap = (r.lastLabelSnapshot ?? null) as Record<string, unknown> | null;
      if (!snap) continue;
      if (typeof snap.orderLineId === "string") needOrderLineIds.add(snap.orderLineId);
      else if (typeof snap.customerId === "string") needCustomerIds.add(snap.customerId);
    }

    // §2-A2: branch ①/② lookup'larını batch'le (select getRollLabel ile birebir).
    const orderLineById = new Map<string, OrderLineLabelCtx>();
    if (needOrderLineIds.size > 0) {
      const rows = await prisma.orderLine.findMany({
        where: { id: { in: [...needOrderLineIds] } },
        select: {
          id: true,
          customerItemName: true,
          customerColorName: true,
          order: { select: { orderNumber: true, customerId: true, customer: { select: { name: true } } } },
        },
      });
      for (const o of rows) orderLineById.set(o.id, o);
    }
    // Override müşteri de lookup'a girer (adı payload'a düşsün + aşağıdaki
    // rota/alias gruplamasına dahil olsun).
    if (overrideCustomerId) needCustomerIds.add(overrideCustomerId);
    const customerById = new Map<string, { id: string; name: string }>();
    if (needCustomerIds.size > 0) {
      const rows = await prisma.customer.findMany({
        where: { id: { in: [...needCustomerIds] } },
        select: { id: true, name: true },
      });
      for (const c of rows) customerById.set(c.id, c);
    }

    // §2 PASS-1: getRollLabel'i alias'sız bağlamla çağırıp her topun customerId'sini
    // ÇÖZ (branch mantığı tek-doğru-kaynak; replikasyon yok). alias gruplaması müşteri
    // bazlıdır — yanlış müşterinin alias'ı = fiziksel yanlış etiket olur, bu yüzden
    // (customerId → itemIds/colorIds) gruplanır.
    const partial: BulkLabelContext = {
      rollById,
      orderLineById,
      customerById,
      aliasByCustomer: new Map(),
      format,
      templateByKind,
      variantByKind,
      customerTemplateByKey: new Map(),
      copies,
      rasterMode: finishedRouting.rasterMode,
    };
    const byCustomer = new Map<string, { itemIds: Set<string>; colorIds: Set<string> }>();
    for (const id of ids) {
      const roll = rollById.get(id);
      if (!roll) continue; // var-olmayan top: ana döngüde getRollLabel fallback 404'ler
      // Override varsa topun KENDİ snapshot müşterisi değil, hedef müşteri gruplanır —
      // baskı o müşterinin alias'ı + rotasıyla çıkacak.
      const cid = overrideCustomerId ?? (await this.getRollLabel(id, {}, partial)).data.customerId;
      if (!cid) continue;
      const g = byCustomer.get(cid) ?? { itemIds: new Set<string>(), colorIds: new Set<string>() };
      g.itemIds.add(roll.item.id);
      if (roll.color) g.colorIds.add(roll.color.id);
      byCustomer.set(cid, g);
    }

    // §2-B: alias'ları müşteri bazlı batch'le (batchLoadAliases reuse — null color
    // alias'ı düşürür, inline yolla birebir aynı).
    const aliasByCustomer = new Map<string, BatchAliasResult>();
    for (const [cid, g] of byCustomer) {
      aliasByCustomer.set(cid, await batchLoadAliases(prisma, cid, [...g.itemIds], [...g.colorIds]));
    }

    // §2-C: müşteri-şablon route'ları tek sorguda (tekil yoldaki halkanın batch
    // karşılığı). Varyant, format TEK olduğundan şablon-başına bir kez seçilir.
    const customerTemplateByKey = new Map<
      string,
      { template: LabelTemplate; variant: LabelTemplateVariant | null }
    >();
    if (byCustomer.size > 0) {
      const routes = await prisma.customerTemplateRoute.findMany({
        where: {
          customerId: { in: [...byCustomer.keys()] },
          kind: { in: [LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED] },
        },
        include: { template: { include: { variants: true } } },
      });
      for (const r of routes) {
        if (!r.template.isActive || r.template.deletedAt != null) continue;
        const picked = pickVariant(r.template.variants, {
          widthMm: format.widthMm,
          heightMm: format.heightMm,
        });
        customerTemplateByKey.set(`${r.kind}|${r.customerId}`, {
          template: r.template,
          variant: picked.variant,
        });
      }
    }

    return { rollById, orderLineById, customerById, aliasByCustomer, format, templateByKind, variantByKind, customerTemplateByKey, copies, rasterMode: finishedRouting.rasterMode };
  }

  /**
   * OrderLine üstündeki müşteri-isim override'larını günceller.
   * Boş string / null → override silinir, master/default'a düşer.
   * label:edit yetkisi gerekir (route katmanında zorlanır).
   */
  async updateOrderLineCustomerNames(
    orderLineId: string,
    input: UpdateOrderLineCustomerNamesInput,
    userId?: string,
  ): Promise<ApiResponse<{ orderLineId: string; customerItemName: string | null; customerColorName: string | null }>> {
    const existing = await prisma.orderLine.findUnique({
      where: { id: orderLineId },
      select: {
        id: true,
        customerItemName: true,
        customerColorName: true,
      },
    });
    if (!existing) throw AppError.notFound("Sipariş satırı bulunamadı");

    // Hangi alanların gelip değişeceğini hesapla — undefined alan dokunulmaz.
    const data: { customerItemName?: string | null; customerColorName?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(input, "customerItemName")) {
      data.customerItemName = normalizeOverride(input.customerItemName);
    }
    if (Object.prototype.hasOwnProperty.call(input, "customerColorName")) {
      data.customerColorName = normalizeOverride(input.customerColorName);
    }

    if (Object.keys(data).length === 0) {
      throw AppError.badRequest("En az bir alan gönderilmeli (customerItemName veya customerColorName)");
    }

    const updated = await prisma.orderLine.update({
      where: { id: orderLineId },
      data,
      select: {
        id: true,
        customerItemName: true,
        customerColorName: true,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE_ORDER_LINE,
      recordId: orderLineId,
      oldData: {
        customerItemName: existing.customerItemName,
        customerColorName: existing.customerColorName,
      },
      newData: {
        customerItemName: updated.customerItemName,
        customerColorName: updated.customerColorName,
        event: "LABEL_OVERRIDE_EDIT",
      },
    });

    return {
      success: true,
      data: {
        orderLineId: updated.id,
        customerItemName: updated.customerItemName,
        customerColorName: updated.customerColorName,
      },
    };
  }

  /**
   * Kartela (Swatch) etiket payload'u. Müşteri context'i: bağlı WO'nun tek
   * OrderLine'ı varsa o satırın customer alias/override'ı kullanılır. Çoklu
   * satırda allocation belirsizliği → customer null.
   */
  async getSwatchLabel(swatchId: string): Promise<ApiResponse<SwatchLabelPayload>> {
    const sw = await prisma.swatch.findUnique({
      where: { id: swatchId },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        parentRoll: {
          select: {
            id: true,
            barcode: true,
          },
        },
      },
    });
    if (!sw) throw AppError.notFound("Kartela bulunamadı");

    // GEVŞEK MODEL: Kartela siparişe/WO'ya bağlı değil (fason dönüşünden doğar).
    // Müşteri/sipariş bağlamı yok; etiket müşterisi baskı anında seçilir (top
    // etiketi gibi). Ürün/renk adı master default'tan basılır.
    const itemResolved = resolveName(null, null, sw.item.name);
    const colorResolved = sw.color
      ? resolveName(null, null, sw.color.name)
      : null;

    const payload: SwatchLabelPayload = {
      swatchId: sw.id,
      cardNumber: sw.cardNumber,
      barcode: sw.barcode,
      itemCode: sw.item.code,
      itemName: itemResolved.name,
      itemNameDefault: sw.item.name,
      itemNameSource: itemResolved.source,
      colorCode: sw.color?.code ?? null,
      colorName: colorResolved?.name ?? null,
      colorNameDefault: sw.color?.name ?? null,
      colorNameSource: colorResolved?.source ?? null,
      widthCm: sw.width !== null ? Number(sw.width) : null,
      lengthCm: sw.length !== null ? Number(sw.length) : null,
      weightKg: sw.weightKg !== null ? Number(sw.weightKg) : null,
      customerName: null,
      customerId: null,
      orderNumber: null,
      orderLineId: null,
      batchNumber: null,
      parentRollBarcode: sw.parentRoll?.barcode ?? null,
      printedAt: new Date().toISOString(),
    };

    return { success: true, data: payload };
  }

  /**
   * Kartela render girdisi — payload (SwatchLabelPayload → LabelPayload map) +
   * SWATCH default template + barkod/QR SVG + kopya + format profili. Roll'un
   * `buildRollRenderInput` analoğu; tüm diller (html/ppla/pplb/zpl) paylaşır.
   */
  private async buildSwatchRenderInput(
    swatchId: string,
    opts?: RollLabelRenderOpts,
  ): Promise<{ input: LabelRenderInput; kind: LabelKind }> {
    const payloadResp = await this.getSwatchLabel(swatchId);
    const payload = swatchPayloadToLabelPayload(payloadResp.data);

    const routing = await resolveLabelRouting({
      kind: LabelKind.SWATCH,
      peripheralId: opts?.peripheralId,
      templateId: opts?.templateId,
      machineId: opts?.machineId,
      deviceId: opts?.deviceId,
    });
    const barcodeSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" })
      : "";
    const qrSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" })
      : "";
    const copies = clampRollCopies(opts?.copies ?? (await readLabelCopies()));
    // KARTELA v1 KAPSAM DIŞI (Etiket Stüdyosu): variant BİLEREK geçilmez — kartela
    // hattı akış-modelinde bayt-aynı kalır. Kanvas'a alınırsa müşteri plumbing'iyle
    // birlikte ayrı iş (docs/design/KARTELA-TASARIM.md).
    return {
      input: { payload, template: routing.template, barcodeSvg, qrSvg, copies, format: routing.format },
      kind: LabelKind.SWATCH,
    };
  }

  /** Kartela etiketinin HTML'i — roll `getRollLabelHtml` analoğu (mobil + Electron). */
  async getSwatchLabelHtml(
    swatchId: string,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const { input, kind } = await this.buildSwatchRenderInput(swatchId, opts);
    const html = (await renderLabel(PrinterLanguage.RASTER_HTML, input)).content;
    return { success: true, data: { html, kind } };
  }

  /**
   * Kartela etiketini SEÇİLİ dilde döner — cihaz kaydındaki dil (cihazsız → RASTER_HTML)
   * (default PPLA) veya istasyon yazıcı modelinin dili. RASTER_HTML → HTML;
   * PPLA/PPLB/ZPL → native komut. Roll `getRollLabelNative` analoğu.
   */
  async getSwatchLabelNative(
    swatchId: string,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ content: string; language: PrinterLanguage; contentType: string; kind: LabelKind }>> {
    const { input, kind } = await this.buildSwatchRenderInput(swatchId, opts);
    const r = await renderLabel(input.format.language, input);
    return {
      success: true,
      data: { content: r.content, language: r.language, contentType: r.contentType, kind },
    };
  }

  // ---------------------------------------------------------------------------
  // SACK (ÇUVAL) ETİKETİ — barkod/QR = Sack.sackNo (tek kod kuralı)
  // ---------------------------------------------------------------------------

  /**
   * Çuval etiketi payload'ı. Barkod = `sackNo` (Sack'te ayrı barcode kolonu YOK).
   * ÜRÜN/RENK alanı YOK: çuvalda N farklı kumaş olabilir, tek ürün adı basmak
   * karışık çuvalda sessizce yanlış olur → toplam metriklerle sınırlı.
   *
   * `rollCount`/`lengthMeters` FİZİKSEL OLARAK ÇUVALDA OLMAYAN topları saymaz.
   * `SHIPPED` BİLİNÇLİ olarak SAYILIR: sevk edilen top çuvalda kalır ve irsaliyedeki
   * TOP ADEDİ/METRE ile tutarlı olmalı.
   *
   * Diğer ölü/başka-yerde statüler dışlanır. Bunlar çuvalda GERÇEKTEN bulunabilir —
   * "çuvala girdikten sonra statüsü bozulan top" yolları var (ör. `kartela.service`
   * kartelaya alırken `sackId` guard'ı UYGULAMIYOR → top `AT_KARTELA` olup çuvalda
   * kalıyor). Bu liste olmadan binada olmayan mal çuval etiketine basılırdı.
   */
  private static readonly SACK_LABEL_EXCLUDED_STATUSES: RollStatus[] = [
    RollStatus.CANCELLED,
    RollStatus.SCRAP,
    RollStatus.IN_PRODUCTION,
    RollStatus.AT_SUBCONTRACTOR,
    RollStatus.SUBCONTRACTOR_CONSUMED,
    RollStatus.AT_KARTELA,
    RollStatus.KARTELA_CONSUMED,
    RollStatus.TAMBUR_CONSUMED,
  ];

  async getSackLabel(sackId: string): Promise<ApiResponse<LabelPayload>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        weightKg: true,
        notes: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        rolls: {
          where: { status: { notIn: LabelService.SACK_LABEL_EXCLUDED_STATUSES } },
          select: { currentQty: true },
        },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");

    // Metraj toplamı Decimal aritmetiğiyle (float toplama YASAK — perf/doğruluk kuralı).
    let meters = new Prisma.Decimal(0);
    for (const r of sack.rolls) meters = meters.plus(r.currentQty);

    const payload: LabelPayload = {
      rollId: sack.id,
      // Barkod = sackNo: etikette Code128 + QR aynı değeri taşır (tek kod).
      barcode: sack.sackNo,
      status: "",
      qualityGrade: "",
      widthCm: null,
      lengthMeters: Number(meters),
      weightKg: sack.weightKg != null ? Number(sack.weightKg) : null,
      markedForKartela: false,
      itemCode: "",
      itemName: "",
      itemNameDefault: "",
      itemNameSource: "DEFAULT",
      colorCode: null,
      colorName: null,
      colorNameDefault: null,
      colorNameSource: null,
      customerName: sack.customer?.name ?? null,
      customerId: null,
      orderNumber: null,
      orderLineId: null,
      batchNumber: null,
      printedAt: new Date().toISOString(),
      kind: LabelKind.SACK,
      sackNo: sack.sackNo,
      rollCount: sack.rolls.length,
      branchName: sack.branch?.name ?? null,
      // Çok satırlı yorum etiket hücresinde satır taşırmasın → tek satıra düzleştir.
      sackNote: sack.notes ? sack.notes.replace(/\s*\n+\s*/g, " · ").trim() : null,
    };
    return { success: true, data: payload };
  }

  /**
   * Çuval etiketi render girdisi. FAIL-CLOSED: SACK şablonu çözülemezse HATA verir.
   *
   * ⚠️ Neden zorunlu: `label-html-landscape.helper.ts` bilinmeyen `kind`'ı
   * `ROLL_FINISHED`'a düşürür (`payload.kind ?? template?.kind ?? ROLL_FINISHED`).
   * Şablonsuz çuval baskısı bu yüzden HATA VERMEZ, tire dolu bir TOP etiketi basar.
   * Sessiz çöp çıktı yerine operatöre ne yapacağını söyleyen Türkçe hata döneriz.
   */
  private async buildSackRenderInput(
    sackId: string,
    opts?: RollLabelRenderOpts,
  ): Promise<{ input: LabelRenderInput; kind: LabelKind }> {
    const payloadResp = await this.getSackLabel(sackId);
    const payload = payloadResp.data;

    const routing = await resolveLabelRouting({
      kind: LabelKind.SACK,
      peripheralId: opts?.peripheralId,
      templateId: opts?.templateId,
      machineId: opts?.machineId,
      deviceId: opts?.deviceId,
    });
    if (!routing.template) {
      throw AppError.badRequest(
        "Çuval etiket şablonu tanımlı değil — Tanımlar → Etiket Şablonları'ndan bir " +
          "Çuval şablonu oluşturup Etiketler → Atamalar'da Bağlam Varsayılanı olarak atayın.",
      );
    }

    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    const copies = clampRollCopies(opts?.copies ?? (await readLabelCopies()));
    return {
      // variant GEÇİLİR (swatch aksine) — çuval etiketi kanvas modelinde yaşar.
      input: {
        payload,
        template: routing.template,
        variant: routing.variant,
        barcodeSvg,
        qrSvg,
        copies,
        format: routing.format,
        rasterMode: routing.rasterMode,
      },
      kind: LabelKind.SACK,
    };
  }

  /** Çuval etiketinin HTML'i — roll `getRollLabelHtml` analoğu. */
  async getSackLabelHtml(
    sackId: string,
    opts?: RollLabelRenderOpts,
  ): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const { input, kind } = await this.buildSackRenderInput(sackId, opts);
    const html = (await renderLabel(PrinterLanguage.RASTER_HTML, input)).content;
    return { success: true, data: { html, kind } };
  }

  /** Çuval etiketini SEÇİLİ yazıcı dilinde — roll `getRollLabelNative` analoğu. */
  async getSackLabelNative(
    sackId: string,
    opts?: RollLabelRenderOpts & { encoding?: "b64" },
  ): Promise<
    ApiResponse<{
      content: string;
      contentB64?: string;
      language: PrinterLanguage;
      contentType: string;
      kind: LabelKind;
      count: number;
    }>
  > {
    const { input, kind } = await this.buildSackRenderInput(sackId, opts);
    const r = await renderLabel(input.format.language, input);
    const data: {
      content: string;
      contentB64?: string;
      language: PrinterLanguage;
      contentType: string;
      kind: LabelKind;
      count: number;
    } = {
      content: r.content,
      language: r.language,
      contentType: r.contentType,
      kind,
      count: input.copies,
    };
    if (opts?.encoding === "b64") {
      data.contentB64 = renderedBytes(r).toString("base64");
    }
    return { success: true, data };
  }

  /** Çuval etiketi baskı izi — LABEL_PRINT_EVENT audit (roll recordPrintEvent analoğu). */
  async recordSackPrintEvent(sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { sackNo: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE_LABEL_PRINT,
      recordId: sackId,
      newData: { kind: LabelKind.SACK, sackNo: sack.sackNo },
    });
    return { success: true, data: { sackId, sackNo: sack.sackNo }, message: "Çuval etiketi baskı izi kaydedildi" };
  }

  // ---------------------------------------------------------------------------
  // SERBEST (STATİK) ETİKET — rulo/kartela bağlamı OLMADAN talep üzerine baskı
  // ---------------------------------------------------------------------------

  /**
   * Serbest (statik) etiket seçicisi — aktif `standalone` şablonlar + basılabilir
   * boyut varyantları. Electron/mobil baskı seçicisi bunu tüketir (atama seçicileri
   * değil — onlar `label-templates?assignable=true` kullanır).
   *
   * `customerId` verilirse liste = o müşteriye BAĞLI serbest etiketler ∪ hiç bağı
   * olmayan "genel" serbest etiketler (başka müşteriye özel bağlılar dışlanır). Bağ
   * bir M:N KOLAYLIK bağıdır — rulo/kartela etiket çözümüne (label-routing.resolver /
   * CustomerTemplateRoute) KATILMAZ; yalnız bu seçiciyi filtreler.
   */
  async listStandaloneTemplates(customerId?: string): Promise<
    ApiResponse<
      Array<{
        id: string;
        name: string;
        variants: Array<{ id: string; name: string; widthMm: number; heightMm: number; isPrimary: boolean }>;
      }>
    >
  > {
    const rows = await prisma.labelTemplate.findMany({
      where: {
        standalone: true,
        isActive: true,
        deletedAt: null,
        ...(customerId
          ? {
              OR: [
                { customerStandaloneLinks: { some: { customerId } } },
                { customerStandaloneLinks: { none: {} } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        variants: {
          select: { id: true, name: true, widthMm: true, heightMm: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    return {
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        variants: t.variants.map((v) => ({
          id: v.id,
          name: v.name,
          widthMm: Number(v.widthMm),
          heightMm: Number(v.heightMm),
          isPrimary: v.isPrimary,
        })),
      })),
    };
  }

  /**
   * Serbest etiket render girdisi — kaydedilmiş bir LabelTemplate varyantını mock
   * payload + cihaz bağlamı (dil/medya/raster) ile hazırlar. Rulo/kartela bağlamı
   * YOK; talep üzerine (şablon + kopya seç) basılır. Roll/kartela native yoluyla
   * AYNI cihaz→{format, dil, raster} çözümünü (`resolveLabelRouting`) paylaşır;
   * yalnız şablon/varyant çözünürlüğü farklı (rota değil, çağrının seçtiği varyant).
   * Baskı seçili varyantın FİZİKSEL tuval boyutunda yapılır (WYSIWYG — kanvas o
   * tuvalde çizilir, `getCanvasPreview` ile aynı). Kopya 1–100 (akış 1–5 DEĞİL).
   */
  private async buildStandaloneRenderInput(opts: {
    templateId: string;
    variantId?: string | null;
    copies?: number | null;
    peripheralId?: string | null;
    machineId?: string | null;
    deviceId?: string | null;
  }): Promise<{ input: LabelRenderInput; kind: LabelKind; copies: number }> {
    // Yalnız SERBEST (statik) şablon bağlamsız basılabilir — türlü (rulo/kartela)
    // şablon örnek veriyle basılırsa izsiz/sahte-barkodlu etiket doğar; bu uç ona
    // kapalı (o şablonlar kendi rulo/kartela akışından basılır). VAR+AKTİF+silinmemiş.
    const template = await prisma.labelTemplate.findFirst({
      where: { id: opts.templateId, standalone: true, isActive: true, deletedAt: null },
      include: { variants: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    });
    if (!template) throw AppError.notFound("Serbest etiket şablonu bulunamadı veya pasif");
    if (template.variants.length === 0) {
      throw AppError.badRequest("Bu şablonda basılabilir boyut (varyant) yok");
    }

    // Varyant: explicit variantId → primary → ilk (sıralama primary önce).
    let variant: LabelTemplateVariant;
    if (opts.variantId) {
      const found = template.variants.find((v) => v.id === opts.variantId);
      if (!found) throw AppError.badRequest("Belirtilen varyant bu şablonda yok");
      variant = found;
    } else {
      variant = template.variants.find((v) => v.isPrimary) ?? template.variants[0];
    }

    const kind: LabelKind = template.kind ?? LabelKind.ROLL_FINISHED;
    const payload = mockPayload(kind);

    // Roll native ile AYNI cihaz çözümü: format (medya/dpi), dil, raster modu.
    // Şablon/varyant rota kısmı yok sayılır (serbest şablonun rotası olamaz).
    const routing = await resolveLabelRouting({
      kind,
      peripheralId: opts.peripheralId ?? null,
      machineId: opts.machineId ?? null,
      deviceId: opts.deviceId ?? null,
    });
    const widthMm = Number(variant.widthMm);
    const heightMm = Number(variant.heightMm);
    // Serbest baskı seçili varyantın FİZİKSEL boyutunda yapılır (kullanıcı boyutu
    // açıkça seçti) — kanvas o tuvalde çizilir (getCanvasPreview ile aynı).
    const format: ResolvedLabelFormat = {
      ...routing.format,
      widthMm,
      heightMm,
      orientation: widthMm >= heightMm ? "LANDSCAPE" : "PORTRAIT",
    };

    const barcodeSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" })
      : "";
    const qrSvg = payload.barcode
      ? bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" })
      : "";
    // Serbest baskı çok kopya isteyebilir → 1–100 (akış clampRollCopies 1–5 DEĞİL).
    const copies = Math.max(1, Math.min(100, Math.floor(opts.copies ?? 1) || 1));
    const input: LabelRenderInput = {
      payload,
      template,
      variant,
      barcodeSvg,
      qrSvg,
      copies,
      format,
      rasterMode: routing.rasterMode,
    };
    return { input, kind, copies };
  }

  /** Serbest etiketin tam HTML'i — `/rolls/:id/html` analoğu (mock payload). */
  async renderStandaloneTemplateHtml(opts: {
    templateId: string;
    variantId?: string | null;
    copies?: number | null;
    peripheralId?: string | null;
    machineId?: string | null;
    deviceId?: string | null;
  }): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const { input, kind } = await this.buildStandaloneRenderInput(opts);
    const html = (await renderLabel(PrinterLanguage.RASTER_HTML, input)).content;
    return { success: true, data: { html, kind } };
  }

  /**
   * Serbest etiketi SEÇİLİ yazıcı dilinde — `/rolls/:id/native` analoğu (mock
   * payload). RASTER_HTML → HTML; PPLA/PPLB/ZPL → native komut. b64 zarfı için
   * `contentB64` (renderedBytes → base64). `count` = basılacak kopya adedi.
   */
  async renderStandaloneTemplateNative(opts: {
    templateId: string;
    variantId?: string | null;
    copies?: number | null;
    peripheralId?: string | null;
    machineId?: string | null;
    deviceId?: string | null;
    /** İstemci b64/binary bayt kabul ediyor mu (encoding=b64) — false → raster bastırılır. */
    rasterCapable?: boolean;
  }): Promise<
    ApiResponse<{
      content: string;
      contentB64: string;
      encoding: "text" | "binary";
      language: PrinterLanguage;
      contentType: string;
      kind: LabelKind;
      count: number;
    }>
  > {
    const { input, kind, copies } = await this.buildStandaloneRenderInput(opts);
    // rasterCapable değilse (eski istemci) raster'ı bastır → komut üret (bozulmaz).
    // rasterCapable (b64) → binary-güvenli → ikon GW emit; değilse ham text → ikon atlanır.
    const r = await renderLabel(
      input.format.language,
      opts.rasterCapable ? { ...input, iconGraphicsOk: true } : { ...input, rasterMode: false },
    );
    return {
      success: true,
      data: {
        content: r.content,
        contentB64: renderedBytes(r).toString("base64"),
        encoding: r.encoding,
        language: r.language,
        contentType: r.contentType,
        kind,
        count: copies,
      },
    };
  }

  /**
   * Etiket NİYETİNİ topa kalıcılaştırır (`lastLabelSnapshot`) — fiziksel baskıdan
   * VE audit'ten BAĞIMSIZ "intent persist" primitifi. Kesim sonrası seed,
   * baskı-öncesi mobil seed ve relabel önizleme bunu kullanır; LABEL_PRINTED
   * audit'i YAZMAZ. Müşteri çözülürse denormalize yazar (Electron "Son baskı"
   * afişi `snap.customerName` okur); müşterisiz → `{ stock:true }`. Etiket
   * çözülemezse (örn. barkodsuz açık kumaş) snapshot'a dokunmaz.
   * label:print yetkisi gerekir (route katmanında).
   */
  async seedRollLabelSnapshot(
    rollId: string,
    userId?: string,
    opts?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean }
  ): Promise<ApiResponse<{ seeded: boolean }>> {
    const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { id: true } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    let labelData: LabelPayload | null = null;
    try {
      labelData = (await this.getRollLabel(rollId, opts)).data;
    } catch (e) {
      // Etiket çözülemezse snapshot'a dokunma — ama SESSİZ kalma.
      console.error("[label] seedRollLabelSnapshot çözümü başarısız:", e);
      return { success: true, data: { seeded: false } };
    }

    let operatorName: string | null = null;
    if (userId) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
      operatorName = u?.fullName ?? null;
    }
    await prisma.roll.update({
      where: { id: rollId },
      data: { lastLabelSnapshot: buildDenormalizedSnapshot(labelData, userId, operatorName) },
    });
    return { success: true, data: { seeded: true } };
  }

  /**
   * Etiket basıldı: niyeti kalıcılaştır (`seedRollLabelSnapshot`) + FİZİKSEL baskı
   * audit izi (LABEL_PRINTED). YALNIZ gerçek baskı tamamlandığında çağrılmalı —
   * yazıcısız/iptal niyet kaydı için `seedRollLabelSnapshot` kullanılır (audit
   * "basıldı" demesin). label:print yetkisi gerekir (route katmanında).
   */
  async recordPrintEvent(
    rollId: string,
    userId?: string,
    opts?: {
      orderLineId?: string | null;
      customerId?: string | null;
      stock?: boolean;
      /** Baskıyı yapan cihaz bağlamı (varsa) — audit'teki şablon izini netleştirir. */
      peripheralId?: string | null;
      deviceId?: string | null;
      machineId?: string | null;
    }
  ): Promise<ApiResponse<{ recorded: true }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, status: true, colorId: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Niyet kalıcılaştırma (snapshot) — audit'ten ayrı primitif.
    await this.seedRollLabelSnapshot(rollId, userId, opts);

    // Etiket bayat bayrağını temizle — fiziksel etiket az önce basıldı → veriyle uyumlu.
    // Yalnız bayat iken yaz (gereksiz update yok).
    await prisma.roll.updateMany({ where: { id: rollId, labelDirty: true }, data: { labelDirty: false } });

    // Çözülen şablon/varyant izi (BEST-EFFORT): reprint şablonu DONDURMADIĞINDAN
    // "o an hangi atama geçerliydi" audit'ten okunur — baskı davranışıyla aynı
    // zincir (müşteri > cihaz > bağlam default). Hata isteği düşürmez.
    let resolvedMeta: Record<string, unknown> = {};
    try {
      const payload = (await this.getRollLabel(rollId, opts)).data;
      const kind: LabelKind = roll.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED;
      const routing = await resolveLabelRouting({
        kind,
        customerId: payload.customerId ?? null,
        peripheralId: opts?.peripheralId ?? null,
        deviceId: opts?.deviceId ?? null,
        machineId: opts?.machineId ?? null,
      });
      resolvedMeta = {
        templateId: routing.template?.id ?? null,
        templateName: routing.template?.name ?? null,
        variantId: routing.variant?.id ?? null,
        variantMatch: routing.variantMatch,
        language: routing.language,
      };
    } catch {
      /* best-effort — audit izi zenginleştirmesi baskı kaydını engellemez */
    }

    // Fiziksel baskı izi.
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE_LABEL_PRINT,
      recordId: rollId,
      newData: {
        rollId,
        barcode: roll.barcode,
        status: roll.status,
        event: "LABEL_PRINTED",
        ...resolvedMeta,
      },
    });

    return { success: true, data: { recorded: true } };
  }
}

// Cascade + normalize helpers `helpers/customer-name.helper.ts`'den.

/**
 * Çözülmüş `LabelPayload`'tan denormalize "son etiket" snapshot'ı kurar —
 * `seedRollLabelSnapshot`/`recordPrintEvent` paylaşır. Müşteri varsa müşteri/
 * sipariş + müşterideki ad blokları; yoksa `{ stock:true }`. Electron "Son baskı"
 * afişi ve liste bu denormalize alanları okur (etiket render'ı snap.orderLineId/
 * customerId'den TAZE çözer, denormalize adları kullanmaz).
 */
function buildDenormalizedSnapshot(
  labelData: LabelPayload,
  userId?: string,
  operatorName?: string | null,
): Prisma.InputJsonValue {
  const snap: Record<string, string | boolean> = {
    printedAt: new Date().toISOString(),
  };
  if (userId) snap.operatorId = userId;
  if (operatorName) snap.operatorName = operatorName;

  if (labelData.customerId) {
    snap.customerId = labelData.customerId;
    if (labelData.customerName) snap.customerName = labelData.customerName;
    if (labelData.orderNumber) snap.orderNumber = labelData.orderNumber;
    if (labelData.orderLineId) snap.orderLineId = labelData.orderLineId;
    if (labelData.itemName) snap.itemName = labelData.itemName;
    if (labelData.colorName) snap.colorName = labelData.colorName;
  } else {
    snap.stock = true;
  }
  return snap as Prisma.InputJsonValue;
}

/**
 * MİNİMAL niyet snapshot'ı — kesim anında (in-tx) `lastLabelSnapshot`'a yazılır.
 * DB okuması/çözüm YOK (tx içi I/O yasak): yalnız `{orderLineId}` / `{customerId}`
 * / `{stock:true}` literali. `getRollLabel` okuma anında adları tazece çözer.
 * tambur.service kesim siteleri bunu kullanır.
 */
export function buildIntentSnapshot(intent: {
  orderLineId?: string | null;
  customerId?: string | null;
  stock?: boolean;
}): Prisma.InputJsonValue {
  if (intent.orderLineId) return { orderLineId: intent.orderLineId };
  if (intent.customerId) return { customerId: intent.customerId };
  return { stock: true };
}
