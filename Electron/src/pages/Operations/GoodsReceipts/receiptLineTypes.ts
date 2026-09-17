// =============================================================================
// MAL KABUL TASLAK SATIRI — tip + saf yardımcılar (EK 5: satır DOĞDUĞU ANDA tiplidir; top sınıfı satır bazlı)
// =============================================================================
import type { ReceiptLineKind } from "./receiptLineColumns";

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
  /** KUMAŞ satırı TOP SINIFI (EK 5): `true` ham, `false` bitmiş, `null` = fişin varsayılanı (gövdeye gönderilmez). */
  rawStock?: boolean | null;
}

export function emptyLine(kind: ReceiptLineKind = "FABRIC"): DraftLine {
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
    rawStock: null,
  };
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
