# V-5 — Veri merkezli denetim (TUR 2)
### Numaralar · zaman damgaları · dev↔prod kısıt farkı · audit izinden davranış madenciliği

**Tarih:** 2026-08-28 · **Dal:** `adnansahin` @ `ce8681d1` · **Mercek:** veri merkezli (önce prod kopyasında ihlal ara, sonra kodda sebebini geriye izle)
**Veri kaynakları:** `tekserp_saha_0825` (prod'un 2026-08-25 yedeği · 189 migration · 2.431 top · 213 iş emri · 278 sipariş · 40 sevkiyat · 10.485 audit satırı) ve `adnansahin_db` (dev · 194 migration). İkisi de `audit/tools/sql-*.sh` ile SALT-OKUNUR.
**SQL dosyaları:** `audit/data/T2-V5-01..12-*.sql` (her ölçüm yeniden koşulabilir).

---

## 0. ÖLÇÜM HİJYENİ — bu turun tüm sayılarını etkileyen kesim noktası

Prod kopyası **saf değildir**: geri yüklendikten sonra üzerinde geliştirme/test koşulmuş.
Kesim noktası ölçüldü — `system_logs` `action='STARTUP'` satırlarının `newData->>'env'` alanı:

| env | satır | ilk | son |
|---|---|---|---|
| `production` | 33 | 2026-07-16 12:50 | **2026-08-24 18:23:57** |
| `development` | 26 | **2026-08-25 02:38:40** | 2026-08-25 13:49:50 |

→ **Prod-gerçek pencere: `createdAt < 2026-08-25 02:38`.** Ayrıca `_prisma_migrations`'ta
`20260825120000_color_name_unique_live` **2026-08-25 13:21:56**'da uygulanmış — yani KOPYAYA,
prod'a değil. Bu turdaki her sayı bu kesimle süzüldü; süzülmemiş bir sayı verdiğimde açıkça yazdım.
(Tur 1 çürütücüsünün "13:23-13:54 fixture izi" notu doğru ama **dar**: kirlenme 02:38'de başlıyor.)

---

## 1. BELGE / PARTİ / BARKOD NUMARALARI

### 1.1 Mükerrer + boşluk taraması (SQL: `T2-V5-01`, `T2-V5-02`)

Onsekiz kod kolonu `PREFIX + GGAAYY + NNNN` kalıbına göre ayrıştırıldı (`önek | gün | sıra`),
`GROUP BY` ile mükerrer, `LEAD()` ile gün-içi boşluk arandı.

| Kaynak | Seri | SAHA satır | Mükerrer | Boşluk aralığı | Kayıp numara |
|---|---|---|---|---|---|
| `work_orders.workOrderNumber` | IE | 213 | **0** | 0 | 0 |
| `traveler_cards.cardNumber` | IE | 213 | **0** | 0 | 0 |
| `orders.orderNumber` | SIP | 278 | **0** | 0 | 0 |
| `subcontractor_dispatches.dispatchNo` | FS | 195 | **0** | 0 | 0 |
| `subcontractor_receipts.receiptNo` | FK | 143 | **0** | 0 | 0 |
| `sacks.sackNo` | CV | 41 | **0** | 0 | 0 |
| `shipments.shipmentNo` | SVK | 40 | **0** | 0 | 0 |
| `customers.code` | MUS | 27 | **0** | 0 | 0 |
| `fabric_properties.code` | OZL | 7 | **0** | 0 | 0 |
| `rolls.barcode` | T…H | 1.236 | **0** | 0 | 0 |
| `rolls.barcode` | T…F | 1.047 | **0** | 0 | 0 |

**SAHA'da hiçbir seride tek bir mükerrer ya da tek bir boşluk yok.** Bu iki ayrı şeyi birden
kanıtlıyor: (a) `nextDailySeq` + `withBarcodeRetry` / advisory kilit zinciri sahada 40 gün boyunca
hiç çakışmadı; (b) kodlu hiçbir kayıt fiziksel olarak SİLİNMEDİ (soft-delete disiplini tutuyor —
hard delete olsaydı boşluk bırakırdı).

DEV'de boşluk var (`T…F` 9 aralık / 759 numara, `T…H` 2/25, `IE` 2/2) — hepsi test kalıntısı
temizliğinden; dev'de mükerrer de yok.

### 1.2 Top barkod sayacı ↔ gerçek barkodlar (atomik sayaç doğrulaması)

```sql
roll_barcode_counters  ⟷  rolls.barcode'dan türetilen max(sıra)
```
**38 sayaç satırı, `sum(n) = 2.283` = barkodlu top sayısı; gün+tip başına `n = max(barkod sırası)`,
FULL JOIN ile TEK satır bile ayrışmıyor.** Yani `INSERT … ON CONFLICT DO UPDATE n=n+count RETURNING n`
deseni sahada hiç boşluk üretmemiş (hiçbir tx geri sarmamış) ve hiç çakışmamış. Bu, repodaki en temiz
sayaç mekanizması. **Koru.**

### 1.3 4 hane (NNNN) tavanına yakınlık

| Seri | En yüksek günlük sıra | Tavan | Doluluk |
|---|---|---|---|
| T…F (final barkod) | 262 | 9.999 | %2,62 |
| T…H (ham barkod) | 114 | 9.999 | %1,14 |
| SIP | 63 | 9.999 | %0,63 |
| FS / IE | 21 | 9.999 | %0,21 |
| FK | 20 | 9.999 | %0,20 |
| CV / SVK | 12 | 9.999 | %0,12 |

Tavan riski **yok** (en yoğun gün kapasitenin %2,6'sı). `reserveRollBarcodes`'un
`last > MAX_ROLL_SEQ` → 409 dalı sahada hiç tetiklenmemiş.

### 1.4 Parti numarası — kısa/günlük kalıp karışımı ve bilinçli sarma

| Biçim | SAHA | DEV | Tarih aralığı |
|---|---|---|---|
| Kısa `P01…P99` | 191 | 417 | 2026-08-05 → |
| Günlük `P+GGAAYY+sıra` | 7 | 151 | 2026-07-20 → 2026-08-05 |
| Regex dışı (test/demo) | **0** | 24 | — |

`readLastShortBatchSeqTx`'in `^P(0[1-9]|[1-9][0-9])$` süzgeci **sahada güvende**: kopyada bu regex'e
uyan tek bir yabancı değer yok, yani "sayaç P01'e düşer" arıza modu bugün erişilemez.
⚠️ DEV'de `TEST-P-…`, `DEMO-KRSP-…`, `TSTK17A433623` gibi 24 satır var; hiçbiri regex'e uymuyor
(tesadüf değil, önek harfli) — ama bir fixture bir gün `P07` yazarsa **dev sayacı sessizce kayar**.

**Sarmanın ölçülen bedeli (bilinçli karar, `CLAUDE.md` 2026-08-05):**
aynı `P` numarasını taşıyan ve **ikisi de canlı top içeren** parti çifti: **87** (87 ayrı numara),
en yakın çift **7,80 gün**, ortalama **9,75 gün**. Yani "~5-10 gün arayla çakışır" beyanı sahada
BİREBİR doğrulanıyor. Kod tarafında `batchNumber` ile lookup yapan yer yok (`search-entities.ts:181`
yalnız aday listesi üretir, `EXACT_FORMATS`'ta parti YOK) → karar tutarlı uygulanmış.
Bu satır Tur 1 `BULGU-T1-150`'nin ölçüsüdür, yeni bulgu değildir.

---

## 2. ZAMAN DAMGALARI

### 2.1 Gün sınırı / saat dilimi sözleşmesi (SQL: `T2-V5-03`)

Her kodun içindeki `GGAAYY` ile o kaydın `createdAt`'inin **fabrika takvim günü**
(`AT TIME ZONE 'Europe/Istanbul'`) karşılaştırıldı:

| Kaynak | Toplam | Kod günü ≠ fabrika günü | UTC gününe uyan | 00:00-03:00 İst. |
|---|---|---|---|---|
| 9 kod kolonu (SAHA) | 3.343 | **1** | **0** | **0** |

Tek ayrışan satır `T080826F0001` (2026-08-06 14:09'da doğdu, barkodu 08.08.26): fason dönüşü topu
**barkodsuz doğar**, barkodu 2026-08-08'de etiketlenirken alır. Tasarım gereği
("barkod topun KİMLİĞİdir, erken/geç doğması sorun değil") — ihlal değil.

**Hiçbir kod UTC gününe düşmemiş.** `constants/time.ts` → `factoryYmd`/`factoryDaySql` zinciri
sahada doğru çalışıyor. Ayrıca `sl_day_exact` ifade istatistiği hem dev hem saha'da MEVCUT ve
`pg_get_statisticsobjdef` metni `factoryDaySql`in ürettiği ifadeyle birebir eşleşiyor (dolu:
`pg_statistic_ext_data` var) — migration `20260801050000`'in uyardığı sessiz plan düşüşü riski kapalı.

⚠️ Risk penceresi teorik değil: prod'da **00:00-05:00 arasında 60 audit satırı** var
(2 `WORK_ORDER CREATE`, 2 `BATCH CREATE`, 1 `SUBCONTRACTOR_DISPATCH CREATE`, 2 `SACK CREATE`,
`ITEM CREATE`…). Yani gece kod üretiliyor; sadece bugün doğru üretiliyor.

### 2.2 Sıralama değişmezleri (SQL: `T2-V5-04`, `T2-V5-05`, `T2-V5-12`)

Şemadaki `createdAt`/`updatedAt` taşıyan **91 tablonun tamamı** tarandı:

| Kontrol | SAHA | DEV |
|---|---|---|
| `createdAt > updatedAt + 1 sn` | **0** | 0 |
| `createdAt > now()` (gelecek) | **0** | 0 |
| `updatedAt > now()` | **0** | 0 |
| Gelecek tarihli diğer timestamptz | yalnız `work_orders.plannedEndDate` (199, +365 gün, meşru) ve `sessions.expiresAt` (184, meşru) | — |
| `orders`: sipariş tarihi gelecekte / termin siparişten önce / tamamlanma siparişten önce | **0 / 0 / 0** | — |
| `shipments`: sevk oluşturmadan önce / fatura sevkten önce / damgasız DISPATCHED | **0 / 0 / 0** | — |
| SHIPPED topun `statusChangedAt`'i sevk anından ≥5 dk sapmış | 1 / 689 | — |

`rolls` özel damgaları:

| Kontrol | SAHA | DEV |
|---|---|---|
| `finalizedAt < createdAt` | **955 / 2.431** (maks 0,697 sn) | 61 / 296 |
| `statusChangedAt < createdAt` | **409** (maks 0,148 sn) | 100 |
| `updatedAt < statusChangedAt` | **49** (maks 0,009 sn) | 32 |
| `cancelledAt < createdAt` · `labelPrintedAt < createdAt` | 0 · 0 | 0 · 0 |
| **Fabrika GÜNÜ ayrışan ters damga** | **0** | — |

→ Bulgu **V-5-05** (iki saat kaynağı). Bugün etkisi yok (aynı makine), sınıf gerçek.

### 2.3 `clientEnteredAt` kelepçesi (cihaz saati)

1.097 topta beyan var. Kelepçe `[-36 saat, +5 dakika]` (`duplicate-guard.helper.ts:33-41`):

| Ölçüm | SAHA |
|---|---|
| Kelepçe dışı (saklanmış olamaz) | **0** |
| Cihaz saati sunucudan İLERİ (negatif fark) | 778 (maks **5,47 sn**) |
| Sunucudan geri > 5 dk (offline kuyruk) | 26 (maks **34 dk 30 sn**) |
| Sunucudan geri > 1 saat | 0 |

Kelepçe sahada hiç ihlal edilmemiş; tablet saatleri sunucudan en fazla 5,5 sn sapıyor. Guard'ın
"aynı cihazın aynı saatinden gelen iki damganın FARKI" varsayımı **ölçümle doğrulandı**.

### 2.4 `finalizedAt` / `statusChangedAt` kapsaması (trigger)

| Statü | Top | `finalizedAt` boş | `statusChangedAt` boş |
|---|---|---|---|
| SHIPPED | 689 | 0 | 0 |
| WAREHOUSE | 250 | **3** | 3 |
| A1_STOCK | 0 | — | — |
| SCRAP | 1 | **1** | **1** |
| CANCELLED | 230 | 139 (beklenen) | 1 |
| IN_PRODUCTION | 37 | 36 (beklenen) | 28 |

`SCRAP` topun damgasızlığı = Tur 1 `BULGU-T1-032` (trigger kaynak listesi 2026-08-25'te eklenen
Fire ucunu kapsamıyor: `WAREHOUSE → SCRAP` geçişinde `OLD.status` listede yok). **Veriyle doğrulandı:
prod'daki 1 fire topunun 1'i damgasız.** Yeni bulgu açmıyorum; bunun yerine trigger gövdesinin
bekçisiz oluşunu **V-5-04** olarak yazıyorum (aynı hatanın gelecekteki ikizini yakalayan katman yok).

---

## 3. DEV ↔ PROD KISIT FARKI (K2b doğrulaması)

Dört katalog iki DB'de tam olarak karşılaştırıldı (`pg_constraint`, `pg_indexes`, `pg_trigger`,
`pg_proc`, `pg_enum`, `information_schema.columns`, `pg_collation`, `pg_statistic_ext`):

| Katalog | SAHA | DEV | Fark |
|---|---|---|---|
| CHECK / UNIQUE / EXCLUDE constraint | 27 | 27 | **0** |
| Index (tümü) | 472 | 473 | **3 satır** (aşağıda) |
| Trigger (kullanıcı) | 3 | 3 | **0** (tanım md5'leri aynı) |
| Enum değeri | 162 | 163 | 1 (`ReasonPresetKind.ORDER_CANCEL` — uygulanmamış migration) |
| Kolon | 1.066 | 1.073 | 7 (yalnız uygulanmamış 5 migration'ın kolonları) |
| Collation | `tr_sort` (icu, `tr-u-kn`) | aynı | 0 |
| Extension istatistiği | `sl_day_exact` dolu | aynı | 0 |
| Fonksiyon gövdesi (md5) | — | — | **3 fonksiyon FARKLI** → §3.2 |

### 3.1 Index farkının çözümü

| Index | SAHA | DEV | Gerçek sebep |
|---|---|---|---|
| `items_nameFold_key` (partial UNIQUE) | **YOK** | VAR | **Yumuşak kapı ATLADI** — `items`'ta 1 mükerrer `nameFold` grubu var → **V-5-03** |
| `orders_active_createdAt_idx` | YOK | VAR | Migration `20260826120000` prod'a hiç gitmedi (yeni) — drift değil |
| `colors_nameFoldColor_key` | VAR | YOK | ⚠️ **Kopyaya sonradan uygulanmış** (`_prisma_migrations` 2026-08-25 13:21:56 > kesim noktası). Prod'da bu sed **HİÇ YOK**; dev'de ise `colors`'ta 1 mükerrer (`beyaz`) olduğu için kapı atlıyor. |

**17 `nameFold` tablosunun mükerrer sayımı (ihlal ölçümü):**

| Tablo | SAHA mükerrer grup | DEV | DB seddi (saha) |
|---|---|---|---|
| `items` | **1** (`v-1430`) | 0 | **YOK** |
| `colors` | 0 | 1 (`beyaz`) | (kopyada var, prod'da yok) |
| `stations` | 0 | 3 (test kalıntısı) | YOK (13 tabloda hiç yok) |
| diğer 14 | 0 | 0 | 12'sinde hiç yok |

Yani "uygulama check-then-act TEK koruma" cümlesi **saha'da 16/17 tablo için doğrudur**, ve o
korumanın koruduğu değişmez sahada **1 kez ihlal edilmiş** (`items` `v-1430`, 2026-07-17'de
34 sn arayla iki kayıt, ikisi de bugün pasif — guard'ın kendisi o tarihte henüz yoktu).

### 3.2 Fonksiyon gövdeleri prod ↔ dev BAYT FARKLI (CRLF)

`tr_fold`, `audit_block_tamper`, `roll_stamp_production_timestamps` — üçünün de
`pg_get_functiondef` md5'i saha ≠ dev. Fark **anlamsal değil, satır sonu**: prod'daki gövdeler
`\r\n` taşıyor (migration dosyası Windows sunucuda CRLF ile uygulanmış), dev'dekiler `\n`.
Anlam aynı; ama sonucu şu: **iki DB'nin nesneleri asla bayt-bayt eşitlenemez**, dolayısıyla
"prod'daki gövde repodakiyle aynı mı" sorusunu md5 ile soran bir bekçi kalıcı yanlış-alarm verir.
Bugün böyle bir bekçi yok (§V-5-04). Veri tarafında CRLF sızıntısı **yok** (tüm text kolonlar
tarandı: yalnız `peripheral_devices.terminator` 3 satırda CR taşıyor — meşru, seri port sonlandırıcı).

### 3.3 Feature-flag / SystemSetting farkı (davranışsal drift)

34 ayarın 30'u birebir aynı. Anlamlı farklar:

| Anahtar | SAHA (prod) | DEV | Not |
|---|---|---|---|
| `auth.sessionDurationMinutes` | **480** | 43200 | Prod'da **etkisiz** (aşağı bak) |
| `auth.autoLogoutOnExpiry` | **false** | false | → token ömrü `absoluteSessionCapDays`=30 gün |
| `label.copies` | 2 | 1 | operasyonel |
| `kk1.rawWidthEnabled` | false (satır VAR) | satır YOK | kod varsayılanına düşer, aynı sonuç |
| `system.installationId` | YOK | VAR | job 2026-08-26'da eklendi, yedekten sonra — drift değil |

**Ölçüm:** `sessions` tablosundaki **214 oturumun 214'ünde `expiresAt - createdAt = 720 saat`
(30 gün)**; 186'sı yedek anında hâlâ canlı. `auth.service.ts:283-303` bunu açıklıyor —
`autoLogoutOnExpiry=false` iken `sessionMinutes` HİÇ kullanılmıyor. Panelin "Oturum zaman aşımı —
token ömrü (dakika) = 480" değeri prod'da **inert**. (Bu, Tur 1 `BULGU-T1-051`'i ÇÜRÜTMEZ, aksine
sayısal olarak DOĞRULAR; sınır ötesi notlara taşıdım.)

Kritik bayrakların prod değerleri (bulgu şiddeti hesaplarında kullanılmak üzere):
`kk1.duplicateGuardEnabled = **true**` (2026-08-05 11:01'den beri, hiç değişmemiş) ·
`kk1.onlineOnlyEnabled = true` · `production.kursunBypassEnabled = true` ·
`shipping.confirmationEnabled = false` · `device.pairingRequired = false` ·
`auth.idleTimeoutMinutes = 0` · `finance.pricingEnabled = false`.

---

## 4. AUDİT MADENCİLİĞİ (`system_logs`, 10.485 satır / 40 gün)

### 4.1 Ne kaydediliyor, ne kaydedilmiyor

| Kategori | satır | | Action | satır |
|---|---|---|---|---|
| DOMAIN | 10.037 | | CREATE | 6.579 |
| AUTH | 346 | | UPDATE | 3.289 |
| SYSTEM | 102 | | DELETE | 169 |
| | | | LOGIN_SUCCESS / FAILED | 214 / 67 |
| | | | **ERROR** | **15** |

15 `ERROR` satırının **tamamı** tek bir 500 hatası
(`POST /api/traveler-cards/:id/print-event`, 2026-08-05…08-06 — bilinen `bind` unutulması, `ef49bbc3`
ile kapandı). **İş kuralı reddi (4xx/409) için TEK bir satır yok** → bulgu **V-5-01**.

`newData.event` alanındaki alan-olayları (prod-gerçek pencere):

| Olay | adet | Olay | adet |
|---|---|---|---|
| `LABEL_PRINTED` | 2.554 | `TAMBUR_UNDO_SINGLE` | **49** |
| `PRINT_EVENT` | 193 | `LABEL_OVERRIDE_EDIT` | 14 |
| `BACKFILL_ENTRY_STATION` | 126 | `TARGET_WIDTH_CHANGED` | 7 |
| `KURSUN_BYPASS_TAMBUR_COMPLETE_UNASSIGNED` | 109 | `MANUAL_MOVE` | 7 |
| `ORDER_LINK_ADDED` | 45 | `TARGET_COLOR_CHANGED` | 6 |
| `TYPE_DERIVED_FROM_LINKS` | 35 | `RELABEL` / `WO_CLOSE_DISPOSITION` | 4 / 4 |
| `MASTER_DATA_MERGE` | 13 | `TAMBUR_UNDO_FULL` / `_RESTORE` | 3 / 1 |

### 4.2 Düzeltme kültürünün yükü (ölçüm, bulgu değil)

- **Top iptal oranı %9,46** (230/2.431) · fire %0,04 (1) → "iptal ucuz, fire pahalı" ayrımı sahada
  fiilen uygulanıyor.
- **Tambur geri alma 53 kez** (49 tekil + 3 tam + 1 restore) = 20 günde ~2,6/gün; kesim sayısı
  1.017 → geri alma oranı **%5,2**.
- Sapma defteri (`roll_variances`): `OVERAGE` 37 satır / 382,1 m · `RECORD_CORRECTION` 36 satır /
  309,9 m (`DIGER` 18, `MUKERRER_KAYIT` 16, `GIRIS_FAZLA` 2) · `SCRAP` 2 / 8,9 m.
- `WO_CLOSE_DISPOSITION` movement dağılımı: `WO_CLOSE_CANCELLED` 2 · `WO_CLOSE_SCRAP` 1 ·
  `WO_CLOSE_WAREHOUSE` 1 (özelliğin sahada 4 kez kullanıldığı anlamına gelir).
- Sevkiyat: 40 sevkiyat, 1'i PLANNED, 5 iade satırı, 6 VOIDED belge sürümü.
- `roll_plan_deviations`: **0 satır**. Kontrol edildi — bu DOĞRU: 2026-08-19 sonrası 507 Tambur
  kesiminin **hiçbirinde** ebeveyn rengi WO hedef renginden farklı değil, en sapması ±10 cm'i
  aşan yok. (İlk taramada 3 "sapma" çıktı; üçü de kesim noktası SONRASI kopyaya yazılmış
  IE2508260001/2/3 kayıtlarıydı — §0 hijyeni.) Yani defter boş, çünkü sapma olmamış.

### 4.3 Eşzamanlılık izleri

| Sorgu | SAHA sonucu |
|---|---|
| Aynı kullanıcı+cihaz+tablo+action, **1 sn içinde** tekrar | ROLL/UPDATE 828 · TRAVELER_CARD/UPDATE 85 · LABEL_PRINT_EVENT/CREATE 66 · ROLL/CREATE 34 |
| Aynı **kayıt** üzerinde 1 sn içinde AYNI içerikle ikinci yazım | `LABEL_PRINT_EVENT` **35** · `SYSTEM/STARTUP` 12 · `AUTH/LOGIN_FAILED` 3 |
| Aynı **kayıt** üzerinde 5 sn içinde **İKİ FARKLI kullanıcı** yazması (lost-update izi) | **0** |
| Aynı saniyede İKİ FARKLI kullanıcı top yaratması | **2** (2026-08-17 21:23:49 · 2026-08-21 12:26:55) |
| Aynı saniyede İKİ FARKLI makine | **2** (aynı iki an) |
| Aynı milisaniyede doğan top | 6 (hepsi tek fason kabul tx'inin `createMany`'si — eşzamanlılık DEĞİL) |

`LABEL_PRINT_EVENT`'in 35 birebir-aynı mükerreri istemcinin print-event'i iki kez ateşlemesidir;
sonucu `labelPrintedAt`'in iki kez yazılması (zararsız) + "kaç etiket bastık" sayımının şişmesi.
Ayrı bulgu yazmıyorum (S4 seviyesi, `BULGU-T1-062`'nin ters yönü) — ölçüm burada dursun.

### 4.4 Künye doluluk (kim/nereden/hangi istek)

| Alan | Tüm defter | **Künye deploy'undan sonra** (2026-08-24 18:24 →, prod-gerçek) |
|---|---|---|
| `userId` | 10.077 / 10.485 | istek yollarında %100 |
| `requestId` | 136 | `ROLL/CREATE` 41/41 · `LABEL_PRINT_EVENT` 45/45 · `WORK_SESSION` 4/4 |
| `deviceId` | 104 | `ROLL/CREATE` 41/41 |
| `ipAddress` | 482 | tüm istek yolları |

Deploy sonrası künyesiz kalan tek küme **script yolu**: `BACKFILL_ENTRY_STATION` (126) ve
`TYPE_DERIVED_FROM_LINKS` (35) — ikisi de `newData.source` alanıyla hangi script olduğunu YAZIYOR
(`scripts/fix_workorder_type_from_links.ts`). Bu, `BULGU-T1-127`'nin bilinen kapsamıdır ve
mekanizma **çalışıyor**; yeni bulgu açmıyorum, doğru yapılanlara yazıyorum.

---

## 5. UYGULAMA HATA İZİ (5xx / 503 / havuz)

`endpoint_latency_daily` (3.117 satır / 40 gün):

| Ölçüm | Değer |
|---|---|
| Toplam istek | **175.242** |
| `errCount` (yalnız ≥500) | **15** (%0,009) |
| 5xx üreten rota | tek: `POST /api/traveler-cards/:id/print-event` (225 istek, 15 hata) |
| En yavaş rota | `GET /api/rolls` 10.439 ms · `GET /api/work-orders` 5.697 ms · `GET /health` 4.579 ms |
| Havuz zaman aşımı audit satırı (`classifyPoolTimeout` → `logEvent`) | **0** |
| 503 izi | **0** |

`poolAcquireTimeouts` yalnız bellekte (`lib/pool-health.ts:116-137`) ve prod 40 günde **33 kez**
yeniden başlamış (~0,8/gün) → sayaç kalıcı değil; buna karşılık `endpoint_latency_daily` kalıcı ve
0 havuz olayı gösteriyor, yani havuz sahada gerçekten sıkışmamış. `latency-persist.service.ts:98`
**`status >= 500`** süzgeci sebebiyle 4xx bu tabloya da girmiyor → **V-5-01**.

---

# BULGULAR

---

### [V-5-01] İş kuralı reddi (4xx/409) hiçbir sayaçta ve hiçbir defterde yok — prod'da 40 günde 175.242 istek, 15 hata satırı ve tek bir 409 izi bile yok
| Şiddet | S2 | Kategori | I.4 | Öncelik | P2 | Modül | hata/gözlemlenebilirlik | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Sistemin operatöre "hayır" dediği her an — mükerrer top tuzağı, plan sapma onayı,
parti seçimi zorunluluğu, iptal edilmiş kaydın replay'i, çok-partili fason sevk çıkmazı — sunucuda
**hiçbir iz bırakmıyor**. `AppError` dalı yanıtı yazıp döner: audit yok, `console` yok, sayaç yok.
Kalıcı tek metrik tablosu da 4xx'i saymıyor. Sonuç: fabrikanın "bu tuzak işe yarıyor mu, operatörü
tıkıyor mu" sorusuna cevap verecek TEK bir sayı yok — üstelik tam da bu bayrakları açma/kapama
kararları ölçüme dayandırılmak isteniyor.

**Kanıt.**
- `Teks-Erp/src/middlewares/error.middleware.ts:269-276` — `AppError` dalı:
  ```ts
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;                       // ← audit YOK, console YOK, sayaç YOK
  }
  ```
  Aynı dosyada 5xx dalları (`:319-330`, `:363`, `:490`, `:535`, `:568`, `:616`)
  `AuditService.logEvent` çağırıyor — asimetri bilinçli değil, sessiz.
- `Teks-Erp/src/services/latency-persist.service.ts:98` — `if (status >= 500) d.errCount += 1;`
  (kalıcı tablo) ve `Teks-Erp/src/services/latency-stats.service.ts:125` aynı satır (bellek).
- Kapsam: `grep -rn "AppError\.\(badRequest\|conflict\|forbidden\|notFound\|unauthorized\)("`
  → **1.557** fırlatma noktası, bunların **401'i `AppError.conflict`** (409).
  Makine-okunur 409 kodları: `POSSIBLE_DUPLICATE` (`inventory.service.ts:888`),
  `CLIENT_TOKEN_COLLISION` (`:989`, `order.service.ts:2053`, `workorder.service.ts:1187`,
  `kartela.service.ts:1428`), `PLAN_MISMATCH` (`constants/tambur-plan-gate.ts:28`),
  `BATCH_REQUIRED` / `ENTRY_CANCELLED` (`tambur-manual.service.ts:1024,1049,1405`),
  `MULTI_BATCH` (`subcontractor.service.ts:1020`), `TARGET_COLOR_CHANGED` (`:2707`),
  `COLOR_PARTIAL_CONFIRM` / `COLOR_DYED_BLOCKED` (`workorder-target-color.helper.ts:62,64`),
  `REASON_CODE_INVALID` (3 nokta).
- "Koruma yok" teyidi — bakılan yerler: `system_logs` (`action`/`category` dağılımı, `newData.event`
  kataloğu), `endpoint_latency_daily` (`errCount` tanımı), `lib/pool-health.ts`, `/api/admin/health`
  alanları, `app.ts` morgan formatı (`combined` — dosyaya değil stdout'a, pm2 log rotasyonu repoda
  yapılandırılmamış). Hiçbirinde 4xx sayacı yok.

**failure_mode.** `kk1.duplicateGuardEnabled` prod'da **2026-08-05 11:01'den beri AÇIK**.
Operatör aynı ürün/renk/metraj/en ile 90 sn içinde ikinci topu girdiğinde 409 `POSSIBLE_DUPLICATE`
alıp "Gerçekten ayrı bir top" onayı veriyor. **Prod verisinde bu tuzağın tetiklendiği 13 çift
ölçüldü** (aşağıda) — ve on üçünün hiçbiri hiçbir yerde görünmüyor. Fabrika "bu tuzak bize günde kaç
kez soru soruyor, kaçı gerçek kopyaydı" diye sorduğunda cevap **üretilemez**; bayrağı kapatma kararı
körlemesine verilir. Aynısı `MULTI_BATCH` için daha kötü: o kodu tanıyan hiçbir istemci yok
(`BULGU-T1-037`), yani operatör çıkmaza düşüyor ve sunucuda buna dair tek satır yok.

**Veride fiili ihlal (K2).** `audit/data/T2-V5-01..10` + aşağıdaki sorgu
(guard'ın `WHERE`'iyle birebir aynı demet: `entrySource, itemId, colorId, initialQty, width,
createdById, createdMachineId` + 90 sn iki yönlü pencere), bayrağın açıldığı andan kesim noktasına:

```sql
with r as (select id, "createdAt", coalesce("clientEnteredAt","createdAt") anchor,
       "entrySource","itemId","colorId","initialQty",width,"createdById","createdMachineId"
   from rolls where status not in ('CANCELLED','SCRAP')
     and "createdAt" >= '2026-08-05 11:01:54' and "createdAt" < '2026-08-25 02:38')
select a."entrySource", count(*) from r a join r b on a.id<>b.id and a."createdAt"<b."createdAt"
 and a."entrySource"=b."entrySource" and a."itemId"=b."itemId"
 and a."colorId" is not distinct from b."colorId" and a."initialQty"=b."initialQty"
 and a.width is not distinct from b.width and a."createdById" is not distinct from b."createdById"
 and a."createdMachineId" is not distinct from b."createdMachineId"
 and abs(extract(epoch from (b.anchor-a.anchor)))<90 group by 1;
```
→ `SUPPLIER_RECEIPT` **13** (guard'ın fiilen koştuğu KK1 yolu — her biri bir 409 + operatör onayı),
`TAMBUR_SPLIT` 147 (guard bu yolda koşmuyor; demet eşleşmesi meşru arka arkaya kesim).
Tüm defterde `POSSIBLE_DUPLICATE` / `CLIENT_TOKEN_COLLISION` / `PLAN_MISMATCH` / `MULTI_BATCH`
geçen satır sayısı: **0**. `endpoint_latency_daily`: 175.242 istek, `errCount` toplam 15.

**İş etkisi.** Ölçülemeyen tuzak yönetilemez: eşiği (90 sn) ayarlamak, bayrağı kapatmak ya da
"tablet APK'sı 409'u tanıyor mu" sorusunu cevaplamak için elde veri yok. Sahada bir istemci
sürümü bir 409 kodunu tanımadığında (bugün `MULTI_BATCH` böyle) operatör tıkanır ve merkez bunu
ancak telefon geldiğinde öğrenir.

**Öneri (2. tur için).**
- *Kısa vade (yarım gün):* `latency-persist` + `latency-stats`'ta `errCount`'u ikiye ayır
  (`err4xx` / `err5xx`) — `endpoint_latency_daily`'ye tek kolon; migration küçük, geriye uyumlu.
- *Kısa vade:* `error.middleware`'in `AppError` dalında `err.details?.code` DOLU ise
  (yani makine-okunur bir iş kuralı reddi ise) `AuditService.logEvent({ category:"DOMAIN",
  action:"RULE_REJECT", tableName: <hedef>, newData:{ code, path } })` — best-effort, tx dışı,
  mevcut desen. **Her 4xx'i değil**, yalnız `details.code` taşıyanları yaz (yoksa 404/401 gürültüsü
  defteri boğar; ölçüldü: `AppError` 1.557 nokta, kodlu olan ~17).
- *Orta vade:* `/api/admin/health`'e rota × kod kırılımlı son-24-saat sayacı.

**Kabul kriteri.** `kk1.duplicateGuardEnabled` açıkken üretilen bir 409, (a) `system_logs`'ta
`code=POSSIBLE_DUPLICATE` ile bulunabilir ve (b) `endpoint_latency_daily.err4xx` artar; bekçi:
guard'ı tetikleyen bir sonda 1 audit satırı + 1 sayaç artışı ölçer.
**Efor:** 1,5 gün. **Önceki defter:** `BULGU-T1-126` (5xx/iç hataların izsizliği) — bu satır onun
**4xx/409 ikizidir**, farklı kod yolu (`AppError` dalı) ve farklı sayaç (`errCount` süzgeci).

---

### [V-5-02] Topun metrajı audit defterinden yeniden kurulamıyor: depo kesimi EBEVEYNİN metrajını düşürüyor ama ebeveyne tek satır iz bırakmıyor — prod'da 36,7 m'lik top defterde 36,7, satırda 0
| Şiddet | S2 | Kategori | I.3 | Öncelik | P2 | Modül | envanter / izlenebilirlik | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Depodan kes" (`TAMBUR_CUT_FROM_WAREHOUSE`) ebeveyn topun **hem `currentQty` hem
`initialQty`** değerini düşürür; yazılan tek audit satırının `recordId`'si **çocuğun** id'sidir.
Ebeveyn için ne audit satırı, ne `RollMovement`, ne `RollOperation`, ne `RollVariance` doğar.
Sonuç: topun kendi geçmiş ekranı ("Yaşam Döngüsü") doğuş metrajını gösterir, satır başka bir sayı
gösterir ve **aradaki farkı açıklayan hiçbir kayıt yoktur**.

**Kanıt.**
- `Teks-Erp/src/services/tambur.service.ts:2302-2319` — kesimin TEK audit satırı:
  ```ts
  await AuditService.log({ userId, action: "CREATE", tableName: "ROLL",
    recordId: result.child.id,               // ← ÇOCUK; ebeveyn için satır YOK
    newData: { kind: "TAMBUR_CUT_FROM_WAREHOUSE", parentRollId: parent.id, cutLength: data.cutLength, … } });
  ```
- `Teks-Erp/src/services/inventory.service.ts:2504-2590` — `getRollHistory` yalnız
  `rollMovement` / `rollOperation` / `subcontractorDispatchItem` / `subcontractorReceiptItem`
  okur. Aşağıdaki iki topta bu dört tablonun **dördü de boş**.
- `Teks-Erp/src/services/inventory.service.ts:3865-3869` (Düzelt yolu) aynı deseni ikinci kez
  kuruyor: `rollData.currentQty = m; rollData.initialQty = m;`.
- "Koruma yok" teyidi: `roll_movements`, `roll_operations`, `roll_variances`, `system_logs`
  (recordId=ebeveyn) — dördü de sorgulandı, sıfır satır.

**failure_mode.** 2026-08-19 saat 14:55'te açık kumaştan **36,7 m**'lik `T190826F0119` kesildi,
etiketi basıldı (üç kez: 14:55, 15:15, 15:16). 15:18'de o topun içinden depo kesimiyle **36,7 m**
alındı → ebeveyn `initialQty=0, currentQty=0` oldu ve **Bitmiş Depo'da barkodlu, etiketi basılmış,
0 metrelik bir hayalet top olarak kaldı**. Aynısı 15:02/15:19'da `T190826F0120` (40 m) için tekrarlandı.
Bugün depo listesinde bu iki barkod duruyor; operatör onları arayıp bulamaz, defterlerine bakınca
"36,7 m kesildi" yazar. Sevkiyata alınırlarsa müşteri irsaliyesine 0 m'lik satır girer.

**Veride fiili ihlal (K2).** `audit/data/T2-V5-11-metraj-defteri.sql` (SAHA, prod-gerçek):

| Ölçüm | Sonuç |
|---|---|
| CREATE audit'i olan top | 2.261 |
| CREATE defteri metrajı ile `rolls.initialQty` **AYRIŞIK** | **10** |
| bunlardan hiç `ROLL/UPDATE` audit'i OLMAYAN (yani defter hiç açıklamıyor) | **3** |
| `initialQty = 0` ile duran top | **8** (2'si BUGÜN `WAREHOUSE`) |
| depo kesimi görmüş ebeveyn | 9 (14 kesim); 8'inin kalanı 0 |

Somut satırlar: `T190826F0119` (defter 36,7 → satır 0, WAREHOUSE, etiketli),
`T190826F0120` (40 → 0, WAREHOUSE, etiketli), `T160726F0003` (50 → 0),
`T080826F0019` / `T080826F0020` (39 → 0), `T030826F0003` (50 → 0),
`T150826F0006` (325 → 275, WAREHOUSE — canlı ve **yanlış** başlangıç metrajı taşıyor).

**İş etkisi.** ① Bitmiş Depo'da satılamayan/görülemeyen hayalet toplar (bugün 2 adet).
② İş emrinin "üretilen metrajı" geriye dönük düşüyor — kapanmış bir dönemin Kalite/Üretim Karnesi
sonradan farklı rakam basar. ③ Uyuşmazlık çıktığında ("bu top kaç metreydi") defter cevabı
veremiyor; ISO 9001/27001 izlenebilirlik iddiası bu noktada boş.

**Öneri (2. tur için).**
- `cutWarehouseRoll` tx'inin İÇİNDE ebeveyn için **bir `RollMovement` ya da `RollVariance`**
  satırı yaz (`kind: RECORD_CORRECTION` değil, yeni `source: TAMBUR_WAREHOUSE_CUT`) — tx'e bağlı
  olmalı ki geri sarımda o da geri sarılsın. `AuditService.log` best-effort olduğu için TEK başına
  yeterli değil.
- `initialQty`'ye dokunmayı ayrı bir karar olarak ele al (`BULGU-T1-012`): "üretim anı snapshot'ı"
  sözleşmesi korunacaksa depo kesimi yalnız `currentQty` düşürmeli.
- Kalan 0 m'lik ebeveyni `TAMBUR_CONSUMED`'a çek (`BULGU-T1-039`).
- Bekçi: `scripts/test_consistency.ts`'e "CREATE audit metrajı ↔ `initialQty` ayrışan ve hiçbir
  hareket/sapma satırı olmayan top = 0" bölümü.

**Kabul kriteri.** Depo kesiminden sonra ebeveyn topun `GET /api/rolls/:id/history` çıktısında
metrajın nereye gittiğini söyleyen bir olay bulunur; yukarıdaki mutabakat sorgusu 0 döner.
**Efor:** 1 gün (+ geçmiş 10 satır için ayrı veri kararı — toplu UPDATE **önerilmez**, kök neden
gizlenir). **Önceki defter:** `BULGU-T1-012` + `BULGU-T1-039` (aynı kod yolu, farklı tezahür:
bu satır **defterin eksikliğini** ve K2 ölçüsünü getiriyor).

---

### [V-5-03] `items_nameFold_key` prod'da hiç kurulmadı, KENDİLİĞİNDEN kurulamaz, ve bunu söyleyen tek sinyal prod'a karşı KOŞTURULAMAYAN bir bekçi
| Şiddet | S2 | Kategori | J | Öncelik | P2 | Modül | migration / dev↔prod drift | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Ad-mükerrer DB seddi üç tabloya "yumuşak kapı" ile kuruldu: mükerrer varsa index
`RAISE NOTICE` ile **atlanır**, migration yine de başarılı sayılır. Prod'da `items` tablosunda
1 mükerrer grup olduğu için index kurulmadı — ve Prisma o migration'ı "applied" damgaladığı için
**bir daha asla kendiliğinden koşmayacak**. Migration'ın kendi NOTICE metni "temizlik sonrası bu
dosyayı yeniden koş" diyor; bunu yapacak bir komut, runbook adımı ya da hatırlatıcı yok.
Tasarım belgesinin öngördüğü tek görünürlük (`test_db_invariants §1` kırmızısı) ise prod'a karşı
**yapısal olarak koşturulamıyor**.

**Kanıt.**
- `Teks-Erp/prisma/migrations/20260821150000_name_fold_unique_live/migration.sql:53-77` —
  ```sql
  IF n_dup > 0 THEN
    RAISE NOTICE '[name_fold_unique] % ATLANDI — % mükerrer grup (%). … sonra bu dosyayı yeniden koş.', …
  ELSE
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I ("nameFold") WHERE "mergedIntoId" IS NULL', …);
  ```
- `Teks-Erp/scripts/run-all-tests.ts:102-118` — `productionDbGate()`:
  `NODE_ENV/APP_ENV === "production"` → `process.exit(1)`, **`ALLOW_NONLOCAL_TEST_DB` ile bile
  atlanamaz**. Yani `test_db_invariants` prod ortamında test paketiyle çalıştırılamaz.
- `grep -rn "test_db_invariants" docs deploy` → deploy runbook'unda prod'a karşı koşum adımı **yok**;
  yalnız tasarım belgeleri referans veriyor (`docs/design/MUKERRER-PANELI-TASARIM.md:81`).
- `grep -rln "nameFold_key" prisma/migrations scripts` → index'i kuran ikinci bir migration ya da
  onarım scripti YOK (`find_fold_duplicates.ts` yalnız tespit eder).
- "Koruma yok" teyidi — bakılan yerler: sonraki 5 migration, `scripts/` altındaki tüm `fix_*`/
  `backfill_*` scriptleri, `deploy/kur.ps1`, `docs/ops/DEPLOY-RUNBOOK.md`, `MIGRATION-DEPLOY.md`.

**failure_mode.** Fabrika Mükerrer Kayıtlar panelinden `v-1430` çiftini birleştirir; panel "temizlendi"
der; `items_nameFold_key` **yine kurulmaz** çünkü onu kuracak migration `_prisma_migrations`'ta
`finished_at = 2026-08-24 18:21:08` ile duruyor ve `migrate deploy` onu atlar. `items` için tek koruma
`base.service.ts:729-800`'deki kilitsiz check-then-act guard'ı olmaya devam eder; iki eşzamanlı
içe-aktarım/kayıt aynı kumaş adını sessizce iki kez yaratabilir. Kimse bunu fark etmez, çünkü kırmızı
verecek bekçi prod'a karşı koşturulamıyor ve dev'de o index **VAR** (yeşil).

**Veride fiili ihlal (K2).**
- `pg_indexes` diff (SAHA ↔ DEV): `items_nameFold_key` **DEV'de VAR, SAHA'da YOK** (tek yönlü
  yapısal drift; diğer iki index farkı uygulanmamış migration'la açıklanıyor — §3.1).
- Kapıyı kapatan tek grup: `items` `nameFold='v-1430'` → 2 satır
  (`BGR150 / V-1430`, `MC155 / V-1430`, 2026-07-17 10:27:36 ve 10:28:10, ikisi de `isActive=false`,
  ikisi de aynı kullanıcı).
- 17 `nameFold` tablosunun 13'ünde **hiçbir DB seddi yok** (ne dev'de ne prod'da); saha'da o 13'te
  mükerrer 0, dev'de `stations` 3 grup (test kalıntısı).
- SAHA `_prisma_migrations`: `20260821150000_name_fold_unique_live` `finished_at` DOLU,
  `rolled_back_at` NULL → yeniden koşmaz.

**İş etkisi.** Mükerrer kumaş kartı = mükerrer stok = sipariş karşılamada yanlış "açık" hesabı ve
iki ayrı koda dağılmış envanter. Bugün 1 grup var (pasif, zararsız); koruma **kalıcı olarak
kurulmamış** durumda ve bunun tek göstergesi kimsenin bakamayacağı bir bekçi.

**Öneri (2. tur için).**
- `[PROD'DA ÇALIŞTIRMA — önce dev'de]` Yeni bir **idempotent** migration
  (`…_name_fold_unique_enforce`) aynı `DO` bloğunu tekrar koşsun; `CREATE UNIQUE INDEX IF NOT EXISTS`
  zaten idempotent, temiz tabloda no-op. Geri alma: `DROP INDEX items_nameFold_key`.
- Ya da: temizlikten sonra `psql -f prisma/migrations/20260821150000_.../migration.sql` adımını
  **deploy runbook'una** yaz ve `docs/design/MUKERRER-PANELI-TASARIM.md:81`'e sahip + tarih ekle.
- Prod'a karşı koşturulabilir **salt-okunur** bir "DB seddi envanteri" çıkar
  (`scripts/consistency-check.sql` emsali — o zaten prod'a karşı koşuluyor): beklenen index listesi
  eksikse satır bassın. `test_db_invariants`'ı prod'a açmak **YANLIŞ** olurdu (yazan bölümleri var).

**Kabul kriteri.** `v-1430` birleştirildikten sonra prod'da
`select 1 from pg_indexes where indexname='items_nameFold_key'` 1 satır döner; ve o index yokken
prod'a karşı koşturulabilen bir sorgu bunu **kırmızı** raporlar.
**Efor:** 0,5 gün. **Önceki defter:** `BULGU-T1-066` (yumuşak kapının sahibi/tarihi yok) — bu satır
ona iki yeni kanıt ekliyor: **(a)** enforce mekanik olarak imkânsız (Prisma applied damgası),
**(b)** tasarımın öngördüğü sinyal prod'da yapısal olarak gözlemlenemez (`productionDbGate`).

---

### [V-5-04] Tüm dönem raporlarının çıpasını yazan trigger'ın GÖVDESİ hiçbir bekçide doğrulanmıyor — yalnız zamanlaması ölçülüyor; üstelik prod ile dev'in fonksiyon gövdeleri bugün de bayt-bayt farklı
| Şiddet | S3 | Kategori | J | Öncelik | P3 | Modül | migration / bekçi | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `roll_stamp_production_timestamps` uygulama kodundan değil DB'den çalışır ve Kalite/Fire/
Üretim karnelerinin tamamı onun yazdığı `finalizedAt`'e dayanır. Bekçi bu trigger'ın **var olduğunu
ve `BEFORE INSERT OR UPDATE` olduğunu** doğruluyor; **gövdesini** — yani load-bearing kaynak statü
listesini — hiç okumuyor. Gövde parmak izi kontrolü yalnız `tr_fold` / `tr_fold_color` için var.
Ayrıca prod ile dev'in fonksiyon gövdeleri satır sonu farkı (CRLF) yüzünden zaten md5-eşit değil,
yani "gövde aynı mı" sorusunu naif soran bir bekçi kalıcı yanlış alarm verirdi.

**Kanıt.**
- `Teks-Erp/scripts/test_db_invariants.ts:624-655` — trigger bölümü:
  ```ts
  const defN = norm(live.def);
  const timingOk = exp.timing.every((frag) => defN.includes(norm(frag)));   // ← yalnız BEFORE/olay
  ```
- `Teks-Erp/scripts/test_db_invariants.ts:678-682` — gövde kontrolü **yalnız iki fonksiyon**:
  ```sql
  WHERE n.nspname='public' AND p.prokind='f' AND p.proname = ANY(ARRAY['tr_fold','tr_fold_color'])
  ```
- `Teks-Erp/prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:74-84` —
  gövdedeki kaynak listesi ve yanındaki "⚠️ KAYNAK LİSTESİ LOAD-BEARING" notu.
- `Teks-Erp/scripts/run-all-tests.ts:102-118` — bekçi zaten prod'a karşı koşturulamıyor (V-5-03).
- "Koruma yok" teyidi: `test_schema_drift.ts` `pg_proc`/`pg_trigger` okumuyor (grep 0);
  `/api/admin/health` DB nesnesi doğrulamıyor; `consistency-check.sql` veri ölçer, şema değil.

**failure_mode.** 2026-08-25'te eklenen Fire ucu (`POST /rolls/:id/scrap`) `WAREHOUSE → SCRAP`
geçişi üretiyor; trigger'ın kaynak listesi `('IN_PRODUCTION','STOCK','AT_SUBCONTRACTOR',
'RETURNED_FROM_SUBCONTRACTOR')` bunu kapsamıyor → o top `finalizedAt` almıyor ve **hiçbir dönemin
Fire Karnesi'nde görünmüyor**. Bekçi paketi yeşil kalıyor, çünkü trigger var ve BEFORE.
Aynı sınıf ikinci kez ısıracak: yeni bir statü ya da yeni bir "depoya indir" yolu eklendiğinde
listeye eklenmeyi unutmak **sessiz eksik rapor** demek ve mekanik hiçbir kapı yok.
Üçüncü yol: prod'daki gövde elle düzenlenirse (DB kullanıcısı süper yetkili — `BULGU-T1-055`)
fark hiçbir yerde görünmez.

**Veride fiili ihlal (K2).**
- SAHA: `SCRAP` statüsündeki **1 topun 1'inde** `finalizedAt` ve `statusChangedAt` NULL;
  `WAREHOUSE`'ta 3/250 `finalizedAt` NULL. (Trigger var, gövde eksik.)
- `pg_get_functiondef` md5 karşılaştırması SAHA ↔ DEV:
  `tr_fold` `92ae2128…` ↔ `455d280d…` · `audit_block_tamper` `66e9fa9f…` ↔ `e806983…` ·
  `roll_stamp_production_timestamps` `85021f20…` ↔ `8fc9ad08…`.
  Bayt farkı `cmp` ile izlendi: prod gövdeleri `\r\n`, dev gövdeleri `\n` (anlam aynı).
- Veri tarafında CR sızıntısı yok: tüm `text`/`varchar` kolonlar `LIKE '%'||chr(13)||'%'` ile
  tarandı → yalnız `peripheral_devices.terminator` (3 satır, meşru).

**İş etkisi.** Dönem raporları sessizce eksik kalabilir ve bunu hiçbir otomatik kontrol söylemez;
üstelik prod'daki DB nesnelerinin repodaki tanımla aynı olduğunu doğrulayan hiçbir mekanizma yok.

**Öneri (2. tur için).**
- `test_db_invariants` §6'ya trigger **fonksiyonlarının** gövde parmak izini ekle: gövdede
  `('WAREHOUSE', 'A1_STOCK', 'SCRAP')` ve kaynak listesi fragmanı aranmalı; karşılaştırma
  **normalize edilmiş** olmalı (`\r` temizle) yoksa CRLF farkı kalıcı kırmızı üretir.
- Kaynak statü listesini tek kaynağa taşı: migration'ın gövdesi ile `constants/`teki TS listesi
  arasında AST/metin eşitliği ölçen bir bekçi (`test_consistency_derived` deseni).
- `deploy/kur.ps1` sonrası prod'a karşı koşan salt-okunur bir "DB nesne envanteri" (V-5-03 ile
  aynı araç).

**Kabul kriteri.** Trigger gövdesinden `'SCRAP'` ya da kaynak listesinden bir statü silindiğinde
bekçi KIRMIZI verir (negatif sonda ile ispatlanır); CRLF farkı kırmızı ÜRETMEZ.
**Efor:** 0,5 gün. **Önceki defter:** `BULGU-T1-032` (trigger listesinin eksikliği) — bu satır
**bekçi katmanını** hedefliyor, aynı hatayı bir daha yakalayacak mekanizmanın yokluğunu.

---

### [V-5-05] İki saat kaynağı: `createdAt/updatedAt` uygulamadan, `finalizedAt/statusChangedAt` DB'nin `now()`'ından (transaction BAŞLANGICI) — prod'da 2.431 topun 955'inde damga doğuştan ÖNCE
| Şiddet | S4 | Kategori | C | Öncelik | P5 | Modül | veri modeli / zaman | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Aynı satırın zaman damgaları iki farklı saatten geliyor: Prisma `@default(now())` /
`@updatedAt` değerleri **Node süreç saatinden** (sorgu kurulurken), trigger damgaları
PostgreSQL `now()`'undan — ve `now()` PostgreSQL'de **transaction başlangıç anıdır**, ifade anı
değil. Sonuç: aynı topta `finalizedAt < createdAt` gibi mantıksızlıklar. Bugün fark milisaniye
düzeyinde ve zararsız (Node ile PG aynı makinede), ama hiçbir değişmez bunu ölçmüyor ve DB
ayrı bir makineye taşındığı ya da bir tx gün sınırını geçtiği an sessizce yanlışlanır.

**Kanıt.**
- `Teks-Erp/prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:57,60,72,84`
  — dört yerde `now()` (belgeli ve `timestamptz` için doğru tercih; sorun `now()`ın **tx başlangıcı**
  olması, tercih değil).
- `Teks-Erp/prisma/schema.prisma` — `Roll.createdAt @default(now())` / `updatedAt @updatedAt`:
  driver-adapter ile bu değerleri **istemci** üretir.
- "Koruma yok" teyidi: `scripts/consistency-check.sql`, `consistency-check-derived.sql`,
  `test_db_invariants.ts`, `test_consistency.ts` — hiçbirinde zaman sırası (`a <= b`) bölümü yok
  (grep: `finalizedAt` geçen tek yer rapor sorguları). DB'de CHECK yok (`pg_constraint` contype='c'
  listesinde `rolls` için zaman kısıtı yok).

**failure_mode.** Tambur finalize transaction'ı 23:59:59,8'de başlayıp topu 00:00:00,3'te yazarsa:
`finalizedAt` (tx başlangıcı) **31 Ağustos**, `createdAt` (JS) **1 Eylül** olur. Kalite Karnesi topu
Ağustos'a, Bitmiş Depo listesi Eylül'e yazar; iki yüzey aynı topu farklı döneme koyar ve aradaki
farkı açıklayan hiçbir alan yoktur. İkinci yol: DB ayrı bir sunucuya alınır ve NTP sapması saniyeler
mertebesine çıkarsa aynı ters damga büyür.

**Veride fiili ihlal (K2).** SAHA (`audit/data/T2-V5-05-roll-zaman.sql`):
`finalizedAt < createdAt` → **955 / 2.431** (maks **0,697 sn**) ·
`statusChangedAt < createdAt` → **409** (maks 0,148 sn) ·
`updatedAt < statusChangedAt` → **49** (maks 0,009 sn) ·
**fabrika GÜNÜ ayrışan ters damga → 0** (bugün etki yok).
DEV: 61 / 100 / 32. Şemadaki 91 tablonun tamamında `createdAt > updatedAt` = 0, gelecek tarih = 0.

**İş etkisi.** Bugün yok. Sınıf gerçek: "aynı olayın iki saati" hatası ancak dönem kapanışında
fark edilir ve o noktada geriye dönük düzeltilemez.

**Öneri (2. tur için).** ① `consistency-check.sql`'e ucuz bir bölüm:
`finalizedAt < createdAt - interval '1 second'` / `statusChangedAt < createdAt - interval '1 second'`
→ 0 beklenir (1 sn tampon iki-saat gürültüsünü yutar, gerçek gün kaymasını yakalar).
② Uzun vadede `createdAt`'i de DB'ye bırakmak (`@default(dbgenerated("now()"))`) tek saate indirir —
ama **migration + davranış değişikliği**, ayrı karar. ③ Şema notuna "bu iki kolon farklı saatlerden
gelir" cümlesini yaz (bugün hiçbir yerde yazmıyor).
**Kabul kriteri.** Mutabakat sorgusu prod'a karşı 0 döner ve gün sınırını geçen bir tx sondasıyla
kırmızı verdiği gösterilir. **Efor:** 0,25 gün (yalnız ①). **Önceki defter:** yok
(`BULGU-T1-098` süreç-saati ↔ fabrika-günü ayrımını anlatıyor; bu satır **uygulama saati ↔ DB saati**
ayrımı, farklı eksen).

---

## OLASILIK GİRDİLERİ — gerçek eşzamanlılık ölçümleri (şiddet kalibrasyonu için)

Prod-gerçek pencere (2026-07-16 → 2026-08-25 02:38, 40 gün, 8 aktif kullanıcı).

| Ölçüm | Değer | Nasıl ölçüldü |
|---|---|---|
| Toplam HTTP isteği | **175.242** | `endpoint_latency_daily.count` toplamı |
| Toplam yazma (audit satırı) | **10.485** | `system_logs` |
| İş saatlerinde (08-17) ortalama yazma | **0,39 / dakika** | audit / (40 gün × 10 sa × 60) |
| Aynı saniyede 1 yazma | 6.237 saniye | `date_trunc('second')` gruplaması |
| Aynı saniyede 2-4 yazma | **1.183 saniye** | aynı |
| Aynı saniyede ≥5 yazma | **196 saniye** | aynı |
| En yoğun saniye | **126 yazma** | 2026-08-24 18:26:32 — `BACKFILL_ENTRY_STATION` scripti (kullanıcı trafiği değil) |
| En yoğun **kullanıcı** saniyesi | **36 yazma** | 2026-08-15 13:25:22, tek kullanıcı |
| En yoğun dakika (yazma) | **162** (script) / **55** (kullanıcı, 2026-08-15 13:25) | `date_trunc('minute')` |
| En yoğun dakika (top doğuşu) | **9 top** | 2026-08-17 09:33 |
| Aynı saniyede doğan top dağılımı | 5 top ×1 sn · 4 ×2 · 3 ×6 · 2 ×15 · 1 ×2.370 | `rolls.createdAt` |
| Ardışık iki top arası < 250 ms | **29 çift** (6'sı **0 ms**) | `LAG` — 0 ms'lerin hepsi TEK fason kabul tx'inin `createMany`'si |
| **İKİ FARKLI kullanıcı** aynı saniyede top yaratmış | **2 kez** (08-17 21:23:49 · 08-21 12:26:55) | `count(distinct createdById)` |
| **İKİ FARKLI makine** aynı saniyede | **2 kez** (aynı iki an) | `count(distinct createdMachineId)` |
| Aynı KAYIT üzerinde 5 sn içinde iki farklı kullanıcı | **0** | audit self-join |
| Aynı kullanıcı+tablo+action 1 sn içinde tekrar | ROLL/UPDATE **828** · TRAVELER_CARD/UPDATE 85 · LABEL_PRINT_EVENT 66 · ROLL/CREATE 34 | audit `LAG` |
| Eşzamanlı AÇIK çalışma oturumu zirvesi | **3** | `work_sessions` kesişim taraması |
| Ayrı cihaz sayısı (audit'te görünen) | 3 (künye 08-24'ten sonra) | `count(distinct deviceId)` |
| Sunucu yeniden başlatma | **33** (~0,8/gün) | `STARTUP` (env=production) |
| Vardiya penceresi (yazma yoğunluğu) | 08-17 arası %85; 11:00 ve 13:00 zirveleri (29,5 ve 29,1 yazma/gün-saat); 00:00-05:00 arası toplam 60 satır | saatlik histogram |
| 5xx | **15** (%0,009) · **503 / havuz zaman aşımı: 0** | `errCount`, audit |

**Kalibrasyon sonucu.** Fabrika trafiği DÜŞÜK ve **çoğunlukla tek-yazıcı**: 40 günde iki farklı
kullanıcının aynı saniyede yazdığı yalnız **2 an** var, aynı kayda iki kullanıcının yazdığı **hiç**
yok, eşzamanlı açık oturum zirvesi **3**. Buna karşılık **tek kullanıcı** saniyede 36 yazmaya kadar
çıkabiliyor (offline kuyruk boşalması / toplu işlem) — yani bu kurulumda **yarış riski ağırlıklı
olarak "aynı operatörün paralel/tekrarlı istekleri"nden** doğar, "iki operatör aynı kayda" senaryosu
sahada henüz hiç gerçekleşmemiştir. Yarış bulgularının olasılık kolonu buna göre okunmalı:
*tek-aktör paralelliği* → ORTA/YÜKSEK, *çok-aktör çakışması* → DÜŞÜK (ama sıfır değil; 2 kez oldu).

---

## Uygulanan kontrol listesi

| Görev maddesi | Durum |
|---|---|
| (1) Her günlük sayaç için LEAD ile boşluk + GROUP BY ile mükerrer (saha + dev) | **uygulandı** — 18 kolon, §1.1 |
| (1) 4 hane NNNN tavanına en çok yaklaşan gün | **uygulandı** — §1.3, maks %2,62 |
| (1) Parti no: kısa vs günlük kalıp karışımı | **uygulandı** — §1.4 |
| (1) Aynı numarayı taşıyan canlı parti çiftleri + gün farkı | **uygulandı** — 87 çift, min 7,80 gün |
| (1) `batchNumber` regex dışı değerler (sayaç P01'e düşme riski) | **uygulandı** — saha 0, dev 24 (hiçbiri regex'e uymuyor) |
| (2) `createdAt` saat dağılımı / gün sınırı kayması izi | **uygulandı** — §2.1, 0 ihlal; 00-05 arası 60 audit satırı var (risk penceresi gerçek) |
| (2) Aynı gün iki farklı GGAAYY / sayaç sıfırlanması | **uygulandı** — 0 |
| (2) `createdAt > updatedAt` | **uygulandı** — 91 tablo, 0 |
| (2) `finalizedAt < createdAt` | **uygulandı** — 955 → **V-5-05** |
| (2) `clientEnteredAt` kelepçe dışı | **uygulandı** — 0 (skew ölçüldü: maks +5,47 sn / −34,5 dk) |
| (2) Gelecek tarihli kayıtlar | **uygulandı** — tüm `timestamptz` kolonlar; yalnız meşru ikisi |
| (2) `statusChangedAt` trigger tutarsızlığı | **uygulandı** — kapsam tablosu §2.4 → **V-5-04** |
| (3) `pg_constraint` / `pg_indexes` / `pg_trigger` dev↔prod karşılaştırması | **uygulandı** — §3, ayrıca `pg_proc`, `pg_enum`, kolonlar, collation, `pg_statistic_ext` |
| (3) Saha'da eksik HER kısıt için ihlal sayısı | **uygulandı** — tek gerçek eksik `items_nameFold_key`, ihlal 1 grup → **V-5-03** |
| (4) En sık 4xx/409 kodları audit'te izleniyor mu | **uygulandı** — hiçbiri; → **V-5-01** |
| (4) 1 sn içinde aynı action tekrarı (çift tıklama/retry izi) | **uygulandı** — §4.3 |
| (4) Aynı kayıt, 2 farklı kullanıcı, 5 sn (lost update izi) | **uygulandı** — 0 |
| (4) Geri alma / storno / iptal sıklığı | **uygulandı** — §4.2 |
| (4) `WO_CLOSE_DISPOSITION` dağılımı | **uygulandı** — 4 olay, movement notlarıyla |
| (4) En aktif cihaz/kullanıcı saatleri (vardiya yığılması) | **uygulandı** — Olasılık tablosu |
| (5) latency/persist 5xx/503 sayıları, `poolAcquireTimeouts` | **uygulandı** — §5 |
| Tur 1 çürütücü önerilerinden alanıma düşenler | **işlendi**: `BULGU-T1-074 (db merceği)` → §3.1'de düzeltilerek doğrulandı (renk seddi prod'da DEĞİL, kopyaya sonradan uygulanmış); `BULGU-T1-007 (topoloji)` kanıt hijyeni → §0'da daraltılarak kesin kesim noktası verildi; `BULGU-T1-032 (topoloji)` → §2.4'te ölçüldü |
| Repro (K3) | **kapsam dışı** — bu tur salt-okunur veri madenciliği; D-A/D-B'nin yükümlülüğü |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **`roll_barcode_counters` atomik sayacı kusursuz çalışıyor.** 38 sayaç satırı, `sum(n)=2.283`,
   gün+tip başına `n = max(barkod)`, **sıfır boşluk, sıfır mükerrer**. `INSERT … ON CONFLICT
   DO UPDATE n = n + :count RETURNING n` + "tx AÇILMADAN ÖNCE çağır" kuralı sahada 40 gün boyunca
   tek bir çakışma üretmedi. `reserveRollBarcodes`'un dokümantasyonundaki iki-koşullu kabul kriteri
   (**T1 < 100 ms VE T2 = 30/30**) bu skill'in gördüğü en olgun sayaç sözleşmesi.
2. **Fabrika günü sözleşmesi (`constants/time.ts`) sahada ispatlandı.** 3.343 kodun 3.342'sinde
   `GGAAYY` = fabrika takvim günü, **hiçbiri UTC gününe düşmemiş**; ayrıca `sl_day_exact` ifade
   istatistiği hem dev hem prod'da mevcut ve `factoryDaySql` metniyle birebir eşleşiyor.
   Saat dilimi literalinin tek dosyada tutulması (`FACTORY_TIMEZONE`) bu doğrulamayı mümkün kıldı.
3. **`clientEnteredAt` kelepçesi + iki yönlü pencere doğru tasarlanmış ve veriyle doğrulanıyor.**
   Cihaz saatleri sunucudan en fazla 5,47 sn sapıyor, offline kuyruk 34,5 dakikaya kadar geciktiriyor;
   kelepçe (`+5 dk / −36 sa`) sahada **hiç ihlal edilmemiş**, yani "bozuk RTC üretimi durdurmasın"
   fail-open kararı bedava kalmış.
4. **Donmuş belge sürüm defteri (`printed_documents`) matematiksel olarak temiz.** 328 satır,
   `(docType, sourceId)` başına sürüm **boşluksuz ve mükerrersiz**, hepsi 1'den başlıyor;
   `traveler_cards.version` ile defterin max sürümü **213 kartın hiçbirinde ayrışmıyor**.
5. **Sayısal mutabakat tutuyor:** `order_lines.shippedQty` ↔ DISPATCHED sevkiyatların
   `SackAllocation` toplamı **281 satırın 281'inde birebir**; `sacks.seq` sevkiyat içinde
   boşluksuz/mükerrersiz.
6. **Veri düzeltme scriptleri kendi izini bırakıyor.** `BACKFILL_ENTRY_STATION` (126) ve
   `TYPE_DERIVED_FROM_LINKS` (35) audit satırları `newData.source` alanında script yolunu yazıyor
   (`scripts/fix_workorder_type_from_links.ts`) — aktörsüz olmaları kaçınılmaz, ama **hangi script**
   olduğu kayıtlı. Bu deseni yeni scriptlere de uygula.
7. **Şema drift'i dev↔prod arasında pratikte sıfır.** 1.066 kolon, 27 constraint, 3 trigger,
   162 enum değeri, 472 index — uygulanmamış 5 migration dışında **tek yapısal fark
   `items_nameFold_key`**. Migration disiplininin sonucudur, kendiliğinden olmaz.

---

## Sınır ötesi notlar

- **[G / oturum] `BULGU-T1-051` sayısal olarak DOĞRULANDI, ama sebebi farklı.**
  Prod'da `auth.sessionDurationMinutes = 480` (8 saat) yazıyor; buna rağmen `sessions` tablosundaki
  **214 oturumun 214'ünde `expiresAt − createdAt = 720 saat`**. Sebep `auth.autoLogoutOnExpiry = false`:
  `auth.service.ts:283-303` bu durumda dakika ayarını HİÇ kullanmıyor, `absoluteSessionCapDays = 30`
  dalına düşüyor. Yani panelde görünen "8 saat" prod'da **inert bir sayı**; token gerçekten 30 gün
  yaşıyor ve yedek anında **186 oturum canlı**. Ayrıca Electron metni
  (`SessionSettingsSection.tsx:79-83`) toggle kapalıyken "oturum **süresiz** olur" diyor — backend
  30 günlük tavan uyguluyor; iki cümle ayrışık.
- **[E / üretim] 28 top 11+ gündür `IN_PRODUCTION`'da hareketsiz, toplam 16,6 km.**
  `updatedAt` dağılımı: 08-06 (1) · 08-07 (1) · 08-08 (1) · 08-10 (2) · 08-11 (6) · 08-12 (4) ·
  08-13 (1) · 08-14 (11) · 08-15 (1) · 08-17 (1). 28'inde `statusChangedAt` NULL (trigger öncesi).
  "IN_PRODUCTION-stuck Kurtar" akışının sahada kullanılmadığına dair ölçüm; WIP yaşlandırma uyarısı
  yok.
- **[H / performans] Gün-bazlı rapor sorgularının yalnız `system_logs` için ifade istatistiği var.**
  `factoryDaySql` 8+ rapor servisinde `rolls."finalizedAt"`, `orders."orderDate"`,
  `orders."cancelledAt"`, `per_conf."createdAt"` üzerinde koşuyor; `pg_statistic_ext` listesinde
  yalnız `sl_day_exact` var. Bugün tablolar küçük; büyümede aynı plan düşüşü (migration
  `20260801050000`'in anlattığı 2,14× yavaşlama) diğer raporlarda tekrar eder.
- **[C / envanter] `initialQty = 0` ile duran 8 top var, 2'si canlı `WAREHOUSE`** (V-5-02'de
  ayrıntılı). Kesim/manuel giriş yollarında "metraj > 0" doğrulaması yok; `cutOpenFabric`'in aşım
  dalı (`tambur.service.ts:2905-2915`) `currentQty` 0 iken bile kesime izin veriyor (bilinçli), ama
  **çocuğun 0 m doğmasını** engelleyen bir kural yok.
- **[I / gözlemlenebilirlik] `LABEL_PRINT_EVENT` 35 kez aynı saniyede birebir aynı yükle iki kez
  yazılmış.** İstemci print-event'i çift ateşliyor; sonucu "kaç etiket basıldı" sayımının şişmesi
  (2.554 olay / 2.431 top). `BULGU-T1-062`'nin ters yönü.
- **[Denetim hijyeni] Prod kopyası 2026-08-25 02:38'den sonra kirli.** 26 `env=development`
  STARTUP, 3 iş emri (IE2508260001/2/3) + 3 parti (P89/P90/P91) + 2 fason sevk, bir migration
  (`20260825120000_color_name_unique_live`) ve ad-mükerrer fixture'ları. **Ardışık-yaratım,
  eşzamanlılık ve kısıt ölçümü yapan HER denetçi bu kesimi uygulamalı** — uygulamayan
  "prod'da renk seddi var" (yanlış) ya da "prod'da plan sapması oldu" (yanlış) sonucuna varır;
  ikisini de bu turda ölçtüm ve düzelttim.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **Canlı prod'a erişim yok.** Tüm ölçümler 2026-08-25 yedeğinin macOS'a geri yüklenmiş kopyası
   üzerinde. 2026-08-25'ten bugüne (3 gün) olan veri kapsam dışı.
2. **Prod'un gerçek collation/ICU sürümü ölçülemez.** Kopya macOS PG 18.6'da duruyor;
   `datcollversion` (153.128) ve `tr_sort` `collversion` (153.128.47) **restore edildiği makinenin**
   değerleri. Prod Windows PG 16.9'da farklı bir ICU sürümü çalışıyor ve **bir PG/OS yükseltmesinde
   text index'lerin sessizce bozulma riski** (`datcollversion` uyuşmazlığı) hiçbir yerde
   kontrol edilmiyor (`grep -rniE 'collversion|REFRESH COLLATION'` → repoda 0 vuruş). Bunu bulgu
   yazmadım çünkü prod değerini ölçemeden failure_mode somutlanamıyor — **ölçüm talebi olarak
   bırakıyorum**: prod'da `SELECT datname, datcollversion FROM pg_database;` ve
   `SELECT collname, collversion FROM pg_collation WHERE collnamespace='public'::regnamespace;`.
3. **`teks.audit_guard` prod'da açık mı ölçülemedi** (`pg_db_role_setting` restore edilen DB için
   boş; `current_setting('teks.audit_guard', true)` NULL). Tur 1 çürütücüsünün aynı tespiti geçerli.
4. **`kk1.duplicateGuardEnabled`'in tetiklenme sayısı doğrudan ölçülemez** — bulgu V-5-01'in
   ta kendisi. 13 çift bir **alt sınır** tahminidir: guard 409 verdiğinde ikinci kayıt
   `confirmDuplicate` ile YAZILDIYSA veride görünür; operatör vazgeçtiyse **hiç iz kalmaz**,
   yani gerçek sayı 13'ten büyüktür.
5. **`morgan` erişim log'u** stdout'a yazıyor ve pm2 log dosyaları repo dışında; 4xx'in orada
   görünüp görünmediği (ve rotasyon/saklama süresi) doğrulanamadı.
6. **Repro (K3) yapılmadı** — bu tur salt-okunur veri madenciliğidir; eşzamanlı repro yükümlülüğü
   D-A/D-B alanlarına aittir.
7. **Dev DB'nin test kalıntısı** bazı dev sayılarını (parti biçimi, `stations` mükerreri, barkod
   boşlukları) gürültülü kılıyor; dev sayıları yalnız **karşılaştırma** için kullanıldı, ihlal
   iddiası hep saha üzerinden kuruldu.
