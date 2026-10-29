// Özellik formu → istek gövdesi (saf; `FabricPropertiesPage` ve testleri aynı fonksiyonu çağırır).
import { propertyServiceItemPatch, valueServiceItemPatch } from "./serviceMapping";
import type { FabricPropertyFormValues } from "./schema";
import type { FabricProperty } from "./types";

export const buildFabricPropertyPayload = (
  v: FabricPropertyFormValues,
  initial: FabricProperty | null,
  nextOrder: number,
): Partial<FabricProperty> =>
  ({
    // Kod backend'de üretilir (OZL+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
    ...(initial ? { code: initial.code } : {}),
    name: v.name,
    category: v.category?.trim() || null,
    description: v.description?.trim() || null,
    color: v.color?.trim() || null,
    sortOrder: initial?.sortOrder ?? nextOrder,
    // Backend `stationIds`'i StationProperty bağlarına çevirir (create'te zorunlu,
    // update'te replace). `Partial<FabricProperty>` şeklinde bir alan değil —
    // bilinçli olarak payload'a ek olarak taşınıyor.
    stationIds: v.stationIds,
    valueType: v.valueType,
    // `values` de `stationIds` gibi DÜZ bir liste olarak gider; backend onu
    // FabricPropertyValue satırlarına çevirir (ham nested write YASAK — F209).
    // BAYRAK tipte HİÇ GÖNDERİLMEZ: boş dizi göndermek, tipi Seçim'den Bayrak'a
    // çeviren bir düzenlemede mevcut değerleri sessizce pasifleştirirdi.
    ...(v.valueType === "CHOICE"
      ? {
          values: v.values.map((x, i) => ({
            code: x.code.trim().toUpperCase(),
            name: x.name.trim(),
            sortOrder: (i + 1) * 10,
            isActive: x.isActive,
            // H6 sözleşmesi: alan yoksa eşleme korunur — yalnız değişen satır taşır.
            ...valueServiceItemPatch(initial, x.code.trim(), x.serviceItemId ?? null),
          })),
        }
      : {}),
    // Çeşit bağı yalnız SEÇİM'de anlamlı; BAYRAK'a geçişte bağ açıkça kaldırılır.
    variantOfPropertyId: v.valueType === "CHOICE" ? v.variantOfPropertyId : null,
    ...propertyServiceItemPatch(initial, v.serviceItemId ?? null),
    isActive: v.isActive,
  }) as Partial<FabricProperty> & { stationIds: string[] };
