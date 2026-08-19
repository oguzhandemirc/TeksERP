# Sürüm 2.9.0 — Deploy Reçetesi (TEK DEPLOY: arama · künye · audit · veri aktarımı)

> **Bu notu sunucudaki oturum okuyacak. Deploy'un TEK reçetesi budur.**
>
> Sahaya en son çıkan sürümden bu yana **üç ayrı iş** birikti (arama katlaması,
> kayıt künyesi + audit derinleştirme, veri aktarımı) ve hepsi **aynı `git pull`**
> ile geliyor. Bu yüzden ayrı notlar birleştirildi: sırayla okunacak ikinci bir
> dosya YOK. Eski `SURUM-2026-08-19-ARAMA-DEPLOY.md` bu dosyaya taşındı.
>
> Genel prosedür: [`DEPLOY-RUNBOOK.md`](./DEPLOY-RUNBOOK.md). Bu dosya runbook'un
> yerine GEÇMEZ, yalnız bu sürüme özgü olanı anlatır.
>
> **Yazan oturumlar sahaya BAĞLANMADI.** Aşağıda "ölçüldü" yazan her şey
> fabrikanın `tekserp_20260814_020002.dump` yedeğinden kurulan bir kopyada
> (`tekserp_deploy_test`) **prova edildi**; ölçülmemiş olan açıkça öyle yazıyor.

---

## İLK 5 DAKİKA — sahadaki PostgreSQL neye sahip

Her şey provada geçti. **Bu deploy'u durduran bir senaryo KALMADI** — migration
eksik uzantıda bile devam eder (bkz. "pg_trgm yoksa"). Yine de ne olacağını
ÖNCEDEN bilmek için, oturuma başlar başlamaz şunu koş — **salt-okunur**,
hiçbir şey değiştirmez:

```powershell
psql -U postgres -d tekserp -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent');"
psql -U postgres -d tekserp -c "SELECT count(*) AS icu_collation FROM pg_collation WHERE collprovider='i';"
```

| Çıktı | Anlamı | Ne yap |
|---|---|---|
| `pg_trgm` satırı VAR (`installed_version` boş olabilir) | Uzantı kurulabilir | ✅ Devam et — migration kendisi kuracak |
| `pg_trgm` satırı **YOK** | contrib dosyaları eksik | ⚠️ **Deploy DURMAZ** ama BORÇ doğar → aşağıdaki "pg_trgm yoksa" |
| `icu_collation` > 0 | Türkçe sıralama kurulacak | ✅ |
| `icu_collation` = 0 | ICU yok | ⚠️ Deploy **DURMAZ** — migration libc `tr_TR.UTF-8`'e düşer, o da yoksa NOTICE basıp sıralamayı olduğu gibi bırakır. **Arama etkilenmez.** |

**`unaccent`a İHTİYAÇ YOK.** Tasarım bilerek ondan vazgeçti (gerekçe
`Teks-Erp/src/utils/search-fold.ts` başlığında). Kurulu görünse bile
**hiçbir şey yapma**.

### pg_trgm yoksa — deploy DURMAZ, ama borç doğar

**Migration önce kurmayı DENER** (`CREATE EXTENSION IF NOT EXISTS pg_trgm`).
Başaramazsa **durmaz**: uyarı basar, 9 trigram index'ini atlar ve kalan her şeyi
uygular. İki yol da fabrika verisinin kopyasında **prova edildi** (yol A: 9 index
kuruldu · yol B: uyarı basıldı, çıkış kodu 0, migration tamamlandı).

O sırada ne çalışır, ne çalışmaz:

| | Durum |
|---|---|
| Türkçe-duyarsız arama | ✅ Çalışır (ölçüldü: `sahin`→ADNAN ŞAHİN ÜRETİM, `akkus`→AKKUŞ TEKSTİL) |
| Mükerrer kontrolü, Türkçe sıralama | ✅ Çalışır (uzantıya bağlı değil) |
| Aramanın HIZI | ⚠️ Index'siz — bugünkü hacimde fark edilmez, **veri büyüdükçe doğrusal yavaşlar** (200 bin satırda ölçüldü: 583 ms ↔ 6 ms) |
| `test_db_invariants` / `test_schema_drift` | 🔴 **KIRMIZI kalır** — borç unutulmasın diye. İndexler eklenince ikisi de kendiliğinden yeşile döner (ölçüldü) |

**Borcu kapatma (müsait bir gün, vardiya içinde bile olur):**

Sahadaki PG **16.9**, `C:\Etkili-Yazilim\pgsql`. Uzantı contrib paketinin parçası,
iki dosya ister: `share\extension\pg_trgm*` ve `lib\pg_trgm.dll`. Aynı sürümün
(16.x) resmî zip'inden kopyalanır. Sonra:

```powershell
# 1) Uzantı — PostgreSQL'i yeniden başlatmak GEREKMEZ (PG13+ "trusted")
psql -U postgres -d tekserp -c "CREATE EXTENSION pg_trgm;"

# 2) 9 index — CONCURRENTLY: tablo yazmaya KAPANMAZ, operatörler çalışmaya devam eder
# ⚠️ HER SATIR AYRI KOMUT. Hepsini tek -c "..." içine koyarsan
#    "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" alırsın
#    ve HİÇBİRİ kurulmaz (ama "kuruldu" sanırsın). Bu tuzağa deneyde düşüldü.
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "customers_nameFold_trgm_idx" ON "customers" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "items_nameFold_trgm_idx" ON "items" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "colors_nameFold_trgm_idx" ON "colors" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "order_lines_customerItemNameFold_trgm_idx" ON "order_lines" USING gin ("customerItemNameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "orders_orderNumber_trgm_idx" ON "orders" USING gin ("orderNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "work_orders_workOrderNumber_trgm_idx" ON "work_orders" USING gin ("workOrderNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "shipments_shipmentNo_trgm_idx" ON "shipments" USING gin ("shipmentNo" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "batches_batchNumber_trgm_idx" ON "batches" USING gin ("batchNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "sacks_sackNo_trgm_idx" ON "sacks" USING gin ("sackNo" gin_trgm_ops);'

# 3) Doğrula — 9 olmalı ve GEÇERSİZ index 0 olmalı
psql -U postgres -d tekserp -c "SELECT count(*) FROM pg_class c JOIN pg_am a ON a.oid=c.relam WHERE a.amname='gin' AND c.relname LIKE '%trgm%';"
psql -U postgres -d tekserp -c "SELECT count(*) AS gecersiz FROM pg_index WHERE NOT indisvalid;"

# 4) Bekçiler yeşile dönmeli
npx tsx scripts/test_db_invariants.ts
npx tsx scripts/test_schema_drift.ts
```

> `CONCURRENTLY` yarıda kalırsa PostgreSQL **geçersiz (invalid)** bir index
> bırakır — 3. adımdaki ikinci sorgu bunu yakalar. Çıkarsa `DROP INDEX` ile at
> ve tekrar kur. Sonradan kurulumun tamamı prova edildi: 9 index kuruldu,
> geçersiz 0, iki bekçi de yeşile döndü.

---

## ⛔ CANLI VERİ MUTLAK YASAKLARI

- `prisma migrate reset` · `migrate dev` · reseed · toplu `DELETE` **YASAK**.
- Migration'ı **`migrate deploy`** uygular. `migrate dev` bu repoda her diff'te
  iki DEFERRABLE composite FK'yı DROP etmek ister.
- Elle SQL koşman gerekirse sıra: `git add` → `db execute` → `migrate resolve
  --applied` → **DOĞRULA**. `resolve` SQL'in koştuğunu **kanıtlamaz**.
- **Canlıda `npm test` KOŞMA** — fixture yazar/siler. Güvenli olanlar §6'da.

---

## 0) Bu deploy'da ne var — 18 migration, dört iş

`migrate status` fabrikanın 14 Ağustos hâline göre **18 bekleyen** gösteriyor
(ölçüldü). Dördü ayrı iş, hepsi aynı pull'da:

| # | Migration | İş |
|---|---|---|
| 1-4 | `20260809015353` · `20260809020429` · `20260809021552` · `20260809023731` | Sapma defteri (RollVariance), tambur öncesi kapanış, iade tersleme, top etiketi müşterisi |
| 5 | `20260809090000_roll_production_timestamps` | `finalizedAt`/`statusChangedAt` + **TRIGGER** |
| 6-8 | `20260809232529` · `20260810010330` · `20260810233446` | Üretim karakteristiği: kat kataloğu, istasyon yetenek bayrakları, özellik değeri |
| 9-11 | `20260817004721` · `20260817105016` · `20260817121448` | Fabrika talep listesi, WO iptal izi, refakat kartı belge versiyonları |
| 12-13 | `20260819023127` · `20260819032151` | **Künye** — 27 modele "kim oluşturdu / kim değiştirdi" |
| 14-16 | `20260819034413` · `20260819034951` · `20260819035418` | Audit derinleştirme: `system_logs.updatedAt` DROP, `changes`, `deviceId` |
| 17 | `20260819060000_search_fold` | **Arama katlaması** — 31 gölge kolon, 9 trigram GIN, 18 kolona Türkçe collation |
| 18 | `20260819120000_import_runs` | **Veri aktarımı** — yeni tablo + enum (mevcut tabloya dokunmaz) |

Diğer notlar (arka plan; deploy adımı içermezler):
`SURUM-2026-08-09-RAPORLAR-DEPLOY.md` · `SURUM-2026-08-10-KAT-KATALOGU-DEPLOY.md` ·
`DEVIR-2026-08-17-FABRIKA-TALEP.md` · tasarım:
[`ARAMA-KATLAMA-SIRALAMA-TASARIM.md`](../design/ARAMA-KATLAMA-SIRALAMA-TASARIM.md) ·
[`IMPORT-EXPORT-TASARIM.md`](../design/IMPORT-EXPORT-TASARIM.md).

### Provada ölçülenler (fabrika verisinin kopyası, `statement_timeout=50s` açık)

| Ölçüm | Sonuç |
|---|---|
| 18 migration | **Hatasız**, toplam **~1 sn** (tablolar küçük: 806 top · 4.449 log · 485 hareket · 190 sipariş) |
| Backend 2.9.0 | **Kalktı**, `/health` → `db: UP` |
| Arama (gerçek veri) | `sahin` → ADNAN ŞAHİN ÜRETİM · `akkus` → AKKUŞ TEKSTİL |
| Eksik izin | **2 tane**: `data:import`, `mobile:kk1-yari-mamul` |
| Backfill'ler | 5'i de DRY-RUN koştu, rakamlar §5'te |

---

## 1) Deploy ÖNCESİ ön-tarama — salt-okunur

```powershell
cd C:\...\Teks-Erp
npx prisma migrate status         # 18 bekleyen görmelisin
git log --oneline -1              # beklenen commit sende mi
pm2 list                          # süreç adını NOT AL (aşağıda gerekiyor)
```

> `migrate status` **18'den fazla** gösteriyorsa bu not yazıldıktan sonra yeni
> migration eklenmiş demektir; sapma değildir ama listeyi gözden geçir.

---

## 2) Yedek — migration'lardan HEMEN ÖNCE

Runbook §3'teki **`premigrate_`** yedeği **atlanmaz**. Bu sürümde 27 modele kolon
ekleniyor, `system_logs`'tan kolon düşüyor ve 18 kolonun collation'ı değişiyor;
geri dönüş yolu yedektir.

---

## 3) Deploy (vardiya dışı)

`Teks-Erp/` **içinden** koşulur (Prisma komutları çalışma dizinine duyarlı).

```powershell
pm2 stop <süreç-adı>          # pm2 list ile teyit ettiğin ad
git pull
npm ci                        # package.json değiştiyse; değişmediyse npm install
npm run prisma:generate
npm run prisma:migrate        # = migrate deploy
npm run build
pm2 start <süreç-adı>
```

**Sıra pazarlık dışı:** `prisma:generate` → `migrate` → `build`. `build` önce
koşarsa eski client ile derlenir ve yeni kolonlar tipte görünmez.

Sonra **panel (Electron)** aynı pencerede dağıtılır.

> **Backend ÖNCE, panel SONRA.** Yeni panel + eski backend = "İçe Aktar" düğmesi
> görünür ama `/api/import/...` **404** döner. Tersi zararsızdır.

### İstemci sürümleri

| Parça | Durum |
|---|---|
| **Backend** | Bu sürüm. Migration'sız **ÇALIŞMAZ** (`nameFold` yoksa P2022) — kod ile migration **atomik** gider. |
| **Electron** | **Aynı pencerede zorunlu.** Veri Aktarımı ekranı + Türkçe arama/sıralama düzeltmeleri orada. |
| **Mobil (APK)** | **Zorunlu değil** — sözleşme değişmedi, eski APK çalışır. Yeni APK katlama + picker sıralama düzeltmelerini ve `mobile:kk1-yari-mamul` ekranını getirir. |

⚠️ **En tehlikeli senaryo:** sunucuda `git pull` yapıp `migrate deploy` KOŞMAMAK.
Kod `adnansahin` branch'inde hazır duruyor ve `nameFold` kolonunu arıyor; pull
edip restart edersen liste ekranları **500** verir. Pull ile migrate **birlikte**.

---

## 4) Deploy SONRASI doğrulama — "başarılı dedi" YETMEZ

`migrate deploy`'un "successfully applied" demesi SQL'in koştuğunu kanıtlamaz.
Şunları **gözle**:

```powershell
psql -U postgres -d tekserp -c "SELECT extname FROM pg_extension;"
psql -U postgres -d tekserp -c "SELECT proname, provolatile FROM pg_proc WHERE proname='tr_fold';"
psql -U postgres -d tekserp -c "SELECT collname, collprovider FROM pg_collation WHERE collname='tr_sort';"
psql -U postgres -d tekserp -c "SELECT count(*) FROM pg_attribute WHERE attgenerated='s' AND attname LIKE '%Fold';"
psql -U postgres -d tekserp -c "SELECT name, \"nameFold\" FROM customers ORDER BY \"nameFold\" LIMIT 5;"
psql -U postgres -d tekserp -c "\d import_runs"
psql -U postgres -d tekserp -c "SELECT column_name FROM information_schema.columns WHERE table_name='system_logs' AND column_name IN ('changes','deviceId','updatedAt');"
```

Beklenen (hepsi provada ölçüldü):

| Kontrol | Beklenen |
|---|---|
| `pg_extension` | `plpgsql`, `pg_trgm` |
| `tr_fold` volatility | `i` (IMMUTABLE) |
| `tr_sort` | var; `collprovider` `i` (ICU) **veya** `c` (libc) |
| GENERATED kolon | **31** |
| `customers.nameFold` | `ADNAN ŞAHİN ÜRETİM` → `adnan sahin uretim` |
| `import_runs` | 17 kolon + 5 index; enum `APPLIED, PARTIAL, FAILED` |
| `system_logs` | `changes` ve `deviceId` VAR, `updatedAt` **YOK** |

---

## 5) BACKFILL'ler — beşi de DRY-RUN varsayılan

Migration'lar kolonu **ekler**, geçmiş satırları doldurmaz. Beşi de fabrika
verisinin kopyasında prova edildi; parantezdeki sayılar **provada çıkanlar**
(canlıda bir miktar farklı olur, mertebesi aynı):

```powershell
npx tsx scripts/backfill_roll_production_timestamps.ts            # önizleme (finalizedAt 53 · statusChangedAt 752)
npx tsx scripts/backfill_roll_production_timestamps.ts --apply

npx tsx scripts/backfill-record-provenance.ts                     # önizleme (oluşturan 781 · son değiştiren 797)
npx tsx scripts/backfill-record-provenance.ts --apply

npx tsx scripts/backfill_roll_entry_station.ts                    # önizleme (SESSION 113 · RECEIPT 3 · PRODUCED_STEP 10)
npx tsx scripts/backfill_roll_entry_station.ts --apply

npx tsx scripts/backfill_roll_label_customer.ts                   # önizleme
npx tsx scripts/backfill_roll_fold_and_reason.ts                  # önizleme (8 topun sebebi audit'te YOK → NULL kalır; doğrusu bu)
```

**Her birini önce `--apply` OLMADAN koş, çıktıyı OKU, sonra uygula.** Sıra
serbest — birbirlerine bağımlı değiller.

> ⚠️ **ARAMA İÇİN BACKFILL YOKTUR ve gerekmez.** `<kolon>Fold` gölgeleri
> `GENERATED ALWAYS … STORED`'dır: değeri PostgreSQL üretir, kolon eklendiği anda
> tüm satırlar dolar. Uygulama o kolonlara **hiç yazmaz**.

---

## 6) Canlıda koşulması GÜVENLİ bekçiler

`npm test` **koşma** (fixture yazar). Bunlar salt-okunur:

```powershell
npx tsx scripts/test_db_invariants.ts        # 79 kontrol — şema-dışı DB nesneleri
npx tsx scripts/test_schema_drift.ts         # repo datamodel ↔ canlı DB
npx tsx scripts/find_fold_duplicates.ts      # mükerrer ad raporu (yazmaz)
```

`test_schema_drift` yalnız **iki bilinen** DEFERRABLE composite FK farkını
göstermeli; başka fark KIRMIZI'dır.

---

## 7) ⏳ ELLE YAPILACAK — izin ataması (iki izin + bir rol yenileme)

Boot uzlaştırması izni **DB'ye getirir ama KİMSEYE ATAMAZ** (*katalog koda, atama
panele*). Provada ölçülen eksikler:

| İzin | Ne açar | Kime |
|---|---|---|
| **`data:import`** | Sistem → **Veri Aktarımı** ekranı + tanım ekranlarındaki "İçe Aktar" düğmeleri | Kurulum/veri işini yapan kişi + planlama sorumlusu |
| **`mobile:kk1-yari-mamul`** | KK1 — dışarıdan alınan yarı mamül kabulü (renkli giriş) | O işi yapan KK1 operatörleri (**yeni APK gerekir**) |

Atanmazsa ekran/düğme **hiç görünmez** ve sebebi hiçbir yerde yazmaz.
**Yapılacak:** Yetkilendirme → Kullanıcılar → kişi → Yetkiler → işaretle →
**kullanıcı yeniden giriş yapsın** (JWT'deki izin listesi bayat kalır).

> ⚠️ **`data:import` TEK BAŞINA YETMEZ, bu tasarım gereğidir.** Her uç ayrıca
> hedef verinin kendi yazma iznini arar: kumaş yüklemek için `data:import` **VE**
> `item:write`. Yalnız `data:import` taşıyan kişi ekranı görür, yazamayacağı
> türlerde düğme pasiftir ("Bu veriye yazma yetkiniz yok").
>
> ⚠️ **`admin:*` bu izni VERMEZ** (`settings:workstation` emsali): tek tıkla
> yüzlerce kaydı değiştirebilen bir yüzey wildcard'la sessizce dağıtılmamalı.

Boot log'unda beklenen satırlar (provada ölçüldü):

```
[permission-catalog] 2 EKSİK izin DB'ye yazıldı: data:import, mobile:kk1-yari-mamul
[role-templates] 'ADMIN_FULL' şablonuna 2 eksik izin eklendi: data:import, mobile:kk1-yari-mamul
[role-templates] 'WEB_SYSTEM_ADMIN' şablonuna 1 eksik izin eklendi: data:import
[role-templates] 'MOBILE_PRODUCTION_OPERATOR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
[role-templates] 'MOBILE_TAMBUR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
```

**Şablonu güncellemek, o şablonla AÇILMIŞ kullanıcıları güncellemez** — şablon
yalnız yeniden uygulandığında etki eder.

### ⏳ Bunun somut sonucu: Tambur operatörüne rol YENİDEN uygulanmalı

Boot uzlaştırması `customer-alias:write` + `label:edit`'i **şablona** ekler
(yukarıdaki iki `MOBILE_*` satırı). Sahadaki Tambur operatörü o şablonla **daha
önce** açıldığı için izinleri **almaz** — tablette müşteri-adı düzeltme kartı
görünmez ve sebebi hiçbir yerde yazmaz.

**Yapılacak:** Yetkilendirme → Kullanıcılar → *Tambur operatörü* → **Rol uygula**
→ `Mobil — Tambur Operatörü` → kaydet → **kullanıcı yeniden giriş yapsın**.

| İzin | Ne açar |
|---|---|
| `label:edit` | Bu top/sipariş için **tek seferlik** ad düzeltmesi (etikete basılan ad) |
| `customer-alias:write` | **Kalıcı** müşteri-adı eşlemesi (bundan sonraki tüm siparişler) |

İkisi ayrı bilinçli: tek seferlik düzeltme sistemdeki adı DEĞİŞTİRMEZ, kalıcı
eşleme değiştirir. Operatöre yalnız birini vermek meşru bir karardır.

Doğrulama:
```powershell
psql -U postgres -d tekserp -c "SELECT code FROM permissions WHERE code IN ('data:import','mobile:kk1-yari-mamul');"
```
İki satır dönmeli. Kullanıcıya atama yapılana kadar `user_permissions` boş — normal.

---

## 8) Veri Aktarımı — 5 dakikalık kabul testi

1. **Sistem → Veri Aktarımı** açılıyor mu? (izni verdiğin kullanıcıyla gir)
2. Bir karttan **"Şablon"** indir → .xlsx üç sayfa olmalı: **Veri · Açıklama · Değerler**.
3. Aynı karttan **"Veriyi indir"** → mevcut kayıtlar şablonla **aynı sütunlarda** gelmeli.
4. İndirdiğin dosyada **tek bir satırı değiştir**, "İçe Aktar" ile yükle →
   önizlemede o satır **"Güncelle"**, diğerleri **"Değişiklik yok"** görünmeli.
   → *En önemli tek doğrulama budur.* Hepsi "Güncelle" görünüyorsa bir dönüştürme
   sorunu var: **UYGULAMA, geri bildir.**
5. **Uygula** → sonuç kartı + Geçmiş tablosunda satır.
6. Herhangi bir listede **"Sütunlar" → "CSV indir"** → Excel'de çift tıkla açılmalı,
   Türkçe karakterler ve sayılar bozulmamış olmalı.

---

## 9) OPERATÖRE ÖNCEDEN SÖYLENECEKLER

Bunlar hata değil **karar**dır; söylenmezse destek çağrısı gelir.

### 9a) Arama artık Türkçe harfe duyarsız
`canakkale` ≡ `ÇANAKKALE`, `sahin` ≡ `ŞAHİN`, `isik`/`ışık`/`IŞIK` aynı sonucu
verir. Çok kelimeli aramada sıra önemsiz ("şahin tekstil" ≡ "tekstil şahin").
Liste **daha çok** sonuç döndürecek — operatör "yanlış kayıt geldi" sanabilir,
doğrusu budur.

### 9b) Aynı ad ikinci kez EKLENEMEZ — kapsam genişledi
`ŞAHİN TEKSTİL` varken `SAHIN TEKSTIL` de mükerrer sayılır, 409 döner. Sahada aynı
firma üç yazımla giriliyordu. **Geçmiş kayıtlara dokunulmaz**, yalnız yeni yazımlar
engellenir.

### 9c) Listeler artık Türkçe sıralanıyor
ICU varsa: `Cebeci < Ceyhan < Çanakkale < Işık < İnci < Zonguldak`.
**Öncesi (C locale):** `… Zonguldak < Çanakkale < İnci` — yani Ç/Ğ/İ/Ö/Ş/Ü ile
başlayan **her ad listenin en sonundaydı**. Birçok "kayıt yok" şikayetinin sebebi
buydu.

### 9d) Veri aktarımının davranış sözleşmeleri
- **Önizleme hiçbir şey yazmaz.** "Uygula" demeden tek kayıt değişmez.
- **Varsayılan: ya hep ya hiç.** Tek satırda hata varsa hiçbir şey yazılmaz;
  kullanıcı isterse "hatalı satırları atla"yı işaretler.
- **Boş hücre = O ALANA DOKUNMA.** Temizlemek için hücreye `NULL` yazılır.
- **Sunucunun ürettiği kodlar (RNK…, MUS…, ROT…, REC…, IST…, MAK…) dosyadan
  YAZILMAZ.** Yeni kayıtta kod hücresi **boş** bırakılır; dolu ama eşleşmeyen kod
  **hata** verir.
- **`PARTIAL` diye bir sonuç vardır:** doğrulama tüm satırlar için önceden koşar;
  yazarken beklenmedik hata çıkarsa **ilk hatada durulur** ve sonuç *"yazma N.
  satırda durdu"* der. Kısmi sonuç asla sessiz değildir.
- **Sipariş içe aktarımı YALNIZ YENİ SİPARİŞ AÇAR.** Aynı dosya iki kez
  yüklenirse iki sipariş olur. Son 90 günde aynı müşteriye aynı toplam metrajlı
  sipariş varsa **uyarı** verilir, engellenmez.
- **Rota ve Sipariş şablonları gruplu:** her ADIM / her KALEM ayrı satır, anahtar
  sütununa göre gruplanır. Adım/kalem listesi **replace**'tir — dosyada olmayan
  adım rotadan **silinir**.
- **Kalite Sınıfları ekranında "İçe Aktar" düğmesi YOK** (liste bilinçli
  salt-okunur), ama tür Veri Aktarımı ekranından aktarılabilir.
- **Dışa aktarım için ek izin yok** — listeyi görebilen indirebilir.
- **CSV biçimi:** `;` ayraç + ondalık **virgül** + UTF-8 BOM ("Türk Excel'i"
  sözleşmesi). Kendi içe aktarıcımız ayracı/ondalığı **otomatik algılar**, yani
  indir-düzenle-geri yükle çalışır.

---

## 10) BEKLENEN "KIRMIZI" — mükerrer müşteri (kod kusuru DEĞİL)

Deploy sonrası `find_fold_duplicates.ts` (ve `test_consistency` §18) mükerrer
gösterecek. Geliştirme kopyasında ölçülen: **12 grup / 15 fazla satır**:

```
Müşteri: Moda Tekstil [aktif]   |  MODA TEKSTİL [aktif]      ← ikisi de AKTİF
Kumaş  : ACTIVO [aktif]         |  ACTİVO [PASİF]            ← i/İ tuzağı
```

### Kararı hızlandıran ölçüm (salt-okunur, geliştirme kopyasında)

Fabrikaya "birleştirin" demeden önce **hangisinin gerçekten kullanıldığı**
sorulur. Çiftler için tek sorguyla bakılabilir:

```sql
SELECT c.code, c.name, c."isActive",
       (SELECT count(*) FROM orders o            WHERE o."customerId"=c.id)      AS siparis,
       (SELECT count(*) FROM shipments s         WHERE s."customerId"=c.id)      AS sevkiyat,
       (SELECT count(*) FROM customer_branches b WHERE b."customerId"=c.id)      AS sube,
       (SELECT count(*) FROM rolls r             WHERE r."labelCustomerId"=c.id) AS etiketli_top
FROM customers c WHERE c."nameFold" = public.tr_fold('Moda Tekstil');
```

Bu çift için ölçülen (geliştirme kopyası, 2026-08-19):

| Kod | Ad | Sipariş | Sevkiyat | Şube | Etiketli top |
|---|---|---|---|---|---|
| `MUS1707260010` | MODA TEKSTİL | **6** | 0 | 0 | 0 |
| `MUS-002` | Moda Tekstil | 0 | 0 | 1 | 1 |

⚠️ **Bu tablo bir öneri DEĞİL, girdidir.** İkisi de bağlantı taşıyor (biri
siparişleri, diğeri bir şube + bir etiketli top), yani "boş olanı kapat" diye
otomatik bir cevap YOK. Ayrıca `MUS-002` kodu standart `MUS+GGAAYY+NNNN`
biçiminde DEĞİL — kurulum/demo kaynaklı olabilir; bu da kararı fabrikanın
vermesini gerektiren bir sebep, kendi başına birleştirme gerekçesi değil.

Bu **gerçek bir veri sorunudur** ve sürüm onu *yaratmadı*, artık *görebiliyor*
(`name` Türkçe collation'a geçince `lower('İ')` düzeldi ve kontrol daha önce kör
olduğu çifti görüyor). **Otomatik birleştirme YOK ve olmamalı** — hangi kaydın
kalacağı, siparişlerin/topların hangisine bağlı olduğu **işletme kararıdır**.
Raporu fabrikaya ver, birleştirmeyi onlar söylesin. **Veriye kendi başına dokunma.**

> Bu yüzden `nameFold` üzerinde **DB UNIQUE kısıtı KONMADI** — konsaydı migration
> tam bu satırlarda deploy anında düşerdi. Veri temizlendikten sonra UNIQUE
> eklemek ayrı ve 5 satırlık bir migration olur.

---

## 11) Riskler ve sınırlar (veri aktarımı)

| Konu | Durum |
|---|---|
| **Satır tavanı** | İstek başına **10.000 satır**; aşarsa panel dosyayı reddeder ve bölmeyi söyler. |
| **Gövde limiti** | `/api/import` ve `/api/config-bundle` router'ları **10 MB** JSON kabul eder. **Global 1 MB limiti DEĞİŞMEDİ** — gevşeme yalnız bu iki yola özgü. |
| **Performans** | 10.000 satırlık koşum **ölçülmedi**. Yazma mevcut servisler üzerinden satır satır ilerler (guard'lar korunsun diye). İlk gerçek kullanımda **200-500 satırla** başlanmalı. |
| **Yeni npm paketi** | **YOK.** Dosyayı panel ayrıştırır (`exceljs` zaten paneldeydi). |
| **Geri alma** | İçe aktarımın kendisi geri alınamaz (kayıtlar normal kayıttır). Yanlış yükleme panelden düzeltilir/pasife alınır. Bu yüzden "önce önizleme" alışkanlığı sahaya anlatılmalı. |
| **İçe aktarım geçmişi** | `import_runs` **arşivlenmez** — audit 6 ayda arşive taşınır, bu tablo kalır ("bu 400 müşteriyi kim yükledi" yıllar sonra sorulur). |

---

## 12) ROLLBACK

1. `pm2 stop <süreç-adı>`
2. Önceki commit'e dön (`git checkout <önceki>`), `npm ci && npm run build`
3. **DB'yi geri almak için:** `premigrate_` yedeğinden restore (runbook §5).
   Migration'lar geri-alınamaz kabul edilir.
4. Yalnız **veri aktarımını** geri almak: `DROP TABLE import_runs; DROP TYPE
   "ImportRunStatus";` — kaybolan yalnız içe aktarım geçmişidir, iş verisi değil.
5. Yalnız **aramayı** geri almak (nadiren gerekir): DB'ye dokunmadan önceki
   backend sürümüne dönmek yeterli — gölge kolonlar türetilmiştir, varlıkları
   eski kodu bozmaz.
6. Trigram index'leri sorun çıkarırsa (beklenmiyor) tek tek `DROP INDEX
   CONCURRENTLY` ile atılabilir; arama index'siz çalışmaya devam eder.

---

## 13) İLERİDE DOKUNACAK OLAN İÇİN — iki teknik tuzak

1. **Sıra load-bearing:** collation değişimi generated kolondan **ÖNCE** gelmek
   zorunda; tersi PostgreSQL tarafından reddedilir
   (`ERROR: cannot alter type of a column used by a generated column`).
   Katlanmış bir kolonun tipini/collation'ını değiştirecek olan, önce gölge
   kolonu DROP etmeli.
2. **`tr_fold` içindeki `COLLATE "C"` pini süs değil.** Ad kolonları Türkçe
   collation'a geçti; tr collation altında `lower('I')` = `'ı'` olur ve katlama
   i-ailesini **ayırırdı** (arama sessizce bozulurdu). Aynı pin, geliştirme
   ortamı (ICU en-US) ile sahadaki C locale kurulumunun **aynı** cevabı vermesini
   sağlıyor.

---

## 14) BİTİNCE — bu bölümü sunucudaki oturum doldursun

```
Deploy tarihi/saati       :
pg_trgm durumu            : (kuruluydu / contrib kopyalandı / …)
ICU (tr_sort provider)    : i (ICU) / c (libc) / kurulamadı
migrate deploy süresi     :
GENERATED kolon sayısı    :        (31 bekleniyor)
import_runs tablosu       : ☐
system_logs changes/device: ☐
Backfill'ler              : timestamps ☐  provenance ☐  entry_station ☐  label_customer ☐  fold_and_reason ☐
İzin ataması              : data:import → ................  ·  mobile:kk1-yari-mamul → ................
Tambur rolü yeniden      : ☐ (label:edit + customer-alias:write — kullanıcı: ................)
find_fold_duplicates      : ...... grup / ...... fazla satır  → fabrikaya iletildi mi ☐
Veri Aktarımı kabul testi : ☐ (§8'in 6 adımı)
Electron sürümü           :
APK sürümü                : (dağıtıldıysa)
Sorun / sapma             :
```
