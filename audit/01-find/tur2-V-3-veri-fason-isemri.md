# TUR 2 · V-3 — Veri merkezli: fason / iş emri / adım / rota / parti / refakat kartı

**Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Denetçi: V-3 (② BULMA, TUR 2 — veri merceği)
**Yöntem:** önce veride ihlal ara → bulunca kodda geriye izle. Salt-okunur.
**Veri kaynakları:**
- **SAHA** = prod'un 2026-08-25 kopyası `tekserp_saha_0825` (190/195 migration; 213 iş emri · 635 adım · 195 fason sevk · 143 fason makbuz · 198 parti · 213 refakat kartı · 2 kurşun bypass ataması · 0 kartela sevki) — `audit/tools/sql-saha.sh`
- **DEV** = `adnansahin_db` (195 migration; 762 iş emri, ağır test kalıntısı: 480 `TST-WHA` WO) — `audit/tools/sql-dev.sh`
**Koşulan hazır kapılar:** `Teks-Erp/scripts/consistency-check.sql` §1–§19 · `consistency-check-derived.sql` §21–§26b · `test_consistency.ts` §20 (SQL'i çıkarılıp elle koşuldu)
**Üretilen sorgu dosyaları:** `audit/data/T2-V3-sweep.sql` (V3-01…V3-38) · `audit/data/T2-V3-sweep2.sql` (V3-40…V3-58) · `audit/data/T2-V3-s20.sql`
**Ham çıktılar:** `audit/data/T2-V3-consistency-saha.txt` · `T2-V3-derived-saha.txt` · `T2-V3-sweep-saha.txt` · `T2-V3-sweep-dev.txt`

> Bu tur BULGU üretir, ama önce **veri sağlık tablosunu** üretir: aşağıdaki "arandı, 0" listesi bulgunun yokluğunun da kanıtıdır.

---

## 0. Hazır kapıların canlı kopyada koşum sonucu

| Kapı | Saha (0825) | Dev | Not |
|---|---|---|---|
| §1–§11, §14–§19 (`consistency-check.sql`) | **0** | — | Alanımı ilgilendiren §14/§15/§16/§17/§19 dahil temiz |
| §12 (kapanmış hareket `qtyOut ≠ qtyIn`) | ham 15 satır → **muaf desenler uygulandıktan sonra 0** | — | 15'in tamamı `WO_CLOSE_*` / `CANCEL:<sevkNo>` / `CANCELLED` desenlerinde; muaf listesi `test_consistency.ts:299-311`. Ham SQL dosyası muafı taşımıyor → dosyayı elle koşan "15 satır" görür (bilgi, V-1/I alanına not) |
| §13 (`currentQty > initialQty`) | 2 (bilinçli, CLAUDE.md 2026-08-22) | — | V-1 alanı |
| **§20** (adım durumu ↔ türetilen) | **1 satır** (bkz. V-3-05) | 0 (üretim formatlı) | K10 "saha yedeğinde 0" diyordu — ölçüm bunu **çürüttü** |
| §21 (WO tipi ↔ sipariş bağı) | **0** | **2 satır** (bkz. V-3-08) | Saha temiz; `fix_workorder_type_from_links.ts` prod'da gerekmiyor |
| §22 (IN_PROGRESS ama tüm adımlar bitmiş) | 0 | 0 | |
| §23 (açık bypass ama WO terminal) | 0 | 0 | |
| §24a / §24b (fason kalem kapanışı / doğrudan sevk) | 0 / 0 | 0 / 0 | |
| §25 (kartelalık ↔ etiket bayatlığı) | 0 | 0 | |
| §26 / §26b (plan-sapma kapısı) | 4 (kapı öncesi, `finalizedAt` 2026-08-17) / **0** | 0 / 0 | §26 bilgi; kapı eşiği 2026-08-20 |

---

## 1. Bulgular

### [V-3-01] Mobil Hızlı İş Emri'nde fason firması çözülemezse mal fasona GİTMEZ; onay ekranı bunu kullanıcı tercihi gibi gösterir, başarı ekranı hiç söylemez
| Şiddet | S2 | Kategori | E — Üretim · fason akışı (INV-FAS-01, INV-SM-06) | Öncelik | P1 | Modül | FASON/WO | Kanıt seviyesi | **K2** |

**Özet.** Sahadaki iki rotanın da fason adımlarında **planlı firma YOK** (ölçüldü). Tablette "Fasona gönder" anahtarı **varsayılan AÇIK** doğar; firma çözülemezse istemci `dispatchFirstStep: false` gönderir, sunucu iş emrini açar ve **sevki hiç denemez**. Onay ekranında yalnız soluk (`muted`) bir satır "Hayır, yalnız planlanır" der — operatörün kendi seçtiği bir şeymiş gibi okunur, sebebini söylemez; başarı ekranında ise **hiçbir iz yoktur** (sevk satırı basitçe çizilmez). Sonuç: mal fabrikada kalır, sistem onu "boyahane adımında üretimde" sayar.

**Kanıt (kod).**
- `mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts:233` — `const [dispatchFirstStep, setDispatchFirstStep] = useState(true);` (varsayılan AÇIK)
- `mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts:875-876`
  ```ts
  dispatchFirstStep:
    dispatchFirstStep && firstStepDispatch.isFason && !!firstStepDispatch.firmId,
  ```
  Firma yoksa `false` gider → backend'in uyarı üreten dalı (`workorder.service.ts:1406-1410`, `dispatchWarning = "Fason firma planlanmadığı için otomatik sevk yapılamadı…"`) **hiç koşmaz**.
- `mobil/src/screens/Modules/HizliIsEmri/wizard/StepConfirm.tsx:109-116` — tek sinyal: `value={willDispatch ? 'Evet · …' : 'Hayır, yalnız planlanır'}` + `muted`.
- `mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts:743-770` — `onSuccess` `res.message`'ı da `res.warnings`'ı da **okumaz**; yalnız `data.dispatch`'i taşır.
- `mobil/src/screens/Modules/HizliIsEmri/NewWorkOrderView.tsx:167-171` — `{r.dispatch ? <Text>Fasona sevk edildi …</Text> : null}` → sevk yoksa **hiçbir şey basılmaz**.
- **Karşı örnek (aynı gün, aynı karar, DOĞRU uygulanmış):** `Electron/src/pages/Operations/Rolls/ReworkRollsDialog.tsx:224` `willDispatch = firstStepIsFason && dispatchFirstStep && !!firmId` + `:344-345` kutu `disabled={!firmId}` + `:353` firma yoksa açıklayıcı metin. Masaüstü kapalı, **tablet açık** — ve sahayı tablet kullanıyor.

**Kanıt (veri, SAHA).**
```sql
-- Rotaların fason adımlarında planlı firma var mı?
SELECT ro.code, rs.sequence, st.name, st.type,
       rs."plannedSubcontractorId" IS NOT NULL firma, rs."requiredCategoryId" IS NOT NULL kat
FROM routes ro JOIN route_steps rs ON rs."routeId"=ro.id JOIN stations st ON st.id=rs."stationId";
```
→ 7 rota adımının **tamamında** `firma=false`, `kat=false` (BOYA-ZIMPARA 1-4, STD-BOYA 1-3).

```sql
SELECT wo."workOrderNumber", wo.status, wo."createdAt", r.barcode, r.status, r."currentQty",
       s."plannedSubcontractorId" IS NOT NULL firma
FROM work_orders wo JOIN work_order_steps s ON s."workOrderId"=wo.id AND s."stepSequence"=1
LEFT JOIN rolls r ON r."currentStepId"=s.id
WHERE wo."workOrderNumber" LIKE 'IE2508%' ORDER BY wo."createdAt";
```
| İE | WO durumu | Oluşma | Top | Top durumu | m | Adımda firma | Fason sevk |
|---|---|---|---|---|---|---|---|
| **IE2508260001** | **PLANNED** | 25.08 04:28:26 | **T240826F0036** | **IN_PRODUCTION** | **30** | **hayır** | **YOK** |
| IE2508260002 | IN_PROGRESS | 25.08 04:32:54 | T240826F0034 | AT_SUBCONTRACTOR | 50 | evet | FS2508260001 |
| IE2508260003 | IN_PROGRESS | 25.08 13:44:54 | T240826F0035 | AT_SUBCONTRACTOR | 70 | evet | FS2508260002 |
| IE2508260004 | IN_PROGRESS | 25.08 13:54:59 | T240826F0031 | AT_SUBCONTRACTOR | 325 | evet | FS2508260003 |

Ek doğrulama: `T240826F0036` (`entrySource=TAMBUR_SPLIT`, yani "Yeniden Üretime Al" akışıyla depodan geri alınmış bitmiş top) için **hiç `roll_movements` satırı yok** (fason adımına movement yalnız sevkte açılır), partisi **P89 canlı**, refakat kartı **ACTIVE + hiç basılmamış** (`printedAt = createdAt`). Yedeğin alındığı 25.08 → bugün 28.08 arası mal **3 gündür** "boyahanede üretimde" görünüyor ama fabrikada duruyor. Yalnız `AT_SUBCONTRACTOR` sayan hiçbir fason yüzeyi (açık sevk listesi, fason karnesi, "fasonda bekleyen metraj") bu 30 m'yi görmüyor.

**failure_mode.** Operatör tablette Hızlı İş Emri açar, rota `STD-BOYA` (planlı firma yok), favori firma hafızası bu kategori için boş → `firstStepDispatch.firmId = null`. Onay ekranında "Fasona gönder: **Hayır, yalnız planlanır**" satırı soluk basılır; operatör "Başlat"a basar, yeşil başarı ekranı "İE… · 1 top · 30 m" der ve **sevk satırı hiç çizilmez**. Operatör malı boyahaneye giden arabaya koyar/koymaz — sistemde iş emri PLANNED, top IN_PRODUCTION, fason sevki YOK. Fason karnesi ve "fasonda kaç metre var" rakamları bu topu saymaz; boyahane 30 m'yi hiç görmez.

**İş etkisi.** Mal fabrikada kalır ama sistemde "üretimde" görünür → boyahane hesabı ve WIP eksik; iş emri sonsuza dek PLANNED kalır (kart ACTIVE, parti açık). Kurtarma yolu var (Fason Sevk ekranından elle gönderilir, WO picker'da görünür) — bu yüzden S1 değil S2.

**Öneri (2. tur).** ① Tablet: firma çözülemediğinde onay ekranındaki satır **muted bilgi değil, uyarı** olmalı ve sebebi söylemeli ("Bu rotanın boyahane adımında planlı firma yok — firma seçmeden mal fasona GİTMEZ"); masaüstündeki `disabled` kutu deseninin ikizi. ② Başarı ekranı `dispatchFirstStep` istendi ama `dispatch` yoksa **açık bir uyarı bandı** basmalı ("Fasona sevk YAPILMADI — Fason Sevk ekranından gönderin"). ③ Sunucu tarafı kalıcı çözüm: "fason adımında `currentStepId` dolu ama açık sevk kalemi olmayan top" mutabakat sorgusu (`consistency-check-derived.sql` §27 adayı) — bugün böyle bir kapı YOK. Migration/izin gerekmez; ①-② APK ister.
**Kabul kriteri.** (a) Firma seçmeden Hızlı İş Emri açıldığında onay ve başarı ekranlarında sevk yapılmadığını SÖYLEYEN bir metin görünür; (b) yeni mutabakat sorgusu IE2508260001'i yakalar ve firma seçilen üç kardeş WO'yu yakalamaz (negatif sonda).
**Efor.** 1,5 gün.
**Önceki defter.** `BULGU-T1-048` (quick-start uyarı kanalları istemcide okunmuyor) — bu bulgu onun **veriyle kanıtlanmış** tezahürüdür ve ek olarak "uyarı hiç üretilmiyor" dalını gösterir.

---

### [V-3-02] Fason kabulünde `clientToken` her gönderimde yeniden üretiliyor — KISMİ kabulün tek replay koruması fiilen kapalı
| Şiddet | S2 | Kategori | B.3 — İdempotency / replay | Öncelik | P1 | Modül | FASON | Kanıt seviyesi | **K2** |

**Özet.** Sunucu, kısmi fason kabulü için **tek** replay kimliği olarak `SubcontractorReceipt.clientToken`'a dayanır: küme-eşitliği guard'ı kısmi makbuzları **bilerek atlar**. Ama iki istemci de token'ı **istek gönderilirken** üretiyor; aynı mantıksal denemenin ikinci gönderimi FARKLI token taşır ve guard hiç devreye girmez. Sonuç: aynı kısmi kabul iki kez kaydedilir, top metrajı **iki kez** düşülür ve iki set çocuk top doğar.

**Kanıt (kod).**
- `Teks-Erp/src/services/subcontractor.service.ts:2345-2360` — token varsa cached makbuz (tek koruma).
- `Teks-Erp/src/services/subcontractor.service.ts:2414` — küme-eşitliği guard'ı: `if (prior.items.some((i) => i.isPartial)) continue;` → **kısmi makbuz cached DÖNMEZ** (yorum :2408-2413 bunu açıkça yazıyor: "Kısmi denemelerin replay kimliği clientToken'dır").
- `Teks-Erp/src/services/subcontractor.service.ts:2879-2893` — kısmi decrement claim'i `where: { id, status: AT_SUBCONTRACTOR, currentQty: { gt: p.receivedQty } }`. **İkinci gönderimde de geçer** (kalan hâlâ büyükse), yani claim burada replay'i kesmez — tam kabulde kestiği gibi.
- `Electron/src/pages/Operations/WorkOrders/FasonReceiveDialog.tsx:176-195` (token `:195`, yanıltıcı yorum `:194`)
  ```ts
  const mut = useMutation({
    mutationFn: () => workOrderService.receiveFason({
      …,
      // İdempotency — retry aynı isteği tekrarlarsa ikinci makbuz doğmaz.
      clientToken: crypto.randomUUID(),
    }),
  ```
  Token **`mutationFn` gövdesinin içinde** üretiliyor → her çağrı yeni token. Yorum tam tersini iddia ediyor.
- `mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts:343` `clientToken: generateClientUuid()` + `FasonKabulScreen.tsx:1259-1262` `doSubmit()` → `buildPayload()` → `mutate(payload)`. React Query'nin kendi kuyruk replay'i token'ı korur (yorumun doğru olduğu tek yol), ama **operatörün ikinci basışı** yeni token üretir. Bekçi bunu doğrulamak yerine **çeliştiriyor**: `receivePayload.helper.test.ts:331` `expect(p1?.clientToken).not.toBe(p2?.clientToken)`.
- Proje bu sınıfı iki kez öğrenmiş: CLAUDE.md 2026-07-27 (Tambur kesim) ve 2026-08-03 (KK1 ham giriş) — "mutate çağrısı başına yeni token üretmek korumayı boşa düşürür"; çözüm deseni `mobil/src/offline/entryAttempt.ts` var ama fason kabulünde kullanılmıyor.

**Kanıt (veri).**
```sql
SELECT count(*) toplam, count("clientToken") tokenli, count(DISTINCT "clientToken") tekil
FROM subcontractor_receipts;
```
| Ortam | Makbuz | Token taşıyan | Not |
|---|---|---|---|
| **SAHA** | 143 | **2** (FK2408260007 · FK2408260008, 24.08 19:21 ve 19:23) | Yani koruma sahada 24.08 akşamına dek **hiç** yoktu |
| DEV | 52 | **0** | |
Kısmi kabul sahada henüz 1 kalem (`subcontractor_receipt_items.isPartial = true` → 1/638). Yani ihlal **henüz doğmadı**, ama koruma yok.

**failure_mode.** Boyahaneden 100 m'lik topun 51 m'si döner. Operatör Electron'da "Kabul Et"e basar; istek yavaş fason kabul tx'inde (K3a'nın "en uzun tx adayı") 30 sn'yi aşar ya da bağlantı düşer, hata toast'ı çıkar. Operatör tekrar basar. İkinci istek **yeni bir `clientToken`** taşır: token guard'ı boş döner, küme guard'ı kısmi olduğu için `continue` der, decrement claim'i `currentQty(49) > 51` **olmadığı için** bu örnekte 409 verir — ama 100 m'den 30 m kabul edildiyse (`70 > 30` doğru) ikinci gönderim **geçer**: `currentQty` 100 → 70 → 40, iki `SubcontractorReceipt` (FK…01, FK…02), her birinden 30 m'lik yeni açık kumaş doğar (toplam 60 m) ve fason hesabından 60 m düşülür. Fiziksel gerçek 30 m'dir; stok 30 m fazla, fasonda kalan 30 m eksik görünür.

**İş etkisi.** Kısmi kabul defterinin (`SubcontractorReceiptItem.receivedQty`) çift yazılması fason cari hesabını ve "fasonda kalan" rakamını bozar; çekme (`RollVariance SUBCONTRACTOR_RETURN`) da iki kez yazılır. Geri alma LIFO kuralı iki makbuzu ters sırada iptal etmeyi gerektirir.

**Öneri (2. tur).** Token'ı **mutasyonun dışında**, "mantıksal deneme" başına üret ve **yalnız belirsiz hatada (ağ/timeout/5xx) yapıştır, kesin 4xx'te bırak** — `mobil/src/offline/entryAttempt.ts` deseninin fason kabul ikizi. Electron'da `useRef`/state ile denemeye bağla; mobilde `buildReceivePayload`'a token'ı **parametre** olarak geçir (üretmesin). Bekçi: `receivePayload.helper.test.ts`'in `not.toBe` iddiası **tersine** çevrilmeli (aynı deneme → aynı token). Migration/izin YOK; APK + Electron ister.
**Kabul kriteri.** Aynı kısmi kabul ekranından art arda iki gönderim → ikincisi `success + "idempotent retry"` döner; `subcontractor_receipts` tek satır, `rolls.currentQty` tek kez düşer. Negatif sonda: token sabitlemesi kaldırılınca test kırmızı.
**Efor.** 1 gün.
**Önceki defter.** `BULGU-T1-005` (aynı token'ın EŞZAMANLI gelişi `withBarcodeRetry` predicate'siz olduğu için 409'a düşüyor). Bu bulgu tamamlayıcıdır: T1-005 "aynı token yarışta bozuluyor" der, bu bulgu "istemci zaten hiç aynı token göndermiyor" der — birlikte korumanın iki ucu da açık.

---

### [V-3-03] `TravelerCard.printedAt` kart DOĞUŞUNDA damgalanıyor: hiç basılmamış kart "Basım tarihi" taşıyor ve liste onu "en son basılan" sayıyor
| Şiddet | S3 | Kategori | C — Veri modeli · kolon semantiği | Öncelik | P3 | Modül | REFAKAT KARTI | Kanıt seviyesi | **K2** |

**Özet.** `printedAt` `NOT NULL @default(now())`. Kart iş emri **açılışında** doğduğu için hiç basılmamış her kartta `printedAt = createdAt` olur. Aynı alan (a) kart listesinin **varsayılan sıralaması**, (b) kartın üstüne basılan **"Basım tarihi"** alanıdır. "Hiç basılmadı" ile "az önce basıldı" veri düzeyinde ayırt edilemez.

**Kanıt (kod).**
- `Teks-Erp/prisma/schema.prisma:3169` — `printedAt DateTime @default(now()) @db.Timestamptz` (nullable DEĞİL).
- `Teks-Erp/src/services/traveler-card.service.ts:190-200` — `createForWorkOrder` `printedAt` yazmaz → DB default'u basar.
- `Teks-Erp/src/services/traveler-card.service.ts:67-68` — `// varsayılan/createdAt isteği printedAt'e düşer (yeni basılan kart ilk gelsin).` + `resolveSortBy(..., "printedAt")` (`:680`).
- `Teks-Erp/src/config/traveler-card-fields.ts:41` — `{ key: "printedAt", label: "Basım tarihi", … }` (kâğıda basılabilen alan katalogu).
- Gerçek baskı damgası yalnız `:373` (`recordPrintEvent` `printedAt: new Date()`) ve `:287` (`reprint`, hiçbir istemci çağırmıyor).

**Kanıt (veri, SAHA).**
```sql
SELECT count(*) toplam,
       count(*) FILTER (WHERE abs(extract(epoch FROM (tc."printedAt" - tc."createdAt")))<1) hic_basilmamis,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM printed_documents pd
              WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id)) defterli
FROM traveler_cards tc;
```
→ `toplam=213 · hic_basilmamis=42 · defterli=60`.

25.08'de doğan dört kartın hepsi (`IE2508260001…04`) `printedAt = createdAt`, defter satırı **yok**, `contentDirty = true`, ama listede "25.08.2026 04:28 basıldı" görünüyor:
```
IE2508260001 | createdAt 2026-08-25 04:28:26.684 | printedAt 2026-08-25 04:28:26.684 | defter 0
IE2508260002 | …04:32:55.010                     | …04:32:55.010                     | defter 0
```
Karşılaştırma (gerçekten basılmış kartlar): `IE2408260007` createdAt 12:01:09 → printedAt 12:04:50, defter 1.

**failure_mode.** Planlamacı Refakat Kartları listesini açar (varsayılan sıra = "Basım tarihi ↓"). En üstte bugün açılmış, **hiç basılmamış** dört kart durur ve tarih sütunu "bugün 04:28" der. Planlamacı "kâğıtlar çıkmış" sanır; sahada kart yoktur. Aynı yanlış, kartın kendi gövdesine de basılır: `traveler-card-fields.ts` "Basım tarihi" alanı seçiliyse kâğıtta iş emrinin AÇILIŞ saati yazar (ilk baskıda ~doğru, ama hiç basılmamış kartın önizlemesinde yanlış).

**İş etkisi.** "Hangi kartlar sahaya çıktı" sorusunun tek doğru cevabı `printed_documents(docType='TRAVELER_CARD')` defteridir ve o defter 2026-08-18'de başladı; 213 kartın 153'ünde satır yok. `printedAt` bu boşluğu doldurur gibi görünüp yanlış cevabı veriyor.

**Öneri (2. tur).** `printedAt`'i **nullable** yap (`DateTime?`, default kaldır) ve yalnız `recordPrintEvent`/`reprint` yazsın; liste sıralamasında `NULLS LAST` + kolon başlığı "Basım" (boşsa "—"). Geriye dönük: `printedAt = createdAt` olan satırlar `NULL`'a çekilebilir — **[PROD'DA ÇALIŞTIRMA]** dry-run script + geri alma için `createdAt`'ten yeniden doldurulabilir olduğu için kayıpsız. Alternatif (migration'sız, daha zayıf): listede ve alan kataloğunda `printedAt` yerine defterin `max(version)` satırının tarihini göster.
**Kabul kriteri.** Yeni açılan bir iş emrinin kartı listede "Basım: —" gösterir; baskı olayından sonra tarih dolar; `test_traveler_card_versions.ts`'e "hiç basılmamış kartın printedAt'i boştur" sondası eklenir.
**Efor.** 1 gün (migration dahil).
**Önceki defter.** Yok.

---

### [V-3-04] `recordPrintEvent` sürümü atomik claim'siz yazıyor: eşzamanlı iki baskı olayı aynı sürüm numarasını üretir ve defterdeki kopya sessizce ezilir
| Şiddet | S2 | Kategori | A.2 — Kayıp güncelleme (lost update) | Öncelik | P2 | Modül | REFAKAT KARTI | Kanıt seviyesi | **K1** (+K2 yol canlı) |

**Özet.** Kartın mevcut sürümü ve basılacak plan **havuz client'ında, transaction dışında** okunur; sonra tx içinde `update({ where: { id } })` ile `version: plan.version` **koşulsuz** yazılır. Beklenen sürüm `where`'de yok, claim yok. İki baskı olayı ~aynı anda gelirse ikisi de aynı `version`'ı hesaplar; defter (`printed_documents`) `upsert` olduğu için ikincisi birincinin **snapshot'ını ezer**. Bir revizyon ve o kâğıdın kaydı kaybolur, sayaç bir eksik kalır.

**Kanıt (kod).** `Teks-Erp/src/services/traveler-card.service.ts:349-380`
```ts
:350  const card = await prisma.travelerCard.findUnique({ where: { id: cardId }, … });  // HAVUZ (tx DIŞI)
:364  const plan = await this.resolvePrintPlan(card);                                    // HAVUZ (tx DIŞI)
:368  await prisma.$transaction(async (tx) => {
:369    await tx.travelerCard.update({
:370      where: { id: cardId },                       // ← beklenen version YOK, claim YOK
:376      version: plan.version,                       // ← koşulsuz yazım
```
- `:443-462` `archivePrintedVersionTx` `upsert(where: docType_sourceId_version)` — `:462` `update: { snapshot, printedById: … }` dalı ikinci yazımı **hata vermeden** kabul eder (bu dal "aynı içeriğin ikinci kopyası" için tasarlanmış; farklı içerikli iki revizyon da aynı dala düşer).
- `:340-347` yorumu bilinen sınırı **yalnız** "HTML çekme ile basıldı deme ayrı isteklerdir" penceresi için kabul ediyor; **iki eşzamanlı print-event** kapsam dışı.
- Doğru desen aynı serviste zaten var: `print()` `:222-232` P2002'yi yakalayıp tx'i bir kez yeniden koşuyor. `recordPrintEvent`'te karşılığı yok.

**Çakışma senaryosu.**
- T1 (Electron) `findUnique` → `card.version = 2`; `resolvePrintPlan` içerik değişmiş → `plan.version = 3`.
- T2 (tablet, 200 ms sonra) `findUnique` → hâlâ `2` (T1 daha commit etmedi); planlamacı bu arada **eni** de değiştirmiş → T2'nin planı FARKLI içerik, `plan.version = 3`.
- T1 commit: kart v3, defterde v3 = A içeriği.
- T2 commit: kart v3 (aynı), defter `upsert.update` → **v3 = B içeriği** (A ezildi).
- **SONUÇ:** sahada A ve B içerikli iki farklı kâğıt dolaşır, defterde tek v3 (B) durur, sayaç 4 yerine 3'te kalır. `planKey` eşitliği burada YOK — gerçek içerik farkı ezildi.

**failure_mode.** IE2108260004 kartı v2'de; planlamacı önce rengi sonra eni değiştirir; büro Electron'dan, usta tabletten kartı basıp ikisi de print-event gönderir. Kâğıtlardan biri "v3 · KIRMIZI · 180 cm", diğeri "v3 · KIRMIZI · 200 cm" yazar; sistemdeki kayıtlı v3 yalnız birini bilir. "Bu kâğıt neden böyle" sorusu denetimde cevaplanamaz.

**Veride fiili ihlal (K2).** Ezilme izi tanım gereği görünmez (üzerine yazıldı). Yolun **canlı olduğu** ölçüldü: SAHA'da 17 kart `version=2` (revizyon dalı gerçekten koşuyor), 60 kartın defter satırı var, 62 `TRAVELER_CARD` defter satırı mevcut (2026-08-18…08-24).
```sql
SELECT tc."cardNumber", tc.version, (SELECT string_agg(pd.version::text||':'||pd.status, ',' ORDER BY pd.version)
  FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id)
FROM traveler_cards tc WHERE tc.version > 1;   -- 17 satır
```

**İş etkisi.** Refakat kartı ISO 9001 anlamında **kontrollü belgedir**; sürüm numarası "bu kâğıt hangi planı gösteriyor"un tek kimliğidir (`resolvePrintPlan` "TEK KARAR NOKTASI" olarak belgelenmiş). Numaranın iki farklı içeriği adlandırması, kontrolün dayandığı eşitliği bozar.

**Öneri (2. tur).** `update`'i atomik claim'e çevir: `updateMany({ where: { id: cardId, version: card.version }, … })`, `count === 0` → tx'i bir kez yeniden koş (planı yeniden çöz), ikinci kez de kaybederse 409 `CARD_VERSION_CHANGED`. `archivePrintedVersionTx` upsert'i kalabilir (aynı sürümün ikinci kopyası meşru), ama claim geçtikten sonra çalışır.
**Kabul kriteri.** İki paralel `recordPrintEvent` (N=2, gerçek DB) → biri v3, diğeri ya v4 üretir ya 409 alır; defterde iki ayrı sürüm satırı ve iki ayrı snapshot. Negatif sonda: claim kaldırılınca test kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** Tur 1 çürütücüsünün önerisi (`audit/tours/tur1-curutucu-onerileri.md`, kaynak `BULGU-T1-106`) — burada kanıtlanıp bulguya çevrildi.

---

### [V-3-05] `test_consistency` §20 canlıda KALICI KIRMIZI: kök neden 2026-08-15'te kapandı ama bozuk satır düzeltilmedi ve iki farklı yazılı gerekçe birbiriyle çelişiyor
| Şiddet | S3 | Kategori | E — Türetilmiş alan · mutabakat kapısı (INV-SM-03 / INV-WO-03) | Öncelik | P3 | Modül | WO/ADIM | Kanıt seviyesi | **K2** |

**Özet.** §20 (adım durumu ↔ movement'lardan türetilen değer) saha kopyasında **1 satır** dönüyor. Bu satır, `inventory.service.ts:3175-3193`'te **adıyla** anlatılan saha vakasının kendisidir (2026-08-15 düzeltmesinin motive edici örneği); kod tarafı kapandı, **veri düzeltilmedi ve backfill yok**. Sonuç: kapı bugünden itibaren "1 satır" ile "2 satır"ı ayırt etmeyi insana bırakıyor. Üstüne, aynı satır için repoda **iki çelişen gerekçe** var.

**Kanıt (veri, SAHA).** `test_consistency.ts:462-520`'deki §20 SQL'i çıkarılıp koşuldu (`audit/data/T2-V3-s20.sql`):
```
id                                   | workOrderNumber | wo_durum  | seq | kayitli   | acik | kapali | bekleyen | beklenen
fc7bab75-aaa1-4240-bf38-deae7f35c947 | IE0608260004    | COMPLETED |  2  | COMPLETED |  0   |   0    |    0     | PENDING
```
Zincir (canlı veriden yeniden kuruldu):
- `IE0608260004` adım 2 = "Kurşun + KK2", `startedAt` 06.08 14:09, `completedAt` 06.08 14:23, `status=COMPLETED`.
- Adımın **tek** hareketi `5081e130…` (top `T080826F0001`, `notes='KURSUN_BYPASS_FINISHED:…'`, kapanmış).
- 08.08 13:16 → WO kapanış dispozisyonu topu WAREHOUSE'a çekti (`WO_CLOSE_WAREHOUSE: test`).
- 08.08 13:17:13 → top **iptal edildi** (`status=CANCELLED`, `preCancelStatus=WAREHOUSE`).
- `recomputeStepStatus` CANCELLED topun hareketlerini saymaz (`roll-step.helper.ts:54-70`) → türetilen değer `PENDING`; kayıtlı değer hâlâ `COMPLETED`.

**Kanıt (kod, çelişki).**
- `Teks-Erp/src/services/inventory.service.ts:3175-3193` — bu satırı **hata** olarak anlatıyor: *"SAHA VAKASI (IE0608260004, canlı veride doğrulandı) … Eski küme BOŞ kaldı → recompute HİÇ koşmadı → adım bayat COMPLETED kaldı (türetilen doğru değer PENDING). Hata yok, log yok; drift'i yalnız `test_consistency` §20 gösteriyordu."* Düzeltme (`collectRollStepScopeTx`, `:3195`) uygulandı.
- kök `CLAUDE.md` 2026-08-22 notu (ve `audit/00-map/K10` §3) aynı bölümü **hata değil** diye sınıflıyor: *"§20 = SORGUNUN KÖR NOKTASI … adım durumu tarihsel olgudur, veri bozuk değil."*
- `Teks-Erp/scripts/test_consistency.ts:55-56` yorumu ise ölçüm iddiası taşıyor: *"§20'nin 305 satırının 305'i test fixture'ıydı; ÜRETİM formatlı (IE…) tek bir satır bile drift göstermiyordu."* — **canlı kopyada bu iddia artık yanlış** (`IE0608260004` üretim formatlı ve `notFixture` süzgecinden geçiyor).

**failure_mode.** Ekip mutabakat kapısını canlıya karşı koşar (dosyanın asıl değeri budur, CLAUDE.md 2026-08-22). §20 "1 satır" der. CLAUDE.md notu "veri bozuk değil, sorgunun kör noktası" dediği için satır yok sayılır. Üç ay sonra gerçek bir adım-durumu drift'i doğar (ör. `subcontractor.service.ts`'in adım statüsünü **doğrudan yazdığı** 7 noktadan biri `recomputeStepStatus` ile ayrışır — K4 §2); §20 artık "2 satır" der ve aynı gerekçeyle yine yok sayılır. Kapı sessizce işlevsizleşir; bozulan şey istasyon kuyruğu, "açık kart" listesi ve WO tamamlama koşuludur (`completeWorkOrderIfStepsDone` `notIn [COMPLETED, SKIPPED]` sayar → PENDING'e çöken adım iş emrini sonsuza dek açık bırakır).

**İş etkisi.** Bugün doğrudan zarar yok (WO zaten COMPLETED, top iptal). Zarar gelecekte: kırmızıya alışmış bir kapı, kapıyı hiç koşmamakla eşdeğerdir — §13'te ekibin bilinçli olarak **yazıya döktüğü** ("bölümü DARALTMA") kararın §20'de karşılığı yok.

**Öneri (2. tur).** İki şıktan biri, ama **yazılı** olsun: ① tek satırı düzelt (`work_order_steps.status = 'PENDING'`, `completedAt = NULL` — **[PROD'DA ÇALIŞTIRMA]** dry-run script, geri alma için eski değerler audit'e/scripte yazılır) ve §20 yeşile dönsün; ② düzeltme yerine §13'teki gibi **bilinçli kalıntı** olarak işaretle: `test_consistency.ts` §20'ye tarih/kimlik eşikli bir `noise` bloğu ("2026-08-15 düzeltmesinden ÖNCEKİ bozulmalar") ve dosyaya gerekçe yaz. Her iki durumda `test_consistency.ts:55-56` yorumundaki "üretimde tek satır bile yok" cümlesi **güncellenmeli** (bayat ölçüm). CLAUDE.md 2026-08-22 satırı da "kör nokta" ile "2026-08-15'te kapanan kod hatasının kalıntısı"nı ayırmalı.
**Kabul kriteri.** §20 canlı kopyada ya 0 satır döner ya da dönen satır sayısı **yazılı** beklenen sayıya eşittir; bekçi beklenenden fazlası çıkınca kırmızı verir.
**Efor.** 0,5 gün.
**Önceki defter.** Yok (`audit/FINDINGS.jsonl`'de §20 kaydı yok). İlgili: `BULGU-T1-041` (fason kapanışı `recomputeStepStatus`'u atlıyor) — aynı kapının koruduğu değişmez.

---

### [V-3-06] Kurşun dağıtımı sahada fiilen kullanılmıyor: 117 bypass kapanışının 115'i makine atfı OLMADAN kapandı
| Şiddet | S3 | Kategori | E — Üretim · izlenebilirlik (INV-SM-11) | Öncelik | P4 | Modül | KURŞUN/BYPASS | Kanıt seviyesi | **K2** |

**Özet.** "Dağıtım ön koşul DEĞİL" kararı (CLAUDE.md 2026-08-05/06) bilinçlidir ve kodda bir **sayaç** ile dengelenmiştir: *"dağıtılmadan kapanan her iş makine bazlı hacim raporunda ATIFSIZ kalıyor. Sayaç o kaybı görünür tutar; sahada sürekli oluyorsa cevap sayacı gizlemek değil, dağıtım adımını sorgulamaktır."* Ölçüm: sahada **sürekli oluyor** — dağıtım yolu toplam **2 kez** kullanılmış, bypass kapanışlarının **%98'i** atıfsız.

**Kanıt (veri, SAHA).**
```sql
SELECT count(*) toplam,
       count(*) FILTER (WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL) acik,
       count(*) FILTER (WHERE "machineId" IS NULL) makinesiz
FROM kursun_bypass_assignments;                                   -- 2 | 0 | 0
SELECT count(*) FILTER (WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:UNASSIGNED:%') unassigned,
       count(*) FILTER (WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:%') tum
FROM roll_movements;                                              -- 115 | 117
SELECT count(DISTINCT "workOrderStepId") adim, count(*) top FROM roll_movements
WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:UNASSIGNED:%'
  AND "exitedAt" >= (SELECT max("exitedAt") FROM roll_movements) - interval '7 days';  -- 81 | 88
```
Haftalık dağılım: 03.08 → 3 · 10.08 → 16 · 17.08 → 72 · 24.08 → 26 (toplam 117). Yani hacim artarken atıfsızlık **artıyor**, azalmıyor.
Karşılaştırma: `kursun_bypass_assignments` = 2 satır, ikisi de `completedVia = TAMBUR_SCAN`, ikisi de kapalı.

**failure_mode.** "Kurşun + KK2 makine bazlı hacim raporu" (planlamacı bandının kaynağı, `kursun-bypass.service.ts:660-687`) son 7 günde 81 adım / 88 topu `machineId = null` ile raporlar. "KK2-M1 bu hafta kaç metre işledi" sorusunun cevabı fiilen **yok**: iki makine (`KK2-M1`, `Kalite Kontrol - Makine 2`) tanımlı ama 88 topun hiçbiri onlara yazılmıyor. Makine bazlı verimlilik/arıza analizi yapılamaz; `Roll.createdMachineId` de yalnız KK1 (1228) ve Tambur (968) istasyonlarında dolu, Kurşun'da **0**.

**İş etkisi.** Kurşun istasyonunun makine bazlı üretim/kapasite raporu boş; bu istasyonda darboğaz analizi ve makine bakım planlaması veriye dayanamaz.

**Öneri (2. tur).** Kod değişikliği DEĞİL, **karar** gerekiyor ve iki şık var: ① dağıtım adımını sahada zorunlu kıl (bayrak `kursun.*` rejim anahtarı zaten var — **feature-flag DEĞİŞTİRME, karar ekibin**), ya da ② Tambur okutmasında makineyi **sor** (bypass kapanışında `machineId` uydurulmaz kuralı korunarak: operatöre "hangi makinede kurşunlandı" tek soru). ③ Hiçbiri seçilmezse "Kurşun makine bazlı hacim" raporunun başına ölçülen atıfsızlık oranı basılmalı — bugün rapor sessizce eksik.
**Kabul kriteri.** `UNASSIGNED` oranı raporun kendi yüzeyinde görünür; ya da oran %10'un altına iner.
**Efor.** ①/③ 0,5 gün · ② 2 gün (APK).
**Önceki defter.** Yok. İlgili: K10 INV-SM-11, CLAUDE.md 2026-08-05/06.

---

### [V-3-07] Parti numarası sarması artık istisna değil KURAL: 156 canlı partinin 122'si (61 numara) aynı plaka numarasını paylaşıyor
| Şiddet | S3 | Kategori | B.1 — Beklenen tekillik (bilinçli ihlalin ÖLÇÜLEN bedeli) | Öncelik | P4 | Modül | PARTİ | Kanıt seviyesi | **K2** |

**Özet.** `P01…P99` körlemesine sarma bilinçli bir karardır (CLAUDE.md 2026-08-05) ve gerekçesi "fabrikadaki numaralı fiziksel plaka düzeni"dir; kabul edilen bedel *"~5-10 gün arayla çakışma"* diye yazılmıştı. Ölçüm: çakışma **aralığı** tahmini doğruluyor (8-12 gün) ama **kapsamı** doğrulamıyor — canlı partilerin %78'i bir ikizle aynı numarayı taşıyor. Yani plaka numarası bugün **hiçbir zaman** tek başına parti belirtmiyor.

**Kanıt (veri, SAHA).**
```sql
WITH canli AS (
  SELECT b.id, b."batchNumber", b."createdAt" FROM batches b
  WHERE b."mergedIntoId" IS NULL
    AND EXISTS (SELECT 1 FROM rolls r WHERE r."batchId"=b.id
                AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SHIPPED'))
)
SELECT count(*) FROM canli;                                                  -- 156 canlı parti
SELECT count(*) cakisan_numara, min(gun), max(gun) FROM (
  SELECT "batchNumber", max("createdAt")::date - min("createdAt")::date gun
  FROM canli GROUP BY 1 HAVING count(*)>1) g;                                -- 61 | 8 gün | 12 gün
```
Örnek çiftler (ikisi de canlı topu olan): `P62` → IE1108260010 + IE2108260006 · `P90` → IE1308260007 + IE2508260002 · `P05` → IE0508260006 + IE1408260012.
Tarihsel toplam (K10 Q-PAR-01a ile tutarlı): 92 mükerrer grup / 184 satır. Sayaç durumu sağlıklı: son kısa parti `P92` (25.08 13:54), sıra kopukluğu **0**.

**failure_mode.** Ustabaşı arabadaki plakada `P62` okur ve sistemde arar. İki AÇIK parti döner: IE1108260010 (11.08) ve IE2108260006 (21.08), ikisinde de canlı top var, ikisi de aynı fabrikada. Numara ayırt etmediği için karar iş emri numarasına ya da kumaşa bakarak verilir — plakanın işlevi kaybolmuştur. Aynı belirsizlik refakat kartının canlı parti bloğuna (`resolveLiveBatches`) ve fason çeki listesine basılan `batchNumber`'a da geçer.

**İş etkisi.** Kâğıt üzerindeki parti numarası izlenebilirlik zincirinin bir halkasıdır; %78 çakışma o halkayı bilgi taşımaz hâle getiriyor. Karar bilinçliydi ama **kabul edilen bedelin büyüklüğü ölçülmemişti**; bu satır o ölçümdür.

**Öneri (2. tur).** Kod değişikliği değil, ölçüye dayalı yeniden karar: mevcut hız (~10 parti/gün) ile P01–P99 ~10 günde sarıyor, partiler ise 2+ hafta canlı kalıyor → tanım gereği her numara çakışıyor. Şıklar: ① aralığı genişlet (`P001…P999`; fiziksel plaka setinin genişletilmesi gerekir — fabrika kararı), ② plakayı iş emri numarasıyla eşle (parti no yerine İE son 4 hane), ③ olduğu gibi bırak ama **her parti arayan yüzeyde** "aynı numarada N açık parti var" bandını zorunlu kıl. Hiçbir şık migration istemez.
**Kabul kriteri.** Parti arama sonucunda birden çok açık parti dönerse yüzey bunu açıkça söyler; ya da canlı çakışma oranı %10'un altına iner.
**Efor.** ③ 0,5 gün · ①/② fabrika kararı.
**Önceki defter.** `BULGU-T1-150` ("`batchNumber` bilinçli tekil değil ama 'onunla lookup yapma' kuralının mekanik bekçisi yok") — bu bulgu ona **canlı çakışma oranı** kanıtını ekler.

---

### [V-3-08] §21 kapısı dev'de kalıcı kırmızı: fixture iş emirleri SUNUCU ÜRETİMİ İE numarası taşıdığı için `notFixture` ön-ek süzgeci onları ayıramıyor
| Şiddet | S4 | Kategori | K.1 — Bekçi kör noktası | Öncelik | P5 | Modül | WO / BEKÇİ | Kanıt seviyesi | **K2** |

**Özet.** `test_consistency*` ailesinin gürültü süzgeci `workOrderNumber NOT LIKE 'TEST-%'|'TST-%'|'DEMO-%'` üzerine kurulu (`test_consistency.ts:68-74`) ve gerekçesi *"üretim iş anahtarları asla bu ön ekleri taşımaz … canlı DB'de filtre hiçbir satırı elemez"*. Ama gerçek `create()` yolundan geçen fixture'lar numarayı **sunucudan** alır (`IE+GGAAYY+NNNN`) → süzgeç onları üretim sayar. Dev'de §21 bu yüzden iki satırla kırmızı.

**Kanıt (veri, DEV).** `consistency-check-derived.sql` §21:
```
IE2708260005 | ORDER_PRODUCTION | IN_PROGRESS | 0 bağ | 2026-08-27 12:32:05
IE2708260007 | ORDER_PRODUCTION | PLANNED     | 0 bağ | 2026-08-27 12:32:06
```
Her ikisi de `createdById NULL`, `clientToken NULL`, `targetItemId NULL`; audit'te aynı saniyelerde toplu `CREATE WORK_ORDER` + `CREATE BATCH` patlaması var (12:31:51 → 12:33:22 arası 10+ WO) → test koşumu. `create()` bu gövdeyi **reddeder** (`workorder.service.ts:759-763`, "Siparişe özel üretim iş emri en az bir sipariş kalemine bağlanmalıdır") ve `STOCK_PRODUCTION` için `targetItemId` zorunludur → satırlar ham Prisma yazımıyla ya da temizlikte `OrderLine` silinip pivotun `Cascade` düşmesiyle doğmuş (K10 §21'in yazılı gerekçesi: *"sipariş satırı silinince pivot Cascade düşer, tipe kimse dokunmaz"*).
SAHA'da §21 = **0** (prod'da OrderLine hard-delete yok).

**failure_mode.** Geliştirici `npm run test:consistency`'yi dev'de koşar, §21 iki satırla kırmızı verir; satırlar üretim formatlı olduğu için "fixture" diye elenemez ve her koşumda aynı kırmızıyı basar. İki hafta sonra gerçek bir tip↔bağ drift'i doğduğunda §21 "3 satır" der ve alışılmış kırmızıya bakan kimse farkı görmez — kapı fiilen kapanır (K2b'nin H-11 "kırmızı körlüğü" sınıfı).

**İş etkisi.** Doğrudan üretim etkisi yok; kaybedilen şey kapının kendisidir.
**Öneri (2. tur).** Süzgeci ön-ekten **kimliğe** taşı: fixture WO'ları `clientToken`/`createdById` boş + `parameters.__fixture` gibi bir damga taşısın, ya da testler `clean_test_residue`'a kendi ürettikleri İE numaralarını bildirsin. En ucuz ara adım: dev kalıntısını temizleyen script'e bu iki satırı ekle (dry-run).
**Kabul kriteri.** Dev'de `consistency-check-derived.sql` §21 = 0; negatif sonda: elle bir tip↔bağ drift'i üretilince kapı kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** `BULGU-T1-070` (dev DB'de 480 `TST-WHA` iş emri; `clean_test_residue` öneki tanımıyor) — aynı aile, farklı tezahür (orada önek VAR ama script tanımıyor, burada önek YOK).

---

### [V-3-09] İki fason kabulünde çekme sapması deftere HİÇ yazılmamış — fason karnesi o kabuller için %0 fire basıyor
| Şiddet | S4 | Kategori | E — Fason · sapma defteri (INV-FAS-06, INV-AUD-05) | Öncelik | P5 | Modül | FASON | Kanıt seviyesi | **K2** |

**Özet.** Çekme defteri (`RollVariance`, `source=SUBCONTRACTOR_RETURN`) 2026-08-21'de geldi. Ondan önceki iki kabulde giden↔dönen farkı var ve defter satırı yok; o kabuller **bugün de** fason karnesinde %0 fire olarak okunuyor (karne fireyi defterden okur — CLAUDE.md 2026-08-21 ④).

**Kanıt (veri, SAHA).**
```sql
SELECT sr."receiptNo", sr."receivedAt"::date, q.tuketilen, q.dogan, round(q.dogan-q.tuketilen,3) fark, q.defter
FROM ( SELECT sr2.id,
   (SELECT COALESCE(SUM(COALESCE(sri."receivedQty", sdi."dispatchedQty")),0)
      FROM subcontractor_receipt_items sri
      LEFT JOIN subcontractor_dispatch_items sdi ON sdi.id = sri."sourceDispatchItemId"
     WHERE sri."receiptId" = sr2.id) tuketilen,
   (SELECT COALESCE(SUM(c."initialQty"),0) FROM rolls c WHERE c."parentReceiptId" = sr2.id) dogan,
   EXISTS (SELECT 1 FROM roll_variances v WHERE v."sourceRefId" = sr2.id AND v."reversedAt" IS NULL) defter
  FROM subcontractor_receipts sr2 WHERE sr2."cancelledAt" IS NULL) q
JOIN subcontractor_receipts sr ON sr.id = q.id
WHERE abs(q.dogan - q.tuketilen) > 0.01;
```
| Makbuz | Tarih | Düşülen | Dönen | Fark | Defter |
|---|---|---|---|---|---|
| FK1908260001 | 2026-08-19 | 500,0 m | 388,0 m | **−112,0 m** (%22,4) | yok |
| FK1908260002 | 2026-08-19 | 471,0 m | 467,0 m | **−4,0 m** (%0,8) | yok |

Aynı sorgu 2026-08-21 ve sonrası için **0** satır (deploy sonrası kabullerde `dogan = tuketilen`). `roll_variances` tablosunda `source='SUBCONTRACTOR_RETURN'` **hiç satır yok** (SAHA); DEV'de 6 satır / 235 m var → kod çalışıyor, sahaya kadar tetiklenmemiş.

**failure_mode.** Fason karnesi 19.08 kabulünü %0 çekme ile raporlar; gerçekte o boyahane %22,4 çekmiştir. `fason.shrinkWarnEnabled` (varsayılan açık, tolerans %10) bu kabulde uyarı vermezdi çünkü mekanizma henüz yoktu — ama rakam bugün de düzelmiyor: dönem karşılaştırmasında Ağustos'un ilk yarısı yapay olarak "%0 fire" görünüyor ve firma performans kıyaslaması yanlış taraf lehine çıkıyor.

**İş etkisi.** Fason firma seçimi ve fiyat pazarlığı bu karneye dayanıyorsa 112 m'lik gerçek kayıp kayıtsız kalıyor.
**Öneri (2. tur).** İki şık: ① geriye dönük **tek seferlik** backfill (2 makbuz, `sourceRefId = receipt.id` ile aynı motor üzerinden — **[PROD'DA ÇALIŞTIRMA]** dry-run zorunlu; geri alma `reversedAt` ile mümkün, kayıt silinmez); ② düzeltme yerine karnede "defter öncesi dönem" eşiği (`SHRINK_LEDGER_SINCE`) göster — §26b'nin `PLAN_GATE_SINCE` deseninin ikizi. Şık ② daha güvenli ve aynı sorunun (kapı öncesi tarihsel kayıt) repoda kabul görmüş çözümü.
**Kabul kriteri.** Fason karnesi 2026-08-21 öncesi dönemi ayrı işaretler ya da iki defter satırı doğar; `test_scrap_scorecard.ts` eşik sondası ekler.
**Efor.** 0,5 gün.
**Önceki defter.** Yok.

---

### [V-3-10] Refakat kartı makinesi sahada karşılıksız: kart hiç OKUTULMUYOR, 213 kartın 149'u "bayat" işaretli ve bayrağı okuyan yüzey yok
| Şiddet | S4 | Kategori | L — Ölü/karşılıksız mekanizma | Öncelik | P5 | Modül | REFAKAT KARTI | Kanıt seviyesi | **K2** |

**Özet.** Kart mimarisi (sürüm, `contentDirty` bayat işareti, baskı defteri, okutma tetikleri) sahada karşılıksız kalıyor: kartın barkodu **hiçbir istasyonda okutulmuyor** ve bayatlık bayrağı kartların çoğunda açık.

**Kanıt (veri, SAHA).**
```sql
SELECT s."scanType", count(*), count(DISTINCT s."stationId") istasyon FROM traveler_card_scans s GROUP BY 1;
-- ARRIVAL 143 · DEPARTURE 195 · INFO 5 — hepsi TEK istasyonda
SELECT st.name, s."scanType", count(*) FROM traveler_card_scans s JOIN stations st ON st.id=s."stationId" GROUP BY 1,2;
-- Boyahane (Fason) | ARRIVAL 143 · DEPARTURE 195 · INFO 5   (başka istasyon YOK)
SELECT "contentDirty", count(*) FROM traveler_cards GROUP BY 1;   -- f:64 · t:149
```
`DEPARTURE 195` = fason sevk sayısı, `ARRIVAL 143` = fason makbuz sayısı → bu satırlar **fason akışının otomatik `logTravelerScan` kaydıdır** (`subcontractor.service.ts`), fiziksel okutma değil. Gerçek elle okutma yalnız `INFO` 5 satır (01.08–15.08). KK1 / Kurşun+KK2 / Tambur istasyonlarında kart okutması **0**.
Kart durumu: ACTIVE 85 (67 bayat) · COMPLETED 106 (79 bayat) · VOIDED 22 (3 bayat).

**failure_mode.** CLAUDE.md kartı *"fiziksel olarak malla birlikte hareket eder ve okutulduğunda istasyon süreçlerini tetikler"* diye tanımlıyor; veri bunun gerçekleşmediğini söylüyor. `contentDirty` bayrağı 213 kartın 149'unda açık ve hiçbir yüzey onu basmıyor (rozet 2026-08-06'da kaldırıldı) → bir gün tüketici eklenirse **kartların %70'i "bayat" diye kırmızı görünecek** ve uyarı ilk günden gürültü olacak.

**İş etkisi.** Doğrudan zarar yok; sürüm/revizyon makinesinin (V-3-04'ün koruduğu şey) iş değeri ölçülmemiş durumda.
**Öneri (2. tur).** Karar sorusu: kart okutması gerçekten isteniyor mu? İsteniyorsa istasyon ekranlarında okutma kapısı açılmalı; istenmiyorsa `contentDirty` + sürüm makinesi **yazılı olarak** "yalnız baskı defteri için" diye daraltılmalı ve fazla-işaretleme gürültüsü kabul edilmiş sayılmalı.
**Kabul kriteri.** Ya en az bir iç istasyonda kart okutma izi doğar, ya `contentDirty`'nin kapsamı belgeye bağlanır.
**Efor.** 0,5 gün (karar) · 3+ gün (okutma kapısı, APK).
**Önceki defter.** `BULGU-T1-164` (`contentDirty` ~20 yazma noktası, sıfır tüketici) — bu bulgu ona **oran** (149/213) ve **okutma ölçümü** kanıtını ekler.

---

## 2. Arandı, 0 — veri sağlık tablosu (alanın tamamı)

> "İhlal yok" da bir ölçümdür. Aşağıdaki her satır `audit/data/T2-V3-sweep.sql` / `sweep2.sql` içinde numarasıyla duruyor.

### 2.1 İş emri · adım · rota

| # | Kontrol | SAHA | DEV | Not |
|---|---|---|---|---|
| V3-01 | `type=ORDER_PRODUCTION` ama hiç sipariş bağı yok (canlı WO) | **0** | 2 | Dev = fixture (V-3-08) |
| V3-02 | `type=STOCK_PRODUCTION` ama bağ VAR (canlı WO) | **0** | 0 | Tip↔bağ aynası prod'da tutuyor |
| V3-02b | Terminal WO'da tip sapması | **0** | 0 | |
| V3-03 | `COMPLETED` WO ama ACTIVE/PENDING adım | **0** | 0 | |
| V3-04 | `CANCELLED/SUPERSEDED` WO ama adımlar SKIPPED değil | 3 (IE2207260003/4, IE2807260001 — Temmuz, kural 2026-08-05'te geldi) | 4 (3'ü fixture, 1'i SUPERSEDED = kural dışı) | K10 Q-SM-02b ile aynı; **bilgi** |
| V3-05 | Terminal WO adımında canlı top (`IN_PRODUCTION`/`AT_SUB`) | **0** | 0 | INV-STK-12 |
| V3-06 | PLANNED/IN_PROGRESS WO ama hiç canlı top yok | **0** | 685 (fixture) | Prod'da zombi WO yok |
| V3-07 | Adımsız WO (rota kurulmamış) | **0** | 644 (fixture) | |
| V3-08 | Adım sırası 1..n değil (boşluk/tekrar) | **0** | 0 | INV-WO-07 |
| V3-09 | COMPLETED adım `completedAt` NULL / ACTIVE adım `startedAt` NULL / PENDING ama `completedAt` dolu | **0/0/0** | 1/29/0 | Dev fixture |
| V3-22 | Hedef rengi olan canlı WO ama renk verebilen adım yok (rota kapsaması) | **0** | 0 | Uyarı rejimi sonrası kapsamasız WO YOK |
| V3-23 | Hedef özelliği olan canlı WO ama o özelliği veren adım yok | **0** | 0 | |
| V3-34 | Fason (EXTERNAL) adım ama firma da kategori de NULL | **1** (IE2508260001) | 53 (fixture) | → **V-3-01** |
| V3-35 | Aktif rota adım sırası 1..n değil / istasyonu pasif | **0/0** | 0/0 | |
| V3-36 | `workOrderNumber` biçim dışı | **0**/213 | 571/762 (fixture) | INV-DOC-01 |
| V3-37 | WO `clientToken` mükerrer | **0** (213/213 tekil) | 0 | |
| V3-38 | Giriş noktası kuralı — aşağıdan katılan top yukarı adımı bekletiyor mu | **0 sapma** | — | Kural çalışıyor; §20 ile birlikte doğrulandı |
| V3-41 | `WorkOrderStep.stepData` dolu | **0/635** | — | Ölü kolon (K2a H10 ile aynı) |
| V3-42 | `WorkOrderToOrderLine.allocatedQty` ≠ 0 | **0/140** | — | Ölü kolon (K2a) |
| V3-43 | Rota şablonu ↔ canlı WO adım sayısı farkı | **0** | — | Şablon düzenlemesi mevcut WO'ları etkilememiş |
| V3-47 | Canlı WO pasif `FabricProperty`'ye bağlı | **0** | — | |
| V3-48 | Canlı WO pasif/tombstone kumaş ya da renge bağlı | **0/0** | — | |
| V3-58 | Aynı WO'da aynı istasyon iki kez | 2 (IE2807260005/2 · Tambur ×2) | — | Rota tekrarı meşru — **bilgi** |
| §20 | Adım durumu ↔ türetilen değer | **1** | 0 | → **V-3-05** |
| §22 | IN_PROGRESS ama tüm adımlar bitmiş | **0** | 0 | |

### 2.2 Fason

| # | Kontrol | SAHA | DEV | Not |
|---|---|---|---|---|
| V3-10 | Açık sevk kalemi var ama top `AT_SUBCONTRACTOR` değil | **0** | 0 | `OPEN_OUTSTANDING` dörtlüsünün veri ikizi |
| V3-11 | Kalem kapalı (aktif TAM makbuz) ama top hâlâ fasonda | **0** | 0 | |
| V3-12 | Aktif makbuzların `receivedQty` toplamı > `dispatchedQty` | **0** | 0 | INV-FAS-03 |
| V3-13 | Bir kaleme birden çok aktif TAM makbuz satırı | **0** | 0 | |
| V3-16 | `remainderClosedAt` damgalı kalem ama top `SUBCONTRACTOR_CONSUMED` değil | **0** | 0 | INV-FAS-08 |
| V3-17 | İptal edilmiş sevkin kalemi ama top hâlâ `AT_SUBCONTRACTOR` | **0** | 0 | |
| V3-18 | İptal edilmiş makbuzdan doğan çocuk toplar hâlâ canlı | **0** | 0 | |
| V3-19 | Çekme farkı var ama defter satırı yok | **2** (19.08 öncesi) | 40 (fixture) | → **V-3-09** |
| V3-20 | Sevkin partisi başka iş emrine ait / parti NULL | **0** | 0 | INV-FAS-08 (`FOREIGN_BATCH`) |
| V3-21 | `dispatchWithoutColor` bayrağı sahada kullanılmış mı | **0/635 adım · 0/7 rota adımı** | 0/293 · 0/10 | CLAUDE.md 2026-08-25'in "623 adımda 0 işaret" ölçümü **hâlâ 0** — 7 katmanlı düzeltme sahada henüz test edilmemiş |
| V3-50 | Makbuz adımı ≠ sevk adımı | **0** | — | |
| V3-51 | Makbuz WO'su ≠ sevk WO'su | **0** | — | |
| V3-52 | `sourceDispatchItemId` NULL kalem (açık-sevk guard'ını kaçırır) | **0/638** | — | Prod'da her kalem kaynağına bağlı |
| V3-49 | Pasif/tombstone fason firmaya açık sevk | **0** | — | |
| V3-40 | `FS`/`FK` belge no biçim dışı · günlük sayaç boşluğu | **0 / 0** | — | INV-DOC-01/02 |
| §14 | Tüketilmiş fason topunun makbuzundan çocuk doğmamış | **0** | — | |
| §15 | `AT_SUBCONTRACTOR` top ama açık fason sevk kaydı yok | **0** (188 top) | — | INV-FAS-01 |
| §24a/§24b | Kalem yeniden açık / doğrudan sevk edilmiş top hâlâ fasonda | **0/0** | 0/0 | |
| V3-14 | `receivedQty` NULL dağılımı | 635/637 (TAM kabul) · 1/1 kısmi dolu | 22/22 | Tasarım gereği; rapor `COALESCE`'a bağımlı — **bilgi**, K2a ile aynı |
| V3-15 | Makbuz `clientToken` doluluğu | **2/143** | 0/52 | → **V-3-02** |

### 2.3 Parti · refakat kartı · bypass · kartela · makine

| # | Kontrol | SAHA | DEV | Not |
|---|---|---|---|---|
| V3-24 | WO başına kart sayısı ≠ 1 | **0** | 658 (fixture, 2026-07-14 öncesi + test) | INV-WO-05 |
| V3-25 | Kart durumu ≠ WO durumu | **0** | 0 | INV-WO-06 |
| V3-26 | Kart sürümü < defter max / defter satır sayısı ≠ max | 2 (IE1408260001, IE2108260004 — v2 kartın v1 defter satırı yok, defter 18.08'de başladı) | 0 | **bilgi** |
| V3-26b | `printedAt` dolu ama defter satırı yok | 153/213 (defter 18.08'de başladı; 18.08 SONRASI **6**) | 91/91 | → **V-3-03** |
| V3-27 | Kart `snapshot` NULL | **0** | 13 | Prod temiz |
| V3-28 | WO'suz parti | **0/198** | 0/599 | |
| V3-29 | Canlı topu olmayan parti ama WO açık | **0** | 508 (fixture) | |
| V3-30 | Kısa parti sayacı kopuk | **0** | — | INV-PAR-02 (son: P92, 25.08) |
| V3-30b | Aynı anda canlı aynı numaralı parti | **61 numara / 122 parti** | 0 | → **V-3-07** (bilinçli kararın ölçülen bedeli) |
| V3-54 | Aynı WO'da aynı numaralı iki parti | **0** | — | |
| V3-55 | Topun partisi ≠ topun adımının WO'su | **0** | 0 | INV-PAR-03 |
| V3-31 | Bypass ataması: toplam / açık / makinesiz | 2 / 0 / 0 | 6 / 5 / 0 | `UNASSIGNED` marker 115/117 → **V-3-06** |
| V3-53 | Açık bypass ataması ama adım COMPLETED/SKIPPED | **0** | — | |
| §23 | Açık bypass ama sahibi WO terminal | **0** | 0 | INV-SM-11 |
| V3-32 | `AT_KARTELA` top ama açık kartela sevki yok | **0** (kartela akışı sahada **hiç kullanılmamış**: 0 sevk, 0 swatch) | 6 sevk | |
| V3-32b | `KARTELA_CONSUMED` top ama makbuz izi yok · negatif swatch sayacı | **0 / 0** | 0 / 0 | |
| V3-33 | `createdMachineId` doluluk · istasyon dağılımı | 2196/2431; KK1 1228 · Tambur 968 · **Kurşun 0** | 130/296 | Kurşun'da makine atfı yok → V-3-06 |
| V3-33b | Son 30 günde pasif makineye bağlı yeni top | **0** (10 top var ama hepsi makinenin pasifleştirildiği 24.08 19:32'den ÖNCE) | 0 | Pasif makine `Test-Makine-1` — temizlenmemiş test kalıntısı (hijyen notu) |
| V3-44/45 | Kart okutma dağılımı · adımsız okutma | 343 okutma / 0 adımsız — **hepsi tek istasyonda** | — | → **V-3-10** |
| V3-46 | `subcontractor_receipt_properties` | 138 satır, yetim yok | — | |
| V3-56 | `WorkOrder.parameters.rework` taşıyan WO | 2/213 | — | Yeniden üretim akışı sahada 2 kez kullanılmış — **bilgi** |
| V3-57 | Kart `contentDirty` | 149 / 213 | — | → **V-3-10** |

---

## 3. Uygulanan kontrol listesi

`Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3, alanıma düşen maddeler (V-3 = veri merceğiyle E + C + B kesitleri):

| Madde | Durum |
|---|---|
| **A.1** Atomik claim / durum geçişi | **Uygulandı** — V-3-04 (kart sürümü claim'siz). Diğer WO/adım/fason geçişleri veri düzeyinde ihlalsiz (V3-03/04/05/10/11/16/17). |
| **A.2** Kayıp güncelleme (lost update) | **Uygulandı** — V-3-04. |
| **A.6** Belge no / sayaç | **Uygulandı** — İE/FS/FK biçim 0 sapma, günlük sayaç boşluğu 0 (V3-36, V3-40); parti sayacı kopuksuz (V3-30). |
| **B.1** Beklenen tekillik | **Uygulandı** — V-3-07 (parti no, bilinçli ihlalin ölçülen bedeli); WO `clientToken` 213/213 tekil; kart `workOrderId` unique tutuyor (V3-24 = 0). |
| **B.3** `clientToken` kapsaması ve replay davranışı | **Uygulandı** — V-3-02 (fason kabul). Kartela `dispatch`/`receive` token'sız (K1a H18) → sahada 0 kartela sevki olduğu için ölçülemedi, sınır ötesi nota taşındı. |
| **C** Denormalize alan mutabakatı | **Uygulandı** — `WorkOrderStep.status` (§20 → V-3-05), `WorkOrder.type` (§21 → V-3-08), `TravelerCard.version` ↔ `printed_documents` (V3-26), `SubcontractorDispatch.totalQty` (§19 = 0). |
| **C** Kolon semantiği | **Uygulandı** — V-3-03 (`printedAt` default'u), ölü kolonlar `stepData` / `allocatedQty` (sınır ötesi). |
| **C** Soft-delete / tombstone süzgeci | **Uygulandı** — V3-47/48/49 = 0 (pasif kumaş/renk/firma canlı WO'ya bağlı değil); parti tombstone'unda top yok. |
| **E** İş kuralı değişmezleri (K10 envanteri) | **Uygulandı** — INV-WO-01…13, INV-FAS-01…11, INV-PAR-01…06, INV-SM-03/06/07/09/11, INV-DOC-01/02/04 için veri sorgusu koşuldu; sonuçlar Bölüm 2'de. |
| **E** Giriş noktası kuralı | **Uygulandı** — V3-38 + §20; kural sahada çalışıyor, sapma 0. |
| **E** Rota kapsaması (uyarı rejimi sonrası) | **Uygulandı** — V3-22/23 = 0; "eksik rotayla WO açılabilir" kabul edilen riski sahada gerçekleşmemiş. |
| **G** Yetki | **Kapsam dışı** — V-4/G denetçisinin alanı; yalnız `roll:manual-adjust`/`workorder:write` gerektiren akışların veri izine bakıldı. |
| **H** Performans | **Kapsam dışı** — veri merceği; index/sorgu maliyeti H denetçisinde. |
| **I** Gözlemlenebilirlik | **Kısmen** — V-3-05 (mutabakat kapısının kırmızı körlüğü) ve V-3-01 (sessiz no-op'un hiçbir yerde raporlanmaması) bu maddeye de dokunuyor; audit kapsaması V-4'te. |
| **J** Migration | **Kısmen** — saha 190/195; alanımı ilgilendiren `20260825140000_reason_preset_rework_kind` prod'da **defter dışı uygulanmış** (aşağıda sınır ötesi). |
| **K** Bekçi kapsaması | **Uygulandı** — V-3-05 ve V-3-08 (kapı kırmızı körlüğü + fixture süzgeci); V-3-02'de bekçinin kuralı **ters** doğrulaması. |
| **L** Kod kalitesi / ölü mekanizma | **Uygulandı** — V-3-10. |
| **A.5** Çoklu instance | **Kapsam dışı** — tek process invariantı belgeli, veri merceğinde karşılığı yok. |
| **D** Tx sınırları | **Kısmen** — V-3-04'te "karar havuzda, yazım tx'te" ayrımı; tam envanter D denetçisinde. |
| **F** API sözleşmesi | **Kısmen** — V-3-01'de `message`/`warnings` kanalının istemcide okunmaması. |

---

## 4. Doğru yapılanlar (korunması gereken kalıplar)

1. **`fason-open-dispatch.helper.ts` tek-kaynak kuralı gerçekten tutuyor.** "Mal dışarıda" dörtlüsünün (iptal değil ∧ doğrudan-sevk değil ∧ `remainderClosedAt` NULL ∧ aktif TAM makbuz yok) veri ikizini (V3-10) ve simetriğini (V3-11) ayrı ayrı koştum: **ikisi de 0**. 195 sevk / 143 makbuz / 638 kalem hacminde tek bir "hem fasonda hem kabul edilmiş" satır yok. AST bekçisiyle kopyayı yasaklamak işe yaramış.
2. **Fason tam kabulünün çoklu claim'i (`count === len`) sahada hiç sızdırmamış.** §14 (tüketildi ama çocuk doğmadı), V3-16 (`remainderClosedAt` ↔ statü), V3-17 (iptal edilmiş sevkte fasonda kalan top), V3-18 (iptal edilmiş makbuzun canlı çocuğu) — dördü de 0. Kısmi kabul zincirinde de aşım (V3-12) ve çoklu TAM satır (V3-13) yok.
3. **`recomputeStepStatus`'un "giriş noktası" kuralı ölçülebilir biçimde çalışıyor.** 635 adımın 634'ünde kayıtlı değer türetilen değere **birebir** eşit. Aşağıdan katılan topları (fason dönüşü çocuğu, elle eklenen top) yukarı adımlar için bekleyen saymama kuralı sahada 30'dan fazla adımda devrede (V3-38) ve hiçbirinde adım geri düşmemiş.
4. **`inventory.softDelete`'in 2026-08-15 kapsam düzeltmesi (`collectRollStepScopeTx`) doğru teşhis edilmiş ve doğru yere konmuş.** Kod yorumu (`:3175-3193`) bozulan tek satırı iş anahtarıyla (`IE0608260004`/`T080826F0001`) anlatıyor; canlı veriden zinciri baştan kurduğumda hareket saatlerine kadar tuttu. Kök nedeni yoruma yazma disiplini bu denetimin en hızlı doğrulanan parçasıydı.
5. **`Electron/ReworkRollsDialog` fason firması eksikken kutuyu `disabled` yapıp sebebini yazıyor** (`:344-353`). Aynı kararın tablet ikizi eksik (V-3-01) — ama masaüstü tarafı, "load-bearing seçici" uyarısının nasıl uygulanması gerektiğinin doğru örneği.
6. **Belge numarası ailesi kusursuz:** İE/FS/FK/CV/SVK/SIP biçim dışı **0**, günlük sayaçta boşluk **0**, WO `clientToken` 213/213 tekil. `withBarcodeRetry` + `@unique` deseninin canlı kanıtı.

---

## 5. Sınır ötesi notlar

| Hedef alan | Gözlem | Kanıt |
|---|---|---|
| **J — Migration** | `20260825140000_reason_preset_rework_kind` SAHA'nın `_prisma_migrations` tablosunda **YOK**, ama `ReasonPresetKind` enum'ında `WORK_ORDER_REWORK` **VAR** ve 6 aktif `reason_presets` satırı taşıyor. Yani DDL defter dışı bir yoldan uygulanmış. Migration `ADD VALUE IF NOT EXISTS` olduğu için bir sonraki `migrate deploy` düşmez (risk düşük), ama "hangi migration'lar uygulandı" defterine güvenilemez. | `SELECT unnest(enum_range(NULL::"ReasonPresetKind"))` ↔ `_prisma_migrations`; K2b H-14 ile aynı gözlem, burada **veriyle** doğrulandı |
| **V-1 / I** | `consistency-check.sql` §12 ham dosyada **muaf listesi taşımıyor** → dosyayı elle koşan 15 satır görüp paniğe kapılır; muaf yalnız `test_consistency.ts:299-311`'de. Muaflar uygulanınca 0. Kapıların ham SQL ↔ TS ikizleri arasındaki bu asimetri (dosya kırmızı, bekçi yeşil) I/K alanına ait. | `data/T2-V3-consistency-saha.txt` §12 |
| **C** | `WorkOrderStep.stepData` 635/635 boş; `WorkOrderToOrderLine.allocatedQty` 140/140 = 0. İkisi de ölü kolon. | V3-41, V3-42 |
| **B / KARTELA** | Kartela akışı sahada **hiç kullanılmamış** (0 sevk, 0 makbuz, 0 swatch). K1a H18'in "kartela `dispatch`/`receive` `clientToken` YOK → mobil retry mükerrer sevk" riski bu yüzden veriyle **ölçülemedi**; kod düzeyinde açık kalıyor. | V3-32, V3-32b |
| **V-2 / SEVK** | `printed_documents` `TRAVELER_CARD` tipi `SELF_MANAGED_DOC_TYPES` içinde ve `upsert` ile yazılıyor; generic `freeze/reissue` kapalı. V-3-04'ün önerdiği claim, `printed-document.service`'in genel sürüm hesabına (K3b L4/L5) **dokunmamalı** — iki mekanizma bilerek ayrı. | `traveler-card.service.ts:443-462`, `printed-document.service.ts:169-172` |
| **K / hijyen** | SAHA'da `machines` tablosunda `Test-Makine-1` (`MAK0508260001`) hâlâ duruyor (24.08 19:32'de pasife alınmış) ve 10 gerçek topun `createdMachineId`'si ona işaret ediyor. Tur 1 çürütücüsünün hijyen notuyla aynı satır; burada **iş etkisi** de ölçüldü: o 10 top makine bazlı raporda "Test-Makine-1" altında sayılıyor. | V3-33b |
| **E / V-2** | Fason kabul `SubcontractorReceiptItem.newRollId` adı yanıltıcı: şema yorumu (`schema.prisma:3565`) "kabul edilen **orijinal** top" diyor, ad "yeni top" diyor. Doğan çocuklar yalnız `rolls.parentReceiptId` üzerinden bulunuyor. Bu isim, çekme/karne sorgularını yazan herkesi bir kez yanıltıyor (beni de yanılttı — ilk V3-19 koşumumda 3 sahte satır üretti). | `schema.prisma:3562-3595` |
| **F** | `workorder.service.quickStart` `dispatchWarning`'i `message`'a **ekliyor** (`:1459`), `warnings` dizisine değil; `create`'in kapsama uyarıları ise `warnings`'e gidiyor (`:1464`). İki uyarı, iki kanal, istemcide okunan **hiçbiri**. Kanal birleştirme F alanına ait. | `workorder.service.ts:1453-1465` |

---

## 6. Kapsanmayan / erişilemeyen

1. **Canlı prod.** Yalnız 2026-08-25 kopyası var; 25.08 sonrası (3 gün) veri görülmedi. V-3-01'in stranded topu bu sürede elle sevk edilmiş olabilir — **bulgunun kendisi** (sessizlik) o durumda da geçerli kalır, yalnız "3 gündür duruyor" cümlesi doğrulanamaz.
2. **Saha kopyasında 5 migration eksik** (`reason_preset_rework_kind` hariç — o defter dışı uygulanmış): `orders_active_created_at_idx`, `reason_preset_order_cancel_kind`, `order_cancel_reason`, `order_line_cancel`. Bunlar V-2'nin alanı; sipariş↔WO bağı sorgularımda `OrderLine.cancelledAt` kolonu YOK olduğu için "iptal edilmiş kaleme bağlı canlı WO" kontrolü **yalnız dev'de** yapılabildi ve dev fixture gürültüsü nedeniyle sonuç güvenilir değil.
3. **INV-FAS-07 (makbuz iptali LIFO)** veriyle ölçülemedi: "iptal anı" ile "sonraki makbuzun doğuşu" arasındaki tarihsel sıra `subcontractor_receipts` üzerinden yeniden kurulamıyor (`cancelledAt` var, ama iptal edilen makbuzun o an en yenisi olup olmadığı geriye dönük hesaplanamaz). SAHA'da iptal edilmiş makbuz **0** olduğu için konu bugün boş. K10 da aynı sonuca varmış.
4. **INV-PAR-05 (fason dönüşü parti kalıtımı)** aynı sebeple ölçülemedi ("hangi teslimat kaçıncı" bilgisi tarihsel sıra ister). Kısmi kabul sahada 1 kalem olduğu için örneklem yok.
5. **Refakat kartı şablonu (`traveler_card_templates`) 0 satır** — üç kademeli şablon yolunun (BUILTIN/SECTIONS/RAW_HTML) hiçbiri sahada kullanılmamış; `RAW_HTML` sanitizasyonu ve fail-closed davranışı veriyle sınanamadı (G alanına da dokunur).
6. **Repro (K3) yapılmadı** — V-3 görev tanımı `repro: false`. V-3-02 ve V-3-04 eşzamanlılık bulgularının paralel sondası 3. tura bırakıldı; ikisi de dev DB'de N=2 ile ölçülebilir (`audit/repro/_REPRO-SOZLESMESI.md`).
7. **`dispatchWithoutColor` yedi katmanlı düzeltmesi** sahada hiç tetiklenmemiş (0/635 adım, 0/7 rota adımı) → düzeltmenin doğruluğu veriyle sınanamadı; yalnız `test_dispatch_without_color` metin taramasına güveniliyor.
8. **Feature-flag'lere dokunulmadı.** V-3-06'nın önerdiği "dağıtımı zorunlu kıl" şıkkı `kursun.*` rejim anahtarını değiştirmeyi gerektirir — **karar ekibindir**, denetim değiştirmedi.
