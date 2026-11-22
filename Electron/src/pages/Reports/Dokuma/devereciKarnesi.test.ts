import { describe, expect, it } from "vitest";
import { KARNE_COLUMNS, buildKarneExport, onTimeText, rejectText, warpDefectText, type KarneReport, type KarneRow } from "./devereciKarnesi";

const row: KarneRow = {
  subcontractor: { id: "s1", name: "Devereci A" },
  tahminGun: 4,
  teslim: { siparis: 3, terminli: 2, zamaninda: 1, gecikmeli: 1, zamanindaPct: 50, ortGecikmeGun: 1 },
  sure: { medyanGun: 5, ornek: 3 },
  fire: { kapanis: 2, ortPct: 4, enYuksekPct: 6, toleransAsimi: 1 },
  ret: { donenLevent: 5, reddedilen: 1, oranPct: 20 },
  denye: { levent: 1, nominalKg: 100, tartiNetKg: 110, sapmaPct: 10 },
  cozguHatasi: { top: 2, kumasM: 500, hata: 3, yuzMetreBasina: 0.6, gerekce: null },
};

describe("devereci karnesi kolonları", () => {
  it("oranlar sunucudan, sayımla birlikte basılır", () => {
    expect(onTimeText(row.teslim)).toBe("%50 (1/2)");
    expect(rejectText(row.ret)).toBe("%20 (1/5)");
    expect(warpDefectText(row.cozguHatasi)).toContain("3 hata");
  });
  it("ölçülemeyen değer sıfır değil, beyandır", () => {
    expect(warpDefectText({ top: 0, kumasM: 0, hata: 0, yuzMetreBasina: null, gerekce: "otomatik tüketim kapalı" })).toBe("Ölçülemedi");
    expect(onTimeText({ ...row.teslim, terminli: 0, zamanindaPct: null })).toBe("—");
    expect(rejectText({ donenLevent: 0, reddedilen: 0, oranPct: null })).toBe("—");
  });
  it("dışa aktarım ekranla aynı kolon listesinden", () => {
    const report: KarneReport = { satirlar: [row], ozet: row, meta: { ufuk: "2026-09-14", otomatikTuketim: true, secenekler: { subcontractorId: [] } } };
    const spec = buildKarneExport({ report, range: { from: "2026-10-01", to: "2026-10-31" }, filterNotes: [] });
    expect(spec.tables[0]!.columns.map((c) => c.key)).toEqual(KARNE_COLUMNS.map((c) => c.key));
    expect(spec.tables[0]!.rows[0]!.devereci).toBe("Devereci A");
  });
});
