# Maliyet (MAL)
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/maliyet.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın ayarı. Plan `docs/design/MALIYET-TEKLIF-PLAN.md` §2 (formüller BAĞLAYICI), §3.2, §4.2.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Standart ürün maliyetini YALNIZ `services/helpers/fabric-cost.helper.ts`, dönem kârlılığını YALNIZ `profitability.helper.ts` (+ `profitability-cost`/`-finance`/`-machine`/`-overhead`) üret; ikisi birbirini import etmez; istemci hesap yapmaz, `POST /api/cost/preview` çağırır.
- [ÇEKİRDEK] Kârlılık geliri YALNIZ onaylı hizmet faturası satırı net tutarı × belge kuru; aynı kalemin bağlarına `billedMeters` payıyla (son bağ kalanı alır); ay = fatura tarihinin fabrika ayı; taslak ayrı kolon, katkıya girmez; iptal İPTAL AYINDA eksi satır, geçmiş ay değişmez.
- [ÇEKİRDEK] Kârlılıkta eksik norm/fiyat/kur/gelir satırı/fason makbuzu → `null` katkı + kod (0 değil); dış fason paydası donmuş metre (canlı `currentQty` değil, NULL kalemli top bir kez); sonuç saklanmaz, `maliyet.karlilik.*` okumada uygulanır; maliyet/finans kapalıyken `null` ve sorgu yok.
- [ÇEKİRDEK] Kârlılıkta iş listesini yeniden yazma (bağdan oku); `rollProperty`/`rollMeterReading` okuma — tek istisna makine-saat paydası, yalnız `meter-reading-work.helper`ten.
- [ÇEKİRDEK] Makine süresini `work_sessions`ten YALNIZ OKU (`work-session.helper` yazımına dokunma); IDLE kapanan/açık oturumun etkin sonu `lastActivityAt`; makine-gün süresi × as-of saat ücreti o günün ölçülen metresine bölünür.
- [ÇEKİRDEK] Makine işi = makine × top × adım, günü İLK okumanın günü (düzeltme/faz kaydırmaz), metresi as-of gün sonu, yalnız `meter-reading-work.helper`; aynı okumaya bağlı kalemler süreyi BÖLÜŞÜR (tek sayım); metresiz gün "boşta makine".
- [ÇEKİRDEK] Genel gider/işçilik havuzu kasa masrafından (`expense-summary.helper`) okunur; `genelGiderAnahtari=YOK`ta dağıtılmaz (net = katkı).
- [ÇEKİRDEK] Masraf bağını YALNIZ `listExpenseAllocationsAsOf`ten (köprü `readExpenseAllocationPieces`) oku: ay sonunda geçerli bağ payı kendi sınıf havuzundan düşüp hedefin (makine/iş emri/hizmet kalemi) o ay faturalanan satırlarına metreyle doğrudan masraf olur.
- [ÇEKİRDEK] Önceki ay masrafına sonradan bağ = değişim ayında "geç bağ düzeltmesi"; iptal edilen bağlı masraf iptal ayında ters çevrilir; bağ yoksa ya da `finance.masraf.bagAlani=OFF` rapor bayt-aynı.
- [ÇEKİRDEK] Kârlılık raporunu (`maliyet/karlilik`) yalnız `profitability.helper` satırlarından topla: sunum (`reports/profitability.sunum.ts`) katkı/net hesaplamaz, eksiği 0 yazmaz (boş + "eksik" rozeti), ayar özetini `hesap` beyanıyla ekrana ve Excel/PDF'e taşır; panel sayfası hesap yapmaz.
- [ÇEKİRDEK] Formül kopyalama: çözgü kg `warpYarnKgExact` (`constants/warp-beam.ts`), tezgah m/sa `theoreticalMPerHourDecimal` (`dokuma-levent-rapor.helper.ts`) çağrılır; sayı sürümü Decimal ikizine delege eder.
- [ÇEKİRDEK] Motorda `number` aritmetiği YASAK: tam `Prisma.Decimal`; yuvarlama yalnız sunumda/saklamada (TL/m 4, kg/m 6 hane, `ROUND_HALF_UP`).
- [ÇEKİRDEK] Kur yoksa `FX_RATE_MISSING`, sonuç YOK; kuru asla 1 varsayma (TRY tanım gereği 1). Sürüm kaydı/geri alma 400 `COST_INPUT_MISSING` (`details.missing[]`); önizleme (`POST /api/cost/preview`) 200 + `sonuc: null` + `eksikler[]`.
- [ÇEKİRDEK] Motor girdisini YALNIZ `assembleCostInputTx`/`buildCostInput` (`helpers/cost-assembler.helper.ts`) kurar; `cost-input.helper.ts` alan doğrulamasıdır, model OKUMAZ; her değer kaynağıyla (`KART|YAPI|PARAMETRE|OLCULMUS|ELLE`), öncelik plan §2.1; tüketici maliyet tablosuna ayrıca gitmez.
- [ÇEKİRDEK] `maliyet.dokumaStandartYontemi` (varsayılan `TEZGAH_SAATI`) YALNIZ `loadCostSourcesTx`te okunur; `ATKI_UCRETI`de girdiye `loomPick` yazılır, motor TEK `WEAVING_PICK` satırı üretir (atkı/cm × ücret × kur; ücret YAPI > PARAMETRE, yoksa `PICK_RATE_MISSING`).
- [ÇEKİRDEK] `TEZGAH_SAATI`de `loomPick` anahtarı YAZILMAZ (girdi/hash bayt-aynı); `loomMPerHour` okuyucusu null'a hazırdır.
- [ÇEKİRDEK] Dokuma GERÇEK maliyetini yalnız `weavingActualCostTx`ten (`helpers/weaving-actual-cost.helper.ts`) oku: pay = koşum tezgâh saati × as-of ücret; "saat × ücret" yalnız `profitability-machine.helper` `machineRateAt`/`normHours`/`machineHourCostTry` (ikinci çarpım YAZMA, K7).
- [ÇEKİRDEK] Dokuma gerçek maliyet paydası = canlı top metresi A + B (`liveRollMetersByWeavingOrder`; yalnız CANCELLED girmez, `K18_DEAD_STATUSES` KULLANMA); sapma ana sayısına yalnız bitmiş iş; süre: `maliyet.karlilik.makineSuresi` NORM ise metre ÷ norm, diğerinde koşum; ikinci ayar açma.
- [ÇEKİRDEK] Dokuma gerçek maliyette koşumsuz iş, ücretsiz tezgâh, kursuz sunum "eksik"tir (0 değil); sonuç saklanmaz.
- [ÇEKİRDEK] Çözülemeyen terbiye tarifesi kodu eksik sayılır (`FINISHING_RATE_MISSING`); terbiye sessizce 0 olmaz.
- [ÇEKİRDEK] Ek işlemler (`CostStructureProcess`) `FinishingRate` kod uzayından çözülür, motorda `PROCESS` satırı: terbiyeden SONRA, kalite firesi/genel giderden ÖNCE (gider tabanına girer); çözülemeyen kod `FINISHING_RATE_MISSING`; pivot boşken `processes` anahtarı yazılmaz.
- [ÇEKİRDEK] `PUT structures` gövdesinde `processes` yoksa liste DEĞİŞMEZ; dizi sıralı tam kümedir; terbiyeyle aynı ya da tekrar eden kod 400.
- [ÇEKİRDEK] Terbiye kodu önceliği ELLE > varyant (`ProductRecipe.finishingRateCode`) > ürün yapısı > yok; varyant kodu yazımda aktif tarifeye çözülmeli (400 `COST_FINISHING_RATE_UNKNOWN`).
- [ÇEKİRDEK] `KG` tarife ham metre başına `birim × kg/m`; kg `maliyet.terbiyeKgTabani`ne göre (NET_HAM = take-up'lı firesiz çözgü + atkı · IPLIK_TUKETIMI = fireli `warpKgPerM + weftKgPerM`), girdiye `kgBase` DONAR; metre tarifede `kgBase` yazılmaz, ayar okunmaz.
- [ÇEKİRDEK] Kârlılığın dış fason tahmini KG tarifesini metreyle ÇARPMAZ → `DIS_FASON_TARIFESI` eksik.
- [ÇEKİRDEK] Standart maliyet sürümünün aktif tekilliği ve geçmişi (itemId, recipeId) zinciridir: varyant sürümü desen geneli sürümü kapatmaz; fiyat listesi doldurma anahtarı itemId + renk + recipeId.
- [ÇEKİRDEK] Varyantlı teklif kalemi yalnız kendi varyant sürümünü dondurur, yoksa canlı hesaplar — desen geneli sürüme düşmez (recipeId NULL = bugünkü davranış).
- [ÇEKİRDEK] Dokuma gerçek maliyetinde standart = iş emri varyantının ACTIVE sürümü, yoksa desen geneli ACTIVE; bulut `standart-maliyet` kaydı `varyantId` + `varyantAdi`/`varyantKodu` taşır, anahtar urunId + varyantId (desen genelinde null).
- [ÇEKİRDEK] Varyant maliyetinde atkı satırı varyantın atkı değişimini (`ProductRecipeWeftYarn`) kullanır (iplik, fiyat, etiket varyantın; pay/sıklık kartın; yoksa bayt-aynı); "bu sıradaki atkı ipliği ne" tek cevabı `weftOverrideFor`.
- [ÇEKİRDEK] Fason sevk kg kontrolü (`GET /api/cost/subcontractor-dispatches/:id/finishing-check`, `cost:read`) YALNIZ OKUR: beklenen = Σ kumaş topu `dispatchedWeight` × sevkin fabrika günü sonundaki `KG` tarifesi (yoksa ilk sürüm `rateFallback`; seçim yalnız `pickFinishingRateAtDispatch`).
- [ÇEKİRDEK] Fason kg kontrolünde kod `resolveFinishingRateCode`ten; tarife yok/metre tabanı/başka firmaya bağlı/kg yok → satır yok, 0 UYDURMA; iptal sevkte satır yok; fatura YALNIZ `finance:read` ∧ ön muhasebe açıkken okunur (aksi sorgu yok).
- [ÇEKİRDEK] Fason kg kontrolünde fatura tutarı KDV hariç net (subtotal − iskonto); farklı dövizde KUR ÇEVRİLMEZ (`currencyMismatch`, fark null); fark yalnız aynı para birimi, kabul bu sevke özgü ve sevkin TÜM kumaş toplarını kapsıyorsa.
- [ÇEKİRDEK] Fason tarife sürümünü iki yüzey bilerek farklı seçer: kârlılık tahmini kabul anı (`receivedAt`) + firma, fason kg kontrolü sevkin fabrika günü + kod; birini ötekine eşitleme.
- [ÇEKİRDEK] Girdi fotoğrafı katı zod şemasından (`schemaVersion: 1`) geçmeden yazılmaz/okunmaz; `inputHash` = anahtar sıralı, bayraksız girdinin sha256'sı; kur hash'e girmez.
- [ÇEKİRDEK] Standart maliyet sürümü DONAR: detay/liste saklanan `StandardCostVersion/Line`ı okur, yeniden hesaplamaz; girdi değişimi yalnız `girdiDegisti` rozeti (saklanan `inputHash` ≠ canlı); düzeltme ve geri alma YENİ sürüm, eski satır değişmez.
- [ÇEKİRDEK] Ürün başına tek ACTIVE sürüm: önceki ACTIVE atomik claim ile `SUPERSEDED` (`count===0` → 409 `COST_VERSION_CONFLICT`); DB seddi kısmi unique `standard_cost_versions_active_uq`.
- [ÇEKİRDEK] Maliyet kodu finans/ticaret/iplik/devere modellerine YALNIZ `services/helpers/maliyet-bridge.helper.ts` ile, önce `read<X>Enabled()` + dinamik import; modül kapalıyken öneri `null`, o tablolara sorgu yok.
- [ÇEKİRDEK] Ölçülmüş çözgü firesi yalnız ÖNERİ (`oneriler.warpWaste`, kaynak + levent sayısı); girdiye kendiliğinden girmez; kullanıcı `overrides.warpWastePct` + `warpWasteMeasured: true` ile uygular (kaynak `OLCULMUS`, uyarı `WARP_WASTE_MEASURED`).
- [ÇEKİRDEK] Çözgü firesi zinciri ELLE/OLCULMUS > YAPI (`CostStructure.warpWastePct`) > KART (`WarpSpec.wastePct`) > PARAMETRE; kart firesi boşken girdi bayt-aynı; aralık 0 ≤ x < 100 `WarpSpecService`te + DB CHECK'te.
- [ÇEKİRDEK] Önizleme hiçbir şey yazmaz (sürüm de audit de).
- [ÇEKİRDEK] `MachineCostRate` ve `ServiceConsumableNorm` "şu andan itibaren" damgalı sürüm: değişim aynı tx'te `updateMany WHERE {id, revokedAt: null}` (0 → 409 `*_STALE`) + yeni satır; kaldırma damga, hard delete yok.
- [ÇEKİRDEK] Ücret/normu YALNIZ `helpers/cost-rate-validity.helper.ts` (`machineCostRateValidAt`/`consumableNormsValidAt`) okur; norm yalnız SERVICE × CONSUMABLE kalemine; aktif norm iki kalemde canlı referans (`CONSUMABLE_NORM`, pasife alma 409), yazım `runItemUsageChecksTx` ile FOR SHARE kilitler.
- [ÇEKİRDEK] Sarf normu `qtyPerM = 0` "sarf kullanmaz" AÇIK beyanıdır (CHECK ≥ 0, negatif 400): kârlılık ölçülmüş 0 sayar, fiyat aramaz; hizmet anında geçerli norm satırı YOKSA sarf null + `SARF_NORMU` eksik (sessiz 0 yok).

## Teklif ve fiyat listesi (MAL-4)

- [ÇEKİRDEK] Teklif SENT sonrası DEĞİŞMEZ: kalem/başlık uçları tx başında `claimDraftQuoteTx`; düzeltme revizyon (eski SUPERSEDED + aynı numara `revisionNo+1` DRAFT, kalemler snapshot kopya); geçiş `claimQuoteTx`, tablo `QUOTE_TRANSITIONS`, ölü küme `QUOTE_DEAD_STATUSES`.
- [ÇEKİRDEK] "Süresi doldu" durum değil türetilmiş bayraktır (`isQuoteExpired` ↔ `quoteExpiredWhere`).
- [ÇEKİRDEK] Teklif fiyat önerisi TEK zincir (`helpers/quote-price.helper.ts`): yayınlı müşteri listesi > yayınlı genel liste > `ItemPrice(SALE)` (köprü, ticaret açıksa) > maliyet × (1 + kâr); başka dosya `suggestSalePrice` çağırmaz, yayınlı liste satırı okumaz.
- [ÇEKİRDEK] Teklif/fiyat listesi yanıtında maliyet alanları OPT-IN: `cost:read` yoksa kalem maliyeti, kâr, maliyet önerisi, fotoğraf, toplam maliyet, marj DÜŞER; iç not yalnız `quote:write`; her yanıt `quoteViewFor`dan geçer.
- [ÇEKİRDEK] Fiyat listesi yayını tek tx (aynı müşteri+döviz yayınlısı ARCHIVED + bu taslak PUBLISHED; seddi `price_lists_published_uq`); yayınlı liste DEĞİŞMEZ, düzeltme revizyondur.
- [ÇEKİRDEK] Teklifi siparişe dönüştürmek İKİ izin ister (rota `quote:convert` + servis `order:write`); sipariş ve teklif claim'i TEK tx (8036 token kilidi İLK ifade, sonra kart kilitleri); bağ teklifte (`convertedOrderId`); aynı `clientToken` aynı siparişi döndürür.
- [ÇEKİRDEK] Kâr varsayılanı TEK yoldan: `cost-calc.service` `resolveMarkup` (gövde ?? aktif parametre seti, yoksa 400); teklif, fiyat listesi ve hesaplayıcı önizlemesi aynı çözücüyü çağırır.
- [ÇEKİRDEK] Müşteri hizmet ücretini YALNIZ `resolveServiceItemsForRolls` (`helpers/service-pricing.helper.ts`) çözer: gramaj process-summary'den → değer, özellik, ana bayrak eşlemesi → `ItemPrice(SALE)` hizmet anına; `FinishingRate` gelir yolunda okunmaz.
- [ÇEKİRDEK] İplik ihtiyaç planı (`yarn-need.report.service.ts`): eksik = ihtiyaç − serbest stok − açık alış (KG) − hazır levent kalanı (SEPARATE_BEAM kendi kartının leventinden, zeminle AYNI düşüm yardımcısıyla; SHARED zemini izler; CREEL düşülmez).
- [ÇEKİRDEK] İplik ihtiyacında emanet stok düşülmez, ayrı kolon; kapalı modül kaynağı `null` ("bilinmiyor", 0 değil) ve sorgu yok; ekran/Excel/PDF aynı sunum `tablo`sundan, istemci hesap yapmaz.
- [ÇEKİRDEK] `ItemWarpLayer` motora `CostInput.warpLayers` olarak yalnız doluyken girer (yoksa girdi + `inputHash` + sonuç bayt-aynı); her katman zeminle AYNI `warpKg`yi çağırır; `warpKgPerM` toplamdır.
- [ÇEKİRDEK] SHARED_BEAM grubu varsa levent hazırlığı ve hazır levent düşümü en hızlı tükenen grubun take-up'ıyla; kip kararı yalnız `helpers/warp-layer-beam.helper.ts`.
- [ÇEKİRDEK] SEPARATE_BEAM katman firesini kendi çözgü kartından (KART) al; kartta yoksa ve SHARED_BEAM/CREEL'de zemin zincirini kullan; karar yalnız `layerOwnCardWastePct`; devere hazırlığı motor kalemi değil Ek işlem satırıdır.
- [ÇEKİRDEK] Kurşun birim metre fiyatını YALNIZ `helpers/kursun-gram-price.helper.ts` çözer: gramaj `amount` (gr/m) × gram fiyatı (cari özel > istasyon, fatura para biriminde); gramaj ya da fiyat yoksa `ItemPrice(SALE)`; açıklama "Kurşun <ad> (<gr> gr/m)", miktar METER.
- [ÇEKİRDEK] Gram fiyatı `finance.serviceBilling.kursunGramPriceBasis`e göre: `SERVICE_DATE` (varsayılan, K14) `KursunGramPriceVersion`ı kalem tarifesiyle AYNI ana okur (yoksa en eski + `gramPriceEnteredLaterWarning`); `INVOICE_DATE` kolon değeri + `gramPriceCurrentWarning`.

## Panel (`Electron/src/pages/Cost/`)

- [ÇEKİRDEK] Maliyet ekranları sayı HESAPLAMAZ, kuru 1 VARSAYMAZ: her tutar `POST /api/cost/preview` ya da kayıtlı sürüm alanı; istemci yalnız TR biçimine çevirir (`shared/format.ts`); kur yoksa sunucunun `eksikler`i gösterilir.
- [ÇEKİRDEK] "Maliyet & Teklif" menü, hub karoları ve palet `maliyetEnabled` (`production && maliyet`) + okuma izniyle çizilir (hub: `cost:read`|`quote:read`|`price-list:read`; karo izni = route izni); 403 `MODULE_DISABLED` "kapalı — <ayar yolu>" der.
- [ÇEKİRDEK] Döküm toplamı sunucunun `standartTlM` alanı (satırlar toplanmaz); canlı önizleme gövde METNİ üzerinden ~400 ms durulur (aynı gövdeye ikinci istek yok); `COST_INPUT_MISSING` kayıt modalını kapatmaz, eksikler alana bağlanır.
- [ÇEKİRDEK] Hızlı Hesaplayıcı (`Cost/Calculator`) gövdesini YALNIZ `calculator-body.ts` kurar: ürün XOR elle yapı; boş alan ve boş kur GÖNDERİLMEZ (0/1 yazılmaz); ekran teklif fiyatı göstermez.
- [ÇEKİRDEK] Teklif ekranları (`Cost/Quotes`) tutar/öneri/marj HESAPLAMAZ (toplam `totalAmount`); maliyet sütunu yalnız alan yanıttaysa (izni ikinci kez yorumlama); kesin fiyat 2 hane; yazma `suppressErrorToast` + hatayı KODUNA göre Türkçe (409'da yeniden oku).
- [ÇEKİRDEK] `/api/cost/items` durum süzgeci yalnız `filter[durum]` (CSV); çıplak `durum=` 400.
- [PROFİL] Sunum dövizi (`maliyet.sunumDovizi`, varsayılan TRY = bayt-aynı) sunucuda sürümün DONMUŞ `fxRates` kuruyla (önizleme günün kuruyla, `ONIZLEME`); istemci kura bölmez; kur yoksa döviz alanı null + `FX_MISSING`.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`. Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `maliyet` (MAL-1 bekçileri `modul-bayrak`).

Panel (Electron vitest): `src/pages/Cost` (`cost-no-client-math`, `cost-access`, `shared/format`, `YarnNeed/yarn-need`, `Reports/Maliyet/profitability` (`src/pages/Reports/Maliyet`), `shared/errors`, `shared/CostBreakdown`, `shared/useCostPreview`, `shared/fx-missing`, `Items/service`, `Items/ProcessesEditor`, `Calculator/calculator-body`, `Calculator/CalculatorPage`, `Quotes/*`), `src/pages/Items/ItemCostLink`, `src/pages/GeneralSettings/dokuma-maliyet-settings`

Backend: `test_kursun_gram_fiyati`, `test_kursun_gram_gecmisi`, `test_brode_fiyat_birimi`, `test_dokuma_gercek_maliyet`, `test_maliyet_atki_ucreti`, `test_brode_senaryo`, `test_maliyet_sunum_dovizi`, `test_maliyet_kg_tabani`, `test_fason_kg_kontrol`, `test_cozgu_katman_motor`, `test_cozgu_katman_levent`, `test_makine_ucreti_sarf_normu`, `test_kart_firesi`, `test_karlilik_cekirdek`, `test_karlilik_makine_genel_gider`, `test_karlilik_raporu`, `test_bulut_karlilik_ozeti`, `test_hizmet_brode_tambur`, `test_desen_fatura_kalemi`, `test_hizmet_kalemi_yaris`, `test_senaryo_hizmet_veren`, `test_screen_catalog`, `test_bulut_teklif_projeksiyon`, `test_teklif_belgesi`, `test_belge_sozlesme`, `test_teklif_durum`, `test_teklif_numara`, `test_teklif_uc`, `test_teklif_siparis`, `test_teklif_gorunurluk`, `test_fiyat_listesi`, `test_quote_price_single_source`, `test_db_invariants`, `test_maliyet_formul`, `test_maliyet_girdi`, `test_maliyet_ek_islem`, `test_standart_maliyet_surum`, `test_maliyet_girdileri`, `test_maliyet_regime_gate`, `test_finance_regime_gate`, `test_rapor_levent_sonucu`, `test_iplik_ihtiyaci`, `test_iplik_regime_gate`, `test_hizmet_fiyati`, `test_hizmet_fiyat_tablosu`, `test_hizmet_fiyat_uclari`, `test_hizmet_fatura`, `test_auto_draft_shipment`, `test_seyitoglu_sema`, `test_siparis_varyant`, `test_varyant_fiyat_zinciri`, `test_import_siparis_varyant`, `test_siparis_hedef_deger_kopya`, `test_karlilik_masraf_bagi`, `test_maliyet_altin_seyitoglu`, `test_iplik_ihtiyaci_katman`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/history/arsiv/2026-10.md` — "MAL-2 maliyet motoru", "MAL-4 satış teklifi + fiyat listesi", "MAL-6 teklif + fiyat listesi belgesi", "Seyitoğlu SY-G1 ek işlemler", "Seyitoğlu SY-B1 çözgü katmanları" notları.
