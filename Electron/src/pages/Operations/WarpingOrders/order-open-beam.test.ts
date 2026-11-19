// BEKÇİ — "levent adedi belli değil": gövde (openTargetLengthM XOR beamLines) · metinler · talimat · eski backend uyumu.
// NEGATİF SONDA (2026-11-19): `targetBody` açık modda da beamLines gönderdi → ① ❌; `isBeamCountOpen` yalnız
// `beamCountOpen`a baktı → ④ (eski/yeni backend null adet) ❌. Geri alındı.
import { describe, expect, it } from "vitest";
import { buildOrderBody, emptyOrderForm, formFromOrder, isBeamCountOpen, planText, previewBody, targetText } from "./order-model";
import { buildInstructionHtml } from "./instruction-html";
import type { WarpingOrder } from "./types";
import type { WarpingInstruction } from "./yarn-types";

const SPEC = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const open = emptyOrderForm({ warpSpecId: SPEC, subcontractorId: SUB, beamCountOpen: true, openTargetLengthM: "1500" });

describe("açık adet gövdesi", () => {
  it("① yeni sipariş: yalnız openTargetLengthM, beamLines yok", () => {
    const r = buildOrderBody(open, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.openTargetLengthM).toBe(1500);
    expect("beamLines" in r.body).toBe(false);
    expect(previewBody(open)).toEqual({ warpSpecId: SPEC, openTargetLengthM: 1500 });
  });
  it("② toplam metre boş/sıfır → Türkçe hata; anahtar kapalıyken bugünkü satır davranışı", () => {
    const bad = buildOrderBody({ ...open, openTargetLengthM: "0" }, "create");
    expect(bad).toEqual({ ok: false, error: "Toplam metre sıfırdan büyük olmalı." });
    expect(previewBody({ ...open, openTargetLengthM: "" })).toBeNull();
    const fixed = buildOrderBody({ ...open, beamCountOpen: false, beamLines: [{ beamCount: "2", beamLengthM: "750" }] }, "create");
    expect(fixed.ok && fixed.body.beamLines).toEqual([{ beamCount: 2, beamLengthM: 750 }]);
    expect(fixed.ok && "openTargetLengthM" in fixed.body).toBe(false);
    expect(emptyOrderForm().beamCountOpen).toBe(false);
  });
  it("③ sevkli siparişte (edit-meta) hedef anahtarı hiç gitmez", () => {
    const r = buildOrderBody(open, "edit-meta");
    expect(r.ok && ("openTargetLengthM" in r.body || "beamLines" in r.body)).toBe(false);
  });
});

describe("metinler ve uyum", () => {
  const o = (beamCount: number | null, beamCountOpen?: boolean) =>
    ({ beamCount, beamCountOpen, beamLines: beamCount ? [{ beamCount, beamLengthM: "500.000" }] : [], targetLengthM: beamCount ? `${beamCount * 500}.000` : "1500.000" });
  it("④ açık adet: yeni backend bayrağı ya da null adet; eski backend (bayraksız, adet dolu) satırlı", () => {
    expect(isBeamCountOpen(o(null, true))).toBe(true);
    expect(isBeamCountOpen(o(null))).toBe(true);
    expect(isBeamCountOpen(o(3))).toBe(false);
    expect(isBeamCountOpen(o(3, false))).toBe(false);
  });
  it("⑤ liste/detay ve kabul metinleri", () => {
    expect(targetText(o(null, true))).toBe("1500 m (adet devereciye bırakıldı)");
    expect(planText(o(null, true))).toBe("toplam 1500 m");
    expect(targetText(o(3))).toBe("3 levent · 1500 m");
    expect(planText(o(3))).toBe("3 × 500 m");
  });
  it("⑥ kayıtlı açık adet siparişten form: anahtar açık, toplam metre dolu, satır varsayılanı", () => {
    const w = { warpSpec: { id: SPEC }, subcontractor: { id: SUB }, beamLines: [], beamCount: null, beamCountOpen: true, targetLengthM: "1500.000", extraSpecs: [], salesOrders: [], fee: { unit: "METRE", unitPrice: null, currency: null }, expectedReturnAt: null, fixedWasteM: "0.00", wasteTolerancePct: null, notes: null } as unknown as WarpingOrder;
    expect(formFromOrder(w)).toMatchObject({ beamCountOpen: true, openTargetLengthM: "1500", beamLines: [{ beamCount: "1", beamLengthM: "" }] });
  });
  it("⑦ çözgü talimatı: \"Levent adedi: devereciye bırakıldı, toplam X m\"", () => {
    const i: WarpingInstruction = {
      orderNo: "FD-1", subcontractor: { code: "DV", name: "Devereci" }, warpSpec: { code: "C", name: "Çözgü" }, extraSpecs: [], totalEnds: 10,
      yarns: [], sequenceNote: null, reed: null, beamLines: [], beamCount: null, beamCountOpen: true, targetLengthM: "1500.000", expectedReturnAt: null, notes: null,
    };
    const html = buildInstructionHtml(i);
    expect(html).toContain("Levent adedi");
    expect(html).toContain("devereciye bırakıldı, toplam 1500 m");
    expect(buildInstructionHtml({ ...i, beamLines: [{ beamCount: 2, beamLengthM: "750.000" }], beamCount: 2, beamCountOpen: false })).toContain("2 × 750 m — toplam 2 levent, 1500 m");
  });
});
