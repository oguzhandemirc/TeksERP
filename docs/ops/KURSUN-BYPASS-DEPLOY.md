# Kurşun Bypass — Canlı DB Devreye Alma Notu

> **CANLI FABRİKA DB'si.** Genel kurallar `DEPLOY-RUNBOOK.md` + `URETIM-KONTROL-LISTESI.md`.
> Burada yalnız **Kurşun Bypass** özelliğinin canlıya alınması için gereken adımlar var.
> `npm run seed` / `prisma migrate reset` **ASLA koşmaz** — seed yalnız ilk kurulumda
> koşan bir dosyadır, mevcut fabrikada çalıştırılırsa veriyi düşürür.

## Özellik nedir (bir paragraf)

Fabrika kurşun makinelerine tablet **koymuyor**. Kurşun işlemi fiziksel olarak yapılır
ama dijital izlenmez (hatalar kâğıtta kalır). Yetkili personel, fason dönüşüyle kurşun
adımında bekleyen iş emirlerini yeni **Kurşun Dağıtım** ekranından fiziksel bir kurşun
**MAKİNESİNE** atar. Tambur operatörü iş emri refakat kartının karekodunu okuttuğunda
Kurşun/KK2 adımı **SESSİZCE ve OTOMATİK** `COMPLETED` sayılır, toplar Tambur adımına
geçer (kalite NULL kalır — kaliteyi Tambur belirler) ve kart **doğrudan normal Tambur
işi** olarak açılır. Kurşun rotanın SON adımıysa, dağıtım ekranındaki **"İşi Bitir"**
ile tamamlanır (`finalizeRollsAtLastStep` → `WAREHOUSE`).

> **Tambur'da ONAY YOKTUR (2026-07-31 kararı).** Kart okutulunca **önizleme /
> onay ekranı ÇIKMAZ**; operatör hiçbir şeye dokunmaz, ekstra dokunuş yoktur.
> Gerekçe: kararı zaten **dağıtımcı** vermiştir (işi o makineye o gönderdi) —
> Tambur operatörüne "başkasının kararını onaylat" demek her kart okutmasına bir
> adım ekler ve refleksle onaylanan bir ekran hiçbir şeyi doğrulamaz. Kurşunun
> fiziksel olarak yapıldığının teyidi kâğıtta ve dağıtımcıdadır. Dijital iz üçlüsü
> (movement marker + atama satırı + audit) onaydan **bağımsız** yazılır, yani
> izlenebilirlikten hiçbir şey kaybedilmez.

> **Atama MAKİNE bazındadır, istasyon bazında DEĞİL.** Fabrikada `PROCESS_QC` türünde
> **tek** istasyon vardır (`KURSUN_KK2`) ve altında N adet fiziksel kurşun **makinesi**
> (`Machine`) durur; dağıtımcının seçtiği şey o makinelerden biridir
> (`KursunBypassAssignment.machineId`). Üç sonucu: (1) `WorkOrderStep.stationId`
> **repoint EDİLMEZ** — adımın istasyonu hiç değişmez, atama bilgisi adımda değil
> **atama satırında** yaşar; (2) kapanan kurşun movement'ı
> `RollMovement.machineId = atanan makine` ile damgalanır → makine bazlı hacim
> sorguları bypass işlerini de görür; (3) `KURSUN` yeteneği **makinenin
> istasyonundan** okunur (`copyStationCapabilitiesToRoll`, `machine.stationId`).

> ⚠️ **Bu SKIPPED DEĞİLDİR.** Adım atlanmaz; `RollMovement`'lar normal şekilde kapanır ve
> adım `COMPLETED` olur. Fark: `RollOperation` (`KURSUN_APPLIED` / `QC2_COMPLETED`)
> **yazılmaz**, `RollError` açılmaz. İz üçlüsü: movement notes marker'ı
> (`KURSUN_BYPASS_FINISHED:<uuid>`) + `kursun_bypass_assignments` satırı + audit kaydı.
> İstasyon yetenekleri (`copyStationCapabilitiesToRoll`) **YİNE kopyalanır** — topun
> KURŞUN özelliği kaybolmasın (kaynak: **atanan makinenin istasyonu**).

---

## (d) Migration — İKİ ADET, sırayla uygulanır

**1. `20260731120000_add_kursun_bypass_assignment`**

- `CREATE TYPE "KursunBypassCompletionSource"` (`TAMBUR_SCAN`, `DISTRIBUTION_LAST_STEP`)
- `CREATE TABLE "kursun_bypass_assignments"` (BOŞ doğar) + 3 FK index + 7 FK
- `CREATE UNIQUE INDEX "kursun_bypass_one_pending_per_step_uq" ... WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL`
  — şema-dışı **partial unique**: "bir adımda EN FAZLA BİR açık atama" seddi.

**2. `20260731210000_kursun_bypass_machine_assignment`** — atama İSTASYONDAN MAKİNEYE taşındı

- `DROP COLUMN "stationId", "originalStationId"` (+ FK'ları + `stationId` index'i)
- `ADD COLUMN "machineId" UUID NOT NULL` + FK → `machines(id)` `ON DELETE RESTRICT`
  + `kursun_bypass_assignments_machineId_idx`
- Partial unique **korundu** (dokunulan kolonların hiçbiri o index'te geçmiyor).

> Birinci migration atamayı **yanlış seviyede** modellemişti (istasyon). İkincisi onu
> düzeltir; birincisi push edilmiş olduğu için IMMUTABLE sayılır ve **düzenlenmez**.
> Veri kaybı yok: tablo canlıda **boş** (bayrak hiç açılmadı) → kolon DROP'u kayıpsız,
> yeni kolon backfill'siz `NOT NULL` doğabiliyor. **İkisi birden uygulanmadan bayrak
> AÇILMAZ**; yalnız birincisi uygulanmışsa `assign` ilk çağrıda P2022 (`machineId`
> kolonu yok) verir.

Canlıya **sıfırdan** gidiliyorsa `migrate deploy` ikisini de sırayla uygular; boş tabloya
kolon eklemek anlık bir işlemdir.

**Canlı veriye DOKUNMAZ:** iki migration da **yalnız** `kursun_bypass_assignments`
tablosuna dokunur; o tablo bu sürümle doğuyor ve canlıda **boş** → tablo rewrite yok,
uzun kilit yok, başka hiçbir tablo etkilenmiyor. Vardiya saati kısıtı bu migration'lar
için geçerli değil (kök kural 14 **dolu** tabloya index ekleyen migration'lar içindir).

**Migration'lar ELLE yazıldı** (`prisma migrate dev` üretmedi — `sacks` DEFERRABLE
composite FK drift'i + partial unique `@@unique` ile ifade edilemiyor). Uygulama sırası:

```bash
# Teks-Erp/ içinden, sunucuda
git log --oneline -1                      # doğru commit'te miyiz
npx prisma migrate status                 # bekleyen migration listesi
npx prisma migrate deploy                 # dizindeki migration'ları uygula
```

Elle `db execute` gerekirse sıra **her zaman**: `git add` → `prisma db execute` →
`migrate resolve --applied` → **DOĞRULA**. `migrate resolve` SQL'in KOŞTUĞUNU kanıtlamaz
(D-23), yalnız `_prisma_migrations`'a satır yazar.

**Doğrulama (psql, salt-okunur):**

```sql
\d+ kursun_bypass_assignments
-- Beklenen: "machineId" uuid NOT NULL kolonu VAR;
--           "stationId" / "originalStationId" kolonları YOK.

SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'KursunBypassCompletionSource'
 ORDER BY e.enumsortorder;
-- Beklenen: TAMBUR_SCAN, DISTRIBUTION_LAST_STEP

SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'kursun_bypass_assignments';
-- 'kursun_bypass_one_pending_per_step_uq' satırında WHERE predicate'i GÖRÜNMELİ

SELECT indisvalid FROM pg_index
 WHERE indexrelid = 'kursun_bypass_one_pending_per_step_uq'::regclass;
-- t olmalı
```

Deploy sonrası `npx tsx scripts/test_db_invariants.ts` KOŞ (canlıda güvenli tek test —
salt pg-katalog okur). Partial unique envanterine bu index eklenmiş olmalı.

---

## (a) Permission INSERT — seed canlıda KOŞMAZ

`prisma/seed.ts` **yalnız ilk kurulumda** koşar. Canlı DB'de iki yeni permission
elle INSERT edilir, yoksa Admin dışı hiçbir kullanıcı ekranı açamaz (403):

| Kod | Modül | Kategori | Ne işe yarar |
|---|---|---|---|
| `workorder:distribute` | `PRODUCTION` | `web` | Kurşun dağıtım — iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama |
| `mobile:kursun-dagitim` | `MOBILE` | `mobile` | Mobil Kurşun Dağıtım ekranı (web izninin ikizi) |

Route'lar `requireAnyPermission("workorder:distribute", "mobile:kursun-dagitim")` kullanır
→ saha kullanıcısına **yalnız mobil kodu** vermek yeterlidir.

### ✅ ÖNERİLEN YOL: tek komut (elle SQL yazma)

```bash
cd <backend dizini>
npx tsx scripts/sync-kursun-bypass-permissions.ts
```

Script **idempotent**'tir (hepsi upsert, tekrar tekrar koşulabilir) ve şunları yapar:
iki izni ekler · "Mobil — Kurşun Dağıtım" template'ini kurar veya eksik item'larını
tamamlar · ikisini de `admin` kullanıcısına bağlar. Ardından **ön koşulları teşhis
eder**: aktif `PROCESS_QC` istasyonlarını `KURSUN` yeteneğiyle **ve o istasyona bağlı
aktif MAKİNELERLE** birlikte listeler, makinesiz istasyon için ayrı uyarı basar,
sonunda "dağıtım listesine düşecek makine / atama yapılabilir makine" sayılarını ve
bayrağın durumunu yazar — yani (b) ve (c) adımlarında neyin eksik olduğunu sana
önceden söyler. Mevcut açıklamaları EZMEZ (elle düzeltilmiş olabilir).

> Script yalnız İZİN tarafını kurar; **salt-teşhistir** — istasyon da makine de
> YARATMAZ. Fiziksel kurşun makineleri fabrikaya özgü veridir (kaç adet, hangi ad)
> → panelden tanımlanır.

Aşağıdaki elle SQL, script'in koşamadığı durumlar (Node yok, yalnız `psql` erişimi
var, ya da tek tek doğrulamak isteniyor) için **yedek yoldur**.

### Kolon adları (schema.prisma'dan doğrulandı)

- `permissions(id, code, module, category, description, "createdAt", "updatedAt")`
  — `id` **UUID**, `category` `"PermissionCategory"` enum'ı (`web|mobile|admin`),
  `"updatedAt"` **DEFAULT'SUZ** (Prisma `@updatedAt` uygular) → INSERT'te elle verilir.
- `user_permissions(id, "userId", "permissionId", "validFrom", "validUntil", "grantedById", "createdAt", "updatedAt")`
  — aynı şekilde `id` ve `"updatedAt"` elle verilir; `@@unique("userId","permissionId")` var.
- `permission_template_items("templateId", "permissionId", "createdAt")` — PK çifttir,
  `"updatedAt"` **YOK** (append-only pivot).

> ⚠️ Kolon adları **camelCase ve tırnaklı**. SQL'i koşmadan önce sunucuda
> `\d permissions`, `\d user_permissions`, `\d permission_template_items` ile **teyit et** —
> bu dosya repo anlık görüntüsüdür, canlı şema bir migration geriden gelebilir.
> `"createdAt"`/`"updatedAt"` kolonları `timestamp` (timezone'suz) olduğu için
> `now() AT TIME ZONE 'UTC'` yazılır — düz `now()` Europe/Istanbul'da 3 saat kaydırır.

### SQL — 1. adım: permission satırları (idempotent)

```sql
BEGIN;

INSERT INTO permissions (id, code, module, category, description, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'workorder:distribute', 'PRODUCTION', 'web',
   'Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama',
   now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  (gen_random_uuid(), 'mobile:kursun-dagitim', 'MOBILE', 'mobile',
   'Mobil — Kurşun Dağıtım ekranı',
   now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
ON CONFLICT (code) DO NOTHING;

-- Doğrula: 2 satır dönmeli
SELECT code, module, category FROM permissions
 WHERE code IN ('workorder:distribute', 'mobile:kursun-dagitim');

COMMIT;
```

### SQL — 2. adım: kullanıcılara bağla (`user_permissions`)

**Önce kimin alacağına kullanıcıyla karar ver.** Aşağıdaki blok `username` listesiyle
çalışır — listeyi doldurmadan koşma. `grantedById` = işlemi yapan admin.

```sql
BEGIN;

-- Kimler var, önce BAK (salt-okunur):
SELECT username, "fullName", "isActive" FROM users WHERE "isActive" = true ORDER BY username;

WITH hedef_kullanicilar AS (
  SELECT id FROM users
   WHERE username IN ('BURAYA', 'KULLANICI', 'ADLARINI', 'YAZ')   -- ← DOLDUR
     AND "isActive" = true
),
hedef_yetkiler AS (
  SELECT id FROM permissions
   -- Masaüstü/planlama kullanıcısına: 'workorder:distribute'
   -- Saha tabletindeki kullanıcıya : 'mobile:kursun-dagitim'
   WHERE code IN ('mobile:kursun-dagitim')                        -- ← İHTİYACA GÖRE DEĞİŞTİR
),
veren AS (
  SELECT id FROM users WHERE username = 'admin'                   -- ← yetkiyi veren admin
)
INSERT INTO user_permissions (id, "userId", "permissionId", "grantedById", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u.id, p.id, v.id,
       now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
  FROM hedef_kullanicilar u
 CROSS JOIN hedef_yetkiler p
 CROSS JOIN veren v
ON CONFLICT ("userId", "permissionId") DO NOTHING;

-- Doğrula: kim hangi yeni yetkiyi aldı
SELECT us.username, pe.code
  FROM user_permissions up
  JOIN users us       ON us.id = up."userId"
  JOIN permissions pe ON pe.id = up."permissionId"
 WHERE pe.code IN ('workorder:distribute', 'mobile:kursun-dagitim')
 ORDER BY us.username, pe.code;

COMMIT;
```

> `admin` kullanıcısı `mobile:*` / `admin:*` wildcard'larına sahipse mobil ekranı
> zaten görür; `workorder:distribute` **wildcard'a girmez** (PRODUCTION modülünde
> wildcard yok) → admin'e de açıkça verilmelidir.

### SQL — 3. adım (OPSİYONEL): permission template

Canlı DB'de "Mobil — Kurşun Dağıtım" şablonu yoktur (seed'e yeni eklendi). Şablon
yalnız admin panelindeki "tek tıkla uygula" kolaylığıdır — **atlanabilir**. İstenirse:

```sql
BEGIN;

WITH tpl AS (
  INSERT INTO permission_templates (id, name, description, "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'Mobil — Kurşun Dağıtım',
          'Kurşun dağıtım ekranı (iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)',
          true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
  RETURNING id
)
INSERT INTO permission_template_items ("templateId", "permissionId", "createdAt")
SELECT tpl.id, p.id, now() AT TIME ZONE 'UTC'
  FROM tpl, permissions p
 WHERE p.code IN ('mobile:kursun-dagitim', 'workorder:read', 'roll:read', 'station:read')
ON CONFLICT DO NOTHING;

COMMIT;
```

> ⚠️ `permission_templates` kolonlarını (`isActive` var mı, `updatedAt` default'lu mu)
> **`\d permission_templates` ile teyit et** — bu tablo bu notun kapsamı dışında değişmiş
> olabilir. Şablon oluşturmayı admin panelinden yapmak (Kullanıcılar → Yetki Şablonları)
> her zaman daha güvenlidir; SQL'i yalnız panel yoksa kullan.

---

## (b) Fiziksel kurşun MAKİNELERİ tanımlanmalı — istasyon DEĞİL

> ### ⚠️ Bu bölüm 2026-07-31'de DÜZELTİLDİ — eski nüsha yanlıştı
>
> Eski metin *"bypass düzeni her fiziksel kurşun makinesi için ayrı `Station` satırı
> ister"* diyordu. **Yanlış.** Fabrika gerçeği: `PROCESS_QC` türünde **TEK** istasyon
> vardır (`KURSUN_KK2`) ve fiziksel kurşun makineleri onun **altında** `Machine` satırı
> olarak durur. Dağıtım da makine bazında yapılır
> (`KursunBypassAssignment.machineId` → FK `machines`).
>
> **Eski talimat izlenirse ne olur:**
> 1. **Dağıtım ekranı yine boş kalır.** Liste `Machine` sorgusudur
>    (`isActive = true AND station.kind = 'PROCESS_QC'`) — istasyon açmak listeye tek
>    satır bile eklemez, "makine tanımlı değil" tablosu değişmez.
> 2. **Rota tasarımı kirlenir.** `allowAsWorkOrderStep = true` olan her yeni istasyon
>    iş emri adım seçicisinde ayrı seçenek olarak çıkar; planlamacı "Kurşun 1 mi
>    Kurşun 2 mi?" diye rotaya makine gömer — oysa rota makineden bağımsızdır,
>    makineyi dağıtımcı sonradan seçer.
> 3. **`KURSUN` yeteneği N kez tanımlanır** ve biri unutulduğunda o istasyona düşen
>    iş sessizce "kurşun görmemiş" sayılır.
>
> **Eski nüshayı okuyup istasyon açtıysan:** o istasyonları **silme** (rota/geçmiş
> FK'ları RESTRICT) — panelden `isActive = false` yap ve gerçek makineleri tek
> `PROCESS_QC` istasyonunun altına `Machine` olarak ekle. Hiçbir iş emri o
> istasyonlara adım olarak bağlanmadıysa başka temizlik gerekmez.

Dağıtım ekranı iş emrini bir **fiziksel kurşun makinesine** atar. Ekrandaki seçim
listesi tam olarak şu sorgudur:

```
Machine WHERE isActive = true AND station.kind = 'PROCESS_QC'
```

### 1. İstasyon — TEK tane, muhtemelen zaten var

`Station.kind = PROCESS_QC` (panelde **"Kurşun + Kalite Kontrol 2"**), `type = INTERNAL`,
`allowAsWorkOrderStep = true`. Canlıda `KURSUN_KK2` olarak zaten duruyorsa **yeni istasyon
açma**. Yoksa Tanımlar → İstasyonlar'dan **bir** tane aç.

### 2. `KURSUN` yeteneği İSTASYONDA durur (makinede böyle bir alan YOKTUR)

`StationProperty` → `fabric_properties.code = 'KURSUN'`. Panel: Tanımlar → İstasyonlar →
ilgili istasyon → **Özellikler**.

Bu **load-bearing**: bypass tamamlanırken `copyStationCapabilitiesToRoll` yine koşar ve
topa KURŞUN özelliğini bu yetenekten yazar — yetenek **makinenin istasyonundan**
(`machine.stationId`) okunur. Eksikse iki şey birden bozulur: iş "kurşun gördü" izini
kaybeder ve WO planlamadaki hedef özellik doğrulaması düşer. Bu yüzden `assign`
yetenek yoksa **400** döner: *"Seçilen makinenin istasyonu kurşun uygulayamıyor"*.

### 3. Her fiziksel kurşun makinesi için bir `Machine` satırı

Panel: **Tanımlar → Makineler → Yeni Makine** → İstasyon = yukarıdaki `PROCESS_QC`
istasyonu, Ad = sahadaki makinenin üstünde yazan etiketle **aynı** ("Kurşun 1",
"Kurşun 2", …). Dağıtımcı listede bu adı görür ve operatöre "kumaş Kurşun 2'de" der;
ad sahadakiyle uyuşmazsa mal yanlış makinede aranır.

- **Kod elle yazılmaz** — backend üretir (`MAK` + GGAAYY + NNNN, `BaseService.autoCode`).
- **Ad aynı istasyon içinde tekildir** (farklı istasyonlarda "Makine 1" tekrarlanabilir).
- **Kaç adet?** Sahada fiziksel olarak kaç kurşun makinesi varsa o kadar. Bu fabrikaya
  özgü veridir; `sync-kursun-bypass-permissions.ts` onu **yaratmaz**, yalnız raporlar.
- **Makinenin tableti/cihazı olması ŞART DEĞİL** — bypass'ın tanımı zaten "bu makinede
  tablet yok". `Device` ataması gerekmez.
- Makine kaydı başka bir amaçla (tabletli akış, kantar/yazıcı bağlama) **zaten varsa
  yeniden yaratma** — aynı satır kullanılır.

> **Rotaya dokunulmaz.** Atama `WorkOrderStep.stationId`'yi **repoint ETMEZ** (o kolon
> artık hiç yazılmıyor) ve `WorkOrderStep`'e `machineId` diye bir kolon **yoktur**.
> Atama yalnız `kursun_bypass_assignments` satırında yaşar; işi hangi makinenin yaptığı
> ise kapanışta `roll_movements."machineId"` damgasıyla kalıcılaşır.

**Ön kontrol (salt-okunur) — istasyon + yetenek + makineler:**

```sql
SELECT s.code  AS istasyon_kod,
       s.name  AS istasyon_ad,
       s."isActive" AS istasyon_aktif,
       COALESCE(bool_or(fp.code = 'KURSUN'), false) AS kursun_yetenegi,
       count(DISTINCT m.id) FILTER (WHERE m."isActive") AS aktif_makine
  FROM stations s
  LEFT JOIN station_properties sp ON sp."stationId" = s.id
  LEFT JOIN fabric_properties  fp ON fp.id = sp."propertyId"
  LEFT JOIN machines           m  ON m."stationId" = s.id
 WHERE s.kind = 'PROCESS_QC'
 GROUP BY s.id, s.code, s.name, s."isActive"
 ORDER BY s.code;
-- Beklenen: TEK satır · kursun_yetenegi = t · aktif_makine = fiziksel makine sayısı
-- aktif_makine = 0  → dağıtım ekranında seçilecek makine ÇIKMAZ
-- kursun_yetenegi = f → makineler listede görünür ama seçilince 400 döner

-- Dağıtım listesine düşecek makineler (ekranın gördüğü küme birebir bu):
SELECT m.code, m.name, s.code AS istasyon
  FROM machines m
  JOIN stations s ON s.id = m."stationId"
 WHERE m."isActive" = true AND s.kind = 'PROCESS_QC'
 ORDER BY m.name;
```

Aynı teşhisi tek komutla almak için: `npx tsx scripts/sync-kursun-bypass-permissions.ts`
(§a) — istasyonu, yeteneği ve makineleri birlikte basar.

---

## (c) Bayrak KAPALI açılır, sonra panelden açılır

Ayar anahtarı: **`production.kursunBypassEnabled`**, varsayılan **`false`**.

- Canlı DB'ye **INSERT gerekmez**: `readKursunBypassEnabled` kayıt yoksa `false` döner.
  Ayarı panelden ilk kez açtığında satır kendiliğinden yazılır (`setFeatureFlags` upsert).
- **ENFORCE edilir ama kapsamı DAR:** bayrak yalnız **YENİ ATAMA OLUŞTURMAYI** kapılar.
  Kapalıyken "kurşun dağıt" 400 döner.
- **Dağıtılmış iş emirleri bayrak sonradan kapansa da bypass rejiminde biter** —
  iptal / son-adım tamamlama / Tambur kart okutmasıyla otomatik kapanma çalışmaya
  devam eder. Rejim **atama satırında** kalıcıdır (`kursun_bypass_assignments`),
  ayarda değil. Aksi halde bayrağı kapatmak, kurşunu fiziksel olarak görmüş ama
  dijital karşılığı açık kalmış işleri sahada kilitlerdi.
- **Ekran görünürlüğü bayrağa bağlıdır (iki yönlü):** bayrak AÇILINCA **Kurşun
  Dağıtım** karosu görünür ve **Kurşun Sırası** karosu/route'u **gizlenir**;
  KAPANINCA tam tersi. Ayrıntı ve gerekçe: aşağıda §f.

**Devreye alma sırası (bu sırayla):**

1. `migrate deploy` + doğrulama (yukarıda §d — **iki** migration da uygulanmalı)
2. Permission INSERT + kullanıcılara bağlama (§a) — **bayrak hâlâ KAPALI**
3. Fiziksel kurşun **makineleri** + istasyonda KURSUN yeteneği (§b)
4. **İSTEMCİLER YENİDEN DAĞITILIR** (aşağıda §e) — backend'i güncellemek yetmez
5. Yetkili kullanıcı **yeniden giriş yapar** (JWT içindeki permission listesi yenilensin)
6. Panel → Genel Ayarlar → **Kurşun bypass = AÇIK**
   — Operasyonlar ekranını **yenile**: "Kurşun Dağıtım" karosu gelmiş, "Kurşun Sırası"
   karosu gitmiş olmalı (§f).
7. Tek bir iş emriyle uçtan uca dene: **bir makine seçip** dağıt → Tambur'da kart okut.
   **Beklenen: hiçbir onay/önizleme ekranı ÇIKMAZ** — kart doğrudan normal Tambur işi
   olarak açılır. Ardından doğrula: kurşun adımı `COMPLETED` mi, toplar Tambur adımında
   mı, dağıtım ekranındaki satır "tamamlandı"ya düştü mü? Son olarak
   `SELECT "machineId" FROM roll_movements WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:%'`
   ile damganın **seçilen makineyi** gösterdiğini doğrula (makine adı artık ekranda
   onaylatılmadığı için doğru makineye yazıldığının tek teyidi budur).

**Geri alma (özellik sorun çıkarırsa):** panelden bayrağı **KAPAT**. Yeni dağıtım
yapılamaz; sahada açık kalan atamalar normal şekilde tamamlanır ya da dağıtım ekranından
iptal edilir. **İptal yalnız atama satırını** `cancelledAt` ile kapatır — başka hiçbir
şeye dokunmaz: adımın istasyonu atama sırasında zaten hiç değiştirilmediği için geri
yüklenecek bir şey yoktur (eski tasarımdaki `originalStationId` geri yüklemesi
`20260731210000` ile tamamen kalktı), iş normal tabletli akışa döner. Migration'lar
geri alınmaz — tablo boş bile olsa yerinde bırakılır.

---

## (e) İstemciler yeniden dağıtılmalı — backend tek başına YETMEZ

Bu özellik üç projeye birden dokunur; **ekranlar istemci paketinin İÇİNDE gelir**, sunucudan
indirilmez. Yalnız backend güncellenirse bayrağı açan kişi hiçbir değişiklik göremez ve
"özellik çalışmıyor" der.

| Proje | Ne geldi | Ne yapılmalı |
|---|---|---|
| `Teks-Erp/` | `/api/kursun-bypass/*` uçları, Tambur kart okumasındaki otomatik kapanış, tablet guard'ları | `git pull` + `npm ci` + `migrate deploy` + `pm2 restart` |
| `Electron/` | **Kurşun Dağıtım** sayfası (makine bazlı izleme + acil işaretleme), Genel Ayarlar'daki bayrak kartı, bayrak açıkken **Kurşun Sırası'nın gizlenmesi** | Yeni kurulum paketi (`npm run build:win`) → operatör bilgisayarlarına kurulum |
| `mobil/` | **Kurşun Dağıtım** ekranı, Tambur'da dağıtılmış kartın **onaysız/otomatik** kapanması | Yeni APK (versionCode artırılmış) → tabletlere kurulum |

> **Tablet APK'sı ESKİ kalırsa ne olur:** Tambur ekranı dağıtılmış kartı tanımaz;
> okutulunca eski hata mesajını gösterir ("iş emri Tambur adımında değil") ve **kurşun
> adımı hiçbir zaman kapanmaz** — iş sahada kilitlenir. Bu yüzden bayrağı açmadan ÖNCE
> Tambur tabletlerinin güncel APK'yı aldığı doğrulanmalıdır.
> (Kaçış yolu: dağıtımı Kurşun Dağıtım ekranından iptal et → iş normal tabletli akışa döner.)

---

## (f) Bayrak AÇIKKEN operatöre/planlamacıya görünen davranış değişiklikleri

Aşağıdakiler **kullanıcı kararıdır** (2026-07-31), teknik bir yan etki değil. Bayrağı
açmadan önce ilgili kişilere söylenmezse "ekran kayboldu / uygulama onay sormayı unuttu"
diye hata bildirimi gelir.

### 1. Tambur'da ONAY EKRANI YOK — kurşun adımı sessizce kapanır

| | Bayrak KAPALI (normal akış) | Bayrak AÇIK + iş dağıtılmış |
|---|---|---|
| Tambur kartı okutur | Kart açılır | Kart açılır — **fark yok** |
| Ek ekran | — | **YOK** (önizleme/onay çıkmaz) |
| Kurşun adımı | Tablette kurşuncu kapatmıştı | Kart okutulurken **otomatik** `COMPLETED` |
| Operatörün dokunuşu | — | **Sıfır** |

Tambur operatörü **hiçbir şeye dokunmaz**: kartı okutur, önünde her zamanki Tambur işi
açılır; kurşun adımının arkada kapandığını fark bile etmez. "Bu iş kurşunu kâğıtla
gördü" kararı **dağıtımcınındır** ve dağıtım anında verilmiştir — Tambur operatörüne
onaylatmak, başkasının kararını refleksle "Tamam"layan bir ekran ekler ve her kart
okutmasını bir dokunuş uzatır. Denetim izi onaydan bağımsızdır (movement marker +
`kursun_bypass_assignments` satırı + audit) → onayın kalkması izlenebilirlikten hiçbir
şey eksiltmez.

> **Yan etki — bildiğiniz için beklemeyin:** eskiden onay ekranında görünen **makine
> adı** artık Tambur'da hiç gösterilmez. Yanlış makineye dağıtım yapıldıysa Tambur
> operatörü bunu fark edemez; yanlış dağıtımın yakalandığı yer **Kurşun Dağıtım
> ekranıdır** (kapanmadan önce iptal edilir). Kapanmış bir atamanın makinesi ancak
> `roll_movements."machineId"` üzerinden görülür (aşağıdaki doğrulama sorguları).

### 2. "Kurşun Sırası" ekranı GİZLENİR (karo + route)

Bayrak açıkken Operasyonlar hub'ında **Kurşun Sırası** karosu **çıkmaz** ve
`/operations/kursun-queue` route'u **kapanır**; bayrak kapanınca ikisi de geri gelir.

**Neden:** o ekranın tek işi **sıra numarası vermekti** ve o sıranın tek tüketicisi
**kurşun tabletiydi** — tablet "sıradaki kart" listesini bu önceliğe göre gösteriyordu.
Bypass'ın tanımı zaten "**bu makinelerde tablet yok**"tur → sırayı okuyacak kimse
kalmaz. Ekranı açık bırakmak planlamacıya **hiçbir şeye etki etmeyen** bir sürükle-bırak
sunar; sıraladığını sanır, saha kâğıtla ilerler.

**Nereye taşındı:** izleme ve **acil işaretleme** artık **Kurşun Dağıtım** ekranındadır
ve **makine bazında gruplanır** — "hangi makinede hangi iş emri, ne kadar sıra bekliyor".
Planlamacının bypass rejiminde gerçekten müdahale edebildiği tek kaldıraç budur:
işi hangi makineye vereceği ve hangisinin acil olduğu.

> **Route da kapatılır, sadece karo değil.** Karoyu gizleyip route'u açık bırakmak,
> adres çubuğuna/komut paletine alışmış kullanıcıya "gizlenmiş ama hâlâ çalışan" ikinci
> bir gerçeklik bırakırdı. (Kurşun **Dağıtım** route'u ise bilinçli olarak bunun tersidir:
> bayrak sonradan kapansa da açık atamalar bitirilebilsin diye route kapanmaz — bkz. §c
> "Dağıtılmış iş emirleri bayrak sonradan kapansa da bypass rejiminde biter".)

**Bayrağı kapatınca ne olur:** Kurşun Sırası karosu ve route'u **geri gelir**, sıralama
verisi (`priority` / `isUrgent`) hiç silinmediği için ekran kaldığı yerden açılır —
gizleme salt görünürlüktür, veri kaybı yoktur.

---

## Doğrulama sorguları (özellik açıldıktan sonra)

```sql
-- Açık (bekleyen) bypass atamaları — hangi MAKİNEDE hangi iş bekliyor
SELECT k.id, w."workOrderNumber",
       m.name AS atanan_makine, s.name AS istasyon,
       u.username AS dagitan, k."assignedAt", k.notes
  FROM kursun_bypass_assignments k
  JOIN work_orders w ON w.id = k."workOrderId"
  JOIN machines    m ON m.id = k."machineId"
  JOIN stations    s ON s.id = m."stationId"
  JOIN users       u ON u.id = k."assignedById"
 WHERE k."completedAt" IS NULL AND k."cancelledAt" IS NULL
 ORDER BY m.name, k."assignedAt";

-- Makine başına sıra (dağıtımcının "hangi makine yüklü" görünümü)
SELECT m.name AS makine, count(*) AS bekleyen_is
  FROM kursun_bypass_assignments k
  JOIN machines m ON m.id = k."machineId"
 WHERE k."completedAt" IS NULL AND k."cancelledAt" IS NULL
 GROUP BY m.name
 ORDER BY bekleyen_is DESC;

-- Nasıl kapandılar (izlenebilirlik)
SELECT "completedVia", count(*)
  FROM kursun_bypass_assignments
 WHERE "completedAt" IS NOT NULL
 GROUP BY 1;

-- Movement marker'ı (bypass ile kapanmış adımlar)
SELECT count(*) FROM roll_movements WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:%';

-- Makine bazlı hacim: bypass ile kapanan işin metrajı hangi makineye yazıldı
-- (`RollMovement.machineId` damgası — atama makine bazında olduğu için artık dolu)
SELECT m.name AS makine, count(*) AS top_adedi, sum(rm."qtyOut") AS metraj
  FROM roll_movements rm
  JOIN machines m ON m.id = rm."machineId"
 WHERE rm.notes LIKE 'KURSUN_BYPASS_FINISHED:%'
 GROUP BY m.name
 ORDER BY metraj DESC NULLS LAST;
```
