// =============================================================================
// İŞ EMRİ ETİKET BİLGİSİ — izinli alanlar + uygulama (Gülkesim S5, cevap 4/6)
// =============================================================================
// Etiket alanları opsiyoneldir: İE açan ya da tamburcu eksik bilgiyi (desen, renk,
// en…) ekler, yanlışı düzeltir ya da alanı BOŞ bastırır. Değer iş emrine yazılır
// (`WorkOrder.labelOverrides`) → aynı işin her topu ve yeniden basımı aynı kâğıdı
// verir. Kimlik/karar taşıyan alanlar (barkod, kalite — showIf koşulu, müşteri
// kodu, metraj, tarih) BİLEREK listede yok: onları etiket metni değiştiremez.
// =============================================================================
import type { LabelPayload } from "../types/label.types";

export interface LabelOverrideKeyDef {
  key: string;
  /** Tablette/panelde görünen ad. */
  label: string;
  type: "text" | "number";
}

export const LABEL_OVERRIDE_KEYS: readonly LabelOverrideKeyDef[] = [
  { key: "deliveryNoteItemText", label: "Desen / kumaş (müşterinin adı)", type: "text" },
  { key: "deliveryNoteColorText", label: "Renk (müşterinin adı)", type: "text" },
  { key: "itemName", label: "Ürün adı", type: "text" },
  { key: "colorName", label: "Renk adı", type: "text" },
  { key: "widthCm", label: "En (cm)", type: "number" },
  { key: "deliveryNoteRollNo", label: "Müşteri top no", type: "text" },
  { key: "orderNumber", label: "Sipariş no", type: "text" },
  { key: "batchNumber", label: "Parti no", type: "text" },
];

export const LABEL_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(LABEL_OVERRIDE_KEYS.map((k) => k.key));
export const LABEL_OVERRIDE_TEXT_MAX = 120;

export type LabelOverrides = Record<string, string>;

/** DB JSON → yalnız izinli anahtarlar + metin değerler (bozuk satır sessizce kaynak değere düşer). */
export function readLabelOverrides(raw: unknown): LabelOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: LabelOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (LABEL_OVERRIDE_KEY_SET.has(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Payload'a iş emri etiket bilgisini uygula (yerinde). "" → alan boş basılır (present:false);
 * dolu metin → kaynak değerin yerine. Sayısal anahtar (en) sayıya çevrilir; çevrilemezse dokunulmaz.
 */
export function applyLabelOverrides(payload: LabelPayload, overrides: LabelOverrides): void {
  const target = payload as unknown as Record<string, unknown>;
  for (const def of LABEL_OVERRIDE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, def.key)) continue;
    const v = (overrides[def.key] ?? "").trim();
    if (def.type === "number") {
      if (v === "") target[def.key] = null;
      else {
        const n = Number(v.replace(",", "."));
        if (Number.isFinite(n) && n > 0) target[def.key] = n;
      }
      continue;
    }
    target[def.key] = v;
  }
}

/**
 * Topun kendi etiket kumaş adı / rengi (`Roll.labelItemName`/`labelColorName`, tamburda kesimde yazılır).
 * İE düzeltmesinden SONRA uygulanır → en önde. Müşteri belgesi adı (deliveryNote*Text) payload'da
 * varsa o da aynı ada çekilir: etikette aynı kumaşın iki farklı adı basılmasın. Null alan dokunulmaz.
 */
export function applyRollLabelTexts(
  payload: LabelPayload,
  roll: { labelItemName?: string | null; labelColorName?: string | null },
): void {
  const item = roll.labelItemName?.trim();
  if (item) {
    payload.itemName = item;
    payload.itemNameSource = "ROLL";
    if (Object.prototype.hasOwnProperty.call(payload, "deliveryNoteItemText")) payload.deliveryNoteItemText = item;
  }
  const color = roll.labelColorName?.trim();
  if (color) {
    payload.colorName = color;
    payload.colorNameSource = "ROLL";
    payload.colorNameScope = null;
    if (Object.prototype.hasOwnProperty.call(payload, "deliveryNoteColorText")) payload.deliveryNoteColorText = color;
  }
}
