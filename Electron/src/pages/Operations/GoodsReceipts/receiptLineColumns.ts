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
export type ReceiptLineMode = "fabric" | "yarn" | "mixed";

export interface ReceiptLineColumn {
  /** Yalnız kumaş satırları varken başlık (eski başlık, bayt bayt). */
  fabric: string;
  /** Kumaş + iplik karma tabloda başlık. */
  mixed: string;
  /** YALNIZ iplik satırları varken başlık; `null` = sütun bu modda HİÇ ÇİZİLMEZ (Kg · Kat · Özellik —
   *  kullanıcı testi C1: iplik satırında "iki kilo alanı" görünüyordu). */
  yarnOnly: string | null;
  /** Kumaş satırındaki hücrenin erişilebilir etiketi. */
  fabricLabel: string;
  /** İplik satırındaki hücrenin erişilebilir etiketi (devre dışı hücre "—" ise nedeni). */
  yarnLabel: string;
}

export const RECEIPT_LINE_COLUMNS: readonly ReceiptLineColumn[] = [
  { fabric: "Kumaş", mixed: "Kumaş / İplik", yarnOnly: "İplik", fabricLabel: "Kumaş", yarnLabel: "İplik kalemi" },
  { fabric: "Renk", mixed: "Renk / Lot", yarnOnly: "Lot", fabricLabel: "Renk", yarnLabel: "Lot numarası" },
  { fabric: "Metre", mixed: "Miktar (m / kg)", yarnOnly: "Miktar (kg)", fabricLabel: "Metre", yarnLabel: "Miktar (kg)" },
  { fabric: "En (cm)", mixed: "En (cm) / Bobin", yarnOnly: "Bobin", fabricLabel: "En (cm)", yarnLabel: "Bobin adedi" },
  { fabric: "Kg", mixed: "Kg", yarnOnly: null, fabricLabel: "Kg", yarnLabel: "Kg — iplikte miktar zaten kg, ayrı ağırlık girilmez" },
  { fabric: "Kat", mixed: "Kat", yarnOnly: null, fabricLabel: "Kat", yarnLabel: "Kat — iplik satırı taşımaz" },
  { fabric: "Birim Fiyat", mixed: "Birim Fiyat", yarnOnly: "Birim Fiyat", fabricLabel: "Birim fiyat", yarnLabel: "Birim fiyat (iplik)" },
  { fabric: "Özellik", mixed: "Özellik", yarnOnly: null, fabricLabel: "Özellik", yarnLabel: "Özellik — iplik satırı taşımaz" },
  { fabric: "Adet", mixed: "Adet", yarnOnly: "Adet", fabricLabel: "Adet (doğacak top sayısı)", yarnLabel: "Adet (doğacak iplik defter satırı sayısı)" },
];

/** Tablo modu: satır türlerinden — yalnız kumaş / yalnız iplik / karma (boş tablo kumaş sayılır: eski görünüm). */
export function receiptLineMode(hasFabric: boolean, hasYarn: boolean): ReceiptLineMode {
  if (hasYarn && !hasFabric) return "yarn";
  if (hasYarn && hasFabric) return "mixed";
  return "fabric";
}

/** Bu modda çizilen sütun dizinleri (`RECEIPT_LINE_COLUMNS` sırası). */
export function visibleColumnIndexes(mode: ReceiptLineMode): number[] {
  return RECEIPT_LINE_COLUMNS.map((c, i) => (mode === "yarn" && c.yarnOnly === null ? -1 : i)).filter((i) => i >= 0);
}

/** Başlık metinleri — yalnız çizilen sütunlar, mod diliyle. */
export function receiptLineHeaders(mode: ReceiptLineMode): string[] {
  return visibleColumnIndexes(mode).map((i) => {
    const c = RECEIPT_LINE_COLUMNS[i]!;
    return mode === "yarn" ? (c.yarnOnly as string) : mode === "mixed" ? c.mixed : c.fabric;
  });
}

/** Grid şablonu — satır ve başlık aynı şablonu okur; son sütun işlemler. */
export function receiptLineGridCols(mode: ReceiptLineMode): string {
  return mode === "yarn"
    ? "grid-cols-[minmax(0,1fr)_160px_96px_80px_96px_60px_76px]"
    : "grid-cols-[minmax(0,1fr)_128px_80px_66px_66px_96px_84px_58px_60px_76px]";
}

/** Sütun etiketi (aria-label) — satır türüne göre. Dizin `RECEIPT_LINE_COLUMNS` sırasıdır. */
export function cellLabel(index: number, yarn: boolean): string {
  const c = RECEIPT_LINE_COLUMNS[index];
  if (!c) throw new Error(`Mal kabul sütunu yok: ${index}`);
  return yarn ? c.yarnLabel : c.fabricLabel;
}
