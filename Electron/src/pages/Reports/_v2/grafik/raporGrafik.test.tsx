// =============================================================================
// BEKÇİ — rapor grafiği sarmalı (R0-GRAFIK): 8 türün ECharts seçeneği, baskı SVG'si
// (DOM'suz SSR), boş veri dili, veri tablosu, paket pini ve tembel yükleme.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { REPORT_NUM_FMTS } from "@/lib/number-format";
import { GRAFIK_VERI_YOK, valueText, grafikBosMu, grafikSecenek, kategoriEtiketi, kutuIstatistigi } from "./secenek";
import { grafikSvg, grafikleriDoldur } from "./svgUret";
import { grafikVeriTablosu } from "./veriTablosu";
import { BASKI_TEMASI } from "./tema";
import { RaporGrafik } from "./RaporGrafik";
import type { GrafikBlok, GrafikTuru } from "../sunum";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
// jsdom'da canvas yok: zrender metin ölçümünde yaklaşık genişliğe düşer (gürültüsüz).
HTMLCanvasElement.prototype.getContext = (() => null) as never;

type Seri = { type: string; stack?: string; lineStyle?: { type?: string }; data?: unknown[] };

function blok(tur: GrafikTuru, ek: Partial<GrafikBlok> = {}): GrafikBlok {
  return {
    tur,
    eksen: { x: { ad: "Gün", tur: "zaman" }, y: { ad: "Sevk", birim: "m" } },
    kategoriler: ["2026-10-01", "2026-10-02", "2026-10-03"],
    seriler: [
      { ad: "Bu dönem", veri: [12500.5, 9800, null] },
      { ad: "Önceki dönem", veri: [10000, 11000, 7000], soluk: true },
    ],
    ...ek,
  };
}

const TURLER: GrafikTuru[] = ["cizgi", "cubuk", "yiginCubuk", "pasta", "isiHaritasi", "sacilim", "kutu", "kucukCoklu"];

describe("grafikSecenek — 8 tür", () => {
  const seri = (tur: GrafikTuru, ek?: Partial<GrafikBlok>) =>
    grafikSecenek(blok(tur, ek), BASKI_TEMASI, { baski: true }).series as Seri[];

  it("çizgi: önceki dönem kesik/soluk, bu dönem düz", () => {
    const s = seri("cizgi");
    expect(s.map((x) => x.type)).toEqual(["line", "line"]);
    expect(s[0]!.lineStyle?.type).toBe("solid");
    expect(s[1]!.lineStyle?.type).toBe("dashed");
  });

  it("çubuk / yığın çubuk: yığın yalnız yiginCubuk'ta", () => {
    expect(seri("cubuk").every((x) => x.type === "bar" && !x.stack)).toBe(true);
    expect(seri("yiginCubuk").every((x) => x.type === "bar" && x.stack === "toplam")).toBe(true);
  });

  it("pasta: ilk seri, boş ve sıfır dilim düşer", () => {
    const s = seri("pasta");
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe("pie");
    expect(s[0]!.data).toEqual([
      { name: "01.10.2026", value: 12500.5 },
      { name: "02.10.2026", value: 9800 },
    ]);
  });

  it("ısı haritası: [x, y, değer] üçlüleri + renk ölçeği", () => {
    const o = grafikSecenek(blok("isiHaritasi"), BASKI_TEMASI, { baski: true });
    expect((o.series as Seri[])[0]!.type).toBe("heatmap");
    expect((o.series as Seri[])[0]!.data).toHaveLength(5);
    expect((o.visualMap as { min: number; max: number }).min).toBe(7000);
  });

  it("saçılım: sayısal kategori → değer ekseni", () => {
    const o = grafikSecenek(
      blok("sacilim", { eksen: { x: { ad: "Hız", tur: "sayi" }, y: { ad: "Fire", birim: "m" } }, kategoriler: ["1,5", "2", "3"] }),
      BASKI_TEMASI,
      { baski: true },
    );
    expect((o.xAxis as { type: string }).type).toBe("value");
    expect((o.series as Seri[])[0]!.data).toEqual([[1.5, 12500.5], [2, 9800]]);
  });

  it("kutu: her seri bir kutu + aykırı noktalar", () => {
    const s = seri("kutu", { seriler: [{ ad: "Gece", veri: [1, 2, 3, 4, 100] }, { ad: "Gündüz", veri: [2, 2, 3] }] });
    expect(s.map((x) => x.type)).toEqual(["boxplot", "scatter"]);
    expect(s[1]!.data).toEqual([[0, 100]]);
    expect(kutuIstatistigi([1, 2, 3, 4, 100])).toEqual({ kutu: [1, 2, 3, 4, 4], aykirilar: [100] });
  });

  it("küçük çoklu: seri başına ızgara + ORTAK eksen", () => {
    const o = grafikSecenek(blok("kucukCoklu"), BASKI_TEMASI, { baski: true });
    expect(o.grid).toHaveLength(2);
    const y = o.yAxis as Array<{ max: number; min: number }>;
    // Ortak tavan yuvarlak sayı (12.500,5 → 15.000): ham tavan eksende "12.500,5" basardı.
    expect(new Set(y.map((a) => a.max))).toEqual(new Set([15000]));
    expect(new Set(y.map((a) => a.min))).toEqual(new Set([0]));
  });

  it("baskıda tooltip ve animasyon yok; ekranda tooltip var", () => {
    for (const t of TURLER) {
      const o = grafikSecenek(blok(t), BASKI_TEMASI, { baski: true });
      expect(o.animation).toBe(false);
      expect(o.tooltip).toBeUndefined();
      expect(grafikSecenek(blok(t), BASKI_TEMASI).tooltip).toBeDefined();
    }
  });
});

describe("biçim: sayı lib/number-format, tarih lib/factory-time", () => {
  it("zaman ekseni: gün, an, ay", () => {
    expect(kategoriEtiketi("2026-10-14", "zaman")).toBe("14.10.2026");
    expect(kategoriEtiketi("2026-10", "zaman")).toBe("10.2026");
    expect(kategoriEtiketi("2026-10", "kategori")).toBe("2026-10");
  });
  it("değer metni: binlik nokta, ondalık virgül, yüzde öne", () => {
    expect(valueText(12500.5, "m")).toBe("12.500,5 m");
    expect(valueText(12.5, "%")).toBe("%12,5");
    expect(valueText(null, "m")).toBe("—");
  });
  it("eksen etiketi biçimleyicisi tr-TR", () => {
    const y = grafikSecenek(blok("cubuk"), BASKI_TEMASI).yAxis as { axisLabel: { formatter: (v: number) => string } };
    expect(y.axisLabel.formatter(12500)).toBe("12.500");
  });
});

describe("grafikSvg — DOM'suz SSR, vektör", () => {
  it("8 türün hepsi <svg döndürür, dış kaynak yok", async () => {
    for (const t of TURLER) {
      const svg = await grafikSvg(blok(t));
      expect(svg.startsWith("<svg"), t).toBe(true);
      expect(svg, t).not.toMatch(/<image|href="http|<script/);
    }
  });
  it("serbest metin kaçırılır (kumaş adı belgeyi bozmaz)", async () => {
    const svg = await grafikSvg(blok("cubuk", { eksen: { x: { ad: "Kumaş", tur: "kategori" }, y: { ad: "m", birim: "m" } }, kategoriler: ["A & <özel>", "B", "C"] }));
    expect(svg).not.toContain("<özel>");
    expect(svg).toContain("&lt;özel&gt;");
  });
  it("boş veri: aynı dil SVG'de de", async () => {
    const bos = blok("cizgi", { kategoriler: [], seriler: [] });
    expect(grafikBosMu(bos)).toBe(true);
    expect(await grafikSvg(bos)).toContain(GRAFIK_VERI_YOK);
  });
  it("grafikleriDoldur: svg'siz bloğu doldurur, blok yoksa spec'i AYNEN döndürür", async () => {
    const eski = { title: "T", tables: [] };
    expect(await grafikleriDoldur(eski)).toBe(eski);
    const b = blok("cubuk");
    const dolu = await grafikleriDoldur({ title: "T", tables: [], bloklar: [{ tur: "grafik", baslik: "G", grafik: b, veri: grafikVeriTablosu(b, "G") }] });
    const g = dolu.bloklar![0]!;
    expect(g.tur === "grafik" && g.svg?.startsWith("<svg")).toBe(true);
  });

  it("PDF saçılımında sunucunun eğilim çizgisi çizilir (kesikli); veri tablosu aynı kalır", async () => {
    const b = blok("sacilim", { eksen: { x: { ad: "Hız", tur: "sayi" }, y: { ad: "Fire", birim: "m" } }, kategoriler: ["1,5", "2", "3"] });
    const veri = grafikVeriTablosu(b, "S");
    const spec = (egilim?: [[number, number], [number, number]]) =>
      grafikleriDoldur({ title: "T", tables: [], bloklar: [{ tur: "grafik", baslik: "S", grafik: b, egilim, veri }] });
    const svgOf = async (e?: [[number, number], [number, number]]) => {
      const g = (await spec(e)).bloklar![0]!;
      return g.tur === "grafik" ? { svg: g.svg ?? "", veri: g.veri } : { svg: "", veri: null };
    };
    const yok = await svgOf();
    const egilimli = await svgOf([[1.5, 1], [3, 4]]);
    const kesikli = (s: string) => (s.match(/stroke-dasharray/g) ?? []).length;
    expect(kesikli(egilimli.svg)).toBeGreaterThan(kesikli(yok.svg));
    expect(egilimli.veri).toEqual(yok.veri);
  });
});

describe("RaporGrafik (ekran)", () => {
  it("boş veride 'Grafik için veri yok' yazar, motoru yüklemez", () => {
    render(<RaporGrafik blok={blok("cizgi", { kategoriler: [] })} />);
    expect(screen.getByText(GRAFIK_VERI_YOK)).toBeInTheDocument();
  });
  it("veri varken erişilebilir grafik kabı çizer", () => {
    render(<RaporGrafik blok={blok("cizgi")} baslik="Günlük sevk" />);
    expect(screen.getByRole("img", { name: "Günlük sevk" })).toBeInTheDocument();
  });
});

describe("grafikVeriTablosu — Excel veri sayfası", () => {
  it("kategori satırı × seri kolonu, boş değer '—', biçim kapalı kümede", () => {
    const t = grafikVeriTablosu(blok("cizgi"), "Günlük sevk");
    expect(t.columns.map((c) => c.header)).toEqual(["Gün", "Bu dönem (m)", "Önceki dönem (m)"]);
    expect(t.rows[2]).toEqual({ k: "03.10.2026", s0: "—", s1: 7000 });
    expect(t.columns.map((c) => c.numFmt)).toEqual([undefined, "#,##0.0", "#,##0"]);
    for (const c of t.columns) if (c.numFmt) expect(REPORT_NUM_FMTS).toContain(c.numFmt);
  });
  it("kutu: grup başına beş değer + kayıt sayısı", () => {
    const t = grafikVeriTablosu(blok("kutu", { seriler: [{ ad: "Gece", veri: [1, 2, 3, 4, 100] }] }), "Dağılım");
    expect(t.rows[0]).toMatchObject({ g: "Gece", k0: 1, k2: 3, k4: 4, n: 5 });
  });
});

describe("paket sözleşmesi [KU-12] [KU-17]", () => {
  const ELECTRON = resolve(__dirname, "../../../../..");
  it("echarts dependencies'te ve TAM SABİT 6.1.0", () => {
    const pkg = JSON.parse(readFileSync(join(ELECTRON, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    // SVG çıktısı PDF'in kendisi: yama sürümü bile kâğıdı değiştirebilir → bilinçli yükseltme.
    expect(pkg.dependencies?.echarts).toBe("6.1.0");
  });
  it("echarts YALNIZ motor.ts'ten statik import edilir; motor yalnız dinamik yüklenir", () => {
    const src = join(ELECTRON, "src");
    const dosyalar: string[] = [];
    const gez = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) gez(p);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) dosyalar.push(p);
      }
    };
    gez(src);
    const statik = dosyalar.filter((p) => /^import (?!type )[^;]*from "echarts(\/[^"]*)?";/m.test(readFileSync(p, "utf8")));
    expect(statik.map((p) => relative(src, p))).toEqual(["pages/Reports/_v2/grafik/motor.ts"]);
    const motorStatik = dosyalar.filter((p) => /from "\.\/motor"/.test(readFileSync(p, "utf8")));
    expect(motorStatik).toEqual([]);
  });
});
