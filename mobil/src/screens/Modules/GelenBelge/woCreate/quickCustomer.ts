// Belgeden İE formu — müşteri seçicisinin "Yeni ekle" formu (saha 2026-11-10): yalnız ad zorunlu, "Diğer" bölümü panel
// kartının önemli alanlarını taşır (sunucu `quickCreateBody` kümesi; ihracat kodu/ülke/sevk yönü sevkiyatın işi, burada yok).
import type { QuickCustomerExtra } from '../../../../services/customer.service';
import type { PickerOption } from '../../../../components/PickerModal';
import { foldSearchText } from '../../../../utils/searchFold';

export type QuickExtraKey = keyof QuickCustomerExtra;

export interface QuickExtraField {
  key: QuickExtraKey;
  label: string;
  max: number;
  keyboard?: 'number-pad' | 'phone-pad' | 'email-address';
  upper?: boolean;
  multiline?: boolean;
}

/** "Diğer" alanları — sınırlar sunucu kartıyla (`CARD_FIELDS`, vergi no 10-15 hane) aynı. */
export const QUICK_EXTRA_FIELDS: readonly QuickExtraField[] = [
  { key: 'taxNumber', label: 'Vergi / TC no', max: 15, keyboard: 'number-pad' },
  { key: 'contactName', label: 'Yetkili', max: 120 },
  { key: 'contactPhone', label: 'Telefon', max: 40, keyboard: 'phone-pad' },
  { key: 'email', label: 'E-posta', max: 200, keyboard: 'email-address' },
  { key: 'city', label: 'Şehir', max: 80, upper: true },
  { key: 'district', label: 'İlçe', max: 80, upper: true },
  { key: 'address', label: 'Adres', max: 500, multiline: true },
  { key: 'notes', label: 'Notlar', max: 500, multiline: true },
];

/** Saf: boş/boşluk alan gövdeye girmez (eski sunucu `.strict` gövdede bilinmeyen anahtarı 400'ler). */
export function quickExtraBody(extra: QuickCustomerExtra): QuickCustomerExtra {
  const out: QuickCustomerExtra = {};
  for (const f of QUICK_EXTRA_FIELDS) {
    const v = extra[f.key]?.trim();
    if (v) out[f.key] = v;
  }
  return out;
}

/** Saf: mantıksal denemenin kimliği — ad ya da dolu alanlardan biri değişirse yeni deneme (yeni token). */
export function quickAttemptKey(name: string, extra: QuickCustomerExtra): string {
  return JSON.stringify([name.trim(), quickExtraBody(extra)]);
}

/** Saf: "Diğer" bölümünde dolu alan sayısı (kapalı başlıkta "2 alan dolu" ipucu). */
export function filledExtraCount(extra: QuickCustomerExtra): number {
  return Object.keys(quickExtraBody(extra)).length;
}

export interface SameNameHits {
  /** Katlanmış adı birebir aynı kayıt — sunucu ad seddi 409 verir, kaydet kapanır. */
  exact: PickerOption | null;
  /** Adı içeren / içinde geçen kayıtlar (≥3 harf) — mükerrer kart doğmasın diye önce gösterilir. */
  similar: PickerOption[];
}

export const SIMILAR_MAX = 3;

/** Saf: yazılan adın listedeki eşi/benzerleri (sunucu ad seddi kesin hakemdir; bu yalnız erken uyarı). */
export function sameNameHits(name: string, options: readonly PickerOption[]): SameNameHits {
  const q = foldSearchText(name);
  if (!q) return { exact: null, similar: [] };
  let exact: PickerOption | null = null;
  const similar: PickerOption[] = [];
  for (const o of options) {
    const l = foldSearchText(o.label);
    if (l === q) exact ??= o;
    else if (q.length >= 3 && (l.includes(q) || (l.length >= 3 && q.includes(l))) && similar.length < SIMILAR_MAX) similar.push(o);
  }
  return { exact, similar };
}
