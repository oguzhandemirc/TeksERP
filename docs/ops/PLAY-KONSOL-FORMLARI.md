# Google Play Console — TeksERP form cevapları (kopyala-yapıştır)

> **Uygulama:** TeksERP · `com.etkiliyazilim.tekserp` · bugün Dahili test 1.1.0 (versionCode 59, commit `58e61f608`).
> **Hazırlanış:** 2026-10-08 gecesi, salt hazırlık; konsola hiçbir şey girilmedi. Her cevap KODDAN ölçüldü
> (kaynak sütunu / "Ölçüm" notları). Ölçülemeyen Play kuralları **⚠ WEB'DEN DOĞRULANMALI** diye işaretli —
> bu belge Play politikası hakkında kesin hüküm vermez.
> **Konsol dili:** başlıklar Türkçe konsol yazımına yakın yazıldı; konsoldaki birebir yazım küçük farklılık gösterebilir.
> **Sabah karar verilecekler:** §0. İlgili belgeler: `PLAY-STORE-YAYIN.md` (§9'daki eskiyen yerlere göre 2026-10-08'de yeniden yazıldı), `../legal/GIZLILIK-POLITIKASI.md` (§1.1'deki hatalar 2026-10-08'de §1.2 metniyle hizalandı).

---

## 0. Sabah karar verilecekler (kısa)

| # | Soru | Öneri | Neden |
|---|---|---|---|
| K1 | Gereksiz izinler/hizmetler kaldırılsın mı? (ön plan hizmeti `mediaPlayback` + `microphone`, `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`/`USE_FINGERPRINT`) | **Evet, kapalı teste çıkmadan önce yeni AAB (vc 60)** | Uygulama bunların hiçbirini kullanmıyor (§4). Kalırsa "Ön plan hizmetleri" beyanı + video istenir ve gerçek olmayan bir kullanım beyan edilmiş olur. |
| K2 | Gizlilik politikası nerede yayınlansın? | `https://etkiliyazilim.com/tekserp/gizlilik` (şirket sitesi, düz HTML sayfa) | Play herkese açık, giriş istemeyen, coğrafi kısıtsız, PDF olmayan etkin bir adres ister (⚠ web'den doğrulanmalı). `indir.` alt alanı Worker/VDS koduna dokunmayı gerektirir; şirket sitesi en az hareketli parça. |
| K3 | "Veriler aktarım sırasında şifreleniyor mu?" | **Hayır** (bugün dürüst cevap) | Fabrika sunucusuna bağlantı düz HTTP olabilir (`usesCleartextTraffic=true`; LAN TLS yeni kurulumda "dual", sabitleme isteğe bağlı). Bütün kurulumlar TLS'e zorlanınca "Evet"e çevrilir. |
| K4 | İnceleme için demo sunucu + deneme hesabı | `demo.etkiliyazilim.com` (2026-08-14 runbook'u) bugün ayakta mı, 1.1.0 tabletle uyumlu mu — **ölçülmedi**; kapalı teste çıkmadan hazırlanmalı | Uygulama giriş istiyor ve sunucu adresi gömülü değil; incelemeci bağlanamazsa "işlevsiz uygulama" reddi gelir. |
| K5 | Dağıtım yolu: kişisel hesapta Managed Google Play gizli yayın mı, kapalı test → üretim mi? | §6'daki üç soru web'den doğrulanınca karar | Hesap KİŞİSEL çıktı (2026-10-08); "gizli yayın" kararı (K-14, 2026-10-07) kurumsal hesap varsayımıyla verilmişti. |
| K6 | İletişim e-postası | Kullanıcı yazar | Eski taslakta `info@etkiliyazilim.com` geçiyor; o adresin gerçekten okunduğunu kullanıcı doğrulamalı. Mağazada herkese açık görünür. |

---

## 1. Uygulama içeriği → Gizlilik politikası

**Alan:** Gizlilik politikası URL'si → K2'de seçilen adres.

### 1.1 Eski taslağın (`docs/legal/GIZLILIK-POLITIKASI.md`) eskiyen yerleri — 2026-10-08'de düzeltildi (o dosya artık §1.2 metnini taşır)

- Paket adı `com.teks.erp.mobil` → bugün `com.etkiliyazilim.tekserp`; ad "TeksERP Mobil" → "TeksERP".
- "Çökme raporlama yok" → tablet yakalanmamış JS hatasının sınıfını, yığınını, ekran adını ve sürümünü fabrika sunucusuna gönderir (`mobil/src/lib/errorReport.ts`, mesaj metni gönderilmez); fabrika sunucusu bunu yalnız müşteri onayıyla bize iletir (varsayılan KAPALI, `docs/kurallar/lisans.md`).
- "Üçüncü taraf SDK yok" → barkod çözümü Google ML Kit (`com.google.mlkit:barcode-scanning`, `expo-camera` getiriyor) ve AAB'de Google `datatransport` (CCT) arka ucu var; ML Kit'in Google'a kullanım/performans ölçümü gönderip göndermediği ⚠ web'den doğrulanmalı (§3.3).
- "Çevrimdışı kuyruk ve önbellek oturum kapatılınca temizlenir" → YANLIŞ: çıkışta kullanıcıya özel okuma önbelleği silinir, gönderilmemiş işlem kuyruğu bilerek SİLİNMEZ (bir sonraki girişte gönderilir; `mobil/src/offline/flushThenLogout.ts`).
- Toplanan veriye eklenmeli: sevkiyatta şoför adı + araç plakası (`FasonSevk`), giriş ekranında kullanıcı listesi (ad), hızlı PIN ve personel kartı ile giriş.
- Güncelleme sunucusu (`indir.etkiliyazilim.com`, Cloudflare) anılmamış.
- §5 demo adresi canlı mı bilinmiyor (K4).

### 1.2 Yeni gizlilik politikası METNİ taslağı (yayınlanacak sayfanın içeriği)

> Hukuki görüş değildir; yayından önce KVKK/GDPR açısından hukukçu gözden geçirmeli. `[…]` alanları kullanıcı doldurur.

```text
TeksERP — Gizlilik Politikası
Son güncelleme: [YAYIN TARİHİ]
Uygulama: TeksERP (Google Play paket adı: com.etkiliyazilim.tekserp)
Geliştirici: Etkili Yazılım — [TİCARET UNVANI], [ADRES]
İletişim: [E-POSTA]

1. Uygulamanın niteliği
TeksERP, tekstil fabrikalarında üretim, kalite, depo ve sevkiyat işlemlerinin kaydı
için kullanılan bir iş uygulamasıdır. Uygulama tek başına çalışmaz: kullanan
fabrikanın KENDİ sunucusunda kurulu TeksERP sistemine bağlanır. Sunucu adresi
uygulamada ağ taraması veya elle giriş ile belirlenir; uygulamada hiçbir fabrika
sunucusunun adresi gömülü değildir.
Bu nedenle uygulamaya girilen iş verilerinin ve personel bilgilerinin veri
sorumlusu, uygulamayı kullanan fabrikadır (işveren). Etkili Yazılım bu verileri
toplamaz, kendi sunucularında saklamaz ve bunlara erişmez; aşağıda 5. maddede
sayılan sınırlı teknik veriler istisnadır.

2. Uygulamanın fabrika sunucusuna gönderdiği veriler
- Kimlik doğrulama: kullanıcı adı ve parola, hızlı giriş PIN'i veya personel kartı
  kodu. Bunlar yalnız giriş anında fabrika sunucusuna gönderilir, cihazda
  saklanmaz. Fabrika sunucusu PIN'i ve kart kodunu geri çevrilemez özet olarak tutar.
  Girişten sonra oturum anahtarı cihazın güvenli deposunda (Android Keystore) tutulur.
- Kullanıcı listesi: giriş ekranında, fabrika sunucusundaki kullanıcıların adları
  seçim için gösterilir.
- Cihaz kimliği: uygulamanın ilk açılışta ürettiği rastgele bir tanımlayıcı. Fabrika
  yöneticisinin tableti tanıması ve istasyona ataması için kullanılır; reklam
  kimliği veya donanım kimliği değildir.
- İş kayıtları: okutulan barkodlar, metraj, ağırlık, kalite kararları, açıklama
  notları, sevkiyatta şoför adı ve araç plakası gibi operatörün girdiği bilgiler ve
  bu işlemleri hangi kullanıcının ne zaman yaptığı.
- Teknik hata bilgisi: uygulama beklenmedik bir hatayla karşılaştığında hatanın türü,
  teknik yığın bilgisi, ekran adı ve uygulama sürümü. Hata mesajının metni ve iş
  verisi gönderilmez.
Ağ bağlantısı yokken yapılan işlemler cihazda geçici olarak sıraya alınır ve
bağlantı gelince fabrika sunucusuna gönderilir.

3. Kamera, Bluetooth ve konum
- Kamera yalnız barkod ve QR kod okumak için kullanılır. Görüntü cihazda işlenir;
  fotoğraf veya video kaydedilmez ve gönderilmez.
- Bluetooth; metre, kantar ve etiket yazıcısı gibi fabrika cihazlarına bağlanmak
  için kullanılır.
- Konum izni yalnız Android 11 ve önceki sürümlerde, işletim sistemi Bluetooth
  cihaz taraması için bu izni zorunlu tuttuğu için istenir. Uygulama konumunuzu
  okumaz, kaydetmez ve göndermez.
- Uygulama mikrofon, rehber, arama kaydı, SMS, fotoğraf arşivi veya sağlık verisi
  kullanmaz. Uygulamada reklam yoktur ve reklam kimliği kullanılmaz.

4. Uygulama güncellemeleri
Uygulama, küçük güncellemeleri Etkili Yazılım'ın güncelleme sunucusundan
(indir.etkiliyazilim.com) indirir. Bu istekte uygulama sürümü ve fabrikanın
güncelleme grubunu belirten bir indirme belirteci gönderilir; kişisel veri ve iş
verisi gönderilmez. Sunucu, internet altyapısı gereği bağlantının IP adresini görür.
Büyük güncellemeler Google Play üzerinden gelir.

5. Etkili Yazılım'a ulaşan veriler
- Güncelleme istekleri (4. madde).
- Fabrika yöneticisi açıkça onay verirse, fabrika sunucusu teknik hata bilgilerini
  (2. maddedeki "teknik hata bilgisi"; kullanıcı adı ve iş verisi olmadan) arıza
  teşhisi için Etkili Yazılım'a iletir. Bu ayar varsayılan olarak kapalıdır.
- Barkod okuma, Google'ın ML Kit kütüphanesiyle cihaz üzerinde yapılır. Google'ın
  bu kütüphane için topladığı teknik veriler Google'ın kendi politikasına tabidir:
  [ML KIT VERİ AÇIKLAMASI BAĞLANTISI — doğrulandıktan sonra].

6. Paylaşım
Veriler satılmaz, reklam amacıyla kullanılmaz ve üçüncü taraflarla paylaşılmaz.
Fabrika sunucusundaki verilerin kimlerle paylaşılacağına fabrika karar verir.

7. Saklama ve güvenlik
- Oturum anahtarı ve cihaz kimliği Android Keystore korumalı güvenli depoda tutulur.
- Fabrika sunucusundaki verilerin saklama süresi, yedeklenmesi ve silinmesi
  fabrikanın sorumluluğundadır.
- Fabrika sunucusuyla bağlantı, fabrikanın ayarına göre şifreli (HTTPS) ya da
  fabrikanın kendi iç ağında şifresiz olabilir. Güncelleme sunucusuyla bağlantı her
  zaman şifrelidir.

8. Hesaplar ve silme
Kullanıcı hesapları uygulama içinden açılamaz; fabrika yöneticisi tarafından açılır
ve kapatılır. Hesabınızın ve verilerinizin silinmesi için önce fabrikanızın
yöneticisine başvurun. Etkili Yazılım'a ulaşan teknik verilerin silinmesi için:
[E-POSTA].

9. Haklarınız
6698 sayılı KVKK md. 11 ve uygulanabildiği ölçüde GDPR kapsamındaki haklarınızı,
verilerinizin sorumlusu olan fabrikaya (işvereninize) karşı kullanabilirsiniz.
Etkili Yazılım'a ilişkin talepler: [E-POSTA].

10. Çocuklar
Uygulama işyeri kullanımı içindir; 18 yaş altına yönelik değildir.

11. Değişiklikler
Politika değiştiğinde bu sayfa güncellenir ve "son güncelleme" tarihi değişir.
```

---

## 2. Uygulama içeriği → Uygulama erişimi

**Soru:** "Uygulamanızdaki tüm işlevler özel erişim gerektirmeden kullanılabilir mi?"
**Cevap:** **Tüm işlevler veya bazı işlevler kısıtlanmış** (giriş gerekiyor).

**Ne zaman gerekli:** Dahili test incelemeden geçmeden yayınlandı (vc 59 bugün yayında). Kapalı test, açık test ve üretim (ve Managed Google Play gizli yayın) İNCELEMEYE girer → bu form ve çalışan bir demo sunucu ondan ÖNCE hazır olmalı.

**Talimat alanı (kopyala; `[…]` alanlarını kullanıcı doldurur):**

```text
TeksERP bir fabrika iş uygulamasıdır; fabrikanın kendi sunucusuna bağlanır.
İnceleme için internete açık bir demo sunucusu hazırladık.

1) Uygulamayı açın. "Sunucuyu bul" ekranı gelir.
2) "Adresi elle gir" düğmesine dokunun.
3) Şema olarak "https" seçin; IP / Host: [DEMO ALAN ADI] ; Port: 443 ; kaydedin.
4) Giriş ekranında "Kullanıcı Seç" ile [DEMO KULLANICI ADI] kullanıcısını seçin,
   Parola alanına [DEMO PAROLASI] yazın.
5) Modül ekranından bir modül açın (ör. Depo). Barkod okutmak için kamera izni
   istenir; demo verisindeki örnek barkod: [ÖRNEK BARKOD].
Bluetooth ile bağlanan metre/kantar/yazıcı fabrika donanımıdır; demo hesabında
cihaz "simülasyon" kipindedir, gerçek donanım gerekmez.
```

Konsoldaki alanlar: Ad ("Demo hesabı") · Kullanıcı adı · Parola · "Diğer bilgiler" (yukarıdaki metin) · "Giriş için başka bilgi gerekli mi" → talimat yeterli.

**Demo sunucu ön koşulları (koddan ölçülen):**
- HTTPS ve alan adı: sunucu adresi ekranı `https` + ana makine adı + port kabul ediyor (`mobil/src/components/ServerAddressSheet.tsx`, `mobil/src/store/baseUrlStore.ts`). Port alanı boş bırakılırsa 4000'e düşer → talimatta 443 yazılı.
- Cihaz onayı KAPALI kalmalı (`device.pairingRequired` varsayılan `false`, `Teks-Erp/src/middlewares/device.middleware.ts`); açıksa incelemecinin tableti "atama bekleniyor" ekranında takılır.
- Tablette iki adımlı giriş yok (yalnız parola / PIN / kart) → incelemeci TOTP'ye takılmaz.
- Lisans: demo kurulumu kısıtlı kipte olmamalı (lisans kapısı kısıtlı kipte yazmayı durdurur).
- Demo hesabı sınırlı yetkili, yıkıcı yetkisiz; gerçek müşteri verisi yok; seed parolaları kullanılmaz (`PLAY-STORE-YAYIN.md` §1.3 şartları hâlâ geçerli).
- Simülasyon cihaz verisi (`PeripheralDevice.simulate`) demo istasyonlarında açık olmalı ki metre/kantar adımları donanımsız ilerlesin — ⚠ demo seed'inde var mı ölçülmedi.

---

## 3. Uygulama içeriği → Reklamlar · Veri güvenliği · Hedef kitle · Derecelendirme

### 3.1 Reklamlar
**"Uygulamanız reklam içeriyor mu?"** → **Hayır.** (AAB'de reklam SDK'sı ve `com.google.android.gms.permission.AD_ID` yok — ölçüldü.)

**Reklam kimliği beyanı** ("Uygulamanız reklam kimliği kullanıyor mu?") → **Hayır.**

### 3.2 Hedef kitle ve içerik
- Hedef yaş grupları: yalnız **18 ve üzeri**.
- "Uygulamanız çocukların ilgisini çekebilir mi?" → **Hayır** (fabrika iş uygulaması; oyun/karakter/çocuk teması yok).
- Mağaza girişi çocuklara yönelik değil; Aileler programına katılım yok.

### 3.3 Veri güvenliği formu

**Ölçüm özeti (ne gidiyor, nereye):**

| Veri | Uygulamadan nereye | Kaynak |
|---|---|---|
| Kullanıcı adı + parola / hızlı PIN / kart kodu | fabrika sunucusu (`/auth/login`, `/auth/login-quick-pin`, `/auth/login-card`) | `mobil/src/services/auth.service.ts` |
| Kullanıcı listesi (ad soyad) | fabrika sunucusundan tablete (giriş ekranı) | `/auth/mobile-users` |
| Cihaz kimliği (rastgele UUID v4, SecureStore) | fabrika sunucusu, her istekte + `devices/announce` | `mobil/src/utils/deviceId.ts` |
| İş kayıtları, serbest metin notlar, şoför adı + plaka | fabrika sunucusu | `mobil/src/services/packing.service.ts`, `FasonSevk` |
| Hata bilgisi (sınıf, yığın, ekran, sürüm; mesaj YOK) | fabrika sunucusu; oradan bize yalnız müşteri onayıyla | `mobil/src/lib/errorReport.ts`, `docs/kurallar/lisans.md` |
| OTA isteği (sürüm + indirme belirteci) | `indir.etkiliyazilim.com` (Cloudflare) | `mobil/app.json` `updates.url`, `UpdateGate.tsx` |
| ML Kit / Google datatransport (CCT) | Google | AAB manifesti: `com.google.android.datatransport…CctBackendFactory`, `com.google.mlkit…` |
| Kamera görüntüsü | GİTMEZ (cihazda çözülür; `takePicture` yok) | `BarcodeScannerView.tsx` |
| Konum | GİTMEZ (izin yalnız Android ≤11 BT taraması için istenir) | `btClassic.transport.ts` |

> **Yorum (⚠ web'den doğrulanmalı):** Play'in tanımında "toplama", verinin uygulamadan cihaz dışına aktarılmasıdır; verinin bizim değil müşterinin sunucusuna gitmesi bunu değiştirir mi belirsiz. Bu belge **muhafazakâr** yolu seçer: fabrika sunucusuna giden kişisel veriyi "toplanıyor" diye beyan eder. Az beyan ret/yaptırım riski taşır; fazla beyan yalnız mağaza görünümünü etkiler.

**Soru 1 — "Uygulamanız, gerekli kullanıcı veri türlerinden herhangi birini toplıyor veya paylaşıyor mu?"** → **Evet.**

**Soru 2 — "Toplanan tüm kullanıcı verileri aktarım sırasında şifreleniyor mu?"** → **Hayır** (K3).

**Soru 3 — Hesap oluşturma:** "Uygulamanız kullanıcıların hesap oluşturmasına izin veriyor mu?" → **Hayır** — hesaplar fabrika yöneticisince panelde açılır, uygulamada kayıt ekranı yok. Kullanıcılar uygulama dışında oluşturulan hesapla giriş yapar. ⚠ Konsol bu durumda yine de "hesap silme URL'si" isterse: gizlilik sayfasının §8 bağlantısı (`…/gizlilik#hesaplar`) verilir. Play'in hesap silme şartının yalnız uygulama içinden hesap açılabilen uygulamalara uygulandığı anlaşılıyor — **web'den doğrulanmalı**.

**Soru 4 — "Kullanıcıların verilerinin silinmesini isteyebilecekleri bir yol sağlıyor musunuz?"** (isteğe bağlı) → **Evet** — fabrika yöneticisine başvuru + gizlilik sayfasındaki e-posta.

**Soru 5 — Bağımsız güvenlik incelemesi (MASA)** → **Hayır.**

**Veri türleri** (her biri için: Toplanıyor / Paylaşılmıyor / Geçici işlenmiyor / Zorunlu / Amaç):

| Kategori → tür | Toplanıyor | Paylaşılıyor | Geçici mi | Zorunlu mu | Amaç |
|---|---|---|---|---|---|
| Kişisel bilgiler → **Ad** | Evet (şoför adı, kullanıcı adı soyadı) | Hayır | Hayır | Zorunlu | Uygulama işlevselliği |
| Kişisel bilgiler → **Kullanıcı kimlikleri** | Evet (kullanıcı adı, PIN/kart ile giriş) | Hayır | Hayır | Zorunlu | Uygulama işlevselliği, Hesap yönetimi |
| Uygulama etkinliği → **Kullanıcı tarafından oluşturulan diğer içerik** | Evet (notlar, sebep açıklamaları) | Hayır | Hayır | Zorunlu | Uygulama işlevselliği |
| Uygulama etkinliği → **Diğer işlemler** | Evet (hangi kullanıcı hangi işlemi ne zaman yaptı) | Hayır | Hayır | Zorunlu | Uygulama işlevselliği, Sahtekârlığı önleme/güvenlik ve uygunluk |
| Uygulama bilgileri ve performans → **Kilitlenme günlükleri** | Evet (hata sınıfı + yığın) | Hayır | Hayır | Zorunlu (kullanıcı kapatamaz; iletim müşteri onayına bağlı) | Analiz |
| Uygulama bilgileri ve performans → **Teşhis** | ⚠ ML Kit açıklamasına göre (aşağı) | — | — | — | — |
| Cihaz veya diğer kimlikler → **Cihaz veya diğer kimlikler** | Evet (rastgele cihaz UUID'si) | Hayır | Hayır | Zorunlu | Uygulama işlevselliği, Sahtekârlığı önleme/güvenlik ve uygunluk |

Toplanmayan (işaretleme): Konum (yaklaşık/kesin), Finansal bilgiler, Sağlık ve fitness, Mesajlar, Fotoğraflar ve videolar, Ses dosyaları, Müzik, Dosyalar ve dokümanlar, Takvim, Kişiler, Web'de gezinme, E-posta adresi, Telefon numarası, Adres, Uygulama etkileşimleri, Uygulama içi arama geçmişi, Yüklü uygulamalar.

> **Telefon/e-posta notu:** Tablet müşteri şubesinin iletişim telefonunu yalnız OKUR (`customerBranch.service.ts`), göndermez — beyan gerekmez.
>
> **ML Kit (⚠ web'den doğrulanmalı):** Barkod okuma Google ML Kit'in uygulamaya gömülü modeliyle yapılıyor; AAB'de Google'ın `datatransport` (CCT) günlük arka ucu var. Google'ın "ML Kit — Google Play veri açıklaması" sayfasındaki listeye (ör. cihaz/uygulama bilgisi, performans ölçümü) göre ilgili satırlar ("Teşhis", gerekirse "Cihaz veya diğer kimlikler") eklenmeli ve amaç sütunu oradan alınmalı. Sayfa okunmadan bu satır boş bırakılmamalı.

### 3.4 İçerik derecelendirmesi (IARC anketi)
- E-posta: kullanıcının iletişim adresi.
- Kategori: **Tüm Diğer Uygulama Türleri** (oyun değil; sosyal/iletişim, haber, eğlence, mağaza değil).
- Şiddet / korku / cinsellik / müstehcen dil / uyuşturucu-alkol-tütün / kumar / ayrımcılık: **hepsi Hayır**.
- "Kullanıcılar ses, metin veya görüntü paylaşarak birbiriyle etkileşebiliyor mu?" → **Hayır** (öneri). Gerekçe: aynı fabrikadaki iş kaydına not yazılabiliyor ama mesajlaşma/sohbet/paylaşım özelliği yok; içerik yalnız aynı kuruluşun iş kayıtlarında görünür. ⚠ Kullanıcı isterse "Evet" de savunulabilir; derecelendirmeyi değiştirmez, yalnız "Kullanıcılar etkileşimde bulunur" etiketi ekler.
- "Konumu diğer kullanıcılarla paylaşıyor mu?" → **Hayır.**
- "Dijital mal satın alma?" → **Hayır.**
- "Sınırsız internet erişimi / web tarayıcı?" → **Hayır** (yalnız Play sayfası bağlantısı açılır, `playStore.ts`).
- Beklenen sonuç: 3+ / PEGI 3 / "Herkes" sınıfı.

### 3.5 Devlet uygulamaları
"Uygulamanız bir devlet kurumu tarafından veya onun adına mı geliştirildi?" → **Hayır.**

### 3.6 Finans özellikleri
"Uygulamanız aşağıdaki finansal özelliklerden herhangi birini sunuyor mu?" → **Uygulamam finansal özellik sunmuyor.** (Tablet modüllerinde ödeme/kredi/kripto/bankacılık yok; ERP'nin cari/kasa modülleri yalnız masaüstü panelde.)

### 3.7 Sağlık
"Uygulamanızda sağlık özellikleri var mı?" → **Hayır / Uygulamamın sağlık özelliği yok.**

### 3.8 Haber uygulaması
"Uygulamanız haber uygulaması mı?" → **Hayır.**

---

## 4. İzinler ve izin beyanları (koddan + AAB vc 59 manifestinden ölçüldü)

**Ölçüm yolu:** `unzip … base/manifest/AndroidManifest.xml` + `base/resources.pb` → sahte proto paket → `aapt2 dump xmltree` (build-tools 36.0.0). targetSdk 36, minSdk 26, `usesCleartextTraffic=true`.

| İzin / öğe (AAB'de) | Nereden geliyor | Uygulama kullanıyor mu | Play beyanı | Öneri |
|---|---|---|---|---|
| `CAMERA` | `app.json` + `expo-camera` | Evet — barkod/QR | Yok | Kalsın |
| `BLUETOOTH`, `BLUETOOTH_ADMIN` (maxSdk 30), `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (`neverForLocation`) | `app.json` + BT kütüphaneleri | Evet — metre/kantar/yazıcı (BT-Classic) | Yok | Kalsın |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (sınırsız + `-sdk-23`) | `app.json` | Yalnız Android ≤11'de BT taraması için istenir (`btClassic.transport.ts`) | Arka plan konumu yok → konum beyanı gerekmez | `maxSdkVersion=30` ile sınırla (eski açık iş; saha BT denemesinden sonra) |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS` | şablon / netinfo / haptics / expo-audio | Evet | Yok | Kalsın |
| **`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`**, hizmet `expo.modules.audio.service.AudioControlsService` (`mediaPlayback`) | `expo-audio` kütüphane manifesti | **Hayır** — ses yalnız ön planda kısa okutma bipi (`scanFeedback.ts`, `createAudioPlayer`); kilit ekranı/arka plan çalma yok | **Ön plan hizmetleri beyanı + video istenir** | **KALDIR** (K1) |
| Hizmet `expo.modules.audio.service.AudioRecordingService` (`microphone`) | `expo-audio` | **Hayır** — `RECORD_AUDIO` zaten engelli, kayıt kodu yok | ⚠ Konsol bu türü de sorabilir (izin yok ama hizmet türü var) | **KALDIR** (K1) |
| **`SYSTEM_ALERT_WINDOW`** | Expo prebuild şablonu (`@expo/config-plugins` `withAndroidBaseMods`, "OPTIONAL PERMISSIONS") | **Hayır** — başka uygulamaların üstünde çizim yok | Özel izin; mağaza sayfasında "diğer uygulamaların üzerinde görüntüleme" diye görünür | **KALDIR** (`blockedPermissions`) |
| **`USE_BIOMETRIC`, `USE_FINGERPRINT`** | `expo-secure-store` → `androidx.biometric:biometric:1.1.0` kütüphane manifesti | **Hayır** — `requireAuthentication` hiçbir yerde kullanılmıyor | Yok (normal izin) ama listede "biyometrik donanım" görünür | **KALDIR** (`blockedPermissions`) |
| `REQUEST_INSTALL_PACKAGES`, `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE` | — | — | — | Zaten engelli (ölçüldü: AAB'de yok) |

### 4.1 Kaldırma önerisi (DEĞİŞİKLİK YAPILMADI — K1 onayı bekler)

1. `mobil/app.json` → `android.blockedPermissions`e ekle: `android.permission.SYSTEM_ALERT_WINDOW`, `android.permission.USE_BIOMETRIC`, `android.permission.USE_FINGERPRINT`, `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `android.permission.FOREGROUND_SERVICE`.
2. Küçük config eklentisi (`mobil/plugins/`, `withAndroidManifest`): iki expo-audio hizmetini `tools:node="remove"` ile manifestten çıkar (`.service.AudioControlsService`, `.service.AudioRecordingService`). Yalnız izni engellemek hizmet beyanını bırakır; `foregroundServiceType` beyanı konsolda yine soru doğurabilir.
3. Native değişiklik → `runtimeVersion` artışı + yeni AAB (vc 60) (`mobil/CLAUDE.md`: izin = Play/AAB işi, OTA ile gitmez).
4. Doğrulama: AAB manifestinde bu dört izin + iki hizmet yok (yukarıdaki aapt2 yolu); emülatörde okutma bipi + titreşim çalışıyor; giriş/oturum anahtarı SecureStore'dan okunuyor.
5. Risk: düşük. Okutma bipi ön planda `createAudioPlayer().play()` — ön plan hizmeti başlatmaz: expo-audio 1.1.1 kaynağında `AudioControlsService` yalnız `setActiveForLockScreen(true)` ile başlatılıyor (`AudioPlayer.kt`), uygulamada bu çağrı yok; `clearSession()` örnek yoksa hiçbir şey yapmıyor; `AudioRecordingService` yalnız kayıt başlayınca (`AudioRecorder.kt`) — kayıt kodu yok. Ölçülmesi gereken tek şey bipin hâlâ çalması.

### 4.2 Kaldırılmazsa: Ön plan hizmetleri beyanı (önerilmez)
Konsol her FGS türü için görev açıklaması, kesintiye uğrarsa kullanıcı etkisi ve **video bağlantısı** ister (⚠ biçim web'den doğrulanmalı). TeksERP'de bu hizmetleri tetikleyen bir kullanıcı akışı OLMADIĞI için dürüst bir video çekilemez; uydurma kullanım beyanı politika ihlali riski taşır → tek temiz yol 4.1.

### 4.3 Diğer hassas izin beyanları
Tam ekran bildirim, kesin alarm, erişilebilirlik, tüm dosyalara erişim, `QUERY_ALL_PACKAGES`, fotoğraf/video izinleri, arka plan konumu, SMS/arama kaydı, VPN: **hiçbiri yok** (AAB'de ölçüldü) → beyan gerekmez.

---

## 5. Mağaza girişi taslağı (Ana mağaza girişi)

- **Uygulama adı:** TeksERP
- **Kategori:** Uygulama → **İş** (alternatif: Verimlilik)
- **Etiketler (öneri):** İş yönetimi, Envanter, Üretim — ⚠ konsolun etiket listesinden seçilir.
- **İletişim e-postası:** `[KULLANICI DOLDURUR]` (K6) · Web sitesi: `https://etkiliyazilim.com` (isteğe bağlı) · Telefon: boş bırakılabilir.

**Kısa açıklama** (75 karakter, sınır 80):

```text
Tekstil fabrikası üretim takibi: barkodla kalite, tambur, depo ve sevkiyat.
```

**Tam açıklama** (1755 karakter, sınır 4000):

```text
TeksERP, tekstil fabrikalarında sahada çalışan ekipler için geliştirilmiş üretim
takip uygulamasıdır. Fabrikanızın kendi sunucusunda çalışan TeksERP sistemine
bağlanır; kumaş topunun stoktan sevkiyata kadar her adımını tablet veya telefondan
barkod okutarak kaydetmenizi sağlar.

ÖNEMLİ: Uygulama tek başına kullanılmaz. TeksERP sunucusu kurulu bir işletmede,
fabrika yöneticisinin açtığı kullanıcı hesabıyla çalışır. Hesap uygulama içinden
açılamaz.

NELER YAPABİLİRSİNİZ
• Giriş kalite kontrolü: topları okutun, metraj ve kalite kararını girin.
• Tambur ve kesim: topu kesin, parçaları kaydedin, etiketini basın.
• Kurşun dağıtımı ve proses kalite kontrolü.
• Depo: topları okutarak yerleştirin, sayın ve bulun.
• Tartı ve paketleme: çuval oluşturun, tartın, etiketleyin.
• Sevkiyat: çuvalları okutarak sevkiyata ekleyin, belgeleri yazdırın.
• Fason ve kartela: fasona gönderin, geri kabul edin.
• İade girişi, hızlı iş emri, dokuma ve sipariş ekranları.

SAHAYA UYGUN
• Kamera ile barkod ve QR okuma; el tipi barkod okuyucu desteği.
• Bluetooth metre, kantar ve etiket yazıcısı bağlantısı.
• Ağ kesildiğinde istasyon kayıtları cihazda sıraya alınır, bağlantı gelince gönderilir.
• Okutmada sesli ve titreşimli geri bildirim: kabul, tekrar ve ret ayrı sinyal verir.
• Kullanıcı adı ve parola, hızlı PIN veya personel kartıyla giriş.
• Tablette yatay, telefonda dikey kullanım.

SUNUCUNUZU BULUR
Uygulama ilk açılışta yerel ağdaki TeksERP sunucusunu arar; bulamazsa adresi
elle girebilirsiniz. Fabrika ağında şifreli bağlantı desteklenir.

VERİLERİNİZ SİZDE
Üretim verileriniz fabrikanızın kendi sunucusunda tutulur. Uygulamada reklam
yoktur, konumunuz okunmaz, kamera görüntüsü kaydedilmez veya gönderilmez.

TeksERP, Etkili Yazılım tarafından geliştirilmektedir.
```

**Grafik varlıkları (repoda ölçüldü, `mobil/assets/`):**

| Varlık | Play şartı | Repoda | Durum |
|---|---|---|---|
| Uygulama simgesi | 512×512 PNG (32 bit) | `icon.png` 1024×1024 RGB (alfa yok), `logo.png` 1024×1024 | 512'ye küçültülüp dışa aktarılmalı |
| Öne çıkan grafik | 1024×500 PNG/JPEG | YOK | Üretilecek |
| Telefon ekran görüntüleri | en az 2 (⚠ sayı/boyut web'den doğrulanmalı) | YOK | Üretilecek |
| 7 inç / 10 inç tablet ekran görüntüleri | tablet listelemesi için önerilir | YOK | Üretilecek (emülatör: `adb exec-out screencap`, demo sunucusu verisiyle; gerçek müşteri verisi GÖRÜNMEMELİ) |
| Tanıtım videosu | isteğe bağlı | YOK | — |

---

## 6. Hesap türü etkisi (hesap KİŞİSEL — 2026-10-08)

Kodda/belgede ölçülebilen tek bilgi `PLAY-STORE-YAYIN.md` §4'teki şart; aşağıdakilerin hepsi **⚠ web'den doğrulanmalı**:

1. **Üretim erişimi:** 13 Kasım 2023 sonrası açılan kişisel hesapta üretime çıkmak için **en az 12 test kullanıcısının 14 gün kesintisiz** kapalı teste katılmış olması ve ardından üretim erişimi başvurusu (belgede yazılı; güncel sayı ve süre doğrulanmalı — Google bu eşiği değiştirmiş olabilir).
2. **Managed Google Play gizli (private) uygulama:** kişisel geliştirici hesabından yayınlanabiliyor mu, ve yayınlanırsa 12×14 şartına tabi mi — **kodda/belgede bilgi YOK**. Ayrıca gizli yayın, fabrikanın tabletlerinin bir kuruluşa (Managed Google Play / Android Enterprise) bağlanmasını gerektirir; bu, "fabrika başına tek Gmail" önerisiyle çelişebilir — doğrulanmalı.
3. **Hesap türü değişimi:** kişisel hesabın kuruluş hesabına çevrilip çevrilemeyeceği ve D-U-N-S şartı. (Hafızadaki "kurumsal hesap zaten var" notu 2026-10-08'de konsolda yanlışlandı.)

Sonuç: K-14'teki "gizli yayın" kararı (2026-10-07) kurumsal hesap varsayımıyla alındı; bu üç soru cevaplanmadan dağıtım yolu kesinleşmez (K5). Kapalı teste her hâlükârda §2 (demo sunucu) ve §3 (formlar) gerekir.

---

## 7. Sıra (önerilen)

1. K1 onayı → 4.1 değişikliği → vc 60 AAB → manifest ölçümü.
2. K2 → gizlilik sayfası yayını → URL'yi konsola gir.
3. K4 → demo sunucu + deneme hesabı → §2 formu.
4. §3 formları (veri güvenliği: ML Kit satırını web'den doğrulayarak).
5. §5 mağaza girişi + grafikler.
6. K5 → kapalı test (12 test kullanıcısı) ya da gizli yayın.

---

## 8. Ölçüm kaynakları

- AAB: `~/Desktop/TeksERP-play/TeksERP-1.1.0-vc59.aab` (sha256 `eb53e729…dd55`, commit `58e61f608`).
- Yapılandırma: `mobil/app.json`, `mobil/app.config.js`, `mobil/plugins/`, `mobil/eas.json`.
- Kütüphane manifestleri: `expo-audio` 1.1.1 (`android/src/main/AndroidManifest.xml`), `expo-secure-store` 15.0.8 (`androidx.biometric`), `expo-camera` 17.0.10 (`com.google.mlkit:barcode-scanning:17.3.0`, `play-services-code-scanner:16.1.0`).
- Kod: `mobil/src/services/scanFeedback.ts`, `mobil/src/services/hal/btClassic.transport.ts`, `mobil/src/lib/errorReport.ts`, `mobil/src/utils/deviceId.ts`, `mobil/src/services/auth.service.ts`, `mobil/src/offline/flushThenLogout.ts`.

## 9. `PLAY-STORE-YAYIN.md` eskiyen yerleri (2026-10-08'de belge bu listeye göre yeniden yazıldı)

- Başlık kararı "herkese açık yayın, Managed Google Play tercih edilmedi" → K-14 (2026-10-07) "gizli yayın" ile çelişiyor; o da kişisel hesap bulgusuyla açık (§6).
- §1.1 EAS imza akışı → bugün yerel `npm run build:aab` + `mobil/keystore/play-yukleme` yükleme anahtarı + Play App Signing.
- §1.3 "varsayılan API adresi `localhost`, `EXPO_PUBLIC_API_URL` gömülür" → ortak pakette ERP adresi GÖMÜLMEZ; ilk ekran "Sunucuyu bul". Demo adresi derlemeye gömülmez, incelemeci elle girer (§2).
- §2 izin tablosu: `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC/FINGERPRINT`, FGS `mediaPlayback`/`microphone` hiç anılmıyor; `REQUEST_INSTALL_PACKAGES` engeli eklenmiş ama yazılmamış; `BLUETOOTH_SCAN neverForLocation` artık AAB'de VAR (açık iş yarı kapalı, konum `maxSdkVersion` hâlâ yok).
- §3 "ikon `assets/icon.png`" → 1024×1024; 512 dışa aktarımı gerekli.
- §4 "KARAR: kişisel hesap" → belgeler arası çelişki: `DEMOFABRIKA-KURULUM-BULGULARI.md` §E ve hafıza "kurumsal hesap" diyor; 2026-10-08 konsolu kişisel gösterdi.
- §5 sıra: EAS adımları ve "public" varsayımı eskidi; Dahili test zaten yapıldı (vc 58 API 35 reddi, vc 59 yayında).
