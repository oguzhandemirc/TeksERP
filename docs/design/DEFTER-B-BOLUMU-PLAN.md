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

### Faz 1 — silmeyi durdur (bu turun işi)

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
| 4 | B-4 Faz 1 | orta-büyük | Partial unique riski burada; en son, tek başına. |

B-1 ve B-2 aynı serviste ve aynı migration turunda birleştirilir. B-3 ve B-4 ayrı oturumlar olabilir ama **şema kilidi sırayla devredilir**.

## Her madde için bitiş tanımı

- Migration `npx tsx scripts/apply-migration.ts <ad> --apply` ile (düz `migrate dev` YASAK — DEFERRABLE FK'ları düşürür).
- Şema-dışı nesne (partial unique) açıldıysa `test_db_invariants.ts` envanterine satır.
- Bekçi + **negatif sonda**: korunan davranışı bilerek boz, kırmızı gördüğünü rapor et, geri al.
- `npm test` yeşil (472 dosya, ~6 dk).
- `/karar-notu` ile arşiv + alan kural satırı.
- Kod yorumu 1–3 satır NEDEN söyler; tarih ve ölçüm anlatısı arşive gider.
