# Eşzamanlılık ve idempotency

Bu dosya **hangi yarışa hangi mekanizma** sorusunun cevabıdır. Buradaki tutum sahada mükerrer kayıt, kaybolan yazma ve deadlock demektir; o yüzden her satır ölçülmüş bir emsale dayanır.

Kural biçimi ve zorlama etiketleri: [`README.md`](README.md) · katman-üstü ilkeler: [`ILKELER.md`](ILKELER.md) · bekçi kadansı: [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md).
Yasak listesi (`findUnique→if→update`, `tx.*` + `Promise.all`, `notIn: []`) `docs/KOD-KURALLARI.md`'de; beş sağlamlık sınıfının hikâyesi `docs/kurallar/finans.md`'de; replay'in dört durumu `docs/kurallar/kk1.md`'de. Burada tekrar edilmez, işaret edilir.

---

## 1 · Tutum

Bu repoda serileştirme **izolasyon seviyesiyle kurulmaz**: 196 `$transaction`ın 195'i seviyesizdir (READ COMMITTED) ve tek `isolationLevel` bir salt-okuma fotoğrafıdır (`shipping.service.ts:3643`). Serileştirme READ COMMITTED'ın **üstünde**, iki araçla kurulur: **kilit** (advisory / satır) ve **koşullu WHERE** (atomik claim).

Omurga cümle: **count kontrolü yoksa bu bir claim değil, dürtmedir** — ve hangisi olduğu yorumda yazılı olmalıdır, çünkü grep'te ikisi aynı görünür.

- **[ES-01]** Serileştirmeyi `isolationLevel` ile değil kilit + koşullu WHERE ile kur; `RepeatableRead` yalnız YAZMAYAN bir tutarlı fotoğraf için ve gerekçesi yorumda yazılı olarak verilir · zorlama: insan:"yazan tx mi salt-okuma mı" ayrımı AST'den güvenilir çıkmaz · kanıt: 196 tx / 195 seviyesiz; tek istisna `shipping.service.ts:3620-3644` (üç `groupBy`, yorumda "P2034 riski YOK") · devralınan: yok
- **[ES-02]** `updateMany` ile durum yazan her yol `count` sonucunu okur; okumuyorsa bunun **bilinçli idempotent dürtme** olduğu koruduğu satırın üstünde tek cümleyle yazılır · zorlama: insan:bilinçli no-op ile unutulmuş kontrol AST'de birebir aynı görünür · kanıt: 80 claim sitesi, 74'ü count kontrollü; 6 bilinçli no-op (`helpers/roll-step.helper.ts:180`, `:204`) · devralınan: 6 (baseline)

---

## 2 · Karar tablosu — hangi durumda hangi mekanizma

| Durum | Mekanizma | Emsal |
|---|---|---|
| Kayıt statüsünü A→B çeviren yazma | `updateMany WHERE {id, beklenen-durum}` + `count===0 → AppError.conflict`; içerik claim SONRASI tx içinde taze okunur | `printed-document.service.ts:744-750` |
| Aynı hedefe idempotent dürtme (0 satır = zaten orada) | `updateMany WHERE {id, kaynak-durum}`, count kontrolü YOK + gerekçe yorumu | `helpers/roll-step.helper.ts:180`, `:204` |
| Kayıt yaratan uç (zaman aşımı sonrası retry) | `clientToken @unique` + `!isClientTokenP2002` predicate → tx-DIŞI catch → `findUnique` → CACHED yanıt | `cash-transaction.service.ts:320-330`, `utils/p2002.ts:26-37` |
| Replay'de kayıt SONRADAN iptal edildiyse | dördüncü durum: `assertRollReplayAlive` / `assertOrderReplayAlive` → 409 `ENTRY_CANCELLED` / `ORDER_CANCELLED` | `helpers/token-replay.helper.ts:45-60` |
| Henüz OLMAYAN satıra karşı koruma (sayaç · kod · dönem · mükerrer tuzağı) | `pg_advisory_xact_lock(NS, hashtext(anahtar))`, tx'in **İLK** ifadesi, adlandırılmış `X_LOCK_NS` sabitiyle | `batch.service.ts:126`, `helpers/period-guard.helper.ts:95` |
| Benzersiz numara yarışı (barkod / belge no) | `withBarcodeRetry` (5 deneme + 5-30 ms jitter); iş-anahtarı P2002'leri predicate ile DIŞARIDA | `utils/barcode-retry.ts:15-45`, `subcontractor.service.ts:2751-2762` |
| Durum ↔ sayaç çifti (çek · tahsilat · fatura) | çift yüklem (iki yazar da karşı koşulu kendi WHERE'ine koyar) + DB CHECK + `explain*BumpZeroTx` tanısı | `payment-allocation.service.ts:284`, tanılar `:738/:767/:786` |
| Sayısal tavan / bakiye kontrolü + aynı tx'te artırım | `SELECT … FOR UPDATE` **derinlik savunmasıdır**; asıl serileştirici advisory kilit ya da koşullu UPDATE'tir | `helpers/cash-balance-guard.helper.ts:28-40`, `:81` |
| Bir tx'te birden çok kilit | deterministik sıra; aynı uzayda anahtarlar sıralı, uzaylar arası numara **ARTAN**; PG 40P01/40001 ve P2034 → 409 "tekrar deneyin" | `helpers/period-guard.helper.ts:46-52`, `middlewares/error.middleware.ts:330` |
| Çok satırlı / çok modelli yazım | tek `$transaction`, interaktif `(tx) => {}` biçimi; dış I/O ve audit tx DIŞINDA | `traveler-card.service.ts:367` |
| İş emri kapsamlı sayım | tx'in başında `touchWorkOrderTx` ile WO satırı write-kilidi | `helpers/workorder-locks.helper.ts:40-58`, `subcontractor.service.ts:1057` |
| Uygulama yüklemi bir gün delinirse | şema-dışı DB seddi (partial UNIQUE / CHECK) + iki yönlü envanter | `scripts/test_db_invariants.ts:56-80` |

- **[ES-03]** Durum geçişini atomik claim ile yaz (`updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`) ve claim'den SONRA ihtiyacın olan içeriği tx İÇİNDE taze oku · zorlama: bekçi:`scripts/test_race_conditions.ts`, `test_wo_terminal_race.ts` · kanıt: 80 site / 130 count→409; `printed-document.service.ts:744-750` · devralınan: 36 (baseline — bkz. AÇIK-3)
- **[ES-04]** Kayıt yaratan yeni uç `clientToken String? @unique @db.Uuid` alır; clientToken P2002'si **RETRY EDİLMEZ**, `!isClientTokenP2002(err)` ile dışarı propagate edilir ve tx-DIŞI catch onu cached yanıta çevirir · zorlama: bekçi:`scripts/test_client_token_idempotency.ts`, `test_client_token_collision.ts` · kanıt: 15 model taşıyor (`prisma/schema.prisma:1516…7374`), 18 `isClientTokenP2002` kullanımı; sözleşme `utils/p2002.ts:26-37` · devralınan: 8 (baseline — token'sız belge yaratan model)
- **[ES-05]** Yeni bir replay yolu yazan `helpers/token-replay.helper.ts`'ten geçer; "yazıldı ama sonradan iptal edildi" yüklemini elle kopyalama · zorlama: bekçi:`scripts/test_token_replay_cancelled.ts §5` (kapsam: `ENTRY_CANCELLED` tek kaynak; genel kapsama ölçülmüyor) · kanıt: helper 3 dosyadan import ediliyor; `shipping.service.ts:1663-1673` kuralı elle yeniden yazmış · devralınan: 12 (baseline — bkz. AÇIK-1)
- **[ES-06]** Henüz olmayan satıra (phantom) karşı koruma advisory kilitle kurulur: **2 argümanlı** `pg_advisory_xact_lock(X_LOCK_NS, hashtext(anahtar))`, adlandırılmış sabitle ve tx'in **İLK** ifadesi olarak · zorlama: bekçi:`scripts/test_shipment_scope_lock.ts §2` (src genelinde 1-argümanlı form sıfır) · kanıt: 16 çağrı sitesi / 12 dosya, hepsi 2 argümanlı; gerekçe `helpers/period-guard.helper.ts:79-88` ("kilit, koruduğu OKUMADAN önce alınır") · devralınan: yok
- **[ES-07]** `withBarcodeRetry` yalnız SIRA-numarası çakışmasını yeniden dener; iş-anahtarı ve `clientToken` P2002'leri `isRetryable` predicate'iyle dışarıda bırakılır · zorlama: insan:hangi constraint'in iş anahtarı olduğu AST'den bilinemez · kanıt: `utils/barcode-retry.ts:19-23`; `subcontractor.service.ts:2761` dört constraint'i birden dışlıyor; 14 sarma sitesi, ölçülen sapma 0 · devralınan: yok
- **[ES-08]** Durum ↔ sayaç çifti olan modelde iki yazar da karşı tarafın koşulunu kendi atomik WHERE'ine koyar, DB CHECK ikinci hat olur ve `count===0` tanısı ayrı bir `explain*BumpZeroTx` ile tx İÇİNDE verilir · zorlama: bekçi:`scripts/test_payment_allocation.ts §12` · kanıt: `payment-allocation.service.ts:284-298`; üç kaynakta simetrik tanı `:738/:767/:786`; CHECK `cheques_terminal_not_allocated` · devralınan: yok
- **[ES-09]** `FOR UPDATE` bir derinlik savunmasıdır, tek başına serileştirici sayılmaz — asıl serileştirici advisory kilit ya da koşullu UPDATE'tir ve her `FOR UPDATE` sitesi "tx dışında çağırmak koruma sağlamaz" gerekçesini yorumda taşır · zorlama: bekçi:`scripts/test_cash_negative_guard.ts`, `test_goods_receipt_invoice.ts §10` · kanıt: 6 site, sapma 0; `helpers/cash-balance-guard.helper.ts:28-40` · devralınan: yok
- **[ES-10]** Bir tx birden çok kilit alacaksa sıra deterministiktir (aynı uzayda anahtarlar sıralı, uzaylar arası numara ARTAN) ve sınıf-40 hatası kullanıcıya 500 değil 409 döner · zorlama: bekçi:`scripts/test_cash_period_close.ts` + `middlewares/error.middleware.ts` dalları · kanıt: `period-guard.helper.ts:46-52` (tekil guard'ı bir tx'te iki kez elle çağırmak `cheque.bounce`'ta canlı deadlock üretti); `error.middleware.ts:330,369,546,704`; bugünkü tek çapraz-uzay çifti 8021→8030 ARTAN (`inventory.service.ts:988` → `:1060`) · devralınan: yok
- **[ES-11]** Çok modelli yazım tek `$transaction` içinde ve interaktif `(tx) => {}` biçiminde yapılır; dış I/O ve audit tx DIŞINDA kalır · zorlama: eslint:`no-restricted-syntax` (yalnız `tx.*` + `Promise.all` dalını yakalar) + insan:"tx'siz iki model yazımı" AST'de fonksiyon sınırını aşan bir analiz ister · kanıt: 196 tx / 175 fn biçimi; tx dışında ≥2 model yazan TEK fonksiyon `jobs/role-template-catalog.job.ts:57`; audit 0/323 ihlal; havuz varsayılanları `lib/prisma.ts:88-93` (maxWait 5 s, timeout 20 s) · devralınan: 1 (baseline — bkz. AÇIK-5)
- **[ES-12]** İş emri kapsamlı bir sayıma dayanarak karar veren yol, tx'in **başında** `touchWorkOrderTx` çağırır · zorlama: insan:63 çağıranın "tx başında mı" olduğu AST'den ölçülmedi, BELİRSİZ · kanıt: `helpers/workorder-locks.helper.ts:40-58` (READ COMMITTED'da eşzamanlı dispatch'in topları sayılmıyordu); `subcontractor.service.ts:1057` · devralınan: yok
- **[ES-13]** Uygulama yükleminin ikinci hattı DB'dedir: yeni bir tekillik/tavan kuralı partial UNIQUE ya da CHECK olarak da yazılır ve `test_db_invariants` envanterine iki yönlü girer · zorlama: bekçi:`scripts/test_db_invariants.ts` (`checkNoExtras`, envanter-dışı nesne KIRMIZI) · kanıt: 68 partial index (37 unique) + 60 CHECK envanterli; ayrıntı [`VERITABANI.md`](VERITABANI.md) · devralınan: yok

---

## 3 · Kilit uzayı envanteri

Envanterin tek kaynağı `Teks-Erp/src/services/helpers/period-guard.helper.ts` başlığıdır. Bugünkü fiilî durum **10 sabit / 8 numara**:

| Numara | Sabit | Dosya | Amaç |
|---|---|---|---|
| 8021 | `DUPLICATE_GUARD_LOCK_NS` | `helpers/duplicate-guard.helper.ts:28` | KK1 mükerrer top tuzağı |
| 8022 | `BATCH_NUMBER_LOCK_NS` | `batch.service.ts:96` | parti numarası üreteci (tek global anahtar) |
| 8023 | `SHIPMENT_LOCK_NS` | `helpers/shipment-locks.helper.ts:28` | sevkiyat kapsamı |
| 8024 | `SESSION_REGISTRY_LOCK_NS` | `session-registry.service.ts:32` | oturum kayıt defteri |
| 8025 | `PERM_ADMIN_LOCK_NS` | `permission-management.service.ts:21` | yetki (son-admin) guard'ı |
| 8026 | `PERIOD_CLOSE_LOCK_NS` | `helpers/period-guard.helper.ts` | cari dönem kapanışı |
| 8027 | `PURCHASE_ORDER_LOCK_NS` | `purchase-order.service.ts` | alış siparişi senkronu |
| 8028 | `CASH_PERIOD_CLOSE_LOCK_NS` | `helpers/cash-period-guard.helper.ts` | kasa/banka dönem kapanışı |
| 8029 | `CODE_UNIQUE_LOCK_NS` | `helpers/code-unique.helper.ts` | kod tekilliği |
| 8030 | `MERGE_LOCK_NS` | `master-data-merge.service.ts` | master-data birleştirme (tek global anahtar) |

Bu tablo bir ÖZETTİR; kanonik envanter `period-guard.helper.ts` başlığındadır ve `test_advisory_lock_namespaces` ikisini birden ölçer.

⚠️ **2026-09-05'e kadar İKİ ÇAKIŞMA vardı** ve kayıt olarak duruyor: 8026'yı kod tekilliği ile cari dönem kapanışı, 8027'yi alış siparişi ile master-data birleştirme paylaşıyordu. Zarar veri değil **gecikmeydi** — aynı uzayı paylaşan iki alt sistem birbirini sessizce serileştirir ve gecikmenin kaynağı bulunamaz. Çakışan iki sistem yeni uzaylara (8029 · 8030) taşındı, envanter 10 satıra tamamlandı, 7 dosyadaki kopya listeler tek kaynağa indirildi (üçü zaten yanlıştı) ve tam küme eşsizliği bekçiye bağlandı.

- **[ES-14]** Her advisory uzayının **TEK** sahibi olur; yeni bir alt sistem var olan numarayı ödünç almaz · zorlama: bekçi:`scripts/test_advisory_lock_namespaces.ts` (tam küme eşsizliği + envanter↔kod iki yönlü + körlük zemini, 6 negatif sonda) · kanıt: 10 sabit / 10 numara, çakışma yok (2026-09-05'te iki çakışma giderildi) · devralınan: yok
- **[ES-15]** Yeni uzay eklerken numara, sahip ve amaç `period-guard.helper.ts` başlığındaki envantere AYNI commit'te yazılır · zorlama: insan:envanter yorum metnidir, kod↔yorum eşleşmesi AST'den güvenilir çıkmaz · zorlama ayrıca bekçi:`test_advisory_lock_namespaces` (envanterdeki satırın kodda karşılığı ve koddaki uzayın envanterde yazılı olması İKİ YÖNLÜ ölçülür) · kanıt: envanter 2026-09-05 öncesinde 8023'ü hiç listelemiyor ve 8026/8027'yi tek sahibe atfediyordu · devralınan: yok
- **[ES-16]** Uzay sabiti `export const X_LOCK_NS: number = 80NN;` biçiminde yazılır — açık `: number` olmadan literal tipe daralır ve bekçideki "uzaylar farklı" karşılaştırması TS2367 ile derlenmez; çağrıda çıplak sayı kullanılmaz · zorlama: tsc + bekçi:`test_shipment_scope_lock.ts §2` · kanıt: `period-guard.helper.ts` gerekçesi; `grep pg_advisory` → sabit dışı çıplak sayı 0 · devralınan: yok (iki anotasyonsuz sabit 2026-09-05'te tiplendi, 10/10)

---

## 4 · Yarış bekçisi yazımı

Yarış bekçisi "iki isteği aynı anda gönder" değildir — o pencereyi ıskalar ve **sahte yeşil** kalır.

- **[ES-17]** Yarış penceresini `Promise.allSettled` ile değil, **elle açık tutulan bir transaction** ile kur: sonda tx'i kilidi alır, ikinci akış başlatılır, sonra sonda commit edilir · zorlama: insan:sondanın kendi kurgusu mekanik ölçülemez · kanıt: `scripts/test_goods_receipt_invoice.ts:84`, `:392-398`; aynı ders `docs/KOD-KURALLARI.md:112` · devralınan: yok
- **[ES-18]** Sondanın tuttuğu kilit `FOR NO KEY UPDATE`'tir; `FOR UPDATE` FK'nın KEY SHARE kilidini de bloklar ve sonda kendini kilitler · zorlama: insan:kilit modu seçimi FK topolojisine bağlı · kanıt: `scripts/test_goods_receipt_invoice.ts:398`, `:469` · devralınan: yok
- **[ES-19]** Henüz `await` edilmemiş gate promise'ine no-op `.catch` konur — yoksa erken red sahipsiz rejection olur ve Node süreci **Sonuç satırı basılmadan** ölür (en sessiz kırmızı) · zorlama: insan:promise'in ne zaman await edileceği akış analizi ister · kanıt: `scripts/test_payment_allocation.ts:810`, `:882`, `:1231-1249`; kural aynası [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md) `[TD-19]` · devralınan: yok
- **[ES-20]** "Bekledi" ölçümü yalnız POZİTİF yönde anlamlıdır; bekçinin kırmızı verme yükümlülüğü **sonuç** kontrolündedir (yasak durum çifti doğdu mu, claim geri sarıldı mı) · zorlama: insan:zamanlama ölçümü yüklü makinede yanıltır · kanıt: `scripts/test_goods_receipt_invoice.ts:33-43` (§10a yeşil kalabilir; asıl sonda §10b/§10c/§10e/§10f) · devralınan: yok

---

## 5 · İstemci tarafı

- **[ES-21]** İstemci `clientToken`'ı **mantıksal kayıt denemesi** başına bir kez üretir ve token yalnız sonucu belirsiz bırakan hatada (ağ / zaman aşımı / 5xx) yapışır; kesin 4xx'te bırakılır · zorlama: bekçi:`mobil/src/offline/entryAttempt.test.ts` · kanıt: `mobil/src/offline/entryAttempt.ts:14-27` (2026-08-03 saha vakası: token `handleSubmit` içinde üretiliyordu → tek top için N kayıt); `shipping.service.ts:1664-1666` 409'un neden kesin olması gerektiğini yazıyor · devralınan: yok
- **[ES-22]** Uçuştaki bir denemenin tekrarında yük **YENİDEN ÖLÇÜLMEZ**: kimlik parmak izi backend'in idempotent dalının baktığı alanlardan kurulur ve sayılar DB hassasiyetine yuvarlanır — otomatik modda 140.0001 ile 140.0004 aynı fiziksel ölçümdür, farklı sayılırsa aynı top ikinci kez yazılır · zorlama: bekçi:`mobil/src/offline/entryAttempt.test.ts` · kanıt: `mobil/src/offline/entryAttempt.ts:106-121` (`entryFingerprint`, `toFixed(3)`), karar `decideSubmit:139-153` · devralınan: yok
- **[ES-23]** `onMutate` **yeşil basmaz**: çevrimiçi yolda onay ve başarı haptiği `onSuccess`'te verilir, `onMutate` yalnız "Kaydediliyor…" der; çevrimdışı (paused) yolda onay `onMutate`'te ve "ağ gelince gönderilecek" diliyle verilir · zorlama: insan:"hangi toast yeşil sayılır" AST'den okunmaz · kanıt: `mobil/src/screens/Modules/KK1/KK1Screen.tsx:911-921` (koşulsuz yeşil "Top kaydedildi" toast'ı operatörü tekrar basmaya davet ediyordu) · devralınan: yok
- **[ES-24]** Çevrimdışı kuyruğa giren mutasyonun gövdesi elle kurulur ve bu sessiz bir allowlist'tir — kapı alanı eklerken Zod şeması ve `offline/mutations.ts` gövdesi BİRLİKTE güncellenir · zorlama: bekçi:`mobil/src/offline/mutations.test.ts` · kanıt: `docs/KOD-KURALLARI.md:117`; ilke aynası `[IL-08]` · devralınan: yok

---

## 6 · Bilinen boşluklar

Kimlikler bu tabloya özeldir; parantez içindeki kod keşif kaydındaki karşılığıdır (`docs/history/standart-2026-09-05/kesif/eszamanlilik.json`).

| # | Ne | Dosya:satır | Risk | Önerilen mekanizma | Neden ertelendi |
|---|---|---|---|---|---|
| AÇIK-1 (keşif ES-01) | "Ölü replay" yüklemi 15 token'lı modelin yalnız 3'ünde tek kaynakta; sevkiyat kuralı elle kopyalamış | `helpers/token-replay.helper.ts` ↔ `shipping.service.ts:1663-1673` | orta — cached `success:true` + iptal edilmiş kayıt | model-bağımsız `assertReplayAlive(kind, row)` | 12 ucun her birinde "ölü" tanımı ayrı (statü kümeleri farklı), tek turda ölçülemedi |
| AÇIK-2 (keşif ES-02) | Dört tablet ucu `clientToken`'sız: SubcontractorDispatch · KartelaDispatch · KartelaReceipt · StockCount | `subcontractor.service.ts:1051`, `kartela.service.ts:174`, `:470` | orta — mükerrer belge doğmaz (top claim'i korur, `subcontractor.service.ts:6438`) ama operatör "kayıt oldu mu" cevabını alamaz | kolon + replay dalı + istemci token gönderimi | APK ister (mobil native/sözleşme turu); bu turda YAPILMIYOR |
| AÇIK-3 (keşif ES-03) | 36 tx-dışı `findUnique→if→update` sitesi — hepsi yönetim/master-data, defter değil | `device.service.ts:322,345,401,416,429,476`, `auth.service.ts:191,253`, `peripheral.service.ts:176,210`, `traveler-template.service.ts:224,246`, `customer-branch.service.ts:223`, `reason-preset.service.ts:413`, `free-document.service.ts:83` | düşük — tek yönetici, düşük frekans, son-yazan-kazanır | atomik claim | **devralınan**: toplu kampanya yok; yeni kodda `[ES-03]` zorunlu |
| AÇIK-4 (keşif İ-11) | Refakat kartı sürüm artırımı check-then-act; `(workOrderId, version)` unique yok, arşiv upsert'i çakışan iki baskıyı tek satıra çökertiyor | `traveler-card.service.ts:269-291`, `recordPrintEvent:349-375` | orta — ikinci baskının içeriği sessizce kaybolur | claim (`updateMany where {id, status, version}` + `count===0 → 409`), emsal `printed-document.service.ts:744` | — **bu turda düzeltiliyor** |
| AÇIK-5 (keşif İ-12) | Boot job'unda tx'siz çok-model yazım (repo genelindeki tek örnek) | `jobs/role-template-catalog.job.ts:57` (`:118`, `:147`, `:172`) | düşük — yarım kalan uzlaştırmayı sonraki boot tamamlar | tek `$transaction` | — **bu turda düzeltiliyor** |
| AÇIK-6 (keşif İ-13) | Fason talimatı güncellemesi tx dışı check-then-act | `subcontractor.service.ts:4753` → `:4785` | düşük — sevk fişi snapshot'ı donmuş, kâğıt etkilenmez | tx + claim | — |
| AÇIK-7 (keşif M-05) | `SackTag` adı check-then-act ile tekilleştiriliyor, DB seddi yok | `sack-tag.service.ts:132`, `:164` | düşük — eşzamanlı iki ekleme aynı adı yazar | yumuşak kapılı partial UNIQUE (`nameFold` deseni) | — |
| AÇIK-8 (keşif İ-10) | İki advisory uzayında çift sahip; tam küme eşsizliğini ölçen bekçi yok | §3 tablosu; bekçi kapsamı `test_shipment_scope_lock.ts:93-94` | orta — bugün zarar yok, yarın gecikme/deadlock | yeni uzay (8029) + envanter tamamlama + `test_advisory_lock_namespaces` | — **bu turda düzeltiliyor** |

Ayrıca kapsam dışı bırakılan iki karar: backend'de yapılandırılmış logger yok (137 `console` çağrısı fiilen tek kanal) ve mobilde şema doğrulama katmanı yok (`zod` bağımlılığı yok) — ikisi de [`README.md`](README.md) § bilinen borç listesinde.

---

## 7 · Ne zaman hangisi DEĞİL — yanlış refleks listesi

- `findUnique → if → update` bir durum geçişi değildir; pencere READ COMMITTED altında her zaman açıktır (`[ES-03]`).
- `RepeatableRead` bir serileştirici değildir; yazan tx'i korumaz, yalnız okuma fotoğrafını dondurur (`[ES-01]`).
- Advisory kilidi tx'in ortasında almak hiçbir şey kazandırmaz — korunan okuma çoktan yapılmıştır (`[ES-06]`).
- P2002'de kör retry yapmak: `clientToken` çakışması 5 tur boşa döner ve kullanıcıya "Barkod üretimi 5 denemede başarısız" yalanını bastırır (`[ES-04]`, `[ES-07]`).
- `tx.*` çağrılarını `Promise.all` ile paralelleştirmek: pg adapter tek bağlantıyı seri çalıştırır, kazanç yok, ESLint kuralı yakalar (`docs/KOD-KURALLARI.md`).
- Audit'i tx'e sokmak: audit best-effort'tur, tx'e girerse iş yazımını kendi hatasıyla geri sarar (`[ES-11]`).
- `FOR UPDATE`'i tek koruma sanmak: tx dışında çağrıldığında hiçbir şey korumaz (`[ES-09]`).
- Yarış bekçisini `Promise.allSettled` ile kurmak: pencere ıskalanır, bekçi sahte yeşil kalır (`[ES-17]`).
