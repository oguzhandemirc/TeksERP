# D-I — Hata Yönetimi & Gözlemlenebilirlik (② BULMA, TUR 1)

Denetçi: **D-I** · Tarih 2026-08-28 · Dal `adnansahin`, HEAD `ce8681d1` · Mercek: kod merkezli (alan denetçisi + kritik yazma yolu 8-soru) · **SALT-OKUNUR** (hiçbir kaynak dosya değiştirilmedi; DB yalnız `audit/tools/sql-dev.sh` / `sql-saha.sh` ile okundu).

Ana girdiler: `K6-hata-yolu.md` (yutma tablosu, fire-and-forget, §7 bekçi boşlukları, H-1…H-22), `K8-zamanlanmis-isler.md`, `K9-entegrasyon.md`, `K11-bekci-envanteri.md`, `K12-onceki-denetim-uzlastirma.md`, `SINIR-OTESI-YONLENDIRME.md` §I, `Teks-Erp/scripts/consistency-check*.sql`. Beceri paketi `express-api-audit` §9 (yanlış pozitif kataloğu) bulgu yazılmadan önce okundu; §5 (tek-process = bulgu değil), §3.2 (`updateMany` count sınıflandırması), §6 YP (metrik toplayıcı ≠ scheduler), §7.8 (altı guard kaynağı) uygulandı.

**Kategori kısaltmaları** (prompt Bölüm 3-I maddeleri, satır 634-647):
| Kod | Madde |
|---|---|
| I.1 | Yutulan hatalar; `null`/boş dizi dönüşü — çağıran "veri yok" sanıyor mu |
| I.2 | Rollback sonrası yan etkiler geri alınabiliyor mu (kâğıt, dosya, DDL) |
| I.3 | Korelasyon id (request id) uçtan uca taşınıyor mu |
| I.4 | İzleme ve alarm; cron'un ÇALIŞMADIĞI fark ediliyor mu (sessiz başarısızlık) |
| I.5 | Mutabakat işleri var mı, sonucu izleniyor mu |
| I.6 | 5xx sınıflandırma sözleşmesi ↔ istemci davranışı; log içeriği/rotasyon/kişisel veri |

**Her bulguda "kim, ne zaman fark eder" sorusu cevaplandı** (görev şartı). Bu denetimin tek cümlelik özeti şudur ve ölçülmüştür: **arıza kaydı iyi, arıza BİLDİRİMİ yok.** Sunucu doğru satırı doğru deftere yazıyor; o defteri okuyan otomatik hiçbir mekanizma yok. Ölçülmüş çapa: `POST /api/traveler-cards/:id/print-event` sahada **2026-08-05 11:09 → 2026-08-06 18:37 arası ~31,5 saat** boyunca 500 verdi, `system_logs`'a **15 satır** `SYSTEM/ERROR recordId='TypeError'` düştü; düzeltme (`ef49bbc3`, 2026-08-06) **operatör şikâyetiyle** geldi, defter okunarak değil.

---

## BULGULAR

### [D-I-01] `/api/admin/health`'e "görünsün diye" eklenen dört sessiz-arıza dedektörünü hiçbir istemci çizmiyor — audit değiştirilemezlik koruması sahada KAPALI ve bunu gösterecek yüzey yok

| Şiddet | S2 | Kategori | I.4 | Öncelik | P3 | Modül | OPS/CORE | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Backend `buildRichHealth`'e, her biri kendi yorumunda "bu unutulabilir bir ops adımıdır / bu, sahada hiç çalışmadığının TEK ölçülebilir kanıtıdır" gerekçesiyle eklenmiş alanlar var: `auditGuard`, `restoreCopyCount/Bytes`, `discovery.mdns.reason`, `rollsDeadPct`, `longestQuerySec`, `lastAuditError`. Electron'un sağlık tipi (`HealthResponse`) bu alanların **hiçbirini içermiyor** ve mobilde de geçmiyor. Yani "kalıcı yüzey" olarak tasarlanan mekanizmanın yüzeyi hiç mount edilmemiş: değer üretiliyor, HTTP'de dönüyor, kimse bakmıyor. Ölçüldü: audit tamper koruması **fiilen kapalı**.

**Kanıt**
- `Teks-Erp/src/app.ts:371-378` — `coalesce(current_setting('teks.audit_guard', true), '') AS audit_guard` + yorum: *"Koruma ortama özgü bir ops adımıyla açılır, yani UNUTULABİLİR — ve unutulduğunda hiçbir yerde görünmezdi. Tek atımlık boot uyarısı yerine kalıcı yüzey: bu satır."*
- `Teks-Erp/src/app.ts:379-383` — `restoreCopyCount/copy_bytes` + yorum *"Unutulmuş geri yükleme kopyaları disk yer: ServerStatus'un mevcut 5sn poll'unda görünsün diye buraya eklendi"*.
- `Teks-Erp/src/app.ts:453-462` — `discovery.mdns` + yorum *"'yazdık ama sahada hiç çalışmadı'nın TEK ölçülebilir kanıtı"*; `Teks-Erp/ecosystem.config.js:95-97` aynı şeyi tekrar eder: *"Gerçekten çalışıp çalışmadığı TEK yerden ölçülür: GET /api/admin/health → discovery.mdns.reason === 'ok'"*.
- **Koruma kontrolü (nereye bakıldı):** `grep -rn "auditGuard" Electron/src mobil/src` → **0**; `grep -rn "restoreCopyCount|missingCount" Electron/src` → yalnız `OffsiteBackupCard.tsx:92` (o da başka uçtan, `/api/admin/backups/offsite`); `grep -rni "mdns" Electron/src` → yalnız keşif testleri + `ServerDiscoveryPanel.tsx:24` (istemcinin kendi tarama kaynağı etiketi, sunucu ilan durumu DEĞİL); `grep -rn "rollsDeadPct|longestQuerySec|lastAuditError" Electron/src mobil/src` → **0**.
- `Electron/src/pages/System/ServerStatus/serverHealth.ts:6-48` — arayüz başlığı bilerek *"Backend `/health` ucundan KULLANILAN alanlar (uç daha fazlasını döner)"*; listede yukarıdaki altı alanın hiçbiri yok.
- `Electron/src/pages/System/ServerStatus/serverHealth.ts:142-215` (`evaluateAlerts`) + `ServerStatusPage.tsx:179-243` (InfoRow'lar) — ne alarm ne bilgi satırı olarak geçiyorlar.

**failure_mode.** `SURUM-2.9.0 §7b`'deki `ALTER DATABASE ... SET teks.audit_guard='on'` adımı deploy'da atlanır → audit satırları UPDATE/DELETE'e açık kalır. `/api/admin/health` bunu `auditGuard:"off"` diye doğru raporlar, panelde hiçbir yerde çizilmediği için **kimse görmez**; koruma açıldı sanılır. Aynı kalıp mDNS'te: Windows'ta 5353'ü Bonjour tutar → ilan sessizce kapanır (`mdns.reason !== "ok"`), keşif yalnız alt-ağ taramasıyla yürür ve "mDNS çalışıyor" varsayımıyla teşhis edilen her kurulum sorunu yanlış yönde aranır.

**Veride fiili ihlal (K2).**
```sql
-- sql-saha.sh (tekserp_saha_0825) ve sql-dev.sh (adnansahin_db)
SELECT coalesce(current_setting('teks.audit_guard',true),'<null>');   -- ikisi de: <null>  (= "off")
SELECT d.datname, s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase;
--  adnansahin_db | {statement_timeout=50s,idle_in_transaction_session_timeout=5min}   → audit_guard SET satırı YOK
```
K8 aynı ölçümü bağımsız yapmıştı (K8 §HOTSPOT 4). ⚠️ Kopyada per-DB GUC'lar geri yüklenmez; **canlı prod için [VARSAYIM]** — ama `pg_db_role_setting` yerel kümede de boş ve `MEMORY.md`/`SURUM-2.9.0 §7b` adımı "ZORUNLU ops" olarak hâlâ açık listede.

**İş etkisi.** ISO 27001 A.8.15 (log değiştirilemezliği) fiilen devre dışı ve bunun görünür olması için yazılan mekanizma etkisiz. Geri yükleme kopyaları (`*_restore_*` DB'leri) diskte birikirse yalnız disk doluluk uyarısı %80'i geçince — yani sorun büyüdükten sonra — görünür.

**Kim, ne zaman fark eder?** Yalnız `curl http://sunucu:4000/api/admin/health | jq .auditGuard` yazmayı bilen biri, bunu yapmayı akıl ettiği anda. Pratikte: hiç kimse.

**Öneri (2. tur).** ① `HealthResponse`'a altı alanı ekle ve `evaluateAlerts`'e üç kural yaz: `auditGuard === "off"` → warn ("audit koruması kapalı — ops adımı atlanmış"), `restoreCopyCount > 0` → warn (adet + toplam boyut), `discovery.mdns.reason !== "ok"` → warn. ② Kalıcı kural: `/api/admin/health`'e alan eklerken bekçi, alanın **bir istemcide okunduğunu** mekanik doğrulasın (`Electron/src/pages/System/ServerStatus/serverHealth.test.ts`'e "payload anahtarı ↔ HealthResponse alanı" kapsama kontrolü). Migration/izin YOK, saf istemci + bir bekçi.

**Kabul kriteri.** `auditGuard:"off"` dönen bir sunucuya bağlanan panelde Sunucu Durumu sayfası kırmızı/sarı bant gösterir; yeni bir health alanı eklenip istemciye bağlanmazsa bekçi kırmızı verir. · **Efor:** 0,5 gün.

**Önceki defter.** Yeni. (`F-CORE-OPS-004`'ün akrabası: orada sayaç yolu kapatılmıştı, burada gösterim yolu eksik.)

---

### [D-I-02] Sağlık alarmlarının tamamı PULL: `evaluateAlerts` yalnız Sunucu Durumu sayfası açıkken koşar; SYSTEM/ERROR için hiçbir sayaç/kanal yok — ölçülen teşhis süresi 31,5 saat

| Şiddet | S2 | Kategori | I.4 | Öncelik | P3 | Modül | OPS | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Uyarı motoru (`evaluateAlerts`) iyi yazılmış (disk, RAM, event-loop, havuz doygunluğu, havuz zaman aşımı, audit yazım hatası, yedek bayatlığı — eşikleri gerekçeli). Ama tek çağıranı `ServerStatusPage`'dir: uyarı yalnız bir yönetici o sayfayı **açık tuttuğu sürece** vardır. Uygulamada global bant/rozet/bildirim yok, sunucuda e-posta/webhook/SMTP/Slack **hiç yok** (`grep -rniE "nodemailer|smtp|sendmail|webhook|slack|telegram" Teks-Erp/src` → **0 vuruş**). Ayrıca `SYSTEM/ERROR` satır sayısı hiçbir sağlık alanında yok: 5xx patlaması `auditWriteFailures`'a da havuz sayacına da düşmez.

**Kanıt**
- `Electron/src/pages/System/ServerStatus/serverHealth.ts:142-215` — `evaluateAlerts` tanımı; `grep -rn "evaluateAlerts" Electron/src` → yalnız `ServerStatusPage.tsx:65` (+ kendi testi). Başka tüketici **yok**.
- `Teks-Erp/src/app.ts:338-466` — `buildRichHealth` dönüşünde 5xx/hata sayacı **yok** (`auditWriteFailures` audit YAZIM hatasını sayar, uygulama hatasını değil).
- `Teks-Erp/src/middlewares/error.middleware.ts:614-633` — dal 9 audit yazar (`recordId = err.name`), ama yazdığı yeri okuyan bir eşik yok.
- `Teks-Erp/src/jobs/job-failure.ts:34-54` — `JOB_FAILED:<job>` SystemLog'a yazılır; `grep` ile bu recordId'yi okuyan bir alarm/sağlık alanı **yok**.

**Veride fiili ihlal (K2).**
```sql
-- sql-saha.sh (prod kopyası, 2026-08-25)
SELECT min("createdAt"), max("createdAt"), count(*) FROM system_logs WHERE category='SYSTEM' AND action='ERROR';
-- 2026-08-05 11:09:13+03 | 2026-08-06 18:37:03+03 | 15      (hepsi recordId='TypeError')
SELECT date_trunc('hour',"createdAt"), count(*) ... ;
-- 08-05 11:00 → 2 · 08-06 13:00 → 4 · 08-06 16:00 → 7 · 08-06 18:00 → 2
```
Düzeltme commit'i `ef49bbc3` (2026-08-06): *"fix(belge): refakat kartı 'basıldı' bildirimi 500 veriyordu — controller bind'ı eksikti"*. Yani **defter 15 kez bağırdı, 31,5 saat kimse duymadı; olay operatörün şikâyetiyle kapandı.**
Ayrıca: `JOB_FAILED:*` prod'da **0**, `BACKUP_FAILED` prod'da **0**, `POOL_TIMEOUT` prod'da **0** — yollar hiç tetiklenmediği için "alarm çalıştı mı" sorusu canlıda hiç sınanmamış.

**failure_mode.** Bir uç bind hatası / şema drift'i / deadlock yüzünden 500 vermeye başlar. `system_logs`'a dakikada bir `SYSTEM/ERROR` düşer, `/api/admin/health` "UP" der (o alanların hiçbiri hata sayısına bakmaz), Sunucu Durumu sayfası — açılırsa — yeşildir. Teşhis, operatörün "bu düğme çalışmıyor" demesine kadar bekler; ölçülen gecikme 31,5 saat.

**İş etkisi.** Vardiya boyunca sessizce başarısız olan bir yazma ucu (etiket bildirimi, print-event, tartı kaydı) ancak ertesi gün fark edilir; aradaki kayıtlar geri getirilemez (kâğıt basıldı, kayıt oluşmadı — bkz. D-I-06).

**Kim, ne zaman fark eder?** Operatör, ~1 iş günü sonra, şikâyet ederek.

**Öneri (2. tur).** ① `/api/admin/health`'e ucuz iki sayaç: `serverErrors5xx` (süreç-içi, `error.middleware`'in 500 dallarında artan) + `systemErrorsLast24h` (tek `count(*)` — `system_logs(category,action,createdAt)` index'i var). ② `evaluateAlerts`'e eşik (>0 warn, >10 crit). ③ **Push ayağı:** Electron'da global bir "sunucu uyarısı" rozeti (mevcut 5 sn poll'u paylaşabilir; ayrı istek gerekmez) — panel açık olan HER ekranda görünsün, yalnız Sistem hub'ında değil. ④ SMTP/webhook eklemek bu fabrikanın kapsamı değil (internet bağımlılığı) — panel rozeti yeterli ve bedelsiz.

**Kabul kriteri.** Yapay olarak 500 üreten bir uç 5 dakika koşturulduğunda panelin herhangi bir ekranında uyarı rozeti belirir; `system_logs` sorgusu ile rozet sayısı örtüşür. · **Efor:** 1 gün.

**Önceki defter.** `F-CORE-OPS-002/004` (kapandı — sayaç ve sınıflandırma yolu var); bu bulgu onların **tüketici** ayağıdır, aynı iddiayı tekrar etmez.

---

### [D-I-03] Mutabakat (tutarlılık) kontrolü canlıya karşı yalnız ELLE koşuyor; bugün prod verisinde iki bölüm kırmızı ve bunu söyleyen otomatik hiçbir şey yok

| Şiddet | S2 | Kategori | I.5 | Öncelik | P3 | Modül | OPS/URE | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** İki mutabakat dosyası (`consistency-check.sql` 19 bölüm + `consistency-check-derived.sql` §21-§26) ve mekanik ikizleri (`test_consistency.ts` §20 dahil, `test_consistency_derived.ts`) var — bu, sektör ortalamasının üstünde bir olgunluk. Ama ikizler `npm test` içinde **dev DB'ye** karşı koşar; canlı veriye karşı koşum, birinin `DATABASE_URL=<canlı> npx tsx scripts/test_consistency.ts` yazmasına bağlıdır. Zamanlanmış iş **yok** (`src/jobs`'ta üç periyodik iş var: arşiv, yedek, offsite — mutabakat yok), sonucu yazan bir yer **yok**, sonucu gösteren bir yüzey **yok**. Dosyanın kendi başlığı takvimi söylüyor: *"Ne zaman: 3 ayda bir veya şüphe anında"* — yani hatırlamaya bağlı.

**Kanıt**
- `Teks-Erp/scripts/consistency-check.sql:19-21` — *"Ne zaman: 3 ayda bir (ARCHITECTURE.md §10.2 ile) veya şüphe anında. Salt-okunur. Kullanım: psql <db> -f ..."*
- `Teks-Erp/scripts/test_consistency.ts:27` — *"asıl değeri orada (`DATABASE_URL=<canlı> npx tsx scripts/test_consistency.ts`)"* — canlı koşumun **elle** olduğunu kaynak kendi söylüyor.
- `Teks-Erp/src/jobs/` (9 dosya) — mutabakat işi yok; `grep -rn "consistency" Teks-Erp/src` → **0**.
- `Teks-Erp/scripts/run-all-tests.ts:102-165` `productionDbGate()` — paket canlıya karşı koşamaz (doğru koruma), dolayısıyla mutabakat da otomatik yolla canlıya hiç ulaşmaz.
- **Koruma kontrolü:** alarm kanalı yok (D-I-02 kanıtı), `/api/admin/health`'te mutabakat alanı yok, `audit.lastArchiveAt` benzeri bir "son mutabakat" damgası yok (`grep -rn "lastConsistency" Teks-Erp/src` → 0).

**Veride fiili ihlal (K2).** Bu denetimde iki dosyayı prod kopyasına karşı **ben koşturdum** (salt-okunur):
```
audit/tools/sql-saha.sh -f Teks-Erp/scripts/consistency-check.sql
  §1..§11, §14..§19  → 0 satır
  §12 (kapanmış movement'ta qtyOut <> qtyIn)      → 15 satır
  §13 (currentQty > initialQty)                    →  2 satır
audit/tools/sql-saha.sh -f Teks-Erp/scripts/consistency-check-derived.sql
  §21..§25, §26b → 0 satır ·  §26 (BİLGİ, kapı öncesi) → 4 satır
```
§13'ün 2 satırı, `CLAUDE.md` 2026-08-22 notunda tarif edilen `tambur-undo.applySingle` üretim dalı hatasının kalıntısıdır ve **bilerek düzeltilmemiştir** ("toplu UPDATE kök nedeni gizler"). §12'nin 15 satırı K2b'nin "fason kısmi kabul/çekme meşru mu" sorusuyla örtüşür (→ D-E/D-C).

**failure_mode.** `OrderLine.shippedQty` (DB seddi olmayan tek denormalize alan) yeni bir yazma yolundan kopar. Kopma hiçbir hata, hiçbir log üretmez — yalnız karşılanma/MRP rakamı yanlışlanır. §1 bunu yakalayacak sorguyu taşıyor, ama sorgu **hiç koşmadığı** için sapma, bir müşteri "eksik sevk ettiniz" diyene kadar yaşar. Aynı sınıf: §21 (WO tipi) 2026-08-21'de tam bu şekilde 13 iş emrinde bulunmuştu ve **denetimle** bulunmuştu, sistemle değil.

**İş etkisi.** Sedsiz türetilmiş alanların sessiz sapması ERP'de en pahalı hata sınıfıdır (yanlış açık sipariş, yanlış stok, yanlış karne). Tespit aracı var, tetikleyicisi yok.

**Kim, ne zaman fark eder?** Bir sonraki elle denetimde (son koşum tarihi kayıtlı değil — yani bilinmiyor) ya da müşteri şikâyetinde.

**Öneri (2. tur).** ① `src/jobs/consistency-scheduler.ts`: haftada bir (fabrika günü dışı saatte), **yalnız SAYIM** koşar (satırları değil `count(*)`leri) — `test_consistency.ts`'in bölüm listesi tek kaynak olarak paylaşılır. ② Sonuç iki yere: `SystemSetting consistency.lastRun` (+ bölüm başına sayı) ve sayı > 0 ise `reportJobFailure`-benzeri `SYSTEM/CONSISTENCY_DRIFT` audit satırı. ③ `/api/admin/health` → `consistency:{lastRunAt, redSections:[...]}`, `evaluateAlerts`'te warn. ④ **Bilinen kabul edilmiş kırmızılar için beyaz liste** (§13'ün 2 satırı, §26'nın 4 satırı) — yoksa kalıcı kırmızı, kırmızı körlüğü üretir (K2b H-11'in aynı sınıfı). Beyaz liste **satır kimliğiyle** olmalı, bölüm kapatarak değil. ⚠️ Salt-okunur iş; `[PROD'DA ÇALIŞTIRMA]` gerektirmez, migration yok (SystemSetting anahtarı yeterli).

**Kabul kriteri.** Kasten bozulmuş bir `shippedQty` satırı dev'de bir hafta içinde (ya da elle tetiklemede) `redSections` içinde görünür ve panelde uyarı üretir; beyaz listedeki 2 bilinen satır uyarı üretmez. · **Efor:** 1,5 gün.

**Önceki defter.** `DB-MIMARI-DENETIM.md` D-9 (dosya yazıldı — kapandı); bu bulgu D-9'un **koşum/izleme** ayağıdır.

---

### [D-I-04] Sorgu zaman aşımı (57014) ve deadlock (40P01) hiçbir dalda tanınmıyor: kullanıcıya "Sunucu hatası oluştu." (500) döner, mobil kuyruk onu 3 kez tekrarlar

| Şiddet | S2 | Kategori | I.6 | Öncelik | P3 | Modül | CORE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `errorHandler` geçici/yeniden-denenebilir DB arızalarını iyi ayırıyor: havuz zaman aşımı → 503 + `Retry-After`, P2028 → 503, **P2034 (SQLSTATE 40001, serialization failure) → 409 "tekrar deneyin"**. Ama `@prisma/adapter-pg`'nin SQLSTATE haritasında **40P01 (deadlock_detected), 57014 (statement_timeout), 25P03 (idle_in_transaction), 53300** yok; hepsi `default` dalından `kind:"postgres"` olarak çıkar ve ORM yolunda **çıplak `DriverAdapterError`** olarak yüzeye gelir → `error.middleware` dal 9 → **500 "Sunucu hatası oluştu."**. Yani birbirinin ikizi olan iki eşzamanlılık arızasından biri "tekrar dene" (409), diğeri "sunucu bozuk" (500) diyor.

**Kanıt**
- `Teks-Erp/node_modules/@prisma/adapter-pg/dist/index.js:455-549` `mapDriverError` — `case "40001": kind:"TransactionWriteConflict"` **var** (:513), `40P01`/`57014`/`25P03` **yok**; `default:` (541-549) `kind:"postgres"` döner.
- `Teks-Erp/src/middlewares/error.middleware.ts:355-380` `extractCheckConstraint` — yalnız `c.code === "23514"` ilgilenir; 57014/40P01 `null` döner.
- `Teks-Erp/src/middlewares/error.middleware.ts:517-523` (P2034 → 409) ↔ `:614-633` (dal 9 → 500). Aradaki hiçbir dal `err.cause.code`'a bakmaz.
- Zaman aşımı gerçek: `SELECT d.datname, s.setconfig FROM pg_db_role_setting ...` → `adnansahin_db | {statement_timeout=50s, idle_in_transaction_session_timeout=5min}` (yerel kümede ÖLÇÜLDÜ); `docker-compose.yml` ve `ARCHITECTURE.md` aynı değeri söyler.
- İstemci ikizi: `mobil/src/offline/mutations.ts:124-129` `stationRetry` → `if (status && status >= 400 && status < 500) return false; return failureCount < 3;` → **5xx üç kez denenir**; `mobil/src/offline/entryAttempt.ts:252-255` `isAmbiguousFailure` 5xx'i "belirsiz" sayar (doğru sözleşme, ama burada belirsizlik gereksiz üretiliyor).
- **Koruma kontrolü:** `grep -rn "57014|40P01|25P03|deadlock" Teks-Erp/src` → **0**; bekçi `scripts/test_pool_health.ts` yalnız pg-pool acquire/handshake hatasını ölçer, `test_check_violation_mapping.ts` yalnız 23514'ü.

**failure_mode.** ① *Deadlock:* iki tablet aynı anda parti taşıma + KK2 kapatma yapar (K3a'nın ABBA-1 adayı: `createBatchTx`/8022 ↔ `touchWorkOrderTx` sırası iki akışta ters). PostgreSQL birini 40P01 ile iptal eder. Kullanıcı **"Sunucu hatası oluştu."** görür — oysa doğru cevap 409 "tekrar deneyin"dir ve işlem ikinci denemede geçerdi. Audit'e `recordId='DriverAdapterError'` düşer, teşhis "hangi kural" bilgisi olmadan yapılır. ② *Zaman aşımı:* 50 sn'yi aşan bir rapor/toplu sorgu 57014 ile kesilir → 500 → mobil `stationRetry` aynı sorguyu 2 kez daha koşturur → **3 × 50 sn = 150 sn** DB CPU'su, üstüne kullanıcı da yeniden dener; havuz doygunluğu bu yolla kendi kendini besler.

**Veride fiili ihlal (K2).** Arandı, **0**: prod kopyasında `recordId IN ('DriverAdapterError')` satırı yok (`SYSTEM/ERROR` 15 satırın tamamı `TypeError`). Yol canlıda 2026-08-25'e kadar tetiklenmemiş → olasılık **düşük-orta**, şiddet buna göre S2'de tutuldu (S1'e çıkarılmadı).

**İş etkisi.** Geçici bir çakışma kalıcı bir hata gibi görünür; operatör kaydı "gitmedi" sanıp elle tekrar girer (mükerrer kayıt riski) ya da vazgeçer (eksik kayıt). Uzun sorgularda tekrar-tekrar koşum, tek process'li sunucuda diğer tabletleri de yavaşlatır.

**Kim, ne zaman fark eder?** Kimse: audit satırı `DriverAdapterError` adıyla düşer, onu okuyan alarm yok (D-I-02); kullanıcı yalnız genel hata metnini görür.

**Öneri (2. tur).** `error.middleware`'e, `extractCheckConstraint`'in yanına bir `extractPgSqlState(err)` (aynı iki şekil: çıplak `cause.code` + `meta.driverAdapterError.cause.code`) ve tek karar tablosu:
`40P01` → **409** + P2034 ile AYNI metin (tek sabit); `57014` → **503** + `Retry-After` + "işlem çok uzun sürdü" metni (mesaj 503 sözleşmesinden ayrı olmalı, çünkü "tekrar dene" burada aynı sorguyu koşturur — metin "daha dar tarih aralığı seçin" demeli); `25P03`/`53300` → 503 + audit. Hepsi `SYSTEM/ERROR` + ayırt edici `recordId` (`PG_57014` vb.) yazsın. Bekçi: `scripts/test_pg_sqlstate_mapping.ts` — dev DB'de `SET statement_timeout='50ms'` + `pg_sleep(1)` ile **gerçek** 57014, iki tx'li kasıtlı deadlock ile **gerçek** 40P01 üretip varış dalını ölçsün (negatif sonda: haritadan bir satır silinince kırmızı). Migration/izin/APK YOK.

**Kabul kriteri.** Gerçek 57014 üreten istek 503 + `Retry-After` alır ve `system_logs`'ta `recordId='PG_57014'` satırı doğar; gerçek 40P01 409 alır ve mobil kuyruk onu tekrar denemez. · **Efor:** 1 gün.

**Önceki defter.** `F-CORE-OPS-002` (kapandı — Prisma KOD kümeleri). Bu, aynı ölçütün SQLSTATE ayağı; defterdeki bulguyu yeniden açmıyor, kapsamadığı sınıfı gösteriyor.

---

### [D-I-05] Gece yedeğinin başarısız olduğunu gören hiçbir mekanizma yok; üstelik bayatlık sayacı deploy yedeğiyle sıfırlanıyor

| Şiddet | S1 | Kategori | I.4 | Öncelik | P2 | Modül | OPS | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Sahada gece yedeğini backend ALMIYOR; bağımsız bir Windows Görev Zamanlayıcı görevi (`yedekle.ps1`) alıyor — bilinçli ve doğru bir karar (backend çökse de yedek alınır). Bedeli: **backend o işin başarısını göremez.** Backend'in tek sinyali `BACKUP_DIR` içindeki en yeni `.dump` dosyasının mtime'ıdır. Bu sinyalin üç ayrı zayıflığı var: (a) yalnız Sunucu Durumu sayfası açıkken uyarıya dönüşür (D-I-02), (b) uzantıya bakar, **türe bakmaz** — bir deploy sırasında alınan `premigrate_*.dump` bayatlık sayacını sıfırlar, (c) klasör okunamazsa "yedek yok" ile "bakamadım" aynı değere (`null`) iner ve o durum **crit değil warn** olarak sınıflanır.

**Kanıt**
- `Teks-Erp/ecosystem.config.js:100-113` — *"⚠ SAHADAKİ SUNUCUDA (SAHINSRV) GECE YEDEĞİNİ BACKEND ALMIYOR … BACKUP_SCHEDULE_ENABLED: 'false'"*.
- `Teks-Erp/src/app.ts:197-217` `latestBackupInfo()` — `if (!f.toLowerCase().endsWith(".dump")) continue;` → **tür süzgeci yok**; `catch { backupCache = null; }` (:214-216) → okunamayan klasör "yedek yok".
- Tür bilgisi VAR ama burada kullanılmıyor: `Teks-Erp/src/services/helpers/backup-naming.helper.ts:18-20,198-201` (`NIGHTLY_PREFIX`/`PREMIGRATE_PREFIX`/`PRE_RESTORE_PREFIX`, `backupKind()`); `backup.service.ts:479` `listBackups` bunu kullanıyor, `latestBackupInfo` kullanmıyor (aynı klasör, iki farklı gerçek).
- `Electron/src/pages/System/ServerStatus/serverHealth.ts:208-212` — `ageH == null` → **warn** "Henüz yedek alınmamış"; `>=48h` → crit. Yani "klasörü hiç okuyamıyorum" (b), "iki gündür yedek yok"tan **daha az** ciddi işaretleniyor.
- Offsite ikinci kopya kapalı: `ecosystem.config.js:124,143` `BACKUP_OFFSITE_DIR:""`, `BACKUP_RCLONE_REMOTE:""` (F-OPS-VER-003 hâlâ açık, K12 satır 37).

**Veride fiili ihlal (K2).**
```sql
-- prod kopyası, 2026-07-16 → 2026-08-25 (40 gün)
SELECT action, "newData"->>'trigger', count(*) FROM system_logs WHERE category='SYSTEM' AND action LIKE 'BACKUP%' GROUP BY 1,2;
--  BACKUP_TRIGGER |  -      | 9
--  BACKUP_COMPLETED| manual | 7
--  BACKUP_COMPLETED| nightly| 1
SELECT count(*) FROM system_logs WHERE "recordId" LIKE 'JOB_FAILED:%';   -- 0
SELECT count(*) FROM system_logs WHERE action='BACKUP_FAILED';           -- 0
SELECT key, value FROM system_settings WHERE key='backup.lastNightlyAt'; -- "2026-08-25T00:05:07.694Z"
```
40 günde backend'in defterinde **1** gece yedeği var. Yani `BACKUP_COMPLETED` sahada "yedek alınıyor mu" sorusunun cevabı DEĞİL. (⚠️ `backup.lastNightlyAt` dolu olması `BACKUP_SCHEDULE_ENABLED=false` ile çelişiyor — K9 H-9 ile aynı gözlem; saha env'i repo ile ayrışmış olabilir → D-J.)

**failure_mode.** `yedekle.ps1` disk dolduğu / PGPASSWORD döndüğü / `pg_dump` sürümü uyuşmadığı için 10 gün boyunca her gece başarısız olur. `BACKUP_DIR`'de yeni `.dump` doğmaz. 3. gün bir sürüm çıkılır, `kur.ps1` `premigrate_*.dump` alır → `latestBackupInfo` mtime'ı **bugün** okur → bayatlık uyarısı sıfırlanır → sonraki 24 saat sessiz. Kimse Sunucu Durumu sayfasını açmazsa uyarı hiç görülmez. 10. gün diskte tek geçerli yedek 7 gün öncesinin `premigrate` dosyasıdır; offsite kopya da yok. Bir donanım arızasında **RPO = 7 gün**.

**İş etkisi.** Gerçek fabrika verisinde 7 günlük kayıp = 7 günlük top girişi, iş emri, sevkiyat ve irsaliye. Kurtarma yeteneğinin kaybı sessizdir ve ancak kurtarma gerektiğinde ölçülür.

**Kim, ne zaman fark eder?** Yedeğe ihtiyaç duyulduğu gün. (Sunucu Durumu sayfası açılırsa 24 saat sonra warn, 48 saat sonra crit — ama (b) yüzünden deploy günleri sayaç sıfırlanır.)

**Öneri (2. tur).** ① `latestBackupInfo`'yu `backupKind(name) === "nightly"` ile süz; `premigrate`/`pre-restore` dosyaları ayrı alanda dönsün (panel ikisini de göstersin, uyarı yalnız nightly'ye baksın). ② "Okunamadı" ≠ "yok": `latestBackupInfo` üç durumlu dönsün (`{state:"ok"|"empty"|"unreadable"}`); `unreadable` → **crit** ("yedek klasörü okunamıyor"). ③ `/api/admin/health`'e `backup.lastNightlyAt` (SystemSetting) ve `audit.lastArchiveAt` eklensin — "iş hiç uyanmadı" ile "iş koştu ama dosya yok" ayrı sorulardır (harici görev senaryosunda ilki hep boş kalacaktır, bu da bilgi). ④ Uyarının push ayağı D-I-02'ye bağlı. ⑤ F-OPS-VER-003 (offsite) kapanınca `offsite.missingCount` da alarma bağlanmalı.

**Kabul kriteri.** `BACKUP_DIR`'de yalnız `premigrate_*.dump` varken panel "gece yedeği yok" uyarısı verir; klasör erişilemez yapıldığında uyarı "okunamıyor" (crit) olur. · **Efor:** 0,5 gün (backend) + 0,5 gün (panel).

**Önceki defter.** `F-OPS-VER-003` (AÇIK — offsite yapılandırması), `F-OPS-VER-006` (AÇIK — log rotasyonu). İkisi de yeniden açılmıyor; bu bulgu **tespit edilebilirlik** ayağıdır ve ikisinden de farklıdır.

---

### [D-I-06] Fiziksel etiket basıldıktan sonraki kayıt yolu ateşle-unut ve tekrar denenmiyor: kâğıt çıkar, `labelPrintedAt` boş kalır, ölü-etiket koruması körleşir

| Şiddet | S2 | Kategori | I.2 | Öncelik | P3 | Modül | BLG/URE | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Baskı akışında geri alınamayan yan etki (kâğıt) ile onun kaydı arasında hiçbir güvence yok. Mobil, baskı bittikten sonra `recordPrintEvent`'i **ham axios çağrısı** olarak atar ve hatayı `console.warn`'a yutar — react-query dışında olduğu için `stationRetry` (3 deneme) **uygulanmaz**, kuyruğa da girmez. Sunucu tarafında da uç üç ayrı yazımdan oluşur ve **tx yoktur**: snapshot (kendi hatasını yutar) → `labelDirty:false, labelPrintedAt:now` → audit. Ortadaki yazım düşerse kâğıt basılmışken sistemde "hiç basılmamış" görünür.

**Kanıt**
- `mobil/src/components/LabelPrinter.tsx:247-249`
  ```ts
  labelService.recordPrintEvent(jobRoll.id, jobContext).catch((e) => {
    console.warn('Baskı audit kaydı başarısız', (e as Error).message);
  });
  ```
- `mobil/src/services/label.service.ts:162-173` — düz `apiClient.post`, mutation değil → `mobil/src/offline/mutations.ts:124-129` `stationRetry` bu çağrıya **uygulanmaz**.
- `Teks-Erp/src/services/label.service.ts:2074-2160` `recordPrintEvent`: `:2093` `seedRollLabelSnapshot` (kendi hatasını `{seeded:false}`'a çevirir, `:1978-1981`), `:2112-2115` `roll.update({labelDirty:false, labelPrintedAt})`, `:2145-2156` audit. Üçü ayrı; `$transaction` **yok** (aynı ailenin kart yolu `traveler-card.service.ts:367-386` tx KULLANIYOR — iki farklı sözleşme).
- Korumanın körleşmesi: `Teks-Erp/src/services/label.service.ts:2100-2107` yorumu — *"`labelPrintedAt` → 'ortada fiziksel bir etiket VAR mı' … İptal yolu (`inventory.softDelete`) ikincisine bakar: etiketi basılmış topu sessizce iptal etmek sahaya ÖLÜ ETİKET bırakır (2026-08-05 vakası)."*
- **Koruma kontrolü:** istemcide kuyruk yok (yazıcı kuyruğu ayrı ve baskı işine ait, kayıt işine değil — `mobil/src/offline/printQueue.ts`), sunucuda idempotency anahtarı yok (uç bilerek her çağrıda `labelPrintedAt`i tazeler, `label.service.ts:2106-2110`), toast yok, sayaç yok.

**Veride fiili ihlal (K2).** Bu ucun kardeşinin sahada 31,5 saat 500 verdiği ÖLÇÜLDÜ (D-I-02 sorgusu; `POST /api/traveler-cards/:id/print-event`, 15 satır). Aynı dönemde `/labels/rolls/:id/print` için ayrı bir ölçüm yok — `LABEL_PRINT_EVENT` audit'i prod'da 2.557 satır (dil dağılımı K9 §13) — yani yol yoğun kullanılıyor; başarısız denemelerin **hiçbir izi olmadığı için** kaç kez düştüğü ölçülemez. Bu, bulgunun kendisidir.

**failure_mode.** Operatör Tambur'da topu okutur, "Kime? → stok" seçer, BT yazıcıdan kâğıt çıkar. Tam o saniyede tablet Wi-Fi'ı düşer (ya da uç 500 vermektedir). `POST /labels/rolls/:id/print` düşer, tablette **hiçbir görsel geri bildirim yoktur** (yalnız release APK'da görünmeyen `console.warn`). Sonuç: (a) `labelPrintedAt` NULL kalır → aynı top iki gün sonra iptal edilirken ölü-etiket onayı SORULMAZ, barkodu basılı kâğıt sahada kalır — 2026-08-05'te tam bu vakayı önlemek için kurulan koruma delinir; (b) `labelDirty` true kalır → top listelerde sonsuza dek "etiketi bayat" görünür ve operatör ikinci kâğıt basar; (c) `LABEL_PRINTED` audit satırı hiç doğmaz → "bu topun etiketi kime basıldı" sorusu cevapsız.

**İş etkisi.** Sahaya barkodlu ölü etiket çıkması (envanterde olmayan bir barkodun okutulması), mükerrer etiket basımı, izlenebilirlik boşluğu.

**Kim, ne zaman fark eder?** Hiç kimse — istemcide toast yok, sunucuda iz yok. Sonuç ancak "iptal ettiğim topun etiketi ortalıkta" ya da "bu top hep bayat görünüyor" şikâyetiyle dolaylı çıkar.

**Öneri (2. tur).** ① Mobilde `recordPrintEvent`'i **mutation**'a çevir (`OFFLINE_AWARE` + `stationRetry`) — 5xx/ağ hatasında 3 deneme, kalıcı düşüşte `announceFailure` toast'ı ("kâğıt basıldı ama kayıt oluşmadı — topu yeniden okutun"). ⚠️ Token yapıştırma kuralı burada da geçerli (`entryAttempt.ts` sözleşmesi): kesin 4xx'te yapışma. ② Sunucuda `roll.update` + audit'i **tek tx**'e al (kart yolunun kalıbı) — snapshot best-effort kalabilir. ③ `seedRollLabelSnapshot`'ın `{success:true, seeded:false}` yalanı D-I-09'da ayrıca ele alındı. Migration/izin YOK; backend + APK birlikte (APK gerekir).

**Kabul kriteri.** Uç 500 verecek şekilde sahteleştirildiğinde tablet kırmızı toast gösterir ve kayıt 3 kez denenir; ağ geri gelince kayıt oluşur. Sunucuda `labelPrintedAt` yazıldıysa `LABEL_PRINTED` audit satırı da MUTLAKA vardır (tx). · **Efor:** 1 gün.

**Önceki defter.** Yeni. `MEMORY.md → print-event-toast-yanilticiligi` notunun kardeş vakası (o not kart yolunu kapattı, top yolu aynı desende kaldı).

---

### [D-I-07] Barkod/QR üretimi patlarsa eleman sessizce ÇİZİLMEZ — barkodsuz etiket 200 ile basılır, hiçbir yerde iz kalmaz

| Şiddet | S2 | Kategori | I.1 | Öncelik | P3 | Modül | BLG/DON | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Raster etiket motorunda `drawCode128` ve `drawQr` her istisnayı `catch { return null }` ile yutar; çağıran (`raster-canvas`) `null`'ı sessizce atlar ve bitmap'i eksik elemanla döndürür. HTTP 200, baytlar yazıcıya gider. "Barkod topun KİMLİĞİdir" kuralına sahip bir sistemde bu, okutulamayan bir kâğıt üretir ve olayın ne log'u ne sayacı vardır. Kardeş dal olan ikon çizimi için gerekçe yorumu VAR ("bilinmeyen anahtar → sessiz atla"); barkod/QR için gerekçe **yok**.

**Kanıt**
- `Teks-Erp/src/services/helpers/raster/raster-barcode.ts:31-48` (`drawCode128` — `catch { return null; }`), `:52-77` (`drawQr` — aynı).
- `Teks-Erp/src/services/helpers/raster/raster-canvas.ts:68-72` (`case "qr": if (!bc) break; drawQr(...); break;` — dönüş **hiç kontrol edilmiyor**), `:73-88` (`case "code128"`: dönüş yalnız insan-okur satırı konumlandırmak için okunuyor; `res===null` ise **yalnız yazı atlanır**, hata üretilmez).
- Kardeş gerekçeli dal: `raster-canvas.ts:99-104` `catch { /* bilinmeyen ikon → iz bırakmadan geç */ }`.
- Aynı sınıfın komut (raster olmayan) ikizi: `Teks-Erp/src/services/label.service.ts:934`, `label-template.service.ts:1213`, `traveler-card.service.ts:1033/1070` (`qrSvg = null`).
- **Koruma kontrolü:** çağrı yolunda `X-Label-*` başlıkları dil/şablon bilgisini taşıyor ama "eleman düştü" bilgisi taşımıyor (`label-renderer.registry.ts:162-164` `renderedBytes`); audit `LABEL_PRINT_EVENT` yalnız şablon/dil izini yazıyor (`label.service.ts:2131-2137`); sayaç yok; bekçi yok (`grep -rn "drawQr|drawCode128" Teks-Erp/scripts` → çizim doğrulayan sonda yok).

**failure_mode.** Çuval/serbest etikette QR içeriği (not, adres, uzun sipariş referansı) QR kapasitesini aşar ya da Code128'in kodlayamayacağı bir karakter (Türkçe harf taşıyan özel bir alan) içerir → `bwipjs.raw` fırlatır → `drawQr/drawCode128` `null` döner → kâğıt **o alanı boş** basılır. Operatör etiketi çuvala yapıştırır; sevkiyat kapısında okutma başarısız olur. Sunucu tarafında hiçbir kayıt yoktur; teşhis "yazıcı bozuk mu, şablon mu yanlış" diye günlerce dolaşır.

**Veride fiili ihlal (K2).** Aranamadı — bu düşüşün DB'de izi olmadığı için sorgulanabilir değil ("iz yokluğu" bulgunun kendisi). Dolaylı: prod'da `rasterMode=true` cihaz **1** adet (K9 §13), `label.nativeSendEnabled=false` → raster yolu sahada dar; komut/HTML yolundaki `qrSvg=null` ikizi ise TÜM kartlarda geçerli. Olasılık orta, bu yüzden S2 (S1 değil).

**İş etkisi.** Okunamayan barkod = istasyonda okutulamayan top/çuval = akışın durması; ayrıca "etiket basıldı" audit'i yazıldığı için sistem kâğıdı geçerli sayar.

**Kim, ne zaman fark eder?** Sonraki istasyondaki operatör, okutma anında — sebebi bilmeden.

**Öneri (2. tur).** ① `drawQr`/`drawCode128` `catch` bloğuna `console.error` + **çağırana bilgi**: `renderLabel` sonucu `omittedElements: string[]` taşısın. ② Boş dönen KİMLİK elemanı (barkod/QR) **fail-closed** olsun: `LabelKind` barkod taşıyan bir tür ise 500/409 ile baskıyı durdur (çuval etiketi emsali: şablon yoksa 400, roll'a sapma yok — aynı disiplin). Süs elemanı (ikon, çizgi) sessiz atlamaya devam edebilir. ③ Düşüş `SYSTEM/ERROR recordId='LABEL_ELEMENT_DROPPED'` audit'i yazsın. Bekçi: kapasiteyi aşan QR verisi + kodlanamayan Code128 verisiyle iki negatif sonda. Migration/izin YOK.

**Kabul kriteri.** Kapasiteyi aşan QR verisiyle baskı isteği 4xx/5xx döner (200 + boş alan değil) ve audit'e satır düşer; ikon düşüşü davranışı değişmez. · **Efor:** 0,5 gün.

**Önceki defter.** Yeni (K6 H-7).

---

### [D-I-08] Fason kabulünde ölçülen "en" iş emrine yazılamazsa operatöre söylenmiyor — kardeş renk yolu uyarı gönderiyor, en yolu yalnız konsola yazıyor

| Şiddet | S2 | Kategori | I.1 | Öncelik | P3 | Modül | FAS | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Fason kabulünden sonra iki "tx dışı, best-effort" düzeltme koşar: **en** (`changeWidth`) ve **renk** (`changeTargetColor`). Renk yolu hatayı `postWarnings`'e koyup yanıtla operatöre gönderiyor; en yolu aynı hatayı `console.warn` ile yutuyor. İkisi de aynı gerekçeyle (kabul tamamlandı, mal içeride) tx dışında — sorun tx sınırı değil, **iki kardeş yolun raporlama sözleşmesinin ayrışması**.

**Kanıt**
- `Teks-Erp/src/services/subcontractor.service.ts:3268-3283`
  ```ts
  } catch (err) {
    console.warn(`[fason-kabul] İş emri eni güncellenemedi (WO ${data.workOrderId}):`,
      err instanceof Error ? err.message : err);
  }
  ```
- `Teks-Erp/src/services/subcontractor.service.ts:3298-3310` — renk yolu: `catch { postWarnings.push('İş emrinin rengi değiştirilemedi: ...') }` → yanıt gövdesinde döner.
- Özelliğin gerekçesi (`:3258-3263`): *"Eskiden ölçülen en yalnız DOĞAN TOPA yazılıyordu; iş emrinin eni eski değerde kalıyor ve bir sonraki fason çekisi hâlâ o eski eni basıyordu."* — düşüş tam olarak bu davranışa geri döndürür.
- **Koruma kontrolü:** yanıtta bayrak yok, audit satırı yok (`changeWidth` başarılı olsaydı kendi audit'ini yazardı; düşerse hiçbir şey yazılmaz), `/health` sayacı yok, bekçi yok.

**failure_mode.** Kabul personeli 148 cm ölçer ve girer. İş emri o sırada terminal statüye geçmiştir (ya da `workorder-target-color.helper` kilidi devrededir) → `changeWidth` `AppError` fırlatır → yutulur. Kabul **200** döner, ekranda hiçbir uyarı yoktur. Operatör "en güncellendi" varsayar. Bir sonraki fason çekisi (`fason çeki tek EN, kaynak WorkOrder.width`) **eski eni** basar; fason firma yanlış ene göre çalışır.

**Veride fiili ihlal (K2).** Arandı, ölçülemedi: düşüşün izi olmadığı için sorgulanabilir değil. Dolaylı sonda `system_logs`'ta `tableName='WORK_ORDER' AND changes @> '[{"field":"width"}]'` ile "kaç kabulde en gerçekten değişti" sayılabilir ama "kaçında denendi" bilinemez — asimetri budur.

**İş etkisi.** Fason firmaya yanlış en bildirimi; dönen malın eni beklenenden farklı çıkar ve fark "çekme" sanılır (2026-08-21 çekme kararının sinyalini kirletir).

**Kim, ne zaman fark eder?** Fason firma ya da kabulü yapan kişi, bir sonraki çeki kâğıdında — ilişkiyi kurabilirse.

**Öneri (2. tur).** `catch` bloğunu renk yolunun aynısı yap: `postWarnings.push('İş emrinin eni güncellenemedi: ...')`. ⚠️ `postWarnings` ham `err.message` taşıyor (Prisma/pg metni sızabilir — D-I-14 ve → G); aynı dokunuşta ikisi de sabit metne + `details.code`'a çevrilmeli. Ayrıca best-effort düşüşü `SYSTEM/ERROR recordId='POST_RECEIPT_WIDTH_FAILED'` ile deftere düşsün. Bekçi: `test_fason_partial_receive.ts`'e "terminal WO'da kabul → yanıtta uyarı var" sondası. Migration/izin/APK YOK (istemci `warnings` alanını zaten çiziyor).

**Kabul kriteri.** Terminal statüdeki bir WO'ya fason kabulü yapıldığında yanıt `warnings` içinde en uyarısını taşır ve `system_logs`'ta satır doğar. · **Efor:** 0,25 gün.

**Önceki defter.** Yeni (K6 H-6; K7a "changeWidth tx dışı best-effort" gözlemi).

---

### [D-I-09] `AppError.internal`, `withBarcodeRetry` tükenmesi ve `PrismaClientValidationError` sunucuda HİÇ iz bırakmadan dönüyor

| Şiddet | S3 | Kategori | I.1 | Öncelik | P4 | Modül | CORE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `errorHandler`'ın 1. dalı (`err instanceof AppError`) statü koduna bakmadan yanıtı yazar ve **hiçbir audit/console satırı üretmez**. Bu dal 500'leri de taşır: `AppError.internal` (`isOperational=false`) tanımı gereği "sunucu arızası"dır ama iz bırakmaz. Aynı kapıdan `withBarcodeRetry`'ın 5 denemede tükenme 409'u da geçer — bu 409, "iki tablet çakıştı" değil "numara üretici sistematik olarak bozuk" anlamına gelebilir ve tam da o durumda sessizdir. Üçüncüsü ayrı bir dal: `PrismaClientValidationError` → 400, audit yok — oysa bu sınıf tipik olarak **sunucu kod hatasıdır** (yanlış `select/include/data` şekli), yani F-CORE-OPS-002'nin kendi ölçütüne ("istemci veriyi değiştirerek kurtulabilir mi?") göre 500 + audit olmalıydı.

**Kanıt**
- `Teks-Erp/src/middlewares/error.middleware.ts:269-277` — dal 1; `err.statusCode` ne olursa olsun audit/console YOK.
- `Teks-Erp/src/utils/app-error.ts:60-62` — `static internal(...) { return new AppError(message, 500, false, details); }`; `isOperational` errorHandler'da **hiç okunmuyor** (ölü alan).
- `AppError.internal` çağrı yerleri (4): `workorder.service.ts:596` (İE no 10 denemede üretilemedi), `auth.service.ts:200` (rastgele PIN 10 denemede benzersiz olmadı), `printed-document.service.ts:178` (builder kayıtlı değil), `:323` (belge dondurulamadı).
- `Teks-Erp/src/utils/barcode-retry.ts:54-56` — `throw AppError.conflict('Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin.')`; 25 çağrı yeri.
- `Teks-Erp/src/middlewares/error.middleware.ts:588-595` — `PrismaClientValidationError` → 400, `AuditService` çağrısı yok.
- `Teks-Erp/src/services/label.service.ts:1978-1981` — aynı aile: `catch { console.error(...); return { success: true, data: { seeded: false } }; }` → **`success:true` ile hata dönüyor** ve tekil çağrı yolunda (mobil `LabelPrinter.tsx:142`) istemci `seeded` alanını hiç okumuyor (`mobil/src/services/label.service.ts:181-192` dönüş tipi `ApiResponse<unknown>`).
- **Koruma kontrolü:** `grep -rn "isOperational" Teks-Erp/src` → yalnız tanım + `tambur-manual.service.ts:568/807/1447` (yeniden sararken kopyalanıyor, karar için kullanılmıyor). Bekçi: `scripts/test_observability_contract.ts` Prisma KOD kümelerini ölçer, bu üç yolu ölçmez (K6 §7).

**failure_mode.** ① `nextDailySeq`/barkod sayacının süzgeci bozulur (2026-08-05 parti no vakasında birebir yaşanan sınıf: regex gevşerse sayaç her seferinde başa döner) → her top girişinde 5 P2002 üst üste → operatör "Barkod üretimi 5 denemede başarısız oldu" 409'unu alır, tekrar dener, yine alır. Sunucuda **tek satır iz yoktur**: ne SystemLog, ne konsol, ne `/health`. Arıza ancak "hiçbir top girilemiyor" şikâyetiyle bulunur ve o noktada teşhis sıfırdan başlar. ② `printed-document.service.ts:178` "builder kayıtlı değil" — bir belge türü eklenip kayıt defterine yazılmayı unutunca (OCP sınıfı) 500 döner ve **hangi belge türünde** olduğu hiçbir yere yazılmaz.

**Veride fiili ihlal (K2).** Arandı, **0** (tanım gereği: bu yollar satır yazmıyor). Prod `SYSTEM/ERROR` 15 satırın tamamı `TypeError` (dal 9) — yani defterde bu üç sınıftan hiç kayıt olmaması "olmadı" değil "kaydedilmiyor" demektir.

**İş etkisi.** Sunucu kaynaklı bir arıza istemci hatası gibi görünür; SystemLog'a düşmediği için sonraki denetimde de görünmez.

**Kim, ne zaman fark eder?** Yalnız kullanıcı, hata metnini birine ilettiğinde.

**Öneri (2. tur).** ① Dal 1'i statüye göre ayır: `err.statusCode >= 500` **veya** `err.isOperational === false` ise `console.error` + `SYSTEM/ERROR` audit (recordId `APP_ERROR_500`), yanıt aynı kalsın. ② `withBarcodeRetry` tükenmesinde fırlatmadan önce `console.error` + audit (`recordId='BARCODE_RETRY_EXHAUSTED'`, payload'a çağrı yeri etiketi) — 409 sözleşmesi değişmez. ③ `PrismaClientValidationError` → 500 + audit (F-CORE-OPS-002 ölçütünün gereği); ⚠️ istemci sözleşmesi değişir (400→500), mobil `stationRetry` bunu 3 kez dener — bu yüzden **ayrı bir karar**: ya 400 kalsın + audit eklensin (asgari), ya 500'e çıksın (doğru sınıf). Asgari çözüm önerilir. ④ `seedRollLabelSnapshot` `{success:true, seeded:false}` yerine tekil yolda da `failed` sebebini döndürsün. Bekçi: `test_observability_contract.ts`'e üç sonda. Migration/izin YOK.

**Kabul kriteri.** `AppError.internal` fırlatan bir uç çağrıldığında `system_logs`'ta satır doğar; `withBarcodeRetry` 5/5 tükendiğinde satır doğar. · **Efor:** 0,5 gün.

**Önceki defter.** `F-CORE-OPS-002` (kapandı) — bu, o düzeltmenin kapsamadığı üç yol.

---

### [D-I-10] Statü taşıyan http-errors (415 charset, 400 param decode, `sendFile` hataları) 500'e düşüyor ve SAHTE `SYSTEM/ERROR` audit satırı üretiyor

| Şiddet | S3 | Kategori | I.6 | Öncelik | P4 | Modül | CORE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `errorHandler` `err.status`/`err.statusCode`'u **yalnız `SyntaxError` için** okuyor. Express/router/body-parser/serve-static ekosisteminin ürettiği "statü taşıyan ama `AppError` olmayan" hatalar (415 `charset.unsupported`, router `decodeParam` 400, `res.sendFile` 404/403/EISDIR) hiçbir dala uymayıp dal 9'a düşüyor: kullanıcıya **500 "Sunucu hatası oluştu."**, deftere ise `recordId='URIError'`/`'UnsupportedMediaTypeError'` ile bir **sunucu arızası** kaydı. Yani hem istemci hatası sunucu hatası gibi raporlanıyor hem de defter kirleniyor.

**Kanıt**
- `Teks-Erp/src/middlewares/error.middleware.ts:280` — `if (err instanceof SyntaxError && "status" in err && (...).status === 400)`: statü okuması **yalnız** burada.
- `Teks-Erp/src/middlewares/error.middleware.ts:614-633` — dal 9: 500 + `recordId: err.name`.
- Kaynak taraf (okundu): `node_modules/router/lib/layer.js:219-229` (`decodeParam` → `err.status = 400`), `node_modules/body-parser/lib/read.js:73-75,105-107` (`charset.unsupported`/`encoding.unsupported` → 415), `node_modules/express/lib/response.js:411-417` (`sendFile` hatası → `next(err)`), `node_modules/serve-static/index.js:115-116`.
- Etkilenen uçlar: her `/:id` yolu (bozuk `%` dizisi taşıyan URL), `Teks-Erp/src/routes/mobile-update.routes.ts:69-83` (`res.sendFile`), `Teks-Erp/src/routes/admin.routes.ts:1278` (`res.download` — bu, başlıklar gönderilmişse dal 0'a düşer, doğru), `Teks-Erp/src/app.ts:157-158` (`express.static`).
- **Koruma kontrolü:** `grep -rn "err.status" Teks-Erp/src/middlewares/error.middleware.ts` → yalnız SyntaxError satırı; bekçi yok (`test_http_api.ts` 401/403/400-Zod/201 ölçüyor, bu sınıf yok).

**failure_mode.** Tablet, barkodu URL'e koyarken kaçırılmamış bir `%` üretir (`/api/rolls/AB%C7`). Router `decodeParam` `URIError{status:400}` fırlatır → dal 9 → kullanıcı **500** görür ("sunucu bozuk" izlenimi, mobil kuyruk 5xx'i 3 kez dener) ve `system_logs`'a `recordId='URIError'` ile **sahte bir sunucu arızası** yazılır. Bir gün 40 tablet aynı hatayı yaparsa defterde 40 "sunucu hatası" birikir ve gerçek dal-9 vakaları (2026-08-05'teki `TypeError` gibi) gürültüde kaybolur.

**Veride fiili ihlal (K2).** Arandı, **0**: prod kopyasında `recordId IN ('URIError','UnsupportedMediaTypeError','NotFoundError')` satırı yok. Yol kaynak okumasıyla haritalandı, canlıda tetiklenmedi → [VARSAYIM] işaretiyle S3'te tutuldu.

**İş etkisi.** Yanlış 5xx (istemci tekrar dener, gereksiz yük) + defter kirlenmesi (gerçek arızanın sinyal/gürültü oranını düşürür).

**Kim, ne zaman fark eder?** Kimse — defterdeki satır "gerçek" göründüğü için yanlış teşhise yol açar.

**Öneri (2. tur).** Dal 2'yi genelleştir: `const st = (err as any).status ?? (err as any).statusCode; if (typeof st === "number" && st >= 400 && st < 500) → o statüyle Türkçe mesaj, audit YOK`. `SyntaxError`/413 özel dalları önce kalsın (metinleri korunur). ⚠️ `AppError` bu kontrolden ÖNCE dönmeli (zaten öyle). Bekçi: `test_observability_contract.ts`'e üç sonda (bozuk `%` param, `charset` başlığı, olmayan `sendFile` yolu) — hepsinde 4xx **ve** `system_logs` satır sayısı değişmemiş olmalı. Migration/izin YOK.

**Kabul kriteri.** `/api/rolls/AB%C7` isteği 400 döner ve `system_logs`'a satır düşmez. · **Efor:** 0,25 gün.

**Önceki defter.** Yeni (K6 H-4).

---

### [D-I-11] Script yolundan yapılan ana-veri yazımlarının audit satırı AKTÖRSÜZ: kullanıcı, IP, cihaz ve istek kimliği dördü de boş

| Şiddet | S3 | Kategori | I.3 | Öncelik | P4 | Modül | OPS/TAN | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** 2026-08-19'da audit'e "NEREDEN" bileşeni (`ipAddress`/`deviceId`/`requestId`) `AsyncLocalStorage` ile eklendi ve HTTP yolunda çalışıyor. Ama ana-veri (kumaş, renk, istasyon, müşteri) değişikliklerinin bir kısmı **script yolundan** geliyor; scriptte ALS bağlamı yok ve `userId` de geçilmiyor → audit satırı "ne değişti"yi söylüyor, "kim değiştirdi"yi söylemiyor. Ölçüldü: prod kopyasında 2026-08-25'te 36 satır tam olarak böyle.

**Kanıt (K2 — prod kopyası)**
```sql
SELECT "tableName", action,
       count(*) FILTER (WHERE "userId"    IS NOT NULL) uid,
       count(*) FILTER (WHERE "ipAddress" IS NOT NULL) ip,
       count(*) FILTER (WHERE "deviceId"  IS NOT NULL) dev,
       count(*) FILTER (WHERE "requestId" IS NOT NULL) rid,
       count(*) tot
FROM system_logs
WHERE category='DOMAIN' AND "createdAt" > '2026-08-24 18:27'   -- requestId özelliğinin sahaya indiği an
GROUP BY 1,2;
--  COLOR   |CREATE| 0|0|0|0| 6      ITEM |CREATE| 0|0|0|0| 6     STATION|CREATE| 0|0|0|0| 4
--  COLOR   |UPDATE| 0|0|0|0| 4      ITEM |UPDATE| 0|0|0|0| 3     STATION|UPDATE| 0|0|0|0| 2
--  COLOR   |DELETE| 0|0|0|0| 1      items|UPDATE| 0|0|0|0| 6     colors |UPDATE| 0|0|0|0| 4
--  CUSTOMER|CREATE| 0|0|0|0| 4
--  ROLL    |CREATE|  ✔ |40|40|40|40   ← karşılaştırma: HTTP yolu dört alanı da dolduruyor
```
Zaman damgaları küme hâlinde: `2026-08-25 04:41` ve `13:22-13:25` — insan tıklamasının değil toplu bir koşumun imzası (lowercase `items`/`colors`/`subcontractors` adları `MasterDataMergeService`'in ham tablo adlarıdır).
- Kod: `Teks-Erp/src/services/audit.service.ts:74,135,177` — üçü de `currentOrigin()` okuyor; `Teks-Erp/src/lib/request-context.ts:56-59` — bağlam yoksa hepsi `null` (bilinçli, `:21-22`).
- `Teks-Erp/scripts/run-all-tests.ts:102` `productionDbGate()` **yalnız koşucuda**; tekil script `npx tsx scripts/x.ts` kapıdan geçmez (K12 açık madde 9).
- **Yan bulgu (aynı kanıt kümesinden):** `tableName` iki farklı yazım kuralı taşıyor — `ITEM`/`items`, `COLOR`/`colors`, `SUBCONTRACTOR`/`subcontractors`. "Bu tabloya kim dokundu" sorgusu tek anahtarla cevaplanamıyor.

**failure_mode.** Fabrikada bir kumaşın kodu/adı değişir ve raporlar kayar. Denetim `system_logs`'a bakar: satır vardır, `changes` doludur, ama `userId`/`ipAddress`/`deviceId`/`requestId` **hepsi NULL**'dır. "Bu değişikliği kim, hangi araçla yaptı" sorusu — panelden mi, `apply_merge_decisions.ts` ile mi, elle SQL ile mi — cevapsız kalır. ISO 27001 A.8.15'in "kim" bileşeni tam da en kritik tabloda (ana veri) yok.

**İş etkisi.** Ana veri değişiklikleri geriye dönük tüm raporları etkiler; sorumluluk zinciri kurulamaz.

**Kim, ne zaman fark eder?** Bir denetimde ya da bir uyuşmazlıkta — yani iş işten geçtikten sonra.

**Öneri (2. tur).** ① Script bağlamı: `lib/request-context.ts`'e `runWithScriptContext(actorLabel)` ekle (ALS'e `{ requestId: uuid, actor: 'script:<dosya-adı>' }` koyar); toplu veri dokunan scriptler (`apply_merge_decisions.ts`, backfill/normalize ailesi) bu sarmalayıcıyı kullansın. `SystemLog`'a yeni kolon **gerekmez** — `ipAddress` yerine ayırt edici bir sabit ("script") ya da `newData._actor` yeterli; kolon eklemek migration ister, gerekmiyor. ② `tableName` yazım kuralını tek kaynağa bağla (bekçi: `system_logs`'ta iki yazımın aynı tabloyu göstermesi yasak). ③ `AuditService.logEvent` `deviceId` yazmıyor (bkz. D-I-12) — aynı dokunuşta düzelt. Migration/izin YOK.

**Kabul kriteri.** `apply_merge_decisions.ts --apply` sonrası audit satırları `actor='script:apply_merge_decisions'` taşır; `SELECT DISTINCT "tableName"` çıktısında aynı varlık için iki yazım kalmaz. · **Efor:** 0,75 gün.

**Önceki defter.** Yeni. (K4'ün "4 backfill/normalize + seed audit yazmıyor" gözlemiyle akraba ama farklı: burada satır **yazılıyor**, aktörü yok.)

---

### [D-I-12] Korelasyon kimliği tek yönlü: `requestId` yalnız audit satırında yaşıyor; yanıtta, log satırında ve hata gövdesinde yok — `logEvent` ayrıca `deviceId` hiç yazmıyor

| Şiddet | S3 | Kategori | I.3 | Öncelik | P4 | Modül | CORE/OPS | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `requestId` (SAP `CDHDR` karşılığı) iyi tasarlanmış: aynı istekte yazılan tüm audit satırları onu paylaşıyor ve audit listesinde filtre var. Ama kimlik **dışarı çıkmıyor**: HTTP yanıt başlığında yok, morgan satırında yok, 5xx gövdesinde yok. Sonuç: pm2 erişim log'u ile audit tablosu arasında birleştirme anahtarı yok (yalnız zaman+yol+IP ile elle eşleştirilebilir) ve operatörün elinde destek ekibine söyleyeceği bir numara yok. İkinci boşluk: `AuditService.logEvent` (AUTH + SYSTEM kanalı) `deviceId`'yi **hiç** yazmıyor ve `ipAddress`'i ALS'ten okumuyor — yalnız çağıranın açıkça geçtiğini yazıyor.

**Kanıt**
- `Teks-Erp/src/lib/request-context.ts:36-41` — `requestId` üretimi; `:63-68` — `currentOrigin()`.
- `Teks-Erp/src/services/audit.service.ts:176-192` — `logEvent`: `ipAddress: params.ipAddress ?? null` (ALS fallback YOK), `deviceId` alanı **hiç yazılmıyor**, `requestId: origin.requestId` (var).
- `grep -rn "X-Request-Id|x-request-id" Teks-Erp/src` → **0**; `grep -rn "morgan.token" Teks-Erp/src` → **0**; `Teks-Erp/src/app.ts:121` `morgan(isProd ? "combined" : "dev")` (standart format, özel token yok).
- Hata gövdeleri: `error.middleware.ts:270-277, 614-633` — `{success,message}` (+`details`), `requestId` yok.

**Veride fiili ihlal (K2).**
```sql
SELECT category,
       count(*) FILTER (WHERE "deviceId"  IS NOT NULL) dev,
       count(*) FILTER (WHERE "ipAddress" IS NOT NULL) ip,
       count(*) tot
FROM system_logs WHERE "createdAt" > '2026-08-24 18:27' GROUP BY 1;
--  AUTH   |   0 |  15 |  15     ← giriş/çıkış olaylarında CİHAZ izi hiç yok
--  SYSTEM |   0 |   0 |  27
--  DOMAIN | 103 | 120 | 187     ← HTTP yolu doldurmuş
```
"10 tablet aynı kullanıcıyla çalışıyor" tasarımında (K5 H4) **giriş olayının cihazı** en çok gereken alandır ve tam orada boş.

**failure_mode.** Operatör "saat 14:32'de kaydım gitmedi, hata aldım" der. Destek `system_logs`'ta o dakikadaki satırları arar; pm2 `backend-out.log`'da o dakikadaki istekleri arar; ikisini birleştirecek anahtar yoktur (aynı IP'den 40 istek olabilir). Ayrıca "hangi tabletten giriş yapıldı" sorusu AUTH kanalında hiç cevaplanamaz.

**İş etkisi.** Teşhis süresi uzar (D-I-02'nin 31,5 saatlik ölçümünün bir bileşeni); cihaz bazlı kötüye kullanım incelenemez.

**Kim, ne zaman fark eder?** Ancak teşhis denendiğinde — ve o an geç kalınmıştır.

**Öneri (2. tur).** ① `runWithRequestContext` sonrası `res.setHeader('X-Request-Id', ctx.requestId)`; CORS `exposedHeaders`'a ekle (⚠️ `test_middleware_order.ts` listeyi dondurmuş — iki yer + bekçi birlikte değişmeli; `Retry-After` için de aynısı geçerli, K6 H-13). ② `morgan.token('rid', ...)` + `combined`'a ekli özel format → pm2 log satırı audit'e bağlanır. ③ 5xx gövdesine `requestId` ekle (kullanıcıya gösterilecek "hata numarası"; 4xx'e gerek yok). ④ `logEvent`'e `deviceId: origin.deviceId` ve `ipAddress: params.ipAddress ?? origin.ipAddress`. Migration/izin YOK; Electron hata ekranında numarayı göstermek APK/panel işi (ayrı).

**Kabul kriteri.** Bir 500 yanıtının gövdesindeki numara ile `system_logs.requestId` ve pm2 log satırındaki `rid` aynıdır; AUTH satırlarında `deviceId` dolu gelir. · **Efor:** 0,5 gün.

**Önceki defter.** Yeni.

---

### [D-I-13] Birleştirme önizlemesi SQL hatasında "0 çakışma" diyor; işlem sonra "Önizlemeden sonra veriler değişti" diye reddediyor — kullanıcı olmayan bir değişikliği kovalıyor

| Şiddet | S3 | Kategori | I.1 | Öncelik | P4 | Modül | TAN | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `master-data-merge` içinde iki kardeş sayım fonksiyonu var ve **zıt** davranıyorlar: `countRows` hatada `null` döner ve yorumu kuralı açıkça yazar (*"⚠️ 0 DÖNDÜRME. 'Sayamadım' ile 'hiç yok' farklı cümlelerdir"*); `describeConflict` aynı durumda `count = 0` döner. Önizleme "0 çakışma" gösterir, kullanıcı onaylar, işlem tx içinde **doğru** sayımı yapar (`describeConflictTx` — o yutmuyor) ve `liveConflicts !== acknowledgedConflicts` olduğu için **409 "Önizlemeden sonra veriler değişti"** atar.

**Kanıt**
- `Teks-Erp/src/services/master-data-merge.service.ts:1014-1027` (`countRows` — `catch { return null; }` + gerekçe yorumu) ↔ `:1041-1057` (`describeConflict` — `catch { count = 0; }`).
- `Teks-Erp/src/services/master-data-merge.service.ts:786-805` `describeConflictTx` — **yutmuyor** (hata tx'i düşürür) → iki yüzey ayrışıyor.
- `Teks-Erp/src/services/master-data-merge.service.ts:598-603` — `if (liveConflicts !== params.acknowledgedConflicts) throw AppError.conflict("Önizlemeden sonra veriler değişti (çakışma sayısı farklı)...")`.
- Neden gerçekçi: önizleme sorgusu **ağır** (`SELECT s.*` + `EXISTS` + `ORDER BY`), tx sorgusu **hafif** (`count(*)`). DB `statement_timeout=50s` (ölçüldü) → büyük tabloda önizleme kesilirken tx sayımı geçebilir.
- **Koruma kontrolü:** `MERGE_LOCK_NS` advisory kilidi çakışmayı değil eşzamanlılığı korur; `duplicate_reviews` bu yola bakmaz; bekçi `test_duplicate_detection.ts` tespit kurallarını ölçüyor, önizleme hata dalını değil.

**failure_mode.** Yönetici iki müşteriyi birleştirmek ister. Önizleme "çakışma yok" der (aslında sorgu 57014 ile kesilmiştir). Onaylar → 409 "Önizlemeden sonra veriler değişti, önizlemeyi yenileyip tekrar onaylayın." Yeniler → yine "0 çakışma" → yine 409. **Sonsuz döngü**, ve mesaj kullanıcıyı hiç olmayan bir eşzamanlı değişikliği aramaya gönderir.

**Veride fiili ihlal (K2).** Arandı, ölçülemedi (hata dalının izi yok). Prod'da `duplicate_reviews`/merge kullanımı düşük → olasılık düşük, S3.

**İş etkisi.** Mükerrer kart temizliği (nameFold seddinin "enforce bekliyor" durumu buna bağlı) tıkanır; kullanıcı özelliğe güvenmeyi bırakır.

**Kim, ne zaman fark eder?** Kullanıcı hemen fark eder ama **yanlış sebeple** — hata mesajı onu yanlış yöne gönderir. Sunucuda iz yok.

**Öneri (2. tur).** `describeConflict`'i kardeşiyle hizala: `count: number | null`; `null` ise önizleme satırı "ölçülemedi" der ve **onay düğmesi kapanır** (fail-closed — merge yıkıcı bir işlem, CLAUDE.md "yıkıcı işlemlerde detaylı onay" kuralı). Bekçi: sorguyu kasten bozan negatif sonda → önizleme "ölçülemedi" der, `apply` reddedilir. Migration/izin YOK.

**Kabul kriteri.** Önizleme sorgusu hata verdiğinde ekran "çakışma sayılamadı" der ve birleştirme başlatılamaz. · **Efor:** 0,25 gün.

**Önceki defter.** Yeni (K6 H-8).

---

### [D-I-14] Yanıt gövdesine ham `err.message` konan beş yüzey — hem teknik sızıntı hem de "uyarıyı kim okuyor" belirsizliği

| Şiddet | S3 | Kategori | I.6 | Öncelik | P4 | Modül | CORE/FAS/OPS | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Beş yerde yakalanan hatanın **ham mesajı** 200 yanıtının içine konuyor. Bu iki ayrı sorun üretiyor: (a) Prisma/pg metni (şema, kolon, SQL parçası) operatör ekranına ve oradan ekran görüntüsüne/WhatsApp'a sızabiliyor; (b) bu uyarılar kalıcı bir deftere **yazılmıyor** — yalnız o anki yanıtta yaşıyorlar, yani operatör kapatınca olay yok oluyor.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:1441-1446` (`dispatchWarning`), `subcontractor.service.ts:3305-3308` (`postWarnings`), `label.service.ts:2062-2064` (`failed[].reason`), `import/import.service.ts:539-541`, `backup.service.ts:318-333` (`warnings`).
- Karşı örnek (doğru davranış): `error.middleware.ts:214-216, 371-376` — CHECK ihlalinde `cause.detail` (ihlal eden satırın tüm kolon değerleri) yanıta **ve** audit'e alınmıyor, gerekçesi yazılı.
- **Koruma kontrolü:** bu beş yolun hiçbirinde `AuditService` çağrısı yok; `grep` ile bir "warning" defteri yok.

**failure_mode.** Fason kabulünde renk değişimi P2002 ile düşer → operatörün tabletinde *"İş emrinin rengi değiştirilemedi: Unique constraint failed on the fields: (`workOrderId`)"* yazar. Operatör anlamaz, ekran görüntüsü alır, mesaj fabrikanın dışına çıkar. Aynı olay hiçbir deftere yazılmadığı için ertesi gün "kaç kez oldu" sorusu cevapsızdır.

**Veride fiili ihlal (K2).** Arandı, ölçülemedi (yanıt gövdeleri saklanmıyor — bulgunun ikinci ayağı budur).

**İş etkisi.** Teknik sızıntı (düşük, LAN içi) + tekrar eden bir arızanın ölçülememesi (asıl bedel).

**Kim, ne zaman fark eder?** Operatör anlık görür, sistem hiç görmez.

**Öneri (2. tur).** Ortak bir `toUserWarning(err)` yardımcısı: `AppError` ise `err.message` (zaten Türkçe ve operatöre göre), değilse sabit metin + `details.code`; ham metin **yalnız** `SYSTEM/ERROR` audit payload'ına. Beş çağrı yeri bu yardımcıdan geçsin. Migration/izin YOK. → G alanıyla ortak.

**Kabul kriteri.** Yapay bir Prisma hatası bu beş yoldan geçtiğinde yanıt sabit Türkçe metin taşır, `system_logs` ham mesajı taşır. · **Efor:** 0,5 gün.

**Önceki defter.** Yeni (K6 H-17).

---

### [D-I-15] `quickStart` telafisi düşerse yetim iş emri + aktif refakat kartı kalıyor; yorum audit'ten söz ediyor ama audit çağrısı yok

| Şiddet | S3 | Kategori | I.2 | Öncelik | P4 | Modül | URE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Hızlı İş Emri akışında top bağlama başarısız olursa telafi olarak WO `hardDelete` edilir. Telafinin kendisi düşerse kullanıcıya "iş emri oluşturulmadı" denir ama sistemde **canlı PLANNED bir WO + ACTIVE bir refakat kartı** kalır. Kod bunu biliyor ve `logOrphanCleanupFailure` adında bir fonksiyon tanımlamış — ama fonksiyon yalnız `console.error` yazıyor; yorumu "audit best-effort sayacı felsefesi; operatör/log yetim WO'yu görebilsin" derken audit çağrısı **yok**.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:1362-1371`
  ```ts
  // ... canlı yetim PLANNED WO + ACTIVE refakat kartı kalır — bunu loglayıp iz bırak
  // (audit best-effort sayacı felsefesi; operatör/log yetim WO'yu görebilsin).
  const logOrphanCleanupFailure = (cleanupErr: unknown): void => {
    console.error(`[quickStart] telafi hardDelete başarısız — yetim WO kaldı (${workOrder.id}) ...`, cleanupErr);
  };
  ```
- `:1373-1380` ve `:1383-1388` — iki çağrı yeri (`attachRolls` throw + `attached === 0`).
- **Koruma kontrolü:** `AuditService` çağrısı yok; mutabakat kontrollerinde "top bağı olmayan PLANNED WO" bölümü yok (`consistency-check-derived.sql` §21 tip aynası, §22 durum aynası — ikisi de bu vakayı yakalamaz; `sql-saha.sh -f` ile koşturuldu, §21/§22 0 satır).

**failure_mode.** Tablette Hızlı İş Emri; `attachRolls` çakışma yüzünden fırlatır; telafi `hardDelete` FK kısıtı (refakat kartı / parti) yüzünden düşer. Operatör "Hiçbir top bağlanamadı; iş emri oluşturulmadı" mesajını görür ve tekrar dener. Panelde ise **top içermeyen, kimsenin açtığını hatırlamadığı** PLANNED bir iş emri durur; açık iş emri sayısını, kart listesini ve planlama ekranını kirletir. Kaynağını açıklayan tek satır pm2 log'undadır.

**Veride fiili ihlal (K2).** Sonda koşuldu: prod kopyasında "PLANNED + hiç top bağı olmayan" WO araması bu turda yapılmadı (→ D-E/D-C'nin yetim taraması); mevcut mutabakat bölümleri temiz.

**İş etkisi.** Yanlış "açık iş emri" sayısı; operatörün açıklayamadığı kayıt (güven kaybı).

**Kim, ne zaman fark eder?** Planlamacı, listede tanımadığı bir İE görünce — sebebini asla öğrenemeden.

**Öneri (2. tur).** `logOrphanCleanupFailure` içine `void AuditService.logEvent({category:"SYSTEM", action:"ERROR", recordId:"ORPHAN_WO_CLEANUP_FAILED", payload:{workOrderId, message}})`. Ek olarak mutabakat setine bir bölüm: "PLANNED, top bağı yok, kart ACTIVE ve N saatten eski" (D-I-03'ün işi). Migration/izin YOK.

**Kabul kriteri.** Telafi düşürüldüğünde `system_logs`'ta `ORPHAN_WO_CLEANUP_FAILED` satırı doğar ve WO id'sini taşır. · **Efor:** 0,25 gün.

**Önceki defter.** Yeni (K6 H-11).

---

### [D-I-16] Kurulum kimliği üretilemezse audit yazılmıyor; kardeş uzlaştırıcı aynı durumda yazıyor (iki iş, iki farklı görünürlük sözleşmesi)

| Şiddet | S3 | Kategori | I.4 | Öncelik | P5 | Modül | OPS | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** Boot işlerinden ikisi aynı desende (5 deneme, tükenince pes et) ama farklı bitiyor: `permission-catalog` tükenince `PERMISSION_CATALOG_RECONCILE_FAILED` audit'i yazıyor; `installation-identity` yalnız `console.error` + `publish(null)`. İkincisi başarısız olursa keşif kimliği hiç doğmaz ve istemcilerin "farklı kurulum" tespiti sessizce devre dışı kalır.

**Kanıt**
- `Teks-Erp/src/jobs/permission-catalog.job.ts:180-195` — `console.error` **+ `AuditService.logEvent(PERMISSION_CATALOG_RECONCILE_FAILED)`**.
- `Teks-Erp/src/jobs/installation-identity.job.ts:200-208` — `console.error(...)` + `publish(null)`, audit **yok**.
- Karşılaştırma verisi: dev DB'de `PERMISSION_CATALOG_RECONCILE_FAILED` **6** satır var (yol fiilen yazıyor), `INSTALLATION_ID_*` yalnız başarı satırları.
- **Koruma kontrolü:** `/api/admin/health.discovery.installationId` alanı `null` gösterirdi — ama o alan da hiçbir istemcide çizilmiyor (D-I-01).

**failure_mode.** Sunucu, DB'nin geç ayağa kalktığı bir yeniden başlatmadan sonra 5 denemede kimliği üretemez. `publish(null)` → mDNS TXT kimliksiz ilan eder, panel "sunucu doğrulanamadı" davranışına düşer. Deftere hiçbir satır yazılmaz, `/health`'in ilgili alanı kimse tarafından okunmaz → kurulum "kimliksiz" çalışmaya devam eder ve sonraki sunucu değişikliğinde istemciler farklı kurulumu ayırt edemez.

**İş etkisi.** Keşif/kimlik doğrulama özelliğinin sessiz kaybı (düşük; sunucunun kendisi çalışır).

**Kim, ne zaman fark eder?** Kimse — özellik "sessizce yok" durumuna geçer.

**Öneri (2. tur).** `installation-identity` tükenme dalına kardeşiyle aynı audit satırını ekle (`INSTALLATION_ID_FAILED`). D-I-01'in ④ önerisiyle birlikte `/health`'te de görünür olur. Migration/izin YOK. · **Efor:** 0,1 gün.

**Kabul kriteri.** DB kapalıyken boot edilen sunucuda, DB açıldıktan sonra `system_logs`'ta `INSTALLATION_ID_FAILED` satırı bulunur.

**Önceki defter.** Yeni (K6 H-19).

---

### [D-I-17] Offsite yedek: "hedef ayarlı değil" ile "ayarı okuyamadım" aynı değere iniyor ve süpürücü bunu yalnız konsola yazıyor

| Şiddet | S3 | Kategori | I.1 | Öncelik | P4 | Modül | OPS | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `getOffsiteHealth()` ilk süpürmeden önce ayarı `readOffsiteRemote().catch(() => "")` ile okuyor → okuma hatası **"yapılandırılmamış"** olarak raporlanıyor. Süpürücü tarafında da `configured:false` durumu bilinçli olarak yalnız `console.warn`'a düşüyor (gürültü önlemek için — makul), ama bu iki karar birleşince "offsite kapalı" ile "offsite ayarını göremiyorum" tek bir sessiz duruma iniyor.

**Kanıt**
- `Teks-Erp/src/services/helpers/offsite-backup.helper.ts:269-273` — `const remote = await readOffsiteRemote().catch(() => ""); return { offsite: { configured: remote.length > 0, state: "henüz-koşmadı" } };`
- `Teks-Erp/src/jobs/offsite-sweeper.ts:53-64` — `configured:false` → `console.warn`; yalnız `configured && !ok` `reportJobFailure`'a gider.
- Karşı örnek (doğru): aynı dosyada `:101` uzak liste hatası `null` döner — *"boş dizi DEĞİL — 'bakamadım' ≠ 'boş'"* (K8 §5).
- Saha durumu: `ecosystem.config.js:143` `BACKUP_RCLONE_REMOTE:""` → F-OPS-VER-003 **hâlâ açık** (K12 satır 37); prod kopyasında `backup.offsiteRemote` anahtarı yok.

**failure_mode.** Offsite hedef panelden ayarlanır. Bir sonraki restart'tan sonra ilk süpürmeye kadar geçen 90 saniyede DB kısa süre erişilemez olur → `readOffsiteRemote()` düşer → `/api/admin/health` `offsite.configured:false` der. Bu değeri gören (ya da ileride buna alarm bağlayan) taraf "offsite hiç ayarlanmamış" sonucuna varır ve gerçek durum (ayar var, okuma düştü) kaybolur.

**İş etkisi.** Felaket kurtarma kapsamının yanlış raporlanması. Bugün etki sınırlı (offsite zaten kapalı), ama F-OPS-VER-003 kapanınca bu satır yanlış güven üretir.

**Kim, ne zaman fark eder?** Kimse — alan zaten hiçbir istemcide çizilmiyor (D-I-01) ve `/api/admin/backups/offsite` ayrı bir uçtan besleniyor.

**Öneri (2. tur).** `configured`'ı üç durumlu yap (`true | false | "unknown"`), `catch` dalında `"unknown"` dön. F-OPS-VER-003 kapanışında `offsite.missingCount > 0` ve `configured === false` için `evaluateAlerts` kuralı yaz. Migration/izin YOK. · **Efor:** 0,25 gün.

**Kabul kriteri.** Ayar okuması düşürüldüğünde health `offsite.configured:"unknown"` döner, `false` demez.

**Önceki defter.** `F-OPS-VER-003` AÇIK (yeniden açılmıyor; bu bulgu onun **raporlama** ayağı).

---

### [D-I-18] `app.listen` hata dinleyicisi yok: port doluysa süreç yeniden başlatma döngüsüne girer ve eski sürüm sessizce hizmet vermeye devam edebilir

| Şiddet | S3 | Kategori | I.4 | Öncelik | P5 | Modül | CORE/OPS | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|

**Özet.** `const server = app.listen(PORT, HOST, cb)` — `server.on("error")` **yok**. `EADDRINUSE` (ya da `EACCES`) durumunda hata dinleyicisiz `'error'` olayı `uncaughtException`'a düşer; oradaki handler audit yazıp `gracefulShutdown(...,1)` çağırır → `exit(1)` → pm2 `restart_delay 4000` ile 10 kez dener, sonra `errored` durumunda bırakır. Audit satırı yazıldığı için tamamen sessiz değil — ama satırı okuyan yok (D-I-02) ve senaryonun tehlikeli varyantında **hizmet kesintisi de yok**, dolayısıyla hiçbir dış işaret çıkmaz.

**Kanıt**
- `Teks-Erp/src/server.ts:79` — `const server = app.listen(Number(PORT), HOST, () => {...})`; dosyada `server.on(` yalnız bu satırdan sonra `server.close` olarak geçiyor, `'error'` dinleyicisi yok.
- `Teks-Erp/src/server.ts:213-228` — `uncaughtException` → audit + `gracefulShutdown(...,1)`.
- `Teks-Erp/ecosystem.config.js:59-62` — `restart_delay: 4000`, `max_restarts: 10`, `autorestart: true`.
- **Koruma kontrolü:** bekçi yok (`grep -rn "EADDRINUSE" Teks-Erp/scripts` → 0; K6 §7 son satırı: process handler'ları için bekçi aranmış, **bulunamamış**).

**failure_mode.** Windows'ta `pm2 restart` sonrası eski süreç portu bırakmaz (kill_timeout 8 sn'lik pencerede kapanmayan bir tx). Yeni süreç `EADDRINUSE` alır, çöker, 4 sn sonra tekrar dener, 10 kez… ve **eski süreç hizmet vermeye devam eder**. Fabrika hiçbir kesinti görmez; `kur.ps1` "kuruldu" der; panel/tablet eski sürümle çalışmaya devam eder. `system_logs`'a `UNCAUGHT_EXCEPTION` satırları düşer (eski sürecin DB'sine!) ama onları okuyan yok. Yeni sürümdeki düzeltmeler sahada yokken var sanılır.

**Veride fiili ihlal (K2).** Arandı, **0**: prod kopyasında `action='UNCAUGHT_EXCEPTION'` satırı yok.

**İş etkisi.** "Deploy edildi ama davranış değişmedi" sınıfı — teşhis edilmesi en pahalı ops arızalarından.

**Kim, ne zaman fark eder?** Kimse; ya da sürüm künyesi karşılaştırması yapılırsa (`/health.version`; 2026-08-27'de tam bu amaçla tek uca alındı) — o da elle.

**Öneri (2. tur).** `server.on("error", (err) => { console.error(...); void AuditService.logEvent({category:"SYSTEM", action:"LISTEN_FAILED", payload:{code:(err as any).code, port:PORT}}); gracefulShutdown("listen-error", 1); })`. Ayrıca `kur.ps1` kurulum sonrası `/health.version`'ı beklenen sürümle karşılaştırsın (dağıtım tarafı, → D-J). Migration/izin YOK. · **Efor:** 0,25 gün.

**Kabul kriteri.** Port meşgulken başlatılan sunucu net bir "port kullanımda" mesajıyla çıkar ve `system_logs`'ta `LISTEN_FAILED` satırı bulunur (DB erişilebilirse).

**Önceki defter.** Yeni (K6 H-14).

---

### [D-I-19] Log içeriği: erişim log'u ve audit kişisel veri taşıyor, rotasyon repo dışında; şifre/PIN sızıntısı YOK (ölçüldü)

| Şiddet | S3 | Kategori | I.6 | Öncelik | P5 | Modül | OPS | Kanıt seviyesi | K2 |
|---|---|---|---|---|---|---|---|---|

**Özet.** İki kanal var: (a) pm2 dosya log'u — morgan `combined` (tarih/IP/UA/**tam URL, sorgu dizesi dahil**) + `console.error` yığın izleri; rotasyon `pm2-logrotate` modülüne bağlı ve **sunucuda kurulu olup olmadığı repodan doğrulanamıyor** (F-OPS-VER-006, HÂLÂ AÇIK — yeniden açmıyorum). (b) `system_logs` — `newData/oldData` tam kayıt JSON'u; müşteri satırlarında VKN/e-posta/telefon/adres var. Olumlu ölçüm: **hiçbir audit satırında şifre/PIN/kart jetonu yok.**

**Kanıt (K2 — prod kopyası)**
```sql
SELECT DISTINCT jsonb_object_keys("newData") FROM system_logs WHERE "tableName"='CUSTOMER';
-- taxNumber, email, contactPhone, address, contactName, city, district, country, exportCode, ...
SELECT count(*) FROM system_logs WHERE "newData" ?| array['taxNumber','phone','email','taxOffice'];   -- 37
SELECT count(*) FROM system_logs
 WHERE "newData" ?| array['password','quickPin','cardToken','passwordHash']
    OR "oldData" ?| array['password','quickPin','cardToken','passwordHash'];                          -- 0  ✔
```
- `Teks-Erp/src/app.ts:119-121` — `morgan(isProd ? "combined" : "dev")`, özel token/maskeleme yok.
- `Teks-Erp/ecosystem.config.js:68-72` — `out_file`/`error_file` sabit yollar + *"Rotasyonu pm2 kendisi YAPMAZ: pm2-logrotate modülü gerekir (runbook)"*.
- Saklama: `AuditService.archiveOlderThan(6)` (6 ay) + arşiv tablosu; yani kişisel veri en az 6 ay sıcak tabloda ve **her `pg_dump` yedeğinde** (30 gün saklama) çoğalıyor.

**failure_mode.** Bir müşteri kaydı düzeltilir; VKN + telefon + adres `system_logs.newData`'ya yazılır. Bu satır 6 ay sıcak tabloda kalır, ardından arşive taşınır (silinmez), her gece yedeğine girer ve yedek dosyaları `BACKUP_DIR`'de 30 gün durur. Erişim: `admin:settings` taşıyan herkes Sistem Kayıtları ekranından okuyabilir. Ayrıca `GET /api/customers?search=<ad>` gibi istekler pm2 log'una **tam URL** ile yazılır; rotasyon kurulmadıysa dosya sınırsız büyür (log ve DB aynı diskte — F-OPS-VER-006'nın ikinci ayağı).

**İş etkisi.** KVKK maruziyeti (düşük — LAN-only, yetki arkasında) + disk riski (rotasyon).

**Kim, ne zaman fark eder?** Disk %80'i geçince `evaluateAlerts` uyarır — yine yalnız Sunucu Durumu sayfası açıksa (D-I-02).

**Öneri (2. tur).** ① `pm2-logrotate` kurulumunu deploy kontrol listesinde **doğrulanabilir** adım yap (kurulum sonrası `pm2 conf pm2-logrotate` çıktısı runbook'a yapıştırılsın) — F-OPS-VER-006'nın açık kalan ayağı. ② Sorgu dizesindeki `search=`/`q=` parametrelerini morgan'da maskele (özel token). ③ Audit'te kişisel alan maskeleme **önerilmiyor** (izlenebilirliği bozar); bunun yerine arşiv/saklama süresi ve `admin:settings` kapsamı dokümante edilsin. ④ Yedek dosyalarının bulunduğu klasörün NTFS izinleri runbook'ta. Kod değişikliği asgari. · **Efor:** 0,5 gün (çoğu ops).

**Kabul kriteri.** Runbook'ta rotasyonun kurulu olduğunu **ölçen** bir adım var; `search` parametreleri log'da maskeli.

**Önceki defter.** `F-OPS-VER-006` (HÂLÂ AÇIK, repo ayağı kapanmış) — yeniden açılmıyor, yalnız referans + yeni kişisel-veri ölçümü eklendi.

---

## Uygulanan kontrol listesi

| Madde (görev metni) | Durum |
|---|---|
| (1) K6 yutma tablosundaki HER satırın değerlendirilmesi | **uygulandı** — §3.A (27 satır: audit sonrası çift katman → zararsız, "Doğru yapılanlar"a taşındı), §3.B (13 satır), §3.C (49 bağsız catch, 8 grup), §3.D (18 satır), §3.E (kontrol akışı — yutma değil) tek tek okundu. Bulguya dönüşenler: D-I-06/07/08/09/13/15/17. Bilinçli/gerekçeli sayılıp bulgu YAZILMAYANLAR ve sebepleri "Doğru yapılanlar"da listelendi. |
| (1b) Etiket basılmadı ama kayıt "basıldı" | **uygulandı** → D-I-06 (tersi de var: kâğıt çıktı, kayıt yok). |
| (1c) Audit yazılmadı | **uygulandı** → D-I-09 (yazılmayan yollar), D-I-11 (aktörsüz yazım), D-I-15/16 (yazılması gereken yerde yok). |
| (1d) Cache tazelenmedi | **kapsam dışı — sebep:** `reason-preset` bayat-serve + arka plan tazeleme (2026-08-26) ve `feature-flag` `cacheGeneration` guard'ı bilinçli tasarım; yutma noktası gerekçeli (`reason-preset.service.ts:138-146`) ve fail-closed tabanı korunuyor. Eşzamanlılık ayağı D-A'nın. |
| (1e) Job atlandı | **uygulandı** → D-I-05 (yedek), D-I-16 (kimlik). `backup-scheduler` damgası BAŞTA konusu K8 HOTSPOT-1'de ②'ye soruldu: **kabul edilebilir bulundu** (BACKUP_FAILED audit'i yazılıyor → "sessiz atlama" değil); asıl boşluk sahada scheduler'ın devrede olmaması + tespit yokluğu → D-I-05. |
| (1f) `changeWidth/Color` best-effort fason kabulde | **uygulandı** → D-I-08. |
| (2) fire-and-forget: hata nereye gider, `unhandledRejection` var mı | **uygulandı** — `server.ts:202-228` iki handler da VAR ve audit yazıyor (politika: reject → ayakta kal, exception → kapan). 46 `void` promise'in reddini K6 tablosuna göre tek tek izledim; kaçak aday yalnız `latency-persist.service.ts:113-184` (dış `try`'da `catch` yok, yalnız `finally`) → o da handler'a düşer ve süreç ayakta kalır, kaybolan yalnız o pencerenin gecikme delta'sıdır (özet veri). **Bulgu yazmadım** (failure_mode "5 dk'lık gecikme özeti kaybı" — S4 altı); Öneriye D-I-02'de değinildi. |
| (2b) `void runBackupJob/runCopyJob` ALS bağlamı [VARSAYIM 16] | **uygulandı ve VARSAYIM ÇÜRÜTÜLDÜ (K2).** Prod kopyasında elle tetiklenmiş 7 `BACKUP_COMPLETED` satırının **hiçbirinde** `userId`/`ipAddress`/`requestId` yok; `BACKUP_TRIGGER` (route katmanı) yalnız `userId` taşıyor. Yani arka plan işinin audit satırı tetikleyen isteğe bağlanmıyor. Kök sebep ALS değil: `AuditService.logEvent` `ipAddress`i ALS'ten OKUMUYOR ve `deviceId` hiç yazmıyor → D-I-12. |
| (3) audit best-effort: `/health` sayacını KİM izliyor | **uygulandı** → D-I-02 (kimse; `auditWriteFailures` yalnız Sunucu Durumu sayfası açıkken uyarıya dönüyor) + D-I-01. |
| (3b) Audit düşerse yıkıcı işlemin izi yok — hangi uçlarda kabul edilemez | **uygulandı.** Kabul edilemez küme: `POST /rolls/:id/scrap` · `softDelete` (iptal) · `shipping:undo-dispatch` (storno) · WO kapanış dispozisyonu · `master-data-merge` · 12 `/permanent` ucu · yedek geri yükleme. Bunlar için audit **aynı havuzdan** yazılıyor (`audit.service.ts:83`, `:179`) → havuz doygunluğu anında hem işlem geçer hem iz düşer (K6 H-18). Öneri D-I-02 ③'te: bu uçlarda audit yazımı **fail-loud** olmalı (işlem geri alınmasın ama yanıt "iz yazılamadı" uyarısı taşısın + sayaç). Ayrı bulgu açmadım: kök neden D-I-02'nin (izleyen yok) ve D-I-09'un (iz yok) birleşimi. |
| (3c) `AppError.internal` + wBR tükenmesi audit'sizliği | **uygulandı** → D-I-09. |
| (3d) `PrismaClientValidationError` audit'sizliği | **uygulandı** → D-I-09. |
| (4) Rollback sonrası yan etkiler (etiket, dosya) geri alınabiliyor mu | **uygulandı** → D-I-06 (kâğıt: geri alınamaz, kaydı da güvence altında değil), D-I-15 (telafi düşerse yetim kayıt). Dosya tarafı: `backup.service.ts:236-292` `.part` → doğrula → `rename` zinciri **doğru** (yarım dosya yayınlanmaz) ve `sweepStaleParts` bayat `.part`'ı budar → "Doğru yapılanlar". DDL tarafı: `db-copy` başarısızlıkta `DROP DATABASE IF EXISTS ... WITH (FORCE)` ile temizliyor → doğru. |
| (5) Korelasyon: request id / ALS job'larda boş | **uygulandı** → D-I-12 (+ K2 ölçümü: SYSTEM 0/27, AUTH deviceId 0/15, DOMAIN 103/187). Job'larda boş olması **bilinçli ve doğru** (`request-context.ts:48-52` gerekçesi) — bulgu değil. |
| (6) İZLEME/ALARM: mükerrer, negatif metraj, dengesiz sevk, yetim kayıt | **uygulandı** → D-I-03 (mutabakat koşmuyor) + D-I-02 (alarm kanalı yok). Negatif metraj için DB CHECK seddi VAR (23514 → 409 + `CHECK_VIOLATION` audit) → "Doğru yapılanlar". Mükerrer için panel VAR ama pull. |
| (6b) Cron çalışmadı fark ediliyor mu | **uygulandı** → D-I-05. `audit.lastArchiveAt` (saha: 2026-08-16) ve `backup.lastNightlyAt` (saha: 2026-08-25T00:05Z) SystemSetting'te duruyor ama **hiçbir sağlık alanında/istemcide yok** — "iş hiç uyanmadı" sorusunun cevabı elle SQL. |
| (6c) `consistency-check.sql` elle koşuluyor | **uygulandı** → D-I-03; ayrıca iki dosyayı prod kopyasına karşı **koşturdum** (§12: 15 satır, §13: 2 satır). |
| (6d) `job-failure.ts` ne yapıyor (DB'ye mi, log'a mı) | **uygulandı** — DB'ye **ve** log'a: `console.error` + `SYSTEM/ERROR recordId='JOB_FAILED:<job>'` + havuz zaman aşımıysa `recordPoolTimeout`. Tasarım doğru → "Doğru yapılanlar". Boşluk okuyan tarafta (D-I-02); K2: prod'da `JOB_FAILED:%` **0 satır** (yol canlıda hiç tetiklenmemiş, yani alarm da hiç sınanmamış). |
| (6e) Backup başarısızlığı fark edilir mi (sahada scheduler kapalı) | **uygulandı** → D-I-05 (K2: 40 günde 1 nightly `BACKUP_COMPLETED`). |
| (6f) Offsite sweeper hatası | **uygulandı** → D-I-17. |
| (6g) mDNS sessiz kapanma | **uygulandı** → D-I-01 (durum `/health`'te var, çizen yok). |
| (7) MUTABAKAT işleri var mı, sonucu izleniyor mu | **uygulandı** → D-I-03. Var (2 dosya + 2 mekanik ikiz, 26 bölüm), izlenmiyor. |
| (8) Log içeriği: morgan + console.error → pm2; rotasyon; kişisel veri | **uygulandı** → D-I-19 (F-OPS-VER-006 referanslı, yeniden açılmadı). |
| (9) 5xx sınıflandırma ↔ istemci davranışı; deadlock 40P01 kullanıcıya ne dönüyor | **uygulandı** → D-I-04 (40P01 → 500 generic; 40001 → 409; mobil 5xx'i 3 kez dener). "timeout ≠ yazılmadı" sözleşmesi ve 503/`Retry-After` **tutarlı** → "Doğru yapılanlar"; tek kalan sızıntı `Retry-After`'ın CORS `exposedHeaders`'ta olmaması (K6 H-13 → D-F'nin alanı, sınır ötesi notlarda). |
| (Kritik yazma yolu 8-soru) | **kısmen uygulandı — sebep:** 8-soru şablonu eşzamanlılık/değişmez eksenlidir (D-A/D-B/D-E'nin ana aracı). Bu alanda yalnız **soru 8'in gözlemlenebilirlik ayağı** ("bozuluyorsa fabrikadaki gerçek etkisi ne, ve KİM FARK EDER") her bulguya uygulandı. Yarış senaryosu üreten bulgu yazmadım → `cakisma_senaryosu` alanı bilerek boş. |
| Repro (K3) | **kapsam dışı — sebep:** repro yükümlülüğü D-A ve D-B'ye ait (`_FINDER-BRIEF` sözleşmesi). Bu alanda kanıt kod + prod-kopyası ölçümüyle kuruldu; D-I-04 için önerilen bekçi zaten bir repro reçetesidir (`SET statement_timeout='50ms'` + kasıtlı deadlock). |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **`error.middleware`'in sınıflandırma ölçütü yazılı ve doğru.** *"Ayrımın ölçüsü 'hata mesajı ne diyor' değil: istemcinin gönderdiği veriyi değiştirerek bu hatadan kurtulabilir mi?"* (`error.middleware.ts:145-147`) — ve tanınmayan Prisma kodu **fail-loud** (500 + `unclassified:true` audit, `:563-585`). Sektörde yaygın olan "bilinmeyeni 400'e at" varsayılanının tersi; korunmalı. D-I-04/09/10 bu ölçütün **kapsamadığı** yolları gösteriyor, ölçütü değil.
2. **Yıkıcı olmayan ama geri alınamaz yan etkilerde `.part` → doğrula → `rename` zinciri.** `backup.service.ts:236-292` yarım `pg_dump` çıktısını asla yayınlamaz; `sweepStaleParts` (`:368-385`) bayat parçaları budar; `pg-tool.helper.ts:105-110` `spawn(..., {timeout, killSignal:"SIGKILL"})` ile asılı child'ı öldürür. "Yarım dosya taze yedek gibi görünüyordu" sınıfı kapatılmış.
3. **`job-failure.ts` deseni: konsol + kalıcı defter + metrik, tek yardımcıda.** `reportJobFailure` üç kanalı birden besliyor ve `AuditService` zaten kendi hatasını yutuyor → çağıran hiçbir durumda düşmüyor. Yeni bir zamanlanmış iş eklendiğinde tek satırla bağlanıyor.
4. **`process.on("unhandledRejection"/"uncaughtException")` VAR, ikisi de audit yazıyor ve politikaları AYRI** (`server.ts:196-228`): reject → logla ve ayakta kal (LAN-only tek process, gereksiz restart vardiyayı keser); exception → logla ve temiz kapan (`uncaughtException`'da audit için 2 sn `Promise.race` tavanı, sonra `gracefulShutdown(…,1)`). Gerekçe kaynakta yazılı.
5. **"Sayamadım ≠ yok" kuralının yazılı olduğu yerler.** `master-data-merge.service.ts:1023-1026` (`countRows` → `null`) ve `offsite-backup.helper.ts:101` (uzak liste hatası → `null`, boş dizi değil). D-I-13/17 tam olarak bu kuralın **uygulanmadığı** iki kardeş yolu gösteriyor — yani kural doğru, kapsaması eksik.
6. **CHECK ihlalinde satır değerleri sızdırılmıyor.** `error.middleware.ts:371-376` — `cause.detail` ("Failing row contains (...)") ne yanıta ne audit'e alınıyor; constraint adı + istek yolu yeterli sayılıyor. Bekçi `test_check_violation_mapping.ts` gerçek PG hatasıyla ölçüyor.
7. **Audit'te şifre/PIN/kart jetonu YOK — ölçüldü** (prod kopyası, `?|` operatörüyle 4 anahtar arandı → 0 satır). `BaseController.sanitizeWriteData` + audit diff katmanı bu sınıfı fiilen kapatmış.
8. **`.catch(() => undefined)`'ların 27'si `AuditService` çağrısının hemen ardında** (K6 §3.A) — yani "audit fırlatabilir" yanılgısını taşıyan gereksiz ikinci katman; **zararsız** oldukları doğrulandı (fonksiyon zaten yutuyor). Bulgu yazılmadı; temizlik önerisi L alanına bırakıldı.
9. **Best-effort düşüşü kullanıcıya söyleyen kalıp var ve çalışıyor:** `postWarnings` / `dispatchWarning` / `failed[]` / `ApiResponse.warnings`. Sorun kalıbın yokluğu değil, **eşit uygulanmaması** (D-I-08) ve ham hata metni taşıması (D-I-14).

---

## Sınır ötesi notlar

- **→ D-A (Eşzamanlılık):** D-I-04'ün deadlock ayağı doğrudan K3a'nın ABBA adaylarına bağlı (`createBatchTx`/8022 ↔ `touchWorkOrderTx` sırası; `order-status.helper.ts:205-210` kilit protokolü). 40P01 **bugün** 500 döndüğü için, bir ABBA gerçekleşse bile defterde "deadlock" diye görünmez, `DriverAdapterError` diye görünür — D-A'nın canlı kanıt araması bu adı da kapsamalı.
- **→ D-B (Mükerrer/idempotency):** `seedRollLabelSnapshot`'ın `{success:true, seeded:false}` dönüşü, beceri §8'in "iptal edilmiş kaydın replay'inde `success:true` dönmek" tuzağının akrabası (sessizce yanlış cevap 409'dan kötüdür). Ayrıca D-I-06'daki tekrar-denemesiz `recordPrintEvent`, uç her çağrıda `labelPrintedAt`i tazelediği için idempotent — mutation'a çevrilirken bu özellik korunmalı.
- **→ D-C (Veri modeli):** `system_logs.tableName` iki yazım kuralı taşıyor (`ITEM`/`items`, `COLOR`/`colors`, `SUBCONTRACTOR`/`subcontractors`) — kanıt D-I-11'in sorgusunda. "Bu tabloya kim dokundu" sorgusu tek anahtarla cevaplanamıyor. Ayrıca K6→C notu (2026-07-23/28 havuz zaman aşımı satırlarının aktif tabloda ve arşivde **0** olması) bu turda yeniden ölçüldü: prod kopyasında `SYSTEM/ERROR` yalnız 2026-08-05/06 aralığında, 15 satır — 2026-07 olaylarının izi gerçekten yok (arşiv de boş). Nereye gittiği hâlâ açık → D-C/D-J.
- **→ D-D (Tx sınırları):** `recordPrintEvent` üç yazımı tx'siz (D-I-06); kardeş kart yolu (`traveler-card.service.ts:367-386`) tx kullanıyor — aynı sınıfta iki sözleşme. `AuditService` çağrılarının tx dışı olduğu K3a/K3b tarafından doğrulanmış; buradan bir itiraz yok.
- **→ D-E (İş kuralı):** D-I-06 doğrudan "ölü etiket" değişmezini deliyor (`labelPrintedAt` NULL kalırsa `inventory.softDelete` guard'ı kör). D-I-08 "fason çekisi WorkOrder.width'ten beslenir" kuralını sessizce bozuyor. D-I-15 "PLANNED WO ⇒ en az bir top bağı" gibi yazılı olmayan bir beklentiyi kırıyor — D-E bunu değişmez olarak tanımlamak isteyebilir.
- **→ D-F (API/Express):** `Retry-After` gönderiliyor ama CORS `exposedHeaders`'ta yok (`app.ts:114` ↔ `error.middleware.ts:238-241`; `test_middleware_order.ts` listeyi donduruyor) — D-I-12'nin `X-Request-Id` önerisiyle **aynı dokunuşta** çözülmeli. `seedRollLabelSnapshot` ucunun Swagger'ı "200: Snapshot yazıldı" diyor ama `{seeded:false}` de 200 dönüyor (sözleşme yalanı).
- **→ D-G (Güvenlik):** D-I-14 (ham `err.message` 200 gövdesinde) doğrudan G'nin sızıntı ekseni; `/api/admin/health.lastAuditError/lastPoolTimeoutError` ham metin taşıyor (guard'lı, `app.ts:448-450`). D-I-19 kişisel veri ölçümü G ile ortak. D-I-01'in `auditGuard` bulgusu G'nin log-değiştirilemezlik ekseniyle kesişiyor.
- **→ D-H (Performans):** D-I-04'ün 57014 ayağı doğrudan performans: 50 sn'lik bir sorgu 3 kez koşuyor. K7b'nin tavansız `findMany` listesi (stok karnesi, müşteri karnesi, plan-sapma, denge) bu sınırın en olası tetikleyicileri.
- **→ D-J (Migration/kurtarma):** D-I-05 (yedek tespiti) ve D-I-18 (`EADDRINUSE` → eski sürüm sessizce hizmet verir) J'nin deploy ekseniyle kesişiyor. `backup.lastNightlyAt` dolu ↔ `BACKUP_SCHEDULE_ENABLED:"false"` çelişkisi (K9 H-9) bu turda yeniden doğrulandı: saha env'i repo ile ayrışmış olabilir, canlıya erişim olmadığı için karar J'ye bırakıldı. `app-version.ts:15-21` fallback `"1.0.0"` (K6 H-16) da J'nin alanı.
- **→ D-K (Test):** bekçisi olmayan hata yolları: process handler'ları + `gracefulShutdown` bütçeleri + pm2 `shutdown` mesajı (grep 0), statü taşıyan http-errors (D-I-10), `AppError.internal`/`withBarcodeRetry` tükenmesi (D-I-09), 57014/40P01 varış dalı (D-I-04), `PrismaClientValidationError` audit'sizliği, `drawQr/drawCode128` düşüşü (D-I-07), `/api/admin/health` alanlarının istemcide okunduğu (D-I-01). Ayrıca `test_consistency*.ts` **canlıya karşı** hiç koşmuyor — K11'in "bekçi kör noktası" sınıfının ops ikizi.
- **→ D-L (Kod kalitesi):** `AppError.isOperational` ölü alan (errorHandler okumuyor); 27 gereksiz `.catch(() => undefined)`; `instanceof` + `constructor.name` çift kontrol (3 yer); P2002 fallback mesajında İngilizce kırıntı ("(unique constraint)"); `catch (…) { next(err) }` 492 kez elle kopyalanmış (sarmalayıcı yok — kopyalardan biri `next` yerine `console.error` yazsa hata sessizce yutulur; bugünkü ölçüm 0).

---

## Kapsanmayan / erişilemeyen

- **Canlı prod'a erişim yok.** Tüm DB ölçümleri 2026-08-25 kopyası (`tekserp_saha_0825`, 190/195 migration) ve dev (`adnansahin_db`) üzerinden. `audit_guard`, `BACKUP_SCHEDULE_ENABLED`, `pm2-logrotate` kurulumu, `BACKUP_DIR` içeriği ve gerçek `ecosystem.config.js` env'i canlıda **doğrulanamadı** → D-I-01 ve D-I-05'te [VARSAYIM] işaretli.
- **Per-DB GUC'lar kopyada yok** (`pg_db_role_setting` yalnız yerel kümenin DB'lerini gösteriyor) → `statement_timeout=50s`'nin prod'da yürürlükte olduğu dolaylı (ARCHITECTURE/CLAUDE.md/docker-compose) kabul edildi.
- **57014/40P01/25P03'ün yüzeye çıkış SINIFI ölçülmedi** (K6'nın da kapsanmayanı). 23514 için `test_check_violation_mapping.ts` ile ölçülmüş şekil (çıplak `DriverAdapterError`) aynı `default` dalından geldiği için varsayıldı. Kesinleştirme, D-I-04'ün önerdiği bekçinin ilk işidir.
- **`test_consistency.ts` / `test_consistency_derived.ts` TypeScript ikizleri koşturulmadı** (yalnız `.sql` kardeşleri `sql-saha.sh -f` ile koşturuldu). İkizin ek bölümü **§20 (`WorkOrderStep.status` mutabakatı)** SQL dosyasında yok → bu turda **ölçülmedi**; CLAUDE.md 2026-08-22 notu §20'nin prod'da kırmızı olduğunu ve sebebinin "sorgunun kör noktası" olduğunu söylüyor.
- **pm2 log dosyalarının kendisi okunmadı** (sunucuda; darwin ortamda yok). "console.error'a düşen her şey pm2 log'unda" iddiası `ecosystem.config.js:70-72` yapılandırmasından çıkarıldı, dosya görülmedi.
- **Electron/mobil hata yüzeylerinin tamamı taranmadı.** Yalnız bu bulguların dokunduğu yerler okundu: `serverHealth.ts`, `ServerStatusPage.tsx`, `mobil/src/offline/{mutations,entryAttempt}.ts`, `mobil/src/components/LabelPrinter.tsx`, `mobil/src/services/label.service.ts`. "Bu uyarıyı istemci çiziyor mu" sorusu yalnız D-I-01/06/08 için tek tek doğrulandı.
- **`scripts/` altındaki 366 bekçinin gövdeleri okunmadı**; hata dallarını ölçüp ölçmedikleri ad/anahtar grep'i + K6 §7 + K11 üzerinden çıkarıldı. `test_observability_contract.ts`'in `PrismaClientValidationError` dalını ölçüp ölçmediği **okunmadı** (K6'nın da açık bıraktığı nokta).
- **3-6k satırlık servislerde** (`label`, `shipping`, `inventory`, `subcontractor`, `workorder`, `tambur`) yalnız bu bulguların aralıkları okundu; K6'nın 90 yutan `catch` + 66 `.catch` sınıflandırması tarayıcı çıktısı olarak kabul edildi ve 12 satır kaynaktan tek tek doğrulandı.
- **Repro (K3) yapılmadı** — sözleşme gereği D-A/D-B'nin yükümlülüğü. D-I-04 ve D-I-07 için önerilen bekçiler birer repro reçetesidir.
- **Alarm kanalı önerisinin (D-I-02 ③) fabrika kabulü** ölçülmedi: panelin her ekranında rozet göstermek bir UX kararıdır; kullanıcı tercihi (`MEMORY.md → şık sunma tercihi`) uyarınca 2. turda somut şıklarla sorulmalı.
