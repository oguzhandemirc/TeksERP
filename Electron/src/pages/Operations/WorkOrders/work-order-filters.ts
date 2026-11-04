import type { FilterDef } from "@/components/data-table/FilterBar";

/** "Fasonda" süzgecinin sunucu anahtarı — anlamı: en az bir topu şu an fasonda. */
export const FASONDA_FILTER_KEY = "fasonda";

/**
 * Durumdan AYRI süzgeç: sunucuda durum seçimiyle VE'lenir. Seçili değilken anahtar
 * istekte hiç yoktur ("Tümü" = URL'den silinir) — anahtarı tanımayan eski backend
 * (2.11.2) yalnız kullanıcı seçtiğinde görür. Dil satırdaki fason rozetiyle aynı.
 */
export const FASONDA_FILTER: FilterDef = {
  kind: "select",
  key: FASONDA_FILTER_KEY,
  label: "Fasonda",
  options: [{ value: "1", label: "Yalnız fasondakiler" }],
};
