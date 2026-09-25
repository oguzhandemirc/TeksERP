import { describe, expect, it } from "vitest";
import type { SheetColumn } from "@/lib/xlsx-export";
import { buildWorkbook } from "@/lib/xlsx-export";
import { buildSackDumpHtml } from "./dumpHtml";
import { buildSackDumpSheets } from "./dumpSheets";
import { dumpKombinasyonlari, SABIT_AN } from "./__tests__/dumpFixtures";

/**
 * Çuval İçerik Dökümü: PDF (HTML) ile Excel AYNI tabloyu, satırı ve değeri taşır
 * (kullanıcı kuralı 2026-09-25). Fikstürün her kombinasyonunda HTML'deki tablolar
 * DOM'dan okunur ve Excel sayfalarıyla karşılaştırılır — başlık, kolon sırası, her
 * hücre (Excel değeri + sayı biçimi BAĞIMSIZ bir biçimleyiciyle metne çevrilir),
 * toplam satırı, çuval başlık bilgileri, boş çuval metni, kartela tablosu.
 *
 * Negatif sonda (commit mesajında): HTML'e yalnız ona ait bir kolon eklendi → kırmızı;
 * Excel'de kartela tablosu ad rejimini yok saydı → kırmızı.
 */

/** Excel hücresinin görünen metni — `numFmt`i dökümün kendi kodundan bağımsız okur. */
function excelText(v: unknown, numFmt: SheetColumn["numFmt"]): string {
  if (v == null) return "";
  if (typeof v !== "number") return String(v);
  const fmt = typeof numFmt === "function" ? numFmt(v) : numFmt;
  const m = /^(#,##0(?:\.(0)(#*))?|0)(?:"(.*)")?$/.exec(fmt ?? "");
  if (!m) return String(v);
  const body =
    m[1] === "0"
      ? String(v)
      : v.toLocaleString("tr-TR", { minimumFractionDigits: m[2] ? 1 : 0, maximumFractionDigits: m[2] ? 1 + (m[3]?.length ?? 0) : 0 });
  return body + (m[4] ?? "");
}

interface Tbl {
  headers: string[];
  rows: string[][];
  foot: string[] | null;
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function htmlTable(t: Element): Tbl {
  return {
    headers: [...t.querySelectorAll("thead th")].map(text),
    rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map(text)),
    foot: t.querySelector("tfoot tr") ? [...t.querySelectorAll("tfoot td")].map(text) : null,
  };
}

type Kombinasyon = ReturnType<typeof dumpKombinasyonlari>[number];
type ExcelTbl = { columns: Array<Pick<SheetColumn, "header" | "numFmt">>; rows: unknown[][]; foot: unknown[] | null };
type Sheet = ReturnType<typeof buildSackDumpSheets>[number];

const sheetTable = (sh: Sheet): ExcelTbl => {
  const keys = sh.columns.map((c) => c.key);
  return { columns: sh.columns, rows: sh.rows.map((r) => keys.map((key) => r[key])), foot: sh.totalRow ? keys.map((key) => sh.totalRow![key]) : null };
};

/** Bir çuval bölümünü (HTML) çuvalın sayfasıyla (Excel) karşılaştırır; tablo çiftlerini döndürür. */
function sackPairs(el: Element, sh: Sheet): Array<[Tbl, ExcelTbl]> {
  // Başlık bilgileri: PDF "etiket: değer · …" ↔ Excel [etiket, değer] satırları.
  const pre = sh.preamble!.slice(3).filter((r) => r.length === 2 && r[0] !== "Not").map(([l, v]) => `${l}: ${v}`);
  expect(pre.join(" · ")).toBe(text(el.querySelector(".meta")!));
  expect(String(sh.preamble![2]![0])).toBe(text(el.querySelector("h2")!));
  const not = sh.preamble!.find((r) => r[0] === "Not");
  const note = el.querySelector(".note");
  expect(note ? text(note) : null).toBe(not ? `Not: ${not[1]}` : null);

  const pairs: Array<[Tbl, ExcelTbl]> = [];
  const tables = [...el.querySelectorAll(":scope > table")];
  if (tables.length === 0) {
    expect(text(el.querySelector(".empty")!)).toBe(sh.notes?.[0]);
    expect(sh.columns).toHaveLength(0);
  } else {
    pairs.push([htmlTable(tables[0]!), sheetTable(sh)]);
  }
  const sw = el.querySelector(".swatches");
  expect(Boolean(sw)).toBe(Boolean(sh.subTables?.length));
  if (sw) {
    const st = sh.subTables![0]!;
    expect(text(sw.querySelector(".sub")!)).toBe(st.title);
    pairs.push([htmlTable(sw.querySelector("table")!), { columns: st.columns, rows: st.rows, foot: null }]);
  }
  return pairs;
}

/** Kombinasyonun bütün tablo çiftleri — özet + her çuvalın top ve kartela tabloları. */
function tabloCiftleri(k: Kombinasyon): Array<[Tbl, ExcelTbl]> {
  const doc = new DOMParser().parseFromString(buildSackDumpHtml(k.dumps, k.opts, SABIT_AN), "text/html");
  const sheets = buildSackDumpSheets(k.dumps, k.opts, SABIT_AN);
  const summaryEl = doc.querySelector("section.summary table");
  const ozet = sheets.find((s) => s.name === "Özet");
  // Özet: iki çıktıda da ya var ya yok.
  expect(Boolean(summaryEl)).toBe(Boolean(ozet));
  const pairs: Array<[Tbl, ExcelTbl]> = summaryEl && ozet ? [[htmlTable(summaryEl), sheetTable(ozet)]] : [];
  const sackEls = [...doc.querySelectorAll("section.sack")];
  const sackSheets = sheets.filter((s) => s !== ozet);
  expect(sackSheets).toHaveLength(sackEls.length);
  sackEls.forEach((el, i) => pairs.push(...sackPairs(el, sackSheets[i]!)));
  return pairs;
}

describe("Çuval İçerik Dökümü — PDF ↔ Excel eşitliği (her kombinasyon)", () => {
  const kombinasyonlar = dumpKombinasyonlari();
  let tablo = 0;
  let hucre = 0;

  it.each(kombinasyonlar.map((k) => [k.ad, k] as const))("%s", (_ad, k) => {
    for (const [p, x] of tabloCiftleri(k)) {
      tablo++;
      expect(x.columns.map((c) => c.header)).toEqual(p.headers);
      expect(x.rows).toHaveLength(p.rows.length);
      const xRows = x.rows.map((r) => r.map((v, i) => excelText(v, x.columns[i]!.numFmt)));
      hucre += xRows.flat().length;
      expect(xRows).toEqual(p.rows);
      expect(x.foot ? x.foot.map((v, i) => excelText(v, x.columns[i]!.numFmt)) : null).toEqual(p.foot);
    }
  });

  it("körlük zemini: yeterince tablo ve hücre karşılaştırıldı", () => {
    expect(kombinasyonlar.length).toBeGreaterThanOrEqual(18);
    expect(tablo).toBeGreaterThanOrEqual(30);
    expect(hucre).toBeGreaterThanOrEqual(300);
  });
});

/** jsdom'un Blob'unda `arrayBuffer()` yok — FileReader ile okunur. */
const blobBytes = (b: Blob) =>
  new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });

describe("gerçek .xlsx — tam sayıda ondalık ayırıcı yok, kartela aynı sayfada", () => {
  it("40 → '#,##0', 112,35 → '#,##0.0##', en '0\" cm\"' biçimli; kartela tablosu top tablosunun altında", async () => {
    const k = dumpKombinasyonlari().find((x) => x.ad === "tekDolu/ikisi")!;
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobBytes(await buildWorkbook(buildSackDumpSheets(k.dumps, k.opts, SABIT_AN))));
    const ws = wb.worksheets[0]!;
    const rows: Array<{ vals: unknown[]; fmts: string[] }> = [];
    ws.eachRow((r) => rows.push({ vals: (r.values as unknown[]).slice(1), fmts: (r.values as unknown[]).slice(1).map((_, i) => r.getCell(i + 1).numFmt) }));
    const metreRow = rows.find((r) => r.vals.includes(40))!;
    expect(metreRow.fmts[metreRow.vals.indexOf(40)]).toBe("#,##0");
    const kesirli = rows.find((r) => r.vals.includes(112.35))!;
    expect(kesirli.fmts[kesirli.vals.indexOf(112.35)]).toBe("#,##0.0##");
    expect(kesirli.fmts[kesirli.vals.indexOf(330)]).toBe('#,##0" cm"');
    expect(rows.some((r) => r.vals[0] === "KARTELALAR · 2")).toBe(true);
  });
});
