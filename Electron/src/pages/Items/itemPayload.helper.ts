import { ItemType, unitForItemType } from "@/types/enums";
import type { ItemCreatePayload } from "./types";
import type { ItemFormValues } from "./schema";

/**
 * Form değerlerinden API payload'u.
 * - Edit: code/itemType payload'a GİRMEZ (backend FORBIDDEN listesi reddeder).
 *   Ayrıca pendingReview:false gönderilir — admin bir deseni açıp kaydettiğinde
 *   saha "onay bekliyor" işareti temizlenir (zaten false ise no-op).
 * - Create: kod boşsa payload'a GİRMEZ — backend STK-NNNNNN otomatik üretir;
 *   doluysa manuel kod olarak gönderilir. Admin create'i asla pendingReview
 *   göndermez → backend default false.
 * - `isActive` GİTMEZ: kartın durumu yalnız "Kullanımdan kaldır" / "Aktifleştir" ile değişir
 *   (URUN-YASAM-DONGUSU §8) — formdaki onay kutusu Tükenene kadar kartı Aktif'e döndürüyordu.
 * - İzinli renk/özellik YALNIZ KUMAŞ taşır (kullanıcı kararı 2026-09-17): iplik/sarf
 *   create'inde anahtar HİÇ gitmez; edit'inde `[]` gider — eski iplik kartında kalmış
 *   liste kaydedince KALDIRILIR (backend `undefined` = dokunma, `[]` = temizle).
 */
export const itemCarriesAllowedLists = (itemType: ItemType): boolean => itemType === ItemType.FABRIC;

/**
 * `withWidth` (Kalite Güvence açık): KUMAŞta `widthCm` gider (boş = `null` temizler). Kapalıyken anahtar
 * HİÇ gitmez — gizli alanın boş değeri mevcut eni silmesin.
 */
export function buildItemPayload(
  v: ItemFormValues,
  isEdit: boolean,
  withWidth = false,
): ItemCreatePayload {
  const base = {
    name: v.name.trim(),
    unit: unitForItemType[v.itemType] ?? v.unit,
    // Boş alan `null` gider: "" Decimal kolonunda geçersizdir ve kolonu
    // temizlemenin tek yolu budur (alan yalnız YARN'da çizilir, diğer
    // tiplerde zaten boş kalır).
    linearDensityDen: v.linearDensityDen.trim() === "" ? null : v.linearDensityDen.trim(),
    // E4: çözgü kartı yalnız KUMAŞ taşır; öteki tiplerde `null` gider (sunucu FABRIC dışını 400'ler, boş = temizle).
    warpSpecId: v.itemType === ItemType.FABRIC && v.warpSpecId ? v.warpSpecId : null,
    ...(withWidth && v.itemType === ItemType.FABRIC
      ? { widthCm: v.widthCm.trim() === "" ? null : v.widthCm.trim().replace(",", ".") }
      : {}),
  };
  const lists = itemCarriesAllowedLists(v.itemType)
    ? { allowedColorIds: v.allowedColorIds, allowedPropertyIds: v.allowedPropertyIds }
    : isEdit
      ? { allowedColorIds: [], allowedPropertyIds: [] }
      : {};
  if (isEdit) return { ...base, ...lists, pendingReview: false } as unknown as ItemCreatePayload;
  const code = v.code.trim();
  return { ...base, ...lists, itemType: v.itemType, ...(code ? { code } : {}) };
}

export const FABRIC_DETAIL_KEYS = ["rawWidthCm", "rawGsm", "finishedGsm"] as const;
type FabricDetailKey = (typeof FABRIC_DETAIL_KEYS)[number];

/** Kayıtlı Decimal değeri forma: sayı/metin → virgüllü metin, yok → "". */
export function fabricDetailToFormText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
}

/**
 * Dokuma ayrıntıları gövdesi — yalnız KUMAŞ. Dolu → noktalı metin; boş + kayıtta değer VAR → `null`
 * (temizle); boş + kayıtta yok → anahtar hiç gitmez (gövde bugünküyle aynı, sunucu `undefined` = dokunma).
 */
export function fabricDetailPayload(
  v: Pick<ItemFormValues, "itemType" | FabricDetailKey>,
  initial: Partial<Record<FabricDetailKey, string | number | null>> | null | undefined,
): Partial<Record<FabricDetailKey, string | null>> {
  if (v.itemType !== ItemType.FABRIC) return {};
  const out: Partial<Record<FabricDetailKey, string | null>> = {};
  for (const k of FABRIC_DETAIL_KEYS) {
    const text = v[k].trim();
    if (text !== "") out[k] = text.replace(",", ".");
    else if (initial?.[k] != null && initial[k] !== "") out[k] = null;
  }
  return out;
}

/**
 * SY-3 I2 iplik firesi gövdesi — yalnız İPLİK ve alan görünürken (maliyet açık). Dolu → noktalı metin; boş + kayıtta
 * değer VAR → `null` (kart zincirine dön); boş + kayıtta yok → anahtar hiç gitmez (gövde bugünküyle aynı).
 */
export function yarnWastePayload(
  v: Pick<ItemFormValues, "itemType" | "yarnWastePct">,
  initial: { yarnWastePct?: string | number | null } | null | undefined,
  visible: boolean,
): { yarnWastePct?: string | null } {
  if (!visible || v.itemType !== ItemType.YARN) return {};
  const text = v.yarnWastePct.trim();
  if (text !== "") return { yarnWastePct: text.replace(",", ".") };
  return initial?.yarnWastePct != null && initial.yarnWastePct !== "" ? { yarnWastePct: null } : {};
}
