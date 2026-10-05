# Patron bulutu — tesis başına ayrı veritabanı

> **Durum:** kullanıcı kararı 2026-10-03 (tesis başına ayrı DB), kodlama onayı 2026-10-06. Plan `docs/plan/DEMOFABRIKA-KURULUM-BULGULARI.md` §B-6 (madde 5.1) ve §B-7 (madde 5.2, DEMO gönderici). Kural satırları `docs/kurallar/patron-bulutu.md` § Bulut sunucusu; hikâye `docs/history/arsiv/2026-10.md`. Önceki model (çok kiracılı tek DB + RLS) `docs/design/PATRON-BULUTU-ESITLEME.md` §9'da; o bölümün "tek DB" cümleleri bu belgeyle KISMEN GEÇERSİZ, RLS politikaları ikinci savunma olarak aynen kalır.
> **VDS uygulama adımları:** `docs/ops/PATRON-TESIS-DB-GECIS.md` (sabah kullanıcı onayıyla; o güne dek VDS'e hiçbir şey uygulanmaz).

## 0. Karar ve ölçüt

Rakip fabrikaların verisi aynı tablolarda durmaz. Aynı PostgreSQL sunucusunda her tesisin (fabrikanın) bulut verisi KENDİ veritabanındadır ve o veritabanına yalnız o tesisin DB kullanıcıları bağlanabilir. Tek patron API'si isteği, istekten (imza, oturum, davet) çözülen tesisin veritabanına yönlendirir. Asıl güvence DB + kullanıcı ayrımıdır; RLS (`app.tesis_id`, `app.projeksiyonlar`, `destek_kapisi`) her tesis DB'sinde ikinci savunma olarak kalır.

Bugün buluttaki tesis sayısı 0'dır (hazırlık tesisi imha edildi): taşınacak fabrika verisi yok. Mevcut ortak DB (`patron`) **merkez** olur: hesaplardan ve fabrika verisinden arınmış bir yönlendirme kataloğu tutar.

## 1. Topoloji ve adlandırma

| Veritabanı | Ad | İçerik |
|---|---|---|
| Merkez | mevcut DB (üretimde `patron`; yerelde `<ad>_test`) | yönlendirme kataloğu + imha tutanakları + imhada merkeze kopyalanan destek erişim kayıtları |
| Tesis | `<merkez>_t<onaltılık16>` (tesis kimliğinin ilk 16 onaltılık hanesi; ör. `patron_t3f2a…`) | o tesisin bütün bulut verisi (projeksiyonlar, hesaplar, oturumlar, gelen kutusu, raporlar, bildirimler, ayak izi, destek erişim kaydı) |

- Ad belirlenimlidir (aynı tesis → aynı ad) ⇒ hazırlık idempotenttir; çakışma `facility_databases.database_name UNIQUE` ile REDDEDİLİR (kendiliğinden düzeltme yok).
- Merkez adı en çok 38 karakterdir (rol adı `<tesis DB>_destek` PostgreSQL'in 63 karakter sınırını aşmasın); açılışta ölçülür.
- **Tek şema, tek göç zinciri:** merkez ve tesis DB'lerinin hepsi aynı `prisma/migrations` zincirini taşır. Hangi tablonun nerede YAŞADIĞINI yetkiler belirler (§2): merkezde tesis tablosuna, tesiste merkez tablosuna hiçbir çalışma rolünün yetkisi yoktur; o tablolar boş kalır ve bekçi boş olduklarını ölçer. Gerekçe: tek Prisma istemcisi, tek göç koşucusu, tek bekçi takımı; iki şema iki istemci ve iki ayrı yetki kataloğu demekti.

## 2. Tablo ayrımı

**Merkez** (`MERKEZ_TABLES`, `src/lib/db-grants.ts`):

| Tablo | Ne tutar | Kim yazar |
|---|---|---|
| `facility_databases` | tesis → DB adı, durum (`ISTENDI` · `HAZIR` · `IMHA_SURUYOR` · `IMHA_EDILDI`), şema sürümü (son göç adı), hazırlık kilidi (süreli claim), deneme sayısı + son hata, son göç anı + hatası, imha planı | hazırlayıcı + göç koşucusu + imha (göç rolü); eşitleme rolü YALNIZ `tesis_id` ile yeni satır (hazırlık isteği) |
| `installation_routes` | kurulum kimliği → tesis (değişmez) | kurulum kaydı (CLI) · satıcı iç API önbelleği (eşitleme rolü) |
| `login_routes` | e-posta özeti (HMAC-SHA256, anahtar `patron-tesis-db.key`) → tesis + hesap; yalnız ETKİN (AKTIF · KILITLI) hesabın e-postası | davet onayı (uygulama rolü); bayat satırı bakım siler |
| `facility_destructions` | imha tutanağı (değiştirilemez, silinemez) — tesis DB'si silindikten SONRA da kalır | imha (göç rolü) |
| `support_access` (arşiv kopyası) | imha edilen tesisin destek erişim kayıtları (silinemez kayıt imhada da kalır, Ek-6/B §3.2) | imha (göç rolü), kaynak tesis DB'sinden kopya |

Merkezde e-posta, ad, parola, TOTP ya da fabrika verisi DURMAZ; e-posta yalnız anahtarlı özet olarak yönlendirme satırındadır.

**Tesis** (`TESIS_TABLES` = `CLOUD_TABLES` − merkez tabloları): `facilities` (tesisin kendi kaydı: ad, saklama, durum, hizmet bitişi) · `installations` (açık anahtar + eşitleme hakkı) · `accounts` · `sessions` · `account_audit` · `operation_receipts` · `inbox_messages` · `report_requests` · `report_results` · `push_devices` · `notification_defaults` · `notification_preferences` · `notifications` · `projection_rows` · `sync_watermarks` · `package_receipts` · `sync_state` · `full_sync_runs` · `request_nonces` · `support_access`.

`facilities` ve `installations` tesis DB'sindedir: bir tesis işinin tx'i kendi tesisinin olgularını (hizmet aşaması, hak) AYNI tx'te okur; merkez yalnız "bu kimlik hangi DB'de" sorusunu cevaplar. Merkez satırı ile tesis satırı arasında çift yazım yalnız yönlendirme satırlarındadır (kurulum → tesis değişmez; e-posta özeti bayatlarsa zararsızdır, §6).

## 3. Roller ve parolalar

| Rol | Ad | Bağlandığı yer | Özellik |
|---|---|---|---|
| göç | küme yöneticisi (üretimde `patron_goc`) | merkez + her tesis DB'si | tablo sahibi; yalnız göç koşucusu, hazırlayıcı, satıcı CLI'si, yedek. Sunucu ALMAZ |
| merkez uygulama · eşitleme | bugünkü `DATABASE_URL` · `ESITLEME_DATABASE_URL` rolleri | YALNIZ merkez | yalnız merkez tablolarına yetki (`MERKEZ_APP_GRANTS` · `MERKEZ_SYNC_GRANTS`) |
| tesis uygulama | `<tesis DB>_uyg` | YALNIZ kendi tesis DB'si | `APP_GRANTS` (bugünkü uygulama rolü yetkileri, tesis tablolarında) |
| tesis eşitleme | `<tesis DB>_esit` | YALNIZ kendi tesis DB'si | `SYNC_GRANTS` |
| tesis destek | `<tesis DB>_destek` | YALNIZ kendi tesis DB'si | göç NOLOGIN kurar (`current_database() || '_destek'`); `SUPPORT_GRANTS`; giriş runbook'la |

- Tesis çalışma rolleri `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`; DB'ye bağlanma PUBLIC'ten geri alınır, yalnız o tesisin iki rolüne verilir ⇒ A'nın rolü B'nin DB'sine BAĞLANAMAZ (PostgreSQL CONNECT yetkisi).
- **Parola saklanmaz, türetilir:** `parola = HMAC-SHA256(anahtar, "tesis-rol-parolasi\0" + rol adı)` (onaltılık). Anahtar `ANAHTAR_DIZINI/patron-tesis-db.key` (32 bayt, 0600; üretimde salt okunur birimde ÖNCEDEN üretilir — runbook). Sunucu ve hazırlayıcı aynı anahtardan aynı parolayı türetir; DB'de, günlükte, ortamda parola YOKTUR. Anahtar sızarsa ya da değişirse `tesis-db goc` (hizalama dahil) bütün rol parolalarını yeni anahtarla yeniden yazar; giriş dizini de aynı komutla yeniden kurulur (§6). Anahtar kaybı veri kaybı değildir.
- Aynı anahtar e-posta özetinin de anahtarıdır (alan ayrımlı HMAC).

## 4. İstek yönlendirme (`src/lib/tesis-db.ts`)

Servislerin DB'ye tek yolu `lib/tenant.ts`dir (`withTesis` · `withLookup` · tesis listesi); hepsi artık bir **yönlendirici** (`TesisDbRouter`, rol başına bir tane: uygulama · eşitleme · göç) alır, düz `PrismaClient` almaz (tip düzeyinde kapalı).

- **`withTesis(router, {tesisId,…})`** → `facility_databases` satırı (merkez, `TESIS_DIZIN_ONBELLEK_SN` = 30 sn önbellek) → DB adı → rolün tesis istemcisi. Satır yok → 404 `BULUNAMADI` (merkeze DÜŞMEZ); `ISTENDI` → 503 `TEKRAR_DENEYIN` (fabrika zaten yeniden dener); `IMHA_*` → 404; şema sürümü sunucunun beklediği son göç değil → 503 `TEKRAR_DENEYIN` ("tesis bakımda").
- **Kimlik kaynakları** (kiracı gövdeden ALINMAZ — değişmez):
  - fabrika kanalı: imzalı isteğin kurulum kimliği → `installation_routes` → tesis;
  - giriş: e-posta özeti → `login_routes` → tesis;
  - oturum ve davet belirteci: belirtecin ön eki tesis kimliğidir (`<tesis 22 hane base64url>.<rastgele 43>`), özet belirtecin TAMAMINDAN alınır ⇒ ön eki değiştirilmiş belirteç başka tesiste hiçbir satırla eşleşmez (401);
  - bakım/bildirim döngüsü: `facility_databases` `HAZIR` listesi.
  Çözülemeyen kimlik sorgusuz `null` döner (giriş 401, kanal 401 `KURULUM_BILINMIYOR`).
- **DB bağı denetimi:** hazırlayıcı her tesis DB'sine `ALTER DATABASE … SET app.veritabani_tesisi = '<tesis>'` yazar (merkeze `merkez`). Her tx'in İLK ifadesi (kiracı ayarı + kilit ile AYNI SELECT) bu değeri okur; kapsamın tesisinden farklıysa tx hiçbir sorgu koşmadan düşer. Böylece dizin bozulsa bile A'nın kapsamı B'nin DB'sinde açılamaz (üçüncü katman: CONNECT yetkisi + parola + bağ denetimi).
- **Havuz:** rol başına merkez havuzu (en çok 4 bağlantı) + tesis başına küçük havuz (`TESIS_HAVUZ_EN_FAZLA` = 3, boşta 30 sn'de kapanır); tesis istemcileri LRU (`TESIS_ISTEMCI_EN_FAZLA` = 24; Prisma istemcisi başına ~3,5 MB RSS ölçüldü, ilki ~70 MB). Bağlantı tavanı: `max_connections` ≥ 2 × 4 (merkez) + 2 × 3 × eşzamanlı etkin tesis + göç/yedek payı (bugünkü 40 → ~5 eşzamanlı tesis; tesis sayısı büyüyünce yükseltilir).

## 5. Hazırlık (`src/lib/tesis-db-hazirlik.ts`) — atomik, idempotent, yarım kalan tamamlanır

Durum makinesi `facility_databases.status`: `ISTENDI → HAZIR` (imha: `HAZIR → IMHA_SURUYOR → IMHA_EDILDI`). Adımlar her koşumda baştan, hepsi idempotent:

1. **Claim** (atomik): `UPDATE … SET claim_owner, claim_until = now()+10 dk WHERE tesis_id AND status='ISTENDI' AND (claim_until IS NULL OR claim_until < now())` — sayı 0 ise başka hazırlayıcı çalışıyor, dokunulmaz. Çöken hazırlayıcının claim'i süre dolunca devralınır.
2. Rol: `<db>_uyg` · `<db>_esit` yoksa CREATE, varsa ALTER (özellikler + türetilmiş parola).
3. DB: `pg_database`de yoksa `CREATE DATABASE` (yarışta "zaten var" hatası var sayılır); `REVOKE CONNECT … FROM PUBLIC`, `GRANT CONNECT` iki role, `ALTER DATABASE … SET app.veritabani_tesisi`.
4. Göç: tesis göç koşucusu (§7) — eksik göçleri sırayla uygular.
5. Yetki: `APP_GRANTS`/`SYNC_GRANTS` (+ kolon yetkileri) tesis rollerine, `SUPPORT_GRANTS` destek rolüne (bugünkü `db-rolleri.ts` mantığı, DB parametreli).
6. **Bitiş** (atomik, yalnız claim hâlâ bizdeyse): `status='HAZIR'`, `schema_version`, `ready_at`.
Hata: claim bırakılır, `attempts+1`, `last_error` (kısa, sırsız), `next_attempt_at` = artan bekleme; durum `ISTENDI` kalır.

**Kim tetikler:**
- `KURULUM_KAYNAGI=kayit`: satıcı CLI'si `tesis-ac` hazırlığı EŞZAMANLI koşar (göç rolü elinde), sonra tesis kaydını yazar.
- `KURULUM_KAYNAGI=satici` (üretim): satıcının bildirdiği yeni tesisin ilk imzalı isteğinde sunucu (eşitleme rolü) `facility_databases`e yalnız `tesis_id` yazar (`INSERT … ON CONFLICT DO NOTHING`) ve 503 `TEKRAR_DENEYIN` döner; **hazırlayıcı servisi** (`patron-hazirla`, aynı imajdan `tesis-db izle`) `ISTENDI` satırlarını 10 sn'de bir yoklar ve hazırlar; fabrikanın bir sonraki turunda tesis hazırdır. Sunucu CREATE DATABASE/CREATE ROLE yetkisi ve göç parolası ALMAZ (değişmez korunur).

## 6. Giriş dizini (`login_routes`)

- Satır yalnız davet onayında (DAVETLI → AKTIF) yazılır; merkez tx'inin İLK ifadesi e-posta özeti başına advisory kilittir (uzay 9204 `LOGIN_ROUTE`). Satır başka (tesis, hesap) gösteriyorsa o hesap kendi tesis DB'sinde hâlâ ETKİN mi sorulur: etkinse 409 `DAVET_ETKINLESTIRILEMEDI` (hangi tesiste olduğu söylenmez); değilse (bayat) satır bu hesaba devredilir. Ardından tesis tx'i (kilit `ACCOUNT_ADMIN`) hesabı AKTİF yapar; claim tutmazsa dizin satırı geri alınır. Kilit sırası sabittir: önce merkez `LOGIN_ROUTE`, sonra tesis `ACCOUNT_ADMIN` — tersini alan yol yok (DB'ler arası kilitlenmeyi PostgreSQL göremez).
- E-postanın bulut genelinde yalnız etkin hesapta tekilliği böylece merkezde, tesis içinde PASİF olmayan hesapta tekilliği tesis DB'sindeki kısmi indekste sağlanır.
- Hesap etkinlikten çıkınca (arşiv, sıfırlama, yeniden davet) satır hemen silinmez: giriş satırı izleyip tesis DB'sinde ETKİN hesap bulamazsa aynı 401'i verir. Bakım, hedefi etkin olmayan satırı siler (budama beyanı `login_routes`); kimliği silinen hesabın satırı en geç kimlik silmesinde gider.
- Anahtar değişince `tesis-db goc` dizini tesis DB'lerindeki etkin hesaplardan yeniden kurar.

## 7. Göç koşucusu (`src/lib/tesis-goc.ts`, CLI `scripts/tesis-db.ts goc`)

- **Merkez:** `prisma migrate deploy` (bugünkü gibi, Prisma CLI) + `db-rolleri.ts` (merkez yetkileri).
- **Tesis DB'leri:** `HAZIR` (ve göçü yarım kalmış) her tesis için SIRAYLA ve AYRI AYRI: eksik göçleri uygular, rolleri/yetkileri hizalar, sonucu `migrated_at` / `migration_error` / `schema_version`a yazar. Bir tesisin hatası sonrakileri DURDURMAZ; sonunda tesis başına rapor basılır, en az bir hata varsa çıkış kodu 1.
- Tesis koşucusu Prisma CLI'sini çağırmaz (CLI başına ~220 MB RSS ölçüldü; hazırlayıcının 96 MB bütçesine sığmaz): `_prisma_migrations` defterini Prisma'nın kendi biçimiyle yazar — aynı tablo, aynı sağlama (`migration.sql`in SHA-256'sı; ölçüldü: Prisma'nın yazdığıyla bayt-eşit), aynı advisory kilit (72707369), göç başına tek basit sorgu (örtük tx), başarısız göçte `finished_at` boş + `logs` dolu ⇒ sonraki koşum o DB'yi `prisma migrate resolve` gelene dek ATLAR (Prisma P3009 davranışı). Bekçi: koşucunun hazırladığı tesis DB'sinde `prisma migrate status` "güncel" der ve şema (tablo · kolon · indeks · politika · tetikleyici · fonksiyon) Prisma'nın göç ettiği merkezle birebirdir.
- Sunucu, beklediği şema sürümünü (son göç dizini adı) açılışta okur; şeması geride kalan tesise istek yönlendirmez (503) — göçü başarısız tesis tek başına bakıma düşer, öteki tesisler çalışır.

## 8. Yedek, dışa aktarma, imha

- **Yedek** (`deploy/patron/yedek-dongusu.sh`): merkez dökümü (`patron_<damga>.dump.tkenc`) + HER `HAZIR` tesis için ayrı döküm (`tesis_<tesisId>_<damga>.dump.tkenc`); tek tesisin geri yüklemesi yalnız o DB'ye yapılır (`pg_restore --no-owner --no-acl -d <tesis DB>`, ardından `tesis-db goc` yetkileri hizalar). Budama dosya türü + tesis başına; imha edilmiş tesisin dökümleri "en az N kopya" kuralından muaftır ⇒ 30 gün içinde (Ek-6/A §4.4, `BACKUP_CLEAR_DAYS` 35) yedekten de düşer. `yedek-dongusu.sh tesis <tesisId>` tek tesisin anlık yedeğini alır.
- **Dışa aktarma** (`GET /api/disa-aktar…`): değişmedi — her okuma `withTesis` yönlendirmesiyle oturumun tesis DB'sinden gelir; başka tesisin satırı fiziksel olarak o DB'de yoktur.
- **İmha** (`scripts/tesis.ts imha`, kuru koşum varsayılan; aşama kapısı aynen): `HAZIR → IMHA_SURUYOR` claim'i (yönlendirme durur) → tesis rollerinin CONNECT'i geri alınır, açık bağlantıları kesilir → tablo başına sayım (`DESTRUCTION_STEPS`, tutanak verisi) planla birlikte merkeze yazılır → destek erişim kayıtları merkeze kopyalanır → `DROP DATABASE … WITH (FORCE)` + tesis rolleri düşer → tutanak (`facility_destructions`, plandaki kimlikle — tekrar koşum ikinci tutanak yazmaz) + yönlendirme satırları (`installation_routes`, `login_routes`) silinir → `IMHA_EDILDI`. Yarıda kalan imha aynı komutla kaldığı yerden tamamlanır. Bugünkü "tablo tablo silme" kalkar: veri DB'yle birlikte gider, kalıntı süpürmesi gerekmez.

## 9. RLS'in yeri

Bütün politikalar (`tesis_yalitimi`, `izinli_projeksiyon`, arama anahtarlı SELECT politikaları, `destek_kapisi`) tesis DB'lerinde aynen durur ve `withTesis` ilk ifadede `app.tesis_id`/`app.projeksiyonlar`ı yazmayı sürdürür. Görevleri: (a) "sipariş görür, tutar görmez" alan izni — bu DB ayrımının konusu DEĞİL, RLS'in asıl işi olarak kalır; (b) tesis içinde ayarsız bağlantının sıfır satırı; (c) DB ayrımı bir hatayla delinirse ikinci savunma. Merkez yönlendirme tabloları kiracı verisi değildir, RLS taşımaz; çalışma rollerinin merkezdeki yetkisi yalnız onlardır.

## 10. Compose / VDS etkisi

- Yeni servis **`patron-hazirla`** (sunucu imajı, `node dist-cli/scripts/tesis-db.js izle`): göç parolası + tesis rol anahtarı, yalnız `ic` ağı, dinleyici YOK; bellek 96m / CPU 0,25 / süreç 50.
- **Bütçe:** uzun ömürlü servislerin bellek tavanı toplamı 1024 MiB → 1120 MiB (sunucu 512 · DB 384 · yedek 128 · hazırlayıcı 96). KARAR (2026-10-06, 1e) ile kabul edildi (§13 madde 1); compose denetimi ③ yeni tavanı ölçer.
- Yeni sır **`tesis_rol_anahtari`** (`patron-tesis-db.key`; root:SIR_GID 0440): sunucu + `patron-goc` + `patron-hazirla`. Yedek konteyneri almaz (anahtar kaybı veri kaybı değil, §3).
- `patron-goc` komutu: `migrate deploy` (merkez) + `db-rolleri` (merkez) + `tesis-db goc` (tesis DB'leri). Satıcı CLI'si aynı konteynerden.
- Yedek döngüsü tesis başına döküm alır (§8).
- `max_connections` 40 kalır (bugün tesis 0); tesis sayısı 5'i geçince yükseltme runbook adımıdır.

## 11. Sözleşme etkisi — eski istemci ne yapar

- **Oturum/davet belirteci biçimi değişti** (43 → 66 karakter, tesis ön ekli). Eski biçim 401'dir. Bugün buluta bağlı hesap yok (tesis 0) ⇒ kimse oturumdan düşmez; patron uygulaması belirteci opak saklar (biçim denetimi yok, ölçüldü), değişiklik gerektirmez.
- **Fabrika kanalı:** tel şeması değişmedi. Yeni tesisin ilk isteği bir kez 503 `TEKRAR_DENEYIN` alabilir; fabrika istemcisi 5xx'te zaten yeniden dener (eski davranış aynen). adnansahin'in patron bulutuyla bağı yok.
- `minVersion` değişmez.

## 12. Bekçiler

- `test_tesis_db_yalitimi` (yeni): A'nın rolü B'nin DB'sine bağlanamaz · A'nın kapsamı B'nin DB'sinde açılamaz (bağ denetimi) · A'nın belirteci/kurulumu/e-postası B'ye yönlenmez · çözülemeyen tesis merkeze düşmez (4xx) · merkezde tesis tablosu, tesiste merkez tablosu boş ve yetkisiz · negatif sondalar: yetki genişletilince ve bağ denetimi kapatılınca kırmızı.
- `test_tesis_db_hazirlik` (yeni): idempotent ikinci koşum · yarıda kalan hazırlık (rol var, DB yok / DB var, göç yarım) tamamlanır · claim yarışında tek hazırlayıcı · satıcı kipinde ilk istek 503 + `ISTENDI`.
- `test_tesis_goc` (yeni): koşucu ↔ Prisma uyumu (`migrate status` güncel, şema birebir) · bir tesisin göç hatası öteki tesisi durdurmaz ve raporlanır · şeması geride tesis 503.
- `test_rls_sizinti`, `test_destek_rolu`, `test_hizmet_sonu`, `test_eposta_tekilligi`, `test_patron_kapilari` tesis DB'si üzerinden yeniden kurulur.

## 13. KARAR'lar

1. **KARAR (2026-10-06, 1e): KABUL.** **Bellek bütçesi 1 GiB → 1120 MiB** (yeni küçük `patron-hazirla` hizmeti için; sunucu asla DB yönetici yetkisi almaz). Alternatif: hazırlayıcıyı ayrı servis yerine elle/cron ile koşmak — "kendiliğinden hazırlanır" kararını bozar.
2. **KARAR (2026-10-06, 1e): KABUL.** **Merkezde e-posta yalnız anahtarlı özet.** Alternatif: düz e-posta (dizin yeniden kurulumu gerekmez ama merkez kişisel veri taşır).
3. **KARAR (2026-10-06, 1e): KABUL.** **Tesis rol parolası türetilir, saklanmaz** (tek anahtar). Alternatif: rastgele parola + şifreli saklama (anahtar yine gerekir, ek tablo ve döndürme işi).
