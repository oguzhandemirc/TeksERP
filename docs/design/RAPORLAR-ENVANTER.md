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
- **"Sunucu süzgeci" bugün YOK.** Ölçüldü: hiçbir rapor ucu kurulum/sunucu/şube eksenli bir süzgeç taşımıyor (çok-kurulum ekseni `installationId` yalnız keşif/cihaz tarafında yaşıyor). Bu istek sıfırdan tasarım ister ve muhtemelen fazın en büyük parçasıdır.

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
| Plan-Sapma Karnesi (`quality/plan-deviation…`) | 2 | 2 | 0 |
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

> Tam adın doğrulanması gereken tek satır: `quality/plan-deviation…` — bugünkü uç `quality/plan-deviation-scorecard`. Ham çıktıda anahtar kısaysa bu da onuncu ölü anahtardır ve "görülen" 14 → 13'e iner.

### 6.6 · Sayının SÖYLEDİĞİ ve SÖYLEMEDİĞİ

- **En çok kullanılan iki rapor DENETİM raporları** (18 ve 12) — iş raporlarının hepsi tekli hanelerde. Bu bir kullanım sıralaması değil, bir KULLANICI sıralamasıdır: denetim raporlarını yönetici/geliştirici açar, iş raporlarını fabrika açar. ⇒ *"Rapor ekranını fabrika neredeyse hiç kullanmıyor"* okuması bu veriyle uyumludur ve fazın gerekçesidir.
- **Faz "kullanılmayanı kapat" değildir.** Sıfırların 8'i ölçülemez (modül kapalı), 7'si açık-ama-çağrılmamış ve hepsinin ortak özelliği ÇIKTI/SÜZGEÇ eksikliği değil — beşi sipariş ailesinden, hepsinin Excel+PDF'i VAR. ⇒ Kullanılmama sebebi çıktı değil; **ekranın bulunabilirliği ve anlaşılırlığı** (§4'ün "kolay anlaşılır ekran" isteği) ya da raporun fabrikanın sorusuna cevap vermemesi. Bu ayrım ölçülmedi — kullanıcıya SORULUR, telemetriden çıkarılmaz.
- **Düşük sayı kapatma gerekçesi değildir** (§6.4 hükmü ayakta): KDV Dönem Özeti ve Kur Farkı bu pencerede hiç açılmadı ama ikisi de modül kapalı olduğu için ölçülemedi — açık olsalar ayda bir açılırlardı ve yine "düşük" görünürlerdi.
