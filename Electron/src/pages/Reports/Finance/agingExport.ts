// =============================================================================
// CARİ YAŞLANDIRMA — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ Üç çıktı ayrı ayrı YAZILMAZ. Bu projede bir kez "aynı başlık altında farklı
// rakam" yaşandı ve bekçi (`_components/reportExport.test.ts`) kolon kümesi
// eşitliğini MEKANİK doğruluyor: tek `ReportExportSpec`'ten türeyen üç çıktı
// ayrışamaz.
//
// ⚠️ HER PARA BİRİMİ AYRI TABLO (= ayrı Excel sayfası). Tek tabloya katlamak,
// muhasebecinin kolonu seçip toplamasına ve 1.000 USD ile 30.000 TL'yi
// toplamasına davetiye olurdu. Toplam satırı da blok bazındadır.
//
// ⚠️ TL karşılığı YALNIZ `totalsTry` doluysa yazılır. Kur bulunamadığında
// backend `null` döner; oraya 0 yazmak "TL karşılığı sıfır" yalanıdır ve dosya
// elden ele dolaşırken bu yalan düzeltilemez.
//
// ⚠️ Excel hücresine `toNum` ile SAYI konur (string'e `numFmt` uygulanmaz ve
// hücre metne düşer); dönüşüm tek değer üzerindedir, toplama YAPILMAZ.
// =============================================================================

import type { ReportExportSpec, ReportColumn, ReportTableSpec } from "../_components/reportExport";
import { CARI_KIND_LABEL, isZeroAmount, toNum, type AgingCurrencyBlock, type AgingReport } from "./service";

const MONEY = "#,##0.00";

export function buildAgingExport(opts: {
  report: AgingReport;
  /** Ekranda GÖRÜNEN satırlar — blok id'si → satır id kümesi. */
  visibleRowIds: Set<string>;
  asOfLabel: string;
  /** Ekrandaki arama/süzgeç metni; doluysa toplamın kapsamı dipnotla söylenir. */
  filterNote: string | null;
  /** Sunucu süzgeci satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { report, visibleRowIds, asOfLabel, filterNote, filterNotes = [] } = opts;

  const meta = [
    // SUNUCU süzgeci en üstte: bu satırlar raporun KAPSAMINI değiştirir, ekran
    // araması ise yalnız görünen satırları — ikisi ayrı cümlelerle yazılır.
    ...filterNotes,
    `Kesit: ${asOfLabel} itibarıyla açık bakiye (tarih aralığı değil — yaşlandırma birikmiş açığı sorar).`,
    ...report.notes,
  ];
  if (filterNote) {
    // TOPLAM satırı backend'in TÜM carilerden hesapladığı rakamdır; ekranda
    // süzülmüş satırlarla toplanmaz. Bunu yazmazsak dosyayı açan kişi
    // "satırlar toplamı tutmuyor" der ve rapora güveni biter.
    meta.push(`${filterNote} — TOPLAM satırı süzgeçten ETKİLENMEZ, kesitteki TÜM carileri kapsar.`);
  }
  if (report.reconciliation.mismatchedRows > 0) {
    meta.push(
      `⚠️ ${report.reconciliation.mismatchedRows} satırda yaşlandırma ile cari defteri uyuşmuyor — "Fark" kolonuna bakın.`,
    );
  }
  if (report.reconciliation.allocationDriftInvoices > 0 || report.reconciliation.allocationDriftPayments > 0) {
    meta.push(
      `⚠️ Kapama sayaçları sapmış: ${report.reconciliation.allocationDriftInvoices} fatura, ${report.reconciliation.allocationDriftPayments} tahsilat.`,
    );
  }

  return {
    title: "Cari Yaşlandırma",
    subtitle: `${asOfLabel} kesiti`,
    meta,
    tables: report.blocks.map((b) => blockTable(report, b, visibleRowIds)),
  };
}

function blockTable(
  report: AgingReport,
  block: AgingCurrencyBlock,
  visibleRowIds: Set<string>,
): ReportTableSpec {
  const bucketCols: ReportColumn[] = report.buckets.map((b) => ({
    header: b.label,
    key: `b_${b.key}`,
    width: 13,
    numFmt: MONEY,
    align: "right" as const,
  }));

  const columns: ReportColumn[] = [
    { header: "Kod", key: "code", width: 14 },
    { header: "Cari", key: "name", width: 30 },
    { header: "Tür", key: "kind", width: 10 },
    ...bucketCols,
    { header: "Açık toplam", key: "openTotal", width: 15, numFmt: MONEY, align: "right" },
    { header: "Vadesi geçen", key: "overdueTotal", width: 15, numFmt: MONEY, align: "right" },
    { header: "Kapatılmamış tahsilat", key: "unappliedCredit", width: 18, numFmt: MONEY, align: "right" },
    { header: "Sanal mahsup", key: "virtualOffset", width: 14, numFmt: MONEY, align: "right" },
    { header: "En eski gecikme (gün)", key: "oldestDaysOverdue", width: 16, numFmt: "#,##0", align: "right" },
    { header: "Defter bakiyesi", key: "ledgerBalance", width: 15, numFmt: MONEY, align: "right" },
    { header: "Fark", key: "reconDiff", width: 12, numFmt: MONEY, align: "right" },
  ];

  const rows = block.rows
    .filter((r) => visibleRowIds.has(r.cariId))
    .map((r) => {
      const cells: Record<string, unknown> = {
        code: r.code,
        name: r.name,
        kind: CARI_KIND_LABEL[r.kind],
        openTotal: toNum(r.openTotal),
        overdueTotal: toNum(r.overdueTotal),
        unappliedCredit: toNum(r.unappliedCredit),
        virtualOffset: toNum(r.virtualOffset),
        // "Gecikme yok" ile "0 gün gecikmiş" farklıdır: ilkine 0 yazmak, bugün
        // vadesi dolmuş bir faturayla hiç geciken faturası olmayan cariyi aynı
        // gösterirdi.
        oldestDaysOverdue: r.oldestDaysOverdue ?? "",
        ledgerBalance: toNum(r.ledgerBalance),
        reconDiff: toNum(r.reconDiff),
      };
      for (const b of report.buckets) cells[`b_${b.key}`] = toNum(r.net[b.key]);
      return cells;
    });

  const totalRow: Record<string, unknown> = {
    code: "",
    name: "TOPLAM",
    kind: "",
    openTotal: toNum(block.totals.openTotal),
    overdueTotal: toNum(block.totals.overdueTotal),
    unappliedCredit: toNum(block.totals.unappliedCredit),
    virtualOffset: toNum(block.totals.virtualOffset),
    oldestDaysOverdue: "",
    ledgerBalance: toNum(block.totals.ledgerBalance),
    reconDiff: "",
  };
  for (const b of report.buckets) totalRow[`b_${b.key}`] = toNum(block.totals.net[b.key]);

  const notes: string[] = [
    "Kovalar SANAL FIFO mahsup SONRASI değerlerdir (kapatılmamış tahsilat/çek en eski vadeden başlayarak düşülmüştür); deftere hiçbir şey yazılmaz.",
  ];
  if (block.currency !== "TRY") {
    notes.push(
      block.totalsTry && block.tryRate
        ? `TL karşılığı — Açık: ${block.totalsTry.openTotal} · Vadesi geçen: ${block.totalsTry.overdueTotal} (${block.rateDate ?? ""} tarihli ${block.tryRate} kuruyla).`
        : "Rapor günü kuru bulunamadığı için TL karşılığı BASILMADI (uydurma kur kullanılmaz).",
    );
  }
  const drifted = block.rows.filter((r) => !isZeroAmount(r.reconDiff));
  if (drifted.length > 0) {
    notes.push(`⚠️ Bu blokta ${drifted.length} caride "Fark" sıfır değil — rakama güvenmeden önce mutabakatı çözün.`);
  }

  return { name: `Yaşlandırma ${block.currency}`, columns, rows, totalRow, notes };
}
