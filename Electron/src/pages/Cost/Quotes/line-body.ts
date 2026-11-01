// "Kalem ekle" formu → `POST /api/quotes/:id/lines` gövdesi. Ürün YA DA elle yapı (yeni desen) — ikisi birden asla.
// Boş fiyat gönderilmez: sunucu öneri zincirinden fiyatlar (liste > ürün fiyatı > maliyet + kâr). HESAP YOK.
import { adHocBody, emptyCalculator, type AdHocForm } from "../Calculator/calculator-body";
import { toDecimalText } from "../shared/format";
import type { LineBody } from "./service";

export interface LineForm {
  mode: "item" | "adHoc";
  item: { id: string; code: string; name: string } | null;
  adHoc: AdHocForm;
  rateCode: string;
  description: string;
  colorId: string | null;
  /** Seçilen desenin varyantı (ürün şablonu); yalnız ürünlü kalemde gider, ürün değişince sıfırlanır. */
  recipeId: string | null;
  width: string;
  quantity: string;
  unitPrice: string;
  markupPct: string;
}

/** Hızlı Hesaplayıcı'dan teklife taşınan kalem (router state). */
export type PendingLine =
  | { mode: "item"; item: { id: string; code: string; name: string } }
  | { mode: "adHoc"; adHoc: AdHocForm; rateCode: string };

export function emptyLineForm(pending?: PendingLine | null): LineForm {
  const base: LineForm = {
    mode: "item", item: null, adHoc: emptyCalculator().adHoc, rateCode: "", description: "", colorId: null, recipeId: null,
    width: "", quantity: "", unitPrice: "", markupPct: "",
  };
  if (!pending) return base;
  return pending.mode === "item" ? { ...base, item: pending.item } : { ...base, mode: "adHoc", adHoc: pending.adHoc, rateCode: pending.rateCode };
}

/** Gönderilecek gövde; eksikse null (düğme kapalı kalır). */
export function buildLineBody(f: LineForm): LineBody | null {
  const quantity = toDecimalText(f.quantity);
  if (!quantity) return null;
  const common: LineBody = {
    quantity,
    ...(toDecimalText(f.width) ? { width: toDecimalText(f.width) } : {}),
    ...(toDecimalText(f.unitPrice) ? { unitPrice: toDecimalText(f.unitPrice) } : {}),
    ...(toDecimalText(f.markupPct) ? { markupPct: toDecimalText(f.markupPct) } : {}),
    ...(f.colorId ? { colorId: f.colorId } : {}),
  };
  if (f.mode === "item") {
    if (!f.item) return null;
    return { ...common, itemId: f.item.id, ...(f.recipeId ? { recipeId: f.recipeId } : {}), ...(f.description.trim() ? { description: f.description.trim() } : {}) };
  }
  const adHoc = adHocBody(f.adHoc, f.rateCode);
  if (!adHoc || !f.description.trim()) return null;
  return { ...common, adHoc, description: f.description.trim() };
}
