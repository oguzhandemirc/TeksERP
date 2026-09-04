// =============================================================================
// Etiket şablonu satırı — AKSİYON YUVALARI (tek kaynak)
// =============================================================================
// Sorun (2026-09-04, kullanıcı bildirimi): "Düzenler" listesinde satırın sağ
// ucundaki düğme sayısı satırdan satıra değişiyordu — bağlam varsayılanı olan
// şablonda "Pasife Al" ve "Kalıcı Sil" hiç çizilmiyor, pasif şablonda "Yazdır"
// düşüyordu. Düğmeler sağa yaslı olduğu için EKSİK düğme sonrakileri sola
// kaydırıyor: aynı ikon her satırda başka bir x'te duruyordu (demo DB ölçümü:
// 4 şablonun 2'si 6 düğmeli, 2'si 4 düğmeli).
//
// KARAR ÖLÇÜTÜ — iki farklı "yok" birbirine karıştırılmaz:
//   · "bu satırda ANLAMSIZ" (varsayılan şablon pasife alınamaz, pasif şablon
//     bastırılamaz) → yuva DURUR, yer tutucu çizilir, hiza korunur.
//   · "bu KULLANICIDA yetki yok" → hiç çizilmez (repo kuralı: gri/hayalet
//     düğme olmayan bir yolu vaat eder). Yazma yuvaları `PermissionGate`
//     içinde ve listedeki TÜM satırlarda birlikte düşer → hiza yine bozulmaz.
//
// Bu modül yalnız "hangi yuva, hangi sırada, bu satırda anlamlı mı" sorusuna
// cevap verir; çizim `LabelTemplatesPage`te. Bekçi: `templateRowActions.test.tsx`.
// =============================================================================

export type TemplateRowActionKey =
  | "print"
  | "export"
  | "duplicate"
  | "edit"
  | "toggle"
  | "hardDelete";

/**
 * Yuva sırası — HER satırda birebir aynı. Yazma yuvaları bilerek SONDA ve
 * BİTİŞİK: `PermissionGate` onları tek blok hâlinde sarabilsin, izin düşünce
 * sıra bozulmasın (bekçi bu bitişikliği de ölçer).
 */
export const TEMPLATE_ROW_ACTION_ORDER: readonly TemplateRowActionKey[] = [
  "print",
  "export",
  "duplicate",
  "edit",
  "toggle",
  "hardDelete",
] as const;

/** `label-template:write` isteyen yuvalar (sıranın bitişik son eki). */
export const TEMPLATE_ROW_WRITE_ACTIONS: readonly TemplateRowActionKey[] = [
  "duplicate",
  "edit",
  "toggle",
  "hardDelete",
] as const;

export interface TemplateRowActionSlot {
  key: TemplateRowActionKey;
  /** Bu satırda anlamlı mı? false → yer tutucu (görünmez ama yer kaplayan) düğme. */
  applicable: boolean;
}

export interface TemplateRowState {
  isActive: boolean;
  /** Şablon en az bir bağlamın varsayılanı mı (LabelContextDefault). */
  isAnyDefault: boolean;
}

/**
 * "Pasife Al" ↔ "Aktifleştir" TEK yuvadır (`toggle`): ikisi karşılıklı dışlayan
 * yönlerdir, aynı sütunda dururlar. Aktif + varsayılan şablonda iki yön de
 * geçersizdir (varsayılan pasife alınamaz) → yuva yer tutucuya düşer.
 */
export function resolveToggleDirection(row: TemplateRowState): "deactivate" | "activate" {
  return row.isActive ? "deactivate" : "activate";
}

/** Satır durumundan yuva listesi — uzunluk ve sıra HER durumda AYNI. */
export function resolveTemplateRowActions(row: TemplateRowState): TemplateRowActionSlot[] {
  const applicable: Record<TemplateRowActionKey, boolean> = {
    // Baskı + dışa aktarma okuma işlemleridir (write gate'in dışında).
    print: row.isActive, // pasif şablon bastırılmaz
    export: true,
    duplicate: true,
    edit: true,
    // aktif + varsayılan → pasife alınamaz (önce Atamalar'dan varsayılan değişir)
    toggle: row.isActive ? !row.isAnyDefault : true,
    hardDelete: !row.isAnyDefault,
  };
  return TEMPLATE_ROW_ACTION_ORDER.map((key) => ({ key, applicable: applicable[key] }));
}
