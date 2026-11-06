// Hizmet Fiyat Tablosu rejimi — saf (karo, palet ve sayfa aynı yüklemi okur).

export interface ServicePricesRegime {
  ticaretEnabled: boolean;
  financeEnabled: boolean;
  serviceBillingEnabled: boolean;
}

/**
 * Karo / palet görünürlüğü = manifesto modülü (`financeEnabled`, `test_screen_catalog` §9c tek alan ister).
 * Ticaret ya da hizmet faturası alt anahtarı kapalıysa karo görünür, sayfa EKSİK olanı söyler (`servicePricesBlock`).
 */
export function servicePricesTileVisible(ctx: { financeEnabled: boolean }): boolean {
  return ctx.financeEnabled;
}

/** Sayfa kapalıysa NEDENİ (eksik olanı söyler); açıksa null. */
export function servicePricesBlock(
  a: ServicePricesRegime & { canRead: boolean },
): { title: string; body: string } | null {
  if (!a.financeEnabled)
    return {
      title: "Ön muhasebe bu kurulumda kapalı",
      body: "Hizmet fiyat tablosu hizmet faturasının parçasıdır. Sistem → Modüller ekranından Ön Muhasebe açılabilir.",
    };
  if (!a.ticaretEnabled)
    return {
      title: "Ticaret modülü bu kurulumda kapalı",
      body: "Fiyat tanımları Ticaret modülüne bağlıdır. Sistem → Modüller ekranından açılabilir.",
    };
  if (!a.serviceBillingEnabled)
    return {
      title: "Hizmet faturası kapalı",
      body: "Sistem → Özellik Anahtarları → Muhasebe ekranından “Hizmet faturası” açılınca tablo kullanılabilir.",
    };
  if (!a.canRead)
    return {
      title: "Bu ekranı görme yetkiniz yok",
      body: "Hizmet fiyatlarını görmek için item:read yetkisi gerekir.",
    };
  return null;
}
