# Tablet — Operatör Kılavuzu

Bu belge referans üretim akışını anlatır: ham giriş (KK1) → kurşun + KK2 → tambur → depo → çuval → sevkiyat. Her fabrikada hepsi açık olmayabilir; modüle bağlı bölümler işaretlidir. Tabletteki bölüm adları fabrikanızda bu belgeden farklı yazılmışsa sıra aynı kalır.

## 1. Giriş

1. Tablet açılınca giriş ekranı gelir ("TeksERP · Üretim Yönetim Sistemi"). Giriş yöntemleri yönetici tarafından açılır; ekranda iki yol görürsünüz:
   - **Hızlı PIN:** "HIZLI PIN İLE GİRİŞ" bölümünde 6 haneli PIN'i tuş takımına girin. (Vardiya değişiminde ekrandaki ada dokunup PIN'i girmeniz yeter.)
   - **Personel kartı:** "Personel Kartını Okut" → kameraya kartınızdaki QR kodu gösterin.
   - **Kullanıcı + şifre:** "1 · KULLANICI" altında **Kullanıcı Seç**, "2 · ŞİFRE" altında parolanızı yazın.
   - Ekranda görünmeyen yöntem için **Diğer giriş yöntemlerini dene**.
2. Giriş sonrası "Bölüm Seçimi" ekranı gelir. Yalnız yetkiniz olan ve fabrikada açık bölümler kartlar halinde görünür. Hiç kart yoksa "Görünür bölüm yok" yazar: yetkili olduğunuz bölüm yönetim panelinden kapatılmıştır.
3. Sağ üstteki kullanıcı menüsünden: **Ayarlar**, **Bölüm değiştir**, **Kilitle / operatör değiştir**, **Çıkış**.
4. Sunucuya bağlanılamıyorsa girişteki dişli simgesi ("Sunucu ayarları") → "API Sunucusu" ekranı: [sorun-giderme.md](sorun-giderme.md) bölüm 1.

Tablet ilk kez bağlanıyorsa "Cihaz Atama Bekliyor" ekranı çıkar. Ekranın altındaki **CİHAZ KİMLİĞİ**ni yöneticiye söyleyin; yönetici panelden onaylar.

## 2. Yer (istasyon) onayı

KK1 (Ham Giriş), Kurşun, Tambur ve Sevkiyat bölümleri hangi istasyonda çalıştığınızı bilmek ister. Bölüme ilk girişte:
1. **Makine QR'ını Okut** (makinenin üstündeki QR'ı okutun) **veya** listeden **İstasyon seç** → **Makine seç**.
2. Makinesiz istasyonda (sevkiyat gibi) istasyona dokunmak ya da **Bu istasyonda çalış** yeter.
3. Makine başka bir kullanıcıdaysa "Makine dolu — devral?" sorulur; **Vazgeç** ya da devralın.
4. Listede istasyon yoksa "Bu türde tanımlı aktif istasyon yok" yazar; yöneticiden **Tanımlar → Üretim İstasyonları**na eklemesini isteyin.

## 3. Ham giriş (KK1)

> Yalnız **Üretim** modülü açıksa görünür.

Bölüm Seçimi → **Ham Giriş**.
1. **Desen Seç** → listeden kumaşı seçin ("Seçilen Desen" altında görünür).
2. **Renk Seç** → rengi seçin ("Seçilen Renk"). Renk gerekmeyen girişte atlanır.
3. **Metraj (mt)** yazın. Sağdaki tuş takımını kullanın. **En (cm)** ve **Ağırlık (kg)** alanları varsa doldurun. Fabrikada ölçüm makinesi bağlıysa metraj makineden gelir.
4. **Kalite** düğmelerinden topun kalitesini seçin.
5. **Kaydet ve Etiket Bas**'a basın. Top kaydedilir, etiket yazıcıdan çıkar. "Kaydedildi ✓" görünce sıradaki topa geçin.
6. Etiketi topa yapıştırın. Fabrikada "etiket doğrulama" açıksa düğme "Önce Etiketi OKUT" yazar: **Okut** düğmesiyle çıkan kâğıttaki barkodu okutun; okutmadan yeni top girilemez.
7. Bağlantı koptuysa kayıt tablette bekler ve bağlantı gelince gider; hata olursa düğme **Tekrar Dene (aynı top)** olur. Aynı topu iki kez girmeyin.
8. Üst çubuktaki **Bu oturum** düğmesi bu vardiyada girilenleri, yazıcı kuyruğu düğmesi basılmayı bekleyen etiketleri gösterir. Yanlış girilen top satırındaki "Topu iptal et / hurda" ile iptal edilir; iptalde sebep sorulur.

## 4. Kurşun ve KK2

> Yalnız **Üretim** modülü açıksa görünür.

Bölüm Seçimi → **Kurşun**.
1. Üstte **Kart Okut** ile topun refakat kartının QR/barkodunu okutun (**Tara** ile barkod, **Liste** ile "Kurşun · KK2 İşleri" listesinden açık kartlar). Kart açılınca sağdaki kuyruktan topu seçin.
2. Hata bulunan metreyi **Hata metresi (mt)** alanına yazın, ardından **hata tipi** düğmesine basın; hata doğrudan kaydedilir (ayrı Ekle düğmesi yok). Yanlışı silmek için cetveldeki işarete dokunup silin.
3. Barkodlu top için altta **KK2 Tamamla (N hata)** düğmesine basın. Barkodsuz açık kumaş için **Kumaşı Bitir (Tambur'a Gönder)**.
4. Kartın bütün topları KK2'yi geçince **Adımı Kapat — Toplar Tambur'a** görünür; basınca toplar tambura geçer.
5. "Bu iş kurşun dağıtımında" uyarısı çıkarsa kart henüz bir kurşun makinesine dağıtılmamıştır; **Kurşun Dağıtım** bölümünden dağıtılır.

## 5. Tambur

> Yalnız **Üretim** modülü açıksa görünür.

Bölüm Seçimi → **Tambur**.
1. Refakat kartını okutun (kart "Kart açıldı").
2. Açık kumaş topunu seçin. Kesilecek **uzunluğu** yazın; boş bırakırsanız kalan metraj kesilir. Çıkacak parçanın **kalitesini** seçin.
3. **Kes — Top Oluştur** (ya da boş uzunlukta **Kes — Kalanı Kes**; makine bağlıysa **Kes — Makineden Ölç**) düğmesine basın. Her kesimde yeni top doğar ve etiketi basılır. **Kartela** düğmesi açıkken kesilen parça kartelalık sayılır.
4. Bütün kesim bitince **Bitir**'e basın. Kalan kumaş varsa karar penceresi açılır (1. kalite / A1 / fire). Kalan yoksa tek dokunuşla biter.
5. Kalitesi fire olan parçada etiket otomatik basılmaz; gerekirse **Etiket** ile elle basılır.
6. Biten top **Depo** durumuna geçer ("Tambur tamamlandı — Top depoya gönderildi").
7. Üstteki düğmeler: **Çıkan Toplar** (son çıkan toplar), **Top Kesme** (depodaki bir topu yeniden kesme), **Sipariş Bağla** (yalnız planlama yetkisinde), **Düzelt** (yalnız yetkili operatörde).

## 6. Depo

Bölüm Seçimi → **Depo**. Biten toplar tamburdan buraya kendiliğinden gelir; depo bir istasyon değil bekleme durumudur, ayrıca "depoya al" işlemi yoktur.
1. Üstteki özet kutuları adetleri gösterir (Serbest, Çuvalda, Ham, A1, Fire).
2. **Barkod Okut** ile topu okutun ya da **Kumaş ara** kutusuna adı/kodu yazın.
3. Sekmeler: **Tümü · Depo · Çuvalda · Ham · Yarı Mamul · Kartela · Kartelalık**.
4. Müşteriden iade topları **İade Girişi** bölümüyle depoya alınır (bu bölümü yöneticiniz yetkilendirmişse görünür).

## 7. Çuval (paketleme)

Bölüm Seçimi → **Sevkiyat** (tartım, paketleme, irsaliye).
1. Üstte arama kutusuna müşteri, sipariş no ya da şube yazın; **Açık Siparişler** listesinden ya da **Çuvalla** ile müşteriyi seçin ("Müşteriye Çuvalla"). Çuvalda ürünü olan müşteriler ayrı listelenir; **Sürdür** ile devam edilir.
2. Paketleme ekranı açılır. **Yeni Çuval** ile çuval açın (ya da **Top Okut** ile okutunca ilk çuval kendiliğinden açılır).
3. Çuvala top eklemek için **Top Okut** (barkod), **Listeden** (serbest depodaki toplar) ya da **Kartela** düğmesini kullanın.
4. Çuvalı tartın: kantar bağlıysa tartı otomatik gelir; değilse çuvalın ⋮ menüsünde **Elle kg gir**. Aynı menüde **Etiket bas**, **Not ekle** ve **Çuvalı sil** vardır; silinen çuvaldaki toplar depoya döner. Çuvala sonradan top eklenirse tartı sıfırlanır; yeniden tartın.
5. Yurtdışı sevkte tartı zorunludur; yurtiçinde fabrika ayarına bağlıdır. Eksik tartı varsa alt yazı "N çuval tartısız" der ve düğme kapalı kalır.
6. Sevk yönü (yurtiçi/yurtdışı) müşteri kartından gelir; ilk sevkte sorulursa seçiminiz karta yazılır.

## 8. Sevkiyat

Aynı **Sevkiyat** ekranının altındaki düğme fabrikada iki biçimden birinde çıkar:
- **Hemen Sevk Et (N)** — çuvallar doğrudan sevk edilir ("Sevk edildi").
- **Sevkiyat Kur (N)** — sevk onayı açık fabrikada sevkiyat "Planlı" olarak kurulur; malı kapıdan çıkarmak için ayrı bir adım vardır.

Planlı sevkiyatı çıkarmak: Bölüm Seçimi → **Sevk Çıkışı** (Sevkiyat ekranının üstündeki "N sevkiyat kapıda (kamyon bekliyor)" şeridinden **Sevk Çıkışı →** ile de gidilir).
1. Listede sevkiyatı bulun. İçeriği görmek için "içerik" düğmesine, çuval çıkarmak için içerik penceresine bakın.
2. Kartta **Sevk Et**'e basın; **Plaka**, **Şoför** ve isterseniz **Taşıyıcı (opsiyonel)** yazıp **Çıkışı Onayla**'ya basın. "Çıkış verildi" görünür.
3. Geçmiş sevkiyatlar: Sevkiyat ekranı → **Geçmiş**. Yanlış çuval için **Çuval Düzelt**.
4. Sevk geri alma ve iade panelden, yetkili kullanıcıyla yapılır; sevk rakamı her yerde iade düşülmemiş (brüt) görünür.

Faturalama panelde yapılır: Operasyon → **Sevkiyatlar (Muhasebe)** (sevkiyat okuma yetkisi gerekir; faturalama yetkisi yalnız Muhasebe/Süpervizör rolündedir).
