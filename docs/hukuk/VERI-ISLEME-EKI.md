# TeksERP Veri İşleme Eki

> **TASLAK — AVUKAT ONAYI BEKLİYOR.** Bu metin `SON-KULLANICI-LISANS-SOZLESMESI.md` (Lisans Sözleşmesi) ve `BAKIM-DESTEK-SOZLESMESI.md`'nin ekidir. Kullanıcının 2026-09-29 kararlarına göre Claude tarafından hazırlanmıştır; hukuki görüş değildir. Bölüm A'daki alan listesi yazılımın lisans protokolünden birebir alınmıştır. `[DOLDURULACAK]` işaretli süre ve adlar ticari ya da eksik bilgidir.
>
> Metin kimliği: `VIE-2026.1-taslak` · Patron bulutu bu ekin kapsamında değildir; ayrı eki `PATRON-BULUTU-VERI-ISLEME-EKI.md`dir (Bölüm P).

> **Türk hukuku: FSEK, TBK, KVKK, TCK 244 açısından avukat şu maddelere özellikle baksın**
> - **KVKK md. 3 ve 5 — kişisel veri mi?** Bölüm A'daki yoklama alanları bir şirket sunucusunu tanımlar; gerçek kişiye ait değildir. Taslak bunları "kişisel veri değil" diye niteledi (A.1). Kurulum kimliği ve IP adresi, şahıs işletmesi olan bir müşteride gerçek kişiyle ilişkilendirilebilir mi? Öyleyse hukuki sebep olarak md. 5/2-c (sözleşmenin ifası) ve md. 5/2-f (meşru menfaat) yeterli mi?
> - **KVKK md. 9 — yurt dışına aktarım (2024 değişikliği):** Cloudflare (ABD) trafiği kenar sunucularında açar; Tailscale (ABD) meta veri alır. Standart sözleşme ve beş iş günü içinde Kurum'a bildirim gerekir mi? Kim bildirir: Lisans Veren mi, Lisans Alan mı?
> - **KVKK md. 10 — aydınlatma:** kabul kaydındaki ad-soyad (A.5) ve destek talepleri (A.4) için Lisans Veren'in kendi aydınlatma metni gerekir. Panelde gösterilen kabul metni (`KABUL-METNI.md`) bu yükümlülüğü karşılar mı?
> - **KVKK md. 12 — veri işleyen:** Bölüm B, Lisans Veren'in destek ve uzaktan erişimdeki veri işleyen sıfatını yazılı talimata bağladı. Müşterek sorumluluk ve ihlal bildirimi (72 saat) doğru kurulmuş mu?
> - **Silme, Yok Etme veya Anonim Hale Getirme Yönetmeliği:** Bölüm D'deki süreler ve periyodik imha aralığı (en çok 6 ay) uygun mu? Kayıt defterlerinin sözleşme süresi + 10 yıl saklanması (TBK md. 146, TTK md. 82) kişisel veri içeren kısımlar için ölçülü mü?
> - **TCK md. 136 ve 243:** Bölüm B'deki "sunucudan veri çıkarmama" kuralı ve istisnası (yazılı onay) yeterli mi?

---

## A. Lisans kanalı: yoklama ve lisans istekleri

### A.1. Nitelik ve roller

Lisans kanalı, Kurulum'un Lisans Veren sunucusuyla yaptığı imzalı iletişimdir: etkinleştirme, saatlik yoklama, kapı zili, çevrimdışı yenileme, taşıma, felaket kurtarma devralması, indirme izni. Bu kanal **iş verisi ve kişisel veri taşımaz**. Gönderilen alanlar aşağıda **tek tek** sayılmıştır. Yazılım bu listeyi sıkı bir şemayla uygular: listede olmayan bir alan gönderilemez, gönderilse de Lisans Veren sunucusu reddeder. Listeye alan eklemek bu ekin yeni bir sürümünü gerektirir.

Lisans kanalındaki bilgiler için Lisans Veren, lisans sözleşmesinin ifası amacıyla veri sorumlusudur. Bilgiler bir tüzel kişiye ait sunucuyu tanımlar [avukat: A.1'deki nitelendirme].

### A.2. Her istekte

| Alan | Ne | Örnek / sınır |
|---|---|---|
| `kurulumId` | Kurulum'un rastgele kimliği | UUID |
| `zaman` | İsteğin gönderildiği an | ISO tarih-saat |
| `nonce` | Tekrar oynatmayı önleyen rastgele değer | 22–64 karakter |
| `amac` | İsteğin türü | etkinlestir · yokla · zil · cevrimdisi · destek · esitle · tasima · dr-devral |
| `govdeOzeti` | Gövdenin SHA-256 özeti | 43 karakter |
| imza | Kurulum anahtarıyla imza | Ed25519 |

### A.3. Etkinleştirme ve saatlik yoklama gövdesi

| Alan | Ne | Kişisel / iş verisi? |
|---|---|---|
| `v` | Protokol sürümü | Hayır |
| `kod` (yalnız etkinleştirmede) | Tek kullanımlık etkinleştirme kodu | Hayır |
| `acikAnahtar` (yalnız etkinleştirme ve taşımada) | Kurulum anahtarının açık yarısı | Hayır |
| `sonKiraId` | Bir önceki Kullanım Onayı'nın kimliği (onay zinciri) | Hayır |
| `hak.hakId`, `hak.surum` | Kurulum'daki Lisans Belgesi'nin kimliği ve sürümü | Hayır |
| `parmakIzi.f1`…`f5` | Beş makine değerinin **Kurulum'a özel anahtarla tek yönlü özeti**: işletim sistemi makine kimliği, donanım (SMBIOS) kimliği, sistem diski kimliği, sistem/anakart seri numarası, veritabanı küme kimliği. Ölçülemeyen değer boş gider. **Ham değer gönderilmez. MAC adresi ve işlemci kimliği kullanılmaz.** | Hayır |
| `durum.gecerlilik` | GECERLI · GECERSIZ · OLCULEMEDI | Hayır |
| `durum.nedenler` | Durumu açıklayan sabit kodlar (ör. `SAAT_GERI`) | Hayır |
| `durum.kip` | gözlem · zorla | Hayır |
| `durum.hesaplananKademe`, `durum.uygulananKademe` | NORMAL · UYARI · EK_SURE · KISITLI · DURDURULMUS | Hayır |
| `saat.duvar`, `saat.guvenilir` | Sunucunun saati ve yazılımın güvendiği saat | Hayır |
| `saat.bulgu` | Saat ileri ya da geri alınmış görünüyorsa kodu | Hayır |
| `ortam.platform`, `ortam.mimari` | win32 · linux · darwin; x64 · arm64 | Hayır |
| `ortam.isletimSistemi` | İşletim sistemi adı ve sürümü (en çok 120 karakter; bilgisayar adı içermez) | Hayır |
| `ortam.nodeSurum`, `ortam.uygulamaSurum`, `ortam.derlemeTarihi` | Çalışma zamanı ve TeksERP sürümü, derleme tarihi | Hayır |
| `ortam.konteyner` | Konteynerde mi çalışıyor | Hayır |
| `gozlem.reddedilecekIstek`, `gozlem.reddedilecekModul` | Gözlem kipinde, zorlama açık olsaydı reddedilecek istek ve modül **sayısı** | Hayır |

**Sağlık özeti (`saglik`)** yalnız yoklamada gönderilir. Yalnız sayılardan ve kapalı kümelerden oluşur; serbest metin alanı yoktur:

| Alan | Ne |
|---|---|
| `saglik.surum` | Sunucu sürümü |
| `saglik.calismaSn` | Son açılıştan beri geçen süre (saniye) |
| `saglik.dbBoyutBayt` | Veritabanı boyutu |
| `saglik.yedek.hukum`, `saglik.yedek.yasSaat` | Yedek durumu (iyi · uyarı · kritik · yapılandırılmamış) ve son yedeğin yaşı (saat) |
| `saglik.offsite.yapilandirildi`, `.ok`, `.eksikSayisi` | Uzak yedek kurulu mu, son aktarım başarılı mı, kaç dosya eksik |
| `saglik.diskDolulukYuzde` | Disk doluluk yüzdesi |
| `saglik.auditYazmaHatasi`, `saglik.havuzZamanAsimi` | İki hata **sayacı** |
| `saglik.istemciler[]` | Bağlanan istemcilerin türü (panel · tablet · web · diğer), sürümü ve **adedi**. Cihaz kimliği ya da kullanıcı gönderilmez |
| `saglik.isHatalari[]` | Arka plan işlerinin kısa kodu ve hata **sayısı**. Hata metni gönderilmez |

**Taşıma ve felaket kurtarma isteklerinde ek alanlar:** `anaKurulumId` (devralınan ana Kurulum) ve `gerekce`. Gerekçe en çok 500 karakterlik serbest metindir ve Lisans Alan yetkilisi yazar. Panel, bu alana kişisel veri yazılmaması uyarısını gösterir.

**Kapı zili:** yalnız A.2'deki imzalı başlık gider. Lisans Veren'den gelen zil içerik taşımaz; yalnız "şimdi yokla" der.

**Çevrimdışı yenileme:** A.3'teki istek, panel bilgisayarı ya da telefon (QR) aracılığıyla taşınır. Telefonla açılan sayfada isteğin kendisi adres çubuğunun `#` sonrasındaki kısmında durur ve sunucu günlüklerine yazılmaz.

### A.4. Destek talebi (kullanıcı başlatır)

Panelden açılan destek talebi, A.3'teki sağlık özetine ek olarak kullanıcının yazdığı açıklamayı ve isteğe bağlı olarak **ekran görüntüsünü** taşır. Ekran görüntüsünde iş verisi ve kişisel veri bulunabilir. Bu yüzden talep gönderilmeden önce kullanıcıya gösterilir; kullanıcı görüntüyü çıkarabilir. Destek talebinde Lisans Veren, Bölüm B'deki veri işleyen yükümlülükleriyle hareket eder.

### A.5. Kabul kaydı

İlk kurulumdaki kabul adımında (`KABUL-METNI.md`) kabul eden yöneticinin **adı-soyadı, unvanı ve kullanıcı kimliği**, kabul zamanı ve kabul edilen metinlerin sürümü Lisans Veren'e gönderilir. Bu bilgi kişisel veridir. Lisans Veren bunu sözleşmenin kurulduğunu ispat etmek için veri sorumlusu olarak işler (KVKK md. 5/2-c ve 5/2-e) [avukat].

### A.6. Ağ düzeyinde görülenler

Lisans ve güncelleme trafiği Cloudflare üzerinden geçer. Cloudflare ve Lisans Veren sunucusu isteğin geldiği IP adresini ve zamanını görür ve kısa süre saklar (Bölüm D). Güncellemeyi indiren panel ve tabletlerin IP adresleri ve uygulama bilgisi de aynı biçimde görülür.

### A.7. Gönderilmeyenler

Hiçbir lisans isteği şunları içermez: üretim, stok, sipariş, sevkiyat, cari, fiyat ve finans kayıtları; kullanıcı adları ve parolaları, PIN'ler, kart numaraları; personel bilgileri; dosya adları ve dosya içerikleri; hata mesajlarının metni; bilgisayar adı ve ağ yapısı; ham donanım seri numaraları.

## B. Destek ve uzaktan erişimde veri işleyen

B.1. Lisans Veren, destek talebi, uzaktan erişim ve güncelleme sırasında Lisans Alan'ın kişisel verilerine erişebilir: personel ve kullanıcı adları, müşteri ve tedarikçi iletişim bilgileri, finans kayıtları. Bu erişimde **Lisans Alan veri sorumlusu, Lisans Veren veri işleyendir**.

B.2. Lisans Veren bu verileri:
- (a) yalnız Lisans Alan'ın talimatıyla ve yalnız destek ya da bakım amacıyla işler;
- (b) sunucudan dışarı çıkarmaz. İstisnası `BAKIM-DESTEK-SOZLESMESI.md` §6'da yazılıdır: yazılı onay, asgari veri, anonimleştirme, iş bitince silme;
- (c) yalnız bu işle görevli, gizlilik yükümlülüğü altındaki çalışanlarına gösterir;
- (d) Bölüm C'deki alt işleyenler dışında kimseyle paylaşmaz;
- (e) her uzaktan erişimi kayda geçirir (`BAKIM-DESTEK-SOZLESMESI.md` §6).

B.3. **Yedek anahtarları.** Lisans Veren'in kasasında tutulan yedek parolası ve Lisans Veren yedek anahtarı, Lisans Alan'ın bütün geçmiş yedeklerini açabilir. Bunlar yalnız `BAKIM-DESTEK-SOZLESMESI.md` §7'deki hallerde kullanılır ve her kullanım Lisans Alan'a bildirilir.

B.4. **İhlal bildirimi.** Lisans Veren, Lisans Alan verisini etkileyen bir güvenlik ihlalini öğrendiğinde Lisans Alan'a gecikmeden, en geç [DOLDURULACAK — öneri: 24 saat] içinde bildirir. Kurul'a bildirim (72 saat) veri sorumlusu olan Lisans Alan'ındır; Lisans Veren bunun için gereken bilgiyi verir. Adımlar ve içerik: `VERI-IHLALI-BILDIRIM-PROSEDURU.md`.

B.5. **İlgili kişi başvuruları.** Lisans Veren'e gelen bir ilgili kişi başvurusu Lisans Alan'a yönlendirilir. Lisans Veren, Lisans Alan'ın cevap vermesi için gereken teknik desteği verir.

B.6. **Denetim.** Lisans Alan, bu bölüme uyumu makul bir önceden bildirimle, yılda bir kez [DOLDURULACAK] denetleyebilir ya da belge isteyebilir.

## C. Barındırma ve alt işleyenler

| Alt işleyen | Ne için | Nerede | Not |
|---|---|---|---|
| [DOLDURULACAK — VDS sağlayıcısının ünvanı] | Lisans sunucusu, Lisans Portalı, güncelleme dosyaları, (varsa) uzak yedek | **Türkiye** | Sunucu Lisans Veren'in yönetimindedir |
| Cloudflare, Inc. | Lisans ve güncelleme trafiği için ters vekil, önbellek ve saldırı koruması | ABD merkezli; kenar sunucuları dünya geneli | Şifreli bağlantı Cloudflare'de açılır ve yeniden şifrelenir [avukat: KVKK md. 9] |
| Tailscale Inc. | Uzaktan erişim ağının koordinasyonu | ABD | Trafik uçtan uca şifrelidir; Tailscale yalnız cihaz adı, IP ve bağlantı meta verisini görür [avukat: KVKK md. 9] |
| [DOLDURULACAK — uzak yedek hedefi Lisans Veren hesabındaysa bulut depolama sağlayıcısı] | Uzak yedek | [DOLDURULACAK] | Yalnız şifreli yedek dosyası gider |

Lisans Veren yeni bir alt işleyen eklemeden en az [DOLDURULACAK — öneri: 30 gün] önce Lisans Alan'a bildirir. Lisans Alan haklı sebeple itiraz edebilir.

## D. Saklama süreleri

| Kayıt | Süre | Sonra |
|---|---|---|
| Tekrar oynatma kaydı (`nonce`) | İsteğin zamanından 10 dakika sonra | Silinir |
| Yoklama kayıtları ve sağlık özetleri | [DOLDURULACAK — öneri: 13 ay] | Silinir; yalnız kimliksiz toplam istatistik kalabilir |
| Verilen Kullanım Onayları | 13 ay | Silinir |
| Lisans Belgesi sürümleri, yaptırım defteri, taşıma ve felaket kurtarma kayıtları, kurulum geçmişi, kabul kayıtları | Sözleşme süresi + 10 yıl [avukat] | Silinir ya da anonimleştirilir |
| Destek talebi metni | Kapanıştan [DOLDURULACAK — öneri: 2 yıl] | Silinir |
| Destek ekran görüntüleri ve iki yönlü dosya paylaşımındaki dosyalar | [DOLDURULACAK — öneri: talep kapanışından ya da bağlantının bitişinden 30 gün] | Silinir |
| Uzaktan erişim kayıtları | [DOLDURULACAK — öneri: 2 yıl] | Silinir |
| Sunucu ve Cloudflare erişim günlükleri (IP) | [DOLDURULACAK — öneri: 30 gün]; Cloudflare kendi süresini uygular | Silinir |
| Lisans Veren'de tutulan uzak yedekler (varsa) | Lisans Alan'ın belirlediği döngü; sözleşme bitiminden [DOLDURULACAK — öneri: 30 gün] sonra | İmha edilir, tutanak verilir |

Periyodik imha [DOLDURULACAK — öneri: 6 ayda bir] yapılır ve kayda geçer [avukat: Yönetmelik].

## E. Güvenlik önlemleri

- Lisans kanalındaki her istek Kurulum anahtarıyla, her yanıt Lisans Veren anahtarıyla imzalıdır (Ed25519). Bağlantı TLS ile şifrelidir.
- Lisans Veren'in kök imza anahtarı parolayla şifreli durur. Parola yalnız imza anında girilir; diske ve günlüğe yazılmaz.
- Lisans Portalı'na Lisans Veren çalışanları yalnız Lisans Veren'in özel ağından girer. Bayi hesapları kendi bölümlerine internetten girer. İki yolda da parola ve iki aşamalı doğrulama (TOTP) gerekir.
- Lisans Portalı'ndaki her işlem silinemeyen bir deftere yazılır.
- Yedekler şifrelenebilir; şifre çözme anahtarlarının kimde durduğu `BAKIM-DESTEK-SOZLESMESI.md` §7'dedir.
- Lisans Veren'in müşteri sistemlerine erişen çalışanları gizlilik taahhüdü altındadır [DOLDURULACAK].

---

## P. Patron bulutu

Patron bulutu bu ekin kapsamında DEĞİLDİR. Ayrı imzalanan `PATRON-BULUTU-VERI-ISLEME-EKI.md` (`PBVIE-2026.1`) ve onun ekleri düzenler: `PATRON-BULUTU-SAKLAMA-IMHA.md` · `PATRON-BULUTU-TEDBIRLER.md` · `PATRON-BULUTU-AYDINLATMA-METNI.md` · `VERI-IHLALI-BILDIRIM-PROSEDURU.md`. Bu bölümde daha önce duran iskelet o belgeye taşındı ve tamamlandı.
