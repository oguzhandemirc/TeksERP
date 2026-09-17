// =============================================================================
// MAL KABUL TASLAK SATIRI — tip + saf yardımcılar (EK 5: satır DOĞDUĞU ANDA tiplidir; EK 7: top sınıfı satır bazlı ÜÇLÜ)
// =============================================================================
import type { ReceiptLineKind } from "./receiptLineColumns";

/** KUMAŞ satırı TOP SINIFI (EK 7, kullanıcı kararı 2026-09-18) — backend `lineClass` aynası. */
export const RECEIPT_LINE_CLASSES = ["RAW", "SEMI_FINISHED", "FINISHED"] as const;
export type ReceiptLineClass = (typeof RECEIPT_LINE_CLASSES)[number];
export const LINE_CLASS_LABEL: Record<ReceiptLineClass, string> = { RAW: "Ham", SEMI_FINISHED: "Yarı mamul", FINISHED: "Bitmiş" };
/** Fiş kutusu KALKTI: ilk kumaş satırı bitmiş doğar, sonrakiler bir önceki kumaş satırını miras alır. */
export const DEFAULT_LINE_CLASS: ReceiptLineClass = "FINISHED";

export interface DraftLine {
  key: string;
  /** Satırın grubu — "… satırı ekle" düğmesinden doğar; ürün seçilince ürün türü kazanır (`useItemTypes`). */
  kind?: ReceiptLineKind;
  itemId: string;
  colorId: string | null;
  /** TOP BAŞINA metre (adetle çarpılmaz — her top bu metrede doğar); iplikte KG. */
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  foldType: string | null;
  /** Satın alma birim fiyatı (fişin para biriminde) — opsiyonel. */
  unitPrice: number | null;
  /** Üretim özellikleri (FabricProperty id'leri) — opsiyonel. */
  propertyIds: string[];
  /** Kaç TOP gelmiş — kaydederken bu sayıda ayrı top doğar. */
  count: number;
  /** İPLİK satırı: tedarikçi lot numarası (irsaliyedeki metin, olduğu gibi; opsiyonel — devere Faz 2). */
  lotNo?: string | null;
  /** İPLİK satırı: bobin adedi (bilgi; opsiyonel). */
  bobbinCount?: number | null;
  /** KUMAŞ satırı TOP SINIFI (EK 7): Ham · Yarı mamul · Bitmiş — satır tek yer, fiş kutusu YOK; iplikte anlamsız. */
  lineClass?: ReceiptLineClass;
}

export function emptyLine(kind: ReceiptLineKind = "FABRIC", lineClass: ReceiptLineClass = DEFAULT_LINE_CLASS): DraftLine {
  return {
    key: crypto.randomUUID(),
    kind,
    itemId: "",
    colorId: null,
    initialQty: 0,
    width: null,
    weightKg: null,
    foldType: null,
    unitPrice: null,
    propertyIds: [],
    count: 1,
    lotNo: null,
    bobbinCount: null,
    lineClass: kind === "FABRIC" ? lineClass : undefined,
  };
}

/** Yeni kumaş satırının sınıfı — listedeki SON kumaş satırınınki (miras), hiç yoksa bitmiş. */
export function inheritedLineClass(lines: readonly DraftLine[], yarnItemIds?: ReadonlySet<string>): ReceiptLineClass {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (lineKind(l, yarnItemIds) === "FABRIC") return l.lineClass ?? DEFAULT_LINE_CLASS;
  }
  return DEFAULT_LINE_CLASS;
}

/** Satırı kopyalar — YENİ anahtarla (idempotency token'ı da yeniden doğar). */
export function duplicateLine(l: DraftLine): DraftLine {
  return { ...l, key: crypto.randomUUID() };
}

/** Satırın grubu: ürün türü çözüldüyse o (`useItemTypes`, asenkron; import/siparişten gelen satırın tek kaynağı), değilse
 *  doğduğu grup (`kind`; ürün seçici o gruba kilitli olduğu için çelişmez); ikisi de yoksa kumaş (eski davranış). */
export function lineKind(l: DraftLine, yarnItemIds?: ReadonlySet<string>): ReceiptLineKind {
  if (l.itemId && yarnItemIds?.has(l.itemId)) return "YARN";
  if (l.kind) return l.kind;
  return "FABRIC";
}
