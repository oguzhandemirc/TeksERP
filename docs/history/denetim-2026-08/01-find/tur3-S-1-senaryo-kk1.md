# TUR 3 · S-1 — SENARYO: vardiya başı KK1 yığılması · yazıcı takılması · offline flush

**Denetçi:** S-1 (senaryo merceği) · **Tarih:** 2026-08-29 · **Dal:** `adnansahin` · **Kapsam:** `POST /api/rolls/initial-entry` uçtan uca (mobil tetik → cihaz/oturum damgası → `createInitialEntry` → barkod sayacı → etiket kuyruğu → offline kuyruk flush'ı), + eşzamanlı ana veri birleştirmesi.
**Yöntem:** Bölüm 4.1'in 8 sorusu her adıma uygulandı; iki-aktörlü çizelgeler kuruldu; iki repro scripti yazıldı ve koşturuldu.

> ⚠️ **ORTAM KISITI (bu koşumda K2/K3 ALINAMADI).** Oturum boyunca yerel PostgreSQL'e erişilemedi:
> `FATAL: Postgres.app failed to verify "trust" authentication ... failed to show a dialog`
> — hem `audit/tools/sql-dev.sh` hem `sql-saha.sh` hem de repro scriptleri aynı hatayla düştü
> (`audit/repro/S-1-03.log`, `audit/repro/S-1-04.log`; Prisma `P2039` / PG `XX000`). Sunucuyu yeniden
> başlatmak salt-okunur mandanın dışında olduğu için yapılmadı. **Sonuç: bu dosyadaki hiçbir bulgu
> K2/K3 taşımıyor; kanıt merdiveninin kuralı gereği hiçbiri S0 değildir** (en yüksek S1). Her bulguda
> "K2/K3 nasıl alınır" açıkça yazılı; repro scriptleri repoda hazır ve tip kontrolünden geçiyor
> (`npx tsc -p tsconfig.scripts.json` → bu iki dosyada 0 hata).

---

## 0. SENARYONUN ÖN KOŞULLARI — sahadaki gerçek bayrak durumu

Senaryo analizinin tamamı bu tabloya dayanır (kaynak: `audit/01-find/tur2-V-4-veri-anaveri-audit.md` §0 "PROD AYARLARI TABLOSU" + `Teks-Erp/src/services/system-setting.service.ts` okuyucularının varsayılanları).

| Bayrak | Sahadaki değer | Kaynak | Senaryoya etkisi |
|---|---|---|---|
| `kk1.duplicateGuardEnabled` | **true** | DB satırı (08-05) — V-4 §0.1 | 8021 tuzağı CANLI; 409 `POSSIBLE_DUPLICATE` yolu sahada koşuyor |
| `kk1.onlineOnlyEnabled` | **false** | DB'de satır YOK → `asBoolean(undefined)`=false (`system-setting.service.ts:2195-2204`) · V-4 §0'ın "34 satır / 62 anahtar" ölçümü, §0.1/§0.3 listelerinde YOK · **[VARSAYIM — bu oturumda SQL ile teyit edilemedi]** | **KK1 çevrimdışı kuyruğu AÇIK**: kayıt kuyruğa girer, sonra flush edilir → S1c yolu canlı |
| `kk1.labelScanVerifyEnabled` | **false** | aynı (kod `:2215-2224`, default false) · **[VARSAYIM]** | Etiket geri-okutma zorunluluğu YOK → basılmamış etiket yeni girişi ENGELLEMEZ |
| `workSession.idleTimeoutMinutes` | **0** | DB (V-4 §0.2) | Oturum boşta kapanmaz → 2 saatlik kesintiden sonra damga hâlâ geçerli (iyi haber) |
| `device.pairingRequired` | **false** | DB (V-4 §0.2) | Eşleşmemiş tablet de yazabilir (kapsam dışı, T1-113) |
| `batch.shortNumberEnabled` | **true** | satır yok → varsayılan AÇIK | Parti no `P01…P99`, 8022 kilidiyle korunuyor |

**Doğrulama sorgusu (K2 için, DB dönünce koşulmalı):**
```sql
SELECT key, value FROM system_settings WHERE key LIKE 'kk1.%' ORDER BY key;
```

> **Bu turun tek en önemli gözlemi.** `mobil/src/offline/announceFailure.ts:15-22`, 2026-08-12'de "ölü mektup kutusu"nun
> kaldırılmasını **üç mekanizmaya** dayandırıyor: ① `kk1.onlineOnlyEnabled` rejimi ("çevrimdışıyken kayıt hiç
> denenmez"), ② sunucudaki 90 sn'lik atomik tuzak, ③ kalıcı yazıcı kuyruğu. **Sahada ① KAPALI.** Yani kalıcı
> düşüşün tek kalıcı yüzeyi, henüz devreye alınmamış bir bayrağın varlığı varsayılarak kaldırılmış durumda.
> Aşağıdaki S-1-01 · S-1-02 · S-1-05 bulgularının hepsi bu tek boşluktan besleniyor.

---

## 1. SENARYO S1a — Vardiya başında 5-10 tabletten eşzamanlı KK1 ham girişi

### 1.1 Adım adım akış (dosya:satır)

| # | Adım | Yer | Yield noktası (await) | Not |
|---|---|---|---|---|
| 1 | `POST /api/rolls/initial-entry` · `VT → ANY(roll:write, mobile:kk1)` | `routes/inventory.routes.ts` (K1a) | — | Zod düz `z.object` (bilinerek strict değil) `controllers/inventory.controller.ts:20-55` |
| 2 | `semiFinished` ise ikinci yetki kapısı | `inventory.controller.ts:274-292` | — | `mobile:kk1-yari-mamul ∨ roll:write` |
| 3 | `getStampContext(req, {enforceForMobile:true})` | `inventory.controller.ts:294` → `helpers/work-session.helper.ts:86-141` | ✅ 1-3 havuz sorgusu | Oturum yoksa 409 `WORK_SESSION_REQUIRED` |
| 4 | Ağırlık bayrağı | `inventory.service.ts:686` | ✅ | `readKk1WeightEntryEnabled()` — **önbelleksiz** DB okuması |
| 5 | **Ürün var+aktif** | `inventory.service.ts:694-700` | ✅ | ⚠️ `mergedIntoId` KONTROL EDİLMİYOR → S-1-03 |
| 6 | Renk var+aktif + allowedColors | `:703-724` | ✅ ×3 | tx DIŞINDA |
| 7 | Özellikler + allowedProperties + `assertTargetablePropertyIds` | `:727-755` | ✅ ×3 | tx DIŞINDA |
| 8 | Kalite kodu çözümü | `:770-774` | ✅ | tx DIŞINDA |
| 9 | Tuzak bayrağı (`guardActive`) | `:806-809` | ✅ | **bilinçli olarak tx DIŞINDA** (yorum :802-805: tx içinden okumak havuzu kilitler) — doğru karar |
| 10 | Damga çözümü `resolveEntryStamp` | `:813-814` + `helpers/duplicate-guard.helper.ts:113-127` | — | saf fonksiyon |
| 11 | **`$transaction` AÇ** | `:818` | — | global bütçe `maxWait 5s / timeout 20s` |
| 12 | `pg_advisory_xact_lock(8021, hashtext(key))` — **tx'in İLK ifadesi** | `:844` | ✅ (kilit beklemesi) | Anahtar `helpers/duplicate-guard.helper.ts:59-80`: entrySource·item·renk·metraj(3 hane)·en(3 hane)·kullanıcı·makine |
| 13 | İkiz sorgusu `tx.roll.findFirst` | `:848-880` | ✅ | index çıpası `@@index([entrySource, createdAt])` (`schema.prisma:1753`) MEVCUT ✓ |
| 14 | 409 `POSSIBLE_DUPLICATE` (varsa) | `:885-900` | — | tx rollback, sayaç hiç artmadı ✓ |
| 15 | `generateRollBarcode(tx, type)` | `:905` → `helpers/roll-barcode.helper.ts:74-96` | ✅ | `roll_barcode_counters(day,type)` satır kilidi **COMMIT'e kadar tutulur** |
| 16 | `tx.roll.create` (+`include` item/color/createdBy) | `:906-947` | ✅ | sayaç kilidi altında |
| 17 | `tx.rollProperty.createMany` | `:949-951` | ✅ | sayaç kilidi altında |
| 18 | COMMIT | `:954` | — | |
| 19 | P2002 → replay dalı | `:955-1006` | ✅ ×1 | kimlik-kilit: item+renk+metraj (**en/kg/kalite/özellik DIŞARIDA**) |
| 20 | `AuditService.log` — tx SONRASI | `:1009-1030` | ✅ | best-effort (proje ilkesi) |

### 1.2 Sekiz soru — `createInitialEntry`

| # | Soru | Cevap |
|---|---|---|
| 1 | Hangi değişmez? | ① "Bir fiziksel top = bir `Roll` satırı" (mükerrer yok / eksik yok) · ② barkod tekilliği · ③ `Roll.itemId/colorId` CANLI ana veriyi gösterir |
| 2 | Tek `$transaction` içinde mi? | Hayır — **doğrulama tx DIŞINDA (adım 4-10), yazım tx İÇİNDE (11-18)**. Sınır `:818`↔`:954`. Audit ve replay dalı tx dışı. |
| 3 | Check-then-act var mı? | **EVET, iki yerde.** (a) ürün/renk/özellik/kalite aktiflik kontrolü (adım 5-8) → yazım (adım 16). (b) Tuzak sorgusu → create; burası advisory kilitle KAPATILMIŞ. (a) kapatılmamış. |
| 4 | Kilit / claim? | Tuzak yolunda **8021 advisory, SIRA DOĞRU** (kilit `findFirst`ten ve sayaçtan ÖNCE — `:844` < `:848` < `:905`). Ana veri okumaları için kilit **YOK**. `create` olduğu için claim uygulanamaz. |
| 5 | Küme/aralık kararı (write skew)? | **EVET ve açık:** birleştirme `UPDATE rolls … WHERE itemId = ANY(sources)` bir KÜME üzerinde çalışır; eşzamanlı `INSERT` o kümeye **phantom** ekler. READ COMMITTED'da satır kilidi bunu kapatmaz, izolasyon yükseltilmemiş, ortak advisory de yok (KK1 8021 ↔ merge 8027 ayrı uzaylar). → S-1-03 |
| 6 | DB kısıtı son savunma mı? | `rolls.clientToken` partial unique ✓ · `barcode` unique ✓ · `roll_barcode_counters` PK + `ON CONFLICT` ✓ · CHECK `qty ≥ 0` ✓. **`itemId`nin mezar taşı olmadığını söyleyen bir kısıt YOK.** |
| 7 | İki aktörle bozuluyor mu? | Aynı uçtan iki tablet: **HAYIR** (kilit anahtarı kullanıcı+makine taşıdığı için zaten ayrışıyorlar; barkod sayacı atomik). Merge ile: **EVET** (S-1-03). Ondalık gürültüsünde: **EVET** (S-1-04). |
| 8 | Fabrikadaki etki | S-1-03: top canlı ama survivor kumaşın hiçbir listesinde/filtresinde görünmez → sipariş karşılamaya girmez. S-1-04: tuzak tam da serileştirdiği çiftte boşa düşer → mükerrer stok. |

### 1.3 Yığılma (eşzamanlılık) ölçüsü — sonuç: **KORUNUYOR**

- 8021 anahtarı `userId` + `machineId` taşır → **10 tablet 10 farklı kilit alır**, birbirini beklemez. Doğru tasarım.
- Tek gerçek serileşme noktası `roll_barcode_counters` **(gün, tip)** satırıdır ve kilit `generateRollBarcode`'dan (`:905`) COMMIT'e (`:954`) kadar tutulur. Kuyruk kuyruğu: `roll.create` (3 tablo `include` ile) + `rollProperty.createMany`. **Bugünkü hacimde (saha: 2.431 top / ~40 gün) sorun değil**; `helpers/roll-barcode.helper.ts:52-73`'teki "TX AÇILMADAN ÖNCE çağır" sözleşmesi burada UYGULANMIYOR ama tx kuyruğu kısa. Bu, BULGU-T1-093'ün (S4) aynı sınıfıdır — yeni bulgu AÇMADIM; sınır ötesi notlara ölçüm önerisi bıraktım.
- ⚠️ Adım 4 ve 9'daki iki `system_settings.findUnique` **önbelleksizdir** (`system-setting.service.ts:2174-2183`, `:2195-2204`): her ham giriş 2 fazladan havuz round-trip'i ödüyor. Ölçülemedi (DB yok), bulgu YAZILMADI.

---

## 2. SENARYO S1b — Yazıcı takılı, operatör tuşa 5 kez basıyor (2026-08-03 vakasının bugünkü hâli)

### 2.1 Bugün hangi katman durduruyor — katman katman

| Basış | Ne olur | Durduran katman | Sonuç |
|---|---|---|---|
| 1 | `mutate` → 201, top yazıldı, `enqueuePrint` | — | Toast "Kaydedildi ✓ — etiket basılıyor" (`KK1Screen.tsx:939-950`) |
| 2 (kayıt UÇUŞTAYKEN, aynı yük) | `decideSubmit` → `reuse-inflight` → **aynı token** | `offline/entryAttempt.ts:139-153` + `:83` (90 sn pencere) | Backend `clientToken @unique` → P2002 → replay → **TEK kayıt** ✓ |
| 2 (kayıt BAŞARILI olduktan sonra) | `onSettled` uçuşu kapattı, `failedToken` null → `send-new` → **TAZE token** | — | Sunucuya YENİ bir top gider |
| ↳ manuel modda | `manualQty` `onMutate`'te temizlendi (`:928-929`) → "Manuel metraj girilmeli" | Ekran doğrulaması | Basış boşa gider ✓ |
| ↳ **otomatik modda** | metre yeniden okunur (`measureFromMachine`), yeni token | **YOK** | Sunucuya gider → tek savunma 8021 tuzağı |
| ↳ tuzak: aynı ürün+metraj+en+operatör+makine **ve** damgalar ≤ 90 sn | 409 `POSSIBLE_DUPLICATE` → `EntryConflictModal` | `inventory.service.ts:844-900` + `KK1Screen.tsx:1002-1017` | Operatör karar verir ✓ **(doğru çalışan hat)** |
| ↳ **basışlar arası > 90 sn** | tuzak HİÇ ateşlenmez | **YOK** | Sessiz mükerrer stok → S-1-02 |

### 2.2 Sunucu tarafı ne varsayıyor (istemci token sözleşmesi)

`inventory.service.ts:792-800` yorumu açıkça yazıyor: *"Bu kontrol istemciye GÜVENMEZ"*. Doğru — ama tuzağın **eşitlik demeti** istemciye güveniyor: aynı ürün + **birebir aynı metraj** + aynı en. Otomatik modda ikinci ölçüm birebir aynı çıkmazsa tuzak sessizce elenir; ölçüm `decimals`'a yuvarlandığı için (`mobil/src/services/hal/meter.codec.ts:27-29`, varsayılan 1 hane) pratikte aynı çıkma ihtimali yüksek — **ama 3'ten fazla ondalık taşıyan her yolda sorgu ile kilit ayrışıyor** (S-1-04).

### 2.3 Kritik boşluk: **fiziksel** yazıcı arızası yazılımda SİNYAL ÜRETMEZ

`system-setting.service.ts:2207-2213` bunu kendi cümlesiyle söylüyor: *"'etiket çıktı' sinyali yazılımdan alınamaz (BT yazıcı baskı onayı döndürmez) — tek güvenilir kanıt basılan barkodun GERİ OKUTULMASIDIR."*
Dolayısıyla kâğıt sıkışması / şerit bitmesi / etiket bitmesi durumunda:

- `printQueue` işi **BAŞARILI** sayar → `failedPrints` boş → `KK1Screen.tsx:2115-2135`'teki "ETİKET ÇIKMADI" kırmızı bandı **YANMAZ** (bant yalnız `error` alanı dolu işler için).
- `kk1.labelScanVerifyEnabled` (scan-back) bunu kapatacak tek mekanizmadır ve **sahada KAPALI**.
- Geriye tek savunma 90 sn'lik tuzak kalır — ve kodun kendi saha ölçümü (`system-setting.service.ts:2188-2192`) tekrar-girişin **34-52 dakika** sonra olduğunu söylüyor. **Pencere, ölçülen gecikmenin ~1/25'i.**

→ **S-1-02**

### 2.4 Sekiz soru — etiket yolu

| # | Cevap (özet) |
|---|---|
| 1 | "Bir fiziksel top = bir kayıt" (etiket bir çıktıdır, kaydın kimliği değil) |
| 2 | Baskı tx DIŞINDA ve ASENKRON (istemci kuyruğu) — bilinçli |
| 3 | Evet: "etiket çıktı mı?" sorusu okunur, cevabına göre operatör YENİ KAYIT yazar |
| 4 | Hayır — ve kilitlenecek bir şey de yok; koruma tuzak + banttır |
| 5 | Karar tek satır üzerinde |
| 6 | `Roll.labelPrintedAt` var ama yazımı ateşle-unut (BULGU-T1-062) ve okuyan kapı 2026-08-25'te kaldırıldı |
| 7 | **EVET** — tek aktörle bile bozuluyor (aktörler: operatör ↔ yazıcı) |
| 8 | Ham stokta hayalet top; metraj çift sayılır, KK2/Tambur'a iki kez girer, envanter fazla gösterir |

---

## 3. SENARYO S1c — Tablet 2 saat offline, sonra 300 kaydı flush ediyor

### 3.1 Akış zinciri

| # | Adım | Dosya:satır |
|---|---|---|
| 1 | `onlineOnly=false` → `networkMode:'online'` (defaults) → mutation **paused** | `mobil/src/offline/mutations.ts:143-147`, `KK1Screen.tsx:861` |
| 2 | Kimlik **basış anında** donar (`clientToken` + `clientEnteredAt`), retry TAZELEMEZ | `offline/entryAttempt.ts:124-130`, `KK1Screen.tsx:1378-1413` |
| 3 | Kayıt AsyncStorage'a persist edilir; `pending` olanlar restore'da **paused**'a çevrilir | `offline/persistPolicy.ts:20-24, 92`, `queryClient.ts:81-89` |
| 4 | Ağ dönünce `resumePausedMutations()` — **paralel** (TanStack `Promise.all`) | `App.tsx:135`, `offline/sessionSwitch.ts:57` |
| 5 | Her istek: cihaz oturumu çözülür (**flush anındaki** oturum) | `work-session.helper.ts:86-141` |
| 6 | `createInitialEntry` — pencere `clientEnteredAt` ile ölçülür | `inventory.service.ts:846-880` |
| 7 | Hata: `stationRetry` → **4xx = kalıcı düşüş**, 5xx/ağ = 3 deneme | `offline/mutations.ts:125-131` |
| 8 | Kalıcı düşüş → `MutationCache.onError` → `shouldAnnounceFailure` | `offline/queryClient.ts:51-54`, `announceFailure.ts:50-57` |

### 3.2 Bu senaryoda DOĞRU çalışan üç şey (korunmalı)

1. **`clientEnteredAt` çapası.** Pencere sunucu saatiyle ölçülseydi flush anında 300 kaydın hepsi birbirinin ikizi görünürdü. İki yönlü pencere (`:854-863`) sıra bozulmasına da dayanıklı: paralel flush'ta kaydın hangi sırayla geldiği önemsizdir.
2. **`duplicateGuardCreatedAtFloor` (`helpers/duplicate-guard.helper.ts:147-154`).** 2 saat önce girilmiş bir kaydın ikizini bulmak için `createdAt` tabanını `min(anchor, now) − 90 s − 5 dk − 60 sn`'ye çeker; hem index çıpası korunur hem hiçbir gerçek ikiz elenmez. Doğrulandı: flush'ta doğan ikizlerin `createdAt`i `now`, damgaları `anchor±90 s` → sorgu **bulur**.
3. **5xx'te 3 tekrar → sunucuda 3 kayıt OLMAZ.** `vars` sabittir (persist edilmiş payload), `clientToken` yenilenmez → 2. ve 3. deneme P2002 → replay dalı (`:955-1006`) → **tek kayıt**. Senaryo sorusunun cevabı: **hayır, 3 kayıt olmuyor.**

### 3.3 Bozulan şey: **409 → sessiz kayıt kaybı**

`announceFailure.ts:24-25` iki 409 kodunu duyurudan MUAF tutuyor, gerekçesi: *"ekran modalla SORUYOR"*.
Ama aynı dosyanın bağlı olduğu `queryClient.ts:36-41` şunu yazıyor: *"MutationCache callback'i … **observer'sız (restore edilmiş) mutation'ları da kapsar**"*.
**İkisi aynı anda doğru olamaz:** restore edilmiş mutation'ın observer'ı yoktur → `KK1Screen`'in `onError`'ı (ve dolayısıyla `EntryConflictModal`) **hiç koşmaz**. `setMutationDefaults(KK1_CREATE_ENTRY, …)` yalnız `mutationFn` + `networkMode` + retry taşır (`mutations.ts:209-213`), `onError` YOK.

→ **S-1-01** (kayıt kaybı, sıfır sinyal)

### 3.4 İkincil: batch 4xx amplifikasyonu

Cihazın çalışma oturumu kesinti sırasında BAŞKA bir tablet tarafından devralınırsa (`TAKEOVER`), flush'taki **her** kayıt `409 WORK_SESSION_REQUIRED` alır (`work-session.helper.ts:105-141`) → 4xx → kalıcı düşüş → kayıt başına bir toast. `react-native-toast-message` aynı anda tek toast gösterir; 300 kayıt için operatör pratikte **sonuncuyu** görür ve düşen kayıtların listesi hiçbir yerde tutulmaz (ölü mektup kutusu 2026-08-12'de kaldırıldı). → **S-1-06**

### 3.5 Havuz tükenmesi — ARANDI, BULGU YAZILMADI

`resumePausedMutations` paralel koşar ama React Native'in HTTP katmanı (OkHttp `maxRequestsPerHost`) host başına eşzamanlılığı zaten daraltıyor; backend havuzu 30 (`lib/prisma.ts`). Ölçüm yapılamadığı için (DB yok) **iddia edilmiyor**. K2 için: flush sırasında `/api/admin/health` havuz metrikleri + `endpoint_latency_daily` satırı okunmalı.

### 3.6 Sekiz soru — offline flush

| # | Cevap |
|---|---|
| 1 | "Kuyruğa alınan her kayıt ya yazılır ya da operatöre GÖRÜNÜR biçimde düşer" |
| 2 | Her kayıt kendi tx'i — doğru |
| 3 | Hayır (sunucu tarafında); istemcide "hâlâ uçuşta mı" kararı var ve saf/testli |
| 4 | Sunucuda 8021 ✓; istemcide kuyruk kilidi yok, gerekmiyor |
| 5 | Küme kararı yok |
| 6 | `clientToken` partial unique = flush'ın son savunması ✓ |
| 7 | **EVET** — çakışma 409'unda (S-1-01) ve toplu 4xx'te (S-1-06) |
| 8 | Fiziksel olarak var olan top sistemde yok; ham stok eksik; operatör kaybı fark etmez |

---

## 4. SENARYO S1d — KK1 girişi sırasında süpervizör aynı kumaşı düzenliyor / birleştiriyor

### 4.1 İki-aktörlü çizelge (T = zaman)

```
T1  KK1 (tablet):    prisma.item.findUnique(LOSER)            → isActive=true, mergedIntoId=null  ✓
                     [inventory.service.ts:694-700 — tx DIŞINDA]
T2  Merge (panel):   BEGIN;  pg_advisory_xact_lock(8027,1)     [master-data-merge.service.ts:546]
T3  Merge:           UPDATE rolls SET "itemId"=SURVIVOR
                       WHERE "itemId" = ANY(LOSER…)            [:629-634, merge-map.ts:139]
T4  Merge:           UPDATE items SET mergedIntoId=SURVIVOR,
                       isActive=false WHERE id=ANY(LOSER…)     [:639-647]
T5  Merge:           COMMIT
T6  KK1:             renk/özellik/kalite/ayar okumaları biter  [inventory.service.ts:703-809]
T7  KK1:             BEGIN → 8021 → ikiz sorgusu → barkod      [:818, :844, :905]
T8  KK1:             INSERT rolls (itemId = LOSER) ; COMMIT    [:906-947]

SONUÇ: Canlı bir top MEZAR TAŞI kumaşa bakıyor. Merge'in taşıma turu (T3) o satırı
       GÖREMEZDİ — henüz yoktu (phantom). Hiçbir DB kısıtı, hiçbir uygulama guard'ı
       bu yazımı reddetmiyor. Aynı zincir renk, özellik ve fason firması için de geçerli.
```

**Neden T1→T8 arası "yeterince uzun":** arada 6-9 havuz round-trip'i (renk×3, özellik×3, kalite, 2 ayar) + tx açılışı + 8021 kilit beklemesi + `roll_barcode_counters` satır kilidi beklemesi var; vardiya başı yığılmasında sayaç kuyruğu bu pencereyi tek başına milisaniyelerden onlarca milisaniyeye çıkarır. Merge tx'i ise tanım gereği uzundur (kaynak başına 42 MOVE kuralı × `UPDATE`, bütçe `MERGE_TX_TIMEOUT_MS`).

### 4.2 Deseni repo ZATEN biliyor — ama ana veride uygulamıyor

`subcontractor.service.ts:1164-1168` ve `:1211-1215` **parti** için tam olarak doğru şeyi yapıyor:
> *"mergedIntoId:null (K17 reddi tx-İÇİNDE de): ön-guard (~:694) tx DIŞINDA —"* → tx içinde TAZE ikinci kontrol.

`workorder-manual-move.service.ts:721-730` de aynı. **Kumaş/renk için hiçbir yazma yolunda bu ikizi yok** (`grep -rn "mergedIntoId" Teks-Erp/src` → yalnız Batch, merge servisi, duplicate paneli ve okuma süzgeçleri).

→ **S-1-03**

---

# BULGULAR

### [S-1-01] Offline kuyruktan flush edilen KK1 kaydı 409 `POSSIBLE_DUPLICATE` alırsa HİÇBİR iz bırakmadan düşer — fiziksel top sistemde hiç doğmaz
| Şiddet | S1 | Kategori | B.3 | Öncelik | P0 | Modül | envanter / mobil-offline | Kanıt seviyesi | K1 |

**Özet.** KK1 çevrimdışı kuyruğu sahada AÇIK (`kk1.onlineOnlyEnabled` yok → false). Kuyruktan flush edilen bir ham giriş sunucudan 409 `POSSIBLE_DUPLICATE` alırsa, istemcide bunu operatöre soracak tek yüzey `KK1Screen`'in `onError` içindeki `EntryConflictModal`'dır. Restore edilmiş (observer'sız) mutation'da o callback **hiç koşmaz**; kalıcı düşüşü duyuran global katman ise tam da bu iki 409 kodunu **bilerek muaf tutar** ("ekran modalla soruyor" gerekçesiyle). Sonuç: kayıt kalıcı olarak düşer, hiçbir toast basılmaz, hiçbir yere yazılmaz (ölü mektup kutusu 2026-08-12'de kaldırıldı) — fiziksel top envanterde YOKTUR.

**Kanıt.**
- `mobil/src/offline/announceFailure.ts:24-25` — muafiyet listesi:
  ```ts
  /** Sunucunun SORU sorduğu 409'lar — cevabı ekranın kendi modalıdır. */
  const CONFLICT_CODES = new Set(['POSSIBLE_DUPLICATE', 'CLIENT_TOKEN_COLLISION']);
  ```
  `:50-57` — `shouldAnnounceFailure` bu kodlarda `false` döner.
- `mobil/src/offline/queryClient.ts:36-41` — aynı mekanizmanın kapsam beyanı, muafiyetle ÇELİŞİR:
  > *"MutationCache callback'i ise her zaman ve component'ten ÖNCE koşar; ayrıca **observer'sız (restore edilmiş) mutation'ları da kapsar** ve yalnız KALICI düşüşte tetiklenir"*
- `mobil/src/offline/mutations.ts:209-213` — `setMutationDefaults(STATION_MUT.KK1_CREATE_ENTRY, { mutationFn, ...OFFLINE_AWARE })`: **`onError` YOK** → restore edilen mutation'da modalı açacak kod yoktur.
- `mobil/src/screens/Modules/KK1/KK1Screen.tsx:1002-1017` — modalı açan TEK yer, component `onError`'ı içinde (`setConflict({...}); return; // toast YOK — modal konuşuyor`).
- `mobil/src/offline/mutations.ts:125-131` — `stationRetry`: `if (status >= 400 && status < 500) return false` → 409 **tek denemede kalıcı düşüş**.
- `mobil/src/offline/persistPolicy.ts:20-24, 92` — persist edilen istasyon kayıtları restore'da paused'a çevrilir; `App.tsx:135` ağ gelince `resumePausedMutations()` çağırır (observer YOK).
- Sunucu tarafı 409'u üreten yer: `Teks-Erp/src/services/inventory.service.ts:881-901`.
- **Koruma kontrolü:** aranan mekanizmalar — (a) `setMutationDefaults` içinde `onError` → YOK; (b) `MutationCache.onError` → VAR ama bu kodlarda susturulmuş; (c) kalıcı düşen kayıt defteri → **kaldırıldı** (`announceFailure.ts:4-22`); (d) sunucu tarafı bir "reddedilen giriş" kaydı → YOK; (e) `kk1.onlineOnlyEnabled` rejimi (kuyruğu hiç oluşturmayan çözüm) → **sahada KAPALI**.

**Çakışma senaryosu.**
```
T1  Operatör (offline):  1. topu girer — item=X, 140 m, en 150, clientEnteredAt=10:00:00
T2  Operatör (offline):  2. topu girer — AYNI parti, AYNI metraj/en, clientEnteredAt=10:00:50
                          (tekstilde olağan: aynı partiden eşit metrajlı toplar;
                           inventory.service.ts:798-800 bunu KENDİ yazıyor)
T3  Uygulama kapanır / tablet yeniden başlar → iki kayıt AsyncStorage'dan RESTORE edilir
T4  Ağ döner → resumePausedMutations() → ikisi paralel gider (observer YOK)
T5  1. kayıt COMMIT olur (barkod T290826H0007)
T6  2. kayıt 8021 kilidini bekler, uyanır, ikizi GÖRÜR (damgalar 50 sn arayla)
    → 409 POSSIBLE_DUPLICATE
T7  stationRetry: 4xx → kalıcı düşüş
T8  MutationCache.onError → shouldAnnounceFailure(...) === false → HİÇBİR ŞEY OLMAZ
SONUÇ: iki fiziksel toptan biri sistemde YOK. Ne toast, ne kırmızı bant, ne kuyruk satırı,
       ne sunucu logu. Operatör "ikisini de girmiştim" der, ekranda tek barkod vardır.
```

**failure_mode.** Çevrimdışı vardiyada aynı partiden 140 m'lik iki top 50 sn arayla girilir; tablet yeniden başlatılır; ağ gelince kuyruk boşalır → ikinci top 409 `POSSIBLE_DUPLICATE` alır ve **sessizce silinir**. Ham stok 140 m eksik; fark ancak fiziksel sayımda görülür.

**Veride fiili ihlal (K2).** **Aranamadı — DB erişimi bu oturumda kapalıydı** (bkz. dosya başı). DB dönünce koşulacak sorgu (sahada bu düşüşün izi yok, o yüzden dolaylı kanıt aranır — "flush kümesi" içinde tam ikizler):
```sql
-- Aynı operatör/makine/ürün/metraj/en, damgaları ≤90 sn, createdAt'leri ≤5 sn arayla
-- (= tek flush'ta yazılmış çift). Sağ kalan tek satır varsa ikizi düşmüş OLABİLİR.
SELECT a."id", a."barcode", a."clientEnteredAt", a."createdAt"
FROM rolls a
WHERE a."clientEnteredAt" IS NOT NULL
  AND a."createdAt" - a."clientEnteredAt" > interval '10 minutes'   -- kuyruktan geldi
ORDER BY a."createdAt" DESC LIMIT 100;
```

**Repro (K3).** Yazılmadı — kusur SUNUCUDA değil istemcinin hata yolunda; sözleşmenin `audit_repro_*.ts` iskeleti (dev DB + Prisma) bu yolu koşturamaz. **Doğru bekçi mobil tarafta olurdu:** `announceFailure.test.ts`e "observer'sız mutation + POSSIBLE_DUPLICATE → duyurulmalı" vakası. Bugünkü `mobil/src/offline/announceFailure.test.ts` bu vakayı ölçmüyor (muafiyeti DOĞRU davranış olarak kilitliyor) — yani **bekçi hatayla aynı yerde kör**.

**İş etkisi.** Ham stokta eksik top. Metraj eksik olduğu için iş emri planlaması, sipariş karşılama ve ürün dengesi olduğundan az gösterir; kayıp sessiz olduğu için ancak fiziksel sayımda (ki bu ERP'de sayım modülü YOK — KYY §0 madde 13) ortaya çıkar.

**Öneri (2. tur için).** ① `shouldAnnounceFailure`in muafiyeti **observer varlığına** bağlanmalı: `mutation.observers.length === 0` (ya da mutation'ın component callback'i taşımadığı) durumda çakışma 409'u da DUYURULUR — metin "SUNUCU SORDU: bu top az önce girilmiş olabilir · barkod X · Son Kayıtlar'dan kontrol edin". ② Daha sağlam çözüm: `kk1.onlineOnlyEnabled` **sahada AÇILIR** — ölü mektup kutusunun kaldırılma gerekçesinin 1. maddesi zaten buydu (`announceFailure.ts:18-19`). ⚠️ **Bayrak değişikliği bu denetimde YAPILMADI**; açılmadan önce sahadaki APK'ların çevrimdışı kilidini tanıdığı doğrulanmalı. ③ Karar kuralı saf bir fonksiyonda yaşadığı için (iyi kalıp) bekçisi tek satırdır.

**Kabul kriteri.** `announceFailure.test.ts`e eklenen "observer'sız + POSSIBLE_DUPLICATE" vakası bugünkü kodda KIRMIZI verir; düzeltmeden sonra yeşile döner. Elle: KK1'i çevrimdışı yap → aynı yükle 2 kayıt gir → uygulamayı öldür → ağı aç → ikinci kayıt için görünür bir uyarı çıkmalı.

**Efor.** 0,5 gün (①), + bayrak açma kararı ayrı.

**Önceki defter.** Doğrudan eşleşme YOK. Komşu: BULGU-T1-006 (iptal edilmiş kaydın token replay'i) aynı uçta ama farklı kök neden.

---

### [S-1-02] Fiziksel yazıcı arızası yazılımda hiçbir sinyal üretmez; 90 sn'lik mükerrer penceresi, kodun KENDİ ölçtüğü tekrar-giriş gecikmesinin (34-52 dk) ~1/25'i — ve kapatıcı iki bayrak da sahada KAPALI
| Şiddet | S2 | Kategori | B.5 / A.1 | Öncelik | P1 | Modül | envanter / etiket | Kanıt seviyesi | K1 |

**Özet.** 2026-08-03 saha vakasının ("etiket çıkmadı, operatör tekrar bastı, N kopya doğdu") **ağ kaynaklı** yarısı kapatıldı: uçuş penceresi + yapışkan token + 90 sn'lik sunucu tuzağı + kalıcı yazıcı kuyruğu + "ETİKET ÇIKMADI" bandı. **Fiziksel yazıcı arızası (kâğıt sıkışması, şerit/etiket bitmesi) yarısı kapatılmadı:** BT yazıcı baskı onayı döndürmediği için baskı işi BAŞARILI sayılır, kırmızı bant yanmaz, kuyrukta satır kalmaz. Geriye kalan tek savunma 90 sn'lik tuzaktır; sahada ölçülmüş tekrar-giriş gecikmesi ise 34-52 dakikadır.

**Kanıt.**
- `Teks-Erp/src/services/system-setting.service.ts:2207-2213` — sinyal yokluğunun kendi beyanı:
  > *"'etiket çıktı' sinyali yazılımdan alınamaz (BT yazıcı baskı onayı döndürmez) — tek güvenilir kanıt basılan barkodun GERİ OKUTULMASIDIR."* → `readKk1LabelScanVerifyEnabled` **default false**.
- `Teks-Erp/src/services/system-setting.service.ts:2186-2192` — sahada ÖLÇÜLMÜŞ gecikme:
  > *"kesinti anında kuyruğa alınan kayıtların etiketi sonradan basılamayınca operatör aynı topu YENİDEN giriyordu (07.08 vakası: **4 top 34-52 dk sonra ikizlendi**)"* → `readKk1OnlineOnlyEnabled` **default false**.
- `Teks-Erp/src/services/helpers/duplicate-guard.helper.ts:16` — `DUPLICATE_ENTRY_WINDOW_MS = 90_000` (gerekçe: *"tekrar basma refleksi saniyeler içindedir"* — bu gerekçe **ağ hatası** senaryosu içindir, yazıcı arızası için değil).
- `mobil/src/screens/Modules/KK1/KK1Screen.tsx:2115-2135` — "ETİKET ÇIKMADI" bandı YALNIZ `failedPrints.length > 0` iken çizilir; `failedPrints` = `PrintJob.error` dolu işler (`mobil/src/offline/printQueue.ts:48-49`). Fiziksel arızada `error` dolmaz.
- `mobil/src/screens/Modules/KK1/KK1Screen.tsx:590-593` — baskı düşüşünde kuyruk modalını **yalnız** `onlineOnly` rejiminde açar: `if (res.failed && onlineOnly && !res.wasAuto) setQueueOpen(true);` → sahada (bayrak kapalı) modal HİÇ açılmaz.
- `mobil/src/screens/Modules/KK1/KK1Screen.tsx:939-950` — başarılı kayıt toast'ı *"— etiket basılıyor"* der; baskının gerçekten çıktığını hiçbir katman doğrulamaz.
- Ölü etiket onayı 2026-08-25'te kaldırıldı (kök `CLAUDE.md`) → "bu barkod zaten basıldı" bilgisiyle ikinci girişi durduran kapı da yok.
- **Koruma kontrolü:** (a) 8021 tuzağı → VAR ama penceresi 90 sn; (b) `labelScanVerify` → sahada KAPALI; (c) `onlineOnly` → sahada KAPALI; (d) baskı bandı → fiziksel arızada tetiklenmez; (e) `Roll.labelPrintedAt` tabanlı bir kapı → yok (BULGU-T1-062: yazımı da ateşle-unut).

**Çakışma senaryosu (aktörler: operatör ↔ yazıcı).**
```
T1  09:12  Operatör 320 m'lik topu OTOMATİK modda kaydeder → 201, barkod T290826H0041
T2  09:12  Yazıcıya iş gider; kâğıt sıkışmıştır — BT yazımı BAŞARILI döner
T3  09:12  Ekran: "Kaydedildi ✓ — etiket basılıyor". Kırmızı bant YOK, kuyruk BOŞ.
T4  09:13-09:45  Operatör yazıcıyı açar, kâğıdı düzeltir, şeridi kontrol eder
T5  09:47  Etiket hâlâ yok → "kaydolmamış" der, topu YENİDEN okutur/ölçer ve Kaydet'e basar
T6  09:47  Sunucu: guard penceresi ±90 sn → çapa 09:12 ile 09:47 arasında 35 dk fark
           → İKİZ SORGUSU HİÇ EŞLEŞMEZ → 201, barkod T290826H0058
SONUÇ: Tek fiziksel top için iki stok kaydı; 320 m çift sayıldı. Hata yok, log yok, uyarı yok.
```

**failure_mode.** Yazıcıda kâğıt sıkışır; operatör 35 dakika uğraşıp topu yeniden girer → aynı 320 m'lik top ham stokta iki kez görünür (T…H0041 ve T…H0058). Ham stok +320 m şişer; iki barkodun biri fiziksel olarak hiç var olmadığı için sonraki adımda "top bulunamadı" olarak takılır ve `IN_PRODUCTION` limbosuna düşer.

**Veride fiili ihlal (K2).** **Aranamadı (DB kapalı).** DB dönünce:
```sql
-- Aynı operatör/makine/ürün/metraj/en, 90 sn'DEN uzun ama aynı gün içinde doğmuş çiftler
-- (= tuzağın penceresinin DIŞINDA kalan mükerrer adayları)
SELECT a."barcode", b."barcode", a."initialQty", a."createdById",
       EXTRACT(EPOCH FROM (b."createdAt" - a."createdAt"))/60 AS dk
FROM rolls a JOIN rolls b
  ON b."itemId"=a."itemId" AND b."initialQty"=a."initialQty"
 AND b."width" IS NOT DISTINCT FROM a."width"
 AND b."createdById"=a."createdById"
 AND b."createdMachineId" IS NOT DISTINCT FROM a."createdMachineId"
 AND b."createdAt" > a."createdAt" + interval '90 seconds'
 AND b."createdAt" < a."createdAt" + interval '4 hours'
WHERE a."entrySource" IN ('SUPPLIER_RECEIPT','MANUAL_ENTRY')
  AND a."status" NOT IN ('CANCELLED','SCRAP') AND b."status" NOT IN ('CANCELLED','SCRAP')
ORDER BY dk;
```
(Not: bu sorgu meşru "aynı partiden ikinci top"ları da yakalar — `duplicate-rolls.service` hayalet-top sekmesiyle çapraz okunmalı.)

**Repro (K3).** Uygulanabilir değil (fiziksel yazıcı). Ölçülebilir kısmı S-1-04'ün §3'ündedir.

**İş etkisi.** Ham stok fazla; iş emri planlaması olmayan malı planlar; hayalet top sonraki istasyonda okutulamaz ve `IN_PRODUCTION`'da takılı kalır ("Kurtar" gerektirir). Fire/kalite karneleri de şişer.

**Öneri (2. tur için).** ① **`kk1.labelScanVerifyEnabled` sahada AÇILMALI** — kodun kendi tespitine göre fiziksel baskının tek güvenilir kanıtı budur ve zaten yazılmış, kullanılmıyor. ⚠️ Bayrak bu denetimde DEĞİŞTİRİLMEDİ; açmadan önce (a) sahadaki APK'nın scan-back ekranını taşıdığı, (b) `VERIFY_MAX=20` tavanının vardiya hacmine uyduğu doğrulanmalı. ② Pencereyi büyütmek **çözüm değil** (yanlış pozitif patlar — helper'ın kendi notu `:12-14`); doğru eksen "bu topun etiketi basıldı mı" sorusudur. ③ Kısa vade, sıfır risk: KK1 "Son Kayıtlar" satırına **"etiket basılmadı"** rozeti (`Roll.labelPrintedAt IS NULL`) — operatör tekrar girmeden önce topu listede görür. ④ `printQueue`'ya "basıldı sayıldı ama doğrulanmadı" durumu eklenirse ① ile aynı işi bayraksız görür.

**Kabul kriteri.** Sahada bir vardiya boyunca `labelPrintedAt IS NULL` olan `SUPPLIER_RECEIPT` topu sayısı ölçülür; scan-back açıldıktan sonra 0'a iner. Yukarıdaki K2 sorgusunun "90 sn – 4 saat" penceresindeki çift sayısı düşer.

**Efor.** 0,5 gün (③), 1 gün (①'in saha doğrulaması + APK teyidi).

**Önceki defter.** BULGU-T1-062 (labelPrintedAt ateşle-unut) bu bulgunun ③ önerisinin ÖN KOŞULUDUR — rozet, yazımı güvenilir değilse yalan söyler. İlişkili: BULGU-T1-049.

---

### [S-1-03] KK1 ham girişi ürün/renk/özellik doğrulamasını transaction DIŞINDA yapar; eşzamanlı ana veri birleştirmesinde yeni top MEZAR TAŞI kumaşa yazılır ve birleştirmenin taşıma turu onu kaçırır
| Şiddet | S2 | Kategori | A.1 / A.3 (phantom) | Öncelik | P1 | Modül | envanter / ana-veri | Kanıt seviyesi | K1 |

**Özet.** `createInitialEntry` ürünün var+aktif olduğunu tx **açılmadan önce** okur ve tx içinde bir daha sormaz. Kumaş birleştirmesi (`MasterDataMergeService.merge`) tek tx içinde önce `UPDATE rolls SET itemId=survivor` yapar, sonra kaynağı mezar taşına çevirir. İki akış çakışırsa KK1'in INSERT'i taşıma turundan SONRA düşer (klasik phantom): ortaya, hiçbir listede görünmeyen bir kumaşa bağlı **canlı bir top** çıkar. Ne FK, ne CHECK, ne uygulama guard'ı bunu reddeder. Aynı deseni repo **parti** için doğru uyguluyor (tx-içi taze `mergedIntoId` kontrolü), ana veri için uygulamıyor.

**Kanıt.**
- `Teks-Erp/src/services/inventory.service.ts:694-700` — tx DIŞINDA, yalnız `isActive`:
  ```ts
  const item = await prisma.item.findUnique({ where: { id: data.itemId }, select: { id: true, isActive: true } });
  if (!item || !item.isActive) throw AppError.notFound("Ürün bulunamadı veya pasif (silinmiş)");
  ```
  Yazım `:818` ile açılan tx'in içinde, `:906`'da. Aradaki her okuma bir yield noktası (renk `:703-724`, özellik `:727-755`, kalite `:770-774`, ayarlar `:686`/`:806-809`).
- `Teks-Erp/src/services/master-data-merge.service.ts:629-634` — düz taşıma:
  ```ts
  const moved = await tx.$executeRawUnsafe(
    `UPDATE "${rule.table}" SET "${rule.column}" = $1::uuid WHERE "${rule.column}" = ANY($2::uuid[])`,
    survivor.id, sourceIds);
  ```
  `:639-647` — kaynaklar tombstone + `isActive:false`. `Teks-Erp/src/constants/merge-map.ts:139` — `{ kind:"MOVE", model:"Roll", table:"rolls", column:"itemId" }`.
- **Kilit uzayları AYRI ve kesişmiyor:** KK1 `pg_advisory_xact_lock(8021, hashtext(...))` (`inventory.service.ts:844`), merge `pg_advisory_xact_lock(8027, 1)` (`master-data-merge.service.ts:546`). İkisi birbirini görmez.
- **Koruma kontrolü (altı kaynak taranarak):** (a) tx-içi taze okuma → YOK; (b) satır kilidi (`FOR UPDATE` items) → YOK (`grep FOR UPDATE` → yalnız `order.service.ts:2434`); (c) atomik claim → uygulanamaz (INSERT); (d) izolasyon yükseltmesi → YOK (`isolationLevel` yalnız `shipping.service.ts:2610`); (e) DB kısıtı ("itemId mezar taşı olamaz") → YOK; (f) ortak advisory → YOK. `grep -rn "mergedIntoId" Teks-Erp/src` → yazma yollarında yalnız **Batch** (`subcontractor.service.ts:1164-1215`, `workorder-manual-move.service.ts:721-730`) ve merge servisinin kendisi.
- **Desenin repoda VAR olduğu yer** (aynı hatanın parti için düzeltilmiş hâli), `subcontractor.service.ts:1164-1168`:
  > *"mergedIntoId:null (K17 reddi tx-İÇİNDE de): ön-guard (~:694) tx DIŞINDA —"*

**Çakışma senaryosu.** Bkz. §4.1 çizelgesi. Özet: `T1 KK1: item(LOSER) aktif ✓` · `T3 Merge: UPDATE rolls SET itemId=SURVIVOR` · `T5 Merge COMMIT` · `T8 KK1: INSERT rolls(itemId=LOSER)`. **SONUÇ:** canlı top mezar taşında.

**failure_mode.** Süpervizör "PAMUK SÜPREM" ile "PAMUK SUPREM" kumaşlarını mükerrer panelinden birleştirirken KK1 operatörü eski (kaybeden) kumaşla 250 m'lik bir top girer. Birleştirme "38 top taşındı" der, bu top **39.**'dur ve taşınmamıştır. Top canlıdır, barkodludur, envanter toplamına girer — ama survivor kumaşın ürün filtresinde, "Ürün Dengesi"nde ve sipariş karşılamada **HİÇ GÖRÜNMEZ** (o yüzeyler `mergedIntoId IS NULL` süzgeciyle çalışır). Fabrika o 250 m'yi arar, bulamaz, ikinci kez üretim planlar.

**Veride fiili ihlal (K2).** **Aranamadı (DB kapalı).** DB dönünce — bu, bugün ölçülebilir ve KESİN bir sorgudur:
```sql
-- Canlı top, mezar taşı kumaşa/renge bakıyor mu?
SELECT 'item' AS kaynak, r."id", r."barcode", r."createdAt", i."name"
FROM rolls r JOIN items i ON i."id"=r."itemId"
WHERE i."mergedIntoId" IS NOT NULL AND r."status" NOT IN ('CANCELLED','SCRAP')
UNION ALL
SELECT 'color', r."id", r."barcode", r."createdAt", c."name"
FROM rolls r JOIN colors c ON c."id"=r."colorId"
WHERE c."mergedIntoId" IS NOT NULL AND r."status" NOT IN ('CANCELLED','SCRAP');
-- Aynı soru sipariş kalemi / iş emri hedefi için de sorulmalı:
--   order_lines.itemId, work_orders.targetItemId/targetColorId
```
> Sahada 13 `duplicate_reviews` satırının hepsi `MERGED` (V-4 §"duplicate_reviews") — yani birleştirme yolu CANLI olarak kullanılmış. Bu sorgu 0 dönerse bulgu K1'de kalır ama **kapanmaz** (pencere zamanlamaya bağlıdır ve yazma yolunda kapı hâlâ yoktur).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-1-03.ts` — YAZILDI ve koşturuldu; log `audit/repro/S-1-03.log`.
**Sonuç: TETİKLENEMEDİ — ortam engeli.** Script ilk sorguda `P2039 / XX000 Postgres.app failed to verify "trust" authentication` ile düştü; **hiçbir fixture yaratılmadı, dev DB'de iz kalmadı.** Script iki bölümlü ve DB dönünce olduğu gibi koşar:
- **§1 (deterministik, zamanlamadan bağımsız):** `mergedIntoId` dolu ama `isActive` true bırakılmış bir kumaşa `createInitialEntry` çağrılır. Bugünkü kodda bu **başarılı olur** → yazma yolunda mezar taşı kapısının OLMADIĞINI kanıtlar.
- **§2 (gerçek yarış):** 12 tur × 6 kaynaklı merge ile eşzamanlı KK1 girişi (artan stagger); her turdan sonra commit SONRASI `$queryRaw` ile "canlı top mezar taşında mı" ölçülür. Tetiklenmezse bu da rapora yazılır (negatif sonuç).

**İş etkisi.** Kayıp görünürlük: fiziksel olarak var olan mal, ait olduğu ürünün hiçbir yönetim yüzeyinde görünmez. Sipariş karşılama, ürün dengesi ve rota/hedef eşleşmesi olduğundan az hesaplanır; mal "kayıp" sanılıp yeniden üretilir. Aynı sınıf, renk ve fason firması birleştirmelerinde de geçerlidir.

**Öneri (2. tur için).** ① `createInitialEntry`'nin tx'inde, `roll.create`'ten hemen ÖNCE **taze** kontrol: `tx.item.findUnique({ where:{id}, select:{isActive:true, mergedIntoId:true} })` → pasif ya da tombstone ise 409 (`ITEM_MERGED`, mesajda survivor adı). Aynısı `colorId` için. Bu, `subcontractor.service.ts:1211-1215`'in birebir ikizidir — yeni desen icat edilmiyor. ② Genel çözüm: ana veri okuyan HER yazma yolunun ortak `assertMasterDataWritableTx(tx, …)` helper'ından geçmesi + AST bekçisi (fason "açık sevk" tek-kaynak bekçisinin emsali). ③ **Migration gerekmez, izin gerekmez, APK gerekmez** — düzeltme tamamen sunucuda. ④ Geçmiş kayıtlar için düzeltme scripti **dry-run varsayılan** olmalı ve etkilenen her topu somut listelemeli `[PROD'DA ÇALIŞTIRMA — önce K2 sorgusu]`; geri alma yolu: script eski `itemId`yi audit'e yazar.

**Kabul kriteri.** `audit_repro_S-1-03.ts` §1 YEŞİL'e döner (mezar taşına giriş 409). §2'de 20 turda 0 yetim. K2 sorgusu 0 satır.

**Efor.** 0,5 gün (①), 2 gün (② + bekçi).

**Önceki defter.** Doğrudan eşleşme YOK. Komşu: BULGU-T1-035 (mezar taşı diriltilebiliyor), BULGU-T1-007 (ad-mükerrer guard'ı kilitsiz) — üçü de "birleştirme çevresinde tx sınırı" ailesindendir ama kök nedenleri ayrı.

---

### [S-1-04] Mükerrer tuzağının KİLİT ANAHTARI 3 ondalığa yuvarlanır, İKİZ SORGUSU yuvarlanmaz — tuzak tam da serileştirdiği çiftte boşa düşer
| Şiddet | S3 | Kategori | A.1 | Öncelik | P2 | Modül | envanter | Kanıt seviyesi | K1 |

**Özet.** `duplicateGuardLockKey` metraj ve eni **DB hassasiyetine (`toFixed(3)`) yuvarlar** ve bunu gerekçesiyle yazar ("yuvarlama GÜVENLİ yöndedir"). Ama aynı fonksiyonun koruduğu ikiz sorgusu, metrajı **ham** değerle karşılaştırır (`new Prisma.Decimal(data.initialQty)`) ve kolon `Decimal(12,3)` olduğu için DB'deki değer zaten yuvarlanmıştır. Sonuç: 3'ten fazla ondalık taşıyan iki giriş **aynı advisory kilidini alır (serileşir) ama birbirini bulamaz** — koruma, tam olarak devreye girmesi beklenen anda sessizce eleniyor.

**Kanıt.**
- `Teks-Erp/src/services/helpers/duplicate-guard.helper.ts:51-57` (gerekçe) ve `:68-69` (yuvarlama):
  ```ts
  const dec = (v: number | null) => v == null ? "-" : new Prisma.Decimal(v).toFixed(3);
  ```
- `Teks-Erp/src/services/inventory.service.ts:866` — sorgu tarafı **yuvarlamıyor**:
  ```ts
  initialQty: new Prisma.Decimal(data.initialQty),
  ```
  (`width: data.width ?? null` de aynı sınıfta, `:867`.)
- `Teks-Erp/prisma/schema.prisma:1340-1341` — `initialQty Decimal @db.Decimal(12,3)`, `currentQty` aynı; `:1374` `width Decimal? @db.Decimal(12,3)`.
- Aritmetik: `140.0001` yazılır → kolonda `140.000`. Sorgu `initialQty = 140.0004` → PG `numeric` karşılaştırması **eşleşmez**. Kilit anahtarı ise ikisinde de `…|140.000|…` → **aynı kilit**.
- **Koruma kontrolü:** (a) Zod ondalık sınırı → YOK (`inventory.controller.ts:23` yalnız pozitif + max); (b) servis tarafında normalizasyon → YOK; (c) DB CHECK → yalnız `≥ 0`; (d) bekçi → `test_kk1_duplicate_guard` case 15 **yalnız kilit anahtarını** ölçüyor, sorgu tarafını değil (helper'ın kendi notu `:57` "Bekçi: case 15" der — ölçtüğü şey anahtar).
- **Kaynak:** haritanın K7a #3 endişesi ("4+ ondalık metrajda replay eşitliği/ikiz sorgusu ham `initialQty` ile") — ② denetçisine bırakılmıştı; Tur 1/Tur 2'de bulguya çevrilmemiş (208 kayıtta eşleşme yok).

**Çakışma senaryosu.**
```
T1  A: initialQty=140.0001 → lockKey …|140.000|…  → 8021 ALINDI
T2  B: initialQty=140.0004 → lockKey …|140.000|…  → AYNI kilit, T1'i BEKLER   (serileşti ✓)
T3  A: ikiz yok → INSERT (DB'ye 140.000 yazılır) ; COMMIT ; kilit bırakılır
T4  B: uyanır, ikiz sorgusu koşar:  WHERE "initialQty" = 140.0004
       DB'deki satır 140.000 → EŞLEŞME YOK
T5  B: INSERT (DB'ye yine 140.000) ; COMMIT
SONUÇ: DB'de birebir aynı iki satır (140.000). Tuzak çifti doğru şekilde SERİLEŞTİRDİ
       ama eşitlik yükleminin hassasiyeti kilitle ayrıştığı için hiçbir şey yakalamadı.
```

**failure_mode.** Metre cihazı `decimals: 4` ile tanımlanmış (ya da Electron/script yolundan 4 ondalıklı metraj gönderilmiş) bir istasyonda operatör aynı topu iki kez kaydeder; ikinci kayıt `140.0004` gelir ve 409 `POSSIBLE_DUPLICATE` **çıkmaz** → aynı top iki barkodla stoğa girer. Aynı asimetri `width` için de geçerlidir (en 4 ondalıklı geldiğinde).

**Veride fiili ihlal (K2).** **Aranamadı (DB kapalı).** DB dönünce iki şey ölçülür:
```sql
-- (a) Sahada 3'ten fazla ondalıklı metraj GELEBİLİYOR mu? (kolon yuvarladığı için
--     doğrudan görülemez → audit'in newData'sındaki HAM beyan okunur)
SELECT COUNT(*) FROM system_logs
WHERE "tableName"='ROLL' AND action='CREATE'
  AND ("newData"->>'initialQty') ~ '\.[0-9]{4,}';
-- (b) Cihaz protokolünde 3'ten fazla ondalık tanımlı mı?
SELECT id, name, kind, decimals, scale FROM peripheral_devices WHERE decimals > 3;
```
(b) 0 dönerse olasılık düşüktür ve S3 doğrudur; >0 ise şiddet S2'ye çıkar.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-1-04.ts` — YAZILDI ve koşturuldu; log `audit/repro/S-1-04.log`.
**Sonuç: TETİKLENEMEDİ — ortam engeli** (aynı `XX000` auth hatası, ilk sorguda; fixture yaratılmadı). Script üç bölümlü:
- **§1** saf fonksiyon: `duplicateGuardLockKey(140.0001) === duplicateGuardLockKey(140.0004)` — DB'siz, deterministik.
- **§2** DB: 140.0001 yazılır, guard'ın eşitlik yüklemi **birebir** koşulur (`initialQty: new Prisma.Decimal(140.0004)`) → eşleşme beklenmez; kontrol olarak yuvarlanmış değerle aynı satır aranır. **Bayraktan bağımsız ve deterministik.**
- **§3** uçtan uca `createInitialEntry` × 2 — **yalnız `kk1.duplicateGuardEnabled` AÇIKSA** koşar; bayrak bu denetimde DEĞİŞTİRİLMEZ, kapalıysa atlandığı raporlanır. (Sahada bayrak AÇIK → yol canlıdır.)

**İş etkisi.** Tuzağın vaat ettiği koruma, en çok gerektiği yerde (otomatik ölçüm + seri giriş) sessizce eksik çalışır. Mükerrer ham giriş → ham stok fazla; hayalet top sonraki istasyonda takılır.

**Öneri (2. tur için).** ① Tek satırlık düzeltme: sorgu tarafını da kilit tarafıyla **aynı** fonksiyondan geçir — `new Prisma.Decimal(new Prisma.Decimal(data.initialQty).toFixed(3))` (ve `width` için aynısı); daha temizi: helper'a `quantizeForGuard(v)` ekle ve **hem anahtar hem sorgu** onu çağırsın (tek kaynak → bir daha ayrışamaz). ② Bekçiyi genişlet: `test_kk1_duplicate_guard` case 15 bugün yalnız anahtarı ölçüyor; **sorgu tarafını ölçen negatif sonda** eklenmeli (140.0001/140.0004 çifti → 409 beklenir). ③ Replay dalının kimlik-kilidi (`inventory.service.ts:976-979`) da aynı hassasiyet sorusuna tabidir — `sameQty` `Decimal.equals` ile ham değeri karşılaştırır; aynı `quantize` ondan da geçmelidir. Migration/izin/APK YOK.

**Kabul kriteri.** `audit_repro_S-1-04.ts` §2 yeşil (yuvarlanmış sorgu satırı bulur **ve** ham sorgu da bulur); §3 bayrak açık bir ortamda 409 döner. Bekçinin negatif sondası (quantize kaldırılınca) KIRMIZI verir.

**Efor.** 0,25 gün (①+③), 0,25 gün (②).

**Önceki defter.** Defterde YOK; kaynağı `audit/00-map/K7a` #3 endişe notudur (② denetçisine bırakılmıştı).

---

### [S-1-05] Offline flush'ta `Roll.createdAt` = FLUSH anıdır; "Ham Stok'ta createdAt = KK1 girişi" invariantı kırılıyor — Dashboard'ın "bugün giren ham mal" sayacı yanlış güne yazıyor ve `clientEnteredAt` hiçbir yüzeyde okunmuyor
| Şiddet | S2 | Kategori | C (türetilmiş/denormalize alan) | Öncelik | P1 | Modül | envanter / rapor | Kanıt seviyesi | K1 |

**Özet.** Kök `CLAUDE.md`'nin 2026-07-30 kararı, Ham Stok sekmesinin `createdAt` ile sıralanmasını ve "Giriş" kolonunun `createdAt` basmasını açıkça şu gerekçeye bağlıyor: *"Ham Stok'ta oluşturma = KK1 girişi olduğu için `createdAt` doğrudur."* KK1 çevrimdışı kuyruğu sahada AÇIK olduğu için bu eşitlik **kırık**: kuyruktan gelen kayıtların `createdAt`i flush anıdır (2 saate — kuyruk tavanı gereği 24 saate — kadar sonra). Gerçek giriş anı `clientEnteredAt` kolonunda DURUYOR ama **onu okuyan tek yer mükerrer tuzağıdır**; hiçbir liste, detay paneli, rapor ya da Electron yüzeyi göstermiyor.

**Kanıt.**
- `Teks-Erp/src/services/inventory.service.ts:928` — kolon yazılıyor: `clientEnteredAt: storedEnteredAt`.
- `grep -rn "clientEnteredAt" Teks-Erp/src Electron/src` → **tüm vuruşlar** ya tuzak (`inventory.service.ts:846-896`), ya şema/Zod (`inventory.controller.ts:37`), ya audit etiketi (`constants/audit-field-labels.ts:115`, `Electron/src/lib/audit-field-labels.ts:101`). **Liste/rapor/detay okuması SIFIR.**
- `Teks-Erp/src/services/dashboard.service.ts:130-134` — "bugün giren ham mal" sayacı `createdAt` üzerinden:
  ```sql
  SELECT COUNT("id")::int AS cnt FROM "rolls"
  WHERE "entrySource" IN ('SUPPLIER_RECEIPT','MANUAL_ENTRY')
    AND "createdAt" >= ${today}   -- today = factoryDayStart()
    AND "colorId" IS NULL
  ```
  (`:46-48` `startOfToday() = factoryDayStart()` — gün sınırı DOĞRU çözülmüş; sorun sınır değil, **kolon seçimi**.)
- `Electron/src/pages/Operations/Rolls/service.test.ts:159` — `rollTabDefaultSortBy("RAW_STOCK") === "createdAt"` (sıralama sözleşmesi).
- `mobil/src/services/roll.service.ts:140-157` — istemcinin kendi belgesi olayı adıyla koyuyor: *"offline kuyruk tek flush'ta boşalır → çevrimdışı 40 dakikaya yayılmış 5 giriş sunucuda **milisaniyelerle ayrılır**"*.
- `mobil/src/offline/queryClient.ts:108` — `PERSIST_MAX_AGE_MS = 24 saat` → sapmanın üst sınırı 24 saat.
- **Koruma kontrolü:** (a) sunucunun `createdAt`i damgadan türetmesi → YOK (ve olmamalı — `createdAt` yazım anıdır); (b) listelerin `clientEnteredAt`e düşmesi (`COALESCE`) → YOK; (c) sapmayı gösteren bir rozet/uyarı → YOK; (d) Ham Stok'ta ikinci tarih kolonu → kök `CLAUDE.md` bilinçli olarak **yasaklıyor** ("liste yüzeyi = tek okunur değer") — yani çözüm ikinci kolon değil, **doğru kolonu seçmektir**.

**Çakışma senaryosu (aktörler: gece vardiyası ↔ ağ).**
```
22:10-05:50  Tablet çevrimdışı; operatör 40 top girer (clientEnteredAt gerçek ritmi taşır)
06:05        Ağ döner → resumePausedMutations() → 40 kayıt ~2 sn içinde yazılır
             → hepsinin createdAt'i 06:05:1x
SONUÇ 1: DÜNÜN "bugün giren ham mal" sayacı 40 EKSİK kapandı; BUGÜNÜNKİ 40 FAZLA açtı.
         (dashboard.service.ts:133 — factoryDayStart sınırı doğru, kolon yanlış.)
SONUÇ 2: Ham Stok listesinde 40 topun "Giriş" saati 06:05; girildikleri SIRA kaybolmuş
         (paralel flush → sıra rastgele). Operatör "gece giren topu" tarihe göre arayamaz.
SONUÇ 3: Gerçek an DB'de DURUYOR (clientEnteredAt) ama hiçbir ekran onu göstermiyor;
         teşhis yalnız audit'in newData'sından (declaredEnteredAt) yapılabiliyor.
```

**failure_mode.** Gece vardiyası çevrimdışı 40 top girer; sabah 06:05'te kuyruk boşalır → 28 Ağustos'un ham giriş sayacı 40 eksik, 29 Ağustos'unki 40 fazla raporlanır ve bu fark hiçbir yerde açıklanmaz. Aynı 40 topun Ham Stok listesindeki "Giriş" saati gerçek girişten 8 saate kadar sapar.

**Veride fiili ihlal (K2).** **Aranamadı (DB kapalı).** DB dönünce — bu ölçüm doğrudan ve kesindir:
```sql
-- Kuyruktan gelmiş kayıtlar ve sapma büyüklüğü
SELECT COUNT(*) AS kuyruktan,
       MAX(EXTRACT(EPOCH FROM ("createdAt" - "clientEnteredAt"))/60) AS max_dk,
       COUNT(*) FILTER (
         WHERE date_trunc('day', "createdAt"    AT TIME ZONE 'Europe/Istanbul')
            <> date_trunc('day', "clientEnteredAt" AT TIME ZONE 'Europe/Istanbul')
       ) AS gun_atlayan
FROM rolls
WHERE "clientEnteredAt" IS NOT NULL
  AND "createdAt" - "clientEnteredAt" > interval '2 minutes';
```
`gun_atlayan > 0` → Dashboard sayacının yanlış güne yazdığı KANITLANIR (K2).

**Repro (K3).** Gerekmez — yarış değil, kolon seçimi. Yukarıdaki sorgu tek başına yeterlidir.

**İş etkisi.** Günlük ham giriş sayacı iki gün arasında kayar (vardiya değerlendirmesi ve "bugün ne geldi" sorusu yanlış cevaplanır). Ham Stok listesinde operatör kendi girdiği topu bulamaz — 2026-07-30 kararının tam olarak önlemek için var olduğu semptom ("statüyü doğru yazmak yetmez, operatörün onu BULABİLMESİ gerekir"). Gelecekte ham stok yaşlandırma/FIFO eklenirse aynı kolon üzerinden kurulacağı için sapma oraya da taşınır.

**Öneri (2. tur için).** ① Ham giriş yüzeylerinde **etkin giriş anı** `COALESCE("clientEnteredAt", "createdAt")` olmalı: (a) Dashboard "bugün giren ham mal" (`dashboard.service.ts:133`), (b) Ham Stok sıralaması + "Giriş" kolonu, (c) KK1 "Son Kayıtlar". Tek kaynak bir SQL/Prisma yardımcısı (`effectiveEntryAt`) olsun ki üç yüzey ayrışamasın. ② `createdAt` DEĞİŞTİRİLMEZ (yazım anıdır, audit ve sıra bütünlüğü ona dayanır) — değiştirilen şey **hangi kolonun okunduğudur**. ③ Sapma > 2 dk olan kayıtlarda detay panelinde küçük bir not ("cihazda 22:41'de girildi, sisteme 06:05'te ulaştı") — teşhis maliyetini sıfırlar. ④ Destek index gerekebilir: `@@index([entrySource, clientEnteredAt])` — ölçüm sonrası, **vardiya dışında** deploy `[PROD'DA ÇALIŞTIRMA — index kuralı 14]`. Migration yalnız ④ için; ①-③ salt kod.

**Kabul kriteri.** Yukarıdaki K2 sorgusundaki `gun_atlayan` kayıtlar için Dashboard'ın günlük sayacı, girişin gerçekleştiği güne yazar. Ham Stok listesinde kuyruktan gelen topların sırası cihazdaki giriş sırasıyla aynıdır.

**Efor.** 1 gün (① üç yüzey + tek kaynak helper), 0,5 gün (③).

**Önceki defter.** Defterde YOK. İlişkili karar: kök `CLAUDE.md` 2026-07-30 ("buraya geliş ≠ oluşturma") — bu bulgu o kararın **ham stok ayağının** offline kuyrukla kırıldığını söylüyor.

---

### [S-1-06] Kuyruktan flush edilen kaydın üretim atfı (kim/hangi makine/hangi istasyon) FLUSH anındaki oturumdan yazılır; zaman boyutu taşınıyor, aktör ve yer boyutu taşınmıyor
| Şiddet | S3 | Kategori | C / E | Öncelik | P2 | Modül | envanter / izlenebilirlik | Kanıt seviyesi | K1 |

**Özet.** İstemci, offline kuyruktaki kaydın **zamanını** (`clientEnteredAt`) bilinçli olarak taşır ve sunucu onu kabul eder. Aynı kaydın **kimin, hangi makinede, hangi istasyonda** girdiği bilgisi ise taşınmaz: sunucu bunları isteğin işlendiği andaki JWT + çalışma oturumundan türetir. Kuyruk operatör değişimini, cihazın yeniden başlatılmasını ve yer değişikliğini aşabildiği için atıf kayabilir. İkincil etki: 8021 tuzağının kimlik demeti `createdById` + `createdMachineId` içerir — atıf kayınca **tuzağın kimliği de kayar**.

**Kanıt.**
- `Teks-Erp/src/controllers/inventory.controller.ts:294-301` — atıf, isteğin işlendiği andaki oturumdan:
  ```ts
  const stamp = await getStampContext(req, { enforceForMobile: true });
  ... req.user?.userId, stamp?.machineId ?? req.device?.machineId ?? null, ...
  ```
  `:313` `entryStationId: stamp?.stationId ?? null`.
- `Teks-Erp/src/services/inventory.service.ts:920-924` — `createdById`, `createdMachineId`, `entryStationId` böyle yazılır.
- `mobil/src/services/roll.service.ts:100-157` (`InitialEntryRequest`) — gövdede **machineId/stationId/operatorId alanı YOK**; yalnız `clientEnteredAt` var. Asimetri burada görünür.
- `mobil/src/offline/flushThenLogout.ts:99-103` — riskin istemcide **BİLİNÇLİ KABUL** edildiği yer:
  > *"NOT: A'dan kalan bekletilmiş kuyruk B'nin token'ıyla gider — app-restart sonrası resume ile aynı, **bilinçli kabul** (SAHA-AG-DAYANIKLILIK.md §S1)."*
  Kabul edilen şey "B'nin token'ı"dır; **`createdMachineId`/`entryStationId` sapması ve tuzak kimliğine etkisi hiçbir yerde yazılı değil.**
- `mobil/src/offline/flushThenLogout.ts:29-30` — flush TAVANLI (`FLUSH_DEADLINE_MS = 5_000`): tavan dolarsa kayıtlar A'nın oturumu kapandıktan sonra B'nin altında akar.
- `Teks-Erp/src/services/helpers/duplicate-guard.helper.ts:59-79` — kilit anahtarı `userId` + `machineId` taşır; `inventory.service.ts:870-871` — ikiz sorgusu `createdById` + `createdMachineId` eşitliği arar.
- `Teks-Erp/src/services/helpers/work-session.helper.ts:90-101` — oturum başka kullanıcıya aitse `NEW_LOGIN` ile kapatılır → `enforceForMobile` altında **409 `WORK_SESSION_REQUIRED`**; kuyruktaki her kayıt 4xx alır (bkz. §3.4 amplifikasyonu).
- **Koruma kontrolü:** (a) istemcinin atfı beyan etmesi → YOK; (b) sunucunun damgaya bakıp "bu eski bir kayıt, atıf şüpheli" demesi → YOK; (c) atıf sapmasını gösteren bir yüzey → YOK; (d) `flushThenLogout` tavanı → sapmayı **daraltır, kapatmaz**.

**Çakışma senaryosu.**
```
T1  16:40  Operatör A, Sarım-2 makinesinde çevrimdışı 6 top girer (kuyrukta bekler)
T2  16:55  Vardiya biter; tablet şarj istasyonuna konur, uygulama öldürülür (flush olmadı)
T3  17:05  Operatör B tabletle gelir, giriş yapar, SessionGate'te "Sarım-4"ü onaylar
T4  17:05  Ağ var → restore edilen 6 kayıt resume olur → hepsi B'nin JWT'si ve
           B'nin oturumu (Sarım-4) ile yazılır
SONUÇ: 6 topun createdById=B, createdMachineId=Sarım-4, entryStationId=B'nin istasyonu.
       clientEnteredAt DOĞRU (16:40) — yani sistem "16:40'ta B, Sarım-4'te girdi" diyor.
       Ayrıca A'nın 16:40'ta ONLINE girdiği bir ikiz varsa tuzak onu artık BULAMAZ
       (createdById farklı) → mükerrer koruması bu kayıtlar için sessizce devre dışı.
```

**failure_mode.** Vardiya sonunda çevrimdışı girilen 6 top, ertesi operatörün adına ve onun makinesine yazılır. "Ekleyen" ve "Giriş İstasyonu" filtreleri (2026-08-12 izlenebilirlik paketi) yanlış cevap verir; makine bazlı üretim karnesi A'nın işini B'ye sayar. Aynı anda o 6 kaydın mükerrer koruması, ikizleri farklı operatör altında olduğu için devre dışı kalır.

**Veride fiili ihlal (K2).** **Aranamadı (DB kapalı).** DB dönünce:
```sql
-- Kuyruktan gelmiş (damga ile yazım arası > 2 dk) kayıtlarda, aynı gün AYNI cihazda
-- oturum sahibi değişmiş mi? (work_sessions ile çapraz)
SELECT r."id", r."barcode", r."clientEnteredAt", r."createdAt",
       r."createdById", r."createdMachineId", r."entryStationId"
FROM rolls r
WHERE r."clientEnteredAt" IS NOT NULL
  AND r."createdAt" - r."clientEnteredAt" > interval '2 minutes'
  AND EXISTS (
    SELECT 1 FROM work_sessions ws
    WHERE ws."machineId" IS NOT DISTINCT FROM r."createdMachineId"
      AND ws."startedAt" BETWEEN r."clientEnteredAt" AND r."createdAt"
      AND ws."userId" <> r."createdById")
ORDER BY r."createdAt" DESC;
```

**Repro (K3).** Yarış değil, sözleşme boşluğu — repro gerekmez; yukarıdaki sorgu ve §3.4'teki çizelge yeterli.

**İş etkisi.** Üretim atfı (kim/nerede) yanlış; operatör karneleri ve "Ekleyen/Giriş İstasyonu" filtreleri güvenilmez. Mükerrer koruması, kuyruktan geçen kayıtlar için sessizce zayıflar.

**Öneri (2. tur için).** ① İstemci, `clientEnteredAt` ile **aynı kimlik demetinde** giriş anındaki `machineId`/`stationId`/`userId`'yi de beyan etsin; sunucu bunları **doğrulayarak** kabul etsin (o an o cihazda o kullanıcının açık bir oturumu var mıydı → `work_sessions` ile çapraz; doğrulanamayan beyan `resolveEntryStamp` kalıbıyla **sessizce düşer**, kayıt reddedilmez). Bu, damganın bugünkü sözleşmesinin birebir genişletilmesidir; yeni bir desen değil. ② Asgari (APK'sız, bugün yapılabilir): sapma > 2 dk ise `Roll` detayında/audit'te "kuyruktan geldi — atıf flush anındaki oturumdan" notu; en azından yanlış cevap **işaretli** olur. ③ `flushThenSwitch`'in "bilinçli kabul" notu, atıf ve tuzak kimliği etkisini de yazacak şekilde genişletilmeli (bugün yalnız token'dan bahsediyor). Migration YOK; ① APK ister ve **backend ÖNCE** deploy edilmeli (alan opsiyonel eklenir).

**Kabul kriteri.** K2 sorgusu 0 satır döner (① sonrası atıf giriş anına ait olur) ya da ② uygulanmışsa her sapan kayıt işaretlidir.

**Efor.** 1,5 gün (①, backend + APK), 0,25 gün (②+③).

**Önceki defter.** Defterde YOK. İstemci tarafındaki yarısı `flushThenLogout.ts:99-103`'te BİLİNÇLİ KABUL olarak kayıtlı — bu bulgu o kabulün **kapsanmamış ikinci ve üçüncü boyutunu** (yer/makine atfı + tuzak kimliği) açıyor, kararı yeniden açmıyor.

---

## Uygulanan kontrol listesi

**Bölüm 4.1 — sekiz soru:** dört senaryonun her biri için tablolandı (§1.2, §2.4, §3.6, §4.1'in çizelgesi + §1.2'nin 5. sorusu).

| Bölüm 3 maddesi | Durum |
|---|---|
| **A.1** Check-then-act | **uygulandı** → §1.2 soru 3; iki CTA bulundu, biri kapalı (8021), biri açık → S-1-03. Ayrıca eşitlik yükleminin hassasiyeti → S-1-04. |
| **A.2** Lost update | **uygulandı, bulgu yok** — `createInitialEntry` bir INSERT'tir, hesaplanıp set edilen alan yok (`initialQty`/`currentQty` doğrudan payload). JSON kolon yazımı yok. |
| **A.3** İzolasyon / write skew / phantom | **uygulandı** → merge'in küme UPDATE'i ↔ KK1'in INSERT'i klasik phantom (S-1-03). Üçlü koşul (küme kararı + phantom mümkün + yükseltme/advisory yok) SAĞLANIYOR, bu yüzden "isolationLevel yok" gerekçesine değil somut çizelgeye dayandırıldı. |
| **A.4** Prisma tx tuzakları | **uygulandı, bulgu yok** — tx içinde `Promise.all([tx.*])` YOK; tx içinden havuz client'ı çağrısı YOK (bayrak okuması bilinçli olarak tx ÖNCESİNE alınmış, `:802-805`); dış dünya çağrısı yok; nested tx yok. Bu kalıp DOĞRU YAPILANLAR'a alındı. |
| **A.5** Scheduler / çoklu instance | **kapsam dışı — senaryo scheduler'a dokunmuyor** (KK1 yolunda zamanlanmış iş yok). |
| **A.6** Belge/barkod numarası | **uygulandı, bulgu yok** — `roll_barcode_counters` `ON CONFLICT DO UPDATE … RETURNING` atomik; `MAX+1` deseni yok; kapasite kontrolü (`MAX_ROLL_SEQ`) var. Kilidin tx boyunca tutulması sınır ötesi nota (BULGU-T1-093 ailesi). |
| **A.7** Node/Express içi eşzamanlılık | **uygulandı, bulgu yok** — bu yolda modül seviyesi mutable durum yok; fire-and-forget yalnız audit (proje ilkesi, best-effort). |
| **A.8** Cache ↔ eşzamanlılık | **uygulandı, bulgu yok** — bayrak okumaları önbeleksiz (invalidation sorunu YOK; bedeli performans, ölçülemedi → yazılmadı). |
| **B.1** DB tekilliği | **uygulandı** → `clientToken` partial unique + `barcode` unique + sayaç PK mevcut; **eksik olan tekillik yok**, eksik olan `itemId`nin CANLI olduğunu söyleyen kısıt (S-1-03'te "koruma yok" teyidi olarak). |
| **B.2** Upsert yarışı | **kapsam dışı** — bu yolda upsert yok (sayaç `ON CONFLICT`i atomik ve doğru). |
| **B.3** API idempotency | **uygulandı** → replay dalı doğru; **istemci sözleşmesinin hata yolu** kırık → S-1-01. Ayrıca replay kimlik-kilidi `width/kg/kalite/özellik` içermiyor (payload sabit olduğu için bugün zararsız — S-1-04 §③'te birlikte ele alındı). |
| **B.4** Kuyruk/olay | **uygulandı** → mobil offline kuyruk bu senaryonun merkezi (S-1-01, S-1-05, S-1-06). |
| **B.5** Mantıksal mükerrer | **uygulandı** → S-1-02 (pencere dışı mükerrer) + `duplicate-rolls.service` hayalet-top sekmesinin bu vakayı kapsadığı not edildi. |
| **C** Veri modeli | **uygulandı** → `createdAt` ↔ `clientEnteredAt` ayrımı (S-1-05), atıf kolonları (S-1-06), `Decimal(12,3)` hassasiyeti (S-1-04). |
| **D** Tx sınırları | **uygulandı** → §1.1 tablosu; doğrulama/yazım sınırı S-1-03'ün kökü. |
| **E** İş kuralı değişmezleri | **kısmen** — "bir fiziksel top = bir kayıt" değişmezi dört yönden sınandı; metraj/statü değişmezleri bu yolda INSERT olduğu için kapsam dışı (D-A/D-E alanları). |
| **F** API/Express | **kısmen** — Zod düz `z.object` kararı gerekçesiyle DOĞRU bulundu (eski APK uyumu); yetki kapısı ve `semiFinished` ikinci kapısı okundu, bulgu yok. |
| **G** Güvenlik | **kapsam dışı — senaryo merceği**; `device.pairingRequired=false` gözlemi sınır ötesi nota bırakıldı. |
| **H** Performans | **kısmen** — sayaç serileşmesi ve önbeleksiz bayrak okumaları tespit edildi; **ölçülemedi (DB kapalı)** → bulgu yazılmadı, sınır ötesi nota bırakıldı. |
| **I** Hata/gözlemlenebilirlik | **uygulandı** → S-1-01 ve S-1-06'nın §3.4'ü tam olarak bu sınıf. |
| **J** Migration/kurtarma | **kapsam dışı — senaryo bu alana dokunmuyor.** |
| **K** Bekçiler | **uygulandı** → `test_kk1_duplicate_guard` case 15'in kör noktası (S-1-04 ②); `announceFailure.test.ts`in muafiyeti doğru davranış olarak kilitlemesi (S-1-01 K3 notu). |
| **L** Kod kalitesi / hesap tekrarı | **kapsam dışı — senaryo merceği.** |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **8021 kilidinin SIRASI ve KAPSAMI.** `inventory.service.ts:844` kilidi tx'in **ilk** ifadesi olarak alıyor — hem korunan `findFirst`ten (`:848`) hem barkod sayacından (`:905`) önce; `:820-834`'teki yorum her iki gerekçeyi de (TOCTOU ve ABBA) yazıyor. Ayrıca anahtar `userId`+`machineId` taşıdığı için **tabletler birbirini beklemiyor** — koruma gücünden ödün vermeden serileşme minimuma indirilmiş. Bu, denetimde gördüğüm en olgun advisory-lock kullanımı.
2. **Bayrak okumasının tx'e ALINMAMASI.** `:802-805`: *"tx İÇİNDEN çağrılırsa havuzdan İKİNCİ bir bağlantı ister. 30 eşzamanlı tx aynı anda bunu yaparsa havuz kendi kendini kilitler."* Karar ve ölçüm birlikte yazılmış; `roll-barcode.helper.ts:61-67`'deki ölçümle (30 eşzamanlı işlemin yalnız 3'ü tamamlandı) tutarlı.
3. **`clientEnteredAt` çapası — offline kuyruğun doğru çözümü.** Pencerenin sunucu saatiyle değil istemci damgasıyla ölçülmesi, iki yönlü olması, kelepçelenip (`resolveEntryStamp`) fail-open davranması ve `duplicateGuardCreatedAtFloor` ile index çıpasının **doğruluğu bozmadan** korunması: dört karar da yazılı gerekçeli ve birbirini tamamlıyor. (Bulgum S-1-05, bu kolonun VARLIĞINI değil, **başka yüzeylerde kullanılmamasını** eleştiriyor.)
4. **Token yapışkanlığının sınırı.** `mobil/src/offline/entryAttempt.ts` "belirsiz hatada yapış, kesin 4xx'te yapışma" kuralını saf, test edilebilir bir modüle çıkarmış ve *"yapışkan tek ref"in neden yanlış olduğunu* (seri girişte 4 topu sessizce yutar) yazılı olarak savunmuş. Kopyanın "aynadaki ikizi"ni (eksik stok) düşünmüş olması bu denetimin en az rastladığı olgunluk.
5. **`resolveActiveSession`'ın `orderBy: {startedAt:'desc'}` notu** (`work-session.helper.ts:41-44`): *"orderBy olmadan findFirst rastgele/eski birini döndürüp yanlış 409'a yol açardı"* — küçük ama tam olarak doğru bir determinizm kararı.
6. **Barkod sayacının `ON CONFLICT DO UPDATE … RETURNING n` deseni** ve boşluk politikasının açıkça "barkod bir KİMLİKTİR, sayaç değil" diye yazılması: `withBarcodeRetry`e ihtiyaç bırakmıyor, `MAX+1` anti-deseninden tamamen kaçınmış.

---

## Sınır ötesi notlar

1. **[H — performans]** `generateRollBarcode` KK1 yolunda tx İÇİNDE çağrılıyor (`inventory.service.ts:905`) — helper'ın kendi sözleşmesi (`roll-barcode.helper.ts:52-73`) bunu "TX AÇILMADAN ÖNCE" diye yazıyor ve 1345 ms ↔ 39 ms ölçümünü veriyor. KK1'in tx kuyruğu kısa olduğu için bugün sorun DEĞİL, ama `(gün, tip)` satırı **tüm fabrikanın tek serileşme noktası**dır. BULGU-T1-093 ile aynı aile → yeni bulgu açmadım. Ölçüm önerisi: 300 kayıtlık flush sırasında `pg_stat_activity`'de o satırı bekleyen sayısı + `endpoint_latency_daily` p95.
2. **[H]** `readKk1WeightEntryEnabled` ve `readKk1DuplicateGuardEnabled` **önbeleksiz** `system_settings.findUnique` yapıyor (`system-setting.service.ts:2174-2183`, `:2160` civarı) → her ham giriş 2 fazladan havuz round-trip'i. KUNYE "feature-flag cache" diyor; bu iki okuyucu ondan beslenmiyor. Ölçülemedi.
3. **[G]** `device.pairingRequired = false` (V-4 §0.2) → eşleşmemiş bir cihaz da `x-device-id` göndererek `req.device`i doldurabiliyor, dolayısıyla `entrySource=SUPPLIER_RECEIPT` (mobil KK1 taraması) atfını **istemci belirliyor** (`inventory.controller.ts:301` `Boolean(req.device)`). T1-113'ün komşusu; senaryo merceğinde kanıt üretemedim.
4. **[K — bekçiler]** `mobil/src/offline/announceFailure.test.ts` çakışma muafiyetini **doğru davranış olarak kilitliyor**; observer'sız mutation vakası hiç ölçülmüyor. Aynı sınıf: `test_kk1_duplicate_guard` case 15 kilit anahtarını ölçüyor ama sorgu tarafını ölçmüyor (S-1-04 ②). İkisi de "bekçi, hatayla aynı yerde kör" sınıfı.
5. **[B/E — D-B alanına]** `inventory.service.ts:976-979` replay kimlik-kilidi yalnız `itemId`/`colorId`/`initialQty` karşılaştırıyor; `width`, `weightKg`, `qualityGrade`, `propertyIds`, `semiFinished` DIŞARIDA. Bugün payload sabit olduğu için zararsız, ama sözleşme "ÖZDEŞSE" diyor ve fiilen "üç alanda özdeşse" ölçüyor. BULGU-T1-006'nın komşusu.
6. **[I]** §3.4: toplu 4xx'te (ör. `WORK_SESSION_REQUIRED`) N kayıt için N toast basılıyor ve toast katmanı aynı anda tek mesaj gösteriyor → operatör pratikte sonuncuyu görüyor. S-1-06'da anlatıldı ama asıl sahibi hata/gözlemlenebilirlik alanı.
7. **[C]** `duplicate-rolls.service` (hayalet top / mükerrer ham giriş sekmesi) S-1-02'nin ürettiği çiftleri yakalayabilecek TEK mevcut yüzeydir; S-1-02'nin K2 sorgusuyla çapraz okunması önerilir (mükerrer panelinin ② turundaki sahibine).

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **DB erişimi — TAMAMEN KAPALI (bu koşumun en büyük eksiği).** `sql-dev.sh`, `sql-saha.sh` ve iki repro scripti de `FATAL: Postgres.app failed to verify "trust" authentication` ile düştü (`audit/repro/S-1-03.log`, `audit/repro/S-1-04.log`). Sunucu ayakta (`ps` doğruladı) ama Postgres.app'in güven doğrulaması GUI diyaloğu gösteremediği için bağlantı reddediliyor; sunucuyu yeniden başlatmak salt-okunur mandanın dışında olduğu için denenmedi. **Sonuç:** hiçbir K2 sorgusu koşulamadı, hiçbir K3 repro tetiklenemedi; altı bulgunun tamamı K1'de. Her bulguya koşulacak SQL ve beklenen sonuç yazıldı.
2. **Feature-flag'lerin sahadaki değerleri doğrudan doğrulanamadı.** `kk1.onlineOnlyEnabled` ve `kk1.labelScanVerifyEnabled` için Tur 2'nin V-4 §0 ölçümüne + kod varsayılanına dayanıldı; ikisi de `[VARSAYIM]` etiketli. **S-1-01 ve S-1-02'nin olasılık tahmini bu iki değere bağlıdır** — bayraklar aslında AÇIKSA iki bulgunun da şiddeti bir kademe düşer. Doğrulama sorgusu §0'da.
3. **Bayrak değiştirilmedi (denetim kuralı).** `audit_repro_S-1-04.ts` §3 (uçtan uca tuzak ölçümü) `kk1.duplicateGuardEnabled` AÇIK olmayı gerektirir; script bayrağa dokunmaz, kapalıysa atladığını raporlar. Sahada bayrak AÇIK olduğu için yolun canlı olduğu kod okumasıyla tespit edildi.
4. **Fiziksel yazıcı arızası simüle edilemedi** (S-1-02). BT yazıcı, kâğıt sıkışması ve etiket çıktısı bu ortamda erişilemez; bulgu tamamen kod + kodun kendi saha ölçümleri üzerine kurulu.
5. **Mobil taraf için bekçi yazılmadı.** S-1-01'in doğru bekçisi `mobil/src/offline/announceFailure.test.ts`e eklenecek bir vakadır; denetim salt-okunur olduğu ve tek yazma iznim `Teks-Erp/scripts/audit_repro_*.ts` olduğu için yalnız tarif edildi.
6. **Havuz tükenmesi / 300 paralel istek yükü ölçülmedi** (§3.5). React Native'in host başına eşzamanlılık sınırı bu riski daraltıyor olabilir; iddia edilmedi.
7. **`kartela` / `fason kabul` / `Tambur manuel` gibi KK1'in kardeş giriş yolları** yalnız karşılaştırma amacıyla okundu (doğru deseni gösterdikleri yerlerde alıntılandı); kendi senaryoları bu turun kapsamında değil.
8. **Electron (masaüstü) "Manuel Top Ekle" yolu** aynı ucu kullanıyor ama `req.device` göndermediği için oturum/atıf boyutu farklı; senaryo tablet merkezli kurulduğu için ayrıca izlenmedi.
