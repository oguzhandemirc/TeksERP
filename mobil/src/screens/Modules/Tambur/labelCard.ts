// "Etikette" kartı (2026-11-10) — basılacak şablonun alanları (GET /tambur/label-preview-fields) ekrandaki
// değerlerle eşlenir. Şablonda olmayan alan GÖSTERİLMEZ; değeri olmayan alan soluk "—" (basılmaz ipucu).
// Uç yoksa (eski backend → fields null) kart bugünkü özet satırına döner (`labelSummaryText`).

export interface LabelCardValues {
  itemName: string | null;
  colorName: string | null;
  batchNo: string | null;
  consigneeName: string | null;
  qualityName: string | null;
  meters: string | null;
  kg: string | null;
  widthCm: string | null;
  customerName: string | null;
}

export interface LabelCardRow {
  key: string;
  label: string;
  value: string;
  muted: boolean;
}

const VALUE_OF: Record<string, (v: LabelCardValues) => string | null> = {
  itemName: (v) => v.itemName,
  itemNameDefault: (v) => v.itemName,
  deliveryNoteItemText: (v) => v.itemName,
  colorName: (v) => v.colorName,
  colorNameDefault: (v) => v.colorName,
  deliveryNoteColorText: (v) => v.colorName,
  labelBatchNo: (v) => v.batchNo,
  customerBatchNo: (v) => v.batchNo,
  consigneeName: (v) => v.consigneeName,
  qualityGrade: (v) => v.qualityName,
  lengthMeters: (v) => v.meters,
  weightKg: (v) => v.kg,
  widthCm: (v) => v.widthCm,
  customerName: (v) => v.customerName,
};

export function labelCardRows(fields: readonly { key: string; label: string }[], values: LabelCardValues): LabelCardRow[] {
  return fields.map((f) => {
    const raw = VALUE_OF[f.key]?.(values) ?? null;
    const value = raw != null && raw.trim() !== '' ? raw : null;
    return { key: f.key, label: f.label, value: value ?? '—', muted: value == null };
  });
}

/** K2: kg kutusu şablon kg basıyorsa ya da tartım zorunluysa görünür; eski backend (fields null) → bugünkü kural (zorunluysa). */
export function kgFieldVisible(fields: readonly { key: string }[] | null | undefined, weighRequired: boolean): boolean {
  return weighRequired || (fields ?? []).some((f) => f.key === 'weightKg');
}

/** K7c: en kutusu şablon en basıyorsa görünür. */
export function widthFieldVisible(fields: readonly { key: string }[] | null | undefined): boolean {
  return (fields ?? []).some((f) => f.key === 'widthCm');
}
