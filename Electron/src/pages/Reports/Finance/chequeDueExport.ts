// =============================================================================
// ÇEK VADE TAKVİMİ — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ ÜÇ TABLO, ÜÇ SORU: "Vade Kovaları" portföyün TAMAMINI (pencereden bağımsız),
// "Haftalık" ve "Aylık" ise yalnız SEÇİLEN PENCEREYİ anlatır. Kova tablosunu
// pencereye kısmak ya da takvimi portföyün tamamına açmak, dosyayı açan kişiye
// hangi soruya baktığını sormadan cevap verirdi — bu yüzden pencere hem alt
// başlıkta hem her tablonun notunda YAZILI.
//
// ⚠️ PARA BİRİMİ AYRI KOLONDUR ve satırlar birim bazında ayrışır. "TOPLAM"
// satırı YALNIZ tek para birimi kaldığında yazılır: farklı birimleri toplamak
// "önümüzdeki ay 1,2 milyon girecek" gibi bir yalan üretir (`cashBookExport`
// ve `chequeExport` ile aynı karar).
//
// ⚠️ NET (giren − çıkan) yalnız AYNI para biriminde hesaplanır ve satırla
// birlikte gelir — `foldCalendar` ekranla PAYLAŞILIR, burada yeniden
// hesaplanmaz. İkinci bir hesap, aynı haftanın Excel'de ve ekranda farklı
// çıkması demekti.
//
// ⚠️ YÖN KOLONU DEĞİL, YÖN SÜTUNLARI: her dönem satırında "Tahsil edilecek" ve
// "Ödenecek" yan yana durur. Yönü satıra taşımak (her hafta iki satır) net
// kolonunu imkânsız yapardı ve dosyayı açan kişi ikisini elle eşleştirirdi.
//
// ⚠️ `orientation: "landscape"` — dokuz kolonun dördü para taşıyor; dikey A4'te
// tutar hücreleri sarıyordu (spec seviyesinde ayar, Excel'i ETKİLEMEZ).
// =============================================================================

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { KIND_LABEL } from "@/pages/Finance/Cheques/labels";
import { toNum } from "./service";
import {
  DUE_BUCKET_LABEL,
  DUE_KIND_LABEL,
  fmtDayKey,
  fmtMonthKey,
  fmtWeekRange,
  foldCalendar,
  type ChequeDueSummary,
} from "./chequeDueService";

const MONEY = "#,##0.00";
const COUNT = "#,##0";

export function buildChequeDueExport(data: ChequeDueSummary): ReportExportSpec {
  const windowLabel = `${fmtDayKey(data.window.from)} – ${fmtDayKey(data.window.to)}`;
  return {
    title: "Çek / Senet Vade Takvimi",
    subtitle: `Takvim penceresi: ${windowLabel}`,
    // Backend'in kapsam notları OLDUĞU GİBİ taşınır — burada yeniden yazılırsa
    // backend değişince ikisi ayrışır (`ReportNotesCard` ile aynı kural).
    meta: [`Rapor günü: ${fmtDayKey(data.today)}`, ...data.notes],
    orientation: "landscape",
    tables: [bucketTable(data), periodTable(data, "week"), periodTable(data, "month")],
  };
}

/** Kova tablosu — portföyün TAMAMI, pencereden bağımsız. */
function bucketTable(data: ChequeDueSummary): ReportTableSpec {
  return {
    name: "Vade Kovaları",
    columns: [
      { header: "Kova", key: "bucket", width: 18 },
      { header: "Yön", key: "kind", width: 18 },
      { header: "Çek/senet", key: "kindRaw", width: 14 },
      { header: "Para", key: "currency", width: 7 },
      { header: "Adet", key: "count", width: 9, numFmt: COUNT, align: "right" },
      { header: "Tutar", key: "amount", width: 16, numFmt: MONEY, align: "right" },
    ],
    rows: data.buckets.map((b) => ({
      bucket: DUE_BUCKET_LABEL[b.bucket],
      kind: DUE_KIND_LABEL[b.kind],
      kindRaw: KIND_LABEL[b.kind],
      currency: b.currency,
      count: b.count,
      amount: toNum(b.amount),
    })),
    notes: [
      "Bu tablo portföyün TAMAMINI kapsar — aşağıdaki haftalık/aylık takvimin penceresinden BAĞIMSIZDIR.",
      `"Yaklaşan" kovası ${data.soonDays} günlük penceredir (bugün dahil) ve portföy listesindeki vade uyarısıyla aynı eşiktir.`,
    ],
  };
}

/** Haftalık / aylık takvim — yalnız seçilen pencere. */
function periodTable(data: ChequeDueSummary, unit: "week" | "month"): ReportTableSpec {
  const rows = foldCalendar(unit === "week" ? data.weeks : data.months);
  const currencies = new Set(rows.map((r) => r.currency));
  const single = currencies.size === 1 ? [...currencies][0] : null;

  return {
    name: unit === "week" ? "Haftalık Vade" : "Aylık Vade",
    columns: [
      { header: unit === "week" ? "Hafta" : "Ay", key: "period", width: 20 },
      { header: "İlk gün", key: "start", width: 12 },
      { header: "Son gün", key: "end", width: 12 },
      { header: "Para", key: "currency", width: 7 },
      { header: "Tahsil adet", key: "rc", width: 11, numFmt: COUNT, align: "right" },
      { header: "Tahsil edilecek", key: "ra", width: 16, numFmt: MONEY, align: "right" },
      { header: "Ödeme adet", key: "ic", width: 11, numFmt: COUNT, align: "right" },
      { header: "Ödenecek", key: "ia", width: 16, numFmt: MONEY, align: "right" },
      { header: "Net", key: "net", width: 16, numFmt: MONEY, align: "right" },
    ],
    rows: rows.map((r) => ({
      period: unit === "week" ? fmtWeekRange(r.start, r.end) : fmtMonthKey(r.key),
      start: fmtDayKey(r.start),
      end: fmtDayKey(r.end),
      currency: r.currency,
      rc: r.receivedCount,
      ra: r.receivedAmount,
      ic: r.issuedCount,
      ia: r.issuedAmount,
      net: r.net,
    })),
    // TOPLAM yalnız TEK para birimi varsa — karışık birimli bir toplam anlamsız
    // olurdu (dosya başlığı). Satır yoksa da basılmaz: boş bir "TOPLAM 0"
    // satırı, veri gelmediğini "sıfır" diye okutur.
    totalRow:
      single && rows.length > 0
        ? {
            period: "TOPLAM",
            start: "",
            end: "",
            currency: single,
            rc: rows.reduce((n, r) => n + r.receivedCount, 0),
            ra: rows.reduce((n, r) => n + r.receivedAmount, 0),
            ic: rows.reduce((n, r) => n + r.issuedCount, 0),
            ia: rows.reduce((n, r) => n + r.issuedAmount, 0),
            net: rows.reduce((n, r) => n + r.net, 0),
          }
        : undefined,
    notes: [
      `Yalnız ${fmtDayKey(data.window.from)} – ${fmtDayKey(data.window.to)} penceresine düşen vadeler.`,
      "“Net” aynı para birimindeki giren − çıkan farkıdır; para birimleri arası toplam ÜRETİLMEZ.",
      unit === "week"
        ? "Haftalar PAZARTESİ başlar; pencere ortasından başlayan haftada yalnız pencereye düşen çekler sayılır."
        : "Ay satırı takvim ayıdır; pencere ay ortasında başlıyorsa yalnız pencereye düşen çekler sayılır.",
    ],
  };
}
