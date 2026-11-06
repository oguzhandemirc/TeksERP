// Tambur müşteri parti no (etikete basılan "Parti: J1") — saf kararlar; ekran, hook ve jest aynı kaynaktan.
// Değer YAPIŞKANDIR: operatör bir kez yazar, aynı iş emrinde her kesime gider; iş emri (kapsam) değişince sıfırlanır.

/** Sunucu sınırıyla aynı (Roll.labelBatchNo VARCHAR(64)). */
export const LABEL_BATCH_MAX = 64;

export interface LabelBatchState {
  /** Yapışkanlığın kapsamı (iş emri id; yoksa çözülen müşteri). Değişince değer sıfırlanır. */
  scopeKey: string | null;
  value: string;
  /** Bu değerle başarıyla doğan top sayısı. */
  count: number;
}

export function initialLabelBatch(scopeKey: string | null): LabelBatchState {
  return { scopeKey, value: '', count: 0 };
}

export function normalizeLabelBatch(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return t === '' ? null : t.slice(0, LABEL_BATCH_MAX);
}

/** Kapsam değişti mi → sıfır; aynıysa aynı nesne (gereksiz render yok). */
export function withScope(s: LabelBatchState, scopeKey: string | null): LabelBatchState {
  return s.scopeKey === scopeKey ? s : initialLabelBatch(scopeKey);
}

/** Yeni değer: normalize hâli değiştiyse sayaç sıfırlanır, aynıysa sayaç korunur. */
export function withValue(s: LabelBatchState, text: string): LabelBatchState {
  const same = normalizeLabelBatch(text) === normalizeLabelBatch(s.value);
  return { ...s, value: text.slice(0, LABEL_BATCH_MAX), count: same ? s.count : 0 };
}

/** Kesim başarılı → gönderilen değer hâlâ geçerli değerse sayaç artar (arada değiştiyse sayılmaz). */
export function withUse(s: LabelBatchState, sent: string | null | undefined): LabelBatchState {
  const cur = normalizeLabelBatch(s.value);
  if (cur == null || sent == null || sent !== cur) return s;
  return { ...s, count: s.count + 1 };
}

/**
 * İstek gövdesine giden değer. Ayar KAPALIYKEN undefined (alan hiç gitmez — sunucu
 * değer görürse 400 LABEL_BATCH_NOT_ENABLED verir); açıkken metin ya da null.
 */
export function labelBatchBody(enabled: boolean, s: LabelBatchState): string | null | undefined {
  if (!enabled) return undefined;
  return normalizeLabelBatch(s.value);
}

/** Şerit metni: "Etikete basılacak parti: J1 · bu değerle 3. top". */
export function labelBatchStripText(s: LabelBatchState): string {
  const v = normalizeLabelBatch(s.value);
  if (v == null) return 'Etikete basılacak parti: —';
  return `Etikete basılacak parti: ${v} · bu değerle ${s.count + 1}. top`;
}

/** Boşsa uyarı (durdurmaz — müşteri her topta parti istemeyebilir). */
export function labelBatchWarning(enabled: boolean, s: LabelBatchState): string | null {
  if (!enabled) return null;
  return normalizeLabelBatch(s.value) == null ? 'Parti boş — etikete müşteri partisi basılmaz' : null;
}

/** Şeridin parçaları: değer büyük yazılır, sayaç yanında küçük; boşsa değer null ("—" + uyarı). */
export function labelBatchStripParts(s: LabelBatchState): { value: string | null; countText: string | null } {
  const v = normalizeLabelBatch(s.value);
  return v == null ? { value: null, countText: null } : { value: v, countText: `bu değerle ${s.count + 1}. top` };
}
