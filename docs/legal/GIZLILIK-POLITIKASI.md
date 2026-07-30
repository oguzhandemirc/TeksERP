# TeksERP Mobil — Gizlilik Politikası

> **TASLAK.** Google Play zorunlu gizlilik politikası için hazırlandı. Veri
> akışları `mobil/` kaynak kodundan çıkarılmıştır ve doğrudur; **`[DOLDUR]`**
> alanları şirket bilgileriyle tamamlanmalı ve metin yayına çıkmadan bir hukukçu
> tarafından KVKK / GDPR uyumu açısından gözden geçirilmelidir.
>
> Yayın: herkese açık, sabit bir URL'de barındırılmalı (GitHub Pages veya şirket
> sitesi). Play Console → Store listing → Privacy policy alanına bu URL girilir.

**Son güncelleme:** [DOLDUR — yayın tarihi]
**Uygulama:** TeksERP Mobil (`com.teks.erp.mobil`)
**Veri sorumlusu:** [DOLDUR — şirket ünvanı, adres]
**İletişim:** [DOLDUR — e-posta]

## 1. Uygulamanın niteliği

TeksERP Mobil bir **tekstil fabrikası üretim takip istemcisidir**. Uygulama tek
başına çalışmaz; kullanan kuruluşun **kendi sunucusunda** (self-hosted) kurulu
TeksERP backend'ine bağlanır. Sunucu adresi kullanıcı tarafından uygulama içinden
girilir.

Bunun sonucu: üretim verileri üzerinde **veri sorumlusu, uygulamayı kullanan
kuruluştur** (fabrika). Uygulama geliştiricisi bu verilere erişmez, kopyalamaz ve
saklamaz. İstisna: aşağıdaki §5'te açıklanan demo sunucusu.

## 2. Toplanan veriler

| Veri | Amaç | Nerede |
|---|---|---|
| Kullanıcı adı ve şifre | Kuruluşun sunucusunda kimlik doğrulama | Şifre yalnız girişte iletilir, cihazda saklanmaz. Oturum anahtarı (JWT) cihazın güvenli deposunda (Android Keystore) tutulur. |
| Cihaz kimliği (rastgele UUID) | Tabletin hangi makine/istasyona atandığının tanınması | Cihazda üretilir, güvenli depoda saklanır, kuruluşun sunucusuna bildirilir. |
| Operatörün girdiği üretim verileri (barkod, metraj, ağırlık, kalite kararı, hata kaydı) | Uygulamanın asıl işlevi | Kuruluşun sunucusu. Çevrimdışı çalışmada geçici olarak cihazda kuyruklanır. |
| Teknik hata/işlem kayıtları | Arıza teşhisi | Kuruluşun sunucusu. |

## 3. Toplanmayan veriler

Aşağıdakiler **hiçbir şekilde toplanmaz, iletilmez veya saklanmaz**:

- **Konum.** Uygulama konum izni ister ama konumu okumaz. İzin, Android 11 ve
  öncesinde **Bluetooth cihaz taraması** için işletim sistemi tarafından zorunlu
  kılındığı için istenir (metre, kantar, etiket yazıcısı bağlantısı).
- **Kamera görüntüsü.** Kamera yalnız barkod/QR çözmek için kullanılır; çözme
  işlemi cihazda yapılır, fotoğraf veya video kaydedilmez ve gönderilmez.
- Rehber, çağrı kaydı, SMS, mikrofon, sağlık verisi.
- Reklam kimliği. Uygulamada **reklam yok, üçüncü taraf analitik/izleme SDK'sı
  yok, çökme raporlama SDK'sı yok**.

## 4. İzinler ve gerekçeleri

| İzin | Gerekçe |
|---|---|
| Kamera | Barkod ve refakat kartı QR kodu okuma |
| Bluetooth (bağlan / tara) | Metre, kantar ve etiket yazıcısına bağlanma |
| Konum (yaklaşık / hassas) | Yalnızca Bluetooth taraması için — bkz. §3 |
| İnternet | Kuruluşun sunucusuna bağlanma |

## 5. Demo sunucusu

Uygulamayı denemek isteyenler için herkese açık bir demo sunucusu sunulmaktadır.
Demo sunucusuna girilen veriler **test verisidir**, gerçek üretim verisi
niteliğinde değildir, üçüncü taraflarla paylaşılmaz ve düzenli olarak silinir.
Demo sunucusuna hassas veya kişisel veri girilmemelidir.

Demo adresi: [DOLDUR]

## 6. Veri paylaşımı

Toplanan veriler üçüncü taraflarla paylaşılmaz, satılmaz, reklam amacıyla
kullanılmaz. Veri, kullanıcının girdiği sunucu adresinden başka bir yere
gönderilmez.

## 7. Saklama ve güvenlik

- Oturum anahtarı cihazın güvenli deposunda (Android Keystore) tutulur.
- Çevrimdışı kuyruk ve önbellek, oturum kapatıldığında cihazdan temizlenir.
- Sunucu tarafı saklama süresi ve yedekleme politikası, sunucuyu işleten
  kuruluşun sorumluluğundadır: [DOLDUR — kuruluş politikasına atıf].

## 8. Hesaplar

Kullanıcı hesapları **uygulama içinden açılamaz**; kuruluşun yöneticisi
tarafından oluşturulur ve atanır. Hesabının silinmesini isteyen kullanıcı
kuruluşunun yöneticisine ya da aşağıdaki adrese başvurur.

## 9. Kullanıcı hakları

KVKK md. 11 ve (uygulanabildiği yerde) GDPR kapsamında; kişisel verilerinize
erişme, düzeltilmesini, silinmesini veya işlenmesinin kısıtlanmasını isteme
haklarına sahipsiniz. Talepler: [DOLDUR — e-posta].

## 10. Çocukların gizliliği

Uygulama işyeri kullanımı içindir, 18 yaş altına yönelik değildir ve çocuklardan
bilerek veri toplanmaz.

## 11. Değişiklikler

Bu politika güncellendiğinde bu sayfada yayımlanır ve "son güncelleme" tarihi
değiştirilir. Önemli değişiklikler uygulama içinden bildirilir.
