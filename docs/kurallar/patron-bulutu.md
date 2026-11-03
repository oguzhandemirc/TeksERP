# Patron bulutu · Eşitleme · Gelen kutusu · Bulut sunucusu

> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/patron-bulutu.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi. Sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md`; katalog tek kaynak `src/cloud-sync/projections.ts`; kod adı İngilizce, tel anahtarı/değeri Türkçe.

## Ortak (fabrika + bulut + uygulama)

### Değişmezler

- **[ÇEKİRDEK]** Bulut HESAP YAPMAZ, fabrika tek yazar: türetilmiş alan fabrikanın tek kaynak yardımcısıyla projeksiyona girer; bulut saklar, izinle süzer, gösterir.
- **[ÇEKİRDEK]** Buluttaki tek yazma kanalı gelen kutusu: sipariş/cari MESAJdır, fabrika normal servis yolundan idempotent yazar.
- **[ÇEKİRDEK]** Eşitleme hakkı FAIL-CLOSED: yalnız gönderici sınıf (URETIM · BARINDIRILAN · DEMO) + `patron-bulut` modülü + bitmemiş abonelik + devredilmemiş kurulum gönderir; bulut İKİNCİ kapı (403 `SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`).
- **[ÇEKİRDEK]** Gönderici sınıf kümesi tek kaynak `CLOUD_SENDER_CLASSES` (`belgeler.ts`, aynalar bayt-eşit); `cloudEligibility` ve `cloudEntitlementError` aynı `isCloudSenderClass`ı çağırır, sınıf literali yazma; sebep kodu `SINIF_URETIM_DEGIL` adı korunur.
- **[ÇEKİRDEK]** Proje başka projenin kaynağını/`node_modules`ünü içe aktarmaz: tel tipi bayt-eşit ayna, bulut kataloğu yalnız `patron/sunucu/src/catalog/katalog-ozeti.json` (bayatsa `--yaz`).

## Eşitleme (fabrika)

### Değişmezler

- **[ÇEKİRDEK]** Türetilmiş alan (açık miktar, bakiye, gecikmiş, brüt metre) liste ekranının TEK KAYNAK yardımcısıyla; okuduğu tablo kökte, değişiklik kaynağında, tetikleyicide ya da kapsama listesinde.
- **[ÇEKİRDEK]** Kolon listesi OPT-IN: not, katlama ikizi, sır, fabrika kullanıcı kimliği gitmez; kişisel yalnız `<ad>.kisisel`, tutar yalnız `<ad>.finans`; anlık kayıt katı tel şemasından.
- **[ÇEKİRDEK]** Ön koşul tek `cloud-sync/eligibility.ts` `cloudEligibility`: HAK URETIM ∧ `patron-bulut` ∧ abonelik/aralık KİRADAN ∧ devredilmemiş ∧ lisans GEÇERLİ; belirsizlik göndermez; kimlik `getLicenseInstallationId`, adres `PATRON_CLOUD_URL`.
- **[ÇEKİRDEK]** Değişiklik tespiti audit'ten türetilmez: `(filigran, eşitlik bozucu)` GÜVENLİ UFUKLA okunur, filigran YALNIZ `kabul` ile ilerler; ret/5xx/ağ ilerletmez, tekrar aynı paket kimliğiyle.
- **[ÇEKİRDEK]** AFTER DELETE tetikleyicisi `sync_marks`a aynı tx'te SILINDI yazar (kaskad dahil); eski ebeveyn ve `shipment_orders` KIRLI; kök liste ↔ migration ↔ DB iki yönlü.
- **[ÇEKİRDEK]** `sync_marks` TELEMETRİ'dir: onaylı zincirin gerisindeki 7 günden eski işaret (eşitleme durmuşsa 30 gün) budanır; tek budayan `src/cloud-sync/marks-pruning.ts`.
- **[ÇEKİRDEK]** Katalog tablosuna `updatedAt` yazmayan her ham UPDATE `scripts/lib/bulut-ham-update-beyan.ts`te beyanlı; opt-in kolona `updatedAt`siz ham yazım yok.
- **[ÇEKİRDEK]** Uzlaştırma kümesi iki uçta `RECONCILE_PARENTS` kuralıyla; bekleyeni YALNIZ fabrika çizer; onaysız ebeveynli kalem ÖLÇÜLEMEDİ; uyuşmazlık TAM'a sokar, bulut işaretle-süpür.
- **[ÇEKİRDEK]** `ISTEK_ZAMAN`: bulut `details.sunucuSaati` (İMZASIZ) koyar; fabrika `requestClockSkewMs` ile BİR KEZ yeni nonce'la yeniden imzalar, ikinci retde durur.
- **[ÇEKİRDEK]** Buluttan istenen rapor fabrika günü (`YYYY-MM-DD`) aralığı alır; gün sınırını yalnız fabrika `constants/time` çözer, bulut parametreyi AYNEN iletir; taşan gün reddedilir.
- **[ÇEKİRDEK]** Finans dışı rapor sunumunda para birimli HER alan (`paraIcerir` dahil) `bulut:fiyat:oku` ister; işareti fabrika koyar, bulut yalnız düşürür.
- **[ÇEKİRDEK]** `maliyet.enabled` projeksiyonlarının (`teklif`, `teklif-kalemi`, `standart-maliyet`) para alanları YALNIZ `.finans`ta ve `bulut:maliyet:oku` ister; taslak teklif gitmez, marj fabrikada `quoteMargin`.

### Kararlar

- **[ÇEKİRDEK]** Birleşmiş carinin faturası zincirin SON hesabı altında: `fatura.cariHesapId` türeticiden (`cloud-sync/derived-merged-invoice.ts`), `cariId` değişmez; birleşmesiz satır bayt-aynı.
- **[ÇEKİRDEK]** Zamana bağlı alan (`gecikmis`, `vadesiGecti`) bulutta hesaplanmaz: vadesi (önceki konum, ufuk] aralığına düşen kökler geçiş kaynağıyla yeniden gönderilir.
- **[ÇEKİRDEK]** Rapor isteği fabrikanın şemasıyla (`PARAMETRE_GECERSIZ`); `audit/*`/kişi adlı rapor yok (`RAPOR_BILINMIYOR`); kapalı rapor/modül buluta da kapalı; dönem görüntüsü değişmedikçe gitmez.
- **[ÇEKİRDEK]** Kapı zili tek SSE aboneliği: `lisans` lisans yoklamasında, diğer konular `jobs/doorbell-topics.ts`e; zil içerik taşımaz, anlık tur 30 sn'de en çok bir.
- **[ÇEKİRDEK]** Ret alan GUNLUK anlıkla günü tamam sayma: yalnız reddedileni 1→2→4→8 sa geri çekilmeyle yeniden gönder; aynı KISMI log 6 sa içinde tekrarlanmaz (`cloud-sync/daily-retry.ts`).
- **[PROFİL]** Olay güdümlü tur `patronBulut.olayGudumluEnabled` (varsayılan kapalı); kirli bayrak tek yazar `cloud-sync/dirty-flag.ts` (`lib/prisma.ts` Proxy); 3 sn birleştirme, ≥15 sn aralık, tek uçuş; hata yutulur, yazma her koşulda yapılır.

## Gelen kutusu (fabrika)

### Değişmezler

- **[ÇEKİRDEK]** Gelen kutusu kaydı NORMAL servis yolundan (`prepareOrderCreate` + `insertPreparedOrderTx`, `clientToken = mesajId`; `prepareCardCreate` + `createCardInTx`); eşleme tek yer `cloud-sync/inbox-wire.ts`.
- **[ÇEKİRDEK]** İdempotency makbuzda: varlık + `CloudInboxReceipt` AYNI tx; 8036 kilidi ilk ifade; kesin ret makbuz yazar, belirsiz hata yazmaz; Order/Customer'a kaynak kolonu ekleme.
- **[ÇEKİRDEK]** Teknik kullanıcının giriş yöntemi YOK: izin yalnız `order:write` + `customer:write`, kimlik `patronBulutu.teknikKullaniciId` ayarında (`User`a kolon yok); `issueToken` onu reddeder; `mobile-users` listesinden beyanlı hariç.
- **[ÇEKİRDEK]** Gelen kutusu işi aynı `cloudEligibility` + teknik kullanıcı ister, eksikse HİÇ dış istek yok; `zorla` kademesi sipariş/cari yazmasını kapatıyorsa `al` çağrılmaz, kayıt BEKLIYOR kalır.
- **[ÇEKİRDEK]** Tel sözleşmesi TEK `patron/sunucu/src/wire/esitleme.ts` (yalnız `zod`); fabrika `Teks-Erp/src/cloud-sync/wire/esitleme.ts` bayt-eşit (`cp -p`); iki katalog birebir.

## Bulut sunucusu (`patron/sunucu`)

### Değişmezler

- **[ÇEKİRDEK]** Her tesis AYRI DB (`<merkez>_t<16 hane>`, roller `<db>_uyg` · `<db>_esit`); merkez yalnız yönlendirme/kimlik/tutanak; çözülemeyen tesis merkeze DÜŞMEZ (404/503); göç tesis başına.
- **[ÇEKİRDEK]** Her tablo `tesis_id` + RLS ENABLE + FORCE; `app.tesis_id`/`app.veritabani_tesisi` tx'in İLK ifadesi (`src/lib/tenant.ts`), ayarsız bağlantı HATA; kiracı gövdeden asla.
- **[ÇEKİRDEK]** Çalışma rolleri NOSUPERUSER NOBYPASSRLS: uygulama projeksiyona yazamaz, eşitleme hesap/oturum okuyamaz; yetki tek kaynak `src/lib/db-grants.ts` (`MERKEZ_APP_GRANTS` · `MERKEZ_SYNC_GRANTS`).
- **[ÇEKİRDEK]** FINANS/KİŞİSEL kolon `.finans`/`.kisisel` alt satırında, RESTRICTIVE `app.projeksiyonlar` süzer; kökte yasak alan RET, `*` projeksiyon YASAK, eşlenmeyen RED.
- **[ÇEKİRDEK]** Sürüm anı paketin UFKU: eski paket ezemez/diriltemez (mezar 7 gün); aynı `paketId` saklı yanıt, başka gövde 409; filigran boşluğu `istenen: TAM`.
- **[ÇEKİRDEK]** Bulut kimliği (`identities`; parola + TOTP kimlikte) TOTP'siz AKTİF olamaz, oturum açamaz (DB CHECK); hesap davetle doğar, kurtarma kodu yok, son aktif hesap yöneticisi düşürülemez.
- **[ÇEKİRDEK]** Giriş: bilinmeyen hesap/yanlış faktör/kilit AYNI 401, tek scrypt + `LOGIN_FAILURE_FLOOR_MS`; kilit hesap + KAYNAK (`auth/login-throttle.ts`), süresiz hesap kilidi yok.
- **[ÇEKİRDEK]** E-posta TEK kimlik (`identities.email_digest` UNIQUE), tesiste tek üyelik (`login_routes`); davet/arşiv e-posta tutmaz, başka tesisi sormaz; çakışma 409 `DAVET_ETKINLESTIRILEMEDI`.
- **[ÇEKİRDEK]** Oturum tesis başına; `POST /api/oturum/gecis` yalnız hedefte AKTİF hesap + açık hizmetle (yoksa 403); TOTP sormaz, azami ömrü ilk girişten devralır, UZATMAZ.
- **[ÇEKİRDEK]** Yönetici kimliği yalnız TEK üyeliği kendi tesisindeyse sıfırlar, değilse 409 `KIMLIK_PAYLASIMLI`; çok üyelikliyi yalnız satıcı CLI `kimlik-sifirla --zorla --talep --gerekce`.
- **[ÇEKİRDEK]** Davet ve `davet/incele` kimlik varlığını ele vermez; `POST /api/davet/bagla` her retde girişle AYNI 401; ayak izi `DAVET_BAGLAMA_REDDEDILDI`.
- **[ÇEKİRDEK]** Üyeliksiz merkez kimliği PASİF, 30 gün sonra silinir (`services/identity-purge.ts`, `purgeCentralIdentities`, LOGIN_ROUTE kilidi): parola/TOTP NULL, özet anlamsız değere, satır kalır.
- **[ÇEKİRDEK]** Hesap silme (`POST /api/oturum/hesap-sil`) `verifyOwnFactors` ister; üyelik/bekleyen davet `archiveAccountTx` (`DAVET_KAPANDI`), kimlik `closeIdentityClaim`; paralel silme yazma; son aktif yöneticiyse 409 `SON_YONETICI` (`details.tesisler`).
- **[ÇEKİRDEK]** Anahtar değişince `tesis-db ozet-yenile` (kuru varsayılan, `--apply`); ilk ifade `LOGIN_ROUTE`; tek çakışmada hiç yazma; çıktı e-posta/özet taşımaz.
- **[ÇEKİRDEK]** Rol parolası yalnız hazırlıkta ve `tesis-db rol-hizala --apply` (`goc` dokunmaz); önce `rol-hizala` sonra `ozet-yenile`; uyum `pg_authid`; HAZIR olmayan atlanır (çıkış 1); anahtar yoksa dur.
- **[ÇEKİRDEK]** Hizmet aşaması `serviceState` (`src/services/service-lifecycle.ts`): ACIK → 90 gün SALT_OKUNUR (eşitleme/gelen kutusu/rapor/bildirim kapalı) → KAPALI; bitiş `facilities.service_ended_at`, tek yazar `refreshServiceEnd`; DR devri hizmeti bitirmez.
- **[ÇEKİRDEK]** Dışa aktarma (`GET /api/disa-aktar[/:kume]`) yalnız yöneticiye, `app.projeksiyonlar` kadar; bulut kolon eklemez; CSV formül enjeksiyonuna karşı öneklenir.
- **[ÇEKİRDEK]** PASIF hesabın kimliği 30 gün sonra (`purgeClosedIdentities`): ad/e-posta/makbuz yanıtı tombstone, parola/TOTP/davet NULL, oturum/cihaz silinir, satır KALIR; `PRUNED_TABLES`; kapanış anı PASIF claim'inde (CHECK); arşiv hesap düzenlenemez.
- **[ÇEKİRDEK]** İstemci adresi yalnız `GUVENILIR_VEKIL_AGLARI` (yoksa Cloudflare) kenarından; `IC_VEKIL_AGLARI` (`${KENAR_AGI}`) arkasında X-Forwarded-For son halkası.
- **[ÇEKİRDEK]** Patron yönlendiricisi iki halkalı kenar zinciri taşır: Cloudflare `ipallowlist` (`rate-limit.ts` `CLOUDFLARE_NETWORKS` birebir) → `Cf-Connecting-Ip` anahtarlı hız seddi.
- **[ÇEKİRDEK]** IP yalnız giriş olaylarının `account_audit.summary.ip`inde, 30 gün sonra alan silinir (`AGED_FIELDS`); erişim günlüğü IP/sorgu dizgisi taşımaz.
- **[ÇEKİRDEK]** Destek sorgusu yalnız `<tesis DB>_destek` (NOLOGIN, SELECT, `SUPPORT_GRANTS`); RESTRICTIVE `destek_kapisi` `destek_ac` iznine bağlı, açılış `support_access`a; `SUPPORT_FUNCTIONS` beyanlı, DEFINER `search_path` sabit, `pg_temp` sonda.
- **[ÇEKİRDEK]** Satıcı CLI AKTİF yönetici varken yönetici açamaz/yükseltemez (409 `AKTIF_YONETICI_VAR`); zorlama yalnız `--zorla --talep=<no> --gerekce="…"`, denetime yazılır; atomik claim.
- **[ÇEKİRDEK]** İmha yalnız `scripts/tesis.ts imha` (kuru varsayılan): ACIK'ta asla, SALT_OKUNUR'da erken talep no ile; yarıda kalan aynı komutla biter; `TESIS_TABLES` − `RETAINED_TABLES`; `facility_destructions` değişmez.
- **[ÇEKİRDEK]** Fabrika bulut hesabını yalnız KİLİTLER (`POST /v1/hesap-kilitle`, imzalı, idempotent): AKTIF → KILITLI; son aktif yönetici kilitlenemez; açma bulutta.

### Kararlar

- **[ÇEKİRDEK]** Gelen kutusu claim'i yazarın GÜNCEL durumunu sorar: alınmamış mesajın yazarı yetkisizse aynı tx'te REDDEDILDI `YAZAR_YETKISIZ` (ayak izi düşer); alınmış mesaj yine teslim edilir.
- **[ÇEKİRDEK]** Kuyruk claim'i (gelen kutusu, rapor isteği) `WITH … FOR UPDATE SKIP LOCKED` CTE'siyle; `WHERE id IN (… LIMIT n FOR UPDATE SKIP LOCKED)` yasak (LIMIT'i aşar).
- **[ÇEKİRDEK]** Buluttaki satır defter değildir: saklama (3 · 13 · 25 ay · tümü, varsayılan 13) kökle birlikte alt satırı/kalemi budar; yaşa göre silinen her tablo `PRUNED_TABLES`ta.
- **[ÇEKİRDEK]** Satıcı iç API önbelleği TAZELİKTİR: süre dolunca sorulur, ulaşılamazsa bayat kayıt, hiç dolmadıysa RED; zil yalnız `{tesisId, konu}`.
- **[ÇEKİRDEK]** Rapor izni anahtar başına (`catalog/reports.ts` `REPORT_KEY_PERMISSION` ↔ `REMOTE_REPORTS`); RLS adı `rapor.<aile>-<ad>`; daha dar fabrika izni de istenir, tanınmayan RED.
- **[ÇEKİRDEK]** `POST /api/tazele` = `ozet` zili: içerik yok, tesis başına 30 sn'de bir; aralık içindeki istek kalan süreyi döner.
- **[ÇEKİRDEK]** Hesap API doğrulama iletisi TR: zod TR yerel ayarı `createApp`'te; İngilizce ileti 400 gövdesine sızmaz.
- **[ÇEKİRDEK]** Değişim sayacı yalnız kabul edilen veriyle biten pakette artar; `GET /api/degisim` içerik taşımaz, ≤25 sn bekler, adlar hesabın okuyabildiği projeksiyonlarla süzülür.

## Bildirimler (B5)

- **[ÇEKİRDEK]** Güvenlik olayı `securityEvent` ile yalnız güvenlik Telegram grubuna (`GUVENLIK_TELEGRAM_BOT_TOKEN` + `GUVENLIK_TELEGRAM_CHAT_ID`); biri yoksa kanal KAPALI; `/saglik` taşımaz.
- **[ÇEKİRDEK]** Tür kuralı tek kaynak `patron/sunucu/src/catalog/notifications.ts`: tür kaynak projeksiyonun okuma iznini KAPSAR, finans türü finans izni ister.
- **[ÇEKİRDEK]** Eşik bulutta HESAPLANMAZ, fabrikanın özet sayısıyla karşılaştırılır; gereken toplam fabrikanın anlık projeksiyonuna girer.
- **[ÇEKİRDEK]** Aynı olay aynı hesaba ikinci kez doğmaz: `dedup_key` + `UNIQUE(tesis, hesap, dedup_key)`; kural düşüren olay ATLANDI doğar.
- **[ÇEKİRDEK]** Gönderimde izin, tür, sessiz saat YENİDEN sınanır; sessiz saatte bitişe ertelenir.
- **[ÇEKİRDEK]** Anın dilimini `tesis` DÖNEMLERİNDEN çöz (`facilityTimeZoneAt(veri, an)`; yoksa `tabanDilim`, eski paket `saatDilimi`); yalnız `saatDilimi` okuma.
- **[ÇEKİRDEK]** `notifications` TELEMETRİ'dir: sonuçlanmış satır `BILDIRIM_SAKLAMA_GUN` sonra budanır, iş kararı okunmaz.
- **[ÇEKİRDEK]** VAPID gizli anahtarı dosyada (0600), günlüğe/DB'ye/API'ye girmez; taşıyıcı hatası kısa KOD; web aboneliği yalnız izinli push servisine (SSRF kapısı).
- **[ÇEKİRDEK]** Bildirim dokunuşu yalnız uygulamanın kendi ekranını açar: telefonda `safeRoute`, web'de service worker aynı kalıp (dış adres, `//`, bilinmeyen bölüm açılmaz).
- **[ÇEKİRDEK]** Cihaz satırı TESİS BAŞINA (kayıt tüm AKTİF, kaldırma tüm üyeliklere); `data` = `{bildirimId, rota, tesisId}`; farklı tesis dokunuşunda önce geçiş (`openNotification`).
- **[ÇEKİRDEK]** Expo teslimi iki aşamalı: bilet kabulü GONDERILDI, makbuzdaki `DeviceNotRegistered` cihazı pasife çeker; makbuz yoklaması atomik claim'li, 24 saatte vazgeçer.
- **[ÇEKİRDEK]** Deneme bildirimi yalnız kendi etkin cihazlarına, kuyruğa/geçmişe yazılmaz, hesap başına dakikada bir; kip kapalıyken 409.
- **[PROFİL]** `BILDIRIM_KIPI` varsayılanı `kapali`; `gercek` yalnız mağaza hesapları + patron VDS kurulumundan sonra.
- **[ÇEKİRDEK]** Native push yükü içeriksiz (`nativePushPayload`); gönderim `BILDIRIM_NATIVE_PUSH=acik` + `gercek` + Expo belirteci ister; `google-services.json` repoya girmez.
- **[PROFİL]** Telefon push DERLEME kapısı: `app.config.js` yalnız `PATRON_NATIVE_PUSH=1` ∧ `google-services.json` varken izinleri açar; `NATIVE_PUSH` literal ana anahtar, etkin kapı `NATIVE_PUSH_ETKIN`; Android'de kanal izin isteminden ÖNCE kurulur.

## Patron sunucusu — alt-alan kuralları (patron/sunucu/CLAUDE.md'den, 2026-10-03)

### Kurulum kaydı (imzalı istek + eşitleme hakkı)

- `KURULUM_KAYNAGI=kayit` (varsayılan, `scripts/tesis.ts kurulum-kaydet`) · `=satici` (iç API + `installations` önbelleği, `KURULUM_ONBELLEK_DK`; satıcı 404'ü kaydı pasife çeker; zil yalnız bu kipte).
- **Sıra imza → hak → DB [ÇEKİRDEK]:** yeni kurulum yalnız imza + hak doğrulanınca yazılır; sorgu `KURULUM_SORGU_BUTCE_DK` sınırlı; kayıtsız/yabancı anahtar AYNI 401 `KURULUM_BILINMIYOR`; parolasız sır (`patron-tesis-db.key` · `patron-totp.key`) açıksa açılış DURUR.
- Bulut hakkı ayrıca hizmet ACIK ister; hesap yazmaları açık abonelik ister.

### Hizmet aşaması (Ek-6/A §4 — tek kaynak `src/services/service-lifecycle.ts`)

- KAPALI'da giriş 403 `HIZMET_KAPANDI`, oturum 401; `GET /api/oturum` `hizmet` alanı; ayak izi `HIZMET_SONA_ERDI`/`HIZMET_YENIDEN_ACILDI` · `DISA_AKTARIM`; dışa aktarma `bulut:hesap:yonet`; imha `ACCOUNT_ADMIN` kilidi, `DESTRUCTION_STEPS`.

### Hesaplar

- Bulut hesabı fabrika kullanıcısına bağlanmaz; giriş e-posta + parola (scrypt) + TOTP; TOTP sırrı AES-256-GCM, anahtar `ANAHTAR_DIZINI/patron-totp.key` (DB'de değil).

### Bildirimler (B5)

- Kip `kapali` · `sahte` · `gercek` (`BILDIRIM_VAPID_KONU` zorunlu), gerçek gönderim yerelde DENENMEZ; ayar `resolveSettings`; gönderim `FOR UPDATE SKIP LOCKED`, ağ tx dışında, sonuç yalnız kendi claim'imiz duruyorsa; VAPID `ANAHTAR_DIZINI/patron-vapid.json` üstüne yazılmaz; SSRF `push/targets.ts`.
- `cari-kilit` (`notification-cari-lock.ts`): anahtar `cari-kilit:<kilitId>`/`…:acildi`, sebep/kişi gitmez, budanmaz. `is-emri.sevkeHazir`: fabrikada `computeReadyWorks`, tel `durum` + hazır top/metre, değişimde `sync_marks` KIRLI.
- `ozet-masraf` (`getExpenseSummary`, kategori METNİ + TL, `bulut:kasa:oku`) · `karlilik-ozet` (`computeProfitability`, sıralama fabrikada, `bulut:maliyet:oku`); uygulama yalnız etiketler.

## Uygulama (`patron/uygulama`)

### Değişmezler

- **[ÇEKİRDEK]** Uygulama yalnız GİZLER, karar sunucuda: izinsiz bölüm çizilmez, doğrudan açılırsa uyarı; her `bulut:` izin literali, pano kartı izni ve rapor→izin eşlemesi bulut kataloğuna karşı ölçülür.
- **[ÇEKİRDEK]** Tel tipi tek kaynak `patron/sunucu/src/wire/api.ts`; `patron/uygulama/src/api/wire.ts` bayt-eşit ayna; çağrılan her uç `API_ROUTES`ta.
- **[ÇEKİRDEK]** Önbellek SALT-OKUNUR: bayat etiketle anında çiz, arkadan tazele; bayat ≠ çevrimdışı; 403/404 ve çıkışta sil; çevrimdışı yazma kapalı; web sessionStorage, Android `allowBackup: false`.
- **[ÇEKİRDEK]** Yazma kimliği (`mesajId`/`clientToken`) mantıksal deneme başına, yalnız belirsiz hatada yapışır, 4xx'te ve gövde değişince yenilenir; hata kodu yalnız `details.code`.
- **[ÇEKİRDEK]** Firma adı/logosu koda gömülmez (tesis `ad`ı, yoksa "TeksERP Yönetim"); oturum belirteci gizli depoda, TOTP sırrı ve davet kodu hiçbir depoya yazılmaz.
- **[ÇEKİRDEK]** Yıkıcı işlem (iptal, hesap kilidi/arşivi, davet yenileme) iki adımlı onayla.
- **[ÇEKİRDEK]** Seçici (cari · ürün · renk) doğrudan modal açar; arama/süzgeç SUNUCUDA (`LIST_SEARCH`, Türkçe katlama JS ↔ SQL birebir, LIKE jokeri kaçırılır).
- **[ÇEKİRDEK]** Kimlik süzgeci (`cariKartId` · `cariHesapId` · `siparisId`) yalnız `LIST_ID_FILTERS` projeksiyonunda (diğeri 400), uygulama `/oturum` `liste` beyanıyla.
- **[ÇEKİRDEK]** `kategoriAnahtari` yalnız `LIST_KEY_FILTERS`te, fabrika alanıyla birebir (`cashCategoryKey`); uygulama `liste.anahtarSuzgecleri` beyanıyla.
- **[ÇEKİRDEK]** TOTP kurulumunda `otpauth` karekodu ve elle anahtar birlikte; sır yalnız o ekranda bellekte.
- **[ÇEKİRDEK]** Web girişinde ardışık/ters eğik çizgi yönlendiriciden ÖNCE tek '/'ye katlanır (`history.replaceState`); sıra `entry.ts`te sabit (metro-runtime → katlama → `expo-router/entry`).
- **[ÇEKİRDEK]** Ekran/gezinme adı yalnız `src/lib/access.ts`; "Diğer" ve ray aynı `NAV_GROUPS`; boş durum `EMPTY_ICON`; Bildirim Ayarları cihaz iznini formdan ÖNCE gösterir.

### Kararlar

- **[ÇEKİRDEK]** Verinin şekli fabrikada tanımlı; uygulama jenerik biçimler (TR sayı/tarih, `…Id` gizli), aritmetik yapmaz.
- **[ÇEKİRDEK]** Pano/rapor odaklanınca `POST /api/tazele`; `sonrakiMs`e uy, hata sessiz ve geri çekilir; web dili `tr` (`app.json` `web.lang`).
- **[ÇEKİRDEK]** Rapor parametresi fabrikanın şeması: uygulama yalnız `dateFrom`/`dateTo` ve katalog ek alanlarını toplar; liste `rapor-katalogu` anlık kaydından.
- **[ÇEKİRDEK]** Gizlilik yalnız `docs/legal/PATRON-GIZLILIK-POLITIKASI.md`ten (`deploy/gizlilik-sayfasi/uret.mjs` → `/yonetim-gizlilik`); ilgili değişimde `PATRON-MAGAZA-ANDROID.md` §4.2 birlikte; `#hesap-silme` değişmez.
- **[PROFİL]** Native push yalnız `NATIVE_PUSH` (`src/push/support.ts`) açıkken, ilk mağaza sürümünde kapalı; `expo-notifications` kodu yalnız `*-native.ts`te; Android paketi yalnız `npm run build:aab` (anahtar repo dışında, izin yalnız INTERNET).
- **[ÇEKİRDEK]** Odak/öne gelişte (≥5 sn) yeniden çek; `GET /api/degisim?since=&bekle=25` TEK döngü, yalnız oturum ∧ ön plan; 404'te 60 sn "*"; "Son eşitleme" `esitleme.ufuk`tan.
- **[ÇEKİRDEK]** v2 rapor buluta `RaporSunumu` olarak gider (fabrikada hesaplı); kişi adlı rapor/boyut `REMOTE_REPORTS`e girmez, `kisiAdi` işaretli sunum gönderilmez.

## Dağıtım (`deploy/patron`, VDS)

### Değişmezler

- **[ÇEKİRDEK]** Web API ile AYNI kökenden (`/`); `/api` · `/v1` asla HTML'e düşmez; `web-static.ts` `IC_ONEKLER` web'de 404 ve Traefik kuralı dışında — iki liste eşlenir.
- **[ÇEKİRDEK]** CSP `unsafe-inline` taşımaz: satır içi blok sha256 özetiyle, boş `<style>` boş dizge özetiyle; değişiklik gerçek tarayıcıda ölçülür; özetli dizinler uzun ömürlü, giriş HTML'i `no-store`.
- **[ÇEKİRDEK]** Doğrudan erişimde ardışık/ters eğik çizgi GET/HEAD'de 301 ile tek '/'ye katlanır; hedef API/iç ad alanıysa 404.
- **[ÇEKİRDEK]** Tarayıcı dumanının CSP istisnası yalnız Cloudflare Web Analytics beacon'ı; CSP gevşetilmez, başka ihlal kırmızı.
- **[ÇEKİRDEK]** `patron.etkiliyazilim.com` kalıcı takma ad: `yonetim.etkiliyazilim.com` ile aynı yönlendiricide (`PATRON_HOST` + `PATRON_TAKMA_HOST` zorunlu), DNS kaydı silinmez.
- **[ÇEKİRDEK]** Sunucu göç parolasını ALMAZ: üç DB rolü üç docker secret'ı, göç parolası yalnız DB · `patron-goc` · yedek; sunucu port yayımlamaz, satıcıyla birim/sır paylaşmaz.
- **[ÇEKİRDEK]** Konteynere yalnız rolünün sırları: `patron-baslat.sh` `rol_sirlari()` (`PATRON_ROL`) ↔ compose `secrets:` birebir; hazırlayıcı uygulama parolasını almaz.
- **[ÇEKİRDEK]** Dış çıkış yalnız bildirim için: internal olmayan tek ağ `cikis`, yalnız `patron` katılır, orada dinlemez; DB · göç · yedek internal ağda.
- **[ÇEKİRDEK]** VAPID sır dosyası konteyner dışında önceden üretilir; sunucu chmod çağırmaz; boş `BILDIRIM_VAPID_KONU` verilmemiş sayılır.
- **[ÇEKİRDEK]** Yeni projeksiyon/tel şeması taşıyan fabrika sürümünden ÖNCE bulutu yükselt (`surum-yayin.md` § Backend).

### Kararlar

- **[PROFİL]** VDS bütçesi (2 çekirdek / 3 GB): bellek tavanı ≤ 1 GiB — sunucu 512m (yığın 320 MB) · DB 384m · yedek 128m; CPU 0,75 · 0,5 · 0,25.
- **[ÇEKİRDEK]** Bulut `production/makine-duruslari` kapısını yalnız `machineStopRegime().general` ile kur; `dokuma/duruslar` ve `weavingOpen`a dokunma.
- **[ÇEKİRDEK]** VDS imajı `main`'de KALICI commit sha'sı taşır (temiz `origin/main`'den; yalnız `docs/` dal commit'inden derleme); sürüm kayıt commit'i imajdan sonra.
- **[ÇEKİRDEK]** Web derlemesinin bulut adresi `koken`: kökensiz ortamda null (fail-closed); telefon derlemesi açık `https://` adresi taşır.

## Bekçiler — bu alana dokununca koş

Fabrika: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`; bulut: `cd patron/sunucu && node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts`; protokol aynası `scripts/test_lisans_protokol_aynasi.ts`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## patron-bulutu`.

Fabrika: `test_makine_durus_raporu`, `test_bulut_filigran`, `test_bulut_gunluk_ret`, `test_bulut_silme_damgasi`, `test_bulut_teklif_projeksiyon`, `test_bulut_uzlastirma`, `test_bulut_projeksiyon_allowlist`, `test_bulut_cari_kilit`, `test_bulut_fatura_birlesik_cari`, `test_bulut_sevke_hazir`, `test_bulut_masraf_ozeti`, `test_bulut_karlilik_ozeti`, `test_bulut_ham_update`, `test_bulut_gelen_kutusu`, `test_bulut_tel_aynasi`, `test_bulut_hesap_kilitle`, `test_bulut_ozet_mutabakat`, `test_bulut_olay_gudumlu`, `test_telemetri_defter_degil`, `test_rapor_sunum_aynasi`, `test_db_invariants`

Bulut sunucusu: `test_rls_sizinti`, `test_izin_suzmesi`, `test_gelen_kutusu_claim`, `test_esitleme_idempotency`, `test_totp_zorunlu`, `test_rapor_istegi`, `test_saklama`, `test_kurulum_dizini`, `test_cihaz_kaydi`, `test_bildirim_kurallari`, `test_bildirim_cari_kilit`, `test_bildirim_gonderim`, `test_patron_kapilari`, `test_uzlastirma_kumesi`, `test_tazele_zili`, `test_web_sunumu`, `test_katalog_ozeti`, `test_liste_arama`, `test_kasa_kategori_suzgeci`, `test_bildirim_makbuz`, `test_hesap_kilitle_fabrika`, `test_hizmet_sonu`, `test_kimlik_silme`, `test_ip_saklama`, `test_destek_rolu`, `test_eposta_tekilligi`, `test_coklu_tesis`, `test_hesap_kendini_silme`, `test_yonetici_kurtarma`, `test_vekil_guveni`, `test_tesis_db_hazirlik`, `test_tesis_db_yalitimi`, `test_tesis_goc`, `test_compose_sirlari`, `test_degisim_sayaci`, `test_tesis_saati`, `test_guvenlik_bildirimi`, `test_kimlik_ozet_yenile`, `test_tesis_rol_hizasi`, `test_bildirim_patron_push`, `test_gizlilik_sayfasi`

Dağıtım (CI dışı): `deploy/patron/compose-denetle.mjs`, `deploy/patron/duman.sh`, `deploy/patron/tarayici-duman.cjs`, `scripts/build-aab.mjs`. Uçtan uca: `scripts/senaryo-patron.ts` (Senaryo P).

Uygulama (jest): `notifications.test.tsx`, `refresh.test.ts`, `mirror.test.ts`, `access.test.ts`, `cache.test.ts`, `client.test.ts`, `forms.test.ts`, `format.test.ts`, `ui.test.tsx`, `useRemote.test.tsx`, `changes.test.ts`, `session.test.tsx`, `web-path.test.ts`, `export.test.ts`, `native-push.test.tsx`, `native-push-izin.test.ts`, `account-deletion.test.tsx`, `taps.test.ts`, `picker.test.tsx`, `totp-qr.test.tsx`, `notification-test.test.tsx`, `factory-time.test.ts`, `factory-time-periods.test.ts`, `tokens.test.ts`, `kit.test.tsx`, `tabs.test.tsx`, `labels.test.ts`, `e1-pano.test.tsx`, `e2-siparis.test.tsx`, `e3-finans.test.tsx`, `diger.test.tsx`, `tutarlilik.test.ts`, `bildirim-izni.test.tsx`, `masraf-ozeti`, `karlilik-ozeti`, `kasa-kategori.test.tsx`; duman `scripts/duman.ts`.

Yeni bekçi doğduğu commit'te bu listeye VE haritanın `## patron-bulutu` bölümüne eklenir; katalog/tetikleyici değişince `test_db_invariants` da koşulur.

## Geçersiz kılınan kurallar — bunlara UYMA

- "Hesap başına TEK tesis; e-posta yalnız ETKİN hesapta tekil" → GEÇERSİZ 2026-10-15: tek kimlik, çok tesis.

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `docs/history/arsiv/2026-09.md` ve `2026-10.md` patron bulutu notları (B1–B6, I3/I6/I12, F1, PU, G19, tesis başına DB, tek kimlik, SWR); başlık listesi ayrıntı dosyasında.
