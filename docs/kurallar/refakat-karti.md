# Refakat kartı

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: Küme 35 üyeli; yalnız 13'ü refakat kartı/iş emri belgesi/belge tasarımı konusunda (N16·N19·N20·N21·N22·N23·N24·N25·N8·N9·N10·N26 + N15), kalan 22'si başka kümelerin ikincil/yabancı notu — kümeleme eşiği gevşek. Konu notlarının 4'ü KISMEN bayat: N20 (şablon donar + admin:settings — ikisi de 08-05/08-06'da ezildi), N19 (frozen A4 dalı fiilen ölü), N21 arşiv (print-event 'audit-only'), N22 arşiv (mobil bant, eski Electron diyaloğu). Zincir git ile teyitli: 08-04 şablon → 08-05 dirty+belge listesi → 08-05 otomatik revizyon → 08-06 sunum canlı → 08-17 sürüm arşivi (notlarda YOK) → 08-29 K8 printedAt. En riskli çelişki: kök N20 'ŞABLON KARTA DONAR' + schema.prisma:3492-3494 ve routes swagger yorumları eski kuralı söylüyor; kod (tek dress()) ve bekçi E2 tersini kilitliyor.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Refakat kartı iş emri AÇILIŞINDA doğar; bir WO = TEK kart (`TravelerCard.workOrderId @unique`); `cardNumber = barcode = workOrderNumber` ve karekod versiyonlar arası SABİT; Parti (Batch) kart ÜRETMEZ. Kart okutulunca istasyon süreçleri tetiklenir. · bekçi: `DB seddi: schema @unique (cardNumber, barcode, workOrderId)` <sub>(CLAUDE.md:136)</sub>
- **[ÇEKİRDEK]** ACTIVE kartın önizlemesi+baskısı iş emrinin GÜNCEL hâlinden üretilir (plan CANLI); SUNUM (şablon/config/sayfa) HER kartta HER baskıda canlı — karta DONDURULMAZ; geçersiz kartın (VOIDED/COMPLETED/REPRINTED) yalnız İÇERİĞİ donuk kalır, hiç revize edilmez; iş emri okunamazsa eldeki snapshot'a düşülür. · bekçi: `scripts/test_traveler_card_stale.ts §6 + scripts/test_traveler_template.ts E2 ("basılmış kart GÜNCEL şablonla basıyor") + E4 ("sürümü artıran şey GEREKÇELİ reprint")` <sub>(CLAUDE.md:144, CLAUDE.md:152, CLAUDE.md:137)</sub>
- **[ÇEKİRDEK]** Önizleme, baskı ve sürüm numarası TEK karar noktası `resolvePrintPlan`'dan beslenir; önizlemedeki `v` BU BASKININ alacağı sürümdür, GET yan etkisizdir. Generic printed-document freeze/reissue/lazy-init TRAVELER_CARD için KAPALI (`SELF_MANAGED_DOC_TYPES` → 400) — ikinci sürüm üretici olurdu. · bekçi: `scripts/test_traveler_card_stale.ts §6` <sub>(CLAUDE.md:144)</sub>
- **[ÇEKİRDEK]** `print-event` = 'kart fiziksel olarak basıldı': istemci baskı BAŞARIYLA dönünce çağırır (yalnız KÂĞIT; PDF ve `GET /html` bildirmez); sunucu basılan planı snapshot'a yazar, `contentDirty` temizler, içerik değiştiyse `version++` (PRINT_REVISION) — aynı içerik sürüm şişirmez; bildirim hatası yutulur. · bekçi: `scripts/test_traveler_card_stale.ts (30 check)` <sub>(CLAUDE.md:144, CLAUDE.md:61, CLAUDE.md:295)</sub>
- **[ÇEKİRDEK]** `TravelerCard.contentDirty` tek yazıcı `markTravelerCardDirtyTx` (ACTIVE + contentDirty:false CAS; fazla işaretlemek GÜVENLİ, eksik HATA); K18 'ilk parti ataması bayraklanmaz' karta KOPYALANMAZ (kart parti doğmadan basılır); şablon düzenlemesi bayat İŞARETLEMEZ; `GET /html` TEMİZLEMEZ. · bekçi: `scripts/test_traveler_card_stale.ts` <sub>(CLAUDE.md:61, CLAUDE.md:144)</sub>
- **[ÇEKİRDEK]** Partiler snapshot'a YAZILMAZ, baskıda `resolveLiveBatches` canlı çözer: `mergedIntoId:null`, `K18_DEAD_STATUSES` dışı, sevk `cancelledAt:null` (en yeni + `(+N)`), sıra `createdAt` — `orderBy batchNumber` YASAK (P01…P99 sarar). 'Sevk rakamı brüt/donmuş belge' kuralı karta UZANMAZ. · bekçi: `scripts/test_traveler_card_a5_batches.ts (36 check)` <sub>(CLAUDE.md:137, CLAUDE.md:161)</sub>
- **[ÇEKİRDEK]** FAIL-CLOSED şablon çözümü: `templateId` verilmiş ama silinmiş/pasifse baskı 404 — yerleşiğe SAPMAZ (çuval etiketi emsali). İstisna DEĞİL: gövdesi boş RAW_HTML yerleşiğe düşer (şablon ÇÖZÜLMÜŞTÜR; alternatif boş kâğıt basmaktı). Bilinmeyen `{{anahtar}}` boş basar, baskıyı DURDURMAZ. · bekçi: `scripts/test_traveler_template.ts` <sub>(CLAUDE.md:152)</sub>
- **[ÇEKİRDEK]** Şablon güvenliği İKİ katman: ① `sanitizeTemplateHtml` (script/iframe/object/embed/link/meta/on*/javascript:/data:text/html) HEM kayıtta HEM render'da; aşırı kesme güvenli; dış `<img>`/`<a>` BİLEREK serbest ② değerler kaçırılır, yalnız QR SVG ham. Baskı iframe sandbox: `allow-scripts` YOK. · bekçi: `scripts/test_traveler_template.ts` <sub>(CLAUDE.md:152)</sub>
- **[ÇEKİRDEK]** Refakat Kartı + Şablon Stüdyosu (ve diğer iki çıktı ekranı) izni `document-template:read/write`; `admin:settings` iki kümede KALIR (boot izni getirir, ATAMAZ); READ ⊇ WRITE; tek kaynak `document-design.ts` + Electron `permissions.ts` aynası; kart ↔ route listesi BİREBİR; salt-okumada yazma çizilmez. · bekçi: `scripts/test_document_template_permission.ts (43 check)` <sub>(CLAUDE.md:130, CLAUDE.md:117, CLAUDE.md:152)</sub>
- **[ÇEKİRDEK]** İş emri belgeleri TEK uçtan `GET /api/work-orders/:id/documents` (kart + 3 PrintedDocType); istemci liste KURMAZ; liste izni ↔ baskı izni (`DOC_PERMISSIONS`) HİZALI — ayrışma = görünen satır + sessiz 403; iptal belge `cancelled:true` ile listede KALIR; sıra sunucudan (kart önce, tarih DESC). · bekçi: `scripts/test_workorder_documents.ts (liste×izin + her satır render)` <sub>(CLAUDE.md:62)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `PATCH /api/feature-flags` guard'ı ANAHTAR-KAPSAMLI, FAIL-CLOSED: gövde YALNIZ `documentsConfig`/`travelerCardConfig` taşıyorsa dar izin yeter; yabancı anahtar ya da boş gövde → admin:settings. Düz OR'a ÇEVİRME; `companyName`/letterhead/logo kümeye EKLENMEZ (firma kimliği). · bekçi: `scripts/test_document_template_permission.ts (düz OR sondası 7 kırmızı)` <sub>(CLAUDE.md:130)</sub>

### Kararlar

- **[PROFİL]** Bayat rozeti YÜZEYLERİ yok (2026-08-06 kullanıcı kararı; Electron diyalog/önizleme bandı, mobil detay bandı/rozet); backend kolonu, işaretleyici, print-event temizliği, audit `wasDirty` DURUYOR, `contentDirty` yanıtta döner. Geri istenirse bant DEĞİL gerçek karşılaştırma (planKey + parti izi). <sub>(CLAUDE.md:61, CLAUDE.md:62)</sub>
- **[PROFİL]** Kart varsayılan A5 (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize`); A4 panelden ya da baskı başına `?pageSize=A4|A5` (tek seferlik: yazılmaz, versiyon doğurmaz, geçersiz değer SESSİZCE yok sayılır — 400 sahayı kâğıtsız bırakır). Sayfa boyutu KURULUM AYARIDIR: yoğun kartlı kurulum A4 seçer, kod değişmez. <sub>(CLAUDE.md:137)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Basılan HER sürüm `printed_documents` defterine kart satırıyla AYNI tx'te arşivlenir (`archivePrintedVersionTx`; önceki sürümler tarihsel kopyaya düşer, koşulsuz); `GET /html?version=N` arşiv kopyasını içerik donuk / sunum canlı basar. <sub>(CLAUDE.md:144)</sub>
- **[ÇEKİRDEK]** Sayfaya bağlı HER ölçü tek kaynak `traveler-card.density.ts`; tek `transform: scale()` YASAK — iki oran (genişlik ~0.68 geometrik, yazı ~0.85 okunabilirlik); A4 sütunu eski sabitlerin aynısı, A4 çıktısı bayt-bayt korunur. Aynı patern altı belgeye `doc-density.ts`/`fason-ceki.density.ts` ile yayıldı. · bekçi: `scripts/test_traveler_card_a5_batches.ts §A` <sub>(CLAUDE.md:137, arşiv:267)</sub>
- **[ÇEKİRDEK]** `traveler_card_templates_isDefault_key` şema-DIŞI PARTIAL unique `WHERE isDefault=true` olmak ZORUNDA — düz unique sistemde toplam iki şablona izin verirdi; `test_db_invariants` envanterinde (depo/etiket emsalleri aynı kalıp). · bekçi: `scripts/test_db_invariants.ts` <sub>(CLAUDE.md:152)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `planKey` config/template'i DIŞLAR (tasarım değişikliği sürüm artırmaz) ve anahtar sırasından bağımsızdır (düz JSON.stringify YASAK); `buildPlan` dizileri `orderBy` ile deterministik; `snapshot` NULL eski kartta sürüm ARTMAZ; `buildSnapshot` yalnız kart doğuşu + `reprint` içindir. · bekçi: `scripts/test_traveler_card_stale.ts §6` <sub>(CLAUDE.md:144)</sub>
- **[ÇEKİRDEK]** `resolveConfigPageSize`→A5 / `resolveFrozenPageSize`→A4 ikilisi kodda duruyor ve 'tekleştirme' yorumu taşıyor; ANCAK A4 dalı hiçbir baskı yolundan ulaşılamaz (sunum canlı: dress() config'i normalize edilmiş canlı config ile ezer). Eski kartın 'A4 basılır' diye varsayılmasına yaslanan yeni kod YAZMA. <sub>(CLAUDE.md:137, CLAUDE.md:144)</sub>

### Reçeteler

- **[ÇEKİRDEK]** `middlewares/` envanteri (auth·rbac·error·device·uuid-param·latency·login-lockout) EKSİK: dizinde 15 dosya var (client-info, demo, finance, module, remote-access, settings-password, system-account, web-hardening listede yok) — liste güncellenmeli ya da 'başlıcaları' diye daraltılmalı. <sub>(CLAUDE.md:147)</sub>

### Kararlar

- **[PROFİL]** Kart şablonu üç kademe `TravelerCardTemplate`: BUILTIN (dokunmaz) · SECTIONS (bölüm sırası/aç-kapa) · RAW_HTML (tüm HTML kullanıcıda, yerleşik CSS yok). Baskı çözümü: varsayılan şablon > sistem ayarı; tablo boşken çıktı Faz 2 öncesiyle BİREBİR. Tek giriş `renderTravelerCard`. · bekçi: `scripts/test_traveler_template.ts (31 check)` <sub>(CLAUDE.md:152)</sub>
- **[ÇEKİRDEK]** `TravelerCard.printedAt` `@default(now())` KALDIRILDI (K8, 2026-08-29): kart açılışta doğduğu için hiç basılmadan 'basım tarihi' taşıyordu (sahada 153 kart); alanı yalnız baskı yolu (`print-event`/reprint) yazar — 'printedAt var = basıldı' yeni satırlarda doğru, eski satırlarda değil. <sub>(CLAUDE.md:136)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Tık hedefi İKİ sözleşme: kenar menüsü `useTabTarget` (sol tık sekme aç/odakla — başka işe geçiş), hub kartı `useDrillTarget` (AYNI sekmede yerinde in — aynı işin adımı); karıştırılmaz; ikisinde de sağ/orta tık arka planda yeni sekme. · bekçi: `Electron/src/components/hub/HubCard.test.tsx` <sub>(CLAUDE.md:231)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Electron'da belge satırının varsayılan dalı generic `PrintedDocDialog` ÖNİZLEMESİDİR — hiçbir satır tıklanınca doğrudan yazıcıya gitmez (kart/fason sevk kendi zengin diyaloğunda); backend listeye yeni tip eklerse 'önizlemesiz' doğmaz; revizyon izni `workorder:write` DOC_PERMISSIONS write ile hizalı. <sub>(CLAUDE.md:62)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Toplu baskıda `@page` gövde CSS'inde KALAMAZ (son yazan kazanır → A5 kart A4'e basılır): adlandırılmış sayfaya taşınır (`@page wdocN` + `page: wdocN`); CSS YORUMLARI taramadan ÖNCE silinir (`stripCssComments`, sıra zorunlu — yorumdaki `@page` kartı 2 sayfa bastırıyordu); tek belge HTML AYNEN döner. · bekçi: `Electron/src/lib/print-merge.test.ts ('YORUM içindeki @page tuzağına düşmez')` <sub>(CLAUDE.md:281, CLAUDE.md:284)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Sonsuz kaydırma OTOMATİK — 'Daha Fazla Yükle' butonu YOK: `useDataTable`+`DataTable` hazır alır; özel `useInfiniteQuery` listelerinde `useInfiniteScroll` (rootRef→PageBody, sentinelRef→`AutoLoadMore`); tam-ekran editörler `PageShell`+`PageFooter`. <sub>(CLAUDE.md:176)</sub>
- **[ÇEKİRDEK]** Sidebar'a tanım satırı EKLENMEZ — tek 'Tanımlar' girişi `/definitions` hub'ına gider; yeni master data: `pages/Definitions/tile-config.ts`'e kart + `src/routes/content-routes.tsx`'e route (notun 'router.tsx' ifadesi BAYAT: router.tsx 39 satırlık auth router). <sub>(CLAUDE.md:243, CLAUDE.md:385)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Çok top okutan her ekran `trigger="tap"` (kamera kendiliğinden okumaz — sorun 'istenmeden okuma', çözüm taramayı kapatmak); tek okuyup kapanan ekranlar (refakat kartı/iş emri QR dahil) `auto`. Not: KK1 ana giriş auto, scan-back modalı çok-okutmalı olduğu için tap — kural tutarlı. <sub>(CLAUDE.md:415)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Baskı iki uçtan: TRAVELER_CARD → `/traveler-cards/:id/html` (+ `print-event`), diğerleri → `/printed-documents/:docType/:sourceId/html`; mobilde dallanma TEK yerde (`workOrderDocuments.printDocument`), mobil BİLİNÇLİ doğrudan basar. Yeni tip: backend listeye ekler, mobilde yalnız printDocument. <sub>(CLAUDE.md:62)</sub>
- **[ÇEKİRDEK]** Mobilde tıklanabilir her alan `react-native-paper` ile kurulur (sıfırdan yazma): `TouchableRipple` (Pressable/TouchableOpacity yerine) · `Button` · `IconButton` · `Appbar.Action` · `List.Item` · pasif kart `Surface`. <sub>(CLAUDE.md:285)</sub>
- **[ÇEKİRDEK]** Ölçüm aleti varsa okuma TEK DOKUNUŞ (⚖ → oku → doğrudan kaydet → kartta göster; araya input modalı KOYMA, tekrar basış idempotent ezer); manuel/ikincil yollar ⋮ menüsünde `SackActionsSheet` (bottom AppModal, satır ≥56dp) — yıkıcı aksiyon menüye taşınsa da ONAY DİYALOĞU KORUNUR. <sub>(CLAUDE.md:327, CLAUDE.md:331)</sub>
- **[ÇEKİRDEK]** Picker içi 'yeni ekle' tetiği `PickerModal.leadingAction`: listenin İLK hücresinde mor (`colors.action`, indigo 'seçili' vurgusuyla çakışmasın) aksiyon kartı, sıralama/aramadan bağımsız; basılınca picker KAPANMAZ, form `quickAddSlot`'ta açılır; listenin üstüne ayrı outlined buton KOYMA. <sub>(CLAUDE.md:315)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-08-03__refakat-karti-sablonu-uc-kademe-2026` → `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: 'Şablon KARTA DONAR (snapshot.template); reprint yeni şablonu alır; cevap yeniden bas' kuralı 2026-08-06'da kaldırıldı — şablon + config (sayfa dahil) HER kartta HER baskıda canlı çözülür; yalnız İÇERİK geçersiz kartta donuk. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-03__refakat-karti-sablonu-uc-kademe-2026` → `R:2026-08-05__belge-tasarimi-ayri-bir-yetkidir-sistem`: 'İzin AÇILMADI: stüdyo admin:settings ile korunur' → 2026-08-05 revizyonu: Refakat Kartı + Şablon Stüdyosu `document-template:read/write` (DOCUMENT_DESIGN_READ/WRITE, admin:settings OR'da kalır). ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__2026-08-05-parti-no-k` → `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: print-event 'audit-only, versiyon ARTIRMAZ, snapshot'a dokunmaz' → aynı gün ikinci notla: print-event basılan planı snapshot'a YAZAR, içerik değiştiyse version++ (audit PRINT_REVISION), aynı tx'te arşiv kopyası. ⚠️ çürütücü itiraz etti — ihtiyatla
- **KISMI** `R:2026-08-05__2026-08-05-is-emri-belgeleri` → `R:2026-08-05__2026-08-05-parti-no-k`: N22'nin 'Kart bayatsa detaydaki uyarı bandı DOKUNULABİLİR ve kartı doğrudan basar' (mobil) + 'kart için contentDirty rozeti' → N21'in 2026-08-06 bendi: rozet YÜZEYLERİ dört yerde de kaldırıldı (backend alanı duruyor). ✅ çürütmeden geçti
- **KISMI** `R:2026-08-03__refakat-karti-a5-varsayilan-parti-blogu` → `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: 'resolveFrozenPageSize (donmuş snapshot, alan yoksa) → A4; alanı taşımayan eski kart A4 basılır, yeniden ölçeklenmez' davranışı fiilen öldü: sunum (sayfa boyutu dahil) her baskıda canlı config'ten çözülür, normalize A5 yazar → A4 dalı erişilemez. Fonksiyon ve 'iki varsayılanı tekleştirme' yorumu kodda duruyor. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__2026-08-05-is-emri-belgeleri` → `R:2026-08-05__2026-08-05-is-emri-belgeleri`: Aynı notun eski cümlesi ('Electron'un ESKİ Belgeler diyaloğu iptalleri gizliyor ve kendi listesini wo.steps[].dispatches'ten kuruyor — bilinçli, geçici ayrışma') notun kendi 2026-08-06 bendi ve kodla kapandı: diyalog tek uçtan okur, iptal İPTAL rozetiyle listede. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__belge-tasarimi-ayri-bir-yetkidir-sistem` → `kod: Electron/src/pages/Definitions/tile-config.ts:210-215 (2026-08-14 persona denetimi)`: Parantez 'Etiketler kartının kendisi hâlâ station:read ile süzülüyor; bilinen hiza sorunu' BAYAT — kart artık permissionAny: [station:read, label-template:read] taşıyor (route ile aynı liste). ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-08-03__refakat-karti-sablonu-uc-kademe-2026` ↔ `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: Kod N24'ü uyguluyor (Teks-Erp/src/services/traveler-card.service.ts:966-971 tek dress()). ⚠️ İki KOD YORUMU hâlâ eski kuralı söylüyor: schema.prisma:3492-3494 ('SUNUMU … donmuş kalır, yalnız reprint tazeler') ve traveler-card.routes.ts:297-299 swagger ('Yeni versiyon doğurmaz, snapshot'a dokunmaz'). N20'nin kök metnindeki cümle de düzeltilmeli.
- `R:2026-08-05__2026-08-05-parti-no-k` ↔ `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: Kod N24: recordPrintEvent kart satırına snapshot+version yazar ve archivePrintedVersionTx ile arşivler; audit event PRINT_REVISION|PRINT_EVENT. N21'in kök özet satırı bu cümleyi taşımıyor (yalnız arşiv metni), o yüzden dizin düzeyinde çelişki yok; arşivde şerh gerekir.
- `R:2026-08-03__refakat-karti-a5-varsayilan-parti-blogu` ↔ `R:2026-08-05__refakat-karti-plan-canli-sunum-donmus`: Kod N24: her baskı yolu (güncel + ?version arşiv) snapshot.config'i resolveForPrint→normalize (pageSize A4|A5) ile ezer; resolveFrozenPageSize'ın A4 dalı hiçbir baskı yolundan ulaşılamıyor. N19'un bu alt maddesi tarihsel gerekçe olarak arşive iner; 'iki varsayılanı tekleştirme' yorumu kodda duruyor (density.ts:307-325).
- `R:2026-08-05__2026-08-05-is-emri-belgeleri` ↔ `R:2026-08-05__2026-08-05-parti-no-k`: Kod N21: mobilde bant yok (WorkOrderDetailSheet.tsx:62-65 kaldırma yorumu), rozet yok (WorkOrderDocumentsSheet.tsx:144-146); Electron TravelerCardPrintDialog.tsx:37-47. `contentDirty` yanıtta hâlâ dönüyor (workorder.service.ts:6444) — okuyan yüzey yok. ⚠️ workorder.service.ts:2347 yorumu ('rozet (WO detay başlığı)') bayat.

## Açık sorular

- N20 'çözüm zinciri AÇIK SEÇİM > varsayılan şablon > sistem ayarı': `resolveForPrint(templateId)` dalı fonksiyonda var ama üç çağıranın üçü `null` geçiyor (traveler-card.service.ts:942,969,1230) ve route/controller'da `templateId` yok — kart başına şablon seçimi hiç kurulmadı mı, bilinçli mi? Not söylemiyor; kural bugün fiilen 'varsayılan > sistem ayarı'.
- İki KOD YORUMU eski kuralı taşıyor ve düzeltme kararı ister (salt-okunur ajan dokunmadı): prisma/schema.prisma:3492-3494 ('SUNUMU … donmuş kalır, yalnız reprint tazeler'), traveler-card.routes.ts:297-299 swagger ('Yeni versiyon doğurmaz, snapshot'a dokunmaz'), workorder.service.ts:2347 ('rozet (WO detay başlığı)').
- N24 'print-event' bilinen sınır (HTML çekme ≠ basıldı; iş emri o saniyede değişirse kâğıt A, kayıt B planı — traveler-card.service.ts:340-348 yorumu) notlarda yok; makinesi bilinçli kurulmadı — karar kaydı istenirse arşive eklenmeli.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[PROFİL]** Belge Şablonu önizlemesinde sayfa-sığma göstergesi vardır — ayarı yapan taşmayı kaydetmeden görür (A5'te en ağır kart %75 doluluk; taşma 8 adım + 6 sipariş + 6 partide). <sub>(kök 2026-08-03)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_batch_drop`, `test_batch_redye_three_paths`, `test_client_token_idempotency`, `test_consecutive_fason`⚠️, `test_controller_binds`, `test_direct_ship_fason`, `test_doc_render_html`, `test_doc_sample_html`, `test_document_template_permission`, `test_fason_ceki_draft`, `test_fason_open_dispatch_semantics`, `test_input_rolls_directship`, `test_manual_move_fason_receive`, `test_manual_move_field_continuity`, `test_order_cancel_card_dirty`⚠️, `test_phase2_broad_hardening`, `test_race_conditions`, `test_route_skip_warning`, `test_split_card_lineage`, `test_traveler_card_a5_batches`, `test_traveler_card_fields`, `test_traveler_card_stale`, `test_traveler_card_versions`, `test_traveler_print_active_card`, `test_traveler_scan_dedup`, `test_traveler_template`⚠️, `test_workorder_documents`

İstemci: `travelerCardFields.test.ts`, `print-event-toast.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-05 · 2026-08-05 — PARTİ NO KÂĞIDA BASILIR + refakat kartı "bayat" bayrağı — `CLAUDE-NOT-ARSIVI.md:230-240`
- 2026-08-05 · 2026-08-05 — İŞ EMRİNİN BELGELERİ TEK UÇTAN: `GET /work-orders/:id/documents` — `CLAUDE-NOT-ARSIVI.md:241-250`