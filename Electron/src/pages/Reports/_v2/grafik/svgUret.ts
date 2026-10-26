// Baskı için grafik SVG'si: ECharts DOM'suz SSR (vektör, dış kaynak yok). Genişlik A4
// dikey içerik alanı (210 − 2×12 mm ≈ 180 mm) sabit; renkler baskı paleti.
import type { ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { grafikSecenek, type Egilim } from "./secenek";
import { BASKI_TEMASI } from "./tema";
import type { GrafikBlok } from "../sunum";

/** 180 mm @ 96 dpi. */
export const BASKI_GENISLIK_PX = Math.round((180 * 96) / 25.4);
export const BASKI_YUKSEKLIK_PX = 300;

export async function grafikSvg(
  blok: GrafikBlok,
  boyut: { genislikPx: number; yukseklikPx: number } = { genislikPx: BASKI_GENISLIK_PX, yukseklikPx: BASKI_YUKSEKLIK_PX },
  egilim?: Egilim | null,
): Promise<string> {
  const { echarts } = await import("./motor");
  const grafik = echarts.init(null, null, { renderer: "svg", ssr: true, width: boyut.genislikPx, height: boyut.yukseklikPx });
  try {
    grafik.setOption({ ...grafikSecenek(blok, BASKI_TEMASI, { baski: true, egilim }), animation: false });
    return grafik.renderToSVGString();
  } finally {
    grafik.dispose();
  }
}

/**
 * Spec'teki `svg`siz grafik bloklarını doldurur (PDF/Yazdır anında). Çizilemeyen blok
 * `svg`siz kalır ve belge onun VERİ TABLOSUNU basar — baskı grafik yüzünden düşmez.
 */
export async function grafikleriDoldur(spec: ReportExportSpec): Promise<ReportExportSpec> {
  const bloklar = spec.bloklar;
  if (!bloklar?.some((b) => b.tur === "grafik" && !b.svg && b.grafik)) return spec;
  const dolu = [];
  for (const b of bloklar) {
    if (b.tur !== "grafik" || b.svg || !b.grafik) {
      dolu.push(b);
      continue;
    }
    try {
      dolu.push({ ...b, svg: await grafikSvg(b.grafik, undefined, b.egilim) });
    } catch {
      dolu.push(b);
    }
  }
  return { ...spec, bloklar: dolu };
}
