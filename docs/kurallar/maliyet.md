# Maliyet (MAL)

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: MAL-2 (2026-10-25); plan `docs/design/MALIYET-TEKLIF-PLAN.md` §2 (formüller BAĞLAYICI), §3.2, §4.2. Hikâye ve gerekçe arşivde (`docs/history/arsiv/2026-10.md` "MAL-2 maliyet motoru"); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın ayarı.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Maliyet sayısını YALNIZ `services/helpers/fabric-cost.helper.ts` üretir; istemci (panel, teklif ekranı, Hızlı Hesaplayıcı) hesap yapmaz, `POST /api/cost/preview` çağırır. · bekçi: `test_maliyet_formul` (§1 altın)
- **[ÇEKİRDEK]** Formül kopyalanmaz: çözgü kg `warpYarnKgExact` (`constants/warp-beam.ts`), tezgah m/sa `theoreticalMPerHourDecimal` (`dokuma-levent-rapor.helper.ts`) çağrılır; sayı sürümü Decimal ikizine delege eder. · bekçi: `test_maliyet_formul` (§8, §9a–b), `test_rapor_levent_sonucu`
- **[ÇEKİRDEK]** Motorda `number` aritmetiği YASAK: tam `Prisma.Decimal`, yuvarlama yalnız sunumda/saklamada (TL/m 4, kg/m 6 hane, `ROUND_HALF_UP`). · bekçi: `test_maliyet_formul` (§9c)
- **[ÇEKİRDEK]** Kur yoksa `FX_RATE_MISSING` ve sonuç YOK; kur asla 1 varsayılmaz (TRY tanım gereği 1). · bekçi: `test_maliyet_formul` (§3)
- **[ÇEKİRDEK]** Motor girdisini YALNIZ `assembleCostInputTx`/`buildCostInput` (`cost-input.helper.ts`) kurar; her değer kaynağıyla (`KART|YAPI|PARAMETRE|OLCULMUS|ELLE`), öncelik plan §2.1; tüketici maliyet tablolarına ayrıca gitmez. · bekçi: `test_maliyet_girdi`
- **[ÇEKİRDEK]** Çözülemeyen terbiye tarifesi kodu eksik sayılır (`FINISHING_RATE_MISSING`), terbiye sessizce 0 olmaz. · bekçi: `test_maliyet_girdi` (§6c)
- **[ÇEKİRDEK]** Girdi fotoğrafı katı zod şemasından (`schemaVersion: 1`) geçmeden yazılmaz/okunmaz; `inputHash` = anahtar sıralı, bayraksız girdinin sha256'sı, kur hash'e girmez. · bekçi: `test_maliyet_girdi` (§8b–e)

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır).

**Ne ölçtükleri, DB gerektirip gerektirmedikleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `maliyet` bölümü** (MAL-1 bekçileri `modul-bayrak` bölümünde).

Backend: `test_maliyet_formul`, `test_maliyet_girdi`, `test_maliyet_girdileri`, `test_maliyet_regime_gate`, `test_rapor_levent_sonucu`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/history/arsiv/2026-10.md` — "MAL-2 maliyet motoru" notu.
