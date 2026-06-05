import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export interface FeatureFlags {
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  returnGradingEnabled: boolean;
  /** İş emri parti kodu otomatik mi üretilsin (true) manuel mi girilsin (false=default). */
  partyCodeAuto: boolean;
  /** Fason Sevk boyahane notunu sahadaki operatör telefondan girebilsin mi (false=default). */
  dyehouseNoteMobileEntry: boolean;
  /** Mobil cihaz eşleştirmesi zorunlu mu (true=aktif) yoksa pasif mi (false=default).
   *  Pasifken eşleşmemiş tabletler de sisteme girer (makine atfı NULL kalır). ENFORCE edilir. */
  devicePairingRequired: boolean;
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (false=default). Kapalıyken
   *  mobil ① Sevkiyat ekranında "Hemen Sevk Et" kısayolu görünür; açıkken çıkış yalnız ②
   *  "Sevk Çıkışı" ekranından onaylanır. Ara depoda bekleme her iki modda da mümkündür. */
  shipmentConfirmationEnabled: boolean;
}

export const featureFlagService = {
  get: (): Promise<ApiResponse<FeatureFlags>> =>
    apiClient.get<ApiResponse<FeatureFlags>>("/api/feature-flags").then((r) => r.data),

  update: (flags: Partial<FeatureFlags>): Promise<ApiResponse<FeatureFlags>> =>
    apiClient
      .patch<ApiResponse<FeatureFlags>>("/api/feature-flags", flags)
      .then((r) => r.data),
};

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const currencyService = {
  list: (): Promise<ApiResponse<CurrencyOption[]>> =>
    apiClient.get<ApiResponse<CurrencyOption[]>>("/api/currencies").then((r) => r.data),
};
