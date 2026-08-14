// =============================================================================
// KUR FARKI RAPORU — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ İKİ TABLO, İKİ SORU: "Kur Farkı Satırları" hangi KAPAMANIN ne kadar fark
// doğurduğunu (denetim izi), "Para Birimi Kırılımı" ise farkın hangi dövizden
// geldiğini söyler. İkincisi birincinin özeti gibi görünse de ayrı bir sorudur
// ve muhasebeci genelde önce ona bakar.
//
// ⚠️ FX "Tutar" KOLONUNUN TOPLAM HÜCRESİ BİLİNÇLİ BOŞ. İki gerekçe üst üste:
// (a) backend o toplamı vermiyor, (b) istemci string tutarları TOPLAMAZ (kuruş
// kaydırır — `service.ts` başlığı). Üstelik satırlar çok para birimli olabilir
// ve USD + EUR toplamı zaten anlamsızdır. Boş hücre, uydurma toplamdan iyidir
// (`vatExport` ile birebir aynı karar). TOPLANABİLEN tek kolon TL kur farkıdır
// ve onun değeri de İSTEMCİDE HESAPLANMAZ — `summary.netTry`'den okunur.
//
// ⚠️ SÜZGEÇLER SUNUCU TARAFINDA (cari + para birimi backend'e gider), yani
// dosyadaki satırlar ekrandakilerle BİREBİR aynıdır. Yine de kapsam `meta`ya
// YAZILIR: filtreli bir dosya, filtresi görünmeden paylaşıldığında "kur farkımız
// bu kadarmış" diye okunur.
//
// ⚠️ 11 kolon → `orientation: "landscape"` (çek portföyü / KDV emsali). Excel
// etkilenmez; PDF/Yazdır yatay basar.
// =============================================================================

import type { ReportColumn, ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { fmtDateTime } from "../_components/formatters";
import { toNum } from "./service";
import {
  FX_DIFF_NOTES,
  invoiceTypeLabel,
  type FxDiffReport,
} from "./fxDiffService";

const MONEY = "#,##0.00";
const COUNT = "#,##0";
/** Kur 4 hane — 2 haneye yuvarlamak raporun ölçtüğü farkı görünmez yapardı. */
const RATE = "#,##0.0000";

/**
 * ⚠️ BAŞLIKLAR EKRANDAKİ `<thead>` İLE BİREBİR AYNI YAZILIR. Bekçi
 * (`fxDiffExport.test.ts` §2) ekranın başlıklarını KAYNAKTAN okuyup burada
 * arıyor: ekranda görünüp dosyada olmayan bir kolon "aynı rapor, eksik dosya"
 * demektir.
 */
const ROW_COLUMNS: ReportColumn[] = [
  { header: "Kapama", key: "at", width: 17 },
  { header: "Cari", key: "cari", width: 28 },
  { header: "Fatura No", key: "docNo", width: 16 },
  { header: "Tür", key: "type", width: 14 },
  { header: "Para", key: "currency", width: 7 },
  { header: "Fatura Kuru", key: "invoiceRate", width: 12, numFmt: RATE, align: "right" },
  { header: "Kaynak", key: "sourceLabel", width: 18 },
  { header: "Kaynak No", key: "sourceNo", width: 16 },
  { header: "Kaynak Kuru", key: "sourceRate", width: 12, numFmt: RATE, align: "right" },
  { header: "Tutar", key: "amount", width: 14, numFmt: MONEY, align: "right" },
  { header: "Kur Farkı (TL)", key: "diffTry", width: 15, numFmt: MONEY, align: "right" },
];

const CURRENCY_COLUMNS: ReportColumn[] = [
  { header: "Para", key: "currency", width: 8 },
  { header: "Kapama", key: "count", width: 10, numFmt: COUNT, align: "right" },
  { header: "Lehte (TL)", key: "gain", width: 15, numFmt: MONEY, align: "right" },
  { header: "Aleyhte (TL)", key: "loss", width: 15, numFmt: MONEY, align: "right" },
  { header: "Net (TL)", key: "net", width: 15, numFmt: MONEY, align: "right" },
];

export function buildFxDiffExport(opts: {
  report: FxDiffReport;
  periodLabel: string;
  /** Aktif süzgeçlerin insan diliyle özeti — kapsam dosyanın İÇİNDE dursun. */
  scopeLines?: string[];
}): ReportExportSpec {
  const { report, periodLabel, scopeLines = [] } = opts;
  return {
    title: "Kur Farkı Raporu",
    subtitle: periodLabel,
    meta: [`Dönem (kapama tarihi): ${periodLabel}`, ...scopeLines, ...FX_DIFF_NOTES],
    orientation: "landscape",
    tables: [rowTable(report), currencyTable(report)],
  };
}

function rowTable(report: FxDiffReport): ReportTableSpec {
  return {
    name: "Kur Farkı Satırları",
    columns: ROW_COLUMNS,
    rows: report.rows.map((r) => ({
      at: fmtDateTime(r.allocatedAt),
      cari: r.cari.name,
      docNo: r.invoice.docNo,
      type: invoiceTypeLabel(r.invoice.type),
      currency: r.invoice.currency,
      invoiceRate: toNum(r.invoice.exchangeRate),
      sourceLabel: r.source.label,
      sourceNo: r.source.docNo,
      sourceRate: toNum(r.source.exchangeRate),
      amount: toNum(r.amount),
      // İŞARET KORUNUR: aleyhte satır dosyada da NEGATİF durur. Mutlak değere
      // çevirip "Aleyhte" diye bir kolon açmak, Excel'de toplanan sütunu
      // bozardı (net = Σ satır).
      diffTry: toNum(r.signedDiffTry),
    })),
    // Satır YOKKEN toplam basılmaz: "TOPLAM 0", veri gelmemesini sıfır diye
    // okutur (`chequeDueExport` ile aynı kural).
    totalRow:
      report.rows.length > 0
        ? {
            at: "TOPLAM (net)",
            cari: "",
            docNo: "",
            type: "",
            currency: "",
            invoiceRate: "",
            sourceLabel: "",
            sourceNo: "",
            sourceRate: "",
            // ⚠️ BOŞ — dosya başlığındaki iki gerekçe (backend vermiyor +
            // istemci toplamaz + çok para birimli toplam anlamsız).
            amount: "",
            diffTry: toNum(report.summary.netTry),
          }
        : undefined,
    notes: [
      "“Kur Farkı (TL)” pozitifse LEHTE (kambiyo kârı), negatifse ALEYHTE (kambiyo zararı). Yön faturanın defter tarafından çözülür.",
      "“Tutar” faturanın PARA BİRİMİNDEDİR ve toplam satırında BİLİNÇLİ olarak boştur — farklı dövizlerin toplamı anlamsız olurdu.",
      "Toplam satırındaki TL farkı özet rakamıdır (lehte − aleyhte); satırların toplamına birebir eşittir.",
    ],
  };
}

function currencyTable(report: FxDiffReport): ReportTableSpec {
  const s = report.summary;
  return {
    name: "Para Birimi Kırılımı",
    columns: CURRENCY_COLUMNS,
    rows: s.byCurrency.map((c) => ({
      currency: c.currency,
      count: c.count,
      gain: toNum(c.gainTry),
      loss: toNum(c.lossTry),
      net: toNum(c.netTry),
    })),
    // ⚠️ TOPLAM SATIRININ HER HÜCRESİ BACKEND'DEN. Kırılım satırlarını burada
    // toplamak cazip ama yasak: string tutarların float toplamı kuruş kaydırır
    // ve o kuruş tam da "ekrandaki toplam tutmuyor" şikâyeti olarak döner.
    totalRow:
      s.byCurrency.length > 0
        ? {
            currency: "TOPLAM",
            count: s.count,
            gain: toNum(s.gainTry),
            loss: toNum(s.lossTry),
            net: toNum(s.netTry),
          }
        : undefined,
    notes: [
      "“Aleyhte” POZİTİF bir sayıdır (zararın büyüklüğü); net = lehte − aleyhte.",
      "TL karşılıkları her belgenin KENDİ kur damgasıyla hesaplanır; bugünkü kurla yeniden çevrim yapılmaz.",
    ],
  };
}
