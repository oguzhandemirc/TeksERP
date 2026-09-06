# K11 — Test & Bekçi Envanteri (Aşama ① KEŞİF — harita, yargı YOK)

| | |
|---|---|
| Tarih / dal / HEAD | 2026-08-28 · `adnansahin` · `ce8681d1` |
| Kapsam | `Teks-Erp/scripts/test_*.ts` (**366 dosya, 90.047 satır**), `scripts/run-all-tests.ts`, `tsconfig.scripts.json`, paylaşımlı fixture'lar (`scripts/fixture-*.ts`), `scripts/clean_test_residue.ts`, CI (`.github/workflows/ci.yml`) |
| Yöntem | Her dosyanın ilk 40 satırındaki başlık yorumu + iddia/assert deseni + `prisma`/`deleteMany`/`Promise.all(allSettled)`/`clientToken`/`negatif sonda` grep'leri **script ile** çıkarıldı (`scratchpad/inv.mjs`); 37 paralel dosya ile 20 `clientToken` dosyasının ilgili gövdeleri **tek tek açılıp** okundu; servis kapsaması statik **ve** dinamik (`await import(...)`) import'la sayıldı. DB'ye yalnız `audit/tools/sql-dev.sh` ile (salt-okunur) bakıldı — test artığı ölçümü için. **Hiçbir test koşturulmadı** (koşum dev DB'ye yazar; salt-okunur kural). |
| Etiketler | `[VARSAYIM]` = doğrulanmamış çıkarım · "kapsam dışı — sebep" = uygulanamayan madde |

Sözlük: **VARLIK** = bekçi mekanizmanın (kilit/claim) kodda *var olduğunu* ölçer · **SIRA** = kilidin korunan okumadan *önce* alındığını ölçer · **DAVRANIŞ** = N paralel istek gönderip sonucu ölçer ("tam 1 başarı" en güçlü biçim; "invariant bozulmadı" daha zayıf).

---

## 0. Koşucu, tip geçidi, üretim-DB kapısı, sıralı koşum, zaman aşımı

| Konu | Olgu | Kanıt |
|---|---|---|
| Giriş noktası | `npm test` = `tsx scripts/run-all-tests.ts`; jest/vitest YOK | `Teks-Erp/package.json:18`; `run-all-tests.ts:8` |
| Keşif | `readdirSync(scripts)` → `/^test_.*\.ts$/` → alfabetik `.sort()`; opsiyonel alt-dize filtresi `argv[2]` | `run-all-tests.ts:170,178-181` |
| **Sıralı koşum kuralı** | Testler AYNI dev DB'yi paylaşır; her biri kendi business-key fixture'ını yaratıp `finally`'de siler → paralel koşum fixture çakışması üretir → **sıralı** (`spawnSync`, dosya başına ayrı `npx tsx` süreci) | `run-all-tests.ts:6-8, 243-249` |
| **`PER_TEST_TIMEOUT_MS = 180_000`** (180 sn, SIGTERM) | Aşımda `error.code === "ETIMEDOUT"`; Windows'ta `shell:true` yüzünden öldürülen cmd.exe'dir, **node torunu yetim kalıp PG bağlantısı tutabilir** ("too many clients" zehirlenmesi) | `run-all-tests.ts:23, 218-225` |
| `MAX_OUTPUT_BYTES = 32 MiB` | maxBuffer taşmasında `status:0` döner → `ok = status===0 && !res.error` şartı load-bearing | `run-all-tests.ts:30, 198, 252-255` |
| Başarı kaynağı | exit kodu (her test `process.exit(fail>0?1:0)`) + `!res.error`; özet satırı regex'le kazınır (`Sonuç: N geçti, M başarısız` / `N/T geçti`); anormal bitişte kazınan özet EZİLİR (yalan söyler) | `run-all-tests.ts:255-277` |
| Tek yeniden deneme | Yalnız `looksInfrastructural` (connect timeout / ECONNREFUSED / too many clients / can't reach) → 1 retry; assertion hatası ASLA yeniden denenmez; flake gizlenmez | `run-all-tests.ts:281-306, 337-340` |
| **Tip kontrolü geçidi** | `tsc --noEmit -p tsconfig.scripts.json` paketten ÖNCE (~28 sn); düşerse paket KOŞULMAZ; **filtreli tek koşumda ATLANIR**; kaçış `SKIP_TYPECHECK=1` | `run-all-tests.ts:54-75, 176` |
| `tsconfig.scripts.json` | `extends ./tsconfig.json`, `noEmit:true`, `rootDir:"."`, `include: scripts/** + prisma/** + src/**` — build bunu KULLANMAZ | `tsconfig.scripts.json:23-32` |
| **`productionDbGate()` — nerede** | YALNIZ `run-all-tests.ts:102-165`; `main()`'de her şeyden önce ve filtreden bağımsız (`:172-174`). **Tek test `npx tsx scripts/test_X.ts` ile koşulunca bu kapı YOKTUR** (grep: `productionDbGate` yalnız koşucuda; 366 testin hiçbiri ortam kontrolü yapmaz) | `run-all-tests.ts:102, 174`; grep |
| `productionDbGate()` — neyi reddediyor | ① `NODE_ENV`/`APP_ENV === "production"` → dur, **kaçışla atlanamaz** (`:109-118`) · ② `DATABASE_URL` yok → dur, fail-closed (`:120-125`) · ③ URL parse edilemiyor → dur (`:127-140`) · ④ host ∉ {`localhost`,`127.0.0.1`,`::1`,`0.0.0.0`} → dur (`:142-146, 157-164`) · ⑤ uzak host + `ALLOW_NONLOCAL_TEST_DB=1` → uyarı basıp GEÇER (`:148-155`). Kapı **host adına** bakar; port/DB adına bakmaz | `run-all-tests.ts:102-165` |
| Kapının bayat sayıları | Mesajlar "273 test / 235 prisma import / 1.539 deleteMany / 209 dosya" der; güncel ölçüm **366 / 323 / 2.048 / 278** | `run-all-tests.ts:80-82, 152, 159` ↔ bu rapor §5 |
| `.env` hedefi | `DATABASE_URL` host `localhost`, DB `adnansahin_db` (içerik kopyalanmadı; yeri `Teks-Erp/.env`) — kapı yerel koşumu geçirir | `Teks-Erp/.env` |
| dotenv | Koşucu `import "dotenv/config"` ile `.env`'i yükler; çocuklara `env: process.env` aynen geçer | `run-all-tests.ts:10-17, 60, 246` |
| CI | Postgres service container, `DATABASE_URL=…teks_ci`, `npm run seed` + `npm run seed:fixtures` (ayrı ZORUNLU adım), sonra `npm test` | `.github/workflows/ci.yml:68, 84, 93, 112` |
| Kalıcı (temizlenmeyen) fixture'lar — bilinçli | `fixture-subcontractor.ts` (`TEST-FASON-*`, upsert, 29+ dosya paylaşır; gerekçe: "koşucu sıralı ama **tek tek elle koşturma paraleldir**") · `fixture-test-user.ts` (`TEST-ADMIN`, 3 HTTP testi) | `fixture-subcontractor.ts:28-45`; `fixture-test-user.ts:22-31` |
| Artık temizleyici | `clean_test_residue.ts` (dry-run varsayılan, `--apply`); silme kararı **yalnız 5 önek grubuna** bakar: roll `TEST-SINV-R/TST-ADS-R/TEST-AEX-R/TST-AR-R`, order `TST-ADS-ORD`, item `TST-NRM-/TEST-SINV-I-/TST-AEX-`, color 4 önek, customer `TST-ADS-/TST-AEX-` | `clean_test_residue.ts:1-31` |
| Yük testi | `scripts/load_test.ts` **bilerek** `test_` öneksiz (koşucu görmez); yalnız READ uçları, gevşek eşik | `load_test.ts:1-21` |

---

## 1. Alan bazında bekçi tablosu (366 satır)

Sütunlar: **DB** = `Y·del n` (prisma import + yazma; `n` = dosyadaki `deleteMany` çağrı sayısı) · `R` (yalnız okur) · `HTTP` (prisma import'suz, efemeral app) · `–` (saf) — **EŞZ** = `**Y**` gerçek paralel YAZMA sondası (N · beklenti) · `F` yalnız fixture paralel yaratılıyor (yarış DEĞİL) · `R` paralel okuma · `SIRA:` kilit sırası/yeri bekçisi — **IDEMP** = idempotency sözleşmesi ölçen senaryo — **NEG** = dosyada "negatif sonda/sınama" notu var. "Ne doğruluyor" = dosyanın kendi başlık satırı (ilk anlamlı yorum), 120 karakterde kırpıldı. Alan ataması dosya adından türetilen sezgisel etikettir (bir dosya birden çok alana dokunabilir).

**Alan özeti (sezgisel):**

| Alan | Bekçi sayısı |
|---|---|
| Master-data/Arama/İçe aktarım | 42 |
| İş emri/Rota/Refakat | 39 |
| Etiket/Yazıcı | 39 |
| Fason | 35 |
| Çuval/Sevk/İade | 32 |
| Altyapı/Ops | 28 |
| Kimlik/Yetki | 24 |
| Sipariş | 20 |
| Tambur | 18 |
| Parti | 15 |
| Envanter/Top | 14 |
| Rapor/Tutarlılık | 13 |
| Belge | 11 |
| Audit/Gözlem | 8 |
| KK1/Ham giriş | 8 |
| Kurşun/KK2 | 8 |
| Cihaz/Oturum | 6 |
| Barkod | 3 |
| Uçtan uca/HTTP | 2 |
| Kartela | 1 (kartela ayrıca `test_phase5_kartela_hardening`, `test_sack_status_invariant`, `test_kartela_stock_and_ship` içinde) |

| # | Dosya | Alan | Ne doğruluyor (başlık) | DB | EŞZ | IDEMP | NEG |
|---|---|---|---|---|---|---|---|
| 1 | `test_accounting_direct_ship.ts` | Fason | Muhasebe dökümü + fiş — FASONDAN DOĞRUDAN SEVK (DirectShipment) kapsamı | Y·del 15 | – | – | – |
| 2 | `test_accounting_export.ts` | Çuval/Sevk/İade | Muhasebe Excel dökümü (accounting-export.service) | Y·del 3 | – | – | – |
| 3 | `test_admin_guard_race.ts` | Kimlik/Yetki | Son-admin guard yarışı (A1 — 2026-07-31 veri bütünlüğü denetimi) | Y·del 3 | **Y** 2× deactivateUser → tam 1 ok + 1×409 | – | – |
| 4 | `test_attached_rolls_select.ts` | İş emri/Rota/Refakat | getAttachedRolls select daraltması (over-fetch yok) — PR-2 | Y·del 5 | – | – | – |
| 5 | `test_audit_depth.ts` | Audit/Gözlem | Audit derinliği — kayıt-bazlı sorgu + değiştirilemezlik (Faz B1/B2) | Y·del 6 | – | – | – |
| 6 | `test_audit_followups.ts` | Audit/Gözlem | Denetim kapsam-dışı follow-up'ları (feat/audit-followups-hardening) | Y·del 10 | **Y** 2× device.announce → ≥1 ok + tek satır | device announce idempotent upsert | – |
| 7 | `test_audit_labels.ts` | Audit/Gözlem | Audit ekranlarının TÜRKÇE sözlüğü eksiksiz mi? (2026-08-25) | – | – | – | – |
| 8 | `test_audit_p0.ts` | Audit/Gözlem | Backend denetimi P0 regresyon kilitleri | Y·del 4 | – | – | – |
| 9 | `test_backup.ts` | Altyapı/Ops | Yedekleme servisi entegrasyon testi (server'sız) | Y·del 4 | **Y** 2× runBackupJob → tam 1 red (bellek bayrağı) | – | var |
| 10 | `test_barcode_reservation.ts` | Barkod | Top barkod sayacı — TX ÖNCESİ toplu rezervasyon sözleşmesi | Y·del 0 | **Y** 20×3 rezervasyon → 60 benzersiz/boşluksuz; 30× akış → 30/30; SIRA: sayaç yeri (tx-öncesi; iki yönlü liste) | – | – |
| 11 | `test_batch_drop.ts` | Parti | PARTİ DÜŞÜRME — `POST /work-orders/:id/batches/:batchId/drop` | Y·del 8 | – | – | – |
| 12 | `test_batch_k15_merge.ts` | Parti | K15 — fasondayken parti birleştirme (belge de birleşir, OSFM kuralı) | Y·del 20 | – | – | – |
| 13 | `test_batch_k16_split_move.ts` | Parti | K16 + K18 — fasondayken parti böl/taşı (sevk cerrahisi) + labelDirty | Y·del 20 | – | – | – |
| 14 | `test_batch_k8_tools.ts` | Parti | TEST (Faz 4.2 / K8 + K14 + K15 + K16): parti düzeltme araçları — moveRolls / splitBatch / mergeBatches. | Y·del 16 | – | – | – |
| 15 | `test_batch_multibatch_dispatch.ts` | Parti | TEST (Faz 3.2 / K11): çok-parti fason sevk. | Y·del 11 | – | – | – |
| 16 | `test_batch_number_format.ts` | Parti | PARTİ NO biçimi — kısa dönen no (P01…P99) + eski günlük kalıp | Y·del 0 | –SIRA: kilit SIRASI (sahte tx çağrı sırası) | – | – |
| 17 | `test_batch_partial_dispatch_autosplit.ts` | Parti | TEST (Faz 3.1 / K5): Kısmi fason sevkte OTO-BÖL. | Y·del 11 | – | – | – |
| 18 | `test_batch_redye_three_paths.ts` | Parti | TEST (Faz 4.1): Parti ayırma — REDYE_SAME_COLOR (aynı renk yeniden boyama). | Y·del 10 | – | – | – |
| 19 | `test_batch_split_new_wo_modes.ts` | Parti | TEST (2026-07-14): Parti ayırma — NEW_COLOR + UNDYED_MOVE (WO klonu) + karma-adım | Y·del 15 | – | – | – |
| 20 | `test_batch_trace.ts` | Parti | PARTİ İZLEME (geri izleme) | Y·del 11 | – | – | – |
| 21 | `test_blank_grid.ts` | Belge | AYARLANABİLİR BOŞ GRID — tüm belgelerde, OPT-IN (2026-08-09) | – | – | – | – |
| 22 | `test_branch_code_docs.ts` | Belge | Belgede müşteri İHRACAT KODU (tek satır) — render + "exportCode" toggle | – | – | – | – |
| 23 | `test_branch_no_empty.ts` | İş emri/Rota/Refakat | TEST (O3): getBranches öksüz boş dalları gizler; tekli-fason RETURNED dalı GİZLENMEZ. | Y·del 16 | – | – | – |
| 24 | `test_bulk_dispatch_rollids.ts` | Fason | bulkDispatchStep top alt-küme seçimi (rollIds) — yalnız seçilen toplar sevk. | Y·del 10 | – | – | – |
| 25 | `test_bulk_label_batched.ts` | Etiket/Yazıcı | getBulkRollLabelsHtml batched refactor — BYTE-IDENTİK çıktı kanıtı | Y·del 9 | – | – | – |
| 26 | `test_bulk_labels.ts` | Etiket/Yazıcı | Saha #7 — toplu etiket HTML (birleşik belge) | Y·del 1 | – | – | – |
| 27 | `test_canvas_preview_peripheral_lang.ts` | Etiket/Yazıcı | getCanvasPreview cihaz (peripheralId) → dil çözümü doğrulaması. | Y·del 0 | – | – | – |
| 28 | `test_card_login.ts` | Kimlik/Yetki | QR personel kartıyla giriş (auth.loginMethods "card" içerirken) — Faz 5 | Y·del 4 | – | – | – |
| 29 | `test_check_violation_mapping.ts` | Altyapı/Ops | PostgreSQL CHECK ihlali (23514) → Türkçe 409 eşlemesi | Y·del 1 | – | – | – |
| 30 | `test_client_policy.ts` | Altyapı/Ops | İstemci sürüm politikası tutarlı mı? (2026-08-27) | – | – | – | – |
| 31 | `test_client_token_idempotency.ts` | KK1/Ham giriş | clientToken idempotency sözleşmesi (İdempotency denetimi Faz 2). | Y·del 14 | – | order/quickOrder/WO/quickStart/reduceStock replay + farklı payload 409 + hardDelete token serbest | – |
| 32 | `test_color_assignment.ts` | Master-data/Arama/İçe aktarım | Müşteriye renk ATAMA (assigned) ile müşterideki ÖZEL AD (alias) bağımsızlığı testi. | Y·del 0 | – | – | – |
| 33 | `test_color_name_dup.ts` | Master-data/Arama/İçe aktarım | ColorService — aynı isimli renk mükerrerlik guard'ı (409) | Y·del 0 | – | – | – |
| 34 | `test_config_bundle.ts` | Master-data/Arama/İçe aktarım | YAPILANDIRMA PAKETİ (kurulumlar arası tanım taşıma) | Y·del 2 | – | – | – |
| 35 | `test_consecutive_fason.ts` | Fason | Rotada ARDIŞIK İKİ FASON adımı (Boyahane → Zımpara) — ikisi de başta. | Y·del 14 | – | – | – |
| 36 | `test_consistency.ts` | Rapor/Tutarlılık | VERİ TUTARLILIK KAPISI — `scripts/consistency-check.sql`'in mekanik ikizi | R | – | – | – |
| 37 | `test_consistency_derived.ts` | Rapor/Tutarlılık | TÜRETİLMİŞ-ALAN TUTARLILIK KAPISI — `scripts/consistency-check-derived.sql`'in | Y·del 0 | – | – | var |
| 38 | `test_controller_binds.ts` | Altyapı/Ops | CONTROLLER HANDLER'LARI ROUTE'A ÇIPLAK GEÇİLİYORSA BAĞLI OLMALI (bind) | – | – | – | – |
| 39 | `test_customer.ts` | Master-data/Arama/İçe aktarım | CustomerService — BaseService CRUD (create/list/update/soft-delete) | Y·del 0 | – | – | – |
| 40 | `test_customer_branch.ts` | Master-data/Arama/İçe aktarım | CustomerBranchService — create/update/deactivate/findByCustomer + | Y·del 2 | – | – | – |
| 41 | `test_customer_card_fields.ts` | Master-data/Arama/İçe aktarım | CustomerService — müşteri kartı alanları ("her şube = ayrı müşteri", 2026-07) | Y·del 0 | – | – | – |
| 42 | `test_customer_sack_delete_guard.ts` | Master-data/Arama/İçe aktarım | Müşteri kalıcı silme guard'ı — bağlı çuval varsa bloklanmalı | Y·del 2 | – | – | – |
| 43 | `test_customer_scorecard.ts` | Master-data/Arama/İçe aktarım | TeksERP - Müşteri Karnesi (ABC + RFM) bekçisi | Y·del 3 | – | – | – |
| 44 | `test_customer_standalone_label.ts` | Etiket/Yazıcı | Müşteriye bağlı SERBEST etiketler — M:N kolaylık bağı uçtan uca | Y·del 3 | – | – | – |
| 45 | `test_customer_template_route.ts` | Master-data/Arama/İçe aktarım | müşteriye özel şablon ataması (CustomerTemplateRoute) — Etiket Stüdyosu F3 | Y·del 4 | – | – | – |
| 46 | `test_dashboard.ts` | Rapor/Tutarlılık | DashboardService — salt-okunur agregatlar (raw SQL + count) | Y·del 0 | – | – | – |
| 47 | `test_data_integrity_gaps.ts` | Envanter/Top | Veri-bütünlüğü açık taraması düzeltmeleri (2026-07-27) | Y·del 19 | – | – | – |
| 48 | `test_db_copy.ts` | Altyapı/Ops | Kopyaya geri yükleme — entegrasyon testi | R | – | – | – |
| 49 | `test_db_copy_single_start.ts` | Altyapı/Ops | startCopyJob atomik claim (A2 — 2026-07-31 veri bütünlüğü denetimi) | R | **Y** 2× startCopyJob → tam 1 started (bellek claim) | – | – |
| 50 | `test_db_invariants.ts` | Altyapı/Ops | Şema-DIŞI DB invariant guard'ı — `schema.prisma`'nın temsil EDEMEDİĞİ | R | – | clientToken partial UNIQUE index VARLIĞI (4 tablo) | – |
| 51 | `test_demand_analysis.ts` | Sipariş | TeksERP - Talep Analizi bekçisi | Y·del 4 | – | – | – |
| 52 | `test_depo_roll_cancel_permission.ts` | Kimlik/Yetki | Depo ekranı topu STOKTAN KALDIRABİLİR (`mobile:depo` → top iptali) | – | – | – | – |
| 53 | `test_device_activity.ts` | Cihaz/Oturum | İşlem Dökümü (cihaz + kullanıcı ayak izi) — WorkSessionActivityService + | Y·del 13 | – | – | – |
| 54 | `test_device_assignment.ts` | Cihaz/Oturum | Cihaz allowlist + atama (DeviceService) — announce/approve/revoke/resolve | Y·del 2 | – | – | – |
| 55 | `test_device_transport.ts` | Cihaz/Oturum | HAL backend transport (tcpTransport) + meter codec. | – | – | – | – |
| 56 | `test_direct_ship_api.ts` | Fason | Fasondan Doğrudan Sevk — GERÇEK HTTP/API + RBAC + Zod (mock YOK). | Y·del 17 | – | – | – |
| 57 | `test_direct_ship_fason.ts` | Fason | Fasondan Doğrudan Sevk — fason fiilen son durak; mal dönmeden müşteriye sevk. | Y·del 20 | – | – | – |
| 58 | `test_direct_ship_scenarios.ts` | Fason | Fasondan Doğrudan Sevk — KAPSAMLI SENARYOLAR (edge-case + preview + belge). | Y·del 19 | **Y** 2× executeDirectShip → ≥1 ok, top TEK kez tüketildi | çift executeDirectShip → alreadyDirectShipped cached | – |
| 59 | `test_discovery_advertiser.ts` | Altyapı/Ops | mDNS servis ilanı — fail-open + kapanış sözleşmesi (2026-08-26) | – | – | – | – |
| 60 | `test_discovery_identity.ts` | Altyapı/Ops | Servis keşfi — kurulum kimliği + kimlik ucunun sözleşmesi (2026-08-26) | Y·del 1 | – | – | – |
| 61 | `test_dispatch_claim_step_match.ts` | Fason | Fason sevk atomik claim'i step-eşleşme + autoAttach steal guard | Y·del 11 | **Y** 2× fason dispatch (steal + çift) → tam 1 ok + 1 red | – | – |
| 62 | `test_dispatch_cross_wo_batch_guard.ts` | Fason | REGRESYON (Faz 0b — cross-WO parti sızıntısı): Sevk iptali batchId'yi BİLİNÇLİ | Y·del 12 | – | – | – |
| 63 | `test_dispatch_print_options.ts` | Çuval/Sevk/İade | Sevk irsaliyesi baskı seçenekleri — liste seçimi + sayfa ayrımı | – | – | – | – |
| 64 | `test_dispatch_report.ts` | Çuval/Sevk/İade | Saha #2 — muhasebe sevk fişi (ürün/çuval/çeki listesi) | Y·del 3 | – | – | – |
| 65 | `test_dispatch_report_gross.ts` | Çuval/Sevk/İade | Muhasebe sevk fişi BRÜT'tür (sevk anı) — iade onu geriye dönük değiştirmez | Y·del 5 | – | – | – |
| 66 | `test_dispatch_without_color.ts` | Fason | "Fasona renksiz gitsin" (`dispatchWithoutColor`) — UÇTAN UCA SÖZLEŞME. | Y·del 6 | – | – | – |
| 67 | `test_doc_density_fields.ts` | Belge | ORTAK belge yoğunluk profili + alan bazlı yazı ayarı (6 belge) | – | – | – | – |
| 68 | `test_doc_pagesize_override.ts` | Belge | belge baskısında TEK SEFERLİK kâğıt boyu (?pageSize=A4¦A5) — 2026-08-09 | R | – | – | – |
| 69 | `test_doc_render_html.ts` | Belge | yeni belge HTML renderer'ları (saf fonksiyonlar) | – | – | – | – |
| 70 | `test_doc_sample_html.ts` | Belge | Belge Şablonu "sample-html" önizleme yolları (entegrasyon, fixture'sız) | R | – | – | – |
| 71 | `test_document_customization.ts` | Belge | Belge kişiselleştirme Faz 2-4 testi (kolonlar, damgalar/QR, bloklar, dil, profil) | Y·del 0 | – | – | – |
| 72 | `test_document_style.ts` | Belge | Belge stil katmanı + logo testi (Faz 1 — belge kişiselleştirme) | R | – | – | – |
| 73 | `test_document_template_permission.ts` | Kimlik/Yetki | `document-template:read` / `:write` (belge tasarım yüzeyi) | – | – | – | – |
| 74 | `test_duplicate_detection.ts` | Master-data/Arama/İçe aktarım | MÜKERRER TESPİT MOTORU + İNCELEME KUYRUĞU (mükerrer paneli v2 P1, 2026-08-22) | Y·del 8 | – | – | – |
| 75 | `test_duplicate_rolls.ts` | KK1/Ham giriş | HAYALET TOP TESPİTİ (mükerrer ham giriş) — panel v2 P3c, 2026-08-22 | Y·del 4 | – | – | – |
| 76 | `test_e2e_full_flow.ts` | Uçtan uca/HTTP | ÜRETİM HATTI — UÇTAN UCA (E2E) AKIŞ TESTİ | Y·del 19 | – | – | – |
| 77 | `test_fason_ceki_draft.ts` | Fason | previewDownstreamFasonCeki — erken TASLAK boyahane çekisi, durum DEĞİŞTİRMEZ. | Y·del 10 | – | – | – |
| 78 | `test_fason_ceki_html.ts` | Fason | Fason çeki "KUMAŞ İRSALİYESİ" HTML renderer (saf fonksiyon) | – | – | – | var |
| 79 | `test_fason_desk_dispatch.ts` | Fason | Masaüstü (planlama ekranı) fason sevki — bulkDispatchStep + transferToNextFason | Y·del 14 | – | – | – |
| 80 | `test_fason_dispatch_picker.ts` | Fason | Fason sevk "Top Seç" picker filtre testi: filter[dispatchableForStepId]. | Y·del 4 | – | – | – |
| 81 | `test_fason_kabul_partial_overlap.ts` | Fason | Fason kabul idempotency guard'ı — kısmi-örtüşme asimetri düzeltmesi | Y·del 15 | – | PO1-3 tam-küme replay cached; kısmi örtüşme cached DÖNMEZ (409) | – |
| 82 | `test_fason_open_dispatch_semantics.ts` | Fason | Fason "AÇIK + OUTSTANDING sevk" koşulunun DAVRANIŞI (2026-08-21). | Y·del 19 | – | – | – |
| 83 | `test_fason_open_dispatch_single_source.ts` | Fason | FASON "AÇIK + OUTSTANDING SEVK" TEK-KAYNAK BEKÇİSİ | – | – | – | – |
| 84 | `test_fason_parti_grouping.ts` | Fason | Çoklu sevkte (aynı fason adımına iki ayrı parti) KABUL parti gruplaması. | Y·del 14 | – | – | – |
| 85 | `test_fason_partial_receive.ts` | Fason | Fason KISMİ KABUL (2026-08-19) — "100 m gitti, 51 m geldi, 49 sonra". | Y·del 15 | – | P3 aynı token → cached makbuz | – |
| 86 | `test_fason_partial_receive_overcount.ts` | Fason | Fason kabul born-roll SAYI sözleşmesi (saha bug'ı + düzeltme + sınır senaryolar). | Y·del 15 | – | – | – |
| 87 | `test_fason_receipt_color_width.ts` | Fason | Fason kabulünde RENK SEÇİMİ + EN ÖLÇÜMÜ (2026-08-05) | Y·del 16 | – | – | – |
| 88 | `test_fason_receive_cancel_rereceive.ts` | Fason | Fason kabul İPTALİ + yeniden kabul — born-roll sayı bütünlüğü. | Y·del 15 | – | – | – |
| 89 | `test_fason_receive_crossstep_firm.ts` | Fason | REGRESYON (F74): Aynı parti (batchId) birden fazla FASON adımından geçmişse, | Y·del 14 | – | – | – |
| 90 | `test_fason_receive_idempotency_concurrency.ts` | Fason | Fason kabul — idempotency replay + eşzamanlılık + çoklu parti + reopen. | Y·del 15 | **Y** 2× receive → born=1 (invariant; ok sayısı serbest) | IC1 aynı receive payload 2× → cached, born=1 | – |
| 91 | `test_fason_step_note_flow.ts` | Fason | Fason adım notu → o adımın sevkine (dispatch.instruction) ve çeki listesine. | Y·del 15 | – | – | – |
| 92 | `test_fason_transfer_rollids.ts` | Fason | TEST (KRİTİK): transferToNextFason rollIds alt-küme + born-roll precision. | Y·del 14 | – | – | – |
| 93 | `test_fason_undo_transfer.ts` | Fason | TEST (O1): "Aktarımı Geri Al" (undoTransfer) — yanlış fason→fason aktarımını geri sar. | Y·del 17 | – | – | – |
| 94 | `test_fason_visibility.ts` | Fason | Envanter "Fasonda" fason görünürlüğü — üç yüzeyin (özet ucu, liste | R | – | – | – |
| 95 | `test_fason_wrong_station_guidance.ts` | Fason | Fason kabulde YANLIŞ YÖNLENDİRME — teşhis mesajları + görünürlük | Y·del 12 | – | – | – |
| 96 | `test_feature_flag_contract.ts` | Altyapı/Ops | Feature-flag ÜÇ-YER SÖZLEŞMESİ (route şeması ↔ servis ↔ Electron paneli) | R | – | – | – |
| 97 | `test_field_address.ts` | Master-data/Arama/İçe aktarım | saha donanım-eşleme (setFieldAddress) — oturum-yer kapsam guard'ı, | Y·del 3 | – | – | – |
| 98 | `test_filter_multi_select.ts` | Master-data/Arama/İçe aktarım | ÇOKLU SEÇİM filtresi (CSV → Prisma `in`) bekçisi | Y·del 14 | F (yalnız fixture paralel) | – | var |
| 99 | `test_finalize_last_step.ts` | İş emri/Rota/Refakat | finalizeRollsAtLastStep helper testi — "her rotanın son adımı final üretir" çekirdek. | Y·del 1 | – | – | – |
| 100 | `test_fold_catalog.ts` | Master-data/Arama/İçe aktarım | KAT KATALOĞU — değer listesi veriden gelir, koddan değil (2026-08-10) | Y·del 4 | – | – | – |
| 101 | `test_fold_contract.ts` | Master-data/Arama/İçe aktarım | Arama katlaması TEK SÖZLEŞME — JS ≡ SQL ≡ üç kopya (2026-08-19) | Y·del 0 | – | – | – |
| 102 | `test_fold_edit_and_label.ts` | Master-data/Arama/İçe aktarım | KAT — panelden DÜZELTİLEBİLİR + ETİKETE BASILABİLİR (2026-08-13) | Y·del 8 | – | – | – |
| 103 | `test_fold_type.ts` | Master-data/Arama/İçe aktarım | D-13: foldType BİÇİM normalleştirmesi + Zod şeması. | – | – | – | – |
| 104 | `test_global_search.ts` | Master-data/Arama/İçe aktarım | Global arama (tek kutu, çok varlık) — 2026-08-19 | Y·del 4 | – | – | var |
| 105 | `test_guarded_hard_remove.ts` | Altyapı/Ops | guarded-hard-remove helper (K3 refactor doğrulaması) | Y·del 9 | – | – | – |
| 106 | `test_hard_delete_guard_coverage.ts` | Altyapı/Ops | hardDelete guard kapsama bekçisi (A5 — 2026-07-31 veri bütünlüğü denetimi) | – | – | – | – |
| 107 | `test_helpers.ts` | Envanter/Top | SAF helper birim testleri (src/services/helpers/*) | – | – | – | – |
| 108 | `test_hide_cancelled_lists.ts` | Sipariş | Liste gürültüsü: iptal edilmiş kayıtlar varsayılan olarak gizli | Y·del 3 | F (yalnız fixture paralel) | – | – |
| 109 | `test_http_api.ts` | Uçtan uca/HTTP | HTTP-katman entegrasyonu — Express app GERÇEKTEN ayağa kaldırılır (fetch) | Y·del 2 | – | – | – |
| 110 | `test_iade_enhancements.ts` | Çuval/Sevk/İade | İade sertleştirme testi — neden zorunluluğu, kalite→iade rafı statüsü (FİRE→SCRAP, | Y·del 2 | – | – | – |
| 111 | `test_import_cycles.ts` | Altyapı/Ops | RUNTIME (value) import döngüsü YOK + tip sözleşmesi değer taşımıyor | – | – | – | – |
| 112 | `test_import_fix_hints.ts` | Master-data/Arama/İçe aktarım | DÜZELTME İPUCU (`ImportRowIssue.fix`) | Y·del 2 | – | – | – |
| 113 | `test_import_framework.ts` | Master-data/Arama/İçe aktarım | TOPLU İÇE AKTARIM ÇERÇEVESİ | Y·del 3 | – | #10 aynı token ikinci kez yazmaz | – |
| 114 | `test_import_permissions.ts` | Kimlik/Yetki | İÇE AKTARIM İZNİ, VARLIĞIN GERÇEK CRUD İZNİYLE AYNI OLMALI | Y·del 2 | – | – | – |
| 115 | `test_input_rolls_directship.ts` | Fason | "Üretime Giren" (inputRolls) SAYIMI fasondan-sevk kısmi split çocuğuyla ŞİŞMEZ. | Y·del 13 | – | – | – |
| 116 | `test_inventory_shipment_scope.ts` | Çuval/Sevk/İade | Envanter "sevkiyat kapsamı" filtresi (serbest / çuvallanmış). | Y·del 2 | – | – | – |
| 117 | `test_item_code_autogen.ts` | Master-data/Arama/İçe aktarım | Stok kodu otomatik üretimi — Item create hibrit kod (STK-NNNNNN) | Y·del 2 | **Y** 2× otomatik kod create → ikisi ok, kod farklı | – | – |
| 118 | `test_item_code_case_uniqueness.ts` | Master-data/Arama/İçe aktarım | KOD TEKİLLİĞİ büyük/küçük harf farkına bakmaz (§18) — ve tarihsel | Y·del 8 | **Y** 5× create (harf varyantı) → tam 1 ok + 4×409 | – | var |
| 119 | `test_item_quick_create.ts` | KK1/Ham giriş | ItemService.quickCreateFabric — saha (KK1) hızlı desen oluşturma | Y·del 0 | – | – | – |
| 120 | `test_k14_lock_edges.ts` | Parti | K14 kilit kenar durumları — zombi açık sevk + kabul-iptali parti guard'ı | Y·del 18 | – | – | – |
| 121 | `test_kartela_stock_and_ship.ts` | Kartela | Kartela ADET-bazlı stok + ÇUVALA seçerek ekleme (kartela.getStock + | Y·del 13 | – | – | – |
| 122 | `test_kk1_duplicate_guard.ts` | KK1/Ham giriş | Ham giriş mükerrer top tuzağı (kk1.duplicateGuardEnabled) | Y·del 4 | **Y** 5× createInitialEntry → tam 1 ok + 4×409 POSSIBLE_DUPLICATE | §7 aynı token → cached top (tuzağa düşmez) | var |
| 123 | `test_kk1_weight_flag.ts` | KK1/Ham giriş | KK1 ağırlık (kg) girişi feature flag enforcement | Y·del 3 | – | – | – |
| 124 | `test_kursun_bulk.ts` | Kurşun/KK2 | Kurşun Planlama — TOPLU DAĞITIM / TAŞIMA / HAVUZA ALMA (2026-08-05) | Y·del 14 | – | – | – |
| 125 | `test_kursun_bypass.ts` | Kurşun/KK2 | Kurşun Dağıtım (Kurşun Bypass) — kapsamlı entegrasyon testi | Y·del 14 | **Y** 2× assign → 1 satır; 2× ham INSERT → 1 ok + P2002 | 9h tekrar 'İşi Bitir' → alreadyDone | – |
| 126 | `test_kursun_bypass_repoint.ts` | Kurşun/KK2 | KURŞUN BYPASS ATAMASI — DEVİR / TEBDİL'DE NE OLUR? (K2, 2026-08-21) | Y·del 19 | – | – | – |
| 127 | `test_kursun_machine_order.ts` | Kurşun/KK2 | Kurşun Planlama — MAKİNE İÇİ SIRA (2026-08-05) | Y·del 14 | – | – | – |
| 128 | `test_kursun_regime_lock.ts` | Kurşun/KK2 | KURŞUN REJİM KİLİDİ — bayrak açıkken tablet SALT-OKUNUR (2026-08-05) | Y·del 14 | – | – | – |
| 129 | `test_kursun_unassigned_close.ts` | Kurşun/KK2 | DAĞITILMADAN KAPANIŞ — Tambur okutması kurşun adımını atama olmadan kapatır | Y·del 14 | **Y** 3× completeFromTambur → tam 1 taşıma | – | var |
| 130 | `test_label_bulk_seed.ts` | Etiket/Yazıcı | TOPLU ETİKET HEDEFİ (`seedRollLabelSnapshotsBulk`) — 2026-08-09 | Y·del 3 | – | – | – |
| 131 | `test_label_canvas_equivalence.ts` | Etiket/Yazıcı | akış→kanvas dönüşüm SADAKATİ (Etiket Stüdyosu — veri düşmez) | R | – | – | – |
| 132 | `test_label_canvas_human_bold.ts` | Etiket/Yazıcı | Etiket Stüdyosu — barkod-altı kod (boyut/ortala/kaydır) + serbest-boyut KALIN | – | – | – | – |
| 133 | `test_label_canvas_renderer.ts` | Etiket/Yazıcı | kanvas eleman modeli → 4 dil emit (Etiket Stüdyosu F2) | – | – | – | – |
| 134 | `test_label_context_default.ts` | Etiket/Yazıcı | LabelContextDefault — bağlam-başına varsayılan şablonun yeni tek kaynağı | Y·del 3 | – | – | – |
| 135 | `test_label_context_fit.ts` | Etiket/Yazıcı | Şablon ↔ baskı bağlamı uyumu (fail-closed arka kapısı) | Y·del 9 | – | – | – |
| 136 | `test_label_copies.ts` | Etiket/Yazıcı | Saha #6 — etiket kopya adedi (default 2, override'lı) | Y·del 0 | – | – | – |
| 137 | `test_label_defs_lifecycle.ts` | Etiket/Yazıcı | Etiket tanımlarında pasife-alma ↔ KALICI silme ayrımı (deletedAt kalıbı) | Y·del 2 | – | – | – |
| 138 | `test_label_dirty_sources.ts` | Etiket/Yazıcı | ETİKET BAYAT KAYNAKLARI — kartelalık işareti (K3) + çuval içeriği/notu (D2) | Y·del 9 | – | – | – |
| 139 | `test_label_element_condition.ts` | Etiket/Yazıcı | koşullu etiket elemanı (showIf) — "kaliteyi yalnız 2. kalitede bas" | R | – | – | – |
| 140 | `test_label_format_resolver.ts` | Etiket/Yazıcı | etiket format çözümü (resolveLabelFormat) öncelik zinciri — Etiket Stüdyosu v2 | Y·del 3 | – | – | – |
| 141 | `test_label_html_format.ts` | Etiket/Yazıcı | boyut-bilinçli HTML render (buildRollLabelHtml format/pay) | – | – | – | – |
| 142 | `test_label_icons.ts` | Etiket/Yazıcı | Etiket ikon testi (DB'siz): kayıt defteri bütünlüğü (benzersiz anahtar, geçerli | – | – | – | – |
| 143 | `test_label_native_languages.ts` | Etiket/Yazıcı | çok-dilli native etiket (PPLB/ZPL üreteçleri + registry dispatch + | R | – | – | – |
| 144 | `test_label_ppla.ts` | Etiket/Yazıcı | Argox PPLA native komut üreteci (buildRollLabelPpla) | – | – | – | – |
| 145 | `test_label_preview_single_copy.ts` | Etiket/Yazıcı | Etiket ÖNİZLEMESİ her zaman TEK kopya (2026-08-17) | Y·del 5 | – | – | – |
| 146 | `test_label_rawcode.ts` | Etiket/Yazıcı | uzman raw-code override motoru (applyRawCode + renderLabel + preview). | R | – | – | – |
| 147 | `test_label_routing_resolver.ts` | Etiket/Yazıcı | birleşik etiket yönlendirme çözücü (resolveLabelRouting) | Y·del 5 | – | – | – |
| 148 | `test_label_snapshot_audit_split.ts` | Etiket/Yazıcı | "Niyet kaydı" (snapshot) ile "fiziksel baskı audit'i" (LABEL_PRINTED) ayrımı. | Y·del 3 | – | – | – |
| 149 | `test_label_template_io.ts` | Etiket/Yazıcı | Şablon dışa/içe aktar (JSON zarf) round-trip + çoğaltma | Y·del 1 | – | – | – |
| 150 | `test_label_template_layout.ts` | Etiket/Yazıcı | şablon-başına yerleşim (satır aralığı + QR boyutu) — 3 native dil generator | R | – | – | – |
| 151 | `test_label_variant_selection.ts` | Etiket/Yazıcı | boyut varyantı seçimi (pickVariant) — Etiket Stüdyosu F3 | R | – | – | – |
| 152 | `test_latency_middleware.ts` | Altyapı/Ops | test_latency_middleware — GERÇEK Express üzerinde anahtar çözümü + abort ölçümü | HTTP | – | – | – |
| 153 | `test_latency_persist.ts` | Altyapı/Ops | test_latency_persist — günlük özet kalıcılaştırması (GERÇEK DB, TEST- verisi) | Y·del 1 | – | – | – |
| 154 | `test_latency_stats.ts` | Altyapı/Ops | test_latency_stats — latency-stats.service birim testleri (DB YOK) | – | – | – | – |
| 155 | `test_login_access.ts` | Kimlik/Yetki | Login + erişim kuralı (şifre / clientType erişim / token exp / oturum kaydı) | Y·del 4 | – | – | – |
| 156 | `test_login_lockout.ts` | Kimlik/Yetki | Hızlı PIN + kart giriş deneme kilidi (login-lockout) | Y·del 5 | – | – | – |
| 157 | `test_login_lockout_coverage.ts` | Kimlik/Yetki | HER giriş yolu deneme kilidine bağlı + kilit bcrypt'ten ÖNCE (2026-08-09) | R | – | – | – |
| 158 | `test_login_methods.ts` | Kimlik/Yetki | Giriş yöntemleri (auth.loginMethods) + salt hızlı-PIN girişi | Y·del 7 | – | – | – |
| 159 | `test_manual_attributes_reason.ts` | Tambur | Manuel nitelik düzeltme + zorunlu sebep (applyManualProperties reason) | Y·del 3 | – | – | – |
| 160 | `test_manual_move.ts` | İş emri/Rota/Refakat | TEST (2026-07-15): Manuel Konum Düzeltme (süpervizör override). | Y·del 12 | – | – | – |
| 161 | `test_manual_move_backflush.ts` | İş emri/Rota/Refakat | Faz 1 doğrulama — Konumu Düzelt ileri-atlama BACKFLUSH. | Y·del 1 | – | – | – |
| 162 | `test_manual_move_fason_receive.ts` | İş emri/Rota/Refakat | Faz 2 (tam) doğrulama — Konumu Düzelt inline "Fason Kabul ile içeri al". | R | – | – | – |
| 163 | `test_manual_move_field_continuity.ts` | İş emri/Rota/Refakat | TEST (2026-07-30): Manuel taşıma sonrası SAHA SÜREKLİLİĞİ — personel işine | Y·del 11 | – | – | – |
| 164 | `test_manual_move_qc_reversal.ts` | İş emri/Rota/Refakat | Faz 3 doğrulama — Konumu Düzelt geri-taşıma QC reversal. | Y·del 2 | – | – | – |
| 165 | `test_manual_roll_undo.ts` | Tambur | ELLE EKLENEN TOPU GERİ ALMA (undo MANUAL modu) + yan sözleşmeler | Y·del 4 | – | [5] iptal edilmiş topun token'ı replay EDİLEMEZ (409) | – |
| 166 | `test_master_data_merge.ts` | Master-data/Arama/İçe aktarım | ANA VERİ BİRLEŞTİRME — MUTLU YOL + SÖZLEŞME (Faz B5) | Y·del 6 | – | – | – |
| 167 | `test_master_data_merge_conflicts.ts` | Master-data/Arama/İçe aktarım | BİRLEŞTİRME ÇAKIŞMA POLİTİKALARI (Faz B5) | Y·del 7 | – | – | – |
| 168 | `test_master_data_merge_fk_coverage.ts` | Master-data/Arama/İçe aktarım | BİRLEŞTİRME HARİTASI KAPSAMA BEKÇİSİ (Faz B5) | R | – | – | – |
| 169 | `test_master_data_name_dup.ts` | Master-data/Arama/İçe aktarım | Tanımlarda ad-mükerrer koruması (2026-07-27) | Y·del 9 | – | – | – |
| 170 | `test_masterdata_guards.ts` | Master-data/Arama/İçe aktarım | master-data validation guard'ları — PR-3 | Y·del 4 | – | – | – |
| 171 | `test_merge_field_picks.ts` | Master-data/Arama/İçe aktarım | BİRLEŞTİRMEDE ALAN SEÇİMİ (survivorship) — mükerrer paneli v2 P2, 2026-08-22 | Y·del 3 | – | – | – |
| 172 | `test_middleware_order.ts` | Altyapı/Ops | app.ts middleware SIRASI ve load-bearing ayarları (F-CORE-OPS-006) | – | – | – | – |
| 173 | `test_migration_hygiene.ts` | Altyapı/Ops | Migration DB↔DİZİN mutabakatı — "dev'e uygulandı ama dosya kayboldu/commit | R | – | – | – |
| 174 | `test_mobile_item_permission.ts` | Kimlik/Yetki | `mobile:kumas` — mobil "Kumaş Ekle" ekranının izin SINIRI. | Y·del 5 | – | – | – |
| 175 | `test_mobile_order_permission.ts` | Kimlik/Yetki | `mobile:siparis` — mobil "Yeni Sipariş" ekranının izin SINIRI. | Y·del 2 | – | HTTP aynı token → mükerrer sipariş yok; 4xx'te token tazelenir | – |
| 176 | `test_mobile_screen_permissions.ts` | Kimlik/Yetki | Mobil ekran izni ↔ çağırdığı uçların guard'ı (2026-08-17) | – | – | – | – |
| 177 | `test_mobile_update.ts` | Altyapı/Ops | Mobil güncelleme deposu — DONMUŞ MANİFEST SÖZLEŞMESİ. | HTTP | – | – | – |
| 178 | `test_name_normalization.ts` | Master-data/Arama/İçe aktarım | Saha #13 — ürün/renk adı normalize standardı | Y·del 3 | – | – | – |
| 179 | `test_name_uppercase_storage.ts` | Master-data/Arama/İçe aktarım | Master-data adları DB'ye BÜYÜK harfle yazılır (2026-08-19) | Y·del 3 | – | – | – |
| 180 | `test_native_preview.ts` | Etiket/Yazıcı | native komut → görsel SVG çeviriciler (PPLB + PPLA + ZPL). | R | – | – | – |
| 181 | `test_native_template_honoring.ts` | Etiket/Yazıcı | native renderer'lar (PPLA/PPLB/ZPL) ARTIK etiket şablonunu uygular | R | – | – | – |
| 182 | `test_new_documents.ts` | Belge | Yeni belgeler testi — Fason Kabul / Kalite Sert. / Packing / Invoice / İade | Y·del 0 | – | – | – |
| 183 | `test_null_quality_visibility.ts` | Envanter/Top | Kalite NULL görünürlüğü — Faz 3. qualityGrade nullable oldu; kaliteye bakılmamış | Y·del 1 | – | – | – |
| 184 | `test_o19_operator_trace.ts` | Çuval/Sevk/İade | O-19 — sevkiyat operatör izi (Çuval Depo modeli). | Y·del 7 | – | – | – |
| 185 | `test_observability_cache.ts` | Audit/Gözlem | Audit gözlemlenebilirliği + feature-flag agregat cache davranış testi. | Y·del 1 | – | – | – |
| 186 | `test_observability_contract.ts` | Audit/Gözlem | "sessizce yanlış davranan sistem" sözleşmesi (2026-08-09 denetimi) | R | – | – | var |
| 187 | `test_offsite_sweep.ts` | Altyapı/Ops | Offsite yedek süpürücüsü sözleşmesi | – | – | – | – |
| 188 | `test_open_order_coverage.ts` | Sipariş | TeksERP - Açık Sipariş Karşılanma raporu bekçisi | Y·del 5 | – | – | – |
| 189 | `test_order_alias_promote.ts` | Sipariş | promoteCustomerAliases batch (N+1 → 2 sorgu) — PR-1 | Y·del 5 | – | – | – |
| 190 | `test_order_cancel_card_dirty.ts` | Sipariş | SİPARİŞ İPTALİ → REFAKAT KARTI BAYAT (+ legacy softDelete bağ temizliği) | Y·del 8 | – | – | – |
| 191 | `test_order_cancel_reason.ts` | Sipariş | TeksERP - Sipariş iptal sebebi bekçisi | Y·del 3 | – | – | – |
| 192 | `test_order_cancellation.ts` | Sipariş | TeksERP - Sipariş İptal Karnesi bekçisi | Y·del 3 | – | – | – |
| 193 | `test_order_filter_batch_check.ts` | Sipariş | İş emri parti kodu blur kontrolü + sipariş ürün/renk filtresi testi. | Y·del 3 | F (yalnız fixture paralel) | – | – |
| 194 | `test_order_filter_wostate.ts` | Sipariş | Sipariş "İş Emri" rollup filtresi (filter[woState]) testi. | Y·del 3 | – | – | – |
| 195 | `test_order_intake.ts` | Sipariş | TeksERP - Sipariş Karnesi (giriş tarafı) bekçisi | Y·del 3 | – | – | – |
| 196 | `test_order_leadtime.ts` | Sipariş | TeksERP - Sipariş → Teslim Süresi bekçisi | Y·del 6 | – | – | – |
| 197 | `test_order_line_cancel.ts` | Sipariş | TeksERP - Sipariş kalemi iptali bekçisi | Y·del 8 | – | – | – |
| 198 | `test_order_line_scope_single_source.ts` | Sipariş | TeksERP - "Aktif sipariş kalemi" kuralının TEK KAYNAK bekçisi | – | – | – | – |
| 199 | `test_order_lines_available.ts` | Sipariş | /orders/order-lines/available iki-modlu (legacy + cursor) — sipariş-önce | Y·del 2 | – | – | – |
| 200 | `test_order_number_override.ts` | Sipariş | Saha #16 — sipariş numarası override (boş = otomatik) | Y·del 1 | – | – | – |
| 201 | `test_order_shipments.ts` | Sipariş | Sipariş → sevkiyat drill-down (getOrderShipments) testi. | Y·del 14 | – | – | – |
| 202 | `test_order_stats.ts` | Sipariş | TeksERP - Sipariş özet şeridi (`GET /api/orders/stats`) bekçisi | Y·del 4 | – | – | var |
| 203 | `test_p1b_barcode_collision.ts` | Barkod | clientToken idempotency SADECE payload özdeşse (çapraz-cihaz token yeniden | Y·del 5 | – | aynı token+aynı payload idempotent; farklı payload 409 CLIENT_TOKEN_COLLISION | – |
| 204 | `test_p2_api.ts` | Altyapı/Ops | P2 api-misc bucket testi — F221 (istasyon-türü izin enforcement) + F59 (WO | Y·del 10 | – | – | – |
| 205 | `test_p2_auth.ts` | Kimlik/Yetki | P2 auth-rbac bucket testi — F49 (release semantics) + F253/F254 (son-admin | Y·del 4 | – | – | – |
| 206 | `test_p2_infra.ts` | Altyapı/Ops | P2 infra bucket testi — F20 (atomik login rezervasyonu) + F29 (boot guard) | Y·del 2 | **Y** 200× reserveLoginAttempt (bellek) → tam 5 serbest | – | – |
| 207 | `test_p2_inventory.ts` | Envanter/Top | P2 inventory bucket testi — F114 (relabel/supervisor kapsam ayrımı) + F116 | Y·del 3 | – | – | – |
| 208 | `test_p2_kk2reopen.ts` | Kurşun/KK2 | P2 kk2-tambur testi — reopenStep F159 (son-adım geri çekme) + F161 (yalnız SON | Y·del 6 | – | – | – |
| 209 | `test_p2_order.ts` | Sipariş | P2 order bucket testi — F148 (currency + deadline doğrulaması create/update | Y·del 4 | – | – | – |
| 210 | `test_performance.ts` | Rapor/Tutarlılık | Yük / Performans SMOKE — InventoryService.findAllRolls (cursor) + | Y·del 3 | – | – | – |
| 211 | `test_peripheral_for_device.ts` | Etiket/Yazıcı | PeripheralDevice giriş-cihazı protokol alanları + getForDevice çözümleme. | Y·del 3 | – | – | – |
| 212 | `test_peripheral_registry_crud.ts` | Etiket/Yazıcı | PeripheralDeviceService — CRUD + sahiplik guard + şablon route + dil zorunluluğu | Y·del 5 | – | – | – |
| 213 | `test_peripheral_station_owner.ts` | Etiket/Yazıcı | PeripheralDevice istasyon sahipliği (stationId) — validateRefs kuralları | Y·del 1 | – | – | – |
| 214 | `test_permission_catalog.ts` | Kimlik/Yetki | İZİN KATALOĞU BEKÇİSİ — kod tabanındaki her izin kodu katalogda var mı? | R | – | – | – |
| 215 | `test_permission_management.ts` | Kimlik/Yetki | PermissionManagementService — grant/revoke/set/applyTemplate | Y·del 1 | – | – | – |
| 216 | `test_phase0_quickwins.ts` | İş emri/Rota/Refakat | Faz 0 — çapraz dayanıklılık/perf hızlı kazanımları | Y·del 7 | – | – | – |
| 217 | `test_phase1_uretim_hardening.ts` | İş emri/Rota/Refakat | Faz 1 — Üretim domain sertleştirme | Y·del 7 | **Y** 2× wo.softDelete → tam 1 ok + 1×409 | – | – |
| 218 | `test_phase2_broad_hardening.ts` | İş emri/Rota/Refakat | Faz 2 — broad-audit güvenli sertleştirme | Y·del 6 | **Y** 2× voidCard → tam 1 ok + 1×409 | – | – |
| 219 | `test_phase3_stok_hardening.ts` | İş emri/Rota/Refakat | Faz 3 — Stok/Roll sertleştirme | Y·del 6 | **Y** 2× lockWorkOrder → tam 1 ok + 1×409 | – | – |
| 220 | `test_phase4_fason_hardening.ts` | Fason | Faz 4 — broad-audit güvenli sertleştirme (Fason denetimi turundan) | Y·del 4 | **Y** 2× order.manualComplete → tam 1 ok + 1×409 | – | – |
| 221 | `test_phase5_kartela_hardening.ts` | Çuval/Sevk/İade | Faz 5 — broad-audit güvenli sertleştirme (Kartela denetimi turundan) | Y·del 2 | **Y** 2× order.reopen → tam 1 ok + 1×409 | – | – |
| 222 | `test_phase6_reporterror_concurrency.ts` | Tambur | Faz 6 — RollError mükerrer-hata EŞZAMANLILIK guard'ı (partial unique) | Y·del 4 | **Y** 2× reportError → tam 1 ok + 1×409 + DB'de 1 | – | – |
| 223 | `test_phase7_route_validation.ts` | İş emri/Rota/Refakat | Faz 7 — RouteService nested step ref + sequence guard | Y·del 3 | – | – | – |
| 224 | `test_plan_deviation_scorecard.ts` | Rapor/Tutarlılık | PLAN-SAPMA KARNESİ bekçisi (2026-08-19) | Y·del 6 | – | – | var |
| 225 | `test_pool_health.ts` | Altyapı/Ops | pg havuzu zaman aşımı sınıflandırıcısı + errorHandler eşlemesi. | Y·del 3 | – | – | – |
| 226 | `test_printed_doc_builders.ts` | Belge | Donmuş belge BUILDER'larının Prisma SORGU ŞEKLİ geçerli mi? | R | – | – | – |
| 227 | `test_printed_documents.ts` | Belge | PrintedDocument (resmi belge defteri) uçtan uca test | Y·del 14 | – | – | – |
| 228 | `test_printer_transport.ts` | Etiket/Yazıcı | yazıcı transport (Faz-2 gerçek socket gönderim + Faz-1 simülasyon) | Y·del 1 | – | – | – |
| 229 | `test_produced_buckets.ts` | Rapor/Tutarlılık | ÜRETİLEN METRAJ KOVALARI — kalite kodu KATALOGDAN çözülür, A1 SAYILIR. | Y·del 12 | – | – | – |
| 230 | `test_production_flow_columns.ts` | Rapor/Tutarlılık | getProductionFlow — tüm kolonlar hatasız döner (kuyruk kolonları dahil) | R | R (paralel okuma) | – | – |
| 231 | `test_property_station_binding.ts` | Master-data/Arama/İçe aktarım | Kumaş özelliği DOĞARKEN istasyonuna bağlanır (2026-08-02) | Y·del 3 | – | – | – |
| 232 | `test_property_targetable.ts` | Master-data/Arama/İçe aktarım | SEÇİM (CHOICE) ÖZELLİĞİ HEDEF OLAMAZ + TİP GEÇİŞ KİLİTLERİ (2026-08-11) | Y·del 14 | – | – | – |
| 233 | `test_property_value_selection.ts` | Master-data/Arama/İçe aktarım | DEĞER TAŞIYAN ÖZELLİK — "Kurşunda 50 gr yaptım" (2026-08-11) | Y·del 12 | – | – | – |
| 234 | `test_qc2_idempotency.ts` | Kurşun/KK2 | Tek-seferlik idempotency doğrulama testi (Kurşun completeQc2 @@unique). | Y·del 1 | – | completeQc2 @@unique çift çağrı → tek op | – |
| 235 | `test_quality_scorecard.ts` | Rapor/Tutarlılık | KALİTE KARNESİ + üretim zaman çıpası trigger'ı | Y·del 1 | – | – | – |
| 236 | `test_quick_start_wo.ts` | İş emri/Rota/Refakat | Mobil "Hızlı İş Emri" (quickStart) backend davranış testi. | Y·del 7 | – | quickStart aynı token → aynı WO | – |
| 237 | `test_quickstart_dispatch.ts` | Fason | Hızlı İş Emri + otomatik fason sevki + tek-kaynak "KUMAŞ İRSALİYESİ" çeki | Y·del 13 | – | – | – |
| 238 | `test_quickstart_dispatch_api.ts` | Fason | Hızlı İş Emri fason sevki + çeki HTML — HTTP katmanı | Y·del 13 | – | – | – |
| 239 | `test_race_conditions.ts` | Fason | Race-condition sertleştirme (feat/race-condition-hardening) | Y·del 19 | **Y** 2× directShip over-cover → tam 1; çifte-ateş → tam 1; receive‖dispatch → invariant | – | – |
| 240 | `test_raster_bitmap.ts` | Etiket/Yazıcı | Raster çekirdek testi (DB'siz): Bitmap1 primitifleri + rotate-blit + BMP kodlayıcı. | – | – | – | – |
| 241 | `test_raster_canvas.ts` | Etiket/Yazıcı | Raster kanvas testi (DB'siz): rasterizeCanvasLayout — 8 eleman tipi (icon dahil), | – | – | – | – |
| 242 | `test_raster_contract.ts` | Etiket/Yazıcı | Raster registry sözleşme testi (DB'siz): renderLabel encoding/bytes + shouldRasterize | R | – | – | – |
| 243 | `test_raster_envelope.ts` | Etiket/Yazıcı | Raster dil zarfı testi (DB'siz): PPLB GW (polarite + ayraçsız + blok uzunluğu), | – | – | – | – |
| 244 | `test_raster_text.ts` | Etiket/Yazıcı | Raster metin testi (DB'siz): font yükleme + glif dolgu + Türkçe glif + wr/bold/rot. | – | – | – | – |
| 245 | `test_raw_sale_quick_order.ts` | Sipariş | Saha #10 (ham kumaş satışı) + #11 (hızlı sipariş) | Y·del 6 | – | – | – |
| 246 | `test_raw_sql_hygiene.ts` | Altyapı/Ops | HAM SQL SAAT HİJYENİ BEKÇİSİ — `$queryRaw`/`$executeRaw` içinde ÇIPLAK | – | – | – | – |
| 247 | `test_raw_tambur_cut.ts` | Tambur | Ham (renksiz) top Tambur "Top Kesme" davranış testi. | Y·del 6 | – | – | – |
| 248 | `test_reason_presets.ts` | Master-data/Arama/İçe aktarım | HAZIR SEBEP KATALOĞU (2026-08-19) | Y·del 1 | – | – | – |
| 249 | `test_recent_output_filters.ts` | Envanter/Top | "Son Çıkan Toplar" FİLTRELERİ + `Roll.labelCustomerId` | Y·del 3 | – | – | – |
| 250 | `test_recipe.ts` | Master-data/Arama/İçe aktarım | ProductRecipeService — üretim reçetesi CRUD + özellik (M:N) replace | Y·del 1 | – | – | – |
| 251 | `test_recipe_property_validation.ts` | Master-data/Arama/İçe aktarım | ProductRecipe properties[] isActive + dedup guard (backlog #7) | Y·del 2 | – | – | – |
| 252 | `test_record_provenance.ts` | Audit/Gözlem | Kayıt künyesi — kim oluşturdu / kim son değiştirdi (2026-08-19) | Y·del 2 | – | – | var |
| 253 | `test_report_day_boundary.ts` | Rapor/Tutarlılık | GÜN SINIRI BEKÇİSİ — raporlarda "bu olay hangi GÜNE ait" sorusu AÇIK mı? | Y·del 1 | – | – | – |
| 254 | `test_reports.ts` | Rapor/Tutarlılık | Rapor servisleri (src/services/reports/*) — happy-path, kendi fixture'ı | Y·del 0 | – | – | – |
| 255 | `test_rescue_stuck.ts` | İş emri/Rota/Refakat | Faz 5 — IN_PRODUCTION-stuck rescue (Durum Düzelt + recover-to-production yerine). | Y·del 6 | – | – | – |
| 256 | `test_return_bulk_group.ts` | Çuval/Sevk/İade | ÇUVAL BAZLI TOPLU İADE + TEK ÇOK KALEMLİ İRSALİYE | Y·del 8 | – | – | – |
| 257 | `test_return_scorecard.ts` | Çuval/Sevk/İade | İADE KARNESİ | Y·del 10 | – | – | – |
| 258 | `test_role_template_catalog.ts` | Kimlik/Yetki | ROL (YETKİ ŞABLONU) KATALOĞU BEKÇİSİ | R | – | – | – |
| 259 | `test_roll_barcode.ts` | Barkod | Kısa top barkodu (T+GGAAYY+H/F+NNNN) üreteç testi. Üretim atomik sayaç | Y·del 1 | **Y** 20× generateRollBarcode → 20 benzersiz | – | – |
| 260 | `test_roll_cancel_step_recompute.ts` | Envanter/Top | TOP İPTALİ, TOPUN GEÇTİĞİ *KAPALI* HAREKETLİ ADIMLARI DA YENİDEN HESAPLAR | Y·del 11 | – | – | – |
| 261 | `test_roll_cancel_undo.ts` | Envanter/Top | ÖLÜ ETİKET SÖZLEŞMESİ — etiketli iptal guard'ı + iptali geri alma | Y·del 1 | – | – | var |
| 262 | `test_roll_edit_unified.ts` | Envanter/Top | TEST (2026-07-30): TEK düzeltme sözleşmesi — applyManualProperties birleşimi. | Y·del 5 | – | – | – |
| 263 | `test_roll_entry_station.ts` | KK1/Ham giriş | Roll.entryStationId — GİRİŞ İSTASYONU damgası | Y·del 4 | – | – | – |
| 264 | `test_roll_fold_and_reason.ts` | Envanter/Top | Roll.foldType + Roll.entryReason KALICI KOLON sözleşmesi | Y·del 1 | – | – | – |
| 265 | `test_roll_label_cut_seed_snapshot.ts` | Envanter/Top | Tambur kesimi etiket NİYETİNİ child'ın lastLabelSnapshot'ına seed ediyor mu? | Y·del 11 | – | – | – |
| 266 | `test_roll_relabel.ts` | Envanter/Top | Saha #4 — top etiketi değiştirme (renk/özellik/en/kalite) | Y·del 6 | – | – | – |
| 267 | `test_roll_relabel_context.ts` | Envanter/Top | Yeniden-Etiketleme istasyonu bağlamı (getRelabelContext) | Y·del 8 | – | – | – |
| 268 | `test_roll_search_barcode.ts` | Envanter/Top | Top listesi aramasında BARKOD normalize edilir (2026-08-19) | Y·del 2 | – | – | – |
| 269 | `test_roll_variance.ts` | Envanter/Top | SAPMA DEFTERİ (`RollVariance`) — fire / kayıt düzeltmesi / aşım | Y·del 4 | – | – | – |
| 270 | `test_route_auth_coverage.ts` | Kimlik/Yetki | HER route kimlik doğrulaması taşır (2026-08-09 denetimi, F-CORE-GUV-001) | – | – | – | – |
| 271 | `test_route_firm_roundtrip.ts` | İş emri/Rota/Refakat | Saha #14 regresyonu: rota şablonu fason firma (plannedSubcontractorId) round-trip | Y·del 1 | – | – | – |
| 272 | `test_route_skip_warning.ts` | İş emri/Rota/Refakat | TEST (O2): rota-atlama uyarısı (ROUTE_SKIP) + allowRouteSkip onayı + transfer false-positive yok. | Y·del 14 | – | – | – |
| 273 | `test_route_step_targets.ts` | İş emri/Rota/Refakat | Rota adımının ŞABLON HEDEFİ — renk + özellik (2026-08-06) | Y·del 5 | – | – | – |
| 274 | `test_route_template_fason.ts` | İş emri/Rota/Refakat | Saha #14 — rota şablonu fason planlamasını saklar ve WO'ya klonlar | Y·del 5 | – | – | – |
| 275 | `test_sack_content_dump.ts` | Çuval/Sevk/İade | Çuval İÇERİK DÖKÜMÜ (getContentDump) — top bazlı döküm | Y·del 10 | – | – | – |
| 276 | `test_sack_label.ts` | Çuval/Sevk/İade | Çuval etiketi (LabelKind.SACK) — payload + fail-closed şablon guard'ı | Y·del 8 | – | – | – |
| 277 | `test_sack_mismatch.ts` | Çuval/Sevk/İade | ÇUVAL İÇERİĞİ UYUŞMAZLIK UYARILARI (2026-08-09) | Y·del 11 | F (yalnız fixture paralel) | – | var |
| 278 | `test_sack_note_document.ts` | Çuval/Sevk/İade | Sevk irsaliyesinde "AÇIKLAMA" (çuval yorumu) kolonu | Y·del 7 | – | – | – |
| 279 | `test_sack_notes.ts` | Çuval/Sevk/İade | Çuval yorumu (Sack.notes) — iç serbest not | Y·del 6 | – | – | – |
| 280 | `test_sack_pool_lifecycle.ts` | Çuval/Sevk/İade | Çuval Depo modeli (mühür/rezerv YOK, kapı önü YOK) yaşam döngüsü testi. | Y·del 7 | – | – | – |
| 281 | `test_sack_reassign_customer.ts` | Çuval/Sevk/İade | Depodaki çuvalın MÜŞTERİSİNİ değiştir (reassignSackCustomer) | Y·del 7 | – | – | – |
| 282 | `test_sack_search.ts` | Çuval/Sevk/İade | Saha #1+#23 — Çuval/Top Arama servisi | Y·del 3 | – | – | – |
| 283 | `test_sack_split_and_relabel.ts` | Çuval/Sevk/İade | Çuval bölme (splitSack) + müşteri değişiminde etiket bayatlaması | Y·del 11 | – | – | – |
| 284 | `test_sack_status_invariant.ts` | Çuval/Sevk/İade | Çuval içerik invariant'ı — "çuvaldaki top başka yere ALINAMAZ" | Y·del 18 | **Y** kartela dispatch‖scanIntoSack → tam 1 ok + tutarlı son durum | – | – |
| 285 | `test_sack_weigh_source.ts` | Çuval/Sevk/İade | Simüle kantar koruması — `weighSack` kaynak beyanı + backend ENFORCE | Y·del 7 | – | – | – |
| 286 | `test_scan_code_case.ts` | Master-data/Arama/İçe aktarım | Okutulan barkod BÜYÜK/küçük harften bağımsız bulunur (2026-08-17) | Y·del 4 | – | – | var |
| 287 | `test_schema_drift.ts` | Altyapı/Ops | ŞEMA DRIFT KAPISI — repo şeması (`schema.prisma`) ile CANLI DB'nin eşitliği | HTTP | – | – | – |
| 288 | `test_scrap_grade_label.ts` | Tambur | FİRE KALİTEDE ETİKET KAPISI — iki kapı + istemci sözleşmesi (2026-08-20) | Y·del 2 | – | – | – |
| 289 | `test_scrap_scorecard.ts` | Rapor/Tutarlılık | FİRE KARNESİ | Y·del 2 | – | – | var |
| 290 | `test_screen_catalog.ts` | Altyapı/Ops | Ekran manifestosu GERÇEKLE uyumlu mu? (2026-08-19) | – | – | – | var |
| 291 | `test_search_field_config.ts` | Master-data/Arama/İçe aktarım | Arama alanı kovaları doğru mu — METİN ↔ KOD (2026-08-19) | R | – | – | – |
| 292 | `test_semi_finished_entry.ts` | KK1/Ham giriş | Dışarıdan alınan YARI MAMUL girişi (2026-08-17, madde 9) | Y·del 5 | – | – | – |
| 293 | `test_semi_finished_surfaces.ts` | KK1/Ham giriş | YARI MAMUL AYRIMI — kalan yüzeyler (2026-08-27) | Y·del 9 | – | – | – |
| 294 | `test_session_duration_minutes.ts` | Kimlik/Yetki | Oturum süresi DAKİKA-granüler ayarı (auth.sessionDurationMinutes) | Y·del 5 | – | – | – |
| 295 | `test_session_purge.ts` | Kimlik/Yetki | test_session_purge — ölü oturum temizliği (GERÇEK DB, TEST- verisi) | Y·del 1 | – | – | – |
| 296 | `test_session_registry.ts` | Kimlik/Yetki | Session Registry (oturum defteri) + aynı-tip politika + middleware iptal | Y·del 4 | – | – | – |
| 297 | `test_shipment_detail_gross.ts` | Çuval/Sevk/İade | Sevkiyat DETAYI da BRÜT'tür — çuval içeriği iade sonrası boşalmaz | Y·del 7 | – | – | – |
| 298 | `test_shipment_dispatch_document.ts` | Çuval/Sevk/İade | Sevk İrsaliyesi TEK KAYNAK belgesi (renderShipmentDispatchHtml + getHtml) | Y·del 3 | – | – | – |
| 299 | `test_shipment_doc_batch_column.ts` | Çuval/Sevk/İade | Müşteri sevk irsaliyesi — çeki tablosundaki PARTİ NO kolonu (opt-in) | – | – | – | – |
| 300 | `test_shipment_filters.ts` | Çuval/Sevk/İade | Sevkiyat LİSTESİ filtreleri + sıralama + eşleşme rozeti (listShipments) | Y·del 5 | – | – | – |
| 301 | `test_shipment_invoice.ts` | Çuval/Sevk/İade | Fatura işareti (muhasebe) — işaretle / düzelt / kaldır + statü guard'ı | Y·del 11 | – | – | – |
| 302 | `test_shipment_list_gross.ts` | Çuval/Sevk/İade | Sevkiyat LİSTESİ de BRÜT'tür — metraj + top adedi iade sonrası düşmez | Y·del 5 | – | – | – |
| 303 | `test_shipment_list_sort.ts` | Çuval/Sevk/İade | Sevkiyat listesi `dispatchedAt` sıralaması + union keyset sayfalama | Y·del 8 | – | – | – |
| 304 | `test_shipment_scope_lock.ts` | Çuval/Sevk/İade | Storno <-> iade sevkiyat kapsamlı kilidi (F-SEV-ESZ-001, 2026-08-09) | Y·del 5 | **Y** undo‖createReturn → yasak durum yok, ≥1 red (+ kaynak SIRA); SIRA: kilit SIRASI (kaynak indexOf) | – | – |
| 305 | `test_shipment_scorecard.ts` | Çuval/Sevk/İade | SEVK & TERMİN KARNESİ (OTIF) | Y·del 4 | – | – | – |
| 306 | `test_shipment_undo_dispatch.ts` | Çuval/Sevk/İade | SEVKİ GERİ AL (STORNO) — "mal hiç çıkmadı", iade DEĞİL | Y·del 13 | – | – | – |
| 307 | `test_shipping_client_token.ts` | Çuval/Sevk/İade | Sack/Shipment clientToken idempotency (G-7 / A4 — 2026-07-31 denetimi) | Y·del 6 | – | openSack/createShipment aynı token → tek kayıt; token'sız geri uyum | – |
| 308 | `test_similar_names.ts` | Master-data/Arama/İçe aktarım | "Benzer kayıtlar" — mükerreri REDDETMEK yerine ÖNLEMEK (2026-08-19) | Y·del 1 | – | – | – |
| 309 | `test_spec_availability.ts` | Sipariş | Sipariş formu spec-müsaitlik (getSpecAvailability) testi. | Y·del 6 | – | – | – |
| 310 | `test_split_card_lineage.ts` | Parti | Parti ayırma SOY BAĞI + ESKİ REFAKAT KARTI YÖNLENDİRMESİ (redye NEW_COLOR). | Y·del 16 | – | – | – |
| 311 | `test_split_per_roll.ts` | Parti | Per-roll split (yeni-renk redye) — DYE-FIRST akışı. | Y·del 19 | – | – | – |
| 312 | `test_standalone_label.ts` | Etiket/Yazıcı | Serbest (statik) etiket şablonu — "standalone" bayrağı uçtan uca | Y·del 2 | – | – | – |
| 313 | `test_station_capability.ts` | Master-data/Arama/İçe aktarım | StationCapabilityService — istasyon renk/özellik yetkinlik yönetimi | Y·del 4 | F (yalnız fixture paralel) | – | – |
| 314 | `test_station_capability_flags.ts` | Master-data/Arama/İçe aktarım | İSTASYON YETENEĞİ KATEGORİDEN AYRILDI (2026-08-10) | Y·del 4 | – | – | – |
| 315 | `test_station_property_mode.ts` | Master-data/Arama/İçe aktarım | İSTASYON-ÖZELLİK DAVRANIŞ MODU (AUTO / OPTIONAL / REQUIRED) — 2026-08-10 | Y·del 7 | – | – | – |
| 316 | `test_stock_label_no_customer_inference.ts` | Etiket/Yazıcı | Etiket müşteri çözümü — EXPLICIT-ONLY sözleşmesi testi. | Y·del 8 | – | – | – |
| 317 | `test_stock_scorecard.ts` | Rapor/Tutarlılık | STOK & ÖLÜ STOK KARNESİ | Y·del 5 | – | – | – |
| 318 | `test_subcontract_scorecard.ts` | Fason | FASON KARNESİ | Y·del 10 | – | – | – |
| 319 | `test_subcontractor_management.ts` | Fason | SubcontractorManagementService — create/reactivate-replace + update | Y·del 3 | – | – | – |
| 320 | `test_swagger_spec.ts` | Altyapı/Ops | OpenAPI (swagger-jsdoc) bloklarının TAMAMI geçerli YAML mı? (2026-08-21) | – | – | – | – |
| 321 | `test_system_log.ts` | Audit/Gözlem | AuditService + SystemLogService — audit yazımı / best-effort / liste / arşiv | Y·del 5 | – | – | – |
| 322 | `test_tambur_branch_info.ts` | Tambur | Tambur liste parti zenginleştirmesi (buildBranchInfoMap) regresyon testi. | Y·del 8 | – | – | – |
| 323 | `test_tambur_cut_barcoded.ts` | Tambur | Option A doğrulama — Tambur'da BARKODLU top kesilebilir (barkod-reddi kaldırıldı, | Y·del 8 | – | – | – |
| 324 | `test_tambur_cut_idempotency.ts` | Tambur | Tambur kesim idempotency (clientChildBarcode) — backlog #3 | Y·del 9 | **Y** 2× cutWarehouseRoll aynı token → ikisi ok, 1 child, 1 düşüm | cut sıralı+paralel replay → 1 child; token'sız → idempotency yok | – |
| 325 | `test_tambur_finalize_wo_guard.ts` | Tambur | Tambur finalize — WO guard + kapama + çocuk damgası testi (2026-07-27 düzeltmeleri). | Y·del 8 | – | – | – |
| 326 | `test_tambur_manual_batch.ts` | Tambur | "Manuel Top Ekle" — PARTİ BAĞLAMA sözleşmesi | Y·del 7 | – | hata FAZ 1'den önce → token temiz kalır | – |
| 327 | `test_tambur_manual_field.ts` | Tambur | TAMBUR SAHA DÜZELTMESİ — "Mevcut Topu Buraya Al" + "Manuel Top Ekle" | Y·del 8 | – | 7) manuel top aynı token → aynı top | – |
| 328 | `test_tambur_manual_produce.ts` | Tambur | TAMBUR "MANUEL MOD" — KARTSIZ BİTMİŞ ÜRÜN UCU (HTTP sözleşmesi + KK1 regresyonu) | Y·del 22 | – | G) HTTP aynı token → tek top + idempotentReplay:true; token ZORUNLU (400) | – |
| 329 | `test_tambur_manual_roll.ts` | Tambur | TAMBUR SAHA DÜZELTMESİ — HTTP SÖZLEŞMESİ + REGRESYON | Y·del 11 | – | HTTP aynı token → 201 + tek top; token'sız 400 | var |
| 330 | `test_tambur_over_quantity.ts` | Tambur | Tambur "over-quantity" (çıkan top metresi giriş metresini aşabilir) davranış testi. | Y·del 12 | – | – | – |
| 331 | `test_tambur_plan_gate.ts` | Tambur | Tambur plan-gerçek sapma kapısı + uyumsuz sipariş override zinciri (2026-08-19) | Y·del 16 | F (yalnız fixture paralel) | C6 aynı token kesim replay → sapma defterinde 1 satır | – |
| 332 | `test_tambur_recent_output_filter.ts` | Tambur | F-tablet: Tambur "geçmiş çıktılar" listesi ölü topları göstermesin. | Y·del 2 | – | – | – |
| 333 | `test_tambur_send_to_dye.ts` | Tambur | "Boyahaneye Geri Gönder" — plan-sapma kararının REWORK kolu (2026-08-19) | Y·del 13 | F (yalnız fixture paralel) | – | – |
| 334 | `test_tambur_undo.ts` | Tambur | TAMBUR GERİ AL — 2026-08-09 yeniden yazımı | Y·del 10 | – | – | – |
| 335 | `test_timed_permissions.ts` | Kimlik/Yetki | Süreli izinler (Part C) — validUntil pencereli yetki + oturum tavanı etkisi | Y·del 5 | – | – | – |
| 336 | `test_timestamptz_contract.ts` | Altyapı/Ops | TIMESTAMPTZ SÖZLEŞMESİ — "tarih kolonu MUTLAK AN saklar" garantisinin bekçisi | R | – | – | – |
| 337 | `test_traveler_card_a5_batches.ts` | İş emri/Rota/Refakat | Refakat kartı — A5 varsayılan + yoğunluk profili + CANLI parti bloğu | Y·del 7 | – | – | – |
| 338 | `test_traveler_card_fields.ts` | İş emri/Rota/Refakat | Refakat kartı — ALAN BAZLI görünürlük + punto + kalınlık (tek tablo) | – | – | – | – |
| 339 | `test_traveler_card_stale.ts` | İş emri/Rota/Refakat | Refakat kartı "bayat" bayrağı (TravelerCard.contentDirty) | Y·del 8 | – | – | – |
| 340 | `test_traveler_card_versions.ts` | İş emri/Rota/Refakat | Refakat kartı VERSİYON GEÇMİŞİ (2026-08-17) | Y·del 7 | – | – | – |
| 341 | `test_traveler_print_active_card.ts` | İş emri/Rota/Refakat | TravelerCard tek-ACTIVE-kart invariant'ı (partial unique) | Y·del 4 | **Y** 2× card.print → ikisi ok, AYNI kart, 1 ACTIVE | print sıralı/paralel idempotent (aynı kart) | – |
| 342 | `test_traveler_scan_dedup.ts` | İş emri/Rota/Refakat | Refakat kartı okutma dedup'u (İdempotency denetimi Faz 3). | Y·del 5 | – | aynı kart+istasyon+tip 10 sn → cached scan | – |
| 343 | `test_traveler_template.ts` | İş emri/Rota/Refakat | Refakat kartı ŞABLONU — üç kademe + dondurma + sanitizasyon (Faz 2) | Y·del 5 | – | – | – |
| 344 | `test_turkish_search_fold.ts` | Master-data/Arama/İçe aktarım | Türkçe-duyarsız arama UÇTAN UCA (2026-08-19 — yeniden yazıldı) | Y·del 3 | – | – | – |
| 345 | `test_user_default_perms.ts` | Kimlik/Yetki | Yeni kullanıcı varsayılan üretim izinleri (createUser) | Y·del 2 | – | – | – |
| 346 | `test_user_lifecycle.ts` | Kimlik/Yetki | Kullanıcı yaşam döngüsü — pasife alma (GERİ ALINABİLİR) vs silme (KALICI) | Y·del 2 | – | – | – |
| 347 | `test_wip_scorecard.ts` | Rapor/Tutarlılık | NEREDE TAKILDI (WIP) KARNESİ | Y·del 5 | – | – | – |
| 348 | `test_wo_branch_redye.ts` | Parti | Partiyi yeni iş emrine ayır — RE-DYE (Faz B2, boyandıktan sonra). | Y·del 15 | – | – | – |
| 349 | `test_wo_branch_split.ts` | Parti | Partiyi yeni iş emrine ayır (Faz B1 — boyanmadan). | Y·del 15 | – | – | – |
| 350 | `test_wo_cancel_disposition.ts` | İş emri/Rota/Refakat | İŞ EMRİ İPTALİ — karar vererek (ham stok / fire / hatalı kayıt) | Y·del 8 | – | – | – |
| 351 | `test_wo_cancel_fason.ts` | İş emri/Rota/Refakat | Fasonda top varken iş emri İPTAL EDİLEBİLİR (2026-08-17) | Y·del 8 | – | – | – |
| 352 | `test_wo_fason_quick_receive.ts` | İş emri/Rota/Refakat | Kapatmayı engelleyen fason yükü TEK adımda kabul edilir (2026-08-17) | Y·del 14 | – | – | – |
| 353 | `test_wo_input_attach_window.ts` | İş emri/Rota/Refakat | "Üretime giren" sayımı attach anına çekildi (feat/wo-input-at-attach) | Y·del 15 | – | – | – |
| 354 | `test_wo_input_detach_reattach.ts` | İş emri/Rota/Refakat | detach→reattach bayat-sayım kusuru düzeltildi (feat/wo-input-at-attach) | Y·del 8 | – | – | – |
| 355 | `test_wo_manual_complete.ts` | İş emri/Rota/Refakat | İş emri MANUEL KAPATMA + KAPANIŞ DİSPOZİSYONU — completeWorkOrder + preview. | Y·del 12 | – | – | – |
| 356 | `test_wo_route_coverage_goods.ts` | İş emri/Rota/Refakat | ROTA KAPSAMASI — "mal zaten öyle geliyorsa" muafiyeti (2026-08-27) | Y·del 14 | – | – | – |
| 357 | `test_wo_target_color_guard.ts` | İş emri/Rota/Refakat | Üretim rengi değişikliği — TEK BEKÇİ (2026-08-21) | Y·del 26 | F (yalnız fixture paralel) | – | var |
| 358 | `test_wo_terminal_guard.ts` | İş emri/Rota/Refakat | WorkOrder durum yazımı TERMİNAL GUARD taşımak zorunda (2026-08-09) | – | – | – | var |
| 359 | `test_wo_warehouse_attach.ts` | İş emri/Rota/Refakat | Faz 4 — WO artık WAREHOUSE/A1_STOCK topu da alır ("her işlem final üretir": bir depo | Y·del 7 | – | – | – |
| 360 | `test_work_session.ts` | Cihaz/Oturum | Çalışma Oturumu (WorkSessionService) — open/close/takeover/idle/force-close | Y·del 3 | **Y** 2× session.open aynı makine → tam 1 kazanan | 10) closeForDevice LOGOUT idempotent | – |
| 361 | `test_work_session_close_all.ts` | Cihaz/Oturum | kalıntı çalışma oturumu öz-onarımı + logout kapatma davranışı | Y·del 5 | – | – | – |
| 362 | `test_work_session_stamping.ts` | Cihaz/Oturum | Üretim atfı damgalama (Faz 2) — oturum makinesi op/movement/roll'a akar | Y·del 11 | – | – | – |
| 363 | `test_workorder_documents.ts` | İş emri/Rota/Refakat | İş emri belge listesi — GET /work-orders/:id/documents | R | – | – | – |
| 364 | `test_workorder_order_link.ts` | İş emri/Rota/Refakat | Sipariş bağlama MİRAS ALMAZ + renk/en değişimi izli (2026-08-17) | Y·del 19 | F (yalnız fixture paralel) | – | – |
| 365 | `test_workorder_search.ts` | İş emri/Rota/Refakat | İş emri araması — sipariş no path'i (WorkOrderService.findAll) | Y·del 2 | – | – | – |
| 366 | `test_workstation_permission.ts` | Kimlik/Yetki | `settings:workstation` (Bu Bilgisayar / yerel donanım ayarları) | – | – | – | – |

---

## 2. EŞZAMANLILIK BEKÇİLERİ

`grep -lE 'Promise\.(all|allSettled)\('` → **37 dosya**; her biri açıldı. Sınıflandırma: **27 dosya / 33 sonda gerçek paralel YAZMA**, 9 dosya yalnız fixture'ı paralel yaratıyor (yarış değil), 1 dosya paralel okuma. Ayrıca Promise.all içermeyen **3 kilit-SIRASI/yeri bekçisi** var (§2b).

### 2a. Gerçek paralel yazma sondaları (27 dosya)

| # | Dosya:satır | Yol (src) | N | Beklenti (aynen) | Ölçtüğü | Koruma mekanizması (src) |
|---|---|---|---|---|---|---|
| 1 | `test_admin_guard_race.ts:121-133` | `PermissionManagementService.deactivateUser` | 2 | **tam 1** fulfilled + **tam 1**×409 + aktif admin ≥1 | DAVRANIŞ | advisory `PERM_ADMIN_LOCK` — `permission-management.service.ts:609` |
| 2 | `test_audit_followups.ts:101-108` | `DeviceService.announce` (aynı deviceId) | 2 | **≥1** başarı + `Device` satırı ===1 | DAVRANIŞ (benzersizlik; "tam 1" DEĞİL) | `deviceId` unique + upsert |
| 3 | `test_barcode_reservation.ts:287-301` | `reserveRollBarcodes(prisma,"F",3)` | 20 (×3) | 60 barkod, **hiç mükerrer yok**, 1..60 boşluksuz, parti içi ardışık | DAVRANIŞ (tümü başarılı + benzersiz) | `roll_barcode_counters` satır kilidi (tek ifade) |
| 3b | `test_barcode_reservation.ts:357-369` | `productionFlow(800)` (rezervasyon + tx) | 30 | **30/30** tamamlandı (havuz sağlığı T2; tx-içi havuz client'ı varyantında 3/30 ölçülmüştü) | DAVRANIŞ (havuz) | rezervasyon tx-ÖNCESİ |
| 4 | `test_backup.ts:315-317` | `BackupService.runBackupJob` | 2 | **tam 1** "sürüyor" reddi | DAVRANIŞ | bellek `running` bayrağı (tek process) |
| 5 | `test_direct_ship_scenarios.ts:263-277` | `SubcontractorService.executeDirectShip` (aynı dispatch) | 2 | fulfilled **≥1** ve toplam 2; top **TAM BİR KEZ** CONSUMED + tek `SUBCONTRACTOR_RETURNED` op + tek `DirectShipment` | DAVRANIŞ (invariant; ok sayısı serbest — "1 reject VEYA 2 idempotent") | `directShippedAt` claim + idempotent-cached dal |
| 6 | `test_db_copy_single_start.ts:62-73` | `startCopyJob` (sahte `run`, yavaş `list`) | 2 | **tam 1** `started`, `runCount===1`, kaybeden "Zaten bir kopya" | DAVRANIŞ | bellek claim (TOCTOU penceresi 60 ms gecikmeyle modellenir) |
| 7 | `test_dispatch_claim_step_match.ts:106-115` | `sub.dispatch` — aynı serbest top, İKİ WO (autoAttach steal) | 2 | **tam 1** ok + **tam 1** red; top tek WO'da, AT_SUBCONTRACTOR | DAVRANIŞ | atomik claim |
| 7b | `test_dispatch_claim_step_match.ts:124-134` | `sub.dispatch` — aynı bağlı top, aynı adım | 2 | **tam 1** ok + 1 red; 1 `dispatchItem` | DAVRANIŞ | claim `count` guard |
| 8 | `test_fason_receive_idempotency_concurrency.ts:121-129` (IC2) | `sub.receive` aynı payload (token'sız) | 2 | born ===1, aktif receipt ===1, r1 tek kez CONSUMED — **ok sayısı ÖLÇÜLMEZ** ("kaybeden 409 VEYA cached") | DAVRANIŞ (invariant) | atomik claim + tam-küme replay guard |
| 9 | `test_item_code_autogen.ts:100-107` | `ItemService.create` (otomatik STK- kod) | 2 | **ikisi de** başarılı, kodlar farklı | DAVRANIŞ (benzersizlik) | kod sayacı |
| 10 | `test_kursun_bypass.ts:1136-1163` (10a) | `bypassSvc.assign` aynı WO, iki makine | 2 | atama satırı ===1, açık atama ===1, **yalnız 1 yaratıldı** (diğeri taşıma ya da 409) | DAVRANIŞ | partial unique + taşıma dalı |
| 10b | `test_kursun_bypass.ts:1178-1188` | ham `kursunBypassAssignment.create` | 2 | **tam 1** ok + kaybeden **P2002** `kursun_bypass_one_pending_per_step_uq` | DB SEDDİ (VARLIK, davranışla) | partial unique index |
| 11 | `test_kursun_unassigned_close.ts:555-578` (8f-8h) | `bypassSvc.completeFromTambur` | **3** | **tam 1** gerçek taşıma (`movedRollCount>0`); top başına TEK giriş hareketi | DAVRANIŞ | `closeBypassMovementsTx` `exitedAt IS NULL` guard'ı |
| 12 | `test_item_code_case_uniqueness.ts:533-547` (§9) | `itemService.create` — 5 harf-varyantı kod | **5** | **tam 1** geçti, kalan 4 → 409 | DAVRANIŞ | advisory `CODE_UNIQUE_LOCK` — `helpers/code-unique.helper.ts:81` (dolaylı) |
| 13 | `test_kk1_duplicate_guard.ts:286-323` (§9) | `InventoryService.createInitialEntry` — farklı token, AYNI damga | **5** | **tam 1** geçti + **tam 4**×409 `POSSIBLE_DUPLICATE` ("TOCTOU açıksa 5 olur") | DAVRANIŞ (+ negatif sonda S1: kilit silinince 3/5 geçti, `:48`) | advisory 8021 — `inventory.service.ts:844`; bayrak `kk1.duplicateGuardEnabled` (varsayılan KAPALI, bekçi açarak ölçer) |
| 14 | `test_phase4_fason_hardening.ts:111-118` | `OrderService.manualComplete` | 2 | **tam 1** ok + **tam 1**×409 | DAVRANIŞ | `{id,status}` claim |
| 15 | `test_phase3_stok_hardening.ts:130-134` | `WorkOrderService.lockWorkOrder` | 2 | **tam 1** + **tam 1**×409 | DAVRANIŞ | claim |
| 16 | `test_p2_infra.ts:53-63` (F20) | `reserveLoginAttempt` (bellek, DB yok) | **200** | **tam 5** serbest, 195 blok | DAVRANIŞ (tam N; tek process bellek — fiilen senkron mikro-görev) | in-memory atomik rezervasyon |
| 16b | `test_p2_infra.ts:84-90` | aynı, kilit kapalı | 50 | hepsi serbest | no-op kanıtı | — |
| 17 | `test_phase1_uretim_hardening.ts:109-117` | `WorkOrderService.softDelete` | 2 | **tam 1** + **tam 1**×409, son durum CANCELLED | DAVRANIŞ | claim |
| 18 | `test_phase5_kartela_hardening.ts:70-74` | `OrderService.reopen` | 2 | **tam 1** + **tam 1**×409 | DAVRANIŞ | claim |
| 19 | `test_race_conditions.ts:128-149` (B) | `executeDirectShip` — iki dispatch, aynı sipariş satırı (over-coverage) | 2 | **tam 1** fulfilled + 1 rejected; kaybeden **zarif 409 (P2002 sızmadı)**; `shippedQty ≤ 100` ve ===80 | DAVRANIŞ | satır kilidi altındaki kapasite kontrolü + `withBarcodeRetry` (test yorumu `:138-140`) |
| 19b | `test_race_conditions.ts:159-183` (D) | `executeDirectShip` aynı dispatch çifte-ateş | 2 | **tam 1** gerçek sevk + **tam 1** zarif kayıp (409 veya `alreadyDirectShipped`); tek DSK; `directShippedAt` set | DAVRANIŞ | claim + idempotent dal |
| 19c | `test_race_conditions.ts:196-211` (C) | `receive(D1)` ‖ `dispatch(D2)` aynı adım | 2 | invariant: WO COMPLETED ⇒ adımda AT_SUBCONTRACTOR top YOK | DAVRANIŞ (invariant; sonuçlar ölçülmez) | — |
| 20 | `test_phase2_broad_hardening.ts:122-131` | `TravelerCardService.voidCard` | 2 | **tam 1** + **tam 1**×409 | DAVRANIŞ | claim |
| 21 | `test_phase6_reporterror_concurrency.ts:102-111` | `TamburService.reportError` (aynı top+metre+tip) | 2 | **tam 1** + **tam 1**×409 + DB'de tek `RollError` | DAVRANIŞ + DB seddi | partial unique |
| 22 | `test_roll_barcode.ts:48-51` | `generateRollBarcode(prisma,"H")` | 20 | 20 benzersiz | DAVRANIŞ (benzersizlik) | sayaç |
| 23 | `test_shipment_scope_lock.ts:148-161` (§3) | `shippingService.undoDispatch` ‖ `returnService.createReturn` | 2 | **yasak durum yok** (PLANNED ∧ aktif iade>0 olamaz) + **en az biri** reddedildi | DAVRANIŞ (invariant) — dosya kendi itirafıyla asıl kontrolü §1 SIRA'dır (`:24-26`) | advisory `SHIPMENT_LOCK_NS` — `helpers/shipment-locks.helper.ts:58` |
| 24 | `test_sack_status_invariant.ts:172-186` (§2) | `kartelaService.dispatch` ‖ `shippingService.scanIntoSack` aynı top | 2 | **tam 1** akış başarılı + son durum tutarlı (ya AT_KARTELA+çuvalsız ya WAREHOUSE+çuvalda) | DAVRANIŞ | claim katmanı |
| 25 | `test_traveler_print_active_card.ts:99-106` (C) | `cards.print` aynı WO | 2 | **ikisi de** başarılı, **AYNI kart**, DB'de tek ACTIVE | DAVRANIŞ (idempotent yarış; P2002→retry→mevcut kart) | `workOrderId @unique` + `withBarcodeRetry` |
| 26 | `test_work_session.ts:116-130` (5) | `WorkSessionService.open` aynı makine, iki cihaz | 2 | **tam 1** kazanan; kaybeden P2002→"tekrar deneyin" YA DA `MACHINE_OCCUPIED` (ikisi de kabul) | DAVRANIŞ | unique + precheck |
| 27 | `test_tambur_cut_idempotency.ts:119-125` (B) | `tambur.cutWarehouseRoll` AYNI clientToken | 2 | **ikisi de** fulfilled (1 fresh + 1 idempotent), tek child, parent 1 kez düşüldü (100→70) | DAVRANIŞ (idempotent yarış) | child `clientToken @unique` + P2002 geri sarma |

**N dağılımı:** N=2 → 24 sonda · N=3 → 1 · N=5 → 2 · N=20 → 2 · N=30 → 1 · N=50/200 → 2 (bellek). **"tam 1 (ya da tam N) başarı" bekleyen:** 1, 4, 6, 7, 7b, 10, 10b, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19b, 20, 21, 24, 26 → **21 sonda**. **Yalnız invariant / ≥1:** 2, 5, 8, 19c, 23 → 5. **"Tümü başarılı + benzersiz / idempotent":** 3, 3b, 9, 22, 25, 27 → 6. Hiçbir sonda yarış penceresini **gecikme enjeksiyonuyla** genişletmez (yalnız `test_db_copy_single_start.ts:51` sahte `list`'e 60 ms koyar); `test_shipment_scope_lock.ts:24-26` bunun sonucunu kendisi yazar: "davranış sondası dar pencerede çoğu zaman yeşil kalır".

### 2b. Kilit SIRASI / YERİ bekçileri (Promise.all'suz)

| Dosya:satır | Ne ölçüyor | Yöntem | Kaynak kilit |
|---|---|---|---|
| `test_batch_number_format.ts:60-66, 79, 208-224` | `generateBatchNumberTx` içinde advisory kilidin **ilk çağrı** olduğu (`calls[0] === lock(8022,1)`) + namespace ≠ 8021 + SQL süzgecinin ürünün KENDİ deseniyle uygulanması | **sahte tx** (DB'ye YAZMAZ), çağrı sırası kaydı | `batch.service.ts:126` (`BATCH_NUMBER_LOCK_NS`) |
| `test_shipment_scope_lock.ts:57-88` (§1) | `undoDispatch` gövdesinde `lockShipmentScopeTx(` indeksi < `rollReturn.count(` < `shipment.updateMany(`; `createReturn` tx'inde kilit < `roll.updateMany(` | **kaynak metni** `indexOf` | `shipping.service.ts` `undoDispatch` / `return.service.ts` `createReturn`; `shipment-locks.helper.ts:58` |
| `test_shipment_scope_lock.ts:93-117` (§2) | namespace'ler ayrı (≠8021, ≠8022); 2-argümanlı form; **src genelinde 1-argümanlı `pg_advisory_xact_lock(hashtext` KALMADI** | sabit karşılaştırma + src ağacı taraması | tüm kilit noktaları |
| `test_barcode_reservation.ts:41-62` | Barkodu hâlâ **tx İÇİNDE** alan yolların iki yönlü listesi (`KNOWN_TX_INTERNAL`: inventory ×2, subcontractor ×2, batch-drop, roll-finalize, roll-disposition) — yeni tx-içi çağrı da, listeden düşürülmemiş düzeltme de kırmızı | kaynak taraması | sayaç satır kilidi süresi |
| `test_order_line_scope_single_source.ts:44` | `order.service.ts`'teki ham `SELECT … FOR UPDATE` **muaf listesinde** (metin VARLIĞI; davranış sondası yok) | AST/metin | `order.service.ts:2434` |
| `test_shipment_list_gross.ts:243-244` | Sevkiyat listesi agregat tx gövdesinde `"RepeatableRead"` metni var | metin VARLIĞI | `shipping.service.ts:2610` (KUNYE'deki tek `isolationLevel`) |

### 2c. Yalnız fixture'ı paralel yaratanlar (yarış DEĞİL) ve paralel okuma

`test_filter_multi_select.ts:90,96` · `test_hide_cancelled_lists.ts:88,96,104` · `test_order_filter_batch_check.ts:95,99` · `test_sack_mismatch.ts:52` · `test_station_capability.ts:61,75` · `test_tambur_send_to_dye.ts:56` · `test_tambur_plan_gate.ts:64,69` · `test_wo_target_color_guard.ts:164` · `test_workorder_order_link.ts:62,74` — hepsi `prisma.<model>.create` ile master-data fixture'ı paralel açar (havuz client'ı, meşru). `test_production_flow_columns.ts:35` üç `count` paralel okur.

### 2d. Promise.all'suz ama "yarış/kilit" anlatan 17 dosya — bayat yorum tespiti

`grep -liE 'yarış|race|eşzamanl|paralel|concurren'` 45 dosya; 17'si paralel çağrı içermiyor. Çoğu meşru açıklama, **üçü kodla çelişen yorum** taşıyor:

| Dosya:satır | Yorum ne diyor | Kod ne diyor |
|---|---|---|
| `test_batch_k15_merge.ts:131-137` | "`generateBatchNumberTx` … **kilit almaz** … iki taraf aynı P kodunu hesaplar → **`@unique` ihlali (P2002)** … `withBarcodeRetry` ŞART" | `batch.service.ts:126` ilk ifade `pg_advisory_xact_lock(8022,1)`; `batches.batchNumber @unique` **kaldırıldı** (kök CLAUDE.md 2026-08-05, migration `20260805120000`) → P2002 artık oluşamaz, `withBarcodeRetry` bu yolda hiçbir şey korumuyor |
| `test_k14_lock_edges.ts:84-85` | aynı cümle ("kilitsiz max+1 okur … P2002 düşer") | aynı |
| `test_traveler_card_stale.ts:58-61` | "parti no GÜNLÜK SEKANS'tır … çıplak çağrı `batchNumber` unique çakışmasına düşer" | varsayılan rejim kısa dönen `P01…P99`, unique yok |

### 2e. Kilit noktası ↔ bekçi eşlemesi (src'deki 7 çağrı noktası + FOR UPDATE + isolationLevel)

| src kilit noktası | Bekçi | Ölçüm biçimi |
|---|---|---|
| `inventory.service.ts:844` advisory 8021 (KK1 mükerrer tuzağı) | `test_kk1_duplicate_guard.ts:286` | DAVRANIŞ (5→1) + negatif sonda |
| `batch.service.ts:126` advisory 8022 (parti no) | `test_batch_number_format.ts:208-224` | SIRA (sahte tx) — **gerçek DB paraleli YOK** |
| `helpers/code-unique.helper.ts:81` advisory (kod tekilliği) | `test_item_code_case_uniqueness.ts:533` | DAVRANIŞ (5→1, dolaylı) |
| `helpers/shipment-locks.helper.ts:58` advisory (sevkiyat kapsamı) | `test_shipment_scope_lock.ts:57-88, 148` | SIRA + DAVRANIŞ(invariant) |
| `permission-management.service.ts:609` advisory (son-admin) | `test_admin_guard_race.ts:121` | DAVRANIŞ (2→1) |
| `session-registry.service.ts:79` advisory (kullanıcı×cihaz-tipi) | **YOK** (`test_session_registry.ts` paralel çağrı içermiyor) | — |
| `master-data-merge.service.ts:546` advisory `MERGE_LOCK` | **YOK** (`test_master_data_merge*.ts`, `test_merge_field_picks.ts` paralel/kilit ölçmüyor) | — |
| `order.service.ts:2434` `FOR UPDATE` | `test_order_line_scope_single_source.ts:44` | yalnız metin muafı (VARLIK) |
| `shipping.service.ts:2610` `RepeatableRead` | `test_shipment_list_gross.ts:243-244` | metin VARLIĞI |

`withBarcodeRetry`'ın gerçek **P2002 dalı** üç bekçide fiilen tetiklenir: `test_traveler_print_active_card.ts:97-106`, `test_race_conditions.ts:138-144, 165`, `test_work_session.ts:124-130` (DIP §7.7 karşı-örneği: yol test EDİLEBİLİR).

---

## 3. IDEMPOTENCY BEKÇİLERİ

`clientToken` geçen **20 dosya**; idempotency SÖZLEŞMESİ ölçen (clientToken'sız mekanizmalar dahil) **25 dosya**. Replay dört durumu (kayıt var-geçerli · kayıt var-İPTAL · token yok · token var-farklı payload) tabloda "durum" sütununda.

| # | Dosya:satır | Yol | Senaryo | Beklenti | Durum(lar) |
|---|---|---|---|---|---|
| 1 | `test_client_token_idempotency.ts:81-92` (CT1) | `OrderService.create` | aynı token 2×; farklı payload | aynı id, `count(token)===1`; farklı payload → 409 | geçerli-replay · farklı payload |
| 2 | `…:103-111` (CT2) | `quickOrder` | aynı token 2× | tek sipariş | geçerli-replay |
| 3 | `…:119-132` (CT3) | `WorkOrderService.create` | aynı token; farklı `targetItem` | aynı id + TEK refakat kartı; 409 | geçerli-replay · farklı payload |
| 4 | `…:143` (CT4) | `quickStart` | aynı token | aynı WO, `isActive===true` kalır (hardDelete regresyonu) | geçerli-replay |
| 5 | `…:167-174` (CT5) | `KartelaService.reduceStock` | aynı token | N iptal (2N değil) + tek `SwatchStockReduction` | geçerli-replay |
| 6 | `…:182-189` (CT6) | `hardDelete` → `create` | zero-attach telafisi sonrası aynı token | token NULL'lanır, taze create BAŞARIR | token serbest bırakma |
| 7 | `test_kk1_duplicate_guard.ts:224-246` (§7) | `createInitialEntry` | aynı token | tuzak değil idempotent yol: cached top | geçerli-replay |
| 8 | `test_p1b_barcode_collision.ts:54-96` | `createInitialEntry` | aynı token + aynı payload / farklı ürün / farklı metre | idempotent aynı id; 409 `CLIENT_TOKEN_COLLISION`; DB'de tam 1 Roll | geçerli-replay · farklı payload |
| 9 | `test_manual_roll_undo.ts:27, 94` ([5]) | manuel top → iptal → replay | **iptal edilmiş** kaydın token'ı | replay EDİLEMEZ (409 `ENTRY_CANCELLED`) | **iptal-sonrası replay (tek örnek)** |
| 10 | `test_fason_partial_receive.ts:144-148` (P3) | `sub.receive` kısmi | aynı token | cached makbuz (yeni makbuz/doğum yok) | geçerli-replay |
| 11 | `test_fason_receive_idempotency_concurrency.ts:109-110` (IC1) | `sub.receive` | aynı payload 2× (token'sız küme eşitliği) | ikinci cached, receipt=1, born=1 | geçerli-replay |
| 12 | `test_fason_kabul_partial_overlap.ts:6-9` | `sub.receive` | tam-küme replay / kısmi örtüşme / ayrık küme | cached · cached DÖNMEZ → 409 · normal kabul | farklı payload (küme) |
| 13 | `test_import_framework.ts:304-311` (#10) | `ImportService.apply` | aynı token | ikinci kez YAZMAZ (1 satır) | geçerli-replay |
| 14 | `test_mobile_order_permission.ts:164-186, 230-233` | `POST /orders` (HTTP) | aynı token; 4xx sonrası | mükerrer sipariş yok; **4xx'te istemci token'ı tazeler** (yapışkan token döngüsü yok) | geçerli-replay · istemci kuralı |
| 15 | `test_quick_start_wo.ts:193-197` | `quickStart` | aynı token | aynı WO | geçerli-replay |
| 16 | `test_shipping_client_token.ts:40-51, 82-88` | `openSack` / `createShipment` | aynı token 2×; farklı token; token'sız | tek çuval/sevkiyat, aynı `shipmentNo`; yeni; geri uyum | geçerli-replay · token yok |
| 17 | `test_tambur_cut_idempotency.ts:103-104, 119-125, 131-137` | `cutWarehouseRoll` / `cutOpenFabric` | sıralı retry; paralel; token'sız | 1 child, 1 düşüm; token'sız → idempotency YOK (opt-in kanıtı) | geçerli-replay · token yok |
| 18 | `test_tambur_manual_field.ts:202-268` (7) | manuel top ekle | aynı token | AYNI top, `count(token)===1` | geçerli-replay |
| 19 | `test_tambur_manual_produce.ts:303, 476-483` (B,G) | `POST …/tambur/manual/produce` (HTTP) | token'sız; aynı token | 400 (token ZORUNLU); 201 + tek top + `idempotentReplay:true` | token yok · geçerli-replay |
| 20 | `test_tambur_manual_roll.ts:407, 632-644` | `POST …/manual/roll` (HTTP) | token'sız; aynı token | 400; 201 + tek top | token yok · geçerli-replay |
| 21 | `test_tambur_plan_gate.ts:265-278` (C6) | `cutOpenFabric` + `confirmMismatch` | aynı token replay | sapma defterinde **1** satır ("2 ise tx bağı kopmuş") | geçerli-replay (yan defter) |
| 22 | `test_tambur_manual_batch.ts:32` | manuel top parti bağı | hata FAZ 1'den önce | token temiz kalır, tekrar denenebilir | hata sonrası token |
| 23 | `test_qc2_idempotency.ts:1` | `completeQc2` `@@unique` | çift çağrı (token'sız) | tek `QC2_COMPLETED` op | mekanizma (unique) |
| 24 | `test_traveler_scan_dedup.ts:1-3` | kart okutma | aynı kart+istasyon+tip 10 sn | cached scan, audit yok; farklı tip → yeni | zaman-pencereli dedup |
| 25 | `test_traveler_print_active_card.ts:92-106` · `test_kursun_bypass.ts:1124` (9h `alreadyDone`) · `test_work_session.ts:10` (LOGOUT idempotent) · `test_audit_followups.ts:97-108` (announce upsert) · `test_direct_ship_scenarios.ts:269` (`alreadyDirectShipped`) | çeşitli | tekrar çağrı | idempotent sonuç | mekanizma |
| — | `test_db_invariants.ts:109, 125, 156, 159` | `rolls/work_orders/orders/swatch_stock_reductions` `clientToken` partial UNIQUE | index VARLIĞI + predicate | envanterle birebir | **VARLIK** |

**Dört-durum kapsaması:** "kayıt var-geçerli" 18 yol · "farklı payload → 409" Roll (8), Order/WO (1, 3), Receipt küme (12) · "token yok" 16, 17, 19, 20 · **"kayıt var-İPTAL edilmiş"** yalnız Roll manuel top (9) — Order/WO/Sack/Shipment/Receipt için iptal-sonrası replay davranışı **bekçisiz** (§8'in "en pahalı hata" sınıfı; ② için işaretli, §HOTSPOT-9).

---

## 4. KAPSAMA BOŞLUKLARI

### 4a. Servis başına bekçi sayısı

Yöntem: `src/services/**/*.ts` (216 dosya) için, testlerde `from "../src/<modül>"` **veya** `import("../src/<modül>")` geçen `test_*.ts` sayısı (`scratchpad/svc_cov.tsv`). ⚠️ Bu sayı **ALT SINIRDIR**: bir servis başka bir servis/HTTP üzerinden dolaylı koşabilir (örn. `workorder-batch-drop.service` → `test_batch_drop.ts` `WorkOrderService` üzerinden; `mobile-update.service` → `test_mobile_update.ts` efemeral `app` üzerinden; `code-unique.helper` → `test_item_code_case_uniqueness.ts` `ItemService` üzerinden). Dolaylı kapsam mekanik ölçülmedi (kapsam dışı — çağrı grafiği gerektirir).

Dağılım (216 dosya): **0 → 41** · 1-2 → 108 · 3-9 → 53 · 10+ → 14.

**Doğrudan bekçisi OLMAYAN 41 dosya** (dolaylı iz, anahtar kelime grep'iyle):

| Dosya | Dolaylı iz (kaç test adını/işlevini anıyor) |
|---|---|
| `helpers/allocation.helper.ts` | `SackAllocation|allocation` 16 test (sevk yolu üzerinden) |
| `helpers/batch-dispatch-surgery.helper.ts` | `splitBatch|mergeBatches|moveRolls` 6 test |
| `helpers/code-unique.helper.ts` | `test_item_code_case_uniqueness` §9 (davranış) |
| `helpers/fason-open-dispatch.helper.ts` | AST bekçi `test_fason_open_dispatch_single_source` + davranış `test_fason_open_dispatch_semantics` (import etmeden) |
| `helpers/order-line-scope.helper.ts` | AST bekçi `test_order_line_scope_single_source` |
| `helpers/sack-invariants.helper.ts` | 5 test anahtar kelime |
| `helpers/subcontractor-cancel.helper.ts` | `cancelDispatch|cancelReceipt` 7 test |
| `helpers/subcontractor-shrink.helper.ts` | `shrink|FASON_CEKME|SUBCONTRACTOR_RETURN` 27 test |
| `helpers/workorder-rolls.helper.ts` | `attachRolls|detachRolls` 15 test |
| `helpers/workorder-clone.helper.ts` | `cloneWorkOrder|TRANSFER` 3 test |
| `helpers/targetable-property.helper.ts` | 1 test |
| `helpers/traveler-card-fanout.helper.ts` | **0** — hiçbir test adını anmıyor |
| `helpers/label-intent.helper.ts` | **0** |
| `helpers/label-html-landscape.helper.ts` | 1 |
| `helpers/raster/raster-barcode.ts`, `raster-render.ts` | raster paketinin diğer testleri üzerinden [VARSAYIM] |
| `document-render/fason-ceki.density.ts`, `free-document.html.ts` | `test_fason_ceki_html`/`test_doc_density_fields` dolaylı [VARSAYIM]; free-document 2 test anıyor |
| `import/adapters/*.adapter.ts` (16 adaptör) + `import-name-guard.ts` + `import.types.ts` | `test_import_framework`/`test_config_bundle` `ImportService.apply` üzerinden ("adapter" 8 test); `import-name-guard` **0** |
| `reports/_breakdown.ts`, `reports/_shipped.ts` | rapor servisleri üzerinden ("_shipped" 2 test anıyor) |
| `mobile-update.service.ts` | `test_mobile_update.ts:150` `app` üzerinden HTTP (37 kontrol) |
| `user-preference.service.ts` | **fiilen bekçisiz** — yalnız `test_record_provenance.ts`'te audit muafiyeti olarak anılıyor |
| `workorder-batch-drop.service.ts` | `test_batch_drop.ts` `WorkOrderService` üzerinden |

**Üst düzey servisler (69, `services/*.service.ts`) — doğrudan import eden bekçi sayısı:**

| n | Servis |
|---|---|
| 0 | mobile-update · user-preference · workorder-batch-drop |
| 1 | backup-impact · backup · customer-alias · customer-standalone-label · dashboard · db-copy-verify · discovery · document-profile · duplicate-detection · duplicate-review · duplicate-rolls · free-document · latency-persist · reason-preset · record-info · search · station · traveler-template · work-session-activity · workorder-split |
| 2 | customer-template-route · db-copy · session-registry · system-log · tambur-undo · workorder-fason-quick |
| 3 | fabric-property · production-balance · subcontractor-management · workorder-link |
| 4 | accounting-export · audit · customer-branch · device · latency-stats · master-data-merge · product-recipe · station-capability |
| 5 | peripheral · sack-search · tambur-manual · workorder-manual-move |
| 6 | base · kartela · kursun-bypass · route · work-session |
| 7 | batch · customer · kursun-qc |
| 8 | color · label-template |
| 9 | item · return |
| 10 | permission-management |
| 14 | auth |
| 19 | printed-document |
| 21 | order · tambur |
| 32 | label · shipping |
| 35 | inventory |
| 36 | system-setting |
| 44 | subcontractor |
| 47 | workorder |
| 48 | traveler-card |

### 4b. Kritik yazma yolları — EŞZAMANLILIK bekçisi VAR / YOK

| Yol | Koruma (src) | Eşzamanlılık bekçisi | Ölçüm | Not |
|---|---|---|---|---|
| **KK1 ham giriş** `createInitialEntry` | advisory 8021 `inventory.service.ts:844` (bayrak `kk1.duplicateGuardEnabled`, varsayılan KAPALI; tuzak `opts.duplicateGuard` ile opt-in) | **VAR** `test_kk1_duplicate_guard.ts:286` (5→tam 1) | DAVRANIŞ | Bayrak KAPALIYKEN yol kilitsizdir; bekçi bayrağı açarak ölçer. İdempotency: `test_p1b_barcode_collision`, §7 |
| Barkod sayacı | `roll-barcode.helper` satır kilidi | **VAR** `test_barcode_reservation.ts:287,357` · `test_roll_barcode.ts:48` | tümü başarılı + benzersiz; tx-öncesi yer listesi | — |
| **Fason sevk** `dispatch` | atomik claim | **VAR** `test_dispatch_claim_step_match.ts:106,124` (tam 1) | DAVRANIŞ | — |
| **Fason kabul (tam)** `receive` | claim + tam-küme replay guard | **VAR (zayıf)** `test_fason_receive_idempotency_concurrency.ts:121` (born=1; ok sayısı ölçülmez) · `test_race_conditions.ts:196` (invariant) | invariant | "tam 1" iddiası yok |
| **Fason KISMİ kabul** (`currentQty` decrement) · kabul iptali (`cancelReceipt` LIFO) · `close-remainder` | ? | **YOK** (`test_fason_partial_receive`, `test_fason_receive_cancel_rereceive`, `test_k14_lock_edges` sıralı) | — | — |
| **Fasondan doğrudan sevk** `executeDirectShip` (+ over-coverage) | `directShippedAt` claim + satır kilidi altındaki kapasite + `withBarcodeRetry` | **VAR** `test_race_conditions.ts:128,159` (tam 1) · `test_direct_ship_scenarios.ts:263` | DAVRANIŞ | — |
| **Tambur kesim** `cutWarehouseRoll/cutOpenFabric` | child `clientToken @unique` + P2002 geri sarma | **VAR (yalnız aynı token)** `test_tambur_cut_idempotency.ts:119` | idempotent yarış | **Farklı token + aynı parent** paralel kesim (metraj aşımı yarışı) YOK |
| **Tambur geri alma** (`tambur-undo.service`) | ? | **YOK** (`test_tambur_undo` sıralı) | — | — |
| **Tambur finalize / WO kapama** (`completeWorkOrderIfStepsDone`) | terminal guard | **YOK** (`test_tambur_finalize_wo_guard` sıralı) | — | — |
| Tambur hata kaydı `reportError` | partial unique | **VAR** `test_phase6_reporterror_concurrency.ts:102` | DAVRANIŞ + DB seddi | — |
| Kurşun bypass atama / dağıtımsız kapanış | partial unique; `exitedAt IS NULL` | **VAR** `test_kursun_bypass.ts:1136,1178` · `test_kursun_unassigned_close.ts:555` (3→1) | DAVRANIŞ | — |
| KK2 `completeQc2` | `@@unique` | idempotency SIRALI (`test_qc2_idempotency`); paralel **YOK** | — | — |
| **Çuval**: `scanIntoSack` ‖ kartela `dispatch` | claim | **VAR** `test_sack_status_invariant.ts:172` (tam 1) | DAVRANIŞ | Aynı topu iki ÇUVALA okutma / `openSack` çift / çuval kapatma paralel **YOK**; `openSack` yalnız sıralı token testi |
| **Sevkiyat oluşturma** `createShipment` (`shipping.service.ts:1376`) · **sevk onayı** `dispatchShipment` (`:1890`, PLANNED→DISPATCHED) | claim [VARSAYIM] | **YOK** (yalnız `test_shipping_client_token` sıralı replay) | — | En yüksek para/stok etkili yol bekçisiz |
| **Storno** `undoDispatch` (`:2141`) ‖ **iade** `createReturn` | advisory `shipment-locks.helper.ts:58` | **VAR** `test_shipment_scope_lock.ts:148` (+ SIRA `:57-88`) | SIRA + invariant | iade×iade, storno×storno paralel **YOK** |
| **Sipariş bağla** (`linkOrderLines`) / bağ sök / **sipariş iptali** / **kalem iptali** | `order.service.ts:2434` FOR UPDATE (kalem silme) | **YOK** (`test_workorder_order_link`, `test_order_line_cancel`, `test_order_cancel_card_dirty` sıralı) | metin muafı yalnız | — |
| Sipariş `manualComplete` / `reopen` / `create` idempotency | claim / token | **VAR** `test_phase4:111`, `test_phase5:70`, CT1 | DAVRANIŞ | — |
| **İş emri kapanış dispozisyonu** `completeWorkOrder` | ? | **YOK** (`test_wo_manual_complete`, `test_wo_cancel_disposition` sıralı) | — | — |
| İş emri `softDelete` / `lockWorkOrder` / `create` / `voidCard` / `print` | claim, unique | **VAR** phase1/phase3/CT3/phase2/`traveler_print_active_card` | DAVRANIŞ | — |
| **Parti no** `generateBatchNumberTx` | advisory 8022 `batch.service.ts:126` | **VAR (SIRA, sahte tx)** `test_batch_number_format.ts:208-224` | SIRA | **Gerçek DB'de paralel parti doğumu sondası YOK**; 3 testte bayat "P2002/kilitsiz" yorumu (§2d) |
| Parti cerrahisi (`splitBatch/mergeBatches/moveRolls`) | ? | **YOK** | — | — |
| Master-data **kod tekilliği** | advisory `code-unique.helper.ts:81` | **VAR (dolaylı)** `test_item_code_case_uniqueness.ts:533` (5→1) | DAVRANIŞ | — |
| **Master-data birleştirme** (`merge`) | advisory `master-data-merge.service.ts:546` | **YOK** | — | grep `pg_advisory` ile "koruma var" tuzağı |
| **İçe aktarım** `ImportService.apply` | `clientToken` | idempotency SIRALI (`test_import_framework.ts:304`); paralel **YOK** | — | — |
| **Yetki**: son-admin | advisory `permission-management.service.ts:609` | **VAR** `test_admin_guard_race.ts:121` | DAVRANIŞ | `grant/revoke/set/applyTemplate` paralel **YOK** |
| Oturum defteri (`session-registry`) | advisory `session-registry.service.ts:79` | **YOK** | — | — |
| Login lockout (bellek) | in-memory rezervasyon | **VAR** `test_p2_infra.ts:53` (200→tam 5) | DAVRANIŞ | tek process varsayımı |
| Çalışma oturumu `open` | unique + precheck | **VAR** `test_work_session.ts:116` | DAVRANIŞ | — |
| Cihaz `announce` · yedek işi · DB kopya işi | upsert · bellek bayrağı · bellek claim | **VAR** `test_audit_followups:101` · `test_backup:315` · `test_db_copy_single_start:62` | DAVRANIŞ | — |
| Refakat kartı okutma dedup | zaman penceresi | SIRALI (`test_traveler_scan_dedup`); paralel **YOK** | — | — |

---

## 5. Mekanik sayılar

| Ölçü | Değer |
|---|---|
| `scripts/test_*.ts` dosya / satır | **366 / 90.047** (tüm `scripts/`: 418 dosya) |
| Assert benzeri çağrı (`check(`/`assert`/`expect`/`ok(` … kaba) | ~7.922 |
| `src/lib/prisma` / `@prisma/client` import eden | **323** (%88) |
| DB'ye YAZAN (create/update/delete/tx) | **293** · yalnız okuyan 30 · HTTP-only (prisma'sız) 3 · saf (DB+HTTP yok) **40** |
| `deleteMany` çağrısı | **2.048 / 278 dosya** (koşucu mesajı: 1.539 / 209 — bayat) |
| `finally` temizlik bloğu | 214 dosya |
| Fixture damgası (`Date.now`/`randomUUID`/`Math.random`/`pid`/`hrtime`) | **280** dosya (Date.now 256; random/uuid 103) |
| `TEST-`/`TST-` önek literal'i | 255 dosya |
| `Promise.all/allSettled` içeren | **37** → gerçek paralel yazma **27 dosya / 33 sonda** · fixture-paralel 9 · okuma 1 |
| "tam 1 / tam N başarı" bekleyen sonda | 21 · invariant/≥1: 5 · tümü-başarılı+benzersiz: 6 |
| Kilit SIRASI/yeri bekçisi (Promise.all'suz) | 3 (+2 metin VARLIĞI) |
| src'deki 7 advisory çağrı noktasından bekçili | **5** (davranış: 8021, code-unique, perm-admin · sıra: 8022, shipment) · bekçisiz **2** (session-registry, merge) |
| `clientToken` geçen / idempotency sözleşmesi ölçen | 20 / **25** |
| "negatif sonda/sınama" notu | **20** dosya (md5 ile geri yükleme disiplini 7) |
| Efemeral Express app (`app.listen(0)`) | 15 dosya; `src/app.ts` job BAŞLATMAZ (`app.ts:12-13` yalnız durum okur; başlatma `server.ts:100-124`) |
| Sunucu/child process spawn eden | 3 (`test_backup`, `test_db_copy`, `test_schema_drift`) |
| Kaynak kodu (src) metin/AST tarayan bekçi | metin 2 + AST (`typescript`) 4 (`test_fason_open_dispatch_single_source`, `test_raw_sql_hygiene`, `test_permission_catalog`, `test_search_field_config`) + indexOf/regex kullanan başkaları (`test_shipment_scope_lock`, `test_barcode_reservation`, `test_order_line_scope_single_source`, `test_wo_terminal_guard`, `test_route_auth_coverage`, `test_client_policy` …) |
| `systemSetting` YAZAN test | 38 |
| Zamanlama duyarlı (`setTimeout`/`sleep`) | 11 |
| `process.env.TZ` ayarlayan | 0 (yalnız `test_e2e_full_flow.ts:11` yorumu `export TZ=UTC` önerir) |

---

## 6. Test hijyeni gözlemleri

| # | Gözlem | Kanıt |
|---|---|---|
| H-1 | **Sessiz temizlik:** `.catch(() => {} / undefined / null)` **150 dosya / 669 satır**. Temizlik FK'ya takılınca hata görünmez → artık birikir. Tip geçidi yalnız *yanlış ilişki adı* sınıfını yakalar (`tsconfig.scripts.json:10-15`), FK sırası hatasını yakalamaz | grep; `run-all-tests.ts:44-48` |
| H-2 | **Dev DB artığı (salt-okunur ölçüm, 2026-08-28):** rolls **48** (IN_PRODUCTION 19, WAREHOUSE 16, …) · work_orders **549 / 762 (%72, hepsi aktif)** · users **44** · batches 21 · stations 9 · customers 9 · items 7 · colors 7 · subcontractors 3 · orders 3. Kaynaklar: `TST-WHA` **480 iş emri** (02→27 Ağu, her koşumda birikmiş) ← `test_wo_warehouse_attach.ts:58-60` yaratır, `:109-118` temizliği **7 adımın hepsi `.catch(() => {})`** (silme sessizce düşüyor); `TEST-IMP-PERM` **41 kullanıcı** ← `test_import_permissions.ts:152` yaratır, `:224` `user.delete(...).catch(() => undefined)`; `TEST-MM` 27 iş emri ← `workOrderNumber` `TEST-MM` `test_consistency.ts` / `test_sack_mismatch.ts`'te [VARSAYIM: hangisi sızdırıyor doğrulanmadı] | `audit/tools/sql-dev.sh` sorguları; dosya satırları |
| H-3 | `clean_test_residue.ts` yalnız **5 önek grubunu** tanır (`:27-31`); `TST-WHA`, `TEST-IMP-PERM`, `TST-FIC`, `TST-TCI`, `TEST-PG`, `TEST-WOLINK`, `TEST-SCOPELOCK` … kapsam dışı → H-2 artığı bu araçla temizlenemez | `clean_test_residue.ts:27-31` |
| H-4 | **Fixture damgalama** iyi: 280/366 dosya damga kullanır; 255 dosya `TEST-/TST-` öneği taşır. **16 dosya öneksiz yazıyor** (`test_data_integrity_gaps`, `test_duplicate_rolls`, `test_manual_move_field_continuity`, `test_master_data_merge`, `test_master_data_merge_conflicts`, `test_merge_field_picks`, `test_mobile_order_permission`, `test_null_quality_visibility`, `test_p2_inventory`, `test_p2_kk2reopen`, `test_printer_transport`, `test_qc2_idempotency`, `test_report_day_boundary`, `test_roll_search_barcode`, `test_similar_names`, `test_traveler_scan_dedup`) — bir kısmı `tst-` küçük harf/başka önek kullanıyor olabilir [VARSAYIM: tek tek açılmadı] | grep |
| H-5 | **Ortama bağımlılık:** 67 dosya `code:"PATOS"`, 110 dosya `username:"admin"` (seed business-key; dev DB prod kopyası olduğundan `admin` fabrikanın hesabıdır — yalnız id okunur, şifreye dokunulmaz); 24 dosya / 38 satır `findFirst()` "herhangi bir kayıt"; `test_qc2_idempotency.ts:22-25` ortamdaki gerçek `QC2_COMPLETED` op'unu kullanır | grep; CLAUDE.md "Test Scriptleri" |
| H-6 | **Paylaşımlı global durum:** 38 test `systemSetting` yazar (feature flag); koşucu sıralı olsa da (a) aynı DB'de çalışan dev sunucusunun bellek-içi flag önbelleği ile, (b) elle paralel koşumla çakışır — `fixture-subcontractor.ts:31-33` "tek tek elle koşturma paraleldir" diye bu riski adıyla yazar | grep; `fixture-subcontractor.ts:31-33` |
| H-7 | **Prod kapısı yalnız koşucuda** (§0): tek dosya koşumu (`npx tsx scripts/test_X.ts` — CLAUDE.md'nin önerdiği normal yol) kapısızdır; kapı **host adına** bakar (`localhost` port-yönlendirme/SSH tüneli geçer); `0.0.0.0` allowlist'te; mesajlardaki sayılar bayat | `run-all-tests.ts:102-165` |
| H-8 | **Negatif sonda kültürü** var ama dosya içi not yalnız 20 dosyada; CLAUDE.md'de başka bekçiler için de "negatif sondayla kırmızı verdiği doğrulandı" yazıyor (ör. `test_timestamptz_contract`, `test_document_template_permission`, `test_traveler_card_stale`) — kanıt dosyada değil notta | grep; kök CLAUDE.md |
| H-9 | **Zaman aşımı/flake:** 180 sn tek tavan; en uzun dosyalar `test_kursun_bypass.ts` (1.190+ satır), `test_performance.ts` (5.000 satır createMany), `test_e2e_full_flow`; süre ölçülmedi (koşum yok). Windows yetim süreç notu `run-all-tests.ts:221-225` | dosya boyları |
| H-10 | Test dosyaları **kendi `check()`/`expectErr()` yardımcılarını** her dosyada yeniden tanımlar (paylaşımlı test harness yok — `jest/vitest YOK` kuralı); özet formatı 3 varyant (`run-all-tests.ts:256-261`) | okuma |
| H-11 | HTTP testleri `admin/123123` yerine `fixture-test-user.ts` (`TEST-ADMIN`) kullanır; CLAUDE.md:356-360 hâlâ "aynı kırılganlık `admin/123123` için AÇIK" diyor — not bayat olabilir [VARSAYIM] | `fixture-test-user.ts:6-15`; `Teks-Erp/CLAUDE.md:356-360` |

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakacağı yerler (dosya:satır — neden). Bunlar bulgu DEĞİL, bakılacak yerdir.

1. **`Teks-Erp/scripts/test_batch_k15_merge.ts:131-137`, `test_k14_lock_edges.ts:84-85`, `test_traveler_card_stale.ts:58-61` ↔ `src/services/batch.service.ts:126`** — üç bekçi "`generateBatchNumberTx` kilitsiz, `@unique` P2002'ye düşer, `withBarcodeRetry` ŞART" diye yazıyor; kod 2026-08-05'ten beri advisory 8022 alıyor ve `@unique` kalktı. Sorular: `withBarcodeRetry` sarmalayıcısı parti yolunda artık ne koruyor; **gerçek DB'de paralel parti doğumu** hiçbir bekçide yok (yalnız sahte-tx sıra bekçisi `test_batch_number_format.ts:208-224`).
2. **`src/services/session-registry.service.ts:79` ve `src/services/master-data-merge.service.ts:546`** — advisory kilit var, **hiçbir bekçi ne sırasını ne davranışını ölçüyor** ("grep pg_advisory → koruma var" tuzağı, beceri §4.2).
3. **`src/services/shipping.service.ts:1376` (`createShipment`) ve `:1890` (`dispatchShipment`)** — sevkiyat oluşturma / PLANNED→DISPATCHED onayı için paralel bekçi yok; yalnız storno‖iade ölçülüyor (`test_shipment_scope_lock.ts:148`). İade×iade (aynı top iki `createReturn`) ve storno×storno da ölçülmüyor.
4. **`test_fason_receive_idempotency_concurrency.ts:121-127`** — fason kabul yarışı "born=1" invariant'ıyla ölçülüyor, **kaybedenin 409 mu cached mi olduğu bilinmiyor** (`:125` yorumu bunu kabul ediyor); kısmi kabul (`receivedQty`/`currentQty` decrement), `cancelReceipt` LIFO ve `close-remainder` için paralel sonda yok (`subcontractor.service.ts` ilgili metotları).
5. **Tambur:** `tambur-undo.service.ts` (geri alma), `completeWorkOrderIfStepsDone` (finalize→WO kapama) ve **farklı-token aynı-parent paralel kesim** (metraj aşımı yarışı; `tambur.service.ts cutOpenFabric/cutWarehouseRoll`) bekçisiz — mevcut `test_tambur_cut_idempotency.ts:119` yalnız aynı token'ı ölçer.
6. **İş emri kapanış dispozisyonu (`workorder.service.ts completeWorkOrder`) ve sipariş bağla/iptal/kalem iptali (`workorder-link.service.ts`, `order.service.ts:2434` FOR UPDATE)** — paralel bekçi yok; FOR UPDATE yalnız metin muafı olarak görünüyor (`test_order_line_scope_single_source.ts:44`).
7. **`scripts/run-all-tests.ts:102-165` `productionDbGate`** — yalnız koşucuda; tek-dosya koşumu kapısız; host-adı allowlist'i (`:142`) port-yönlendirmeyi ayırt edemez; `:80-82,152,159` sayıları bayat (2.048 deleteMany / 278 dosya).
8. **`scripts/test_wo_warehouse_attach.ts:109-118`** — 7 satırlık temizlik zincirinin tamamı `.catch(() => {})`; dev DB'de **480 aktif `TST-WHA` iş emri** birikmiş (762'nin %63'ü). Aynı sınıf: `test_import_permissions.ts:224` (41 `TEST-IMP-PERM` kullanıcısı). Genel: 150 dosya / 669 sessiz catch. `clean_test_residue.ts:27-31` bu önekleri tanımıyor.
9. **İdempotency 4-durum matrisi:** "iptal edilmiş kaydın token'ı replay edilince ne olur" yalnız Roll manuel top için ölçülüyor (`test_manual_roll_undo.ts:27,94`); Order/WO/Sack/Shipment/Receipt/Import için ölçüm yok — beceri §8'in "en pahalı hata" sınıfı (`order.service`, `workorder.service`, `shipping.service`, `subcontractor.service`, `import.service` clientToken dalları).
10. **`test_kk1_duplicate_guard.ts:286`** — güçlü bekçi ama **bayrak kapalıyken** (`kk1.duplicateGuardEnabled` varsayılan KAPALI; sahada AÇIK — memory notu) yol kilitsiz; tuzağın `opts.duplicateGuard` ile opt-in olması (`inventory.service.ts createInitialEntry`) dahili çağıranları (tambur-manual ×2) kapsam dışı bırakır — ② "hangi çağıran hangi kapıdan giriyor" haritası.
11. **Eşzamanlılık sondalarının 24/33'ü N=2** ve hiçbiri yarış penceresini gecikmeyle genişletmiyor; `test_shipment_scope_lock.ts:24-26` bunun "çoğu zaman yeşil kalır" sonucunu kendisi yazıyor → kilit sırası değişse davranış bekçileri yakalamayabilir. ② kilit-sırası denetiminde bekçiye güvenmeden `evidence`'a iki satır numarası yazmalı (beceri §4.2).
12. **`src/services/helpers/traveler-card-fanout.helper.ts`, `label-intent.helper.ts`, `import/import-name-guard.ts`, `user-preference.service.ts`** — hiçbir test adını bile anmıyor (0 doğrudan, 0 dolaylı iz).
13. **38 test `systemSetting` yazıyor** (feature-flag) — paylaşımlı dev DB + aynı DB'ye bağlı dev sunucusunun bellek önbelleği; koşucu sıralı ama elle koşum paralel olabilir (`fixture-subcontractor.ts:31-33`) → flake ve "bayat bayrak" sınıfı; ② durum-yerleşimi ajanına.
14. **`test_batch_number_format.ts:60-66`** ile **`test_shipment_scope_lock.ts:57-88`** kilit SIRASINI ölçen tek iki bekçi; diğer 5 advisory noktasında sıra bekçisi yok (8021: davranış sondası var, sıra sondası yok — `inventory.service.ts:844`'ün korunan okumadan önce olduğunu ② satır numarasıyla doğrulamalı).
15. **`scripts/run-all-tests.ts:176`** — tip geçidi filtreli koşumda atlanır; `SKIP_TYPECHECK` ile tamamen kapatılabilir → "yeşil ama anlamsız" sınıfı yalnız tam paket koşumunda korunur.

---

## SINIR ÖTESİ NOTLAR

(Kendi alanım test envanteri; aşağıdakiler başka alanlara. Harf eşlemesi (A-L) bende yok — alan adıyla yönlendiriyorum [VARSAYIM: eşleme orkestratörde].)

- **Eşzamanlılık / kilit haritası ajanı:** `session-registry.service.ts:79` ve `master-data-merge.service.ts:546` bekçisiz advisory kilitler (HOTSPOT-2); `test_shipment_scope_lock.ts:106-117` "src genelinde 1-argümanlı `pg_advisory_xact_lock(hashtext` yok" ölçümünü zaten mekanik yapıyor — namespace haritası için hazır kaynak. `inventory.service.ts:844` kilidinin korunan okumaya göre sırası bekçisiz.
- **Parti / Batch ajanı:** bayat yorumlar (HOTSPOT-1) ve "`withBarcodeRetry` parti yolunda ne koruyor" sorusu; `orderBy batchNumber` yasağının bekçisi `test_batch_number_format.ts` §5 (kaynak taraması) — başka listeleme yüzeyi eklenirse oradan ölçülür.
- **Fason ajanı:** kısmi kabul / kabul iptali / kalan-kapama paralel bekçisiz (HOTSPOT-4); `test_barcode_reservation.ts:56-62` fason çıkış+kabulün barkodu hâlâ tx İÇİNDE aldığını belgeliyor (kilit süresi sorusu, beceri §2 sayaç kilidi).
- **Sevkiyat / iade ajanı:** `createShipment`/`dispatchShipment` paralel bekçisiz (HOTSPOT-3); `shipping.service.ts:2610` `RepeatableRead` yalnız metin bekçili.
- **Tambur ajanı:** HOTSPOT-5.
- **İş emri / sipariş ajanı:** HOTSPOT-6; `order.service.ts:2434` FOR UPDATE'in davranış sondası yok.
- **Durum yerleşimi / scheduler ajanı:** `src/app.ts` job başlatmıyor (`app.ts:12-13` yalnız `getMdnsState`/`getCachedInstallationIdentity` okur), başlatma `server.ts:100-124` → 15 efemeral-app testi zamanlayıcı yan etkisi üretmez (bilgi). `test_p2_infra.ts:53` login-lockout'un bellek atomikliğini ölçüyor; `test_backup.ts:315`/`test_db_copy_single_start.ts:62` bellek bayrak/claim'i — tek-process invariantının bekçileri bunlar (beceri §5: "invariant yazılı ve mekanik bekçili mi" sorusuna girdi).
- **Ops / deploy ajanı:** `productionDbGate` host-adı kapısı (HOTSPOT-7); `clean_test_residue.ts` kapsamı dar (HOTSPOT-8); Windows yetim süreç notu `run-all-tests.ts:221-225`.
- **Veri (K2) ajanı:** `test_consistency.ts` ve `test_consistency_derived.ts` **salt-okunur**dur ve `DATABASE_URL=<kopya>` ile prod kopyasına karşı koşulabilir (`test_consistency.ts:27`, `test_consistency_derived.ts:33`); dev DB'deki 549 test-önekli iş emri (%72) dev'e karşı koşan her tutarlılık/rapor ölçümünü kirletir — K2 dev DB rakamlarını kullanmadan önce bunu bilmeli.
- **Yetki ajanı:** `test_route_auth_coverage.ts`, `test_permission_catalog.ts` (AST), `test_mobile_screen_permissions.ts`, `test_document_template_permission.ts` guard-zinciri bekçileri mevcut; `grant/revoke/setPermissions` paralel bekçisiz.
- **Dokümantasyon:** `Teks-Erp/CLAUDE.md:356-360` "`admin/123123` kırılganlığı hâlâ AÇIK" notu `fixture-test-user.ts` ile kapanmış görünüyor [VARSAYIM]; `run-all-tests.ts` mesaj sayıları bayat.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Durum / sebep |
|---|---|
| Test koşumu, süre ölçümü, flake oranı | **kapsam dışı — koşum dev DB'ye yazar (salt-okunur kural)**; süre/flake yalnız koşucu çıktısından ölçülebilir |
| 366 dosyanın her satırının okunması | Yapılmadı: başlık + assert deseni script ile; **tam gövde** yalnız 37 paralel + 20 token + ~20 seçilmiş dosyada okundu. "Ne doğruluyor" sütunu dosyanın kendi başlık satırıdır (yanıltıcı olabilir) |
| Alan (domain) ataması | Dosya adından sezgisel; çok-alanlı dosyalar tek alana yazıldı |
| Dolaylı servis kapsaması | Yalnız doğrudan (statik+dinamik) import sayıldı + anahtar-kelime izi; çağrı grafiği üzerinden dolaylı kapsam **hesaplanmadı** (kapsam dışı — araç yok) |
| Negatif sonda "kırmızı verdiği doğrulandı" | Dosya içi not 20 dosyada; CLAUDE.md'deki iddialar dosyaya bakılarak doğrulanmadı |
| `TEST-MM` iş emri artığının kaynağı | İki aday dosya; hangisinin temizliği düşüyor açılmadı [VARSAYIM] |
| 16 öneksiz-yazan dosyanın gerçek önek kullanımı | Tek tek açılmadı [VARSAYIM] |
| Mobil istemci idempotency kuralı (`mobil/src/offline/entryAttempt.test.ts`) ve Electron testleri | kapsam dışı — görev backend `scripts/test_*.ts` |
| Prod kopyası (`tekserp_saha_0825`) üzerinde artık ölçümü | Yapılmadı (gereksiz: testler prod'a koşmaz); yalnız dev DB ölçüldü |
| `scripts/load_test.ts`, `smoke_fason_http.ts`, `bench_*.ts`, `seed-*.ts`, `fix_*.ts`, `backfill*.ts` | Envanter dışı (test_ öneksiz); yalnız §0'da not edildi |
| Canlı prod DB | erişim yok (brief) |
