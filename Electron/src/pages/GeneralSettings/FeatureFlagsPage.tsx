import { SettingsSurfacePage } from "./SettingsSurfacePage";

/**
 * ÖZELLİK ANAHTARLARI — fabrika yetkilisinin düzenlediği DAVRANIŞ bayrakları
 * (2026-09-04 kullanıcı isteği: "firmadaki yetkilinin düzenleyebileceği flaglar
 * ayrı bir yerde olsun").
 *
 * ⚠️ MODÜL ANAHTARLARI BURADA DEĞİL ve bu ayrımın tamamı budur: modül anahtarı
 * "bu kurulum hangi ürünü aldı" sorusunu (satıcı · Sistem → Modüller), davranış
 * bayrağı "bu fabrika nasıl çalışıyor" sorusunu yanıtlar (fabrika · burası).
 * İkisi aynı ekranda dururken fabrika yöneticisi, kendi düzenleyebildiği
 * satırların yanında kilitli satırlar görüyordu.
 *
 * ⚠️ KATEGORİ KİLİDİ (`moduleKey`) BURADA YAŞAMAYA DEVAM EDER: modülü kapalı
 * kategori GİZLENMEZ, salt-okunur çizilir + bant. Gizlemek "açtım, kapatamıyorum"
 * çıkmazını üretirdi (P5 kararı).
 */
export function FeatureFlagsPage() {
  return <SettingsSurfacePage surface="flags" title="Özellik Anahtarları" />;
}
