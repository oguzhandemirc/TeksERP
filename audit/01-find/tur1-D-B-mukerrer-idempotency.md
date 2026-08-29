# D-B — Mükerrer veri & idempotency [P0] · ② BULMA, TUR 1

**Denetçi:** D-B · **Tarih:** 2026-08-28 · **HEAD:** `ce8681d1` (dal `adnansahin`)
**Kapsam:** Prompt Bölüm 3-B (B.1 DB tekilliği · B.2 varsa-güncelle-yoksa-ekle yarışı · B.3 API idempotency · B.4 entegrasyon/içe aktarım/watermark · B.5 mantıksal mükerrer ana veri)
**Veri kaynakları:** dev `adnansahin_db` (195 migration) · prod kopyası `tekserp_saha_0825` (2026-08-25, 190 migration) — ikisi de SALT-OKUNUR
**Repro:** 4 script — loglar `audit/repro/`. ⚠️ Script adları ile bulgu id'leri BİREBİR DEĞİL (scriptler bulgular numaralanmadan önce yazıldı); eşleme:

| Script | Log | Hangi bulguyu ispatlar |
|---|---|---|
| `Teks-Erp/scripts/audit_repro_D-B-01.ts` | `audit/repro/D-B-01.log` | **D-B-01** (iptal edilmiş kaydın replay'i) |
| `Teks-Erp/scripts/audit_repro_D-B-03.ts` | `audit/repro/D-B-03.log` | **D-B-03** (predicate'siz `withBarcodeRetry` + fason kabul) |
| `Teks-Erp/scripts/audit_repro_D-B-05.ts` | `audit/repro/D-B-05.log` | **D-B-04** (§1 uçuşta çift koşum) ve **D-B-05** (§2 farklı gövde yutulması) |
| `Teks-Erp/scripts/audit_repro_D-B-06.ts` | `audit/repro/D-B-06.log` | **D-B-02** (ad-mükerrer yarışı) |

---

## 0. Yönetici özeti

| # | Bulgu | Şiddet | Kanıt |
|---|---|---|---|
| D-B-01 | İptal edilmiş kaydın token'ı replay edilince `success:true` + iptal edilmiş kaydın kimliği dönüyor (KK1 ham giriş **ve** sipariş) | **S1** | K3 |
| D-B-02 | Ad-mükerrer guard'ı kilitsiz check-then-act; DB seddi 17 `nameFold` tablosunun 3'ünde ve **`items` sahada YOK** | **S1** | K3+K2 |
| D-B-03 | Fason mal kabulünde `withBarcodeRetry` predicate'siz + dış catch yok → token çakışması "Barkod üretimi 5 denemede başarısız" olur; kısmi kabulde ikinci kapı da yok → **ikinci kısmi makbuz** | **S1** | K3 |
| D-B-04 | İçe aktarım token'ı UÇUŞTAKİ tekrarı kapatmıyor → aynı dosyadan **2 sipariş**, kaybeden koşumun `ImportRun`+audit izi YOK | **S2** | K3 |
| D-B-05 | Aynı token FARKLI gövde ile içe aktarım → önceki koşumun sonucu döner, yeni dosya **sessizce yutulur** | **S2** | K3 |
| D-B-06 | Sipariş içe aktarımının mükerrer uyarısı yalnız müşterinin EN SON siparişine bakıyor → araya bir sipariş girdiyse uyarı hiç çıkmaz | **S2** | K1 |
| D-B-07 | İçe aktarım anahtar katlaması `toLocaleUpperCase("tr-TR")` — i-ailesinde asimetrik; 228 kumaş kodunun **63'ü** i/I içeriyor → harf farkıyla yazılan satır UPDATE yerine CREATE'e düşüp ERROR alıyor | **S2** | K2 |
| D-B-08 | Katlanmış KOD tekilliğinin 8026 kilidi 4 çağrı yerinin yalnız 1'inde (`item.service`) | S3 | K2 |
| D-B-09 | Replay yanıtında payload-özdeşlik kontrolü 4 yolda var, 4 yolda yok (`createOpenFabric`, `openSack`, `createShipment`, fason makbuz) | S3 | K1 |
| D-B-10 | LIFO/recency guard'ları `createdAt: { gt: … }` — eşit damgada sessizce açılır (id/sıra tabanlı değil) | S3 | K1 (saha ihlali 0) |
| D-B-11 | `freezeForSource` `max(version)+1` okuma-sonra-yazma, P2002 yakalanmıyor → çakışmada ÇAĞIRAN iş tx'i (sevk/kabul) teknik hatayla düşer | S3 | K1 |
| D-B-12 | `Batch.batchNumber` bilinçli unique DEĞİL (saha'da 92 tekrar grubu) ama "batchNumber ile lookup yapma" kuralının mekanik bekçisi yok | S4 | K2 |
| D-B-13 | `device.announce` upsert'ü `include` taşıyor → atomik DB-upsert dışına düşebilir; kimliksiz uçta çakışma teknik 409 üretir | S4 | K0/K1 |

**Ölçülen saha gerçekleri (`tekserp_saha_0825`):** belge numaralarında (İE/SIP/SVK/çuval/FS/FK) mükerrer **0** · top barkodunda mükerrer **0** (148 barkodsuz açık kumaş) · `printed_documents (docType,sourceId,version)` mükerrer **0**, `(docType,sourceId)` başına ACTIVE>1 **0** · cari VKN mükerreri **0** · `customers/subcontractors/colors` katlanmış ad mükerreri **0** · **`items` katlanmış ad mükerreri 1 grup** (`v-1430`: `BGR150`+`MC155`) · **`items` harf-farklı kod mükerreri 8 grup / 9 fazla satır** · `batches` numara tekrarı **92 grup (bilinçli)** · `rolls` iptal sebebi *"Mükerrer giriş — aynı top iki kez kaydedildi"* **8 satır** (fabrika elle temizlemiş) · `clientToken` taşıyan CANCELLED top **227** · `subcontractor_receipts` `clientToken` dolu **2/143** · `import_runs` **0 satır**.

---

## D-B-01 — İptal edilmiş kaydın token'ı replay edilince sunucu "kaydedildi" diyor; kayıt envanterde YOK

| Şiddet | **S1** | Kategori | B.3 | Öncelik | **P0** | Modül | KK1 ham giriş + Sipariş | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Aynı `clientToken` ikinci kez geldiğinde sunucu mevcut kaydı döndürüyor — ama o kaydın **hâlâ geçerli olup olmadığına bakmıyor**. Top iptal edilmişse (ya da sipariş iptal edilmişse) operatör *"Top zaten kayıtlı (idempotent retry). Barkod: T…"* / *"Sipariş zaten oluşturulmuş"* yazısını görür, işi bitmiş sayar ve gider; envanterde/sipariş listesinde o kayıt yoktur. Beceri paketi bunu idempotency'nin **en pahalı hatası** olarak adlandırıyor ("sessizce yanlış cevap 409'dan daha kötüdür"). Aynı sistemde doğru desen ZATEN VAR — `tambur-manual` ve fason makbuzu iptal edilmiş kaydı 409 ile reddediyor.

**Kanıt.**
- `Teks-Erp/src/services/inventory.service.ts:956-987` — KK1 replay dalı; `existing.status` HİÇ okunmuyor:
```ts
const existing = await prisma.roll.findUnique({ where: { clientToken: data.clientToken }, … });
if (existing) {
  const sameItem = existing.itemId === data.itemId;
  const sameColor = existing.colorId === (data.colorId ?? null);
  const sameQty = new Prisma.Decimal(data.initialQty).equals(existing.initialQty);
  if (sameItem && sameColor && sameQty) {
    return { success: true, data: existing, message: `Top zaten kayıtlı (idempotent retry). Barkod: ${existing.barcode}` };
  }
```
- `Teks-Erp/src/services/order.service.ts:2026-2049` (`resolveCreateTokenReplay`) — `existing.status` okunmuyor; `workorder.service.ts:1172-1179`'daki `if (!existing.isActive) throw AppError.conflict(...)` ikizi burada YOK.
- `Teks-Erp/src/services/inventory.service.ts:4218-4233` (`createOpenFabric`) — ne statü ne payload kontrolü var.
- **Koruma kontrolü (nereye bakıldı):** `Roll.clientToken` partial UNIQUE (`schema.prisma:1331`) yalnız ÇİFT KAYIT üretilmesini engelliyor, replay'in ANLAMINI belirlemiyor. `Roll.status` üzerinde CHECK/trigger yok; `rolls_stamp_production_timestamps` trigger'ı yalnız damga yazar. Doğru desen dosyada var ama bu yola uygulanmamış: `tambur-manual.service.ts:1039-1060` / `:1382-1400` (409 `ENTRY_CANCELLED`), `subcontractor.service.ts:2356-2362` (409 `RECEIPT_CANCELLED`), `workorder.service.ts:1172-1179` (arşivli WO → 409), `kartela.service.ts:541-544` (`receipt: { cancelledAt: null }` süzgeci).

**failure_mode.** Operatör tablette 100 m top girer; ağ zaman aşımına düşer, kuyruk AYNI token'ı saklar (kural gereği — belirsiz hata). Bu arada süpervizör "Mükerrer giriş" ya da "Yanlış metraj" sebebiyle topu iptal eder. Tablet kuyruğu boşalırken aynı token'ı gönderir → **200 + "Top zaten kayıtlı. Barkod: T260826H0041"**. Top `CANCELLED`, hiçbir envanter sekmesinde yok, iş emrine bağlanamaz; 100 m kumaş sistemde hiç var olmamış olur ve kimse hata görmediği için kimse aramaz.

**Veride fiili ihlal (K2).** Replay yüzeyi ÖLÇÜLDÜ:
```sql
SELECT status, count(*) FROM rolls
 WHERE "clientToken" IS NOT NULL AND status IN ('CANCELLED','SCRAP') GROUP BY 1;
-- saha: CANCELLED 227
SELECT "cancelReason", count(*) FROM rolls WHERE status='CANCELLED' GROUP BY 1 ORDER BY 2 DESC;
-- 'Mükerrer giriş — aynı top iki kez kaydedildi' 8 · 'Yanlış metraj girildi' 3 · 'Yanlış ürün/renk' 9 · sebepsiz 206
```
Yani sahada 227 canlı "yeniden oynatılabilir" token var ve bunların 8'i tam da mükerrer temizliği sonucu.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-B-01.ts` → `audit/repro/D-B-01.log`
```
❌ KK1 replay "success: true" döndü → "Top zaten kayıtlı (idempotent retry). Barkod: T280826H0002"
   dönen kaydın DB'deki güncel statüsü: CANCELLED
❌ Sipariş replay "success: true" döndü → "Sipariş zaten oluşturulmuş (idempotent retry): SIP2808260001"
   dönen siparişin statüsü: CANCELLED
=== SONUÇ: 2 kırmızı ===
```

**İş etkisi.** Ham stoğa girmemiş kumaş; sipariş listesinde olmayan sipariş. Envanter sayımında eksik, üretim planında yok, müşteriye söz verilen metraj karşılıksız. Hata hiçbir ekranda görünmediği için tespit ancak fiziksel sayımda olur.

**Öneri (2. tur).** Replay okuyucularına statü kapısı ekle — mevcut desenin kopyası: `inventory.createInitialEntry` replay dalında `if (existing.status === CANCELLED || existing.status === SCRAP) throw AppError.conflict(..., { code: "ENTRY_CANCELLED" })`; `order.resolveCreateTokenReplay`'de `existing.status === CANCELLED` → 409 `ORDER_CANCELLED`; `createOpenFabric` replay'inde aynı kapı. **Migration/izin gerekmez, APK gerekmez** (mobil `ENTRY_CANCELLED` sözleşmesini tambur yolundan zaten tanıyor — tanımayan istemci 409'u genel hata olarak gösterir, bu da bugünkü sessiz başarıdan iyidir). Yalnız backend.

**Kabul kriteri.** `audit_repro_D-B-01.ts` 0 kırmızı; iptal edilmiş token replay'i her iki yolda 409 + açık `code` döner; başarılı (iptal edilmemiş) replay davranışı bayt-bayt aynı kalır (regresyon sondası).

**Efor.** 0,5 gün.

**Önceki defter.** `audit/FINDINGS.jsonl`'de karşılığı yok. `KRITIK-YAZMA-YOLLARI.md §7.4` bu boşluğu KYY-01 (KK1) için "✗ — K10 H-1" olarak, KYY-29 (sipariş) için "?" olarak işaretlemişti; ikisi de bu bulguyla ölçülerek kapandı.

---

## D-B-02 — Ad-mükerrer guard'ı kilitsiz; DB seddi 17 tablonun 3'ünde ve `items`'te SAHADA YOK

| Şiddet | **S1** | Kategori | B.1 + B.2 | Öncelik | **P0** | Modül | Ana veri (BaseService + Item + Color) | Kanıt seviyesi | **K3 + K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Aynı ada ikinci kayıt açılamaz" kuralının uygulama tarafı (`assertNameNotDuplicate`) bir **check-then-act**tır: `findFirst` ile bakar, sonra yazar; arada kilit yoktur. Kuralın ikinci hattı DB'deki partial UNIQUE'tir ama o yalnız `customers` · `subcontractors` (+ `colors` ifade index'i) üzerinde var — ve **`items_nameFold_key` prod kopyasında YOK** (2026-08-22'de "yumuşak kapı"ya çevrildi, mükerrer temizlenmediği için atlandı). Kalan 13 `nameFold` tablosunda (istasyon, makine, rota, kalite sınıfı, hata tipi, iade sebebi, kumaş özelliği, ürün reçetesi, çevre birimi, etiket şablonu, izin şablonu, fason kategorisi, müşteri şubesi) hiç sed yok. Sonuç: iki kullanıcı aynı anda aynı adı kaydederse iki kayıt doğar ve **hiçbir hata görülmez**.

**Kanıt.**
- `Teks-Erp/src/services/base.service.ts:729-795` — `assertNameNotDuplicate`: tek `findFirst` + `throw`; kilit yok, tx yok.
- `Teks-Erp/src/services/base.service.ts:1044-1050` — kodun kendi itirafı: *"⚠️ Burada advisory kilit YOK (item.service'te var): BaseService.create transaction AÇMAZ … Guard `assertNameNotDuplicate` ile aynı sınıftadır — panelden yapılan master-data yaratımını korur, **yarış korumasını değil**"*.
- `Teks-Erp/src/services/base.service.ts:718-723` — *"DB kısıtı bu check-then-act'in kapatamadığı yarış/atlama yollarına karşı sessiz son hattır … **Diğer `nameFold` tabloları (istasyon, rota, kalite…) yalnız bu metotla korunur**"*. Yani tasarım son hattı DB'ye devrediyor, ama o hat 14 tabloda yok.
- `Teks-Erp/src/services/color.service.ts:65-81` (`assertNameAvailable`) — aynı desen, renk için bespoke; DB ikizi `colors_nameFoldColor_key` **saha'da var, dev'de yok**.
- Migration: `20260821150000_name_fold_unique_live` (3 tablo, `WHERE "mergedIntoId" IS NULL`) + 2026-08-22'de yumuşak kapıya çevrilmesi (kök `CLAUDE.md` "nameFold DB SEDDİ" notu).
- **Koruma kontrolü:** advisory lock — 8026 yalnız KOD kapsamında ve yalnız `item.service.ts:237`'de (bkz. D-B-08); `pg_advisory` grep'inde ad kapsamlı hiçbir namespace yok. CHECK/trigger yok. `updateMany` claim yok (create yolu). Yani dört mekanizmanın hiçbiri ad tekilliğini korumuyor.

**Çakışma senaryosu.**
- T1 (planlamacı) `POST /api/quality-grades {name:"2.KALİTE"}` → `assertNameNotDuplicate` → `findFirst` → yok.
- T2 (depo sorumlusu, 40 ms sonra) aynı adla → `findFirst` → **hâlâ yok** (T1 commit etmedi).
- T1 `create` → commit. T2 `create` → commit.
- SONUÇ: aynı adla iki kalite sınıfı; ikisinin de `code`'u farklı olduğu için `code @unique` devreye girmez.

**failure_mode.** Aynı adla iki "2.KALİTE" kalite sınıfı doğar. Tambur operatörü listede iki özdeş buton görür, gün içinde ikisini de kullanır; **Kalite Karnesi raporu üretimi ikiye böler** ("2.KALİTE 400 m" + "2.KALİTE 380 m") ve `QualityGrade.targetStatus` ikisinde farklı ayarlanırsa (biri WAREHOUSE, biri A1_STOCK) aynı isimli kalite bazı topları bitmiş depoya, bazılarını 2. kalite stoğuna yazar. Aynı senaryo kumaşta (prod'da sed YOK) çok daha pahalı: iki "V-1430" kumaş kartı → stok, sipariş karşılama ve ürün dengesi iki karta bölünür.

**Veride fiili ihlal (K2).**
```sql
-- saha (2026-08-25):
SELECT "nameFold", count(*), array_agg(code) FROM items WHERE "mergedIntoId" IS NULL
 GROUP BY 1 HAVING count(*)>1;         -- v-1430 | 2 | {BGR150,MC155}
SELECT indexname FROM pg_indexes WHERE indexname LIKE '%nameFold%' AND indexdef ILIKE '%UNIQUE%';
 -- customers_nameFold_key · subcontractors_nameFold_key · colors_nameFoldColor_key
 -- items_nameFold_key YOK (yalnız items_nameFold_idx — UNIQUE DEĞİL)
```
Ayrıca `duplicate_reviews`: 13 satır, hepsi `MERGED` (ITEM 6 · COLOR 4 · SUBCONTRACTOR 3) → mükerrer üretimi kuramsal değil, fabrika bunu 13 kez elle temizlemiş.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-B-06.ts` → `audit/repro/D-B-06.log`
```
❌ quality_grades · N=2  → başarılı 2, DB'de 2 satır → AYNI ADLA 2 KALİTE SINIFI
❌ quality_grades · N=5  → başarılı 2, DB'de 2 satır
❌ quality_grades · N=10 → başarılı 5, DB'de 5 satır → AYNI ADLA 5 KALİTE SINIFI
❌ items · N=5 → başarılı 1, DB'de 1 satır, P2002 4 → uygulama guard'ı yarışı GEÇİRDİ;
   duran şey DB seddi (sahada o sed YOK → sessiz mükerrer)
```
`items` satırı bu bulgunun **ispat çekirdeğidir**: dev'de 5 paralel istekten 4'ü `assertNameNotDuplicate`'i **geçti** ve yalnız `items_nameFold_key` durdurdu (`constraint: "items_nameFold_key"`, `Invalid tx.item.create() … item.service.ts:280`). O index sahada olmadığı için aynı yarış orada 5 kumaş kartı üretir.

**İş etkisi.** Bölünmüş stok/sipariş/rapor; mükerrer temizliği (birleştirme) ayrı bir operasyon ve tarihsel belgeleri de etkiliyor. `test_db_invariants §1` prod'da kırmızı olmaya devam ediyor (bilinçli), ama "kırmızı" olmak yeni mükerrer üretimini engellemiyor.

**Öneri (2. tur).** İki katmanlı:
1. **Kısa vade (yalnız kod, migration yok):** `assertNameNotDuplicate`i tx İÇİNE al ve önüne ad-kapsamlı advisory kilit koy (`item.service.ts:237` deseninin ikizi, yeni bir namespace — 8028; `lockCodeScopeTx`in `scope|foldNameForCompare(name)` sürümü). ⚠️ SIRA LOAD-BEARING: kilit `findFirst`'ten ÖNCE.
2. **Orta vade [PROD'DA ÇALIŞTIRMA]:** `items` mükerrerini (`v-1430` grubu — `BGR150` / `MC155`) mükerrer panelinden birleştirdikten sonra `20260821150000` migration'ını yeniden koştur (enforce). Geri alma yolu: `DROP INDEX CONCURRENTLY items_nameFold_key;`. Kalan 13 `nameFold` tablosuna sed eklemeden önce `scripts/find_fold_duplicates.ts` ile her birini tara (mevcut mükerrer varsa migration düşer).

**Kabul kriteri.** `audit_repro_D-B-06.ts` 0 kırmızı (N=10'da `quality_grades` 1 satır); `items` yolunda P2002 görülmez (kilit uygulama katmanında keser). `test_db_invariants §1` prod'da yeşile döndüğünde ayrıca doğrulanır.

**Efor.** 1 gün (kod) + 0,5 gün (veri temizliği + enforce, ayrı pencere).

**Önceki defter.** Yeni. `K2a §13`, `K12` "Ad-mükerrer" satırı (DB seddi bir başarı olarak listelenmiş) ve `SINIR-OTESI-YONLENDIRME` (E) `items v-1430` notu ile ilişkili; buradaki ek, **guard'ın kendisinin yarışı kapatmadığının ölçülmesi**.

---

## D-B-03 — Fason mal kabulünde idempotency anahtarı çakışması "Barkod üretimi başarısız" hatasına dönüşüyor; kısmi kabulde ikinci makbuz doğuyor

| Şiddet | **S1** | Kategori | B.2 + B.3 | Öncelik | **P0** | Modül | Fason kabul | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `receive()` `withBarcodeRetry(() => prisma.$transaction(...))` ile sarılıyor ama **ikinci/üçüncü argümanı yok**: predicate verilmediğinde helper **TÜM P2002'leri** retry eder. `clientToken` çakışması kalıcıdır (her denemede aynı token yazılır) → 5 tur boşa döner → helper `409 "Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin."` fırlatır. `receive()` etrafında bu P2002'yi cached makbuza çeviren **dış catch de yok** (kardeş yolların hepsinde var). Sonuç: operatör "başarısız" okur, kabulü **yeni bir token'la** tekrarlar — ve kısmi kabulde küme-eşitliği guard'ı `isPartial` satırlarında `continue` ettiği için ikinci makbuz açılır.

**Kanıt.**
- `Teks-Erp/src/utils/barcode-retry.ts:15-33` — `isRetryable` opsiyonel; *"Verilmezse TÜM P2002 retry edilir"*; 5. denemeden sonra `AppError.conflict("Barkod üretimi …")`.
- `Teks-Erp/src/utils/p2002.ts:26-34` — kuralın kendisi yazılı: *"clientToken P2002'si RETRY EDİLMEZ — retry her denemede aynı token'ı yazacağından 5 tur boşa döner ve **yanıltıcı 'Barkod üretimi 5 denemede başarısız' hatası üretirdi**"*.
- `Teks-Erp/src/services/subcontractor.service.ts:2676-3233` — çağrı: `const result = await withBarcodeRetry(() => prisma.$transaction(async (tx) => { … })` … kapanış `:3232-3233` `})\n    );` — **tek argüman**. Token yazımı `:2790` (`clientToken: data.clientToken ?? null`).
- `Teks-Erp/src/services/subcontractor.service.ts:2412-2416` — kısmi makbuzda küme guard'ı devre dışı: `if (prior.items.some((i) => i.isPartial)) continue;`
- **Doğru desen karşılaştırması (aynı repoda):** `shipping.service.ts:274-296` (openSack) ve `:1432-1447` (createShipment) — `if (p2002Mentions(err, /clientToken/i)) return false;` + dış catch → cached replay; `order.service.ts:1942-1990`; `workorder.service.ts:988-1096`. Predicate+catch çiftini taşıyan 3 servis, taşımayan 1 servis.
- **Koruma kontrolü:** `SubcontractorReceipt.clientToken` DÜZ unique (`schema.prisma:3474`) → çakışma gerçekten P2002 üretir. Advisory kilit `touchWorkOrderTx` (WO satırı) — token'ı korumaz. Küme-eşitliği guard'ı (`:2390-2427`) **tam** makbuzu korur, kısmiyi korumaz (kod bunu açıkça söylüyor).

**Çakışma senaryosu.**
- T1 tablet `POST /subcontractors/receive {clientToken: X, returns:[…], receivedQty: 51}` → makbuz FK…0007 yazılır, ağ cevabı kaybolur.
- T2 tablet kuyruğu AYNI token'la tekrar gönderir (belirsiz hata → token yapışır, doğru davranış).
- T2 pre-tx token kontrolünü (`:2349-2370`) geçerken T1 henüz commit etmemişse → tx içinde `clientToken` P2002 → `withBarcodeRetry` 5 kez dener (~200 ms) → **409 "Barkod üretimi 5 denemede başarısız oldu"**.
- Bu KESİN bir 4xx olduğu için istemci sözleşmesi gereği token BIRAKILIR (`mobil/src/offline/entryAttempt.ts` kuralı) → operatör "Tekrar Dene" der → YENİ token → küme guard'ı `isPartial` yüzünden `continue` → **ikinci kısmi makbuz**.

**failure_mode.** Boyahaneden 100 m gitti, 51 m geldi. Tablet kabulü gönderir, cevap kaybolur, kuyruk tekrar dener, operatöre "Barkod üretimi 5 denemede başarısız" yazar. Operatör ekrandan kabulü yeniden yapar → sistemde **iki adet 51 m kabul makbuzu** (FK…0007 + FK…0008), `SubcontractorReceiptItem.receivedQty` toplamı 102 m. Fasondaki kalan 49 m yerine −2 m görünür, fason karnesinin çekme/fire oranı bozulur, kalan-kapama ekranı yanlış rakam gösterir.

**Veride fiili ihlal (K2).** `subcontractor_receipts` 143 satır, `clientToken` dolu **2**, iptal **0**, `receiptNo` mükerreri **0** → bugün ihlal YOK, ama gerekçesi korumanın çalışması değil, **sahadaki APK'ların çoğunun token GÖNDERMEMESİ**. Token gönderen sürüm yayıldıkça yol ısınır (2026-08-19'da "kısmi teslimatın TEK replay kimliği" ilan edildi).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-B-03.ts` → `audit/repro/D-B-03.log`
```
❌ kalıcı P2002 → 5 deneme (197 ms) → status=409 msg="Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin."
   subcontractor.service.ts: clientToken yazımı satır 2790 (receipt create)
❌ receive() `withBarcodeRetry` çağrısında P2002 predicate'i YOK
❌ receive() etrafında clientToken P2002'yi cached makbuza çeviren dış catch YOK
   referans desen — shipping p2002Mentions(/clientToken/) ×4, order isClientTokenP2002 ×3, workorder ×3
```
(§1 helper davranışını canlı dev DB'de ölçer; §2 çağrı yerini kaynaktan tarar — bekçiye dönüştürülebilir.)

**İş etkisi.** Fason defterinde çift sayım: kalan metraj, çekme yüzdesi, fason karnesi ve iş emri kapanışı yanlış. Düzeltme LIFO iptal ister ve iptal edilecek makbuz seçimi operatöre kalır.

**Öneri (2. tur).** `subcontractor.service.ts:2676`'ya kardeş yolların desenini uygula: `withBarcodeRetry(fn, undefined, (err) => !isClientTokenP2002(err))` + çağrının etrafına `try/catch` → `isClientTokenP2002(err)` ise token'la makbuzu oku, iptalliyse 409 `RECEIPT_CANCELLED`, değilse cached makbuzu dön (pre-tx dalın `:2349-2370` birebir ikizi, tek fonksiyona çıkarılabilir: `readReceiptReplay(token)`). Migration/izin/APK gerekmez. **Yan fayda:** aynı düzeltme `item.service.ts:306-307`'deki `() => isAutoCode` predicate'inin otomatik-kod dalında `nameFold` P2002'sini de 5 kez tekrarlaması sorununa örnek olur (orada yalnız mesaj kalitesi etkileniyor).

**Kabul kriteri.** Aynı token ile iki paralel `receive` → biri makbuz, diğeri **aynı makbuzu** cached döner (409 değil); iptal edilmiş makbuz token'ı 409 `RECEIPT_CANCELLED`; `audit_repro_D-B-03.ts` §2 yeşil.

**Efor.** 0,5 gün.

**Önceki defter.** Yeni. `K3a` "#9 receive clientToken wBR predicate'siz" ve `KRITIK-YAZMA-YOLLARI` KYY-10 "düz unique, **predicate'siz wBR**" işaretleriyle aynı yer; burada davranış ölçülerek ve kısmi-kabul ikinci kapısının yokluğu gösterilerek bulguya çevrildi.

---

## D-B-04 — İçe aktarımın idempotency anahtarı yalnız BİTMİŞ koşumu korur; uçuştaki tekrar aynı dosyadan ikinci siparişi açar

| Şiddet | **S2** | Kategori | B.4 | Öncelik | **P1** | Modül | İçe aktarım | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `ImportService.apply` başında `ImportRun.clientToken` ile önceki koşumu arar; ama koşum satırı **tüm yazımlar bittikten SONRA** yazılır (`:552-575`). Aradaki pencerede gelen ikinci istek `findUnique`'te boş bulur ve **ikinci koşumu da baştan yürütür**. Ana veri adaptörleri doğal anahtarla (`code`) UPDATE/SKIP'e düştüğü için çoğu zaman zararsız kalır; **`order` adaptörü create-only ve doğal anahtarsızdır** (`order.adapter.ts:7-16, 159-163`) → aynı dosya iki sipariş açar. Üstelik kaybeden koşum sonunda `importRun.create` P2002'ye çarpar → o koşumun **`ImportRun` satırı da, satır-bazlı audit'i de hiç yazılmaz**: yazılan mükerrer siparişin izi yoktur.

**Kanıt.**
- `Teks-Erp/src/services/import/import.service.ts:447-475` — token kapısı (`prisma.importRun.findUnique`); süreç-içi bayrak / advisory kilit / `ImportRun` ön-rezervasyonu YOK.
- `:476-479` — `const runId = crypto.randomUUID();` (kimlik önceden üretiliyor ama **DB'ye yazılmıyor**).
- `:552-575` — `prisma.importRun.create({ data: { id: runId, …, clientToken } })` döngüden sonra; `:577-585` audit ondan da sonra.
- `Teks-Erp/src/services/import/adapters/order.adapter.ts:159-163` — `async findExisting() { return new Map(); }` (*"her grup yeni kayıttır"*).
- **Koruma kontrolü:** `ImportRun.clientToken` DÜZ unique (`schema.prisma:5339`) — yalnız ikinci KOŞUM SATIRINI engelliyor, ikinci YAZMA TURUNU değil. `import.routes.ts`de rate-limit/kilit yok; `app.ts`de global istek kilidi yok; süreç-içi `isRunning` bayrağı (backup/db-copy emsali) burada YOK.

**Çakışma senaryosu.**
- T1 `POST /api/import/order/apply {clientToken: X, rows:[…]}` → token kapısı boş → 400 satır yazmaya başlar (satır başına ayrı tx, bilinçli).
- T2 (Electron/axios zaman aşımı → kullanıcı "Uygula"ya tekrar bastı ya da istemci yeniden gönderdi) aynı token → kapı **hâlâ boş** → ikinci tur başlar.
- İkisi de siparişleri yazar. T1 `importRun.create` → OK. T2 `importRun.create` → P2002 → istek 409 ile düşer.
- SONUÇ: 2 sipariş, 1 `ImportRun`, kullanıcıya "içe aktarım yapılamadı".

**failure_mode.** Planlamacı müşteriden gelen 40 kalemlik sipariş dosyasını yükler; istek 30 sn'de zaman aşımına düşer, panel "İçe aktarım yapılamadı" der. Sistemde **iki adet 40 kalemlik sipariş** vardır (SIP…0001 ve SIP…0002, toplam 2× metraj). Planlamacı hata mesajına güvenip dosyayı üçüncü kez yükler. Üretim planı ve sipariş karşılama raporu iki katına çıkar; fazlalık ancak sevkiyatta "sipariş açığı kapanmıyor" olarak fark edilir.

**Veride fiili ihlal (K2).** `import_runs` saha'da **0 satır** — özellik canlıda henüz hiç kullanılmamış (izin ataması bekliyor, bkz. bellek notu "Import/Export UYGULANDI … `data:import` ataması bekliyor"). Yani bugün ihlal yok; risk özellik açıldığı gün başlar.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-B-05.ts` → `audit/repro/D-B-05.log`
```
apply#0: REJECT code=P2002 … prisma.importRun.create() … import.service.ts:552
apply#1: status=APPLIED created=1
❌ aynı token ile 2 eşzamanlı apply → 2 SİPARİŞ: SIP2808260002, SIP2808260001
   ImportRun satırı: 1 (ikinci koşumun izi yok — audit'te de yok)
```

**İş etkisi.** Mükerrer sipariş → mükerrer iş emri/üretim planı; iptali elle ve `WorkOrderToOrderLine` bağları yüzünden zahmetli.

**Öneri (2. tur).** `ImportRun` satırını **koşumdan ÖNCE** `status: "RUNNING"` ile yaz (idempotency kaydı ile işin aynı akışta olması — prompt B.3(b)); token kapısı `RUNNING` satırı görürse 409 `IMPORT_IN_PROGRESS` döndürsün, sonda `update` ile sonucu doldursun. Bu ayrıca kaybeden koşumun izini de üretir. Alternatif/ek: `order` adaptörüne dosya-referansı sütununu saklayan bir alan (`Order.externalRef`) — ama o migration ister; kısa yol yukarıdaki. **Not:** "RUNNING" satırı asılı kalırsa (süreç ölümü) bir watchdog/TTL gerekir — `backup-scheduler`ın `WATCHDOG_MS` deseni emsal.

**Kabul kriteri.** İki eşzamanlı `apply` (aynı token) → 1 sipariş, ikinci istek 409 `IMPORT_IN_PROGRESS`; `import_runs`ta 1 satır ve statüsü nihai. `audit_repro_D-B-05.ts` §1 yeşil.

**Efor.** 1 gün (migration: `ImportRun.status` enum'una RUNNING; **veri dokunuşu yok**; geri alma: enum değeri kullanılmadan bırakılabilir).

**Önceki defter.** `K9 HOTSPOT H-2` (aynı yer, ölçülmemişti) — bu bulgu onu K3'e taşıdı.

---

## D-B-05 — Aynı içe-aktarım token'ı FARKLI gövdeyle gelirse yeni dosya sessizce yutuluyor

| Şiddet | **S2** | Kategori | B.3 | Öncelik | **P2** | Modül | İçe aktarım | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Token kapısı yalnız token'a bakıyor; `entity` ve `rows` karşılaştırılmıyor. Aynı token farklı bir dosyayla gelirse sunucu **önceki koşumun sayılarını** döner (`created: 1` gibi) ama **hiçbir şey yazmaz**. Bu mükerrerin aynadaki ikizidir: eksik kayıt, ve fark edilmesi daha zordur. Kardeş yollar (Roll/Order/WorkOrder) payload-özdeşliğini kontrol edip 409 `CLIENT_TOKEN_COLLISION` veriyor; import vermiyor.

**Kanıt.** `Teks-Erp/src/services/import/import.service.ts:447-475` — dönen nesne tamamen `prior` satırından kuruluyor; `entity` parametresi yalnız yanıtın etiketi olarak kullanılıyor, `prior.entity` ile KARŞILAŞTIRILMIYOR; satırların özeti/hash'i hiç saklanmıyor (`ImportRun`da `fileName` var, `fileHash` yok — `K9 §8.3` "Dosya hash'i: Tutulmuyor").
**Karşı-desen (aynı repo):** `inventory.service.ts:975-1000` (item/renk/metraj özdeşliği → 409 `CLIENT_TOKEN_COLLISION`), `order.service.ts:2039-2049`, `workorder.service.ts:1180-1190`.

**failure_mode.** Bir betik/entegrasyon (ya da token'ı ekran ömrü boyunca sabitleyen gelecekteki bir istemci) aynı `clientToken` ile ikinci dosyayı gönderir. Yanıt `{status:"APPLIED", created:1}` — kullanıcı "aktarıldı" görür; ikinci dosyadaki 40 kalem **hiç yazılmamıştır** ve hiçbir hata/log yoktur.

**Erişilebilirlik notu (dürüstlük payı).** Bugünkü Electron istemcisi token'ı diyalog her açılışında ve `entity` değiştiğinde yeniliyor (`Electron/src/components/import/ImportDialog.tsx:118, 147-163`), sonuç adımından tek çıkış "Kapat" — yani **panelden bu senaryoya bugün ulaşılamıyor**. Bulgu, uç noktanın kendi sözleşmesindeki boşluktur (uç `POST /api/import/:entity/apply` doğrudan çağrılabilir ve istemci disiplinine bırakılmıştır — repo kuralı "istemci disiplinine bırakılmaz").

**Repro (K3).** `audit/repro/D-B-05.log`:
```
❌ aynı token FARKLI gövde → yanıt "created=1" ama DB'ye HİÇBİR ŞEY yazılmadı (sessiz yutma)
```

**İş etkisi.** Kayıp veri, sıfır iz. En kötü hâli: gece toplu yükleme yapan bir entegrasyonda fark edilmeden gün boyu sürer.

**Öneri (2. tur).** Token kapısına iki kontrol ekle: `prior.entity !== entity` **veya** `prior.rowCount !== rows.length` → 409 `CLIENT_TOKEN_COLLISION` (mevcut koşum no'su + tarihiyle). Tam çözüm için `ImportRun.fileHash` (satırların kanonik hash'i) — migration ister, opsiyonel.

**Kabul kriteri.** Aynı token + farklı gövde → 409; aynı token + aynı gövde → önceki sonuç (davranış korunur).

**Efor.** 0,5 gün.

**Önceki defter.** Yeni.

---

## D-B-06 — Sipariş içe aktarımının mükerrer uyarısı yalnız müşterinin EN SON siparişine bakıyor

| Şiddet | **S2** | Kategori | B.5 | Öncelik | **P2** | Modül | İçe aktarım / Sipariş | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `order` adaptörü bilinçli olarak create-only; mükerrer koruması **tek yüzey olarak** önizlemedeki uyarıya bırakılmış ("aynı müşteri + son 90 gün + aynı toplam metraj"). Ama sorgu `orderBy: createdAt desc, take: 1` ile **yalnız en son siparişi** çeker ve toplamı onunla kıyaslar. Aradan başka bir sipariş geçtiyse uyarı hiç çıkmaz — yani koruma, en çok gerekli olduğu durumda (aktif müşteri, sık sipariş) sessizce kapanır.

**Kanıt.** `Teks-Erp/src/services/import/adapters/order.adapter.ts:252-281`:
```ts
const dup = await prisma.order.findFirst({
  where: { customerId, createdAt: { gte: since }, status: { notIn: ["CANCELLED"] }, lines: { some: {} } },
  select: { orderNumber: true, lines: { select: { quantity: true } } },
  orderBy: { createdAt: "desc" }, take: 1,
});
if (dup) { const dupTotal = …; if (Math.abs(dupTotal - total) < 0.001) { row.result.warnings.push(…) } }
```
Yorum *"son 90 günde aynı toplam metrajla açılmış sipariş var mı"* diyor; kod "en son siparişin toplamı bu mu" diye soruyor. `:7-16` ve `:150-157` bu uyarının **tek koruma** olduğunu açıkça yazıyor.

**failure_mode.** Müşteri A'ya Pazartesi 1.200 m sipariş girildi (SIP…0001), Salı 500 m (SIP…0002). Çarşamba planlamacı Pazartesi'nin dosyasını yanlışlıkla tekrar yükler: toplam 1.200 m; sorgu SIP…0002'yi (500 m) döner, 500 ≠ 1.200 → **uyarı çıkmaz**, satır yeşil görünür, ikinci 1.200 m'lik sipariş açılır. Üretim planı 1.200 m fazla iş emri üretir.

**Veride fiili ihlal (K2).** Aranmadı — `import_runs` saha'da 0 satır (özellik canlıda kullanılmamış), dolayısıyla bu yoldan doğmuş mükerrer sipariş olamaz.

**İş etkisi.** Fazla üretim planı / fazla kumaş rezervi; sipariş iptali `WorkOrderToOrderLine` bağlarını da çözmeyi gerektirir.

**Öneri (2. tur).** `findFirst … take:1` yerine 90 günlük aday kümesini çekip (müşteri başına sipariş sayısı küçüktür) **herhangi birinin** toplamı eşleşiyorsa uyar; eşleşen sipariş numaralarının hepsini yaz. Alternatif olarak `SUM(lines.quantity)` üzerinden `groupBy` ile tek sorgu. Uyarı olarak kalması (engel değil) doğru tercihtir, dokunma.

**Kabul kriteri.** Araya N sipariş girse de aynı toplamlı sipariş uyarıyı tetikler; birden çok eşleşmede hepsi listelenir.

**Efor.** 0,5 gün.

**Önceki defter.** Yeni.

---

## D-B-07 — İçe aktarım anahtar katlaması Türkçe büyük harfe dayanıyor; `activo` ile `ACTIVO` eşleşmiyor (228 kumaş kodunun 63'ü etkilenebilir)

| Şiddet | **S2** | Kategori | B.1 + B.4 | Öncelik | **P2** | Modül | İçe aktarım | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** İçe aktarımda "bu satır hangi kayda ait" sorusu `key.toLocaleUpperCase("tr-TR")` ile cevaplanıyor. Türkçe kuralda `i → İ` ama `I → I` olduğu için bu katlama **i-ailesinde asimetriktir**: `"activo"` → `ACTİVO`, `"ACTIVO"` → `ACTIVO`. Mevcut kayıt bir yazımla, dosyadaki satır başka bir yazımla geldiğinde eşleşme olmaz; satır UPDATE yerine CREATE'e düşer ve orada kod tekilliği guard'ına (`foldCodeForCompare`, i-ailesini `I`ya indirger — DOĞRU katlama) ya da `code @unique`e çarparak **ERROR** alır. Aynı kavram (kod) için repoda üç ayrı katlama sözleşmesi var ve bu üçüncüsü diğer ikisiyle uyumsuz.

**Kanıt.**
- `Teks-Erp/src/services/import/import.service.ts:190, 223, 244` — grup anahtarı, dosya-içi mükerrer kontrolü ve mevcut kayıt eşleşmesi hep `toLocaleUpperCase("tr-TR")`.
- `Teks-Erp/src/services/import/adapters/item.adapter.ts:104-114` — `map.set(r.code.toLocaleUpperCase("tr-TR"), …)` (aynı asimetrik katlama).
- `Teks-Erp/src/services/import/import-lookup.ts:83, 92-95` — referans önbelleği aynı katlamayla anahtarlanıyor (burada yalnız önbellek ıskası; asıl arama `mode:"insensitive"`).
- Karşı sözleşmeler: `Teks-Erp/src/utils/code-format.ts:114-175` `foldCodeForCompare` — *"`foldNameForCompare` KOD İÇİN KULLANILAMAZ. O fonksiyon `toLocaleUpperCase("tr-TR")` yapar; … tam da korunmak istenen harf-farkı çifti eşleşmez"*; `:190` `normalizeScanCode` — *"`toLocaleUpperCase("tr")` KULLANMA"*. Yani yasak iki yerde yazılı, import katmanında uygulanmamış.
- Ölçüm (node): `"activo".toLocaleUpperCase("tr-TR")` → `ACTİVO`; `"ACTIVO"` → `ACTIVO`; `"mitra"` → `MİTRA`.

**failure_mode.** Fabrikanın kumaş kartı `activo` kodlu (canlı veride VAR). Tedarikçinin Excel'i `ACTIVO` yazar. İçe aktarım "mevcut kayıt yok" der, CREATE'e düşer, `decideCodeUniqueness` "Bu kod ile aktif ürün zaten var: 'activo'" 409'u üretir → satır **ERROR**. Kullanıcı ekranda "zaten var" yazısını görür ama satır güncellenmemiştir; 63 koddan herhangi biri için aynı şey olur. `onError=skip` seçiliyse satır **sessizce atlanır** ve dosyadaki güncelleme hiç uygulanmaz.

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) FILTER (WHERE code ~ '[iI]'), count(*) FROM items;   -- 63 | 228
SELECT upper(btrim(code)), count(*), array_agg(code) FROM items GROUP BY 1 HAVING count(*)>1;
-- 8 grup: BAYROFLAM/bayroflam · ACTIVO/activo · SEFA/sefa · BGR150SEFFAF/bgr150seffaf
--         OSLO/oslo · MC155/mc155/Mc155 · BGR150/bgr150 · SANTUK/santuk
```
Yani hem i içeren kod kütlesi büyük (63/228) hem de harf-farklı çiftler fiilen var (8 grup) — bu ikisi birleştiğinde eşleşme ıskası ve ardından `code @unique` P2002'si kesindir.

**İş etkisi.** İçe aktarım "çalışmıyor" gibi görünür (satırlar ERROR/SKIP), kullanıcı elle girişe döner; `onError=skip` ile sessiz eksik güncelleme.

**Öneri (2. tur).** İçe aktarımın anahtar katlamasını **tek sözleşmeye** bağla: `foldCodeForCompare` (kod anahtarları için) — `import.service.ts:190/223/244` + `item.adapter.ts:106` + diğer adaptörlerin `findExisting` anahtarları birlikte değişir (aksi hâlde iki taraf ayrışır ve HİÇBİR satır eşleşmez — bu değişiklik **atomik** yapılmalı). Bekçi: `foldCodeForCompare` ile anahtarlanan `findExisting` haritalarının kaynak taraması (emsal: `test_fason_open_dispatch_single_source` AST bekçisi).

**Kabul kriteri.** `ACTIVO` yazan satır `activo` kaydını UPDATE eder; dosya-içi `activo`/`ACTIVO` çifti "aynı anahtar iki kez" hatası alır; mevcut eşleşen satırların davranışı değişmez (regresyon: `test_import_framework.ts`).

**Efor.** 1 gün (17 adaptörün `findExisting` anahtarları taranmalı).

**Önceki defter.** Yeni. Bellek notu "İçe aktarım paketi — kod-değil-ad tuzağı" ile aynı aileden, farklı kusur.

---

## D-B-08 — Katlanmış KOD tekilliğinin advisory kilidi dört çağrı yerinin yalnız birinde

| Şiddet | **S3** | Kategori | B.2 | Öncelik | **P3** | Modül | Ana veri | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `code-unique.helper.ts` "kod KİMLİKTİR, harf büyüklüğü kimlik farkı değildir" kuralını taşıyor ve kendi docstring'inde kilidin **neden zorunlu** olduğunu yazıyor: katlanmış tekilliğin DB karşılığı bilinçli olarak YOK, dolayısıyla eşzamanlı `sefa2` + `SEFA2` istekleri guard'ı ikisi de geçer. Ama `lockCodeScopeTx` yalnız `item.service.ts:237`'de çağrılıyor; `decideCodeUniqueness`in diğer üç çağrı yeri kilitsiz.

**Kanıt.**
- `Teks-Erp/src/services/helpers/code-unique.helper.ts:57` (`CODE_UNIQUE_LOCK_NS = 8026`), `:60-82` (gerekçe + *"⚠️ SIRA LOAD-BEARING"*).
- Çağrı yerleri (grep, 4 vuruş): `item.service.ts:237` ✔ kilitli · `subcontractor-management.service.ts:202` (Subcontractor) ✘ · `:512` (SubcontractorCategory) ✘ · `base.service.ts:1052` (QualityGrade / PeripheralDevice / CustomerBranch — manuel kodlu generic yol) ✘.
- `base.service.ts:1044-1050` bunu bilerek not etmiş; yani "unutulmuş" değil "kapsam dışı bırakılmış" — ama helper'ın gerekçesi o üç modelde de aynen geçerli (`quality_grades`, `peripheral_devices`, `customer_branches`, `subcontractors`, `subcontractor_categories` kod alanında Türkçe harf/serbest yazım kabul ediyor).

**failure_mode.** İki admin aynı anda kalite sınıfı ekler: biri `1.KALİTE`, diğeri `1.KALITE`. İkisi de guard'ı geçer, iki kayıt doğar. `Roll.qualityGrade` bir **snapshot koddur**; etiketteki koşullu eleman (`label-elements.normalizeConditionValue`) yalnız bir yazımı tanır → bir grup topun etiketi koşullu alanı basmaz, hata/log yok.

**Veride fiili ihlal (K2).** `items` dışında mükerrer YOK:
```sql
SELECT 'subcontractors', upper(btrim(code)), count(*) FROM subcontractors GROUP BY 1,2 HAVING count(*)>1
UNION ALL … quality_grades … peripheral_devices …;   -- 0 satır
```
`items`teki 8 grup tarihseldir (guard 2026-08-15'te eklendi, mevcut çiftler bilinçli bırakıldı).

**Öneri (2. tur).** D-B-02'nin 1. maddesiyle birlikte çözülür: kilidi `decideCodeUniqueness`i çağıran her yola taşı (kilit → tarama sırası korunacak). Bekçi: çağrı yeri sayısı ile kilit sayısını kıyaslayan kaynak taraması.

**Kabul kriteri.** 4/4 çağrı yerinde kilit; N paralel `sefa2`/`SEFA2` isteğinden tam 1'i başarılı.

**Efor.** 0,5 gün (D-B-02 ile birlikte).

---

## D-B-09 — Replay yanıtlarında payload-özdeşlik kontrolü yolların yarısında yok

| Şiddet | **S3** | Kategori | B.3 | Öncelik | **P3** | Modül | Çuval/Sevkiyat/Açık kumaş/Fason makbuz | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Aynı anahtar farklı gövdeyle gelirse hata vermeli" (prompt B.3) kuralı Roll/Order/WorkOrder'da uygulanmış (409 `CLIENT_TOKEN_COLLISION`), dört yolda uygulanmamış: aynı token farklı yükle gelirse eski kayıt **sessizce** dönüyor ve yeni veri yutuluyor.

**Kanıt (var/yok tablosu).**

| Yol | Token | Replay okuyucu | 4. durum (iptal) | Payload özdeşliği |
|---|---|---|---|---|
| KK1 ham giriş `inventory:560` | `Roll.clientToken` partial | `:956-1000` | **✘** (D-B-01) | ✔ item+renk+metraj |
| Açık kumaş `inventory:4218` | aynı kolon | `:4218-4233` | **✘** | **✘** |
| Sipariş `order:1942` | `Order.clientToken` partial | `:2026-2067` | **✘** (D-B-01) | ✔ müşteri+şube+satır sayısı |
| İş emri `workorder:988` | `WorkOrder.clientToken` partial | `:1145-1192` | ✔ `isActive:false` → 409 | ✔ type+targetItemId |
| Çuval aç `shipping:207` | `Sack.clientToken` düz | `:181-198` | — (çuvalda iptal yok; sevk edilmiş çuval "açıldı" der) | **✘** |
| Sevkiyat kur `shipping:1376` | `Shipment.clientToken` düz | `:1361-1374` | kısmen (statü döner, **mesaj** yanlış: CANCELLED sevkiyat için "onay bekliyor") | **✘** |
| Fason kabul `subcontractor:2282` | `SubcontractorReceipt.clientToken` düz | `:2349-2370` | ✔ 409 `RECEIPT_CANCELLED` | **✘** |
| Manuel top `tambur-manual:889/1334` | zorunlu token | `:1039/:1382` | ✔ 409 `ENTRY_CANCELLED` | ✔ |
| İçe aktarım `import:441` | `ImportRun.clientToken` düz | `:447-475` | — | **✘** (D-B-05) |

**failure_mode.** Operatör çuval açar (token T, müşteri boş); istek düşer sanır, ekranda müşteriyi seçip tekrar gönderir (istemci token'ı koruyor) → sunucu **müşterisiz** çuvalı döner ve "Çuval açıldı" der. Operatör çuvalın müşteriye atandığını sanır; sevkiyat kurulurken çuval "müşterisiz havuz çuvalı" olarak listelenir.

**Öneri (2. tur).** Dört replay okuyucusuna kimlik-kilit alanı karşılaştırması ekle (Roll/Order deseni): çuval → `customerId`+`branchId`; sevkiyat → `customerId`+`sackIds` kümesi; açık kumaş → `receiptId`+`stepId`; fason makbuz → `stepId`+`subcontractorId`+dönüş kümesi. Uyuşmazsa 409 `CLIENT_TOKEN_COLLISION`. Ayrıca `readCreateShipmentReplay` mesajı `CANCELLED` için ayrı cümle almalı.

**Kabul kriteri.** Her yol için "aynı token farklı gövde → 409" sondası; "aynı token aynı gövde → cached" davranışı korunur.

**Efor.** 1 gün.

---

## D-B-10 — LIFO/recency guard'ları zaman damgasının KESİN büyüklüğüne dayanıyor (`gt`), sıraya değil

| Şiddet | **S3** | Kategori | B.4 | Öncelik | **P3** | Modül | Fason makbuz iptali · İade iptali | Kanıt seviyesi | **K1** (saha ihlali 0) |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Önce en son belgeyi iptal et" kuralı üç yerde `createdAt: { gt: X.createdAt }` ile kuruluyor. `createdAt` DB default'u `CURRENT_TIMESTAMP` = **transaction başlangıç zamanıdır**; iki tx aynı mikrosaniyede başlarsa iki kayıt eşit damga alır ve **hiçbiri diğerini "daha yeni" saymaz** → LIFO kapısı ikisi için de açılır. Prompt B.4'ün açıkça aranmasını istediği `>` / `>=` sınıfı; doğru çözüm zaman değil **sıra/id** tabanlı ilerlemedir.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:4664-4675` (iptal önizlemesi) ve `:4757-4768` (`cancelReceipt` guard'ı) — `createdAt: { gt: receipt.createdAt }`, `id: { not: receiptId }`.
- `Teks-Erp/src/services/return.service.ts:854-866` — `newerReturn` aynı desen (`createdAt: { gt: rr.createdAt }`), guard'ın kendi yorumu *"iptal yalnız topun EN SON aktif iadesinde yapılabilir"*.
- DB: `SELECT column_default … ` → `subcontractor_receipts.createdAt = CURRENT_TIMESTAMP`, `roll_returns.createdAt = CURRENT_TIMESTAMP`.
- **Koruma kontrolü:** ilgili tablolarda monoton bir sıra kolonu yok (`receiptNo` günlük sıra taşır ama guard onu okumuyor); `id` UUID (sıralanamaz); advisory kilit `touchWorkOrderTx` LIFO kümesini kapsamıyor.

**failure_mode.** Aynı adıma iki kısmi kabul mobil kuyruk boşalırken 46 ms içinde (2026-08-04 vakasının ölçülmüş penceresi) yazılır ve `CURRENT_TIMESTAMP` çakışırsa: operatör **birinci** makbuzu iptal eder, guard "daha yeni makbuz var" demez, birinci makbuzun metrajı topa geri konur; ikinci makbuz o topu zaten tüketmiştir → `currentQty` şişer, `RollVariance` defteri ile fiziksel gerçek ayrışır.

**Veride fiili ihlal (K2).** `SELECT "stepId","createdAt",count(*) FROM subcontractor_receipts GROUP BY 1,2 HAVING count(*)>1` → **0 satır**; en yakın iki makbuz arası 6,4 sn. Bugün ihlal YOK.

**Öneri (2. tur).** Guard'ı zamandan sıraya çevir: `(createdAt, id)` bileşik karşılaştırması (`OR: [{createdAt:{gt}}, {createdAt: X.createdAt, id: {gt: X.id}}]`) ya da makbuz/iade tablolarına monoton `seq` (migration). Düşük öncelikli; D-B-03 düzeltmesiyle aynı dosyaya dokunulduğunda birlikte yapılabilir.

**Kabul kriteri.** Eşit `createdAt`lı iki makbuz fixture'ında eski olanın iptali 409 `RECEIPT_NOT_LATEST` verir.

**Efor.** 0,5 gün (bileşik karşılaştırma yolu; migration'sız).

---

## D-B-11 — `freezeForSource` versiyon yarışını yakalamıyor; kaybeden İŞ transaction'ı teknik hatayla düşüyor

| Şiddet | **S3** | Kategori | B.2 | Öncelik | **P3** | Modül | Donmuş belge | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `PrintedDocument` sürümü `findFirst(orderBy version desc) + 1` ile üretiliyor (okuma-sonra-yazma). `@@unique([docType, sourceId, version])` yarışın kaybedenini P2002'ye düşürüyor — **ama `freezeForSource`da catch YOK**, ve bu fonksiyon çağıranın tx'inin İÇİNDE koşuyor. Yani belge çakışması tüm iş işlemini (sevk onayı, kartela sevki, fason makbuzu) geri sarar ve kullanıcıya teknik bir "değer zaten mevcut" mesajı gider. Kardeş iki yol bu durumu ele alıyor: lazy-init P2002'yi yakalayıp kazananı okuyor, `reissue` atomik claim kullanıyor — üç kardeşten biri korumasız.

**Kanıt.**
- `Teks-Erp/src/services/printed-document.service.ts:332-345` — `prev = tx.printedDocument.findFirst({orderBy:{version:"desc"}})` → `tx.printedDocument.create({ version: (prev?.version ?? 0) + 1 })`; try/catch yok.
- `:414-427` — lazy-init dalında **var**: `if (err.code === "P2002") { const winner = await prisma.printedDocument.findFirst(…); return … }`.
- `:669-693` — `reissue` **atomik claim** (`updateMany where {id, status: ACTIVE}` + `count===0 → 409`).
- `Teks-Erp/src/middlewares/error.middleware.ts:112-116` — constraint adından kolon çıkarımı: `printed_documents_docType_sourceId_version_key` → `version` → kullanıcıya *"Bu 'version' değeri zaten mevcut"*.
- **Koruma kontrolü:** `version` üzerinde sequence/trigger yok; advisory kilit yok (`shipment-locks` yalnız sevkiyat kapsamını kilitler ve `freezeForSource` kartela/fason yollarından da çağrılıyor).

**failure_mode.** Depo sorumlusu sevk irsaliyesini önizler (lazy-init v1'i yazmaya çalışır) ile aynı saniyede sevk onayı `freezeForSource` koşar. Kaybeden taraf sevk onayı ise **sevkiyat DISPATCHED olmaz**, çuvallar PLANNED kalır ve operatör "Bu 'version' değeri zaten mevcut" yazısını görür; ne yapacağını bilemez, tekrar dener.

**Veride fiili ihlal (K2).** `printed_documents` (docType,sourceId,version) mükerreri **0**, (docType,sourceId) başına ACTIVE>1 **0** → kısıt çalışıyor, kaybeden gerçekten düşüyor.

**Öneri (2. tur).** `freezeForSource`u P2002'ye dayanıklı yap: ya `withBarcodeRetry(fn, undefined, (e) => p2002Mentions(e, /version/))` ile taze `max+1` okuyarak tekrar dene (tx içinde olduğu için çağıranın tx'ini sarmalayan bir yardımcı gerekir), ya da versiyonu tek ifadede üret (`INSERT … SELECT COALESCE(MAX(version),0)+1 …` ham SQL). Asgari düzeltme: hata mesajını anlamlı 409'a çevirmek ("Bu belgenin yeni bir sürümü az önce oluşturuldu — yenileyin").

**Kabul kriteri.** İki paralel freeze → biri belge yazar, diğeri ya yeni sürümü yazar ya anlamlı 409 alır; iş tx'i teknik P2002 ile düşmez.

**Efor.** 0,5-1 gün.

---

## D-B-12 — `Batch.batchNumber` bilinçli olarak tekil değil, ama "onunla lookup yapma" kuralının mekanik bekçisi yok

| Şiddet | **S4** | Kategori | B.1 | Öncelik | **P4** | Modül | Parti | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 2026-08-05'te `batches.batchNumber` `@unique`'i **bilinçli olarak** kaldırıldı (P01…P99 körlemesine sarar; kimlik yalnız `Batch.id`). Bugünkü kod bu kurala uyuyor — `batchNumber` yalnız sayaç kaynağında `where`e giriyor. Ama kuralı koruyan bir bekçi yok; ileride yazılacak bir `findFirst({ where: { batchNumber } })` sessizce **yanlış partiyi** bulur.

**Kanıt.** `prisma/schema.prisma:2260-2270` (unique yok, gerekçe yazılı) · `Teks-Erp/src/services/batch.service.ts:126` (8022 kilidi), `:134` tek `where: { batchNumber: { gte: prefix, startsWith: prefix } }` (sayaç) · grep: `batchNumber` + `where/findFirst/findUnique` → 2 vuruş, ikisi de meşru. Bekçi taraması: `scripts/test_batch_number_format.ts` sıralama sözleşmesini kaynak taramasıyla ölçüyor (`:272-300`) ama **lookup yasağını ölçmüyor**.

**Veride fiili ihlal (K2).** `SELECT "batchNumber", count(*) FROM batches GROUP BY 1 HAVING count(*)>1` → **92 grup** (beklenen; sarma tasarımının doğal sonucu).

**failure_mode.** Bir rapor/servis `findFirst({where:{batchNumber:"P07"}})` yazar; sistemde 3 adet P07 vardır ve sorgu sırasız olduğu için rastgele birini döner → fason çeki listesinde başka iş emrinin partisi görünür.

**Öneri (2. tur).** `test_batch_number_format.ts`e kaynak taraması ekle: `src/` altında `batchNumber` içeren `where` ifadelerinin allowlist'i (yalnız `batch.service.ts:134`), ihlalde kırmızı. Emsal: `test_fason_open_dispatch_single_source`.

**Efor.** 0,25 gün.

---

## D-B-13 — `device.announce` upsert'ü `include` taşıyor; kimliksiz uçta çakışma teknik hataya düşebilir

| Şiddet | **S4** | Kategori | B.2 | Öncelik | **P5** | Modül | Cihaz | Kanıt seviyesi | **K0/K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 27 `upsert()` çağrısının tamamı gerçek `@unique`/`@@unique` anahtarı kullanıyor (Prisma tip düzeyinde zorluyor — bu bir güçlü yön, aşağıda). Yalnız üçü sonuçta ilişki okuması (`include`) taşıyor; Prisma bu durumda tek-ifadelik `INSERT … ON CONFLICT` optimizasyonunu uygulamayıp find→create yoluna düşebilir ve eşzamanlı ilk yazımda P2002 üretebilir. `device.announce` **kimliksiz** (public) bir uçtur ve rate-limit taşımaz.

**Kanıt.** `Teks-Erp/src/services/device.service.ts:189-196` (`include: DEVICE_INCLUDE`) · `item.service.ts:535-539`, `:591-595` (`include`) · geri kalan 24 upsert `include`siz. `[VARSAYIM]` Prisma 7'nin hangi durumlarda DB-upsert'e indiği çalıştırılarak doğrulanmadı; iddia yalnız "olası" düzeyindedir.

**failure_mode.** İki tablet aynı `deviceId` ile eşzamanlı ilk `announce` yaparsa biri P2002 → 409 *"Bu 'deviceId' değeri zaten mevcut"*. Cihaz bir sonraki turda eşleşir; kalıcı zarar yok.

**Öneri.** `include`i kaldırıp upsert sonrası ayrı `findUnique` ile oku (ya da P2002'yi yakalayıp kazananı oku). Düşük öncelik.

---

## Uygulanan kontrol listesi (Prompt Bölüm 3-B)

| Madde | Durum |
|---|---|
| **B.1(b)** Her ana varlık için beklenen tekillik ↔ şema/migration karşılığı | **uygulandı** — `K2a §2` tablosu doğrulandı; ERP şablonundaki satırların Teks-Erp karşılıkları: stok kartı=`Item.code` ✔ · cari=`Customer.code` ✔ (+VKN bilinçli unique'siz, saha'da 0 mükerrer) · irsaliye/sipariş/iş emri belge no ✔ (mükerrer 0) · **lot/parti = `Batch` — BİLİNÇLİ tekil DEĞİL** (D-B-12) · barkod=`Roll.barcode` global tekil ✔ (mükerrer 0) · kullanıcı=`username` + expr unique `users_username_lower_uq` ✔ · **fatura/yevmiye N/A** (ERP fatura kesmez, yalnız `invoiceNo` izi) |
| **B.1** Prisma partial unique boşluğu — raw migration var mı | **uygulandı** — 15 UNIQUE partial index şema dışı mevcut (`roll_movements_one_open_per_roll_step_uq`, `work_sessions_active_*`, `kursun_bypass_one_pending_per_step_uq`, `label_templates_one_default_per_kind`, `traveler_card_templates_isDefault_key`, `*_clientToken_key` ×4, `*_nameFold_key` ×3 …). Boşluk **yok**; boşluk olan yer partial unique'in **prod'da uygulanmamış** olması (D-B-02) |
| **B.1** CHECK constraint boşluğu | **uygulandı** — 26 CHECK var (saha+dev birebir; `test_db_invariants:197-232`). "DB hiçbir iş kuralını korumuyor" tespiti bu projede GEÇERSİZ. Bilinen boşluk `currentQty <= initialQty` (bilinçli, aşım meşru) — E alanı |
| **B.1** EXCLUDE constraint / aralık çakışması | **kapsam dışı — sebep:** aralık modeli yok (fiyat listesi/vardiya/makine ataması aralıklı değil); `WorkSession` tekliği partial unique ile çözülmüş |
| **B.1** `relationMode="prisma"` → yetim tarama | **kapsam dışı — sebep:** varsayılan `foreignKeys`, DB'de gerçek FK (41 c / 71 r / 168 n); yetim taraması C alanının |
| **B.1** Nullable kolon unique anahtarın parçası | **uygulandı** — `K2a §11` tablosu doğrulandı; 11 vakanın 11'i bilinçli ve belgeli (`Roll.barcode`, 7× `clientToken`, `CustomerBranch.code`, `Sack (shipmentId,seq)`, `RollError.defectTypeId` → DB partial). Sessiz tekillik kaybı **yok** |
| **B.1** Fiili mükerrer taraması (K2) | **uygulandı** — 12 sorgu koşuldu (yukarıdaki "ölçülen saha gerçekleri"); bulgular D-B-02 / D-B-07 / D-B-12 |
| **B.1** Türkçe karakter tuzağı (`toLowerCase`/`toLocale*`/NFC/boşluk) | **uygulandı** — `foldSearchText`/`tr_fold` JS≡SQL sözleşmesi (NFD + 26 harflik tablo + ASCII küçültme + boşluk tekleme) ve bekçisi `test_fold_contract.ts` sağlam; `foldCodeForCompare` i-ailesini `I`ya indirger; **ihlal yalnız içe aktarım katmanında** (D-B-07). `toLocaleUpperCase/LowerCase` grep: 20 vuruş, 13'ü import katmanında |
| **B.2** `findFirst → create` deseni | **uygulandı** — ana veri ad/kod guard'ları (D-B-02, D-B-08), `PrintedDocument.version` (D-B-11), `EndpointLatencyDaily` (aşağıda), `color.assertNameAvailable`. `travelerCardScan` / `rollMovement` create'leri öncesindeki `findFirst`ler koşullu kapanış guard'ı, mükerrer üretmiyor |
| **B.2** Her `upsert()` için `where` gerçekten unique mi | **uygulandı — 27/27 unique** (28 değil; grep sayımı 27). Hepsi Prisma'nın üretilmiş unique-input adını kullanıyor (`customerId_itemId`, `docType_sourceId_version`, `rollId_workOrderStepId_operationType`, `day_routeKey`, `key`, `deviceId`, `userId` …) → **tip düzeyinde zorlanmış**, "hedefte unique yok" sınıfı bu repoda YOK. Kalan risk yalnız `include` taşıyan 3 çağrı (D-B-13) |
| **B.2** P2002 → anlamlı iş hatası mı 500 mü | **uygulandı** — `error.middleware.ts:58-116` kolon adını üç meta kaynağından çıkarıp Türkçe 409 üretiyor, `nameFold`/`nameFoldColor` → "ad". Kalan pürüz: bileşik unique'te ilk yakalanan kolon basılıyor (`version`) ve `freezeForSource` çağıranın tx'ini düşürüyor (D-B-11) |
| **B.2** P2002 → "o zaman güncelle" retry idempotent mi | **uygulandı** — `withBarcodeRetry` sayaç çakışmasında tx'i baştan koşturur (jitter'lı, `test_batch_number_format` bekçili). İdempotent OLMAYAN tek kullanım: kalıcı P2002'lerin retry'a girmesi (D-B-03) |
| **B.3(b)** Idempotency-Key desteği: mal kabul / üretim bildirimi / sevkiyat | **uygulandı** — var/yok tablosu D-B-09'da. Mal kabul ✔ · üretim bildirimi (KK1/kesim/manuel top) ✔ · sevkiyat+çuval ✔ · **fason SEVK ✘, kartela sevk/kabul ✘, iade ✘, tambur finalize ✘** — dördü de atomik claim ile korunuyor (aşağıda "doğru yapılanlar"), bulgu değil |
| **B.3(b)** Idempotency kaydı ile iş AYNI tx'te mi | **uygulandı** — Roll/Order/WO/Sack/Shipment/Receipt'te token iş kaydının kendi kolonunda ve aynı tx'te ✔. **`ImportRun` ayrı ve SONRA** → D-B-04 |
| **B.3(b)** Aynı anahtar farklı gövde | **uygulandı** — D-B-09 (4 yolda yok) + D-B-05 (import) |
| **B.3(b)** Doğal idempotency anahtarı kullanılabilir mi | **uygulandı** — kullanılıyor: fason kabulde top kümesi eşitliği, kartela kabulde tüketilen top kümesi, tambur finalize'de `TAMBUR_CONSUMED` statüsü, fason sevkte açık sevkin top kümesi. Doğal anahtarı OLMAYAN tek yer sipariş içe aktarımı (`ref` saklanmıyor) → D-B-04/06 |
| **B.3(b)** İstemci buton disable'ı koruma sayılmaz | **uygulandı** — sayılmadı; Electron/mobil token üretimi yalnız "erişilebilirlik" değerlendirmesinde kullanıldı (D-B-05) |
| **B.4** Kuyruk / at-least-once / ACK sırası / outbox | **kapsam dışı — sebep:** broker/kuyruk YOK (KUNYE: BullMQ/Agenda/Redis yok). Mobil yazıcı kuyruğu ve offline giriş kuyruğu İSTEMCİDE (L alanı) |
| **B.4** Dual write / outbox | **kapsam dışı — sebep:** DB dışına giden tek "olay" etiket baskısı ve yedek kopyası; ikisi de idempotent değil ama olay yayını değil (I/D alanları) |
| **B.4** Excel/CSV içe aktarma: aynı dosya iki kez, dosya hash'i, kısmi başarı sonrası tekrar | **uygulandı** — D-B-04 / D-B-05 / D-B-06 / D-B-07. Dosya hash'i **yok** (`ImportRun.fileName` yalnız görüntü); kısmi başarı sonrası tekrar ana veride idempotent (`code` doğal anahtar), siparişte değil |
| **B.4** El terminali / kantar offline senkron: cihaz benzersiz kayıt id'si | **uygulandı** — mobil `clientToken` üretir; sözleşme (yapışma kuralı) `mobil/src/offline/entryAttempt.ts`te tek kaynak, kök `CLAUDE.md` 2026-08-03 notunda belgeli |
| **B.4** MES/PLC sayaç kümülatif/artımlı | **kapsam dışı — sebep:** MES/PLC entegrasyonu yok; kantar/metre Faz-1 simülasyon |
| **B.4** Banka ekstresi referans tekilliği | **kapsam dışı — sebep:** banka entegrasyonu yok |
| **B.4** Watermark `>` / `>=` | **uygulandı** — cursor tabanlı "son çalışmadan sonrakileri çek" deseni **kodda YOK**: `archive-scheduler` yaş-tabanlı + id-batch + `skipDuplicates` (idempotent), `latency-persist` retention yaş-tabanlı, `offsite-sweeper` `rclone copy` + `lsf` küme farkı (watermark'sız). `>`/`>=` sınıfının fiilen bulunduğu yer **LIFO guard'larıdır** → D-B-10 |
| **B.5** Mantıksal mükerrer ana veri: VKN doğrulama + tekillik, mevcut oran | **uygulandı** — mükerrer paneli (`duplicate-detection.service`, üç kural + `duplicate_reviews`) mevcut ve kullanılmış (13 karar, hepsi MERGED). Oran: müşteri 0/27 · fason 0/8 · renk 0/83 · **kumaş 1/228 (v-1430)** katlanmış ad; VKN mükerreri 0/27 (VKN unique'i **bilinçli yok**, 2026-08-22 P5 kararı — yeniden açılmadı) |

---

## Doğru yapılanlar (korunmalı)

1. **27/27 `upsert()` gerçek unique anahtar üzerinde.** Prisma'nın üretilmiş bileşik unique-input adı kullanıldığı için "hedefte unique yok → iki kayıt" sınıfı bu repoda **yapısal olarak imkânsız**. Bu, Prisma projelerinde en sık görülen mükerrer kaynağıdır ve burada hiç yok.
2. **`clientToken`in DB kolonunda ve işin tx'inde yaşaması.** Ayrı bir "idempotency tablosu" kurulmamış; token yaratılan kaydın kendi kolonunda ve aynı transaction'da yazılıyor → iki paralel retry'ın "ikisi de yeni" görmesi imkânsız. (`Roll`, `Order`, `WorkOrder`, `Sack`, `Shipment`, `SubcontractorReceipt`, `SwatchStockReduction`). Tek istisna `ImportRun` ve o bir bulgu (D-B-04).
3. **Token yerine ATOMİK CLAIM ile korunan yollar — token yokluğu burada bulgu değildir.** `kartela.dispatch` (`kartela.service.ts:323-337`: `status=WAREHOUSE ∧ shipmentId=null ∧ sackId=null` + `count` kontrolü), `kartela.receive` (`:678-688` + `:537-573` küme-eşitliği replay'i, `receipt:{cancelledAt:null}` süzgeciyle), `return.createReturn` (`return.service.ts:502-516`: `status=SHIPPED` claim + `count===0 → 409`), `tambur.finalizeWarehouseCut` (`tambur.service.ts:2373-2380` statü tabanlı idempotent replay + `:2473-2478` claim). `K1a/K1b H18` notlarının ("token yok → mükerrer sevk/makbuz") bu dört yol için **karşılığı çıkmadı** — mekanizma aranmadan bulgu yazılmamalı.
4. **Türkçe katlama sözleşmesinin JS≡SQL kilidi.** `search-fold.ts` ↔ `public.tr_fold()` birebir, üç projede bayt-bayt aynı, bekçi tüm BMP'yi canlı DB'ye karşı ölçüyor (`test_fold_contract.ts`); `unaccent` bilinçli reddedilmiş ve gerekçesi ölçülmüş. Kod tarafında ayrı katlama (`foldCodeForCompare`, i-ailesi → `I`) ve "hangisi nerede kullanılır" yasakları docstring'lerde yazılı.
5. **Arşivleyicinin idempotent tasarımı.** `AuditService.archiveOlderThan` id-batch + `skipDuplicates` + `SET LOCAL` sırası → iki kez koşması zararsız; watermark hatasına yer bırakmıyor.
6. **İdempotency 4. durumunun ÜÇ yolda doğru uygulanması.** `tambur-manual` (409 `ENTRY_CANCELLED`), fason makbuz (409 `RECEIPT_CANCELLED`), iş emri (arşivli → 409). Düzeltme reçetesi icat edilmesine gerek yok; D-B-01 bu deseni kalan yollara taşımaktan ibaret.
7. **`withBarcodeRetry`nin predicate sözleşmesi ve jitter'lı beklemesi.** Kalıcı P2002'lerin retry'a girmemesi gerektiği `p2002.ts:26-34`te yazılı ve 3 serviste doğru uygulanmış; sorun kuralın eksikliği değil, tek çağrı yerinde uygulanmamış olması.

---

## Sınır ötesi notlar

- **→ A (eşzamanlılık):** `freezeForSource` (`printed-document.service.ts:332-345`) çağıranın tx'i içinde ve kilitsiz `max+1`; `traveler-card.service.ts:284` `version: existing.version + 1` (read+1, `{increment:1}` değil). İkisi de sürüm yarışı; D-B-11'de belge tarafından bakıldı, kilit/sıra analizi A'nın.
- **→ A:** `item.service.ts:306-307` `withBarcodeRetry(fn, undefined, () => isAutoCode)` — otomatik kod dalında **tüm** P2002'ler retry'a giriyor, `items_nameFold_key` çakışması da dahil (mobil "yeni desen" yolu). Kilit/retry etkileşimi A'nın alanı.
- **→ C (veri modeli):** `Item.mergedIntoId` SET NULL + `nameFold` partial UNIQUE'in predicate'i aynı kolona bağlı — survivor fiziksel silinirse tombstone'lar unique kapsamına geri girer (`K2a HOTSPOT-1`). D-B-02'nin düzeltmesi bu etkileşimi hesaba katmalı.
- **→ C:** `subcontractor_receipts.receivedQty` 635/638 NULL; rapor `COALESCE(receivedQty, roll.currentQty)` varsayımıyla okuyor. D-B-03'ün ikinci-makbuz senaryosunda bu varsayım çift sayımı GİZLER.
- **→ E (iş kuralı):** `readCreateShipmentReplay` (`shipping.service.ts:1361-1374`) CANCELLED sevkiyat için "Sevkiyat kuruldu (onay bekliyor)" mesajı üretiyor — metin ↔ statü ayrışması.
- **→ F (API):** `POST /api/import/:entity/apply` uzun senkron iş + HTTP zaman aşımı yok + gövde tavanı fiilen 1 MB (`K9 H-1`) → D-B-04'ün tetikleyicisi tam olarak bu üçlü.
- **→ I (gözlemlenebilirlik):** D-B-04'te kaybeden import koşumunun `ImportRun` satırı da satır-bazlı audit'i de yazılmıyor → **yazılan mükerrer kaydın hiçbir izi yok**. Bu, "kısmi başarı sessiz" sınıfının en sert hâli.
- **→ J (migration):** `20260821150000_name_fold_unique_live` prod'da `items` için ATLANDI (NOTICE); enforce koşumu bir ops adımıdır ve **veri temizliği ön koşulu vardır** (`v-1430` grubu). `test_db_invariants §1` prod'da bilerek kırmızı — bu kırmızının "bekleyen iş" mi "yeni mükerrer" mi olduğu ayırt edilemiyor.
- **→ K (test):** İdempotency 4. durumunun bekçisi yalnız manuel top yolunda var (`test_manual_roll_undo`); KK1 · Order · Sack · Shipment · Receipt · Import için bekçi YOK. Ad-mükerrer yarışının (D-B-02) hiçbir paralel sondası yok — `audit_repro_D-B-06.ts` doğrudan bekçiye dönüştürülebilir (negatif sonda zaten içinde: `items` dalı P2002 sayar).
- **→ L (kod kalitesi):** Aynı "kod katlaması" kavramı için üç uygulama (`foldCodeForCompare`, `toLocaleUpperCase("tr-TR")`, `normalizeScanCode`); ikisinin docstring'i üçüncüsünü yasaklıyor ama import katmanı ikisinden de habersiz (D-B-07).

---

## Kapsanmayan / erişilemeyen

- **Canlı prod DB'ye erişim yok.** Tüm K2 ölçümleri 2026-08-25 kopyasından (`tekserp_saha_0825`, 190/195 migration). Son 5 migration'ın getirdiği kolonlar (ör. `order_lines.cancelledAt`) orada yok; `items_nameFold_key`in canlıda o günden beri enforce edilip edilmediği **bu kanaldan görülemez** (dev'de var).
- **Mobil istemcinin token yapışma davranışı çalıştırılarak doğrulanmadı** — yalnız kök `CLAUDE.md` sözleşmesi ve `mobil/src/offline/entryAttempt.ts` dosya adı referans alındı; D-B-03'ün "operatör yeni token'la tekrarlar" adımı bu sözleşmeye dayanır (kesin 4xx → token bırakılır).
- **Prisma 7'nin `upsert` → `INSERT … ON CONFLICT` indirgeme koşulları ölçülmedi** (D-B-13 `[VARSAYIM]` etiketli).
- **17 içe aktarım adaptörünün 15'i tek tek okunmadı** — `order` ve `item` adaptörleri ayrıntılı, diğerleri yalnız `findExisting` anahtar deseni açısından tarandı. D-B-07'nin düzeltmesi hepsini gözden geçirmeyi gerektirir.
- **Fason kabul yolunun uçtan uca eşzamanlı repro'su yapılmadı** (WO + EXTERNAL adım + sevk + toplar fixture'ı 2 dk repro bütçesini aşıyor). D-B-03 bunun yerine (a) `withBarcodeRetry` davranışını canlı dev DB'de ölçtü, (b) çağrı yerinde predicate/catch yokluğunu kaynaktan taradı. Uçtan uca repro 2. tur için önerilir.
- **`duplicate-detection.service`nin bulanık eşleşme kalitesi yeniden ölçülmedi** — `docs/design/MUKERRER-PANELI-TASARIM.md`teki canlı ölçüm (kumaşta 9 yanlış pozitif → 1 gerçek) referans alındı; B.5 için yalnız KESİN (katlanmış ad/kod/VKN) mükerrer oranı yeniden ölçüldü.
- **Electron/mobil istemci kodları** yalnız token üretim noktaları kadar okundu (`ImportDialog.tsx`, `clientToken` grep'i); istemci timeout/retry politikaları L alanının.
- **`system_logs` üzerinden mükerrer olayların tarihsel arkeolojisi yapılmadı** (arşiv 0 satır, sıcak tablo 2026-07-16'dan başlıyor).
