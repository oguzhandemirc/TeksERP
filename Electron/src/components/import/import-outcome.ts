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
  if (!r.stoppedAtRowNo) return `Kısmen tamamlandı: ${written} kayıt yazıldı, ${r.failed} satır atlandı.`;
  // Backend durmada `failed`ı bir artırır (doğrulamada atlananlar + durulan satır) — atlananlar gizlenmez.
  const skipped = r.failed - 1;
  const skippedTail = skipped > 0 ? `, ${skipped} satır atlandı` : "";
  return `Kısmen tamamlandı: ${written} kayıt yazıldı${skippedTail}, yazma ${r.stoppedAtRowNo}. satırda durdu.`;
}

/** Geçmiş tablosu rozeti — yazma durduysa satır no eklenir. */
export function importStatusBadgeText(r: Outcome): string {
  const base = IMPORT_STATUS_LABEL[r.status];
  return r.status === "PARTIAL" && r.stoppedAtRowNo ? `${base} (yazma durdu: satır ${r.stoppedAtRowNo})` : base;
}
