// B4 müdahale raporu dışa aktarımı: kişi ekseni yalnız sunucu döndürdüyse; spec ekrandaki eksenle aynı rakamı basar.
import { describe, expect, it } from "vitest";
import { buildMudahaleExport, fmtDuration, mudahaleAxes } from "./mudahaleExport";
import type { AlarmResponseCell, AlarmResponseReport } from "./service";

const cell = (p: Partial<AlarmResponseCell> = {}): AlarmResponseCell => ({
  alarm: 8, iptal: 1, ustlenilen: 4, ustlenmeOrtSn: 285, cozulen: 6, cozumOrtSn: 1100, asim: 3, zamaninda: 2, belirsiz: 2, hedefsiz: 1, asimOraniPct: 60, ...p,
});
const rapor = (kisi: boolean): AlarmResponseReport => ({
  ozet: cell(), sebepler: [{ anahtar: "P1", etiket: "Arıza", ...cell({ alarm: 4 }) }], holler: [], vardiyalar: [], tezgahlar: [],
  ...(kisi ? { kisiler: [{ anahtar: "u1", etiket: "Ahmet Usta", ...cell({ alarm: 2, asimOraniPct: null }) }] } : {}), kisiKirilimi: kisi,
});

describe("mudahale dışa aktarımı", () => {
  it("süre biçimi saniyeyi düşürmez, saatte dakikaya iner", () => {
    expect(fmtDuration(285)).toBe("4 dk 45 sn");
    expect(fmtDuration(42)).toBe("42 sn");
    expect(fmtDuration(3900)).toBe("1 sa 05 dk");
    expect(fmtDuration(null)).toBe("—");
  });
  it("kişi ekseni yalnız sunucu döndürdüyse", () => {
    expect(mudahaleAxes(rapor(false))).not.toContain("kisiler");
    expect(mudahaleAxes(rapor(true))).toContain("kisiler");
  });
  it("spec özet + seçili eksen; oran yoksa tire", () => {
    const s = buildMudahaleExport({ rapor: rapor(true), axis: "kisiler", periodLabel: "x", warnings: ["tavan"] });
    expect(s.tables).toHaveLength(1);
    expect(s.tables[0]!.rows[0]).toMatchObject({ etiket: "Ahmet Usta", alarm: 2, ustlenme: "4 dk 45 sn", oran: "—" });
    expect(s.meta!.join(" ")).toContain("tavan");
    const sebep = buildMudahaleExport({ rapor: rapor(false), axis: "sebepler", periodLabel: "x" });
    expect(sebep.tables[0]!.rows[0]).toMatchObject({ etiket: "Arıza", alarm: 4, oran: 60 });
  });
});
