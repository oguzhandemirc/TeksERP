# Patron bulutu · Eşitleme · Gelen kutusu · Bulut sunucusu

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Alan 2026-09-29'da doğdu (Plan B, patron bulutu). Hikâye, ölçüm ve gerekçe arşivde (`docs/history/CLAUDE-NOT-ARSIVI.md`, 2026-09-29 notları); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.
> Tasarım: `docs/design/PATRON-BULUTU.md` (Plan B kararları) · bağlayıcı sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md` (paket §6 · rapor §7 · gelen kutusu §8 · bulut modeli + RLS §9 · izin kataloğu §10 · sapmalar §14 · B2 uygulama notları §17) · imza biçimi `docs/design/LISANS-PROTOKOLU.md`. Fabrika kodu `Teks-Erp/src/cloud-sync/` + `Teks-Erp/src/jobs/cloud-sync.job.ts` · `cloud-inbox.job.ts` (tek başlatma `jobs/patron-cloud.jobs.ts`); katalog tek kaynak `src/cloud-sync/projections.ts`; bulut sunucusu `patron/sunucu`. Kod adları İngilizce, tel şeması anahtarları ve kod DEĞERLERİ Türkçe.

## Ortak (fabrika + bulut + uygulama)

### Değişmezler

- **[ÇEKİRDEK]** Bulut HESAP YAPMAZ, fabrika tek yazardır: türetilmiş her alan fabrikanın tek kaynak yardımcısıyla hesaplanıp projeksiyona girer; bulut saklar, izinle süzer, gösterir — aritmetik ve tarih karşılaştırması yapmaz. <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Buluttaki tek yazma kanalı gelen kutusudur: hesabın yazdığı sipariş/cari bir MESAJdır, fabrika onu çeker ve normal servis yolundan idempotent yazar; bulut hiçbir fabrika satırını değiştiremez. · bekçi: `test_gelen_kutusu_claim (§1 · §2 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme hakkı FAIL-CLOSED ön koşuldur: yalnız `URETIM` sınıfı + `patron-bulut` modülü + bitmemiş abonelik + devredilmemiş kurulum gönderir; bulut İKİNCİ kapıdır (403 `SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`). · bekçi: `test_esitleme_idempotency (§5j–§5l)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Hiçbir proje başka projenin kaynağını ya da `node_modules`ünü çalışma anında veya tip denetiminde içe aktarmaz: tel tipi bayt-eşit aynayla taşınır, bulut kataloğu yalnız üretilmiş `patron/sunucu/src/catalog/katalog-ozeti.json` dosyasından okunur ve özetin canlı katalogla eşitliğini sunucunun kendi işi ölçer (bayatsa `--yaz`). · bekçi: `test_katalog_ozeti` · `test_bulut_tel_aynasi (§7)` · `mirror.test.ts` <sub>(arşiv:2026-09-30)</sub>

## Eşitleme (fabrika)

### Değişmezler

- **[ÇEKİRDEK]** Bulut hesap yapmaz: türetilmiş her alan (açık miktar, bakiye, gecikmiş, brüt metre) fabrikada liste ekranının çağırdığı TEK KAYNAK yardımcıyla hesaplanıp projeksiyona girer; türetilmiş alanın okuduğu her tablo kökte, değişiklik kaynağında, tetikleyici işaretinde ya da gerekçeli kapsama listesindedir. · bekçi: `test_bulut_projeksiyon_allowlist (§4 türetilmiş · §5d yaşlandırma çekirdeği)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kolon listesi OPT-IN'dir: katalogda yazmayan kolon gitmez; serbest not, katlama ikizi, sır ve fabrika kullanıcı kimliği hiçbir projeksiyonda yoktur; iletişim/keşideci gibi kişisel alanlar yalnız `<ad>.kisisel`, tutarlar yalnız `<ad>.finans` alt satırında gider; anlık kayıtlar katı tel şemasından geçer. · bekçi: `test_bulut_projeksiyon_allowlist (§3 sızıntı · §5 canlı kurulum · §6 anlık)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme ön koşulu FAIL-CLOSED'dur: kullanılabilir HAK URETIM ∧ `patron-bulut` hakkı ∧ kirada abonelik bitişi gelecekte ∧ kirada aralık ∧ DEVREDİLDİ değil ∧ lisans GEÇERLİ; belirsizlik de geçersizlik de göndermez, lisans kademesi göndermeyi durdurmaz; aralık ve aç/kapa yerel ayardan değil KİRADAN gelir; ön koşul TEK fonksiyondur (`cloud-sync/eligibility.ts` `cloudEligibility`) — eşitleme, rapor isteği ve gelen kutusu onu çağırır, lisans kimliği imzalı isteklerle aynı okuyucudan (`getLicenseInstallationId`) gelir, bulut adresi tek okuyucudan (`PATRON_CLOUD_URL`, `cloud-url.ts`). · bekçi: `test_bulut_filigran (§1 ön koşul · §10e abonelik)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Değişiklik tespiti audit'ten türetilmez: `(filigran, eşitlik bozucu)` taraması GÜVENLİ UFUKLA (açık tx'lerin en eskisinin başlangıcı − pay) okunur ve filigran YALNIZ bulutun `kabul` listesiyle ilerler; ret, 5xx ve ağ hatası konumu ilerletmez, ağ tekrarı aynı paket kimliğiyle gider. · bekçi: `test_bulut_filigran (§4 güvenli ufuk · §5 kabul · §6 eşitlik bozucu)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Silme tespiti DB'ye bağlıdır: her katalog kök tablosunda AFTER DELETE tetikleyicisi `sync_marks`a aynı tx'te SILINDI yazar (kaskad dahil); topun/çuvalın ESKİ ebeveyni ve `shipment_orders` kümesi KIRLI işaretlenir; kök tablo listesi ↔ migration ↔ DB iki yönlü ölçülür. · bekçi: `test_bulut_silme_damgasi (§1 envanter · §2 aynı tx · §3 kaskad · §4 ayrılma · §7 tüketim)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** `sync_marks` TELEMETRİ'dir (defter değil): bulutun onayladığı zincirin gerisinde kalan ve 7 günden eski işaret budanır, eşitleme durmuşsa 30 günden eskisi de; budayan tek dosya `src/cloud-sync/marks-pruning.ts`. · bekçi: `test_bulut_silme_damgasi (§8 budama)`, `test_telemetri_defter_degil (§3 budayan beyanlı)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Katalog tablolarına `updatedAt` YAZMAYAN her ham UPDATE beyanlıdır (`scripts/lib/bulut-ham-update-beyan.ts`): birleştirme ailesi `merge_operations` defterinden görülür, diğerleri türetmenin okumadığı kolona yazar; opt-in kolona `updatedAt`siz ham yazım yoktur (`payment-allocation` sayaçları `updatedAt=NOW()` yazar). · bekçi: `test_bulut_ham_update (§2 · §3 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Günlük uzlaştırma (fabrika saatiyle 03:30 sonrası) kümesi iki uçta AYNI kuralla sayılır ve kural tel sözleşmesindedir (`RECONCILE_PARENTS` başlığı): kapsam ∧ kendi saklaması ∧ (kalemse) üst belge kümede − bekleyen; bekleyeni (son onaylı ufuktan sonra doğan ya da ebeveyni öyle olan kök) YALNIZ fabrika çizer ve pakette kimlik listesiyle taşır, bulut satır zamanına bakmaz; ebeveyni onaylanmamış kalem ve tavanı aşan bekleyen ÖLÇÜLEMEDİ'dir (entry gitmez, TAM istenmez); TAM da aynı kümeyi gönderir; uyuşmazlık o projeksiyonu TAM'a sokar, TAM ilk parçasında zinciri sıfırdan kurar ve bulut işaretle-süpür yapar. · bekçi: `test_bulut_uzlastirma (§1 biçim · §2 kapsam ikizi · §3 döngü · §4 onay sınırı · §5 saklama · §6 gelecek tarihli satır · §7 ebeveyn)`, `test_uzlastirma_kumesi (§1 · §3)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Bulut `ISTEK_ZAMAN` yanıtına kendi saatini (`details.sunucuSaati`, İMZASIZ) koyar; fabrika isteği lisans kanalıyla AYNI yardımcıyla (`requestClockSkewMs`) BİR KEZ düzeltilmiş damga ve yeni nonce'la yeniden imzalar, ikinci retde durur; pay yalnız o isteğin damgasına girer. · bekçi: `test_bulut_uzlastirma (§8)`, `test_uzlastirma_kumesi (§4)` <sub>(arşiv:2026-09-29)</sub>

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
- **[ÇEKİRDEK]** Tel sözleşmesi TEK dosyadır (`patron/sunucu/src/wire/esitleme.ts`; uçlar, zarf, istek/yanıt şemaları, mesaj gövdeleri, kodlar) ve yalnız `zod` içe aktarır; fabrika onu `Teks-Erp/src/cloud-sync/wire/esitleme.ts` olarak bayt-eşit taşır ve tel tipini yalnız oradan alır; değişiklik önce kaynakta, sonra `cp -p`; iki katalog (ad/tür, alt satır, kökte yasak alan, saklama alanı, üstten saklama) birebirdir; kalem → üst belge bağı sözleşmeden okunur (bulut kataloğu ondan türer). · bekçi: `test_bulut_tel_aynasi (§1 ayna · §2 zod · §3 yol · §4 kopya · §5 katalog · §6 ebeveyn bağı)` <sub>(arşiv:2026-09-29)</sub>

## Bulut sunucusu (`patron/sunucu`)

### Değişmezler

- **[ÇEKİRDEK]** Çok kiracılı tek DB'de her tablo `tesis_id` taşır ve RLS ENABLE + FORCE altındadır; `app.tesis_id` her istek tx'inin İLK ifadesinde yazılır (tek yazar `src/lib/tenant.ts`), ayarsız ya da sıfırlanmış bağlantıda sorgu HATA verir (sıfır satır); kiracı imzadan/oturumdan çözülür, gövdeden asla. · bekçi: `test_rls_sizinti (§1 · §2 · §3)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Sunucu iki çalışma rolüyle bağlanır, ikisi de NOSUPERUSER NOBYPASSRLS ve tablo sahibi değil: uygulama rolü projeksiyona YAZAMAZ, eşitleme rolü hesap/oturum tablosunu OKUYAMAZ; yetkiler tek kaynak `src/lib/db-grants.ts` (tablo ve kolon düzeyi, DB ile birebir), RLS'i atlayabilen rolle sunucu KALKMAZ. · bekçi: `test_rls_sizinti (§1e · §1g · §5 · §7)` <sub>(arşiv:2026-09-29 · 2026-09-30 entegrasyon düzeltmeleri)</sub>
- **[ÇEKİRDEK]** Alan izni DB düzeyindedir: FINANS/KİŞİSEL kolonlar kök satıra girmez, `.finans`/`.kisisel` alt satırına bölünür ve RESTRICTIVE `app.projeksiyonlar` politikasıyla hesabın izin kümesinden süzülür ("sipariş görür, tutar görmez"); kök satırda yasak alan taşıyan girdi RET, `*` projeksiyon YASAK, eşlenmeyen projeksiyon RED. · bekçi: `test_izin_suzmesi (§2 · §5)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Projeksiyonun sürüm anı paketin UFKUDUR: geç gelen eski paket yeni veriyi ezemez, silinmiş satırı diriltemez (mezar taşı 7 gün); aynı `paketId` saklı yanıtla döner, başka gövdeyle 409; filigran boşluğu `istenen: TAM` doğurur ve filigran yalnız kabulde ilerler. · bekçi: `test_esitleme_idempotency (§1 · §2 · §3 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Bulut hesabı TOTP'siz doğamaz ve TOTP'siz oturum açamaz (DB CHECK dahil); hesap davetle doğar, kurtarma kodu yoktur, son aktif hesap yöneticisi düşürülemez. · bekçi: `test_totp_zorunlu (§1 · §2 · §3 · §4j)` <sub>(arşiv:2026-09-29)</sub>

- **[ÇEKİRDEK]** Hizmet aşaması tek kaynaktan türer (`src/services/service-lifecycle.ts` `serviceState`): sözleşme açıkken ACIK; kira bitince, hak düşünce ya da tesis kapatılınca bitişten itibaren 90 gün SALT_OKUNUR (giriş, okuma, dışa aktarma ve hesap yönetimi açık; eşitleme, gelen kutusu, rapor isteği, bildirim kapalı), sonra KAPALI (giriş yok, imha bekler); bitiş anı donar (`facilities.service_ended_at`, tek yazar bakım tikindeki `refreshServiceEnd`), DR devri hizmeti bitirmez. · bekçi: `test_hizmet_sonu (§1 · §2 · §3 · §4)` <sub>(arşiv:2026-09-30 PU)</sub>
- **[ÇEKİRDEK]** Dışa aktarma (`GET /api/disa-aktar[/:kume]`, JSON · CSV) yalnız hesap yöneticisine ve hesabın OKUYABİLDİĞİ kadardır: tx oturumun `app.projeksiyonlar`ıyla açılır, yöneticiye ayrı kapı yoktur; kolonlar saklı satırın kendi (opt-in) alanlarıdır, bulut kolon eklemez; CSV hücresi formül enjeksiyonuna karşı öneklenir. · bekçi: `test_hizmet_sonu (§5)` <sub>(arşiv:2026-09-30 PU)</sub>
- **[ÇEKİRDEK]** Kapanan (PASIF) bulut hesabının KİMLİĞİ kapanıştan 30 gün sonra silinir (bakım tiki `purgeClosedIdentities`, süre koddadır — metnin sözü): ad ve e-posta tombstone (`Silinmiş hesap #<8>` · `…@hesap.invalid`), parola/TOTP/davet NULL, oturum ve cihaz anahtarı silinir, gelen kutusu yazar adı ve işlem makbuzu yanıtlarındaki ad/e-posta tombstone (makbuz, işlem kimliği ve gövde özeti KALIR — tekrar aynı, tombstone'lu yanıtı alır; makbuzu yalnız bu silme günceller); satır ve kimliği KALIR (iş kayıtlarının izi kırılmaz). Kimlik verisi defter değildir, silme beyanlıdır (`PRUNED_TABLES`); kapanış anı PASIF'le aynı claim'de yazılır (CHECK), arşivdeki hesap düzenlenemez. · bekçi: `test_kimlik_silme (§1 · §2 · §3 · §5 · §7)`, `test_patron_kapilari (§8e)` <sub>(arşiv:2026-09-30 PU · 2026-09-30 entegrasyon düzeltmeleri)</sub>
- **[ÇEKİRDEK]** Erişim (IP) kaydı ZAMAN BAZLIDIR: uygulama istemci adresini yalnız giriş olaylarının güvenlik kaydında (`account_audit.summary.ip`; GIRIS · GIRIS_BASARISIZ · GIRIS_REDDEDILDI · HESAP_GECICI_KILIT) tutar ve 30 gün sonra ALANI siler (olay kendi süresiyle kalır; beyan `AGED_FIELDS`, süre kodda); erişim günlüğü satırı IP ve sorgu dizgisi taşımaz, istemci adresi yalnız HTTP katmanında okunur. · bekçi: `test_ip_saklama (§1 · §2 · §4)`, `test_patron_kapilari (§8)` <sub>(arşiv:2026-09-30 PU)</sub>
- **[ÇEKİRDEK]** Destek amaçlı doğrudan DB sorgusu yalnız destek rolüyle (`<db>_destek`, üretimde `patron_destek`: NOLOGIN doğar, NOSUPERUSER NOBYPASSRLS, yalnız SELECT, sır kolonları hariç — `SUPPORT_GRANTS`) yapılır; kapı GUC değil sunucu kaydıdır: her okunabilir tabloda RESTRICTIVE `destek_kapisi`, satırı yalnız `destek_ac` ile açılmış (oturuma bağlı, süreli) izne bağlar ve her açılış silinemeyen `support_access` kaydına (kim · tesis · kapsam · gerekçe · talep no) düşer; rolün okuyabildiği her ilişki (görünüm dahil, bütün kullanıcı şemaları) ve çalıştırabildiği her fonksiyon (PUBLIC'ten gelen dahil) beyanlıdır (`SUPPORT_GRANTS` · `SUPPORT_FUNCTIONS`), SECURITY DEFINER fonksiyonun `search_path`i sabit ve `pg_temp` sonda; giriş yetkisi runbook'la açılıp kapanır. · bekçi: `test_destek_rolu (§1 · §2 · §3 · §4)` <sub>(arşiv:2026-09-30 PU · 2026-09-30 entegrasyon düzeltmeleri)</sub>
- **[ÇEKİRDEK]** Tesis imhası yalnız satıcı CLI'sindedir (`scripts/tesis.ts imha`, kuru koşum varsayılan): hizmet ACIK iken asla, SALT_OKUNUR'da yalnız yazılı erken talep numarasıyla; silme kümesi `CLOUD_TABLES` − `RETAINED_TABLES` iki yönlü ölçülür, imha kaydı (`facility_destructions`) değiştirilemez ve silinemez. · bekçi: `test_hizmet_sonu (§6)`, `test_patron_kapilari (§4e · §4f)` <sub>(arşiv:2026-09-30 PU)</sub>

- **[ÇEKİRDEK]** Fabrika bulut hesabını yalnız KİLİTLER (`POST /v1/hesap-kilitle`, kurulum imzalı, işlem kimliğiyle idempotent): yalnız AKTIF → KILITLI, oturumlar kapanır, son aktif hesap yöneticisi kilitlenemez; hesap açma ve kilit açma bulutta kalır, değişmeyen istek iz bırakmaz. · bekçi: `test_hesap_kilitle_fabrika (§1d · §5b)`, `test_bulut_hesap_kilitle (§1 · §2c)` <sub>(arşiv 2026-09-30 B6)</sub>

### Kararlar

- **[ÇEKİRDEK]** Kuyruk claim'i (gelen kutusu, rapor isteği) `WITH … FOR UPDATE SKIP LOCKED` CTE'siyle alınır; `WHERE id IN (… LIMIT n FOR UPDATE SKIP LOCKED)` biçimi LIMIT'i aşar (ölçüldü: enFazla 1 iken 2 kayıt). · bekçi: `test_rapor_istegi (§2a)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Buluttaki satırlar fabrikanın defteri değildir: saklama (tesis başına 3 · 13 · 25 ay · tümü, varsayılan 13) kökü düşen kaydın alt satırını ve kalemini birlikte budar; yaşa göre silinen her tablo `PRUNED_TABLES` beyanındadır. · bekçi: `test_saklama (§1 · §4)` · `test_patron_kapilari (§4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kurulum kaydının satıcı iç API önbelleği TAZELİKTİR: süre dolunca sorulur, ulaşılamazsa bayat kayıtla devam edilir, hiç dolmadıysa RED; zil yalnız `{tesisId, konu}` taşır. · bekçi: `test_kurulum_dizini (§1 · §4 · §8)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Audit ailesi ve kişi adı taşıyan rapor (operatör performansı) buluttan istenemez; rapor ailesinin izni bulutta anahtarın önekinden türer, fabrikanın gönderdiği aileye güvenilmez. · bekçi: `test_rapor_istegi (§1a · §1b · §3)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Ekran açıkken tazeleme bulutta `POST /api/tazele` ile `ozet` zilidir: içerik taşımaz, tesis başına 30 sn'de bir çalar; aralık içindeki istek zil çalmaz, kalan süreyi döner. · bekçi: `test_tazele_zili (§1 · §2 · §3)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Hesap API'sinin doğrulama iletisi TR'dir: zod TR yerel ayarı `createApp`'te kurulur, varsayılan İngilizce ileti 400 gövdesine sızmaz. · bekçi: `test_tazele_zili (§4)` <sub>(arşiv:2026-09-29)</sub>

## Bildirimler (B5)

- **[ÇEKİRDEK]** Bildirim türünün kuralı tek kaynaktır (`patron/sunucu/src/catalog/notifications.ts`): tür, kaynak projeksiyonun okuma iznini KAPSAR ve finans içerikli tür finans izni ister — okunamayan veri bildirimle sızmaz (açılışta ölçülür).
- **[ÇEKİRDEK]** Eşik bulutta HESAPLANMAZ, yalnız fabrikanın özet sayısıyla karşılaştırılır; karşılaştırmanın ihtiyaç duyduğu toplam (bugün tamamlanan, gece yedeği hükmü) fabrikanın anlık projeksiyonuna girer.
- **[ÇEKİRDEK]** Aynı olay aynı hesaba ikinci kez doğmaz: bildirim kimliği (`dedup_key`, gün ya da olay kimliği) `UNIQUE(tesis, hesap, dedup_key)` ile seddedilir; kural düşüren olay da ATLANDI olarak doğar.
- **[ÇEKİRDEK]** Gönderim anında izin, tür ve sessiz saat YENİDEN sınanır (doğuştan sonra düşen izin tutar); sessiz saatte gönderilmez, bitişe ertelenir.
- **[ÇEKİRDEK]** Bulutta bir anın saat dilimini ANLIK `tesis` DÖNEMLERİNDEN çöz (`facilityTimeZoneAt(veri, an)`: `gecerliBaslangic ≤ an` olan son dönem, yoksa `tabanDilim`; eski paket → `saatDilimi`) — bildirim gün anahtarı ve sessiz saat dahil; yalnız `saatDilimi` okumak bekleyen dönemi kaçırır. · bekçi: `patron/sunucu/scripts/test_tesis_saati.ts §3'` <sub>(arşiv 2026-09-30 TZ-D)</sub>
- **[ÇEKİRDEK]** `notifications` TELEMETRİ'dir: sonuçlanmış satır `BILDIRIM_SAKLAMA_GUN` sonra budanır, iş kararı ondan okunmaz.
- **[ÇEKİRDEK]** VAPID gizli anahtarı dosyada (0600) yaşar ve günlüğe, DB'ye, API yanıtına girmez; taşıyıcı hatası yalnız kısa KOD olarak saklanır; web aboneliği yalnız izinli push servisine kaydolur (SSRF kapısı).
- **[ÇEKİRDEK]** Bildirime dokununca açılan yol yalnız uygulamanın kendi ekranıdır: telefonda `safeRoute`, web'de service worker AYNI kalıpla süzer (dış adres, `//`, bilinmeyen bölüm açılmaz; jest ölçer).
- **[ÇEKİRDEK]** Expo teslimi iki aşamalıdır: bilet kabulü bildirimi GONDERILDI yapar, makbuzdaki `DeviceNotRegistered` cihazı pasife çeker; makbuz yoklaması atomik claim'lidir ve 24 saatte vazgeçer. · bekçi: `test_bildirim_makbuz (§1 · §2)` <sub>(arşiv:2026-09-30 F1)</sub>
- **[ÇEKİRDEK]** Deneme bildirimi yalnız hesabın KENDİ etkin cihazlarına gider, kuyruğa ve geçmişe yazılmaz, hesap başına dakikada birle sınırlıdır; kip kapalıyken 409 döner. · bekçi: `test_bildirim_makbuz (§3)` <sub>(arşiv:2026-09-30 F1)</sub>
- **[PROFİL]** `BILDIRIM_KIPI` varsayılanı `kapali`dır (bugünkü davranış); `gercek` yalnız mağaza hesapları + patron VDS kurulumundan sonra açılır.

## Uygulama (`patron/uygulama`)

### Değişmezler

- **[ÇEKİRDEK]** Uygulama yalnız GİZLER, karar sunucudadır: izni olmayan bölüm menüde çizilmez, doğrudan açılırsa içerik yerine uyarı gösterilir; uygulamadaki her `bulut:` izin literali, pano kartı izni ve rapor aile eşlemesi bulut kataloğuna karşı ölçülür. · bekçi: `mirror.test.ts` · `access.test.ts` · `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Tel tiplerinin tek kaynağı `patron/sunucu/src/wire/api.ts`dir; `patron/uygulama/src/api/wire.ts` onun bayt-eşit aynasıdır ve uygulamanın çağırdığı her uç sunucunun `API_ROUTES`unda bulunur. · bekçi: `mirror.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Çevrimdışı önbellek SALT-OKUNURDUR: son veri yalnız AĞ hatasında "çevrimdışı — son veri <zaman>" bandıyla gösterilir, 403/404'te saklı kopya silinir, çıkışta bütün önbellek silinir, çevrimdışıyken yazma düğmesi kapalıdır. · bekçi: `cache.test.ts` · `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Yazma işlem kimliği (`mesajId`/`clientToken`) mantıksal deneme başına bir kez üretilir, yalnız sonucu belirsiz bırakan hatada (ağ/5xx) yapışır, kesin 4xx'te ve gövde değişince yenilenir; hata kodu yalnız `details.code`ten okunur. · bekçi: `client.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Firma adı ve logosu koda gömülmez: tesisin `ad`ından gelir, yoksa nötr "TeksERP Patron" yazılır; oturum belirteci gizli depoda (web'de yalnız sekme ömrü), TOTP sırrı ve davet kodu hiçbir depoya yazılmaz. · bekçi: `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Yıkıcı işlem (gelen kutusu/rapor isteği iptali, hesap kilidi/arşivi, davet yenileme) iki adımlı onayla uygulanır. · bekçi: `ui.test.tsx` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Seçici (cari · ürün · renk) dokununca doğrudan modal açar; arama ve tek açılır süzgeç SUNUCUDA yürür (`LIST_SEARCH`, Türkçe katlama JS ↔ SQL birebir, LIKE jokeri kaçırılır), istemci listeyi süzmez. · bekçi: `test_liste_arama` · `picker.test.tsx` <sub>(arşiv:2026-09-30 F1)</sub>
- **[ÇEKİRDEK]** TOTP kurulumunda `otpauth` karekodu ve elle girilecek anahtar birlikte gösterilir; sır yalnız o ekranda bellektedir. · bekçi: `totp-qr.test.tsx` <sub>(arşiv:2026-09-30 F1)</sub>
- **[ÇEKİRDEK]** Web girişinde adres yolundaki ardışık ya da ters eğik çizgi, yönlendirici başlamadan ÖNCE tek '/'ye katlanır (`history.replaceState`, sorgu ve hash korunur, yalnız web); giriş sırası `entry.ts`te sabittir (metro-runtime → katlama → `expo-router/entry`). · bekçi: `web-path.test.ts` · `deploy/patron/tarayici-duman.cjs` <sub>(arşiv:2026-09-30 I12)</sub>

### Kararlar

- **[ÇEKİRDEK]** Projeksiyon ve anlık verinin şekli fabrikada tanımlıdır; uygulama alanları jenerik biçimler (TR sayı/tarih, `…Id` gizli) ve aritmetik yapmaz. · bekçi: `format.test.ts` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Pano ve rapor ekranı odaklanınca `POST /api/tazele` (§14 S47) çağrılır ve sunucunun `sonrakiMs` aralığına uyulur: aralık dolmadan ikinci istek yok, hata sessiz ve geri çekilir; web çıktısının dili `tr`dir (`app.json` `web.lang`). · bekçi: `refresh.test.ts` <sub>(arşiv:2026-09-30 I6)</sub>
- **[ÇEKİRDEK]** Rapor isteğinin parametresi fabrikanın kendi şemasıdır: uygulama yalnız özel aralığı (`dateFrom`/`dateTo`) ve katalog girdisinin ek alanlarını toplar; istenebilir liste fabrikanın `rapor-katalogu` anlık kaydından okunur. · bekçi: `forms.test.ts` <sub>(arşiv:2026-09-29)</sub>

## Dağıtım (`deploy/patron`, VDS)

### Değişmezler

- **[ÇEKİRDEK]** Web sürümü API ile AYNI kökenden (`/`) sunulur ve `/api` · `/v1` altı asla HTML'e düşmez; iç/yönetim ad alanları (`web-static.ts` `IC_ONEKLER`) web'de 404'tür ve Traefik kuralının dışında kalır — iki liste bekçiyle eşlenir. · bekçi: `test_web_sunumu (§4 · §5 · §8)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Web CSP'si `unsafe-inline` taşımaz: giriş HTML'indeki satır içi blok yalnız kendi sha256 özetiyle izinlidir (özet açılışta dosyadan hesaplanır) ve react-native-web'in BOŞ `<style>` ögesi boş dizgenin özetiyle; CSP değişikliği gerçek tarayıcıda ölçülür (başlık ölçümü stilin uygulandığını göstermez); içerik özetli dizinler uzun ömürlü, giriş HTML'i `no-store`. · bekçi: `test_web_sunumu (§2 · §3)` · `deploy/patron/tarayici-duman.cjs` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kökene doğrudan erişimde web yolundaki ardışık ya da ters eğik çizgi GET/HEAD'de tek '/'li aynı köken hedefe 301 ile katlanır (kenar vekili yolu katlayıp ilettiği için arkasında katlamayı istemci yapar — § Uygulama); katlanan hedef API/iç ad alanıysa 404. · bekçi: `test_web_sunumu (§9)` <sub>(arşiv:2026-09-30 F1)</sub>
- **[ÇEKİRDEK]** Tarayıcı dumanının CSP istisnası yalnız Cloudflare Web Analytics beacon'ıdır (kenar enjekte eder; CSP gevşetilmez, bölge ayarına dokunulmaz); başka her ihlal kırmızıdır. · bekçi: `test_web_sunumu (§10)` <sub>(arşiv:2026-09-30 F1)</sub>
- **[ÇEKİRDEK]** Patron sunucusu göç (tablo sahibi) parolasını ALMAZ: üç DB rolü üç docker secret'ıdır, göç parolası yalnız DB · `patron-goc` · yedek konteynerine bağlanır; sunucu yalnız kenar adresinde dinler, port yayımlamaz, satıcıyla ortak birim ya da sır grubu taşımaz. · bekçi: `deploy/patron/compose-denetle.mjs (① · ⑦ · ⑧ · ⑨)` <sub>(arşiv:2026-09-29)</sub>

- **[ÇEKİRDEK]** Dış çıkış yalnız bildirim için ve yalnız sunucuya açılır: compose'un kurduğu internal OLMAYAN tek ağ `cikis`tir, ona yalnız `patron` katılır ve orada dinlemez; DB · göç · yedek internal ağlarda kalır. · bekçi: `deploy/patron/compose-denetle.mjs (④)` <sub>(arşiv:2026-09-30 I6)</sub>
- **[ÇEKİRDEK]** Salt okunur anahtar birimindeki sır dosyası (VAPID) konteyner dışında ÖNCEDEN üretilir; sunucu izni zaten dar dosyaya chmod çağırmaz, boş `BILDIRIM_VAPID_KONU` verilmemiş sayılır. · bekçi: `test_bildirim_gonderim (§3)` <sub>(arşiv:2026-09-30 I6)</sub>

### Kararlar

- **[PROFİL]** VDS bütçesi (2 çekirdek / 3 GB): patronun uzun ömürlü servislerinin bellek tavanı toplamı ≤ 1 GiB — sunucu 512m (yığın 320 MB) · DB 384m · yedek 128m; CPU 0,75 · 0,5 · 0,25. · bekçi: `deploy/patron/compose-denetle.mjs (③)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Web derlemesinin bulut adresi `koken`dir: uygulama API'ye sayfanın kökeninden gider, kökensiz ortamda (telefon) `koken` null'dur (fail-closed); telefon derlemesi açık `https://` adresi taşır. · bekçi: `client.test.ts` <sub>(arşiv:2026-09-29)</sub>

## Bekçiler — bu alana dokununca koş

Fabrika: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (kendi `_test` DB'si; sahte bulut döngü adresinde düz HTTP). Ağır koşum `node scripts/agir-is.mjs -- …` ile.

Bulut sunucusu bekçileri kendi projesinden: `cd patron/sunucu && node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts` (kendi `_test` DB'si + çalışma rolleri; roller her koşumda hizalanır). Protokol aynası fabrika tarafında: `cd Teks-Erp && npx tsx scripts/test_lisans_protokol_aynasi.ts`.

**Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## patron-bulutu` bölümü.**

Fabrika (Teks-Erp): `test_bulut_filigran`, `test_bulut_silme_damgasi`, `test_bulut_uzlastirma`, `test_bulut_projeksiyon_allowlist`, `test_bulut_ham_update`, `test_bulut_gelen_kutusu`, `test_bulut_tel_aynasi`, `test_bulut_hesap_kilitle`, `test_bulut_ozet_mutabakat`

Bulut sunucusu (patron/sunucu): `test_rls_sizinti`, `test_izin_suzmesi`, `test_gelen_kutusu_claim`, `test_esitleme_idempotency`, `test_totp_zorunlu`, `test_rapor_istegi`, `test_saklama`, `test_kurulum_dizini`, `test_cihaz_kaydi`, `test_bildirim_kurallari`, `test_bildirim_gonderim`, `test_patron_kapilari`, `test_uzlastirma_kumesi`, `test_tazele_zili`, `test_web_sunumu`, `test_katalog_ozeti`, `test_liste_arama`, `test_bildirim_makbuz`, `test_hesap_kilitle_fabrika`, `test_hizmet_sonu`, `test_kimlik_silme`, `test_ip_saklama`, `test_destek_rolu`

Dağıtım (kurulum öncesi, Mac'te, CI dışı): `node deploy/patron/compose-denetle.mjs --env-file <patron .env> --satici-env <satıcı .env>` — çıkış 0 temiz · 1 ihlal · 2 ölçülemedi; yerel duman `deploy/patron/duman.sh kur <sha>` (gerçek tarayıcı dahil); runbook `docs/ops/PATRON-BULUTU-KURULUM.md`.

Uçtan uca: **Senaryo P** (plan §8 P1–P16 + sözleşme §13 P17–P25; gerçek patron bulutu + gerçek fabrika backend'i, lisans fikstürü + sahte satıcı ve iç API'si; iki `_test` DB, patron DB'si `patron/sunucu/.env`den, `migrate deploy` önceden): `cd Teks-Erp && DATABASE_URL='postgresql://…/<fabrika>_test?schema=public' node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-patron.ts [--json=<dosya>] [--son=P7] [--yalniz=P1,P3]` — ~4 dk; çıkış 0 hepsi yeşil · 1 yeşil olmayan adım · 2 hedef reddi/düzenek.

Uygulama (DB'siz): `cd patron/uygulama && node ../../scripts/agir-is.mjs -- npx jest --runInBand` — `notifications.test.tsx`, `refresh.test.ts`, `mirror.test.ts`, `access.test.ts`, `cache.test.ts`, `client.test.ts`, `forms.test.ts`, `format.test.ts`, `ui.test.tsx`, `web-path.test.ts`, `export.test.ts`; yerel API dumanı `scripts/duman.ts` (kendi `_test` sunucusuna, `tesis-ac` + `kurulum-kaydet --sinif=URETIM --moduller=patron-bulut` + `yonetici-davet` sonrası).

Yeni patron bulutu bekçisi doğduğu commit'te bu listeye VE haritanın `## patron-bulutu` bölümüne birlikte eklenir. Katalog ya da tetikleyici değişince `test_db_invariants` (TRIGGERS/EXPECTED_FUNCTIONS) de koşulur.

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-29 · Patron bulutu: B-turları kararları (Plan B) — 2026-09-01 bulut ayna reddi KISMEN GEÇERSİZ
- 2026-09-29 · Patron bulutu eşitlemesi (B1-kod): katalog kodda, silme tetikleyiciyle, filigran güvenli ufukla, fail-closed ön koşul
- 2026-09-29 · Patron bulutu gelen kutusu (B3): makbuz aynı tx, teknik kullanıcı girişsiz, sipariş aktörü audit'te
- 2026-09-29 · Patron bulutu sunucusu (B2): çok kiracılı tek DB + RLS, iki çalışma rolü, eşitleme alıcısı, gelen kutusu, hesaplar
- 2026-09-29 · Lisans + patron bulutu entegrasyonu (I3-1a): tek ön koşul, tek bulut adresi, tek protokol kaynağı, birleşik sapma listesi
- 2026-09-29 · Patron uygulaması (B4): Expo tek kod tabanı, salt-okunur çevrimdışı önbellek, tel tipi aynası
- 2026-09-29 · Patron bulutu eşitleme saat/ufuk düzeltmeleri (BF): bekleyen listesi, kalem ebeveyn kuralı, bulut D4
- 2026-09-30 · Patron bildirimleri (B5): tür kataloğu, durumsuz olay üretimi, idempotent bildirim kimliği, gönderimde yeniden sınama, VAPID sırrı dosyada
- 2026-09-29 · Senaryo P koşucusu (Plan B uçtan uca): `ozet` zilinin bulut üreticisi (S47), hesap API'si TR iletisi (S48), sahte satıcı iç API'siyle gerçek zil zinciri
- 2026-09-29 · Patron bulutu dağıtımı (B-dağıtım): aynı köken web + API, iç ad alanı iki katta 404, üç DB rolü üç sır, satıcıyla ortak birim yok
- 2026-09-30 · Lisans + patron entegrasyonu 5 (I6): tek ABI 2, Docker künyesi 2e-S biçiminde, §14 tek liste (S47/S48), bildirim çıkış ağı, paketten üretici kimliği, DR ana kimliği panelde isteğe bağlı, ekran açılışı tazelemesi, P5 push kaydı
- 2026-09-30 · Patron uygulaması eksikleri (F1): sunucu aramalı seçici, çift eğik çizgi 301, CF beacon istisnası, TOTP karekodu, Expo makbuzu, deneme bildirimi
- 2026-09-30 · Proje sınırı: bulut kataloğu statik özetten okunur, hiçbir proje başkasının kaynağını içe aktarmaz (CI-2)
- 2026-09-30 · Eski tünel emekliliği (B6): özet tek kaynağı `cloud-sync/overview.ts`, fabrikadan bulut hesabı kilitleme
- 2026-09-30 · Patron web `//` boş sayfası (I12): kenar vekili yolu katlayıp iletir, 301 tetiklenmez; katlama istemcide, yönlendiriciden önce
- 2026-09-30 · Patron bulutu hukuk metnine uyum (PU): hizmet sonu 90 gün salt okuma + dışa aktarma + imha CLI'si, kapanan hesabın kimliği 30 günde silinir, giriş IP'si 30 gün, destek rolü + erişim kaydı
- 2026-09-30 · Entegrasyon düzeltmeleri (sertleştirme 2 + güven çapası inişi): kimlik silmesi işlem makbuzunu da tombstone'lar, kolon düzeyi yetki, destek rolünün görünüm/fonksiyon ölçümü
