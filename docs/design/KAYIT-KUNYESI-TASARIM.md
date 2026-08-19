# Plan A — Kayıt Künyesi (kim oluşturdu / kim değiştirdi)

> **Durum:** TASARIM. Uygulanmadı. Plan B (audit derinleştirme) ile birlikte
> okunmalı ama ondan BAĞIMSIZ uygulanabilir ve önce gelmelidir.

## Bağlam — neden

Panelde "bu topu kim ekledi" gösteriliyor ama **kaynak tutarsız**:

| Kayıt | Bugünkü kaynak | Sonuç |
|---|---|---|
| Top | `Roll.createdById` **kolonu** | Listede kolon, süzülebilir, sıralanabilir |
| Sipariş / İş emri | ⓘ butonu → **audit log** | Kırılgan (aşağıya bak) |
| Müşteri, kumaş, renk, fason, çuval, sevkiyat… | **hiçbiri** | Cevaplanamıyor |

**Ölçüm (2026-08-19, fabrika verisi):** 86 modelin **6'sında** "kim oluşturdu"
kolonu var; **"kim değiştirdi" yalnız 1 modelde** (`SystemSetting`). Buna karşılık
insan eliyle CUD yapılan **55 tablo** var.

### ⚠️ Bilinen kusur — önce bu düzeltilmeli

`record-info.service.ts` yalnız `system_logs`'a bakıyor, **`system_log_archives`'a
bakmıyor**. Loglar 6 ayda arşive taşındığı için **6 aydan eski kayıtta ⓘ butonu
sessizce boş döner**. Bugün fark edilmiyor çünkü sistemdeki en eski kayıt 34
günlük. Bu, audit'i künye kaynağı yapmanın neden yanlış olduğunun kanıtı.

## Karar — ve bu YENİ bir kural değil

**Kaydın kimliğine ait kalıcı gerçek → KOLON. Adım adım değişim tarihçesi → AUDIT.**

Bu zaten `CLAUDE.md`'de yazılı: *"audit 6 ayda arşivlenir, kalıcı gerçek KOLONDAN
okunur."* İş emri iptal izinde (`cancelledAt`/`cancelledById`/`cancelReason`) ve
topun giriş sebebinde bilinçli uygulanmış. Eksik olan **sistematik uygulama**.

Sektör karşılığı: SAP master data tablolarında `ERDAT`/`ERNAM` (oluşturma) ve
`AEDAT`/`AENAM` (son değişiklik) kaydın KENDİ kolonlarıdır; `CDHDR`/`CDPOS`
değişiklik belgeleri bunlara EK'tir, yerine geçmez.

| | Kolon | Audit log |
|---|---|---|
| Cevapladığı soru | "Kim, ne zaman?" | "Tam olarak ne değişti?" |
| Listede gösterim / süzme / sıralama | ✔ | pratikte imkânsız |
| Arşivlemeden etkilenir | ✗ | **✔ kaybolur** |
| Maliyet | join | ayrı sorgu |

## Kapsam

**Eklenecek — master data (BaseService arkasında, TEK NOKTADAN):**
`color · customer · customerBranch · defectType · fabricProperty · item ·
machine · order · peripheralDevice · productRecipe · qualityGrade ·
returnReason · route · station`

**Eklenecek — özel servisler (tek tek):**
`WorkOrder · Shipment · Sack · Batch · SubcontractorDispatch ·
SubcontractorReceipt · RollReturn · KartelaDispatch · LabelTemplate ·
Subcontractor`

**EKLENMEYECEK — gerekçeli:**
- **Olay tabloları** (`RollMovement`, `RollOperation`, `TravelerCardScan`,
  `SystemLog`): zaten olayın kendisi; aktör içinde. İkinci bir "kim" alanı
  hangisinin doğru olduğu sorusunu doğurur.
- **Pivot tabloları**: kimliği olmayan bağ satırları.
- **`Roll`**: `createdById` zaten var — yalnız `updatedById` eklenir.

Toplam ≈ **24 model**.

## Uygulama

### 1. Şema
Her modele: `createdById String? @db.Uuid` + `updatedById String? @db.Uuid`
+ `@relation`. **Nullable ZORUNLU** — geçmiş kayıtlarda değer yok ve
`NOT NULL` migration'ı canlıda tablo yeniden yazımı demek.

⚠️ FK index kuralı (perf #1) burada **bilinçli olarak uygulanmaz**: bunlar
"kim yaptı" audit FK'ları, sorgulanmadıkça indexlenmez (CLAUDE.md'deki
`printedById`/`grantedById` emsali). "Bu kullanıcının oluşturduklarını listele"
ihtiyacı doğarsa o zaman eklenir.

### 2. Yazma — merkezî kaldıraç
`BaseService.create(data, userId)` ve `update(id, data, userId)` **userId'yi
zaten alıyor**. Ad büyütme işindeki (`normalizeDisplayName`) kaldıracın aynısı:
tek noktada `createdById`/`updatedById` yazılır → 14 model bedavaya kapsanır.

⚠️ `sanitizeWriteData`'nın İÇİNE koyma: o metot DMMF çözülemezse ham veriyi
erken döndürüyor, künye o kaçış yolunda sessizce atlanır (aynı hata ad
büyütmede de tartışıldı ve dışarıda bırakıldı).

Özel servislerde tek tek; ortak yardımcı `withActor(data, userId, isCreate)`.

### 3. Geriye dönük doldurma — ZAMANA DUYARLI
Veri **bugün audit'te var** (müşteride 1.679, kumaşta 1.354, renkte 1.356 CREATE
log'u) ama **6 ay sonra arşive taşınır**. Backfill script'i:
`system_logs`'tan `tableName + recordId + action='CREATE'` ile ilk kaydı bulup
`createdById`'yi doldurur; son UPDATE'ten `updatedById`.

Dry-run varsayılan + `--apply` (canlı veri kuralı). Eşleşmeyen kayıt `null` kalır
— **uydurma yapılmaz**.

### 4. Arayüz — iki katmanlı ⓘ
- **Her zaman, kolondan:** `12.08.2026 14:32 · Eda oluşturdu · son değişiklik
  18.08 09:15 · Enes` — anında, her kayıtta, asla boş dönmez
- **Tıklayınca:** "Tüm geçmiş" → Plan B'nin alan-bazlı tarihçesi

`RecordInfoButton` audit yerine kolonu okur; audit yalnız ikinci katmanda kalır.
Bu, yukarıdaki arşiv kusurunu da kapatır.

Listelerde "Ekleyen" kolonu (topta zaten var) `defaultHidden` ile eklenir —
mevcut kolon setini bozmadan.

### 5. Bekçi
`scripts/test_record_provenance.ts`:
- Kapsam listesindeki her modelde iki kolon **var mı** (şema taraması)
- BaseService yolundan create/update **gerçekten yazıyor mu** (canlı tur)
- Kapsam DIŞI bırakılanların gerekçesi listede **yazılı mı** (iki yönlü muaf denetimi)
- Körlük zemini: taranan model sayısı ≥ 20

## Maliyet

- Migration: 24 tabloya 2 nullable kolon → **anlık** (varsayılan değer yok, tablo
  yeniden yazımı yok)
- Yazma: kolon başına 16 bayt; ölçülebilir yük yok
- Kod: BaseService tek nokta + ~10 özel servis
- ⚠️ **Cumartesi sıfırlamasıyla İLGİSİ YOK** — bu iş boş tablo gerektirmiyor,
  istenildiği zaman yapılabilir.
