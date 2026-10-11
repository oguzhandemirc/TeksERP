// Salon eylem listesi (menü + çubuk + "⋯" TEK kaynak): modül kapalı → öğe YOK; izin yok → görünür,
// pasif ve nedenini söyler (kullanıcı kararı 2026-10-11).
import { describe, expect, it } from "vitest";
import { floorActionsOf, stopsLinkOf, type FloorActionCtx } from "./floorActions";

const all = () => true;
const none = () => false;
const ctx = (p: Partial<FloorActionCtx>): FloorActionCtx => ({ count: 1, dokumaEnabled: true, can: all, ...p });
const keys = (c: FloorActionCtx) => floorActionsOf(c).map((a) => a.key);
const byKey = (c: FloorActionCtx, k: string) => floorActionsOf(c).find((a) => a.key === k);

describe("floorActionsOf", () => {
  it("tek tezgah + dokuma açık + tam yetki: hepsi görünür ve etkin", () => {
    const list = floorActionsOf(ctx({}));
    expect(list.map((a) => a.key)).toEqual(["detail", "stops", "reports", "selectAll", "clear"]);
    expect(list.every((a) => a.enabled && a.reason === null)).toBe(true);
  });

  it("⭐ dokuma modülü KAPALI: duruş listesi ve raporlar hiç görünmez (izin olsa da)", () => {
    expect(keys(ctx({ dokumaEnabled: false }))).toEqual(["detail", "selectAll", "clear"]);
  });

  it("⭐ izin yok: öğe GÖRÜNÜR ama pasif ve nedenini söyler", () => {
    const stops = byKey(ctx({ can: none }), "stops");
    const reports = byKey(ctx({ can: none }), "reports");
    expect(stops).toMatchObject({ enabled: false });
    expect(stops?.reason).toContain("Tezgah Duruşları");
    expect(reports).toMatchObject({ enabled: false });
    expect(reports?.reason).toContain("Üretim raporları");
  });

  it("duruş listesi loom:manual-entry YA DA loom:classify ile açılır; raporlar report:production ister", () => {
    expect(byKey(ctx({ can: (p) => p === "loom:classify" }), "stops")?.enabled).toBe(true);
    expect(byKey(ctx({ can: (p) => p === "loom:manual-entry" }), "stops")?.enabled).toBe(true);
    expect(byKey(ctx({ can: (p) => p === "loom:classify" }), "reports")?.enabled).toBe(false);
    expect(byKey(ctx({ can: (p) => p === "report:production" }), "reports")?.enabled).toBe(true);
  });

  it("çoklu seçimde tek-tezgah öğeleri (detay, duruş listesi) yok; seçim yokken 'bırak' yok", () => {
    expect(keys(ctx({ count: 3 }))).toEqual(["reports", "selectAll", "clear"]);
    expect(keys(ctx({ count: 0 }))).toEqual(["reports", "selectAll"]);
  });

  it("duruş listesi bağlantısı tezgah süzgeciyle", () => {
    expect(stopsLinkOf("m 1")).toBe("/operations/machine-stops?filter%5BmachineId%5D=m+1");
  });
});
