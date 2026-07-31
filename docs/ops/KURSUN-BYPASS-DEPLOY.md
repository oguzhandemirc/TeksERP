# Kurşun Bypass — Canlı DB Devreye Alma Notu

> **CANLI FABRİKA DB'si.** Genel kurallar `DEPLOY-RUNBOOK.md` + `URETIM-KONTROL-LISTESI.md`.
> Burada yalnız **Kurşun Bypass** özelliğinin canlıya alınması için gereken adımlar var.
> `npm run seed` / `prisma migrate reset` **ASLA koşmaz** — seed yalnız ilk kurulumda
> koşan bir dosyadır, mevcut fabrikada çalıştırılırsa veriyi düşürür.

## Özellik nedir (bir paragraf)

Fabrika kurşun istasyonlarına tablet **koymuyor**. Kurşun işlemi fiziksel olarak yapılır
ama dijital izlenmez (hatalar kâğıtta kalır). Yetkili personel, fason dönüşüyle kurşun
adımında bekleyen iş emirlerini yeni **Kurşun Dağıtım** ekranından fiziksel bir kurşun
istasyonuna **atar**. Tambur, iş emri refakat kartının karekodunu okuttuğunda önizleme +
onay ile Kurşun/KK2 adımı **COMPLETED** sayılır ve toplar Tambur adımına geçer (kalite
NULL kalır — kaliteyi Tambur belirler). Kurşun rotanın SON adımıysa, dağıtım ekranındaki
**"İşi Bitir"** ile tamamlanır (`finalizeRollsAtLastStep` → `WAREHOUSE`).

> ⚠️ **Bu SKIPPED DEĞİLDİR.** Adım atlanmaz; `RollMovement`'lar normal şekilde kapanır ve
> adım `COMPLETED` olur. Fark: `RollOperation` (`KURSUN_APPLIED` / `QC2_COMPLETED`)
> **yazılmaz**, `RollError` açılmaz. İz üçlüsü: movement notes marker'ı
> (`KURSUN_BYPASS_FINISHED:<uuid>`) + `kursun_bypass_assignments` satırı + audit kaydı.
> İstasyon yetenekleri (`copyStationCapabilitiesToRoll`) **YİNE kopyalanır** — topun
> KURŞUN özelliği kaybolmasın.

---

## (d) Migration

**`20260731120000_add_kursun_bypass_assignment`**

- `CREATE TYPE "KursunBypassCompletionSource"` (`TAMBUR_SCAN`, `DISTRIBUTION_LAST_STEP`)
- `CREATE TABLE "kursun_bypass_assignments"` (BOŞ doğar) + 3 FK index + 7 FK
- `CREATE UNIQUE INDEX "kursun_bypass_one_pending_per_step_uq" ... WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL`
  — şema-dışı **partial unique**: "bir adımda EN FAZLA BİR açık atama" seddi.

**Canlı veriye DOKUNMAZ:** mevcut tabloda `ALTER` yok → tablo rewrite yok, uzun kilit yok.
Vardiya saati kısıtı bu migration için geçerli değil (kök kural 14 dolu tabloya index
ekleyen migration'lar içindir).

**Migration ELLE yazıldı** (`prisma migrate dev` üretmedi — `sacks` DEFERRABLE composite
FK drift'i + partial unique `@@unique` ile ifade edilemiyor). Uygulama sırası:

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
| `workorder:distribute` | `PRODUCTION` | `web` | Kurşun dağıtım — iş emrini fiziksel kurşun istasyonuna atama + son-adım tamamlama |
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
eder**: aktif `PROCESS_QC` istasyonlarını KURSUN yeteneğiyle birlikte listeler ve
bayrağın durumunu yazar — yani (b) ve (c) adımlarında neyin eksik olduğunu sana
önceden söyler. Mevcut açıklamaları EZMEZ (elle düzeltilmiş olabilir).

> Script yalnız İZİN tarafını kurar. Fiziksel kurşun istasyonları fabrikaya özgü
> veridir (kaç makine, hangi ad) → panelden açılır, script yaratmaz.

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
   'Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun istasyonuna atama + son-adım tamamlama',
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
          'Kurşun dağıtım ekranı (iş emrini fiziksel kurşun istasyonuna ata + son adımsa işi bitir)',
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

## (b) Fiziksel kurşun istasyonları tanımlanmalı

Dağıtım ekranı, iş emrini bir **fiziksel kurşun istasyonuna** atar. Bugün canlıda tek bir
`KURSUN_KK2` mantıksal istasyonu olabilir; bypass düzeni **her fiziksel kurşun makinesi
için ayrı `Station` satırı** ister (dağıtımcı "hangi makineye verdim" diyebilsin).

Her fiziksel kurşun istasyonu için:

1. **`Station.kind = PROCESS_QC`** (Kurşun + KK2 tek fiziksel istasyondur).
   `type = INTERNAL`, `allowAsWorkOrderStep = true`, anlamlı `code` (`KURSUN_1`,
   `KURSUN_2`, …) ve `name`.
2. **`StationProperty` yeteneği = `KURSUN`** (`fabric_properties.code = 'KURSUN'`).
   Bu **load-bearing**: bypass tamamlanırken `copyStationCapabilitiesToRoll` yine koşar
   ve topa KURŞUN özelliğini bu yetenekten yazar. Yetenek atanmazsa iş "kurşun gördü"
   izini kaybeder ve WO planlamada hedef özellik doğrulaması düşer.

**Panelden yap** (Tanımlar → İstasyonlar → yeni istasyon → Özellikler sekmesinde KURSUN
işaretle). SQL'le istasyon yaratma — audit kaydı ve kod üretimi atlanacağı için — önerilmez.

**Ön kontrol (salt-okunur):**

```sql
-- Kurşun yeteneği olan PROCESS_QC istasyonları
SELECT s.code, s.name, s.kind, s."isActive", fp.code AS ozellik
  FROM stations s
  LEFT JOIN station_properties sp ON sp."stationId" = s.id
  LEFT JOIN fabric_properties  fp ON fp.id = sp."propertyId"
 WHERE s.kind = 'PROCESS_QC'
 ORDER BY s.code;
-- Her fiziksel kurşun makinesi için 1 satır + ozellik = 'KURSUN' bekleniyor
```

---

## (c) Bayrak KAPALI açılır, sonra panelden açılır

Ayar anahtarı: **`production.kursunBypassEnabled`**, varsayılan **`false`**.

- Canlı DB'ye **INSERT gerekmez**: `readKursunBypassEnabled` kayıt yoksa `false` döner.
  Ayarı panelden ilk kez açtığında satır kendiliğinden yazılır (`setFeatureFlags` upsert).
- **ENFORCE edilir ama kapsamı DAR:** bayrak yalnız **YENİ ATAMA OLUŞTURMAYI** kapılar.
  Kapalıyken "kurşun dağıt" 400 döner.
- **Dağıtılmış iş emirleri bayrak sonradan kapansa da bypass rejiminde biter** —
  iptal / son-adım tamamlama / Tambur kart-okutma onayı çalışmaya devam eder. Rejim
  **atama satırında** kalıcıdır (`kursun_bypass_assignments`), ayarda değil. Aksi halde
  bayrağı kapatmak, kurşunu fiziksel olarak görmüş ama dijital karşılığı açık kalmış
  işleri sahada kilitlerdi.

**Devreye alma sırası (bu sırayla):**

1. `migrate deploy` + doğrulama (yukarıda §d)
2. Permission INSERT + kullanıcılara bağlama (§a) — **bayrak hâlâ KAPALI**
3. Fiziksel kurşun istasyonları + KURSUN yeteneği (§b)
4. **İSTEMCİLER YENİDEN DAĞITILIR** (aşağıda §e) — backend'i güncellemek yetmez
5. Yetkili kullanıcı **yeniden giriş yapar** (JWT içindeki permission listesi yenilensin)
6. Panel → Genel Ayarlar → **Kurşun bypass = AÇIK**
7. Tek bir iş emriyle uçtan uca dene: dağıt → Tambur'da kart okut → önizleme → onayla →
   adım `COMPLETED` + toplar Tambur adımında mı?

**Geri alma (özellik sorun çıkarırsa):** panelden bayrağı **KAPAT**. Yeni dağıtım
yapılamaz; sahada açık kalan atamalar normal şekilde tamamlanır ya da dağıtım ekranından
iptal edilir (iptalde adımın istasyonu `originalStationId`'den geri yüklenir). Migration
geri alınmaz — tablo boş bile olsa yerinde bırakılır.

---

## (e) İstemciler yeniden dağıtılmalı — backend tek başına YETMEZ

Bu özellik üç projeye birden dokunur; **ekranlar istemci paketinin İÇİNDE gelir**, sunucudan
indirilmez. Yalnız backend güncellenirse bayrağı açan kişi hiçbir değişiklik göremez ve
"özellik çalışmıyor" der.

| Proje | Ne geldi | Ne yapılmalı |
|---|---|---|
| `Teks-Erp/` | `/api/kursun-bypass/*` uçları, `POST /api/tambur/bypass-complete`, tablet guard'ları | `git pull` + `npm ci` + `migrate deploy` + `pm2 restart` |
| `Electron/` | **Kurşun Dağıtım** sayfası, Genel Ayarlar'daki bayrak kartı, istasyon-gruplu Kurşun Sırası | Yeni kurulum paketi (`npm run build:win`) → operatör bilgisayarlarına kurulum |
| `mobil/` | **Kurşun Dağıtım** ekranı, Tambur'daki bypass onay modalı | Yeni APK (versionCode artırılmış) → tabletlere kurulum |

> **Tablet APK'sı ESKİ kalırsa ne olur:** Tambur ekranı `bypassPending` alanını tanımaz;
> dağıtılmış bir kartı okutunca eski hata mesajını gösterir ("iş emri Tambur adımında
> değil") ve **kurşun adımı hiçbir zaman kapanmaz** — iş sahada kilitlenir. Bu yüzden
> bayrağı açmadan ÖNCE Tambur tabletlerinin güncel APK'yı aldığı doğrulanmalıdır.
> (Kaçış yolu: dağıtımı Kurşun Dağıtım ekranından iptal et → iş normal tabletli akışa döner.)

---

## Doğrulama sorguları (özellik açıldıktan sonra)

```sql
-- Açık (bekleyen) bypass atamaları
SELECT k.id, w."workOrderNumber", s.code AS atanan_istasyon,
       u.username AS dagitan, k."assignedAt", k.notes
  FROM kursun_bypass_assignments k
  JOIN work_orders w ON w.id = k."workOrderId"
  JOIN stations    s ON s.id = k."stationId"
  JOIN users       u ON u.id = k."assignedById"
 WHERE k."completedAt" IS NULL AND k."cancelledAt" IS NULL
 ORDER BY k."assignedAt";

-- Nasıl kapandılar (izlenebilirlik)
SELECT "completedVia", count(*)
  FROM kursun_bypass_assignments
 WHERE "completedAt" IS NOT NULL
 GROUP BY 1;

-- Movement marker'ı (bypass ile kapanmış adımlar)
SELECT count(*) FROM roll_movements WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:%';
```
