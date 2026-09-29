# TeksERP Son Kullanıcı Lisans Sözleşmesi

> **TASLAK — AVUKAT ONAYI BEKLİYOR.** Bu metin, kullanıcının 2026-09-29 lisanslama kararlarına göre Claude tarafından hazırlanmış bir taslaktır; hukuki görüş değildir. Avukat onayı olmadan imzaya, panele ya da müşteriye çıkmaz. `[DOLDURULACAK]` işaretli yerler ticari varsayım ya da eksik bilgidir; "öneri" diye verilen değerler bağlayıcı değildir.
>
> Metin kimliği: `SKLS-2026.1-taslak` · Kabul kaydında bu kimlik ve son metnin SHA-256 özeti tutulur (bkz. `KABUL-METNI.md`).

> **Türk hukuku: FSEK, TBK, KVKK, TCK 244 açısından avukat şu maddelere özellikle baksın**
> - **FSEK md. 48 ve 52 — şekil şartı:** mali haklara ilişkin sözleşme yazılı olmalı ve haklar ayrı ayrı gösterilmeli. Panelde "kabul ediyorum" demek (`KABUL-METNI.md`) bu şartı tek başına karşılar mı? Taslakta asıl sözleşme ıslak ya da güvenli elektronik imzalı (5070 md. 5) varsayıldı, panel kabulü yalnız TEYİT sayıldı. Doğru mu? (§3, §15)
> - **FSEK md. 38 — emredici istisnalar:** yedek kopya, gözlem/inceleme/test ve birlikte çalışabilirlik için kodun çözülmesi sözleşmeyle kaldırılabilir mi? §5.2'deki "kanunun emredici izinleri saklıdır" cümlesi yeterli mi?
> - **FSEK md. 72 — koruma önlemleri:** lisans denetimini, filigranı ya da bütünlük denetimini etkisiz kılmayı yasaklayan §5.1(e) ve §9 bu maddeye dayanabilir mi?
> - **FSEK md. 68 ve TBK md. 179–182 (TTK md. 22 ile birlikte):** lisans ihlalinde ceza koşulu konacak mı, tutarı ne olmalı? §12.3 boş bırakıldı.
> - **TBK md. 20–25 — genel işlem koşulları:** bu metin standart sözleşmedir. Yaptırım hükümleri (§8, `YAPTIRIM-MADDELERI.md`) karşı tarafın aleyhine "şaşırtıcı" sayılabilir mi? Taslakta bu hükümler için ayrı bilgilendirme ve ayrı kabul kutusu öngörüldü (`KABUL-METNI.md` kutu 2).
> - **TBK md. 115 — sorumsuzluk anlaşması:** §11'deki sorumluluk sınırı ağır kusuru kapsamıyor mu? Tavan ve dolaylı zarar istisnası geçerli mi?
> - **HMK md. 193 — delil sözleşmesi:** Lisans Veren'in imzalı elektronik kayıtlarını (yoklama, portal defteri, filigran) delil sayan §9.4 geçerli mi, karşı delil hakkı yeterince korunuyor mu?
> - **TCK md. 243–244:** lisans denetiminin çalışmayı kısıtlaması ("kısıtlı kip", "durdurulmuş") ve Lisans Veren'in uzaktan erişimi "sistemi engelleme" ya da "sisteme izinsiz girme" sayılabilir mi? Taslak her kademede verilere erişimi açık tuttu ve uzaktan erişimi Lisans Alan onayına bağladı (§8, `BAKIM-DESTEK-SOZLESMESI.md` §6). Bu önlemler riski ne ölçüde azaltır?
> - **KVKK:** lisans yoklaması iş ya da kişisel veri taşımaz (`VERI-ISLEME-EKI.md` Bölüm A); iş verisi taşıyan tek kanal, ayrı eki olan patron bulutudur (§12.2). Kabul kaydındaki ad-soyad ve destek talepleri kişisel veridir. Aydınlatma yükümlülüğü (md. 10) nasıl karşılanmalı?
> - **TMK md. 2 — hakkın kötüye kullanılması:** tek taraflı ve anında uygulanan K4 ve K5 kademeleri (`YAPTIRIM-MADDELERI.md` §4) bu açıdan savunulabilir mi?

---

## 1. Taraflar

- **Lisans Veren:** [DOLDURULACAK — Etkili Yazılım ticari ünvanı, MERSİS no, vergi dairesi/no, adres, KEP adresi]
- **Lisans Alan:** [DOLDURULACAK — müşteri ünvanı, MERSİS no, vergi dairesi/no, adres, KEP adresi]

Taraflar tacirdir. Bu sözleşme ticari iştir; tüketici mevzuatı uygulanmaz [avukat teyidi].

## 2. Tanımlar

| Terim | Anlamı |
|---|---|
| **Yazılım** | TeksERP sunucu yazılımı (backend), yönetim paneli (masaüstü uygulaması), saha uygulaması (tablet/telefon), bunların güncellemeleri, belgeleri ve kurulum araçları |
| **Kurulum** | Yazılımın sunucu bileşeninin bir bilgisayara ya da konteynere yapılmış, kendine ait kurulum kimliği ve kurulum anahtarı olan tek kopyası |
| **Tesis** | Lisans Belgesi'nde adı ve adresi yazılı fiziksel işletme |
| **Lisans Belgesi** | Lisans Veren'in anahtarıyla elektronik olarak imzalanan belge. Lisans Alan'ı, Tesis'i, Kurulum'u, lisans sınıfını, lisanslı modülleri, lisansın kalıcı olup olmadığını ve Bakım Bitiş Tarihi'ni gösterir |
| **Kullanım Onayı** | Lisans Veren sunucusunun belirli aralıklarla verdiği imzalı çalışma onayı. Varsayılan geçerlilik süresi 30 gündür; hiçbir onay 45 günden uzun olamaz |
| **Ek Süre** | Kullanım Onayı bittikten sonra yazılımın tam işlevle çalışmaya devam ettiği süre: **30 gün** |
| **Bakım** | `BAKIM-DESTEK-SOZLESMESI.md` kapsamındaki yıllık güncelleme ve destek hizmeti |
| **Bakım Bitiş Tarihi** | Lisans Belgesi'nde yazılı, bakım hakkının sona erdiği tarih |
| **Son Hak Edilen Sürüm** | Derleme tarihi Bakım Bitiş Tarihi'nden önce olan en son sürüm |
| **Lisans Portalı** | Lisans Veren'in lisans, kurulum, güncelleme ve destek kayıtlarını yönettiği sistem |
| **Kısıtlı Kip** | Verilerin okunabildiği, raporların, yeniden basımın, dışa aktarmanın ve yedeğin açık olduğu, yeni kayıt ve değişikliğin kapalı olduğu çalışma durumu (`YAPTIRIM-MADDELERI.md` §2) |
| **Durdurulmuş** | Olağan girişin kapalı olduğu, yalnız lisans ekranının ve "verilerimi al" kapısının açık olduğu durum (`YAPTIRIM-MADDELERI.md` §2) |
| **Makine Parmak İzi** | Kurulum'un yapıldığı makineye ait kimlik değerlerinden, Kurulum'a özel bir anahtarla üretilen tek yönlü özetler (§7.2) |

## 3. Sözleşmenin konusu ve şekli

3.1. Bu sözleşme, Yazılım'ın Lisans Alan tarafından kullanımına ilişkin basit (münhasır olmayan), devredilemez lisansın şartlarını düzenler.

3.2. Sözleşme yazılı olarak kurulur: ıslak imza ya da güvenli elektronik imza. Yazılımın ilk kurulumunda yönetim panelinde gösterilen kabul adımı (`KABUL-METNI.md`) bu sözleşmenin yerine geçmez. O adım, sözleşmenin o Kurulum'a uygulandığının ve yaptırım hükümlerinin ayrıca okunduğunun TEYİDİDİR [avukat: FSEK md. 52].

3.3. Lisans Belgesi bu sözleşmenin ekidir. Lisans Belgesi'ndeki modül, sınıf, Tesis ve tarih bilgileri bu sözleşmenin kapsamını belirler.

## 4. Verilen haklar

4.1. **Kalıcı kullanım hakkı.** Lisans Alan, Lisans Belgesi'nde "kalıcı" yazıyorsa Yazılım'ı süresiz kullanabilir. Bakım sona erse de Yazılım çalışmaya devam eder (§6).

4.2. **Vadeli hak.** Lisans bedeli taksitle ya da vadeli ödeniyorsa, ya da lisans deneme amaçlıysa, Lisans Belgesi ya da Kullanım Onayı bir **geçerlilik bitiş tarihi** taşıyabilir. Bu tarih her ödemeyle ileri alınır. Bedelin tamamı ödenince lisans kalıcıya çevrilir (`YAPTIRIM-MADDELERI.md` §5).

4.3. **Kurulum ve Tesis sınırı.** Lisans; bir Kurulum için, Lisans Belgesi'nde yazılı Tesis'te ve lisans sınıfının izin verdiği amaçla verilir. Aynı lisansla ikinci bir Kurulum yalnız §7 (taşıma) ve §10.3 (felaket kurtarma) çerçevesinde çalıştırılabilir.

4.4. **Sayı sınırı yoktur.** Kullanıcı, panel ve tablet cihazı, kayıt sayısı sınırlanmaz. Panel ve saha uygulaması, Tesis'in işi için yalnız lisanslı Kurulum'a bağlanmak üzere sınırsız cihaza kurulabilir.

4.5. **Modüller.** Lisans Alan yalnız Lisans Belgesi'nde yazılı modülleri kullanabilir. Lisansta olmayan bir modül, veritabanında elle açılsa bile yazılım tarafından kapalı tutulur. Yeni modül ek lisansla açılır [DOLDURULACAK: modül fiyat listesi].

4.6. **Yedek kopya.** Lisans Alan, kendi Kurulum'unun yedeğini ve arşiv kopyasını alabilir. Yedekten geri yükleme aynı Kurulum'da ya da §7 ve §10.3 çerçevesinde yapılır. Yedek kopya ikinci bir çalışan kurulum için kullanılamaz.

## 5. Yasaklar

5.1. Lisans Alan aşağıdakileri yapamaz, yaptıramaz ve bunlara izin veremez:

- (a) Yazılım'ı ya da bir parçasını bu sözleşmenin izin verdiği dışında çoğaltmak, ikinci bir çalışan kopya kurmak ya da kurulum dosyalarını üçüncü kişilere vermek;
- (b) Yazılım'ı tersine mühendislikle incelemek, kaynak koda ya da okunabilir koda çevirmeye çalışmak, parçalarına ayırmak, derlenmiş kodu değiştirmek;
- (c) Lisansı ya da Yazılım'ı satmak, kiralamak, devretmek, alt lisans vermek, rehin etmek ya da başka bir işletmenin (grup şirketleri dahil) işi için kullandırmak [avukat: grup şirketleri istisnası istenirse ayrı madde];
- (d) Yazılım'ı üçüncü kişilere hizmet olarak sunmak (barındırma, hizmet bürosu, dış kaynak);
- (e) Lisans denetimini, Kullanım Onayı'nı, Makine Parmak İzi'ni, bütünlük denetimini ya da filigranı (§9) etkisiz kılmak, atlatmak, taklit etmek; bunun için araç kullanmak ya da geliştirmek [avukat: FSEK md. 72];
- (f) Yazılım'daki lisans sahibi, lisans numarası, telif ve marka ibarelerini kaldırmak, değiştirmek ya da gizlemek;
- (g) Lisans Veren sunucusuna sahte, değiştirilmiş ya da başka bir Kurulum'a ait istek göndermek.

5.2. Kanunun emredici olarak izin verdiği işlemler (FSEK md. 38) saklıdır. Birlikte çalışabilirlik için bilgi gerekirse Lisans Alan önce Lisans Veren'den ister; Lisans Veren bu bilgiyi makul sürede verir [avukat].

## 6. Bakım bitince: son hak edilen sürüm

6.1. Bakım Bitiş Tarihi geçince Yazılım durmaz. Son Hak Edilen Sürüm ve daha önceki sürümler süresiz kullanılabilir.

6.2. Bakım bitince Lisans Alan'a yeni sürüm verilmez. Yazılım'ın güncelleme bağlantıları yeni sürüm indirmez; kurulum aracı, derleme tarihi Bakım Bitiş Tarihi'nden sonra olan sürümü kurmayı reddeder.

6.3. Bakım bitiş tarihinden sonra derlenmiş bir sürüm herhangi bir yolla kurulmuşsa Yazılım uyarı gösterir. Derleme tarihinden itibaren 30 gün Ek Süre işler; sonunda Kısıtlı Kip'e geçilir (`YAPTIRIM-MADDELERI.md` §3.3). Veritabanı yapısı yeni sürümle değiştiği için eski sürüme dönüş yalnız yedekten geri yüklemeyle mümkündür. Bu durumdan doğan veri kaybında Lisans Veren sorumlu değildir.

6.4. Lisans Veren, Son Hak Edilen Sürüm'ün kurulum dosyasını Bakım Bitiş Tarihi'nden sonra [DOLDURULACAK — öneri: 3 yıl] Lisans Portalı'ndan Lisans Alan'a özel bağlantıyla indirilebilir tutar.

6.5. Bakımın sonradan yeniden başlatılması `BAKIM-DESTEK-SOZLESMESI.md` §8'e tabidir.

## 7. Çevrimiçi lisans denetimi, kurulum bağı ve taşıma

7.1. **Yoklama.** Kurulum, Lisans Veren sunucusuna varsayılan olarak saatte bir bağlanır (HTTPS, dışarı doğru; kurumsal vekil sunucu desteklenir) ve yeni Kullanım Onayı alır. Bu bağlantıda gönderilen bilgiler **tek tek** `VERI-ISLEME-EKI.md` Bölüm A'da sayılmıştır. Yoklama iş verisi ve kişisel veri **taşımaz**.

7.2. **Makine bağı.** Kullanım Onayı, Kurulum'un anahtarına ve Makine Parmak İzi'ne bağlıdır. Parmak izi en çok beş değerden türetilir: işletim sistemi makine kimliği, donanım (SMBIOS) kimliği, sistem diski kimliği, sistem/anakart seri numarası, veritabanı küme kimliği. Ağ kartı adresi (MAC) ve işlemci kimliği **kullanılmaz**. Değerler Kurulum'a özel bir anahtarla tek yönlü özetlenir; ham değerler Lisans Veren'e gönderilmez. Ölçülemeyen değer uyuşmazlık sayılmaz. Değerlerin çoğu değişirse (örneğin sunucu değişimi) taşıma gerekir.

7.3. **İnternetsiz çalışma.** Bağlantı kesilirse Yazılım, son Kullanım Onayı'nın süresi ve ardından 30 günlük Ek Süre boyunca tam işlevle çalışır (varsayılan ayarlarla yaklaşık 60 gün). Bu sürede bağlantı kurulamazsa Lisans Alan, Kullanım Onayı'nı **panel bilgisayarı üzerinden aktarma** ya da **telefonla QR** yoluyla yenileyebilir. İnternet varken Yazılım zamanın geçmesi yüzünden kendiliğinden kısıtlanmaz; bu durumda kısıtlama yalnız Lisans Veren'in kararıyla olur.

7.4. **Lisans Alan'ın yükümlülüğü.** Lisans Alan, Kurulum'un en az [DOLDURULACAK — öneri: 30 günde bir] Lisans Veren sunucusuna ulaşabilmesini ya da §7.3'teki çevrimdışı yolların kullanılabilmesini sağlar.

7.5. **Taşıma.** Kurulum'un başka bir makineye taşınması (sunucu değişimi, disk ya da anakart değişimi dahil) **Lisans Veren'in onayıyla** yapılır. Talep panelden ya da Lisans Portalı'ndan açılır. Onay beklenirken yeni makine Ek Süre içinde çalışır. Onayla eski Kurulum'un Kullanım Onayı iptal olur. Lisans Veren makul bir taşıma talebini haklı sebep olmadan reddetmez ve talebi [DOLDURULACAK — öneri: 1 iş günü] içinde sonuçlandırır. Taşıma bedeli: [DOLDURULACAK — öneri: bakım süresinde yılda 2 taşıma ücretsiz].

7.6. **Aynı anda iki üretim kurulumu yasaktır.** Aynı lisansın iki Kurulum'da ileri taşındığı tespit edilirse (§9.3), eşleşmeyen tarafa yeni Kullanım Onayı verilmez ve o taraf Ek Süre'ye düşer. Kopya tespiti Yazılım'ı **anında durdurmaz**.

## 8. Lisans durumu ve yaptırımlar

8.1. Lisans geçersiz ya da ölçülemez hâle gelirse (örneğin belge bozuldu, makine bağı uyuşmuyor, bütünlük denetimi başarısız) Yazılım önce uyarır. İmzalı tarihten türeyen 30 gün Ek Süre sonunda Kısıtlı Kip'e geçilir. Geçerli lisans gelince durum **hemen** düzelir.

8.2. Ödeme gecikmesi, lisans ihlali ve olağan dışı hallerde Lisans Veren'in uygulayabileceği kademeler (K0–K5), ihtar süreleri, taksit ve planlı eylemler `YAPTIRIM-MADDELERI.md`'de düzenlenmiştir. O belge bu sözleşmenin ayrılmaz ekidir ve **ayrıca kabul edilir**.

8.3. **Veri erişimi her kademede açıktır.** Hiçbir kademe Lisans Alan'ın kendi verisini okumasını, yedeğini almasını ve dışa aktarmasını engellemez. Durdurulmuş durumda bile giriş ekranındaki "verilerimi al" kapısı, yönetici parolasıyla tam yedek ve dışa aktarma verir (`YAPTIRIM-MADDELERI.md` §6).

8.4. **Geçiş dönemi (gözlem kipi).** Lisans denetimi önce gözlem kipinde çalışır: durum hesaplanır ve Lisans Veren'e raporlanır, ama hiçbir istek engellenmez, uyarı bandı gösterilmez. Zorlama kipine geçiş Lisans Alan'a en az [DOLDURULACAK — öneri: 30 gün] önceden yazılı bildirilir.

## 9. Filigran, bütünlük ve kopya tespiti — beyan

Lisans Alan aşağıdaki koruma önlemlerini bildiğini ve kabul ettiğini beyan eder:

9.1. **Görünür filigran.** Yazılım'ın "Hakkında" ekranında lisans sahibi, lisans numarası ve sürüm yazar. Yazılım'ın ürettiği PDF belgelerin meta verisinde lisans numarası ve Kurulum bilgisi bulunabilir. Bu bilgiler Lisans Alan'ın kendi müşterilerine gönderdiği belgelerde de yer alabilir.

9.2. **Görünmez filigran ve bütünlük.** Sunucu yazılımı her Lisans Alan için ayrı derlenebilir ve Lisans Alan'a özgü, görünmeyen işaretler taşıyabilir. Kurulum dosyalarının listesi Lisans Veren tarafından imzalanır; Yazılım bu listeyi açılışta ve düzenli aralıklarla denetler. Uyuşmazlık §8.1'deki gibi işlem görür.

9.3. **Kopya tespiti.** Her yeni Kullanım Onayı bir öncekine bağlıdır (onay zinciri). Aynı zincirin iki farklı makinede ilerletilmesi Lisans Veren'e kopya şüphesi olarak görünür. Yedekten geri dönüş ya da ağ tekrarı gibi masum durumlar kopya sayılmaz. Kopya şüphesi önce yalnız Lisans Veren tarafında uyarı üretir; şüphe bir sonraki pencerede de sürerse §7.6 uygulanır.

9.4. **Delil.** Taraflar; Lisans Veren'in imzalı kayıtlarının (Kullanım Onayları, yoklama kayıtları, Lisans Portalı defteri, filigran eşleşmesi) bu sözleşmeden doğan uyuşmazlıklarda delil olarak kullanılabileceğini kabul eder. Karşı delil hakkı saklıdır [avukat: HMK md. 193].

9.5. Bu önlemler iş verisini okumaz, değiştirmez ve Lisans Veren'e göndermez.

## 10. Lisans sınıfları

Her Lisans Belgesi tek bir sınıf taşır:

10.1. **Üretim:** Tesis'in günlük işi. Patron bulutu gibi dışarıya veri gönderen ek hizmetler yalnız bu sınıfta açılabilir. Patron bulutu bu sözleşmeyle verilmez; ayrı hak (`patron-bulut`) ve ayrı imzalanan `PATRON-BULUTU-VERI-ISLEME-EKI.md` ile açılır (§12.2, Ek-6).

10.2. **Test / hazırlık:** Yalnız deneme, eğitim ve sürüm provası için kullanılır. Canlı üretim işlemi yapılamaz (gerçek sevkiyat, fatura ve tahsilat kaydı gibi). Üretim verisinin kopyasıyla test yapılırsa, bu kopyadaki kişisel verilerden Lisans Alan sorumludur.

10.3. **Felaket kurtarma (DR) / soğuk yedek:** Ana üretim sunucusu çalışmadığında devreye alınır. Devralma **self-servistir**: Lisans Alan devralmayı panelden başlatır ve Lisans Veren'e anında bildirim gider. Ana sunucu bir sonraki bağlantısında Kısıtlı Kip'e geçer ve "üretim DR sunucusunda" uyarısı gösterir. Böylece iki veritabanının ayrışması önlenir; ana sunucudaki verilere erişim açık kalır. Ana sunucuya geri dönüş §7.5'teki taşımayla yapılır. DR sınıfı, ana sunucu çalışırken üretimde kullanılamaz.

10.4. **Demo / deneme:** Süreli verilir, ticari üretimde kullanılamaz. Süre bitince Kısıtlı Kip'e geçilir; veriler dışa aktarılabilir.

10.5. **Bayi / iş ortağı:** Bayi sözleşmesiyle, Lisans Veren'in bayiye tanıdığı modül, sınıf ve adet sınırı içinde verilir. Son kullanıcıya karşı bu sözleşme uygulanır. Bayinin bu sınırı aşan vaadi Lisans Veren'i bağlamaz. Lisans Veren, bayinin verdiği lisansı gerektiğinde geri alabilir ya da doğrudan yönetebilir.

10.6. **Barındırılan:** Yazılım'ın Lisans Veren altyapısında çalıştırıldığı sınıftır. Şartları ayrı sözleşmede düzenlenir [DOLDURULACAK].

## 11. Garanti ve sorumluluk

11.1. Lisans Veren, Yazılım'ın teslimden itibaren [DOLDURULACAK — öneri: 90 gün] boyunca belgelerinde anlatılan temel işlevleri esas olarak yerine getireceğini taahhüt eder. Bu süredeki tek çare hatanın giderilmesi ya da ilgili parçanın yenilenmesidir. Sonrası Bakım kapsamındadır.

11.2. Lisans Veren; donanım, işletim sistemi, ağ, elektrik, üçüncü taraf yazılımları ve Lisans Alan'ın yedekleme yükümlülüğüne uymamasından doğan zarardan sorumlu değildir.

11.3. Lisans Veren'in bu sözleşmeden doğan toplam sorumluluğu, zarar anından önceki 12 ayda Lisans Alan'ın ödediği lisans ve bakım bedeliyle sınırlıdır [DOLDURULACAK — ticari karar]. Kâr kaybı, iş kaybı ve dolaylı zarar kapsam dışıdır. Kast ve ağır ihmal hâlleri saklıdır (TBK md. 115).

## 12. Fikri mülkiyet

12.1. Yazılım'ın, kaynak ve derlenmiş kodunun, belgelerinin ve Lisans Alan için yapılan özel geliştirmelerin bütün hakları Lisans Veren'dedir [avukat: özel geliştirme için ayrı hüküm istenirse]. Bu sözleşme yalnız §4'teki kullanım hakkını verir.

12.2. **İş verisi Lisans Alan'ındır.** Yazılım'a girilen ve Yazılım'ın ürettiği iş verisi (üretim, stok, sipariş, cari, finans, kullanıcı kayıtları) Lisans Alan'a aittir. Lisans Veren bu veriye yalnız `BAKIM-DESTEK-SOZLESMESI.md` §6'daki uzaktan erişimle ve Lisans Alan onayıyla ulaşır. Lisans Alan patron bulutu hizmetini açarsa, seçilmiş verinin okuma kopyası Lisans Veren'in bulut sunucusunda veri işleyen sıfatıyla tutulur; bu kopya da Lisans Alan'ındır ve `PATRON-BULUTU-VERI-ISLEME-EKI.md`'ye göre işlenir, saklanır ve imha edilir.

12.3. **Lisans ihlalinde tazminat:** [DOLDURULACAK — ceza koşulu olacak mı, tutarı; avukat: FSEK md. 68, TBK md. 179–182, TTK md. 22].

12.4. **Üçüncü taraf bileşenler.** Yazılım açık kaynak bileşenler içerir (örneğin çalışma zamanı ve veritabanı). Bu bileşenler kendi lisanslarına tabidir. Liste istek üzerine verilir.

## 13. Süre ve fesih

13.1. Kalıcı lisans süresizdir. Vadeli ve deneme lisansları kendi süreleriyle sınırlıdır.

13.2. Lisans Veren sözleşmeyi aşağıdaki hallerde feshedebilir:
- §5'teki yasakların ihlali: yazılı bildirimle, hemen;
- ödeme temerrüdü: `YAPTIRIM-MADDELERI.md` §5'teki ihtar süreleri dolduktan sonra;
- diğer esaslı ihlaller: yazılı bildirim ve [DOLDURULACAK — öneri: 30 gün] giderme süresinden sonra.

13.3. Fesih hâlinde Yazılım Durdurulmuş duruma alınabilir. "Verilerimi al" kapısı fesihten sonra da [DOLDURULACAK — öneri: en az 90 gün] açık kalır. Lisans Alan bu sürede verilerini alır.

13.4. Lisans Alan kullanımı istediği zaman bırakabilir. Ödenmiş bedelin iadesi: [DOLDURULACAK].

## 14. Bildirimler

Resmî bildirimler (ihtar, fesih) KEP ya da noter aracılığıyla yapılır. Yazılım içindeki uyarı bandı ve e-posta bilgilendirme amaçlıdır; tek başına ihtar yerine geçmez [avukat].

## 15. Uygulanacak hukuk ve yetki

Türk hukuku uygulanır. Uyuşmazlıklarda [DOLDURULACAK] mahkemeleri ve icra daireleri yetkilidir.

## 16. Ekler

- Ek-1: Lisans Belgesi (elektronik, imzalı)
- Ek-2: `YAPTIRIM-MADDELERI.md`
- Ek-3: `VERI-ISLEME-EKI.md`
- Ek-4: `BAKIM-DESTEK-SOZLESMESI.md` (bakım satın alınmışsa)
- Ek-5: Fiyat ve ödeme planı [DOLDURULACAK]
- Ek-6: `PATRON-BULUTU-VERI-ISLEME-EKI.md` ve ekleri (yalnız patron bulutu hizmeti satın alınmışsa; ayrı imzalanır)
