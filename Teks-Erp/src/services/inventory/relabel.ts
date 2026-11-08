// =============================================================================
// Inventory Service / relabel
// =============================================================================
// Yeniden etiketleme bağlamı (getRelabelContext).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { ambiguousCustomerCodeError, matchExtras, resolveRollByScanCode } from "../helpers/roll-scan-resolve.helper";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  RollStatus,
  ShipmentStatus,
} from "@prisma/client";

/**
 * Yeniden-Etiketleme istasyonu — "B" müşteri adayı. Topu üreten iş emrinin
 * bağlı sipariş satırlarından distinct müşteriler; operatöre "etiket bu müşteri
 * için yeniden bas" önerisi olarak sunulur. orderLineId = o müşterinin temsil
 * sipariş satırı (müşteriye özel ad override'ı varsa bundan çözülür).
 */
export interface RelabelCandidateCustomer {
  customerId: string;
  customerCode: string;
  customerName: string;
  orderLineId: string;
  orderNumber: string;
}

/**
 * Yeniden-Etiketleme istasyonu için zengin top bağlamı — `findRollByBarcode`'un
 * lean lookup'ından AYRI: relabel formunun seed'i (renk/kalite/en/özellik),
 * konum/guard (sevkiyat/çuval), son basıldığı yer ("A") ve "B" adayları.
 */
export interface RelabelContext {
  id: string;
  barcode: string | null;
  status: RollStatus;
  entrySource: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  colorId: string | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  /** Donmuş kalite snapshot string'i (örn "1.KALITE"); kaliteye bakılmamış açık
   *  kumaşta null — relabel PATCH'i bunu yazar. */
  qualityGrade: string | null;
  qualityGradeId: string | null;
  qualityGradeRef: { id: string; code: string; name: string; color: string | null } | null;
  width: number | null;
  /** KAT — katalog KODU ("6-KAT" / "TUP"); kat girilmemiş topta null. Düzelt
   *  diyaloğu bunu seçici ile düzeltir (kolon, pivot DEĞİL — bkz. applyManualProperties). */
  foldType: string | null;
  /** Müşterinin etikete istediği parti metni (`Roll.labelBatchNo`); yoksa null. */
  labelBatchNo: string | null;
  currentQty: number;
  weightKg: number | null;
  markedForKartela: boolean;
  /** Etiket bayat mı — veri/metraj düzeltilmiş ama fiziksel etiket yeniden basılmamış → true. */
  labelDirty: boolean;
  /** Topta hâlihazırda damgalı özellikler — relabel formu BAYRAK evrenini TAM
   *  liste olarak replace eder; SEÇİM tipliler (value dolu) salt-okunur bilgidir
   *  (backend onlara dokunmaz — 2026-08-11 denetim F1). `value` alanı olmadan
   *  Düzelt diyaloğu "GRAMAJ" çipini gösterir ama HANGİ gramaj olduğunu
   *  gösteremezdi (denetim VAL-02: veri sorgulanıp eşlemede atılıyordu). */
  properties: {
    id: string;
    code: string;
    name: string;
    color: string | null;
    value?: { code: string; name: string } | null;
  }[];
  propertyIds: string[];
  /** Son basılan etiketin künyesi ("A": kime/hangi sipariş/ne zaman) — null=hiç basılmadı/stok. */
  lastLabelSnapshot: Prisma.JsonValue | null;
  /** Atanmış sevkiyat — varsa spec düzenleme kilitlenir (backend de 409). */
  shipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  /** Bulunduğu çuval — sevkiyattaysa (shipmentId) spec düzenleme kilitlenir. */
  sack: { id: string; sackNo: string; seq: number | null; shipmentId: string | null } | null;
  /** Spec düzenleme kilitli mi (atanmış sevkiyat / sevkiyattaki çuval) — frontend kolaylığı; backend guard ayrıca enforce eder. */
  specLocked: boolean;
  /** "B" önerileri — topu üreten WO'nun bağlı siparişlerinden distinct müşteriler. */
  candidateCustomers: RelabelCandidateCustomer[];
  /** Yalnız müşteri koduyla bulunduğunda (D4-F1b); iç barkodda alan yok → yanıt bayt-aynı. */
  matchedBy?: "CUSTOMER_CODE";
  customerCode?: string;
}

export async function getRelabelContext(
    ref: { barcode: string } | { rollId: string },
  ): Promise<ApiResponse<RelabelContext | null>> {
    const load = (where: Prisma.RollWhereUniqueInput) => prisma.roll.findUnique({
      where,
      select: {
        id: true,
        barcode: true,
        status: true,
        entrySource: true,
        itemId: true,
        item: { select: { id: true, code: true, name: true } },
        colorId: true,
        color: { select: { id: true, code: true, name: true, hex: true } },
        qualityGrade: true,
        qualityGradeId: true,
        qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
        width: true,
        foldType: true,
        labelBatchNo: true,
        currentQty: true,
        weightKg: true,
        markedForKartela: true,
        lastLabelSnapshot: true,
        labelDirty: true,
        // Aktif süzgeç ŞART: `propertyIds` istemciye echo edilir ve panel aynen geri
        // yollar — damgalı id burada dönerse replace onu DİRİLTİR.
        properties: {
          where: ACTIVE_ROLL_PROPERTY,
          select: {
            propertyId: true,
            property: { select: { id: true, code: true, name: true, color: true } },
            value: { select: { code: true, name: true } },
          },
        },
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true, shipmentId: true } },
        producedInStep: {
          select: {
            workOrder: {
              select: {
                orderLinks: {
                  where: ACTIVE_ORDER_LINK,
                  // Aday müşteri temsilcisi deterministik olsun: aynı müşterinin
                  // bu WO'da birden çok satırı varsa (farklı override'larla) hep aynı
                  // orderLineId seçilsin — yoksa "first seen" Prisma'da rastgele.
                  orderBy: [{ orderLine: { order: { orderNumber: "asc" } } }, { orderLineId: "asc" }],
                  select: {
                    orderLine: {
                      select: {
                        id: true,
                        order: {
                          select: {
                            orderNumber: true,
                            customer: { select: { id: true, code: true, name: true } },
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
    // Barkod yolu tek okutma boğazından (D4-F1b): iç barkod önce, ayar açıksa müşteri kodu.
    const resolved = "barcode" in ref ? await resolveRollByScanCode(ref.barcode, { load }) : null;
    if (resolved?.kind === "AMBIGUOUS") throw ambiguousCustomerCodeError(resolved);
    const roll = "barcode" in ref ? (resolved?.kind === "FOUND" ? resolved.roll : null) : await load({ id: ref.rollId });

    if (!roll) {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }

    // "B" adayları — topu üreten WO'nun bağlı sipariş satırlarından distinct müşteri.
    // Aynı müşteri birden çok satırda olabilir; ilk görülen satır temsil seçilir.
    const candidateMap = new Map<string, RelabelCandidateCustomer>();
    for (const link of roll.producedInStep?.workOrder?.orderLinks ?? []) {
      const ol = link.orderLine;
      const cust = ol.order.customer;
      if (!candidateMap.has(cust.id)) {
        candidateMap.set(cust.id, {
          customerId: cust.id,
          customerCode: cust.code,
          customerName: cust.name,
          orderLineId: ol.id,
          orderNumber: ol.order.orderNumber,
        });
      }
    }

    // Spec düzenleme kilidi: atanmış sevkiyatta (PLANNED/DISPATCHED) VEYA sevkiyattaki
    // çuvalda → değişiklik donmuş/havuz tahsisini bozar. Açık çuval/serbest serbest.
    const specLocked =
      roll.shipment != null || (roll.sack != null && roll.sack.shipmentId != null);

    return {
      success: true,
      data: {
        id: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        entrySource: roll.entrySource,
        itemId: roll.itemId,
        item: roll.item,
        colorId: roll.colorId,
        color: roll.color,
        qualityGrade: roll.qualityGrade ?? "",
        qualityGradeId: roll.qualityGradeId,
        qualityGradeRef: roll.qualityGradeRef,
        width: roll.width != null ? Number(roll.width) : null,
        foldType: roll.foldType,
        labelBatchNo: roll.labelBatchNo,
        currentQty: Number(roll.currentQty),
        weightKg: roll.weightKg != null ? Number(roll.weightKg) : null,
        markedForKartela: roll.markedForKartela,
        lastLabelSnapshot: roll.lastLabelSnapshot,
        labelDirty: roll.labelDirty,
        properties: roll.properties.map((p) => ({ ...p.property, value: p.value ?? null })),
        propertyIds: roll.properties.map((p) => p.propertyId),
        shipment: roll.shipment,
        sack: roll.sack,
        specLocked,
        candidateCustomers: [...candidateMap.values()],
        ...(resolved?.kind === "FOUND" ? matchExtras(resolved) : {}),
      },
    };
  }
