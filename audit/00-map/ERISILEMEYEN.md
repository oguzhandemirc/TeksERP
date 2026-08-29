# ERİŞİLEMEYEN / KAPSANMAYAN — 16 haritanın birleşimi (aşama ① KEŞİF)

**Tarih:** 2026-08-28 · HEAD `ce8681d1` · Kaynak: her haritanın `## KAPSANMAYAN / ERİŞİLEMEYEN` bölümü (K1a, K1b, K2a, K2b, K3a, K3b, K4, K5, K6, K7a, K7b, K8, K9, K10, K11, K12) + `[VARSAYIM]` etiketli iddialar.
**Düşen haritalayıcı:** **YOK** — 16/16 harita `audit/00-map/` altında mevcut ve okundu. Tek eksik girdi: `audit/01-find/_FINDER-BRIEF.md` (K2b ve K6 bunu "dizinde bir ara görünüp kayboldu" diye not ediyor; A-L alan harfleri o dosyaya atıfla kullanılıyor — bu sentez, görev metnindeki A-L tanımını esas aldı).

Sınıflar: **① canlı ortam** (erişim yok) · **② veri kopyası sınırı** (kopya 190/195 migration) · **③ okunmayan kod** (harita kapsamı dışı gövdeler) · **④ koşulmayan ölçüm** (salt-okunur kural) · **⑤ istemci tarafı** (Electron/mobil) · **⑥ belge/yöntem** · **⑦ açık [VARSAYIM]'lar**.

---

## ① Canlı prod ortamı — hiçbir haritada ölçülemedi

| Madde | Neden / hangi haritalar | ② için ne gerekir |
|---|---|---|
| Canlı prod DB (`tekserp`, Windows PG 16.9) | Erişim yok; tüm sayılar 2026-08-25 kopyası `tekserp_saha_0825` (K2a, K2b, K3a, K4, K5, K6, K7a, K7b, K8, K9, K10, K11, K12) | Canlı erişim ya da taze kopya |
| 2.9.0 deploy'undan sonraki 3 gün (08-25 → 08-28) verisi | Kopya tarihi (K10) | — |
| Per-DB GUC'lar: `statement_timeout=50s`, `idle_in_transaction_session_timeout=5min`, **`teks.audit_guard`** | `pg_db_role_setting` restore'da taşınmaz; kopyada boş (K2b §2.4, K4, K8 H-4, K10). Sahaya dair her GUC cümlesi repo notuna dayanır | `/api/admin/health.auditGuard` canlıda okunmalı; `SHOW` sorguları canlıda |
| `max_connections`, gerçek locale/ICU (`C` locale iddiası), `pg_stat_*`, bloat, kilit/bekleme istatistikleri, `pg_stat_database.deadlocks` | Kopya yerel PG 18.6'ya restore edildi (K2b, K3a, K12) | canlı `pg_stat_*` |
| Prod `.env` içeriği / JWT secret'ın dev ile eşitliği | Sır rapora girmez; `Teks-Erp/.env` git'te izleniyor (K5 H1, K12 F-OPS-VER-001) | ops teyidi (içerik değil, "farklı mı" cevabı) |
| Sahadaki gerçek `ecosystem.config.js` env'i (`BACKUP_SCHEDULE_ENABLED`, `BACKUP_OFFSITE_DIR`, `BACKUP_RCLONE_REMOTE`) | Repo kopyası boş; kopyada `nightly` 1 koşum var → env bir dönem açık mıydı (K8, K9 H-9, K12) | sunucu dosyası |
| rclone kurulumu, `pm2-logrotate` modülü, disk doluluğu, `kill_timeout` etkin değeri, JWT rotasyonu | Sunucu tarafı (K12 §3, K8) | sunucu incelemesi |
| `yedekle.ps1` (Windows Görev Zamanlayıcı gece yedeği) | Repoda bulunamadı (`find` 0); yalnız DEPLOY-RUNBOOK referansı (K8) | sunucu dosyası |
| Windows pm2 IPC `shutdown` / hard-kill davranışı (mDNS goodbye, `.part` temizliği) | darwin ortamda test edilemez (K8) | Windows'ta tatbikat |
| Deploy sonrası `Q-AUD-05b` (iptal izi 47/52 eksik) — hangi iptal yolu / deploy tarihi ilişkisi | Kopya 08-25; deploy 08-24/25 (K10 H-5) | canlıda aynı sorgu |
| Sahada yarı mamul kabulünün hangi izinle yapıldığı (`mobile:kk1-yari-mamul` 0 kullanıcı) | K1a H8 | canlı audit |

## ② Veri kopyası sınırları (190/195 migration — son 5 migration'ın kolonları YOK)

| Madde | Etki | Harita |
|---|---|---|
| `orders.cancelledAt/cancelReason/cancelReasonCode`, `order_lines.cancelledAt/cancelReason/cancelReasonCode/cancelledById`, `orders_active_createdAt_idx`, `ReasonPresetKind.ORDER_CANCEL` kopyada yok | INV-SIP-02, Q-SM-08 dev varyantı, İptal Karnesi, `ACTIVE_LINE` süzgeci yalnız dev'de ölçülebilir; dev'de iptal kalem 0 / iptal sipariş damgasız 4/4 | K2a, K2b §2.6, K7b §8.1, K10 |
| `SubcontractorReceiptItem.receivedQty/isPartial`, `remainderClosedAt`, `RollVariance.sourceRefId/reversedAt` etkileri (fason çekme / kalan kapama satırları 0) | Kısmi kabul, çekme defteri, `SUBCONTRACTOR_RETURN` sapması canlı veriyle ölçülemedi | K7a, K7b, K10 (Q-FAS-06) |
| `roll_plan_deviations` 0 satır (prod+dev), `direct_shipments` 0, kartela akışı 0, `import_runs` 0, `TravelerCardTemplate` 0, `Manifest` 0, `A1_STOCK` 0, `SEMI_FINISHED` 0 | Bu yüzeylerin canlı davranışı yalnız kod okuması / fixture bekçisiyle; §26b "vakumen yeşil" | K2a §6, K7b, K9 §13, K10 |
| Dev DB test kalıntılı (549/762 WO test-önekli, `system_logs` 152.892 satır) | Dev'e karşı koşan her tutarlılık/rapor ölçümü kirli; satır sayıları sahadan alındı | K11 H-2, K2b, K12 |
| Dev DB'nin prod'dan 2026-08-02'de çekildiği varsayımı (`POOL_TIMEOUT` olayı dev makinesine ait) | 12-tx belgesinin "kayıtlı tek olay" iddiası prod'a ait değil | K12 satır 24 [VARSAYIM] |
| `_prisma_migrations.checksum` ↔ dosya sha256 eşleşmedi (algoritma farkı, tüm 195 satır farklı) | "Uygulandıktan sonra düzenlenen dosya var mı" sorusu yanıtsız | K2b §5 H-6 |
| Sahada `ReasonPresetKind.WORK_ORDER_REWORK` defter dışı açılmış (migration satırı yok, enum'da değer var) | Nasıl açıldığı bilinmiyor | K2b H-14 [VARSAYIM] |

## ③ Okunmayan kod gövdeleri (harita başına)

| Harita | Okunmayan / yalnız grep düzeyinde |
|---|---|
| **K1a** | Servis gövdeleri (inventory, label, kartela, kursun-*, permission-management, backup, db-copy, system-setting) — "yanıtta ne döner" handler'daki `res.*`'a dayanır; Swagger YAML blokları süzüldü (belge↔kod sözleşmesi karşılaştırılmadı); `ImportService.preview` ImportRun yazıyor mu, `FreeDocumentService.create` audit, `getBatchNumberState` yanıt şekli; `AuthService.verifyToken/issueToken` payload; 26 kapsam dışı route dosyası (K1b'de) |
| **K1b** | Servis gövdeleri tam okunmadı (yalnız handler→servis satırı, tx/updateMany/advisory/raw sayaçları, seçili metotlar); `PeripheralDeviceService.getForDevice/getForSession` kind doğrulaması; `StationCapabilityService.setCapabilities` tx içeriği; `ReasonPresetService.reorder` kind/id uyuşmazlığı; `SearchService` kova↔katalog hizası; Swagger hayalet uçlar (`/api-docs` JSON üretilmedi); rota bazlı bekçi eşlemesi |
| **K2a** | Migration dosyaları içeriği (K2b'ye); `ScanType` dağılımı, `traveler_card_scans` sayısı, `SystemLog.action` dağılımı; mobil/Electron enum ikizleri; `prisma/seed*` ↔ partial unique çarpışması; JSON alan içerik şemaları (`AppPreferences`, `DocumentConfig`, `LabelElement`, `TravelerCardSnapshot`) ve sanitize yolları; index seçicilik/EXPLAIN; `RollBarcodeCounter`/`nextDailySeq` kilit sırası (K3'e) |
| **K2b** | `20260611084953_native_uuid_pk_fk` (2.254 satır) ve `20260525174522_init` (1.678 satır) satır satır okunmadı; `consistency-check*.sql` koşulmadı (§4 ölçümleri sadeleştirilmiş ikizler, ör. A-3 naif toplam); uygulama guard'larının tam listesi (K4/K5/K10'a) |
| **K3a** | `traveler-card.service buildPlan/resolveForPrint` (client aktarımı [VARSAYIM]); `batch.service moveRolls/mergeBatches/splitBatch`; `batch-dispatch-surgery.helper`; `copyStationCapabilitiesToRoll`; `coverage.helper`; `kursun-bypass-guard` assert gövdeleri; `printed-document` builder kayıt defteri; `subcontractor getCancelPreview/getUndoTransferPreview/previewDirectShip`; `shipping setShipmentInvoice/setDirectShipmentInvoice/setSackNotes` (tx'siz claim'ler); `order.service.create` (BaseService); `inventory getRelabelContext/getRollHistory`; ESLint `Promise.all(tx.*)` kuralı kapsamı; `updateManyAndReturn`/adapter tek-bağlantı davranışı (çalıştırılmadı); satır numaraları çalışma ağacından — HEAD ile aynı [VARSAYIM] |
| **K3b** | K3a kapsamındaki 60+ tx sitesi; `tambur-undo.service.ts:1640-1692`; `kursun-qc.service.ts:1160-1200`; `tambur.service.ts:540-925` (finalize ön-kontrolleri); `kursun-bypass.controller.ts` (Zod `rollIds` tavanı); `label-template.service.ts:1-290`; kursun-qc `:441` metot adı (`[VARSAYIM: completeQc2]`); `traveler-template.setDefault` P2002 → HTTP kodu; 14 `label-*` render dosyası + `native-*`/`codec`/`raster` (bilinçli atlandı — DB'ye dokunmuyor) |
| **K4** | Değişkenle kurulan `data` gövdeleri ("hangi alan" sütunu eksik kalabilir); BaseService DMMF `sanitizeWriteData`'nın nested alanlara izni; FK Cascade ile DB'nin sildiği çocuklar (K2a'ya); `test_*.ts` (brief gereği hariç); `search.service.ts:134 delegateOf`; `$executeRawUnsafe` tablo adlarının çalışma zamanı allowlist'i (`MergeEntity` union); yazıcı/TCP, `pg_dump`, FS yazımları; enclosing fonksiyon adları indent-tabanlı sezgisel [VARSAYIM]; ham SQL tarayıcısı değişkende kurulan SQL'i görmez (6 yanlış pozitif / 3 kör nokta listelendi) |
| **K5** | 580 route'un tek tek izin eşlemesi (K1'e); `linkOrderLines/unlinkOrderLine` route guard'ı [VARSAYIM `workorder:write` — K1b doğruladı: evet]; `BaseService.safeSortBy/buildWhereClause` allowlist tam doğruluğu; `constants/time.ts` `Prisma.raw` 9 çağıranı [VARSAYIM string literal]; `mobile-update`/`backup` dosya yolu kaçış testleri; Electron/mobil izin uygulaması tam envanteri; `sync-*-permissions.ts` bugün koşuyor mu; canlı AUTH IP dağılımı (kişisel veri); `requirePermission(undefined)` çalıştırılarak doğrulanmadı; `resolveExact` yanıtının Ctrl+K'daki kullanımı |
| **K6** | `DriverAdapterError`'ın 57014/40P01/25P03 için yüzeye çıkış sınıfı (23514 ölçümünden çıkarım); P2028'in adapter kurulumunda üretilip üretilmediği; statü taşıyan http-errors'ın dal 9'a düşmesi (kaynak okumasıyla, canlıda tetiklenmedi; `send` paketi okunmadı); `withBarcodeRetry` predicate sayımı elle grep (AST başarısız); process handler'ları bekçisi bulunamadı; 492 catch yalnız tarayıcıyla; 3-6k satırlık servislerde yalnız gösterilen aralıklar; `AuditService.*` tx callback'i içinde mi (K3'e); Electron/mobil `delivered/seeded/warnings/idempotentReplay/failed` alan tüketimi; 366 bekçinin hata dallarını ölçümü (gövdeler okunmadı); `swallow-scan.mjs` string/regex literal körlüğü |
| **K7a** | `src/services/reports/*` (16 dosya `round1`) ve `document-render/*` hesap satırları (K7b); etiket yüzeyi (`label.service`, `label-field-values`, PPLB); Electron/mobil hesap ikizleri ("istemci brütü elle kurmaz" doğrulanmadı); `kursun-qc.service` gövdesi; `kursun-bypass` atama/dağıtım metrajları; import adaptörleri (CSV parse/yuvarlama); `duplicate-rolls.service`, merge miktar taşıması; `shipping.service.ts:2900-2970` `getShipmentById` SACK_ABSENT süzgeci [VARSAYIM]; `subcontractor.service.ts:1340-1360` kalem `dispatchedQty = currentQty` [VARSAYIM]; `computeLoadedByLine` çağıranları; bekçi içerikleri (`test_consistency §12/§13`, `test_tambur_undo §5/§11`, …); Decimal→double hassasiyet ölçümü; `fason.shrinkTolerancePct` hesabı istemci mi sunucu mu; yazılı yuvarlama politikası aranmadı |
| **K7b** | Bekçi içerikleri: `test_order_intake`, `test_order_cancellation`, `test_demand_analysis`, `test_order_leadtime`, `test_customer_scorecard`, `test_batch_trace`, `test_reports`, `test_timestamptz_contract`, `test_latency_*`, `test_work_session*` (grep 400 satırda kesildi) — "Σdaily.orderCount = summary" ölçülüyor mu bilinmiyor; Electron rapor sayfaları (`reportExport.ts`); mobil pano/istatistik; `getDispatchReport`/`collectShipmentDocContent` (K7a'ya); `computeWoMaterial/computeWoInput` doğruluğu; `currentStepId` temizleme guard'ları [VARSAYIM]; kısmi kabulde `RollMovement.qtyIn` [VARSAYIM]; `restoreCancelledRoll`/`quickStart` rework yolunun `finalizedAt`'e etkisi (`grep -rn finalizedAt src/services` ② için); rapor yanıt süreleri (`scale_report.ts` koşulmadı); `docs/history/SCALE-REPORT.md` bulunamadı; `endpoint_latency_daily` DELETE istisnasının belgelenmişliği |
| **K8** | archive/backup büyük-veri davranışı (1M+ eski log, 200-batch tavanı) canlıda hiç tetiklenmemiş; offsite-sweeper runtime yolu (rclone kurulu değil); `pg_db_role_setting` audit_guard yorumu [VARSAYIM: SET satırı yok = kapalı; role-level/postgresql.conf ihtimali elenmedi] |
| **K9** | Süre ölçümleri (tek etiket render/raster, 2000'lik toplu, `pg_restore --list`, `listDbCopies`); Electron/mobil istemci timeout/retry politikaları; `label.service.ts` `getRollLabel` müşteri dalı + fire kapısı; `label-template.service importTemplate/exportTemplate` + `sanitizeTemplateHtml` uygulaması ("içe aktarımda sanitize" [VARSAYIM] yorumdan); `archive-scheduler`, katalog job'ları, `latency-persist` (K8'e); `client-version-policy.ts`; 17 adaptörün 14'ü yalnız grep (`nameGuard/scope` beyanları); `test_printer_transport/device_transport` timeout dalı; ALS bağlamının fire-and-forget işlere taşınması [VARSAYIM]; merge CSV boyut sınırı; rclone `-` ile başlayan argümanın fiilen bayrak sayılması (rclone yok) |
| **K10** | `consistency-check` §7b/§7c/§12/§20/§24a/§25 saha koşumu (Tur 2); INV-FAS-07 (LIFO) ve INV-PAR-05 doğrulama sorgusu yazılamaz (tarihsel sıra); SM-01 57 yazma sitesinin tamamı açılmadı — `KARTELA_CONSUMED` diriltme yolu yok [VARSAYIM], kapanış dispozisyonu bekçi dosya adları [VARSAYIM]; mobil/Electron değişmezleri; kartela alanı satır satır haritalanmadı; içe aktarım ve etiket stüdyosu değişmezleri; Q-SM-08 tolerans varsayılanı 5 m [VARSAYIM]; Q-AUD-01b "olay bazlı audit" [VARSAYIM]; hiçbir bekçi koşturulmadı/kırılmadı |
| **K11** | 366 dosyanın tam gövdesi (yalnız 37 paralel + 20 token + ~20 seçilmiş); alan ataması dosya adından sezgisel; dolaylı servis kapsaması (çağrı grafiği yok); negatif sonda "kırmızı verdiği doğrulandı" iddiaları dosyaya bakılarak doğrulanmadı; `TEST-MM` artığının kaynağı [VARSAYIM]; 16 öneksiz-yazan dosyanın gerçek öneği [VARSAYIM]; mobil `entryAttempt.test.ts` / Electron testleri; prod kopyasında artık ölçümü; `load_test.ts`, `smoke_fason_http.ts`, `bench_*`, `seed-*`, `fix_*`, `backfill*` envanter dışı |
| **K12** | `audit/PLAN.md §7` oturum kartlarının tamamı; `audit/surface/01-08, 10, 13` yeniden ölçümü; `system_logs`ta `LOGIN_LOCKED`/429 kanıtı (sorgu kolon adı hatası, düzeltilmedi); F-KIM-GUV-002 devir satırı (`mode === "replace"` grep eşleşmedi); `shipping.service.ts` 2 yeni `updateMany` sınıflandırması, kabul şeması döngü tavanı, 5 raporun brüt/net durumu (② hotspot); `test_hard_delete_guard_coverage.ts` 69 yeni SET NULL bağı kapsıyor mu; modül→dosya eşlemesi (§6.3) `[TÜRETİLMİŞ]` |

## ④ Koşulmayan ölçümler / bekçiler (salt-okunur kural gereği)

| Madde | Harita |
|---|---|
| Test paketi (`npm test`) koşulmadı — yeşil/kırmızı oranı, süre, flake bilinmiyor; testler dev DB'ye yazar | K11, K12, K10 |
| `test_route_auth_coverage` **tek koşulan bekçi** (SAF) → HEAD'de KIRMIZI (`GET /api/client-policy/` beyansız) | K1a §0.2 |
| İzole Express sondası (1 MB / 10 MB parser) — kaynak ağaç dışında scratchpad'de koşuldu (tek yazma-dışı ölçüm) | K1a §0.2, K9 §0 |
| Deadlock sondaları: ABBA-1/2/3/4/5, K3b S1 (tambur-undo ↔ tambur-manual), S2 (8022 ↔ WO) — N-paralel koşulmadı [VARSAYIM] | K3a §3.2, K3b §2.2 |
| Kilit tutulma süreleri (`pg_locks`), `roll_barcode_counters` bekleme süresi, havuz doygunluğu (`roll-barcode.helper.ts:56-64` ölçümü alıntılandı, tekrar edilmedi) | K3a, K3b |
| `scale_report.ts` (yalnız 4 raporu ölçer; koşulmadı), rapor yanıt süreleri, CPU-bound render süreleri | K7b, K9 |
| Prisma migration tx semantiği (repo içi çelişki H-2) deneme DB'sinde doğrulanmadı; `CREATE INDEX` süreleri | K2b |
| `requirePermission(undefined)` davranışı; `STATION_KIND_PERM` fail-open; `resolveDevice` dalları — çalıştırılmadı | K5 |
| P2028 üretimi; 57014/40P01 yüzeye çıkış sınıfı — dev DB'de `SET statement_timeout` ile ORM sorgusu koşturmak ② repro'su | K6 |
| Negatif sonda ("bekçi kırmızı veriyor mu") hiç kırılmadı | K10, K11 |

## ⑤ İstemci tarafı (Electron / mobil) — tüm haritalarda kapsam dışı

| Madde | Harita |
|---|---|
| Electron/mobil istemcilerin hangi uçları fiilen çağırdığı (ölü uç analizi); import gövdesini parçalayıp parçalamadığı (`Electron/src/lib/import/*` chunk izi yok); Belge Şablonları ekranının izin kapısı (`DocumentPreview.tsx:61` → `sample-html` sabit `admin:settings` → sessiz 403 [VARSAYIM]); `/permanent` buton metinleri | K1a, K1b |
| Mobil `adres.mjs:83` `UPDATE_PATH='/api/mobile/updates/manifest'` ↔ backend `/api/mobile/updates/ota/:runtimeVersion/manifest` yol farkı [VARSAYIM: bilinçli] | K1b |
| Enum/tip ikizleri (`RollStatus`, `ReasonPresetKind`, `LabelKind`, `PrintedDocType`) ve "altıncı enum değeri unutuldu" sınıfı — üye-başına tüketici sayımı | K2a |
| Mobil idempotency kuralı (`mobil/src/offline/entryAttempt.ts` + test), `scanClassify`, `resolveReturns` (yalnız `receivePayload.helper.ts:80-200` okundu); KK1 `Number(manualQty)` yuvarlamasız; Electron metraj alanlarında `step` yok [VARSAYIM] — 4+ ondalık üretimi (K7a H3 tetikleyicisi) | K7a, K10 |
| Electron rapor sayfaları "TOPLAM" satırı (yuvarlanmış satırları toplar), `useReportDateRange.ts` renderer TZ'si, `reportExport.ts`; mobil çekme yüzdesi; mobil pano | K7b |
| İstemcinin `delivered/seeded/warnings/idempotentReplay/failed` alanlarını okuyup okumadığı; `Retry-After` CORS'ta yok | K6, K9 |
| Yazıcı kuyruğu (`mobil/src/offline/printQueue.ts`), fiziksel gönderim, import dosya ayrıştırma (`Electron/src/lib/import/parse.ts`), istemci timeout/retry politikaları | K9 |
| Mobil/Electron izin uygulamasının tam envanteri (karo/route/ekran) | K5 |

## ⑥ Belge / yöntem sınırları

| Madde | Harita |
|---|---|
| `audit/01-find/_FINDER-BRIEF.md` okunamadı (bir ara görünüp kayboldu) — A-L harf eşlemesi K11'de [VARSAYIM: orkestratörde] | K2b, K6, K11 |
| `docs/history/SCALE-REPORT.md` bulunamadı (`audit.report.service.ts:29` referansı) | K7b |
| `audit/PLAN.md:1118` "iki ALTER DATABASE RENAME" öncülü YANLIŞ (F-OPS-VER-009); `docs/history/CLAUDE-NOT-ARSIVI.md:51` "ayrı iş" ifadesi; `shipping.service.ts:145` bayat yorum; `rbac.middleware.ts` "67 kod" (70); `Teks-Erp/CLAUDE.md:239` "27 CHECK" bayat; `Teks-Erp/CLAUDE.md:356-360` `admin/123123` kırılganlığı notu [VARSAYIM: kapanmış] | K12, K2b, K11 |
| Swagger YAML blokları hiçbir haritada kod sözleşmesiyle karşılaştırılmadı; `production.routes.ts` 3 hayalet `@openapi` bloğu [VARSAYIM] | K1a, K1b |
| Migration'lardaki 1-arg advisory uzayı yorumları bayat (`duplicate-guard.helper.ts:22-23`, `shipment-locks.helper.ts:21-23`, `batch.service.ts:90-91`, `audit/surface/12-tx-global-gercekler.md:91`) | K3b §6 |
| Modül→dosya eşlemesi PLAN'da yok; K12 §6.3 ad/içerikten türetildi `[TÜRETİLMİŞ]` — sınır vakalarda PLAN kartı öncelikli | K12 |

## ⑦ Açık [VARSAYIM] listesi (② doğrulamadan dayanak almamalı)

| # | Varsayım | Harita | Doğrulama yolu |
|---|---|---|---|
| 1 | `pg_db_role_setting`'de `audit_guard` SET satırı olmaması = koruma KAPALI (role-level/`postgresql.conf` elenmedi) | K8 H-4, K2b | canlı `current_setting('teks.audit_guard')` |
| 2 | Prod JWT secret dev'den farklı | K5 H1 | ops teyidi |
| 3 | `traveler-card.service buildPlan/resolveForPrint` client'ı sonuna kadar taşır | K3a §4 | gövde okuması |
| 4 | Fason sevk kalemi `dispatchedQty = currentQty` (`subcontractor.service.ts:1340-1360`) | K7a J1 | gövde okuması |
| 5 | `getShipmentById` `sk.rolls` sorgusu `SACK_ABSENT` süzer (`shipping.service.ts:2900-2970`) | K7a §4.3 | gövde okuması |
| 6 | Kısmi fason kabulde `RollMovement.qtyIn` değişmez (WIP 100 m "bekliyor") | K7b H17 | `subcontractor.service` kabul yolu |
| 7 | İptal/fire/kartela yolları `currentStepId`'yi temizler (pano `queueCount`) | K7b H11 | guard kodu |
| 8 | `finalizedAt` çıkışta silinmiyor; `restoreCancelledRoll`/`quickStart` rework damgaya dokunmuyor | K7b H2 | `grep -rn finalizedAt src/services` |
| 9 | Q-AUD-01b: audit "olay bazlı" (makbuz/parent kaydına yazılıyor) → 55 audit'siz top | K10 H-7 | `AuditService.logMany` recordId okuması |
| 10 | Q-SM-08: `shipping.toleranceMeters` varsayılanı 5 m (`system-setting.service.ts`) | K10 | okuma (K7a I2 `:2087-2099` doğruluyor: 5) |
| 11 | `KARTELA_CONSUMED` diriltme yolu yok; kapanış dispozisyonu bekçi adı `test_wo_cancel_disposition`/`test_wo_manual_complete` | K10 | K11 §1 listesi doğruluyor (#350, #355) |
| 12 | DriverAdapterError 57014/40P01/25P03 aynı `default` daldan çıkar (23514 gibi) | K6 H-1 | dev DB sondası |
| 13 | Statü taşıyan http-errors (415/400 decode/sendFile) dal 9'a düşer (canlıda tetiklenmedi) | K6 H-4 | sonda |
| 14 | EADDRINUSE → uncaughtException → pm2 restart döngüsü | K6 H-14 | sonda |
| 15 | Bozuk cursor → ilk sayfa → sonsuz kaydırmada mükerrer satır | K6 H-22 | Electron davranışı |
| 16 | ALS bağlamı `void runBackupJob/runCopyJob` işlerine taşınır (audit `requestId/ip` tetikleyen isteği taşır) | K9 §2.i | ölçüm |
| 17 | rclone `-` ile başlayan uzak adı fiilen bayrak sayar | K9 H-6 | rclone ile deneme |
| 18 | "İçe aktarımda da sanitize" (`config-bundle.service.ts:20-22` yorumu) | K9 | `label-template.service importTemplate` okuması |
| 19 | Saha nightly koşumu: env bir dönem açıktı ya da ecosystem repo↔saha ayrışık | K9 H-9 | sunucu env |
| 20 | Swagger hayalet uçlar `/api-docs`'ta yayınlanıyor | K1b H15 | JSON üretimi |
| 21 | `DocumentPreview.tsx:61` `sample-html` çağrısı `document-template:read` ile sessiz 403 | K1b H14 | Electron kart/route izni |
| 22 | Mobil `adres.mjs` yol farkı bilinçli | K1b | VPS nginx düzeni |
| 23 | Electron metraj alanı 4+ ondalık kabul eder (`step` yok) | K7a §1.3 | Electron formu |
| 24 | ABBA-5 (set-bazlı `updateMany` vs tekil sıralı kilit) — somut senaryo bulunamadı, teorik | K3a §3.2 | ölçmeden bulgu yazılmasın |
| 25 | Backfill "kapsam dışı" 4 damgasız 2026-08-08 satırı `trulyOrphan` listesinde | K4 §4 | script okuması |
| 26 | K3a satır numaraları HEAD ile aynı (`git status` Teks-Erp/src'de değişiklik listelemiyor) | K3a | `git diff` |
| 27 | Prisma varsayılan onDelete kuralı adı (sayılar DB ile birebir doğrulandı) | K2a §0 | dokümantasyon |
| 28 | `import.routes preview` ImportRun yazabilir; `FreeDocumentService.create` audit yazar | K1a | servis okuması |
| 29 | `constants/time.ts` `Prisma.raw` 9 çağıranı string literal | K5 §10 | okuma |
| 30 | H-5 K4: merge sonrası `updatedAt` tazelenmemesinin etkisi yalnız sıralama/görüntü | K4 H5 | Electron liste davranışı |
