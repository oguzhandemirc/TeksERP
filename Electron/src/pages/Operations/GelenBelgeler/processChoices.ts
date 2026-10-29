// Gramaj önerisi (H9) saf parçaları: hangi işlem metni grupları gösterilir, seçimler onay gövdesine nasıl çevrilir.
import { useState } from "react";
import type { DeliveryNoteHeader, DeliveryNoteLine, NoteMatchSuggestions, ProcessChoice, ProcessSuggestion } from "./types";

export interface ProcessGroup {
  /** "header" ya da metni taşıyan ilk satırın kimliği — seçim anahtarı. */
  key: string;
  /** Onay gövdesindeki `lineId` (başlık için null): sunucu metni kendisi okur. */
  lineId: string | null;
  rawText: string;
  suggestion: ProcessSuggestion | null;
  lineCount: number;
}

type GroupNote = Pick<DeliveryNoteHeader, "processText"> & { lines: ReadonlyArray<Pick<DeliveryNoteLine, "id" | "processText" | "rollId" | "status">> };

const isOpen = (l: Pick<DeliveryNoteLine, "rollId" | "status">) => !l.rollId && l.status !== "SKIPPED";

/**
 * Başlık metni bir grup (kendi metni olmayan satırlar ona sayılır), satır metinleri metne göre birer grup.
 * Yalnız topsuz açık satırlar sayılır; metni olmayan belge boş liste döner.
 */
export function buildProcessGroups(note: GroupNote, suggestions: NoteMatchSuggestions | undefined): ProcessGroup[] {
  const header = note.processText?.trim() ?? "";
  const open = note.lines.filter(isOpen);
  const out: ProcessGroup[] = [];
  const inheriting = open.filter((l) => !l.processText?.trim() || l.processText.trim() === header).length;
  if (header) out.push({ key: "header", lineId: null, rawText: header, suggestion: suggestions?.process ?? null, lineCount: inheriting });
  const byText = new Map<string, ProcessGroup>();
  for (const l of open) {
    const t = l.processText?.trim() ?? "";
    if (!t || t === header) continue;
    const g = byText.get(t);
    if (g) {
      g.lineCount++;
      continue;
    }
    const s = suggestions?.lines.find((x) => x.lineId === l.id)?.process ?? null;
    const ng: ProcessGroup = { key: l.id, lineId: l.id, rawText: t, suggestion: s, lineCount: 1 };
    byText.set(t, ng);
    out.push(ng);
  }
  return out;
}

/** Operatörün seçtiği (kabul ya da düzeltme) gruplar → onay gövdesi; seçilmeyen grup gönderilmez (sözlük öğrenmez). */
export function toProcessChoices(groups: readonly ProcessGroup[], picks: Readonly<Record<string, string | null>>): ProcessChoice[] {
  const out: ProcessChoice[] = [];
  for (const g of groups) {
    const v = picks[g.key];
    if (v) out.push({ lineId: g.lineId, valueId: v });
  }
  return out;
}

/**
 * Detay sayfası durumu: seçim yalnız onaya gider (PROCESS sözlüğü) → `enabled` onay yetkisi + onaylanabilir durumdur.
 * Not: hook koşulsuz çağrılır (React kuralı); kapalıyken grup üretmez.
 */
export function useProcessGramaj(note: GroupNote | undefined, suggestions: NoteMatchSuggestions | undefined, enabled: boolean) {
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const groups = enabled && note ? buildProcessGroups(note, suggestions) : [];
  const onPick = (key: string, valueId: string | null) => setPicks((p) => ({ ...p, [key]: valueId }));
  return { groups, picks, onPick, choices: toProcessChoices(groups, picks) };
}
