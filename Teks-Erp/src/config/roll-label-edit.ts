// =============================================================================
// TOP ETİKETİ ELLE DÜZENLEME — izinli alanlar + birleştirme + uygulama (panel "Etiketi düzenle")
// =============================================================================
// Kullanıcı tek bir topun etiketindeki alanları elle yazar (kayıtta olmayan müşteri adı, desen,
// metraj gösterimi …). Üç kolon mevcut sahibine yazılır (`Roll.labelItemName/labelColorName/
// labelBatchNo`), geri kalan her alan `Roll.labelOverrides`a. Değer YALNIZ GÖSTERİMDİR: ölçü
// kolonları, cari ve katalog kayıtları değişmez. Kimlik taşıyan alanlar (barkod/QR, müşteri
// barkodu, kartelalık damgası, basım tarihi) düzenlenemez.
// =============================================================================
import { ROLL_FINISHED_FIELDS, ROLL_RAW_FIELDS, type FieldDef } from "./label-fields";
import type { LabelPayload } from "../types/label.types";

const EXCLUDED = new Set(["barcode", "qrCode", "customerCode", "kartelaMark", "printedAt"]);

/** Topun kendi etiket kolonuna yazılan alanlar (tamburun da yazdığı; zincirin önünde). */
export const ROLL_LABEL_COLUMN_KEYS = {
  itemName: "labelItemName",
  colorName: "labelColorName",
  labelBatchNo: "labelBatchNo",
} as const;
export type RollLabelColumnKey = keyof typeof ROLL_LABEL_COLUMN_KEYS;
export type RollLabelColumn = (typeof ROLL_LABEL_COLUMN_KEYS)[RollLabelColumnKey];

/** Ölçülen değer alanları — ezme yalnız etikette görünür, `Roll` ölçüsü değişmez. */
export const ROLL_LABEL_MEASURED_KEYS: ReadonlySet<string> = new Set(["widthCm", "lengthMeters", "weightKg"]);

/** Düzenlenebilir alan kataloğu = top etiket alan kataloğu (ham ∪ bitmiş) − kimlik alanları. */
export const ROLL_LABEL_EDIT_FIELDS: readonly FieldDef[] = (() => {
  const seen = new Map<string, FieldDef>();
  for (const f of [...ROLL_FINISHED_FIELDS, ...ROLL_RAW_FIELDS]) {
    if (!EXCLUDED.has(f.key) && !seen.has(f.key)) seen.set(f.key, f);
  }
  return [...seen.values()];
})();
export const ROLL_LABEL_EDIT_KEY_SET: ReadonlySet<string> = new Set(ROLL_LABEL_EDIT_FIELDS.map((f) => f.key));
export const ROLL_LABEL_OVERRIDE_TEXT_MAX = 120;

export const isRollLabelColumnKey = (k: string): k is RollLabelColumnKey =>
  Object.prototype.hasOwnProperty.call(ROLL_LABEL_COLUMN_KEYS, k);

export type RollLabelOverrides = Record<string, string>;

/** DB JSON → yalnız izinli (kolon dışı) anahtarlar + metin değerler; bozuk satır kaynak değere düşer. */
export function readRollLabelOverrides(raw: unknown): RollLabelOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RollLabelOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (ROLL_LABEL_EDIT_KEY_SET.has(k) && !isRollLabelColumnKey(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

// Eski (şablonsuz) düzenler payload alanını doğrudan okur → düz metin alanları payload'a da yazılır.
// qualityGrade BİLEREK yok: showIf koşulu ve fire kapısı gerçek kaliteyle karar verir.
const PAYLOAD_TEXT_MIRROR = new Set([
  "itemNameDefault", "itemCode", "colorNameDefault", "colorCode", "foldType", "customerName", "orderNumber",
  "batchNumber", "workOrderNumber", "openDefects", "deliveryNoteItemText", "deliveryNoteColorText",
  "deliveryNoteRollNo", "consigneeName",
]);

/**
 * Topun elle yazılmış alanlarını payload'a uygula (yerinde, zincirin EN SONUNDA). Görünür değerin tek
 * okuyucusu `fieldDisplayValue` `displayOverrides`ı önce okur; boşken payload bayt-aynı kalır.
 */
export function applyRollLabelOverrides(payload: LabelPayload, overrides: RollLabelOverrides): void {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return;
  payload.displayOverrides = { ...overrides };
  const target = payload as unknown as Record<string, unknown>;
  for (const k of keys) if (PAYLOAD_TEXT_MIRROR.has(k)) target[k] = overrides[k];
}
