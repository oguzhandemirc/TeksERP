# TeksERP Patron Bulutu Veri İşleme Eki

> **TASLAK — AVUKAT ONAYI BEKLİYOR.** Bu metin, kullanıcının 2026-09-29 patron bulutu kararlarına ve eşitleme sözleşmesi v1 tasarımına göre Claude tarafından hazırlanmıştır; hukuki görüş değildir. Mevzuat atıfları incelemeye yön vermek içindir, doğruluğu ve güncelliği avukatça teyit edilmelidir. `[DOLDURULACAK]` işaretli yerler ticari karar ya da eksik bilgidir; "öneri" diye verilen değerler bağlayıcı değildir.
>
> Metin kimliği: `PBVIE-2026.1-taslak` · Bu ek, `VERI-ISLEME-EKI.md` Bölüm P iskeletinin yerini alır. Lisans sözleşmesi (`SON-KULLANICI-LISANS-SOZLESMESI.md`) ve bakım sözleşmesinden (`BAKIM-DESTEK-SOZLESMESI.md`) AYRI imzalanır; patron bulutu hizmeti satın alınmadıkça yürürlüğe girmez.
>
> Ekin ekleri: `PATRON-BULUTU-SAKLAMA-IMHA.md` (saklama ve imha) · `PATRON-BULUTU-TEDBIRLER.md` (teknik ve idari tedbirler) · `VERI-IHLALI-BILDIRIM-PROSEDURU.md` (ihlal bildirimi) · `PATRON-BULUTU-AYDINLATMA-METNI.md` (uygulamada gösterilecek aydınlatma metni).

> **KVKK ve ilgili mevzuat açısından avukat şu maddelere özellikle baksın**
> - **KVKK md. 3 — roller:** Taslak, bulut kopyasındaki bütün kişisel veriler için Lisans Alan'ı (fabrika) veri sorumlusu, Lisans Veren'i (Etkili Yazılım) veri işleyen saydı (§2). Bulut hesaplarının güvenlik kayıtları (giriş denemeleri, IP) için Lisans Veren'in kendi adına veri sorumlusu sayılması gerekir mi?
> - **KVKK md. 5 — hukuki sebep:** Cari yetkili adı ve telefonunun patronun uzaktan görmesi için işlenmesi md. 5/2-c (sözleşmenin ifası) mı, 5/2-f (meşru menfaat) mı? Açık rıza aranmasın diye kurulan dayanak yeterli mi (§4)?
> - **KVKK md. 9 — yurt dışına aktarım (7499 sayılı Kanunla değişik; 01.06.2024'ten itibaren):** Cloudflare kenar sunucusunda TLS'nin açılması ve bildirim altyapısının (Expo, Google FCM, Apple APNs) kullanımı "aktarım" sayılır mı? Sayılırsa standart sözleşme türü (işleyenden işleyene), Kurum'a beş iş günü içinde bildirim ve bildirimi kimin yapacağı (§6).
> - **Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik (2024):** Cloudflare'in kendi veri işleme sözleşmesi, Kurul'un ilan ettiği standart sözleşme metnini değiştirmeden imzalanabilir mi? İmzalanamıyorsa §6.4'teki seçenekler.
> - **KVKK md. 12 — veri işleyen yükümlülükleri:** Talimat, gizlilik, alt işleyen onayı ve denetim hükümleri (§7) md. 12/2'deki müşterek sorumluluğu yeterince düzenliyor mu?
> - **KVKK md. 6 — özel nitelikli veri:** Projeksiyonlarda özel nitelikli veri yok; serbest metin alanlarında bulunmaması için yalnız uyarı ve talimat öngörüldü (§3.3). Yeterli mi?
> - **VERBİS:** Buluttaki işleme ve alt işleyenler Lisans Alan'ın veri envanterine ve (kayıt yükümlüsüyse) VERBİS kaydına eklenmeli mi?

---

## 1. Konu ve tanımlar

1.1. **Patron Bulutu**, Lisans Alan'ın TeksERP Kurulumu'ndaki verinin **seçilmiş bir okuma kopyasının** belirli aralıklarla Lisans Veren'in bulut sunucusuna eşitlendiği ve "TeksERP Patron" uygulaması (iOS, Android, web) ile gösterildiği hizmettir.

1.2. Bu ekte:

| Terim | Anlamı |
|---|---|
| **Bulut Kopyası** | Kurulum'dan eşitlenen, yalnız okunabilen veri. Kurulum'daki asıl kayıtların yerine geçmez |
| **Bulut Hesabı** | Patron uygulamasına giriş için bulutta açılan, fabrika kullanıcısından bağımsız hesap |
| **Tesis Yöneticisi** | Lisans Alan'ın, bulut hesaplarını açan, kilitleyen ve izin atayan yetkilisi |
| **Gelen Kutusu** | Bulut hesabından girilen sipariş ve cari kayıtlarının, Kurulum tarafından çekilip işlenene kadar beklediği yer |
| **Projeksiyon** | Buluta giden veri kümesi. Hangi alanların gideceği bir katalogla tek tek belirlenir; katalogda olmayan alan gitmez |

1.3. **Fabrika tek yazardır.** Bulut hesap yapmaz ve Kurulum'daki hiçbir kaydı değiştirmez. Gelen Kutusu'ndaki kayıt yalnız bir taleptir; Kurulum onu kendi kurallarıyla işler ya da reddeder.

1.4. **Açılış şartları.** Hizmet varsayılan olarak kapalıdır. Yalnız şu dördü birden sağlanınca veri gönderilir: Lisans Belgesi'nin sınıfı **Üretim**; Lisans Belgesi'nde `patron-bulut` hakkı; hizmet süresinin bitmemiş olması; Kurulum'un bir felaket kurtarma sunucusuna devredilmemiş olması. Test, demo ve felaket kurtarma sınıfındaki kurulumlar veri göndermez (`SON-KULLANICI-LISANS-SOZLESMESI.md` §10.1). Şartlardan biri belirsizse veri gitmez.

## 2. Roller

2.1. **Lisans Alan veri sorumlusudur.** Bulut Kopyası'ndaki verinin hangi amaçla işleneceğini, hangi Bulut Hesabı'nın hangi veriyi göreceğini ve saklama süresini Lisans Alan belirler.

2.2. **Lisans Veren veri işleyendir.** Bulut Kopyası'nı ve Bulut Hesapları'nı Lisans Alan adına, bu ekteki talimatlarla barındırır ve işler (KVKK md. 3/1-ğ ve md. 12/2).

2.3. **Talimatın kaynağı.** Lisans Alan'ın talimatları şunlardır: bu ek; Lisans Veren portalındaki kurulum ayarları (eşitleme aralığı, saklama süresi, hizmetin açık ya da kapalı olması); Tesis Yöneticisi'nin hesap ve izin işlemleri; Lisans Alan'ın yazılı bildirimleri. Lisans Veren, bir talimatın mevzuata aykırı olduğunu düşünürse Lisans Alan'a gecikmeden bildirir [avukat].

2.4. Lisans Veren, Bulut Kopyası'nı kendi amaçları için işlemez: analiz, pazarlama, ürün geliştirme ya da üçüncü kişiye satış yapmaz. İstisnası, hizmetin işletilmesi için gereken kimliksiz toplam ölçümlerdir (satır sayısı, paket boyutu, eşitleme süresi); bunlar tek bir kayda ya da kişiye bağlanamaz.

## 3. İşlenen veri kategorileri

3.1. Buluta giden her alan, eşitleme sözleşmesinin projeksiyon kataloğunda tek tek yazılıdır ve bir **veri sınıfı** taşır: İŞLEM, FİNANS ya da KİŞİSEL (teknik kaynak: `docs/design/PATRON-BULUTU-ESITLEME.md` §3 ve §11). Aşağıdaki tablo o sınıflardan üretilmiştir. Kataloğa yeni bir KİŞİSEL alan eklemek bu ekin yeni bir sürümünü gerektirir.

3.2. **Bulut Kopyası (Kurulum'dan gelen veri)**

| Kategori | Alanlar (özet) | Veri sınıfı | İlgili kişi |
|---|---|---|---|
| Cari kimlik | Cari ünvanı ve kodu, müşteri/tedarikçi/fason rolü, il, ilçe, ülke, şube adları. **Şahıs işletmesinde ünvan gerçek kişinin adıdır.** | İŞLEM | Müşteri, tedarikçi ve fason firmalarının sahipleri |
| Cari iletişim | Cari yetkili kişinin adı ve telefonu | KİŞİSEL | Cari yetkilileri |
| Çek ve senet | Keşidecinin adı; çek/senet numarası, banka, vade | KİŞİSEL + FİNANS | Keşideciler |
| Finans | Cari bakiye ve hareketleri, vade ve risk limiti, kasa ve banka bakiyeleri ve hareketleri, fatura ve kalemleri, tahsilat ve ödemeler, fiyatlar | FİNANS | Cariler (şahıs işletmesinde gerçek kişi) |
| Sipariş ve sevkiyat | Sipariş ve kalemleri, sevkiyat, çuval ve ambalaj özetleri, teslim yönü | İŞLEM (tutarlar FİNANS) | Cariler |
| Üretim ve stok | İş emri özetleri, üretim akışı, stok karnesi, ürün ve renk adları | İŞLEM | — (kişi adı içermez) |
| Serbest metin | Açıklama, referans, dış fatura numarası, müşterinin ürün/renk adı | İŞLEM | **Kişisel veri içerebilir** (§3.4) |
| Raporlar | Rapor kataloğundaki raporların sonuçları (denetim raporu hariç) | Raporun ailesine göre | Cariler |

3.3. **Bulutta doğan veri**

| Kategori | Alanlar | İlgili kişi |
|---|---|---|
| Bulut Hesabı | Ad, e-posta, parola özeti, iki aşamalı doğrulama (TOTP) sırrı, izinler, hesap durumu, son giriş zamanı | Patron ve Lisans Alan'ın bulut ekibi |
| Hesap güvenlik kaydı | Giriş denemeleri, IP adresi, zaman, hesap ve izin değişiklikleri | Aynı |
| Bildirim | Bildirim tercihleri, sessiz saatler, eşikler, cihaz bildirim anahtarları | Aynı |
| Gelen Kutusu | Bulut Hesabı'nın girdiği sipariş ve cari talebi (cari talebinde vergi numarası, vergi dairesi, adres, yetkili, telefon, e-posta **olabilir**), girenin kimliği, işlem sonucu | Cariler ve talebi giren hesap sahibi |
| Uygulama önbelleği | Son görülen verinin cihazda salt-okunur kopyası | Aynı kategoriler |

3.4. **Serbest metin.** Açıklama gibi serbest alanlara kişisel veri, özellikle **özel nitelikli kişisel veri** (KVKK md. 6: sağlık, din, sendika üyeliği, ceza mahkûmiyeti vb.) yazılmamalıdır. Lisans Alan bunu kendi kullanıcılarına talimat olarak verir. Kurulum'daki `notlar` alanlarının hiçbiri buluta gitmez.

3.5. **Buluta gitmeyenler.** Denetim (audit) kayıtları; fabrika kullanıcılarının adları, kimlikleri, parolaları, PIN'leri ve kartları; kullanıcı izinleri ve oturumları; sistem ayarları ve şifre özetleri; cari kartların vergi/TC kimlik numarası, adresi, e-postası ve notları; sevkiyatların plaka, sürücü ve taşıyıcı bilgisi; top düzeyi stok ve stok hareket defterleri; kişi adı taşıyan performans raporları [DOLDURULACAK — v1 kararı: operatör performans raporu bulutta sunulmaz]. Liste teknik olarak kataloğun "dışarıda" listesiyle ölçülür.

3.6. **Kurulum'a dönen veri.** Gelen Kutusu'ndan işlenen her kayıt için Kurulum, talebi giren Bulut Hesabı'nın **kimliğini ve adını** bir makbuz tablosunda saklar (kaydın nereden geldiğinin kanıtı). Bu bilgi Lisans Alan'ın kendi sistemindedir.

## 4. Amaç ve hukuki sebep

| Amaç | İlgili veri | Önerilen hukuki sebep (Lisans Alan belirler) |
|---|---|---|
| Lisans Alan yöneticilerinin fabrika verisini uzaktan izlemesi | §3.2'nin tamamı | KVKK md. 5/2-f (meşru menfaat) ve cari ilişkisi için md. 5/2-c (sözleşmenin ifası) [avukat] |
| Uzaktan sipariş ve cari talebi girilmesi | Gelen Kutusu | md. 5/2-c |
| Hesap güvenliği ve yetkisiz erişimin önlenmesi | Bulut Hesabı, güvenlik kaydı | md. 5/2-f; md. 12/1 güvenlik yükümlülüğü [avukat] |
| Bildirim gönderimi | Bildirim verisi | md. 5/2-c (hesap sahibinin açtığı hizmet) |
| Uyuşmazlıkta ispat | Gelen Kutusu sonucu, hesap güvenlik kaydı | md. 5/2-e (bir hakkın tesisi, kullanılması veya korunması) |

Açık rızaya dayanan bir işleme öngörülmemiştir. Bulut Kopyası, Lisans Alan'ın Kurulum'da zaten işlediği verinin bir kopyasıdır; yeni bir veri toplama değildir [avukat: amaç değişikliği var mı].

## 5. Saklama yeri ve barındırma

5.1. Bulut sunucusu, veritabanı ve yedekleri **Türkiye'deki** bir sanal sunucuda (VDS) tutulur: [DOLDURULACAK — VDS sağlayıcısının ünvanı ve veri merkezi şehri].

5.2. Bulut hizmeti, Lisans Veren'in lisans sunucusuyla aynı makinede ama **ayrı konteyner, ayrı ağ, ayrı veritabanı ve ayrı veritabanı rolüyle** çalışır; kaynak kullanımı sınırlandırılmıştır.

5.3. Saklama süreleri ve imha: `PATRON-BULUTU-SAKLAMA-IMHA.md`.

## 6. Alt işleyenler ve yurt dışına aktarım

6.1. **Alt işleyen listesi**

| Alt işleyen | Ne için | Nerede | Gördüğü veri |
|---|---|---|---|
| [DOLDURULACAK — VDS sağlayıcısı] | Sunucu, veritabanı, yedek | Türkiye | Şifreli diskte duran bütün Bulut Kopyası (sağlayıcının erişimi fiziksel/sanal altyapıyladır) |
| Cloudflare, Inc. | Ters vekil, önbellek, saldırı koruması (`patron.` alt alanı) | ABD merkezli; kenar sunucuları dünya geneli | Şifreli bağlantı kenar sunucusunda açılır ve yeniden şifrelenir: uygulama ile bulut arasındaki istek ve yanıtlar, IP adresi |
| Expo (650 Industries, Inc.) | Mobil bildirim iletimi | ABD | Cihaz bildirim anahtarı ve bildirim metni |
| Google LLC (Firebase Cloud Messaging) | Android bildirimi | ABD / dünya geneli | Aynı |
| Apple Inc. (APNs) | iOS bildirimi | ABD / dünya geneli | Aynı |
| [DOLDURULACAK — web bildirimi için tarayıcının bildirim hizmeti] | Web bildirimi | Tarayıcı üreticisine göre | Aynı |

6.2. **Bildirimde asgari veri.** Bildirim metni varsayılan olarak cari adı, tutar ve kişi adı içermez; yalnız olay türünü ve uygulamada açılacak ekranı söyler ("Yeni sipariş talebiniz işlendi", "Gece yedeği başarısız"). Ayrıntı, uygulama açılınca bulut sunucusundan okunur [DOLDURULACAK — ticari karar: ayrıntılı bildirim seçeneği sunulacak mı; sunulursa §6.3 bu içerik için de geçerlidir].

6.3. **Yurt dışına aktarım değerlendirmesi (KVKK md. 9).** 7499 sayılı Kanunla değişik md. 9 ve 2024 tarihli Yurt Dışına Aktarım Yönetmeliği, aktarımı sırasıyla şu dayanaklardan birine bağlar: (a) yeterlilik kararı; (b) uygun güvence — Kurul'un ilan ettiği **standart sözleşme**, bağlayıcı şirket kuralları ya da Kurul izniyle taahhütname; (c) arızi hâllerde sayılan istisnalar. Taslak şu varsayımla yazılmıştır [avukat: her biri teyit]:
- Cloudflare kenarında TLS'nin açılması ve bildirim hizmetleri kişisel verinin yurt dışındaki bir işleyene **aktarımı** sayılabilir. Bugün ABD için yeterlilik kararı bilinmemektedir.
- Uygun güvence olarak Lisans Veren (veri işleyen) ile her yurt dışı alt işleyen arasında **işleyenden işleyene standart sözleşme** imzalanır.
- Standart sözleşme, imzadan itibaren **beş iş günü** içinde Kişisel Verileri Koruma Kurumu'na bildirilir. Taslak, bildirimi sözleşmenin tarafı olan Lisans Veren'e yükledi; Lisans Alan'a bildirimin kopyası verilir.
- Arızi istisnalar (ör. sözleşmenin ifası için zorunluluk) düzenli ve süreklilik gösteren bu aktarımın dayanağı yapılmaz.

6.4. **Standart sözleşme imzalanamazsa.** Büyük sağlayıcılar kendi veri işleme sözleşmelerini kullanır ve Kurul metnini değiştirmeden imzalamayabilir. Bu durumda seçenekler, avukat ve Lisans Alan ile birlikte değerlendirilir [DOLDURULACAK]:
- (a) `patron.` alt alanında Cloudflare vekilini kapatıp trafiği doğrudan Türkiye'deki sunucuya almak (saldırı korumasından vazgeçilir; teknik değerlendirme gerekir);
- (b) bildirimleri içeriksiz "uyandırma" bildirimine indirmek ve yalnız cihaz anahtarının aktarımına dayanak aramak;
- (c) hizmeti, aktarımın hukuki dayanağı kurulana kadar bildirimsiz ve [DOLDURULACAK] biçimde sunmak.
Lisans Veren, dayanak kurulmadan yurt dışı alt işleyene kişisel veri akıtan bir özelliği açmaz.

6.5. **Yeni alt işleyen.** Lisans Veren yeni bir alt işleyen eklemeden en az [DOLDURULACAK — öneri: 30 gün] önce Lisans Alan'a bildirir. Lisans Alan haklı sebeple itiraz ederse taraflar çözüm arar; bulunamazsa Lisans Alan patron bulutu hizmetini cezasız feshedebilir [avukat]. Lisans Veren, alt işleyene bu ekteki yükümlülüklerden daha hafif olmayan yükümlülükler yükler (KVKK md. 12/2).

## 7. Lisans Veren'in veri işleyen yükümlülükleri

7.1. Lisans Veren Bulut Kopyası'nı:
- (a) yalnız bu ekteki amaçlarla ve Lisans Alan'ın talimatıyla işler (§2.3);
- (b) yalnız görevli, yazılı gizlilik yükümlülüğü altındaki çalışanlarına gösterir; destek için Bulut Kopyası'na erişim yalnız Lisans Alan'ın talebiyle olur ve kayda geçer (`PATRON-BULUTU-TEDBIRLER.md` §3);
- (c) Bulut Hesapları'nın içeriğine giriş yapmaz; bir hesabı yalnız Lisans Alan'ın talebiyle ya da güvenlik gereği **kilitleyebilir** ve bunu Lisans Alan'a bildirir;
- (d) `PATRON-BULUTU-TEDBIRLER.md`'deki tedbirleri uygular ve esaslı bir tedbiri zayıflatmadan önce Lisans Alan'a bildirir;
- (e) güvenlik ihlalini `VERI-IHLALI-BILDIRIM-PROSEDURU.md`'ye göre bildirir.

7.2. **İlgili kişi başvuruları (KVKK md. 11 ve 13).** Lisans Veren'e gelen başvuru, kimliği doğrulanmadan cevaplanmaz ve [DOLDURULACAK — öneri: 3 iş günü] içinde Lisans Alan'a iletilir. Başvuruyu cevaplamak (kanuni süre 30 gün) Lisans Alan'ındır; Lisans Veren gereken dökümü ve silme işlemini teknik olarak sağlar. Bulut Kopyası'ndaki bir kaydın düzeltilmesi ya da silinmesi **Kurulum'da** yapılır ve bir sonraki eşitlemeyle buluta yansır; bulutta tek başına düzeltme yapılmaz (fabrika tek yazardır).

7.3. **Denetim.** Lisans Alan, bu eke uyumu yılda bir kez, makul bir önceden bildirimle [DOLDURULACAK] belge isteyerek ya da bağımsız bir denetçiyle denetleyebilir. Denetim başka kiracıların verisine erişim vermez.

7.4. **Kurul incelemesi.** Kurul'un bir inceleme ya da bilgi talebinde taraflar birbirine gecikmeden bilgi verir.

## 8. Süre, hizmetin bitmesi, sorumluluk

8.1. Bu ek, patron bulutu hizmeti sürdükçe ve hizmetin bitiminden sonra imha tamamlanana kadar yürürlükte kalır.

8.2. Hizmet bitince eşitleme durur; dışa aktarma ve imha `PATRON-BULUTU-SAKLAMA-IMHA.md` §4'e göre yapılır. Lisans sözleşmesinin ya da bakım sözleşmesinin sona ermesi patron bulutu hizmetini de sona erdirir [DOLDURULACAK — ticari model: abonelik mi, bakıma dahil mi].

8.3. Taraflardan her biri, bu eke kendi aykırılığından doğan zarardan sorumludur. Kurul'un idari para cezası kararlarında iç ilişkide paylaşım [DOLDURULACAK — avukat]. Sorumluluk sınırı: [DOLDURULACAK — lisans sözleşmesi §11.3 ile aynı mı, ayrı mı].

8.4. Bu ek ile lisans ya da bakım sözleşmesi arasında kişisel verinin işlenmesine ilişkin çelişki olursa bu ek uygulanır.
