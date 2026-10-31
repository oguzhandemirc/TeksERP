// =============================================================================
// LEVENT ÖN DOLGUSU — ÇÖZGÜ KATMANI BAŞINA ÖNERİ (saf; Seyitoğlu SY-B2, tasarım §3.5 md. 2)
// =============================================================================
// İşin ürününde ek çözgü katmanı VARSA levent formu her çözgü için öneri gösterir: zemin ve
// SEPARATE_BEAM katmanı kendi leventini ister; SHARED_BEAM zemin leventine sarılır, CREEL cağlıktan
// beslenir (ikisinde levent önerilmez, gerekçe yazılır). Katmansız üründe liste BOŞ (bugünkü form).
// =============================================================================
import type { EffectiveConstruction } from "@/pages/Items/construction-service";

export type BeamLayerSuggestionKind = "BEAM" | "SHARED" | "CREEL";
export interface BeamLayerSuggestion {
  warpSpecId: string;
  code: string;
  name: string;
  /** "Zemin çözgü" · "Döner çözgü" · "Ek çözgü" */
  role: string;
  kind: BeamLayerSuggestionKind;
  /** Levent önerilmeyen katmanda gerekçe. */
  note: string | null;
}

const ROLE_LABEL: Record<string, string> = { LENO: "Döner çözgü", SECONDARY: "Ek çözgü" };
const KIND_OF: Record<string, BeamLayerSuggestionKind> = { SEPARATE_BEAM: "BEAM", SHARED_BEAM: "SHARED", CREEL: "CREEL" };
const NOTE: Record<BeamLayerSuggestionKind, string | null> = {
  BEAM: null,
  SHARED: "zemin leventine sarılır — ayrı levent yok",
  CREEL: "cağlıktan beslenir — levent yok",
};

export function beamSuggestionsForConstruction(c: Pick<EffectiveConstruction, "groundWarp" | "warpLayers"> | null | undefined): BeamLayerSuggestion[] {
  if (!c || c.warpLayers.length === 0) return [];
  const out: BeamLayerSuggestion[] = [];
  if (c.groundWarp) out.push({ warpSpecId: c.groundWarp.id, code: c.groundWarp.code, name: c.groundWarp.name, role: "Zemin çözgü", kind: "BEAM", note: null });
  for (const l of [...c.warpLayers].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Bilinmeyen kip levent İSTEMEZ sayılmaz — ayrı levent (sunucu varsayılanı SEPARATE_BEAM).
    const kind = KIND_OF[l.beamMode] ?? "BEAM";
    out.push({ warpSpecId: l.warpSpec.id, code: l.warpSpec.code, name: l.warpSpec.name, role: ROLE_LABEL[l.role] ?? l.role, kind, note: NOTE[kind] });
  }
  return out;
}

/** Kaç levent önerilir (zemin + ayrı levent katmanları). */
export const beamCountSuggested = (s: readonly BeamLayerSuggestion[]): number => s.filter((x) => x.kind === "BEAM").length;
