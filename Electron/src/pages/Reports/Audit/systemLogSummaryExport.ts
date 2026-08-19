// Denetim Kaydı Özeti → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE bundan
// türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekrandaki üç yüzeyin (İşlem Türü pastası · Günlük Aktivite grafiği · Tabloya
// Göre Kayıt Sayısı tablosu) her biri BİR tabloya karşılık gelir; kolon adları
// ekrandakiyle aynıdır.
//
// ⚠️ GÜN ETİKETİ: `daily[].day` backend'de FABRİKA takvim gününe (Europe/Istanbul)
// göre gruplanmış hazır bir etikettir. Burada yeniden `Date` kurup biçimlemek,
// günü istemcinin saat diliminde İKİNCİ KEZ yorumlamak olur ve gece vardiyasının
// satırlarını bir gün kaydırabilir. API ne döndüyse o basılır.

import type { ReportExportSpec } from "../_components/reportExport";
import { actionLabel, tableLabel } from "../_components/audit-labels";
import type { SystemLogSummary } from "./service";

export function buildSystemLogSummaryExport(opts: {
  summary: SystemLogSummary;
  periodLabel: string;
}): ReportExportSpec {
  const { summary: s, periodLabel } = opts;

  return {
    title: "Denetim Kaydı Özeti",
    subtitle: periodLabel,
    meta: [
      "Kapsam: SystemLog tablosunda aralık İÇİNDE oluşan kayıtlar (kaydın oluşma anına göre).",
      "Günlük kırılım FABRİKA takvim gününe göredir (Europe/Istanbul) — gece 00:00–03:00 arası işlemler kendi gününde sayılır.",
      "Toplam kayıt, yalnız CUD değildir: giriş/çıkış ve sistem olayları da işlem türü kırılımına dahildir.",
    ],
    tables: [
      {
        name: "İşlem Türü",
        columns: [
          { header: "İşlem", key: "action", width: 22 },
          { header: "Kayıt", key: "count", width: 12, numFmt: "#,##0", align: "right" },
        ],
        rows: s.byAction.map((a) => ({ action: actionLabel(a.action), count: a.count })),
        totalRow: { action: "TOPLAM", count: s.totalLogs },
      },
      {
        name: "Günlük Aktivite",
        columns: [
          { header: "Gün", key: "day", width: 14 },
          { header: "Oluştur", key: "create", width: 12, numFmt: "#,##0", align: "right" },
          { header: "Güncelle", key: "update", width: 12, numFmt: "#,##0", align: "right" },
          { header: "Sil", key: "delete", width: 12, numFmt: "#,##0", align: "right" },
        ],
        // Etiket API'den geldiği gibi (YYYY-AA-GG) — bkz. dosya başlığındaki uyarı.
        rows: s.daily.map((d) => ({ day: d.day, create: d.create, update: d.update, delete: d.delete })),
        totalRow: {
          day: "TOPLAM",
          create: s.daily.reduce((a, d) => a + d.create, 0),
          update: s.daily.reduce((a, d) => a + d.update, 0),
          delete: s.daily.reduce((a, d) => a + d.delete, 0),
        },
        notes: [
          "Gün etiketi fabrika takvim günüdür (Europe/Istanbul), biçim YYYY-AA-GG.",
          "Bu tablo yalnız Oluştur/Güncelle/Sil'i ayırır; diğer olaylar sütunlara girmez, bu yüzden satır toplamı 'İşlem Türü' toplamından küçük olabilir.",
        ],
      },
      {
        // Ekrandaki başlık "Tabloya Göre Kayıt Sayısı (en yüksek 30)" — Excel sayfa
        // adı 31 karakterle sınırlı olduğu için parantezli kapsam nota taşındı;
        // uyarı DÜŞMEZ, yalnız yer değiştirir.
        name: "Tabloya Göre Kayıt Sayısı",
        columns: [
          { header: "Tablo", key: "tableName", width: 32 },
          { header: "Kayıt", key: "count", width: 12, numFmt: "#,##0", align: "right" },
        ],
        rows: s.byTable.map((t) => ({ tableName: tableLabel(t.tableName), count: t.count })),
        totalRow: {
          tableName: "TOPLAM (listelenen)",
          count: s.byTable.reduce((a, t) => a + t.count, 0),
        },
        notes: [
          "Yalnız en yüksek 30 tablo listelenir — TOPLAM satırı bu 30 satırın toplamıdır, dönemin tamamı değildir.",
        ],
      },
    ],
  };
}
