# Patron bulutu · Eşitleme · Gelen kutusu

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Alan 2026-09-29'da doğdu (Plan B: patron bulutu). Hikâye, ölçüm ve gerekçe arşivde (`docs/history/CLAUDE-NOT-ARSIVI.md`, 2026-09-29 notları); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.
> Tasarım: `docs/design/PATRON-BULUTU.md` (Plan B kararları) · bağlayıcı sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md` (paket §6 · rapor §7 · gelen kutusu §8 · bulut modeli + RLS §9 · izin kataloğu §10 · B2 uygulama notları §17) · imza biçimi `docs/design/LISANS-PROTOKOLU.md`. Kod adları İngilizce, tel şeması anahtarları ve kod DEĞERLERİ Türkçe.

## Ortak (fabrika + bulut + uygulama)

### Değişmezler

- **[ÇEKİRDEK]** Bulut HESAP YAPMAZ, fabrika tek yazardır: türetilmiş her alan fabrikanın tek kaynak yardımcısıyla hesaplanıp projeksiyona girer; bulut saklar, izinle süzer, gösterir — aritmetik ve tarih karşılaştırması yapmaz. <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Buluttaki tek yazma kanalı gelen kutusudur: hesabın yazdığı sipariş/cari bir MESAJdır, fabrika onu çeker ve normal servis yolundan idempotent yazar; bulut hiçbir fabrika satırını değiştiremez. · bekçi: `test_gelen_kutusu_claim (§1 · §2 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme hakkı FAIL-CLOSED ön koşuldur: yalnız `URETIM` sınıfı + `patron-bulut` modülü + bitmemiş abonelik + devredilmemiş kurulum gönderir; bulut İKİNCİ kapıdır (403 `SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`). · bekçi: `test_esitleme_idempotency (§5j–§5l)` <sub>(arşiv:2026-09-29)</sub>

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

Bulut sunucusu bekçileri kendi projesinden: `cd patron/sunucu && node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts` (kendi `_test` DB'si + çalışma rolleri; roller her koşumda hizalanır). Protokol aynası fabrika tarafında: `cd Teks-Erp && npx tsx scripts/test_lisans_protokol_aynasi.ts`.

**Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## patron-bulutu` bölümü.**

Backend: `test_rls_sizinti`, `test_izin_suzmesi`, `test_gelen_kutusu_claim`, `test_esitleme_idempotency`, `test_totp_zorunlu`, `test_rapor_istegi`, `test_saklama`, `test_kurulum_dizini`, `test_cihaz_kaydi`, `test_patron_kapilari`, `test_lisans_protokol_aynasi`

Uygulama (DB'siz): `cd patron/uygulama && node ../../scripts/agir-is.mjs -- npx jest --runInBand` — `mirror.test.ts`, `access.test.ts`, `cache.test.ts`, `client.test.ts`, `forms.test.ts`, `format.test.ts`, `ui.test.tsx`; yerel API dumanı `scripts/duman.ts` (kendi `_test` sunucusuna, `tesis-ac` + `kurulum-kaydet --sinif=URETIM --moduller=patron-bulut` + `yonetici-davet` sonrası).

Yeni patron bulutu bekçisi doğduğu commit'te bu listeye VE haritanın `## patron-bulutu` bölümüne birlikte eklenir.
