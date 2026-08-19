# Plan B — Audit derinleştirme (ne değişti, nereden, ne kadar süre)

> **Durum:** TASARIM. Uygulanmadı. Plan A (kayıt künyesi) ile birlikte okunmalı;
> A önce gelir çünkü "kim/ne zaman" sorusunu tek başına çözer ve daha ucuzdur.

## Bağlam — ölçülmüş boşluklar

Fabrika verisi, 99.439 kayıt (2026-08-19):

| Boyut | Standart | Bizde |
|---|---|---|
| Kim / ne zaman | ISO 27001 A.8.15 | ✔ |
| **Ne değişti (eski→yeni)** | SAP `CDPOS`: alan başına eski+yeni | ❌ UPDATE'lerin **%39'unda** eski değer var |
| **Nerede** (IP/cihaz) | A.8.15 "where/how" | ❌ 96.026 domain kaydının **hiçbirinde** yok |
| Değiştirilemezlik | A.8.15 (WORM) | ✔ 0 satır sonradan değişmiş |
| Kayıt bazlı sorgu | — | ❌ **uç yok** (DB index HAZIR) |
| Erişim/dışa aktarma izi | KVKK "Erişim Logları" | ❌ 0 kayıt |

Eski değeri **hiç** olmayan tablolar: `BATCH` (1.366 update), `SHIPMENT` (874),
`CUSTOMER_COLOR_ALIAS` (833). Top %33, çuval %21, refakat kartı %24.

Somut örnek — gerçek bir iş emri UPDATE kaydı:
```json
{"affectedRollCount": 1, "targetPropertyIds": ["e3e8e97e-..."]}
```
Ne eski değer var, ne hangi alanın değiştiği belli.

### Hukuki çerçeve — doğrulandı

**KVKK Kişisel Veri Güvenliği Rehberi** teknik tedbirler tablosunda "Erişim
Logları" ve "Log Kayıtları" ayrı ayrı sayılı; metin *"Tüm kullanıcıların işlem
hareketleri kaydının düzenli olarak tutulması"* diyor. **ERP audit'i için süre
BELİRTMİYOR.**

⚠️ İnternette yaygın olan **"loglar 1 yıl saklanmalı"** iddiası **5651 sayılı
kanundan** gelir ve *erişim/yer sağlayıcılarını* bağlar — ERP domain logları
kapsamda değildir. Bu ayrımı yapmadan saklama süresi tasarlama.

**Tekstil denetimleri (GOTS, AB Dijital Ürün Pasaportu ~2027-28) audit log'a
BAKMAZ** — malın izlenebilirliğini ister (elyaf kökeni, işlem adımları, hacim
mutabakatı). O veri bizde domain tarafında zaten var (top soyağacı, parti,
fason sevk/kabul, refakat kartı sürümleri). Audit log ISO 27001/KVKK cephesine
aittir; ikisini karıştırma.

## Kararlar

### 1. Alan-bazlı diff — ama SAP'tan BİLİNÇLİ SAPMA

SAP değişen **her alan için ayrı satır** yazar (`CDPOS`). Biz **yazmayacağız**:
tek satırda `changes` JSON dizisi tutacağız.

```jsonc
changes: [
  { "field": "targetQuantity", "old": 500, "new": 480 },
  { "field": "width",          "old": 150, "new": 155 }
]
```

**Gerekçe:** `CDPOS`'un ayrı tablo olmasının sebebi 1970'lerin ilişkisel
kısıtlarıdır. PostgreSQL `jsonb` bunu gerektirmez; ayrı tablo yazma hacmini
2-3× artırır (bugün 3.013 kayıt/gün → 6 ayda ~542 bin satır; alan başına satır
bunu 1,5 milyona çıkarır) ve her okumaya join ekler. Alan bazlı sorgu gerekirse
`jsonb_path_ops` GIN index'i yeter.

**Üretim merkezî olmalı:** `BaseService.update` eski kaydı zaten okuyor →
diff orada hesaplanır, 14 model bedavaya kapsanır (Plan A'daki kaldıracın aynısı).
Özel servisler için ortak `diffFields(before, after, opts)` yardımcısı; hassas
alanlar (`passwordHash`, `pin`, token) **maskelenir**.

**GÖSTERİM DİLİ — KARAR (2026-08-19, kullanıcı: "1+3"):** Türkçe alan etiketi
+ ham ada FAIL-OPEN. Tek dosyalık `field → Türkçe etiket` haritası (~50 alan);
etiketi olmayan alan HAM ADIYLA basılır (ekran boş kalmaz, harita eksikliği
baskıyı düşürmez). Harita bekçiyle denetlenir: en çok diff üreten alanların
etiketi yoksa test uyarır — ama KIRMIZI vermez (fail-open kararının test
karşılığı da fail-open'dır; yoksa her yeni kolon testi kırar).

### 2. `recordId` ile sorgulama — en ucuz, en yüksek getirili madde

`SystemLogListParams` bugün `userId · tableName · category · action · dateFrom ·
dateTo` kabul ediyor; **`recordId` YOK**. Yani *"bu iş emrinin geçmişi"* sorusu
API'den sorulamıyor — oysa `@@index([tableName, recordId])` **zaten var**.

Tek alan + tek uç: `GET /api/admin/system-logs?tableName=WORK_ORDER&recordId=…`
Bu, Plan A'daki ⓘ butonunun "Tüm geçmiş" katmanını besler.

### 3. Cihaz/IP damgası
`ipAddress` bugün yalnız AUTH olaylarında dolu. `resolveDevice` middleware'i
`x-device-id`'yi zaten çözüyor ve kullanılmıyor. `AuditService.log`'a
opsiyonel `ipAddress` + `deviceId` eklenir; controller'dan geçirilir.

Sahada 10 tablet aynı kullanıcıyla çalışırken *"hangi tabletten yapıldı"*
sorusu ancak böyle cevaplanır.

### 4. Gürültü kısma
`LABEL_TEMPLATE` **4.813** kayıtla en çok loglanan 4. tablo — şablon düzenlemesi
bu sıklıkta olmaz; önizleme/otomatik kaydetme log üretiyor. Aynı sınıf:
`SYSTEM_SETTING` (2.579), `PERIPHERAL_DEVICE` (2.229), `USER_QUICK_PIN` (960).

Kural: **değişiklik YOKSA log YAZMA.** Diff boşsa (madde 1) satır atlanır —
gürültünün büyük kısmı kendiliğinden düşer.

### 5. Saklama politikası — KARAR VERİLDİ (2026-08-19, kullanıcı)
**6 AY KALIYOR.** 12 ay önerisi soruldu ve reddedildi — arşiv artık her okuma
yolunda tarandığı için (record-info + recordId geçmişi arşive de bakacak) bilgi
kaybolmuyor; sıcak pencereyi büyütmenin getirisi kalmadı. Arşiv silinmez.
⚠️ Bu karardan sonra yeni bir okuma yüzeyi eklerken kural: **arşivi de tara** —
yalnız sıcak tabloya bakan yüzey, 6 aydan eski kayıtta sessizce boş döner
(record-info'da bir kez yaşandı, kapatıldı).

### 6. Erişim/dışa aktarma izi (KVKK) — ERTELENDİ (2026-08-19, kullanıcı)
Kapsam soruldu (CSV/Excel · toplu PDF · müşteri raporları), **"şimdilik
hiçbiri"** seçildi. KVKK denetimi kapıda değil; ihtiyaç doğduğunda tasarım
hazır: yeni `action: "EXPORT"`, her okuma DEĞİL yalnız toplu dışa aktarma.

### 7. `system_logs.updatedAt` kaldırılmalı
Audit satırı hiç güncellenmemeli; kolonun varlığı yanlış bir kapı önerir
(bugün kullanılmıyor — canlıda `updatedAt > createdAt` olan **0** kayıt var).

## Sıra

| # | İş | Getiri / maliyet |
|---|---|---|
| 1 | `recordId` filtresi + uç | **En yüksek** — tek alan, index hazır |
| 2 | Alan-bazlı diff (BaseService merkezî) | Yüksek / orta |
| 3 | Diff boşsa log yazma (gürültü) | Yüksek / düşük |
| 4 | Cihaz/IP damgası | Orta / düşük |
| 5 | Saklama politikası + `updatedAt` kaldırma | Düşük / düşük |
| 6 | EXPORT izi | Düşük / orta |

## Bekçi

`scripts/test_audit_depth.ts`:
- BaseService update'i diff **üretiyor** mu; boş diffte satır **yazmıyor** mu
- `recordId` filtresi index kullanıyor mu (`EXPLAIN`, Seq Scan yasak)
- Hassas alanlar diff'te **maskeli** mi
- `system_logs` satırı yazımdan sonra **değişmiyor** mu
- Körlük zemini: taranan çağrı noktası ≥ 100

---

## Faz B2-b — OKUNABİLİRLİK (2026-08-19, saha bulgusundan)

**Bulgu.** İş emrinin rengi değiştirildi; denetim ekranı şunu bastı:

```
ÖNCEKİ DEĞER   targetColorId  91cd4281-acfe-4da9-8298-fa5a196bab41
YENİ DEĞER     event          TARGET_COLOR_CHANGED
               targetColorId  bb826d50-acdd-489e-85a5-d73372a9bd34
               warnings       []
```

Kullanıcının cümlesi: *"neymiş neye dönüşmüş anlayamadım."* Doğru teşhis: kayıt
eksik değildi, **okunmuyordu**. İki ayrı sebep vardı ve ikisi de ayrı ayrı
yeterliydi.

### Sebep 1 — diff fiilen kapalıydı (ölçüm: 213 çağrının 2'si)

`changes` alanı **çağrı noktası opt-in**'di. BaseService (tüm master-data) ve
`workorder.service`'te tek bir yol onu dolduruyordu; kalan 211 çağrı elle
yazılmış ham JSON'du. Yani B2 canlıya çıkmıştı ama fabrikanın günlük olarak
gördüğü ekranların çoğunda hiç görünmüyordu.

**Karar: diff'i `AuditService.log` İÇİNDE, çağıran vermediyse hesapla.** 211
dosyaya dokunmak yerine tek kapı; ayrıca *yeni* çağrı noktası da onu unutamaz.
Çağıranın verdiği diff daima kazanır (o, alanın anlamını bilir).

⚠️ **`diffFields` bu iş için YANLIŞ fonksiyondur** — `after`ın tüm anahtarlarını
gezer ve elle yazılmış yükte `event`/`reason`/`warnings` gibi ANLATI alanlarını
sahte "değişiklik" satırlarına çevirir. Bunun için `diffCommonFields` var:
yalnız `before`da DA bulunan alan karşılaştırılır. Çağıranın eski değerini
yazdığı alan, kastettiği alandır.

### Sebep 2 — değer ham UUID kalıyordu

Alan adı Türkçeleşse bile `Hedef renk: 91cd… → bb82…` hiçbir şey anlatmaz.

**Karar: çözümleme YAZMA anında değil OKUMA anında.** SAP `CDPOS` de ham anahtar
saklar (`VALUE_OLD`/`VALUE_NEW`), metne çevirmeyi görüntüleme katmanı veri
sözlüğündeki kontrol tablosundan yapar. Gerekçeler:

- Adı log'a kopyalasaydık, renk sonradan yeniden adlandırıldığında geçmiş kayıt
  **eski adı** gösterirdi. Bizim sorumuz "hangi KAYDA geçildi" olduğu için
  kimlik doğru cevaptır.
- Her audit satırını şişirirdi (3.013 kayıt/gün).
- Yazma yolu sıcak; okuma yolu (tek satır / ≤100 satırlık geçmiş) değil.

`audit-value-resolver.ts`: alan adı → tablo+etiket kolonu haritası (31 alan),
**tablo başına tek sorgu**, satır başına lookup yok. **Fail-open**: kayıt
silinmiş/çözülemiyorsa ham UUID kalır — denetim ekranını bir lookup hatası
yüzünden düşürmek, biraz ham veri göstermekten kötüdür.

### Ek: arşiv iki alanı KAYBEDİYORDU

`system_log_archives` şemasında `changes` ve `deviceId` yoktu → arşivleyici
onları kopyalayamıyordu. Sonuç: B2 ve B3'ün getirdiği her şey **6 ay sonra
sessizce buharlaşıyordu**, üstelik geriye dönük denetim tam da o yaştaki
kayıtlara bakar. `20260819140000` iki nullable kolon ekler (tablo yeniden
yazılmaz, index yok) ve arşivleyici artık ikisini de taşır.

### Ekran

Ham `oldData`/`newData` blokları **kaldırılmadı, katlandı** ("Ham veri
(teknik)"). Adli inceleme için gerekli, günlük okuma için gürültü. Birincil
yüzey artık "Ne değişti" tablosu + `newData`dan çekilen **Gerekçe** satırı —
diff "ne", gerekçe "neden" sorusunu cevaplar ve ikincisi ham JSON'un içinde
kayboluyordu.

Kayıt Geçmişi ile Aktivite Detayı **aynı bileşeni** kullanır
(`AuditChangeList`): ayrı yazılsalardı biri UUID çözmeyi öğrenirken diğeri ham
basmaya devam ederdi.

### Bekçi (`test_audit_depth.ts` §9, 4 negatif sonda ile doğrulandı)

- Anlatı alanları diff'e girmiyor · `before`da olmayan alan uydurulmuyor
- UUID gerçekten ada çözülüyor (fixture kendi üretir) · çözülemeyende etiket
  alanı **doğmuyor** (fail-open) · bilinmeyen alanda lookup denenmiyor
- **Harita bayat değil**: her tablo+kolon `information_schema`'da var — tablo
  yeniden adlandırılırsa lookup sessizce fail-open'a düşerdi
- **İki harita örtüşür**: değeri çözülen her alanın Türkçe etiketi de var
  (yoksa satır yarı okunur kalır: `workOrderId: İE1908260014`)
- Arşiv iki kolonu taşıyor **ve** arşivleyici onları kopyalıyor
- Körlük zemini: harita ≥ 25 alan
