# TUR 4 — E-3 · Sınır durum: ALTYAPI
### (ağ kesintisi · zaman aşımı · havuz tükenmesi · restart · yazıcı/dış dünya)

> Denetçi: E-3 · SALT-OKUNUR · Dal `adnansahin` · Ortak zemin: `audit/00-map/_BRIEF.md`, `KUNYE.md`, `audit/01-find/_FINDER-BRIEF.md`, beceri paketi `express-api-audit` (§9 YP kataloğu dahil).
> Mercek: bulgu bir DEĞERİN ya da KOŞULUN ucunda doğmalı (bütçe tavanı, sayaç sarması, bağlantı tavanı, kapanış penceresi, saat kayması, kesinti).
> **⚠️ Bu turda DB ERİŞİLEMEDİ** — `audit/tools/sql-dev.sh` ve `sql-saha.sh` ikisi de `FATAL: Postgres.app failed to verify "trust" authentication` ile düştü (ortam arızası, ayrıntı: `## KAPSANMAYAN`). Bu yüzden **hiçbir bulgu K2 taşımıyor**; hepsi K1 (kod + şema + konfigürasyon + `node_modules` içindeki sürücü/ORM eşleme tablosu birlikte okundu, koruma mekanizmasının yokluğu grep ile teyit edildi). Kural gereği hiçbir bulgu S0 yazılmadı.

---

## 0. Bu turun ölçtüğü SINIR DEĞERLERİ (hepsi repodan doğrulandı)

| Sınır | Değer | Kaynak |
|---|---|---|
| Tablet (mobil) HTTP zaman aşımı | **10 000 ms** | `mobil/src/services/api.ts:15-17` |
| Masaüstü panel HTTP zaman aşımı | **15 000 ms** (yalnız yedek indirme 300 000) | `Electron/src/services/apiClient.ts:44`, `Electron/src/pages/System/Backups/service.ts:82` |
| Global interaktif tx tavanı | `maxWait 5 000` / `timeout 20 000` | `Teks-Erp/src/lib/prisma.ts:85-91` |
| Tek istisna tx tavanı (merge) | `timeout 120 000` / `maxWait 10 000` | `Teks-Erp/src/services/master-data-merge.service.ts:64,711` |
| DB `statement_timeout` | **50 s** (DB-level, per-database) | `Teks-Erp/docker-compose.yml:26`, `Teks-Erp/CLAUDE.md` "Operasyonel Bakım" |
| DB `idle_in_transaction_session_timeout` | 300 000 ms | `Teks-Erp/docker-compose.yml:28` |
| Havuz | `max 30`, `connectionTimeoutMillis 5 000`, `idleTimeoutMillis 600 000` | `Teks-Erp/src/lib/prisma.ts:67-73` |
| Kapanış zorla-çıkış penceresi | **5 000 ms** (`forceTimer` → `process.exit(1)`) | `Teks-Erp/src/server.ts:150-154` |
| pm2 `kill_timeout` / `max_memory_restart` / `restart_delay` | 8 000 ms / **1G** / 4 000 ms | `Teks-Erp/ecosystem.config.js:53,57,60` |
| Süreç modeli | `exec_mode:"fork"`, `instances:1` (TEK PROCESS, pazarlık dışı) | `Teks-Erp/ecosystem.config.js:47-48` |
| HTTP gövde limiti | 1 MB global / 10 MB yalnız `import` router'ı | `Teks-Erp/src/app.ts:141`, `src/routes/import.routes.ts:28` |
| Node HTTP sunucu zaman aşımları | **HİÇ AYARLANMAMIŞ** (`requestTimeout`/`headersTimeout`/`keepAliveTimeout` grep = 0) | grep `src/server.ts`, `src/app.ts` |

**Bu tablonun kendisi bir sınır bulgusudur:** her istemcinin vazgeçme bütçesi (10 s / 15 s), sunucunun kendi meşru çalışma bütçesinden (20 s; merge 120 s; tek ifade 50 s) **KÜÇÜK**. Yani "istemci vazgeçti ama sunucu commit etti" penceresi bir kaza değil, sistemin normal çalışma bandının içindedir. Aşağıdaki E-3-01, E-3-02, E-3-04, E-3-05, E-3-08 bu tek gerçeğin farklı yüzeylerdeki tezahürleridir.

---

## BULGULAR

---

### [E-3-01] İçe aktarımın idempotency defteri yazma döngüsünden SONRA yazılıyor — uzun bir aktarımda `clientToken` koruması KÖRDÜR, aynı dosya ikinci kez işlenir

| Şiddet | S1 | Kategori | B.3 (idempotency) + F (uzun senkron iş) | Öncelik | P1 | Modül | İçe aktarım | Kanıt seviyesi | K1 |

**Özet.** Panelden 3 000 satırlık müşteri/kumaş listesi yüklenir. Sunucu satırları **tek tek, sırayla** yazar; Electron 15 saniyede vazgeçip "zaman aşımı" gösterir. Operatör "Tekrar Dene"ye basar — istemci doğru davranır, **aynı** `clientToken`'ı yollar. Ama sunucudaki tekrar-koruması `ImportRun` tablosuna bakar ve o satır **döngü bittikten sonra** yazılır: birinci koşum hâlâ sürerken defterde hiçbir şey yoktur. İkinci istek korumadan geçer ve **aynı 3 000 satırı ikinci kez, birincisiyle eşzamanlı** işlemeye başlar.

**Kanıt.**

Koruma (girişte, defterden okuyor):
```ts
// Teks-Erp/src/services/import/import.service.ts:447-473
if (options.clientToken) {
  const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });
  if (prior) {
    // Aynı deneme yeniden gönderildi — YAZMA, önceki sonucu döndür.
    return { entity, runId: prior.id, status: prior.status as ..., ... };
  }
}
```
Defter satırı (döngünün SONRASINDA):
```ts
// Teks-Erp/src/services/import/import.service.ts:508-544  → satır satır yazma döngüsü
for (const p of prepared) { ... await adapter.createOne(p, ctx) ... }
// Teks-Erp/src/services/import/import.service.ts:552-574  → ANCAK BURADA
const run = await prisma.importRun.create({ data: { id: runId, ..., clientToken: options.clientToken ?? null, ... } });
```
- Satır tavanı: `MAX_IMPORT_ROWS = 10 000` (`src/services/import/import-coerce.ts:127-133`) — döngü 10 000 ardışık yazma turuna kadar çıkabilir.
- İstemci bütçesi: 15 000 ms (`Electron/src/services/apiClient.ts:44`); `importService.apply` **per-request timeout override'ı YOK** (`Electron/src/services/importService.ts:180-186`).
- İstemci tarafı DOĞRU: token diyalog oturumu başına bir kez üretilir ve tekrar denemede aynısı gider (`Electron/src/components/import/ImportDialog.tsx:118,160,348`). Yani kusur tamamen sunucudadır.
- **Koruma yok teyidi:** bu uçta advisory lock yok, `ImportRun` üzerinde "koşuyor" durumu yok, `running` bayrağı yok — grep `pg_advisory` `src/services/import/` = 0; `import.service.ts` içinde `IN_PROGRESS`/`RUNNING` statüsü yok (`status` yalnız `APPLIED|PARTIAL|FAILED` alır, `:499,541,546`).

**failure_mode.** `mode:"create"` ile 3 000 satırlık kumaş listesi yüklenir → 15. saniyede panel "zaman aşımı" der, operatör tekrar basar → iki koşum aynı satırları paralel yazar. Kod/ad seddi olan varlıklarda ikinci koşumun satırları **P2002'ye** düşer ve `failed` sayılır (rapor "3 000 satırın 1 240'ı hatalı" der, oysa hepsi yazılmıştır); kod alanı **olmayan** varlıklarda (ör. `defect_types`, `return_reasons`, alias satırları) gerçek **mükerrer ana veri** doğar. `onError:"abort"` semantiği de çöker: ikinci koşum "hiçbir şey yazılmadı" diyerek 400 döner, oysa birinci koşum yazmıştır.

**Veride fiili ihlal (K2).** Aranmadı — **DB erişilemedi** (bkz. KAPSANMAYAN). Ölçüm reçetesi 2. tur için: `SELECT "clientToken", count(*), min("createdAt"), max("createdAt") FROM import_runs WHERE "clientToken" IS NOT NULL GROUP BY 1 HAVING count(*)>1;` (bu sorgu 0 dönse bile bulgu geçersizleşmez — ikinci koşum birinciyle aynı token'ı taşır ve `@unique` varsa ikincisi defter satırını hiç yazamaz; asıl ölçüm `system_logs`'ta aynı `importRunId`'siz iki `IMPORT_RUN` olayı ve aynı dakikada iki koşum).

**İş etkisi.** Ana veri kirlenir (mükerrer müşteri/kumaş/renk = mükerrer panelinin işine dönüşür); "hatalı satır" raporu operatörü olmayan bir hatayı düzeltmeye gönderir; upsert modunda iki koşumun araya girmesi `updatedAt`'i tazeleyip tüm listelerin sıralamasını oynatır.

**Öneri (2. tur için).** Defter satırını **döngüden ÖNCE** `status:"RUNNING"` ile aç (aynı `runId` zaten önceden üretiliyor — `:478`), sonda `update` ile kapat. Guard'da `prior.status === "RUNNING"` → 409 `IMPORT_IN_PROGRESS` ("bu yükleme hâlâ sürüyor, sonucu Koşumlar ekranından izleyin"), tamamlanmışsa bugünkü cached dönüş. `clientToken`'a `@unique` zaten varsa açılış `create`'i ikinci isteği P2002 ile de eler (çift hat). Migration gerekmez (`status` string alanı); `RUNNING` satırları için "takılı koşum" süpürücüsü gerekir (`durationMs` null + 3 sa üstü → `FAILED`). **`[PROD'DA ÇALIŞTIRMA]` gerekmez — şema değişmiyor.**

**Kabul kriteri.** Aynı `clientToken` ile 200 ms arayla gönderilen iki `apply` isteğinden yalnız biri yazar; ikincisi 409 `IMPORT_IN_PROGRESS` alır; birincinin bitiminden sonraki üçüncü istek cached sonucu döner. Bekçi: `scripts/test_import_idempotency.ts` (yeni) — negatif sonda: defter satırı sona alınırsa test kırmızı vermeli.

**Efor.** 0,5 gün.

**Önceki defter.** İlgili kayıt bulunamadı (`audit/FINDINGS.jsonl`'de `import` hücresi yok — içe aktarım paketi 2026-08 sonrası). Harita `MATRIX.md` K9 satırı "H-2 (import uçuşta çift koşum)" ile aynı olguyu işaret ediyor; bu bulgu onun mekanizmasını ve sınır değerini (15 s ↔ 10 000 satır) veriyor.

---

### [E-3-02] Fason kabulde `clientToken` HER denemede yeniden üretiliyor — zaman aşımından sonraki ikinci basış ikinci bir KISMİ makbuz yazar

| Şiddet | S1 | Kategori | B.3 (idempotency) | Öncelik | P1 | Modül | Fason kabul | Kanıt seviyesi | K1 |

**Özet.** Fason kabul, hem panelde hem tablette, isteğin **içinde** yeni bir `clientToken` üretiyor. Yani token "fiziksel teslimatın kimliği" değil "butona basışın kimliği" oluyor — 2026-08-03 saha vakasının (KK1) birebir ikizi, ama bu kez tekrar-korumasının **tek** kimliği olan kısmi teslimat yolunda. Yorum satırı tam tersini iddia ediyor ("retry aynı isteği tekrarlarsa ikinci makbuz doğmaz").

**Kanıt.**

Panel — token `mutationFn`'in İÇİNDE:
```tsx
// Electron/src/pages/Operations/WorkOrders/FasonReceiveDialog.tsx:175-196
const mut = useMutation({
  mutationFn: () => workOrderService.receiveFason({
    ...,
    // İdempotency — retry aynı isteği tekrarlarsa ikinci makbuz doğmaz.
    clientToken: crypto.randomUUID(),      // ← her çağrıda YENİ kimlik
  }),
```
Tablet — payload üreticisi her `doSubmit`'te yeniden koşuyor:
```ts
// mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts:341-343
//   İdempotency: payload kurulurken BİR KEZ üretilir — offline kuyruk replay'i
//   aynı token'ı taşır. Kısmi teslimatta replay'in tek kimliği budur.
clientToken: generateClientUuid(),
```
```ts
// mobil/src/screens/Modules/FasonKabul/FasonKabulScreen.tsx:1259-1263
const doSubmit = () => {
  const payload = buildPayload();      // ← buildReceivePayload → TAZE token
  if (!payload) return;
  receiveMutation.mutate(payload);
};
```
Sunucudaki koruma, kısmi teslimatta **yalnız** token'a dayanıyor (küme-eşitliği guard'ı bilerek atlanıyor):
```ts
// Teks-Erp/src/services/subcontractor.service.ts:2345-2370, 2410-2414
// IDEMPOTENCY #1 — clientToken (kısmi teslimatın TEK replay kimliği).
if (data.clientToken) { const tokenHit = await prisma.subcontractorReceipt.findUnique({ where: { clientToken: data.clientToken } }); ... }
...
// ⚠️ KISMİ makbuz (herhangi bir kalemi isPartial) cached DÖNEMEZ: aynı
// top kümesi ikinci teslimatta meşru olarak tekrar gelir ("100 gitti,
// 51 geldi, 49 sonra"). Kısmi denemelerin replay kimliği clientToken'dır
if (prior.items.some((i) => i.isPartial)) continue;
```
- **Koruma yok teyidi:** mobilde yapışkan-token disiplinini taşıyan tek modül `mobil/src/offline/entryAttempt.ts` (`tokenForSubmit` / `onAttemptFailed` / `isAmbiguousFailure`, `:248-254`); grep `tokenForSubmit` = yalnız `KK1Screen.tsx` ve `Siparis/useNewOrder.ts`. FasonKabul o modülü **kullanmıyor**.
- Karşılaştırma (doğru yapılmış kardeşler): `ManualEntryDialog.tsx:156` · `ReworkRollsDialog.tsx:70` · `NewSackDialog.tsx:41` · `CreateShipmentDialog.tsx:66` · `WorkOrderFormPage.tsx:67` `useState(() => crypto.randomUUID())`; mobilde `TartiPaket` ref'li, `HizliIsEmri` `useQuickWorkOrder.ts:162` + `:934` (yalnız yeni WO oturumunda tazelenir). Grep `clientToken: crypto.randomUUID()` çağrı yerinde → **tüm Electron ağacında tek vuruş**, o da bu dosya.

**Çakışma senaryosu (yarış değil, ardışık — ama sınıf aynı).**
- T1 (10:00:00,0): Tablet "Kabul Et" → `token=A`, kısmi kabul (100 gitti, 30 geldi). Sunucu makbuzu yazmaya başlar (300 parça tavanına yakın bir kabulde tx birkaç saniye sürer).
- T2 (10:00:10,0): Tabletin axios bütçesi (10 000 ms) dolar → `ECONNABORTED`. `stationRetry` 5xx/ağ hatasında 3 kez otomatik dener — **aynı payload, aynı `token=A`** → bunlar `SubcontractorReceipt.clientToken @unique` sayesinde güvenli.
- T3 (10:00:47): Otomatik denemeler de tükenir, ekranda "Kabul başarısız". Operatör tuşa **yeniden basar** → `doSubmit` → `buildPayload()` → **`token=B`**.
- SONUÇ: Sunucuda A makbuzu zaten commit edilmiştir. B isteği token guard'ını geçer; küme guard'ı `isPartial` yüzünden `continue` der; kalan metraj hâlâ ≥30 olduğu için **ikinci bir kısmi makbuz yazılır**: top 100 → 70 → 40, iki ayrı makbuz, iki ayrı "yeni parti", ve fason karnesinde 60 m dönmüş görünür.

**failure_mode.** Boyahaneden gelen 30 m'lik kısmi teslimat, 10 saniyelik bir yavaşlık yüzünden **60 m** olarak deftere girer: `SubcontractorReceiptItem.receivedQty` iki satır, `Roll.currentQty` iki kez düşer, iki ayrı `newRolls` seti (barkodlu top) doğar ve fason firma karnesindeki "dönen metraj" iki katına çıkar. Hata yok, log yok — operatör "kabul başarısız" gördüğü için ikinci makbuzu aramaz.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: aynı `stepId` + aynı `subcontractorId` + aynı `newRollId` kümesi için `cancelledAt IS NULL` ve `createdAt` farkı < 5 dk olan iki `subcontractor_receipts` satırı; ayrıca `isPartial=true` kalemlerde aynı `newRollId`'nin ardışık iki makbuzda aynı `receivedQty` ile geçmesi.

**İş etkisi.** Fason mutabakatı (fabrikanın boyahaneye ödediği para bu metrajdan hesaplanır), stok metrajı ve fire/çekme oranı sessizce yanlışlanır. `RollVariance` `SUBCONTRACTOR_RETURN` satırları da ikizlenir.

**Öneri (2. tur için).** ① Her iki istemcide token'ı **mantıksal denemeye** bağla: panelde `useState(() => crypto.randomUUID())` + başarıda tazele (kardeş diyalogların deseni); tablette `mobil/src/offline/entryAttempt.ts`'i FasonKabul'e de bağla (`tokenForSubmit` + `onAttemptFailed`, `isAmbiguousFailure` zaten "kesin 4xx'te yapışma" kuralını taşıyor). ② Sunucu tarafında ikinci hat: kısmi kabulde `(stepId, subcontractorId, returns imzası, receivedQty)` üzerinden 90 sn'lik bir **onaylatma** penceresi (KK1 `duplicateGuardEnabled` emsali, 409 `POSSIBLE_DUPLICATE_RECEIPT` + `confirmDuplicate`) — bayrak gerektirir, varsayılan kapalı. Migration yok.

**Kabul kriteri.** Tablette kabul isteği zorla zaman aşımına düşürülüp tuşa ikinci kez basıldığında sunucuya **aynı** token gider ve tek makbuz oluşur; `scripts/test_fason_partial_receive.ts`'e "aynı token ikinci kez → cached makbuz, yeni kalem YOK" bölümü + istemci tarafında `receivePayload.helper` için "iki ardışık build aynı token'ı üretir (failed durumunda)" birim testi.

**Efor.** 1 gün (iki istemci + bekçi).

**Önceki defter.** Doğrudan eşleşen id yok. Sınıf emsali kök `CLAUDE.md` "İdempotency (2026-07-14)" ve `docs/history` 2026-08-03 KK1 vakası; bu bulgu o dersin **uygulanmamış kaldığı ikinci yüzeyi**dir.

---

### [E-3-03] DB restartı, ağ kopması, `statement_timeout` ve bağlantı tavanı 503 değil **500** üretiyor — kod tabanında P1001/P1008/P1017/P2037/P2039 SIFIR referans

| Şiddet | S2 | Kategori | I (hata/gözlemlenebilirlik) + F | Öncelik | P2 | Modül | Çekirdek / hata yolu | Kanıt seviyesi | K1 |

**Özet.** `error.middleware` iki altyapı yolunu doğru sınıflandırıyor (pg havuz zaman aşımı ve Prisma `P2028`) ve ikisine de **503 + `Retry-After`** veriyor. Ama gerçek bir altyapı kesintisinin ürettiği kodların **hiçbiri** o listede değil: PostgreSQL yeniden başlarsa, kablo çekilirse, bir sorgu 50 s `statement_timeout`'una takılırsa ya da bağlantı tavanına gelinirse istemciye **HTTP 500 "Sunucu hatası oluştu."** dönüyor. 500, istemci sözleşmesinde "sunucu bozuldu" demektir; doğrusu "sonuç BELİRSİZ, aynı kimlikle tekrar dene"dir.

**Kanıt — sürücü → ORM → HTTP zinciri, üç katman da okundu.**

① `@prisma/adapter-pg` hangi SQLSTATE'i hangi "kind"a çeviriyor (`node_modules/@prisma/adapter-pg/dist/index.js`, `mapDriverError` / `mapSocketError`):
- `ECONNREFUSED`/`ENOTFOUND` → `DatabaseNotReachable` · `ECONNRESET` → `ConnectionClosed` · `ETIMEDOUT` → `SocketTimeout`
- `40001` → `TransactionWriteConflict` · `53300` → `TooManyConnections`
- **`default:` → `kind:"postgres"`** — yani `57014` (statement_timeout), `57P01` (terminating connection due to administrator command / DB restart), `25P03` (idle in transaction timeout), `40P01` (deadlock), `08006`, `23514`… hepsi buraya düşer.

② Prisma çekirdeği bu kind'ları hangi koda çeviriyor (`node_modules/@prisma/client/runtime/client.js`, fonksiyon `hp`/`We`/`gp`):
```js
case "DatabaseNotReachable": return "P1001";   case "SocketTimeout":  return "P1008";
case "ConnectionClosed":     return "P1017";   case "TlsConnectionError": return "P1011";
case "TooManyConnections":   return "P2037";
case "postgres": ... return;   // → gp(e) → new O("Database error. Code: `57014`...", "P2039")
```
ve `O` (UserFacingError) tüketim noktasında gerçek Prisma hatasına dönüşüyor:
```js
if (t instanceof O) return new F.PrismaClientKnownRequestError(t.message, { code: t.code, meta: t.meta, ... });
... catch { return t }   // eşleşmeyen her şey HAM geri döner
```

③ `error.middleware` bu kodlarla ne yapıyor:
```ts
// Teks-Erp/src/middlewares/error.middleware.ts:148-155
const SERVER_FAULT_PRISMA_CODES = new Set<string>(["P2021","P2022","P2010","P2015","P2017","P2018"]);
// :157-169
const CLIENT_DATA_PRISMA_CODES = new Set<string>(["P2000","P2005","P2006","P2011","P2012","P2013","P2019","P2020","P2033"]);
// :530-536  — yalnız bu iki kod 503 alıyor
if (prismaErr.code === "P2024" || prismaErr.code === "P2028") { ... respondServerBusy(res); return; }
// :560-586  — kalan HER kod: "SINIFLANDIRILMAMIŞ" → 500
res.status(500).json({ success: false, message: "Sunucu hatası oluştu." });
```
`P1001 / P1008 / P1011 / P1017 / P2037 / P2039` hiçbirinde geçmiyor → **500**. Bir `PrismaClientInitializationError` olarak gelirlerse `instanceof PrismaClientKnownRequestError` dalına hiç girmez ve en alttaki generic dala (`:600-634`) düşer → yine **500**, üstelik `unclassified` işareti de olmadan.

**Koruma yok teyidi (bu bulgunun omurgası).**
```
grep -rln "P1017\|P1001\|P1008\|P2039\|P2037" Teks-Erp/src --include='*.ts'   →  0 dosya
```
Yani bu kodların hiçbiri kod tabanında bir kez bile anılmıyor; ne bir dalda, ne bir yorumda, ne bir bekçide. Bekçi de aynı kör noktayı paylaşıyor: `scripts/test_pool_health.ts` tam olarak **düzeltilmiş iki yolu** ölçüyor (`:178` havuz acquire → 503, `:196` P2028 → 503) ve sınıfın kalanına hiç bakmıyor.

**failure_mode.** Vardiya ortasında sunucudaki PostgreSQL servisi yeniden başlatılır (Windows güncellemesi, elle restart, veya `db-copy` sonrası `ALTER DATABASE RENAME` takası). O anda uçuşta olan Tambur kesim isteği `ECONNRESET` alır → `ConnectionClosed` → `P1017` → error.middleware'in sınıflandırılmamış dalı → **HTTP 500 "Sunucu hatası oluştu."** + audit `recordId="P1017", unclassified:true`. Tablette `stationRetry` (`mobil/src/offline/mutations.ts:125-131`) 5xx'i geçici sayıp 3 kez daha dener — bu **doğru** davranıştır, ama operatörün ekranındaki mesaj "sunucu hatası"dır: yazılıp yazılmadığı belirsiz olduğu hâlde operatöre "bir şey bozuldu" denir. Aynı kesinti panelde 500 üretir; panel react-query 5xx'te bir kez dener, sonra kırmızı toast basar ve operatör **yeni bir kimlikle** (E-3-02'deki gibi) yeniden dener. Ayrıca `/health`'in `poolAcquireTimeouts` sayacı **artmaz** (o sayaç yalnız `classifyPoolTimeout` dalından beslenir, `src/lib/pool-health.ts:29-32,103-107`) → olayın hiçbir metrikte izi kalmaz; tek iz `system_logs`'taki `recordId='P1017'` satırıdır ve onu kimse sorgulamaz.

İkinci somut yol: 50 s'yi aşan bir rapor/export sorgusu → `57014` → `P2039` → 500 "Sunucu hatası oluştu.". Operatör raporun **çok büyük** olduğunu asla öğrenmez; aralığı daraltması gerektiğini söyleyen hiçbir şey yoktur.

Üçüncü yol: `53300` (DB `max_connections` doldu — havuzun 30'u + `pg_dump` + `pg_restore` + pgAdmin/psql) → `P2037` → 500. Havuz sağlıklı görünür (`poolWaitingMax` düşük), çünkü tavana çarpan **havuz değil DB'dir**; teşhis hiçbir yerde yazmaz.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: `SELECT "recordId", count(*), min("createdAt"), max("createdAt") FROM system_logs WHERE category='SYSTEM' AND action='ERROR' AND "recordId" IN ('P1001','P1008','P1011','P1017','P2037','P2039','DriverAdapterError') GROUP BY 1;` — `MATRIX.md` K6 satırı prod kopyasında `recordId='Error'` sınıfının varlığını zaten kaydetmiş.

**İş etkisi.** ① Yanlış istemci sözleşmesi: `Retry-After` gitmez, 503'e özel istemci yolları (mobil "sunucu yoğun" bandı) devreye girmez. ② Teşhis kaybı: gerçek altyapı olayı, uygulama hatasıyla aynı kovaya düşer. ③ En pahalısı: 500, mükerrer kayıt üreten insan-retry'ını tetikler (E-3-01/E-3-02 ile birleşir).

**Öneri (2. tur için).** `error.middleware`'e **altyapı sınıfı** ekle, `SERVER_FAULT`/`CLIENT_DATA` ayrımının yanına üçüncü küme: `INFRA_TRANSIENT = { P1001, P1008, P1011, P1017, P2037, P2034 }` → `respondServerBusy` (503 + Retry-After) + `recordPoolTimeout` benzeri ayrı bir sayaç (`/health.dbTransientErrors`). `P2039` özel: mesajındaki `Code: \`XXXXX\`` ayrıştırılıp SQLSTATE'e göre bölünmeli — `57014`/`55P03`/`40P01`/`25P03` → 503 "işlem çok uzun sürdü / kilit bekledi, daha küçük bir aralıkla tekrar deneyin"; `23514` bugünkü 409 dalını korur (`extractCheckConstraint` zaten `cause.code`'a bakıyor, aynı çıkarımı `originalCode` üzerinden genelleştir); kalanlar 500. Migration/izin YOK; yalnız backend.

**Kabul kriteri.** `scripts/test_pool_health.ts`'e §4: sahte `PrismaClientKnownRequestError` (`P1017`, `P2037`) ve `P2039` (`Code: \`57014\``) enjekte eden uçlar → 503 + `Retry-After` + `/health` sayacı 1 artmış; `P2039` (`Code: \`23514\``) → 409 (mevcut CHECK mesajı korunmuş); tanınmayan bir kod → hâlâ 500 (fail-loud korunmuş). **Negatif sonda:** yeni küme boşaltılınca test kırmızı vermeli.

**Efor.** 1 gün.

**Önceki defter.** `MATRIX.md` K6 → "H-1 (57014/40P01/25P03/53300 generic 500, 503 sinyali yok)" ile aynı olgu; bu satır onu sürücü/ORM eşleme tablosuyla **kanıta** bağlıyor (hangi kodun hangi dala düştüğü artık tahmin değil) ve sınır koşulunu (DB restartı / 50 s tavanı / bağlantı tavanı) adlandırıyor.

---

### [E-3-04] Merge'in 120 s tx tavanı DB'nin 50 s ifade tavanının ÜSTÜNDE — tek ifade o bütçeyi asla kullanamaz; 200 000 satırlık "çok büyük" eşiği yanlış tavana göre kalibre

| Şiddet | S2 | Kategori | D (tx sınırları) + F | Öncelik | P2 | Modül | Ana veri birleştirme | Kanıt seviyesi | K1 |

**Özet.** Birleştirme işlemi, varsayılan 20 s tavanı yetmediği için kendine 120 s'lik özel bir tx bütçesi veriyor. Ama veritabanı seviyesinde **tek bir SQL ifadesi 50 saniyeden uzun süremez** (`statement_timeout=50s`). Yani 120 s ancak "çok sayıda kısa ifade" için gerçektir; 200 000 satır taşıyan **tek** bir `updateMany` için değildir. Üstelik önizlemenin "bu iş çok büyük" eşiği (200 000 satır) bu 50 s'lik gerçek tavana göre değil, tx bütçesine göre seçilmiş.

**Kanıt.**
```ts
// Teks-Erp/src/services/master-data-merge.service.ts:56-64
/** Önizlemede "bu iş çok büyük" eşiği. 20 sn'lik varsayılan tx tavanına karşı
 *  ÜÇ katmanlı savunmanın birincisi (ikincisi çağrıya özel timeout, ...) */
const MAX_ROWS_TO_MOVE = 200_000;
/** Bu çağrıya özel tx tavanı — varsayılan 5 sn/20 sn birleştirmeye yetmez. */
const MERGE_TX_TIMEOUT_MS = 120_000;
// :711
{ timeout: MERGE_TX_TIMEOUT_MS, maxWait: 10_000 },
// :335-343  — eşik, engelleyici olarak önizlemede
if (totalRowsToMove > MAX_ROWS_TO_MOVE) { blockers.push({ key: "TOO_LARGE", ... }); }
```
DB tavanı: `Teks-Erp/docker-compose.yml:26` `statement_timeout=50s`; `Teks-Erp/CLAUDE.md` → "App DB'de `statement_timeout=50s` aktif … uzun bir DDL'i 50s'de İPTAL EDER (doğrulandı: `canceling statement due to statement timeout`)".
Kombinasyon: 50 s'de kesilen ifade → SQLSTATE `57014` → **E-3-03** zinciriyle **HTTP 500 "Sunucu hatası oluştu."**

**failure_mode.** Mükerrer panelinden 120 000 satır taşıyan bir müşteri birleştirmesi onaylanır (önizleme 200 000 eşiğinin altında olduğu için ENGELLEMEZ, yalnız "vardiya dışında yapın" uyarısı basar — `:344-347`). Taşınan tablolardan biri (ör. `system_logs` ya da `roll_movements`) tek `updateMany` ile 50 s'yi aşar → PostgreSQL ifadeyi iptal eder → tx geri sarar → operatör **"Sunucu hatası oluştu."** görür. Ne "çok büyük" der, ne "daha küçük gruplar hâlinde birleştirin" der (o metin yalnız 200 000 üstünde basılır), ne de kaç satırın taşındığını söyler (hiçbiri — tx atomiktir, bu doğru tarafıdır). Operatör aynı işlemi tekrar dener; **her denemede aynı yerde, aynı süre sonra, aynı mesajla düşer.** İşlem hiçbir zaman tamamlanamaz ve sebebi hiçbir yüzeyde yazmaz.

Aynı sınıf ikinci yüzey: **P2028** (tx bütçesi aşımı) `respondServerBusy` ile karşılanıyor ve mesaj *"Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin."* (`error.middleware.ts:123`). Bütçe aşımı **deterministiktir** — iş çok büyüktür, sunucu yoğun değildir; "birkaç saniye sonra tekrar deneyin" operatörü sonsuz bir döngüye sokar. Somut aday: 300 parçalık fason kabulü (`subcontractor.controller.ts:156-167` `.max(300)`) tek tx içinde 300 `roll` + hareket + sapma satırı yazar; tavan 20 s'dir ve aşılırsa operatörün elinde "daha az parça gir" ipucu **yoktur**.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur: `system_logs` içinde `recordId IN ('P2028','P2039')` sayımı + `MERGE_*` audit'lerinin sonuçsuz kalanları.

**İş etkisi.** Mükerrer temizliği (ana veri kalitesinin tek aracı) belirli bir büyüklüğün üstünde **hiç yapılamaz** ve sebebi görünmez; 300 parçalık fason kabulünde vardiya kilitlenir.

**Öneri (2. tur için).** ① Eşiği gerçek tavana göre kalibre et: `MAX_ROWS_TO_MOVE`'u ölçülmüş bir "50 s'de taşınabilen satır" sayısına indir (kaba ölçüm: en büyük tabloda `EXPLAIN ANALYZE` ile satır/sn) **veya** merge tx'inin başında `SET LOCAL statement_timeout = '110s'` uygula (arşivleyicinin `SET LOCAL teks.audit_purge` deseni birebir emsal — `audit.service.ts:233`; `SET LOCAL` COMMIT'te söner ve havuza sızmaz). ② P2028 ve `57014` mesajlarını ayır: "yoğun, tekrar deneyin" yerine **"bu işlem tek seferde yapılamayacak kadar büyük — daha az kayıtla deneyin"** (E-3-03'ün öneri kümesiyle aynı dokunuş). Migration/izin YOK.

**Kabul kriteri.** 120 s'lik tx bütçesinin gerçekten kullanılabildiği (ya da eşiğin 50 s'ye göre daraltıldığı) bir bekçi: `scripts/test_master_data_merge.ts`'e "N satırlık sahte taşıma 50 s'yi aşarsa operatöre 'çok büyük' mesajı döner" bölümü. Negatif sonda: `SET LOCAL` kaldırılınca / eşik geri yükseltilince test kırmızı.

**Efor.** 0,5 gün.

**Önceki defter.** Tur 1'in "merge 120 s > DB 50 s" tespiti (görev tanımında referans verilen); bu satır sınırda **ne olduğunu** (57014 → 500 → sonsuz tekrar) ve eşiğin yanlış kalibre olduğunu ekliyor.

---

### [E-3-05] `apply-attribute-to-rolls` top sayısını SINIRLAMIYOR — N seri transaction, hem istemci bütçesini hem kapanış penceresini aşar, `failed[]` kimseye ulaşmaz

| Şiddet | S2 | Kategori | F (toplu uç / kısmi başarı) + D | Öncelik | P2 | Modül | İş emri / top düzeltme | Kanıt seviyesi | K1 |

**Özet.** Planlamacının "bu iş emrinin tüm açık kumaşlarının rengini düzelt" işlemi, seçilen her top için **ayrı bir transaction** koşan bir döngüdür. Kardeş şemaların hepsinde `.max(500)` varken bu şemada **hiçbir tavan yok**; tek sınır 1 MB gövde limiti (≈26 000 UUID). İşlem uzadıkça hem panel (15 s) vazgeçer hem de bir `pm2 restart` sırasında 5 saniyelik kapanış penceresi döngüyü ortasından keser.

**Kanıt.**
```ts
// Teks-Erp/src/controllers/workorder.controller.ts:265-270  — TAVAN YOK
const applyAttributeSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz"),
  ...
});
// aynı dosyadaki KARDEŞLER — hepsi tavanlı:
// :118  rollIds: z.array(z.string().uuid()).max(500).optional(),
// :127  rollIds: z.array(z.string().uuid()).max(500).optional(),
// :137  rollIds: z.array(z.string().uuid()).max(500).optional(),
```
```ts
// Teks-Erp/src/services/workorder-link.service.ts:783-807  — top başına AYRI tx, tavansız döngü
for (const roll of rolls) {
  try { await inventoryService.applyManualProperties(roll.id, {...}, userId, engineOpts); updated++; }
  catch (err) { failed.push({ rollId: roll.id, barcode: roll.barcode, message: ... }); }
}
```
- Kapanış penceresi: `Teks-Erp/src/server.ts:150-154` `forceTimer = setTimeout(... process.exit(1), 5000)`. `server.close()` uçuştaki isteği bitirmeyi bekler ama **5. saniyede süreç zorla ölür**.
- OOM tetiği: `Teks-Erp/ecosystem.config.js:57` `max_memory_restart: "1G"` — restart vardiya ortasında, uyarısız gelir.
- İstemci bütçesi: 15 000 ms (`Electron/src/services/apiClient.ts:44`).
- **Koruma yok teyidi:** döngüde ne bir zaman bütçesi, ne bir `AbortSignal`, ne bir devam-noktası (checkpoint) var; `failed[]` yalnız **yanıt gövdesinde** taşınır — kalıcı bir yere yazılmaz (audit satırı `:809-823` yalnız `failedCount` sayısını taşır, hangi topların düştüğünü DEĞİL).

**failure_mode.** 400 toplu bir iş emrinde planlamacı "hepsinin rengini düzelt" der. Döngü ~400 × 30-60 ms ≈ 15-25 s sürer. (a) **Normal hâl:** panel 15. saniyede vazgeçer, kırmızı toast basar; sunucu döngüyü bitirir, 400 topu düzeltir, ama `failed[]` raporunu kimsenin dinlemediği sokete yazar. Planlamacı "olmadı" sanıp tekrar basar — ikinci koşum artık düzeltilmiş topları tekrar düzeltir (idempotent, zararsız) ama `updatedAt` tazelenir ve envanter listelerinin sıralaması ikinci kez oynar. (b) **Deploy/OOM hâli:** aynı işlem sırasında `pm2 restart` gelirse döngü 5. saniyede kesilir → **160 top yeni renkte, 240 top eski renkte** kalır; iki grup arasındaki fark hiçbir yerde yazılı değildir, audit satırı bile yazılmaz (o satır döngüden SONRA, `:809`). Plan rengi ise (`changeTargetColor`) daha önce commit edilmiştir → iş emri "hedef renk X" der, toplarının %60'ı X'tir.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: hedef rengi olan iş emirlerinde `rolls.colorId <> workOrders.targetColorId` olan açık kumaşların WO başına dağılımı (tam-kapsama beklenirken kısmi kapsama = bu bulgunun izi).

**İş etkisi.** İş emri planı ile malın gerçeği ayrışır; Tambur plan-sapma kapısı (409 `PLAN_MISMATCH`) düzeltilmemiş topların her birinde tekrar tekrar soru sorar ve operatör "zaten düzeltilmişti" diye onaylayıp geçer — kapının anlamı aşınır.

**Öneri (2. tur için).** ① Şemaya kardeşleriyle aynı tavanı koy: `.max(500)`. ② Döngüye zaman bütçesi ekle (ör. 10 s dolunca dur, `partial:true` + `remainingRollIds` döndür) — kısmi sonuç bu projede zaten kabul edilmiş bir tasarım (kurşun dağıtım `failed[]` emsali), eksik olan **parçalılığın görünür olması**. ③ `failed[]`'i audit'e de yaz (`rollIds` zaten yazılıyor, `failed` listesi de yazılsın) ki yanıt kaybolsa bile iz kalsın. Migration/izin YOK.

**Kabul kriteri.** 501 top ile istek 400 alır; 500 topluk istek bütçeyi aşarsa `partial:true` + kalan liste döner; audit satırı düşen topların id'lerini taşır. Bekçi: `scripts/test_wo_target_color_guard.ts`'e bölüm; negatif sonda tavanın kaldırılması.

**Efor.** 0,5 gün.

---

### [E-3-06] "Sipariş Bağla (override)" üç ayrı transaction — yarıda kesilirse plan DEĞİŞMİŞ, bağ KURULMAMIŞ kalır ve ikinci deneme yanıltıcı bir 400 ile reddedilir

| Şiddet | S2 | Kategori | D (tx sınırları) + E (iş kuralı) | Öncelik | P2 | Modül | İş emri ↔ sipariş bağı | Kanıt seviyesi | K1 |

**Özet.** Süpervizörün "uyumsuz siparişi yine de bağla" zinciri üç bağımsız yazma adımından oluşuyor: ① iş emrinin hedef rengini/enini değiştir, ② topları eşitle, ③ bağı kur. Aralarında telafi (compensation) yok. Süreç ①'den sonra ölürse (deploy, OOM, DB restartı, istemci kopması + 5 s zorla-çıkış) iş emrinin **planı kalıcı olarak değişmiş** ama bağ hiç kurulmamış olur; üstelik ikinci deneme, kendi ilk adımının yan etkisine takılıp operatörü başka bir ekrana yollayan bir 400 verir.

**Kanıt.**
```ts
// Teks-Erp/src/services/workorder-link.service.ts:940-968
// ① Plan düzeltmesi (her biri kendi sebep+audit iziyle).
if (colorDiff) { const res = await this.changeTargetColor(workOrderId, line.colorId ?? null, trimmed, userId, {...}); }
if (widthDiff) { await this.changeWidth(workOrderId, lineWidth, trimmed, userId, "MANUAL"); }
// ② Düzeltilebilir topları eşitle; kısmi başarı normaldir (failed[] rapora düşer).
if (editableIds.length > 0) { const applied = await this.applyAttributeToRolls(...); }
// ③ Bağ — hedef artık satırla uyumlu, normal doğrulamadan geçer.
const linkRes = await this.linkOrderLines(workOrderId, [orderLineId], userId);
```
İkinci denemeyi reddeden guard, aynı fonksiyonun başında:
```ts
// Teks-Erp/src/services/workorder-link.service.ts:914-919
if (!colorDiff && !widthDiff) {
  throw AppError.badRequest("Sipariş zaten iş emriyle uyumlu — normal 'Sipariş Bağla' kullanın.");
}
```
- Kesilme penceresi: `src/server.ts:150-154` (5 s zorla çıkış) · `ecosystem.config.js:57` (`max_memory_restart: 1G`) · `:60` (`restart_delay: 4000`).
- **Koruma yok teyidi:** üç adımı saran bir dış tx yok; yarım kalan durumu tespit eden bir mutabakat sorgusu yok (`scripts/consistency-check.sql` §'lerinde "hedef rengi sipariş satırıyla uyumlu ama bağ yok" diye bir bölüm yok — grep `orderLinks` `scripts/consistency-check*.sql` = 0); telafi/yeniden deneme kaydı yok.
- İş emri tipi de bu zincirin sonucuna bağlı: `linkOrderLines` ilk bağda `type→ORDER_PRODUCTION` yazar (kök `CLAUDE.md` 2026-08-21 notu) — ③ hiç koşmazsa iş emri **STOK** kalır.

**failure_mode.** Süpervizör, kırmızı bir siparişi mavi hedefli bir iş emrine bağlamak ister; zincir ①'de WO'nun hedef rengini kırmızıya çeker ve topları eşitlemeye başlar. Bu sırada sunucu `pm2 restart` alır (planlı deploy). Sonuç: iş emri **kırmızı** hedefli, tipi **STOK**, hiçbir siparişe bağlı değil ve toplarının bir kısmı kırmızı bir kısmı mavi. Süpervizör aynı işlemi tekrarlar → `colorDiff` artık `false` (plan zaten kırmızı) → **400: "Sipariş zaten iş emriyle uyumlu — normal 'Sipariş Bağla' kullanın."** Bu mesaj tesadüfen doğru bir kurtuluş yolu gösteriyor (normal bağlama gerçekten çalışır), ama sebebini söylemiyor ve süpervizör "ben bağlamadım ki" der. Toplardaki karışıklık ise hiçbir yerde raporlanmaz.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: `type='STOCK'` **ve** `targetColorId IS NOT NULL` olan, aynı renkte açık bir sipariş satırı bulunan iş emirleri (zincirin yarım kaldığının parmak izi) + o WO'ların `system_logs`'ta `ORDER_LINK_OVERRIDE` olayının **olmaması** (③'e hiç varılmadığının kanıtı, çünkü audit ③'ten sonra yazılıyor `:978-991`).

**İş etkisi.** Planlama ile sipariş defteri ayrışır; "Ürün Dengesi"/karşılanma raporları bu iş emrini stok üretimi sayar, sipariş açık görünür, ikisi de yanlıştır.

**Öneri (2. tur için).** Bilinçli çok-tx tasarımı korunacaksa **iz bırakılmalı**: zincirin başında bir `SystemLog` "ORDER_LINK_OVERRIDE_STARTED" olayı (ucuz, tx dışı, best-effort) + sonda "…_COMPLETED"; başlamış ama tamamlanmamış zincirler için `consistency-check` bölümü (§ yeni) ve panelde görünür bir "yarım kalmış plan değişikliği" bandı. İkinci denemenin 400'ü **bağlamı bilmeli**: `colorDiff/widthDiff` yokken hedef zaten satırla uyumluysa ve bağ yoksa → 400 yerine **doğrudan ③'ü koş** (idempotent tamamlama). Migration YOK.

**Kabul kriteri.** ① sonrası süreç öldürülüp yeniden başlatıldığında aynı isteğin tekrarı bağı **kurar** (400 vermez); `consistency-check` yeni bölümü yarım zincirleri sayar. Bekçi: `scripts/test_wo_target_color_guard.ts`'e "① koştu ③ koşmadı → tekrar tamamlar" bölümü.

**Efor.** 1 gün.

---

### [E-3-07] `bulkDispatchStep` SEPARATE döngüsü sessiz kısmi commit üretir — ilk partiler sevk edilir ve ÇEKİ BELGESİ doğar, operatör yalnız hata görür

| Şiddet | S2 | Kategori | F (toplu uç / sessiz parçalılık) + D | Öncelik | P2 | Modül | Fason sevk | Kanıt seviyesi | K1 |

**Özet.** Çok partili bir fason sevkinde "her parti ayrı sevk" seçilirse, sunucu parti başına ayrı bir `dispatch()` çağırır. Döngüde `try/catch` yok, `failed[]` yok: ortada bir hata (ya da bir süreç/DB kesintisi) olursa önceki partiler **commit edilmiş**, kendi FS numaralarını ve fason çeki belgelerini almış olur; istemciye ise yalnızca hata gider.

**Kanıt.**
```ts
// Teks-Erp/src/services/subcontractor.service.ts:1522-1560
if (data.multiBatchStrategy === "SEPARATE") {
  ...
  if (byBatch.size > 1) {
    const dispatches: unknown[] = [];
    for (const [, rollIds] of byBatch) {
      const res = await this.dispatch({ workOrderId: ..., rollIds, ... }, userId);   // ← her biri KENDİ tx'i
      dispatches.push(res.data);
    }
    return { success: true, data: { separate: true, dispatchCount: dispatches.length, dispatches }, ... };
  }
}
```
Kardeş akış aynı deseni **yazılı olarak** kabul ediyor, bu akış etmiyor:
```ts
// Teks-Erp/src/services/subcontractor.service.ts:1587-1589 (transferToNextFason başlığı)
// Her iki çağrı AYRI tx (dispatchFirstStep kısmi-başarı emsali): 2. patlarsa
// toplar boyahane adımında bekler, planlamacı "Sevk Et" ile tamamlar.
```
- **Koruma yok teyidi:** döngüde `try/catch` yok → ilk hata fonksiyondan fırlar; `failed[]`/`partial` alanı yanıt sözleşmesinde yok; commit edilmiş sevkleri geri alan bir telafi yok.
- Kesilme penceresi yine `server.ts:150-154` (5 s) + `ecosystem.config.js:57` (1G OOM).

**failure_mode.** Beş partilik bir adım "ayrı ayrı sevk et" ile gönderilir. Üçüncü partide bir top araya giren bir okutmayla `AT_SUBCONTRACTOR` olmuştur → `dispatch`'in atomik claim'i 409 verir → istisna yukarı fırlar. Sonuç: **iki parti gerçekten sevk edilmiştir** (iki FS numarası, iki basılabilir fason çeki, topları `AT_SUBCONTRACTOR`), ekranda ise "sevk yapılamadı" yazar. Operatör listeyi yeniler, kalan üç partiyi yeniden sevk eder ve ilk ikisini **görmediği** için kamyona iki çeki eksik verir; ya da tersine, ikinci denemede sistem "bu adımda sevk edilecek bekleyen top yok" (`:1513-1520`) der ve operatör hiç sevk olmadığını sanır. Aynı senaryonun altyapı versiyonu: döngünün ortasında `pm2 restart`/OOM → aynı yarım durum, üstelik hiçbir hata mesajı bile yok.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: aynı `stepId` için aynı dakika içinde oluşmuş ≥2 `subcontractor_dispatches` satırı olup ilgili istekte hata döndüğü audit'ten anlaşılanlar (`system_logs` `SUBCONTRACTOR_DISPATCH` olayları + zaman kümelenmesi).

**İş etkisi.** Fiziksel mal ile kâğıt ayrışır (mal fasonda, çeki basılmamış / iki kez basılmış); fason firma mutabakatı bozulur.

**Öneri (2. tur için).** Döngüyü `try/catch` ile sar, `{ dispatched: [...], failed: [{ batchId, reason }] }` döndür ve panelde parçalı sonucu göster (kurşun dağıtımın `failed[]` deseni bu repoda zaten var ve kullanıcı tarafından kabul edilmiş). Ek olarak `transferToNextFason`'daki gerekçe notunun ikizini buraya da yaz — parçalılık **bilinçli** olacaksa yazılı olmalı. Migration/izin YOK.

**Kabul kriteri.** Üçüncü partide zorla hata üretildiğinde uç 200 döner, gövde iki başarılı + bir başarısız partiyi listeler, panel bunu gösterir. Bekçi: `scripts/test_fason_partial_receive.ts` komşusu yeni bölüm; negatif sonda `try/catch` kaldırılınca kırmızı.

---

### [E-3-08] Toplu etiket (2000 top tavanı) tek-process sunucuda CPU + bellek tepesi üretir; istemci 15 s'de vazgeçince tekrar basış işi ÇOĞALTIR ve 1 GB OOM restartına kadar gidebilir

| Şiddet | S2 | Kategori | H (performans/kaynak) + E3e | Öncelik | P3 | Modül | Etiket baskı | Kanıt seviyesi | K1 |

**Özet.** Toplu etiket uçları 2000 topa kadar kabul ediyor ve her top için senkron barkod/QR üretimi + (raster modda) glif çizimi yapıyor. Ekip event-loop açlığını gördüğü için 25 topta bir `setImmediate` ile nefes aldırıyor — bu doğru ve korunmalı. Ama **iş süresi hâlâ istemci bütçesinden kat kat uzun**, uçta bir uçuş guard'ı yok ve üretilen baytların tamamı bellekte biriktiriliyor. Operatör 15. saniyede "olmadı" görüp tekrar bastığında ikinci bir 2000'lik render **birincisiyle birlikte** koşar.

**Kanıt.**
```ts
// Teks-Erp/src/controllers/label.controller.ts:19  (ve :41)
rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top").max(2000),
```
```ts
// Teks-Erp/src/services/label.service.ts:1122-1136 (HTML yolu)
// F178: her top buildRollRenderInput içinde bwipjs.toSVG'yi (Code128+QR) 2 SENKRON
// çağırır → çok sayıda topta event-loop starvation (istasyon donması). ~25 topta bir
// setImmediate ile check fazına dön ...
if (++yielded % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
```
```ts
// Teks-Erp/src/services/label.service.ts:1170-1195 (native/raster yolu) — TÜM baytlar bellekte
const buffers: Buffer[] = [];
for (const id of ids) { ... buffers.push(renderedBytes(r)); if (++yieldedN % 25 === 0) await ...; }
return { ..., contentB64: Buffer.concat(buffers).toString("base64"), ... };
```
- Tek process: `ecosystem.config.js:47-48` (`fork`, `instances:1`) → CPU tepesi **tüm fabrikayı** yavaşlatır.
- Bellek tavanı: `ecosystem.config.js:57` `max_memory_restart: "1G"`.
- İstemci bütçesi 15 000 ms (`Electron/src/services/apiClient.ts:44`); bu uçta per-request override **yok**.
- Sunucu tarafında handler'ı kesecek hiçbir şey yok: `requestTimeout`/`headersTimeout` grep `src/server.ts`,`src/app.ts` = **0**; iş bitene kadar koşar ve yanıtı kimsenin dinlemediği sokete yazar.
- **Koruma yok teyidi:** bu uçlarda "zaten koşuyor" bayrağı, kullanıcı başına eşzamanlılık sınırı veya rate limit yok (grep `rateLimit` `src/routes/label.routes.ts` = 0).

**failure_mode.** Depo sorumlusu 1 200 toplu bir listeyi seçip "Hepsini Bas" der. Raster yolunda her etiket ~40-150 KB'lık bir bayt bloğu üretir **[VARSAYIM — birim boyut ölçülemedi, DB/yazıcı erişimi yok]**; `buffers[]` ~50-180 MB, `Buffer.concat` bir kopya daha, `toString("base64")` yaklaşık 1,33 katı bir **string** daha, `res.json` serileştirmesi + `compression` katmanı bir kopya daha → tek istekte yüz megabaytlar mertebesinde geçici bellek. Bu sırada panel 15. saniyede vazgeçer; operatör "yazıcıya gitmedi" deyip **tekrar basar** → aynı yük ikinci kez, birincisi hâlâ koşarken. İki (veya üç) eşzamanlı render `max_memory_restart: 1G` eşiğini aşarsa pm2 süreci **öldürür ve yeniden başlatır** — o anda uçuşta olan her istek (KK1 girişleri, Tambur kesimleri, yarım kalan çok-tx zincirleri: E-3-06/E-3-07) 5 saniyelik pencerede kesilir. Yani "etiket basma" işlemi, tek process invariantı yüzünden **fabrikayı yeniden başlatan** bir tetiğe dönüşür.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. Ölçüm reçetesi (2. tur, prod'da güvenli): `/api/admin/health` → `rssBytes`/`heapUsedBytes` zaman serisi + pm2 `restart_time` sayacı; ayrıca `system_logs`'ta `LABEL_PRINT` olaylarının kümelenmesiyle restart anlarının kesişimi.

**İş etkisi.** Vardiya ortasında sunucu yeniden başlar (~10-20 sn kesinti + uçuştaki yazmaların kaybı); etiket basımı hiç tamamlanmaz ve tekrar denemek durumu kötüleştirir.

**Öneri (2. tur için).** ① Tavanı gerçekçi bir sayıya indir (ör. 250) ve panelde "1 200 top → 5 parti hâlinde basılacak" diyen bir parçalama uygula — 2000 hiçbir zaman tek yanıtta taşınmamalı. ② Uçta **tek-uçuş guard'ı**: aynı kullanıcı/cihaz için koşan bir toplu render varken ikinci istek 409 `PRINT_JOB_IN_PROGRESS` (db-copy'nin `currentJob` atomik claim deseni birebir emsal — `db-copy.service.ts:373-405`). ③ Raster yolunda baytları biriktirmek yerine **akış** (chunked response) ya da en azından `contentB64` yerine binary gövde (base64 %33 şişme + ek kopya). ④ `server.requestTimeout` ayarla (ör. 120 s) — istemci gitmişse sunucu da vazgeçebilsin. Migration/izin YOK.

**Kabul kriteri.** 2000 toplu istek 400 (tavan) alır; koşan bir render varken ikinci istek 409 alır; 250 toplu render sırasında `/health.eventLoopLagMs` ve `rssBytes` ölçülüp kayda geçer. Bekçi: `scripts/test_label_bulk_limits.ts` (yeni).

---

### [E-3-09] Yazıcı çıktısı alındıktan sonra ağ koparsa `labelPrintedAt` yazılmaz — fiziksel etiket vardır, sistem "etiketsiz" der ve mükerrer paneli YANLIŞ topu "asıl" önerir

| Şiddet | S2 | Kategori | D (tx sınırı / dış dünya) + E | Öncelik | P3 | Modül | Etiket / mükerrer paneli | Kanıt seviyesi | K1 |

**Özet.** "Etiket basıldı" bilgisini yalnız istemci bildirir (`print-event`), fiziksel baskı **başarılı olduktan sonra**. Baskı ile bu bildirimin arasındaki ağ kesintisi kalıcı bir yalan bırakır: kumaşın üstünde barkodlu bir etiket vardır ama `Roll.labelPrintedAt` `null`'dır. Bu alan "ortada fiziksel etiket var mı" sorusunun tek cevabıdır ve mükerrer (hayalet top) paneli "asıl kayıt" önerisini **birebir** ona dayandırır.

**Kanıt.**
```ts
// Teks-Erp/src/services/label.service.ts:2075-2118  (recordPrintEvent — üç ayrı yazım, TX YOK)
await this.seedRollLabelSnapshot(rollId, userId, opts);      // ①
...
//   `labelPrintedAt` → "ortada fiziksel bir etiket VAR mı" (baskıda damgalanır,
//                       bir daha silinmez — kâğıt basıldıysa basılmıştır)
await prisma.roll.update({ where: { id: rollId }, data: { labelDirty: false, labelPrintedAt: new Date() } });   // ②
...
await AuditService.log({ ... event: "LABEL_PRINTED" ... });   // ③
```
Tüketici — "asıl" seçimi doğrudan bu alandan:
```ts
// Teks-Erp/src/services/duplicate-rolls.service.ts:210-213
// "Asıl" önerisi: etiketi basılan (en eskisi) → yoksa en eski kayıt.
const printed = rows.filter((r) => r.labelPrintedAt !== null);
const keep = (printed.length > 0 ? printed : rows)[0];
```
Diğer tüketiciler: `src/services/inventory.service.ts:2949,3347` (`labelPrinted` bayrağı — yeniden üretime alma ekranındaki "ölü etiket" uyarısı), `src/services/kartela.service.ts:1222-1227` (`labelPrintedAt: { not: null }` → etiket hiç basılmadıysa bayatlatma yapılmaz).
- **Koruma yok teyidi:** üç yazım tek tx'te değil (`prisma.` havuz client'ı, `$transaction` yok); baskı ile bildirim arasında bir "gönderildi ama onaylanmadı" durumu tutulmuyor; `print-event`'in kaybolduğunu tespit eden bir mutabakat yok (grep `labelPrintedAt` `scripts/consistency-check*.sql` = 0).

**failure_mode.** KK1'de operatör topu girer, etiket yazıcıdan **çıkar** ve kumaşa yapıştırılır; tam o anda tablet Wi-Fi'ı düşer (ya da sunucu `pm2 restart` alır) ve `print-event` isteği hiç varmaz. Sonuç: `labelPrintedAt = null`, `labelDirty = true`. Haftalar sonra mükerrer paneli o topu bir mükerrer kümesinde bulur; küme içinde etiketi basılmış görünen **başka** bir top vardır ve panel onu "asıl" olarak önerir → operatör, üstünde fiziksel etiket olan gerçek topu `MUKERRER` diye iptal eder ve sahada barkodu artık hiçbir kaydı olmayan bir etiket kalır. İkinci yüzey: "Yeniden Üretime Al" akışındaki **ölü etiket uyarısı** (kök `CLAUDE.md` 2026-08-25 notu, koşul: etiketli **ve** ilk adım fason) bu topta **hiç gösterilmez** — top eski barkodlu etiketiyle boyahaneye gider ve orada yeni barkodla döner.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: `SELECT count(*) FROM rolls WHERE barcode IS NOT NULL AND "labelPrintedAt" IS NULL AND status NOT IN ('CANCELLED','SCRAP');` ve bunların `system_logs`'ta `tableName='LABEL_PRINT'` izi olup olmadığı (audit satırı var + kolon null = ②'nin düştüğü an; audit yok + operatör basmış = ağ kaybı).

**İş etkisi.** Gerçek topun iptali (envanterde eksik metraj) + sahada sahipsiz etiket; fason sevkinde yanlış barkodlu etiketle mal çıkması.

**Öneri (2. tur için).** ① `seedRollLabelSnapshot` + `roll.update`'i **tek tx**'e al (audit dışarıda kalsın, best-effort sözleşmesi korunur). ② İstemci `print-event`'i **kuyruğa** alsın: baskı başarılıysa bildirim ağ dönene kadar saklanmalı (mobilde offline mutation altyapısı zaten var; masaüstünde küçük bir yerel kuyruk). ③ Mükerrer panelinin "asıl" önerisine ikinci bir sinyal ekle (`labelDirty=false` ∨ `system_logs` LABEL_PRINT izi) ve öneriyi "kesin" değil "aday" olarak sun. Migration YOK.

**Kabul kriteri.** `print-event` düştüğünde istemci onu yeniden gönderir ve `labelPrintedAt` dolar; `consistency-check`'e "barkodlu ama labelPrintedAt null" sayacı eklenir.

---

### [E-3-10] Sunucu saati GERİYE kayarsa gece yedeği sessizce atlanır — tek bir log satırı bile yazılmaz

| Şiddet | S3 | Kategori | I + J (kurtarma) | Öncelik | P4 | Modül | Yedekleme zamanlayıcısı | Kanıt seviyesi | K1 |

**Özet.** Yedek zamanlayıcısı "bu gece koştu mu?" sorusunu `son koşum damgası >= bugünün hedef saati` diye cevaplıyor. Sunucu saati bir gün (veya daha fazla) **geriye** alınırsa (ölü RTC pili sonrası NTP düzeltmesi, elle tarih/saat müdahalesi, sanal makine snapshot geri yükleme), damga gelecekte kalır ve koşul her turda sağlanır: yedek, saat gerçek zamana yetişene kadar **hiç alınmaz** ve bu durum hiçbir yere yazılmaz — `return` sessizdir.

**Kanıt.**
```ts
// Teks-Erp/src/jobs/backup-scheduler.ts:93-99
const dueAt = new Date(factoryDayStart(now).getTime() + hour * 60 * 60 * 1000);
if (now < dueAt) return;
const last = await getLastRun();
if (last && last >= dueAt) return;         // ← saat geriye kayarsa KALICI olarak burada durur, log YOK
// :100-102
// Damgayı ÖNCE yaz (retry spam'ini engeller — yukarıdaki gerekçe).
await setLastRun(now);
```
Sistemin bu risk sınıfının farkında olduğunun kanıtı (aynı riskin başka bir yerde çözülmüş hâli):
```ts
// Teks-Erp/src/services/backup.service.ts:66,314  (rotasyon)
// 'en yeni 3 korunur' — saat kayması sigortası  (RETENTION_MIN_KEEP = 3)
```
- **Koruma yok teyidi:** `getLastRun`/`setLastRun` çevresinde "damga gelecekte" kontrolü yok; `/health.lastBackup` yalnız **dosya**dan okur (`src/app.ts:432` → `latestBackupInfo()`), "beklenen ama gelmeyen yedek" diye bir kavram yok; yedek yaşına bakan bir eşik/alarm yok (bkz. E-3-11).
- **Sahadaki etki sınırlı:** `ecosystem.config.js:100` `BACKUP_SCHEDULE_ENABLED: "false"` — gece yedeğini bağımsız bir Windows Görev Zamanlayıcı görevi alıyor. Bu yüzden şiddet S3; ama scheduler'ı açan her kurulum (ve dev) etkilenir, ayrıca "harici görev de aynı makinenin saatine bakar" sorusu açıktır.

**failure_mode.** Sunucunun CMOS pili ölür; makine 2026-08-29'da açılırken saati 2026-08-24 gösterir, sonra NTP düzeltir — ama bu arada `backup.lastRunAt` 2026-08-29 olarak yazılmıştır. Saat geri alınmış bir makinede damga **beş gün ileridedir**: beş gece boyunca `last >= dueAt` doğru kalır, `runIfDue` her 15 dakikada bir sessizce döner, `BACKUP_FAILED` audit'i yazılmaz (çünkü iş hiç başlamaz), `/health.lastBackup` beş gün önceki dosyayı gösterir ve kimse bakmaz. Altıncı günde disk arızası olursa beş günlük üretim verisi gider.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: `SELECT value FROM system_settings WHERE key='backup.lastRunAt';` değeri `now()`'dan büyükse **fiili ihlal**.

**İş etkisi.** Felaket kurtarma penceresi sessizce genişler; "yedek alınıyor" varsayımı kanıtsız kalır.

**Öneri (2. tur için).** ① `last > now + 1 saat` ise damgayı **bozuk say**: uyarı logla, `reportJobFailure("backup", ...)` ile audit'e yaz ve damgayı `now`'a çek. ② `/health`'e `lastBackupAgeHours` ve eşik aşımında bir `warnings[]` girdisi (E-3-11 ile birlikte). Migration YOK.

**Kabul kriteri.** Damga geleceğe kurulduğunda scheduler bir sonraki turda uyarı yazar ve yedeği alır; bekçi `scripts/test_backup.ts`'e "gelecekteki damga" bölümü (negatif sonda: kontrol kaldırılınca test kırmızı).

---

### [E-3-11] `/health` `status` alanı SABİT `"UP"` — DB düşükken, disk dolarken, havuz zaman aşımı alırken ve yedek eskiyken de "UP" der; hiçbir metrik bir HÜKME dönüşmüyor

| Şiddet | S3 | Kategori | I (gözlemlenebilirlik) | Öncelik | P4 | Modül | Sağlık ucu | Kanıt seviyesi | K1 |

**Özet.** `/health` zengin ve iyi düşünülmüş bir metrik seti sunuyor (havuz, disk, presence, audit hataları, offsite, mDNS, kaynak kullanımı). Ama tek "hüküm" alanı olan `status` **derlenmiş bir sabit**: hiçbir koşula bağlı değil. Yani ucu bir izleme sistemine bağlayan biri "yeşil" görürken DB kopmuş, disk %99, havuz zaman aşımı almış ve son yedek on gün önce olabilir.

**Kanıt.**
```ts
// Teks-Erp/src/app.ts:398-402, 415-419   (zengin uç)
} catch { db = "DOWN"; }
const auditHealth = AuditService.getHealth();
return {
  status: "UP",                       // ← koşulsuz sabit
  message: "TeksERP API is running.",
  api: "UP",
  db,                                 // gerçek olan yalnız bu
```
```ts
// Teks-Erp/src/app.ts:479-493   (public uç — aynı sabit, üstelik HTTP 200)
} catch { db = "DOWN"; }
res.status(200).json({ status: "UP", message: "TeksERP API is running.", api: "UP", db, ... });
```
Ölçülen ama hükme dönüşmeyen alanlar (hepsi aynı yanıtta): `poolAcquireTimeouts`, `poolWaitingMax`, `auditWriteFailures`, `diskFreeBytes`/`diskUsedPct`, `lastBackup`, `dbBlockedCount`, `longestQuerySec`, `restoreCopyCount`, `auditGuard`, `discovery.mdns.reason`.
- **Hafifletici (dürüstlük payı):** bilinen iki tüketici `db`'ye **ayrıca** bakıyor — `deploy/kur.ps1:66` `if ($h.status -eq "UP" -and $h.db -eq "UP")` ve `Teks-Erp/public/status.js:100-104` `var apiUp = j.api === "UP" || j.status === "UP"; var dbUp = j.db === "UP";`. Yani DB düşüşü bu iki yüzeyde yakalanır. **Yakalanmayan:** disk, yedek yaşı, havuz zaman aşımı sayacı, audit yazım hataları, `auditGuard: "off"` — bunlar hiçbir yüzeyde bir alarma dönüşmüyor.
- **Koruma yok teyidi:** grep `warnings`/`degraded`/`threshold` `src/app.ts` sağlık bloğunda = 0; bu değerleri düzenli yoklayan bir iş yok (`src/jobs` altında sağlık kontrolü yok, `K8` envanteri de böyle diyor).

**failure_mode.** Yedek diski dolar (`BACKUP_DIR` %100). `pg_dump` başarısız olur, `BACKUP_FAILED` audit satırı yazılır, `/health.diskFreeBytes` neredeyse sıfırdır ve `lastBackup` günlerce eskir — ama `status` `"UP"`, HTTP 200. Fabrikada kimse `/health`'in JSON'unu okumadığı için durum ancak "geri yükleme gerektiğinde" fark edilir. Aynı körlük `auditGuard:"off"` için de geçerli (K8 haritası sahada kapalı olduğunu ölçmüş) ve `poolAcquireTimeouts>0` için de.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi.

**İş etkisi.** Ölçülen her şey ölçülmüş olarak kalır, kimseyi uyandırmaz; "sessiz ve alarmsız düzeltici" sınıfı (brief'in şiddet matrisinde bir kademe yükseltme sebebi) burada tersine işler: alarm hiç yoktur.

**Öneri (2. tur için).** `status`'u **türet**: `db==="DOWN"` → `"DOWN"`; aşağıdakilerden biri → `"DEGRADED"`: `diskUsedPct > 90` · `lastBackup` yaşı > 36 sa · `auditWriteFailures > 0` · `poolAcquireTimeouts > 0` · `auditGuard === "off"` · `discovery.mdns.reason !== "ok"`. Yanına makine-okur bir `issues: string[]` koy. ⚠️ **Public `/health`'in sözleşmesi DONDURULMUŞ** (`src/app.ts:470-477` — dört tüketici alan kümesine bağlı): orada `status`'u değiştirmek `kur.ps1`'in `Saglik` döngüsünü kırar → değişiklik **yalnız `/api/admin/health`'te** yapılmalı, public uç aynen kalmalı. Migration/izin YOK.

**Kabul kriteri.** Disk/yedek/havuz eşikleri sahte değerlerle aşıldığında `/api/admin/health.status === "DEGRADED"` ve `issues` sebebi adlandırır; `deploy/kur.ps1` ve `public/status.js` davranışı **değişmez** (public uç dokunulmamış). Bekçi: `scripts/test_observability_contract.ts`'e bölüm.

---

### [E-3-12] `pool.on("error")` yalnız konsola yazıyor — DB bağlantı düşmeleri hiçbir sayaca, audit'e ya da `/health`'e girmiyor

| Şiddet | S3 | Kategori | I (gözlemlenebilirlik) | Öncelik | P5 | Modül | Havuz | Kanıt seviyesi | K1 |

**Özet.** Boştaki bir bağlantı düşerse (ağ dalgalanması, DB restartı, sunucu tarafı timeout) havuz kendini onarıyor — bu **doğru** tasarım. Ama olayın tek izi `console.error`; pm2 log dosyasına düşer, o dosyanın rotasyonu ise varsayılan olarak yoktur. "Bu hafta DB bağlantısı kaç kez düştü?" sorusunun ölçülebilir bir cevabı yok.

**Kanıt.**
```ts
// Teks-Erp/src/lib/prisma.ts:75-82
// O3-2: pg Pool idle-client hata olayı. DB bağlantı düşürürse (network drop,
// server-side timeout, DB restart) dinleyici YOKSA Node yakalanmamış istisnaya
// çevirir → süreç çöker. Logla ama DÜŞÜRME ...
pool.on("error", (err) => {
  console.error("[prisma pool]: idle client hatası (bağlantı düştü, havuz kendini onaracak):", err);
});
```
Kıyas — aynı dosyadaki diğer iki olay ölçülüyor:
```ts
// Teks-Erp/src/lib/pool-health.ts:88-100
pool.on("connect", () => { connectsTotal += 1; });
pool.on("acquire", () => { if (pool.waitingCount > waitingMax) waitingMax = pool.waitingCount; });
```
- **Koruma yok teyidi:** `PoolHealth` arayüzünde (`src/lib/pool-health.ts:109-119`) bir `poolIdleErrors` alanı yok; `error` olayı `recordPoolTimeout`'a bağlı değil; `AuditService` çağrısı yok.
- Log rotasyonu: `ecosystem.config.js:67-70` yorumu — *"Rotasyonu pm2 kendisi YAPMAZ: pm2-logrotate modülü gerekir (runbook)."*

**failure_mode.** Fabrika switch'i arızalanır ve gün boyu saniyeler süren kopmalar yaşanır. Havuz her seferinde kendini onarır; operatörler ara sıra "sunucu hatası" görür (E-3-03 yüzünden 500). Teşhis anında sorulan "ağ mı, DB mi, uygulama mı?" sorusunun cevabı yalnızca ham pm2 log'unda, tarih damgasız bir yığının içindedir; `/health` metriklerinde `poolConnectsTotal`'in artışı dolaylı bir ipucu verir ama "düştü" ile "sessizlikten sonra ısındı" ayrımını yapamaz.

**Öneri (2. tur için).** `pool.on("error")` içinde `poolIdleErrors` sayacını artır (+ son hata metni/zamanı, `recordPoolTimeout` deseninin birebir ikizi) ve `getPoolHealth()`'e ekle. Audit'e yazma **gerekmez** (gürültü olur, ayrıca hata anında audit de aynı havuzu kullanır — mevcut `POOL_TIMEOUT` audit'inin bilinen zayıflığı). Migration YOK.

**Kabul kriteri.** Bağlantı zorla düşürüldüğünde `/api/admin/health.poolIdleErrors` artar. Bekçi: `scripts/test_pool_health.ts`'e bölüm.

---

### [E-3-13] Masaüstü güncelleme kapısı KOŞULSUZ — `minVersion` yükseltilir ve yayın sunucusuna erişilemezse panel çıkışsız kilitlenir; mobildeki koruma masaüstünde YOK, bekçi de yanlış sürümü ölçüyor

| Şiddet | S2 | Kategori | F + J (kurtarma) | Öncelik | P3 | Modül | İstemci sürüm politikası | Kanıt seviyesi | K1 |

**Özet.** Tablet tarafında bilinçli bir koruma var: kilit ancak düzeltme **gerçekten kurulabilir durumdaysa** kapanır, çünkü interneti kopuk bir cihazı kilitlemek çıkışı olmayan bir üretim durmasıdır. Masaüstünde aynı karar verilmemiş: `minVersion` politikası sağlanmıyorsa kapı, indirilecek paket **olmasa bile** açılıyor. Üstelik bunu engellemesi beklenen bekçi, sahadaki panelin değil **repodaki** panelin sürümünü ölçüyor.

**Kanıt.**

Masaüstü — kapı, paket olmadan da açılıyor:
```tsx
// Electron/src/components/layout/UpdateGate.tsx:63-67, 130
const hazir = status?.state === "ready";
const politikaKilidi = isBelowMinimum(status?.currentVersion, policy?.minVersion);
const kapiAcik = Boolean(status?.enabled) && (hazir || politikaKilidi);
...
const paketBekleniyor = politikaKilidi && !hazir;     // ← kilitli ekran, kurulacak bir şey YOK
```
Mobil — aynı sorunun çözülmüş hâli:
```ts
// mobil/src/services/clientPolicy.service.ts:107-119
// ⚠️ İnterneti kopuk bir tableti kilitlemek, güncellemeyi indiremediği için
// ÇIKIŞI OLMAYAN bir üretim durmasıdır ...
export function kilitlenmeliMi(args: { durum; duzeltmeHazir: boolean; bekleyenYazim: number }): boolean {
  return args.durum.eski && args.duzeltmeHazir && args.bekleyenYazim === 0;
}
```
Bekçi yanlış sürümü ölçüyor:
```ts
// Teks-Erp/scripts/test_client_policy.ts:59-63
// Kilitlenme senaryosu: minVersion panelden büyükse, en güncel panel bile ...
check("minVersion <= Electron package.json sürümü (kurtarılamaz kilit YOK)",
  cmp(ELECTRON_VERSION_POLICY.minVersion, panelSurum) <= 0, ...);
```
`panelSurum` = **repodaki** `Electron/package.json`. Ama deploy sırası "backend ÖNCE"dir (`Teks-Erp/CLAUDE.md`): backend gittiğinde sahadaki panel hâlâ eski sürümdedir. Yani bekçi, tam da korumak istediği anı ölçmez.
- **Bugünkü risk sıfır (ölçüldü, negatif kanıt):** `ELECTRON_VERSION_POLICY = { minVersion: "1.0.0", currentVersion: "1.0.0" }` ve `MOBIL_VERSION_POLICY` aynı (`Teks-Erp/src/config/client-version-policy.ts:89-92, 125-128`); `Electron/package.json` version = `1.0.0`. Yani `isBelowMinimum` bugün hiçbir panelde `true` olamaz. Bulgu **latent**: bir `minVersion` yükseltmesiyle etkinleşir.
- ⚠️ Aynı dosyada yorumlar **bayat** ("minVersion 2.8.1", "Bugünkü değer: 2.9.8") — sürüm sıfırlaması yorumlara işlenmemiş; `currentVersion: "1.0.0"` alanının vaat ettiği "sahadaki panel kaç sürüm geride" görünürlüğü de bu hâliyle yanlış bilgi verir.

**failure_mode.** Gerçek bir sözleşme kırılması olur ve `minVersion` 1.1.0'a yükseltilir; backend deploy edilir. O gün Cloudflare/VPS'e erişim kesiktir (proxy DNS-only'ye düşürülmüş, sertifika sorunu, ya da paket yanlış müşteri yoluna yüklenmiş — reçetede sayılan gerçek arıza modları). Sahadaki panellerin hepsi kapıyı açar, `state` asla `"ready"` olmaz, ekranda "paket bekleniyor" yazar, kapatılamaz ve **hiçbir hata gösterilmez** (`UpdateGate.tsx:48-52` — hata kapı KAPALIYKEN gizlenir; kapı açıkken gösterilir, ama burada gösterilecek bir hata da yoktur çünkü indirme hiç başlamamıştır). Fabrikanın masaüstü tarafı tamamen durur; kurtarma yolu sunucuya girip `minVersion`'ı geri çekip yeniden deploy etmektir.

**Veride fiili ihlal (K2).** Aranmadı; **negatif kanıt var** — bugünkü değerler kapıyı hiç açmıyor (yukarıda).

**İş etkisi.** Etkinleştiği gün fabrikanın büro tarafı tamamen durur; kendini kurtaramayan tek arıza biçimi (kök `CLAUDE.md` bunu açıkça yazıyor ama yalnız **yazıyor**).

**Öneri (2. tur için).** ① `UpdateGate`'e mobildeki koşulu taşı: `kapiAcik = enabled && (hazir || (politikaKilidi && indirilebilir))`; paket erişilemiyorsa kapı yerine **kalıcı kırmızı şerit** + hata metni (mobilin "uyarı kaybolmaz ama üretim durmaz" kararı). ② Bekçiyi doğru şeye bağla: `minVersion <= currentVersion` (yayınlanan sürüm) kontrolünü **repo sürümüyle değil** politika içindeki `currentVersion` ile ve ayrıca "minVersion, bir önceki yayınlanmış sürümden büyük olamaz" kuralıyla kur; ideali `minVersion` değişikliğini yayın script'inin doğrulaması. ③ Bayat yorumları ve `currentVersion`'ı gerçek sürümlerle eşitle. Migration/izin YOK; APK gerekmez, panel derlemesi gerekir.

**Kabul kriteri.** `minVersion` sahadaki sürümün üstüne çekilip güncelleme adresi erişilemez yapıldığında panel **kullanılabilir kalır** (şerit gösterir); bekçi bu senaryoyu ölçer.

---

### [E-3-14] Fason kabulünde barkod sayacı rezervasyonu transaction'ın İÇİNDE — 300 parça tavanında `F` tipi sayaç satırı tx boyunca kilitli kalır, Tambur kesim/finalize kuyruğa girer

| Şiddet | S3 | Kategori | A (eşzamanlılık / sayaç kilidi) | Öncelik | P5 | Modül | Fason kabul ↔ Tambur | Kanıt seviyesi | K1 |

**Özet.** Top barkodu bir sayaç satırından (`roll_barcode_counters`, anahtar `(gün, tip)`) `INSERT … ON CONFLICT DO UPDATE n = n + count` ile alınıyor. Bu bir **satır kilidi**dir ve alındığı andan transaction'ın commit'ine kadar tutulur. Fason kabulünde rezervasyon tx'in içinde yapılıyor; tavan 300 parça olduğu için kilidin tutulduğu pencere, o 300 satırın yazımı kadar uzayabiliyor. Aynı `F` sayaç satırını kullanan **her** Tambur kesimi/finalize'ı o süre boyunca bekler.

**Kanıt.**
```ts
// Teks-Erp/src/services/subcontractor.service.ts:3046-3050   (tx client'ı ile, tx İÇİNDE)
const reservedBorn = await reserveRollBarcodes(tx, "F", nextStep ? 0 : bornRollInputs.length);
```
```ts
// Teks-Erp/src/services/helpers/roll-barcode.helper.ts:82-88   (satır kilidi alan ifade)
INSERT INTO "roll_barcode_counters" ("day", "type", "n")
VALUES (${day}, ${type}, ${count})
ON CONFLICT ("day", "type") DO UPDATE SET "n" = "roll_barcode_counters"."n" + ${count}
RETURNING "n"
```
Ekibin aynı riski daha önce ölçtüğü not (helper'ın kendi başlığı, `:53-70`):
```
 *   sayaç tx İÇİNDE          → paralel istek **1345 ms** bekliyor
 *   sayaç tx AÇILMADAN ÖNCE  → **39 ms**  (34 kat), havuz 30/30 sağlıklı
 * ⚠️ **HAVUZ CLIENT'INI TX AÇIKKEN KULLANMA.** ... havuz (max 30) tükenir
```
Tavan: `Teks-Erp/src/controllers/subcontractor.controller.ts:156-167` `newRolls … .max(300)`.
Aynı `F` satırını kullanan diğer yollar: `src/services/helpers/roll-finalize.helper.ts:172`, `src/services/helpers/roll-disposition.helper.ts:296`, `src/services/workorder-batch-drop.service.ts:418`, `src/services/tambur.service.ts:906` (`reserveRollBarcodesInOrder`).
- **Bilinçli takas — bu yüzden S3:** helper başlığı, rezervasyonu tx dışına almanın **ikinci bir havuz bağlantısı** istediğini ve 30'luk havuzu tükettiğini ölçmüş; kabul kriteri açıkça iki koşullu ("T1 < 100 ms VE T2 = 30/30"). Yani bugünkü yerleşim bilerek seçilmiş. Bulgu, seçimin **300 parça tavanında ne olduğunun ölçülmemiş** olmasıdır.
- `KK1` ham girişi `H` tipini kullanır → farklı satır → **çekişme yok** (yanlış pozitif olurdu, elendi).

**failure_mode.** Boyahaneden 280 parçalık büyük bir teslimat kabul edilir. Kabul tx'i açılır, `F` sayacından 280 numara rezerve edilir ve satır kilitlenir; ardından 280 `roll` + hareket + sapma satırı yazılır. Bu 3-8 saniye sürerse (kaba tahmin; ölçülemedi) o pencerede Tambur'da kesim yapan operatörün finalize isteği **bekler**; tablet 10 saniyede vazgeçer ve "kayıt yapılamadı" der. Sınır durumda (tx 20 s tavanına yaklaşırsa) bekleyen Tambur istekleri de kendi 20 s bütçelerini yakar → **P2028 → 503 zinciri**: tek bir büyük fason kabulü, Tambur'da toplu 503 üretir.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi. 2. tur reçetesi: `subcontractor_receipts` başına kalem sayısı dağılımı (`max(items)`), ve `/health.dbBlockedCount` (`wait_event_type='Lock'`) zaman serisi.

**Öneri (2. tur için).** ① Tavanı düşür (ör. 100) — 300 parçalık tek kabul zaten operasyonel olarak şüphelidir. ② Ya da rezervasyonu tx'in **en sonuna** kaydır (bugün tx'in ortasında; kilidin tutulduğu süre yazımların yalnız kuyruğu kadar kalır) — havuz maliyeti YOK, çünkü hâlâ `tx` client'ı kullanılıyor. ③ Ölç: 300 parçalık kabulde kilit tutma süresi ve eşzamanlı Tambur gecikmesi. Migration/izin YOK.

**Kabul kriteri.** 300 parçalık kabul koşarken paralel bir Tambur finalize'ının beklemesi < 500 ms. Bekçi: `scripts/test_fason_partial_receive.ts` yanına eşzamanlılık sondası.

---

### [E-3-15] `mobil/app.json` sürümü 1.0.0, `build.gradle` `versionName` 2.9.9 — sürüm kapısının karşılaştırdığı değer belirsiz

| Şiddet | S3 | Kategori | F (istemci sözleşmesi) | Öncelik | P5 | Modül | Mobil paketleme ↔ sürüm politikası | Kanıt seviyesi | K1 |

**Özet.** Sürüm numaralarının 1.0.0'dan yeniden başlatılması `mobil/app.json`'a işlenmiş ama `android/app/build.gradle`'a işlenmemiş. İki değer ayrışmış durumda ve sürüm kapısı (`minVersion`) tabletin "kendi sürümü" olarak hangisini okuduğuna bağlı çalışıyor.

**Kanıt.**
- `mobil/app.json:5` → `"version": "1.0.0"`
- `mobil/android/app/build.gradle:95-96` → `versionCode 56`, `versionName "2.9.9"`
- Karşılaştırmayı yapan yer: `mobil/src/services/clientPolicy.service.ts:87` `if (surumKarsilastir(apkSurumu, politika.minVersion) < 0)` — `apkSurumu` çağıranın verdiği değerdir.
- Bilinen kırılganlık: kullanıcı hafızası *"APK derleme: sürüm eşitleme — `app.json` + `build.gradle` ELLE eşitlenir"*.
- **Bugünkü risk düşük:** `MOBIL_VERSION_POLICY.minVersion = "1.0.0"` (`Teks-Erp/src/config/client-version-policy.ts:125-128`) → hangi değer okunursa okunsun kapı açılmaz. Bulgu, bir sonraki `minVersion` yükseltmesinde etkinleşir; ayrıca "sürüm/güncellik her ekranda görünür" özelliği (son commit) hangi değeri basarsa bassın **diğerini yalanlar**.

**failure_mode.** `minVersion` 1.1.0'a çekilir. Tabletler `app.json` sürümünü (1.0.0) okuyorsa **hepsi** kapıya düşer (güncel APK dahil); `build.gradle` sürümünü (2.9.9) okuyorsa **hiçbiri** düşmez ve koruma hiç devreye girmez. İki sonuç da yanlıştır ve hangisinin geçerli olduğu koddan tek bakışta okunamaz.

**Öneri (2. tur için).** İki dosyayı eşitle ve eşitliği mekanik bir kapıya bağla (`mobil/scripts/` içindeki `build:apk:check` bu işi zaten yapmaya aday); `apkSurumu`'nun hangi kaynaktan geldiğini `clientPolicy.service.ts` başlığında yaz. **Bu bulgu backend değil mobil paketleme alanına aittir** — sınır ötesi olarak da not edildi.

---

## Uygulanan kontrol listesi

Görev tanımındaki E3a–E3i maddeleri madde madde:

| Madde | Durum | Nerede |
|---|---|---|
| **E3a** İstemci vazgeçti / sunucu commit etti; hangi uçlar 20 s'yi aşabilir | **uygulandı** | §0 bütçe tablosu (istemci 10/15 s < sunucu 20 s — asıl bulgu bu), E-3-01 (import), E-3-02 (fason kabul), E-3-05 (toplu renk düzeltme), E-3-08 (toplu etiket) |
| **E3a** `statement_timeout` 50 s ↔ 20 s tavanı ilişkisi | **uygulandı** | E-3-04 (+ E-3-03: 57014'ün 500'e düşmesi) |
| **E3a** merge 120 s > DB 50 s — sınırda ne olur | **uygulandı** | E-3-04 (tek ifade 120 s'yi asla kullanamaz; 200 000 eşiği yanlış tavana kalibre) |
| **E3a** token'sız uçlarda çift kayıt | **uygulandı** | E-3-01 (token var ama defter geç yazılıyor), E-3-02 (token her denemede yeni), E-3-07 (token'sız toplu sevk) |
| **E3b** 30 bağlantı / 5 s acquire → 503; kaç bağlantı | **uygulandı** | §0 tablosu + `pool-health.ts` okundu; **bulgu YAZILMADI**: `stats-batch` `.max(12)` (`inventory.controller.ts:98`), `backup-impact` `MAX_CONCURRENCY=6` (`:352`), `backup-impact` `allSettled` — üçü de bilinçli sınırlı, "Doğru yapılanlar"a yazıldı. Gerçek doygunluk kanıtı yok (canlıda tavana hiç yaklaşılmamış, `lib/prisma.ts:26-29`) |
| **E3b** tx içinde `Promise.all` (tek bağlantı) vs havuz client | **uygulandı — bulgu yok** | ESLint `no-restricted-syntax` kuralı `tx.*` üzerinde `Promise.all/allSettled`'ı yasaklıyor (`eslint.config.mjs:34-47`); "Doğru yapılanlar" |
| **E3b** `pool.on('error')` → uçuştaki istek | **uygulandı** | E-3-12 (uçuştaki istek etkilenmez — doğru; ölçülmemesi bulgu) |
| **E3c** DB restart / ağ kopması: P1001/P1017/'terminating connection' sınıflandırması, 503 vs 500 | **uygulandı** | E-3-03 (sürücü→ORM→HTTP zinciri kanıtla) |
| **E3c** yarım kalan çok-tx zincirleri; birinci commit, ikinci düştü | **uygulandı** | E-3-06 (`linkOrderLineWithOverride` ①②③), E-3-07 (`bulkDispatchStep` SEPARATE) |
| **E3d** pm2 restart/OOM (1G) uçuştaki isteklerle; 5 s zorla çıkış | **uygulandı** | E-3-05, E-3-06, E-3-07, E-3-08 (hepsinde kesilme penceresi kanıt olarak kullanıldı); §0 tablosu |
| **E3d** presence/latency/reason-cache/lockout sıfırlanması | **uygulandı — bulgu yok (kendi alanımda)** | `latency-persist` SIGTERM'de flush ediliyor (`server.ts:161-164`) — doğru; presence/feature-flag/reason-preset cache'i sıfırlanması zararsız (tek process invariantı, beceri §5 YP); **lockout sıfırlanması güvenlik alanına ait** → Sınır ötesi notlar |
| **E3e** yazıcı kapalı — KK1 girişi yine kaydolur mu; scan-back | **uygulandı** | Tasarım doğru ve yazılı (`label.service.ts:2069-2074`: yazıcısız niyet `seedRollLabelSnapshot`, "basıldı" demez; `kk1.labelScanVerifyEnabled` bayrağı bu boşluk için var). Bulgu **ağ kaybı** yolunda: E-3-09 |
| **E3e** print-event 500 | **uygulandı** | E-3-09 (tx'siz üç yazım + kaybolan bildirim); `MATRIX.md` K6 H-7 ile örtüşüyor |
| **E3e** sunucu tarafında raster CPU tepe | **uygulandı** | E-3-08 |
| **E3f** disk dolu: pg_dump / arşiv / log yazımı; BACKUP_DIR yok | **kısmen** | `BACKUP_DIR` yokluğu **açık hata** veriyor (`backup.service.ts:211-215,399-403`) — doğru, bulgu değil; `.part` + doğrulama + atomik rename zinciri sağlam (`:236-291`), "Doğru yapılanlar". **Bulgu:** disk-dolu/yedek-yok durumunun bir alarma dönüşmemesi → E-3-11. **Kapsam dışı kalan:** pg_dump öncesi boş-alan ön kontrolünün olmaması (db-copy'de var, `db-copy.service.ts:209-221`; yedekte yok) — failure_mode'u ölçemedim (disk metriği + gerçek dump boyutu gerekiyor), bilinçli olarak bulgu yazmadım, Sınır ötesi'ne bıraktım |
| **E3g** mDNS portu tutulu → ilan sessiz kapanır | **uygulandı — bulgu yok** | Fail-open bilinçli ve **ölçülebilir**: `getMdnsState().reason` `/health`'te (`app.ts:455-462`), `ecosystem.config.js:78-88` arıza modunu (Apple Bonjour/Adobe 5353'ü tutar) yazılı olarak anlatıyor, bekçi `test_discovery_advertiser.ts`. Tek eksik: kimse bakmıyor → E-3-11 kapsıyor |
| **E3h** saat geri alındı → günlük sayaç GGAAYY, mükerrer belge no | **uygulandı — mükerrer no bulgusu YOK** | `nextDailySeq` (`utils/code-format.ts:96-108`) numarayı **o günün mevcut kayıtlarından** türetir (`max+1`), saat geriye giderse o günün sayacından devam eder; ayrıca `@unique` + `withBarcodeRetry` (P2002) ikinci hat. Yani saat kayması mükerrer belge no üretmez — **arandı, yok**. `createdAt` sıralamasının tersine dönmesi Tur 2'nin ölçüm alanı (`audit/data/T2-V5-04-zaman-ters.sql`), tekrarlamadım |
| **E3h** saat kayması — diğer etkiler | **uygulandı** | E-3-10 (gece yedeği sessizce atlanır). `RETENTION_MIN_KEEP=3` zaten bu riskin sigortası (`backup.service.ts:66`) |
| **E3h** JWT nbf/exp | **uygulandı — bulgu yok** | Token aynı sunucu saatiyle imzalanıp doğrulanıyor (`auth.service.ts:366-374,386-389`), `clockTolerance` yok ama gerekmiyor (tek makine). Saat ileri sıçraması yalnız oturum ömrünü kısaltır → görünür 401, sessiz yanlışlık değil |
| **E3i** Cloudflare/güncelleme sunucusu erişilemez → fabrikayı kilitler mi | **uygulandı** | E-3-13 (masaüstünde EVET, latent; mobilde HAYIR — koşullu kilit doğru kurulmuş) |
| **E3i** `minVersion` > sahadaki sürüm | **uygulandı — bugün risk sıfır (negatif kanıt)** | Politika değerleri `1.0.0`; bekçinin yanlış sürümü ölçmesi E-3-13'te; mobil sürüm ayrışması E-3-15 |

**Uygulanamayan / kapsam dışı bırakılan:** aşağıdaki `## KAPSANMAYAN` bölümü.

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Havuz zaman aşımının çıplak `Error` olarak geldiğini KEŞFEDİP metin sözleşmesini teste bağlamak.** `src/lib/pool-health.ts:37-72` — üç birleşik kapı (`constructor === Error`, `code` yok, mesaj **tam** eşleşme) ve "pg yükseltmesi mesajı değiştirirse `null` döner, istek bugünkü davranışa düşer" kapalı-devre tasarımı. `scripts/test_pool_health.ts` kurulu pg-pool'dan **gerçek** hatayı üretip tanındığını doğruluyor. Bir kütüphane iç davranışına yaslanan kodun nasıl yazılacağının örneği.
2. **Yarım yedeğin nihai adı ALMAMASI.** `src/services/backup.service.ts:222-291`: `pg_dump` → `.part`, `pg_restore --list` ile doğrulama, ancak sonra aynı dizinde **atomik `rename`**. Dört ayrı listeleme yolu `.dump` ile bitmeyi şart koşuyor, yani "yarım ama taze görünen yedek" penceresi kapatılmış. Süreç dump ortasında ölürse (E3d) bayat `.part` `sweepStaleParts` ile budanıyor.
3. **Child process'lerin TEK kapıdan ve timeout+SIGKILL ile koşması.** `src/services/helpers/pg-tool.helper.ts:98-137` (varsayılan 3 sa, `killSignal:"SIGKILL"`, `close` olayında `timedOut` ayrımı). Asılan bir `pg_dump`/`rclone` bir daha "zaten koşuyor" kilidi kurmuyor; ayrıca `verifyBackupFile` kendi 30 s `Promise.race` bütçesini taşıyor (`backup.service.ts:107,121-124`).
4. **CPU-yoğun döngülerde event-loop'a nefes aldırmak.** `src/services/label.service.ts:1136,1194` — 25 topta bir `setImmediate`. Tek process invariantında bu, "bir kişinin toplu baskısı tüm istasyonları dondurmasın" demek; gerekçesi de yorumda yazılı (F178).
5. **Toplu iş genişliklerinin gerekçeli tavanları.** `inventory.controller.ts:89-98` (`stats-batch` `.max(12)` — "her kalem KENDİ aggregate'ini paralel koşar, bu sayı doğrudan eşzamanlı havuz checkout'u demek"), `backup-impact.service.ts:345-352` (`MAX_CONCURRENCY = 6` + `allSettled` → bir satırın 50 s timeout'u diğerlerini düşürmez, "ölçülemedi" olur), `subcontractor.controller.ts:167` (`.max(300)`), `label.controller.ts:19,41` (`.max(2000)`). Tavanın **yanına neden o sayı olduğunun yazılması** bu repoda bir standart — E-3-05'teki eksik tavan bu standardın istisnası.
6. **`tx.*` üzerinde `Promise.all` yasağının ESLint'e gömülmesi.** `Teks-Erp/eslint.config.mjs:34-47` — beceri paketinin §1(2) maddesini derleme kapısına çeviriyor; yorumda doğru/yanlış örnek de var.
7. **Kapanışta gecikme delta'larının flush edilmesi ve mDNS goodbye'ının PARALEL, tavanlı yapılması.** `src/server.ts:156-179` — iki bütçenin toplanıp 5 s'lik zorla-çıkış sayacını yakmaması bilinçli olarak yazılmış.
8. **Mobil güncelleme kilidinin KOŞULLU olması.** `mobil/src/services/clientPolicy.service.ts:107-119` (`duzeltmeHazir` + `bekleyenYazim === 0`) — "kilitlemenin bedeli çıkışsız üretim durmasıdır" kararı yazılı; E-3-13'ün önerdiği düzeltmenin şekli zaten burada duruyor.
9. **İstemci politikası ucunun PUBLIC ve fail-open olması.** `src/config/client-version-policy.ts:20-26` — projenin genel fail-closed eğiliminin gerekçeli istisnası; "kural yok" ile "kural okunamadı" ayrımı için tanımsız istemciye 404.
10. **`/health`'in havuz bölümünün DB DOWN iken de doğru cevap vermesi.** `src/app.ts:435-440` + `pool-health.ts:121-141`: senkron getter, sorgu yok, `try/catch` **dışında** — "havuz durumu tam o anda en çok gereken şeydir".

---

## Sınır ötesi notlar

- **(G — güvenlik)** Giriş kilidi (`login-lockout`) bellekte ve IP anahtarlı; her `pm2 restart` (deploy, OOM, `max_memory_restart`) sayacı sıfırlar. `K5` H5 bunu zaten kaydetmiş; buradaki **altyapı** katkısı: restart nadir bir olay değil, `max_memory_restart: 1G` + E-3-08'deki toplu etiket yükü onu **tetiklenebilir** kılıyor.
- **(I — gözlemlenebilirlik)** `POOL_TIMEOUT` audit'i, havuz zaman aşımı anında **aynı havuzu** kullanarak yazılmaya çalışılıyor (`error.middleware.ts:322-345` → `AuditService.logEvent`). Doygunluk anında bu yazımın da düşmesi beklenir; kalıcı iz yalnız bellek sayacında kalır ve o da restart'ta sıfırlanır (`pool-health.ts:25-27`). `MATRIX.md` K6 H-18 ile aynı olgu.
- **(I / J)** `pg_dump` öncesinde **boş disk ön kontrolü yok**; aynı proje `db-copy.service.ts:203-224`'te bunu yapıyor (`freeBytes < need` → engelle, ayrıca `< liveSize*2` uyarısı). Asimetri bilinçli mi, unutulmuş mu — ölçemedim (disk metriği + gerçek dump boyutu gerekiyor). J denetçisi bakabilir.
- **(J — migration)** `db-copy.service.ts:501,569,623,728` `statementTimeoutMs: 0` ile `pg_restore` koşuyor; E-3-04'ün "50 s tek ifade tavanı" tespitinin tersi yönde bir istisna. Geri yükleme yolunun tavansızlığı doğru olabilir ama aynı süre boyunca DB bağlantı bütçesini (E3b) tüketir.
- **(H — performans)** `express` sunucusunda `requestTimeout`/`headersTimeout`/`keepAliveTimeout` **hiç ayarlanmamış** (grep = 0). Node varsayılanları isteğin **alınmasını** sınırlar, handler'ı değil: istemci gittikten sonra da sunucu dakikalarca çalışabilir (E-3-05, E-3-08). Ayrı bir bulgu yazmadım (failure_mode'ları o iki bulguda somutlaştı) ama tek satırlık bir sertleştirme fırsatı.
- **(Mobil paketleme)** E-3-15: `app.json` (1.0.0) ↔ `build.gradle` `versionName` (2.9.9) ayrışması; ayrıca `Teks-Erp/src/config/client-version-policy.ts` içindeki yorumlar (2.8.1 / 2.9.8) değerlerle uyuşmuyor.
- **(B — idempotency)** `KartelaKabulScreen.tsx:445-451` `buildReceivePayload` **hiç `clientToken` taşımıyor** (fason kabulün kartela ikizi). Korumanın başka bir mekanizmayla (dispatch claim) sağlanıp sağlanmadığını doğrulamadım — B denetçisi bakmalı.
- **(A — eşzamanlılık)** `master-data-merge` advisory kilidi + 120 s tx: merge süresince o namespace'teki her işlem serileşir. E-3-04'ün önerdiği `SET LOCAL statement_timeout` çözümü kilit süresini **uzatır**; A denetçisinin kilit-süresi bakışıyla çapraz okunmalı.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **⚠️ VERİTABANI ERİŞİLEMEDİ — bu turun en büyük boşluğu.** `audit/tools/sql-dev.sh` ve `audit/tools/sql-saha.sh` ikisi de şu hatayla düştü (iki kez denendi, script'in kendisi ve `.env` okuması doğru):
   ```
   psql: error: connection to server at "localhost" (::1), port 5432 failed:
   FATAL:  Postgres.app failed to verify "trust" authentication
   ```
   Ortam arızası (Postgres.app'in oturum/izin sorunu), denetimin kuralları gereği başka bir bağlantı yolu **denenmedi**. Sonuç: bu dosyadaki **hiçbir bulgu K2 taşımıyor**; her bulgunun altında 2. tur için çalıştırılabilir bir SQL reçetesi bırakıldı. S0 hiçbir bulguda yazılmadı (K2/K3 şartı).
2. **Repro (K3) yapılmadı.** E-3 alanı sözleşme gereği repro istemiyor (görev tanımı: "repro yok — DDL/pg_dump/rclone/yazıcı çağırma"); ayrıca DB olmadan mümkün değildi. E-3-01 ve E-3-02 repro'ya **en uygun** iki bulgu: aynı `clientToken` ile 200 ms arayla iki `apply` / iki `receive` isteği.
3. **Ölçülemeyen büyüklükler.** Etiket başına raster bayt boyutu (E-3-08 aritmetiği `[VARSAYIM]`); 300 parçalık fason kabul tx'inin gerçek süresi (E-3-14); `apply-attribute-to-rolls`ın top başına gerçek maliyeti (E-3-05); 50 s'de taşınabilen merge satır sayısı (E-3-04). Hepsi 2. turda dev DB'de ölçülebilir.
4. **Canlı prod erişimi yok** (brief kuralı). `tekserp_saha_0825` kopyası da bu turda okunamadı. Sahadaki gerçek `statement_timeout`, `max_connections`, `pg_db_role_setting` içeriği ve `audit_guard` durumu **doğrulanamadı** — §0 tablosundaki 50 s değeri `docker-compose.yml` + `CLAUDE.md` beyanına dayanıyor (K8 haritası bunu 2026-06-12'de `pg_db_role_setting`'den doğrulamış olarak kaydediyor).
5. **Windows'a özgü davranışlar test edilemedi** (ortam darwin): pm2 IPC `shutdown` mesajının gerçekten `gracefulShutdown`'ı tetiklemesi, `kill_timeout 8000` ile `forceTimer 5000` etkileşimi, `max_memory_restart` tetiklendiğinde graceful mi hard-kill mi olduğu. E-3-05/06/07/08'in "kesilme" ayağı **kod okumasıyla** kuruldu; gerçek Windows davranışı doğrulanmadı.
6. **Yazıcı/dış dünya fiziksel testi yapılmadı** (kural). E-3-09 ağ kaybı senaryosu kod yolundan türetildi; gerçek bir PPLB/TCP kesintisiyle doğrulanmadı.
7. **Güncelleme sunucusu (Cloudflare/VPS) erişilebilirliği test edilmedi** — E-3-13 latent bir bulgu olarak yazıldı; bugünkü `minVersion: "1.0.0"` değeri kapıyı kapalı tutuyor (negatif kanıt repodan alındı).
8. **Diğer denetçilerin çıktıları okunmadı** (bağımsızlık kuralı). `audit/01-find/` altındaki tur1/tur2/tur3 dosyaları ve `audit/data/*.txt` sonuçları **açılmadı**; yalnız `audit/00-map/` haritaları ve `MATRIX.md`/`K8` referans olarak kullanıldı. Bu yüzden E-3-03'ün `MATRIX.md` K6 H-1 ile, E-3-09'un K9 H-7 ile örtüşmesi mümkündür — ikisinde de **sınır koşulu** (DB restartı / ağ kaybı anı) yeni bilgi olarak eklendi ve harita referansı bulgunun içinde verildi.
