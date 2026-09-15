// =============================================================================
// MAL KABUL SATIR SÜTUNLARI — başlık ↔ hücre TEK TABLO (kullanıcı testi bulgusu #4, 2026-09-16)
// =============================================================================
// Bulgu: başlık satırı sabitti (Kumaş · Renk · Metre · En · Kg …), iplik satırında hücreler başka
// anlam taşıyordu ("Renk" altında lot, "Metre" altında kg, "En" altında bobin) — "sütunlar ile
// placeholder'lar eşleşmiyor". Çare (1e hüküm a): tabloda iplik satırı VARSA başlık iki türü de
// anlatır ("Kumaş / İplik · Renk / Lot · Miktar (m / kg) · En / Bobin …"); yoksa eski başlık
// bayt bayt. Başlık ve her iki türün hücre etiketi (aria-label) AYNI satırdan okunur ki yeni bir
// sütun eklendiğinde biri unutulamasın; vitest sıra eşleşmesini ölçer.
// =============================================================================
export interface ReceiptLineColumn {
  /** Yalnız kumaş satırları varken başlık (eski başlık, bayt bayt). */
  fabric: string;
  /** Tabloda en az bir iplik satırı varken başlık. */
  mixed: string;
  /** Kumaş satırındaki hücrenin erişilebilir etiketi. */
  fabricLabel: string;
  /** İplik satırındaki hücrenin erişilebilir etiketi (devre dışı hücre "—" ise nedeni). */
  yarnLabel: string;
}

export const RECEIPT_LINE_COLUMNS: readonly ReceiptLineColumn[] = [
  { fabric: "Kumaş", mixed: "Kumaş / İplik", fabricLabel: "Kumaş", yarnLabel: "İplik kalemi" },
  { fabric: "Renk", mixed: "Renk / Lot", fabricLabel: "Renk", yarnLabel: "Lot numarası" },
  { fabric: "Metre", mixed: "Miktar (m / kg)", fabricLabel: "Metre", yarnLabel: "Miktar (kg)" },
  { fabric: "En (cm)", mixed: "En (cm) / Bobin", fabricLabel: "En (cm)", yarnLabel: "Bobin adedi" },
  { fabric: "Kg", mixed: "Kg", fabricLabel: "Kg", yarnLabel: "Kg — iplikte miktar zaten kg, ayrı ağırlık girilmez" },
  { fabric: "Kat", mixed: "Kat", fabricLabel: "Kat", yarnLabel: "Kat — iplik satırı taşımaz" },
  { fabric: "Birim Fiyat", mixed: "Birim Fiyat", fabricLabel: "Birim fiyat", yarnLabel: "Birim fiyat (iplik)" },
  { fabric: "Özellik", mixed: "Özellik", fabricLabel: "Özellik", yarnLabel: "Özellik — iplik satırı taşımaz" },
  { fabric: "Adet", mixed: "Adet", fabricLabel: "Adet (doğacak top sayısı)", yarnLabel: "Adet (doğacak iplik defter satırı sayısı)" },
];

/** Başlık metinleri — tabloda iplik satırı varsa karma başlık. */
export function receiptLineHeaders(hasYarn: boolean): string[] {
  return RECEIPT_LINE_COLUMNS.map((c) => (hasYarn ? c.mixed : c.fabric));
}

/** Sütun etiketi (aria-label) — satır türüne göre. Dizin `RECEIPT_LINE_COLUMNS` sırasıdır. */
export function cellLabel(index: number, yarn: boolean): string {
  const c = RECEIPT_LINE_COLUMNS[index];
  if (!c) throw new Error(`Mal kabul sütunu yok: ${index}`);
  return yarn ? c.yarnLabel : c.fabricLabel;
}
