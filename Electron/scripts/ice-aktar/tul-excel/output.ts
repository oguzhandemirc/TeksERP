// Normalize CSV'ler + hata raporu. Varsayılan: kullanımdaki bir satırında bulgu olan desen/iplik
// satırı CSV'ye YAZILMAZ (teyitsiz değer maliyeti yanlış kurar — §9.9); `acceptCorrections` önerileni yazar.
import { nominalDenier, round } from "./cells.ts";
import type { ConversionResult, CostYarnLine, DesignSheet, ReportRow, WeftLine, YarnRow } from "./types.ts";

export type CsvTable = { header: string[]; rows: (string | number | null)[][] };

/** Formül enjeksiyonu seddi (belge-etiket.md, panel `csvCell` ile aynı kural): metin önekli, sayı öneksiz. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function quote(v: string | number | null): string {
  if (v === null) return "";
  const s = typeof v === "string" && FORMULA_LEAD.test(v) ? `'${v}` : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM + ";" ayraç: Türkçe Excel doğrudan açar, panel ayrıştırıcısı ayraç sezer. */
export function toCsv(t: CsvTable): string {
  return "﻿" + [t.header, ...t.rows].map((r) => r.map(quote).join(";")).join("\r\n") + "\r\n";
}

const key = (file: string, sheet: string, cell: string) => `${file}\u0000${sheet}\u0000${cell}`;

function index(report: ReportRow[]) {
  const byCell = new Map<string, ReportRow[]>();
  const blockedSheets = new Set<string>();
  for (const r of report) {
    const k = key(r.file, r.sheet, r.cell);
    byCell.set(k, [...(byCell.get(k) ?? []), r]);
    if (r.inUse) blockedSheets.add(`${r.file}\u0000${r.sheet}`);
  }
  return { byCell, blockedSheets };
}

type Index = ReturnType<typeof index>;

function suggestion(ix: Index, y: { file: string; sheet: string }, cell: string, cls: ReportRow["errorClass"]) {
  const hit = (ix.byCell.get(key(y.file, y.sheet, cell)) ?? []).find((r) => r.errorClass === cls);
  return hit ? Number(hit.suggested) : null;
}

/** Gramaj: miktar × en × denye ÷ 9000; düzeltme kabulünde en ve metredeki atkı önerilenle. */
function yarnColumns(ix: Index, y: YarnRow, quantity: number | null, accept: boolean) {
  const f = y.formula;
  const width = accept ? suggestion(ix, y, y.gramCell, "EN_TUTARSIZ") ?? f?.width ?? null : f?.width ?? null;
  const nominal = nominalDenier(y.yarnName);
  const inflated = f && nominal !== null && f.denier > nominal ? round((1 - nominal / f.denier) * 100, 2) : null;
  const grams = f && quantity !== null ? round((quantity * (width ?? 1) * f.denier) / 9000, 4) : null;
  return { width, denier: f?.denier ?? null, nominal, inflated, grams };
}

function weftRow(ix: Index, d: DesignSheet, w: WeftLine, accept: boolean) {
  const picks = accept ? suggestion(ix, w, w.picksCell, "SIKLIK_RAPOR_TUTMUYOR") ?? w.picksPerMeter : w.picksPerMeter;
  const c = yarnColumns(ix, w, picks, accept);
  return [d.designNo, w.order, w.yarnName, w.repeatCount, picks, c.width, c.denier, c.nominal, c.inflated, w.gramExcel, c.grams, d.sheet, w.row];
}

function costRow(ix: Index, l: CostYarnLine, accept: boolean) {
  const c = yarnColumns(ix, l, l.warpEnds ?? l.picksPerMeter, accept);
  const kind = l.warpEnds !== null && l.warpEnds > 0 ? "ÇÖZGÜ" : "ATKI";
  return [l.sheet, l.row, l.yarnName, kind, l.warpEnds, l.picksPerMeter, c.width, c.denier, c.nominal, c.inflated, l.priceUsdKg, l.gramExcel, c.grams];
}

export interface OutputFiles {
  files: Record<string, CsvTable>;
  excluded: { file: string; sheet: string; reason: string }[];
}

export function buildOutputs(result: ConversionResult, designFile: string, accept: boolean): OutputFiles {
  const ix = index(result.report);
  const excluded: OutputFiles["excluded"] = [];
  const designs = result.designs.filter((d) => {
    const blocked = !accept && ix.blockedSheets.has(`${designFile}\u0000${d.sheet}`);
    if (blocked) excluded.push({ file: designFile, sheet: d.sheet, reason: "teyitsiz bulgu (hata-raporu.csv)" });
    return !blocked;
  });
  const costLines = result.costSheets.flatMap((s) => s.lines.filter((l) => l.inUse));
  const keptCost = costLines.filter((l) => {
    const blocked = !accept && result.report.some((r) => r.inUse && r.file === l.file && r.sheet === l.sheet && rowOf(r.cell) === l.row);
    if (blocked) excluded.push({ file: l.file, sheet: l.sheet, reason: `satır ${l.row} (${l.yarnName}): teyitsiz bulgu` });
    return !blocked;
  });
  const files: Record<string, CsvTable> = {
    "desenler.csv": {
      header: ["desenNo", "desenTuru", "desenBoyuCm", "atkiSikligi", "ortalamaSiklik", "weftNo", "dobbyNo", "maliyetUsd", "maliyetNotu", "atkiEslemesi", "atkiSirasi", "armurPlani", "armurDurumu", "sayfa"],
      rows: designs.map((d) => [
        d.designNo, d.designType,
        accept ? suggestion(ix, { file: designFile, sheet: d.sheet }, d.repeatCell, "SIKLIK_RAPOR_TUTMUYOR") ?? d.repeatCm : d.repeatCm,
        d.density, d.averageDensity, d.weftNo, d.dobbyNo, d.costUsd, d.costNote,
        Object.entries(d.weftMap).map(([k, v]) => `${k}=${v}`).join("|"), d.weftSequence, d.liftPlan,
        d.liftPlan === "" ? "OKUNAMADI" : "OKUNDU", d.sheet,
      ]),
    },
    "desen-atkilari.csv": {
      header: ["desenNo", "sira", "iplik", "rapordakiAtki", "metredekiAtki", "enM", "denyeExcel", "nominalDenye", "sisirmeFirePct", "gramajExcel", "gramajHesap", "sayfa", "satir"],
      rows: designs.flatMap((d) => d.wefts.filter((w) => w.inUse).map((w) => weftRow(ix, d, w, accept))),
    },
    "varyantlar.csv": {
      header: ["desenNo", "varyantKodu", "sim", "boyaProsesi", "simIplikKodu"],
      rows: designs.flatMap((d) => d.variants.map((v) => [d.designNo, v.code, v.metallic, v.dyeProcess, v.metallicYarnCode])),
    },
    "maliyet-iplikleri.csv": {
      header: ["sayfa", "satir", "iplik", "tur", "cozguTel", "metredeAtki", "enM", "denyeExcel", "nominalDenye", "sisirmeFirePct", "fiyatUsdKg", "gramajExcel", "gramajHesap"],
      rows: keptCost.map((l) => costRow(ix, l, accept)),
    },
    "maliyet-ozet.csv": {
      header: ["sayfa", "dokumaFasonCent", "iplikUsdM", "dokumaUsdM", "apreBoyaUsdM", "kursunTamburUsdM", "devereUsdM", "toplamUsdM", "payliToplamUsdM"],
      rows: result.costSheets.map((s) => [
        s.sheet, s.weavingRateCent, s.summary["İPLİK MALİYETİ"] ?? null, s.summary["DOKUMA"] ?? null, s.summary["APRE-BOYA"] ?? null,
        s.summary["KURŞUN-TANBUR"] ?? null, s.summary["DEVERE"] ?? null, s.summary["TOPLAM MALİYET"] ?? null, s.summary["TOPLAM"] ?? null,
      ]),
    },
    "hata-raporu.csv": {
      header: ["sinif", "dosya", "sayfa", "hucre", "excelDegeri", "onerilen", "aciklama", "kullanimda"],
      rows: result.report.map((r) => [r.errorClass, r.file, r.sheet, r.cell, r.excelValue, r.suggested, r.note, r.inUse ? "EVET" : "HAYIR"]),
    },
  };
  files["yuklenmeyenler.csv"] = { header: ["dosya", "sayfa", "neden"], rows: excluded.map((e) => [e.file, e.sheet, e.reason]) };
  return { files, excluded };
}

function rowOf(cell: string): number {
  return Number(/\d+$/.exec(cell)?.[0] ?? 0);
}
