# Kalite Güvence — 4 puan muayene, lab testleri, sertifika takibi (K4P): dilimli plan

> Durum: PLAN (2026-10-24, plan yazarı ajan; kod yok). Bağlayıcı girdi: `scratchpad/erp/KARARLAR.md` G2 madde 2 + G3. Araştırma: `G-R2-pazar.md` §3 (dört puan), §7 (kalite derinleştirme, sertifika); `G-R1-yetenek.md` §1.8 (kalite), §1.19 (bildirim). Taban: `origin/main` `2bd3d7b08`.
> Dilim istemleri: `scratchpad/erp/K4P/istemler/<KOD>.md` (kendi başına yeterli). Dilimler Opus high.

## §0 Amaç ve kapsam

**Amaç.** Alıcıya giden muayene raporunu fabrikanın kendi verisinden üretmek: topun ASTM D5430 dört puan sistemiyle puanlanması, puan/100 m² ile derecelendirilmesi, lab test sonuçlarının numune ↔ parti/top bağıyla tutulması ve sertifikaların (OEKO-TEX vb.) geçerlilik takibi. Perde ve döşemelikte alıcı bu raporu ister (G-R2 §7 "Yüksek değer, orta maliyet").

**Patron yönü (2026-10-24, koordinatör üzerinden).** Kalite kontrol fabrikaya göre Tambur'la, Kurşun'la, başka bir istasyonla birlikte ya da tamamen bağımsız yapılır. Bu yüzden muayene istasyon TÜRÜ değildir, istasyona eklenen bir YETENEKTİR. Yetenek ayrı bir plan/dilimle gelir: "istasyon yetenekleri" (`İSTASYON-YETENEK`); mevcut tek kaynak `stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE` genişletilir. K4P'nin buradan çıkan şartları:
- 4 puan ekranı istasyondan bağımsız TEK bir muayene bileşenidir. Her istasyonun tablet akışına gömülebilir ya da tek başına çalışır.
- Hiçbir yerde `kind === …` koşulu yazılmaz.

**Kapsam (v1).**
1. Tablette TEK muayene bileşeni (`InspectionPanel`): hata türü + boyut sınıfı düğmeleri, metre konumu isteğe bağlı. Operatör hata başına iki dokunuş yapar, sabit puanlı türde tek dokunuş. İki kullanım vardır:
   - **(a) Gömülü:** muayene yeteneği olan istasyonun ekranında.
   - **(b) Bağımsız:** "Muayene" ekranında top okutularak.

   v1'de gömülü kullanımın ilk konağı KK1 doğuşudur (§4.1). Kurşun/Tambur/diğer konaklar `İSTASYON-YETENEK` indikten sonra yalnız konak bağdaştırıcısı yazılarak eklenir.
2. Top puanı/100 m²: en × muayene edilen metre. En ürün kartından alınır.
3. Derece kuralı: fabrika kural seti (eşik → `QualityGrade` kataloğu). Müşteri spesifikasyonu raporda ve sevk görünümünde ezer.
4. Panelde muayene listesi, detay, düzeltme (yeni revizyon) ve iptal. Kural setleri, hata türünün sabit puanı, ürün eni.
5. Lab testleri: elle değer + birim + sonuç (geçti/kaldı), numune ↔ top/parti bağı, onayda donma.
6. Sertifikalar: belge yükleme, geçerlilik bitişi, bildirim türü "sertifika süresi doluyor" (bildirim sistemine bağlı).
7. Muayene raporu belgesi: veri sözleşmesi + sistem şablonu, belge tasarımcısının T0'ına bağlı.
8. Modül anahtarı `kaliteGuvence.enabled`. Varsayılanı KAPALI, bugünkü davranış budur.

**Kapsam dışı (v1).** KK1 dışındaki gömülü konaklar (Kurşun, Tambur, diğer istasyonlar) `İSTASYON-YETENEK` indikten sonra gelir (§4.7). Tambur çocuğuna muayene mirası. Etikete puan alanı. Patron bulutu projeksiyonu. Sevk onayında uyarı. CAPA/8D. Müşteri şikâyeti. Boyahane laboratuvarı (KARARLAR G2 "entegre et"). Sertifikalı lot/GOTS izi (G-R2 §7 "ertele"). 10 puan sistemi.

## §1 Mevcut kalite verisi ve boşluk

| Varlık | Bugün (ölçüldü, `origin/main`) | 4 puan için boşluk |
|---|---|---|
| `RollError` (`schema.prisma` ~:5091) | Kurşun/KK2'de açılır, Tambur'da kapanır (`isProcessed` + `actionTaken CUT\|NO_CUT`). `startMeter` NOT NULL nokta, `defectTypeId` + `errorType` snapshot. Tespit ve karar kişisi/adımı/anı tutulur. Partial unique `roll_errors_roll_meter_defect_uq`. | Boyut ve puan alanı yok. Metresiz hata yazılamıyor. Muayene oturumu bağı yok. "Tambur karar listesine girmeyen hata" sınıfı yok. |
| Yazarlar | `kursun-qc.service.ts` addError :653 (+ hard delete `deleteError` :739, yalnız işlenmemiş) · `tambur.service.ts` :1949 · `inventory.service.ts` :5589 createMany | Muayene yazarı yok. `deleteError` hard delete'tir; muayeneye bağlı satıra uygulanırsa raporlanan puan değişir (defter testi). |
| Okuyucular | Tambur `closeOrphanRollErrors` (tambur.service :169, rollId + isProcessed=false → NO_CUT) · bypass uygunluğu (helper :138, adım bazlı) · bypass dağıtım (:889) · dashboard `isProcessed=false` sayımı · scrap karnesi ham SQL · work-session-activity · tambur-undo · yedek etki · split/clone `updateMany` | Muayene satırı süzülmeden yazılırsa Tambur onları `NO_CUT` ile kapatır, dashboard bekleyen hata sayısı şişer. Bu yüzden okuyucu envanteri yazardan ÖNCE iner. |
| `DefectType` | Katalog: `code`, `name`, `severity`, tekil `isDefault`, `isActive`. Sıra kolonu yok. | Sabit puan (ör. delik = 4) ve tablet düğme sırası yok. |
| `QualityGrade` | Katalog: `code`, `targetStatus`, `role FIRST/SECOND/SCRAP`, etiket politikası. Topun `qualityGrade` + `qualityGradeId` çift kolonu. KK1 girişinde opsiyonel (`test_initial_entry_quality`). | Derece kataloğu VAR. Paralel A/B/C tablosu açılmaz; eşikler bu kataloğa bağlanır. |
| En | `Item`te en YOK (ölçüldü). `Roll.width` KK1'de ölçülen en (cm, nullable). `ProductRecipe.width`, `OrderLine.width`, `WorkOrder.width` var. | Patron ilkesi "en ürün kartından" için `Item.widthCm` gerekir. |
| Lab testi | Yok (`YarnLotQualityStatus` yalnız iplik lotu). | Tamamı yeni. |
| Sertifika | `PrintedDocType.QUALITY_CERTIFICATE` sevk kalite özeti belgesidir, sertifika kaydı değildir. Dosya yükleme altyapısı yok; ikili veri emsali `SupportTicket.screenshot Bytes` (≤1 MB). | Kayıt, dosya ve geçerlilik takibi yeni. |
| Bildirim | `docs/design/BILDIRIM-SISTEMI-PLAN.md`: katalog `constants/notification-catalog.ts` (N0-KAT), `registerConditionSource` (N1-MOTOR), KOSUL türü. | Yeni tür reçetelidir (`RECETELER.md` § Yeni bildirim türü, N0-KAT yazar). |
| Belge | 15 donmuş belge tipi; belge tasarımcısı kararları (`scratchpad/belge/KARARLAR.md` D1–D2): veri sözleşmesi + Liquid görünüm, Excel sözleşmeden. | Muayene raporu yeni belge türü olarak T0 sözleşme kataloğuna eklenir. |
| Modül | `MODULE_FLAG_KEYS` bugün 10 anahtar (`emanetEnabled` dahil). `modul-bayrak.md` "dokuz, genişletilmez" der; bu satır bayat. | Yeni modül RECETELER § Yeni feature flag md. 14/14b ile eklenir (§3.6). |

**Faz B notu (`kalite.md`).** RollError'ın açıldığı istasyon profildir ve partial unique çok istasyonda 409 riski taşır (R5). K4P hiçbir yerde istasyon türüne bakmaz: muayene yeri `RollInspection.stationId` verisidir, koşul değildir. K4P yalnız `origin=INSPECTION` sınıfında yazar. O sınıfta metre çoğunlukla NULL olur ve partial unique devreye girmez. Aynı metre + aynı tür tekrarını servis payload içinde 400 ile reddeder. R5 riski büyümez.

## §2 Dört puan kuralları

### 2.1 Puan tablosu

| Boyut sınıfı (`FourPointSize`) | Hata uzunluğu | Tablet etiketi | Puan |
|---|---|---|---|
| `UP_TO_3IN` | ≤ 3" (≤ 7,5 cm) | 1 · ≤7,5 cm | 1 |
| `IN_3_TO_6` | 3–6" (7,5–15 cm) | 2 · 7,5–15 cm | 2 |
| `IN_6_TO_9` | 6–9" (15–23 cm) | 3 · 15–23 cm | 3 |
| `OVER_9IN` | > 9" (> 23 cm) | 4 · >23 cm | 4 |
| — (`DefectType.fixedPoints` dolu) | boyuttan bağımsız (ör. delik, kopuk çözgü) | tür düğmesinde rozet | 1–4 sabit |

Kurallar:
- Tek hata en fazla 4 puan alır (CHECK `points BETWEEN 1 AND 4`).
- **Koşu birimi tavanı:** metresi bilinen hatalarda aynı koşu biriminde (varsayılan 1 yarda = 0,9144 m, ASTM) toplam puan en fazla 4'tür. Kova numarası `floor(startMeter / birim)`. Metresiz hatalara tavan uygulanmaz, hepsi tam sayılır. Rapor bunu dipnotla yazar: "N hata konumsuz; koşu tavanı uygulanmadı". Tavan kural setinde `runningCap ∈ {NONE, METER, YARD}`; kural seti yoksa `FOUR_POINT_DEFAULTS.runningCap = YARD`.
- Sabit puanlı türde boyut sorulmaz. `sizeClass` NULL kalır, `points = fixedPoints`.

### 2.2 Hesap formülü

```
alan_m2          = (widthCm / 100) × inspectedLengthM
puan_100m2       = toplamPuan × 100 / alan_m2          = toplamPuan × 10 000 / (widthCm × inspectedLengthM)
puan_100yd2      = puan_100m2 × 0,83612736             (1 yd² = 0,83612736 m²; ASTM: puan×36×100/(en_inç×boy_yarda) ile özdeş)
```
Örnek (bekçi altın satırı): 20 puan, en 150 cm, 100 m → 13,33 /100 m² → 11,15 /100 yd². ASTM formülü 59,055" × 109,361 yd ile 11,148 verir ve bekçi ikisinin eşitliğini ölçer.

### 2.3 Yuvarlama
- Ara hesap `Prisma.Decimal` (decimal.js) ile tam hassasiyette yapılır. `number` kullanılmaz.
- Saklanan `pointsPer100M2` `Decimal(8,2)`, ROUND_HALF_UP.
- Derece karşılaştırması kural setinin biriminde, O BİRİMDE 2 haneye yuvarlanmış değerle yapılır (`gradeScore` snapshot). Kâğıtta yazan sayı kararı veren sayıdır; "rapor 40,00 diyor ama C" çelişkisi doğmaz.
- Bant üst sınırı KAPSAYICIDIR (`score ≤ maxScore`). Son bant `maxScore = NULL` (tümü) olmak ZORUNDADIR. Kural seti kaydında boşluksuz, artan sıra doğrulanır, aksi 400.

### 2.4 En kaynağı (tek helper `resolveInspectionWidth`)
1. Ürün kartı `Item.widthCm` (yeni; patron ilkesi).
2. Yoksa topun KK1'de ölçülen eni `Roll.width`.
3. İkisi de yoksa `widthCm = NULL`, `widthSource = UNKNOWN`. Puan/100 m² hesaplanmaz, derece önerilmez. Muayene yine kaydedilir ve panel "en bilinmiyor" uyarısı gösterir.

Snapshot: `widthCm` + `widthSource ∈ {ITEM_CARD, ROLL_MEASURED, MANUAL, UNKNOWN}`. Panelde düzeltme formu eni elle girebilir (`MANUAL`). Ürün kartının eni sonradan değişirse geçmiş muayene değişmez. Veto maddesi V3: "ölçülen en önce mi gelsin?"

### 2.5 Kural seti çözümü (tek helper `resolveFourPointRule`)
- Topun kalite önerisi YALNIZ fabrika kural setinden gelir. KK1'de müşteri bilinmez: "top↔sipariş bağı yok", karşılama sevk anında (`is-emri.md`).
- Müşteri spesifikasyonu müşteri bilindiği yüzeyde uygulanır: sevk muayene özeti ve muayene raporu. Çözüm sırası müşteri+ürün → müşteri → fabrika varsayılanı. Saf fonksiyondur; kayıtlı `pointsPer100M2` + snapshot'tan hesaplanır, muayeneyi DEĞİŞTİRMEZ.

## §3 Veri modeli

Migration'lar yalnız `npx prisma migrate dev --create-only`. `DropForeignKey` satırları silinir. Enum değeri ekleme `ALTER TYPE … ADD VALUE` ile SONA yapılır. Her yeni model UUID PK `@db.Uuid`, `DateTime @db.Timestamptz`, `createdAt`/`updatedAt` (defter emsali dışında). CUD audit edilir; muafiyet `scripts/lib/audit-muafiyeti.ts` beyanı ister.

### 3.1 Değişen tablolar

**`RollError` (genişler; yeni hata tablosu AÇILMAZ).**
- `origin RollErrorOrigin @default(PROCESS)` — enum `{PROCESS, INSPECTION}`. `PROCESS` bugünkü her satırdır ve Tambur karar listesine girer. `INSPECTION` muayene kaydıdır: Tambur'a girmez, `isProcessed` hep false.
- `sizeClass FourPointSize?` · `points Int? @db.SmallInt` · `inspectionId String? @db.Uuid` (FK `RollInspection`, `onDelete: Restrict`).
- `startMeter` → `Decimal?`. Bütün TS okuyucuları null-güvenli yapılır (17 dosya, ölçüldü `git grep -c startMeter`).
- DB CHECK'leri (migration'da):
  - `roll_errors_meter_ck`: `"startMeter" IS NOT NULL OR origin = 'INSPECTION'`. Bugünkü yolların metre garantisi DB'de kalır.
  - `roll_errors_points_ck`: `points IS NULL OR points BETWEEN 1 AND 4`.
  - `roll_errors_inspection_ck`: `origin <> 'INSPECTION' OR (inspectionId IS NOT NULL AND points IS NOT NULL AND "isProcessed" = false AND "actionTaken" IS NULL)`.
- İndeks: `@@index([inspectionId])`, `@@index([rollId, origin])`.

**`DefectType`:** `fixedPoints Int? @db.SmallInt` (CHECK 1–4) · `sortOrder Int @default(0)` (tablet düğme sırası).
**`Item`:** `widthCm Decimal? @db.Decimal(8,2)` (CHECK > 0). BaseController modelidir; skaler kolon otomatik yazılabilir alan olur ve bu İSTENİR. Zod şemasına ve istemci gövde allowlist'ine iki uçta eklenir.

### 3.2 Yeni tablolar

**`RollInspection`** — muayene belgesi. `PrintedDocument` emsali: içerik doğuşta donar, yalnız damga kolonları yazılır.
`id` · `rollId` FK · `phase InspectionPhase {RAW, FINAL}`: istasyondan DEĞİL, topun durumundan türer. Tek helper `resolveInspectionPhase(roll)`: finalize edilmemiş top RAW, son adımı geçmiş/finalize top FINAL. Panel yalnız kâğıttan girişte açıkça seçer. · `revision Int @default(1)` · `supersedesId String? @unique` (önceki revizyon) · `stationId?` · `deviceId?` · `inspectedLengthM Decimal(12,3)` · `widthCm Decimal(8,2)?` · `widthSource InspectionWidthSource` · `totalPoints Int` · `defectCount Int` · `unplacedDefectCount Int` · `pointsPer100M2 Decimal(8,2)?` · `ruleSetId?` · `ruleSnapshot Json` (bantlar, birim, tavan; yalnız kimlik + sayı) · `gradeScore Decimal(8,2)?` · `suggestedQualityGradeId?` + `suggestedGradeCode VarChar(32)?` (snapshot) · `gradeMismatch Boolean @default(false)` (önerilen ≠ topun doğuştaki kalitesi) · `note VarChar(500)?` · `reviseReason String?` · `inspectedById` · `inspectedAt` · `supersededAt?/supersededById?` · `voidedAt?/voidedById?/voidReason?` · `clientToken String? @unique @db.Uuid` · `createdAt/updatedAt`.
- Partial unique `roll_inspections_one_active_uq (rollId, phase) WHERE supersededAt IS NULL AND voidedAt IS NULL`. Eşzamanlı ikinci "ilk muayene"nin DB seddidir; P2002 → 409 `INSPECTION_ALREADY_ACTIVE`.
- CHECK: `totalPoints ≥ 0`, `inspectedLengthM > 0`, `widthSource = 'UNKNOWN' ⇔ widthCm IS NULL`, `voidedAt` ve `supersededAt` ikisi birden dolu olamaz.
- Aktif yüklem TEK helper: `ACTIVE_INSPECTION_WHERE` (bellek ikizi `isActiveInspection`). Emsal `ACTIVE_ALLOCATION`.

**`FourPointRuleSet`** (yapılandırma; `updatedAt` var): `name` · `scope RuleScope {FACTORY, CUSTOMER}` · `customerId?` (iş ortağı kimliği, tek FK) · `itemId?` · `unit ScoreUnit {M2, YD2}` · `runningCap RunningCap {NONE, METER, YARD}` · `isActive`. CHECK `scope='FACTORY' ⇔ customerId IS NULL` ve `itemId IS NULL OR customerId IS NOT NULL`. Partial unique'ler: tek aktif FACTORY · aktif `(customerId, COALESCE(itemId, '00000000-…'))`.
**`FourPointRuleBand`**: `ruleSetId` FK (Cascade) · `sortOrder` · `maxScore Decimal(8,2)?` · `label VarChar(16)` · `accepted Boolean` · `qualityGradeId?`. FACTORY setinde `qualityGradeId` zorunlu, CUSTOMER setinde NULL. Bu iki koşul servis doğrulamasıyla sağlanır. Set kaydı bantları tek tx'te replace eder (③b saf yapılandırma pivotu). Geçmiş muayene `ruleSnapshot` taşıdığı için sonuç değişmez. Değişiklik audit'e yazılır.

**Lab ve sertifika tabloları** §6'dadır.

### 3.3 Enum'lar
`RollErrorOrigin`, `FourPointSize`, `InspectionPhase`, `InspectionWidthSource`, `RuleScope`, `ScoreUnit`, `RunningCap`, `LabResultKind`, `LabTestStatus`, `LabVerdict`, `CertificateHolder`. Hepsi yeni enum'dur; mevcut enum'a değer eklenmez. Tek istisna RAPOR dilimindeki `PrintedDocType.INSPECTION_REPORT`tir (SONA).

### 3.4 Defter mi durum mu — defter testi

| Tablo | Satır silinince raporlanan sayı değişir mi? | Sınıf | Ters mekanizma |
|---|---|---|---|
| `RollInspection` | EVET (muayene raporu, puan istatistiği) | DEFTER (`PrintedDocument` emsali, `defter-beyan.ts`te beyan) | DAMGA `supersededAt` (revizyon) + `voidedAt` (iptal). Silme yolu YOK. |
| `RollError` origin=INSPECTION | EVET (toplam puan) | `RollError` DURUM tablosudur; INSPECTION satırı ebeveyn muayenenin parçasıdır | Muayene revizyonu yeni satırlar yazar, eskisi eski revizyona bağlı kalır. `deleteError` WHERE'ine `origin: PROCESS` atomik olarak eklenir; INSPECTION satırı silinemez (400). |
| `FourPointRuleSet/Band` | HAYIR (muayene snapshot taşır) | yapılandırma (③b) | audit + pasife alma |
| `LabTest` | EVET | DURUM + onayda donan snapshot | `DRAFT` → `APPROVED` → `VOIDED` (DURUM_IPTAL `voidedAt`). DRAFT hard delete meşrudur (deftere hiç yazmamış taslak). |
| `Certificate` | sertifika listesi | DURUM | `revokedAt` damgası; yenileme yeni satır (`renewsId`) |
| `CertificateFile` | — | DURUM (ebeveyn) | sertifikayla birlikte; tek tek silme yalnız `revokedAt`'sız ve muayene raporuna basılmamış dosyada |

Yeni advisory kilit uzayı YOK. Muayene yazımı KK1 yolunda mevcut 8021 kilidinin arkasında koşar. Panel yolu atomik claim + partial unique seddiyle korunur. Lab numarası mevcut numara serisi üreticisinden alınır.

## §4 Akışlar

### 4.1 Tablet muayene — tek bileşen, konaklar

**Bileşen.** `mobil/src/components/inspection/`. İstasyondan bağımsızdır; istasyon türü, ekran adı ya da rota bilmez.
- Girdi: `{rollRef, lengthM, itemId, rollWidth?, currentGradeCode?}` + `onDraftChange`.
- Çıktı: taslak (`defects[]`, not).
- Kaydetmeyi KONAK yapar. Bileşen önizleme ucunu kendisi çağırır.

**Konak sözleşmesi.** Her konak üç şey sağlar:
1. Bileşeni ne zaman göstereceği.
2. Taslağı hangi yazma yoluna koyacağı.
3. Kaydetme sonrası temizlik.

Gösterim kapısı TEK yüklemdir: modül açık ∧ `inspection:write` ∧ sunucunun döndürdüğü `canInspect`. `canInspect` oturum istasyonu için `stationCanInspect(station)` ile hesaplanır. Bu helper `quality-station.helper.ts` ailesindedir ve sahibi `İSTASYON-YETENEK`tir: o dilim inene dek gövdesi mevcut `stepCanApplyQuality(station)`tır (tek kaynak), sonra yalnız gövdesi değişir. İstemcide `kind` karşılaştırması YASAKTIR.

**v1 konakları:**
- **(a) KK1 doğuşu (gömülü).** Taslak `initial-entry` gövdesine `inspection` alanı olarak girer ve top ile aynı tx'te yazılır (adım 6). Doğuş anında topun kimliği henüz yoktur; ayrı istek çevrimdışı kuyrukta sıra/kimlik sorunu doğurur.
- **(b) Bağımsız "Muayene" ekranı.** Top okutulur, bileşen açılır, `POST /api/quality-inspections` + `clientToken` (`attemptToken.ts`) ile yazılır. Ekran oturumlu istasyon ekranı DEĞİLDİR; `SCREEN_BY_STATION_KIND` tablosuna girmez. Modül + `mobile:muayene` iznine bağlıdır. Oturumda istasyon varsa `stationId` veri olarak yazılır.

**Sonra eklenecek konaklar** (§4.7): Kurşun/KK2, Tambur ve diğerleri. Her biri yalnız konak bağdaştırıcısıdır; bileşen ve backend değişmez.

1. Gösterim kapısı açıksa konak ekranında **MUAYENE** düğmesi çıkar ve sağ yarı paneli açar. Konağın formu solda kalır. Bağımsız ekranda bileşen tam ekrandır.
2. Operatör kumaş çalışırken hata türüne dokunur. Sabit puanlı türde kayıt hemen düşer. Değilse 4 boyut düğmesi yanar ve ikinci dokunuş kaydı yazar. "Metre" alanı doluysa sıradaki kayda iliştirilir ve temizlenir. Boşsa konumsuz kayıt olur.
3. Taslak cihazda kalıcıdır (persist store; uygulama çökse de kaybolmaz) ve sunucuya gitmez. "GERİ AL" son kaydı siler (taslak sınıfı).
4. Özet şeridi yerelde yalnız TOPLAMI gösterir (hata sayısı, puan toplamı; karar değil, sayım). Puan/100 m² ve derece önerisi sunucunun `POST /api/quality-inspections/preview` ucundan gelir. Uç saf hesap yapar, yazmaz. Taslak, metre veya kumaş değişince 400 ms debounce ile çağrılır. Çevrimdışıysa "Öneri hesaplanamadı" yazılır ve operatör bugünkü gibi seçer.
5. Öneri çipi kalite seçicinin yanında durur ("ÖNERİ: 1.KALİTE · A · 9,8"). Tek dokunuş öneriyi kalite alanına yazar. Operatör seçmezse alan bugünkü gibi boş kalır. Otomatik doldurma yok (öneri ≠ kilit).
6. **KAYDET:** mevcut `/api/rolls/initial-entry` gövdesine opsiyonel `inspection {defects[], inspectedLengthM?, note?}` alanı eklenir. Top + `RollInspection` + `RollError(origin=INSPECTION)` satırları AYNI tx'te yazılır. Sıra: 8021 kilidi → mükerrer tuzağı → top → muayene. Token topundur; replay topu ve muayeneyi birlikte döndürür. Replay kimliği değişmez.
7. Modül kapalı ya da izin yoksa top DOĞAR, muayene yazılmaz, yanıt `warnings: [{code:'INSPECTION_NOT_SAVED', …}]` taşır ve tablet bunu toast'la duyurur. Gerekçe: kuyruktan dirilen kayıtta 403 kalıcı düşüştür; fiziksel top sistemde doğmaz (`kk1.md`). Yapısal hata (bilinmeyen tür id'si, puan dışı değer) → 400 ve hiçbir şey yazılmaz. Pasif hata türü KABUL edilir (dokunulduğu an aktifti; "gizlenmiş kod geçerli" ilkesi).
8. Kaydet sonrası taslak temizlenir. Etiket bugünkü gibi basılır.

### 4.2 Panel inceleme ve düzeltme
- **Kalite → Muayeneler:** liste + cursor + özet şeridi (top sayısı, ort. puan/100 m², derece dağılımı, uyumsuzluk sayısı) TEK where'den. Süzme sunucuda; id filtreleri `readIdCondition`/`readFilterList`'ten. Süzgeçler: tarih (fabrika günü), kumaş, derece, aşama, istasyon, operatör, puan aralığı, "en bilinmiyor", "uyumsuz".
- **Detay:** top künyesi, hata tablosu (tür, boyut, puan, metre, kişi, saat), hesap dökümü (alan, tavan sonrası puan, formül), kural snapshot'ı, revizyon zinciri.
- **Düzelt** (`inspection:correct`): tam hata listesini düzenlenebilir tabloda açar; en ve uzunluk elle girilebilir; gerekçe ≥ 3 karakter. `POST /:id/revise` tx'te önce eskiyi atomik claim eder (`updateMany WHERE {id, supersededAt:null, voidedAt:null}` → `count===0` → 409), sonra yeni revizyonu `supersedesId` ile yazar. Eski satırlar ve hataları silinmez.
- **İptal:** önizleme ucu etkilenen kaydı listeler (muayene, hata sayısı, basılmış rapor varsa belge no'su). Gerekçe ≥ 3. `voidedAt` damgası basılır.
- **Panelden yeni muayene** (kâğıttan giriş, `FINAL` aşaması dahil): aynı form, `POST /api/quality-inspections` + `clientToken` (`attemptToken.ts`).

### 4.3 Derece ataması
- Muayene **önerilen dereceyi** snapshot'lar. Topun `qualityGrade` kolonuna YENİ YAZAR AÇILMAZ. Kalite bugünkü iki kapıda doğmaya devam eder: KK1 girişi + Tambur finalize (`top-duzeltme.md`).
- KK1'de operatör öneriyi tek dokunuşla seçebilir (§4.1-5). Seçilmezse muayene `gradeMismatch=true` damgalar ve panel listesi bunu süzer. Düzeltme topun mevcut kalite düzeltme yüzeyinden yapılır.
- Ayar `kaliteGuvence.autoApplySuggestedGrade` (modül altı; varsayılan KAPALI) v1'e GİRMEZ. Talep olursa §3.6 resolver kalıbıyla eklenir (veto V5).

### 4.4 Sevkiyat ve etiket etkisi
- **Sevk:** sevk detayına "Muayene" sekmesi gelir (modül açıkken). Uç `GET /api/quality-inspections/shipment/:id/summary`: her top için kendi aktif muayenesi (FINAL > RAW), puan, fabrika derecesi, müşteri spesifikasyonuna göre etiket + GEÇTİ/KALDI. Muayenesiz top "muayene yok" olarak görünür. Ebeveyn (Tambur öncesi) muayenesi çocuğa MAL EDİLMEZ; kesim hatayı çıkarmış olabilir. Sevkiyat yazma yolu DEĞİŞMEZ, engel yoktur. Onay uyarısı v2'dir (veto V6).
- **Etiket:** değişmez. Derece zaten `QualityGrade.code` üzerinden `showIf` ile basılır.
- **Rapor:** §4.5.

### 4.5 Muayene raporu belgesi
- Bağımlılık: belge tasarımcısının T0'ı (veri sözleşmesi kataloğu) + Liquid render çekirdeği (`scratchpad/belge/KARARLAR.md` D1/D2).
- Tür `INSPECTION_REPORT`, kaynak `Shipment` (müşteri bilinir). Sözleşme: başlık (müşteri, sevk no, tarih — fabrika diliminden), kural (birim, bantlar, tavan), satırlar (top barkodu, kumaş, renk, en, metre, hata sayısı, puan, puan/100, etiket, sonuç), toplamlar (BACKEND'de), dipnotlar (konumsuz hata, en kaynağı). İç kolonlar (operatör adı, istasyon, cihaz) VARSAYILAN YOK, opt-in.
- Donma: basımda `PrintedDocument` zinciri (sürüm + İPTAL filigranı). Excel sözleşmeden `exceljs` ile üretilir; "PDF=Excel" eşdeğerliği sözleşme üzerinden ölçülür.
- Tek top için "Top muayene kartı" v2'dir.

### 4.6 Patron bulutu
v1'de projeksiyon YOK. İstenirse fabrika günlük özet hesaplar (ort. puan/100 m², derece dağılımı) ve kurulum anahtarıyla imzalı gönderir; bulut hesap yapmaz (`patron-bulutu.md`). Opt-in ayrı dilim (veto V7).

### 4.7 Faz 2 — diğer konaklar (bu planda istem yok)
`İSTASYON-YETENEK` indikten sonra yetenekli her istasyonun tablet akışına (Kurşun/KK2, Tambur, sevk öncesi son kontrol, bağımsız kalite masası) aynı bileşen gömülür; her konak yalnız bağdaştırıcı yazar (gösterim kapısı + kaydetme yolu).
- Muayene hatası her konakta `origin=INSPECTION` kalır; konağın kendi hata/karar akışı (Kurşun hatası → Tambur kararı) DEĞİŞMEZ.
- "Muayene hatası aynı zamanda kesim kararı ister mi" ayrı karardır: ön koşul Faz B R5.

## §5 UI

### 5.1 Tablet — muayene bileşeni (KK1 konağında gömülü görünüm; yatay, endüstriyel dil)
Kurallar: düğme ≥ 64 dp, metin ≥ 20 sp, yüksek karşıtlık. Boyut renkleri 1 gri · 2 sarı · 3 turuncu · 4 kırmızı; renk tek başına anlam taşımaz, rakam da yazılır. Dokunuşta haptik. Combobox yok. Sayı girişi `NumpadInput`; `autoActivate` yalnız formun metraj alanında kalır, muayene metresi elle odaklanır (`kk1.md` NumpadHost kuralı).

```
┌─ KK1 · HAM KONTROL ─────────────────────────────── OP: A. YILMAZ · B VARDİYA · ● ÇEVRİMİÇİ ─┐
│ ┌─ TOP ───────────────────────────┐ ┌─ MUAYENE · 4 PUAN ─────────────────────────────────┐ │
│ │ KUMAŞ   [ PATOS 280 ]           │ │ METRE (isteğe bağlı)  [   37,5 ]  [ TEMİZLE ]       │ │
│ │ RENK    [ HAM ]                 │ │ ┌ HATA TÜRÜ ─────────────────────────────────────┐ │ │
│ │ EN cm   [ 280 ]  (kart: 280)    │ │ │ [ATKI KAÇIĞI] [ÇÖZGÜ KOPUĞU] [LEKE]  [DELİK ④] │ │ │
│ │ METRE   [ 102,4 ]               │ │ │ [KALIN ATKI ] [BOY ÇİZGİSİ ] [YAĞ ]  [SÖKÜK ④] │ │ │
│ │ KG      [  41,2 ]               │ │ └────────────────────────────────────────────────┘ │ │
│ │ KALİTE  [ — seç — ]             │ │ ┌ BOYUT ─────────────────────────────────────────┐ │ │
│ │  ÖNERİ: 1.KALİTE · A · 9,8 ◀dok │ │ │ [ 1 ]≤7,5cm [ 2 ]7,5–15 [ 3 ]15–23 [ 4 ]>23cm  │ │ │
│ │                                 │ │ └────────────────────────────────────────────────┘ │ │
│ │                                 │ │ SON KAYITLAR                         [ GERİ AL ]    │ │
│ │                                 │ │  37,5 m  LEKE          2 · 7,5–15   2p             │ │
│ │                                 │ │   —      ATKI KAÇIĞI   1 · ≤7,5     1p             │ │
│ │                                 │ │  12,0 m  DELİK         sabit        4p             │ │
│ └─────────────────────────────────┘ │ ─────────────────────────────────────────────────── │ │
│                                     │ HATA 7 │ PUAN 15 │ 9,8 /100 m² │ EN: ÜRÜN KARTI    │ │
│ [ MUAYENE ▣ ]          [   K A Y D E T   ]  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Durumlar: tür seçili → boyut şeridi yanıp söner, başka türe dokunmak seçimi değiştirir. Çevrimdışı → özet şeridinde "/100 m² ve öneri çevrimiçi hesaplanır". "En bilinmiyor" → sarı şerit "Ürün kartında en yok; puan/100 hesaplanmaz". Kaydet sonrası `INSPECTION_NOT_SAVED` uyarısı turuncu toast'la gösterilir; metin "kaydedilmedi" der ve sebebini yazar.

Bağımsız ekran (konak b): aynı bileşen tam ekran çizilir; üstte top okutma şeridi bulunur.
```
┌─ MUAYENE ──────────────────────────────────────── OP: A. YILMAZ · ● ÇEVRİMİÇİ ─┐
│ [ ▣ TOP OKUT ]  T241026F0044 · PATOS 280 · 96,0 m · en 280 (kart) · 1.KALİTE      │
│ ┌ HATA TÜRÜ ───────────────────────┐ ┌ BOYUT ───────────┐ ┌ SON KAYITLAR ─────┐ │
│ │ [ATKI KAÇIĞI] [LEKE] [DELİK ④]  … │ │ [1] [2] [3] [4]  │ │ … [ GERİ AL ]     │ │
│ └──────────────────────────────────┘ └──────────────────┘ └───────────────────┘ │
│ HATA 3 │ PUAN 7 │ 2,6 /100 m² │ ÖNERİ 1.KALİTE · A       [ MUAYENEYİ KAYDET ]   │
└───────────────────────────────────────────────────────────────────────────────┘
```
Topun aktif muayenesi varsa ekran "Bu topun r1 muayenesi var — panelden düzeltilir" der ve yeni kayıt açmaz (tek aktif kuralı). Tabletten revizyon v1'de yoktur.

### 5.2 Panel
```
Kalite › Muayeneler                                         [+ Kâğıttan muayene]  [Dışa aktar]
┌ Süzgeç: Tarih[bugün▾] Kumaş[…] Derece[…] Aşama[RAW|FINAL] Operatör[…] Puan[  –  ] ☐En yok ☐Uyumsuz ┐
├ ÖZET: 142 top · ort. 11,4 /100 m² · 1.KALİTE 118 · A1 19 · FİRE 5 · uyumsuz 7 · en yok 3 ──────────┤
│ Barkod       Kumaş       Metre  En   Hata Puan /100m²  Öneri     Topun kalitesi  Durum   Tarih     │
│ T241026H0012 PATOS 280   102,4  280  7    15   5,23    1.KALİTE  1.KALİTE        Aktif   26.10 09:12│
│ T241026H0013 PATOS 280    98,0  280  14   41   14,94   A1        — (uyumsuz)     Aktif r2 26.10 09:31│
└─────────────────────────────────────────────────────────────────────────── [Daha fazla yükle] ┘
```
Detay sağ çekmecede açılır: künye · hata tablosu · hesap dökümü · kural snapshot · revizyonlar · [Düzelt] [İptal et].
Diğer ekranlar: **Tanımlar › 4 Puan Kuralları** (fabrika varsayılanı + müşteri spesifikasyonları; bant tablosu: üst sınır, etiket, kabul, kalite derecesi seçici MODAL) · **Hata Tipleri** (sabit puan + sıra kolonu, sürükle-sırala) · **Ürün kartı** (En cm; modül açıkken görünür) · **Kalite › Lab Testleri** · **Kalite › Sertifikalar** · **Sevkiyat detayı › Muayene sekmesi**. Seçiciler doğrudan modal açar (`ui-tercihleri`).

## §6 Lab testleri ve sertifikalar

### 6.1 Lab testleri
- **`LabTestType`** (katalog): `code` · `name` · `method VarChar(64)?` (ör. "ISO 105-C06") · `resultKind {NUMERIC, SCALE, PASS_FAIL}` · `scaleMax SmallInt?` (gri skala 5, mavi skala 8) · `unit VarChar(16)?` · `specMin/specMax Decimal?` (varsayılan sınır) · `sortOrder` · `isActive`. Panelde "Hazır listeden ekle" önizlemeli ve satır seçimlidir: Gramaj (g/m², ISO 3801) · En (cm, ISO 22198) · Yıkama haslığı (gri 1–5, ISO 105-C06) · Sürtme haslığı kuru/yaş (ISO 105-X12) · Işık haslığı (mavi 1–8, ISO 105-B02) · Kopma mukavemeti (N, ISO 13934-1) · Boyutsal değişim (%, ISO 5077) · Boncuklanma (1–5, ISO 12945-2) · Yanmazlık (geçti/kaldı, ör. EN 13773 / NFPA 701 — perde).
- **`LabTest`**: `testNo` (numara serisi `LAB`, doğuşta materyalize) · `rollId?` · `batchId?` · `itemId` (top/partiden türetilir) · CHECK `num_nonnulls(rollId, batchId) ≥ 1`. Top verildiyse `batchId` topun partisinden snapshot'lanır. Ayrıca `sampleCode?` · `labName?` (iç/dış) · `testedOn @db.Date` (fabrika günü) · `status {DRAFT, APPROVED, VOIDED}` · `approvedAt/By` · `voidedAt/By/Reason` · `clientToken @unique`.
- **`LabTestResult`**: `labTestId` FK · `testTypeId` · `value Decimal(12,3)?` (SCALE'de 0,5 adım: 4,5 = "4-5") · `unit` snapshot · `specMin/specMax` snapshot · `verdict {PASS, FAIL}` · `verdictSource {AUTO, MANUAL}` · `note`. Sınır varsa sonuç otomatiktir (sınır içi → PASS); PASS_FAIL türünde ve sınırsız türde elle girilir.
- DRAFT'ta sonuçlar düzenlenir; her yazma `WHERE status='DRAFT'` atomiktir. Onay `updateMany WHERE {id, status:'DRAFT'}` ile yapılır, sonra donar (409 `LAB_TEST_LOCKED`). İptal gerekçelidir. DRAFT hard delete meşrudur ve sınıfı kod yorumunda adıyla anılır.
- Görünüm: top detayı ve parti detayında "Lab testleri" kartı (salt-okunur). Muayene raporu sözleşmesine opt-in "lab özeti" bloğu.

### 6.2 Sertifikalar
- **`Certificate`**: `holder {OWN, PARTNER}` · `partnerId?` (iş ortağı kimliği, tek FK; CHECK `holder='OWN' ⇔ partnerId IS NULL`) · `standard VarChar(64)` (önerilen liste: OEKO-TEX Standard 100, GOTS, GRS, ISO 9001, ISO 14001, bluesign, EU Ecolabel, yanmazlık test raporu) · `certificateNo` · `issuer` · `scope VarChar(500)?` · `issuedOn @db.Date?` · `validUntil @db.Date` · `renewsId String? @unique` (yenilediği sertifika) · `revokedAt/By/Reason` · `clientToken @unique`. Etkin = iptal edilmemiş ve yenileyeni olmayan sertifika (tek helper `ACTIVE_CERTIFICATE_WHERE`).
- **`CertificateFile`**: `certificateId` FK · `fileName VarChar(200)` (temizlenmiş) · `mimeType` · `sizeBytes` · `sha256` · `content Bytes` · `uploadedById`. `@@unique([certificateId, sha256])`; aynı dosya tekrar yüklenince mevcut kayıt döner. Sınır 5 MB, türler PDF/JPEG/PNG. Tür beyana değil SİHİRLİ BAYTA bakılarak doğrulanır (`%PDF`, `FFD8FF`, `89504E47`). Yükleme base64 JSON gövdesiyle büyük gövde yolundan gider (`app.ts` `buyukGovdeYolu` listesi + rotanın kendi `express.json({limit:'8mb'})` katmanı). İndirme ikili yanıttır, `Content-Disposition: attachment`. Dosya baytları audit yüküne girmez.
- **Bildirim:** tür `kalite.sertifika-suresi-doluyor` (B/KOSUL). Kaynak `registerConditionSource`: etkin ∧ `validUntil − bugün(fabrika günü) ≤ gun` (param, varsayılan 30; süresi geçmiş olan dahil). Subject `certificate:<id>`. İzin [certificate:read], modül `kaliteGuvenceEnabled`, varsayılan alıcı certificate:write sahipleri, kilit YOK, kanal uygulama+masaüstü, derin bağlantı `/quality/certificates?focus=<id>`. Yenilenince ya da iptal edilince koşul kapanır ("Çözüldü"). Yüklem TEK helper `certificateExpiryWhere(today, days)`: panel "süresi yaklaşan" süzgeci ve bildirim kaynağı aynı helper'ı kullanır (boğaz-ikiz).

## §7 Dilimler

Ortak: her dilim kendi worktree'sinde çalışır (istem bloğu). Model Opus high. Bekçiler `npx tsx scripts/run-all-tests.ts <ad>` ile koşulur. Yeni bekçinin negatif sondası istemde yazılıdır. Paralel en fazla 3 ajan. Dalgalar: **D1** ZEMIN ∥ SEMA → **D2** KAPSAM ∥ LAB → **D3** MOTOR ∥ SERT → **D4** KK1 ∥ TANIM ∥ PANEL → **D5** TABLET ∥ RAPOR → **D6** EKRAN.

**Dış bağımlılık — `İSTASYON-YETENEK`** (ayrı plan/dilim, patron yönü 2026-10-24): muayeneyi istasyon yeteneği yapar ve `stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE` tek kaynağını genişletir. K4P onu BEKLEMEZ ama ona göre kurulur:
- `stationCanInspect` helper'ını KK1 dilimi ince sarmalayıcı olarak açar.
- `İSTASYON-YETENEK` yalnız helper'ın gövdesini değiştirir.
- §4.7 konakları ondan sonra gelir.

İki plan aynı helper dosyasına dokunduğundan sıra şöyledir: hangisi önce inerse öteki `git merge origin/main` ile uyar. Boğaz-ikiz bekçisi (`test_station_quality_capability`) iki dilimde de koşulur.

| Kod | Boy | Hedef | Bağımlılık |
|---|---|---|---|
| ZEMIN | M | modül anahtarı + izinler + ekran kataloğu + kural satırları | — |
| SEMA | L | §3.1/§3.2 şema + migration + startMeter null-güvenliği + defter/audit beyanı | — (ZEMIN ile paralel) |
| KAPSAM | L | RollError okuyucu envanteri, tek helper, AST bekçisi, `deleteError` korkuluğu | SEMA |
| MOTOR | L | 4 puan hesap helper'ı, muayene servisi + API, kural seti API, preview | SEMA, KAPSAM, ZEMIN |
| KK1 | M | initial-entry `inspection` alanı (aynı tx) + `stationCanInspect` + oturumda `canInspect` | MOTOR; `İSTASYON-YETENEK` (varsa helper'ı onunkiyle birleşir) |
| TABLET | L | istasyondan bağımsız muayene bileşeni + KK1 konak bağdaştırıcısı + öneri çipi | KK1 (APK/OTA) |
| EKRAN | M | bağımsız "Muayene" tablet ekranı (konak b) | TABLET, ZEMIN (`mobile:muayene`) |
| TANIM | M | panel: kural setleri, hata tipi sabit puan/sıra, ürün eni | MOTOR |
| PANEL | L | panel: muayene listesi/detay/düzelt/iptal/kâğıttan giriş | MOTOR |
| LAB | L | lab test modelleri + API + panel | ZEMIN |
| SERT | L | sertifika modelleri + dosya + panel + bildirim türü | ZEMIN; bildirim N0-KAT + N1-MOTOR (yoksa bildirim yarısı ayrı commit'te bekler) |
| RAPOR | L | sevk muayene özeti + muayene raporu sözleşmesi + belge türü | MOTOR, PANEL; belge tasarımcısı T0 + render çekirdeği |

**Dilim özetleri (ayrıntı istemlerde):**
- **ZEMIN.** RECETELER § Yeni feature flag md. 1–11, 14, 14b, 19 (anahtar `kaliteGuvence.enabled` / `kaliteGuvenceEnabled`; `MODULE_DEPENDENCIES` satırı YOK — KK1 üretim kapalıyken de açık; grandfathering migration sabit `false`). İzinler (`permission-catalog.ts`, migration YOK): `inspection:read|write|correct|rules`, `labtest:read|write|approve`, `certificate:read|write`, `mobile:muayene`. Rol şablonları: KK1 operatörü + `inspection:write`; Kalite/Süpervizör tüm kalite güvence izinleri. `SCREEN_CATALOG`: `quality/inspections`, `quality/inspection-rules`, `quality/lab-tests`, `quality/certificates`. Kural dosyası: `kalite.md`ye K4P bölümü, `modul-bayrak.md` "dokuz" satırı düzeltmesi, arşive karar notu. Bekçiler: `test_feature_flag_contract`, `test_module_flags`, `test_screen_catalog`, `test_profil_tamligi`, `test_module_grandfathering`, `test_permission_catalog`, `test_role_template_catalog`, `test_mobile_screen_permissions`. Sonda: `hepsi-acik.ts` satırını sil → `test_profil_tamligi` kırmızı.
- **SEMA.** Migration `--create-only` + CHECK/partial unique elle. `startMeter` null-güvenliği backend + Electron + mobil tiplerinde. `defter-beyan.ts`: RollInspection DEFTER/DAMGA. `audit-muafiyeti.ts`: muafiyet YOK. `token-replay-beyan.ts`: yazarı MOTOR'da gelecek kolonlar için beyan ve borç kaydı. Bekçiler: `test_schema_drift`, `test_db_invariants` (+ yeni CHECK'ler), `test_defter_ters_yol`, `test_hard_delete_guard_coverage`, `test_audit_muafiyeti`, `test_record_provenance`, kalite alanı bekçileri. Yeni `test_k4p_sema_sedleri` (DB): her CHECK'i ihlal eden INSERT reddedilir. Sonda: `roll_errors_meter_ck` düşürülünce §1 kırmızı.
- **KAPSAM.** `services/helpers/roll-error-scope.helper.ts`: `ACTIONABLE_ROLL_ERROR_WHERE` (`origin: PROCESS`) + `isActionableRollError` + ham SQL parçası `ACTIONABLE_ROLL_ERROR_SQL` (boğaz-ikiz). Bütün okuyucular/yazarlar sınıflanır: Tambur karar listesi, `closeOrphanRollErrors`, bypass ×2, dashboard bekleyen, split/clone `updateMany` (INSPECTION satırı ebeveynde kalır), tambur-undo, scrap karnesi (yalnız PROCESS) · tarihçe/yedek etki (ikisi). İstemciye RollError döndüren her uç varsayılan olarak yalnız PROCESS döner, `includeInspection=1` yeni istemci içindir; eski tablet null metre görmez. `deleteError` WHERE'ine `origin: PROCESS`. Yeni AST bekçisi `test_roll_error_kapsam`: `src/` altındaki her `rollError.*` / `roll_errors` erişimi helper'ı kullanır ya da `scripts/lib/roll-error-kapsam-beyan.ts`te gerekçeli muaftır (iki yönlü, ölü muaf kırmızı). Sonda: `closeOrphanRollErrors`tan süzgeç kaldırılınca kırmızı. DB bekçisi `test_roll_error_kapsam_db`: INSPECTION satırlı top Tambur'da finalize edilir → satırlar dokunulmadan kalır, dashboard sayımı değişmez, `deleteError` 400. Regresyon: `test_kursun_bypass`, `test_qc2_idempotency`, `test_phase6_reporterror_concurrency`, tambur bekçileri, `test_scrap_scorecard`, `test_quality_scorecard`.
- **MOTOR.** `services/helpers/four-point.helper.ts` (saf): puan, tavan, normalizasyon, yuvarlama, bant; `resolveInspectionWidth`, `resolveFourPointRule`. `services/quality-inspection.service.ts`: `createInspectionTx` (TEK yazar; KK1 ve panel aynı fonksiyonu çağırır), `preview`, `revise`, `voidPreview`, `void`, list/cursor/özet tek where. Rotalar `routes/quality-inspection.routes.ts`, `routes/four-point-rule.routes.ts` (`requireKaliteGuvenceEnabled` + izinler). Token replay boğazı (`run`). Bekçiler: yeni `test_dort_puan_hesap` (DB'siz altın tablo; sonda: HALF_UP → FLOOR kırmızı), yeni `test_kalite_muayene` (DB: oluştur/replay/çakışma/revize 409/iptal/tek aktif/modül 403/izin), yeni `test_kalite_kural_seti`, `test_token_replay_bogaz`, `test_audit_okuma_kaynagi`.
- **KK1.** `stationCanInspect(station)` (`quality-station.helper.ts`; gövde bugün `stepCanApplyQuality`; sahibi `İSTASYON-YETENEK`) + tablet oturum yanıtında `canInspect`. `inventory.service` `createInitialEntryFresh` içinde top yaratıldıktan sonra `createInspectionTx`; zod alan listesine `inspection`; modül/izin yoksa `warnings`. Yeni `test_kk1_muayene_dogum` (sonda: muayene tx dışına taşınınca "top var, muayene yok" ayağı kırmızı). Regresyon: `test_initial_entry_quality`, `test_kk1_duplicate_guard`, `test_kk1_roll_birth`, `test_token_replay_*`, `test_e2e_full_flow`, `test_kk1_entry_sources`.
- **TABLET.** İstasyondan bağımsız bileşen `mobil/src/components/inspection/` (`InspectionPanel.tsx`, `inspectionDraft.ts` saf reducer, `useInspectionPreview.ts`, `inspectionDraftStore.ts` persist; taslak anahtarı konak + top ref'i). Bileşende `kind`/ekran adı karşılaştırması YOK; jest bekçisi kaynakta `StationKind`/`kind ===` aramasıyla bunu ölçer. KK1 konak bağdaştırıcısı mobil:src/screens/Modules/KK1/kk1InspectionHost.ts; KK1Screen'e yalnız düğme, panel yerleşimi ve gövdeye alan eklenir; gösterim kapısı `canInspect`. Mobil `FeatureFlags` aynası + `DEFAULT_FEATURE_FLAGS.kaliteGuvenceEnabled=false`. Kuyruk gövdesi `inspection` alanını süzmez (`mutations.test`). Jest: reducer, render, mutations, announce. Ekran görüntüsü + Read ile kendi incelemesi.
- **EKRAN.** Bağımsız `mobil/src/screens/Modules/Muayene/` (top okutma `trigger="tap"` değil `auto` — tek okuyup kapanan yüzey; okutulan top → bileşen → `POST /api/quality-inspections`, `attemptToken`). `SCREEN_CATALOG` mobil satırı + `SCREEN_MODULE` aynası (modül `kaliteGuvenceEnabled`, izin `mobile:muayene`); `SCREEN_BY_STATION_KIND`e DOKUNULMAZ. Jest + ekran görüntüsü.
- **TANIM.** `Electron/src/pages/Quality/InspectionRules/`, `DefectTypes` sabit puan + sıra, `Items/ItemFormDialog` en alanı (modül açıkken). Vitest + ekran görüntüsü.
- **PANEL.** `Electron/src/pages/Quality/Inspections/` liste/özet/detay/düzelt/iptal önizlemesi/kâğıttan giriş (`attemptToken.ts`). Vitest + ekran görüntüsü.
- **LAB.** §6.1 şema + migration + numara serisi (RECETELER § Yeni numara serisi) + servis/rota + panel `Quality/LabTests/` + top/parti detay kartı. Yeni `test_lab_test` (sonda: onaylı teste sonuç yazma 409'u kaldırılınca kırmızı).
- **SERT.** §6.2 şema + büyük gövde yolu + sihirli bayt doğrulaması + panel `Quality/Certificates/` + bildirim türü (N0-KAT reçetesi) + koşul kaynağı. Yeni `test_sertifika` (sonda: sihirli bayt kontrolü kaldırılınca `.exe` baytı kabul edilir → kırmızı) + `test_sertifika_suresi_tek_kaynak` (AST: liste ve kaynak aynı helper'ı kullanır).
- **RAPOR.** Sevk özeti ucu + panel sekmesi + `INSPECTION_REPORT` sözleşmesi (T0 kataloğuna) + sistem şablonu + Excel. Yeni `test_muayene_raporu_sozlesme` (müşteri spesifikasyonu ezer; iç kolon varsayılanda yok; PDF=Excel eşdeğerliği). Sonda: iç kolon varsayılana alınınca kırmızı.

**Dağıtım.** Backend dilimleri önce iner, panel + tablet sonra. Eski tablet `inspection` göndermez ve davranışı değişmez. Eski panel yeni alanları görmez. `minVersion` artmaz. Tablet yeniliği APK/OTA'dır. Sürüm notu taslağını 1e yazar.

## §8 Riskler

1. **Okuyucu sızıntısı (en yüksek).** INSPECTION satırları süzülmeyen bir okuyucuya düşerse Tambur onları `NO_CUT` ile kapatmaya çalışır ve CHECK tx'i patlatır; Tambur finalize durur. Azaltım: KAPSAM, MOTOR'dan önce iner; AST bekçisi iki yönlüdür; DB bekçisi Tambur finalize'ı INSPECTION satırlı topla koşar. Modül kapalıyken INSPECTION satırı doğmaz, sıfır fark.
2. **`startMeter` null.** 17 dosyada tip değişir; istemciye null sızarsa eski tablet çöker. Azaltım: uçlar varsayılanda yalnız PROCESS döner (KAPSAM). CHECK PROCESS satırında metreyi garanti eder.
3. **KK1 kritik yol.** `createInitialEntry`e ekleme mükerrer kilidi, barkod rezervasyonu ve token replay sırasını bozabilir. Azaltım: muayene yazımı yalnız top yaratıldıktan sonra aynı tx'te yapılır, kilit sırasına dokunulmaz, yeni advisory uzayı yoktur. KK1 bekçi seti tam koşulur.
4. **Ürün kartında en boş.** Bugün hiçbir Item'da en yok; ilk günlerde puan/100 hesaplanmaz. Azaltım: `Roll.width` yedek kaynak, panelde "en bilinmiyor" süzgeci, ürün kartında toplu en girişi (içe aktarım adaptörüne kolon — TANIM).
5. **Müşteri spesifikasyonunun yanlış yere bağlanması.** KK1'de müşteri yoktur; "müşteri spesifikasyonu dereceyi ezer" cümlesi top kalitesini değiştirmek diye okunursa sevk anında kalite yazan ikinci bir yol doğar. Azaltım: spesifikasyon yalnız görünüm ve rapor hesabıdır (§2.5), bekçi muayene satırının değişmediğini ölçer.
6. **Belge tasarımcısı gecikmesi.** RAPOR, T0'ı bekler. Azaltım: sevk özeti ucu ve panel sekmesi T0'dan bağımsız iner; belge yarısı ayrı commit'tir.
7. **Bildirim gecikmesi.** SERT'in bildirim yarısı N1-MOTOR'u bekler. Panel "süresi yaklaşan" süzgeci aynı helper'la önden iner.
8. **DB şişmesi.** Sertifika dosyaları DB'de durur ve yedek boyutuna eklenir. Sınır 5 MB/dosya. Yedek etki ekranı tabloyu sayar (`backup-impact.service`, SERT kapsar).
9. **Çok istasyonlu RollError (Faz B R5).** Partial unique KK1 satırında metre verilirse çakışabilir. Azaltım: servis payload içi tekrarı 400 ile reddeder; konumsuz satır seddin dışındadır.
10. **Taslak kaybı.** Tablet çökmesinde taslak persist store'dan döner; cihaz değişirse kaybolur (kabul; sunucuya taslak yazılmaz).

## §9 Veto listesi (kullanıcıya)

- **V1** Modül anahtarı `kaliteGuvence.enabled` varsayılan KAPALI, deneme profilinde açık. `modul-bayrak.md`deki "dokuz anahtar, genişletilmez" satırı bayat sayılır ve reçeteyle onuncu/on birinci anahtar eklenir.
- **V2** Derece = mevcut `QualityGrade` kataloğu (A/B/C bant ETİKETİDİR, paralel derece tablosu yok). Muayene topun kalitesini OTOMATİK yazmaz, öneri + tek dokunuş.
- **V3** En kaynağı sırası: ürün kartı (yeni `Item.widthCm`) → topun KK1 ölçüsü → yok. Alternatif: ölçülen en önce (ASTM gerçek eni ister).
- **V4** Koşu birimi tavanı varsayılanı 1 yarda (ASTM). Metrik fabrika için kural setinde METER/NONE seçilebilir.
- **V5** "Öneriyi otomatik uygula" ayarı v1'de yok.
- **V6** Sevk onayında müşteri spesifikasyonu uyarısı v2. v1'de yalnız özet sekmesi ve rapor var.
- **V7** Patron bulutu projeksiyonu v1'de yok.
- **V8** Muayene istasyon YETENEĞİDİR (patron yönü). v1 konakları KK1 doğuşu + bağımsız Muayene ekranıdır; Kurşun/Tambur/diğer konaklar `İSTASYON-YETENEK` sonrası gelir (§4.7). FINAL muayene v1'de bağımsız ekrandan ya da panelden girilir.
- **V9** Tambur çocuğuna ebeveyn muayenesi mal edilmez; raporda "muayene yok" görünür.
- **V10** Sertifika dosyaları DB'de (`Bytes`, ≤5 MB, PDF/JPEG/PNG). Dosya sistemi/nesne deposu yok.
- **V11** Yeni izinler: `inspection:read|write|correct|rules`, `labtest:read|write|approve`, `certificate:read|write` (migration yok). SoD zorunluluğu yok.
- **V12** Düzeltme/iptal sebebi v1'de serbest metin (≥3 karakter). Sebep kataloğu kind'ı eklemek on iki yerlik iştir ve ertelenir.
- **V13** Yeni paket YOK (Excel/PDF belge tasarımcısının onaylı yığınından).
