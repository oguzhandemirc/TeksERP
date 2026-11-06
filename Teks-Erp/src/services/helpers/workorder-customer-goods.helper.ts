// =============================================================================
// FASON (MÜŞTERİ MALI) İŞ EMRİ — `CUSTOMER_GOODS_SERVICE` türünün tek kural kaynağı (2026-11-06)
// =============================================================================
// Müşterinin emanet malına hizmet: sipariş İSTENMEZ (1. turda bağlanamaz da — tip "bağın aynası" kuralı
// yalnız Stok ↔ Sipariş arasında kalır), müşteri İE'nin ÜSTÜNDE ve ZORUNLU (DB CHECK
// `work_orders_customer_goods_customer_check`). Giden fason (Subcontractor / AT_SUBCONTRACTOR) ile ilgisi yok.
// Müşteri sırası: gövdedeki `customerId` > okutulan topların TEK sahibi (`Roll.ownerCustomerId`; gelen belge
// onayı belgenin carisini topa yazar). Hata kodları `details.code`.
// =============================================================================
import { WorkOrderType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { TERIM, TERIM_AD } from "../../constants/terim";
import { readFilterList } from "../../utils/query-parser";

export const CUSTOMER_GOODS = WorkOrderType.CUSTOMER_GOODS_SERVICE;

/** Siparişsiz tür (hedef kumaş zorunlu + varsayılan stok kartı uygulanır): Stok ve Fason (müşteri malı). */
export function isOrderlessWorkOrderType(type: string | null | undefined): boolean {
  return type === WorkOrderType.STOCK_PRODUCTION || type === CUSTOMER_GOODS;
}

/** Fason türünde sipariş kalemi 400 (1. tur; müşteri ↔ sipariş müşterisi uyuşması ayrı karar). */
export function assertCustomerGoodsHasNoOrderLines(type: string | null | undefined, orderLineCount: number): void {
  if (type !== CUSTOMER_GOODS || orderLineCount === 0) return;
  throw AppError.badRequest(`${TERIM_AD.fasonMusteriMali} ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} sipariş kalemi bağlanmaz; müşteri ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} kendisinde durur.`, { code: "WO_CUSTOMER_GOODS_NO_ORDER" });
}

/** Fason türünde müşteri: verilmiş olmalı, var + aktif + birleştirilmemiş. Diğer türlerde null (yazılmaz). */
export async function resolveCreateCustomer(type: string | null | undefined, customerId: string | null | undefined): Promise<string | null> {
  if (type !== CUSTOMER_GOODS) return null;
  if (!customerId) {
    throw AppError.badRequest(`${TERIM_AD.fasonMusteriMali} ${TERIM.terbiyeIsEmri.tekilKucuk} için müşteri seçin — belgeden ya da topların sahibinden bulunamadı.`, { code: "WO_CUSTOMER_REQUIRED" });
  }
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { isActive: true, mergedIntoId: true, name: true } });
  if (!c) throw AppError.badRequest("Seçilen müşteri bulunamadı.", { code: "WO_CUSTOMER_INVALID", customerId });
  if (!c.isActive || c.mergedIntoId) {
    throw AppError.badRequest(`Müşteri '${c.name}' pasif ya da başka kartla birleştirilmiş; güncel müşteriyi seçin.`, { code: "WO_CUSTOMER_INVALID", customerId });
  }
  return customerId;
}

/**
 * Okutulan topların sahibinden müşteri (yalnız Fason türünde). Gövde verildiyse sahiplerle uyuşmalı (emanet başkasının
 * iş emrine yazılamaz); verilmediyse TEK sahip alınır, çok sahip 400 `WO_CUSTOMER_AMBIGUOUS`. Sahipsiz top müşteri vermez.
 */
export function customerFromRollOwners(type: string | null | undefined, given: string | null | undefined, owners: ReadonlyArray<string | null>): string | null {
  if (type !== CUSTOMER_GOODS) return given ?? null;
  const distinct = [...new Set(owners.filter((o): o is string => !!o))];
  if (given) {
    if (distinct.some((o) => o !== given)) {
      throw AppError.badRequest("Okutulan toplar seçilen müşterinin malı değil; topların sahibini seçin ya da topları ayırın.", { code: "WO_CUSTOMER_OWNER_MISMATCH", owners: distinct });
    }
    return given;
  }
  if (distinct.length > 1) {
    throw AppError.badRequest(`Okutulan toplar birden çok müşterinin malı; her müşteri için ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} açın.`, { code: "WO_CUSTOMER_AMBIGUOUS", owners: distinct });
  }
  return distinct[0] ?? null;
}

/** Tür değişimi Fason'a girip çıkamaz (1. tur: mevcut İE'nin türü değiştirilmez). */
export function assertCustomerGoodsTypeFrozen(from: string, to: string | null | undefined): void {
  if (!to || to === from) return;
  if (from === CUSTOMER_GOODS || to === CUSTOMER_GOODS) {
    throw AppError.badRequest(`${TERIM_AD.fasonMusteriMali} türü sonradan değiştirilemez; yeni ${TERIM.terbiyeIsEmri.tekilKucuk} açın.`, { code: "WO_CUSTOMER_GOODS_TYPE_FROZEN" });
  }
}

/** `filter[type]` (CSV/dizi) → Prisma koşulu; boş → null, tanınmayan değer 400 `INVALID_FILTER` (fail-closed). */
export function readWorkOrderTypeFilter(value: string | string[] | undefined): WorkOrderType | { in: WorkOrderType[] } | null {
  const list = readFilterList(value);
  if (list.length === 0) return null;
  const known = Object.values(WorkOrderType) as string[];
  const bad = list.filter((v) => !known.includes(v));
  if (bad.length > 0) {
    throw AppError.badRequest(`Tanınmayan ${TERIM.terbiyeIsEmri.tekilKucuk} türü: ${bad.join(", ")}`, { code: "INVALID_FILTER", field: "type", allowed: known });
  }
  const types = list as WorkOrderType[];
  return types.length === 1 ? types[0]! : { in: types };
}
