// =============================================================================
// BEKÇİ — EKSEN SEÇİCİSİNİN SAF YARISI: liste DARALMAZ, süzgeç ÇIKTIYA geçer
// =============================================================================
// ⭐ NEDEN VAR: süzgeç aktifken sunucu yalnız seçili makinenin satırlarını döner.
// Seçenek listesi o yanıttan kurulsaydı TEK ÖĞEYE daralır ve kullanıcı kendi
// seçimine kilitlenirdi (başka makineye geçemez, "tümü"ne dönmeden çıkamaz).
// Kapı bu yüzden listenin KAYNAĞINI ölçer, ekranı değil.
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildParetoExport, buildRandimanExport } from "./dokumaExport";
import { machineOptionsFrom, optionLabel, pickReportData, shiftOptionsFrom } from "./dokumaFilters";
import type { EfficiencyReport } from "./service";

const row = (id: string, code: string) => ({ machineId: id, machine: { code, name: `Tezgah ${code}` } });

describe("dokuma rapor süzgeci — saf yarı", () => {
  it("makine seçenekleri benzersiz ve Türkçe sıralı", () => {
    const opts = machineOptionsFrom([row("b", "T-02"), row("a", "T-01"), row("a", "T-01")]);
    expect(opts.map((o) => o.id)).toEqual(["a", "b"]);
    expect(opts[0]!.label).toBe("T-01 · Tezgah T-01");
  });

  it("⭐ liste SÜZGEÇSİZ yanıttan kurulur — seçim listeyi DARALTMAZ", () => {
    const pencere = [row("a", "T-01"), row("b", "T-02"), row("c", "T-03")];
    const suzgecli = [row("b", "T-02")]; // sunucunun süzgeçli yanıtı
    // Sayfa seçenekleri HER ZAMAN pencere yanıtından kurar:
    expect(machineOptionsFrom(pencere)).toHaveLength(3);
    // Süzgeçli yanıttan kurulsaydı 1 olurdu — kilitlenme tam burada doğardı:
    expect(machineOptionsFrom(suzgecli)).toHaveLength(1);
  });

  it("tabloya giden veri süzgeç varken süzgeçli, yokken pencere yanıtıdır", () => {
    expect(pickReportData({ windowData: "P", filteredData: "S", filterId: "" })).toBe("P");
    expect(pickReportData({ windowData: "P", filteredData: "S", filterId: "b" })).toBe("S");
    // Süzgeçli yanıt HENÜZ gelmediyse boş döner: eski (süzgeçsiz) tabloyu
    // göstermek "süzgeç uygulandı" yalanı olurdu.
    expect(pickReportData({ windowData: "P", filteredData: undefined, filterId: "b" })).toBeUndefined();
  });

  it("vardiya seçenekleri tanım id'si OLMAYAN satırdan doğmaz", () => {
    expect(shiftOptionsFrom([{ shift: { code: "V1", name: "Sabah" } }])).toEqual([]);
    expect(shiftOptionsFrom([{ shift: { code: "V1", name: "Sabah" }, shiftDefinitionId: "d1" }])).toHaveLength(1);
  });

  it("⭐ süzgeç ÇIKTI başlığına geçer (K10), süzgeç yoksa satır YOK", () => {
    const rapor: EfficiencyReport = {
      satirlar: [], toplam: { availabilityPct: null, performancePct: null, effectivenessPct: null, olculemedi: { A: 0, P: 0, E: 0 }, rowCount: 0 },
      kaynakKirilimi: { MACHINE: { satir: 0, potSec: 0 }, OPERATOR: { satir: 0, potSec: 0 }, SUPERVISOR: { satir: 0, potSec: 0 }, SIMULATED: { satir: 0, potSec: 0 }, INFERRED: { satir: 0, potSec: 0 } },
      meta: { ufuk: "2026-09-14", ufukOncesiSatir: 0, total: 0, truncated: false, live: 0, sealed: 0 },
    };
    const suzgecli = buildRandimanExport({ rapor, periodLabel: "x", filterLabel: "T-01 · Tezgah T-01" });
    expect(suzgecli.meta?.[0]).toContain("SÜZGEÇ — Tezgah: T-01");
    const suzgecsiz = buildRandimanExport({ rapor, periodLabel: "x", filterLabel: null });
    expect(suzgecsiz.meta?.join(" ")).not.toContain("SÜZGEÇ");
  });

  it("⭐ Pareto süzgeci ÇIKTIYA da geçer — kaynağı BAŞKA rapor olsa da", () => {
    // Pareto satırı makine taşımaz; liste Randıman penceresinden gelir. Süzgecin
    // kâğıda geçmesi bu yüzden AYRI ölçülür: "liste başka yerden geliyor" kusuru,
    // çıktıda sessizce kaybolmakla aynı şey olurdu.
    const rapor = {
      sebepler: [], mikroDuruslar: { stopCount: 0, stopSec: 0 }, siniflandirilmamis: { stopCount: 0, stopSec: 0 },
      atanmamis: { stopCount: 0, stopSec: 0 }, toplam: { stopCount: 0, stopSec: 0 },
      kaynakKirilimi: { MACHINE: { satir: 0, potSec: 0 }, OPERATOR: { satir: 0, potSec: 0 }, SUPERVISOR: { satir: 0, potSec: 0 }, SIMULATED: { satir: 0, potSec: 0 }, INFERRED: { satir: 0, potSec: 0 } },
      meta: { ufuk: "2026-09-14", ufukOncesiSatir: 0, total: 0, truncated: false, live: 0, sealed: 0 },
    };
    const spec = buildParetoExport({ rapor, periodLabel: "x", filterLabel: "T-02 · Tezgah T-02" });
    expect(spec.meta?.[0]).toContain("SÜZGEÇ — Tezgah: T-02");
  });

  it("etiket çözümü: bilinmeyen id ham basılır, boş seçim etiketsizdir", () => {
    const opts = machineOptionsFrom([row("a", "T-01")]);
    expect(optionLabel(opts, "a")).toBe("T-01 · Tezgah T-01");
    expect(optionLabel(opts, "zz")).toBe("zz");
    expect(optionLabel(opts, "")).toBeNull();
  });
});

// R5b-a3 — vardiya ekseni: seçenek kaynağı artık GERÇEK (backend `shiftDefinitionId`).
describe("vardiya seçicisi", () => {
  it("⭐ seçenekler gün yanıtından doğar ve tanım id'si olmayan satır listeye GİRMEZ", () => {
    const vardiyalar = [
      { shift: { code: "V1", name: "Sabah" }, shiftDefinitionId: "d1" },
      { shift: { code: "V2", name: "Akşam" }, shiftDefinitionId: "d2" },
      { shift: { code: "V1", name: "Sabah" }, shiftDefinitionId: "d1" }, // aynı tanımın ikinci örneği
    ];
    const opts = shiftOptionsFrom(vardiyalar);
    // Etikete göre Türkçe sıralı: "V1 · Sabah" < "V2 · Akşam".
    expect(opts.map((o) => o.id)).toEqual(["d1", "d2"]);
    expect(opts).toHaveLength(2); // VARDİYA ÖRNEĞİ değil VARDİYA TANIMI sayılır
  });
});
