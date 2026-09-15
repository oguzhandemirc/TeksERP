// =============================================================================
// KDV DÖNEM ÖZETİ — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ İKİ TABLO, İKİ BLOK: "Satış KDV" (SALES + SALES_RETURN) ve "Alış KDV"
// (PURCHASE + PURCHASE_RETURN). İade satırları kendi bloklarında GÖRÜNÜR;
// para birimi ara toplam satırı ve TL genel toplam NET (ileri − iade) yazar —
// muhasebeci iki rakamı da ister, netleştirmeyi rapor yapar ama iadeyi gizlemez.
//
// ⚠️ TL matrah/KDV/tevkifat SÜTUNLARI YALNIZ backend'in verdiği alanlardan
// dolar (satır TL'leri + blok `totalsTry.net*`). Para birimi ARA TOPLAM
// satırının TL matrah/KDV hücreleri BOŞ bırakılır: backend o kırılımı
// vermiyor ve istemcinin string tutarları toplaması yasak (kuruş kaydırır) —
// boş hücre, uydurma toplamdan iyidir. TL "Toplam" kolonu ise her seviyede
// doludur (satır `totalTry`, ara toplam `net.grandTry`, genelde `net`).
//
// ⚠️ 11 kolon → `orientation: "landscape"` (çek portföyü emsali). Excel
// etkilenmez; PDF/Yazdır yatay basar.
//
// ⚠️ `reconDiff` "0.00" değilse NOT olarak dosyaya düşer — rakamla aynı
// dosyada dursun (SheetSpec.notes ilkesi); sessizce doğru varsayılmaz.
// =============================================================================

import type { ReportColumn, ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { toNum } from "./service";
import { vatRateLabel, vatRowKindLabel, type VatBlock, type VatSummaryReport } from "./vatService";

const MONEY = "#,##0.00";

const COLUMNS: ReportColumn[] = [
  { header: "Para", key: "currency", width: 7 },
  { header: "Tür", key: "kind", width: 14 },
  { header: "KDV Oranı", key: "rate", width: 10 },
  { header: "Belge", key: "docCount", width: 8, numFmt: "#,##0", align: "right" },
  { header: "Matrah", key: "base", width: 14, numFmt: MONEY, align: "right" },
  { header: "KDV", key: "vat", width: 13, numFmt: MONEY, align: "right" },
  { header: "Tevkifat", key: "withholding", width: 12, numFmt: MONEY, align: "right" },
  { header: "Matrah (TL)", key: "baseTry", width: 14, numFmt: MONEY, align: "right" },
  { header: "KDV (TL)", key: "vatTry", width: 13, numFmt: MONEY, align: "right" },
  { header: "Tevkifat (TL)", key: "withholdingTry", width: 12, numFmt: MONEY, align: "right" },
  { header: "Toplam (TL)", key: "totalTry", width: 14, numFmt: MONEY, align: "right" },
];

export function buildVatSummaryExport(opts: {
  report: VatSummaryReport;
  periodLabel: string;
  /** Süzgeç satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { report, periodLabel, filterNotes = [] } = opts;
  return {
    title: "KDV Dönem Özeti",
    subtitle: periodLabel,
    meta: [...filterNotes, `Dönem: ${periodLabel}`, ...report.notes],
    orientation: "landscape",
    tables: [blockTable("Satış KDV", report.sales), blockTable("Alış KDV", report.purchase)],
  };
}

function blockTable(name: string, block: VatBlock): ReportTableSpec {
  const rows: Array<Record<string, unknown>> = [];

  for (const cur of block.currencies) {
    for (const r of cur.rows) {
      rows.push({
        currency: cur.currency,
        kind: vatRowKindLabel(block.kind, r.isReturn),
        rate: vatRateLabel(r.vatRate),
        docCount: r.docCount,
        base: toNum(r.base),
        vat: toNum(r.vat),
        withholding: toNum(r.withholding),
        baseTry: toNum(r.baseTry),
        vatTry: toNum(r.vatTry),
        withholdingTry: toNum(r.withholdingTry),
        totalTry: toNum(r.totalTry),
      });
    }
    // Para birimi ARA TOPLAMI — NET (ileri − iade), belge para biriminde.
    // TL matrah/KDV/tevkifat hücreleri bilinçli BOŞ (başlıktaki gerekçe).
    rows.push({
      currency: cur.currency,
      kind: `ARA TOPLAM (net${cur.returns ? ", iade düşülmüş" : ""})`,
      rate: "",
      docCount: cur.forward.docCount + (cur.returns?.docCount ?? 0),
      base: toNum(cur.net.base),
      vat: toNum(cur.net.vat),
      withholding: toNum(cur.net.withholding),
      baseTry: "",
      vatTry: "",
      withholdingTry: "",
      totalTry: toNum(cur.net.grandTry),
    });
  }

  const notes = [
    `İleri belgeler TL toplamı: ${block.totalsTry.forward} — iade belgeleri TL toplamı: ${block.totalsTry.returns} (genel toplam nettir).`,
  ];
  if (block.totalsTry.reconDiff !== "0.00") {
    notes.push(
      `⚠️ MUTABAKAT SAPMASI: oran satırlarının TL toplamı, belge TL toplamından ${block.totalsTry.reconDiff} TL ayrışıyor — dağıtım hatası, bu dosyaya güvenmeden önce inceleyin.`,
    );
  }

  return {
    name,
    columns: COLUMNS,
    rows,
    totalRow: {
      currency: "",
      kind: "TL GENEL TOPLAM (net)",
      rate: "",
      docCount: block.docCount,
      base: "",
      vat: "",
      withholding: "",
      baseTry: toNum(block.totalsTry.netBase),
      vatTry: toNum(block.totalsTry.netVat),
      withholdingTry: toNum(block.totalsTry.netWithholding),
      totalTry: toNum(block.totalsTry.net),
    },
    notes,
  };
}
