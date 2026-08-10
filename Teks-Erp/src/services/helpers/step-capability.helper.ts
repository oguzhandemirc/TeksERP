// =============================================================================
// TeksERP - "Bu ADIM renk/özellik verebilir mi?" — TEK YÜKLEM (2026-08-10)
// =============================================================================
// Öncesinde bu soruya İKİ ayrı yerde, İKİ farklı şekilde cevap veriliyordu:
//
//   • `route.service` (rota adımı hedefi)  → İSTASYONUN varsayılan kategorisi
//   • `workorder.service` (WO açılış guard) → ADIMIN `requiredCategoryId`'si
//
// İkisi farklı sorular sorduğu için bir rota adımı, hedef renk taşıyan bir
// kategori seçilmiş olsa bile rota editöründe reddedilebiliyordu. Bu dosya
// ikisini birleştirir.
//
// KURAL: adım renk/özellik verebilir  ⇔  İSTASYON verebilir  VEYA  o adımda
// satın alınan FASON HİZMETİ (requiredCategory) veriyor.
//   • INTERNAL adımda kategori yoktur → istasyon bayrağı karar verir
//   • EXTERNAL adımda hizmet kategorisi kazanır (asıl işi o yapıyor)
//
// ⚠️ Bu yüklem PLANLAMA sorusunu yanıtlar. Fason kabulde rengin/özelliğin
// FİİLEN uygulanıp uygulanmadığı hâlâ `requiredCategory` bayrağından okunur
// (`subcontractor.service`) — satın alınan hizmet odur. İkisini birleştirme:
// istasyon bayrağı "yapabilir", kategori bayrağı "yaptı" der.
// =============================================================================

// Şekiller BİLEREK dar: her yüklem yalnız OKUDUĞU alanı ister. Tek geniş bir
// arayüz, yalnız `appliesColor` seçen çağıranı (renk kilidi) gereksiz yere
// `appliesProperty` seçmeye zorlardı — ve o alan sırf tipi susturmak için
// select'e eklenirdi, yani sorgu okumadığı veriyi taşırdı.
export interface ColorCaps {
  appliesColor: boolean;
}
export interface PropertyCaps {
  appliesProperty: boolean;
}

/** Prisma `select` sözleşmesi — çağıranlar bunu kopyalasın, alan atlamasın. */
export const STEP_CAPABILITY_SELECT = {
  appliesColor: true,
  appliesProperty: true,
} as const;

export function stepCanApplyColor(
  station: ColorCaps | null | undefined,
  requiredCategory?: ColorCaps | null,
): boolean {
  return Boolean(station?.appliesColor) || Boolean(requiredCategory?.appliesColor);
}

export function stepCanApplyProperty(
  station: PropertyCaps | null | undefined,
  requiredCategory?: PropertyCaps | null,
): boolean {
  return Boolean(station?.appliesProperty) || Boolean(requiredCategory?.appliesProperty);
}
