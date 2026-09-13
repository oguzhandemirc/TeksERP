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
//
// TİP = BAĞIN AYNASI (2026-08-21): `WorkOrder.type` bağ eklenince STOK →
// SİPARİŞE ÖZEL, son bağ kalkınca SİPARİŞE ÖZEL → STOK olur (aynı tx, atomik,
// her iki yön). Aksi hâlde detay paneli siparişi gösterirken liste/künye/kart
// "Stok" basıyordu. Geçmiş kayıtlar için `scripts/fix_workorder_type_from_links.ts`
// (dry-run varsayılan). Sipariş iptali de aynı kuralı uygular (order.service).
// =============================================================================

import { Prisma, OrderStatus, RollStatus, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ACTIVE_LINE, isMeasuredLine } from "./helpers/order-line-scope.helper";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { InventoryService } from "./inventory.service";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";
import { ACTIVE_ROLL_PROPERTY } from "./helpers/property-revoke.helper";
import {
  PLAN_CHANGE_FROZEN_STATUSES,
  assertPlanChangeAllowed,
  assertTargetColorChange,
} from "./helpers/workorder-target-color.helper";

/** Toplu uygulama TEKİL motoru çağırır — kural kopyalanmaz (bkz. applyAttributeToRolls). */
const inventoryService = new InventoryService();

/** Değişiklik sebebi için asgari uzunluk — "x" gibi geçiştirme izleri işe yaramaz. */
const MIN_REASON_LENGTH = 3;

/**
 * BAĞ işlemlerine (bağla / bağı kaldır / toplara uygula) KAPALI durumlar.
 *
 * ⚠️ COMPLETED BİLEREK YOK: bitmiş iş emrine uyumlu sipariş bağlanabilir (stok
 * için üretildi, sonra sipariş geldi) ve topları düzeltilebilir. PLAN
 * değişiklikleri (renk / en / uyumsuz-bağ override) ise COMPLETED'da da
 * kapalıdır — o küme `PLAN_CHANGE_FROZEN_STATUSES` (workorder-target-color
 * helper, 2026-08-21 kullanıcı kararı).
 */
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
  /**
   * Henüz karşılanmamış metraj (istenen − sevk). Negatife düşmez. KG/ADET satırda
   * `null` — karşılama metre defterinden ölçülmez; satır yine bağlanabilir.
   */
  openQty: number | null;
  /** `openQty` ölçülüyor mu (`unit === MT`). */
  measured: boolean;
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

async function loadWo(
  workOrderId: string,
  // Kilit altında TAZE okuma için tx istemcisi geçilebilir (BULGU-T3-016).
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<WoForLink> {
  const wo = await db.workOrder.findUnique({
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

/**
 * Toplu düzeltmeye KAPALI statüler — tekil `applyManualProperties`'in
 * `ALWAYS_BLOCKED` listesiyle BİREBİR aynı. Burada tekrar yazılmasının sebebi
 * ÖNİZLEME: operatöre "bu top neden değişmeyecek" diye önceden söyleyebilmek
 * için listeye ihtiyacımız var. Uygulama yine tekil motordan geçer, yani
 * gerçek koruma orada — bu liste yalnız erken ve dürüst bir cevap.
 */
const ROLL_EDIT_BLOCKED: RollStatus[] = [
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.AT_KARTELA,
  RollStatus.TAMBUR_CONSUMED,
  RollStatus.SUBCONTRACTOR_CONSUMED,
  RollStatus.KARTELA_CONSUMED,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
  RollStatus.SHIPPED,
  RollStatus.CANCELLED,
];

const BLOCK_LABEL: Partial<Record<RollStatus, string>> = {
  AT_SUBCONTRACTOR: "fasonda",
  AT_KARTELA: "kartelada",
  TAMBUR_CONSUMED: "kesildi",
  SUBCONTRACTOR_CONSUMED: "fasona verildi",
  KARTELA_CONSUMED: "kartelaya gitti",
  RETURNED_FROM_SUBCONTRACTOR: "fason dönüşü",
  SHIPPED: "sevk edildi",
  CANCELLED: "iptal",
};

// "Bu iş emrinin topları" — tanım `helpers/workorder-rolls.helper.ts`'e taşındı
// (renk bekçisi de aynı kümeyi sayıyor; iki tanım ayrışmasın). Dışarıya aynı
// adla açık kalır.
export { whereRollsOfWorkOrder };

export interface RollAttributeTarget {
  batchId: string | null;
  batchNumber: string | null;
  rolls: {
    id: string;
    barcode: string | null;
    status: RollStatus;
    colorName: string | null;
    width: number | null;
    /** null → değiştirilebilir. Doluysa kısa sebep ("fasonda", "sevk edildi"). */
    blocked: string | null;
  }[];
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
        // Siparişin KENDİSİ ayakta olsa bile iptal edilmiş KALEM aday değildir.
        ...ACTIVE_LINE,
      },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        unit: true,
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
      const measured = isMeasuredLine(l);
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
        openQty: measured ? Math.max(0, quantity - shippedQty) : null,
        measured,
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
  ): Promise<
    ApiResponse<{ linked: number; alreadyLinked: number; warnings: string[]; typeChanged: boolean }>
  > {
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
        cancelledAt: true,
        order: { select: { status: true, orderNumber: true } },
      },
    });
    if (lines.length !== ids.length) {
      throw AppError.badRequest("Bazı sipariş satırları bulunamadı.");
    }
    // İptal edilmiş KALEM: sessizce süzmek YANLIŞ olurdu — planlamacı seçtiği
    // kalemin listeye girmediğini göremez ve iş emrini eksik açar. Sipariş
    // iptalindeki gibi AÇIK RED (bayat ekranla gelen istek de burada durur).
    const cancelledLines = lines.filter((l) => l.cancelledAt !== null);
    if (cancelledLines.length > 0) {
      throw AppError.badRequest(
        `İptal edilmiş sipariş kalemine iş emri bağlanamaz (${cancelledLines.length} kalem). ` +
          "Ekranı yenileyip tekrar deneyin.",
      );
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

    // ── TİP BAĞI İZLER: STOK → SİPARİŞE ÖZEL (2026-08-21 saha hatası) ───────
    // `WorkOrder.type` bir beyan DEĞİL, bağın aynasıdır: panel formu (`buildPayload`)
    // ve Hızlı İş Emri (`createFromRolls`) tipi zaten "sipariş satırı var mı"dan
    // türetir. Bu uç pivot satırını yazıp tipe DOKUNMUYORDU; sahada iş emri önce
    // stok için açılıp sonra buradan siparişe bağlanınca detay paneli siparişi
    // gösteriyor, liste/künye/refakat kartı ise hâlâ "Stok" basıyordu (yedekte
    // 13 iş emri, hepsi bu sırayla). Aynı tx'te ve ATOMİK (`updateMany WHERE
    // type=STOCK` — yarışta iki çağrı da güvenle geçer); sessiz değil, audit'e
    // `typeChanged` yazılır ve mesajda söylenir. Tersi `unlinkOrderLine`'da:
    // son bağ kalkınca STOK'a döner (simetrik — tip her iki yönde bağı izler).
    let typeChanged = false;
    if (toCreate.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.workOrderToOrderLine.createMany({
          data: toCreate.map((orderLineId) => ({ workOrderId, orderLineId, allocatedQty: 0 })),
          skipDuplicates: true,
        });
        if (wo.type === WorkOrderType.STOCK_PRODUCTION) {
          const flipped = await tx.workOrder.updateMany({
            where: { id: workOrderId, type: WorkOrderType.STOCK_PRODUCTION },
            data: { type: WorkOrderType.ORDER_PRODUCTION },
          });
          typeChanged = flipped.count > 0;
        }
        // Refakat kartında sipariş bloğu + tip basılı → kâğıt bayatladı.
        await markTravelerCardDirtyTx(tx, workOrderId);
      });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      // `type` iki tarafta da varsa künye "Ne değişti" satırı üretir (diffCommonFields);
      // anlatı alanları (event/orderLineIds/...) ham blokta kalır.
      oldData: typeChanged ? { type: WorkOrderType.STOCK_PRODUCTION } : undefined,
      newData: {
        event: "ORDER_LINK_ADDED",
        orderLineIds: toCreate,
        alreadyLinked: [...existingSet],
        warnings,
        typeChanged,
        ...(typeChanged ? { type: WorkOrderType.ORDER_PRODUCTION } : {}),
      },
    });

    return {
      success: true,
      data: { linked: toCreate.length, alreadyLinked: existingSet.size, warnings, typeChanged },
      message:
        toCreate.length > 0
          ? `${toCreate.length} sipariş satırı bağlandı.` +
            (typeChanged ? " İş emri artık Siparişe Özel." : "")
          : "Seçilen satırlar zaten bağlıydı.",
    };
  }

  /**
   * Bağı kaldırır. TİP = BAĞIN AYNASI (2026-08-21, simetrik tur): siparişe özel
   * iş emrinin SON bağı kalkınca iş emri STOK üretimine döner — eskiden son bağ
   * "tipini yalanlar" diye REDDEDİLİYORDU; tip artık bağı izlediği için yalan
   * kalmadı, red de kalktı. Tek ön koşul STOK'un kendi değişmezi: hedef kumaş
   * dolu olmalı (`create` ORDER iş emrinde kumaşı siparişten türettiği için
   * pratikte hep doludur; yedekte 0 boş).
   */
  async unlinkOrderLine(
    workOrderId: string,
    orderLineId: string,
    userId?: string,
  ): Promise<ApiResponse<{ removed: boolean; typeChanged: boolean }>> {
    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);

    const links = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId },
      select: { orderLineId: true },
    });
    if (!links.some((l) => l.orderLineId === orderLineId)) {
      throw AppError.notFound("Bu sipariş satırı bu iş emrine bağlı değil.");
    }
    const lastLinkOfOrderWo = wo.type === WorkOrderType.ORDER_PRODUCTION && links.length === 1;
    if (lastLinkOfOrderWo && !wo.targetItemId) {
      throw AppError.badRequest(
        "Son sipariş bağı kaldırılınca iş emri stok üretimine döner; bunun için hedef kumaş " +
          "tanımlı olmalı — önce 'Düzenle'den hedef kumaşı seçin.",
      );
    }

    let typeChanged = false;
    await prisma.$transaction(async (tx) => {
      await tx.workOrderToOrderLine.delete({
        where: { workOrderId_orderLineId: { workOrderId, orderLineId } },
      });
      if (lastLinkOfOrderWo) {
        // Atomik: yarışta bu arada yeni bağ eklendiyse tip ORDER kalmalı →
        // taze bağ sayımıyla karar; `updateMany WHERE type=ORDER` çiftini
        // tek yazmaya indirir.
        const remaining = await tx.workOrderToOrderLine.count({ where: { workOrderId } });
        if (remaining === 0) {
          const flipped = await tx.workOrder.updateMany({
            where: { id: workOrderId, type: WorkOrderType.ORDER_PRODUCTION },
            data: { type: WorkOrderType.STOCK_PRODUCTION },
          });
          typeChanged = flipped.count > 0;
        }
      }
      await markTravelerCardDirtyTx(tx, workOrderId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: typeChanged ? { type: WorkOrderType.ORDER_PRODUCTION } : undefined,
      newData: {
        event: "ORDER_LINK_REMOVED",
        orderLineId,
        typeChanged,
        ...(typeChanged ? { type: WorkOrderType.STOCK_PRODUCTION } : {}),
      },
    });

    return {
      success: true,
      data: { removed: true, typeChanged },
      message: "Sipariş bağı kaldırıldı." + (typeChanged ? " İş emri artık Stok üretimi." : ""),
    };
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
    opts: { confirmPartial?: boolean; recolorRollIds?: readonly string[] } = {},
  ): Promise<ApiResponse<{ warnings: string[]; partial: { dyedCount: number; pendingCount: number } | null }>> {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw AppError.badRequest("Renk değişikliği için sebep yazmalısınız.");
    }
    const wo = await loadWo(workOrderId);
    if (wo.targetColorId === colorId) {
      throw AppError.badRequest("İş emri zaten bu renkte.");
    }

    // ⚠️ BEKÇİ + CLAIM AYNI KİLİDİN ALTINDA (BULGU-T3-016). Eskiden bekçi tx
    // DIŞINDA koşuyordu ve fason kabulünün commit penceresinde (~600 ms, çok
    // toplu kabulde daha uzun) mal–plan kuralı ATLANABİLİYORDU:
    //
    //   T1 tablet: `receive` tx'i açık, `touchWorkOrderTx` WO satırını kilitledi,
    //              doğan toplar ESKİ hedef renkle (MAVİ) yazılıyor.
    //   T2 panel:  `changeTargetColor(MAVİ→KIRMIZI)`; bekçi kilit DIŞINDA okur,
    //              canlı boyanmış top 0 görür (hepsi AT_SUBCONTRACTOR) → SERBEST.
    //   T1 commit: mal içeride, MAVİ.
    //   T2 claim:  `targetColorId = MAVİ` hâlâ doğru (kabul o kolona dokunmadı)
    //              → geçer. Sonuç: plan KIRMIZI, elde MAVİ toplar; verilmesi
    //              gereken 409 COLOR_DYED_BLOCKED hiç üretilmez.
    //
    // ⚠️ YENİ KURAL DEĞİL — 2026-08-21'de verilen kararın (COLOR_DYED_BLOCKED /
    // COLOR_PARTIAL_CONFIRM + Tebdil/yeni iş emri/topları düzelt seçenekleri)
    // güvenilir hâle gelmesi. Operatörün yapabildiği hiçbir şey yapılamaz
    // olmuyor; yalnız cevabın doğru olması garanti altına alınıyor.
    // ⚠️ BEDELİ (bilinçli): "Rengi Değiştir" artık o iş emrinde koşan bir fason
    // kabulünün bitmesini BEKLER. `touchWorkOrderTx` ile aynı satır kilidi.
    // ⚠️ Audit tx DIŞINDA kalır (proje kuralı); `markTravelerCardDirtyTx` içeride.
    const { gate, claimCount } = await prisma.$transaction(async (tx) => {
      // İLK İFADE — sıra load-bearing: kilit bekçiden SONRA alınsaydı hiçbir şey
      // kazandırmazdı (KK1 advisory kilidi ve parti sayacı ile aynı ders).
      await touchWorkOrderTx(tx, workOrderId);
      // Kilit altında TAZE oku: kabul commit ettiyse doğan toplar artık görünür.
      const tazeWo = await loadWo(workOrderId, tx);
      // TEK BEKÇİ (2026-08-21): terminal statü + renk aktif + izinli renk listesi +
      // MAL–PLAN uyumu (boyanmış top ↔ yeni renk; düzeltilecekler hariç) + rota
      // kapsaması uyarısı — "Düzenle" ile birebir aynı kurallar (helper başlığı).
      const g = await assertTargetColorChange(tx, tazeWo, colorId, {
        confirmPartial: opts.confirmPartial,
        recolorRollIds: opts.recolorRollIds,
      });
      // Atomik claim: eşzamanlı tamamlanma/iptal/devir sırasında yazma sızmasın;
      // `targetColorId` koşulu bekçinin baktığı değerin hâlâ geçerli olduğunu
      // iddia eder (kilit altında olduğu için artık gerçekten öyle).
      const c = await tx.workOrder.updateMany({
        where: {
          id: workOrderId,
          status: { notIn: PLAN_CHANGE_FROZEN_STATUSES },
          targetColorId: tazeWo.targetColorId,
        },
        data: { targetColorId: colorId },
      });
      if (c.count > 0) await markTravelerCardDirtyTx(tx, workOrderId);
      return { gate: g, claimCount: c.count };
    });
    if (claimCount === 0) {
      throw AppError.conflict(
        "İş emri bu sırada değişti (tamamlandı, iptal edildi ya da rengi başka biri değiştirdi) — yenileyip tekrar deneyin.",
      );
    }

    let newColorName: string | null = null;
    if (colorId) {
      const color = await prisma.color.findUnique({
        where: { id: colorId },
        select: { name: true },
      });
      newColorName = color?.name ?? null;
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
    const warnings = [
      ...gate.warnings,
      ...links
        .filter((l) => l.orderLine.colorId !== colorId)
        .map(
          (l) =>
            `${l.orderLine.order.orderNumber} siparişi "${l.orderLine.color?.name ?? "renksiz"}" istiyor.`,
        ),
    ];


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
        // Kısmi boyada onaylı geçildiyse iz: kaç top eski renkte kaldı.
        ...(gate.partial ? { partialConfirmed: gate.partial } : {}),
      },
    });

    return {
      success: true,
      data: { warnings, partial: gate.partial },
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
    // Plan değişikliği: COMPLETED da kapalı (2026-08-21; renkle aynı küme).
    assertPlanChangeAllowed(wo);

    const previousWidth = num(wo.width);
    if (previousWidth === width) throw AppError.badRequest("İş emrinin eni zaten bu değerde.");

    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, status: { notIn: PLAN_CHANGE_FROZEN_STATUSES } },
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

  /**
   * "Bu değişiklik toplara da yansısın mı?" — hedef listesi (partiye göre).
   *
   * İŞ EMRİ = PLAN, TOP = ÖLÇÜM. Plan değişikliği ölçümü kendiliğinden EZMEZ;
   * ama saha vakası gerçek: mal baştan yanlış kaydedilmiş olabilir ("pembe 330
   * yazıyor, aslında ekru 325"). O yüzden yansıtma otomatik değil, aynı
   * ekranda TEK DOKUNUŞLA seçilebilen ayrı bir adım (2026-08-17 kullanıcı
   * kararı: "sahadaki eleman unutmasın, orada sorulsun").
   *
   * Parti bazında gruplanır çünkü yanlış kayıt tipik olarak PARTİ bazında olur
   * (bir dönüş, bir kabul, bir vardiya).
   */
  async getRollAttributeTargets(workOrderId: string): Promise<ApiResponse<RollAttributeTarget[]>> {
    await loadWo(workOrderId);
    const rolls = await prisma.roll.findMany({
      // ⚠️ `Roll.workOrderId` DİYE BİR KOLON YOK. Bir topun iş emrine bağı üç
      // yoldan kurulur ve üçü de meşru: üretildiği adım, şu an durduğu adım,
      // ya da üyesi olduğu parti. `getAttachedRolls` ilk ikisini kullanıyor;
      // burada partiyi de ekliyoruz çünkü ekran PARTİ bazında gruplayacak ve
      // adımı geçmiş (finalize olmuş) toplar da düzeltme adayıdır.
      where: whereRollsOfWorkOrder(workOrderId),
      select: {
        id: true,
        barcode: true,
        status: true,
        width: true,
        color: { select: { name: true } },
        batch: { select: { id: true, batchNumber: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const byBatch = new Map<string, RollAttributeTarget>();
    for (const r of rolls) {
      const key = r.batch?.id ?? "__none__";
      if (!byBatch.has(key)) {
        byBatch.set(key, {
          batchId: r.batch?.id ?? null,
          batchNumber: r.batch?.batchNumber ?? null,
          rolls: [],
        });
      }
      byBatch.get(key)!.rolls.push({
        id: r.id,
        barcode: r.barcode,
        status: r.status,
        colorName: r.color?.name ?? null,
        width: num(r.width),
        blocked: ROLL_EDIT_BLOCKED.includes(r.status) ? (BLOCK_LABEL[r.status] ?? "uygun değil") : null,
      });
    }
    return { success: true, data: [...byBatch.values()] };
  }

  /**
   * Seçilen topların rengini/enini iş emriyle aynı hale getirir.
   *
   * Motor TEKİL `applyManualProperties`tir — kapsam kuralları, yetki kontrolü
   * ve audit izi orada yaşıyor; burada ikinci bir kural kümesi KURULMAZ
   * (ayrışırsa toplu yol tekil yolun reddettiği şeyi yapar). Bu metot yalnız
   * döngü + kısmi sonuç raporudur.
   *
   * Kısmi başarı BİLİNÇLİ: 40 topluk bir partide biri sevk edilmişse diğer 39'u
   * düzeltmemek orantısız olurdu. Değişmeyenler `failed[]` ile geri döner.
   */
  async applyAttributeToRolls(
    workOrderId: string,
    data: { rollIds: string[]; colorId?: string | null; width?: number | null; reason: string },
    userId?: string,
    permissions?: readonly string[],
  ): Promise<ApiResponse<{ updated: number; failed: { rollId: string; barcode: string | null; message: string }[] }>> {
    const reason = (data.reason ?? "").trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw AppError.badRequest("Sebep yazmalısınız.");
    }
    const ids = [...new Set(data.rollIds)].filter(Boolean);
    if (ids.length === 0) throw AppError.badRequest("En az bir top seçmelisiniz.");
    if (data.colorId === undefined && data.width === undefined) {
      throw AppError.badRequest("Uygulanacak bir değer yok (renk veya en).");
    }

    const wo = await loadWo(workOrderId);
    assertPlanEditable(wo);

    const rolls = await prisma.roll.findMany({
      where: { AND: [{ id: { in: ids } }, whereRollsOfWorkOrder(workOrderId)] },
      select: {
        id: true,
        barcode: true,
        colorId: true,
        width: true,
        // ⚠️ ÖZELLİKLER GERİ YAZILMAK ZORUNDA. `applyManualProperties`
        // BAYRAK özelliklerinde REPLACE semantiği uygular: koşulsuz
        // `deleteMany(valueType:FLAG)` + gönderilen listeden `createMany`.
        // Boş dizi göndermek, yalnız RENGİ düzeltmek isterken topun
        // ZIMPARALI/vb. bayraklarını SESSİZCE SİLERDİ. (SEÇİM tipli satırlara
        // motor zaten dokunmuyor — onları taşımaya gerek yok.)
        properties: {
          where: { ...ACTIVE_ROLL_PROPERTY, property: { valueType: "FLAG" } },
          select: { propertyId: true },
        },
      },
    });
    if (rolls.length !== ids.length) {
      // Başka bir iş emrinin topunu buradan değiştirmek, kapsamı sessizce
      // genişletirdi — seçim listesi zaten bu WO'dan geliyor.
      throw AppError.badRequest("Seçilen toplardan bazıları bu iş emrine ait değil.");
    }

    // PLANLAMACI YETKİSİ (2026-08-21, kullanıcı kararı): "bu iş emrinin TÜM açık
    // kumaşlarının rengini düzelt" bir PLANLAMA düzeltmesidir — iş emri kapsamlı,
    // sebepli, audit'li. Tekil motor üretimdeki top için `roll:manual-adjust`
    // (süpervizör) ister; burada `workorder:write` taşıyan planlamacı da geçer:
    // motora izin listesi VERİLMEZ (= güvenilen dahili çağrı, F221) — ALWAYS_BLOCKED
    // (fasonda/sevk/kesim/iptal) ve sebep kuralı yine motorda koşar. Tekil Düzelt
    // ve Tambur "Düzelt" eski kuralla kalır (tamburun kendi hataları için).
    const engineOpts =
      permissions === undefined
        ? undefined
        : matchesPermission(permissions, "roll:manual-adjust") ||
            !matchesPermission(permissions, "workorder:write")
          ? { permissions }
          : undefined;

    const failed: { rollId: string; barcode: string | null; message: string }[] = [];
    let updated = 0;
    for (const roll of rolls) {
      try {
        await inventoryService.applyManualProperties(
          roll.id,
          {
            // `applyManualProperties` renk için NULL'ı "temizle" sayar; alan
            // gönderilmediğinde mevcut değeri korumak için topun kendi değerini
            // geri yazıyoruz (motorun sözleşmesi: colorId her zaman beklenir).
            colorId: data.colorId !== undefined ? data.colorId : roll.colorId,
            propertyIds: roll.properties.map((p) => p.propertyId),
            ...(data.width !== undefined ? { width: data.width } : {}),
            reason,
          },
          userId,
          engineOpts,
        );
        updated++;
      } catch (err) {
        failed.push({
          rollId: roll.id,
          barcode: roll.barcode,
          message: err instanceof Error ? err.message : "Bilinmeyen hata",
        });
      }
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: {
        event: "ROLL_ATTRIBUTE_BULK_APPLY",
        rollIds: ids,
        colorId: data.colorId,
        width: data.width,
        reason,
        updated,
        failedCount: failed.length,
      },
    });

    return {
      success: true,
      data: { updated, failed },
      message:
        failed.length === 0
          ? `${updated} top güncellendi.`
          : `${updated} top güncellendi, ${failed.length} top değişmedi.`,
    };
  }

  /**
   * UYUMSUZ SİPARİŞİ ONAYLA-DÜZELT-BAĞLA zinciri (2026-08-19, Tambur süpervizör
   * akışı — kullanıcı kararı: "top + WO hedefi + bağ" tek uçta).
   *
   * Saha senaryosu: tamburda süpervizör elindeki topa uyan siparişi listede
   * görüyor ama sistem "renk uyuşmuyor" diyor — çünkü İŞ EMRİ yanlış renkle
   * açılmış, mal aslında siparişin istediği renkte. Süpervizör "elindeki
   * gerçekten KIRMIZI mı?" sorusunu onaylar, sebep yazar; sistem üç işi
   * SIRAYLA yapar: ① plan düzeltilir (changeTargetColor/changeWidth),
   * ② iş emrinin düzeltilebilir topları yeni değere eşitlenir
   * (applyAttributeToRolls → tekil motor, kapsam+yetki orada), ③ bağ kurulur.
   *
   * ⚠️ KUMAŞ (cins) FARKI HER ZAMAN RED — topun cinsi hiçbir yoldan
   * değiştirilemez (applyManualProperties'te alan bilinçli yok); "patos'u
   * tergal yap" bir düzeltme değil, yanlış topa yanlış kimlik yazmaktır.
   *
   * ⚠️ TEK TRANSACTION DEĞİL — BİLİNÇLİ. Her adım kendi başına meşru ve kendi
   * audit izini bırakan bir işlemdir; sıra öyle seçildi ki sonraki adımın
   * düşmesi öncekini YANLIŞLAMAZ: plan düzeltmesi bağ kurulamasa da doğrudur
   * (gerçek buydu diye onaylandı). Toplardaki kısmi başarı (fasonda/sevk
   * edilmiş top düzeltilemez) bağı ENGELLEMEZ — o toplar zaten kapsam dışı,
   * kalan her şey rapor edilir.
   *
   * Yetki: route çift kapı (workorder:write + roll:manual-adjust) İSTER;
   * `permissions` yine de tekil motora geçirilir (F221 — çift emniyet,
   * üretimdeki top başına ikinci kontrol orada da koşar).
   */
  async linkOrderLineWithOverride(
    workOrderId: string,
    orderLineId: string,
    reason: string,
    userId?: string,
    permissions?: readonly string[],
  ): Promise<
    ApiResponse<{
      changedColor: boolean;
      changedWidth: boolean;
      rollsUpdated: number;
      rollsFailed: { rollId: string; barcode: string | null; message: string }[];
      linked: boolean;
      warnings: string[];
    }>
  > {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw AppError.badRequest("Bu işlem için sebep yazmalısınız.");
    }
    const wo = await loadWo(workOrderId);
    // Plan değişikliği zinciri — COMPLETED da kapalı (uyumlu normal bağ açık kalır).
    assertPlanChangeAllowed(wo);

    const line = await prisma.orderLine.findUnique({
      where: { id: orderLineId },
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
    if (!line) throw AppError.badRequest("Sipariş satırı bulunamadı.");
    if (line.order.status === OrderStatus.CANCELLED) {
      throw AppError.badRequest("İptal edilmiş siparişe iş emri bağlanamaz.");
    }
    if (wo.targetItemId && line.itemId !== wo.targetItemId) {
      throw AppError.badRequest(
        `Kumaş uyuşmuyor — bu zincir kumaşı DEĞİŞTİREMEZ (topun cinsi düzeltilemez). ` +
          `${line.order.orderNumber} siparişi "${line.item?.name ?? "—"}" istiyor.`,
      );
    }

    const colorDiff = (wo.targetColorId ?? null) !== (line.colorId ?? null);
    const lineWidth = num(line.width);
    const widthDiff = lineWidth != null && num(wo.width) !== lineWidth;
    // Fark yoksa bu uç yanlış kapı — normal bağlama yeter; sessizce ona düşmek
    // yerine söyle (istemci zaten uyumlu satırı normal uçtan bağlar).
    if (!colorDiff && !widthDiff) {
      throw AppError.badRequest(
        "Sipariş zaten iş emriyle uyumlu — normal 'Sipariş Bağla' kullanın.",
      );
    }

    // Düzeltilebilir toplar PLAN yazımından ÖNCE çözülür: bekçi "bu istekle
    // düzeltilecek toplar yeni renkte sayılır" (recolorRollIds) — yoksa boya
    // bitmiş bir iş emrinde zincir COLOR_DYED_BLOCKED'a çarpardı, oysa ② adımı
    // tam da o topları düzeltiyor. Adaylar tekil motorla aynı engel kümesinden.
    const targets = await this.getRollAttributeTargets(workOrderId);
    const editableIds = targets.data
      .flatMap((b) => b.rolls)
      .filter((r) => r.blocked === null)
      .map((r) => r.id);

    // ① Plan düzeltmesi (her biri kendi sebep+audit iziyle).
    const warnings: string[] = [];
    if (colorDiff) {
      // `confirmPartial: true` BİLİNÇLİ: bu zincirin öncülü "elimdeki mal ASLINDA
      // siparişin renginde" beyanıdır (süpervizör + sebep) ve ② adımı boyanmış
      // topları zaten yeni renge eşitler — "N top eski renkte kaldı" onayı burada
      // sorulsaydı cevabı önceden verilmiş bir soruyu tekrar sorardı.
      const res = await this.changeTargetColor(workOrderId, line.colorId ?? null, trimmed, userId, {
        confirmPartial: true,
        recolorRollIds: editableIds,
      });
      warnings.push(...res.data.warnings);
    }
    if (widthDiff) {
      await this.changeWidth(workOrderId, lineWidth, trimmed, userId, "MANUAL");
    }

    // ② Düzeltilebilir topları eşitle; kısmi başarı normaldir (failed[] rapora düşer).
    let rollsUpdated = 0;
    let rollsFailed: { rollId: string; barcode: string | null; message: string }[] = [];
    if (editableIds.length > 0) {
      const applied = await this.applyAttributeToRolls(
        workOrderId,
        {
          rollIds: editableIds,
          ...(colorDiff ? { colorId: line.colorId ?? null } : {}),
          ...(widthDiff ? { width: lineWidth } : {}),
          reason: trimmed,
        },
        userId,
        permissions,
      );
      rollsUpdated = applied.data.updated;
      rollsFailed = applied.data.failed;
    }

    // ③ Bağ — hedef artık satırla uyumlu, normal doğrulamadan geçer.
    const linkRes = await this.linkOrderLines(workOrderId, [orderLineId], userId);
    warnings.push(...linkRes.data.warnings);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: {
        event: "ORDER_LINK_OVERRIDE",
        orderLineId,
        reason: trimmed,
        changedColor: colorDiff,
        changedWidth: widthDiff,
        rollsUpdated,
        rollsFailedCount: rollsFailed.length,
      },
    });

    return {
      success: true,
      data: {
        changedColor: colorDiff,
        changedWidth: widthDiff,
        rollsUpdated,
        rollsFailed,
        linked: linkRes.data.linked > 0 || linkRes.data.alreadyLinked > 0,
        warnings,
      },
      message:
        `Sipariş bağlandı; plan ${[colorDiff && "renk", widthDiff && "en"].filter(Boolean).join(" + ")} ` +
        `düzeltildi, ${rollsUpdated} top eşitlendi` +
        (rollsFailed.length > 0 ? `, ${rollsFailed.length} top değişmedi` : "") +
        ".",
    };
  }
}

export const workOrderLinkService = new WorkOrderLinkService();
