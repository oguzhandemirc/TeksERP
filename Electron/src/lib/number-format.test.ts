import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets, type ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { buildListHtml, buildListSheet, type ExportColumn } from "./list-export";
import {
  REPORT_NUM_FMTS,
  reportCellText,
  reportExcelNumFmt,
  upTo3ExcelNumFmt,
  upTo3Text,
  type ExcelNumFmt,
} from "./number-format";

/**
 * PDF metni = Excel'de GÖRÜNEN metin (kullanıcı kuralı 2026-09-25). Raporlar ve listeler
 * için sayı biçimi tek yardımcıdan (`lib/number-format`) türer; bu dosya her rapor
 * biçimi × tam/kesir/negatif/1000+ değer için iki çıktının metnini karşılaştırır.
 *
 * Excel'in görünümü bağımsız bir ÖYKÜNÜCÜYLE hesaplanır (`excelDisplay`): "." içeren
 * biçimde ayırıcı her zaman basılır — tam sayıda "12," hatasının kaynağı budur.
 *
 * Negatif sonda (commit mesajında): `reportExcelNumFmt` biçimi aynen döndürdü → kırmızı.
 */

/** Excel sayı biçimi öykünücüsü: `[#0,]+` tam kısım, `.` sonrası `0` zorunlu `#` isteğe bağlı hane. */
function excelDisplay(v: number, fmt: string): string {
  const m = /^([#0,]+)(?:\.([0#]*))?(?:"(.*)")?$/.exec(fmt);
  if (!m) throw new Error(`öykünücü tanımıyor: ${fmt}`);
  const grouping = m[1]!.includes(",");
  const frac = m[2];
  const minD = (frac?.match(/0/g) ?? []).length;
  const maxD = frac?.length ?? 0;
  // Excel 15 anlamlı haneyle çalışır ve yarımı sıfırdan uzağa yuvarlar.
  const exact = Number(v.toPrecision(15));
  const scale = 10 ** maxD;
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact) * scale + 1e-9) / scale;
  const [intPart, fracPart = ""] = Math.abs(rounded).toFixed(maxD).split(".");
  let f = fracPart;
  while (f.length > minD && f.endsWith("0")) f = f.slice(0, -1);
  const int = grouping ? intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : intPart!;
  // İşaret ÖZGÜN değerden: Excel sıfıra yuvarlanan negatifi "-0,0" gösterir.
  const sign = exact < 0 ? "-" : "";
  return `${sign}${int}${frac !== undefined ? `,${f}` : ""}${m[3] ?? ""}`;
}

const resolve = (fmt: ExcelNumFmt | undefined, v: unknown): string | undefined =>
  typeof fmt === "function" ? fmt(v) : fmt;

const DEGERLER = [0, 12, -12, 7.5, 1234, -1234.5, 1234567.891, 0.05, 12.345, 112.35, 999.95, -0.004, 100000];

describe("öykünücü Excel'in bilinen davranışını üretir (yoksa ölçüm boştur)", () => {
  it("'#,##0.#' tam sayıda sonda ayırıcı gösterir; '0.0' gruplamaz", () => {
    expect(excelDisplay(12, "#,##0.#")).toBe("12,");
    expect(excelDisplay(1234.5, "0.0")).toBe("1234,5");
    expect(excelDisplay(1234.5, "#,##0.0")).toBe("1.234,5");
    expect(excelDisplay(-0.004, "0.0")).toBe("-0,0");
  });
});

describe("rapor biçimi: PDF metni = Excel görünen metin", () => {
  it("PDF metni SABİT: bugünkü çıktı değişmez", () => {
    expect(reportCellText(12, "#,##0.#")).toBe("12,0");
    expect(reportCellText(1234.5, "0.0")).toBe("1.234,5");
    expect(reportCellText(1234567.891, "#,##0")).toBe("1.234.568");
    expect(reportCellText("—", "#,##0.00")).toBe("—");
  });

  it.each(REPORT_NUM_FMTS.map((f) => [f]))("%s × tam/kesir/negatif/1000+ değerler", (f) => {
    for (const v of DEGERLER) expect(`${v} → ${excelDisplay(v, reportExcelNumFmt(f))}`).toBe(`${v} → ${reportCellText(v, f)}`);
  });
});

describe("liste/döküm biçimi (≤3 hane): PDF metni = Excel görünen metin", () => {
  it.each(DEGERLER.map((v) => [v]))("%s", (v) => {
    expect(excelDisplay(v, resolve(upTo3ExcelNumFmt(), v)!)).toBe(upTo3Text(v));
    expect(excelDisplay(v, resolve(upTo3ExcelNumFmt(" cm"), v)!)).toBe(`${upTo3Text(v)} cm`);
  });
});

/** HTML'den tablo hücre metinleri (satır satır). */
function htmlRows(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("table tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim()));
}

describe("motor uçtan uca: aynı spec'in PDF'i ve Excel'i", () => {
  const spec: ReportExportSpec = {
    title: "Deneme Raporu",
    subtitle: "01.09.2026 – 25.09.2026",
    meta: ["Kapsam: tümü"],
    tables: [
      {
        name: "Tablo",
        columns: [
          { header: "Ad", key: "ad" },
          ...REPORT_NUM_FMTS.map((f, i) => ({ header: `K${i}`, key: `k${i}`, numFmt: f, align: "right" as const })),
          { header: "Biçimsiz", key: "ham" },
        ],
        rows: DEGERLER.map((v, r) => ({ ad: `satır ${r}`, ham: v, ...Object.fromEntries(REPORT_NUM_FMTS.map((_, i) => [`k${i}`, v])) })),
        totalRow: { ad: "TOPLAM", ...Object.fromEntries(REPORT_NUM_FMTS.map((_, i) => [`k${i}`, 99999.99])) },
      },
    ],
  };

  it("rapor: başlık/dönem/meta Excel'in üstünde, kolon + hiza + her hücrenin görünen metni PDF'le aynı", () => {
    const sheet = toSheets(spec)[0]!;
    expect(sheet.preamble).toEqual([["Deneme Raporu"], ["01.09.2026 – 25.09.2026"], ["Kapsam: tümü"]]);
    const pdf = htmlRows(buildReportHtml(spec));
    expect(sheet.columns.map((c) => c.header)).toEqual(pdf[0]);
    expect(sheet.columns.filter((c) => c.align === "right")).toHaveLength(REPORT_NUM_FMTS.length);
    const excelRow = (r: Record<string, unknown>) =>
      sheet.columns.map((c) => {
        const v = r[c.key];
        if (v == null) return "";
        const fmt = resolve(c.numFmt, v);
        return typeof v === "number" && fmt ? excelDisplay(v, fmt) : String(v);
      });
    expect([...sheet.rows, sheet.totalRow!].map(excelRow)).toEqual(pdf.slice(1));
  });

  it("liste: başlık + 'N kayıt' Excel'in üstünde, TOPLAM dahil her sayı PDF'le aynı metin", () => {
    type R = { ad: string; m: number };
    const cols: ExportColumn<R>[] = [
      { label: "Ad", value: (r) => r.ad },
      { label: "Metre", value: (r) => r.m, summable: true },
    ];
    const rows: R[] = DEGERLER.map((m, i) => ({ ad: `s${i}`, m }));
    const sheet = buildListSheet(cols, rows, "Toplar");
    expect(sheet.preamble).toEqual([["Toplar"], [`${rows.length} kayıt`]]);
    const pdf = htmlRows(buildListHtml(cols, rows, "Toplar"));
    const excelRow = (r: Record<string, unknown>) =>
      sheet.columns.map((c) => {
        const v = r[c.key];
        if (v == null) return "";
        const fmt = resolve(c.numFmt, v);
        return typeof v === "number" && fmt ? excelDisplay(v, fmt) : String(v);
      });
    expect([...sheet.rows, sheet.totalRow!].map(excelRow)).toEqual(pdf.slice(1));
    expect(sheet.columns[1]!.align).toBe("right");
  });
});
