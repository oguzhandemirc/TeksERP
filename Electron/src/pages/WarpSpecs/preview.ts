// Kart formu 1000 m önizlemesi — hesap SUNUCUDA (`POST /api/warp-plan/calculate`); burada yalnız gövde ve metin.
import { fmtKg, parseInput, yarnLetter } from "@/pages/Operations/WarpPlan/warp-plan-model";
import type { WarpPlanBody, WarpPlanForwardLine, WarpPlanResult } from "@/pages/Operations/WarpPlan/types";
import type { WarpSpecFormValues } from "./schema";

export const PREVIEW_LENGTH_M = 1000;

/** Tam ve geçerli satırlarla gövde; eksik satır ya da tekrar eden iplik varsa null (istek atılmaz). */
export function buildPreviewBody(yarns: WarpSpecFormValues["yarns"], wastePct: string | undefined): WarpPlanBody | null {
  const lines: Array<{ yarnItemId: string; endsCount: number }> = [];
  for (const r of yarns) {
    const ends = parseInput(String(r.endsCount ?? ""));
    if (!r.yarnItemId || ends === null || !Number.isInteger(ends) || ends <= 0) return null;
    lines.push({ yarnItemId: r.yarnItemId, endsCount: ends });
  }
  if (lines.length === 0 || new Set(lines.map((l) => l.yarnItemId)).size !== lines.length) return null;
  const pct = (wastePct ?? "").trim() === "" ? null : parseInput(wastePct ?? "");
  if (pct !== null && (pct < 0 || pct >= 100)) return null;
  return { mode: "FROM_BEAMS", lines, specWastePct: pct, beamCount: 1, beamLengthM: PREVIEW_LENGTH_M, fixedWasteM: 0 };
}

export interface PreviewText {
  net: string;
  /** Yalnız fire varsa (kural: fire yoksa fireli satır gösterilmez). */
  gross: string | null;
}

/** "A PES-150 50,000 kg · B …" — harf satır sırasından, kod sunucunun iplik bilgisinden. */
export function previewText(result: WarpPlanResult): PreviewText | null {
  const f = result.forward;
  if (!f) return null;
  const code = (id: string) => result.yarns.find((y) => y.yarnItemId === id)?.code ?? "iplik";
  const part = (pick: (l: WarpPlanForwardLine) => number) =>
    f.lines.map((l, i) => `${yarnLetter(i)} ${code(l.yarnItemId)} ${fmtKg(pick(l))} kg`).join(" · ");
  return { net: part((l) => l.netKg), gross: f.hasWaste ? part((l) => l.grossKg) : null };
}
