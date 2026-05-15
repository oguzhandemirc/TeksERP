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
// Aynı sıra color için. Allocation YOK → müşteri bloğu render edilmez (frontend
// customerName=null görünce gizler).
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { CustomerAliasService } from "./customer-alias.service";
import { resolveName, normalizeOverride, NameSource } from "./helpers/customer-name.helper";

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
  packagingDate: string | null;

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

  // Owner customer (SERVICE_PRODUCTION fason rulolar için ayrı kanal)
  ownerCustomerName: string | null;

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
  ownerCustomerName: string | null;
  batchNumber: string | null;
  parentRollBarcode: string | null;
  printedAt: string;
}

export interface UpdateOrderLineCustomerNamesInput {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

const aliasService = new CustomerAliasService();

export class LabelService {
  /**
   * Bir rulonun etiket payload'unu (effective name cascade ile) döner.
   * Allocation 0 → müşteri/sipariş alanları null. Allocation 1 → OrderLine'dan
   * cascade. Çoklu allocation (anomali) → ilki (createdAt asc) alınır.
   */
  async getRollLabel(rollId: string): Promise<ApiResponse<LabelPayload>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        ownerCustomer: { select: { id: true, name: true } },
        producedInStep: {
          select: { workOrder: { select: { batchNumber: true } } },
        },
        allocations: {
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            orderLine: {
              select: {
                id: true,
                customerItemName: true,
                customerColorName: true,
                order: {
                  select: {
                    orderNumber: true,
                    customer: { select: { id: true, name: true } },
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

    const allocation = roll.allocations[0] ?? null;
    const customerId = allocation?.orderLine.order.customer.id ?? null;

    // Master alias lookup — customer + item/color biliniyorsa
    const masterAliases = customerId
      ? await aliasService.lookupAlias(
          customerId,
          roll.item.id,
          roll.color?.id ?? null,
        )
      : { itemAlias: null, colorAlias: null };

    // Item name cascade
    const overrideItem = allocation?.orderLine.customerItemName ?? null;
    const itemNameResolved = resolveName(
      overrideItem,
      masterAliases.itemAlias,
      roll.item.name,
    );

    // Color name cascade (colorId null ise tüm alanlar null)
    let colorName: string | null = null;
    let colorNameDefault: string | null = null;
    let colorNameSource: NameSource | null = null;
    if (roll.color) {
      colorNameDefault = roll.color.name;
      const overrideColor = allocation?.orderLine.customerColorName ?? null;
      const r = resolveName(
        overrideColor,
        masterAliases.colorAlias,
        roll.color.name,
      );
      colorName = r.name;
      colorNameSource = r.source;
    }

    const payload: LabelPayload = {
      rollId: roll.id,
      barcode: roll.barcode,
      status: roll.status,
      qualityGrade: roll.qualityGrade,
      widthCm: roll.width,
      lengthMeters: roll.currentQty,
      weightKg: roll.weightKg,
      packagingDate: roll.packagingDate?.toISOString() ?? null,

      itemCode: roll.item.code,
      itemName: itemNameResolved.name,
      itemNameDefault: roll.item.name,
      itemNameSource: itemNameResolved.source,

      colorCode: roll.color?.code ?? null,
      colorName,
      colorNameDefault,
      colorNameSource,

      customerName: allocation?.orderLine.order.customer.name ?? null,
      customerId,
      orderNumber: allocation?.orderLine.order.orderNumber ?? null,
      orderLineId: allocation?.orderLine.id ?? null,

      ownerCustomerName: roll.ownerCustomer?.name ?? null,

      batchNumber: roll.producedInStep?.workOrder.batchNumber ?? null,
      printedAt: new Date().toISOString(),
    };

    return { success: true, data: payload };
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
   * Kartela (Swatch) etiket payload'u. Müşteri çözümü dolaylı:
   *   parentRoll.allocations[0].orderLine.order.customer
   * Bağ yoksa (kartela bağımsız üretilmiş) müşteri alanları null → frontend
   * müşteri bloğunu render etmez.
   */
  async getSwatchLabel(swatchId: string): Promise<ApiResponse<SwatchLabelPayload>> {
    const sw = await prisma.swatch.findUnique({
      where: { id: swatchId },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        workOrder: { select: { batchNumber: true } },
        parentRoll: {
          select: {
            id: true,
            barcode: true,
            ownerCustomer: { select: { id: true, name: true } },
            allocations: {
              orderBy: { createdAt: "asc" },
              take: 1,
              include: {
                orderLine: {
                  select: {
                    id: true,
                    customerItemName: true,
                    customerColorName: true,
                    order: {
                      select: {
                        orderNumber: true,
                        customer: { select: { id: true, name: true } },
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
    if (!sw) throw AppError.notFound("Kartela bulunamadı");

    const allocation = sw.parentRoll?.allocations[0] ?? null;
    const customerId = allocation?.orderLine.order.customer.id ?? null;

    const masterAliases = customerId
      ? await aliasService.lookupAlias(customerId, sw.item.id, sw.color?.id ?? null)
      : { itemAlias: null, colorAlias: null };

    const itemResolved = resolveName(
      allocation?.orderLine.customerItemName ?? null,
      masterAliases.itemAlias,
      sw.item.name,
    );
    const colorResolved = sw.color
      ? resolveName(
          allocation?.orderLine.customerColorName ?? null,
          masterAliases.colorAlias,
          sw.color.name,
        )
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
      widthCm: sw.width,
      lengthCm: sw.length,
      weightKg: sw.weightKg,
      customerName: allocation?.orderLine.order.customer.name ?? null,
      customerId,
      orderNumber: allocation?.orderLine.order.orderNumber ?? null,
      orderLineId: allocation?.orderLine.id ?? null,
      ownerCustomerName: sw.parentRoll?.ownerCustomer?.name ?? null,
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
