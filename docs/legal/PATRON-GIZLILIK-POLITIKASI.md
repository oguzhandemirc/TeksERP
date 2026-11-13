# TeksERP Yönetim — Gizlilik Politikası

> **TeksERP Yönetim (eski adı TeksERP Patron; iç kod adı `patron`) uygulamasının Google Play gizlilik politikası**
> (ad değişimi kullanıcı kararı 2026-10-16; ilk metin kararı 2026-10-15: PBAM taslağından KISA
> uygulama politikası, sürüm kimlikli, taslak işaretsiz; avukat sonra düzeltir). Kaynak:
> `docs/hukuk/PATRON-BULUTU-AYDINLATMA-METNI.md` (PBAM) + `docs/ops/PATRON-MAGAZA-ANDROID.md` §4.2 veri güvenliği
> tablosu (§2 maddeleri o tabloyla BİREBİR tutarlı tutulur; biri değişince öbürü aynı commit'te).
>
> **Yayın:** `https://tekserp.etkiliyazilim.com/yonetim-gizlilik` · hesap silme adresi
> `https://tekserp.etkiliyazilim.com/yonetim-gizlilik#hesap-silme` (eski `/patron-gizlilik` kalıcı 301 ile buraya; çapa "Hesap silme" başlığından üretilir; Play
> formuna yazılır, başlık değişmez). Bu dosya sayfanın TEK KAYNAĞIDIR: `deploy/gizlilik-sayfasi/uret.mjs` ile
> `deploy/gizlilik-sayfasi/html/yonetim-gizlilik.html`e çevrilir. Bekçi `scripts/test_gizlilik_sayfasi.mjs`
> bayt-eşitliği, süreleri (`patron/sunucu` `IDENTITY_PURGE_DAYS` · `IP_RETENTION_DAYS` · denetim saklama
> varsayılanları) ve anlık bildirim metnini (`patron/uygulama/src/push/support.ts` `NATIVE_PUSH`, derleme kapısına bağlı;
> push köprüsü P4, 2026-11-13) koda karşı ölçer. Metin değişince sürüm kimliği ve yürürlük tarihi birlikte artar;
> yürürlük satırındaki köşeli parantezli yer tutucu, kullanıcı yayını onaylayıp tarihi yazana kadar yayını durdurur.

**Metin sürümü:** `YONETIM-GP-2026.4`
**Yürürlük:** [YAYIN ONAYINDA YAZILIR]
**Uygulama:** TeksERP Yönetim (Google Play paket adı: `com.etkiliyazilim.tekserp.yonetim`)
**Geliştirici:** Etkili Yazılım Ltd. Şti.
**İletişim:** info@etkiliyazilim.com

## 1. Uygulama ve taraflar

TeksERP Yönetim, TeksERP kullanan tekstil fabrikalarının yöneticilerine fabrikanın özet verisini (üretim,
sevkiyat, stok, finans, sipariş, cari) gösteren ve fabrikaya sipariş ve cari talebi iletmeyi sağlayan bir iş
uygulamasıdır. Hesaplar yalnız fabrikanın tesis yöneticisinin davetiyle açılır; uygulamada açık kayıt yoktur.

- **Veri sorumlusu: hesabınızı açan fabrika.** Uygulamada gördüğünüz fabrika verisi ve hesabınızla ilgili
  kişisel veriler fabrika adına işlenir; KVKK kapsamındaki başvurularınızın muhatabı fabrikadır.
- **Veri işleyen: Etkili Yazılım Ltd. Şti.** Uygulamayı ve TeksERP Yönetim sunucusunu (`yonetim.etkiliyazilim.com`,
  Türkiye'deki sunucular) fabrikanın talimatıyla işletir. Verileri kendi amaçları için kullanmaz, satmaz,
  reklam ya da profilleme için kullanmaz.

## 2. Toplanan veriler

- **Ad:** hesabınızın görünen adı; davet sırasında tesis yöneticisi girer.
- **E-posta adresi:** giriş kimliğiniz.
- **Kullanıcı kimlikleri:** hesabınızın ve tesisinizin sistem kimlikleri.
- **Hesap güvenliği:** parolanızın geri döndürülemez özeti, iki adımlı doğrulama (TOTP) sırrınız (şifreli),
  giriş ve başarısız giriş kayıtları ile bu kayıtlardaki IP adresi, hesap durumu ve izinleriniz.
- **Girdiğiniz içerik:** hesabınızla oluşturduğunuz sipariş ve cari talepleri, rapor istekleri ve sonuçları.
  Talepler fabrikanın TeksERP sistemine iletilir; orada adınız ve hesap kimliğiniz kaydın kaynağı olarak saklanır.
- **Uygulama tercihleri:** bildirim tercihleri (telefon bildirimi alacağınız türler dahil), sessiz saatler ve tesis seçimi.
- **Cihaz bildirim anahtarı (isteğe bağlı):** Android uygulamasının anlık bildirim destekli sürümünde, Bildirimler
  ekranındaki "Telefon bildirimlerini aç" adımıyla izin verirseniz telefonunuzun bildirim anahtarı (Expo push
  belirteci) ve cihaz adı alınır. Uygulamayı fabrikanın sunucusuna doğrudan bağladıysanız anahtar fabrika
  sunucusunda şifreli olarak saklanır; TeksERP Yönetim bulutuyla kullanıyorsanız bulutta cihaz kaydınız olarak
  tutulur. İzin vermezseniz anahtar alınmaz.

Toplanmayanlar:

- **Konum:** toplanmaz. IP adresi yalnız giriş güvenlik kaydında tutulur; ondan konum türetilmez.
- **Reklam kimliği ve diğer cihaz kimlikleri:** toplanmaz (yukarıdaki isteğe bağlı bildirim anahtarı dışında).
- **Finansal bilgi:** sizden toplanmaz. Uygulama fabrikanın kendi cari, çek ve stok kayıtlarını gösterir; bu
  kayıtlar fabrikanındır.
- **Rehber, fotoğraf, dosya, mikrofon:** uygulama bu izinleri istemez. Kamera izni yalnız fabrika sunucusunun
  bağlantı karekodunu okutmak için, okutma adımında istenir; görüntü saklanmaz ve gönderilmez. Bildirim izni yalnız
  anlık bildirim destekli sürümde ve siz telefon bildirimlerini açtığınızda istenir.
- **Analitik, reklam, çökme raporu:** uygulamada bu amaçlarla çalışan bir hizmet yoktur.

Cihazınızda: oturum belirteci cihazın güvenli deposunda tutulur. Son görüntülenen veri, bağlantı koptuğunda
görebilmeniz için uygulamanın korumalı alanında saklanır, cihaz yedeğine girmez ve oturumu kapattığınızda silinir.

## 3. Amaçlar

- Hesabınızın açılması, girişiniz ve izinlerinizin uygulanması.
- Hesap güvenliği; yetkisiz erişimin önlenmesi ve tespiti.
- Fabrika verisinin size gösterilmesi.
- Girdiğiniz taleplerin fabrikaya iletilmesi ve sonucunun size gösterilmesi.
- İstediğiniz bildirimlerin gönderilmesi.
- Bir uyuşmazlıkta talebin kimden geldiğinin ispatı.

## 4. Aktarım ve hizmet sağlayıcılar

- **Fabrika (veri sorumlusu):** girdiğiniz talepler fabrikanın TeksERP sistemine iletilir.
- **Barındırma:** TeksERP Yönetim sunucusu Türkiye'de yerleşik bir sunucu sağlayıcısında çalışır.
- **Cloudflare, Inc. (yurt dışı):** bağlantı güvenliği; uygulama ile sunucu arasındaki şifreli trafik
  Cloudflare ağından geçer.
- **Web bildirimleri:** aynı hesabı tarayıcıdan kullanıp bildirime izin verirseniz bildirim, tarayıcınızın
  bildirim hizmeti (ör. Google, Apple, Mozilla) üzerinden iletilir. Bildirim cari adı ve kişi adı içermez;
  toplam adet ya da tutar içerebilir.
- **Anlık bildirimler (Android, isteğe bağlı):** telefon bildirimlerini açarsanız bildirim, Google Firebase Cloud
  Messaging (FCM) ve Expo push hizmeti üzerinden iletilir (Google LLC ve 650 Industries, Inc.; yurt dışı).
  Uygulamayı fabrikanın sunucusuna doğrudan bağladıysanız bildirimin başlığı ve içeriği (tam metin; cari adı ya da
  tutar içerebilir) kilit ekranında görünebilir ve fabrikadan bu hizmetlere giderken Etkili Yazılım bulutundan
  geçer; bulutta saklanmaz ve günlüğe yazılmaz. Bulut yalnız cihaz anahtarının geri döndürülemez özetini fabrikayla
  eşleştirmek için tutar. TeksERP Yönetim bulutuyla kullanıyorsanız telefon bildirimi yalnız bildirim türünün adını
  taşır. Hangi türlerin telefonunuza geleceğini Bildirimler ekranından seçersiniz.
- **Kamu kurumları:** yalnız hukuken yetkili kurumun talebi hâlinde.

Veriler satılmaz, reklam ağlarıyla ya da başka bir üçüncü kişiyle paylaşılmaz.

## 5. Saklama

- Hesap verileriniz hesabınız açık kaldığı sürece saklanır.
- Giriş kayıtlarındaki IP adresi 30 gün sonra silinir.
- Cihaz bildirim anahtarı oturumunuzla yaşar: oturumu kapattığınızda, parolanız değiştiğinde ya da hesabınız
  kapandığında bırakılır ve o cihaza bildirim gönderilmez.
- Başarısız giriş kayıtları 90 gün, diğer güvenlik kayıtları 2 yıl saklanır ve sonra silinir.
- Hesap kapanınca girişiniz hemen kapanır; adınız, e-posta adresiniz, parolanızın özeti, doğrulama sırrınız,
  oturumlarınız ve cihaz bildirim kayıtlarınız kapanıştan 30 gün sonra silinir.
- Fabrikaya iletilmiş talepler fabrikanın kendi sisteminde, fabrikanın saklama kurallarına tabidir.

## 6. Güvenlik

- Uygulama ile sunucu arasındaki bütün trafik TLS (HTTPS) ile şifrelidir; şifresiz bağlantı kapalıdır.
- Giriş parola ve iki adımlı doğrulama (TOTP) ile yapılır; ikisi de zorunludur.
- Her hesap yalnız yetkili olduğu bölümleri görür; izinleri tesis yöneticisi verir. Her tesisin verisi ayrı
  veritabanında tutulur.
- Bulut fabrika verisini değiştiremez: girdiğiniz talep fabrikaya mesaj olarak gider ve fabrikada onaylanır.

## 7. Haklarınız

6698 sayılı KVKK md. 11 uyarınca verinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi isteme, işlenme
amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik ya da
yanlışsa düzeltilmesini, şartları oluşmuşsa silinmesini ya da yok edilmesini ve bunun aktarılanlara
bildirilmesini isteme, münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonuca itiraz etme ve
kanuna aykırı işleme nedeniyle zarara uğrarsanız zararın giderilmesini isteme haklarına sahipsiniz.

Başvurunuzu veri sorumlusu olan fabrikaya yapabilirsiniz. Etkili Yazılım'a (info@etkiliyazilim.com) gelen
başvurular fabrikaya iletilir. Başvurular en geç 30 gün içinde sonuçlandırılır.

## 8. Çocuklar

Uygulama işyeri kullanımı içindir ve 18 yaş altına yönelik değildir; 18 yaş altındaki kişilerden bilerek veri
toplanmaz.

## 9. Hesap silme

Hesabınızı uygulamanın içinden kendiniz silebilirsiniz:

- **Profil → Hesabımı sil** adımını açın ve silmeyi parolanız ile iki adımlı doğrulama (TOTP) koduyla onaylayın.
- Bir tesisin tek hesap yöneticisiyseniz, silmeden önce o tesiste başka bir yönetici atanmalıdır.
- Hesabınız hemen kapanır: oturumlarınız sona erer, e-posta adresinize bağlı bütün tesis üyelikleriyle giriş
  yapılamaz; kabul edip henüz onaylamadığınız davetler de kapanır ve yeniden kullanılamaz.
- Kapanıştan sonraki 30. günde adınız, e-posta adresiniz, parolanızın özeti, doğrulama sırrınız, oturumlarınız
  ve cihaz bildirim kayıtlarınız silinir; geçmiş kayıtlarda adınızın yerine "Silinmiş hesap" yazar.
- **Saklanan istisna:** hesap güvenlik kayıtları (giriş olayları ve hesapta yapılan değişiklikler) yetkisiz
  erişimin tespiti için 5. maddedeki sürelerle (başarısız giriş 90 gün, diğerleri 2 yıl) saklanır ve sonra
  silinir; bu kayıtlardaki IP adresi 30 gün sonra çıkarılır. Fabrikaya iletilmiş talepler fabrikanın kendi
  sisteminde, fabrikanın kurallarına tabidir.

Uygulamaya erişiminiz yoksa (cihazınızı ya da doğrulama kodunuzu kaybettiyseniz):

- Tesis yöneticinize başvurun ya da hesabınıza kayıtlı e-posta adresinizden info@etkiliyazilim.com adresine
  "Hesabımı sil" konulu bir e-posta gönderin. Başka bir adresten gelen istekte kimliğiniz ayrıca doğrulanır.
- İsteğiniz en geç 30 gün içinde sonuçlanır; hesabınız yukarıdaki gibi kapatılır ve silinir.

## 10. Değişiklikler

Politika değiştiğinde bu sayfa güncellenir; metin sürümü ve yürürlük tarihi değişir.

## 11. İletişim

Etkili Yazılım Ltd. Şti. — info@etkiliyazilim.com. KVKK başvuruları için veri sorumlusu olan fabrikaya
başvurabilirsiniz (7. madde).
