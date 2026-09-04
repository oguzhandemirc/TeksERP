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
 * ⚠️ KAPALI MODÜLÜN BAYRAĞI FABRİKAYA HİÇ ÇİZİLMEZ (2026-09-04 kullanıcı
 * kararı: "modülleri parayla satacağız; fabrika sahibinin 'bu modül zaten
 * içinde varmış' demesini istemiyoruz"). Süzgeç SATIR bazındadır ve tek kaynağı
 * `flag-modules.ts`; kategoriden geriye satır kalmazsa sekme de çizilmez.
 *
 * ⚠️ P5'in (2026-09-03) "kilit ≠ gizleme" kararı BU YÜZEYDE terse döndü ve
 * gerekçesi ölçümle çürüdü: o günkü tek itiraz "gizlersen geri dönüş yolu
 * kalmaz" idi; modül anahtarları aynı gün KENDİ ekranına taşındı (Sistem →
 * Modüller) ve o ekran bu kuraldan ETKİLENMEZ. Kilit BANDI da duruyor — ama
 * artık onu yalnız satıcı görür.
 */
export function FeatureFlagsPage() {
  return <SettingsSurfacePage surface="flags" title="Özellik Anahtarları" />;
}
