# D-L — Kod kalitesi & hesap tekrarı (② BULMA, TUR 1)

**Denetçi:** D-L · **Mercek:** kod merkezli (aynı hesabın kopyaları · katman/bounded-context · OCP kayıt defteri · helpers · ölü kod · yorum↔kod)
**Kapsam:** `Teks-Erp/src` (367 ts / ~136k satır), `prisma/`, `scripts/` (bekçi kapsamı için), `.github/workflows/ci.yml`, `eslint.config.mjs`, `tsconfig.json`
**Veri:** `tekserp_saha_0825` (prod kopyası, 2026-08-25, salt-okunur) + `adnansahin_db` (dev). Salt-okunur; hiçbir dosya değiştirilmedi.
**Prompt Bölüm 3-L** + beceri §7 (7.1 katman · 7.2 bounded context · 7.5 helpers · 7.6 OCP · 7.7 DIP) uygulandı; §9 yanlış pozitif kataloğu bir satır yazılmadan önce okundu.

Ölçüm araçları (bu turda KOŞULDU):
- `node <scratchpad>/scc.mjs src` → `dosya=365 value-kenar=1394 type-kenar=97 · VALUE SCC = 0`
- `node <scratchpad>/limit-probe.cjs` → gövde limiti istifleme sondası (D-L-05 kanıtı)
- `audit/tools/sql-saha.sh` / `sql-dev.sh` (8 ölçüm sorgusu)

---

## Bulgular

### [D-L-01] Sevk & Termin Karnesi'nin BAŞLIK metrajı brüt, GÜNLÜK SERİSİ net — aynı ekranda iki farklı sevk rakamı

| Şiddet | S2 | Kategori | L (kopya hesap) | Öncelik | P1 | Modül | RAPOR/SEVK | Kanıt seviyesi | **K2** |

**Özet.** Karnenin üst rakamı ("Dönemde sevk edilen metraj") `reports/_shipped.collectShipped` üzerinden **BRÜT** okunur (iade geri-eklemesi + doğrudan sevkler dahil — kök CLAUDE.md 2026-08-09'un "TEK tanım" kuralı). Aynı servisin **aynı yanıtında** dönen günlük çubuk serisi ise elle yazılmış ayrı bir SQL'dir ve **NET** okur: iade geri-ekleme YOK, `direct_shipments` YOK. Kullanıcı bir üstteki sayıyı gördüğü ekranda çubukları toplayınca farklı bir rakam bulur ve hiçbir yerde açıklaması yoktur.

**Kanıt**
- `Teks-Erp/src/services/reports/shipment-scorecard.report.service.ts:128` → `collectShipped(range)` (BRÜT tanım)
- `Teks-Erp/src/services/reports/shipment-scorecard.report.service.ts:130-137` (günlük seri, NET):
```sql
SELECT ${factoryDaySql('s."dispatchedAt"')} AS day,
       SUM(r."currentQty")::float           AS qty
FROM shipments s JOIN rolls r ON r."shipmentId" = s.id
WHERE s.status = 'DISPATCHED'
  AND s."dispatchedAt" >= ${range.from} AND s."dispatchedAt" <= ${range.to}
GROUP BY 1 ORDER BY 1
```
- `:178` `shippedQty: round1(shippedQty)` (brüt) ↔ `:197-200` `daily: dailyRows.map(...)` (net) — TEK yanıt nesnesi.
- Brüt tanımın üç parçası `reports/_shipped.ts:70-99` (`rolls` ∪ `roll_returns` geri-ekleme ∪ `direct_shipments` + mutabakat satırı).
- **Koruma yok teyidi:** `scripts/test_shipment_scorecard.ts` yalnız özet eşitliğini ölçüyor (K7b §9: "daily kapsam dışı"); `_shipped.ts`i kullanan tüketici sayısı 2 (`shipment-scorecard` özeti + `return-scorecard` paydası), günlük seri o listede yok.

**failure_mode.** Ağustos 2026 dönemi seçilir → başlık **27.371,800 m**, günlük çubukların toplamı **27.159,800 m**; 212 m'lik fark yalnız iade edilmiş toplardan geliyor ve hiçbir yerde yazmıyor. Muhasebeci/planlamacı çubukları toplayıp "sistem 212 m eksik gösteriyor" der.

**Veride fiili ihlal (K2)** — `sql-saha.sh` (prod kopyası):
```sql
-- brüt (özet) vs net (günlük seri), 2026-08
27371.800 | 27159.800 | fark 212.000
-- iade satırı dağılımı: 2026-07 → 1 satır/49 m · 2026-08 → 4 satır/212 m
```
`direct_shipments` prod'da 0 (o kanal bugün fark üretmiyor; iade kanalı üretiyor).

**İş etkisi.** Sevk raporunun iki rakamı çelişiyor; iade hacmi arttıkça fark büyür. Kimse hata görmez (sessiz).
**Öneri (2. tur).** Günlük seriyi `_shipped.ts` içine taşı (`collectShippedDaily`) ve karneyi ondan besle; bekçiye `Σdaily === summary.shippedQty` iddiası ekle (iadeli fixture ile negatif sonda).
**Kabul kriteri.** İadeli bir dönemde `Σ daily.qty === summary.shippedQty`; bekçi iade satırı silinince kırmızı.
**Efor.** 0,5 gün. **Önceki defter:** `F-SEV-DOG-001` (bilgi/açık — K12: "brüt tek tanım dışında 5 rapor"); bu bulgu o ölçümün SOMUT tezahürü.

---

### [D-L-02] Parti İzleme "hangi müşteriye gitti" listesi sevkiyat statüsünü süzmüyor — henüz çıkmamış (PLANNED) mal "sevk edildi" görünüyor

| Şiddet | S2 | Kategori | L (kopya hesap) + A.1 | Öncelik | P2 | Modül | RAPOR/PARTİ | Kanıt seviyesi | **K2** |

**Özet.** `getBatchTrace`'in müşteri geri-izleme sorgusu `rolls → shipments` join'ini **statü süzgeci olmadan** kurar. Aynı repodaki diğer altı sevk yüzeyinin hepsi `status = 'DISPATCHED'` şartını taşır (`_shipped.ts:67`, `shipment-scorecard:134`, `attachTotals`, muhasebe bandı, belge yolu). Sonuç: yalnız PLANLANMIŞ, henüz binadan çıkmamış bir sevkiyattaki toplar parti izlemede "şu müşteriye gitti" satırı üretir.

**Kanıt**
- `Teks-Erp/src/services/reports/batch-trace.report.service.ts:152-156`:
```sql
WITH links AS (
  SELECT s.id AS shipment_id, s."customerId", s."dispatchedAt", r.id AS roll_id, r."currentQty" AS qty
  FROM rolls r JOIN shipments s ON s.id = r."shipmentId"
  WHERE r."batchId" = ${batchId}::uuid
  UNION ...
```
  — `s.status` hiç geçmiyor (`:152-172` tamamı okundu).
- Karşı örnek (aynı soru, süzgeçli): `reports/_shipped.ts:67` `WHERE status = 'DISPATCHED'` + o satırın üstündeki not ("status süzgeci İKİNCİ SAVUNMA HATTIDIR").
- **Koruma yok teyidi:** `lastDispatchedAt` `MAX(s."dispatchedAt")` — PLANNED'da NULL, yani satır "sevk tarihi boş" olarak çizilir ama metraj/adet sütunları dolu; istemciye "bu satır henüz çıkmadı" diyen bir alan dönmüyor.

**failure_mode.** Prod kopyasında parti **P98**: 12 top / **441,300 m** `WAREHOUSE` statüsünde ve PLANNED bir sevkiyata bağlı. Parti izleme ekranı o partiyi sorgulayınca "müşteri X — 12 top, 441,3 m, sevk tarihi —" satırını basar. Şikâyet araştırmasında (partinin nereye gittiği) operatör malı müşteride sanır; mal depoda durmaktadır.

**Veride fiili ihlal (K2)** — `sql-saha.sh`:
```sql
SELECT s.status, r.status, count(*), sum(r."currentQty")
FROM rolls r JOIN shipments s ON s.id = r."shipmentId" GROUP BY 1,2;
PLANNED    | WAREHOUSE | 12  | 441.300     ← hatalı sayılan küme
DISPATCHED | SHIPPED   | 689 | 27611.800
```
Bu 12 topun tamamı tek partiye (P98) ve tek müşteriye bağlı.

**İş etkisi.** Şikâyet/izlenebilirlik ekranında yanlış müşteri atfı; ayrıca metraj toplamı şişer.
**Öneri (2. tur).** `links` CTE'sine `AND s.status = 'DISPATCHED'` ekle **veya** satıra `dispatched: boolean` alanı koyup istemciye "hazırlanıyor" rozeti bastır (ikinci seçenek bilgi kaybetmez). Kararı iş sahibi versin; kod tarafı tek satır.
**Kabul kriteri.** PLANNED sevkiyata bağlı topu olan bir parti için `getBatchTrace().customers` ya satır üretmez ya da `dispatched:false` işaretler; bekçi PLANNED fixture'ıyla kırmızı verir.
**Efor.** 0,5 gün. **Önceki defter:** ilgili — `F-SEV-DOG-001` kapsam büyümesi (K12 satır 44).

---

### [D-L-03] "Üretim çıktısı" İKİ ayrı statü listesiyle tanımlı — iptal edilen Tambur çocuğunun metrajı sonsuza dek "üretimde" kalıyor

| Şiddet | S2 | Kategori | L (kopya hesap) | Öncelik | P1 | Modül | ÜRETİM/DENGE | Kanıt seviyesi | **K2** |

**Özet.** Aynı soru ("bu iş emri ne kadar çıktı verdi") iki farklı yerde iki farklı statü kümesiyle cevaplanıyor. İş emri listesi/detayı `producedOutputWhere` kullanır (6 statü + `TAMBUR_SPLIT` dalında **statü süzgeci YOK**); Ürün Dengesi ve sipariş kapsama paneli `computeWoMaterial` → `FINISHED_OUTPUT` kullanır (**4 statü**). Fark kümesindeki her top `inFlight = committed − finished` hesabında **kalıcı olarak "üretimde"** sayılır.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:1690-1717` `producedOutputWhere` — SPLIT dalı statüsüz; SPLIT-olmayan dal `[WAREHOUSE, A1_STOCK, SCRAP, SHIPPED, AT_KARTELA, KARTELA_CONSUMED]`.
- `Teks-Erp/src/services/helpers/coverage.helper.ts:34-39`:
```ts
const FINISHED_OUTPUT: RollStatus[] = [
  RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.SHIPPED, RollStatus.SCRAP,
];
```
- Tüketiciler: `production-balance.service.ts:302-314` (`acc.uretimde`), `order.service.ts:1378-1385` ve `:1510-1521` (`inProduction` → `netGap` düşümü).
- **Koruma yok teyidi:** iki liste arasında hiçbir bekçi karşılaştırması yok (`grep -rn "FINISHED_OUTPUT" src` → yalnız tanım + kullanım; `scripts/` içinde 0 atıf). `producedOutputWhere` private, dışarıdan kıyaslanamıyor.

**failure_mode.** 1.000 m ham top bir iş emrine girer (committed=1.000). Tambur 3 parça keser; operatör 698,9 m'lik parçaları "hatalı kayıt" diye **iptal** eder (`CANCELLED`). `finished` bu parçaları saymaz → Ürün Dengesi o spec için sonsuza dek **"üretimde 698,9 m"** basar ve `netGap = istenen − sevk − depo − üretimde` hesabından o kadar metre **düşülür**: 700 m'lik gerçek talep ekranda 1,1 m açık görünür ve planlamacı yeni iş emri açmaz.

**Veride fiili ihlal (K2)** — `sql-saha.sh`:
```sql
-- AÇIK (PLANNED/IN_PROGRESS) WO'larda: üretilmiş ama finished sayılmayan toplar
IE0708260006 | IN_PROGRESS | TAMBUR_SPLIT | CANCELLED |  9 | 698.900
IE0808260001 | IN_PROGRESS | TAMBUR_SPLIT | CANCELLED | 15 | 545.000
IE0508260004 | IN_PROGRESS | TAMBUR_SPLIT | CANCELLED |  7 | 263.000
                                            TOPLAM: 31 top / 1.506,900 m
```
Aynı kökün ikinci tezahürü (bugün ekrana çıkmıyor, `LIVE_WO` süzgeci sayesinde): COMPLETED iş emirlerinde `committed − finished > 0` olan **44 WO / 5.148,000 m** (ör. `IE1508260003` 2.000/0, `IE2007260001` 1.150/452 — 698 m'si iptal TAMBUR_SPLIT çocuğu).
`AT_KARTELA`/`KARTELA_CONSUMED` üretilmiş top prod'da 0 (kartela akışı kullanılmamış) — o dal bugün fark üretmiyor, ama tanım farkı duruyor.

**İş etkisi.** Ürün Dengesi ve sipariş kapsama panelinde şişmiş "üretimde" → gerçek açık talebin gizlenmesi (eksik üretim emri).
**Öneri (2. tur).** "Üretim çıktısı" tanımını TEK yere al (`helpers/produced-output.helper.ts`): `producedOutputWhere` ve `FINISHED_OUTPUT` aynı statü listesinden türesin; iptal/kartela ayrımı gerekiyorsa AÇIK bir parametre olsun (`{ includeRetired }`). Ayrıca `inFlight` hesabına "iptal edilmiş çocuk metrajı" düşümü ekle. Migration gerekmez.
**Kabul kriteri.** Bir WO'nun tek Tambur çocuğu iptal edildiğinde `computeWoMaterial(...).finished` değişmez AMA `inFlight` artmaz; bekçi (yeni `test_wo_material_inflight`) iptal öncesi/sonrası inFlight eşitliğini ölçer, `FINISHED_OUTPUT`'a bir statü eklenince kırmızı verir.
**Efor.** 1,5 gün. **Önceki defter:** yok (K7a HOTSPOT #9 gözlemi bu turda ölçüldü).

---

### [D-L-04] Fason servisi `WorkOrderStep.status`'u sahibin kuralından FARKLI bir yüklemle yazıyor — fason adımına elle taşınmış top varken adım COMPLETED olur

| Şiddet | S2 | Kategori | beceri §7.2 (bounded context) | Öncelik | P2 | Modül | FASON/İŞ EMRİ | Kanıt seviyesi | **K1** |

**Özet.** `WorkOrderStep.status`'un sahibi `helpers/roll-step.helper.recomputeStepStatus`'tur ve adımı **açık hareketten** türetir (`openCount > 0 → ACTIVE`). `subcontractor.service` aynı alanı **yedi** noktada doğrudan yazar ve COMPLETED kararını tamamen farklı bir yüklemle verir: `AT_SUBCONTRACTOR` statüsünde top kalmadıysa adım kapalıdır. Bu iki yüklem, adımdaki topun statüsü `AT_SUBCONTRACTOR` DIŞINDA bir şey olduğunda ayrışır — ve tam bu durum belgeli bir özelliktir ("Fason adımına taşıma `AT_SUBCONTRACTOR` YAPMAZ: mal içeride üretimde bekler", kök CLAUDE.md 2026-07-30).

**Kanıt**
- Sahip kural: `Teks-Erp/src/services/helpers/roll-step.helper.ts:130-142` (`openCount > 0 → ACTIVE`; `closedCount>0 && pendingRolls===0 → COMPLETED`).
- Yabancı yazımlar: `Teks-Erp/src/services/subcontractor.service.ts:2952-2960` (`receive`), `:3470-3476` (`closeRemainder`), `:6171-6177` (`executeDirectShip`), ayrıca `:1108` (ACTIVE), `:2118/:2128` (COMPLETED/PENDING), `:6199` (SKIPPED):
```ts
const stillAtSubcontractor = await tx.roll.count({
  where: { currentStepId: data.stepId, status: RollStatus.AT_SUBCONTRACTOR },
});
if (stillAtSubcontractor === 0) {
  await tx.workOrderStep.update({ where: { id: step.id },
    data: { status: StepStatus.COMPLETED, completedAt: new Date() } });
}
```
- **Guard farkı teyidi (§7.2 üçüncü koşul):** `receive` kendi adımı için `recomputeStepStatus`'u **çağırmıyor** — `grep -n "recomputeStepStatus" src/services/subcontractor.service.ts` → `:3154` (yalnız **nextStep**), `:4862`, `:4996`, `:5475`, `:5477`. Yani sahip kuralın düzeltmesi bu yolda hiç koşmuyor.
- Kapanışı büyüten ikinci halka: `helpers/roll-step.helper.ts:193-201` `completeWorkOrderIfStepsDone` yalnız **adım statülerini** sayar, canlı top aramaz → adım yanlış COMPLETED olunca WO da COMPLETED olur.
- Erişilebilirlik: `workorder-manual-move.service.ts:598-606` topu `IN_PRODUCTION` + `currentStepId = hedef` yapar ve hedef fason adımı olabilir (`manualMoveWoBlockReason` fason adımını engellemiyor; CLAUDE.md o davranışı açıkça tarif ediyor).

**failure_mode.** Bir iş emrinde boyahane adımı var. A topu fasona sevk edilir (`AT_SUBCONTRACTOR`), B topu aynı adıma **"Konumu Düzelt"** ile elle taşınır (`IN_PRODUCTION`, açık hareket). A kabul edilir → `stillAtSubcontractor = 0` → adım **COMPLETED**, `completeWorkOrderIfStepsDone` son adımsa **WO COMPLETED**. B topu hâlâ `IN_PRODUCTION` + açık hareketiyle kapalı bir adımda asılıdır; kart okutma ve Tambur finalize guard'ları onu reddeder → tek çıkış `roll:manual-adjust` yetkisiyle "Kurtar". `recomputeStepStatus` aynı durumda adımı ACTIVE tutardı.

**Veride fiili ihlal (K2)** — arandı, **0**:
```sql
-- açık hareketi olan ama adımı COMPLETED/SKIPPED olan canlı toplar
SELECT ... FROM roll_movements m JOIN work_order_steps s ... WHERE m."exitedAt" IS NULL
  AND s.status IN ('COMPLETED','SKIPPED') AND r.status NOT IN (<ölü statüler>);
→ 0 satır (prod kopyası)
```
Yol açık ama sahada henüz tetiklenmemiş (elle taşıma + fason adımı kombinasyonu nadir).

**İş etkisi.** Mal kapalı iş emrinde takılır; operatör okutamaz, vardiya durur; kurtarma süpervizör yetkisi ister.
**Öneri (2. tur).** `receive`/`closeRemainder`/`executeDirectShip`'in adım kapanışını `recomputeStepStatus(tx, stepId)` çağrısına çevir (fason-özel `stillAtSubcontractor` yalnız "fasondan dönüş tamamlandı mı" iş kararı için kalsın, adım statüsünü YAZMASIN). `completeWorkOrderIfStepsDone`'a "adımda canlı top yok" ön koşulu eklemek ikinci savunma hattı olur.
**Kabul kriteri.** Fason adımına elle taşınmış `IN_PRODUCTION` top varken kabul yapılınca adım ACTIVE kalır; yeni bekçi (`test_fason_step_status_owner`) `stillAtSubcontractor` dalını geri koyunca kırmızı verir.
**Efor.** 1 gün. **Önceki defter:** yok (K4 H1 gözlemi bu turda üç koşulla doğrulandı).

---

### [D-L-05] İçe aktarım ve yapılandırma paketi router'larındaki 10 MB gövde katmanı ÖLÜ — global 1 MB parser önce koşuyor, 10.000 satırlık dosya 413 alıyor

| Şiddet | S2 | Kategori | beceri §7.1 (katman) + F | Öncelik | P1 | Modül | İÇE AKTARIM | Kanıt seviyesi | **K1 (çalıştırılmış sonda)** |

**Özet.** `app.ts` gövde ayrıştırıcısını **koşulsuz** olarak `/api` altındaki her şeyden önce mount ediyor (`limit: "1mb"`). `import.routes.ts` ve `config-bundle.routes.ts` kendi `express.json({ limit: "10mb" })` katmanlarını route satırında taşıyor — ama `body-parser` gövdeyi zaten **ilk** ayrıştırıcıda okuyup 1 MB'ı aşınca `entity.too.large` fırlatıyor; ikinci ayrıştırıcı `req._body` işaretli olduğu için hiç çalışmıyor. Üç ayrı yorum (app.ts + iki router başlığı) 10 MB'ın yürürlükte olduğunu söylüyor.

**Kanıt**
- `Teks-Erp/src/app.ts:141` `app.use(express.json({ limit: "1mb" }));` (koşulsuz, tüm yollar)
- `Teks-Erp/src/app.ts:546-550` — `/api/import` mount'u **:141'den sonra**; yorum: *"Bu router KENDİ `express.json({limit:"10mb"})` katmanını taşır (route seviyesinde) — global 1 MB limiti DEĞİŞMEZ"*
- `Teks-Erp/src/routes/import.routes.ts:15-18` (aynı iddia) · `:28` `const jsonBig = express.json({ limit: "10mb" });` · `:242` (`/preview`), `:279` (`/apply`)
- `Teks-Erp/src/routes/config-bundle.routes.ts:27` + `:133`, `:158` — birebir aynı desen
- Satır tavanı: `Teks-Erp/src/services/import/import-coerce.ts:127` `export const MAX_IMPORT_ROWS = 10000;`
- **Çalıştırılmış sonda** (repo'nun kendi `express` sürümüyle, scratchpad `limit-probe.cjs`):
```
gövde boyutu: 1.75 MB
HTTP 413 {"type":"entity.too.large","status":413}
```
  (aynı istifleme: global 1mb → route jsonBig 10mb → handler; handler'a HİÇ ulaşılmıyor)
- **Koruma yok teyidi:** `scripts/` altında gövde limitini ölçen bekçi yok (`grep -rn "10mb\|entity.too.large" scripts` → 0); CI import uçlarını gerçek payload'la çağırmıyor.

**failure_mode.** Kullanıcı Ayarlar → İçe Aktarım'dan 8.000 satırlık kumaş listesini yükler (JSON'a çevrilince ~1,4 MB). Sunucu `413` + Türkçe "İstek gövdesi çok büyük" döner. Aynı hata `POST /api/config-bundle/apply`'da etiket şablonu (kanvas + gömülü görsel) taşıyan pakette de çıkar. Kod tabanındaki üç yorum "10 MB'a kadar sorun yok" dediği için teşhis yanlış yöne (istemci/ağ) gider.

**Veride fiili ihlal (K2)** — aranmadı; bu bir istek-yolu davranışı, veriye iz bırakmaz. `import_runs` tablosunda başarısız koşum kaydı da doğmaz (413 route'a girmeden döner).
**İş etkisi.** Belgelenen en büyük içe aktarım (10.000 satır) fiilen yapılamaz; sınır ~5-8 bin satır civarında sessizce ısırır.
**Öneri (2. tur).** Global parser'ı yol-koşullu yap: `app.use(/^\/api\/(import|config-bundle)(\/|$)/, jsonBig)` **mount'tan önce**, ya da `app.ts:141`'i `app.use((req,res,next) => req.path.startsWith("/api/import") || req.path.startsWith("/api/config-bundle") ? next() : jsonSmall(req,res,next))` biçiminde ayır. Router-içi `jsonBig` KALSIN (belge değeri). Bekçi: 2 MB gövdeyle `/api/import/:entity/preview` çağırıp 413 BEKLEMEYEN sonda.
**Kabul kriteri.** 2 MB'lık geçerli bir import gövdesi 413 almaz; diğer tüm uçlar 1 MB'da 413 vermeye devam eder (negatif sonda: `/api/rolls` 2 MB → 413).
**Efor.** 0,5 gün. **Önceki defter:** yok.

---

### [D-L-06] "Rota bu hedefi kapsıyor mu" sorusunun ÜÇ farklı cevabı var (400 / uyarı / 409) ve `goods` muafiyeti yalnız uyarı dalına uygulanmış

| Şiddet | S2 | Kategori | L (kopya hesap) + beceri §7.6 | Öncelik | P2 | Modül | İŞ EMRİ | Kanıt seviyesi | **K1** |

**Özet.** 2026-08-27 kararı ("kapsama artık REDDETMEZ, UYARIR — create · replace · Rengi Değiştir tek kural") **kategori düzeyindeki** kontrole uygulanmış; **özellik başına** kontrol üç yolda üç ayrı davranışta kalmış. Dahası, aynı kararla eklenen "mal zaten o nitelikte ise kontrol atlanır" muafiyeti (`goods`) yalnız uyarı üreten dalda hesaplanıyor; hâlâ 400 fırlatan dal muafiyeti **hiç okumuyor**.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:923-941` — muafiyet burada hesaplanıyor:
```ts
const propsAlreadyOnGoods = new Set(rollCount > 0
  ? targetPropertyIds.filter((pid) => goods!.propertyIdSets.every((set) => set.includes(pid))) : []);
const uncoveredProps = targetPropertyIds.filter((pid) => !propsAlreadyOnGoods.has(pid));
... collectRouteCoverageWarnings(finalSteps, { color: ..., property: uncoveredProps.length > 0 })
```
- `Teks-Erp/src/services/workorder.service.ts:953-969` — **aynı fonksiyonun 12 satır aşağısı**, muafiyet kullanılmıyor, hâlâ 400:
```ts
const uncoveredIds = targetPropertyIds.filter((pid) => !applicable.has(pid));   // ← goods YOK
if (uncoveredIds.length > 0) { ... throw AppError.badRequest(
  `Şu özelliği uygulayabilecek istasyon rotada yok: ${names}. ...`); }
```
- `Teks-Erp/src/services/workorder.service.ts:5201-5227` (`replace`) — aynı soru, **yalnız uyarı** (`replaceWarnings.push(...)`), throw yok; canlı toplardan muafiyet okuyor.
- `Teks-Erp/src/services/workorder.service.ts:5640-5645` (`updateTargetProperties`) — aynı soru, **409**: `"Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış."`
- Çağrı yolu: `quickStart` → `create(..., goods)` — `Teks-Erp/src/services/workorder.service.ts:1325-1328`.
- **Bayat yorum eşliği:** `Teks-Erp/src/services/helpers/workorder-target-color.helper.ts:39-41` hâlâ *"Açılışta aynı soru `assertRouteCoversTargets` ile 400 verir"* diyor; `assertRouteCoversTargets` **kodda yok** — sembol yalnız 3 yorumda geçiyor (`workorder.service.ts:659`, `:1267`, helper `:41`).

**failure_mode.** Tablette Hızlı İş Emri: dışarıdan **ZIMPARALI** gelen 3 top okutulur (üçünde de `RollProperty` ZIMPARALI var), hedef özellik ZIMPARALI seçilir, rota = Kurşun + Tambur (zımpara yapan istasyon yok). Renk tarafında muafiyet çalışır ve uyarı bile çıkmaz; özellik tarafında `create()` **400** verir → iş emri hiç açılamaz. Aynı iş emri masaüstünden `replace` ile aynı hedefle kaydedilse yalnız uyarı alır. Kullanıcı iki ekranda iki farklı cevap görür.

**Veride fiili ihlal (K2)** — arandı, tetiklenmemiş: `station_properties` prod'da doluysa da `SEMI_FINISHED` girişi 0 (kök CLAUDE.md 2026-08-26 ölçümü) → senaryo sahada henüz kurulmamış. Yol kod düzeyinde açık.
**İş etkisi.** Tam da 2026-08-27 kararının çözmeyi hedeflediği saha şikâyeti ("sipariş bağlarsam hata, siparişsiz açınca geçiyor") özellik ekseninde AÇIK kalmış.
**Öneri (2. tur).** Üç yolu tek yükleme indir (`collectRouteCoverageWarnings`'e özellik-başına dalı da al) ve `create`'in 400'ünü uyarıya çevir; muafiyeti tek yerde hesapla (`uncoveredProps`), her iki dal onu okusun. `updateTargetProperties`'in 409'u ayrı bir soru (adım tamamlanmış mı) — mesajı ikiye ayır.
**Kabul kriteri.** `create`/`replace`/`updateTargetProperties` aynı hedef+rota kombinasyonunda aynı sonucu verir; `test_wo_route_coverage_goods` özellik ekseni için de negatif sonda taşır (muafiyet kaldırılınca kırmızı).
**Efor.** 1 gün. **Önceki defter:** yok (kök CLAUDE.md 2026-08-27 "AÇIK: oluşturma↔düzenleme asimetrisi tam kapanmadı" notunun somut adresi).

---

### [D-L-07] "Fire" iki farklı kriterle sayılıyor — Fire Karnesi statüye, Kalite Karnesi kalite koduna bakıyor; aynı ay iki farklı fire rakamı

| Şiddet | S2 | Kategori | L (kopya hesap) | Öncelik | P2 | Modül | RAPOR/KALİTE | Kanıt seviyesi | **K2** |

**Özet.** Aynı evren (aynı `finalizedAt` penceresi, aynı `K18_DEAD_STATUSES` dışlaması) üzerinde iki karne "fire"yi farklı tanımlıyor: Fire Karnesi `rolls.status = 'SCRAP'` sayar, Kalite Karnesi `qualityGrade = 'FIRE'` kovasını sayar. 2026-08-20'de `FIRE.targetStatus = SCRAP` yapıldığı için ikisinin ÖRTÜŞMESİ bekleniyor; canlı veride örtüşmüyor.

**Kanıt**
- `Teks-Erp/src/services/reports/scrap-scorecard.report.service.ts:177-181` `WHERE r.status = 'SCRAP' AND r."finalizedAt" BETWEEN …` → `:343` `scrapQty` → `:369` `scrapPct: pctOf(scrapQty, produced)`
- `Teks-Erp/src/services/reports/quality-scorecard.report.service.ts:164-198` — kova anahtarı `r."qualityGradeId"` / `qg.code`; `:374` `g.pct = pctOf(g.qty, totalQty)`
- Payda ORTAK ve bekçili: `scrap-scorecard:199-209` `producedTotal` = kalite karnesi evreni (`test_scrap_scorecard:136-148`) — yani fark **yalnız payda değil, PAY tanımından** geliyor.
- Üçüncü ve dördüncü "fire": `workorder.service.ts:2209-2220` (`bucketOf` → `initialQty`), `subcontract-scorecard:221-230` (`(closedDispatched − returned)/closedDispatched`).
- **Koruma yok teyidi:** iki karneyi karşılaştıran bekçi yok; `test_quality_scorecard`/`test_scrap_scorecard` yalnız kendi içlerindeki toplamı ölçüyor.

**failure_mode.** 2026-08 dönemi seçilir:
- **Fire Karnesi:** `scrapQty = 0,000 m`, `scrapPct = %0` — çünkü tek `SCRAP` topun `finalizedAt`'i NULL (aşağıdaki K2).
- **Kalite Karnesi:** "FİRE" satırı **61,400 m / %0,111** (4 top) — çünkü o toplar `WAREHOUSE` statüsünde ama kalite kodu `FIRE`.
Yönetici iki ekranda "bu ay firemiz yok" ve "bu ay 61,4 m fire" cevaplarını birlikte alır; hangisinin doğru olduğunu söyleyen bir yer yok.

**Veride fiili ihlal (K2)** — `sql-saha.sh`:
```sql
SELECT status, COALESCE("qualityGrade",'(null)'), count(*), sum("currentQty")
FROM rolls WHERE status='SCRAP' OR "qualityGrade"='FIRE' GROUP BY 1,2;
STOCK     | FIRE   | 1 | 18.000
SCRAP     | (null) | 1 | 300.000     ← finalizedAt NULL → İKİ karnede de görünmez
CANCELLED | FIRE   | 2 |  5.300
WAREHOUSE | FIRE   | 4 | 61.400      ← SATILABİLİR rafta, "fire" kaliteli
-- 2026-08 evreni 55.275,600 m · kalite FİRE 61,400 (%0,111) · fire karnesi SCRAP 0,000 (%0)
```
Dev DB'de de aynı sınıf: `SCRAP|(null)` 2 top / 200 m, `WAREHOUSE|FIRE` 1 top / 2 m.

**İş etkisi.** Fire KPI'sı güvenilmez; ayrıca `WAREHOUSE` rafında 4 adet "FIRE" kaliteli top duruyor (sevk edilebilir) — bu ikinci gözlem D-E/D-C alanına devredildi (aşağıda).
**Öneri (2. tur).** "Fire" için TEK tanım dosyası (`reports/_scrap.ts`): kaynak `RollVariance kind=SCRAP` + `status=SCRAP` birleşimi mi, yoksa katalog `targetStatus=SCRAP` kalite kodu mu — iş sahibi seçsin; iki karne o tek fonksiyondan beslensin ve bekçi `scrapQty === qualityFireQty` iddiasını taşısın (bugün kırmızı olacak; "bilerek kırmızı" politikasıyla işaretlenebilir).
**Kabul kriteri.** İki karne aynı dönemde aynı fire metrajını basar; tanım değişirse tek dosyada değişir.
**Efor.** 1 gün (+ tanım kararı). **Önceki defter:** yok.

---

### [D-L-08] `specMatch` birebir kopyalanmış (`return.service`), kaynağı zaten export'lu ve bekçisi yok

| Şiddet | S3 | Kategori | L (kopya hesap) | Öncelik | P3 | Modül | İADE/SEVK | Kanıt seviyesi | K1 |

**Özet.** Sevk tahsisinin "bu top bu sipariş satırına uyar mı" yüklemi `helpers/allocation.helper.ts:36`'da **export** edilmiş ve `shipping.service` + `subcontractor.service` oradan import ediyor. `return.service.ts:51` aynı fonksiyonun **satır satır aynı** bir kopyasını private olarak taşıyor ve iade sipariş-atfı doğrulamasını onunla yapıyor.

**Kanıt**
- Kaynak: `Teks-Erp/src/services/helpers/allocation.helper.ts:36-51`
- Kopya: `Teks-Erp/src/services/return.service.ts:51-65` — gövde birebir aynı (`itemId` eşitliği · renk/en "ikisi de doluysa `Decimal.equals`").
- Kopyayı kullanan karar noktaları: `return.service.ts:162`, `:169`, `:292`, **`:428`** (`"Seçilen sipariş bu topun ürün/renk/en bilgisine uymuyor"` → 400).
- Kaynağı kullananlar: `shipping.service.ts:91`, `subcontractor.service.ts:85` (import).
- **Koruma yok teyidi:** `grep -rn "specMatch" scripts --include='*.ts'` → iki tanımın eşitliğini iddia eden bekçi yok; `test_fason_open_dispatch_single_source` benzeri bir AST kopya-yasağı bu fonksiyon için kurulmamış.
- `return.service` zaten `./helpers/shipment-locks.helper`'dan import ediyor (`:45`) — helper'a erişim engeli yok, kopya teknik zorunluluk değil.

**failure_mode.** K7a HOTSPOT #11 kararı uygulanır ve tahsis eşleşmesi sıkılaştırılır (ör. "renk null artık joker değil"): `allocation.helper.specMatch` güncellenir, `return.service`'inki eski gevşek kuralla kalır. Sonuç: sevk tahsisi bir topu A satırına yazamazken iade ekranı aynı topu A satırına **kabul eder**; `OrderLine.shippedQty` yanlış satırdan düşer ve o satır gerçekte olduğundan daha az sevk edilmiş görünür. Hiçbir hata mesajı çıkmaz.

**Veride fiili ihlal (K2)** — arandı, bugün ayrışma yok (iki gövde bayt bayt aynı; `roll_returns` prod'da 5 satır).
**İş etkisi.** Bugün sıfır; kural değiştiği gün sessiz yanlış atıf.
**Öneri (2. tur).** `return.service.ts:51-65`'i sil, `allocation.helper`'dan import et. İstenirse `test_fason_open_dispatch_single_source` deseninde küçük bir AST bekçisi ("`specMatch` adlı ikinci bir fonksiyon tanımı yasak").
**Kabul kriteri.** `grep -c "^function specMatch" src` → 0 (yalnız helper'da `export function`); `test_return_*` yeşil.
**Efor.** 0,25 gün. **Önceki defter:** yok.

---

### [D-L-09] Fason "açık kalem" kuralının tek kaynağı var ama iki ham SQL kopyası bekçinin KÖR NOKTASINDA

| Şiddet | S3 | Kategori | L (kopya hesap) + K (bekçi körlüğü) | Öncelik | P3 | Modül | FASON/RAPOR | Kanıt seviyesi | K1 |

**Özet.** 2026-08-21'de "fason açık+outstanding sevk" koşulu `helpers/fason-open-dispatch.helper.ts`'e tek kaynağa alındı ve elle kopya yazımı AST bekçisiyle yasaklandı. Bekçi **yalnız TypeScript nesne literallerini** tarıyor; aynı kuralın Fason Karnesi'ndeki **iki ham SQL kopyası** taramanın dışında.

**Kanıt**
- Tek kaynak: `Teks-Erp/src/services/helpers/fason-open-dispatch.helper.ts:48-64` (`OUTSTANDING_ITEM`, `OPEN_OUTSTANDING`)
- Ham SQL kopya 1 (kapanış ölçütü): `Teks-Erp/src/services/reports/subcontract-scorecard.report.service.ts:143-145` `BOOL_OR(NOT sri."isPartial")` + `:150` `remainderClosedAt`
- Ham SQL kopya 2 (açık liste): `Teks-Erp/src/services/reports/subcontract-scorecard.report.service.ts:280-292` — dört koşulun tamamı elle yazılmış (`cancelledAt IS NULL`, `directShippedAt IS NULL`, `remainderClosedAt IS NULL`, `NOT EXISTS(... NOT isPartial ...)`)
- **Bekçinin körlüğü ÖLÇÜLDÜ:** `Teks-Erp/scripts/test_fason_open_dispatch_single_source.ts:96-102, 133-160` — tarayıcı `ts.ObjectLiteralExpression` üzerinde çalışıyor (`soy()`/`ozellik()` AST yardımcıları, `nesneSayisi` zemini). Şablon literali içindeki SQL metni hiçbir kontrolden geçmiyor.

**failure_mode.** Kural değişir (ör. "iptal edilmiş makbuz kalemi ARTIK yeniden açmaz"): helper güncellenir, AST bekçisi **yeşil** kalır, karnenin iki SQL'i eski kuralı taşır. Fason Sevk ekranı bir sevki "kapalı" gösterirken Fason Karnesi'nin "açık bakiye" listesi aynı sevki hâlâ açık basar — ve fire yüzdesi (`closedDispatchedQty` paydası) o sevki hesaba katmaz.
**Veride fiili ihlal (K2)** — arandı: bugün iki kopya semantik olarak kaynakla AYNI (satır satır karşılaştırıldı) → 0 ayrışma.
**İş etkisi.** Bugün sıfır; kural değiştiği gün fason karnesi ile operasyon ekranı ayrışır.
**Öneri (2. tur).** Bekçiye ikinci bir tarama ekle: `reports/subcontract-scorecard` içindeki her `subcontractor_dispatch` / `subcontractor_dispatch_items` FROM/JOIN'inden sonra dört koşulun tamamının metinde geçtiğini iddia et (aktif-kalem bekçisinin `test_order_line_scope_single_source.ts:99-134` deseni). Ya da SQL'i `Prisma.sql` parçası hâline getirip helper'dan üret.
**Kabul kriteri.** `directShippedAt` koşulu SQL'den silinince bekçi kırmızı.
**Efor.** 0,5 gün. **Önceki defter:** yok (K7b §6.G gözlemi).

---

### [D-L-10] Çuval metrajı aynı serviste iki farklı kümeyle hesaplanıyor (hayalet süzgeçli / süzgeçsiz)

| Şiddet | S3 | Kategori | L (kopya hesap) | Öncelik | P3 | Modül | ÇUVAL/SEVK | Kanıt seviyesi | K1 |

**Özet.** "Bir çuvalda kaç metre var" sorusu `shipping.service` içinde iki kuralla cevaplanıyor: Paketleme listesi ve tüm belge yüzeyleri `SACK_ABSENT_STATUSES`'i **dışlar**; sevkiyat önizlemesi ve tahsis havuzu **dışlamaz**.

**Kanıt**
- Süzgeçli (doğru taraf): `shipping.service.ts:1187-1189` (`present` + `totalQty`), `:3137`, `:3437`, `:3604`; `sack-search.service.ts:233, 398, 487`; `label.service.ts:1583`
- Süzgeçsiz: `Teks-Erp/src/services/shipping.service.ts:1470-1478` (`previewCreateShipment`):
```ts
const sacks = await prisma.sack.findMany({ where: { id: { in: sackIds } },
  select: { ..., rolls: { select: { currentQty: true } } } });   // ← statü süzgeci YOK
for (const r of s.rolls) m = m.plus(r.currentQty);
```
  ve `:1305-1313` (`computeSackAllocations` havuzu — `PoolSack.rolls` süzgeçsiz)
- Küme tanımı: `helpers/sack-invariants.helper.ts:35-44` (8 statü; `SHIPPED` bilerek YOK)
- Son savunma: `shipping.service.ts:1834-1848` — DISPATCH anında hayalet varsa 400 (fail-closed). Yani veri bozulmuyor; **önizleme rakamı ile liste rakamı** ayrışıyor ve `SackAllocation` satırları şişmiş havuzdan yazılabiliyor.

**failure_mode.** Depo çuvalındaki bir top `AT_KARTELA`/`TAMBUR_CONSUMED`/`CANCELLED` olur (çuvalda `sackId` ile kalır). Paketleme listesi çuvalı **300 m** gösterir; "Sevkiyat Oluştur" önizlemesi **380 m** gösterir ve `surplusMeters` uyarısı 80 m'lik hayalet metraj üzerinden hesaplanır. Operatör sevkiyatı kurar, PLANNED tahsis satırları şişmiş havuzdan yazılır; sevk butonuna basınca 400 alır ve "önizleme 380 diyordu" der.
**Veride fiili ihlal (K2)** — `sql-saha.sh`: hayalet top (`sackId` dolu ∧ `SACK_ABSENT`) = **0/0** (K7a §7 ölçümüyle uyumlu). Yol açık, tetiklenmemiş.
**İş etkisi.** Önizleme ↔ liste çelişkisi; hayalet doğduğu gün PLANNED tahsis kirlenir.
**Öneri (2. tur).** `previewCreateShipment` ve `computeSackAllocations` sorgularına `rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } } }` ekle (belge yolundaki `:3437` ile birebir aynı yazım). Tek kaynak istenirse `sack-invariants.helper`'a `presentRollsSelect` ekle.
**Kabul kriteri.** Hayaletli bir çuval için `previewCreateShipment().totals.totalMeters === listSacks().totalQty`; bekçi süzgeç kalkınca kırmızı.
**Efor.** 0,25 gün. **Önceki defter:** yok (K7a HOTSPOT #6).

---

### [D-L-11] Advisory lock uzay envanteri ÜÇ yorumda bayat — "1 argümanlı uzayı session-registry/permission-management kullanıyor" iddiası artık YANLIŞ

| Şiddet | S3 | Kategori | L (yorum↔kod) | Öncelik | P4 | Modül | ÇEKİRDEK/KİLİT | Kanıt seviyesi | K1 |

**Özet.** Üç ayrı dosya, yeni bir advisory kilit eklemek isteyen okuyucuya uzay haritasını veriyor ve haritanın iki bilgisi de bayat: (a) `session-registry` + `permission-management` artık **1 argümanlı değil, 2 argümanlı** formu kullanıyor; (b) envanter "üç uzay" diyor, gerçekte **yedi** uzay dolu (8021-8027).

**Kanıt**
- Bayat yorumlar:
  - `Teks-Erp/src/services/helpers/duplicate-guard.helper.ts:22-24` — *"Repodaki diğer iki advisory kullanıcısı (`session-registry`, `permission-management`) **1-arg** formunu kullanıyor"*
  - `Teks-Erp/src/services/helpers/shipment-locks.helper.ts:20-25` — *"Uzay envanteri: 8021 KK1 · 8022 parti no · **8023 sevkiyat kapsamı**"* + aynı 1-arg iddiası
  - `Teks-Erp/src/services/batch.service.ts:90-92` — aynı 1-arg iddiası
- Gerçek durum (`grep -rn "pg_advisory" src --include='*.ts'` → 6 çağrı, **hepsi 2 argümanlı**):
  `inventory.service` 8021 · `batch.service` 8022 · `shipment-locks.helper` 8023 · `session-registry.service:32` **8024** · `permission-management.service:21` **8025** · `code-unique.helper:57` **8026** · `master-data-merge.service:50` **8027**
- Doğru cümleyi taşıyan tek yer: `Teks-Erp/src/services/helpers/code-unique.helper.ts` başlığı (*"1-argümanlı … form bu kod tabanında HİÇ [kullanılmıyor]"*) — yani dört yorumdan biri diğer üçünün tersini söylüyor.
- **Koruma yok teyidi:** namespace çakışmasını mekanik ölçen bekçi yok (`grep -rn "_LOCK_NS" scripts` → yalnız 8021↔8022 farklılık iddiası; 8023-8027 kapsam dışı).

**failure_mode.** Sekizinci alt sistem (ör. "sayaç sıfırlama" ya da bir yedekleme kilidi) eklenirken geliştirici `shipment-locks.helper.ts:20`'deki envanteri okur, "8021/8022/8023 dolu" görür ve **8024**'ü boş sanıp seçer. 8024 `session-registry`'nindir → iki alt sistem `hashtext` çakışmalarında birbirini sessizce serileştirir; sonuç yanlış veri değil, **teşhis edilemeyen gecikme** (vardiya başında oturum açılışları yeni alt sistemin arkasında kuyruğa girer).
**Veride fiili ihlal (K2)** — kapsam dışı (kilit uzayı veriye iz bırakmaz). Namespace değerleri kod düzeyinde kontrol edildi: **çakışma yok** (8021…8027 tekil).
**İş etkisi.** Bugün sıfır; yeni kilit eklendiği gün gecikme.
**Öneri (2. tur).** Envanteri TEK yere al: `helpers/advisory-namespaces.ts` (`export const ADVISORY_NS = { DUPLICATE_GUARD: 8021, ... } as const`), üç bayat yorumu o dosyaya yönlendir; küçük bir bekçi tüm `_LOCK_NS` değerlerinin tekilliğini ve 2-arg kullanımını mekanik doğrulasın.
**Kabul kriteri.** İki namespace aynı değere ayarlanınca bekçi kırmızı; hiçbir dosyada "1-argümanlı formu X kullanıyor" cümlesi kalmaz.
**Efor.** 0,25 gün. **Önceki defter:** K3b "bayat yorumlar" gözlemi (bulgu olarak yazılmamıştı).

---

### [D-L-12] `StationColor` ölü yazma yolu: panel hâlâ yazıyor/okuyor, hiçbir iş kuralı okumuyor (prod'da 49 satır)

| Şiddet | S3 | Kategori | L (ölü kod) + beceri §7.6 | Öncelik | P4 | Modül | ANA VERİ/İSTASYON | Kanıt seviyesi | **K2** |

**Özet.** 2026-08-02 kararıyla "renk istasyon bazlı kısıt DEĞİL" oldu ve `StationColor` **deprecated** ilan edildi ("satırları duruyor, okuyan kod yok"). Yazma ve panele-okuma yolu **duruyor**: `setCapabilities` `colorIds` gönderilirse replace ediyor, `getCapabilities` listeyi okuyup ekrana basıyor. Yani ekran, hiçbir davranışı olmayan bir ayarı düzenlenebilir gösteriyor.

**Kanıt**
- Yazma: `Teks-Erp/src/services/station-capability.service.ts:366-378` (`deleteMany notIn` + `createMany skipDuplicates`)
- Okuma (yalnız panel): `:169-177` (`getCapabilities` → `colorRows`), `:350-354` (audit snapshot)
- İş kuralının artık başka yerden çözüldüğü teyidi: `Teks-Erp/src/services/helpers/workorder-locks.helper.ts:21-23` — *"Kaynak bilinçli olarak `StationColor` DEĞİL (2026-08-02)"*; `station-capability.service.ts:10` — *"Buraya renk kısıtı geri ekleme."*
- Başka tüketici yok: `grep -rn "stationColor" src --include='*.ts'` → yalnız yukarıdakiler + `constants/merge-map.ts:213` (birleştirme kuralı, satırları taşır).
- **Veri:** `sql-saha.sh` → `station_colors = 49` satır (prod kopyası).

**failure_mode.** Yönetici "Boyahane bu renkleri yapabilir" listesini panelde düzenler ve kaydeder; audit satırı da yazılır. Hiçbir iş emri, rota adımı ya da fason kabulü bu listeye bakmaz — davranış **hiç değişmez**. Kullanıcı ayarı yaptığını sanır; ilk fason sevkinde beklemediği bir renk geçince "sistem ayarı tutmuyor" der ve teşhis 49 satırlık ölü tabloya kadar iner.
**Veride fiili ihlal (K2).** 49 satır canlı; hiçbiri okunmuyor (kanıt yukarıda).
**İş etkisi.** Ekranda yalan bir ayar yüzeyi + gereksiz yazma/audit gürültüsü.
**Öneri (2. tur).** İki şık, iş sahibi seçsin: (a) `setCapabilities`'in `colorIds` dalını ve `getCapabilities`'in `colorRows` okumasını KALDIR (ekrandan renk sekmesi düşer; tablo veri olarak durur, migration gerekmez); (b) tabloyu gerçekten kaldır → **migration + `[PROD'DA ÇALIŞTIRMA]`**, geri alma yolu yedekten restore. (a) önerilir.
**Kabul kriteri.** `grep -rn "stationColor" src` → yalnız `merge-map.ts`; istasyon ekranında renk düzenleme yüzeyi yok.
**Efor.** 0,5 gün. **Önceki defter:** yok (K4 H17 gözlemi).

---

### [D-L-13] Ölü kod mekanik olarak yakalanmıyor — 2026-08-09'da bildirilen 19 ölü export'un 19'u bugün de ölü, ayrıca ölü bir import derlemeden geçiyor

| Şiddet | S3 | Kategori | L (ölü kod) + K (bekçi) | Öncelik | P4 | Modül | ÇEKİRDEK/SÜREÇ | Kanıt seviyesi | **K2 (araç ölçümü)** |

**Özet.** Ölü kodu yakalayacak üç kapının üçü de kapalı: `tsconfig.json`'da `noUnusedLocals`/`noUnusedParameters` YOK, ESLint'te **toplam 2 aktif kural** var (`no-restricted-syntax` + `no-restricted-imports`) ve `knip` (config'i repoda mevcut) **CI'da koşmuyor**. Sonuç ölçüldü: 19 gün önceki knip listesi aynen duruyor.

**Kanıt**
- `Teks-Erp/tsconfig.json` — `strict: true` var; `noUnusedLocals`/`noUnusedParameters` **yok**.
- `Teks-Erp/eslint.config.mjs:11-74` — dosyanın kendi başlığı: *"Kural setinden hiçbir şey aktif DEĞİL — bu config bir formatter değil"*; aktif kural: `no-restricted-syntax` (tx üzerinde `Promise.all`) ve route/controller için `no-restricted-imports` (`lib/prisma`).
- `Teks-Erp/knip.json` mevcut; `.github/workflows/ci.yml` backend adımları: `npm run lint` (:96), `npx tsc --noEmit` (:99), `npm run typecheck:scripts` (:109), `npm test` (:112) — **knip yok**.
- **Ölçüm (bu tur):** `audit/raw/knip.out`'taki 19 "unused export"un tamamı hâlâ ölü (her sembol için `grep -rl "\b<ad>\b" src scripts` → yalnız tanım satırı). Örnekler: `LABEL_KINDS` (`config/label-kind.schema.ts:54`), `resolveDocField` (`document-render/doc-fields.ts:129`), `resolveFasonField` (`document-render/fason-ceki.fields.ts:146`), `resolveLabelIntentSnapshot` (`helpers/label-intent.helper.ts:78`), `eachDay`/`ymdLocal` (`reports/_shared.ts:182/200`), `getKindExclusiveKeys` (`helpers/label-context-fit.ts:53`), `skippedTypesFor`, `getLabelFont`, `PAGE_DIM` (`fason-ceki.density.ts:40`), `readSessionDurationHours`, `getCurrentJob`, `getLastBackupResult`, `validateLongText`, `validateHexColor`, `DOC_PAGE_DIM`, `TRAVELER_SECTION_LABELS`, `LEFT_COL_MM`.
- **Ölü import (derleme geçiyor):** `Teks-Erp/src/services/shipping.service.ts:93` `computeLoadedByLine,` — dosyada **hiç çağrılmıyor** (`grep -n "computeLoadedByLine" src/services/shipping.service.ts` → tek satır, import). Kaynağı `helpers/allocation.helper.ts:125` de böylece tamamen ölü.
- Ek: `buildPool` (`allocation.helper.ts:53`) yalnız kendi dosyasında.

**failure_mode.** İki somut zarar: (1) `resolveDocField` ve `resolveFasonField` başlıkları *"bekçi ve panel önizlemesi için"* diyor — `scripts/` altında bu fonksiyonları çağıran **hiçbir bekçi yok**, yani belge alan-puntosunun (2026-08-05 "DÖRT KAPI" kuralı) mekanik kontrolü var sanılıyor, yok. Punto ayarı sessizce kaybolduğunda hiçbir test kırmızı vermez. (2) `computeLoadedByLine` sevk tahsisi hesabının bir varyantıdır; ölü olduğu görünmediği için bir sonraki geliştirici onu "ikinci bir tahsis yolu" sanıp güncelleyebilir ve değişikliği hiçbir yerde etkisini görmez.
**Veride fiili ihlal (K2)** — araç ölçümü yukarıda (19/19).
**İş etkisi.** Bakım yükü + "koruma var" yanılsaması.
**Öneri (2. tur).** ① CI'a `npx knip --no-exit-code` (advisory) ya da tam kapı olarak `knip` adımı ekle (doküman bekçisiyle aynı desen: GATE/ADVISORY ayrımı). ② `tsconfig.json`'a `noUnusedLocals: true` (ölü import'ları derlemede yakalar; bugün tek ihlal `shipping.service.ts:93`). ③ 19 export'u sil ya da gerçekten bekçiye bağla (özellikle `resolveDocField`/`resolveFasonField` için punto bekçisi yaz).
**Kabul kriteri.** `npx knip` 0 unused export; `npm run typecheck` `noUnusedLocals` ile yeşil.
**Efor.** 0,5 gün (kapı) + 0,5 gün (temizlik). **Önceki defter:** ilgili — `audit/raw/knip.out` (2026-08-09 ölçümü), bulgu olarak yazılmamıştı.

---

### [D-L-14] `finalizeWarehouseCut` yorumu fonksiyonun idempotency mekanizmasının TERSİNİ anlatıyor (kardeş fonksiyondan kopyalanmış)

| Şiddet | S4 | Kategori | L (yorum↔kod) | Öncelik | P5 | Modül | TAMBUR | Kanıt seviyesi | K1 |

**Özet.** 12 satırlık bir "bilinçli karar" bloğu, içinde bulunduğu fonksiyonun sahip OLMADIĞI bir mekanizmayı (tx içi `clientToken @unique` → P2002) anlatıyor ve buna dayanarak bir maliyeti ("her replay bir barkod numarası yakar") kabul edilmiş ilan ediyor. Gerçek: `finalizeWarehouseCut` **hiç `clientToken` almıyor**; koruması tx'ten ÖNCEKİ `TAMBUR_CONSUMED` kapısı — yani yorumun "orada var, burada yok" dediği şeyin tam tersi.

**Kanıt**
- Yorum: `Teks-Erp/src/services/tambur.service.ts:2448-2458`
```
// ⚠️ BİLİNÇLİ DAVRANIŞ DEĞİŞİKLİĞİ — REPLAY ARTIK BİR NUMARA YAKIYOR.
// Bu yolun idempotency'si `finalize`ınkinden FARKLI: orada tx'ten ÖNCE bir
// kapı var (`status === TAMBUR_CONSUMED` → erken dön), burada mekanizma
// tx'in İÇİNDE `clientToken @unique` → P2002 → rollback → catch'te idempotent
// yanıt. ... Rahatsız ederse doğru çözüm ... buraya `finalize`daki gibi
// tx-öncesi bir clientToken kapısı eklemektir
```
- Kod: `Teks-Erp/src/services/tambur.service.ts:2343-2352` — `data` tipinde `clientToken` **YOK**; `:2371-2379` — tx'ten önceki `TAMBUR_CONSUMED` erken-dönüş kapısı **VAR** (F132 notu); `:2495-2511` çocuk `create` gövdesinde `clientToken` alanı **yok**.
- Karşılaştırma: `clientToken`i gerçekten kullanan kardeş `cutWarehouseRoll` — `:2277-2290` (tx-öncesi token kapısı) ve `:2808` (`clientToken: data.clientToken ?? null`). Yorum bu fonksiyona ait, oradan taşınmış.
- İkinci savunma (yorumun bilmediği): `:2581-2588` parent `currentQty: 0` yazılıyor → kapı kaldırılsa bile `remainingQty=0` olur, ikinci çocuk doğmaz.

**failure_mode.** Bakımcı yorumu okur ve iki yanlış adımdan birini atar: (a) "token koruması var" diye tx-öncesi `TAMBUR_CONSUMED` kapısını gereksiz sanıp kaldırır → replay `updateMany where {id, status: parent.status}` claim'ini **geçer** (parent.status okuması da `TAMBUR_CONSUMED`'dur), audit ikinci kez yazılır ve yanıt `remainingChild:null / remainingQty:0` döner: tablette "kalan yok" görünür oysa ilk çağrıda kalan çocuk üretilmiştir; (b) yorumun tarif ettiği "tx-öncesi clientToken kapısı"nı eklemeye kalkar, uçta/Zod'da token olmadığı için ölü kod yazar.
**Veride fiili ihlal (K2)** — kapsam dışı (yorum kusuru; kod davranışı bugün doğru).
**İş etkisi.** Bakım riski; hatalı teşhis süresi.
**Öneri (2. tur).** Bloğu `finalizeWarehouseCut`'ın gerçek sözleşmesiyle yeniden yaz (kapı = `TAMBUR_CONSUMED`; barkod rezervasyonu tx-öncesi ve **başarısız denemede** numara yakar) ya da bloğu `cutWarehouseRoll`'a taşı.
**Kabul kriteri.** `tambur.service.ts` içinde `clientToken` geçen her yorumun altında gerçekten `clientToken` okuyan/yazan kod var.
**Efor.** 0,1 gün. **Önceki defter:** K3b "H-5 yorum↔kod" gözlemi.

---

### [D-L-15] `TravelerCard.contentDirty`: ~20 yazma noktası, SIFIR tüketici — iki backend yorumu hâlâ "istemci rozeti bu alandan basar" diyor

| Şiddet | S4 | Kategori | L (ölü kod + yorum↔kod) | Öncelik | P5 | Modül | BELGE/REFAKAT KARTI | Kanıt seviyesi | K1 |

**Özet.** "Basılı kart güncel değil" bayrağı 2026-08-06'da tüm istemci yüzeylerinden kaldırıldı (kök CLAUDE.md: *"rozet yüzeyleri kaldırıldı, backend mekanizması DURUYOR"*) ve kart içeriği artık her baskıda **canlı** çözülüyor. Backend tarafı hâlâ ~20 noktadan bu bayrağı yazıyor ve iki yorum ölü bir istemci davranışını tarif ediyor.

**Kanıt**
- Yazan: `helpers/traveler-card-dirty.helper.ts:34-60` (iki fonksiyon) + 14 çağrı yeri (`workorder-link` ×4, `workorder.service` ×4, `subcontractor.service` ×3, `order.service` ×3, `workorder-batch-drop`) + `traveler-card.service.ts:356/372/697`
- Okuyan iş kuralı: **yok**. Yalnız yanıt alanı: `workorder.service.ts:2327` ve `:6225`.
- Ölü istemci teyidi: `Electron/src/pages/Operations/WorkOrders/TravelerCardPrintDialog.tsx:37` — *"⚠️ 'GÜNCEL DEĞİL' BANDI KALDIRILDI (2026-08-06, kullanıcı kararı)"*; `mobil/.../WorkOrderDetailSheet.tsx:62` aynı gerekçe.
- Bayat yorumlar: `Teks-Erp/src/services/workorder.service.ts:2326` (*"= 'basılı kart güncel değil' rozeti (WO detay başlığı)"*) ve `:6224` (*"İstemci 'güncel değil' rozetini bu alandan basar"*).
- **Ek gözlem (çift-mod, beceri §7.5):** helper imzası `Prisma.TransactionClient` ister ama `PrismaClient` yapısal olarak uyduğu için **üç çağrı yeri havuz client'ı geçiyor** — `workorder-link.service.ts:577`, `:640`, `workorder.service.ts:5878`. Bu üçünde işaretleme claim ile aynı tx'te DEĞİL (yerinde yorumla gerekçelendirilmiş: *"bu metodun tx'i YOK … işaret bağımsız ve idempotent"*). Bugün zararsız çünkü bayrağı okuyan yok; bayrak yeniden yüzeye çıkarılırsa "claim commit oldu, işaret yazılamadı" penceresi gerçek olur.

**failure_mode.** Bakımcı `workorder.service.ts:6224`'ü okuyup "rozet çalışıyor" varsayar ve yeni bir plan-değiştiren yol eklerken `markTravelerCardDirtyTx` çağırmayı **atlar** ya da tersine, gereksiz yere ekler. Bayrak yeniden yüzeye çıkarıldığı gün (kullanıcı isterse) üç havuz-client çağrı yerinde işaret kaybı penceresi de birlikte gelir: renk/en değişikliği commit olur, işaret yazılamaz, sahadaki kâğıt eski rengi gösterir ve sistem "güncel" der.
**Veride fiili ihlal (K2)** — aranmadı (bayrağın okuyucusu olmadığı için sapması gözlemlenemez).
**İş etkisi.** Sıfır (bugün) + bakım gürültüsü (her plan yolunda bir ekstra UPDATE).
**Öneri (2. tur).** İki yorumu düzelt ("mekanizma duruyor, yüzey yok — 2026-08-06"); mekanizmayı KORU (karar notu öyle diyor). Bayrak yeniden yüzeye çıkarılırsa üç havuz çağrısını tx'e al.
**Kabul kriteri.** `contentDirty` geçen her yorum "istemci basar" demiyor; `grep -rnE "markTravelerCardDirtyTx\(\s*prisma" src` sonucu bilinçli olarak belgelenmiş.
**Efor.** 0,1 gün.

---

### [D-L-16] Fail-open enum tüketicileri: yeni bir `RollEntrySource`/`RollVarianceKind` üyesi sessizce eski davranışa düşer (sınıf iki kez ısırdı)

| Şiddet | S4 | Kategori | beceri §7.6 (OCP) | Öncelik | P5 | Modül | ENVANTER/SEBEP | Kanıt seviyesi | K1 |

**Özet.** Üye-başına tüketici sayımı yapıldı. Çoğu kayıt defteri **tiple zorlanmış** (bulgu değil — aşağıda "Doğru yapılanlar"). Geriye iki gerçek fail-open nokta kalıyor ve biri geçmişte iki kez ısırmış.

**Ölçüm (üye başına tüketici DOSYA sayısı, `grep -rlE "\b<üye>\b" src --include='*.ts'`):**

| Enum | Üye → dosya |
|---|---|
| `RollStatus` (13) | STOCK 34 · IN_PRODUCTION 19 · SCRAP 32 · CANCELLED 46 · AT_SUBCONTRACTOR 18 · A1_STOCK 26 · RETURNED_FROM_SUBCONTRACTOR 8 · WAREHOUSE 40 · SHIPPED 22 · TAMBUR_CONSUMED 15 · SUBCONTRACTOR_CONSUMED 13 · AT_KARTELA 9 · KARTELA_CONSUMED 10 |
| `RollEntrySource` (6) | SUPPLIER_RECEIPT 6 · MANUAL_ENTRY 4 · TAMBUR_MANUAL 5 · TAMBUR_SPLIT 4 · SUBCONTRACTOR_RETURN 8 · SEMI_FINISHED 5 |
| `LabelKind` (4) | ROLL_RAW 10 · ROLL_FINISHED 12 · SWATCH 16 · SACK 14 |
| `ReasonPresetKind` (6) | ROLL_SCRAP 5 · ROLL_RECORD_CORRECTION 2 · ROLL_MANUAL_ENTRY 4 · ROLL_CANCEL 7 · ORDER_CANCEL 4 · WORK_ORDER_REWORK 1 |
| `StationKind` (6) | RAW_QC 6 · PROCESS_QC 14 · TAMBUR 12 · SUBCONTRACTOR 11 · SHIPPING 6 · OTHER 3 |

**Kanıt (fail-open kalanlar)**
1. `Teks-Erp/src/services/inventory.service.ts:2601-2617` — `entryTitle` switch'i, `default: return "Ham Giriş"`. Dosyanın kendi yorumu (`:2595-2600`) bu sınıfın **iki kez ısırdığını** yazıyor (`SUBCONTRACTOR_RETURN`, sonra `SEMI_FINISHED` — *"aylarca 'Ham Giriş' yazdı"*). Yapı düzeltilmedi, yalnız uyarı eklendi.
2. `Teks-Erp/src/constants/variance-reasons.ts:188-192` `builtinReasonsForKind` → `return []` + `Teks-Erp/src/services/reason-preset.service.ts:312-316` `kindOfVariance` → `return null`. Yeni bir `RollVarianceKind` eklenince: sebep GÖNDERİLMEZSE `validateVarianceReason` (`variance-reasons.ts:238-241`) satırı sessizce `BELIRTILMEDI` koduyla yazar; sebep GÖNDERİLİRSE `Geçersiz sebep kodu: X (geçerli: )` 400'ü verir — yani aynı kind iki yoldan iki farklı sonuç üretir ve biri sessizdir.

**failure_mode.** `RollEntrySource`'a 7. değer eklenir (ör. müşteri iadesinden doğan top): top detay panelinde "Ham Giriş" yazar, izlenebilirlik sorgusu yanlış cevap verir ve hiçbir test kırmızı olmaz — `SEMI_FINISHED`'de aylarca yaşanan durumun birebir tekrarı.
**Veride fiili ihlal (K2)** — bugün her iki switch de tam kapsıyor (6/6 · 3/3); ihlal yok.
**İş etkisi.** Sıfır (bugün); enum genişlediği gün sessiz yanlış etiket.
**Öneri (2. tur).** `entryTitle`'ı `Record<RollEntrySource, string>` sabitine çevir (derleme zorlaması — `reason-presets.ts:67` `satisfies Record<ReasonPresetKind, boolean>` deseninin aynısı); `builtinReasonsForKind`/`kindOfVariance`'i `Record<RollVarianceKind, …>` ile exhaustive yap (OVERAGE için açıkça `null`).
**Kabul kriteri.** Enum'a yeni üye eklendiğinde `npm run typecheck` **kırmızı** olur.
**Efor.** 0,25 gün.

---

### [D-L-17] `AppError.isOperational` hiç okunmuyor; audit çağrılarında 42 gereksiz `.catch(() => undefined)` katmanı

| Şiddet | S4 | Kategori | L (ölü kod) | Öncelik | P6 | Modül | ÇEKİRDEK/HATA | Kanıt seviyesi | K1 |

**Kanıt**
- `Teks-Erp/src/utils/app-error.ts:7/21/26` alan tanımı; okuyan tek yer **yok** (`grep -rn "isOperational" src` → tanım + `tambur-manual.service.ts:568/807/1447`'de yalnız yeniden **taşınıyor**; `middlewares/error.middleware.ts` hiç bakmıyor).
- `grep -rn "catch(() => undefined)\|catch(() => {})\|catch(() => null)" src | wc -l` → **42**; ezici çoğunluğu `AuditService.log(...)` sonrası (`auth.service.ts:161/181/193/225`, `device.service.ts:244/271/286/299/311/346`, …).
- Gereksizliğin teyidi: `Teks-Erp/src/services/audit.service.ts:110-116` — `log()` kendi içinde `try/catch` yapıyor, `recordAuditFailure(error)` ile `/health` sayacını artırıyor ve `console.error` basıyor; yani dış `.catch` **asla tetiklenmez**.

**failure_mode.** İki bakım tuzağı: (a) `isOperational` bir "işletme hatası mı, program hatası mı" ayrımı vaat ediyor; birisi buna dayanıp `if (err.isOperational)` yazarsa hiçbir yerde ayarlanmadığı için **her hata** `true` döner (varsayılan) ve program hataları operasyonel sayılır; (b) audit'i sıkı hâle getirme kararı alınırsa (`log` artık throw etsin) 42 dış `.catch` hatayı **sessizce** yutmaya devam eder ve "artık zorunlu" iddiası boşa düşer.
**Öneri (2. tur).** `isOperational`'ı ya `error.middleware`'de gerçekten kullan ya da kaldır (3 taşıma noktasıyla birlikte). Dış `.catch(() => undefined)` katmanını audit çağrılarından temizle (sözleşme `audit.service` başlığında zaten yazılı).
**Efor.** 0,25 gün. **Önceki defter:** K6 gözlemi.

---

### [D-L-18] Aynı büyüklüğü basan yardımcılar üç kez kopyalanmış; sonuç: aynı metraj belgeden belgeye 1 veya 2 ondalık basılıyor

| Şiddet | S4 | Kategori | L (kopya hesap) | Öncelik | P6 | Modül | BELGE | Kanıt seviyesi | K1 |

**Kanıt**
- `fmtTr` **birebir aynı gövdeyle** üç dosyada: `Teks-Erp/src/services/document-render/kartela-ceki.html.ts:86-93`, `shipment-dispatch.html.ts:246-253`, `fason-direct-ship.html.ts:121-128`. Fark yalnız sarmalayıcıda: `fmtQty = fmtTr(n, 1)` (kartela, fason) ↔ `fmtTr(n, 2)` (sevk fişi).
- `round1`/`pctOf` iki kez tanımlı: `reports/_breakdown.ts:32-34` (export) ↔ `reports/quality-scorecard.report.service.ts:219-220` (private, birebir aynı) + üçüncü satır-içi tanım `inventory.service.ts:2066`.
- `D0()` beş dosyada ayrı tanımlı (`allocation.helper.ts:14` export'lu olmasına rağmen).

**failure_mode.** Aynı sevkiyatın metrajı sevk fişinde `1.234,56`, fason çekisinde `1.234,6` basılıyor. Fabrika iki kâğıdı yan yana koyunca "hangisi doğru" sorusu doğar ve cevabı hiçbir yerde yazılı değil (yuvarlama politikası dokümante edilmemiş — K7a §5). Ondalık sayısı belge başına elle seçildiği için yeni bir belge eklendiğinde üçüncü bir değer doğar.
**Öneri (2. tur).** `document-render/_format.ts` tek dosyası (`fmtTr` + belge-başına `DEC` haritası, `Record<PrintedDocType, number>` ile exhaustive); `round1/pctOf` yalnız `_breakdown.ts`'ten import edilsin. Ondalık politikasını CLAUDE.md'ye yaz.
**Efor.** 0,25 gün.

---

### [D-L-19] Tolerans nedeniyle COMPLETED olan siparişin açık kalemi tüm talep yüzeylerinden düşüyor

| Şiddet | S4 | Kategori | L (kopya hesap) | Öncelik | P6 | Modül | SİPARİŞ | Kanıt seviyesi | **K2** |

**Özet.** "Bu kalem hâlâ açık mı" sorusunun iki cevabı var: `helpers/order-line-scope.openLineWhere` kalem bazlı (`quantity > shippedQty`), `helpers/order-status.helper` sipariş bazlı ve **5 m toleranslı**. Sipariş COMPLETED olunca talep yüzeyleri (`production-balance`, `stock-scorecard`, `open-order-coverage`) `order.status notIn COMPLETED` süzgeciyle o kalemi **hiç görmez**.

**Kanıt**
- `Teks-Erp/src/services/helpers/order-status.helper.ts:163-175` — `totalRequired.minus(shippedQty).lessThanOrEqualTo(tolerance) → COMPLETED` (tolerans varsayılan 5 m; prod'da `shipping.toleranceMeters` satırı YOK → kod varsayılanı)
- `Teks-Erp/src/services/helpers/order-line-scope.helper.ts:29-39` — `openLineWhere` toleranssız
- Tüketiciler: `production-balance.service.ts:193` + `stock-scorecard:172` (`order.status ∉ {CANCELLED, COMPLETED}`)
- **Veride (K2)** — `sql-saha.sh`: `SIP1008260052` COMPLETED (istenen 300,000 / sevk 298,000), **1 kalem** hâlâ `quantity > shippedQty` → toplam **2,000 m** talep hiçbir denge/kapsama/stok yüzeyinde görünmüyor. (Prod kopyasında bu sınıftan tek sipariş var.)

**failure_mode.** Müşteri "2 metre eksik geldi" der; planlamacı Ürün Dengesi'ne bakar, o spec için açık talep göremez ve "sistemde eksik yok" cevabını verir.
**İş etkisi.** Küçük ama sistematik; tolerans 5 m ve sipariş sayısı arttıkça birikir.
**Öneri (2. tur).** İş kararı: tolerans kapanışta kalemi de kapatsın (kalem `shippedQty`'yi `quantity`'ye çeksin ya da `closedByTolerance` damgası alsın), ya da talep yüzeyleri `COMPLETED` siparişin açık kalemini de göstersin. Kod tarafı tek helper. **Bu bulgu D-E (iş kuralı) ile kesişir** — orada "bilinçli mi" sorusu ayrıca değerlendirilmeli.
**Efor.** 0,5 gün (+ karar). **Önceki defter:** yok (K7a H17).

---

## Uygulanan kontrol listesi

| Madde (görev metni) | Durum |
|---|---|
| (1) Aynı hesabın birden fazla yerde yazılması — her kopya çifti için formül FARKI | **uygulandı** — D-L-01 (sevk brüt/net), D-L-03 (üretim çıktısı 2 statü listesi), D-L-07 (fire 2 kriter), D-L-08 (`specMatch`), D-L-09 (fason açık kalem), D-L-10 (çuval metrajı), D-L-18 (formatlayıcılar), D-L-19 (açık talep). "Kalan metraj" ve "çekme oranı" için ayrışma bulunamadı (aşağıda). |
| (1a) Üretilen metraj: katalogdan mı sabit mi | **uygulandı — ayrışma YOK.** `workorder.service.ts:1842` (liste) ve `:2209` (detay) ikisi de `loadProducedBuckets` (`helpers/roll-finalize.helper.ts:75-106`) kullanıyor; gömülü `["FIRE","A1"]` listesi kalmamış. Ayrışma başka eksende: D-L-03. |
| (1b) Sevk metrajı brüt mü net mü (9 `RollReturn` okuyucu / 21 rapor) | **uygulandı** — D-L-01 (günlük seri) + D-L-02 (parti izleme). `accounting-export.service.ts:480-482` doğrudan sevkte `Σ rolls` ↔ `_shipped` mutabakat satırı farkı: prod'da `direct_shipments = 0` → bugün etkisiz, "Sınır ötesi"nde bırakıldı. |
| (1c) Açık talep | **uygulandı** — D-L-19; ayrıca `order.service.ts:1539-1543` `netGap` kelepçesiz ama semantiği farklı ("eksi = fazla", `:1399` yorumu) → bulgu DEĞİL, bilgi. |
| (1d) Fire / çekme oranı | **uygulandı** — fire: D-L-07. Çekme oranı: backend yüzde HESAPLAMIYOR (`subcontract-scorecard:221-230` firePct ayrı soru); mobil↔backend payda farkı istemci sınırında → sınır ötesi. |
| (1e) Kalan metraj | **uygulandı — ayrışma bulunamadı.** Fason kalan (`OPEN_OUTSTANDING`) tek kaynakta; kopyaların semantiği bugün aynı (D-L-09 bekçi körlüğü olarak yazıldı). |
| (1f) Fason karne ham SQL kopyası | **uygulandı** — D-L-09. |
| (2) Katman ihlali: routes/controllers içinde doğrudan prisma | **uygulandı — 0 ihlal.** `grep -rn "lib/prisma\|prisma\.[a-z]" src/routes src/controllers` → 1 vuruş, o da yorum (`tambur.controller.ts:45`). ESLint `no-restricted-imports` kuralı bunu mekanik koruyor. Ters yön (servise `express` sızması) 11 dosyada var ama **hepsi tip**; ikinci (kopyalanmış) çağrı yolu gösterilemedi → §7.1'e göre satır yazılmadı. |
| (3) Bounded context (üç koşul birlikte) | **uygulandı** — D-L-04 (fason → `WorkOrderStep.status`). Diğer adaylar ELENDİ: `kursun-qc.reopenStep` (`:1090-1155`) SCRAP→IN_PRODUCTION geçişini atomik claim + tam guard'la yapıyor ve `recomputeStepStatus`'u kendisi çağırıyor (§7.2 üçüncü koşul sağlanmıyor); `order.service.ts:3242` WO iptali `workorder.service.softDelete` gövdesini tekrarlamıyor (ayrı `cancelWithActions` akışı, kendi audit'i var) — D-E/D-D'ye devredildi; `WorkOrder.status → IN_PROGRESS` 5 doğrudan site (`kursun-qc:1146`, `tambur-manual:1196`, `tambur-undo:1380/1671`, `manual-move:818`, `split:396`) **aynı** `where:{status: COMPLETED}` claim'ini ve **aynı** `setWorkOrderCardStatuses(...,COMPLETED,ACTIVE)` fan-out'unu taşıyor → kural tek, kopya 5 (bulgu değil, bilgi). |
| (3a) `Roll.status` 57 site | **uygulandı — bulgu yazılmadı.** Sahip servis yok ama ortak helper'lar (`applyRollDispositionsTx`, `finalizeRollsAtLastStep`, `K18_DEAD_STATUSES`) + trigger damgası mevcut; §7.2'nin üçüncü koşulu (aynı geçiş için sahipte guard var, yabancıda yok) hiçbir çift için kanıtlanamadı. Üç "önceki statü" kolonunun çapraz tutarlılığı D-A/D-E alanına devredildi. |
| (4) OCP / enum tüketici sayımı, fail-open mu | **uygulandı** — D-L-16 (tablo + iki fail-open nokta). `LabelKind` ve `ReasonPresetKind` **tiple zorlanmış** (`Record<LabelKind, …>` `config/label-fields.ts:143`; `satisfies Record<ReasonPresetKind, boolean>` `constants/reason-presets.ts:67`) → §7.6 karşı-örneği, bulgu değil. `PrintedDocType` tam `Record` (`printed-document.service.ts:39`, `sample-data.ts:16`). |
| (4a) `RollMovement.notes` marker'ları (8+ string) | **uygulandı — bulgu yazılmadı.** 11 marker, 22 yazma sitesi, tek çıkarılmış sabit (`KURSUN_BYPASS_MARKER_PREFIX`). İki yazım geleneği var (üzerine yaz / ` \| ` ile ekle) ve bir okuyucu `startsWith`'e dayanıyor (`kursun-qc.service.ts:996`) — ama **tüm** yazımlar yalnız `exitedAt IS NULL` satırlarına dokunuyor, yani bir hareket ömrü boyunca tek marker alıyor → bugün çakışma imkânsız. Dispozisyon önekleri zaten tek kaynakta (`roll-disposition.helper.ts:66-70`, bekçi §12 oradan türüyor). Sınır ötesi not olarak bırakıldı. |
| (5) `helpers/` altında DB yazan / kilit alan dosyalar; çift-mod çağrı yerlerinde havuz client'ı; ABBA | **uygulandı** — 22 dosya listelendi; `*Tx(prisma, …)` mekanik taraması: 6 çağrı yeri, 3'ü **yazma** (D-L-15'te belgelendi), 3'ü okuma (zararsız: `hasBypassClosureOnProcessQcTx`, `findPendingBypassAssignmentTx`, `readLastShortBatchSeqTx` — sonuncusu `as unknown as` ile tip susturuyor, `batch.service.ts:198`). **ABBA sıra analizi D-A'ya devredildi** (kilit sırası haritası o hücrenin ana üretim adımı; burada yalnız çağrı-yeri/client çiftleri ölçüldü). |
| (6) TODO/FIXME/HACK/geçici/XXX envanteri | **uygulandı — `src` altında GERÇEK TODO/FIXME/HACK/XXX = 0.** İki `XXX` vuruşu belge-no maskesi (`return.service.ts:1030`, `roll-finalize.helper.ts:43`). Türkçe eşdeğerleri tarandı ("geçici/şimdilik/ileride/yapılacak/workaround"): 38 vuruş, hepsi **gerekçeli tasarım notu**; tek gerçek ertelenmiş iş `inventory.service.ts:3391-3395` (`restoreCancelledRoll` guard gevşetilirse yapılacaklar) ve o da koşullu + reçeteli. Bu bir **güçlü yön**, bulgu değil. |
| (7) `any` / `as unknown as` / `@ts-ignore` / `eslint-disable` sayımı + en yoğun 10 dosya | **uygulandı** — `as any` **1** (`search.service.ts:134`, allowlist'li dinamik delegate — `SEARCH_ENTITIES` sabitinden gelir, bulgu değil) · `: any` 1 (aynı satır) · `@ts-ignore/@ts-expect-error/@ts-nocheck` **0** · `eslint-disable` **8** (5'i `no-control-regex`, biri `no-require-imports`, biri `no-empty-interface`, biri yukarıdaki `any`) · **`as unknown as` 91**. En yoğun 10: `system-setting.service.ts` 10 · `label-template.service.ts` 10 · `traveler-card.service.ts` 7 · `shipping.service.ts` 5 · `base.service.ts` 5 · `printed-document.service.ts` 4 · `import/import.service.ts` 3 · `traveler-template.service.ts` 2 · `label.service.ts` 2 · `kartela.service.ts` 2. **Bulgu yazılmadı:** vuruşların ezici çoğunluğu `Prisma.InputJsonValue` sürtünmesi (kaçınılmaz) ya da DMMF erişimi (`base.service.ts:116-216`); JSON→tip yönündeki okumalar (`traveler-card.service.ts:933/954`, `label-template.service.ts:712`) doğrulamasız cast ama şema versiyonlaması ve fail-safe dalları mevcut → failure_mode üretilemedi. |
| (8) knip'ten 10 örnek seçip güncel kodda hâlâ ölü mü | **uygulandı** — 19/19 doğrulandı, D-L-13. |
| (9) Value-level döngüsel bağımlılık (SCC script'i) | **uygulandı — VALUE SCC = 0.** `dosya=365 value-kenar=1394 type-kenar=97`. `audit/raw/madge-circular.out`'taki **14 döngünün tamamı** `import type` kenarıyla kapanıyor (örnekleme doğrulandı: `workorder-batch-drop.service.ts:47`, `traveler-card-raw.ts:24`; label zincirindeki geri-kenarlar ise artık **hiç yok** — helper'lar `label.service`'i import etmiyor, yalnız yorumda anıyor). **Bulgu yok**; ham madge çıktısıyla yazılacak 14 mimari bulgu sahte olurdu. |
| (10) İş mantığı controller'da mı (tambur/shipping/workorder) | **uygulandı — bulgu yok.** `workorder.controller.ts` 1.098 satır ama 154'ü Zod, 10 servis çağrısı, 10 dallanma; `tambur` 562/73 Zod/3 çağrı/1 dallanma; `shipping` 565/64/5/2; `subcontractor` 556/74/0/2. Controller'lar doğrulama + delegasyon; ORM erişimi 0. |
| (11) Yorum↔kod ayrışması sınıfı | **uygulandı** — D-L-14 (`tambur.service.ts:2448`), D-L-11 (3 advisory yorumu), D-L-15 (2 `contentDirty` yorumu), D-L-06 (`assertRouteCoversTargets` — **kodda olmayan bir sembole** atıf yapan 3 yorum). `app.ts` 10 MB yorumu D-L-05 olarak yükseltildi (yorum doğru sanılıyordu, **kod yanlış** çıktı). Ek küçük sapma: `middlewares/rbac.middleware.ts:30` "katalogdaki 67 kod" — `constants/permission-catalog.ts` bugün **71** `code:` satırı taşıyor (mekanik bekçi mevcut olduğu için failure_mode yok → bilgi). |

---

## Doğru yapılanlar (korunmalı kalıplar)

1. **Katman kuralı mekanik olarak korunuyor.** `eslint.config.mjs:56-73` `no-restricted-imports` ile `src/routes/**` ve `src/controllers/**` içinde `lib/prisma` importu yasak; ölçüm bunu doğruluyor (0 ihlal). Bu, "route'tan doğrudan ORM" sınıfını daha doğmadan kapatıyor — çok az kod tabanında var.
2. **Tx client'ı üzerinde `Promise.all` yasağı ESLint kuralı olarak yazılmış** (`eslint.config.mjs:38-50`). Kural, gerekçesini ve doğru/yanlış örneklerini kendi mesajında taşıyor. Aynı disiplin `roll-disposition.helper.ts:58-70`'te de var: bekçinin muafiyet listesi elle LIKE deseni yazmak yerine `DISPOSITION_NOTE_PREFIXES` sabitinden **türetiliyor**.
3. **`src` içinde SIFIR TODO/FIXME/HACK.** Ertelenen işler bile koşullu reçeteyle yazılmış (`inventory.service.ts:3391-3395`: "guard gevşetilirse şu üç çağrıyı şu sırayla ekle"). Teknik borç görünmez değil, **koşullu ve adresli**.
4. **Kayıt defterleri tiple zorlanmış.** `Record<ReasonPresetKind, …>` ×3 (`constants/reason-presets.ts:67/70/153`), `Record<LabelKind, readonly FieldDef[]>` (`config/label-fields.ts:143`), `Record<PrintedDocType, …>` ×2 — yeni bir enum üyesi **derleme hatası** verir. §7.6'nın karşı-örneği; kopyalanası kalıp.
5. **Value döngüsü YOK.** 365 dosya / 1.394 value kenarında sıfır SCC; geri-kenarların hepsi bilinçli olarak `import type`'a çevrilmiş (`workorder-batch-drop.service.ts:47`, `traveler-card-raw.ts:24`).
6. **`as any` fiilen sıfıra indirilmiş** (91 `as unknown as`'in neredeyse tamamı Prisma JSON sürtünmesi), `@ts-ignore` **0**. Tek `any` allowlist'li dinamik delegate ve `eslint-disable` ile açıkça işaretli.
7. **Ölü statü/küme tanımları tek kaynakta ve KARIŞTIRMA uyarılı**: `helpers/sack-invariants.helper.ts:16-26` (`SACK_ABSENT` ↔ `NON_SACKABLE` ↔ `K18_DEAD` üçlüsünün amaç farkı yazılı, "birini diğerinden TÜRETMEYİN").

---

## Sınır ötesi notlar

| Gözlem | Yönlendirme |
|---|---|
| **Prod kopyasında 4 top `qualityGrade='FIRE'` ama statü `WAREHOUSE`** (61,4 m; `T150826F0009/F0011`, `T170826F0017`, `T190826F0035`) — 2026-08-20 "FIRE → SCRAP" kararından ÖNCE doğmuş, satılabilir rafta duruyor ve sevk edilebilir. Ayrıca tek `SCRAP` topun (300 m) `finalizedAt`/`statusChangedAt`'i NULL. | **D-E (iş kuralı değişmezleri) + D-C (veri modeli)** |
| `WAREHOUSE→SCRAP` geçişi `roll_stamp_production_timestamps` trigger'ının kaynak listesinde YOK → `POST /rolls/:id/scrap` ile fire edilen top damgasını tazelemiyor; fire, üretildiği ayın karnesinde kalıyor (K4 H9'un rapor ayağı). | **D-E / D-C** |
| `RollMovement.notes` 11 marker × 22 yazma sitesi; iki yazım geleneği (üzerine yaz / `\| ` ekle) ve `startsWith` okuyucusu. Bugün çakışma imkânsız (`exitedAt IS NULL` süzgeci) ama sözleşme yazılı değil. | **D-D (tx sınırları) / D-A** |
| Ham SQL UPDATE'ler `updatedAt`'i tazelemiyor (13 `roll_movements` + merge MOVE kuralları); envanter sekmeleri `updatedAt desc` sıralıyor. | **D-C / D-H** |
| `accounting-export.service.ts:480-482` doğrudan sevk metrajını `Σ ds.rolls.currentQty` ile, `_shipped.ts:88-99` ise `totalQty` + mutabakat satırıyla kuruyor. Prod'da `direct_shipments = 0` → bugün etkisiz. | **D-E / RAPOR** |
| Fason "çekme oranı" paydası mobilde `consumedTotal` (düşülen), Fason Karnesi'nde `dispatchedQty` (giden) — kısmi kabulde iki farklı yüzde. İstemci sınırı, backend denetimi dışı. | **Mobil/Electron turu** |
| CI (`\.github/workflows/ci.yml:8-12`) yalnız `main`'e push ve `main`'e PR'da koşuyor; fabrikanın sürüm dalı **`adnansahin`** (HEAD `ce8681d1`). Yani sahaya çıkan kod merge edilene kadar hiçbir kapıdan geçmiyor. | **D-K (test) / ops** |
| `helpers/guarded-hard-remove.ts:14` `Request, Response, NextFunction` importuyla `services/helpers` altında **Express middleware** tanımlıyor ve route'lardan doğrudan mount ediliyor (audit `:78`'de). Katman gözlemi; davranış doğru. | **D-F (API/Express)** |
| `previewCreateShipment`/`computeSackAllocations` hayalet süzgeçsizliği (D-L-10) PLANNED `SackAllocation` satırlarını da etkileyebilir — tahsis defterinin doğruluğu D-E'nin "sevk kalan aşımı" değişmeziyle kesişir. | **D-E** |
| `restoreCancelledRoll` (`inventory.service.ts:3397-3465`) guard'ları tx DIŞINDA okuyup atomik claim'le yazıyor; dosya içi uyarı guard gevşetilirse tx gerekeceğini söylüyor. | **D-A / D-D** |

---

## Kapsanmayan / erişilemeyen

1. **ABBA kilit sırası analizi** — beceri §4.3 "kilit sırası haritası" D-A'nın ana üretim adımı; burada yalnız helper çağrı-yeri/client çiftleri ölçüldü (mükerrer üretmemek için bilinçli).
2. **Electron / mobil kaynak kodu** — brief kapsamı Teks-Erp backend. `contentDirty` ve `assertRouteCoversTargets` yorumlarının istemci ayağı yalnız **doğrulama amacıyla** (grep) okundu, denetlenmedi.
3. **`document-render/*` HTML üreticilerinin tam hesap satırları** — yalnız formatlayıcı kopyaları (D-L-18) ve jscpd'nin işaret ettiği klon çiftleri incelendi; belge içi metraj/adet aritmetiğinin tamamı K7b kapsamında.
4. **jscpd'nin 50 klonundan 12'si** — `audit/raw/jscpd.out` 2026-08-09 tarihli ve satır aralıkları bayat (ör. "workorder.service 634-756 ↔ 4595-4706" bugün `create()` ↔ `update()` sınırına düşüyor). En büyük klon çifti elle diff'lendi ve **gerçek bir iş-kuralı kopyası bulunamadı** (aralıklar kaymış); kalan `document-render` klonları (HTML iskeleti) tasarım gereği. Tam yeniden koşum yapılmadı — süre.
5. **Fan-in × churn kesişimi (§7.3)** — hub adayları üretildi ama "bekçisiz çağrı yolunu ADIYLA göster" koşulu için gereken çağrı-grafiği + bekçi eşlemesi bu turda çıkarılmadı; §7.3 kuralı gereği **satır yazılmadı** (ölçüm `bilgi` olarak bile deftere girmemeli).
6. **`ts-prune.out` (33 KB)** — knip ile örtüşen kısmı doğrulandı; kalan ~%80'i config'siz araç gürültüsü (skill §9.5) → ayrıştırılmadı.
7. **Canlı prod DB** — yalnız 2026-08-25 kopyası (190/195 migration). Son 5 migration'ın kolonları (`OrderLine.cancelledAt`, `Order.cancelReason`, `ReasonPresetKind.WORK_ORDER_REWORK` vb.) orada YOK; bu bulgularda o kolonlara dayanan K2 ölçümü yapılmadı.
8. **`eslint --print-config` ile aktif kural sayımı** — config elle okundu (2 kural); araç çıktısıyla teyit edilmedi (skill §9.6 ölçütü elle karşılandı).
