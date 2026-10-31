// SY-D4: atkı ücreti alanları (parametre seti + ürün yapısı) yalnız `maliyet.dokumaStandartYontemi = ATKI_UCRETI`
// iken ya da kayıtta değer varken çizilir; çizilmeyen alan gövdeye GİRMEZ (sunucu çifti korur → TEZGAH_SAATI'nda bayt-aynı).
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { Currency } from "@/pages/Finance/service";
import { COST_CURRENCIES } from "./CurrencySelect";

export function useWeavingPickMethod(): boolean {
  return useFeatureFlags().data?.data?.costWeavingStandardMethod === "ATKI_UCRETI";
}

export interface PickPair { rate: string; currency: Currency | "" }

/** Alan çizilsin mi: ayar atkı ücreti ya da kayıtlı değer var (ayar geri alınsa da girilen ücret görünür kalır). */
export function showPickFields(method: boolean, stored: { rate: unknown; currency: unknown } | null | undefined): boolean {
  return method || (stored?.rate != null && stored.rate !== "") || (stored?.currency != null && stored.currency !== "");
}

export function isCostCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (COST_CURRENCIES as string[]).includes(v);
}
