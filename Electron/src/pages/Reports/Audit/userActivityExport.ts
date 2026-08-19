// Kullanıcı Aktivitesi → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE bundan
// türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekrandaki `DetailTable` ile AYNI kolonları taşır (Kullanıcı · Kullanıcı Adı ·
// Toplam · Oluştur · Güncelle · Sil · Son İşlem).

import type { ReportExportSpec } from "../_components/reportExport";
import { fmtDateTime } from "../_components/formatters";
import type { UserActivityRow } from "./service";

export function buildUserActivityExport(opts: {
  rows: UserActivityRow[];
  periodLabel: string;
}): ReportExportSpec {
  const { rows, periodLabel } = opts;

  return {
    title: "Kullanıcı Aktivitesi",
    subtitle: periodLabel,
    meta: [
      "Kapsam: SystemLog tablosunda aralık İÇİNDE oluşan kayıtlar (kaydın oluşma anına göre).",
      // Bu ayrım ekranda görünmüyor ama dosyada ŞART: Toplam ≠ Oluştur+Güncelle+Sil
      // olduğunda okuyucu "sayılar tutmuyor" diye raporun tamamına güvenini yitirir.
      "'Toplam' kullanıcının TÜM denetim kayıtlarıdır; giriş/çıkış gibi CUD dışı olaylar da sayılır — bu yüzden Oluştur+Güncelle+Sil toplamından büyük olabilir.",
      "En çok işlem yapan 100 kullanıcı ile sınırlıdır.",
      "Kullanıcısı olmayan kayıtlar (arka plan işleri, zamanlanmış görevler) '(sistem)' satırında toplanır.",
    ],
    tables: [
      {
        name: "Kullanıcı Aktivitesi",
        columns: [
          { header: "Kullanıcı", key: "fullName", width: 28 },
          { header: "Kullanıcı Adı", key: "username", width: 18 },
          { header: "Toplam", key: "totalCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Oluştur", key: "createCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Güncelle", key: "updateCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Sil", key: "deleteCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Son İşlem", key: "lastActionAt", width: 18, align: "right" },
        ],
        rows: rows.map((r) => ({
          fullName: r.fullName || r.username || "(sistem)",
          username: r.username || "—",
          totalCount: r.totalCount,
          createCount: r.createCount,
          updateCount: r.updateCount,
          deleteCount: r.deleteCount,
          lastActionAt: fmtDateTime(r.lastActionAt),
        })),
        totalRow: {
          fullName: "TOPLAM",
          username: `${rows.length} kullanıcı`,
          totalCount: rows.reduce((a, r) => a + r.totalCount, 0),
          createCount: rows.reduce((a, r) => a + r.createCount, 0),
          updateCount: rows.reduce((a, r) => a + r.updateCount, 0),
          deleteCount: rows.reduce((a, r) => a + r.deleteCount, 0),
        },
      },
    ],
  };
}
