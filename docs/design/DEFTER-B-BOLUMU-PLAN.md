# Defter B bölümü — ters yolu olmayan dört delik: KARAR ve PLAN

> **Durum: CANLI PLAN.** Kararlar verildi, uygulama sırada. İş bitince bu belge `docs/history/`e taşınır. Doktrin: `docs/kurallar/defter.md`. Hikâye: arşiv 2026-09-10 / 2026-09-11.

> Bu dosya bir EMİR listesidir: uygulayan oturum burada yazan kararı tartışmaz, uygular. Karara itirazı varsa ÖNCE yöneticiye yazar (`teks-erp-5e`), sonra kod yazar.

## Ortak zemin

Üçü de aynı doktrinden çıkar: *geri alma ters kaydı bugüne yazar, ileri kaydı ne siler ne değiştirir.* Ev deseni zaten kodda: `CariTransaction.reversesTxnId` (self-FK) · `ChequeEvent` (fromStatus→toStatus olay defteri) · `RollVariance.reversedAt` (damga) · `WarehouseEventType.*_REVERSAL` (tipli enum). **Yeni desen icat edilmeyecek**; her madde bu dördünden birini seçer ve seçimini gerekçelendirir.

Sektör dayanağı, hepsi için tek cümle: SAP'de bir belge silinmez — storno belgesi kesilir (`MBST` malzeme, `FB08`/`FBRA` muhasebe, `VL09` sevkiyat). Belgenin kendi tarihi ve aktörü kalır; iptal ayrı bir satırdır.

---

## B-1 · `Shipment` — iptal kolonu yok, geri alma damgayı siliyor ✅ **BİTTİ (2026-09-11)**

**Bulgu.** `Shipment` modelinde `cancelledAt`/`cancelledById`/`cancelReason` **hiç yok** (şemada 37 modelde var, iptal edilebilen tek belgede yok). `shipping.service.ts` geri almada `{ status: PLANNED, dispatchedAt: null, dispatchedById: null }` yazıyor — **sevk edildiği gerçeğini siliyor**. Kod yorumu doktrinle açıkça çelişiyor: *"Storno 'mal HİÇ ÇIKMADI' der."* SoD izni `shipping:undo-dispatch`ın kalıcı izi yok.

**KARAR: `ShipmentEvent` append-only olay defteri + iptal kolonları.**

Seçilen desen `ChequeEvent` (evde çalışan, olgun, `fromStatus`/`toStatus` taşıyan defter). Gerekçe: sevkiyatın durum çevrimi çekinkiyle aynı şekle sahip (ileri olay + tipli storno) ve tek seferlik `undispatchedAt` kolonu tekrarlanan sevk→geri al→sevk turunu taşıyamaz, ikinci turda birinciyi ezerdi.

- Yeni model `ShipmentEvent`: `shipmentId` · `type` (`PLANNED`·`DISPATCHED`·`UNDISPATCHED`·`CANCELLED`·`INVOICED`·`INVOICE_CLEARED`) · `fromStatus`/`toStatus` · `eventDate` · `reason` · `reasonCode` · `createdById` · `createdAt`. **`updatedAt` YOK** (append-only, [DB-09]).
- `Shipment`'a `cancelledAt` · `cancelledById` · `cancelReason` · `cancelReasonCode` — 37 modelin konvansiyonu.
- **`dispatchedAt`/`dispatchedById` ARTIK NULL'LANMAZ.** Anlamı "en son ne zaman sevk edildi"dir; güncel gerçeği `status` taşır. `@@index([status, dispatchedAt])` muhasebe listesi `status=DISPATCHED` ile süzdüğü için etkilenmez — **bunu bekçiyle kanıtla**, varsayma.
- Aynı yasak `invoiceNo`/`invoicedAt`/`invoicedById` için de geçerli: fatura işaretini kaldırmak `INVOICE_CLEARED` olayı yazar, damgayı ezmez.

**Kapsam dışı:** `SackAllocation`ın sil-yaz deseni bu maddede DEĞİL (③a, ayrı iş).

---

## B-2 · `Sack.weightKg` — tartı üzerine yazılıyor, sıfırlama siliyor ✅ **BİTTİ (2026-09-11)**

**Bulgu.** Yeniden tartı `weightKg`in üzerine yazıyor; tartı sıfırlama `weightKg`/`weightSource`/`weighedById`/`weighedAt` dördünü birden `null`'luyor. **İrsaliyeye ve faturaya giden brüt kg'ın önceki değeri hiçbir kalıcı kolonda yok** — tek iz audit, o da 6 ayda arşivleniyor.

**KARAR: `SackWeighing` append-only ölçüm defteri; `Sack.weightKg` denormalize "güncel" kalır.**

Tartı bir ÖLÇÜMDÜR, ölçüm defteri tutulur (emsal: `RollVariance` — çekme de ölçümdür ve defteri var). `Sack.weightKg` her yerde okunuyor; onu kaldırmak gereksiz büyük bir değişiklik olur ve doktrin durum kolonunu yasaklamıyor — **defterle desteklenmesini** şart koşuyor.

- Yeni model `SackWeighing`: `sackId` · `weightKg` (nullable — `CLEARED` olayında boş) · `weightSource` · `kind` (`WEIGHED`·`REWEIGHED`·`CLEARED`) · `weighedById` · `weighedAt` · `notes` · `createdAt`. `updatedAt` YOK.
- Sıfırlama artık **silme değil `CLEARED` olayı**; `Sack` kolonları yine boşalır ama defterde neden ve önceki değer durur.
- `markSackContentChangedTx`'in kg sıfırlaması da defter yazar — içerik değişince kg'ın düşmesi meşru ama **izsiz olmamalı**.

---

## B-3 · `PaymentAllocation` — çözme hard delete ✅ **BİTTİ (2026-09-11)**

**Bulgu.** Tahsisi çözmek satırı fiziksel siliyor (iki yer: toplu storno ve tekil `deallocate`). Üç sayaç düşüyor (`Invoice.paidTotal`, `Payment.allocatedTotal`, `Cheque.allocatedTotal`), geriye hiçbir satır kalmıyor: "fatura ne zaman kapandı, ne zaman kim açtı" cevapsız.

**KARAR: `revokedAt`/`revokedById`/`revokeReason` damgası. Negatif ters satır YASAK.**

⚠️ Gerekçe DB'dedir, tercih değildir: `payment_allocations_amount_positive` CHECK'i var (`test_db_invariants.ts` envanterinde kayıtlı). `CariTransaction`ın negatif-satır deseni buraya **uygulanamaz**; damga tek doğru yol.

- `PaymentAllocation`'a `revokedAt` · `revokedById` · `revokeReason` (+ istenirse `revokeReasonCode`).
- Sayaç düşümü bugünkü atomik yolunda kalır — `invoices_paid_total_range` ve `cheques_terminal_not_allocated` CHECK seddi **korunacak**; çift yüklem kuralı (finans Sınıf 4) bozulmayacak.
- **Okuyan HER yol `revokedAt: null` süzer** ve bu yüklem TEK helper'da yaşar (ayrışan yüzey sınıfı). Elle kopyalanan `WHERE` bir gün unutulur.
- `@@unique` yok, o yüzden partial unique işi YOK — bu madde ucuz olanı.

---

## B-4 · `RollOperation` ve `RollMovement` — defter satırı siliniyor

**Bulgu.** `RollOperation` şema başlığında append-only, kodda **7 yerde** `deleteMany`. `RollMovement` `updatedAt` taşıyor, bir satır iki olay tutuyor (girişte açılır, çıkışta üzerine yazılır), **4 yerde** siliniyor — üstelik `recompute` adım durumunu BU tablodan türetiyor, yani hem defter hem durum kaynağı.

**KARAR: İKİ FAZ. Aynı turda ikisini birden yapma.**

### Faz 1 — silmeyi durdur · `RollOperation` ✅ **BİTTİ (2026-09-11)** · `RollMovement` ⏳ BEKLİYOR

---

## ▶ B-4b DEVİR NOTU — `RollMovement` (sıradaki iş, taze oturum için)

> Bu bölüm tek başına yeterlidir: yeni oturum başka hiçbir yeri okumadan buradan başlayabilir. Önce `docs/kurallar/defter.md` (doktrin), sonra burası.

### Neden ayrıldı

`RollOperation` ile birlikte yapılacaktı; ölçüm ayırmayı gerektirdi. `RollMovement` **47 okuma yüzeyine** dokunuyor ve — kritik olan — `recomputeStepStatus` adım DURUMUNU bu tablodan **SAYARAK** türetiyor. Kaçırılan tek süzme yanlış adım durumu üretir; bu, üretim akışını bozan bir hatadır.

### Dört silme yeri

| Dosya | Satır | Bağlam |
|---|---|---|
| `workorder-manual-move.service.ts` | 666 | manuel taşımada hedef-sonrası hareketler |
| `subcontractor.service.ts` | 5145 | fason kabul iptali |
| `subcontractor.service.ts` | 5683 | fason transfer geri alma |
| `kursun-qc.service.ts` | 1104 | kurşun/QC2 geri alma |

### ⚠️ ASIL TEHLİKE — `recomputeStepStatus`

`helpers/roll-step.helper.ts:30`. Adım durumunu şöyle türetiyor:

```
openCount   = rollMovement.count({ …, exitedAt: null })
closedCount = rollMovement.count({ …, exitedAt: { not: null } })
```

Bugün silinen satır bu sayımlardan da düşüyor. Damgaya geçilince **her iki sayım da `revokedAt: null` süzmek ZORUNDA** — yoksa geri alınmış bir hareket "açık" ya da "kapalı" sayılır ve adım yanlış duruma geçer. Ayrıca aynı dosyadaki "giriş noktası" sorgusu ve `CANCELLED` top dışlaması da aynı yüklemle tutarlı kalmalı.

### Okuma yüzeyi dağılımı (47)

`inventory.service.ts` 15 · `kursun-bypass.service.ts` 9 · `tambur.service.ts` 6 · `tambur-undo.service.ts` 5 · `kursun-qc.service.ts` 4 · `helpers/roll-step.helper.ts` 4 · `subcontractor.service.ts` 3 · `workorder-split.service.ts` 2 · `work-session-activity.service.ts` 2 · `helpers/guarded-hard-remove.ts` 2 · `workorder.service.ts` 1 · `tambur-manual.service.ts` 1

⚠️ Bunların hepsi `findMany/count` DEĞİL: `RollMovement` satırı **girişte açılıp çıkışta ÜZERİNE YAZILIYOR** (`updateMany` ile `exitedAt`/`qtyOut` doluyor). Yani `update` çağrıları da listede ve onların `where`i de aktif satırı hedeflemeli — kapanış geri alınmış bir satırı kapatmamalı.

### Muhtemel istisnalar (B-4a emsali — ölç, varsayma)

- `helpers/guarded-hard-remove.ts` ×2 — silme guard'ı; geri alınmış hareket de "bu makinede üretim yapıldı" kanıtıdır → muhtemelen SÜZÜLMEZ.
- `backup-impact` benzeri yazma-hacmi ölçümleri varsa → SÜZÜLMEZ.
- Her istisnanın gerekçesi KODA yazılır ve bekçi "sessiz muaf yok" diye ölçer.

### Adım adım (B-4a'da işe yarayan sıra)

1. Şemaya `revokedAt`/`revokedById`/`revokeReason` — **model bloğuna kapsayarak düzenle**; `warehouseMovements` gibi alan adları birden çok modelde var ve düz string replace ÜÇ KEZ yanlış modele düştü.
2. Migration: üç nullable kolon + `(rollId, revokedAt)` composite index. `RollMovement`ta `@@unique` YOK, yani partial unique işi YOK — B-4a'nın en zor kısmı burada tekrarlanmıyor. **Ama DB'de şema-dışı bir partial UNIQUE var:** `roll_movements_one_open_per_roll_step_uq` (`WHERE "exitedAt" IS NULL`) — "bir top bir adımda en fazla BİR açık movement". Geri alınmış satır bu kısıtta yer işgal etmemeli → predicate `WHERE "exitedAt" IS NULL AND "revokedAt" IS NULL` olmalı. **Bu, maddenin en kritik tek noktasıdır.**
3. `helpers/roll-movement.helper.ts` aç: `ACTIVE_MOVEMENT = { revokedAt: null }` + `revokeRollMovements()` (B-4a'daki `roll-operation.helper.ts` birebir emsal).
4. Dört silmeyi revoke'a çevir.
5. 47 okuma yüzeyini süz; `recomputeStepStatus`ı ELLE ve DİKKATLE.
6. Bekçi + negatif sonda: en az iki sonda — (a) `ACTIVE_MOVEMENT` boşalt, (b) `recompute`ın bir sayımından süzmeyi kaldır. İkincisi yanlış adım durumunu göstermeli.
7. `test_db_invariants` envanterinde `roll_movements_one_open_per_roll_step_uq` predicate'ini güncelle.

### B-4a'dan üç ders (tekrarlama)

1. **Prisma'nın `@@unique`i CONSTRAINT değil INDEX'tir.** `DROP CONSTRAINT IF EXISTS` SESSİZCE hiçbir şey yapar; `DROP INDEX` gerekir. Migration "başarılı" der, drift yeşil kalır, yalnız davranış bekçisi yakalar.
2. **Ortam bağımlılığı tavanı yorumdaki literali de sayar** — gerekçe cümlesinde ham seed kullanıcı adını yazma; `ensureTestAdmin` fixture'ını kullan.
3. **Şema düzenlemesini model bloğuna kapsa.** Düz `replace` daha önceki özdeş satıra düşer.

### Faz 2 bu iş DEĞİL

`RollMovement`i "defter" ve "durum" diye ikiye bölmek AYRI ve daha büyük bir projedir; `WarehouseMovement`ın stok defterine dönüşümüyle birlikte planlanmalı. B-4b yalnız SİLMEYİ durdurur; açık/kapalı satır şekli DEĞİŞMEZ.

---


- `RollOperation`'a `revokedAt` · `revokedById` · `revokeReason`; 7 `deleteMany` → revoke.
- ⚠️ **Kritik ve atlanması kolay:** `@@unique([rollId, workOrderStepId, operationType])` var. Revoke edilmiş satır dururken aynı üçlü yeniden yazılamaz → kısıt **partial unique**'e çevrilir: `WHERE "revokedAt" IS NULL`. Şemada `@@unique` olarak BIRAKILIR (index↔unique farkı drift sayılır, [DB kuralı 3]) ve `test_db_invariants.ts` `EXPRESSION_UNIQUES`/`PARTIAL_INDEXES` envanterine satırı yazılır (iki yönlü, [DB-30]).
- `RollMovement` için de `revokedAt` + 4 `deleteMany` → revoke. Açık/kapalı satır şekli bu fazda DEĞİŞMEZ.
- `recompute` ve `computeWoInput` dahil okuyan her yol `revokedAt: null` süzer — tek helper.

### Faz 2 — defteri durumdan ayır (AYRI PROJE, bu turda YAPILMAZ)

`RollMovement`i iki nesneye böl: append-only hareket defteri (giriş olayı + çıkış olayı ayrı satır) ve adım durumu. Bu, `recompute`'un tüm tüketicilerine dokunur ve `WarehouseMovement`'ın stok defterine dönüşümüyle birlikte planlanmalı — ikisi aynı soruyu soruyor.

---

## Sıra ve kilit

Dördü de `prisma/schema.prisma` + migration istiyor. **Ortak çalışma ağacında şema aynı anda tek oturumun.** Sıra:

| # | İş | Boyut | Not |
|---|---|---|---|
| 1 | ~~B-3 `PaymentAllocation`~~ | ✅ **BİTTİ** | Migration `20260911120000`; 7+1 okuma yüzeyi süzüldü, §15s tripwire'ı eklendi. Sürpriz: yaşlandırma raporunun 7 ham SQL'i de süzülmek zorundaydı ve o raporun bekçisi YOK. |
| 2 | ~~B-1 `Shipment`~~ | ✅ **BİTTİ** | `ShipmentEvent` 6 olay + 4 iptal kolonu; damgalar artık null'lanmıyor. Doğuş (PLANNED) olayı da yazılıyor. |
| 3 | ~~B-2 `Sack` tartı~~ | ✅ **BİTTİ** | `SackWeighing` (WEIGHED/REWEIGHED/CLEARED); sıfırlama artık olay. |
| 4a | ~~B-4a `RollOperation`~~ | ✅ **BİTTİ** | 7 `deleteMany` → revoke; 26 okuma süzüldü, 3 bilinçli istisna. Partial unique İKİ migration aldı: Prisma'nın `@@unique`i INDEX'tir, `DROP CONSTRAINT` sessizce geçti ve bekçi §2 yakaladı. |
| 4b | B-4b `RollMovement` | ⏳ **BEKLİYOR** | 4 `deleteMany` + **47 okuma yüzeyi**; üstelik `recompute` adım durumunu BU tablodan türetiyor. Kaçırılan tek süzme yanlış adım durumu üretir → taze oturum işi. |

B-1 ve B-2 aynı serviste ve aynı migration turunda birleştirilir. B-3 ve B-4 ayrı oturumlar olabilir ama **şema kilidi sırayla devredilir**.

## Her madde için bitiş tanımı

- Migration `npx tsx scripts/apply-migration.ts <ad> --apply` ile (düz `migrate dev` YASAK — DEFERRABLE FK'ları düşürür).
- Şema-dışı nesne (partial unique) açıldıysa `test_db_invariants.ts` envanterine satır.
- Bekçi + **negatif sonda**: korunan davranışı bilerek boz, kırmızı gördüğünü rapor et, geri al.
- `npm test` yeşil (472 dosya, ~6 dk).
- `/karar-notu` ile arşiv + alan kural satırı.
- Kod yorumu 1–3 satır NEDEN söyler; tarih ve ölçüm anlatısı arşive gider.
