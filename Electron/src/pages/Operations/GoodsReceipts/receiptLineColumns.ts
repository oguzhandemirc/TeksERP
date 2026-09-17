// =============================================================================
// MAL KABUL SATIR SÜTUNLARI — TÜRE GÖRE İKİ ALT TABLO, başlık ↔ hücre TEK TABLO (EK 5, kullanıcı onayı 2026-09-17)
// =============================================================================
// Önceki üç mod (kumaş / iplik / karma) ve "m / kg", "En / Bobin" gibi çift anlamlı karma başlıklar GİTTİ:
// aynı fişte iki ayrı alt tablo — Kumaş kalemleri ve İplik kalemleri — her biri kendi başlığı ve hücre etiketiyle.
// Başlık ve hücrenin erişilebilir etiketi (aria-label) AYNI satırdan okunur ki yeni bir sütun eklendiğinde biri
// unutulamasın; vitest sıra eşleşmesini ölçer. Satır DOĞDUĞU ANDA tiplidir; tür değiştirmek = satırı silip öbür
// gruptan açmak. EK 7: "Sınıf" sütunu üç durumlu (Ham · Yarı mamul · Bitmiş) — fiş kutusu kalktı, satır tek yer.
// =============================================================================
export type ReceiptLineKind = "FABRIC" | "YARN";

export interface ReceiptLineColumn {
  /** Alt tablo başlığı. */
  header: string;
  /** Hücrenin erişilebilir etiketi (aria-label). */
  label: string;
  /** Başlık hizası. */
  align?: "center";
}

/** Kumaş kalemleri — sütun sırası grid şablonuyla birebir (`receiptLineGridCols`). */
export const FABRIC_COLUMNS: readonly ReceiptLineColumn[] = [
  { header: "Kumaş", label: "Kumaş" },
  { header: "Renk", label: "Renk" },
  { header: "Metre (top başına)", label: "Metre" },
  { header: "En (cm)", label: "En (cm)" },
  { header: "Kg", label: "Kg" },
  { header: "Kat", label: "Kat" },
  { header: "Birim Fiyat", label: "Birim fiyat" },
  { header: "Özellik", label: "Özellik", align: "center" },
  { header: "Sınıf", label: "Top sınıfı", align: "center" },
  { header: "Adet", label: "Adet (doğacak top sayısı)", align: "center" },
];

/** İplik kalemleri — lot + bobin; miktar KG; renk/en/kat/özellik/top sınıfı YOK (kg defteri raf taşımaz). */
export const YARN_COLUMNS: readonly ReceiptLineColumn[] = [
  { header: "İplik", label: "İplik kalemi" },
  { header: "Lot", label: "Lot numarası" },
  { header: "Kg", label: "Miktar (kg)" },
  { header: "Bobin", label: "Bobin adedi" },
  { header: "Birim Fiyat", label: "Birim fiyat (iplik)" },
  { header: "Adet", label: "Adet (doğacak iplik defter satırı sayısı)", align: "center" },
];

export const receiptLineColumns = (kind: ReceiptLineKind): readonly ReceiptLineColumn[] => (kind === "YARN" ? YARN_COLUMNS : FABRIC_COLUMNS);

/** Alt tablo başlıkları. */
export function receiptLineHeaders(kind: ReceiptLineKind): string[] {
  return receiptLineColumns(kind).map((c) => c.header);
}

/** Hücre etiketi (aria-label) — dizin o türün sütun sırasıdır. */
export function cellLabel(kind: ReceiptLineKind, index: number): string {
  const c = receiptLineColumns(kind)[index];
  if (!c) throw new Error(`Mal kabul sütunu yok: ${kind}[${index}]`);
  return c.label;
}

/** Grid şablonu — başlık ve satır AYNI şablonu okur (son sütun işlemler). */
export function receiptLineGridCols(kind: ReceiptLineKind): string {
  return kind === "YARN"
    ? "grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_90px_80px_100px_64px_76px]"
    : "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_84px_74px_74px_88px_96px_60px_168px_60px_76px]";
}

export const GROUP_TITLE: Record<ReceiptLineKind, string> = { FABRIC: "Kumaş kalemleri", YARN: "İplik kalemleri" };
export const ADD_LINE_LABEL: Record<ReceiptLineKind, string> = { FABRIC: "Kumaş satırı ekle", YARN: "İplik satırı ekle" };
