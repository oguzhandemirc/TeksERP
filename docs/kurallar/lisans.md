# Lisans · Kod koruma · Satıcı platformu
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/lisans.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi. Tasarım: `docs/design/LISANS-KOD-KORUMA.md` · `PATRON-BULUTU.md` · protokol `LISANS-PROTOKOLU.md` (kod `Teks-Erp/src/lib/license/protocol/`) · v2 `LISANS-V2-CEVRIMDISI-KIRA.md`. Kod adı İngilizce; tel anahtarı ve kod DEĞERİ Türkçe. "bekçi YOK" satırları ayrıntıda `Kapanır:` koşullu borçtur.

## Ortak (fabrika + satıcı + istemciler)

### Değişmezler

- [ÇEKİRDEK] Fabrikayı aniden durdurma: KISITLI'dan önce hep 30 gün EK_SURE; P'ye dek NORMAL; ölçülemedi/parmak izi 14 g UYARI → EK_SURE; üç iz yoksa hemen EK_SURE; veri erişimi (okuma, rapor, yeniden basım, dışa aktarma, yedek) her kademede, K5'te "verilerimi al" açık.
- [ÇEKİRDEK] Kilide girmeyen kurulumda motor GÖZLEM kipindedir, SIFIR FARK: hiçbir istek engellenmez, bant yok; istisna yalnız bilgi bandı `OBSERVE_INFO_BANNER_CODES` (`BAKIM_BITIYOR`/`BAKIM_BITTI`) ve `PROCESS_INFO_BANNERS`; `zorla` yalnız portal kirasıyla, kurulum başına.
- [ÇEKİRDEK] Süre çapası İMZALI tarihtir: P = min(`odenmisTarih`, kira verilişi + HAK `cevrimdisiUfukGun`), satıcıda tek yardımcıdan; ufuk HAK'ta (varsayılan 400, bayi ≤400, DEMO/TEST ≤45); alan eksik/HAK doğrulanamaz → eski çapa; dosya/durum kaydı silmek süreyi uzatmaz, K4'ü kaldırmaz.
- [ÇEKİRDEK] Zamanın KISITLI'sı iki anahtarlıdır: ek süre geçti VE son 24 sa başarılı kira alışverişi yok (`sunucuSaati`; QR/dosya kirası sayılır, bellek sinyali sayılmaz); internet varken kademeyi yalnız satıcı düşürür; saat ileri erken bitirmez, geri saat alt sınıra tutturulur.
- [ÇEKİRDEK] Sunucu kararları (K1–K5, `donmusModuller`, DEVREDILDI) son geçerli kiradan KALICIDIR; ek süre ve ÖLÇÜLEMEDİ onları gevşetmez.
- [ÇEKİRDEK] Modül tavanı: etkin = bayrak ∧ (gözlem ∨ (tavan ∋ anahtar ∧ ∉ donmuş)); HAK doğrulanamazsa SON BİLİNEN tavan; `production.enabled` her hâlde açık; `MODULE_DEPENDENCIES` ön koşulu tavandan; elle DB bayrağı 403 `LICENSE_MODULE`.
- [ÇEKİRDEK] Fabrikadan dışarı HER istek (hata raporu ve eşitleme dahil) kurulum anahtarıyla imzalı İSTEK'tir (`typ`, ±10 dk, nonce, gövde özeti, amaç); imzasız dış çağrı yazma.
- [ÇEKİRDEK] Canlı yanıtı yalnız kendi nonce'una `yanitBagi` ile bağlıysa kabul et (`YANIT_NONCE_UYUSMAZ` · `YANIT_BAGI_UYUSMAZ` · `yanitBagli: true`'da bağsız `YANIT_BAGI_YOK`); eski satıcının bağsızı ve taşınmış yanıt (dosya · QR · zarf) bağ denetimine girmez.
- [ÇEKİRDEK] Yoklama iş verisi TAŞIMAZ: KATI şema + allowlist sağlık özeti (sürüm, süre, DB boyutu, yedek, istemci SAYISI, hata SAYACI); iş verisi yalnız `patron-bulut` hakkıyla ayrı kanaldan.
- [ÇEKİRDEK] Yoklama `acikModuller`i (kapalı küme `MODULE_SETTING_KEYS`) opsiyonel taşır; satıcı ÖNCE kabul eder, eski fabrikada portal "bilinmiyor" der.
- [ÇEKİRDEK] Parmak izi beş etken (F1 OS · F2 SMBIOS UUID · F3 disk · F4 seri · F5 PG `system_identifier`), kurulum tuzuyla HMAC; 24 sa okunamayan = KAYIP; geçerli = eşleşen ≥3 ∧ güçlü (F2 · F3 · F4) ≥2; DR'de F5 dışarıda; `zayif` kuralda ≥ min(3, n); eşik altı merdivene girer.
- [ÇEKİRDEK] Lisans kimliği portalda doğan `kurulumId`dir, `LICENSE_DIR`de durur; DB `installationId` yalnız bilgi (`ortam.installationId`); yalnız etkinleştirme ve taşıma talebi kimliksiz imzalanır.
- [ÇEKİRDEK] Güven çapası İKİ KİP, birleşmez: ÜRETİM (`kok-<yıl>-<n>`, `paket-<yıl>`) / HAZIRLIK (`hazirlik-*`, yalnız TEST/DEMO); kip DERLEME ANINDA (`deploy/kanallar.json` `backend.guvenCapasi`, `trust-anchor.ts`, cargo `hazirlik-capasi`); ara imzacı çapaya girmez; özel anahtar `src/`e girmez.
- [ÇEKİRDEK] Hiyerarşi iki seviye: KÖK çevrimdışı (Mac), ara sertifikaları + iptal + eski derleme HAK'ını imzalar; HAK'ı VDS'teki ara imzacı imzalar; ara · ALT · İNDİRME 395 g, yılda bir `uretim-toren.mjs donem`; sertifikayı yalnız kök imzalı tekdüze `sira`lı `tekserp-iptal` geçersiz kılar.
- [ÇEKİRDEK] Ara imzacı sınıfları `satici/sunucu/src/keys/intermediate-classes.ts`ten türer (elle liste yazma); `HakKokTalebi.planNedeni` (`YETENEK_YOK` · `ARA_IMZACI_YOK`) doğuşta saklanır, portalda gösterilir; kuyruğu yalnız `uretim-toren.mjs kuyruk` imzalar.

### Yasaklar

- [ÇEKİRDEK] Parmak izinde MAC ve CPU kimliği KULLANMA; F3 disk SERİSİ (RAID genel/boşsa `UniqueId`), F4 `Win32_BIOS.SerialNumber` → `Win32_BaseBoard.SerialNumber`; `Get-PhysicalDisk` ve `Get-NetAdapter -IncludeHidden` çağırma.
- [ÇEKİRDEK] Kök/ara imzacı parolası yalnız Anahtar Zinciri (`tekserp/kok` · `tekserp/ara`), TTY/stdin ya da imza alt sürecinin stdin'iyle; argv, ortam, disk, log, audit ASLA; sabit zamanlı karşılaştır, belleği sıfırla; kök özel yarısı VDS'te DURMAZ.
- [ÇEKİRDEK] İndirme Worker rotası adın TAMAMI (`<ad>/*`); joker rota (`*.<alan>/*`) EKLEME; rota değişince kapı dışı adresleri ölç.

### Kararlar

- [ÇEKİRDEK] Kira zinciri: (a) aynı iz geride → YAKALA, uyarısız; (b) 15 dk tekrar → aynı kira; (c) iki iz → KOPYA_SUPHESI, 2. pencerede eşleşmeyene KAPANIŞ KİRASI (yalnız `odenmis-tarih` bildirene; eskiye 403); anında durdurma yok; `YABANCI_KIRA` · `KIP_UYUSMAZ` yalnız uyarı.
- [ÇEKİRDEK] P − 30 g'de kademe NORMAL, yalnız bilgi bandı `ODEME_YAKLASIYOR` (internetsiz ya da P sözleşme sonuyken); internetsiz uzatma QR / panel aktarması / imzalı uzatma DOSYASI (eskisi `LICENSE_LEASE_STALE`).
- [ÇEKİRDEK] Panel tek bant alanı çizer: `/durum` `bantlar[]` şiddete göre, döner (6 sn); eski `bant` korunur ve DAİMA `bantlar[0]`.
- [ÇEKİRDEK] 400+ g ya da süresiz ufku ara imzacı imzalayabilir (bilinçli risk); dört önlem gevşemez: sınıf tavanı (`UFUK_TAVANI_ASIMI`), uzun ufuk yalnız yönetici + lisans no (`uzunUfuk`, `UZUN_UFUK_VERILDI`), `YABANCI_HAK`, iptal kirayla yayılır; ara imzacı 395 g.
- [ÇEKİRDEK] Eski kurulum yoluna (pm2 + `kur.ps1`) paket doğrulama/geri indirme kodu YAZMA; Dağıtım v2 çözer, v1'de özet ve sürümü elle karşılaştır.
- [ÇEKİRDEK] Taşıma yalnız TALEP açar; onayda tek kullanımlık `tasima` kodu doğar; ETKİN kuruluma başka anahtarla `ilk` kod 409 `TASIMA_KODU_GEREKLI`; kimliksiz talep otomatik bağlanmaz.
- [ÇEKİRDEK] `ISTEK_ZAMAN` `details.sunucuSaati` İMZASIZDIR: yalnız BİR KEZ yeniden imzala, `SAAT_KAYIK` + `saticiSapmaSn` raporla; satıcı saati güvenilir saate ve kademeye girmez.
- [ÇEKİRDEK] Sunucu saatini kilitleme/değiştirme, yalnız uyar: kurulum etki alanı dışında NTP açar; sapma `SIGNED_SKEW_WARN_SECONDS` aşınca bilgi bandı; `lisans.saatSapmasi`, `saat.imzaliSapmaSn` lisans kararına GİRMEZ.
- [ÇEKİRDEK] Etkinleştirme kodu 16 karakter Crockford base32 (`TKS-XXXX-XXXX-XXXX-XXXX`), tek üretici `generateActivationCode`; 12'lik eski biçim tanınır, üretilmez; tür (`ilk` · `tasima`) satıcı kaydında.
- [ÇEKİRDEK] Kalıcı lisans + yıllık bakım: bakım bitince program DURMAZ, son hak edilen sürümde kalır; sayı sınırı yok; modül hakkı TAVANdan.
- [ÇEKİRDEK] Güncelleme dosyalarını (`electron` · `mobil` · `backend` · `backend-oci`) yalnız İNDİRME belirteciyle ver, her katman FAIL-CLOSED (Worker = `protocol/indirme.ts` kâhini, geçersiz ayar 503, origin yalnız Cloudflare); anonim geçiş yalnız ≤90 g bitişli listeyle.
- [ÇEKİRDEK] Worker rotasını yayıncı belirteci (`typ: tekserp-indirme`) `~/.tekserp/yayin-belirteci`ne yazılmadan BAĞLAMA; `onbellek-atla` · `cb` aynen iletilir, `t` düşer, önbellek anahtarı belirteçsiz URL.
- [ÇEKİRDEK] Worker anahtarları TEK listede (`indirmeListesi.uretim`; `hazirlik` dizisi → 503): kid × kanal × pencere (`JWS_KID` · `INDIRME_KANAL` · `INDIRME_PENCERE`); çift kid, >730 g pencere 503; yeni satırı satıcıdan ÖNCE ekle, iptal kid'i hemen sil.
- [ÇEKİRDEK] OTA takma adını (`/ota/<rv>/manifest`) yalnız doğrulanmış belirtecin grubundan çöz; ayar `worker/indir-ayar.json`, emekli kid (`ind-2026`) taşımaz.
- [ÇEKİRDEK] Dönem kid'ini kökün ortam kalıbında bas (`alt|ara|ind-<yıl>-<n>` / `-hazirlik-`); karşı ortamın kalıbı ya da var olan kid → tören parola sormadan durur.
- [ÇEKİRDEK] İndirme belirtecini yalnız `GET /api/license/indirme-belirteci` verir: K1'de 403 `LICENSE_UPDATES_FROZEN`, yok/süresi geçmiş → 404 + dürt; istemci her denetimde TAZE ister, alamazsa BAŞLIKSIZ — bayat belirteç gönderme.
- [ÇEKİRDEK] Panel belirteci `AppUpdater.requestHeaders` ile verir (`applyFeed`), `setFeedURL` seçeneğiyle DEĞİL; gerçek `AppUpdater`la ölç.
- [ÇEKİRDEK] Belirteci yalnız kendi platform dizinine bas (`DOWNLOAD_PRODUCTS_BY_PLATFORM`); yeni dizini Worker `URUN_DIZINLERI`ne ilk yayından ÖNCE, `scripts/lib/yayin-okuma.mjs`i satıcı CLI'ından ÖNCE güncelle.
- [PROFİL] Satıcı tekserp-vds'te ayrı compose (`deploy/satici/`): kendi PG16, port yayını yok, ağlar `kenar · ic · ic-api` internal, portal yalnız ERİŞİM (`docker-compose.portal-genel.yml` ZORUNLU), yalnız ÜRETİM satıcısı; iç API 4612 yalnız patron /32; kurulum öncesi `compose-denetle.mjs` yeşil.
- [PROFİL] İndirme kökeni ayrı compose (`deploy/guncelleme-sunucusu/indir/`): kendi yönlendiricisi `tekserp-indir` ve kenar zinciri; eski `tekserp-guncelleme`ye dokunma.
- [PROFİL] Geçiş sırası: her faz önce testfabrika (thinkpad-1); adnansahin dondurulmuş, faz geçişi ALMAZ; varsayılan `zorla` yanlış pozitif 0 ölçülene dek açılmaz; SAHINSRV müdahalesi tek pencerede, "uygula" cümlesiyle.
- [ÇEKİRDEK] Devreye alma ölçüm betikleri varsayılan KURU, `--olc` ile de yalnız OKUR (`deploy/lisans-devreye/lib/ag.mjs` izin listesi); sonuç UYUMLU · IHLAL · ÖLÇÜLEMEDİ; satıcı fabrikadan ÖNCE, geri almada fabrika ÖNCE.
- [ÇEKİRDEK] `deploy/vds-dogrula.sh` yalnız OKUR (`tekserp-yayin` + `TEKSERP_YEDEK_SSH_HEDEF`; yayinci docker grubuna EKLENMEZ); okunamayan yedek `YEDEK ÖLÇÜLEMEDİ`; taban repoya girmez, `--taban-yaz` ezmez; 0 AYNI · 1 FARK · 2 ÖLÇÜLEMEDİ.
- [ÇEKİRDEK] Çapaya anahtar yalnız `Teks-Erp/scripts/guven-capasi-ekle.ts` ile girer (TS + satıcı/patron aynası + `anchor.rs` tek listeden; `istemci-kok` yalnız `kok-<yıl>-<n>`); çakışan kid RED; fikstür kid'leri (`kok-fikstur-1` · `hazirlik-fikstur-1`) üretim biçimi dışında.
- [ÇEKİRDEK] Panel `tekserp-paketiptal`ı üç kaynaktan (yerel `lisans-iptal.jws` · belirteç `iptal` · künye `iptal`) birleştirir, EN YÜKSEK `sira` kazanır; görüleni yerele yaz; iptalli künye `SERTIFIKA_IPTAL`.
- [ÇEKİRDEK] Sözleşme kabulü (Ek-7) etkinleştirme ön şartı: metin `docs/hukuk/KABUL-METNI.md` → `kabul-metni-uret.ts` (elle düzenleme); `tekserp-kabul` belgesi; kabulsüz 409 `LICENSE_ACCEPTANCE_REQUIRED` / satıcıda `KABUL_GEREKLI` (ön denetim + tx içi claim); yoklama kabul istemez.
- [ÇEKİRDEK] İstemci imza anahtarının YEDEĞİNİ yıllık törende bas, kökle imzala, Mac dışında ayrı parolayla sakla.
- [ÇEKİRDEK] Tören parolası argv/ortamdan ASLA, diske düz ASLA: sıra 0600 dosya (≤4 KiB) > Anahtar Zinciri `tekserp/<ad>` (`scripts/lib/parola-kasasi.mjs`, kayıt `parola-kaydet.mjs`) > TTY; bekçide `TEKSERP_PAROLA_KASASI=kapali`; yedek parola USB'de olamaz; <30 g ISTEMCI sertifikasıyla imza atma.
- [ÇEKİRDEK] `parola-kaydet.mjs` kenar boşluğunu (NBSP dahil) atıp söyler; `-U` kullanmaz, sil-yaz yapar, düşerse KAYITSIZ der; silinemeyen kayıtta yazmaz.
- [ÇEKİRDEK] `parola-kaydet.mjs --dogrula=` kayıttan önce anahtarı açar (`anahtar-parola-dogrula.ts` → `openSealedKey`); açmazsa çıkış 1, kid ailesi uymaz/eşlemesiz → çıkış 2.
- [ÇEKİRDEK] Etkinleşmemiş korumalı kurulum yalnız etkinleştirme ekranını açar (kilit derleme sabiti); diğer uç 403 `LICENSE_NOT_ACTIVATED` (`details.sinif`); KAYIP/BELIRSIZ kipine göre, KOPYA kilit + "verilerimi al"; muafiyet yalnız satıcı imzalı belgeyle, DB işaretiyle değil.
- [ÇEKİRDEK] Yeni kurulumun HAK'ı portal varsayılanıyla `kipAltSiniri: "zorla"` doğar; mevcut HAK geriye dönük değiştirilmez.
- [ÇEKİRDEK] KAYIP/BELIRSIZ yabancı izin kipi izden (`classifyForeignTraceDetail`); `zorla` merdiveni imzalı `yabanci-iz-baslangic.json`dan akar, DB silmek sıfırlamaz.
- [ÇEKİRDEK] Müşteriye ayrı yalnız-okuma DB girişi ver (kimlik özeti ve lisans/güvenlik ayarı hariç); DB'ye elle yazma destek dışı. (bekçi YOK)
- [ÇEKİRDEK] Etkili Yazılım yedek alıcısı (`etkili.tkpub`) yeni kurulumda varsayılan dahil, var olan ezilmez, müşteri kapatabilir; kısa kimlik halkası şifreli dökümün İÇİNDE.
- [ÇEKİRDEK] Kopya koruması TPM'e bağlanmaz, makine bağı F1–F5; repo ilk satıştan önce private.

## Backend (fabrika lisans motoru)

### Değişmezler

- [ÇEKİRDEK] Satıcı adresi tek yerde (`lib/license/vendor-url.ts`): `LICENSE_SERVER_URL` yoksa üretim, `kapali` kapatır, biçimsiz fail-closed; etkinleşmemiş kurulum dışarı istek atmaz.
- [ÇEKİRDEK] `licenseGate` KİMLİĞİ ÖNCE sorar: oturumsuz istek rotanın 401'ini alır; `LICENSE_RESTRICTED`/`LICENSE_SUSPENDED` yalnız geçerli oturuma; `PUBLIC_ROUTES`ta genel `LICENSE_GATE`.
- [ÇEKİRDEK] KISITLI'da GET/HEAD serbest, yazma 403 `LICENSE_RESTRICTED` + beyanlı izin listesi; DURDURULMUS'ta yalnız giriş (2FA kurulumu dahil) + yedek/dışa aktarma + oturum (403 `LICENSE_SUSPENDED`) ve K5 sayfasının GERÇEK çağrıları; hata `details.code`, 503 yok.
- [ÇEKİRDEK] Etkinleştirme kodu URL'de taşınmaz (`cevrimdisi-istek` · `aktarma-istegi` POST); erişim günlüğü sır parametresi değerini maskeler (`utils/url-redaction.ts`).
- [ÇEKİRDEK] `LICENSE_MODULE`in tek üreticisi `licenseModuleError`, `details.modul` DB anahtarı (`finance.enabled`); satır içi modül kapıları da önce lisansa sorar.
- [ÇEKİRDEK] Her kira alışverişi tek kuyruktan (`runLeaseExchange`) geçer; yeni alışveriş kuyruğu atlayamaz.
- [ÇEKİRDEK] `LICENSE_DIR` kurulum kökünde (Win `C:\TeksERP\lisans`, ACL; Linux 0600), `app\` ve `BACKUP_DIR` DIŞINDA; proxy ayarı da orada.
- [ÇEKİRDEK] Kullanılamayan lisans deposu (korumalı derlemede program/yedek dizininde, yazılamaz, okunamaz) KURULUM HATASI: kilit `KURULUM_HATASI`, yalnız lisans ekranı + "verilerimi al".
- [ÇEKİRDEK] Lisans kimliği yalnız imzalı kiradan (`kurulumId` = kira) öğrenilir, `kurulum-kimligi.json`a yazılır; aynı DB + taze `LICENSE_DIR` etkinleşmemiş sayılır.
- [ÇEKİRDEK] Depoda yalnız `ENOENT` "yok"tur; boş/büyük/okunamayan anahtar → `DEPO_OKUNAMADI`, anahtar ÜRETİLMEZ.
- [ÇEKİRDEK] Durum kaydı `sonKira` + `sonHak` pinler; eski kira ya da ters pin → `KIRA_GERI_ALINDI`; eski yanıt yapıştırma `LICENSE_LEASE_STALE`.
- [ÇEKİRDEK] Etkin = lisans kimliği ∧ (HAK ∨ kira ∨ geçerli durum kaydı); bekleyen taşıma talebi etkin SAYMAZ.
- [ÇEKİRDEK] İz bozulması internet kesintisi SAYILMAZ: ÖLÇÜLEMEDİ bulguları (`DEPO_OKUNAMADI` · `DURUM_DOSYASI` · `KIRA_GERI_ALINDI` · `SAAT_ILERI` · `SAAT_GERI` · iz/iptal kaybı) birikir → 14 g UYARI → 30 g EK_SURE → KISITLI; yalnız yeni kira sıfırlar; `kipAltSiniri: zorla` hep alt sınır.
- [ÇEKİRDEK] DB izi (`license.trace`, ham ayar ucundan YAZILAMAZ, tek yazıcı `license-trail.service`) durum kaydının kopyasıdır; yeni tablo yok, kendi audit'ini yazmaz; sayaç yalnız BÜYÜR.
- [ÇEKİRDEK] Tek iz kaybı da kayıptır: `LISANS_IZI_KAYIP` yeni kiraya dek KALICI; DB okunamazsa BİLİNMİYOR; üçü yoksa KİRASIZ kayıt, yeniden başlatma ek süreyi tazelemez.
- [ÇEKİRDEK] Kira silinince çapa izlerin EN ERKENİ; çelişki `LISANS_IZI_CELISKI`.
- [ÇEKİRDEK] `imzaHazir` (yoklama, imza, yazım) ile `durumHazir` (kapı, tavan, yaptırım) ayrıdır; imza durunca internet YOK sayılır.
- [ÇEKİRDEK] Parmak izi merdiveninin kuralı kiradan (`parmakIziKurali`), kararı çekirdekten; v2'de birikir, eşik tutunca sıfırlanır; v1'de merdiven YOK.
- [ÇEKİRDEK] Yoklama G12 raporunu (`durumKaydi`, `belirsizlik`, `parmakIziKayip`, `hak.ozet`) KATI gövdede taşır; SATICI ÖNCE yayınlanır, alan düşürerek geri düşme.
- [ÇEKİRDEK] İptal belgesi iki kopya: `LICENSE_DIR/iptal.jws` + `license.revocation` (tek yazıcı `license-revocation.service`); yalnız daha yüksek doğrulanmış `sira` benimsenir; `LICENSE_REVOCATION_ADOPTED` yalnız gerçek benimsemede.
- [ÇEKİRDEK] İptal geçerli kirayı ANINDA öldürmez: reddedilen yanıtta belge eldeki kiranın ALT'ını iptal ediyorsa ertelenir; doğrulanamayan iptal yok sayılır.
- [ÇEKİRDEK] `IPTAL_BELGESI_KAYIP` satıcıda `YEREL_MUDAHALE` nedenidir (`LOCAL_INTERVENTION_CAUSES` + portal etiketi + ayna aynı dilimde); kira yine verilir.
- [ÇEKİRDEK] Durum kaydı `iptalSira` pinler, pin geri inmez; belge yoksa `IPTAL_BELGESI_KAYIP`, kira düşürülmez.
- [ÇEKİRDEK] HAK veriliş "şimdi"si duvar ∨ yüksek su ∨ İMZALI sunucu saati; `core-bridge.ts` iptal metni ve şimdiyi çekirdeğe AYNEN geçirir.
- [ÇEKİRDEK] Lisans ayrıntısı `zincir`i salt-okunur taşır; panel eski backend'de satırı çizmez.
- [ÇEKİRDEK] `yetenekler` tek kurucudan (`lib/license/capabilities.ts`): `odenmis-tarih` + `parmak-izi-v2` HEP, `hak-ara` + `iptal` yalnız çekirdek canlıyken; süreç başına BİR KEZ; boş liste alanı gönderme.
- [ÇEKİRDEK] Her imzalı istek `yol`u imzalar (satıcıya `ENDPOINTS`, buluta `SYNC_PATHS`); başka uca oynatma 401 `ISTEK_YOL`.
- [ÇEKİRDEK] Çevrimdışı donanım bildirimi `amac: donanim` ile `buildHardwareReportBody`den; `BEKLIYOR` 409 `LICENSE_HARDWARE_PENDING`, `REDDEDILDI` 409 `LICENSE_HARDWARE_REJECTED`.
- [ÇEKİRDEK] Motor pes etmez: başlatmayı ve yoklamayı geri çekilmeyle yeniden dener; durum `/api/admin/health` (`motor` · `motorNeden`).
- [ÇEKİRDEK] Güvenilir saat tahmini ALT sınırdır: taşınmış kirada taban = max(kira saati, ölçülmüş tahmin), CANLI alışveriş tabanı sıfırlar; tabana duvar/yüksek su girmez; kapalı kalma süresi sahte `SAAT_ILERI` vermez.
- [ÇEKİRDEK] Gözlem "reddederdim" sayacı istek × modül başına bir kez; zil geri çekilmesi ≥1 dk bağlantıda sıfırlanır; OS metni makine adı taşımaz.
- [ÇEKİRDEK] Lisans kimliği TEK dikişten (`getLicenseInstallationId`); `getLicenseDbFacts` kimlik kanalına girmez.
- [ÇEKİRDEK] Güncelleyici niyet dosyası yetki değildir: tek yazar, KATI şema (sürüm + kimlik), atomik; onay `approvalActions` yükleminden, DONDUR/K1/kirasızda verilmez.
- [ÇEKİRDEK] Güncelleme durumu dosyalardan sezgisiz okunur; lisans/bütünlük public `/health`e girmez, sonda yalnız `/health/yerel`.
- [ÇEKİRDEK] `TEKSERP_DOGRULAMA_KIPI=1`de zamanlı/dışa konuşan iş başlamaz, HOST döngü, lisans durumu yazılmaz; `server.ts`teki her `start*` `lib/dogrulama-kipi.ts` listesinde olmalı.

## Satıcı sunucusu (`satici/sunucu`)

### Değişmezler

- [ÇEKİRDEK] Satıcı hata kodu TEK KAYNAK (`VENDOR_ERROR_CODES`, `PORTAL_ERROR_CODES` kesişmez); eşzamanlılık çakışması `TEKRAR_DENEYIN`; fabrika `details.tekrarDenenebilir` söyler.
- [ÇEKİRDEK] Satıcı yalnız kendi ortamının çapasına güvenir (`GUVEN_CAPASI`); üretimde dosya çapası (`GUVEN_CAPASI_DOSYASI`), kipsiz ya da geçersiz çapa açılışı DURDURUR; CLI'lar da kip ister.
- [ÇEKİRDEK] `kurulumId` satıcıda sunucu tarafında doğar; form onu almaz (KATI 400); kimlikli istekte başka kurulumun kodu "yok".
- [ÇEKİRDEK] Etkinleştirme kodu pepper ile HMAC'lenir, son 4 yalnız kod satırında; sır `anahtar.ts sirlar-uret` ile önceden, yoksa açılış düşer.
- [ÇEKİRDEK] `/v1/*` IP ve imzadan SONRA kurulum başına hız sınırlı (429 `HIZ_SINIRI`); vekil başlığı yalnız güvenilen kenar ağından; ucuz ön denetim nonce/kilitten ÖNCE; zil ≤3 akış.
- [ÇEKİRDEK] Açık her Traefik yönlendiricisi iki halkalı kenar zinciri: Cloudflare `ipallowlist` (`CLOUDFLARE_NETWORKS`, `ipstrategy` yok) → `Cf-Connecting-Ip` hız seddi; güncelleme yönlendiricisine ara katman yok, `writeTimeout` 0.
- [ÇEKİRDEK] İmza parolası 5 hatada 15 dk kilit (girişten ayrı), her hata denetim satırı, imza alt süreci 1–2 slotlu semafor.
- [ÇEKİRDEK] Bayi yazması sahipliği tx'te müşteri kilidi ALTINDA yeniden okur; bayi değişimi yalnız yönetici + yeni tavan uygun; bayi yalnız etkinleşmemiş kuruluma kod üretir, başka kullanıcı adını görmez.
- [ÇEKİRDEK] Kilitli hesap bilinmeyen hesapla AYNI yanıtı alır (401, eşdeğer scrypt).
- [ÇEKİRDEK] Giriş kilidi hesap + KAYNAK ikilisine (`portal/login-throttle.ts`); `kilitBitis` girişte yazılmaz; kilit açma kaynak kilitlerini düşürür.
- [ÇEKİRDEK] Kayıtsız/pasif kurulum ve yabancı anahtar AYNI 401 `KURULUM_BILINMIYOR`; ayrım yalnız log'a.
- [ÇEKİRDEK] Taşıma talebi durum sızdırmaz (hep 200 `BEKLIYOR`); `hedefKimlik` başına TEK bekleyen (409 `TASIMA_ONAYI_BEKLIYOR`); doğum tavanlı (429 `HIZ_SINIRI` + `TASIMA_SELI`).
- [ÇEKİRDEK] Bayi kendi kurulumunun taşıma talebini reddeder, ONAYLAYAMAZ; yabancı 404; red atomik claim.
- [ÇEKİRDEK] Geçici açılış kodunu yalnız KÖK imzalar, yönetici üretir (`kurulum:gecici-kod`, 7–90 g); bayi talep açar; düz kod DB/denetime girmez; tüketim `/v1/gecici-kod/tuketildi` ile bir kez.
- [ÇEKİRDEK] Fabrika geçici kodu ÜRETİM köküne ve güvenilir saate karşı her okumada doğrular; tek kullanımlık, neden `GECICI`; yalnız korumalı derlemede; tam etkinleştirme kapatır; panel `gecici`den okur.
- [ÇEKİRDEK] Sır dosyası (`*.anahtar.json` · pepper · `portal-totp.key` · `modul-kasasi.key`) diğerlerine açıksa (`mode & 0o007`) açılış DURUR; kaçış yalnız `NODE_ENV≠production` + `ANAHTAR_IZIN_UYARI=1`.
- [ÇEKİRDEK] Bellek içi hız sınırlayıcı haritası SERT tavanlı.
- [ÇEKİRDEK] İç API (`/ic/v1/*`) yalnız iç dinleyicide, kaynak kapısı (değilse 404) + dosyadan Bearer (yanlışsa 401); sırsız açılmaz; yanıt allowlist; bitiş `cloudEntitlementUntil`.
- [ÇEKİRDEK] Bulut kira alanlarını (`patronBulutBitis` · `esitlemeAraligiDk` · `saklamaAy`) tek yardımcıdan bas (`services/cloud-entitlement.ts`); aralık 1–60 (5), saklama 3/13/25/tümü (13).
- [ÇEKİRDEK] Kiranın HAK'ı ve teslim edilen HAK tek seçimden (`entitlementForDelivery` → `deliverableEntitlement`); tekrar yolu bağlı sürümü teslim eder; iptal `leaseRevocation` → `distributableRevocation`.
- [ÇEKİRDEK] İmza planı yeteneği `signingCapabilities`ten, teslim yeteneği `installationCapabilities`/gövdeden; beklenen küme teslime/kiraya girmez.
- [ÇEKİRDEK] Yeteneksiz alıcıya eski HAK yalnız güncelden geniş değilse (`isEntitlementWithin`); genişse `hak: null`, kök kuyruğu + `YETENEK_DUSUSU`; bağlanamazsa 403 `KIRA_VERILMEDI` + `KOK_IMZASI_ACIL`, kod/nonce tüketilmez.
- [ÇEKİRDEK] Bağlanamayan kirayı HİÇBİR yoldan verme; kural `lease-binding.ts`te (`leaseUnbindable` · `holdForRootSignatureTx` · `assertBindableBeforeLease`); eski aday `newestLegacyVersion`.
- [ÇEKİRDEK] Satıcı DIŞARI BAĞLANMAZ: bildirim olayın tx'inde `bildirim` kutusuna; gönderim yalnız `satici-bildirim` (`satici_bildirim` rolü); gövde ALLOWLIST (seddi `bildirim_govde_gecerli`).
- [ÇEKİRDEK] Bakım bitişini saklama: fabrika `BAKIM_BITIYOR`/`BAKIM_BITTI` bilgi bandı, portal `GET /bakim-bitecek` + `BAKIM_BITISI_YAKLASIYOR` (DEMO/TEST hariç); geriye alan imza formu önce uyarır.
- [ÇEKİRDEK] Bildirim içeriği olayı düşürmez: vekil → U+FFFD, kontrol → boşluk, 300 kod birimi, `octet_length(govde::text)` ölçüsüyle '…' kısalt.
- [ÇEKİRDEK] Gönderici rolünü `enableSenderLogin` ve `assertLeastPrivilege` aynı `privilegeReport` ile ölçer; fazladan öznitelik/üyelik/USAGE/CREATE/EXECUTE varsa giriş açılmaz.
- [ÇEKİRDEK] Deneme bildirimi (`POST /bildirimler/deneme`) kullanıcı başına 5 dk'da bir (429 `HIZ_SINIRI`, `tekrarSn`).
- [ÇEKİRDEK] Satıcı `denetim` DEFTER DEĞİL: günde bir budanır (başarısız giriş 90 g, diğeri 2 yıl), `PRUNED_MODELS`te beyanlı; karar denetimden okunmaz.
- [ÇEKİRDEK] Portala yalnız ERİŞİM dinleyicisi (Cloudflare Access): her istekte Access JWT (RS256, JWKS, `aud`, `iss`, `exp`) + parola + TOTP; doğrulanamayan 404; JWKS'i yalnız `satici-jwks` yazar, satıcı salt okur.
- [ÇEKİRDEK] ERİŞİM'e yalnız izin listesindeki rota (`src/http/erisim-rotalari.ts`, OPT-IN; `ERISIM_DISI_ROTALAR`); liste dışı gövde okunmadan 404; `createAccessApp`e her `app.*` beklenen envanterle BİREBİR.
- [ÇEKİRDEK] İmzanın TEK boğazı `signWithWrappedKey`; kapsam yalnız `runInListenerScope` ile (`runAsCli`/`runInScope` src/'de yok); `keys/signing-scope.ts`: KÖK/ARA ERİŞİM · CLI, BAYİ GENEL · CLI, tanınmayan tür RED.
- [ÇEKİRDEK] ERİŞİM'deki her denetim satırı Access e-postasını (`ozet.erisimKimligi`, `recordAudit`) taşır; denetimsiz yazma `ERISIM_YAZMA`; parola değişimi `PORTAL_PAROLA_DEGISTI`.
- [ÇEKİRDEK] Parola/TOTP taşıyan her gövde anahtarını `SECRET_BODY_KEYS`e (`portal/idempotency.ts`) koy.
- [ÇEKİRDEK] JWKS yaş tavanı `CF_ACCESS_JWKS_AZAMI_YAS_GUN` (1–30, 7); aşınca RED `JWKS_ESKI`; durum `GET /portal/api/saglik`.
- [ÇEKİRDEK] Portala ERİŞİM'den başka yol AÇMA (tünel, `TAILNET_*`/`PORT_TAILNET`, port yayını yok); `PortalDinleyici.TAILNET`e yeni satır yazma.
- [ÇEKİRDEK] Compose'da yalıtım gevşetme YASAK (`volumes_from`·`privileged`·`cap_add`·`pid`/`ipc`/`uts`/`userns_mode`/`cgroup`·`devices`·`runtime`·`sysctls`·`network_mode`); `security_opt` yalnız `no-new-privileges:true`; ALLOWLIST denetim (`--profile '*'`, `group_add` yalnız `SIR_GID`, IPv6 kapalı).
- [ÇEKİRDEK] Bildirim örtüsünü Ⓑ0–Ⓑ8 ile ölç (`bildirim-cikis` ↔ `BILDIRIM_CIKIS_AGI`, ⑬g/⑬h `satici-jwks` ↔ `JWKS_CIKIS_AGI`); `--patron-env` yoksa ÖLÇÜLMEDİ, çıkış 2.
- [ÇEKİRDEK] Güncelleme denemesini `kurulum_kaydi` ile AYNI tx'te bildir; bildirim yazılamazsa satır da yazılmaz.
- [ÇEKİRDEK] Güncelleme dalgası (aşama 0–3, `isWaveMember`) yalnız insanla ELLE, atomik claim + `guncelleme_dalgasi_kaydi`; `GUNCELLEME_DALGA_UYARI` aşamaya dokunmaz, otomatik ilerletme yazma.
- [ÇEKİRDEK] `VALIDITY_END_REQUIRED_CLASSES` (DEMO) hakkını bitişsiz kaydetme; tek boğaz `requireValidityEnd` 400.
- [ÇEKİRDEK] Dağıtım iptalini (`tekserp-paketiptal`) ayrı `paket_iptal_belgesi` defterinde tut (düşük/aynı sıra 409); `paketIptal` her kuruluma `leasePackageRevocation`dan; yetenek/sıra pini yok.
- [ÇEKİRDEK] ISTEMCI · PAKET açık sertifikalarını `istemci/` · `paket/` dizininden canlı oku, DB'ye yazma; dağıtım iptalini portalda SALT OKUNUR göster.

### Kararlar

- [ÇEKİRDEK] DR'de ana kimlik opsiyonel; tek etkin ÜRETİM yoksa 409 `DR_ANA_BELIRSIZ`.
- [ÇEKİRDEK] <7 g geri sayımlı K3 AĞIR: yalnız yönetici + lisans no ikinci onay; `agir` yazımda donar.
- [ÇEKİRDEK] Bayi tavanı: modül ⊆ · sınıf ⊆ · adet · kanal ⊆ · kalıcı izni (HAYIR) · bakım ay (12); bayi kilidi altında yeniden denetlenir, sürümlü defter.
- [ÇEKİRDEK] Kurulum KAYITLI kanala bağlı (FK, `kod` değişmez, sert silinmez); `kanal.guncelSurumler` kanal satırından.
- [ÇEKİRDEK] Kanal = `UPDATE_GROUPS` (test · oncu · genel); grubu yalnız `musteri:yaz` değiştirir (`kurulum_kaydi` + zil); `POST /kanallar` yok; emekli kanal belirteç almaz.
- [ÇEKİRDEK] Belirteç yanıtı `grup` yalnız kiranın `kanal.kod`undan ve `UPDATE_GROUPS`tan; yoksa `null`.
- [ÇEKİRDEK] Panel feed'i yalnız belirteç `grup`undan seçer; grup yoksa denetlemez.
- [ÇEKİRDEK] Dağıtım belirteci (`/d` · `/y`) DB'de yalnız HMAC + son 4; indirme hakkı POST'ta, başlarken atomik WHERE + CHECK; özet tutmazsa 410.
- [ÇEKİRDEK] Yükleme parçalı (`PARCA_AZAMI_MB` = 50, sha256); kota açılışta rezerve; budamada yalnız GÖVDE silinir.
- [ÇEKİRDEK] Gövdeyi depolamadan önce `distribution/content-vet.ts` `vetContent` ile denetle; GELEN yönde yürütülebilir/makro 415 `DOSYA_TURU_YASAK`; tavanı yayın yapıtlarından ölç.
- [ÇEKİRDEK] Yedekte anahtar arşivini ÇİFT katmanla şifrele (`deploy/satici/yedek-dongusu.sh`, `anahtar-katmani/`); katman alıcısı yoksa anahtar arşivini ALMA.
- [ÇEKİRDEK] Yayın bildirimi tek yardımcıdan (`scripts/lib/yayin-bildirim.mjs`); yayını durdurmaz, kanal sürümünü değiştirmez.
- [ÇEKİRDEK] Üretim anahtarlarını YALNIZ `deploy/satici/uretim-toren.mjs` ile üret (`PAKET_KOMUTU`); kök parolası PAKET aracına gitmez; argv/ortam ASLA; hepsi-ya-da-hiçbiri; kâğıda yalnız kök parolası.
- [ÇEKİRDEK] Töreni DONMUŞ kaynaktan koş (temiz ağaç, origin/main ya da `--etiket`, `npm ls --all` temiz), değilse parola sormadan RED; sembolik bağ RED, `wx` yazım.
- [ÇEKİRDEK] Donanım değişikliği iptal ETMEZ, öğrenilir (güçlü ≥2 → otomatik); `POST /api/license/donanim-bildir` (`license:manage`) → `POST /v1/donanim`; zayıf tanımada 409 `ZAYIF_TANIMA_ONAY_BEKLIYOR`, onaydan sonra `parmakIziKurali: zayif`.
- [ÇEKİRDEK] `PARMAK_IZI_UYUSMAZ` v2 alıcıda kiranın kuralıyla; K6 reddi v1 eşiğiyle (`fingerprintMismatch`).
- [PROFİL] Kökün VDS dışı şifreli yedeği Google Drive; kök VDS'ten "uygula" cümlesiyle kaldırılır (A düzeni).
- [ÇEKİRDEK] `kurulumKayitlari` `kurulum_kaydi`na idempotent; destek (`POST /v1/destek`, ≤2 MB, ek ≤1 MB) `/portal/api/destek*` (`destek:yanitla`).
- [ÇEKİRDEK] Kira zinciri kararı SAF `services/lease-chain.ts`: NORMAL · AYNI · YAKALA · ÇATAL; sahip asla reddedilmez.
- [ÇEKİRDEK] Parmak izi kümesi yalnız `canLearnFingerprint` ile kayar; çatalda öğrenilmez; `donanim_talebi` onayı `kurulum:yonet` + sebep + atomik claim.
- [ÇEKİRDEK] Modül kasası (`modul_anahtari`) `modul-kasasi.key` ile sarılı; satır silinmez, `aktif=false`; giriş `scripts/modul-anahtari.ts uret` → `ice-aktar`.
- [ÇEKİRDEK] Giden kutusunun TEK yazarı `enqueueNotificationTx(tx, …)`; tekillik `(tekillikAnahtari, kanal)`; gönderici claim'i `updateMany WHERE {id, durum, deneme}`; kanal sırları dosyadan.
- [ÇEKİRDEK] Güvenlik olayı yalnız `securityEvent(sınıf, kod)` → `GUVENLIK_OLAYI`/`GUVENLIK_OZETI`; yalnız güvenlik hedeflerine (`GUVENLIK_TELEGRAM_CHAT_ID` · `GUVENLIK_EPOSTA_ALICI`), işletme sohbetine ASLA; `lib/guvenlik-alarm.ts` patronla bayt-eşit.
- [ÇEKİRDEK] `dagitim_defteri` iptali ters kayıtla; `Referrer-Policy: no-referrer` + nonce CSP; 410 `BAGLANTI_GECERSIZ` / `GOVDE_BUDANDI`; kök yoksa "ölçülemedi".

## Satıcı portalı web (`satici/web`)

### Değişmezler

- [ÇEKİRDEK] `/portal` yalnız ERİŞİM'de, `/bayi` yalnız genel dinleyicide, API ile aynı kökenden; `/api` HTML'e düşmez.
- [ÇEKİRDEK] Bir kez gösterilen sır yalnız canlı yanıtta/bileşende; önbellek, depo, URL'ye yazma; TOTP kurulumu yöneticide, kurtarma kodu yok.
- [ÇEKİRDEK] Sunucudan kopyalanan her bilgi `mirrors.test.ts` ile ölçülür; arayüz yalnız gizler.
- [ÇEKİRDEK] Ekranlar yalnız rol iznine göre çizer; dinleyiciye özel izin/dal koyma.
- [ÇEKİRDEK] HAK formu planı `GET /haklar/:id/imza-plani`dan alır, `imzaci` beyan eder; 409 `details.imzaci` formu yeniler; uzun ufuk yalnız yönetici + lisans no; DEMO/TEST ≤45 g.
- [ÇEKİRDEK] "Kılavuz" (`/kilavuz`) sır göstermez; tören tarihini `GET /anahtarlar`dan türetir.
- [ÇEKİRDEK] Dalga aşamasını yalnız gerekçeli düğmeyle değiştir; `onay: true` yalnız onay kutusuyla (`IKINCI_ONAY_GEREKLI`); etkin hedefi arayüzde hesaplama.

## Native lisans çekirdeği (`Teks-Erp/native/lisans-cekirdek`)

### Değişmezler

- [ÇEKİRDEK] Native çekirdek TS'in AYNASI, TS tek kaynak ve kâhin: kural önce TS'te, Rust + vektör (`--vektor-yaz`) aynı commit'te; yeni `typ` önce protokol `TYP`ye.
- [ÇEKİRDEK] Sistem hesabı mührü (`sealSystemAccount` · `verifySystemAccountSeal`, ABI 3) anahtarı çekirdekte okur; TS = Rust bayt-eşit, vektör aynı commit'te.
- [ÇEKİRDEK] Üretimde native ZORUNLU (`__TEKSERP_NATIVE_REQUIRED__`): TS'e düşme, ortam yolu okuma; panic sızmaz, `CEKIRDEK_YOK`.
- [ÇEKİRDEK] Çapa ikiliye GÖMÜLÜ, tek kip (`derle:*:uretim` · `derle:*:hazirlik`); `capaKipi` uyuşmazsa `CAPA_UYUSMAZ`; dış çapa yalnız `test-anchor`; `.node` yoksa ÖLÇÜLMEDİ.
- [ÇEKİRDEK] Güncelleyici aynı çapayı (`tekserp-dogrulama`) aynı kipte taşır; kendini güncelleme kipi değiştirmez; yayın aracı `--guven-capasi` zorunlu.
- [ÇEKİRDEK] Parmak izi toplayıcı TS ve Rust'ta aynı ham değeri aynı yol tablosundan (`fingerprint-paths.ts` ↔ `paths.rs`) aynı öncelikle okur; CIM/WMI zaman aşımlı, Get-Disk en sonda.
- [ÇEKİRDEK] Parmak izi saatte bir ölçülür; önbellek `parmak-izi-onbellek.json` tuzlu HMAC, ≤24 sa, saat >10 dk geri → süresi dolmuş; kopyası durum kaydında.
- [ÇEKİRDEK] Rust doğrulama kodu TEK (`Teks-Erp/native/tekserp-dogrulama`); kopya yazma.
- [ÇEKİRDEK] Yayınlanmamış ABI değişiklikleri TEK numarada (`api::ABI` = `NATIVE_ABI`); vektörleri birleşimden sonra üret.

## Bütünlük · derleme künyesi · filigran (Faz 2e)

### Değişmezler

- [ÇEKİRDEK] Korumalı paket `butunluk.jws` (`typ: tekserp-butunluk`) + `butunluk-liste.txt` taşır; kapsam tek kaynak `lib/license/integrity-scope.ts`; listede olmayan imzalı kapsam girdisi FAZLA.
- [ÇEKİRDEK] Liste satıcı Mac'inde imzalanır (`build-korumali-imza.ts`), anahtar CI/pakete girmez; aile çapa kipine uymalı; `paket-hazirlik*` ÜRETİM HAK'ında GEÇERSİZ (`BUTUNLUK_HAZIRLIK_ANAHTARI`).
- [ÇEKİRDEK] Üretim PAKET anahtarı yalnız PAROLALI (`protocol/anahtar-sarma.ts`, `tekserp/paket`, argv/env ASLA, 0600, depoya yazma); `pkt-<yıl>-<n>` çapaya girmez; <30 g sertifikayla imza atma.
- [ÇEKİRDEK] Zincirli işaretçiyi (`surum-zincir-<kid>.json` / `pg-zincir-<kid>.json`) eskisinin YANINA koy, üstüne yazma; seçim `selectChainedDocument` ↔ `select_chained`, belirsizlik FAIL-CLOSED.
- [ÇEKİRDEK] Bütünlük uyuşmazlığı LİSANS GİBİ: 30 g EK_SURE → KISITLI; `butunlukIlk` + `butunlukPaketId` yalnız yeni paketId sıfırlar; liste yok = GEÇERSİZ.
- [ÇEKİRDEK] Yeni HAK kabulünde bütünlük kararı yeni sınıfla hemen verilir; eski sınıf kararı yanıta/banda girmez.
- [ÇEKİRDEK] Korumalı kipte `execArgv`/`NODE_OPTIONS`teki `--require/-r/--import/--loader/--experimental-loader/--inspect*` → `BUTUNLUK_YUKLEYICI`; health yalnız bayrak adı.
- [ÇEKİRDEK] `.node` dlopen ÖNCESİ PAKET çapasıyla TS'te denetlenir; ikinci katman imzayı yeniden doğrular (`BUTUNLUK_IMZA`); doğrulama yalnız `getLicenseCore()`; test kancaları zorunlu kipte yok sayılır.
- [ÇEKİRDEK] Yükleyici listeyi `INTEGRITY_TOKEN_FILES` sırasıyla okur, zincirliyi `ROOT_PUBLIC_KEYS` ile doğrular; Docker imajı `imaj-imzala.mjs` ile imzalanır.
- [ÇEKİRDEK] Linux imajını yalnız `korumali-paket.yml` `docker-linux-x64` main koşusu tabanına imzala (`--ci-kosu`); künye tutmazsa parola sormadan RED; iş `contents: read`.
- [ÇEKİRDEK] Okunamayan imzalı dosya değişmiş sayılır (`BUTUNLUK_OKUNAMAYAN`).
- [ÇEKİRDEK] Derleme tarihi yalnız imzalı künyeden (`DERLEME_TARIHI_YOK`); `__TEKSERP_FILIGRAN__` uyuşmazsa `BUTUNLUK_FILIGRAN`; PDF meta lisans sahibi + no.
- [ÇEKİRDEK] Lisans ekranı bütünlüğü `/api/license/detay` `butunluk`tan (`license:view`) gösterir; dosya adı taşımaz.

## Modül şifreleme (Faz 2d)

### Değişmezler

- [ÇEKİRDEK] Modül anahtarını YALNIZ doğrulanmış kiradan, çekirdekte aç (sonuç ANAHTAR, boolean değil); üretimde TS açıcı yok.
- [ÇEKİRDEK] Satıcı modül anahtarını yalnız HAK'taki, dondurulmamış, X25519'u bilinen kuruluma sarar; X25519 yalnız temiz zincirde kaydedilir.
- [ÇEKİRDEK] Üç sır (TOTP · kod sırrı · kasa) YALNIZ OKUNUR, eksikse dur; tek üretici `anahtar.ts sirlar-uret`, ezmez; konteyner yalnız `/dosyalar`a yazar.
- [ÇEKİRDEK] Çözülen modülü BELLEKTE derle, diske yazma; anahtar yoksa 403 `LICENSE_MODULE` (`neden: ANAHTAR_YOK`).
- [ÇEKİRDEK] Yalnız sınırı temiz modülü şifrele (`sifreli-moduller.json`, `depo-multi`); sızıntıda derleme DÜŞER; `build-korumali.mjs --sifrele`.
- [ÇEKİRDEK] Şifreli paket yalnız `paketle.ps1 -Korumali -Sifrele`; CI'da ve repo içi anahtarla DURUR.
- [ÇEKİRDEK] Modül anahtarı önbelleği yalnız HIZ katmanı, kira kimliğine bağlı (DPAPI / 0600).
- [ÇEKİRDEK] KATI gövdeye yeni alan (`sifrelemeAnahtari`) eski satıcıda 400: satıcıyı ÖNCE yayınla.

## İstemciler (panel · tablet · satıcının /q sayfası)

### Değişmezler

- [ÇEKİRDEK] K5 sinyali tek boolean `login-methods.lisansDurduruldu`; K5'te panel kabuğu bağlamaz (`AppShell`), yalnız "verilerimi al"; tablet sinyali taze okur.
- [ÇEKİRDEK] Lisans reddi (403 `LICENSE_*`) tablet kuyruğunu SİLMEZ; toast'lar `showScreenError`den.
- [ÇEKİRDEK] Çevrimdışı QR çok parçalı (`TKLQ1|i/n|kimlik|özet|veri`); tek kaynak `qr-parca.ts`, istemciler bayt-eşit ayna.
- [ÇEKİRDEK] Panel aktarması yalnız `LICENSE_VENDOR_HOSTS`a; kod POST gövdesinde; `details.modul` DB anahtarı.
- [ÇEKİRDEK] Kurulum kaydı `kurulum-gecmisi.jsonl` (`app\` dışı); yoklama son 10'u opsiyonel `kurulumKayitlari`yla; `yeniMigrationSayisi` gerçek uygulanan; satıcı ÖNCE dağıtılır.
- [ÇEKİRDEK] `currentVersion` imzalı kiradan (`kanal.guncelSurumler`); `minVersion` KODDA.
- [ÇEKİRDEK] Destek talebi `talepId` ile `POST /v1/destek`ten idempotent; ek ≤1 MB; `destek_olayi` DEFTER; kapalıya yanıt 409.
- [ÇEKİRDEK] Fabrika destek talebi `support:create` + clientToken, GİDEN KUTUSU (`GONDERILMEDI`); ekran görüntüsü ≤700 KB; `/api/destek` her kademede açık.
- [ÇEKİRDEK] Hata raporu varsayılan KAPALI, onay `PUT /api/hata-raporlari/onay`; içerik allowlist (mesaj/kullanıcı/iş verisi yok); `POST /v1/hata-raporu`; kuyruk TELEMETRİ.

## Geçersiz kılınan kurallar — bunlara UYMA

- adnansahin faz geçişi almaz (dondurulmuş); lisans yeni kurulumda gelir.
- F4 MAC değil sistem/anakart seri; MAC kullanılmaz.
- K2 dondurulmuş modül ek sürede de kapalı (ham değere düşmez).
- Makine bağı `installationId` değil `kurulumId` (`LICENSE_DIR`).
- `licenseGate`te kimlik önce gelir (eski "önce kimliğe bakmaz" geçersiz).
- Patron bulutu ayna reddi kısmen geçersiz (salt-okur özet + gelen kutusu).
- Portal yalnız tailnet DEĞİL; tünel kalktı, tek yol ERİŞİM, yalnız üretim satıcısında; bütün işlemler (kök parolası dahil) ERİŞİM açık-listesinde.
- Hazırlık satıcısı emekli; çapası, kanal türü, `ORTAM` kipi kodda kalır.
- Lisans v1 süreleri (≈60 g, ≥3/5, kök VDS'te) yerine v2: P'ye dek, ≥3 ∧ güçlü ≥2, kök çevrimdışı.
- Belirsizlikte tavan fail-open DEĞİL; son bilinen tavan.
- İkinci anahtar "son 24 sa başarılı kira alışverişi yok" (eski "son yoklama başarısız" değil).
- Ara imzacı · ALT · İNDİRME 120 g değil 395 g, tören yıllık.
- Kök USB/VDS'te değil; Google Drive şifreli yedek.
- `LISANS-KOD-KORUMA.md` §3–§4, §12 eski hâli Lisans v2 ile değişti.
- Parola sırası: dosya > Anahtar Zinciri > istem (yalnız TTY değil).

## Bekçiler — bu alana dokununca koş

Fabrika `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad>`; satıcı `cd satici/sunucu && npx tsx scripts/run-all-tests.ts`; ağır `node scripts/agir-is.mjs -- …`. Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## lisans`. Yeni bekçi bu listeye VE haritaya birlikte eklenir.

Backend: `test_lisans_protokol`, `test_saat_degistirmez`, `test_lisans_kabul_metni`, `test_lisans_kabul`, `test_guven_capasi_ekle`, `test_lisans_paket_anahtari`, `test_thinkpad_kokeni`, `test_guven_capasi_kipi` (satıcı), `test_gecici_kod_uretimi` (satıcı), `test_gecici_acilis_kodu`, `test_lisans_satici_adresi`, `test_lisans_durumu`, `test_lisans_protokol_aynasi`, `test_guncelleme_protokol`, `test_paket_zinciri`, `test_zincir_secimi`, `test_guncelleme_durumu`, `test_guncelleme_onay`, `test_sunucu_kesintisi`, `test_dogrulama_kipi`, `test_lisans_native_kahin`, `test_lisans_butunluk`, `test_lisans_modul_sifreleme`, `test_lisans_motoru`, `test_lisans_yoklama_allowlist`, `test_client_policy_kira`, `test_destek_talebi`, `test_hata_raporu_fabrika`, `test_lisans_kapisi`, `test_etkinlestirme_kilidi`, `test_lisans_kip_alt_siniri`, `test_lisans_kilit_kacaklari`, `test_lisans_modul_tavani`, `test_indirme_kapisi`, `test_etkinlestirme`, `test_etkinlestirme_kabul`, `test_kod_tek_kullanim`, `test_nonce_tekrar`, `test_kira_zinciri`, `test_odenmis_tarih`, `test_teslim_bagi`, `test_paket_iptal_belgesi`, `test_paket_sertifika_uret` (satıcı), `test_backend_yayin_gorunumu` (satıcı), `test_acik_sertifikalar` (satıcı), `test_lisans_parmak_izi`, `test_genislik_kapisi`, `test_imza_yetenek_kaynagi`, `test_donanim_bildirimi`, `test_tasima_dr`, `test_tasima_sel`, `test_modul_anahtari`, `test_sunucu_sirlari`, `test_kok_parola_argv`, `test_zil_sse`, `test_yaptirim_kira`, `test_guncelleme_politikasi`, `test_guncelleme_dalgasi` (satıcı), `test_acik_moduller`, `test_imzali_saat_sapmasi`, `test_planli_eylem_taksit`, `test_satici_kapilari`, `test_tunel_yok`, `test_portal_uclar`, `test_destek_kurulum_kaydi`, `test_hata_raporu` (satıcı), `test_portal_totp`, `test_portal_rol_dinleyici`, `test_portal_yaptirim`, `test_demo_bitis`, `test_guncelleme_grubu`, `test_portal_bayi_tavani`, `test_portal_taksit_planli`, `test_portal_web_statik`, `test_erisim_kapisi`, `test_denetim_budama`, `test_genel_dinleyici`, `test_imza_parolasi`, `test_bayi_sahipligi`, `test_ic_api`, `test_bulut_kira_alanlari`, `test_lisans_qr_parca_aynasi`, `test_lisans_k5_giris`, `test_lisans_adi`, `test_indirme_grup`, `test_indirme_belirteci_ucu`, `test_qr_sayfasi`, `test_dagitim_baglanti`, `test_dagitim_yukleme`, `test_dagitim_icerik`, `test_yedek_dongusu`, `test_dagitim_budama`, `test_yayin_bildirimi`, `test_uretim_toren`, `test_ara_imzaci`, `test_kok_kuyrugu_sade`, `test_muafiyet_belgesi` (satıcı), `test_iptal_belgesi`, `test_compose_yalitimi`, `test_bildirim_giden_kutusu`, `test_bildirim_tarama`, `test_bildirim_gonderici`, `test_bildirim_rolu`, `test_guvenlik_bildirimi` (satıcı + patron)

Native (`cd Teks-Erp/native && npm run denetle && npm test`, iki kip): `lisans-cekirdek/tests/vektorler.rs`, `lisans-cekirdek/tests/toplama.rs`, `tekserp-guncelleyici/tests/capa_kipi.rs`; derleme `npm run derle` + `derle:uretim` + `derle:hazirlik`.

Satıcı web (`cd satici/web && npx vitest run`): `mirrors.test.ts`, `sanction.test.tsx`, `once-secret.test.tsx`, `login.test.tsx`, `app-isolation.test.ts`, `distribution.test.tsx`, `cloud-settings.test.tsx`, `erisim-imza.test.tsx`, `erisim-kullanici.test.tsx`, `erisim-anahtar.test.tsx`, `notifications.test.tsx`, `acceptance.test.tsx`, `paid-through.test.tsx`, `root-queue.test.tsx`, `hardware-requests.test.tsx`, `signing-plan.test.tsx`, `demo-validity.test.tsx`, `revocations.test.tsx`, `error-reports.test.tsx`, `exemption.test.tsx`, `temp-code.test.tsx`, `temp-code-bayi.test.tsx`

PAKET zinciri provası (elle): `node scripts/agir-is.mjs -- node deploy/satici/prova-paket-zinciri.mjs [--birak]` (`tekserp-guncelleyici/tests/paket_prova.rs`, `#[ignore]`). Parola kasası: `node scripts/test_parola_kasasi.mjs`. Devreye alma: `node scripts/test_lisans_devreye_kuru.mjs` · `node scripts/test_indir_sunucusu.mjs` (+ `--sonda`).

Panel (`cd Electron && npx vitest run <yol>`): `src/lib/download-token.test.ts`, `src/lib/license/acceptance.test.ts`, `src/pages/System/License/`: `LicenseAcceptanceCard.test.tsx`, `LicenseActivationGate.test.tsx`, `LicenseMachineCard.test.tsx`, `LicenseEntitlementCard.test.tsx`, `LicenseOfflineCard.test.tsx`, `src/pages/System/ServerUpdates/serverUpdates.test.tsx`

Tablet (`cd mobil && npx jest <yol>`): `src/services/downloadToken.service.test.ts`

Uçtan uca (bekçi değil): `cd Teks-Erp && npx tsx scripts/senaryo-ly.ts` — L1…L30 `docs/design/LISANS-SENARYO-L.md`.

## Arşiv notları (tam metin, gerekçe ve ölçüm)

Not başlık listesi `docs/kurallar/ayrinti/lisans.md` § Arşiv notları'nda.
