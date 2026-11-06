// Gelen belge İSTASYON OKUTMA ayarlarının yazımı + doğrulama eşiği okuması — `gelen-belge-ayar.service.ts` satır
// tavanında olduğu için ayrı dosya; yazar yalnız `PUT /api/gelen-belge/ayarlar` (`updateReadOptions`).
//   · `gelenBelge.stationDocLookup` — istasyon tabletinde "Belge okut" (K17)
//   · `gelenBelge.stationVerifyThreshold` — okutma doğrulama eşiği % (2026-11-06; 0 = kapalı, varsayılan 80)
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { DEFAULT_STATION_VERIFY_THRESHOLD, readStationVerifyThreshold, SETTING_KEYS, systemSettingService } from "./system-setting.service";

export interface StationVerifySettings {
  /** İstasyon okutma doğrulama eşiği 0–100 (0 = kapalı; varsayılan 80). */
  stationVerifyThreshold: number;
  defaultStationVerifyThreshold: number;
}

export async function readStationVerifySettings(): Promise<StationVerifySettings> {
  return { stationVerifyThreshold: await readStationVerifyThreshold(), defaultStationVerifyThreshold: DEFAULT_STATION_VERIFY_THRESHOLD };
}

/** Eşik 0–100 tam sayı (0 = kapalı); null = varsayılana dön (boş değer yazılır, okuyucu varsayılana düşer). */
export async function setStationLookupOptions(input: { stationDocLookup?: boolean; stationVerifyThreshold?: number | null }, userId: string): Promise<void> {
  if (input.stationDocLookup !== undefined) {
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, input.stationDocLookup, `Gelen belge: istasyon tabletinde belge okutarak ${TERIM.terbiyeIsEmri.tekilKucuk} bulma`, userId);
  }
  const v = input.stationVerifyThreshold;
  if (v === undefined) return;
  if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 100)) {
    throw AppError.badRequest("Doğrulama eşiği 0 ile 100 arasında tam sayı olmalı.", { code: "VALIDATION_ERROR" });
  }
  await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD, v ?? "", "Gelen belge: istasyon belge okutmada doğrulama eşiği (%; 0 = kapalı)", userId);
}
