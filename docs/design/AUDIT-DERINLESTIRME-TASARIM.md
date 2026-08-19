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

### 5. Saklama politikası — yazılı hale getir
Bugün: 6 ayda `system_log_archives`'a taşınır, **arşiv hiç silinmez**.
Bu KVKK açısından savunulabilir ama **hiçbir yerde yazılı değil**.

Karar: arşiv **silinmez**; taşıma penceresi ayardan yönetilir. Tekstilde müşteri
şikâyeti/iade penceresi çoğu zaman 1 yıldan uzun olduğu için **taşıma süresini
12 aya çıkarmayı** öneriyorum (sıcak tabloda 12 ay ≈ 1,1 milyon satır — index'li
sorgular için sorun değil).

### 6. Erişim/dışa aktarma izi (KVKK)
Her okumayı loglamak **yanlış** olur (hacim + değersiz gürültü). Loglanacaklar:
**dışa aktarma** (Excel/CSV), **toplu belge çıkarma**, **müşteri/kişisel veri
listesi raporları**. Yeni `action: "EXPORT"`.

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
