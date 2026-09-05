# TUR 3 · S-5 — SENARYO: SİSTEM / OPS

> Denetçi: S-5 (senaryo merkezli, ② BULMA · TUR 3) · Dal `adnansahin`, HEAD `ce8681d1`
> Mercek: gerçek ops akışlarını uçtan uca izle, her adımda Bölüm 4.1'in **8 sorusunu** uygula, iki-aktörlü çizelge kur.
> Kapsam: (S5a) restart tx ortasında · (S5b) DB kopyası / yedek üretim sürerken · (S5c) Excel içe aktarım ·
> (S5d) ana veri birleştirme ↔ saha yazması · (S5e) audit arşivi · (S5f) izin/rol değişikliği ↔ açık oturum · (S5g) feature-flag yarışı.
>
> ## ⚠️ BU KOŞUMUN EN ÖNEMLİ SINIRI — K2/K3 ÜRETİLEMEDİ
> Denetim boyunca **veritabanına hiç bağlanılamadı**. `audit/tools/sql-saha.sh` ve `sql-dev.sh` ikisi de aynı hatayı verdi:
> ```
> psql: error: connection to server at "localhost" (::1), port 5432 failed:
> FATAL:  Postgres.app failed to verify "trust" authentication
> DETAIL: ... the user that started the server is no longer logged in.
> ```
> `pg_isready` "accepting connections" diyor, yani sunucu ayakta ama Postgres.app'in trust doğrulaması bu oturumda çalışmıyor (masaüstü oturumu kapalı).
> Sonuç: **hiçbir bulguya K2 (veride fiili ihlal) ya da K3 (repro) eklenemedi** → `_FINDER-BRIEF` §Kanıt merdiveni gereği
> **hiçbir bulgu S0 yazılmadı ve K1'de kalanlar S1'i geçmedi.** Her bulgunun "Veride fiili ihlal" satırında
> hangi sorgunun koşulması gerektiği YAZILI; ③/④ turunda DB açıldığında bunlar mekanik olarak koşulabilir.
> Repro scripti de bu yüzden YAZILMADI: sözleşme (`audit/repro/_REPRO-SOZLESMESI.md`) "ölçüm commit SONRASI, DB'DEN"
> diyor; koşulamayan bir script repoya sahte bir bekçi olarak girer. Yerine her bulguda **çizelge + kabul kriteri** var.

---

## 0. SENARYO HARİTASI — hangi akış nereye çıktı

| # | Senaryo | Sonuç | Bulgu |
|---|---|---|---|
| S5a | pm2/Windows kapanışı bir yazmanın tam ortasında | **BOZULUYOR** — kapanış bütçesi (5 sn) iş bütçelerinden (20 sn tx · 120 sn merge · 3 sa child) kısa; tx'ler güvenle geri sarar ama **tx dışında ilerleyen çok-adımlı işler** yarım kalır | S-5-01, S-5-02, S-5-03, S-5-06 |
| S5b | DB kopyası / yedek üretim sürerken restart | **BOZULUYOR** — tekil-koşum garantisi ve 3 saatlik child üst sınırı ikisi de EBEVEYNİN BELLEĞİNDE; süreç ölünce ikisi de yok olur, iş sürmeye devam eder | S-5-03 |
| S5c | 2.000 satırlık Excel içe aktarım + "Tekrar Dene" | **BOZULUYOR** — replay anahtarı ve satır bazlı iz İKİSİ DE en sonda; siparişte yeniden yükleme mükerrer sipariş üretir | S-5-02 (önceki defter: `BULGU-T1-008`) |
| S5d | Birleştirme sürerken tablet o müşteriye/kumaşa yazıyor | **BOZULUYOR** — kilit yalnız merge'ler arasında; READ COMMITTED'da taşımadan SONRA doğan satır mezar taşına bakar kalır | S-5-04 |
| S5e | Audit arşivi (6 ay) + yoğun yazma + `audit_guard` | Tx/`SET LOCAL` tarafı **KORUNUYOR** (atomik, sıra doğru) — ama arşivin kendisi **ilk gerçek koşumunda düşecek** (batch × kolon = bind parametresi sınırı) ve sayaç yalan söylüyor | S-5-05, S-5-07 |
| S5f | İzin/rol değişikliği ↔ açık oturum (30 gün token) | **KORUNUYOR** — `tokenVersion` her istekte taze okunuyor ve her izin yazımında ATOMİK bump ediliyor; süreli izinler token `exp`'ini kırpıyor | Bulgu yok (bkz. §Doğru yapılanlar) |
| S5g | İki admin aynı anda farklı bayrak yazıyor | **KORUNUYOR** — her bayrak KENDİ `SystemSetting` satırı (JSON blob DEĞİL) → §3.3 lost update yok; aralık doğrulaması Zod'a taşınmış (F228) → orta-döngü 400 imkânsız; cache invalidate COMMIT'ten SONRA + `cacheGeneration` guard'ı | Bulgu yok (bkz. §Doğru yapılanlar) |

---

## 1. S5a — KAPANIŞ (pm2 restart / Windows shutdown mesajı) BİR YAZMANIN TAM ORTASINDA

### 1.1 Akış (dosya:satır)

```
pm2 restart / pm2 delete            (deploy/kur.ps1:190 "[4/9] pm2 uygulamasi durduruluyor")
  └─ Windows'ta POSIX sinyali YOK → pm2 IPC "shutdown" mesajı  (ecosystem.config.js:56 shutdown_with_message)
       └─ server.ts:194  process.on("message") → gracefulShutdown("pm2 shutdown")
            ├─ server.ts:149-152  forceTimer = setTimeout(process.exit(1), 5000)   ← SERT TAVAN
            ├─ server.ts:160-165  Promise.race([ flushLatencyNow + stopMdnsAdvertiser , 2000ms ])
            └─ server.ts:166-186  server.close(cb) → prisma.$disconnect() → pool.end() → process.exit
  pm2 tarafında kill_timeout = 8000 (ecosystem.config.js:58)
```

### 1.2 Yield noktaları ve bütçe karşılaştırması

| Bütçe | Değer | Kaynak |
|---|---|---|
| Kapanışın kendine verdiği süre | **5.000 ms** (sonra `process.exit(1)`) | `server.ts:149-152` |
| pm2'nin uygulamaya verdiği süre | 8.000 ms | `ecosystem.config.js:58` |
| Global interaktif tx tavanı | **20.000 ms** | `src/lib/prisma.ts:89-91` |
| Ana veri birleştirme tx tavanı | **120.000 ms** | `master-data-merge.service.ts:61, 711` |
| `pg_dump`/`pg_restore`/`rclone` üst sınırı | **3 saat** | `pg-tool.helper.ts:53` |
| İçe aktarım (tx YOK, satır satır) | tavansız (10.000 satıra kadar) | `import.service.ts:508-544`, `import-coerce.ts:127` |

**Yorum:** kapanış bütçesi, sistemdeki hiçbir uzun yazmanın bütçesini kapsamıyor. `server.close()` uçuştaki
istekleri BEKLER ama 5 sn'de bitmeyen her şey `process.exit(1)` ile kesilir — ve o noktada
`prisma.$disconnect()`/`pool.end()` **hiç koşmaz** (ikisi de `server.close` callback'inin içinde, `server.ts:171-181`).

### 1.3 Çizelge

```
T1 (operatör/admin):  t=0    POST /api/import/item/apply  (1.800 satır)
                      t=0..  satır satır adapter.createOne → 900 kayıt YAZILDI ve COMMIT'lendi
T2 (deploy):          t=40s  kur.ps1 [4/9] → pm2 delete → IPC "shutdown"
                      t=40s  gracefulShutdown: forceTimer 5 sn
                      t=45s  process.exit(1)
SONUÇ:                900 ana-veri kaydı DB'de; `import_runs` satırı YOK (import.service.ts:552);
                      satır bazlı audit YOK (auditEntries dizisi BELLEKTE, logMany :577 hiç koşmadı).
```

### 1.4 8 soru — içe aktarım yazma yolu

| # | Soru | Cevap |
|---|---|---|
| 1 | Hangi değişmez? | "Bir içe aktarım koşumu ya tamamen yazılır ya da NE yazıldığı kayıt altındadır" (dosya başlığındaki dürüst sözleşme, `import.service.ts:12-25`) |
| 2 | Tek `$transaction`? | **HAYIR ve bilinçli** (adapter-pg'de servis yazımları tx dışına kaçar) — sözleşme "İLK HATADA DUR + PARTIAL + `stoppedAtRowNo`" |
| 3 | Check-then-act? | Evet — `prepareRows` doğrular, döngü sonra yazar; arada dünya değişebilir (kabul edilmiş) |
| 4 | Kilit / guard'lı claim? | Yok; yazma mevcut servislerin kendi guard'larından geçer |
| 5 | Küme kararı? | Evet (dosya bütünü) — koruma "önce hepsini doğrula" |
| 6 | DB kısıtı son savunma? | `ImportRun.clientToken @unique` — **ama satır ancak koşum BİTİNCE yazılır** |
| 7 | İki aktörle bozuluyor mu? | **EVET** (yukarıdaki çizelge) |
| 8 | Fabrikadaki etkisi? | Sipariş içe aktarımında mükerrer sipariş; diğer varlıklarda "ne yazıldı" sorusu cevapsız |

---

## 2. S5b — DB KOPYASI / YEDEK ÜRETİM SÜRERKEN

### 2.1 Akış

```
POST /api/admin/db-copies            → db-copy.service.startCopyJob (:368)
  :373  if (currentJob) return "Zaten bir kopya işlemi sürüyor."   ← BELLEK
  :379  if (isBackupRunning())      return "Şu anda yedek alınıyor"  ← BELLEK (backup.service.ts:162,221)
  :399-415  ATOMİK CLAIM — buraya kadar await YOK (tek thread) ✔
  :437  void runCopyJob(...)                                        ← 202 sözleşmesi
        :520  persistRecord(state:"running")   ← DB'ye "koşuyor" damgası
        :544-570  CREATE DATABASE (statementTimeoutMs: 0)
        :581-592  pg_restore  → runTool → spawn(timeout: 3sa)       ← ÇOCUK SÜREÇ
        :632-648  verifyCopy + finishJob(state:"ready"|"failed")
```

### 2.2 Yield noktaları

`runCopyJob` içinde **9 await** var; hepsi tx dışı ve hepsi restart'a açık. Kritik olanı `:583` —
`pg_restore` dakikalarca sürer ve o süre boyunca sürecin tek "sahiplik" izi bellekteki `currentJob`'tır.

### 2.3 Çizelge

```
T1 (admin):   t=0     "Yedekten kopya oluştur" → pg_restore başlar (10 dk sürecek)
T2 (ops):     t=2dk   kur.ps1 / pm2 restart → 5 sn sonra process.exit(1)
              t=2dk   ⚠ pg_restore ÖLMEZ: spawn `detached` değil ama Node ebeveyn ölünce çocuğu
                      ÖLDÜRMEZ; `timeout` seçeneği EBEVEYNDEKİ bir timer'dır (pg-tool.helper.ts:104-110)
                      → 3 saatlik üst sınır DA yok olur.
              t=2dk+  yeni süreç: currentJob=null, isBackupRunning()=false → HİÇBİR KORUMA YOK
T3 (admin):   t=3dk   panel "yarıda kalmış" diyor (evaluateCopyState :161 → "interrupted"),
                      admin yeniden "kopya oluştur" der → İKİNCİ pg_restore başlar
                      copyName saniye çözünürlüklü damga (backup-naming.helper.ts:23-29,152)
                      → FARKLI ad → iki kopya DB'si paralel doluyor
              disk guard (:171-226) yalnız "canlı × 1,2" ister; iki paralel restore "canlı × 2"
SONUÇ:        (a) PGDATA birimi dolarsa CANLI VERİTABANI DURUR — kodun kendi deyimiyle
                  "bu özelliğin üretebileceği en kötü sonuç" (:168-169)
              (b) kur.ps1 [7/9] `npx prisma migrate deploy` (:287): ALTER TABLE, orphan pg_dump/pg_restore'un
                  ACCESS SHARE kilidinin arkasında bekler → DB-level statement_timeout=50s ONU İPTAL EDER
                  → "MIGRATION BASARISIZ / DB kismi degismis OLABILIR. Otomatik geri alinmiyor." (kur.ps1:288-299)
                  (195 migration'ın yalnız 42'si `SET statement_timeout` taşıyor — ölçüldü)
```

---

## 3. S5d — BİRLEŞTİRME SÜRERKEN SAHA YAZIYOR

### 3.1 Akış ve kilit kapsamı

```
POST /api/.../merge → master-data-merge.merge (:505)
  prisma.$transaction( { timeout: 120_000, maxWait: 10_000 } )        (:711)
    :546  pg_advisory_xact_lock(8027, 1)      ← İLK ifade ✔ ama SADECE merge'ler arası
    :549-598  taze oku + guard'lar + çakışma sayımı
    :617-628  markSideEffectsTx
    :629-651  for (rule of MERGE_MAP[entity])  →  UPDATE "<tablo>" SET "<kolon>" = survivor
                                                  WHERE "<kolon>" = ANY(sourceIds)
    :638-651  ATOMİK CLAIM: sources.mergedIntoId = survivor, isActive = false
  COMMIT
```

**Kilit hiçbir yazma yolunda alınmıyor** — `pg_advisory_xact_lock(8027,…)` grep'i tüm `src/` içinde
yalnız `master-data-merge.service.ts:546`'da (K4 kilit envanteri ile uyumlu). KK1 ham giriş (8021),
parti (8022), sevkiyat (8023) kendi namespace'lerinde; hiçbiri 8027'yi görmez.

### 3.2 Çizelge (kumaş birleştirme ↔ KK1 ham giriş)

```
T1 (merge):  t=0      BEGIN; advisory lock; guard'lar; sayımlar
             t=0.3s   UPDATE rolls SET "itemId"=survivor WHERE "itemId"=ANY(sources)   (merge-map.ts:139)
             t=0.4s   UPDATE order_lines … / work_orders … / product_recipes … (12 UPDATE daha)
             t=0.8s   claim: sources.mergedIntoId=survivor, isActive=false
             t=0.9s   COMMIT
T2 (KK1):    t=0.5s   BEGIN; item.isActive kontrolü → T1 henüz COMMIT etmedi → AKTİF görünür ✔
             t=0.6s   INSERT rolls (itemId = KAYNAK kumaş)  → COMMIT
SONUÇ:       yeni top, artık MEZAR TAŞI olan bir kumaşa bakıyor. FK sağlam (satır duruyor),
             hiçbir UNIQUE/CHECK ihlal edilmiyor, hata YOK.
             Ama: kumaş listeleri/seçiciler tombstone'u eler (`color.service.ts:60-68`,
             `duplicate-detection.service.ts:136`, `base.service.ts:769`) → top bir daha
             o kumaşla eşleştirilemez ve rapor kırılımında birleştirmenin ÇÖZMESİ GEREKEN
             ikinci satır geri gelir.
```

READ COMMITTED'da `UPDATE … WHERE itemId = ANY(...)` yalnız **ifade başlangıcındaki** anlık görüntüyü
görür; ondan sonra COMMIT eden bir INSERT hiçbir şekilde taşınmaz (satır kilidi phantom'u kapatmaz —
beceri §3.1 üçlü koşulunun üçü de sağlanıyor: türetilmiş invariant ✔ · kümeye satır eklenebiliyor ✔ ·
izolasyon yükseltilmemiş ve yazan taraf advisory lock almıyor ✔).

---

## 4. BULGULAR

---

### [S-5-01] Kapanış bütçesi (5 sn) sistemdeki hiçbir uzun yazmanın bütçesini kapsamıyor — `pm2 restart` uçuştaki 20/120 saniyelik işi ZORLA keser ve kesildiğinin izi hiçbir yerde kalmaz

| Şiddet | S2 | Kategori | D (tx sınırları) + A.5 | Öncelik | P3 | Modül | ops/kapanış | Kanıt seviyesi | K1 |

**Özet.** `gracefulShutdown` "uçuştaki istekleri bitir" sözü veriyor ama kendine 5 saniye ayırıyor;
oysa global tx tavanı 20 sn, ana veri birleştirmesi 120 sn, `pg_dump` 3 saat. Yani deploy penceresinde
`pm2 restart` verildiğinde uzun yazma **her zaman** zorla kesilir. Transaction'lar geri sardığı için
veri bozulmaz — ama işin kesildiğine dair **hiçbir kayıt doğmaz**: birleştirmenin audit'i tx'ten SONRA
yazılıyor (`master-data-merge.service.ts:717-742`), yedek/kopya işinin `finishJob`'ı hiç koşmuyor,
istemciye yanıt gitmiyor. Ertesi sabah "birleştirdim ama olmamış, neden?" sorusunun hiçbir kaynağı yok.

**Kanıt**
- `Teks-Erp/src/server.ts:146-152` — kapanışın kendi tavanı:
  ```ts
  const forceTimer = setTimeout(() => {
      console.warn("Kapanış 5s'de tamamlanmadı — zorla çıkılıyor.");
      process.exit(1);
  }, 5000);
  ```
- `Teks-Erp/ecosystem.config.js:58` — `kill_timeout: 8000` ("server.ts kendi içinde 5sn'de zorla çıkar; pm2'ye biraz pay bırak")
- `Teks-Erp/src/lib/prisma.ts:89-91` — `transactionOptions: { maxWait: 5_000, timeout: 20_000 }`
- `Teks-Erp/src/services/master-data-merge.service.ts:61` — `const MERGE_TX_TIMEOUT_MS = 120_000;` (kullanımı `:711`)
- `Teks-Erp/src/services/helpers/pg-tool.helper.ts:53` — `DEFAULT_TOOL_TIMEOUT_MS = 3 * 60 * 60 * 1000`
- `Teks-Erp/src/server.ts:166-181` — `prisma.$disconnect()` ve `pool.end()` **yalnız** `server.close` callback'inde; zorla çıkışta hiç koşmaz
- **Koruma yok teyidi:** kapanışta uçuştaki iş sayısına bakan, "N yazma sürüyor, bekle" diyen ya da kesileni kayda geçiren bir yol aranmadı-bulunmadı: `grep -rn "shuttingDown" src --include='*.ts'` → yalnız `server.ts:144,147,148`; `gracefulShutdown` içinde audit çağrısı YOK (yalnız `flushLatencyNow` + `stopMdnsAdvertiser`).

**Çakışma senaryosu**
- T1 (muhasebe): `POST /api/customers/merge` → 120 sn bütçeli tx, 8 kaynak müşteri, 40. saniyede.
- T2 (ops): `deploy/kur.ps1:190` `[4/9] pm2 delete` → IPC `shutdown`.
- SONUÇ: 5 sn sonra `process.exit(1)`; PG tx'i geri sarar (veri temiz), istemci yanıt alamaz,
  `SystemLog`'a **hiçbir satır** düşmez (audit `:717`'de, tx'ten sonra). Kullanıcı "birleştirdim" sanır,
  liste hâlâ iki kayıt gösterir, panelde sebep yoktur.

**failure_mode.** Vardiya sonunda muhasebeci 8 mükerrer cari kartı birleştirir; işlem 40. saniyesindeyken
sürüm kurulumu başlar. Süreç 5 sn içinde zorla ölür, birleştirme geri sarılır ve `system_logs`'ta
`MASTER_DATA_MERGE` satırı doğmaz. Ertesi gün panel hâlâ 8 mükerrer gösterir; "birleştirme çalışmıyor mu"
sorusunun cevabı ne audit'te ne `/health`'te vardır.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok (bkz. başlık). Koşulması gereken:
`SELECT date_trunc('minute',"createdAt") FROM system_logs WHERE action='STARTUP' ORDER BY "createdAt" DESC LIMIT 20;`
ile restart anlarını çıkar; aynı dakikada `MASTER_DATA_MERGE` / `IMPORT_RUN` / `DB_COPY_*` **başlamış ama bitmemiş**
iz var mı diye bak (`import_runs` tablosunda o dakikaya denk gelen boşluk).

**Repro (K3).** Yazılmadı — DB yok. Kabul kriterindeki bekçi bunu kapatır.

**İş etkisi.** Deploy penceresi ile uzun ops işlerinin çakışması sessiz "hiç olmamış gibi" sonucu üretir;
operatör aynı işi tekrar dener ve ikinci denemede (özellikle içe aktarımda, bkz. S-5-02) hasar büyür.

**Öneri (2. tur için).**
1. Kapanış sırasını tersine çevir: `server.close()` + **uçuştaki yazma sayacı**; sayaç 0'a inince çık.
   Sayaç `latency.middleware`'in zaten tuttuğu istek yaşam döngüsünden türetilebilir (yeni bağımlılık yok).
2. `forceTimer`'ı `kill_timeout`'un ALTINDA ama tx tavanının ÜSTÜNDE tut ya da tersi bir karar ver ve
   **yaz**: bugün 5 < 8 < 20 zinciri "uzun tx her zaman kesilir" demektir ve bu hiçbir yerde yazılı değil.
3. Zorla çıkıştan hemen önce best-effort tek satır: `SYSTEM / FORCED_SHUTDOWN` + uçuştaki istek sayısı
   (`AuditService.logEvent`, `uncaughtException` yolundaki 2 sn'lik race kalıbının aynısı, `server.ts:218-231`).
4. `deploy/kur.ps1`'e "[4/9] öncesi: panelde koşan yedek/kopya/içe aktarım var mı" kapısı
   (`GET /api/admin/health` zaten `job` alanını taşıyor). `[PROD'DA ÇALIŞTIRMA]` gerektirmez — script değişikliği.

**Kabul kriteri.** `scripts/test_graceful_shutdown.ts`: 6 sn süren sahte bir isteği uçuşa sok, `gracefulShutdown`
çağır; (a) süreç isteği bitmeden çıkmıyor **ya da** (b) çıkarken `FORCED_SHUTDOWN` audit satırı yazılıyor.
Negatif sonda: sayaç kablosu sökülünce test KIRMIZI vermeli.

**Efor.** 1,5 gün.

**Önceki defter.** `K12` → `F-CORE-OPS-001` uzlaştırmasında "kapanış bütçesi ↔ tx bütçesi (`kill_timeout 8000`
vs 20 s tx) OPS ayrı ölçsün" notu bu bulguyla kapanıyor. Reddedilmiş bir bulgu yeniden açılmadı.

---

### [S-5-02] İçe aktarım yarıda kesilirse yazılan satırların TEK izi de kaybolur: `import_runs` satırı da satır bazlı audit de yalnız koşum BİTİNCE yazılır — sipariş şablonunda ikinci deneme mükerrer sipariş açar

| Şiddet | S1 | Kategori | B.3 + D | Öncelik | P0 | Modül | içe aktarım | Kanıt seviyesi | K1 |

**Özet.** `ImportService.apply` satır satır yazar; her satır kendi servisinden geçip **hemen COMMIT** olur.
Ama koşumun kimliği (`import_runs`, replay anahtarı `clientToken`) ve satır bazlı audit girdileri
(`auditEntries` dizisi) **döngü bittikten sonra** yazılır. Süreç döngünün ortasında ölürse (deploy,
`max_memory_restart: "1G"` OOM restart'ı, `uncaughtException`) N kayıt yazılmış olur ve
**sıfır iz** kalır: `listRuns` boş, `getRunRecords` boş. Servisin kendi dokümantasyonu "hangi kayıtlar
oluştu" sorusunun cevabını tam da bu iki kaynağa bağlıyor (`:527-530`, `:628-635`) — yani sistemin
"hatalı yükleme yaptım, ne oldu?" cevabı bu senaryoda kayboluyor. Sipariş adaptöründe sonuç veri hasarı:
her grup CREATE'tir, ikinci yükleme ikinci siparişi açar.

**Kanıt**
- `Teks-Erp/src/services/import/import.service.ts:447-473` — replay kapısı yalnız TAMAMLANMIŞ koşumu görür:
  ```ts
  if (options.clientToken) {
    const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });
    if (prior) { /* YAZMA, önceki sonucu döndür */ }
  }
  ```
- `:508-544` — yazma döngüsü; her satır `adapter.createOne/updateOne` ile ANINDA commit, audit ise diziye:
  ```ts
  auditEntries.push({ userId, action: …, tableName: adapter.tableName, recordId: out.id,
                      newData: { ...p.values, _source: "IMPORT", importRunId: runId } });
  ```
- `:552-574` — `prisma.importRun.create({ … clientToken … })` **döngüden SONRA**
- `:577` — `await AuditService.logMany(auditEntries)` **döngüden SONRA**
- `:628-635` — sözleşme: "satır bazlı iz AUDIT'tedir … boş liste 'hiçbir şey oluşmadı' DEĞİLDİR"
- `Teks-Erp/src/services/import/adapters/order.adapter.ts:160-163` — `findExisting()` **boş Map** döner:
  ```ts
  // Sipariş referansı bizde SAKLANMAZ (kolonu yok) → eşleşme aranmaz, her grup yeni kayıttır.
  async findExisting() { return new Map<string, Record<string, unknown>>(); }
  ```
- `:314-318` — `updateOne(): throw new Error("Sipariş içe aktarımı güncelleme yapmaz")`
- `:154` — şablon notu bunu açıkça söylüyor: *"Aynı dosyayı ikinci kez yüklerseniz ikinci bir sipariş açılır."*
- `:284-313` — `createOne` `orderService.create(payload, …)` çağırıyor ve **payload'a `clientToken` KOYMUYOR**
  → `Order.clientToken @unique` idempotency katmanı bu yolda fiilen kapalı
- `Teks-Erp/src/services/import/import-coerce.ts:127` — `MAX_IMPORT_ROWS = 10000`
- **Koruma yok teyidi:** `apply` yolunda advisory lock, atomik claim, `ImportRun` ön-rezervasyonu ya da
  entity başına eşzamanlılık kapısı aranmadı-bulunmadı (`grep -n "pg_advisory\|updateMany\|\$transaction" src/services/import/*.ts` → 0 sonuç).

**Çakışma senaryosu (iki ayrı çizelge, ikisi de aynı boşluktan)**

*A — restart:*
- T1 (planlamacı): `POST /api/import/order/apply`, 220 satır / 60 sipariş, `clientToken=X`.
- T2 (ops): 38. siparişten sonra `pm2 delete` → 5 sn sonra `process.exit(1)`.
- SONUÇ: 38 sipariş DB'de; `import_runs`'ta X yok; audit'te `importRunId` yok.
  Planlamacı aynı dosyayı `clientToken=X` ile yeniden gönderir → replay kapısı X'i bulamaz →
  **60 siparişin tamamı yeniden açılır; 38'i ikizlenir.**

*B — eşzamanlı çift gönderim (restart'sız):*
- T1: `apply(clientToken=X)` — `:448` `findUnique` → `null`, döngü başlar.
- T2 (aynı kullanıcı, çift tık / "Tekrar Dene"): `apply(clientToken=X)` — T1 henüz `:552`'ye gelmedi →
  yine `null` → ikinci döngü de yazar.
- SONUÇ: her iki koşum da yazar; T2'nin `importRun.create`'i P2002 ile düşer ve **hata mesajı**
  operatöre gider, ama veri iki kez yazılmıştır.

**failure_mode.** Planlamacı 60 kalemlik müşteri sipariş listesini Excel'den yükler. 38. siparişte sürüm
kurulumu başlar (ya da istemci 15 sn'de zaman aşımına uğrar — `BULGU-T1-008`). Panelde hiçbir koşum kaydı
görünmediği için "yüklenmemiş" sanır ve aynı dosyayı yeniden yükler. Sistemde **98 sipariş** oluşur;
38'i mükerrerdir, mükerrer uyarısı yalnız "aynı müşteriye son 90 günde aynı toplam metrajlı **EN SON**
sipariş" için çıkar (`order.adapter.ts:255-280`) ve zaten UYARIDIR, `onError=abort` onu durdurmaz.
Üretim planı ve karşılanma raporu iki katına çıkar.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok. Koşulması gereken:
```sql
-- (a) izsiz içe aktarım kalıntısı: aynı dakikada doğmuş, aynı müşteri+aynı toplam metrajlı sipariş çiftleri
SELECT o1."orderNumber", o2."orderNumber", o1."customerId", o1."createdAt"
FROM orders o1 JOIN orders o2
  ON o1."customerId" = o2."customerId" AND o1.id < o2.id
 AND abs(extract(epoch FROM (o2."createdAt" - o1."createdAt"))) < 3600
WHERE o1."status" <> 'CANCELLED' AND o2."status" <> 'CANCELLED';
-- (b) import_runs'ta PARTIAL/FAILED koşumlar + stoppedAtRowNo
SELECT id, entity, status, "rowCount", created, updated, failed, "stoppedAtRowNo", "createdAt" FROM import_runs ORDER BY "createdAt" DESC;
-- (c) audit'te importRunId taşıyan satır sayısı ↔ import_runs.created+updated mutabakatı
```

**Repro (K3).** Yazılmadı — DB yok. Kabul kriteri bunu bekçiye çevirir.

**İş etkisi.** Mükerrer sipariş = mükerrer üretim planı, mükerrer iş emri, iki kat sevk beklentisi.
Diğer varlıklarda (kumaş/renk/müşteri) `upsert` olduğu için veri hasarı yerine "ne yazıldığı bilinmiyor"
sonucu doğar — geri alma yolu (audit `importRunId`) tam da ihtiyaç anında boştur.

**Öneri (2. tur için).**
1. **`ImportRun` satırını döngüden ÖNCE `status="RUNNING"` ile yaz** (`runId` zaten `:478`'de üretiliyor).
   Böylece `clientToken` replay anahtarı ilk satır yazılmadan DB'de olur ve yarıda kesilen koşum
   `RUNNING` olarak GÖRÜNÜR (`db-copy.service`'in `state:"running"` → `interrupted` uzlaştırma kalıbının aynısı,
   `db-copy.service.ts:155-163`). Sonda `update` ile final duruma çek.
2. Audit'i **parça parça** yaz (ör. her 200 satırda bir `logMany`) — bellekte biriktirme kesintide sıfırlanır.
3. Sipariş adaptöründe `orderService.create` payload'ına **satır bazlı deterministik `clientToken`**
   (`uuidv5(runId + groupKey)`) koy — `Order.clientToken @unique` zaten var, kullanılmıyor.
4. `apply` ucuna varlık başına advisory lock (yeni namespace) ya da `clientToken` üzerinden ön-claim.

**Kabul kriteri.** `scripts/test_import_interrupt.ts`: (a) 20 satırlık bir order dosyasını `apply` ederken
10. satırdan sonra hata enjekte et → `import_runs` satırı VAR ve `status='PARTIAL'`, `stoppedAtRowNo=10`,
audit'te 10 satır `importRunId` taşıyor; (b) aynı `clientToken` ile ikinci çağrı **yeni sipariş açmıyor**.
Negatif sonda: 1. maddeyi geri alınca (a) KIRMIZI olmalı.

**Efor.** 2 gün.

**Önceki defter.** `BULGU-T1-008` (replay anahtarı en sonda yazılıyor — AYAKTA). Bu bulgu onu senaryo
düzeyine taşıyor ve **iki yeni koşul** ekliyor: (i) restart/OOM yolu (istemci zaman aşımı değil),
(ii) audit toplu yazımının da bellekte kaybolması — yani `BULGU-T1-008`'in önerdiği "tokeni önce yaz"
düzeltmesi tek başına izi geri getirmez. İlgili: `BULGU-T1-089` (aynı token farklı gövde),
`BULGU-T1-088` (mükerrer uyarısı yalnız son siparişe bakıyor).

---

### [S-5-03] `pg_dump`/`pg_restore`/`rclone` çocukları kapanışta ne öldürülür ne beklenir; 3 saatlik üst sınırları da ebeveynle birlikte yok olur — restart sonrası ne tekil-koşum garantisi ne zaman aşımı kalır

| Şiddet | S2 | Kategori | A.5 + J | Öncelik | P2 | Modül | yedek / DB kopyası | Kanıt seviyesi | K1 |

**Özet.** Üç ağır ops işi (gece/elle yedek, kopyaya geri yükleme, offsite süpürme) harici süreçlerle
koşuyor ve üçünün de "aynı anda bir tane" garantisi ile "3 saatte öldür" üst sınırı **ebeveyn sürecin
belleğinde** yaşıyor. `pm2 restart` bu ikisini birden siler ama çocuk süreç ölmez: Node `spawn`'ın
`timeout` seçeneği ebeveyndeki bir timer'dır, `detached` kullanılmadığı için de çocuk bir süreç grubuna
bağlı değildir. Sonuç: sahipsiz, süresiz bir `pg_dump`/`pg_restore` koşmaya devam ederken yeni süreç
"hiçbir iş yok" der ve ikincisini başlatabilir.

**Kanıt**
- `Teks-Erp/src/services/helpers/pg-tool.helper.ts:104-110` — üst sınır ebeveyn tarafında:
  ```ts
  const child = spawn(file, args, { windowsHide: true, env: {...}, timeout: timeoutMs, killSignal: "SIGKILL" });
  ```
  (`detached` yok, süreç grubu yok, kill kaydı yok)
- `Teks-Erp/src/services/backup.service.ts:162,221` — `let running = false;` … `running = true;` (modül belleği)
- `Teks-Erp/src/services/db-copy.service.ts:129,373-381` — `let currentJob` + `if (currentJob) return "Zaten bir kopya işlemi sürüyor."` + `if (isBackupRunning()) …`
- `Teks-Erp/src/services/db-copy.service.ts:150-163` — uzlaştırmanın kendi kabulü:
  *"`interrupted` tespiti tek-process invariant'ına dayanır … 'kayıt koşuyor diyor ama bellekte iş yok' ⇒ süreç yeniden başlamış demektir."*
  → yani kod, işin GERÇEKTEN durduğunu VARSAYIYOR; oysa yalnız sahibi ölmüştür.
- `Teks-Erp/src/server.ts:146-186` — `gracefulShutdown` içinde çocuk süreç kaydı/öldürme YOK
  (yalnız `flushLatencyNow` + `stopMdnsAdvertiser`)
- `Teks-Erp/src/services/db-copy.service.ts:168-169` — riskin kendi tanımı:
  *"PGDATA volume'ünü doldurmak CANLI veritabanını durdurur — bu özelliğin üretebileceği en kötü sonuç"*
- `Teks-Erp/src/services/db-copy.service.ts:208-219` — disk guard yalnız `liveSize × 1,2` ister
- `Teks-Erp/src/services/helpers/backup-naming.helper.ts:23-29,152` — kopya adı **saniye** çözünürlüklü damga
  → ikinci iş farklı ad alır, çakışma bile vermez
- `deploy/kur.ps1:190-192` (`pm2 delete`) → `:287` (`npx prisma migrate deploy`) sırası
- 195 migration'ın **42**'sinde `SET statement_timeout` var (ölçüm:
  `ls prisma/migrations | grep -c '^2'` = 195, `grep -rl statement_timeout prisma/migrations --include='*.sql' | wc -l` = 42)
- **Koruma yok teyidi:** watchdog aranması — `backup-scheduler.ts:65-76` ve `archive-scheduler.ts:54-65`'te
  3 saatlik watchdog VAR ama ikisi de **kendi bayrağını** korur, çocuk süreci değil; `db-copy` tarafında
  watchdog HİÇ YOK (`grep -n "watchdog\|runningSince" src/services/db-copy.service.ts` → 0 sonuç);
  DB tarafında "bu kopya gerçekten yazılıyor mu" sondası yok.

**Çakışma senaryosu**
- T1 (admin, 09:00): panelden "Yedekten kopya oluştur" → `pg_restore` başlar, 10 dk sürecek.
- T2 (ops, 09:02): sürüm kurulumu `kur.ps1` → `[4/9] pm2 delete` → 5 sn sonra süreç ölür.
  `pg_restore` **koşmaya devam eder**, artık 3 saatlik üst sınırı da yoktur.
- T3 (09:03): `kur.ps1 [7/9] npx prisma migrate deploy` → `ALTER TABLE` ACCESS EXCLUSIVE ister,
  orphan `pg_restore`/`pg_dump`'ın ACCESS SHARE kilidinin arkasında kuyruğa girer →
  DB-level `statement_timeout=50s` ifadeyi İPTAL eder →
  `X MIGRATION BASARISIZ / DB kismi degismis OLABILIR. Otomatik geri alinmiyor.` (`kur.ps1:288-299`)
- T4 (09:10, alternatif dal): admin paneli açar, "yarıda kalmış — silip yeniden oluşturun" mesajını
  (`db-copy.service.ts:760-762`) okur ve yeni kopya başlatır → **iki paralel `pg_restore`**;
  disk guard `1,2×` istemişti, gerçek ihtiyaç `2×` oldu.

**failure_mode.** Sürüm kurulumu, panelden 2 dakika önce başlatılmış bir "kopyaya geri yükleme" ile
çakışır. `migrate deploy` 50. saniyede "canceling statement due to statement timeout" ile düşer;
script "DB kısmi değişmiş OLABILIR, otomatik geri alınmıyor" der ve fabrika, yarım migration'lı bir
veritabanıyla kapalı kalır. Alternatif dalda iki paralel `pg_restore` PGDATA birimini doldurur ve
**canlı veritabanı yazma alamaz hâle gelir**.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok. Koşulması gereken (canlı sunucuda, salt-okunur):
```sql
-- sahipsiz dump/restore oturumu var mı
SELECT pid, datname, usename, application_name, state, backend_start, query_start,
       now()-backend_start AS yas
FROM pg_stat_activity
WHERE application_name ILIKE '%pg_dump%' OR application_name ILIKE '%pg_restore%'
ORDER BY backend_start;
-- yarıda kalmış kopya DB'leri
SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname LIKE '%_restore_%';
```
Ayrıca `BACKUP_DIR` altında 24 saatten eski `.part` dosyaları (`backup.service.ts:236` `sweepStaleParts`).

**İş etkisi.** En kötü dalda canlı veritabanının durması; olağan dalda başarısız migration + kapalı fabrika
+ geri dönüşün yedekten restore olması.

**Öneri (2. tur için).**
1. **Çocuk süreç kaydı**: `runProcess` spawn ettiği her `child`'ı modül seviyesi bir `Set`'e koysun,
   `close`'da çıkarsın; `gracefulShutdown` kapanışta hepsine `SIGKILL` göndersin (yedek/kopya
   yarıda kalır ama `.part`/`interrupted` mekanizmaları bunu ZATEN doğru ele alıyor —
   `backup.service.ts:206-225`, `db-copy.service.ts:155-163`).
2. **Sahiplik bayrağını DB'ye taşı**: `state:"running"` kaydına `pid` + `bootId` (`installation-identity`
   zaten bir kimlik üretiyor) yaz; `startCopyJob` DB kaydını da kontrol etsin ve
   "kayıt koşuyor + `pg_stat_activity`'de canlı bağlantı var" durumunda YENİ İŞ BAŞLATMASIN.
3. `deploy/kur.ps1`'e `[4/9]` öncesi kapı: `GET /api/admin/health` → `job != null` ya da
   `pg_stat_activity`'de `pg_dump/pg_restore` varsa **DUR ve sor**. `[PROD'DA ÇALIŞTIRMA]` gerektirmez.
4. Migration'lara `SET statement_timeout = 0;` + `SET lock_timeout = '5s';` başlığını **zorunlu** kıl
   (bugün 42/195); `lock_timeout` sayesinde kilit beklemesi 50 sn'lik iptal yerine net bir hata verir.

**Kabul kriteri.** (a) `scripts/test_child_process_shutdown.ts`: uzun süren sahte bir child spawn et,
`gracefulShutdown` çağır, çocuğun öldüğünü doğrula (negatif sonda: kayıt seti sökülünce KIRMIZI).
(b) `startCopyJob`, DB'de `state:"running"` + canlı bağlantı varken `started:false` dönmeli.

**Efor.** 2 gün.

**Önceki defter.** K8 HOTSPOT-2 / HOTSPOT-5 / HOTSPOT-6 ile aynı aileden ama farklı: oradaki soru
"ikinci instance", buradaki "aynı instance'ın ölümünden sağ çıkan çocuk". `F-OPS-VER-004` (child timeout)
düzeltmesinin **kapsamadığı** dal budur — timeout ebeveyn yaşadığı sürece koruyor.

---

### [S-5-04] Ana veri birleştirmesi sürerken yazılan referans mezar taşında kalır: kilit yalnız birleştirmeler arasında, taşımadan sonra doğan satır hiçbir yere taşınmaz

| Şiddet | S2 | Kategori | A.3 (write skew / phantom) + E | Öncelik | P1 | Modül | ana veri / birleştirme | Kanıt seviyesi | K1 |

**Özet.** Birleştirme, ilgili tabloları `UPDATE … WHERE kolon = ANY(kaynaklar)` ile survivor'a taşıyor ve
sonunda kaynakları tombstone yapıyor. Kilit (`pg_advisory_xact_lock(8027,1)`) **yalnız iki birleştirmeyi**
serileştiriyor; KK1 ham girişi, sipariş açma, çuval oluşturma gibi yazma yolları o kilidi almıyor.
READ COMMITTED'da taşıma ifadesi kendi anlık görüntüsünü alır: o ifadeden sonra COMMIT eden bir INSERT
taşınmaz ve birleştirme COMMIT olduğunda **canlı bir satır, seçilemeyen bir mezar taşına** bakar kalır.
Hiçbir kısıt ihlal edilmez, hata çıkmaz — kayıp yalnız veriye bakılınca görülür.

**Kanıt**
- `Teks-Erp/src/services/master-data-merge.service.ts:546` — kilit, tx'in İLK ifadesi (doğru) ama global tek anahtar:
  ```ts
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MERGE_LOCK_NS}::int, ${MERGE_LOCK_KEY}::int)`;
  ```
  `:44-51` gerekçesi: *"birleştirme ayda bir yapılan bir işlemdir, iki eşzamanlı merge'in kilitlenme muhakemesini … ortadan kaldırmak"* — yani kilidin kapsamı **bilerek** merge↔merge.
- `:629-651` — taşıma ve claim:
  ```ts
  const moved = await tx.$executeRawUnsafe(
    `UPDATE "${rule.table}" SET "${rule.column}" = $1::uuid WHERE "${rule.column}" = ANY($2::uuid[])`,
    survivor.id, sourceIds);
  …
  const claimed = await del.updateMany({ where: { id: { in: sourceIds }, mergedIntoId: null }, data: { mergedIntoId: survivor.id, isActive: false, … } });
  ```
- `:711` — `{ timeout: MERGE_TX_TIMEOUT_MS, maxWait: 10_000 }` → pencere 120 saniyeye kadar açık olabilir
- `Teks-Erp/src/constants/merge-map.ts:66-72` (müşteri: `orders.customerId`, `shipments.customerId`,
  `sacks.customerId`, `rolls.labelCustomerId`…), `:139-145` (kumaş: `rolls.itemId`, `order_lines.itemId`,
  `work_orders.targetItemId`…), `:179-187` (renk: `rolls.colorId`, `order_lines.colorId`…)
- **Koruma yok teyidi — altı kaynak da soruldu:**
  1. *Kilit?* `grep -rn "pg_advisory" src --include='*.ts'` → 8 nokta; **8027 yalnız `master-data-merge.service.ts:546`'da**. Yazma yolları (KK1 `inventory.service.ts:844` = 8021, parti = 8022, sevkiyat = 8023) farklı namespace.
  2. *İzolasyon?* `grep -rn "isolationLevel" src --include='*.ts'` → tek kullanım `shipping.service.ts:2610` (RepeatableRead); merge READ COMMITTED.
  3. *Satır kilidi?* `FOR UPDATE` tüm kod tabanında 1 yerde (`order.service.ts:2434`) — merge'de yok, zaten phantom'u kapatmaz.
  4. *DB kısıtı?* FK satırın VARLIĞINA bakar; tombstone satırı DURUYOR → FK sağlam. `mergedIntoId IS NULL` şartlı bir CHECK/FK yok.
  5. *Yazma yolunda tombstone kontrolü?* `grep -rn "mergedIntoId" src --include='*.ts' | grep -v master-data-merge` → 60 vuruşun tamamı **`Batch`** (parti birleştirme, ayrı semantik), **liste/arama süzgeci** (`color.service.ts:60-68`, `base.service.ts:769,868`, `duplicate-detection.service.ts:136`, `import-name-guard.ts:93`) ya da ad-mükerrer guard'ı. **Hiçbir yazma yolu "yazdığım müşteri/kumaş/renk tombstone mü" diye sormuyor** — `isActive` kontrolü var, ama T2 birleştirme COMMIT etmeden önce `isActive` hâlâ `true`.
  6. *Bekçi?* `scripts/test_master_data_merge*.ts` içinde paralel yazma sondası yok (K11 HOTSPOT-2: "8024/8027 bekçisiz").

**Çakışma senaryosu**
- T1 (muhasebe, masaüstü): `merge(entity="item", survivor=A, sources=[B])` → tx başlar.
  `t+0,3s`: `UPDATE rolls SET "itemId"=A WHERE "itemId"=ANY('{B}')` koşar (o an B'ye bakan 0 top).
- T2 (KK1 tableti): `t+0,5s` ham giriş → `item B` seçili, `isActive=true` görünüyor (T1 henüz COMMIT etmedi)
  → `INSERT rolls(itemId=B)` → COMMIT.
- T1: `t+0,9s` claim → `B.mergedIntoId=A, isActive=false` → COMMIT.
- SONUÇ: yeni top **B**'ye bakıyor. B artık hiçbir seçicide, hiçbir mükerrer taramasında, hiçbir
  kumaş listesinde YOK. Top düzenlenirken kumaş alanı boş/eski ad gösterir; Ürün Dengesi ve
  Stok Karnesi B'yi ayrı satır olarak sayar — birleştirmenin çözdüğü şey geri gelir.

**failure_mode.** Muhasebeci vardiya sırasında iki mükerrer kumaş kartını birleştirir (işlem 0,9 sn sürer).
Aynı saniyede KK1 tabletinden kaynak kumaşla bir ham top girilir. Birleştirme "13 tablo taşındı" der,
audit `movedRows` içinde `rolls: 0` yazar. O top artık mezar taşı kumaşa bağlıdır: kumaş seçicisinde
bulunamaz, "Düzelt" ekranından düzeltilemez (liste tombstone'u eler), Stok Karnesi'nde ayrı satır olarak
görünür ve fabrika "birleştirdim ama hâlâ iki tane" der.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok. Koşulması gereken (saha kopyası):
```sql
-- canlı satır, mezar taşı ana veri (üç varlık için)
SELECT 'rolls.itemId'  k, count(*) FROM rolls r  JOIN items i     ON i.id=r."itemId"          WHERE i."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'rolls.colorId', count(*) FROM rolls r JOIN colors c ON c.id=r."colorId"     WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'order_lines.itemId', count(*) FROM order_lines l JOIN items i ON i.id=l."itemId" WHERE i."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'orders.customerId', count(*) FROM orders o JOIN customers c ON c.id=o."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'sacks.customerId', count(*) FROM sacks s JOIN customers c ON c.id=s."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'shipments.customerId', count(*) FROM shipments sh JOIN customers c ON c.id=sh."customerId" WHERE c."mergedIntoId" IS NOT NULL;
-- >0 çıkan her satır için: kaydın createdAt'i ilgili MASTER_DATA_MERGE audit anından SONRA mı?
```
⚠️ Bu sorgu sıfır dönerse bulgu ÇÜRÜMEZ (birleştirme sahada henüz az sayıda koşmuş olabilir) —
kanıt kod+izolasyon düzeyinde kalır, K1.

**Repro (K3).** Yazılmadı — DB yok. Sözleşmeye uygun repro iskeleti: `merge()`i gecikme enjekte edilmiş
bir `MERGE_MAP` ile başlat, ikinci tx'te `rolls.create({itemId: source})` koş, commit sonrası
`SELECT … WHERE i."mergedIntoId" IS NOT NULL` ile ölç.

**İş etkisi.** Birleştirme, yapıldığı vardiyada yazılan kayıtları eksik toplar; mükerrer ana veri
raporlarda geri döner ve düzeltmenin tek yolu ikinci bir birleştirmedir (ama tombstone artık
survivor'a bağlıdır, ikinci merge onu kaynak olarak seçemez → elle SQL gerekir).

**Öneri (2. tur için).**
1. **Sıfır maliyetli birinci savunma:** taşıma döngüsünden SONRA, claim'den ÖNCE, aynı `UPDATE`leri
   **ikinci kez** koş (`moved2 > 0` ise ya döngüyü tekrarla ya da 409 "bu sırada yeni kayıt oluştu,
   önizlemeyi yenileyin"). Phantom'u tam kapatmaz ama pencereyi milisaniyeye indirir ve **görünür** kılar.
2. **Doğru çözüm:** birleştirme tx'ini `Serializable`'a yükselt (`fix_sketch` yükümlülüğü: `P2034`
   retry — merge zaten ayda bir koşuyor, retry maliyeti sıfır) **ya da** ana-veri yazan yolların
   `resolveReference` benzeri tek kapısına `pg_advisory_xact_lock(8027,1)`'in **paylaşımlı** ikizini koy.
3. Ucuz ve bugün uygulanabilir: `scripts/consistency-check.sql`'e "canlı satır ↔ tombstone ana veri"
   bölümü ekle (§27) ve `test_consistency`'ye taşı — sorun oluştuğunda **sessiz kalmasın**.

**Kabul kriteri.** `scripts/test_master_data_merge_phantom.ts`: merge tx'i uçuştayken ikinci bir tx
kaynak kimliğiyle `Roll` yaratsın; commit sonrası `items.mergedIntoId IS NOT NULL` olan bir kumaşa bakan
canlı top **0** olmalı (ya da merge 409 ile reddetmeli). Negatif sonda: 1. maddedeki ikinci geçiş
sökülünce test KIRMIZI vermeli.

**Efor.** 2 gün (öneri 1+3), 3,5 gün (öneri 2).

**Önceki defter.** `BULGU-T1-102` (merge 120 sn tx bütçesi ↔ DB 50 sn statement_timeout — AYAKTA),
`BULGU-T1-129` (önizleme SQL hatasında "0 çakışma"), `BULGU-T1-035` (tombstone diriltilebiliyor),
`BULGU-T2-011` (merge audit'i fiziksel tablo adına yazıyor). Hiçbiri bu phantom'u kapsamıyor;
reddedilmiş bir bulgu yeniden açılmadı.

---

### [S-5-05] Audit arşivi ilk GERÇEK koşumunda düşecek: 5.000 satırlık batch × 14 kolon = 70.000 bind parametresi, PostgreSQL'in 65.535 sınırının üstünde — yol bugüne dek hiç koşmadı, bekçi tek satırla ölçüyor

| Şiddet | S2 | Kategori | H + K.1 | Öncelik | P2 | Modül | audit / arşiv | Kanıt seviyesi | K1 · [VARSAYIM] |

**Özet.** `archiveOlderThan` 5.000 satırı belleğe alıp tek `createMany` ile arşiv tablosuna yazıyor.
Yazılan satır başına **14 kolon** var; Prisma `createMany` bunları tek bir parametreli INSERT'e koyuyor
ve PostgreSQL'in genişletilmiş protokolü **statement başına en fazla 65.535 bind parametresi** kabul ediyor
(sayı `int16`). 5.000 × 14 = 70.000 → sınırın üstünde. Bu yol **canlıda bir kez bile gerçek satır taşımadı**
(K8 ölçümü: saha ve dev'de 6 aydan eski 0 satır, `system_log_archives` 0 satır), bekçi de **tek satırlık**
bir fixture ile ölçüyor — yani hatanın olduğu boyut hiç denenmemiş. Arşiv çalışmayınca `system_logs`
sınırsız büyür ve büyüme, arşivin devreye girmesi gereken anda başlar.

**Kanıt**
- `Teks-Erp/src/services/audit.service.ts:15` — `const ARCHIVE_BATCH_SIZE = 5000;`
- `:205-262` — okuma + tek tx:
  ```ts
  const logsToArchive = await prisma.systemLog.findMany({ where: { createdAt: { lt: cutoff } }, take: ARCHIVE_BATCH_SIZE, … });
  …
  await tx.systemLogArchive.createMany({ data: logsToArchive.map((log) => ({ id, userId, action, category,
      ipAddress, tableName, recordId, deviceId, requestId, changes, oldData, newData, createdAt, updatedAt })),
      skipDuplicates: true });
  ```
  → sayım: `id, userId, action, category, ipAddress, tableName, recordId, deviceId, requestId, changes,
  oldData, newData, createdAt, updatedAt` = **14 kolon** (`:236-259`).
- `Teks-Erp/src/jobs/archive-scheduler.ts` — tur başına en fazla 200 batch (`MAX_BATCHES_PER_RUN`), yani
  hedef ölçek 1M satır: batch boyutu bilinçli olarak büyük seçilmiş.
- `Teks-Erp/scripts/test_audit_depth.ts:398-434` — **§10.4 fixture'ı TEK satır**:
  ```ts
  const archLog = await prisma.systemLog.create({ data: { … createdAt: OLD_STAMP … } });
  await AuditService.archiveOlderThan(999);
  ```
  → `take: 5000` koşar ama eşleşen satır 1'dir; batch boyutu hiç sınanmaz.
- `Teks-Erp/src/lib/prisma.ts:69-71` + KUNYE — `@prisma/adapter-pg` sürücüsü; parametreler `pg` üzerinden
  genişletilmiş protokolle bağlanır.
- **Koruma yok teyidi:** kod tabanında `createMany`'yi parçalayan hiçbir yardımcı yok
  (`grep -rn "chunk\|CHUNK\|65535" src --include='*.ts'` → yalnız port doğrulamaları, `label.controller.ts:82`
  ve `peripheral.service.ts:83`). `ARCHIVE_BATCH_SIZE` tek yerde ve kolon sayısıyla ilişkilendirilmemiş.

**[VARSAYIM] — nasıl kesinleşir.** Prisma'nın `createMany`'yi tek statement'ta parametreleyip
parçalamadığı **koddan ve sürücü mimarisinden** çıkarıldı; bu oturumda DB olmadığı için ÇALIŞTIRILARAK
doğrulanamadı. Kesinleştirme: 5.000 eski `system_log` fixture'ı yaratıp `archiveOlderThan(999)` koş.
Hata beklenen biçimlerden biri olur: `bind message has 70000 parameter formats but ...` /
`extended protocol limited to 65535 parameters`. Prisma parça parça gönderiyorsa bulgu **çürür** ve
geriye yalnız "bekçi batch boyutunu hiç ölçmüyor" (S4) kalır — bu ayrım kabul kriterinde yazılı.

**failure_mode.** Fabrika 6 ayını doldurur (`system_logs` en eski kayıt 2026-07-16 → kritik tarih
≈ 2027-01). Gece +60 sn'de arşiv zamanlayıcısı ilk kez gerçek satır bulur, `createMany` 70.000 parametreyle
düşer, tx geri sarar, `reportJobFailure("audit-archive")` bir `JOB_FAILED` satırı yazar (bugüne dek
canlıda hiç görülmemiş bir kanal) ve **hiçbir satır arşivlenmez**. Bu her 24 saatte bir tekrarlanır;
`system_logs` büyümeye devam eder, `/api/admin/system-logs/stats` "aktif: N, arşiv: 0" der ve
`audit.lastArchiveAt` damgası da atılmaz. Kimse bakmazsa tablo yıllarca şişer.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok. Koşulması gereken:
```sql
SELECT min("createdAt"), max("createdAt"), count(*) FROM system_logs;      -- 6 ay eşiğine kalan süre
SELECT count(*) FROM system_log_archives;                                  -- beklenen: 0 (hiç taşınmadı)
SELECT * FROM system_settings WHERE key = 'audit.lastArchiveAt';
SELECT count(*) FROM system_logs WHERE "recordId" LIKE 'JOB_FAILED:%';     -- beklenen: 0 (henüz tetiklenmedi)
```

**İş etkisi.** Denetlenebilirlik altyapısının bakım kolu, tam da ihtiyaç duyulduğu anda çalışmaz;
`system_logs` sınırsız büyür (dev'de bugün 103 MB / 152.892 satır ölçüldü), yedek boyutu ve `pg_dump`
süresi bununla birlikte büyür — yani S-5-03'ün penceresini de genişletir.

**Öneri (2. tur için).**
1. `ARCHIVE_BATCH_SIZE`'ı **kolon sayısına bağla**: `Math.floor(60_000 / ARCHIVE_COLUMN_COUNT)`
   (bugün ≈ 4.285) ve `ARCHIVE_COLUMN_COUNT`'u `createMany` nesnesinin anahtar sayısından TÜRET
   (elle sabit ikizlik üretir). Ya da güvenli tarafta 1.000'e indir — 200 batch tavanı 200k'ya düşer,
   `MAX_BATCHES_PER_RUN`'ı 1000'e çıkarmak yeterli.
2. `createMany`'yi **kendi içinde parçala** (500'lük dilimler, aynı tx içinde) — tx atomikliği korunur.
3. Bekçiyi boyuta duyarlı yap (aşağıda).

**Kabul kriteri.** `test_audit_depth §10.4b`: `ARCHIVE_BATCH_SIZE` kadar eski `system_log` fixture'ı
yaratılır (`createMany` ile, kendisi de parçalı), `archiveOlderThan(999)` koşar ve **hepsi taşınmış** olur.
Negatif sonda: batch boyutu 5.000'e geri alınınca test KIRMIZI vermeli (bu sonda aynı zamanda
yukarıdaki [VARSAYIM]'ı da kesinleştirir).

**Efor.** 0,5 gün (düzeltme) + 0,5 gün (bekçi).

**Önceki defter.** `BULGU-T1-121` (`system_log_archives` sonsuza kadar büyüyor + arşivleme yolu hiç gerçek
satır taşımadı — AYAKTA). Bu bulgu aynı gözlemin **sebebini** ekliyor: yol yalnız "gerek olmadığı için"
değil, **koşsa da düşeceği için** boş.

---

### [S-5-06] Restart'tan sonraki ilk saniyelerde fabrikanın KENDİ eklediği sebep kodları geçersiz sayılıyor — 2026-08-26'da TTL için kapatılan "taze ya da hiç" boşluğunun soğuk-başlangıç ikizi

| Şiddet | S3 | Kategori | A.8 (cache ↔ eşzamanlılık) | Öncelik | P3 | Modül | sebep katalogları | Kanıt seviyesi | K1 |

**Özet.** Sapma sebebi doğrulaması senkron bir önbellekten besleniyor; önbellek **hiç dolmadıysa**
(yani her `pm2 restart`'tan hemen sonra) `cachedRows` `null` döner ve doğrulama **koda gömülü** zemin
kataloğuna düşer. O katalogta yalnız sistem satırları var — fabrikanın panelden eklediği her sebep
o pencerede **400** alır. Önbelleği dolduran şey boot uzlaştırma zincirinin SONU (`+3 sn`, DB gecikirse
`4 × 15 sn`'ye kadar). Yani deploy sonrası tabletlerin kuyruklarını boşalttığı ilk saniyeler tam da
korumasız pencere. Bu, 2026-08-26'da TTL için düzeltilen arızanın (bkz. `CLAUDE.md` "Özel sebep 60 sn
penceresi") **cold-start** kardeşidir ve o düzeltme bunu kapsamamıştır.

**Kanıt**
- `Teks-Erp/src/services/reason-preset.service.ts:101-103` — `let cache: Map<…> | null = null;` (boot'ta boş)
- `:180-190` — `cachedRows`: bayat listeyi döndürür ama **boş önbellekte `null`**:
  ```ts
  function cachedRows(kind) {
    if (!cacheIsFresh()) scheduleBackgroundRefresh();   // ASENKRON — bu isteği beklemez
    const rows = cache?.get(kind);
    return rows && rows.length > 0 ? rows : null;       // hiç dolmadıysa → null
  }
  ```
- `:318-338` — doğrulama kaynağı bu fonksiyona bağlanıyor (`find()` `null` dönerse "kaynak hazır değil")
- `Teks-Erp/src/constants/variance-reasons.ts:203-208` — `null`'da **kod kataloğuna** düşülüyor:
  ```ts
  function findReason(kind, code) {
    const dynamic = catalogSource?.find(kind, code);
    if (dynamic) return dynamic;
    return builtinReasonsForKind(kind).find((r) => r.code === code);
  }
  ```
- `:248-256` — bulunamayan kod → `AppError` **400** (`REASON_CODE_INVALID` sınıfı)
- `Teks-Erp/src/jobs/reason-preset-catalog.job.ts:72` — `await refreshReasonPresetCache();` uzlaştırmanın SONUNDA
- `Teks-Erp/src/jobs/permission-catalog.job.ts:198` — zincir `STARTUP_DELAY_MS` sonra başlıyor; `:175` DB
  gelmezse `RETRY_DELAY_MS = 15 sn` ile 4 kez tekrar (`:45`)
- `Teks-Erp/src/server.ts` — `app.listen` boot zincirinden BAĞIMSIZ; sunucu ilk saniyeden itibaren istek alıyor
- **Koruma yok teyidi:** `refreshReasonPresetCache`'i `app.listen`'den ÖNCE bekleyen bir yol yok;
  `cachedRows` senkron olduğu için (tx içinden çağrılıyor, `:167` uyarısı) isteği bekletemiyor.
- Mobil tarafta 400 **kalıcı düşüştür**: `mobil/src/offline/mutations.ts:126-131`
  `if (status && status >= 400 && status < 500) return false;`

**Çakışma senaryosu**
- T1 (ops): 09:00'da `pm2 restart` (sürüm kurulumu). Süreç 09:00:02'de dinlemeye başlıyor,
  uzlaştırma zinciri 09:00:05'te koşacak.
- T2 (tablet): 09:00:03'te ağ geri gelir, kuyruktaki Tambur "Bitir" kaydı uçar; sebep kodu
  fabrikanın panelden eklediği `KENARFIRE` (kodda YOK, DB'de VAR).
- SONUÇ: `cachedRows` → `null` → zemin kataloğu → kod bulunamaz → **400**.
  Mobil 4xx'i fail-fast eder → kayıt kalıcı olarak düşer, operatör "tamamlanmadı" toast'ı görür.
  09:00:05'te önbellek dolar ve aynı kayıt elle tekrar gönderilirse çalışır.

**failure_mode.** Sürüm kurulumundan sonraki ilk 3-5 saniyede (DB geç açılırsa 60 saniyeye kadar)
Tambur'da fabrikanın kendi eklediği bir fire/kayıt-düzeltmesi sebebiyle bitirilen top **400** alır ve
tablet kaydı kalıcı olarak düşürür. Mal ekranda kalır, operatör sebebi anlamaz; aynı işlem 10 saniye
sonra sorunsuz çalışır — yani hata "ara sıra oluyor" diye raporlanır ve teşhis edilemez.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok. Koşulması gereken:
```sql
-- STARTUP olayından sonraki ilk 60 sn içinde düşen 400'ler / eksik sapma kayıtları
WITH boot AS (SELECT "createdAt" t FROM system_logs WHERE action='STARTUP')
SELECT b.t, count(*) FROM boot b
LEFT JOIN system_logs l ON l."createdAt" BETWEEN b.t AND b.t + interval '60 seconds'
GROUP BY b.t ORDER BY b.t DESC LIMIT 20;
-- ayrıca: fabrikanın eklediği (builtin olmayan) ReasonPreset kodları
SELECT kind, code, label FROM reason_presets ORDER BY kind, "sortOrder";
```

**İş etkisi.** Deploy sonrası ilk dakikada tabletlerden gelen kuyruk kayıtları sessizce düşer;
kaybolan kayıt bir top bitirmesi ya da bir fire kaydı olabilir (metraj/fire raporunu etkiler).

**Öneri (2. tur için).**
1. `server.ts` boot sırasında `refreshReasonPresetCache()`'i **`app.listen`'den ÖNCE** (best-effort,
   kısa timeout'la) çağır — uzlaştırma zincirinden bağımsız; DB yoksa yine de dinlemeye geç.
2. `cachedRows` "hiç dolmadı" durumunda 400 üretmek yerine **503 / geçici hata** işaretle:
   4xx kalıcı düşüş demek, 5xx yeniden deneme. Bugün "geçersiz kod" ile "kataloğu henüz okumadım"
   aynı cevaba iniyor — `variance-reasons.ts:161-164`'teki notun kabul ettiği takas, ama o notun
   yazıldığı gün mobil kuyruğun 4xx-fail-fast kuralı bu takasın bedelini değiştirdi.
3. `/api/admin/health`'e `reasonCatalog: "warm" | "cold"` alanı — pencere görünür olsun.

**Kabul kriteri.** `scripts/test_reason_presets §7`: `invalidateReasonPresetCache()` (satırları DÜŞÜREN
varyant, `expireReasonPresetCacheForTest` DEĞİL) sonrası, DB'de var olan fabrika-eklemesi bir kodla
doğrulama çağrılır → 400 DÖNMEMELİ (ya da 503 dönmeli). Negatif sonda: düzeltme geri alınınca KIRMIZI.
⚠️ Bekçi yazılırken `expireReasonPresetCacheForTest` kullanılırsa **ölçtüğü şey bu bulgu DEĞİLDİR**
(dosyanın kendi uyarısı, `:148-153`).

**Efor.** 0,5 gün.

**Önceki defter.** `CLAUDE.md` "Özel sebep 60 sn penceresi" notu (2026-08-26 düzeltmesi) — o düzeltme
**bayat** önbelleği kurtardı, **boş** önbelleği bilerek fail-closed bıraktı; bu bulgu o kararın
mobil 4xx politikasıyla çeliştiğini gösteriyor. Defterde eşleşen id yok.

---

### [S-5-07] Arşiv `archived` sayacı TAŞINAN değil SEÇİLEN satır sayısını döndürüyor — eşzamanlı iki arşivleme koşumunda "5.000 arşivlendi" der, gerçekte 0 taşımıştır

| Şiddet | S4 | Kategori | I.1 (yanıltıcı gösterge) | Öncelik | P5 | Modül | audit / arşiv | Kanıt seviyesi | K1 |

**Özet.** `archiveOlderThan` dönüş değeri olarak `logsToArchive.length` veriyor — yani DB'den **seçilen**
satır sayısını, `createMany`/`deleteMany`'nin **gerçekten** yaptığı iş sayısını değil. Zamanlayıcı ile
manuel arşiv ucu aynı anda koşarsa (ikisi de aynı 5.000 satırı seçer) ikinci koşum 0 satır taşır ama
"5.000 arşivlendi" der. Operatörün elindeki tek gösterge ve `POST /api/admin/system-logs/archive`'in
"`archived=0` dönene kadar çağır" sözleşmesi bu sayıya dayanıyor.

**Kanıt**
- `Teks-Erp/src/services/audit.service.ts:206-262`:
  ```ts
  const logsToArchive = await prisma.systemLog.findMany({ … take: ARCHIVE_BATCH_SIZE … });   // tx DIŞINDA
  …
  await prisma.$transaction(async (tx) => { … createMany({ …, skipDuplicates: true }); … deleteMany({ where: { id: { in: ids } } }); });
  return { archived: logsToArchive.length, cutoff: … };     // ← SEÇİLEN, taşınan DEĞİL
  ```
  `createMany` ve `deleteMany`'nin döndürdüğü `count` **hiç okunmuyor**.
- `Teks-Erp/src/routes/admin.routes.ts:870` civarı — manuel arşiv ucu (`POST /api/admin/system-logs/archive`)
- `Teks-Erp/src/jobs/archive-scheduler.ts` — döngü `archived === 0`'da duruyor
- `Teks-Erp/CLAUDE.md` (Operasyonel Bakım) — *"Manuel … yalnız acil disk baskısında (idempotent, `archived=0` dönene kadar)"*
- **Koruma yok teyidi:** manuel uç ile zamanlayıcı arasında ortak bir bayrak/kilit yok —
  `archive-scheduler.ts:28-29` `running`/`runningSince` yalnız **zamanlayıcının kendi** turlarını korur;
  `AuditService.archiveOlderThan` doğrudan çağrıldığında o bayrağa hiç bakılmaz.

**Çakışma senaryosu**
- T1 (zamanlayıcı, 03:00): `findMany` → 5.000 satır seçer, tx'e girer.
- T2 (admin, "Disk doldu, arşivi elle koştur"): aynı anda `findMany` → **aynı 5.000 satır**.
- T1 commit eder. T2'nin `createMany(skipDuplicates)` 0 ekler, `deleteMany` 0 siler (satırlar gitti),
  fonksiyon **`archived: 5000`** döner.
- SONUÇ: panel "5.000 kayıt arşivlendi" der, admin "demek ki 10.000 taşıdım" sanar; gerçek 5.000'dir.
  `audit.lastArchiveAt` iki kez damgalanır.

**failure_mode.** Disk baskısı altında admin manuel arşivi 4 kez koşturur, panel her seferinde
"5.000 arşivlendi" der; admin 20.000 satır temizlendiğini sanır ama tablo aynı kalmıştır (zamanlayıcı
onunla yarışıyordur). Yanlış rakam, gerçek çözüm (batch/kapasite ayarı) yerine yanlış teşhise götürür.

**Veride fiili ihlal (K2).** ARANMADI — DB erişimi yok (zaten bu bulgu yalnız ölçüm anında görülür).
`SELECT count(*) FROM system_log_archives;` ↔ audit'teki arşiv olay toplamı karşılaştırılabilir.

**İş etkisi.** Operasyonel gösterge yanlış; veri kaybı yok.

**Öneri (2. tur için).** `createMany` ve `deleteMany` dönüşlerindeki `count`'ları oku, `archived` olarak
`deleted.count`'u dön; `selected` alanını ayrıca döndür (ikisi ayrışıyorsa çağıran görsün).
Beceri §3.2 diliyle: bu bir **koşullu kapanış** `updateMany`'sidir ve `count` yükümlülüğü YAZILI olmalı.

**Kabul kriteri.** `test_audit_depth §10.4c`: aynı fixture'ı iki kez `archiveOlderThan` ile çağır;
ikinci çağrı `archived === 0` dönmeli. Negatif sonda: `logsToArchive.length` geri konunca KIRMIZI.

**Efor.** 0,25 gün.

**Önceki defter.** Yok.

---

## 5. Uygulanan kontrol listesi

Alanım senaryo merkezli olduğu için Bölüm 3'ün **A · B · D · E · I · J · K** maddeleri, senaryo yollarına
değdiği ölçüde uygulandı. Madde madde:

| Madde | Durum |
|---|---|
| **A.1** Check-then-act | **Uygulandı** — merge (`:549-598` taze oku + guard, kilit ÖNCE ✔), `startCopyJob` (`:399-415` await'siz senkron claim ✔), `reserveLoginAttempt` (`login-lockout.ts:66-88` senkron bölge ✔), import (`prepareRows` → döngü: bilinçli, dosya başlığında yazılı). Bulgu: S-5-04. |
| **A.2** Lost update | **Uygulandı** — feature-flag'ler ayrı satırlar (blob DEĞİL) → §3.3 koşulları sağlanmıyor; `dbRestore.copies` JSON RMW zaten `BULGU-T1-092`'de (AYAKTA, yeniden açılmadı). |
| **A.3** İzolasyon / phantom | **Uygulandı** — üçlü koşul merge'de sağlanıyor → S-5-04. `isolationLevel` yokluğu tek başına bulgu yazılmadı (beceri §9.11). |
| **A.4** Prisma tx tuzakları | **Uygulandı** — merge 120 sn tavanı `BULGU-T1-102`'de; kapanış bütçesiyle ilişkisi S-5-01. `tx.*` + `Promise.all` ihlali aranmadı-bulunmadı (ESLint kuralı var). |
| **A.5** Zamanlanmış iş / çoklu instance | **Uygulandı** — K8 beş sorusu senaryo düzeyinde yeniden koşuldu; "cluster'da bozulur" YAZILMADI (beceri §5/§9.7). Yeni açı: **tek process'te de** gerçek olan orphan çocuk → S-5-03. |
| **A.6** Belge numarası üretimi | **Kapsam dışı** — S-1/S-2 alanı; bu turda ops akışlarına değmedi. Yalnız kopya DB adının saniye çözünürlüğü S-5-03'te kanıt olarak kullanıldı. |
| **A.7** AsyncLocalStorage | **Uygulandı (kısmi)** — `currentOrigin()`/`requestId` audit'e taşınıyor; `setFeatureFlags`'in 50 ayrı audit satırı ORTAK `requestId` taşıdığı için gruplanabilir (bulgu değil, doğru yapılan). |
| **A.8** Cache ↔ eşzamanlılık | **Uygulandı** — feature-flag cache invalidate COMMIT'ten sonra + `cacheGeneration` guard'ı ✔; reason-preset cache cold-start boşluğu → S-5-06. |
| **B.1** DB seviyesinde tekillik | **Kapsam dışı (kısmi)** — `nameFold` seddi `BULGU-T2-009`'da; içe aktarım ↔ elle giriş yarışı o bulgunun altında kalıyor, yeniden açılmadı. |
| **B.3** API idempotency | **Uygulandı** — import replay anahtarı (S-5-02); `reportError` `clientErrorId` ✔; kartela/fason sevkte roll claim'i replay'i 409'a çeviriyor ✔. |
| **B.4** Kuyruk / entegrasyon | **Uygulandı** — mobil kuyruğun 4xx fail-fast / 5xx×3 politikası okundu (`mobil/src/offline/mutations.ts:126-131`) ve S-5-06'nın etkisini belirledi. |
| **C** Veri modeli | **Kapsam dışı** — D-C denetçisinin alanı; yalnız "tombstone'a FK sağlam kalır" tespiti S-5-04'te kullanıldı. |
| **D** Tx sınırları | **Uygulandı** — S-5-01 (bütçe), S-5-02 (tx dışı çok-adımlı iş), S-5-03 (tx dışı yan etki = child process), S-5-05 (arşiv tx'i ATOMİK ✔). |
| **E** İş kuralı değişmezleri | **Uygulandı (dar)** — "birleştirilen ana veriye canlı satır bakamaz" değişmezi S-5-04'te; diğerleri S-1…S-4'ün alanı. |
| **F** API/Express | **Kapsam dışı** — `express.json` limitleri, guard zinciri ve `data:import` izinleri T1'de (`BULGU-T1-114`, `-112`) kapsanmış; yeniden açılmadı. |
| **G** Güvenlik | **Uygulandı (dar)** — S5f senaryosu: `tokenVersion`/oturum iptali ölçüldü ve **KORUNUYOR** çıktı (aşağıda). `BULGU-T1-051/-052/-053`, `T2-012/-013/-030` yeniden açılmadı. |
| **H** Performans | **Uygulandı (dar)** — arşiv batch boyutu (S-5-05); `listDbCopies` maliyeti `BULGU-T1-162`'de. |
| **I** Hata/gözlemlenebilirlik | **Uygulandı** — S-5-01 (kesilen işin izi yok), S-5-02 (audit tamponu), S-5-07 (yanıltıcı sayaç). |
| **J** Migration/kurtarma | **Uygulandı** — `kur.ps1` sırası + 42/195 `SET statement_timeout` ölçümü S-5-03'ün ikinci dalını kuruyor. |
| **K** Test/bekçiler | **Uygulandı** — `test_audit_depth §10.4` kör noktası (S-5-05), `test_master_data_merge*` paralel sonda yokluğu (S-5-04), `test_reason_presets` sonda tuzağı (S-5-06 kabul kriteri). |
| **L** Kod kalitesi | **Kapsam dışı** — D-L denetçisinin alanı. |
| **4.2 / 16** "Her entegrasyon içe aktarma yolu" | **Uygulandı** → S-5-02. |
| **4.2 / 18** "Kullanıcı-rol-yetki değişikliği" | **Uygulandı** → bulgu yok; §Doğru yapılanlar'da gerekçeli. |
| **4.3** "Pod restart'ı bir `$transaction` tam ortasında" | **Uygulandı** → S-5-01/-02/-03/-06. |
| **4.3** "Sayım açıkken depoya mal giriyor" (ERP karşılığı: merge açıkken saha yazıyor) | **Uygulandı** → S-5-04. |

---

## 6. Doğru yapılanlar (korunması gereken kalıplar)

1. **`startCopyJob`'un senkron atomik claim'i (`db-copy.service.ts:399-415`).** Claim'e kadar HİÇ `await` yok
   ve bunun *neden* böyle olduğu satırın üstünde yazılı ("Claim await'lerin arkasındayken … ikinci istek de
   `currentJob`'u null görüp paralel ikinci `pg_restore` başlatabiliyordu"). Node'un tek-thread'liliğini
   doğru kullanan, sınıfının en temiz örneği. **Bu bloğa `await` eklemek yasak olmalı** — bekçisi yok
   (`test_db_copy_single_start.ts` var ama `TEST_DB_COPY=1` kapılı, K9 notu).

2. **Arşivlemenin tek tx'i ve `SET LOCAL` sırası (`audit.service.ts:230-262`).** "Arşiv dosyası yazıldı ama
   DELETE düştü (ya da tersi)" senaryosu **yapısal olarak imkânsız**: `createMany` ve `deleteMany` AYNI
   interaktif tx'te, `SET LOCAL teks.audit_purge` ise silmeden ÖNCE — ve bekçi (`test_audit_depth §10.5`)
   varlığı değil **kaynak sırasını** ölçüyor. Beceri §4.2'nin istediği tam olarak budur.

3. **İzin değişikliğinin oturuma anında yansıması.** `verifyToken` her istekte `tokenVersion` + `isActive` +
   `Session.revokedAt`'i **taze** okuyor (`auth.middleware.ts:74-96`), ve izin yazan HER yol bump'ı
   **aynı tx'te** yapıyor: `grantPermission :218`, `setUserPermissions :334`, `revokePermission :394`,
   `resetUserPassword :427`, `deactivateUser :692`, `deleteUser :758`, `applyTemplate` merge dalı `:1014-1024`.
   Ayrıca süreli izinler token'ın `exp`'ini **kırpıyor** (`auth.service.ts:307-338`: en yakın `validUntil`
   VE en yakın `validFrom` — ikisi de). Sonuç: "token 30 gün yaşıyor" (`BULGU-T2-030`) doğru olsa bile
   **bayat izinle çalışma penceresi yok**. Senaryonun varsayımı ölçüldü ve ÇÜRÜTÜLDÜ.

4. **Feature-flag'lerin satır-başına ayrılması + doğrulamanın Zod'a taşınması.** Her bayrak kendi
   `SystemSetting` satırı → iki admin farklı anahtar yazınca JSON blob ezme (§3.3) YOK. Aralık/cross-field
   kuralları `routes/feature-flag.routes.ts:94-230`'da Zod `strictObject` içinde ve orada bir yorum bunun
   sebebini yazıyor: *"F228: cross-field kurallar Zod'a taşındı → servis orta-döngüde throw edemez
   (kısmi commit imkânsız)"*. Servisteki `typeof` kontrolleri savunma katmanı olarak duruyor.
   **Bu kalıbı yeni sayısal ayar eklerken bozma** — Zod'a aralık koymayı unutmak, ~50 sıralı upsert'in
   ortasında 400 üretir ve yarım uygulanmış ayar kümesi bırakır.

5. **`gracefulShutdown`'da `flushLatencyNow` + paralel (sıralı DEĞİL) 2 sn'lik bütçe** (`server.ts:160-165`).
   Kapanışta bellekteki gecikme delta'ları kaybolmuyor ve iki kapanış işi tek bütçeyi paylaşıyor —
   yorumda gerekçesi yazılı ("sıralı olsaydı iki bütçe toplanır ve 5 sn'lik zorla-çıkış sayacını yakma
   riski doğardı").

6. **Rol şablonu uzlaştırmasının `isActive`'i ezmemesi** (`role-template-catalog.job.ts:167`).
   "Pasifleştirdiğim sistem rolü bir sonraki restart'ta dirilir mi?" sorusu senaryo listesinde vardı —
   cevap HAYIR ve bu bilinçli, yazılı bir karar.

7. **`runProcess`'in TEK kapı olması** (`pg-tool.helper.ts:83-137`): stderr tüketimi, `error`/`close` ayrımı,
   `timedOut` bayrağı, 64 KB tavanı bir kez doğru yazılmış. S-5-03'ün önerdiği çocuk-kaydı da tam olarak
   **buraya** eklenmeli — ikinci bir spawn noktası açılmamalı.

---

## 7. Sınır ötesi notlar

- **(S-1 / mobil)** `mobil/src/offline/mutations.ts:126-131` — `4xx = kalıcı düşüş` kuralı, backend'in
  "geçersiz kod / kaynak hazır değil" ayrımını yapmadığı her yerde **kayıt kaybına** çevriliyor
  (S-5-06'nın etkisi bundan doğuyor). Backend'in hangi 4xx'lerinin gerçekten "bir daha deneme" anlamına
  geldiği hiçbir yerde listelenmemiş. S-1 denetçisi KK1 tarafında aynı sınıfı görmüş olabilir.
- **(D-G / güvenlik)** `login-lockout.ts:24` PIN/kart deneme sayacı bellekte ve **restart'ta sıfırlanıyor**
  (dosya başlığında yazılı, bilinçli). `ecosystem.config.js:60-64` `restart_delay: 4000` +
  `max_restarts: 10` + `max_memory_restart: "1G"` ile birleşince: sürekli restart eden bir süreç
  brute-force penceresini periyodik olarak sıfırlar. `BULGU-T2-030` sahada bu ayarların zaten KAPALI
  olduğunu ölçmüş; o yüzden bulgu yazmadım ama bayrak açılırsa bu not geçerli olur.
- **(D-J / migration)** 195 migration'ın **42**'sinde `SET statement_timeout` var. `deploy/kur.ps1:287`
  `migrate deploy` adımı DB-level `statement_timeout=50s` altında koşuyor ve `lock_timeout` HİÇ ayarlı
  değil → kilit beklemesi 50 sn'de "canceling statement" ile düşer, `kur.ps1:288` "DB kısmi değişmiş
  OLABILIR" der. J denetçisi bunu S-5-03'ten bağımsız olarak da değerlendirmeli.
- **(D-I / gözlemlenebilirlik)** `reportJobFailure` yolu (`jobs/job-failure.ts:34`) canlıda **hiç
  tetiklenmemiş** (K8 ölçümü: `JOB_FAILED:%` dev'de 0, saha'da 0). S-5-05 gerçekleşirse bu kanalın ilk
  müşterisi o olacak — kanalın gerçekten görünür olduğu (panelde bir yüzeyi olduğu) doğrulanmalı.
- **(D-C / şema)** S-5-04'ün yapısal çözümü şema tarafında da düşünülebilir: `mergedIntoId IS NULL`
  şartlı bir FK yok (PostgreSQL desteklemiyor) ama `rolls`/`orders` üzerinde bir **trigger** ya da
  `consistency-check.sql`'e §27 bölümü mümkün. C denetçisi 46 FK haritasında bu boşluğu görmüş olabilir.
- **(D-K / bekçiler)** `test_audit_depth §10.4` tek satırla ölçüyor (S-5-05) ve `test_db_copy_single_start.ts`
  `TEST_DB_COPY=1` kapılı → varsayılan `npm test` koşumunda **atlanıyor** (K9 notu). İki bekçi de
  "yeşil ama boş" sınıfında.

---

## 8. KAPSANMAYAN / ERİŞİLEMEYEN

1. **VERİTABANI ERİŞİMİ YOK (en ağır sınır).** `sql-dev.sh` / `sql-saha.sh` ikisi de
   `FATAL: Postgres.app failed to verify "trust" authentication` veriyor. Sonuç:
   **hiçbir K2 ve hiçbir K3 üretilemedi**; 7 bulgunun tamamı K1'de kaldı ve S0 yazılmadı.
   Her bulguda koşulacak SQL yazılı — ③/④ turunda DB açıldığında mekanik olarak koşulabilir.
2. **Repro scriptleri yazılmadı.** Sözleşme "ölçüm commit SONRASI, DB'DEN" diyor; koşulamayan bir script
   repoya doğrulanmamış bir bekçi olarak girer ve daha sonra "bu senaryo denendi" yanılgısı üretir.
   Yerine her bulguda çizelge + kabul kriteri (negatif sondasıyla birlikte) verildi.
3. **Windows gerçek kapanış davranışı ölçülemedi** (ortam darwin): pm2 IPC `shutdown` mesajının gerçekten
   `kill_timeout`'a saygı duyduğu, `pm2 delete`'in de aynı yolu izlediği, ve orphan child'ın Windows'ta
   gerçekten hayatta kaldığı **yalnız Node/pm2 davranışından çıkarıldı**. S-5-03'ün kanıt zinciri bu
   noktada bir kademe zayıf; kesinleştirme sahada tek bir ölçümle yapılır (`pm2 restart` sırasında
   `Get-Process pg_dump`).
4. **`prisma migrate deploy`'un tek tx mi olduğu** çözülemedi — repo içinde çelişkili iki not var
   (K2b H-10). S-5-03'ün "yarım migration" dalı bu belirsizliğin altında; ama `kur.ps1:288`'in kendi
   metni ("DB kismi degismis OLABILIR") aynı belirsizliği kabul ediyor.
5. **Canlı prod'a erişim yok.** `audit_guard`'ın bugün açık olup olmadığı, `system_logs`'un gerçek yaşı,
   sahada koşan bir `pg_dump` olup olmadığı yalnız 2026-08-25 kopyasından çıkarılabilirdi — o da bu
   oturumda okunamadı.
6. **Offsite süpürücü (rclone) runtime yolu** ölçülemedi: sahada rclone kurulu değil
   (`BACKUP_RCLONE_REMOTE` boş, K8 §5). S-5-03'ün üçüncü child'ı bu yüzden yalnız kod düzeyinde kapsandı.
7. **Electron paneli okunmadı** — "yarıda kalmış kopya" ve "içe aktarım sonucu" ekranlarının operatöre
   ne söylediği (S-5-02 ve S-5-03'ün kullanıcı tarafı) yalnız backend metinlerinden çıkarıldı.
8. **S5g'nin "iki admin aynı anda" dalı** yalnız feature-flag'ler için kapatıldı. `documentsConfig` /
   `travelerCardConfig` / `companyLetterhead` gibi **JSON blob** ayarlarında istemcinin tam nesne
   göndermesi kaynaklı lost update `BULGU-T1-147` ile **ELENMİŞ**ti; yeni kanıt üretemediğim için
   yeniden AÇMADIM.
