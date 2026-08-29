# DOĞRULAMA — BULGU-T1-008

**Başlık:** İçe aktarımın replay anahtarı EN SONDA yazılıyor — uçuştaki bir tekrar dosyanın TAMAMINI ikinci kez yazar (sipariş adaptörü create-only)
**Dosya:** `Teks-Erp/src/services/import/import.service.ts:443-475` (kapı) · `:505-544` (döngü) · `:552-576` (kayıt)
**Şiddet (giriş):** S1 · **Kanıt seviyesi (giriş):** K3 (iddia) → **çıkış: K3 (ÖLÇÜLDÜ)**
**Karar:** ✅ **DOĞRULANDI** — mekanizma dev DB'de 30/30 tekrarda tetiklendi; prod kopyasında fiili ihlal YOK (özellik hiç kullanılmamış).
**Doğrulayan tur:** TUR 1 · 2026-08-28 · SALT-OKUNUR (tek yazma: `scripts/audit_repro_BULGU-T1-008.ts`)

---

## 1. Kod teyidi (K1 tabanı — bulgunun iddiaları tek tek doğrulandı)

| İddia | Durum | Yer |
|---|---|---|
| Token kapısı koşumun BAŞINDA okunuyor | ✅ | `import.service.ts:447` `const prior = await prisma.importRun.findUnique({ where: { clientToken } })` |
| `runId` önceden üretiliyor ama DB'ye YAZILMIYOR | ✅ | `:476` `const runId = crypto.randomUUID();` — yalnız audit `newData.importRunId` için |
| Satır satır yazma, her biri KENDİ tx'inde | ✅ | `:505-544` `adapter.createOne/updateOne`; tek tx bilinçli YOK (`:12-24` yorum) |
| Replay anahtarı (ImportRun satırı) EN SONDA doğuyor | ✅ | `:552` `await prisma.importRun.create({ data: { id: runId, …, clientToken, … } })` |
| Sipariş adaptörü create-only, doğal anahtarsız | ✅ | `order.adapter.ts:314-317` `updateOne()` **throw** eder; `:159-163` `findExisting` boş döner → her grup CREATE |
| Sipariş yazımında `clientToken` GİTMİYOR (satır bazlı ikinci hat yok) | ✅ | `order.adapter.ts:284-313` — `payload` yalnız `customerId/lines/branchId/orderDate/deadline/currency`; `orderService.create(payload, ctx.userId)` |
| Electron tarafı 15 sn'de kesiyor | ✅ | `Electron/src/services/apiClient.ts:44` `timeout: 15_000`; `importService.ts:180-187` `apply` **override etmiyor** |
| Tekrar denemede AYNI token gidiyor | ✅ | `ImportDialog.tsx:118` `useRef(crypto.randomUUID())`, `:160` yalnız `[open, entity]` değişince yenilenir; `:348` `clientToken: attemptToken.current` |
| Hata sonrası düğme yeniden açılıyor | ✅ | `ImportDialog.tsx:354-371` `catch → toast.error("İçe aktarım yapılamadı.")`, `finally → setBusy(null)` |
| İkinci koşumun `importRun.create`'i P2002 → 409 | ✅ | `middlewares/error.middleware.ts:388-407` → `res.status(409)` `Bu 'clientToken' değeri zaten mevcut (unique constraint).` |

### Koruma kontrolü (altı kaynak — beceri §7.8)
| Aranan koruma | Var mı | Kanıt |
|---|---|---|
| DB unique (`clientToken`) | **VAR ama etkisiz** | `import_runs_clientToken_key` — **düz** unique (saha+dev'de doğrulandı, SQL S8). Satır DÖNGÜDEN SONRA yazıldığı için pencere boyunca hiçbir şeyi kapatmaz; yalnız ikinci koşumu **yazımlar bittikten sonra** 409'a düşürür. |
| Advisory lock | **YOK** | `pg_advisory_xact_lock` 8 kullanım noktasının hiçbiri import değil (KUNYE); `grep` `import/` altında 0 |
| Atomik claim (`updateMany WHERE beklenen-durum`) | **YOK** | `apply` içinde tek `updateMany` yok; ImportRun ön-rezervasyonu yok |
| Süreç-içi "koşuyor" bayrağı | **YOK** (emsali VAR) | `backup.service.ts:199-221` ve `db-copy.service.ts:373-405` bu bayrağı taşıyor; `ImportService` taşımıyor — aynı repoda doğru desen mevcut |
| Servis düzeyi idempotency (`Order.clientToken`) | **DEVRE DIŞI** | adaptör payload'ında `clientToken` göndermiyor (yukarıda) |
| İstemci tarafı token yapışması | **DOĞRU ÇALIŞIYOR** | Yapışma kuralının kendisi doğru (2026-08-03 KK1 dersi); zararlı olan backend penceresi |
| CHECK / trigger | **YOK** | `import_runs` üzerinde yalnız NOT NULL + PK + FK (SQL S8, iki ortamda da) |

---

## 2. K2 — veride fiili ihlal araması

**Sorgu:** `audit/data/BULGU-T1-008.sql` (9 bölüm) · **Sonuç:** `audit/data/BULGU-T1-008.txt`

| Bölüm | Prod kopyası (`tekserp_saha_0825`) | Dev (`adnansahin_db`) |
|---|---|---|
| S1 toplam koşum | **0** | 299 (bekçi/repro kalıntısı) |
| S2 satır profili | — | `order`: 2 koşum, max 1 satır · `color`: 297 koşum, max 2 satır |
| S3 ≥15 sn süren koşum | 0 | **0** |
| S4 token dağılımı | 0/0 | 64 tokenli · 235 tokensiz |
| S5 aynı dosya 10 dk içinde 2+ koşum | 0 | 20+ çift (hepsi bekçi kalıntısı, `fileName` NULL) |
| S6 `_source=IMPORT` audit izi | **0 satır** | yalnız `COLOR` (294 satır / 197 koşum) |
| S7 içe aktarımdan MÜKERRER sipariş | **0** | 0 |
| S8 `import_runs` kısıtları | PK + FK + NOT NULL; unique yalnız `clientToken` (**düz**) | aynı |
| Aynı token ile 2 ImportRun satırı | — | **0** (beklenen — unique zaten engelliyor; ikinci koşumun İZİ hiç kalmıyor) |

### K2 hükmü
**Prod kopyasında fiili ihlal YOK — ve olamaz: `import_runs` 0 satır, `data:import` iznini taşıyan 1 kullanıcı var, özellik sahaya çıktığından beri HİÇ kullanılmamış.** Bu bulgu bir *fiili hasar* değil, **ilk gerçek kullanımda ısıracak bir açık**tır. Bu yüzden şiddet S1'de bırakıldı; K2'nin boş çıkması bulguyu çürütmez (yokluk kanıtı: özellik dormant), ama S0'a çıkarmayı da engeller.

### Pencerenin FİİLEN açık olduğu eşik (saha verisi olmadığı için ölçülerek türetildi)
- **(A) Satır maliyeti** — `audit_repro_BULGU-T1-008.ts §3`: 1/5/20 satır → 6/22/79 ms; **marjinal ≈ 3,8 ms/satır** → Electron'un 15.000 ms tavanı **≈ 3.900 satırda** aşılır. (Alt sınır: prod Windows-native PG + ağ + vardiya yükü daha yavaştır.)
- **(B) Gövde tavanı** — global `express.json({limit:"1mb"})` (`app.ts:141`) router'ın kendi 10 MB parser'ından (`import.routes.ts:28`) ÖNCE koşar (K9 H-1 / KYY-38): **sade** 4 sütunlu sipariş satırı 112 B → 1 MB ≈ 9.800 satır; **zengin** 13 sütunlu satır 327 B → 1 MB ≈ 3.200 satır.
- **HÜKÜM:** *sade* şablonda **~3.900 – ~9.800 satır** aralığındaki dosyalar hem parser'dan geçer hem 15 sn'yi aşar → **pencere AÇIK**. *Zengin* şablonda 413 önce gelir → o dosya sınıfında pencere kapalı. Ayrıca zaman aşımı **tek tetikleyici değil**: ağ kopması / sunucu restart'ı da `ECONNABORTED`/5xx üretir ve "Tekrar Dene" aynı token'la gider — o yolda **satır sayısı şart değildir**.

> ⚠️ **Bulgunun failure_mode'undaki sayı YANLIŞ, mekanizma DOĞRU.** "900 satırlık sipariş dosyası 15 sn'de zaman aşımına uğrar" iddiası ölçümle çürüdü: 900 satır ≈ **3,4 sn**. Doğru eşik ~3.900 satırdır. Bulgunun *sebep-sonuç zinciri* aynen geçerlidir; yalnız senaryo metnindeki satır sayısı düzeltilmelidir.

---

## 3. K3 — repro

**Mevcut script yeniden koşuldu:** `Teks-Erp/scripts/audit_repro_D-B-05.ts` → aynı sonuç birebir tekrarlandı (2 eşzamanlı apply → **2 sipariş**, tek ImportRun satırı, ikinci koşumun izi yok). Log: `audit/repro/D-B-05.log` (önceki) + yeniden koşum aynı çıktıyı verdi.

**Ölçekli script yazıldı:** `Teks-Erp/scripts/audit_repro_BULGU-T1-008.ts` → log `audit/repro/BULGU-T1-008.log`
Fixture damgası `AUDITREPRO-BULGU-T1-008-<6>`; temizlik `finally`'de (494 sipariş + 34 `import_runs` + kumaş/müşteri silindi; **kalıntı 0** — doğrulandı). Global ayar/feature-flag değiştirilmedi; yazıcı/pg_dump/rclone çağrılmadı.

### §1 — N eşzamanlı apply, aynı token, 10 tekrar (1 satırlık dosya)
| N | Bozulan tekrar | Fazladan yazılan sipariş | En kötü tekrarda kopya |
|---|---|---|---|
| 2 | **10/10** | 10 | 2 |
| 5 | **10/10** | 40 | 5 |
| 10 | **10/10** | 88 | 10 |

**30/30 tekrarda değişmez bozuldu.** Her tekrarda `ImportRun` satırı **1** — yani fazladan yazımların DEFTERDE HİÇBİR İZİ YOK.

### §2 — Gerçek saha senaryosu (uçuştaki koşuma ikinci istek)
150 satırlık dosya, 2. istek koşumun 150. ms'inde, **aynı token**:
```
apply#1=OK status=APPLIED created=150 · apply#2=REJECT P2002
ImportRun defteri: satır=1 status=APPLIED created=150 rowCount=150 · DB'de FİİLEN 300 sipariş
❌ 150 satırlık dosya → 300 sipariş yazıldı (150 fazladan); kullanıcı HATA gördü; defter 150 diyor
```
**Dosya tam olarak İKİ KEZ yazıldı. Kullanıcı 409 hatası gördü. Defter "150 yazıldı" diyor, DB'de 300 var.**

> ⚠️ İlk yazımda §2 **yeşil** çıkmıştı (12 satırlık dosya ≈ 60 ms < 120 ms gecikme → 2. istek koşum BİTTİKTEN sonra geldi ve replay dalına düştü). Bu bir **etkisiz sonda**ydı; dosya büyütülüp gecikme kısaltılınca kırmızıya döndü. Aynı zamanda **olumlu kontrol**: koşum bittikten sonra token gerçekten koruyor — kusur tam olarak *uçuş penceresi*.

### §3 — Zamanlama (yukarıda K2 bölümünde)

---

## 4. Bekçinin kör noktası (K bulgusu — mevcut testin neden yeşil kaldığı)

`Teks-Erp/scripts/test_import_framework.ts:304-312` (#10 "clientToken idempotent"):
```ts
const first  = await ImportService.apply("color", [row(2, { name: nameC })], { clientToken: token });
const second = await ImportService.apply("color", [row(2, { name: nameC })], { clientToken: token });
check("aynı clientToken ikinci kez YAZMAZ", cRows.length === 1, …);
```
İki çağrı **SIRALI** (`await` … `await`). Bekçi tam olarak **çalışan** durumu ölçüyor; bozuk olan *uçuş penceresi* hiç ölçülmüyor. Bu, projenin kendi adlandırdığı **"bekçinin kör noktası hatanın kendisiyle aynı yerde"** sınıfının bir örneğidir (2026-08-26 sebep-önbelleği ve 2026-08-22 `test_tambur_undo §5` vakalarıyla aynı desen). Ek olarak `color` adaptörü **upsert**tir (doğal anahtar `name` var) — mükerrer yazımı ikinci hat olarak `nameFold` seddi de yakalar; kusurun en ağır olduğu **create-only** `order` adaptörü bekçide hiç kullanılmıyor.

---

## 5. Çakışma senaryosu (ölçümle güncellenmiş)

| T | Olay |
|---|---|
| T1 | Planlamacı ~4.000 satırlık (sade şablon) sipariş dosyasını yükler → `POST /api/import/order/apply`, `clientToken=K` |
| T2 | Sunucu satırları yazmaya başlar (`orderService.create` × N, her biri kendi tx'i + audit'i) |
| T3 | **15,0 sn** — Electron `apiClient` `ECONNABORTED` ile keser → `toast.error("İçe aktarım yapılamadı.")`, `setBusy(null)` ile düğme açılır. **Sunucu koşmaya devam eder.** |
| T4 | Kullanıcı "Uygula"ya tekrar basar → **AYNI** `attemptToken` (yalnız diyalog kapanınca yenilenir) |
| T5 | `importRun.findUnique(K)` → **NULL** (T1 hâlâ döngüde, satır sonda yazılıyor) → dosya **BAŞTAN** yazılır |
| T6 | T1 biter → `importRun.create(K)` başarılı |
| T7 | T4 biter → `importRun.create(K)` → **P2002** → HTTP **409** |
| **SONUÇ** | **8.000 sipariş** (4.000'i mükerrer), hepsi `PLANNED`, hepsi MRP/karşılama/Ürün Dengesi hesabına girer. Kullanıcı **iki kez de hata** gördü. Defterde tek `ImportRun` var ve `created=4000` diyor. Fazladan 4.000 siparişi ayırt edebilecek tek iz, `newData.importRunId` taşıyan audit satırlarıdır — ve **ikinci koşumun runId'si hiçbir `import_runs` satırına bağlanamaz** (satırı P2002'ye düştü). |

---

## 6. Hüküm

| Alan | Giriş | Çıkış | Gerekçe |
|---|---|---|---|
| Kanıt seviyesi | K3 (iddia) | **K3 (ölçüldü)** | 30/30 tekrar + 150→300 satır ikizlenmesi + zamanlama/gövde eşiği |
| Şiddet | S1 | **S1 (korunur)** | Etki *yüksek* (tutarsız veri, sessiz çift yazım, defter yalan söylüyor) × Olasılık *düşük* (prod'da 0 koşum, 1 izin sahibi, ≥3.900 satır ya da ağ kopması gerekir). Düzeltici etken çift yönlü: kullanıcı **net hata alıyor** (bir kademe düşürür) ama **veri sessizce ikizleniyor ve defter yanlış sayı basıyor** (bir kademe yükseltir) → net değişim yok. S0'a çıkarılmadı: prod'da fiili ihlal yok. |
| Kategori | F | F (+K) | API/uzun senkron iş sınırı; ek olarak bekçi kör noktası (K) |
| failure_mode | "900 satır → timeout" | **düzeltildi: ~3.900 satır** | ölçüm, `audit_repro_BULGU-T1-008.ts §3` |

**Önceki defter:** `audit/FINDINGS.jsonl`'de bu sınıfta reddedilmiş bir bulgu YOK. `K12` §10 yalnız `import-lookup` `mode:insensitive` konusunu taşıyor (ilgisiz). Haritalarda bağımsız olarak zaten kayıtlı: `MATRIX.md:145` + `:257` (madde 26), `KRITIK-YAZMA-YOLLARI.md` KYY-38 (**(B)** uçuşta çift koşum), `K9 H-2`. Yani üç ayrı harita bu pencereyi bağımsız olarak tespit etmiş; bu doğrulama onu **ölçülü** hâle getirdi.

---

## 7. Düzeltmenin şekli (2. tur için — bu turda UYGULANMADI)

1. **Koşum satırını BAŞTA rezerve et:** `runId` üretildiği yerde (`:476`) `importRun.create({ id: runId, clientToken, status: "RUNNING" })` — `ImportRunStatus`'a `RUNNING` eklemek **migration ister** `[PROD'DA ÇALIŞTIRMA — sürüm penceresinde]`. Böylece unique kısıt pencereyi kapatır: ikinci istek `create`te P2002 alır ve **hiçbir satır yazmadan** durur; kullanıcı 409'u *veri yazılmadan* görür. Sonda `update` ile `APPLIED/PARTIAL/FAILED` + sayaçlar yazılır.
2. **Yarıda kalan koşum:** boot'ta `RUNNING` satırları `INTERRUPTED`a çevir — `db-copy.service.ts:373-405`'teki desenin birebir aynısı (tek process invariantı bunu güvenli kılar).
3. **Uçuştaki token'a doğru cevap:** `prior.status === "RUNNING"` → `409 IMPORT_IN_PROGRESS` + "aynı yükleme sürüyor, bitmesini bekleyin" (sessiz replay DEĞİL — mevcut replay dalı `:449-471` bittikten sonra doğru davranıştır, uçuşta değil).
4. **İstemci:** `importService.apply` için `timeout`u yükselt (satır sayısıyla orantılı, ör. `Math.max(60_000, rows*20)`) — 15 sn tavanı içe aktarım için yanlış bütçedir; ve zaman aşımı toast'ı "yazılmadı" DEMEMELİ (2026-08-12 kuralı: *timeout ≠ yazılmadı*). Şu anki metin "İçe aktarım yapılamadı." bunu ihlal ediyor.
5. **Bekçi:** `test_import_framework` #10'a **eşzamanlı** varyant ekle (`Promise.allSettled` × 2, `order` adaptörüyle — create-only olduğu için ikinci hat yok) + negatif sonda (rezervasyon kaldırılınca kırmızı vermeli).

**Kabul kriteri:** `audit_repro_BULGU-T1-008.ts` §1 (N=2/5/10 × 10) ve §2 **yeşil** dönmeli — 1 satırlık dosya → 1 sipariş, 150 satırlık dosya → 150 sipariş; ikinci istek 409 alır ve **DB'ye tek satır yazmaz**.
**Efor:** ~1 gün (migration + servis + istemci timeout + bekçi).

---

## 8. Yan bulgu (bu turda ortaya çıktı, ayrı bulgu olarak ele alınmalı)

**Aynı token + FARKLI gövde → sessiz yutma.** `D-B-05.log` §2: koşum bittikten sonra aynı token'la BAŞKA bir dosya gönderilirse `apply` önceki koşumun sonucunu döner (`created=1`) ve **yeni dosyadan hiçbir şey yazılmaz** — kullanıcı "1 kayıt oluşturuldu" mesajını görür. Bu, beceri paketi §8'in "idempotency 4. durumu"dur ve `MATRIX.md:219`'da zaten kayıtlı (Order/WorkOrder/Sack/Shipment/SubcontractorReceipt/ImportRun `clientToken` dallarında iptal/farklı-gövde replay'i ölçülmüyor). Pratikte tetiklenmesi zor (token diyalog kapanınca yenileniyor) ama düzeltme (1) yapılırken aynı dalda `payload hash` karşılaştırması eklenirse bedavaya kapanır.

## 9. KAPSANMAYAN / ERİŞİLEMEYEN
- **Canlı prod'a erişim yok** — ölçümler 2026-08-25 kopyası üzerinde. Kopya alındıktan sonra sahada içe aktarım kullanılmış olabilir; `import_runs` sayısı canlıda tekrar bakılmalı.
- **HTTP katmanı uçtan uca koşulmadı** (sunucu ayağa kaldırılmadı — salt-okunur denetim). §1/§2 servis katmanında ölçüldü; `apiClient` 15 sn tavanı ve 409 dönüşü KOD okumasıyla doğrulandı, gerçek istekle değil.
- **1 MB / 413 sınırı bu turda yeniden ölçülmedi** — K1a §0.2 / K9 H-1'in izole Express sondasıyla yapılmış ölçümü referans alındı; buradaki katkı yalnız gövde BOYUTU hesabıdır (satır başına bayt).
- **`order` dışındaki 16 adaptör** ölçülmedi. Çoğu doğal anahtarlı upsert olduğu için ikinci koşum SKIP/UPDATE üretir (hasar düşük); `route.adapter` nested `steps: {deleteMany, create}` taşıdığı için çift koşum sonucu ayrıca incelenmeli — **ayrı bulgu adayı**, bu turun kapsamı dışı.
