// Prova 11-06 (madde 13): Geciken İE'de pasif istasyon çıplak ad olarak basılmaz; İE gizlenmez.
import { describe, expect, it } from "vitest";

import { overdueStationLabel } from "./OverdueWorkOrders";

const step = (status: string, station?: { isActive?: boolean; name: string }) =>
  ({ id: status, stepSequence: 1, status, station: station && { id: "s", code: "S", ...station } }) as never;

describe("overdueStationLabel", () => {
  it("pasif istasyonda bekleyen adım işaretlenir", () => {
    expect(overdueStationLabel({ steps: [step("COMPLETED", { name: "Kurşun" }), step("ACTIVE", { name: "Brode", isActive: false })] })).toBe("Brode (pasif istasyon)");
  });
  it("aktif ve eski sunucu (alan yok) bugünkü ad", () => {
    expect(overdueStationLabel({ steps: [step("ACTIVE", { name: "Kurşun", isActive: true })] })).toBe("Kurşun");
    expect(overdueStationLabel({ steps: [step("ACTIVE", { name: "Kurşun" })] })).toBe("Kurşun");
  });
  it("aktif adım yoksa istasyon yok", () => {
    expect(overdueStationLabel({ steps: [step("PENDING", { name: "Brode", isActive: false })] })).toBeNull();
  });
});
