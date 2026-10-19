# PLAN — Play kapalı test 12 × 14 (iki uygulama)

> Neden: Play geliştirici hesabı **KİŞİSEL** (Console ana sayfası "Etkili Yazılım LTD · Kişisel hesap", ölçüm
> 2026-10-20; arşiv `docs/history/arsiv/2026-10.md` 2026-10-20). Kişisel hesapta üretim yayınından önce kapalı
> test + üretim erişimi başvurusu şarttır. K5 kararı (ÜRETİM, herkese açık) değişmez; yalnız yol uzar.
> Uygulamalar: **TeksERP Yönetim** `com.etkiliyazilim.tekserp.yonetim` (bugün "Kapalı test") ·
> **TeksERP** tablet `com.etkiliyazilim.tekserp` (bugün "Dahili test").

## 0. Sıra

İki uygulama AYNI GÜN, AYNI testçi listesiyle başlar — şart uygulama başınadır, sayaçlar ayrı işler, paralel
koşmak takvimi ikiye katlamaz. Önce Yönetim (zaten kapalı testte, yalnız liste + bağlantı eksik); tablet aynı gün
`alpha` kanalına çıkarılır.

## 1. (a) Kapalı test kanalı ve testçiler

1. **Testçi listesi:** en az 12, **öneri 15–20** (düşenlere yedek). Her biri bir Google hesabı e-postası
   (Play'de oturum açtığı hesap) ve bir Android cihaz. Console → Test → Kapalı test → kanal → **Test kullanıcıları**
   → e-posta listesi oluştur (iki uygulamada aynı liste seçilebilir) → kaydet.
2. **Tablet kanala çıkar:** son AAB `node deploy/play-yayinla.mjs --kanal=alpha` (kuru) → `--uygula`
   (`docs/kurallar/surum-yayin.md`). Yönetim'de kapalı test sürümü zaten var; yoksa aynı yolla yeni sürüm.
3. **Katılım bağlantısı:** Kapalı test → Test kullanıcıları sayfasındaki opt-in URL; iki uygulamanın bağlantısı
   ayrı. Testçilere tek mesajda iki bağlantı + kısa talimat (WhatsApp/e-posta).
4. **Testçinin yapacakları:** listedeki Google hesabıyla bağlantıyı aç → **"Test kullanıcısı ol"** → Play
   sayfasından indir → **14 gün boyunca kaldırma**, kanaldan ayrılma; birkaç günde bir aç, bir ekrana gir.

## 2. (b) Giriş

**Yönetim** (giriş parola + TOTP ister):

| Yol | Artı | Eksi |
|---|---|---|
| Her testçiye davet — patron bulutu **Hesaplar → Yeni**, tesis **"Merkez"** (deneme verisi), yönetici `info@etkiliyazilim.com` | Kişi başı hesap; düşen testçi tek tek görülür; ortak sır dolaşmaz | 15–20 davet + her kişi TOTP kurar (destek yükü) |
| Ortak hesap | Hızlı, tek kurulum | Parola + TOTP sırrı 15–20 kişiye dağılır (sır hijyeni); bir kişi parolayı değiştirirse herkes düşer; kimin kullandığı görünmez |

Öneri: **kişi başı davet** (sır hijyeni kuralıyla uyumlu). Testçi verisi yalnız "Merkez" deneme tesisinde.

**Tablet:** ilk ekranda **"Deneme sunucusuna bağlan"** → onaysız tablet parola girişi. Ön koşul: deneme
sunucusunda `device.unpairedPasswordLogin` AÇIK (panel → Genel ayarlar → cihaz eşleştirme; backend ≥ 2.15.10).
Testçilere deneme sunucusunda ortak ya da kişi başı kullanıcı; istasyon ekranları onaylı cihaz ister
(`DEVICE_REQUIRED`) — testçi listeleri/menüleri gezer, bu şart için yeterli.

## 3. (c) Şartın metni

Play yardımına göre: üretim erişimi başvurusu için kapalı testte **en az 12 test kullanıcısının son 14 gün
boyunca kesintisiz katılmış** olması gerekir. Eşik ve sayma biçimi (katılım mı, kurulu kalma mı) **Play
Console'daki üretim erişimi başvuru ekranındaki koşulla doğrulanacak** — oradaki metin geçerlidir.

## 4. (d) 14 gün sonra

1. Console → Kontrol paneli → **"Üretim erişimi için başvurun"** formu. Formda sorulan sorulara göre doldurulur
   (bilinen başlıklar: kapalı testin nasıl yürüdüğü, testçi geri bildirimi, uygulamanın kitlesi ve üretime hazırlığı;
   tam liste formda görülür). Cevap taslağını Claude yazar, kullanıcı gönderir.
2. Google incelemesi (süre ölçülmedi; birkaç gün varsayılır).
3. Onaydan sonra Üretim → Yeni sürüm (ya da kapalı test sürümünü **Sürümü tanıt → Üretim**) → ilk üretim
   incelemesi → yayın (Yönetim: `PATRON-MAGAZA-ANDROID.md` §3 madde 7; tablet: `PLAY-STORE-YAYIN.md`).

## 5. (e) Takvim (bugün 2026-10-20, Salı)

| Tarih | İş |
|---|---|
| 2026-10-20 / 21 | Liste kur, tablet `alpha`ya çık, Yönetim davetleri, deneme sunucusunda bayrak aç, bağlantıları dağıt |
| **2026-10-22** (Perşembe) | Son katılım günü — 12'nin üstü katılmış olmalı (sayaç 1. gün) |
| 2026-10-29 | Ara ölçüm (8. gün): katılım ≥ 12 mi, düşen var mı |
| 2026-11-04 (Çarşamba) | 14. gün |
| **~2026-11-05** (Perşembe) | Sayaç dolar → üretim erişimi başvurusu (Console butonu açılınca) |
| ~2026-11-05 → +inceleme | Başvuru onayı, sonra üretim sürümü + ilk üretim incelemesi |

Katılım 2026-10-22'den geç tamamlanırsa her gün kayar: 12. testçinin katıldığı gün + 14 gün.

## 6. (f) Ölçüm

- Console → Test → Kapalı test → **Test kullanıcıları**: katılan sayısı (opt-in), her iki uygulamada ayrı.
- Console → **İstatistikler** / Kontrol paneli: kurulu cihaz, aylık etkin (bugün "–").
- Kontrol panelindeki üretim erişimi görevinin ilerleme göstergesi (varsa) — 2026-10-22, 10-29, 11-04'te okunur.
- Yönetim: patron bulutunda davetin kabul edildiği / oturum açıldığı hesap sayısı.

## 7. (g) Riskler

- **Testçi düşerse:** 14 gün "kesintisiz" sayılır; 12'nin altına inen gün sayacı bozabilir → 15–20 yedekli liste,
  8. günde ara ölçüm, düşeni hemen yedekle tamamla (yenisinin 14 günü baştan başlar — kesin davranış Console'dan).
- **Uygulama erişimi (App access) formu:** incelemeci giriş yapamazsa ret. Yönetim: inceleme hesabı (DEMO tesis,
  TOTP sırrı talimatta, `PATRON-MAGAZA-ANDROID.md` §6 madde 2). Tablet: deneme sunucusu + onaysız parola girişi +
  inceleme kullanıcısı. Başvurudan ÖNCE dolu olmalı.
- **Gizlilik URL'si:** `https://tekserp.etkiliyazilim.com/yonetim-gizlilik` ve tablet `…/gizlilik` VDS'te yayında
  ve 200 dönmeli (giriş istemeyen sayfa); hesap silme `…/yonetim-gizlilik#hesap-silme`.
- **2026-10-16 `FAILED_PRECONDITION`:** olası nedeni bu şart (kesin değil); başvuru onayından sonra üretim
  denemesi tekrar edilir, yine düşerse Console görevleri (`PLAY-SABAH-YAPILACAKLAR.md` § A) taranır.
- **Kuruluş hesabına geçiş** şartı kaldırırdı; süresi/koşulu ölçülmedi — kullanıcı kararı, bu plan beklemez.
