# Maliyet & Teklif (MAL) — uygulanabilir dilimli plan

> Durum: PLAN (2026-10-24, plan yazarı ajan). Bağlayıcı girdi: `scratchpad/erp/KARARLAR.md` G2 madde 3 · G-R2 §5 (maliyetlendirme modelleri, M0–M3, metre başı bileşenler) · G-R1 §1.13/§3 (maliyet zemini). Kurallar: `docs/kurallar/{dokuma,finans,defter,is-emri,fason,patron-bulutu,modul-bayrak,belge-etiket,numaralandirma,yetki-izin}.md`, `docs/RECETELER.md`. Ürün yapısının kaynağı: `docs/design/DOKUMA-MANUEL-PLAN.md` S2 (iş emri formu v2; **henüz inmedi**, origin/main `2bd3d7b08`te `WeftSpec` yok).
> Dilim istemleri: `scratchpad/erp/MAL/istemler/MAL-0.md … MAL-8.md`.

---

## §0 · Amaç ve kapsam

**Amaç.** Patronun en sık sorduğu "bu kumaşı X'e verirsem kâr eder miyim?" sorusunu ERP'nin zaten taşıdığı miktar verisinden (tel sayısı, denye, çekme, atkı sıklığı, devir, randıman, levent dengesi firesi) ve yeni girilecek az sayıda para parametresinden cevaplamak. Aynı veri (ürün yapısı + iplik fiyatı + tesis parametreleri) üç işe yarar; bu yüzden tek pakettir (KARARLAR G1):

1. **M0 — Teklif hesaplayıcı.** Ürün kartından ya da elle girilen yapıdan metre maliyeti → kâr → teklif fiyatı; döviz ve kur seçimi. Sistemde henüz olmayan yeni desen için de çalışır.
2. **M1 — Standart maliyet.** Ürün başına saklanan, sürümlenen metre maliyeti. Fiyat ya da parametre değişince yeni sürüm yazılır; eski sürüm ve onu kullanan teklifler değişmez.
3. **Satış teklifi + fiyat listesi.** Numaralı, durum makineli teklif belgesi; kabul edilen teklif siparişe dönüşür. Yayınlanan, sürümlü fiyat listesi.
4. **İplik ihtiyaç planı.** Açık sipariş kalemleri → ürün yapısı → iplik kg ihtiyacı − stok − açık alış siparişi → eksik listesi.

**Kapsam dışı (bilerek).**
- **M2 — iş emri/parti fiili maliyeti.** İplik çıkışında değer yok (`YarnMovement.unitPrice` yalnız girişte), atkı tüketimi hiç yazılmıyor (DOKUMA yol haritası B11), fason faturası iş emrine bağlı değil, işçilik ücret verisi yok (Personel modülü Faz 2). Bunlar olmadan yazılacak fiili maliyet, varsayımları "gerçek" diye sunardı. M2 ancak B11 + fason fatura bağı + Personel sonrası anlamlıdır (G-R2 §5.3 "L").
- **M3 — sapma ve stok değerleme.** M1 + M2 + stok tarafında dönem kilidi ister; stok değerleme muhasebe programının işidir (G-R2 §8.4).
- E-posta ile teklif gönderme (e-posta altyapısı yok), CRM fırsat hattı (Faz 3), tablet ekranı (operatör maliyet görmez), boya reçetesi/kimyasal maliyeti (terbiye fason; iç boyahane yok), Ne/Nm/tex iplik numarası (bugün tek birim denye — `resolveDenier` tek kaynak; 1a′ indiğinde yalnız o değişir).

**Modül.** `maliyet.enabled` (API `maliyetEnabled`), varsayılan KAPALI, sıfırdan doğan modül → grandfathering değeri sabit `false`. Kapalı kurulumda ~~menü yok~~ (GEÇERSİZ → 2026-10-26, UX-2 K3: menü satırı soluk + "kapalı — <ayar yolu>"), uçlar 403 `MODULE_DISABLED`, buluta hiçbir şey gitmez — fabrika sıfır-fark.

---

## §1 · Mevcut veri ve boşluk (alan alan)

| Bileşen | Bugün var (origin/main) | Boşluk | Bu planda |
|---|---|---|---|
| Çözgü tel sayısı | `WarpSpec.endsCount` (CHECK > 0) | — | Okunur |
| Çözgü ipliği + numarası | `WarpSpec.yarnItemId` → `Item.linearDensityDen` (denye, elle) | Tek iplik; çoklu levent yok | Tek çözgü bileşeni (v1); çoklu levent kapsam dışı, beyanlı |
| Çözgü çekmesi | `WarpSpec.takeUpPct` (nullable, 0 ≤ x < 100) | Çoğu kartta NULL | NULL → parametre varsayılanı + `TAKEUP_DEFAULTED` uyarısı; varsayılan da yoksa hesap durur |
| Tarak eni | `WarpSpec.reedWidthCm` (bilgi) | — | Atkı boyunun birinci kaynağı |
| Çözgü teorik kg formülü | `constants/warp-beam.ts` `warpTheoreticalKg` (tel × denye × m / 9e6) | — | Motor AYNI formülü çağırır (tek kaynak) |
| Atkı sıklığı | `MachineRun.unitsPerCm` (koşumda donuk), S2 taslağında `WeftSpec.picksPerCm` | Ürün düzeyinde yok | S2 `WeftSpec.picksPerCm` |
| **Atkı ipliği** | **YOK** | S2 taslağında tek `WeftSpec.yarnItemId` | **S2'ye ek önerisi: `WeftSpecYarn` (çoklu atkı ipliği, rapordaki atkı adedi payı)** — §3.1 |
| Ham/mamul en | S2 taslağı `Item.rawWidthCm/finishedWidthCm` | — | Atkı boyu yedek kaynağı |
| Devir / m/saat | `MachineSpec.nominalUnitsPerMin`, `MachineRun.targetUnitsPerMin`; `dokuma-levent-rapor.helper.ts` `theoreticalMPerHour` | Ürün düzeyinde devir yok | Yapıda devir + randıman (yoksa parametre); m/sa formülü tek helper'a Decimal ikiz |
| Randıman | `MachineShiftStat` kullanılabilirlik/performans (ayrı sunulur; dokuma.md "randıman tek sayı değildir") | Manuel modda tezgah verisi yok | Maliyet randımanı ELLE parametre ("planlama randımanı"), raporlanan OEE ile karıştırılmaz |
| Levent dengesi firesi | `levent-sonucu.report.service.ts` `beamResultReport({from,to,warpSpecId})` → `summary.firePct` | Az veri; take-up NULL ise "ölçülemedi" | Ölçülmüş fire ÖNERİSİ (son 180 gün); yoksa varsayılan |
| Kalite firesi (2. kalite/hurda) | `RollVariance` SCRAP, `scrap-scorecard` | Para karşılığı yok | v1 parametre; ölçülmüş öneri v1.1 |
| İplik fiyatı | `YarnMovement.unitPrice` (girişte), `ItemPrice(PURCHASE)`, `PurchaseOrderLine.unitPrice` | Maliyet fiyatı ≠ son alış fiyatı olabilir; ticaret/iplik kapalı kurulumda hiç yok | `YarnCostPrice` (sürümlü); ticaret/iplik açıksa öneri köprüsü |
| Terbiye/fason ücreti | **YOK** (`Subcontractor*` 10 modelde fiyat kolonu yok) | — | `FinishingRate` (fason tarifesi, sürümlü) |
| İşçilik | Personel/ücret yok | — | Parametre: operatör saat ücreti × (1 / tezgah başı operatör) |
| Enerji | Sayaç yok | — | Parametre: kWh/tezgah-saat × TL/kWh |
| Hazırlık (devere/tahar) | `WarpBeam` var, maliyet yok | — | Parametre: levent başı TL ÷ levent kumaş metresi |
| Genel gider | — | — | Parametre: % |
| Kur | `ExchangeRate` + `jobs/exchange-rate.job.ts` (TCMB) + `finance.helper.ts` `resolveExchangeRateTx` (TRY = 1, yoksa null) — `finance.enabled` modeli | Finans kapalı kurulumda kur yok | Finans açıksa öneri; her zaman elle girilebilir; kur yoksa `FX_RATE_MISSING` (1'e düşmez): sürüm kaydında 400 `COST_INPUT_MISSING`, önizlemede 200 + `sonuc: null` + `eksikler` (MAL-2 kararı, arşiv 2026-10-25) |
| Satış fiyatı | `ItemPrice(SALE)` (kart varsayılanı + müşteri istisnası, `resolveItemPrice`), `OrderLine.unitPrice Decimal(12,2)` | Tarihli/sürümlü fiyat listesi yok | `PriceList` (yayınlanan, sürümlü) |
| Açık talep | `order-line-scope.helper.ts` `ACTIVE_LINE`, `MEASURED_LINE`, `openLineWhere`; `production-balance.service.ts` (talep − depo − üretimde) | — | İhtiyaç planı aynı tek kaynaklardan okur |
| İplik stoğu | `YarnStock.balanceKg` (iplik modülü), lot bakiyesi Σ hareket | Emanet lot ayrımı | İplik açıksa okunur; kapalıysa "bilinmiyor" (0 değil) |
| Açık alış | `PurchaseOrderLine.qty − receivedQty` (ticaret modülü) | — | Ticaret açıksa düşülür; kapalıysa yalnız stok |
| Hazır çözgü | `WarpBeam` READY/MOUNTED + kalan metre (`WarpBeamEvent` türetmesi) | — | Devere açıksa çözgü ihtiyacından düşülür |
| Belge | `PrintedDocument` + `PrintedDocType` (donmuş JSON snapshot); belge tasarımcısı T0 (veri sözleşmesi kataloğu) PLANDA | Teklif/fiyat listesi türü yok | `SALES_QUOTE`, `PRICE_LIST` — T0'dan SONRA |
| Patron bulutu | `fiyat` projeksiyonu (`item_prices`, `.finans`, `bulut:fiyat:oku`) | Teklif/maliyet yok | `teklif`, `teklif-kalemi`, `standart-maliyet` projeksiyonları |

**Değerlendirme.** Miktar tarafı zengin, para tarafı yalnız uçlarda (G-R1). Eksik olan iki şey var: **atkı ipliği kalemi** (S2 + `WeftSpecYarn`) ve **tesis parametreleri**. Bunlar gelince maliyet hesabının %90'ı mevcut veriden türer.

---

## §2 · Maliyet formülleri

### 2.1 Semboller ve birimler

| Sembol | Anlam | Birim | Kaynak (öncelik sırası) |
|---|---|---|---|
| N | çözgü tel sayısı (kenar dahil) | adet | `WarpSpec.endsCount` |
| dᶜ | çözgü ipliği numarası | denye (g / 9000 m) | `resolveDenier(yarnItem)` |
| t | çözgü çekmesi (take-up) | oran (0–1) | `WarpSpec.takeUpPct` → `CostParameterSet.defaultTakeUpPct` (uyarı) → YOK (hata) |
| fᶜ | çözgü firesi (levent dengesi) | oran | `CostStructure.warpWastePct` (elle) → parametre varsayılanı; ölçülmüş (`beamResultReport.firePct`, son 180 gün, ≥ 3 kapanmış levent) yalnız ÖNERİ, kullanıcı onaylarsa elle değer olarak girer (MAL-2 kararı, bkz. §7-10) |
| p | toplam atkı sıklığı | atkı/cm | `WeftSpec.picksPerCm` |
| sⱼ | j. atkı ipliğinin payı | oran, Σ = 1 | `WeftSpecYarn.picksInRepeat / Σ` |
| dⱼ | j. atkı ipliği numarası | denye | `resolveDenier` |
| W | atkı boyu (atkı başına iplik) | m | `CostStructure.weftLengthCm` → `WarpSpec.reedWidthCm` → `Item.rawWidthCm + weftSelvedgeAllowanceCm` (uyarı) → YOK (hata) |
| fᵃ | atkı firesi | oran | yapı → parametre |
| P | iplik maliyet fiyatı | TL/kg | `YarnCostPrice` (para birimi × kur) |
| n | tezgah devri | atkı/dk | yapı → parametre `defaultLoomRpm` |
| η | planlama randımanı | oran | yapı → parametre |
| Rₘ | tezgah saat maliyeti (amortisman + bakım + yer) | TL/sa | parametre |
| Rₗ | operatör saat ücreti (yüklü) | TL/sa | parametre |
| k | tezgah başına operatör | 1 / `loomsPerOperator` | parametre |
| e, T | enerji tüketimi, birim fiyatı | kWh/tezgah-sa, TL/kWh | parametre |
| H, Lₗ | levent hazırlık maliyeti, levent çözgü boyu | TL/levent, m | parametre (Lₗ yapıda ezilebilir) |
| F | terbiye/fason ücreti | TL/m (tarife bazı HAM ya da MAMUL) | `FinishingRate` |
| sᵦ | ham → mamul boy çekmesi | oran | yapı → tarife → 0 (uyarı `SHRINK_UNKNOWN`) |
| fᵏ | kalite firesi (2. kalite + hurda) | oran | yapı → parametre |
| g | genel gider oranı | oran | parametre |
| X | ek kalem (ambalaj vb.) | TL/m | yapı |
| m | kâr oranı (maliyet ÜSTÜ) | oran | teklif kalemi → parametre `defaultMarkupPct` |

Bütün yüzdeler DB'de `Decimal(5,2)` yüzde olarak tutulur (CHECK 0 ≤ x < 100; kâr `Decimal(6,2)`, 0 ≤ x ≤ 1000); motor içinde /100 ile orana çevrilir.

### 2.2 Formüller (metre = ham kumaş metresi, aksi yazılmadıkça)

**Çözgü ipliği** (kg/m):
`Kᶜ = warpTheoreticalKg(N, dᶜ, 1) / (1 − t) / (1 − fᶜ)` — mevcut tek kaynak formül (`N × dᶜ / 9 000 000`) metre başına çağrılır; `(1 − t)` paydası `WarpSpec` şerhindeki "çözgü = kumaş ÷ (1 − takeUp/100)" kuralının aynısıdır.
`Cᶜ = Kᶜ × Pᶜ` (TL/m)

**Atkı ipliği** (her j için, kg/m):
`Kⱼ = p × 100 × W × sⱼ × dⱼ / 9 000 000 / (1 − fᵃ)` — `p × 100` = metredeki atkı adedi, `× W` = atkı ipliği metresi, `× d / 9 000 000` = kg.
`Cᵃ = Σⱼ Kⱼ × Pⱼ`

**Dokuma dönüşümü:**
`V = n × 60 × η / (p × 100)` (m/sa) — `theoreticalMPerHour(n, p) × η` ile AYNI formül; helper'a Decimal ikizi eklenir, sayı sürümü ona delege eder.
`Cₘ = Rₘ / V` (makine) · `Cₗ = Rₗ × k / V` (işçilik) · `Cₑ = e × T / V` (enerji, ayrı satır)

**Hazırlık:** `Cₕ = H / (Lₗ × (1 − t))`

**Ham metre maliyeti:** `C_ham = Cᶜ + Cᵃ + Cₘ + Cₗ + Cₑ + Cₕ`

**Terbiye ve çekme** (ham satılan kumaşta F = 0, sᵦ = 0):
- tarife bazı HAM_M: `C_mamul = (C_ham + F) / (1 − sᵦ)`
- tarife bazı MAMUL_M: `C_mamul = C_ham / (1 − sᵦ) + F`

**Kalite firesi:** `C_sağlam = C_mamul / (1 − fᵏ)`
**Genel gider:** `G = C_sağlam × g` · **Standart metre maliyeti:** `C_std = C_sağlam + G + X`

**Teklif fiyatı** (kalem para birimi Q, kur r = 1 Q kaç TL):
`P_TL = C_std × (1 + m)` → `önerilen = P_TL / r` (4 hane saklanır) → kullanıcı `birimFiyat`ı 2 haneye kesinleştirir (sipariş kalemi `Decimal(12,2)` ile tek hassasiyet). Teklif düzeyinde opsiyonel ekler: navlun (Q/m, eklenir), vade farkı `aylıkOran × gün / 30` (çarpan), komisyon (`/ (1 − komisyon)`). Brüt marj ekranda gösterilir: `(fiyat − maliyet) / fiyat`.

**Yuvarlama.** Motor tam `Prisma.Decimal` hassasiyetiyle çalışır; saklanan bileşenler TL/m 4 hane, kg/m 6 hane, toplamlar 2 hane; kural ticari yarım-yukarı (`ROUND_HALF_UP`, belge `docNum` ile aynı). Kayan nokta (`number`) motorda YASAK.

**Hata ve uyarı sözleşmesi.** Motor `{ sonuc | null, eksikler: Kod[], uyarilar: Kod[] }` döner. Eksik (sürüm kaydı 400 `COST_INPUT_MISSING`, `details.missing[]`): `WARP_SPEC_MISSING`, `DENIER_MISSING`, `TAKEUP_MISSING`, `WEFT_SPEC_MISSING`, `PICKS_MISSING`, `WEFT_LENGTH_MISSING`, `YARN_PRICE_MISSING`, `FX_RATE_MISSING`, `RPM_MISSING`, `PARAMETER_SET_MISSING`, `FINISHING_RATE_MISSING` (MAL-2 eki). Uyarı (kayda girer, rozet olur): `TAKEUP_DEFAULTED`, `WARP_WASTE_DEFAULTED`, `WARP_WASTE_MEASURED`, `WEFT_LENGTH_FROM_WIDTH`, `SHRINK_UNKNOWN`, `RPM_DEFAULTED`, `PRICE_STALE` (fiyat > 90 gün).

### 2.3 Sayısal örnek (bekçinin ALTIN değeri — MAL-2 `test_maliyet_formul`)

Jakar perde kumaşı, ham en 300 cm, tarak eni 310 cm. Kur: 1 USD = 34,00 TL.

| Girdi | Değer |
|---|---|
| Çözgü | 9 600 tel · 75 den PES · çekme %6 · levent firesi %2,5 · 2,60 USD/kg (= 88,40 TL/kg) |
| Atkı | 28 atkı/cm · W = 3,10 m · iki iplik 1:1 — A 150 den (2,40 USD/kg = 81,60 TL), B 300 den (3,10 USD/kg = 105,40 TL) · atkı firesi %3 |
| Dokuma | 600 devir/dk · randıman %85 · makine 120 TL/sa · operatör 250 TL/sa, 8 tezgaha 1 operatör · 6 kWh/sa × 3,20 TL/kWh |
| Hazırlık | 4 500 TL/levent · levent çözgü boyu 3 000 m |
| Terbiye | fason 18,00 TL/m (HAM bazı) · boy çekmesi %4 · kalite firesi %2 |
| Genel gider / kâr | %12 / %18 |

| Satır | Hesap | Sonuç |
|---|---|---|
| Çözgü kg/m | 9 600 × 75 / 9 000 000 / 0,94 / 0,975 | 0,087289 kg |
| Çözgü TL/m | 0,087289 × 88,40 | **7,7163** |
| Atkı metresi | 28 × 100 × 3,10 | 8 680 m |
| Atkı A kg/m | 8 680 × 0,5 × 150 / 9 000 000 / 0,97 | 0,074570 kg → **6,0849** TL |
| Atkı B kg/m | 8 680 × 0,5 × 300 / 9 000 000 / 0,97 | 0,149141 kg → **15,7195** TL |
| m/sa | 600 × 60 × 0,85 / 2 800 | 10,9286 |
| Makine / işçilik / enerji | 120 / V · 31,25 / V · 19,20 / V | **10,9804 / 2,8595 / 1,7569** |
| Hazırlık | 4 500 / (3 000 × 0,94) | **1,5957** |
| **Ham metre** | toplam | **46,7132** |
| Mamul (terbiye + çekme) | (46,7132 + 18) / 0,96 | 67,4096 |
| Sağlam (kalite firesi) | 67,4096 / 0,98 | 68,7853 |
| Genel gider | × 0,12 | 8,2542 |
| **Standart metre maliyeti** | | **77,0395 TL/m** |
| Teklif fiyatı | 77,0395 × 1,18 = 90,9066 TL → / 34 | önerilen 2,6737 → **2,67 USD/m** (brüt marj %15,25) |

Ders: iplik payı (29,52 TL) ham metre maliyetinin %63'ü — G-R2'nin "%66" kaba bulgusuyla uyumlu; **iplik tüketim hesabının doğruluğu her şeyden önemlidir**, bu yüzden altın değer bekçide kilitlidir.

---

## §3 · Veri modeli

Genel kurallar: UUID PK `@db.Uuid`, `createdAt`/`updatedAt` `@db.Timestamptz`, kayıt künyesi (`createdById`/`updatedById`), para `Decimal(14,4)` birim / `Decimal(14,2)` toplam / kur `Decimal(18,6)` (`ExchangeRate.rate` ile aynı), para birimi mevcut `Currency` enum'u, kur kaynağı mevcut `ExchangeRateSource` (MANUAL|TCMB). Migration'lar YALNIZ `prisma migrate dev --create-only` (`DropForeignKey` satırları silinir), damga origin/main'deki son damgadan büyük; hepsi ADDITIVE; yeni pg enum aynı dosyada `CREATE TYPE` serbest, var olan enum'a değer ekleme KENDİ dosyasında (`ALTER TYPE ADD VALUE`). `BaseController` KULLANILMAZ (her skaler kolon yazılabilir olurdu); servisler düz `export async function`, `*_SELECT satisfies Prisma.XSelect`.

### 3.1 Ürün yapısı — dokuma S2'nin malı, MAL'ın bağımlılığı

Ürün yapısının TEK kaynağı dokuma kartlarıdır (`Item` → `WarpSpec`, `WeftSpec`; S2). Maliyet kendi tel/sıklık kopyasını TUTMAZ — aynı soruya ikinci cevap olurdu (ayrışan yüzey).

**S2 taslağına ek önerisi (veto §8-1):** S2'nin `WeftSpec.yarnItemId` tekil kolonu yerine
```
model WeftSpecYarn {            // @@map("weft_spec_yarns")
  id, weftSpecId (FK Restrict), yarnItemId (FK Item Restrict; servis: YARN ∧ linearDensityDen dolu → 400)
  picksInRepeat Int             // CHECK > 0 — rapordaki atkı adedi; pay = bu / Σ
  sortOrder SmallInt            // @@unique([weftSpecId, sortOrder])
  createdAt, updatedAt
}
```
Sınıf: ③b saf yapılandırma pivotu (gövde replace; parasal sonucu standart maliyet sürümünde DONMUŞTUR, replace audit'e eski/yeni küme olarak yazılır). Çoklu levent (zemin + hav) v1 kapsam dışı: motor çözgü bileşenini liste olarak alır, v1'de liste tek elemanlıdır.

**Bağımlılık çözümü.** Seçenek A (önerilen): S2 önce iner, `WeftSpecYarn` ile. Seçenek B: S2 takvime girmezse MAL-1 S2'nin YALNIZ şema + CRUD çekirdeğini (`WeftSpec`, `WeftSpecYarn`, `Item` en/gramaj/`weftSpecId`) üstlenir, S2'ye form v2 + `suggest-item` kalır. Hangisi seçilirse seçilsin `schema.prisma`ya aynı dalgada iki ajan dokunmaz.

### 3.2 MAL modelleri

**`CostParameterSet`** — tesis parametreleri sürümü (`cost_parameter_sets`):
`versionNo Int @unique` · `status CostParamStatus (DRAFT|ACTIVE|SUPERSEDED)` · `activatedAt/ById`, `supersededAt` · `note VarChar(300)?` · `loomHourRateTry Decimal(12,4)` · `laborHourRateTry Decimal(12,4)` · `loomsPerOperator Decimal(6,2)` (CHECK > 0) · `energyKwhPerLoomHour Decimal(8,3)` · `energyPriceTryPerKwh Decimal(10,4)` · `overheadPct` · `defaultTakeUpPct?` · `defaultWarpWastePct` · `defaultWeftWastePct` · `defaultFabricWastePct` · `defaultLoomRpm Int?` · `defaultEfficiencyPct` · `beamPrepCostTry Decimal(12,2)` · `defaultBeamLengthM Decimal(10,2)` · `weftSelvedgeAllowanceCm Decimal(6,2)` · `defaultMarkupPct Decimal(6,2)` · `monthlyFinanceRatePct?`.
Partial unique `WHERE status='ACTIVE'` (tek yürürlükteki) ve `WHERE status='DRAFT'` (tek taslak). ACTIVE satır DEĞİŞMEZ: düzenleme = taslak kopyası → "Yürürlüğe al" (tek tx: `updateMany {status: ACTIVE} → SUPERSEDED` + `updateMany {id, status: DRAFT} → ACTIVE`, count 0 → 409; yarışta partial unique P2002 → 409). Sınıf: DURUM + donmuş sürüm; hard delete yalnız hiç yürürlüğe girmemiş taslakta (④).

**`YarnCostPrice`** — iplik maliyet fiyatı (`yarn_cost_prices`): `yarnItemId` (Restrict) · `currency` · `pricePerKg Decimal(14,4)` CHECK > 0 · `source YarnCostPriceSource (MANUAL|LAST_RECEIPT|PURCHASE_PRICE)` · `sourceRef VarChar(64)?` · `note?` · `revokedAt/ById/revokeReason`. Partial unique `(yarnItemId) WHERE revokedAt IS NULL`. Ticari pivot deseni (defter.md ③a): fiyat değişimi = eski satırın damgası + yeni satır, aynı tx; okurlar `ACTIVE_YARN_COST_PRICE` tek sabitinden süzer.

**`FinishingRate`** — terbiye/fason tarifesi (`finishing_rates`): `code VarChar(32)` · `name VarChar(100)` · `subcontractorId?` (Restrict) · `basis FinishingBasis (RAW_M|FINISHED_M)` · `currency` · `pricePerM Decimal(14,4)` CHECK ≥ 0 · `typicalShrinkPct?` · revoke damgası; partial unique `(code) WHERE revokedAt IS NULL`. Fiyat değişimi aynı kodla yeni satır.

**`CostStructure`** — ürünün maliyete özgü ekleri (`cost_structures`), kartta OLMAYANLAR: `itemId @unique` (Restrict, FABRIC) · `loomRpm Int?` · `efficiencyPct?` · `warpWastePct?` · `weftWastePct?` · `fabricWastePct?` · `weftLengthCm Decimal(7,2)?` · `beamLengthM?` · `finishingRateCode VarChar(32)?` (kod → aktif tarife; fiyat değişince yapı değişmez) · `lengthShrinkPct?` · `extraCostPerMTry Decimal(12,4)?` + `extraCostLabel VarChar(100)?` · `notes`. Her alan NULL = "parametre varsayılanı"; sınıf KATALOG (canlı ayar; parasal sonucu sürümde donar).

**`StandardCostVersion`** (`standard_cost_versions`): `itemId` (Restrict) · `versionNo Int` (`@@unique([itemId, versionNo])`) · `status StandardCostStatus (ACTIVE|SUPERSEDED)` + partial unique `(itemId) WHERE status='ACTIVE'` · `parameterSetId` (Restrict) · `rawCostPerMTry`, `finishedCostPerMTry?`, `totalCostPerMTry` `Decimal(14,4)` · `warpKgPerM`, `weftKgPerM` `Decimal(14,6)` · `loomMPerHour Decimal(10,4)` · `fxRates Json` (katı şema: `{tarih, kaynak, kurlar:{USD?,EUR?,GBP?}}`) · `inputSnapshot Json` (katı şema, `schemaVersion: 1`: motorun TÜM girdileri) · `inputHash VarChar(64)` (kanonik girdinin sha256'sı) · `warnings Json` (kod dizisi) · `computedAt`, `computedById`, `reason VarChar(300)?`, `supersededAt?`.
**`StandardCostLine`** (`standard_cost_lines`): `versionId` (Restrict) · `lineNo` · `component CostComponent (WARP_YARN|WEFT_YARN|LOOM_MACHINE|LOOM_LABOR|ENERGY|BEAM_PREP|FINISHING|LENGTH_SHRINK|FABRIC_WASTE|OVERHEAD|EXTRA)` · `label VarChar(120)` · `yarnItemId?` · `qty Decimal(14,6)?` · `qtyUnit VarChar(16)?` · `unitPriceTry Decimal(14,4)?` · `amountPerMTry Decimal(14,4)`.
Sınıf: **donmuş fotoğraf, defter DEĞİL** (bakiye/miktar toplamı yürütmez; satır silinince hiçbir bakiye değişmez ama teklif ve tarihçe ona işaret eder → hard delete YASAK, `onDelete: Restrict`). Sürüm satırı ve kalemleri yazıldıktan sonra güncellenmez; yalnız `status/supersededAt` DURUM kolonudur. "Geri alma" = eski sürümün girdileriyle YENİ sürüm (ileri kaydı ne siler ne değiştirir). **Bayatlık:** liste/detay canlı girdinin hash'ini aktif sürümün `inputHash`iyle karşılaştırır → "Girdi değişti" rozeti (çözgü kartı, iplik fiyatı ya da parametre değişti); otomatik yeniden hesap YOK.

**`SalesQuote`** (`sales_quotes`): `quoteNo VarChar(32)` (doğuşta seri `sales_quote`) + `revisionNo SmallInt` (`@@unique([quoteNo, revisionNo])`) · `clientToken @unique` · `customerId` (Restrict; servis: `isCustomerRole`) · `branchId?` · `quoteDate @db.Date` (iş/kur tarihi, fabrika günü) · `validUntil @db.Date` · `currency` · `fxRate Decimal(18,6)` CHECK > 0 (TRY → 1) · `fxRateSource ExchangeRateSource` · `fxRateDate @db.Date?` · `paymentTermDays Int?` · `financeChargePct?`, `commissionPct?`, `freightPerM Decimal(14,4)?` · `customerReference VarChar(100)?` · `notes VarChar(1000)?` (müşteri belgesine girer) · `internalNote VarChar(1000)?` (GİRMEZ) · `status SalesQuoteStatus` · `statusChangedAt` · `sentAt/ById` · `acceptedAt/ById` · `rejectedAt/ById/rejectReason` · `cancelledAt/ById/cancelReason` · `convertedOrderId @unique?` (FK Order Restrict) · `convertedAt/ById` · `revisionOfId @unique?` (self, Restrict) · `totalAmount Decimal(14,2)` · `totalCostTry Decimal(14,2)?`.
CHECK `sales_quotes_converted_ck`: `(status = 'CONVERTED') = (convertedOrderId IS NOT NULL)` — durum ↔ bağ çifti tek yazar + DB seddi. `Order` modeline kolon EKLENMEZ (bağ teklifte).

**`SalesQuoteLine`** (`sales_quote_lines`): `quoteId` (Cascade — yalnız DRAFT teklif silinebilir, ④) · `lineNo` · `itemId?` (Restrict; yeni desen teklifinde boş) · `colorId?` · `description VarChar(200)` · `width Decimal(12,3)?` · `quantity Decimal(12,3)` CHECK > 0 · `unit ItemUnit` (v1 yalnız MT, servis 400) · `standardCostVersionId?` (Restrict) · `costPerMTry Decimal(14,4)` · `costSnapshot Json` (katı şema; elle yapıda girdiler + döküm) · `markupPct Decimal(6,2)` · `suggestedUnitPrice Decimal(14,4)` · `unitPrice Decimal(12,2)` · `priceSource QuotePriceSource (COST_PLUS|PRICE_LIST|ITEM_PRICE|MANUAL)` · `priceListLineId?` · `lineTotal Decimal(14,2)` · `notes?`.

**`PriceList`** (`price_lists`): `listNo` (seri `price_list`) + `revisionNo` · `name VarChar(100)` · `customerId?` (NULL = genel liste) · `currency` · `status PriceListStatus (DRAFT|PUBLISHED|ARCHIVED)` · `validFrom/validUntil @db.Date?` (BİLGİ — çözümleyici tarih aralığı DEĞERLENDİRMEZ; geçerlilik = yayın durumu; defter.md "validFrom/validUntil değil" ilkesi) · `publishedAt/ById` · `archivedAt` · `revisionOfId @unique?` · `notes`. Partial unique: `(COALESCE(customerId, '00000000-…'), currency) WHERE status='PUBLISHED'`.
**`PriceListLine`**: `priceListId` · `lineNo` · `itemId` · `colorId?` · `unitPrice Decimal(12,2)` CHECK ≥ 0 · `minQty?` · `standardCostVersionId?` · `costPerMTry?` · `markupPct?`; partial unique `(priceListId, itemId, COALESCE(colorId, …))`. Yayınlanmış listenin satırı DEĞİŞMEZ (servis claim `WHERE list.status='DRAFT'`); taslak satırı replace (④).

### 3.3 Durum makineleri

```
Teklif:  DRAFT ──gönder──▶ SENT ──kabul──▶ ACCEPTED ──siparişe dönüştür──▶ CONVERTED
           │                 │  └──ret──▶ REJECTED          │
           │                 │                              └──kabulü geri al──▶ SENT
           └─iptal─▶ CANCELLED ◀─geri çek─┘
         SENT|REJECTED ──revizyon──▶ (eski) SUPERSEDED + (yeni) DRAFT, aynı quoteNo, revisionNo+1
Süre: "süresi doldu" DURUM DEĞİL, türetilmiş bayrak (status=SENT ∧ validUntil < fabrika günü);
      süresi dolmuş SENT teklif kabul edilemez → 409 QUOTE_EXPIRED (çare: revizyon).
Fiyat listesi:  DRAFT ──yayınla──▶ PUBLISHED ──(aynı müşteri+döviz yeni yayın ya da arşivle)──▶ ARCHIVED
                PUBLISHED ──revizyon──▶ yeni DRAFT (revisionOfId)
Parametre seti: DRAFT ──yürürlüğe al──▶ ACTIVE ──(yeni yürürlük)──▶ SUPERSEDED
Standart maliyet: (yeni sürüm ACTIVE) ⇒ (önceki ACTIVE → SUPERSEDED), tek tx
```
Her geçiş ATOMİK CLAIM (`updateMany WHERE {id, status: beklenen}`, count 0 → 409 `QUOTE_STATUS_CONFLICT` vb.); `findUnique → if → update` yasak; tx içinde `Promise.all` yasak; audit tx DIŞINDA.

### 3.4 Sayı, numara, kilit, idempotency

- Numara serileri `number-series-catalog.ts`: `sales_quote` (öneri: `TKF` + yıl + 5 hane), `price_list` (`FL` + yıl + 4 hane); `test_number_series` BEKLENEN tablosuna yazılır. Revizyon aynı numarayı taşır.
- `clientToken @unique`: teklif yaratma ve dönüştürme (sipariş `clientToken`ı = istekten gelen token; replay `helpers/token-replay.helper.ts` dört durumlu boğazından).
- Yeni advisory uzayı AÇILMAZ (claim + partial unique yeter). Dönüştürmede sipariş yazıcısının (`insertPreparedOrderTx`) kilidi varsa tx'in İLK ifadesi o olur, teklif claim'i ondan sonra — ajan ölçer ve kilit envanterine göre sıralar.

### 3.5 Defter mi, durum mu — özet

| Tablo | Sınıf | Hard delete |
|---|---|---|
| `WeftSpecYarn` | ③b yapılandırma pivotu | replace (audit'li) |
| `CostParameterSet` | DURUM + donmuş sürüm | yalnız hiç yürürlüğe girmemiş taslak (④) |
| `YarnCostPrice`, `FinishingRate` | ③a ticari pivot, damgalı sürüm | YOK |
| `CostStructure` | katalog (canlı ayar) | YOK (ürün pasife alınınca yaşar) |
| `StandardCostVersion/Line` | donmuş fotoğraf | YOK |
| `SalesQuote/Line` | durum + donmuş belge (SENT sonrası değişmez) | yalnız DRAFT (④) |
| `PriceList/Line` | durum + donmuş belge | yalnız DRAFT (④) |

Hiçbiri miktar/para bakiyesi yürütmez → `scripts/lib/defter-beyan.ts`e ileri/ters kaynak beyanı GEREKMEZ; beyan tarayıcısı yeni modeli sınıflandırma isterse KATALOG/SNAPSHOT olarak yazılır (ajan ölçer).

---

## §4 · Akışlar

### 4.1 Ürün yapısı girişi (dokuma iş emri formu v2 ile ilişki)
1. Çözgü kartı (`WarpSpec`) bugünkü ekrandan; take-up ve tarak eni doldurulması maliyet için ÖNERİLİR (boşsa uyarı).
2. Atkı kartı (`WeftSpec` + `WeftSpecYarn`) S2 ekranından: toplam sıklık + iplik bileşenleri (rapordaki atkı adedi).
3. Ürün kartı (`Item`): `warpSpecId`, `weftSpecId`, ham/mamul en (S2).
4. Dokuma iş emri formu v2 (S2, `dokuma.orderFormV2`) çözgü→atkı→desen→ham kalite seçtirir ve `suggest-item` ile ürünü bulur/önerir — böylece ürün yapısı üretim yaparken DOĞAR, maliyet ayrıca yapı girdirmez.
5. Maliyet kartı (MAL) yalnız kartta olmayanları ister (devir, randıman, fireler, tarife, çekme, ek kalem); hepsi boş bırakılabilir (parametre varsayılanı).

### 4.2 Maliyet hesaplama
- **Tek motor:** `src/services/helpers/fabric-cost.helper.ts` — saf, DB'siz, Decimal: `computeFabricCost(input) → {sonuc|null, eksikler, uyarilar}` ve onun alt kümesi `yarnUsagePerM(input)` (ihtiyaç planı yalnız kg ister). İstemci (panel) HESAP YAPMAZ, `POST /api/cost/preview` çağırır (debounce).
- **Tek derleyici:** `src/services/helpers/cost-input.helper.ts` `assembleCostInputTx(tx, {itemId | adHoc}, overrides)` — kartlardan, aktif parametre setinden, aktif iplik fiyatlarından, tarifeden, kurdan `CostInput` kurar (Sınıf 5: tek assembler; tüketici tabloya gitmez).
- **Kur:** girdi `fxRates` elle verilebilir; verilmezse finans AÇIKSA `resolveExchangeRateTx` (köprü, aşağıda) hesap gününe en yakın önceki kuru önerir; bulunamazsa `FX_RATE_MISSING`. TRY daima 1.
- **Modül köprüleri (rejim kapısı):** maliyet servisleri `exchangeRate` (finans), `itemPrice`/`purchaseOrderLine` (ticaret), `yarnStock`/`yarnMovement` (iplik) modellerine DOĞRUDAN dokunmaz — dokunsa `test_*_regime_gate` tarayıcıları MAL rotalarına o modüllerin kapısını şart koşardı. Bunun yerine `src/services/helpers/maliyet-bridge.helper.ts` DİNAMİK import ile ilgili servisi çağırır ve ÖNCE `readFinanceEnabled/readTicaretEnabled/readIplikEnabled/readDevereEnabled` (lisans tavanlı varyant) okur; kapalıysa sorgu ATMADAN `null` ("bilinmiyor") döner (emsal `customer-finance-bridge.helper.ts`).
- **Standart maliyet kaydı:** `POST /api/cost/items/:itemId/versions {reason?, fxRates?}` → motor; eksik varsa 400; yoksa tek tx'te önceki ACTIVE → SUPERSEDED, yeni sürüm + kalemler; `inputHash` yazılır; audit tx dışında.
- **Ölçülmüş fire önerisi:** `beamResultReport({from: bugün−180, to: bugün, warpSpecId})` (tek kaynak) — `summary.firePct` ve kapanmış ölçülebilir levent sayısı ≥ 3 ise öneri; köprüden (devere kapalıysa null).

### 4.3 Teklif: oluştur → gönder → kabul → siparişe dönüştür
1. **Oluştur** (`POST /api/quotes`, `quote:write`, `clientToken`): cari (müşteri rolü), tarih, geçerlilik, para birimi, kur (elle ya da öneri). Kalem ekle: ürün seç (aktif standart sürüm varsa onu kullanır, yoksa canlı hesap — uyarı "standart maliyet yok") YA DA "yeni desen" (elle yapı; `itemId` boş). Fiyat önerisi TEK helper `resolveQuotePriceSuggestion`: yayınlanmış müşteri listesi > yayınlanmış genel liste > `ItemPrice(SALE)` (köprü, ticaret açıksa) > maliyet × (1 + kâr). Kalemin `costSnapshot`ı, `costPerMTry`ı ve `suggestedUnitPrice`ı yazıldığı an DONAR.
2. **Düzenle** yalnız DRAFT (claim `WHERE status='DRAFT'`); "maliyeti tazele" eylemi kalemin snapshot'ını yeniden kurar (yalnız taslakta).
3. **Gönder** (`POST /:id/send`): DRAFT → SENT; boş teklif 400; kur > 0 zorunlu; SENT teklif DEĞİŞMEZ (kalem uçları 409).
4. **Kabul/Ret** (`quote:convert` / `quote:write`): SENT → ACCEPTED (`customerReference` opsiyonel; süresi dolmuşsa 409) ya da REJECTED (sebep zorunlu, `ReasonPreset` kataloğu varsa oradan). Kabulü geri al: ACCEPTED → SENT (dönüşmemişse).
5. **Siparişe dönüştür** (`POST /:id/convert {clientToken}`): izin `quote:convert` VE kullanıcı `order:write` taşımalı (yoksa 403 `PERMISSION_DENIED`, `details.required: ["order:write"]`). Her kalemin `itemId`si dolu olmalı, değilse 400 `QUOTE_LINE_ITEM_MISSING` + `details.lines[]` (çare: kaleme ürün bağla — S2 `suggest-item` önerisiyle). Sipariş `OrderService.prepareOrderCreate` + `insertPreparedOrderTx` ile (bulut gelen kutusu emsali), AYNI tx'te teklif claim'i ACCEPTED → CONVERTED + `convertedOrderId`. Sipariş kalemi: ürün, renk, en, miktar, birim, `unitPrice = teklif.unitPrice`, sipariş `currency = teklif.currency`. Replay token-replay boğazından.
6. **Revizyon** (SENT/REJECTED): eski → SUPERSEDED, yeni DRAFT aynı numara `revisionNo+1`, kalemler kopyalanır (snapshot'lar YENİDEN kurulmaz — kullanıcı "tazele" der).
7. Siparişin sonradan iptali sipariş alanının işidir; teklif CONVERTED kalır ve detayda sipariş durumunu gösterir.

### 4.4 Fiyat listesi
Oluştur (genel ya da müşteriye) → satırları "standart maliyetten doldur" (aktif sürüm × (1 + kâr), 2 haneye) ya da elle → yayınla (aynı müşteri+döviz için önceki PUBLISHED → ARCHIVED, tek tx) → belge/Excel (MAL-6). v1'de **sipariş formunun fiyat önerisi DEĞİŞMEZ** (`resolveItemPrice` zinciri bugünkü gibi; veto §8-5).

### 4.5 İplik ihtiyaç raporu (`GET /api/reports/maliyet/iplik-ihtiyaci`, `report:yarn-need`)
1. Talep: açık sipariş kalemleri — `ACTIVE_LINE` + `MEASURED_LINE` + sipariş durumu açık (tek kaynaklar); kalan = `quantity − shippedQty`. Seçenek `netle=true` (varsayılan): `ProductionBalanceService` dengesiyle (talep − depo − üretimde) — zaten dokunmuş kumaş iplik istemez.
2. Ürün → yapı → `yarnUsagePerM` → iplik başına kg (çözgü ve atkı ayrı kolon).
3. Hazır çözgü (devere açıksa): aynı çözgü kartının READY/MOUNTED leventlerinin kalan metresinin kumaş karşılığı çözgü ihtiyacından düşülür (kalan tek kaynak `remainingByBeam`).
4. Stok (iplik açıksa): `YarnStock` toplamı; emanet açıksa sahipli lotlar AYRI kolon, serbest stoktan düşülür. İplik kapalıysa "bilinmiyor" (0 DEĞİL).
5. Açık alış (ticaret açıksa): `qty − receivedQty`, alış siparişi OPEN/PARTIAL, kalem birimi KG; değilse yalnız stok.
6. Eksik = max(0, ihtiyaç − serbest stok − açık alış). `meta`: "yapısı eksik ürünler" (kalem sayısı, metre), "ölçülemeyen kalemler" (KG/ADET birimli), kaynak beyanları (stok/alış/levent düşüldü mü). Excel = ekran (tek kolon çözücüsü). Para YOK → `cost:read` gerektirmez.

---

## §5 · UI

Panel menüsünde yeni grup **"Maliyet & Teklif"** (modül kapalıysa çizilmez; karo izinleri route ile aynı liste). Tablet ekranı YOK.

```
┌ Maliyet Kartları ───────────────────────────────────────────── [Hızlı hesapla] ┐
│ Ara: [________]  Durum: (Hepsi|Yapı eksik|Girdi değişti|Güncel)                │
│ Ürün            Çözgü     Atkı       Std. maliyet  Sürüm  Tarih       Durum    │
│ KRISTAL 300     CZ-75/9600 AT-150+300  77,04 TL/m   v3    22.10.2026  ●Güncel  │
│ LINO 280        CZ-50/7200 —            —            —     —          ▲Yapı eksik│
│ SAHRA 320       CZ-75/9800 AT-150       64,10 TL/m   v1    01.09.2026  ◆Girdi değişti│
└────────────────────────────────────────────────────────────────────────────────┘
┌ KRISTAL 300 — Maliyet kartı ───────────────────────────────────────────────────┐
│ [Yapı] [Döküm] [Sürümler]                                                       │
│ Yapı: Çözgü CZ-75 (9600 tel, 75 den, çekme %6)  Atkı AT-1 (28/cm: A 1, B 1)      │
│  Devir [600] Randıman [85]% Çözgü fire [ ] (ölçülmüş %2,5 · 7 levent) Atkı fire [ ]│
│  Tarife [Boyahane X — 18,00 TL/m ham ▼] Boy çekmesi [4]% Kalite fire [ ]%        │
│ Döküm (TL/m):  Çözgü 7,72 · Atkı 21,80 · Makine 10,98 · İşçilik 2,86 ·           │
│   Enerji 1,76 · Hazırlık 1,60 = Ham 46,71 → Mamul 67,41 → Sağlam 68,79 →         │
│   Genel gider 8,25 → STANDART 77,04         Uyarılar: ⚠ çekme kartta yok (varsayılan)│
│ Kur: USD 34,0000 (TCMB 22.10)  EUR [____]        [Önizle] [Standart olarak kaydet]│
└────────────────────────────────────────────────────────────────────────────────┘
┌ Teklif TKF-26-00042 /R1 — Taslak ──────────────────────────────────────────────┐
│ Müşteri [ABC Tekstil ▼]  Tarih 24.10.2026  Geçerlilik [07.11.2026]  Döviz [USD▼] │
│ Kur [34,0000] (öneri: TCMB 23.10)  Vade [60] gün  Komisyon [ ]%  Navlun [ ]     │
│ # Ürün/Tanım      Renk  En   Miktar  Maliyet*  Kâr%*  Önerilen  Fiyat  Tutar   │
│ 1 KRISTAL 300     Krem  300  5.000 m  2,2659   18     2,6737   [2,67]  13.350,00│
│ 2 Yeni desen ✎    —     280  2.000 m  1,9811   20     2,3773   [2,38]   4.760,00│
│                                         * yalnız maliyet izni olana görünür      │
│ [Kalem ekle] [Yeni desen] [Maliyeti tazele]        Toplam 18.110,00 USD          │
│ [Kaydet] [Gönder] [Sil]                                                          │
└────────────────────────────────────────────────────────────────────────────────┘
┌ İplik İhtiyaç Planı ──────── Netle: [x] Hazır leventleri düş: [x] [Excel] ─────┐
│ İplik        Çözgü kg  Atkı kg  İhtiyaç  Serbest stok  Emanet  Açık alış  EKSİK │
│ PES 75 den    436,4      —       436,4     120,0          —      200,0     116,4│
│ PES 150 den    —        372,9    372,9     500,0          —        —         0,0│
│ Yapısı eksik: 3 ürün (4.200 m) · Ölçülemeyen: 1 kalem (KG)                       │
└────────────────────────────────────────────────────────────────────────────────┘
```

Diğer sayfalar: **Maliyet Parametreleri** (yürürlükteki + taslak yan yana, fark vurgusu, "Yürürlüğe al" onay modalı etkilenen hiçbir kaydı değiştirmediğini söyler), **İplik Maliyet Fiyatları** (iplik başına aktif fiyat, kaynak, yaş; "öneri al" ticaret/iplik açıksa son alış ve kart fiyatı), **Fason Tarifeleri**, **Hızlı Hesaplayıcı** (M0: ürün seç ya da elle yapı + elle iplik; kayıt yazmaz; "Teklife ekle"), **Teklifler** listesi (sunucu süzmeli: durum, müşteri, tarih, süresi dolan; özet şeridi aynı where'den), **Fiyat Listeleri**. Seçiciler doğrudan modal açar (combobox yok; kullanıcı UI tercihi).

**Patron uygulaması (MAL-8):** "Teklifler" listesi + detay (jenerik `kayit/[projeksiyon]/[id]`), durum ve geçerlilik herkese (`bulut:teklif:oku`), tutar/kur/maliyet/marj yalnız `bulut:maliyet:oku` olana; "Standart maliyetler" salt-okunur liste. Uygulama aritmetik yapmaz; her sayı fabrikada hesaplanmış alandır.

---

## §6 · Dilimler

Ortak: her dilim kendi worktree'sinde, PR + CI yeşil + squash merge; Opus high. `schema.prisma`ya dalga başına TEK ajan. Bekçi adları öneri: yeni bekçi `Teks-Erp/scripts/test_<ad>.ts`, negatif sonda ile kırmızı verdiği ÖLÇÜLÜR ve sonuç commit mesajına yazılır.

| Kod | İş | Şema | Bağımlılık | Dalga |
|---|---|---|---|---|
| **MAL-0** | Modül anahtarı `maliyet.enabled` (emanet emsali 14 adım) + lisans tavanı + satıcı modül kataloğu + `requireMaliyetEnabled` + kural metni düzeltmesi | grandfathering migration | — | W1 |
| **MAL-1** | Yapı ve girdi şeması: (`WeftSpecYarn` S2'de yoksa) `CostParameterSet`, `YarnCostPrice`, `FinishingRate`, `CostStructure` + CRUD uçları + izinler `cost:read/write/settings` + rejim bekçisi | VAR | MAL-0, S2 (ya da Seçenek B) | W2 |
| **MAL-2** | Motor (`fabric-cost.helper`) + derleyici + köprü + önizleme ucu + `StandardCostVersion/Line` + sürüm uçları + formül bekçisi (altın §2.3) | VAR | MAL-1 | W3 |
| **MAL-3** | Panel: Parametreler, İplik fiyatları, Fason tarifeleri, Maliyet kartları, Hızlı hesaplayıcı | yok | MAL-2 | W4 |
| **MAL-4** | Teklif + fiyat listesi backend: modeller, seriler, durum makinesi, öneri helper'ı, dönüştürme, maliyet görünürlüğü | VAR | MAL-2 | W4 |
| **MAL-5** | Panel: Teklifler, teklif formu/detay, Fiyat listeleri | yok | MAL-4 | W5 |
| **MAL-6** | Belge: `SALES_QUOTE` + `PRICE_LIST` veri sözleşmesi + sistem şablonu + Excel (PDF = Excel) | ADD VALUE | MAL-4 + belge tasarımcısı T0 | W6 |
| **MAL-7** | İplik ihtiyaç planı: rapor servisi + uç + rapor kataloğu + panel sayfası + Excel | yok | MAL-2 | W5 |
| **MAL-8** | Patron bulutu: `teklif`, `teklif-kalemi`, `standart-maliyet` projeksiyonları + bulut izinleri + uygulama ekranı + katalog özeti | yok (fabrika şeması) | MAL-4 | W6 |

### Bekçiler ve negatif sondalar (özet; ayrıntı istemlerde)

- **MAL-0:** `test_module_flags` · `test_module_grandfathering` (BEKLENEN `maliyet.enabled=false`) · `test_module_profile` · `test_feature_flag_contract` · `test_module_flag_off` · `test_lisans_modul_tavani` (§1 on bir anahtar) · `test_rapor_kapisi` · satıcı/patron bekçileri. Sonda: grandfathering migration `true` yazar → kırmızı; `MODULE_SETTING_KEYS`ten anahtar düşer → `test_module_flags` kırmızı.
- **MAL-1:** `test_maliyet_girdileri` (yeni: parametre seti tek ACTIVE/tek DRAFT, ACTIVE değişmez 409, yürürlüğe alma yarışı 409; iplik fiyatı damga sürümü + partial unique; tarife sürümü; yüzde CHECK'leri) · `test_maliyet_regime_gate` (yeni, `scripts/lib/regime-gate-scan.ts` ile: MAL modellerine dokunan servisi import eden HER rota `requireMaliyetEnabled` taşır) · `test_schema_drift` · `test_db_invariants` · `test_audit_labels` · `test_permission_catalog` · `test_role_template_catalog` · `test_screen_catalog` · `test_route_auth_coverage` · `test_route_mount_reachability` · `test_swagger_spec` · `test_master_data_merge_fk_coverage` (yeni `Item`/`Customer`/`Subcontractor` FK'ları birleştirmede taşınır). Sondalar: rotadan kapıyı sil → rejim bekçisi kırmızı; ACTIVE seti güncelleyen yol aç → 409 testi kırmızı.
- **MAL-2:** `test_maliyet_formul` (DB'siz; §2.3 altın değerler kuruşu kuruşuna; TRY kur = 1; kur yok → `FX_RATE_MISSING`, ASLA 1; take-up NULL + varsayılan → uyarı, varsayılan da yok → eksik; pay normalizasyonu; ham satış F=0) · `test_standart_maliyet_surum` (DB: sürüm donar — parametre/fiyat değişince eski sürüm sayısı DEĞİŞMEZ; tek ACTIVE; `inputHash` bayatlık; köprü modül kapalıyken sorgu atmaz) · `test_rapor_levent_sonucu` (m/sa Decimal ikizi sonrası yeşil kalır). Sondalar: `(1 − t)` → `(1 + t)` (altın kırmızı) · kur null'da 1'e düş (kırmızı) · sürüm kaydında snapshot yerine canlı girdi oku (donma testi kırmızı) · köprüde modül kontrolünü kaldır (sorgu sayacı kırmızı).
- **MAL-3:** Electron vitest (sayfa servisleri, izin/karo hizası, modül kapalıyken menü yok) + `test_screen_catalog` + e2e güzergâh adımı ve ekran görüntüsü.
- **MAL-4:** `test_teklif_durum` (her geçiş + 409 + CHECK seddi) · `test_teklif_donusum` (sipariş doğar, idempotent replay, `order:write` yok → 403, kalemde ürün yok → 400 liste, yarış) · `test_teklif_maliyet_gorunurlugu` (`cost:read` olmayan yanıtta maliyet/kâr/önerilen YOK; müşteri sözleşmesinde iç kolon YOK) · `test_fiyat_listesi` (tek PUBLISHED, yayınlı satır 409, revizyon) · `test_number_series` · `test_token_replay_kimlik_tablosu` · `test_maliyet_regime_gate`. Sondalar: dönüşümde `order:write` kontrolünü kaldır → kırmızı; görünürlük süzgecini kaldır → kırmızı; CHECK'i migration'dan çıkar → db_invariants kırmızı.
- **MAL-5:** Electron vitest + ekran görüntüsü (form, detay, maliyet sütunları izinsiz kullanıcıda yok).
- **MAL-6:** belge tasarımcısının PDF = Excel eşdeğerlik bekçisi + `test_teklif_belgesi` (donma: gönderilmiş teklif değişmez, iç not ve maliyet sözleşmede yok, VOIDED filigranı iptalde) + `test_audit_labels` (enum değeri). Sonda: sözleşmeye `costPerMTry` ekle → sızıntı bekçisi kırmızı.
- **MAL-7:** `test_iplik_ihtiyaci` (iptal kalem sayılmaz; KG kalem "ölçülemedi"; iplik kapalı → stok `null`; ticaret kapalı → alış düşülmez; hazır levent düşümü; emanet lot ayrı; yapısı eksik ürün listede) + `test_order_line_scope_single_source` (yeni dosya tarayıcı kapsamında) + rapor kataloğu bekçileri. Sondalar: `ACTIVE_LINE` yerine elle `cancelledAt` → tek kaynak bekçisi kırmızı; stok null yerine 0 → kırmızı.
- **MAL-8:** `test_bulut_projeksiyon_allowlist` (§3 tutar/maliyet kök satırda YOK, `.finans`ta; §4 türetilmiş `suresiDoldu` fabrikadan, geçiş kaynağı `gecerlilik`) · `test_bulut_silme_damgasi` (yeni kök tablolar) · `test_bulut_ham_update` · `test_bulut_tel_aynasi` · `test_katalog_ozeti` · bulut `test_izin_suzmesi` · uygulama `mirror.test.ts`, `format.test.ts`. **"Bulut hesap yapmaz" sondası:** `brutMarjPct` türetmesini projeksiyondan kaldırıp uygulamada hesapla → allowlist §4 ve uygulama format bekçisi kırmızı.

**Kabul (modül düzeyi).** (1) Modül kapalı kurulumda sıfır fark (rejim + flag_off bekçileri). (2) §2.3 örneği panelde birebir aynı sayıları verir. (3) Fiyat/parametre değişince eski standart sürüm ve eski teklif sayıları değişmez, kart "Girdi değişti" der. (4) Kabul edilen teklif tek tıkla doğru fiyat/dövizle sipariş olur, tekrar tıklama ikinci sipariş doğurmaz. (5) Satış kullanıcısı maliyet/kâr göremez (panel, API, PDF, bulut). (6) İplik ihtiyaç raporu stoğu bilinmeyeni "bilinmiyor" diye yazar.

---

## §7 · Riskler

1. **S2 gecikmesi / atkı modeli.** Atkı ipliği yoksa M0 yalnız elle yapıyla çalışır, M1 durur. Çare §3.1 Seçenek B; karar gerekir.
2. **Veri kalitesi.** Çoğu `WarpSpec.takeUpPct` NULL, `linearDensityDen` elle; maliyet "varsayılan" uyarılarıyla dolabilir. Kart listesinde "yapı eksik/varsayılan" süzgeci bunu görünür kılar; sessiz 0 yok.
3. **Tek iplik birimi denye.** Pamuk (Ne) kullanan müşteride dönüşüm `resolveDenier`e eklenene dek elle denye girilir.
4. **İki fiyat kaynağı.** `ItemPrice(SALE)` ile `PriceList` aynı soruya cevap verebilir. v1 teklif öneri helper'ı ikisini tek zincirde birleştirir, sipariş formu değişmez; sipariş formunun da bu helper'a bağlanması ayrı karar (§8-5). Ayrıca `defter.md` ③a (`ItemPrice` damgalı sürüm) ile `finans.md` ("`ItemPrice` fiziksel silinir") çelişiyor — MAL bu tabloya YAZMAZ, çelişki sahibine (finans/ticaret) bildirilir.
5. **Rejim kapısı tarayıcıları.** Köprüler dinamik import ile kapıyı aşar; bu bilinçli bir kaçıştır ve her köprü çağrısının önünde modül okuması olmalıdır — `test_standart_maliyet_surum` sorgu sayacıyla ölçer. Köprü dışında finans/ticaret/iplik modeline doğrudan erişim bekçiyle yasak.
6. **Birleştirme (merge) FK kapsamı.** Yeni tablolar `Item`, `Customer`, `Subcontractor`a FK taşır; ana veri birleştirmesi bunları taşımazsa birleştirme 500 verir ya da kayıt yetim kalır — `test_master_data_merge_fk_coverage` her şema diliminde koşar.
7. **Sipariş kalemi hassasiyeti.** `OrderLine.unitPrice Decimal(12,2)`; teklif fiyatı aynı hassasiyette kesinleşir, öneri 4 hane ayrı saklanır — dönüşümde yuvarlama farkı doğmaz.
8. **Dönüştürme kilit sırası.** Sipariş yazıcısının kilidi/tx biçimi teklif claim'iyle aynı tx'e girer; yanlış sıra ölü kilit üretir (40P01 → 409). MAL-4 ajanı `insertPreparedOrderTx`i okuyup sırayı ölçer.
9. **Patron bulutu dağıtım sırası.** Bulut eşlenmeyen projeksiyonu REDDEDER → patron sunucusu (katalog + izin) ÖNCE, fabrika sonra; satıcı modül kataloğu da fabrikadan ÖNCE (`acikModuller` katı şema).
10. **Ölçülmüş fire yanıltıcılığı.** Levent sonucu raporunda top metre düzeltmesi levent tüketimini yeniden hesaplamıyor (dokuma.md H5) → öneri yalnız ÖNERİ'dir, kullanıcı onaylamadan yapıya yazılmaz; kaynağı ve levent sayısı yanında yazılır.
11. **Belge tasarımcısı T0 gecikmesi.** MAL-6 bekler; o güne kadar teklif ekrandan yönetilir ama PDF basılamaz (geçici ikinci renderer YAZILMAZ — sonra port borcu doğururdu).
12. **Lisans tavanı.** Modül lisans HAK'ında yoksa kapı 403 `LICENSE_MODULE`; satıcı kataloğuna eklenmeden müşteriye açılamaz.

---

## §8 · Veto listesi (kullanıcı onayı gereken kararlar)

1. **Atkı modeli:** S2 taslağındaki tekil `WeftSpec.yarnItemId` yerine çoklu `WeftSpecYarn` (rapordaki atkı adedi payı). S2 MAL'dan önce mi iner (A), yoksa MAL-1 S2'nin şema çekirdeğini mi üstlenir (B)? Öneri: A.
2. **Modül anahtarı:** `maliyet.enabled` on birinci modül olarak eklenir (emanet emsali). `modul-bayrak.md`deki "`MODULE_FLAG_KEYS` dokuzdur ve genişletilmez" cümlesi bayat (kodda on anahtar var); anlamı "modül OLMAYAN anahtar bu kümeye girmez" diye düzeltilir. Bağımlılık: `maliyetEnabled → productionEnabled`.
3. **Varsayılan KAPALI;** açık olduğu profiller yalnız test/deneme profilleri (`hepsi-acik`, `test-profilleri/acik.json`) ve "Tam" profili mi? Öneri: "Tam" dahil, diğerleri hayır.
4. **Lisans:** modül hangi lisans paketine girer; satıcı modül kataloğuna ekleme.
5. **Fiyat listesi ↔ `ItemPrice`:** v1'de sipariş formu öneri zinciri DEĞİŞMEZ; teklif öneri zinciri "müşteri listesi > genel liste > ItemPrice > maliyet + kâr". Sipariş formunun da bu zincire bağlanması sonraki karar.
6. **Formül seçimleri:** kâr = maliyet ÜSTÜ oran (markup), marj yalnız gösterilir · genel gider terbiye dahil sağlam metre maliyetine uygulanır · kalite firesi terbiye ve çekmeden SONRA · fason tarifesi HAM ya da MAMUL metre bazlı (KG bazı v1'de yok).
7. **İşçilik ve enerji parametreyle:** operatör saat ücreti × (1 / tezgah başı operatör), enerji sabit kWh/tezgah-saat; Personel ve sayaç modülleri gelince bağlanır.
8. **Teklif yalnız cari karta** verilir (aday müşteri için de müşteri rollü kart açılır); kalem birimi v1'de yalnız metre.
9. **Dönüştürme iki izin ister:** `quote:convert` + `order:write`. Yeni izin kodları: `cost:read`, `cost:write`, `cost:settings`, `quote:read`, `quote:write`, `quote:convert`, `price-list:read`, `price-list:write`, `report:yarn-need`; rol şablonu önerisi: Satış = `quote:read/write` + `price-list:read`; Muhasebe/Patron = hepsi; Planlama/Satınalma = `report:yarn-need`.
10. **Patron bulutu:** teklifin durumu `bulut:teklif:oku`, tutar/kur/maliyet/marj `bulut:maliyet:oku` (satış rolü tutarı görmez). Bulut kataloğunda "`maliyet.enabled` projeksiyonunun `.finans`ı kendi iznidir" kuralı eklenir.
11. **M2 (fiili maliyet) ve M3 (sapma/değerleme) bu paketin DIŞINDA;** B11 atkı tüketimi + fason fatura bağı + Personel sonrası yeniden planlanır.
12. **Teklif belgesi belge tasarımcısı T0'a bağlı;** T0 gecikirse PDF beklenir, geçici renderer yazılmaz.
