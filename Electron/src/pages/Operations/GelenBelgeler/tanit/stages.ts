// Tanıtmanın üç aşaması (belge tanıt 3 aşama, 2026-11-09; tablet T1 `stages.ts` ile aynı kurallar): ① Tanıma · ② Eşleme · ③ Kurallar.
// Saf: aşama kapısı (ileri gitmek o aşamanın sorunu yoksa serbest, geri hep serbest), Eşleme satır düzeni (fieldTargets), özet metinleri.
import { compareFieldKeys, fieldTargetOf } from "./fieldTargets";
import { FIELD_OPTIONS, identityProblems, isKept, mappingProblems, ruleProblems, type FieldKey, type TeachState } from "./teachDraft";
import type { ScanWord, SuggestResult } from "./types";

export type Stage = "TANIMA" | "ESLEME" | "KURALLAR";
export const STAGES: ReadonlyArray<{ key: Stage; no: string; label: string }> = [
  { key: "TANIMA", no: "1", label: "Tanıma" },
  { key: "ESLEME", no: "2", label: "Eşleme" },
  { key: "KURALLAR", no: "3", label: "Kurallar" },
];
export const stageIndex = (s: Stage): number => STAGES.findIndex((x) => x.key === s);

/** Sunucu `meterKgClashErrors` mesajının başı: metre ve kg alanı aynı kutudan okunuyor → ② Eşleme'de İleri kapanır. */
export const METER_KG_CLASH_PREFIX = "Aynı kutu hem";

export interface StageContext {
  /** Taze önizlemenin hataları (bayat önizlemenin hatası kapı değildir). */
  serverErrors?: readonly string[];
}

/** Aşamanın engelleyici sorunları (Türkçe); boş = İleri açık. */
export function stageProblems(stage: Stage, s: TeachState, words?: readonly ScanWord[], ctx: StageContext = {}): string[] {
  if (stage === "TANIMA") return identityProblems(s);
  if (stage === "ESLEME") return [...mappingProblems(s, words), ...(ctx.serverErrors ?? []).filter((e) => e.startsWith(METER_KG_CLASH_PREFIX))];
  return ruleProblems(s);
}

/** Hedef aşamaya gidilebilir mi: geri hep; ileri ise aradaki her aşama sorunsuzsa. */
export function canReach(from: Stage, to: Stage, s: TeachState, env: { words?: readonly ScanWord[]; ctx?: StageContext } = {}): boolean {
  const a = stageIndex(from);
  const b = stageIndex(to);
  if (b <= a) return true;
  return STAGES.slice(a, b).every((x) => stageProblems(x.key, s, env.words, env.ctx).length === 0);
}

const ORDERED: FieldKey[] = FIELD_OPTIONS.map((f) => f.key as FieldKey).sort(compareFieldKeys);
/** ② Eşleme: varsayılan görünür alanlar (grup sırasıyla) ve "Diğer alanlar" açılırındakiler. */
export const MAIN_FIELDS: readonly FieldKey[] = ORDERED.filter((k) => fieldTargetOf(k)?.defaultVisible);
export const OTHER_FIELDS: readonly FieldKey[] = ORDERED.filter((k) => !fieldTargetOf(k)?.defaultVisible);

/** Alanın İE karşılığı (Eşleme satır adı). */
export const fieldWoLabel = (k: FieldKey): string => fieldTargetOf(k)?.woLabel ?? FIELD_OPTIONS.find((f) => f.key === k)?.label ?? k;

const hasField = (s: TeachState, k: FieldKey) => Boolean(s.fields[k]?.length) || isKept(s, k);

/** Eşleme'ye girince seçili satır: işaretlenmemiş ilk görünür alan (hepsi doluysa ilki). */
export function firstOpenField(s: TeachState, skipped: readonly FieldKey[]): FieldKey {
  return MAIN_FIELDS.find((k) => !hasField(s, k) && !skipped.includes(k)) ?? MAIN_FIELDS[0]!;
}

/** Görünür sırada sonraki/önceki alan; uçta null. "Diğer alanlar"daki bir alandan ilerlemek kendi listesinde kalır. */
export function neighbourField(k: FieldKey, dir: 1 | -1): FieldKey | null {
  const list = MAIN_FIELDS.includes(k) ? MAIN_FIELDS : OTHER_FIELDS;
  return list[list.indexOf(k) + dir] ?? null;
}

/** ③ sayılan kurallar: tekrar eden bölüm, toplam satırı, çok parti kuralı. */
export function ruleCount(s: TeachState): number {
  return (s.repeats ? 1 : 0) + (s.totalsLabel?.length && Object.keys(s.columns).length ? 1 : 0) + (s.multiParty ? 1 : 0);
}

/** Kaydet çubuğu özeti: "3 kimlik yazısı · 7 alan · 2 kural". */
export function teachSummary(s: TeachState): string {
  const ids = s.identifiers.filter((d) => d.on).length;
  const fields = FIELD_OPTIONS.filter((f) => hasField(s, f.key)).length;
  return `${ids} kimlik yazısı · ${fields} alan · ${ruleCount(s)} kural`;
}

/** ① canlı güven satırı: taze önizlemenin skoru; önizleme yoksa ne zaman ölçüleceği. */
export function confidenceText(result: SuggestResult | null, fresh: boolean): string {
  const p = result?.preview;
  if (!p || !fresh) return "Güven, ilk alan işaretlenince ölçülür.";
  const pct = Math.round((p.score <= 1 ? p.score * 100 : p.score));
  return p.matched ? `Bu yazılarla tanınıyor: %${pct}` : `Bu yazılarla tanınmıyor (%${pct}) — başka bir kimlik yazısı ekleyin.`;
}

/** ③ gelen metre kaynağı (salt bilgi): sunucunun önerdiği `meterSources`. Değiştirmek için ② Eşleme. */
export function meterSourceText(result: SuggestResult | null): string {
  const src = result?.template?.meterSources as { output?: string[]; total?: string[] } | undefined;
  if (src?.output?.includes("$tableTotal")) return "Toplam satırından (top tablosunun toplamı)";
  if (src?.total?.includes("toplamMetre")) {
    const v = result?.preview?.fields.toplamMetre;
    return `"Gelen metre" alanından${v ? ` (${v} m)` : ""}`;
  }
  return result ? "Belgede gelen metre yok — top satırlarının metresi toplanır." : "Önizleme gelince görünür.";
}

/** ③ tekrar eden bölüm önizlemesi: "‘PARTİ NO’ ile başlıyor · 3 bölüm bulundu". */
export function sectionText(s: TeachState, result: SuggestResult | null, fresh: boolean): string | null {
  if (!s.repeats || !s.sectionStart.trim()) return null;
  const n = fresh ? result?.preview?.blocks?.length : undefined;
  return `‘${s.sectionStart.trim()}’ ile başlıyor${n != null ? ` · ${n} bölüm bulundu` : ""}`;
}
