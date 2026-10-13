// Tezgah Duruşları — kaynak rozeti: Kart / Elle / Simüle ayrı söylenir; simüle canlı veri gibi görünmez;
// K1 devralma ve ham kod alt satırda; eski sunucu (kart alanları yok) → alt satır yok.
import { describe, expect, it } from "vitest";
import { stopSourceBadge } from "./source-badge";

describe("stopSourceBadge", () => {
  it("⭐ MACHINE → 'Kart', ham kod alt satırda", () => {
    const b = stopSourceBadge({ source: "MACHINE", collectorId: "c1", rawStopCode: "E17" });
    expect(b.label).toBe("Kart");
    expect(b.notes).toEqual(["kod E17"]);
  });
  it("⭐ OPERATOR/SUPERVISOR → 'Elle', ipucu tablet/panel ayırır", () => {
    const op = stopSourceBadge({ source: "OPERATOR" });
    const sup = stopSourceBadge({ source: "SUPERVISOR" });
    expect([op.label, sup.label]).toEqual(["Elle", "Elle"]);
    expect(op.hint).toMatch(/tablet/);
    expect(sup.hint).toMatch(/panel/);
  });
  it("⭐ SIMULATED → 'Simüle', ipucunda SİMÜLASYON, ton Kart'tan ayrı", () => {
    const b = stopSourceBadge({ source: "SIMULATED", collectorId: "c1" });
    expect(b.label).toBe("Simüle");
    expect(b.hint).toMatch(/SİMÜLASYON/);
    expect(b.tone).not.toBe(stopSourceBadge({ source: "MACHINE" }).tone);
  });
  it("⭐ K1: insan açtı, kart devraldı → 'Elle' + 'kart devraldı'", () => {
    expect(stopSourceBadge({ source: "OPERATOR", collectorId: "c1", rawStopCode: null }).notes).toEqual(["kart devraldı"]);
  });
  it("eski sunucu (kart alanları yok) → alt satır yok", () => {
    expect(stopSourceBadge({ source: "SUPERVISOR" }).notes).toEqual([]);
    expect(stopSourceBadge({ source: "INFERRED" }).label).toBe("Türetilmiş");
  });
});
