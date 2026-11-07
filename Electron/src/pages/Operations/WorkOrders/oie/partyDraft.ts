// Çok partili belge (S1): sunucunun parti özeti (`GET /irsaliyeler/:id/partiler`) → formdaki düzenlenebilir parti satırları,
// kayıt kapısı ve gövde parçası. Kural sunucudadır (uyarılar oradan gelir); burası yalnız satırı ve seçimi taşır.
export type MultiPartyMode = "SINGLE" | "PER_PARTY";

export interface NoteParty {
  blockNo: number;
  batchNo: string | null;
  orderNo: string | null;
  declaredTopCount: number | null;
  declaredMeters: number | null;
  lineCount: number;
  meters: number;
  /** Sunucunun önerdiği parti metresi (beyan ara toplamı > Σ satır; 2026-11-06, eski sunucu göndermez → `meters`). */
  suggestedMeters?: number | null;
  weightKg: number | null;
  warnings: string[];
}

export interface NotePartiesView {
  parties: NoteParty[];
  warnings: string[];
  multi: boolean;
  defaultMode: MultiPartyMode;
}

export interface PartyRow {
  blockNo: number;
  batchNo: string;
  meters: number | null;
}

export interface MultiPartyDraft {
  rows: PartyRow[];
  mode: MultiPartyMode;
}

/** Forma ilk metre: sunucunun önerisi (beyan ara toplamı önce), eski sunucuda Σ satır; seçim kuralı istemcide kurulmaz. */
const partyMeters = (p: NoteParty): number | null => {
  const m = p.suggestedMeters ?? p.meters;
  return m > 0 ? m : null;
};

/** Çok parti (≥2) ise satırlar + fabrika varsayılan kipi; tek/bölümsüz belgede null (bugünkü form). */
export function initialMultiParty(view: NotePartiesView | null | undefined): MultiPartyDraft | null {
  if (!view?.multi || view.parties.length < 2) return null;
  return {
    rows: view.parties.map((p) => ({ blockNo: p.blockNo, batchNo: p.batchNo ?? "", meters: partyMeters(p) })),
    mode: view.defaultMode === "PER_PARTY" ? "PER_PARTY" : "SINGLE",
  };
}

export function multiPartyReasons(m: MultiPartyDraft): string[] {
  const missing = m.rows.filter((r) => r.meters === null || !(r.meters > 0)).map((r) => r.blockNo);
  return missing.length ? [`Parti metresi eksik: ${missing.map((b) => `${b}. parti`).join(", ")}.`] : [];
}

export const multiPartyTotal = (m: MultiPartyDraft): number => Math.round(m.rows.reduce((s, r) => s + (r.meters ?? 0), 0) * 1000) / 1000;

/** Gövde parçası: `parties[]` + `mode` (sunucu ≥2 parti ister). */
export function multiPartyBody(m: MultiPartyDraft): { parties: Array<{ blockNo: number; batchNo: string | null; meters: number }>; mode: MultiPartyMode } {
  return { parties: m.rows.map((r) => ({ blockNo: r.blockNo, batchNo: r.batchNo.trim() || null, meters: r.meters ?? 0 })), mode: m.mode };
}
