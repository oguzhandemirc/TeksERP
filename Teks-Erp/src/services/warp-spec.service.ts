// =============================================================================
// TeksERP — ÇÖZGÜ KARTI (WarpSpec) Servisi · devere modülü
// =============================================================================
// Çözgü kartı ("çözgü föyü") bir ANA VERİDİR: bir çözgü tanımı N kumaş desenini
// besler (saha kartında el yazısıyla "Çözgü = UA6007"). Leventler bu karta göre
// sarılır ve doğuş anında tel/denye değerini KOPYALAR — kart sonradan
// düzeltilse bile geçmiş leventin kg'ı değişmez.
//
// ⚠️ İKİ GİRDİ SUNUCUDA DOĞRULANIR, çünkü ikisi de devere formülünün çarpanıdır
// (`kg = tel × denye × metre / 9.000.000`):
//   • `yarnItemId` gerçekten İPLİK mi ve DENYESİ var mı,
//   • `endsCount` sıfırdan büyük bir tam sayı mı (DB CHECK ikinci hat).
// Denyesiz bir iplikle kart açılabilseydi levent sarımı ekranında hesap sessizce
// 0 kg gösterirdi; hata operatöre kart açılırken söylenmeli.
// =============================================================================
import { ItemType, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { BaseService, type CreateTxContext, type UpdateTxContext } from "./base.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { warpSpecSummaryFromLines } from "./helpers/warp-spec-yarn.helper";

/** Fason devere D1: satır yazma yüzeyi henüz KAPALI — çok iplikli kartın özet kolonları bu yoldan değişemez. */
const MULTI_YARN_LOCKED =
  "Çok iplikli çözgü kartının ipliği ve teli bu ekrandan değiştirilemez — iplik satırları düzenleme ekranı henüz açık değil.";

/**
 * Tek iplikli kartın `WarpSpecYarn` satırını kolonlarla aynı tutar (aynı tx). Çok iplikli kartta kolonlar
 * satırların özetidir; özeti bozan yazım 400 (tx geri alınır). Satır kümesi saf yapılandırma pivotudur (replace).
 */
async function syncSingleYarnRowTx(tx: Prisma.TransactionClient, warpSpecId: string): Promise<void> {
  const spec = await tx.warpSpec.findUniqueOrThrow({ where: { id: warpSpecId }, select: { yarnItemId: true, endsCount: true } });
  const rows = await tx.warpSpecYarn.findMany({ where: { warpSpecId }, select: { yarnItemId: true, endsCount: true, sortOrder: true } });
  if (rows.length > 1) {
    const s = warpSpecSummaryFromLines(rows);
    if (s.yarnItemId !== spec.yarnItemId || s.endsCount !== spec.endsCount) throw AppError.badRequest(MULTI_YARN_LOCKED);
    return;
  }
  const r = rows[0];
  if (r && r.yarnItemId === spec.yarnItemId && r.endsCount === spec.endsCount && r.sortOrder === 0) return;
  await tx.warpSpecYarn.deleteMany({ where: { warpSpecId } });
  await tx.warpSpecYarn.create({ data: { warpSpecId, yarnItemId: spec.yarnItemId, endsCount: spec.endsCount, sortOrder: 0 } });
}


/** 0 ≤ x < 100; "" / null / gönderilmemiş = bilinmiyor (boş bırakılabilir). */
function assertPct(v: unknown, message: string): void {
  if (v === undefined || v === null || v === "") return;
  // true/[]/" " Number() ile sayıya döner; Prisma'nın genel hatasına düşmeden 400.
  if ((typeof v !== "number" && typeof v !== "string") || (typeof v === "string" && v.trim() === "")) {
    throw AppError.badRequest(message);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 100) throw AppError.badRequest(message);
}

export class WarpSpecService extends BaseService {
  /**
   * @param partial `update` yolunda alan GÖNDERİLMEMİŞ olabilir (kısmi güncelleme);
   *   `create`te ikisi de zorunludur.
   */
  private async assertInputs(data: Record<string, unknown>, partial: boolean): Promise<void> {
    const ends = data.endsCount;
    if (ends !== undefined && ends !== null && ends !== "") {
      const n = Number(ends);
      if (!Number.isInteger(n) || n <= 0) {
        throw AppError.badRequest("Tel adedi sıfırdan büyük bir tam sayı olmalı.");
      }
    } else if (!partial) {
      throw AppError.badRequest("Tel adedi zorunludur (devere hesabının ilk çarpanı).");
    }

    // Faz 4 take-up (%): 0 ≤ x < 100 (DB CHECK `warp_specs_take_up_pct_range` ikinci hat); "" / null = bilinmiyor.
    assertPct(data.takeUpPct, "Take-up yüzdesi 0 ile 100 arasında olmalı (100 hariç).");
    // SY-C1 kart firesi: maliyet zincirinde YAPI'dan sonra, PARAMETRE'den önce (DB CHECK `warp_specs_waste_pct_range` ikinci hat).
    assertPct(data.wastePct, "Fire yüzdesi 0 ile 100 arasında olmalı (100 hariç).");

    const yarnItemId = data.yarnItemId;
    if (typeof yarnItemId === "string" && yarnItemId.length > 0) {
      const item = await prisma.item.findUnique({
        where: { id: yarnItemId },
        select: { id: true, name: true, itemType: true, linearDensityDen: true },
      });
      if (!item) throw AppError.badRequest("Çözgü ipliği bulunamadı.");
      if (item.itemType !== ItemType.YARN) {
        throw AppError.badRequest("Çözgü ipliği bir İPLİK kalemi olmalı — kumaş ya da sarf kalemi seçilemez.");
      }
      // Çözgü kartı karta yeni TANIM ekler (B) — "Tükenene kadar"/Pasif iplik seçilemez.
      await assertItemUsable(prisma, item.id, "DEFINITION");
      if (item.linearDensityDen === null) {
        throw AppError.badRequest(
          `"${item.name}" kaleminin denye değeri boş. Devere hesabı (tel × denye × metre ÷ 9.000.000) ` +
            "denye olmadan yapılamaz — kalem kartından denyeyi girin.",
        );
      }
    } else if (!partial) {
      throw AppError.badRequest("Çözgü ipliği zorunludur.");
    }
  }

  async create(rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.assertInputs(rawData, false);
    return super.create(rawData, userId);
  }

  async update(
    id: string,
    rawData: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.assertInputs(rawData, true);
    return super.update(id, rawData, userId);
  }

  protected override async afterCreateTx(tx: Prisma.TransactionClient, c: CreateTxContext): Promise<void> {
    await syncSingleYarnRowTx(tx, c.id);
  }

  protected override async afterUpdateTx(tx: Prisma.TransactionClient, c: UpdateTxContext): Promise<void> {
    await syncSingleYarnRowTx(tx, c.id);
  }

  /** Pasif kartın diriltilmesi kanca yolundan geçmez: çok iplikli kartta özet ÖNCE denetlenir, satır SONRA eşitlenir. */
  protected override async reactivate(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const rows = await prisma.warpSpecYarn.findMany({ where: { warpSpecId: id }, select: { yarnItemId: true, endsCount: true, sortOrder: true } });
    if (rows.length > 1) {
      const s = warpSpecSummaryFromLines(rows);
      const touchesYarn = data.yarnItemId !== undefined && data.yarnItemId !== s.yarnItemId;
      const touchesEnds = data.endsCount !== undefined && Number(data.endsCount) !== s.endsCount;
      if (touchesYarn || touchesEnds) throw AppError.badRequest(MULTI_YARN_LOCKED);
    }
    const res = await super.reactivate(id, data, userId);
    await prisma.$transaction((tx) => syncSingleYarnRowTx(tx, id));
    return res;
  }
}
