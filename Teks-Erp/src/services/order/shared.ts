// =============================================================================
// Order Service / shared
// =============================================================================
// Ortak yardımcılar, sabitler ve taşınan metotların `this` tipi.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
} from "@prisma/client";
import type { OrderService } from "../order.service";

// MASS-ASSIGNMENT WHITELIST'leri (M-3): route'larda Zod yok (BaseController ham
// body); muhasebe/kimlik alanları (status, shippedQty, completedAt,
// manualClosedById, orderNumber, orderId) istemciden YAZILAMAZ. Statü
// geçişleri yalnız özel endpoint'lerden (cancel, manual-close) ve
// recomputeOrderStatusTx'tan akar (şemadaki "tek yazma noktası" notları).
export const ORDER_HEADER_WRITABLE: ReadonlySet<string> = new Set([
  "customerId",
  "branchId",
  "currency",
  "totalAmount",
  "deadline",
  "orderDate",
]);
export const ORDER_LINE_WRITABLE: ReadonlySet<string> = new Set([
  "itemId",
  "colorId",
  "quantity",
  // Satır birimi (MT/KG/ADET) — gönderilmezse kalem kartından kopyalanır
  // (`resolveLineUnit`); gönderilirse enum'a karşı doğrulanır.
  "unit",
  "unitPrice",
  "width",
  "pieceLengthM",
  "cutNote",
  // Satır sevk toleransı % (K4): `validateLines` normalize eder (null temizler), tamamlanma toleransına katılır.
  "tolerancePct",
  "customerItemName",
  "customerColorName",
  // Varyant (SY-K1k): `prepareOrderLineRecipes` normalize eder ve ürüne aitliğini sınar.
  "recipeId",
]);

// ─── Cancel Akışı Karar Matrisi ─────────────────────────────────────────────
//
// Operatör sipariş iptal ederken, etkilenecek her WO için üç olası aksiyon:
//   - UNLINK_ONLY     : sadece order-WO join'ini sil, WO yaşamaya devam
//   - CONVERT_TO_STOCK: join sil + WO.type = STOCK_PRODUCTION (kalan üretim
//                       stoğa düşer; ORDER_PRODUCTION'dı, müşteri iptal etti)
//   - CANCEL_WO       : WorkOrderService.softDelete (rolls STOCK'a, traveler
//                       VOID, fason kayıtlar sil vb. tam kaskat)
//
// İzin matrisi WO.status + tek/çoklu sipariş durumuna göre değişir.
// "Tek-sipariş" = bu WO'ya bağlı tek sipariş bu — diğer order link yok.

export type CancelAction = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";

export function computeAllowedActions(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction[] {
  if (woStatus === "PLANNED") {
    // Üretim başlamadı; CONVERT/CANCEL anlamsız.
    return ["UNLINK_ONLY"];
  }
  if (woStatus === "COMPLETED") {
    // Üretim bitti, rulolar var. CANCEL_WO yasak (workorder.service zaten
    // reddeder). Tek-sipariş ise CONVERT açık (müşteri kaydı silinir).
    return isSoleOrder ? ["UNLINK_ONLY", "CONVERT_TO_STOCK"] : ["UNLINK_ONLY"];
  }
  if (woStatus === "IN_PROGRESS") {
    return isSoleOrder
      ? ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"]
      : ["UNLINK_ONLY"];
  }
  // CANCELLED WO bağı zaten anlamsız — gelmemesi gerek ama defansif.
  return ["UNLINK_ONLY"];
}

/**
 * Varsayılan aksiyon — İZİNLİ LİSTEDEN TÜRETİLİR, ayrı yazılmaz.
 *
 * ⚠️ Bu iki fonksiyon eskiden BAĞIMSIZDI ve sessizce ayrıştılar (BULGU-T2-005):
 * İPTAL EDİLMİŞ iş emrine bağlı tek-siparişli bir siparişte izinli liste
 * `["UNLINK_ONLY"]` iken varsayılan `CONVERT_TO_STOCK` dönüyordu. Arayüz izinli
 * aksiyon tek olduğu için seçim kutusunu ÇİZMİYOR, dolayısıyla istemci bir şey
 * göndermiyor, sunucu da varsayılana düşüyordu → "CONVERT_TO_STOCK geçersiz"
 * 400'ü. Yenilemek işe yaramıyordu: sipariş HİÇBİR yoldan iptal edilemiyordu ve
 * sonsuza dek "açık talep" sayılıyordu (prod'da 2 canlı sipariş bu durumdaydı;
 * tek çıkış DB'ye elle müdahaleydi).
 *
 * Tercih hâlâ ifade edilir ("en sık vaka: malı stoğa al") ama izinli değilse
 * listenin ilkine düşer — yani ayrışma YAPISAL OLARAK imkânsız.
 */
export function pickDefaultAction(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction {
  const allowed = computeAllowedActions(woStatus, isSoleOrder);
  const tercih: CancelAction =
    woStatus === "PLANNED" ? "UNLINK_ONLY" : isSoleOrder ? "CONVERT_TO_STOCK" : "UNLINK_ONLY";
  return allowed.includes(tercih) ? tercih : allowed[0];
}

/**
 * Lines üzerinden totalAmount hesaplar. unitPrice null olan satırlar toplama
 * dahil edilmez (kasıtlı: "fiyatlandırılmamış" kalemleri 0 saymak yanıltıcı).
 * Hiç satırın fiyatı yoksa null döner — sipariş "fiyatsız" sayılır.
 */
export function computeTotalAmount(
  lines: Array<{ quantity?: number; unitPrice?: number | null | string }>
): number | null {
  // Fiyatlandırma Decimal aritmetik ile — float drift faturada kuruş kayması yaratmasın.
  let total = new Prisma.Decimal(0);
  let any = false;
  for (const l of lines) {
    if (l.unitPrice == null) continue;
    const qtyRaw = Number(l.quantity ?? 0);
    const priceRaw =
      typeof l.unitPrice === "string" ? Number(l.unitPrice) : l.unitPrice;
    if (!Number.isFinite(qtyRaw) || !Number.isFinite(priceRaw)) continue;
    total = total.plus(new Prisma.Decimal(qtyRaw).times(priceRaw as number));
    any = true;
  }
  return any ? Number(total.toFixed(2)) : null;
}

export function withExtraWarnings<T>(res: ApiResponse<T>, extra: string[]): ApiResponse<T> {
  if (extra.length === 0) return res;
  return { ...res, warnings: [...(res.warnings ?? []), ...extra] };
}

export type SiparisSatiri = { itemId: unknown; colorId?: unknown; width?: unknown; quantity: unknown };
/** Sipariş replay'inin satır izi (create + hızlı sipariş TEK kaynak): ürün · renk · en · miktar, Decimal 3 hane, sırasız. */
export function siparisSatirIzi(satirlar: ReadonlyArray<SiparisSatiri>): string {
  const d3 = (v: unknown) => (v == null || v === "" ? "" : new Prisma.Decimal(v as Prisma.Decimal.Value).toFixed(3));
  return satirlar.map((l) => `${l.itemId}|${l.colorId ?? ""}|${d3(l.width)}|${d3(l.quantity)}`).sort().join(";");
}

/** Detay yanıtının renk adı çözümüne giren parçası (defaultInclude şekli). */
export type OrderWithLines = {
  customerId: string;
  lines?: Array<{
    itemId: string;
    colorId: string | null;
    customerColorName: string | null;
    resolvedCustomerColorName?: string | null;
    colorNameScope?: string | null;
  }>;
};

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar (private üyeler
 * indeksli erişim tipiyle okunur).
 */
export type OrderServiceThis = Pick<OrderService, "findById" | "finishOrderCreate" | "getCancelPreview" | "getLineCancelPreview" | "insertPreparedOrderTx" | "prepareOrderCreate" | "softDelete"> & {
  aliasService: OrderService["aliasService"];
  assertDeadlineNotBeforeOrderDate: OrderService["assertDeadlineNotBeforeOrderDate"];
  assertLineRefsLive: OrderService["assertLineRefsLive"];
  assertNoActiveShipments: OrderService["assertNoActiveShipments"];
  assertValidCurrency: OrderService["assertValidCurrency"];
  buildListWhere: OrderService["buildListWhere"];
  computeInProdBySpec: OrderService["computeInProdBySpec"];
  config: OrderService["config"];
  findOrderByToken: OrderService["findOrderByToken"];
  gateOrderWhereFilters: OrderService["gateOrderWhereFilters"];
  getActiveShipmentLinks: OrderService["getActiveShipmentLinks"];
  insertOrderTx: OrderService["insertOrderTx"];
  insertPreparedOrder: OrderService["insertPreparedOrder"];
  kumasaOzelRenkCiftleri: OrderService["kumasaOzelRenkCiftleri"];
  loadLineForCancel: OrderService["loadLineForCancel"];
  nextOrderNumber: OrderService["nextOrderNumber"];
  orderReplay: OrderService["orderReplay"];
  prepareLineVariants: OrderService["prepareLineVariants"];
  promoteCustomerAliases: OrderService["promoteCustomerAliases"];
  quickOrderReplay: OrderService["quickOrderReplay"];
  quickOrderTx: OrderService["quickOrderTx"];
  resolveLineUnit: OrderService["resolveLineUnit"];
  safeSortBy: OrderService["safeSortBy"];
  validateBranch: OrderService["validateBranch"];
  validateCustomer: OrderService["validateCustomer"];
  validateLineColors: OrderService["validateLineColors"];
  validateLineItems: OrderService["validateLineItems"];
  validateLines: OrderService["validateLines"];
  withResolvedColorNames: OrderService["withResolvedColorNames"];
  withUnitWarnings: OrderService["withUnitWarnings"];
};
