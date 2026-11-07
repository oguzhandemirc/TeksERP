# Filtre · Liste · Arama · Sıralama
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/filtre-liste.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Filtreyi ELLE okuyan her servis id filtresini `readIdCondition`/`readFilterList`'ten geçirir (CSV de string'dir; `typeof v==='string'` ham geçirmez). Arıza modları: uuid kolon→P2007/400 · uuid olmayan→sessiz 0 satır · ön-süzgeçli (currentStationId)→filtre sessizce düşer.
- **[ÇEKİRDEK]** Tanınan süzgeç adı `filter[...]` sarmalı olmadan gelirse 400 `BARE_FILTER_PARAM` (`details.hint`) döndür; tek kapı `assertNoBareFilterParams(req, tanınan, çıplakSerbest)`.
- **[ÇEKİRDEK]** BaseService `assertListQueryShape`, elle okuyan uç kendi ad listesini verir (`PURCHASE_ORDER_FILTER_NAMES`); `LIST_QUERY_RESERVED` ve tanınmayan adlar serbest (`safeFilters` süzer).
- **[PROFİL yüzey]** Seçici modalı: kutuya tıkla → doğrudan modal; arama + tek seçimli Radix `ui/select` süzgeçleri, süzme SUNUCUDA, TEK `useInfiniteQuery` (`listCursor` 50), `useInfiniteScroll`, düz `ui/table`. Yerleşik `<select>` · DataTable · pagination cast · iki sorgu YASAK.
- **[PROFİL yüzey]** `loadAllForPicker` yalnız küçük katalogda. Ürün modalı `h-[85vh]`, tetik "Ad — KOD".
- **[ÇEKİRDEK]** Skaler olmayan süzgeç anahtarını (`filter[allowedColorId]`, `filter[allowedPropertyId]`) servis `extraWhere(req)`te ham `filters`tan `readIdCondition` ile oku; `buildListWhere` tek nokta kalır. "Bu rengi alabilen ürün" = `allowedColors none OR some{colorId}` — yalnız `some` yazma.
- **[ÇEKİRDEK]** Cursor'lu listede süzmeyi SUNUCUDA yap; istemci süzmesi yalnız o sayfayı süzer, yanlış "kayıt yok" gösterir.
- **[ÇEKİRDEK]** Hiyerarşik sırayı (ebeveyn→çeşit, eşleşen çocuğun ebeveyni) cursor'lı listede istemci kurmaz; sunucu ayrı `sortBy` (`hierarchy`) ile ağaçlayıp sayfalar, satıra `listLevel`/`listContext` yazar; başlık sıralaması düz yola döner.
- **[ÇEKİRDEK]** Liste + cursor + özet şeridi TEK where'den: `BaseService.buildListWhere` (safeFilters içeride; `buildRollWhere` emsali); stats ucu ayrı where kurmaz. Sipariş şeridinde ADET listenin aynası, METRAJ iptalleri hep dışlar.
- **[ÇEKİRDEK]** Seçici seçeneğindeki sayıyı FACETED say: seçenek ucu liste parametrelerini AYNEN alır, listenin where kurucusundan (ör. `WorkOrderService.buildListWhere`) kendi anahtarı HARİÇ tabanı kurar, kendi anahtarının değerini yine listeyle aynı doğrular (400) — seçenek sayısı = seçilince liste toplamı.
- **[ÇEKİRDEK]** Açık talep süzgeci TEK KAYNAK `helpers/order-line-scope.helper.ts` (ACTIVE_LINE ↔ isActiveLine); elle `cancelledAt: null` kopyası YASAK; ham SQL muafiyeti `-- aktif-kalem-muaf:`. GELECEK sorusu süzer, GEÇMİŞ (defter/tarihçe) süzmez.
- **[ÇEKİRDEK]** Statüye geliş anı `createdAt` değildir: giriş sekmeleri (Ham Stok, Yarı Mamul) `createdAt`, diğerleri `updatedAt desc` (`rollTabDefaultSortBy`; `@@index([status, updatedAt])`). Yeni "topu statüye çek" yolu bu sıralama sözleşmesini karşılar.
- **[ÇEKİRDEK]** Her modelde UUID PK + `createdAt`/`updatedAt`; M:N pivot ve append-only log tablolarında YALNIZ `createdAt` (SystemLog'da `updatedAt` olmaz). Kural tek yerde (kök).

### Yasaklar

- **[ÇEKİRDEK]** Karşılanma raporunda `order.service.getCoverageForLines` KULLANMA (havuzu her satıra yazar → çift sayım); rapor motoru production-balance, havuz termin ASC, terminsiz en sona.
- **[ÇEKİRDEK]** Aşım kesimi dalının claim WHERE'ine `currentQty > 0` KOYMA (0'daki topta ikinci aşım kesimi meşru); normal dalın `gte` guard'ı kalır.

### Reçeteler

- **[ÇEKİRDEK]** Fatura izi yalnız `invoiceNo` (ERP fatura kesmez); `shipping:invoice` iznini `shipping:write` VERMEDEN ver.
- **[ÇEKİRDEK]** Filtre/lookup/bayrak sözleşmesi değişince backend ÖNCE, panel/APK sonra dağıtılır; birlikte gitmesi gerekenler aynı pencerede.

### Kararlar

- **[PROFİL]** Sayfa içi arama (Ctrl+F) YOK; kayıt araması listenin SUNUCU aramasıyla. Yeniden denenirse: Electron `findInPage` `findNext` = "yeni oturum başlat" (true=initial).

## Backend

### Değişmezler

- **[ÇEKİRDEK]** `GET /rolls/entry-users` + `/rolls/entry-stations` gerçek veriyi döner (groupBy); izin `roll:read | MOBILE_ROLL_READ`; route'lar `/:id`den ÖNCE.
- **[ÇEKİRDEK]** `filter[ownerCustomerId]` `buildRollWhere`de `readIdCondition`dan okunur (liste · cursor · `/rolls/stats` aynı where), modül kapalıyken de UYGULANIR; çip + "Sahibi" sütunu yalnız emanet açıkken.
- **[ÇEKİRDEK]** Seçenekler `GET /rolls/owner-customers` (`roll:read`). `GET /api/consigned-work` (`requireEmanetEnabled`, `roll:read`) TEK sorgu, `NOT_INSIDE_STATUSES` dışlanır, metre `currentQty`.
- **[ÇEKİRDEK]** `minVersion` KODDA sabit (`CLIENT_VERSION_POLICIES`; `currentVersion` kiradan); `GET /api/client-policy/:istemci` PUBLIC; istemci FAIL-OPEN; tanımsız istemci 404; `minVersion` sahadaki sürümden büyük olamaz, yalnız gerçek kırılmada yükselir.
- **[ÇEKİRDEK]** Yedek ön ekleri TEK KAYNAK `backup-naming.helper.ts`: `tekserp_` rotasyona girer, `premigrate_`/`pre-restore_` girmez; cutoff = min(ad damgası, mtime).

### Tuzaklar

- **[ÇEKİRDEK]** Sevkiyat listesi union'ında `Shipment.dispatchedAt` ≙ `DirectShipment.shippedAt`: sıralama, tarih aralığı ve keyset cursor direct dalda `shippedAt`e çevrilir, `cw` paylaşılmaz. `attachTotals` BRÜT.

### Reçeteler

- **[ÇEKİRDEK]** Statü çoklu daraltmasını `status`a dokunmadan ayrı anahtarla yap: rolls'ta `statusIn[]` (öncelik statusIn > status > STOCK).
- **[ÇEKİRDEK]** Kesim çocuklarına `createdMachineId` damgala (cutWarehouseRoll · finalizeWarehouseCut · cutOpenFabric · finalizeOpenFabric); yoksa "Bu makine" süzgeci kesimleri görmez.
- **[ÇEKİRDEK]** Süzgeci ELLE okuyan liste ucu sorguyu `.strict()` Zod şemasıyla okur: tanınmayan parametre 400; istemcinin gönderdiği ad desteklenir (fatura listesi `shipmentId` CSV `readIdCondition`, `limit` = `pageSize`).
- [ÇEKİRDEK] Sipariş "Nerede?" türetmesi YALNIZ `order-where.helper`da, sekme/firma/gün süzgeci YALNIZ `order-where-filter.helper`da (bellek `deriveOrderWhere` ↔ Prisma `orderWhereFilterParts` boğaz-ikiz); cümleyi panel tek saf fonksiyonda kurar (`order-where-text.ts`); liste satırına sayfa başına sabit sorguyla eklenir, sipariş başına sorgu yazma; üretim kapalıyken üretim-türevi süzgeç 403.

## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** "Geri gidilebilir mi"yi `location.key` ile çözme; tek kaynak `tabs/history-depth.ts` (PUSH +1 · POP −1 · REPLACE değişmez), sekme kimliği `useTabId()`; `PageHeader` sırası onBack > sekme geçmişi > breadcrumb.
- **[ÇEKİRDEK]** Sekme kapatma (tek/toplu/kısayol/sağ tık) ve elle çıkış YALNIZ `tabs/dirty-close-guard.ts` kapısından geçer; "kirli sekme" tek kaynak `tabs/dirty-tabs.ts` (`useDirtyTab` beyanı + sekmedeki diyalog/sheet'e yazma); sayfa düzeyi editörün kendi kirlilik ölçüsü varsa `useDirtyTab(dirty)` bağlanır, seçici pencere `data-dirty-ignore` taşır.
- **[ÇEKİRDEK]** Her yeni oturum (giriş · 401/oturum düşmesi · uygulamayı yeniden açma) TEK sekme Anasayfa ile başlar: sekme defteri yalnız `sessionStorage`da (`store/tabs-storage.ts`, reload olmayan açılışta silinir), kimlik değişimi `bindTabsToSession` ile defteri boşaltır, `TabHost` hash'ten ve giriş "from"undan yol açmaz; F5 oturum içinde sekmeleri korur. · bekçi: `Electron/src/store/tabs.session.test.tsx` <sub>(arşiv:2026-11-07)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `updatedAt` hareket değildir: kolon adı "Son İşlem"; FIFO/yaşlandırmada `updatedAt` KULLANMA (`Roll.statusChangedAt` var).

### Tuzaklar

- **[ÇEKİRDEK]** Electron servis yollarını TAM yaz (`/api/...`; `apiClient.baseURL` /api içermez). FilterBar "Sonuç yok."u yalnız başarılı+boş yanıtta basar.
- **[ÇEKİRDEK]** Tekil id çözen yardımcı CSV'de kırılır: tek seçimde AD, çok seçimde "N firma"; react-query anahtarı `filter-lookup-multi` FilterBar'la hizalı; `dependent-lookup` CSV'yi aynen geçirir.

### Reçeteler

- **[ÇEKİRDEK]** "Tümünü göster" picker'ı `loadAllForPicker(service)` kullanır (PICKER_MAX_PAGE_SIZE=500 ↔ MAX_PAGE_SIZE); inline `pageSize: N` YAZMA; 500 aşılınca helper açık hata fırlatır → arama + listCursor, UI hatayı yakalar.
- **[PROFİL]** Dört ayrı filtre: "İstasyon" (currentStationId, yalnız üretim sekmeleri) · "Giriş İstasyonu" (entryStationId) · "Giriş Kaynağı" (entrySource) · "Ekleyen" (createdById).
- **[ÇEKİRDEK]** Sayfa kökü `PageShell` (flex h-full min-h-0 flex-col); TEK kaydırıcı `PageBody`; başlık/toolbar/footer shrink-0, eylemler `PageFooter`da; DataTable sayfaları ayrı PageBody istemez.
- **[PROFİL yüzey]** Liste filtre çubuğunu `components/data-table/filter-row/FilterRow` ile TEK SATIR kur: kutular `FilterControl chip`, hızlı sekmeler `ViewSelect` (faceted sayı, liste açıkken), tarih `DatePresetFilter` penceresi, az kullanılanlar "+ Filtre"; ✕ yalnız kendi anahtarlarını, Temizle hepsini siler (arama kalır); kök `flex-wrap` taşımaz.
- **[ÇEKİRDEK]** Liste filtre kaydını `useDataTable({ persistFilters })` ile aç (sayfa başına opt-in, `prefs.tableFilters[queryKey]`); arama metni kaydedilmez, hazır tarih göreli saklanır, URL'deki süzgeç/arama/odak kaydı ezer ve yazmaz, kayıt yüklenmeden liste istek atmaz; sayfa varsayılanı (ör. son 30 gün) `defaultDate` ile verilir, FilterBar `defaultDateRangeDays` ile değil; satır kutuları `filter-row/def-row-filters` yardımcılarından kurulur.
- **[ÇEKİRDEK]** Sekmeli listede filtre kaydını SEKME BAŞINA tut (`queryKey` sekmeyi taşır; tek tablo sekme değiştiriyorsa anahtar değişince kanca eski+yeni allowlist'i URL'den siler ve yeni sekmenin kaydını yazar, geçişte `filtersReady=false`; iç sekmesi ayrı tablo olan sayfada sekme URL'si temizlenene dek yeni sekme bağlanmaz); allowlist katalog/bayrak yüklenmeden de sekmenin TAM kümesidir.

### Kararlar

- **[PROFİL]** Envanter listesi TEK tarih kolonu (sıralanan: "Giriş" createdAt / "Son İşlem" updatedAt), TEK metraj `currentQty`; izlenebilirlik sütunları (entrySource/createdBy/entryStation) varsayılan gizli.
- **[PROFİL]** Arşiv sekmesi `STATUS_GROUPS.ARCHIVE` TEK KAYNAK (RETURNED_FROM_SUBCONTRACTOR, TAMBUR_CONSUMED, SUBCONTRACTOR_CONSUMED, KARTELA_CONSUMED, CANCELLED, SCRAP); Sistem → Top Arşivi (`/system/roll-archive`, admin:settings), arama + `statusIn`.

## Tablet (mobil)

### Yasaklar

- **[ÇEKİRDEK]** Mobil tarih seçici için YENİ PAKET EKLEME (takvim elle yazılı).
- **[ÇEKİRDEK]** `NumpadHost` `autoActivate`'i aynı ekranda yalnız TEK alana ver.

### Reçeteler

- **[ÇEKİRDEK]** Mobil picker'da "yeni ekle" `PickerModal.leadingAction` (ilk hücrede mor `colors.action` kartı); basılınca picker kapanmaz, form `quickAddSlot`ta; üstüne ayrı outlined buton KOYMA.

### Kararlar

- **[PROFİL]** Mobil "Son Kayıtlar" hep kişiye özel (`filter[createdById]=ben`); "Tüm Girişler" `kk1.historyAllEntriesEnabled` kapalıyken yalnız kendi kayıtları (Personel çipi yok), açıkken herkes + çip; bayrak yüklenemezse DAR kapsam.

## Geçersiz kılınan kurallar — bunlara UYMA

- "Ham Stok dışı tüm sekmeler updatedAt" → giriş sekmeleri (RAW_STOCK, SEMI_FINISHED) createdAt.
- "İstasyon filtresi base liste şeridinde" → yalnız üretim sekmelerinde.
- "Arşiv dört statü" → altı statü + `statusIn`.

## Çözülmüş çelişkiler

- UUID PK/zaman damgası kuralı tek yerde (kök); mobil satırı köke atıftır.

## Açık sorular

- `cancelledAt` gevşek/katı kıyas kuralının yeniden yazımı; envanterde `statusChangedAt` sıralaması; mobil fason firma listesi 500 sınırı — ayrıntı dosyasında.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_fatura_liste_suzgec`, `test_bare_filter_param`, `test_item_allowed_filter`, `test_fabric_property_hierarchy`, `test_filter_multi_select`, `test_workorder_location`

İstemci: `Electron/src/components/forms/ItemPickerModal.test.tsx`, `Electron/src/pages/FabricProperties/hierarchy.test.tsx`, `Electron/src/components/data-table/filter-row/FilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/date-preset.test.ts`, `Electron/src/pages/Operations/Orders/OrdersFilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/filter-persist.test.ts`, `Electron/src/hooks/usePersistedTableFilters.test.tsx`, `Electron/src/pages/Operations/WorkOrders/WorkOrdersFilterRow.test.tsx`, `Electron/src/pages/Operations/Shipments/ShipmentsFilterRow.test.tsx`, `Electron/src/hooks/usePersistedTableFilters.tabs.test.tsx`, `Electron/src/pages/Operations/Rolls/RollsFilterRow.test.tsx`, `Electron/src/pages/Operations/Rolls/RollScanBar.test.tsx`, `Electron/src/pages/Operations/Rolls/kartelaFilter.test.tsx`, `Electron/src/pages/Operations/Kartela/KartelaFilterRow.test.tsx`, `Electron/src/pages/Operations/Kartela/useKartelaTab.test.tsx`, `Electron/src/pages/Operations/Returns/ReturnsFilterRow.test.tsx`, `Electron/src/pages/Operations/AccountingDispatch/AccountingFilterRow.test.tsx`, `Electron/src/pages/Definitions/CarilerFilterRow.test.tsx`, `Electron/src/hooks/useCrudShowInactive.test.tsx`, `Electron/src/pages/Operations/filtre-kayit-dalga4.test.tsx`
İstemci: `Electron/src/components/forms/ItemPickerModal.test.tsx`, `Electron/src/pages/FabricProperties/hierarchy.test.tsx`, `Electron/src/components/data-table/filter-row/FilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/date-preset.test.ts`, `Electron/src/pages/Operations/Orders/OrdersFilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/filter-persist.test.ts`, `Electron/src/hooks/usePersistedTableFilters.test.tsx`, `Electron/src/pages/Operations/WorkOrders/WorkOrdersFilterRow.test.tsx`, `Electron/src/pages/Operations/Shipments/ShipmentsFilterRow.test.tsx`, `Electron/src/hooks/usePersistedTableFilters.tabs.test.tsx`, `Electron/src/pages/Operations/Rolls/RollsFilterRow.test.tsx`, `Electron/src/pages/Operations/Rolls/RollScanBar.test.tsx`, `Electron/src/pages/Operations/Rolls/kartelaFilter.test.tsx`, `Electron/src/pages/Operations/Kartela/KartelaFilterRow.test.tsx`, `Electron/src/pages/Operations/Kartela/useKartelaTab.test.tsx`, `Electron/src/pages/Operations/Returns/ReturnsFilterRow.test.tsx`, `Electron/src/pages/Operations/AccountingDispatch/AccountingFilterRow.test.tsx`, `Electron/src/pages/Definitions/CarilerFilterRow.test.tsx`, `Electron/src/hooks/useCrudShowInactive.test.tsx`
İstemci: `Electron/src/components/forms/ItemPickerModal.test.tsx`, `Electron/src/pages/FabricProperties/hierarchy.test.tsx`, `Electron/src/components/data-table/filter-row/FilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/date-preset.test.ts`, `Electron/src/pages/Operations/Orders/OrdersFilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/filter-persist.test.ts`, `Electron/src/hooks/usePersistedTableFilters.test.tsx`, `Electron/src/pages/Operations/WorkOrders/WorkOrdersFilterRow.test.tsx`, `Electron/src/pages/Operations/Shipments/ShipmentsFilterRow.test.tsx`, `Electron/src/hooks/usePersistedTableFilters.tabs.test.tsx`, `Electron/src/pages/Operations/Rolls/RollsFilterRow.test.tsx`, `Electron/src/pages/Operations/Rolls/RollScanBar.test.tsx`, `Electron/src/pages/Operations/Rolls/kartelaFilter.test.tsx`, `Electron/src/pages/Operations/Kartela/KartelaFilterRow.test.tsx`, `Electron/src/pages/Operations/Kartela/useKartelaTab.test.tsx`
İstemci: `Electron/src/components/forms/ItemPickerModal.test.tsx`, `Electron/src/pages/FabricProperties/hierarchy.test.tsx`, `Electron/src/components/data-table/filter-row/FilterRow.test.tsx`, `Electron/src/components/data-table/filter-row/date-preset.test.ts`, `Electron/src/pages/Operations/Orders/OrdersFilterRow.test.tsx`

Kural maddelerinin bekçileri (ek): `mobil PickerModal.test.tsx`, `test_tambur_recent_output_filter`, `test_order_stats`, `test_order_line_scope_single_source`, `service.test.ts`, `test_tambur_over_quantity`, `test_emanet_sahip_suzgeci`, `test_client_policy`, `test_shipment_list_gross`, `test_tambur_cut_idempotency`, `history-depth.test.ts`, `PageHeader.test.tsx`, `rollHistoryFilter.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/kurallar/ayrinti/filtre-liste.md` § Arşiv notları.
