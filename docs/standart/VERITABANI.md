# Veritabanı — model, index, enum, migration

Bu dosya "yeni bir tablo/kolon/migration nasıl yazılır" sorusunun cevabıdır. Şema ve migration disiplini bu repoda **ölçülebilir şekilde tutarlıdır** (id kalıbı 116/117 · `@@map` 124/124 · Timestamptz 311/315 · `clientToken` 15/15 · migration adı 232/232 · composite sıra 106/106) — buradaki kuralların hemen hepsi uydurulmadı, koddan çıkarıldı.

Kural biçimi ve zorlama etiketleri: [`README.md`](README.md). Katman-üstü ilkeler: [`ILKELER.md`](ILKELER.md). Kadans: [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md).

**Burada tekrarlanmayan, işaret edilen yerler:** `Teks-Erp/CLAUDE.md` § "Veritabanı ve Prisma" (14 DB kuralı) · `docs/KOD-KURALLARI.md` (partial index drift · `notIn: []` · `now() AT TIME ZONE 'UTC'` · `applied_steps_count` · `EXPRESSION_UNIQUES` girdisi · cursor sözleşmesi) · `docs/RECETELER.md` (§ enum'a yeni değer, § yeni migration) · `docs/kurallar/deploy-kurulum.md` · kök `CLAUDE.md` § Veri ve defter.

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

## 2 · Üç model sınıfı

| Sınıf | Zaman damgası | Künye | Ayırt edici alanlar | Emsal |
|---|---|---|---|---|
| **KATALOG / master-data** | `createdAt` + `updatedAt` | `createdById` + `updatedById` | değişmez `code` · `name` · `sortOrder` · `isActive` | `SackTag` `schema.prisma:4580`, `ReasonPreset` `:3339` |
| **DEFTER / append-only** | yalnız `createdAt` | künye yerine AKTÖR (`confirmedById` / `decidedById` / `createdById`) | olayın kendisi + `///` "append-only" başlığı | `RollPlanDeviation` `:3249`, `UserRecoveryCode` `:665` |
| **PİVOT / bağ** | yalnız `createdAt` | en fazla `createdById` | `@@id([a,b])` ya da `@@unique([a,b])` | `SackTagAssignment` `:4616`, `PermissionTemplateItem` `:775` |

- **[DB-07]** Katalog modeli dört alanı BİRLİKTE taşır — değişmez `code` (`@unique` ya da `@@unique([kind, code])`) · `name` · `sortOrder Int @default(0)` · `isActive Boolean @default(true)`; katalogdan çıkarma silme değil `isActive:false`'tur · zorlama: insan:alan kümesi model sınıfına göre değişir, jenerik AST kuralı yanlış pozitif üretir · kanıt: `schema.prisma:4580-4612`, `:3339` (`@@unique([kind, code])`); 31 model `isActive` · devralınan: yok
- **[DB-08]** `code` bir kez yazılır ve BİR DAHA DEĞİŞMEZ; adı düzelten operatör geçmiş kırılımını ikiye bölmesin · zorlama: insan:kolon teknik olarak güncellenebilir, yasak servis katmanındadır · kanıt: `schema.prisma:4582-4585` gerekçe yorumu; alan kuralı `docs/kurallar/sebep-katalogu.md` · devralınan: yok
- **[DB-09]** Append-only defter satırı GÜNCELLENMEZ ve SİLİNMEZ — bu yüzden `updatedAt` almaz ve kronolojisi `createdAt`'tir; bu niyet model başlığında `///` ile YAZILI olur · zorlama: insan:append-only niyeti şema alanlarından okunmaz, başlıktan okunur · kanıt: `schema.prisma:3247` ("Append-only: satır SİLİNMEZ, GÜNCELLENMEZ (bu yüzden `updatedAt` yok)") · devralınan: yok
- **[DB-10]** Pivot tabloda bağın tekilliği şemada durur (`@@id([a,b])` ya da `@@unique([a,b])`); pivot künye taşıyacaksa yalnız `createdById` taşır · zorlama: insan · kanıt: 6 composite PK; `schema.prisma:4616` (`@@unique([sackId, tagId])` + `createdById`) · devralınan: yok

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

## 7 · Migration yazımı

- **[DB-20]** Dizin adı `prisma/migrations/<14 hane>_<snake_slug>/migration.sql` · zorlama: insan:ad kalıbını ölçen kapı yok — `--create-only` damgayı zaten üretir, slug insana kalır · kanıt: 232/232 dosya `^[0-9]{14}_[a-z0-9_]+$` · devralınan: yok
- **[DB-21]** SQL'i ELLE yaz: `prisma migrate dev` koşma; `--create-only` ile üret ve iki DEFERRABLE composite FK'nın `DropForeignKey` satırlarını SİL · zorlama: hook:`scripts/claude-hooks/bash-guard.mjs:29` (create-only'siz `migrate dev` durdurulur) + insan:silme adımının yapıldığı ölçülmez · kanıt: 135 dosya (%58) tamamen elle; tuzağın kanonik anlatımı `prisma/migrations/20260904120442_cuval_izleri_etiket/migration.sql:6-16` · devralınan: yok
- **[DB-22]** Dosya bir gerekçe bloğuyla açılır: ne yapıyor · ADDITIVE mi · üretilmiş çıktıdan hangi satır elle silindi · zorlama: insan:başlığın içeriği ölçülemez (`ILKELER.md` [IL-25] ile aynı sınıf) · kanıt: `20260904120442_cuval_izleri_etiket/migration.sql:1-16` · devralınan: yok
- **[DB-23]** Elle koşulan SQL IDEMPOTENT yazılır (`IF NOT EXISTS` / `IF EXISTS`) — `apply-migration.ts` defterde satır varsa `resolve`'u atlar ama SQL'i YİNE koşar · zorlama: insan:idempotency SQL semantiğidir, grep'le ölçülmez · kanıt: 34 dosya `IF NOT EXISTS`, 29 dosya `IF EXISTS`; script sözleşmesi `scripts/apply-migration.ts:1-23` · devralınan: yok
- **[DB-24]** Canlı veriye tekillik/sed eklerken YUMUŞAK KAPI kur: `DO $etiket$` bloğu mükerrerleri sayar → varsa `RAISE NOTICE` + ATLA, yoksa `CREATE UNIQUE INDEX IF NOT EXISTS`; sert `RAISE EXCEPTION` prod deploy'unu kilitler · zorlama: insan:blok yapısı AST'den değil SQL'den okunur · kanıt: `20260821150000_name_fold_unique_live/migration.sql:52-76`; 5 dosya `RAISE NOTICE` · devralınan: yok
- **[DB-25]** Büyük tabloya DDL koyan migration EN BAŞA `SET statement_timeout = 0;` yazar · zorlama: insan:"büyük tablo mu" satır sayımıdır, şemadan okunmaz · kanıt: 42/232 dosya; DB ayarı `Teks-Erp/docker-compose.yml:26` (`statement_timeout=50s`) · devralınan: yok
- **[DB-26]** ⚠️ `CREATE INDEX CONCURRENTLY` YAZMA — Prisma migration'ı tek transaction içinde koşar, orada çalışmaz · zorlama: insan:migration SQL'i hiçbir lint kapsamında değil · kanıt: repoda 0 gerçek kullanım; gerekçe yorumları `20260829140000_denetim_sema_kisitlari/migration.sql:64-65` ve `20260830090000_items_ad_kod_seddi/migration.sql:14-15` · devralınan: yok
- **[DB-27]** İfade index'inin fonksiyonu `IMMUTABLE` (+`STRICT`) beyan edilir ve karakter sınıfı AÇIK yazılır (`\s` locale bağımlıdır — kök `CLAUDE.md` yasak listesi) · zorlama: insan:aynı gerekçe — migration SQL'i lint dışında · kanıt: `20260819060000_search_fold/migration.sql:89` (`LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE`) ve `:101` (`'[ \t\n\r\f\v]+'`) · devralınan: yok
- **[DB-28]** Uygulama TEK komuttur: `npx tsx scripts/apply-migration.ts <ad> [--apply]` (varsayılan dry-run; git add → SQL → `resolve` → drift + hijyen doğrulaması); UYGULANMIŞ dosyaya bir daha dokunulmaz, düzeltme yeni migration ile gelir · zorlama: bekçi:`scripts/test_schema_drift.ts` + `scripts/test_migration_hygiene.ts` (script ikisini kendisi koşar) · kanıt: `scripts/apply-migration.ts:1-23` (2026-08-13 vakası: `resolve` SQL'e HİÇ bakmaz) · devralınan: yok
- **[DB-29]** Şema provası EN ESKİ CANLI DUMP üzerinde koşulur ve SÜRE ölçülür; ölçülmeden canlıya gitmez · zorlama: insan:prova bir ops adımıdır, repoda izi yoktur · kanıt: `olcum/faz0-acik-olcumler.json` › `M_01…hukum` — dev DB'de hiçbir tablo 250 satırı geçmiyor, yani dev süresi canlı maliyeti ÖLÇMEZ (`system_logs` 24.482 satır) · devralınan: yok

## 8 · Şema-dışı nesne envanteri — DOKUZ liste, iki yönlü

- **[DB-30]** Şema-dışı nesne kuran migration, aynı commit'te `scripts/test_db_invariants.ts` envanterine satırını yazar · zorlama: bekçi:`scripts/test_db_invariants.ts` (İKİ YÖNLÜ — envanterde olup DB'de olmayan da, DB'de olup envanterde olmayan da kırmızı) · kanıt: dokuz liste ve satırları — `PARTIAL_INDEXES:100` (68) · `CHECK_CONSTRAINTS:317` (59) · `DEFERRABLE_FKS:444` (2) · `EXT_STATS:457` (1) · `EXPRESSION_UNIQUES:469` (4) · `TRIGGERS:501` (3) · `REQUIRED_EXTENSIONS:544` (2) · `EXPECTED_FUNCTIONS:554` (2) · `EXPECTED_COLLATIONS:576` (1) · devralınan: yok

Kırmızı bir envanter kontrolü "bu nesneyi kim koydu ve neden" sorusudur; cevabı nesneyi silmek değil satırı yazmaktır (`Teks-Erp/CLAUDE.md` DB kuralı 4). ⚠️ Kanonik sayı **bekçinin kendisidir**: envanteri "beş liste" diye anan cümleler bayattır.

## 9 · Soft delete ve meşru hard delete istisnaları

Varsayılan silme SOFT'tur (kök `CLAUDE.md` § Veri ve defter). Kod gerçeği ölçüldü: **sekiz hard delete sitesinin sekizi de meşru istisna** çıktı (`olcum/faz0-acik-olcumler.json` › `M_04_hard_delete_hukumleri`). Bunlar dört SINIFA girer:

| Sınıf | Ne yapar | Siteler |
|---|---|---|
| ① Bağımlılık-guard'lı silme | silmeden önce bağımlı sayar → 409 | `sack-tag.service.ts:218` (assignment count + FK Restrict) · `batch.service.ts:337` (beş iz kapısı: top / fason sevki / çocuk parti / merge) |
| ② Alias / karar satırı | satırın kendi içeriğinden başka içeriği yok; "sil" = "kararı geri al" | `customer-alias.service.ts:94` · `:198` (koşullu: `assigned=true` soft temizlenir) · `duplicate-review.service.ts:151` (MERGED geri açılamaz → 409) |
| ③ Pivot / çocuk satır replace | üst kayıt yaşar, çocuk kümesi yenilenir | `label-template.service.ts:886` (primary varyant korunur → 400) · `permission-management.service.ts:1041` (DALLI: sistem rolü `isActive:false`, yalnız fabrikanın kendi şablonu silinir) |
| ④ Deftere hiç yazmamış taslak | belge hiçbir bakiye üretmedi | `invoice.service.ts:883` (`deleteMany({id, status: DRAFT})` — ATOMİK CLAIM, `count===0` → taze okuma → 409) |

- **[DB-31]** Hard delete yalnız yukarıdaki dört sınıftan birine girerek yazılır; sınıfa girmiyorsa soft delete kullan · zorlama: insan:`prisma.x.delete` çağrısının meşru olup olmadığı sınıf sorusudur, AST ayıramaz · kanıt: sekiz sitenin sekizi de sınıflandı (M-04 hükümleri) · devralınan: yok
- **[DB-32]** Yeni bir hard delete YOLU açmak bir KARARDIR: yukarıdaki tabloya gerekçesiyle girer, `AuditService.log()` ile iz bırakır ve silmeden önce guard'ı/claim'i yazılır · zorlama: insan:liste elle tutulur — kapsamı ölçen bekçi yok · kanıt: sekiz sitenin hepsi audit yazıyor; `invoice.service.ts:883` claim'li silmenin örnek alınacak biçimidir · devralınan: yok

## 10 · Sorgu, Decimal, zaman

14 numaralı DB kural listesi `Teks-Erp/CLAUDE.md` § "Veritabanı ve Prisma"dadır (cursor pagination · `select` ≠ `include` · `$queryRaw` · `createMany` · kısa tx · snapshot JSON). Burada yalnız **yeni kodda zorunlu** iki tanesi kural satırı olarak durur:

- **[DB-33]** Para/metraj kolonu `Decimal` + `@db.Decimal(p,s)`'tir ve ölçek kataloğuna uyar — metraj `(12,3)` · tutar `(14,2)` · kur `(18,6)`; okuma/yazma yolu `Prisma.Decimal` ya da DB-side `increment`/`decrement` kullanır, JS float kullanmaz · zorlama: insan:`Number(qty|amount|total)` çağrılarının çoğu sunum/serileştirmedir (95 vuruş ölçüldü, tek tek doğrulanmadı) — AST ayıramaz · kanıt: 97 Decimal kolon; `Prisma.Decimal` 662 kullanım, increment/decrement 34 · devralınan: yok
- **[DB-34]** `Json` kolon yalnız snapshot/config/audit yükü içindir; Prisma JSON filtresiyle sorgulanmaz ve liste sorgusunda `omit` ile düşürülür · zorlama: insan:eksik `omit` yalnız yanıt boyutunda görünür, kapı kurulmadı · kanıt: 25 Json kolon, Prisma JSON filtresi 0; emsal `traveler-card.service.ts:751` (`omit: { snapshot: true }`) · devralınan: 1 sorgu index'siz (`system_logs.newData`, §12)

## 11 · ⚠️ Kapı asimetrisi

Ölçüm: `Teks-Erp/CLAUDE.md`'deki **14 DB kuralının yalnız 4'ünde mekanik kapı var** (kural 3 → `test_db_invariants` · 4 → aynı bekçi · 11 → ESLint · ek-A Timestamptz → `test_timestamptz_contract`). Kural 10 (tx içinde dış I/O yok), 12 (`EXPLAIN ANALYZE`) ve 13 (snapshot listede) için hiçbir kapı yoktur.

**Kapısız kural bir NİYET beyanıdır: uyumu ÖLÇÜLMEMİŞTİR.** Bu dosyadaki her satırın `zorlama:` etiketi bunu tek tek gösterir — `insan:` gören okuyucu o kuralın tutup tutmadığını bilmediğini bilir.

- **[DB-35]** "Bu kural tutuyor" cümlesi ancak bir kapı ya da koşulmuş bir ölçüm gösterilerek kurulur; kapısız kural için "muhtemelen uyumlu" yazılmaz · zorlama: insan:etiketin kendisi kapıdır (`ILKELER.md` [IL-13]) · kanıt: `kesif/sema-migration.json` › `docVsCode_14_madde` — üç madde "BELİRSİZ (kapısız)" hükmüyle kapandı · devralınan: yok

## 12 · Bilinen boşluklar

Bunlar ölçüldü, kapatılmadı; her biri ayrı bir iştir. Tekrarlanmazlar — yeni kod bu kalıpları örnek almaz.

- **5 index'siz domain FK** ([DB-12] ihlali): `schema.prisma:3702` `SubcontractorDirectShipAllocation.dispatchId` · `:3747` `DirectShipment.branchId` · `:4529` `Sack.branchId` · `:5983` `WarehouseMovement.shipmentId` · `:5984` `WarehouseMovement.rollReturnId`. Dev DB'de ilgili tablolar 0–213 satır; **canlı maliyet ÖLÇÜLMEDİ** ve `CONCURRENTLY` yasak olduğu için index migration'ı tabloyu kilitler → [DB-29] provası şart.
- **10 model `updatedAt`'siz ama kodda update ediliyor** ([DB-04] ihlali): `rollOperation` · `subcontractorDispatchItem` · `rollVariance` · `sackTagAssignment` · `userRecoveryCode` · `itemAllowedProperty` · `itemAllowedColor` · `rollProperty` · `importRun` · `yarnMovement` (satır sayıları `olcum/faz0-acik-olcumler.json` › `M_01`).
- **`system_logs.newData ->> 'event'` sorgusu GIN'siz** (`inventory.service.ts:2509`): jsonb GIN sayısı 0, tablo 24.482 satır — vardiya dışı iş.
- **Şema dışı kalan devralınanlar:** `Roll` 554 satır ve `User` 187 satır (§13 sınırının üstünde) · `PermissionCategory` küçük-harf enum · `endpoint_latency_daily` tekil `@@map`.

## 13 · Boyut

Şemada dosya boyutu tavanı anlamsızdır (tek dosya 7.749 satır, bilinçli); `schema.prisma` `ILKELER.md` [IL-23] muafiyet sınıfındadır. Ölçülen fiilî sınırlar model ve migration başınadır.

- **[DB-36]** Yeni model ≤ 120 satır (yorumlar dahil ≈ 60 alan satırı); aşıyorsa "bu bir tablo mu, iki mi" sorusu sorulur ve alt-tablo/pivot ayrımı düşünülür · zorlama: insan:`max-lines` `.prisma` dosyasına uygulanamaz, model başına ölçen bekçi yok · kanıt: model gövdesi p50 34 / p90 93 satır · devralınan: 2 (`Roll` 554, `User` 187 — sınır dışı)
- **[DB-37]** Yeni migration ≤ 200 satır; ÇOK-NESNELİ sertleştirme turu bilinçli istisnadır ve gerekçesi dosya BAŞLIĞINDA durur · zorlama: insan:aynı gerekçe — migration SQL'i lint kapsamı dışında · kanıt: p50 20 / p90 91 / p99 431 satır; 200'ü aşan 6 dosyanın hepsi tek-konu değil şema-geneli tur (`20260525174522_init` 1.678 · `20260611084953_native_uuid_pk_fk` 2.254 · `20260801040000_timestamptz_conversion` 428 · `20260813201311_finance_preaccounting` 431 · `20260814072115_paket_d_yarn_price_purchase_order` 236 · `20260819060000_search_fold` 282) · devralınan: 6
