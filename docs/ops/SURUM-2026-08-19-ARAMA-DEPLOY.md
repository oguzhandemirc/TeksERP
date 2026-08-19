# Sürüm 2026-08-19 — Deploy Reçetesi (arama katlaması + künye + 13 birikmiş migration)

> **Bu notu sunucudaki oturum okuyacak.** Yazan oturum sahaya BAĞLANMADI; her şey
> `~/Downloads/tekserp_20260814_020002.dump` (fabrikanın 02:00 yedeği) kopyasına
> kurulan `tekserp_deploy_test` üzerinde **prova edildi**. Prova sonuçları aşağıda
> "ölçüldü" diye işaretli; ölçülmemiş olan her şey açıkça öyle yazıyor.
>
> Genel prosedür: [`DEPLOY-RUNBOOK.md`](./DEPLOY-RUNBOOK.md). Bu dosya YALNIZ bu
> sürüme özgü riskleri anlatır ve runbook'un yerine GEÇMEZ.

---

## İLK 5 DAKİKA — bu sürümün tek gerçek belirsizliği

Bu deploy'un durabileceği **tek** yer PostgreSQL uzantısıdır. Başka her şey provada
geçti. Oturuma başlar başlamaz şunu koş (salt-okunur, hiçbir şey değiştirmez):

```powershell
psql -U postgres -d tekserp -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent');"
psql -U postgres -d tekserp -c "SELECT count(*) AS icu_collation FROM pg_collation WHERE collprovider='i';"
```

| Çıktı | Anlamı | Ne yap |
|---|---|---|
| `pg_trgm` satırı VAR (installed boş olabilir) | Uzantı kurulabilir | ✅ Devam |
| `pg_trgm` satırı **YOK** | contrib dosyaları eksik | ⛔ **DUR.** Aşağıdaki "pg_trgm yoksa" bölümü |
| `icu_collation` > 0 | Türkçe sıralama kurulacak | ✅ |
| `icu_collation` = 0 | ICU yok | ⚠️ Deploy DURMAZ — migration libc `tr_TR.UTF-8`'e düşer, o da yoksa NOTICE basıp sıralamayı olduğu gibi bırakır. Arama etkilenmez. |

**`unaccent`a İHTİYAÇ YOK.** Tasarım bilerek ondan vazgeçti (gerekçe:
`src/utils/search-fold.ts` başlığı). Kurulu değilse **hiçbir şey yapma**.

### pg_trgm yoksa
Sahadaki PG **16.9**, `C:\Etkili-Yazilim\pgsql`. Uzantı contrib paketinin parçası ve
iki dosya ister: `share\extension\pg_trgm*` + `lib\pg_trgm.dll`. Aynı sürümün
(16.x) resmî zip'inden kopyalanır, sonra `CREATE EXTENSION pg_trgm;` çalışır —
**PostgreSQL yeniden başlatmak gerekmez** (PG13+'ta `trusted` uzantı).
Dosyalar temin edilemiyorsa **deploy'u ERTELE**: `20260819060000_search_fold`
migration'ı ilk komutunda düşer ve `migrate deploy` orada durur (önceki 14
migration uygulanmış olur — bu güvenlidir, yarım kalan tek şey aramadır).

---

## ⛔ CANLI VERİ MUTLAK YASAKLARI (değişmedi)

- `prisma migrate reset` · `migrate dev` · reseed · toplu `DELETE` **YASAK**.
- Migration'ı `migrate deploy` uygular. `migrate dev` bu repoda her diff'te iki
  DEFERRABLE composite FK'yı DROP etmek ister.
- Elle SQL koşman gerekirse: `git add` → `db execute` → `migrate resolve --applied`
  → **DOĞRULA**. `resolve` SQL'in koştuğunu KANITLAMAZ.

---

## 0) Bu sürümde ne var — 15 migration, üç ayrı iş

`migrate status` provada **15 bekleyen** gösterdi (fabrikanın 14 Ağustos hâline göre):

| # | Migration | İş |
|---|---|---|
| 1-4 | `2026080901…` – `20260809023731` | Sapma defteri (RollVariance), tambur öncesi kapanış, iade tersleme, top etiketi müşteri |
| 5 | `20260809090000_roll_production_timestamps` | `finalizedAt`/`statusChangedAt` + **TRIGGER** |
| 6-8 | `20260809232529`, `20260810010330`, `20260810233446` | Üretim karakteristiği: kat kataloğu, istasyon yetenek bayrakları, özellik değeri |
| 9-11 | `20260817004721`, `20260817105016`, `20260817121448` | Fabrika talep listesi, WO iptal izi, refakat kartı belge versiyonları |
| 12-13 | `20260819023127`, `20260819032151` | **Künye** (kim oluşturdu/değiştirdi) — 27 modele kolon |
| 14 | `20260819034413_systemlog_drop_updatedat` | `system_logs.updatedAt` DROP |
| 15 | `20260819060000_search_fold` | **Arama katlaması** — bu notun ana konusu |
| 16 | `20260819034951_systemlog_changes` | `system_logs.changes` — alan-bazlı değişiklik (audit Faz B2) |
| 17 | `20260819035418_systemlog_device` | `system_logs.deviceId` — olayın cihazı (audit Faz B3) |

> ℹ️ **16-17 bu not yazıldıktan SONRA eklendi** (audit derinleştirme B2/B3).
> İkisi de tek nullable kolon; tablo yeniden yazımı yok, index eklemiyor,
> prova sonucunu değiştirmez. `migrate status` provadaki 15 yerine **17**
> bekleyen gösterecek — bu beklenen durumdur, sapma değil.
>
> Backend `package.json` sürümü bu turda **2.7.0 → 2.8.0** yükseltildi.

> ⚠️ Yani bu **yalnız arama sürümü değil**. Fabrikaya "arama düzeldi" derken
> künye, sapma defteri ve kat kataloğu da aynı anda canlıya çıkıyor. Onların
> kendi devir notları var: `SURUM-2026-08-09-RAPORLAR-DEPLOY.md`,
> `SURUM-2026-08-10-KAT-KATALOGU-DEPLOY.md`, `DEVIR-2026-08-17-FABRIKA-TALEP.md`.

**Prova sonucu (ölçüldü):** 15 migration'ın tamamı fabrika verisinin kopyasında
**hatasız** uygulandı, `statement_timeout=50s` açıkken. Süre saniyeler mertebesinde
(tablolar küçük: 806 top · 4.449 log · 485 hareket · 190 sipariş). Ardından
**backend gerçekten kalktı** ve `/health` `db: UP` döndü.

---

## 1) Deploy ÖNCESİ ön-tarama — salt-okunur

```powershell
cd C:\...\Teks-Erp
npx prisma migrate status                       # 15 bekleyen görmelisin
git log --oneline -1                            # beklenen commit sende mi
```

Sonra **mükerrer ad raporu** (yeni; hiçbir şey yazmaz):

```powershell
npx tsx scripts/find_fold_duplicates.ts
```

> Bu script migration'dan SONRA anlamlıdır (gölge kolonu okur). Deploy öncesi
> koşarsan "column does not exist" der — normal, adım 5'te koş.

---

## 2) Yedek — migration'lardan HEMEN ÖNCE

Runbook §3'teki `premigrate_` yedeği **atlanmaz**. Bu sürümde 27 modele kolon
ekleniyor ve `system_logs`'tan kolon düşüyor; geri dönüş yolu yedektir.

---

## 3) Deploy (vardiya dışı)

```powershell
pm2 stop tekserp-api
npm ci
npm run prisma:generate
npm run prisma:migrate        # = migrate deploy
npm run build
pm2 start tekserp-api
```

**Sıra pazarlık dışı:** `prisma:generate` → `migrate` → `build`. `build` önce
koşarsa eski client ile derlenir ve yeni kolonlar tipte görünmez.

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
```

Beklenen (provada ölçülen değerler):

| Kontrol | Beklenen |
|---|---|
| `pg_extension` | `plpgsql`, `pg_trgm` |
| `tr_fold` volatility | `i` (IMMUTABLE) |
| `tr_sort` | var; `collprovider` `i` (ICU) ya da `c` (libc) |
| GENERATED kolon | **31** |
| `customers.nameFold` | `ADNAN ŞAHİN ÜRETİM` → `adnan sahin uretim` |

Sonra bekçileri koş (hepsi salt-okunur değil — `npm test` fixture yazar/siler;
**canlıda `npm test` KOŞMA**). Canlıda yalnız şunlar güvenli:

```powershell
npx tsx scripts/test_db_invariants.ts        # 79 kontrol — şema-dışı nesneler
npx tsx scripts/test_schema_drift.ts         # repo datamodel ↔ canlı DB
npx tsx scripts/find_fold_duplicates.ts      # salt-okunur rapor
```

---

## 5) BACKFILL'ler — beşi de DRY-RUN varsayılan

Migration'lar kolonu **ekler**, geçmiş satırları doldurmaz. Beşi de fabrika
verisinin kopyasında prova edildi; parantez içindeki sayılar **provada çıkan**
rakamlar (canlıda bir miktar farklı olacak, mertebesi aynı):

```powershell
npx tsx scripts/backfill_roll_production_timestamps.ts     # önizleme  (finalizedAt 53 · statusChangedAt 752)
npx tsx scripts/backfill_roll_production_timestamps.ts --apply

npx tsx scripts/backfill-record-provenance.ts              # önizleme  (oluşturan 781 · son değiştiren 797)
npx tsx scripts/backfill-record-provenance.ts --apply

npx tsx scripts/backfill_roll_label_customer.ts            # önizleme
npx tsx scripts/backfill_roll_fold_and_reason.ts           # önizleme  (8 topun sebebi audit'te YOK → NULL kalır, doğrusu bu)
npx tsx scripts/backfill_roll_entry_station.ts             # önizleme  (SESSION 113 · RECEIPT 3 · PRODUCED_STEP 10)
```

**Her birini önce `--apply` OLMADAN koş, çıktıyı OKU, sonra uygula.** Sıra
serbest — birbirlerine bağımlı değiller.

> ⚠️ **Arama için backfill YOKTUR ve gerekmez.** `<kolon>Fold` gölgeleri
> `GENERATED ALWAYS … STORED`'dır: değeri PostgreSQL üretir, kolon eklendiği anda
> tüm satırlar dolar. Uygulama o kolonlara **hiç yazmaz**.

---

## 6) İZİN ATAMASI — elle, unutulursa ekran görünmez

Boot uzlaştırması izni **DB'ye getirir, kimseye ATAMAZ** (*katalog koda, atama
panele*). Provada ölçüldü — fabrikada eksik olan **tek** izin:

| İzin | Ne açar |
|---|---|
| `mobile:kk1-yari-mamul` | KK1 — dışarıdan alınan yarı mamül kabulü (renkli giriş) |

Boot ayrıca şu rol şablonlarını tamamlayacak (log'da göreceksin):
`ADMIN_FULL` +1 · `MOBILE_PRODUCTION_OPERATOR` +2 (`customer-alias:write`,
`label:edit`) · `MOBILE_TAMBUR` +2.

**Şablonu güncellemek, o şablonla AÇILMIŞ kullanıcıları güncellemez.** Yarı mamül
ekranını kullanacak operatörlere izni Yetki ekranından elle ver, sonra
**kullanıcı yeniden giriş yapsın** (JWT'deki izin listesi bayat kalır).

Boot log'unda beklenen satırlar:

```
[permission-catalog] 1 EKSİK izin DB'ye yazıldı: mobile:kk1-yari-mamul
[role-templates] 'ADMIN_FULL' şablonuna 1 eksik izin eklendi: ...
```

---

## 7) OPERATÖRE ÖNCEDEN SÖYLENECEK — üç davranış değişikliği

Bunlar hata değil, **bilinçli** değişiklik. Söylenmezse destek çağrısı gelir.

### 7a) Arama artık Türkçe harfe duyarsız
`canakkale` ile `ÇANAKKALE`, `sahin` ile `ŞAHİN`, `isik`/`ışık`/`IŞIK` **aynı**
sonucu verir. Çok kelimeli aramada sıra önemsiz: "şahin tekstil" ≡ "tekstil şahin".
Bu, listenin **daha çok** sonuç döndürmesi demektir — operatör "yanlış kayıt geldi"
sanabilir, oysa doğrusu budur.

### 7b) Aynı ad ikinci kez EKLENEMEZ — kapsam genişledi
Artık `ŞAHİN TEKSTİL` varken `SAHIN TEKSTIL` de mükerrer sayılır ve 409 döner.
Sahada aynı firma üç yazımla giriliyordu; kural bunu kapatıyor.
**Geçmiş kayıtlara dokunulmaz** — sadece yeni yazımlar engellenir.

### 7c) Listeler artık Türkçe sıralanıyor
ICU varsa: `Cebeci < Ceyhan < Çanakkale < Işık < İnci < Zonguldak`.
**Öncesi** (C locale): `Cebeci < Ceyhan < Işık < Zonguldak < Çanakkale < İnci` —
yani Ç/Ğ/İ/Ö/Ş/Ü ile başlayan HER ad listenin en sonundaydı. Bu, birçok kullanıcının
"kayıt yok" sanmasının sebebiydi; artık doğru yerde.

---

## 8) BEKLENEN "KIRMIZI" — mükerrer müşteri (kod kusuru DEĞİL)

Deploy sonrası `find_fold_duplicates.ts` (ve `test_consistency` §18) mükerrer
gösterecek. Geliştirme kopyasında ölçülen: **12 grup / 15 fazla satır**, en
önemlisi:

```
Müşteri: Moda Tekstil [aktif]  |  MODA TEKSTİL [aktif]
Kumaş:   ACTIVO [aktif]  |  ACTİVO [PASİF]        ← i/İ tuzağı
```

Bunlar **gerçek veri sorunu** ve sürüm onları *yarattığı* için değil, artık
*görebildiği* için çıkıyor (`name` Türkçe collation'a geçince `lower('İ')` düzeldi).
**Otomatik birleştirme YOK ve olmamalı** — hangi kaydın kalacağı, siparişlerin/topların
hangisine bağlı olduğu işletme kararıdır. Raporu fabrikaya ver, birleştirmeyi onlar
söylesin.

> Bu yüzden `nameFold` üzerinde **DB UNIQUE kısıtı KONMADI**. Konsaydı migration
> tam bu satırlarda deploy anında düşerdi. Veri temizlendikten sonra UNIQUE
> eklemek 5 satırlık ayrı bir migration olur.

---

## 9) İSTEMCİ SÜRÜMLERİ

| Parça | Durum |
|---|---|
| **Backend** | Bu sürüm. Migration'sız ÇALIŞMAZ (`nameFold` kolonu yoksa P2022) — ikisi ATOMİK gider. |
| **Electron** | Aynı pencerede güncellenmeli. Katlama + Türkçe sıralama + komut paleti arama düzeltmesi orada. Eski panel çalışır ama Türkçe arama istemci-içi süzmelerde eksik kalır. |
| **Mobil (APK)** | Aynı pencerede tercih edilir; **zorunlu değil** — sözleşme değişmedi, eski APK çalışmaya devam eder. Yeni APK katlama + picker sıralama düzeltmelerini getirir. `mobile:kk1-yari-mamul` ekranı için yeni APK **gerekir**. |

⚠️ **Sunucuda `git pull` yapıp `migrate deploy` KOŞMAMAK en tehlikeli senaryodur:**
kod `adnansahin` branch'inde duruyor ve `nameFold` kolonunu arıyor. Pull edip
restart edersen liste ekranları P2022 ile 500 verir. Pull ile migrate **birlikte**.

---

## 10) ROLLBACK

1. `pm2 stop tekserp-api`
2. Önceki commit'e dön (`git checkout <önceki>`), `npm ci && npm run build`
3. **DB'yi geri almak için:** `premigrate_` yedeğinden restore (runbook §5).
   Migration'lar geri-alınamaz kabul edilir.
4. Yalnız aramayı geri almak istersen (nadiren gerekir) DB'ye dokunmadan
   önceki backend sürümüne dönmek yeterlidir: gölge kolonlar türetilmiştir,
   varlıkları eski kodu bozmaz.

---

## 11) BU SÜRÜMÜN İKİ TEKNİK TUZAĞI (ileride dokunacak olan için)

1. **Sıra load-bearing:** collation değişimi generated kolondan **ÖNCE** gelmek
   zorunda. Tersi PostgreSQL tarafından reddedilir:
   `ERROR: cannot alter type of a column used by a generated column`.
   Katlanmış bir kolonun tipini/collation'ını değiştirecek olan, önce gölge
   kolonu DROP etmeli.
2. **`tr_fold` içindeki `COLLATE "C"` pini süs değil.** Ad kolonları Türkçe
   collation'a geçti; tr collation altında `lower('I')` = `'ı'` olur ve katlama
   i-ailesini AYIRIRDI (arama sessizce bozulurdu). Aynı pin, geliştirme (ICU
   en-US) ile sahadaki C locale kurulumunun **aynı** cevabı vermesini sağlıyor.

---

## 12) BİTİNCE — bu bölümü sunucudaki oturum doldursun

```
Deploy tarihi/saati      :
pg_trgm durumu           : (kuruluydu / contrib kopyalandı / …)
ICU (tr_sort provider)   : i (ICU) / c (libc) / kurulamadı
migrate deploy süresi    :
GENERATED kolon sayısı   :  (31 bekleniyor)
Backfill'ler             : timestamps ☐  provenance ☐  label_customer ☐  fold_and_reason ☐  entry_station ☐
mobile:kk1-yari-mamul    : atandığı kullanıcılar:
find_fold_duplicates     : ... grup / ... fazla satır  → fabrikaya iletildi mi ☐
Electron sürümü          :
APK sürümü               :
Sorun / sapma            :
```
