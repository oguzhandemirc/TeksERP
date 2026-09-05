# D-F — API & Express katmanı [P3] · TUR 1 BULGULARI

**Tarih:** 2026-08-28 · Dal `adnansahin` (HEAD `ce8681d1`) · Denetçi: D-F (② BULMA, tur 1)
**Mercek:** kod merkezli — Express 5 hata akışı, doğrulamasız yazma uçları, mass-assignment, sayfalama, toplu uçlar, uzun senkron işler, yanıt sözleşmesi.
**Kaynaklar:** `audit/00-map/{_BRIEF,KUNYE,K1a,K1b,K6,K12,MATRIX,SINIR-OTESI-YONLENDIRME}.md` · beceri `express-api-audit` (§9 yanlış pozitif kataloğu okundu) · prompt Bölüm 3-F (satır 574-598).
**DB ölçümleri:** yalnız `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`) ve `sql-dev.sh`. Canlı prod'a erişim yok.
**Repro sondaları:** repo `node_modules`'ü kullanan **izole** harness'lar (`scratchpad/json-limit-probe.mjs`, `status-err-probe.mjs`, `dmmf-allowlist.mjs`). Repo dosyası DEĞİŞTİRİLMEDİ, DB'ye YAZILMADI.

---

## 0. Bu turda ölçülen taban (kendi ölçümüm, haritalardan bağımsız)

| Ölçüm | Sonuç | Nasıl |
|---|---|---|
| `express.json` kullanımı | 3 (global `app.ts:141` 1 MB · `import.routes.ts:28` 10 MB · `config-bundle.routes.ts:27` 10 MB) | grep |
| Express 5 promise bağlama | `node_modules/router/lib/layer.js:150-166` `ret.then(null, err => next(err ?? new Error('Rejected promise')))` — sarmalayıcı GEREKMİYOR | kaynak okuması |
| `res.*` servis katmanında | 5 satır, hepsi `helpers/guarded-hard-remove.ts` (handler fabrikası) | grep |
| `$transaction` route/controller katmanında | **0** | grep |
| Offset (`skip:`) sayfalama | 5 vuruş; gerçek yol **2**: `query-parser.ts:351` (`MAX_OFFSET` 10.000 → 400) ve `base.service.ts:544` (ilişki-sıralaması, offset>10.000 → 400) | grep + okuma |
| Cursor tie-breaker | **VAR** — `cursor.ts:57-62` (statik) ve `:205-215` (dinamik), ikisi de `id` ile | okuma |
| Döngü içinde ORM çağrısı | **67 nokta / 25 dosya** (tarayıcı `scratchpad/n1-scan.mjs`) | AST-siz brace tarayıcı |
| Yanıtta `stack`/`sql`/`meta` | **0** (hata dallarının tamamı sabit Türkçe metin) | grep |
| 200 gövdesine ham `err.message` | **16 nokta** (§ D-F-10) | grep |
| `sanitizeWriteData` allowlist genişliği | Customer 23 · Item 14 · Color 13 · Order 21 … alan (DMMF scalar+enum, `*Fold` hariç) | `dmmf-allowlist.mjs` |

---

## BULGULAR

### [D-F-01] Rota seviyesindeki 10 MB gövde limiti HİÇ koşmuyor — 2 MB'lık içe aktarım 413 ile düşer, mesaj "1MB sınırı" der

| Şiddet | S2 | Kategori | F (gövde limiti / yanıt sözleşmesi) | Öncelik | P2 | Modül | ICE (içe aktarım) + CORE | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `app.ts:141`'deki global `express.json({limit:"1mb"})` TÜM router'lardan önce mount edilmiştir ve gövdeyi orada tüketir. `import.routes.ts` ile `config-bundle.routes.ts` kendi `express.json({limit:"10mb"})` katmanlarını route satırında taşıyor, ama o katman gövdeye hiç ulaşmıyor: 1 MB'ı aşan istek zaten global parser'da `entity.too.large` ile hata zincirine çıkıyor. Tasarım (`docs/design/IMPORT-EXPORT-TASARIM.md`) ve iki dosyanın kendi yorumları 10 MB / 10.000 satır vaat ediyor; `MAX_IMPORT_ROWS = 10000` da bunu varsayıyor. Sahada büyük dosya içe aktarımı sessizce 413'e düşer ve 413 metni kullanıcıya **yanlış sınırı** (1 MB) söylemez — orada "1MB" yazıyor ama ekran 10 MB vaat ediyor.

**Kanıt**
- `Teks-Erp/src/app.ts:141` — `app.use(express.json({ limit: "1mb" }));` (mount'lar `:500-587`, yani parser'dan SONRA).
- `Teks-Erp/src/routes/import.routes.ts:15-18` — *"bu router KENDİ `express.json` katmanını taşır (10 MB). Global limit 1 MB'dir ve DEĞİŞMEZ"*; `:28` `const jsonBig = express.json({ limit: "10mb" });`; kullanım `:242` ve `:279`.
- `Teks-Erp/src/routes/config-bundle.routes.ts:27` aynı desen, kullanım `:133`, `:158`.
- `Teks-Erp/src/services/import/import-coerce.ts:127` — `MAX_IMPORT_ROWS = 10000`.
- **Kütüphane davranışı (neden ikinci parser koşmuyor):** `node_modules/body-parser/lib/read.js:45-49` — `if (onFinished.isFinished(req)) { next(); return }`. Global parser gövdeyi tükettiği için ikinci parser hiç okumaz; 1 MB aşımında zaten hiç çağrılmaz.
- `Teks-Erp/src/middlewares/error.middleware.ts:290-296` — 413 metni: *"İstek gövdesi çok büyük (1MB sınırı aşıldı)"*.

**failure_mode.** 2 MB'lık (≈ 6.000 satır) müşteri CSV'si → `POST /api/import/customer/apply` → **HTTP 413** `{"success":false,"message":"İstek gövdesi çok büyük (1MB sınırı aşıldı)…"}` → Electron `ImportDialog` `toast.error("İçe aktarım yapılamadı.")`. Kullanıcı "10.000 satıra kadar" yazan ekranda 6.000 satırı yükleyemez ve sebebi hiçbir yerde doğru yazmaz.

**Repro (K3).** `scratchpad/json-limit-probe.mjs` — repo'nun kendi `express`/`body-parser` sürümüyle, `app.use(express.json({limit:"1mb"}))` + router-içi `express.json({limit:"10mb"})` ikizi:
```
0.5 MB: gövde=0.49MB → HTTP 200 {"ok":true,"rows":2333}
2 MB  : gövde=2.00MB → HTTP 413 {"type":"entity.too.large","status":413,"name":"PayloadTooLargeError"}
5 MB  : gövde=5.00MB → HTTP 413 …
```

**Veride fiili ihlal (K2).** Prod kopyasında `import_runs` **0 satır** (özellik sahada henüz kullanılmadı) → fiili ihlal yok; dev'de 297 koşum, hepsi 1-2 satırlık test. Yani hata **ilk gerçek toplu yüklemede** ortaya çıkacak.

**İş etkisi.** Yeni müşteri devreye alma / toplu kumaş-müşteri yükleme akışı sahada ilk denemede tıkanır; operatör dosyayı elle bölmek zorunda kalır ve hangi büyüklüğün geçtiğini deneyerek bulur.

**Öneri (2. tur).** İki yön var, biri seçilmeli: **(a)** global parser'ı `type`/path bazlı ayır (`app.use(express.json({ limit:"1mb", type: (req)=> !req.path.startsWith("/api/import") && !req.path.startsWith("/api/config-bundle") }))`) ve router'ları kendi parser'larıyla bırak; **(b)** router'ları `app.use(express.json(...))` satırından **ÖNCE** mount et. (b) daha az yan etkilidir ama `app.ts`'teki sıra yorumu (morgan/latency ilişkisi, F-CORE-OPS-003) korunmalı. Ayrıca 413 mesajı sabit "1MB" yerine etkin limiti basmalı. Migration/veri dokunuşu YOK.

**Kabul kriteri.** HTTP seviyeli bekçi: 1,5 MB gövdeyle `POST /api/import/customer/preview` **200**, aynı gövdeyle `POST /api/orders` **413**. (Bugünkü `scripts/test_import_permissions.ts` yalnız küçük gövde gönderiyor → bu sınıf bekçisiz.)
**Efor:** 0,5 gün.
**Önceki defter.** Yok. K1a HOTSPOT H1 aynı gözlemi ölçmüş; bu satır onu bağımsız repro ile doğruluyor.

---

### [D-F-02] Statü taşıyan http-errors 500'e düşüyor: bozuk `%` dizisi olan HER `/:id` yolu 500 + sahte `SYSTEM/ERROR` audit üretir

| Şiddet | S2 | Kategori | F (hata sınıflandırması) + I | Öncelik | P2 | Modül | CORE | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `errorHandler` `err.status` / `err.statusCode` alanını **yalnız `SyntaxError` için** okuyor (`:280`). Express/router/body-parser/serve-static ekosisteminin ürettiği statülü hatalar (`URIError status=400` param decode, `UnsupportedMediaTypeError status=415` charset, `res.sendFile` 404/403, `express.static` ≥500) `AppError` de Prisma hatası da olmadığı için **dal 9**'a düşüyor: HTTP **500** + "Sunucu hatası oluştu." + `SystemLog` `SYSTEM/ERROR` satırı. Yani istemcinin düzeltebileceği bir girdi hatası sunucu arızası gibi raporlanıyor ve gözlemlenebilirlik defterine gerçek olmayan bir arıza yazılıyor.

**Kanıt**
- `Teks-Erp/src/middlewares/error.middleware.ts:280` — `if (err instanceof SyntaxError && "status" in err && err.status === 400)` — statü okuması SADECE burada.
- `:610-633` — dal 9: `console.error("Unhandled Exception:")` + `AuditService.logEvent({category:"SYSTEM", action:"ERROR", recordId: err.name …})` + `res.status(500)`.
- `node_modules/router/lib/layer.js:218-233` — `decodeParam`: `catch (err) { if (err instanceof URIError) { err.message = "Failed to decode param '…'"; err.status = 400 } throw err }`.
- `node_modules/body-parser/lib/read.js:69-76` — `next(createError(415, 'unsupported charset "…"', { type: 'charset.unsupported' }))`.
- `node_modules/http-errors/index.js:92-96` — `err.status = err.statusCode = status` (statü nesnenin ÜZERİNDE, sınıf `URIError`/`UnsupportedMediaTypeError`).
- Etkilenen yüzey: `assertValidUuid` kullanan/kullanmayan AYRIMDAN BAĞIMSIZ — decode router katmanında, handler'dan ÖNCE koşar. K1b §4.4'teki uuid✗ kümesi (~95 uç) **ve** uuid✓ kümesi birlikte etkilenir.

**failure_mode.** `GET /api/rolls/%E0%A4%A` (barkod okuyucunun bozuk bir dizi ürettiği ya da bir istemci `encodeURIComponent` atladığı durum) → router `URIError{status:400}` fırlatır → errorHandler dal 9 → **HTTP 500 "Sunucu hatası oluştu."** + `system_logs`'a `category=SYSTEM, action=ERROR, recordId='URIError'` satırı. Mobil `stationRetry` 5xx'i geçici sanıp **3 kez** dener (`mobil/src/offline/mutations.ts:125-131`) → aynı sahte arıza 3 satır audit üretir. `/api/admin/health` "son hata" alanı gerçek olmayan bir olayı gösterir.

**Repro (K3).** `scratchpad/status-err-probe.mjs` — `errorHandler`'ın dal sırası birebir kopyalanmış izole Express 5 sunucusu (gerçek dosya DB'ye bağlandığı için import edilmedi):
```
Bozuk %-dizisi path param → HTTP 500 {"dal":9,"http":500,"message":"Sunucu hatası oluştu.",
   "_audit":{"recordId":"URIError"}, "_gercekStatu":400}
```
`_gercekStatu:400` = hatanın üzerinde duran ama okunmayan statü.

**Veride fiili ihlal (K2).** Arandı: prod kopyasında `system_logs` `category='SYSTEM' AND action='ERROR'` satırlarında `recordId IN ('URIError','UnsupportedMediaTypeError')` → **0**. Yani canlıda tetiklenmemiş (yalnız kaynak + izole repro).

**İş etkisi.** Doğrudan veri bozulması yok; bedeli **teşhis**: gerçek 500'lerin arasına sahte 500'ler karışır, `/api/admin/health` ve `SystemLog` "sunucu arızası" der, operatör "sunucu bozuldu" diye bildirir. Mobil retry 3× çarpanı ile gürültü büyür.

**Öneri (2. tur).** `errorHandler`'a `AppError` dalından hemen sonra genel bir statü dalı: `const s = (err as any).status ?? (err as any).statusCode; if (typeof s === "number" && s >= 400 && s < 500) → o statü + Türkçe mesaj + audit YOK`. `err.expose` alanına GÜVENME (http-errors 4xx'te `true` yapar ama İngilizce metin taşır — mesaj bizim tarafımızdan üretilmeli). Sıra load-bearing: `SyntaxError` dalı (400) ve `entity.too.large` (413) bu genel daldan ÖNCE kalmalı ki mevcut Türkçe metinler korunsun. Migration/izin YOK.

**Kabul kriteri.** Bekçi: gerçek sunucuya `GET /api/rolls/%E0%A4%A` → **400**, `system_logs` SYSTEM/ERROR satırı ARTMADI; `POST /api/orders` `Content-Type: application/json; charset=iso-8859-9` → **415**, audit satırı yok.
**Efor:** 0,5 gün.
**Önceki defter.** Yok (K6 HOTSPOT H-4 aynı sınıfı işaretlemiş, `[VARSAYIM]` etiketiyle; bu satır varsayımı repro ile kapatıyor).

---

### [D-F-03] `sanitizeWriteData` bir KOLON allowlist'idir, ANLAM allowlist'i değil — `mergedIntoId`/`deletedAt` istemciden yazılabilir, `{set:…}` operatörü ad bekçilerini atlar

| Şiddet | S2 | Kategori | F (mass-assignment) + E | Öncelik | P2 | Modül | TNM (tanımlar/master-data) | Kanıt seviyesi | **K1 + K2 (yüzey ölçüldü)** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `BaseController` yazma uçlarının mass-assignment koruması `BaseService.sanitizeWriteData` — modelin **tüm** scalar/enum kolonlarını (`*Fold` hariç, `id/createdAt/updatedAt` düşülür) geçirir. Bu ilişki-manipülasyonunu ve nested write'ı doğru şekilde kapatır, ama **anlamı olan** kolonları (soy bağı `mergedIntoId`, tombstone `deletedAt`) istemciye açar. Ayrıca allowlist yalnız ANAHTARA bakıp DEĞERİ olduğu gibi Prisma'ya verdiği için, Prisma'nın `{ set: … }` scalar operatörü uygulama katmanındaki iki bekçiyi (`normalizeDisplayName` büyük-harf standardı ve `assertNameNotDuplicate` mükerrer-ad guard'ı) **tip kontrolüyle** atlıyor.

**Kanıt**
- `Teks-Erp/src/services/base.service.ts:659-676` — `sanitizeWriteData`: `if (allowed.has(key) || nestedCreateFields?.includes(key)) out[key] = value;` — **değer şekli hiç incelenmiyor**.
- `:171-187` `sortableFieldsFor` — allowlist = `f.kind === "scalar" || f.kind === "enum"`, tek istisna `endsWith("Fold")`.
- Ölçüm (`scratchpad/dmmf-allowlist.mjs`, repo'nun kendi `@prisma/client` DMMF'i):
  `Customer: 23 alan · riskli: mergedIntoId, isActive, code, createdById, updatedById` — aynısı `Item`, `Color`; `PeripheralDevice: 35 alan · riskli: … deletedAt`.
- **(a) `mergedIntoId`:** `base.service.ts:1128-1151` `update()` yalnız *"tombstone + `isActive:true`"* birleşimini reddeder; `mergedIntoId`'nin KENDİSİNİ yazmayı/silmeyi engelleyen kod YOK. `grep -rn mergedIntoId src --include='*.ts'` → 14 dosya, hiçbirinde yazma-yasağı yok. `CustomerService.update` (`customer.service.ts:305-329`), `ColorService.update` (`color.service.ts:161-200`) yalnız `branches`/`customerIds` gibi nested alanları düşürüyor.
- **(b) `{set:…}` bypass'ı:** `base.service.ts:736` `assertNameNotDuplicate` → `if (typeof raw !== "string" …) return;` (sessiz atlama). `:1162-1168` `nameChanged` → `typeof data[dupField] === "string" && …` → false. `:691-703` `normalizeNameFields` → `if (typeof v === "string" …)`. Prisma tarafı ise kabul ediyor: `node_modules/.prisma/client/index.d.ts:149896` `name?: StringFieldUpdateOperationsInput | string`.
- `withActor` (`:59-70`) `createdById/updatedById`'yi **spread'in sağında** yazdığı için o iki kolon istemciden ezilemez → o ayak KAPALI (doğru yapılan).
- Karşı-örnek (aynı katmanda DOĞRU yapılmış): `OrderService.create/update` açık beyaz liste (`order.service.ts:42-49` `ORDER_HEADER_WRITABLE`, kullanım `:1870` ve `:2266`) — `status/shippedQty/orderNumber` istemciden yazılamıyor ve gerekçesi `:2262-2265`'te yazılı.

**failure_mode (üç tezahür).**
1. `PATCH /api/customers/<id>` gövde `{"mergedIntoId":"<başka müşteri id>"}` (izin: `customer:write`) → müşteri **tombstone** olur: `mergedIntoId IS NULL` süzgeci taşıyan tüm listelerden/aramalardan/mükerrer panelinden düşer, referansları taşınmaz, `MasterDataMergeService`'in audit'i yazılmaz. Ekranda "müşteri kayboldu", veride kayıt duruyor.
2. Aynı ucun tersi + iki adım: `PATCH {"mergedIntoId":null}` → sonra `PATCH {"isActive":true}` → **"birleştirme GERİ ALINAMAZ"** değişmezi (`base.service.ts:1140-1151` ve `:1085-1091`'daki iki kapının gerekçesi) atlanır; diriltilen kayıt referanssız boş bir kabuk olarak canlı listelere döner — kodun kendi yorumunun tarif ettiği zararın aynısı.
3. `PATCH /api/defect-types/<id>` gövde `{"name":{"set":"KİRLİ"}}` → `assertNameNotDuplicate` `typeof !== "string"` diye **sessizce atlanır**, `normalizeDisplayName` atlanır, Prisma değeri yazar. `defect_types`/`stations`/`machines`/`quality_grades`/`routes`/`product_recipes` tablolarında `nameFold` DB seddi **YOK** (sed yalnız `customers`/`items`/`subcontractors` + `colors` ifadesel) → **ikinci aktif "KİRLİ" hata tipi doğar**; tam da mükerrer panelinin temizlemek için yazıldığı sınıf.

**Veride fiili ihlal (K2).**
- Prod kopyası tombstone sayısı: `items 6 · colors 4 · subcontractors 3 · customers 0`. Bunlardan **3'ünün** (`items` 2, `colors` 1) `nameFold`'u survivor'dan FARKLI → o üçünde `mergedIntoId` temizlense partial UNIQUE **çarpmaz**, yani (2) numaralı diriltme yolu gerçek veride açık.
  ```sql
  SELECT t."nameFold" = s."nameFold", count(*) FROM items t JOIN items s ON s.id=t."mergedIntoId"
  WHERE t."mergedIntoId" IS NOT NULL GROUP BY 1;   -- f|2  t|4   (colors: f|1 t|3)
  ```
- Sedsiz tablolarda aktif mükerrer ad: `defect_types 0 · stations 0 · machines 0 · quality_grades 0` → **fiili ihlal YOK** (bugün).
- Büyük-harf normalizasyonu atlanmış görünen 4 satır arandı (`customers 1`, `defect_types 3`) — hepsinin `createdAt/updatedAt` 2026-07-16…20, yani `normalizeDisplayName` kuralından (2026-08-19) ÖNCE → **bypass'ın izi değil**, tarihsel kayıt.

**İş etkisi.** Tanım verisi (müşteri/kumaş/renk/hata tipi/istasyon) sessizce görünmez olabilir ya da mükerrerleşebilir; ikisi de sipariş↔iş emri eşleşmesine ve raporlara akar. Bugün fiili ihlal yok — bu bir **yüzey** bulgusudur, veri bulgusu değil.

**Öneri (2. tur).** `BaseServiceConfig`'e `systemFields: string[]` (varsayılan `["mergedIntoId","deletedAt"]`) ekleyip `sanitizeWriteData`'da düşür — `id/createdAt/updatedAt` ile aynı satırda, tek yer. Değer şekli için aynı fonksiyonda `if (value !== null && typeof value === "object" && !Array.isArray(value) && !nestedCreateFields.includes(key)) throw AppError.badRequest(...)` (nested create alanları hariç, `Decimal`/`Date` için `instanceof` istisnası). Boot bekçisi `assertBaseServiceGuards` (`:191-205`) genişletilip `systemFields`'ın DMMF'te GERÇEKTEN var olduğu doğrulanmalı (yazım hatası guard'ı sessizce boşa çıkarır). Migration YOK, izin YOK.

**Kabul kriteri.** Bekçi `test_mass_assignment_semantics.ts`: `PATCH /api/customers/:id {"mergedIntoId":"<id>"}` → 400 ve DB'de kolon değişmedi · `PATCH /api/defect-types/:id {"name":{"set":"X"}}` → 400 · mevcut normal PATCH'ler yeşil (regresyon). Negatif sonda: `systemFields` boşaltılınca ilk iki kontrol kırmızı olmalı.
**Efor:** 1 gün.
**Önceki defter.** `F-CORE-VER-007` (`base.service.ts:685` reactivate) reddedilmiş ve red geçerli — farklı konu, yeniden açılmıyor. KUNYE'deki *"Mass-assignment: `data: req.body` grep 0, `sanitizeWriteData` DMMF tabanlı"* satırı **kolon** düzeyinde doğrudur; bu bulgu **anlam** düzeyini ekler.

---

### [D-F-04] İçe aktarımın replay anahtarı EN SONDA yazılıyor — 15 sn'lik istemci zaman aşımından sonra "Tekrar Dene" dosyanın TAMAMINI ikinci kez yazar (sipariş adaptörü create-only)

| Şiddet | S1 | Kategori | F (toplu uç / uzun senkron iş) + B | Öncelik | P1 | Modül | ICE | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `ImportService.apply` idempotency'yi `ImportRun.clientToken @unique` üzerinden kuruyor, ama `importRun.create` çağrısı **tüm satırlar yazıldıktan SONRA** (`:552`). Replay guard'ı ise koşumun **başında** `findUnique` ile bakıyor (`:447`). Aradaki pencere = koşumun tüm süresi. Electron `apiClient` timeout'u **15 saniye** ve `ImportDialog` hata sonrası "Uygula" düğmesini yeniden açıyor, `attemptToken` ise yalnız diyalog kapanınca yenileniyor — yani kullanıcının en doğal davranışı (aynı token'la yeniden gönder) tam bu pencereye düşüyor. İçeride tekil bir "koşuyor" bayrağı da yok (yedek/DB-kopya yollarında olduğu gibi).

**Kanıt**
- `Teks-Erp/src/services/import/import.service.ts:447-472` — replay dalı: `const prior = await prisma.importRun.findUnique({ where: { clientToken } }); if (prior) return {…}`.
- `:505-544` — satır satır yazma döngüsü (`adapter.createOne` / `updateOne`, her biri kendi tx'i).
- `:552-576` — `const run = await prisma.importRun.create({ data: { id: runId, …, clientToken: options.clientToken ?? null, … } })` — **replay anahtarı burada doğuyor**.
- `prisma/schema.prisma:5339` — `clientToken String? @unique @db.Uuid`.
- `Teks-Erp/src/services/import/adapters/order.adapter.ts:284-318` — `createOne` → `orderService.create(payload, ctx.userId)`; `updateOne()` → `throw new Error("Sipariş içe aktarımı güncelleme yapmaz…")` çünkü `findExisting` boş döner → **her satır CREATE**. Payload'da `clientToken` YOK, yani `OrderService`'in kendi idempotency'si de devrede değil.
- İstemci: `Electron/src/services/apiClient.ts:44` `timeout: 15_000` (importService override etmiyor, `Electron/src/services/importService.ts:180-187`); `Electron/src/components/import/ImportDialog.tsx:342-372` — `catch` → `toast.error("İçe aktarım yapılamadı.")`, `finally { setBusy(null) }`; `:118` `attemptToken = useRef(crypto.randomUUID())`, `:160` yalnız `[open, entity]` değişince yenilenir.
- Ölçüm (dev `import_runs`): en hafif varlıkta (`color`) **4,3 ms/satır**. Sipariş satırı `OrderService.create`'in tamamını (kalem doğrulamaları, `assertValidCurrency`, `readOrderDefaultDeadlineDays`, `withBarcodeRetry`+`nextDailySeq`, iç içe `lines.create`, audit) koşar → mertebe olarak kat kat ağır.

**Çakışma senaryosu.**
```
T1  POST /api/import/order/apply  clientToken=K, 900 satır
    → importRun.findUnique(K) = null → satırları yazmaya başlar (SIP…0001 … )
T2  (15,0 sn) Electron axios ECONNABORTED → "İçe aktarım yapılamadı." toast
T3  Kullanıcı "Uygula"ya tekrar basar → AYNI token K
    → importRun.findUnique(K) = null  (T1 hâlâ döngüde, ImportRun yazılmadı)
    → dosyayı BAŞTAN yazar (SIP…0901 … )
T4  T1 biter → importRun.create(K) OK
T5  T2 biter → importRun.create(K) → P2002 → errorHandler dal 6a → HTTP 409
SONUÇ: 1.800 sipariş yazıldı, kullanıcı iki kez de HATA gördü; hangi 900'ün
       fazladan olduğunu söyleyen tek iz `importRunId` taşımayan audit satırları.
```

**failure_mode.** 900 satırlık sipariş dosyası → 15 sn'de istemci düşer → tekrar dene → **1.800 sipariş** (900'ü mükerrer, hepsi `APPROVED`, hepsi MRP/kapsama hesabına girer) + kullanıcıya "İçe aktarım yapılamadı." + 409 `"Bu 'clientToken' değeri zaten mevcut (unique constraint)"`. Aynı senaryo `customer`/`item` gibi upsert adaptörlerinde veri bozmaz (ikinci koşum UPDATE'e döner) ama koşum yine iki kez yazar ve süreyi ikiye katlar.

**Veride fiili ihlal (K2).** Prod kopyası `import_runs` **0 satır** → özellik sahada hiç kullanılmamış, fiili ihlal YOK. Dev'de 297 koşum, hepsi 1-2 satır (`max durationMs = 22`), pencere hiç açılmamış. Bu bulgu **ilk gerçek kullanımda** ısırır.

**İş etkisi.** Mükerrer sipariş = mükerrer talep = sahte kumaş açığı ve iki kez üretim planı; iptali elle, satır satır. D-F-01 ile birleşince ironik: bugün 1 MB tavanı satır sayısını düşürerek pencereyi de daraltıyor — D-F-01 düzeltilirse (10 MB açılırsa) **bu bulgunun olasılığı sıçrar**. İki bulgu birlikte planlanmalı.

**Öneri (2. tur).** Sıra: `ImportRun`'ı **koşumun BAŞINDA** `status="RUNNING"` ile yaz (id zaten önceden üretiliyor, `:477`), sonda `update` ile sonuçlandır. Replay guard'ı `RUNNING` gördüğünde **409 `IMPORT_IN_PROGRESS`** dönmeli (200 + "başarılı" DEĞİL — beceri §8: en pahalı hata belirsiz durumu `success` saymaktır). Süreç ölürse `RUNNING` satırı asılı kalır → boot uzlaştırması onu `INTERRUPTED`'a çevirsin (`db-copy.service.ts:161` `if (input.record.state === "running") return "interrupted"` emsali — aynı desen zaten repoda var). Ek olarak `order.adapter.createOne` satır başına deterministik bir `clientToken` üretsin (`${runId}:${rowNo}` UUIDv5 ya da `crypto.createHash`) → ikinci koşum `OrderService`'in kendi replay dalına düşer. Migration: `ImportRunStatus` enum'una `RUNNING`/`INTERRUPTED` eklenir → **`[PROD'DA ÇALIŞTIRMA]` değil ama `prod_risk: yüksek`**; geri alma yolu: enum değeri eklemek geri alınamaz, o yüzden `status` yerine yeni bir `startedAt`/`finishedAt` çifti + `finishedAt IS NULL` = koşuyor tercih edilirse migration daha ucuz ve geri dönüşsüz enum eklenmez — **tercih edilen budur**.

**Kabul kriteri.** Bekçi `test_import_idempotency.ts`: aynı `clientToken` ile İKİ eşzamanlı `apply` → biri 200, diğeri 409 `IMPORT_IN_PROGRESS`; DB'de hedef tabloda satır sayısı **tam bir koşum kadar** artmış. Negatif sonda: `ImportRun` yazımı sona alınınca test kırmızı olmalı.
**Efor:** 1,5 gün.
**Önceki defter.** Yok. K9 §H-2 *"import: token yalnız tamamlanmış koşum; `order.adapter` create-only → çift sipariş"* aynı gözlemi kaydetmiş; bu satır zamanlama penceresini ve istemci tarafını (15 sn timeout + token'ın yapışması) ölçerek tamamlıyor.

---

### [D-F-05] `quick-start` uyarı kanallarının HİÇBİRİ istemci tarafından okunmuyor — "rota kapsaması UYARI'ya indirildi" kararı fiilen ölü

| Şiddet | S2 | Kategori | F (yanıt sözleşmesi: 200 gövdesinde başarısızlık) | Öncelik | P2 | Modül | URT/WO | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `POST /api/work-orders/quick-start` iki uyarı kanalı taşıyor: (a) otomatik fason sevkinin düştüğünü söyleyen `dispatchWarning` — ayrı bir alan DEĞİL, `ApiResponse.message` metnine gömülü; (b) rota kapsaması uyarıları — `ApiResponse.warnings`. Servisin kendi yorumu (`workorder.service.ts:1459-1462`) bu ikincisi için *"tablet iş emrini açar ve 'rotada renk veren adım yok' notu yolda kaybolur — uyarıya çevirmenin TÜM ANLAMI o notun görünmesiydi"* diyor. Her iki istemci de `res.message`'ı ve `res.warnings`'i **hiç okumuyor**; kendi başarı metinlerini `data` alanlarından kuruyorlar. Yani 2026-08-27'de "reddetme, uyar" diye alınan kararın uyarı ayağı hiçbir ekrana ulaşmıyor.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:1395` `let dispatchWarning: string | null = null;` — üç yazma noktası `:1408`, `:1421`, `:1442`.
- `:1452-1463` — dönüş: `data: { workOrder, attached, errors, dispatch, batch }` (**`dispatchWarning` `data`'da YOK**), `message: … + (dispatchWarning ? \` ${dispatchWarning}\` : "")`, `...(createRes.warnings?.length ? { warnings: createRes.warnings } : {})`.
- Electron: `Electron/src/pages/Operations/Rolls/ReworkRollsDialog.tsx:201-214` — `onSuccess: (res) => { const d = res.data; const parts = […]; toast.success(\`${d.attached} top … alındı\`, { description: parts.join(" · ") }) }` — `res.message` ve `res.warnings` **okunmuyor**.
- Mobil: `mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts:742-772` — `onSuccess` yalnız `data.{workOrder,batch,attached,errors,dispatch,…}` okur; `res.message`/`res.warnings` yok.
- Genel bir yakalayıcı da yok: `grep -rn "res.warnings\|response.data.warnings" Electron/src mobil/src` → yalnız `ChangeTargetDialog.tsx:280` ve `LinkOrderDialog.tsx:84` (başka uçlar). `apiClient` interceptor'ında `warnings` işleme YOK.

**failure_mode (iki tezahür).**
1. **Tablet, Hızlı İş Emri.** Sipariş renk istiyor, seçilen rotada renk veren adım yok → backend `warnings: ["…rota hedef rengi uygulayacak bir adım içermiyor…"]` ile 200 döner → ekran yalnız "İş emri IE…0042 · Parti P07" başarı kartını basar → mal renksiz üretilir, sapma Tambur kapısında (409 `PLAN_MISMATCH`) günler sonra ortaya çıkar. Kabul edilen risk ("eksik rotayla iş emri açılabilir → uyarı metni NE eksik + SONUCU somut söyler") **karşılıksız kalmıştır**.
2. **Masaüstü, "Yeniden Üretime Al".** `dispatchFirstStep=true` gönderildi, `SubcontractorService.dispatch` bir istisna attı → `dispatchWarning` `message`'a gömüldü, `data.dispatch` `null` → toast **yeşil**: "12 top yeniden üretime alındı · İş emri IE…". Operatör fason çekisini arar, yoktur; mal `STOCK`ta bekler ve kimse fasona göndermez. CLAUDE.md 2026-08-25 notunun *"firma seçicisi LOAD-BEARING — yoksa 'Fasona gönder' sessiz no-op"* uyarısının ikinci yarısı burada tekrar açılıyor.

**Veride fiili ihlal (K2).** Aranmadı — uyarı metni hiçbir yere KAYDEDİLMİYOR (audit'e de düşmüyor), dolayısıyla "kaç kez uyarı üretildi" sorusunun veri karşılığı yok. Bu, bulgunun kendisinin bir parçası: kanal ne istemcide ne defterde.

**İş etkisi.** Renk/rota planı eksik iş emirleri sessizce açılır (Tambur kapısında yakalanır — yani hata operatöre en pahalı anda ulaşır); otomatik fason sevki düşünce mal görünmez biçimde bekler.

**Öneri (2. tur).** ① `dispatchWarning`'i `message` metninden çıkarıp `data.dispatchWarning` alanına taşı (metne gömülü uyarı bir sözleşme değildir, istemci onu ayrıştıramaz). ② Electron `apiClient` + mobil `api` katmanına **tek noktadan** `warnings`/`data.dispatchWarning` → `toast.warning` köprüsü koy (ChangeTargetDialog'daki `for (const w of res.warnings) toast.warning(w)` deseni zaten var, genelleştirilecek). ③ Backend'e mekanik bekçi: `ApiResponse.warnings` döndüren her uç için istemcide bir okuyucu olduğunu doğrulayan AST/grep bekçisi — "üretilen ama tüketilmeyen uyarı kanalı" sınıfını kalıcı kapatır. Migration/izin YOK; Electron+APK gerekir.

**Kabul kriteri.** Rotasında renk veren adım olmayan bir şablonla tablet üzerinden iş emri açıldığında ekranda sarı uyarı görünür; `dispatchFirstStep=true` + firma çözülemeyen kurulumda masaüstü toast'ı **uyarı** rengiyle ve "fasona gönderilemedi" metniyle çıkar. Bekçi: `useQuickWorkOrder.test` + `ReworkRollsDialog.test` — `warnings` içeren sahte yanıtta `toast.warning` çağrıldı.
**Efor:** 1 gün.
**Önceki defter.** Yok. K6 §5'in *"200 gövdesinde başarısızlık sözleşmeleri — istemcide doğrulanmalı"* satırının bu ayağı ölçüldü ve KIRIK çıktı.

---

### [D-F-06] Tekil etiket snapshot ucu 200 `{seeded:false}` dönüyor, mobil istemci yalnız `catch`'e bakıyor → "Kime basıldı" niyeti sessizce kayboluyor

| Şiddet | S2 | Kategori | F (yanıt sözleşmesi) + I | Öncelik | P2 | Modül | BLG (etiket) | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `POST /api/labels/rolls/:id/seed-snapshot` etiket verisi çözülemezse **fırlatmaz**: `console.error` + `200 { success:true, data:{ seeded:false } }`. Mobil `LabelPrinter` bu çağrıyı `labelService.seedSnapshot(...).catch(...)` ile yapıyor — yani yalnız **atılan** hatayı görüyor, 200 gövdesindeki `seeded:false` bayrağını hiç okumuyor. Aynı ekibin **toplu** yolu (`seed-snapshot-bulk`) `failed[]`'i örnek biçimde okuyup toast basıyor; tekil yol o disiplinden düşmüş.

**Kanıt**
- `Teks-Erp/src/services/label.service.ts:1975-1982`:
  ```ts
  try { labelData = (await this.getRollLabel(rollId, opts)).data; }
  catch (e) {
    console.error("[label] seedRollLabelSnapshot çözümü başarısız:", e);
    return { success: true, data: { seeded: false } };   // ← 200
  }
  ```
- Tekil istemci: `mobil/src/components/LabelPrinter.tsx:142-144` — `labelService.seedSnapshot(jobRoll.id, jobContext).catch((e) => console.warn(…))`; dönen gövde hiç incelenmiyor.
- Toplu istemci (doğru desen, karşılaştırma için): `mobil/src/screens/Modules/Tambur/TamburScreen.tsx:6313-6330` — `const { seeded, failed } = res.data; if (failed.length) Toast.show({type:'error', text1:\`${failed.length} top atlandı\`, …})` + yorum *"ATLANANLAR YUTULMAZ"*.
- Yazılamayan alanlar: `label.service.ts:1989-1998` — `lastLabelSnapshot` ve onun **sorgulanabilir aynası** `labelCustomerId` aynı `update`te yazılıyor; `seeded:false` dalında ikisi de yazılmıyor.

**failure_mode.** Operatör Tambur/KK1'de topu basarken "Kime? → Müşteri X" seçer. `getRollLabel` çözülemez (şablon silinmiş/pasif → fail-closed 400; koşullu eleman kalitesiz topta; eksik `LabelKind` eşlemesi) → uç **200 `{seeded:false}`** → `.catch` tetiklenmez → operatör normal bir etiket basmış gibi devam eder. Sonuç: `Roll.lastLabelSnapshot = null`, `Roll.labelCustomerId = null` → *"bu top hangi müşteri için basıldı"* filtresi topu HİÇ göstermez, yeniden baskıda varsayılan müşteriye döner ve müşteri irsaliyesi kolonu boş kalır. Hiçbir ekranda, hiçbir defterde iz yok (yalnız sunucu konsolu).

**Veride fiili ihlal (K2).** Arandı: prod kopyasında `rolls` içinde `"lastLabelSnapshot" IS NULL AND "labelPrintedAt" IS NOT NULL` (basılmış ama snapshot'sız) kombinasyonu bu bulgunun izidir; sorgu bu turda **koşulmadı** (kolon adları 5 eksik migration'a bağlı olabilir) → *"aranmadı — 2. turda ölçülmeli"* olarak bırakıldı.

**İş etkisi.** Müşteri bazlı etiket/irsaliye izlenebilirliği tek tek toplarda sessizce kopar; sahada fark edilmesinin tek yolu müşterinin "etikette bizim adımız yok" demesidir.

**Öneri (2. tur).** İki seçenek, biri seçilmeli: **(a)** uç `seeded:false` yerine **hata fırlatsın** (baskı akışı zaten `.catch` ile korunuyor; `LabelPrinter` yorumu "baskı başarısı snapshot'ı KOŞULLAMAZ" diyor — tersi de doğru olmalı: snapshot başarısızlığı baskıyı durdurmaz ama GÖRÜNÜR olmalı), ya da **(b)** istemci `res.data.seeded === false` durumunda uyarı toast'ı bassın. (a) sunucu tarafında tek dokunuş ve tüm istemcileri birden kapsar; sözleşme değişikliği olduğu için APK ile birlikte gitmeli. Her iki durumda uç `SystemLog`'a bir `LABEL_SNAPSHOT_FAILED` olayı yazmalı — bugün tek iz `console.error`.

**Kabul kriteri.** Şablonu silinmiş bir toptaki tekil baskıda tablette "Etiket bilgisi kaydedilemedi" uyarısı görünür; `system_logs`'ta olay satırı vardır. Bekçi: `test_label_seed_snapshot.ts` — çözülemeyen etikette uç 4xx/olay üretir; `LabelPrinter.test` sahte `{seeded:false}` yanıtında uyarı basar.
**Efor:** 0,5 gün.
**Önceki defter.** Yok. K6 HOTSPOT H-5 aynı satırı işaretlemiş ve *"istemcinin `seeded`'ı okuduğu doğrulanmalı"* demişti — doğrulandı: **okumuyor**.

---

### [D-F-07] `PUT /api/admin/settings/:key` anahtar allowlist'i ve tip/aralık doğrulaması olmadan yazıyor — ekranda görünen değer ile sistemin KULLANDIĞI değer sessizce ayrışır

| Şiddet | S2 | Kategori | F (doğrulamasız yazma ucu) | Öncelik | P2 | Modül | CORE | Kanıt seviyesi | **K1 + K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Uç, `value` için tek kısıt olarak `z.string().max(2000)` uyguluyor; `:key` için **allowlist yok** (yalnız 3 yapılandırılmış JSON anahtarı reddediliyor). Aynı ayarları yazan kardeş uç `PATCH /api/feature-flags` ise `z.strictObject` içinde tip + aralık zorluyor (`z.boolean()`, `1..43200`, `0..23` vb.). Okuyucu katman fail-safe: geçersiz değer **sessizce varsayılana** düşüyor. Yani yazma "Ayar güncellendi" der, liste ekranı yazılan metni gösterir, sistem başka bir değer kullanır — ve ikisinin ayrıştığını söyleyen hiçbir yüzey yoktur.

**Kanıt**
- `Teks-Erp/src/routes/admin.routes.ts:1081-1084` — `const settingUpsertSchema = z.object({ value: z.string().max(2000), description: z.string().max(500).optional() });`
- `:1087-1092` — reddedilen tek küme: `STRUCTURED_SETTING_KEYS = { TRAVELER_CARD_CONFIG, DOCUMENTS_CONFIG, AUTH_LOGIN_METHODS }`.
- `:1144-1168` — handler: `:key` üzerinde başka kontrol yok → `systemSettingService.set(key, value, …)`.
- `Teks-Erp/src/services/system-setting.service.ts:1032-1069` — `set()` düz `upsert`, doğrulama yok.
- Fail-safe okuyucular (örnek): `:39-46` `asNumber` (parse edilemezse `null`), `:2890-2904` `readPositiveIntSetting` → fallback, `:2954-2985` `readSessionDurationMinutes` → clamp+fallback, `:2087-2099` `readShippingToleranceMeters` → **üst sınır YOK**, geçersizse 5.
- **Boolean tuzağı:** `:48-52` `asBoolean` → `if (typeof value === "string") return value === "true";` — düz metin yazan bu uç ile birleşince `"1"`, `"TRUE"`, `"evet"`, `"True"` hepsi **`false`**.
- Kardeş uç: `Teks-Erp/src/routes/feature-flag.routes.ts:94+` `export const updateSchema = z.strictObject({ … kk1DuplicateGuardEnabled: z.boolean().optional(), … })`.

**failure_mode (iki tezahür).**
1. **Boolean sessizce kapanır.** Yönetici genel Ayarlar ekranından / API'den `PUT /api/admin/settings/kk1.duplicateGuardEnabled` gövde `{"value":"1"}` → 200 "Ayar güncellendi" → `GET /api/admin/settings` satırı `"1"` gösterir → `asBoolean("1") = false` → **KK1 mükerrer top tuzağı kapanır**, `POSSIBLE_DUPLICATE` 409'u bir daha hiç çıkmaz. Ekran "açık gibi" bir değer gösterirken koruma kapalıdır. (Aynı yol `device.pairingRequired`, `kk1.onlineOnlyEnabled`, `shipping.confirmationEnabled` için de açık.)
2. **Sayısal ayar sessizce yok sayılır.** `PUT shipping.toleranceMeters` gövde `{"value":"10 m"}` → `parseFloat("10 m") = 10` (kabul, doğru); ama `{"value":"on"}` → `NaN` → **5**'e döner. Ekranda "on", sistemde 5. Bu kolonun **üst sınırı da yok**: `{"value":"999999"}` → sevk toleransı 999.999 m olur, aşım kontrolü fiilen kapanır.

**Veride fiili ihlal (K2).** Prod kopyası `system_settings` (34 satır) tip dağılımı ölçüldü — **iki satır sayısal ama STRING olarak saklanmış**, yani bu jenerik yol canlıda GERÇEKTEN kullanılıyor:
```
order.defaultDeadlineDays            | string | "365"
workorder.defaultPlanDurationDays    | string | "365"
(diğer tüm sayısal ayarlar: number — auth.sessionDurationMinutes|number|480, label.copies|number|2 …)
```
Sorgu: `SELECT key, jsonb_typeof(value::jsonb), left(value::text,40) FROM system_settings ORDER BY key;` (sql-saha). İki satırın `asNumber` ile doğru okunduğu doğrulandı (zarar YOK) — ihlal olan şey **yazma kapısının açıklığı**, bugünkü veri değil.
Bugünkü istemci yüzeyi dar: `Electron/src/services/systemSettingService.ts:13-17` yalnız üç anahtarı sabitliyor (`SHIPPING_TOLERANCE_METERS`, `ORDER_DEFAULT_DEADLINE_DAYS`, `WORKORDER_DEFAULT_PLAN_DURATION_DAYS`) — yani bugün riski taşıyan şey UI değil, ucun kendisi (aynı `admin:settings` izniyle her anahtar yazılabilir).

**İş etkisi.** `admin:settings` taşıyan 4 kullanıcı, hiçbir hata almadan, KK1 mükerrer tuzağını / cihaz eşleştirmesini / sevk toleransını fark edilmeyecek biçimde değiştirebilir. Bu ayarların çoğu CLAUDE.md'de **"ACİL KAPATMA anahtarı"** olarak işaretli — yani yanlış yazıldığında kimsenin fark etmemesi tam olarak istenmeyen şey.

**Öneri (2. tur).** `:key`'i `SETTING_KEYS` kataloğuna karşı doğrula (bilinmeyen anahtar → 400) ve anahtar başına beklenen tipi bir tabloya bağla (`"boolean" | "number" | "string"` + aralık) — kaynak `system-setting.service.ts`'teki reader'ların kendisi olmalı, ikinci bir liste tutulmamalı. `feature-flag` şemasında zaten yönetilen anahtarlar bu uçtan **reddedilmeli** ("kendi ekranından güncelleyin" — bugün yalnız 3 JSON anahtarı için var olan davranışın genişletilmişi). Ayrıca `readShippingToleranceMeters`'a üst sınır. Migration YOK, izin YOK.

**Kabul kriteri.** `PUT /api/admin/settings/kk1.duplicateGuardEnabled {"value":"1"}` → **400**; `PUT …/bilinmeyen.anahtar` → 400; `PUT …/order.defaultDeadlineDays {"value":"365"}` → 200 (regresyon). Bekçi `test_setting_upsert_contract.ts` + negatif sonda (allowlist kaldırılınca kırmızı).
**Efor:** 1 gün.
**Önceki defter.** Yok. K1a HOTSPOT H3 aynı ucu işaretlemiş ve *"okuyucuların biçimsiz değere davranışı doğrulanmalı"* demişti — doğrulandı: **fail-safe ama sessiz**, ki bulgunun asıl çekirdeği bu.

---

### [D-F-08] `DELETE /api/rolls/:id` sözleşmesi query string'de ve Zod'suz: sebep sessizce 500 karaktere kırpılıyor, alt sınır yok, ölü parametre sözleşmede duruyor — kardeş `POST /:id/scrap` ile iki farklı kural

| Şiddet | S3 | Kategori | F (doğrulamasız yazma ucu) | Öncelik | P3 | Modül | ENV (envanter) | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Aynı motoru (`InventoryService.softDelete`) çağıran iki yıkıcı uçtan biri gövdeli + Zod'lu, diğeri query'li + Zod'suz. Zod'lu olan `reason`'ı `min(3).max(500)` ile zorluyor ve aşımda net 400 veriyor; query'li olan hiçbir sınır uygulamıyor, sebep servis içinde `.slice(0, 500)` ile **sessizce** kırpılıyor ve `reasonCode` controller'da `.slice(0, 64)` ile kesiliyor. Ayrıca sözleşmede `confirmLabelPrinted` adında, kabul edilen ama hiçbir kapı açmayan ölü bir parametre duruyor.

**Kanıt**
- `Teks-Erp/src/routes/inventory.routes.ts:572` — `router.delete("/:id", verifyToken, requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL), controller.softDelete);` (Zod yok).
- `Teks-Erp/src/controllers/inventory.controller.ts:562-587` — `req.query.confirmActive === "true"` · `req.query.confirmLabelPrinted === "true"` · `typeof req.query.reason === "string" ? … : undefined` · `req.query.reasonCode … .trim().slice(0, 64)`.
- `Teks-Erp/src/services/inventory.service.ts:3153-3155` — `cancelReasonText = resolvedReason.text ? resolvedReason.text.slice(0, 500) : null;` (sessiz kırpma).
- `:3156-3173` — ölü parametre gerekçesi + `void opts?.confirmLabelPrinted;`.
- Kardeş uç: `inventory.controller.ts:600-617` `scrapRollSchema.parse(req.body ?? {})`; şema `:142` `reason: z.string().trim().min(3, "İşlem nedeni en az 3 karakter olmalı").max(500).optional()`.

**failure_mode.** ① Operatör 600 karakterlik bir iptal notu yazar → uç 200 döner, defterde **son 100 karakter yoktur** ve kimse söylemez; aynı metin `POST /:id/scrap`'ta 400 alır. ② Operatör sebep alanına "ok" yazar → `DELETE` kabul eder (alt sınır yok), `scrap` reddeder → aynı fabrikada iki farklı "geçerli sebep" tanımı. ③ Yeni bir istemci sözleşmeye bakıp `confirmLabelPrinted` gönderir ve bunun bir onay kapısı olduğunu sanır — hiçbir şey yapmaz.

**Veride fiili ihlal (K2).** Arandı: 500 karakterde tam biten `cancelReasonText` satırı prod kopyasında sorgulanabilir (`length(...) = 500`) ama **koşulmadı** — kolon 5 eksik migration'dan birine ait olabilir. *"2. turda ölç."*

**İş etkisi.** İptal defteri (230 iptal / 1 fire ölçümüyle fabrikanın en çok kullandığı yıkıcı yol) kısmen eksik metin taşıyabilir; kural asimetrisi eğitim/dokümantasyonu zorlaştırır.

**Öneri (2. tur).** `DELETE /:id` için bir Zod query şeması (`z.object({ confirmActive: z.enum(["true","false"]).optional(), reason: z.string().trim().min(3).max(500).optional(), reasonCode: z.string().trim().max(64).optional() })`) — kırpma yerine 400. `confirmLabelPrinted` şemada `.optional()` olarak KABUL edilmeye devam etsin (sahadaki APK'lar gönderiyor, kırmak yasak) ama Swagger'dan **kaldırılsın**. Servis içindeki `.slice(0,500)` savunma katmanı olarak KALSIN (dahili çağıranlar var). Migration/izin YOK.

**Kabul kriteri.** `DELETE /api/rolls/<id>?reason=ab` → 400 ("en az 3 karakter"); `?reason=<501 karakter>` → 400; eski APK'nın `confirmLabelPrinted=true` gönderen isteği → hâlâ 200.
**Efor:** 0,25 gün.
**Önceki defter.** Yok (K1a HOTSPOT H5).

---

### [D-F-09] Toplu yazma şemalarında dizi TAVANI eksik — ekibin sevkiyat için kapattığı asimetri altı uçta açık duruyor

| Şiddet | S3 | Kategori | F (toplu uç sözleşmesi) + H | Öncelik | P3 | Modül | KRT/PRT/TNM | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `createShipmentSchema` üzerindeki yorum (`shipping.controller.ts:60-67`) bu sınıfı ekibin kendi diliyle tarif ediyor: *"önizleme zaten 500'de sınırlıydı, YAZAN yol sınırsızdı: `express.json({limit:"1mb"})` ≈ **26.000 UUID** geçirir ve … hepsi TEK transaction'da, yani bir havuz bağlantısını 20 sn Prisma tavanına kadar tutar. Uygulamanın en uzun tx'i buydu; asimetri kapatıldı."* Aynı asimetri başka altı yazma ucunda **kapatılmamış**.

**Kanıt (tavansız `z.array(...)`, yazma uçları)**

| Uç | Şema satırı | Tx içi maliyet |
|---|---|---|
| `POST /api/kartela/dispatch` | `controllers/kartela.controller.ts:12` `rollIds: z.array(uuid).min(1)` | top başına claim + sevk kalemi |
| `POST /api/kartela/receive` | `:32-45` `returns: z.array({… count ≤ 1000 …}).min(1)` | `count` × satır kadar `Swatch` (`kartela.service.ts:687` `createMany`) |
| `POST /api/batches/move` | `controllers/batch.controller.ts:19` `rollIds` | `findMany` + `updateMany(IN …)` + kaynak-parti döngüsü |
| `POST /api/batches/merge` | `:23` `batchIds: z.array(uuid).min(2)` | parti başına cerrahi + soy bağı claim |
| `POST /api/batches/split` | `:26` `rollIds` | aynı |
| `PUT /api/station-capabilities/…` | `routes/station-capability.routes.ts:22,27` | `deleteMany(notIn)` + `createMany` |
| `POST /api/label-templates/import` | `controllers/label-template.controller.ts:130` `variants` | varyant başına `create` (`label-template.service.ts:669-670` döngü) |
| `PATCH /api/reason-presets/reorder` | `routes/reason-preset.routes.ts:57` `ids` | **korunuyor** — servis (`reason-preset.service.ts:498-505`) `ids.length !== known.size` ile REDDEDİYOR → tavan tablo boyutu; bulgu DEĞİL, doğru desen |

Karşılaştırma (tavanlı, doğru): `shipping.controller.ts:55,68` `.max(500)` · `subcontractor.controller.ts:33,47` `.max(500)` + `:106-170` `returns/newRolls ≤300` · `tambur.controller.ts:29-46` `cuts ≤200` · `inventory.controller.ts` `stats-batch ≤12`.

**failure_mode.** `kartela:write` izni olan bir istemci (ya da bozuk bir toplu seçim) `POST /api/kartela/dispatch` gövdesinde 20.000 `rollId` gönderir (1 MB sınırının altında kalır) → servis hepsini tek transaction'da işler → **20 sn Prisma tx tavanı** aşılır → P2028 → rollback + `errorHandler` dal 6j → **503** ve o süre boyunca havuzun (max 30) bir bağlantısı tutulur. Vardiya başı yığılmada 5 tablet aynı anda benzer bir istek yollarsa havuz baskısı gerçek olur. Veri bozulmaz (rollback) — bedel **kullanılabilirlik** ve teşhis.

**Veride fiili ihlal (K2).** Gerçek kardinaliteler ölçüldü (prod kopyası) ve bugün tavanların çok altında:
`çuval/sevkiyat max 2 · top/çuval max 59 · kesim çocuk/parent max 64 · kalem/sipariş max 3 · top/parti max 86`. Yani bugün tetiklenmiş DEĞİL; risk sözleşmenin açıklığında.

**İş etkisi.** Bugün yok; yarın toplu bir ekran ("hepsini seç") eklendiğinde ya da bir istemci hatası döngüye girdiğinde sunucu kullanılamaz hale gelir ve sebebi log'da 503 olarak görünür.

**Öneri (2. tur).** Her toplu yazma şemasına `.max(N)` ekle; N'i **istemcinin gerçekten seçebileceği** üst sınırdan türet (kartela sevk 500, parti taşıma 500, merge 50, varyant 200 gibi) ve şema satırına gerekçeyi yaz (shipping'deki yorum örnek alınmalı). Mekanik bekçi: `scripts/test_array_caps.ts` — controller/route dosyalarında `z.array(` geçen her yazma şemasında `.max(` bulunmasını AST ile zorlar (aynı sınıfın bir daha açılmaması için; `reorder` gibi servis-korumalı istisnalar açık allowlist'te). Migration/izin YOK.

**Kabul kriteri.** Bekçi yeşil; 501 elemanlı `kartela/dispatch` isteği 400 alır ve mesaj sınırı söyler.
**Efor:** 0,5 gün.
**Önceki defter.** Yok (K3b sınır ötesi notu aynı listeyi çıkarmış).

---

### [D-F-10] Ham `err.message` 200 gövdesindeki operatör alanlarına akıyor — Prisma/pg metni Türkçe-mesaj kuralını deliyor

| Şiddet | S3 | Kategori | F (yanıt gövdesi) + G/I | Öncelik | P3 | Modül | ICE/FAS/WO | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Hata **yolu** temiz (aşağıda "Doğru yapılanlar"): hiçbir 4xx/5xx dalı yanıta `stack`/`meta`/`cause.detail` koymuyor, 5xx metinleri sabit. Ama **200 gövdesindeki** uyarı/başarısızlık alanlarına ham `err.message` konuyor — bu metin Prisma/pg kaynaklıdır ve kolon/kısıt adı, hatta `$queryRawUnsafe` yolunda SQL parçası taşıyabilir.

**Kanıt** (grep `instanceof Error ? (e|err|error)\.message` → 16 nokta; operatör yüzeyine ULAŞANLAR):
- `Teks-Erp/src/services/import/import.service.ts:539-541` → `rows[].errors[].message` → Electron içe aktarım sonuç tablosunda hücre olarak basılır.
- `Teks-Erp/src/services/workorder-link.service.ts:805` → `failed[].message` → `ChangeTargetDialog.tsx:253` `toast.warning(\`${f.barcode}: ${f.message}\`)`.
- `Teks-Erp/src/services/subcontractor.service.ts:3305-3307` → `postWarnings`.
- `Teks-Erp/src/services/workorder.service.ts:1444` → `message` (bkz. D-F-05: bugün hiçbir istemci basmıyor).
- `Teks-Erp/src/services/backup.service.ts:320,331,353` → `warnings[]` (yedek ekranı).
- `Teks-Erp/src/services/import/config-bundle.service.ts:305` → `row.message`.

**failure_mode.** İçe aktarımda bir satır FK ihlaline düşer → `rows[].errors[].message` = `Foreign key constraint violated on the constraint: 'order_lines_itemId_fkey'` → büro personeli ekranında İngilizce, tablo/kolon adı içeren teknik metin görür; "Validation hata mesajları Türkçe" kuralı (CLAUDE.md Ortak Konvansiyonlar) bu yüzeyde geçerli değil. Merge yolundaki `$executeRawUnsafe` bir hata atarsa metin SQL parçası taşıyabilir.

**Veride fiili ihlal (K2).** Aranmadı — bu metinler yanıt gövdesinde yaşıyor, DB'ye yazılmıyor (yalnız `import_runs.errorReport` JSON'una düşüyor; prod'da 0 satır).

**İş etkisi.** Operasyonel: operatör anlamadığı bir metinle karşılaşır ve destek çağırır. Güvenlik ayağı LAN + kimlikli kullanıcı olduğu için düşük; yine de şema iç yapısı sızıyor.

**Öneri (2. tur).** Servis katmanında tek bir `toOperatorMessage(err)` yardımcısı: `AppError` ise `.message`, Prisma bilinen kodu ise `error.middleware`'in mevcut Türkçe haritasından türetilmiş metin, aksi halde sabit "Kayıt yazılamadı (teknik ayrıntı sunucu kaydında)". Ham metin `SystemLog`'a gitsin (bugün gitmiyor). Migration/izin YOK.

**Kabul kriteri.** Bekçi: sahte P2003 ile bir içe aktarım satırı hazırlanır; `rows[].errors[].message` içinde `constraint`/`prisma`/`_fkey` geçmez, `system_logs`'ta ham metin vardır.
**Efor:** 0,5 gün.
**Önceki defter.** Yok (K6 HOTSPOT H-17; oradan G/I'ya da yönlendirilmiş — bu satır API sözleşmesi ayağını kapsıyor).

---

### [D-F-11] Döngü içi ORM çağrıları: 67 nokta, hepsi tavana bağlı — en kötü 5, bugün ölçülen kardinalitelerle

| Şiddet | S3 | Kategori | F (N+1) | Öncelik | P4 | Modül | çapraz | Kanıt seviyesi | **K2 (kardinalite ölçüldü)** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Klasik "liste + satır başına sorgu" N+1 **yok**: 67 döngü-içi ORM noktasının neredeyse tamamı tx içindeki **atomik claim**'ler ve durum-grubu başına `updateMany`'ler — beceri §3.2'ye göre doğru desen, bulgu değil. Bulgu, birkaç yerde döngünün tek-tek round-trip yapması ve tavanın Zod'dan (200-500) gelmesi: bugünkü gerçek kardinaliteler küçük olduğu için ölçülebilir etki düşük, ama tavan ile gerçek arasındaki fark 3-8 kat.

**En kötü 5 (ölçümle)**

| # | Yer | Döngü × sorgu | Tavan | Prod'da ölçülen gerçek | Not |
|---|---|---|---|---|---|
| 1 | `services/tambur.service.ts:1041-1043` | segment başına `tx.roll.create` (+ her birinde barkod sayacı) | `tambur.controller.ts:29-46` `cuts ≤ 200` | `kesim çocuk/parent max` = **64** | Tek tx; barkod sayacı sistem geneli serileşme noktası (`roll-barcode.helper.ts:82`) — 200 kesimde kilit 200 tur tutulur |
| 2 | `services/shipping.service.ts:1412-1419` ve `:1551-1556` | çuval başına `tx.sack.updateMany` claim | `.max(500)` (yorumla gerekçeli) | `çuval/sevkiyat max` = **2** | Doğru claim deseni; maliyet yalnız round-trip sayısı |
| 3 | `services/helpers/roll-disposition.helper.ts:297-299` | barkodsuz top başına `tx.roll.update` + barkod üretimi | WO kapanış dispozisyon kümesi (tavansız) | `top/parti max` = **86** | Her tur sayaç round-trip'i; kapanışta 86 top → 172 tur |
| 4 | `services/helpers/roll-finalize.helper.ts:179-189` | top başına `tx.roll.update` | adımdaki canlı top sayısı | aynı (86) | `updateMany` ile gruplanabilir alanlar var |
| 5 | `services/latency-persist.service.ts:122-155` | route anahtarı başına `findUnique` + `update`/`create` | flush penceresindeki farklı route sayısı | prod'da **gün başına 102-129 route anahtarı** (`endpoint_latency_daily`) | İstek yolundan AYRI (`setImmediate`) — kullanıcı gecikmesi yok; tek `upsert` round-trip'i yarıya indirir |

**failure_mode.** Tambur'da 200 parçalık bir kesim: 200 ardışık `roll.create` + 200 barkod sayacı turu tek transaction'da → LAN'da ~2-4 ms/tur ile 0,8-1,6 sn kilit tutma; aynı anda KK1'den ham giriş yapan tablet barkod sayacında **kuyruğa girer** (sayaç sistem geneli serileşme noktasıdır). Bugün en büyük kesim 64 olduğu için ölçülebilir değil.

**Veride fiili ihlal (K2).** Yukarıdaki tabloda; ayrıca dev `import_runs` en hafif varlıkta 4,3 ms/satır.

**İş etkisi.** Bugün yok. Tavan yaklaşıldığında vardiya başı yığılmada barkod sayacı gecikmesi olarak hissedilir.

**Öneri (2. tur).** #3/#4 için alan gruplarına göre `updateMany`; #5 için `upsert` (tek round-trip; `inFlush` bayrağı yarışı zaten kapatıyor). #1'de barkodları **döngüden ÖNCE toplu** ayır (sayaç bir kez artırılır) — bu ayrıca kilit süresini N turdan 1 tura indirir. Bunlar performans işi, veri dokunuşu yok.

**Kabul kriteri.** 200 kesimlik bir finalize'da barkod sayacı advisory kilidinin tutulma süresi ölçülür ve tek-tur seviyesine iner.
**Efor:** 1 gün.
**Önceki defter.** Yok.

---

### [D-F-12] `Retry-After` gönderiliyor ama CORS `exposedHeaders` listesinde yok — başlık renderer'a görünmez (belgeli, bugün zararsız)

| Şiddet | S4 | Kategori | F (yanıt başlığı sözleşmesi) | Öncelik | P5 | Modül | CORE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 503 yolunda `Retry-After: 3` yazılıyor ama `app.ts:114`'teki `exposedHeaders` listesinde olmadığı için tarayıcı/Electron renderer'ı JS'ten okuyamıyor; zaten hiçbir istemci okumuyor. Durum **koda yazılmış** (`error.middleware.ts:228-238`) ve bilinçli. Bulgu değil, kayıt: `test_middleware_order.ts:118-122` listeyi dondurduğu için bir gün bir istemci uyacaksa **iki yer + bekçi birlikte** değişmeli.

**Kanıt.** `app.ts:114` (`["X-Label-Language","X-Label-Kind","X-Label-Count","X-Label-Template-Id","X-Label-Variant-Match","Date"]`) · `error.middleware.ts:238-241` · istemciler: `Electron/src/App.tsx:21-27` (5xx'te tek retry, header'a bakmaz), `mobil/src/offline/mutations.ts:125-131`.

**failure_mode.** Bugün yok. **İlişkili gerçek risk:** D-F-02'nin kardeşi olan K6 H-1 — DB `statement_timeout` (50 sn) 57014 hiçbir dalda tanınmadığı için 500 döner; mobil `stationRetry` 5xx'i 3 kez dener → 3 × 50 sn. Orada `Retry-After`'a uyan bir istemci gerçekten işe yarardı.
**Öneri.** Ya listeye ekle ve bir istemci uyacak biçimde bağla, ya da başlığı kaldırıp yorumu güncelle — bugünkü hali "yazılmış ama okunamayan" bir sözleşme.
**Efor:** 0,1 gün. **Önceki defter:** yok (K6 H-13).

---

## Uygulanan kontrol listesi (prompt Bölüm 3-F, satır 574-598 + göreve özel 11 madde)

| Madde | Durum |
|---|---|
| Express sürümü / async handler hata akışı; sarmalayıcı var mı | **uygulandı** — Express 5.2.1; `node_modules/router/lib/layer.js:150-166` promise bağlama kaynaktan okundu; `express-async-errors|asyncHandler|catchAsync` **0** kullanım; sarmalayıcı GEREKMİYOR. Try'sız 8 handler (`mobile-update.routes.ts:44,69,97`, `app.ts:479,566`, `auth.controller.ts:86,189,268`) yerli yola dayanıyor ve doğru çalışıyor. Bulgu YOK — "Doğru yapılanlar"a yazıldı. |
| Global error handler; gövdede stack/SQL sızıntısı | **uygulandı** — 4-arity handler `error.middleware.ts:243`; yanıtta `stack/meta/sql` grep **0**; 5xx metinleri sabit. Hata yolu temiz → **D-F-10** yalnız 200-gövdesi yüzeyini kapsıyor. Ek: **D-F-02** (statü taşıyan hatalar 500'e düşüyor). |
| Auth middleware kapsaması (K1 rota envanteri) | **kapsam dışı — G (güvenlik) denetçisinin alanı.** K1a §6 / K1b §3 kapısız uçları zaten listelemiş (`/api/mobile/updates/*` bilinçli public); bu turda yeniden türetilmedi. Yalnız `test_route_auth_coverage.ts`'in HEAD'de KIRMIZI olması sınır ötesi nota alındı. |
| Validation: zod tüm yazma uçlarında mı | **uygulandı** — K1a §7.1 (12) + K1b §4.1/4.2 listesi doğrulandı; her biri için "gövde nereye gidiyor / çalışma zamanı tip güvencesi ne / yanlış tip ne üretir" çözüldü: BaseController yolu → `sanitizeWriteData` (**D-F-03**), yanlış tip → `PrismaClientValidationError` → 400 (audit YOK, K6 H-3'ün konusu, I'ya ait). Ayrıca **D-F-07** (settings), **D-F-08** (rolls DELETE). |
| Mass assignment `data: req.body` / `...req.body` | **uygulandı** — grep **0** (KUNYE doğrulandı); asıl yüzey `sanitizeWriteData`'nın anlam katmanı → **D-F-03**. `Order` için açık beyaz liste var (doğru yapılan). |
| Sayfalama tutarlılığı: cursor + tie-breaker; offset yolları | **uygulandı** — tie-breaker `id` her iki cursor ailesinde VAR (`cursor.ts:57-62`, `:205-215`), nullable kolonda `nulls:'last'` ile hizalı; offset yalnız 2 yerde ve ikisinde de `MAX_OFFSET`/derinlik guard'ı var. **Bulgu yazılmadı.** |
| Bozuk cursor → ilk sayfa (K6 H-22) | **uygulandı, bulgu YAZILMADI** — bu **`F-CORE-API-004`** olarak 2026-08-09'da açılmış ve **reddedilmiş**; K12 satır 6 redin **GEÇERLİ** olduğunu yeniden ölçmüş (failure_mode üretilemiyor, fail-safe doğru tercih). Yeni kanıt bulamadım: `decodeOffsetCursor` (`cursor.ts:277-289`, yeni ilişki-sıralaması yolu) da aynı fail-safe sınıfında ve istemci `sortBy` değişiminde cursor'ı sıfırlıyor (`base.service.ts:522-523` yorumu). **Yeniden AÇILMADI.** |
| Dışa aktarım / senkron yollarında mükerrer-kayıp | **uygulandı** — `ImportService.exportRows` (`import.service.ts:686-707`) sayfalamasız (tümünü üretip keser) → mükerrer/kayıp riski YOK (tek sorgu), ama tavansız → **H'ye sınır ötesi not**. Muhasebe export'u K7b'nin alanı. |
| Toplu uçlar: kısmi başarı semantiği + retry | **uygulandı** — `failed[]` üreten 6 yol var ve **parçalılık YAZILI**; istemciler okuyor (`useKursunDistribution.ts:38`, `ChangeTargetDialog.tsx:253`, `TamburScreen.tsx:6321`, `ImportDialog.tsx:1032`). İki istisna bulgu oldu: **D-F-05** (uyarı kanalı okunmuyor), **D-F-06** (tekil seed). `reorder` hepsi-ya-hiç + fail-closed (doğru yapılan). Retry semantiği: **D-F-04**. |
| Timeout / retry backoff+jitter / circuit breaker | **kısmen — kapsam dışı payı var.** Sunucu tarafında dış entegrasyon yalnız yazıcı TCP (`printer-transport.ts`) ve child process (`pg_dump`/`rclone`, timeout'lu — K6 doğruladı). İstemci retry/jitter mobilde (`stationRetry`), circuit breaker YOK ve gerekmiyor (tek LAN bağımlılığı DB). Havuz/event-loop tüketimi **H**'nin alanı. |
| N+1 | **uygulandı** — kendi tarayıcım (`scratchpad/n1-scan.mjs`) 67 nokta; en kötü 5 ölçülen kardinalite ile **D-F-11**. |
| Uzun senkron iş + timeout sonrası mükerrer koşu | **uygulandı** — yedek (`backup.service.ts:199-221`, `running` bayrağı await'siz kontrol → atomik) ve DB kopya (`db-copy.service.ts:373-405`, açık atomik claim + `interrupted` uzlaştırma) **DOĞRU**; içe aktarım **KIRIK** → D-F-04; merge advisory kilitli (A'nın alanı); ağır rapor senkron ama HTTP tavanı istemci tarafında. |
| `res.json` commit'ten önce mi | **uygulandı, bulgu YOK** — `$transaction` route/controller katmanında **0**; servislerde `res.*` yalnız `guarded-hard-remove.ts` ve orada yanıt tx (`:74-76`) + audit (`:78-85`) SONRASINDA (`:87`). Bağımsız doğrulandı. |
| ~95 uuid✗ param → P2007/P2023 tutarlılığı | **uygulandı, bulgu YOK** — `error.middleware.ts:447-460` her ikisini de net Türkçe **400**'e eşliyor; `assertValidUuid` kullanan uçlarla **statü aynı**, yalnız mesaj daha genel. Tutarsızlık yok. ⚠️ Ama D-F-02: bozuk `%` dizisi bu yolun ÖNÜNDE, router katmanında 500 üretiyor. |
| 404/405 + hata gövdesinde sızıntı (prod dalı) | **uygulandı, bulgu YOK** — `/api` catch-all 404 (`app.ts:598-603`) `req.originalUrl`'i yansıtıyor ama `res.json` + `Content-Type: application/json` + helmet `nosniff` ile yürütülebilir değil (yansıtmalı XSS DEĞİL). 405 ayrı ele alınmıyor, tanımlı yol + yanlış metot 404'e düşüyor — REST'te kabul edilir. |
| Statü taşıyan http-errors → 500 (K6 H-4) | **uygulandı** → **D-F-02** (repro ile). |
| `PUT /api/admin/settings/:key` | **uygulandı** → **D-F-07**. |
| `DELETE /api/rolls/:id` query sözleşmesi | **uygulandı** → **D-F-08**. |
| `express.json` 1mb ↔ route-level 10mb | **uygulandı** → **D-F-01** (repro ile). |

---

## Doğru yapılanlar (korunmalı kalıplar)

1. **Express 5'in yerli promise yolu bilinçli seçilmiş ve doğrulanmış.** `express-async-errors`/`asyncHandler` yok; 8 handler bilerek `try`'sız yazılmış ve `node_modules/router/lib/layer.js:155-166` bunu yakalıyor. Ayrıca controller/route disiplini mekanik: `catch (` 330 ↔ `next(...)` 330 (controllers), 162 ↔ 162 (routes), catch içinde yanıt yazan **0** — ve `test_controller_binds.ts` çıplak handler'ın bind'lı olmasını zorluyor (prod'da yaşanmış `this` kaybı vakası). Sarmalayıcıya geçilecekse bu üç ölçümün üçü birden korunmalı.
2. **Yanıt commit'ten sonra — istisnasız.** `$transaction` yalnız servis katmanında (route/controller'da 0); tek `res` taşıyan yardımcı (`guarded-hard-remove.ts`) yanıtı tx **ve** audit'ten sonra yazıyor, üstelik `assertValidUuid` ile başlıyor. Bu, "yıkıcı uçta somut onay" kuralının teknik ayağı; yeni hard-delete eklenirken bu fabrika kullanılmalı.
3. **Cursor sayfalaması tie-breaker'lı ve nullable-farkında.** İki cursor ailesi de `id`'yi ikincil anahtar yapıyor (`cursor.ts:57-62`, `:205-215`), `sortNullable` yolunda `nulls:'last'` ile where/orderBy hizalı (`base.service.ts:580-590`), tip etiketi (`t: "s"|"n"|"d"|"b"`) tahmin yerine kesinlik veriyor ve `buildNextDynamicCursor` `id` seçilmemişse **fail-fast fırlatıyor**. Offset'e düşülen tek yolda (ilişki sıralaması) derinlik guard'ı 400 veriyor. Bu katman bu denetimde kusursuz çıktı.
4. **`OrderService`'in açık beyaz listesi.** `ORDER_HEADER_WRITABLE` / `ORDER_LINE_WRITABLE` (`order.service.ts:42-60`) hem `create` hem `update` yolunda uygulanıyor ve gerekçesi kodda yazılı (`:2262-2265`: *"`PATCH {"status":"CANCELLED"}` cancel kaskadını atlardı; `shippedQty` tek-yazma-noktası invariant'ını bozardı"*). D-F-03'ün önerdiği düzeltmenin şablonu tam olarak budur.
5. **Kısmi başarı SESSİZ değil.** `failed[]` üreten altı yolun tamamında alan sözleşmesi var ve istemciler okuyor; `TamburScreen.tsx:6320` yorumu kuralı açıkça yazıyor: *"ATLANANLAR YUTULMAZ. '42 yazıldı' deyip 8'inin sebebini söylememek en kötü davranıştır."* `reason-presets/reorder` ise hepsi-ya-hiç + **fail-closed** (eksik/yabancı id → 400), tek batch `$transaction` ile atomik.
6. **Toplu yazma tavanı bir kez ölçülüp gerekçesiyle yazılmış.** `shipping.controller.ts:60-67` — "26.000 UUID / 20 sn tx tavanı" hesabı yorumda duruyor. D-F-09 bu kalıbın **yayılmasını** istiyor, değiştirilmesini değil.
7. **Prisma hata kodları iki kümeye ayrılmış ve tanınmayan kod fail-LOUD.** `error.middleware.ts:150-170` + `:563-585` — "istemci veriyi değiştirerek kurtulabilir mi" ölçütü kodda yaşıyor; tanınmayan Prisma kodu 500 + `unclassified:true` audit. D-F-02'nin önerdiği genel statü dalı bu ayrımı bozmadan eklenmelidir.

---

## Sınır ötesi notlar

- **→ B (mükerrer/idempotency):** D-F-04 aynı zamanda bir idempotency bulgusudur (replay anahtarının yazım ZAMANI). Ayrıca `order.adapter.createOne` `orderService.create`'i `clientToken`**siz** çağırıyor (`order.adapter.ts:311`) — sipariş idempotency'si içe aktarım yolunda devre dışı.
- **→ A (eşzamanlılık):** D-F-11 #1 — Tambur finalize'da barkod sayacı advisory kilidi (`roll-barcode.helper.ts:82`) döngü boyunca N tur alınıyor; kilit sırası/tutma süresi A'nın ölçümü. D-F-04'te iki eşzamanlı `apply` koşumunun satır-satır yazımı hiçbir kilitle serileştirilmiyor.
- **→ I (gözlemlenebilirlik):** D-F-02 sahte `SYSTEM/ERROR` satırı üretiyor (audit gürültüsü); D-F-06 tek iz `console.error`; D-F-10 ham metin operatöre gidiyor ama `SystemLog`'a **gitmiyor** (ters yön). `PrismaClientValidationError` → 400 + audit YOK (`error.middleware.ts:589-595`) — Zod'suz yazma uçlarının yanlış-tip yolu buradan geçiyor, yani D-F-03'ün "yanlış tip" ayağı defterde iz bırakmıyor.
- **→ G (güvenlik):** `sanitizeWriteData`'nın `isActive`/`code`/`deletedAt`'ı geçirmesi yetki modeliyle kesişiyor (`customer:write` taşıyan kişi kaydı görünmez yapabilir). `test_route_auth_coverage.ts` HEAD'de **KIRMIZI** (K1a H2) — kimlik kapsamasının tek mekanik koruması; kırmızı kaldıkça "yeni public uç" sinyali gürültüye karışır. `PUT /admin/settings/:key` (D-F-07) `device.pairingRequired` ve `auth.*` anahtarlarını da yazabiliyor.
- **→ H (performans):** `ImportService.exportRows` (`import.service.ts:686-707`) tavansız — bugün en büyük varlık 194 satır, ama `order`/`roll` ölçeğinde bir adaptör eklenirse `take` gerekir (yorum bunu zaten söylüyor). `getRollStatsBatch` (`inventory.service.ts:1894-1912`) havuz client'ıyla `Promise.all` — **doğru** (beceri §1), tavan `≤12`, havuz 30. D-F-01 düzeltilirse (10 MB) tek istekte işlenecek satır sayısı 10 katına çıkar → tx/bellek profili yeniden ölçülmeli.
- **→ E (iş kuralı):** D-F-05'in birinci tezahürü 2026-08-27 "rota kapsaması REDDETMEZ, UYARIR" kararının kabul edilen riskini karşılıksız bırakıyor — kararın yeniden gözden geçirilmesi E'nin işi. D-F-03 (2) "birleştirme GERİ ALINAMAZ" değişmezini deliyor.
- **→ J (migration):** D-F-04'ün önerisi `ImportRunStatus` enum'una değer eklemek YERİNE `startedAt/finishedAt` çifti tercih edilmeli (enum değeri eklemek geri alınamaz).
- **→ K (test):** Bekçisiz kalan sınıflar: HTTP seviyeli gövde-limiti sondası (D-F-01), statü taşıyan http-errors (D-F-02), `sanitizeWriteData` anlam katmanı (D-F-03), içe aktarım replay yarışı (D-F-04), "üretilen ama tüketilmeyen uyarı kanalı" (D-F-05), dizi tavanı AST bekçisi (D-F-09). `test_middleware_order.ts` `exposedHeaders` listesini dondurduğu için D-F-12'de iki yer + bekçi birlikte değişmeli.
- **→ Electron/mobil istemci turu:** D-F-05 ve D-F-06 istemci tarafında düzeltme gerektiriyor (APK dahil). `Electron/src/services/apiClient.ts:44` `timeout: 15_000` toplu uçlar için düşük — içe aktarım/toplu baskı çağrılarında per-request override düşünülmeli (ama D-F-04 düzeltilmeden timeout'u büyütmek yalnız pencereyi genişletir; sıra: **önce sunucu**).

---

## Kapsanmayan / erişilemeyen

- **Canlı prod'a erişim yok.** Tüm K2 ölçümleri 2026-08-25 kopyası (`tekserp_saha_0825`, 190/195 migration) ve dev üzerinden. Son 5 migration'ın kolonları kopyada olmayabilir → D-F-06 ve D-F-08'in "veride iz" sorguları bilerek koşulmadı, 2. tura bırakıldı.
- **Gerçek `errorHandler` koşturulmadı.** D-F-02 sondası dal SIRASINI birebir kopyalayan izole bir ikizdir; asıl dosya `AuditService` → `prisma` zincirini çektiği ve **audit YAZACAĞI** için (salt-okunur kuralı) import edilmedi. 415 charset dalı sondada tetiklenemedi (fetch/undici `content-type` charset'ini normalize ediyor) — yalnız kaynak okumasıyla sınıflandırıldı.
- **`docs/design/IMPORT-EXPORT-TASARIM.md` okunmadı** (10 MB / 10.000 satır vaadi K1a'nın alıntısından alındı).
- **Auth/RBAC kapsaması bu turda türetilmedi** (G'nin alanı); K1a/K1b'nin kapısız-rota listeleri olduğu gibi kabul edildi.
- **Rapor uçlarının süre profili ölçülmedi** — "ağır rapor senkron HTTP içinde mi" sorusunun tam cevabı K7b + H ile birlikte verilmeli; bu turda yalnız içe aktarım yolu ölçüldü.
- **67 döngü noktasının tamamı tek tek okunmadı** — tarayıcı brace-eşleyen ve kaba (string/regex literalindeki `{`/`}` sayılmaz); en kötü 5 elle doğrulandı, kalan 62'si sınıflandırılmadı (çoğu tx-içi claim).
- **`sanitizeWriteData` bypass'ının (D-F-03) canlı denemesi YAPILMADI** — yazma yasağı gereği yalnız kod + DMMF + Prisma tip tanımı düzeyinde kanıtlandı; 2. turda dev DB'de tek satırlık bir repro ile K3'e yükseltilebilir.
- **`printed-document`/`traveler-card` yazan-GET yolları** (K1b H3/H4: GET üzerinde `create`) bu turda okunmadı — "GET yan etkisiz olmalı" F'ye ait bir sorudur, 2. tura not edildi.
