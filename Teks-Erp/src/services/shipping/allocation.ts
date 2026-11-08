// =============================================================================
// Shipping Service / allocation
// =============================================================================
// Sevkiyat tahsis çekirdeği: çuval yükleme, sipariş aidiyeti, tartı kapısı, spec-FIFO tahsis yazımı + audit.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  ShipmentStatus,
  ShipmentDestination,
  OrderStatus,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  readShippingWeighRequiredEnabled,
} from "../system-setting.service";
import {
  assertSacksWeighed,
} from "../helpers/shipping-weigh-gate.helper";
import {
  readShippingAllocWidthToleranceCm,
  readShippingAllowOverAllocation,
} from "../system-setting.service";
import {
  NON_SACKABLE_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  distributeSacksToLines,
  type PoolSack,
  type SackAllocLine,
} from "../helpers/allocation.helper";
import { touchOrderLinesTx } from "../helpers/order-status.helper";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";
import { ACTIVE_SACK_ALLOCATION, clearShipmentAllocationsTx } from "../helpers/sack-allocation.helper";
import type { AllocationAuditTrail, ShippingServiceThis } from "./shared";

export async function loadSacksForShipment(
    sackIds: string[],
    target: { customerId: string; branchId: string | null }
  ) {
    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, customerId: true, branchId: true, shipmentId: true, weightKg: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (sacks.length !== sackIds.length) throw AppError.notFound("Bazı çuvallar bulunamadı");
    for (const s of sacks) {
      if (s.shipmentId != null) throw AppError.conflict("Çuvallardan biri zaten bir sevkiyatta");
      if (s._count.rolls === 0 && s._count.swatches === 0) throw AppError.badRequest("Boş çuval sevk edilemez");
      if (s.customerId != null && s.customerId !== target.customerId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka müşteriye ait — tek sevkiyat = tek müşteri.");
      }
      if (s.branchId != null && s.branchId !== target.branchId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka şubeye ait — tek sevkiyat = tek şube.");
      }
    }

    // HAYALET GUARD'I (2026-07-30) — defterin DONMUŞ belgeye girmeden düzeltilebileceği
    // SON nokta. Bu fonksiyon eskiden yalnız çuval düzeyine bakıyordu (`_count`),
    // içindeki topların STATÜSÜNE hiç bakmıyordu: çuvalda kayıtlı ama fiziksel olarak
    // binada olmayan top (kartelaya/tambura/fasona gitmiş) sevkiyata bağlanıyor, sevkte
    // `SHIPPED`'e eziliyor ve şişmiş metraj irsaliyede donuyordu.
    // Uyarıp geçmek YETMEZ: yanlış metraj hukuken bağlayıcı belgeye girer → 400.
    const ghosts = await prisma.roll.findMany({
      where: { sackId: { in: sackIds }, status: { in: NON_SACKABLE_STATUSES } },
      select: { barcode: true, status: true, sack: { select: { sackNo: true } } },
      take: 10,
    });
    if (ghosts.length > 0) {
      throw AppError.badRequest(
        "Sevkiyat kurulamaz — çuvalda kayıtlı ama fiziksel olarak binada olmayan top var: " +
          ghosts
            .map((g) => `${g.sack?.sackNo ?? "?"} / ${g.barcode ?? "(barkodsuz)"} → ${g.status}`)
            .join(", ") +
          '. "Paketleme / Çuvallar" ekranından bu topları çuvaldan çıkarın.'
      );
    }

    return { sacks, customerId: target.customerId, branchId: target.branchId };
  }

export async function assertOrdersBelong(orderIds: string[], customerId: string, branchId: string | null): Promise<void> {
    if (orderIds.length === 0) return;
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, customerId: true, branchId: true, status: true, orderNumber: true },
    });
    if (orders.length !== orderIds.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.customerId !== customerId) throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın müşterisine ait değil");
      if (branchId != null && o.branchId != null && o.branchId !== branchId) {
        throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın şubesine ait değil");
      }
      if (o.status === OrderStatus.CANCELLED) {
        throw AppError.badRequest(
          `${o.orderNumber} siparişi İPTAL edilmiş — sevkiyata eklenemez. Listeyi yenileyip malın gerçekten ait olduğu siparişi seçin.`,
        );
      }
    }
  }

export async function assertWeighed(
    sacks: { sackNo?: string | null; weightKg: Prisma.Decimal | null }[],
    destination: ShipmentDestination
  ): Promise<void> {
    assertSacksWeighed(sacks, destination, await readShippingWeighRequiredEnabled());
  }

export async function setShipmentOrdersTx(tx: Prisma.TransactionClient, shipmentId: string, orderIds: string[]): Promise<void> {
    const ids = [...new Set(orderIds)];
    await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
    if (ids.length > 0) {
      await tx.shipmentOrder.createMany({ data: ids.map((orderId) => ({ shipmentId, orderId, isActive: true })), skipDuplicates: true });
    }
  }

export async function computeSackAllocations(
    db: Prisma.TransactionClient,
    params: { sackIds: string[]; orderIds: string[]; branchId: string | null }
  ): Promise<{ allocations: { sackId: string; orderLineId: string; qty: Prisma.Decimal }[]; lineNeeds: Map<string, Prisma.Decimal> }> {
    const sacks = await db.sack.findMany({
      where: { id: { in: params.sackIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, rolls: { select: { itemId: true, colorId: true, width: true, currentQty: true } } },
    });
    const poolSacks: PoolSack[] = sacks.map((s) => ({
      sackId: s.id,
      branchId: params.branchId,
      rolls: s.rolls.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, currentQty: r.currentQty })),
    }));
    const lines = params.orderIds.length
      ? await db.orderLine.findMany({
          // İptal edilmiş kaleme tahsis yapılmaz (2026-08-27) — tek kaynak.
          where: { orderId: { in: params.orderIds }, ...ACTIVE_LINE },
          select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, createdAt: true, order: { select: { deadline: true, orderDate: true } } },
        })
      : [];
    // ── HENÜZ SEVK EDİLMEMİŞ AMA ZATEN AYRILMIŞ METRAJ (BULGU-T1-010) ────────
    // `shippedQty` yalnız DISPATCH'te terfi eder (defter kuralı, doğru). Ama
    // kapasite hesabı ondan İBARET olamaz: sevk onayı AÇIKKEN pazartesi kurulan
    // PLANNED sevkiyat 500 m'yi ayırır, salı kurulan ikinci sevkiyat `shippedQty`
    // hâlâ 0 olduğu için AYNI 500 m'yi bir daha ayırır ve ikisi sevk edilince
    // 500 m'lik kalem 1000 m sevk edilmiş olur. Sipariş COMPLETED, "Açık 0",
    // hiçbir uyarı yok, 500 m fazla mal müşteriye çıkmış. Bu bir YARIŞ DEĞİL —
    // ardışık iki meşru işlemin sonucu, yani kilitle çözülmez.
    // ⚠️ Bu düşüm hiçbir RAKAMI değiştirmez (`shippedQty`, İstenen|Sevk|Açık
    // aynı kalır) — yalnız "bu kaleme daha ne kadar tahsis edilebilir"i
    // düzeltir. Fazla mal yine sevk edilebilir; tahsissiz kalır (mevcut
    // davranış), yani "fazla/eşleşmeyen sevk serbest" kuralı korunur.
    // Sevkiyatın KENDİ tahsisleri çağıran tarafından zaten silinmiştir
    // (`writeShipmentAllocationsTx` sil-yaz), o yüzden burada özel dışlama YOK.
    const planlanmis = new Map<string, Prisma.Decimal>();
    if (lines.length > 0) {
      const rows = await db.sackAllocation.groupBy({
        by: ["orderLineId"],
        where: {
          orderLineId: { in: lines.map((l) => l.id) },
          sack: { shipment: { status: ShipmentStatus.PLANNED } },
          ...ACTIVE_SACK_ALLOCATION,
        },
        _sum: { qty: true },
      });
      for (const r of rows) planlanmis.set(r.orderLineId, new Prisma.Decimal(r._sum.qty ?? 0));
    }

    const allocLines: SackAllocLine[] = [];
    const lineNeeds = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const need = new Prisma.Decimal(l.quantity)
        .minus(l.shippedQty)
        .minus(planlanmis.get(l.id) ?? 0);
      lineNeeds.set(l.id, need);
      if (need.greaterThan(0)) {
        allocLines.push({
          id: l.id, itemId: l.itemId, colorId: l.colorId, width: l.width, branchId: params.branchId,
          need, deadline: l.order.deadline, orderDate: l.order.orderDate, lineCreatedAt: l.createdAt,
        });
      }
    }
    // EN TOLERANSI (`shipping.allocWidthToleranceCm`, 2026-09-06) — 0 = tam eşitlik
    // ve bu VARSAYILAN, yani bayrak açılmadıkça tahsis bugünküyle bayt-bayt aynı.
    // Kumaş ve renk toleranstan ETKİLENMEZ (`specMatch` yalnız eni gevşetir).
    const enTolerans = await readShippingAllocWidthToleranceCm();
    // FAZLA SEVK (`shipping.allowOverAllocation`) — kapalı = bugünkü davranış.
    const fazlaSevk = await readShippingAllowOverAllocation();
    const allocations = distributeSacksToLines(poolSacks, allocLines, enTolerans, fazlaSevk);
    return { allocations, lineNeeds };
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function writeShipmentAllocationsTx(this: ShippingServiceThis, 
    tx: Prisma.TransactionClient,
    shipmentId: string,
    orderIds: string[],
    branchId: string | null
  ): Promise<AllocationAuditTrail | null> {
    // Eski tahsis SİLİNMEZ, damgalanır (K2) — okuyucular ACTIVE_SACK_ALLOCATION süzer.
    await clearShipmentAllocationsTx(tx, shipmentId, null);
    if (orderIds.length === 0) return null;
    const sackRows = await tx.sack.findMany({ where: { shipmentId }, select: { id: true } });
    const sackIds = sackRows.map((s) => s.id);
    if (sackIds.length === 0) return null;

    // ① Etkilenen siparişlerin TAM satır kümesini kilitle (alt-küme kilidi
    //    deadlock riski taşır — `touchOrderLinesTx` id'leri sıralı alır).
    const lockRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lockRows.map((l) => l.id));

    // ② Kilit ALTINDA taze doğrulama: sipariş bu arada iptal edilmiş olabilir.
    //    `ACTIVE_LINE` yalnız KALEM iptalini süzer; başlık iptali kalemlere
    //    `cancelledAt` DAMGALAMAZ (order.service `Order.status`ı yazar, o kadar)
    //    → bu boşluk buradan kapanıyor. `ACTIVE_LINE`ın kendisine sipariş
    //    durumunu EKLEMEDİK bilinçli olarak: o yüklem "açık talep"in tek
    //    kaynağıdır ve karşılanma/denge/rapor yüzeylerinin hepsini birden
    //    değiştirmek bu düzeltmenin kapsamı değil.
    const liveOrders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, status: true },
    });
    const cancelled = liveOrders.filter((o) => o.status === OrderStatus.CANCELLED);
    if (cancelled.length > 0) {
      throw AppError.conflict(
        `${cancelled.map((o) => o.orderNumber).join(", ")} bu sırada İPTAL edildi — sevkiyat kurulmadı. ` +
          "Listeyi yenileyip malın gerçekten ait olduğu siparişi seçin.",
        { code: "ORDER_CANCELLED_DURING_SHIPMENT" },
      );
    }

    const { allocations, lineNeeds } = await this.computeSackAllocations(tx, { sackIds, orderIds, branchId });
    if (allocations.length > 0) {
      await tx.sackAllocation.createMany({ data: allocations.map((a) => ({ sackId: a.sackId, orderLineId: a.orderLineId, qty: a.qty })) });
    }

    // ── SEVK DEFTERİNİN İZİ (2026-08-29 / BULGU-T2-003) ─────────────────────
    // `SackAllocation` MALİ ETKİSİ OLAN tek defterdir (sipariş karşılanması
    // ondan türer) ve değişim geçmişi HİÇ YOKTU. "Sipariş 'Açık 1000 m'
    // görünüyor ama operatör sevk ettim diyor" sorusunda destek `system_logs`'a
    // bakınca yalnız `SHIPMENT CREATE {orderIds}` buluyordu: tahsisin HİÇ
    // yazılmadığı mı, yazılıp SİLİNDİĞİ mi, hangi metrajla yazıldığı mı ayırt
    // edilemiyordu. Bu denetimde birebir yaşandı ve mekanizma kaynak kodu
    // okunarak tahmin edildi.
    //
    // ⚠️ ATLANAN kalemler de yazılıyor ve asıl değer orada: "şu satıra neden
    // yazılmadı" sorusunu tek satırda cevaplar (kalan kapasite 0 mıydı, spec
    // tutmadı mı). Yazılanı görmek yarım cevaptır.
    // Kayıt tx DIŞINDA değil İÇİNDE değil — `AuditService.log` best-effort ve
    // tx'e girmez (CLAUDE.md: audit yazımı isteği düşürmez).
    return {
      shipmentId,
      yazilan: allocations.map((a) => ({ orderLineId: a.orderLineId, qty: Number(a.qty) })),
      atlanan: [...lineNeeds.entries()]
        .filter(([lineId]) => !allocations.some((a) => a.orderLineId === lineId))
        .map(([orderLineId, need]) => ({ orderLineId, need: Number(need) })),
    };
  }

export async function flushAllocationAudit(
    iz: {
      shipmentId: string;
      yazilan: { orderLineId: string; qty: number }[];
      atlanan: { orderLineId: string; need: number }[];
      tahsissizMetraj?: number;
    } | null,
    userId?: string,
  ): Promise<void> {
    if (!iz) return;
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK_ALLOCATION",
      recordId: iz.shipmentId,
      newData: {
        kind: "ALLOCATIONS_REWRITTEN",
        yazilan: iz.yazilan,
        atlanan: iz.atlanan,
        ...(iz.tahsissizMetraj !== undefined ? { tahsissizMetraj: iz.tahsissizMetraj } : {}),
      },
    });
  }
