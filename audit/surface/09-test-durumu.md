# 09 — Test Durumu Haritası (Teks-Erp backend)

> Bu bir **planlama** belgesidir, bulgu raporu değil. Amacı: denetimin nereye bakması
> gerektiğini belirlemek. Her sayı bir komut çıktısına dayanır; dayanmayanlar
> "tahmin" ya da "ŞÜPHELİ" olarak işaretlidir.
>
> Ölçüm tarihi: 2026-08-09. Repo HEAD: `ef49bbc3` (2026-08-06 19:40 +0300).
> **Test paketi KOŞULMADI** (salt-okuma görev; testler gerçek dev DB'sine yazıyor —
> bkz. §4). Koşulan tek şey salt-okuma kapılar: `tsc --noEmit -p tsconfig.scripts.json`
> ve `eslint src`.

---

## 0. Kapak sayıları

| Ölçü | Değer | Kaynak |
|---|---:|---|
| `scripts/*.ts` toplam | 312 dosya / 68.884 satır | `ls scripts/*.ts \| wc -l`, `wc -l scripts/*.ts` |
| `scripts/test_*.ts` (koşucunun aldığı) | **273 dosya / 61.498 satır** | `ls scripts/test_*.ts \| wc -l`, `wc -l scripts/test_*.ts` |
| Test dışı script (seed / fixture / backfill / tool) | 39 dosya / ~7.386 satır | fark |
| Toplam `check(...)` çağrısı (≈ assertion) | **5.223** | `grep -c "check(" scripts/test_*.ts \| awk` |
| `src/services/` dosya | 152 | `find src/services -name "*.ts" \| wc -l` |
| Testlerin **import ettiği** servis dosyası | 133 / 152 (%87) | statik + dinamik import taraması |
| `src/routes/` (+ `reports/`) | 47 + 7 = 54 | `ls` |
| `src/controllers/` | 22 | `ls` |
| HTTP katmanını gerçekten geçen test | **10 / 273 (%3,7)** | `grep -l "fetch(\|axios\|http://localhost"` |
| Hiç prisma'ya dokunmayan saf test | 25 / 273 | `grep -L "prisma"` |
| `finally` temizliği olmayan test | 36 / 273 | `grep -L "finally"` |

---

## 1. Koşucu: `scripts/run-all-tests.ts` (242 satır)

**Ne koşuyor:** `readdirSync(scripts/)` → `/^test_.*\.ts$/` regex'i → `.sort()` →
her biri için `spawnSync("npx", ["tsx", <dosya>])`. Yani **273 ayrı Node süreci**.
Opsiyonel `argv[2]` filtresi ile alt küme koşulabilir (`npm test -- <substring>`).

**Sıralı mı paralel mi:** **SIRALI** — dosyanın başındaki gerekçe açık:
*"testler aynı dev DB'sini paylaşır; her biri kendi business-key fixture'ını yaratıp
finally'de temizler. Paralel koşum fixture çakışması yaratabilir."*

**Tip kontrolü geçidi (satır 46-67):** Paketten ÖNCE `npx tsc --noEmit -p
tsconfig.scripts.json` koşar (~28 sn iddiası; ölçtüm: temiz ağaçta exit 0).
Tip hatası varsa **paket hiç koşmaz**. Tek test koşarken (filtre verilince) geçit
ATLANIR; kaçış kapısı `SKIP_TYPECHECK=1`. Gerekçe dosyada yazılı: 2026-08-01
denetiminde bu geçit **87 tip hatası** buldu ve hepsi o güne kadar YEŞİL test
olarak raporlanıyordu.

**Hata toleransı:**

| Durum | Davranış |
|---|---|
| Assertion hatası (exit != 0) | Kırmızı, **asla yeniden denenmez** |
| Altyapı hatası (`ECONNREFUSED`, `too many clients`, `timeout ... connect`, `Can't reach database server`) | **1 kez** yeniden denenir; geçerse `flaky` işaretlenir, exit kodunu düşürmez ama özet listede gösterilir |
| Zaman aşımı | Test başına **180.000 ms** (`PER_TEST_TIMEOUT_MS`); `error.code === "ETIMEDOUT"` |
| Çıktı taşması | `maxBuffer = 32 MiB`; taşarsa `ENOBUFS` — **`status: 0` döner**, bu yüzden `ok` şartı `status===0 && !res.error` |
| Sonuç | herhangi bir dosya kırmızıysa `process.exit(1)` |

**Koşucunun kendi bilinen tuzakları dosyada belgeli** (ve ilgi çekici): anormal
bitişte stdout'tan kazınan "N geçti, 0 başarısız" özeti YALAN söylüyordu; şimdi
anormal-bitiş sebebi kazınan özeti eziyor.

**Denetim notu:** Koşucu `test_` ile başlamayan test-benzeri dosyaları ALMAZ.
Ölçüm: `scripts/` altında `check(` içeren ama koşucunun almadığı 4 dosya var —
`smoke_fason_http.ts` (171 satır, HTTP smoke), `load_test.ts` (175, ayrı npm script),
`fixture-subcontractor.ts`, `fixture-test-user.ts`. Bunlardan **`smoke_fason_http.ts`
gerçek bir test ve pakete hiç girmiyor** (ayrıca CLAUDE.md'ye göre `admin`/`123123`
seed şifresine bağımlı, yani bu geliştirme DB'sinde zaten düşer).

**CI:** `.github/workflows/ci.yml` mevcut ve ciddi — postgres:16 service container,
`migrate deploy` → `seed` → `seed:fixtures` → `lint` → `tsc` (src) → `typecheck:scripts`
→ `npm test`. Ayrıca `continue-on-error: true` ile yük testi job'ı. Backend job'ı
düşerse log kuyruğu PR'a yorum olarak yazılıyor.

---

## 2. Test → modül eşleştirmesi (273 dosya)

Sınıflandırma dosya adı + import edilen servis üzerinden **otomatik** yapıldı
(`scratchpad/classify2.sh`); sınır vakalar tek bağlama atandığı için **±3 dosya
oynayabilir — yaklaşıktır**.

| Bounded context | Test dosyası | Not |
|---|---:|---|
| Etiket / raster / native dil (PPLA·PPLB·ZPL) | **37** | Kod hacmine göre en yoğun test alanı |
| Fason (subcontractor + fason sevk/kabul/doğrudan sevk) | **34** | |
| Üretim / İş Emri (WO yaşam döngüsü, manuel taşıma, hızlı WO, rota) | 30 | |
| Sistem / Ops (yedek, db-copy, migration, şema drift, invariant, latency, audit, hijyen bekçileri) | 28 | Çoğu **yapısal** bekçi |
| Yetki / oturum (auth, permission, session, login, mobil izinler) | 23 | |
| Sevkiyat / Çuval | 20 | |
| Belge / Refakat Kartı | 19 | Ağırlıklı **HTML string** doğrulaması |
| Master data / Cihaz (item·color·property·station·recipe·peripheral·device) | 18 | |
| Envanter / Top (roll, KK1, kat, kurtarma, finalize) | 18 | |
| Tambur | 12 | |
| Sipariş / Müşteri | 11 | |
| Parti (Batch) | 10 | |
| Kurşun / KK2 / bypass | 7 | |
| Rapor | **2** | `test_reports`, `test_report_day_boundary` |
| Kartela | **2** | `test_kartela_stock_and_ship`, `test_phase5_kartela_hardening` |
| İade | **2** | `test_iade_enhancements`, `test_return_bulk_group` |
| **Toplam** | **273** | |

Tam eşleme dökümü (test → import edilen servisler) üretildi; ihtiyaç olursa
`bash scratchpad/classify2.sh` ile yeniden üretilebilir. Örnek satırlar:

```
test_kursun_bypass      :: helpers/roll-step.helper, inventory.service, kursun-bypass.service,
                           kursun-qc.service, system-setting.service, tambur.service
test_shipment_undo_dispatch :: return.service, shipping.service, system-setting.service
test_fason_ceki_html    :: document-render/fason-ceki.fields, document-render/fason-ceki.html,
                           document-render/sample-data, system-setting.service
```

### 2b. Testlerin karakteri (dosya başlıklarından sayıldı)

| Etiket | Dosya |
|---|---:|
| Başlığında kendini "bekçi" diye tanımlayan | 31 |
| Somut bir **saha vakasına** atıf yapan (VAKA/saha bildirimi) | 13 |
| "negatif sonda ile kırmızı verdiği doğrulandı" yazan | 5 |
| "körlük zemini" (blindness floor) kuran | 8 |

Bu, test yazım kültürünün olay-güdümlü olduğunu gösteriyor: testlerin önemli
bir kısmı **bir üretim hatası olduktan sonra** o hatayı kilitlemek için yazılmış.

---

## 3. TERS TABLO — servis başına bekçi durumu

### 3a. En büyük servisler: public metot kapsamı

Yöntem: `export class` gövdesindeki metot bildirimleri çıkarıldı, `private`/`protected`
elendi, kalan her public metot adı `.<ad>(` deseniyle 273 test dosyasında arandı.
**Uyarı:** "adı geçiyor" ≠ "davranışı doğrulanıyor"; ve "adı geçmiyor" bazı
durumlarda dolaylı çağrıyla örtülü kapsanmış olabilir. Yani bu tablo bir
**üst sınır** (iyimser) kapsam ölçüsüdür — gerçek kapsam bundan düşüktür.

| Servis | satır | public metot | testlerde **hiç adı geçmeyen** | oran |
|---|---:|---:|---:|---:|
| `label.service` | 1.984 | 25 | **10** | %40 |
| `label-template.service` | 1.325 | 25 | 10 | %40 |
| `printed-document.service` | 739 | 10 | 4 | %40 |
| `permission-management.service` | 1.008 | 19 | **8** | %42 |
| `kartela.service` | 1.522 | 13 | **6** | %46 |
| `shipping.service` | 3.476 | 39 | **13** | %33 |
| `workorder.service` | 6.073 | 34 | **11** | %32 |
| `tambur.service` | 3.318 | 16 | 5 | %31 |
| `return.service` | 1.134 | 7 | 2 | %28 |
| `inventory.service` | 4.318 | 21 | 5 | %23 |
| `order.service` | 2.819 | 14 | 3 | %21 |
| `subcontractor.service` | 6.055 | 22 | 4 | %18 |
| `kursun-bypass.service` | 2.362 | 11 | 2 | %18 |
| `traveler-card.service` | 1.067 | 11 | 2 | %18 |
| `kursun-qc.service` | 1.656 | 12 | **0** | %0 |
| `tambur-manual.service` | 1.220 | 4 | 0 | %0 |

`system-setting.service` (2.839 satır) ayrı ele alınmalı — aşağıda §3c.
`batch.service` (975) sınıf değil düz `export function` kullanıyor: 9 fonksiyondan
**2'si hiç çağrılmıyor** (`assertBatchInWorkOrder`, `getBatchNumberState`).

### 3b. Testte HİÇ adı geçmeyen public metotlar (tam liste)

**`workorder.service` (11):**
`createManifest` · `generateWorkOrderNumber` · `getBatchTimeline` · `getCancelImpact` ·
`getManifest` · `getManifestById` · `getTargetPropertyChangeImpact` · `getTravelCard` ·
`listManifests` · **`updateStepPlanning`** · **`updateTargetProperties`**

> Son ikisi dikkat ister: kök `CLAUDE.md` bu iki metodu refakat kartını bayatlatan
> **9 çağrı noktasından ikisi** olarak sayıyor (`markTravelerCardDirtyTx`). Yani
> dokümantasyonda load-bearing ilan edilen bir yol, hiçbir testte adı geçmiyor.
> `getCancelImpact` de "yıkıcı işlemlerde detaylı onay zorunlu" kuralının
> önizleme ucudur.

**`shipping.service` (13):**
`addSacksToShipment` · `getDirectShipmentById` · `getDispatchNote` ·
`getShipmentSackContents` · `listOpenOrdersWithCoverage` · `listPool` ·
`listSackStoreBoard` · `moveRollToSack` · `removeSack` · `removeSackFromShipment` ·
`setDestination` · `setDispatchNote` · `setProcedureCode`

**`label.service` (10):**
`getPreviewHtml` · `getPreviewNativeText` · `getRollLabelPpla` · `getRollPreview` ·
`getSampleLabelHtml` · `getSwatchLabel` · `getSwatchLabelHtml` · `getSwatchLabelNative` ·
`printRollNative` · `updateOrderLineCustomerNames`

**`permission-management.service` (8):**
`deleteTemplate` · `getTemplate` · `getUserPermissions` · `listPermissions` ·
`listTemplates` · `resetUserPassword` · `updateTemplate` · `updateUser`

> `deleteTemplate` CLAUDE.md'de *"sistem rolü SİLİNMEZ, PASİFLEŞTİRİLİR — sert silme
> bir sonraki `pm2 restart`'ta DİRİLİŞ demekti"* diye anlatılıyor. `listPermissions`
> ise "N yetki hiçbir kullanıcıda yok" bandını besleyen `userCount`/`templateCount`
> alanlarının kaynağı. İkisi de testte adı geçmiyor.

**`kartela.service` (6):** `getDispatch` · `getReceipt` · `getReceiptCancelPreview` ·
`listReceipts` · `outstandingRolls` · `setRollMarkedForKartela`

**`tambur.service` (5):** `getPendingRolls` · `getRollForDecision` · `getSwatchByBarcode` ·
`getSwatchStats` · `listSwatches`

**`inventory.service` (5):** `createOpenFabric` · `getRescuePreview` · **`getRollHistory`** ·
`getRollStatsBatch` · `getWarehouseScope`

> `getRollHistory` = `GET /rolls/:id/history`, 2026-08-05'te yeni `roll:history` izniyle
> Electron'a açılan yaşam döngüsü bölümünün tek veri kaynağı.

**`order.service` (3):** **`cancelWithActions`** · `findAvailableForWorkOrder` ·
`getCoverageForLines`
**`subcontractor.service` (4):** (liste üretildi; hepsi private-dışı yardımcı okuma uçları)
**`kursun-bypass.service` (2):** `explainTamburScanBlock` · `getVisibility`
**`return.service` (2)** · **`traveler-card.service` (2)**

### 3c. Hiçbir testin import ETMEDİĞİ servis dosyaları (19 / 152)

| Dosya | satır | src içinde kim çağırıyor | Değerlendirme |
|---|---:|---|---|
| `workorder-split.service` | 711 | `workorder.service` | Dolaylı kapsam olası (`test_wo_branch_split`, `test_split_per_roll`) — **ŞÜPHELİ**, doğrulanmadı |
| `workorder-batch-drop.service` | 545 | `workorder.service` | `test_batch_drop` var ama WO servisi üzerinden çağırıyor |
| `helpers/batch-dispatch-surgery.helper` | 392 | `batch.service` | Dolaylı |
| `document-render/fason-ceki.density` | 283 | `fason-ceki.html` | `test_fason_ceki_html` dolaylı kapsar |
| `helpers/label-html-landscape.helper` | 260 | `label-html.helper` | Dolaylı |
| `helpers/allocation.helper` | 239 | `subcontractor` + `shipping` | Dolaylı |
| `helpers/workorder-clone.helper` | 235 | `workorder` + `workorder-split` | Dolaylı |
| `helpers/kursun-bypass-guard.helper` | 166 | 4 servis | Dolaylı |
| **`reports/subcontract.report.service`** | **161** | **yalnız `routes/reports/subcontract.routes.ts`** | **DOĞRUDAN KAPSAM YOK** — hiçbir tested servis onu çağırmıyor |
| `document-render/free-document.html` | 120 | `free-document.service` | `test_new_documents` dolaylı |
| `helpers/label-intent.helper` | 82 | `tambur*` | Dolaylı |
| `helpers/raster/raster-barcode` | 78 | `raster-canvas` | Dolaylı |
| `helpers/sack-invariants.helper` | 76 | 4 servis | Dolaylı |
| **`user-preference.service`** | **60** | **yalnız `controllers/user-preference.controller.ts`** | **DOĞRUDAN KAPSAM YOK** |
| `helpers/shipment-locks.helper` | 53 | `inventory` + `shipping` | Dolaylı |
| `helpers/subcontractor-cancel.helper` | 51 | `workorder` + `subcontractor` | Dolaylı |
| `helpers/station-capability-transfer.helper` | 36 | 3 servis | Dolaylı |
| `helpers/raster/raster-render` | 36 | `label*` | Dolaylı |
| `helpers/traveler-card-fanout.helper` | 35 | 4 servis | Dolaylı |

**Sonuç:** 19 dosyadan **2'si hiçbir yoldan ulaşılamıyor** (`subcontract.report.service`,
`user-preference.service`) — çünkü tek çağıranları route/controller ve hiçbir HTTP testi
o uçlara gitmiyor. Kalan 17'si tested bir servisten **transitif** olarak geçiyor
olabilir; bu **doğrulanmadı** ve satır-bazlı coverage aracı olmadığı için
doğrulanamaz (§8).

### 3d. Rapor katmanı

`src/services/reports/` altında 8 dosya var. `test_reports.ts` (466 satır)
6'sını import ediyor: `sales` · `customer` · `inventory` · `audit` · `quality` ·
`production` (+ `_shared`). **`subcontract.report.service` (161 satır) hiçbir testte
yok.** `report:*` altında 7 izin var, rapor için toplam **2 test** dosyası düşüyor.

### 3e. Katman kapsamı (routes / controllers / middlewares)

- **Controller katmanı:** 22 dosyadan yalnız **4'ü** herhangi bir testte import
  ediliyor (`auth`, `label-template`, `printed-document`, `traveler-card`).
- **Route katmanı:** 54 dosyadan **8'i** testte adı geçiyor.
- **Middleware:** 7 dosya / 1.067 satır. 10 test middleware import ediyor.
  `error.middleware.ts` **515 satır** (en büyük middleware, AppError + Prisma hata
  kodu + Zod → HTTP eşlemesi) — `test_check_violation_mapping.ts` ve `test_http_api.ts`
  bir kısmını geçiyor, ama kapsam ölçülmedi.
- **HTTP katmanını gerçekten geçen 10 test:** `test_http_api`, `test_direct_ship_api`,
  `test_quickstart_dispatch_api`, `test_mobile_item_permission`, `test_mobile_order_permission`,
  `test_tambur_manual_roll`, `test_tambur_manual_produce`, `test_latency_middleware`,
  `test_pool_health`, `test_fason_wrong_station_guidance`.
  Hepsi **kendi sunucusunu ayağa kaldırıyor** (`app.listen(0)`) — harici sunucu
  bağımlılığı yok, bu iyi.

> **Bu, `test_controller_binds.ts`'in doğuş hikâyesidir.** 2026-08-06'da
> `TravelerCardController.recordPrintEvent` `bind(this)` almamıştı; uç 2026-08-05'te
> eklendi ve **bir gün bile çalışmadı** (`this` undefined → her çağrıda 500). Testler
> servisi doğrudan çağırdığı için controller'ı hiç geçmiyordu ve TypeScript
> `this` kaybını göremez. Kapsam boşluğu **kanıtlanmış** durumda, teorik değil.

---

## 4. Testler gerçek DB'ye mi yazıyor? — **EVET, ve bu birinci sınıf risk**

| Ölçü | Değer |
|---|---:|
| `../src/lib/prisma` import eden test | **235 / 273** |
| Kendi `new PrismaClient()` kuran | 1 |
| Hiç prisma'ya dokunmayan saf test | 25 |
| Mock/stub/jest.fn/sinon geçen dosya | 13 (çoğu yorum ya da sahte `tx` objesi) |
| Testlerdeki `deleteMany` çağrısı | **1.539** (209 dosyada) |
| Testlerdeki `updateMany` çağrısı | 85 (46 dosyada) |
| `NODE_ENV`/production **guard'ı olan test** | **0** |

**Mock yok.** Test altyapısı bilinçli olarak "server'sız entegrasyon": servis sınıfı
+ prisma doğrudan import edilir, `DATABASE_URL` ne gösteriyorsa oraya yazılır.
Bugünkü dev hedefi: `postgresql://…@localhost:5432/adnansahin_db`.

### Neden risk

1. **Dev DB = fabrikanın canlı yedeği.** Kullanıcı belleğinde kayıtlı
   (`dev-db-prod-veriye-cekildi.md`, 2026-08-02): dev veritabanı gerçek fabrika
   verisine çekildi. Yani 273 test **gerçek üretim verisinin kopyası** üzerinde
   `create`/`update`/`deleteMany` koşuyor.
2. **Hiçbir ortam guard'ı yok.** 273 dosyanın hiçbirinde `NODE_ENV` kontrolü ya da
   "bu DB üretim mi" sorusu yok. `DATABASE_URL` yanlışlıkla saha sunucusunu
   gösterirse `npm test` **canlı fabrikaya** 1.539 `deleteMany` gönderir.
   Tek koruma **konvansiyon**: silme kararları `TEST-`/`TST-` kod önekine bakar.
3. **Yarım kalan koşum artık bırakır.** `scripts/clean_test_residue.ts`'in kendi
   başlığı bunu itiraf ediyor: *"koşucu 180sn'de SIGTERM gönderdiğinde `finally` bloğu
   HİÇ çalışmaz"* → `test_consistency` §18 kalıcı kırmızıya döner ve **gerçek bir
   mükerrer bulgusu bu gürültünün içinde kaybolur**; `TEST-SINV-*` toplar envanter
   ekranlarında hayalet stok olarak görünür.
4. **36 test `finally` bloğu taşımıyor.** Bunların 2'si gerçekten DB'ye yazıyor
   (`test_p2_infra.ts`, `test_peripheral_for_device.ts`) — kalan 34'ü saf render/
   yapısal test olduğu için sorun değil.
5. **Sessiz atlama.** 49 test "Seed fixture eksik" guard'ı taşıyor, 71 test metninde
   "atla/skip" geçiyor. Fixture eksikse test **yeşil kalıp hiçbir şey ölçmeyebilir**.
   Bu davranışın hangi testlerde exit 1, hangilerinde sessiz geçiş ürettiği
   **doğrulanmadı — denetimde bakılmalı**.

---

## 5. Testler ne ölçüyor: davranış mı, yapı mı?

**Her ikisi de, ve ayrım bilinçli.** Üç sınıf var:

### (a) Davranışsal entegrasyon (çoğunluk, ~230 dosya)
Gerçek servis + gerçek DB + gerçek transaction. Fixture yaratılır, iş akışı koşturulur,
DB durumu okunur. Örnek — `test_kk1_duplicate_guard.ts`: **5 eşzamanlı birebir giriş**
`Promise.allSettled` ile gönderilir, beklenen "1 geçer + 4×409". Advisory lock
silinince 3'ü geçtiği ölçülmüş.

Eşzamanlılık gerçekten ölçülüyor: **28 test** paralel çağrı yapıyor
(`Promise.all`/`allSettled`), **26 test** metninde "yarış/race/eşzamanlı" geçiyor.
Bu, bir Prisma projesinde beklenenin üstünde bir disiplin.

### (b) Yapısal / kaynak-tarayan bekçi (15 dosya)
`readFileSync` ile `src/` ya da `schema.prisma` okunur; 2'si TS AST kullanır
(`test_permission_catalog`, `test_raw_sql_hygiene`).

| Dosya | Ne doğruluyor |
|---|---|
| `test_controller_binds` | Bind deseni kullanan controller'da route'a çıplak geçilen her handler bağlı mı (regex tarama + körlük zemini) |
| `test_permission_catalog` | Kodda geçen izin kodları katalogda var mı (AST) + katalog ⊆ DB |
| `test_raw_sql_hygiene` | Ham SQL'de gerekçesiz çıplak `NOW()` var mı (AST) |
| `test_hard_delete_guard_coverage` | `schema.prisma` parse → yeni SetNull/Cascade ilişki guard allowlist'ine yazılmış mı |
| `test_db_invariants` | 26 partial index + 25 CHECK + 2 DEFERRABLE FK + 1 extended statistics envanteri (iki yönlü: envanter-dışı nesne de düşürür) |
| `test_schema_drift` | `migrate diff` ile repo datamodel ↔ canlı DB |
| `test_timestamptz_contract` | 4 cephe: DB'de tz'siz kolon yok · şemada `@db.Timestamptz` var · havuz oturumu UTC · iki yönlü sürücü turu |
| `test_migration_hygiene` | DB'de var/dizinde yok, pending, elle-resolve edilmiş migration |
| `test_report_day_boundary` | `src/` içinde `factoryDaySql` bypass eden elle `DATE_TRUNC('day'…)` kaldı mı |

Bu sınıfın kalitesi yüksek: 8 dosya kendine **körlük zemini** (blindness floor)
koyuyor — "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın diye
taranan öğe sayısına alt sınır konuyor.

### (c) Çıktı-metni (HTML/native) doğrulaması (~19 dosya)
Belge ve etiket testleri render edilen string'de `.includes()` arıyor. En yoğunları:
`test_fason_ceki_html` (115 `.includes`, 177 `check`), `test_doc_render_html` (84),
`test_traveler_card_fields` (38), `test_label_canvas_renderer` (35).

Örnek assertion (`test_fason_ceki_html.ts:126-140`):
```
check("slot 50 var (son slot)", hasSlot(html, 50));
check("slot 51 YOK (tek sayfa)", !hasSlot(html, 51));
check("tek grid tablosu", countOccur(html, '<table class="grid"') === 1);
```
Bu **kırılgan bir sınıf**: CSS sınıf adı ya da HTML yapısı değişince kırılır ve
kırılma "belge yanlış" değil "seçici eskidi" anlamına gelir. Zaten CLAUDE.md'de
bu sınıfa ait yakın tarihli bir "yanlış sebeple yeşil" vakası kayıtlı: düz
`includes(">100<")` metraj hücresinden de eşleşiyordu, varsayılan 50'ye indiği hâlde
test yeşil kalmıştı → `hasSlot` ile kesin eşleşmeye çevrildi.

---

## 6. `_e2e/` — **TERK EDİLMİŞ**

| Ölçü | Değer |
|---|---|
| Girdi | 22 dosya (20 `.ts`/`.mjs` + `FINDINGS.md` + `server.log`) |
| Kod satırı | 1.175 (`.ts` + `.mjs`) |
| Git durumu | **`.gitignore:18` ile yok sayılıyor** (`Teks-Erp/_e2e/`) — commit'li DEĞİL |
| Son değişiklik | `s_parti.ts` 2026-06-05; diğerlerinin tamamı **2026-06-01** |
| `package.json` / CI / CLAUDE.md referansı | **YOK** (grep: 0 eşleşme) |

İçerik: 2026-06-01'de HTTP API üzerinden gerçek isteklerle koşulmuş bir el yordamıyla
E2E seansı. `FINDINGS.md` (195 satır) o gün bulunan gerçek hataları anlatıyor
(SackStatus enum drift'i → boot engeli; fason rotasında WO'nun asla COMPLETED
olmaması). Bu bulgular **o zamandan beri düzeltilmiş** görünüyor (kök CLAUDE.md
2026-07-27 notu Tambur finalize'ın WO'yu `currentStep`'ten çözdüğünü söylüyor) —
ama düzeltmenin doğrulaması `_e2e` ile değil, `scripts/test_tambur_finalize_wo_guard.ts`
ile yapılmış.

**Değerlendirme:** `_e2e/` bir kerelik keşif seansının kalıntısıdır. 69 gündür
dokunulmamış, git'te değil, hiçbir otomasyona bağlı değil. Denetim açısından
**tarihsel belge** olarak değerli (`FINDINGS.md`), **koşan test** olarak sıfır değerli.
`server.log` (109 KB) da orada duruyor.

---

## 7. Typecheck ve lint durumu

### tsconfig

| | kök `tsconfig.json` | `tsconfig.scripts.json` |
|---|---|---|
| `strict` | **`true`** | miras (true) |
| `noEmit` | — (build eder) | `true` (yalnız doğrular) |
| `include` | `["src/**/*"]` | `["scripts/**/*", "prisma/**/*", "src/**/*"]` |
| `skipLibCheck` | `true` | miras |
| `target` / `module` | es2022 / commonjs | miras |

`strict: true` ama **`strict` alt bayraklarının hiçbiri açıkça sertleştirilmemiş**:
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` **hiçbiri yok**. Yani strict'in dışında kalan tip
delikleri açık.

**Ölçüm (2026-08-09, temiz ağaç):**
- `npx tsc --noEmit -p tsconfig.scripts.json` → **exit 0, 0 satır çıktı**
- `npx eslint src` → **exit 0, 0 satır çıktı**

**`any` kullanımı:** `src/` içinde kelime-sınırlı arama (`(:|<|as )\s*any\b`,
`anywhere`/`anyPrice`/`anyBinary` false-positive'leri elenmiş) → **0**.
`scripts/` içinde → **24**. `@ts-ignore` / `@ts-expect-error` → **0**.
`eslint-disable` yorumu → 6.

### eslint.config.mjs — çok dar, ve bu **kasıtlı**

Dosyanın kendi başlığı: *"Sadece işletme-kritik kuralları koruyoruz. Genel
stil/quality kuralları kasıtlı olarak devre dışı; bu config bir formatter değil,
bir guardrail."* `@typescript-eslint` plugin'i **yalnız `eslint-disable` yorumları
geçerli olsun diye** kayıtlı; kural setinden **hiçbir şey aktif değil**.

Toplam **2 kural** açık:

| Kural | Kapsam | Ne yakalıyor |
|---|---|---|
| `no-restricted-syntax` | `src/**/*.ts` | `Promise.all/allSettled` içinde `tx` identifier'ı (pg adapter tek bağlantı — perf kuralı 11) |
| `no-restricted-imports` | `src/routes/**`, `src/controllers/**` | `**/lib/prisma` import'u (katman ihlali) |

**Açıkça KAPALI olan tip disiplini kuralları:**

| Kural | Durum | Neden önemli |
|---|---|---|
| `@typescript-eslint/no-floating-promises` | **KAPALI** ve **teknik olarak imkânsız** | Type-aware kural; `parserOptions`'ta `project` YOK. Açmak için config değişikliği + tam program tipleme gerek |
| `@typescript-eslint/no-misused-promises` | KAPALI (aynı sebep) | `async` handler'ın `void` bekleyen yere geçmesi |
| `@typescript-eslint/require-await` | KAPALI (aynı sebep) | |
| `@typescript-eslint/no-explicit-any` | KAPALI | Bugün ihlal 0 ama **yalnız konvansiyon koruyor** (CLAUDE.md kontrol listesi) |
| `@typescript-eslint/await-thenable` | KAPALI (aynı sebep) | |
| `no-unused-vars` / TS karşılığı | KAPALI | |

**Floating promise heuristiği (ölçüm):** `src/` içinde bilinçli fire-and-forget
`void ` öneki 36 yerde; `.catch(() => {})` / `catch(() => null)` yutması **38 yerde**;
`AuditService.log(` 206 çağrı, bunlardan `await`/`void`/`return` almayan yalnız 1
(o da bir yorum satırı). Yani audit'in best-effort deseni disiplinli uygulanmış.
Ama **38 sessiz yutma** noktası, floating-promise kuralı olmadığı için tek tek
gözle doğrulanmış olmak zorunda — CLAUDE.md'de bu sınıfın ısırdığı en az bir vaka
kayıtlı (`.catch(() => {})` + yanlış ilişki adıyla `deleteMany` → temizlik hiç koşmadı).

### `eslint src` — scripts/ hiç lint edilmiyor

`npm run lint` = `eslint src`, config `files: ["src/**/*.ts"]`. Yani
**68.884 satırlık `scripts/` ağacı lint kapsamı dışında** — `tx` + `Promise.all`
yasağı da orada geçerli değil. (CLAUDE.md bunu kısmen meşrulaştırıyor:
`test_kk1_duplicate_guard`'daki `Promise.allSettled` **meşru**, çünkü beş ayrı tx var.)
`scripts/` yalnız `typecheck:scripts` ile korunuyor — o da 2026-08-01'de eklendi.

---

## 8. Ölçülemeyen / doğrulanamayan şeyler (denetim bunları varsayım olarak almasın)

1. **Satır/dal coverage rakamı YOK.** `c8`/`nyc`/`istanbul` kurulu değil, Allowed
   Packages listesinde de yok. §3'teki tablolar **metot adı** üzerinden yaklaşımdır.
2. **Paket şu anda yeşil mi bilinmiyor.** Testler koşulmadı (dev DB'ye yazacaklardı).
   CLAUDE.md "210/210" diyor ama o sayı **273 dosyadan önceki** bir döneme ait ve
   bayat. Denetimde `npm test`'in gerçek sonucu ölçülmeli — ama **izole bir DB'de**.
3. **Toplam koşum süresi bilinmiyor.** Test başına 180 sn tavan var; 273 süreç ×
   `npx tsx` başlatma maliyeti tek başına ciddi. Tahmin: 15-40 dk (ölçülmedi).
4. **Transitif kapsam doğrulanmadı.** §3c'deki 17 "dolaylı" satır bir varsayımdır;
   coverage aracı olmadan doğrulanamaz.
5. **Sessiz atlamaların sayısı bilinmiyor.** 49 test "Seed fixture eksik" guard'ı
   taşıyor; kaçının bu durumda exit 1 verip kaçının sessizce geçtiği sayılmadı.

---

## 9. TESTSİZ KALAN YÜKSEK RİSKLİ ALANLAR

Aşağıdaki sıralama **risk × kapsam boşluğu** ile yapıldı. Her madde denetimin
bakması gereken bir işarettir — bulgu değildir.

### R1 — Controller + route katmanı (en büyük yapısal boşluk)
22 controller'ın 18'i, 54 route dosyasının 46'sı hiçbir testte adı geçmiyor.
Servisler doğrudan çağrıldığı için `verifyToken` → `requirePermission` → Zod parse
→ `error.middleware` zinciri **273 testin 263'ünde hiç koşmuyor**. Kanıtlanmış
sonuç: `recordPrintEvent` bind hatası bir gün bile çalışmayan bir uç üretti ve
hiçbir bekçi görmedi (`test_controller_binds.ts` regex tarama ile kısmi kapatma).
Regex tarama `this` bağlamının **kaybını** yakalar, Zod şeması / izin kodu /
hata eşlemesi hatalarını yakalamaz.

### R2 — Test paketinin canlı-benzeri DB'ye yazması, ortam guard'ı olmadan
1.539 `deleteMany` + 85 `updateMany`, `NODE_ENV` guard'ı **0**, ve dev DB fabrikanın
gerçek verisinin kopyası. Ayrıca yarım kalan koşum artık bırakıyor ve bu artık
`test_consistency` §18'i kalıcı kırmızıya çevirerek **gerçek bir bulguyu gürültüde
boğabiliyor** (temizleyici script'in kendi başlığında yazılı). Denetim sorusu:
`DATABASE_URL`'in sahayı göstermesini engelleyen hiçbir mekanik bariyer var mı?

### R3 — Refakat kartı bayatlatma zincirinin iki ayağı testsiz
`WorkOrderService.updateTargetProperties` ve `updateStepPlanning` — kök CLAUDE.md'de
`markTravelerCardDirtyTx`'in 9 çağrı noktasından ikisi olarak sayılıyor, ikisinin de
adı 273 testte hiç geçmiyor. Aynı bölgede `getTargetPropertyChangeImpact` ve
`getCancelImpact` de testsiz — bunlar "yıkıcı işlemde detaylı onay zorunlu"
kuralının önizleme uçları.

### R4 — Sevkiyat servisinin okuma/yazma yüzeylerinin üçte biri
`shipping.service` 39 public metottan 13'ü testsiz; içlerinde `moveRollToSack`,
`addSacksToShipment`, `removeSackFromShipment`, `listPool`, `getShipmentSackContents`
var. Bunlar tam olarak `touchWarehouseSackTx` / `touchShipmentPlannedTx` /
`resetSackWeightsTx` guard'larının uygulanması gereken yollar (CLAUDE.md
kontrol listesi maddesi). Guard'ların **varlığı** kodda okunabilir, **doğru
uygulandığı** ölçülmemiş.

### R5 — Yetki yönetimi yazma yüzeyi
`permission-management.service` 19 public metottan 8'i testsiz: `updateUser`,
`updateTemplate`, `deleteTemplate`, `resetUserPassword`, `getUserPermissions`,
`listPermissions`, `listTemplates`, `getTemplate`. Bu, RBAC'ın **yönetim** tarafı —
bir hata doğrudan yetki sızıntısı ya da yetki kaybı demektir. `deleteTemplate`'in
"sert silme değil pasifleştirme" davranışı CLAUDE.md'de kritik ilan edilmiş
(aksi halde `pm2 restart`'ta diriliş) ama testte adı geçmiyor.

### R6 — Etiket servisinin önizleme + native baskı yolları
`label.service` 25 public metottan 10'u testsiz ve bunların çoğu **önizleme**
(`getPreviewHtml`, `getPreviewNativeText`, `getRollPreview`, `getSampleLabelHtml`)
ile **kartela etiketi** (`getSwatchLabel*` üçlüsü) ve `printRollNative`. Aynı
oran `label-template.service`'te de var (25'te 10). Sahada etiketin yanlış
basılması = yanlış malın sevki.

### R7 — Kartela bağlamı
Toplam **2 test dosyası**, `kartela.service` 13 public metottan 6'sı testsiz
(`getReceiptCancelPreview`, `listReceipts`, `outstandingRolls`,
`setRollMarkedForKartela`, `getDispatch`, `getReceipt`). Kartela ayrı bir WO'suz
akış ve `SwatchStockReduction` idempotency modeline sahip; kapsam bu hacme göre çok ince.

### R8 — Rapor katmanı
7 rapor izni + 8 rapor servisi için **2 test**. `subcontract.report.service`
(161 satır) hiçbir yoldan kapsanmıyor. Raporlar `$queryRaw` ağırlıklı (perf kuralı 8)
ve `factoryDaySql` saat dilimi kuralına bağlı — sessiz yanlışlanmaya en açık sınıf.

### R9 — `user-preference.service` ve genel olarak "yalnız controller'dan çağrılan" servisler
Tek çağıranı controller olan servisler tanım gereği transitif kapsam alamıyor.
Bugün 2 tane (`user-preference`, `subcontract.report`). Bu sayı, HTTP testi
yazılmadıkça yeni servislerle **büyümeye devam edecek** bir sınıftır.

### R10 — Belge/etiket HTML testlerinin kırılganlığı (ters risk)
19 belge testi string `.includes()` ile çalışıyor (`test_fason_ceki_html` tek başına
115 tane). Bu testler kırıldığında sinyal belirsizdir ("belge bozuldu" mu "seçici
eskidi" mi) ve **yanlış sebeple yeşil kalma** vakası zaten yaşanmış (`>100<`
metraj hücresinden eşleşiyordu). Denetim, bu sınıftaki assertion'ların
`hasSlot` gibi kesin eşleşmeye mi yoksa gevşek `includes`'a mı dayandığına bakmalı.

### R11 — Type-aware lint kuralları teknik olarak kapalı
`parserOptions.project` olmadığı için `no-floating-promises`, `no-misused-promises`,
`await-thenable`, `require-await` **açılamaz durumda**. Bir Prisma + transaction
ağırlıklı kod tabanında bu, en pahalı sessiz hata sınıfını (unutulmuş `await`)
tamamen insan gözüne bırakır. `src/` içinde 38 adet `.catch(() => {})` sessiz
yutma noktası var; CLAUDE.md'de bu desenin ısırdığı en az bir vaka kayıtlı.

### R12 — `scripts/` (68.884 satır) lint kapsamı dışında
`npm run lint` = `eslint src`. Test kodunun kendisi yalnız `tsc` ile korunuyor
(o da 2026-08-01'den beri). Testin kendi hatası "yanlış sebeple yeşil" üretir ve
2026-08-01 denetimi bunun 87 örneğini bulmuştu.

### R13 — `smoke_fason_http.ts` pakete hiç girmiyor
171 satırlık HTTP smoke testi `test_` öneki taşımadığı için koşucunun regex'ine
takılmıyor. Ayrıca CLAUDE.md'ye göre `admin`/`123123` seed şifresine bağımlı —
yani bu geliştirme DB'sinde koşsa bile düşer. **Ölü test.**

### R14 — `_e2e/` terk edilmiş, yerine geçen bir E2E yok
En yakın ikame `test_e2e_full_flow.ts` (62 assertion) ve o da servis katmanından
koşuyor, HTTP'den değil. Yani "tarayıcıdan/tabletten uçtan uca çalışıyor mu"
sorusunun otomatik cevabı **yok**.

---

## 10. Denetimin ilk bakması önerilen 6 nokta

1. `DATABASE_URL`'in üretimi göstermesini engelleyen mekanik bir bariyer var mı
   (R2). Yoksa bu, tek satırlık bir konfigürasyon hatasının fabrika verisini
   silmesi anlamına gelir.
2. `npm test`'i **izole/temiz** bir DB'de koş ve gerçek yeşil/kırmızı oranını,
   flake sayısını ve toplam süreyi ölç (§8-2, §8-3).
3. 49 "Seed fixture eksik" guard'ının kaçı sessiz geçiyor, kaçı exit 1 veriyor (R2/5).
4. `updateTargetProperties` / `updateStepPlanning` yollarında
   `markTravelerCardDirtyTx` gerçekten çağrılıyor mu (R3) — kod okumasıyla.
5. `shipping.service`'in testsiz 13 metodunda `touchWarehouseSackTx` /
   `touchShipmentPlannedTx` / `resetSackWeightsTx` guard'ları var mı (R4).
6. `parserOptions.project` eklenirse `no-floating-promises` kaç ihlal buluyor (R11) —
   bu tek ölçüm, sessiz hata riskinin büyüklüğünü sayıya çevirir.
