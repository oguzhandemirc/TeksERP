// =============================================================================
// İŞ EMRİ — SİPARİŞ BAĞLAMA + HEDEF DÜZELTME (2026-08-17 saha talepleri 8/10/12)
// =============================================================================
// ÜÇ ayrı işlem, TEK ortak gerekçe: bunları yapmanın tek yolu "Düzenle" ekranını
// açmaktı ve o ekran iş emrinin HER ŞEYİNİ (rota, hedef, metraj) değiştirebiliyor.
// Boyahanede malı olan bir iş emrine sipariş bağlamak isteyen planlamacı, aynı
// ekranda yanlışlıkla rotayı da bozabiliyordu.
//
// ⚠️ EN ÖNEMLİ KURAL — BAĞLAMA MİRAS ALMAZ (madde 10).
// `WorkOrderService.update/replace` yolunda sipariş satırı bağlanınca hedef
// kumaş/renk sipariş satırından YENİDEN ÇÖZÜLÜYOR: renk açıkça gönderilmezse
// siparişinki YAZILIYOR. Sahadaki sonucu şuydu: boyahanede MAVİ olarak işlem
// gören iş emri, yanlış bir sipariş bağı yüzünden EKRU'ya dönüyordu — üstelik
// üretim çoktan başlamış, karar verilmişti.
//
// Buradaki uç HİÇBİR ŞEY miras almaz. Uyuşmazlık sessizce çözülmez, REDDEDİLİR
// ve hangi tarafın ne dediği mesajda yazar. Renk gerçekten değişecekse bu ayrı
// ve BİLİNÇLİ bir işlemdir: `changeTargetColor` (sebep zorunlu, iz bırakır).
//
// Kumaş/renk = SERT ENGEL · metraj/en = UYARI. Ayrım fiziksel: farklı kumaş ya
// da farklı renk üreten bir iş emri o siparişi KARŞILAYAMAZ; en farkı ise
// üretim sırasında meşruen değişir (çekmez payı, kenar kesimi) ve zaten
// `changeWidth` ile düzeltilir.
// =============================================================================

import { Prisma, OrderStatus, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";

/** Değişiklik sebebi için asgari uzunluk — "x" gibi geçiştirme izleri işe yaramaz. */
const MIN_REASON_LENGTH = 3;

/** İş emrinin planı üzerinde değişikliğe KAPALI durumları. */
const FROZEN_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.CANCELLED,
  WorkOrderStatus.SUPERSEDED,
];

export interface LinkableOrderLine {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  width: number | null;
  /** Sipariş kalemindeki toplam istenen metraj. */
  quantity: number;
  /** Bugüne kadar sevk edilen (denormalize `shippedQty`). */
  shippedQty: number;
  /** Henüz karşılanmamış metraj (istenen − sevk). Negatife düşmez. */
  openQty: number;
  deadline: string | null;
  /** En farkı gibi ENGEL OLMAYAN uyumsuzluklar — istemci uyarı olarak gösterir. */
  warnings: string[];
}

interface WoForLink {
  id: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
  type: WorkOrderType;
  targetItemId: string | null;
  targetColorId: string | null;
  width: Prisma.Decimal | null;
}

function assertPlanEditable(wo: { status: WorkOrderStatus; workOrderNumber: string }): void {
  if (FROZEN_STATUSES.includes(wo.status)) {
    throw AppError.conflict(
      `${wo.workOrderNumber} iptal edilmiş/devredilmiş durumda (${wo.status}) — planı değiştirilemez.`,
    );
  }
}

function num(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : Number(d);
}

async function loadWo(workOrderId: string): Promise<WoForLink> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      workOrderNumber: true,
      status: true,
      type: true,
      targetItemId: true,
      targetColorId: true,
      width: true,
    },
  });
  if (!wo) throw AppError.notFound("İş emri bulunamadı");
  return wo;
}

export class WorkOrderLinkService {
  /**
   * BAĞLANABİLİR sipariş satırları — iş emrinin hedefiyle uyumlu olanlar.
   *
   * Süzgeç kumaş + renk üzerinden kurulur (uyuşmayan satır zaten bağlanamaz,
   * listede göstermek operatörü boşuna denemeye çağırırdı). En farkı SÜZMEZ,
   * `warnings` ile işaretlenir.
   *
   * Hedefi olmayan (henüz belirlenmemiş) bir iş emrinde ilgili süzgeç
   * uygulanmaz — kural "hedefle çeliş" değil, "hedef VARSA ona uy".
   */
  async getLinkableOrderLines(workOrderId: string): Promise<ApiResponse<LinkableOrderLine[]>> {
    const wo = await loadWo(workOrderId);

    const alreadyLinked = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId },
      select: { orderLineId: true },
    });
    const linkedIds = alreadyLinked.map((l) => l.orderLineId);

    const lines = await prisma.orderLine.findMany({
      where: {
        ...(linkedIds.length > 0 ? { id: { notIn: linkedIds } } : {}),
        ...(wo.targetItemId ? { itemId: wo.targetItemId } : {}),
        ...(wo.targetColorId ? { colorId: wo.targetColorId } : {}),
        order: {
          // İptal + tamamlanmış siparişler aday değildir. `COMPLETED` bilinçli
          // dışarıda: kapanmış bir siparişe yeni üretim bağlamak, karşılanma
          // tablosunu geriye dönük bozar.
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
        },
      },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: [{ order: { deadline: "asc" } }, { createdAt: "asc" }],
      take: 200,
    });

    const woWidth = num(wo.width);
    const data: LinkableOrderLine[] = lines.map((l) => {
      const quantity = Number(l.quantity);
      const shippedQty = Number(l.shippedQty);
      const lineWidth = num(l.width);
      const warnings: string[] = [];
      if (woWidth != null && lineWidth != null && woWidth !== lineWidth) {
        warnings.push(`En farkı: iş emri ${woWidth} cm, sipariş ${lineWidth} cm`);
      }
      return {
        id: l.id,
        orderId: l.order.id,
        orderNumber: l.order.orderNumber,
        customerName: l.order.customer?.name ?? "—",
        itemId: l.itemId,
        itemName: l.item?.name ?? "—",
        colorId: l.colorId,
        colorName: l.color?.name ?? null,
        width: lineWidth,
        quantity,
        shippedQty,
        openQty: Math.max(0, quantity - shippedQty),
        deadline: l.order.deadline ? l.order.deadline.toISOString() : null,
        warnings,
      };
    });

    return { success: true, data };
  }

  /**
   * Sipariş satırlarını iş emrine BAĞLAR — başka hiçbir şeye dokunmadan.
   *
   * Miras YOK: `targetItemId`, `targetColorId`, `width`, hedef özellikler ve rota
   * OLDUĞU GİBİ kalır. Uyuşmazlık 400 ile reddedilir.
   */
  async linkOrderLines(
    workOrderId: string,
    orderLineIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ linked: number; alreadyLinked: number; warnings: string[] }>> {
    const ids = [...new Set(orderLineIds)].filter(Boolean);
    if (ids.length === 0) throw AppError.badRequest("En az bir sipariş satırı seçmelisiniz.");

    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);

    const lines = await prisma.orderLine.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        order: { select: { status: true, orderNumber: true } },
      },
    });
    if (lines.length !== ids.length) {
      throw AppError.badRequest("Bazı sipariş satırları bulunamadı.");
    }
    const cancelled = [
      ...new Set(
        lines.filter((l) => l.order.status === OrderStatus.CANCELLED).map((l) => l.order.orderNumber),
      ),
    ];
    if (cancelled.length > 0) {
      throw AppError.badRequest(`İptal edilmiş siparişe iş emri bağlanamaz: ${cancelled.join(", ")}`);
    }

    // ── SERT ENGEL: kumaş / renk uyuşmazlığı ────────────────────────────────
    // Mesaj İKİ TARAFI DA yazar. "Uyuşmuyor" tek başına planlamacıya hangi
    // tarafın yanlış olduğunu söylemez; hangisini düzelteceğine karar veremez.
    const targetColorName = wo.targetColorId
      ? (await prisma.color.findUnique({ where: { id: wo.targetColorId }, select: { name: true } }))?.name ?? "—"
      : null;
    const targetItemName = wo.targetItemId
      ? (await prisma.item.findUnique({ where: { id: wo.targetItemId }, select: { name: true } }))?.name ?? "—"
      : null;

    for (const l of lines) {
      if (wo.targetItemId && l.itemId !== wo.targetItemId) {
        throw AppError.badRequest(
          `Kumaş uyuşmuyor — ${wo.workOrderNumber} "${targetItemName}" üretiyor, ` +
            `${l.order.orderNumber} siparişi "${l.item?.name ?? "—"}" istiyor. ` +
            `Bu sipariş bu iş emriyle karşılanamaz.`,
        );
      }
      if (wo.targetColorId && l.colorId !== wo.targetColorId) {
        throw AppError.badRequest(
          `Renk uyuşmuyor — ${wo.workOrderNumber} "${targetColorName}" üretiyor, ` +
            `${l.order.orderNumber} siparişi "${l.color?.name ?? "renksiz"}" istiyor. ` +
            `Üretim rengi gerçekten değişecekse "Rengi Değiştir" ile değiştirin; ` +
            `sipariş bağlamak iş emrinin rengini DEĞİŞTİRMEZ.`,
        );
      }
    }

    // ── UYARI: en farkı (engel değil) ───────────────────────────────────────
    const woWidth = num(wo.width);
    const warnings: string[] = [];
    for (const l of lines) {
      const lw = num(l.width);
      if (woWidth != null && lw != null && woWidth !== lw) {
        warnings.push(
          `${l.order.orderNumber}: en farkı (iş emri ${woWidth} cm, sipariş ${lw} cm)`,
        );
      }
    }

    const existing = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId, orderLineId: { in: ids } },
      select: { orderLineId: true },
    });
    const existingSet = new Set(existing.map((e) => e.orderLineId));
    const toCreate = ids.filter((id) => !existingSet.has(id));

    if (toCreate.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.workOrderToOrderLine.createMany({
          data: toCreate.map((orderLineId) => ({ workOrderId, orderLineId, allocatedQty: 0 })),
          skipDuplicates: true,
        });
        // Refakat kartında sipariş bloğu basılı → kâğıt bayatladı.
        await markTravelerCardDirtyTx(tx, workOrderId);
      });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: {
        event: "ORDER_LINK_ADDED",
        orderLineIds: toCreate,
        alreadyLinked: [...existingSet],
        warnings,
      },
    });

    return {
      success: true,
      data: { linked: toCreate.length, alreadyLinked: existingSet.size, warnings },
      message:
        toCreate.length > 0
          ? `${toCreate.length} sipariş satırı bağlandı.`
          : "Seçilen satırlar zaten bağlıydı.",
    };
  }

  /** Bağı kaldırır. Siparişe özel iş emrinin SON bağı korunur (tipini yalanlar). */
  async unlinkOrderLine(
    workOrderId: string,
    orderLineId: string,
    userId?: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);

    const links = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId },
      select: { orderLineId: true },
    });
    if (!links.some((l) => l.orderLineId === orderLineId)) {
      throw AppError.notFound("Bu sipariş satırı bu iş emrine bağlı değil.");
    }
    if (wo.type === WorkOrderType.ORDER_PRODUCTION && links.length === 1) {
      throw AppError.badRequest(
        "Siparişe özel üretim iş emrinin son sipariş bağı kaldırılamaz — " +
          "önce başka bir sipariş bağlayın.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.workOrderToOrderLine.delete({
        where: { workOrderId_orderLineId: { workOrderId, orderLineId } },
      });
      await markTravelerCardDirtyTx(tx, workOrderId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: { event: "ORDER_LINK_REMOVED", orderLineId },
    });

    return { success: true, data: { removed: true }, message: "Sipariş bağı kaldırıldı." };
  }

  /**
   * ÜRETİM RENGİNİ DEĞİŞTİR (madde 10) — ayrı, bilinçli, izli bir işlem.
   *
   * Gerçek hayattaki karşılığı: iş emri boyahanedeyken müşteri telefonla arayıp
   * "maviyi değil ekruyu istiyoruz" der. Bu bilgi sistemde bir yere yazılmak
   * ZORUNDA (çeki, refakat kartı ve etiket ondan besleniyor) ama "Düzenle"
   * ekranından yapıldığında ne sebebi kalıyor ne de izi.
   *
   * Bağlı siparişlerle çelişki ENGEL DEĞİLDİR, uyarıdır: kararı veren müşteridir
   * ve sipariş satırı da sonradan düzeltilebilir. Engellemek, sahayı sistemin
   * dışında çalışmaya iterdi.
   */
  async changeTargetColor(
    workOrderId: string,
    colorId: string | null,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ warnings: string[] }>> {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw AppError.badRequest("Renk değişikliği için sebep yazmalısınız.");
    }
    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);
    if (wo.targetColorId === colorId) {
      throw AppError.badRequest("İş emri zaten bu renkte.");
    }

    let newColorName: string | null = null;
    if (colorId) {
      const color = await prisma.color.findUnique({
        where: { id: colorId },
        select: { name: true, isActive: true },
      });
      if (!color) throw AppError.badRequest("Renk bulunamadı.");
      if (!color.isActive) throw AppError.badRequest("Pasif bir renk seçilemez.");
      newColorName = color.name;
    }

    const links = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId },
      select: {
        orderLine: {
          select: {
            colorId: true,
            color: { select: { name: true } },
            order: { select: { orderNumber: true } },
          },
        },
      },
    });
    const warnings = links
      .filter((l) => l.orderLine.colorId !== colorId)
      .map(
        (l) =>
          `${l.orderLine.order.orderNumber} siparişi "${l.orderLine.color?.name ?? "renksiz"}" istiyor.`,
      );

    // Atomik claim: eşzamanlı iptal/devir sırasında yazma sızmasın.
    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, status: { notIn: FROZEN_STATUSES } },
      data: { targetColorId: colorId },
    });
    if (claim.count === 0) {
      throw AppError.conflict("İş emri bu sırada iptal edildi — renk değiştirilemedi.");
    }
    await markTravelerCardDirtyTx(prisma, workOrderId);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { targetColorId: wo.targetColorId },
      newData: {
        event: "TARGET_COLOR_CHANGED",
        targetColorId: colorId,
        colorName: newColorName,
        reason: trimmed,
        warnings,
      },
    });

    return {
      success: true,
      data: { warnings },
      message: `Üretim rengi "${newColorName ?? "renksiz"}" olarak güncellendi.`,
    };
  }

  /**
   * EN (cm) DEĞİŞTİR (madde 12) — "Rengi Değiştir" ile aynı aile.
   *
   * `source` çağrının nereden geldiğini işaretler: `MANUAL` (planlamacı düzeltti)
   * ya da `FASON_RECEIPT` (kabulde ölçülen en). İkisi de aynı kolonu yazar ama
   * izlerinin ayrılması gerekiyor — "çeki 300 diyordu, elimize 295 geldi"
   * sorusunun cevabı buradan okunur.
   */
  async changeWidth(
    workOrderId: string,
    width: number | null,
    reason: string,
    userId?: string,
    source: "MANUAL" | "FASON_RECEIPT" = "MANUAL",
  ): Promise<ApiResponse<{ previousWidth: number | null }>> {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw AppError.badRequest("En değişikliği için sebep yazmalısınız.");
    }
    if (width != null && (!Number.isFinite(width) || width <= 0 || width > 1000)) {
      throw AppError.badRequest("En 0 ile 1000 cm arasında olmalı.");
    }
    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);

    const previousWidth = num(wo.width);
    if (previousWidth === width) throw AppError.badRequest("İş emrinin eni zaten bu değerde.");

    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, status: { notIn: FROZEN_STATUSES } },
      data: { width: width == null ? null : new Prisma.Decimal(width) },
    });
    if (claim.count === 0) {
      throw AppError.conflict("İş emri bu sırada iptal edildi — en değiştirilemedi.");
    }
    // En, fason çekisindeki TEK "EN" değerinin kaynağı → kâğıt bayatladı.
    await markTravelerCardDirtyTx(prisma, workOrderId);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { width: previousWidth },
      newData: { event: "TARGET_WIDTH_CHANGED", width, reason: trimmed, source },
    });

    return {
      success: true,
      data: { previousWidth },
      message: `İş emrinin eni ${width ?? "—"} cm olarak güncellendi.`,
    };
  }
}

export const workOrderLinkService = new WorkOrderLinkService();
