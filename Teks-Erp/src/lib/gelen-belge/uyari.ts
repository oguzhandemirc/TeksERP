// =============================================================================
// GELEN BELGE — taslak UYARILARI (TEK kaynak, saf): kayıtlı OCR uyarı metni → kullanıcıya gösterilecek bildirim
// =============================================================================
// Okuma işi uyarıları `CustomerDeliveryNote.warnings`e "KOD: ayrıntı" metni olarak yazar (çok sayfada birikir). Panel
// detayı (`getDeliveryNote`) ve tablet okuma özeti (`getReadSummary`) bu fonksiyondan AYNI listeyi döner; istemci metin
// ayrıştırmaz, kural yazmaz. Canlı karşılığı olan kodlar (toplam kapısı `totalsCheck`) burada GÖSTERİLMEZ — bayat
// OCR anı toplamı canlı şeritle çelişmesin.
// =============================================================================
import { upperTr } from "../../utils/tr-case";

export interface NoteNotice {
  /** Kayıtlı uyarının kodu (ör. GRID_SUSPECT_VALUES); kodsuz/tanınmayan metin → OTHER. */
  code: string;
  /** Kısa Türkçe başlık. */
  title: string;
  /** Ayrıntı (kayıtlı metnin kod sonrası; bölge öneki "Bölge N:"). */
  detail: string;
}

/** Canlı toplam şeridinde (`totalsCheck`) zaten olan, OCR anında donmuş kodlar — gösterilmez. */
export const LIVE_TOTAL_CODES: ReadonlySet<string> = new Set(["TOTAL_MISMATCH", "DECLARED_TOP_COUNT_DIFF"]);

export const NOTICE_TITLE: Record<string, string> = {
  SECOND_DOCUMENT_TRACE: "Sayfada ikinci belge var",
  GRID_EMPTY: "El yazısı okunamadı — satırları elle girin",
  GRID_SUSPECT_VALUES: "Şüpheli el yazısı değerler",
  GRID_CELLS_UNREAD: "Okunamayan el yazısı hücreler",
  GRID_NOT_FOUND: "El yazısı tablosu bulunamadı",
  TOTAL_UNVERIFIED: "Toplam doğrulanamadı",
  BLOCK_IDS_DIFFER: "Bloklar farklı iş kimliği taşıyor",
  MULTI_REGION: "Fotoğrafta birden çok bölge",
  TABLE_TOTALS_AMBIGUOUS: "Birden çok toplam satırı",
  TABLE_TOTALS_ORPHAN: "Bağlanamayan toplam satırı",
  TABLE_ROWS_SKIPPED: "Çözülemeyen satırlar atlandı",
  TABLE_NOT_FOUND: "Tablo bulunamadı",
  LINE_SKIPPED_NO_METERS: "Metresi okunamayan satır atlandı",
  HEADER_LINE_SKIPPED: "Satır çıkarılamadı",
  HEADER_LINE_COUNT_UNREAD: "Top adedi okunamadı",
  TEMPLATE_NOT_FOUND: "Belge türü tanınmadı",
  TEMPLATE_FALLBACK: "Gönderen şablonu yok",
  OVERLAP_DUPLICATE_SKIPPED: "Tekrarlanan satırlar atlandı",
  OVERLAP_ROLL_NO_CONFLICT: "Top No çakışması",
};
const OTHER_TITLE = "Okuma uyarısı";

const PATTERN = /^(?:R(\d+):\s*)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b:?\s*([\s\S]*)$/;
const upperFirst = (t: string) => (t ? upperTr(t.charAt(0)) + t.slice(1) : t);

/** Tek uyarı metnini ayrıştırır; canlı karşılığı olan kod → null. */
export function parseNotice(raw: string): NoteNotice | null {
  const m = PATTERN.exec(raw.trim());
  if (!m) return { code: "OTHER", title: OTHER_TITLE, detail: raw.trim() };
  const [, region, code, rest] = m;
  if (LIVE_TOTAL_CODES.has(code!)) return null;
  const detail = upperFirst((rest ?? "").trim());
  return { code: code!, title: NOTICE_TITLE[code!] ?? OTHER_TITLE, detail: region ? `Bölge ${region}: ${detail}` : detail };
}

/** Taslağın gösterilecek uyarıları (sıra korunur, birebir aynı metin tek kez). JSON dizisi değilse boş. */
export function noteNotices(warnings: unknown): NoteNotice[] {
  if (!Array.isArray(warnings)) return [];
  const seen = new Set<string>();
  const out: NoteNotice[] = [];
  for (const w of warnings) {
    if (typeof w !== "string" || !w.trim() || seen.has(w)) continue;
    seen.add(w);
    const n = parseNotice(w);
    if (n) out.push(n);
  }
  return out;
}
