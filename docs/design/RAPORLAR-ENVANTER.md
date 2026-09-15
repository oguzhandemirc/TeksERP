# Raporlar — bugünkü envanter (ölçüm **2026-09-15**)

> **Durum: ÖLÇÜM — kod yok, öneri yok.** Raporlar fazının ön ölçümüdür (kullanıcı isteği 2026-09-14 19:20: *süperadmin hangi raporun fabrikaya açık olduğunu belirler · kolay anlaşılır ekran · Excel + PDF çıktı · tarih ve sunucu süzgeçleri*). Plan ve dağıtım yöneticide (1e); bu belge yalnız **bugün ne var** sorusunu cevaplar.
>
> **Yöntem:** iki paralel ajan taraması (backend `routes/reports/**` · panel `Electron/src/pages/Reports/**`) + sayıların kendi greplerimle ÇAPRAZ ölçümü. Ajan beyanı tek başına kanıt sayılmadı: uç sayısı (29), rapor katmanında Excel/PDF izi (0), dokuma sayfalarında çıktı (0), kök `reports` route'unda izin (yok) ve `ReportExportBar` render yüzeyi (29 dosya) elle doğrulandı.
>
> **Ölçülen ağaç:** `wt-5e6`, taban `dc34c4e3`.

## 0 · Yöneticiye özet

- **29 rapor ucu · 29 panel yaprak ekranı · 10 hub ekranı.** Eşleşme 1:1 DEĞİL: `batch-search` + `batch-trace` tek ekranı besler, `finance/statement` yaprak değil DİYALOG, buna karşılık iki panel ekranı (`Çek Vade Takvimi`, `Karne Listesi ve Mühür`) `/api/reports/*` altında OLMAYAN uçlardan beslenir. "Rapor" kümesinin sınırı bugün yüzeyde çizilidir, adreste değil.
- **Excel + PDF ZATEN VAR ama backend'de DEĞİL:** 29 ucun 29'u JSON döner (`exceljs`/`xlsx`/`pdfkit`/`Content-Disposition` eşleşmesi SIFIR, bağımlılık bile yok). Çıktı tamamen PANELDE üretilir (`Reports/_components/reportExport.ts` → tek spec, üç çıkış: Excel `exceljs` dinamik import · PDF Electron `printToPDF` · Yazdır izole iframe).
- **25 yaprak ekranın 25'inde Excel+PDF+Yazdır var; 4'ünde HİÇ YOK ve dördü de DOKUMA** (Randıman · Duruş Pareto · Vardiya Karnesi · Karne Listesi). Fazın "Excel + PDF" isteği bu dördü ve gelecek raporlar için geçerlidir; kalan 25 için iş "kurmak" değil "korumak".
- **PDF yüzeyi Electron'a bağlı:** `window.api.pdf` yoksa düğme ÇİZİLMEZ. Panel bugün hep Electron olduğu için görünmez; web yüzeyi gelirse 25 ekranın PDF'i sessizce 0'a düşer.
- **Görünürlük bugün İKİ katmanlı: izin (8 kod) + modül bayrağı (route'ta).** Rapor BAŞINA anahtar YOKTUR. Süperadmin bugün "Dokuma raporlarını kapat" diyebilir (modül), "Fire Karnesini kapat" diyemez.
- **Kapı dağılımı asimetrik:** 29 ucun yalnız **8'i** modül kapılı (finance 5 · dokuma 3, ikisi de `router.use`), **21'i kapısız** — yalnız izinle korunur. Panelde ise `ROUTE_MODULE` yolun ilk iki segmentinden çözüldüğü için **16 yaprak** modül kapısına tabi (production 4 · quality 3 · finance 5 · dokuma 4) ⇒ **panel ile backend'in kapı kümesi AYRIŞIK** (panelde kapılı olan 16, backend'de kapılı olan 8).
- **Kök `reports` hub'ı izinsiz:** tek `ProtectedRoute`'suz rapor route'u; karo süzgeci `isAdmin || !t.permission || hasPermission(...)` ile kısa devre yapar. Yaprakların izni karoda değil ROUTE'tadır (29/29).
- **Tarih ekseni DÖRT ayrı ad taşıyor:** `dateFrom`/`dateTo` (19 uç) · `from`/`to` (2, dokuma) · `factoryDay` (1) · `asOf` (1 kesit). 6 uçta tarih hiç yok. Tek tip "tarih süzgeci" isteniyorsa önce bu sözleşme birleştirilmeli.
- ~~**"Sunucu süzgeci" bugün YOK**~~ **DÜŞTÜ (K10, 2026-09-15):** kullanıcının sözü *"tarih ve çeşitli filtreler"*ti; **tek DB = tek kurulum** olduğu için `installationId` bir süzgeç ekseni DEĞİLDİR (o eksen keşif/cihaz tarafının işi). Benim ilk okumam isteği fazla okumuştu. Doğru soru "hangi doğal eksenler eksik" — ölçümü **§7**.

## 1 · Sayılar (hepsi ölçüldü)

| Ölçü | Değer | Nereden |
|---|---|---|
| Rapor ucu | **29** (hepsi GET) | `grep -c "router.get(" src/routes/reports/*.ts` |
| Modül kapılı uç | **8** (finance 5 · dokuma 3) | `router.use(verifyToken, requireXEnabled)` |
| Kapısız uç | **21** | 29 − 8 |
| Tarih süzgeçli uç | **23** · tarihsiz **6** | Zod şemaları |
| Excel/PDF üreten uç | **0** | `exceljs\|xlsx\|pdfkit\|Content-Disposition` → 0 |
| Panel yaprak rapor ekranı | **29** | 9 kategori `tile-config.ts` toplamı |
| Panel hub ekranı | **10** | kök + 9 kategori |
| Excel + PDF + Yazdır'ı olan yaprak | **25** | `<ReportExportBar` render yüzeyi |
| Çıktısı HİÇ olmayan yaprak | **4** (dokuma) | `grep -rl "<ReportExportBar" Reports/Dokuma` → 0 |
| `ReportExportBar`ın Reports DIŞI kullanımı | **4 yüzey** (çek bordrosu · çekler · iki ekstre diyaloğu) | 29 render dosyasının 25'i Reports/ yaprağı |
| Dönem karşılaştırmalı (`showCompare`) ekran | **9** | karne ailesi |
| Bayrağı olan KARO | **4 / 39** (hepsi kategori karosunda) | yaprak karoda bayrak alanı YOK |
| Modül kapısının fiilen vurduğu yaprak | **16** | `ROUTE_MODULE` iki segmentten çözer |
| Rapor izni | **8 kod** (`report:finance/production/sales/quality/inventory/subcontract/customer/audit`) | `permission-catalog.ts` |
| `SCREEN_CATALOG` rapor satırı | **9** | `key: "reports/*"` |

## 2 · Envanter — 29 rapor

**Sınıf ölçütü (BEYANLI, benim ölçütüm):** **BASİT** = tek süzgeç ekseni (tarih ya da hiç) **ve** türetilmiş oran/karşılaştırma yok — operatör ek eğitim istemez. **GELİŞMİŞ** = şunlardan en az biri: ikinci bir süzgeç ekseni · dönem karşılaştırma · oran/karne terimi (randıman, fire oranı, yaşlandırma kovası) · mühür/dönem kavramı. Ölçüt yanlışlanabilir: bir raporun sınıfı, satırındaki süzgeç ve çıktı kolonlarından TÜRETİLİR, kanaatle değil.

| # | Rapor | Uç | Panel sayfası | Süzgeçler | Çıktı | Kapı | Sınıf |
|---|---|---|---|---|---|---|---|
| 1 | Nerede Takıldı (WIP) | `production/wip` | `reports/production/wip` | tarih aralığı (30g) | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | BASİT |
| 2 | Parti İzleme | `production/batch-search` + `batch-trace/:id` | `reports/production/batch-trace` | tarih YOK · parti/barkod arama | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | BASİT |
| 3 | Top İzleme | `production/traveler-trace` | `reports/production/traveler-trace` | tarih YOK · barkod arama | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | BASİT |
| 4 | Operatör İş Hacmi | `production/operator-performance` | `…/operator-performance` | tarih aralığı (30g) | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | BASİT |
| 5 | Sipariş İptal Karnesi | `sales/order-cancellation` | `reports/sales/order-cancellation` | tarih aralığı (90g) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 6 | Sipariş → Teslim Süresi | `sales/order-leadtime` | `…/order-leadtime` | tarih aralığı (180g) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 7 | Talep Analizi | `sales/demand-analysis` | `…/demand-analysis` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 8 | Sipariş Karnesi | `sales/order-intake` | `…/order-intake` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 9 | Açık Sipariş Karşılanma | `sales/open-order-coverage` | `…/open-order-coverage` | tarih YOK (kesit) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 10 | Sevk & Termin Karnesi | `sales/shipment-scorecard` | `…/shipment-scorecard` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 11 | İade Karnesi | `sales/return-scorecard` | `…/return-scorecard` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 12 | Kalite Karnesi | `quality/scorecard` | `reports/quality/scorecard` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | GELİŞMİŞ |
| 13 | Fire Karnesi | `quality/scrap-scorecard` | `…/scrap-scorecard` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | GELİŞMİŞ |
| 14 | Plan-Sapma Karnesi | `quality/plan-deviation-scorecard` | `…/plan-deviation-scorecard` | tarih aralığı + karşılaştırma | Excel · PDF · Yazdır | izin + `productionEnabled` (panel) | GELİŞMİŞ |
| 15 | Stok & Ölü Stok | `inventory/scorecard` | `reports/inventory/scorecard` | tarih YOK (kesit) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 16 | Randıman | `dokuma/randiman` | `reports/dokuma/randiman` | tarih aralığı (7g) + makine | **YOK** | izin + `dokumaEnabled` (**iki yanlı**) | GELİŞMİŞ |
| 17 | Duruş Pareto | `dokuma/durus-pareto` | `…/durus-pareto` | tarih aralığı (7g) + makine | **YOK** | izin + `dokumaEnabled` (iki yanlı) | GELİŞMİŞ |
| 18 | Vardiya Karnesi | `dokuma/vardiya-karnesi` | `…/vardiya-karnesi` | **tek gün** (`factoryDay`) + vardiya | **YOK** | izin + `dokumaEnabled` (iki yanlı) | GELİŞMİŞ |
| 19 | Karne Listesi ve Mühür | *(rapor ucu değil)* `GET /api/machine-shift-stats` + mühür uçları | `reports/dokuma/karne` | tarih aralığı (7g) | **YOK** | izin + `dokumaEnabled` (panel) | GELİŞMİŞ (mühür) |
| 20 | Cari Yaşlandırma | `finance/aging` | `reports/finance/aging` | **tek gün kesit** + cari tipi + para birimi + arama | Excel · PDF · Yazdır | izin + `financeEnabled` (iki yanlı) | GELİŞMİŞ |
| 21 | Kasa & Banka Defteri | `finance/cash-book` | `…/cash-book` | tarih aralığı + hesap türü + hesap + pasifler | Excel · PDF · Yazdır | izin + `financeEnabled` (iki yanlı) | GELİŞMİŞ |
| 22 | Çek Vade Takvimi | *(rapor ucu değil)* `GET /api/finance/cheques/due-summary` | `reports/finance/cheque-due` | ileri bakan tarih aralığı (+7/+30/+90) | Excel · PDF · Yazdır | izin + `financeEnabled` (panel) | BASİT |
| 23 | KDV Dönem Özeti | `finance/vat-summary` | `…/vat-summary` | tarih aralığı | Excel · PDF · Yazdır | izin + `financeEnabled` (iki yanlı) | BASİT |
| 24 | Kur Farkı Raporu | `finance/fx-diff` | `…/fx-diff` | tarih aralığı + cari + para birimi | Excel · PDF · Yazdır | izin + `financeEnabled` (iki yanlı) | GELİŞMİŞ |
| 25 | Fason Karnesi | `subcontract/scorecard` | `reports/subcontract/scorecard` | tarih aralığı (90g) + karşılaştırma | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 26 | Müşteri Karnesi | `customer/scorecard` | `reports/customer/scorecard` | tarih aralığı + karşılaştırma + sıralama ekseni | Excel · PDF · Yazdır | yalnız izin | GELİŞMİŞ |
| 27 | Müşteri Sipariş Profili | `customer/order-profile` | `…/order-profile` | tarih YOK (tüm zamanlar) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 28 | Denetim Kaydı Özeti | `audit/system-log-summary` | `reports/audit/system-log-summary` | tarih aralığı (7g) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| 29 | Kullanıcı Aktivitesi | `audit/user-activity` | `…/user-activity` | tarih aralığı (7g) | Excel · PDF · Yazdır | yalnız izin | BASİT |
| — | Cari Ekstre | `finance/statement` | *(yaprak değil — `CariStatementDialog`)* | cari + para birimi (zorunlu) + tarih aralığı | Excel · PDF · Yazdır | izin + `financeEnabled` | GELİŞMİŞ |

**Dağılım (tablodan sayıldı, elle değil):** BASİT **13** · GELİŞMİŞ **16** (biri mühür kavramı taşıdığı için) + tablo dışı 1 diyalog. Çıktısı olmayan 4'ün dördü de GELİŞMİŞ sınıfında — *yani bugün çıktısı olmayan raporlar, çıktıya en çok ihtiyaç duyan sınıftakiler.*

## 3 · Görünürlük bugün nasıl kuruluyor

Dört katman var ve **hiçbiri rapor taneciğinde değil**:

1. **İzin (8 kod)** — `report:*`; kataloğa kodla girer, panele atanır. Yaprak ekranın izni `content-routes.tsx`teki `ProtectedRoute requirePermission`tan gelir (29/29); karo tanımında izin alanı YOKTUR.
2. **Modül bayrağı — BACKEND** — yalnız iki router `router.use(verifyToken, requireXEnabled)` taşır (finance · dokuma) ⇒ 8 uç. Kalan 21 uçta modül kapısı yok.
3. **Modül bayrağı — PANEL** — `ROUTE_MODULE` yolun İLK İKİ segmentinden çözülür, bu yüzden `reports/production|quality|finance|dokuma` altındaki **16 yaprak** kapı altındadır. Backend'le küme AYRIŞIK (8 ↔ 16): panelde kapalı görünen bir rapor backend'de doğrudan çağrılabilir.
4. **`SCREEN_CATALOG`** — 9 rapor satırının her birinde `modul` kolonu VAR, ama değerlerin yarısı gerçek anahtar değil SÖZDE ETİKET: `productionEnabled` · `financeEnabled` · `dokumaEnabled` gerçek bayrak; `cekirdek:siparis-musteri` · `cekirdek:stok-giris` · `cekirdek:sistem-kimlik-belge` · `planlanan:fason` anahtara BAĞLI DEĞİL (repoda 7 sözde etiket, 82 satırda kullanılıyor).

**Süperadmin bugün neyi kapatabilir:** `PATCH /api/feature-flags` → `flagWriteGuard` MODÜL dalı (fail-closed, `.some`, sistem hesabı doğduysa süperadmin şartı). Yani bugünkü tanecik **modüldür**: "Dokuma raporları" kapanır, "Fire Karnesi" kapanmaz.

## 4 · Fazın dört isteği ↔ bugünkü zemin

| İstek | Bugün | Boşluk |
|---|---|---|
| Süperadmin rapor başına açar/kapar | Modül + izin taneciği; rapor başına anahtar YOK; yaprak karoda `featureFlag` alanı bile yok | Rapor kimliği (kanonik `key`) + anahtar deposu + süperadmin yüzeyi + **iki yanlı kapı** (panel karo/route **ve** backend uç) |
| Kolay anlaşılır ekran | 29 yaprak, 12 BASİT / 17 GELİŞMİŞ; hub'lar ortak `ReportHubGrid` | Sınıfın kullanıcıya görünür karşılığı yok (basit/gelişmiş ayrımı bugün yalnız bu belgede) |
| Excel + PDF | 25 yaprakta VAR (panelde üretilir), 4 dokuma yaprağında YOK; PDF Electron'a bağlı | Dokuma dördü + "yeni rapor doğduğunda çıktı zorunlu mu" kuralı + web yüzeyi gelirse PDF'in sessiz düşüşü |
| Tarih + sunucu süzgeçleri | Tarih 23/29 uçta ama DÖRT ayrı eksen adıyla; **sunucu/kurulum süzgeci HİÇ YOK** | Tek tarih sözleşmesi; sunucu ekseni sıfırdan (bugün `installationId` yalnız keşif/cihaz tarafında) |

## 5 · Ölçülmeyenler (beyanlı kör noktalar)

- **Raporların İÇERİK doğruluğu** ölçülmedi — bu envanter yüzey, kapı ve süzgeç sayar; bir raporun sayısının doğru olup olmadığını söylemez.
- **`services/reports/` altındaki 26 dosyanın 5'inin** bir uca bağlı olup olmadığı ölçülmedi (ajan kapsamı dışı bıraktı).
- **Mobil/tablet** tarafında rapor yüzeyi var mı diye BAKILMADI (faz masaüstü raporları hakkında).
- **Kullanım verisi yok:** hangi raporun fabrikada fiilen açıldığı ölçülmedi (`EndpointLatencyDaily` telemetrisi bu soruya cevap verebilir, bu turda okunmadı) ⇒ "hangi rapor gereksiz" sorusu bugün ÖLÇÜLEMEZ, kanaatle cevaplanır.

## 6 · Kullanım ölçümü — **ÖLÇÜLDÜ 2026-09-15** (fabrika yedeği, 57 günlük pencere)

**Sayılar §6.5'te.** Yöntem (§6.1–§6.4) sayı GELMEDEN önce yazıldı ve öyle kaldı — sorgunun ve şerhlerin sonuca göre ayarlanmadığı böyle görünür. Ölçüm, sorguyu fabrika yedeğinde SALT OKUNUR koşan yönetici oturumundan geldi (1e); ham çıktı onda.

### 6.1 · Kaynak ve şekli (koddan ölçüldü)

`EndpointLatencyDaily` (`endpoint_latency_daily`): `@@unique([day, routeKey])` · `count` · `errCount` · `maxMs` · `buckets`. Anahtar **`"<METHOD> <yol>"`** biçimindedir (`latency-persist.service.ts:85`), yol `normalizeKeyPath` ile normalize edilir: UUID / salt sayı / uzun-opak segmentler **`:id`**e çöker (`latency.middleware.ts:32-43`). Yani `GET /api/reports/production/batch-trace/<uuid>` → **`GET /api/reports/production/batch-trace/:id`**.

### 6.2 · Sorgu (fabrika yedeği restore edilmiş bir DB'de, SALT OKUNUR)

```sql
-- 30 ve 90 günlük çağrı sayısı, rapor uçları (+ rapor sayılan iki yabancı uç)
SELECT "routeKey",
       SUM("count") FILTER (WHERE day >= CURRENT_DATE - 30) AS gun30,
       SUM("count") FILTER (WHERE day >= CURRENT_DATE - 90) AS gun90,
       SUM("errCount")                                       AS hata,
       MIN(day) AS ilk_gun, MAX(day) AS son_gun
FROM endpoint_latency_daily
WHERE "routeKey" LIKE 'GET /api/reports/%'
   OR "routeKey" = 'GET /api/finance/cheques/due-summary'   -- Çek Vade Takvimi ekranı
   OR "routeKey" LIKE 'GET /api/machine-shift-stats%'       -- Karne Listesi ve Mühür ekranı
GROUP BY "routeKey"
ORDER BY gun30 DESC NULLS LAST;

-- KÖRLÜK ZEMİNİ — bu iki satır okunmadan yukarıdaki tablo YORUMLANMAZ:
SELECT MIN(day) AS en_eski_gun, MAX(day) AS en_yeni_gun, COUNT(*) AS satir
FROM endpoint_latency_daily;                                   -- pencere gerçekte kaç gün?
SELECT "routeKey", SUM("count") FROM endpoint_latency_daily
WHERE "routeKey" IN ('(diğer)', '(statik/diğer)', '(eşleşmeyen)')
  AND day >= CURRENT_DATE - 90 GROUP BY "routeKey";            -- taşma kovası dolu mu?
```

Koşum: `psql "$DATABASE_URL" -f <dosya>` — `psql` PATH'te olmayabilir (`/opt/homebrew/opt/libpq/bin`). **Demo/sonda veritabanında koşmak anlamsızdır** (çağrılar bekçilerin kendisinden gelir); yalnız fabrikanın gerçek verisi cevap verir.

### 6.3 · Sayıyı BOZAN beş şerh (hepsi koddan ölçüldü)

1. **90 gün, retention'ın TAM KENARI:** `RETENTION_DAYS = 90` ve budayıcı günde bir kez `day < bugün-90` satırlarını siler (`latency-persist.service.ts:34,171`). ⇒ `gun90` bir **ALT SINIRDIR**; gerçek 90 gün, budama koştuysa eksiktir. `gun30` güvenlidir. Pencereyi `MIN(day)` ile ÖLÇMEDEN "90 gün" denmez.
2. **Kardinalite tavanı:** RAM tarafında 500 (`latency-stats.service.ts:28`), kalıcı tarafta 600 anahtar (`latency-persist.service.ts:37`); tavan aşılırsa yeni anahtarlar **`(diğer)`** kovasında birikir. ⇒ Bir raporun **sıfır** görünmesi "hiç açılmadı" DEĞİL, "taşma kovasında" da olabilir. `(diğer)` sayısı okunmadan sıfırlar yorumlanamaz.
3. **Telemetri ufku ≠ raporun yaşı:** satır yalnız o gün sunucu KOŞTUYSA ve bu özet indiğinden beri yazılır. Dokuma raporları 2026-09-14'te indi ⇒ 90 günlük sayıları doğal olarak küçüktür; **sayı yaşla normalize edilmeden raporlar KIYASLANAMAZ.**
4. **Çağrı ≠ kullanıcı:** bir ekran açılışı bir istektir; süzgeç değiştirmek yeni istektir. Çok süzgeçli GELİŞMİŞ raporlar, aynı ilgiyle bile BASİT olanlardan yüksek görünür. "Kaç kişi" sorusunun cevabı burada YOK (audit/`Session` ayrı kaynak).
5. **Paylaşılan uçlar:** `GET /api/machine-shift-stats` yalnız Karne ekranına ait değildir (mühür akışı da çağırır); `finance/statement` hem Cari Ekstre diyaloğundan hem Yaşlandırma satırından açılır. ⇒ Bu iki satır EKRAN kullanımı değil UÇ kullanımı ölçer.

### 6.4 · Bu ölçümün cevaplayamayacağı soru

*"Bu rapor gereksiz mi?"* — düşük sayı, raporun **ayda bir ama kritik** (KDV Dönem Özeti, Kur Farkı) olmasıyla aynı görünür. Kullanım sayısı **kapatma gerekçesi değildir**; yalnız *"önce hangisini iyileştirelim"* sorusunu sıralar. Kapatma kararı fabrikanın beyanıyla alınır — ve zaten fazın kendisi bunu süperadmin anahtarına bağlıyor.

### 6.5 · SAYILAR (ölçüm 2026-09-15 · fabrikanın yedeğinden restore edilmiş YEREL veritabanı, yedek tarihi **2026-09-11**)

**Pencere: 2026-07-16 → 2026-09-11 = 57 gün · 4.910 satır.** ⇒ §6.3①'in "90 gün alt sınırdır" şerhi BURADA SERTLEŞİR: pencere 90 değil **57 gündür**, `gun90` kolonu 90 günü değil *"elde ne varsa onu"* sayar. Taşma kovaları (`(diğer)` · `(statik/diğer)` · `(eşleşmeyen)`) **0 satır** ⇒ §6.3②'nin "sıfır aslında taşmada olabilir" şerhi bu veritabanında DÜŞER: sıfır gerçekten sıfırdır. (`psql`e verirken `DATABASE_URL`den `?schema=` düşürülür.)

| Rapor (bugünkü uç) | 30g | 57g | hata |
|---|---|---|---|
| Denetim Kaydı Özeti (`audit/system-log-summary`) | 18 | 20 | 0 |
| Kullanıcı Aktivitesi (`audit/user-activity`) | 12 | 13 | 0 |
| Müşteri Karnesi (`customer/scorecard`) | 8 | 8 | 0 |
| Stok & Ölü Stok (`inventory/scorecard`) | 7 | 7 | 0 |
| Müşteri Sipariş Profili (`customer/order-profile`) | 7 | 11 | 0 |
| Sevk & Termin Karnesi (`sales/shipment-scorecard`) | 6 | 6 | 0 |
| Nerede Takıldı — WIP (`production/wip`) | 5 | 5 | 0 |
| Kalite Karnesi (`quality/scorecard`) | 5 | 5 | 0 |
| Operatör İş Hacmi (`production/operator-performance`) | 5 | 7 | 0 |
| Fire Karnesi (`quality/scrap-scorecard`) | 3 | 3 | 0 |
| Plan-Sapma Karnesi (`quality/plan-deviation-scorecard`) | 2 | 2 | 0 |
| Parti İzleme — arama (`production/batch-search`) | 2 | 2 | 0 |
| Fason Karnesi (`subcontract/scorecard`) | 2 | 2 | 0 |
| İade Karnesi (`sales/return-scorecard`) | 1 | 1 | 0 |

**Hata sayısı 14 satırın 14'ünde 0** — 57 günde tek 5xx yok.

#### Görülmeyen 15 uç — İKİ AYRI SINIF, karıştırılmaz

| Sınıf | Uçlar | Okuma |
|---|---|---|
| **A · ÖLÇÜLEMEDİ (modül kapalı)** — 8 | `dokuma/randiman` · `dokuma/durus-pareto` · `dokuma/vardiya-karnesi` · `finance/aging` · `finance/cash-book` · `finance/statement` · `finance/vat-summary` · `finance/fx-diff` | Referans fabrikada dokuma ve finans modülleri KAPALI; sıfır "kullanılmıyor" demek DEĞİL, "bu kurulumda hiç açık olmadı" demektir. Aynı gerekçeyle ekran uçları `cheques/due-summary` ve `machine-shift-stats` de 0 satır. |
| **B · AÇIK ama 57 günde HİÇ çağrılmamış** — 7 | `sales/order-cancellation` · `sales/order-leadtime` · `sales/demand-analysis` · `sales/order-intake` · `sales/open-order-coverage` · `production/batch-trace/:id` · `production/traveler-trace` | Modülü açık, izni dağıtılmış, çağrısı **sıfır**. Sipariş ailesinin BEŞİ birden burada — envanterdeki yedi `sales` raporunun beşi hiç açılmamış. |

⚠️ `batch-search` 2 çağrı almış ama `batch-trace/:id` **0**: arama yapılmış, sonuca GİRİLMEMİŞ. Tek başına bir raporun "açıldı" sayısı, *işe yaradı* demek değildir — iki adımlı raporlarda ikinci adım ayrı ölçülür.

#### ⚠️ Telemetri KODU AŞIYOR: 9 ÖLÜ anahtar

Çıktıdaki 23 satırın **9'u bugün kodda OLMAYAN** uçlara ait (ölçüldü: `grep` → 0 eşleşme, `src/routes` + `src/services`): `sales/order-fulfillment` (6) · `production/station-efficiency` (8) · `inventory/stock-distribution` (3) · `production/scrap` (1) · `inventory/movements` (1) · `sales/late-delivery` (1) · `customer/alias-stats` (2) · `inventory/roll-aging` (3) · `quality/defect-distribution` (2). Dokuzunun da 30 günlük sayısı 0, 57 günlüğü dolu ⇒ bunlar pencerenin BAŞINDA yaşayan, sonra kaldırılan/yeniden adlandırılan uçlar.

⇒ **Ders: bu tablo "bugünkü uçların kullanımı" değil, "pencere boyunca ÇAĞRILMIŞ anahtarlar"dır.** Envanterle eşlemeden okunursa iki yönlü yanılır: ölü anahtar CANLI rapor sanılır *(23 satırın 9'u)* ve bugünkü uçların kaçının görüldüğü şişer. Doğru sayı: **bugünkü 29 ucun 14'ü görüldü, 15'i görülmedi** (8'i ölçülemez sınıfında). *Telemetri satırı koddan uzun yaşar; kimliği koda karşı doğrulanmadan yorumlanmaz.*

> **Doğrulandı (2026-09-15):** ham çıktıdaki anahtar TAM — `GET /api/reports/quality/plan-deviation-scorecard` (2|2). Onuncu ölü anahtar YOK; **görülen 14 sayısı ayakta.** (Şerh burada duruyor ki sayının nasıl kapandığı görünsün: açık soru, ham kaynağa geri okutularak kapandı — beyanla değil.)

### 6.6 · Sayının SÖYLEDİĞİ ve SÖYLEMEDİĞİ

- **En çok kullanılan iki rapor DENETİM raporları** (18 ve 12) — iş raporlarının hepsi tekli hanelerde. Bu bir kullanım sıralaması değil, bir KULLANICI sıralamasıdır: denetim raporlarını yönetici/geliştirici açar, iş raporlarını fabrika açar. ⇒ *"Rapor ekranını fabrika neredeyse hiç kullanmıyor"* okuması bu veriyle uyumludur ve fazın gerekçesidir.
- **Faz "kullanılmayanı kapat" değildir.** Sıfırların 8'i ölçülemez (modül kapalı), 7'si açık-ama-çağrılmamış ve hepsinin ortak özelliği ÇIKTI/SÜZGEÇ eksikliği değil — beşi sipariş ailesinden, hepsinin Excel+PDF'i VAR. ⇒ Kullanılmama sebebi çıktı değil; **ekranın bulunabilirliği ve anlaşılırlığı** (§4'ün "kolay anlaşılır ekran" isteği) ya da raporun fabrikanın sorusuna cevap vermemesi. Bu ayrım ölçülmedi — kullanıcıya SORULUR, telemetriden çıkarılmaz.
- **Düşük sayı kapatma gerekçesi değildir** (§6.4 hükmü ayakta): KDV Dönem Özeti ve Kur Farkı bu pencerede hiç açılmadı ama ikisi de modül kapalı olduğu için ölçülemedi — açık olsalar ayda bir açılırlardı ve yine "düşük" görünürlerdi.

## 7 · Süzgeç ekseni envanteri (ölçüm **2026-09-15**, R5a)

**Yöntem:** backend Zod şemaları (uç başına kabul edilen parametreler) + panel sayfalarının fiilen GÖNDERDİĞİ parametreler + istemci tarafında süzme/sıralama izi (`\.filter\(` · `toLowerCase` · `lowerTr`). "Eksik doğal eksen" kolonu bir İSTEK değil ADAYDIR: raporun kendi satırında zaten var olan bir kırılımı süzgeç yapmak mümkün mü diye sorar.

### 7.1 · Bugünkü eksenler

| Rapor ailesi | Bugünkü eksen(ler) | Nerede süzülüyor | Tanınmayan anahtar 400 mü | Eksik doğal eksen (aday) |
|---|---|---|---|---|
| **Dokuma** (randıman · pareto) | tarih aralığı (fabrika günü) | sunucu | ✅ `.strict()` | **makine** (⚠️ yarı kurulu — aşağı bak) · vardiya tanımı · kayıp sınıfı (pareto) · kaynak (ölçülen/elle/simüle) · **levent/lot** (⑤) |
| **Dokuma** (vardiya karnesi) | tek gün | sunucu | ✅ `.strict()` | **vardiya tanımı** (⚠️ yarı kurulu) · makine |
| **Dokuma** (karne listesi) | tarih aralığı | sunucu | ✅ `.strict()` (liste ucu) | makine · vardiya · mühür durumu (anlık/mühürlü) · **levent/lot** (⑤) |
| **Kalite** (kalite · fire · plan-sapma) | tarih aralığı + dönem karşılaştırma | sunucu | ✅ `compareRangeSchema.strict()` | istasyon/makine · kalite sınıfı · ürün/renk · operatör · **levent/lot** (⑤) |
| **Üretim** (WIP · operatör) | tarih aralığı | sunucu | ✅ `dateRangeSchema.strict()` · ⚠️ `limit` ayrı `.catch(50)` — hatalı değer 400 değil SESSİZ varsayılan | istasyon · iş emri tipi · operatör (karnenin kendi ekseni, süzgeç değil) |
| **Üretim** (parti izleme · top izleme) | arama kutusu (parti no / barkod) | sunucu (arama ucu) | ❌ parti arama Zod'suz (`typeof q === "string"`), `:batchId` doğrulanmıyor; top izleme `traceSchema` **strict DEĞİL** | — (kesit raporu, tarih eksenli değil) |
| **Sipariş & Sevkiyat** (7 rapor) | tarih aralığı (+ 5'inde karşılaştırma) | sunucu | ✅ `compareRangeSchema`/`dateRangeSchema` `.strict()` · açık sipariş karşılanmada şema YOK | **müşteri/cari** · ürün · şube · sevk hedefi (yurtiçi/yurtdışı) · birim (metre/kg/adet) |
| **Stok & Depo** (stok karnesi) | yok (kesit) | — | ❌ şema YOK (`_req`) — anahtar sessizce yok sayılır | **depo** · ürün/renk · kalite sınıfı · yaş kovası |
| **Fason** (fason karnesi) | tarih aralığı + karşılaştırma | sunucu | ✅ `.strict()` | **fasoncu** (satır ekseni, süzgeç değil) · işlem türü |
| **Müşteri** (karne) | tarih aralığı + karşılaştırma + **sıralama ekseni** | sunucu (veri) · **istemci (sıralama)** | ✅ `.strict()` | müşteri grubu/şube · ürün |
| **Müşteri** (sipariş profili) | yok (tüm zamanlar) | — | ❌ şema YOK (`_req`) | tarih · müşteri |
| **Ön Muhasebe** (yaşlandırma) | kesit tarihi + cari tipi + para birimi + **arama** | sunucu (üçü) · **istemci (arama)** | ✅ `.strict()` (`dateFrom/dateTo` BİLEREK reddedilir — kesit raporu) | şube · vade kovası · sorumlu |
| **Ön Muhasebe** (kasa defteri) | tarih aralığı + hesap türü + hesap + pasifler | sunucu | ✅ `.strict()` | para birimi (ekranda gruplama olarak var) |
| **Ön Muhasebe** (çek vade) | ileri tarih aralığı (+7/+30/+90) | sunucu | ⚠️ rapor ucu değil (`finance/cheques/due-summary`) — bu turda ölçülmedi | banka · cari · durum |
| **Ön Muhasebe** (KDV · kur farkı) | tarih aralığı (+ kur farkında cari · para birimi) | sunucu | ✅ `.strict()` | KDV oranı (kovaları var, süzgeç yok) |
| **Denetim** (2 rapor) | tarih aralığı | sunucu | ✅ `dateRangeSchema.strict()` | kullanıcı · tablo/işlem türü |

### 7.2 · Üç ölçülmüş bulgu

**① YARI KURULU EKSEN — backend ve panel TİPİNDE var, hiçbir ekran göndermiyor.** `machineId` üç dokuma ucunun ikisinde Zod şemasında kabul ediliyor ve panel servis tipinde de duruyor (`Dokuma/service.ts` `RangeParams.machineId?`); `shiftDefinitionId` aynı şekilde vardiya karnesinde (`shiftScorecard(p: { factoryDay; shiftDefinitionId? })`). **Hiçbir sayfa bu alanları doldurmuyor** — yani eksen sunucuda hazır, istemcide tipiyle duruyor, kullanıcıya hiç görünmüyor. ⇒ Bu üç eksen fazın EN UCUZ kalemidir: backend dokunuşu sıfır, panelde bir seçici.

**② İSTEMCİ TARAFI SÜZME YALNIZ İKİ YERDE, ikisi de beyanlı.** Yaşlandırmada cari adı/kodu araması ekranda süzülüyor (`rows.filter(matches)`) ve sayfa bunu kâğıda da yazıyor (*"Ekranda … araması uygulanıyor"*); müşteri karnesinde sıralama ekseni istemcide (sunucu `totalQty` sırasıyla gönderiyor). Kasa defterindeki para birimi ayrımı süzgeç değil SUNUM gruplamasıdır. Kalan her şey sunucuda süzülüyor — `filtre-liste.md`'nin "cursor'lu listede süzme SUNUCUDA" kuralıyla çelişen bir yer ÇIKMADI.
⚠️ Şerh: istemci araması ancak EKRANA GELEN satırı süzer. Yaşlandırma bugün tümünü çekiyor; uç kırpmaya başlarsa (`detail` kipi büyürse) arama sessizce yarım sonuç verir — bu, süzgeç fazında karar gerektiren tek risk.

**③ TARİH EKSENİ DÖRT AD TAŞIYOR** (§1'de sayıldı: `dateFrom/dateTo` 19 · `from/to` 2 · `factoryDay` 1 · `asOf` 1) ve ikisi TEK GÜN, biri KESİT, biri ARALIK semantiğinde. Ortak bir süzgeç bileşeni gelecekse önce bu dört adın SÖZLEŞMESİ birleşmeli; aksi hâlde ortak bileşen dört ayrı özel durum taşır ve her yeni rapor beşinciyi ekler.

**④ FAIL-CLOSED ZEMİNİ ASİMETRİK** (dördüncü kolonun özeti): 29 ucun **23'ü** tanınmayan süzgeç anahtarını 400 ile reddediyor (`dateRangeSchema` · `compareRangeSchema` · dokuma üçlüsü · finans beşlisi, hepsi `.strict()`). **Altısı reddetmiyor** ve iki ayrı sebeple: ① şema HİÇ yok — `inventory/scorecard` · `customer/order-profile` · `sales/open-order-coverage` (`_req`, parametre okunmaz) · `production/batch-search` (elle `typeof`) ve `batch-trace/:batchId` (doğrulama yok) · ② şema var ama gevşek — `traveler-trace` `traceSchema` `.strict()` DEĞİL. Ayrıca `production/operator-performance`in `limit` parametresi `.catch(50)` taşıyor: hatalı değer 400 değil SESSİZ VARSAYILAN üretir.
⇒ **R5b'nin kuralı bu zemine oturur:** yeni bir eksen eklenirken uç `.strict()` değilse, yanlış yazılmış süzgeç adı sessizce YOK SAYILIR ve kullanıcı "süzgeç çalışmıyor" diye değil "rapor yanlış" diye şikâyet eder. Eksen eklenen her uç ÖNCE strict'e çekilir.

**⑤ YENİ DOĞAL EKSEN — LEVENT / LOT (1e hükmü, 6e önerisi; R5b'de 6e yazacak).** Faz 4 ile top → levent bağı deftere girdi (`WarpBeamEvent.CONSUMED.rollId`), levent → lot bağı Faz 2'de vardı (`YarnMovement.lotId`) ⇒ **top → levent → lot → tedarikçi zinciri DEFTERDEN türetilebilir**. Bu, dokuma ve kalite raporları için bugün var olmayan bir eksen açar: *"şu leventten çıkan topların fire oranı"* · *"şu iplik lotunun randımanı"* · *"şu tedarikçinin lotlarında kopuş sıklığı"*. Süzgeç anahtarı `warpBeamId` / `lotNo`, süzme SUNUCUDA (`readIdCondition`/`readFilterList` — CSV de string'dir), uç `.strict()` olmalı (④). Bu satır §7.1'in "eksik doğal eksen" kolonuna dokuma ve kalite ailelerinde EKLENİR ve R5b'nin kapsamıdır.

### 7.3 · Bu envanterin söylemediği

Hangi eksenin **istendiği** ölçülmedi — tablo yalnız *mümkün* olanı sayar. "Eksik doğal eksen" sütunu raporun kendi satırındaki kırılımdan türetildi (satırda makine varsa makine süzgeci mümkündür), fabrikanın sorusundan değil. Sıralama kullanıcıya SORULUR; kullanım verisi (§6.5) burada yol göstermez çünkü bir eksenin yokluğu kullanımı düşürür ama telemetriye "eksik eksen" diye yansımaz.

## 8 · Ekran anlaşılırlığı — özet şeridi · soru cümlesi · katalog ayniyeti (ölçüm **2026-09-15**, R6)

**Yöntem:** yaprak rapor route'u → sayfa dosyası; üç ölçüm — ① özet şeridi (`<MetricCard`) tablodan ÖNCE mi ② sayfa bir açıklama cümlesi (`description=`) taşıyor mu ③ hub karosunun başlığı `REPORT_CATALOG.baslik` ile birebir mi (kategori başına okunur). Katalog `Teks-Erp/src/constants/report-catalog.ts` + panel aynası `lib/report-catalog.ts` (d9, R0).

| Ölçüm | Sonuç |
|---|---|
| Yaprak sayfa | **29** (katalog girdisi 30 — fazlası `finance/statement` diyaloğu, yaprak değil) |
| Özet şeridi tablodan ÖNCE | **25** |
| Özet şeridi TABLODAN SONRA | **0** — sıra kusuru yok |
| Özet şeridi HİÇ YOK | **4** (adları aşağıda) |
| Açıklama cümlesi (`description=`) | **29 / 29** |
| Karo başlığı ↔ katalog `baslik` | **29 / 29 birebir** |
| Katalogda karşılığı olmayan yaprak | **0** |

~~**Özet şeridi olmayan dört yaprak:**~~ **KAPANDI 2026-09-15 (R6 uygulaması, 5e):** dördüne de özet şeridi indi ve artık **29/29** yaprak şerit taşıyor, hepsi tablodan önce; kapı `reportSummaryCoverage.test.ts`. Eski liste: `production/traveler-trace` · `dokuma/vardiya-karnesi` · `dokuma/karne` · `finance/cheque-due`. Dördü de "önce rakam, sonra tablo" kalıbının dışında: ilki tek topun izini (özetlenecek toplam yok), ikisi vardiya kartlarıyla açılıyor, sonuncusu takvim kovalarıyla. ⇒ **"Eksik" sayılırlar ama ekleme işi bu ölçümün DEĞİL R6 uygulamasının (01) kalemidir** — hangisine hangi özetin konacağı rapor rapor karardır, tek kalıp dayatmak yanlış sayı üretir.

⚠️ **`soru` ile karo açıklaması BİREBİR DEĞİL ve olması da beklenmez** (29/29 farklı): katalog `soru` alanı *"bu rapor NEYİ cevaplar"* tek cümlesidir (ör. `production/wip` → *"Yarı mamul şu an hangi adımda bekliyor ve ne kadar süredir orada?"*), karo açıklaması ise raporun İÇERİĞİNİ tarif eder (*"Metraj ağırlıklı 1./2. kalite oranı — kumaş, renk, fason kırılımıyla"*). İkisi farklı işler yapar. **Bu kolonda ölçülen tek şey ayniyet değil ÇELİŞKİ olurdu — ve çelişki mekanik ölçülemez** (iki Türkçe cümlenin aynı şeyi söyleyip söylemediği); bu yüzden §8 ayniyeti RAPORLAR, uyumu iddia ETMEZ. ~~Kapanır: soru cümleleri ekranın başlığında da gösterilirse ayniyet ölçülebilir hâle gelir.~~ **KAPANDI 2026-09-15:** soru cümlesi artık ekranda, başlığın altında ve **tek yerden** basılıyor (`ReportPageLayout`, anahtar ADRESTEN türer — 29 sayfaya prop eklemek 29 unutma fırsatıdır). Ekran metni katalogdan geldiği için ayniyet artık YAPISAL: sayfa kendi cümlesini yazarsa kapı kırmızı verir (`reportSummaryCoverage.test.ts` §4).

⚠️ **Ölçüm aracının kendi kusuru ve düzeltmesi** (kayda değer, çünkü sayı ÜRETMİŞTİ): ilk koşumda üç rapor *"karo başlığı FARKLI"* çıktı ve üçü de "Müşteri Karnesi" diyordu. Sebep: dört kategoride de `key: "scorecard"` var; tile-config dosyalarını TEK METNE toplayınca ilk eşleşme kazanıyordu. Kategori başına okunca fark **0**'a indi. *Sınırsız eşleşme sınıfı: sınırını beyan etmeyen yüklem alakasızla eşleşir — ve bu kez ölçümün kendisinde oldu.*

## 9 · Faz sonrası durum — "önce → sonra" (ölçüm **2026-09-15**, kapanış; 6e)

**Yöntem:** §0/§1'deki her sayı AYNI yöntemle (grep, kaynak komutu tabloda) yeniden ölçüldü; bir koşumun çıktısından kapsam iddiası türetilmedi (popülasyonu statik tarama sayar). Ölçülen ağaç: origin/main **`3bba3840`** (#154 `meta.secenekler` · #155 panel rapor kapısı · #156 G3t indikten sonraki ikinci koşum; ilk koşum `792b364b`de yapıldı, farkı yalnız "kodda değil" satırlarıydı). Komutlar kökten koşulur; `R=Teks-Erp/src/routes/reports`, `E=Electron/src/pages/Reports`.

| Ölçü | Faz ÖNCESİ (§0/§1, `dc34c4e3`) | Faz SONRASI (`3bba3840`) | Kaynak komut |
|---|---|---|---|
| Rapor ucu (GET) | 29 | **29** (uç eklenmedi/kaldırılmadı) | `cat $R/*.ts \| grep -c 'router.get('` |
| Rapor BAŞINA kapı taşıyan uç (K4, `requireReportOpen(key)`) | **0** (rapor başına anahtar YOKTU; yalnız izin + modül) | **29 / 29** handler, **28** ayrı anahtar (`production/batch-trace` iki taşıyıcı: batch-search + batch-trace) | `grep -oh 'reportGate("[^"]*"\|requireReportOpen("[^"]*"' $R/*.ts \| wc -l` · `… \| sed 's/.*("//' \| sort -u \| wc -l` |
| Modül kapılı uç (`router.use(verifyToken, requireXEnabled)`) | 8 (finance 5 · dokuma 3) | **8** — değişmedi; rapor kapısı modül kapısının ARDINA per-`get` eklendi | `grep -h 'router.use(verifyToken, require' $R/*.ts` → 2 dosya |
| Rapor kataloğu girdisi (K1 `REPORT_CATALOG`) | — (katalog yoktu; 9 `SCREEN_CATALOG` satırı) | **30** = 29 yaprak + `finance/statement` diyaloğu; panel aynası **30** (bayt bayt, `test_rapor_katalogu`) | `grep -c '{ key: "' Teks-Erp/src/constants/report-catalog.ts` · `Electron/src/lib/report-catalog.ts` |
| Süperadmin rapor anahtarı (K2/K3 `reports.closedKeys`) | YOK ("Fire Karnesini kapat" denemezdi) | **VAR:** okuyucu `readReportsClosedKeys` (cache'siz, fail-closed `olculemedi`), yazma `PATCH /api/feature-flags` `reportsClosedKeys` (bilinmeyen anahtar 400 `REPORT_KEY_UNKNOWN`), süperadmin-only listede | `grep -c 'export async function readReportsClosedKeys' …/system-setting.service.ts` · `grep -c reportsClosedKeys …/feature-flag.routes.ts` (3) |
| Panelde rapor kapısı (K5: kapalı rapor karoda/rotada/palette) | modül kapısı 16 yaprak; rapor başına 0 | **30 / 30 anahtar, ÜÇ yol tek yüklemden:** `lib/report-gate.ts` `isReportOpenWith` (fail-closed: liste `null` → HİÇBİRİ açık değil; katalog dışı anahtar kapalı) — karo (`ReportsHubPage` `categoryHasOpenReport`, kategori grid) · route (`ProtectedRoute` `reportKeyOfPath` → her `/reports/<kategori>/<rapor>` yolu, 29 yaprak) · palet (`command-entries.reports`) + yan ray (`ReportSideRail`); süperadmin yazma yüzeyi `ModuleProfile/ReportVisibilitySection`; test `report-gate.test` 6 + `ReportsHub.gate.test` 6 | `grep -rl 'closedKeys\|reportsClosedKeys\|REPORT_DISABLED' Electron/src --include='*.ts*' \| grep -v lib/report-catalog.ts \| wc -l` (19 dosya) · `grep -n isReportOpen Electron/src/components/ProtectedRoute.tsx` |
| Excel + PDF + Yazdır olan yaprak (K8 `ReportExportBar`) | 25 / 29 (dokuma 4'ünde YOK) | **29 / 29** yaprak (+ ekstre diyaloğu = 30 dosya); dokuma **4 / 4** | `grep -rl '<ReportExportBar' $E --include='*.tsx' \| grep -v _components \| wc -l` (30) · `… $E/Dokuma` (4) |
| Tarih ekseni tek bileşen (R4 `ReportDateFilter`) | dört ad, bileşen yok; her sayfa kendi seçicisini kuruyordu | **30 / 30** sayfa `ReportPageLayout reportKey=` üzerinden (9'u ayrıca doğrudan: dokuma 3 + finans 6 — tek gün/kesit/ileri pencere kipleri); URL adları DEĞİŞMEDİ (K7: `dateFrom/dateTo` 19+ · `from/to` 2 · `factoryDay` 1 · `asOf` 1) — birleşme bileşende, sözleşmede değil | `grep -rl 'reportKey=' $E --include='*.tsx' \| grep -v _components \| wc -l` · `grep -rl ReportDateFilter …` |
| Süzgeç ekseni (tarih dışı) olan uç (R5b) | 4 (dokuma `machineId`/`shiftDefinitionId` yarı kurulu · finans aging/cash-book kendi süzgeçleri; §7.1) | **18 / 29:** dokuma 3 (`machineId` · `shiftDefinitionId` · `warpBeamId` · `lotNo`) · kalite 2 (`warpBeamId` · `lotNo`) · sipariş 5 + müşteri 2 (`customerId` · `destination` · `itemId` · `colorId` · `reasonCode`) · fason 1 (`subcontractorId` · `itemId` · `colorId`) · finans 5 (`cariId` · `kind` · `currency` · `onlyOverdue` · `accountId` · `accountKind` · `kategori` · `yon` · `oran` · `belgeTipi`); eksensiz 11 = sevk/iade karnesi 2 · plan-sapma 1 · üretim 5 (2'si kesit/arama) · stok 1 · denetim 2 | `for f in $R/*.ts; do grep -oh '\b(customerId\|itemId\|…)\b' $f \| sort -u; done` (anahtar listesi §7.1'den) |
| Tanınmayan süzgeç anahtarı 400 (R5a ④) | 23 / 29 | **29 / 29** (`test_rapor_strict` §1 statik) | `npx tsx scripts/test_rapor_strict.ts` |
| Seçici kaynağı (çıkışsız kapı sınıfı: liste uçları kendi iznini ister) | — | dokuma 3 `meta.leventler` · satış 5 + müşteri 2 + fason 1 = **8 / 8** `meta.secenekler` (süzgeçten bağımsız, ≤200/eksen; süzgeçli istek ×2 beyanlı) | `grep -c leventler $R/dokuma.report.routes.ts` · `grep -o 'splitOptions(await\|meta: { secenekler }' $R/{sales,customer,subcontract}.routes.ts \| wc -l` (8) |
| Özet şeridi tablodan önce (R6) | 25 / 29 | **29 / 29** (`reportSummaryCoverage.test.ts`) | `grep -rl '<MetricCard' $E --include='*.tsx' \| grep -v _components \| wc -l` (29) |
| `soru` cümlesi (K9) | — | **30 / 30** katalog girdisi dolu; sayfa başlığı `ReportPageLayout` katalogdan okur | `grep -c 'soru: "[^"]' …/report-catalog.ts` |
| Bekçi (rapor fazı) | 1 (`test_reports`) | backend **8** (`test_rapor_strict` · `test_rapor_kapisi` · `test_rapor_katalogu` · `test_rapor_levent_ekseni` · `test_rapor_satis_ekseni` · `test_finans_rapor_eksenleri` · `test_report_day_boundary` · `test_reports`) · panel `_components` **6** vitest | `ls Teks-Erp/scripts \| grep -c 'test_rapor_\|test_finans_rapor\|test_report'` |

**Kodda değil (bu ölçüm anında, `3bba3840`):** ① panel çoklu seçici R5b-c(a) (5e, #157'de) ve (b) (yazılıyor) — backend kaynağı (`meta.secenekler`) hazır, panel seçicisi yok · ② finans cari ekseni R5b-d-b (d9) · ③ `finance/statement` diyaloğuna rapor düğmesi (d5). Faz bitince §9'a ikinci geçiş (aynı komutlar) bu üçünü kapatır; "kodda değil" ibaresi ölçüm tarihiyle kalır.

**Ölçümün söylemediği:** sayılar YÜZEY sayar (uç var mı, kapı var mı, bileşen çiziliyor mu); rapor İÇERİĞİNİN doğruluğu (§5) ve kullanıcının hangi ekseni kullandığı (§6.4) bu tabloya girmez.
