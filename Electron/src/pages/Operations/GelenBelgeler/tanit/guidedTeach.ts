// Rehberli tanıtma — saf çekirdek (belge tanıt 3 aşama, 2026-11-09; tablet T1 reducer'ı ile aynı kurallar): ① Tanıma (kimlik yazısı + ad)
// · ② Eşleme (satır seç → değere dokun; top tablosu sütunları) · ③ Kurallar (tekrar eden bölüm, çok parti, toplam satırı).
// Sunucu etiketi DEĞER kutusundan bulur → kullanıcı yalnız değere dokunur. Aşama kapısı `stages.ts`.
import { lowerTr } from "@/lib/tr-case";
import type { ScanMark } from "../ZoomableScan";
import { canReach, fieldWoLabel, firstOpenField, neighbourField, stageIndex, STAGES, type Stage, type StageContext } from "./stages";
import {
  addIdentifier, assignField, byReading, clearField, COLUMN_OPTIONS, identifierText, isKept, lineTexts, sectionStartText, setDropped, setRepeats, suggestIdentifiers, teachMarks, without,
  type ColumnKey, type FieldKey, type TeachState,
} from "./teachDraft";
import type { MultiPartyRule, ScanWord, ScanWords, SimilarTemplate, SuggestResult } from "./types";

export const fieldLabel = fieldWoLabel;

const norm = (t: string) => lowerTr(t).replace(/\s+/g, " ").trim();

/** Ad önerisi: belgenin başlığı (ilk kimlik önerisi). */
export function suggestName(scan: ScanWords): string {
  return suggestIdentifiers(scan, 1)[0] ?? "";
}

/** Başlık adımı: dokunulan kelimenin SATIRI (etiket kısmı, `identifierText`) kimlik yazısı olarak eklenir / kapatılır. */
export function toggleHeaderWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const line = lineTexts(words).find((l) => l.idx.includes(i));
  if (!line) return s;
  const text = identifierText(line.text);
  if (!text) return s;
  const hit = s.identifiers.find((d) => norm(d.text) === norm(text.slice(0, 60)));
  if (hit) return { ...s, identifiers: s.identifiers.map((d) => (d === hit ? { ...d, on: !d.on } : d)) };
  return addIdentifier(s, text);
}

/** Alan adımı: dokunulan kelime bu alanın değerine eklenir / çıkarılır (çok kelimeli değer olabilir). */
export function toggleFieldWord(s: TeachState, words: readonly ScanWord[], key: FieldKey, i: number): TeachState {
  const cur = s.fields[key] ?? [];
  if (cur.includes(i)) {
    const left = cur.filter((x) => x !== i);
    return left.length ? { ...s, fields: { ...s.fields, [key]: left } } : clearField(s, key);
  }
  return assignField({ ...s, selected: [...cur, i], drop: s.drop.filter((k) => k !== key) }, words, key);
}

/** ② Top tablosu sütun başlığına dokunuş: kelime o sütunun başlığına eklenir/çıkarılır (başka alandan/sütundan düşer). */
export function toggleColumnWord(s: TeachState, words: readonly ScanWord[], key: ColumnKey, i: number): TeachState {
  const cur = s.columns[key] ?? [];
  const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(byReading(words));
  const columns = without(s.columns, [i]);
  if (next.length) columns[key] = next;
  else delete columns[key];
  return { ...s, columns, fields: without(s.fields, [i]) };
}

/** ③ Toplam satırı yazısına dokunuş: kelime toplam etiketine eklenir/çıkarılır. */
export function toggleTotalsWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const cur = s.totalsLabel ?? [];
  const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(byReading(words));
  return { ...s, totalsLabel: next.length ? next : null };
}

/** ③ Bölüm başlangıcı: dokunulan kelimenin SATIRININ etiket kısmı (`sectionStartText`, değer her partide değişir; en çok 40 karakter); aynı satıra yeniden dokunmak kaldırır. */
export function toggleSectionStart(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const line = lineTexts(words).find((l) => l.idx.includes(i));
  if (!line) return s;
  const text = sectionStartText(line.text).slice(0, 40);
  return { ...setRepeats(s, true), sectionStart: norm(s.sectionStart) === norm(text) ? "" : text };
}

/** Belgeye dokunuşun gideceği yer: ② bir alan ya da sütun, ③ bölüm başı ya da toplam satırı; ① her zaman kimlik yazısı. */
export type Target = { kind: "field"; key: FieldKey } | { kind: "column"; key: ColumnKey } | { kind: "sectionStart" } | { kind: "totals" };

export interface GuidedState {
  stage: Stage;
  target: Target | null;
  /** "Bu belgede yok" denen alanlar. */
  skipped: FieldKey[];
  teach: TeachState;
}

export type GuidedRule = { rule: "repeats"; on: boolean } | { rule: "multiParty"; value: MultiPartyRule | null };

export type GuidedEvent =
  | { type: "TAP"; i: number }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SKIP" }
  | { type: "RELABEL" }
  | { type: "GOTO"; target: Target | null }
  | { type: "STAGE_NEXT" }
  | { type: "STAGE_BACK" }
  | { type: "STAGE_GOTO"; stage: Stage }
  | { type: "SET_RULE"; set: GuidedRule }
  | { type: "DROP_FIELD"; key: FieldKey; on: boolean };

export const guidedStart = (teach: TeachState): GuidedState => ({ stage: "TANIMA", target: null, skipped: [], teach });

const fieldOf = (t: Target | null): FieldKey | null => (t?.kind === "field" ? t.key : null);

function enter(g: GuidedState, stage: Stage): GuidedState {
  const target: Target | null = stage === "ESLEME" ? { kind: "field", key: firstOpenField(g.teach, g.skipped) } : null;
  return { ...g, stage, target };
}

function tap(g: GuidedState, words: readonly ScanWord[], i: number): GuidedState {
  const t = g.target;
  if (g.stage === "TANIMA") return { ...g, teach: toggleHeaderWord(g.teach, words, i) };
  if (g.stage === "ESLEME" && t?.kind === "field") return { ...g, skipped: g.skipped.filter((k) => k !== t.key), teach: toggleFieldWord(g.teach, words, t.key, i) };
  if (g.stage === "ESLEME" && t?.kind === "column") return { ...g, teach: toggleColumnWord(g.teach, words, t.key, i) };
  if (g.stage === "KURALLAR" && t?.kind === "sectionStart") return { ...g, teach: toggleSectionStart(g.teach, words, i) };
  if (g.stage === "KURALLAR" && t?.kind === "totals") return { ...g, teach: toggleTotalsWord(g.teach, words, i) };
  return g;
}

function moveField(g: GuidedState, dir: 1 | -1): GuidedState {
  const k = fieldOf(g.target);
  if (!k) return g;
  const n = neighbourField(k, dir);
  return { ...g, target: n ? { kind: "field", key: n } : null };
}

function setRule(g: GuidedState, set: GuidedRule): GuidedState {
  if (set.rule === "multiParty") return { ...g, teach: { ...g.teach, multiParty: set.value } };
  return { ...g, teach: setRepeats(g.teach, set.on), target: set.on ? { kind: "sectionStart" } : g.target?.kind === "sectionStart" ? null : g.target };
}

/** Reducer: TAP aşama/hedefe göre kelimeyi ekler/çıkarır; NEXT/BACK ② içinde sonraki/önceki alan; SKIP "Bu belgede yok" + ilerle;
 *  RELABEL alanı boşaltır; STAGE_* aşama kapısına (`canReach`) uyar; SET_RULE ③ kuralları; DROP_FIELD kayıtlı alanı kaldırır/geri alır. */
export function guidedReduce(g: GuidedState, ev: GuidedEvent, words: readonly ScanWord[], ctx: StageContext = {}): GuidedState {
  const key = fieldOf(g.target);
  const at = stageIndex(g.stage);
  switch (ev.type) {
    case "TAP": return tap(g, words, ev.i);
    case "NEXT": return moveField(g, 1);
    case "BACK": return moveField(g, -1);
    case "SKIP":
      if (!key) return g;
      return moveField({ ...g, skipped: g.skipped.includes(key) ? g.skipped : [...g.skipped, key], teach: clearField(g.teach, key) }, 1);
    case "RELABEL":
      return key ? { ...g, skipped: g.skipped.filter((k) => k !== key), teach: clearField(g.teach, key) } : g;
    case "GOTO": return { ...g, target: ev.target };
    case "STAGE_NEXT": {
      const next = STAGES[at + 1]?.key;
      return next && canReach(g.stage, next, g.teach, { words, ctx }) ? enter(g, next) : g;
    }
    case "STAGE_BACK": return at > 0 ? enter(g, STAGES[at - 1]!.key) : g;
    case "STAGE_GOTO": return ev.stage !== g.stage && canReach(g.stage, ev.stage, g.teach, { words, ctx }) ? enter(g, ev.stage) : g;
    case "SET_RULE": return setRule(g, ev.set);
    case "DROP_FIELD": return { ...g, teach: setDropped(g.teach, ev.key, ev.on) };
  }
}

const COLUMN_LABEL = Object.fromEntries(COLUMN_OPTIONS.map((c) => [c.key, c.label])) as Record<ColumnKey, string>;

function targetWords(s: TeachState, words: readonly ScanWord[], t: Target | null, located: Partial<Record<FieldKey, number[]>>): { idx: Set<number>; label: string } | null {
  if (!t) return null;
  if (t.kind === "field") return { idx: new Set(s.fields[t.key] ?? (isKept(s, t.key) ? located[t.key] : undefined) ?? []), label: fieldLabel(t.key) };
  if (t.kind === "column") return { idx: new Set(s.columns[t.key] ?? []), label: `Sütun: ${COLUMN_LABEL[t.key]}` };
  if (t.kind === "totals") return { idx: new Set(s.totalsLabel ?? []), label: "Toplam satırı" };
  const start = norm(s.sectionStart);
  // Etiket kısmı eşleşen satırın yalnız etiket kelimeleri boyanır; kısa etiket (tam metne düşen) bütün satırdır.
  const startIdx = (l: { idx: number[]; text: string }) => (sectionStartText(l.text) === l.text.trim() ? l.idx : l.idx.filter((k) => identifierText(words[k]!.text) !== ""));
  return { idx: new Set(start ? lineTexts(words).filter((l) => norm(sectionStartText(l.text).slice(0, 40)) === start).flatMap(startIdx) : []), label: "Bölüm başı" };
}

/** Fotoğraf kutuları: ① kimlik satırları "Başlık"; ②/③ seçili hedefin kelimeleri "seçili"; geri kalanı bütün işaretler. */
export function guidedMarks(s: TeachState, words: readonly ScanWord[], g: Pick<GuidedState, "stage" | "target">, located: Partial<Record<FieldKey, number[]>> = {}): ScanMark[] {
  const base = teachMarks({ ...s, selected: [] }, words, located);
  if (g.stage === "TANIMA") {
    const on = new Set(s.identifiers.filter((d) => d.on).map((d) => norm(d.text)));
    const idLines = new Set(lineTexts(words).filter((l) => on.has(norm(identifierText(l.text).slice(0, 60)))).flatMap((l) => l.idx).filter((i) => identifierText(words[i]!.text) !== ""));
    return base.map((m, i) => (idLines.has(i) && m.tone === "word" ? { ...m, tone: "column" as const, label: "Başlık" } : m));
  }
  const mine = targetWords(s, words, g.target, located);
  return mine ? base.map((m, i) => (mine.idx.has(i) ? { ...m, tone: "selected" as const, label: mine.label } : m)) : base;
}

export type Readout =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: string; label: string | null; kept?: boolean }
  | { kind: "empty" }
  | { kind: "error"; text: string };

/** Alanın önizleme sonucu: tazeyse "Okunan: …" ya da "okunamadı"; değilse "okunuyor". */
export function fieldReadout(s: TeachState, key: FieldKey, p: { result: SuggestResult | null; fresh: boolean; error: string | null }): Readout {
  // Kayıtlı (eski şablondan korunan) alan: okuma kuralı değişmez → son önizleme bayat olsa da değeri geçerlidir.
  if (isKept(s, key)) {
    const v = p.result?.preview?.fields[key];
    if (v != null && String(v).trim() !== "") return { kind: "ok", value: String(v), label: null, kept: true };
    return p.result?.preview ? { kind: "empty" } : p.error ? { kind: "error", text: p.error } : { kind: "loading" };
  }
  if (!s.fields[key]?.length) return { kind: "idle" };
  if (p.error && !p.fresh) return { kind: "error", text: p.error };
  if (!p.fresh || !p.result) return { kind: "loading" };
  if (p.result.errors.length) return { kind: "error", text: p.result.errors[0]! };
  const v = p.result.preview?.fields[key];
  if (v == null || String(v).trim() === "") return { kind: "empty" };
  const ex = p.result.explain.find((e) => e.field === key);
  return { kind: "ok", value: String(v), label: ex?.strategy === "anchor" ? ex.label : null };
}

export type ChipStatus = "done" | "skipped" | "todo";
export function chipStatus(s: TeachState, key: FieldKey, skipped: readonly FieldKey[]): ChipStatus {
  if (s.fields[key]?.length || isKept(s, key)) return "done";
  return skipped.includes(key) ? "skipped" : "todo";
}

/** Kayıt kararı (A3): `choice` yokken benzer şablon varsa SOR; "Aynı tip" → o kodu güncelle; "Yeni tip" ya da benzer yoksa
 *  güncelle kipinde mevcut kodu, değilse yeni tip. Güncellenen şablon benzer listesinde sayılmaz. */
export type SaveChoice = { same: string } | "new";
export type SaveDecision = { kind: "ask"; similar: SimilarTemplate[] } | { kind: "create" } | { kind: "update"; code: string };
export function saveDecision(result: Pick<SuggestResult, "benzerSablonlar">, existingCode: string | null, choice?: SaveChoice): SaveDecision {
  if (choice && choice !== "new") return { kind: "update", code: choice.same };
  const similar = (result.benzerSablonlar ?? []).filter((b) => b.kod !== existingCode);
  if (!choice && similar.length > 0) return { kind: "ask", similar };
  return existingCode ? { kind: "update", code: existingCode } : { kind: "create" };
}
