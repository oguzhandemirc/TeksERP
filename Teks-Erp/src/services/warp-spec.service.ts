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
import { ItemType } from "@prisma/client";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";import { assertItemUsable } from "./helpers/item-usage.helper";


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
    const takeUp = data.takeUpPct;
    if (takeUp !== undefined && takeUp !== null && takeUp !== "") {
      const t = Number(takeUp);
      if (!Number.isFinite(t) || t < 0 || t >= 100) {
        throw AppError.badRequest("Take-up yüzdesi 0 ile 100 arasında olmalı (100 hariç).");
      }
    }

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
}
