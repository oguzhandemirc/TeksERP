# Senaryo — sıfırdan yeni müşteriye satış (`demofabrika`, thinkpad-1)

> **Durum (2026-09-30):** TASLAK. Kullanıcı kararı: bu gecenin işleri bitince thinkpad-1'deki testfabrika kurulumu silinir ve yeni bir müşteriye satış baştan sona, lisans **ZORUNLU** kipte koşulur. Kullanıcı adımları kendisi yapar; §0'ı yönetici oturum (1e) ve dilim oturumları hazırlar.
> **Tek hikâye:** "Demo Fabrika Tekstil" TeksERP satın alıyor. Sunucusu thinkpad-1 (Windows 11, Tailscale `thinkpad-1`), sahadaki tableti Galaxy Tab A9+. Firma adı yalnız kurulumda `company.name` ayarına yazılır; koda, kanal kaydına ve pakete girmez.
> **Kanal:** `demofabrika` — HAZIRLIK türü, AYNASIZ (demo/test müşterisi: hiçbir üretim kanalının terfi kaynağı değildir, ona yayın terfi istemez), görünür etiket "DEMO FABRİKA" (`deploy/kanallar.json`; reçete `docs/RECETELER.md` § Yeni müşteri kanalı, 2. adım).
> **Adım biçimi:** **Nerede** (menü yolu · sekme · düğme — etiketler koddan birebir) · **Yap** · **Beklenen** · **Kanıt**. Sonuç her adımın sonuna yazılır: ✅ · ❌ · ⚠️ bilinen sınır.
> **Değişmez:** adnansahin (SAHINSRV, `adnansahin` kanalı, VDS'teki `html/adnansahin/**`) bu senaryodan ETKİLENMEZ; ölçüm §18.

---

## 0. Hazırlık — kullanıcıdan ÖNCE (1e ve oturumlar)

| # | İş | Komut / yer | Bugünkü durum |
|---|---|---|---|
| 0.1 | Kanal kaydı + OTA imza anahtarı | `deploy/kanallar.json` `demofabrika`; anahtar `mobil/keystore/ota-keys-demofabrika/` (git dışı) | kayıt dalda, anahtar üretildi — **şifreli yedek yenilenmedi** (parola sahibi, `mobil/keystore-yedek.README.md`) |
| 0.2 | Satıcı ve sınıf | Satıcı: ÜRETİM lisans sunucusu, demo müşteri "test" güncelleme grubunda — gruplar tek ortak paket modeliyle (liste Faz 1) gelir, o güne dek grubun karşılığı 0.8'deki `hazirlik` türlü kanaldır (kullanıcı kararı 2026-10-05; hazırlık satıcısı `lisans-test` portalsız ve fabrikasız, bu senaryoda kullanılmaz). Sınıf (**KARAR**): (A) **Demo / deneme** · (B) **Üretim** | üretim kökü `kok-2026-1` güven çapasında (`Teks-Erp/src/lib/license/protocol/kok-anahtarlar.ts`; bütün sınıflar). **Patron bulutu (§12) yalnız (B)'de çalışır.** |
| 0.3 | Sürüm notları | yeni panel/tablet/backend numarası için `surum-notlari.json` + `node scripts/surum-notlari-kopyala.mjs` | ilk paket kanal kaydını taşıyan commit'ten çıkmak ZORUNDA (eski etiketten derlenemez) ⇒ yeni numara + not |
| 0.4 | Backend paketi | `pwsh deploy/paketle.ps1 -Musteri demofabrika -Korumali …` (PAKET anahtarı 0.2'deki satıcının) | — |
| 0.5 | Panel paketi + yayını | `./deploy/electron-paketle.sh demofabrika` → `ssh tekserp-yayin "mkdir -p /opt/stack/apps/tekserp-guncelleme/html/demofabrika/electron"` (bir kez) → `./deploy/electron-yayinla.sh --musteri=demofabrika` | ilk yayında uzak dizin elle açılır |
| 0.6 | Tablet APK + yayını | `cd mobil && TEKSERP_KANAL=demofabrika npx expo prebuild --platform android --clean --no-install` → `npm run build:apk -- --musteri=demofabrika` → `node deploy/mobil-yayinla.mjs --apk=<yol> --musteri=demofabrika` (sürüm APK'dan; yanındaki `.derleme.json` künyesiyle) | — |
| 0.7 | İlk kurulum dosyaları satıcıda | backend zip + `TeksERP-<X>-Setup.exe` + APK → satıcının derleme dizini (hazırlık: `/opt/stack/apps/tekserp-satici-hazirlik/derlemeler`, salt okunur bağ) | portal §4 bu dizinden okur |
| 0.8 | Portal kanal kaydı | Portal → "Kanallar" → "Yeni kanal" → "Kod" `demofabrika` · "Ad" · "Tür" **Hazırlık** (kayıt defterindekiyle aynı; "test" grubunun bugünkü karşılığı — 0.2) → "Kaydet" (izin `kanal:yonet`) | — |
| 0.9 | İndirme kapısı Worker'ı | yayındaysa rota `…/demofabrika/*` (ya da `…/*`) | **yayında değil** (`docs/ops/INDIRME-KAPISI-WORKER.md`) ⇒ indirmeler bugün anonim, K1 etkisiz |
| 0.10 | thinkpad-1 temizliği | `Teks-Erp-wt/testfabrika-araclar/thinkpad-temizle.ps1` (repo dışı): KURU → gözden geçir → `-Uygula -Onay <N>` | betik hazır, koşulmadı. Salt okuma ölçümü (2026-09-30): makinede İKİ panel var — "TeksERP Test Fabrika" silinir, "Adnan Şahin ERP" varsayılan KORUNUR (sıfırdan müşteri görüntüsü isteniyorsa `-PanelAdlari`/`-PanelPaketAdlari`na eklenir — **KARAR**); PostgreSQL servisinin adı `postgresql-tekserp` (kurulum korunur, ad kalır); `C:\TeksERP-offsite-prova` ve `rclone.conf` silinir, makine dışı yedek hedefindeki kopyalar kapsam dışı |
| 0.11 | Eski tablet uygulaması | Galaxy Tab'dan `com.teks.erp.mobil.testfabrika` kaldırılır (`adb uninstall …`) | yoksa gömülü eski adresiyle yeni sunucuya ulaşır ve "farklı kurulum" der |
| 0.12 | Makine önkoşulları | Windows 11 · **PostgreSQL 16 kurulu** (betikler kurmaz, korunur) · Node.js 22+ (pm2 kurulumu için) · Tailscale açık, MagicDNS açık · OpenSSH | temizlik bunları korur |

---

## 1. Portal — müşteri, tesis, kurulum

- **Nerede:** Portal (`https://portal.etkiliyazilim.com` → Cloudflare Access e-posta kodu → portal giriş ekranı; tek portal ÜRETİM satıcısındadır, senaryo orada koşar — 0.2) → giriş "Kullanıcı adı" · "Parola" · "Doğrulama kodu" → "Giriş yap" → sol menü "Müşteriler" → "Yeni müşteri".
- **Yap:** "Ad" = `Demo Fabrika Tekstil` · "Vergi no (isteğe bağlı)" · "Bayi" = "— Doğrudan satıcı —" → "Kaydet". Müşteri sayfası → "Tesisler" → "Yeni tesis" → "Tesis adı" → "Kaydet". Tesis satırında "Kurulum ekle" → "Yeni kurulum": "Lisans sınıfı" = (A) "Demo / deneme" · (B) "Üretim" · "Kanal" = `demofabrika` · "Ad (isteğe bağlı)" · "Yoklama aralığı (dakika)" 60 · "Patron bulutu eşitleme aralığı (dakika)" 5 → "Kaydet".
- **Beklenen:** kurulum listede, durum **ETKİNLEŞMEDİ**; "Kanal" sütunu `demofabrika`.
- **Kanıt:** kurulum sayfasının ekran görüntüsü (kurulum no + kanal).

## 2. Portal — HAK, ZORUNLU kip, etkinleştirme kodu

- **Nerede:** kurulum sayfası → "Lisans" sekmesi → "Lisans hakkı oluştur".
- **Yap:** "Modüller (lisans tavanı)" — üretim + (B'de) patron bulutu dahil; "Kalıcı lisans" (varsayılan işaretli) · "Bakım bitişi" → "Oluştur" → "Lisansı imzala": "Sebep (deftere yazılır)" = "İlk imza" · "Kök anahtar parolası" → "İmzala". (İmza düğmesi internet portalında açıktır — 2026-10-04'ten beri tek yol.)
- **Yap (kip):** "Yaptırım" sekmesi → "Zorla kipine geçir" (izin `yaptirim:agir`, yalnız yönetici). Ekrandaki ad "Zorla"; "ZORUNLU" diye bir etiket yok.
- **Yap (kod):** "Lisans" sekmesi → "Etkinleştirme kodları" → "Etkinleştirme kodu üret" → "Geçerlilik (gün)" 30 → "Üret" → kod "Etkinleştirme kodu" penceresinde BİR KEZ görünür → kâğıda/parola yöneticisine → "Kaydettim, kapat".
- **Beklenen:** HAK imzalı; kip Zorla; tek aktif kod (yeni kod eskisini iptal eder).
- **Kanıt:** "Lisans" ve "Yaptırım" sekmelerinin görüntüsü (kod metni görüntüye GİRMEZ).

## 3. Portal — taksit planı ve planlı eylem

- **Nerede:** kurulum → "Plan ve taksit" sekmesi.
- **Yap:** "Taksit planı oluştur" → "Açıklama" · "Kalemler" (tarih + "Tutar (ör. 15000.00)", "+ Kalem ekle"; ilk kalemin vadesi YARIN) · "Uzatma (gün)" 15 · "Gecikme (gün)" 1 (prova için kısa) · "K3 geri sayımı (gün)" 15 → "Oluştur". Sonra "Planlı eylem ekle" → "Kademe" K0 · "Vade" (yarın) · "Mesaj (zorunlu)" = "Bakım yenileme hatırlatması" · "Sebep (zorunlu)" → "Planla".
- **Beklenen:** plan ve eylem listede; menüdeki "Planlı eylemler" sayfasında da görünür. Vadesinde bakım işi eylemi uygular (§14'te ölçülür).

## 4. Portal — müşteriye indirme bağlantısı

- **Nerede:** kurulum → "İlk kurulum" sekmesi → "Bağlantı ver".
- **Yap:** "Derleme" = backend zip → "Geçerlilik" 7 gün · "İndirme hakkı" 3 · "Açıklama" → "Bağlantı ver". Aynısını `Setup.exe` ve APK için tekrarla (üç bağlantı).
- **Beklenen:** adres BİR KEZ gösterilir (`<satıcı kökü>/d/<belirteç>`). Müşteri sayfayı açınca hak düşmez; "İndir" bir hak tüketir.
- **Kanıt:** üç bağlantının kopyası (belirteç yalnız kullanıcının notunda).

## 5. thinkpad-1 — temiz backend kurulumu

1. **Ölç (salt okuma):** `tailscale ip -4` = `100.70.47.46` · `C:\TeksERP` YOK · `Get-ScheduledTask TeksERP-*` boş · `psql --version` 16.x · `node -v` ≥ 22.
2. **İndir:** thinkpad-1 tarayıcısında §4'ün backend bağlantısı → "İndir" → zip'i ör. `C:\Kurulum\` altına; içinden `ilk-kurulum.ps1` ve `kur.ps1`'i çıkar.
3. **İskelet (yönetici PowerShell, gerçek terminal ya da `ssh -t`):**
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\ilk-kurulum.ps1 -DbAdi <veritabanı adı> -PgAyarla -BakimRolu -YedekSifreleme -YedekMusteriAnahtarCikti <USB>\musteri-yedek-anahtari.txt -ApiIzinliAdres LocalSubnet,100.64.0.0/10`
   - Sorulanlar: uygulama rolü parolası · PostgreSQL yönetici parolası · yedek parolası (≥10 karakter; müşteride VE Etkili Yazılım kasasında saklanır).
   - `-ApiIzinliAdres`e Tailscale aralığı bilerek eklenir: tablet sunucuya Tailscale'den gelir, varsayılan `LocalSubnet` onu kapsamaz.
   - **Beklenen:** "ISKELET HAZIR" + "YAPILMADAN KALANLAR" listesi (bugün en az: Etkili Yazılım alıcısı yok). Müşteri özel anahtarı USB'de; "SUNUCUDA BIRAKMA" uyarısı.
4. **Satıcı adresi:** `.env`e `LICENSE_SERVER_URL` satırı EKLENMEZ — varsayılan üretim satıcısıdır (0.2; hazırlık satıcısı `lisans-test` bu senaryoda kullanılmaz).
5. **Sürüm:** `powershell -NoProfile -ExecutionPolicy Bypass -File .\kur.ps1 -Kok C:\TeksERP -Paket <zip> -UygulamaAdi tekserp-backend-demofabrika` (SSH'tan: paketteki `uzaktan-kos.ps1` ile SYSTEM görevi; runbook `docs/ops/DEPLOY-RUNBOOK.md` §3b).
   - **Beklenen:** `[1/9]`…`[9/9]` → "KURULUM TAMAM", `API : UP DB: UP surum: <X>`; pm2 adı paket kimliğiyle aynı (sarı "Paketin kanal kimligi pm2 adi" uyarısı ÇIKMAZ).
6. **Satıcı (süperadmin) hesabı:** `cd C:\TeksERP\app ; node dist\tools\superadmin-olustur.cjs` (gerçek terminal şart). ⚠️ `docs/ops/SUPERADMIN-KURULUM.md` `npm run superadmin:kur` diyor — paketli kurulumda `npm run` yok (belge borcu).
7. **Kanıt:** Mac'ten `curl -s http://thinkpad-1.tail702784.ts.net:4000/health` → UP + sürüm; `Get-ScheduledTask TeksERP-*` → Backend-Boot + DB-Backup; `Get-NetFirewallRule -DisplayName "TeksERP*"`.

## 6. Panel — kurulum ve ilk açılış

- **Nerede:** müşteri bilgisayarı (thinkpad-1 ya da ikinci Windows) → §4'ün panel bağlantısı → "İndir" → `TeksERP-<X>-Setup.exe`.
- **Yap:** çalıştır → imzasız pakette SmartScreen ("Ek bilgi" → "Yine de çalıştır") → kurulum sihirbazı (tüm kullanıcılar için; dizin değiştirilebilir) → masaüstü kısayolu **TeksERP Demo Fabrika**.
- **Beklenen:** pencere başlığı "DEMO FABRİKA · TeksERP Demo Fabrika"; başlık çubuğunda kırmızı "DEMO FABRİKA" kanal rozeti (hazırlık kanalı; üzerine gelince "— deneme kanalı. Burada gerçek iş girilmez."); giriş ekranı sağ altta "TeksERP v<X>". Varsayılan sunucu `http://thinkpad-1.tail702784.ts.net:4000`; ulaşılamazsa "Sunucuya ulaşılamadı" → "Sunucuyu Ara" / "Adresi Elle Gir" → "Sunucu Adresi": "Protokol" · "IP / Sunucu adresi" · "Port" → "Bağlantıyı Test Et" → "Kaydet".
- **Yap:** giriş "Kullanıcı adı" · "Şifre" → "Giriş Yap" (satıcı hesabıyla; TOTP açıksa "Doğrulama kodu" → "Doğrula ve gir").
- **Kanıt:** giriş ekranı + ilk anasayfa görüntüsü.

## 7. Sözleşme kabul adımı — ⚠️ BUGÜN YOK

- **Beklenen tasarım:** ilk etkinleştirmeden önce son kullanıcı sözleşmesi onayı — dört onay kutusu + "Kabul ediyorum ve devam et" (`docs/hukuk/KABUL-METNI.md`, TASLAK, avukat incelemesinde).
- **Bugün:** panelde ekran yok; lisans protokolü v1 kabul kaydı taşımıyor (`docs/hukuk/UYGULAMA-NOTLARI.md`). Adım ❌ yazılır, senaryo sürer.

## 8. Panel — etkinleştirme (Zorla kip)

- **Nerede:** "Sistem" → "Yapılandırma" → "Lisans" karosu → "Lisans" sayfası → etkinleştirme kartı.
- **Yap:** kod alanı ("TKS-XXXX-XXXX-XXXX-XXXX") → §2'nin kodu → "Etkinleştir". (Sunucu internete çıkamıyor ama panel bilgisayarı çıkabiliyorsa: "Bu bilgisayar üzerinden etkinleştir".)
- **Beklenen:** "Durum" kartı: "Kip" = "Zorlama" · "Uygulanan kademe" = "Normal" · satıcı yaptırımı "Geçerli"; "Kira ve yoklama" kartı: "Kira" veriliş → bitiş · "Son yoklama" dolu. Portalda kurulum **ETKİN**, ilk yoklama satırı.
- **Kanıt:** iki kartın görüntüsü + portal kurulum sayfası.

## 9. Panel — firma adı, saat dilimi, kullanıcılar

- **Nerede:** "Sistem" → "Şirket & Güvenlik" → "Şirket Bilgileri" sekmesi.
- **Yap:** "Firma Adı" = `Demo Fabrika Tekstil` → "Kaydet" (ayar şifresi istenirse "Şifre" → "Onayla").
- **Beklenen:** "Şirket bilgileri kaydedildi."; sol menü başlığı ve tablet başlığı yeni ad.
- **Yap (saat dilimi provası):** aynı sekme "Saat dilimi" → "Şu anki dilim: Europe/Istanbul" → "Dilim ara (örn. Istanbul, Berlin, New_York)" → başka bir dilim seç → önizleme "Yeni dilim: A → B (geçmiş kayıtlar değişmez)" · "Yürürlük" · "Geçiş günü" → "Saat dilimini değiştir" → "Bekleyen değişiklik: A → B" → **"Değişikliği iptal et"** (dilim İstanbul'da kalır; geri alma ölçülür).
- **Yap (fabrika yöneticisi, satıcı oturumu):** başlık çubuğunda sarı "Destek hesabıyla girdiniz" rozeti; üst çubuğun altında "Fabrikanın kendi yönetici hesabı yok — destek hesabı günlük iş için kullanılmaz." kartı → "Fabrika yöneticisini aç" → "Kullanıcı Adı" · "Ad Soyad" → "Hesabı aç" → "Fabrika yöneticisi açıldı" penceresinde "Geçici parola" BİR KEZ görünür ("Parolayı kopyala") → müşteriye ilet → "Kapat" → kart kaybolur. Müşteri bu kullanıcı adı + geçici parolayla girer → "Yeni parola belirleyin" → "Yeni parola" · "Yeni parola (tekrar)" (≥ 10 karakter) → "Parolayı değiştir" → panel açılır.
- **Beklenen:** kart yalnız uyarır (panel kullanılmaya devam eder); yönetici açıldıktan sonra satıcı girişinde kart çıkmaz, rozet durur. Geçici parola görülmeden kaybolduysa: "Kullanıcılar" → kullanıcı → "Şifre Sıfırla".
- **Yap (kullanıcı):** "Yetkilendirme" → "Kullanıcı Erişimi" → "Kullanıcılar" → "Yeni Kullanıcı" → "Kullanıcı Adı" · "Ad Soyad" · "Şifre" · "Üretim operatörü yetkilerini ver" → "Kaydet" → "Kullanıcı oluşturuldu" → "QR Personel Kartı" → "Yazdır".
- **Yap (modüller, satıcı oturumu):** "Sistem" → "Modüller" — HAK tavanı içinde bu fabrikanın modülleri.

## 10. Tablet — APK kurulumu ve giriş

- **Nerede:** Galaxy Tab A9+ → Tailscale uygulaması AÇIK (MagicDNS) → tarayıcıda §4'ün APK bağlantısı → "İndir".
- **Yap:** "Bilinmeyen uygulamaları yükle" izni → "Yükle" → uygulama adı **TeksERP Demo**.
- **Beklenen:** eşleştirme zorunluysa "Cihaz Atama Bekliyor" ("Yöneticinin onayı bekleniyor…", "CİHAZ KİMLİĞİ") → panelde "Yetkilendirme" → "Cihaz Erişimi" → "Tabletler" → filtre "Onay bekliyor" → "Onayla" → "Cihazı Onayla": "Takma Ad (opsiyonel)" · "Tür" → "Onayla". Değilse doğrudan giriş.
- **Sunucu:** gömülü `http://thinkpad-1.tail702784.ts.net:4000/api`; ulaşılamazsa dişli → Ayarlar → "API Sunucusu" → "Ağda Ara" / "Bağlantıyı Test Et" / "Kaydet" (keşif alt ağ taramasıdır; Tailscale üzerinden bulamaz, adres elle girilir).
- **Yap:** giriş "Kullanıcı + Şifre" ("1 · KULLANICI" / "2 · ŞİFRE") ya da "QR Personel Kartı" (§9'un kartı).
- **Beklenen:** "Bölüm Seçimi"; başlıkta "Demo Fabrika Tekstil"; ekranın üstünde (durum çubuğu şeridinde) "DEMO FABRİKA" kanal şeridi.

## 11. İlk veriler — cari, ürün, stok girişi

- **Cari:** "Tanımlar" → "Cariler" (finans kapalıysa "Müşteriler") → "Yeni Cari" → "Bilgiler": "Ad" · "Roller" (Müşteri / Tedarikçi / Fason iş yapar) · "Vergi No" · "Adres" · "Ülke" · "Sevk yönü" → "Kaydet".
- **Ürün:** "Tanımlar" → "Ürünler" → "Yeni" → "Yeni Ürün": "Ad" · "Tip" = Kumaş · "Birim" (otomatik) · "Stok Kodu (elle)" → "Oluştur".
- **Stok girişi:** ticaret modülü açıksa "Operasyon" → "Mal Kabul" → "Yeni Mal Kabul" → "Depo" · "Tedarikçi (opsiyonel)" · satır "Kumaş, Renk, Metre (top başına), En (cm), Kg, …, Adet" → "Fişi Oluştur (…)". Kapalıysa "Operasyon" → "Kumaş Stoğu" → "Ham Stok" sekmesi → "Manuel Top Ekle" → "Kumaş" · "Metraj (mt)" · "Ağırlık (kg)" · "En (cm)" → "Ekle". Tablette aynı giriş "Ham Giriş" karosundan.
- **Beklenen:** kayıtlar panelde ve tablette görünür; Zorla kip NORMAL'de yazma açık.

## 12. Patron bulutu daveti ve uygulamadan sipariş — yalnız 0.2-B

- **Önkoşul (`cloudEligibility`):** lisans GEÇERLİ ve sınıf **Üretim** · HAK'ta patron bulutu modülü · kirada patron bulutu bitişi · backend'de `PATRON_CLOUD_URL`. 0.2-A'da bu adım beklenen RED'dir (⚠️), senaryo sürer.
- **Panel:** "Yetkilendirme" → "Patron Bulutu" → "Patron bulutunu etkinleştir" → "Lisans ön koşulu:" satırı yeşil.
- **Satıcı (Mac):** `patron/sunucu/scripts/tesis.ts` → `tesis-ac` · `kurulum-kaydet` · `yonetici-davet --eposta=<e-posta> --ad=<ad>` → davet bağlantısı (`docs/ops/PATRON-BULUTU-KURULUM.md`). Panelde davet ekranı YOK — ilk yöneticiyi satıcı davet eder, diğerlerini yönetici uygulamadan açar.
- **Patron uygulaması:** "Davet kodum var" → kod → parola (≥12, iki kez) → TOTP karekodu → "Onayla" → "Hesabınız etkin" → giriş (e-posta + parola → doğrulama kodu) → Siparişler → "Yeni sipariş": cari · döviz · termin · açıklama; kalem: ürün · renk · miktar · birim fiyat → "Fabrikaya gönder".
- **Beklenen:** sipariş gelen kutusundan fabrikaya düşer (panelde siparişlerde görünür), bulutta durum İŞLENDİ. Zorla kipte KISITLI/DURDURULMUŞ iken sipariş çekilmez, bulutta BEKLİYOR kalır (§14'te bir kez ölç).

## 13. Destek talebi

- **Nerede:** panel "Sistem" → "Destek" → "Yeni destek talebi".
- **Yap:** "Konu" · "Açıklama" · "Ekran görüntüsü ekle" → "Talebi gönder".
- **Beklenen:** "Talepler" listesinde "Gönderilmeyi bekliyor" → "Açık".
- **Satıcıya bildirim:** ⚠️ **Telegram / e-posta bildirimi BUGÜN YOK** (satıcı kodunda bildirim kanalı ve ayarı yok) — satıcı talebi yalnız portaldaki "Destek kutusu"ndan görür. Adım ❌ yazılır.
- **Portal:** "Destek kutusu" → talep → "Yanıt" → "Yanıtı gönder" (ya da "Talebi kapat" / "Notla kapat").
- **Beklenen:** satıcı zili → fabrika hemen yoklar → panel talep detayında "Satıcı yanıtları" (liste 60 sn'de bir tazelenir), durum "Yanıtlandı".

## 14. Yaptırım kademeleri K0…K5 ve geri alma (Zorla kip)

**Nerede (her kademe):** portal kurulum → "Yaptırım" → "Yaptırım uygula" → "Kademe" · "Mesaj" · "Dondurulacak modüller" · "Kısıtlı kipe geri sayım" ("Hemen" · "7 gün" · "15 gün" · "30 gün" · "Özel gün" · "Tarih") → "Uygula…" → "Sebep (zorunlu, deftere yazılır)" (+ K4, K5 ve 7 günden kısa K3'te "Lisans numarası (ikinci onay)") → fabrika zille saniyeler içinde (zil yoksa ≤ 1 saat; panelde "Lisansı şimdi yokla").
**Geri alma (her kademeden sonra):** "Yaptırım defteri" → satır → "Geri al" → "Yaptırımı geri al" → panel "Lisansı şimdi yokla" → "Uygulanan kademe" = "Normal".

| Kademe | Beklenen — panel | Beklenen — tablet |
|---|---|---|
| K0 · Mesaj bandı | üstte bilgi bandı (mesaj metni) | bant |
| K1 · Güncelleme dondurma | ⚠️ tasarım: yeni sürüm İNMEZ; bugün Worker yayında olmadığı için İNER — bilinen sınır | aynı |
| K2 · Modül dondurma | seçilen modülde "Lisansınızda yok" rozeti, yazma reddi | "<Modül> modülü lisansınızda kapalı" |
| K3 · Süreli kısıtlı kip | "…N gün sonra kısıtlı kip." uyarısı; tarih geçince K4 davranışı | bant |
| K4 · Anında kısıtlı kip | "Program kısıtlı kipte" → "Salt okunur devam et" / "Çıkış yap"; okuma, rapor, dışa aktarma, yedek AÇIK; yazma 403 | bant "Lisans kısıtlandı…", yazmada "Lisans kısıtlı kipte — yeni kayıt yapılamaz", çip "Lisans nedeniyle bekleyen N kayıt" (kayıt silinmez) |
| K5 · Anında tam durdurma | "Program durduruldu"; girişte "Verilerimi al — yönetici hesabıyla giriş yapın" | "Lisans durduruldu" → "Tekrar dene" / "Çıkış yap" |

- **Taksit provası (§3):** ilk kalemin vadesi + gecikme günü geçince bakım işi K3'ü kendisi uygular → "Plan ve taksit" → kalemde "Ödeme alındı" → "Ödemeyi onayla" → K3 ters kayıtla kalkar, süre uzar.
- **Planlı eylem provası (§3):** K0 vadesinde bant kendiliğinden gelir; satırdan "İptal et" ile geri alınır.
- **Kanıt:** her kademe için panel + tablet görüntüsü ve portal "Yaptırım defteri" satırı (ileri + GERİ_AL).

## 15. Çevrimdışı yenileme

- **Benzetim:** backend'in satıcıya çıkışını kapat: `C:\TeksERP\app\.env` → `LICENSE_SERVER_URL=kapali` → backend yeniden başlatma (SYSTEM görevi). Adım sonunda eski değere dönülür.
- **Nerede:** panel "Sistem" → "Lisans" → "Çevrimdışı (QR)" kartı → "Yenileme isteği oluştur".
- **Yap:** QR ve "İstek metnini kopyala" (istek 10 dk geçerli) → telefonla QR'ı okut → satıcının `/q` sayfası yanıt QR'ını/metnini verir → panelde "Lisans sunucusunun yanıt metni" → "Yanıtı yükle" (ya da tablet "Ayarlar" → "Lisans" → "Yanıt QR'ını okut").
- **Beklenen:** "Kira" bitişi ileri gider; "Son yoklama" değişmez (çevrimdışı). Ara yol: "Bu bilgisayar üzerinden yenile" (sunucu kapalı, panel bilgisayarı açık).

## 16. Yeni sürüm yayını ve otomatik güncelleme

- **1e yayını:** panel `./deploy/electron-paketle.sh demofabrika` → `./deploy/electron-yayinla.sh --musteri=demofabrika`; tablet OTA `cd mobil && npm run yayinla -- --musteri=demofabrika` → `node deploy/mobil-yayinla.mjs --musteri=demofabrika --paket=<dizin>`; backend `paketle.ps1 -Musteri demofabrika` → `kur.ps1` (SYSTEM görevi). Bu kanalda terfi kapısı şart aramaz (terfi kaynağı yok); sürüm notu kapısı aynen.
- **Panel:** açılışta ve 15 dk'da bir denetim → "Yeni sürüm indiriliyor…" → "Güncelleme kurulacak" (oturumda 120 sn, girişte 15 sn geri sayım) → "Şimdi kur ve yeniden başlat" → Windows izin penceresinde "Evet" → açılışta "Bu güncellemede neler değişti" → "Tamam". Elle: "Sistem" → "Güncelleme" → "Şimdi kontrol et".
- **Tablet:** öne gelişte "Yeni sürüm uygulanıyor" (gönderilmemiş kayıt yokken); zorunlu sürümde "Güncelleme gerekli" → "Şimdi yenile" (OTA) / "İndir ve kur" (APK); elle "Ayarlar" → "Güncelleme" → "Güncellemeleri denetle".
- **Gözlem:** yeni müşteride ilk açılış sürüm notu modalı hangi turları gösteriyor (kanalda yayın geçmişi yok) — not al.

## 17. Yedek ve geri yükleme

- **Yedek:** panel "Sistem" → "Yedekler" → "Şimdi yedek al" → "Yedeği başlat" → listede "Şifreli" rozeti → "İndir". Gece yedeği: sunucuda `Start-ScheduledTask TeksERP-DB-Backup` → `C:\TeksERP\backups\backup.log`.
- **Kopyaya geri yükleme (satıcı oturumu):** "Sistem" → "Veritabanı Geri Yükleme" → "Yedek seçin…" · "Yedek parolası" → "Kopya oluştur" → "Takas komutunu hazırla" (komut sunucuda yönetici PowerShell'de).
- **Yerine geri yükleme:** "Yedekler" → satır → "Geri yükleme seçenekleri" → "Geri yükle (üzerine yaz)…" → "Yedeğe geri dön" → veritabanı adını yaz → "Geri yükleme komutunu kopyala".
- **Müşteri anahtarıyla bağımsız açma:** USB'deki müşteri özel anahtarıyla yedeği sunucudan bağımsız aç (`docs/ops/YEDEK-SIFRELEME.md`); tatbikat `docs/ops/YEDEK-GERI-YUKLEME-TATBIKATI.md`.
- **Beklenen:** geri yüklenen kopyada §11'in kayıtları; kurulum kimliği ve lisans deposu (`C:\TeksERP\lisans`) veritabanıyla birlikte TAŞINMAZ.

## 18. Kapanış ölçümü

- adnansahin'e hiçbir şey gitmedi: `deploy/vds-dogrula.sh` (salt okuma) → "adnansahin AYNI".
- Portal: kurulum ETKİN · kip Zorla · kademe Normal · yaptırım defterinde her ileri satırın GERİ_AL'ı.
- Adım tablosu: §1–§17 için ✅ / ❌ / ⚠️ + kanıt dosyası adı.

## Bilinen sınırlar ve açık borçlar (senaryo başında)

| # | Konu | Etki | Kapanır |
|---|---|---|---|
| 1 | Sözleşme kabul ekranı yok (§7) | satış akışında hukuki onay adımı yok | panelde kabul ekranı + protokolde kabul kaydı |
| 2 | Destek bildirimi (Telegram/e-posta) yok (§13) | satıcı yeni talebi yalnız portala bakınca görür | satıcıda bildirim kanalı + ayarı |
| 3 | İndirme kapısı Worker'ı yayında değil (§0.9, §14 K1) | indirmeler anonim; K1 güncellemeyi durdurmaz | Worker yayını (`docs/ops/INDIRME-KAPISI-WORKER.md`) |
| 5 | Süperadmin komutu belgelerde çelişkili (§5.6) | `npm run` paketli kurulumda yok | `docs/ops/SUPERADMIN-KURULUM.md` düzeltmesi |
| 6 | API kuralına Tailscale aralığı belgesiz (§5.3) | varsayılan kural tableti dışarıda bırakabilir | `docs/ops/KURULUM.md`e `-ApiIzinliAdres` satırı |
| 7 | testfabrika kurulumu kalmıyor | adnansahin'in terfi zinciri testfabrika kanalında yayın ister; "önce testfabrika" doğrulaması için makine yok | karar verildi (2026-10-05): testfabrika emekli, yeni test kurulumu sıfırdan üretim satıcısında "test" grubunda (liste 3.8) |
| 8 | Portal kanal türü ↔ kayıt defteri türü bekçisiz (§0.8) | elle eşlenir | — |
