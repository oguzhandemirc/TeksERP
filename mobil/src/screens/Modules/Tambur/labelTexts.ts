// Tambur etiket kumaş adı / renk (topa kesimde yazılır) — saf kararlar; ekran, hook ve jest aynı kaynaktan.
// Değer YAPIŞKANDIR ama İE'de saklanmaz: kapsam (iş emri) açılınca sunucunun `last`ından bir kez dolar.

/** Sunucu sınırıyla aynı (Roll.labelItemName / labelColorName VARCHAR(80)). */
export const LABEL_TEXT_MAX = 80;

/** İE geneli düzeltmenin (labelOverrides) bu pencerede artık gösterilmeyen ad anahtarları — yerini topun değeri aldı. */
export const NAME_OVERRIDE_KEYS: ReadonlySet<string> = new Set(['deliveryNoteItemText', 'deliveryNoteColorText', 'itemName', 'colorName']);

/** İE geneli "Parti no" (`batchNumber`, bizim parti) — üstte topun parti alanı (Roll.labelBatchNo) varken pencerede ikinci "Parti no" olmasın. */
export const BATCH_OVERRIDE_KEY = 'batchNumber';

/** Pencerenin sağ sütununda gösterilecek İE geneli anahtarlar: ad/renk hep düşer; parti alanı açıkken `batchNumber` da düşer. */
export function visibleOverrideKeys<T extends { key: string }>(keys: readonly T[], batchFieldShown: boolean): T[] {
  return keys.filter((k) => !NAME_OVERRIDE_KEYS.has(k.key) && !(batchFieldShown && k.key === BATCH_OVERRIDE_KEY));
}

export interface LabelTextsState {
  /** Yapışkanlığın kapsamı (iş emri id; yoksa çözülen müşteri). Değişince sıfırlanır. */
  scopeKey: string | null;
  itemName: string;
  colorName: string;
  /** Etiket alıcısı (2026-11-10, yalnız emanet); null = malın sahibi (labelConsigneeId gitmez). */
  consigneeId: string | null;
  consigneeName: string | null;
  /** Bu kapsam için `last` tohumu uygulandı mı (bir kez; operatör girişini ezmez). */
  seeded: boolean;
}

export interface LabelTextsLast {
  itemName: string | null;
  colorName: string | null;
  batchNo: string | null;
  consigneeId?: string | null;
  consigneeName?: string | null;
}

/** Kesim/bitir gövdesine yayılan etiket alanları (`...labelTexts`) — eski backend bilmediğini strip eder. */
export interface LabelTextsBody {
  labelItemName?: string;
  labelColorName?: string;
  labelConsigneeId?: string;
  weightSource?: 'SCALE' | 'MANUAL' | 'SIMULATED';
  widthCm?: number;
}

export function initialLabelTexts(scopeKey: string | null): LabelTextsState {
  return { scopeKey, itemName: '', colorName: '', consigneeId: null, consigneeName: null, seeded: false };
}

export function normalizeLabelText(text: string | null | undefined): string | null {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  return t === '' ? null : t.slice(0, LABEL_TEXT_MAX);
}

/** Kapsam değişti → sıfır; aynıysa aynı nesne. */
export function withTextsScope(s: LabelTextsState, scopeKey: string | null): LabelTextsState {
  return s.scopeKey === scopeKey ? s : initialLabelTexts(scopeKey);
}

/** Sunucunun son değeriyle bir kez doldur; operatör o arada yazdıysa dokunma. */
export function withSeed(s: LabelTextsState, last: LabelTextsLast | null | undefined): LabelTextsState {
  if (s.seeded) return s;
  if (!last) return { ...s, seeded: true };
  return {
    ...s,
    itemName: last.itemName ?? '',
    colorName: last.colorName ?? '',
    consigneeId: last.consigneeId ?? null,
    consigneeName: last.consigneeId ? (last.consigneeName ?? null) : null,
    seeded: true,
  };
}

/** Alıcı seç (null = sahibine dön). Ad/renk alıcıya özgü olabileceği için dokunulmaz; öneriler alıcıyla tazelenir. */
export function withConsignee(s: LabelTextsState, c: { id: string; name: string } | null): LabelTextsState {
  return { ...s, consigneeId: c?.id ?? null, consigneeName: c?.name ?? null, seeded: true };
}

export function withTexts(s: LabelTextsState, v: { itemName: string; colorName: string }): LabelTextsState {
  return { ...s, itemName: v.itemName.slice(0, LABEL_TEXT_MAX), colorName: v.colorName.slice(0, LABEL_TEXT_MAX), seeded: true };
}

/** İstek gövdesine giden alanlar: yalnız dolu olanlar (boş → alan hiç gitmez = bugünkü gövde, sunucuda null). */
export function labelTextsBody(s: Pick<LabelTextsState, 'itemName' | 'colorName'>): { labelItemName?: string; labelColorName?: string } {
  const item = normalizeLabelText(s.itemName);
  const color = normalizeLabelText(s.colorName);
  return { ...(item ? { labelItemName: item } : {}), ...(color ? { labelColorName: color } : {}) };
}

export interface LabelSummaryInput {
  itemName: string;
  colorName: string;
  batchNo: string;
  batchEnabled: boolean;
  /** Boş kutuda basılacak kaynak değerler (kumaşın kendi adı/rengi, İE parti no). */
  defaults?: { itemName?: string | null; colorName?: string | null; batchNo?: string | null };
}

/** Özet satırı: "Etiket: SULTAN · EKRU · P1". Boş alan kaynağın değeriyle (yoksa "kendi adı") yazılır. */
export function labelSummaryText(p: LabelSummaryInput): string {
  const item = normalizeLabelText(p.itemName) ?? p.defaults?.itemName ?? 'kumaşın adı';
  const color = normalizeLabelText(p.colorName) ?? p.defaults?.colorName ?? null;
  const parts = [item];
  if (color) parts.push(color);
  if (p.batchEnabled) {
    const b = normalizeLabelText(p.batchNo) ?? p.defaults?.batchNo ?? null;
    if (b) parts.push(b);
  }
  return `Etiket: ${parts.join(' · ')}`;
}

/** Kutudaki silik ipucu: "Boş: <kaynak değer>". */
export function emptyHint(fallback: string | null | undefined, generic: string): string {
  return `Boş: ${fallback && fallback.trim() !== '' ? fallback : generic}`;
}
