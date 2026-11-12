// EMANET EKSTRESİ — TEK MODEL → ekran tabloları + Excel + PDF + Yazdır (genel fason P1).
// Ekran tablosu da bu dosyanın kolon/satır kurucularını çizer: dosya ile ekran aynı başlığı, aynı haneyi basar
// (PDF = Excel, `raporlar.md` "TEK SPEC → ÜÇ ÇIKTI"). Hiçbir toplam burada hesaplanmaz — hepsi sunucunun rakamı.
import type { ReportColumn, ReportExportSpec, ReportTableSpec } from "@/pages/Reports/_components/reportExport";
import { fmtDayKey, fmtFactoryTime } from "@/lib/factory-time";
import { reportCellText } from "@/lib/number-format";
import type { ConsignedStatement, StatementKind, StatementLine, StatementSection } from "./types";

export const KIND_LABEL: Record<StatementKind, string> = { ROLL: "Top", YARN_LOT: "İplik lotu", WARP_BEAM: "Levent" };
const SUBJECT_HEADER: Record<StatementKind, string> = { ROLL: "Barkod", YARN_LOT: "Lot no", WARP_BEAM: "Levent no" };
const ITEM_HEADER: Record<StatementKind, string> = { ROLL: "Kumaş", YARN_LOT: "İplik", WARP_BEAM: "Çözgü kartı" };

const DOC_LABEL: Record<string, string> = {
  SHIPMENT: "Sevkiyat",
  RETURN: "İade",
  GOODS_RECEIPT: "Mal kabul",
  STOCK_COUNT: "Sayım",
  DIRECT_SHIPMENT: "Doğrudan sevk",
  INVOICE: "Fatura",
  SUBCONTRACTOR_DISPATCH: "Fason sevk",
  WARP_BEAM: "Levent",
};

/** Bölüm dışı kalma sebebi — ekranda ve dosyada aynı cümle. */
export function omittedText(o: ConsignedStatement["omitted"][number]): string {
  const what = KIND_LABEL[o.kind];
  return o.reason === "MODULE_DISABLED"
    ? `${what} bölümü gösterilmiyor: ilgili modül bu kurulumda kapalı.`
    : `${what} bölümü gösterilmiyor: bu bölümü görme yetkiniz yok (${o.kind === "YARN_LOT" ? "depo okuma" : "levent okuma"} izni).`;
}

const QTY_FMT_M = "0.0";
const QTY_FMT_KG = "0.0"; // emanet iplik kg tek hane (kullanıcı kararı 2026-11-12; F2'nin iki hanesi geçersiz), grupsuz
export const qtyFmt = (unit: StatementSection["unit"]) => (unit === "kg" ? QTY_FMT_KG : QTY_FMT_M);
// Kolon biçimi koşullu yayılımla: `reportNumFmt` bekçisi her `numFmt:` değerini kümeye bağlı sabite çözebilmeli.
const qtyCol = (unit: StatementSection["unit"]) => (unit === "kg" ? { numFmt: QTY_FMT_KG } : { numFmt: QTY_FMT_M });

/** DSK yalnız top bölümünde anlamlı (iplik/levent etiketi "—") — kolon orada hiç çizilmez. */
const hasDsk = (s: StatementSection) => s.columnLabels.DSK !== "—";

export function sectionSections(st: ConsignedStatement): StatementSection[] {
  return [st.rolls, st.yarnLots, st.warpBeams].filter((s): s is StatementSection => s !== null);
}

export function subjectColumns(s: StatementSection): ReportColumn[] {
  const num = (header: string, key: string): ReportColumn => ({ header: `${header} (${s.unit})`, key, width: 14, ...qtyCol(s.unit), align: "right" });
  return [
    { header: SUBJECT_HEADER[s.kind], key: "label", width: 18 },
    { header: ITEM_HEADER[s.kind], key: "itemName", width: 24 },
    num("Açılış", "opening"),
    num(s.columnLabels.IN, "in"),
    num(s.columnLabels.OUT, "out"),
    ...(hasDsk(s) ? [num(s.columnLabels.DSK, "dsk")] : []),
    num(s.columnLabels.SCRAP, "scrap"),
    num("Kalan", "closing"),
  ];
}

export function subjectRows(s: StatementSection): Array<Record<string, unknown>> {
  return s.subjects.map((x) => ({ ...x, label: x.label ?? "—", itemName: x.itemName ?? "—" }));
}

export function subjectTotalRow(s: StatementSection): Record<string, unknown> {
  return { label: "TOPLAM", itemName: "", ...s.totals };
}

export function lineColumns(s: StatementSection): ReportColumn[] {
  return [
    { header: "Gün", key: "dayText", width: 12 },
    { header: "Saat", key: "time", width: 8 },
    { header: SUBJECT_HEADER[s.kind], key: "subject", width: 18 },
    { header: "Hareket", key: "columnLabel", width: 22 },
    { header: `Miktar (${s.unit})`, key: "qty", width: 13, ...qtyCol(s.unit), align: "right" },
    { header: `Kalana etkisi (${s.unit})`, key: "effect", width: 15, ...qtyCol(s.unit), align: "right" },
    { header: "Belge", key: "documentText", width: 22 },
  ];
}

export function lineRow(s: StatementSection, l: StatementLine): Record<string, unknown> {
  const doc = l.document ? `${DOC_LABEL[l.document.type] ?? l.document.type}${l.document.no ? ` ${l.document.no}` : ""}` : "—";
  return {
    dayText: fmtDayKey(l.day),
    time: fmtFactoryTime(l.at),
    subject: l.subjectLabel ?? "—",
    columnLabel: `${s.columnLabels[l.column]}${l.reversal ? " — storno" : ""}`,
    qty: l.qty,
    effect: l.effect,
    documentText: doc,
  };
}

/** Bölüm özet cümlesi — ekran şeridi ve dosya notu aynı metin. */
export function sectionSummaryText(s: StatementSection): string {
  const t = s.totals;
  const f = (n: number) => `${reportCellText(n, qtyFmt(s.unit))} ${s.unit}`;
  const parts = [`Açılış ${f(t.opening)}`, `${s.columnLabels.IN} ${f(t.in)}`, `${s.columnLabels.OUT} ${f(t.out)}`];
  if (hasDsk(s)) parts.push(`${s.columnLabels.DSK} ${f(t.dsk)}`);
  parts.push(`${s.columnLabels.SCRAP} ${f(t.scrap)}`, `Kalan ${f(t.closing)}`);
  return parts.join(" · ");
}

/** Mutabakat tuttuysa olumlu cümle; tutmadıysa null — fark cümlesini sunucu `warnings`te yollar (iki kez basılmasın). */
export function reconciliationText(st: ConsignedStatement): string | null {
  const r = st.reconciliation?.rolls;
  if (!r || Math.abs(r.diffQty) > 0.01) return null;
  return `Top kalanı canlı içerideki emanet metresiyle (${reportCellText(r.liveQty, qtyFmt("m"))} m) tutuyor.`;
}

function sectionTables(s: StatementSection): ReportTableSpec[] {
  const name = KIND_LABEL[s.kind];
  return [
    {
      name: `${name} Özeti`,
      columns: subjectColumns(s),
      rows: subjectRows(s),
      totalRow: subjectTotalRow(s),
      notes: [`Kapsam: ${s.scope}.`, sectionSummaryText(s)],
    },
    { name: `${name} Hareketleri`, columns: lineColumns(s), rows: s.lines.map((l) => lineRow(s, l)) },
  ];
}

export function buildConsignedStatementExport(st: ConsignedStatement, warnings: readonly string[] = []): ReportExportSpec {
  const c = st.customer;
  const recon = reconciliationText(st);
  return {
    title: `Emanet Ekstresi — ${c.name}${c.code ? ` (${c.code})` : ""}`,
    subtitle: `${fmtDayKey(st.period.from)} – ${fmtDayKey(st.period.to)}`,
    orientation: "landscape",
    meta: [
      "Müşterinin bize bıraktığı malın dönem mutabakatı: açılış + giren − çıkan − doğrudan sevk − fire = kalan.",
      "Sevk rakamı BRÜTtür; iptal edilen kayıt silinmez, kendi gününde ayrı \"storno\" satırıyla terslenir. Günler fabrika günüdür.",
      ...st.omitted.map(omittedText),
      ...(recon ? [recon] : []),
      ...warnings,
    ],
    tables: sectionSections(st).flatMap(sectionTables),
  };
}
