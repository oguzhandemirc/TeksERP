// =============================================================================
// DEMO VERİSİ HEDEF KAPISI — yalnız oturum test DB'si (`tekserp_<ad>_test`) (R3-ANALIZ)
// =============================================================================
// `hedefDbEngeli` bilinen üretim adlarını keser; demo fikstürü daha dar: adı `tekserp_[a-z0-9]+_test`
// DEĞİLSE hiç bağlanmaz (fabrika yedeği `tekserp_fabrika_*`, ana ağacın `.env`i dahil). Saf fonksiyon:
// bekçi DB'siz ölçer, script Prisma'yı ancak kapı geçince yükler.
// =============================================================================

export const DEMO_DB_NAME = /^tekserp_[a-z0-9]+_test$/;

/** Bağlantı adresinden DB adı; okunamazsa null. */
export function demoDbName(url: string | undefined): string | null {
  try {
    return new URL(url ?? "").pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/** Engel varsa Türkçe gerekçe, yoksa null. */
export function demoTargetBlock(url: string | undefined): string | null {
  const name = demoDbName(url);
  if (!name) return "Veritabanı adresi okunamadı; demo verisi yazılmadı.";
  if (!DEMO_DB_NAME.test(name)) {
    return `'${name}' bir oturum test veritabanı değil (beklenen: tekserp_<ad>_test). Demo verisi YALNIZ test DB'ye yazılır.`;
  }
  return null;
}
