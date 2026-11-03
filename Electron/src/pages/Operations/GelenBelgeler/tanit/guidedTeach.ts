// Rehberli (adım adım) tanıtma — saf çekirdek (K30-T A2/A3; tablet `mobil/.../tanit/guided.ts` aynası + panel reducer'ı).
// Adım 0 başlık (kimlik yazısı), sonra alanlar sırayla, son adım ad + kaydet. Sunucu etiketi DEĞER kutusundan bulur → kullanıcı yalnız değere dokunur.
import { lowerTr } from "@/lib/tr-case";
import type { ScanMark } from "../ZoomableScan";
import { addIdentifier, assignField, clearField, FIELD_OPTIONS, lineTexts, suggestIdentifiers, teachMarks, type FieldKey, type TeachState } from "./teachDraft";
import type { ScanWord, ScanWords, SimilarTemplate, SuggestResult } from "./types";

/** İlk sürümün alan sırası (K30-T A2; anahtarlar backend ASSIGNABLE_FIELDS). */
export const GUIDED_FIELDS: readonly FieldKey[] = ["musteri", "partiNo", "hedefMetraj", "toplamMetre", "en", "desen", "renk"];

const GUIDED_LABEL: Partial<Record<FieldKey, string>> = { partiNo: "Parti no", desen: "Desen", renk: "Renk", en: "En" };
export const fieldLabel = (k: FieldKey): string => GUIDED_LABEL[k] ?? FIELD_OPTIONS.find((f) => f.key === k)?.label ?? k;

/** Adımlar: 0 = başlık, 1..n = alanlar, n+1 = bitir. */
export const FINISH_STEP = GUIDED_FIELDS.length + 1;
export const stepField = (step: number): FieldKey | null => (step >= 1 && step <= GUIDED_FIELDS.length ? GUIDED_FIELDS[step - 1]! : null);

const norm = (t: string) => lowerTr(t).replace(/\s+/g, " ").trim();
const clean = (t: string) => t.replace(/[:.\s]+$/u, "").trim();

/** Ad önerisi: belgenin başlığı (ilk kimlik önerisi). */
export function suggestName(scan: ScanWords): string {
  return suggestIdentifiers(scan, 1)[0] ?? "";
}

/** Başlık adımı: dokunulan kelimenin SATIRI kimlik yazısı olarak eklenir / kapatılır. */
export function toggleHeaderWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const line = lineTexts(words).find((l) => l.idx.includes(i));
  if (!line) return s;
  const text = clean(line.text);
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
  return assignField({ ...s, selected: [...cur, i] }, words, key);
}

export interface GuidedState {
  step: number;
  /** "Bu belgede yok" denen alanlar. */
  skipped: FieldKey[];
  teach: TeachState;
}

export type GuidedEvent =
  | { type: "TAP"; i: number }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SKIP" }
  | { type: "RELABEL" }
  | { type: "GOTO"; step: number };

export const guidedStart = (teach: TeachState): GuidedState => ({ step: 0, skipped: [], teach });

const firstOnIdentifier = (s: TeachState) => s.identifiers.find((d) => d.on)?.text ?? "";

/** Rehber reducer'ı: TAP alanın kelimesini ekler/çıkarır (başlıkta satırı), NEXT ilerler (başlıktan çıkarken ad boşsa başlık),
 *  SKIP "Bu belgede yok" (alan boşaltılır), RELABEL alanı boşaltıp aynı adımda yeniden dokunmayı bekler. */
export function guidedReduce(g: GuidedState, ev: GuidedEvent, words: readonly ScanWord[]): GuidedState {
  const key = stepField(g.step);
  switch (ev.type) {
    case "TAP": {
      if (g.step === 0) return { ...g, teach: toggleHeaderWord(g.teach, words, ev.i) };
      if (!key) return g;
      return { ...g, skipped: g.skipped.filter((k) => k !== key), teach: toggleFieldWord(g.teach, words, key, ev.i) };
    }
    case "NEXT": {
      if (g.step >= FINISH_STEP) return g;
      const teach = g.step === 0 && g.teach.name.trim().length < 2 ? { ...g.teach, name: firstOnIdentifier(g.teach).slice(0, 80) } : g.teach;
      return { ...g, teach, step: g.step + 1 };
    }
    case "BACK":
      return g.step > 0 ? { ...g, step: g.step - 1 } : g;
    case "SKIP": {
      if (!key) return g;
      return { step: g.step + 1, skipped: g.skipped.includes(key) ? g.skipped : [...g.skipped, key], teach: clearField(g.teach, key) };
    }
    case "RELABEL": {
      if (!key) return g;
      return { ...g, skipped: g.skipped.filter((k) => k !== key), teach: clearField(g.teach, key) };
    }
    case "GOTO":
      return { ...g, step: Math.max(0, Math.min(FINISH_STEP, ev.step)) };
  }
}

/** Fotoğraf kutuları: başlık adımında kimlik satırları, alan adımında o alanın değeri "seçili" görünür. */
export function guidedMarks(s: TeachState, words: readonly ScanWord[], step: number): ScanMark[] {
  const base = teachMarks({ ...s, selected: [] }, words);
  const key = stepField(step);
  if (key) {
    const mine = new Set(s.fields[key] ?? []);
    return base.map((m, i) => (mine.has(i) ? { ...m, tone: "selected" as const, label: fieldLabel(key) } : m));
  }
  if (step !== 0) return base;
  const on = new Set(s.identifiers.filter((d) => d.on).map((d) => norm(d.text)));
  const idLines = new Set(lineTexts(words).filter((l) => on.has(norm(clean(l.text).slice(0, 60)))).flatMap((l) => l.idx));
  return base.map((m, i) => (idLines.has(i) && m.tone === "word" ? { ...m, tone: "column" as const, label: "Başlık" } : m));
}

export type Readout =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: string; label: string | null }
  | { kind: "empty" }
  | { kind: "error"; text: string };

/** Alanın önizleme sonucu: tazeyse "Okunan: …" ya da "okunamadı"; değilse "okunuyor". */
export function fieldReadout(s: TeachState, key: FieldKey, p: { result: SuggestResult | null; fresh: boolean; error: string | null }): Readout {
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
  if (s.fields[key]?.length) return "done";
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
