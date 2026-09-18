# ÜRETİM ZİNCİRİ HUB'I — ekran sözleşmesi (Z3)

> **Bu belge bir ekran SÖZLEŞMESİDİR:** uygulayan (9b/01) her maddeyi `dosya:sembol` düzeyinde
> bulur, onu ölçen bekçiyi bilir ve emsalini görür. Biçim emsali
> [`DOKUMA-PANEL-EKRAN-KAPILARI.md`](DOKUMA-PANEL-EKRAN-KAPILARI.md); içerik kaynağı
> [`URETIM-BELGE-ZINCIRI.md`](URETIM-BELGE-ZINCIRI.md) §5 (izleme planı) ve §6 (adım ölçütü).
> Ölçüm tabanı `origin/main`, 2026-09-18.
>
> **Kapsam:** bu ekran **YALNIZ OKUR**. Yeni zorunlu alan yok, yeni zorunlu ekran yok, hiçbir
> akışa adım eklemez (§7). Zincir bağlarının kendisi Z1'in (01) işidir; hub onları GÖSTERİR.

## 0. Ekranın tek cümlesi

*"Hangi sipariş kalemi zincirin neresinde ve nerede takıldı?"* — satır başına TEK zincir:
**sipariş satırı → iş emri → dokuma işi → levent**, her hücrede durum + ilerleme.

## 1. YÜZEY SEÇİMİ — rapor yaprağı, operasyon ekranı DEĞİL

| Seçenek | Getirisi | Karar |
|---|---|---|
| **Rapor yaprağı** (`reports/production/zincir`) | `report:production` izni **ZATEN VAR** (yeni izin yok) · sistem yöneticisi raporu kapatabilir (`requireReportOpen`) · soru cümlesi · özet şeridi · çıktı şeridi · yan ray · komut paleti · süzgeç şeridi kalıbı HAZIR | ⭐ **SEÇİLDİ** |
| Operasyon ekranı (`operations/…`) | Karo grubunda durur | Reddedildi: yeni izin ya da mevcut bir yazma izninin okuma amaçlı genişletilmesi gerekirdi; rapor kapısı (aç/kapat) da kaybolurdu |

**Katalog satırı** (`Electron/src/lib/report-catalog.ts`, emsal `production/wip`):

```ts
{ key: "production/zincir", baslik: "Üretim Zinciri", soru: "Hangi sipariş kalemi zincirin neresinde ve nerede takıldı?",
  sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "yok",
  panelYolu: "reports/production/zincir", uc: "/api/reports/production/zincir",
  kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/zincir" }], yuzey: "yaprak" }
```

- `tarih: "yok"` — hub AÇIK İŞİN anlık fotoğrafıdır; tarih kutusu çizilmez (emsal
  `sales/open-order-coverage`). Gecikme ölçümü bugünün tarihini kullanır, kullanıcıdan almaz.
- `sinif: "basit"` — okuması eğitim istemez; hub "önce cevap" ekranıdır.

**Ölçen bekçiler:** `test_rapor_katalogu` (katalog ↔ route ↔ uç ↔ kapı taşıyıcı) ·
`test_rapor_kapisi` · `test_screen_catalog` §9c/§9e (karo ↔ `modul` iki yönlü) ·
`Electron ham-tarih-girdisi.test.ts` §3 (`tarih:"yok"` ⇒ tarih kutusu çizilmez).

> ⚠️ **Uygulama notu (9b, 2026-09-18, 1e onayı):** yol `reports/dokuma/zincir`, katalog anahtarı `dokuma/zincir`, uç
> `/api/reports/dokuma/zincir` — `test_rapor_katalogu §4` katalog `modul`unun KATEGORİ satırının modülüyle eşit olmasını
> ister; `reports/production` productionEnabled'dır, dokuma kapısı (§6) için rapor **Dokuma Raporları** kategorisinde açıldı.
> İçerik, süzgeçler ve kapanış ölçütü aynen.

## 2. MODÜL BAYRAĞI — `dokumaEnabled`, **devere AYRI ele alınır**

Katalog **TEK** `modul` alanı taşır; hub iki modülün verisini gösterir (`dokuma.enabled`,
`devere.enabled` — ikisi de `module-flags.ts`te VAR).

**Kural:** ekran `dokumaEnabled`a bağlanır. **Devere kapalıysa ekran KAYBOLMAZ, LEVENT KOLONU
KAYBOLUR** — hücre `—` basar ve "işsiz levent" kovası çizilmez.

> Gerekçe ölçülü: her ekran için ayrı birleşik bayrak üretmek (`uretimZinciriEnabled`) kapı
> sayısını şişirir ve `test_screen_catalog §10b` gereği o bayrağın da bir ekranı olmalıdır.
> Kolon düşürmek, ekran düşürmekten ucuzdur ve "modül kapalı = yüzey yok" kuralını da bozmaz:
> devere yüzeyi zaten çizilmiyor, hub yalnız onun kolonunu göstermiyor.

**Ölçen bekçiler:** `test_module_flags` · `test_module_profile` · `test_screen_catalog` §10b ·
`tile-visibility.test.ts` (karo yüklemi SAF, sarmalayıcı ok fonksiyonu yazılmaz).

## 3. UÇ — TEK yeni okuma ucu (birleştirme SUNUCUDA)

`GET /api/reports/production/zincir` · `requireReportOpen("production/zincir")` +
`requirePermission("report:production")` · Zod `.strict()` (rapor kuralı).

**Neden mevcut uçların birleşimi DEĞİL — ölçüldü (2026-09-18):** dört kaynak listesi dört AYRI
izin arkasında duruyor —
`order.routes.ts` `order:read` · `workorder.routes.ts` `workorder:read` ·
`weaving-order.routes.ts` `weavingorder:read` (+ `requireDokumaEnabled`) ·
`warp-beam.routes.ts` `warpbeam:read`.
⇒ İstemci tarafı birleştirme, hub'ı açan herkesin **dört yazma-dünyası iznini birden taşımasını**
şart koşardı; rapor kitlesinde bu 403 üretir (aynı sınıf: rapor seçicilerinde `warpbeam:read`
reddedilmişti, `meta.leventler` bu yüzden raporun KENDİ yanıtından geliyor). Ayrıca sayfalı dört
listeyi istemcide birleştirmek, "cursor'lu listede süzme SUNUCUDA" kuralını çiğnerdi.

**Yanıt sözleşmesi** (rapor zarfı; `reportEnvelope`):

```
data.satirlar[]  = { orderLineId, musteri{id,ad}, kumas{id,ad}, renk?, siparisM,
                     isEmri?  { id, no, durum, adim },          // WorkOrderStep
                     dokuma?  { id, no, durum, dokunanM, planM },// Σ doff / plannedM
                     levent?  { id, no, durum, kalanM },         // devere açıkken
                     sevkM, gecikmeGun? }
data.kovalar     = { issizLevent: n, siparissizDokuma: n, disaridanTop: n }   // BAĞSIZ kayıt sayıları
data.ozet        = { satir, gecikmis, bagsiz }
meta.secenekler  = { customerId: [...] }   // süzgeç kaynağı, süzgeçten BAĞIMSIZ (R5b-c kalıbı)
suzgec?          = { customerId?, durum?, gecikmis?, dusenSatir }              // yalnız VERİLEN anahtarlar
```

⚠️ **Hiçbir sayı yeniden hesaplanmaz.** Kaynaklar `URETIM-BELGE-ZINCIRI.md` §5.1'dekilerdir:
karşılama `SackAllocation`, iş emri adımı `WorkOrderStep`, dokuma ilerlemesi Σ doff ÷ `plannedM`,
levent kalanı defterden (`remainingMTx`), gecikme `plannedEndDate` ↔ bugün. Hub yeni bir ölçü
TANIMLAMAZ; tanımlasaydı aynı sayı iki yerde iki türlü çıkardı.

⚠️ `plannedM` **HEDEFTİR, TETİK DEĞİLDİR** (şema yorumu): %100'e ulaşmak dokuma işini KAPATMAZ ve
hub da "bitti" demez — ilerleme çubuğu %100'de dolar, durum rozeti işin kendi durumunu söyler.

**Ölçen bekçiler:** `test_rapor_strict` (`.strict()` + parametresiz uçta `emptyQuerySchema`) ·
`test_rapor_katalogu` (uç ↔ katalog) · yeni `test_rapor_zincir` (§4'teki iddialar).

## 4. EKRAN — satır, hücre, rozet

| Kolon | İçerik | Boş hâli |
|---|---|---|
| Müşteri · Kumaş | sipariş satırından | — |
| **Sipariş** | istenen metre · karşılanan metre (`SackAllocation`) | — |
| **İş emri** | durum rozeti + hangi adımda | `—` + "iş emri açılmamış" ipucu |
| **Dokuma** | durum rozeti + `Σdoff / planM` ilerleme | `—` + "dokuma işi bağlanmamış" |
| **Levent** | durum rozeti + kalan metre | devere KAPALI ⇒ kolon YOK · açık ama bağ yok ⇒ `—` |
| **Gecikme** | gün (plan bitiş ↔ bugün); yalnız pozitifse basılır | boş |

- **Hücreye tıklamak o BELGEYİ açar** (sipariş → sipariş sayfası · iş emri → iş emri · dokuma →
  dokuma işi · levent → Leventler). Satırın tamamına tek bir "detay" ekranı AÇILMAZ: kullanıcı
  hangi kutuya baktıysa oraya gider (tek dokunuş, §7).
- **Rozetler durumdan gelir, hesaplanmaz** — iş emri/dokuma/levent kendi durum enum'larını basar.
- **Bağsız kayıtlar AYRI SEKMEDE**, adıyla: *işsiz levent* · *siparişsiz dokuma* · *dışarıdan gelen
  top*. Ana listede karıştırılmaz (sipariş satırı olmayan üretim ayrı sorudur), gizlenmez de:
  sekme başlığında sayısı yazar.

**Zorunlu iki şerit** (rapor yaprağı olmanın bedeli ve faydası):
- **Özet şeridi** (`MetricCard`, tablodan ÖNCE): *zincirdeki satır* · *gecikmiş* · *bağsız kayıt*.
  Ölçen: `reportSummaryCoverage.test.ts` (29/29 yaprak).
- **Çıktı şeridi** (`ReportExportBar`): tek `ReportExportSpec` → Excel · PDF · Yazdır; süzgeç
  satırları meta'ya girer. Ölçen: `reportExportCoverage.test.ts`.

## 5. SÜZGEÇLER — mevcut kalıp, yeni bileşen YOK

`ReportAxisBar` + `ReportMultiSelect` (R5b-c katmanı) kullanılır:

| Süzgeç | Tür | Kaynak |
|---|---|---|
| Müşteri | çoklu seçim | `meta.secenekler.customerId` (süzgeçten BAĞIMSIZ) |
| Durum | kapalı enum, tek seçim | panel statik: *Tümü · Bekleyen · Devam eden · Gecikmiş · Tamamlanan* |
| Yalnız gecikmişler | aç/kapa | — |

- Kapalı seçici **eksenini ADIYLA söyler** (`Durum: Tümü`), chip/etiket yığını çizilmez.
- Seçim URL'de yaşar; "Tümü" = anahtar İSTEKTE YOK (bugünkü davranış kuralı).
- Süzgeç açıkken şerh satırı ekranda ve çıktıda; `suzgec.dusenSatir` varsa kaç satırın kapsam
  dışı kaldığı yazılır.

**Ölçen bekçiler:** `reportAxisCoverage.test.ts` (beyan ↔ ekran, iki yönlü) ·
`reportAxisFilters.test.ts` · `ham-tarih-girdisi.test.ts` §3 (şerit taşıyıcı kuralı).

## 6. BOŞ VE HATA DURUMLARI — üç ayrı cümle

| Durum | Ekran ne der |
|---|---|
| Dokuma modülü kapalı | Ekran ZATEN çizilmez (karo yok, route `/forbidden`, uç 403 `MODULE_DISABLED`) |
| Rapor kapalı (sistem yöneticisi) | Raporlar sayfasında karo yok; adres çubuğundan girilirse `/forbidden` |
| Yetki yok | `report:production` yoksa aynı şekilde |
| Veri yok (açık iş yok) | *"Açık sipariş satırı yok"* — "zincir kurulamadı" DEĞİL |
| Uç hata verdi | Hata kartı EN ÜSTTE; boş tablo "iş yok" diye okunmaz (rapor ailesi kuralı) |

⚠️ Dördü ayrı cümledir; birini ötekinin yerine basmak "sessiz eksik" üretir.

## 7. ADIM SAYISI ÖLÇÜTÜ (`URETIM-BELGE-ZINCIRI.md` §6'nın devamı)

| İş | Kabul ölçütü |
|---|---|
| "Bu sipariş nerede?" sorusunu cevaplamak | **1 ekran + 0 tıklama** (satır zaten zinciri gösterir) |
| İlgili belgeye gitmek | **1 tıklama** (hücre → belge) |
| Gecikmişleri görmek | **1 tıklama** (aç/kapa süzgeci) |
| Tablet akışlarına etkisi | **SIFIR** — hub okur, hiçbir akışa adım eklemez |

Bu ölçütlerden biri tutmuyorsa tasarım reddedilir: karmaşıklık MODELDE kalır, yüzeyde tek yol olur.

## 8. DİLİMİN KAPANIŞ ÖLÇÜTÜ (hepsi aynı commit'te)

1. `REPORT_CATALOG` satırı + `report-catalog.ts` mirası (panel) ve backend uç + `reportGate`.
2. `SCREEN_CATALOG`/karo/route/palet izinleri **birebir** (`report:production`), karo yüklemi SAF.
3. Özet şeridi + çıktı şeridi + soru cümlesi (üç bekçi: summary/export coverage + katalog).
4. Süzgeçler `reportAxisCoverage` beyanına eklenir (müşteri ekseni), `AXIS_KEYS` ile birebir.
5. Yeni bekçi `test_rapor_zincir`: ① zincir satırı dört belgeyi de doğru bağlar ② bağsız kayıt
   kovaları sayıyı DOĞRU verir ③ devere kapalıyken levent alanı HİÇ dönmez ④ `plannedM` null
   olan dokuma işinde ilerleme `null` (yüzde uydurulmaz) ⑤ süzgeç yokken yanıt bayt bayt aynı.
   **İki negatif sonda:** kova sayacı satır listesinden türetilirse (bağsızlar eksik sayılır) →
   kırmızı · `plannedM` null'da ilerleme 0 basılırsa → kırmızı.
6. Sürüm notu maddesi: kullanıcıya görünen tek cümle — *"Üretim Zinciri raporu geldi"*.

## 9. KAPSAM DIŞI (bilerek)

- **Yazma yok:** hub'dan iş emri açılmaz, dokuma işi kapatılmaz, levent takılmaz.
- **Yeni ölçü yok:** ilerleme/gecikme tanımları §5.1 kaynaklarından; hub kendi formülünü yazmaz.
- **Zincir bağlarının kendisi** (Y1/Y2/Y3) Z1'in işidir; hub bağ YOKSA `—` basar, bağ KURMAZ.
- **Tablet yüzeyi yok:** hub panel ekranıdır; sahada operatörün sorusu bu değil.
