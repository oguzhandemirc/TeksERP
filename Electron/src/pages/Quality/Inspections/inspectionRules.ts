// Muayene ekranının saf kuralları: süzgeç → sorgu parametresi, hata tablosu → gövde, etiketler.
// Puan/derece HESABI burada YOK — tek kaynak backend motoru (önizleme ucu).
import axios from "axios";
import type { DefectInput, DefectSizeClass, InspectionDetail, InspectionListParams, InspectionPhase, WidthSource } from "./service";

export interface InspectionFilterState {
  q: string; from: string; to: string;
  itemId: string; itemLabel: string;
  gradeId: string; stationId: string;
  inspectedById: string; inspectedByLabel: string;
  rollId: string; rollLabel: string; batchId: string; batchLabel: string;
  phase: "" | InspectionPhase; minScore: string; maxScore: string;
  widthUnknown: boolean; mismatch: boolean; includeHistory: boolean;
}
export const EMPTY_INSPECTION_FILTERS: InspectionFilterState = {
  q: "", from: "", to: "", itemId: "", itemLabel: "", gradeId: "", stationId: "", inspectedById: "", inspectedByLabel: "",
  rollId: "", rollLabel: "", batchId: "", batchLabel: "", phase: "", minScore: "", maxScore: "",
  widthUnknown: false, mismatch: false, includeHistory: false,
};

/** Virgüllü ondalığı noktaya çevirir; boş → null; biçimsiz → undefined (gönderilmez, form uyarır). */
export function decimalInput(raw: string): string | null | undefined {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? t : undefined;
}

/** Süzgeç durumu → sunucu parametresi. İstemci satır SÜZMEZ; her süzgeç buradan sorguya gider. */
export function toListParams(f: InspectionFilterState): InspectionListParams {
  return {
    q: f.q.trim(), from: f.from, to: f.to, itemId: f.itemId, gradeId: f.gradeId, stationId: f.stationId,
    inspectedById: f.inspectedById, rollId: f.rollId, batchId: f.batchId, phase: f.phase,
    minScore: decimalInput(f.minScore) ?? "", maxScore: decimalInput(f.maxScore) ?? "",
    widthUnknown: f.widthUnknown ? "1" : "", mismatch: f.mismatch ? "1" : "", includeHistory: f.includeHistory ? "1" : "",
  };
}

export function isInspectionFilterDirty(f: InspectionFilterState): boolean {
  return (Object.keys(EMPTY_INSPECTION_FILTERS) as Array<keyof InspectionFilterState>).some((k) => f[k] !== EMPTY_INSPECTION_FILTERS[k]);
}

/** URL'den gelen bağlam (top/parti kartı, bildirim derin bağlantısı). */
export function filtersFromSearch(sp: URLSearchParams): InspectionFilterState {
  return {
    ...EMPTY_INSPECTION_FILTERS,
    rollId: sp.get("rollId") ?? "", rollLabel: sp.get("rollLabel") ?? "",
    batchId: sp.get("batchId") ?? "", batchLabel: sp.get("batchLabel") ?? "",
  };
}

export const PHASE_LABEL: Record<InspectionPhase, string> = { RAW: "Ham", FINAL: "Mamul" };
export const SIZE_LABEL: Record<DefectSizeClass, string> = { UP_TO_3IN: "≤ 7,5 cm", IN_3_TO_6: "7,5–15 cm", IN_6_TO_9: "15–23 cm", OVER_9IN: "> 23 cm" };
export const SIZE_POINTS: Record<DefectSizeClass, number> = { UP_TO_3IN: 1, IN_3_TO_6: 2, IN_6_TO_9: 3, OVER_9IN: 4 };
export const SIZE_ORDER: DefectSizeClass[] = ["UP_TO_3IN", "IN_3_TO_6", "IN_6_TO_9", "OVER_9IN"];
export const WIDTH_SOURCE_LABEL: Record<WidthSource, string> = {
  MANUAL: "Elle girildi", ITEM_CARD: "Ürün kartı", ROLL_MEASURED: "Topta ölçülen", UNKNOWN: "En bilinmiyor",
};

/** Sayısal alanın görüntüsü; null/boş → "—" (konumsuz hata, bilinmeyen en). */
export function numText(v: string | number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { maximumFractionDigits: digits }) : "—";
}

export function inspectionState(r: { supersededAt: string | null; voidedAt: string | null }): "ACTIVE" | "REVISED" | "VOIDED" {
  return r.voidedAt ? "VOIDED" : r.supersededAt ? "REVISED" : "ACTIVE";
}
export const STATE_LABEL = { ACTIVE: "Aktif", REVISED: "Düzeltildi", VOIDED: "İptal" } as const;

// ── Hata tablosu (düzelt + kâğıttan giriş ortak) ──
export interface DefectRow { key: string; defectTypeId: string; sizeClass: DefectSizeClass | null; startMeter: string }
let seq = 0;
export const newDefectRow = (): DefectRow => ({ key: `d${++seq}`, defectTypeId: "", sizeClass: "UP_TO_3IN", startMeter: "" });
export function defectRowsFromDetail(d: Pick<InspectionDetail, "rollErrors">): DefectRow[] {
  return d.rollErrors.map((e) => ({ key: `d${++seq}`, defectTypeId: e.defectTypeId ?? "", sizeClass: e.sizeClass, startMeter: e.startMeter == null ? "" : String(e.startMeter) }));
}

/** Satır sorunu (Türkçe) ya da null. Konumsuz hata geçerlidir: boş metre `null` gider, 0 DEĞİL. */
export function defectRowProblem(r: DefectRow): string | null {
  if (!r.defectTypeId) return "Hata türü seçilmedi";
  if (decimalInput(r.startMeter) === undefined) return "Metre sayı olmalı";
  return null;
}
export function defectsPayload(rows: DefectRow[]): DefectInput[] {
  return rows.map((r) => ({ defectTypeId: r.defectTypeId, sizeClass: r.sizeClass, startMeter: decimalInput(r.startMeter) ?? null }));
}

export const REASON_MIN = 3;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;

/** Sunucu hata kodu `details.code`'dadır (body.code okunmaz). */
export function errorCodeOf(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof code === "string" ? code : null;
}
/** Topun kalite alanı boşken gösterilen metin (kod yuvasına literal yazılmasın — test_quality_code_literal). */
export const NONE_TEXT = "boş";
export const NOT_ACTIVE_TEXT = "Bu muayene başka biri tarafından düzeltildi ya da iptal edildi; yenileyin.";
