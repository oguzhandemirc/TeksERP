// =============================================================================
// MÜŞTERİ BARKOD SERİSİ — panel istemcisi (D4-F2; backend `customer-barcode-series.routes.ts`)
// =============================================================================
// Gövde `.strict()` — alan eklemek iki uçta yapılır. Güncelleme `expectedUpdatedAt` ile atomik
// (409 SERIES_CHANGED); yaratma `clientToken` deneme başına (`useAttemptToken`).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { SeriesDateSegment } from "@/pages/GeneralSettings/Numbering/types";

export const SEPARATOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Yok" },
  { value: "-", label: "Tire (-)" },
  { value: "/", label: "Eğik çizgi (/)" },
  { value: ".", label: "Nokta (.)" },
  { value: "_", label: "Alt çizgi (_)" },
];

export interface BarcodeSeries {
  id: string;
  customerId: string;
  prefix: string;
  dateSegment: SeriesDateSegment;
  digits: number;
  separator: string;
  startValue: number | null;
  maxValue: number | null;
  formatChangedAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface BarcodeSeriesView {
  series: BarcodeSeries | null;
  nextCode: string | null;
}

/** Form alanları — sayılar metin olarak tutulur (boş = sınırsız/varsayılan). */
export interface BarcodeSeriesForm {
  prefix: string;
  dateSegment: SeriesDateSegment;
  digits: string;
  separator: string;
  startValue: string;
  maxValue: string;
  isActive: boolean;
}

export const EMPTY_FORM: BarcodeSeriesForm = {
  prefix: "", dateSegment: "NONE", digits: "4", separator: "", startValue: "", maxValue: "", isActive: true,
};

export function formFromSeries(s: BarcodeSeries | null): BarcodeSeriesForm {
  if (!s) return EMPTY_FORM;
  return {
    prefix: s.prefix, dateSegment: s.dateSegment, digits: String(s.digits), separator: s.separator,
    startValue: s.startValue == null ? "" : String(s.startValue), maxValue: s.maxValue == null ? "" : String(s.maxValue),
    isActive: s.isActive,
  };
}

const optInt = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/** Form → biçim gövdesi (backend `formatShape`). */
export function toFormatBody(f: BarcodeSeriesForm) {
  return {
    prefix: f.prefix.trim().toUpperCase(),
    dateSegment: f.dateSegment,
    digits: Number(f.digits),
    separator: f.separator,
    startValue: optInt(f.startValue),
    maxValue: optInt(f.maxValue),
  };
}

/** GÖRÜNÜR biçim farklı mı — fark varsa kaydetmek sayacı yeni biçimden başlatır (başlangıç/üst sınır sayaç ayarıdır). */
export function visibleFormatDiffers(s: BarcodeSeries | null, f: BarcodeSeriesForm): boolean {
  if (!s) return true;
  const b = toFormatBody(f);
  return b.prefix !== s.prefix || b.dateSegment !== s.dateSegment || b.digits !== s.digits || b.separator !== s.separator;
}

/** Formda kayıtlı seriden herhangi bir fark var mı (Kaydet düğmesi). */
export function formDirty(s: BarcodeSeries | null, f: BarcodeSeriesForm): boolean {
  if (!s) return true;
  const b = toFormatBody(f);
  return visibleFormatDiffers(s, f) || b.startValue !== s.startValue || b.maxValue !== s.maxValue || f.isActive !== s.isActive;
}

const base = (customerId: string) => `/api/customers/${customerId}/barcode-series`;

export async function getBarcodeSeries(customerId: string): Promise<BarcodeSeriesView> {
  const r = await apiClient.get(base(customerId));
  return r.data.data as BarcodeSeriesView;
}

export async function createBarcodeSeries(customerId: string, f: BarcodeSeriesForm, clientToken: string): Promise<{ message?: string }> {
  const r = await apiClient.post(base(customerId), { ...toFormatBody(f), clientToken });
  return r.data;
}

export async function updateBarcodeSeries(customerId: string, f: BarcodeSeriesForm, expectedUpdatedAt: string): Promise<{ message?: string }> {
  const r = await apiClient.put(base(customerId), { ...toFormatBody(f), isActive: f.isActive, expectedUpdatedAt });
  return r.data;
}

export async function previewBarcodeSeries(customerId: string, f: BarcodeSeriesForm): Promise<{ codes: string[]; formatChanged: boolean; collides: boolean }> {
  const r = await apiClient.post(`${base(customerId)}/preview`, toFormatBody(f));
  return r.data.data;
}
