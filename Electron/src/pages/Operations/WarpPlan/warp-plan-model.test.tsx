import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildWarpPlanBody, emptyWarpPlanState, parseInput, stockText, wasteSourceText, yarnLetter } from "./warp-plan-model";
import { ForwardTable, forwardColumns } from "./ForwardTable";
import { ReverseResult } from "./ReverseResult";
import type { WarpPlanForward, WarpPlanResult, WarpPlanReverse } from "./types";

const s = { ...emptyWarpPlanState, warpSpecId: "11111111-1111-4111-8111-111111111111" };

describe("buildWarpPlanBody", () => {
  it("kart seçilmeden istek yok", () => {
    expect(buildWarpPlanBody(emptyWarpPlanState)).toBeNull();
  });
  it("Leventten: adet tam sayı ve boy > 0 ister", () => {
    expect(buildWarpPlanBody(s)).toEqual({ mode: "FROM_BEAMS", warpSpecId: s.warpSpecId, beamCount: 1, beamLengthM: 1000 });
    expect(buildWarpPlanBody({ ...s, beamCount: "1,5" })).toBeNull();
    expect(buildWarpPlanBody({ ...s, beamLengthM: "0" })).toBeNull();
  });
  it("sabit fire boşsa gönderilmez (ayar varsayılanı); geçersizse istek yok", () => {
    expect(buildWarpPlanBody(s)).not.toHaveProperty("fixedWasteM");
    expect(buildWarpPlanBody({ ...s, fixedWasteM: "20" })?.fixedWasteM).toBe(20);
    expect(buildWarpPlanBody({ ...s, fixedWasteM: "-1" })).toBeNull();
  });
  it("Eldeki iplikten: levent boyu isteğe bağlı; devereci seçiliyse gider", () => {
    expect(buildWarpPlanBody({ ...s, mode: "FROM_STOCK", beamLengthM: "", subcontractorId: "sub" })).toEqual({ mode: "FROM_STOCK", warpSpecId: s.warpSpecId, subcontractorId: "sub" });
  });
  it("virgüllü ondalık okunur; harf ve stok metni", () => {
    expect(parseInput("2,5")).toBe(2.5);
    expect([yarnLetter(0), yarnLetter(2)]).toEqual(["A", "C"]);
    expect(stockText(null)).toBe("bilinmiyor");
  });
});

const yarns = [{ yarnItemId: "y1", code: "PES-150", name: "PES 150", denier: 150, sortOrder: 0, emanetKg: null }];
const forward = (hasWaste: boolean): WarpPlanForward => ({
  lengthM: 1000, grossLengthM: hasWaste ? 1020 : 1000, hasWaste,
  wasteSources: hasWaste ? [{ kind: "SABIT_M", value: 20 }, { kind: "IPLIK_PCT", value: 2, yarnItemId: "y1" }] : [],
  lines: [{ yarnItemId: "y1", endsCount: 3000, wastePct: 0, netKg: 50, grossKg: 51, depoKg: 10, fasondaKg: null, sendKg: 51, depoShortKg: 41 }],
  totals: { netKg: 50, grossKg: 51, sendKg: 51 },
});
const result = (over: Partial<WarpPlanResult> = {}): WarpPlanResult => ({
  mode: "FROM_BEAMS", warpSpec: { id: "w", code: "W", name: "W" }, fixedWasteM: 0,
  stock: { known: true, emanetAcik: false, subcontractorId: null }, yarns, forward: forward(false), reverse: null, ...over,
});

describe("Leventten sonucu — sütun görünürlüğü", () => {
  it("fire yoksa fireli sütun yok; devereci seçilmemişse deverecide/gönderilecek yok; emanet kapalıysa emanet yok", () => {
    expect(forwardColumns(result(), forward(false))).toEqual({ gross: false, fason: false, emanet: false });
    render(<ForwardTable res={result()} forward={forward(false)} />);
    expect(screen.queryByText(/Fireli/)).toBeNull();
    expect(screen.queryByText("Deverecide kg")).toBeNull();
    expect(screen.getByText("Formül (firesiz) kg")).toBeTruthy();
  });
  it("fire ve devereci varken sütunlar çıkar; fire kaynağı metni", () => {
    const r = result({ stock: { known: true, emanetAcik: true, subcontractorId: "sub" } });
    expect(forwardColumns(r, forward(true))).toEqual({ gross: true, fason: true, emanet: true });
    render(<ForwardTable res={r} forward={forward(true)} />);
    expect(screen.getAllByText(/Fireli/).length).toBeGreaterThan(0);
    expect(screen.getByText("Deverecide kg")).toBeTruthy();
    expect(wasteSourceText(forward(true).wasteSources, yarns)).toBe("sabit 20 m · PES-150 %2");
  });
});

describe("Eldeki iplikten sonucu", () => {
  it("en çok metre, kısıtlayan iplik ve tam levent gösterilir", () => {
    const reverse: WarpPlanReverse = {
      maxLengthM: 2400, constraintYarnItemId: "y1", insufficient: false, unknownStock: false, fullBeams: 2, remainderM: 400,
      hasWaste: false, wasteSources: [], lines: [{ yarnItemId: "y1", availableKg: 120, maxLengthM: 2400, leftoverKg: 0 }],
    };
    render(<ReverseResult res={result({ mode: "FROM_STOCK", forward: null, reverse })} reverse={reverse} />);
    expect(screen.getByText("Kısıtlayan iplik")).toBeTruthy();
    expect(screen.getByText(/PES-150 — PES 150/)).toBeTruthy();
    expect(screen.getByText(/2 levent/)).toBeTruthy();
  });
});
