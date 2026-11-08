// =============================================================================
// EMANET VARSAYILAN DEPOSU — ayar okuma/yazma sözleşmesi (`emanet.defaultWarehouseId`, genel fason F1b)
// =============================================================================
// Tek yazar `PUT /api/feature-flags/emanet-default-warehouse` (ham ayar ucu reddeder). Doğum boğazı
// `helpers/emanet-warehouse.helper.ts`; burada yalnız panelin göreceği görünüm ve doğrulamalı yazım yaşar.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { emanetWarehouseProblem } from "./helpers/emanet-warehouse.helper";
import { readEmanetDefaultWarehouseId, readEmanetEnabled, SETTING_KEYS, systemSettingService } from "./system-setting.service";

export interface EmanetDefaultWarehouseView {
  /** Kayıtlı depo; null = ayar boş (emanet top varsayılan depoya doğar — bugünkü davranış). */
  warehouse: { id: string; code: string; name: string; isActive: boolean } | null;
  /** null = kullanılabilir; dolu = sahipli doğumun 400 vereceği sebep (pasif / silinmiş depo). */
  problem: string | null;
  /** Emanet modülü kapalıyken ayar etkisizdir (panel bunu söyler). */
  emanetEnabled: boolean;
}

export async function getEmanetDefaultWarehouse(): Promise<EmanetDefaultWarehouseView> {
  const emanetEnabled = await readEmanetEnabled(prisma);
  const id = await readEmanetDefaultWarehouseId(prisma);
  if (!id) return { warehouse: null, problem: null, emanetEnabled };
  const { row, problem } = await emanetWarehouseProblem(prisma, id);
  return { warehouse: row ?? { id, code: "", name: "(silinmiş depo)", isActive: false }, problem, emanetEnabled };
}

/** Yazım: pasif/olmayan depo 400 `EMANET_DEFAULT_WAREHOUSE_INVALID` (fail-closed); null temizler (boş metin; audit `set` içinde). */
export async function setEmanetDefaultWarehouse(warehouseId: string | null, userId: string): Promise<EmanetDefaultWarehouseView> {
  if (warehouseId !== null) {
    const { problem } = await emanetWarehouseProblem(prisma, warehouseId);
    if (problem) throw AppError.badRequest(`Emanet varsayılan deposu olarak kaydedilemez: ${problem}`, { code: "EMANET_DEFAULT_WAREHOUSE_INVALID", warehouseId });
  }
  await systemSettingService.set(
    SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID,
    warehouseId ?? "",
    "Emanet varsayılan deposu (müşterinin malı depo söylenmeden doğunca buraya girer; boş = varsayılan depo)",
    userId,
  );
  return getEmanetDefaultWarehouse();
}
