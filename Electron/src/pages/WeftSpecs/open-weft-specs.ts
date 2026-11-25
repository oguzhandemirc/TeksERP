// Atkı kartının ASIL YERİ Atkı Kartları ekranıdır (kullanıcı 2026-11-25): paylaşılan kart kullanım yerinden (ürün penceresi,
// desen kartı) düzenlenmez, oraya yönlendirilir. Sekme deposu tembel yüklenir — statik import bütün rota ağacını çeker.
export function weftSpecsPath(code: string): string {
  return `/definitions/weft-specs?search=${encodeURIComponent(code)}`;
}

export function openWeftSpecsTab(code: string): void {
  void import("@/store/tabs").then((m) => m.useTabsStore.getState().openTab(weftSpecsPath(code), { forceNew: true }));
}
