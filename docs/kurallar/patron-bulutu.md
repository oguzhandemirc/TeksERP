# Patron bulutu · Eşitleme · Gelen kutusu · Bulut sunucusu

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Alan 2026-09-29'da doğdu (Plan B, patron bulutu). Hikâye, ölçüm ve gerekçe arşivde (`docs/history/CLAUDE-NOT-ARSIVI.md`, 2026-09-29 notları); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.
> Tasarım: `docs/design/PATRON-BULUTU.md` (Plan B kararları) · bağlayıcı sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md` (paket §6 · rapor §7 · gelen kutusu §8 · bulut modeli + RLS §9 · izin kataloğu §10 · sapmalar §14 · B2 uygulama notları §17) · imza biçimi `docs/design/LISANS-PROTOKOLU.md`. Fabrika kodu `Teks-Erp/src/cloud-sync/` + `Teks-Erp/src/jobs/cloud-sync.job.ts` · `cloud-inbox.job.ts` (tek başlatma `jobs/patron-cloud.jobs.ts`); katalog tek kaynak `src/cloud-sync/projections.ts`; bulut sunucusu `patron/sunucu`. Kod adları İngilizce, tel şeması anahtarları ve kod DEĞERLERİ Türkçe.

## Ortak (fabrika + bulut + uygulama)

### Değişmezler

- **[ÇEKİRDEK]** Bulut HESAP YAPMAZ, fabrika tek yazardır: türetilmiş her alan fabrikanın tek kaynak yardımcısıyla hesaplanıp projeksiyona girer; bulut saklar, izinle süzer, gösterir — aritmetik ve tarih karşılaştırması yapmaz. <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Buluttaki tek yazma kanalı gelen kutusudur: hesabın yazdığı sipariş/cari bir MESAJdır, fabrika onu çeker ve normal servis yolundan idempotent yazar; bulut hiçbir fabrika satırını değiştiremez. · bekçi: `test_gelen_kutusu_claim (§1 · §2 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme hakkı FAIL-CLOSED ön koşuldur: yalnız `URETIM` sınıfı + `patron-bulut` modülü + bitmemiş abonelik + devredilmemiş kurulum gönderir; bulut İKİNCİ kapıdır (403 `SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`). · bekçi: `test_esitleme_idempotency (§5j–§5l)` <sub>(arşiv:2026-09-29)</sub>

## Eşitleme (fabrika)

### Değişmezler

- **[ÇEKİRDEK]** Bulut hesap yapmaz: türetilmiş her alan (açık miktar, bakiye, gecikmiş, brüt metre) fabrikada liste ekranının çağırdığı TEK KAYNAK yardımcıyla hesaplanıp projeksiyona girer; türetilmiş alanın okuduğu her tablo kökte, değişiklik kaynağında, tetikleyici işaretinde ya da gerekçeli kapsama listesindedir. · bekçi: `test_bulut_projeksiyon_allowlist (§4 türetilmiş · §5d yaşlandırma çekirdeği)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kolon listesi OPT-IN'dir: katalogda yazmayan kolon gitmez; serbest not, katlama ikizi, sır ve fabrika kullanıcı kimliği hiçbir projeksiyonda yoktur; iletişim/keşideci gibi kişisel alanlar yalnız `<ad>.kisisel`, tutarlar yalnız `<ad>.finans` alt satırında gider; anlık kayıtlar katı tel şemasından geçer. · bekçi: `test_bulut_projeksiyon_allowlist (§3 sızıntı · §5 canlı kurulum · §6 anlık)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme ön koşulu FAIL-CLOSED'dur: kullanılabilir HAK URETIM ∧ `patron-bulut` hakkı ∧ kirada abonelik bitişi gelecekte ∧ kirada aralık ∧ DEVREDİLDİ değil ∧ lisans GEÇERLİ; belirsizlik de geçersizlik de göndermez, lisans kademesi göndermeyi durdurmaz; aralık ve aç/kapa yerel ayardan değil KİRADAN gelir; ön koşul TEK fonksiyondur (`cloud-sync/eligibility.ts` `cloudEligibility`) — eşitleme, rapor isteği ve gelen kutusu onu çağırır, lisans kimliği imzalı isteklerle aynı okuyucudan (`getLicenseInstallationId`) gelir, bulut adresi tek okuyucudan (`PATRON_CLOUD_URL`, `cloud-url.ts`). · bekçi: `test_bulut_filigran (§1 ön koşul · §10e abonelik)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Değişiklik tespiti audit'ten türetilmez: `(filigran, eşitlik bozucu)` taraması GÜVENLİ UFUKLA (açık tx'lerin en eskisinin başlangıcı − pay) okunur ve filigran YALNIZ bulutun `kabul` listesiyle ilerler; ret, 5xx ve ağ hatası konumu ilerletmez, ağ tekrarı aynı paket kimliğiyle gider. · bekçi: `test_bulut_filigran (§4 güvenli ufuk · §5 kabul · §6 eşitlik bozucu)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Silme tespiti DB'ye bağlıdır: her katalog kök tablosunda AFTER DELETE tetikleyicisi `sync_marks`a aynı tx'te SILINDI yazar (kaskad dahil); topun/çuvalın ESKİ ebeveyni ve `shipment_orders` kümesi KIRLI işaretlenir; kök tablo listesi ↔ migration ↔ DB iki yönlü ölçülür. · bekçi: `test_bulut_silme_damgasi (§1 envanter · §2 aynı tx · §3 kaskad · §4 ayrılma · §7 tüketim)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** `sync_marks` TELEMETRİ'dir (defter değil): bulutun onayladığı zincirin gerisinde kalan ve 7 günden eski işaret budanır, eşitleme durmuşsa 30 günden eskisi de; budayan tek dosya `src/cloud-sync/marks-pruning.ts`. · bekçi: `test_bulut_silme_damgasi (§8 budama)`, `test_telemetri_defter_degil (§3 budayan beyanlı)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Katalog tablolarına `updatedAt` YAZMAYAN her ham UPDATE beyanlıdır (`scripts/lib/bulut-ham-update-beyan.ts`): birleştirme ailesi `merge_operations` defterinden görülür, diğerleri türetmenin okumadığı kolona yazar; opt-in kolona `updatedAt`siz ham yazım yoktur (`payment-allocation` sayaçları `updatedAt=NOW()` yazar). · bekçi: `test_bulut_ham_update (§2 · §3 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Günlük uzlaştırma (fabrika saatiyle 03:30 sonrası) kümeyi son ONAYLI ufuktan önce doğmuş satırlarla, kapsam yükleminin SQL ikiziyle ve bulutun saklama ufkuyla özetler; uyuşmazlık o projeksiyonu TAM gönderime sokar, TAM ilk parçasında zinciri sıfırdan kurar ve bulut işaretle-süpür yapar. · bekçi: `test_bulut_uzlastirma (§1 biçim · §2 kapsam ikizi · §3 döngü · §4 onay sınırı · §5 saklama)` <sub>(arşiv:2026-09-29)</sub>

### Kararlar

- **[ÇEKİRDEK]** Zamana bağlı türetilmiş alan (`gecikmis`, `vadesiGecti`) bulutta hesaplanmaz: termin/efektif vade (önceki konum, ufuk] aralığına düşen kökler geçiş kaynağıyla yeniden gönderilir. · bekçi: `test_bulut_projeksiyon_allowlist (§4a geçiş kaynağı)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Rapor isteği fabrikanın KENDİ parametre şemasıyla doğrulanır (tanınmayan → `PARAMETRE_GECERSIZ`), `audit/*` ve kişi adı taşıyan rapor buluttan istenemez (`RAPOR_BILINMIYOR`), kapalı rapor ve kapalı modül buluta da kapalıdır; standart dönem görüntüleri saatlik ve içerik değişmedikçe tekrar gitmez. · bekçi: `test_bulut_filigran (§9 rapor isteği · §10 iş)`, `test_bulut_projeksiyon_allowlist (§9 uzak raporlar)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kapı zili tek SSE aboneliğidir: `lisans` konusu lisans yoklamasında kalır, diğer konular (`ozet` · `rapor` · `gelen-kutusu`…) `jobs/doorbell-topics.ts` dağıtıcısına gider; zil içerik taşımaz, sahte zil yalnız fazladan tur yaptırır (anlık tur 30 sn'de en çok bir). · bekçi: `test_bulut_filigran (§8c · §8d zil)` <sub>(arşiv:2026-09-29)</sub>

## Gelen kutusu (fabrika)

### Değişmezler

- **[ÇEKİRDEK]** Bulut hiçbir fabrika satırını doğrudan yazmaz: gelen kutusu kaydı fabrikada NORMAL servis yolundan geçer (sipariş `prepareOrderCreate` + `insertPreparedOrderTx`, `clientToken = mesajId`; cari `prepareCardCreate` + `createCardInTx`, kod fabrikada doğar); tel → fabrika anahtar eşlemesi tek yerdedir (`cloud-sync/inbox-wire.ts`) ve hedefleri yazılabilir kümelerin içinde kalır. · bekçi: `test_bulut_gelen_kutusu (§1 eşleme · §6 sipariş)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Gelen kutusu idempotency'si makbuzdadır: varlık ile `CloudInboxReceipt` AYNI tx'te yazılır, 8036 token kilidi mesajId üzerinde tx'in ilk ifadesidir; aynı mesaj tekrar gelirse iş kuralı koşmaz, cevap makbuzdan döner; kesin ret de makbuz yazar, belirsiz hata (5xx/ağ/DB) yazmaz; Order/Customer'a kaynak kolonu eklenmez (kaynak makbuzda ve audit yükünde). · bekçi: `test_bulut_gelen_kutusu (§3 tekrar · §4 aynı tx · §5 ret · §7 çakışma)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Patron bulutu teknik kullanıcısının giriş yöntemi YOKTUR: izinleri yalnız `order:write` + `customer:write`, kimliği ayrılmış ayar anahtarında (`patronBulutu.teknikKullaniciId`; `User`a işaret kolonu yok); tek token üreticisi (`issueToken`) onu parolası bilinse de reddeder ve kimliksiz `mobile-users` listesinden beyanlı hariçtir. · bekçi: `test_bulut_gelen_kutusu (§2 · §9)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Gelen kutusu işi eşitlemeyle AYNI fail-closed ön koşulla çalışır (`cloudEligibility`; ayrıca teknik kullanıcı) — biri eksikse HİÇ dış istek atılmaz; `zorla`da uygulanan kademe sipariş/cari yazmasını kapatıyorsa `al` çağrılmaz ve kayıt bulutta BEKLIYOR kalır. · bekçi: `test_bulut_gelen_kutusu (§10)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Tel sözleşmesi TEK dosyadır (`patron/sunucu/src/wire/esitleme.ts`; uçlar, zarf, istek/yanıt şemaları, mesaj gövdeleri, kodlar) ve yalnız `zod` içe aktarır; fabrika onu `Teks-Erp/src/cloud-sync/wire/esitleme.ts` olarak bayt-eşit taşır ve tel tipini yalnız oradan alır; değişiklik önce kaynakta, sonra `cp -p`; iki katalog (ad/tür, alt satır, kökte yasak alan, saklama alanı, üstten saklama) birebirdir. · bekçi: `test_bulut_tel_aynasi (§1 ayna · §2 zod · §3 yol · §4 kopya · §5 katalog)` <sub>(arşiv:2026-09-29)</sub>

## Bulut sunucusu (`patron/sunucu`)

### Değişmezler

- **[ÇEKİRDEK]** Çok kiracılı tek DB'de her tablo `tesis_id` taşır ve RLS ENABLE + FORCE altındadır; `app.tesis_id` her istek tx'inin İLK ifadesinde yazılır (tek yazar `src/lib/tenant.ts`), ayarsız ya da sıfırlanmış bağlantıda sorgu HATA verir (sıfır satır); kiracı imzadan/oturumdan çözülür, gövdeden asla. · bekçi: `test_rls_sizinti (§1 · §2 · §3)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Sunucu iki çalışma rolüyle bağlanır, ikisi de NOSUPERUSER NOBYPASSRLS ve tablo sahibi değil: uygulama rolü projeksiyona YAZAMAZ, eşitleme rolü hesap/oturum tablosunu OKUYAMAZ; yetkiler tek kaynak `src/lib/db-grants.ts`, RLS'i atlayabilen rolle sunucu KALKMAZ. · bekçi: `test_rls_sizinti (§1e · §5 · §7)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Alan izni DB düzeyindedir: FINANS/KİŞİSEL kolonlar kök satıra girmez, `.finans`/`.kisisel` alt satırına bölünür ve RESTRICTIVE `app.projeksiyonlar` politikasıyla hesabın izin kümesinden süzülür ("sipariş görür, tutar görmez"); kök satırda yasak alan taşıyan girdi RET, `*` projeksiyon YASAK, eşlenmeyen projeksiyon RED. · bekçi: `test_izin_suzmesi (§2 · §5)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Projeksiyonun sürüm anı paketin UFKUDUR: geç gelen eski paket yeni veriyi ezemez, silinmiş satırı diriltemez (mezar taşı 7 gün); aynı `paketId` saklı yanıtla döner, başka gövdeyle 409; filigran boşluğu `istenen: TAM` doğurur ve filigran yalnız kabulde ilerler. · bekçi: `test_esitleme_idempotency (§1 · §2 · §3 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Bulut hesabı TOTP'siz doğamaz ve TOTP'siz oturum açamaz (DB CHECK dahil); hesap davetle doğar, kurtarma kodu yoktur, son aktif hesap yöneticisi düşürülemez. · bekçi: `test_totp_zorunlu (§1 · §2 · §3 · §4j)` <sub>(arşiv:2026-09-29)</sub>

### Kararlar

- **[ÇEKİRDEK]** Kuyruk claim'i (gelen kutusu, rapor isteği) `WITH … FOR UPDATE SKIP LOCKED` CTE'siyle alınır; `WHERE id IN (… LIMIT n FOR UPDATE SKIP LOCKED)` biçimi LIMIT'i aşar (ölçüldü: enFazla 1 iken 2 kayıt). · bekçi: `test_rapor_istegi (§2a)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Buluttaki satırlar fabrikanın defteri değildir: saklama (tesis başına 3 · 13 · 25 ay · tümü, varsayılan 13) kökü düşen kaydın alt satırını ve kalemini birlikte budar; yaşa göre silinen her tablo `PRUNED_TABLES` beyanındadır. · bekçi: `test_saklama (§1 · §4)` · `test_patron_kapilari (§4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kurulum kaydının satıcı iç API önbelleği TAZELİKTİR: süre dolunca sorulur, ulaşılamazsa bayat kayıtla devam edilir, hiç dolmadıysa RED; zil yalnız `{tesisId, konu}` taşır. · bekçi: `test_kurulum_dizini (§1 · §4 · §8)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Audit ailesi ve kişi adı taşıyan rapor (operatör performansı) buluttan istenemez; rapor ailesinin izni bulutta anahtarın önekinden türer, fabrikanın gönderdiği aileye güvenilmez. · bekçi: `test_rapor_istegi (§1a · §1b · §3)` <sub>(arşiv:2026-09-29)</sub>

## Uygulama (`patron/uygulama`)

### Değişmezler

- **[ÇEKİRDEK]** Uygulama yalnız GİZLER, karar sunucudadır: izni olmayan bölüm menüde çizilmez, doğrudan açılırsa içerik yerine uyarı gösterilir; uygulamadaki her `bulut:` izin literali, pano kartı izni ve rapor aile eşlemesi bulut kataloğuna karşı ölçülür. · bekçi: `mirror.test.ts` · `access.test.ts` · `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Tel tiplerinin tek kaynağı `patron/sunucu/src/wire/api.ts`dir; `patron/uygulama/src/api/wire.ts` onun bayt-eşit aynasıdır ve uygulamanın çağırdığı her uç sunucunun `API_ROUTES`unda bulunur. · bekçi: `mirror.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Çevrimdışı önbellek SALT-OKUNURDUR: son veri yalnız AĞ hatasında "çevrimdışı — son veri <zaman>" bandıyla gösterilir, 403/404'te saklı kopya silinir, çıkışta bütün önbellek silinir, çevrimdışıyken yazma düğmesi kapalıdır. · bekçi: `cache.test.ts` · `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Yazma işlem kimliği (`mesajId`/`clientToken`) mantıksal deneme başına bir kez üretilir, yalnız sonucu belirsiz bırakan hatada (ağ/5xx) yapışır, kesin 4xx'te ve gövde değişince yenilenir; hata kodu yalnız `details.code`ten okunur. · bekçi: `client.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Firma adı ve logosu koda gömülmez: tesisin `ad`ından gelir, yoksa nötr "TeksERP Patron" yazılır; oturum belirteci gizli depoda (web'de yalnız sekme ömrü), TOTP sırrı ve davet kodu hiçbir depoya yazılmaz. · bekçi: `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Yıkıcı işlem (gelen kutusu/rapor isteği iptali, hesap kilidi/arşivi, davet yenileme) iki adımlı onayla uygulanır. · bekçi: `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>

### Kararlar

- **[ÇEKİRDEK]** Projeksiyon ve anlık verinin şekli fabrikada tanımlıdır; uygulama alanları jenerik biçimler (TR sayı/tarih, `…Id` gizli) ve aritmetik yapmaz. · bekçi: `format.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Rapor isteğinin parametresi fabrikanın kendi şemasıdır: uygulama yalnız özel aralığı (`dateFrom`/`dateTo`) ve katalog girdisinin ek alanlarını toplar; istenebilir liste fabrikanın `rapor-katalogu` anlık kaydından okunur. · bekçi: `forms.test.ts` <sub>(arşiv:2026-09-29)</sub>

## Bekçiler — bu alana dokununca koş

Fabrika: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (kendi `_test` DB'si; sahte bulut döngü adresinde düz HTTP). Ağır koşum `node scripts/agir-is.mjs -- …` ile.

Bulut sunucusu bekçileri kendi projesinden: `cd patron/sunucu && node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts` (kendi `_test` DB'si + çalışma rolleri; roller her koşumda hizalanır). Protokol aynası fabrika tarafında: `cd Teks-Erp && npx tsx scripts/test_lisans_protokol_aynasi.ts`.

**Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## patron-bulutu` bölümü.**

Fabrika (Teks-Erp): `test_bulut_filigran`, `test_bulut_silme_damgasi`, `test_bulut_uzlastirma`, `test_bulut_projeksiyon_allowlist`, `test_bulut_ham_update`, `test_bulut_gelen_kutusu`, `test_bulut_tel_aynasi`

Bulut sunucusu (patron/sunucu): `test_rls_sizinti`, `test_izin_suzmesi`, `test_gelen_kutusu_claim`, `test_esitleme_idempotency`, `test_totp_zorunlu`, `test_rapor_istegi`, `test_saklama`, `test_kurulum_dizini`, `test_cihaz_kaydi`, `test_patron_kapilari`

Uygulama (DB'siz): `cd patron/uygulama && node ../../scripts/agir-is.mjs -- npx jest --runInBand` — `mirror.test.ts`, `access.test.ts`, `cache.test.ts`, `client.test.ts`, `forms.test.ts`, `format.test.ts`, `ui.test.tsx`; yerel API dumanı `scripts/duman.ts` (kendi `_test` sunucusuna, `tesis-ac` + `kurulum-kaydet --sinif=URETIM --moduller=patron-bulut` + `yonetici-davet` sonrası).

Yeni patron bulutu bekçisi doğduğu commit'te bu listeye VE haritanın `## patron-bulutu` bölümüne birlikte eklenir. Katalog ya da tetikleyici değişince `test_db_invariants` (TRIGGERS/EXPECTED_FUNCTIONS) de koşulur.

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-29 · Patron bulutu: B-turları kararları (Plan B) — 2026-09-01 bulut ayna reddi KISMEN GEÇERSİZ
- 2026-09-29 · Patron bulutu eşitlemesi (B1-kod): katalog kodda, silme tetikleyiciyle, filigran güvenli ufukla, fail-closed ön koşul
- 2026-09-29 · Patron bulutu gelen kutusu (B3): makbuz aynı tx, teknik kullanıcı girişsiz, sipariş aktörü audit'te
- 2026-09-29 · Patron bulutu sunucusu (B2): çok kiracılı tek DB + RLS, iki çalışma rolü, eşitleme alıcısı, gelen kutusu, hesaplar
- 2026-09-29 · Lisans + patron bulutu entegrasyonu (I3-1a): tek ön koşul, tek bulut adresi, tek protokol kaynağı, birleşik sapma listesi
