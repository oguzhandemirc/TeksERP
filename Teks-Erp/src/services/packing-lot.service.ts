// =============================================================================
// SEVK PARTİSİ — yaşam döngüsü (sil · ambalaj no ez · cari özeti) ve sevkiyat
// kancaları (sevkle tamamlanma · storno ile yeniden açılma · bütün-parti kapısı)
//
// DURUM ELLE DEĞİŞMEZ (saha kararı 2026-09-22): parti "açık"tır (sevk edilmemiş çuvalı
// var ya da yeni doğdu) ve son çuvalı sevk edilince "sevk edildi" (CLOSED) olur —
// listeden düşer, adı/numarası yeni bir partiye yeniden verilebilir (kimlik `id`).
// Sevk edilen çuvallar bu ekrandan izlenmez; onların yeri Sevkiyatlar ekranıdır.
// =============================================================================
// `packing-group.service.ts`in parti-moduna ÖZGÜ yarısı: grup modunda bu uçlar 400
// `PACKING_LOT_MODE_OFF` verir. Aynı tablo (`PackingGroup`), ikinci davranış —
// tasarım ve kararlar docs/design/SEVK-PARTISI-TASARIM.md. Ayrı dosya: grup servisi
// dosya tavanını aşmasın ve grup modunun gövdesi parti kodundan ayrı okunsun.
// =============================================================================

import { Prisma } from "@prisma/client";

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { readPackingGroupsEnabled } from "./system-setting.service";
import { markSackLabelsStaleOnCustomerChangeTx, sackFieldsAppearOnLabel } from "./helpers/sack-label-stale.helper";
import {
  PackingLotSettings,
  readPackingLotSettings,
} from "./helpers/packing-group.helper";
import { assertPackageNoFreeTx } from "./helpers/packing-group.helper";

const GROUP_TABLE = "packing_groups";

/** Parti moduna ÖZGÜ uçlar (sil · numara ez · özet): grup modunda 400.
 *  Bayrak kapısı `packing-group.service`tekiyle aynı (403 `PACKING_GROUPS_DISABLED`). */
async function requireLotMode(): Promise<PackingLotSettings> {
  if (!(await readPackingGroupsEnabled())) {
    throw AppError.forbidden("Paketleme grubu özelliği kapalı", { code: "PACKING_GROUPS_DISABLED" });
  }
  const lot = await readPackingLotSettings();
  if (lot.mode !== "sevk-partisi") {
    throw AppError.badRequest("Bu işlem yalnız sevk partisi modunda var (ayar: Paketleme grubu davranışı)", {
      code: "PACKING_LOT_MODE_OFF",
    });
  }
  return lot;
}


/** Etiket alanları — numara/parti değişince basılmış etiket yalanlanır (`sackNote` kalıbı). */
const LOT_LABEL_KEYS = ["packageNo", "packingGroupName"] as const;

/**
 * Parti/numara değişen havuz çuvallarının etiketini BAYATLATIR — yalnız etkin
 * şablon bu alanları basıyorsa (opt-in alan; çoğu kurulumda kâğıda çıkmaz).
 * `labelDirty: false` koşulu gereksiz yazmayı eler; baskıda temizlenir.
 */
export async function markLotLabelsStale(customerId: string | null, sackIds: string[]): Promise<void> {
  if (sackIds.length === 0) return;
  if (!(await sackFieldsAppearOnLabel(customerId, LOT_LABEL_KEYS))) return;
  await prisma.sack.updateMany({
    where: { id: { in: sackIds }, shipmentId: null, labelDirty: false },
    data: { labelDirty: true },
  });
}

export interface PackingLotCustomerSummary {
  /** Başlıkta "hangi caridesin" göstermek için — liste ekranı customerId'den ad çözmez. */
  customer: { id: string; name: string };
  /** Partisiz havuz çuvalları (customerId = cari, packingGroupId NULL, shipmentId NULL). */
  ungrouped: { sackCount: number; rollCount: number; totalQty: number; weightKg: number | null };
  openLotCount: number;
  closedLotCount: number;
  /** Sevk edilmemiş (havuz + açık parti) çuvallardan tartısı olmayanlar. */
  unweighedSackCount: number;
}

export const PackingLotService = {
  /**
   * Cari çalışma alanının ÖZET ŞERİDİ (parti listesi ekranı): partisiz havuz + parti
   * sayıları. Tek where'den — "Partisiz" satırı ile o satıra tıklayınca gelen liste
   * (`filter[packingGroupId]=__ungrouped__`) aynı yüklemi paylaşır.
   */
  async customerSummary(customerId: string): Promise<ApiResponse<PackingLotCustomerSummary>> {
    await requireLotMode();
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
    if (!customer) throw AppError.notFound("Cari bulunamadı");
    const where = { customerId, packingGroupId: null, shipmentId: null } as const;
    const sacks = await prisma.sack.aggregate({ where, _count: { _all: true }, _sum: { weightKg: true } });
    const rolls = await prisma.roll.aggregate({ where: { sack: where }, _count: { _all: true }, _sum: { currentQty: true } });
    const weighed = await prisma.sack.count({ where: { ...where, weightKg: { not: null } } });
    // Tartılmamış çuval — carinin SEVK EDİLMEMİŞ bütün çuvalları (havuz + açık parti):
    // sevk öncesi eksik iş; kart tıklanınca liste "Tartılmadı" süzgeciyle açılır.
    const unweighedSackCount = await prisma.sack.count({ where: { customerId, shipmentId: null, weightKg: null } });
    const [openLotCount, closedLotCount] = [
      await prisma.packingGroup.count({ where: { customerId, status: "OPEN" } }),
      await prisma.packingGroup.count({ where: { customerId, status: "CLOSED" } }),
    ];
    return {
      success: true,
      data: {
        customer,
        ungrouped: {
          sackCount: sacks._count._all,
          rollCount: rolls._count._all,
          totalQty: Number(rolls._sum.currentQty ?? 0),
          weightKg: weighed > 0 ? Number(sacks._sum.weightKg ?? 0) : null,
        },
        openLotCount,
        closedLotCount,
        unweighedSackCount,
      },
    };
  },


  /**
   * HİÇ çuvalı olmamış partiyi SİLER — hard delete sınıfı ④ (deftere yazmamış
   * taslak). Atomik: `deleteMany WHERE {id, sacks: none}`; çuvalı olan/olmuş parti
   * silinmez, kapatılır (409).
   */
  async remove(groupId: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    await requireLotMode();
    const name = await prisma.$transaction(async (tx) => {
      const cur = await tx.packingGroup.findUnique({ where: { id: groupId }, select: { name: true } });
      if (!cur) throw AppError.notFound("Sevk partisi bulunamadı");
      const res = await tx.packingGroup.deleteMany({ where: { id: groupId, sacks: { none: {} } } });
      if (res.count === 0) {
        throw AppError.conflict(`${cur.name} içinde çuval var (ya da olmuş) — silinemez, kapatın.`, {
          code: "PACKING_LOT_NOT_EMPTY",
        });
      }
      return cur.name;
    });
    await AuditService.log({ userId, action: "DELETE", tableName: GROUP_TABLE, recordId: groupId, oldData: { name } });
    return { success: true, data: { id: groupId }, message: `${name} silindi` };
  },

  /**
   * Çuvalın AMBALAJ NUMARASINI ezer (mod `otomatik-ezilebilir` · `elle`). Yalnız
   * havuzdaki (sevk edilmemiş) ve bir partideki çuval; çakışma 409 `PACKAGE_NO_TAKEN`.
   */
  /**
   * Partinin HAVUZDAKİ bütün çuvallarını çıkarır (parti satırı ⋮ → "Çuvalları havuza
   * çıkar") — kapsam SUNUCUDA çözülür (`packingGroupId`), istemcinin cursor'lu sayfası
   * değil (§14 kuralı). Planlı sevkiyata atanmış çuval ATLANIR ve sayısı yanıtta döner;
   * parti SİLİNMEZ, boşalan parti ⋮ → Sil ile gider. `GENERAL` hedefi çuvalı carisiz
   * genel havuza bırakır — müşteri şablonu değişiyorsa etiket bayatlar
   * (`reassignSackCustomer` ile aynı kural).
   */
  async releaseAll(
    groupId: string,
    target: "CUSTOMER" | "GENERAL",
    userId?: string,
  ): Promise<ApiResponse<{ released: number; skippedPlanned: number; target: "CUSTOMER" | "GENERAL" }>> {
    await requireLotMode();
    const group = await prisma.packingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, customerId: true, name: true },
    });
    if (!group) throw AppError.notFound("Parti bulunamadı");

    const { releasedIds, skippedPlanned } = await prisma.$transaction(async (tx) => {
      const pool = await tx.sack.findMany({
        where: { packingGroupId: groupId, shipmentId: null },
        select: { id: true, customerId: true },
        orderBy: { sackNo: "asc" },
      });
      const planned = await tx.sack.count({
        where: { packingGroupId: groupId, shipment: { status: "PLANNED" } },
      });
      const released: string[] = [];
      // Çuval başına ATOMİK CLAIM (hâlâ havuzda) — genel havuzda etiket bayatlaması
      // claim'le aynı tx'te ve yalnız claim tutan çuvalda koşar.
      for (const sk of pool) {
        const claimed = await tx.sack.updateMany({
          where: { id: sk.id, shipmentId: null },
          data: {
            packingGroupId: null,
            packageNo: null,
            ...(target === "GENERAL" ? { customerId: null, branchId: null } : {}),
          },
        });
        if (claimed.count !== 1) continue;
        released.push(sk.id);
        if (target === "GENERAL" && sk.customerId != null) {
          await markSackLabelsStaleOnCustomerChangeTx(tx, sk.id, sk.customerId, null);
        }
      }
      return { releasedIds: released, skippedPlanned: planned };
    });

    await markLotLabelsStale(group.customerId, releasedIds);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: GROUP_TABLE,
      recordId: groupId,
      newData: { releasedSackIds: releasedIds, target, skippedPlanned },
    });
    const targetText = target === "GENERAL" ? "genel havuza" : "carinin havuzuna";
    const message =
      releasedIds.length === 0
        ? `${group.name}: havuzda çıkarılacak çuval yok`
        : `${releasedIds.length} çuval ${group.name} partisinden çıkarıldı → ${targetText}` +
          (skippedPlanned > 0 ? ` · ${skippedPlanned} çuval planlı sevkiyatta, atlandı` : "");
    return { success: true, data: { released: releasedIds.length, skippedPlanned, target }, message };
  },

  async setPackageNo(sackId: string, packageNo: number, userId?: string): Promise<ApiResponse<{ id: string; packageNo: number }>> {
    const lot = await requireLotMode();
    if (lot.noMode === "otomatik") {
      throw AppError.badRequest("Ambalaj numarası otomatik verilir — ezme kapalı (ayar: otomatik)");
    }
    const old = await prisma.$transaction(async (tx) => {
      const cur = await tx.sack.findUnique({
        where: { id: sackId },
        select: { sackNo: true, shipmentId: true, packingGroupId: true, packageNo: true },
      });
      if (!cur) throw AppError.notFound("Çuval bulunamadı");
      if (!cur.packingGroupId) throw AppError.badRequest(`${cur.sackNo} bir sevk partisinde değil`);
      if (cur.shipmentId) {
        throw AppError.conflict(`${cur.sackNo} sevkiyata bağlı — numarası donmuş`, { code: "SACK_NOT_IN_POOL" });
      }
      if (cur.packageNo === packageNo) return cur.packageNo;
      await assertPackageNoFreeTx(tx, { groupId: cur.packingGroupId, packageNo, exceptSackId: sackId });
      const res = await tx.sack.updateMany({
        where: { id: sackId, shipmentId: null, packingGroupId: cur.packingGroupId },
        data: { packageNo },
      });
      if (res.count === 0) {
        throw AppError.conflict("Çuval bu arada sevkiyata girdi ya da partiden çıktı — tekrar deneyin", { code: "SACK_NOT_IN_POOL" });
      }
      return cur.packageNo;
    });
    if (old !== packageNo) {
      const owner = await prisma.sack.findUnique({ where: { id: sackId }, select: { customerId: true } });
      await markLotLabelsStale(owner?.customerId ?? null, [sackId]);
    }
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: sackId, oldData: { packageNo: old }, newData: { packageNo } });
    return { success: true, data: { id: sackId, packageNo }, message: `Ambalaj no ${packageNo} yazıldı` };
  },
};

/**
 * Sevk edilmiş çuval partiye DÖNÜNCE (storno / planlı sevk iptali) "sevk edildi"
 * parti yeniden AÇIK olur — durum sevkten türer, geri dönüşü de öyle. Sevkiyat
 * tx'inin İÇİNDE çağrılır; grup modunda no-op (status okunmaz). İdempotent.
 */
export async function reopenLotsForSacksTx(
  tx: Prisma.TransactionClient,
  sackIds: string[],
  lotMode: boolean,
): Promise<void> {
  if (!lotMode || sackIds.length === 0) return;
  const groups = await tx.sack.findMany({
    where: { id: { in: sackIds }, packingGroupId: { not: null } },
    select: { packingGroupId: true },
    distinct: ["packingGroupId"],
  });
  const ids = groups.map((g) => g.packingGroupId as string);
  if (ids.length === 0) return;
  await tx.packingGroup.updateMany({ where: { id: { in: ids }, status: "CLOSED" }, data: { status: "OPEN" } });
}

/**
 * Sevkiyata bağlanan çuvalların partilerinde AÇIK çuval kalmadıysa parti aynı tx'te
 * "sevk edildi" (CLOSED) olur — durum sevkten TÜRER, ayar yok. Grup modunda no-op.
 */
export async function autoCloseLotsForSacksTx(
  tx: Prisma.TransactionClient,
  sackIds: string[],
  lotMode: boolean,
  userId?: string,
): Promise<void> {
  if (!lotMode || sackIds.length === 0) return;
  const groups = await tx.sack.findMany({
    where: { id: { in: sackIds }, packingGroupId: { not: null } },
    select: { packingGroupId: true },
    distinct: ["packingGroupId"],
  });
  const ids = groups.map((g) => g.packingGroupId as string);
  if (ids.length === 0) return;
  await tx.packingGroup.updateMany({
    where: { id: { in: ids }, status: "OPEN", sacks: { none: { shipmentId: null } } },
    data: { status: "CLOSED", closedAt: new Date(), closedById: userId ?? null },
  });
}

/**
 * `packing.lotPartialDispatch = false`: sevke giren çuvallar bir partideyse o
 * partinin AÇIK çuvallarının TAMAMI seçilmiş olmalı. Partisiz çuvallar serbest.
 */
export async function assertWholeLotDispatchTx(
  tx: Prisma.TransactionClient,
  sackIds: string[],
  partialAllowed: boolean,
): Promise<void> {
  if (partialAllowed || sackIds.length === 0) return;
  const members = await tx.sack.findMany({
    where: { id: { in: sackIds }, packingGroupId: { not: null } },
    select: { packingGroupId: true },
    distinct: ["packingGroupId"],
  });
  for (const m of members) {
    const open = await tx.sack.findMany({
      where: { packingGroupId: m.packingGroupId, shipmentId: null },
      select: { id: true, sackNo: true, packageNo: true },
    });
    const missing = open.filter((s) => !sackIds.includes(s.id));
    if (missing.length > 0) {
      const g = await tx.packingGroup.findUnique({ where: { id: m.packingGroupId as string }, select: { name: true } });
      const preview = missing.slice(0, 5).map((s) => (s.packageNo != null ? `#${s.packageNo} ${s.sackNo}` : s.sackNo)).join(", ");
      throw AppError.badRequest(
        `${g?.name ?? "Sevk partisi"} bütün gider (ayar: kısmi sevk kapalı) — seçilmeyen ${missing.length} çuval: ${preview}${missing.length > 5 ? "…" : ""}`,
        { code: "PACKING_LOT_WHOLE" },
      );
    }
  }
}

