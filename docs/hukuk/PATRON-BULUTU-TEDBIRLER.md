# Patron Bulutu Teknik ve İdari Tedbirler

> **TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu metin bir taslaktır; hukuki görüş değildir. **Bu ek bir taahhüt listesidir: her tedbir hizmet satışa açılmadan önce uygulanmış ve doğrulanmış olmalıdır.**
>
> Metin kimliği: `PBTT-2026.1-taslak` · Ek-6/B · Patron Bulutu Veri İşleme Eki'nin (Ek-6) ekidir.

> **Avukat şu maddelere özellikle baksın**
> - **KVKK md. 12/1 ve Kurul'un "Kişisel Veri Güvenliği Rehberi (Teknik ve İdari Tedbirler)":** Aşağıdaki liste rehberdeki başlıklarla karşılaştırıldığında eksik bir başlık var mı?
> - **Sözleşmesel taahhüt düzeyi:** Tedbirlerin sözleşmeye ek olarak girmesi Lisans Veren için bir garanti mi doğurur? "Esaslı bir tedbiri zayıflatmadan önce bildirim" (Patron Bulutu Veri İşleme Eki, Ek-6, §7.1-d) yeterli bir değişiklik mekanizması mı?

---

## 1. Teknik tedbirler

### 1.1. Veri azaltma
- Buluta giden her alan bir katalogda **tek tek** listelenir (opt-in). Katalogda olmayan alan gitmez; yeni bir kolon kendiliğinden buluta sızmaz.
- Kişisel ve finansal alanlar ana kayıttan ayrı alt kayıtlara bölünür; bu alt kayıtları yalnız ilgili izni olan hesap okuyabilir (§1.3).
- Denetim kayıtları, fabrika kullanıcılarının adları ve kimlikleri, parolalar, PIN'ler, kartlar, sistem ayarları ve `notlar` alanları buluta hiç gitmez.
- Hizmet varsayılan olarak kapalıdır; yalnız Üretim sınıfı, Patron Bulutu hakkı olan, süresi bitmemiş Kurulum gönderir. Belirsizlikte gönderilmez.

### 1.2. Kiracı yalıtımı (tesis ayrımı)
- Bütün Tesis'ler tek bulut veritabanını paylaşır; her satır bir Tesis kimliği taşır.
- Veritabanı **satır düzeyi güvenlik** (PostgreSQL RLS) açık ve tablo sahibine de zorunludur (`FORCE`). Her isteğin veritabanı işlemi, ilk ifadesinde o isteğin Tesis kimliğini ayarlar; ayarlanmamış bağlantıda sorgu **hata verir ve satır döndürmez**.
- Uygulamanın veritabanı rolü süper kullanıcı değildir, RLS'yi aşamaz ve tabloların sahibi değildir. Eşitleme yazımı ayrı bir rolle yapılır.
- Eşitleme paketinin hangi Tesis'e yazılacağı paketin gövdesinden değil, imzayı atan Kurulum'un kaydından çözülür.
- Bir hesap yalnız **tek bir Tesis'e** bağlıdır.

### 1.3. Yetkilendirme
- Bulut izinleri alan ailesi bazındadır (sipariş, sevkiyat, üretim, stok, cari kişisel alanlar, cari bakiye, kasa/banka, çek/senet, fatura, tahsilat, fiyat, rapor, yazma, hesap yönetimi). İzin, veritabanında ikinci bir kısıtlayıcı RLS politikasıyla da uygulanır: "siparişi görür, tutarı görmez" hesap tutar satırını veritabanı düzeyinde okuyamaz.
- Her projeksiyon tam bir izne bağlanır; bağlanmamış bir projeksiyon bulunursa hizmet açılmaz (fail-closed).
- Süper yetki yoktur; izinleri Tesis Yöneticisi atar.

### 1.4. Kimlik doğrulama
- Giriş: e-posta + parola + **iki aşamalı doğrulama (TOTP)**, her hesap için zorunlu.
- Parolalar geri döndürülemez biçimde (scrypt) özetlenir. TOTP sırları veritabanında şifreli durur.
- Başarısız girişler sınırlanır ve kaydedilir: art arda 5 hatalı denemede hesap 15 dakika kilitlenir; giriş istekleri ayrıca IP adresi başına dakikada 20 ile sınırlıdır.
- Kurtarma kodu yoktur: TOTP kaybında Tesis Yöneticisi sıfırlar. Tesis Yöneticisi'nin kendi TOTP'si için yazılı başvuru gerekmez: Lisans Alan yetkilisi Lisans Veren'e ulaşır; Lisans Veren sözleşmede kayıtlı telefon numarasını geri arayarak kimliği doğrular ve doğrulanınca yeni cihaz için yeniden kurulum bağlantısı gönderir.

### 1.5. Şifreleme ve bütünlük
- Bütün bağlantılar TLS ile şifrelidir.
- Kurulum'dan buluta giden her paket Kurulum anahtarıyla **imzalıdır** (Ed25519) ve gövde özeti taşır; yolda değiştirilen ya da tekrar oynatılan paket reddedilir. Bulut, fabrika verisine yazamaz; tek yazma kanalı Gelen Kutusu'dur ve Kurulum onu normal iş kurallarıyla, tekrar güvenli (idempotent) biçimde işler.
- Sunucu diski ayrıca şifrelenmez; yedekler ve TOTP sırları şifrelidir.
- Yedekler, fabrika yedekleriyle aynı yöntemle şifrelenir (X25519 + AES-256-GCM, açık anahtarla); açan özel anahtar sunucuda durmaz, Lisans Veren'in sunucu dışındaki ortamında (yönetim bilgisayarı ve USB) tutulur.
- Uygulamanın cihazdaki önbelleği uygulamanın korumalı alanında tutulur (mobilde uygulamaya ayrılmış depolama alanı, web sürümünde tarayıcının bu siteye ayırdığı depolama); uygulama önbelleği ayrıca şifrelemez. Oturum anahtarı işletim sisteminin güvenli depolamasında (iOS Keychain, Android Keystore) tutulur; web sürümünde yalnız tarayıcı sekmesi açıkken saklanır. Önbellek oturum kapatılınca, oturum geçersiz sayılınca ve her yeni girişte silinir; izni kaldırılan verinin önbellekteki kopyası bir sonraki okumada silinir.

### 1.6. Barındırma ve ağ
- Türkiye'deki VDS; lisans sunucusundan **ayrı konteyner, ayrı ağ, ayrı veritabanı ve ayrı veritabanı rolü**; kaynak kullanımı sınırlı.
- İnternete yalnız Cloudflare üzerinden HTTPS açıktır; yönetim erişimi yalnız Lisans Veren'in özel ağından (Tailscale) yapılır.
- İşletim sistemi güvenlik yamaları her gün otomatik uygulanır; uygulama bileşenleri sürüm yükseltmesiyle, her yükseltmeden önce yedek alınarak güncellenir.

### 1.7. Yedek ve süreklilik
- Bulut veritabanı günlük yedeklenir, 30 gün döngüyle tutulur, en az 3 ayda bir geri yükleme provası yapılır.
- Bulut kaybında veri Kurulum'dan **yeniden eşitlenebilir** (asıl kayıt fabrikadadır); bulutta doğan veri (hesaplar, Gelen Kutusu) yedekten döner.
- Yedekteki imha kuralı: Saklama ve İmha Prosedürü (Ek-6/A) §4.4.

### 1.8. Kayıt ve izleme
- Bulut hesap güvenlik kaydı: giriş, başarısız giriş, hesap açma/kapama/kilitleme, izin değişikliği, okundu teyidi. Tesis Yöneticisi kendi Tesis'inin kaydını görür.
- Eşitleme ve Gelen Kutusu işleme kayıtları: paket kimliği, zaman, sonuç (içerik değil).
- Sistem sağlığı izlenir (eşitleme gecikmesi, yedek başarısı); aksaklık Tesis Yöneticisi'ne bildirim olarak da gider.
- Kayıtlar parola, TOTP sırrı ve paket içeriği taşımaz.

## 2. İdari tedbirler

- Bulut sunucusuna ve veritabanına erişebilen Lisans Veren çalışanları rolleriyle belirlidir; adları Lisans Veren'in iç kaydında tutulur. Her biri yazılı gizlilik sözleşmesi altındadır.
- En az yetki: çalışanlar günlük işte Bulut Kopyası içeriğini görmez; işletme ekranları sayı ve durum gösterir.
- Yılda bir kez çalışanlara kişisel veri ve güvenlik eğitimi verilir, kayda geçer.
- Alt işleyenlerle yazılı sözleşme (Patron Bulutu Veri İşleme Eki, Ek-6, §6).
- Güvenlik ihlali prosedürü: Veri İhlali Bildirim Prosedürü (Ek-8).
- Tedbirler yılda bir gözden geçirilir; yılda bir bağımsız sızma testi yaptırılır.
- İşten ayrılan çalışanın erişimi ayrıldığı gün kapatılır.

## 3. Lisans Veren'in Bulut Kopyası'na erişimi ve erişim kaydı

3.1. Lisans Veren çalışanı bir Tesis'in Bulut Kopyası içeriğine **yalnız** şu hâllerde bakar: Lisans Alan'ın destek talebi; bir güvenlik ihlalinin incelenmesi; yetkili makamın hukuken bağlayıcı talebi.

3.2. Her içerik erişimi silinemeyen bir kayda yazılır: kim, ne zaman, hangi Tesis, hangi veri kümesi, gerekçe (destek talebi numarası). Doğrudan veritabanı sorgusu da bu kurala tabidir: yalnız ayrı, salt okunur bir destek rolüyle yapılır ve oturumu kayda geçer.

3.3. Lisans Alan, kendi Tesis'ine ait erişim kayıtlarının dökümünü isteyebilir; döküm 10 iş günü içinde verilir.

3.4. Lisans Veren, destek sırasında Bulut Kopyası'ndan veri dışarı çıkarmaz; istisna ve şartları Bakım ve Destek Sözleşmesi (Ek-4) §6 ile aynıdır (yazılı onay, asgari veri, iş bitince silme).

## 4. Doğrulama

Tedbirlerin teknik ayağı patron bulutu kabul senaryosuyla ölçülür: finans izni olmayan hesabın finansı göremediği (API ve RLS), Tesis kimliği ayarlanmamış bağlantının satır döndürmediği, Test sınıfı kurulumun gönderemediği, saklama budamasının çalıştığı, abonelik bitince eşitlemenin durduğu. Hizmet satışa açılmadan bu adımların kanıtı bu eke iliştirilir.
