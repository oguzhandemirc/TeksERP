// Grafiğin VERİ TABLOSU — Excel'de grafik yerine bu sayfa, PDF'te SVG çizilemezse bu tablo.
// Biçimler `REPORT_NUM_FMTS` kümesinden (PDF metni = Excel görünümü).
import type { ReportColumn, ReportTableSpec } from "@/pages/Reports/_components/reportExport";
import { kategoriEtiketi, kutuIstatistigi, sonlu, unitText } from "./bicim";
import type { GrafikBlok } from "../sunum";

/** Hepsi tam sayıysa ondalıksız, değilse tek hane; literal yazılır ki biçim bekçisi okuyabilsin. */
function bicim(values: unknown[]): Pick<ReportColumn, "numFmt"> {
  return values.filter(sonlu).every((v) => Number.isInteger(v)) ? { numFmt: "#,##0" } : { numFmt: "#,##0.0" };
}

export function grafikVeriTablosu(blok: GrafikBlok, ad: string): ReportTableSpec {
  const birim = unitText(blok.eksen.y.birim);
  const ek = birim ? ` (${birim})` : "";
  if (blok.tur === "kutu") {
    const ist = blok.seriler.map((s) => kutuIstatistigi(s.veri));
    const fmt = bicim(ist.flatMap((k) => k?.kutu ?? []));
    const headers = ["En küçük", "Alt çeyrek", "Orta değer", "Üst çeyrek", "En büyük"];
    return {
      name: ad,
      columns: [
        { header: blok.eksen.x.ad || "Grup", key: "g" },
        ...headers.map((h, i) => ({ header: `${h}${ek}`, key: `k${i}`, ...fmt, align: "right" as const })),
        { header: "Kayıt sayısı", key: "n", numFmt: "#,##0", align: "right" as const },
      ],
      rows: blok.seriler.map((s, j) => ({
        g: s.ad,
        ...Object.fromEntries(headers.map((_, i) => [`k${i}`, ist[j]?.kutu[i] ?? "—"])),
        n: s.veri.filter(sonlu).length,
      })),
    };
  }
  return {
    name: ad,
    columns: [
      { header: blok.eksen.x.ad, key: "k" },
      ...blok.seriler.map((s, i) => ({ header: `${s.ad}${ek}`, key: `s${i}`, ...bicim(s.veri), align: "right" as const })),
    ],
    rows: blok.kategoriler.map((k, j) => ({
      k: kategoriEtiketi(k, blok.eksen.x.tur),
      ...Object.fromEntries(blok.seriler.map((s, i) => [`s${i}`, sonlu(s.veri[j]) ? s.veri[j] : "—"])),
    })),
  };
}
