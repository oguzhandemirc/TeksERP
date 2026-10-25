# Maliyet (MAL)

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: MAL-2 (2026-10-25); plan `docs/design/MALIYET-TEKLIF-PLAN.md` §2 (formüller BAĞLAYICI), §3.2, §4.2. Hikâye ve gerekçe arşivde (`docs/history/arsiv/2026-10.md` "MAL-2 maliyet motoru"); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın ayarı.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Maliyet sayısını YALNIZ `services/helpers/fabric-cost.helper.ts` üretir; istemci (panel, teklif ekranı, Hızlı Hesaplayıcı) hesap yapmaz, `POST /api/cost/preview` çağırır. · bekçi: `test_maliyet_formul` (§1 altın)
- **[ÇEKİRDEK]** Formül kopyalanmaz: çözgü kg `warpYarnKgExact` (`constants/warp-beam.ts`), tezgah m/sa `theoreticalMPerHourDecimal` (`dokuma-levent-rapor.helper.ts`) çağrılır; sayı sürümü Decimal ikizine delege eder. · bekçi: `test_maliyet_formul` (§8, §9a–b), `test_rapor_levent_sonucu`
- **[ÇEKİRDEK]** Motorda `number` aritmetiği YASAK: tam `Prisma.Decimal`, yuvarlama yalnız sunumda/saklamada (TL/m 4, kg/m 6 hane, `ROUND_HALF_UP`). · bekçi: `test_maliyet_formul` (§9c)
- **[ÇEKİRDEK]** Kur yoksa `FX_RATE_MISSING` ve sonuç YOK; kur asla 1 varsayılmaz (TRY tanım gereği 1). Sürüm kaydı/geri alma bunu 400 `COST_INPUT_MISSING` (`details.missing[]`) ile reddeder; önizleme (`POST /api/cost/preview`) 200 + `sonuc: null` + `eksikler[]` döner ki panel neyin eksik olduğunu göstersin. · bekçi: `test_maliyet_formul` (§3), `test_standart_maliyet_surum` (§3a, §6c)
- **[ÇEKİRDEK]** Motor girdisini YALNIZ `assembleCostInputTx`/`buildCostInput` (`services/helpers/cost-assembler.helper.ts`) kurar; `cost-input.helper.ts` yalnız alan doğrulamasıdır (ürün/atkı servisleri import eder) ve model OKUMAZ — okursa maliyet rejim kapısı `item.routes`a sızar; her değer kaynağıyla (`KART|YAPI|PARAMETRE|OLCULMUS|ELLE`), öncelik plan §2.1; tüketici maliyet tablolarına ayrıca gitmez. · bekçi: `test_maliyet_girdi`
- **[ÇEKİRDEK]** Çözülemeyen terbiye tarifesi kodu eksik sayılır (`FINISHING_RATE_MISSING`), terbiye sessizce 0 olmaz. · bekçi: `test_maliyet_girdi` (§6c)
- **[ÇEKİRDEK]** Girdi fotoğrafı katı zod şemasından (`schemaVersion: 1`) geçmeden yazılmaz/okunmaz; `inputHash` = anahtar sıralı, bayraksız girdinin sha256'sı, kur hash'e girmez. · bekçi: `test_maliyet_girdi` (§8b–e)
- **[ÇEKİRDEK]** Standart maliyet sürümü DONAR: detay/liste saklanan `StandardCostVersion/Line` sayılarını okur, canlı girdiden yeniden hesaplamaz; girdi değişimi yalnız `girdiDegisti` rozetidir (saklanan `inputHash` ≠ canlı hash). Düzeltme ve geri alma YENİ sürümdür, eski satır değişmez. · bekçi: `test_standart_maliyet_surum` (§1d–f, §4)
- **[ÇEKİRDEK]** Ürün başına tek ACTIVE sürüm: önceki ACTIVE atomik claim ile `SUPERSEDED` olur (`count===0` → 409 `COST_VERSION_CONFLICT`), DB seddi kısmi unique `standard_cost_versions_active_uq`. · bekçi: `test_standart_maliyet_surum` (§2, §2b)
- **[ÇEKİRDEK]** Maliyet kodu finans/ticaret/iplik/devere modellerine YALNIZ `services/helpers/maliyet-bridge.helper.ts` üzerinden, önce `read<X>Enabled()` okuyup dinamik import ile erişir; modül kapalıyken öneri `null` ve o tablolara sorgu yok. · bekçi: `test_standart_maliyet_surum` (§5), `test_maliyet_regime_gate`, `test_finance_regime_gate`
- **[ÇEKİRDEK]** Ölçülmüş çözgü firesi yalnız ÖNERİDİR (`oneriler.warpWaste`, kaynak + levent sayısıyla); girdiye kendiliğinden girmez, kullanıcı `overrides.warpWastePct` + `warpWasteMeasured: true` ile uygular (kaynak `OLCULMUS`, uyarı `WARP_WASTE_MEASURED`). · bekçi: `test_maliyet_girdi`
- **[ÇEKİRDEK]** Önizleme hiçbir şey yazmaz (sürüm de audit de). · bekçi: `test_standart_maliyet_surum` (§6b)

## Panel (`Electron/src/pages/Cost/`)

- **[ÇEKİRDEK]** Maliyet ekranları sayı HESAPLAMAZ ve kuru 1 VARSAYMAZ: her tutar `POST /api/cost/preview` ya da kayıtlı sürüm alanıdır, istemci yalnız TR biçimine çevirir (`shared/format.ts`, metin → Intl); kur yoksa sunucunun `eksikler`i gösterilir. · bekçi: Electron `pages/Cost/cost-no-client-math.test.ts`
- **[ÇEKİRDEK]** "Maliyet & Teklif" menü satırı, hub karoları ve palet satırları `maliyetEnabled` (ETKİN: `production && maliyet`) + `cost:read` ile çizilir; karo izni route izniyle birebir; kapalı modülün 403 `MODULE_DISABLED` yanıtı "kapalı — <ayar yolu>" der. · bekçi: Electron `pages/Cost/cost-access.test.tsx`, `test_screen_catalog`
- **[ÇEKİRDEK]** Döküm toplamı sunucunun `standartTlM` alanıdır (satırlar toplanmaz); canlı önizleme gövde METNİ üzerinden ~400 ms durulur (aynı gövdeye ikinci istek yok); `COST_INPUT_MISSING` kayıt modalını kapatmaz, eksikler alana/ekrana bağlanır. · bekçi: Electron `pages/Cost/shared/CostBreakdown.test.tsx`, `shared/useCostPreview.test.tsx`, `shared/fx-missing.test.ts`
- **[ÇEKİRDEK]** `/api/cost/items` durum süzgeci yalnız `filter[durum]` (CSV) okunur — Express "simple" ayrıştırıcı anahtarı düz bırakır, çıplak `durum=` 400. · bekçi: `test_standart_maliyet_surum` §7d–e

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır).

**Ne ölçtükleri, DB gerektirip gerektirmedikleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `maliyet` bölümü** (MAL-1 bekçileri `modul-bayrak` bölümünde).

Panel (Electron vitest): `src/pages/Cost` (`cost-no-client-math`, `cost-access`, `shared/format`, `shared/errors`, `shared/CostBreakdown`, `shared/useCostPreview`, `shared/fx-missing`, `Items/service`), `src/pages/Items/ItemCostLink`

Backend: `test_screen_catalog`, `test_maliyet_formul`, `test_maliyet_girdi`, `test_standart_maliyet_surum`, `test_maliyet_girdileri`, `test_maliyet_regime_gate`, `test_finance_regime_gate`, `test_rapor_levent_sonucu`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/history/arsiv/2026-10.md` — "MAL-2 maliyet motoru" notu.
