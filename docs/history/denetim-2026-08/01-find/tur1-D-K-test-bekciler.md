# D-K — Test & Bekçi Scriptleri  [P6] · ② BULMA · TUR 1

| | |
|---|---|
| Denetçi | **D-K** — Test ve bekçiler (Prompt Bölüm 3-K, satır 662-669) |
| Tarih / dal / HEAD | 2026-08-28 · `adnansahin` · `ce8681d1` |
| Mercek | Kod merkezli — bekçi kapsaması, kör nokta sınıfı, eşzamanlılık/idempotency sondaları, test hijyeni |
| Ana girdiler | `audit/00-map/K11-bekci-envanteri.md` (366 bekçi) · `MATRIX.md` ÇAPRAZ OKUMA §C · `KRITIK-YAZMA-YOLLARI.md` §6 (EŞZ) + §7.3/§7.4 · `K12` uzlaştırması |
| Yöntem | K11'in HER sayısal iddiası bağımsız grep/`wc` ile yeniden üretildi; 30+ bekçi dosyası ve 12 servis gövdesi tek tek okundu; DB iddiaları `audit/tools/sql-dev.sh` + `sql-saha.sh` ile **ölçüldü** (salt-okunur). **Hiçbir test koşturulmadı** (koşum dev DB'ye yazar). |
| Kanıt seviyeleri | K2 (fiili DB ölçümü): 01, 03, 08, 10, 16 · K1 (kod+şema+konfig, korumanın yokluğu teyitli): 02, 04, 05, 06, 07, 09, 11, 12, 13, 14, 15, 17, 18, 19, 20 · K0: yok |
| Yanlış pozitif kataloğu | Beceri §9 uygulandı. **İki aday elendi** (aşağıda "Elenen adaylar"). |

**Sözlük (K11'den):** **VARLIK** = mekanizmanın kodda var olduğunu ölçer · **SIRA** = kilidin korunan okumadan ÖNCE alındığını ölçer · **DAVRANIŞ** = N paralel istek gönderip sonucu ölçer ("tam 1 başarı" en güçlü biçim).

---

## 0. Bir bakışta — bu alanın üç cümlesi

1. **Bekçi sayısı sorun değil, bekçilerin BAĞLI OLDUĞU KAPI sorun.** 366 bekçi var; fabrikaya giden dalda (`adnansahin`) **hiçbiri otomatik koşmuyor** (CI yalnız `main`'e bakıyor, 140 commit / 33 migration geride kalmış) ve paketin kendisi HEAD'de **kırmızı** (en az iki dosya).
2. **Para/stok etkili altı P0 yazma yolunda tek bir paralel sonda yok** (`createShipment`, `dispatchShipment`, fason `cancelReceipt`/`closeRemainder`, `completeWorkOrder` kapanış dispozisyonu, sipariş bağla/sök/kalem iptali) — mekanik olarak doğrulandı.
3. **İdempotency'nin 4. durumu ("iptal edilmiş kaydın token'ı replay edildi") beş yolda hem koddan hem bekçiden eksik**; altıncı yolda (`RECEIPT_CANCELLED`) kod var, bekçi sıfır. Bu, beceri §8'in "en pahalı hata" sınıfıdır: kullanıcı "kaydedildi" görür, envanterde kayıt yoktur.

---

## BULGULAR

### [D-K-01] `adnansahin` dalı — yani fabrikaya çıkan sürüm — CI kapsamı DIŞINDA; 140 commit, 33 migration ve 67 yeni bekçi hiç otomatik koşmadı

| Şiddet | **S1** | Kategori | K (test altyapısı) | Öncelik | **P1** | Modül | ops/test | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** CI iş akışı yalnız `main` dalına tetiklenir. Fabrikanın kullandığı sürüm ise `adnansahin` dalından paketlenir (`deploy/electron-paketle.sh`, memory notu "fabrikanın sürümü adnansahin"). `main` en son 2026-08-17'de, `adnansahin` 2026-08-28'de commit almış: arada **140 commit, 33 yeni migration ve 67 yeni bekçi dosyası** var ve bunların hiçbiri için tip kontrolü, lint, seed+`migrate deploy` ve 366'lık test paketi **bir kez bile** otomatik koşmadı.

**Kanıt.**
```yaml
# .github/workflows/ci.yml:9-12
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```
- `git log -1 --format=%ad --date=short origin/main` → **2026-08-17** · `origin/adnansahin` → **2026-08-28**
- `git rev-list --count origin/main..origin/adnansahin` → **140**
- `git diff --name-status origin/main..origin/adnansahin -- Teks-Erp/scripts | grep -c '^A'` → **67** yeni test dosyası
- `git diff --stat origin/main..origin/adnansahin -- Teks-Erp/prisma/migrations` → **33 dosya, 1.568 ekleme**
- `.github/workflows/ci.yml` son commit: `96de7f80` **2026-08-01** — iş akışı dal stratejisi değiştiğinde güncellenmemiş.
- "Koruma yok" teyidi: repoda `.husky` YOK, `git config core.hooksPath` boş, `.git/hooks` altında yalnız `.sample` dosyaları (yerel hook da yok). `Teks-Erp/package.json`'da `pre*` script yok.

**failure_mode.** Bir geliştirici `adnansahin` dalına migration + servis değişikliği push eder. `prisma/migrations` altındaki dosya untracked kalmıştır (paylaşımlı ağaç, memory notu "git add tuzağı"). CI koşmadığı için `migrate deploy` + `npm test` hiç denenmez; hata ancak `deploy/kur.ps1` fabrikada `migrate deploy`i koştuktan sonra, backend eksik kolonu okuduğunda **P2022 → 500** olarak ortaya çıkar ve vardiya durur. (Bu tam olarak `scripts/check-migrations.mjs`'in başlığında anlatılan 2026-07-30 vakasıdır — bkz. D-K-14.)

**Veride fiili ihlal (K2).** 140 commit / 33 migration / 67 bekçi (yukarıdaki sayımlar). Aynı pencerede HEAD'de iki bekçi kırmızı (D-K-02, D-K-03) — yani "CI koşsaydı yakalardı" iddiası hipotetik değil, ölçülmüş.

**İş etkisi.** Sahaya çıkan her sürüm, tip kontrolünden ve 366 bekçiden geçmeden çıkıyor. Ekibin bugüne kadar kurduğu bütün mekanik koruma (route auth kapsaması, şema drifti, migration hijyeni, kilit sırası bekçileri) **yalnız birinin elle `npm test` yazmasına** bağlı.

**Öneri (2. tur için).** `ci.yml`de `branches: [main, adnansahin]` (push + PR). Ek olarak `backend` job'ına `timeout-minutes` ver (bugün hiçbir job'da yok → GitHub varsayılanı 360 dk; 366 × 180 sn tavanı teorik 18 saat). Migration/dal stratejisi değişirse iş akışını da güncelleyecek bir kural: `check-docs.mjs`e "ci.yml'deki dal listesi ile `deploy/*` script'lerinin paketlediği dal aynı mı" kontrolü eklenebilir.

**Kabul kriteri.** `adnansahin`e atılan bir push CI'da `backend` job'ını tetikliyor ve HEAD'de kırmızı veriyor (D-K-02/03 düzeltilmeden önce koşulursa kırmızı görmek BEKLENEN sonuçtur — kapının çalıştığının kanıtı).

**Efor.** 0,25 gün (dal listesi) + 0,5 gün (D-K-02/03'ün kırmızılarını temizlemek, yoksa kapı ilk gün devre dışı bırakılır).

**Önceki defter.** `F-OPS-VER-002` (`duzeltildi`, `productionDbGate`) aynı ailedendir ama farklı bir ayağı kapatmıştı; bu bulgu yeni.

---

### [D-K-02] Test paketi HEAD'de KIRMIZI: `client-policy` `GET /` ucu muaf listesine yazılmadı → `test_route_auth_coverage` düşüyor, `npm test` exit 1

| Şiddet | **S1** | Kategori | K | Öncelik | **P1** | Modül | ops/test · yetki | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Bugünkü HEAD commit'i (`ce8681d1`, 2026-08-28, "sürüm künyesi tek uçta") `client-policy.routes.ts`e kimliksiz bir `GET /` ucu ekledi. Uç **bilinçli olarak public** (dosya başlığı gerekçeyi yazıyor) ama `test_route_auth_coverage.ts`in `EXEMPT` haritasına eklenmedi. Bekçi tam da bu iş için var ve doğru çalışıyor — sorun, kırmızısının kimseye ulaşmaması (D-K-01).

**Kanıt.**
```ts
// Teks-Erp/src/routes/client-policy.routes.ts:59  (yalnız adnansahin'de; main'de yok)
router.get("/", (_req: Request, res: Response) => {
```
```ts
// Teks-Erp/scripts/test_route_auth_coverage.ts:60-63  → anahtar `METHOD <router-yerel yol>`
out.push({ key: `${methods} ${l.route.path}`,
           hasAuth: l.route.stack.some((s) => s.name === "verifyToken"), … });
// :185-190
const unexpected = unauth.filter((r) => !(r.key in EXEMPT));
check("muaf listesi dışında kimlik doğrulamasız uç YOK", unexpected.length === 0, …);
```
- `EXEMPT` (`:34-74`) 13 anahtar taşıyor; `"GET /:istemci"` VAR, **`"GET /"` YOK**.
- Mekanik teyit: `src/routes/*.ts` içinde `router.get("/"` yazan **ve dosyasında hiç `verifyToken` geçmeyen** tek dosya `client-policy.routes.ts:59` (tarama koşuldu).
- Mount: `app.ts:587` `app.use("/api/client-policy", clientPolicyRoutes)` — router seviyesinde `verifyToken` yok (beceri §7.8'in altı kaynağı çözüldü: route satırı ✗, dizi sabiti ✗, tekil sabit ✗, `router.use` ✗, mount ✗, handler-içi dinamik ✗).
- `git show origin/main:…/client-policy.routes.ts | grep router.get` → **çıktı yok** (uç `main`'de mevcut değil) → CI hiç görmedi.

**failure_mode.** `npm test` HEAD'de `test_route_auth_coverage.ts` için exit 1 döner → koşucu paket sonucunu "BAŞARISIZ" basar. Bugünden itibaren paketin ikili sinyali ("yeşil mi") **bilgi taşımıyor**: yeni bir gerçek yetki açığı da aynı kırmızıya karışır ve "zaten kırmızıydı" diye geçilir. Somut senaryo: birisi `sacks.routes.ts`e `router.get("/")` ekleyip `verifyToken` yazmayı unutur; bekçi bunu **da** `unexpected` listesine koyar ama satır zaten kırmızı olduğu için fark edilmez → çuval envanteri kimliksiz okunabilir hâle gelir.

**Veride fiili ihlal (K2).** Aranmadı — kod seviyesi bulgusu; koşum yapılamadı (salt-okunur kural). Kırmızılık kodun kendisinden **deterministik** olarak türetilebiliyor (yukarıdaki üç adım).

**İş etkisi.** Ekibin en pahalı mekanik korumasının (her ucun kimlik zinciri) sinyal değeri bugün sıfır.

**Öneri.** `EXEMPT`e `"GET /": "sunucu sürüm künyesi — panel giriş öncesi sorar; salt-okunur, iki sürüm numarası"` satırı. ⚠️ Anahtar router-yerel olduğu için `"GET /"` **çok jenerik**: ileride başka bir router'a kimliksiz `GET /` gelirse bu muafiyet onu da sessizce affeder. Doğru düzeltme, muaf anahtarını **mount yolunu da içerecek** biçimde üretmektir (`collectRoutes` layer yürüyüşünde üst prefix'i biriktirerek `GET /api/client-policy/` anahtarı). O yapılamıyorsa muafiyeti dar tut ve `test_client_policy.ts`e "bu ucun public kalması bilinçli" ikinci bir kontrol koy.

**Kabul kriteri.** `npx tsx scripts/test_route_auth_coverage.ts` yeşil; `client-policy.routes.ts`e ikinci bir kimliksiz uç eklendiğinde kırmızı veriyor (negatif sonda).

**Efor.** 0,25 gün (jenerik anahtar) / 0,75 gün (mount-prefix'li anahtar üretimi + muaf listesinin yeniden yazılması).

---

### [D-K-03] Paket ayrıca KALICI kırmızı taşıyor: `test_db_invariants` dev'de §5, sahada §1 — "bilerek kırmızı" tasarımı ikili sinyali yok ediyor (kırmızı körlüğü)

| Şiddet | **S2** | Kategori | K | Öncelik | **P2** | Modül | ops/test · şema | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İki ad-mükerreri seddi "yumuşak kapı" migration'la geliyor: mükerrer varsa index ATLANIR. `test_db_invariants.ts` eksik index'i `check(false)` ile raporlar ve `process.exit(1)` verir; dosya yorumları bunu **bilerek** yaptıklarını yazıyor ("enforce bekliyor sinyali"). Sonuç: dev'de renk seddi, sahada kumaş seddi eksik → bekçi **her iki ortamda da kalıcı kırmızı**.

**Kanıt.**
```ts
// Teks-Erp/scripts/test_db_invariants.ts:176-180
// ⚠️ YUMUŞAK KAPI (2026-08-22): migration mükerrer varken bu index'leri ATLAR. PROD'da
// temizlik bitene dek bu üç satır KIRMIZI olabilir ve bu BİLEREK böyle
{ table: "items", index: "items_nameFold_key", uniq: true, … }
// :259-261  (§5 ifade-unique'leri)
//    bu satır KIRMIZI kalır — bilerek ("enforce bekliyor" sinyali; §1 nameFold emsali).
// :577-586  eksik index → check(exp.index, false, "expression index YOK …")
// :792      process.exit(fail > 0 ? 1 : 0);
```
**K2 ölçümü (2026-08-28):**
```sql
-- dev (adnansahin_db):        customers_nameFold_key · items_nameFold_key · subcontractors_nameFold_key  ✔
--                             colors_nameFoldColor_key                                                   ✘
-- saha (tekserp_saha_0825):   customers_nameFold_key · colors_nameFoldColor_key · subcontractors_nameFold_key ✔
--                             items_nameFold_key                                                          ✘
SELECT count(*) FROM (SELECT tr_fold_color(name) f FROM colors
                      WHERE "mergedIntoId" IS NULL GROUP BY 1 HAVING count(*)>1) x;   -- dev → 1
SELECT migration_name, finished_at IS NOT NULL FROM _prisma_migrations
 WHERE migration_name LIKE '%color_name_unique%';                                     -- 20260825120000 | t
```
Yani migration "uygulandı" damgası taşıyor, index yok — yumuşak kapı devrede.

**failure_mode.** `npm test` her koşumda en az bir kırmızı satır basar. Ekip "hangi kırmızı yeni" sorusunu ancak satır satır fark alarak cevaplayabilir; pratikte cevaplamaz. Somut: `work_sessions_active_machine_uq` (makine başına tek aktif oturum) bir migration'da yanlışlıkla düşerse, `test_db_invariants` onu da aynı kırmızı yığınına ekler ve kimse iki operatörün aynı makinede oturum açabildiğini fark etmez.

**İş etkisi.** İki mekanik kapının (D-K-02 ile birlikte) sinyal değeri kayboluyor; "npm test yeşil mi" merge/deploy kriteri olarak kullanılamıyor.

**Öneri.** "Bilerek kırmızı"yı **kırmızı değil, ÜÇÜNCÜ bir durum** yap: eksik-ama-beklenen index'ler için `pendingEnforcement` listesi + `check()` yerine `warn()` (exit koduna girmez) **ve** ayrı bir zorunlu kontrol: *"`pendingEnforcement` listesindeki her satır için o tabloda GERÇEKTEN mükerrer var mı"* — mükerrer temizlenmiş ama index hâlâ yoksa **kırmızı** (yani "enforce'u koşmayı unuttun"). Böylece kırmızı yeniden anlam kazanır ve unutulma yolu kapanır. ⚠️ `pendingEnforcement`'a satır eklemek bir karardır: listeye giren her index'in `audit/` ya da `docs/`de bir sahibi ve tarihi olmalı.

**Kabul kriteri.** Temiz bir DB'de (`teks_ci`) test yeşil; dev'de "renk seddi enforce bekliyor (1 mükerrer grup)" UYARI basıyor ama exit 0; mükerrer elle temizlenip index yeniden koşulmazsa KIRMIZI.

**Efor.** 0,5 gün.

**Önceki defter.** K2b H-11 ("`test_db_invariants` sahada §1 / dev'de §5 bilerek kırmızı — kırmızı körlüğü") ile aynı; burada K2 ile ölçüldü ve düzeltme şekli önerildi.

---

### [D-K-04] Para/stok etkili ALTI P0 yazma yolunda tek bir paralel yazma sondası yok — sevkiyat kurma/onaylama dahil

| Şiddet | **S1** | Kategori | K ("Eşzamanlılık testi var mı? … Yoksa bu başlı başına bir bulgudur") | Öncelik | **P1** | Modül | sevkiyat · fason · iş emri · sipariş | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** 366 bekçinin 27'si gerçek paralel yazma yapıyor (33 sonda). Bu sondaların hiçbiri sevkiyat kurma/onaylama, fason kabul iptali/kalan kapama, iş emri kapanış dispozisyonu ve sipariş bağla-sök-kalem iptali yollarına dokunmuyor. Bunlar `KRITIK-YAZMA-YOLLARI.md` §6'da P0 işaretli ve `EŞZ ✗` sütunuyla listeli yollar; ben mekanik olarak yeniden doğruladım.

**Kanıt (mekanik tarama — her sembol için `Promise.all/allSettled` bloklarının gövdesi okundu).**

| Yol (src) | Yazma yolu | Paralel sonda | Var olan bekçi ne ölçüyor |
|---|---|---|---|
| `shipping.service.ts:1376` `createShipment` | çuval→sevkiyat tahsisi | **YOK** | `test_shipping_client_token.ts:82-88` — SIRALI token replay |
| `shipping.service.ts:1890` `dispatchShipment` | PLANNED→DISPATCHED, `SHIPPED` stok düşümü | **YOK** | `test_shipment_list_gross` (liste toplamı), `test_shipment_undo_dispatch` (sıralı) |
| `subcontractor.service.ts` `cancelReceipt` (LIFO) | makbuz iptali + `currentQty` geri koyma | **YOK** | `test_fason_receive_cancel_rereceive.ts` — sıralı |
| `subcontractor.service.ts` `closeRemainder` | `remainderClosedAt` + `RollVariance` fire | **YOK** | `test_fason_partial_receive.ts` — sıralı |
| `workorder.service.ts` `completeWorkOrder` (kapanış dispozisyonu) | N topun statüsünü toplu değiştirir | **YOK** | `test_wo_manual_complete`, `test_wo_cancel_disposition` — sıralı |
| `workorder-link.service.ts` `linkOrderLines`/`unlinkOrderLine`, `order.service.ts:475` `cancelOrderLine` | `WO.type` flip + `shippedQty` defteri | **YOK** | `test_workorder_order_link`, `test_order_line_cancel` — sıralı |

Ek olarak paralel sondası olmayan yollar: parti cerrahisi (`splitBatch`/`mergeBatches`/`moveRolls`), master-data `merge` (8027), `session-registry.open` (8024), `openSack` çift-açma, iade×iade (`createReturn` iki kez), storno×storno, kartela `dispatch`/`receive`, `completeQc2` paralel, `import.apply` paralel, `grantPermission`/`setPermissions`/`applyTemplate` paralel, `tambur-undo.applySingle/applyFull`, `finalizeRollsAtLastStep`.

**Var olan 33 sondanın tam listesi** K11 §2a'dadır; hiçbiri yukarıdaki satırlara değmiyor. Doğrulama komutu (yeniden üretilebilir):
```bash
cd Teks-Erp/scripts && grep -n -A9 'Promise\.\(all\|allSettled\)(' test_*.ts \
  | grep -E 'Service\.|svc\.|sub\.|shippingService\.|orders\.|tambur\.'
```
→ çıkan servis çağrıları: `DeviceService.announce`, `deactivateUser`, `reserveRollBarcodes`, `runBackupJob`, `executeDirectShip`, `sub.receive`, `sub.dispatch`, `startCopyJob`, `itemService.create`, `createInitialEntry`, `bypassSvc.assign/completeFromTambur`, `manualComplete`, `softDelete`, `reopen`, `voidCard`, `reportError`, `undoDispatch‖createReturn`, `kartelaService.dispatch‖scanIntoSack`, `cards.print`, `WorkSessionService.open`, `cutWarehouseRoll`, `lockWorkOrder`, `reserveLoginAttempt`. **Liste bu kadar.**

**failure_mode.** Sevk onayı örneği: iki depo tableti aynı `shipmentId` için "Sevk Et"e 300 ms arayla basar (vardiya sonu yığılması; ölçülmüş emsal 2026-08-04'te 46 ms içinde 5 yazma). `dispatchShipment` bugün claim kullanıyor olabilir — **ama hiçbir test bunu ölçmüyor**. Claim'i kaldıran ya da `where`ine yanlış statü yazan bir refactor, 366 bekçinin tamamı yeşilken sahaya çıkar; iki `SackAllocation` yazılır ve `OrderLine.shippedQty` iki kez artar → sipariş "fazla sevk edilmiş" görünür, müşteriye kesilecek irsaliye rakamı yanlış olur. Aynı cümle `completeWorkOrder` için: iki kullanıcı aynı iş emrini paralel kapatır, kapanış dispozisyonu iki kez uygulanır, `WAREHOUSE`a çekilen top ikinci turda `A1_STOCK`a yazılır.

**Veride fiili ihlal (K2).** Aranmadı — bu bulgu **bekçi yokluğu** bulgusudur, koddaki koruma boşluğu D-A/D-B'nin alanıdır (`MATRIX.md` §D 1-30 ve `KRITIK-YAZMA-YOLLARI.md` §6 CTA sütunu bu yollarda açık nokta işaretliyor; ben oraya girmiyorum).

**İş etkisi.** Fabrikanın en pahalı beş kaydı (sevkiyat, fason makbuzu, iş emri kapanışı, sipariş bağı, parti) için "iki kişi aynı anda yaparsa ne olur" sorusunun mekanik cevabı yok. Bu yolların hepsi bugün 5-10 tabletli bir sahada koşuyor.

**Öneri.** Aşağıdaki "Ekibe verilecek bekçi listesi"nin 1-6. maddeleri. Ortak biçim: `Promise.allSettled([f(), f()])` + **"tam 1 fulfilled + tam 1 × 409"** iddiası (yalnız "invariant bozulmadı" değil — bkz. D-K-15) + DB'de sonuç sayımı. Emsal olarak `test_dispatch_claim_step_match.ts:106-134` kopyalanabilir (en temiz iki-taraflı sonda).

**Kabul kriteri.** Altı yolun her biri için bir sonda; her sonda, ilgili claim/kilit satırı kaynaktan silindiğinde KIRMIZI verdiği **not edilerek** (negatif sonda, D-K-22) commit ediliyor.

**Efor.** 4-6 gün (yol başına ~0,75 gün; fixture'ların çoğu mevcut: `fixture-subcontractor.ts`, `test_sack_status_invariant.ts`'in çuval kurulumu, `test_shipment_scope_lock.ts`'in sevkiyat kurulumu yeniden kullanılabilir).

**Önceki defter.** `F-SEV-ESZ-001/002/003` (hepsi `duzeltildi`/`acik-ölçüm`) sevkiyat tarafına dokundu ama **`createShipment`/`dispatchShipment` paralel sondası hiç yazılmadı**; K12 satır 142 (`F-SEV-ESZ-003`) "claim count AST bekçisi yazılmadı" diyor — bu bulgu onun davranış ayağı.

---

### [D-K-05] İdempotency'nin 4. durumu ("iptal edilmiş kaydın token'ı") — bir yolda kod var/bekçi yok, dört yolda ikisi de yok

| Şiddet | **S1** | Kategori | K (idempotency testi) + beceri §8 | Öncelik | **P1** | Modül | KK1 · sipariş · sevkiyat · çuval · fason · import | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Replay'in dört durumu var: (a) kayıt var-geçerli, (b) kayıt var-**İPTAL**, (c) token yok, (d) token var-farklı payload. Bekçiler (a), (c), (d)'yi 18-20 yolda ölçüyor. (b) — beceri §8'in *"en pahalı hata"* dediği durum — **yalnız manuel top yolunda** ölçülüyor. Kalan yolları tek tek okudum: `RECEIPT_CANCELLED` kodda var ama sıfır bekçi; KK1/Order/Shipment/Sack'te ne kod ne bekçi.

**Kanıt — dört-durum matrisi (kod okuması + `grep -rl` ile bekçi araması):**

| Yol | İptal-replay KODDA | Bekçi |
|---|---|---|
| Manuel top `tambur-manual.service.ts:1049,:1405` | ✔ 409 `ENTRY_CANCELLED` | ✔ `test_manual_roll_undo.ts:254` — **tek örnek** |
| WO create `workorder.service.ts` | ✔ `isActive:false` → 409 | ✔ `test_client_token_idempotency.ts:182-189` (CT6) |
| Fason makbuz `subcontractor.service.ts:2359-2364` | ✔ 409 `RECEIPT_CANCELLED` | **✗ — `grep -rl RECEIPT_CANCELLED scripts/test_*.ts` → 0 dosya** |
| **KK1** `inventory.service.ts:963-996` | **✗** | ✗ |
| **Sipariş** `order.service.ts:2026-2049` | **✗** | ✗ |
| **Sevkiyat** `shipping.service.ts:1362-1374` | **✗** | ✗ |
| **Çuval** `shipping.service.ts:181-199` | **✗** (`status` hiç seçilmiyor) | ✗ |
| İçe aktarım `import/import.service.ts:447-472` | kısmen (yalnız tamamlanmış koşum) | ✗ |

Kod alıntıları:
```ts
// inventory.service.ts:972-983 — KK1 replay: `existing.status` HİÇ okunmuyor
const sameItem  = existing.itemId === data.itemId;
const sameColor = existing.colorId === (data.colorId ?? null);
const sameQty   = new Prisma.Decimal(data.initialQty).equals(existing.initialQty);
if (sameItem && sameColor && sameQty) {
  return { success: true, data: existing,
           message: `Top zaten kayıtlı (idempotent retry). Barkod: ${existing.barcode}` };
}
```
```ts
// shipping.service.ts:1362-1373 — sevkiyat replay: status OKUNUYOR ama CANCELLED elenmiyor
const sh = await prisma.shipment.findUnique({ where: { clientToken },
             select: { id: true, shipmentNo: true, status: true } });
if (!sh) return null;
const dispatched = sh.status === ShipmentStatus.DISPATCHED;
return { success: true, data: {…, status: sh.status, dispatched },
         message: dispatched ? `Sevk edildi: …` : `Sevkiyat kuruldu (onay bekliyor): …` };
```
"Koruma yok" teyidi: token `@unique` (`test_db_invariants.ts:109,125,156,159` partial UNIQUE envanterinde), advisory kilit ve claim de bu dallarda YOK — replay dalı P2002 catch'inin içinde ve tx dışında; hiçbiri statü kontrolü yapmıyor.

**failure_mode (KK1, sahadan modellenmiş).** Operatör topu KK1'de girer, sonra hatalı olduğunu görüp iptal eder (`CANCELLED`). Aynı tablette çevrimdışı kuyruk hâlâ o denemeyi tutuyordur (memory notu: token "sonucu belirsiz" hatada YAPIŞIR) ve bağlantı gelince aynı `clientToken` ile tekrar gönderir. Sunucu P2002 alır, iptal edilmiş topu bulur, kimlik alanları aynı olduğu için **`success: true` + "Top zaten kayıtlı. Barkod: T…"** döner. Operatör yeşil bildirim görür, etiketi basar ve topu rafa koyar; envanterde o top `CANCELLED`'dır, hiçbir listede görünmez (kök CLAUDE.md 2026-08-25 ②b: iptal edilen 231 top hiçbir yüzeyde görünmüyordu). Fiziksel mal ile kayıt arasında sessiz bir kopukluk doğar.

**Sevkiyat varyantı:** iptal edilmiş bir sevkiyatın token'ı replay edilirse yanıt `success:true` + `"Sevkiyat kuruldu (onay bekliyor)"` metnini basar (`dispatched=false` dalı) — oysa sevkiyat `CANCELLED`'dır. Sevkiyatçı "kuruldu" görür, Sevk Kapısı'nda bulamaz.

**Veride fiili ihlal (K2).** Aranmadı — replay olayının izi `clientToken` sütununda tutulmuyor (aynı token tek satır üretir, ikinci çağrı yazmaz), yani ihlal DB'den geriye dönük ölçülemez. Bu, bulgunun **yalnız bekçiyle** yakalanabilir bir sınıf olduğunun kendisidir.

**İş etkisi.** Depoda/üretimde "sistemde yok ama elimde var" ve sevkiyatta "kuruldu dedi ama listede yok" sınıfı. En kötüsü: hata **sessiz** ve kullanıcı yanlış bilgiyle ilerliyor (409 almaktan daha kötü — beceri §8).

**Öneri.** İki katman: ① `RECEIPT_CANCELLED` için mevcut kodu ölçen bekçi (`test_fason_receive_cancel_rereceive.ts`e §: kabul → iptal → aynı token replay → 409 `RECEIPT_CANCELLED` beklenir); ② KK1 / Order / Shipment / Sack replay dallarına statü kontrolü **eklendikten sonra** (kod değişikliği D-B/D-E'nin önerisi olacak) her biri için aynı üçlü sonda. Bekçi ÖNCE yazılıp kırmızı bırakılabilir — düzeltmenin kabul kriteri olur. ⚠️ `test_client_token_idempotency.ts` bu dört-durum matrisini dosya başlığında **tablo olarak** taşımalı ki yeni bir `clientToken`'lı uç eklendiğinde hangi durumun ölçüleceği unutulmasın.

**Kabul kriteri.** Altı yolun her biri için "kayıt iptal → aynı token → 409 + `code`" kontrolü; her kontrol, statü kontrolü koddan silindiğinde kırmızı veriyor.

**Efor.** 1,5 gün (bekçiler) — kod düzeltmesi ayrı.

**Önceki defter.** K11 H-9 / `KRITIK-YAZMA-YOLLARI.md` §7.4 ile aynı; burada `RECEIPT_CANCELLED`'ın **kodda var, bekçide yok** olduğu ve Order/Shipment/Sack replay gövdelerinin okunmuş hâli eklendi.

---

### [D-K-06] `test_qc2_idempotency.ts` KK2 idempotency'sinin TEK bekçisi ama servisi hiç çağırmıyor — Prisma'nın `@@unique`'ini test ediyor, üstelik rastgele canlı kayıt üzerinde

| Şiddet | **S2** | Kategori | K (idempotency + test verisi izolasyonu) | Öncelik | **P2** | Modül | kurşun/KK2 | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** K11 §3 #23 bu dosyayı "KK2 `completeQc2` idempotency mekanizması" bekçisi olarak listeliyor. Dosyayı açtım: `KursunQcService.completeQc2`'yi **hiç çağırmıyor**; doğrudan `prisma.rollOperation.upsert` yapıp Prisma/PostgreSQL'in `@@unique`'inin çalıştığını doğruluyor. Ayrıca fixture kullanmıyor — DB'den **rastgele** bir kayıt seçip üzerine yazıyor.

**Kanıt.**
```ts
// Teks-Erp/scripts/test_qc2_idempotency.ts:1-3
// Tek-seferlik idempotency doğrulama testi (Kurşun completeQc2 @@unique).
// Bittikten sonra script silinebilir.            ← kalıcı pakete girmiş geçici script
// :22-26  rastgele CANLI kayıt
const op = await prisma.rollOperation.findFirst({
  where: { operationType: RollOperationType.QC2_COMPLETED }, … });
// :40-52  yoksa: RASTGELE bir PROCESS_QC adımı + RASTGELE bir top eşleştirir
const step = await prisma.workOrderStep.findFirst({ where: { station: { kind: "PROCESS_QC" } }, … });
const roll = await prisma.roll.findFirst({ where: { status: { notIn: ["CANCELLED","SCRAP"] } }, … });
if (!step || !roll) { console.log("Test verisi yetersiz …"); return; }   // ← SESSİZ YEŞİL
// :62-79  servis değil, doğrudan ORM
await prisma.rollOperation.upsert({ where: { rollId_workOrderStepId_operationType: {…} },
                                    create: {…}, update: {} });
```
Servisin gerçek yolu ise bambaşka (guard + tx + audit-skip taşıyor):
```ts
// src/services/kursun-qc.service.ts:429-465
const existedBefore = await prisma.rollOperation.findUnique({…});      // tx DIŞINDA
const op = await prisma.$transaction(async (tx) => {
  await assertKursunTabletMayWrite(tx, data.stepId, "KK2 tamamlama");  // ← ölçülmüyor
  const qc2Op = await tx.rollOperation.upsert({ …, update: {} });      // ← ölçülen tek şey bu
```
"Koruma yok" teyidi: `grep -l completeQc2 scripts/test_*.ts` → 6 dosya; `test_qc2_idempotency` yalnız başlıkta anıyor, diğer beşi (`test_e2e_full_flow`, `test_kursun_bypass`, `test_kursun_regime_lock`, `test_kursun_unassigned_close`, `test_property_value_selection`) çağırıyor ama **hiçbiri çift çağrı/idempotency ölçmüyor** (paralel sonda için de bkz. D-K-04).

**failure_mode.** ① Regresyon körlüğü: `completeQc2`'nin `update: {}` dalı `update: { metadata }` yapılırsa (makul bir "notu güncelleyelim" değişikliği), replay artık idempotent değildir — offline outbox replay'i mevcut op'un metadata'sını ezer ve `existedBefore` mantığı yanlış audit yazar. Test yeşil kalır, çünkü servisi hiç çağırmıyor. ② Veri riski: `!preexisting` dalında test, **birbiriyle ilgisiz** bir topa ve bir PROCESS_QC adımına `QC2_COMPLETED` operasyonu YAZAR (sonra siler). Süreç bu ikisi arasında ölürse (koşucunun 180 sn SIGTERM'i, Ctrl-C) sahte bir "KK2 tamamlandı" kaydı kalıcı olur; `kursun-qc.service.ts:814-820` "tüm açık rollerde QC2_COMPLETED olmalı" kontrolünü besleyen tablo budur → adım hiç yapılmadan tamamlanmış sayılabilir. ③ Sessiz yeşil: "Test verisi yetersiz" dalı `return` eder, `fail` 0 kalır, exit 0 → boş bir DB'de bekçi hiçbir şey ölçmeden geçer.

**Veride fiili ihlal (K2).** Aranmadı — sahte op yalnız süreç yarıda kesilirse kalır ve bugünkü dev/saha verisinde ayırt edilemez (`metadata.idempotencyTest` işareti yalnız `create` dalında var; taranabilir ama saha kopyasında test koşulmadığı için anlamsız).

**İş etkisi.** KK2 idempotency'si — offline tabletlerin en çok replay ettiği operasyon — fiilen bekçisiz.

**Öneri.** Dosyayı `KursunQcService.completeQc2` üzerinden yeniden yaz: kendi fixture'ını kur (`TEST-QC2-*` iş emri + adım + top), çift çağır, tek op + tek audit + `assertKursunTabletMayWrite` reddi dallarını ölç, `finally`de temizle. "Veri yetersiz" dalını **kırmızıya** çevir (fixture'ını kendisi kurduğu için o dal artık gerçek bir arızadır). Dosya başlığındaki "bittikten sonra silinebilir" cümlesi kaldırılmalı.

**Kabul kriteri.** `update: {}` → `update: { metadata: … }` yapıldığında test KIRMIZI; `assertKursunTabletMayWrite` çağrısı silindiğinde KIRMIZI.

**Efor.** 0,75 gün.

---

### [D-K-07] `test_manual_move_fason_receive.ts` fixture'sız — rastgele bir AÇIK fason sevkinde GERÇEK kabul yapıyor, temizliği yok, tek-dosya koşumunda üretim kapısı da yok

| Şiddet | **S1** | Kategori | K (test verisi izolasyonu) | Öncelik | **P1** | Modül | fason · ops/test | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** 54 satırlık bu bekçi hiçbir fixture kurmaz. DB'den **rastgele** açık bir fason sevki bulur ve üzerinde gerçek bir `SubcontractorService.receive` koşturur: orijinal toplar `SUBCONTRACTOR_CONSUMED`'a çekilir, yeni açık-kumaş toplar doğar, makbuz + parti yazılır. **Hiçbir temizlik yoktur** (`deleteMany` sayısı: 0). Ve bu işlem geri alınamaz sınıftadır (fason kabulünün iptali ayrı bir LIFO akışıdır).

**Kanıt.**
```ts
// Teks-Erp/scripts/test_manual_move_fason_receive.ts:12-17
const disp = await p.subcontractorDispatch.findFirst({
  where: { cancelledAt: null, directShippedAt: null,
           items: { some: { roll: { status: "AT_SUBCONTRACTOR", batchId: { not: null } } } } }, … });
if (!disp) { console.log("(fasonda açık-dispatch'li batch yok — test atlanıyor)");
             await p.$disconnect(); process.exit(0); }   // ← sessiz YEŞİL
// :35-41  GERÇEK kabul
const res = await scSvc.receive({ workOrderId: disp.workOrderId, stepId: target.stepId,
  subcontractorId: target.subcontractorId,
  returns: target.rolls.map((r) => ({ rollId: r.id })), newRolls: [{ qty: totalQty }] });
// dosyada `deleteMany` / `finally` / teardown YOK (dosya 54 satır, tamamı okundu)
```
Filtre `TEST-`/`TST-`/`DEMO-` öneki **aramıyor** — üretim iş emirlerini ve gerçek fason sevklerini birebir aynı sorguyla bulur.

Kapı teyidi: `productionDbGate()` yalnız `scripts/run-all-tests.ts:102,174`te; 366 testin **hiçbirinde** ortam kontrolü yok (grep). `Teks-Erp/CLAUDE.md`'nin önerdiği normal koşum biçimi `npx tsx scripts/test_X.ts` — yani kapısız yol.

**failure_mode.** Bir geliştirici saha teşhisi için `.env`'i saha yedeğine (veya SSH tüneliyle `localhost:5432`'ye maplenmiş üretim DB'sine) çevirir ve bu tek dosyayı koşar. Kapı yoktur (tek-dosya koşumu) ve host `localhost` göründüğü için koşucuyla koşulsa bile geçerdi. Test, fabrikanın **fasondaki gerçek malı** için sahte bir kabul yazar: 3 top `SUBCONTRACTOR_CONSUMED` olur (artık sevk edilemez, listelerden düşer), yerlerine tek bir sahte top doğar, kalem kapanır ve o sevk "fasondan geldi" sayılır. Boyahanedeki mal fiziksel olarak hâlâ dışarıdadır. Dev DB'de ise her koşum kalıcı artık bırakır ve **sonraki koşumlarda başka bir sevki tüketir** (rastgele seçim).

**Veride fiili ihlal (K2).** Aranmadı — dev DB'deki fason kabullerinin hangisinin bu testten geldiği ayırt edilemez (test hiçbir işaret bırakmıyor; işaretsizliğin kendisi bulgunun parçası).

**İş etkisi.** Geri alınamaz üretim verisi kaybı riski + dev DB'de sürekli erozyon.

**Öneri.** ① Acil: dosyayı `fixture-subcontractor.ts` üzerinden kendi WO+sevkini kuracak biçimde yeniden yaz ve `finally` temizliği ekle (⚠️ `rollVariance.deleteMany` DAHİL — RESTRICT FK, bkz. D-K-24). ② Yapısal: `productionDbGate()`i paylaşımlı bir modüle (`scripts/_guard.ts`) çıkar ve **her** `test_*.ts`in ilk satırına koy; mekanik bekçisi `test_env_gate_coverage.ts` (366 dosyanın hepsi guard'ı import ediyor mu — `test_route_auth_coverage`in muaf-listesi deseni). ③ Kapıyı host adından DB adına da genişlet (allowlist: `adnansahin_db`, `teks_ci`, `*_test`) — SSH tüneli/port yönlendirme host adını `localhost` gösterir.

**Kabul kriteri.** Dosya kendi fixture'ını kuruyor ve koşum sonrası `subcontractorReceipt` sayısı değişmiyor; guard'sız yeni bir `test_*.ts` eklendiğinde `test_env_gate_coverage` kırmızı veriyor.

**Efor.** 0,5 gün (dosya) + 1 gün (paylaşımlı guard + kapsama bekçisi).

**Önceki defter.** `F-OPS-VER-002` (`duzeltildi`) — K12 satır 125 sınırı açıkça yazmış: *"koruma yalnız koşucuda; 366 testin 0'ında ortam guard'ı"*. Bu bulgu o sınırın **somut ve yıkıcı** örneğidir.

---

### [D-K-08] Sessiz temizlik + eksik FK sırası: dev DB'de 480 `TST-WHA` iş emri (tablonun %63'ü) birikmiş; `clean_test_residue` bu öneki tanımıyor

| Şiddet | **S2** | Kategori | K (test verisi izolasyonu) | Öncelik | **P2** | Modül | ops/test | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `test_wo_warehouse_attach.ts`in temizlik bloğundaki **yedi ifadenin yedisi de** `.catch(() => {})` taşıyor ve blok `batch` silmiyor. `batches_workOrderId_fkey` **RESTRICT**tir → `workOrder.deleteMany` her koşumda P2003 atıyor, hata sessizce yutuluyor ve bir iş emri daha kalıcı oluyor. Kök nedeni DB'den zincirin tamamıyla doğruladım.

**Kanıt.**
```ts
// Teks-Erp/scripts/test_wo_warehouse_attach.ts:109-118  (yedi ifade, yedi sessiz catch, batch YOK)
await prisma.rollMovement.deleteMany({…}).catch(() => {});
await prisma.roll.updateMany({…}).catch(() => {});
await prisma.sack.deleteMany({…}).catch(() => {});
…
await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});   // ← P2003
```
**K2 ölçümü (dev, 2026-08-28):**
```
work_orders TST-WHA        480
work_orders toplam         762      → %63
work_orders TEST/TST öneki 558      → %73
users TEST-IMP-PERM         41 / 72
```
```sql
SELECT conname, confdeltype FROM pg_constraint
 WHERE conrelid='batches'::regclass AND confrelid='work_orders'::regclass;
-- batches_workOrderId_fkey | r        (= RESTRICT)
WITH w AS (SELECT id FROM work_orders WHERE "workOrderNumber" LIKE 'TST-WHA%')
SELECT 'batches', count(*) FROM batches WHERE "workOrderId" IN (SELECT id FROM w);
-- batches | 320            ← engelleyen bağ; steps 0, cards 0 (onlar siliniyor)
```
`grep -n batch scripts/test_wo_warehouse_attach.ts` → **çıktı yok** (temizlik parti bilmiyor).
`scripts/clean_test_residue.ts:27-31` beş önek grubu tanımlar (roll barkodu, sipariş no, kumaş kodu, renk kodu, müşteri kodu) — **iş emri numarası önekleri listesinde YOK**, yani araç bu 480 satırı görmüyor bile.

Genel ölçek: sessiz catch **150 dosya / 669 satır**; `deleteMany(...).catch(...)` deseni **87 dosyada**. Tip geçidi (`tsconfig.scripts.json`) yalnız *yanlış ilişki adı* sınıfını yakalar, FK sırasını yakalamaz.

**failure_mode.** ① Ölçüm kirliliği: `test_consistency.ts` ve raporlar dev DB'ye karşı koşulduğunda 558 sahte iş emri sayılara girer; `test_consistency`in `FIXTURE_PREFIXES` filtresi bunu maskeler ama **filtre kapsamı dışındaki her yeni bölüm** kirlenir (dosyanın kendi kuralı: "yeni bölüm eklerken filtreyi ÖNCE ekleme"). ② Performans: her koşum tabloyu büyütür; `work_orders` bugün %73 çöp. ③ En önemlisi: aynı desen (`deleteMany(...).catch(() => {})` + eksik FK sırası) **87 dosyada** var — bir gün gerçek bir temizlik hatası (yeni bir RESTRICT FK) çıktığında hiçbir yerde görünmeyecek.

**İş etkisi.** Dev DB fabrikanın canlı yedeği; kirlenmesi "gerçek veriye karşı ölçüm" yeteneğini aşındırıyor (K2 denetimlerinin dayanağı bu DB).

**Öneri.** ① `test_wo_warehouse_attach.ts` temizliğine `batch.deleteMany({ where: { workOrderId: { in: woIds } } })` ekle ve **sessiz catch'leri kaldır** — hata bas, sayaç artırma. ② `clean_test_residue.ts`e `WORK_ORDER_NUMBER_PREFIXES` + `USERNAME_PREFIXES` ekle ve dry-run'ı bir bekçiye bağla: `test_test_residue.ts` — "dev DB'de test önekli iş emri sayısı 0"; eşik aşılırsa KIRMIZI (`--apply` ÇAĞIRMAZ, yalnız ölçer). ③ Kural: temizlikte `.catch(() => {})` yerine `.catch((e) => { console.warn("cleanup:", e.code) })` — hatayı gizleme, koşumu da düşürme.

**Kabul kriteri.** `clean_test_residue.ts --apply` sonrası dev'de `work_orders` ~200; yeni bir koşum artık bırakmıyor; artık sayacı bekçisi eşiği aşınca kırmızı veriyor.

**Efor.** 0,75 gün.

---

### [D-K-09] Sevk & Termin Karnesi'nin GÜNLÜK serisi bekçisiz — `test_shipment_scorecard.ts` "daily" kelimesini hiç geçirmiyor; kardeş karneler ölçüyor

| Şiddet | **S2** | Kategori | K (kapsanmayan değişmez) | Öncelik | **P2** | Modül | raporlar/sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** "Dönemde sevk edilen metraj"ın TEK tanımı `reports/_shipped.ts` ilan edildi (kök CLAUDE.md 2026-08-09). Sevk Karnesi'nin özeti bu tanımı kullanıyor ve bekçisi var; aynı ekrandaki **günlük seri** ise ayrı, iade geri-eklemesiz ve doğrudan-sevksiz bir NET kopyadır ve hiçbir kontrolü yoktur. Kardeş karnelerde (`quality`, `scrap`) günlük toplam ÖLÇÜLÜYOR — asimetri bilinçli değil, boşluk.

**Kanıt.**
```bash
grep -n 'daily' Teks-Erp/scripts/test_shipment_scorecard.ts     # → HİÇ ÇIKTI YOK
grep -n 'daily' Teks-Erp/scripts/test_quality_scorecard.ts      # → :185 dailySum …
grep -n 'daily' Teks-Erp/scripts/test_scrap_scorecard.ts        # → :184-185 check("günlük seri", dailySum === 140)
```
Bekçinin ölçtükleri (`test_shipment_scorecard.ts:105-118`):
```ts
check("sevk metrajı 1000 m", sc.summary.shippedQty === 1000, …);
check("kırılım toplamı = özet", …byCustomer.reduce(…) === 1000, …);   // müşteri kırılımı ✔
check("iki karne aynı sevk rakamını söyler", sc.summary.shippedQty === ret.summary.shippedQty);
```
Kaynak (K7b §6.A E3'ün ölçümü, ben satırı doğruladım): `shipment-scorecard.report.service.ts:130-137` günlük seri `shipments s JOIN rolls r ON r."shipmentId"` üzerinden `SUM(currentQty)` — `RollReturn` geri-eklemesi ve `DirectShipment` YOK.

**failure_mode.** İçinde bir iade ya da bir fasondan-doğrudan-sevk bulunan bir dönemde ekranın üst şeridi (özet) "12.400 m sevk edildi" derken altındaki günlük grafiğin çubuklarının toplamı 11.950 m çıkar. Kullanıcı iki rakamı yan yana görür ve hangisinin doğru olduğunu bilemez; ne bir bekçi ne bir uyarı vardır. (Saha kopyasında `roll_returns` dolu — koşullar mevcut.)

**Veride fiili ihlal (K2).** Ölçüm K7b'de yapıldı (Σdaily ≠ summary koşullarının varlığı); ben bekçi tarafını doğruladım. Rakamı burada tekrar üretmedim — rapor semantiği K7b/D-? alanı.

**Öneri.** `test_shipment_scorecard.ts`e kardeşlerdeki tek satırı ekle: `check("günlük seri toplamı = özet", Σ sc.daily.shippedQty === sc.summary.shippedQty)` ve fixture'a **bir iade + bir doğrudan sevk** koy (bu ikisi olmadan kontrol bugün de yeşil geçer — etkisiz sonda tuzağı, `test_kk1_duplicate_guard`in S6 dersi). Kırmızı verirse düzeltme raporda: günlük seri de `_shipped.ts`ten beslenmeli.

**Kabul kriteri.** Fixture iade içeriyorken kontrol KIRMIZI; günlük seri `_shipped.ts`e taşındıktan sonra YEŞİL.

**Efor.** 0,5 gün (bekçi) — servis düzeltmesi ayrı.

---

### [D-K-10] Kalite/Fire Karnesi'nin bekçisi damganın TAZELENMESİNİ ölçüyor, "yeniden üretime alınmış ama henüz bitmemiş top karneden DÜŞMELİ" kuralını ölçmüyor — saha kopyasında 4 top / 475 m sızıyor

| Şiddet | **S2** | Kategori | K (bekçi kör noktası) | Öncelik | **P2** | Modül | raporlar/kalite | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `test_quality_scorecard.ts §8` üç geçişi ölçüyor: (a) üretim→depo damgalanır, (b) SHIPPED→WAREHOUSE (storno) damgayı DEĞİŞTİRMEZ, (c) IN_PRODUCTION→A1_STOCK damga TAZELENİR. Ölçmediği dördüncü geçiş: **WAREHOUSE→IN_PRODUCTION'da kalmak.** Orada damga eski dönemi göstermeye devam eder ve karnenin statü süzgeci (`status NOT IN K18`) o topu elemez — çünkü `IN_PRODUCTION`/`AT_SUBCONTRACTOR` K18'de yoktur. Bekçi, hatanın **tam olarak bulunduğu geçişte** kör.

**Kanıt.**
```ts
// scripts/test_quality_scorecard.ts:275-284 — ölçülen dördüncü adım: geri final statüye DÖNER
await prisma.roll.update({ where: { id: stampProbe }, data: { status: "IN_PRODUCTION" } });
await prisma.roll.update({ where: { id: stampProbe }, data: { status: "A1_STOCK" } });   // ← final
check("yeniden üretim → yeni final: damga TAZELENİR", (afterRework?.finalizedAt ?? 0) > PINNED);
// `IN_PRODUCTION`da BIRAKIP karneyi yeniden sorgulayan kontrol YOK (dosya tarandı).
```
```ts
// src/services/reports/quality-scorecard.report.service.ts:194, :318
AND r.status::text NOT IN (${Prisma.join(K18_DEAD_STATUSES.map((s) => s as string))})
// src/services/batch.service.ts:55-60
export const K18_DEAD_STATUSES = [SUBCONTRACTOR_CONSUMED, TAMBUR_CONSUMED, KARTELA_CONSUMED, CANCELLED];
//   → IN_PRODUCTION ve AT_SUBCONTRACTOR ELENMİYOR
```
**K2 ölçümü (saha kopyası, kendi sorgum):**
```sql
SELECT status, count(*), round(sum("currentQty")::numeric,1) FROM rolls
 WHERE "finalizedAt" IS NOT NULL
   AND status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED')
   AND status NOT IN ('WAREHOUSE','A1_STOCK','SCRAP','SHIPPED')
 GROUP BY 1;
-- IN_PRODUCTION    | 1 |  30.0
-- AT_SUBCONTRACTOR | 3 | 445.0
```
Yani bugün saha verisinde **4 top / 475 m** hâlâ eski dönemin kalite ve fire karnesinde, eski kalitesiyle sayılıyor.

**failure_mode.** Temmuz'da 1. kalite damgalanmış 445 m'lik üç top Ağustos'ta boyahaneye geri gönderilir (`AT_SUBCONTRACTOR`). Temmuz'un Kalite Karnesi hâlâ o 445 m'yi "üretildi, 1. kalite" sayar; fabrika bir aylık üretimini olduğundan yüksek okur ve fire oranını (`fire / üretilen`) olduğundan düşük görür. Toplar Ağustos'ta tekrar bitince damga tazelenir ve **aynı metraj ikinci kez** üretim sayılır. Bekçi §8 bu son adımı ("tazelenir") doğruluyor — yani çift sayımın ikinci yarısını onaylıyor, birinci yarısını görmüyor.

**Öneri.** `test_quality_scorecard.ts §8`e beşinci adım: damgayı geçmişe sabitle → topu `IN_PRODUCTION`da BIRAK → `getQualityScorecard(eskiDönem)` çağır → o topun metrajı **çıkmamalı**. Bugün kırmızı verecektir; düzeltme (karne süzgecine `IN_PRODUCTION`/`AT_SUBCONTRACTOR` eklemek mi, yoksa yeniden-üretime-almada damgayı NULL'lamak mı) bir iş kararıdır ve raporda ayrı tartışılmalı — **bekçi önce yazılıp kırmızı bırakılabilir** (kabul kriteri işlevi görür).

**Kabul kriteri.** Yeni kontrol bugün kırmızı; karar uygulandıktan sonra yeşil ve `status` süzgeci gevşetilirse yeniden kırmızı.

**Efor.** 0,25 gün (bekçi) — iş kararı + düzeltme ayrı.

**Önceki defter.** K7b H2 ile aynı olgu; burada **bekçinin neden görmediği** (ölçtüğü geçişin farklı olması) ve K2 ölçümünün bağımsız tekrarı eklendi.

---

### [D-K-11] Fason "açık+outstanding" tek-kaynak AST bekçisi yalnız TS nesne literallerini tarıyor — aynı koşulun ÜÇ ham-SQL kopyası kapsam dışı; kardeş bekçi ham SQL'i TARIYOR (asimetri)

| Şiddet | **S2** | Kategori | K (bekçi kör noktası) | Öncelik | **P2** | Modül | fason · raporlar | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `test_fason_open_dispatch_single_source.ts`, 2026-08-21'de 22 elle kopyanın dördünün eksik olduğu bulunduktan sonra yazıldı ve dosya başlığı *"kopyanın GERİ GELMESİNİ yakalar"* diyor. TypeScript AST üzerinden tarıyor — dolayısıyla aynı koşulun **template-literal içindeki ham SQL** kopyalarını göremiyor. Bugün üç kopya var. Kardeş bekçi `test_order_line_scope_single_source.ts` aynı sınıf için §2'de ham SQL'i **tarıyor** (muaf listesi + bayat-muaf kontrolüyle) — yani doğru desen repoda mevcut, bu dosyaya uygulanmamış.

**Kanıt.**
```ts
// scripts/test_fason_open_dispatch_single_source.ts:48-50 (başlık) ve :308-311 (tarama)
// Tarama TypeScript AST ile yapılır (regex değil) …
else if (girdi.name.endsWith(".ts") && !girdi.name.endsWith(".d.ts")) cikti.push(tam);
//   → dosyayı AST'e verir; `$queryRaw` template literal'inin İÇİ SQL'dir, TS nesnesi değil
```
Kapsam dışı kalan kopyalar (üçünün de bugün DOĞRU olduğunu okudum — bulgu içerik değil, korumasızlık):
```sql
-- src/services/inventory.service.ts:1996-2008
AND sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL
AND sdi."remainderClosedAt" IS NULL
AND NOT EXISTS (… sr."cancelledAt" IS NULL AND NOT sri."isPartial")
-- src/services/reports/subcontract-scorecard.report.service.ts:280-291 (aynı dörtlü)
-- src/services/reports/subcontract-scorecard.report.service.ts:274-278 (LATERAL kısmi toplamı)
```
Kardeş desen:
```ts
// scripts/test_order_line_scope_single_source.ts:42,99-135
const RAW_SQL_EXEMPT: Record<string, string> = { … };
console.log("\n=== 2) Ham SQL'de order_lines süzgeci ===");
check("ham SQL'deki her order_lines erişimi aktif-kalem süzgeci taşıyor", …);
const stale = Object.keys(RAW_SQL_EXEMPT).filter((k) => !usedExempt.has(k));   // bayat muaf
```

**failure_mode.** Kalem kapanışının beşinci bir koşulu doğar (örneğin "iade edilmiş makbuz kalemi de kapatmaz"). `fason-open-dispatch.helper.ts` güncellenir, Prisma tarafındaki tüm tüketiciler otomatik düzelir, AST bekçisi yeşil kalır. `subcontract-scorecard.report.service.ts:280-291` **güncellenmez**: Fason Karnesi "açık kalem" sayısını yanlış basar (kapanmış kalemleri açık gösterir) ve `inventory.service.ts:1996` üzerinden top → firma atfı yanlış çözülür. İki yüzey birbirinden sessizce ayrışır; bekçinin varlık sebebi tam olarak buydu.

**Öneri.** `test_fason_open_dispatch_single_source.ts`e §C ekle: `src/` altındaki her `$queryRaw`/`$executeRaw` template literal'inde `subcontractor_dispatch` ya da `subcontractor_dispatch_items` geçiyorsa dört süzgecin (`cancelledAt`, `directShippedAt`, `remainderClosedAt`, `NOT sri."isPartial"` + `sr."cancelledAt"`) hepsi bulunmalı; bulunmayan → ihlal, gerekçeli `-- fason-ok:` muafiyeti (gerekçesiz muafiyet AYRI listede ve kırmızı — `test_raw_sql_hygiene.ts:449-453` deseni). Muaf listesi **iki yönlü** olmalı (bayat muaf = kırmızı).

**Kabul kriteri.** Üç mevcut kopya taranıyor ve yeşil; birinden `directShippedAt` satırı silindiğinde KIRMIZI (negatif sonda dosyada not edilir).

**Efor.** 0,5 gün.

---

### [D-K-12] Yedi advisory kilit noktasının BEŞİNDE sıra bekçisi, İKİSİNDE hiçbir bekçi yok — "grep pg_advisory → koruma var" tuzağı

| Şiddet | **S2** | Kategori | K (kapsanmayan değişmez) + beceri §4.2 | Öncelik | **P2** | Modül | eşzamanlılık altyapısı | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Kod tabanında 7 advisory kilit çağrı noktası var (`grep -rn pg_advisory_xact_lock src`). Beceri §4.2: *"bekçi kilidin VARLIĞINI mı SIRASINI mı ölçüyor?"* — SIRA yalnız iki noktada ölçülüyor. İki noktada (8024 oturum defteri, 8027 birleştirme) **ne sıra ne davranış** bekçisi var.

**Kanıt — nokta ↔ bekçi eşlemesi (her satır kaynaktan doğrulandı):**

| # | Kilit noktası (src) | NS | Davranış sondası | SIRA bekçisi |
|---|---|---|---|---|
| 1 | `inventory.service.ts:844` (KK1 mükerrer) | 8021 | ✔ `test_kk1_duplicate_guard.ts:286` (5→tam 1) | **✗** |
| 2 | `batch.service.ts:126` (parti no) | 8022 | ✗ (bkz. D-K-17) | ✔ `test_batch_number_format.ts:200-224` (sahte tx, `calls[0]`) |
| 3 | `helpers/shipment-locks.helper.ts:58` | 8023 | ✔ `test_shipment_scope_lock.ts:148` (invariant) | ✔ `:62-88` (`indexOf`, `-1` korumalı) |
| 4 | `session-registry.service.ts:79` | 8024 | **✗** | **✗** |
| 5 | `permission-management.service.ts:609` | 8025 | ✔ `test_admin_guard_race.ts:121` (2→tam 1) | **✗** |
| 6 | `helpers/code-unique.helper.ts:81` | 8026 | ✔ `test_item_code_case_uniqueness.ts:533` (5→tam 1, dolaylı) | **✗** |
| 7 | `master-data-merge.service.ts:546` | 8027 | **✗** | **✗** |

8021'in sırası kodda **ayrıntılı yorumla** korunuyor ama mekanik değil:
```ts
// src/services/inventory.service.ts:820-830
// ⚠️ SIRA LOAD-BEARING — kilit `findFirst`'ten ÖNCE, `generateRollBarcode`'dan da ÖNCE.
//  · Kilit SONRA alınırsa guard hiçbir şey kazanmaz … (bugünkü hatanın aynısı, sadece tx içinde)
…
await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DUPLICATE_GUARD_LOCK_NS}::int, hashtext(${lockKey}))`;  // :844
const twin = await tx.roll.findFirst({ … });                                                                // :848
```

**failure_mode.** ① 8021: bir refactor `lockKey` hesabını `findFirst`'ten sonraya taşır (okunabilirlik gerekçesiyle). Yorum kalır, koruma gider. Mevcut davranış sondası (N=5, gecikme enjeksiyonu yok, `test_shipment_scope_lock.ts:24-26`'nın kendi ifadesiyle *"dar pencerede çoğu zaman yeşil kalır"*) bunu **yakalamayabilir** → 2026-08-04 vakası (46 ms'de 5 mükerrer top) geri döner ve bekçi yeşil kalır. ② 8027 (merge): birleştirme kilidi silinirse iki paralel `merge` aynı tombstone'u iki survivor'a bağlayabilir; hiçbir bekçi kırmızı vermez. ③ 8024 (oturum defteri): kilit silinirse aynı kullanıcı+cihaz tipi için iki aktif oturum defteri satırı doğar.

**Öneri.** ① Beş nokta için `test_batch_number_format.ts`in **sahte-tx sıra sondası** desenini çoğalt (DB'siz, hızlı, deterministik): `stubTx` çağrı sırasını kaydeder, `calls[0]` kilit olmalı. Tek bir paylaşımlı yardımcı (`scripts/_lock-order-probe.ts`) yeterlidir. ② 8024 ve 8027 için ayrıca birer davranış sondası (aşağıdaki bekçi listesi md. 7-8). ③ `test_shipment_scope_lock.ts §2`nin namespace envanteri (1-argümanlı form kalmadı + 8021≠8022≠8023) **yedi namespace'i** kapsayacak biçimde genişletilsin — bugün üçünü kıyaslıyor.

**Kabul kriteri.** Yedi noktanın her biri için "kilit tx'in ilk ifadesi" mekanik kontrolü; kilit satırı bir ifade aşağı taşındığında KIRMIZI.

**Efor.** 1 gün.

---

### [D-K-13] Bekçilerin %96'sı servisi doğrudan çağırıyor — HTTP/Zod/middleware/guard katmanı 260 yazma ucunun ancak ~%10'unda koşuyor; `dispatchWithoutColor` bu boşluğun ölçülmüş bedeli

| Şiddet | **S2** | Kategori | K (kapsanmayan değişmez) | Öncelik | **P2** | Modül | tüm yazma yolları | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** 366 bekçinin 16'sı efemeral Express uygulaması ayağa kaldırıp gerçek HTTP isteği atıyor; kalan 350'si servis metodunu doğrudan çağırıyor. Servisi doğrudan çağıran bir test **controller Zod şemasını, middleware zincirini ve izin guard'ını hiç görmez**. 2026-08-25'te bunun bedeli ölçüldü: `dispatchWithoutColor` alanı yedi katmanda sessizce düşüyordu (dört Zod bloğu + üç Prisma yazımı), servis katmanı baştan doğruydu, **bu yüzden servisi çağıran test yeşil kalıyordu** ve canlıda 623 iş emri adımının hiçbirinde alan işaretli değildi.

**Kanıt.**
```bash
# HTTP katmanını koşturan bekçiler (16):
test_client_policy · test_direct_ship_api · test_fason_wrong_station_guidance · test_http_api ·
test_import_permissions · test_latency_middleware · test_middleware_order · test_mobile_order_permission ·
test_mobile_item_permission · test_mobile_update · test_observability_contract · test_pool_health ·
test_quickstart_dispatch_api · test_route_auth_coverage · test_tambur_manual_produce · test_tambur_manual_roll
```
Bu 16 dosyanın istek attığı uçların TAMAMI (literal taraması) 32 adres: `/api/auth/login`, `/api/admin/users`, `/api/client-policy`, `/api/colors`, `/api/customers(/…/branches)`, `/api/items(/quick-create|/:id)`, `/api/orders(/:id|/manual-close|/permanent)`, `/api/quality-grades`, `/api/rolls`, `/api/stations`, `/api/subcontractors`, `/api/subcontractor-categories`, `/api/subcontractor/dispatches/:id/direct-ship(-preview)`, `/api/work-orders(/quick-start)`, `/api/tambur/manual/{bring,bring-preview,produce,roll}`, `/api/import/color/preview`, `/api/printed-documents/…/html`.

Ölçek: `grep -rhoE '\brouter[A-Za-z]*\.(get|post|put|patch|delete)\(' src/routes/*.ts | wc -l` → **504 route**, bunların **260'ı yazma** (post/put/patch/delete). HTTP'den koşturulan yazma ucu ~20.

**Hiç HTTP'den geçmeyen kritik yazma uçları:** `/api/shipments` (kurma, `dispatch`, `undo-dispatch`), `/api/sacks` (aç/okut/kapat), `/api/returns`, `/api/subcontractor/.../receive` + `cancel-receipt` + `close-remainder`, `/api/work-orders/:id/close` (kapanış dispozisyonu), `/api/work-orders/:id/order-links`, `/api/tambur/cut*`, `/api/batches/*` (parti cerrahisi), `/api/import/*/apply`, `/api/rolls/:id/scrap`.

Mevcut karşı önlem — ve sınırı:
```ts
// scripts/test_dispatch_without_color.ts:20-22
// Servis katmanı BAŞTAN İTİBAREN doğruydu; bu yüzden servisi doğrudan çağıran
// bir test YEŞİL kalırdı. Bekçinin §1'i bilerek METİN üzerinden koşar.
```
Yani düzeltme **tek alan için** bir metin taramasıdır; sınıfı kapatmaz.

**failure_mode.** `POST /api/shipments`e yeni bir alan eklenir (örn. `plateNumber` yerine `vehiclePlate`). Servis alanı doğru yazar, controller Zod şeması alanı tanımaz → **Zod bilinmeyen anahtarı sessizce siler**. `test_shipping_*` bekçilerinin hepsi servisi doğrudan çağırdığı için yeşil kalır. Sahada irsaliyede plaka boş basılır ve kimse fark etmez (aynı sınıf: "kesimde kat sessizce düşüyordu", 2026-08-13).

**Öneri.** ① Mekanik bekçi: `test_zod_field_parity.ts` — her controller Zod şemasının anahtar kümesi ile servisin o metoda geçirdiği `data` alanlarının kesişimini AST ile karşılaştır; şemada olmayan ama servise geçen alan → ihlal (gerekçeli muafiyet listesiyle). Bu, `dispatchWithoutColor` sınıfının **genel** çözümüdür. ② Davranış tarafı: en pahalı 6 yazma ucu (`/api/shipments` ×3, `/api/subcontractor/.../receive`, `/api/work-orders/:id/close`, `/api/sacks`) için birer HTTP smoke testi — `test_direct_ship_api.ts` şablon olarak hazır (efemeral app + `fixture-test-user`).

**Kabul kriteri.** Zod şemasından bir alan silindiğinde `test_zod_field_parity` KIRMIZI; altı uçtan biri 400 dönmeye başladığında ilgili HTTP smoke KIRMIZI.

**Efor.** 1,5 gün (parity bekçisi) + 1,5 gün (6 smoke).

---

### [D-K-14] `check-migrations.mjs` — "commit edilmemiş migration/test" bekçisi hiçbir otomatik tetikleyiciye bağlı değil: git hook yok, `npm test` çağırmıyor, CI'da bilerek her zaman yeşil ve zaten `adnansahin`'de koşmuyor

| Şiddet | **S2** | Kategori | K (test altyapısı) | Öncelik | **P2** | Modül | ops/test | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Bekçi, 2026-07-30'da üç migration'ın dev DB'ye uygulanıp git'e hiç girmemesi üzerine yazıldı ve tam olarak "yerelde değer üretir" diye tasarlandı. Ama yerelde onu koşturan hiçbir şey yok.

**Kanıt.**
```js
// scripts/check-migrations.mjs:38-41 (bekçinin kendi itirafı)
// ⚠️ Bu bekçinin değeri YERELDEDİR. CI'da checkout temiz olduğu için untracked
// dosya hiç görünmez — orada bilinçli olarak "her zaman yeşil" bir dokümantasyon
// adımıdır. Commit ETMEDEN sevk edemeyeceğini yerelde öğrenmen gerekir.
```
- Tetikleyici araması: `.husky` dizini **YOK**; `git config core.hooksPath` **boş**; `.git/hooks` altında yalnız `*.sample`; `Teks-Erp/package.json`'da `pre*`/`prepare` script'i yok; `run-all-tests.ts` içinde `check-migrations` **geçmiyor**.
- Tek çağıran: `Teks-Erp/package.json:21` `"check:migrations": "node ../scripts/check-migrations.mjs"` (elle) ve `.github/workflows/ci.yml:38-39` `docs` job'ı — o da yalnız `main`'de (D-K-01).
- Bugünkü koşum (salt-okunur): `✅ Migration bekçisi: 195 migration izleniyor, commit edilmemiş/değiştirilmiş dosya yok.` — yani bekçi çalışıyor, sadece kimse çağırmıyor.
- Aynı sınıftaki `check-docs.mjs` de yalnız CI `docs` job'ında (yine `main`).

**failure_mode.** Paylaşımlı ağaç + paralel oturumlar (memory notu: *"migration add'i başkasının commit'ine süpürülür"*). Geliştirici migration'ı `prisma migrate dev` ile üretir, dev DB'ye uygulanır, `git add` unutulur. Yerelde her şey yeşil (dosya diskte var), `npm test` geçer, dal push edilir, CI koşmaz (D-K-01). `deploy/kur.ps1:287` `migrate deploy` fabrikada dosyayı bulamaz → kolon oluşmaz → backend o kolonu okuyan her uçta P2022/500 verir. Bu tam olarak `check-migrations.mjs` başlığındaki 2026-07-30 vakasıdır ve bugün onu durduracak hiçbir mekanizma yok.

**Öneri.** ① `run-all-tests.ts`in `main()`ine `productionDbGate()`ten hemen sonra `check-migrations` + `check-docs` çağrısı (hızlı, DB'siz, zero-dep). Böylece "npm test" tek kapı olur. ② Alternatif/ek: `.husky/pre-push` (yalnız iki script). ③ D-K-01 ile birlikte CI'ın `adnansahin`i de kapsaması.

**Kabul kriteri.** `Teks-Erp/prisma/migrations` altına untracked bir dizin bırakıldığında `npm test` ilk 3 saniyede kırmızı düşüyor.

**Efor.** 0,25 gün.

---

### [D-K-15] Fason kabul yarışı sondası KAZANANI ölçmüyor — `ok`/`rejected` hesaplanıp yalnız `console.log`a basılıyor

| Şiddet | **S2** | Kategori | K (eşzamanlılık sondası kalitesi) | Öncelik | **P2** | Modül | fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** 33 paralel sondanın 21'i "tam 1 (ya da tam N) başarı" bekliyor; 5'i yalnız bir invariant ölçüyor. En pahalı yollardan biri (fason kabul) bu 5'in içinde: iki eşzamanlı `receive` çağrısının **kaç tanesinin başarılı sayıldığı** ölçülmüyor.

**Kanıt.**
```ts
// scripts/test_fason_receive_idempotency_concurrency.ts:119-127
const results = await Promise.allSettled([sub.receive(payload, ADMIN), sub.receive(payload, ADMIN)]);
const ok = results.filter((r) => r.status === "fulfilled").length;
const rejected = results.filter((r) => r.status === "rejected").length;
console.log(`     (sonuç: ${ok} başarılı/cached, ${rejected} reddedildi)`);   // ← YALNIZ LOG
// İNVARYANT: timing ne olursa olsun (kaybeden 409 VEYA idempotent cached) born ÇİFT olmamalı.
check("IC2: eşzamanlı kabul → TAM 1 born (çift doğum yok)", (await bornLive(…)) === 1, …);
```
`ok` ve `rejected` hiçbir `check()`e girmiyor (dosya tarandı).

Aynı sınıf: `test_race_conditions.ts:196-211` (C — sonuçlar hiç ölçülmüyor), `test_audit_followups.ts:105` (`≥1`), `test_direct_ship_scenarios.ts:267-268` (`fulfilled ≥1`), `test_shipment_scope_lock.ts:148-161` (`en az biri reddedildi`).

**failure_mode.** İki fiziksel teslimat aynı saniyede kaydedilir (iki tablet, aynı fason firması, benzer yük). Replay guard'ı kümeyi "aynı" sayar ve ikinciye **cached makbuzu** döndürür: `success: true`, makbuz no aynı. Operatör "kabul kaydedildi" görür ve ikinci teslimatın malı sisteme hiç girmez. `born=1` invariantı **sağlanır** — bekçi yeşildir. Kaybedenin 409 mu yoksa yanlış bir `success` mi aldığı tam da ölçülmeyen şeydir; beceri §8'in "sessizce yanlış cevap 409'dan daha kötüdür" kuralı burada denetimsiz.

**Öneri.** Sondayı iki senaryoya böl: (a) **birebir aynı** payload → beklenen sözleşme yazılı olsun ("1 fresh + 1 cached" ya da "1 ok + 1×409") ve `check()`e girsin; (b) **farklı** payload (ikinci teslimat: farklı `newRolls[].qty`) → kaybeden **kesinlikle 409** almalı, cached DÖNMEMELİ. (b) bugün muhtemelen kırmızı verir ve gerçek soruyu sorar.

**Kabul kriteri.** İki senaryo da `check()` ile ölçülüyor; (b) senaryosu cached dönerse KIRMIZI.

**Efor.** 0,5 gün.

---

### [D-K-16] Üç bekçi dosyası parti-no yolu hakkında kodun TERSİNİ yazıyor ("kilit almaz", "`@unique` → P2002") — kilit 2026-08-05'ten beri var, unique index YOK

| Şiddet | **S3** | Kategori | K (bekçi bakımı / bilgi tehlikesi) | Öncelik | **P3** | Modül | parti | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Üç bekçi, `withBarcodeRetry` sarmalayıcısını kullanma gerekçesini yazarken parti-no üretimini "kilitsiz check-then-act + `@unique` ihlali (P2002)" diye anlatıyor. İkisi de bugün YANLIŞ: kilit `generateBatchNumberTx`in ilk ifadesi ve `batches.batchNumber` üzerinde unique index yok (2026-08-05'te bilerek kaldırıldı).

**Kanıt.**
```ts
// scripts/test_batch_k15_merge.ts:131-137
// `generateBatchNumberTx` günün NUMERIC max'ı + 1 okur; bu bir check-then-act'tir
// ve kilit almaz. … iki taraf aynı P kodunu hesaplar → `@unique` ihlali (P2002).
// scripts/test_k14_lock_edges.ts:84-85   — aynı cümle
// scripts/test_traveler_card_stale.ts:58-61 — "çıplak çağrı `batchNumber` unique çakışmasına düşer"
```
```ts
// src/services/batch.service.ts:122-126 — kilit İLK ifade
export async function generateBatchNumberTx(tx, date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BATCH_NUMBER_LOCK_NS}::int, ${BATCH_NUMBER_LOCK_KEY}::int)`;
```
**K2 (dev DB, `pg_indexes` — `batches` tablosunun TÜM index'leri):**
```
batches_pkey · batches_mergedIntoId_idx · batches_splitFromId_idx ·
batches_workOrderId_idx · batches_createdAt_idx · batches_batchNumber_trgm_idx
```
→ `batches_batchNumber_key` **yok**. Şema da onaylıyor: `prisma/schema.prisma:2268-2270` *"Partinin KİMLİĞİ `id`'dir; hiçbir yerde `batchNumber` ile lookup YAPMA"*, `batchNumber String @db.VarChar(64)` (unique yok).

**failure_mode.** Bakımcı bu üç yorumu okur ve "parti no P2002+retry ile korunuyor" sonucuna varır. Sonra advisory kilidi kaldırır (performans gerekçesiyle: "sistem geneli tek anahtar, sevk onayını kuyruğa sokuyor"). Artık **hiçbir koruma yoktur**: iki paralel parti doğumu aynı `P07`u üretir, `withBarcodeRetry` hiç tetiklenmez (P2002 oluşmaz çünkü unique yok) ve iki farklı parti kâğıtta aynı numarayı taşır. `test_batch_number_format.ts:200-224` sıra sondası bunu **yakalar** (tek gerçek koruma odur) — ama kaldırma kararını veren kişi tam tersine inandırılmış olur ve bekçiyi de "artık gereksiz" diye elleyebilir.

**Öneri.** Üç yorumu düzelt ve tek bir cümleye bağla: *"parti no'nun TEK koruması `batch.service.ts:126`'daki 8022 kilididir ve onun sırası `test_batch_number_format.ts` §2'de kilitlidir; `withBarcodeRetry` bu yolda BAŞKA bir şeyi (barkod sayacı) korur."* ⚠️ Bu bir dokümantasyon düzeltmesi değil, **bekçi bakımıdır**: yanlış gerekçe, doğru kodun sökülmesine izin verir.

**Kabul kriteri.** Üç dosyada da "kilit almaz"/"@unique" ifadesi yok; `withBarcodeRetry`in bu yolda ne koruduğu yazılı.

**Efor.** 0,25 gün.

**Önceki defter.** K11 §2d / HOTSPOT-1 ile aynı; burada `pg_indexes` ölçümüyle K2'ye çıkarıldı.

---

### [D-K-17] Parti no yolunun GERÇEK DB'de paralel sondası yok — tek bekçi sahte tx üzerinde çağrı sırasını sayıyor

| Şiddet | **S2** | Kategori | K (kapsanmayan değişmez) | Öncelik | **P2** | Modül | parti | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Parti numarası kâğıda basılan iş kimliğidir (fason çekisi, kabul makbuzu, refakat kartı) ve tek koruması bir advisory kilittir (D-K-16). Bu kilidin **gerçek Postgres'te** iş görüp görmediğini ölçen hiçbir test yok: `test_batch_number_format.ts` DB'ye hiç dokunmayan bir `stubTx` kullanıyor.

**Kanıt.**
```ts
// scripts/test_batch_number_format.ts:196-212 — sahte tx, çağrı listesi
check(…, s2.calls.findIndex((c) => c.startsWith("lock(")) === 0, s2.calls.join(" → "));
check(`kilit namespace'i KK1'inkinden (${DUPLICATE_GUARD_LOCK_NS}) AYRI`,
      BATCH_NUMBER_LOCK_NS !== DUPLICATE_GUARD_LOCK_NS && s2.calls[0] === `lock(${BATCH_NUMBER_LOCK_NS},1)`, …);
```
`grep`: `splitBatch|mergeBatches|moveRolls` geçen 2-6 dosyanın hiçbirinde `Promise.all` yok; `createBatchTx`i paralel çağıran bekçi yok.

**failure_mode.** Sahte tx, kilidin **çağrıldığını** doğrular; **etkili olduğunu** doğrulayamaz. Somut örnekler: (a) `BATCH_NUMBER_LOCK_KEY` bir gün `workOrderId`'nin hash'ine çevrilirse (makul bir "serileşmeyi daraltalım" optimizasyonu) sahte-tx sondası yeşil kalır — `calls[0]` hâlâ bir `lock(...)`tır — ama iki farklı WO'nun partileri artık serileşmez ve aynı `P07`u alır; (b) `readBatchShortNumberEnabled(tx)` kilitten sonra tx İÇİNDE bir okuma yapıyor (`batch.service.ts:128`), yani kilit gerçek bir tx'te tüm o süre boyunca tutulur — sahte tx bunu ölçmez.

**Öneri.** `test_batch_number_format.ts`e §D: N=5 paralel `withBarcodeRetry(() => prisma.$transaction(tx => createBatchTx(tx, …)))` → 5 parti, **5 farklı numara**, hiçbiri tekrar etmiyor; ayrıca farklı iş emirleri için de aynı sonuç (kilidin sistem geneli olduğunun kanıtı). Emsal: `test_barcode_reservation.ts:287-301` (20 paralel rezervasyon, mükerrer yok).

**Kabul kriteri.** Kilit satırı silindiğinde ya da anahtar WO'ya bağlandığında sonda KIRMIZI.

**Efor.** 0,5 gün.

---

### [D-K-18] `test_single_process.ts` YOK — tek-process invariantı beş kaynak dosyada belgeli, mekanik bekçisi hiç yok

| Şiddet | **S2** | Kategori | K + beceri §5 | Öncelik | **P2** | Modül | ops/durum yerleşimi | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Sistemin en geniş kapsamlı ve en sessiz varsayımı: PM2 `fork` + `instances: 1`. Bu varsayıma dayanan **en az beş** bellek-içi durum var (login lockout sayacı, presence haritası, feature-flag önbelleği, havuz sağlığı sayaçları, yedek/DB-kopya "koşuyor" bayrakları). Hiçbir bekçi `ecosystem.config.js`e bakmıyor.

**Kanıt.**
```js
// ecosystem.config.js:42-48
// exec_mode CLUSTER OLAMAZ ve instances 1'den büyük OLAMAZ. presence sayımı,
exec_mode: "fork",
instances: 1,
```
Bağımlı durumlar (dosya yorumlarıyla belgeli): `src/lib/pool-health.ts:25-26` ("TEK-PROCESS INVARIANT: sayaçlar process-local"), `src/lib/presence.ts`, `src/middlewares/auth.middleware.ts` (lockout), `src/services/system-setting.service.ts` (flag önbelleği), `src/server.ts`.
Bekçi araması: `grep -rln 'ecosystem.config' Teks-Erp/scripts/*.ts` → **0 dosya**. `ls scripts/test_single_process*` → yok.

Var olan dolaylı bekçiler yalnız **bellek mekanizmasını** ölçüyor, invariantı değil: `test_p2_infra.ts:53-63` (200 paralel `reserveLoginAttempt` → tam 5 serbest), `test_backup.ts:315` (2× `runBackupJob` → tam 1 reddedilir), `test_db_copy_single_start.ts:62-73`.

**failure_mode.** Birisi "sunucu yavaş" diye `pm2 scale teks-erp 2` yazar ya da `instances: "max"` düzenler. Hiçbir test kırmızı vermez, hiçbir uyarı çıkmaz. Sonuç: login kilidi process başına ayrı sayılır → 5 denemelik kilit fiilen 10 denemeye çıkar (brute-force penceresi ikiye katlanır); feature-flag önbelleği iki process'te ayrışır → aynı anda bir tablet "kısa parti no açık", diğeri "kapalı" rejiminde çalışır; yedek işi iki kez başlar (`pg_dump` çakışması). Beceri §5'in tam olarak "gerçek bulgu" dediği biçim: *invariant yazılı ama mekanik bekçisi yok.*

**Öneri.** `scripts/test_single_process.ts` (DB'siz, hızlı): `ecosystem.config.js`i oku → her app için `exec_mode === "fork"` **ve** `instances === 1`; ayrıca `src/` altında `cluster`/`worker_threads` import'u 0. Dosya başlığına bağımlı beş durumun listesini ve *"bu satırı değiştirmek şunları bozar"* cümlesini yaz — bekçinin asıl değeri o listedir.

**Kabul kriteri.** `instances: 2` yapıldığında KIRMIZI ve mesaj hangi beş durumun bozulacağını sayıyor.

**Efor.** 0,25 gün.

**Önceki defter.** `MATRIX.md` §C "Süreç/ops bekçisiz" satırı ve K8 H-2 aynı boşluğu işaret ediyor.

---

### [D-K-19] Üretim-DB kapısı yalnız koşucuda, host ADINA bakıyor ve mesajlarındaki sayılar bayat

| Şiddet | **S3** | Kategori | K (test verisi izolasyonu) | Öncelik | **P3** | Modül | ops/test | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `productionDbGate()` iyi tasarlanmış (fail-closed, production'da atlanamaz) ama üç sınırı var ve üçü de bugün açık.

**Kanıt.**
```ts
// scripts/run-all-tests.ts:141-146
const YEREL = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
if (YEREL.has(host)) { console.log(`→ Hedef DB: ${dbName} @ ${host} (yerel) ✅\n`); return; }
// :171-174  yalnız koşucuda
function main() { const filter = process.argv[2]; productionDbGate(); … }
```
1. **Tek-dosya koşumu kapısız.** `grep -rn productionDbGate Teks-Erp/scripts/*.ts` → yalnız `run-all-tests.ts`. 366 testin **hiçbirinde** ortam kontrolü yok. `Teks-Erp/CLAUDE.md`'nin önerdiği normal koşum biçimi `npx tsx scripts/test_X.ts`.
2. **Kapı host adına bakar, DB adına bakmaz.** SSH tüneli (`ssh -L 5432:SAHINSRV:5432`) ya da port yönlendirmesi hedefi `localhost` gösterir → kapı geçer. `0.0.0.0` da allowlist'te.
3. **Mesajlardaki sayılar bayat** (`:80-82`, `:152`, `:159`): "273 test / 235 prisma import / 1.539 deleteMany / 209 dosya". Bugünkü ölçüm (kendi sayımım): **366 / 323 / 2.048 / 278**. Kapının kendi kapsamı hakkındaki beyanı %33 eksik.

**failure_mode.** D-K-07'nin taşıyıcısı: tek-dosya koşumu kapısız olduğu için yıkıcı bir test (`test_manual_move_fason_receive.ts`) hiçbir kontrolden geçmeden canlı-şekilli veriye yazabilir. Ayrıca bayat sayı, kapının uyarı metnini ("1.539 deleteMany içerir") okuyan kişiye riski olduğundan küçük gösterir.

**Öneri.** ① Kapıyı paylaşımlı modüle çıkar + her testin ilk satırına (D-K-07 önerisi md. ②-③). ② DB adı allowlist'i ekle. ③ Sayıları **koşum anında** hesapla (dosya sayımı zaten `readdirSync`ten geliyor; `deleteMany` sayımı isteğe bağlı) — sabit yazılan her sayı bayatlar.

**Kabul kriteri.** `DATABASE_URL=…@localhost:5432/tekserp` (üretim adı) ile `npm test` DURUYOR; guard'sız yeni test eklendiğinde kapsama bekçisi kırmızı.

**Efor.** 1 gün (D-K-07 ile birlikte yapılır).

**Önceki defter.** `F-OPS-VER-002` `duzeltildi`; K12 satır 125 sınırı zaten yazmış. Yeniden AÇMIYORUM — kapanmış bulgunun **belgelenmiş sınırını** ölçüyorum.

---

### [D-K-20] Farklı-token aynı-parent paralel Tambur kesimi bekçisiz — `currentQty ≤ initialQty`'nin DB seddi de yok, koruma tek bir `gte` guard'ında ve hiçbir test onu ölçmüyor

| Şiddet | **S3** | Kategori | K (kapsanmayan değişmez) | Öncelik | **P3** | Modül | tambur | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Tambur kesiminin tek eşzamanlılık sondası **aynı token**la koşuyor (idempotency yarışı). Asıl riskli senaryo — iki operatörün aynı 100 m'lik topu farklı token'larla 60'ar metre kesmesi — ölçülmüyor. Koruma kodda var ama bekçisiz.

**Kanıt.**
```ts
// scripts/test_tambur_cut_idempotency.ts:118-121 — AYNI token
const settled = await Promise.allSettled([
  tambur.cutWarehouseRoll(w2, { cutLength: 30, clientToken: b2 }, ADMIN),
  tambur.cutWarehouseRoll(w2, { cutLength: 30, clientToken: b2 }, ADMIN),   // b2 aynı
]);
```
```ts
// src/services/tambur.service.ts:2243 — TEK koruma (guarded update)
where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null,
         currentQty: { gte: data.cutLength } },
// :2936 — cutOpenFabric ikizi
where: { id: parent.id, status: RollStatus.IN_PRODUCTION, currentStepId: tamburStepId,
         currentQty: { gte: data.lengthMeters } },
```
DB seddi teyidi: `MATRIX.md` §7.2, STK-02 (`currentQty ≤ initialQty`) → *"DB seddi YOK (bilinçli)"*; `test_db_invariants.ts` CHECK envanterinde `rolls_currentQty_nonneg` var ama `currentQty ≤ initialQty` yok.

**failure_mode.** Koruma bugün **doğru**; bulgu, korumanın **sökülebilir ve sökülüşün görünmez** olmasıdır. `currentQty: { gte: … }` satırı bir refactor'da (örneğin "aşım bayrağı merkezîleşsin" değişikliğinde) düşerse iki paralel kesim 100 m'lik toptan 120 m çıkarır: `currentQty` negatife iner (CHECK `nonneg` onu 500'e çevirir → operatör anlamsız hata görür) ya da aşım bayrağı açıkken sessizce `initialQty` yukarı çekilir. 2026-08-22 §13 vakası birebir bu sınıftı ("aşım koruması üretim dalında YOKTU, arşiv ikizinde vardı; bekçi §5 invariantı yalnız FULL+DEPO kesiminde ölçüyordu — **bekçinin kör noktası hatanın kendisiyle aynı yerdeydi**").

**Öneri.** `test_tambur_cut_idempotency.ts`e §E: 100 m parent, `Promise.allSettled` ile **farklı token**la 2× `cutWarehouseRoll(60)` → tam 1 başarı + 1 × 409/red; parent `currentQty === 40`; `Σ(child.initialQty) ≤ parent.initialQty`. Aynısını `cutOpenFabric` için tekrarla (guard'ları farklı satırlarda).

**Kabul kriteri.** `currentQty: { gte: … }` koşulu `where`den silindiğinde KIRMIZI.

**Efor.** 0,5 gün.

---

### [D-K-21] Eşzamanlılık sondalarının niteliği: 33 sondanın 24'ü N=2, hiçbirinde gecikme enjeksiyonu yok — dar pencerede yeşil kalabilirler (bekçilerin kendi itirafı)

| Şiddet | **S3** | Kategori | K (eşzamanlılık sondası kalitesi) | Öncelik | **P3** | Modül | eşzamanlılık altyapısı | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Var olan sondaların dağılımı: N=2 → 24 · N=3 → 1 · N=5 → 2 · N=20 → 2 · N=30 → 1 · N=50/200 (bellek) → 2. Yarış penceresini bilerek genişleten (gecikme enjekte eden) tek yer sahte bir bağımlılıktır (`test_db_copy_single_start.ts:51`, 60 ms). Bekçilerden biri bunun sonucunu kendisi yazıyor.

**Kanıt.**
```ts
// scripts/test_shipment_scope_lock.ts:24-26 (dosya başlığı)
// … davranış sondası dar pencerede çoğu zaman yeşil kalır …
```
```ts
// scripts/test_db_copy_single_start.ts:51 — tek gecikme enjeksiyonu (sahte `list`)
```
N dağılımı K11 §2a'da; ben 33 sondanın gövdesini yeniden çıkardım ve dağılımı doğruladım.

**failure_mode.** Bir kilit/claim gerçekten kaldırıldığında N=2'lik bir sonda çakışmayı **çoğu koşumda** üretemez: iki `await` arasındaki pencere mikrosaniyelerdir. Test 20 koşumun 19'unda yeşil, 1'inde kırmızı verir; bu durumda ekip onu "flake" sayıp `looksInfrastructural` listesine ya da atlanan testlere ekler (koşucu bugün assertion hatasını **bilerek** yeniden denemiyor — `run-all-tests.ts:281-306` — bu doğru bir karar ve korunmalı). Yani zayıf sonda yalnız yakalamaz değil, **yanlış teşhise de yol açar**.

**Öneri.** ① Yeni sondalarda N ≥ 5 (mevcut en güçlü örnek `test_kk1_duplicate_guard.ts:286` — 5 istek, 1 geçer, 4×409). ② Pencereyi genişletmek için kilit-altındaki okumaya opsiyonel bir test kancası koymak yerine **daha ucuz** bir yol: aynı sondayı 3 tur döndürmek (`for (let i=0;i<3;i++)`) ve turların hepsinde "tam 1" beklemek — kod değişikliği istemez. ③ Paylaşımlı bir yardımcı (`scripts/_race.ts`: `raceProbe(n, fn)` → `{ ok, rejected, codes }`) — bugün her dosya kendi `Promise.allSettled` + `filter` kalıbını yeniden yazıyor (harness yok, K11 H-10).

**Kabul kriteri.** Yeni yazılan 6 sonda (D-K-04) N≥5 ve 3 turlu; `_race.ts` kullanıyor.

**Efor.** 0,25 gün (yardımcı) + yeni sondaların içinde.

---

### [D-K-22] Negatif sonda kanıtı YORUMDA yaşıyor (20/366 dosya, %5,5); yeniden koşulabilir öz-sınama yalnız 5 bekçide var

| Şiddet | **S3** | Kategori | K (bekçi kalitesi) | Öncelik | **P3** | Modül | test kültürü | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Ekipte güçlü bir negatif-sonda kültürü var (bkz. "Doğru yapılanlar") ama kanıtı çoğunlukla bir **yorum satırı**dır: "S1 advisory lock satırı silindi → 9 KIRMIZI". Yorum, bekçi değiştikçe bayatlar ve yeniden koşulamaz. Kalıcı, mekanik biçim (dosya içi sentetik ihlal vektörleri) yalnız 5 dosyada.

**Kanıt.**
```bash
grep -rli 'negatif sonda' Teks-Erp/scripts/test_*.ts | wc -l          # → 20
grep -lE 'beklenenIhlal|SELF_TEST|sentetik|vektör' Teks-Erp/scripts/test_*.ts
# → test_fason_open_dispatch_single_source · test_label_element_condition ·
#   test_login_lockout · test_label_canvas_renderer · test_raw_sql_hygiene       (5)
```
Notu OLMAYAN kritik bekçiler: `test_shipment_scope_lock.ts` (tek kilit-sırası bekçilerinden biri), `test_db_invariants.ts` (793 satır, tüm şema-dışı kısıt envanteri), `test_route_auth_coverage.ts`, `test_consistency.ts`, `test_batch_number_format.ts` (parti no'nun TEK koruması), `test_hard_delete_guard_coverage.ts`.

Kültürün kendi kendini yakaladığı ders (korunmalı):
```ts
// scripts/test_kk1_duplicate_guard.ts:52-55
// ⚠️ S6'nın İLK hâli YEŞİL kalmıştı: test "700 ≡ 700.0" diyordu, oysa JS'te ikisi
//    AYNI sayıdır — iddia BOŞTU. … "kırmızı verebiliyor mu" kanıtlanmamış kontrol,
//    kontrol değil süstür.
```

**failure_mode.** Bir bekçi refactor edilir (çıpa metni değişir, `indexOf` hedefi yeniden adlandırılır, fixture "temiz" duruma çekilir) ve iddiası sessizce boşalır. Yorumdaki "2026-08-XX'te kırmızı verdi" kaydı hâlâ orada durur ve ekip bekçiye güvenmeye devam eder. Memory notundaki *"bekçi negatif sonda tuzakları — yanlış çıpa 'bekçi kör' sandırır"* dersi bunun tersinden aynısı.

**Öneri.** Kritik bekçilerde `test_raw_sql_hygiene.ts:420-483` desenini benimse: dosya içinde **sentetik kaynak parçaları** + beklenen ihlal sayısı; tarayıcı bunlara karşı da koşar. Bu, negatif sondayı **her koşumda tekrarlanan** bir kontrole çevirir. Uygulanabilir olduğu yerler: kaynak/AST tarayan 47 bekçinin tamamı. Davranış sondalarında (DB'ye yazanlar) aynı şey mümkün değil; orada yorum notu + `md5` geri-yükleme disiplini (7 dosyada var) doğru araçtır ve **kritik 6 bekçide eksik**.

**Kabul kriteri.** Kaynak tarayan her yeni bekçi öz-sınama vektörü taşıyor; yukarıdaki 6 kritik bekçiye negatif sonda notu ekleniyor.

**Efor.** 1 gün (6 dosya).

---

### [D-K-23] `ImportService.apply` uçuşta çift koşum penceresi bekçisiz — token satırı koşumun SONUNDA yazılıyor

| Şiddet | **S3** | Kategori | K (idempotency testi) | Öncelik | **P3** | Modül | içe aktarım | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İçe aktarımın idempotency bekçisi (`test_import_framework.ts:304-311`) **sıralı** koşuyor: apply → apply → ikinci kez yazmaz. Ama `ImportRun` satırı koşum bittikten sonra yazıldığı için, iki isteğin **aynı anda** gelmesi durumunda ikisi de `prior === null` görür ve ikisi de yazar.

**Kanıt.**
```ts
// src/services/import/import.service.ts:447-450
if (options.clientToken) {
  const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });
  if (prior) { … return prior sonucu … }        // ← okuma
}
// :475 runId üretilir; ImportRun satırı koşumun SONUNDA yazılır (uçuşta pencere)
```
`grep`: `apply(` geçen 2 test dosyasının ikisinde de `Promise.all` yok.

**failure_mode.** Kullanıcı 900 satırlık müşteri dosyasını yükler; istek uzun sürer (satır satır, bilinçli), tarayıcı zaman aşımına düşer, kullanıcı "Yeniden Dene"ye basar. Aynı `clientToken` ile ikinci istek gider ve birincisi hâlâ koşmaktadır → `prior` yoktur → 900 satır **iki kez** işlenir. Ad-mükerreri seddi (`nameFold` partial UNIQUE) bir kısmını P2002 ile eler ama `code`u farklı olanlar mükerrer cari kart olarak doğar — ve tam da o kartlar Mükerrer Paneli'nin kuyruğunu doldurur.

**Öneri.** Bekçi: `test_import_framework.ts`e paralel §: aynı token ile iki `apply()` → tam 1 gerçek koşum, `ImportRun` sayısı 1, hedef tabloda satır sayısı bir katı. Bugün kırmızı verecektir; düzeltme (koşum satırını BAŞTA `RUNNING` durumuyla yazmak — claim) `import.service`e aittir.

**Kabul kriteri.** Paralel sonda "tam 1 koşum" ölçüyor ve düzeltmeden önce KIRMIZI.

**Efor.** 0,25 gün (bekçi).

---

### [D-K-24] Sessiz temizlik deseni sistematik: 150 dosya / 669 `catch(() => {})`; RESTRICT FK'lı `RollVariance` üç fason testinde temizlenmiyor

| Şiddet | **S3** | Kategori | K (test verisi izolasyonu) | Öncelik | **P3** | Modül | ops/test | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** D-K-08'in genel biçimi. Kök CLAUDE.md 2026-08-21 kuralı: *"⚠️ RESTRICT FK: fason kabulü yapan HER test cleanup'ı `rollVariance.deleteMany` içermeli (23 dosya güncellendi)."* Bugün `receive` çağıran 29 dosyanın 3'ünde bu satır yok.

**Kanıt.**
```bash
grep -l '\.receive(\|receiveDispatch' Teks-Erp/scripts/test_*.ts | wc -l   # → 29
# bunlardan `rollVariance` geçmeyenler:
#   test_fason_wrong_station_guidance.ts   ← subcontractor.receive ×4, roll.deleteMany :571 var
#   test_manual_move_fason_receive.ts      ← temizlik HİÇ yok (D-K-07)
#   test_kartela_stock_and_ship.ts         ← kartelaService.receive (fason değil) → muhtemel YANLIŞ POZİTİF
```
`test_fason_wrong_station_guidance.ts:583-585`: temizliğin tamamı tek bir `try/catch` içinde; hata "cleanup hata (manuel temizlik gerekebilir)" diye **basılıyor** (sessiz değil, iyi) ama koşum yeşil kalıyor ve artık birikiyor.
Genel ölçek: sessiz catch **150 dosya / 669 satır**; `deleteMany(...).catch(...)` **87 dosyada**.

**failure_mode.** Fason çekme (`SUBCONTRACTOR_RETURN` sapması) yazan bir kabul yapıldığında `roll.deleteMany` RESTRICT'e takılır; hata yutulur; toplar dev DB'de kalır ve sonraki koşumların `findFirst` tabanlı seçimlerini kirletir (bkz. D-K-06/D-K-07). Kural CLAUDE.md'de yazılı ama **mekanik bekçisi yok** — 24. dosya eklendiğinde kimse fark etmez.

**Öneri.** ① Üç dosyayı düzelt (kartela olanı doğrula; kartela kabulü `RollVariance` yazmıyorsa muaf). ② Mekanik bekçi: `test_cleanup_fk_coverage.ts` — `scripts/test_*.ts` içinde `.receive(` (subcontractor) geçen her dosyada `rollVariance.deleteMany` bulunmalı; gerekçeli muafiyet listesi + bayat-muaf kontrolü (`test_order_line_scope_single_source` deseni). Bu, CLAUDE.md'deki cümleyi koda çevirir.

**Kabul kriteri.** Yeni bir fason-kabul testi `rollVariance` temizliği olmadan eklendiğinde KIRMIZI.

**Efor.** 0,5 gün.

---

## Elenen adaylar (beceri §9 gereği yazılmadı)

| Aday | Neden bulgu DEĞİL |
|---|---|
| "Kaynak tarayan 19 bekçide körlük zemini yok" | İlk tarama Türkçe terimleri (`ASGARI_DOSYA`, `en az`, `length > 0`) kaçırdı. Yeniden ölçüldü: 47 kaynak-tarayan bekçinin **41'inde** zemin var. Kalan 6'nın (`test_client_policy`, `test_mobile_update`, `test_observability_contract`, `test_report_day_boundary`, `test_shipment_list_gross`, `test_workstation_permission`) hepsinde ya gövde-uzunluğu kontrolü (`body.length > 500`) ya da fail-closed çıpa var. Bulgu değil; **iyi uygulama** olarak "Doğru yapılanlar"a yazıldı. |
| "43 test dosyası `TEST-`/`TST-` öneki olmadan yazıyor" | Ham grep yanıltıcı: çoğu dosya öneki **fixture modülünde** taşıyor (`fixture-manual-move.ts`, `fixture-subcontractor.ts`). Örnek: `test_manual_move_backflush.ts` öneksiz görünüyor ama `createManualMoveFixture` kullanıyor (`:17`). Gerçek ihlal olarak yalnız D-K-07'deki dosya doğrulandı. |
| "`test_kk1_duplicate_guard` bayrak KAPALIYKEN yolu ölçmüyor" | Bayrak dev'de de sahada da **`true`** (K2: `system_settings`). Bugün fiilen ölçülen rejim üretimdeki rejimdir. Kalan risk yalnız "birisi bayrağı panelden kapatırsa koruma da gider" — bu bir **konfigürasyon** kararıdır, kök CLAUDE.md'de yazılı ve bekçi bulgusu değil. S4 olarak dahi yazılmadı; aşağıda "Sınır ötesi not" olarak bırakıldı. |
| "`isolationLevel` yalnız bir yerde" | Beceri §9.11 — üçlü koşul yok; ayrıca `test_shipment_list_gross.ts:243-245` metin bekçisi mevcut. |
| "`updateMany` count kontrolsüz" | Beceri §9.9 — sınıflandırma yapılmadan yazılmaz; D-A/D-B alanı. |

---

## Ekibe verilecek bekçi listesi — öncelikli 10

Her satır: **dosya adı** · ne ölçmeli · hangi bulgudan · efor.

| # | Dosya | Ne ölçer (kabul kriteri) | Bulgu | Efor |
|---|---|---|---|---|
| 1 | `test_shipment_concurrency.ts` | `createShipment` aynı çuval kümesiyle 5 paralel → **tam 1** başarı + 4×409; `SackAllocation` sayısı = çuval sayısı (çift tahsis yok). Ayrı §: `dispatchShipment` aynı `shipmentId` 5 paralel → tam 1 DISPATCHED, `OrderLine.shippedQty` **bir kez** artar. Claim `where`inden statü koşulu silinince KIRMIZI. | D-K-04 | 1 g |
| 2 | `test_fason_cancel_close_concurrency.ts` | `cancelReceipt` (LIFO) aynı makbuz 3 paralel → tam 1; `currentQty` **bir kez** geri konur. `closeRemainder` 3 paralel → tam 1 `RollVariance` + tek `remainderClosedAt`. ⚠️ cleanup'ta `rollVariance.deleteMany`. | D-K-04 | 1 g |
| 3 | `test_wo_close_link_concurrency.ts` | `completeWorkOrder` (dispozisyonlu) 3 paralel → tam 1; hiçbir top iki kez dispoze edilmez. `linkOrderLines`/`unlinkOrderLine`/`cancelOrderLine` çiftleri paralel → `WO.type` ↔ bağ sayısı tutarlı, `shippedQty` lost-update yok. | D-K-04 | 1 g |
| 4 | `test_token_replay_cancelled.ts` | Altı yolda "kayıt iptal → aynı token replay" → 409 + `code`. Bugün `RECEIPT_CANCELLED` yeşil, KK1/Order/Shipment/Sack **kırmızı** (düzeltmenin kabul kriteri). | D-K-05 | 1 g |
| 5 | `test_env_gate_coverage.ts` + `scripts/_guard.ts` | 366 `test_*.ts`in hepsi ortam guard'ını import ediyor (gerekçeli muaf listesi, bayat-muaf kontrolü); guard host **ve** DB adına bakıyor. Guard'sız yeni test → KIRMIZI. | D-K-07, D-K-19 | 1 g |
| 6 | `test_single_process.ts` | `ecosystem.config.js`: her app `exec_mode==="fork"` ∧ `instances===1`; `src/`de `cluster`/`worker_threads` import 0. Başlıkta bağımlı beş bellek-durumunun listesi. | D-K-18 | 0,25 g |
| 7 | `test_lock_order_all_namespaces.ts` (ya da mevcut dosyalara §) | Yedi advisory noktasının **hepsinde** kilidin tx'in ilk ifadesi olduğu (sahte-tx `calls[0]` deseni); namespace envanteri 7 değeri kapsıyor; 1-argümanlı form 0. | D-K-12 | 1 g |
| 8 | `test_merge_session_concurrency.ts` | `MasterDataMergeService.merge` aynı çift 3 paralel → tam 1 tombstone, ikinci 409; `session-registry.open` aynı kullanıcı+cihaz tipi 3 paralel → tek aktif defter satırı. (8027/8024'ün İLK davranış sondaları.) | D-K-04, D-K-12 | 0,75 g |
| 9 | `test_zod_field_parity.ts` | Controller Zod şemalarının anahtar kümesi ⊇ servise geçirilen `data` alanları (AST, gerekçeli muaf listesi). `dispatchWithoutColor` sınıfının genel çözümü. | D-K-13 | 1,5 g |
| 10 | `test_cleanup_fk_coverage.ts` + `test_test_residue.ts` | ① Fason kabulü yapan her test `rollVariance.deleteMany` içeriyor. ② Dev DB'de `TEST-`/`TST-` önekli iş emri/kullanıcı sayısı eşiğin altında (bugün 558 → KIRMIZI). | D-K-08, D-K-24 | 0,75 g |

**Toplam ≈ 9,25 gün.** Sıra önemlidir: 5 ve 6 bir günde biter ve en büyük riski (yıkıcı koşum, sessiz topoloji değişimi) kapatır; 1-3 para/stok yollarını kapatır; 9 sınıfsal çözümdür.

**Ön koşul (bekçi değil, kapı):** D-K-01 (CI `adnansahin`) + D-K-02/03 (HEAD'deki kırmızıların temizlenmesi). Bunlar yapılmadan yazılacak 10 bekçi de kimseye kırmızı gösteremez.

---

## Uygulanan kontrol listesi

Prompt Bölüm 3-K (satır 662-669), madde madde:

| Madde | Durum |
|---|---|
| "Mevcut `scripts/test_*.ts` bekçilerini oku: neyi doğruluyorlar, hangi değişmezleri kapsamıyorlar? Kapsanmayan değişmezleri listele" | **Uygulandı** — K10/MATRIX §C'deki değişmez listesi bekçi envanteriyle çaprazlandı; kapsanmayanlar D-K-04 (6 P0 yolu), D-K-05 (4. durum), D-K-09/10 (rapor değişmezleri), D-K-12 (kilit sırası), D-K-17 (parti no), D-K-18 (tek process), D-K-20 (`currentQty ≤ initialQty`), D-K-23 (import) olarak yazıldı. |
| "Eşzamanlılık testi var mı? Kritik yazma yolları için `Promise.all` ile paralel istek testi. Yoksa bu başlı başına bir bulgudur" | **Uygulandı** — 37 `Promise.all` dosyasının gövdeleri çıkarıldı, 33 gerçek sonda sınıflandırıldı; 21 sembol için "aynı dosyada var mı" değil "sondanın İÇİNDE mi" kontrol edildi. Sonuç D-K-04 (yok) + D-K-15/21 (var ama zayıf) + D-K-12/17 (kilit ölçüm biçimi). |
| "Idempotency testi: aynı isteği iki kez gönderme" | **Uygulandı** — 25 idempotency bekçisi dört-durum matrisine oturtuldu; 4. durum (iptal-replay) altı yolda kod okumasıyla doğrulandı → D-K-05. Ayrıca uçuşta-çift-koşum penceresi D-K-23. |
| "Testler gerçek DB'ye karşı mı çalışıyor? Mock/in-memory ise kilit ve kısıt davranışını taklit etmez" | **Uygulandı** — mock YOK, 323/366 dosya gerçek Prisma kullanıyor (**güçlü yön**, "Doğru yapılanlar" md. 1). İstisna sahte tx: `test_batch_number_format.ts` (kabul edilebilir sıra sondası ama gerçek-DB ikizi eksik → D-K-17) ve sahte `rclone`/`pg_dump`/`list` (bilinçli, ops testleri). |
| "Test verisi izolasyonu, testlerin birbirini etkilemesi" | **Uygulandı** — fixture damgalama (280/366), sessiz temizlik (150/669), FK sırası (`rollVariance` RESTRICT), dev DB artığı K2 ile ölçüldü, `clean_test_residue` kapsamı, sıralı koşum + paylaşımlı DB, `systemSetting` yazan 38 test → D-K-07, D-K-08, D-K-19, D-K-24. |
| Görev ek maddesi (1) Kapsanmayan değişmezler + kritik yolların eşzamanlılık bekçisi + somut öneri | **Uygulandı** — D-K-04 tablosu + "Ekibe verilecek bekçi listesi" (dosya adı + ne ölçmeli). |
| Görev ek maddesi (2) Mevcut sondaların KALİTESİ (VARLIK mı SIRA mı, "hata yok" mu "tam 1" mi, N=2, gecikme, bayat yorum) | **Uygulandı** — D-K-12 (sıra), D-K-15 (tam 1), D-K-21 (N/gecikme), D-K-16 (bayat yorum, K2'ye çıkarıldı). |
| Görev ek maddesi (3) "Bekçi hatayla aynı yerde kör" sınıfı — yeni adaylar | **Uygulandı** — **beş yeni aday**: D-K-06 (`test_qc2_idempotency` servisi hiç çağırmıyor), D-K-09 (sevk günlük serisi), D-K-10 (rework damgası; K2 ile), D-K-11 (AST bekçi ham SQL'i görmüyor), D-K-03 (kırmızı körlüğü). `test_kk1_duplicate_guard` bayrak konusu ölçülüp **elendi** (bayrak açık). |
| Görev ek maddesi (4) İdempotency 4. durum bekçileri | **Uygulandı** — D-K-05 matrisi. |
| Görev ek maddesi (5) Test hijyeni (fixture damgası, cleanup FK sırası, sıralı koşum + paylaşımlı DB, artık, `productionDbGate`, typecheck geçidi) | **Uygulandı** — D-K-07, D-K-08, D-K-19, D-K-24; typecheck geçidi doğrulandı ve **doğru yapılan** olarak yazıldı (filtreli koşumda atlanması bilinçli ve dosyada gerekçeli). |
| Görev ek maddesi (6) Servis-seviyesi testler HTTP katmanını görmez; `test_route_auth_coverage` HEAD'de kırmızı | **Uygulandı** — D-K-13 (ölçekle: 260 yazma ucu ↔ ~20 HTTP'den koşan) + D-K-02 (kırmızının kök nedeni `client-policy` `GET /`, muaf listesine yazılmamış — "yeni uç bekçiye kaydedilmedi" teşhisi doğrulandı). |
| Görev ek maddesi (7) Negatif sonda kültürü — grep + olmayan kritik bekçiler | **Uygulandı** — D-K-22 (20/366 yorum, 5 dosyada öz-sınama; eksik olan 6 kritik bekçi adıyla listelendi). |
| Görev ek maddesi (8) `test_single_process` yok; run-all süresi/timeout ve CI | **Uygulandı** — D-K-18 + D-K-01 (CI dal boşluğu, `timeout-minutes` yokluğu). **Süre ölçümü kapsam dışı — koşum dev DB'ye yazar (salt-okunur kural).** |
| K12 uzlaştırması: reddedilmiş bulguyu yeniden açma, açık olanı referansla | **Uygulandı** — `F-OPS-VER-002` (kapanmış) yeniden açılmadı, yalnız belgelenmiş sınırı ölçüldü (D-K-19); `F-CORE-GUV-006` (`test_base_service_binding` yazılmadı) hâlâ açık ve aşağıda referanslandı; `F-CORE-VER-003` (reddedilmiş) hiç ele alınmadı. |
| Beceri §9 yanlış pozitif kataloğu | **Uygulandı** — "Elenen adaylar" bölümü; ayrıca §9.2 gereği testlerdeki `Promise.all` "düzeltilecek hata" olarak yazılmadı (sondanın kendisidir). |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Mock YOK — bekçiler gerçek PostgreSQL'e karşı koşuyor.** 366 dosyanın 323'ü `src/lib/prisma`yı doğrudan kullanıyor, 293'ü gerçekten yazıyor. Bu, kilit/kısıt/FK/trigger davranışının taklit değil **ölçüm** olduğu anlamına gelir; jest/vitest'siz, harness'siz bu karar ERP için doğrudur ve `test_kursun_bypass.ts:1178-1188` gibi "ham `create` → P2002 `kursun_bypass_one_pending_per_step_uq`" sondalarını mümkün kılıyor. **Bozmayın.**
2. **Sıralı koşum + assertion hatasının ASLA yeniden denenmemesi.** `run-all-tests.ts:281-306` yalnız altyapısal hataları (`connect timeout`, `ECONNREFUSED`, `too many clients`) bir kez tekrar deniyor; assertion hatası hiç denenmiyor → flake gizlenmiyor. `MAX_OUTPUT_BYTES` ve `res.error.code` tablosu (`:186-196`) ölçülerek yazılmış. Bu koşucu, ekibin en olgun parçalarından biri.
3. **Tip kontrolü geçidi paketten ÖNCE.** `tsconfig.scripts.json` `scripts/` + `prisma/` + `src/`i kapsıyor ve gerekçesi dosyada ölçümle yazılı (2026-08-01'de 87 tip hatası: yanlış enum üyesiyle süzme → no-op filtre; yanlış ilişki adıyla `deleteMany` + sessiz catch → temizlik hiç koşmamış). "Yeşil ama anlamsız" sınıfını kapatan doğru araç.
4. **Negatif sonda kültürü ve onun kendi kendini yakalaması.** `test_kk1_duplicate_guard.ts:47-55`: dört sonda koşulmuş, md5 ile geri yüklenmiş **ve** S6'nın ilk hâlinin boş bir iddia olduğu fark edilip düzeltilmiş. K12'ye göre 26 düzeltmenin 24'ü negatif sondayla kanıtlı bekçi taşıyor. Sektörde nadir.
5. **Öz-sınama vektörleri (`test_raw_sql_hygiene.ts:420-483`).** Bekçi kendi tarayıcısını sentetik kaynak parçalarına karşı koşuyor — "yorumdaki NOW() temiz", "gerekçesiz `-- tz-ok` MUAF DEĞİL, ayrı listede ve kırmızı". Bu, negatif sondanın **her koşumda tekrarlanan** biçimidir; D-K-22'nin önerdiği hedef desen budur.
6. **İki yönlü muaf listeleri.** `test_route_auth_coverage.ts:193-207` (ölü muaf + gereksiz muaf + gerekçe uzunluğu), `test_order_line_scope_single_source.ts:133` (bayat muaf), `test_barcode_reservation.ts:41-62` (tx-içi çağrı listesi iki yönlü). Muafiyet listesi tek yönlü olsaydı düzeltilen her şey sessizce affedilirdi.
7. **Körlük zemini.** `test_route_auth_coverage.ts:117` `MIN_ROUTE_LAYERS = 400`, `test_controller_binds.ts:47-48` `MIN_HANDLERS=120`/`MIN_ROUTE_REFS=300`, `test_raw_sql_hygiene.ts:537` `ASGARI_DOSYA`, `test_shipment_scope_lock.ts:63` `undoBody.length > 200`, `test_shipment_list_gross.ts:237` `body.length > 500`. 47 kaynak-tarayan bekçinin 41'inde var. "İhlal yok" ile "hiçbir şeye bakılmadı" ayrımı mekanik.
8. **Kilit sırası bekçisinin `-1` disiplini.** `test_shipment_scope_lock.ts:66-77` her karşılaştırmaya `lockAt !== -1 && countAt !== -1` koşulunu ekliyor — çıpa kaybolduğunda "kilit önce" **yanlışlıkla doğru** çıkmıyor. Naif yazımda (`lockAt < countAt`) kilit silinseydi `-1 < 5` → yeşil olurdu. Bu detay, bekçiyi bekçi yapan şey.
9. **`check-migrations.mjs` ve `check-docs.mjs`.** Gerçek bir saha vakasından doğmuş, zero-dep, hızlı, beş kapılı. Tek eksiği tetikleyici (D-K-14) — mekanizmanın kendisi örnek alınmalı.
10. **Paylaşımlı fixture'ların gerekçesi yazılı.** `fixture-subcontractor.ts:28-45` neden kalıcı (upsert) olduğunu ölçümle açıklıyor: *"koşucu sıralı ama tek tek elle koşturma paraleldir"*. Fixture kararlarının gerekçesiyle birlikte yaşaması, D-K-08'de eksik olan tam da bu.

---

## Sınır ötesi notlar

Kendi alanım bekçiler; aşağıdakiler koddaki kusurlara işaret ediyor ve ilgili alanlara aittir. **Ben yalnız bekçi tarafını yazdım.**

- **(D-B / idempotency)** `inventory.service.ts:963-996` KK1 replay dalı `existing.status`u okumuyor; `order.service.ts:2026-2049` `resolveCreateTokenReplay` sipariş statüsünü okumuyor; `shipping.service.ts:1362-1373` sevkiyat `CANCELLED` iken `success:true` + "Sevkiyat kuruldu" mesajı basıyor; `shipping.service.ts:181-199` çuval replay'i statüyü hiç seçmiyor. `subcontractor.service.ts:2359-2364` doğru yapıyor (`RECEIPT_CANCELLED`) ve yorumunda "KK1 ENTRY_CANCELLED emsali" diyor — **emsal KK1'de yok**, yorum kodun durumunu yanlış anlatıyor.
- **(D-B / import)** `import/import.service.ts:447-475` token okuması ile `ImportRun` yazımı arasındaki uçuş penceresi (D-K-23'ün kod ayağı).
- **(D-A / eşzamanlılık)** `kursun-qc.service.ts:429-438`: `existedBefore` okuması tx **DIŞINDA**, `upsert` tx içinde; audit'in "CREATE mi replay mi" kararı bu bayat okumaya dayanıyor. İki paralel `completeQc2` çağrısında ikisi de `existedBefore=null` görüp iki CREATE audit'i yazabilir (op tek kalır). Bekçi tarafı D-K-06.
- **(D-A)** 8021'in sırası (`inventory.service.ts:844` ↔ `:848`) doğru ama yalnız yorumla korunuyor (D-K-12). 8027 (`master-data-merge.service.ts:546`) ve 8024 (`session-registry.service.ts:79`) doğru sırada ama hiç ölçülmüyor.
- **(D-E / rapor semantiği)** Kalite/Fire Karnesi'nin statü süzgeci (`quality-scorecard.report.service.ts:194,:318` — `K18_DEAD_STATUSES`) yeniden üretime alınmış topu elemiyor; saha kopyasında 4 top / 475 m (D-K-10 K2 ölçümü). Karar gerekiyor: süzgeci daraltmak mı, yeniden-üretimde damgayı NULL'lamak mı.
- **(D-E / rapor semantiği)** `shipment-scorecard.report.service.ts:130-137` günlük serisi `_shipped.ts`ten beslenmiyor (D-K-09).
- **(D-F / yetki)** `client-policy.routes.ts:59` `GET /` bilinçli public ve gerekçesi dosyada yazılı; **güvenlik bulgusu değil**, yalnız muaf listesine kaydedilmemiş (D-K-02). Muaf anahtarının router-yerel (`"GET /"`) olması ise gerçek bir tasarım zayıflığı — ileride başka bir router'ın kimliksiz `GET /`ini sessizce affeder.
- **(D-J / migration)** `test_db_invariants` §1/§5'in kalıcı kırmızısı yumuşak kapı migration'larının doğal sonucu; dev'de `colors_nameFoldColor_key` yok (1 mükerrer katlanmış renk adı), sahada `items_nameFold_key` yok. "Enforce bekliyor" durumunun bir sahibi ve tarihi olmalı (D-K-03 önerisi).
- **(D-I / gözlemlenebilirlik)** `test_consistency.ts` ve `test_consistency_derived.ts` **salt-okunur** ve `DATABASE_URL=<kopya>` ile prod kopyasına karşı koşulabiliyor — ama otomatik koşan hiçbir şey yok (ne CI ne scheduler). Mutabakat kapısının değeri canlıya karşı koşmasında; bugün elle.
- **(Ops)** `.github/workflows/ci.yml`de hiçbir job'da `timeout-minutes` yok → GitHub varsayılanı 360 dk; 366 test × 180 sn tavanı teorik olarak aşabilir ve iş akışı sessizce iptal edilir.
- **(Konfigürasyon, bulgu değil)** `kk1.duplicateGuardEnabled` dev ve sahada `true` (ölçüldü). Bayrak panelden kapatılırsa `inventory.service.ts:807-813` `guardActive=false` olur ve advisory kilit dalı **hiç koşmaz** — 2026-08-04'ün 46 ms/5 kayıt vakası geri gelir. Kod ve bekçi doğru; risk bir yönetim kararında. Ayarlar ekranında bu bedelin yazılı olması yerinde olur.
- **(Diğer denetçiler)** `Teks-Erp/scripts/` altında `audit_repro_D-A-*.ts` / `audit_repro_D-B-*.ts` dosyaları untracked duruyor. Bağımsızlık gereği **okumadım**. Not: `check-migrations.mjs` GATE 4 yalnız `test_*.ts` desenini izlediği için bunlar kapı dışıdır ve `run-all-tests.ts`in `/^test_.*\.ts$/` filtresi de onları koşmaz — yani pakete sızmıyorlar. Denetim bitince silinmeleri gerekir.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Durum / sebep |
|---|---|
| **Test paketinin koşturulması, süre ve flake ölçümü** | **Kapsam dışı — SALT-OKUNUR kuralı.** Koşum dev DB'ye 2.048 `deleteMany` gönderir. D-K-02/03'ün kırmızılığı koşumla değil, kod+DB'den deterministik olarak türetildi (yol her bulguda yazılı). |
| Toplam paket süresi / `PER_TEST_TIMEOUT_MS` yeterliliği | Ölçülemedi (koşum yok). En büyük dosyalar satır sayısıyla verildi (`test_kursun_bypass.ts` 1.267, `test_fason_ceki_html.ts` 1.261); satır ≠ süre. |
| 366 dosyanın her satırının okunması | Yapılmadı. **Tam gövde okunan: ~35 dosya** (33 paralel sonda, 8 idempotency dosyası, 12 kaynak-tarayan bekçi, D-K bulgularına konu olan her dosya). Kalanlar için başlık + hedeflenmiş grep. |
| Bekçilerin gerçekten "kırmızı verebildiğinin" doğrulanması | Yalnız kod okumasıyla (çıpa/`-1` disiplini/zemin) değerlendirildi; fiilen negatif sonda koşulmadı (kod değiştirmek yasak). D-K-22 bu boşluğun ekip tarafındaki karşılığı. |
| `test_consistency` / `test_consistency_derived`in dev ve saha'daki güncel kırmızı bölümleri | Koşulmadı. §13/§18/§20'nin anlamı K12/mutabakat notlarında zaten çözülmüş; tekrarlanmadı. |
| Electron (`Vitest`) ve mobil (`jest-expo`) test paketleri | **Kapsam dışı — görev `Teks-Erp/scripts/test_*.ts`.** CI'da ikisi de var ve `adnansahin`de onlar da koşmuyor (D-K-01 ikisini de kapsıyor). |
| `scripts/load_test.ts`, `bench_*.ts`, `seed*`, `fix_*`, `backfill*` | Envanter dışı (`test_` öneksiz, koşucu görmez). `load_test.ts` CI'da ayrı `continue-on-error` job'da. |
| Dolaylı servis kapsaması (çağrı grafiği) | Hesaplanmadı (araç yok). K11 §4a'nın "alt sınır" uyarısı geçerli: 41 dosyanın "0 doğrudan bekçi" sayısı gerçek kapsamı olduğundan kötü gösterebilir. |
| Canlı prod DB | Erişim yok (brief). Ölçümler dev (`adnansahin_db`) ve prod'un 2026-08-25 kopyası (`tekserp_saha_0825`, 190/195 migration) üzerinde. Son 5 migration'ın kolonları kopyada YOK — `order_lines.cancelledAt` bağımlı ölçümler yapılmadı. |
| Diğer denetçilerin bulguları | Okunmadı (bağımsızlık kuralı). Harita dosyaları (`K*.md`, `MATRIX.md`, `KRITIK-YAZMA-YOLLARI.md`, `K12`) okundu ve her sayısal iddiaları bağımsız doğrulandı. |
