// BEKÇİ — levent kabulü gövde kurucusu (D7a): plan doldurma, boş satır atlama, tartı tutarlılığı, gövde no tekrarı.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D7a".
import { describe, expect, it } from "vitest";
import { buildReceiveBody, draftsFromPlan, emptyBeamDraft, receiveYarnRows, signedKg } from "./receive-model";
import type { WarpingReceivePreview } from "./receive-types";

describe("receive-model", () => {
  it("plandaki adet × boy kadar satır; metre girdi biçiminde", () => {
    const d = draftsFromPlan([{ beamCount: 2, beamLengthM: "500.000" }, { beamCount: 1, beamLengthM: "312.500" }]);
    expect(d.map((r) => r.lengthM)).toEqual(["500", "500", "312,5"]);
    expect(draftsFromPlan([])).toHaveLength(1);
  });

  it("boş satır atlanır; tartısız satırda kg null; irsaliye boşsa null", () => {
    const r = buildReceiveBody([{ ...emptyBeamDraft("500"), physicalBeamNo: " G-1 " }, emptyBeamDraft(), { ...emptyBeamDraft("212,5"), grossKg: "60,5", tareKg: "30" }], " ");
    expect(r).toEqual({
      ok: true, totalM: 712.5,
      body: { deliveryNoteNo: null, beams: [{ lengthM: 500, physicalBeamNo: "G-1", grossKg: null, tareKg: null }, { lengthM: 212.5, physicalBeamNo: null, grossKg: 60.5, tareKg: 30 }] },
    });
  });

  it("hatalar: metresiz yarım satır, brütsüz dara, dara ≥ brüt, tekrar eden gövde no, hiç satır", () => {
    expect(buildReceiveBody([{ ...emptyBeamDraft(), physicalBeamNo: "G-1" }], "")).toEqual({ ok: false, error: "1. satır: metre girin." });
    expect(buildReceiveBody([{ ...emptyBeamDraft("500"), tareKg: "30" }], "")).toMatchObject({ ok: false, error: expect.stringContaining("brüt kg da") });
    expect(buildReceiveBody([{ ...emptyBeamDraft("500"), grossKg: "30", tareKg: "30" }], "")).toMatchObject({ ok: false, error: expect.stringContaining("dara brütten küçük") });
    expect(buildReceiveBody([{ ...emptyBeamDraft("1"), physicalBeamNo: "A" }, { ...emptyBeamDraft("1"), physicalBeamNo: "A" }], "")).toMatchObject({ ok: false, error: expect.stringContaining("iki kez") });
    expect(buildReceiveBody([emptyBeamDraft()], "DV-1")).toEqual({ ok: false, error: null });
  });

  it("önizleme iplik satırı sunucu satırlarının toplamı; işaretli fark", () => {
    const p = {
      before: { yarns: [{ yarnItemId: "y1", code: "A", name: "5X" }] },
      beams: [{ yarns: [{ yarnItemId: "y1", kg: "15.000" }] }, { yarns: [{ yarnItemId: "y1", kg: "10.000" }] }],
      allocations: [{ yarnItemId: "y1", carryOver: true, kg: "4.000" }, { yarnItemId: "y1", carryOver: false, kg: "21.000" }],
      after: { yarns: [{ yarnItemId: "y1", unallocatedKg: "0.000" }] },
    } as unknown as WarpingReceivePreview;
    expect(receiveYarnRows(p)).toEqual([{ yarnItemId: "y1", code: "A", name: "5X", woundKg: 25, carryOverKg: 4, unallocatedAfterKg: "0.000" }]);
    expect(signedKg("-0.500")).toBe("−0,500");
    expect(signedKg("1.25")).toBe("+1,250");
    expect(signedKg(null)).toBe("—");
  });
});
