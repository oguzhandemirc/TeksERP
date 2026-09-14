# Özellik pivotu sürümleme — `RollProperty` / `WorkOrderTargetProperty` (B-5): KARAR ve PLAN

> **Durum: UYGULANDI (Faz 0–2e, 2026-09-14; Faz 3/4 ayrı bilet).** Karar 2026-09-11'de verildi (`docs/kurallar/defter.md:48`, `:66-71`); ölçümler 2026-09-12'de tazelendi. İş bitince bu belge `docs/history/`e taşınır. Doktrin: `docs/kurallar/defter.md`. Emsal ve ortak zemin: `docs/design/DEFTER-B-BOLUMU-PLAN.md`.

> Bu dosya bir EMİR listesidir: uygulayan oturum burada yazan kararı tartışmaz, uygular. Karara itirazı varsa ÖNCE yöneticiye yazar, sonra kod yazar.

> ⚠️ **SATIR NUMARALARI OYNAKTIR.** Ölçüm anında (2026-09-12) çalışma ağacında 40'tan fazla commit'lenmemiş dosya vardı; `subcontractor.service.ts` · `workorder.service.ts` · `kartela.service.ts` · `schema.prisma` şu anda başka oturumlarca değiştiriliyor. Aşağıdaki numaralar **bugün ölçülmüştür**, yarın kaymış olabilir. Hedefi daima **sembol adıyla** bul (fonksiyon/sabit adı verildi), numarayı yalnız teyit için kullan.

## 0. Durum tazelemesi (2026-09-14, 82 — taban `3b65daea`)

Bu bölüm planı DEĞİŞTİRMEZ, ölçer: hangi satır indi, hangi satır numarası kaydı, ne bekliyor.

**İnen (planın kendi maddeleriyle):**
- **Y2 bitti** — `tambur.service.ts` finalize ebeveyn silmesi kalktı, damga konmadı (plan birebir); bekçi `test_stock_ledger_tambur_undo` §0b/§0c/§5b (K3(a), `3b65daea`).
- **Y10 / Y11 yarım** — `cancelReceipt` ve `undoTransfer` artık SİLMİYOR (bekçi `test_fason_receive_cancel_rereceive` · `test_fason_undo_transfer`), ama `revokeRollProperties(... FASON_KABUL_IPTAL / FASON_TRANSFER_GERI_AL)` damgası Faz 1 helper'ını bekliyor. Bugünkü hâl: satır aktif kalır (top zaten CANCELLED, okurlar canlı topa bakar). Faz 2e o iki satırı ekler.
- **Risk #9 kapandı** — `getCancelImpact` `rollWhere` `K18_DEAD_STATUSES` süzer (`585b1274`): TAMBUR_CONSUMED ebeveyn "işlenmiş" sayılmaz. Fabrika kopyası: 67/125 açık WO listede ölü satır taşıyordu, 3'ünün sayısı düşer.
- **Kapı** — `test_defter_ters_yol` §5/§10 artık `RollProperty`/`WorkOrderTargetProperty`yi `yazan`/`silen` ile tarıyor (`dbc2d930`); `silen` boşaldığı gün "ÖLÜ SİLME BEYANI" kırmızı verir ⇒ Faz 2c/2d'nin bitişi ölçülür. Beyan bu belgeyi `tasarim` olarak atfeder (§6c ölü atıf denetimi).

- **Faz 0 bitti (2026-09-14)** — `inventory.controller.ts:685/:725` `?? []` kalktı, servis imzası `propertyIds?: string[]`; `undefined` iken özellik bloğu, `propsChanged` ve audit `propertyIds` hiç koşmaz. Bekçi `test_roll_relabel` §11 (11a–11d; 11d controller çapası — servis sondası route katmanını göremez). İki negatif sonda: servis `propsTouched=true` → 3 ❌ · controller `?? []` geri → 11d ❌.

- **Faz 1 + 2a bitti (2026-09-14, tek commit):** migration `20260914030000_roll_property_target_property_revoke` (§6 birebir; damga §6'daki `20260912140000` bayattı) + şema + `property-revoke.helper.ts` (`ACTIVE_*`, `revokeRollProperties`, `revokeTargetProperties`, `setRollPropertyValueTx`) + `test_db_invariants` iki partial unique + 20+14 okur süzüldü (AST tarayıcısı sayarak: rollProperty ilişki 20 / çağrı 7, WOTP ilişki 14 / çağrı 1, ham SQL 0; iki bilinçli istisna O24/T15 işaretli) + `buildRollWhere` `satisfies Prisma.RollWhereInput` + `findRollById` include→select + yeni bekçi `test_roll_property_revoke` §1–§4 + §13 (silme siteleri Faz 2c/2d için ADIYLA beyanlı, ölü beklenti kırmızı).
  ⚠️ **"Faz 1 tek başına sahaya çıkabilir" iddiası ÇÜRÜDÜ:** Y1'in `upsert({ where: { rollId_propertyId } })`ü partial unique altında `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` ile ölür (ölçüldü, `test_property_value_selection` düştü) — Kurşun/KK2 özellik yazımı kırılır. Bu yüzden 2a Faz 1 ile AYNI commit'te. §8.6 "upsert tuzağı" bu.
  Bekçi yeniden yazımı: `test_property_value_selection` §2 "1 AKTİF + toplam 2, eski damgalı", tüm okumalar aktif süzgeçli, §13'e "ebeveynin damgalı değeri çocuğa GEÇMEDİ" sondası; temizlik `.catch` yutması kaldırıldı (1e/6e ölçtü).

- **2b · 2c · 2d · 2e bitti (2026-09-14, dört ayrı commit):** donör doğum-anı (§3.1, `propsDonorMissing`) · `applyRollFlagSetTx` fark bazlı + koşulsuz claim · replace/updateTargetProperties §3.2 üç parçalı kapı tx içinde, topa yalnız DELTA · cancelReceipt/undoTransfer damgası kardeş sebeple. `src/`de iki modele SİLME 0 (§13d beyan boşaldı). Audit etiketleri iki haritada (§7). **Beyan çevrildi:** PIVOT_TICARI → DEFTER {DAMGA revokedAt}, ters yazanlar helper'da; `defter.md` ③a satırı ve tablo tazelendi, "henüz uygulanmadı" kararı düştü. Bekçi `test_roll_property_revoke` §1–§4 · §8/§8b · §9 · §10 · §13 (37 kontrol). Faz 3 (O16–O19 tx'e taşıma) ve Faz 4 ayrı bilet — plan §9.

**Satır numaraları (2026-09-14):** Y1 `:211` (aynı) · Y3 `tambur-undo.service.ts:1730` · Y4 `:2079` · Y5 `inventory.service.ts:4531/:4535` · Y7 `workorder.service.ts:5812` (yanında `WorkOrderToOrderLine.deleteMany :5816` — ayrı borç, beyanda) · Y8 `:5983/:5985` · Y9 `:6009/:6020` · Y10 `subcontractor.service.ts:5436` (silme yok) · Y11 `:5983` (silme yok).

**Desen şerhi (1e'nin "tek kalıp" sorusu):** Bu planın `revokedAt`/`revokedById` seçimi evin deseni (`ACTIVE_OPERATION`/`ACTIVE_MOVEMENT`, `revoke-ast-tarama.ts`). K1 (`SackTagAssignment`) ve K2 (`SackAllocation`) `clearedAt` kullanıyor — K1'de kolon ZATEN vardı (sevk temizliği), K2 K1'in kardeşi. Üç tablo aynı MEKANİZMA (DAMGA + partial unique), iki kolon adı; yeni açılan her tablo `revokedAt` alır. Kolon adı beyanda `mekanizma.kolon` olarak taşınır, kapı adı değil türü ölçer.

---

---

## 1. Karar ve gerekçe

**KARAR: `revokedAt` / `revokedById` / `revokeReason` damgası + PARTIAL UNIQUE. `validFrom`/`validUntil` EKLENMEZ.**

Bu bir "damga mı, versiyonlama mı" sorusu değildir — damga + partial unique **zaten versiyonlamadır**: `createdAt` = `validFrom`, `revokedAt` = `validUntil`, partial unique (`WHERE "revokedAt" IS NULL`) eski satır dururken yeni aktif satırın yazılmasına izin verdiği için sürüm zinciri `ORDER BY createdAt` ile okunur. İki kolon daha eklemek aynı bilgiyi ikinci kez saklamaktır.

Gerekçe, ölçüt sırasına göre:

**① Sektör.** SAP'de bir nesnenin karakteristik değeri (`AUSP`) *durum* tablosudur; "ne zaman değişti"nin cevabı değişiklik belgesidir, zaman dilimi değil. Geçerlilik aralığı SAP'de fiyat koşulunda, ürün ağacında, mühendislik değişikliğinde vardır — **planın** zamana bağlı olduğu yerlerde. Topun gramajı plan değil, fiziksel nesnenin niteliğidir.

**② Bizim ölçeğimiz.** Canlı yedekte `roll_properties` 7.618 satır (**`valueId` dolu 0**), `work_order_target_properties` 394 satır. Bugün as-of okuyan **tek bir tüketici yok**. `validFrom`/`validUntil` seçilseydi 34 okuma yüzeyinin ve üç istemcinin bir zaman parametresi taşıması gerekirdi.

**③ Ev deseni.** `ACTIVE_OPERATION` (`src/services/helpers/roll-operation.helper.ts:23`) ve `ACTIVE_MOVEMENT` (`roll-movement.helper.ts:23`) birebir şablondur; `scripts/revoke-ast-tarama.ts` `revokedAt` adına **sabit bağlıdır** (istisna regex `:48`, SQL deseni `:243-244`). `validUntil` seçmek tarayıcıyı parametreleştirmeyi, üç bekçiyi ve iki helper'ı genelleştirmeyi getirirdi — sıfır kazançla.

### SEÇİM (CHOICE) değeri değişince

50GR → 25GR: **eski satır damgalanır + yeni satır INSERT edilir.** Yerinde `UPDATE valueId` yasaktır — `station-capability-transfer.helper.ts`'teki `update: r.valueId ? { valueId } : {}` "ne oldu"yu siler, sil-yaz'ın eşdeğeridir.

Dışlayıcılık korunur: `@@unique([rollId, propertyId])` partial'a döndüğü için bir topta aynı özellikten **en fazla bir AKTİF** değer olur. `valueId` FK'sı `onDelete: Restrict` (migration `20260810233446_roll_property_value:12`) damgalı satırın taşıdığı değeri korumaya devam eder. Aynı değerli ya da değersiz çağrı **no-op** kalır — helper'ın idempotent tekrar (çevrimdışı replay) sözü korunur.

### Tarihsel "o gün hangi özellikteydi" okuru bu turda YAZILMAZ

Ölçüldü: as-of okuyan tüketici yok. Donmuş gerçeği gerektiren üç yüzeyin kendi dondurma mekanizması var: fason çeki/refakat kartı → `PrintedDocument`; fason kabulünde fiilen uygulanan liste → `SubcontractorReceiptProperty`; kesim/finalize çocukları → doğuş anında kopya. Veri as-of'u **destekler** (`createdAt <= T AND (revokedAt IS NULL OR revokedAt > T)`), ama okur yazılmaz.

---

## 2. Mekanizma

- Satır **silinmez, damgalanır**. Damga silinmez, **un-revoke YOKTUR** (`defter.md`).
- Değişiklik = (varsa) eski aktif satırın damgalanması + yeni aktif satırın INSERT'i. **Sıra: önce revoke, sonra insert** — tersi aynı çift için partial unique P2002 verir.
- Her yazım **FARK bazlıdır**: değişmeyen satıra dokunulmaz. Gerekçe "sürüm enflasyonu" değil (hacim küçük), **yarış pinlemesidir**: revoke, okunan aktif satır **id'lerine** pinlenir; böylece araya giren ikinci yazarın satırı silinmez.
- Durum geçişi **ATOMİK CLAIM**: `updateMany WHERE {id, ...ACTIVE}` + `count===0 → 409`. `findUnique→if→update` yok.
- Okuyan **her** yol tek kaynak sabitten geçer (`ACTIVE_ROLL_PROPERTY` / `ACTIVE_TARGET_PROPERTY`). **B-4a'nın dersi budur: asıl risk okurlardır.**

---

## 3. YAZAR siteleri — site site yeni davranış

| # | Site (sembol) | Ölçülen yer | Yeni davranış |
|---|---|---|---|
| Y1 | `copyStationCapabilitiesToRoll` upsert | `src/services/helpers/station-capability-transfer.helper.ts:211` | **upsert KALKAR** → `setRollPropertyValueTx`. Aktif satırı bul: yoksa `createMany(skipDuplicates)`; varsa ve gelen `valueId` FARKLI ise atomik revoke + insert; aynı/boşsa **no-op**. Çağıranlar (`kursun-qc.service.ts` `completeQc2`, `kursun-bypass` üç yol, `inventory.service.ts` `kursunFinish`) semantiği helper'dan devralır, dokunulmaz. |
| Y2 | `finalize` parent silmesi | `src/services/tambur.service.ts:1251` | **Silme KALDIRILIR, damga da konmaz — DOKUNMA.** Emekli parent'ın özellikleri olgudur. Diğer üç emeklilik yolu (`cutWarehouseRoll` tükenişi, `finalizeWarehouseCut`, `finalizeOpenFabric`) bugün zaten dokunmuyor; `:1251` tek başına asimetrikti. Aynı commit'te bayat yorum (`:908-909` "FIRE WAREHOUSE'a iner"; FIRE bugün SCRAP'a iner) düzeltilir. |
| Y3 | `applySingleRestore` geri kurulumu | `src/services/tambur-undo.service.ts:1455` sayım · `:1457` donör · `:1462` yazım | Sayım **aktif** süzülür. Donör **doğum-anı satırlarıyla sınırlanır** (§3.1). Yazım yalnız INSERT kalır (`skipDuplicates`), un-revoke yok. |
| Y4 | `applyFull` geri kurulumu | `:1755` sayım · `:1758` donör · `:1765` `donor[0]` · `:1769` yazım | Y3 ile aynı + üç delik kapanır: (a) `orderBy` yok → deterministik seçim; (b) F0402'de tüm çocuklar iptal edilmişse `ids=[]` → donör kümesine iptal edilmiş çocuklar da alınır; (c) tüm çocuklar SCRAP ise donör boş → `restored===0` sessiz geçmez, audit'e ve yanıt uyarısına yazılır. |
| Y5 | `applyManualProperties` FLAG replace | `src/services/inventory.service.ts:4381` deleteMany · `:4385` createMany | `applyRollFlagSetTx` ile **fark bazlı**: çıkanlar id'lere pinli `updateMany` ile damgalanır (`count` uyuşmazsa 409), girenler `createMany({ skipDuplicates: true })`. **CHOICE satırlarına dokunulmaz** (`rota-renk.md:16` aynen korunur). `propertyIds === undefined` → **hiç koşmaz** (Faz 0). |
| Y6 | `applyManualProperties` claim | `:4336` `if (Object.keys(rollData).length > 0)` | Claim **KOŞULSUZ** olur ve tx'in ilk ifadesidir: `rollData` boşken de aynı pin (`{id, shipmentId: null, sackId: cur.sackId, status: roll.status}`) `data: { updatedAt: new Date() }` ile koşar, `count===0 → 409`. Bugün yalnız-özellik düzeltmesinde top satırı **hiç kilitlenmiyor**. |
| Y7 | `replace()` WOTP | `src/services/workorder.service.ts:5783` deleteMany · `:5817` nested create | Diff: `replaceClaim` (WO satır kilidi) SONRASI tx içinde taze aktif küme okunur; çıkanlar `revokeReason: "WO_REPLACE"` ile damgalanır, girenler `createMany`. `undefined` semantiği DEĞİŞMEZ (STOCK → boş; ORDER → sipariş satırından türer, `rota-renk.md:19`). Kapı düzeltmesi §3.2. |
| Y8 | `updateTargetProperties` WOTP | `:5954` deleteMany · `:5956` createMany | Diff (Y7 ile aynı gövde) + `touchWorkOrderTx` tx'in **İLK ifadesi** olur (bugün WO kilidi ve terminal statü claim'i YOK; kilitler yalnız tx dışında `:5892`'de hesaplanıyor). Kilit/kapsama kontrolleri tx içinde tazelenir (F58 deseni). |
| Y9 | `updateTargetProperties` RollProperty | `:5980` deleteMany · `:5991` createMany | Revoke kümesi **`(eski hedef − yeni hedef)`**, bağlı topların tüm FLAG evreni DEĞİL. Gerekçe: aynı fonksiyon CHOICE satırlarına tam bu sebeple dokunmuyor ("SEÇİM satırlarını İSTASYON OPERATÖRÜ yazar, hedef listesi değil", `:5971-5975`). ⚠️ Sınırı §8.4'te yazılı: kaynak (provenance) kolonu olmadığı için hem hedef hem istasyon-AUTO olan özellik (KURSUN) yine damgalanır. Önizleme `getTargetPropertyChangeImpact` **aynı** kümeyi sayar (tek helper, iki çağıran). |
| Y10 | `cancelReceipt` | `src/services/subcontractor.service.ts:5202` | `revokeRollProperties(tx, { rollIds: bornRollIds, reason: "FASON_KABUL_IPTAL", userId })` — hemen üstteki kardeş `revokeRollMovements` (`:5195`) ile **aynı sebep kodu**. |
| Y11 | `undoTransfer` | `:5740` | `reason: "FASON_TRANSFER_GERI_AL"` — kardeşler `:5727` / `:5734`. |

### 3.1 Donör kısıtı — uydurmayı kesen kural (KRİTİK bulgu, §9.1)

Geri kurulum guard'ı `parentPropCount === 0`'dır; "finalize sildi mi"yi sormaz. `:1251` silmeyi bıraktıktan sonra bu koşul iki sınıfta doğru kalır: (a) legacy (migration öncesi hard-delete), (b) **özelliği hiç olmayan parent** — fabrikada olağan. (b)'de bugünkü donör bloğu çocuğun depoda **sonradan** kazandığı özelliği parent'a **uydurur** (senaryo: özelliksiz parent → finalize → çocuk WAREHOUSE'ta ZIMPARALI kazanır → FULL undo → parent'ın hiç taşımadığı ZIMPARALI parent'a AKTİF yazılır). Bu bugün de yaşanıyor, bekçisi yok.

**Kural: donör = çocuğun DOĞUM tx'inde yazılmış satırlar** → `rollProperty.createdAt <= roll.createdAt` (çocuğun kendi `createdAt`i). Postgres'te `now()` **transaction başlangıç** zamanıdır; miras kopyası çocukla aynı tx'te yazıldığı için damgalar eşittir, depoda sonradan eklenen satır kesinlikle daha büyüktür. Sonuç: legacy parent'ın gerçek kümesi geri gelir, özelliksiz parent'a hiçbir şey uydurulmaz. Kapı veri-güdümlüdür; kurulum başına değişen bir tarih sabiti gerektirmez.

### 3.2 `replace` / `updateTargetProperties` kapıları — kalıcı 409 üretmeden

Bugün kilit+kapsama kontrolleri `if (data.targetPropertyIds)` ile korunuyor: istemci alanı göndermezse kontroller atlanıyor **ama satırlar yine siliniyor** (sessiz silme yolu). Kapıyı düz biçimde "çözülmüş listeye" uygulamak yeni bir kilitlenme üretir (türetilen listede olmayan KİLİTLİ özellik → kalıcı 409, iş emri hiç kaydedilemez). Üç parçalı çözüm:

1. **Kilitli mevcut hedefler çözülmüş listeye daima BİRLEŞTİRİLİR** (`lockedPropertyIds` ∪ resolved). Böylece kilit kapısı türetilmiş listede asla ateşlenemez ve sessiz silme de biter.
2. **Kapsama (applicable) kapısı yalnız DELTA'ya uygulanır**: `resolved − aktif mevcut`. Özellik-başına kapsamanın sertliği korunur (create 400 / replace 409 — `rota-renk.md:104`), ama zaten yazılı olan bir satır için 409 üretilemez.
3. `existing` **tx içinde taze** okunur (bugün `:5169`'daki tx-dışı küme `:5575`'te de kullanılıyor — bayat).

---

## 4. OKUR siteleri — süzgeç tablosu

Biçimler (emsal `inventory.service.ts:456` `operations: { where: ACTIVE_OPERATION }`):

| Yüzey | Yazım |
|---|---|
| include/select | `properties: { where: ACTIVE_ROLL_PROPERTY, select: {…} }` |
| ilişki filtresi | `some: { ...ACTIVE_ROLL_PROPERTY, propertyId: pid }` · `some: {}` → `some: ACTIVE_ROLL_PROPERTY` |
| sayım | `_count: { select: { properties: { where: ACTIVE_ROLL_PROPERTY } } }` (desteklendiği ölçüldü: `workorder-locks.helper.ts:118-122` aynı biçimi `dispatches` için kullanıyor) |
| doğrudan | `where: { ...ACTIVE_ROLL_PROPERTY, rollId }` |
| `every` | **YASAK** → `none: { ...ACTIVE, NOT: X }` |

### 4.1 `RollProperty` okurları (20 ilişki + 8 çağrı)

| # | Site | Karar | Süzülmezse |
|---|---|---|---|
| O1 | `inventory.service.ts:471` `ROLL_LIST_INCLUDE.properties` | süz | En geniş okur; çift çip, `key={p.propertyId}` çakışır |
| O2 | `:579` `ROLL_CARD_INCLUDE.properties = ROLL_LIST_INCLUDE.properties` | **DOKUNMA — referans** | Buraya ikinci `where` kopyası yazmak kart↔liste ayrışması (ayrışan yüzey) |
| O3 | `:1666` `buildRollWhere` `some` | süz **+ `where`i `Prisma.RollWhereInput` olarak tiple** (§5.2) | Tek where; liste (`:1756`) + `getRollStats` + `getRollStatsBatch` **birlikte** yanlış olur, hata çıkmaz |
| O4 | `:2474` `findRollById` | süz **+ `include` → `select`** (Faz 1) | `include` tüm skalerleri döker → damga kolonları API'ye sızar; ayrıca bugün `value` yok, detay listeden ayrışıyor ("Gramaj: 50 gr" → "Gramaj") |
| O5 | `:2735` `getRelabelContext` | süz (ŞART) | **Echo ile diriltme**: `:2822` `propertyIds` istemciye gider, panel aynen geri yollar |
| O6 | `:4093` `applyManualProperties` tx-öncesi | süz + fark hesabı tx içinde | Sahte `propsChanged` ya da gerçek değişikliği kaçırma (etiket bayat işaretlenmez) |
| O7 | `workorder.service.ts:1295` `quickStart` eldeki mal | süz | **KAPSAMA KRİTİK**: damgalı özellik "mal zaten ZIMPARALI" sayılır → rota uyarısı sessizce bastırılır |
| O8 | `:5487` `replace` bağlı toplar | süz | O7 ile aynı |
| O9 | `:2898` `_count.properties` | filtreli `_count` | Sayı sürüm başına şişer; ham top "işlenmiş" görünür |
| O10 | `:2992` `some: {}` | `some: ACTIVE_ROLL_PROPERTY` | O9 ile **boğaz-ikiz**, AYNI commit |
| O11 | `:3894` `_count.properties` | filtreli `_count` | Kapanış dispozisyonunda yanlış "işlenmiş" rozeti |
| O12 | `workorder-link.service.ts:788` | süz | **Toplu diriltme**: `:826` tam listeyi `applyManualProperties`e echo ediyor |
| O13 | `tambur.service.ts:373` `loadTamburRolls` | süz | **Final karar noktası**: operatör iki gramaj görür |
| O14 | `:1064` finalize kaynağı | süz | **B-4a ikizi**: çocuğa aynı `propertyId` için iki INSERT → `:1134` `skipDuplicates` taşımıyor → P2002 → finalize geri sarılır, **top Tambur'da takılır** |
| O15 | `:1643` `listSwatches` (tipsiz `as const` include) | süz | Tarayıcı modeli kardeşlerden çözüyor (ölçüldü: çözüyor, §9.5) |
| O16-19 | `:2094` · `:2525` · `:2869` · `:3279` (kesim/finalize snapshot'ları) | süz (**tx'e taşıma Faz 3**) | Pre-tx TOCTOU: bayat küme damgalı değeri çocukta AKTİF diriltir |
| O20 | `tambur-undo.service.ts:1455` · `:1457` · `:1755` · `:1758` | süz (§3.1) | **EN KRİTİK**: parent özelliksiz dirilir, hata da log da çıkmaz |
| O21 | `kartela.service.ts:1188` | süz | Gösterim (dosya oynak, sembol: `outstandingRolls`) |
| O22 | `demo.service.ts:66` `SENARYO_SELECT` | süz | Echo ile diriltme (demo kurulumu) |
| O23 | `subcontractor.service.ts` `createFasonShipChild` (~`:531`) | süz | Kısmi sevk çocuğu damgalı değeri devralır; hemen altındaki `rollOperation` okuması zaten `ACTIVE_OPERATION` taşıyor (ikizi) |
| O24 | `fabric-property.service.ts:319` `count({ propertyId, valueId: { not: null } })` | **SÜZÜLMEZ — bilinçli istisna** (`` `revokedAt` SÜZÜLMEZ `` işaretiyle) | Tarihsel satır da sayılmalı: geçmişte değer taşımış özelliği BAYRAK'a çevirmek "değerli bayrak" limbosu üretir. (Mesajdaki "N topta" sayısı ayrıca `distinct rollId` olmalı — bugün de şişiyor.) |

### 4.2 `WorkOrderTargetProperty` okurları (14 ilişki + 1 çağrı)

| # | Site | Karar | Süzülmezse |
|---|---|---|---|
| T1 | `workorder.service.ts:1978` `findById` | süz (ŞART) | **Diriltme**: `Electron/…/workOrderPrefill.ts:40` → PUT replace echo |
| T2 | `:5169` `replace` existing | süz **+ tx içinde taze oku** | Damgalı hedef "mevcut" sayılır → kalıcı 409 ya da kapsama bypass'ı |
| T3 | `:5892` `updateTargetProperties` | süz + tx içinde | T2 ile aynı |
| T4 | `helpers/workorder-locks.helper.ts:100` | süz | Damgalı hedef "kilitli" sayılır → panel chip'i yanlış kilitler, İE kaydedilemez |
| T5 | `helpers/workorder-clone.helper.ts:105` | süz | `:152` nested create aynı `propertyId`yi iki kez yazar → **P2002 → devir/parti ayırma tx'i düşer** |
| T6 | `subcontractor.service.ts:2538` `receiveInner` | süz **+ `touchWorkOrderTx` altında taze oku** | Damgalı hedef fason dönüşünde doğan **HER** topa aktif `RollProperty` olarak yazılır; renk emsali (`expectedTargetColorId`) zaten tx içinde taze çözülüyor, özellik çözülmüyor |
| T7-9 | `:4007` · `:4153` · `:4248` (pending returns / detay) | süz (tek sabitten) | Tablet `FasonKabulScreen` bu listeden `appliedPropertyIds` kuruyor → doğrudan diriltme |
| T10 | `:1830` `previewDownstreamFasonCeki` | süz | Taslak çekide damgalı "YAPILACAK İŞLEMLER" |
| T11 | `:6849` `buildFasonDispatchDoc` | süz | Boyahaneye giden **donmuş** belgeye damgalı işlem yazılır |
| T12 | `:4485` `getDispatch` | süz | Gösterim |
| T13 | `:4699` `getReceipt` | süz (asıl kusur ayrı: Faz 4) | Bugün de geçmiş makbuzda CANLI planı basıyor; doğru kaynak `receipt.appliedProperties` |
| T14 | `traveler-card.service.ts:1166` | süz, `orderBy propertyId` korunur | Kartta çift ad + `planKey` yanlış "içerik değişti" → kart boşuna sürüm atlar |
| T15 | `fabric-property.service.ts:347` `count({ propertyId })` | **SÜZÜLMEZ — bilinçli istisna** | FLAG→CHOICE tip dönüşümü kilidi tarihsel kullanımı da saymalı (O24 ile aynı sınıf; §8.6) |

### 4.3 İstemci okurları — **zorunlu değişiklik YOK**

Tüm süzme sunucuda. Panel/tablet sözleşmesi (`properties`, `propertyIds`, `targetProperties`, `lockedPropertyIds`, `propertyCount`) anlamca "YALNIZ AKTİF" kalır. Süzme eksik kalırsa mükerrer çip + React key çakışması görülecek yüzeyler: `Rolls/columns.tsx:138` · `RollDetailSheet.tsx:350` · `SwatchDetailSheet.tsx:125` · `TamburScreen.tsx:4018` · `DepoScreen.tsx:1035` · `KunyeCard.tsx:44` · `FasonKabulScreen.tsx:1615` · `KartelaKabulScreen.tsx:513` ve `:839` (`:308` Map ile tekilleştiriyor, bu ikisi etmiyor).

Ölü istemci yüzeyleri — **dokunulmaz** (kıracak istemci yok, sözleşme tetiği açmaya değmez): `Electron/…/WorkOrders/service.ts:127`, `Electron/…/Rolls/manualAdjustService.ts:31`, `mobil/src/services/workOrder.service.ts:258`. Backend PATCH `/work-orders/:id/target-properties` **canlı ve yıkıcı** olduğu için Y8/Y9 kilitleri yine de takılır.

---

## 5. Tek kaynak helper + AST bekçisi

### 5.1 `src/services/helpers/property-revoke.helper.ts` (TEK dosya, iki model)

İki ayrı dosya değil: AST tarayıcısına tek muafiyet yolu verilir, iki sabit yan yana durur (biri süzülüp diğeri unutulamaz) ve iki `revoke*` gövdesi neredeyse aynıdır.

```ts
export const ACTIVE_ROLL_PROPERTY   = { revokedAt: null } as const;
export const ACTIVE_TARGET_PROPERTY = { revokedAt: null } as const;

revokeRollProperties(tx, { rollIds, ids?, propertyIds?, valueType?, reason, userId }): Promise<number>
revokeTargetProperties(tx, { workOrderId, propertyIds?, reason, userId }): Promise<number>
setRollPropertyValueTx(tx, { rollId, propertyId, valueId, reason, userId }): Promise<"noop"|"created"|"versioned">
applyRollFlagSetTx(tx, { rollId, desired, reason, userId }): Promise<{ revoked: number; added: number }>
```

- İmza ve dönüş anlamı `revokeRollOperations` emsalini izler (dönen sayı = damgalanan satır; eski `deleteMany().count` ile aynı anlam, çağıranların sayaç mantığı bozulmaz).
- `setRollPropertyValueTx` yaratma dalı **`createMany({ skipDuplicates: true })`** ile yazılır (hedefsiz `ON CONFLICT DO NOTHING` partial unique'i kapsar; emsal üretimde çalışıyor: `inventory.service.ts:5411` `rollOperation.createMany`). Düz `create` bu dalı `findFirst→if→create` şekline sokar ve iki eşzamanlı istasyon yazımında P2002 üretir.
- `data`ya **yalnız model alanları** yazılır (`rollId`, `propertyId`, `valueId`) — `reason`/`userId` kolon değildir.
- Tüm çağrılar sıralı; `tx.*` + `Promise.all` yasak. P2002 → 409 "tekrar deneyin" eşlenir.
- `applyRollFlagSetTx` iki diff yazarını (Y5 ve Y9) tek gövdeye bağlar.

### 5.2 AST bekçisi — ve tarayıcının tek gerçek kör noktası

`scripts/revoke-ast-tarama.ts` `aktifYuklemTara(kok, [tanım1, tanım2])` **iki tanımı tek çağrıda** alır (dizi alıp `Map` döndürüyor). `revokedAt` adına bağlı olduğu için tarayıcı **değiştirilmeden** kullanılır.

⚠️ **`buildRollWhere` ölçülemiyor.** `inventory.service.ts:1292` imzası `Record<string, unknown>` döndürür; `:1666`'daki `properties: { some: { propertyId: pid } }` literali `where.AND` dizisine `as Record<string, unknown>[]` cast'iyle giriyor, yani **Prisma bağlamsal tipi yok**. Tarayıcının karar satırı (`const kardes = prismaTipli ? null : ad ? "degil" : kardestenCoz(...)`) bu durumda ikiye ayrılır: bağlamsal tip Prisma-dışı bir adla çözülürse site **sessizce atlanır** (ne sayılır ne ihlal olur), hiç çözülmezse tek anahtarlı nesnede kardeş bulunamadığı için **"(model çözülemedi)" kırmızısı** verir. İkisi de kötü ve hangisinin geleceği ölçülmeden bilinmez.

**Düzeltme (Faz 1 bütçesinde, kod değişikliği):** `buildRollWhere`in yerel `where`ini `Prisma.RollWhereInput` olarak tiple (ya da map literaline `satisfies Prisma.RollWhereInput` koy) — `getRollStats` zaten bu tipi varsayıp cast ediyor. Tariflenen iki dalın ikisini de kapatır. İstisna işareti koymak **YASAK**: bu site tam tersine süzülmek zorunda.

---

## 6. Migration

**Tek dosya**, ad: `20260912140000_roll_property_target_property_revoke`.

⚠️ Tasarımın ilk taslağındaki `20260912110000` **geçersizdir**: dizinin en yenisi bugün `20260912130100_merge_ref_rowids_no_default` (paralel oturumun üç commit'lenmemiş migration'ı: `…120000`, `…130000`, `…130100`). Damga onlardan BÜYÜK olmalı. Ölçüldü: üçünün hiçbiri bu iki tabloya dokunmuyor.

```sql
-- ③a TİCARİ PİVOT: topun ve iş emrinin özelliği sil-yazdan sürümlemeye geçti.
-- ⚠️ Prisma'nın @@unique'i CONSTRAINT değil INDEX üretir → DROP INDEX.
--    DROP CONSTRAINT IF EXISTS SESSİZCE no-op olur (B-4a: 20260911170000 boşa
--    gitti, 20260911180000 onardı). Kanıt: init:1318/1324 ve
--    20260611084953_native_uuid_pk_fk:1573/1798 ikisini de CREATE UNIQUE INDEX yazar.
-- ⚠️ Tam unique, rollId/workOrderId üzerindeki TEK sol-önek index'ti → (x, revokedAt) eklenir.
-- GÜVENLİ: altı nullable kolon + iki kısıt takası. BACKFILL YOK, veri dönüşümü YOK.

SET lock_timeout = '3s';

ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS "roll_properties_active_pair_uq"
  ON "roll_properties" ("rollId", "propertyId") WHERE "revokedAt" IS NULL;
DROP INDEX IF EXISTS "roll_properties_rollId_propertyId_key";
CREATE INDEX IF NOT EXISTS "roll_properties_rollId_revokedAt_idx"
  ON "roll_properties" ("rollId", "revokedAt");

ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_target_properties_active_pair_uq"
  ON "work_order_target_properties" ("workOrderId", "propertyId") WHERE "revokedAt" IS NULL;
DROP INDEX IF EXISTS "work_order_target_properties_workOrderId_propertyId_key";
CREATE INDEX IF NOT EXISTS "work_order_target_properties_workOrderId_revokedAt_idx"
  ON "work_order_target_properties" ("workOrderId", "revokedAt");
```

**"Atomik" DEĞİL, "yeniden koşulabilir".** `scripts/apply-migration.ts:141-146` psql'i `-v ON_ERROR_STOP=1 -f` ile çağırır, **`--single-transaction` YOKTUR** → her ifade autocommit'tir. CREATE-önce/DROP-sonra sırası ve `IF [NOT] EXISTS` sayesinde yarıda kalan koşum bugünkü davranışı bırakır ve tekrar koşulabilir. `SET lock_timeout` şart: `DROP INDEX` ACCESS EXCLUSIVE ister; apply-migration hiçbir süreci durdurmaz (kur.ps1 yolu pm2'yi durdurur, bu yol durdurmaz) ve kuyrukta bekleyen DROP tabloyu okuyan herkesi bloklar.

### Şema (`prisma/schema.prisma`)

- `RollProperty` (bugün `:5791-5827`) ve `WorkOrderTargetProperty` (`:5772-5785`): üç kolon + `@@unique([...], map: "<partial_ad>")` + `@@index([rollId, revokedAt])` / `@@index([workOrderId, revokedAt])`.
- `revokedById` **düz UUID kolonu, ilişki DEĞİL** (`RollOperation`/`RollMovement` emsali). Kritik: `test_kanban_card_projection.ts:78` "users tablosuna 0 sorgu" ölçüyor; `revokedBy User` ilişkisi projeksiyona girerse o bekçi kırmızı verir.
- Yeni `DateTime` kolonları `@db.Timestamptz` (`test_timestamptz_contract`).
- Aynı commit'te düzeltilecek bayat yorumlar (ölçüldü, hâlâ duruyor): `:5802-5804` "`@@unique` KORUNUYOR ve bu dışlayıcılığın kendisidir" → "AKTİF satırlar için"; `:5819-5820` "`valueId` upsert ile tazelenir" → "değer değişimi yeni sürüm satırıdır"; `WorkOrderTargetProperty` başlığı (`:5769-5771`) **"Tambur'da finalize sırasında bu liste otomatik olarak üretilen Roll'lara RollProperty olarak yazılır"** — yanlış, yazan fason kabuldür (`subcontractor.service.ts` `receiveInner`), Tambur yalnız parent'tan miras alır. (`RollProperty`nin kendi başlığı `:5787-5790` doğrudur, ona dokunma.)
- `ON DELETE CASCADE` FK'ları **korunur** (`20260611084953:2230/2236`): 169 script topu, 136'sı iş emrini pivot temizlemeden siliyor; `clean_test_residue.ts:171` de Cascade'e dayanıyor.

### `scripts/test_db_invariants.ts`

`PARTIAL_INDEXES`e (dizi `:100`'de başlıyor) iki satır: `uniq: true`, predicate `("revokedAt" IS NULL)`. `checkNoExtras` iki yönlü → unutulursa **kesin kırmızı**. ⚠️ `:95`'teki "(38)" başlık sayacı **bugün zaten bayat** (dizide 77 girdi var): "(38)→(40)" yazma; sayıyı gerçek uzunluğa hizala ya da tümden kaldır.

### Canlıdaki satırlar

Hepsi aktif doğar. **Backfill yok.** `npx tsx scripts/apply-migration.ts <ad>` önce dry-run, sonra `--apply`. Şema provası en eski canlı dump'ta (restore → `migrate deploy` → bekçiler → profil boot).

---

## 7. API sözleşmesi ve eski istemci

**Sözleşme kırılmıyor**: uç kaldırılmıyor, alan adı/tipi değişmiyor, zorunlu parametre eklenmiyor, enum genişlemiyor, izin değişmiyor. `minVersion` **dokunulmaz** (`src/config/client-version-policy.ts:90/111/147` = `1.0.0`). Geçmiş bir gün istenirse **yeni alan ya da yeni uç** ile additive gelir; mevcut dizilere asla karışmaz.

Üç davranış değişikliği:

1. **`propertyIds: undefined` artık silmiyor** (`inventory.controller.ts:685`, `:725` `?? []` kalkar; Zod `:70`/`:137` zaten `optional()`, `:134` yorumu niyeti söylüyor: *"propertyIds verilirse TAM liste (replace)"*). Mobil `CuvalDuzeltScreen` bugünkü sessiz kayıptan **kurtulur**; Electron her zaman dizi yolladığı için davranışı **değişmez**. Kırılma değil, kusurun düzeltilmesi.
2. **`findRollById` `include` → `select`** (Faz 1): damga kolonlarının sızmasını engeller ve `value` alanını ekleyerek detay↔liste ayrışmasını kapatır. Eklemeli.
3. **`updateTargetProperties`in RollProperty revoke kümesi daralır** — ucun panelde/tablette çağıranı yok, istemci etkisi sıfır.

**Audit:** yeni anahtarlar (`revokedPropertyIds`, `addedPropertyIds`, `revokeReason`) **iki** etiket haritasına aynı commit'te — `Teks-Erp/src/constants/audit-field-labels.ts` ve `Electron/src/lib/audit-field-labels.ts` (bekçi `test_audit_labels.ts`; fail-open).

---

## 8. Bekçi planı + negatif sondalar

### Yeni bekçi `scripts/test_roll_property_revoke.ts` (emsal `test_roll_movement_revoke.ts`)

| § | Ölçülen | Negatif sonda |
|---|---|---|
| §1 | Geri alma SİLMEZ; üç damga dolu, `createdAt`/`valueId` değişmez | `revokedAt`ı elle null'la → kırmızı |
| §2 ⭐ | **PARTIAL UNIQUE**: damgalı satır dururken aynı çift YENİDEN yazılabilir | Migration'ı DROP INDEX'siz koş (B-4a vakası) → kırmızı |
| §3 ⭐ | İKİ AKTİF satır yazılamaz — sed görevde | Partial index'i düşür → kırmızı |
| §4 | Aktif okuma damgalıyı görmez | — |
| §5 ⭐ | **DEĞER DÜZELTMESİ** (50GR→25GR): 1 aktif + 1 damgalı; aynı değerle ikinci çağrı **no-op** | Yazarı yerinde `update: { valueId }`'ye döndür → kırmızı (bugün `test_property_value_selection.ts:154` bunu YEŞİL geçiriyor) |
| §6 ⭐ | **UPSERT TUZAĞI**: çıplak `upsert({ where: { rollId_propertyId } })` damgalıyı bulur / P2002 verir | — (tuzağı belgeler) |
| §7 ⭐ | **ECHO DİRİLTME YOK**: `getRelabelContext` damgalı id döndürmez | `:2735`ten `where`i çıkar → kırmızı |
| §8 ⭐ | **UNDO**: finalize sonrası parent'ın özellikleri DURUYOR; SINGLE_RESTORE ve FULL sonrası parent aktif özelliğini taşıyor; tüm kesimleri FIRE olan finalize + FULL'de de taşıyor | `:1455`/`:1755` sayımından aktif yüklemi çıkar → kırmızı |
| §8b ⭐ | **UYDURMA YOK** (§3.1): özelliksiz parent → çocuk depoda ZIMPARALI kazanır → FULL undo → parent **özelliksiz** dirilir | Donör `createdAt` kısıtını kaldır → kırmızı |
| §9 | `applyManualProperties` **fark bazlı**: değişmeyen bayrak aynı satır id'sinde kalır; `propertyIds` gönderilmezse hiçbir şey değişmez | `?? []`ı geri koy → kırmızı |
| §10 | `updateTargetProperties` yalnız `(eski−yeni)` FLAG'i damgalar; hedefte OLMAYAN istasyon AUTO'su (KURSUN) **DURUR**; **ve** hem hedef hem AUTO olan özellik damgalanır (bilinen sınır, §8.4) | Tüm FLAG evrenini damgala → kırmızı |
| §11 | `cancelReceipt`/`undoTransfer` sonrası satırlar duruyor ve damgalı, sebep kodu kardeşlerle aynı | — |
| §12 | `cloneWorkOrderTx` damgalı hedefi klonlamaz (P2002 yok, dirilme yok) | `:105`ten `where`i çıkar → kırmızı |
| §13 ⭐ | **AST + tip denetleyicisi** | Bir okurdan `where`i çıkar → kırmızı |

### §13 zeminleri — emsalden KOPYALANMAZ (bugün ölçüldü)

```
rollProperty:            silme 0 · cagri >= 8  · iliski >= 18 · sql === 0
workOrderTargetProperty: silme 0 · cagri >= 1  · iliski >= 12 · sql === 0
```

`test_roll_movement_revoke.ts:269-283` zeminleri (`>=40` / `>=15` / `>=15`) kopyalanırsa **sahte kırmızı** verir. SQL zemini `>= N` değil `=== 0`: `src/`de bu iki tabloya ham SQL **yoktur** (158 ham SQL çağrısının hiçbiri dokunmuyor; dinamik tablo adlı dört yol da kontrol edildi).

`BEKLENEN_ISTISNA_DOSYALARI`: `src/services/fabric-property.service.ts`. ⚠️ Küme **dosya granülerdir** (`istisnalar.map(y => y.split(":")[0])`), yani O24 ve T15'ten biri işaretini kaybederse kapı yeşil kalır → §8.6'daki **iki ayrı** negatif sonda bunu telafi eder.

### Yeniden yazılacak mevcut bekçiler (yazar değişmeden ÖNCE)

| Dosya:satır | Bugünkü iddia | Yeni iddia |
|---|---|---|
| `test_property_value_selection.ts:154-160` | `rows1.length === 1` ("ikinci satır açmaz") | **1 AKTİF** + **toplam 2**; başlık invariantı (`:12-13`) "ikinci **AKTİF** satır açmaz" |
| `…:141 / 163 / 178` | `orderBy`sız `findFirst` | aktif süz (yoksa flaky) |
| `…:250 / 264 / 312 / 335` | süzgeçsiz `findMany`; `:268` "BAYRAK'ı sildi" | aktif süz; "damgalı satır DURUYOR" ayrı kontrol; `:335`e "parent'ın damgalı değeri çocuğa GEÇMEDİ" sondası |
| `test_roll_relabel.ts:85 / 94-95 / 161-176` | `properties: true`, `length === 0`, no-op echo | aktif `where`; "0 aktif + damgalı duruyor"; echo sonrası `labelDirty === false` korunur |
| `test_workorder_order_link.ts:453-456` | `count === 1` | aktif = 1 **ve toplam = 1** (fark bazlı yazarın ikinci ölçümü) |
| `test_station_property_mode.ts:110 / 128` | süzgeçsiz | aktif süz + değer düzeltme vakası |
| `test_db_invariants.ts:100+` | — | iki partial unique satırı (+ başlık sayacı, §6) |

**"Vakumen yeşil" — negatif sonda eklenir:** `test_roll_relabel_context.ts:141` · `test_fason_receipt_color_width.ts:345` · `test_property_targetable.ts:224` (§8.6). **Düşük risk, eşdeğerlik için süzgeç:** `test_kursun_bypass.ts:862/1093` · `test_kursun_unassigned_close.ts:381` · `test_masterdata_guards.ts:107`. **Dokunulmaz:** ~96 teardown `deleteMany` (src dışı; tarayıcı yalnız `src/`ye bakar) · nested create fixture'ları (yeni kolonlar nullable) · `test_helpers.ts:443` mock (`where`i yok sayar → süzmeyi ASLA kanıtlayamaz, gerçek DB bekçisi şart) · `test_property_targetable.ts:75` GATES (replace mantığı helper'a taşınırsa aynı commit'te güncellenir).

**Bugün hiçbir bekçinin ölçmediği yüzeyler** (yeni bekçi kapatır): finalize parent silmesi ve undo geri kurulumu (`test_tambur_undo.ts`'te "propert" kelimesi geçmiyor) · `cancelReceipt`/`undoTransfer` özellik silmesi · WO replace WOTP silmesi · fason kabul mirası. `Teks-Erp/docs/BEKCI-HARITASI.md`'ye satır eklenir.

---

## 9. Fazlar

Her faz **ayrı commit**. `git add -A` YASAK, dosya adıyla stage'le (ortak çalışma ağacında 40+ commit'lenmemiş dosya var).

| Faz | Kapsam | Neden burada | Bağımlılık |
|---|---|---|---|
| **0** | `inventory.controller.ts:685` ve `:725` `?? []` kalkar; servis imzası `propertyIds?: string[]`; `undefined` iken özellik bloğu **ve** `propsChanged`/`labelDirty` hesabı hiç koşmaz. Bekçi: "gönderilmeyince BAYRAK durur" | **En küçük güvenli ilk dilim.** Ölçülmüş kod yolunu (tabletten her renk/en düzeltmesi tüm FLAG'leri siliyor) versiyonlamadan ÖNCE durdurur, migration'a dokunmaz | — |
| **1** | Migration + şema + `property-revoke.helper.ts` + `test_db_invariants` envanteri + **tüm okurların süzülmesi** (§4, iki bilinçli istisna hariç) + `buildRollWhere` tiplemesi + `findRollById` `include`→`select` + yeni bekçinin §1-§4 ve §13'ü | **Provably no-op**: hiçbir yazar henüz damgalamıyor, her satır aktif → aktif süzgeç bugünkü kümeyi aynen döndürür. Okurlar-önce sırası B-4a'nın dersidir | 0'dan bağımsız |
| **2a** | Y1: upsert → `setRollPropertyValueTx`. Bekçi §5 + §6 | İlk damgalı satırı **bu** üretir; en dar yüzey, tek çağrı sitesi | 1 |
| **2b** | Y2 + Y3 + Y4 (silme kalkar, aktif süzme, donör `createdAt` kısıtı, determinizm, üç delik, bayat yorum). Bekçi §8 + §8b | `defter.md`: yazar ve sayan okur **AYNI commit**. Ayrı commit'te parent özelliksiz dirilir | 1 |
| **2c** | Y5 + Y6 (`applyRollFlagSetTx`, koşulsuz claim, `skipDuplicates`). Bekçi §9 | Faz 0 `undefined` yolunu kapattı; burada yalnız dizi gelen yol diff'e döner | 0 + 1 |
| **2d** | Y7 + Y8 + Y9 + önizleme helper'ı + §3.2 kapı düzeltmesi. Bekçi §10 | En çok yarış içeren yüzey; kilit ve diff birlikte anlamlı | 1 |
| **2e** | Y10 + Y11. Bekçi §11 | İki satırlık değişiklik, blok içi tutarlılık. ⚠️ `subcontractor.service.ts` şu anda başka oturumda — **o oturum commit'leyene kadar başlama** | 1 |
| **3** | O16-O19: dört pre-tx snapshot tx içine, claim sonrasına | **B-5'e ait DEĞİL, ayrı bilet.** Saf TOCTOU sertleştirmesi; sürümleme yarışın sonucunu ağırlaştırır ama mekanizmadan bağımsızdır | 1 (2'den bağımsız) |
| **4** | Versiyonlamadan bağımsızlar: `SubcontractorReceiptProperty` silmelerini kaldır (iptal edilmiş makbuz belgesi boş basıyor) · `getReceipt` → `receipt.appliedProperties` · fason `expectedTargetPropertyIds` fail-open guard | Ayrı kararlar, ayrı bekçiler; bu dilimi büyütmemek için sona | bağımsız |

**Faz 1 tek başına sahaya çıkabilir** — davranış bit-bazında aynıdır, istemci değişikliği yoktur.

**Bitiş tanımı:** migration `apply-migration.ts` ile (dry-run önce) · partial unique `test_db_invariants` envanterinde · bekçi + **negatif sonda** (korunan davranışı bilerek boz, kırmızı gördüğünü raporla, geri al) · `npm test` yeşil (~6,5 dk) · `/karar-notu` ile arşiv + `docs/kurallar/defter.md`e kural satırı, `rota-renk.md:16`ya "değer değişimi yeni sürüm satırıdır" eklemesi, `defter.md:71`deki "henüz UYGULANMADI" maddesi **silinir**.

---

## 10. Reddedilen çürütmeler (ve kabul edilenler)

**Kabul edildi ve tasarıma işlendi:** donör uydurması (§3.1) · koşulsuz claim (Y6) · `setRollPropertyValueTx` yaratma dalının atomikliği ve derlenmeyen örnek gövde (§5.1) · replace kapısının kalıcı 409'u (§3.2) · `subcontractor.service.ts` satır kayması (başlık uyarısı + bugünkü ölçüm) · `apply-migration` tek-transaction değil (§6) · migration damgası (`…110000` → `…140000`) · `(38)→(40)` talimatı (§6) · `buildRollWhere` kör noktası (§5.2) · Kartela Kabul çip yüzeyleri (§4.3) · `kartela.service.ts:1188`.

1. **"Finalize parent satırlarını `TAMBUR_FINALIZE` ile damgalasın"** (undo uydurmasının önerilen çaresi) — **RED.** Damgalamak, diğer üç emeklilik yoluyla simetriyi bozar ve undo guard'ına yeni bir durum sınıfı ekler; üstelik sorunu **çözmez**: post-migration özelliksiz parent'ın damgalı satırı da olmaz, legacy dalına düşer ve uydurma sürer. Çare damga değil **donör kısıtıdır** (§3.1): doğum-anı satırı testi hem legacy'yi doğru kurtarır hem uydurmayı imkânsızlaştırır, tek satırlık `where` ile.
2. **`validFrom`/`validUntil`** — RED (§1 ③): aynı bilgiyi ikinci kez saklar, AST tarayıcısını ve iki helper'ı parametreleştirmeye zorlar.
3. **Ayrı append-only değişim defteri tablosu** (`ShipmentEvent`/`SackWeighing` deseni; "34 okurun hiçbirine dokunmaz") — **RED, ama gerekçe düzeltilerek.** Eski gerekçe ("RESTRICT FK teardown'ları P2003'e düşürür") geçersizdi: tablo Cascade ile de doğabilirdi. Doğru gerekçe: `ShipmentEvent`/`SackWeighing` desenlerinde durum satırı **silinmez**, olay defteri onu destekler; burada durum satırının **kendisi** iddiadır ve ayrı defter onu silmeyi meşrulaştırır — "ne oldu" hiçbir okurun join etmediği ikinci tabloya taşınır, as-of cevabı replay ister ve her yeni yazarın defter satırını yazmayı **hatırlaması** gerekir (DB seddi yok). Damgada ise dışlayıcılık DB'de (partial unique), sürüm zinciri tek tabloda, unutma AST tripwire'ında yakalanır. `defter.md`nin "bir tablo hem defter hem durum kaynağı olamaz" cümlesiyle çelişmez: damgalı satır bir OLAY değil, **süresi dolmuş bir sürümdür**; olay defteri (kim/neden) audit'tir. İleride özellik değişimi için gerçek bir olay defteri gerekirse additive bir B-6'dır, bu işin önkoşulu değil.
4. **`RollProperty.sourceKind` (`TARGET`/`STATION`/`MANUAL`)** — bu turda RED. Y9'un dar kümesini kanıtlı hale getirirdi ama şema değişikliği + **dokuz** yazarın hepsine dokunmayı gerektirir; B-5'in kapsamını ikiye katlar. Sınır §8.4'te açıkça yazılı ve §10 bekçisinde ölçülür.
5. **`replace`de `undefined` = DOKUNMA** — RED: `ORDER_PRODUCTION`da hedefin sipariş satırından türemesi yük taşıyan bir kuraldır (`rota-renk.md:19`). Yerine §3.2'nin üç parçalı çözümü: kilitliler birleştirilir, kapı delta'ya uygulanır, `existing` tazelenir.
6. **`§8.1/§8.2/§8.3` probe fazı** (paylaşılan `ROLL_LIST_INCLUDE.properties` referansı · tipsiz `as const` include'lar · filtreli `_count`) — **DÜŞÜRÜLDÜ, riskler kapalı.** `sabitTasir` derinlik-0'da yerel `VariableDeclaration` başlatıcısını takip ediyor (O2 çözülür); `kardestenCoz` `tambur.service.ts:1634-1650` ve `demo.service.ts:58-67` için tek aday model buluyor; filtreli `_count` üretimde zaten kullanılıyor (`workorder-locks.helper.ts:118-122`, `fabric-property.service.ts:294`, `shipping.service.ts:3998`). Faz 1'in "ilk işi probe" maddesi yalnız §5.2'ye (buildRollWhere) daralır.
7. **"Faz 0'ın gerekçesi: 26 audit satırı / 12 topta canlı veri kaybı"** — **GERİ ÇEKİLDİ.** O 36 `ROLL_MANUAL_OVERRIDE` satırının 31'i dev DB'nin tazelendiği gün yazılmış, 30'unda `userId`, hepsinde `requestId`/`deviceId` boş; test/script artığı. Üstelik `oldData` özellik listesi tutmuyor (36/36'da yok), yani saha kaybı **ölçülemez**. Faz 0 kalır — gerekçesi **kod yoludur** (`CuvalDuzeltScreen` alanı yollamıyor + controller `?? []` + koşulsuz `deleteMany(FLAG)`), sayı değil. Karar notuna ve commit mesajına o cümle **yazılmaz**.
8. **"Fark bazlı yazımın gerekçesi sürüm enflasyonu"** — düzeltildi: hacim küçük (7.618 + 394 satır, CHOICE hiç kullanılmamış). Fark bazlı yazımın asıl gerekçesi **yarış pinlemesidir** (§2).

---

## 11. Açık riskler

1. **`buildRollWhere` tiplemesi tek gerçek blokaj.** Faz 1 bunu ölçmeden yazara geçilmez (§5.2). Tarayıcının kontrolü ayrıca **gevşektir**: sabit, literalin herhangi bir yerinde geçiyorsa yeşil verir; `properties` anahtarında olduğunu doğrulamaz.
2. **FLAG→CHOICE ve CHOICE→FLAG tip dönüşümü KALICI kilitlenir.** O24/T15 tarihsel saydığı için bir kez hedef/değer olmuş özellik sonsuza dek dönüştürülemez hale gelir. Bu **bilinçli** seçimdir (tutarsız "değerli bayrak" limbosu üretmemek için); karşılığı panelden geri alınamayan bir yönetici kısıtıdır. Hata metni çıkış yolunu söylemeli ("pasifleştirip yenisini aç") ve §8.6 iki ayrı negatif sonda ile ölçülmeli. Karar notuna yazılır.
3. **Çevrimdışı replay damgalı satırı diriltir.** Kuyruk (`mobil/src/offline/mutations.ts:152` QC2_COMPLETE, `:181` KURSUN_FINISH) saatler sonra teslim edebilir; `setRollPropertyValueTx` aktif satır yoksa yeni satır yazar. **Karar: dirilme bilinçli sayılır** (istasyon işi gerçekten yaptı) ve sürüm zincirinde görünür kalır. İleride `clientEnteredAt` taşınırsa "revoke'tan eski replay no-op" kuralı eklenebilir — bu turda değil.
4. **Sürüm enflasyonu (küçük ama gerçek).** Electron İE Düzenle (`workOrderPayload.ts:106`) ve Düzelt (`RelabelSpecForm.tsx:84`) özellik değişmese de TAM liste yolluyor; diff gerçekten no-op olmalı. Bekçi §9 + `test_workorder_order_link.ts` "toplam = 1" iddiası ölçer.
5. **Legacy undo kısmen kurtarılamaz.** Migration'dan önce finalize edilmiş ve satırları hard-delete edilmiş parent'larda, çocukları FIRE/SCRAP olduğu için hiç miras almamış vakalar geri gelmez. Ölçülemez ve düzeltilemez; yalnız bir daha olmaması sağlanır.
6. **`test_property_value_selection.ts:154` kararla doğrudan çelişiyor.** Doğru uygulama onu kırmızıya çevirir; "bekçi kırmızı → davranışı geri al" refleksi bütün işi iptal ettirir. Bu yüzden **yazar değişmeden önce** yeniden yazılır ve commit mesajında gerekçesi anılır.
7. **CHOICE sürümlemesi canlıda hiç denenmemiş** (`valueId` dolu 0 satır). Sahadaki ilk gerçek 50GR→25GR düzeltmesi partial unique'in bu tablodaki ilk sınavıdır; Faz 2a'dan sonra ilk Kurşun/KK2 turu izlenmeli.
8. **Y9'un dar kümesi kanıt ayrımı yapamaz** (§10.4): hem WO hedefi hem istasyon AUTO yeteneği olan özellik (KURSUN tam olarak böyle) hedeften çıkarılınca yine damgalanır. Kabul edilen sınır; §10 bekçisinde açıkça ölçülür.
9. **`getCancelImpact` "işlenmiş" anlamı kayar.** Y2 silmeyi bırakınca `TAMBUR_CONSUMED` parent özellik taşır → `_count.properties > 0` → "işlenmiş" görünür. Bugünkü davranış zaten asimetrikti (diğer üç yol dokunmuyordu); bu **tutarlılığa** doğru bir kaymadır ama iptal önizlemesini okuyan kullanıcı için değişikliktir. Faz 2b'de gözlenmeli.
10. **`workorder-link.service.ts:826` echo'su gereksizleşir.** Faz 0'dan sonra toplu düzeltmenin FLAG'leri geri yollamasına gerek kalmaz. Bırakılırsa zararsız (diff no-op), **ama `:788` okuması süzülmezse 40 topta birden diriltme yapar**. Ya süz ya kaldır — ikisini birden atlamak yasak.
11. **Paralel oturum riski.** Şema kilidi sırayla devredilir; bu iş kilidi Faz 1 boyunca tutar. Faz 2e `subcontractor.service.ts`, Faz 2d `workorder.service.ts` üzerinde başka oturumların açık değişikliği varken başlatılmaz.
12. **`updateTargetProperties` terminal WO'da hâlâ serbest** (`routes/workorder.routes.ts:1101` "Status farketmez"). Faz 2d kilidi ekler ama terminal statü claim'i **eklemez**; "kapanmış iş emrinin hedefi değiştirilebilmeli mi" sorusu bu dilimin dışında bırakıldı. Kayda geçti.
