// =============================================================================
// PANEL EKRAN YOLU — kullanıcıya dönen "şu ekrandan yapın" cümlelerinin TEK kaynağı
// =============================================================================
// Ayar ekranları `panel-ayar-yolu.ts`te; burası ayar DIŞI ekranlar (Tanımlar/Operasyon/Muhasebe/
// Yetkilendirme/Sistem karoları). Menü adı değişince elle yazılmış cümle yalan söyler (2026-10-13:
// "Sistem → Kalite Sınıfları" karo Tanımlar'dayken). `test_ekran_yolu` her yolu panelin menü
// kaynaklarından AST ile doğrular ve `src/`te elle yazılmış menü yolunu yasaklar.
// =============================================================================
import { TERIM } from "./terim";

/** Menü yolunun TEK ayracı. */
export const YOL_AYRACI = " → ";

/** ["Tanımlar", "Depolar"] → "Tanımlar → Depolar" */
export function yolBicimle(parcalar: readonly string[]): string {
  return parcalar.join(YOL_AYRACI);
}

/** Sol menü satırı (panel `nav-config.ts` `navGroups[].items[].label`). */
export type PanelMenu = "Tanımlar" | "Operasyon" | "Kalite Güvence" | "Ön Muhasebe" | "Belgeler" | "Yetkilendirme" | "Sistem";

/**
 * menu → karo (o menünün hub karosu başlığı) → alt (karo içindeki sekme/bölüm/düğme adı; isteğe bağlı).
 * Alt etiketin panelde hangi dosyada durduğu bekçinin `ALT_KAYNAK` tablosundadır.
 */
export const PANEL_EKRAN = {
  depolar: { menu: "Tanımlar", karo: "Depolar" },
  kalemFiyatlari: { menu: "Tanımlar", karo: "Kalem Fiyatları" },
  kumasOzellikleri: { menu: "Tanımlar", karo: "Kumaş Özellikleri" },
  kaliteSiniflari: { menu: "Tanımlar", karo: "Kalite Sınıfları" },
  hataTipleri: { menu: "Tanımlar", karo: "Hata Tipleri" },
  vardiyaTanimlari: { menu: "Tanımlar", karo: "Vardiya Tanımları" },
  donanim: { menu: "Tanımlar", karo: "Donanım" },
  etiketDuzenleri: { menu: "Belgeler", karo: "Etiketler", alt: "Etiket Düzenleri" },
  etiketAtamalari: { menu: "Belgeler", karo: "Etiketler", alt: "Etiket Atamaları" },
  kumasStogu: { menu: "Operasyon", karo: "Kumaş Stoğu" },
  terbiyeIsEmirleri: { menu: "Operasyon", karo: TERIM.terbiyeIsEmri.cogul },
  faturalar: { menu: "Ön Muhasebe", karo: "Faturalar" },
  cariHesaplar: { menu: "Ön Muhasebe", karo: "Cari Hesaplar" },
  kasaHareketleri: { menu: "Ön Muhasebe", karo: "Kasa Hareketleri" },
  kurlar: { menu: "Ön Muhasebe", karo: "Kurlar" },
  kisaKimlikler: { menu: "Yetkilendirme", karo: "Kullanıcılar", alt: "Kısa Kimlikler" },
  tabletler: { menu: "Yetkilendirme", karo: "Tabletler" },
  raporGorunurlugu: { menu: "Sistem", karo: "Modüller", alt: "Raporlar" },
  numaralandirma: { menu: "Sistem", karo: "Numaralandırma" },
} as const satisfies Record<string, { menu: PanelMenu; karo: string; alt?: string }>;

export type PanelEkran = keyof typeof PANEL_EKRAN;

/** "Belgeler → Etiketler → Etiket Atamaları" */
export function ekranYolu(ekran: PanelEkran): string {
  const e: { menu: string; karo: string; alt?: string } = PANEL_EKRAN[ekran];
  return yolBicimle(e.alt ? [e.menu, e.karo, e.alt] : [e.menu, e.karo]);
}
