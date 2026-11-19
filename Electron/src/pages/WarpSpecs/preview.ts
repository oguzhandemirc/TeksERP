// Kart formu hesap paneli — hesap SUNUCUDA (`POST /api/warp-plan/calculate`, çözgü planıyla aynı uç);
// burada yalnız gövde kurulur ve sunucu sonucu satırlara dizilir. Yeni formül YAZILMAZ.
import { parseInput, yarnLetter } from "@/pages/Operations/WarpPlan/warp-plan-model";
import type { WarpPlanBody, WarpPlanResult } from "@/pages/Operations/WarpPlan/types";
import type { WarpSpecFormValues } from "./schema";

export const PREVIEW_LENGTH_M = 1000;

export interface BeamInput {
  lengthM: number;
  count: number;
}

/** Tam ve geçerli satırlarla gövde; eksik satır ya da tekrar eden iplik varsa null (istek atılmaz). */
export function buildPreviewBody(
  yarns: WarpSpecFormValues["yarns"],
  wastePct: string | undefined,
  beam: BeamInput = { lengthM: PREVIEW_LENGTH_M, count: 1 },
): WarpPlanBody | null {
  const lines: Array<{ yarnItemId: string; endsCount: number }> = [];
  for (const r of yarns) {
    const ends = parseInput(String(r.endsCount ?? ""));
    if (!r.yarnItemId || ends === null || !Number.isInteger(ends) || ends <= 0) return null;
    lines.push({ yarnItemId: r.yarnItemId, endsCount: ends });
  }
  if (lines.length === 0 || new Set(lines.map((l) => l.yarnItemId)).size !== lines.length) return null;
  const pct = (wastePct ?? "").trim() === "" ? null : parseInput(wastePct ?? "");
  if (pct !== null && (pct < 0 || pct >= 100)) return null;
  return { mode: "FROM_BEAMS", lines, specWastePct: pct, beamCount: beam.count, beamLengthM: beam.lengthM, fixedWasteM: 0 };
}

/** Levent boyu × adet: ikisi de pozitif sayıysa (adet tam sayı) değer, yoksa null — eksik girişte istek atılmaz. */
export function parseBeam(lengthText: string, countText: string): BeamInput | null {
  const lengthM = parseInput(lengthText);
  const count = parseInput(countText);
  if (lengthM === null || lengthM <= 0 || count === null || count <= 0 || !Number.isInteger(count)) return null;
  return { lengthM, count };
}

export interface CalcRow {
  letter: string;
  yarnItemId: string;
  name: string;
  code: string;
  endsCount: number;
  /** İplik kartındaki denye (sunucudan). */
  denier: number | null;
  netKg: number;
  /** Yalnız fire varsa. */
  grossKg: number | null;
  /** Bu ipliğin 1000 m net kg içindeki payı (%). */
  sharePct: number | null;
  /** Levent boyu × adet girildiyse o uzunluk için net kg. */
  beamKg: number | null;
}

export interface CalcView {
  rows: CalcRow[];
  totalNetKg: number;
  totalGrossKg: number | null;
  beam: (BeamInput & { totalKg: number }) | null;
}

/** Sunucu sonucunu (1000 m + isteğe bağlı levent) panel satırlarına dizer; harf satır sırasından. */
export function buildCalcView(per1000: WarpPlanResult, beam: { input: BeamInput; result: WarpPlanResult } | null): CalcView | null {
  const f = per1000.forward;
  if (!f) return null;
  const bf = beam?.result.forward ?? null;
  const total = f.totals.netKg;
  const rows = f.lines.map((l, i): CalcRow => {
    const y = per1000.yarns.find((x) => x.yarnItemId === l.yarnItemId);
    const bl = bf?.lines.find((x) => x.yarnItemId === l.yarnItemId) ?? null;
    return {
      letter: yarnLetter(i),
      yarnItemId: l.yarnItemId,
      name: y?.name ?? "İplik",
      code: y?.code ?? "",
      endsCount: l.endsCount,
      denier: y?.denier ?? null,
      netKg: l.netKg,
      grossKg: f.hasWaste ? l.grossKg : null,
      sharePct: total > 0 ? (l.netKg / total) * 100 : null,
      beamKg: bl ? bl.netKg : null,
    };
  });
  return {
    rows,
    totalNetKg: total,
    totalGrossKg: f.hasWaste ? f.totals.grossKg : null,
    beam: beam && bf ? { ...beam.input, totalKg: bf.totals.netKg } : null,
  };
}
