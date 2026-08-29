# BÖLÜM 10-11-12 — YOL HARİTASI · VERİ ONARIMI · KALICI KONTROLLER

> **Kaynak:** `audit/findings.json` (243 ayakta bulgu, 2026-08-29 06:05) · `audit/_rapor-tablolari.md` §4/§7/§8 · `audit/00-map/{KUNYE,MATRIX,KRITIK-YAZMA-YOLLARI,ERISILEMEYEN}.md` · `audit/tours/tur{1,2,3,4}.json` · `audit/03-verify/_hasat.json`
> **Kural:** bu bölümdeki her sayı `findings.json`'dan gelir; efor rakamları bulgu başına `efor_gun` alanının toplamıdır. Kanıtsız cümle yoktur — her satır bir bulgu id'si ya da `dosya:satır` taşır.
> **Ortam uyarısı (pazarlık dışı):** geliştirme veritabanı sahadakinin GERİSİNDEDİR (prod kopyası `tekserp_saha_0825`, 190/195 migration — `ERISILEMEYEN.md` ②). Bölüm 11'deki onarımların hiçbiri yerelde anlamlı değildir; script'ler **sahada koşacak** biçimde, **dry-run varsayılan + `--apply`** ile yazılır (CLAUDE.md canlı veri kuralı).

---

## 10. YOL HARİTASI

### 10.0 Sıralama ölçütü ve kapasite varsayımı

Sıra dört eksenin çarpımıdır: **şiddet × kanıt seviyesi × düzeltme eforu × yan etki riski**.

| Eksen | Nasıl okundu |
|---|---|
| Şiddet | `siddet` (S1 13 · S2 53 · S3 120 · S4 57 — `_rapor-tablolari.md` §4) |
| Kanıt | `kanit_seviyesi` (K3 26 · K2 92 · K1 124 · K0 1). **K3 = dev DB'de eşzamanlı repro ile tetiklendi** → düzeltmenin doğrulanabilirliği en yüksek; K1 ise "koruma yok" demek, "olay oldu" demek değil |
| Efor | `efor_gun` toplamı **190,65 gün-adam** (S1 18 · S2 56 · S3 89,15 · S4 27,5) |
| Yan etki riski | Önkoşulun cinsi: yalnız backend < backend+Electron < migration < APK. APK gerektiren her satır sahada tablet turu demektir (CLAUDE.md sürüm yayınlama kuralları) |

**Kümeleme kuralı:** aynı kök nedene ait bulgular TEK kalemde toplanmıştır — çünkü düzeltme de tektir. Örnek: `BULGU-T1-003`, `BULGU-T1-004`, `BULGU-T3-004`, `BULGU-T3-016` dört ayrı bulgudur ama dördünün de düzeltmesi aynı cümledir: *"tx'in İLK ifadesi `touchWorkOrderTx` olsun"* (`MATRIX.md` ÇAPRAZ OKUMA §D, satır 19/6/2).

**Kapasite varsayımı:** ACİL vade **2 kişi** (1 backend + 1 ops/mobil) tam zamanlı hesaplanmıştır. Tek kişiyle ACİL 7 haftaya çıkar; o durumda vade içi sıra Y-1 → Y-2 → Y-8a → Y-9 → Y-7 → Y-6 → Y-4 → Y-3 → Y-5 → Y-10 → Y-11 → Y-12 olarak izlenir.

### 10.1 Vade özeti

| Vade | Süre | Kalem | Bulgu | Efor (gün-adam) | Bu vadede kapanan risk |
|---|---|---:|---:|---:|---|
| **ACİL** | 0-2 hafta | 12 | 35 | **36,0** | Stok metrajını sessizce bozan tüm K3 (repro ile tetiklenmiş) yolları; sipariş defterine yazılmayan sevkiyat; fasondaki malın ham stoğa düşmesi; gece yedeğinin sessiz kaybı; yönetici PIN'i |
| **KISA** | 1-2 ay | 11 | 64 | **65,75** | Sessiz başarısızlık sınıfının tamamı (mutabakat + alarm); `initialQty` snapshot sözleşmesi; ana veri seddi; oturum sertleştirme; fason kısmi kabulün kapanmayan yolları; eşzamanlılık bekçisi olmayan 6 P0 yolu |
| **ORTA** | 3-6 ay | 9 | 86 | **55,65** | Kilit sırası (ABBA) ailesi; hata yolu/503 sınıflandırması; zaman ve sınır disiplini; audit kapsaması; performans/indeks |
| **UZUN** | 6 ay+ | 5 | 58 | **33,25** | Statü makinesinin merkezileşmesi; HTTP seviyeli bekçi katmanı; altyapı sertleştirme; teknik borç ve ürün kararları |
| | | **37** | **243** | **190,65** | |

⚠️ **190,65 gün-adam bir bütçe değil bir envanterdir.** ACİL + KISA (101,75 gün) fabrikanın bugün para/stok kaybettiği ya da kaybını göremediği yolları kapatır; ORTA + UZUN (88,9 gün) kalıcı olarak "bir daha olmasın" işidir ve iş yüküne yayılabilir.

---

### 10.2 ACİL (0-2 hafta) — 36,0 gün-adam · 35 bulgu

Kabul ölçütü: **her kalem `kabul_kriteri` alanındaki sondayı yeşile çevirmeden kapanmaz** ve her düzeltmenin bekçisi, düzeltme geri alındığında KIRMIZI verdiği kanıtlanmadan bekçi sayılmaz (repo kültürü; `DUZELTME-PLANI.md` §Kelepçeler-2).

| # | Kalem | Bulgu id'leri | Tek cümlelik iş | Efor | Üretim riski | Ön koşul | Kim |
|---|---|---|---|---:|---|---|---|
| **Y-1** | Metraj yazımının bayat okuması | T1-001 (S1/K3), T1-085 (S2/K1), T1-002 (S2/K3), T3-011 (S2/K1) | `applyManualProperties` ve Tambur aşım/geri-alma yazımlarının `updateMany` claim'ine `status` + `currentQty` + `initialQty` PİN'i ekle, aşım kararını tx içinde taze ver | 3,5 | **orta** — yeni 409 yolu doğar, operatör "top bu sırada kesildi" mesajını görecek | yalnız backend | Backend |
| **Y-2** | tambur-undo / attach / manualMove iş emri kilidi | T3-004 (S1/K1), T1-003 (S2/K3), T1-004 (S2/K3), T3-016 (S2/K1) | Dört tx'in de **İLK** ifadesi `touchWorkOrderTx(tx, workOrderId)` olsun; kilit altında WO statüsü taze doğrulansın | 3,5 | düşük | yalnız backend; migration/izin/APK YOK | Backend |
| **Y-3** | Fason kabul replay kimliği + retry yüklemi | T1-005 (S1/K3), T2-007 (S2/K2) | `receive`'in dış catch'ine `clientToken` P2002 dalı (KK1 ikizi, `cancelledAt` kapısı ZORUNLU) + `withBarcodeRetry`'a predicate; tablette token mantıksal deneme başına üretilsin | 2,0 | orta | backend ÖNCE, **APK sonra** (`entryAttempt.ts` fason ikizi) | Backend + Mobil |
| **Y-4** | İdempotency 4. durumu: iptal edilmiş kaydın replay'i | T1-006 (S2/K3, saha 227), T3-010 (S2/K1), T4-003 (S2/K1) | Üç replay okuyucusuna statü kapısı + "aynı token, FARKLI gövde" kontrolünü ortak `idempotent-replay.helper`'a çıkar | 2,5 | düşük | yalnız backend | Backend |
| **Y-5** | İçe aktarım replay penceresi + gövde limiti | T1-008 (S1/K3, dev 297), T1-045 (S2/K3) | `ImportRun` koşumun BAŞINDA yazılsın, devam eden koşum 409 `IMPORT_IN_PROGRESS`; 10 MB rota limiti gerçekten koşsun | 2,0 | düşük (özellik sahada hiç kullanılmamış — `import_runs` saha 0) | backend; opsiyonel iki **nullable kolon** (`startedAt/finishedAt` — enum ekleme YASAK, geri alınamaz) | Backend |
| **Y-6** | İş emri iptali ↔ fason / sipariş sırası | T1-009 (S1/K3), T1-036 (S2/K1, saha 19) | `prepareFasonCancelDecision` `cancelBulk` sonucunu okusun, `failed[]` varsa iptali durdur; sipariş iptalinde WO döngüsü kuru koşumla ön-doğrulansın | 2,5 | orta — bugün geçen bir iptal artık 409 dönebilir | yalnız backend | Backend |
| **Y-7** | İptal geri alma + iptal izi tek kapı | T1-011 (S1/K3, saha 50 top / 1.834,8 m), T1-033 (S3/K2, saha 134) | `resolveRollRestoreBlockReason`'a 6. sinyal (undo ürünü iptal diriltilemez) + iptal izini tek yazma noktasına al (`cancelRollTx`) | 3,0 | orta — geri alma yolunun kapsamı daralır | yalnız backend | Backend |
| **Y-8a** | Sevk defteri kapısı (fail-closed) | T3-002 (S1/K1), T3-003 (S1/K1), T1-010 (S2/K3) | `createShipment`'a `orderless` niyet alanı (boşsa 400); tahsis yazımı `touchOrderLinesTx`'ten SONRA ve kilit altında taze doğrulansın; kalem kapasitesi kilit altında okunsun | 5,5 | **yüksek** — tabletten sipariş seçmeden kurulan sevkiyat bugün çalışıyor; kapı kapanınca saha akışı durur | backend ÖNCE (geçiş penceresinde 400 yerine `warnings`), **APK sonra** | Backend + Mobil |
| **Y-9** | Yedek ve kurulum | T1-020 (S1/K3, saha 7), T1-024 (S1/K3, saha 8), T1-022 (S2/K2), T1-023 (S2/K2) | `kur.ps1` `ecosystem.config.js` env farkını basıp onay istesin; yedek bayatlığı yalnız `nightly`'den ölçülsün, üç durumlu dönsün; offsite hedefi yazılı teyit; çeyreklik geri yükleme tatbikatı | 3,5 | düşük (script sunucuya ELLE kopyalanır; `kur-gerialma.harness.ps1` ile prova) | **ops** — kod değil sunucu dosyası | Ops + Backend |
| **Y-10** | Kimlik: PIN, kimliğe bürünme, kendini yükseltme | T1-014 (S1/K2, saha 8/8), T1-013 (S2/K2, saha 3), T2-013 (S2/K2), T2-012 (S2/K2, saha 24) | Yönetici izinli hesaba PIN yasağı + mevcut yönetici PIN temizliği; kimlik-okuma ucu AND zincirine + audit; `SELF_ESCALATION` kapısı; "kaynağı bilinmeyen yetki" bandı | 4,5 | düşük — 8 aktif kullanıcıda operasyon etkisi yok | backend + ayar; **`--apply` onayı yönetimden** | Backend + Yönetim |
| **Y-11** | Düşen KK1 kaydının görünürlüğü | T3-001 (S1/K1), T1-062 (S3/K2, saha 2557) | Offline kuyruktan düşen 409 `POSSIBLE_DUPLICATE` **operatöre duyurulsun**; `recordPrintEvent` mobilde mutation'a çevrilsin (3 deneme + kalıcı düşüşte toast) | 1,5 | düşük | backend + **APK** | Mobil |
| **Y-12** | CI kırmızısı ve yıkıcı script kapısı | T1-015 (S2/K2, 140 commit), T1-016 (S2/K1), T1-019 (S2/K1) | `ci.yml`'e `adnansahin` dalı; `test_route_auth_coverage` muafiyeti; `reset-operational.ts`'in İLK ifadesi `productionDbGate()` | 2,0 | düşük | repo/ops | Ops |

⚠️ **13 S1 bulgusunun 12'si ACİL'dedir.** Kalan biri `BULGU-T2-001`'dir ve **bilerek** KISA'ya (K-2) konmuştur: onun kod tarafı zaten Y-8a'da kapanıyor; K-2'de kalan iş **geçmiş 7.200,6 m'nin görünür kılınması ve onarım ucu**dur ve bulgunun kendi önerisi de bunu "2. tur / iş kararı" olarak etiketler. Yeni ihlal ACİL'de durur, geçmiş ihlal KISA'da görünür olur.

**ACİL'de kapanan risk — fabrika diliyle:**
- Depoda **100 m'lik topun sistemde 140,5 m görünmesi** (T1-001, repro 10/10) ve **iki eşzamanlı kesimin 100 m'lik toptan 240 m çocuk üretmesi** (T1-002, saha 37) yolları kapanır.
- **Fasondaki mal ham stoğa düşmez** (T1-009): bugün o düşüş olduğunda fason kalemi bir daha HİÇBİR yoldan kapatılamıyor.
- **Sevk edilen mal siparişe yazılmadan çıkamaz** (T3-002/T2-001): saha kopyasında 5 sevkiyat / 3.040,2 m tamamen defter dışı, 23 sevkiyatta toplam 7.200,6 m fark var.
- **Gece yedeğinin sessizce durması** görünür olur (T1-024: 40 günde defterde 1 gece yedeği; T1-020: 7 `BACKUP_COMPLETED` kaydı "OFFSITE YEDEK AYARLANMADI" uyarısı taşıyor).
- **6 haneli PIN'le yönetici hesabı ele geçirme** yolu kapanır (T1-014: 8/8 aktif kullanıcıda PIN, 3'ü yönetici; fiili saldırı izi ARANDI, yok).

---

### 10.3 KISA (1-2 ay) — 65,75 gün-adam · 64 bulgu

| # | Kalem | Bulgu id'leri | Tek cümlelik iş | Efor | Risk | Ön koşul | Kim |
|---|---|---|---|---:|---|---|---|
| **K-1** | Mutabakat + alarm platformu (**"sessiz başarısızlık" sınıfını kapatan asıl kalem**) | T1-044, T1-060, T2-014, T2-004, T2-025, T1-097, T1-031 | `consistency-check.sql` + `consistency-check-derived.sql` gecelik işe bağlansın, kırmızı bölümler `/api/admin/health` sayacına ve job-failure defterine yazılsın; 4xx/5xx sayaçları ayrılsın | 6,5 | düşük | backend + ops | Backend |
| **K-2** | Sevk defteri görünürlüğü ve onarım ucu | T2-001, T2-003, T3-009 | Sevkiyat detayına "siparişe yazılmayan metraj" sütunu; `POST /shipments/:id/orders` onarım ucu; `SackAllocation` audit'i (yazılan + **atlanan** sebebiyle) | 3,5 | orta | backend + Electron | Backend + Panel |
| **K-3** | `initialQty` write-once + hayalet top | T1-012, T2-016, T1-039, T2-002, T2-015 | `cutWarehouseRoll` yalnız `currentQty` düşürsün; tükenen kaynak aynı tx'te `TAMBUR_CONSUMED`; ebeveyne iz satırı yazılsın | 4,5 | orta — rapor rakamları (üretilen metraj) değişir | yalnız backend; **12.1-K1 CHECK'inin ÖN KOŞULU** | Backend |
| **K-4** | Ana veri seddi + mükerrer temizliği | T1-007, T2-009, T1-066, T2-028, T2-010, T1-035, T1-087, T2-011 | Ad guard'ı tx içine + advisory kilit (8028); yumuşak kapılar enforce'a çekilsin; pasife alma bağımlılık önizlemeli olsun; içe aktarım katlaması `foldCodeForCompare`'e bağlansın | 7,5 | orta — enforce öncesi **mükerrer temizliği ŞART** (Bölüm 11 O-10) | migration (index) + backend | Backend + Ana veri sahibi |
| **K-5** | Oturum ve yetki sertleştirme | T1-051, T1-053, T2-030, T1-112, T1-054, T2-040, T1-043 | Oturum ayarları vardiyaya çekilsin (**karar fabrikanın**), `.env` git'ten çıksın + secret rotasyonu, feature-flag ucu daraltılsın, SoD çakışma bandı | 6,25 | düşük-orta — oturum ayarı değişirse saha yeniden giriş yapar | ayar + backend; **`.env` rotasyonu ops** | Ops + Yönetim |
| **K-6** | Fason kısmi kabulün kapanmayan yolları | T3-017, T3-018, T2-006, T3-019 | İptal önizlemesi ile guard aynı yardımcıdan beslensin; kabul iptali aktif makbuzun izini silmesin; tablette optimistic "yeşil" kaldırılsın; firma çözülemediğinde UYARI | 4,5 | orta | backend + **APK** | Backend + Mobil |
| **K-7** | Tambur / plan kapıları ve iyimser kilit | T3-012, T3-013, T3-014, T3-015, T3-007 | Plan hedefi tx içinde taze okunsun (`PLAN_TARGET_CHANGED`); finalize idempotency'sine kimlik; SKIP kararı açık hareketi de saysın; `replace` DIFF uygulasın; KK1 tombstone kapısı | 7,0 | orta | yalnız backend | Backend |
| **K-8** | Eşzamanlılık bekçisi paketi + fixture hijyeni | T1-017, T1-018, T1-074, T2-036, T2-031, T2-032, T1-070 | Para/stok etkili 6 P0 yolu için paralel sonda (`Promise.allSettled`, "1 fulfilled + 1×409"); fixture'sız bekçi yeniden yazılsın; dev DB test artığı temizlensin | 10,25 | düşük | test/ops; **dev DB temizliği yalnız DEV** | Backend/QA |
| **K-9** | Etiket ve refakat kartı defteri | T1-063, T2-008, T2-024, T2-020, T1-096, T1-049, T3-006 | `labelDirty` temizliği koşula bağlansın; kart sürümü atomik claim'e; `printedAt` yalnız gerçek baskıda yazılsın; SWATCH bağlam varsayılanı | 6,0 | düşük | backend (+`printedAt` için migration) | Backend |
| **K-10** | Rapor çıpası ve dönem bütünlüğü | T1-032, T2-017, T2-018, T1-079, T1-080, T1-082 | `finalizedAt` trigger'ı Fire ucunu kapsasın; çapasız top bandı; "dönemde geri alındı" ayrı bant; parti izleme sevk statüsünü süzsün | 5,5 | orta — geçmiş dönem rakamları görünür biçimde değişir | **migration** (trigger) | Backend + Planlama |
| **K-11** | Ops sağlamlık | T3-021, T3-022, T2-005, T1-065, T1-064 | Kapanışta `pg_dump/rclone` çocukları öldürülsün; audit arşiv batch'i 65.535 bind sınırının altına; kilitli 2 siparişin aksiyon listesi düzeltilsin; `ADD VALUE ... IF NOT EXISTS` | 4,25 | düşük | backend + ops | Backend + Ops |

**KISA'da kapanan risk:** bu vadenin tek cümlelik özeti **"hatayı hata olduğu gün görmek"**tir. Bugün ölçülen teşhis süresi **31,5 saat** (T1-060) ve prod'da 40 günde **175.242 istek karşılığı 15 hata satırı, tek bir 409 izi bile yok** (T2-014). K-1 bittiğinde Bölüm 12.2'deki alarmların tamamının taşıyıcısı hazır olur.

---

### 10.4 ORTA (3-6 ay) — 55,65 gün-adam · 86 bulgu

| # | Kalem | Bulgu id'leri (özet) | Tek cümlelik iş | Efor | Risk | Ön koşul |
|---|---|---|---|---:|---|---|
| **O-1** | Kilit sırası (ABBA) ve pre-tx guard ailesi | T1-025, T1-027, T1-028, T1-029, T1-030, T1-083, T1-084, T1-086, T1-092, T1-100, T1-105, T3-029, T3-030, T4-020 | `MATRIX.md` ÇAPRAZ OKUMA §D'deki 30 boşluğun kalanını tek kilit protokolüne bağla (`Roll → advisory → WorkOrder` sırası tek yön) | 9,0 | orta | backend (+1 FK migration: T1-100) |
| **O-2** | Hata yolu, 503 sınıflandırması, korelasyon | T1-026, T1-046, T1-059, T1-125, T1-126, T1-128, T4-015, T4-018, T4-019 | Gerçek deadlock/timeout/bağlantı kaybı 500 değil doğru statüyle dönsün; `requestId` yanıtta ve log satırında yaşasın; `/health` sabit `UP` olmasın | 5,75 | düşük | backend |
| **O-3** | Zaman ve sınır disiplini | T4-002, T4-008, T4-009, T4-010, T4-011, T4-012, T4-013, T4-014, T4-017, T1-098, T3-023, T3-025 | "Tarih-yalnız" alanlar fabrika gününe çekilsin; ay sonu/gün sınırı/tavan kontrolleri tek kaynağa | 7,3 | orta — sipariş termin tarihleri kayabilir | backend |
| **O-4** | İçe aktarım ve girdi doğrulama | T1-089, T1-088, T1-047, T1-050, T4-001, T4-016, T4-004 | `sanitizeWriteData` ANLAM allowlist'ine çevrilsin; ayar ucuna anahtar+tip şeması; takvim/sayı/enum okuması sertleşsin | 4,5 | düşük | backend |
| **O-5** | Audit kapsaması ve belge defteri | T1-034, T1-103, T1-127, T2-019, T2-021, T2-022, T2-023, T2-029, T2-033, T2-034 | Statü değişimlerinin **%22'sinin** iz bırakmaması (T2-029, saha 535) kapansın; `audit_guard` açılsın; iade belge no standarda | 8,0 | orta | migration (FK) + **ops (GUC)** |
| **O-6** | Üretim/fason adım tutarlılığı | T1-038, T1-041, T1-042, T1-048, T1-081, T1-130, T3-027, T3-028, T3-031, T3-032, T3-008 | `recomputeStepStatus` atlanmasın; SCRAP üretime geri çekilmesin; rota kapsaması sorusunun tek cevabı olsun | 7,5 | orta | backend |
| **O-7** | Performans ve indeks | T1-056, T1-057, T1-058, T1-122, T1-134 | `GET /api/rolls`'un günlük 5-10 sn'lik kuyruğu (T1-056, saha 32 olay) kapansın; indeksler `CONCURRENTLY` + `lock_timeout` ile | 5,0 | orta — index kurulumu vardiya dışı | **migration** |
| **O-8** | Yetki uçları ve istemci kapıları | T1-052, T1-068, T1-111, T1-115, T1-116, T4-005, T4-006, T4-007, T4-021 | Arama izin süzgecinin önünde koşmasın; ham TCP ucu kapansın; sürüm kapısı koşullu olsun | 5,0 | düşük | backend + sürüm politikası |
| **O-9** | Bekçi olgunlaşması | T1-069, T1-071, T1-073, T1-076, T1-078, T1-139, T1-142, T1-146, T1-148 | Sonda N=2'den çıksın + gecikme enjeksiyonu; AST bekçileri ham SQL kopyalarını da tarasın; bayat yorumlar düzeltilsin | 3,6 | düşük | test |

---

### 10.5 UZUN (6 ay+) — 33,25 gün-adam · 58 bulgu

| # | Kalem | Bulgu id'leri (özet) | Tek cümlelik iş | Efor | Risk | Ön koşul |
|---|---|---|---|---:|---|---|
| **U-1** | `Roll.status` geçiş matrisinin merkezileşmesi + ölü kod | T1-099 (21 ayrı statü listesi, 57 yazma sitesi — `MATRIX.md` §B), T1-145, T1-164, T1-165, T1-166, T1-107, T1-129, T1-131..T1-135, T1-151, T1-154, T1-156, T1-157, T1-158, T1-161..T1-163 | Tek geçiş tablosu + ondan türeyen guard; ölü kod mekanik yakalansın (bugün 19/19 hâlâ ölü) | ~9 | **yüksek** — 57 yazma sitesine dokunur | backend, ayrı proje |
| **U-2** | HTTP seviyeli bekçi katmanı | T1-075 (bekçilerin **%96'sı** servisi doğrudan çağırıyor), T1-138, T1-136 | Zod/middleware/guard zincirini de ölçen supertest benzeri katman; üretim-DB kapısı tek dosya koşumunda da geçerli olsun | ~4,5 | düşük | test altyapısı |
| **U-3** | Altyapı sertleştirme | T1-055 (uygulama DB kimliği süper yetkili), T1-118 (hız sınırı yok), T3-020 (kapanış bütçesi), T1-113, T1-114, T1-119 | En az yetkili DB rolü, hız sınırı, kapanış bütçesinin gerçek yazmaları kapsaması, cihaz kapısı | ~5,5 | **yüksek** — DB rol değişimi deploy'u düşürebilir | ops + migration |
| **U-4** | Performans altyapısı ve büyüme | T1-120, T1-121 (arşiv sonsuza büyüyor), T1-123, T1-124, T1-153, T1-159 (85 indekssiz FK), T1-160, T1-102, T1-093 | `pg_stat_statements`, arşiv yaşam döngüsü, teşhis aracının kendisinin onarımı | ~6 | orta | ops + migration |
| **U-5** | Ürün kararları ve ölçüm borcu | T2-026 (117 bypass kapanışının 115'i makine atıfsız), T2-027 (156 partinin 122'si aynı numara — **bilinçli**), T2-035 (40 çuvalın 39'u tartısız), T2-038 (213 kartın 149'u bayat, kart hiç okutulmuyor), T1-150, T1-167, T2-037, T2-039, T1-091, T1-104, T1-108, T1-109, T3-024, T3-026, T3-033, T4-022..T4-026 | Kullanılmayan özellikler ölçümle kapatılsın ya da kaldırılsın; kalan sınır/tavan borçları | ~8 | düşük | **fabrika kararı** |

⚠️ **U-5'in üç satırı bulgu değil ayna:** kurşun dağıtımı, refakat kartı okutması ve çuval tartısı sahada fiilen kullanılmıyor. Bunlar "düzelt" değil **"kullanılacak mı" sorusudur** ve cevabı fabrikanındır.

---

## 11. VERİ ONARIM PLANI

**Kapsam kuralı:** yalnız `findings.json`'da `veride_ihlal` alanı **dolu ve sıfırdan büyük** olan bulgular. `dev` sayısı taşıyan satırlar (T1-008 297, T1-015 140, T1-070 480, T2-032 72) **yalnız geliştirme veritabanına** aittir; sahada karşılığı yoktur ve onarım listesine girmez (yalnız O-16'da dev temizliği olarak anılır).

**Ortak sözleşme — her script için geçerli:**
- Yol: `Teks-Erp/scripts/fix_*.ts` · **dry-run VARSAYILAN**, `--apply` ile yazar (CLAUDE.md).
- Dry-run çıktısı **etkilenecek her kaydı somut listeler** ("N kayıt etkilenecek" yetmez).
- `Roll` dokunan her script'in cleanup/geri alma notu `rollVariance` RESTRICT FK'sını hesaba katar (`sapma-defteri-roll-variance` notu).
- **Prisma `update` KULLANILMAZ** — `updatedAt`'i tazeler ve envanter listelerinin tamamı yeniden sıralanır (CLAUDE.md 2026-07-30 + T2-017 önerisi). Ham SQL zorunlu.
- `--apply` öncesi **`premigrate_` tarzı yedek** alınır; geri alma yolu her script'in başına yazılır.
- Script'ler sahada koşar; geliştirme DB'sinde koşturulan dry-run **kanıt değildir** (`ERISILEMEYEN.md` ②).

### 11.1 Onarım envanteri

| # | Onarım | Bulgu | Kayıt (sorgu özeti) | Adet | Doğru değer nasıl belirlenir | Script | Geri alma | Onay |
|---|---|---|---|---:|---|---|---|---|
| **O-1** | Sipariş defterine yazılmayan sevkiyat | T2-001, T3-002 | `shipments status='DISPATCHED'` içerik − Σ`sack_allocations` | 5 sevkiyat tahsissiz (SVK1708260002, SVK1808260001, SVK1908260002, SVK2008260001, SVK2008260005) = **81 top / 3.040,2 m / 3 müşteri**; 23 sevkiyatta toplam **7.200,6 m** fark; 7 kalem hâlâ `shippedQty=0` (SIP1008260002/3/12/27/28/48, SIP1408260015 — 3.700 m istenen) | **TÜRETİLEMEZ — fabrikanın kararı.** Kök neden renk uyuşmazlığı (kalem `ALP·55-BEYAZ·330` ↔ sevk `ALP·EKRU·330`); hangi malın hangi kaleme sayılacağını satış söyler | `fix_shipment_allocations.ts` (tercihen **K-2'nin onarım ucu** üzerinden — ham UPDATE `recomputeOrderStatus`'u atlar) | `sack_allocations` satırlarını sil + `recomputeOrderStatusForOrders` | **Satış/planlama + muhasebe** |
| **O-2** | Çapasız final toplar | T2-017, T1-032 | `rolls status IN('WAREHOUSE','A1_STOCK','SCRAP') AND finalizedAt IS NULL` | **4 top / 359 m** (bc74b77d… SCRAP 300 m; T080826F0018 20 m; T080826F0021 33 m; T080826F0022 6 m) + `statusChangedAt IS NULL` 39 top (bilgi) | **TÜRETİLEBİLİR** — mevcut `backfill_roll_production_timestamps.ts` damgayı hareket geçmişinden kurar | mevcut `backfill_roll_production_timestamps.ts` (sahada hiç koşmamış) | 4 id için damga tekrar NULL, ham SQL, `updatedAt`'e dokunmadan | Planlama (rapor sahibi) |
| **O-3** | `currentQty > initialQty` satırları | T1-044 | `SELECT … FROM rolls WHERE "currentQty" > "initialQty"` | **2 top** (95c15daf… 492,0→698,9; 92d0ef12… 500,0→520,5 — **ikisi de hâlâ `IN_PRODUCTION`**, yani yanlış rakam bugün canlı listelerde) | **Fabrikanın kararı** — doğru rakam fiziksel top; sistem türetemez. Ölçüm §13'te bilerek düzeltilmemişti (kök nedeni gizlememek için) ve o karar **hâlâ savunulabilir** | `fix_roll_qty_overflow.ts` | eski `initialQty/currentQty` değerleri script çıktısında saklanır | **Depo (fiziksel ölçüm) + üretim** |
| **O-4** | `initialQty` sıfırlanmış ebeveynler | T1-012, T2-016 | `rolls p JOIN rolls c ON c.parentRollId=p.id WHERE p."initialQty"=0` | **8 parent** (T080826F0017/0019/0020, T160726F0001/0003, T030826F0003, T190826F0119/0120); izsiz metraj **185,7 m**; IE1408260004'ün üretilen metrajı **−76,7 m** sapmış; aritmetiği tutmayan `TAMBUR_CONSUMED` parent 8/116 | **TÜRETİLEBİLİR:** `initialQty = currentQty + Σ(çocukların initialQty)` | `fix_warehouse_cut_initialqty.ts` | yedekten restore (ham SQL öncesi `premigrate_` dump) | Üretim + planlama |
| **O-5** | 0 metrajlı hayalet toplar | T1-039 | `rolls WHERE status IN('WAREHOUSE','A1_STOCK','STOCK') AND "currentQty"=0` | **2 top** (T190826F0119, T190826F0120 — çocukları T190826F0125/0126 zaten `SHIPPED`) | **TÜRETİLEBİLİR:** kaynak tükendiği için `TAMBUR_CONSUMED` + `preTamburCloseQty/Status` yazılır | `fix_zero_qty_ghost_rolls.ts` | statüyü `WAREHOUSE`'a geri al, iki kolonu NULL'la | Depo |
| **O-6** | Diriltilmeye açık undo-iptal çocukları (**önleyici**) | T1-011 | `rolls status='CANCELLED'` ∧ hareketsiz ∧ `TAMBUR_UNDO*` audit'inde `cancelledChildId` | **50 top / 1.834,8 m** (toplam geri alınabilir iptal 215/230; 53 `TAMBUR_UNDO*` olayı) | **TÜRETİLEBİLİR** — metraj ebeveyne zaten iade edildi → parçanın `currentQty` **0** olmalı ya da `cancelReasonCode = BUILTIN_TAMBUR_UNDO` yazılmalı | `fix_undo_cancelled_children.ts` | eski `currentQty`/kod değerleri çıktıda; geri yazım tek ham UPDATE | Üretim |
| **O-7** | İzsiz iptaller | T1-033 | `rolls WHERE status='CANCELLED'` iz kolonları | **230 iptal**: 134 `cancelledAt` NULL, 134 `preCancelStatus` NULL, **230** `cancelReasonCode` NULL; geri alınabilir kümenin 126'sı `preCancelStatus` NULL | **KISMEN TÜRETİLEBİLİR:** yalnızca `system_logs`'ta karşılığı olan iptaller için kim/ne zaman kurulabilir; sebep **hiçbir yerde yok, uydurulmaz.** `preCancelStatus` NULL kalan topların "Ham Stok'a döner" davranışı bilinen risk | `fix_cancel_provenance_backfill.ts` (yalnız audit'ten çözülebilen alt küme) | damgalanan id listesiyle kolonlar tekrar NULL | Üretim + depo |
| **O-8** | İade edilip sonra iptal edilen mal | T2-023 | `roll_returns cancelledAt IS NULL JOIN rolls` | **5 iade / 261 m** — defter "depoya alındı" derken top `CANCELLED`; mal ne stokta ne fire raporunda | **Fabrikanın kararı:** iptal "mal hiç yoktu" der, iade aksini söyler. Doğrusu muhtemelen `SCRAP` + `RollVariance` | `fix_returned_then_cancelled.ts` | statüyü `CANCELLED`'a geri al + variance satırını `reversedAt` ile kapat | **Depo + muhasebe** |
| **O-9** | Deftersiz fason çekmesi | T2-037 | fason kabul dogan↔tüketilen farkı, `roll_variances SUBCONTRACTOR_RETURN` | **2 makbuz** (19.08 öncesi); `SUBCONTRACTOR_RETURN` sapması sahada **hiç yok** → karne o kabuller için %0 fire basıyor | **TÜRETİLEBİLİR** (`sourceRefId = receipt.id`, aynı motor) **ama önerilen yol backfill DEĞİL:** karneye `SHRINK_LEDGER_SINCE` eşiği koymak daha güvenli (§26b `PLAN_GATE_SINCE` ikizi) | `fix_fason_shrink_backfill.ts` **ya da** eşik ayarı | `reversedAt` ile tersleme | Fason sorumlusu + muhasebe |
| **O-10** | Ana veri mükerrerleri (sed enforce ÖN KOŞULU) | T2-028, T1-066, T2-009 | `items` `lower(code)` ve `nameFold` gruplaması | **8 kod grubu / 9 fazla satır** (biri **iki tarafı da AKTİF ve gerçek stok taşıyor**); `nameFold` **1 grup / 2 satır** (v-1430, ikisi de pasif, kullanım 0) | **Fabrikanın kararı** — hangi kart "asıl". Panel (Mükerrer Kayıtlar) motoru kullanılır; **ham UPDATE YASAK** (42 kurallık haritayı ve audit'i atlar) | panel + `apply_merge_decisions.ts` (mevcut CSV köprüsü, dry-run varsayılan) | **YOK — birleştirme geri alınamaz.** Önce `find_fold_duplicates.ts` listesi + yedek | **Ana veri sahibi (planlama)** |
| **O-11** | SWATCH etiket bağlam varsayılanı | T1-096 | `label_templates isDefault` ↔ `label_context_defaults` | **1 satır eksik** (saha; dev'de 3 kind ayrışık) | **TÜRETİLEBİLİR** — `isDefault=true` şablonun id'si | tek `INSERT` (script gerekmez) | satırı sil | Belge tasarımı sorumlusu |
| **O-12** | Hiç basılmamış kartın "basım tarihi" | T2-024 | `traveler_cards` `abs(printedAt−createdAt) < 1 sn` | **42 kart** (dev 91); 25.08 doğan 4 kartın hepsi böyle | **TÜRETİLEBİLİR ve KAYIPSIZ** — `printedAt := NULL`, değer zaten `createdAt`'in kopyası | `fix_traveler_card_printedat.ts` | `printedAt := createdAt` (kayıpsız geri dönüş) | Üretim |
| **O-13** | Kaynağı bilinmeyen yetkiler | T2-012 | `user_permissions WHERE grantedById IS NULL` | **24/353 satır**, hepsi 08-05'teki iki ops koşumundan; **`shipping:undo-dispatch` 6 kullanıcıda**; `tokenVersion++` atlanmış | **Fabrikanın kararı** — hangi yetki meşru. `grantedById` **NOT NULL yapılmaz** (tarihsel satır); telafi: yetki gözden geçirildikten sonra `revokeAllForUser` | `fix_orphan_permissions.ts` (yalnız raporlar + revoke tetikler) | yetki satırları silinmez; revoke geri alınamaz ama zararsız (yeniden giriş) | **Yönetim** |
| **O-14** | Yönetici hesaplarındaki PIN | T1-014, T1-013 | `users WHERE "quickPin" IS NOT NULL AND isActive` | **8/8 aktif kullanıcıda PIN, 3'ü yönetici**; `auth.pinLockout*` ayar satırları **yok** | **TÜRETİLEBİLİR** — yönetici izinli hesapta PIN NULL'lanır (Y-10'un kod kapısıyla birlikte) | `fix_admin_pins.ts` | PIN geri konmaz (hash); kullanıcı yeniden atar | **Yönetim** |
| **O-15** | SoD çakışması | T1-043 | `users × permissions` üçlü kesişimi | **8 aktif kullanıcının 6'sı** `shipping:write + shipping:undo-dispatch + roll:manual-adjust` üçlüsünü birlikte taşıyor; 2'sinde ayrıca `shipping:invoice`; 3'ünde `admin:*` | **Fabrikanın kararı** — 8 kişilik fabrikada sert ayrım operasyonu durdurabilir. **En ucuz telafi: `teks.audit_guard = on`** (SURUM-2.9.0 §7b) | script yok — panel + `fix_admin_pins.ts` ile aynı turda | yetki geri verilir | **Yönetim** |
| **O-16** | Tekil kalıntılar ve ayar tipleri | T2-025 (1 satır: IE0608260004 adımı), T2-039 (2 sayısal ayar DB'de metin `'365'`), T2-030 (6 auth ayarı varsayılanın tersi), T2-010 (1 açık sipariş kalemi 1.500 m + 2 canlı top 200 m pasif kumaşa bağlı), T1-100 (3 `WorkOrderToOrderLine` satırı silinmeye açık) | tek tek | 1 / 2 / 6 / 3 / 3 | Çoğu **tek satırlık**; T2-025 için iki meşru şık var (**düzelt** ya da **§13 gibi bilinçli kalıntı işaretle**) — hangisi seçilirse `test_consistency.ts:55-56` ve CLAUDE.md satırı güncellenir | `fix_misc_singletons.ts` (her biri ayrı bayrakla) | satır bazlı, eski değer çıktıda | Duruma göre planlama / yönetim |

**Yalnız geliştirme veritabanı (sahada karşılığı YOK, onarım değil temizlik):** `TST-WHA` önekli 480 iş emri (tablonun %63'ü — T1-070), 72 kullanıcının 46'sı test artığı + 8 admin (sahada 3 — T2-032), 297 `import_run` (T1-008), 140 commit'lik CI boşluğu (T1-015). Bunlar K-8 kaleminde `clean_test_residue` genişletmesiyle kapanır.

### 11.2 Onarım sırası (bağımlılıklar)

```
K-3 kod düzeltmesi (initialQty write-once)  ──►  O-4  ──►  12.1-K1 (CHECK rolls_qty_le_initial)
                                                  │
O-10 mükerrer temizliği  ──►  12.1-K2/K3 (nameFold + code sed enforce)
                                                  │
Y-8a kod kapısı  ──►  K-2 onarım ucu  ──►  O-1 (yeni ihlal doğmadan geçmişi kapat)
Y-7 kod kapısı   ──►  O-6            (guard konmadan 50 satırı düzeltmek boşuna)
Y-10 kod kapısı  ──►  O-13 / O-14 / O-15
```

⚠️ **Sıra pazarlık dışıdır:** kapı konmadan geçmiş veriyi düzeltmek, kök nedeni gizlerken aynı ihlali ertesi gün yeniden doğurur. Bu, denetimin §13 dersidir (`mutabakat-kirmizisi-uc-anlam` notu: *"toplu UPDATE kök nedeni gizler; kapı görünür tutar"*).

---

## 12. ÖNERİLEN KALICI KONTROLLER

### 12.1 Eklenecek DB kısıtları

> **Tümü `[PROD'DA ÇALIŞTIRMA]`** — bu bölümdeki hiçbir ifade denetim sırasında sahada koşturulmamıştır. Migration dosyaları yazılır, yerel kopyada denenir, sahaya **vardiya dışı pencerede** ve kullanıcı onayıyla uygulanır (`DUZELTME-PLANI.md` §Kelepçeler-5).
> **Genel kilit uyarısı:** projede bugün `CREATE INDEX CONCURRENTLY` hiç yok ve `lock_timeout` hiçbir migration'da ayarlı değil (T1-134). Aşağıdaki her `CREATE INDEX` **CONCURRENTLY** ve her `ALTER TABLE` **`SET lock_timeout = '3s'`** ile koşmalıdır; aksi hâlde bir uzun okuma tüm yazmaları kuyruğa sokar.

#### K1 — `rolls`: metraj üst sınırı `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgular: BULGU-T1-044 (saha 2 satır) · T1-001 · T1-002 · T3-011 · T2-016
-- ÖN KOŞUL: K-3 (cutWarehouseRoll yalnız currentQty düşürsün) SAHAYA ÇIKMIŞ OLMALI.
SET lock_timeout = '3s';
ALTER TABLE rolls
  ADD CONSTRAINT rolls_qty_le_initial
  CHECK ("currentQty" <= "initialQty") NOT VALID;
-- Temizlik (Bölüm 11 O-3) bittikten SONRA:
-- ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;
```
**Kilit/etki:** `NOT VALID` sayesinde tam tablo taraması YOK; kısa `ACCESS EXCLUSIVE`. Mevcut **2 ihlal satırı deploy'u düşürmez** — `nameFold` "yumuşak kapı" emsalinin birebir uygulaması. `VALIDATE` adımı `SHARE UPDATE EXCLUSIVE` alır, yazmaları engellemez. **Geri alma:** `ALTER TABLE rolls DROP CONSTRAINT rolls_qty_le_initial;`
⚠️ Geri alma bump'ı (`tambur-undo`) `initialQty`'yi aynı ifadede yükselttiği için yeni yazımlar bu CHECK'ten geçer (T1-044 analizi).

#### K2 — `items`: ad seddinin enforce'u `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgular: BULGU-T1-066 (saha 1 grup) · T2-009 · T1-007
-- ÖN KOŞUL: Bölüm 11 O-10 — v-1430 grubu panelden birleştirilmiş olmalı.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_nameFold_key
  ON items ("nameFold") WHERE "mergedIntoId" IS NULL;
```
**Kilit/etki:** `CONCURRENTLY` yazmaları engellemez; küçük tabloda metadata-only. Mükerrer varken **düşer** — bu yüzden O-10 ön koşuldur. **Geri alma:** `DROP INDEX CONCURRENTLY items_nameFold_key;`
Aynı şey `colors_nameFoldColor_key` için **dev'de** eksiktir (T2-009).

#### K3 — `items`: kod tekilliğinin harf-duyarsız seddi `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgu: BULGU-T2-028 (saha 8 çakışma grubu, biri iki tarafı da AKTİF)
-- ÖN KOŞUL: 8 grubun 7 tarihseli birleştirilmiş/pasifleştirilmiş olmalı.
CREATE UNIQUE INDEX CONCURRENTLY items_code_fold_key
  ON items (upper(code)) WHERE "mergedIntoId" IS NULL;
```
⚠️ **`EXPRESSION_UNIQUES` envanterine girdi ZORUNLU** (+predicate) — yoksa şema drift bekçisi bu index'i "fazlalık" sayar (CLAUDE.md 2026-08-25 renk seddi dersi). **Geri alma:** `DROP INDEX CONCURRENTLY items_code_fold_key;`

#### K4 — Birleştirme mezar taşı korunsun `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgu: BULGU-T1-035 (saha 9 tombstone; FK bugün SET NULL — confdeltype='n' ölçüldü)
-- 5 tablo: customers, items, subcontractors, colors, (+ mergedInto taşıyan diğerleri)
SET lock_timeout = '3s';
ALTER TABLE items DROP CONSTRAINT "items_mergedIntoId_fkey";
ALTER TABLE items ADD CONSTRAINT "items_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES items(id) ON DELETE RESTRICT;
```
**Kilit/etki:** FK yeniden kurulumu referans tarama yapar (küçük tablolar, ms mertebesi). **ÖN KOŞUL:** mevcut tombstone'ların survivor'larının silinmemiş olduğu doğrulanmalı. **Geri alma:** aynı ifadenin `ON DELETE SET NULL` hâli.

#### K5 — İş emri ↔ sipariş bağı silinmesin `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgu: BULGU-T1-100 (saha 3 satır bugün silinmeye açık)
ALTER TABLE work_order_to_order_lines
  DROP CONSTRAINT "work_order_to_order_lines_orderLineId_fkey";
ALTER TABLE work_order_to_order_lines
  ADD CONSTRAINT "work_order_to_order_lines_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES order_lines(id) ON DELETE RESTRICT;
```
⚠️ Bu kısıt **kod düzeltmesinin yerine geçmez** — `replace` yolu artık 409 döneceği için kullanıcıya okunaklı mesaj (O-1'deki "kalemi İPTAL edin") **önce** yazılmalıdır; yoksa panelde ham FK hatası görünür. **Geri alma:** `ON DELETE CASCADE`.

#### K6 — Audit değiştirilemezliği `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgu: BULGU-T1-034 (şema/migration 'RESTRICT' diyor, gerçek FK SET NULL)
ALTER TABLE system_logs DROP CONSTRAINT "system_logs_userId_fkey";
ALTER TABLE system_logs ADD CONSTRAINT "system_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT;
-- ve ASIL kontrol (kod değil ops):
ALTER DATABASE tekserp SET teks.audit_guard = 'on';   -- oturum yenilenince etkin
```
⚠️ **`audit_guard` sahada KAPALI** ve kopyaya taşınmadığı için doğrulanamadı (`ERISILEMEYEN.md` ①). Bu, SoD zayıflığının (O-15) **en ucuz telafi edici kontrolüdür**. **Geri alma:** `SET teks.audit_guard = 'off'` + FK'nın `SET NULL` hâli.

#### K7 — Rapor ve iz indeksleri `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgular: BULGU-T1-120 (saha 278 satırlık tarih ekseni indekssiz) · T1-058 · T1-159
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_orderDate_idx   ON orders ("orderDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_completedAt_idx ON orders ("completedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS rolls_directShipmentId_idx
  ON rolls ("directShipmentId") WHERE "directShipmentId" IS NOT NULL;
```
**Kilit/etki:** `CONCURRENTLY` yazmayı engellemez ama **iki tam tarama** yapar; vardiya dışında koşulmalı. 85 indekssiz FK'nın (T1-159) tamamı **BİLİNÇLİ olarak eklenmiyor** — hepsi `*ById` iz kolonu, bugün zararsız; eklemek her yazmaya indeks bakım maliyeti bindirir (T1-057: güncellemelerin %99,4'ü zaten HOT değil). **Geri alma:** `DROP INDEX CONCURRENTLY …`

#### K8 — `traveler_cards.printedAt` gerçeği söylesin `[PROD'DA ÇALIŞTIRMA]`

```sql
-- Kapattığı bulgu: BULGU-T2-024 (saha 42 kart hiç basılmadan 'basım tarihi' taşıyor)
-- ÖN KOŞUL: Bölüm 11 O-12 (mevcut 42 satır NULL'lanmış olmalı) ve K-9 kod düzeltmesi.
ALTER TABLE traveler_cards ALTER COLUMN "printedAt" DROP DEFAULT;
```
**Geri alma:** `SET DEFAULT now()` + O-12'nin kayıpsız geri yazımı.

#### BİLİNÇLİ REDDEDİLEN kısıtlar (gerekçesiyle)

| Aday kısıt | Neden EKLENMİYOR | Bulgu |
|---|---|---|
| `CHECK (status <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)` | 134 eski satırı düşürür; `NOT VALID` ile eklemek fayda/masraf açısından zayıf — kod tarafı (tek `cancelRollTx` kapısı) yeterli | T1-033 |
| `batches.batchNumber UNIQUE` | Numara **bilerek** dönüyor (`P01…P99`, fiziksel plaka düzeni); 92 tekrar grubu tasarımın sonucu | T1-150, T2-027, CLAUDE.md 2026-08-05 |
| `user_permissions.grantedById NOT NULL` | 24 tarihsel satır meşru; doğru kontrol panelde "kaynağı bilinmeyen yetki" bandı | T2-012 |
| Kimlik alanına (VKN) DB seddi | Aynı tüzel kişiye ikinci cari kart meşru olabilir; kuyruğa aday düşer, yazma engellenmez | CLAUDE.md mükerrer paneli P5 |
| 85 FK indeksinin tamamı | Yazma maliyeti > okuma faydası; zararsızlığın gerekçesi **yazıya geçirilir**, indeks eklenmez | T1-159 |

---

### 12.2 Eklenecek mutabakat işleri ve alarmlar

**Bu bölüm denetimin en yüksek getirili tek kalemidir.** Ölçülen gerçek: prod'da 40 günde **175.242 istek**, **15 hata satırı**, **tek bir 409 izi bile yok** (T2-014); sağlık alarmlarının tamamı PULL — `evaluateAlerts` yalnız Sunucu Durumu sayfası açıkken koşuyor ve **ölçülen teşhis süresi 31,5 saat** (T1-060).

| # | Alarm / iş | Ne ölçer | Sıklık | Eşik | Kim görür | Kapattığı bulgu |
|---|---|---|---|---|---|---|
| **A-1** | **Gecelik mutabakat koşumu** — `consistency-check.sql` + `consistency-check-derived.sql` | Bütün bölümler; kırmızı bölüm sayısı `/api/admin/health`'e ve job-failure defterine (bugün prod kopyasında **22 bölümün 19'u temiz** — kalan 3'ün anlamı §13/§18/§20 ayrımıdır) | her gece (arşiv/yedek zamanlayıcı deseni) | herhangi bir bölüm kırmızı → WARN; 2 gün üst üste → CRIT | Panel bandı + Sunucu Durumu | T1-044, T2-004, T2-025, T1-097 |
| **A-2** | Gece yedeği bayatlığı | `backup.lastNightlyAt` **yalnız `nightly` türünden**; üç durumlu (`ok`/`empty`/`unreadable`) | saatlik | >26 saat → WARN; `unreadable` → **CRIT** | Panel + Sunucu Durumu | T1-024, T1-022 |
| **A-3** | Offsite kopya | `offsite.missingCount` + hedef yapılandırılmış mı | gecelik | >0 → WARN | Ops | T1-024, T1-020, T1-132 |
| **A-4** | Kurulum ayarı sürüklenmesi | Sahadaki `ecosystem.config.js` env bloğu ↔ paketinki | her deploy | fark varsa deploy **durur**, farkı basar | Deploy yapan kişi | T1-020 |
| **A-5** | İş kuralı reddi sayacı | `err4xx` / `err5xx` ayrı kolonlar; 409 kodları kırılımlı | sürekli (latency-persist) | 5xx > 0 → WARN, > 10 → CRIT; 409 ani sıçraması → WARN | Sunucu Durumu | T2-014, T1-060 |
| **A-6** | SYSTEM/ERROR defteri | `systemErrorsLast24h` (tek `count(*)`) | 5 dk | >0 WARN, >10 CRIT | Sunucu Durumu | T1-060 |
| **A-7** | Giriş denemesi | `LOGIN_FAILED` sayacı; **sistem geneli** PIN bütçesi (IP değil — PIN kullanıcı adı taşımaz) | 10 dk penceresi | N başarısız → PIN girişi geçici kapalı + panel bandı | Yönetim | T1-014 |
| **A-8** | **Sevk defteri mutabakatı** | `DISPATCHED` sevkiyatta içerik − Σ tahsis > 0 | gecelik (A-1'in bölümü) | >0 m → WARN + sevkiyat listesi | Satış + planlama | T2-001, T3-002 |
| **A-9** | Fason açık sevk ↔ top statüsü (§24c) | "AÇIK+OUTSTANDING sevk kalemi var ama top `AT_SUBCONTRACTOR` DEĞİL" | gecelik | >0 → CRIT (mal kaybı sinyali) | Fason sorumlusu | T1-009 |
| **A-10** | Kapalı iş emrinde canlı mal | `COMPLETED` WO'da `IN_PRODUCTION` top ya da `exitedAt IS NULL` hareket | gecelik | >0 → WARN | Üretim | T3-004 |
| **A-11** | Çapasız final top | `status IN(WAREHOUSE,A1_STOCK,SCRAP) AND finalizedAt IS NULL` | gecelik | >0 → WARN (bugün saha 4) | Planlama (rapor sahibi) | T2-017, T1-032 |
| **A-12** | Serbest statüde 0 metrajlı top | `status IN(WAREHOUSE,A1_STOCK,STOCK) AND currentQty=0` | gecelik | >0 → WARN (bugün saha 2) | Depo | T1-039 |
| **A-13** | İade ↔ top statüsü | `roll_returns(cancelledAt IS NULL)` ↔ `rolls.status` uyuşmazlığı | gecelik | >0 → WARN (bugün saha 5 / 261 m) | Depo + muhasebe | T2-023 |
| **A-14** | Yetki hijyeni | ① SoD çakışması taşıyan kullanıcı sayısı ② `grantedById IS NULL` satır sayısı ③ varsayılandan sapan güvenlik ayarı sayısı | haftalık | ①>0 bilgi bandı ②>0 bant ③>0 bant | Yönetim | T1-043, T2-012, T2-030 |
| **A-15** | Tek-process invariantı | Aynı anda ikinci bir zamanlayıcı/yedek koşumu var mı (dev'de **ÇİFT gece yedeği ve rename yarışı ÖLÇÜLDÜ**) | gecelik | ikinci koşum → CRIT | Ops | T1-031 |
| **A-16** | Saat kayması | Sunucu saati geriye kayarsa gece yedeği sessizce atlanıyor | gecelik | atlama → WARN | Ops | T4-017 |
| **A-17** | Havuz ve DB sağlığı | `pool.on('error')` konsola değil sayaca; `/health.status` gerçek durumu döndürsün (bugün sabit `UP`) | sürekli | bağlantı düşmesi → WARN | Sunucu Durumu | T4-018, T4-019 |

⚠️ **Alarm tasarımının tek kuralı:** "okunamadı" ile "yok" **aynı değere düşmemeli** (T1-024, T1-132). Üç durumlu dönüş (`ok` / `empty` / `unreadable`) bu denetimin tekrarlayan dersidir.

---

### 12.3 Kalıcılaştırılacak eşzamanlılık bekçileri

**Terfi kuralı:** `audit_repro_*.ts` bir kanıt aracıdır; `test_*.ts` bir sözleşmedir. Terfi eden dosya (a) `AUDITREPRO` damgalı fixture'ını kendisi kurar, (b) `finally` temizliği yapar (**`rollVariance.deleteMany` DAHİL** — RESTRICT FK), (c) feature-flag'e **dokunmaz**, (d) **negatif sondayla** kırmızı verdiği kanıtlanmıştır, (e) `productionDbGate`'ten geçer.

⚠️ **Beş script henüz KOŞTURULAMADI** (dev DB oturum boyunca erişilemedi — "Postgres.app failed to verify trust authentication"): `S-1-03`, `S-1-04`, `S-3-01`, `S-3-02`, `E-2-02`. Terfiden önce **koşturulup logu alınmalıdır**; tip kontrolünden geçtikleri doğrulanmıştır.

| Mevcut repro | Terfi hedefi | Ne ölçmeli | Tuttuğu regresyon | Repro sonucu |
|---|---|---|---|---|
| `audit_repro_D-A-01.ts` + `audit_repro_KYY-2-32.ts` | **`test_roll_manual_adjust_concurrency.ts`** | Kesim commit ettikten sonra gelen bayat metraj düzeltmesi 409 döner; `parent.currentQty + Σ çocuk` fiziksel gerçeği aşmaz | T1-001, T1-085 | **10/10 bozulma** (FAZ1 deterministik + FAZ2 paralel 2/2, 5/5, 10/10) |
| `audit_repro_KYY-3-05.ts` | **`test_tambur_cut_overage_concurrency.ts`** | İki eşzamanlı aşım kesimi: çocuk toplamı ebeveyni aşamaz, aşım defteri eksik yazamaz | T1-002 (saha 37) | yazıldı |
| `audit_repro_KYY-1-01.ts` + `audit_repro_S-3-02.ts` | **`test_tambur_undo_wo_lock.ts`** | `finalize(B) ‖ applyFull(A)` 10 turda `broken=0`; negatif sonda: `touchWorkOrderTx` satırı kalkınca kırmızı | T1-003, T3-004 | ⚠️ koşturulamadı |
| `audit_repro_KYY-3-04.ts` | **`test_workorder_attach_terminal_guard.ts`** | İptal edilmiş WO'ya `attachRolls`/`manualMove` ile canlı top bağlanamaz | T1-004 | yazıldı |
| `audit_repro_D-B-01.ts` | **`test_kk1_replay_cancelled.ts`** | İptal/fire edilmiş kaydın `clientToken` replay'i `success:true` DÖNMEZ, 409 `ENTRY_CANCELLED` | T1-006 (saha 227) | **2 kırmızı** |
| `audit_repro_D-B-06.ts` + `audit_repro_KYY-1-03.ts` | **`test_master_data_name_dup_concurrency.ts`** | N=10 paralel aynı ad → tam 1 kayıt (bugün `quality_grades`'te 5 mükerrer üretiyor) | T1-007 | **5 kırmızı** |
| `audit_repro_D-B-05.ts` (§1 + §2) | **`test_import_idempotency.ts`** | Aynı `clientToken` ile iki eşzamanlı `apply` → biri 200, biri 409 `IMPORT_IN_PROGRESS`; hedef tabloda TAM BİR koşum kadar artış | T1-008, T1-089 | **30/30 bozulma** |
| `audit_repro_KYY-1-02.ts` | **`test_fason_receive_idempotency_concurrency.ts`** | Aynı token paralel → tam 1 makbuz, **iki istek de success**, biri idempotent-retry; "ÇİFT DÜŞÜLEN teslimat: 0" | T1-005 (saha 2) | **30/30 bozulma** |
| `audit_repro_D-B-03.ts` | **`test_barcode_retry_predicate.ts`** | `withBarcodeRetry`'ın **her** çağrı yeri predicate taşıyor (bugün 28/28 fail-open) | T1-005 ② | **3 kırmızı** |
| `audit_repro_KYY-3-01.ts` | **`test_shipment_line_capacity_concurrency.ts`** | İki sevkiyat aynı kalemi iki kez sevk edemez; `shippedQty ≤ quantity`; boş sevkiyat/EXPORT tartı kilit altında | T1-010, T1-084, T3-009 | yazıldı |
| `audit_repro_BULGU-T1-011.ts` | **`test_roll_cancel_undo.ts` §yeni** | Undo ile iptal edilmiş kesim çocuğunda `restore-cancel` → 409 `RESTORE_BLOCKED` | T1-011 (saha 50) | **10/10 bozulma** |
| `audit_repro_S-2-01.ts` | **`test_shipment_cancelled_order_guard.ts`** | Sevkiyat kurulurken iptal edilen siparişe tahsis yazılamaz (B: 12 tur yarış, C: kilit sırası) | T3-003 | yazıldı |
| `audit_repro_S-2-04.ts` | **`test_shipment_replay_cancelled.ts`** | İptal edilmiş sevkiyatın token replay'i "Sevkiyat kuruldu" DEMEZ | T3-010 | yazıldı |
| `audit_repro_S-3-01.ts` | **`test_tambur_undo_single_concurrency.ts`** | İki kardeş parça aynı anda geri alınınca `currentQty > initialQty` doğmaz **ve** sapma defterine satır düşer | T3-011 (saha 2) | ⚠️ koşturulamadı |
| `audit_repro_S-4-01.ts` | **`test_wo_target_color_guard.ts` genişletmesi** | Fason kabul ‖ "Rengi Değiştir": mal-plan bekçisi atlanamaz | T3-016 | yazıldı |
| `audit_repro_S-4-02.ts` | **`test_fason_partial_receive.ts` §iptal-kilidi** | "Kalan gelmeyecek" kararı kabul iptalini kalıcı kilitlemez; önizleme ile guard AYNI yardımcıdan | T3-017, T3-029 | yazıldı |
| `audit_repro_S-4-05.ts` | **`test_fason_receive_payload_identity.ts`** | Aynı istemci anahtarı + FARKLI gövde → 409; kabul iptali aktif makbuzun izini silmez | T3-019, T3-028, T3-018 | yazıldı |
| `audit_repro_S-1-03.ts` | **`test_kk1_merge_tombstone.ts`** | Birleştirme ‖ KK1: yeni top **tombstone kayda** yazılamaz (409 `ITEM_MERGED`) | T3-007 | ⚠️ koşturulamadı |
| `audit_repro_S-1-04.ts` | **`test_kk1_duplicate_guard.ts` §lockKey** | Kilit anahtarı 3 ondalığa yuvarlanırken ikiz sorgu birebir eşleşme arıyor → tuzak sessizce kör | T3-023 | ⚠️ koşturulamadı |
| `audit_repro_E-2-02.ts` | **`test_idempotent_replay_payload.ts`** | Tambur depo kesimi / açık kumaş / çuval açma: aynı token FARKLI gövdeye "başarılı" demez | T4-003 | ⚠️ koşturulamadı |
| `audit_repro_D-A-03.ts` + `audit_repro_KYY-3-03.ts` + `audit_repro_D-A-02.ts` + `audit_repro_KYY-2-08.ts` | **`test_lock_order_abba.ts`** + paylaşımlı **`scripts/_lock-order-probe.ts`** | Yedi advisory kilit noktasının **sıra** sondası (bugün 5'inde sıra bekçisi, 2'sinde hiçbir bekçi yok) | T1-025, T1-026, T1-027, T1-028, T1-074 | yazıldı (PostgreSQL deadlock detector ile kanıtlandı) |
| `audit_repro_KYY-2-26.ts` | **`test_workorder_type_mirror_concurrency.ts`** | Eşzamanlı `unlinkOrderLine` "tip = bağın aynası"nı bozamaz | T1-086 | yazıldı |
| `audit_repro_E-1-01…04.ts` | **`test_time_boundaries.ts`** | Ay sonu (`setMonth`), gün sınırı, "gün sonu" yetki bitişi, belge no sözlüksel sırası | T4-002, T4-008, T4-009, T4-010, T4-012 | koşuldu |
| `audit_repro_E-2-01.ts` (§1-§8) | **`test_import_input_validation.ts`** | Takvim (`31.02.2026`), sayı (`1e5`), enum katlaması, `parseBool`, `nextDailySeq` tavanı | T4-001, T4-016, T4-023, T4-024, T4-026 | koşuldu |
| `audit_repro_BULGU-T1-020.ts` | **`deploy/test/kur-gerialma.harness.ps1` genişletmesi** | `kur.ps1` `ecosystem.config.js`'i ezmiyor / farkı basıp onay istiyor | T1-020 (saha 7) | **10/10 bozulma** |
| `audit_repro_BULGU-T1-024.ts` | **`test_backup_freshness.ts`** | Yalnız `premigrate_*.dump` varken "gece yedeği yok" uyarısı; klasör okunamazsa `unreadable` (CRIT) | T1-024 (saha 8) | 3/10 bozulma |

**Repro'su OLMAYAN ama yazılması gereken yeni bekçiler:**

| Yeni bekçi | Ne ölçer | Bulgu |
|---|---|---|
| `test_shipment_ledger_coverage.ts` | Siparişsiz sevk denemesi 400/uyarı üretir; onarım ucu tahsisi geriye dönük yazar (negatif sonda: uç kaldırılınca kırmızı) | T3-002 |
| `test_login_lockout_global.ts` | 200 farklı IP'den 10 dk'da 1.000 yanlış PIN → N denemeden sonra 429 | T1-014 |
| `test_single_process.ts` | Tek-process invariantı (bugün 3 yerde belgeli, **kod içinde mekanik bekçisi yok**) | T1-031 |
| `mobil/src/offline/announceFailure.test.ts` §yeni | Observer'sız mutation + `POSSIBLE_DUPLICATE` → **duyurulur** (bugünkü test muafiyeti hatayı doğru davranış olarak kilitliyor) | T3-001 |
| `test_consistency.ts` §yeni bölümler | "COMPLETED WO'da açık hareket/canlı top" · "defter eksikliği (§1c)" · "serbest statüde 0 metrajlı top" | T3-004, T2-004, T1-039 |
| `test_db_invariants.ts` §yeni | Her `kind` için `isDefault=true` şablon ⇔ `label_context_defaults` satırı ve **aynı id**; `PENDING_ENFORCEMENT` listesi (index, sebep, son tarih) | T1-096, T1-066 |

---

### 12.4 Ekibe verilecek kod inceleme kontrol listesi

Her madde **"şunu yaparsan şu bozulur"** biçimindedir ve arkasında bu denetimde ölçülmüş en az bir bulgu vardır.

| # | Kural | Şunu yaparsan… | …şu bozulur | Kanıt |
|---|---|---|---|---|
| **1** | **Karar okuması tx'in İÇİNDE olmalı** | `prisma.x.findUnique()` ile okuyup ona göre karar verir, kararı `$transaction` içinde yazarsan | aradaki commit sessizce ezilir: 100 m'lik top sistemde **140,5 m** olur | T1-001, T1-002, T3-003, T3-007, T3-011, T3-012, T3-016 |
| **2** | **`updateMany` claim'i karar alanlarını PİNLEMELİ** | `where: { id }` yazıp `status`/`currentQty`/`version`'ı WHERE'e koymazsan | claim "kazandım" der ama karar bayat veriyle verilmiştir; yetki kapısı bile yarışla atlanır | T1-001, T1-085, T2-008 |
| **3** | **Kilit tx'in İLK ifadesi olmalı** | `findUnique`'lerden SONRA `touchWorkOrderTx`/advisory kilit alırsan | hiçbir şey kazanmazsın — TOCTOU açık kalır (KK1 8021 dersinin birebir tekrarı) | T3-004, T1-003, T1-007, CLAUDE.md 2026-08-05 |
| **4** | **Kilit sırası ailelere göre değişemez** | Bir yolda `Roll → WorkOrder`, diğerinde `WorkOrder → Roll` kilitlersen | ABBA deadlock; PostgreSQL birini öldürür ve hata **P2034 değil P2039** olarak 500'e düşer | T1-025, T1-027, T1-028, T1-026, `MATRIX.md` §D |
| **5** | **`clientToken` replay'inin DÖRT durumu var** | "kayıt var → success:true" yazıp **iptal edilmiş** kaydı ayırmazsan | sunucu iptal edilmiş topun kimliğini "başarılı" diye döner; sahada **227 iptal/fire top** bu yüzeyi taşıyor | T1-006, T3-010, T1-005 |
| **6** | **Aynı token + FARKLI gövde ≠ replay** | Gövde kimliğini doğrulamadan cached sonucu dönersen | ikinci, gerçekten farklı işlem sessizce yutulur ("başarılı" der, hiçbir şey yazmaz) | T4-003, T1-089, T3-028 |
| **7** | **Replay anahtarı işin BAŞINDA yazılır** | `ImportRun`/koşum kaydını en SONDA yazarsan | 15 sn'lik istemci zaman aşımından sonra "Tekrar Dene" dosyanın **TAMAMINI** ikinci kez yazar | T1-008 |
| **8** | **Genel retry sarmalayıcısına predicate ver** | `withBarcodeRetry`'ı yüklemsiz çağırırsan | `clientToken` P2002'si "barkod çakışması" sanılır, 5 kez denenir ve yanıltıcı 409 döner — teslimat iki kez düşülür | T1-005 (bugün 28/28 çağrı yeri fail-open) |
| **9** | **Metraja MUTLAK yazma (`= m`) yapma** | `currentQty = m` yazıp `increment/decrement` kullanmazsan | eşzamanlı kesimin aritmetiği silinir; kolon defter değildir, kendi kendine düzelmez | T1-001 |
| **10** | **Snapshot kolonuna sonradan yazma** | `initialQty` / `finalizedAt` / `printedAt` gibi "olay anı" kolonlarını sonradan güncellersen | kapanmış dönem geriye dönük değişir (Temmuz'da üretilen **698 m** Ağustos'ta sessizce düştü); hiç basılmamış **42 kart** "basım tarihi" taşır | T1-012, T2-016, T2-018, T2-024 |
| **11** | **Statü yazan yeni yol iz kolonlarını da yazar** | `status = 'CANCELLED'` yazıp `cancelledAt/preCancelStatus/reasonCode` yazmazsan | **134/230 iptalde** kim/ne zaman/neden yok ve geri alma topu **yanlış rafa** döndürür | T1-033, T1-039 |
| **12** | **Yeni enum değeri = tüm listeleri güncelle** | Yeni bir statü/ucu ekleyip trigger'ın kaynak listesini, arşiv gruplarını ve rapor kovalarını güncellemezsen | fire edilen top Fire Karnesi'nde **ÜRETİM ayına** yazılır; iptal edilen 231 kayıt hiçbir yüzeyde görünmez | T1-032, CLAUDE.md 2026-08-26 "altıncı enum" |
| **13** | **best-effort audit'e iş kanıtı yükleme** | Metraj/defter değişikliğinin tek izini `AuditService.log()`'a bırakırsan | audit tx dışıdır ve düşerse istek yine başarılı olur: topun metrajı defterden **yeniden kurulamaz** (statü değişimlerinin **%22'si** iz bırakmıyor) | T2-015, T2-029, T2-003 |
| **14** | **tx'ten ÖNCE yazma yapma** | Kararı/yazımı tx'in dışına alırsan (havuz client'ı ile) | tx düşünce o yazım **geri sarılmaz**: fasondaki mal ham stoğa düşer ve fason kalemi bir daha kapatılamaz | T1-009, T1-036, `MATRIX.md` §D-1 |
| **15** | **Bekçiyi servisten değil UÇTAN çağır** | Sondayı doğrudan servis fonksiyonuna yazarsan | Zod/middleware/guard zinciri hiç ölçülmez — servis doğruyken **yedi katmanda** alan sessizce düşebilir (bekçilerin %96'sı bugün böyle) | T1-075, T1-045, CLAUDE.md `dispatchWithoutColor` dersi |
| **16** | **Negatif sonda olmayan bekçi bekçi değildir** | Testi yazıp düzeltmeyi geri alarak kırmızı verdiğini kanıtlamazsan | bekçinin kör noktası hatanın kendisiyle **aynı yerde** olur (§13'te birebir yaşandı; §3 doğrulamadan hemen önce tazeliyordu) | T2-004, T1-097, CLAUDE.md 2026-08-22/26 |
| **17** | **"Okunamadı" ile "yok" aynı değere düşmesin** | Bir yoklamayı `try/catch → null` ile kapatırsan | yedek klasörü erişilemezken sistem "yedek yok" değil **"sorun yok"** der; kurtarma yeteneğinin kaybı sessizdir | T1-024, T1-132, T4-018 |
| **18** | **Fail-open varsayılan yazma** | Allowlist yerine blocklist, ya da doğrulamasız `PUT /:key` yazarsan | ekranda görünen değer ile sistemin KULLANDIĞI değer ayrışır (sahada iki sayısal ayar DB'de metin `'365'`) | T1-047, T1-050, T2-039 |
| **19** | **DB seddi yoksa "kod düzeltildi" yetmez** | İnvariantı yalnız kodda zorlarsan | düzeltilmiş bir hata **iki hafta daha** canlıda ihlal üretir ve ikinci satır 13 gün fark edilmez | T1-044, T1-007, T2-028 |
| **20** | **İstemcide sunucudan önce "yeşil" basma** | `onMutate`'te success toast'ı basıp formu temizlersen | operatör kaydın oluştuğunu sanır; çevrimdışı kuyruktan düşen kayıt **hiçbir iz bırakmadan** kaybolur ve fiziksel top sistemde hiç doğmaz | T3-019, T3-001, CLAUDE.md KK1 dersi |

---

## EK — Bu bölümün kapsamı ve kapsam dışı bıraktıkları

- **Kapsam dışı:** Bölüm 10-11-12 yalnız *ne yapılacağını* sıralar; *nasıl yapılacağı* her bulgunun `oneriler[]` alanında zaten somut kod/SQL düzeyinde yazılıdır (366 "kısa", 140 "orta", 9 "uzun" öneri).
- **Onarım script'lerinin hiçbiri bu denetimde YAZILMADI ve KOŞULMADI** — salt-okunur kural (`DUZELTME-PLANI.md`). Yukarıdaki isimler öneridir.
- **Sahaya uygulanmış hiçbir migration yoktur.** 12.1'in tamamı `[PROD'DA ÇALIŞTIRMA]` etiketlidir.
- **30 açık varsayım** `00-map/ERISILEMEYEN.md` §7'de listelidir; canlı prod ortamına, gerçek `ecosystem.config.js`'e, `teks.audit_guard` değerine ve `yedekle.ps1`'e erişilemedi. Bu bölümdeki ops kalemleri (Y-9, A-2, A-3, A-4, K6) **sunucudaki gerçek dosyalar okunmadan kapanmış sayılmaz**.
