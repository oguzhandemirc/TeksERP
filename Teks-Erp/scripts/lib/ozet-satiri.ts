// BEKÇİ ÖZET SATIRI — koşucunun (run-all-tests.ts) ve sözleşme bekçisinin TEK kaynağı.
// NEDEN (2026-10-25): serbest "N geçti, M başarısız" / "N/T geçti" yedek regex'leri
// çıktının HERHANGİ bir yerinde (check mesajı, kesik çıktı) eşleşip özet satırı hiç
// basılmamış bir koşumu SAYILMIŞ gösterebiliyordu. 877/877 bekçi `Sonuç:` biçimini
// basıyor (test_bekci_sozlesmesi §ö ölçer) ⇒ çıkış 0 ∧ `Sonuç:` satırı yok = KIRMIZI.

/** Kanonik özet satırı: `=== Sonuç: N geçti, M başarısız[, …] ===` (SONUÇ/kaldı varyantı dahil). */
export const OZET_SATIRI = /(?:Sonuç|SONUÇ):\s*(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i;

export interface OzetOkuma {
  /** Kanonik özet satırı bulundu mu. */
  var: boolean;
  gecti: number | null;
  basarisiz: number | null;
}

/** Çıktıdan kanonik özet satırını okur; yoksa `var:false` (yedek kazıma YOK). */
export function ozetOku(out: string): OzetOkuma {
  // SON eşleşme: bazı bekçiler alt koşum çıktısını aktarır; sayılan kendi satırıdır.
  const hepsi = [...out.matchAll(new RegExp(OZET_SATIRI.source, "gi"))];
  const m = hepsi.at(-1);
  if (!m) return { var: false, gecti: null, basarisiz: null };
  return { var: true, gecti: Number(m[1]), basarisiz: Number(m[2]) };
}

/**
 * Çıkış 0 olsa bile özet satırı yoksa koşum KIRMIZIDIR (çıktı kesildi ya da bekçi
 * özet basmadan çıktı — "sessiz yeşil"). Dönen metin kırmızının sebebidir; null = sorun yok.
 */
export function ozetsizCikisSebebi(out: string, cikis0: boolean): string | null {
  if (!cikis0) return null;
  return ozetOku(out).var ? null : "ÖZET SATIRI YOK — çıkış 0 ama `Sonuç: N geçti, M başarısız` basılmadı (çıktı kesik ya da erken process.exit)";
}
