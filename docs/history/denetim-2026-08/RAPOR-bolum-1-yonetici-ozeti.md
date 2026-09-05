# Bölüm 1 — YÖNETİCİ ÖZETİ

**Denetim tarihi:** 2026-08-28 / 29 · **Denetlenen:** TeksERP fabrika yazılımının sunucu tarafı (tümü) ve ona bağlı tablet/masaüstü sözleşmeleri · **Yöntem:** salt-okunur — hiçbir dosya değiştirilmedi, hiçbir kayda yazılmadı.

---

## 1.1 Kapsam ve tarih — ne bakıldı, ne bakılmadı

Fabrika yazılımının kayıt tutan tarafı (top girişi, iş emri, kurşun/kalite, tambur, fason, depo, çuval, sevkiyat, sipariş, yetki, yedek ve kurulum) baştan sona incelendi. İnceleme dört ayrı turda yapıldı: **① kodun kendisi okundu**, **② üretimin 2026-08-25 tarihli kopyası üzerinde gerçek kayıtlar sayıldı**, **③ gerçek fabrika akışları (bir topun girişten müşteriye kadar yolculuğu) uçtan uca izlendi**, **④ sınır durumlar (gün dönümü, sayaç sonu, ağ kopması, elektrik kesintisi) zorlandı**. Bulguların her biri, onu bulan kişiden bağımsız ikinci bir kişi tarafından "bu gerçekten hata mı" diye çürütmeye sokuldu; çürütmeden geçemeyen 24 gözlem rapordan atıldı, 111 gözlemin ise ağırlığı düşürüldü. Kopyada yaklaşık **24.900 kayıt** tarandı (2.431 top, 213 iş emri, 278 sipariş, 40 sevkiyat, 10.485 denetim kaydı; sistem 2026-07-16'da kurulduğu için elimizde **40 günlük** gerçek veri var) ve ölçümlerin doğrulanabilmesi için kullanılan bütün sorgular rapora eklendi.

**Bakılamayanlar açıkça yazılmıştır ve sonuçları etkiler:** ① **canlı sunucuya erişim olmadı** — bütün sayılar 25 Ağustos kopyasından; son üç günün verisi hiç görülmedi. ② Kopya, yazılımın en son beş güncellemesini taşımıyor; sipariş/kalem iptali konusu bu yüzden yalnız geliştirme ortamında ölçülebildi. ③ Sunucudaki gerçek yedek ayarları, gerçek kurulum dosyası ve gece yedeğini alan görev dosyası okunamadı — yedekle ilgili her cümle dolaylı kanıta dayanıyor. ④ Yazılımın kendi 366 kontrol scripti bu denetimde **çalıştırılmadı** (salt-okunur kural). ⑤ Beş iş akışı (şube bazlı sevk, doğrudan fason sevki, kartela, 2. kalite stoğu, yarı mamul) sahada bugüne kadar **hiç kullanılmamış**; o alanların canlı davranışı görülmedi.

---

## 1.2 Genel risk değerlendirmesi

> **HÜKÜM: Sistem çekirdeğinden çürük değil; iyi kurulmuş ve ölçülerek geliştirilmiş bir yazılım, ama kendi koyduğu doğru kuralları her yerde uygulamıyor ve bir şey ters gittiğinde bunu kimseye söylemiyor — bugünkü en büyük risk hata yapması değil, hatasını sessizce yapması.**

**Gerekçe iki taraflı ve ikisi de ölçüldü:**

| Sağlam olan | Ölçüm |
|---|---|
| Siparişe yazılan sevk rakamlarının kendi içinde tutarlılığı | 281 ve 278 kalemde **0 sapma** |
| İrsaliye rakamlarının kuralına uygunluğu | **39 / 39** belge doğru |
| Numara sayaçları (top barkodu, sipariş, iş emri, çuval no) | 38 sayaçta **0 mükerrer, 0 boşluk** |
| Topun kökeni (nereden geldi, kimin çocuğu) | 2.431 topun tamamında tutarlı |
| Ad/kod eşleştirmesi (müşteri, kumaş, fason) | 17 tabloda **0 sapma** |
| Denetim kayıtlarında şifre/sır sızıntısı | 10.485 kaydın hepsinde **0** |
| Aynı anda iki kişinin aynı işi yapmasına karşı korumalar | 60'tan fazla noktada doğru kurulmuş; kuralın kendisi kodun içine gömülü ve ihlali **0** |

| Zayıf olan | Ölçüm |
|---|---|
| Bir işlem yarıda kalırsa kimsenin haberi olmaması | 6 ayrı arıza dedektörü veri üretiyor, **hiçbirini hiçbir ekran göstermiyor**; sistemin sağlık göstergesi her koşulda "iyi" yazıyor |
| Sevk edilen malın siparişe yazılmasının ayrı bir kapısının olmaması | 23 sevkiyatta toplam **7.200,6 m** açık |
| Gece yedeğinin çalıştığını doğrulayan bir mekanizma olmaması | 40 günde defterde **1** gece yedeği kaydı |
| Fabrikaya çıkan yazılım sürümünün otomatik testten geçmemesi | **140 değişiklik, 33 veritabanı güncellemesi, 67 yeni kontrol** hiç otomatik koşmadı |
| Doğru kuralın 1-3 noktada uygulanmamış olması | 243 bulgunun büyük çoğunluğu bu sınıfta — yeni kural gerekmiyor, mevcut kuralın yayılması gerekiyor |

**Rakamlarla tablo:** dört turda 353 ham gözlem üretildi; birleştirme ve çürütme sonrası **243 bulgu** ayakta kaldı (24'ü elendi). Ağırlık dağılımı: **13 çok ciddi (S1) · 53 ciddi (S2) · 120 orta (S3) · 57 düşük (S4)**. Bunların **91'inde ihlal sahada fiilen ölçüldü** (yani "olabilir" değil, "olmuş"); 82'sinde mekanizma açık ama henüz tetiklenmemiş. Tamamının düzeltilmesi **190,65 gün-adam** iş; acil kısmı **36 gün-adam** (2 kişiyle ~2 hafta).

---

## 1.3 En kritik beş bulgu

**1) Müşteriye giden mal siparişten düşülmüyor** — `BULGU-T2-001`, `T3-002`, `T3-003`
Paketleme ekranında çuval içeriğinin rengi/eni sipariş kaleminde yazandan farklıysa (örn. sipariş "55-BEYAZ", çuvalda "EKRU"), sistem **hiçbir uyarı vermeden** malı sevk eder ama sipariş defterine tek satır yazmaz. Ayrıca tabletten kurulan sevkiyatta sipariş seçme adımı hiç yok — **tabletten çıkan her sevkiyat** defter dışıdır. Sonuç: planlamacı "bu siparişte 3.700 m açık" görüp aynı malı yeniden ürettirir.
**Ölçüm:** 23 sevkiyatta toplam **7.200,6 m** açık; bunun **5 sevkiyatı (81 top · 3.040,2 m · 3 müşteri) tamamen defter dışı**; **7 sipariş kalemi bugün hâlâ "0 sevk"** görünüyor.
**Düzeltme:** kod tarafı **5,5 gün** · geçmiş 7.200,6 m'nin siparişlere yazılması ayrı bir iş ve satış+muhasebe onayı ister.

**2) Gece yedeğinin durduğunu kimse görmüyor** — `BULGU-T1-024`, `T1-020`
Yedek alınamazsa hiçbir ekran, e-posta veya uyarı doğmuyor; üstelik her yazılım kurulumu sunucudaki yedek ayarlarını paketin içindeki boş değerlerle **eziyor** — yani güncelleme yaptığınız gece yedek alınmamış olabilir. Bir disk arızasında geri dönülebilecek en yeni nokta bir günlük veri kaybı demektir (o günün top girişleri, tambur kararları, sevkiyatları).
**Ölçüm:** 40 günlük defterde **1** gece yedeği kaydı; 7 yedek kaydı "**dış kopya ayarlanmadı**" uyarısıyla yazılmış.
**Düzeltme:** **3,5 gün** (çoğu sunucu tarafı iş, yazılım değişikliği değil).

**3) Stok metrajı sessizce bozulabiliyor** — `BULGU-T1-001`, `T1-002`, `T1-044`
Bir operatör Tambur'da topu keserken başka biri aynı topu "Düzelt" ekranından güncellerse, sistem ikisini sıraya sokmadığı için ikinci yazım birincisini eziyor: laboratuvar denemesinde **100 m'lik top sistemde 140,5 m** oldu (10 denemenin 10'unda tekrarlandı). Ters yönde de olabilir; o zaman satılabilir mal sistemden kaybolur.
**Ölçüm:** 2 top bugün canlı olarak **giriş metrajından fazla** görünüyor (492 → 698,9 m ve 500 → 520,5 m) ve ikisi de hâlâ üretimde; ayrıca aşım defterinde 37 satır / 382,1 m var ve hatanın kendi izini silmesi yüzünden hangisinin gerçek olduğu ayırt edilemiyor.
**Düzeltme:** **3,5 gün** + veritabanına "metraj giriş metrajını aşamaz" kuralının konması.

**4) İptal edilmiş top geri alınarak olmayan mal yaratılıyor** — `BULGU-T1-011`
Tambur'da bir kesim geri alındığında kesilen parça iptal edilir ve metrajı ana topa geri döner. Ama o iptal edilen parça "İptali Geri Al" ile **yeniden canlandırılabiliyor** — metraj bir kez ana topta, bir kez de dirilen parçada, yani aynı kumaş iki kez sayılıyor. Bu mal siparişe taahhüt edilir ve ancak fiziksel sayımda ortaya çıkar (sistemde sayım modülü yok).
**Ölçüm:** bugün kopyada **50 top / 1.834,8 m** bu şekilde diriltilebilir durumda.
**Düzeltme:** **3,0 gün**.

**5) Tüm ERP 6 haneli bir sayıya bağlı, yöneticiler dahil** — `BULGU-T1-014`, `T2-012`
Giriş için PIN tek başına yeterli ve deneme sınırlaması ayarı sistemde hiç tanımlı değil; fabrika ağına bir gün erişen biri deneme yaparak hesap ele geçirebilir. Ayrıca 24 yetki satırı panel üzerinden değil, doğrudan veritabanına yazılmış — kim verdi belli değil ve "sevkiyatı geri alma" gibi hassas yetki bu yolla **6 kişide**.
**Ölçüm:** 8 aktif kullanıcının **8'inde** PIN var, **3'ü yönetici**; fiili saldırı izi arandı, bulunmadı (30 günde 62 başarısız / 184 başarılı giriş).
**Düzeltme:** **4,5 gün** + hangi yetkinin kimde kalacağına dair yönetim kararı.

---

## 1.4 Veride tespit edilen fiili tutarsızlıklar

Aşağıdaki her satır üretimin 25 Ağustos kopyasında **sayılarak** bulundu — tahmin yok.

| Ne bulundu (düz Türkçe) | Rakam | Bulgu |
|---|---|---|
| Sevk edilen 27.611,8 m malın **7.152,6 m'si hiçbir siparişten düşülmemiş**; 5 sevkiyat hiç defter satırı yazmamış | 7.200,6 m fark · 81 top | `T2-001` |
| Açık iş emirlerinde **iptal edilmiş toplar hâlâ "üretilmiş" sayılıyor** (kapanmış iş emirlerinde 5.148,0 m daha var, ekran süzgeci gizliyor) | 1.506,9 m · 31 top | `T1-080` |
| **230 iptalin 134'ünde** kim iptal etti / ne zaman yazmıyor; 230'unun hiçbirinde sebep kodu yok; 126'sında iptal öncesi durum boş → "geri al" o topları **yanlış rafa** döndürür | 134 / 230 | `T1-033` |
| Topların durum değişikliklerinin **%22'si hiçbir denetim izi bırakmıyor** — "bu topa ne oldu" sorusu cevaplanamıyor | 535 / 2.392 | `T2-029` |
| İade defteri "depoya alındı" diyor ama toplar iptal durumunda: mal ne stokta ne fire raporunda | 261 m · 5 iade | `T2-023` |
| Depoda kesilen 8 ana topun giriş metrajı sıfırlanmış → geçmişe dönük hesap tutmuyor, **2 sahte aşım alarmı** üretiyor | 185,7 m izsiz | `T2-016` |
| 2 top **giriş metrajından fazla** görünüyor, ikisi de üretimde | 2 top | `T1-044` |
| Kaynağı belli olmayan yetki satırları; "sevkiyatı geri alma" bu yolla 6 kişide | 24 satır | `T2-012` |
| İptal edilmiş 227 topun tekrar-gönderim anahtarı hâlâ canlı — tablet aynı fişi yeniden gönderirse sunucu "başarılı" der ve iptal edilmiş topun numarasını verir | 227 top | `T1-006` |
| 42 refakat kartında **basılmadığı hâlde "basıldı" damgası** var | 42 kart | Bölüm 11, O-12 |
| Harf farkıyla **mükerrer stok kodu** grupları (aynı kumaş iki kod) | 8 grup | Bölüm 7, K-10 |
| 4 bitmiş top hiçbir dönem karnesine girmiyor (üretim rakamları o kadar eksik) | 359 m | Bölüm 11, O-2 |
| Hiç metrajı olmayan ama "canlı" görünen hayalet top | 2 top | Bölüm 7, K-5 |

**Bunların ne kadarı hâlâ üretiliyor?** İptal izi eksikliği 5 Ağustos'tan 21 Ağustos'a kadar **kesintisiz** sürüyor; sevk defteri açığı **son 8 güne yığılmış ve hızlanıyor**; sahte basım damgası 25 Ağustos'ta doğan 4 kartın 4'ünde var. Buna karşılık metraj aşımının kod hatası 10 Ağustos'ta düzeltilmiş — ama düzeltmeden **5 gün sonra ikinci bir ihlal doğmuş ve 13 gün fark edilmemiş**. Bu tek olay, raporun ana tezini özetliyor: nokta düzeltmesi yetmiyor, kalıcı kapı gerekiyor.

---

## 1.5 Öncelikli aksiyon listesi

### BU HAFTA
1. **Fabrika, verilen 12 salt-okunur kontrol sorgusunu canlı veritabanında koşsun** — özellikle "hiç sipariş defteri yazılmamış sevkiyat" sorgusu; kopyada 5 çıkıyor, canlıda kaç olduğunu bilmiyoruz. *(Sorumlu: Ops + Yazılım)*
2. **Gece yedeğinin ve dış kopyanın fiilen çalıştığı sunucu üzerinde doğrulansın**, doğrulanana kadar günlük elle yedek alınsın. *(Sorumlu: Ops)*
3. **Yönetici yetkisi taşıyan 3 hesaptan PIN kaldırılsın**, giriş şifreyle yapılsın. *(Sorumlu: Yönetim + Ops)*
4. **Sevkiyatın siparişe yazılmadan çıkmasını engelleyen kapı geliştirilmeye başlansın** (geçiş döneminde engel değil uyarı olarak). *(Sorumlu: Yazılım — Backend + tablet)*
5. **Otomatik test paketi, fabrikaya çıkan sürümün dalına bağlansın ve kırmızı kontroller yeşile çekilsin.** *(Sorumlu: Yazılım/Ops)*

### BU AY (acil paket — 12 kalem, 36 gün-adam, 2 kişiyle ~2 hafta + tampon)
6. **Metraj yazımının sıraya sokulması** ve topun aynı anda iki yerden değiştirilememesi. *(Yazılım)*
7. **İptal edilmiş kesim parçasının diriltilememesi** ve iptal izinin tek noktadan yazılması. *(Yazılım)*
8. **Fasondaki malın iş emri iptalinde ham stoğa düşmemesi**; fason kabulünde aynı fişin iki kez işlenememesi. *(Yazılım + tablet)*
9. **Tabletten düşen top girişinin operatöre duyurulması** — bugün sessizce kayboluyor. *(Yazılım/Mobil)*
10. **Geçmiş 7.200,6 m'nin hangi siparişlere yazılacağına karar verilip düzeltilmesi** — otomatik düzeltme yok, kayıt kayıt onay ister. *(Sorumlu: Satış + Muhasebe, Yazılım destekli)*
11. **Gecelik mutabakat ve alarm mekanizması** — "sevk edilen mal ile siparişten düşülen mal uyuşuyor mu" sorusunu her gece soran ve uyuşmuyorsa bağıran mekanizma. Denetimdeki en yüksek getirili tek kalem. *(Yazılım)*

### BU ÇEYREK
12. **Rapor rakamlarının tek hesap kaynağına çekilmesi** — bugün aynı büyüklük (üretilen metraj, sevk edilen metraj, açık talep) birden fazla yerde ayrı ayrı hesaplanıyor; 22 bulgu bu sınıfta. *(Yazılım)*
13. **Denetim izinin tamamlanması** — bugün top durum değişikliklerinin %22'si iz bırakmıyor. *(Yazılım)*
14. **Mükerrer stok kodu/ad temizliği ve ardından veritabanı seviyesinde mükerrer engelinin açılması** — birleştirme geri alınamaz, önce fabrika onayı. *(Sorumlu: Üretim/Satış onayı + Yazılım)*
15. **Kullanılmayan üç özellik hakkında karar** — kurşun dağıtımı (117 kapanışın 115'i makine bilgisiz), refakat kartı (213 kartın 149'u güncel değil ve kart sahada hiç okutulmuyor), çuval tartısı (40 çuvalın 39'u tartısız). Bunlar "düzeltilecek hata" değil, **"kullanılacak mı"** sorusudur. *(Sorumlu: Yönetim)*

---

**Dürüstlük notu:** Bu özetin bütün sayıları 2026-08-25 tarihli üretim kopyasından gelir; canlı sunucuya erişilemedi ve son üç günün verisi görülmedi. Yazılımın kendi 366 kontrol scripti bu denetimde çalıştırılmadı. Ayrıntılar, her iddianın dosya/satır ve bulgu numarası ile birlikte Bölüm 7 (veri sağlığı), Bölüm 9 (kök nedenler), Bölüm 10-12 (yol haritası, veri onarımı, kalıcı kontroller) ve Bölüm 13 (doğru yapılanlar) içindedir.
