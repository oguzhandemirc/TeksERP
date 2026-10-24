# ERP boşluk analizi — karar belgesi

> Tarih: 2026-10-24 · Durum: patron kararları (G1–G3) uygulanmış karar belgesi.
> Girdiler: G-R1 yetenek haritası (`origin/main` @ `8bd9fa6b8`), G-R2 pazar/mevzuat araştırması (29 aday, ön puan), patron oturumu kararları G1–G3. Çelişkide patron kararı geçerlidir.
> Bu belge modül planı DEĞİLDİR; her modülün planı ayrı `docs/design/<MODUL>-PLAN.md` belgesinde yazılır (§5).

---

## §0 · İstek ve yöntem

**Kullanıcının isteği (aynen):**

> "bizim erp de olmayan ama genelde erp lerde olan bir çok özellik ve modül olabilir. bunları tespit et. bunların hangilerini eklemeliyiz ? hangileri tekstil fabrikaları için önemli olabilir bunu hesaplamasını yap. gerekenler için tek tek planlama yap ve tam entegre ekleme yap. örneğin vardiya yönetimi, izin yönetimi, maaş yönetimi, maaliyetlendirme gibi şeyler olabilir. bu dediğim şeyleri ben şu an düşünerek yazdım bunlar gerçekten bir modül olabilecek kadar büyük mü veya bizim program içinde olmalımı ben bilmiyorum. örnek için yazdım. sen araştırmanı yap ve projelendir."

**Yöntem.** İki bağımsız araştırma yapıldı:

1. **G-R1 "biz neyiz":** depo ölçülerek TeksERP'in bugünkü yetenekleri alan alan çıkarıldı (180 model, 105 + 9 route dosyası, ~35 rapor, 138 izin kodu, 19 tablet modülü, 10 modül anahtarı).
2. **G-R2 "pazar ne yapıyor":** Türk ve küresel ERP'ler (Logo, Netsis, Mikro, Canias4.0, Odoo, Business Central…), tekstile özel yazılımlar (Datatex, TexTREME, Teksdata, Teknosol, Egemen, Datacolor) ve Türkiye mevzuatı tarandı. Sonuçta 29 aday modül/özellik çıktı.

Adaylar 7 ölçütle 1–5 arası puanlandı. Puanlar ağırlıklandırıldı; en yüksek toplam 65'tir ve 100'e normalize edildi. Patron oturumu bu puanları benimsedi ve üç düzeltme yaptı (G1, §2'de işaretli).

| Kod | Ölçüt | Ağırlık | 5 ne demek |
|---|---|---|---|
| D | Tekstil fabrikasına değer | ×3 | Günlük operasyonu/kârı doğrudan etkiler |
| Y | Yasal zorunluluk / uyum baskısı | ×2 | Yapılmazsa ceza veya iş durur |
| R | Satışta rekabet etkisi | ×2 | Demoda "bu var mı?" diye sorulur, yoksa elenirsiniz |
| V | Mevcut veriye dayanma | ×2 | Gereken verinin çoğu TeksERP'te zaten doğuyor |
| M | Geliştirme maliyeti (ters) | ×1,5 | Ucuz (≤2 hafta-insan) |
| E | İçeride olma gerekliliği (ters entegrasyon) | ×1,5 | Olgun dış alternatif yok ya da veri bizde doğduğu için dışarıda yapmak çift giriş demek |
| B | Bakım/mevzuat riski (ters) | ×1 | Mevzuat değişimine duyarsız, bakımı düşük |

**Puanlama ilkesi.** Bir zorunluluk fabrikanın olabilir ama bizim olmayabilir. Bordro ve genel muhasebe Y=5 aldığı halde düşük puanlıdır, çünkü fabrika bu zorunluluğu zaten başka programla karşılıyor. e-İrsaliyede ise belge TeksERP'te (sevk anında) doğuyor. Bu yüzden zorunluluk doğrudan bize düşüyor.

---

## §1 · TeksERP bugün

TeksERP, top merkezli bir **üretim yürütme + depo + sevkiyat sistemidir (MES + WMS + sevkiyat)**. Üstünde ön muhasebe, lisanslı dağıtım ve patron bulutu var. Modellerin ~%40'ı "nasıl doğru yazılır" altyapısıdır: defter, kimlik, belge, numara, audit, lisans, eşitleme. Yeni bir modül bu altyapıyı hazır devralır: atomik claim, ters kayıt, idempotency, modül kapısı, izin, audit, numara serisi, donmuş belge, bulut projeksiyonu.

| Alan | Olgunluk | Not |
|---|---|---|
| Top defteri, izlenebilirlik | derin | Doğuştan sevke her adım, bölme, fire, iptal, ters kayıt |
| İş emri, rota, parti, refakat, kurşun, tambur | derin | Tablette eldivenli kullanım |
| Dokuma, devere, tezgah izleme, vardiya OEE | derin | 25 model, en hızlı büyüyen alan |
| Sevkiyat, çuval, fason | derin | Brüt tek kaynak, storno ≠ iade |
| Kalite (KK1/KK2, hata haritası, sınıf) | derin / iyi | Hatanın uzunluğu ve puanı yok |
| Yetki, güvenlik, belge/etiket/numara, ana veri, lisans | derin | SoD, TOTP, audit hash zinciri |
| Ön muhasebe (cari, fatura kaydı, kasa/banka, çek, dönem kapanışı) | iyi / derin | Referans profilde kapalı |
| Satınalma + mal kabul, çoklu depo + sayım, iplik kg defteri | iyi | Talep/onay yok, raf/lokasyon yok |
| Raporlama (~35 rapor), patron uygulaması | iyi / derin | — |
| Bildirim | iyi (yalnız tezgah alarmı) | Genel iş olayı bildirimi yok |
| CRM, fiyat listesi, kapasite, MRP, terbiye, entegrasyon | temel | Cari kart; tarihsiz fiyat; yalnız dokuma kapasitesi; net ihtiyaç ekranı; fason terbiye; TCMB + Excel + cihazlar |

**Güçlü yanlar:** (1) top defteri ve izlenebilirlik, (2) üretim yürütme, (3) dokuma/tezgah izleme, (4) sevkiyat ve fason, (5) platform altyapısı.

**Hiç olmayanlar:** maliyetlendirme · İK (personel kartı, PDKS, izin, bordro, prim) · bakım/CMMS · enerji/su/çevre · kimyasal/sarf stoğu · teklif/sözleşme · laboratuvar/boya reçetesi/lab dip · 4 puan muayene · şikâyet/CAPA · planlama panosu · muhasebe yazılımı, banka ve kargo entegrasyonu · e-posta/SMS.

**Bilinçli kapsam dışı (bugüne kadar):** genel muhasebe (hesap planı, yevmiye, mizan, bilanço), e-belge ("ERP fatura KESMEZ", SAAS-TASARIM A5), konfeksiyon (2026-09-11), iç boyahane defteri (hedef kitle perde, boyahane fason), çok kiracılı SaaS.

**İK ve maliyet için veri zemini:**
- Miktar tarafı zengin. Kimin hangi topu hangi adımda ne kadar sürede işlediği, kaç metre çıktığı ve tezgahın vardiya OEE'si büyük ölçüde VAR (`RollMovement`, `WorkSession`, `MachineShiftStat`).
- Para tarafı yalnız alış ve satış uçlarında var.
- Personel kartı, giriş-çıkış, ücret, oran, enerji ve sarf tüketimi YOK.
- `User` bir oturum hesabıdır, personel kartı değildir. Tablet kullanmayan işçinin kaydı yoktur.

---

## §2 · Aday modüller ve puanlar

Karar etiketleri: **YAP-Faz1 / YAP-Faz2 / Faz3 / ENTEGRE ET / YAPMA**. "Patron düzeltmesi" = G1 kararı. "(çıkarım)" = KARARLAR'da adı geçmeyen aday. Bunlarda etiket, G-R2 ön kararından ve G2 faz mantığından türetildi; patron onayına açıktır.

| # | Aday | Kısa açıklama | Puan | Karar | Gerekçe |
|---|---|---|---|---|---|
| 1 | e-İrsaliye | Sevkten UBL-TR e-İrsaliye XML'i, entegratör bağdaştırıcısı | 92 | **YAP-Faz1** (E-IRS) | Belge TeksERP'te doğar; hedef fabrikaların hemen hepsi mükellef. |
| 2 | Kalite: 4 puan + lab + muayene raporu + sertifika | ASTM D5430 puanlama, test kaydı, rapor, sertifika süresi | 80 | **YAP-Faz1** (K4P) | Perde/döşemelikte alıcı raporu ister; veri büyük ölçüde var. |
| 3 | BI genişletme | Maliyet/kalite KPI'ları patron panosuna | 78 | **YAP-Faz1/2, modül içi** (çıkarım) | Ayrı iş değildir; K4P ve MAL yüzeylerini patron uygulamasına taşır. |
| 4 | e-Fatura / e-Arşiv | Faturayı entegratöre gönderme, tevkifat | 77 | **YAPMA (şimdilik)**, *patron düzeltmesi* | "ERP fatura kesmez" kararı (2026-09) sürer; ileride yeniden değerlendirilir. |
| 5 | Maliyet M0+M1 | Teklif hesaplayıcı + standart maliyet | 74 | **YAP-Faz1** (MAL), *patron düzeltmesi* | 5, 6 ve 7 tek paket "Maliyet & Teklif" oldu; üçü de aynı veriyi kullanır. |
| 6 | Satış teklifi + fiyat listesi | M0'ın satış yüzü, teklif belgesi | 72 | **YAP-Faz1** (MAL), *patron düzeltmesi* | MAL paketinin parçası. |
| 7 | İplik ihtiyaç planı | Açık sipariş → çözgü/atkı kg ihtiyacı, stokla karşılaştırma | 72 | **YAP-Faz1** (MAL), *patron düzeltmesi* | MAL paketinin parçası. |
| 8 | Verim primi | Randıman eşiği → TL tablosu | 72 | **YAP-Faz2** (PER alt özelliği), *patron düzeltmesi* | Ayrı modül değildir; kişi ↔ tezgah ataması ister. |
| 9 | Bakım (CMMS) + kalibrasyon | Makine kartı, periyodik plan, arıza iş emri, yedek parça | 71 | **YAP-Faz2** (BAK) | Duruş kodları zaten ölçülüyor. |
| 10 | Personel & Puantaj | Personel kimliği, kartlı PDKS, vardiya ataması | 71 | **YAP-Faz2** (PER) | KVKK 2026/921 sonrası kart/PIN'e geçiş; altyapı bizde var. |
| 11 | Numune/kartela derinleştirme | Numune gönderimi → sipariş dönüşüm oranı | 70 | **Faz3** (çıkarım) | Modül zaten var; derinleştirme acil değil. |
| 12 | APS / tezgah planlama (Gantt) | Tezgah × zaman plan tahtası | 68 | **Faz3** | Önce görsel tahta, sonra sonlu kapasite; maliyeti yüksek. |
| 13 | Sarf/yedek parça/kimyasal stoğu | `ItemType.CONSUMABLE` defteri | 66 | **YAP-Faz2** (BAK içinde) | Bakımın yedek parça şartı; sarf ve kimyasal aynı defteri kullanır. |
| 14 | Müşteri portalı | Sipariş durumu, sevk belgesi, muayene raporu | 66 | **Faz3** | Gelen port kuralı nedeniyle bulut üzerinden olmalı. |
| 15 | Satınalma talep/onay/teklif | PO öncesine talep ve onay katmanı | 65 | **Faz3** (çıkarım) | Alt özellik; Faz1–2 kapasitesine girmiyor. |
| 16 | İhracat: proforma + çeki listesi | Sevk verisinden ihracat belgeleri | 64 | **Faz3** (çıkarım); ATR/EUR.1/menşe **ENTEGRE ET** | Menşe belgeleri gümrük müşaviri ve birlik sisteminde kalır. |
| 17 | WMS raf/adres + döngüsel sayım | Lokasyon ve döngüsel sayım | 62 | **Faz3** (çıkarım) | Alt özellik. |
| 18 | Maliyet M2 (parti/iş emri fiili) | Gerçek tüketim, fiili maliyet fotoğrafı | 61 | **Faz3** (çıkarım) | M0'dan sonra gelir; iplik çıkışında değer ister (L). |
| 19 | İzin yönetimi | Yıllık izin hakkı, talep/onay | 58 | **YAP-Faz2** (PER içinde) | Puantajın "eksik gün nedeni"ni besler. |
| 20 | Sertifikalı lot / DPP / karbon | AB dijital ürün pasaportu hazırlığı | 54 | **Faz3** | Fiili uyum 2028+; top soy ağacı temel olarak var. |
| 21 | Enerji izleme | Sayaç okuma → maliyete bağ | 52 | **Faz3** | M0'da sabit katsayı yeter. |
| 22 | Doküman eki (DMS-lite) | Kayda dosya ekleme | 52 | **Faz3** (çıkarım) | PER'deki özlük dosyası ilk kullanım olur. |
| 23 | Genel muhasebe / e-Defter | Hesap planı, yevmiye, berat | 51 | **ENTEGRE ET** | Muhasebe programının işi; biz muhasebe fişi aktarırız. |
| 24 | İSG / eğitim-sertifika takibi | Eğitim ve muayene son tarihleri | 49 | **YAP-Faz2** (PER alt özelliği) + OSGB **ENTEGRE ET** | Asıl kayıt OSGB/İSG-KATİP'te; biz yalnız son tarih uyarısı veririz. |
| 25 | Bordro | Brüt-net, GV, SGK, MUHSGK | 48 | **ENTEGRE ET** | XL boy, mevzuatı sürekli değişir; PER aktarım dosyası üretir. |
| 26 | CRM pipeline | Fırsat hattı | 46 | **Faz3** | KARARLAR G2 "teklif CRM fırsat hattı" (G-R2 "ertele" demişti). |
| 27 | Bütçe | Gelir/gider bütçesi | 44 | **YAPMA (şimdilik)** (çıkarım) | Değeri düşük; G-R2 "ertele". |
| 28 | Sabit kıymet | Demirbaş, amortisman | 40 | **ENTEGRE ET** | Muhasebe işi; BAK makine kartı yeter. |
| 29 | Boyahane reçete / lab dip / spektro | Reçete motoru, dozaj | 36 | **ENTEGRE ET** (gerekirse) | Hedef kitlede boyahane fason; gerekirse Datacolor vb. ile bağlanır. |

---

## §3 · Örneklerinize doğrudan cevap

Verdiğiniz dört örnek aynı büyüklükte değil. Kısa cevap şöyle:

**Vardiya yönetimi: ayrı modül değil, "Personel & Puantaj"ın parçası.**
- Programda vardiya tanımı zaten var, ama yalnız tezgahlar için. Hangi vardiyada hangi kişinin çalıştığı bilinmiyor.
- Eksik olan, kişiyi vardiyaya, salona ve tezgaha atamak.
- Atama eklenince tezgah karnesi kişiye bağlanır ve verim primi hesaplanabilir hale gelir.
- Vardiya tek yerde tanımlanır: tezgah vardiyası ile personel vardiyası aynı kayıttır.

**İzin yönetimi: küçük bir alt özellik, yine "Personel & Puantaj" içinde.**
- Yıllık izin hakkını hesaplamak basittir.
- İzin talebi ve onayı puantajdaki "neden gelmedi" sorusunu cevaplar.
- Tek başına modül olacak kadar büyük değildir.

**Maaş (bordro): yapmıyoruz, aktarıyoruz.**
- Bordro tek başına bir üründür. Logo bile onu ayrı satar (Bordro Plus).
- Gelir vergisi dilimleri, asgari ücret, SGK ve teşvikler yılda bir iki kez değişir. Hata maliyeti işçi alacağı ve cezadır.
- Küresel ERP'ler bile Türkiye bordrosunu kendisi yapmaz.
- Bizim işimiz temiz veri vermek: puantaj, fazla mesai, izin ve prim. Bunları fabrikanın kullandığı bordro programının biçiminde (Logo/Mikro/Luca) dosya olarak çıkarırız.

**Maliyetlendirme: gerçek bir modül, ilk sıradakilerden.**
- Tekstil yazılımlarının neredeyse hepsi bunu vitrinde ilk sırada gösterir.
- Bizde gereken verinin çoğu hazır: çözgü spesifikasyonu, tezgah devri, randıman, ölçülmüş çekme, iplik alış fiyatı.
- Kademeli kurulur:
  - Önce "bu kumaşı metresi kaça verirsem kâr ederim" teklif hesaplayıcısı (M0).
  - Sonra ürün başına standart maliyet (M1).
  - En son iş emri bazında fiili maliyet (M2, Faz3).
- Teklif belgesi, fiyat listesi ve iplik ihtiyaç planı aynı veriyi kullandığı için tek paket olarak ilerler: "Maliyet & Teklif".

**Özetle:** vardiya + izin + puantaj + verim primi birlikte orta boy TEK bir modül eder. Maaş dışarıda kalır. Maliyet kendi başına modüldür.

---

## §4 · Türkiye mevzuatı ve tutumumuz

> ⚠ **Eşik ve ceza tutarları mali müşavirle doğrulanmalı.** Aşağıdaki tutarların çoğu entegratör ve müşavir bloglarından alındı; GİB veya Resmî Gazete metni doğrudan okunmadı.

| Gereksinim | 2026 durumu (kaynağa göre) | Tutumumuz |
|---|---|---|
| **e-İrsaliye** | e-Fatura mükellefi + brüt satış hasılatı ≥10 M TL. Tekstil özel kapsamda değil. Belge başına özel usulsüzlük cezası 2026'da ~17.000 TL olarak aktarılıyor ⚠ | **İçeride yap (Faz1).** İrsaliye sevk anında, bizim verimizden doğar. Başka programda yeniden yazmak çift giriş ve hata kaynağıdır. |
| **e-Fatura** | Brüt satış hasılatı ≥3 M TL → izleyen yıl 1 Temmuz'da geçiş ⚠ | **Şimdilik yok.** Fatura muhasebe programında kesilir. Bizde dış numara izi kalır (`Invoice.externalNo`, `Shipment.invoiceNo`). |
| **e-Arşiv** | 2026'dan itibaren tutar sınırı kalktı ⚠ | e-Fatura ile aynı tutum. |
| **e-Defter** | e-Fatura mükellefi + bilanço esası; takvimde kaynaklar çelişkili ⚠ | **Yapma.** Muhasebe fişi aktarımı (Faz2/3 alt işi). |
| **Fason KDV tevkifatı** | Fason tekstilde kısmi tevkifat; güncel oran ⚠ | Fatura kaydı tevkifatı zaten taşıyor. e-Fatura gündeme gelirse tevkifat kodu gerekir. |
| **SGK** (işe giriş/çıkış, MUHSGK/APHB) | Her işveren için zorunlu | **Yapma.** Bordro programı veya müşavir yürütür. |
| **Bordro parametreleri** | 2026: asgari ücret brüt 33.030 TL; GV %15–40; damga ‰7,59; SGK işçi %14 + işsizlik %1 ⚠ | **Yapma, aktar** (§6). |
| **KVKK 2026/921 ilke kararı** (29.04.2026, RG 02.06.2026) | Mesai takibinde parmak izi/yüz/iris **açık rızayla bile hukuka aykırı**. Kart, PIN, RFID/NFC veya imza kullanılmalı. | **Biyometrik YOK.** Puantaj kart/PIN ile yapılır; HMAC'li kart kodu ve quickPin altyapısı hazır. Personel verisi ayrı izin ve saklama politikası ister; minimum veri ilkesi uygulanır, sağlık verisi tutulmaz. |
| **İSG** (6331) | Eğitim periyodu: çok tehlikeli yılda 1, tehlikeli 2 yılda 1, az tehlikeli 3 yılda 1. Yeni eğitim yönetmeliği 2 Nisan 2026 ⚠ | **Hafif alt özellik** (PER): son tarih uyarısı. Asıl kayıt OSGB/İSG-KATİP'te. |
| **Enerji (5627)** | Yıllık ≥1000 TEP tüketen sanayi işletmesi için yükümlülük | Salt dokuma çoğunlukla bu eşiği aşmaz. Faz3'te raporlama yardımı. |
| **AB DPP / ESPR** | Yetki devri 2027'nin 2. yarısında bekleniyor, fiili uyum 2028+. CBAM tekstili kapsamaz. | Faz3 hazırlık; top soy ağacı zaten var. |

**İlke notu.** e-İrsaliye kararı, SAAS-TASARIM A5'teki "resmi belge müşterinin yazılımında doğar" ilkesini irsaliye için daraltıyor. Patron kararına göre iki karar çelişmez, çünkü irsaliye fatura değildir. Yine de karar notu arşive yazılmalı ve `kurallar/`a kural satırı eklenmelidir. Ayrıca MODUL-BAYRAK §11 "mevzuat bayraklanmaz" der, G3 ise "her yeni modül bayraklı" der. Bu ayrımı E-IRS plan yazarı netleştirmeli.

---

## §5 · Yol haritası

**Ortak kurallar (G3):**
- Her modülün ayrı plan belgesi `docs/design/<MODUL>-PLAN.md` olur. Dilim istemleri `scratchpad/erp/<MODUL>/istemler/` altına yazılır. Plan yazarı Opus high'dır (Fable yok).
- Her modül kendi modül anahtarını alır (`<modul>.enabled`). Anahtar kapalıyken route düzeyinde 403 `MODULE_DISABLED` döner.
- Varsayılan **KAPALI**dır, yani bugünkü davranış korunur. Deneme profilinde açılır. Liste genişletilirken `docs/kurallar/modul-bayrak.md` reçetesi uygulanır.
- Kaba büyüklükler G-R2'nin S/M/L/XL ölçeğindendir. G-R2'de boy etiketi verilmeyen yerde yalnız maliyet ölçütü (M, 1–5) yazıldı.

**Paralel işlerle ilişki:**
- **Bildirim işi:** izin kataloğu, ayarlar ve bildirim türleri bildirim işiyle ortak dosyalara dokunur. Sıralama dosya çakışmasına göre yapılır.
- **Belge tasarımcısı:** yeni belge türleri (teklif, muayene raporu, e-İrsaliye görüntüsü) veri sözleşmesi kataloğuna eklenir. K4P ve MAL'ın belgeleri belge tasarımcısının **T0** dilimi (veri sözleşmesi kataloğu) bitince yazılır.
- **e-İrsaliye XML'i** belge tasarımcısından **bağımsızdır**, çünkü makine okunur belgedir.

### Faz 1 (şimdi; bildirim ve belge işleriyle paralel)

**1. e-İrsaliye (E-IRS).** Maliyet ölçütü 3/5, G-R2'de boy etiketi yok.

v1 kapsamı:
- Sevkiyattan GİB uyumlu UBL-TR 1.2 e-İrsaliye XML'i üretilir ve doğrulanır.
- XML dışa aktarılır; fabrika entegratör portalına elle yükler.
- Durum ve ETTN elle kaydedilir.
- Entegratör bağdaştırıcı **arayüzü** ve test/simülasyon bağdaştırıcısı yazılır. Tek entegratöre kilitlenilmez; akış: üret → gönder → durum sorgula → yanıt/red.
- Numara GİB biçimindedir (seri + yıl + sıra) ve mevcut `number_series` tablosundan çıkar.

v2 kapsamı: gerçek entegratör API bağdaştırıcıları. Kullanıcı entegratörü seçip test hesabı verdiğinde başlar. Entegratöre yalnız giden HTTPS ve polling kullanılır; gelen port açılmaz.

Bağımlılıklar:
- Sevkiyat alanı.
- `Shipment.invoiceNo` tek alandır ve "bir sevk = bir fatura" varsayımı taşır. Bu e-Fatura için sorundur, e-İrsaliye için değildir.

**2. Kalite 4 puan (K4P).** G-R2 boyu: M.

Kapsam:
- ASTM D5430 4 puan muayenesi. `RollError`a hata uzunluğu ve puan eklenir. Puan top başına ve 100 m² başına hesaplanır.
- Hata kataloğu ve kalite derecesi (A/B/C) kuralı.
- Muayene raporu belgesi (belge tasarımcısına bağlanır).
- Lab test kayıtları elle girilir: haslık, çekme, gramaj. Müşteri spesifikasyonu da kaydedilir.
- Sertifika süresi takibi (OEKO-TEX vb.), bildirim sistemine yeni tür olarak eklenir.
- Tablette KK1/kalite istasyonu için endüstriyel arayüz.

Bağımlılıklar: belge tasarımcısı T0; bildirim türleri.

**3. Maliyet & Teklif (MAL).** G-R2 boyu: M0 M + M1 S–M + iplik ihtiyaç planı M.

Kapsam:
- **M0 teklif hesaplayıcı:** çözgü/atkı iplikleri, sıklık, çekme, fire, işçilik/makine saat oranı, enerji payı, genel gider ve kâr girdi olur, metre fiyatı çıkar. Teklif sürümlüdür ve donar.
- **M1 standart maliyet:** ürün başına.
- **Satış teklifi ve fiyat listesi** (teklif belgesi).
- **İplik ihtiyaç planı:** açık siparişlerden çözgü/atkı iplik kg ihtiyacı çıkar ve stokla karşılaştırılır.
- **Eksik veri girilecek:** atkı ipliği kalemi ve tesis parametreleri (saat oranları, enerji birim fiyatı).
- **Görünürlük:** maliyet ve kâr ayrı izinle görülür; tablet operatörü maliyet görmez. Patron uygulamasına giden maliyet alanlarını fabrika hesaplar, bulut hesap yapmaz (finans sınıfı).

Bağımlılıklar:
- `WarpSpec`, `YarnStock`/`YarnLot`, açık siparişler.
- Belge tasarımcısı T0 (teklif belgesi için).

### Faz 2

**4. Personel & Puantaj (PER).** G-R2 boyu: orta boy tek modül (bileşenler: puantaj M–L, vardiya M, izin S–M, prim S–M, özlük S, eğitim S).

Kapsam:
- **Personel kartı:** kullanıcıdan ayrı bir kimliktir ve kullanıcı hesabına bağlanabilir ("kimlik ≠ rol"). Mevcut operatör kullanıcılarının taşınması planlanır.
- **Vardiya ataması:** kişi vardiyaya atanır. Vardiya tanımı tezgah vardiyasıyla aynı kayıttır, tek kaynak.
- **Puantaj:** kart/PIN ile giriş-çıkış (biyometrik yok), puantaj ve fazla mesai. Kart okuyucunun donanım polling'i backend'e girmez.
- **İzin:** talep, onay ve yıllık izin hakkı.
- **Verim primi:** eşik tablosuyla hesaplanır; formül dili yazılmaz. İlk müşterilerden gerçek prim tablosu toplanmalıdır.
- **Bordro aktarımı:** Logo/Mikro/Luca biçiminde dosya.
- **Alt özellikler:** özlük dosyası, eğitim/İSG sertifika takibi.
- **KVKK:** personel verisi ayrı izin ve saklama politikasıyla korunur.

Bağımlılıklar: `ShiftDefinition`/`ShiftInstance`, `WorkSession`, `MachineShiftStat`; bildirim türleri.

**5. Bakım (BAK).** G-R2 boyu: M.

Kapsam:
- Makine kartı mevcut `Machine` modelidir. Periyodik bakım planı ona bağlanır.
- Arıza kaydı dokuma duruş defterine (`MachineStopEvent`) bağlanır.
- Bakım iş emri.
- Yedek parça stoğu için `ItemType.CONSUMABLE` defteri açılır; sarf ve kimyasalla ortak kullanılır.
- Kalibrasyon takibi (tartı, ölçüm cihazı).
- Bildirim türleri.

Bağımlılıklar: dokuma duruş defteri, bildirim.

**Muhasebe aktarımı (Faz 2/3 alt işi):** satış, alış, tahsilat ve fason hareketleri muhasebe fişi olarak dışa aktarılır. Bugünkü "Sevk Edilenler" Excel aktarımının gelişmiş halidir.

### Faz 3

| İş | G-R2 boyu |
|---|---|
| Tezgah planlama panosu (Gantt/APS hafif) | M–L |
| Enerji/su sayaç okuma → maliyete bağ | — |
| Teklif CRM fırsat hattı | — |
| Müşteri/tedarikçi portalı (bulut üzerinden) | M |
| Sürdürülebilirlik/DPP hazırlığı | — |
| Maliyet M2/M3 (çıkarım) | L |
| Satınalma talep/onay, ihracat proforma/çeki listesi, WMS raf, numune derinleştirme, doküman eki, BI genişletme (çıkarım) | — |

---

## §6 · Yapmayacaklarımız ve aktarım biçimleri

| Alan | Neden yapmıyoruz | Biz ne veriyoruz |
|---|---|---|
| **Bordro** | XL boy, mevzuatı sürekli değişir, hata maliyeti yüksek, pazarda olgun çözüm var | PER'den puantaj, fazla mesai, izin, prim ve avans; Logo/Mikro/Luca biçiminde aktarım dosyası |
| **Genel muhasebe, e-Defter** | Mali müşavir modeli yerleşik; berat ve beyanname muhasebe programının işi | Muhasebe fişi aktarımı (satış, alış, tahsilat, fason) |
| **Sabit kıymet** | Muhasebe işi | BAK makine kartı (operasyonel) |
| **e-Fatura / e-Arşiv (şimdilik)** | "ERP fatura kesmez" kararı | Fatura kaydı ve dış numara izi (bugünkü dış mod) |
| **Boyahane lab / spektrofotometre / dozaj** | Donanıma bağlı uzman alan; hedefte boyahane fason | Gerekirse iş emri ↔ reçete no ↔ lab onayı senkronu (Datacolor vb.); reçete motoru yazılmaz |
| **ATR / EUR.1 / menşe** | Gümrük müşaviri ve birlik sistemi | (Faz3) proforma ve çeki listesi verisi |
| **İSG asıl kayıtları** | OSGB/İSG-KATİP | Son tarih uyarısı |
| **SGK bildirimleri** | Bordro programı veya müşavir | — |
| **Bütçe (şimdilik)** | Değeri düşük (44) | — |

---

## §7 · Kullanıcının veto edebileceği kararlar

Aşağıdaki kararlar patron oturumunda alındı. Kullanıcı bunları onaylayabilir ya da geri çevirebilir:

1. **e-İrsaliye v2 için entegratör seçimi ve test hesabı** kullanıcıdan gelir. v1 elle yükleme ile çalışır.
2. **e-Fatura şimdilik dışarıda kalır.** Fatura muhasebe programında kesilmeye devam eder.
3. **Bordro yapılmaz.** Yalnız aktarım dosyası üretilir.
4. **Biyometrik puantaj olmaz** (KVKK 2026/921). Kart/PIN kullanılır.
5. **Yeni modül bayrakları varsayılan kapalı başlar.** Bugünkü kurulumlarda davranış değişmez; deneme profilinde açılır.
6. **Eşik ve ceza tutarları** (e-İrsaliye 10 M TL, e-Fatura 3 M TL, ~17.000 TL ceza, bordro parametreleri, tevkifat oranı) **mali müşavirle doğrulanmalıdır.**

---

## §8 · Kaynaklar

**e-Belge:**
- [Sovos – e-İrsaliye 10 M TL](https://sovos.com/tr/blog/kdv/e-irsaliye-uygulamasina-zorunlu-gecis-siniri-10-milyon-tl-oldu/)
- [Sovos – e-Fatura sınırı](https://sovos.com/tr/blog/kdv/e-faturaya-zorunlu-gecis-siniri-4-milyon-tl/)
- [Finrota – 2026 / VUK 589](https://finrota.com/blog/2026-e-fatura-zorunluluk-limitleri-ve-gecis-rehberi)
- [Paraşüt – 2026 e-Arşiv](https://www.parasut.com/blog/e-fatura-ve-e-arsiv-zorunlulugu)
- [Paraşüt – e-Defter](https://www.parasut.com/blog/e-fatura-mukellefleri-icin-e-defter-zorunlulugu)
- [Faturaport – e-İrsaliye](https://faturaport.com/blog/e-fatura/2027de-e-irsaliye-zorunlulugu-kimleri-kapsiyor-guncel-rehber)
- [Faturaport – maliyetler](https://faturaport.com/blog/e-fatura/e-fatura-hizmet-maliyetleri-nelerdir-2026-guncel-rehber)
- [Bakı Çelik – 2026 limitleri](https://bakicelik.com/gundem/1-temmuz-2026-e-fatura-e-irsaliye-gecis-zorunlulugu-limitleri)
- [GİB sirküleri 49 (eski tevkifat örneği)](https://www.alomaliye.com/2007/07/06/katma-deger-vergisi-sirkuleri-49/)

**İK / KVKK / İSG:**
- [KVKK 2026/921 – Alo Maliye](https://www.alomaliye.com/2026/06/02/mesai-takibinde-biyometrik-veri-islenmesine-yeni-ilke-karari-kvkk/)
- [Milliyet](https://www.milliyet.com.tr/teknoloji/kvkkdan-isverenlere-uyari-parmak-izi-ve-yuz-tanimayla-mesai-takibi-bitiyor-mu-7598095)
- [muhasebetr – 2026 bordro](https://www.muhasebetr.com/yazarlarimiz/musacakir/013)
- [Kolay İK – puantaj](https://kolayik.com/puantaj)
- [Cottgroup – puantaj cetveli](https://cottgroup.com/tr/blog/calisma-hayati/item/puantaj-ve-puantaj-cetveli-nedir)
- [Cottgroup – İSG eğitim yönetmeliği](https://cottgroup.com/en/legislation/item/yeni-isg-egitim-yonetmeligi-yayimlandi-is-yerlerini-bekleyen-kritik-yenilikler)
- [ÇSGB tekstil İSG rehberi](https://live.csgb.gov.tr/Media/5qdnbvi1/tekstil-sektoerü-isgys-rehberi-by-25-09-2024.pdf)
- [Logo Bordro Plus](https://cdn.logo.com.tr/files/logocomtr/Uploads/Documents/logo-bordro-plus-tanitim-brosuru-tr.pdf)

**ERP katalogları:**
- [Business Central modülleri](https://erpresearch.com/en-us/dynamics-365-business-central-modules-list)
- [Odoo Maintenance](https://odoo.com/app/maintenance)
- [Odoo PLM](https://www.odoo.com/app/plm)
- [Canias – Capterra](https://www.capterra.com/p/51528/CANIAS-ERP/)
- [Uyumsoft – Eroğlu Giyim](https://uyumsoft.com/haber/eroglu-giyim-uyumsoft-web-erpyi-tercih-etti)

**Tekstil yazılımları:**
- [Datatex](https://datatex.com/why-datatex-erp-is-the-ultimate-choice-for-textile-manufacturing/)
- [SoftwareConnect – Datatex](https://softwareconnect.com/reviews/datatex-now-erp/)
- [Ekstrem TexTREME](https://ekstrem.com.tr/textreme-tekstil-erp-yazilimi)
- [Teksdata TPM](https://www.teksdata.com/urun-detay/textile-production-management/1)
- [Teknosol](https://teknosol.com.tr/tekstil-erp/)
- [Egemen Boyahane](https://www.egemenyazilim.com/boyahane)
- [Datacolor Textile Lab Manager](https://www.datacolor.com/wp-content/uploads/2024/06/Textile-Lab-Manager-Spec-Sheet-EN.pdf)
- [Datacolor Weigh](https://www.datacolor.com/business-solutions/product/weigh/)
- [Practica](https://practica.com.tr/)
- [Avakoza](http://yazevi.com/tekstil-erp.html)
- [OSOFT](https://www.osoft.com.tr/)
- [Online Clothing Study](https://www.onlineclothingstudy.com/2017/01/inventory-management-and-control.html)

**Kalite / maliyet / bakım:**
- [V-Trust – 4 puan](https://blog.v-trust.com/understanding-the-4-point-system-for-fabric-inspections)
- [Uludağ – dokuma maliyet faktörleri](https://acikerisim.uludag.edu.tr/items/cf903779-5645-4140-95f0-07901bb1c366)
- [SlideShare – maliyet dağılımı](https://www.slideshare.net/slideshow/costing-73395103/73395103)
- [Uludağ – döşemelik verimlilik](https://acikerisim.uludag.edu.tr/handle/11452/19932)
- [İTÜ – tekstilde prim sistemi](https://polen.itu.edu.tr/items/c4fd14fa-f3b8-4864-b322-488e7750e0a2)
- [Oxmaint – tekstil CMMS](https://oxmaint.com/industries/manufacturing-plant/textile-manufacturing-plant-maintenance-cmms-2026)

**Sürdürülebilirlik / enerji:**
- [Renoon – DPP](https://www.renoon.com/blog/delegated-acts-for-digital-product-passport-explainer-and-current-status)
- [ABİGEM – enerji verimliliği](https://www.butso.org.tr/belgeler/2025_Sunular/Enerji_verimliligi_Sektorel_Yukumlulukler-20251002%20-_ABIGEM.pdf)

**İç belgeler:**
- `docs/design/SEKTOR-YOL-HARITASI.md`
- `docs/design/TICARET-PAKETI-TASARIM.md`
- `docs/design/MODUL-BAYRAK-TASARIM.md` (§11)
- `docs/design/DOKUMA-ALARM-VE-YOL-HARITASI.md` (§B)
