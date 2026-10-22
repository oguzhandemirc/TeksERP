// Pano · Üretim · Stok · Sevkiyat sözlüğü: fabrikanın anlık/kayıt alanlarındaki ham değerler → Türkçe etiket + ton.
// Kaynak enum'lar fabrikadadır (Teks-Erp prisma şeması, `cloud-sync/snapshots.ts`); bilinmeyen değer ham döner
// (`lookup`) — ekran yine çizilir, bekçi testi eksik anahtarı yakalar.
import type { StatusEntry } from "./ortak";

/** Fabrikanın dört standart dönemi (`ozet.sevkiyat` / `ozet.fason` anahtarları); segment için kısa ad, açıklamada `PERIOD_LABEL`. */
export const PERIODS = [
  { key: "bugun", label: "Bugün" },
  { key: "buAy", label: "Bu ay" },
  { key: "gecenAy", label: "Geçen ay" },
  { key: "son30Gun", label: "30 gün" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export const PERIOD_LABEL: Readonly<Record<PeriodKey, string>> = {
  bugun: "Bugün",
  buAy: "Bu ay",
  gecenAy: "Geçen ay",
  son30Gun: "Son 30 gün",
};

/**
 * Birimler: fabrika paneli aynı alanları bu birimle basar (stok/sevk/fason karneleri "m", istasyon sayaçları top).
 * Uygulama birim UYDURMAZ; yalnız bu tabloda adı geçen alana birim yazılır.
 */
export const UNIT = { metre: "m", top: "top", kalem: "kalem", gun: "gün", adet: "adet" } as const;

/** Terbiye iş emri durumu (`WorkOrderStatus`). */
export const WORK_ORDER_STATUS: Readonly<Record<string, StatusEntry>> = {
  PLANNED: { label: "Planlandı", tone: "bilgi" },
  IN_PROGRESS: { label: "Üretimde", tone: "uyari" },
  COMPLETED: { label: "Tamamlandı", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "kritik" },
  SUPERSEDED: { label: "Devredildi", tone: "bilgi" },
};

/** Terbiye iş emri türü (`WorkOrderType`). */
export const WORK_ORDER_TYPE: Readonly<Record<string, string>> = {
  ORDER_PRODUCTION: "Siparişe üretim",
  STOCK_PRODUCTION: "Stoka üretim",
};

/** Sevkiyat durumu (`ShipmentStatus`). */
export const SHIPMENT_STATUS: Readonly<Record<string, StatusEntry>> = {
  PLANNED: { label: "Onay bekliyor", tone: "uyari" },
  DISPATCHED: { label: "Sevk edildi", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
};

/** Sevkiyat varış kapsamı (`ShipmentDestination`). */
export const SHIPMENT_DESTINATION: Readonly<Record<string, string>> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "İhracat",
};

/** İstasyon türü (`StationType`): dış istasyon = fason. */
export const STATION_TYPE: Readonly<Record<string, string>> = {
  INTERNAL: "İç istasyon",
  EXTERNAL: "Fason",
};

/** Çek/senet yönü (`ChequeKind`). */
export const CHEQUE_KIND: Readonly<Record<string, string>> = {
  RECEIVED: "Alınan çek/senet",
  ISSUED: "Verilen çek/senet",
};

export const CHEQUE_KIND_SHORT: Readonly<Record<string, string>> = {
  RECEIVED: "Alınan",
  ISSUED: "Verilen",
};

/** Çek vade kovası (`CHEQUE_DUE_BUCKETS`); SOON = 7 gün içinde. */
export const CHEQUE_BUCKET: Readonly<Record<string, StatusEntry>> = {
  OVERDUE: { label: "Vadesi geçmiş", tone: "kritik" },
  SOON: { label: "7 gün içinde", tone: "uyari" },
  MONTH: { label: "Bu ay", tone: "bilgi" },
  LATER: { label: "Daha sonra", tone: "bilgi" },
  NO_DUE: { label: "Vadesiz", tone: "bilgi" },
};

/** Gece yedeği hükmü (`saglik.yedek.hukum`). */
export const BACKUP_VERDICT: Readonly<Record<string, StatusEntry>> = {
  ok: { label: "Gece yedeği alındı", tone: "iyi" },
  uyari: { label: "Gece yedeği gecikti", tone: "uyari" },
  kritik: { label: "Gece yedeği alınamadı", tone: "kritik" },
  yapilandirilmamis: { label: "Gece yedeği kurulmamış", tone: "bilgi" },
};

/** Stok yaş kovası (`stok-karnesi.yasKovalari[].anahtar`) → ton; etiket fabrikadan gelir. */
export const STOCK_AGE_TONE: Readonly<Record<string, StatusEntry["tone"]>> = {
  "0-7": "iyi",
  "8-30": "bilgi",
  "31-90": "uyari",
  "90+": "kritik",
};

/** Üretim akışı kolonları (`uretim-akisi.kolonlar[].anahtar`; etiket fabrikadan, Kanban ile aynı). */
export const FLOW_KEYS = ["hamStok", "yariMamul", "fason", "kursun", "tambur", "depo", "sevk"] as const;
