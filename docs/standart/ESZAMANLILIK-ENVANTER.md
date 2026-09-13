# Eşzamanlılık — envanterler

Bu dosya [`ESZAMANLILIK.md`](ESZAMANLILIK.md)'nin §3 (kilit uzayı envanteri) ve §6 (bilinen boşluklar) bölümleridir; 2026-09-13'te oradan **bölünerek** geldi. Gerekçe: o dosya belge boyut tavanına 447 bayt kalmıştı ve **tavan yükseltilmedi**. Ayrım çizgisi `VERITABANI.md` bölünmesiyle aynı: **kural kalır, ENVANTER ayrılır** — çünkü envanterler büyür.

⚠️ **Bölüm numaraları KORUNDU** (§3 ve §6 diye başlar) — `ESZAMANLILIK.md §3` diye işaret eden çapalar, kök `CLAUDE.md` dahil, taşınan şeyi bulmaya devam etmelidir. `ESZAMANLILIK.md` içinde her ikisinin yerinde bir yönlendirme satırı durur.

**Kanonik kaynak envanter DEĞİLDİR:** kilit uzaylarının tek kaynağı `src/services/helpers/period-guard.helper.ts` başlığı, kapısı `scripts/test_advisory_lock_namespaces.ts`'tir. Buradaki tablo o kaynağın okunabilir aynasıdır.

Tutum, karar tablosu, bekçi yazımı, istemci tarafı, yanlış refleks listesi ve beklenen uyarı orada kaldı: `docs/standart/ESZAMANLILIK.md`.

---

## 3 · Kilit uzayı envanteri

Envanterin tek kaynağı `Teks-Erp/src/services/helpers/period-guard.helper.ts` başlığıdır. Bugünkü fiilî durum **10 sabit / 8 numara**:

| Numara | Sabit | Dosya | Amaç |
|---|---|---|---|
| 8021 | `DUPLICATE_GUARD_LOCK_NS` | `helpers/duplicate-guard.helper.ts:33` | KK1 mükerrer top tuzağı |
| 8022 | `BATCH_NUMBER_LOCK_NS` | `batch.service.ts:96` | parti numarası üreteci (tek global anahtar) |
| 8023 | `SHIPMENT_LOCK_NS` | `helpers/shipment-locks.helper.ts:27` | sevkiyat kapsamı |
| 8024 | `SESSION_REGISTRY_LOCK_NS` | `session-registry.service.ts:31` | oturum kayıt defteri |
| 8025 | `PERM_ADMIN_LOCK_NS` | `permission-management.service.ts:21` | yetki (son-admin) guard'ı |
| 8026 | `PERIOD_CLOSE_LOCK_NS` | `helpers/period-guard.helper.ts:81` | cari dönem kapanışı |
| 8027 | `PURCHASE_ORDER_LOCK_NS` | `purchase-order.service.ts:109` | alış siparişi senkronu |
| 8028 | `CASH_PERIOD_CLOSE_LOCK_NS` | `helpers/cash-period-guard.helper.ts:53` | kasa/banka dönem kapanışı |
| 8029 | `CODE_UNIQUE_LOCK_NS` | `helpers/code-unique.helper.ts:55` | kod tekilliği |
| 8030 | `MERGE_LOCK_NS` | `master-data-merge.service.ts:56` | master-data birleştirme (tek global anahtar) |

Bu tablo bir ÖZETTİR; kanonik envanter `period-guard.helper.ts` başlığındadır ve `test_advisory_lock_namespaces` ikisini birden ölçer.

⚠️ **2026-09-05'e kadar İKİ ÇAKIŞMA vardı** ve kayıt olarak duruyor: 8026'yı kod tekilliği ile cari dönem kapanışı, 8027'yi alış siparişi ile master-data birleştirme paylaşıyordu. Zarar veri değil **gecikmeydi** — aynı uzayı paylaşan iki alt sistem birbirini sessizce serileştirir ve gecikmenin kaynağı bulunamaz. Çakışan iki sistem yeni uzaylara (8029 · 8030) taşındı, envanter 10 satıra tamamlandı, 7 dosyadaki kopya listeler tek kaynağa indirildi (üçü zaten yanlıştı) ve tam küme eşsizliği bekçiye bağlandı.

- **[ES-14]** Her advisory uzayının **TEK** sahibi olur; yeni bir alt sistem var olan numarayı ödünç almaz · zorlama: bekçi:`scripts/test_advisory_lock_namespaces.ts` (tam küme eşsizliği + envanter↔kod iki yönlü + körlük zemini, 6 negatif sonda) · kanıt: 10 sabit / 10 numara, çakışma yok (2026-09-05'te iki çakışma giderildi) · devralınan: yok
- **[ES-15]** Yeni uzay eklerken numara, sahip ve amaç `period-guard.helper.ts` başlığındaki envantere AYNI commit'te yazılır · zorlama: insan:envanter yorum metnidir, kod↔yorum eşleşmesi AST'den güvenilir çıkmaz · zorlama ayrıca bekçi:`test_advisory_lock_namespaces` (envanterdeki satırın kodda karşılığı ve koddaki uzayın envanterde yazılı olması İKİ YÖNLÜ ölçülür) · kanıt: envanter 2026-09-05 öncesinde 8023'ü hiç listelemiyor ve 8026/8027'yi tek sahibe atfediyordu · devralınan: yok
- **[ES-25]** Aynı iki tabloya dokunan iki ayrı yol SATIR kilitlerini AYNI SIRADA alır ve sıra DEĞİŞMEZ olarak yazılır. **Değişmez (2026-09-12): kartela uzayında kilit sırası DAİMA düşüm başlığı → kartela; `MERGE_MAP` kural sırası bu değişmezin İKİZİDİR.** Sıra **düşüm defteri → kartela** (`swatch_stock_reductions` → `swatches`); bu yüzden `MERGE_MAP`te düşüm kuralı kartela kuralından ÖNCE gelir — birleştirme/geri alma ile kartela stok düşümü/stornosu eşzamanlı koşarsa 40P01 doğmaz. Advisory paylaşımı SEÇİLMEDİ: kartela stok işini birleştirme uzayına bağlamak iki alt sistemi gereksiz serileştirirdi · zorlama: kod yorumu (`constants/merge-map.ts`) + bekçi:`test_master_data_merge_revert.ts` (iki yönlü yarış sondası) · kanıt: arşiv 2026-09-12 ④ notu · devralınan: yok
- **[ES-16]** Uzay sabiti `export const X_LOCK_NS: number = 80NN;` biçiminde yazılır — açık `: number` olmadan literal tipe daralır ve bekçideki "uzaylar farklı" karşılaştırması TS2367 ile derlenmez; çağrıda çıplak sayı kullanılmaz · zorlama: tsc + bekçi:`test_shipment_scope_lock.ts §2` · kanıt: `period-guard.helper.ts` gerekçesi; `grep pg_advisory` → sabit dışı çıplak sayı 0 · devralınan: yok (iki anotasyonsuz sabit 2026-09-05'te tiplendi, 10/10)

---

## 6 · Bilinen boşluklar

Kimlikler bu tabloya özeldir; parantez içindeki kod keşif kaydındaki karşılığıdır (`docs/history/standart-2026-09-05/kesif/eszamanlilik.json`).

| # | Ne | Dosya:satır | Risk | Önerilen mekanizma | Neden ertelendi |
|---|---|---|---|---|---|
| AÇIK-1 (keşif ES-01) | "Ölü replay" yüklemi 15 token'lı modelin yalnız 3'ünde tek kaynakta; sevkiyat kuralı elle kopyalamış | `helpers/token-replay.helper.ts` ↔ `shipping.service.ts:1663-1673` | orta — cached `success:true` + iptal edilmiş kayıt | model-bağımsız `assertReplayAlive(kind, row)` | 12 ucun her birinde "ölü" tanımı ayrı (statü kümeleri farklı), tek turda ölçülemedi |
| AÇIK-2 (keşif ES-02) | Dört tablet ucu `clientToken`'sız: SubcontractorDispatch · KartelaDispatch · KartelaReceipt · StockCount | `subcontractor.service.ts:1051`, `kartela.service.ts:174`, `:470` | orta — mükerrer belge doğmaz (top claim'i korur, `subcontractor.service.ts:6438`) ama operatör "kayıt oldu mu" cevabını alamaz | kolon + replay dalı + istemci token gönderimi | APK ister (mobil native/sözleşme turu); bu turda YAPILMIYOR |
| AÇIK-3 (keşif ES-03) | 36 tx-dışı `findUnique→if→update` sitesi — hepsi yönetim/master-data, defter değil | `device.service.ts:322,345,401,416,429,476`, `auth.service.ts:191,253`, `peripheral.service.ts:176,210`, `traveler-template.service.ts:224,246`, `customer-branch.service.ts:223`, `reason-preset.service.ts:413`, `free-document.service.ts:83` | düşük — tek yönetici, düşük frekans, son-yazan-kazanır | atomik claim | **devralınan**: toplu kampanya yok; yeni kodda `[ES-03]` zorunlu |
| AÇIK-6 (keşif İ-13) | Fason talimatı güncellemesi tx dışı check-then-act | `subcontractor.service.ts:4753` → `:4785` | düşük — sevk fişi snapshot'ı donmuş, kâğıt etkilenmez | tx + claim | — |
| AÇIK-7 (keşif M-05) | `SackTag` adı check-then-act ile tekilleştiriliyor, DB seddi yok | `sack-tag.service.ts:132`, `:164` | düşük — eşzamanlı iki ekleme aynı adı yazar | yumuşak kapılı partial UNIQUE (`nameFold` deseni) | — |

> **KAPANDI — ölçüldü 2026-09-13.** Tabloda "bu turda düzeltiliyor" diye duran üç satır (AÇIK-4 refakat kartı sürüm claim'i · AÇIK-5 boot job'unda tx'siz yazım · AÇIK-8 advisory uzayında çift sahip) ağaçta doğrulandı ve kaldırıldı: `traveler-card.service.ts:285,395` `tx.travelerCard.updateMany` claim'i · `jobs/role-template-catalog.job.ts:208` `prisma.$transaction((tx) => …)` · `CODE_UNIQUE_LOCK_NS = 8029` (`services/helpers/code-unique.helper.ts:55`, envanter `services/helpers/period-guard.helper.ts:54`) + bekçi `scripts/test_advisory_lock_namespaces.ts`. ⚠️ Şimdiki zamanlı *"bu turda düzeltiliyor"* bir DURUM beyanıdır ve 2026-09-05'ten beri ölçülmemişti (`OLCUM-DISIPLINI.md` §7 — geçmiş/şimdiki zamanlı beyan, karşılıksız).

Ayrıca kapsam dışı bırakılan iki karar: backend'de yapılandırılmış logger yok (137 `console` çağrısı fiilen tek kanal) ve mobilde şema doğrulama katmanı yok (`zod` bağımlılığı yok) — ikisi de [`README.md`](README.md) § bilinen borç listesinde.
