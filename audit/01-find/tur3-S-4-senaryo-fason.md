# TUR 3 — S-4: SENARYO DENETİMİ · Fason (sevk / kısmi kabul / iptal / renk değişimi) + Kartela

> Denetçi: S-4 · Mercek: **senaryo merkezli** — bulgular bir akışın ADIMLARI ARASINDAKİ boşluktan doğar.
> Tur 1 (kod) ve Tur 2 (veri) bulguları `audit/tours/seen-t1t2.json`'da (208 kayıt); elenmiş bulgular
> yeni kanıt olmadan AÇILMADI, ayakta olanlar `onceki_defter` ile referanslandı.
> Kod tabanı: dal `adnansahin`, `Teks-Erp/src` (okuma anı 2026-08-29).

## 0. ÖN KOŞULLAR — bu turda hangi yollar SAHADA canlı

| Ön koşul | Değer | Kaynak |
|---|---|---|
| `fason.shrinkWarnEnabled` / `fason.shrinkTolerancePct` | **true / 10** (satır YOK → kod varsayılanı) | `tur2-V-4 §0.1` |
| `kk1.duplicateGuardEnabled` | true | aynı |
| `device.pairingRequired` | **false** → eşleşmemiş tablet de yazabilir | aynı |
| `auth.sameTypeSessionPolicy` | `"off"` → **aynı kullanıcı için sınırsız paralel oturum** (iki masa/iki tablet aynı işi yapabilir) | aynı |
| Süreç modeli | PM2 fork, `instances: 1` → tek event loop, kilitler DB tarafında | `KUNYE.md` |
| İzolasyon | READ COMMITTED (kodda `isolationLevel` yalnız `shipping:2610`) | `KUNYE.md` |

**Fason "tamamlanma yarışı" kilit protokolü (kod haritası — bu turun omurgası).**
`touchWorkOrderTx` (`Teks-Erp/src/services/helpers/workorder-locks.helper.ts:50-58`) WorkOrder satırını
`updateMany` ile write-kilitler ve **fason akışının tüm yazma yolları bu protokole katılır**:

| Katılan (kilit alıyor) | Satır |
|---|---|
| `subcontractor.dispatch` | `subcontractor.service.ts:1041` |
| `subcontractor.cancel` (sevk iptali) | `:2016` |
| `subcontractor.receive` (kabul) | `:2681` |
| `subcontractor.closeRemainder` (kalan gelmeyecek) | `:3401` |
| `subcontractor.cancelReceipt` (kabul iptali) | `:4807` |
| `subcontractor.undoTransfer` | `:5275` |
| `subcontractor.executeDirectShip` | `:6022` |
| `tambur.*` / `tambur-manual` / `workorder-split` / `workorder-batch-drop` | ilgili satırlar |

| **KATILMAYAN** (aynı WO'ya yazıyor ama kilidi almıyor) | Kanıt |
|---|---|
| `workorder-link.service.ts` — `changeTargetColor`, `changeWidth`, `linkOrderLines`, `unlinkOrderLine` | `grep -n touchWorkOrderTx src/services/workorder-link.service.ts` → **0 vuruş** |
| `workorder-manual-move.service.ts` — `manualMove` | aynı grep → **0 vuruş** |
| `kartela.service.ts` (WO'ya yazmaz, ayrı alan) | — |

Bu asimetri S-4-01'in kökenidir.

---

## SENARYOLAR VE ÇİZELGELER

### S4a — "100 m gitti, 51 geldi" + ikinci masa "kalan gelmeyecek" diyor

**Akış.** `dispatch` (top `AT_SUBCONTRACTOR`, 100 m) → masa-1 `receive` `{receivedQty:51}` → masa-2
`closeRemainder(49)`.

**Yield noktaları / çizelge (paralel).**

| t | Masa 1 (`receive`) | Masa 2 (`closeRemainder`) |
|---|---|---|
| t0 | pre-tx `outstandingRolls` okur (100) | pre-tx `roll.findUnique` okur (100, AT_SUB) |
| t1 | tx aç → `touchWorkOrderTx` **WO satırını kilitler** (`:2681`) | tx aç → `touchWorkOrderTx` **BLOKE** (`:3401`) |
| t2 | `freshReturns` kilit altında (100) → kısmi 51, `currentQty` 100→49 | bekliyor |
| t3 | commit | kilit serbest → `fresh` kilit altında **49** okur (`:3404-3416`) |
| t4 | — | claim `status=AT_SUBCONTRACTOR` → `SUBCONTRACTOR_CONSUMED`; `RollVariance SCRAP 49` |

**Sonuç: DEĞİŞMEZ KORUNUYOR.** Defter mutabakatı `Σdefter(51) + Σkalan-fire(49) = 100`. Ters sırada
(`closeRemainder` önce) `receive`'in kilit-altı `freshReturns` sorgusu (`:2764-2777`,
`status: AT_SUBCONTRACTOR` süzgeci) topu bulamaz → 409. **Bu senaryoda yarış bulgusu YOK** — protokol
çalışıyor ve raporlanacak bir kusur üretmiyor.

**Ama akışın DEVAMINDA gerçek bir çıkmaz var → [S-4-02].** `closeRemainder` geri alınamaz ve kısmi
makbuzun iptalini kalıcı olarak imkânsız kılar; iptal ÖNİZLEMESİ bunu söylemez.

---

### S4b — Aynı kabul iki tablet/pencereden (replay)

**Akış.** Tablet-A ve Tablet-B (ya da aynı tablette "Tekrar Dene") aynı adıma kabul gönderir.

**Yield noktaları.**
1. `clientToken` kontrolü **tx DIŞINDA** — `subcontractor.service.ts:2350-2371`.
2. Küme-eşitliği guard'ı da tx dışında ve **kısmi makbuzları bilerek atlar** — `:2436`
   `if (prior.items.some((i) => i.isPartial)) continue;`.
3. Tx `withBarcodeRetry` ile sarılı (`:2681`) → `clientToken @unique` P2002'si 5 kez boşuna denenir.

| Alt senaryo | Sonuç | Değerlendirme |
|---|---|---|
| Aynı token, **sıralı**, aynı gövde | cached makbuz döner (doğru) | ✔ |
| Aynı token, **eşzamanlı** | ikisi de token kontrolünü geçer → kaybeden 409 "Barkod üretimi 5 denemede…" | **BULGU-T1-005 (ayakta)** — yeniden AÇILMADI |
| Aynı token, **farklı gövde** (51 → 60) | `success:true` + cached makbuz; payload karşılaştırılmaz | **[S-4-05]** (kardeş `kartela.reduceStock` karşılaştırır) |
| Token YOK, kısmi, aynı gövde | küme guard'ı `continue` → **ikinci makbuz doğar**, metraj ikinci kez düşer | tasarım gereği (kısmi tekrar meşru); tek koruma token → **BULGU-T2-007 (ayakta)** ile birlikte gerçek risk |
| Tablet gerçek akışı | `buildReceivePayload` **her çağrıda yeni token üretir** (`mobil/.../receivePayload.helper.ts:343`, bekçi `.test.ts:321-331` bunu ŞART koşuyor) | **BULGU-T2-007** — ama React Query retry AYNI `vars`ı kullanır (`mobil/src/offline/mutations.ts:143-147` `stationRetry`), yani **otomatik** retry korunur; korunmayan şey operatörün ELLE yeniden göndermesidir |

**Senaryo düzeyinde yeni bulgu: [S-4-04]** — ekran, sunucudan onay gelmeden **yeşil "Mal kabul
tamamlandı"** basıp formu siliyor; dayandığı gerekçe (offline defaults yorumu) kısmi kabul geldiğinden
beri YANLIŞ.

---

### S4c — Kabul sürerken planlamacı hedef rengi değiştiriyor

**Akış.** Tablet `receive` gönderir (uzun tx); aynı anda planlamacı Electron'dan "Rengi Değiştir".

**Yield noktaları.**
1. `changeTargetColor` **tx AÇMAZ**; mal–plan bekçisi `assertTargetColorChange(prisma, …)`
   (`workorder-link.service.ts:525`) **havuz client'ıyla, WO kilidinin DIŞINDA** koşar.
2. Bekçinin "boyanmış top" sorgusu `AT_SUBCONTRACTOR`u DIŞLAR
   (`workorder-target-color.helper.ts:152`).
3. Atomik claim (`workorder-link.service.ts:564-573`) yalnız `targetColorId`'yi pinler; **top kümesini
   pinlemez**.

| t | Tablet (`receive`) | Planlamacı (`changeTargetColor` A→B) |
|---|---|---|
| t0 | tx aç, `touchWorkOrderTx` WO'yu kilitler | — |
| t1 | `expectedTargetColorId` kontrolü kilit altında geçer (`:2693-2718`) | — |
| t2 | born toplar `colorId = A` ile doğuyor (`:3059`), `producedInStepId = fason step` (`:3080`) | `assertTargetColorChange` **kilitsiz** okur: canlı boyanmış top = 0 (hepsi AT_SUB) → **SERBEST** |
| t3 | commit (adım COMPLETED, mal içeride, A renginde) | claim `WHERE targetColorId = A` → **BLOKE**, sonra geçer |
| t4 | — | commit → WO planı **B** |

**SONUÇ:** İş emrinin planı B, elindeki mal A. Doğru cevap `COLOR_DYED_BLOCKED` (409) olmalıydı —
`pendingCount = 0` çünkü fasonda mal kalmadı. Bulgu **[S-4-01]**.

> `expectedTargetColorId` ters yönü kapatıyor (renk önce değişirse kabul 409 alır) — koruma **tek yönlü**.

---

### S4d — Kabul iptali LIFO

**Akış.** FK-1 kısmi (51), FK-2 kısmi (20). Kullanıcı FK-1'i iptal etmek ister.

**Yield noktaları.**
1. LIFO guard'ı (`subcontractor.service.ts:4755-4776`) **tx DIŞINDA** okunur; tx içinde TEKRARLANMAZ
   (karşılaştır: K14 parti uyuşmazlığı guard'ı tx İÇİNDE de koşar, `:4902-4913`).
2. `cancelReceipt` adım 4 (`:4963-4971`) bu adımdaki **TÜM** `SUBCONTRACTOR_RETURNED` satırlarını
   koşulsuz siler; oysa `receive` o satırı `skipDuplicates` ile yazar (`:2929-2950`) ve ikinci
   teslimatın satırı **hiç oluşmaz** (unique `(rollId, stepId, opType)`).

| t | Masa 1 (`cancelReceipt(FK-2)` — LIFO'ya UYGUN) | Sonuç |
|---|---|---|
| t0 | LIFO guard: FK-2'den yenisi yok → geçer | — |
| t1 | tx: FK-2 soft-cancel; kısmi metraj +20 geri | doğru |
| t2 | `rollOperation.deleteMany(SUBCONTRACTOR_RETURNED)` | **FK-1'in yazdığı satır silinir; FK-1 hâlâ AKTİF** |

Bulgu **[S-4-03]** — bu bir yarış DEĞİL, tasarlanmış LIFO yolunun kendisinde. Ayrıca yarış varyantı
**[S-4-06]**: FK-2, FK-1'in pre-tx LIFO okumasından SONRA commit ederse eski makbuz LIFO'ya rağmen
iptal edilir.

---

### S4e — Sevk sırasında top Tambur'da kesiliyor / manuel taşınıyor

**Akış.** Fason adımında bekleyen top; bir yandan `dispatch`, öte yandan `manualMove`/kesim.

**Çizelge.**

| Sıra | Sonuç | Kanıt |
|---|---|---|
| `manualMove` önce | `dispatch` claim'i `currentStepId: data.stepId` içerir → count uyuşmaz → 409 | `subcontractor.service.ts:1320-1338` |
| `dispatch` önce | top `AT_SUBCONTRACTOR`; `MOVABLE_STATUSES` bunu içermez → 409 | `workorder-manual-move.service.ts:274, 599-609` |
| Çuval/sevkiyat | claim'de `sackId: null, shipmentId: null` | `subcontractor.service.ts:1330-1332` |

**SONUÇ: KORUNUYOR** — `manualMove` WO kilidini almasa da her iki claim de karşı tarafın yazdığı
alanı `WHERE`'inde taşıyor. Yarış bulgusu yok.

- **`dispatchWithoutColor`:** bu turda tetiklenebilir yeni bir boşluk bulunamadı; alan `WorkOrderStep`
  üzerinde yaşıyor ve `dispatchSchema` (`controllers/subcontractor.controller.ts:10-24`) onu hiç
  taşımıyor — yani sevk anında değiştirilemez, bekçisi `test_dispatch_without_color`.
- **Çeki belgesindeki tek EN:** `assembleFasonCekiDoc` (`subcontractor.service.ts:6366-6385`) EN'i
  `WorkOrder.width`'ten alır ve sevk anında DONDURUR. Renk ve talimat için CANLI overlay var
  (`getDispatchDyeOverlay` `:4452-4494`, Electron `FasonSevkPrintDialog.tsx:75`), EN için YOK →
  **[S-4-08]** (tazelik asimetrisi).

---

### S4f — Çekme toleransı ve orantılı dağıtım

| Kontrol | Sonuç |
|---|---|
| `<=0 → null` yasağı | **UYGULANMIŞ** — `system-setting.service.ts:2541-2552` okuma tarafı `0`ı "tolerans yok" olarak korur, kod yorumu kardeş `readTamburShortCutA1ThresholdM` ile farkı açıkça yazıyor. Kusur yok. |
| Tolerans nerede zorlanıyor | Hiçbir yerde — **sunum katmanı kararı** (`system-setting.service.ts:185-188`); backend eşiğin altındaki farkı da deftere yazar. Tutarlı. |
| Orantılı dağıtım artığı | `allocateShrink` (`helpers/subcontractor-shrink.helper.ts:50-74`) artığı SON satıra yükler → `Σpay === total`. Sıfır paylar elenirken `assigned`'a girmediği için toplam yine korunur. Kusur yok. |
| Çift sayım (çekme fire'ı ↔ kalan fire'ı) | Ayrık kaynaklar (`SUBCONTRACTOR_RETURN` vs `SUBCONTRACTOR_REMAINDER`), `subcontractor.service.ts:3168-3176` yorumu doğru. Aritmetik: 100 giden, 51 düşülen/48 dönen → 3 m çekme; kalan 49 kapanınca 49 m → toplam 52 = 100−48. ✔ |

**Bu senaryodan bulgu ÇIKMADI** (Tur 2'nin `BULGU-T2-037` "defterde satır yok" ölçümü ayrı bir
tezahürdür ve ayakta).

---

### S4g — Kartela: bitmiş top hem kartelaya hem sevkiyata

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| `AT_KARTELA` vs çuval/sevkiyat | **KORUNUYOR** — `kartela.dispatch` claim'i `status: WAREHOUSE, shipmentId: null, sackId: null` (`kartela.service.ts:323-337`); ters yön `scanIntoSack` claim'i `status notIn NON_SACKABLE_STATUSES` (`shipping.service.ts:537`) ve `AT_KARTELA` o kümede (`helpers/sack-invariants.helper.ts:40-56`) | — |
| `kartela.receive` çift kabul | **KORUNUYOR** — atomik claim `status: AT_KARTELA` + count (`kartela.service.ts:678-687`) | — |
| `SwatchStockReduction` sayaç yarışı | **KORUNUYOR** — idempotency çapası tx'in İLK yazması (`:1358-1372`), FIFO select-then-claim + count (`:1393-1404`), P2002 dalında payload özdeşliği (`:1412-1428`) | — |
| `cancelReceipt` × `reduceStock` | **BULGU [S-4-07]** — engellenmiyor ama hata mesajı yanlış sebebi söylüyor; stok-düşümü yapılmış kartelalar iptal kapsamından sessizce düşüyor | `kartela.service.ts:768-786, 806-818` |
| Kartela `dispatch`/`receive`'de `clientToken` | YOK (kardeş `reduceStock`'ta VAR) | K1a haritasındaki **H18**'in tekrarı — bu turda yeni koşul bulunamadı, AÇILMADI |

---

## BULGULAR

### [S-4-01] Fason kabul commit ederken "Rengi Değiştir" çalışırsa mal–plan bekçisi ATLANIR: iş emri KIRMIZI'ya döner, eldeki mal MAVİ kalır ve operatöre hiçbir onay sorulmaz
| Şiddet | S2 | Kategori | A.2 (TOCTOU / atomik claim) | Öncelik | P1 | Modül | fason + iş emri planı | Kanıt seviyesi | K1 |

**Özet.** 2026-08-21'de "renk kilidi ADIMA değil MALA bakar" kararıyla kurulan tek bekçi
(`assertTargetColorChange`), fason kabulünün en uzun transaction'ıyla yarışta devre dışı kalıyor.
Bekçi "fasonda mal var, boyanmamış" derken kabul commit ediyor ve mal ESKİ renkte içeri giriyor;
plan değişikliği claim'i yalnız `targetColorId`'yi kontrol ettiği için engelsiz geçiyor. Sonuç:
`COLOR_DYED_BLOCKED` (ya da `COLOR_PARTIAL_CONFIRM`) hiç sorulmadan plan ile mal ayrışıyor.

**Kanıt.**
- `Teks-Erp/src/services/workorder-link.service.ts:525` — bekçi HAVUZ client'ıyla, kilitsiz:
  ```ts
  const gate = await assertTargetColorChange(prisma, wo, colorId, {
    confirmPartial: opts.confirmPartial,
    recolorRollIds: opts.recolorRollIds,
  });
  ```
- `Teks-Erp/src/services/workorder-link.service.ts:564-573` — claim TOP KÜMESİNİ pinlemiyor:
  ```ts
  const claim = await prisma.workOrder.updateMany({
    where: { id: workOrderId, status: { notIn: PLAN_CHANGE_FROZEN_STATUSES },
             targetColorId: wo.targetColorId },
    data: { targetColorId: colorId },
  });
  ```
- `Teks-Erp/src/services/helpers/workorder-target-color.helper.ts:146-157` — "boyanmış top" sayımı
  `AT_SUBCONTRACTOR`u DIŞLIYOR (`:152`): mal fasondayken mismatch daima 0.
- `Teks-Erp/src/services/subcontractor.service.ts:3059` + `:3080` — kabul born topları
  `colorId = resolvedAppliedColorId` (ESKİ hedef) ve `producedInStepId = data.stepId` ile doğurur →
  `whereRollsOfWorkOrder` (`helpers/workorder-rolls.helper.ts:15-23`) kapsamına GİRER, yani commit'ten
  sonra mismatch > 0 olur.
- **"Koruma yok" teyidi (altı kaynak):** `grep -n "touchWorkOrderTx" src/services/workorder-link.service.ts`
  → **0 vuruş**; `changeTargetColor` `$transaction` da açmıyor (`:506-590` gövdesinde `$transaction` yok);
  advisory lock yok (`grep pg_advisory src/services/workorder-link.service.ts` → 0); `WorkOrder`
  üzerinde renk↔top tutarlılığını zorlayan CHECK/trigger yok (`prisma/schema.prisma` `WorkOrder`
  modelinde `@@check` yok, `test_db_invariants` envanterinde de böyle bir kısıt yok).
- Ters yönün korunuyor olması asimetriyi kanıtlıyor: `subcontractor.service.ts:2693-2718`
  (`expectedTargetColorId` → 409 `TARGET_COLOR_CHANGED`) yalnız "önce renk değişti, sonra kabul geldi"
  sırasını kapatıyor.

**Çakışma senaryosu.**
- **T1 (tablet, Fason Kabul):** `receive` tx'i açıldı, `touchWorkOrderTx` WO'yu kilitledi; born toplar
  MAVİ (eski hedef) renkte yazılıyor. Tx uzun — barkod rezervasyonu, N born roll, movement,
  plan-sapma defteri, refakat kartı taraması (`H10: fason kabul en uzun tx adayı`, K1a).
- **T2 (Electron, planlamacı):** `changeTargetColor(MAVİ→KIRMIZI)`. `assertTargetColorChange` kilit
  DIŞINDA koşar; canlı boyanmış top = 0 (hepsi hâlâ `AT_SUBCONTRACTOR`) → mismatch = 0 → **SERBEST**.
- T2'nin `updateMany`'si T1'in satır kilidinde bekler; T1 commit eder (mal içeride, MAVİ).
- T2 uyanır: `WHERE targetColorId = MAVİ` hâlâ doğru (kabul o kolona dokunmadı) → claim geçer.
- **SONUÇ:** WO hedefi KIRMIZI, elde 6 MAVİ top. Bekçinin vermesi gereken 409 `COLOR_DYED_BLOCKED`
  hiç üretilmedi; operatöre "Tebdil / yeni iş emri / topları da düzelt" seçenekleri sunulmadı.

**failure_mode.** 250 m mal boyahaneye MAVİ hedefiyle gitti. 09:14:03'te tablet kabul kaydını
gönderiyor (tx ~600 ms); 09:14:03,2'de planlamacı müşteri telefonu üzerine rengi KIRMIZI'ya çeviriyor.
Kabul başarıyla kapanıyor (6 top × ~40 m, hepsi MAVİ, adım COMPLETED). İş emri artık KIRMIZI diyor;
Tambur'da her top için `PLAN_MISMATCH` onayı çıkıyor, refakat kartı KIRMIZI basıyor, sipariş
karşılama KIRMIZI sayıyor — ama fabrikada 250 m MAVİ kumaş var ve sistem hiçbir aşamada
"bu iş emri MAVİ olarak bitti, KIRMIZI'ya çeviremezsin" demedi.

**Veride fiili ihlal (K2).** **ARANAMADI** — dev ve saha kopyası bu koşumda erişilemedi
(`Postgres.app failed to verify "trust" authentication`, bkz. §KAPSANMAYAN). Aranacak sorgu:
```sql
-- Hedef rengi DEĞİŞTİRİLMİŞ ve o değişiklikten ÖNCE aynı WO'ya fason kabulü yapılmış iş emirleri
SELECT sl."recordId" AS wo, sl."createdAt" AS renk_degisimi, r."receivedAt" AS kabul
FROM system_logs sl
JOIN subcontractor_receipts r ON r."workOrderId"::text = sl."recordId" AND r."cancelledAt" IS NULL
WHERE sl."tableName" = 'WORK_ORDER'
  AND sl."newData"->>'event' = 'TARGET_COLOR_CHANGED'
  AND r."receivedAt" < sl."createdAt"
  AND sl."createdAt" - r."receivedAt" < interval '5 seconds';  -- yarış penceresi
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-4-01.ts` (yazıldı, tip geçidinden geçti) ·
log `audit/repro/S-4-01.log` → **TETİKLENEMEDİ**: DB erişilemez. Negatif sonuç kayıtlı; script
değiştirilmeden koşturulabilir.

**İş etkisi.** Plan ile mal ayrışır. Refakat kartı / etiket / sipariş karşılama yanlış rengi taşır;
Tambur operatörü her topta gereksiz sapma onayı verir (onay yorgunluğu → gerçek sapmalar da
onaylanır); müşteriye yanlış renk sevk edilme yolu açılır. Kabul edilmiş 409'un (`COLOR_DYED_BLOCKED`)
tüm gerekçesi tam da bunu önlemekti.

**Öneri (2. tur).**
- *Kısa vade:* `changeTargetColor`'ı `prisma.$transaction` içine al ve **ilk ifade**
  `touchWorkOrderTx(tx, workOrderId)` olsun; bekçiyi `tx` ile çağır (`assertTargetColorChange` zaten
  `db` parametresi alıyor ve başlığında "kilit altında da çağrılabilir" yazıyor — yani yol AÇIK,
  yalnız kullanılmamış). Aynısı `changeWidth` için de geçerli.
- *Alternatif/ek:* claim'in `WHERE`'ine "kabul sayısı" gibi bir sürüm alanı eklemek yerine bekçiyi
  kilit altında TEKRARLA (K14 parti guard'ının `cancelReceipt`te yaptığının aynısı,
  `subcontractor.service.ts:4902-4913` emsali).
- Migration/izin/APK **GEREKMEZ**; `[PROD'DA ÇALIŞTIRMA]` uyarısı gerektiren veri dokunuşu yok.

**Kabul kriteri.** `audit_repro_S-4-01.ts` KOL 2 ve KOL 3'te (10 paralel tur) `violated()` hiç
tetiklenmez; sıralı kolda 409 `COLOR_DYED_BLOCKED` alınır. Ek bekçi: `test_wo_target_color_guard`e
"kabul commit'i ile eşzamanlı renk değişikliği" sondası (N=2 paralel, tam 1 başarı).

**Efor.** 0,5 gün.

**Önceki defter.** İlgili ama AYRI: `BULGU-T1-009` (WO iptali fason sevkini kapatamıyor) aynı
servis ailesinde; renk yolu için defterde kayıt yok.

---

### [S-4-02] "Kalan gelmeyecek" kararı, kısmi kabulün iptalini kalıcı olarak kilitliyor — iptal önizlemesi "güvenli" diyor, uç 409 veriyor ve geri dönüş yolu YOK
| Şiddet | S2 | Kategori | E (iş kuralı değişmezleri) + I (hata yolu) | Öncelik | P1 | Modül | fason kısmi kabul | Kanıt seviyesi | K1 |

**Özet.** Kısmi kabul yapıldıktan sonra ikinci masa "kalan gelmeyecek" derse top
`SUBCONTRACTOR_CONSUMED` olur. O andan itibaren kısmi makbuz **hiçbir zaman** iptal edilemez
(claim `AT_SUBCONTRACTOR` ister) ve `closeRemainder`'ın geri alma ucu yoktur. Üstelik iptal
önizlemesi bu engeli **hiç sormadığı** için `allSafe: true` döner — ekip aynı ayrışmayı LIFO ve
parti-uyuşmazlığı için bilinçli olarak kapatmıştı, üçüncü engel açık kalmış.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:3419-3427` — kapama topu terminale çeker:
  ```ts
  const claimed = await tx.roll.updateMany({
    where: { id: data.rollId, status: RollStatus.AT_SUBCONTRACTOR },
    data: { status: RollStatus.SUBCONTRACTOR_CONSUMED, currentStepId: null },
  });
  ```
- `:4930-4944` — kısmi iptal dalı topun `AT_SUBCONTRACTOR` olmasını ŞART koşar:
  ```ts
  const restored = await tx.roll.updateMany({
    where: { id: it.newRollId, status: RollStatus.AT_SUBCONTRACTOR, currentStepId: receipt.stepId },
    data: { currentQty: { increment: it.receivedQty } },
  });
  if (restored.count !== 1) throw AppError.conflict("Kısmen kabul edilmiş top bu sırada başka bir işlemle değişmiş (kalan kapatılmış olabilir) — kabul iptali yapılamadı.");
  ```
- `:4661-4694` — `getCancelPreview` YALNIZ üç şeye bakar: born-roll engelleri, K14 parti uyuşmazlığı,
  LIFO makbuzları. **Makbuzun ORİJİNAL toplarının güncel statüsü hiç sorulmaz** → `allSafe` `true`.
- **Geri alma yolu yok (teyit):** `grep -rn "closeRemainder\|remainderClosedAt" Teks-Erp/src` →
  yazan tek nokta `:3441-3452`; hiçbir yerde `remainderClosedAt: null` yazan / `SUBCONTRACTOR_CONSUMED`u
  geri alan uç yok. `subcontractor.routes.ts:282-306` yalnız `POST .../close-remainder` sunuyor.
- `RollVariance` append-only ve `reversedAt` yalnız `VARIANCE_SOURCES.SUBCONTRACTOR_RETURN` +
  `sourceRefId = receiptId` için terslenir (`:4977-4986`) — `SUBCONTRACTOR_REMAINDER` satırını
  tersleyen kod YOK.

**Çakışma senaryosu (yarış DEĞİL — sıralı, tasarlanmış akış).**
- T1 (masa-1, 09:05): `receive {receivedQty: 51}` → top `AT_SUBCONTRACTOR`, `currentQty` 100→49,
  born 48 m.
- T2 (masa-2, 09:07): `closeRemainder(49)` → top `SUBCONTRACTOR_CONSUMED`, `RollVariance SCRAP 49`,
  kalem `remainderClosedAt` damgalı, adım COMPLETED.
- T3 (masa-1, 09:12): "51 değil 15 girmişim" → `getCancelPreview(FK-1)` → **`allSafe: true`,
  `laterReceipts: []`** → operatör "İptal Et"e basar → **409**.
- **SONUÇ:** Defter kalıcı olarak yanlış: 51 m kabul + 49 m fire yazılı, gerçek 15 m kabul + 85 m
  fasonda. Düzeltmenin TEK yolu DB müdahalesi.

**failure_mode.** Operatör kısmi kabulde metrajı yanlış girer (51 yerine 15). Aynı vardiyada başka
biri "kalan gelmeyecek" der. Düzeltme ekranı yeşil ışık yakar, buton 409 verir ve hata metni
("kalan kapatılmış olabilir") ne yapılacağını söylemez — çünkü yapılacak bir şey yoktur. Fason
karnesinde o firmaya 49 m sahte fire, üretim rakamında 36 m sahte üretim kalır.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Sorgu:
```sql
-- Kalanı kapatılmış ama kısmi makbuzu HÂLÂ aktif olan toplar = iptal edilemez makbuzlar
SELECT r."receiptNo", i."newRollId", i."receivedQty", sdi."remainderClosedAt"
FROM subcontractor_receipt_items i
JOIN subcontractor_receipts r ON r.id = i."receiptId" AND r."cancelledAt" IS NULL
JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = i."newRollId"
WHERE i."isPartial" AND sdi."remainderClosedAt" IS NOT NULL;
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-4-02.ts` — KOL B (`armDeadEnd`) tam bu diziyi kurar
ve `allSafe` ↔ `cancelOk` eşitliğini + "undo ucu var mı" mekanik sondasını ölçer. Log
`audit/repro/S-4-02.log` → **TETİKLENEMEDİ** (DB erişilemez).

**İş etkisi.** Fason karnesinin fire oranı ve üretim metrajı geri alınamaz biçimde yanlışlanır;
operatör düzeltemediği bir hatayı sistemin dışında not tutmaya başlar (2026-08-21 "çekme" kararının
tam da önlemek istediği davranış).

**Öneri (2. tur).**
1. `getCancelPreview`'a **üçüncü engel**: makbuzun kısmi kalemlerinin toplarını oku, biri
   `AT_SUBCONTRACTOR` değilse `blocked` + somut metin ("kalan X m fire olarak kapatıldı — önce kalan
   kapamasını geri alın"). Guard ile ÖNİZLEME aynı yardımcıdan beslensin (K14'te yapılan gibi).
2. `closeRemainder` için **geri alma ucu** (`POST .../reopen-remainder`, izin `roll:manual-adjust`):
   top `AT_SUBCONTRACTOR`a döner, `remainderClosedAt` temizlenir, `RollVariance` satırı
   `reversedAt` ile işaretlenir (**satır SİLİNMEZ** — append-only defter kuralı, `:4977` emsali).
   `sourceRefId`e kapamanın kimliğini yaz ki tersleme adresi belirsiz kalmasın.
3. Migration: `RollVariance.sourceRefId` zaten var; **yeni migration gerekmez**. Yeni izin kodu
   gerekmez (`roll:manual-adjust` ∨ `subcontractor:write`).

**Kabul kriteri.** `audit_repro_S-4-02.ts` KOL B'de `allSafe === cancelOk` ve `D3` (undo ucu) yeşil;
`test_fason_partial_receive`e P10 eklenir: kapama → önizleme `allSafe:false` → reopen → iptal geçer.

**Efor.** 1,5 gün.

**Önceki defter.** Yok (LIFO engeli `test_fason_partial_receive` P5'te ölçülüyor, kapama engeli
ölçülmüyor).

---

### [S-4-03] Kabul iptali, HÂLÂ AKTİF olan önceki teslimatın "Fasondan Döndü" izini siliyor — top geçmişi, üretim raporu ve vardiya aktivitesi sessizce eksiliyor
| Şiddet | S2 | Kategori | E (iş kuralı değişmezleri) + D (tx sınırı) | Öncelik | P2 | Modül | fason kısmi kabul | Kanıt seviyesi | K1 |

**Özet.** `receive`, `SUBCONTRACTOR_RETURNED` operasyon satırını `skipDuplicates` ile yazar ve
`(rollId, stepId, operationType)` unique olduğu için **ikinci teslimatın satırı hiç oluşmaz** — bu
bilinçli, kodda yazılı. Ama `cancelReceipt` aynı adımdaki TÜM `SUBCONTRACTOR_RETURNED` satırlarını
koşulsuz siliyor. LIFO'ya UYGUN biçimde ikinci makbuzu iptal etmek, birinci (hâlâ aktif) makbuzun
izini yok ediyor.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:2929-2950` — yazım ve unique/`skipDuplicates`
  gerekçesi (kodun kendi yorumu):
  ```ts
  // ⚠️ (rollId, stepId, opType) unique olduğundan ikinci teslimatın satırı
  // skipDuplicates ile atlanır — ... bu log "top fasondan döndü" olayının İLK iziydi ve öyle kalır.
  ```
- `:4963-4971` — koşulsuz silme:
  ```ts
  await tx.rollOperation.deleteMany({
    where: { rollId: { in: rollIds }, workOrderStepId: receipt.stepId,
             operationType: RollOperationType.SUBCONTRACTOR_RETURNED },
  });
  ```
  `rollIds` = **bu makbuzun** kalemleri, ama `deleteMany` satırın hangi makbuza ait olduğuna BAKMAZ
  (satırda makbuz kimliği yalnız `metadata.receiptNo` içinde ve `where`de kullanılmıyor).
- Tüketiciler (silinen satırın kimi eksilttiği):
  `Teks-Erp/src/services/inventory.service.ts:377` (topun yaşam döngüsü paneli) ·
  `Teks-Erp/src/services/reports/production.report.service.ts:54` (`subcontractorOps` sayacı) ·
  `Teks-Erp/src/services/work-session-activity.service.ts:112` (vardiya aktivite akışı, ağırlık 7) ·
  `Electron/src/pages/Reports/Production/travelerTraceExport.ts:31` (izlenebilirlik dışa aktarımı).
- "Koruma yok" teyidi: `deleteMany`'nin `where`ine makbuz kısıtı yok; `RollOperation`'da bu satırı
  bir makbuza bağlayan FK/kolon yok (`prisma/schema.prisma` `RollOperation`); iptal sonrası satırı
  YENİDEN yazan bir kod yok (`grep -n "SUBCONTRACTOR_RETURNED" src` → tek create noktası `:2933`,
  bir de `directShip` `:6157` ve `undoTransfer` `:5456` silmesi).

**Çakışma senaryosu (yarış DEĞİL — LIFO'nun kendi yolu).**
- T0: 100 m fasona gitti.
- T1: FK-1 kısmi 51 → `RollOperation(SUBCONTRACTOR_RETURNED)` **yazıldı** (metadata: FK-1, 51, partial).
- T2: FK-2 kısmi 20 → `createMany … skipDuplicates` → satır **yazılmadı** (unique çakışması).
- T3: FK-2 iptal (LIFO'ya UYGUN) → `deleteMany` → **FK-1'in satırı silindi**.
- **SONUÇ:** FK-1 aktif ve defterde 51 m duruyor; topun "Fasondan Döndü" izi YOK.

**failure_mode.** Boyahaneden iki teslimat gelen bir topta ikinci makbuz iptal edilir. Ertesi gün
depo sorumlusu topun geçmişini açar: "Fasona Gönderildi" var, "Fasondan Döndü" YOK — top hâlâ
fasondaymış gibi okunur. Üretim raporundaki `subcontractorOps` bir azalır; kabulü yapan operatörün
vardiya aktivite akışından o olay (ağırlık 7) silinir, yani o kişinin o vardiyadaki işi eksik sayılır.
Hiçbir hata, uyarı ya da log üretilmez.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Sorgu:
```sql
-- Aktif makbuzu OLAN ama SUBCONTRACTOR_RETURNED izi OLMAYAN toplar
SELECT i."newRollId", r."receiptNo", r."receivedAt"
FROM subcontractor_receipt_items i
JOIN subcontractor_receipts r ON r.id = i."receiptId" AND r."cancelledAt" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM roll_operations ro
  WHERE ro."rollId" = i."newRollId" AND ro."workOrderStepId" = r."stepId"
    AND ro."operationType" = 'SUBCONTRACTOR_RETURNED');
```

**Repro (K3).** İstenmiyor (yarış değil), ancak `audit_repro_S-4-05.ts` iskeleti aynı fixture'ı
kurduğu için genişletilebilir. Kod okumasıyla kesinleşiyor.

**İş etkisi.** İzlenebilirlik kaybı (ISO 9001 §7.5 kayıt bütünlüğü), üretim raporu ve operatör
karnesi eksik. Sessiz ve alarmsız → şiddet bir kademe yükseltildi (S3 → S2).

**Öneri (2. tur).** Silme koşulunu makbuza bağla. `RollOperation.metadata->>'receiptNo'` ile silmek
kırılgan; doğrusu iptalde satırı **silmek yerine** aynı adımda hâlâ aktif bir makbuz varsa
**yeniden yazmak** (`createMany … skipDuplicates` ile aktif en yeni makbuzun metadata'sıyla), yoksa
silmek. Minimum yama: `deleteMany`'den SONRA
`if (await tx.subcontractorReceipt.count({ where: { stepId, cancelledAt: null } }) > 0)` ise
kalan aktif makbuzun kalemlerinden satırı yeniden üret. Migration/izin/APK gerekmez.

**Kabul kriteri.** `test_fason_partial_receive` P5'e ek: FK-1(51) + FK-2(20) → FK-2 iptal →
`rollOperation` sayısı 1 (silinmedi/yeniden yazıldı) ve metadata FK-1'i gösteriyor.

**Efor.** 0,5 gün.

**Önceki defter.** Yok.

---

### [S-4-04] Fason Kabul ekranı, sunucudan onay gelmeden "Mal kabul tamamlandı" yeşilini basıp formu siliyor — KK1'de ölçülüp yasaklanan desen burada duruyor ve gerekçesi kısmi kabulden beri YANLIŞ
| Şiddet | S2 | Kategori | I (hata/gözlemlenebilirlik) + B.3 (idempotency sözleşmesi) | Öncelik | P2 | Modül | mobil fason kabul | Kanıt seviyesi | K1 |

**Özet.** `onMutate` (istek daha ağa çıkmadan) yeşil "Mal kabul tamamlandı" toast'ı basıyor ve formu
temizliyor. Kalıcı düşüşte operatör önce YEŞİL, sonra kırmızı görüyor; kabul kaydı oluşmamış olsa
bile girdiği veriler silinmiş oluyor. Bu desen 2026-08-12'de KK1 için ölçülüp kural haline
getirilmişti (kök `CLAUDE.md`: **"`onMutate` yeşil basmaz"**). Dayandığı gerekçe de bayat: offline
varsayılanlarındaki yorum "backend idempotent: bir step'te bir kez receive olur" diyor — bu
2026-08-19 kısmi kabulden beri DOĞRU DEĞİL.

**Kanıt.**
- `mobil/src/screens/Modules/FasonKabul/FasonKabulScreen.tsx:565-575`:
  ```ts
  onMutate: () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Toast.show({ type: 'success', text1: 'Mal kabul tamamlandı',
      text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor' });
    resetForm();
  },
  ```
- `mobil/src/screens/Modules/FasonKabul/FasonKabulScreen.tsx:583-601` — `onError` kırmızı toast basar
  ama formu geri getirmez (dosya içi yorum `:554-558` bunu kabul ediyor: *"Form rollback kompleks
  olduğu için yapılmadı"*).
- `mobil/src/offline/mutations.ts:250-256` — **bayat gerekçe**:
  ```ts
  // Fason Kabul — ... Backend idempotent:
  // bir step'te bir kez receive olur, 2. çağrı mevcut SubcontractorReceipt'i cached döner.
  ```
  Karşı kanıt: `Teks-Erp/src/services/subcontractor.service.ts:2436`
  `if (prior.items.some((i) => i.isPartial)) continue;` — kısmi makbuz cached DÖNMEZ; tek replay
  kimliği `clientToken`'dır ve o da her `buildReceivePayload` çağrısında yeniden üretilir
  (`mobil/.../receivePayload.helper.ts:343`, bekçi bunu ŞART koşuyor: `.test.ts:321-331`).
- Kural metni: kök `CLAUDE.md` → *2026-08-05 KK1 mükerrer koruması* maddesi son cümlesi
  ("`onMutate` yeşil basmaz") ve *2026-08-12 kayıt kuyruğu* maddesi ("toast 'kayıt oluşmadı'
  DİYEMEZ").
- Otomatik retry'ın korunduğu teyidi (yanlış pozitif önleme): `mobil/src/offline/mutations.ts:125-131`
  `stationRetry` 5xx/ağ hatasında AYNI `vars` ile 3 kez dener → aynı token gider; korunmayan tek yol
  operatörün ELLE yeniden göndermesidir.

**Çakışma senaryosu.** Yarış bulgusu değil (istemci sözleşmesi), ama S-4-01 ile birleşiyor:
- T1: operatör "Kaydet" → **YEŞİL toast + form silindi**.
- T2: sunucu 409 `TARGET_COLOR_CHANGED` döner (planlamacı rengi değiştirdi) → kırmızı toast.
- Gürültülü fabrikada, tablet standda; operatör yeşili görüp uzaklaşır. Kabul HİÇ kaydedilmemiştir.
- T3: operatör geri gelip yeniden girerse **yeni `clientToken`** üretilir; ilk istek arada başarılı
  olmuşsa (timeout dalında) kısmi kabul **ikinci kez** düşülür (küme guard'ı kısmiyi atlar).

**failure_mode.** Boyahaneden 6 parça, 245 m mal geldi. Operatör kabul ekranını doldurup Kaydet'e
basıyor; ekran "Mal kabul tamamlandı" diyor ve form sıfırlanıyor. Sunucu 409 döndürüyor. Mal
fiziksel olarak içeride ama sistemde hâlâ `AT_SUBCONTRACTOR`; Kurşun/KK2 ekranında açık kumaş
görünmüyor, depo "boyahanede" diyor. Kimse 6 parçanın nerede kaydolduğunu bilmiyor ve girilen
metrajlar (parça başına ölçüm) kaybolmuş durumda.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Ölçülebilir yaklaşım: aynı `stepId`'ye
90 sn içinde iki KISMİ makbuz (farklı `clientToken`, aynı `receivedQty`) —
```sql
SELECT a."stepId", a."receiptNo", b."receiptNo", a."receivedAt", b."receivedAt"
FROM subcontractor_receipts a JOIN subcontractor_receipts b
  ON b."stepId" = a."stepId" AND b.id <> a.id
 AND b."receivedAt" BETWEEN a."receivedAt" AND a."receivedAt" + interval '90 seconds'
WHERE a."cancelledAt" IS NULL AND b."cancelledAt" IS NULL;
```

**Repro (K3).** İstemci tarafı — `audit_repro_S-4-05.ts` ③ kolu backend'in tokensiz mükerrer kısmi
kabulü kabul ettiğini ölçer (ekranın ürettiği durum). Log `audit/repro/S-4-05.log` → **TETİKLENEMEDİ**.

**İş etkisi.** Mal içeride ama sistemde fasonda görünür; Kurşun/KK2 iş bulamaz, depo sayımı şişer,
fason firmasına ödenmemesi gereken kalan borçlu görünür. En kötüsü: hatanın ilk göstergesi bir
YEŞİL onay olduğu için sahada hiç sorgulanmaz.

**Öneri (2. tur).**
1. `onMutate`'ten `Toast.show({type:'success'})` **kaldırılır**; yerine nötr "gönderiliyor…"
   (offline'da "sıraya alındı") — KK1 ekranının bugünkü deseni.
2. `resetForm()` `onSuccess`'e taşınır; `onError`'da form KORUNUR (ya da düşen payload'dan geri
   doldurulur — `entryAttempt.ts` deseninin fason ikizi).
3. `mobil/src/offline/mutations.ts:250-252` yorumu düzeltilir (kısmi kabulde tek kimlik `clientToken`).
4. `receivePayload.helper.ts`e "yapışkan token": sonucu BELİRSİZ bırakan hatadan (ağ/timeout/5xx)
   sonra AYNI token, kesin 4xx'te YENİ token — `mobil/src/offline/entryAttempt.ts` zaten bu kuralı
   uyguluyor, fason ekranına bağlanmamış. ⚠️ Token'ı ekran/ref seviyesinde SABİTLEME (seri girişte
   sessiz yutma — `CLAUDE.md` KK1 dersi).
5. **APK gerekir**; backend/migration/izin gerekmez.

**Kabul kriteri.** `mobil/src/screens/Modules/FasonKabul/*.test.ts`e: (a) `onMutate` içinde
`type:'success'` toast YOK (AST/metin sondası, `segmented-buttons-row.guard.test.ts` emsali);
(b) hata sonrası form alanları dolu kalıyor; (c) 5xx → aynı token, 400 → yeni token.

**Efor.** 1 gün (+ APK turu).

**Önceki defter.** `BULGU-T2-007` (token her gönderimde yeniden üretiliyor) — bu bulgu onun **ekran
düzeyindeki tamamlayıcısıdır**: T2-007 "koruma fiilen kapalı" der, bu bulgu "operatör kapalı
olduğunu göremez" der. `BULGU-T2-006` (mobil Hızlı İş Emri'nde sessiz no-op) aynı ekran ailesinden.

---

### [S-4-05] Aynı istemci anahtarıyla FARKLI gövde gelirse fason kabulü sessizce "başarılı" diyor — kardeş kartela ucu aynı durumda `CLIENT_TOKEN_COLLISION` veriyor
| Şiddet | S3 | Kategori | B.3 (idempotency) | Öncelik | P3 | Modül | fason kabul | Kanıt seviyesi | K1 |

**Özet.** `receive`'in token dalı, bulduğu makbuzu payload ile KARŞILAŞTIRMADAN `success: true` ile
döndürür. Aynı repoda aynı sorunun çözülmüş bir örneği var (`kartela.reduceStock`): orada payload
özdeşliği kontrol edilir ve farklıysa `CLIENT_TOKEN_COLLISION` 409 atılır. Asimetri, "sessizce yanlış
cevap 409'dan daha kötüdür" kuralının (beceri §8) fason tarafında uygulanmadığını gösteriyor.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:2350-2378` — karşılaştırma YOK:
  ```ts
  const tokenHit = await prisma.subcontractorReceipt.findUnique({ where: { clientToken: data.clientToken }, include: {...} });
  if (tokenHit) {
    if (tokenHit.cancelledAt) throw AppError.conflict("… İPTAL edilmiş …", { code: "RECEIPT_CANCELLED" });
    return { success: true, data: tokenHit, message: `Mal kabul zaten yapılmış (idempotent retry). Makbuz: ${tokenHit.receiptNo}` };
  }
  ```
  (İptal edilmiş kaydın replay'i DOĞRU ele alınmış — bu, ekibin kuralı bildiğini kanıtlıyor.)
- Kardeş, DOĞRU desen: `Teks-Erp/src/services/kartela.service.ts:1412-1428`
  ```ts
  const same = existing.itemId === data.itemId && (existing.colorId ?? null) === (data.colorId ?? null) && existing.count === data.count;
  if (same) return { success: true, … };
  throw AppError.conflict("Bu istemci anahtarı farklı bir stok düşümüyle kullanılmış…", { code: "CLIENT_TOKEN_COLLISION", … });
  ```
- Aynı desen `inventory.service.ts:4218-4262` (KK1 F117) için de kurulmuş — yani repoda **iki**
  uygulanmış emsal var, fason kabulü kapsam dışında kalmış.

**failure_mode.** Bir istemci (bugün Electron `FasonReceiveDialog` token GÖNDERMİYOR; yarın
gönderirse ya da mobil "yapışkan token" düzeltmesi geldiğinde) aynı token'ı düzeltilmiş bir gövdeyle
tekrar gönderir: operatör 51 m yerine 60 m yazıp Kaydet'e basar, ekran "Mal kabul zaten yapılmış
(idempotent retry). Makbuz: FK2508290012" der. Operatör düzeltmenin kaydolduğunu sanır; defterde
hâlâ 51 m durur, kalan 49 m yerine 40 m sanılır.

**Çakışma senaryosu (eşzamanlı varyant — AYRI bulgu, açılmadı).** Aynı token EŞZAMANLI gelirse
kaybeden `withBarcodeRetry` yüzünden "Barkod üretimi 5 denemede başarısız oldu" alır →
**`BULGU-T1-005` (ayakta)**; burada yeniden AÇILMADI, bu bulgu SIRALI replay'in gövde kontrolüne
dairdir.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez); ayrıca K2a haritasına göre sahada
`SubcontractorReceipt.clientToken` yalnız **2/143** dolu → bugün tetiklenme olasılığı düşük, S3
seviyesinin gerekçesi budur. Ölçüm: `SELECT count(*) FROM subcontractor_receipts WHERE "clientToken" IS NOT NULL;`

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-4-05.ts` ② kolu (51 → 60 aynı token). Log
`audit/repro/S-4-05.log` → **TETİKLENEMEDİ** (DB erişilemez).

**İş etkisi.** Bugün düşük (token sahada neredeyse hiç gönderilmiyor); S-4-04'ün 4. önerisi
uygulandığı ANDA yüksek — yani düzeltmenin ön koşuludur.

**Öneri (2. tur).** `tokenHit` dalına hafif payload özdeşliği: `stepId` + `subcontractorId` +
`returns` kümesi (rollId + receivedQty) + `newRolls` toplamı. Farklıysa 409 `CLIENT_TOKEN_COLLISION`
+ `details.existing/incoming` (kartela metninin birebir ikizi). Migration/izin/APK gerekmez.

**Kabul kriteri.** `audit_repro_S-4-05.ts` ② yeşil; `test_fason_partial_receive` P3'e negatif ikiz
(farklı gövde → 409 `CLIENT_TOKEN_COLLISION`).

**Efor.** 0,5 gün.

**Önceki defter.** `BULGU-T1-005` (eşzamanlı token → teknik 409) · `BULGU-T1-006` (iptal edilmiş
kaydın replay'i — fason tarafında DOĞRU çözülmüş, bu bulguya dahil değil).

---

### [S-4-06] Kabul iptalinin LIFO kapısı transaction DIŞINDA okunuyor ve kilit altında tekrarlanmıyor — araya giren ikinci teslimat kapıyı sessizce açık bırakıyor
| Şiddet | S3 | Kategori | A.2 (TOCTOU) | Öncelik | P3 | Modül | fason kısmi kabul | Kanıt seviyesi | K1 |

**Özet.** `cancelReceipt`, "bu makbuzun toplarına dokunan daha yeni makbuz var mı" sorusunu tx'e
girmeden soruyor ve WO kilidini aldıktan sonra TEKRARLAMIYOR. Aynı fonksiyonda K14 parti-uyuşmazlığı
guard'ı bilinçli olarak tx İÇİNDE de koşuyor — yani desen biliniyor, LIFO'ya uygulanmamış.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:4755-4776` — LIFO guard'ı, `prisma` (havuz) ile,
  `$transaction`'dan ÖNCE:
  ```ts
  const laterReceipts = await prisma.subcontractorReceipt.findMany({
    where: { stepId: receipt.stepId, cancelledAt: null, id: { not: receiptId },
             createdAt: { gt: receipt.createdAt },
             items: { some: { newRollId: { in: rollIds } } } }, … });
  if (laterReceipts.length > 0) throw AppError.conflict(`… (iptal sırası: yeniden eskiye).`, { code: "RECEIPT_NOT_LATEST" });
  ```
- `:4807` — WO kilidi ancak BUNDAN SONRA alınıyor (`touchWorkOrderTx`).
- `:4902-4913` — K14 guard'ı tx İÇİNDE tekrarlanıyor, üstelik yorumu neden gerektiğini yazıyor
  (*"Guard KALIR (son savunma hattı; önizleme bayat olabilir)"*). LIFO için aynı tekrar YOK.
- "Koruma yok" teyidi: kısmi dalın claim'i (`:4930-4944`) yalnız topun `AT_SUBCONTRACTOR` +
  `currentStepId` olduğunu doğrular — **ikinci makbuzun VARLIĞINI doğrulamaz**; iki kısmi teslimat
  arasında top zaten `AT_SUBCONTRACTOR` kaldığı için claim geçer.

**Çakışma senaryosu.**
- **T1 (masa-1):** `cancelReceipt(FK-1)` — pre-tx LIFO okuması: FK-1'den yeni makbuz YOK → geçer.
- **T2 (masa-2):** `receive` FK-2 (kısmi 20) → WO kilidi alır, commit eder.
- **T1:** tx açar, WO kilidini alır (T2 bıraktı), K14 temiz, kısmi claim `AT_SUBCONTRACTOR` → **geçer**
  → FK-1 iptal edilir, +51 m geri konur.
- **SONUÇ:** FK-2 (daha yeni) aktif kalırken FK-1 (daha eski) iptal edilmiş — tam da LIFO kuralının
  yasakladığı durum. Yan hasar S-4-03 ile birleşir: `rollOperation.deleteMany` FK-2'nin de dayandığı
  izi siler.

**failure_mode.** Boyahane 100 m malın 51'ini gönderdi (FK-1). Masa-1 metrajı yanlış girdiğini fark
edip iptal ekranını açtı ve "İptal Et"e bastı. Aynı saniyede masa-2 ikinci teslimatı (20 m, FK-2)
kaydetti. Her ikisi de başarılı döndü. Defter: FK-2 aktif (20 m), FK-1 iptal; top `currentQty`
100−20+51 = ... sıralamaya göre 80 ya da 131. Kullanıcı "iptal sırası: yeniden eskiye" kuralına
uyduğunu sanır; sistem kuralı bu turda hiç uygulamamıştır.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Sorgu:
```sql
-- İptal edilmiş bir makbuzdan SONRA oluşmuş ve hâlâ aktif olan, aynı topa dokunan makbuz
SELECT c."receiptNo" AS iptal, c."cancelledAt", a."receiptNo" AS aktif, a."createdAt"
FROM subcontractor_receipts c
JOIN subcontractor_receipt_items ci ON ci."receiptId" = c.id
JOIN subcontractor_receipt_items ai ON ai."newRollId" = ci."newRollId"
JOIN subcontractor_receipts a ON a.id = ai."receiptId"
WHERE c."cancelledAt" IS NOT NULL AND a."cancelledAt" IS NULL
  AND a."createdAt" > c."createdAt" AND a."stepId" = c."stepId";
```

**Repro (K3).** `audit_repro_S-4-02.ts` iskeleti aynı fixture'ı kuruyor; ayrı kol yazmak için hazır.
Bu turda ayrı script YAZILMADI (mandat: en güçlü 2-4 aday; S-4-01/02/05 seçildi).

**İş etkisi.** Kısmi teslimat defteri iç içe geçer; fason karnesi ve kalan hesabı yanlışlanır.
Olasılık düşük (iki masanın aynı adımda saniyeler içinde çalışması gerekir; sahada aynı adımda 1'den
çok aktif makbuz sayısı ölçülemedi) → S3.

**Öneri (2. tur).** LIFO sorgusunu tx İÇİNDE, `touchWorkOrderTx`'ten SONRA tekrarla (K14 emsali).
Sorguyu tek yardımcıya çıkar ki `getCancelPreview` ile ayrışmasın (`computeReceiptBatchMismatches`
deseni). Migration/izin/APK gerekmez.

**Kabul kriteri.** N=2 paralel sonda: `cancelReceipt(FK-1)` ‖ `receive(FK-2)` → tam olarak biri
başarılı; kaybeden 409 `RECEIPT_NOT_LATEST` ya da net bir çakışma mesajı alır.

**Efor.** 0,25 gün.

**Önceki defter.** Yok.

---

### [S-4-07] Kartela kabul iptali, eşzamanlı stok düşümünü "sevkiyata/çuvala bağlanmış" diye raporluyor; stoktan düşülmüş kartelalar iptal kapsamından sessizce çıkıyor
| Şiddet | S3 | Kategori | I (hata yolu) + E | Öncelik | P4 | Modül | kartela | Kanıt seviyesi | K1 |

**Özet.** `kartela.cancelReceipt`'in in-tx claim'i, kartelaların `cancelledAt: null` olmasını da şart
koşuyor; ama `reduceStock` (stok düşümü) tam olarak o kolonu yazıyor. Çakışmada operatöre
"sevkiyata/çuvala bağlanmış — önce sevkiyattan çıkarın" deniyor; oysa yapılacak şey farklı ve o
kartela hiçbir sevkiyatta değil. Ayrıca ÖNCEDEN stoktan düşülmüş kartelalar hem engel kontrolünden
hem iptal kapsamından süzülüyor.

**Kanıt.**
- `Teks-Erp/src/services/kartela.service.ts:768-772` — kapsam pre-tx ve `cancelledAt: null` süzgeçli:
  ```ts
  swatches: { where: { cancelledAt: null }, select: { id: true, shipmentId: true, sackId: true, cardNumber: true } },
  ```
- `:806-818` — claim ve **yanlış sebebi söyleyen** mesaj:
  ```ts
  const cancelledSwatches = await tx.swatch.updateMany({
    where: { id: { in: swatchIds }, shipmentId: null, sackId: null, cancelledAt: null }, … });
  if (cancelledSwatches.count !== swatchIds.length)
    throw AppError.conflict("Kartelalardan biri bu sırada sevkiyata/çuvala bağlanmış — kabul iptal edilemedi. Önce sevkiyattan çıkarın.");
  ```
- `:1393-1404` — `reduceStock` tam da `cancelledAt`i yazar (`data: { cancelledAt: new Date(), cancelReason: reason }`).
- `:717-750` — `getReceiptCancelPreview` yalnız `shipmentId`/`sackId` engellerini gösterir; stok
  düşümü ne engelde ne kapsamda görünür.

**Çakışma senaryosu.**
- **T1:** `reduceStock(item, color, 50)` → FIFO ile KK-1'in 50 kartelasını `cancelledAt` ile düşer,
  `SwatchStockReduction` olay satırı yazılır.
- **T2:** `cancelReceipt(KK-1)` → pre-tx okumada 200 kartela (T1'den önce) → in-tx claim yalnız 150'yi
  eşler → 409 **"sevkiyata/çuvala bağlanmış"**.
- **SONUÇ:** Veri bozulmuyor (rollback doğru), ama operatör var olmayan bir sevkiyatı aramaya
  gönderiliyor. Sıralı varyantta (düşüm önce, iptal sonra) 409 hiç çıkmaz: iptal 150 kartelayı
  kapsar, düşülen 50 kartela `SwatchStockReduction` defterinde artık var olmayan bir makbuza ait
  olarak kalır.

**failure_mode.** Kartela firmasından 200 kartela geldi (KK-1). Depo 50'sini hasarlı diye stoktan
düştü. Ertesi gün "adet yanlış girilmiş" denip KK-1 iptal edilmek isteniyor: ekran engel göstermiyor,
uç ya 409 "sevkiyattan çıkarın" (eşzamanlıysa) ya da sessizce 150'yi iptal ediyor. İkinci durumda
`SwatchStockReduction` defterinde 50 adetlik bir düşüm, iptal edilmiş bir kabulün kartelalarına
işaret ediyor ve hiçbir raporda bu bağ kurulamıyor.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Sorgu:
```sql
SELECT s.id, s."cardNumber", s."cancelReason", r."receiptNo", r."cancelledAt"
FROM swatches s JOIN kartela_receipts r ON r.id = s."parentReceiptId"
WHERE s."cancelledAt" IS NOT NULL AND r."cancelledAt" IS NOT NULL
  AND s."cancelledAt" < r."cancelledAt";
```

**Repro (K3).** İstenmiyor (D-A/D-B dışı alan) ve yazılmadı — kod okumasıyla kesin.

**İş etkisi.** Operasyonel yanlış yönlendirme + kartela stok defterinde izlenemez kalıntı.
Sahada kartela hacmi düşük olduğu için S3.

**Öneri (2. tur).** ① Claim mesajını sebebe göre ayır: `cancelledAt IS NOT NULL` olan kartelaları
ayrı say ve "N kartela bu sırada stoktan düşüldü" de. ② Önizlemeye ve iptale
"stoktan düşülmüş kartela" satırını EKLE (`blockingReasons`'a üçüncü sebep) — kullanıcı kararı
gerekebilir (düşümü de tersle mi, iptali reddet mi). Migration gerekmez.

**Kabul kriteri.** `test_kartela_*` bekçisine: düşülmüş kartelası olan makbuzun önizlemesi
`cancellable:false` + sebep metni "stoktan düşüldü".

**Önceki defter.** Yok (K1a **H18** kartela `clientToken` eksikliği ayrı ve bu turda AÇILMADI).

---

### [S-4-08] Fason çekisinin ÜÇ alanı üç farklı tazelik politikasında; sistemin KENDİ değiştirdiği alan (EN) donmuş olan ve bayatlığı bildiren tek işaret hiçbir ekranda çizilmiyor
| Şiddet | S3 | Kategori | E (donmuş belge) + L (tutarsız politika) | Öncelik | P4 | Modül | fason belge | Kanıt seviyesi | K1 |

**Özet.** Boyahaneye giden çeki listesinde renk CANLI overlay'den, talimat CANLI kolondan, EN ise
sevk anında DONMUŞ snapshot'tan basılıyor. `changeWidth`, EN'i değiştirirken kodun kendi yorumuyla
"kâğıt bayatladı" diyor ve `markTravelerCardDirtyTx` çağırıyor — ama (a) o bayrak REFAKAT KARTINA
aittir, fason çekisine değil; (b) `contentDirty` rozeti 2026-08-06'da HER İKİ istemciden de
kaldırıldı, yani sinyalin hiçbir alıcısı yok.

**Kanıt.**
- `Teks-Erp/src/services/subcontractor.service.ts:6366-6385` — EN'in kaynağı ve donması:
  ```
  /** `width` = iş emrinin eni. Çekideki TEK "EN" değerinin kaynağı budur … */
  ```
  ve `buildFasonDispatchDoc` (`:6440-6460`) `workOrder.width`i snapshot'a yazar
  (`printedDocumentService.freezeForSource`, `:1244-1250`).
- CANLI overlay yalnız renk + talimat taşıyor: `:4452-4494` `getDispatchDyeOverlay`
  (`requestedColor`, `instruction`, `stepNote`, `instructionLocked`) — **EN YOK**;
  tüketici `Electron/src/pages/Operations/WorkOrders/FasonSevkPrintDialog.tsx:75`.
- `Teks-Erp/src/services/workorder-link.service.ts:637-640`:
  ```ts
  // En, fason çekisindeki TEK "EN" değerinin kaynağı → kâğıt bayatladı.
  await markTravelerCardDirtyTx(prisma, workOrderId);
  ```
  → hedef `TravelerCard.contentDirty` (`helpers/traveler-card-dirty.helper.ts:37-41`).
- Sinyalin alıcısı yok: `Electron/src/pages/Operations/WorkOrders/TravelerCardPrintDialog.tsx:37`
  *"⚠️ 'GÜNCEL DEĞİL' BANDI KALDIRILDI (2026-08-06, kullanıcı kararı)"*;
  `mobil/src/screens/Modules/HizliIsEmri/WorkOrderDetailSheet.tsx:62` aynı gerekçe.
  `grep -rn "contentDirty" Electron/src mobil/src` → yalnız tip tanımı + iki "kaldırıldı" yorumu.
- `PrintedDocument` üzerinde bayatlık kolonu YOK (`prisma/schema.prisma:4011-4040`); otomatik
  `reissueForSourceTx` çağrısı repoda **tek** yerde ve fason değil (`return.service.ts:927`).

**failure_mode.** İş emrinin eni 250 cm iken iki parti iki ayrı sevkle boyahaneye çıkar (K10: bir
sevk = bir parti). Birinci partinin kabulünde personel eni 245 ölçer; `receive` tx DIŞINDA
`changeWidth`i çağırır (`subcontractor.service.ts:3268-3283`) ve `WorkOrder.width` 245 olur. İkinci
partinin boyahanedeki kâğıdı hâlâ 250 diyor; sistemde 245. Sistem bu farkı ne bir bantla, ne bir
revizyonla, ne bir uyarıyla söyler — `markTravelerCardDirtyTx` çağrısı bir bayrağı çevirir ve o
bayrağı okuyan tek ekran 2026-08-06'da kaldırılmıştır.

**Veride fiili ihlal (K2).** **ARANAMADI** (DB erişilemez). Sorgu:
```sql
-- Açık fason sevki varken WO eni değişmiş vakalar (donmuş çeki ile canlı en ayrışması)
SELECT d."dispatchNo", d."dispatchedAt", sl."createdAt" AS en_degisti,
       sl."oldData"->>'width' AS eski, sl."newData"->>'width' AS yeni
FROM system_logs sl
JOIN subcontractor_dispatches d ON d."workOrderId"::text = sl."recordId"
WHERE sl."tableName"='WORK_ORDER' AND sl."newData"->>'event' = 'TARGET_WIDTH_CHANGED'
  AND d."cancelledAt" IS NULL AND d."directShippedAt" IS NULL
  AND sl."createdAt" > d."dispatchedAt";
```

**Repro (K3).** İstenmiyor (yarış değil).

**İş etkisi.** Boyahanedeki kâğıt ile sistem ayrışır; kesim/ram ayarını kâğıttan yapan fason yanlış
ende çalışır. Düşük frekans (WO başına birden çok açık sevk gerekir) → S3.

**Öneri (2. tur).** İki şık, kullanıcı kararı:
- **(a) EN'i de canlı overlay'e al** — `getDispatchDyeOverlay` yanıtına `workOrderWidth` ekle,
  `FasonSevkPrintDialog` onu bassın. Renk/talimat ile aynı politika, en ucuz yol.
- **(b) EN'i donmuş bırak ama bayatlığı GÖRÜNÜR yap** — `changeWidth`/`changeTargetColor` açık sevk
  varsa `PrintedDocument`'ı `reissueForSourceTx` ile revize etsin (v2, gerekçe: "iş emri eni
  değişti"); belge zaten sürüm defteri tutuyor.
`markTravelerCardDirtyTx` çağrısının yorumu her iki durumda da düzeltilmeli (yanlış şeyi
işaretlediğini söylüyor). Migration/izin/APK gerekmez.

**Kabul kriteri.** Açık sevk varken `changeWidth` → çeki önizlemesi yeni eni gösterir (a) ya da
belge v2'ye çıkar (b); bekçi `test_fason_ceki_*`.

**Önceki defter.** `BULGU-T1-038` (kabulde en yazılamazsa operatöre söylenmiyor) — komşu, ama o
YAZMA hatasının sessizliği, bu OKUMA yüzeyinin ayrışması.

---

## Uygulanan kontrol listesi

> Kaynak: `Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3. Bu denetçi SENARYO merceğiyle koştuğu
> için maddeler "bu senaryolarda" kapsamında uygulandı.

| Madde | Durum |
|---|---|
| **A.1** tx içinde çok adımlı iş | uygulandı — `receive` (`:2679-2925`), `closeRemainder`, `cancelReceipt`, `dispatch`, kartela `receive`/`cancelReceipt` tek tek izlendi |
| **A.2** TOCTOU / atomik claim | uygulandı → **S-4-01, S-4-06**; korunuyor bulunanlar §S4a/S4e/S4g'de gerekçeli yazıldı |
| **A.3** advisory lock sırası | uygulandı — fason yolunda advisory lock YOK; serileştirme `touchWorkOrderTx` satır kilidiyle (`workorder-locks.helper.ts:50-58`). `createBatchTx`in 8022 kilidi `receive` içinde WO kilidinden SONRA alınıyor (`:3092-3099`) → sıra tutarlı, ABBA yok (dispatch'te de aynı sıra: `:1041` → `:1210`) |
| **A.4** JSON oku-değiştir-yaz | **kapsam dışı — bu senaryolarda yok**: `RollOperation.metadata` yalnız create'te yazılıyor, güncellenmiyor (`grep -n "metadata:" subcontractor.service.ts` → hepsi `createMany`) |
| **A.5** çoklu instance | kapsam dışı — TEK PROCESS belgeli (`KUNYE.md`); fason yolunda modül-seviyesi durum yok |
| **A.6** belge no üretimi | uygulandı — `nextPrefixedSequence` + `withBarcodeRetry` (FS/FK/KS/KK); mükerrer no bulgusu YOK. Kilit süresi gözlemi `BULGU-T1-093` (ayakta), yeniden açılmadı |
| **A.7/A.8** ALS / cache | kapsam dışı — bu senaryolarda dokunulmuyor |
| **B.1** beklenen tekillik | uygulandı — `SubcontractorReceipt.clientToken @unique`, `KartelaDispatch` token YOK (H18, açılmadı) |
| **B.3** clientToken davranışı | uygulandı → **S-4-05**; iptal-replay dalı DOĞRU (`:2358-2365`) ve "Doğru yapılanlar"a yazıldı |
| **B.4** kuyruk/watermark | uygulandı (mobil offline kuyruk) → **S-4-04** |
| **C** veri modeli | kısmi — `SubcontractorReceiptItem.receivedQty` NULL oranı (K2a: 635/638) ölçülemedi (DB yok); şema okuması yapıldı |
| **D** tx sınırları | uygulandı — `receive` sonrası tx-DIŞI `changeWidth`/`changeTargetColor` (`:3270-3320`) incelendi; `BULGU-T1-038` ayakta, S-4-08 ayrı yüzey |
| **E** iş kuralı değişmezleri (fason kısmi kabul/kalan/iptal LIFO) | uygulandı → **S-4-02, S-4-03, S-4-06**; "toplam korunuyor" aritmetiği §S4f'de ölçüldü |
| **F** API/Express | kısmi — `receiveSchema` dizi tavanları VAR (300/300/500); `dispatchSchema`da `clientToken` YOK (bilinçli, set-eşitliği) |
| **G** güvenlik | kapsam dışı — senaryo merceği; yetki kapıları `subcontractor.routes.ts`te `requireAnyPermission` ile, ihlal görülmedi |
| **H** performans | kapsam dışı (ayrı denetçi) — yalnız "receive en uzun tx" gözlemi S-4-01'in olasılık gerekçesinde kullanıldı |
| **I** hata/gözlemlenebilirlik | uygulandı → **S-4-04, S-4-07, S-4-02** (önizleme↔uç ayrışması) |
| **J** migration | kapsam dışı — bu turda migration dokunuşu yok |
| **K** bekçiler | kısmi — `test_fason_partial_receive` (P1-P9) okundu; kör noktaları her bulgunun "Kabul kriteri"nde adlandırıldı |
| **L** kod kalitesi / hesap tekrarı | uygulandı → **S-4-08** (üç farklı tazelik politikası); `allocateShrink` toplam korunumu doğrulandı |

---

## Doğru yapılanlar (korunmalı kalıplar)

1. **`touchWorkOrderTx` protokolü — fason yollarının HEPSİ katılıyor.** 7 yazma yolu (dispatch,
   cancel, receive, closeRemainder, cancelReceipt, undoTransfer, executeDirectShip) tx'in ilk
   ifadesinde aynı WO satırını kilitliyor (`helpers/workorder-locks.helper.ts:50-58` + 7 çağrı
   yeri). S4a ve S4e'nin temiz çıkmasının tek sebebi bu. **Yeni bir fason yazma yolu eklerken bu
   satır ilk ifade olmalı** — sonraya alınan kilit hiçbir şey kazandırmaz (KK1 8021 dersi).
2. **Kilit ALTINDA taze okuma alışkanlığı.** `receive` hem hedef rengi (`:2693-2718`) hem kalan
   metrajı (`:2764-2777`) kilit altında yeniden okur ve `expectedTargetColorId` ile istemcinin
   gördüğü değeri karşılaştırır. Bu, S4c'nin ters yönünü tamamen kapatıyor.
3. **Atomik claim + count disiplini her geçişte.** `dispatch` (`:1320-1338`), `receive` tam/kısmi
   dalları (`:2858-2896`), `closeRemainder` (`:3419-3427`), `cancelReceipt` (`:4913-4944`), kartela
   `dispatch`/`receive`/`cancelReceipt` — hepsinde `updateMany WHERE {beklenen durum}` + `count`
   kontrolü var ve her birinin yanında NEDEN gerektiği yazılı.
4. **İptal edilmiş kaydın replay'i DOĞRU ele alınmış.** `receive` token dalı `cancelledAt` görünce
   409 `RECEIPT_CANCELLED` atıyor (`:2358-2365`) — beceri §8'in "en pahalı hata"sı burada
   yapılmamış. Küme-eşitliği guard'ı da `cancelledAt: null` süzgeci taşıyor (`:2409-2414`).
5. **"Açık + outstanding sevk" tanımının tek kaynağı** (`helpers/fason-open-dispatch.helper.ts`) +
   AST bekçisi. Dört koşulun neden birlikte gerektiği dosya başlığında yazılı ve iki sessiz yanlış
   somut örnekle anlatılmış.
6. **Önizleme ↔ guard ortak yardımcısı.** `computeReceiptBatchMismatches` hem `getCancelPreview`
   hem `cancelReceipt` tarafından çağrılıyor (`:4657`, `:4911`) ve yorumu "iki kopya kaçınılmaz
   olarak ayrışır" diyor. S-4-02'nin önerisi tam olarak bu deseni üçüncü engele uygulamaktır.
7. **Sapma defterinde tersleme adresi `sourceRefId`, `rollId` DEĞİL** (`:4977-4986`) — kısmi
   teslimatta aynı topun birden çok meşru sapması olduğu için doğru seçim; gerekçesi kodda yazılı.
8. **`kartela.reduceStock`'un idempotency çapası tx'in İLK yazması** (`kartela.service.ts:1358-1372`)
   ve P2002 dalında payload özdeşliği (`:1412-1428`) — repodaki en olgun idempotency örneği.

---

## Sınır ötesi notlar

1. **(→ D-A / KYY eşzamanlılık)** `workorder-link.service.ts` ve `workorder-manual-move.service.ts`
   `touchWorkOrderTx`i HİÇ çağırmıyor (grep 0). S-4-01 bunun fason yüzündeki tezahürü; aynı boşluk
   `linkOrderLines`/`unlinkOrderLine`/`apply-attribute-to-rolls` için de geçerli olabilir ve o
   yüzeyler bu denetçinin kapsamı dışında.
2. **(→ D-I / raporlar)** `production.report.service.ts:54` `subcontractorOps` sayacı
   `RollOperation` satırlarından türüyor; S-4-03 o sayacın geriye dönük DÜŞEBİLDİĞİNİ gösteriyor
   (kapanmış dönemin rakamı sonradan değişir) — Tur 1 çürütücü notundaki "dönem kararlılığı"
   sınıfının ikinci örneği.
3. **(→ D-K / bekçiler)** `test_fason_partial_receive` P5 LIFO'yu **sıralı** ölçüyor; paralel
   sondası yok (K11 HOTSPOT-4 ile aynı tespit). Aynı dosyada `closeRemainder` sonrası iptal
   denemesi de yok — S-4-02'nin bekçide kör kalmasının sebebi bu.
4. **(→ D-C / veri modeli)** `RollOperation` satırının hangi makbuza ait olduğu yalnız
   `metadata.receiptNo` içinde (indekssiz JSON). S-4-03'ün "doğru düzeltme"si bir kolon
   (`receiptId`) isteyebilir → migration kararı.
5. **(→ mobil denetçisi)** `FasonKabulScreen.tsx:554-558` yorumu form rollback'inin bilinçli olarak
   yapılmadığını söylüyor; aynı desen `KartelaKabulScreen.tsx:445/644`de de var (orada `onMutate`
   incelenmedi) — ekran ailesi taranmalı.
6. **(→ D-G / güvenlik)** `auth.sameTypeSessionPolicy="off"` (saha) yüzünden **aynı kullanıcı**
   iki cihazdan aynı adımda paralel kabul yapabiliyor; bu turdaki tüm çakışma senaryolarının
   olasılığını yükselten ön koşul budur ve bir yetki kararı olarak ayrıca değerlendirilmeli.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **⚠️ VERİTABANI ERİŞİLEMEDİ — bu turun en büyük boşluğu.** Hem `audit/tools/sql-dev.sh` hem
   `sql-saha.sh` hem de Prisma üzerinden koşan repro scriptleri aynı hatayı verdi:
   ```
   FATAL: Postgres.app failed to verify "trust" authentication
   DETAIL: Postgres.app failed to show a dialog…
   ```
   (`pg_isready` "accepting connections" diyor — sunucu ayakta, kimlik doğrulama katmanı OS izni
   yüzünden kapalı; sandbox kapatılarak da denendi, sonuç aynı.)
   **Sonuç:** hiçbir bulgu **K2** (veride fiili ihlal) ya da **K3** (repro) seviyesine
   çıkarılamadı; hepsi **K1**'de kaldı ve *"S0 için K2/K3 şart"* kuralı gereği hiçbir bulgu S0
   yazılmadı. Her bulgunun altında koşulacak SQL yazılı; DB açıldığında sırayla koşulmalı.
2. **Repro scriptleri yazıldı ve tip geçidinden geçti, ama TETİKLENEMEDİ.**
   `Teks-Erp/scripts/audit_repro_S-4-01.ts` · `audit_repro_S-4-02.ts` · `audit_repro_S-4-05.ts`
   (`npx tsc --noEmit -p tsconfig.scripts.json` → bu üç dosyada 0 hata). Loglar
   `audit/repro/S-4-01.log`, `S-4-02.log`, `S-4-05.log` — her birinin sonunda denetçi notu var.
   **Negatif sonuç, "kusur yok" DEĞİLDİR.**
3. **S4b'nin "iki tablet" varyantı gerçek cihazla ölçülmedi** — `uiautomator`/`adb` bu oturumda
   kullanılmadı; istemci tarafı yalnız kod okumasıyla değerlendirildi (S-4-04 kanıt seviyesi K1).
4. **`executeDirectShip` (fasondan doğrudan müşteriye) ayrıntılı izlenmedi** — WO kilidini aldığı
   (`:6022`) ve `OPEN_OUTSTANDING` tanımını kullandığı doğrulandı; içindeki kısmi metraj bölme
   (`rollShipQtys`) ve `orderLineAllocations` yolu kapsam dışı bırakıldı (senaryo listesinde yok,
   sevkiyat denetçisinin alanı).
5. **`transferToNextFason` / `undoTransfer` yüzeysel incelendi** — kilit protokolüne katıldıkları
   doğrulandı, kendi guard'ları (born topun kendi sevkini meşru sayan özel tx) satır satır
   denetlenmedi.
6. **Fason karnesi (`subcontract-scorecard.report.service.ts`) aritmetiği** bu turda yeniden
   türetilmedi; Tur 2'nin `BULGU-T2-037` ölçümüne güvenildi.
7. **`ReasonPreset` / `validateVarianceReason` kapısı** `closeRemainder` yolunda yalnız çağrı
   sırası açısından bakıldı (tx dışı ön doğrulama + tx içi asıl kapı); sebep kataloğunun kendi
   eşzamanlılığı (60 sn önbellek dersi) kapsam dışı.
8. **Electron `FasonReceiveDialog`** yalnız `shrinkExceedsTolerance` ve `clientToken` yokluğu
   açısından tarandı; kısmi kabul alanlarının doğrulaması incelenmedi.
