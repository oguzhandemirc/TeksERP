## 6. KRİTİK YAZMA YOLU MATRİSİ

Prompt Bölüm 4'ün sekiz sorusu, ürüne özgü **51 kritik yazma yolunun** her biri için ayrı ayrı cevaplandı (analiz: `audit/01-find/tur1-KYY-{1,2,3}-sekiz-soru.md`, yolların künyesi: `audit/00-map/KRITIK-YAZMA-YOLLARI.md`). Aşağıdaki matris o analizin özetidir: hangi yol hangi korumaya sahip, hangisinde eşzamanlılık bekçisi var, hangisinde kilit sırası ters (deadlock adayı), hangisinde işin bir parçası transaction dışında kalıyor.

### 6.1 Özet matris (51 yol)

`EŞZ` = gerçek paralel yazma sondası (K11 §4b) · `Token` = idempotency mekanizması · `Kilit` = birincil koruma · `ABBA` = ters sıra adayı (K3a §3.2, K3b §2.2) · `Tx-dışı` = atomik olması beklenebilecek işin bir parçası havuzda/ayrı tx'te.

| KYY | Yol | P | EŞZ | Token / replay | Birincil kilit | ABBA | Tx-dışı yazım | CTA açık |
|---|---|---|---|---|---|---|---|---|
| 01 | KK1 ham giriş | P0 | ✓ (bayrak açık) | partial unique + catch; **iptal-sonrası 4. durum YOK** | 8021 (bayraklı) + K | — | replay catch tx dışı | `existing.status` |
| 02 | Sevkiyat oluşturma | P0 | **✗** | düz unique + predicate ✓ | S claim döngüsü (istemci sırası) | ABBA-3 | — | hayalet/rejim pre-tx |
| 03 | Sevk onayı | P0 | **✗** | — (claim) | H claim → L sıralı | ABBA-4 (O1 ile) | — | boş/tartı pre-tx |
| 04 | Storno | P0 | ✓ (undo‖return) | — | 8023 İLK ✓ | — | — | ✓ |
| 05 | İade | P0 | ✓ (return‖undo) | **YOK** | 8023 **koşullu** | — | — | tek-sevkiyat pre-tx |
| 06 | İade iptali | P0 | ✗ | — | R claim; **8023 YOK** | — | — | sevkiyat statüsü okunmaz |
| 07 | PLANNED iptali | P0 | ✗ | — | H claim | — | — | ✓ |
| 08 | Çuval işlemleri | P0 | ✓ (scan‖kartela) | S1 düz unique ✓ | S touch (kaynak kilitsiz S3/S5) | ABBA-2 | — | `from.shipmentId` |
| 09 | Fason sevk | P0 | ✓ (steal) | **YOK** (küme guard pre-tx) | W İLK → R → A22 | ABBA-1 | SEPARATE `failed[]` yok | idempotency guard |
| 10 | Fason kabul | P0 | ✓ (zayıf) | düz unique, **predicate'siz wBR** | W İLK → R → A22 → K | ABBA-1 | `changeWidth/Color` best-effort | step/nextStep |
| 11 | Kalan kapama | P0 | ✗ | — | W → R claim (step pin'siz) | — | — | nextStep |
| 12 | Makbuz iptali LIFO | P0 | ✗ | — | W → claim'ler (receipt claim sonda) | — | — | **LIFO pre-tx** |
| 13 | Doğrudan sevk | P0 | ✓ | — (`alreadyDirectShipped`) | W → R → K → L → O | — | — | ✓ |
| 14 | Tambur finalize | P0 | ✗ | `finalizeWarehouseCut` **token yazmıyor** | W → R(parent) claim; K tx ÖNCE | — | sayaç tx öncesi (bilinçli) | ✓ (ikiz) |
| 15 | Tambur kesim | P0 | ✓ (yalnız aynı token) | partial unique + catch | R(parent) guarded update; K tx ÖNCE | — | — | ✓ |
| 16 | Tambur geri alma | P0 | **✗** | MANUAL 409 ✓ | **WO kilidi YOK** | Step→WO ↔ WO→Step | — | WO status kilitsiz |
| 17 | Manuel top | P0 | ✗ | zorunlu token ✓ (+ iptal 409) | R claim → **W sonra** | H-11 | FAZ1/FAZ2 iki tx (belgeli) | parti |
| 18 | KK2 finish/reopen/QC2 | P0 | ✗ | op unique (QC2) | W İLK → raw claim; **K tx içi** | — | — | caps bayat |
| 19 | Kurşun bypass | P0 | ✓ | partial unique | W İLK (model) | — | — | ✓ |
| 20 | WO oluşturma | P0 | ✓ (lock) | partial unique + `isActive:false` 409 ✓ | — ; **Q havuz tx içinde** | — | quickStart zinciri (belgeli) | doğrulamalar pre-tx |
| 21 | Top bağla/sök | P0 | ✗ | — | R claim → A22 → **W sonda** | ABBA-1 | — | WO statüsü pre-tx |
| 22 | Kapanış dispozisyonu | P0 | **✗** | — | W İLK → R → A22 → K | ABBA-1 | — | stepIds |
| 23 | WO iptali/arşiv | P0 | ✓ (softDelete) | — | W claim İLK | H-1 | **tx-ÖNCESİ havuz updateMany** | ✓ |
| 24 | Manuel taşıma/split | P0 | ✗ | — | R claim → A22 → W sonda (P3 W İLK) | ABBA-1 | — | ctx pre-tx |
| 25 | WO plan düzenleme | P1 | ✗ | — | W6/W7 ✓; **W8 YOK** | — | renk/en havuz claim + dirty ayrı | W8 tamamen |
| 26 | Sipariş bağla/sök | P0 | ✗ | PK skipDuplicates | **W kilidi YOK** | ABBA-4 (O1) | override zinciri | plan guard'ları pre-tx |
| 27 | Parti no + cerrahi | P0 | SIRA (sahte tx) | — | 8022 İLK (fonk.) — tx'te W sonra | 8022↔W | — | ✓ (cerrahi) |
| 28 | Belge no / barkod | P0 | ✓ (sayaç) | wBR (21/25 predicate'siz) | Q kilitsiz; K satır | — | closure tx-dışı iş | max+1 |
| 29 | Sipariş oluşturma | P0 | ✗ | partial unique ✓; 4. durum ? | R claim (O2) | — | **O2 create tx dışı** | — |
| 30 | Sipariş/kalem iptali | P0 | ✓ (manualComplete/reopen) | — | O claim; O1 L(tek)→W→L(hepsi) | **ABBA-4** | **O5 WO iptalleri tx dışı** | `getActiveShipmentLinks` |
| 31 | Kartela | P0 | ✓ (scan‖dispatch) | **dispatch/receive YOK**; reduce ✓ | claim'ler; sayaç kilitsiz | — | — | ✓ |
| 32 | Top düzeltme/iptal/fire | P1 | ✗ | — | R claim (statü/qty pin'siz) | — | restore/prepare tx'siz claim | kapsam pre-tx |
| 33 | Refakat kartı | P1 | ✓ (print, void) | DB unique + retry | koşulsuz update | — | plan havuzda (belgeli) | reprint read+1 |
| 34 | Donmuş belge | P1 | ✗ | — | `max+1` kilitsiz; reissue claim ✓ | — | GET lazy-init havuz | snapshot havuz |
| 35 | Etiket print-event | P1 | ✗ | — | **yok** (3 yazım tx'siz) | — | ✓ | labelDirty çift-mod |
| 50 | Fatura izi | P1 | ✗ | — | havuz claim ✓ | — | — | — |
| 51 | shippedQty türetimi | P1 | ✗ | — | L tam-küme (2 çağıran kilitsiz) | ABBA-4 | — | lost-update |
| 39 | Yetki | P2 | ✓ (deactivate) | upsert | 8025 (grant yolunda YOK) | — | createUser havuz | diff tx dışı |
| 40 | Kimlik/oturum | P2 | ✓ (lockout) | — | 8024 İLK ✓ (bekçisiz) | — | lockout bellek | — |
| 41 | Çalışma oturumu | P2 | ✓ | — | partial unique | — | `current` GET yazıyor | occupant pre-tx |
| 42 | Cihaz | P2 | ✓ (announce) | upsert | — | — | havuz | `found` |
| 36 | Merge | P3 | **✗** | — | 8027 İLK ✓ (bekçisiz) | — | `markMerged` | preview conflicts |
| 37 | Ana veri | P3 | ✓ (yalnız Item) | — | 8026 (yalnız Item) | — | GHR guard havuz; FabricProperty iki adım | ad/kod pre-tx |
| 38 | İçe aktarma | P3 | ✗ | token yalnız bitmiş koşum | **yok** | — | satır satır (bilinçli) | — |
| 43 | Feature-flag | P3 | ✗ | — | — (upsert) | — | job'lar sanitize dışı | — |
| 44 | Boot job'ları | P3 | ✗ | skipDuplicates | `started` bayrağı | — | — | — |
| 45 | Audit/arşiv | P3 | ✗ | — | SET LOCAL sırası ✓ | — | best-effort (tasarım) | — |
| 46 | Yedek/offsite | P3 | ✓ (2× run) | — | bellek bayrağı (tek process) | — | FS | damga başta |
| 47 | DB kopyası | P3 | ✓ (sahte) | — | bellek claim | — | DDL | verify allowlist yok |
| 48 | OTA | P3 | — | — | — | — | — | — |
| 49 | Sebep kataloğu | P3 | ✗ | — | — | — | `nextFreeCode` tx dışı | ✓ |

**Sayılar:** 51 yol · P0 31 · P1 6 · P2 4 · P3 10. Gerçek paralel yazma sondası olan yol **20/51**; para/stok etkili ve **EŞZ ✗**: KYY-02, 03, 14, 16, 22 (K11 H-3/H-5/H-6). Tx-öncesi/dışı yazımı olan yol 12 (belgeli 6: 17, 20, 29, 38, 45, 33 — belgesiz 6: 23, 30, 09 SEPARATE, 34 lazy-init, 35, 25 dirty). ABBA adayı taşıyan yol 12. clientToken taşımayan yaratıcı yol: 05 (iade), 09 (fason sevk), 31 (kartela dispatch/receive), 38 (uçuşta), 14 (`finalizeWarehouseCut`).

---
