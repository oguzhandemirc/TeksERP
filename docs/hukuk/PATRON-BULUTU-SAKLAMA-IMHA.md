# Patron Bulutu Saklama ve İmha Prosedürü

> **TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu metin bir taslaktır; hukuki görüş değildir.
>
> Metin kimliği: `PBSI-2026.1-taslak` · Ek-6/A · Patron Bulutu Veri İşleme Eki'nin (Ek-6) ekidir.

> **Avukat şu maddelere özellikle baksın**
> - **Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik (2017):** Bu prosedür, Lisans Alan'ın kişisel veri saklama ve imha politikasına eklenecek bölüm olarak yeterli mi? Periyodik imha aralığı (Yönetmelik en çok 6 ay öngörür) burada günlük otomatik budamayla karşılanıyor; ayrıca 6 aylık gözden geçirme gerekir mi (§5)?
> - **İmha kayıtlarının saklanması:** Yönetmeliğin öngördüğü asgari süre (taslakta 3 yıl) doğru mu (§6)?
> - **Ticari saklama yükümlülükleri (TTK md. 82, VUK md. 253):** Bulut Kopyası asıl kayıt değildir; asıl kayıtlar Kurulum'da durur. Bu yüzden bulut kopyasının kısa saklanmasının ya da imhasının yasal saklama yükümlülüğünü etkilemediği varsayıldı. Doğru mu?
> - **TBK md. 146:** Gelen Kutusu sonuçlarının ve hesap güvenlik kayıtlarının delil için daha uzun saklanması gerekir mi (§3)?

---

## 1. İlke

1.1. **Asıl kayıt Kurulum'dadır.** Bulut Kopyası, Lisans Alan'ın kendi sunucusundaki verinin bir okuma kopyasıdır. Buluttaki silme ya da imha, Kurulum'daki kayıtlara dokunmaz; Lisans Alan'ın yasal saklama yükümlülükleri Kurulum'daki kayıtlarla ve kendi yedekleriyle yerine getirilir.

1.2. **Fabrikada silinen, bulutta da silinir.** Kurulum'da silinen ya da buluta gönderilme kapsamından çıkan bir kayıt, bir sonraki eşitlemede bulutta "silindi" işaretlenir ve §2.3'teki süre sonunda fiziksel olarak silinir.

1.3. **İmha yöntemi.** Bulut veritabanındaki satırlar fiziksel silme ile silinir. Silinen verinin veritabanı dosyalarında ve yedeklerde kalan izleri §4.4'teki yedek döngüsüyle düşer. Anonimleştirme yalnız kimliksiz toplam ölçümler için kullanılır (Patron Bulutu Veri İşleme Eki, Ek-6, §2.4).

## 2. Hizmet sürerken saklama

2.1. **Geçmiş seçeneği.** Buluttaki geçmişin uzunluğu Lisans Veren portalında **Kurulum başına** ayarlanır ve Lisans Alan'ın talimatıdır:

| Seçenek | Anlamı |
|---|---|
| 3 ay | İş tarihi 3 aydan eski kayıtlar bulutta tutulmaz |
| **13 ay (varsayılan)** | İş tarihi 13 aydan eski kayıtlar bulutta tutulmaz |
| 25 ay | İş tarihi 25 aydan eski kayıtlar bulutta tutulmaz |
| Tümü | Buluttaki geçmiş süreyle sınırlanmaz; Kurulum'daki bütün geçmiş kapsama girer |

2.2. **Ne budanır, ne budanmaz.** Süre, **iş kayıtlarına** uygulanır (sipariş, sevkiyat, fatura, cari ve kasa hareketleri, çek/senet vb.); her kayıt türünün hangi tarihe göre sayılacağı projeksiyon kataloğunda yazılıdır (ör. sipariş: sipariş tarihi; sevkiyat: çıkış tarihi, yoksa kayıt tarihi; fatura: belge tarihi). **Ad sözlükleri** (ürün, renk, depo, istasyon, cari kart, şube) süreyle budanmaz; Kurulum'da pasife alınsa da kart silinmedikçe kalır, çünkü eski iş kayıtları onlara işaret eder.

2.3. **Budama işi.** Bulut sunucusu her gün bir kez:
- iş tarihi seçilen süreden eski iş kayıtlarını,
- "silindi" işaretinin üzerinden **7 gün** geçmiş kayıtları
fiziksel olarak siler. Kısa seçeneğe geçilirse fazlası bir sonraki günlük işte silinir; uzun seçeneğe geçilirse eksik geçmiş Kurulum'dan yeniden gönderilir.

2.4. **Bulutta doğan verinin saklanması**

| Kayıt | Süre | Sonra |
|---|---|---|
| Bulut Hesabı | Hesap kapatılana ya da hizmet bitene kadar | §4'e göre silinir |
| Başarısız giriş kayıtları | 90 gün | Silinir |
| Diğer hesap güvenlik kayıtları (giriş, hesap/izin değişikliği, kilitleme) | 2 yıl | Silinir |
| Gelen Kutusu talebi ve sonucu | Talep tarihinden itibaren §2.1'deki geçmiş seçeneği kadar ("Tümü" seçiliyse süre sınırı yok) | Silinir; Kurulum'daki makbuz kalır |
| Rapor istekleri ve sonuçları | 30 gün | Silinir |
| Bildirim cihaz anahtarı | Cihaz kaldırılana, hesap kapatılana ya da anahtar geçersizleşene kadar | Silinir |
| Hesap güvenlik kayıtlarındaki IP adresi (giriş ve başarısız giriş) | Kaydın oluşmasından 30 gün | Yalnız IP adresi silinir; kaydın geri kalanı yukarıdaki süreyle kalır |
| Bulut uygulamasının erişim günlüğü | IP adresi tutulmaz | — |
| Cloudflare erişim günlükleri (IP) | Cloudflare kendi süresini uygular | Cloudflare siler |
| Lisans Veren'in Bulut Kopyası'na erişim kayıtları (Teknik ve İdari Tedbirler, Ek-6/B, §3.2) | Silinmez; Tesis'in imhasından sonra da kalır [avukat] | — |
| Uygulamanın cihazdaki önbelleği | Oturum kapatılana ya da hesap kilitlenene kadar | Uygulama siler |

2.5. **Hesap kapatma.** Tesis Yöneticisi bir Bulut Hesabı'nı kapattığında hesabın girişi hemen kapanır; kapatılan hesap yeniden açılamaz ve düzenlenemez. Kapatmadan 30 gün sonra ad ve e-posta silinir ve hesap her yerde (Gelen Kutusu'ndaki talepler dahil) "Silinmiş hesap" adıyla görünür; parola özeti, TOTP sırrı, oturumlar ve bildirim cihaz anahtarları da aynı anda silinir. Hesabın ad ve e-posta taşımayan iç kimlik numarası, iş kayıtlarının izi olarak kalır; güvenlik kayıtları adı değil bu numarayı taşır ve §2.4'teki süreyle kalır [avukat: kapatılan hesabın iç kimlik numarasının güvenlik kaydında kalması ölçülü mü].

## 3. Talep üzerine silme

3.1. **İlgili kişinin silme talebi.** Lisans Alan, bir ilgili kişinin talebini kabul ederse kaydı **Kurulum'da** siler ya da anonimleştirir; bulut kopyası §1.2 ile en geç bir sonraki eşitleme + 7 gün içinde düşer. Lisans Alan daha hızlı silme isterse Lisans Veren, yazılı talep üzerine ilgili bulut kayıtlarını 3 iş günü içinde elle siler ve Lisans Alan'a bildirir.

3.2. **Hizmeti erken kapatma.** Lisans Alan hizmet süresi dolmadan eşitlemeyi kapatabilir. Kapatma eşitlemeyi durdurur; buluttaki veri §4'teki bitiş akışına girer.

3.3. **Delil ihtiyacı.** Bir uyuşmazlık, resmî inceleme ya da hukuki yükümlülük nedeniyle belirli kayıtların saklanması gerekirse Lisans Alan bunu yazılı olarak bildirir; o kayıtlar gerekçe ortadan kalkana kadar imhadan ayrılır ve erişimi kısıtlanır [avukat].

## 4. Hizmetin bitmesi: dışa aktarma ve imha

4.1. **Eşitleme durur.** Patron bulutu hizmetinin süresi (Kullanım Onayı'nda yazılı patron bulutu bitiş tarihi) dolduğunda, hizmet feshedildiğinde ya da Lisans Alan kapattığında Kurulum buluta veri göndermeyi bırakır. Bulut da o Kurulum'dan gelen paketi reddeder. Kurulum'un felaket kurtarma kurulumuna devredilmesi hizmetin bitişi sayılmaz: devir süresince eşitleme durabilir, Bulut Hesapları girmeye ve okumaya devam eder.

4.2. **Dışa aktarma süresi.** Bitişten itibaren 90 gün boyunca (salt okunur dönem):
- Bulut Hesapları girebilir ve Bulut Kopyası'nı izinleri ölçüsünde okuyabilir; Tesis Yöneticisi hesap yönetimini (kilitleme, kapatma, izin kaldırma) sürdürebilir;
- Gelen Kutusu'na yeni kayıt girilemez, rapor istenemez, Kurulum'dan yeni veri alınmaz ve bildirim gönderilmez;
- Tesis Yöneticisi, makinece okunabilir bir döküm (JSON ve CSV) alabilir. Döküm, Bulut Kopyası'ndan kendi izinleriyle okuyabildiği veriyi ve bulutta doğan veriyi kapsar: Gelen Kutusu talepleri ve sonuçları, hesap listesi (parola ve doğrulama sırları olmadan), hesap güvenlik kayıtları ve Lisans Veren'in erişim kayıtları;
- Lisans Alan dilerse imhanın bu süreyi beklemeden yapılmasını yazılı olarak isteyebilir.
Süre dolduğunda Bulut Hesapları'nın girişi kapanır.
Bulut Kopyası'ndaki iş verisinin aslı Kurulum'da durduğundan, dışa aktarma çoğunlukla bulutta doğan veri için anlamlıdır.

4.3. **İmha.** Süre sonunda Lisans Veren, o Tesis'e ait bütün bulut verisini (Bulut Kopyası, Bulut Hesapları, güvenlik kayıtları, Gelen Kutusu, rapor sonuçları, bildirim anahtarları) canlı veritabanından siler. Ticari bir alacak ya da §3.3 kapsamında bildirilmiş bir saklama gerekçesi imhayı durdurmaz; yalnız gerekçeye konu kayıtlar ayrılır [avukat]. Lisans Veren'in erişim kayıtları (Teknik ve İdari Tedbirler, Ek-6/B, §3.2) ile imhanın kendi kaydı (§6) imhada silinmez.

4.4. **Yedeklerde imha.** Bulut veritabanının yedekleri günlük alınır ve 30 günlük döngüyle tutulur. Yedekler tek bir Tesis için seçici olarak düzenlenmez; silinen veri, yedek döngüsü tamamlandığında (imhadan en geç 35 gün sonra) son yedekten de düşer. Bu sürede yedekten geri yükleme yapılırsa, imha edilmiş Tesis'in verisi geri yüklemenin hemen ardından yeniden silinir ve bu işlem kayda geçer.

4.5. **İmha tutanağı.** İmha tamamlanınca Lisans Veren, Lisans Alan'a imha tarihini, silinen veri kategorilerini ve yedeklerden düşeceği son tarihi gösteren bir tutanak verir.

4.6. **Kurulum tarafında.** İmha, Kurulum'daki verilere ve Gelen Kutusu makbuzlarına dokunmaz. Kurulum'daki eşitleme kayıtları (filigranlar, silme işaretleri) Kurulum'un kendi saklama kurallarıyla budanır.

## 5. Periyodik gözden geçirme

5.1. Günlük budama işi (§2.3) otomatik imhadır ve her koşumu bulut sunucusunun işletme kaydına düşer (silinen satır sayısı, tesis, tür; kaydın içeriği değil).

5.2. Lisans Veren 6 ayda bir şunları gözden geçirir ve sonucu kayda geçirir: budama işinin her Tesis için çalıştığı; §2.4 sürelerinin uygulandığı; bitmiş hizmetlerin imhasının tamamlandığı; yedek döngüsünün §4.4'e uyduğu.

## 6. Kayıtlar

6.1. Her imha (günlük budama özeti, talep üzerine silme, hizmet bitişi imhası, yedekten düşme teyidi) şu bilgilerle kayda geçer: tarih, Tesis, veri kategorisi, yöntem (fiziksel silme), işlemi yapan (otomatik iş ya da Lisans Veren çalışanı), gerekçe.

6.2. İmha kayıtları en az 3 yıl saklanır [avukat: Yönetmelik]. Bu kayıtlar silinen verinin içeriğini taşımaz.
