// Kusurlu sarım reddi saf yardımcıları (C2) + kabulde yeniden sarım bağı gövdesi.
import { describe, expect, it } from "vitest";
import { buildReceiveBody, emptyBeamDraft } from "./receive-model";
import { activeRejectionByBeam, buildRejectBody, photoProblem, rejectableBeams, reworkCandidates, type RejectDraft } from "./rejection-model";
import type { WarpingReceipt } from "./receive-types";
import type { WarpingBeamRejection, WarpingBeamRejectionItem } from "./rejection-types";

const beam = (id: string, status: string, cancelled = false) => ({
  id, beamNo: id.toUpperCase(), status, physicalBeamNo: null, ownerCustomerId: null, lengthM: "500.000", nominalKg: "20.000",
  grossKg: null, tareKg: null, weighedNetKg: null, weighDiffKg: null, cancelled, yarns: [],
});
const receipt = { receiptKey: "rk", deliveryNoteNo: "DV-1", receivedAt: "2026-11-20T08:00:00Z", beamCount: 3, liveBeamCount: 2, lengthM: "1000.000", beams: [beam("b1", "READY"), beam("b2", "REJECTED"), beam("b3", "CANCELLED", true)] } as WarpingReceipt;
const item = (beamId: string, over: Partial<WarpingBeamRejectionItem> = {}): WarpingBeamRejectionItem => ({
  beamId, beamNo: beamId.toUpperCase(), status: "REJECTED", bodyNo: null, lengthM: "500.000", nominalKg: "20.000", endsCount: 400, deliveryNoteNo: "DV-1", receivedAt: null, reversed: false, rework: null, ...over,
});
const doc = (over: Partial<WarpingBeamRejection>): WarpingBeamRejection => ({
  id: "d", docNo: "DR-2611-0001", status: "ACTIVE", mode: "REWORK", order: { id: "wo", orderNo: "FDV1", warpSpec: { code: "C", name: "Kart" } },
  subcontractor: { id: "s", code: "S", name: "Devereci" }, reason: { code: "TEL_KOPUK", text: "Tel kopuk" }, notes: null, rejectedAt: "2026-11-20T09:00:00Z",
  createdAt: "2026-11-20T09:00:00Z", cancelledAt: null, cancelReason: null, totals: { beamCount: 1, lengthM: "500.000", nominalKg: "20.000" }, items: [], photos: [], ...over,
});
const draft = (over: Partial<RejectDraft> = {}): RejectDraft => ({ beamIds: ["b2", "b1"], reasonCode: "TEL_KOPUK", reasonText: "", notes: "", expectRework: true, rejectedAt: "", ...over });
const iso = (v: string) => (v === "bad" ? null : `${v}:00+03:00`);

describe("rejection-model", () => {
  it("aday: yalnız canlı HAZIR sarım; yeniden sarım adayı: etkin REWORK belgede, ters çevrilmemiş, yeniden sarımı yok", () => {
    expect(rejectableBeams([receipt]).map((b) => b.id)).toEqual(["b1"]);
    const docs = [
      doc({ docNo: "DR-1", items: [item("x1"), item("x2", { rework: { id: "r", beamNo: "R" } }), item("x3", { reversed: true })] }),
      doc({ docNo: "DR-2", mode: "CANCEL", items: [item("y1")] }),
      doc({ docNo: "DR-3", status: "CANCELLED", items: [item("z1", { status: "READY" })] }),
    ];
    expect(reworkCandidates(docs)).toEqual([{ beamId: "x1", beamNo: "X1", docNo: "DR-1" }]);
    expect([...activeRejectionByBeam(docs).keys()]).toEqual(["x1", "x2", "y1"]);
  });

  it("gövde: sarım + sebep şart; metin isteyen sebepte ≥3 karakter; tarih ISO; sarımlar sıralı", () => {
    expect(buildRejectBody("wo", draft({ beamIds: [] }), false, iso)).toEqual({ ok: false, error: "En az bir sarım seçin." });
    expect(buildRejectBody("wo", draft({ reasonCode: "" }), false, iso)).toEqual({ ok: false, error: null });
    expect(buildRejectBody("wo", draft({ reasonCode: "DIGER", reasonText: "ab" }), true, iso)).toMatchObject({ ok: false, error: expect.stringContaining("açıklama zorunlu") });
    expect(buildRejectBody("wo", draft({ rejectedAt: "bad" }), false, iso)).toEqual({ ok: false, error: "Ret tarihi geçersiz." });
    expect(buildRejectBody("wo", draft({ notes: " not ", expectRework: false, rejectedAt: "2026-11-20T10:00" }), false, iso)).toEqual({
      ok: true, body: { warpingOrderId: "wo", beamIds: ["b1", "b2"], reasonCode: "TEL_KOPUK", reasonText: null, notes: "not", expectRework: false, rejectedAt: "2026-11-20T10:00:00+03:00" },
    });
  });

  it("foto ön denetimi: tür ve 5 MB", () => {
    expect(photoProblem({ name: "a.jpg", type: "image/jpeg", size: 1000 })).toBeNull();
    expect(photoProblem({ name: "a.gif", type: "image/gif", size: 1000 })).toContain("JPEG ya da PNG");
    expect(photoProblem({ name: "a.png", type: "image/png", size: 6 * 1024 * 1024 })).toContain("5 MB");
  });

  it("kabul: yeniden sarım bağı yalnız seçiliyse gövdeye girer; aynı reddedilen iki satıra bağlanamaz", () => {
    const r = buildReceiveBody([{ ...emptyBeamDraft("500"), reworkOfBeamId: "x1" }, emptyBeamDraft("400")], "");
    expect(r).toMatchObject({ ok: true, body: { beams: [{ lengthM: 500, reworkOfBeamId: "x1" }, { lengthM: 400 }] } });
    expect(r.ok && "reworkOfBeamId" in (r.body.beams[1] ?? {})).toBe(false);
    expect(buildReceiveBody([{ ...emptyBeamDraft("1"), reworkOfBeamId: "x1" }, { ...emptyBeamDraft("1"), reworkOfBeamId: "x1" }], "")).toMatchObject({ ok: false, error: expect.stringContaining("iki satıra") });
    expect(buildReceiveBody([{ ...emptyBeamDraft(), reworkOfBeamId: "x1" }], "")).toEqual({ ok: false, error: "1. satır: metre girin." });
  });
});
