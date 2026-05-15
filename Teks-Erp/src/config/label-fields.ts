// =============================================================================
// TeksERP - Etiket Field Catalog (source of truth)
// =============================================================================
// Her LabelKind için hangi field key'ler izinli ve default Türkçe başlıkları
// nedir — burada tanımlı. LabelTemplateService bu catalog ile validate eder
// (whitelist), frontend de buradan gelen liste üzerinden UI render eder.
// Yeni alan eklemek için: önce buraya, sonra label payload builder'a, sonra
// frontend renderer'a.
// =============================================================================

import { LabelKind } from "@prisma/client";

export type FontSize = "sm" | "md" | "lg" | "xl";

export const FONT_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"] as const;

export interface FieldDef {
  /** Payload'daki key — backend bu key'in değerini döner. */
  key: string;
  /** Default Türkçe başlık (template'te override edilebilir). */
  defaultLabel: string;
  /** UX ipucu — tip bilgisi: text/number/date/qr/barcode. Frontend render seçimi için. */
  type: "text" | "number" | "date" | "qr" | "barcode" | "table";
  /** Bu alan kapatılabilir mi? false ise template'te isVisible=true zorunlu (örn. barkod). */
  required?: boolean;
}

export interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: FontSize;
}

// =============================================================================
// ROLL — Tambur output / Packaging label / standalone reprint
// =============================================================================
export const ROLL_FIELDS: readonly FieldDef[] = [
  { key: "barcode",         defaultLabel: "Barkod",            type: "barcode", required: true },
  { key: "qrCode",          defaultLabel: "QR Kod",            type: "qr" },
  { key: "itemName",        defaultLabel: "Ürün",              type: "text" },
  { key: "itemNameDefault", defaultLabel: "Ürün (bizdeki ad)", type: "text" },
  { key: "itemCode",        defaultLabel: "Ürün Kodu",         type: "text" },
  { key: "colorName",       defaultLabel: "Renk",              type: "text" },
  { key: "colorCode",       defaultLabel: "Renk Kodu",         type: "text" },
  { key: "qualityGrade",    defaultLabel: "Kalite",            type: "text" },
  { key: "widthCm",         defaultLabel: "En (cm)",           type: "number" },
  { key: "lengthMeters",    defaultLabel: "Metraj (m)",        type: "number" },
  { key: "weightKg",        defaultLabel: "Ağırlık (kg)",      type: "number" },
  { key: "customerName",    defaultLabel: "Müşteri",           type: "text" },
  { key: "orderNumber",     defaultLabel: "Sipariş No",        type: "text" },
  { key: "batchNumber",     defaultLabel: "Parti No",          type: "text" },
  { key: "packagingDate",   defaultLabel: "Paketleme Tarihi",  type: "date" },
  { key: "printedAt",       defaultLabel: "Baskı Tarihi",      type: "date" },
] as const;

// =============================================================================
// SWATCH — Kartela
// =============================================================================
export const SWATCH_FIELDS: readonly FieldDef[] = [
  { key: "barcode",           defaultLabel: "Barkod",           type: "barcode", required: true },
  { key: "qrCode",            defaultLabel: "QR Kod",           type: "qr" },
  { key: "cardNumber",        defaultLabel: "Kart No",          type: "text" },
  { key: "itemName",          defaultLabel: "Ürün",             type: "text" },
  { key: "itemCode",          defaultLabel: "Ürün Kodu",        type: "text" },
  { key: "colorName",         defaultLabel: "Renk",             type: "text" },
  { key: "colorCode",         defaultLabel: "Renk Kodu",        type: "text" },
  { key: "widthCm",           defaultLabel: "En (cm)",          type: "number" },
  { key: "lengthCm",          defaultLabel: "Boy (cm)",         type: "number" },
  { key: "weightKg",          defaultLabel: "Ağırlık (kg)",     type: "number" },
  { key: "customerName",      defaultLabel: "Müşteri",          type: "text" },
  { key: "batchNumber",       defaultLabel: "Parti No",         type: "text" },
  { key: "parentRollBarcode", defaultLabel: "Ana Top Barkodu",  type: "text" },
  { key: "printedAt",         defaultLabel: "Baskı Tarihi",     type: "date" },
] as const;

// =============================================================================
// SHIPMENT_DOCKET — Sevkiyat irsaliyesi
// =============================================================================
export const SHIPMENT_DOCKET_FIELDS: readonly FieldDef[] = [
  { key: "shipmentNumber", defaultLabel: "İrsaliye No",    type: "text", required: true },
  { key: "shippedAt",      defaultLabel: "Sevk Tarihi",    type: "date" },
  { key: "customerName",   defaultLabel: "Müşteri",        type: "text", required: true },
  { key: "customerCode",   defaultLabel: "Müşteri Kodu",   type: "text" },
  { key: "branchName",     defaultLabel: "Şube",           type: "text" },
  { key: "driverName",     defaultLabel: "Şoför",          type: "text" },
  { key: "plateNumber",    defaultLabel: "Plaka",          type: "text" },
  { key: "carrier",        defaultLabel: "Nakliye Firması", type: "text" },
  { key: "items",          defaultLabel: "Ürün Tablosu",   type: "table" },
  { key: "totals",         defaultLabel: "Toplamlar",      type: "text" },
] as const;

// =============================================================================
// Aggregation + lookup
// =============================================================================

export const FIELD_CATALOG: Record<LabelKind, readonly FieldDef[]> = {
  [LabelKind.ROLL]:            ROLL_FIELDS,
  [LabelKind.SWATCH]:          SWATCH_FIELDS,
  [LabelKind.SHIPMENT_DOCKET]: SHIPMENT_DOCKET_FIELDS,
};

export function getAllowedKeys(kind: LabelKind): Set<string> {
  return new Set(FIELD_CATALOG[kind].map((f) => f.key));
}

export function getRequiredKeys(kind: LabelKind): Set<string> {
  return new Set(FIELD_CATALOG[kind].filter((f) => f.required).map((f) => f.key));
}

export function findFieldDef(kind: LabelKind, key: string): FieldDef | null {
  return FIELD_CATALOG[kind].find((f) => f.key === key) ?? null;
}

/**
 * Catalog'daki TÜM alanları visible=true + ardışık order ile döner.
 * Yeni template oluştururken "sıfırdan iyi bir başlangıç" üretir.
 */
export function buildDefaultFields(kind: LabelKind): TemplateField[] {
  return FIELD_CATALOG[kind].map((f, idx) => ({
    key: f.key,
    label: f.defaultLabel,
    order: idx + 1,
    isVisible: true,
  }));
}
