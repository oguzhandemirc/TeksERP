import { describe, expect, it } from "vitest";
import type { ReleaseEntry } from "@/lib/surum-notlari";
import { countByType, filterReleases } from "./release-notes-view";

const ENTRIES: ReleaseEntry[] = [
  {
    id: "2026-09-10",
    baslik: "Sevkiyat iyileştirmeleri",
    surumler: { panel: "1.3.0", tablet: "1.0.6" },
    maddeler: [
      { kapsam: "panel", tip: "yeni", metin: "Çuval listesi yenilendi" },
      { kapsam: "tablet", tip: "duzeltme", metin: "Tartı ekranı donması giderildi" },
      { kapsam: "her-ikisi", tip: "iyilestirme", metin: "İptal sebebi soruluyor" },
    ],
  },
  {
    id: "2026-09-01",
    baslik: "Tablet düzeltmeleri",
    surumler: { tablet: "1.0.5" },
    maddeler: [{ kapsam: "tablet", tip: "duzeltme", metin: "KK1 kaydı hızlandı" }],
  },
];

describe("sürüm notu süzgeci", () => {
  it("panel süzgeci tablet-only maddeyi ve yayını düşürür, her-ikisi kalır", () => {
    const r = filterReleases(ENTRIES, "panel", "");
    expect(r.map((e) => e.id)).toEqual(["2026-09-10"]);
    expect(r[0]!.maddeler.map((m) => m.metin)).toEqual(["Çuval listesi yenilendi", "İptal sebebi soruluyor"]);
  });

  it("arama maddede eşleşirse yalnız eşleşen madde kalır (Türkçe harf duyarsız)", () => {
    const r = filterReleases(ENTRIES, "all", "iptal");
    expect(r).toHaveLength(1);
    expect(r[0]!.maddeler).toHaveLength(1);
  });

  it("arama başlıkta eşleşirse yayının bütün maddeleri kalır", () => {
    expect(filterReleases(ENTRIES, "all", "SEVKİYAT")[0]!.maddeler).toHaveLength(3);
  });

  it("eşleşme yoksa boş", () => {
    expect(filterReleases(ENTRIES, "all", "yokböyle")).toEqual([]);
  });

  it("tür sayıları", () => {
    expect(countByType(ENTRIES[0]!)).toEqual({ yeni: 1, iyilestirme: 1, duzeltme: 1 });
  });
});
