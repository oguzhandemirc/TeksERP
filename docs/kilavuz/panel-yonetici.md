# Panel — Yönetici Kılavuzu

Panel, yönetici bilgisayarındaki TeksERP uygulamasıdır. Aşağıdaki menü yolları sol menüden başlar.

## 1. İlk giriş ve zorunlu parola değişimi

1. Panel açılınca giriş ekranı gelir. **Kullanıcı adı** ve **Şifre** yazın, **Giriş Yap** düğmesine basın.
2. Hesap kurulumda üretilmiş bir parolayla açıldıysa "Yeni parola belirleyin" ekranı çıkar. **Yeni parola** ve **Yeni parola (tekrar)** alanlarına en az 10 karakterlik yeni parolayı yazıp **Parolayı değiştir** düğmesine basın. Vazgeçerseniz **Vazgeç** ile giriş ekranına dönersiniz; parola değişmeden devam edilemez.
3. Hesapta iki adımlı doğrulama varsa "Doğrulama kodu" ekranı açılır; telefondaki uygulamanın 6 haneli kodunu yazın. Henüz kurmadıysanız "İki adımlı doğrulama" ekranı sizi yönlendirir: kareyi uygulamayla okutun, kodu girin, kurtarma kodlarını güvenli bir yere kaydedip "Kurtarma kodlarımı güvenli bir yere kaydettim." kutusunu işaretleyin.
4. Giriş ekranında "Sunucuya ulaşılamadı" çıkarsa [sorun-giderme.md](sorun-giderme.md) bölüm 1.

## 2. Kullanıcı ve yetki

Sol menü → **Yönetim → Yetkilendirme**. Bu sayfada iki grup vardır: "Kullanıcı Erişimi" (Kullanıcılar, Yetki Şablonları, Yetki Kataloğu, Patron Bulutu) ve "Cihaz Erişimi" (Tabletler).

**Yeni kullanıcı:** Yetkilendirme → **Kullanıcılar** → **Yeni Kullanıcı**. "Kullanıcı Adı" (yalnız İngilizce harf ve rakam, sonradan değişmez), "Ad Soyad" ve "Şifre" (en az 10 karakter) girin. "Üretim operatörü yetkilerini ver (KK1 · Kurşun/KK2 · Tambur)" kutusu varsayılan işaretlidir; yalnız panel kullanacak kişide işareti kaldırın. **Kaydet** ile oluşur; şifre yalnız o anda gösterilir.

**Mevcut kullanıcı:** Kullanıcılar listesinde satıra tıklayın; açılan pencerede sekmeler:
- **Yetkiler** — yetkileri tek tek verin ya da sağdaki **Şablon Uygula** bölümünden bir şablonu **Ekle** (mevcut yetkilere ekler) veya **Değiştir** (yerine koyar) ile uygulayın.
- **Şifre Sıfırla** — kullanıcının parolasını yenileyin.
- **Personel Kartı** — **Kart Oluştur**; kartı **Yazdır**. Kaybolursa **Yeniden bas**.
- **Hızlı PIN** — tablette giriş için 6 haneli PIN: **Ata** (elle yazılan), **Rastgele Üret**, **Kaldır**. PIN yalnız verildiği an gösterilir; operatöre o anda iletin.
- **İki Adımlı** — iki adımlı doğrulama ayarı.

Satırdaki düğmelerle kullanıcı **pasife alınır** (geri alınabilir) ya da kalıcı silinir (geri alınamaz; geçmişi olan kullanıcıyı pasife almak daha doğrudur).

**Rol (yetki şablonu):** Yetkilendirme → **Yetki Şablonları** → **Yeni Şablon**. Sık kullanılan yetki kümelerini şablon yapın (ör. Muhasebe, Süpervizör). Yetkilerin tam listesi **Yetki Kataloğu**ndadır. Fatura, sevk geri alma ve top elle düzeltme yetkileri yalnız Muhasebe/Süpervizör gibi güvenilen rollere verilir.

**Tabletler:** Yetkilendirme → **Tabletler**. Yeni bir tablet bağlanınca "Onay bekliyor" olarak listelenir; satırdaki **Cihazı Onayla** düğmesiyle kabul edin, "Tür" (Tablet / Telefon / PC / Yönetici) ve isterseniz "Takma Ad" girip **Onayla**'ya basın. Bu zorunluluk "Baskı & Cihazlar" ayarına bağlıdır; kapalıysa tabletler doğrudan onaylı gelir.

## 3. Modüller

Hangi modülün açık olduğu Sistem → **Modüller** karosundadır; bu karo yalnız satıcı (süperadmin) hesabına görünür ve yönetici hesabında yoktur. Modül kapalıysa ilgili menü, karo ve tablet bölümü hiç çizilmez ve adresle açılsa bile sunucu "modül kapalı" cevabı verir. Bir modülü açtırmak ya da kapattırmak için satıcıya başvurun.

Fabrikanın kendi tercihleri ayrıdır: Sistem → **Özellik Anahtarları** (sipariş/sevkiyat, üretim, kalite ve muhasebe davranışı). Kayıt sırasında "ayar şifresi" sorulabilir.

## 4. Ayarlar

Hepsi sol menü → **Yönetim → Sistem** sayfasındaki karolardır ("Yapılandırma" grubu):

| Karo | Ne için |
|---|---|
| **Şirket & Güvenlik** | Firma adı, adres, telefon, vergi bilgisi, belge logosu; oturum süreleri; PIN/kart yanlış deneme kilidi |
| **Baskı & Cihazlar** | Etiket baskısı ve tablet eşleştirme zorunluluğu |
| **Bu Bilgisayar** | Bu bilgisayara bağlı yazıcı, kantar, barkod tabancası ve sunucu adresi |
| **Numaralandırma** | Sevkiyat, çuval, sevk partisi ve iade belge numarasının ön eki ve biçimi (yalnız yeni belgeleri etkiler) |
| **Özellik Anahtarları** | Davranış ayarları (yukarıda) |
| **Veri Aktarımı** | Excel/CSV ile toplu kayıt yükleme |
| **Mükerrer Kayıtlar** | İki kez açılmış kayıtları tek kayıtta birleştirme |

Ana veri (ürünler, renkler, cariler, istasyonlar, rotalar, etiket şablonları) **Tanımlar** sayfasındadır. Tabletteki oturum için istasyon ve makine listesi **Tanımlar → Üretim İstasyonları** kaydından gelir.

## 5. Yedek

Sistem → **Yedekler**. Liste yedek dosyalarını (Tarih, Dosya, Boyut, Şifreli) gösterir; indirebilirsiniz. "Otomatik yedek saati" kartından her günkü yedek saatini seçersiniz (sunucunun yerel saati). Aynı sayfada "Offsite Yedek" kartı: "Yerel ikinci hedef" (ağ paylaşımı ya da ikinci disk) veya buluta kopyalama (Google Drive bağla); **Bağlantıyı test et** ile denenir.

Elle yedek: Sistem → **Sunucu Durumu** → **Şimdi yedek al**.

Geri yükleme canlı veritabanını yedek anına döndürür ve sonraki değişiklikleri siler. Sistem → **Veritabanı Geri Yükleme** karosu da yalnız satıcı hesabına açıktır; geri yükleme gerekiyorsa önce satıcıya haber verin.

## 6. Sunucu Durumu ve güncelleme onayı

**Sunucu Durumu:** Sistem → **Sunucu Durumu**. CPU, RAM, Disk, Veritabanı boyutu, Son yedek, Online kullanıcı, Bağlı cihaz, Çalışma süresi, Sürüm. Üstte "Dikkat gerekiyor" bandı çıkarsa ilgili satır renkli gösterilir; disk dolması ve yedeğin eskimesi önce bakılacak satırlardır.

**Sunucu güncellemesi:** Sistem → **Sunucu Güncellemeleri**. Sayfada Sürüm, Politika, Onay, Güncelleyici, Son güncelleme ve Geçmiş kartları vardır. ("Güncelleme" karosu ise yalnız bu bilgisayardaki paneli içindir; karıştırmayın.)
- Politika "Otomatik" ise güncelleme, tanımlı güncelleme penceresinde kendiliğinden kurulur.
- Politika "Onaylı" ise yeni sürüm gelince "Onay" kartında seçersiniz: **Şimdi kur** (bir dakika içinde başlar; kurulum sürerken panel ve tabletler sunucuya birkaç dakika bağlanamaz) ya da **Bu gece kur** (güncelleme penceresinde). Verilen onayı **Onayı geri al** (Onaylı kip) veya **Pencereye bırak** (Otomatik kip) ile geri alırsınız. Bu düğmeler lisans yönetme yetkisi ister.
- Güncelleyici önce yedek alır, kurar, sağlık denetimi yapar; sorun çıkarsa eski sürüme kendiliğinden döner (sonuç "Geri dönüldü"). "Başarısız — müdahale gerekiyor" görünürse [sorun-giderme.md](sorun-giderme.md) bölüm 4.
- Mesai saatinde "Şimdi kur" yerine "Bu gece kur" seçmek daha güvenlidir.

## 7. Lisans bandı

Panelin üstünde renkli ince bir şerit çıkabilir. Mavi bilgi, sarı uyarı, kırmızı tehlikedir; metni ve (varsa) kalan gün sayısını ("Ek süre: N gün" ya da "Kısıtlamaya N gün") gösterir. Lisansın tam durumu Sistem → **Lisans** karosundadır: durum, hak ve modüller, **Lisansı şimdi yokla**, "Etkinleştirme"/"Yenileme" kartı (etkinleştirme kodunu girip **Etkinleştir**). Kademeler: Normal → Uyarı → Ek süre → Kısıtlı kip → Durduruldu. Her kademede okuma, rapor, dışa aktarma ve yedek açık kalır. Ayrıntı: [sorun-giderme.md](sorun-giderme.md) bölüm 3.

## 8. Destek talebi

Sistem → **Destek** → "Yeni destek talebi": **Konu** ve **Açıklama** yazın, isterseniz **Ekran görüntüsü ekle** (yanlış çıkarsa **Ekran görüntüsünü kaldır**), **Talebi gönder**. Sağlık özeti sunucuda otomatik eklenir. Yanıtlar aynı sayfada "Talepler" listesinde, "Satıcı yanıtları" bölümünde görünür.

## 9. Hata raporu onayı

Bu sürümde hata raporunu müşteri onayıyla otomatik ileten bir ekran yoktur (planlı). Şimdilik sorunu yukarıdaki **Destek** talebiyle bildirin.
