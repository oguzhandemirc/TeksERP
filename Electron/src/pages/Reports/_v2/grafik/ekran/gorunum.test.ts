import { describe, expect, it } from "vitest";
import type { GrafikBlok, GrafikSerisi } from "../../sunum";
import { BASKI_TEMASI } from "../tema";
import { defaultKind, kindOptions, resolveKind, type ChartKind } from "./gorunum";
import { chartHeight, screenOption } from "./ekranSecenek";
import type { ScreenPalette } from "./palet";

const seri = (ad: string, n: number, soluk = false, base = 10): GrafikSerisi => ({ ad, veri: Array.from({ length: n }, (_, i) => base + i), ...(soluk ? { soluk } : {}) });
const blok = (tur: GrafikBlok["tur"], x: GrafikBlok["eksen"]["x"]["tur"], seriler: GrafikSerisi[], n: number): GrafikBlok => ({
  tur,
  eksen: { x: { ad: "x", tur: x }, y: { ad: "Metre", birim: "m" } },
  seriler,
  kategoriler: Array.from({ length: n }, (_, i) => (x === "zaman" ? `2026-10-${String(i + 1).padStart(2, "0")}` : x === "sayi" ? String(i) : `K${i}`)),
});
const enabled = (b: GrafikBlok) => kindOptions(b).filter((o) => o.enabled).map((o) => o.kind);

describe("grafik türü uygunluk matrisi (veri şekli → sunulan türler)", () => {
  const cases: [string, GrafikBlok, ChartKind[]][] = [
    ["zaman · tek seri + kıyas", blok("cizgi", "zaman", [seri("Bu dönem", 5), seri("Önceki", 5, true)], 5), ["line", "area", "bar"]],
    ["zaman · çok seri", blok("cizgi", "zaman", [seri("A", 5), seri("B", 5)], 5), ["line", "area", "bar", "stacked", "heatmap"]],
    ["kategori · tek seri", blok("cubuk", "kategori", [seri("A", 6)], 6), ["bar", "hbar", "donut", "treemap", "pareto"]],
    ["kategori · tek seri · 30 kategori (halka yok)", blok("pasta", "kategori", [seri("A", 30)], 30), ["bar", "hbar", "treemap", "pareto"]],
    ["kategori · tek seri · 2 kategori (pareto yok)", blok("cubuk", "kategori", [seri("A", 2)], 2), ["bar", "hbar", "donut", "treemap"]],
    ["kategori · çok seri", blok("yiginCubuk", "kategori", [seri("Yurtiçi", 3), seri("Yurtdışı", 3)], 3), ["bar", "hbar", "stacked", "heatmap"]],
    ["sunucu ısı haritası", blok("isiHaritasi", "kategori", [seri("A", 4), seri("B", 4)], 4), ["bar", "hbar", "stacked", "heatmap"]],
    ["sayısal x (dağılım)", blok("sacilim", "sayi", [seri("A", 8)], 8), ["scatter"]],
  ];
  it.each(cases)("%s", (_, b, want) => expect(enabled(b)).toEqual(want));

  it("eksi değer parça grafiklerini kapatır (nedeni yazar)", () => {
    const b = blok("cubuk", "kategori", [{ ad: "Fark", veri: [5, -3, 2, 1] }], 4);
    expect(enabled(b)).toEqual(["bar", "hbar"]);
    expect(kindOptions(b).find((o) => o.kind === "donut")?.reason).toMatch(/Eksi/);
  });

  it("kutu / küçük çoklu: seçici yok, yalnız özgün tür", () => {
    expect(kindOptions(blok("kutu", "kategori", [seri("A", 5)], 0))).toEqual([{ kind: "native", enabled: true }]);
    expect(defaultKind(blok("kucukCoklu", "zaman", [seri("A", 5), seri("B", 5)], 5))).toBe("native");
  });

  it("pasif tür gizlenmez, nedeni ipucunda", () => {
    const opts = kindOptions(blok("cizgi", "zaman", [seri("A", 5)], 5));
    expect(opts).toHaveLength(10);
    expect(opts.find((o) => o.kind === "donut")).toMatchObject({ enabled: false, reason: expect.stringMatching(/Zaman/) });
  });
});

describe("varsayılan ve tercih", () => {
  it("varsayılan sunucunun türü; uymuyorsa ilk etkin tür", () => {
    expect(defaultKind(blok("cizgi", "zaman", [seri("A", 5)], 5))).toBe("line");
    expect(defaultKind(blok("yiginCubuk", "kategori", [seri("A", 3), seri("B", 3)], 3))).toBe("stacked");
    expect(defaultKind(blok("pasta", "kategori", [seri("A", 30)], 30))).toBe("bar");
  });
  it("uymayan tercih varsayılana düşer; uyan tercih uygulanır", () => {
    const zaman = blok("cizgi", "zaman", [seri("A", 5)], 5);
    expect(resolveKind(zaman, "donut")).toBe("line");
    expect(resolveKind(zaman, "area")).toBe("area");
    expect(resolveKind(zaman, "uydurma")).toBe("line");
  });
});

describe("ekran seçeneği", () => {
  const p: ScreenPalette = { ...BASKI_TEMASI, card: "x", fade: () => "y" };
  const series = (o: Record<string, unknown>) => o.series as Record<string, unknown>[];
  it("kıyas serisi çizgide kesik ve soluk", () => {
    const o = screenOption(blok("cizgi", "zaman", [seri("Bu", 5), seri("Önceki", 5, true)], 5), "line", p, { labels: false });
    expect(series(o)[1]).toMatchObject({ lineStyle: { type: "dashed" }, color: p.soluk });
  });
  it("alan türü degrade dolgu taşır; yığılmış sütun ortak yığın", () => {
    const b = blok("cizgi", "zaman", [seri("A", 5), seri("B", 5)], 5);
    expect(series(screenOption(b, "area", p, { labels: false }))[0]).toHaveProperty("areaStyle");
    expect(series(screenOption(b, "stacked", p, { labels: false })).every((s) => s.stack === "toplam")).toBe(true);
  });
  it("veri etiketi düğmesi seriye yansır", () => {
    const b = blok("cubuk", "kategori", [seri("A", 4)], 4);
    expect((series(screenOption(b, "bar", p, { labels: true }))[0]!.label as { show: boolean }).show).toBe(true);
    expect((series(screenOption(b, "bar", p, { labels: false }))[0]!.label as { show: boolean }).show).toBe(false);
  });
  it("pareto büyükten küçüğe dizer; birikimli çizgi ipucuna sayı basmaz", () => {
    const b: GrafikBlok = { ...blok("cubuk", "kategori", [{ ad: "A", veri: [1, 5, 3] }], 3) };
    const o = screenOption(b, "pareto", p, { labels: false });
    expect(series(o)[0]!.data).toEqual([5, 3, 1]);
    expect(series(o)[1]).toMatchObject({ yAxisIndex: 1, tooltip: { show: false } });
  });
  it("30+ kategoride kaydırma açılır; yatay çubuk eksenleri çevirir", () => {
    const b = blok("cubuk", "kategori", [seri("A", 30)], 30);
    expect(screenOption(b, "bar", p, { labels: false }).dataZoom).toBeDefined();
    expect((screenOption(b, "hbar", p, { labels: false }).yAxis as { type: string }).type).toBe("category");
  });
  it("halka/ağaç haritası ortada TOPLAM basmaz; halka başlığı serinin adı", () => {
    const b = blok("pasta", "kategori", [seri("Sipariş metresi", 4)], 4);
    expect((screenOption(b, "donut", p, { labels: false }).title as { text: string }).text).toBe("Sipariş metresi");
    expect(series(screenOption(b, "treemap", p, { labels: false }))[0]!.type).toBe("treemap");
  });
  it("boş veri 'Grafik için veri yok' seçeneğine düşer", () => {
    const o = screenOption(blok("cizgi", "zaman", [seri("A", 0)], 0), "line", p, { labels: false });
    expect((o.title as { text: string }).text).toBe("Grafik için veri yok");
  });
  it("seyrek ısı haritası: az hücrede değer hep yazılır, yükseklik tabana gerilmez", () => {
    const b = blok("yiginCubuk", "kategori", [seri("A", 2), seri("B", 2)], 2);
    expect((series(screenOption(b, "heatmap", p, { labels: false }))[0]!.label as { show: boolean }).show).toBe(true);
    expect(chartHeight(b, "heatmap", 320)).toBeLessThan(320);
    const big = blok("yiginCubuk", "kategori", Array.from({ length: 6 }, (_, i) => seri(`S${i}`, 10)), 10);
    expect((series(screenOption(big, "heatmap", p, { labels: false }))[0]!.label as { show: boolean }).show).toBe(false);
  });
});
