// OKUMA KORUMASI — metre hücresinden okunan kg forma yazılmaz (belge tanıt 3 aşama, 2026-11-09; saf). İki yüklem: şablonun
// kg alanı metre alanıyla aynı hücreyi okuyor (`clashingKgFields`) ya da kayıtlı bölgede kg değeri bir metre değeriyle BİREBİR
// aynı (şablon sonradan düzeltilse de eski okumanın 241 = 241'i forma dönmesin). Çakışan kg alanı düşer, uyarı verilir.
import { KG_FAMILY_FIELDS, METER_FAMILY_FIELDS, clashingKgFields } from "./motor";
import { templateByCode } from "./sablon-bul";

export const KG_FROM_METER_CELL = "KG_FROM_METER_CELL";
export const KG_FROM_METER_CELL_TEXT = `${KG_FROM_METER_CELL}: Kg, metre hücresinden okunuyor; belge tipini düzenleyin.`;

export interface GuardedFields {
  fields: Record<string, string | null>;
  /** Düşürülen kg alanları (boşsa koruma tetiklenmedi). */
  dropped: string[];
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a?.trim() && a.trim() === b?.trim();

export function guardKgFields(region: { templateId: string | null; fields: Readonly<Record<string, string | null>> } | null | undefined): GuardedFields {
  const fields = { ...(region?.fields ?? {}) };
  const clash = clashingKgFields(templateByCode(region?.templateId));
  const dropped: string[] = [];
  for (const k of KG_FAMILY_FIELDS) {
    if (!fields[k]) continue;
    if (clash.has(k) || METER_FAMILY_FIELDS.some((m) => same(fields[k], fields[m]))) {
      delete fields[k];
      dropped.push(k);
    }
  }
  return { fields, dropped };
}
