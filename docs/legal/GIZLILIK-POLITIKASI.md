# TeksERP — Gizlilik Politikası

> **YAYINDA — hukukçu incelemesi YAPILMADI** (kullanıcı kararı 2026-10-08: "hukukçu yok, şimdi yayınla").
> Google Play'in zorunlu tuttuğu gizlilik politikasıdır; hukuki görüş değildir. Metin
> `docs/ops/PLAY-KONSOL-FORMLARI.md` §1.2 ile hizalıdır (2026-10-08; veri akışları koddan ölçüldü, kaynaklar
> orada §1.1 ve §8). Unvan "Etkili Yazılım Ltd. Şti.", adres satırı yok (kullanıcı kararı 2026-10-08).
>
> **Yayın:** `https://tekserp.etkiliyazilim.com/gizlilik` (K2, kullanıcı kararı 2026-10-08; kendi VDS'imiz).
> Bu dosya sayfanın TEK KAYNAĞIDIR: bu satırın altındaki kısım `deploy/gizlilik-sayfasi/uret.mjs` ile
> `deploy/gizlilik-sayfasi/html/gizlilik.html`e çevrilir (bekçi `scripts/test_gizlilik_sayfasi.mjs` bayt-eşitliği
> ölçer); köşeli parantezli alan kaldıkça kurulum betiği yayını durdurur.
> **K3:** 7. maddedeki "şifresiz olabilir" cümlesi bugünkü tablete (vc59) göre doğrudur; vc60 (yalnız şifreli
> bağlantı) yayına çıktığı gün bu madde ve Play veri güvenliği formu birlikte güncellenir.

**Son güncelleme:** 8 Ekim 2026
**Uygulama:** TeksERP (Google Play paket adı: `com.etkiliyazilim.tekserp`)
**Geliştirici:** Etkili Yazılım Ltd. Şti.
**İletişim:** info@etkiliyazilim.com

## 1. Uygulamanın niteliği

TeksERP, tekstil fabrikalarında üretim, kalite, depo ve sevkiyat işlemlerinin kaydı için kullanılan bir iş
uygulamasıdır. Uygulama tek başına çalışmaz: kullanan fabrikanın KENDİ sunucusunda kurulu TeksERP sistemine
bağlanır. Sunucu adresi uygulamada ağ taraması veya elle giriş ile belirlenir; uygulamada hiçbir fabrika
sunucusunun adresi gömülü değildir.

Bu nedenle uygulamaya girilen iş verilerinin ve personel bilgilerinin veri sorumlusu, uygulamayı kullanan
fabrikadır (işveren). Etkili Yazılım bu verileri toplamaz, kendi sunucularında saklamaz ve bunlara erişmez;
aşağıda 5. maddede sayılan sınırlı teknik veriler istisnadır.

## 2. Uygulamanın fabrika sunucusuna gönderdiği veriler

- **Kimlik doğrulama:** kullanıcı adı ve parola, hızlı giriş PIN'i veya personel kartı kodu. Bunlar yalnız
  giriş anında fabrika sunucusuna gönderilir, cihazda saklanmaz. Fabrika sunucusu PIN'i ve kart kodunu geri
  çevrilemez özet olarak tutar. Girişten sonra oturum anahtarı cihazın güvenli deposunda (Android Keystore)
  tutulur.
- **Kullanıcı listesi:** giriş ekranında, fabrika sunucusundaki kullanıcıların adları seçim için gösterilir.
- **Cihaz kimliği:** uygulamanın ilk açılışta ürettiği rastgele bir tanımlayıcı. Fabrika yöneticisinin
  tableti tanıması ve istasyona ataması için kullanılır; reklam kimliği veya donanım kimliği değildir.
- **İş kayıtları:** okutulan barkodlar, metraj, ağırlık, kalite kararları, açıklama notları, sevkiyatta şoför
  adı ve araç plakası gibi operatörün girdiği bilgiler ve bu işlemleri hangi kullanıcının ne zaman yaptığı.
- **Teknik hata bilgisi:** uygulama beklenmedik bir hatayla karşılaştığında hatanın türü, teknik yığın
  bilgisi, ekran adı ve uygulama sürümü. Hata mesajının metni ve iş verisi gönderilmez.

Ağ bağlantısı yokken yapılan işlemler cihazda geçici olarak sıraya alınır ve bağlantı gelince fabrika
sunucusuna gönderilir.

## 3. Kamera, Bluetooth ve konum

- Kamera yalnız barkod ve QR kod okumak için kullanılır. Görüntü cihazda işlenir; fotoğraf veya video
  kaydedilmez ve gönderilmez.
- Bluetooth; metre, kantar ve etiket yazıcısı gibi fabrika cihazlarına bağlanmak için kullanılır.
- Konum izni yalnız Android 11 ve önceki sürümlerde, işletim sistemi Bluetooth cihaz taraması için bu izni
  zorunlu tuttuğu için istenir. Uygulama konumunuzu okumaz, kaydetmez ve göndermez.
- Uygulama mikrofon, rehber, arama kaydı, SMS, fotoğraf arşivi veya sağlık verisi kullanmaz. Uygulamada reklam
  yoktur ve reklam kimliği kullanılmaz.

## 4. Uygulama güncellemeleri

Uygulama, küçük güncellemeleri Etkili Yazılım'ın güncelleme sunucusundan (indir.etkiliyazilim.com) indirir. Bu
istekte uygulama sürümü ve fabrikanın güncelleme grubunu belirten bir indirme belirteci gönderilir; kişisel
veri ve iş verisi gönderilmez. Sunucu, internet altyapısı gereği bağlantının IP adresini görür. Büyük
güncellemeler Google Play üzerinden gelir.

## 5. Etkili Yazılım'a ulaşan veriler

- Güncelleme istekleri (4. madde).
- Fabrika yöneticisi açıkça onay verirse, fabrika sunucusu teknik hata bilgilerini (2. maddedeki "teknik hata
  bilgisi"; kullanıcı adı ve iş verisi olmadan) arıza teşhisi için Etkili Yazılım'a iletir. Bu ayar
  varsayılan olarak kapalıdır.
- Barkod okuma, Google'ın ML Kit kütüphanesiyle cihaz üzerinde yapılır. Google'ın bu kütüphane için topladığı
  teknik veriler Google'ın kendi politikasına tabidir: https://developers.google.com/ml-kit/android-data-disclosure

## 6. Paylaşım

Veriler satılmaz, reklam amacıyla kullanılmaz ve üçüncü taraflarla paylaşılmaz. Fabrika sunucusundaki
verilerin kimlerle paylaşılacağına fabrika karar verir.

## 7. Saklama ve güvenlik

- Oturum anahtarı ve cihaz kimliği Android Keystore korumalı güvenli depoda tutulur.
- Fabrika sunucusundaki verilerin saklama süresi, yedeklenmesi ve silinmesi fabrikanın sorumluluğundadır.
- Fabrika sunucusuyla bağlantı, fabrikanın ayarına göre şifreli (HTTPS) ya da fabrikanın kendi iç ağında
  şifresiz olabilir. Güncelleme sunucusuyla bağlantı her zaman şifrelidir.

## 8. Hesaplar ve silme

Kullanıcı hesapları uygulama içinden açılamaz; fabrika yöneticisi tarafından açılır ve kapatılır. Hesabınızın
ve verilerinizin silinmesi için önce fabrikanızın yöneticisine başvurun. Etkili Yazılım'a ulaşan teknik
verilerin silinmesi için: info@etkiliyazilim.com.

## 9. Haklarınız

6698 sayılı KVKK md. 11 ve uygulanabildiği ölçüde GDPR kapsamındaki haklarınızı, verilerinizin sorumlusu olan
fabrikaya (işvereninize) karşı kullanabilirsiniz. Etkili Yazılım'a ilişkin talepler: info@etkiliyazilim.com.

## 10. Çocuklar

Uygulama işyeri kullanımı içindir; 18 yaş altına yönelik değildir.

## 11. Değişiklikler

Politika değiştiğinde bu sayfa güncellenir ve "son güncelleme" tarihi değişir.
