// İçe aktarım sonucunun TEK cümle kaynağı (sonuç adımı + geçmiş tablosu + dışa aktarım). PARTIAL "yarıda
// kesildi" DEĞİLDİR: çoğunlukla bazı satırlar atlanıp gerisi yazılmıştır; yazma durduysa satır no ayrıca söylenir.
type Outcome = { status: "APPLIED" | "PARTIAL" | "FAILED"; created: number; updated: number; failed: number; stoppedAtRowNo?: number | null };

export const IMPORT_STATUS_LABEL: Record<Outcome["status"], string> = {
  APPLIED: "Tamamlandı",
  PARTIAL: "Kısmen tamamlandı",
  FAILED: "Başarısız",
};

export function importOutcomeTitle(r: Outcome): string {
  if (r.status === "FAILED") return "Hiçbir kayıt yazılamadı.";
  if (r.status === "APPLIED") return "İçe aktarım tamamlandı.";
  const written = r.created + r.updated;
  const tail = r.stoppedAtRowNo ? `yazma ${r.stoppedAtRowNo}. satırda durdu` : `${r.failed} satır atlandı`;
  return `Kısmen tamamlandı: ${written} kayıt yazıldı, ${tail}.`;
}

/** Geçmiş tablosu rozeti — yazma durduysa satır no eklenir. */
export function importStatusBadgeText(r: Outcome): string {
  const base = IMPORT_STATUS_LABEL[r.status];
  return r.status === "PARTIAL" && r.stoppedAtRowNo ? `${base} (satır ${r.stoppedAtRowNo}'de durdu)` : base;
}
