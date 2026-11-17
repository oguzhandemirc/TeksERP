// BEKÇİ — fason devere sipariş formu gövde kurucusu (route Zod'u `strictObject` ile birebir; bilinmeyen anahtar 400).
// NEGATİF SONDA (2026-11-18): plan dalı `edit-meta`de de koştu → "sevkli sipariş plan anahtarı göndermez" ❌. Geri alındı.
import { describe, expect, it } from "vitest";
import { beamLinesBody, beamLinesText, buildOrderBody, dueText, editModeOf, emptyOrderForm, formFromOrder, previewBody, trimNum } from "./order-model";
import type { WarpingOrder } from "./types";

const SPEC = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const filled = emptyOrderForm({ warpSpecId: SPEC, subcontractorId: SUB, beamLines: [{ beamCount: "3", beamLengthM: "1200" }] });

describe("buildOrderBody — yeni sipariş", () => {
  it("kart ve devereci zorunlu; Türkçe hata", () => {
    expect(buildOrderBody(emptyOrderForm(), "create")).toEqual({ ok: false, error: "Çözgü kartı seçin." });
    expect(buildOrderBody({ ...filled, subcontractorId: null }, "create")).toEqual({ ok: false, error: "Devereci seçin." });
  });
  it("varsayılan ücret birimi METRE (müşteri belgesi); fiyatsızken para birimi gönderilmez", () => {
    const r = buildOrderBody(filled, "create");
    expect(r.ok && r.body).toMatchObject({ warpSpecId: SPEC, subcontractorId: SUB, beamLines: [{ beamCount: 3, beamLengthM: 1200 }], feeUnit: "METRE", feeUnitPrice: null, feeCurrency: null, salesOrderIds: [], notes: null, expectedReturnAt: null });
  });
  it("boş sabit fire ve tolerans ayara bırakılır (anahtar yok)", () => {
    const r = buildOrderBody(filled, "create");
    expect(r.ok && "fixedWasteM" in r.body).toBe(false);
    expect(r.ok && "wasteTolerancePct" in r.body).toBe(false);
  });
  it("virgüllü ücret, para birimi, müşteri siparişi ve termin gövdeye girer", () => {
    const r = buildOrderBody({ ...filled, feeUnitPrice: "0,035", feeCurrency: "EUR", salesOrders: [{ id: "o1", label: "S-1" }], expectedReturnDay: "2026-11-25" }, "create");
    expect(r.ok && r.body.feeUnitPrice).toBe(0.035);
    expect(r.ok && r.body.feeCurrency).toBe("EUR");
    expect(r.ok && r.body.salesOrderIds).toEqual(["o1"]);
    expect(r.ok && typeof r.body.expectedReturnAt).toBe("string");
  });
  it("levent satırı geçersizse kaydetmez", () => {
    expect(buildOrderBody({ ...filled, beamLines: [{ beamCount: "1,5", beamLengthM: "100" }] }, "create").ok).toBe(false);
    expect(buildOrderBody({ ...filled, beamLines: [{ beamCount: "2", beamLengthM: "0" }] }, "create").ok).toBe(false);
    expect(buildOrderBody({ ...filled, beamLines: [] }, "create").ok).toBe(false);
  });
});

describe("buildOrderBody — düzenleme", () => {
  it("sevkli sipariş (edit-meta) plan anahtarı ve kimlik GÖNDERMEZ", () => {
    const r = buildOrderBody(filled, "edit-meta");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of ["beamLines", "extraWarpSpecIds", "fixedWasteM", "warpSpecId", "subcontractorId"]) expect(k in r.body).toBe(false);
  });
  it("OPEN (edit-plan) plan gönderir, kimlik göndermez; boş tolerans = null (denetim yok)", () => {
    const r = buildOrderBody(filled, "edit-plan");
    expect(r.ok && r.body.beamLines).toEqual([{ beamCount: 3, beamLengthM: 1200 }]);
    expect(r.ok && "warpSpecId" in r.body).toBe(false);
    expect(r.ok && r.body.wasteTolerancePct).toBeNull();
  });
  it("durum → düzenleme kipi", () => {
    expect([editModeOf("OPEN"), editModeOf("IN_PROGRESS"), editModeOf("COMPLETED"), editModeOf("CANCELLED")]).toEqual(["edit-plan", "edit-meta", null, null]);
  });
});

describe("önizleme ve biçim", () => {
  it("kart ya da geçerli satır yoksa önizleme istenmez", () => {
    expect(previewBody(emptyOrderForm())).toBeNull();
    expect(previewBody(filled)).toEqual({ warpSpecId: SPEC, beamLines: [{ beamCount: 3, beamLengthM: 1200 }] });
    expect(previewBody({ ...filled, fixedWasteM: "-1" })).toBeNull();
    expect(beamLinesBody([{ beamCount: "2", beamLengthM: "1000,5" }])).toEqual([{ beamCount: 2, beamLengthM: 1000.5 }]);
  });
  it("trimNum · levent metni · termin gecikmesi yalnız açık/sevkte", () => {
    expect([trimNum("1000.000"), trimNum("12.500"), trimNum("7")]).toEqual(["1000", "12.5", "7"]);
    expect(beamLinesText([{ beamCount: 2, beamLengthM: "1000.000" }, { beamCount: 1, beamLengthM: "800.000" }])).toBe("2 × 1000 m + 1 × 800 m");
    const now = new Date("2026-11-20T09:00:00Z");
    expect(dueText("2026-11-17T09:00:00Z", "IN_PROGRESS", now)).toEqual({ text: "17.11.2026 · 3 gün gecikti", late: true });
    expect(dueText("2026-11-17T09:00:00Z", "COMPLETED", now).late).toBe(false);
    expect(dueText(null, "OPEN", now).text).toBe("—");
  });
  it("kayıtlı siparişten form: sayılar sadeleşir, tolerans boşsa boş", () => {
    const o = { warpSpec: { id: SPEC }, subcontractor: { id: SUB }, beamLines: [{ beamCount: 2, beamLengthM: "1500.000" }], extraSpecs: [], salesOrders: [], fee: { unit: "KG", unitPrice: null, currency: null }, expectedReturnAt: null, fixedWasteM: "0.000", wasteTolerancePct: null, notes: null } as unknown as WarpingOrder;
    expect(formFromOrder(o)).toMatchObject({ beamLines: [{ beamCount: "2", beamLengthM: "1500" }], feeUnit: "KG", fixedWasteM: "0", wasteTolerancePct: "", feeCurrency: "USD" });
  });
});
