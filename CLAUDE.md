# TeksERP — Monorepo Kökü

> **Bu dosya her oturumda yüklenir; yalnız her alanda geçerli ÇEKİRDEK'i ve alan haritasını taşır.** Alan kuralları `docs/kurallar/<alan>.md`'de (o alana dokunmadan ÖNCE oku), karar hikâyeleri `docs/history/CLAUDE-NOT-ARSIVI.md`'de. Yeniden yapılandırma: 2026-10-03 kısaltma turu (önceki sürüm git `a61efbd21`).
>
> **Tek gövde, çok fabrika — kural yazarken sor: çekirdek mi, profil mi?** [ÇEKİRDEK] her kurulumda aynıdır (defter semantiği, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed kapılar, sır hijyeni, veri bütünlüğü). [PROFİL] bu fabrikanın seçimidir ve bayrak/veriyle değişir (rota, istasyon topolojisi, açık modüller, sayısal ayarlar). Ölçüt ve red gerekçeleri: `docs/design/MODUL-BAYRAK-TASARIM.md` §0, §11, §12.

Tekstil fabrikası ERP'si; her alt projenin kendi `CLAUDE.md`'si var:

| Proje | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL backend | 4000 |
| `Electron/` | Electron 42 + React 19 + Vite yönetim paneli (**admin frontend buraya yazılır**; `React/` yok) | 5174 |
| `mobil/` | React Native + Expo 54, Android tablet (yatay) + telefon (dikey) — saha | — |
| `satici/` | Express 5 + Prisma 7 lisans sunucusu (`sunucu/`) + React 19 + Vite portal (`web/`); VDS'te, fabrikaya kurulmaz | 4610 genel · 4611 portal (tailnet) · 4613 portal (Cloudflare Access; kök parolası dahil bütün işlemler) |
| `patron/` | Express 5 + Prisma 7 patron bulutu sunucusu (`sunucu/`); VDS'te, fabrikaya kurulmaz; hedef tesis başına ayrı DB (bugün tek DB + RLS, geçiş borçta) | 4620 |
| `patron/uygulama/` | React Native + Expo 54 patron uygulaması (Android + iOS + web; salt-okunur çevrimdışı önbellek; tel tipleri `patron/sunucu/src/wire/api.ts`in bayt-eşit aynası) | — |
| `Teks-Erp/native/lisans-cekirdek/` | Rust + napi-rs lisans çekirdeği (backend paketine `.node` olarak girer, ayrı süreç değil) | — |

**Dallanma:** `feature/*` → `main`; müşteri dalı YOK, müşteri farkı yalnız bayrak profilinde ("adnansahin'de yok" = "bayrağı kapalı"); `if (musteri === 'X')` yasak; müşteri adı koda gömülmez; hedef sürüm başına TEK ortak paket (`docs/kurallar/deploy-kurulum.md`, `genel.md`, `surum-yayin.md`).

## Üretim akışı — referans profil (adnansahin), sistemin kısıtı DEĞİL

```
Stok (Roll) → İş Emri → KK1 (RAW_QC) → [opsiyonel Fason] → Kurşun + KK2 (PROCESS_QC) → Tambur →
  Depo (RollStatus.WAREHOUSE) → Çuval (Sack; müşteri opsiyonel, rezerv YOK) → Sevkiyat (PLANNED → DISPATCHED)
```

Her adım istasyon kataloğu + rota şablonundan kurulur (devere/çözgü/haşıl = yeni istasyon/adım); her rotanın SON adımı topu finalize eder, depo istasyon değil bekleme statüsüdür, `PRODUCED` limbosu yok (`kalite.md`, `tambur.md`). ⚠️ Rota mimarisi TOPA aittir, fabrikanın tamamına değil: ölçüt *nesne topun rotasında bir ADIM mı, yoksa kendi kimliği ve defteri olan ayrı bir VARLIK mı?* — VARLIK (levent, tezgah telemetrisi) kendi tablolarını, tx sınırlarını ve mimarisini taşıyabilir; çekirdek kurallar orada da aynen geçerlidir (`modul-bayrak.md`).

## Çekirdek değişmezler — her kurulumda, her oturumda

### Veri ve defter
- **PRODUCTION CANLI ve tekil değil** — her canlı kurulumda gerçek veri korunur: `migrate reset` / reseed / toplu `DELETE` YASAK; migration geri alınamaz (rollback = yedekten restore); toplu düzeltme script'i dry-run varsayılan, `--apply` öncesi etkilenen her kaydı listeler; şema provası en eski canlı dump'ta (restore → `migrate deploy` → bekçiler → profil boot). Seed fixture'ı serbestçe değişir; fabrikanın topları/siparişleri korunur.
- Her modelde UUID PK + `createdAt`/`updatedAt` (M:N pivot ve append-only log yalnız `createdAt`); her `DateTime` `@db.Timestamptz`, UUID kolon `@db.Uuid`; `PG_SESSION_OPTIONS` (`-c timezone=UTC`) süs değil. Fabrika günü ve HER görüntü/basım saati (panel · tablet · PDF/Excel · bulut) fabrikanın saat diliminden, tek kaynak `src/constants/time.ts` (istemcilerde bayt-eşit `src/lib/factory-time.ts`) — istemci dilimi değil; dilim [PROFİL] tarihli DÖNEMLER defteridir (`factory_timezone_periods`; satır yoksa Europe/Istanbul) — kaydın saati/günü KAYDIN ANINDAKİ dilimden, **geçmiş etkilenmez**, değişiklik ertesi gün başından ve yalnız önizlemeli uçtan (çıplak `DATE_TRUNC`/`AT TIME ZONE`/dilim literal'i yasak).
- **DEFTER-ÖNCELİKLİ** (2026-09-10 doktrini): durum tabloları "şu an ne"yi, defterler "ne oldu"yu tutar ve **"ne oldu" asla değişmez**. Yalnız soft delete (`isActive:false` / `RollStatus.CANCELLED`); `SCRAP` gerçek fire kararıdır, arşivleme değil. Hard delete İKİ sınıfla sınırlıdır — ③b **saf yapılandırma pivotu** replace'i (parasal/ticari/kalite sonucu YOK; değişikliğin kendisi karar defterine yazılır) · ④ **deftere hiç yazmamış taslak** (atomik claim'li). Diğer her "sil" bir DURUM GEÇİŞİDİR ve defterine satır yazar. Eski ① guard'lı silme ve ② alias/karar satırı sınıfları KALKTI (guard kalır, silme gider: `isActive:false` / `VOIDED` / `revokedAt`+`revokedById`); eski ③ bölündü — ticari pivot (`ItemPrice` · `SackAllocation` · `PaymentAllocation` · `WorkOrderToOrderLine`) versiyonlanır ya da ters kayıt alır. ⚠️ **Hangi satırın DEFTER olduğu yanlışlanabilir bir testle belirlenir:** *bir satır silindiğinde raporlanan hiçbir sayı değişmiyorsa o satır DEFTER DEĞİLDİR ve saklama süresi sonlu olabilir* — **audit** (6 ayda arşivlenir) ve **telemetri** (budanır — bugün `EndpointLatencyDaily` ve `Session`; tezgah kovaları Faz 2; `MachineRun` telemetri DEĞİL defterdir) bu sınıftadır; ikisi de "ne oldu asla değişmez"in istisnası değil, **kapsamının dışıdır**. Telemetrinin ölçütü BUDANABİLİRLİKTİR (`updatedAt`/yeniden yazım şart değil): deftere ya da bir İŞ KARARINA giren her sayı budamadan ÖNCE kalıcı kolona donar; yaşa göre budanan her tablo beyanlıdır ve budama izni bekçiyle ÖLÇÜLEREK verilir (`test_telemetri_defter_degil`). Envanter, sınıf tablosu, ters-yol durumu, telemetri bölümü: `docs/kurallar/defter.md`.
- Her CUD → `AuditService.log()`; istisnalar `AUDIT_EXEMPT_MODELS`te BEYANLIDIR ve sınıf kümesi KAPALI (kullanıcı tercihi · telemetri · kimlik akışı · ebeveyn eylemde · sistem işi), beyansız sessizlik KIRMIZI (`test_audit_muafiyeti`, iki kollu: model başına yazma yolu + dosya düzeyi cırcır); denetim modelin YAZMA YOLUNDA aranır, dosya katmanında değil; audit best-effort ve tx DIŞINDA; sayaç `/api/admin/health`te. **Audit yalnız AYAK İZİDİR:** çalışan programda `SystemLog`/`SystemLogArchive`i yalnız ayak izini bir İNSANA gösteren yüzeyler okur (denetim ekranı/raporu · kayıt geçmişi/künye · yedek etki tanısı); audit'ten karar, iş sayısı, durum, geri alma ya da join türetilmez — bilgi iş kararına giriyorsa kendi hareket tablosunda/kalıcı kolonunda durur (iş emri ↔ iş emri hareketleri); tek istisna geçmişi yeni deftere BİR KEZ aktaran beyanlı göç script'i. Kapı `test_audit_okuma_kaynagi`, allowlist yalnız yönetici onayıyla (kullanıcı kuralı 2026-09-25).
- Sevk rakamı HER yüzeyde BRÜT; iade ayrı belgeyle kapanır, çıkış belgesi düzeltilmez; storno ≠ iade. Olay defterinde kronoloji `createdAt`'tir (`eventDate` kullanıcı girdisi); aynı tx'te aynı varlığa çok satır yazabilen defterde bu kronoloji belirlenimli artar (DB saati + varlığın son olayı + 1 ms) ve "en son" okuyucusu `createdAt`in yanına eşitlik bozucu koymadan yazılmaz (`test_esitlik_bozucu`); ters kayıt daima bugüne yazılır; deftere yazan her ileri kaynağın **beyan edilmiş bir ters MEKANİZMASI** olmalı — damga · ters bağ · tipli enum çifti · net karşı olay · karşı kayıt (aynı deftere from↔to takaslı ikinci satır, yazanı ileri yolun kendisi); `*_CANCEL` bunlardan yalnız biridir ve tek biçim değildir (ölçüldü: 13 olay tipinin 6'sında ters yol var ama adı `*_CANCEL` değil). Mekanizma `scripts/lib/defter-beyan.ts`te beyan edilir, `test_defter_ters_yol` ölçer. Geri alma ileri kaydı NE SİLER NE DEĞİŞTİRİR — defter satırı silmek ve ileri damgayı `null`'lamak (`dispatchedAt` ailesi) ters kayıt DEĞİLDİR, yasaktır; "ne oldu"su AYRI bir defterde satır olan kolon (tartı `weighedAt` · fatura `invoicedAt` · fason kalan `remainderClosedAt`) DURUM kolonudur (kullanıcı kararı 2026-09-26), site başına `test_defter_ters_yol` §14'te beyanlı.
- Beş sağlamlık sınıfı adıyla anılır (iki tarih · ters yol · kilit sırası · çift yüklem · tek kaynak satır) ki altıncı kez açılmasınlar — `docs/kurallar/finans.md`.
- Ölü top kümesi tek kaynak `K18_DEAD_STATUSES`; `finalizedAt`/`statusChangedAt` damgasını DB trigger'ı yazar, elle yazılmaz.
- Yıkıcı işlemde (iptal/sil/scrap) backend preview ucu döner, arayüz etkilenen HER kaydı listeler ve per-record seçim sunar; soyut sayı yetmez. Validation mesajları Türkçe; **TR-only bilinçli**, i18n kurulmaz.

### Eşzamanlılık
- Durum geçişi ATOMİK CLAIM: `updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`; `findUnique→if→update` YASAK; `tx.*` çağrıları `Promise.all` ile paralelleştirilmez. Count-0 tanısı tx içinde taze okumayla ve sayaç kaynaklarında simetrik.
- Advisory kilit tx'in **İLK ifadesi**dir (sonra alınan kilit hiçbir şey kazandırmaz, TOCTOU); her uzayın TEK sahibi olur ve envanter `helpers/period-guard.helper.ts` başlığındadır (8021 KK1 mükerrer · 8022 parti no · 8023 sevkiyat · 8024 oturum · 8025 izin · 8026 cari dönem · 8027 alış siparişi · 8028 kasa/banka · 8029 kod tekilliği · 8030 master-data birleştirme · 8031 paketleme grubu numarası · 8032 dokuma işi numarası · 8033 ambalaj no · 8034 parti kodu sayacı · 8035 partisiz çuval ambalaj no · 8036 token kilidi · 8037 saat dilimi dönemi); envanter bekçiyle ölçülür (`test_advisory_lock_namespaces`) — tam liste ve gerekçeler `docs/standart/ESZAMANLILIK.md`. Tek tx'te birden çok kilit deterministik sırada; PG 40P01/40001 → 409 "tekrar deneyin".
- Durum ↔ sayaç çifti olan modelde iki yazar da karşı koşulu kendi atomik WHERE'ine koyar + DB CHECK seddi (çift yüklem kuralı).
- **İdempotency:** kayıt yaratan uçlar `clientToken @unique` taşır (24 model; ölçüldü 2026-09-26); istemci token'ı MANTIKSAL DENEME başına bir kez üretir; token yalnız sonucu belirsiz bırakan hatada (ağ/zaman aşımı/5xx) yapışır, kesin 4xx'te yapışmaz; replay dört durumlu (`helpers/token-replay.helper.ts`) ve TEK boğazdan geçer (`tokenReplay`: gövde kapısı zorunlu; kaybeden deneme hangi hatayla düşerse düşsün cevap token'dan gelir, iş kuralından değil; istisnalar beyanlı `scripts/lib/token-replay-beyan.ts`).

### Tek kaynak ve ayrışan yüzey
- "Türetilmiş alan / ayrışan yüzey" sınıfı: aynı soruyu cevaplayan koşul TEK helper'da yaşar ve AST bekçisiyle korunur; elle kopya yasak. Bellek-içi yüklem ile Prisma parçası **boğaz-ikizdir** ve birlikte değişir (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`; saf yüklem WHERE'e giremez).
- Liste + cursor + özet şeridi tek where'den doğar; cursor'lu listede süzme SUNUCUDA; elle okunan her id filtresi `readIdCondition`/`readFilterList`'ten geçer (CSV de string'dir).
- Enum'a değer eklemek, bayrak eklemek, route+izin eklemek **reçeteli iştir** (`docs/RECETELER.md`) — "altıncı enum değeri unutuldu" ve "dört kapı" sınıfı hatalar sessizdir.
- İstek gövdesini elle kuran istemci katmanı sessiz bir allowlist'tir; Zod tanımadığı anahtarı sessizce siler — alan iki uçta da sözleşmeye eklenir. Müşteri belgesinde iç veri taşıyan kolon OPT-IN doğar (allowlist), blocklist yeni kolonu sızdırır.
- ⚠️ **`BaseController` modelinde yeni bir SKALER kolon, aynı anda yeni bir YAZILABİLİR ALANDIR** — ayrı bir karar gerektirmeden (ölçüldü 2026-09-13: `sanitizeWriteData` DMMF'in tüm skalerlerini geçirir, mass-assignment koruması yalnız İLİŞKİLERİ kapatır; `Machine`e eklenen kolon gövdeden yazıldı). ⇒ Kolon eklerken sor: *bu alan o uçtan yazılabilir olmalı mı?* Olmamalıysa yazılabilirliği **açıkça** kapat; olmalıysa doğrulaması aynı dilimde iner. 13 route bu sınıfta.
- **Numara DOĞUŞTA materyalize edilir, render'da biçimlenmez:** her seri (çuval · sevkiyat · sevk partisi · belge no…) doğduğu anda tam stringi kendi kolonuna yazar; ekran, belge, Excel ve barkod o kolonu okur. Ön ek/tarih/hane KODDA DEĞİL `number_series` tablosundadır (kimlik katalogda, biçim veride) ve biçim değişimi yalnız YENİ elemanı etkiler — eski ön ek emekliye ayrılır, okutulmaya devam eder. Sunum katmanında biçimlendirmenin tek istisnası "eski belgeler de değişsin" bayrağı olan alanlardır ve orada program ekranı ile belge AYNI resolver'ı çağırır. `docs/kurallar/numaralandirma.md`.
- **Master veri modelinde KİMLİK ile ROL ayrılır:** gerçek dünyadaki bir nesne ileride başka bir rol de alabiliyorsa rol bir BAYRAK (ya da role bağlı profil) olur, ayrı bir kimlik tablosu DEĞİL; finans kimliği (cari hesap) tek kimliğe bağlanır, XOR'lu çift bağ yasaktır. Yanlış kurulan kimlik sonradan düzeltilmez, GÖÇ ister (ölçüldü: fason tablosu → üç dilimlik faz). Altı kapı (MV-06: canlı referanslı ana veri pasife alınamaz, arşiv bir durum geçişidir): `docs/standart/MASTER-VERI-TASARIMI.md`.

### Kapılar ve sözleşme
- FAIL-CLOSED varsayılan: tanınmayan kapsam 400, çözülemeyen şablon 400/404 (yerleşiğe sapma yok), izin guard'ı anahtar-kapsamlı ve düz OR'a çevrilmez, önbellekte TTL tazeliktir geçerlilik değil (bayat döner + tazeler; hiç dolmadıysa fail-closed kalır).
- Hata kodu `details.code` altında (`body.code` hep undefined); kapalı modül 403 `MODULE_DISABLED`; `clientType` gövdeden gelir, güvenlik sınırı değildir. Fabrika sunucusuna GELEN port açılmaz (eski tünel 2026-09-30'da emekli) — dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır.
- Bir yetenek "VAR" sayılmak için üçü birden: motor + en az bir çıkış yüzeyi + izin ataması. İzin kataloğu koda, atama panele (uzlaştırma getirir, ATAMAZ); SoD üçlüsü (`shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`) yalnız Muhasebe/Süpervizör; süperadmin rol değil (`["*"]`), panelden atanamaz.
- Yeni davranış bayrağının varsayılanı = BUGÜNKÜ davranış ve bu cümle ÖLÇÜLMEDEN yazılmaz; çıkışsız kapı üreten bayrak yazılır ama AÇILMAZ; kapı takarken "malın çıktığı başka yol var mı" kardeş bayrağın kapsamına bakılarak sorulur. Rota kapsaması KATEGORİ düzeyinde reddetmez, UYARIR (`ApiResponse.warnings`); özellik-başına kapsama sert kalır (create 400 / replace 409 — `docs/kurallar/rota-renk.md`).
- **Lisans kapısı fabrikayı aniden durdurmaz:** geçersiz/ölçülemedi → uyarı → imzalı tarihten türeyen ek süre → kısıtlı kip; veri erişimi (okuma, rapor, dışa aktarma, yedek) her kademede açık — `docs/kurallar/lisans.md`.
- **Fabrikadan dışarı giden her istek kurulum anahtarıyla imzalanır;** yoklama iş verisi taşımaz; patron eşitlemesi ayrı kanaldır ve bulut hesap yapmaz — `docs/kurallar/patron-bulutu.md`.
- İş emri yalnız üretimi yönetir; tartı/paket/sevkiyat ayrı domain (çuvala bağlanır); top↔sipariş satırı bağı YOKTUR, karşılama `SackAllocation` ile sevk anında. `WorkOrder.type` beyan değil bağın aynasıdır.

### Dağıtım ve sürüm
- **Backend ÖNCE**, panel + tablet sonra; sözleşme kıran değişiklikte (uç kaldırma, alan adı/tipi, zorunlu parametre, enum, izin) "eski istemci ne yapar" açıkça cevaplanır; `minVersion` yalnız gerçek kırılmada ve sahadakinden BÜYÜK OLAMAZ.
- Sürüm notu yazılmadan sürüm çıkmaz: **taslağı Claude yazar, kullanıcı TERFİDE onaylar** — sürüm önce hazırlık kanalına çıkar; onay `terfi/<kanal>/<ürün>-vX` açıklamalı etiketidir (onay cümlesi + saat, notu commit'le dondurur); üretim kanalına yalnız terfi etiketli commit çıkar, kaçış yalnız kullanıcı cümlesiyle (`--terfi-atla`); paketleme kapısı durdurur (`surum-notlari.json`). Müşteri kodu her derleme ve yayın komutunda ARGÜMANDAN; kanal kimlikleri tek kaynak `deploy/kanallar.json` ve yayın hedefi PAKETİN KENDİ kimliğinden çözülür (`scripts/check-kanallar.mjs`); ham `npm run build:win` yasak; manifest EN SON yüklenir; Cloudflare proxy açık kalır; OTA turunda `versionCode`a dokunulmaz. Reçete: `docs/kurallar/surum-yayin.md`.
- Prisma'nın iki motoru var; şema motoru NATIVE — Windows paketi `PRISMA_CLI_BINARY_TARGETS=windows` + MZ kapısı. Commit edilmemiş migration prod'da sessiz eksiktir. Reçete: `docs/kurallar/deploy-kurulum.md`.

### Süreç, sır, donanım
- Backend TEK process: `pkill -f "tsx src/server.ts"` YASAK (yalnız kendi PID'in), ikinci Node süreci yasak (tek istisna bekçi koşucusunun 127.0.0.1'deki kendi test sunucusu — `Teks-Erp/scripts/bekci-http.ts`, yalnız `_test` DB). Seri port / donanım polling backend'e girmez; eski "Phase 1: gerçek donanım kodu yazma" yasağı 2026-09-05'te BACKEND'e daraltıldı — istemci sürücüleri (Electron IPC serialport/node-hid, mobil HAL BT-Classic) meşru; simülasyon per-cihaz VERİ bayrağı; uydurulmuş değer `source:'SIMULATED'` beyanıyla gider, kararı backend verir.
- Sır hijyeni: süperadmin parolası/PIN/TOTP ve ayar şifresi repoya, log'a, sürüm notuna, audit yüküne GİRMEZ; `.env` uyarısı yalnız anahtar adı basar. `quickPin` ve kart kodu DB'de yalnız geri çevrilemez HMAC özetidir (anahtar `LICENSE_DIR`de, emaneti şifreli yedekte); PIN tek başına kimliktir — düz değer yalnız verildiği an döner, hiçbir yüzeyden sızdırılmaz.
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

| Alan | Dosya (`docs/kurallar/`) |
|---|---|
| Defter · hareket tablosu · ters kayıt · hard delete | defter.md |
| Sevkiyat · çuval · brüt · storno/iade | sevkiyat.md |
| Fason · kartela | fason.md |
| Tambur · finalize · kesim · geri alma | tambur.md |
| Top düzeltme · iptal · fire · geri alma | top-duzeltme.md |
| KK1 · idempotency · çevrimdışı kuyruk | kk1.md |
| Kurşun planlama · bypass | kursun.md |
| İş emri · sipariş bağı | is-emri.md |
| Rota · renk · özellik · kapsama | rota-renk.md |
| Kalite · istasyon yeteneği | kalite.md |
| Dokuma · dokuma işi · doff · tezgah karnesi | dokuma.md |
| Parti (Batch) | parti.md |
| Yarı mamul | yari-mamul.md |
| Refakat kartı | refakat-karti.md |
| Belge · etiket · şablon | belge-etiket.md |
| Mükerrer · nameFold seddi · ana veri arşivi | mukerrer.md |
| Numaralandırma · numara serisi · ön ek | numaralandirma.md |
| Sebep katalogları | sebep-katalogu.md |
| Keşif · cihaz · ağ · donanım | kesif-cihaz.md |
| Sürüm · yayın | surum-yayin.md |
| Deploy · kurulum · migration | deploy-kurulum.md |
| Modül anahtarları · bayraklar · profiller | modul-bayrak.md |
| Süperadmin · ayar şifresi | superadmin.md |
| Yetki · izin · rol | yetki-izin.md |
| Filtre · liste · arama | filtre-liste.md |
| Raporlar · karneler | raporlar.md |
| Finans · sağlamlık sınıfları | finans.md |
| Patron bulutu · eşitleme · gelen kutusu · bulut sunucusu | patron-bulutu.md |
| Lisans · kod koruma · satıcı platformu | lisans.md |
| Genel · konvansiyon | genel.md |

Kısa özetler ve arşiv tarihleri: `docs/kurallar/README.md`; belge haritası: `docs/README.md`.

## Çalışma düzeni

- **Geliştirme döngüsü:** `docs/GELISTIRME-DONGUSU.md`; ana ağacın `.env`i FABRİKA VERİSİDİR — ona karşı bekçi/script koşulmaz, worktree'ye kopyalanmaz, oturum kendi `tekserp_<oturum>_test` DB'sini açar.
- **Oturum sınırı:** iş kapanınca (commit/push · sürüm · alan değişimi) `/clear`; dosya döken tarama işi subagent'a verilir.
- **Bekçiler:** değişiklikten sonra alanın bekçileri koşulur (liste alan dosyasının sonunda, harita `Teks-Erp/docs/BEKCI-HARITASI.md`), PR/push öncesi `npm test`; yeni bekçi negatif sondayla kırmızı verdiği doğrulanarak, cırcır İKİ sondayla (ihlal → taban artar, düzeltme → düşer) yazılır — tabanı düşüremeyen cırcır kapısızlıktan kötüdür (`docs/RECETELER.md` § Yeni bekçi).
- **Commit kapısı:** `node scripts/hooks-kur.mjs` bir kez; kapı yalnız izole worktree'de koşar (ortak ağaçta ⏭ basar), kaçış `TEKSERP_HOOK_SKIP=1`. Kapı bekçilerin yalnız bir kısmını koşar ⇒ ① yeni mandalı KENDİ yeni dosyalarına karşı koştur · ② yeni dosyayı o dizini tarayan BÜTÜN tarayıcılara koştur · ③ sabiti yeniden adlandıran/genişleten commit o sabiti OKUYAN bütün bekçileri koşturur. Kapı dışı ağır koşum `node scripts/agir-is.mjs -- <komut>` ile (`docs/GELISTIRME-DONGUSU.md` § Kapı ve oturum).
- **Başvuru:** reçeteler `docs/RECETELER.md` (bayrak · enum değeri · route+izin · migration · bekçi · Electron sayfası · mobil ekran · sürüm · yeni müşteri kanalı) · `docs/standart/README.md` (kural tek satır + zorlama etiketi; devralınan kod `lint-baseline.json`'da donar) · `docs/KOD-KURALLARI.md` · `docs/SOZLUK.md` · sürüm `docs/kurallar/surum-yayin.md` (tablet `yayinla` yalnız paket üretir, sahaya çıkış ayrı adım).
