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

Toplam **17 model** (1. faz, uygulandı — `d1b47c71` + `423af5d3`).

### 2. FAZ — ölçülmüş aday listesi (2026-08-19)

Şemadaki 86 modelin tamamı tarandı. Kalan 45 modelin ÇOĞU aday DEĞİL:
alt satırlar (`OrderLine`, `RouteStep`, `SubcontractorDispatchItem`) ebeveynin
künyesini taşır · pivotlar (`StationColor`, `ItemAllowedColor`) kimliksizdir ·
olay tabloları (`RollMovement`, `RollOperation`, `SystemLog`) zaten olayın
kendisidir · altyapı (`Session`, `EndpointLatencyDaily`, `UserPreference`)
insan eliyle yaratılmaz.

**Gerçekten eksik olanlar (~8), önem sırasıyla:**
1. `User` — bu hesabı kim açtı (ISO 27001 açısından anlamlı)
2. `PermissionTemplate` — bu rolü kim oluşturdu/değiştirdi
3. `CustomerItemAlias` / `CustomerColorAlias` — "müşterideki bu adı kim koydu";
   Tambur'a 2026-08-19'da verilen yetki tam bunu yazıyor, anlaşmazlıkta en çok
   sorulacak yer burası
4. `SubcontractorCategory`, `TravelerCardTemplate`, `DocumentProfile`,
   `CustomerStandaloneLabel`, `RollError`

**Olaya özel aktörü olanlar (16 model) AYRI bir karar ister** — `Shipment`
(`dispatchedById`), `SubcontractorDispatch` (`dispatchedById`), `RollReturn`
(`receivedById`), `Sack` (`weighedById`)… Bunlarda `createdById` eklemek "iki
alan aynı soruyu cevaplıyor" belirsizliği yaratabilir; ama `Shipment` gibi
PLANLANIP SONRA sevk edilen kayıtlarda planlayan ≠ sevk eden olduğu için
gerçekten ayrı bilgidir. Model model bakılmalı, toptan karar verilmemeli.

## Uygulama

### 1. Şema
Her modele: `createdById String? @db.Uuid` + `updatedById String? @db.Uuid`
+ `@relation`. **Nullable ZORUNLU** — geçmiş kayıtlarda değer yok ve
`NOT NULL` migration'ı canlıda tablo yeniden yazımı demek.

⚠️ FK index kuralı (perf #1) burada **bilinçli olarak uygulanmaz**: bunlar
"kim yaptı" audit FK'ları, sorgulanmadıkça indexlenmez (CLAUDE.md'deki
`printedById`/`grantedById` emsali). "Bu kullanıcının oluşturduklarını listele"
ihtiyacı doğarsa o zaman eklenir.

### ⚠️ Bu kararın TAŞIYICI ŞARTI — kullanıcı hard delete EDİLMEZ

İndekssiz FK'nın tek gerçek riski **ana kaydı silmektir**: bir `users` satırı
silinirse PostgreSQL, referans veren 22 tabloyu **indekssiz taramak** zorunda
kalır. Bugün risk yok çünkü kullanıcılar yalnız soft delete ediliyor
(`deletedAt`; 2026-08-19'da kullanıcı tarafından da teyit edildi).

Bu bir VARSAYIM ve sessizce bozulabilir → `test_record_provenance.ts` kaynak
ağacını tarayıp `prisma.user.delete` / `deleteMany` arıyor; biri yazdığı gün
test kırmızı verir ve karar yeniden değerlendirilir (index ekle YA DA silmeyi
engelle). Negatif sondayla kırmızı verdiği doğrulandı.

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

## Maliyet — ÖLÇÜLDÜ (2026-08-19)

- Migration: 17 tabloya 34 nullable kolon → **anlık** (varsayılan değer yok,
  tablo yeniden yazımı yok)
- **Yazma: satır başına +0,021 ms** (200 satırlık insert: künyeli 33,6 ms ↔
  künyesiz 29,5 ms). FK doğrulama tetikleniyor ama maliyet ölçüm gürültüsünde.
- **Okuma: DAHA UCUZ.** ⓘ artık PK üzerinden tek sorgu (0,09 ms); eskiden
  audit tablosunda iki `findFirst`'tü. Audit en hızlı büyüyen tablo olduğu için
  kazanç ölçekle birlikte artar.
- Disk: künyeli 22 tablonun TOPLAMI 9 MB; 34 kolonun payı birkaç yüz KB.
- Listeler etkilenmez — kolonlar yalnız açıkça `select` edildiğinde okunur.
- Kod: BaseService tek nokta + ~10 özel servis
- ⚠️ **Cumartesi sıfırlamasıyla İLGİSİ YOK** — bu iş boş tablo gerektirmiyor,
  istenildiği zaman yapılabilir.
