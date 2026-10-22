// Ortak durum sözlüğü: teldeki (`api/wire.ts`) durum enum'ları → Türkçe etiket + 4'lü durum tonu.
// Tip `Record<…>` olduğundan wire'a yeni değer eklenince derleme kırılır; bilinmeyen değer ekranda ham döner.
import type { AccountStatus, InboxStatus, NotificationStatus, ReportStatus } from "../../api/wire";

export type StatusTone = "iyi" | "uyari" | "kritik" | "bilgi";

export interface StatusEntry {
  readonly label: string;
  readonly tone: StatusTone;
}

export type WireStatus = InboxStatus | ReportStatus | AccountStatus | NotificationStatus;

export const STATUS_DICT: Readonly<Record<WireStatus, StatusEntry>> = {
  // gelen kutusu
  BEKLIYOR: { label: "Bekliyor", tone: "uyari" },
  ISLENIYOR: { label: "İşleniyor", tone: "bilgi" },
  ISLENDI: { label: "İşlendi", tone: "iyi" },
  REDDEDILDI: { label: "Reddedildi", tone: "kritik" },
  IPTAL: { label: "İptal", tone: "bilgi" },
  // rapor isteği
  HESAPLANIYOR: { label: "Hesaplanıyor", tone: "bilgi" },
  HAZIR: { label: "Hazır", tone: "iyi" },
  HATA: { label: "Hata", tone: "kritik" },
  // hesap
  DAVETLI: { label: "Davetli", tone: "bilgi" },
  AKTIF: { label: "Aktif", tone: "iyi" },
  KILITLI: { label: "Kilitli", tone: "kritik" },
  PASIF: { label: "Arşiv", tone: "bilgi" },
  // bildirim gönderimi
  GONDERILIYOR: { label: "Gönderiliyor", tone: "bilgi" },
  GONDERILDI: { label: "Gönderildi", tone: "iyi" },
  BASARISIZ: { label: "Başarısız", tone: "kritik" },
  ATLANDI: { label: "Atlandı", tone: "bilgi" },
};
