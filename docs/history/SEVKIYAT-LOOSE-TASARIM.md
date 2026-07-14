# Sevkiyat & Üretim — Gevşek (Loose) Model Tasarımı

> ## ⚠️ BU DOKÜMAN ARTIK GEÇERLİ DEĞİL (SÜPERSEDED)
> **1. katman (2026-06-04):** "gevşek/L1" tasarım (`targetOrderLineId`, relabel,
> `/shipping/relabel`, `auto-assign`, reprint-queue) koda girmedi / kaldırıldı.
> **2. katman (2026-07 — GÜNCEL):** Aşağıda anlatılan `markReady` anında spec-toplam FIFO
> (`ShipmentAllocation`) + PREPARING/READY ara modeli de artık **ÇUVAL HAVUZU ("B") modeline
> superseded**: çuval **müşteriye ait** (`Sack.customerId`), aç→okut→**mühürle** →
> `rebalanceCustomerPool` FIFO ile `OrderLine.packedQty` rezervi (`SackAllocation`); sevkiyat
> `createShipment({sackIds})` ile havuzdan kurulur (PLANNED→DISPATCHED); `ShipmentOrder`
> türetilir; `markReady`/`ShipmentAllocation`/`retarget`/PREPARING-READY **kaldırıldı**.
> **Kanonik referans:** `CUVAL-HAVUZU-TASARIM.md` + `scripts/test_sack_pool_lifecycle.ts` +
> `schema.prisma` (§Shipment/Sack/SackAllocation). Bu doküman yalnız tarihsel kararlar için tutuluyor.

> **Durum (tarihsel):** TASARIM — henüz kod yazılmadı. Bu doküman, sahada test edilecek
> "gevşek" sevkiyat/üretim akışının üzerinde anlaşılan kararlarını tutar.
> Sahada gerçek senaryolara göre noktasal sıkılaştırılacak.

## 0. Felsefe

- **Geç bağlama (late binding):** Mal son ana kadar (sevk = tartı/kapat) **sahipsiz/serbest**. Bağ üretimde değil, sevkte kurulur.
- **Sistem gösterir, zorlamaz.** Hiçbir adımda operatör "yapamazsın" duvarına çarpmaz; sistem önden engellemez, arkadan sayar.
- **İki soru her zaman canlı cevaplı:** (1) bu üründen ne kadar isteniyor / ne kadar var (Ürün Dengesi), (2) bu sipariş ne kadar doldu (Karşılanma). İkisi de deftere değil **sahanın o anki haline** bakar → kaos bozamaz.
- **L1, L0 değil:** Alanları (etiket) tut, sadece **zorlamayı** kaldır. Sıkıya geçiş ileride bayrak açmakla olur (şema göçü değil).

## 1. Kaplin seviyesi — L1 (gevşek ama türetilebilir)

- `Roll.targetOrderLineId` **var** ama hiçbir üretim adımında **zorlanmaz** (guard yok). Tambur/depo/üretim bakmaz, bloklamaz.
- Bağ **sevk anında** (tartı/kapat) türetilir; `recomputeOrderStatus` aynen çalışır.
- Sıkıya geçiş = enforcement bayrağı; alan zaten yerinde (ucuz).

## 2. Ürün Dengesi (çatı kavram)

**Birim = spec (item + renk + en).** Aynı spec'in topları/siparişleri birbirinin yerine geçer (fungible).

| TALEP | ARZ |
|---|---|
| Açık sipariş metrajı (openQty) | Depoda hazır (WAREHOUSE) |
| | Üretimde (WIP / IN_PRODUCTION) |
| | Ham stok (STOCK) |
| | Fasonda (AT_SUBCONTRACTOR) |

`DENGE = Σ arz − Σ talep` → eksi: üret, artı: fazla.

**Üç yakınlaşma seviyesi (hepsi aynı defter):**
- **L0 Genel:** tüm spec'lerin denge listesi (fabrikanın nabzı).
- **L1 Ürün:** tek spec'in defteri + hangi sipariş/WO/toplar.
- **L2 Sipariş/Top:** tek siparişin kapsama paneli (aşağıdaki §3).

**Kurallar:** salt görünürlük, **rezerv yok**, anlık fotoğraf, çift sayım mümkün → planlamacı karar verir. Sahada sorun olursa "yumuşak rezerv" eklenir.

## 3. Karşılanma + Kapsama (coverage)

**Mevcut (koddа var):**
- `shippedQty = SUM(Roll.currentQty | targetOrderLineId ∈ siparişin kalemleri AND status=SHIPPED)` — `order-status.helper.ts`.
- `openQty = istenen − sevk − WO-rezerve` (`WorkOrderToOrderLine.allocatedQty`, canlı WO'lar) — `order.service.ts`.

**Eklenecek — 4. kova (serbest stok):**
- item+renk+en eşleşen, **hiçbir kaleme etiketli olmayan** WAREHOUSE/STOCK toplar.
- WO açma ekranında **kapsama paneli**:
  ```
  İstenen            2000
  − Sevk edilen         0
  − Üretimde (WO)    1500
  − Depoda hazır      600   (WAREHOUSE)
  − Ham stok          400   (STOCK — ayrı göster: ham, üretim gerekebilir)
  = Net üretim açığı −500 → "Üretim gerekmeyebilir. Yine de WO aç?"
  ```
- Spekülatif fazla (henüz üretilmemiş) **sayılmaz**; üretilince otomatik kovaya düşer.

## 4. Paketleme (8. adım) — A + C

**Çuval = müşteri seviyesi** (bir müşterinin birden çok siparişinin topunu taşıyabilir). Bağ tartıda kesinleşir.

**Sevke Hazır tanımı (resmî):** açık sipariş satırına **etiketli** (`targetOrderLineId ≠ null`) + henüz **çuvalda olmayan** (`sackId = null`) **depodaki** top (`status = WAREHOUSE`). `getReadyForShipping` bunu kullanır.

**Mod A — sipariş-önce (planlı):** "Sevke Hazır" listesi (termine göre sıralı) → birine bas → o müşteriye çuval açılır (aktif).

**Mod C — top-önce (kapışmaca):** Hızlı Okut → algoritma müşteriyi bulur.

**Çekirdek algoritma (top okutunca):**
```
1. Topu oku → spec + (varsa) not-etiketi (tamburdan, sadece ipucu)
2. AKTİF çuval var mı?
   ├─ VAR + top o müşterinin açık siparişine uyuyor → direkt çuvala
   ├─ VAR ama uymuyor → [Yine de bu çuvala koy] [Yönlendir]
   └─ YOK → ADAY BUL (spec'e uyan açık siparişler, sıra: not-etiket → termin → FIFO)
        ├─ 1 aday   → onayla → çuval
        ├─ çok aday → kısa liste, operatör seçer
        └─ 0 aday   → [Stok sevki: müşteri seç] [Bırak]
3. Müşteride açık çuval varsa ekle, yoksa aç+ekle → aktif çuval bu olur
4. Karşılanma ŞİMDİ değil — çuval kapanınca (tartı) kesinleşir
```

**Gevşek kurallar:** eşleşme spec'e göre (renk/en null → daha gevşek); not-etiket ipucu, kural değil; rezerv yok; `[Yine de koy]` override + audit. Manuel "boş müşteri seç" sadece istisna (stok satışı).

## 5. Değişebilir Etiket (yönlendir / relabel)

İki ayrı şey: **(a) dijital atıf** (`targetOrderLineId`) + **(b) fiziksel kâğıt**.

- **Atıf güncelleme:** topun **bulunduğu yerde tabletle okut** (depo/paket), her yerden, anında. → `POST /shipping/relabel { rollId, targetOrderLineId }` → **iki siparişi** recompute (eski −, yeni +) + **audit**. WAREHOUSE & STOCK kabul.
- **Stok bozulmaz:** relabel bir **atıf** işi, stok **hareketi değil**. Top eklenmez/silinmez/taşınmaz; sadece "kime sayılıyor" değişir.
- **Barkod/kimlik DEĞİŞMEZ:** aynı barkod reprint = fiziksel sticker'ın çapası (karışma olmaz).
- **Çuval bütünlüğü:** top AÇIK bir çuvaldayken farklı müşteriye yönlendirilirse (veya stoğa alınırsa) topu çuvaldan **otomatik çıkarır** — çuval tek-müşteri kalır. (Çapraz sevk serbest, çuval bozulmaz.)
- **Finalite:** SHIPPED/iptal/scrap/tüketilmiş top + **iptal/tamamlanmış** hedef sipariş relabel kabul etmez.
- **Uyumsuz etiket** (renk/en tutmuyor): **uyar-geç** (override + audit), sert blok değil.
- Topu seçme yolları (okutma şart değil): pakette zaten okutuyorsun; depoda barkod-no yaz / siparişten / listeden ("şu WO'nun fazla topları", "X'e etiketli toplar"); top hiç yoksa siparişe **manuel etiket** (eşleşme tartıda kapanır).

## 6. Etiket Baskısı — tek yazıcı (Tambur)

**Donanım gerçeği:** okuma **her yerde** var (tablet kamerası), baskı **sadece tamburda**.

**İki katmanlı etiket:**
- **Üretim etiketi:** spec + barkod + metraj, **MÜŞTERİSİZ**.
- **Müşteri/sevk etiketi:** gerçek müşteri + müşterideki ad (`customerItemName`/`customerColorName`) + sipariş.

**Tambur kesim davranışı:**
| Tambur ne kesiyor | Ne basar |
|---|---|
| Sipariş-içi (WO'da sipariş var, ona kesiyor) | **Müşteri etiketi HEMEN** — doğru, rework yok ✓ (mevcut davranış, korunur) |
| Fazla / belirsiz | **Müşterisiz spec etiketi** |

**Okumayı ve baskıyı ayır:**
```
1. Topu bulunduğu yerde tabletle okut → atıf ANINDA güncellenir (her yerden)
2. Fiziksel etiket → TAMBUR yazıcısına PRINT-QUEUE → tambur basar → kâğıt götürülür
   → aynı barkodla eski sticker'ın yerine yapıştırılır
```
Top tambura **taşınmaz**, sadece **kâğıt** çıkar. (Print-queue deseni projede zaten var — KK1.)

**Kök sebep teyidi:** `label.service.getRollLabel` final etiketi topun `targetOrderLineId`'sinden müşteri adı + müşterideki adı çekip basıyor → "X'e üretildi Y'ye gitti" yanlış etiket sorununun kaynağı bu. Spec-only üretim etiketi + son-anda müşteri etiketi bunu kökten çözer.

## 7. Onaylanmış mikro-kararlar

- STOCK topu etiketlenip sevke girince → **WAREHOUSE'a alınır**.
- relabel endpoint → **`/shipping/relabel`**.
- Uyumsuz etiket → **uyar-geç** (override + audit).

## 8. Mevcut altyapı (yeniden kullanılacak)

- Backend: `/api/shipping` → Sack/Shipment/Manifest (sack-tabanlı, çalışıyor).
- Mobil: `TartiPaketScreen` (müşteri-bazlı çuval, `packing.service`) + `SevkiyatScreen`.
- `order.service`: `openQty` (shipped + reserved) hesabı.
- `order-status.helper`: `recomputeOrderStatus`.
- Print-queue deseni (KK1).

**Ölü/yetim (temizlenecek):** `shippingQueue.service.ts`, `order.service.getReadyOrders` (mobil), `SacksPanel`/`QueueListView`/`RequirementsPanel` (kullanılmıyor).

## 9. Build durumu

Build sırası: backend `ready` + `relabel` → kapsama paneli → ekran A → C → relabel UI + print-queue.

- ✅ **Faz 1 — backend (2026-06-01):** `GET /shipping/ready` + `POST /shipping/relabel` yazıldı (`shipping.service/controller/routes`). Migration/permission yok (mevcut `shipping:read/write`). typecheck+lint temiz; `ready` mantığı yerel DB'de doğrulandı (Arda · 2 hazır top). Adversaryel inceleme sonrası düzeltmeler: COMPLETED sipariş bloğu, çuval-bütünlüğü pop, no-op şekil tutarlılığı.
- ✅ **Faz 2 — kapsama paneli (2026-06-01):** backend `POST /api/orders/order-lines/coverage` (`OrderService.getCoverageForLines` — istenen/sevk/WO-rezerve/serbest depo/ham stok → net açık; 4. kova = etiketsiz eşleşen stok, rezerve yok) + frontend `CoveragePanel.tsx` WO formunda seçili kalemlerde. typecheck+lint temiz; mantık yerel DB'de doğrulandı (Arda: istenen 1500 − rezerve 1500 − serbest depo 3400 = net −3400 fazla).
- ✅ **Faz 3 — ekran A / Sevke Hazır (2026-06-01):** mobil `packing.service.getReady()` + `ReadyToShipList.tsx` (termine göre sipariş kartları, hazır top/kalan) + `TartiPaketScreen` girişine bağlandı; "Çuvala Başla" → müşterinin açık çuvalına odaklan ya da aç + okuyucu açıl. Ekran tek scroll'a alındı; pack/weigh sonrası ready listesi invalidate. tsc temiz.
- ✅ **Faz 4 — C / Hızlı Okut (2026-06-01):** backend `POST /shipping/sacks/auto-assign { barcode }` (`autoAssignByBarcode` — top WAREHOUSE+etiketli → müşterinin açık çuvalına ekle, yoksa aç; stok etiketli reddedilir) + mobil `packing.service.autoAssign` + TartiPaketScreen "Hızlı Okut" butonu + ikinci tarayıcı (müşteri seçmeden seri okutma). tsc+lint temiz. Bilinen sınır: çok-operatör eşzamanlı find-or-create aynı müşteriye 2 açık çuval üretebilir (sıralı tek-operatörde sorun yok; çuval bozulmaz).
- 🟡 **Faz 5a — Relabel UI (2026-06-01):** mobil `packing.service.relabel` + paylaşılan `RelabelSheet.tsx` (topun spec'ine uyan açık sipariş kalemleri → yönlendir, ya da "Stoğa Al"; specMismatch uyarısı + "tambur yazıcısından yeniden bas" notu) + TartiPaketScreen'e "Yönlendir" butonu/tarayıcısı. tsc temiz.
- 🟡 **Faz 5b — Depo relabel (2026-06-01):** `DepoScreen` toolbar'ına "Yönlendir" butonu (swap-horizontal) + paylaşılan `scanPurposeRef` ile aynı tarayıcıyı detay/relabel için ayırma + `onModalHide` deseniyle `RelabelSheet` açılır. tsc temiz. → relabel artık hem Paket hem Depo'da (2+3 STOCK dahil).
- 🔎 **İnceleme 2 (Faz 4/5, 2026-06-01):** 3 mercek × bağımsız doğrulama (31 ajan), 7 bulgu. **Düzeltildi:** `autoAssignByBarcode` + mevcut `assignRoll` artık **COMPLETED/CANCELLED** siparişe ait topu reddediyor (kapalı siparişe paketlemeyi engeller; finalite relabel'le tutarlı). **Kabul/eleme:** no-op audit (no-op zaten işlemsiz), `reprintRequired` (ana yol yalnız değişiklikte çalışır), FK optional-chain (kısıt garanti). **Bilinen dar yarış:** top OPEN siparişe paketlendikten sonra, weigh'den önce sipariş başka sevkle COMPLETED olursa, weigh'de o topun metrajı zaten-tamamlanmış siparişe eklenmez (hafif eksik `shippedQty`); loose "weigh'de bloklama yok" felsefesiyle kabul.
- ✅ **Faz 5c — tambur print-queue (2026-06-01):** `Roll.needsReprint` alanı (migration `20260601022007_add_roll_needs_reprint`, **yerel DB'ye additive uygulandı, 29 top korundu**). `relabelRoll` artık `needsReprint=true` set ediyor. Backend `GET /shipping/reprint-queue` + `POST /shipping/reprint-queue/done`. Mobil `ReprintQueueSheet.tsx` + Tambur header'ında **printer-alert badge** (sayım>0 olunca görünür) → liste → "Bastım" kuyruktan düşürür. RelabelSheet relabel sonrası badge'i invalidate eder. tsc+lint temiz.

## 10. Senaryo kararları (sabitlendi 2026-06-01)

1. **Tambur kesim kararı → A (MEVCUT, korunur).** Tambur ekranı WO'ya bağlı siparişlerin müşteri adlarını **inline kısayol** gösteriyor (`activeJob.context.orders`, doğrulandı `TamburScreen.tsx:1095-1112`); operatör seçip o siparişe keser → `targetOrderLineId` set. Seçmezse `null = stok` (= spec-only / müşterisiz). Tek sipariş→tek kısayol, çoklu→çoklu kısayol. **Modal gerekmez** (mevcut "Listeden Seç" picker yalnız opsiyonel arama fallback'i). → Yeni build yok; tek iş: `null` kesimde **spec-only etiket** basımını §6 iki-katman kararına bağla.
2. **Sipariş uçuşta değişti/iptal → A.** Hiçbir şey durmaz; iptal/azalmada akıştaki topların etiketi serbest/spec'e döner, stok havuzuna akar, denge otomatik güncellenir. Artışta açık talep büyür, kapsamadan karşılanır.
3. **Kısmi sevk + kalan → A.** Sipariş PARTIAL kalır; kalan "açık talep" olarak Ürün Dengesi + kapsama panelinde görünür; yeni WO/stoktan karşılanır. Ekstra aksiyon yok (türetilmiş).
4. **İade / geri dönen mal → C (şimdilik kapsam dışı).** Sahada gerçek senaryo netleşince tasarlanır.
5. **Fason dönüşü → A.** Fasondaki mal "fasonda (AT_SUBCONTRACTOR)" kovasında arzda görünür; dönünce hazır/üretimde'ye geçip otomatik dengeye yansır.
6. **Numune / kartela (swatch) → A.** Çuvala top gibi eklenir (mevcut sack-swatch desteği), sevkte beraber gider, siparişe sayılmaz.
