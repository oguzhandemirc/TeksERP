# Saha Deploy Notu — 2.7.0 (2026-08-15)

Fabrika sunucusuna **backend + Electron paneli + APK** kurulumu. Sıra pazarlık dışı;
gerekçeler her adımın altında.

> **Bu belgenin kapsamı 2.7.0'a özeldir.** Genel sıra `../../MIGRATION-DEPLOY.md`'de;
> çelişirlerse **bu dosya** geçerlidir (o dosya bu deploy'un ölçümleriyle güncellendi).

---

## 0 · Sahanın çıkış noktası (ölçüldü, 2026-08-15)

| | değer |
|---|---|
| Fabrika DB'si | **154** migration · sonuncusu `20260806040111_permission_template_code` (6 Ağu) |
| Repo | **162** migration → sahaya **8 migration** gidecek |
| Alınmamış kod | `ef49bbc3..` sonrası **41 commit** (6-13 Ağu) + bu sürümün commit'leri |
| Veri ölçeği | 806 top · 485 hareket · 190 sipariş · 112 iş emri · 4449 audit |
| Sunucu | Windows · PostgreSQL **16.9** · backend **pm2** |

**8 migration** (hepsi additive — `DROP`/`DELETE`/`TRUNCATE` YOK):
`roll_variance_ledger` · `roll_pre_tambur_close` · `roll_variance_reversal` ·
`roll_label_customer` · `roll_production_timestamps` ·
`property_value_type_and_station_mode` · `station_capability_flags` · `roll_property_value`

---

## 1 · En kritik beş madde

1. **`pm2` süreç adı `tekserp-backend`.** Başka belgelerde geçen `tekserp-api` ve
   `teks-erp-backend` **YANLIŞ** — o adlarla komut *"process not found"* der, sen
   "restart ettim" sanırsın ve **migration uygulanmış hâlde ESKİ kod koşar.**
2. **`npm run build` yapmadan `pm2 restart` hiçbir şeyi değiştirmez** — pm2 `dist/`'i
   koşuyor. (2026-08-15'te geliştirme makinesinde birebir yaşandı: `dist/` 10 günlük
   olduğu için `/health` eski sürümü döndürüyordu.)
3. **Adım 8'i (veri göçü) atlarsan vardiya durur.** Ayrıntı aşağıda.
4. **`Teks-Erp/.env` git'te TAKİPLİ.** Commit'e girmez; sahada `pull` öncesi kopyala,
   sonra geri yaz. Bu commit'te `git rm --cached` de **yapılmaz** (silme, sahada pull
   ile fabrikanın `JWT_SECRET`'ini diskten siler → backend hiç açılmaz).
5. **`npm ci`, `npm install` DEĞİL** ve **`--omit=dev` HİÇBİR KOŞULDA** —
   `prisma.config.ts` `ts-node`'a, iki zorunlu göç script'i `tsx`'e (devDependency) bağlı.

---

## 2 · Ön koşullar (gündüz, pencere açılmadan)

- [ ] `git log -1` → `7dafae4a` ya da üstü (kod push'landı).
- [ ] Yerel kapılar yeşil: `npm run check:migrations` · `npm run typecheck` ·
      `npm run typecheck:scripts` · `npm test` · Electron `npm run typecheck` ·
      mobil `npx tsc --noEmit`.
- [ ] Artefaktlar önceden derlendi (pencereyi 20-30 dk kısaltır):
      `Adnan Şahin ERP-2.7.0-Setup.exe` + APK (vc37).
- [ ] **Geri dönüş artefaktı:** fabrikadaki MEVCUT Electron sürümü tespit edildi ve
      o sürümün Setup.exe'si fabrika diskinde. (Sahadaki sürüm git'ten cevaplanamıyor.)
- [ ] Tabletlerin mevcut `versionCode`'u **37'den küçük** (yoksa kaldır-kur gerekir →
      AsyncStorage + SecureStore silinir → bekleyen kayıt ve cihaz eşleştirmesi kaybolur).
- [ ] Tablet senkron rozetleri **yeşil** (kuyruk boş).

### Preflight (salt-okuma, fabrika DB'sinde)

`-c` yerine `.sql` dosyası + `-f` kullan (Windows'ta ters bölü kaçışı bozulur).

```sql
-- (a) station_capability_flags UPDATE'i hangi istasyonlara dokunacak
SELECT s.code, s.name, c.name AS kategori, c."appliesColor", c."appliesProperty"
FROM stations s LEFT JOIN subcontractor_categories c ON c.id = s."defaultCategoryId"
ORDER BY s.type, s.code;
-- (b) trigger yaratma yetkisi
SELECT tableowner FROM pg_tables WHERE tablename='rolls';
-- (c) açık transaction
SELECT pid, state, now()-xact_start AS suresi, left(query,120)
FROM pg_stat_activity WHERE datname='tekserp' AND xact_start IS NOT NULL ORDER BY xact_start;
```

**DUR koşulları:** (a)'da `BOYA_FASON` ve `ZIMPARA_FASON` dışında kategorisi dolu bir
satır çıkarsa — özellikle kategori **Kartela** ise — o istasyonun `appliesProperty`
değeri migration'la `true`→`false`'a çekilir ve **özellik uygulamayı sessizce bırakır**.
(c)'de `idle in transaction` varsa migration'a başlama.

---

## 3 · Pencere (vardiya DIŞI, ~40-60 dk)

Vardiya dışı olmasının sebebi migration süresi **değil** — 8 migration'ın ölçülen
toplamı **156 ms** (fabrika verisinin birebir kopyasında, aynı 50s timeout rejimi
altında). Sebep: tablet tablet APK kurulumu, göç-restart penceresi ve Prisma 7.9.1'in
üretimdeki ilk koşusu.

### 1. Yedek — GEÇİT

`premigrate_` öneki rotasyon **DIŞIDIR** (temizlik yalnız `tekserp_` siler).
Paneldeki "Şimdi yedek al" **kullanılmaz** — o `tekserp_` yazar ve rotasyona girer.

```powershell
$bin="C:\Etkili-Yazilim\pgsql\bin"; $dir="C:\Etkili-Yazilim\backups"
$ts=Get-Date -Format "yyyyMMdd_HHmmss"; $out="$dir\premigrate_2.7.0_$ts.dump"
$env:PGPASSWORD="<postgres sifresi>"
$LASTEXITCODE=1
& "$bin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -d tekserp -Fc -f "$out"
$ok=($LASTEXITCODE -eq 0) -and (Test-Path "$out")
if ($ok) { & "$bin\pg_restore.exe" --list "$out" > $null; $ok=($LASTEXITCODE -eq 0) }
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if (-not $ok) { Write-Host "YEDEK YOK - DEPLOY ETME" -ForegroundColor Red }
```

`$LASTEXITCODE=1` sıfırlaması ve `if ($ok)` guard'ı load-bearing: `pg_dump` PATH'te
yoksa PowerShell throw eder ve `$LASTEXITCODE` önceki komuttan kalan 0'ı korur.
**`pg_dump` exit 0, dosyanın sağlam olduğunu KANITLAMAZ** → `pg_restore --list` şart.

`.env`'i de yedeğin yanına kopyala. Yedeğin bir kopyası başka diskte/ağda olsun.

### 2. Backend'i durdur

```powershell
pm2 stop tekserp-backend
pm2 status                     # durum: stopped
```

Üç migration `rolls` üzerinde ACCESS EXCLUSIVE ister. Backend ayaktayken ALTER kuyruğa
girer, arkasındaki her `rolls` sorgusu bloklanır ve 50 sn'de `statement_timeout`
migration'ı iptal eder (P3009). ⚠️ **`SET statement_timeout = 0` KOYMA** — o sınır,
donma süresinin tek üst sınırıdır; kaldırmak uygulamayı dakikalarca dondurabilir.

### 3. Kodu çek — `.env` korunarak

```powershell
cd <repo>
Copy-Item Teks-Erp\.env Teks-Erp\.env.saha -Force
git pull
Copy-Item Teks-Erp\.env.saha Teks-Erp\.env -Force
git log -1 --format="%h %s"
```

Pull *"local changes would be overwritten"* derse **EZME**: `.env`'i kaydet,
`git checkout -- Teks-Erp/.env`, tekrar pull, sonra geri yaz. Pull sessizce geçse de
`.env` içeriğini **kontrol et** — `JWT_SECRET` değiştiyse tüm tabletler ve paneller düşer.

### 4. Bağımlılık + derleme (migrate'ten ÖNCE)

```powershell
cd Teks-Erp
npm ci
npm run prisma:generate
npm run build
node -e "console.log(require('@prisma/client/package.json').version)"   # 7.9.1
```

`build` migrate'ten önce: tsc patlarsa **DB'ye hiç dokunulmadan** temiz abort olur.
`npm ci` `node_modules`'ü sildiği için `prisma:generate` zorunlu.

### 5. ⛔ GERİ ALINAMAZ — migration

```powershell
npx prisma migrate status      # once: 8 pending gormelisin
npm run prisma:migrate         # = prisma migrate deploy
```

Her dosya kendi transaction'ında koşar → yarım dosya imkânsız; tutarsızlık ancak
dosyalar **arasında** olur, o yüzden 8'i birden geçmeden devam etme.

⚠️ **`prisma migrate resolve --applied` KULLANMA.** SQL'in koştuğunu doğrulamaz, yalnız
deftere yazar; bu 8 dosyada kullanılırsa kolon/trigger **bir daha asla** yaratılmaz,
deploy "başarılı" der ve o kolonu okuyan her yol P2022/500 verir. Hata alırsan:
`_prisma_migrations`'taki `logs` alanını oku, nesnenin gerçekten var olup olmadığını
`\d+ rolls` / `pg_trigger` ile **kendi gözünle** doğrula, yoksa `--rolled-back` ile işaretle.

### 6. Migration doğrulaması

```powershell
npx prisma migrate status                    # "Database schema is up to date!"
npx tsx scripts/test_db_invariants.ts        # 68/0
npx tsx scripts/test_schema_drift.ts         # 4/0, TAM 2 bilinen drift
```

`_prisma_migrations` sayaçları **162 / 0 / 0** olmalı.
`test_db_invariants` yeni trigger `rolls_stamp_production_timestamps` ile iki partial
index'i doğrular — **trigger kaybını yakalayan tek bekçi**. `test_schema_drift`'te
2 bilinen kasıtlı drift dışında üçüncü bir ifade çıkarsa migration eksik/fazla uygulanmış.

### 7. ⛔ ZORUNLU VERİ GÖÇÜ — atlanırsa vardiya durur

Backend hâlâ **durur** hâlde.

```powershell
npx tsx scripts/seed_fold_catalog_and_modes.ts            # DRY-RUN — ciktiyi GERCEKTEN oku
npx tsx scripts/seed_fold_catalog_and_modes.ts --apply
```

**Neden zorunlu:** migration `station_properties.mode` kolonunu ekliyor ve mevcut satırlar
şema varsayılanı `OPTIONAL` ile doğuyor. Yeni kodda `copyStationCapabilitiesToRoll`
**yalnız `AUTO` satırları** yazıyor. Ölçüldü: sahada `KURSUN_KK2/KURSUN` = `OPTIONAL`.
Atlanırsa (1) KURŞUN özelliği toplara **sessizce yazılmayı bırakır**, (2) kurşun bypass
ataması *"istasyon kurşunu OTOMATİK uygulamıyor"* ile **400** verir, (3) Tambur'da kat
tuşu çıkmaz. Hata mesajı sebebi söylemez, log da düşmez.

**Doğrulama:**
```sql
SELECT s.code, fp.code, sp.mode FROM station_properties sp
JOIN stations s ON s.id=sp."stationId" JOIN fabric_properties fp ON fp.id=sp."propertyId"
WHERE fp.code IN ('KURSUN','KAT');
```
→ `KURSUN_KK2/KURSUN = AUTO`. Fason satırları (`BOYA_FASON` ×7, `ZIMPARA_FASON`)
**OPTIONAL KALMALI** — hepsi AUTO olduysa DUR (iç boyahane akışı yazıldığı gün 7 özellik
her topa sessizce yazılır).

> Kat kataloğu **2-KAT / 4-KAT** üretir. TÜP bilinçli olarak çıkarıldı (`93879cb9`);
> katalog dışı değer yine reddedilmez, yalnız tablette seçenek çıkmaz.

### 8. Rapor geçmişi backfill'i (ertelenebilir)

```powershell
npx tsx scripts/backfill_roll_production_timestamps.ts            # DRY-RUN
npx tsx scripts/backfill_roll_production_timestamps.ts --apply
```

Atlanırsa karneler geçmişsiz başlar (ekranda uyarı bandı çıkar — **yanlış rakam
görünmez**). Kaynak `system_logs`; `archive-scheduler` 6 ayda bir taşıdığı için
~2027-01'den sonra kurtarılamaz. Pencere sıkışırsa ertesi güne bırakılabilir —
**adım 7 bırakılamaz.**

### 9. Backend'i başlat

```powershell
pm2 start tekserp-backend
pm2 save
pm2 logs tekserp-backend --lines 120
```

Log'da beklenenler: `[permission-catalog] … güncel`, `[role-templates] … güncel`,
`TeksERP Backend ayakta`. **`[backup] scheduler aktif` GÖRÜLMEMELİ** — sahada gece
yedeğini Görev Zamanlayıcı alıyor, ikisi birden açıksa her gece **çift dump** olur.

### 10. Sağlık

```powershell
curl http://localhost:4000/health
```

→ `status:UP` · `db:UP` · **`version: 2.7.0`**.
**`2.0.0` dönüyorsa yeni kod koşmuyor** — ya `npm run build` atlandı ya restart yanlış
süreç adıyla denendi. Bu alan "yeni kod koşuyor mu" sorusunun tek makine-okunur cevabıdır.

Zengin pano artık `/health`'te değil: **`GET /api/admin/health`** (token + `admin:settings`).

### 11. Duman testi — yalnız salt-okunur

```powershell
npx tsx scripts/test_consistency.ts
```

⚠️ Fabrika DB'sinde `npm test`'in tamamını **koşma** — fixture yazan bekçiler canlı
veriye yazar.

### 12. Electron paneli

Önceden derlenmiş `Adnan Şahin ERP-2.7.0-Setup.exe` çalıştırılır. NSIS `perMachine`,
`oneClick:false` → yerinde yükseltme; yerel donanım ayarları (yazıcı/kantar/tabanca/
sunucu adresi) korunur.

> İmzasız paket **Smart App Control**'e takılabilir (Windows 11'de sonradan kendiliğinden
> etkinleşir). Takılırsa: kurulumsuz çalıştırma yolu `win-unpacked\Adnan Şahin ERP.exe`
> — 2026-08-15'te SAC açıkken bu yol çalıştı. SAC'ı kapatmak **tek yönlüdür** (geri açmak
> Windows sıfırlaması ister).

### 13. APK — tüm tabletler

```powershell
adb devices
adb install -r <apk>
adb shell dumpsys package com.teks.erp.mobil | findstr versionCode    # 37
```

`-r` uygulama verisini **korur** → tablette kayıtlı sunucu adresi ve bekleyen kayıtlar
durur. İmza aynı debug keystore olduğu için üstüne kurulum çalışır.

⚠️ **APK'nın gömülü sunucu adresi** derleme anında sabitlenir. Tablette daha önce elle
girilmiş adres varsa o korunur ve gömülü değer kullanılmaz; gömülü değer yalnız sıfırdan
kurulumda ve "Varsayılana döndür"de devreye girer. Fabrika IP'siyle derlemek için:
`EXPO_PUBLIC_API_URL=http://<fabrika-ip>:4000/api npm run build:apk`

⚠️ **Tüm tabletler bitene kadar pencereden çıkma.** Eski APK + yeni backend üç sessiz
gerileme taşır (KURŞUN özelliği, Tambur geri alma daralması, sapma sebebi).

⚠️ **Tabletler güncellenene kadar panelden hiçbir istasyon-özelliğini "Zorunlu"
(REQUIRED) yapma** — eski APK 400 `REQUIRED_PROPERTY_MISSING` ile kilitlenir ve o
istasyonda KK2 tamamlama tamamen durur.

### 14. Kabul turu (~6 dk, canlı okutma)

1. Tambur → kat tuşları çıkıyor
2. Bir topu 4-KAT ile finalize et → 400 gelmiyor, `foldType=4-KAT`
3. Kurşun/QC2'de KURŞUN "Otomatik" görünüyor ve top kapanınca yazılıyor
4. KK1'den ham top gir → barkod + etiket çıkıyor
5. Envanter → Kat filtresi süzüyor
6. Bir fason çeki + bir sevk irsaliyesi + bir refakat kartı **önizle ve bas** — kâğıt
   taşmıyor, parti no basılıyor

---

## 4 · Deploy sonrası (elle)

- **İzin — Kurşun/KK2 tableti (vardiya ÖNCESİ, zorunlu).** `mobile:kk2-kursun` bugün
  yalnız **Kursun1 (PASİF)** ve **admin**'de. Aktif bir operatör hesabına
  *Mobil — KK2/Kurşun Operatörü* şablonunu uygula.
- **İzin — Tambur.** Tekil canlandırma / aşımda kesim geri alma `mobile:tambur-duzelt`
  istiyor; bugün yalnız **Osman** + admin taşıyor.
- ⚠️ **Atama sonrası çıkış-giriş ZORUNLU.** İzin değişikliği `tokenVersion++` yazar →
  mevcut oturum 401 ile düşer. **Vardiya ortasında atama yapma.**
- **Bayrakları bu deploy'da AÇMA.** `kk1.onlineOnlyEnabled` · `kk1.labelScanVerifyEnabled` ·
  `kk1.historyAllEntriesEnabled` · `kk1.duplicateGuardEnabled` — hepsi varsayılan kapalı.
  Önce APK'yı oturt.
- **Duyuru — boyahaneye:** fason çekisinin görünümü değişti; geçerli talimat üstteki
  kutudur (`BOYANACAK RENK` / `YAPILACAK İŞLEMLER`). *"TALİMAT : GİRİLMEMİŞ — SEVK EDENE
  SORUNUZ"* yazıyorsa **arasınlar**, kendi bildiklerini uygulamasınlar.
- **Duyuru — sevk edene:** ölçüldü, 94 sevkin **11'i** o bandı basacak. Çözüm sevkten
  önce iş emrinin hedef renk/özelliğini ya da adım notunu doldurmak.
- **Duyuru — tanım girenlere:** kod tekilliği artık harf-duyarsız (`SANTUK` varken
  `santuk` açılamaz). Mevcut 8 çakışma grubu **silinmedi**, düzenlenebilir kalıyor.
- **Duyuru — planlamacıya:** kapanmış iş emrindeki top iptal edilirse bir adım
  "Tamamlandı"dan "Bekliyor"a düşebilir ve **hedef renk kilidi açılır**; iş emri
  kendiliğinden kapanmaz, elle kapatılır.

---

## 5 · Geri dönüş (saat cinsinden karar; sıra pazarlık dışı)

**ÖNCE KOD, SONRA VERİ.**

```powershell
Copy-Item Teks-Erp\.env Teks-Erp\.env.saha -Force
pm2 stop tekserp-backend
git checkout ef49bbc3          # prisma/migrations 154 klasor icerir
npm ci; npx prisma generate; npm run build
# guvenlik yedegi al + pg_restore --list ile dogrula
& "$bin\pg_restore.exe" --clean --if-exists -U postgres -d tekserp "<premigrate_2.7.0_*.dump>"
npx prisma migrate deploy      # NO-OP OLMALI
Copy-Item Teks-Erp\.env.saha Teks-Erp\.env -Force
pm2 start tekserp-backend; pm2 save
```

Adım 6 *"8 migration uygulanıyor"* derse **adım 3 atlanmış demektir, DURDUR.**
Doğrulama: `SELECT count(*) FROM _prisma_migrations;` → **154**.

⚠️ **Panel → Sistem → Yedekler'deki db-copy/takas akışını KULLANMA** — geri yükleme
sonrası koşulsuz `prisma migrate deploy` çalıştırır ve 8 migration'ı anında yeniden
uygular; istenenin tam tersi.
