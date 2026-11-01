// FABRİKA BİLDİRİM TÜRÜ → PATRON BULUTU TÜRÜ eşlemesi (bildirim v2 F5 hazırlığı). Bulut kataloğu
// (`patron/sunucu/src/catalog/notifications.ts` `KIND_RULES`) olayı KENDİ projeksiyonundan üretir; bu tablo
// yalnız "aynı konunun buluttaki adı"nı beyan eder. `null` = bulutta karşılığı yok, gerekçe zorunlu.
// Bulut kataloğuna tür eklemek ayrı karardır; bekçi: `test_bildirim_katalogu` §9.
import type { NotificationKind } from "./notification-catalog";

export type PatronEslemesi =
  | { readonly patronKind: string; readonly neden?: string }
  | { readonly patronKind: null; readonly neden: string };

export const NOTIFICATION_PATRON_MAP: Readonly<Record<NotificationKind, PatronEslemesi>> = {
  "sistem.yedek-basarisiz": { patronKind: "yedek-basarisiz" },
  "sistem.esitleme-gecikti": { patronKind: "esitleme-gecikti", neden: "bulut kendi tarafından ölçer (son paket yaşı)" },
  "sistem.lisans-uyarisi": { patronKind: null, neden: "lisans yönetimi fabrika içi; bulutta tür yok" },
  "sistem.guncelleme-onay-bekliyor": { patronKind: null, neden: "yalnız fabrika içi (sürüm onayı yerinde verilir)" },
  "yazici.hata": { patronKind: null, neden: "yalnız fabrika içi (cihaz arızası)" },
  "cihaz.halka-kaybi": { patronKind: null, neden: "yalnız fabrika içi (cihaz kimliği; anahtar bilgisi dışarı çıkmaz)" },
  "kimlik.yeni-cihaz-girisi": { patronKind: null, neden: "kişisel güvenlik olayı (IP, tarayıcı) fabrika içinde kalır; bulut kataloğuna tür eklemek ayrı karar" },
  "siparis.patron-siparisi": { patronKind: null, neden: "patronun kendi gönderisi; sonucu bulutta `gelen-kutusu-sonucu` ayrı olayıdır" },
  "siparis.termin-yaklasti": { patronKind: null, neden: "bulutta tür yok (yalnız termini geçmiş sayısı)" },
  "siparis.termin-gecti": { patronKind: "geciken-siparis", neden: "bulutta kalem sayısı eşiği, günde bir kez" },
  "isemri.gecikti": { patronKind: null, neden: "bulutta tür yok" },
  "kalite.kk1-oran-dusuk": { patronKind: null, neden: "bulutta tür yok" },
  "kalite.sertifika-suresi-doluyor": { patronKind: null, neden: "bulutta tür yok" },
  "fason.donus-gecikti": { patronKind: null, neden: "bulutta tür yok" },
  "sevkiyat.onay-bekliyor": { patronKind: null, neden: "yalnız fabrika içi iş akışı" },
  "sevkiyat.sevke-hazir": { patronKind: null, neden: "patron bildirimi sonraki adım (DALGA4 §12.2); şimdilik yalnız fabrika içi" },
  "cari.kilitlendi": { patronKind: "cari-kilit", neden: "bulut cari-hesap.kilit projeksiyonundan üretir (D4-I6, kilit başına tek)" },
  "cari.kilit-acildi": { patronKind: "cari-kilit", neden: "bulutta aynı türün açılış olayı (`cari-kilit:<kilitId>:acildi`)" },
  "cari.risk-limiti-asildi": { patronKind: null, neden: "bulutta tür yok (tutar dışarı çıkmaz; risk görünümü fabrika içi)" },
  "dokuma.levent-bitiyor": { patronKind: null, neden: "yalnız fabrika içi (salon işi)" },
  "dokuma.tezgah-alarmi": { patronKind: null, neden: "yalnız fabrika içi (nöbet/kademe alarmı)" },
};
