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
import { LabelKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { resolveName, normalizeOverride, NameSource } from "./helpers/customer-name.helper";
import { buildRollLabelHtml } from "./helpers/label-html.helper";

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
  lengthCm: number;
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
  async getRollLabel(rollId: string): Promise<ApiResponse<LabelPayload>> {
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
    const links = roll.producedInStep?.workOrder?.orderLinks ?? [];
    const customerIds = new Set(links.map((l) => l.orderLine.order.customerId));
    const sameCustomer = links.length > 0 && customerIds.size === 1;

    let customerId: string | null = null;
    let customerName: string | null = null;
    let orderNumber: string | null = null;
    let orderLineId: string | null = null;
    let itemOverride: string | null = null;
    let colorOverride: string | null = null;
    let itemMasterAlias: string | null = null;
    let colorMasterAlias: string | null = null;

    if (sameCustomer) {
      const first = links[0];
      customerId = first.orderLine.order.customerId;
      customerName = first.orderLine.order.customer.name;

      if (links.length === 1) {
        orderNumber = first.orderLine.order.orderNumber;
        orderLineId = first.orderLine.id;
      }

      // Override: tüm satırlarda aynı değer (veya hepsi null) ise kullan.
      itemOverride = allEqual(links.map((l) => l.orderLine.customerItemName));
      colorOverride = allEqual(links.map((l) => l.orderLine.customerColorName));

      // Master alias'lar — customer × item / customer × color (yoksa null).
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
   * renksiz + STOCK + SUPPLIER_RECEIPT → ROLL_RAW, aksi halde ROLL_FINISHED.
   * Caller `?kind=` ile override edebilir.
   */
  async getRollLabelHtml(
    rollId: string,
    kindOverride?: LabelKind,
  ): Promise<ApiResponse<{ html: string; kind: LabelKind }>> {
    const payloadResp = await this.getRollLabel(rollId);
    const payload = payloadResp.data;

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { colorId: true, entrySource: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const kind: LabelKind =
      kindOverride ??
      (roll.colorId == null &&
      roll.entrySource === "SUPPLIER_RECEIPT" &&
      roll.status === "STOCK"
        ? LabelKind.ROLL_RAW
        : LabelKind.ROLL_FINISHED);

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

    const html = buildRollLabelHtml({ payload, template, barcodeSvg, qrSvg });
    return { success: true, data: { html, kind } };
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
        parentRoll: {
          select: {
            id: true,
            barcode: true,
          },
        },
      },
    });
    if (!sw) throw AppError.notFound("Kartela bulunamadı");

    // Müşteri context: getRollLabel ile aynı mantık. Tek müşteri (1+ satır)
    // → customer çöz; orderNumber/orderLineId yalnız tek satırda set edilir.
    const links = sw.workOrder?.orderLinks ?? [];
    const customerIds = new Set(links.map((l) => l.orderLine.order.customerId));
    const sameCustomer = links.length > 0 && customerIds.size === 1;

    let customerId: string | null = null;
    let customerName: string | null = null;
    let orderNumber: string | null = null;
    let orderLineId: string | null = null;
    let itemOverride: string | null = null;
    let colorOverride: string | null = null;
    let itemMasterAlias: string | null = null;
    let colorMasterAlias: string | null = null;

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

      const itemAlias = await prisma.customerItemAlias.findUnique({
        where: {
          customerId_itemId: { customerId, itemId: sw.item.id },
        },
        select: { alias: true },
      });
      itemMasterAlias = itemAlias?.alias ?? null;

      if (sw.color) {
        const colorAlias = await prisma.customerColorAlias.findUnique({
          where: {
            customerId_colorId: { customerId, colorId: sw.color.id },
          },
          select: { alias: true },
        });
        colorMasterAlias = colorAlias?.alias ?? null;
      }
    }

    const itemResolved = resolveName(
      itemOverride,
      itemMasterAlias,
      sw.item.name,
    );
    const colorResolved = sw.color
      ? resolveName(colorOverride, colorMasterAlias, sw.color.name)
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
      lengthCm: Number(sw.length),
      weightKg: sw.weightKg !== null ? Number(sw.weightKg) : null,
      customerName,
      customerId,
      orderNumber,
      orderLineId,
      batchNumber: sw.workOrder?.batchNumber ?? null,
      parentRollBarcode: sw.parentRoll?.barcode ?? null,
      printedAt: new Date().toISOString(),
    };

    return { success: true, data: payload };
  }

  /**
   * Etiket basıldı — sadece audit izi (gerçek baskı tarayıcıda olur).
   * label:print yetkisi gerekir (route katmanında).
   */
  async recordPrintEvent(rollId: string, userId?: string): Promise<ApiResponse<{ recorded: true }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

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
