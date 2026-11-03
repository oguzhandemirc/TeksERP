# Refakat kartı
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/refakat-karti.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Kart iş emri AÇILIŞINDA doğar; bir WO = TEK kart (`TravelerCard.workOrderId @unique`); `cardNumber = barcode = workOrderNumber`, karekod sürümler arası SABİT; Parti (Batch) kart ÜRETMEZ.
- [ÇEKİRDEK] ACTIVE kartın önizleme+baskısı iş emrinin GÜNCEL hâlinden (plan CANLI); SUNUM (şablon/config/sayfa) her baskıda canlı, karta DONDURULMAZ; geçersiz kartın (VOIDED/COMPLETED/REPRINTED) yalnız İÇERİĞİ donuk; iş emri okunamazsa snapshot'a düş.
- [ÇEKİRDEK] Tasarımcı şablonu (bayrak açık + `DocumentTemplateDefault[TRAVELER_CARD]` yayında) kartın SUNUMUDUR: her baskıda canlı çözülür, karttaki `designTemplate` izi okunmaz; şablonun donmuş `ayar`ı kullanılır, tek seferlik sayfa ezmesi ona biner; RAW_HTML/SECTIONS yolu değişmez.
- [ÇEKİRDEK] Önizleme, baskı ve sürüm no TEK karar noktası `resolvePrintPlan`; önizlemedeki `v` bu baskının sürümü, GET yan etkisiz. Generic freeze/reissue/lazy-init TRAVELER_CARD için KAPALI (`SELF_MANAGED_DOC_TYPES` → 400).
- [ÇEKİRDEK] `print-event` = kart KÂĞITTA basıldı (PDF ve `GET /html` bildirmez); sunucu basılan planı snapshot'a yazar, `contentDirty` temizler, içerik değiştiyse `version++` (PRINT_REVISION) — aynı içerik sürüm şişirmez; bildirim hatası yutulur.
- [ÇEKİRDEK] `contentDirty` tek yazıcı `markTravelerCardDirtyTx` (ACTIVE + contentDirty:false CAS; fazla işaretlemek güvenli, eksik HATA); K18 'ilk parti ataması bayraklanmaz' karta KOPYALANMAZ; şablon düzenlemesi bayat İŞARETLEMEZ; `GET /html` TEMİZLEMEZ.
- [ÇEKİRDEK] Partiler snapshot'a YAZILMAZ, baskıda `resolveLiveBatches` canlı çözer: `mergedIntoId:null`, `K18_DEAD_STATUSES` dışı, sevk `cancelledAt:null` (en yeni + `(+N)`), sıra `createdAt` — `orderBy batchNumber` YASAK. Brüt/donmuş belge kuralı karta UZANMAZ.
- [ÇEKİRDEK] FAIL-CLOSED şablon: verilen `templateId` silinmiş/pasifse baskı 404, yerleşiğe SAPMA; gövdesi boş RAW_HTML yerleşiğe düşer; bilinmeyen `{{anahtar}}` boş basar, baskıyı durdurmaz.
- [ÇEKİRDEK] Şablon güvenliği iki katman: `sanitizeTemplateHtml` (script/iframe/object/embed/link/meta/on*/javascript:/data:text/html) HEM kayıtta HEM render'da, dış `<img>`/`<a>` serbest; değerler kaçırılır, yalnız QR SVG ham. Baskı iframe sandbox'ında `allow-scripts` YOK.
- [ÇEKİRDEK] Refakat Kartı + Şablon Stüdyosu (ve iki çıktı ekranı) izni `document-template:read/write`; `admin:settings` iki kümede KALIR (ATAMAZ); READ ⊇ WRITE; tek kaynak `document-design.ts` + Electron `permissions.ts` aynası; kart ↔ route listesi BİREBİR; salt-okumada yazma çizilmez.
- [ÇEKİRDEK] İş emri belgeleri TEK uçtan `GET /api/work-orders/:id/documents` (kart + 3 PrintedDocType); istemci liste KURMAZ; liste izni ↔ baskı izni (`DOC_PERMISSIONS`) HİZALI; iptal belge `cancelled:true` ile listede kalır; sıra sunucudan (kart önce, tarih DESC).

### Yasaklar

- [ÇEKİRDEK] `PATCH /api/feature-flags` guard'ı ANAHTAR-KAPSAMLI, FAIL-CLOSED: gövde yalnız `documentsConfig`/`travelerCardConfig` ise dar izin; yabancı anahtar/boş gövde → admin:settings. Düz OR'a ÇEVİRME; `companyName`/letterhead/logo kümeye EKLENMEZ.

### Kararlar

- [PROFİL] Bayat rozeti YÜZEYİ yok (Electron/mobil); backend kolonu, işaretleyici, print-event temizliği, audit `wasDirty` durur, `contentDirty` yanıtta döner. Geri istenirse bant değil gerçek karşılaştırma (planKey + parti izi).
- [PROFİL] Kart varsayılan A5 (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize`); A4 panelden ya da baskı başına `?pageSize=A4|A5` (yazılmaz, sürüm doğurmaz, geçersiz değer SESSİZCE yok sayılır). Sayfa boyutu KURULUM AYARIDIR.

## Backend

### Değişmezler

- [ÇEKİRDEK] Basılan HER sürüm `printed_documents` defterine kart satırıyla AYNI tx'te arşivlenir (`archivePrintedVersionTx`); `GET /html?version=N` arşiv kopyasını içerik donuk / sunum canlı basar.
- [ÇEKİRDEK] Sayfaya bağlı her ölçü tek kaynak `traveler-card.density.ts`; tek `transform: scale()` YASAK (iki oran: genişlik ~0.68, yazı ~0.85); A4 çıktısı bayt-bayt korunur. Aynı patern `doc-density.ts`/`fason-ceki.density.ts`.
- [ÇEKİRDEK] `traveler_card_templates_isDefault_key` şema-DIŞI PARTIAL unique `WHERE isDefault=true` olmak ZORUNDA; `test_db_invariants` envanterinde.

### Tuzaklar

- [ÇEKİRDEK] `planKey` config/template'i DIŞLAR ve anahtar sırasından bağımsızdır (düz JSON.stringify YASAK); `buildPlan` dizileri `orderBy` ile deterministik; `snapshot` NULL eski kartta sürüm ARTMAZ; `buildSnapshot` yalnız kart doğuşu + `reprint` içindir.
- [ÇEKİRDEK] `resolveConfigPageSize`→A5 / `resolveFrozenPageSize`→A4 kodda durur ama A4 dalı hiçbir baskı yolundan ulaşılamaz; eski kartın 'A4 basılır' varsayımına yaslanan kod YAZMA.

### Reçeteler

- [ÇEKİRDEK] `middlewares/` envanteri (auth·rbac·error·device·uuid-param·latency·login-lockout) EKSİK (dizinde 18 dosya); liste güncellenmeli ya da 'başlıcaları' diye daraltılmalı.

### Kararlar

- [PROFİL] Kart şablonu üç kademe `TravelerCardTemplate`: BUILTIN · SECTIONS · RAW_HTML (yerleşik CSS yok). Çözüm: varsayılan şablon > sistem ayarı; tablo boşken çıktı Faz 2 öncesiyle BİREBİR. Tek giriş `renderTravelerCard`.
- [ÇEKİRDEK] `TravelerCard.printedAt` `@default(now())` YOK (K8); alanı yalnız baskı yolu (`print-event`/reprint) yazar — 'printedAt var = basıldı' yalnız yeni satırlarda doğru.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] Tık hedefi iki sözleşme: kenar menüsü `useTabTarget` (sekme aç/odakla), hub kartı `useDrillTarget` (aynı sekmede in); karıştırma; ikisinde de sağ/orta tık arka planda yeni sekme.

### Yasaklar

- [ÇEKİRDEK] Belge satırının varsayılan dalı generic `PrintedDocDialog` ÖNİZLEMESİ; hiçbir satır doğrudan yazıcıya gitmez (kart/fason sevk kendi diyaloğunda); yeni tip 'önizlemesiz' doğmaz; revizyon izni `workorder:write` DOC_PERMISSIONS write ile hizalı.

### Tuzaklar

- [ÇEKİRDEK] Toplu baskıda `@page` gövde CSS'inde KALAMAZ: adlandırılmış sayfaya taşı (`@page wdocN` + `page: wdocN`); CSS yorumları taramadan ÖNCE silinir (`stripCssComments`); tek belge HTML AYNEN döner.

### Reçeteler

- [ÇEKİRDEK] Sonsuz kaydırma OTOMATİK, 'Daha Fazla Yükle' butonu YOK: `useDataTable`+`DataTable`; özel `useInfiniteQuery`de `useInfiniteScroll` (rootRef→PageBody, sentinelRef→`AutoLoadMore`); tam-ekran editörler `PageShell`+`PageFooter`.
- [ÇEKİRDEK] Sidebar'a tanım satırı EKLENMEZ — tek 'Tanımlar' girişi `/definitions`; yeni master data: `pages/Definitions/tile-config.ts`'e kart + `src/routes/content-routes.tsx`'e route.

## Tablet (mobil)

### Değişmezler

- [ÇEKİRDEK] Çok top okutan her ekran `trigger="tap"`; tek okuyup kapanan ekranlar (refakat kartı/iş emri QR dahil) `auto`.

### Reçeteler

- [ÇEKİRDEK] Baskı iki uç: TRAVELER_CARD → `/traveler-cards/:id/html` (+ `print-event`), diğerleri → `/printed-documents/:docType/:sourceId/html`; mobilde dallanma TEK yerde (`workOrderDocuments.printDocument`), mobil doğrudan basar.
- [ÇEKİRDEK] Mobilde tıklanabilir her alan `react-native-paper`: `TouchableRipple` (Pressable/TouchableOpacity yerine) · `Button` · `IconButton` · `Appbar.Action` · `List.Item` · pasif kart `Surface`.
- [ÇEKİRDEK] Ölçüm aleti varsa okuma TEK DOKUNUŞ (araya input modalı KOYMA, tekrar basış idempotent ezer); manuel yollar ⋮ menüsünde `SackActionsSheet` (satır ≥56dp); yıkıcı aksiyonda ONAY DİYALOĞU KORUNUR.
- [ÇEKİRDEK] Picker içi 'yeni ekle' `PickerModal.leadingAction`: listenin İLK hücresinde mor (`colors.action`) aksiyon kartı; basılınca picker KAPANMAZ, form `quickAddSlot`'ta açılır; listenin üstüne ayrı outlined buton KOYMA.

## Geçersiz kılınan kurallar — bunlara UYMA

- 'Şablon KARTA DONAR' → GEÇERSİZ: şablon + config her baskıda canlı.
- 'Stüdyo admin:settings ile korunur' → GEÇERSİZ: `document-template:read/write`.
- 'print-event audit-only, sürüm artırmaz' → GEÇERSİZ: snapshot'a yazar, içerik değiştiyse version++.
- Bayat uyarı bandı/`contentDirty` rozeti (mobil+Electron) → kaldırıldı.
- 'Eski kart A4 basılır' (`resolveFrozenPageSize`) → ölü dal.
- Electron eski Belgeler diyaloğunun kendi listesi → GEÇERSİZ: tek uç.
- 'Etiketler kartı yalnız station:read ile süzülür' → bayat; `permissionAny: [station:read, label-template:read]`.

## Çözülmüş çelişkiler

- Kod yorumları eski kuralı söylüyor (schema.prisma 'SUNUMU donmuş', traveler-card.routes swagger, workorder.service 'rozet'); geçerli olan kod + bekçi E2. Ayrıntı ayrıntı dosyasında.

## Açık sorular

- Kart başına `templateId` seçimi kurulmadı; kural fiilen 'varsayılan > sistem ayarı'.
- Eski kuralı taşıyan kod yorumları düzeltme kararı bekliyor.
- `print-event` sınırı (HTML çekme ≠ basıldı) için karar kaydı yok.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- [PROFİL] Belge Şablonu önizlemesinde sayfa-sığma göstergesi vardır.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_batch_drop`, `test_batch_redye_three_paths`, `test_client_token_idempotency`, `test_consecutive_fason`⚠️, `test_controller_binds`, `test_direct_ship_fason`, `test_doc_render_html`, `test_doc_sample_html`, `test_document_template_permission`, `test_fason_ceki_draft`, `test_fason_open_dispatch_semantics`, `test_input_rolls_directship`, `test_manual_move_fason_receive`, `test_manual_move_field_continuity`, `test_order_cancel_card_dirty`⚠️, `test_phase2_broad_hardening`, `test_race_conditions`, `test_route_skip_warning`, `test_split_card_lineage`, `test_traveler_card_a5_batches`, `test_traveler_card_fields`, `test_traveler_card_stale`, `test_traveler_card_versions`, `test_traveler_print_active_card`, `test_traveler_scan_dedup`, `test_traveler_template`⚠️, `test_workorder_documents`, `test_belge_kart_canli`, `test_db_invariants`

İstemci: `travelerCardFields.test.ts`, `print-event-toast.test.ts`, `HubCard.test.tsx`, `print-merge.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- Ayrıntı dosyasında ve `CLAUDE-NOT-ARSIVI.md:230-250`.
