// Kartela sevk/kabul saf kuralları — gövdeler tabletle ve backend zod şemasıyla birebir.
import { describe, expect, it } from "vitest";
import {
  blockedSwatchCardNumbers,
  buildDispatchPayload,
  buildReceiveReturns,
  differingIndexes,
  filterJobs,
  groupOutstanding,
  rollScanRejection,
  KARTELA_ROLL_SCOPE,
  KARTELA_MARKED_ROLL_SCOPE,
  KARTELA_MARKED_FILTERS,
  KARTELA_PICKER_SCOPES,
  rollToPicked,
} from "./kartelaActions";
import type { KartelaOutstandingItem } from "./service";

const item = (dispatchId: string, rollId: string, extra: Partial<KartelaOutstandingItem["roll"]> = {}, at = "2026-11-01T08:00:00.000Z"): KartelaOutstandingItem => ({
  dispatchedQty: 50,
  dispatchedWeight: null,
  dispatch: { id: dispatchId, dispatchNo: `KS-${dispatchId}`, dispatchedAt: at, subcontractor: { id: "f1", name: "Şahin Kartela" } },
  roll: { id: rollId, barcode: `T${rollId}`, currentQty: 50, width: null, weightKg: null, qualityGrade: "A", markedForKartela: false,
    item: { code: "P", name: "Poplin" }, color: { code: "B", name: "Beyaz" }, properties: [], ...extra },
});

describe("sevk gövdesi", () => {
  it("tablet alanlarıyla birebir: boş metin null, kırpılır; fazladan alan yok", () => {
    const body = buildDispatchPayload({ subcontractorId: "f1", rolls: [{ id: "r1" }, { id: "r2" }], plateNumber: " 34 AB 12 ", driverName: "  ", notes: "" });
    expect(body).toEqual({ subcontractorId: "f1", rollIds: ["r1", "r2"], plateNumber: "34 AB 12", driverName: null, notes: null });
  });

  it("seçici kapsamları: varsayılan kartelalık toplar, ikincisi tüm bitmiş toplar (tablet süzgeci)", () => {
    expect(KARTELA_PICKER_SCOPES[0]).toBe(KARTELA_MARKED_ROLL_SCOPE);
    expect(KARTELA_MARKED_ROLL_SCOPE).toMatchObject({ label: "Kartelalık toplar", filters: {
      "filter[status]": "WAREHOUSE", "filter[shipmentScope]": "free", "filter[markedForKartela]": "true" } });
    expect(KARTELA_PICKER_SCOPES[1]).toBe(KARTELA_ROLL_SCOPE);
    expect(KARTELA_ROLL_SCOPE).toMatchObject({ label: "Tüm bitmiş toplar", filters: { "filter[status]": "WAREHOUSE", "filter[shipmentScope]": "free" } });
    expect(KARTELA_MARKED_FILTERS).toEqual({ status: "WAREHOUSE", shipmentScope: "free", markedForKartela: "true" });
  });

  it("top kaydı → sevk satırı", () => {
    expect(rollToPicked({ id: "r1", barcode: "T1", currentQty: "12.5", item: { name: "Poplin" }, color: null }))
      .toEqual({ id: "r1", barcode: "T1", itemName: "Poplin", colorName: null, qty: 12.5 });
  });

  it("okutma retleri: depoda değil · sevkiyatta · çuvalda; uygunsa null", () => {
    expect(rollScanRejection({ status: "AT_KARTELA" })).toMatch(/Kartelada/);
    expect(rollScanRejection({ status: "WAREHOUSE", shipmentId: "s", shipment: { shipmentNo: "SV-1" } })).toMatch(/SV-1 sevkiyatına/);
    expect(rollScanRejection({ status: "WAREHOUSE", sackId: "c", sack: { sackNo: "CV-9" } })).toMatch(/CV-9 çuvalında/);
    expect(rollScanRejection({ status: "WAREHOUSE", shipmentId: null, sackId: null })).toBeNull();
  });
});

describe("kabul gövdesi (tablet selectedReturns)", () => {
  const ids = ["r1", "r2", "r3"];

  it("adetsiz top gönderilmez; ölçüm boşsa bulk null", () => {
    const out = buildReceiveReturns(ids, {
      r1: { count: "3", defCm: "", defKg: "", exceptions: {} },
      r2: { count: "", defCm: "50", defKg: "", exceptions: {} },
    });
    expect(out).toEqual([{ rollId: "r1", count: 3, bulkLengthCm: null, bulkWeightKg: null }]);
  });

  it("varsayılan ölçü bulk olarak gider, virgül ondalığı okunur", () => {
    const out = buildReceiveReturns(ids, { r1: { count: "2", defCm: "50", defKg: "0,25", exceptions: {} } });
    expect(out).toEqual([{ rollId: "r1", count: 2, bulkLengthCm: 50, bulkWeightKg: 0.25 }]);
  });

  it("varsayılana EŞİT istisna sayılmaz (tablet kayıtta temizler); farklı olan items[count] üretir", () => {
    const same = { count: "3", defCm: "50", defKg: "", exceptions: { 1: { cm: "50" } } };
    expect(differingIndexes(same)).toEqual([]);
    expect(buildReceiveReturns(ids, { r1: same })[0]).not.toHaveProperty("items");

    const diff = { count: "3", defCm: "50", defKg: "", exceptions: { 1: { cm: "48" }, 5: { cm: "40" } } };
    expect(buildReceiveReturns(ids, { r1: diff })).toEqual([{
      rollId: "r1", count: 3, bulkLengthCm: 50, bulkWeightKg: null,
      items: [{ lengthCm: null, weightKg: null }, { lengthCm: 48, weightKg: null }, { lengthCm: null, weightKg: null }],
    }]);
  });
});

describe("bekleyen kabul", () => {
  it("sevke göre gruplar, yeni → eski sıralar, metreyi toplar", () => {
    const jobs = groupOutstanding([
      item("a", "1", {}, "2026-11-01T08:00:00.000Z"),
      item("b", "2", { item: { code: "S", name: "Saten" }, color: null }, "2026-11-03T08:00:00.000Z"),
      item("a", "3"),
    ]);
    expect(jobs.map((j) => [j.dispatchId, j.rolls.length, j.totalQty])).toEqual([["b", 1, 50], ["a", 2, 100]]);
    expect(jobs[1]!.itemNames).toEqual(["Poplin"]);
  });

  it("arama: 2 karakterden kısa süzmez; firma (katlanmış) · sevk no · barkod eşleşir", () => {
    const jobs = groupOutstanding([item("a", "1"), item("b", "22", { item: { code: "S", name: "Saten" }, color: null })]);
    expect(filterJobs(jobs, "s")).toHaveLength(2);
    expect(filterJobs(jobs, "SAHIN")).toHaveLength(2);
    expect(filterJobs(jobs, "saten").map((j) => j.dispatchId)).toEqual(["b"]);
    expect(filterJobs(jobs, "KS-a").map((j) => j.dispatchId)).toEqual(["a"]);
    expect(filterJobs(jobs, "T22").map((j) => j.dispatchId)).toEqual(["b"]);
  });
});

describe("kabul iptali engeli", () => {
  const err = (details: unknown) => ({ response: { data: { message: "x", details } } });

  it("yalnız details.code === SWATCHES_DOWNSTREAM'de kart numaraları döner", () => {
    expect(blockedSwatchCardNumbers(err({ code: "SWATCHES_DOWNSTREAM", blocked: ["KRT1", "", 3, "KRT2"] }))).toEqual(["KRT1", "KRT2"]);
    expect(blockedSwatchCardNumbers(err({ code: "SWATCH_RACE" }))).toBeNull();
    expect(blockedSwatchCardNumbers(err({ code: "SWATCHES_DOWNSTREAM", blocked: [] }))).toBeNull();
  });

  it("body.code OKUNMAZ (yalnız details.code)", () => {
    expect(blockedSwatchCardNumbers({ response: { data: { code: "SWATCHES_DOWNSTREAM", blocked: ["KRT1"] } } })).toBeNull();
  });
});
