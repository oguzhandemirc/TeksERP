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
import { readLabelCopies } from "./system-setting.service";
import { LabelKind, PrinterLanguage, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { resolveName, normalizeOverride, NameSource } from "./helpers/customer-name.helper";
import { buildRollLabelHtml } from "./helpers/label-html.helper";
import { resolveLabelFormat } from "./helpers/label-format.resolver";
import { renderLabel } from "./helpers/label-renderer.registry";

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

  // Batch
  batchNumber: string | null;
  printedAt: string;
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

export class LabelService {
  /**
   * Bir rulonun etiket payload'unu döner. Allocation modülü kaldırıldı —
   * customer/order alanları sabit null. Sevkiyat modülü yeniden yazıldığında
   * order context'i parametre olarak alınacak.
   */
  async getRollLabel(
    rollId: string,
    opts?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean }
  ): Promise<ApiResponse<LabelPayload>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        producedInStep: {
          select: {
            workOrder: {
              select: {
                id: true,
                batchNumber: true,
                orderLinks: {
                  select: {
                    orderLine: {
                      select: {
                        id: true,
                        customerItemName: true,
                        customerColorName: true,
                        order: {
                          select: {
                            orderNumber: true,
                            customerId: true,
                            customer: { select: { name: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.barcode) {
      throw AppError.badRequest(
        "Bu Roll için etiket basılamaz — açık kumaş Roll'ları (Kurşun/KK2 öncesi) fiziksel etiket almaz."
      );
    }

    // Müşteri context çözümü: WO'ya bağlı OrderLine'ların TÜMÜ aynı müşteriye
    // gidiyorsa müşteri otomatik çözülür (Patos 300m + Patos 200m → aynı müşteri
    // OK). Farklı müşteri karışırsa allocation gerekir → null kalır. Sipariş
    // numarası / orderLineId yalnız tek satırda set edilir; çoklu satırda
    // hangisi belirsiz olduğu için null. Override (sipariş satırı özel adı)
    // tüm satırlarda aynıysa kullanılır, farklıysa müşterinin master alias'ına
    // düşer.
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
    // topun ÜSTÜNDEKİ son basılan etiketi (lastLabelSnapshot) yansıt — WO
    // siparişinden TAHMİN değil. Snapshot hiç yoksa (henüz etiket basılmamış)
    // eski WO-tek-müşteri tahminine düşülür.
    const snap = (roll.lastLabelSnapshot ?? null) as Record<string, unknown> | null;
    // Explicit "Stok" baskı (opts.stock): müşteriyi ZORLA null bırak — snapshot'ı
    // VE WO tek-müşteri tahminini ATLA. Operatör "Stok" dediyse topun üstündeki
    // eski müşteri etiketi tekrar basılmamalı; müşterisiz spec-only etiket çıkar.
    const forceStock = opts?.stock === true;
    const hasExplicit = forceStock || !!(opts?.orderLineId || opts?.customerId);
    let effOrderLineId: string | null = forceStock ? null : (opts?.orderLineId ?? null);
    let effCustomerId: string | null = forceStock ? null : (opts?.customerId ?? null);
    // Snapshot var ama müşterisiz ("stok" baskı) → WO tahmini YAPMA, müşteri null kalsın.
    let printedAsStock = forceStock;
    if (!hasExplicit && snap) {
      if (typeof snap.orderLineId === "string") {
        effOrderLineId = snap.orderLineId;
      } else if (typeof snap.customerId === "string") {
        effCustomerId = snap.customerId;
      } else {
        printedAsStock = true;
      }
    }

    if (effOrderLineId) {
      // ① Baskı bağlamı: sipariş kalemi (tambur kesim / relabel / snapshot). Bu bir
      // BAĞ DEĞİL — yalnız bu baskının müşteri/sipariş bağlamı (gevşek model: top fungible).
      const tgt = await prisma.orderLine.findUnique({
        where: { id: effOrderLineId },
        select: {
          id: true,
          customerItemName: true,
          customerColorName: true,
          order: {
            select: { orderNumber: true, customerId: true, customer: { select: { name: true } } },
          },
        },
      });
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
      const cust = await prisma.customer.findUnique({
        where: { id: effCustomerId },
        select: { id: true, name: true },
      });
      if (cust) {
        customerId = cust.id;
        customerName = cust.name;
      }
    } else if (printedAsStock) {
      // Snapshot var ama müşterisiz → top "stok" etiketiyle basılmış. Müşteri null
      // kalır; WO siparişinden tahmin YAPMA (yoksa hiç basılmamış müşteriyi gösterirdik).
    } else {
      // ② Geri uyum: hiç etiket basılmamış — WO'ya bağlı satırlardan tek-müşteri tahmini.
      const links = roll.producedInStep?.workOrder?.orderLinks ?? [];
      const customerIds = new Set(links.map((l) => l.orderLine.order.customerId));
      const sameCustomer = links.length > 0 && customerIds.size === 1;
      if (sameCustomer) {
        const first = links[0];
        customerId = first.orderLine.order.customerId;
        customerName = first.orderLine.order.customer.name;
        if (links.length === 1) {
          orderNumber = first.orderLine.order.orderNumber;
          orderLineId = first.orderLine.id;
        }
        itemOverride = allEqual(links.map((l) => l.orderLine.customerItemName));
        colorOverride = allEqual(links.map((l) => l.orderLine.customerColorName));
      }
    }

    // Master alias'lar — customer × item / customer × color (yoksa null).
    if (customerId) {
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
      qualityGrade: roll.qualityGrade,
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

      batchNumber: roll.producedInStep?.workOrder.batchNumber ?? null,
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
      barcode: "TR-2026-05-26-R0123",
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
      orderNumber: "SIP-2026-00123",
      orderLineId: "preview",
      batchNumber: "PRT-A24",
      printedAt: new Date().toISOString(),
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

    const html = buildRollLabelHtml({
      payload: mockPayload,
      template: mockTemplate,
      barcodeSvg,
      qrSvg,
    });
    return { success: true, data: { html } };
  }

  /**
   * Rolün etiket HTML'i — tek doğru kaynak. Hem mobil (expo-print) hem Electron
   * (LabelPreview iframe) bu HTML'i tüketir. Kind otomatik tespit edilir:
   * RENKSİZ (colorId == null) = ham kumaş → ROLL_RAW, aksi halde ROLL_FINISHED.
   * Renk = boyanmış = bitmiş; renksiz top hangi statüde olursa olsun (tedarikçi
   * ham stoğu, tambur'da kesilen ham parça, ham talep eden müşteriye giden
   * ham-bitmiş depo topu) ham etiketle basılır. Caller `?kind=` ile override eder.
   */
  async getRollLabelHtml(
    rollId: string,
    kindOverride?: LabelKind,
    opts?: {
      orderLineId?: string | null;
      customerId?: string | null;
      stock?: boolean;
      /** Saha #6: kopya adedi override (1-5). Verilmezse label.copies ayarı (default 2). */
      copies?: number;
      /** Fiziksel format profili — explicit override. */
      profileId?: string | null;
      /** İstasyon makinesi — yazıcı/profil oto çözülür (mobil: req.device.machineId). */
      machineId?: string | null;
    },
  ): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const payloadResp = await this.getRollLabel(rollId, opts);
    const payload = payloadResp.data;

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { colorId: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const kind: LabelKind =
      kindOverride ??
      (roll.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED);

    const template = await prisma.labelTemplate.findFirst({
      where: { kind, isDefault: true, isActive: true },
    });

    const barcodeSvg = payload.barcode
      ? bwipjs.toSVG({
          bcid: "code128",
          text: payload.barcode,
          scale: 3,
          height: 10,
          includetext: false,
          backgroundcolor: "FFFFFF",
        })
      : "";
    const qrSvg = payload.barcode
      ? bwipjs.toSVG({
          bcid: "qrcode",
          text: payload.barcode,
          scale: 3,
          backgroundcolor: "FFFFFF",
        })
      : "";

    // Saha #6: kopya adedi — istek override > ayar (default 2, üst+alt yapıştırma).
    const copies = opts?.copies ?? (await readLabelCopies());
    // Fiziksel geometri (medya + güvenlik payı) — profileId/machineId'den çözülür;
    // mobil baskı istasyon yazıcısını oto çözer (req.device.machineId), Electron default.
    const format = await resolveLabelFormat({
      profileId: opts?.profileId,
      machineId: opts?.machineId,
    });
    const html = buildRollLabelHtml({ payload, template, barcodeSvg, qrSvg, copies, format });
    return { success: true, data: { html, kind } };
  }

  /**
   * Rolün Argox PPLA native komut string'i — `/html`'in native analoğu. Faz-1:
   * yalnız ÜRETİLİR (saf string; HTML üretmek gibi izinli). Fiziksel ham-gönderim
   * `printer-transport` içinde SİMÜLE (Faz-2'de gerçek socket/USB). Format profili
   * (medya boyutu + güvenlik payı) `/html` ile AYNI resolver'dan gelir.
   */
  async getRollLabelPpla(
    rollId: string,
    opts?: {
      orderLineId?: string | null;
      customerId?: string | null;
      stock?: boolean;
      copies?: number;
      profileId?: string | null;
      machineId?: string | null;
    },
  ): Promise<ApiResponse<{ ppla: string; profileId: string | null }>> {
    const payloadResp = await this.getRollLabel(rollId, opts);
    const payload = payloadResp.data;
    const copies = opts?.copies ?? (await readLabelCopies());
    const format = await resolveLabelFormat({
      profileId: opts?.profileId,
      machineId: opts?.machineId,
    });
    const rendered = renderLabel(PrinterLanguage.PPLA, {
      payload,
      template: null,
      barcodeSvg: "",
      qrSvg: "",
      copies,
      format,
    });
    return { success: true, data: { ppla: rendered.content, profileId: format.profileId } };
  }

  /**
   * Saha #7: TOPLU etiket — bir sevkiyatın (veya seçili çuvalların) tüm toplarının
   * etiketlerini TEK belgede birleştirir (her etiket kendi A6 sayfası). Tek baskıda
   * yüzlerce top etiketi çıkarmak için. İlk etiketin <head>/<style>'ı paylaşılır;
   * sonraki etiketlerin yalnız <body> içeriği eklenir.
   */
  async getBulkRollLabelsHtml(
    rollIds: string[],
    opts?: { copies?: number },
  ): Promise<ApiResponse<{ html: string; count: number }>> {
    const ids = [...new Set(rollIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir top seçilmeli");
    const copies = opts?.copies ?? (await readLabelCopies());

    const bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/i;
    let head = "";
    const bodies: string[] = [];
    for (const id of ids) {
      const res = await this.getRollLabelHtml(id, undefined, { copies });
      const full = res.data.html;
      if (!head) {
        // İlk belgenin <head> dahil <body ...> açılışına kadarki kısmı.
        const openIdx = full.search(/<body[^>]*>/i);
        head = openIdx >= 0 ? full.slice(0, full.match(/<body[^>]*>/i)![0].length + openIdx) : "";
      }
      const m = full.match(bodyRe);
      if (m) bodies.push(m[1]);
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
   * Etiket basıldı — sadece audit izi (gerçek baskı tarayıcıda olur).
   * label:print yetkisi gerekir (route katmanında).
   */
  async recordPrintEvent(
    rollId: string,
    userId?: string,
    opts?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean }
  ): Promise<ApiResponse<{ recorded: true }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // "Son basılan etiket" snapshot'ı — baskı anında çözülen müşteri/sipariş
    // bağlamı (getRollLabel ile aynı çözüm; BAĞ DEĞİL, yalnız bilgi). Müşteri
    // çözülürse denormalize yaz; müşterisiz (stok) baskıda önceki snapshot
    // temizlenir (üstündeki fiili etiket artık stok). Etiket çözülemezse dokunma.
    let labelData: LabelPayload | null = null;
    try {
      labelData = (await this.getRollLabel(rollId, opts)).data;
    } catch {
      labelData = null;
    }
    if (labelData) {
      let operatorName: string | null = null;
      if (userId) {
        const u = await prisma.user.findUnique({
          where: { id: userId },
          select: { fullName: true },
        });
        operatorName = u?.fullName ?? null;
      }
      const snap: Record<string, string | boolean> = {
        printedAt: new Date().toISOString(),
      };
      if (userId) snap.operatorId = userId;
      if (operatorName) snap.operatorName = operatorName;

      if (labelData.customerId) {
        snap.customerId = labelData.customerId;
        if (labelData.customerName) snap.customerName = labelData.customerName;
        if (labelData.orderNumber) snap.orderNumber = labelData.orderNumber;
        // orderLineId — Electron etiket görünümü override'ları (müşterideki ürün/
        // renk adı) sadık biçimde yeniden çözebilsin diye saklanır.
        if (labelData.orderLineId) snap.orderLineId = labelData.orderLineId;
        if (labelData.itemName) snap.itemName = labelData.itemName;
        if (labelData.colorName) snap.colorName = labelData.colorName;
      } else {
        // Müşterisiz (stok) baskı → snapshot'ı silmek yerine "stok" işaretle.
        // Böylece Electron etiket görünümü WO siparişinden müşteri TAHMİN ETMEZ
        // (kart hâlâ "Stok etiketli" gösterir; customerName yok).
        snap.stock = true;
      }
      await prisma.roll.update({
        where: { id: rollId },
        data: { lastLabelSnapshot: snap as Prisma.InputJsonValue },
      });
    }

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
      },
    });

    return { success: true, data: { recorded: true } };
  }
}

// Cascade + normalize helpers `helpers/customer-name.helper.ts`'den.

/**
 * Listedeki tüm değerler aynıysa o değeri döner; farklıysa null.
 * Override resolution: WO çoklu satıra bağlı ve hepsi aynı customerItemName /
 * customerColorName taşıyorsa override kullanılır; biri farklıysa master
 * alias'a düşer.
 */
function allEqual<T extends string | null>(values: T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return null;
  }
  return first;
}
