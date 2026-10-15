# Play Console — sabah yapılacaklar (iki uygulama)

> Hazırlanış: 2026-10-16 gecesi (Claude, hizmet hesabıyla). Bu listedeki her madde Play Developer API'sinin
> YAPAMADIĞI ya da kullanıcı kararı isteyen iştir. API ile yapılanlar aşağıda "Gece yapılanlar"da.
> Sır (parola, TOTP sırrı) bu dosyaya YAZILMAZ — yalnız Console'a, Anahtar Zinciri'nden kopyalanarak.

## Gece yapılanlar (API, geri okundu)

| | TeksERP Yönetim (`com.etkiliyazilim.tekserp.yonetim`) | TeksERP tablet (`com.etkiliyazilim.tekserp`) |
|---|---|---|
| Mağaza metni tr-TR + en-US (başlık, kısa, tam) | ✅ `patron/uygulama/magaza/metinler.json` | ✅ `mobil/magaza/metinler.json` |
| Simge 512 (32 bit) + öne çıkan görsel 1024×500 | ✅ | ✅ |
| Telefon ekran görüntüsü | ✅ 7 adet (1080×1920, maskeli) | ❌ yok — aşağıda B2 |
| 7"/10" tablet ekran görüntüsü | — | ❌ yok — aşağıda B2 |
| İletişim e-postası / web sitesi / varsayılan dil | ✅ info@etkiliyazilim.com · https://tekserp.etkiliyazilim.com · tr-TR | ✅ aynı |
| Üretim | ❌ Play reddetti: `400 FAILED_PRECONDITION "Precondition check failed."` (taslak dahil) — aşağıda A1–A9 | atanmadı (karar gereği) |
| Veri güvenliği | ❌ gönderilmedi (API CSV şablonu Console'dan indirilir; elde yok) — A6 | ❌ — B4 |

Araç: `node deploy/play-magaza.mjs --app=yonetim|tablet` (kuru: Play'deki girişi okur) · `--uygula` (tek edit: metin +
görsel + iletişim → commit → geri okuma). Görsel üretimi `deploy/play-magaza-gorsel.swift` (`PATRON-MAGAZA-ANDROID.md` §10).

---

## A. TeksERP Yönetim

Kaynak cevaplar: `PATRON-MAGAZA-ANDROID.md` §3 madde 6, §4.2, §4.3, §5.

**A1. Uygulama içeriği → Gizlilik politikası:** `https://tekserp.etkiliyazilim.com/yonetim-gizlilik` (canlı, 200 — ölçüldü 2026-10-16).

**A2. Uygulama içeriği → Uygulama erişimi** → "Tüm işlevler veya bazı işlevler kısıtlanmış" → talimat ekle:
- Ad: `Inceleme hesabi` · Kullanıcı adı: `play-inceleme@etkiliyazilim.com` · Parola: Anahtar Zinciri
  `tekserp/patron-play-inceleme-parola` (kopyala-yapıştır; bu dosyaya yazılmaz).
- "Diğer bilgiler" (TOTP sırrını `[TOTP_SIRRI]` yerine Anahtar Zinciri `tekserp/patron-play-inceleme-totp`'tan yapıştır):

```text
TeksERP Yönetim is an invitation-only management app for textile mills that use TeksERP.
The review account belongs to a demo facility with sample business data.

1) Open the app. On "TeksERP Yönetim" enter the e-mail and password above and tap "Devam" (Continue).
2) The app asks for "Doğrulama kodu" (verification code). The account uses two-step
   verification (TOTP, RFC 6238, SHA-1, 6 digits, 30 s). Add this secret to any
   authenticator app (e.g. Google Authenticator) and enter the current code:
   [TOTP_SIRRI]
   Then tap "Giriş yap" (Sign in).
3) The dashboard ("Pano") opens. Sections: Siparişler (orders), Cariler (accounts),
   Sevkiyat (shipping), Üretim (production), Stok (stock), Finans (finance),
   Raporlar (reports), Bildirimler (notifications), Profil (profile).
4) Account deletion: Profil (Profile) -> "Hesabımı sil" (Delete my account).
   Please do not complete the deletion; the review account is shared for future reviews.
The app interface is in Turkish. The account is read-only for review purposes.
```

> ⚠ Yapıştırmadan önce teyit: inceleme hesabının bağlı olduğu tesis bugün ("Merkez") GERÇEK müşteri verisi gösteriyor
> (gece ekran görüntüsü alınırken görüldü; görüntüler maskelendi). "demo facility with sample business data" cümlesi
> ancak hesap örnek veri taşıyan bir tesise taşınınca doğrudur (`PATRON-MAGAZA-ANDROID.md` §6 madde 2 kararı: DEMO
> tesis). Taşınmayacaksa ikinci satırı `The review account has read access to a facility whose owner consented to review.`
> ile değiştir. "Read-only" ifadesi hesabın yazma izni (sipariş/cari talebi) olmadığı içindir — gece Gelen kutusu
> butonu görünmedi; hesaba yazma izni verilirse satırı sil.

**A3. Reklamlar:** Hayır (reklam SDK'sı yok, `AD_ID` engelli). **Reklam kimliği:** Hayır.

**A4. İçerik derecelendirmesi (IARC):** e-posta `info@etkiliyazilim.com` · kategori "Tüm diğer uygulama türleri" ·
şiddet/korku/cinsellik/dil/madde/kumar: hepsi Hayır · kullanıcılar arası iletişim/içerik paylaşımı: Hayır · konum
paylaşımı: Hayır · dijital satın alma: Hayır · sınırsız internet: Hayır. Beklenen: 3+ / PEGI 3.

**A5. Hedef kitle:** yalnız 18 ve üzeri · çocukların ilgisini çekebilir mi: Hayır.

**A6. Veri güvenliği:** cevaplar `PATRON-MAGAZA-ANDROID.md` §4.2 tablosu (Ad, E-posta, Kullanıcı kimlikleri, Diğer kullanıcı
içerikleri, Diğer işlemler; aktarımda şifreli Evet; silme isteği Evet; bağımsız inceleme Hayır). Hesap silme URL'si:
`https://tekserp.etkiliyazilim.com/yonetim-gizlilik#hesap-silme`. ⚠ "Finansal bilgiler" ve IP satırları §4.2'deki ⚠
notlarına göre seçilir. İstersen formu doldurduktan sonra Console'dan **CSV dışa aktar** → dosyayı Claude'a ver;
sonraki güncellemeler API (`applications.dataSafety`) ile o şablondan yapılabilir.

**A7. Beyanlar:** Devlet uygulaması Hayır · Finans özellikleri "Uygulamam finansal özellik sunmuyor" · Sağlık Hayır · Haber Hayır.

**A8. Mağaza ayarları:** kategori **İş** · etiketler isteğe bağlı. Metin, görsel ve iletişim gece yüklendi — Console'da
"Ana mağaza girişi"ni gözden geçir (görselleri onayla; istersen sıralamayı değiştir).

**A9. Üretim:** Üretim → **Ülkeler/bölgeler** seç (öneri: Türkiye ile başla) → "Yayın özeti / Kontrol paneli"nde eksik
görev kalmadığını gör. Sonra iki yol:
- Console: Test → Dahili test → 1.0.2 (1) → **Sürümü tanıt → Üretim** → kademeli yayın **%20** → sürüm notu (tr-TR):

```text
İlk sürüm: pano, üretim, sevkiyat, stok, finans, siparişler, cariler, gelen kutusu, raporlar, çoklu tesis. Hesabınızı uygulamadan silebilirsiniz: Profil → "Hesabımı sil".
```

- Ya da Claude'a "üretimi dene" de: `node deploy/play-magaza.mjs --app=yonetim --uretim=1 --yuzde=20 --uygula`.
  ⚠ Play ilk üretim sürümünde kademeli yayına izin vermezse `--yuzde=100` gerekir (karar senin). Hizmet hesabının
  üretim izni: Console → **Kullanıcılar ve izinler** → `play-yayinci@…` → bu uygulama için "Üretim kanalına yayınla".

Gece ölçülen: aynı edit'te `alpha`'ya taslak 200 + doğrulama 200; `production`'a `draft`, `completed`, `inProgress %20`
üçü de `400 FAILED_PRECONDITION` (commit edilmeyen sonda edit'leri silindi). Play eksiğin adını API'de vermiyor; yukarıdaki
A1–A9 Console kontrol panelinin "Uygulamanızı ayarlayın" görevleridir.

---

## B. TeksERP tablet

Kaynak cevaplar: PLAY-URETIM-KONSOL-METINLERI belgesi (§1–§5; `feat/play-uretim` dalında, `docs/ops/` altında — dal main'e inmedi, `git show feat/play-uretim:docs/ops/<ad>.md` ile okunur).
Üretime atama YAPILMADI (karar: inceleme kullanıcısı sabah kurulacak).

**B1. İnceleme kurulumu ve kullanıcısı (kararın):** o belge §1.2 — ayrı inceleme kurulumu (öneri A) ya da mevcut;
cihaz onayı (`device.pairingRequired`) KAPALI; TOTP'siz, yıkıcı yetkisiz ERP kullanıcısı.

**B2. Ekran görüntüleri (Play üretim için en az 2 telefon; tablet önerilir):** gece ALINAMADI. Play'in ürettiği vc62
universal APK emülatöre kuruldu ama Play lisans denetimi (pairip) uygulamayı açtırmadı (Play Store ekranına yönlendirdi;
emülatörde Google hesabı yok). B1'deki inceleme kurulumu hazır olunca dahili testçi bir tablette ya da Google hesaplı
emülatörde çekilir: Sunucuyu ekle → giriş → bir istasyon ekranı. Gerçek müşteri verisi görünmeyecek (örnek veri).
Yüklemek için PNG'leri `mobil/magaza/gorseller/{phoneScreenshots,sevenInchScreenshots,tenInchScreenshots}/` altına koy →
`node deploy/play-magaza.mjs --app=tablet --uygula`.

**B3. Uygulama erişimi:** o belge §1.3 metni. Son satırı şöyle bırak: `The demo data is sample business data.` —
inceleme kurulumunda yalnız örnek veri varsa doğrudur; gerçek veriyle yazılmaz.

**B4. Veri güvenliği:** o belge §2 · **İçerik derecelendirmesi / Hedef kitle / Beyanlar:** §3.1–§3.3 (A3–A7 ile aynı
cevaplar; hedef 18+).

**B5. Gizlilik politikası:** `https://tekserp.etkiliyazilim.com/gizlilik` (canlı, 200). ⚠ O belge §6'daki metin
güncellemeleri (şifreli bağlantı, bulut kurulumu) onayını bekliyor.

**B6. Mağaza ayarları:** kategori **İş**. Metin, simge, öne çıkan görsel, iletişim gece yüklendi.

**B7. Üretim:** Ülkeler/bölgeler + "Kullanıcılar ve izinler"de hizmet hesabına üretim izni → o belge §5 madde 11.

---

## Açıklar

- Web sitesi alanı `https://tekserp.etkiliyazilim.com` kök adresi bugün tablet gizlilik sayfasını gösteriyor (200). Ayrı bir
  ürün sayfası yayımlanırsa alan aynı kalır.
- Görseller (simge, öne çıkan görsel) uygulamanın mevcut simgelerinden üretildi; nihai marka görseli gelirse
  `deploy/play-magaza-gorsel.swift` yeniden koşulur ve `--uygula` ile değiştirilir.
