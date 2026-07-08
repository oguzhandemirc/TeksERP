# DB Oturumu — Kalan İş Listesi (backend denetiminden devir)

> **Amaç:** Backend kod+mimari denetimi (2026-07) sırasında **kasıtlı olarak DB oturumuna devredilen** şema/migration/installer işleri. Backend tarafının DB-dışı backlog'u (P0+P1+P2+P3+P3-round2 = 94/94) `feat/label-studio`'da **TAMAM**. Bu dosya yalnız **DB oturumunda** yapılacakları toplar.
>
> **Branch:** DB işleri `fix/db-installer-audit` (PR #60) hattında; app-code hattı `feat/label-studio`. Karıştırma.
>
> **⚠️ Altın kural (bir kez ısırıldık):** İki oturum tek yerel `adnansahin_db`'yi paylaşırsa migration karşı dalı sessizce kırar (geçmişte `dyehouseNote` kolonu düşünce backend'in WO-create testleri kırıldı). **Tüm şema/migration mutasyonları TEK oturumda (bu oturumda) toplanmalı.** Backend oturumu bu dosyadaki hiçbir migration'ı uygulamaz.

---

## 0) Uygulamadan ÖNCE oku — operasyonel kurallar (CLAUDE.md)

- **`SET statement_timeout = 0;` migration'ın EN BAŞINA.** App DB'de `statement_timeout=50s` aktif; büyük tabloda `CREATE INDEX` / `ALTER COLUMN TYPE` 50s'de **iptal edilir** (`canceling statement due to statement timeout`). Yüz binlerce+ satıra dokunan her DDL migration'ının başına koy.
- **Index/tablo-rewrite DDL'i vardiya DIŞINDA deploy et.** `CREATE INDEX` / `ALTER COLUMN TYPE` büyük tabloda yazma kilidi alır. Gece/hafta sonu `prisma migrate deploy`. Sıfır-downtime gerekirse `CREATE INDEX CONCURRENTLY` + psql manuel.
- **Migration MANUEL uygulanır** (paylaşılan DB'de `migrate dev` RESET ister): `npx prisma migrate diff` → SQL üret → `psql` ile uygula → `prisma migrate resolve --applied <migration>`. (Geçmiş DB oturumu bu akışı kullandı.)
- **Şema tip konvansiyonu (O-11):** yeni `DateTime` → `@db.Timestamptz`; yeni UUID taşıyan kolon → `@db.Uuid`. Raw script'te `timestamp` ile karşılaştırırken `now() AT TIME ZONE 'UTC'` (Europe/Istanbul 3 saat kayma tuzağı).
- **DB adı ortama göre:** dev=`adnansahin_db`, Windows prod=`TeksErpDb`.
- Her tip/enum dönüşümünden **önce `SELECT DISTINCT`** ile envanter çıkar — `USING ::type` cast eşleşmeyen değerde patlar.

---

## Bölüm A — Şema / Migration (asıl DB işi)

### A1. Tip düzeltmeleri (enum + uuid)

#### F3 — String/TEXT ID kolonları `@db.Uuid` olmalı
- **Kolonlar:** `Roll.batchSplitId` (schema.prisma ~L877), `PrintedDocument.sourceId`, `RollReturn.prev*`.
- **Neden DB:** `USING col::uuid` cast'li ham migration; app-code ile yapılamaz.
- **DDL:**
  ```sql
  SET statement_timeout = 0;
  ALTER TABLE rolls ALTER COLUMN "batchSplitId" TYPE uuid USING "batchSplitId"::uuid;
  ALTER TABLE printed_documents ALTER COLUMN "sourceId" TYPE uuid USING "sourceId"::uuid;
  -- RollReturn.prev* kolonları için de aynı USING ::uuid cast
  ```
- **App sonrası:** `prisma generate` yeter; ekstra kod beklenmez.
- **Risk:** cast öncesi geçersiz/uuid-olmayan değer varsa patlar → önce `SELECT DISTINCT` ile temizle.

#### F6 + D-15 (BİRLEŞİK) — `Device.kind` → `DeviceKind` enum + katalog/limit
> **Not:** F6 (backend denetimi) ve D-15 (DB denetimi) **aynı Device.kind işini** işaret ediyor — **tek seferde** yap, iki kez uygulama.
- **Kolonlar:** `Device.kind` (~L500, şu an `String @default("TABLET") @db.VarChar(16)`), `Station.department` (~L430, limitsiz), `Permission.module` (~L349, limitsiz), `PermissionCategory` enum (lowercase→UPPERCASE?).
- **Neden DB:** enum tipi + `USING`-cast migration; PermissionCategory normalize ederse enum recreate + seed + UI.
- **DDL:**
  ```sql
  SET statement_timeout = 0;
  CREATE TYPE "DeviceKind" AS ENUM ('TABLET','PHONE','DESKTOP');
  UPDATE devices SET kind = upper(kind);
  ALTER TABLE devices ALTER COLUMN kind DROP DEFAULT;
  ALTER TABLE devices ALTER COLUMN kind TYPE "DeviceKind" USING kind::"DeviceKind";
  ALTER TABLE devices ALTER COLUMN kind SET DEFAULT 'TABLET';
  -- department/module: min-invaziv VarChar limiti (veya katalog tablosu — ürün kararı)
  ALTER TABLE stations   ALTER COLUMN department TYPE varchar(32);
  ALTER TABLE permissions ALTER COLUMN module    TYPE varchar(32);
  ```
- **App sonrası:** `prisma generate`; `Device.kind` okuyan/yazan uçları enum değerine geçir. PermissionCategory UPPERCASE seçilirse `seed.ts` + tüketen UI/servis. VarChar yolu ise Zod `max()` hizala.
- **Risk:** karışık case (`"tablet"`) → cast öncesi `upper()` şart. `Permission.module` VarChar(32)'yi aşıyorsa ALTER patlar → önce `max(length)` kontrol. Tablolar küçük (devices/stations/permissions) → kilit kısa.

#### D-13 — `foldType` serbest string → HC-06 kanal eşleşme riski
- **✅ ÇÖZÜLDÜ — BACKEND-ONLY, DB İŞİ YOK (backend commit `b785cfc`):** Kullanıcı kararı = merkezi Zod sözlüğü (enum migration DEĞİL). `helpers/fold-type.ts` ile 2/4-KAT ailesi tüm yazım uçlarında kanonikleştirilir (`'4-kat'→'4-KAT'`). **DB oturumu bu madde için migration YAZMAZ.**
- **⚠️ DOMAIN DÜZELTMESİ (enum yapılmamasının nedeni):** foldType yalnız 2/4-KAT DEĞİL — **`TÜP` (tubular) + özel değerler meşru** (mobil UI 'özel' notu; test 'TUP' kullanıyor; frontend selektörleri 2/4-KAT sunsa da alan serbest). Bir `FoldType` enum'u bu meşru değerleri REDDEDERDİ (test_recipe kırıldı → doğrulandı). Bu yüzden enum yerine kanonikleştir-ama-reddetme yaklaşımı seçildi.
- ~~Kolonlar: schema.prisma:754, 1195 (foldType String?); stepData L1250; metadata L1464~~ — enum'a çevrilmedi.
- **DDL:**
  ```sql
  SET statement_timeout = 0;
  SELECT DISTINCT "foldType" FROM rolls WHERE "foldType" IS NOT NULL;  -- önce envanter
  UPDATE rolls SET "foldType"='FOUR_FOLD' WHERE "foldType" IN ('4-kat','4 Kat','4');
  UPDATE rolls SET "foldType"='TWO_FOLD'  WHERE "foldType" IN ('2-kat','2 Kat','2');
  CREATE TYPE "FoldType" AS ENUM ('TWO_FOLD','FOUR_FOLD');
  ALTER TABLE rolls ALTER COLUMN "foldType" TYPE "FoldType" USING "foldType"::"FoldType";
  -- stepData/metadata JSON'daki foldType ayrıca jsonb_set ile normalize
  ```
- **App sonrası:** `prisma generate`; foldType yazan/okuyan uçları enum'a; HC-06 kanal eşleşme mantığını enum'a bağla; tambur stepData/metadata yazımını normalize et.
- **Alternatif (migration'sız):** enum istenmezse **tek merkezi Zod sözlüğü** + tüm uçlarda paylaşımlı validasyon (backend-track olur).
- **Risk:** `rolls` yüksek hacimli → `ALTER COLUMN TYPE` tabloyu rewrite eder + yazma kilidi → **vardiya dışı + `statement_timeout=0` zorunlu**. Map edilemeyen değer (`"NaN"`, boş, tireli varyant) cast'i patlatır.

#### F71 — `WorkOrderStatus.PAUSED` ölü enum değeri
- **✅ APP-CODE HAZIR (backend commit `bba0f15`):** 16 referans (3 filtre dizisi + 2 Set + 1 karşılaştırma + 10 yorum/Swagger) temizlendi, tsc+regresyon yeşil. **DB oturumu enum-recreate migration'ını yazıp aynı merge'e koyabilir** (sıra: app-code önce → enum silme sonra → tsc hep yeşil).
- **Neden DB:** app'te hiç atanmıyor (ölü); Postgres'te enum-değer silme = tip recreate migration.
- **Kolon/kod:** `schema.prisma` WorkOrderStatus (L102); `order.service` / `production-balance` / `roll-step.helper` filtre setlerinde PAUSED referansları.
- **DDL:**
  ```sql
  SET statement_timeout = 0;
  ALTER TYPE "WorkOrderStatus" RENAME TO "WorkOrderStatus_old";
  CREATE TYPE "WorkOrderStatus" AS ENUM (... PAUSED hariç ...);
  ALTER TABLE work_orders ALTER COLUMN status TYPE "WorkOrderStatus"
    USING status::text::"WorkOrderStatus";
  DROP TYPE "WorkOrderStatus_old";
  ```
- **App sonrası:** enum silinmeden ÖNCE/aynı anda `order.service`/`production-balance`/`roll-step.helper` filtre dizilerinden PAUSED'ı çıkar (yoksa derleme/tutarsızlık).
- **Risk:** herhangi bir satır `status=PAUSED` taşıyorsa cast patlar → enum + filtre **tek birim** olarak yürüt.

### A2. Eksik kolon / index

#### F4 — Eksik `updatedAt` + `SystemLog.updatedAt` fazlalığı
- **Modeller:** `RollReturn`, `Session`, `WorkOrderToOrderLine` → `@updatedAt` ekle. `SystemLog.updatedAt` → kaldır + `SystemLogArchive` senkron.
- **App sonrası:** `SystemLog.updatedAt` yazan/okuyan varsa temizle; `prisma generate`.
- **Risk:** kolon eklerken mevcut satır default/NULL davranışı; SystemLogArchive şemasıyla drift'e dikkat.

#### F123 — `ROLL_SORTABLE_FIELDS` indekssiz sıralama kolonları
- **Sorun:** `currentQty/initialQty/width/qualityGrade` UI SortableHeaders'ta kullanılıyor ama index yok. Whitelist'i **daraltma** (UI sıralaması bozulur) → destekleyici composite index ekle.
- **DDL:**
  ```sql
  SET statement_timeout = 0;
  CREATE INDEX "rolls_status_currentQty_idx" ON rolls (status, "currentQty");
  -- gerekirse initialQty/width/qualityGrade için ek composite'ler (EXPLAIN ile doğrula)
  ```
- **Risk:** dolu `rolls` tablosunda `CREATE INDEX` yazma kilidi → vardiya dışı + `statement_timeout=0`.

#### F249 — `dispatchedAt` composite index (rapor/sorgu)
- **Detay ince** (P2 schemaDeferred; spec gövdesi boş). DB oturumunda **EXPLAIN ANALYZE** ile hangi sorgunun `dispatchedAt` üzerinde Seq Scan yaptığını doğrula, ona göre `[<eşitlik_kolonu>, dispatchedAt]` composite ekle (eşitlik önce, range/order sonra — CLAUDE.md perf kuralı #2).
- **Risk:** vardiya dışı + `statement_timeout=0`.

#### F188 — `label_templates.isDefault` DB koruması yok
- **Bağlam:** migration `20260706090000` `label_templates_one_default_per_kind` partial unique index'ini düşürdü; deprecated `isDefault` kolonunda DB koruması kalmadı. Gerçek default zaten `LabelContextDefault.kind` unique ile korunuyor.
- **Karar (DB oturumu):** `isDefault` gerçekten deprecated ise **ya kolonu kaldır** ya da **partial unique index'i geri koy**:
  ```sql
  -- Seçenek A (koru): CREATE UNIQUE INDEX label_templates_one_default_per_kind
  --   ON label_templates (kind) WHERE "isDefault" = true;
  -- Seçenek B (kaldır): ALTER TABLE label_templates DROP COLUMN "isDefault";
  ```
- **⚠️ App tarafı UYARISI:** `label-template.service.ts` `rethrowDefaultConflict` (L57-64) substring `'default'` eşleşmesini **DARALTMA**. pg adapter altında P2002 `meta.target` şekli (kolon-adı dizisi mi constraint adı mı) belirsiz; daraltmak `label_context_defaults_kind_key` yakalamasını bozabilir. **medium risk.**
- **App sonrası:** kolon düşerse `isDefault` okuma/yazmalarını temizle (upsert'ler L207/274/335).

### A3. Ürün kararı bekleyen (ileriye dönük — additive)

#### O-20 — `Sack.tareKg` kolonu (ihracat net kg)
- **Bağlam:** `Sack.weightKg` (schema.prisma:2207) brüt (kumaş+dara). Dara/net modeli yok.
- **DDL (additive, hızlı, kilit kısa):**
  ```sql
  ALTER TABLE sacks ADD COLUMN "tareKg" numeric(12,3);  -- nullable
  ```
- **App sonrası:** tartı/paket uçlarında opsiyonel `tareKg`; çeki listesinde BRÜT/DARA/NET; **net = weightKg − tareKg `Prisma.Decimal.minus()` ile (float YASAK)**. Sabit-dara modeli seçilirse çuval-tipi kataloğu + varsayılan dara.
- **Durum:** ürün kararı bekliyor (dara sabit mi kolon mu). Yalnız EXPORT'ta tartı zorunlu → kapsam sınırlı.

#### D-3 — Vardiya/duruş master + `unitCost` (OEE/maliyet, ileriye)
- **Bağlam:** OEE kullanılabilirlik + fason maliyeti için `Shift` master + duruş tablosu + `unitCost` kolonları.
- **Durum:** **ürün kararı olmadan başlanmamalı** (OEE/muhasebe yol haritası). Additive → mevcut veriyi etkilemez; risk kapsam/tasarım belirsizliği.
- **Taslak:**
  ```sql
  CREATE TABLE shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(50) NOT NULL,
    "startTime" time NOT NULL, "endTime" time NOT NULL,
    "isActive" boolean NOT NULL DEFAULT true,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL
  );
  -- + duruş (downtime) tablosu; + işlem tablolarına unitCost numeric(12,4)
  ```

---

## Bölüm B — DB DEĞİL (bilgi için; DB oturumu kapsamı DIŞI)

Gatherer distilasyonu iki maddeyi "DB değil" olarak ayıkladı — DB oturumu bunları **atlamalı**:

- **O-18** — Tambur'suz rotada açık-hata guard'ı. **App-code (backend track).** `[rollId, isProcessed]` index'i **ZATEN VAR**, migration gerekmez. Çözüm: `kursun-qc.service.ts` finishStep no-next-step dalına açık-`RollError` guard'ı (+ `computeStatusBlockReasons` + shipping scan-in claim). → Backend oturumunda ele alınacak.
- **B-1** — `prisma.ts:26` yorumu. **ZATEN DOĞRU** — mevcut yorum `statement_timeout: zaten DB-level (50s) ayarlı` diyor (rapor 30s'de kalmış, kod güncel). **Aksiyon yok.**

---

## Kaynaklar
- Tam DB denetim raporu: `Teks-Erp/DB-MIMARI-DENETIM.md` (8 boyut, O-/D-/B- bulguları).
- DB denetim hafızası: `memory/project_db_mimari_denetim.md` (PR #60, Faz1-7, O-20/D-3 ileriye).
- Backend denetim hafızası: `memory/project_backend_audit_2026_07.md` (skip-db/schema-deferred kararları).
- İndeks sağlık: `Teks-Erp/scripts/index-health.sql` (bloat/eksik-index tespiti).
- Tutarlılık: `psql <db> -f Teks-Erp/scripts/consistency-check.sql` (shippedQty mutabakatı).

## Özet checklist
- [ ] F3 — String ID → @db.Uuid (Roll.batchSplitId, PrintedDocument.sourceId, RollReturn.prev*)
- [ ] F6+D-15 — Device.kind → DeviceKind enum + department/module VarChar/katalog (BİRLEŞİK)
- [x] ~~D-13 — foldType~~ **ÇÖZÜLDÜ backend-only (b785cfc, merkezi Zod sözlüğü; enum YOK — TÜP/özel meşru). DB işi yok.**
- [ ] F71 — WorkOrderStatus.PAUSED enum-recreate migration **(app-code hazır bba0f15; DDL sende)**
- [ ] F4 — updatedAt ekle (RollReturn/Session/WorkOrderToOrderLine) + SystemLog.updatedAt kaldır
- [ ] F123 — rolls sıralama composite index'leri
- [ ] F249 — dispatchedAt composite index (EXPLAIN ile doğrula)
- [ ] F188 — label_templates.isDefault: kolon kaldır *veya* partial unique geri koy (rethrowDefaultConflict'e DOKUNMA)
- [ ] O-20 — Sack.tareKg (ürün kararı bekliyor)
- [ ] D-3 — Shift master + unitCost (ürün kararı bekliyor)
- [ ] ~~O-18~~ backend-track (app-code, index var) · ~~B-1~~ zaten çözülmüş
