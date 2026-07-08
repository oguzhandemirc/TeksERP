// =============================================================================
// Shipping Service — Sevkiyat oturumu (Shipment) + Çuval (Sack = tartı)
// =============================================================================
// GEVŞEK MODEL (top→sipariş bağı YOK) + ÇUVAL-ÖNCE paketleme. Akış:
//   1) Sipariş seç → createShipment(orderIds)        → PREPARING (tek müşteri+şube)
//   2) Çuval aç → addSack()                          → Sack (boş; brüt tartı sonra)
//   3) Topları O çuvala okut → scanIntoShipment(sackId) → Roll.shipmentId + Roll.sackId
//   4) Çuvalı brüt tart + kod gir → updateSack(weightKg, manualCode); moveRollToSack ile aktar
//   5) Sevke Hazır → markReady                       → READY (rezerve): her top+kartela çuvalda &
//      her çuval tartılı + KODLU (invariant). Stok/karşılanma DÜŞMEZ — ara depoda/kapıda bekler.
//   6) Sevk/çıkış → dispatchShipment (PREPARING "Hemen Sevk Et" veya READY "Çıkış Ver") → DISPATCHED:
//      spec-toplam termin→tarih FIFO dağıtılır (ShipmentAllocation + OrderLine.shippedQty), toplar
//      SHIPPED, recompute — stok yalnız burada düşer.
//   İptal → cancelShipment (PREPARING/READY): top+çuval bağı kopar, depoda kalır (karşılanmaya dokunmaz).
//
// Karşılanma "hangi top hangi siparişe" değil "aynı tür sipariş ↔ aynı tür top" metraj
// toplamıdır. Çuval İÇERİK tutar (Roll/Swatch.sackId) → irsaliyede ürün-bazlı döküm.
// =============================================================================

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  ShipmentDestination,
  OrderStatus,
  PrintedDocType,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import {
  renderShipmentDispatchHtml,
  type ShipmentDispatchDoc,
} from "./document-render/shipment-dispatch.html";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { recomputeOrderStatusForOrders, touchOrderLinesTx } from "./helpers/order-status.helper";
import {
  touchShipmentPreparingTx as touchPreparingTx,
  touchShipmentEditableTx as touchEditableTx,
} from "./helpers/shipment-locks.helper";
import { readShipmentConfirmationEnabled } from "./system-setting.service";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
  buildTurkishSearch,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Sevkiyat liste filtreleri (Electron FilterBar + arama). Top-level skaler alanlar —
// `buildWhereClause` OR-contains'i bu alanlarda çalışır. Tarih alanları whitelist'i
// `applyDateRange` ile: createdAt indexli (`[status, createdAt]`), diğerleri tarih
// penceresiyle sınırlı.
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier"];
// F105: listShipments filter[] whitelist'i (resolveSortBy disiplinine paralel) —
// whitelist-dışı ?filter[x]= sessizce düşer, keyfi kolon where'e sızmaz.
const SHIPMENT_FILTER_FIELDS = ["status", "customerId", "branchId"] as const;
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt", "readyAt"] as const;

// ---------------------------------------------------------------------------
// Sequence helpers — SVK-YYMMDD-NNN (sevkiyat), CV-YYMMDD-NNN (çuval)
// ---------------------------------------------------------------------------
function datePrefix(prefix: string): string {
  const now = new Date();
  return (
    prefix +
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-"
  );
}

// Günlük sıralı numara üretimi — collation tuzağı (CI'da 6 sevkiyat testi patlattı).
// Eski üst sınır `lt: prefix + "￿"` U+FFFF'i "en yüksek karakter" varsayardı; bu
// macOS libc'de doğru ama Linux glibc (CI + Windows-dışı sunucu) altında U+FFFF
// noncharacter IGNORABLE sayılır → "prefix￿" ≈ "prefix" → aralık "prefix###"
// satırlarını DIŞLAR → findFirst hep null → seq hep 1 → INSERT'te @unique P2002 →
// withBarcodeRetry 5 denemede kalıcı 409 (yerelde macOS olduğu için gizliydi).
// Daha öncesinde de salt `startsWith` denenmiş ama (a) tek başına lexicographic
// `orderBy desc` 999'dan sonra "999"u görüp aynı no üretiyordu, (b) ICU'da seq scan.
// NİHAİ fix — collation-implementasyon-bağımsız + index-dostu, ikisini de çözer:
//   • `gte: prefix`  → mevcut unique index Index Scan ile sürülür ve yalnız
//                       bugünün satırları döner (önceki gün daha küçük sıralanır,
//                       gelecek gün yok). Alt sınır `>=` her collation'da güvenli.
//   • `startsWith`   → LIKE 'prefix%' collation'dan bağımsız tam-prefix filtresi;
//                       prefix'ten yüksek sıralanan serbest-form/manuel kodları eler.
//   • orderBy createdAt desc + numeric tail → gün içi monotonik, 1000+ doğru devam.
async function nextShipmentNo(): Promise<string> {
  const prefix = datePrefix("SVK-");
  const last = await prisma.shipment.findFirst({
    where: { shipmentNo: { gte: prefix, startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { shipmentNo: true },
  });
  const seq = last ? parseInt(last.shipmentNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

async function nextSackNo(): Promise<string> {
  const prefix = datePrefix("CV-");
  const last = await prisma.sack.findFirst({
    where: { sackNo: { gte: prefix, startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { sackNo: true },
  });
  const seq = last ? parseInt(last.sackNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Spec eşleştirme + FIFO tahsis simülasyonu (saf — hem önizleme hem yazma kullanır)
// ---------------------------------------------------------------------------
const D0 = () => new Prisma.Decimal(0);

// NOT: RollSpec/LineForAlloc/specMatch/allocate export edilir — fasondan doğrudan
// sevk önizlemesi (subcontractor.service.previewDirectShip) aynı FIFO/spec-eşleşme
// mantığını yeniden kullanır (tek karşılanma kaynağı; kopya algoritma yok).
export interface RollSpec {
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  currentQty: Prisma.Decimal;
}
export interface LineForAlloc {
  id: string;
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  shippedQty: Prisma.Decimal;
  deadline: Date | null;
  orderDate: Date;
  lineCreatedAt: Date;
}

// item kesin; renk/en ikisi de doluysa eşit olmalı, biri null ise gevşek eşleşir.
export function specMatch(
  a: { itemId: string; colorId: string | null; width: Prisma.Decimal | null },
  b: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }
): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  if (
    a.width != null &&
    b.width != null &&
    !new Prisma.Decimal(a.width).equals(new Prisma.Decimal(b.width))
  ) {
    return false;
  }
  return true;
}

/**
 * Spec-toplam → seçilen sipariş satırlarına termin→sipariş tarihi→satır FIFO dağıt.
 * Her satır (quantity − shippedQty) kadar doldurulur; havuz biterse eksik kalır,
 * artarsa "fazla sevk" (tahsis edilmez). Saf fonksiyon — hem canlı önizleme
 * (getShipmentById) hem yazma (markReady) aynı sonucu üretir.
 */
// Spec havuzu (exact key itemId|colorId|width) — toplam okutulan metrajı gruplar.
function buildPool(rolls: RollSpec[]) {
  const pool: { itemId: string; colorId: string | null; width: Prisma.Decimal | null; remaining: Prisma.Decimal }[] = [];
  const poolByKey = new Map<string, (typeof pool)[number]>();
  for (const r of rolls) {
    const key = `${r.itemId}|${r.colorId ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
    let e = poolByKey.get(key);
    if (!e) {
      e = { itemId: r.itemId, colorId: r.colorId, width: r.width, remaining: D0() };
      poolByKey.set(key, e);
      pool.push(e);
    }
    e.remaining = e.remaining.plus(r.currentQty);
  }
  return pool;
}

// Satır FIFO: termin → sipariş tarihi → satır oluşturma.
function lineFifoCmp(a: LineForAlloc, b: LineForAlloc): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  const ao = a.orderDate.getTime();
  const bo = b.orderDate.getTime();
  if (ao !== bo) return ao - bo;
  return a.lineCreatedAt.getTime() - b.lineCreatedAt.getTime();
}

export function allocate(rolls: RollSpec[], lines: LineForAlloc[]): Map<string, Prisma.Decimal> {
  const pool = buildPool(rolls);
  const sorted = [...lines].sort(lineFifoCmp);

  const result = new Map<string, Prisma.Decimal>();
  for (const line of sorted) {
    let need = Prisma.Decimal.max(0, line.quantity.minus(line.shippedQty));
    if (need.lessThanOrEqualTo(0)) continue;
    let alloc = D0();
    for (const e of pool) {
      if (need.lessThanOrEqualTo(0)) break;
      if (e.remaining.lessThanOrEqualTo(0)) continue;
      if (!specMatch(e, line)) continue;
      const take = Prisma.Decimal.min(need, e.remaining);
      e.remaining = e.remaining.minus(take);
      need = need.minus(take);
      alloc = alloc.plus(take);
    }
    if (alloc.greaterThan(0)) result.set(line.id, alloc);
  }
  return result;
}

/**
 * GÖSTERİM için GERÇEK okutulan metraj — satır başına KAPSIZ (uncapped). allocate
 * satırı `need`'de kapatıp fazlalığı düşürür (commit/karşılanma için doğru); ama operatör
 * "okutulan 100 / istenen 50" gibi GERÇEK rakamı görmeli (fazla da az da). Bu fonksiyon:
 *   1) Capped greedy ile (allocate'le aynı sıra) okutulanı satıra düşür.
 *   2) Kalan pool'u (overflow) eşleşen satırlara origNeed payına göre dağıt (tek satırsa
 *      tamamı o satıra) → toplam okutulan = toplam taranan (eşleşen spec'ler).
 * Hiçbir satıra uymayan top (yabancı) satır görünümünde yer almaz (çuval içeriğinde görünür).
 */
function computeLoadedByLine(rolls: RollSpec[], lines: LineForAlloc[]): Map<string, Prisma.Decimal> {
  const pool = buildPool(rolls);
  const sorted = [...lines].sort(lineFifoCmp);
  const need = new Map<string, Prisma.Decimal>();
  for (const l of sorted) need.set(l.id, Prisma.Decimal.max(0, l.quantity.minus(l.shippedQty)));

  const loaded = new Map<string, Prisma.Decimal>();
  const add = (id: string, q: Prisma.Decimal) => loaded.set(id, (loaded.get(id) ?? D0()).plus(q));

  // 1) Capped kısım — allocate ile birebir.
  for (const line of sorted) {
    let rem = need.get(line.id)!;
    if (rem.lessThanOrEqualTo(0)) continue;
    for (const e of pool) {
      if (rem.lessThanOrEqualTo(0)) break;
      if (e.remaining.lessThanOrEqualTo(0)) continue;
      if (!specMatch(e, line)) continue;
      const take = Prisma.Decimal.min(rem, e.remaining);
      e.remaining = e.remaining.minus(take);
      rem = rem.minus(take);
      add(line.id, take);
    }
  }

  // 2) Overflow — kalan pool'u eşleşen satırlara dağıt (son satıra kalanı vererek drift'i önle).
  for (const e of pool) {
    if (e.remaining.lessThanOrEqualTo(0)) continue;
    const matching = sorted.filter((l) => specMatch(e, l));
    if (matching.length === 0) continue;
    const totalNeed = matching.reduce((s, l) => s.plus(need.get(l.id) ?? D0()), D0());
    let dist = D0();
    matching.forEach((l, i) => {
      const last = i === matching.length - 1;
      const share = last
        ? e.remaining.minus(dist)
        : totalNeed.greaterThan(0)
          ? e.remaining.times(need.get(l.id)!).dividedBy(totalNeed)
          : e.remaining.dividedBy(matching.length);
      dist = dist.plus(share);
      add(l.id, share);
    });
  }
  return loaded;
}

export class ShippingService {
  // =========================================================================
  // SEVKİYAT OTURUMU — oluştur / liste / detay
  // =========================================================================

  /**
   * Yeni sevkiyat oturumu — seçilen siparişlerden müşteri+şube türetilir.
   * Tüm siparişler aynı müşteri + aynı şube + açık olmalı (tek oturum = tek alıcı).
   */
  async createShipment(
    data: { orderIds: string[]; destination?: ShipmentDestination; procedureCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const orderIds = [...new Set(data.orderIds)];
    if (orderIds.length === 0) throw AppError.badRequest("En az bir sipariş seçilmeli");

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, customerId: true, branchId: true, status: true },
    });
    if (orders.length !== orderIds.length) throw AppError.notFound("Bazı siparişler bulunamadı");

    const closed = orders.find(
      (o) => o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED
    );
    if (closed) {
      throw AppError.badRequest(`Kapalı sipariş seçilemez: ${closed.orderNumber}`);
    }

    const customerId = orders[0].customerId;
    const branchId = orders[0].branchId ?? null;
    const mixed = orders.some(
      (o) => o.customerId !== customerId || (o.branchId ?? null) !== branchId
    );
    if (mixed) {
      throw AppError.badRequest(
        "Tek sevkiyat = tek müşteri + tek şube. Seçilen siparişler aynı müşteri/şubeye ait olmalı."
      );
    }

    // Tek aktif sevkiyat (F103): bir açık sipariş aynı anda yalnız bir
    // PREPARING/READY/AT_DOOR sevkiyatta olabilir. Bunu DB seddi (partial unique
    // shipment_orders_active_order_uq = orderId WHERE isActive) atomik zorluyor.
    // alreadyIn = dostça hızlı ön-kontrol (net mesaj); yarış penceresinde ikinci
    // istek partial unique'ten P2002 alır → aşağıda 409'a çevrilir. (Eski serileştirme
    // kilidi kaldırıldı — DB seddi geldi.)
    const ACTIVE_ORDER_UQ = "shipment_orders_active_order_uq";
    const isActiveOrderConflict = (err: unknown): boolean =>
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      JSON.stringify(err.meta ?? "").includes(ACTIVE_ORDER_UQ);
    let shipment;
    try {
      shipment = await withBarcodeRetry(
        async () => {
          const alreadyIn = await prisma.shipmentOrder.findFirst({
            where: {
              orderId: { in: orderIds },
              shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY, ShipmentStatus.AT_DOOR] } },
            },
            select: { orderId: true, shipment: { select: { shipmentNo: true } } },
          });
          if (alreadyIn) {
            const ordNo = orders.find((o) => o.id === alreadyIn.orderId)?.orderNumber ?? "";
            throw AppError.conflict(
              `Sipariş ${ordNo} zaten bir sevkiyatta (${alreadyIn.shipment.shipmentNo}) — onu sürdür.`
            );
          }
          const shipmentNo = await nextShipmentNo();
          return prisma.shipment.create({
            data: {
              shipmentNo,
              customerId,
              branchId,
              status: ShipmentStatus.PREPARING,
              destination: data.destination ?? ShipmentDestination.DOMESTIC, // saha #19: yurtiçi default
              procedureCode: data.procedureCode?.trim() || null, // saha #21
              orders: { create: orderIds.map((orderId) => ({ orderId })) },
            },
            select: { id: true, shipmentNo: true, status: true, destination: true },
          });
        },
        undefined,
        // F103: active-order partial unique P2002'yi RETRY ETME (koleksiyon kalıcı,
        // retry boşa döner) → propagate olsun, aşağıda 409'a çevrilir. shipmentNo
        // P2002 (yeni numara üretir) ise retry edilir — varsayılan davranış.
        (err) => !isActiveOrderConflict(err),
      );
    } catch (err) {
      // Yarış penceresi: alreadyIn geçti ama eşzamanlı bir create partial unique'i
      // önce doldurdu → siparişlerden biri zaten aktif sevkiyatta.
      if (isActiveOrderConflict(err)) {
        throw AppError.conflict(
          "Bu siparişlerden biri az önce başka bir sevkiyata eklendi — sayfayı yenileyip tekrar deneyin."
        );
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: shipment.id,
      newData: { shipmentNo: shipment.shipmentNo, customerId, branchId, orderIds, destination: shipment.destination },
    });

    return { success: true, data: shipment, message: `Sevkiyat açıldı: ${shipment.shipmentNo}` };
  }

  /**
   * Yurtiçi/yurtdışı kapsamını değiştir (saha #19). Sevk edilmemiş her durumda
   * serbest: commit/kapsama etkilenmez. DOMESTIC→EXPORT geçişinde tartısız çuval
   * varsa sevk, invariant gereği yeniden tartıya kadar bloklanır (bilinçli).
   */
  async setDestination(
    shipmentId: string,
    destination: ShipmentDestination,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    await prisma.$transaction(async (tx) => {
      await this.touchShipmentEditableTx(tx, shipmentId); // sevk edilmişse 409
      await tx.shipment.update({ where: { id: shipmentId }, data: { destination } });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "DESTINATION", destination },
    });
    return {
      success: true,
      data: { shipmentId, destination },
      message: destination === ShipmentDestination.EXPORT ? "Yurtdışı sevk olarak işaretlendi" : "Yurtiçi sevk olarak işaretlendi",
    };
  }

  /**
   * Sevkiyata özel prosedür/ihracat kodu güncelle (saha #21). Boş → temizler
   * (ekranlar müşteri/şube `code`'una düşer). Sevk edilmemiş her durumda serbest.
   */
  async setProcedureCode(
    shipmentId: string,
    procedureCode: string | null,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const code = procedureCode?.trim() || null;
    await prisma.$transaction(async (tx) => {
      await this.touchShipmentEditableTx(tx, shipmentId); // sevk edilmişse 409
      await tx.shipment.update({ where: { id: shipmentId }, data: { procedureCode: code } });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "PROCEDURE_CODE", procedureCode: code },
    });
    return { success: true, data: { shipmentId, procedureCode: code }, message: "Prosedür kodu güncellendi" };
  }

  /** Açık sevkiyata sipariş ekle (aynı müşteri+şube, açık, PREPARING). */
  async addOrders(
    shipmentId: string,
    orderIds: string[],
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) throw AppError.badRequest("Sipariş seçilmeli");

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, customerId: true, branchId: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata sipariş eklenebilir");
    }

    const orders = await prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, customerId: true, branchId: true, status: true },
    });
    if (orders.length !== ids.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED) {
        throw AppError.badRequest(`Kapalı sipariş eklenemez: ${o.orderNumber}`);
      }
      if (o.customerId !== shipment.customerId || (o.branchId ?? null) !== (shipment.branchId ?? null)) {
        throw AppError.badRequest(`Sipariş bu sevkiyatın müşteri/şubesine ait değil: ${o.orderNumber}`);
      }
    }

    // Başka bir aktif sevkiyatta olan sipariş eklenemez (tek aktif sevkiyat kuralı).
    const alreadyIn = await prisma.shipmentOrder.findFirst({
      where: {
        orderId: { in: ids },
        shipmentId: { not: shipmentId },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY, ShipmentStatus.AT_DOOR] } },
      },
      select: { shipment: { select: { shipmentNo: true } } },
    });
    if (alreadyIn) {
      throw AppError.conflict(`Sipariş zaten başka bir sevkiyatta (${alreadyIn.shipment.shipmentNo}).`);
    }

    await prisma.$transaction(async (tx) => {
      await this.touchShipmentPreparingTx(tx, shipmentId); // M-2: finalize ile serileş
      await tx.shipmentOrder.createMany({
        data: ids.map((orderId) => ({ shipmentId, orderId })),
        skipDuplicates: true,
      });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "ADD_ORDERS", orderIds: ids },
    });
    return { success: true, data: {}, message: "Sipariş(ler) eklendi" };
  }

  /** Sevkiyattan sipariş çıkar (PREPARING). */
  async removeOrder(
    shipmentId: string,
    orderId: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyattan sipariş çıkarılabilir");
    }
    await prisma.$transaction(async (tx) => {
      await this.touchShipmentPreparingTx(tx, shipmentId); // M-2: finalize ile serileş
      await tx.shipmentOrder.deleteMany({ where: { shipmentId, orderId } });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "REMOVE_ORDER", orderId },
    });
    return { success: true, data: {}, message: "Sipariş çıkarıldı" };
  }

  /**
   * Saha #7: sevkiyatı YENİDEN HEDEFLE — bağlı sipariş kümesini TAMAMEN değiştir
   * (replace). Gevşek model: toplar siparişe bağlı değil; "hedefleme" = karşılanma
   * spec-set'ini (hangi siparişlere sayılacağı) değiştirmek. PREPARING'de düz set;
   * READY/AT_DOOR'da commit GERİ SARILIR → set değişir → TAZE içerikle yeniden
   * commit edilir (eski siparişlerin shippedQty'si düşer, yenilere yazılır).
   * DISPATCHED değiştirilemez (stok çıkmış, irsaliye donmuş).
   */
  async retargetOrders(
    shipmentId: string,
    orderIds: string[],
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir sipariş seçilmeli");

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, customerId: true, branchId: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED || shipment.status === ShipmentStatus.CANCELLED) {
      throw AppError.conflict("Sevk edilmiş/iptal sevkiyatın siparişleri değiştirilemez");
    }

    // Hedef siparişler: var + aynı müşteri/şube + kapalı değil.
    const orders = await prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, customerId: true, branchId: true, status: true },
    });
    if (orders.length !== ids.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.customerId !== shipment.customerId || (o.branchId ?? null) !== (shipment.branchId ?? null)) {
        throw AppError.badRequest(`Sipariş ${o.orderNumber} sevkiyatın müşteri/şubesine ait değil`);
      }
      if (o.status === "CANCELLED" || o.status === "COMPLETED") {
        throw AppError.badRequest(`Kapalı sipariş hedeflenemez: ${o.orderNumber}`);
      }
    }
    // Başka aktif sevkiyatta olan sipariş hedeflenemez.
    const elsewhere = await prisma.shipmentOrder.findFirst({
      where: {
        orderId: { in: ids },
        shipmentId: { not: shipmentId },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY, ShipmentStatus.AT_DOOR] } },
      },
      select: { shipment: { select: { shipmentNo: true } } },
    });
    if (elsewhere) {
      throw AppError.conflict(`Sipariş zaten başka bir sevkiyatta (${elsewhere.shipment.shipmentNo}).`);
    }

    await prisma.$transaction(async (tx) => {
      const lockedStatus = await this.touchShipmentEditableTx(tx, shipmentId);
      const committed = lockedStatus !== ShipmentStatus.PREPARING;
      // Commit'liyse önce eski tahsisi geri sar (eski siparişlerin shippedQty'si düşsün).
      if (committed) {
        const allocations = await tx.shipmentAllocation.findMany({
          where: { shipmentId },
          select: { orderLineId: true, qty: true },
        });
        const oldOrders = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
        await this.reverseCommitTx(tx, shipmentId, allocations, oldOrders.map((o) => o.orderId));
      }
      // Sipariş kümesini replace et.
      await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
      await tx.shipmentOrder.createMany({ data: ids.map((orderId) => ({ shipmentId, orderId })) });
      // Commit'liyse yeni kümeyle taze commit.
      if (committed) {
        const fresh = await this.loadShipmentForFinalize(shipmentId, tx);
        if (!fresh) throw AppError.notFound("Sevkiyat bulunamadı");
        const { alloc, orderIds: freshOrderIds } = this.computeShipmentAllocation(fresh);
        await this.commitGoodsTx(tx, shipmentId, alloc, freshOrderIds);
      }
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "RETARGET_ORDERS", orderIds: ids },
    });
    return { success: true, data: { shipmentId, orderIds: ids }, message: "Sevkiyat yeniden hedeflendi" };
  }

  /**
   * Saha #7 (artımlı): retargetOrders'ın SALT-OKUNUR önizlemesi. Operatör sipariş
   * kümesini değiştirirken, COMMIT ETMEDEN ÖNCE karşılanma projeksiyonunu görür —
   * "bu kümeyi seçersem hangi sipariş ne kadar karşılanır, fazla mal kalır mı".
   *
   * DB'YE HİÇBİR ŞEY YAZMAZ (create/update/delete yok, AuditService.log yok). Projeksiyon
   * = `retargetOrders`'ın gerçek commit sonucuyla BİREBİR aynı (saf `allocate` aynen
   * kullanılır). Çift-sayım önleme: bu sevkiyat zaten commit'liyse (READY/AT_DOOR),
   * kendi ShipmentAllocation katkısını her satırın shippedQty'sinden geri indirir —
   * yani "bu sevkiyat henüz commit etmemiş gibi" hesaplar (recommit'in reverse'ünün
   * salt-okunur eşdeğeri). DISPATCHED/CANCELLED'da `editable:false` döner (hata atmaz).
   */
  async previewRetargetOrders(
    shipmentId: string,
    candidateOrderIds: string[]
  ): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(candidateOrderIds)];

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        customerId: true,
        branchId: true,
        rolls: {
          select: { itemId: true, colorId: true, width: true, currentQty: true, status: true },
        },
        allocations: { select: { orderLineId: true, qty: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // Önizleme bilgilendiricidir — sevk/iptal sevkiyatta da projeksiyon dönülür,
    // yalnız `editable:false` bayrağıyla işaretlenir (retarget butonu UI'da gizli).
    const editable =
      shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED;

    // Aday siparişleri yükle — yalnız GEÇERLİ olanlar tahsise katılır (aynı
    // müşteri/şube + kapalı değil). Geçersizler `ignored`'a yazılır (atma).
    const candidates = ids.length
      ? await prisma.order.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            branchId: true,
            status: true,
            deadline: true,
            orderDate: true,
            lines: {
              select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, createdAt: true },
            },
          },
        })
      : [];
    const foundIds = new Set(candidates.map((o) => o.id));

    const ignored: { orderNumber: string; reason: string }[] = [];
    for (const missing of ids.filter((id) => !foundIds.has(id))) {
      ignored.push({ orderNumber: missing, reason: "Sipariş bulunamadı" });
    }

    const validOrders = candidates.filter((o) => {
      if (o.customerId !== shipment.customerId || (o.branchId ?? null) !== (shipment.branchId ?? null)) {
        ignored.push({ orderNumber: o.orderNumber, reason: "Sevkiyatın müşteri/şubesine ait değil" });
        return false;
      }
      if (o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED) {
        ignored.push({ orderNumber: o.orderNumber, reason: "Sipariş kapalı (iptal/tamamlandı)" });
        return false;
      }
      return true;
    });

    // Bu sevkiyatın mevcut tahsisi (lineId→qty) — çift sayım önleme için.
    const ownByLine = new Map<string, Prisma.Decimal>();
    for (const a of shipment.allocations) {
      ownByLine.set(a.orderLineId, (ownByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
    }

    // Sevkiyatın WAREHOUSE topları → RollSpec[] (computeShipmentAllocation ile aynı).
    const shippableRolls = shipment.rolls.filter((r) => r.status === RollStatus.WAREHOUSE);
    const rollsForAlloc: RollSpec[] = shippableRolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    }));

    // Aday satırlar → LineForAlloc; bu sevkiyatın kendi katkısı shippedQty'den düşülür
    // (commit'liyse "henüz commit etmemiş gibi" projeksiyon — recommit reverse eşdeğeri).
    const linesForAlloc: LineForAlloc[] = validOrders.flatMap((o) =>
      o.lines.map((l) => {
        const own = ownByLine.get(l.id) ?? D0();
        return {
          id: l.id,
          itemId: l.itemId,
          colorId: l.colorId,
          width: l.width,
          quantity: new Prisma.Decimal(l.quantity),
          shippedQty: Prisma.Decimal.max(0, new Prisma.Decimal(l.shippedQty).minus(own)),
          deadline: o.deadline,
          orderDate: o.orderDate,
          lineCreatedAt: l.createdAt,
        };
      })
    );

    // Saf allocate — gerçek commit ile birebir aynı sonuç (lineId→projectedQty).
    const alloc = allocate(rollsForAlloc, linesForAlloc);

    const orders = validOrders.map((o) => {
      let planned = D0();
      let alreadyShipped = D0();
      let projected = D0();
      for (const l of o.lines) {
        planned = planned.plus(l.quantity);
        // alreadyShipped = bu sevkiyatın katkısı hariç önceki karşılanma (çift sayma yok).
        const own = ownByLine.get(l.id) ?? D0();
        alreadyShipped = alreadyShipped.plus(Prisma.Decimal.max(0, new Prisma.Decimal(l.shippedQty).minus(own)));
        projected = projected.plus(alloc.get(l.id) ?? D0());
      }
      const totalCovered = alreadyShipped.plus(projected);
      const coveragePct = planned.greaterThan(0)
        ? Math.round(totalCovered.dividedBy(planned).times(100).toNumber())
        : 0;
      // Aritmetik Decimal; dış yüzde JSON-dostu sayı (UI doğrudan render/renklendirir).
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        planned: Number(planned),
        alreadyShipped: Number(alreadyShipped),
        projected: Number(projected),
        coveragePct,
      };
    });

    const goods = rollsForAlloc.reduce((s, r) => s.plus(r.currentQty), D0());
    const projectedTotal = [...alloc.values()].reduce((s, q) => s.plus(q), D0());
    const leftover = goods.minus(projectedTotal);

    return {
      success: true,
      data: {
        editable,
        orders,
        totals: { goods: Number(goods), projectedTotal: Number(projectedTotal), leftover: Number(leftover) },
        ignored,
      },
    };
  }

  async listShipments(
    req: Request
  ): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);

    // Electron FilterBar/sekme → filter[status] (tek-değer veya çoklu CSV→{in}),
    // filter[customerId], filter[branchId] + arama (shipmentNo/plaka/sürücü/taşıyıcı)
    // tek seferde kurulur; ardından tarih aralığı (whitelist) eklenir.
    // F105: ham params.filters yerine whitelist'lenmiş filtre geç.
    const safeFilters: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(params.filters)) {
      if ((SHIPMENT_FILTER_FIELDS as readonly string[]).includes(k)) safeFilters[k] = v;
    }
    const where = buildWhereClause(
      safeFilters,
      SHIPMENT_SEARCH_FIELDS,
      params.search
    ) as Prisma.ShipmentWhereInput;
    applyDateRange(where as Record<string, unknown>, params, SHIPMENT_DATE_FIELDS);

    // Mobil geri-uyum: ham ?status= / ?customerId= (filter[] değil). buildWhereClause
    // ham query'i görmez — varsa burada uygula (status enum'a karşı doğrulanır).
    const rawStatus = req.query.status as string | undefined;
    if (rawStatus && Object.values(ShipmentStatus).includes(rawStatus as ShipmentStatus)) {
      where.status = rawStatus as ShipmentStatus;
    }
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;

    // Lean select — liste için sayılar (dizi değil); snapshot/dizi YOK (perf, rule 13).
    const select = {
      id: true,
      shipmentNo: true,
      status: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      readyAt: true,
      dispatchedAt: true,
      createdAt: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true } },
      _count: {
        select: {
          sacks: true,
          rolls: true,
          orders: true,
          // Aktif iadeler (iptal hariç) — liste rozeti. İade edilen top shipmentId=null
          // olduğu için `rolls`'a girmez; RollReturn.fromShipmentId üzerinden sayılır.
          returns: { where: { cancelledAt: null } },
        },
      },
    } as const;

    // Electron DataTable → cursor; mobil/eski istemci → array (geri uyum, mobil bozulmaz).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      // Toplam tahmini yalnız ilk sayfada (`useDataTable` withTotal=true yollar) —
      // filtreli + tarih-pencereli `where` üstünde tek count.
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhere = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.shipment.findMany({
          where: cursorWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select,
        }),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select,
    });
    return { success: true, data: shipments };
  }

  /**
   * Sevkiyat detayı — paketleme ekranının canlı kaynağı. Seçilen siparişler +
   * her satırda istenen/şu ana dek sevk/açık + bu oturumda okutulan toplardan
   * projeksiyon (FIFO simülasyonu); okutulan toplar; çuvallar; özet.
   */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        destination: true, // saha #19
        procedureCode: true, // saha #21
        plateNumber: true,
        driverName: true,
        carrier: true,
        readyAt: true,
        dispatchedAt: true,
        createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                deadline: true,
                orderDate: true,
                lines: {
                  select: {
                    id: true,
                    itemId: true,
                    colorId: true,
                    width: true,
                    quantity: true,
                    shippedQty: true,
                    customerItemName: true,
                    customerColorName: true,
                    createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: {
          select: {
            id: true,
            barcode: true,
            itemId: true,
            colorId: true,
            width: true,
            currentQty: true,
            sackId: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
        },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true,
            sackNo: true,
            seq: true,
            manualCode: true,
            weightKg: true,
            rolls: {
              select: {
                id: true,
                barcode: true,
                width: true,
                currentQty: true,
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
            swatches: {
              select: {
                id: true,
                barcode: true,
                length: true,
                width: true,
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
          },
        },
        allocations: { select: { orderLineId: true, qty: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // FIFO projeksiyon — bu oturumdaki toplar seçilen satırlara nasıl düşer.
    const linesForAlloc: LineForAlloc[] = shipment.orders.flatMap((so) =>
      so.order.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        colorId: l.colorId,
        width: l.width,
        quantity: new Prisma.Decimal(l.quantity),
        shippedQty: new Prisma.Decimal(l.shippedQty),
        deadline: so.order.deadline,
        orderDate: so.order.orderDate,
        lineCreatedAt: l.createdAt,
      }))
    );
    const rollsForAlloc: RollSpec[] = shipment.rolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    }));
    // GÖSTERİM: thisShipment = GERÇEK okutulan (kapsız) — operatör fazla/eksik gerçek rakamı
    // görür ("okutulan 100 / istenen 50"). Karşılanma (shippedQty/commit) ayrı: allocate ile
    // need'de kapanır (sipariş fazla-sevkle over-credit edilmez). Bu alan yalnız görünüm.
    const loadedByLine = computeLoadedByLine(rollsForAlloc, linesForAlloc);

    const orders = shipment.orders.map((so) => ({
      id: so.order.id,
      orderNumber: so.order.orderNumber,
      status: so.order.status,
      deadline: so.order.deadline,
      lines: so.order.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const thisShipment = loadedByLine.get(l.id) ?? D0(); // GERÇEK okutulan (kapsız)
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped, // önceki sevkiyatlardan + (READY ise bu da dahil)
          openQty: requested.minus(shipped),
          thisShipment, // bu oturumun bu satıra düşürdüğü/düşüreceği metraj
        };
      }),
    }));

    const totalMeters = rollsForAlloc.reduce((s, r) => s.plus(r.currentQty), D0());
    const totalKg = shipment.sacks.reduce(
      (s, sk) => s.plus(sk.weightKg ?? 0),
      D0()
    );

    // Çuval içeriği — toplar/kartelalar + ürün-bazlı özet (irsaliye/detay dökümü).
    const sacks = shipment.sacks.map((sk) => {
      const summaryMap = new Map<
        string,
        {
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          width: Prisma.Decimal | null;
          totalQty: Prisma.Decimal;
          rollCount: number;
        }
      >();
      for (const r of sk.rolls) {
        const key = `${r.item.code}|${r.color?.code ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
        let e = summaryMap.get(key);
        if (!e) {
          e = {
            itemCode: r.item.code,
            itemName: r.item.name,
            colorCode: r.color?.code ?? null,
            colorName: r.color?.name ?? null,
            width: r.width,
            totalQty: D0(),
            rollCount: 0,
          };
          summaryMap.set(key, e);
        }
        e.totalQty = e.totalQty.plus(r.currentQty);
        e.rollCount += 1;
      }
      return {
        id: sk.id,
        sackNo: sk.sackNo,
        seq: sk.seq,
        manualCode: sk.manualCode,
        weightKg: sk.weightKg,
        rolls: sk.rolls,
        swatches: sk.swatches,
        productSummary: [...summaryMap.values()],
        rollCount: sk.rolls.length,
        swatchCount: sk.swatches.length,
      };
    });

    // Issue A: iade edilen toplar shipmentId=null olduğundan canlı `shipment.rolls`'ta
    // görünmez. Geçmiş bütünlüğü için bu sevkiyattan iade edilenleri (iptal olmayan)
    // RollReturn'den ayrı çekip detayda "iade edilenler" olarak göster (gerçek gönderilen
    // = mevcut + iade). İade iptal edilirse top shipment.rolls'a geri döner + RollReturn
    // cancelled olur → buradan düşer; çift sayım olmaz.
    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        qty: true,
        width: true,
        createdAt: true,
        reasonText: true,
        roll: { select: { barcode: true } },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
        reason: { select: { name: true, color: true } },
      },
    });
    const returnedRolls = returnRows.map((rr) => ({
      id: rr.id,
      barcode: rr.roll.barcode,
      item: rr.item,
      color: rr.color,
      width: rr.width,
      qty: rr.qty,
      returnedAt: rr.createdAt,
      reasonName: rr.reason?.name ?? rr.reasonText ?? null,
      reasonColor: rr.reason?.color ?? null,
    }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        destination: shipment.destination,
        procedureCode: shipment.procedureCode,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        readyAt: shipment.readyAt,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        orders,
        rolls: shipment.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          item: r.item,
          color: r.color,
          width: r.width,
          currentQty: r.currentQty,
          sackId: r.sackId,
        })),
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        summary: {
          rollCount: shipment.rolls.length,
          swatchCount: shipment.swatches.length,
          totalMeters,
          sackCount: shipment.sacks.length,
          totalKg,
          returnedCount: returnedRolls.length,
          returnedMeters,
        },
      },
    };
  }

  // =========================================================================
  // OKUTMA — top / kartela sevkiyata ekle / çıkar
  // =========================================================================

  /**
   * İçeriği değişen çuvalların brüt tartısını sıfırla — tartıdan SONRA top/kartela
   * eklenir, çıkarılır veya taşınırsa eski kg bayatlar ve yanlış brüt irsaliyeye gider.
   * Sıfırlanınca Sevke Hazır invariant'ı yeniden tartıyı zorunlu kılar.
   */
  private async resetSackWeightsTx(
    tx: Prisma.TransactionClient,
    sackIds: (string | null | undefined)[]
  ): Promise<void> {
    const ids = [...new Set(sackIds.filter((s): s is string => !!s))];
    if (ids.length === 0) return;
    await tx.sack.updateMany({
      where: { id: { in: ids }, weightKg: { not: null } },
      // O-19: tartı sıfırlanınca tartan izi de temizlenir (içerik değişti → yeniden tartılmalı).
      data: { weightKg: null, weighedById: null, weighedAt: null },
    });
  }

  /**
   * Barkod okut → top ya da kartelayı sevkiyata + AKTİF ÇUVALA ekle (depodaki serbest mal).
   * `sackId` verilirse içerik o çuvala yazılır (çuval-önce akış). Zaten bu sevkiyatta olan
   * bir top/kartela farklı bir aktif çuvala okutulursa o çuvala TAŞINIR (re-scan = aktar).
   */
  async scanIntoShipment(
    data: { shipmentId: string; barcode: string; sackId?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata top okutulabilir");
    }

    // Aktif çuval verildiyse bu sevkiyata ait olduğunu doğrula
    let targetSackId: string | null = null;
    if (data.sackId) {
      const sack = await prisma.sack.findUnique({
        where: { id: data.sackId },
        select: { id: true, shipmentId: true },
      });
      if (!sack || sack.shipmentId !== data.shipmentId) {
        throw AppError.badRequest("Çuval bu sevkiyata ait değil");
      }
      targetSackId = sack.id;
    }

    const code = data.barcode.trim();
    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true },
    });
    if (roll) {
      if (roll.shipmentId === data.shipmentId) {
        // Zaten bu sevkiyatta — aktif çuval farklıysa o çuvala taşı (re-scan = aktar)
        if (targetSackId && roll.sackId !== targetSackId) {
          const fromSackId = roll.sackId;
          await prisma.$transaction(async (tx) => {
            await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
            // Race: bayat üyelik → atomik guarded claim (move/swap ile aynı gerekçe).
            const moved = await tx.roll.updateMany({
              where: { id: roll.id, shipmentId: data.shipmentId, sackId: fromSackId },
              data: { sackId: targetSackId },
            });
            if (moved.count !== 1) {
              throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
            }
            await this.resetSackWeightsTx(tx, [fromSackId, targetSackId]);
          });
          await AuditService.log({
            userId,
            action: "UPDATE",
            tableName: "ROLL",
            recordId: roll.id,
            newData: { kind: "SACK_MOVE", sackId: targetSackId, fromSackId, barcode: roll.barcode },
          });
          return {
            success: true,
            data: { kind: "ROLL", rollId: roll.id, sackId: targetSackId, currentQty: roll.currentQty },
            message: "Top bu çuvala taşındı",
          };
        }
        return {
          success: true,
          data: { kind: "ROLL", rollId: roll.id, sackId: roll.sackId },
          message: "Top zaten bu çuvalda",
        };
      }
      if (roll.shipmentId) throw AppError.conflict("Top başka bir sevkiyatta");
      if (roll.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(`Sadece depodaki toplar okutulabilir (bu top: ${roll.status})`);
      }
      // ATOMIK SAHİPLENME: top hâlâ boşta (shipmentId null) VE depodaysa
      // (WAREHOUSE) bu sevkiyata bağla. Okuma ile yazma arasında başka bir akış
      // (başka sevkiyat okutması / kartela sevki) topu kapmışsa count=0 döner →
      // çift-bağ yerine temiz çakışma hatası. (TOCTOU guard.)
      await prisma.$transaction(async (tx) => {
        await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
        const claimed = await tx.roll.updateMany({
          where: { id: roll.id, shipmentId: null, status: RollStatus.WAREHOUSE },
          data: { shipmentId: data.shipmentId, sackId: targetSackId },
        });
        if (claimed.count === 0) {
          throw AppError.conflict(
            "Top az önce başka bir akışa girdi (sevkiyat/kartela) — tekrar deneyin."
          );
        }
        // Tartılmış çuvala sonradan eklenen içerik tartıyı bayatlatır → sıfırla.
        await this.resetSackWeightsTx(tx, [targetSackId]);
      });
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: roll.id,
        newData: { kind: "SHIPMENT_SCAN", shipmentId: data.shipmentId, sackId: targetSackId, barcode: roll.barcode },
      });
      return {
        success: true,
        data: { kind: "ROLL", rollId: roll.id, sackId: targetSackId, currentQty: roll.currentQty },
        message: targetSackId ? "Top çuvala eklendi" : "Top sevkiyata eklendi",
      };
    }

    // Kartela (top değilse) — bitmiş ürün gibi çuvala konur
    const swatch = await prisma.swatch.findUnique({
      where: { barcode: code },
      select: { id: true, shipmentId: true, sackId: true, barcode: true, cancelledAt: true },
    });
    if (!swatch) throw AppError.notFound(`Top/kartela bulunamadı: ${code}`);
    // Soft-delete giriş guard'ı: iptal edilmiş (cancelledAt dolu) kartela sevke giremez.
    if (swatch.cancelledAt) {
      throw AppError.badRequest(`İptal edilmiş kartela okutulamaz: ${swatch.barcode}`);
    }
    if (swatch.shipmentId === data.shipmentId) {
      if (targetSackId && swatch.sackId !== targetSackId) {
        const fromSackId = swatch.sackId;
        await prisma.$transaction(async (tx) => {
          await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
          // Race: bayat üyelik → atomik guarded claim (roll move-branch ile aynı).
          const moved = await tx.swatch.updateMany({
            where: { id: swatch.id, shipmentId: data.shipmentId, sackId: fromSackId },
            data: { sackId: targetSackId },
          });
          if (moved.count !== 1) {
            throw AppError.conflict("Kartela bu sırada taşınmış/çıkarılmış — tekrar deneyin");
          }
          await this.resetSackWeightsTx(tx, [fromSackId, targetSackId]);
        });
        await AuditService.log({
          userId,
          action: "UPDATE",
          tableName: "SWATCH",
          recordId: swatch.id,
          newData: { kind: "SACK_MOVE", sackId: targetSackId, fromSackId, barcode: swatch.barcode },
        });
        return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: targetSackId }, message: "Kartela bu çuvala taşındı" };
      }
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: swatch.sackId }, message: "Kartela zaten bu çuvalda" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela başka bir sevkiyatta");
    // ATOMİK SAHİPLENME (top ile aynı desen): kartela hâlâ boştaysa bu sevkiyata bağla —
    // eşzamanlı iki okutmada yalnız biri kazanır, kaybeden temiz 409 alır (TOCTOU guard).
    await prisma.$transaction(async (tx) => {
      await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
      const claimed = await tx.swatch.updateMany({
        where: { id: swatch.id, shipmentId: null, cancelledAt: null },
        data: { shipmentId: data.shipmentId, sackId: targetSackId },
      });
      if (claimed.count === 0) {
        throw AppError.conflict("Kartela az önce başka bir sevkiyata okutuldu — tekrar deneyin.");
      }
      await this.resetSackWeightsTx(tx, [targetSackId]);
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: swatch.id,
      newData: { kind: "SHIPMENT_SCAN", shipmentId: data.shipmentId, sackId: targetSackId, barcode: swatch.barcode },
    });
    return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: targetSackId }, message: targetSackId ? "Kartela çuvala eklendi" : "Kartela sevkiyata eklendi" };
  }

  /**
   * Sevk edilmemiş (PREPARING/READY/AT_DOOR) sevkiyat satırını kilitle — içerik
   * tx'lerini markReady/dispatch claim'leriyle serileştirir (touchShipmentPreparingTx'in
   * READY-farkındalı kardeşi; saha #3). Kilitlenen statüyü döndürür.
   */
  private touchShipmentEditableTx(
    tx: Prisma.TransactionClient,
    shipmentId: string
  ): Promise<ShipmentStatus> {
    return touchEditableTx(tx, shipmentId);
  }

  /**
   * Bu sevkiyatın bağlı olduğu siparişlerin TÜM OrderLine satırlarını kilitle —
   * karşılanma (commit) yazılmadan ÖNCE. İki ayrı sevkiyat aynı siparişi
   * kapsıyorsa, ikinci commit burada bloklanır ve ilk commit'ten sonra TAZE
   * shippedQty okur → `allocate()` cap'i doğru clamp'ler (over-coverage yok).
   * Kilit sırası touchOrderLinesTx içinde id-sıralıdır (deadlock güvenli).
   */
  private async lockShipmentOrderLinesTx(
    tx: Prisma.TransactionClient,
    shipmentId: string
  ): Promise<void> {
    const links = await tx.shipmentOrder.findMany({
      where: { shipmentId },
      select: { orderId: true },
    });
    if (links.length === 0) return;
    const lines = await tx.orderLine.findMany({
      where: { orderId: { in: links.map((l) => l.orderId) } },
      select: { id: true },
    });
    await touchOrderLinesTx(tx, lines.map((l) => l.id));
  }

  /**
   * COMMIT'i içerik değişiminden sonra YENİDEN senkronla (saha #3) — READY/AT_DOOR'da
   * top çıkarılırsa eski tahsis/shippedQty bayatlar. Eski tahsis geri alınır, taze
   * içerikle yeniden yazılır. Mutasyondan SONRA, aynı tx içinde çağrılır.
   */
  private async recommitShipmentTx(
    tx: Prisma.TransactionClient,
    shipmentId: string
  ): Promise<void> {
    // OVER-COVER guard: reverse+recommit'in tamamı OrderLine kilidi altında olsun
    // (markReady ile aynı satırlarda serileşir).
    await this.lockShipmentOrderLinesTx(tx, shipmentId);
    const allocations = await tx.shipmentAllocation.findMany({
      where: { shipmentId },
      select: { orderLineId: true, qty: true },
    });
    const shipOrders = await tx.shipmentOrder.findMany({
      where: { shipmentId },
      select: { orderId: true },
    });
    await this.reverseCommitTx(tx, shipmentId, allocations, shipOrders.map((o) => o.orderId));
    // Taze yükleme reverse'ten SONRA: satır shippedQty'leri geri alınmış halde
    // okunmalı, yoksa need=quantity-shippedQty hep 0 çıkar ve tahsis boş yazılır.
    const fresh = await this.loadShipmentForFinalize(shipmentId, tx);
    if (!fresh) throw AppError.notFound("Sevkiyat bulunamadı");
    const { alloc, orderIds } = this.computeShipmentAllocation(fresh);
    await this.commitGoodsTx(tx, shipmentId, alloc, orderIds);
  }

  /**
   * Kaynak çuval içerik çıkışıyla BOŞALDIYSA ve sevkiyat commit'li (READY/AT_DOOR)
   * ise çuvalı sil — hayalet çuval dispatch invariant'ını bloklar, READY'de operatörün
   * Paketleme'ye dönmeden temizleme yolu yok (saha #3). PREPARING'de SİLİNMEZ
   * (operatör çuvalı doldurmaya devam edebilir).
   */
  private async dropSackIfEmptiedTx(
    tx: Prisma.TransactionClient,
    sackId: string | null | undefined,
    status: ShipmentStatus
  ): Promise<void> {
    if (!sackId || status === ShipmentStatus.PREPARING) return;
    const [rollCount, swatchCount] = [
      await tx.roll.count({ where: { sackId } }),
      await tx.swatch.count({ where: { sackId } }),
    ];
    if (rollCount === 0 && swatchCount === 0) {
      await tx.sack.delete({ where: { id: sackId } });
    }
  }

  /**
   * Topu sevkiyattan çıkar (depoya geri döner). Saha #3: PREPARING'e ek olarak
   * READY/AT_DOOR'da da çalışır — tartı sıfırlanır (yeniden tartı şart), commit
   * taze içerikle yeniden yazılır, boşalan çuval silinir.
   */
  async removeRollFromShipment(
    data: { shipmentId: string; rollId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, shipmentId: true, sackId: true, shipment: { select: { status: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.shipmentId !== data.shipmentId) throw AppError.badRequest("Top bu sevkiyatta değil");
    if (roll.shipment && roll.shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyattan top çıkarılamaz");
    }
    let lockedStatus: ShipmentStatus = ShipmentStatus.PREPARING;
    await prisma.$transaction(async (tx) => {
      lockedStatus = await this.touchShipmentEditableTx(tx, data.shipmentId); // M-2: finalize ile serileş
      // F99: üyelik/sackId'yi kilit ALTINDA taze oku — pre-tx okuma (1390) bayat
      // olabilir (araya giren moveRollToSack topu başka çuvala taşımış olabilir);
      // bayat sackId yanlış çuval tartısını sıfırlar.
      const fresh = await tx.roll.findUnique({
        where: { id: data.rollId },
        select: { shipmentId: true, sackId: true },
      });
      if (!fresh || fresh.shipmentId !== data.shipmentId) {
        throw AppError.conflict("Top bu sırada sevkiyattan çıkarılmış/taşınmış — sayfayı yenileyin.");
      }
      const freshSackId = fresh.sackId;
      // Atomik guarded claim (kardeş dallarla tutarlı): top hâlâ bu sevkiyattaysa çıkar.
      const removed = await tx.roll.updateMany({
        where: { id: data.rollId, shipmentId: data.shipmentId },
        data: { shipmentId: null, sackId: null },
      });
      if (removed.count !== 1) {
        throw AppError.conflict("Top bu sırada sevkiyattan çıkarıldı — tekrar deneyin.");
      }
      await this.resetSackWeightsTx(tx, [freshSackId]); // içeriği değişen çuvalın tartısı bayatladı
      await this.dropSackIfEmptiedTx(tx, freshSackId, lockedStatus);
      if (lockedStatus !== ShipmentStatus.PREPARING) {
        await this.recommitShipmentTx(tx, data.shipmentId); // karşılanma taze içerikle senkron
      }
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      newData: { kind: "SHIPMENT_UNSCAN", shipmentId: null, sackId: null, shipmentStatus: lockedStatus },
    });
    return { success: true, data: {}, message: "Top sevkiyattan çıkarıldı" };
  }

  /** Kartelayı sevkiyattan çıkar. */
  async removeSwatchFromShipment(
    data: { shipmentId: string; swatchId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: data.swatchId },
      select: { id: true, shipmentId: true, sackId: true, shipment: { select: { status: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (swatch.shipmentId !== data.shipmentId) throw AppError.badRequest("Kartela bu sevkiyatta değil");
    if (swatch.shipment && swatch.shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyattan kartela çıkarılamaz");
    }
    await prisma.$transaction(async (tx) => {
      // Saha #3: READY/AT_DOOR'da da çalışır. Kartela tahsise girmez → recommit yok.
      const lockedStatus = await this.touchShipmentEditableTx(tx, data.shipmentId); // M-2: finalize ile serileş
      // F99 (kartela ikizi): sackId'yi kilit altında taze oku + atomik guarded claim
      // — pre-tx bayat sackId yanlış çuval tartısını sıfırlıyordu.
      const fresh = await tx.swatch.findUnique({
        where: { id: data.swatchId },
        select: { shipmentId: true, sackId: true },
      });
      if (!fresh || fresh.shipmentId !== data.shipmentId) {
        throw AppError.conflict("Kartela bu sırada sevkiyattan çıkarılmış/taşınmış — sayfayı yenileyin.");
      }
      const freshSackId = fresh.sackId;
      const removed = await tx.swatch.updateMany({
        where: { id: data.swatchId, shipmentId: data.shipmentId },
        data: { shipmentId: null, sackId: null },
      });
      if (removed.count !== 1) {
        throw AppError.conflict("Kartela bu sırada sevkiyattan çıkarıldı — tekrar deneyin.");
      }
      await this.resetSackWeightsTx(tx, [freshSackId]); // içeriği değişen çuvalın tartısı bayatladı
      await this.dropSackIfEmptiedTx(tx, freshSackId, lockedStatus);
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: data.swatchId,
      newData: { kind: "SHIPMENT_UNSCAN", shipmentId: null, sackId: null },
    });
    return { success: true, data: {}, message: "Kartela sevkiyattan çıkarıldı" };
  }

  /**
   * Sevkiyata SEÇEREK kartela ekle (barkod okutmadan) — kartelaların fiziksel
   * etiketi yok, adet bazlı stoktan düşülür. Ürün+renk + adet verilir; o
   * kombinasyonun müsait (shipmentId null, cancelledAt null) N swatch satırı
   * FIFO seçilip atomik claim ile bu sevkiyata/çuvala bağlanır → stoktan düşer.
   *
   * scanIntoShipment'ın N-satır, seçim-tabanlı kardeşi: bir EKLEME işlemi olduğu
   * için scan ile aynı şekilde yalnız PREPARING'de çalışır (READY/AT_DOOR'a yeni
   * içerik girişi tahsis/çuval invariant'ını bozar; içerik düzeni için unmarkReady
   * ile PREPARING'e dönülür). Kartela tahsise girmez → recommit yok.
   */
  async addKartelaToShipment(
    data: { shipmentId: string; itemId: string; colorId: string | null; count: number; sackId?: string | null },
    userId?: string
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string | null }>> {
    if (!Number.isInteger(data.count) || data.count < 1) {
      throw AppError.badRequest("Adet pozitif tam sayı olmalı");
    }
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata kartela eklenebilir");
    }

    // Aktif çuval verildiyse bu sevkiyata ait olduğunu doğrula (scan ile birebir).
    let targetSackId: string | null = null;
    if (data.sackId) {
      const sack = await prisma.sack.findUnique({
        where: { id: data.sackId },
        select: { id: true, shipmentId: true },
      });
      if (!sack || sack.shipmentId !== data.shipmentId) {
        throw AppError.badRequest("Çuval bu sevkiyata ait değil");
      }
      targetSackId = sack.id;
    }

    const ids = await prisma.$transaction(async (tx) => {
      await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
      // updateMany LIMIT desteklemediğinden select-then-claim: N adayı FIFO seç,
      // sonra yalnız hâlâ boştakileri (TOCTOU guard) tek updateMany ile claim et.
      const candidates = await tx.swatch.findMany({
        where: {
          itemId: data.itemId,
          colorId: data.colorId, // null → colorId IS NULL ("renksiz" grubu)
          shipmentId: null,
          cancelledAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: data.count,
      });
      if (candidates.length < data.count) {
        throw AppError.conflict(
          `Yeterli kartela stoğu yok — istenen ${data.count}, mevcut ${candidates.length}. Listeyi yenileyin.`
        );
      }
      const claimIds = candidates.map((c) => c.id);
      const claimed = await tx.swatch.updateMany({
        where: { id: { in: claimIds }, shipmentId: null, cancelledAt: null },
        data: { shipmentId: data.shipmentId, sackId: targetSackId },
      });
      if (claimed.count !== data.count) {
        // Kısmi claim: aralarından biri az önce başka sevkiyata girdi → tüm tx rollback.
        throw AppError.conflict("Kartelalardan biri az önce başka bir sevkiyata girdi — tekrar deneyin.");
      }
      // Tartılmış çuvala sonradan eklenen içerik tartıyı bayatlatır → sıfırla.
      await this.resetSackWeightsTx(tx, [targetSackId]);
      return claimIds;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: ids[0],
      newData: {
        kind: "KARTELA_SELECT_ADD",
        shipmentId: data.shipmentId,
        itemId: data.itemId,
        colorId: data.colorId,
        count: data.count,
        sackId: targetSackId,
      },
    });

    return {
      success: true,
      data: { added: ids.length, swatchIds: ids, sackId: targetSackId },
      message: targetSackId ? "Kartela çuvala eklendi" : "Kartela sevkiyata eklendi",
    };
  }

  /**
   * Topu çuvaldan çuvala (veya çuvalsızdan çuvala) taşı — aynı sevkiyat içi, tek dokunuş.
   * Stok hareketi değil; yalnız "hangi çuvalda" bilgisi değişir.
   */
  async moveRollToSack(
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: {
        id: true,
        barcode: true,
        shipmentId: true,
        sackId: true,
        shipment: { select: { status: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.shipmentId) throw AppError.badRequest("Top bir sevkiyatta değil");
    if (roll.shipment && roll.shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyatta çuval değiştirilemez");
    }
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, seq: true, shipmentId: true },
    });
    if (!sack || sack.shipmentId !== roll.shipmentId) {
      throw AppError.badRequest("Hedef çuval aynı sevkiyata ait değil");
    }
    if (roll.sackId === data.sackId) {
      return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
    }
    const fromSackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      // Saha #3: READY/AT_DOOR'da da çalışır — kapsam değişmez (aynı sevkiyat),
      // recommit gerekmez; yalnız iki çuvalın tartısı bayatlar + boşalan silinir.
      const lockedStatus = await this.touchShipmentEditableTx(tx, roll.shipmentId!); // M-2: finalize ile serileş
      // Race: pre-tx üyelik bayat olabilir → atomik guarded claim (swap ile aynı
      // gerekçe). Eşzamanlı remove/move topu kaçırmışsa count!==1 → temiz 409.
      const moved = await tx.roll.updateMany({
        where: { id: roll.id, shipmentId: roll.shipmentId!, sackId: fromSackId },
        data: { sackId: data.sackId },
      });
      if (moved.count !== 1) {
        throw AppError.conflict(
          "Top bu sırada taşınmış/çıkarılmış — sayfayı yenileyip tekrar deneyin"
        );
      }
      await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]); // iki çuvalın da tartısı bayatladı
      await this.dropSackIfEmptiedTx(tx, fromSackId, lockedStatus);
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode },
    });
    return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: `Top Çuval ${sack.seq}'e taşındı` };
  }

  /**
   * İki topun çuvalını TAKAS et (saha #3) — aynı sevkiyat içinde, farklı çuvallardaki
   * iki top yer değiştirir. Kapsam değişmez (recommit yok); iki çuvalın da tartısı
   * sıfırlanır. PREPARING/READY/AT_DOOR'da çalışır. Hiçbir çuval boşalamaz (her
   * çuvala karşı top girer).
   */
  async swapRollSacks(
    data: { rollAId: string; rollBId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.rollAId === data.rollBId) throw AppError.badRequest("Aynı top kendisiyle takas edilemez");
    const rolls = await prisma.roll.findMany({
      where: { id: { in: [data.rollAId, data.rollBId] } },
      select: {
        id: true,
        barcode: true,
        shipmentId: true,
        sackId: true,
        shipment: { select: { status: true } },
      },
    });
    const a = rolls.find((r) => r.id === data.rollAId);
    const b = rolls.find((r) => r.id === data.rollBId);
    if (!a || !b) throw AppError.notFound("Top bulunamadı");
    if (!a.shipmentId || !b.shipmentId) throw AppError.badRequest("İki top da bir sevkiyatta olmalı");
    if (a.shipmentId !== b.shipmentId) {
      throw AppError.badRequest(
        "Toplar farklı sevkiyatlarda — takas yalnız aynı sevkiyat içinde yapılır. Önce topu sevkiyattan çıkarıp diğerine okutun."
      );
    }
    if (a.shipment?.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyatta takas yapılamaz");
    }
    if (!a.sackId || !b.sackId) throw AppError.badRequest("İki top da bir çuvalda olmalı");
    if (a.sackId === b.sackId) {
      return { success: true, data: {}, message: "İki top zaten aynı çuvalda" };
    }
    await prisma.$transaction(async (tx) => {
      await this.touchShipmentEditableTx(tx, a.shipmentId!); // M-2: finalize ile serileş
      // Race: pre-tx okunan sackId/shipmentId BAYAT olabilir (eşzamanlı remove/move/
      // re-scan). Bare update yerine ATOMİK guarded claim — üyeliği tx içinde pinle;
      // top bu sırada çıkarılmış/taşınmışsa count!==1 → hayalet rulo yerine temiz 409.
      const movedA = await tx.roll.updateMany({
        where: { id: a.id, shipmentId: a.shipmentId!, sackId: a.sackId! },
        data: { sackId: b.sackId! },
      });
      const movedB = await tx.roll.updateMany({
        where: { id: b.id, shipmentId: b.shipmentId!, sackId: b.sackId! },
        data: { sackId: a.sackId! },
      });
      if (movedA.count !== 1 || movedB.count !== 1) {
        throw AppError.conflict(
          "Toplardan biri bu sırada taşınmış/çıkarılmış — sayfayı yenileyip tekrar deneyin"
        );
      }
      await this.resetSackWeightsTx(tx, [a.sackId, b.sackId]); // iki çuvalın da tartısı bayatladı
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: a.id,
      newData: {
        kind: "SACK_SWAP",
        rollA: { id: a.id, barcode: a.barcode, fromSackId: a.sackId, toSackId: b.sackId },
        rollB: { id: b.id, barcode: b.barcode, fromSackId: b.sackId, toSackId: a.sackId },
      },
    });
    return { success: true, data: {}, message: "İki topun çuvalı takas edildi" };
  }

  // =========================================================================
  // ÇUVAL — brüt tartı (no + kg) + İÇERİK (Roll/Swatch.sackId)
  // =========================================================================

  /**
   * Çuval aç. Çuval-önce akışta önce boş açılır (kg + kod sonra updateSack ile girilir),
   * içine top/kartela okutulur. weightKg / manualCode verilirse açılışta set edilir.
   */
  async addSack(
    data: { shipmentId: string; weightKg?: number | null; sackNo?: string | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.weightKg != null && !(data.weightKg > 0)) {
      throw AppError.badRequest("Geçerli bir kg girilmeli");
    }
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true, _count: { select: { sacks: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata çuval eklenebilir");
    }

    const code = data.manualCode?.trim() || null; // serbest format, benzersizlik aranmaz

    const sack = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        await this.touchShipmentPreparingTx(tx, data.shipmentId); // M-2: finalize ile serileş
        const sackNo = data.sackNo?.trim() || (await nextSackNo());
        // seq = max(seq)+1 (closure İÇİNDE taze okunur). Eski _count tabanlı
        // hesap deterministik çakışıyordu: 3 çuval aç → #2'yi sil → yeni ekle →
        // _count=2 → yeni seq=3 mevcut #3 ile çakışır, donmuş irsaliyede iki
        // "Çuval 3" kalıcılaşırdı. DB seddi: @@unique([shipmentId, seq]) —
        // eşzamanlı çift addSack'in kaybedeni P2002 alır, retry taze max okur.
        const maxSeqRow = await tx.sack.findFirst({
          where: { shipmentId: data.shipmentId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        // Saha #5: müşteri çuval kodu standardı — operatör kod girmediyse
        // AMB%05d formatında GLOBAL sıradan otomatik üret (eski sistemin
        // örnek fişindeki AMB00001 düzeniyle birebir). manualCode unique
        // DEĞİL (serbest alan) — best-effort max+1; tx içinde okunduğundan
        // pratik çakışma penceresi yok denecek kadar dar.
        let effectiveCode = code;
        if (!effectiveCode) {
          // Sabit-genişlik 5 hane → collation-güvenli kapalı aralık (gte/lte);
          // "AMB99999￿" sentinel'i glibc'de U+FFFF ignorable olduğundan AMB99999'u
          // dışlardı, ayrıca gereksiz. lte: "AMB99999" üst değeri dahil eder, AMB+harf
          // (örn "AMBALAJ") glibc'de "AMB9.."den büyük sıralanıp eşleşmez. orderBy
          // manualCode desc zero-pad eşit-genişlikte numerik sırayla aynıdır.
          const lastAmb = await tx.sack.findFirst({
            where: { manualCode: { gte: "AMB00000", lte: "AMB99999" } },
            orderBy: { manualCode: "desc" },
            select: { manualCode: true },
          });
          const lastNum = lastAmb?.manualCode
            ? parseInt(lastAmb.manualCode.replace(/^AMB/, ""), 10)
            : 0;
          const nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1;
          effectiveCode = `AMB${String(nextNum).padStart(5, "0")}`;
        }
        return tx.sack.create({
          data: {
            sackNo,
            shipmentId: data.shipmentId,
            seq: (maxSeqRow?.seq ?? 0) + 1,
            manualCode: effectiveCode,
            weightKg: data.weightKg != null ? new Prisma.Decimal(data.weightKg) : null,
            // O-19: açılışta tartıyla geldiyse tartan operatör izi de damgalanır (updateSack ile parite).
            ...(data.weightKg != null ? { weighedById: userId ?? null, weighedAt: new Date() } : {}),
          },
          select: { id: true, sackNo: true, seq: true, weightKg: true, manualCode: true },
        });
      })
    );
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, shipmentId: data.shipmentId, weightKg: data.weightKg ?? null, manualCode: code },
    });
    return {
      success: true,
      data: sack,
      message:
        data.weightKg != null ? `Çuval ${sack.seq} açıldı (${data.weightKg} kg)` : `Çuval ${sack.seq} açıldı`,
    };
  }

  /**
   * Çuval brüt tartısını ve/veya elle yazılan kodunu güncelle. weightKg ve manualCode'dan
   * en az biri verilmeli. Kod serbest formattır (benzersizlik aranmaz); boş ("") gelirse
   * temizlenir — Sevke Hazır/Sevk'te invariant kodu yine de zorunlu kılar.
   */
  async updateSack(
    data: { sackId: string; weightKg?: number | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    const hasCode = data.manualCode !== undefined;
    if (!hasWeight && !hasCode) {
      throw AppError.badRequest("Tartı veya çuval kodu girilmeli");
    }
    if (hasWeight && !(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true, shipment: { select: { status: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    // Saha #3: READY/AT_DOOR'da içerik düzeltmesi tartıyı sıfırlar — yeniden tartı
    // BU endpoint'ten girilmek zorunda (unready'siz akış kapanmasın). Tartı/kod
    // kapsamı/karşılanmayı değiştirmez → commit'e dokunmadan güvenli. DISPATCHED ret.
    if (sack.shipment && sack.shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyatın çuvalı değiştirilemez");
    }

    const update: Prisma.SackUpdateInput = {};
    if (hasWeight) {
      update.weightKg = new Prisma.Decimal(data.weightKg!);
      // O-19: tartan operatör izi — tartı set edilirken damgalanır.
      update.weighedBy = userId ? { connect: { id: userId } } : { disconnect: true };
      update.weighedAt = new Date();
    }
    let codeForLog: string | null | undefined;
    if (hasCode) {
      const code = data.manualCode?.trim() || null; // serbest format, benzersizlik aranmaz
      update.manualCode = code;
      codeForLog = code;
    }

    await prisma.$transaction(async (tx) => {
      if (sack.shipmentId) await this.touchShipmentEditableTx(tx, sack.shipmentId); // M-2: finalize ile serileş
      await tx.sack.update({ where: { id: data.sackId }, data: update });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: data.sackId,
      newData: { kind: "WEIGH", ...(hasWeight ? { weightKg: data.weightKg } : {}), ...(hasCode ? { manualCode: codeForLog } : {}) },
    });
    return { success: true, data: {}, message: "Çuval güncellendi" };
  }

  /** Çuvalı sil. Dolu çuval silinemez — önce içerik boşaltılmalı (içerik bütünlüğü). */
  /**
   * Çuvalı sil. Boş çuval doğrudan silinir. Dolu çuvalda iki yol:
   *  - `withContents=false` (varsayılan): hata — önce içerik boşaltılmalı (geriye uyumlu).
   *  - `withContents=true`: KISA YOL — içindeki top/kartelaları tek tek çıkarmaya gerek
   *    kalmadan sevkiyattan düşürür (DEPOYA döner: shipmentId+sackId null) ve çuvalı siler.
   *    Atomik + denetimli. PREPARING'de toplar zaten WAREHOUSE statüsünde olduğundan
   *    statü değişmez; yalnız sevkiyat/çuval bağı kopar.
   */
  async removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        shipmentId: true,
        shipment: { select: { status: true } },
        _count: { select: { rolls: true, swatches: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyatın çuvalı silinemez");
    }

    const hasContents = sack._count.rolls > 0 || sack._count.swatches > 0;
    if (hasContents && !withContents) {
      throw AppError.conflict(
        "Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya sevkiyattan çıkar"
      );
    }

    if (hasContents) {
      // Denetim için silinmeden önce barkodları topla.
      const rolls = await prisma.roll.findMany({ where: { sackId }, select: { id: true, barcode: true } });
      await prisma.$transaction(async (tx) => {
        if (sack.shipmentId) await this.touchShipmentPreparingTx(tx, sack.shipmentId); // M-2: finalize ile serileş
        // Toplar/kartelalar sevkiyattan düşer → depoya döner (PREPARING'de statü zaten WAREHOUSE).
        await tx.roll.updateMany({ where: { sackId }, data: { shipmentId: null, sackId: null } });
        await tx.swatch.updateMany({ where: { sackId }, data: { shipmentId: null, sackId: null } });
        await tx.sack.delete({ where: { id: sackId } });
      });
      await AuditService.log({
        userId,
        action: "DELETE",
        tableName: "SACK",
        recordId: sackId,
        oldData: {
          sackNo: sack.sackNo,
          kind: "SACK_REMOVE_WITH_CONTENTS",
          returnedRolls: rolls.map((r) => r.barcode ?? r.id),
          rollCount: sack._count.rolls,
          swatchCount: sack._count.swatches,
        },
      });
      const n = sack._count.rolls + sack._count.swatches;
      return { success: true, data: { returnedToWarehouse: n }, message: `Çuval silindi — ${n} top/kartela depoya döndü` };
    }

    await prisma.$transaction(async (tx) => {
      if (sack.shipmentId) await this.touchShipmentPreparingTx(tx, sack.shipmentId); // M-2: finalize ile serileş
      await tx.sack.delete({ where: { id: sackId } });
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNo: sack.sackNo },
    });
    return { success: true, data: {}, message: "Çuval silindi" };
  }

  // =========================================================================
  // ÇUVAL DEPO — çuvallanmış bekleyen mal (READY=çuval depo, AT_DOOR=kapı önü).
  // =========================================================================
  /**
   * Çuval Depo board LİSTESİ (Electron + mobil) — HAFİF + sayfalı + sunucu-aramalı.
   * Rulo ÇEKMEZ: kart sayaçları (çuval/top adedi, kg, metraj) ucuz aggregate'lerden
   * gelir. Çuval+rulo dökümü ayrı `getShipmentSackContents` ile, karta tıklayınca
   * lazy yüklenir (READY ihracatta yüzlerce birikebilir → board'ı her seferinde
   * tüm rulolarla şişirmek ölçeklenmez; CLAUDE.md cursor + over-fetch kuralı).
   */
  async listSackStoreBoard(params: {
    status?: string;
    search?: string;
    destination?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);

    // Durum: READY (çuval depo) | AT_DOOR (kapı önü) | yok → ikisi birden.
    const statusFilter: ShipmentStatus[] =
      params.status === "READY"
        ? [ShipmentStatus.READY]
        : params.status === "AT_DOOR"
          ? [ShipmentStatus.AT_DOOR]
          : [ShipmentStatus.READY, ShipmentStatus.AT_DOOR];

    const where: Prisma.ShipmentWhereInput = { status: { in: statusFilter } };
    // Saha #22: yurtiçi/yurtdışı filtresi (rozet ayrımı — sıkı değil).
    if (params.destination === "DOMESTIC" || params.destination === "EXPORT") {
      where.destination = params.destination as ShipmentDestination;
    }
    const search = params.search?.trim();
    if (search) {
      // Sunucu-tarafı arama: sevk no / müşteri adı / çuval kodu (küçük-orta set).
      // Çuval kodu = hem sistem `sackNo` (CV-YYMMDD-NNN) hem elle yazılan
      // `manualCode` (AMB.. / serbest) — tabancayla okutulan etiket ikisinden
      // biri olabilir, "Okutarak Sevk" akışı her ikisini de bulabilsin.
      where.OR = buildTurkishSearch<Prisma.ShipmentWhereInput>(search, [
        "shipmentNo",
        "customer.name",
        "sacks.some.sackNo",
        "sacks.some.manualCode",
      ]);
    }

    // Keyset cursor — readyAt asc (en uzun bekleyen üstte), id tiebreak.
    // readyAt READY/AT_DOOR'da daima dolu (markReady/moveToDoor yazar).
    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.ShipmentWhereInput = cursor
      ? { AND: [where, dynamicCursorWhere(cursor, "readyAt", "asc") as Prisma.ShipmentWhereInput] }
      : where;

    const rows = await prisma.shipment.findMany({
      where: finalWhere,
      orderBy: [{ readyAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        destination: true, // saha #22: rozet
        procedureCode: true, // saha #21
        readyAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore
      ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, "readyAt")
      : null;

    // Ucuz aggregate (yalnız sayfa kapsamı) — rulo SATIRI çekmeden sayaç/toplam.
    const [sackAgg, rollAgg] = ids.length
      ? await Promise.all([
          prisma.sack.groupBy({
            by: ["shipmentId"],
            where: { shipmentId: { in: ids } },
            _count: { _all: true },
            _sum: { weightKg: true },
          }),
          prisma.roll.groupBy({
            by: ["shipmentId"],
            where: { shipmentId: { in: ids } },
            _count: { _all: true },
            _sum: { currentQty: true },
          }),
        ])
      : [[], []];

    const sackByShip = new Map(sackAgg.map((g) => [g.shipmentId, g]));
    const rollByShip = new Map(rollAgg.map((g) => [g.shipmentId, g]));

    const data = pageRows.map((s) => {
      const sa = sackByShip.get(s.id);
      const ra = rollByShip.get(s.id);
      return {
        id: s.id,
        shipmentNo: s.shipmentNo,
        status: s.status,
        destination: s.destination,
        procedureCode: s.procedureCode,
        readyAt: s.readyAt,
        customer: s.customer,
        branch: s.branch,
        sackCount: sa?._count._all ?? 0,
        rollCount: ra?._count._all ?? 0,
        totalKg: Number(sa?._sum.weightKg ?? 0),
        totalQty: Number(ra?._sum.currentQty ?? 0),
      };
    });

    return { success: true, data, pagination: { nextCursor, hasMore, limit } };
  }

  /**
   * Bir SEVKİYATIN tam çuval+rulo dökümü — board kartına tıklayınca slide-over'da
   * lazy yüklenir. Tek sevkiyat = sınırlı kapsam (birkaç çuval × onlarca top), o
   * yüzden burada rulları çekmek güvenli; board listesi bunu ASLA çekmez.
   */
  async getShipmentSackContents(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        readyAt: true,
        plateNumber: true,
        driverName: true,
        carrier: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true,
            sackNo: true,
            seq: true,
            manualCode: true,
            weightKg: true,
            rolls: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                barcode: true,
                currentQty: true,
                width: true,
                qualityGrade: true,
                item: { select: { id: true, name: true } },
                color: { select: { id: true, name: true, hex: true } },
              },
            },
            swatches: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                barcode: true,
                item: { select: { id: true, name: true } },
                color: { select: { id: true, name: true, hex: true } },
              },
            },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const sacks = sh.sacks.map((sk) => {
      // Çuval içeriğini ürün+renk+en bazında grupla (irsaliye-benzeri döküm).
      const groups = new Map<
        string,
        { itemName: string; colorName: string | null; width: number | null; qty: Prisma.Decimal; rollCount: number }
      >();
      let sackQty = D0();
      for (const r of sk.rolls) {
        const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
        const g =
          groups.get(key) ??
          { itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width ? Number(r.width) : null, qty: D0(), rollCount: 0 };
        g.qty = g.qty.plus(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        sackQty = sackQty.plus(r.currentQty);
      }
      return {
        id: sk.id,
        sackNo: sk.sackNo,
        seq: sk.seq,
        manualCode: sk.manualCode,
        weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        rollCount: sk.rolls.length,
        swatchCount: sk.swatches.length,
        totalQty: Number(sackQty),
        contents: [...groups.values()].map((g) => ({
          itemName: g.itemName,
          colorName: g.colorName,
          width: g.width,
          qty: Number(g.qty),
          rollCount: g.rollCount,
        })),
        rolls: sk.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          qty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade,
          item: r.item,
          color: r.color,
        })),
        swatches: sk.swatches.map((s) => ({
          id: s.id,
          barcode: s.barcode,
          item: s.item,
          color: s.color,
        })),
      };
    });

    return {
      success: true,
      data: {
        id: sh.id,
        shipmentNo: sh.shipmentNo,
        status: sh.status,
        readyAt: sh.readyAt,
        plateNumber: sh.plateNumber,
        driverName: sh.driverName,
        carrier: sh.carrier,
        customer: sh.customer,
        branch: sh.branch,
        sackCount: sh.sacks.length,
        sacks,
      },
    };
  }

  /**
   * Saha #2: muhasebe sevk fişi (ornek-fis.pdf birebir) — 3 bölüm (Ürün/Çuval/Çeki).
   * TEK KAYNAK: aynı içerik `collectShipmentDocContent` ile sevk irsaliyesi
   * (SHIPMENT_DISPATCH donmuş belge + renderShipmentDispatchHtml) tarafından da
   * kullanılır → muhasebe fişi ile sevk irsaliyesi BİREBİR aynı veriden gelir.
   * Salt-okunur; DISPATCHED'ta içerik dondurulmuştur (toplar SHIPPED, değişmez).
   */
  async getDispatchReport(shipmentId: string): Promise<ApiResponse<unknown>> {
    const content = await collectShipmentDocContent(prisma, shipmentId, {
      requireDispatched: false,
    });
    if (!content) throw AppError.notFound("Sevkiyat bulunamadı");
    return { success: true, data: content };
  }

  // =========================================================================
  // SEVKE HAZIR (READY, rezerve) + SEVK (DISPATCH, stok+karşılanma burada düşer)
  // =========================================================================

  /** markReady / dispatch için sevkiyatı içerikle yükle (toplar + çuvallar + sipariş satırları). */
  /**
   * İçerik-mutasyon tx'lerinde sevkiyat satırına KOŞULLU dokunuş (M-2).
   * İki işlevi var: (1) PREPARING dışındaki sevkiyatta içerik değişikliğini
   * 409 ile reddeder; (2) shipment SATIR KİLİDİNİ alır — finalize claim'leri
   * aynı satıra updateMany attığından içerik tx'i ile durum geçişi tamamen
   * SERİLEŞİR. Bu olmadan içerik endpoint'leri shipment satırına hiç
   * dokunmadığından kilit çakışması yoktu: dispatch ile yarışan removeRoll
   * hayalet SHIPPED top (depoda ama hiçbir listede yok), eşzamanlı scan ise
   * DISPATCHED sevkiyata bağlı kurtarılamaz WAREHOUSE rezervi bırakırdı.
   */
  private touchShipmentPreparingTx(
    tx: Prisma.TransactionClient,
    shipmentId: string
  ): Promise<void> {
    return touchPreparingTx(tx, shipmentId);
  }

  private loadShipmentForFinalize(
    shipmentId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ) {
    return client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        destination: true, // saha #19: tartı invariant'ı kapsama göre
        readyAt: true,
        rolls: { select: { id: true, barcode: true, sackId: true, itemId: true, colorId: true, width: true, currentQty: true, status: true } },
        swatches: { select: { id: true, barcode: true, sackId: true } },
        sacks: { select: { id: true, seq: true, weightKg: true, manualCode: true } },
        orders: {
          select: {
            orderId: true,
            order: {
              select: {
                status: true,
                deadline: true,
                orderDate: true,
                lines: {
                  select: {
                    id: true,
                    itemId: true,
                    colorId: true,
                    width: true,
                    quantity: true,
                    shippedQty: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Sevke hazır / sevk öncesi değişmez kurallar: içerik var, her top+kartela bir çuvalda,
   * çuvallar boş değil, her çuval brüt tartılı VE elle yazılan kodu girilmiş.
   * İrsaliyede içerik eksiksiz + hayalet çuval (boş ama sayıda/kg'da görünen) olmasın.
   */
  private assertReadyInvariants(
    shipment: NonNullable<Awaited<ReturnType<ShippingService["loadShipmentForFinalize"]>>>
  ): void {
    if (shipment.rolls.length === 0 && shipment.swatches.length === 0) {
      throw AppError.badRequest("Boş sevkiyat hazırlanamaz — önce top/kartela okut");
    }
    if (shipment.sacks.length === 0) {
      throw AppError.badRequest("Önce en az bir çuval aç");
    }
    const looseRolls = shipment.rolls.filter((r) => !r.sackId).map((r) => r.barcode ?? r.id);
    const looseSwatches = shipment.swatches.filter((s) => !s.sackId).map((s) => s.barcode);
    if (looseRolls.length > 0 || looseSwatches.length > 0) {
      throw AppError.badRequest(
        `Şu top/kartelalar henüz bir çuvalda değil: ${[...looseRolls, ...looseSwatches].join(", ")}`
      );
    }
    // Hayalet çuval: içi boş çuval irsaliyede çuval sayısını ve toplam kg'ı şişirir.
    const usedSackIds = new Set<string>();
    for (const r of shipment.rolls) if (r.sackId) usedSackIds.add(r.sackId);
    for (const s of shipment.swatches) if (s.sackId) usedSackIds.add(s.sackId);
    const emptySacks = shipment.sacks.filter((s) => !usedSackIds.has(s.id)).map((s) => s.seq);
    if (emptySacks.length > 0) {
      throw AppError.badRequest(
        `Şu çuvallar boş: ${emptySacks.map((n) => `#${n}`).join(", ")} — silin veya içine top/kartela okutun`
      );
    }
    // Saha #19: tartı zorunluluğu yalnız EXPORT — yurtiçi sevk kg'sız çıkabilir
    // (irsaliyede kg boş kalır). Kod zorunluluğu iki kapsamda da sürer.
    if (shipment.destination === ShipmentDestination.EXPORT) {
      const unweighed = shipment.sacks
        .filter((s) => s.weightKg == null || !new Prisma.Decimal(s.weightKg).greaterThan(0))
        .map((s) => s.seq);
      if (unweighed.length > 0) {
        throw AppError.badRequest(
          `Şu çuvalların tartısı girilmemiş (yurtdışı sevk): ${unweighed.map((n) => `#${n}`).join(", ")}`
        );
      }
    }
    const uncoded = shipment.sacks.filter((s) => !s.manualCode || !s.manualCode.trim()).map((s) => s.seq);
    if (uncoded.length > 0) {
      throw AppError.badRequest(
        `Şu çuvalların kodu girilmemiş: ${uncoded.map((n) => `#${n}`).join(", ")}`
      );
    }
  }

  /** Spec-toplam → seçilen sipariş satırlarına termin→tarih FIFO tahsis (DISPATCH'te yazılır). */
  private computeShipmentAllocation(
    shipment: NonNullable<Awaited<ReturnType<ShippingService["loadShipmentForFinalize"]>>>
  ): { alloc: Map<string, Prisma.Decimal>; orderIds: string[]; rollIds: string[] } {
    // Sipariş eklenirken CANCELLED/COMPLETED reddedilir ama finalize anına kadar
    // sipariş iptal/kapatılmış olabilir (PREPARING penceresi günler sürebilir).
    // İptal/kapalı siparişin satırlarına tahsis + shippedQty YAZILMAZ — fiziken
    // çıkan mal iptal siparişe alacaklanmaz, aynı spec'teki canlı siparişler açık
    // kalmaz. Sevkiyat bloklanmaz; mal yine çıkar, yalnız o siparişe sayılmaz.
    const allocatableOrders = shipment.orders.filter(
      (so) => so.order.status !== "CANCELLED" && so.order.status !== "COMPLETED"
    );
    const linesForAlloc: LineForAlloc[] = allocatableOrders.flatMap((so) =>
      so.order.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        colorId: l.colorId,
        width: l.width,
        quantity: new Prisma.Decimal(l.quantity),
        shippedQty: new Prisma.Decimal(l.shippedQty),
        deadline: so.order.deadline,
        orderDate: so.order.orderDate,
        lineCreatedAt: l.createdAt,
      }))
    );
    // Yalnız WAREHOUSE toplar sevke katılır. İptal/scrap edilmiş ama shipmentId'si
    // (legacy/edge) duran toplar tahsise sayılmaz ve SHIPPED'a "diriltilmez".
    const shippableRolls = shipment.rolls.filter(
      (r) => r.status === RollStatus.WAREHOUSE
    );
    const rollsForAlloc: RollSpec[] = shippableRolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    }));
    return {
      alloc: allocate(rollsForAlloc, linesForAlloc),
      orderIds: shipment.orders.map((o) => o.orderId),
      rollIds: shippableRolls.map((r) => r.id),
    };
  }

  /**
   * COMMIT — karşılanmayı KESİNLEŞTİR. PREPARING'den İLK çıkışta (Çuval Depo / Kapı Önü /
   * direkt Sevk) bir kez çağrılır: tahsis kayıtları + satır shippedQty + sipariş status.
   * Böylece çuvallanmış mal (3 ay beklese bile) "karşılandı" sayılır → MRP tekrar üretmez.
   * STOK (Roll.SHIPPED) burada DÜŞMEZ — o yalnız fiziksel çıkışta (DISPATCHED).
   */
  private async commitGoodsTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    alloc: Map<string, Prisma.Decimal>,
    orderIds: string[]
  ): Promise<void> {
    for (const [orderLineId, qty] of alloc) {
      await tx.shipmentAllocation.create({ data: { shipmentId, orderLineId, qty } });
      await tx.orderLine.update({ where: { id: orderLineId }, data: { shippedQty: { increment: qty } } });
    }
    await recomputeOrderStatusForOrders(tx, orderIds);
  }

  /** Commit GERİ AL — hazırlığa dönüş/iptalde: shippedQty düş + tahsisleri sil + status senkron. */
  private async reverseCommitTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    allocations: { orderLineId: string; qty: Prisma.Decimal }[],
    orderIds: string[]
  ): Promise<void> {
    for (const a of allocations) {
      await tx.orderLine.update({ where: { id: a.orderLineId }, data: { shippedQty: { decrement: a.qty } } });
    }
    await tx.shipmentAllocation.deleteMany({ where: { shipmentId } });
    await recomputeOrderStatusForOrders(tx, orderIds);
  }

  /**
   * Çuval Depoya Kaldır (PREPARING → READY) — çuvallandı, firma içi depoda bekliyor
   * (ihracat aylarca). COMMIT burada yapılır (karşılanma işlenir). Toplar hâlâ WAREHOUSE
   * ama shipmentId dolu → serbest stoktan düşer. STOK çıkışı yalnız fiilen sevkte (DISPATCH).
   */
  async markReady(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await this.loadShipmentForFinalize(shipmentId);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevkiyat zaten çuval depoda, kapı önünde veya sevk edilmiş");
    }
    this.assertReadyInvariants(shipment);

    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: status'u ÖNCE koşullu flip et — eşzamanlı 2. markReady (ikisi de
      // PREPARING okumuş) count===0 alıp temiz 409'la çıkar; aksi halde commitGoodsTx
      // İKİ KEZ çalışıp shippedQty'yi çift ARTIRIR. Bkz unmarkReady / tambur claim (~626).
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.PREPARING },
        // O-19: Sevke Hazır'a basan operatör izi.
        data: { status: ShipmentStatus.READY, readyAt: new Date(), readyById: userId ?? null },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      }
      // İÇERİĞİ TX İÇİNDE, claim SONRASI yeniden yükle (M-2): içerik tx'leri
      // touchShipmentPreparingTx ile aynı satırı kilitlediğinden bu noktada
      // içerik artık değişemez — tahsis/commit her zaman TAZE kümeyle yazılır.
      // (Pre-tx yükleme yalnız erken/ucuz 4xx'ler için kalır.)
      // OVER-COVER guard: kapsama yazılmadan ÖNCE bu siparişlerin OrderLine'larını
      // kilitle — aynı siparişi paylaşan ikinci bir sevkiyatın commit'i burada
      // bloklanır, taze shippedQty okunur → allocate() cap'i doğru clamp'ler.
      await this.lockShipmentOrderLinesTx(tx, shipmentId);
      const fresh = await this.loadShipmentForFinalize(shipmentId, tx);
      if (!fresh) throw AppError.notFound("Sevkiyat bulunamadı");
      this.assertReadyInvariants(fresh);
      const { alloc, orderIds } = this.computeShipmentAllocation(fresh);
      await this.commitGoodsTx(tx, shipmentId, alloc, orderIds);
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "READY", rollCount: shipment.rolls.length, sackCount: shipment.sacks.length },
    });
    return {
      success: true,
      data: { shipmentId, rollCount: shipment.rolls.length },
      message: "Çuval depoya kaldırıldı — firma içinde bekliyor (karşılanma işlendi, stok çıkışta düşer)",
    };
  }

  /**
   * Kapı Önüne Koy (PREPARING/READY → AT_DOOR) — kamyon bekliyor. PREPARING'den geliyorsa
   * COMMIT yapılır (READY'den geliyorsa zaten commit'li). STOK hâlâ binada; "Alındı" onayı
   * (dispatch) ile SHIPPED olur. Sevk onayı bayrağı açıkken çıkışın zorunlu durağı.
   */
  async moveToDoor(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await this.loadShipmentForFinalize(shipmentId);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.AT_DOOR) {
      return { success: true, data: { shipmentId }, message: "Sevkiyat zaten kapı önünde" };
    }
    if (shipment.status !== ShipmentStatus.PREPARING && shipment.status !== ShipmentStatus.READY) {
      throw AppError.conflict("Yalnız hazırlanan veya çuval depodaki sevkiyat kapı önüne konabilir");
    }
    this.assertReadyInvariants(shipment);

    const fromPreparing = shipment.status === ShipmentStatus.PREPARING;
    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: gözlenen TAM status'a (PREPARING|READY) koşullu flip — fromPreparing
      // kararı tutarlı kalır. Aksi halde READY'ye kaçan kayıt için fromPreparing bayatlar
      // ve commitGoodsTx ÇİFT çalışırdı (shippedQty fazla artar).
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: shipment.status },
        data: { status: ShipmentStatus.AT_DOOR, readyAt: shipment.readyAt ?? new Date() },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      }
      // İçerik TX İÇİNDE, claim SONRASI yeniden yüklenir (M-2 — markReady ile aynı).
      if (fromPreparing) {
        await this.lockShipmentOrderLinesTx(tx, shipmentId); // over-cover guard (markReady ile aynı)
        const fresh = await this.loadShipmentForFinalize(shipmentId, tx);
        if (!fresh) throw AppError.notFound("Sevkiyat bulunamadı");
        this.assertReadyInvariants(fresh);
        const { alloc, orderIds } = this.computeShipmentAllocation(fresh);
        await this.commitGoodsTx(tx, shipmentId, alloc, orderIds);
      }
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "AT_DOOR", from: shipment.status, committed: fromPreparing },
    });
    return {
      success: true,
      data: { shipmentId },
      message: "Kapı önüne kondu — kamyon/'Alındı' onayı bekliyor",
    };
  }

  /** Kapı önünden geri çek (AT_DOOR → READY) — çuval depoya iade. Commit korunur (stok değişmez). */
  async pullBackFromDoor(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.READY) {
      return { success: true, data: { shipmentId }, message: "Sevkiyat zaten çuval depoda" };
    }
    if (shipment.status !== ShipmentStatus.AT_DOOR) {
      throw AppError.conflict("Yalnız kapı önündeki sevkiyat geri çekilir");
    }
    // ATOMİK CLAIM: koşullu flip (tek statement = atomik); eşzamanlı 2. geri-çekme
    // count===0 → 409. Yan etki yok (commit/stok değişmez), tx gerekmez.
    const claim = await prisma.shipment.updateMany({
      where: { id: shipmentId, status: ShipmentStatus.AT_DOOR },
      data: { status: ShipmentStatus.READY },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    }
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "PULL_BACK_FROM_DOOR", from: "AT_DOOR", to: "READY" },
    });
    return { success: true, data: { shipmentId }, message: "Kapı önünden çuval depoya geri çekildi" };
  }

  /**
   * Çuval depodan hazırlığa GERİ AL (READY → PREPARING) — düzenleme için (top ekle/çıkar).
   * READY commit'li olduğundan karşılanma GERİ ALINIR (shippedQty düş + tahsis sil); toplar
   * zaten WAREHOUSE (SHIPPED değil), shipmentId/sackId korunur → tekrar düzenlenebilir.
   */
  async unmarkReady(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.PREPARING) {
      return { success: true, data: { shipmentId }, message: "Sevkiyat zaten hazırlanıyor" };
    }
    if (shipment.status !== ShipmentStatus.READY) {
      throw AppError.conflict("Yalnız çuval depodaki (bekleyen) sevkiyat hazırlığa geri alınır");
    }
    let reversedCount = 0;
    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: status'u ÖNCE koşullu flip et. Eşzamanlı ikinci unmarkReady
      // (ikisi de tx dışında READY okumuş olabilir) burada count===0 alıp temiz
      // 409 ile çıkar; aksi halde reverseCommitTx İKİ KEZ çalışıp shippedQty'yi
      // çift düşürür (floor guard yok → NEGATİFE iner) + tahsisleri çift siler.
      // Aynı desen: tambur claim (~626), scan roll-sahiplenme (~843).
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.READY },
        data: { status: ShipmentStatus.PREPARING, readyAt: null },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      }
      // F101: tahsis + sipariş kümesini claim'den SONRA, kilit ALTINDA taze oku.
      // Pre-tx snapshot bayat olabilir — araya giren removeRoll/retargetOrders
      // status'u DEĞİŞTİRMEDEN ShipmentAllocation'ı yeniden yazar; bayat snapshot
      // ile reverseCommit shippedQty'yi negatife sürükler + güncel tahsisi siler.
      const freshAllocations = await tx.shipmentAllocation.findMany({
        where: { shipmentId },
        select: { orderLineId: true, qty: true },
      });
      const freshOrders = await tx.shipmentOrder.findMany({
        where: { shipmentId },
        select: { orderId: true },
      });
      reversedCount = freshAllocations.length;
      await this.reverseCommitTx(
        tx,
        shipmentId,
        freshAllocations,
        freshOrders.map((o) => o.orderId),
      );
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "UNREADY", from: "READY", to: "PREPARING", reversedAllocations: reversedCount },
    });
    return { success: true, data: { shipmentId }, message: "Çuval depodan hazırlığa geri alındı — düzenlenebilir" };
  }

  /**
   * Sevk / Alındı (fiziksel çıkış) — "kamyon aldı" anı: toplar SHIPPED, stok BİNA DIŞI
   * (stok yalnız burada düşer). Karşılanma (commit) PREPARING'den çıkışta zaten yazıldıysa
   * tekrar yazılmaz; yalnız PREPARING'den DİREKT sevkte burada commit edilir.
   * Sevk onayı bayrağı (shipmentConfirmationEnabled):
   *  - KAPALI: PREPARING/READY/AT_DOOR → DISPATCHED (kapı önü atlanır, direkt müşteriye gitti).
   *  - AÇIK: yalnız AT_DOOR → DISPATCHED — çıkış onayı ("Alındı") kapı önünden verilir.
   * İptalde geri alınamaz (DISPATCHED kilitli).
   */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const confirmRequired = await readShipmentConfirmationEnabled();
    const shipment = await this.loadShipmentForFinalize(shipmentId);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevkiyat zaten sevk edilmiş");
    }
    if (confirmRequired) {
      if (shipment.status !== ShipmentStatus.AT_DOOR) {
        throw AppError.conflict(
          "Sevk onayı açık — önce 'Kapı Önüne Koy'; çıkış onayı ('Alındı') kapı önünden verilir"
        );
      }
    } else if (
      shipment.status !== ShipmentStatus.PREPARING &&
      shipment.status !== ShipmentStatus.READY &&
      shipment.status !== ShipmentStatus.AT_DOOR
    ) {
      throw AppError.conflict("Yalnızca hazırlanan, çuval depodaki veya kapı önündeki sevkiyat sevk edilebilir");
    }
    this.assertReadyInvariants(shipment);

    const fromPreparing = shipment.status === ShipmentStatus.PREPARING;
    const now = new Date();

    const { alloc, rollIds } = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: gözlenen TAM status'tan DISPATCHED'e koşullu flip et (sevk meta'sıyla
      // birlikte). Eşzamanlı 2. sevk count===0 → 409 → çift commit / çift stok-çıkışı YOK;
      // fromPreparing kararı tutarlı kalır.
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: shipment.status },
        data: {
          status: ShipmentStatus.DISPATCHED,
          dispatchedAt: now,
          dispatchedById: userId ?? null, // O-19: sevk eden (kamyona veren) operatör izi
          readyAt: shipment.readyAt ?? now,
          ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
          ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
          ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      }
      // F103: sevkiyat artık aktif değil (DISPATCHED) → shipment_orders.isActive=false.
      // Partial unique (orderId WHERE isActive) böylece o siparişe YENİ sevkiyat açmaya
      // izin verir; bayat true kalırsa yanlışlıkla bloklardı.
      await tx.shipmentOrder.updateMany({
        where: { shipmentId },
        data: { isActive: false },
      });
      // İÇERİK TX İÇİNDE, claim SONRASI yeniden yüklenir (M-2): tahsis, SHIPPED
      // flip'i ve donan irsaliye HER ZAMAN taze kümeyle yazılır — eşzamanlı
      // removeRoll'un düşürdüğü top SHIPPED'a "diriltilemez", eşzamanlı scan'in
      // eklediği top irsaliyesiz kalamaz (içerik tx'leri touch ile serileşir).
      // PREPARING'den direkt sevkte commit BURADA olur → cap taze okunmadan önce
      // OrderLine'ları kilitle (over-cover guard, markReady ile aynı). READY/AT_DOOR'dan
      // gelen sevkte commit zaten yazılmış, kilide gerek yok.
      if (fromPreparing) await this.lockShipmentOrderLinesTx(tx, shipmentId);
      const freshShipment = await this.loadShipmentForFinalize(shipmentId, tx);
      if (!freshShipment) throw AppError.notFound("Sevkiyat bulunamadı");
      this.assertReadyInvariants(freshShipment);
      const fresh = this.computeShipmentAllocation(freshShipment);
      // Henüz commit edilmemişse (PREPARING'den direkt sevk) karşılanmayı kesinleştir.
      if (fromPreparing) await this.commitGoodsTx(tx, shipmentId, fresh.alloc, fresh.orderIds);
      // FİZİKSEL STOK ÇIKIŞI — toplar SHIPPED (yalnız bu noktada bina dışı).
      if (fresh.rollIds.length > 0) {
        await tx.roll.updateMany({
          where: { id: { in: fresh.rollIds }, status: RollStatus.WAREHOUSE },
          data: { status: RollStatus.SHIPPED },
        });
      }
      // RESMİ BELGE — sevk irsaliyesi v1 BURADA donar (içerik + şablon override +
      // firma künyesi). Kaynak sonradan değişse bile belge sabit kalır; düzeltme
      // yalnız gerekçeli revizyonla (reissue) yapılır. Tx içinde: sevk başarılıysa
      // belge de garantidir.
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SHIPMENT_DISPATCH,
        shipmentId,
        userId
      );
      return { alloc: fresh.alloc, rollIds: fresh.rollIds };
    });

    const allocatedTotal = [...alloc.values()].reduce((s, q) => s.plus(q), D0());
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: {
        kind: "DISPATCH",
        fromStatus: shipment.status,
        committedNow: fromPreparing,
        rollCount: rollIds.length,
        allocatedLines: alloc.size,
        allocatedTotal: allocatedTotal.toString(),
        plateNumber: data.plateNumber ?? null,
        driverName: data.driverName ?? null,
      },
    });
    return {
      success: true,
      data: { shipmentId, rollCount: rollIds.length, allocatedLines: alloc.size },
      message: "Sevk edildi — stok bina dışı, karşılanma kesinleşti",
    };
  }

  // =========================================================================
  // İPTAL (yıkıcı) — önizleme + uygula
  // =========================================================================

  /** İptal önizleme — depoya dönecek toplar + karşılanması geri alınacak siparişler. */
  async getCancelPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        _count: { select: { swatches: true, sacks: true } },
        allocations: {
          select: {
            qty: true,
            orderLine: { select: { order: { select: { orderNumber: true } } } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    const canCancel = shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED;

    // Karşılanması geri alınacak siparişler (sipariş bazında metraj)
    const byOrder = new Map<string, Prisma.Decimal>();
    for (const a of shipment.allocations) {
      const ord = a.orderLine.order.orderNumber;
      byOrder.set(ord, (byOrder.get(ord) ?? D0()).plus(a.qty));
    }

    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        canCancel,
        reason: canCancel ? null : "Sevk edilmiş veya iptal edilmiş sevkiyat iptal edilemez.",
        rolls: shipment.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: r.currentQty,
          itemName: r.item.name,
          colorName: r.color?.name ?? null,
        })),
        swatchCount: shipment._count.swatches,
        sackCount: shipment._count.sacks,
        affectedOrders: [...byOrder.entries()].map(([orderNumber, qty]) => ({
          orderNumber,
          qty: qty.toString(),
        })),
      },
    };
  }

  /**
   * Sevkiyatı iptal et (soft → CANCELLED). PREPARING/READY iptal edilebilir: toplar/kartelalar
   * serbest (status zaten WAREHOUSE — karşılanma sevkte düşer, burada dokunulmaz), çuvallar (tartı)
   * silinir. DISPATCHED iptal edilemez. (Tahsis geri alma yalnız legacy kayıt güvenliği için kaldı.)
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        rolls: { select: { id: true } },
        allocations: { select: { id: true, orderLineId: true, qty: true } },
        orders: { select: { orderId: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) {
      return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    }
    if (shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");
    }

    const rollIds = shipment.rolls.map((r) => r.id);
    const orderIds = shipment.orders.map((o) => o.orderId);
    // F104: markReady (commitGoodsTx) karşılanmayı READY'de yazar → READY/AT_DOOR
    // sevkiyatta tahsis VARDIR. hadAllocations=true ise iptal shippedQty'yi geri alır;
    // ancak toplar READY'de hâlâ WAREHOUSE (stok yalnız DISPATCH'te SHIPPED düşer) —
    // statü restorasyonu bu yüzden SADECE SHIPPED legacy toplara uygulanır (aşağıda).
    const hadAllocations = shipment.allocations.length > 0;

    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: gözlenen TAM status'tan (PREPARING|READY|AT_DOOR) CANCELLED'e koşullu
      // flip et. Eşzamanlı 2. iptal veya dispatch+iptal yarışı count===0 → 409: tahsis ÇİFT
      // geri-alınmaz (shippedQty negatife inmez) ve DISPATCHED olan iptal edilemez.
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: shipment.status },
        data: { status: ShipmentStatus.CANCELLED },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      }
      // F103: sevkiyat artık aktif değil (CANCELLED) → shipment_orders.isActive=false,
      // ki o siparişlere yeni sevkiyat açılabilsin (partial unique orderId WHERE isActive).
      await tx.shipmentOrder.updateMany({
        where: { shipmentId },
        data: { isActive: false },
      });
      // Tahsis varsa geri al — satır shippedQty düş + tahsis sil (legacy güvenliği)
      if (hadAllocations) {
        for (const a of shipment.allocations) {
          await tx.orderLine.update({
            where: { id: a.orderLineId },
            data: { shippedQty: { decrement: a.qty } },
          });
        }
        await tx.shipmentAllocation.deleteMany({ where: { shipmentId } });
      }
      // F104: Statü restorasyonu ÖNCE (link dururken) ve YALNIZ fiziksel çıkışı
      // yapılmış (SHIPPED) legacy toplara — iptal/scrap edilmiş edge topu (shipmentId'si
      // duran ama CANCELLED/SCRAP olan) koşulsuz WAREHOUSE flip'i DİRİLTMESİN.
      if (hadAllocations) {
        await tx.roll.updateMany({
          where: { shipmentId, status: RollStatus.SHIPPED },
          data: { status: RollStatus.WAREHOUSE },
        });
      }
      // Bağ koparma: TÜM bağlı toplar sevkiyat/çuvaldan ayrılır (statüye DOKUNMADAN).
      // CANLI where (M-2): snapshot rollIds yerine {shipmentId} — eşzamanlı scan'le
      // eklenen topu kaçırmaz (swatch temizliğiyle aynı dil).
      await tx.roll.updateMany({
        where: { shipmentId },
        data: { shipmentId: null, sackId: null },
      });
      // Kartelalar serbest
      await tx.swatch.updateMany({ where: { shipmentId }, data: { shipmentId: null, sackId: null } });
      // Çuvallar (tartı) silinir
      await tx.sack.deleteMany({ where: { shipmentId } });
      // Sipariş status/shippedQty senkron (yalnız tahsis geri alındıysa)
      if (hadAllocations) await recomputeOrderStatusForOrders(tx, orderIds);
      // (Sevkiyat status=CANCELLED yukarıdaki atomik claim'de yazıldı.)
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "CANCEL", freedRolls: rollIds.length, reversedAllocations: shipment.allocations.length },
    });

    return {
      success: true,
      data: { shipmentId, freedRolls: rollIds.length },
      message:
        rollIds.length > 0
          ? `Sevkiyat iptal edildi — ${rollIds.length} top depoya döndü`
          : "Sevkiyat iptal edildi",
    };
  }

  // =========================================================================
  // SİPARİŞ SEÇİM EKRANI — açık siparişler + depo karşılaması (Mod A girişi)
  // =========================================================================

  /**
   * Açık siparişler + her satırda depo karşılaması. Personel sipariş-önce ekranı:
   * "depodaki mal bu siparişi karşılıyor mu". Depo serbest stoğu (shipmentId=null,
   * WAREHOUSE) açık satırlara termin→tarih FIFO greedy dağıtılarak satır başına
   * "depodan karşılanabilir" gösterilir (rezerve YOK — anlık foto). Termine sıralı.
   */
  async listOpenOrdersWithCoverage(params: {
    customerId?: string;
    branchId?: string | null;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    };
    if (params.customerId) where.customerId = params.customerId;
    if (params.branchId !== undefined) where.branchId = params.branchId;

    const orders = await prisma.order.findMany({
      where,
      take: 300,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deadline: true,
        orderDate: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        lines: {
          select: {
            id: true,
            itemId: true,
            colorId: true,
            width: true,
            quantity: true,
            shippedQty: true,
            customerItemName: true,
            customerColorName: true,
            createdAt: true,
            item: { select: { id: true, code: true, name: true } },
            color: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Bu siparişler zaten aktif (PREPARING/READY) bir sevkiyatta mı? → ekranda "Sürdür".
    const activeLinks = await prisma.shipmentOrder.findMany({
      where: {
        orderId: { in: orders.map((o) => o.id) },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY, ShipmentStatus.AT_DOOR] } },
      },
      select: { orderId: true, shipment: { select: { id: true, shipmentNo: true, status: true } } },
    });
    const activeByOrder = new Map<string, { id: string; shipmentNo: string; status: ShipmentStatus }>();
    for (const a of activeLinks) activeByOrder.set(a.orderId, a.shipment);

    // Depodaki serbest stok — spec bazında TOPLAM (groupBy; tüm roll satırlarını
    // belleğe çekmez). Anlık foto: rezerve YOK, çift sayım serbest (aynı spec birden
    // çok kalemde tam stoğu görür) — gerçek tahsis Sevke Hazır'da FIFO yapılır.
    // (Eski hâl tüm rolleri yükleyip global FIFO koşuyordu → ağır + başka müşterinin
    //  önceliği yüzünden "yanlış eksik" görünebiliyordu.)
    const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
    const stockBySpec = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width"],
      where: { shipmentId: null, status: RollStatus.WAREHOUSE, itemId: { in: itemIds } },
      _sum: { currentQty: true },
    });
    // Bir satırın spec'ine uyan toplam depo stoğu (renk/en line'da boşsa gevşek eşleşir).
    const specAvail = (line: {
      itemId: string;
      colorId: string | null;
      width: Prisma.Decimal | null;
    }): Prisma.Decimal =>
      stockBySpec.reduce((sum, g) => {
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId !== line.colorId) return sum;
        if (
          line.width != null &&
          (g.width == null || !new Prisma.Decimal(line.width).equals(g.width))
        ) {
          return sum;
        }
        return sum.plus(g._sum.currentQty ?? 0);
      }, D0());

    const data = orders.map((o) => ({
      order: {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        deadline: o.deadline,
        customer: o.customer,
        branch: o.branch,
        activeShipment: activeByOrder.get(o.id) ?? null, // doluysa: zaten sevkiyatta → "Sürdür"
      },
      lines: o.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const openQty = requested.minus(shipped);
        const fromWarehouse = specAvail(l);
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped,
          openQty,
          warehouseAvailable: fromWarehouse, // o spec'ten depodaki toplam (anlık, rezerve yok)
          covered: openQty.lessThanOrEqualTo(0) || fromWarehouse.greaterThanOrEqualTo(openQty),
        };
      }),
    }));

    return { success: true, data };
  }
}

export const shippingService = new ShippingService();

// =============================================================================
// RESMİ BELGE — Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici üç yolda kullanılır: freeze (dispatchShipment tx'i), reissue
// (gerekçeli revizyon, güncel veriden) ve lazy-init (eski DISPATCHED kayıtların
// geriye dönük dondurulması). Yalnız DISPATCHED sevkiyat belgelenir — öncesi
// TASLAK'tır (client canlı detayla "TASLAK" filigranlı render eder, belge yok).
// `doc` payload'ı render'a hazır çözülmüş görüntü değerleri taşır (müşteri
// alias'ları uygulanmış adlar, sayısallaştırılmış metrajlar) — irsaliye bir kez
// donduktan sonra master data değişiklikleri belgeye sızamaz.
/**
 * Sevk belgesi KANONİK içeriği (ornek-fis.pdf 3 bölümü) — ShipmentDispatchDoc
 * ile birebir tek şekil. Hem muhasebe "Sevk Fişi" (getDispatchReport, canlı) hem
 * sevk irsaliyesi donmuş belgesi (SHIPMENT_DISPATCH) hem baskı HTML'i
 * (renderShipmentDispatchHtml) bunu kullanır → fiş ile irsaliye BİREBİR aynı.
 *   ÜRÜN (item+renk+en grubu) · ÇUVAL (AMB → metre/kg/paket) · ÇEKİ (top × çuval).
 * requireDispatched=true → yalnız DISPATCHED belgelenir (freeze/reissue/lazy);
 * false → canlı önizleme (TASLAK) + muhasebe fişi.
 */
async function collectShipmentDocContent(
  db: PrintedDocDb,
  shipmentId: string,
  opts: { requireDispatched: boolean }
): Promise<ShipmentDispatchDoc | null> {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true,
      status: true,
      procedureCode: true,
      destination: true,
      dispatchedAt: true,
      createdAt: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      customer: { select: { code: true, name: true, taxNumber: true } },
      branch: { select: { name: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        select: {
          seq: true,
          manualCode: true,
          weightKg: true,
          rolls: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              barcode: true,
              currentQty: true,
              width: true,
              item: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!sh) return null;
  if (opts.requireDispatched && sh.status !== ShipmentStatus.DISPATCHED) return null;

  // ÜRÜN (item+renk+en grubu) + ÇUVAL (AMB → metre/kg/paket).
  const productMap = new Map<
    string,
    { name: string; rollCount: number; totalMeters: Prisma.Decimal }
  >();
  const sackRows = sh.sacks.map((sk) => {
    let sackMeters = D0();
    for (const r of sk.rolls) {
      sackMeters = sackMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      const g = productMap.get(stokAdi) ?? { name: stokAdi, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
    }
    return {
      code: sk.manualCode ?? `#${sk.seq}`,
      seq: sk.seq,
      totalMeters: Number(sackMeters),
      totalKg: sk.weightKg != null ? Number(sk.weightKg) : 0,
      packageCount: sk.rolls.length,
    };
  });

  // ÇEKİ — çuval × top; kg yalnız çuvalın İLK topunda (çeki cetveli formatı).
  const cekiRows = sh.sacks.flatMap((sk) =>
    sk.rolls.map((r, idx) => ({
      rollId: r.id, // saha #7: toplu etiket için
      sackCode: sk.manualCode ?? `#${sk.seq}`,
      barcode: r.barcode,
      desen: r.item.name,
      varyant: r.color?.name ?? "",
      meters: Number(r.currentQty),
      kg: idx === 0 && sk.weightKg != null ? Number(sk.weightKg) : 0,
    }))
  );

  const products = [...productMap.values()].map((p) => ({
    name: p.name,
    rollCount: p.rollCount,
    totalMeters: Number(p.totalMeters),
  }));
  const totalRolls = products.reduce((s, p) => s + p.rollCount, 0);
  const totalMeters = sackRows.reduce((s, r) => s + r.totalMeters, 0);
  const totalKg = sackRows.reduce((s, r) => s + r.totalKg, 0);
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");

  return {
    header: {
      shipmentNo: sh.shipmentNo,
      customerName: sh.customer.name,
      customerCode: sh.customer.code,
      customerTaxNumber: sh.customer.taxNumber ?? null,
      branchName: sh.branch?.name ?? null,
      procedureCode: sh.procedureCode,
      destination: sh.destination,
      status: sh.status,
      date: (sh.dispatchedAt ?? sh.createdAt).toISOString(),
      plateNumber: sh.plateNumber,
      driverName: sh.driverName,
      carrier: sh.carrier,
      orderNos,
    },
    products,
    sacks: sackRows,
    cekiRows,
    totals: { totalRolls, totalMeters, totalKg, sackCount: sh.sacks.length },
  };
}

/** Freeze / reissue / lazy-init — yalnız DISPATCHED sevkiyat belgelenir. */
async function buildShipmentDispatchDoc(
  db: PrintedDocDb,
  shipmentId: string
): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: true });
  if (!content) return null;
  return {
    documentNo: content.header.shipmentNo,
    doc: content as unknown as Record<string, unknown>,
  };
}

/** Canlı önizleme (TASLAK) — sevk öncesi de içerik üretir (getHtml ?draft yolu). */
async function buildShipmentDispatchPreview(
  db: PrintedDocDb,
  shipmentId: string
): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: false });
  if (!content) return null;
  return {
    documentNo: content.header.shipmentNo,
    doc: content as unknown as Record<string, unknown>,
  };
}

registerPrintedDocBuilder(PrintedDocType.SHIPMENT_DISPATCH, {
  fresh: buildShipmentDispatchDoc,
  // Tek-kaynak "SEVK İRSALİYESİ" HTML — mobil + Electron + muhasebe aynısını basar.
  renderHtml: renderShipmentDispatchHtml,
  // Sevk öncesi canlı önizleme (TASLAK) içerik üretici.
  buildPreview: buildShipmentDispatchPreview,
});
