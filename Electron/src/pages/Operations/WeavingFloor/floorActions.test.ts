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

  describe("koşum eylemleri (F3)", () => {
    const runs = (online = true, openRunLooms: number | null = 1) => ({ runs: { online, openRunLooms } });

    it("⭐ koşum bağlamı yoksa (örnek veri, TV) eski liste AYNEN", () => {
      expect(keys(ctx({}))).toEqual(["detail", "stops", "reports", "selectAll", "clear"]);
    });

    it("⭐ dokuma modülü KAPALI: İş ver / Değiştir / Bitir / Geri al hiç görünmez (izin ve bağlantı olsa da)", () => {
      expect(keys(ctx({ dokumaEnabled: false, ...runs() }))).toEqual(["detail", "selectAll", "clear"]);
    });

    it("tek tezgah + tam yetki + açık koşum: dört eylem etkin, sıra sabit", () => {
      const list = floorActionsOf(ctx(runs()));
      expect(list.map((a) => a.key)).toEqual(["detail", "assign", "replace", "finish", "revoke", "stops", "reports", "selectAll", "clear"]);
      expect(list.every((a) => a.enabled)).toBe(true);
    });

    it("⭐ loom:run yoksa İş ver/Değiştir/Bitir pasif + neden; geri alma ayrı izin (loom:run-revoke)", () => {
      const c = ctx({ ...runs(), can: (p) => p === "loom:run-revoke" });
      for (const k of ["assign", "replace", "finish"]) {
        expect(byKey(c, k)).toMatchObject({ enabled: false });
        expect(byKey(c, k)?.reason).toContain("Tezgah koşumu");
      }
      expect(byKey(c, "revoke")?.enabled).toBe(true);
      expect(byKey(ctx({ ...runs(), can: (p) => p === "loom:run" }), "revoke")?.reason).toContain("Koşum geri alma");
    });

    it("⭐ C.15 bağlantı yok: dört eylem pasif + 'Sunucuya ulaşılamıyor'", () => {
      for (const k of ["assign", "replace", "finish", "revoke"]) {
        expect(byKey(ctx(runs(false)), k)).toMatchObject({ enabled: false });
        expect(byKey(ctx(runs(false)), k)?.reason).toContain("Sunucuya ulaşılamıyor");
      }
    });

    it("⭐ seçimde açık koşum yoksa Değiştir/Bitir/Geri al pasif; İş ver açık; koşum bilgisi gelmiyorsa (eski sunucu) dördü de pasif", () => {
      expect(byKey(ctx(runs(true, 0)), "assign")?.enabled).toBe(true);
      for (const k of ["replace", "finish", "revoke"]) expect(byKey(ctx(runs(true, 0)), k)?.reason).toContain("açık koşum yok");
      for (const k of ["assign", "replace", "finish", "revoke"]) expect(byKey(ctx(runs(true, null)), k)?.reason).toContain("sunucu güncellenince");
    });

    it("⭐ Koşumu geri al yalnız TEK seçimde (çoklu seçimde öğe yok)", () => {
      expect(keys(ctx({ count: 3, ...runs(true, 3) }))).toEqual(["assign", "replace", "finish", "reports", "selectAll", "clear"]);
    });
  });
});
