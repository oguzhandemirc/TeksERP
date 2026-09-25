# TeksERP — Monorepo Kökü

> **Bu dosya her oturumda yüklenir; yalnız her alanda geçerli ÇEKİRDEK'i ve alan haritasını taşır.** Alan kuralları `docs/kurallar/<alan>.md`'de (o alana dokunmadan ÖNCE oku), karar hikâyeleri `docs/history/CLAUDE-NOT-ARSIVI.md`'de. Yeniden yapılandırma: 2026-09-05 anlama turu (önceki sürüm: git `6695afc2`, 42k token → hedef ≤ 12k; kapı `scripts/check-docs.mjs`).
>
> **Tek gövde, çok fabrika — kural yazarken sor: çekirdek mi, profil mü?** [ÇEKİRDEK] her kurulumda aynıdır (defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapılar, sır hijyeni, veri bütünlüğü). [PROFİL] bu fabrikanın seçimidir ve bayrak/veriyle değişir (rota, istasyon topolojisi, açık modüller, sayısal ayarlar). Ölçüt ve red gerekçeleri: `docs/design/MODUL-BAYRAK-TASARIM.md` §0, §11, §12.

Tekstil fabrikası ERP'si. Üç alt proje, her birinin kendi `CLAUDE.md`'si var:

| Proje | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL backend | 4000 |
| `Electron/` | Electron 42 + React 19 + Vite yönetim paneli (**admin frontend buraya yazılır**; `React/` yok) | 5174 |
| `mobil/` | React Native + Expo 54, Android tablet (yatay) + telefon (dikey) — saha | — |

**Dallanma:** `feature/*` → `main`; müşteri dalı YOK. Fabrika paketi ve demo derlemesi `main`'den üretilir; müşteri farkı yalnız bayrak profilinde yaşar — "adnansahin'de yok" = "bayrağı kapalı". `if (musteri === 'X')` fork'un ilk sinyalidir, yasak.

## Üretim akışı — referans profil (adnansahin), sistemin kısıtı DEĞİL

```
Stok (Roll) → İş Emri → KK1 (RAW_QC) → [opsiyonel Fason] → Kurşun + KK2 (PROCESS_QC) → Tambur →
  Depo (RollStatus.WAREHOUSE) → Çuval (Sack; müşteri opsiyonel, rezerv YOK) → Sevkiyat (PLANNED → DISPATCHED)
```

Her adım istasyon kataloğu + rota şablonundan kurulur; **TOPUN rotası için** devere/çözgü/haşıl yeni mimari istemez — istasyon kataloğuna istasyon, rotaya adım eklenir. Her rotanın SON adımı topu finalize eder (Tambur özel değil); depo bir istasyon değil bekleme statüsüdür; `PRODUCED` limbosu yok. Ayrıntı: `docs/kurallar/tambur.md`, `kalite.md`, `sevkiyat.md`.

⚠️ **Ama rota mimarisi TOPA aittir, fabrikanın tamamına değil.** Kendi nesnesi, kendi yaşam döngüsü ve kendi defteri olan üretim alanları **kendi tablolarını, kendi tx sınırlarını ve kendi mimarilerini taşıyabilir** — levent (`WarpBeam`) ve tezgah telemetrisi bunun ilk örnekleri. Ölçüt: *nesne topun rotasında bir ADIM mı, yoksa kendi kimliği ve defteri olan ayrı bir VARLIK mı?* İlkinde istasyon/adım eklenir, ikincisinde yeni model meşrudur (kullanıcı kararı 2026-09-13). Çekirdek kurallar (defter semantiği, ters yol, atomik claim, fail-closed) yeni alanda da aynen geçerlidir. [PROFİL] `adnansahin` bugün çözgü/dokuma yapmıyor, kumaş hazır geliyor — bu fabrikanın durumudur, sistemin kısıtı değil.

## Çekirdek değişmezler — her kurulumda, her oturumda

### Veri ve defter
- **PRODUCTION CANLI ve tekil değil** — her canlı kurulumda gerçek veri korunur: `migrate reset` / reseed / toplu `DELETE` YASAK; migration geri alınamaz (rollback = yedekten restore); toplu düzeltme script'i dry-run varsayılan, `--apply` öncesi etkilenen her kaydı listeler; şema provası en eski canlı dump'ta (restore → `migrate deploy` → bekçiler → profil boot). Seed fixture'ı serbestçe değişir; fabrikanın topları/siparişleri korunur.
- Her modelde UUID PK + `createdAt`/`updatedAt` (M:N pivot ve append-only log yalnız `createdAt`); her `DateTime` `@db.Timestamptz`, UUID kolon `@db.Uuid`; `PG_SESSION_OPTIONS` (`-c timezone=UTC`) süs değil. Fabrika günü Europe/Istanbul, tek kaynak `src/constants/time.ts` (çıplak `DATE_TRUNC` yasak).
- **DEFTER-ÖNCELİKLİ** (2026-09-10 doktrini): durum tabloları "şu an ne"yi, defterler "ne oldu"yu tutar ve **"ne oldu" asla değişmez**. Yalnız soft delete (`isActive:false` / `RollStatus.CANCELLED`); `SCRAP` gerçek fire kararıdır, arşivleme değil. Hard delete İKİ sınıfla sınırlıdır — ③b **saf yapılandırma pivotu** replace'i (parasal/ticari/kalite sonucu YOK; değişikliğin kendisi karar defterine yazılır) · ④ **deftere hiç yazmamış taslak** (atomik claim'li). Diğer her "sil" bir DURUM GEÇİŞİDİR ve defterine satır yazar. Eski ① guard'lı silme ve ② alias/karar satırı sınıfları KALKTI (guard kalır, silme gider: `isActive:false` / `VOIDED` / `revokedAt`+`revokedById`); eski ③ bölündü — ticari pivot (`ItemPrice` · `SackAllocation` · `PaymentAllocation` · `WorkOrderToOrderLine`) versiyonlanır ya da ters kayıt alır. ⚠️ **Hangi satırın DEFTER olduğu yanlışlanabilir bir testle belirlenir:** *bir satır silindiğinde raporlanan hiçbir sayı değişmiyorsa o satır DEFTER DEĞİLDİR ve saklama süresi sonlu olabilir* — **audit** (6 ayda arşivlenir) ve **telemetri** (budanır — bugün `EndpointLatencyDaily` ve `Session`; tezgah kovaları Faz 2; `MachineRun` telemetri DEĞİL defterdir) bu sınıftadır; ikisi de "ne oldu asla değişmez"in istisnası değil, **kapsamının dışıdır**. Telemetrinin ölçütü BUDANABİLİRLİKTİR (`updatedAt`/yeniden yazım şart değil): deftere ya da bir İŞ KARARINA giren her sayı budamadan ÖNCE kalıcı kolona donar; yaşa göre budanan her tablo beyanlıdır ve budama izni bekçiyle ÖLÇÜLEREK verilir (`test_telemetri_defter_degil`). Envanter, sınıf tablosu, ters-yol durumu, telemetri bölümü: `docs/kurallar/defter.md`.
- Her CUD → `AuditService.log()`; istisnalar `AUDIT_EXEMPT_MODELS`te BEYANLIDIR ve sınıf kümesi KAPALI (kullanıcı tercihi · telemetri · kimlik akışı · ebeveyn eylemde · sistem işi), beyansız sessizlik KIRMIZI (`test_audit_muafiyeti`, iki kollu: model başına yazma yolu + dosya düzeyi cırcır); denetim modelin YAZMA YOLUNDA aranır, dosya katmanında değil; audit best-effort ve tx DIŞINDA; sayaç `/api/admin/health`te. **Audit yalnız AYAK İZİDİR:** çalışan programda `SystemLog`/`SystemLogArchive`i yalnız ayak izini bir İNSANA gösteren yüzeyler okur (denetim ekranı/raporu · kayıt geçmişi/künye · yedek etki tanısı); audit'ten karar, iş sayısı, durum, geri alma ya da join türetilmez — bilgi iş kararına giriyorsa kendi hareket tablosunda/kalıcı kolonunda durur (iş emri ↔ iş emri hareketleri); tek istisna geçmişi yeni deftere BİR KEZ aktaran beyanlı göç script'i. Kapı `test_audit_okuma_kaynagi`, allowlist yalnız yönetici onayıyla (kullanıcı kuralı 2026-09-25).
- Sevk rakamı HER yüzeyde BRÜT; iade ayrı belgeyle kapanır, çıkış belgesi düzeltilmez; storno ≠ iade. Olay defterinde kronoloji `createdAt`'tir (`eventDate` kullanıcı girdisi); ters kayıt daima bugüne yazılır; deftere yazan her ileri kaynağın **beyan edilmiş bir ters MEKANİZMASI** olmalı — damga · ters bağ · tipli enum çifti · net karşı olay · karşı kayıt (aynı deftere from↔to takaslı ikinci satır, yazanı ileri yolun kendisi); `*_CANCEL` bunlardan yalnız biridir ve tek biçim değildir (ölçüldü: 13 olay tipinin 6'sında ters yol var ama adı `*_CANCEL` değil). Mekanizma `scripts/lib/defter-beyan.ts`te beyan edilir, `test_defter_ters_yol` ölçer. Geri alma ileri kaydı NE SİLER NE DEĞİŞTİRİR — defter satırı silmek ve ileri damgayı `null`'lamak (`dispatchedAt` · `weighedAt` · `invoicedAt` · `remainderClosedAt`) ters kayıt DEĞİLDİR, yasaktır.
- Beş sağlamlık sınıfı adıyla anılır (iki tarih · ters yol · kilit sırası · çift yüklem · tek kaynak satır) ki altıncı kez açılmasınlar — `docs/kurallar/finans.md`.
- Ölü top kümesi tek kaynak `K18_DEAD_STATUSES`; `finalizedAt`/`statusChangedAt` damgasını DB trigger'ı yazar, elle yazılmaz.
- Yıkıcı işlemde (iptal/sil/scrap) backend preview ucu döner, arayüz etkilenen HER kaydı listeler ve per-record seçim sunar; soyut sayı yetmez. Validation mesajları Türkçe; **TR-only bilinçli**, i18n kurulmaz.

### Eşzamanlılık
- Durum geçişi ATOMİK CLAIM: `updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`; `findUnique→if→update` YASAK; `tx.*` çağrıları `Promise.all` ile paralelleştirilmez. Count-0 tanısı tx içinde taze okumayla ve sayaç kaynaklarında simetrik.
- Advisory kilit tx'in **İLK ifadesi**dir (sonra alınan kilit hiçbir şey kazandırmaz, TOCTOU); her uzayın TEK sahibi olur ve envanter `helpers/period-guard.helper.ts` başlığındadır (8021 KK1 mükerrer · 8022 parti no · 8023 sevkiyat · 8024 oturum · 8025 izin · 8026 cari dönem · 8027 alış siparişi · 8028 kasa/banka · 8029 kod tekilliği · 8030 master-data birleştirme · 8031 paketleme grubu numarası · 8032 dokuma işi numarası · 8033 ambalaj no · 8034 parti kodu sayacı · 8035 partisiz çuval ambalaj no); envanter bekçiyle ölçülür (`test_advisory_lock_namespaces`) — tam liste ve gerekçeler `docs/standart/ESZAMANLILIK.md`. Tek tx'te birden çok kilit deterministik sırada; PG 40P01/40001 → 409 "tekrar deneyin".
- Durum ↔ sayaç çifti olan modelde iki yazar da karşı koşulu kendi atomik WHERE'ine koyar + DB CHECK seddi (çift yüklem kuralı).
- **İdempotency:** kayıt yaratan uçlar `clientToken @unique` taşır (15 model; ölçüldü 2026-09-05); istemci token'ı MANTIKSAL DENEME başına bir kez üretir; token yalnız sonucu belirsiz bırakan hatada (ağ/zaman aşımı/5xx) yapışır, kesin 4xx'te yapışmaz; replay dört durumlu (`helpers/token-replay.helper.ts`).

### Tek kaynak ve ayrışan yüzey
- "Türetilmiş alan / ayrışan yüzey" sınıfı: aynı soruyu cevaplayan koşul TEK helper'da yaşar ve AST bekçisiyle korunur; elle kopya yasak. Bellek-içi yüklem ile Prisma parçası **boğaz-ikizdir** ve birlikte değişir (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`; saf yüklem WHERE'e giremez).
- Liste + cursor + özet şeridi tek where'den doğar; cursor'lu listede süzme SUNUCUDA; elle okunan her id filtresi `readIdCondition`/`readFilterList`'ten geçer (CSV de string'dir).
- Enum'a değer eklemek, bayrak eklemek, route+izin eklemek **reçeteli iştir** (`docs/RECETELER.md`) — "altıncı enum değeri unutuldu" ve "dört kapı" sınıfı hatalar sessizdir.
- İstek gövdesini elle kuran istemci katmanı sessiz bir allowlist'tir; Zod tanımadığı anahtarı sessizce siler — alan iki uçta da sözleşmeye eklenir. Müşteri belgesinde iç veri taşıyan kolon OPT-IN doğar (allowlist), blocklist yeni kolonu sızdırır.
- ⚠️ **`BaseController` modelinde yeni bir SKALER kolon, aynı anda yeni bir YAZILABİLİR ALANDIR** — ayrı bir karar gerektirmeden (ölçüldü 2026-09-13: `sanitizeWriteData` DMMF'in tüm skalerlerini geçirir, mass-assignment koruması yalnız İLİŞKİLERİ kapatır; `Machine`e eklenen kolon gövdeden yazıldı). ⇒ Kolon eklerken sor: *bu alan o uçtan yazılabilir olmalı mı?* Olmamalıysa yazılabilirliği **açıkça** kapat; olmalıysa doğrulaması aynı dilimde iner. 13 route bu sınıfta.
- **Numara DOĞUŞTA materyalize edilir, render'da biçimlenmez:** her seri (çuval · sevkiyat · sevk partisi · belge no…) doğduğu anda tam stringi kendi kolonuna yazar; ekran, belge, Excel ve barkod o kolonu okur. Ön ek/tarih/hane KODDA DEĞİL `number_series` tablosundadır (kimlik katalogda, biçim veride) ve biçim değişimi yalnız YENİ elemanı etkiler — eski ön ek emekliye ayrılır, okutulmaya devam eder. Sunum katmanında biçimlendirmenin tek istisnası "eski belgeler de değişsin" bayrağı olan alanlardır ve orada program ekranı ile belge AYNI resolver'ı çağırır. `docs/kurallar/numaralandirma.md`.
- **Master veri modelinde KİMLİK ile ROL ayrılır:** gerçek dünyadaki bir nesne ileride başka bir rol de alabiliyorsa rol bir BAYRAK (ya da role bağlı profil) olur, ayrı bir kimlik tablosu DEĞİL; finans kimliği (cari hesap) tek kimliğe bağlanır, XOR'lu çift bağ yasaktır. Yanlış kurulan kimlik sonradan düzeltilmez, GÖÇ ister (ölçüldü: fason tablosu → üç dilimlik faz). Beş kapı: `docs/standart/MASTER-VERI-TASARIMI.md`.

### Kapılar ve sözleşme
- FAIL-CLOSED varsayılan: tanınmayan kapsam 400, çözülemeyen şablon 400/404 (yerleşiğe sapma yok), izin guard'ı anahtar-kapsamlı ve düz OR'a çevrilmez, önbellekte TTL tazeliktir geçerlilik değil (bayat döner + tazeler; hiç dolmadıysa fail-closed kalır).
- Hata kodu `details.code` altında (`body.code` hep undefined); kapalı modül 403 `MODULE_DISABLED`; uzakta kapalı yol 404 (403 varlığı doğrular). Uzak/LAN ayrımı soketten, `clientType` güvenlik sınırı değil; tünel dinleyicisi yalnız `127.0.0.1`.
- Bir yetenek "VAR" sayılmak için üçü birden: motor + en az bir çıkış yüzeyi + izin ataması. İzin kataloğu koda, atama panele (uzlaştırma getirir, ATAMAZ); SoD üçlüsü (`shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`) yalnız Muhasebe/Süpervizör; süperadmin rol değil (`["*"]`), panelden atanamaz.
- Yeni davranış bayrağının varsayılanı = BUGÜNKÜ davranış ve bu cümle ÖLÇÜLMEDEN yazılmaz; çıkışsız kapı üreten bayrak yazılır ama AÇILMAZ; kapı takarken "malın çıktığı başka yol var mı" kardeş bayrağın kapsamına bakılarak sorulur. Rota kapsaması KATEGORİ düzeyinde reddetmez, UYARIR (`ApiResponse.warnings`); özellik-başına kapsama sert kalır (create 400 / replace 409 — `docs/kurallar/rota-renk.md`).
- İş emri yalnız üretimi yönetir; tartı/paket/sevkiyat ayrı domain (çuvala bağlanır); top↔sipariş satırı bağı YOKTUR, karşılama `SackAllocation` ile sevk anında. `WorkOrder.type` beyan değil bağın aynasıdır.

### Dağıtım ve sürüm
- **Backend ÖNCE**, panel + tablet sonra; sözleşme kıran değişiklikte (uç kaldırma, alan adı/tipi, zorunlu parametre, enum, izin) "eski istemci ne yapar" açıkça cevaplanır; `minVersion` yalnız gerçek kırılmada ve sahadakinden BÜYÜK OLAMAZ.
- Sürüm notu yazılmadan sürüm çıkmaz: **taslağı Claude yazar, kullanıcı onaylar**; paketleme kapısı durdurur (`surum-notlari.json`). Müşteri kodu her derleme komutunda ARGÜMANDAN; ham `npm run build:win` yasak; manifest EN SON yüklenir; Cloudflare proxy açık kalır; OTA turunda `versionCode`a dokunulmaz. Reçete: `docs/kurallar/surum-yayin.md`.
- Prisma'nın iki motoru var; şema motoru NATIVE — Windows paketi `PRISMA_CLI_BINARY_TARGETS=windows` + MZ kapısı. Commit edilmemiş migration prod'da sessiz eksiktir. Reçete: `docs/kurallar/deploy-kurulum.md`.

### Süreç, sır, donanım
- Backend TEK process: `pkill -f "tsx src/server.ts"` YASAK (yalnız kendi PID'in), ikinci Node süreci yasak (uzak erişim iki dinleyiciyle). Seri port / donanım polling backend'e girmez; eski "Phase 1: gerçek donanım kodu yazma" yasağı 2026-09-05'te BACKEND'e daraltıldı — istemci sürücüleri (Electron IPC serialport/node-hid, mobil HAL BT-Classic) meşru; simülasyon per-cihaz VERİ bayrağı; uydurulmuş değer `source:'SIMULATED'` beyanıyla gider, kararı backend verir.
- Sır hijyeni: süperadmin parolası/PIN/TOTP ve ayar şifresi repoya, log'a, sürüm notuna, audit yüküne GİRMEZ; `.env` uyarısı yalnız anahtar adı basar. `quickPin` düz metin ve tek başına kimliktir — hiçbir yüzeyden sızdırılmaz.
- Yeni paket eklemeden önce onay; Sonnet/ucuz model yalnız mekanik işte (kullanıcı tercihi).

### Belge ve not disiplini
- Yeni karar notu **arşive** yazılır (`docs/history/CLAUDE-NOT-ARSIVI.md`, tarih + `[ÇEKİRDEK]/[PROFİL]` etiketi — karma notta etiket cümle bazında); ilgili `docs/kurallar/<alan>.md`'ye TEK kural satırı eklenir; bu dosyaya yalnız her alanda geçerli bir değişmez girer. Kural ile hikâye ayrılır: kural tek cümle emir kipi, gerekçe/ölçüm arşivde.
- Koddaki yorum 1–3 satır NEDEN söyler, tarih ve ölçüm anlatısı taşımaz (politika: `docs/KOD-KURALLARI.md` § Yorum politikası).
- Bir kural iptal edilince eski cümle silinir, arşivdeki nota "GEÇERSİZ → tarih" başlığı konur; iki cümle yan yana bırakılmaz.

## Yasaklar — kısa liste (tam liste `docs/KOD-KURALLARI.md`)

- `migrate reset` · `migrate dev` (yalnız `--create-only` + `DropForeignKey` satırları silinerek; düz koşum DEFERRABLE FK'ları düşürür) · reseed · toplu `DELETE` · `pkill -f tsx` · ikinci Node süreci.
- `findUnique→if→update` · `tx.*` + `Promise.all` · `notIn: []` · `orderBy: { batchNumber }` · `batchNumber` ile lookup · `toLocaleUpperCase("tr")` · SQL fold'da `\s` · `now() AT TIME ZONE 'UTC'` yeni yazımı.
- Route/controller'da `prisma` import · jenerik `requireModule("x")` · yeni `kind === "PROCESS_QC"` karşılaştırması · `!== "mobile"` · `body.code` okumak · `applied_steps_count` ile migration doğrulamak.
- Belge alan CSS'inde `calc()`/`var()` · şablon literalinde backtick · `add_header … always` (uzun-cache nginx) · `artifactName`de `${productName}` · `.claude`/`.env`'e sır.
- Yeni izin kodu için migration · profil için ayrı yazma ucu · davranış bayrağını profile koymak · `deploy/` altına paket-dışı bağımlılık · kapsam listelerini elle saymak (AST tripwire ölçer).
- Süperadmin kimliğini JWT'ye koymak · TTY'siz `superadmin:kur` · mevcut kullanıcıyı yükseltmek · sistem rolünü sert silmek.

## Alan dizini — dokunmadan önce oku

| Alan | Dosya | Kısa özet |
|---|---|---|
| **Defter · hareket tablosu · ters kayıt · hard delete** | `docs/kurallar/defter.md` | Durum ≠ defter; hard delete iki sınıf; geri alma ters kayıt; defter envanteri ve eksik ters yollar |
| Sevkiyat · çuval · brüt · storno/iade | `docs/kurallar/sevkiyat.md` | Çuval depo nesnesi; `SackAllocation` sevk anında; brüt tek kaynak `RollReturn`; storno ≠ iade; SoD izinleri |
| Fason · kartela | `docs/kurallar/fason.md` | Kısmi kabul topu tüketmez; çekme ölçümdür (RollVariance); LIFO iptal; açık-sevk tek helper; kartela WO'suz |
| Tambur · finalize · kesim · geri alma | `docs/kurallar/tambur.md` | Son adım finalize; `currentStep`'ten WO; split beş yol; aşım koruması iki dalda farklı; plan-sapma kapısı |
| Top düzeltme · iptal · fire · geri alma | `docs/kurallar/top-duzeltme.md` | İptal ≠ fire; kapsam topun durumundan; sebep kodu sunucuda; ölü etiket onayı kalktı |
| KK1 · idempotency · çevrimdışı kuyruk | `docs/kurallar/kk1.md` | Mükerrer tuzağı 8021 tx'in ilk ifadesi; `clientEnteredAt` iki yönlü; kuyruk kalktı, anlık toast |
| Kurşun planlama · bypass | `docs/kurallar/kursun.md` | Dağıtım ön koşul değil; atıf uydurulmaz (`machineId=null`); tek kapı `assertKursunTabletMayWrite` |
| İş emri · sipariş bağı | `docs/kurallar/is-emri.md` | Tip bağın aynası; iki bağ yolu iki sözleşme; kapanış dispozisyonu; giriş noktası; quick-start tek giriş |
| Rota · renk · özellik · kapsama | `docs/kurallar/rota-renk.md` | Renk kısıt değil reçete; özellik gerçek kısıt, boş doğamaz; hedef siparişten; kapsama uyarır; renk kilidi mala bakar |
| Kalite · istasyon yeteneği | `docs/kurallar/kalite.md` | Kalite = istasyon yeteneği, boğaz ikiz; `RollError` Tambur kararıyla kapanır; Faz B açık |
| **Dokuma · dokuma işi · doff · tezgah karnesi** (şema P1…P3 + karne indi; otomatik toplama Faz 2 kâğıtta) | `docs/kurallar/dokuma.md` | Tezgah kendi VARLIĞI, topun rotasında adım değil; `MachineStopEvent` `MachineRun`ın defteri, ayrı varlık değil; top KK1'de doğar (`entrySource=WEAVING`); elle giriş birinci sınıf, rapor "ölçüldü mü elle mi" taşır |
| Parti (Batch) | `docs/kurallar/parti.md` | Kimlik yalnız `Batch.id`; P01…P99 körlemesine sarar (profil); 8022 ilk ifade |
| Yarı mamul | `docs/kurallar/yari-mamul.md` | Arzdır, düşülmez; `RAW_STOCK` bilerek geniş; `rollScope` fail-closed |
| Refakat kartı | `docs/kurallar/refakat-karti.md` | WO ile doğar; plan canlı, sunum canlı, içerik yalnız geçersiz kartta donuk; `resolvePrintPlan` tek karar |
| Belge · etiket · şablon | `docs/kurallar/belge-etiket.md` | İki oran; opt-in kolon; koşullu eleman kodla; SACK barkodu `sackNo`; müşterideki ad donar rejim donmaz; belge tasarımı ayrı yetki |
| Mükerrer · nameFold seddi | `docs/kurallar/mukerrer.md` | Kelime bazlı bulanık eşleme; partial UNIQUE yumuşak kapı; kimlik alanına sed yok; top birleştirilmez iptal edilir |
| **Numaralandırma · numara serisi · ön ek** | `docs/kurallar/numaralandirma.md` | Kimlik katalogda biçim veride; tarih segmenti = sıfırlama dönemi; geçmiş yeniden numaralanmaz, ön ek emekliye ayrılır; çakışma kapısı yalnız tarama uzayında |
| Sebep katalogları | `docs/kurallar/sebep-katalogu.md` | `ReasonPreset` DB'de; `code` asla değişmez; TTL tazelik; son aktif satır gizlenemez |
| Keşif · cihaz · ağ · donanım | `docs/kurallar/kesif-cihaz.md` | Bir satır = bir sunucu (`installationId`); kademeli port; yedekte kimlik zorunlu; cihaz doğuşu bayraktan; patron modülü |
| Sürüm · yayın | `docs/kurallar/surum-yayin.md` | Not kapısı; yama hanesi etiketten; müşteri kodu argümandan; manifest en son; kod imzalama |
| Deploy · kurulum · migration | `docs/kurallar/deploy-kurulum.md` | `kur.ps1` geri alma; iki Prisma motoru; yumuşak kapı; `apply-migration.ts`; altı sözleşme tetiği |
| Modül anahtarları · bayraklar · profiller | `docs/kurallar/modul-bayrak.md` | `finance.enabled` kalıbı; kapalı modül 403; profiller TS sabiti; kapalı modülün bayrağı çizilmez; Dilim 2 |
| Süperadmin · ayar şifresi | `docs/kurallar/superadmin.md` | `isSystemAccount` tek yazar script; görünür ama kimlik teslim edilmez; `flagWriteGuard` sırası; başlıkta şifre, ASCII 8–72 |
| Yetki · izin · rol | `docs/kurallar/yetki-izin.md` | İzin doğrudan kullanıcıya; katalog koda; `matchesPermission` üç istemcide; belge tasarımı izin çifti |
| Filtre · liste · arama | `docs/kurallar/filtre-liste.md` | Sunucu süzmesi; CSV; `updatedAt desc` (giriş sekmeleri Ham Stok + Yarı Mamul hariç); tek metraj; Ctrl+F yok |
| Raporlar · karneler | `docs/kurallar/raporlar.md` | `finalizedAt` trigger; kaynak statü listesi; takvim günü ↔ mutlak pencere; parti araması aday listesi |
| Finans · sağlamlık sınıfları | `docs/kurallar/finans.md` | Beş sınıf; iki tarih; ters yol; kilit sırası; çift yüklem; tek kaynak satır; kasa/KDV bayrakları PROFİL |
| Genel · uzak erişim · konvansiyon | `docs/kurallar/genel.md` | Soket ayrımı; Access JWT fail-closed; TOTP kurulumu; audit; iki dinleyici tek process |

Dizin ve arşiv tarihleri: `docs/kurallar/README.md`. Tasarım belgeleri: `docs/design/` (canlı), runbook'lar: `docs/ops/`, harita: `docs/README.md`.

## Çalışma düzeni

- **Geliştirme döngüsü:** `docs/GELISTIRME-DONGUSU.md` — `.env` `tekserp_demo`'yu gösterir; giriş `admin` / `123123` (seed yalnız admin üretir, sırlar buraya yazılmaz); yeni kullanıcı panelden.
- **Oturum sınırı:** iş kapandığında (commit/push · sürüm · alan değişimi) oturum `/clear` ile tazelenir; bağlamı 500k token üstünde koşan istekler toplam tüketimin %74'üdür (ölçüldü 2026-09-10, 10.180 istek). Dosya döken tarama işi ana bağlama değil subagent'a verilir.
- **Bekçiler:** değişiklikten sonra ilgili alanın bekçileri koşulur — liste alan dosyasının sonunda, tam harita `Teks-Erp/docs/BEKCI-HARITASI.md`. Tek bekçi: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`; tam paket `npm test` **~6,5 dakika** sürer (455 dosya, sıralı; ölçüldü 2026-09-05) ve PR/push öncesi koşulur. Yeni bekçi negatif sondayla kırmızı verdiği doğrulanarak yazılır (`docs/RECETELER.md` § bekçi).
  ⚠️ **CIRCIRA İKİ SONDA gerekir** (ölçüldü 2026-09-13): ihlal ekleyince taban ARTAR (negatif) **ve ihlali düzeltince taban DÜŞER** (pozitif). İkincisi olmadan, tabanı düşüremeyen bir cırcır yazılabilir — ve ***tabanı DÜŞÜREMEYEN bir cırcır, hiç kapı olmamasından KÖTÜDÜR***: borç kapatılamaz, sayı hiç inmez, kapı ilk sıkışmada susturulur, üstelik "çalışıyor" görünerek. Negatif sonda bu kusuru **yapısal olarak göremez**.
- **Reçeteler:** `docs/RECETELER.md` — yeni bayrak · enum değeri · route+izin · migration · bekçi · Electron sayfası · mobil ekran · sürüm çıkarma.
- **Kod yazım standardı:** `docs/standart/README.md` — rutin sorular (katman içerikleri, servis/model şablonu, boyut, kütüphane seçimi, eşzamanlılık karar tablosu, test kadansı). Kural biçimi tek satır + zorlama etiketi; devralınan kod `lint-baseline.json`'da donar.
- **Commit kapısı:** `node scripts/hooks-kur.mjs` (bir kez) → değişen alt projede tip + lint + lint tavanı + migration hijyeni + **hızlı mandallar** (28 DB'siz mandal, eşzamanlı 4, ~8–12 sn; tetik `Teks-Erp/scripts/ | Teks-Erp/docs/ | Teks-Erp/src/ | Teks-Erp/prisma/ | Electron/src/ | mobil/src/ | docs/` — tetik bekçinin okuduğu dizinden geniş olamaz, ondan dar da kalmaz; **yalnız izole worktree'de koşar, ortak ağaçta sesli ⏭ basar** — `scripts/hooks/hizli-mandallar.mjs`). Her koşum `os.tmpdir()/tekserp-kapi-defteri.tsv`e bir satır düşer (best-effort; ısırık ölçümü beyansız). Kaçış `TEKSERP_HOOK_SKIP=1`. **Kapı DIŞI ağır koşum** (tsc · eslint · `npm test` · bekçi paketi) `node scripts/agir-is.mjs -- <komut>` ile — makine-geneli semafor (4 slot) ve defter kapıyla ortaktır; çıplak koşum slot havuzunu görmez ve komşu oturumun kapısını yük altında düşürür (ölçüldü 2026-09-14: 3 eşzamanlı kapı 38 → 250–300 sn, Electron testleri 5 sn zaman aşımı).
  ⚠️ **Kapı bekçilerin yalnız o 23'ünü koşar** ⇒ diğer her dosya yalnız ELLE koşturulduğu kadar ölçülür. İki yönlü zorunluluk (ölçüldü 2026-09-13, iki oturum aynı gün CI'da bedelini ödedi): ① yeni bir **mandal** indirdikten sonra onu KENDİ yeni dosyalarına karşı koştur · ② yeni bir **dosya** yazdıktan sonra onu o dizini tarayan BÜTÜN tarayıcılara koştur — yalnız seni yakalayana değil · ③ bir **sabiti** yeniden adlandıran ya da genişleten commit, o sabiti OKUYAN bütün bekçileri koşturur — tek terimle ölçen bekçi terim gidince kırmızı vermeden kör kalır (ölçüldü 2026-09-15: `MODULE_FLAG_KEYS` yanına ikinci küme gelince iki bekçi sessizce ölçmeyi bıraktı). ⇒ ***Kendine uygulanmayan kural için tek çare kapıdır; "bunu biliyorum" bir kapı değildir.***
- **Kod kuralları:** `docs/KOD-KURALLARI.md` (F221 deseni, atomik claim, Zod↔mutationFn, `details.code`, yorum politikası, tam yasak listesi). **Sözlük:** `docs/SOZLUK.md`.
- **Sürüm çıkarma (özet):** `surum-notlari.json`a not → `node scripts/surum-notlari-kopyala.mjs` → `node scripts/check-surum-notlari.mjs` → panel `./deploy/electron-paketle.sh <müşteri>` + `./deploy/electron-yayinla.sh` → tablet `cd mobil && EXPO_PUBLIC_API_URL=<erp-adresi> npm run yayinla -- --musteri=<müşteri>` paketi ÜRETİR, sahaya çıkış ayrı adım `node deploy/mobil-yayinla.mjs --musteri=<müşteri> --paket=<dizin>` (native değiştiyse `npm run build:apk -- --musteri=<müşteri>` + `--apk=`). Reçete ve tuzaklar: `docs/kurallar/surum-yayin.md`, `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`, `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`.
- **Alt projeler:** `Teks-Erp/CLAUDE.md` (backend katmanları, servis/route disiplini), `Electron/CLAUDE.md` (panel: izin aynası, karo/route/palet), `mobil/CLAUDE.md` (tablet: OTA/APK sınırı, offline kuyruk, HAL).
