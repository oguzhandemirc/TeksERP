// Ürün arşivi — dirilme ve DB seddi mesajları TEK kaynak (uygulama kapısı + error.middleware
// CHECK eşlemesi aynı metni söyler; operatör çıkış yolunu okur). URUN-YASAM-DONGUSU.md §7.
export const ROLL_ON_ARCHIVED_ITEM_MESSAGE =
  "Bu topun kartı Pasif — geri almak için kartı önce 'Tükenene kadar'a alın.";
export const SWATCH_ON_ARCHIVED_ITEM_MESSAGE =
  "Bu kartelanın ürün kartı Pasif — geri almak için kartı önce 'Tükenene kadar'a alın.";
export const ORDER_LINE_ON_ARCHIVED_ITEM_MESSAGE =
  "Bu kalemin kartı Pasif — açık siparişte kullanmak için kartı önce 'Tükenene kadar'a alın.";
// Renk arşivi (MV-06) — arşivli (pasif) rengin topu/kartelası canlı kümeye dönemez; çıkış yolu rengi aktifleştirmek.
export const ROLL_ON_ARCHIVED_COLOR_MESSAGE =
  "Bu topun rengi pasif — geri almak için rengi önce aktifleştirin.";
export const SWATCH_ON_ARCHIVED_COLOR_MESSAGE =
  "Bu kartelanın rengi pasif — geri almak için rengi önce aktifleştirin.";
