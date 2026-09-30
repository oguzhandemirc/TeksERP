# TeksERP Yıllık Bakım ve Destek Sözleşmesi

> **TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu metin bir taslaktır; hukuki görüş değildir. Tanımlar Son Kullanıcı Lisans Sözleşmesi (Lisans Sözleşmesi) §2'den alınır. `[DOLDURULACAK]` işaretli süre ve bedeller ticari varsayımdır; "öneri" değerleri bağlayıcı değildir.
>
> Metin kimliği: `BDS-2026.1-taslak` · Ek-4

> **Türk hukuku: FSEK, TBK, KVKK, TCK 244 açısından avukat şu maddelere özellikle baksın**
> - **TCK md. 243 ve 244 — uzaktan erişim:** Lisans Veren'in müşteri sunucusuna uzaktan bağlanması ancak rızayla hukuka uygundur. §6'daki onay, kayıt ve kapsam sınırı (yalnız TeksERP klasörleri) rızanın kapsamını yeterince belirliyor mu? Rıza bir kez mi verilmeli, yoksa her oturum için ayrı mı?
> - **KVKK md. 12 ve veri işleyen sıfatı:** destek ve uzaktan erişim sırasında Lisans Veren, müşterinin kişisel verilerini (personel, müşteri iletişim bilgileri) görebilir; bu sırada veri işleyen sıfatıyla davranır. Veri İşleme Eki (Ek-3) Bölüm B bu ilişkiyi yeterince düzenliyor mu?
> - **KVKK md. 9 — yurt dışına aktarım:** uzaktan erişim aracı Tailscale'in koordinasyon hizmeti yurt dışındadır. Trafik uçtan uca şifrelidir, ancak cihaz adı ve IP gibi meta veri yurt dışına gider. Bu aktarım için standart sözleşme ve Kurum'a bildirim gerekir mi?
> - **TBK md. 470 vd. (eser) ve md. 502 vd. (vekâlet):** bakım sözleşmesi hangi tipe girer (karma sözleşme)? Yanıt süreleri (§4) taahhüt mü, özen borcu mu? İhlal hâlinde yaptırım (bedel indirimi) konacak mı?
> - **TBK md. 115:** §9'daki sorumluluk sınırı, yedek kaybı gibi ağır sonuçlarda ağır kusuru dışlıyor mu?
> - **FSEK:** bakım süresinde verilen güncellemeler, Lisans Sözleşmesi'ndeki kalıcı hakka dahil mi? §3.3 bunu "dahil" diye yazdı.
> - **Kasada tutulan anahtarlar:** Lisans Veren'in müşteri yedeklerini açabilen anahtar ve parolayı saklaması (§7.3) sır saklama ve veri güvenliği açısından nasıl düzenlenmeli?

---

## 1. Taraflar ve konu

1.1. Taraflar Lisans Sözleşmesi'nin taraflarıdır. Bu sözleşme, Lisans Veren'in Lisans Alan'a vereceği yıllık güncelleme ve destek hizmetini düzenler.

1.2. Bakım, Lisans Sözleşmesi'nden ayrı olarak satın alınır. Bakım olmasa da Yazılım Son Hak Edilen Sürüm'de çalışmaya devam eder (Lisans Sözleşmesi §6).

## 2. Süre ve yenileme

2.1. Bakım bir yıl sürer. Başlangıç tarihi [DOLDURULACAK]; bitiş tarihi Lisans Belgesi'ndeki Bakım Bitiş Tarihi'dir.

2.2. Bakım, bitiş tarihinden [DOLDURULACAK — öneri: 30 gün] önce yazılı olarak aksi bildirilmezse, o yılın fiyat listesiyle bir yıl daha uzar [DOLDURULACAK — otomatik yenileme istenir mi]. Yenileme bedeli ödenince Lisans Veren yeni Bakım Bitiş Tarihi'ni Lisans Belgesi'ne yazar. Yeni belge Kurulum'a bir sonraki yoklamada kendiliğinden gelir.

2.3. Bakım bedeli: [DOLDURULACAK — öneri: lisans bedelinin yıllık %15–20'si].

## 3. Güncelleme hakkı

3.1. Bakım süresince Lisans Alan, lisanslı modüllerin bütün yeni sürümlerini (hata düzeltme, güvenlik, yeni işlev) ek bedel ödemeden alır. Yeni modüller ayrıca lisanslanır.

3.2. **Dağıtım yolu.** Güncellemeler yalnız Lisans Alan'ın kendi Kurulum'u üzerinden iner. Sunucu, Lisans Veren'den kısa ömürlü imzalı indirme izni alır; panel ve tablet güncellemeyi bu izinle çeker. Güncelleme adresleri kimliksiz indirmeye kapalıdır. İlk kurulum dosyası, Lisans Portalı'nda Lisans Alan'a özel, süreli ve indirme sayısı sınırlı bir bağlantıyla verilir.

3.3. Bakım süresinde alınan sürümler, bakım bittikten sonra da Lisans Sözleşmesi §4.1'deki kalıcı hakla kullanılır.

3.4. **Yayın düzeni.** Yeni sürüm önce Lisans Veren'in kendi test ortamında denenir, sonra Lisans Alan'ın üretimine çıkar. Lisans Alan'ın test sınıfı bir Kurulum'u varsa sürüm önce oraya verilebilir.

3.5. **Kurulum zamanı.** Sunucu güncellemesi Lisans Alan'la kararlaştırılan bir zamanda, **vardiya dışında** yapılır. Veritabanı yapısını değiştiren güncelleme geri alınamaz; geri dönüş yalnız güncelleme öncesi yedekten geri yüklemeyle olur. Bu yüzden her sunucu güncellemesinden önce otomatik yedek alınır. Panel ve tablet güncellemeleri kendiliğinden iner ve kullanıcı onayıyla ya da uygulamanın bir sonraki açılışında kurulur.

3.6. **Zorunlu güncelleme.** Sunucu ile eski panel ya da tablet sürümü birbiriyle çalışamaz hâle gelirse, Yazılım eski istemciden güncelleme ister. Lisans Veren bunu yalnız gerçek uyumsuzlukta kullanır.

3.7. K1 kademesi (Yaptırım Maddeleri, Ek-2, §2) uygulanırken güncelleme hakkı askıdadır. Askı süresi Bakım Bitiş Tarihi'ni uzatmaz [DOLDURULACAK].

## 4. Destek ve yanıt süreleri

4.1. **Kanallar:**
- Panelden destek talebi: ekran görüntüsü ve sağlık özeti eklenebilir. Gönderilmeden önce kullanıcıya gösterilir (Veri İşleme Eki, Ek-3, Bölüm A.4);
- telefon: [DOLDURULACAK];
- e-posta: [DOLDURULACAK].

4.2. **Destek saatleri:** [DOLDURULACAK — öneri: hafta içi 08:30–18:00; Öncelik 1 için 7/24 telefon].

4.3. **Öncelikler ve süreler** (hepsi [DOLDURULACAK]; öneri değerleri köşeli parantezde):

| Öncelik | Tanım | İlk yanıt | Çözüm ya da geçici çözüm hedefi |
|---|---|---|---|
| 1 — Üretim durdu | Sunucuya erişilemiyor; tabletten üretim girişi ya da sevkiyat yapılamıyor | [1 saat] | [8 saat] |
| 2 — Önemli işlev bozuk | Bir modül çalışmıyor ama üretim sürüyor | [4 iş saati] | [3 iş günü] |
| 3 — Küçük hata | Ekran hatası, geçici çözümü olan sorun | [1 iş günü] | [sonraki sürüm] |
| 4 — Soru, istek | Kullanım sorusu, geliştirme isteği | [2 iş günü] | [değerlendirme] |

4.4. Süreler, talebin Lisans Veren'e ulaştığı andan başlar. Lisans Alan'ın bilgi vermesi ya da erişim açması beklenirken süre işlemez.

4.5. **Kapsam dışı** (ayrı ücretlendirilir): donanım, işletim sistemi ve ağ arızaları; üçüncü taraf yazılımları; Lisans Alan'ın yaptığı değişiklik ya da müdahaleden doğan hatalar; yerinde destek [DOLDURULACAK — ücret]; özel geliştirme ve rapor; eğitim [DOLDURULACAK — ilk kurulumda X saat dahil].

## 5. Sağlık izleme

5.1. Kurulum, lisans yoklamasıyla birlikte bir sağlık özeti gönderir: son yedeğin yaşı, uzak yedek durumu, veritabanı boyutu, disk doluluğu, istemci sürümleri, hata sayaçları. Alanların tam listesi Veri İşleme Eki (Ek-3) Bölüm A'dadır. Bu özet iş verisi taşımaz.

5.2. Lisans Veren özeti izler ve bir risk gördüğünde Lisans Alan'ı uyarır: yedek alınmıyor, disk doluyor, sürümler dağınık gibi. Bu izleme bir özen yükümlülüğüdür; kesintisiz gözetim ya da sonuç taahhüdü değildir.

## 6. Uzaktan erişim

6.1. **Araç.** Uzaktan erişim Tailscale ile kurulan şifreli özel ağ üzerinden yapılır. Lisans Alan, Lisans Veren cihazlarının bu ağa katılmasına onay verir; onayı her zaman geri çekebilir. Başka bir araç [DOLDURULACAK] ancak iki tarafın yazılı mutabakatıyla kullanılır.

6.2. **Onay.** Lisans Veren sunucuya yalnız şu durumlarda bağlanır:
- (a) Lisans Alan'ın açtığı bir destek talebi ya da onayladığı planlı iş için;
- (b) Öncelik 1 durumunda Lisans Alan yetkilisinin sözlü ya da yazılı çağrısıyla.
Her bağlantı başlangıç ve bitiş saatiyle, yapılan işin özetiyle kayda geçer. Lisans Alan bu kaydı isteyebilir.

6.3. **Vardiya kuralı.** Fabrika çalışırken canlı sunucuda yalnız **tespit** yapılır (okuma, ölçüm, günlük inceleme). Düzeltme, yeniden başlatma, yama ve veri yazımı vardiya dışında, önceden bildirilerek ve Lisans Alan'ın onayıyla yapılır. Öncelik 1 durumunda ya da acil güvenlik açığında bu kuraldan Lisans Alan yetkilisinin onayıyla ayrılınabilir.

6.4. **Kapsam sınırı.** Lisans Veren yalnız TeksERP'in kurulum, yedek ve veritabanı klasörlerinde ve TeksERP servislerinde işlem yapar. Lisans Alan'ın diğer yazılımlarına, kullanıcı hesaplarına, uzak masaüstü ayarlarına ve ağ yapısına dokunmaz. Bunlarla ilgili bir önerisi olursa yazılı bildirir.

6.5. **Veri.** Uzaktan erişim sırasında görülen iş ve kişisel verilere ilişkin yükümlülükler Veri İşleme Eki (Ek-3) Bölüm B'dedir. Lisans Veren veriyi sunucudan dışarı çıkarmaz. Bir hatanın incelenmesi için veri gerekiyorsa önce Lisans Alan'ın yazılı onayını alır, gerekmeyen alanları çıkarır ya da anonimleştirir, inceleme bitince siler.

## 7. Yedek sorumluluğu

7.1. **Yazılım'ın sağladığı:** otomatik gece yedeği; her sunucu güncellemesinden önce yedek; isteğe bağlı uzak (makine dışı) yedek; yedek şifreleme. Şifreli yedek en fazla üç alıcıyla açılabilir: sunucudaki yerel anahtar (yedek parolasıyla), Lisans Alan anahtarı (USB ve kâğıt) ve Lisans Veren anahtarı (çevrimdışı). Panelde yedek durumu ve uyarılar görünür.

7.2. **Lisans Alan'ın yükümlülükleri:**
- (a) Sunucu donanımını, diskleri ve uzak yedek hedefini (bulut hesabı, ikinci disk ya da Lisans Veren'in uzak yedek hizmeti) sağlamak [DOLDURULACAK — uzak yedek hedefi kimin hesabında];
- (b) yedek parolasını ve Lisans Alan anahtarını güvenli iki ayrı yerde saklamak;
- (c) panelde ve sağlık uyarılarında görülen yedek sorunlarını gidermek ya da Lisans Veren'e bildirmek;
- (d) [DOLDURULACAK — öneri: yılda bir] Lisans Veren'le birlikte bir test geri yüklemesi yapmak.

7.3. **Lisans Veren'in yükümlülükleri:**
- (a) Yedek mekanizmasını çalışır tutmak ve kurulumda doğrulamak;
- (b) sağlık özetinde yedek yaşı eşiği aşıldığında Lisans Alan'ı uyarmak;
- (c) kendi kasasında tuttuğu Lisans Veren anahtarını ve yedek parolasını gizli tutmak. Bunları yalnız Lisans Alan'ın yazılı talebiyle ya da §6.2(b)'deki acil durumda Lisans Alan'ın veri kurtarması için kullanır. Her kullanım kayda geçer ve Lisans Alan'a bildirilir.

7.4. Yedeğin alınmaması, saklanmaması ya da parolanın kaybından doğan veri kaybında sorumluluk, kusuru olan taraftadır. Lisans Veren'in sorumluluğu §9 ile sınırlıdır.

## 8. Bakımın sona ermesi ve yeniden başlatılması

8.1. Bakım sona erince güncelleme ve destek durur. Yazılım Son Hak Edilen Sürüm'de çalışmaya devam eder. Lisans denetimi (yoklama) sürer, çünkü kalıcı lisansın geçerliliği için gereklidir.

8.2. Bakım sona erdikten sonra verilen destek, o günün saatlik ücretiyle yapılır [DOLDURULACAK].

8.3. Bakım, ara verilen dönemden sonra yeniden başlatılabilir. Bunun için ara verilen döneme ait bakım bedeli ya da [DOLDURULACAK — öneri: yeniden başlatma bedeli] ödenir. Bu kural sektörde yaygındır; amacı yalnız ihtiyaç anında bakım alınmasını önlemektir.

## 9. Sorumluluk

Lisans Veren'in bu sözleşmeden doğan toplam sorumluluğu, zarar anından önceki 12 ayda ödenen bakım bedeliyle sınırlıdır [DOLDURULACAK]. Kâr kaybı ve dolaylı zarar kapsam dışıdır. Kast ve ağır ihmal hâlleri saklıdır (TBK md. 115).

## 10. Fesih

10.1. Taraflardan biri, esaslı ihlalde yazılı bildirim ve [DOLDURULACAK — öneri: 30 gün] giderme süresinden sonra bu sözleşmeyi feshedebilir.

10.2. Bu sözleşmenin sona ermesi Lisans Sözleşmesi'ni sona erdirmez.

## 11. Uygulanacak hukuk ve yetki

Lisans Sözleşmesi §15 uygulanır.

## 12. Patron bulutu

12.1. Patron bulutu (fabrika verisinin okuma kopyasının Lisans Veren'in bulut sunucusunda tutulması ve "TeksERP Patron" uygulamasıyla gösterilmesi) bu sözleşmenin konusu değildir. Ayrı hakla (Patron Bulutu hakkı) ve ayrı imzalanan Patron Bulutu Veri İşleme Eki (Ek-6) ile açılır [DOLDURULACAK — ticari model: ayrı abonelik mi, bakıma dahil mi].

12.2. Patron bulutu bakıma dahil satılırsa bakımın sona ermesi (§8) patron bulutunu da sona erdirir: eşitleme durur, dışa aktarma ve imha Saklama ve İmha Prosedürü (Ek-6/A) §4'e göre yapılır. Yazılım'ın kendisi Son Hak Edilen Sürüm'de çalışmaya devam eder; fabrika verisi etkilenmez.

12.3. Patron bulutuna ilişkin destek taleplerinde Lisans Veren'in bulut kopyasına erişimi Teknik ve İdari Tedbirler (Ek-6/B) §3'e, güvenlik ihlali Veri İhlali Bildirim Prosedürü'ne (Ek-8) tabidir.
