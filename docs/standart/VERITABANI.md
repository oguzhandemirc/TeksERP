# Veritabanı — model, index, enum, migration

Bu dosya "yeni bir tablo/kolon/migration nasıl yazılır" sorusunun cevabıdır. Şema ve migration disiplini bu repoda **ölçülebilir şekilde tutarlıdır** (id kalıbı 116/117 · `@@map` 124/124 · Timestamptz 311/315 · `clientToken` 15/15 · migration adı 232/232 · composite sıra 106/106) — buradaki kuralların hemen hepsi uydurulmadı, koddan çıkarıldı.

Kural biçimi ve zorlama etiketleri: [`README.md`](README.md). Katman-üstü ilkeler: [`ILKELER.md`](ILKELER.md). Kadans: [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md).

**Burada tekrarlanmayan, işaret edilen yerler:** `Teks-Erp/CLAUDE.md` § "Veritabanı kuralları" (14 DB kuralı) · `docs/KOD-KURALLARI.md` (partial index drift · `notIn: []` · `now() AT TIME ZONE 'UTC'` · `applied_steps_count` · `EXPRESSION_UNIQUES` girdisi · cursor sözleşmesi) · `docs/RECETELER.md` (§ enum'a yeni değer, § yeni migration) · `docs/kurallar/deploy-kurulum.md` · kök `CLAUDE.md` § Veri ve defter.

Ham ölçümler: [`kesif/sema-migration.json`](../history/standart-2026-09-05/kesif/sema-migration.json) · [`olcum/faz0-acik-olcumler.json`](../history/standart-2026-09-05/olcum/faz0-acik-olcumler.json).

---

## 1 · Model şablonu

```prisma
/// Çuval izi KATALOĞU — panelden yönetilir ("Kontrol Et", "Eksik"…).
model SackTag {
  id String @id @default(uuid()) @db.Uuid

  /// Rapor/entegrasyon anahtarı — addan türetilir, sonradan DEĞİŞMEZ.
  code String @unique @db.VarChar(64)
  name String  @db.VarChar(60)

  sortOrder Int     @default(0)
  isActive  Boolean @default(true)

  assignments SackTagAssignment[]

  createdById String? @db.Uuid
  updatedById String? @db.Uuid

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt      @db.Timestamptz

  // Ekran sorgusu: "aktif satırlar, sırasıyla" (eşitlik önce).
  @@index([isActive, sortOrder])
  @@map("sack_tags")
}
```

Referans model `prisma/schema.prisma:4580` (SackTag, 2026-09-04) — katalog sınıfının tamamını tek blokta gösterir.

- **[DB-01]** PK `id String @id @default(uuid()) @db.Uuid` yaz; pivot/agregat tabloda `@@id([a, b])` kullan · zorlama: insan:şema kalıbını ölçen AST bekçisi yok — drift bekçisi kolonun TİPİNİ karşılaştırır, adlandırma kalıbını değil · kanıt: 116/117 model (`kesif/sema-migration.json` › `id_kalibi_uniform`); composite PK 6 emsal (`schema.prisma:775, 2795, 3015, 4053, 4792, 6245`) · devralınan: 1 (`SystemLogArchive` — arşiv orijinal UUID'yi korur, `@default` yok)
- **[DB-02]** Model adı PascalCase tekil, `@@map("snake_case_çoğul")` ZORUNLU; kolon düzeyinde `@map` yazma · zorlama: insan:`@@map` eksikliği geçerli Prisma'dır, tsc ve drift bekçisi susar · kanıt: 124/124 model `@@map` taşıyor, kolon `@map` sayısı 0 · devralınan: 1 (`endpoint_latency_daily` tekil ad, `schema.prisma:5734` — tekrarlanmaz)
- **[DB-03]** Her `DateTime` alanı `@db.Timestamptz`; yalnız TAKVİM GÜNÜ anahtarı `@db.Date` olur ve aynı commit'te bekçinin muaf listesine yazılır · zorlama: bekçi:`scripts/test_timestamptz_contract.ts` (iki yönlü — bayat muaf da kırmızı) · kanıt: 311/315 alan; 4 muafın hepsi `@db.Date` (`schema.prisma:5724, 6684, 6810, 7161`) · devralınan: yok
- **[DB-04]** Mutasyona uğrayan modele `createdAt DateTime @default(now())` + `updatedAt DateTime @updatedAt`; append-only defter ve M:N pivot YALNIZ `createdAt` taşır · zorlama: insan:"bu model update ediliyor mu" sorusu çağrı grafiğinden çıkar, şemadan değil · kanıt: `schema.prisma:4607-4608` ↔ `:4615` (pivot notu) · devralınan: 10 model `updatedAt`'siz ama kodda update ediliyor (§12)
- **[DB-05]** Her UUID kolona `@db.Uuid`, her metin kolonuna `@db.VarChar(n)` koy — sınırsız `String` yazma · zorlama: insan:VarChar'sız `String` geçerli Prisma'dır ve `text` olarak doğar; drift bekçisi bunu sapma saymaz · kanıt: 545 `@db.Uuid` kolon; metin emsali `schema.prisma:4584-4586` · devralınan: yok
- **[DB-06]** İdempotent yaratma ucu olan modele `clientToken String? @unique @db.Uuid` ekle (birebir bu yazım) · zorlama: insan:kolonun varlığı değil UCUN idempotent olup olmadığı bir karardır; mekanizma ve replay sözleşmesi `ESZAMANLILIK.md` · kanıt: 15 model, 15/15 aynı yazım · devralınan: 4 tablet ucu token'sız (ES-02 — §12)

## 2 · Model sınıfları

> ⚠️ Telemetri dördüncü sınıf DEĞİL — budanabilirlik ayrı eksen (tezgah izleme tasarımı §4).

| Sınıf | Zaman damgası | Künye | Ayırt edici alanlar | Emsal |
|---|---|---|---|---|
| **KATALOG / master-data** | `createdAt` + `updatedAt` | `createdById` + `updatedById` | değişmez `code` · `name` · `sortOrder` · `isActive` | `SackTag` `schema.prisma:4580`, `ReasonPreset` `:3339` |
| **DEFTER / append-only** | yalnız `createdAt` | künye yerine AKTÖR (`confirmedById` / `decidedById` / `createdById`) | olayın kendisi + `///` "append-only" başlığı | `RollPlanDeviation` `:3249`, `UserRecoveryCode` `:665` |
| **PİVOT / bağ** | yalnız `createdAt` | en fazla `createdById` | `@@id([a,b])` ya da `@@unique([a,b])` | `SackTagAssignment` `:4616`, `PermissionTemplateItem` `:775` |

- **[DB-07]** Katalog modeli dört alanı BİRLİKTE taşır — değişmez `code` (`@unique` ya da `@@unique([kind, code])`) · `name` · `sortOrder Int @default(0)` · `isActive Boolean @default(true)`; katalogdan çıkarma silme değil `isActive:false`'tur · zorlama: insan:alan kümesi model sınıfına göre değişir, jenerik AST kuralı yanlış pozitif üretir · kanıt: `schema.prisma:4580-4612`, `:3339` (`@@unique([kind, code])`); 31 model `isActive` · devralınan: yok
- **[DB-08]** `code` bir kez yazılır ve BİR DAHA DEĞİŞMEZ; adı düzelten operatör geçmiş kırılımını ikiye bölmesin · zorlama: insan:kolon teknik olarak güncellenebilir, yasak servis katmanındadır · kanıt: `schema.prisma:4582-4585` gerekçe yorumu; alan kuralı `docs/kurallar/sebep-katalogu.md` · devralınan: yok
- **[DB-09]** Append-only defter satırı GÜNCELLENMEZ ve SİLİNMEZ — bu yüzden `updatedAt` almaz ve kronolojisi `createdAt`'tir; bu niyet model başlığında `///` ile YAZILI olur · zorlama: insan:append-only niyeti şema alanlarından okunmaz, başlıktan okunur · kanıt: `schema.prisma:3247` ("Append-only: satır SİLİNMEZ, GÜNCELLENMEZ (bu yüzden `updatedAt` yok)") · devralınan: yok
- **[DB-10]** Pivot tabloda bağın tekilliği şemada durur (`@@id([a,b])` ya da `@@unique([a,b])`); pivot künye taşıyacaksa yalnız `createdById` taşır · zorlama: insan:pivotun künye taşıyıp taşımayacağı domain kararıdır · kanıt: 6 composite PK; `schema.prisma:4616` (`@@unique([sackId, tagId])` + `createdById`) · devralınan: yok

## 3 · ⚠️ Künye FK'sı index ALMAZ

Bu bölüm bir hatırlatma değil, bir KURALDIR. 368 FK alanının 272'si bir index/unique/PK ön ekinin kapsamındadır; kapsam dışı 96'nın **91'i künye FK'sıdır ve bu bilinçlidir**. Yazılmazsa yeni gelen onları "eksik" sanıp 91 gereksiz ağaç açar.

- **[DB-11]** Künye FK'sına (`createdById` · `updatedById` · `userId` ve kardeşleri) `@@index` YAZMA · zorlama: insan:muafiyeti belirleyen şey kolon adı değil TRAFİKTİR ("kim yaptı" alanı üstünde süzme yapılmaz); AST bu ayrımı güvenilir yapamaz · kanıt: 91 emsal (`kesif/sema-migration.json` › `fk_kapsamsiz_kim_yapti`); en yeni emsal `schema.prisma:7660` (`StockCount.createdById` — FK YOK, index YOK, bilinçli) · devralınan: yok
- **[DB-12]** Domain FK'sına `@@index([fk])` ZORUNLU; composite unique/index'in ÖN EKİ index sayılır ve dördüncü bir ağaç yazılmaz · zorlama: insan:aynı gerekçe — künye/domain ayrımı mekanik değil · kanıt: 272/368 kapsamda; ön ek emsali `schema.prisma:7705` (`StockCountLine` FK index'i `@@unique([stockCountId, rollId])` ön ekinden geliyor) · devralınan: 5 gerçek boşluk (§12)

## 4 · Index

- **[DB-13]** Composite index sırası: EŞİTLİK kolonları önce, range/order kolonu sonra · zorlama: insan:doğru sıra sorgunun şeklinden okunur, index tanımından değil · kanıt: 106 composite'in 0'ı tarih kolonuyla BAŞLIYOR, 68'i tarih kolonuyla BİTİYOR; emsal `schema.prisma:4610` `@@index([isActive, sortOrder])` · devralınan: yok
- **[DB-14]** Partial index'i ham SQL migration'da kur ve şemada düz `@@index([col])` bırak; partial UNIQUE için şemada `@@unique` yaz · zorlama: bekçi:`scripts/test_db_invariants.ts` + `scripts/test_schema_drift.ts` · kanıt: `schema.prisma:2035` düz `@@index([sackId])` ↔ DB'de `rolls_sackId_idx` PARTIAL; 68 partial (37'si unique); Prisma'nın predicate/unique ayrımı `docs/KOD-KURALLARI.md` § deploy · devralınan: yok

## 5 · Enum mü `VarChar` mı

- **[DB-15]** Değer kümesi büyümeye açıksa pg enum DEĞİL `String @db.VarChar(n)` kullan; enum yalnız KAPALI küme içindir · zorlama: insan:"küme kapalı mı" bir tasarım kararıdır, koddan ölçülmez · kanıt: `schema.prisma:3260-3264` (`RollPlanDeviation.field` — "`ALTER TYPE` + client churn'ü istemiyoruz"), `:5803` (`ImportRun.finishedAt IS NULL` = koşuyor; enum'a `RUNNING` eklenmedi) · devralınan: yok
- **[DB-16]** Enum adı PascalCase, değerleri SCREAMING_SNAKE · zorlama: insan:Prisma enum gövdesi ESLint kapsamı dışında · kanıt: 68 enum; tek istisna `schema.prisma:333` (`PermissionCategory { web mobile admin }`) · devralınan: 1 (tekrarlanmaz)
- **[DB-17]** Enum'a değer eklemek REÇETELİ iştir; `VarChar` kolona yeni değer eklemek de tip-güvensiz yüzeyleri (switch `default`, `Record<string,string>`, dizi/CSV literali, ham SQL, istemci haritaları) elle taramayı gerektirir · zorlama: insan:reçete adımlarının tamamlandığı AST'den ölçülmez · kanıt: `docs/RECETELER.md` § Prisma enum'una yeni değer; "altıncı enum değeri unutuldu" sınıfı `docs/KOD-KURALLARI.md` · devralınan: yok

## 6 · `///` gerekçe kuralı

Şemanın **%43,6'sı yorumdur** ve bu bir değerdir (`ILKELER.md` [IL-24]): karar kaydı koruduğu satırın yanında yaşar.

- **[DB-18]** SIRA DIŞI her karar satırın ÜSTÜNDE `///` ile gerekçelenir — FK yok · index yok · enum yerine `VarChar` · `onDelete` · nullable seçimi · `@db.Date` · `@@map` sapması · zorlama: insan:"sıra dışı mı" ancak §1–§5 kalıbıyla karşılaştırılarak anlaşılır · kanıt: 87/124 model başlığında `///`; emsaller `schema.prisma:4588-4593` (hex kendi kolonu, `Color` FK'sı DEĞİL), `:6802` (`rateDate @db.Date` — takvim günü anahtarı), `:3255-3257` (nullable `workOrderStepId`) · devralınan: yok
- **[DB-19]** İlişki adı `<Model><Rol>` PascalCase'tir (aynı hedefe ikinci ilişki varsa ad ZORUNLU); `onDelete` yalnız karar verildiğinde yazılır ve gerekçesi `///` ile durur · zorlama: tsc (ikinci ilişkide ad zorunlu) + insan:gerekçenin varlığı ölçülmez · kanıt: 529 ilişkinin 322'si adlandırılmış; `onDelete` dağılımı Cascade 51 / Restrict 71 / SetNull 5 / belirtilmemiş 246 · devralınan: yok

## 7–8 · Migration yazımı · şema-dışı nesne envanteri → ayrı dosya

Bu iki bölüm 2026-09-13'te [`VERITABANI-MIGRATION.md`](VERITABANI-MIGRATION.md)'ye taşındı (`docs/standart/VERITABANI-MIGRATION.md`) — bu dosya boyut tavanına 23 bayt kalmıştı; tavan YÜKSELTİLMEDİ, dosya BÖLÜNDÜ. Orada da **§7** (migration yazımı, [DB-20]…[DB-29d] + [DB-39]) ve **§8** (şema-dışı nesne envanteri, [DB-30]) numaralarıyla duruyorlar; aşağıdaki §9–§13 numaraları değişmedi.

## 9 · Soft delete ve meşru hard delete istisnaları

> ⚠️ **REVİZE (2026-09-10)** — defter-öncelikli doktrin bu bölümü ezdi. Dört sınıf İKİYE indi (① ve ② KALKTI; ③ ticari/yapılandırma diye bölündü). "Sekiz site" ölçümü BAYAT: yeniden sayıldı **87** (17 `.delete(` + 70 `.deleteMany(`). Kanonik metin ve defter envanteri: `docs/kurallar/defter.md`.

Varsayılan silme SOFT'tur (kök `CLAUDE.md` § Veri ve defter). Bugün geçerli İKİ meşru sınıf:

| Sınıf | Neden meşru | Emsal |
|---|---|---|
| **④ Deftere hiç yazmamış taslak** | hiçbir bakiye/defter satırı üretmedi — geri alınacak "olay" yok | `invoice.service.ts:883` (`deleteMany({id, status: DRAFT})` — ATOMİK CLAIM, `count===0` → taze okuma → 409) |
| **③b Yapılandırma pivotu replace** | satırın parasal/ticari/kalite sonucu yok; "kim değiştirdi" KARAR satırına yazılır | `RollProperty` · `StationProperty` · `ItemAllowedColor` · `RouteStepProperty` |

- **[DB-31]** Hard delete yalnız bu İKİ sınıftan birine girerek yazılır; girmiyorsa DURUM GEÇİŞİ yaz (`isActive:false` / `VOIDED` / `revokedAt`+`revokedById`) · zorlama: insan:sınıf sorusudur — allowlist'li tripwire YAZILACAK · kanıt: 87 site (2026-09-10) · devralınan: 87 sitenin tamamı
- **[DB-32]** Yeni hard delete yolu açmak KARARDIR ve varsayılan cevap HAYIR'dır: `defter.md` sınıf tablosuna gerekçesiyle girer, audit yazar, guard'ı/claim'i ÖNCE yazılır · zorlama: insan:liste elle tutulur · kanıt: `invoice.service.ts:883` · devralınan: yok
- **[DB-38]** Defter satırı SİLİNMEZ ve GÜNCELLENMEZ; geri alma ters satır yazar, ileri damgayı (`dispatchedAt` · `weighedAt` · `invoicedAt`) `null`'lamaz — DURUM BAYRAĞI (`remainderClosedAt`) bu kuralın DIŞINDADIR, defteri `RollVariance`tır · zorlama: bekçi:§24d (`test_consistency_derived.ts`) · kanıt: `RollOperation` 7 · `RollMovement` 4 · `PaymentAllocation` 2 `deleteMany` (2026-09-10) · devralınan: 13 site

## 10 · Sorgu, Decimal, zaman

14 numaralı DB kural listesi `Teks-Erp/CLAUDE.md` § "Veritabanı kuralları"dadır (cursor pagination · `select` ≠ `include` · `$queryRaw` · `createMany` · kısa tx · snapshot JSON). Burada yalnız **yeni kodda zorunlu** iki tanesi kural satırı olarak durur:

- **[DB-33]** Para/metraj kolonu `Decimal` + `@db.Decimal(p,s)`'tir ve ölçek kataloğuna uyar — metraj `(12,3)` · tutar `(14,2)` · kur `(18,6)`; okuma/yazma yolu `Prisma.Decimal` ya da DB-side `increment`/`decrement` kullanır, JS float kullanmaz · zorlama: insan:`Number(qty|amount|total)` çağrılarının çoğu sunum/serileştirmedir (95 vuruş ölçüldü, tek tek doğrulanmadı) — AST ayıramaz · kanıt: 97 Decimal kolon; `Prisma.Decimal` 662 kullanım, increment/decrement 34 · devralınan: yok
- **[DB-34]** `Json` kolon yalnız snapshot/config/audit yükü içindir; Prisma JSON filtresiyle sorgulanmaz ve liste sorgusunda `omit` ile düşürülür · zorlama: insan:eksik `omit` yalnız yanıt boyutunda görünür, kapı kurulmadı · kanıt: 25 Json kolon, Prisma JSON filtresi 0; emsal `traveler-card.service.ts:751` (`omit: { snapshot: true }`) · devralınan: 1 sorgu index'siz (`system_logs.newData`, §12)

## 11 · ⚠️ Kapı asimetrisi

Ölçüm: `Teks-Erp/CLAUDE.md`'deki **14 DB kuralının yalnız 4'ünde mekanik kapı var** (kural 3 → `test_db_invariants` · 4 → aynı bekçi · 11 → ESLint · ek-A Timestamptz → `test_timestamptz_contract`). Kural 10 (tx içinde dış I/O yok), 12 (`EXPLAIN ANALYZE`) ve 13 (snapshot listede) için hiçbir kapı yoktur.

**Kapısız kural bir NİYET beyanıdır: uyumu ÖLÇÜLMEMİŞTİR.** Bu dosyadaki her satırın `zorlama:` etiketi bunu tek tek gösterir — `insan:` gören okuyucu o kuralın tutup tutmadığını bilmediğini bilir.

- **[DB-35]** "Bu kural tutuyor" cümlesi ancak bir kapı ya da koşulmuş bir ölçüm gösterilerek kurulur; kapısız kural için "muhtemelen uyumlu" yazılmaz · zorlama: insan:etiketin kendisi kapıdır (`ILKELER.md` [IL-13]) · kanıt: `kesif/sema-migration.json` › `docVsCode_14_madde` — üç madde "BELİRSİZ (kapısız)" hükmüyle kapandı · devralınan: yok

## 12 · Bilinen boşluklar

Bunlar ölçüldü, kapatılmadı; her biri ayrı bir iştir. Tekrarlanmazlar — yeni kod bu kalıpları örnek almaz.

- **5 index'siz domain FK** ([DB-12] ihlali): `schema.prisma:3702` `SubcontractorDirectShipAllocation.dispatchId` · `:3747` `DirectShipment.branchId` · `:4529` `Sack.branchId` · `:5983` `WarehouseMovement.shipmentId` · `:5984` `WarehouseMovement.rollReturnId`. Dev DB'de ilgili tablolar 0–353 satır. ⚠️ 2026-09-05'te KAPANDI (`20260905140000_indexsiz_domain_fk`). Kurulum penceresinin ne kadar uzadığı ölçülmedi ([DB-29b]) ama bu bir ENGEL DEĞİL: migration pm2 durdurulduktan sonra koşar, kilit kimseyi bloklamaz.
- **10 model `updatedAt`'siz ama kodda update ediliyor** ([DB-04] ihlali): `rollOperation` · `subcontractorDispatchItem` · `rollVariance` · `sackTagAssignment` · `userRecoveryCode` · `itemAllowedProperty` · `itemAllowedColor` · `rollProperty` · `importRun` · `yarnMovement` (satır sayıları `olcum/faz0-acik-olcumler.json` › `M_01`).
- **`system_logs.newData ->> 'event'` sorgusu GIN'siz** (`inventory.service.ts:2509`): jsonb GIN sayısı 0, tablo 24.482 satır — vardiya dışı iş.
- **Şema dışı kalan devralınanlar:** `Roll` 554 satır ve `User` 187 satır (§13 sınırının üstünde) · `PermissionCategory` küçük-harf enum · `endpoint_latency_daily` tekil `@@map`.

## 13 · Boyut

Şemada dosya boyutu tavanı anlamsızdır (tek dosya 7.749 satır, bilinçli); `schema.prisma` `ILKELER.md` [IL-23] muafiyet sınıfındadır. Ölçülen fiilî sınırlar model ve migration başınadır.

- **[DB-36]** Yeni model ≤ 120 satır (yorumlar dahil ≈ 60 alan satırı); aşıyorsa "bu bir tablo mu, iki mi" sorusu sorulur ve alt-tablo/pivot ayrımı düşünülür · zorlama: insan:`max-lines` `.prisma` dosyasına uygulanamaz, model başına ölçen bekçi yok · kanıt: model gövdesi p50 34 / p90 93 satır · devralınan: 2 (`Roll` 554, `User` 187 — sınır dışı)
- **[DB-37]** Yeni migration ≤ 200 satır; ÇOK-NESNELİ sertleştirme turu bilinçli istisnadır ve gerekçesi dosya BAŞLIĞINDA durur · zorlama: insan:aynı gerekçe — migration SQL'i lint kapsamı dışında · kanıt: p50 20 / p90 91 / p99 431 satır; 200'ü aşan 6 dosyanın hepsi tek-konu değil şema-geneli tur (`20260525174522_init` 1.678 · `20260611084953_native_uuid_pk_fk` 2.254 · `20260801040000_timestamptz_conversion` 428 · `20260813201311_finance_preaccounting` 431 · `20260814072115_paket_d_yarn_price_purchase_order` 236 · `20260819060000_search_fold` 282) · devralınan: 6
