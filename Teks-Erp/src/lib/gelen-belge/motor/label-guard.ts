// Etiket değer olamaz (fail-closed): çıkarılan değer bir ETİKET metniyse alan boş kalır. Dönük/kayık okumada konum yedeği
// ya da yanlış çapa komşu etiketi ("Taşıma Tipi:", "Tarih") değer diye alıyordu; canlı okumada bu değer kilitleniyordu.
import type { DocumentTemplate, FieldResult } from "./types";
import { normalizeForMatch } from "./text-normalize";
import genel from "./templates/genel.json";

export const LABEL_AS_VALUE = "label-as-value";

export interface LabelGuard {
  /** Tam etiket metinleri (normalize): şablonun + GENEL sözlüğün çapa etiketleri, tablo kolon başlıkları. */
  labels: ReadonlySet<string>;
  /** Şablonun KENDİ çapa etiketlerinin kelimeleri: değer yalnız bunlardan oluşuyorsa etikettir. */
  words: ReadonlySet<string>;
}

function anchorLabels(t: Pick<DocumentTemplate, "fields">): string[] {
  return t.fields.flatMap((f) => f.strategies.flatMap((s) => (s.kind === "anchor" ? s.labels : [])));
}

function tableLabels(t: DocumentTemplate): string[] {
  return (t.tables ?? []).flatMap((tb) => tb.columns.flatMap((c) => c.headers));
}

const GENEL_LABELS = anchorLabels(genel as unknown as DocumentTemplate);

/** Şablon başına bir kez kurulur (`extractFields`). Tanıma anahtar kelimeleri DAHİL DEĞİL: gönderen firma adı oradadır, müşteri değeri olabilir. */
export function labelGuardFor(t: DocumentTemplate): LabelGuard {
  const own = anchorLabels(t);
  const labels = new Set([...own, ...GENEL_LABELS, ...tableLabels(t)].map(normalizeForMatch).filter(Boolean));
  const words = new Set(own.flatMap((l) => normalizeForMatch(l).split(" ")).filter(Boolean));
  return { labels, words };
}

/** Değer etiket mi: tam etiket · yalnız şablon etiket kelimeleri · rakamsız ve ":" ile biten ham metin (değersiz etiket). */
export function isLabelValue(value: string, raw: string | null, g: LabelGuard): boolean {
  const n = normalizeForMatch(value);
  if (!n) return false;
  if (g.labels.has(n)) return true;
  if (n.split(" ").every((w) => g.words.has(w))) return true;
  const r = (raw ?? "").trim();
  return r.endsWith(":") && !/\d/.test(r);
}

/** Etiket değeri reddedilir: değer boşalır, güven 0, `label-as-value` + gözden geçirme. */
export function rejectLabelValue(fr: FieldResult, g: LabelGuard): FieldResult {
  if (fr.value === null || !isLabelValue(fr.value, fr.raw, g)) return fr;
  return { ...fr, value: null, confidence: 0, needsReview: true, issues: [LABEL_AS_VALUE] };
}
