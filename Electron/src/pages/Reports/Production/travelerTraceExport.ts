// Refakat Kartı İzleme → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE
// bundan türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekranda iki yüzey var: rulo künye kartı + zaman çizelgesi. Çıktı da bu ikisini
// taşır; çizelge satırı ekranda tek cümleye sıkıştırılmış olsa da (istasyon ·
// tip · operatör · makine · metraj) çıktıda AYNI alanlar kolonlara açılır —
// sıkıştırma bir sunum kararıydı, veri kaybı değil.
//
// Etiket sözlükleri BURADA yaşar ve sayfa buradan import eder: ekranda "Kurşun
// Geçildi" yazıp Excel'de ham `KURSUN_APPLIED` basmak, aynı olayı iki ad altında
// gösterip "bunlar farklı şeyler mi" sorusunu doğurur.

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { fmtDate, fmtDateTime } from "../_components/formatters";
import type { TravelerEvent, TravelerTraceResult } from "./service";

export const STATION_KIND_LABEL: Record<string, string> = {
  RAW_QC: "KK1",
  PROCESS_QC: "KK2/Kurşun",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  OTHER: "Diğer",
};

export const OP_TYPE_LABEL: Record<string, string> = {
  KURSUN_APPLIED: "Kurşun Geçildi",
  QC2_COMPLETED: "QC2 Tamamlandı",
  TAMBUR_PROCESSED: "Tambur Karar",
  PACKAGED: "Paketlendi",
  SUBCONTRACTOR_SENT: "Fasona Sevk",
  SUBCONTRACTOR_RETURNED: "Fasondan Dönüş",
};

/** Ekrandaki satır başlığının olay kısmı — istasyon adı ayrı kolona gider. */
function eventLabel(ev: TravelerEvent): string {
  if (ev.type === "MOVEMENT_IN") return "Giriş";
  if (ev.type === "MOVEMENT_OUT") return "Çıkış";
  return OP_TYPE_LABEL[ev.operationType ?? ""] ?? ev.operationType ?? "İşlem";
}

export function buildTravelerTraceExport(trace: TravelerTraceResult): ReportExportSpec {
  const { roll, events } = trace;

  // Dönem = topun İZ aralığı. Bu raporda tarih filtresi yoktur (tek top, tüm
  // ömrü) — bu yüzden dönem satırı filtreden değil VERİDEN türetilir; yoksa
  // çıktı, hangi zaman aralığını gösterdiğini söylemeyen bir sayfa olurdu.
  const first = events[0]?.at;
  const last = events.length > 0 ? events[events.length - 1]?.at : undefined;
  const span =
    first && last ? `${fmtDate(first)} – ${fmtDate(last)}` : `Kayıt: ${fmtDate(roll.createdAt)}`;
  const subtitle = `${roll.barcode ?? "(barkodsuz)"} · ${span}`;

  const meta: string[] = [
    `Durum: ${roll.status} · ${events.length} olay`,
    // Kapsam uyarısı: bu izin en kolay yanlış okunan yeri "burada yoksa olmamış".
    "Bu döküm TEK topun izidir. Tambur/fason kesiminde bu toptan DOĞAN çocuk topların olayları burada görünmez — her çocuk kendi barkoduyla ayrıca sorgulanır.",
    "Kesimde çocuğa MİRAS kalan operasyonlar tekrar sayılmaz; her işlem yalnız kaydedildiği topta bir kez görünür.",
    "Zaman çizelgesi istasyon hareketleri (giriş/çıkış) ve istasyon operasyonlarından oluşur; depo, çuval ve sevkiyat hareketleri bu izin DIŞINDADIR.",
    "Künye satırındaki durum ve metrajlar sorgu anındaki CANLI değerlerdir — bu bir donmuş belge değildir, yarın yeniden alındığında farklı çıkabilir.",
  ];

  const rollTable: ReportTableSpec = {
    name: "Rulo Künyesi",
    columns: [
      { header: "Barkod", key: "barcode", width: 20 },
      { header: "Durum", key: "status", width: 18 },
      { header: "Kalite", key: "qualityGrade", width: 16 },
      { header: "İlk Metraj (m)", key: "initialQty", width: 14, numFmt: "#,##0.0", align: "right" },
      { header: "Mevcut Metraj (m)", key: "currentQty", width: 16, numFmt: "#,##0.0", align: "right" },
      { header: "En (cm)", key: "width", width: 10, numFmt: "#,##0.0", align: "right" },
      { header: "Kayıt", key: "createdAt", width: 16 },
    ],
    rows: [
      {
        barcode: roll.barcode ?? "(barkodsuz)",
        status: roll.status,
        qualityGrade: roll.qualityGrade || "—",
        initialQty: roll.initialQty,
        currentQty: roll.currentQty,
        width: roll.width ?? "—",
        createdAt: fmtDateTime(roll.createdAt),
      },
    ],
    notes: [
      "Mevcut metraj ilk metrajdan düşükse fark kesim / fire / düzeltmeden gelir; hangisi olduğunu zaman çizelgesi söyler.",
    ],
  };

  const timeline: ReportTableSpec = {
    name: "Zaman Çizelgesi",
    columns: [
      { header: "Zaman", key: "at", width: 18 },
      { header: "Olay", key: "event", width: 18 },
      { header: "İstasyon", key: "stationName", width: 22 },
      { header: "İstasyon Tipi", key: "stationKind", width: 14 },
      { header: "Operatör", key: "operatorName", width: 22 },
      { header: "Makine", key: "machineName", width: 18 },
      { header: "Metraj (m)", key: "qty", width: 12, numFmt: "#,##0.0", align: "right" },
      { header: "Not", key: "notes", width: 30 },
    ],
    rows: events.map((ev) => ({
      at: fmtDateTime(ev.at),
      event: eventLabel(ev),
      stationName: ev.stationName ?? "—",
      stationKind: ev.stationKind ? (STATION_KIND_LABEL[ev.stationKind] ?? ev.stationKind) : "—",
      operatorName: ev.operatorName ?? "—",
      machineName: ev.machineName ?? "—",
      // Boş bırakmak yerine "—": Excel'de boş hücre "veri gelmedi" diye okunur,
      // oysa operasyon satırında metraj TANIM GEREĞİ yoktur.
      qty: ev.qty ?? "—",
      notes: ev.notes ?? "",
    })),
    notes: [
      "Metraj sütunu yalnız hareket satırlarında doludur: girişte istasyona giren, çıkışta çıkan metraj. Operasyon satırlarında metraj tutulmaz.",
      "Satırlar zamana göre artan sıradadır; aynı ana düşen hareket ve operasyon kayıtlarının sırası kayıt anına bağlıdır.",
    ],
  };

  return {
    title: "Refakat Kartı İzleme",
    subtitle,
    meta,
    tables: [rollTable, timeline],
  };
}
