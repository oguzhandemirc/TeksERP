# Filtre · Liste · Arama · Sıralama

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 20 üye: 9 kök notu/satırı, 3 arşiv bölümü, 8 alt-CLAUDE notu (2 backend, 4 Electron, 2 mobil). Hepsi CANLI; tam ezilme yok, 4 KISMİ ezilme var ve dördü de kümede olmayan sonraki notlardan geliyor (Yarı Mamul sekmesi createdAt'e döndü; statusChangedAt geldi ama liste kullanmıyor; İstasyon filtresi üretim sekmelerine çekildi; Arşiv 4→6 statü + statusIn). İki üye kümeye yanlış düşmüş: yedek ön ekleri (B) ve Tambur plan kapısı (A:2026-08-19) — kurallarını yalnız işaretledim. En riskli sapma not-kod arası: 2026-08-27 'cancelledAt gevşek == yazılır, katı === felç' kuralı bugün kodda üç biçimle karşılanıyor (order-status.helper gevşek, isActiveLine tipli katı, order.service LOAD-BEARING select + katı) — kural cümlesi yeniden yazılmalı. Dizin satırı 'FilterBar Sonuç yok yutar' bayat (kod yalnız başarılı+boş yanıtta basıyor). [doğrulandı: 20 üye, 4 kanıt kontrolü, 0 düzeltme]


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** CSV de bir string'dir: filtreyi ELLE okuyan her servis id filtresini `readIdCondition`/`readFilterList`'ten geçirir (`typeof v==='string'` ham geçirir). Üç arıza modu: uuid kolon→P2007/400 · uuid olmayan string→sessiz 0 satır (foldType: yazımda normalizeFoldType) · ön-süzgeçli (currentStationId regex)→filtre SESSİZCE düşer, YANLIŞ liste. · bekçi: `test_filter_multi_select.ts (§2b createdById/entryStationId generic yol, §3 curr` <sub>(CLAUDE.md:67, CLAUDE.md:55, CLAUDE.md:49)</sub>
- **[ÇEKİRDEK]** Cursor'lu (sonsuz kaydırmalı) listede süzme SUNUCUDA yapılır — istemci süzmesi yalnız o anki sayfayı süzer ve operatöre yanlış 'kayıt yok' gösterir (kayıt sonraki sayfadadır). Taşınabilir çekirdek; ekran çifti profil. · bekçi: `test_tambur_recent_output_filter.ts (kumaş filtresi körleştirilince 2 kırmızı) —` <sub>(CLAUDE.md:56, CLAUDE.md:55)</sub>
- **[ÇEKİRDEK]** Liste + cursor + özet şeridi TEK where'den doğar: `BaseService.buildListWhere` (safeFilters İÇERİDE; envanter `buildRollWhere` emsali) — stats ucu ayrı where kurarsa üst satırdaki sayı tabloyla çelişir. Sipariş şeridinde ADET listenin aynası, METRAJ iptalleri HER ZAMAN dışlar (bilinçli iki kapsam). · bekçi: `test_order_stats.ts (33; şerit ↔ withTotal her filtre kombinasyonunda)` <sub>(arşiv:1521)</sub>
- **[ÇEKİRDEK]** Açık talep ('hangi kalem hâlâ talep') süzgeci TEK KAYNAK `helpers/order-line-scope.helper.ts` (ACTIVE_LINE ↔ isActiveLine boğaz-ikiz); elle `cancelledAt: null` kopyası AST bekçili YASAK; ham SQL muafiyeti `-- aktif-kalem-muaf:`. GELECEK sorusu süzer, GEÇMİŞ (defter/tarihçe) sorusu süzmez. · bekçi: `test_order_line_scope_single_source.ts (AST + ham SQL taraması)` <sub>(arşiv:1521)</sub>
- **[ÇEKİRDEK]** Topun bir statüye GELİŞ anı `createdAt` DEĞİLDİR (kurtarma/dispozisyon/fason kabulü/finalize eski topu bugün taşır). Giriş sekmeleri (Ham Stok, Yarı Mamul) `createdAt`, diğer sekmeler `updatedAt desc` (`rollTabDefaultSortBy`; index @@index([status, updatedAt])). Yeni 'topu şu statüye çek' yolu sıralama sözleşmesini de karşılar — operatör topu BULABİLMELİ. · bekçi: `Electron service.test.ts:159-161 (RAW_STOCK/SEMI_FINISHED=createdAt, FINISHED_ST` <sub>(CLAUDE.md:125)</sub>
- **[ÇEKİRDEK]** Her modelde UUID PK + `createdAt`/`updatedAt`; M:N pivot ve append-only log tablolarında YALNIZ `createdAt` (SystemLog: 'updatedAt YOK ve OLMAMALI'). Mobil CLAUDE'daki 'her modelde' satırı bu istisnayı düşürür — tek yer kök. <sub>(CLAUDE.md:283, CLAUDE.md:455)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Karşılanma raporu `order.service.getCoverageForLines` KULLANMAZ — o motor fungible havuzu HER satıra tam yazar (tek sipariş ekranında doğru, raporda ÇİFT SAYIM). Rapor motoru production-balance; havuz termin ASC, terminsiz EN SONA. <sub>(arşiv:1521)</sub>
- **[ÇEKİRDEK]** Aşım kesimi dalının claim WHERE'ine `currentQty > 0` KONMAZ — 0'a inmiş topta ikinci aşım kesimi meşrudur (mal fiziksel elde; çifte-harcama koruması 0'ın altında anlamsız); şart cutOpenFabric + cutWarehouseRoll aşım dallarından kaldırıldı, normal dalın `gte` guard'ına dokunulmadı. · bekçi: `test_tambur_over_quantity.ts (10→13; gt:0 geri konunca 409)` <sub>(CLAUDE.md:56)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Fatura izi yalnız `invoiceNo` (ERP fatura KESMEZ); izin `shipping:invoice`, `shipping:write` VERMEDEN verilir (muhasebe sevkiyat düzenleyemesin). <sub>(CLAUDE.md:46)</sub>
- **[ÇEKİRDEK]** Filtre/lookup/bayrak sözleşmesi değişince deploy sırası PAZARLIK DIŞI: backend ÖNCE, panel/APK sonra (eski panel CSV göndermez; yeni panel + eski backend = her çoklu lookup'ta 400 P2007, yeni APK + eski backend = lookup 404 + Son Kayıtlar filtresiz). Aynı anda gitmesi gerekenler aynı pencerede. <sub>(CLAUDE.md:67, CLAUDE.md:55, arşiv:1521)</sub>

### Kararlar

- **[PROFİL]** Sayfa içi arama (Ctrl+F) YOK — kayıt aramak için listenin SUNUCU araması (tüm kayıtlara bakar; DOM araması kısmi cevap verir). Yeniden denenirse: Electron `findInPage` seçeneğindeki `findNext` 'sonraki eşleşme' DEĞİL 'YENİ OTURUM BAŞLAT' (true=initial) — ters yazım hata vermez, `found-in-page` doğmaz, çubuk 0/0 der. <sub>(CLAUDE.md:65)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** `GET /rolls/entry-users` + `/rolls/entry-stations` lookup uçları kataloğu değil GERÇEK veriyi döner (top girmiş kullanıcı/istasyon, groupBy); izin `roll:read | MOBILE_ROLL_READ` (kullanıcı listesi admin:users arkasında — yeni bilgi sızmaz); route'lar `/:id`den ÖNCE. · bekçi: `test_filter_multi_select.ts §2b (lookup sayımı)` <sub>(CLAUDE.md:55)</sub>
- **[ÇEKİRDEK]** İstemci sürüm politikası KODDA sabit (`CLIENT_VERSION_POLICIES`, panelde ayar DEĞİL); uç `GET /api/client-policy/:istemci` PUBLIC; istemci FAIL-OPEN (uç okunamazsa kilitlenmez — bilinçli istisna); tanımsız istemci 404 (boş politika değil); `minVersion` sahadaki sürümden BÜYÜK OLAMAZ, yalnız gerçek kırılmada yükselir. · bekçi: `test_client_policy.ts` <sub>(CLAUDE.md:7)</sub>
- **[ÇEKİRDEK]** Yedek ön ekleri yaşam döngüsüdür (TEK KAYNAK backup-naming.helper.ts): `tekserp_` rotasyona GİRER, `premigrate_`/`pre-restore_` rotasyon DIŞI; rotasyon filtresi yalnız `tekserp_`e bakar; cutoff = min(ad damgası, mtime) — ad damgası dump BAŞLANGICI, mtime BİTİŞ. (Bu küme konusu değil — yedek kümesine ait.) <sub>(CLAUDE.md:279)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Sevkiyat listesi union'ında alan adı İKİ tarafta FARKLI: `Shipment.dispatchedAt` ≙ `DirectShipment.shippedAt` (NON-NULL) — sıralama, tarih aralığı ve keyset cursor where'i direct dalda `shippedAt`e çevrilir, aynı `cw` nesnesi paylaşılmaz. `attachTotals` metraj+adet BRÜT (kg geri-ekleme İSTEMEZ). · bekçi: `test_shipment_list_gross.ts` <sub>(CLAUDE.md:46, CLAUDE.md:67)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Statü ÇOKLU daraltması kapsam anahtarı `status`a DOKUNMADAN ayrı anahtarla yapılır: rolls'ta `statusIn[]` (öncelik statusIn > status > varsayılan STOCK) — 2026-08-25 Arşiv 'Kayıt Türü' emsali. <sub>(CLAUDE.md:67, arşiv:134)</sub>
- **[ÇEKİRDEK]** Kesim çocukları `createdMachineId` damgası alır (dört TAMBUR_SPLIT doğum yolu: cutWarehouseRoll · finalizeWarehouseCut · cutOpenFabric · finalizeOpenFabric) — yoksa 'Bu makine' süzgeci kesimleri hiç görmez; eski kesimler geriye doldurulmadı (entryStationId emsali). · bekçi: `test_tambur_cut_idempotency.ts (+1 damga) · test_tambur_recent_output_filter.ts ` <sub>(CLAUDE.md:56)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** 'Geri gidilebilir mi' `location.key` ile ÇÖZÜLMEZ (liste sayfaları açılışta `setSearchParams(replace:true)` ile URL yazar → anahtar değişir, geçmiş büyümez). Tek kaynak sekme başına derinlik defteri `tabs/history-depth.ts`: PUSH +1 · POP −1 · REPLACE DEĞİŞMEZ; sekme kimliği `useTabId()`; `PageHeader` sırası onBack > sekme geçmişi > breadcrumb. · bekçi: `history-depth.test.ts + PageHeader.test.tsx` <sub>(CLAUDE.md:216)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `updatedAt` gerçek 'hareket' DEĞİL (etiket yeniden basımı/not düzenlemesi de günceller) → kolon adı 'Son İşlem', 'Son Hareket' değil; FIFO/stok yaşlandırma için updatedAt KULLANILMAZ — statü geçişinde damgalanan `Roll.statusChangedAt` (trigger, 2026-08-09) var ama envanter listesi onu henüz kullanmıyor. <sub>(CLAUDE.md:125)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Electron servis yolları TAM yazılır (`/api/...` — `apiClient.baseURL` /api İÇERMEZ); öneksiz yol 404 alır. FilterBar artık 'Sonuç yok.' yazısını YALNIZ başarılı+boş yanıtta basar (404/hata 'sonuç yok' değildir). <sub>(CLAUDE.md:55)</sub>
- **[ÇEKİRDEK]** Tekil id çözen yardımcılar CSV'de kırılır (`find(id)` → undefined → rozet filtre AKTİFKEN sessizce yanlış etikete düşer): tek seçimde AD, çok seçimde 'N firma'; react-query anahtarı `filter-lookup-multi` ile FilterBar'la hizalı (ayrışırsa aynı veri iki kez çekilir). `dependent-lookup` üst filtresi CSV'yi aynen geçirir (BaseService `in`e çevirir). <sub>(CLAUDE.md:67)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Electron 'tümünü göster' picker'ları `loadAllForPicker(service)` kullanır (PICKER_MAX_PAGE_SIZE=500 ↔ backend MAX_PAGE_SIZE); inline `pageSize: N` YAZILMAZ (sınır değişince 400). Toplam 500'ü aşarsa helper AÇIK hata fırlatır → arama tabanlı combobox + listCursor; UI hatayı yakalar. · bekçi: `runtime: picker-loader.ts:74-79 throw; test yok` <sub>(CLAUDE.md:307)</sub>
- **[PROFİL]** Dört istasyon/kaynak filtresi DÖRT ayrı soru: 'İstasyon' (currentStationId) = top ŞU AN nerede — YALNIZ üretim sekmelerinde (Üretimde/Kurşun Bekleyen/Tambur Bekleyen; depoda top istasyonda durmaz, daima boş liste) · 'Giriş İstasyonu' (entryStationId) = kalıcı köken · 'Giriş Kaynağı' (entrySource) = tür · 'Ekleyen' (createdById) = kim. <sub>(CLAUDE.md:55, arşiv:134)</sub>
- **[ÇEKİRDEK]** TabHost her sayfayı `absolute inset-0 overflow-auto` ile sarar → sayfa kökü `PageShell` (flex h-full min-h-0 flex-col); TEK kaydırıcı `PageBody` (min-h-0 flex-1 overflow-auto); başlık/toolbar/footer shrink-0, eylemler `PageFooter`da. DataTable sayfaları ayrı PageBody istemez; tam-ekran editörler PageShell+PageFooter. <sub>(CLAUDE.md:150, CLAUDE.md:176)</sub>

### Kararlar

- **[PROFİL]** Envanter listesi TEK okunur değer basar: TEK tarih kolonu = sıralanan kolon ('Giriş' createdAt giriş sekmelerinde, 'Son İşlem' updatedAt diğerlerinde; diğeri Sütunlar'dan) · TEK metraj = currentQty (giriş metrajı + 'kesik' işareti listede YOK, detayda 'Başlangıç') · izlenebilirlik sütunları (entrySource/createdBy/entryStation) varsayılan GİZLİ. <sub>(CLAUDE.md:125, arşiv:134, CLAUDE.md:55)</sub>
- **[PROFİL]** Arşiv sekmesi: `STATUS_GROUPS.ARCHIVE` TEK KAYNAK (ALTI statü: RETURNED_FROM_SUBCONTRACTOR, TAMBUR_CONSUMED, SUBCONTRACTOR_CONSUMED, KARTELA_CONSUMED, CANCELLED, SCRAP), Sistem → Top Arşivi (`/system/roll-archive`, admin:settings). Sekme silinmedi TAŞINDI — bir kısmı barkodsuz, tek liste yüzeyi. <sub>(arşiv:134)</sub>

## Tablet (mobil)


### Yasaklar

- **[ÇEKİRDEK]** Mobil tarih seçici için YENİ PAKET EKLENMEZ — takvim ızgarası elle yazıldı, sıfır bağımlılık (expo-audio peer'ı bir kez expo-asset'i köke çekip APK'yı açılışta çökertmişti). <sub>(CLAUDE.md:56)</sub>
- **[ÇEKİRDEK]** `NumpadHost` `autoActivate` aynı ekranda yalnız TEK alana verilir — ikisine birden verilirse kazananı MOUNT SIRASI belirler ve operatör metraj beklerken tuşlar sessizce En'i değiştirir (metraj `!compact && manualMode`, En `!compact && !manualMode`). <sub>(CLAUDE.md:56)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Mobil picker'da 'yeni ekle' tetiği `PickerModal.leadingAction`: listenin İLK hücresindeki mor aksiyon kartı (`colors.action`, kartlarla aynı geometri, sıralama/aramadan bağımsız ilk sıra); basılınca picker KAPANMAZ, form `quickAddSlot`ta açılır; listenin üstüne ayrı outlined buton KOYMA. Mor bilinçli: indigo 'seçili kart' vurgusu. · bekçi: `mobil PickerModal.test.tsx (leadingAction 3 geçiş)` <sub>(CLAUDE.md:315)</sub>

### Kararlar

- **[PROFİL]** Mobil 'Son Kayıtlar' HER ZAMAN kişiye özel (`filter[createdById]=ben`, bayraktan bağımsız); 'Tüm Girişler' `kk1.historyAllEntriesEnabled` KAPALIYKEN yalnız kendi kayıtları (başlık '· yalnız senin girişlerin', Personel çipi HİÇ çizilmez), AÇIKKEN herkes + çip. Yetki duvarı DEĞİL ekran sadeleştirmesi; bayrak yüklenemezse DAR kapsam. · bekçi: `mobil rollHistoryFilter.test.ts (+7, kapsam kuralı körleştirilince kırmızı)` <sub>(CLAUDE.md:55)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-07-30__buraya-gelis-olusturma-2026-07-30` → `kök dizin 2026-08-26 'Yarı Mamul kendi sekmesine ayrıldı' (kümede değil) — kod dd1e01b6 (2026-08-27)`: 'Ham Stok DIŞINDAKİ tüm sekmeler updatedAt desc' kuralı daraldı: Yarı Mamul da GİRİŞ sekmesidir (mal dışarıdan doğrudan buraya yazılır) → createdAt ile sıralanır. Kural artık 'giriş sekmeleri (RAW_STOCK, SEMI_FINISHED) createdAt, diğerleri updatedAt'. ✅ çürütmeden geçti
- **KISMI** `R:2026-07-30__buraya-gelis-olusturma-2026-07-30` → `kök dizin 2026-08-09 'Rapor temeli (finalizedAt)' (kümede değil) — Roll.statusChangedAt trigger`: 'FIFO/yaşlandırma için yalnız statü geçişlerinde damgalanan AYRI kolon gerekir' ihtiyacı karşılandı: Roll.statusChangedAt trigger ile yazılıyor. Envanter listesi hâlâ updatedAt ile sıralıyor; kolon liste yüzeyinde kullanılmıyor (bilinçli mi, unutulmuş mu belirsiz). ✅ çürütmeden geçti
- **KISMI** `A:2026-08-05__2026-08-05-elle-eklenen-topu` → `R:2026-08-12__2026-08-12-giris-izlenebilirligi-kim`: 'İstasyon' (currentStationId) filtresi 2026-08-05'te base liste şeridine eklendi; 2026-08-12'de base listeden ÇIKARILDI — yalnız Üretimde/Kurşun Bekleyen/Tambur Bekleyen sekmelerinde çizilir (Ham Stok/Depo'da top istasyonda durmaz, filtre daima boş liste döndürüp 'bozuk' görünüyordu). ✅ çürütmeden geçti
- **KISMI** `A:2026-08-05__2026-08-05-elle-eklenen-topu` → `kök dizin 2026-08-25 ②b 'İptal ettim, arşivde göremedim' (kümede değil)`: Arşiv sekmesi DÖRT emekli statüden ALTIya çıktı (CANCELLED + SCRAP eklendi), sayfaya ARAMA + 'Kayıt Türü' daraltması (`statusIn`) geldi; konum (Sistem → Top Arşivi) ve admin:settings kapısı değişmedi. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:undated__uuid-primary-key-tum-modellerde-m` ↔ `M:undated__uuid-primary-key-her-modelde`: Kök doğru; mobil satırı istisnayı düşüren eksik özet. Kural tek yerde (kök Ortak Konvansiyonlar) kalır, mobil satırı köke atıf olur.

## Açık sorular

- A:2026-08-27 'Süzgeç `cancelledAt == null` (GEVŞEK) yazılır… KATI `=== null` TÜM kalemleri iptal sayar' ↔ kod: order-status.helper.ts:141 gevşek `==`, ama 2026-09-04 b24b6e11 `isActiveLine` (order-line-scope.helper.ts:42-43) KATI `=== null` (parametre tipi `Date | null` alanı zorunlu kılıyor) ve order.service.ts:2262-2265 katı `!== null` + 'LOAD-BEARING select' yorumu. Notun 'katı yasak' cümlesi bugün üç yerde üç farklı biçimle karşılanıyor; kural 'alan select'e alınmadan katı kıyas yapılmaz' diye yeniden yazılmalı mı — kullanıcı kararı.
- R:2026-07-30 FIFO için 'ayrı kolon gerekir' dedi; `Roll.statusChangedAt` 2026-08-09'da geldi (schema.prisma:1928) ama envanter listesi hâlâ `updatedAt` ile sıralıyor (Electron Rolls service.ts/columns.tsx'te 0 kullanım). 'Son İşlem' yerine statusChangedAt ile sıralamak bilinçli ertelendi mi, unutuldu mu — koddan çözülemedi.
- R:2026-08-12 kök dizin satırı 'FilterBar "Sonuç yok" yutar' ŞİMDİKİ ZAMAN yazılmış; kod FilterBar.tsx:420-422,515 'Sonuç yok. YALNIZ başarılı+boş yanıtta' — yutma kapatılmış. Dizin satırı bayat (tuzak: 404 hâlâ öneksiz yolda doğar, ama artık 'Sonuç yok' değil hata olarak görünür); hangi commit'te kapandığı ölçülmedi.
- mobil FasonSevkScreen.tsx:569-570 ve FasonSevkGecmisiScreen.tsx:87-88 `page:1, pageSize:500` offset ile fason firma listesi çekiyor — master-data olduğu için M:liste-sayfalama istisnasına giriyor, ama Electron'daki `loadAllForPicker` (500 aşınca açık hata) karşılığı mobilde YOK: liste 500'ü aşarsa sessiz kesilir. Kural ihlali değil, bekçisiz sınır.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: —

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-06 · 2026-08-06 — SAYFA İÇİ ARAMA (Ctrl+F) KALDIRILDI — `CLAUDE-NOT-ARSIVI.md:285-286`
- 2026-08-06 · 2026-08-06 — FİLTRELERDE ÇOKLU SEÇİM: "CSV de bir string'dir" ve üç ayrı arıza modu — `CLAUDE-NOT-ARSIVI.md:296-306`
- 2026-08-12 · 2026-08-12 — GİRİŞ İZLENEBİLİRLİĞİ: "kim, nereden girdi" + kişiye özel listeler — `CLAUDE-NOT-ARSIVI.md:163-175`
- 2026-08-27 · 2026-08-27 — Sipariş görünürlüğü: şerit + altı rapor + iptal sebebi + kalem iptali — `CLAUDE-NOT-ARSIVI.md:1521-1655`