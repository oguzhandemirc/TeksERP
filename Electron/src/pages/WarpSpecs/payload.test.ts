import { describe, expect, it } from "vitest";
import { buildDefaults, buildPayload, copyDraft } from "./payload";
import { buildPreviewBody, previewText } from "./preview";
import { totalEnds } from "./YarnRowsEditor";
import type { WarpSpec } from "./types";
import type { WarpPlanResult } from "@/pages/Operations/WarpPlan/types";

const spec = (over: Partial<WarpSpec> = {}): WarpSpec => ({
  id: "s1", code: "UA-Ç", name: "UA çözgüsü", yarnItemId: "y2", endsCount: 3000, selvedgeEnds: null, reedNo: 20, endsPerDent: 1,
  reedWidthCm: 350, takeUpPct: null, wastePct: 3, notes: null, isActive: false, createdAt: "", updatedAt: "",
  yarns: [
    { yarnItemId: "y2", endsCount: 2000, sortOrder: 1 },
    { yarnItemId: "y1", endsCount: 1000, sortOrder: 0 },
  ],
  sequenceNote: "2A 1B",
  ...over,
});

describe("buildPayload — D3 satır gövdesi", () => {
  it("yarns gönderir, eski kolonları (yarnItemId/endsCount) GÖNDERMEZ", () => {
    const p = buildPayload({ ...buildDefaults(spec()), sequenceNote: "  " });
    expect(p.yarns).toEqual([{ yarnItemId: "y1", endsCount: 1000 }, { yarnItemId: "y2", endsCount: 2000 }]);
    expect("yarnItemId" in p).toBe(false);
    expect("endsCount" in p).toBe(false);
    expect(p.sequenceNote).toBeNull();
  });
  it("dizilim metni kırpılarak gider", () => {
    expect(buildPayload({ ...buildDefaults(spec()), sequenceNote: " 2A 1B " }).sequenceNote).toBe("2A 1B");
  });
});

describe("buildDefaults", () => {
  it("satırları sortOrder sırasıyla forma alır", () => {
    expect(buildDefaults(spec()).yarns).toEqual([{ yarnItemId: "y1", endsCount: "1000" }, { yarnItemId: "y2", endsCount: "2000" }]);
  });
  it("satırsız eski kartta kolonlardan tek satır kurar", () => {
    expect(buildDefaults(spec({ yarns: [] })).yarns).toEqual([{ yarnItemId: "y2", endsCount: "3000" }]);
  });
});

describe("copyDraft", () => {
  it("kod boş, ad KOPYA, aktif; satırlar ve dizilim kopya", () => {
    const d = copyDraft(spec());
    expect([d.code, d.name, d.isActive, d.sequenceNote]).toEqual(["", "UA çözgüsü KOPYA", true, "2A 1B"]);
    expect(d.yarns).toHaveLength(2);
  });
});

describe("1000 m önizleme", () => {
  it("tam satırlarla 1000 m / 1 levent / sabit fire 0 gövdesi kurar", () => {
    expect(buildPreviewBody([{ yarnItemId: "y1", endsCount: "3000" }], "3")).toEqual({
      mode: "FROM_BEAMS", lines: [{ yarnItemId: "y1", endsCount: 3000 }], specWastePct: 3, beamCount: 1, beamLengthM: 1000, fixedWasteM: 0,
    });
  });
  it("eksik/tekrarlı satırda istek atılmaz", () => {
    expect(buildPreviewBody([{ yarnItemId: "", endsCount: "3000" }], "")).toBeNull();
    expect(buildPreviewBody([{ yarnItemId: "y1", endsCount: "0" }], "")).toBeNull();
    expect(buildPreviewBody([{ yarnItemId: "y1", endsCount: "1" }, { yarnItemId: "y1", endsCount: "2" }], "")).toBeNull();
  });
  const result = (hasWaste: boolean): WarpPlanResult => ({
    mode: "FROM_BEAMS", warpSpec: null, fixedWasteM: 0, stock: { known: false, emanetAcik: false, subcontractorId: null },
    yarns: [{ yarnItemId: "y1", code: "PES-150", name: "PES", denier: 150, sortOrder: 0, emanetKg: null }],
    forward: {
      lengthM: 1000, grossLengthM: 1000, hasWaste, wasteSources: [],
      lines: [{ yarnItemId: "y1", endsCount: 3000, wastePct: 0, netKg: 50, grossKg: 51.5, depoKg: null, fasondaKg: null, sendKg: 51.5, depoShortKg: null }],
      totals: { netKg: 50, grossKg: 51.5, sendKg: 51.5 },
    },
    reverse: null,
  });
  it("fire yoksa fireli satır yok; varsa var", () => {
    expect(previewText(result(false))).toEqual({ net: "A PES-150 50,000 kg", gross: null });
    expect(previewText(result(true))?.gross).toBe("A PES-150 51,500 kg");
  });
  it("toplam tel yalnız geçerli tam sayıları toplar", () => {
    expect(totalEnds([{ yarnItemId: "a", endsCount: "1000" }, { yarnItemId: "b", endsCount: "x" }, { yarnItemId: "c", endsCount: "500" }])).toBe(1500);
  });
});
