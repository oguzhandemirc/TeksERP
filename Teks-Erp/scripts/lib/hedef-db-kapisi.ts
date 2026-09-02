// =============================================================================
// HEDEF VERİTABANI KAPISI — bayrak/veri YAZAN bekçi altyapısı için TEK kaynak
// =============================================================================
// NEDEN: `Teks-Erp/.env` bir dev DB'sini gösterebilir ve `DATABASE_URL`
// export'u unutulan tek bir koşum oraya gider. Bu kapı yalnız ÜRETİM adlarını
// tutar (dev/demo DB'ye yazmak meşru olabilir); ad kümedeyse `BEKCI_PROD_ONAY=1`
// verilmeden DURULUR. 2026-09-03'e kadar kapı yalnız `test_module_flag_off`
// içindeydi; fixture üzerinden bayrak yazan dört test (yarn_stock ·
// goods_receipt · stock_count · purchase_order) korumasızdı (V minor #2).
//
// TÜKETİCİLER: test_module_flag_off (bant + fail) · fixture-module-flags (throw).
// =============================================================================
export const YAZILMASI_YASAK_DB: ReadonlySet<string> = new Set([
  "tekserp",
  "tekserp_prod",
  "adnansahin_db",
]);

/** `DATABASE_URL`den veritabanı adı; okunamazsa "(bilinmiyor)" / "(okunamadı)". */
export function hedefDbAdi(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "") || "(bilinmiyor)";
  } catch {
    return "(okunamadı)";
  }
}

/** Engel varsa Türkçe gerekçe döner, yoksa null. Yazma yapan her bekçi/fixture ÖNCE bunu sorar. */
export function hedefDbEngeli(): string | null {
  const dbAdi = hedefDbAdi();
  if (YAZILMASI_YASAK_DB.has(dbAdi) && process.env.BEKCI_PROD_ONAY !== "1") {
    return (
      `'${dbAdi}' bir ÜRETİM veritabanı adı ve bu koşum YAZAR ` +
      "(modül bayrakları + test verisi). Bilerek koşuyorsan BEKCI_PROD_ONAY=1 ver."
    );
  }
  return null;
}
