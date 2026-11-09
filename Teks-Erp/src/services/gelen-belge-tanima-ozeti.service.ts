// =============================================================================
// GELEN BELGE — TANIMA ÖZETİ (`tanima`, belge tanıt 3 aşama, 2026-11-09; salt okunur)
// =============================================================================
// Okuma özeti ve belge detayı AYNI bloğu döner; istemci türetmez: ① hangi tiple tanındı (okunduğu SÜRÜM), ② belge alanı →
// İE karşılığı (`alan-hedef.ts` tek kaynak; metre hücresinden okunan kg `guardKgFields` ile düşer), ③ uygulanan kurallar
// (çok parti kipi `resolveMultiPartyMode`, tekrar eden bölüm, toplam satırı, gelen metre kaynağı) Türkçe metinleriyle.
// =============================================================================
import { DeliveryNoteLineStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { TABLE_TOTAL_SOURCE, type DocumentTemplate } from "../lib/gelen-belge/motor";
import { FIELD_GROUP_ORDER, FIELD_TARGETS, displayFieldLabel, fieldTargetOf, type FieldGroup } from "../lib/gelen-belge/alan-hedef";
import { guardKgFields } from "../lib/gelen-belge/kg-koruma";
import { partyBlockNos } from "../lib/gelen-belge/parti-ozet";
import { isSummaryLine } from "./gelen-belge-kontrol.service";
import { readFirstRegion, type TrustMode } from "./gelen-belge-parti-metre.service";
import { noteIntroState, type IntroState } from "./gelen-belge-tanitim-guveni.service";
import { noteTemplateSnapshot, resolveMultiPartyMode, type NoteTemplateSnapshot } from "./gelen-belge-parti-kipi.service";
import type { MultiPartyWorkOrderMode } from "./system-setting.service";

export type TanimaRuleSource = "TEMPLATE" | "FACTORY" | "MANUAL";

export interface TanimaMappingRow {
  field: string;
  label: string;
  value: string | null;
  woTarget: string;
  woLabel: string;
  group: FieldGroup;
}

export interface TanimaRule {
  key: "multiParty" | "sections" | "totalsRow" | "meterSource";
  value: string;
  source: TanimaRuleSource;
  text: string;
  /** "şablon kuralı" · "fabrika ayarı" · "elle" — ekranda parantez içi. */
  sourceText: string;
}

export interface Tanima {
  template: { code: string; name: string; version: number; score: number | null } | null;
  durum: "TANITILDI" | "SISTEM" | "TANITILMAMIS";
  mapping: TanimaMappingRow[];
  rules: TanimaRule[];
}

const SOURCE_TEXT: Record<TanimaRuleSource, string> = { TEMPLATE: "şablon kuralı", FACTORY: "fabrika ayarı", MANUAL: "elle" };
const rule = (key: TanimaRule["key"], value: string, source: TanimaRuleSource, text: string): TanimaRule => ({ key, value, source, text, sourceText: SOURCE_TEXT[source] });

/** Saf: kip + parti sayısı → metin ("3 parti → 3 iş emri"; tek partide kuralın kendisi). */
export function multiPartyText(mode: MultiPartyWorkOrderMode, partyCount: number): string {
  if (partyCount > 1) return `${partyCount} parti → ${mode === "PER_PARTY" ? partyCount : 1} iş emri`;
  return `Birden çok parti gelirse: ${mode === "PER_PARTY" ? "her parti ayrı iş emri" : "tek iş emri"}`;
}

/** Saf: gelen metre kaynağı metni (okuma anında yazılan `kursunMetersSource` + şablonun metre kaynakları). */
export function meterSourceText(source: string | null, template: Pick<DocumentTemplate, "meterSources"> | null): string | null {
  if (source === "OUTPUT") return template?.meterSources?.output?.includes(TABLE_TOTAL_SOURCE) ? "Gelen metre: toplam satırından" : "Gelen metre: çıkış metresinden";
  if (source === "TOTAL") return "Gelen metre: belgedeki toplam metreden";
  if (source === "LINE_SUM") return "Gelen metre: satır toplamından";
  if (source === "MANUAL") return "Gelen metre: elle girildi";
  return null;
}

export interface TanimaInput {
  state: Exclude<IntroState, null>;
  snapshot: NoteTemplateSnapshot | null;
  fields: Readonly<Record<string, string | null>>;
  mode: { mode: MultiPartyWorkOrderMode; source: "TEMPLATE" | "FACTORY" };
  partyCount: number;
  meterSource: string | null;
}

/** Saf kurucu (bekçi doğrudan sınar). Tanınmamış belgede eşleme boştur; şablon bilgisi yalnız TANITILDI/SISTEM'de. */
export function buildTanima(i: TanimaInput): Tanima {
  const known = i.state.durum !== "TANITILMAMIS" && i.snapshot !== null;
  const t = known ? i.snapshot!.template : null;
  const order = Object.keys(FIELD_TARGETS);
  const mapping: TanimaMappingRow[] = (t?.fields ?? [])
    .flatMap((f) => {
      const target = fieldTargetOf(f.key);
      if (!target) return [];
      const v = i.fields[f.key];
      return [{ field: f.key, label: displayFieldLabel(f.key, f.label), value: typeof v === "string" && v.trim() ? v.trim() : null, woTarget: target.woTarget, woLabel: target.woLabel, group: target.group }];
    })
    .sort((a, b) => FIELD_GROUP_ORDER.indexOf(a.group) - FIELD_GROUP_ORDER.indexOf(b.group) || order.indexOf(a.field) - order.indexOf(b.field));
  const rules: TanimaRule[] = [rule("multiParty", i.mode.mode, i.mode.source, multiPartyText(i.mode.mode, i.partyCount))];
  const start = t?.sections?.startLabels?.[0];
  if (start) rules.push(rule("sections", start, "TEMPLATE", `Tekrar eden bölüm: ${start}`));
  const totals = t?.tables?.find((x) => x.totals?.labels?.length)?.totals?.labels[0];
  if (totals) rules.push(rule("totalsRow", totals, "TEMPLATE", `Toplam satırı: ${totals}`));
  const meter = meterSourceText(i.meterSource, t);
  if (meter && i.meterSource) rules.push(rule("meterSource", i.meterSource, i.meterSource === "MANUAL" ? "MANUAL" : "TEMPLATE", meter));
  return {
    template: known ? { code: i.snapshot!.code, name: i.snapshot!.name, version: i.snapshot!.version, score: i.snapshot!.score } : null,
    durum: i.state.durum,
    mapping,
    rules,
  };
}

/** Notun tanıma özeti; okunmuş sayfa yoksa undefined (alan yanıta konmaz). BLIND güven kipinde eşleme değeri gösterilmez. */
export async function noteTanima(noteId: string, trust: TrustMode = "NORMAL"): Promise<Tanima | undefined> {
  const state = await noteIntroState(noteId);
  if (!state) return undefined;
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, totalsDeclared: true, kursunMetersSource: true, lines: { where: { status: { not: DeliveryNoteLineStatus.SKIPPED } }, select: { id: true, blockNo: true } } },
  });
  if (!note) return undefined;
  const snapshot = await noteTemplateSnapshot(noteId);
  const region = trust === "BLIND" ? null : await readFirstRegion(prisma, noteId);
  const docLines = note.lines.filter((l) => !isSummaryLine(note.id, l));
  return buildTanima({
    state, snapshot,
    fields: guardKgFields(region).fields,
    mode: await resolveMultiPartyMode(noteId),
    partyCount: partyBlockNos(docLines, note.totalsDeclared).length,
    meterSource: note.kursunMetersSource,
  });
}
