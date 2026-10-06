# patron/sunucu — TeksERP patron bulutu sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter semantiği, atomik claim, advisory kilit tx'in ilk ifadesi, fail-closed kapı, `details.code`, TR mesaj, sır hijyeni, audit yalnız ayak izi). Plan: Patron bulutu (Plan B, dilim B2). Sözleşme: `docs/design/PATRON-BULUTU-ESITLEME.md` (§6 paket · §7 rapor · §8 gelen kutusu · §9 bulut veri modeli + RLS · §10 izin kataloğu · §17 B2 uygulama notları). Alan kuralları: `docs/kurallar/patron-bulutu.md`.
> Burada patron sunucusunun HER değişikliğinde geçerli çekirdek durur; alt-alan kuralları § Alt-alan kuralları işaretlerinde, anlatım · komut · ortam `patron/sunucu/MIMARI.md`'de, bekçiler `Teks-Erp/docs/BEKCI-HARITASI.md` § patron-bulutu.

## Amaç

Patronun buluttaki OKUMA KOPYASI ve TEK yazma kanalı. **Bulut hesap yapmaz, fabrika tek yazardır:** fabrika (`Teks-Erp/src/cloud-sync/`, B1) projeksiyonları hesaplayıp imzalı paketle gönderir; bulut saklar, izinle süzer, gösterir. Yazma (sipariş/cari) bir MESAJdır: gelen kutusuna düşer, fabrika çeker ve kendi normal servis yolundan yazar (B3). Patron uygulaması (iOS/Android/web, B4) yalnız bu sunucunun `/api/*`sine konuşur; fabrikaya hiç bağlanmaz.

## Katmanlar

| Katman | Yer | Kural |
|---|---|---|
| Protokol | `src/lisans-protokol/` | `Teks-Erp/src/lib/license/protocol/` klasörünün **BAYT-EŞİT aynası**; burada düzenlenmez (bekçi `Teks-Erp/scripts/test_lisans_protokol_aynasi.ts` + `test_patron_kapilari` §7) |
| Tel şeması | `src/wire/esitleme.ts` | Paket zarfı, gelen kutusu/rapor istek-yanıtları, mesaj gövdeleri, satıcı iç API yanıtı — istek KATI, yanıt GEVŞEK. Sözleşme §6–§8 |
| Katalog | `src/catalog/` | İzin kataloğu (`permissions.ts`, süper yetki YOK, `bulut:oturum` örtük) · projeksiyon → izin eşlemesi (`projections.ts`; alt satır `.finans`/`.kisisel`; kökte yasak alan; saklama tarihi alanı; ebeveyn) · rapor anahtarı → izin (`reports.ts`; rapor BAŞINA, fabrikanın `REMOTE_REPORTS`iyle birebir; sonuç RLS adı `rapor.<aile>-<ad>`; audit ve kişi adlı rapor buluttan istenemez). Eşlenmeyen ad RED |
| Kiracı | `src/lib/tenant.ts` | `app.*` oturum ayarlarının TEK yazarı: her tx'in İLK ifadesi tek SELECT'te `set_config(tesis) + set_config(projeksiyonlar) + arama anahtarlarını sıfırla + (varsa) advisory kilit`. Kipler: `withTesis` · `withLookup` (giriş e-postası · oturum özeti · davet özeti · kurulum kimliği; kiracı = sıfır UUID) · `withMaintenanceList` |
| Servis | `src/services/` · `src/auth/` | Durum geçişi atomik claim; claim kuyruğu `WITH … FOR UPDATE SKIP LOCKED` CTE (IN-altsorgu LIMIT'i aşar — ölçüldü); işlem kimliği tek boğaz `lib/idempotency.ts` |
| HTTP | `src/http/` | Tek dinleyici: `/v1/*` fabrika kanalı (kurulum imzalı, HAM gövde ≤ 4 MB, gzip açılır ≤ 32 MB; eşitleme rolü) + `/api/*` hesap API'si (Bearer oturum, yazma yalnız JSON; uygulama rolü; rota TABLOSU veridir) |
| Şema | `prisma/` | Model/kolon İngilizce snake_case, kod değerleri Türkçe; her tabloda `tesis_id` + RLS ENABLE + FORCE (migration SQL); CHECK'ler çift yüklemi DB'de de sedder (AKTİF hesap TOTP'siz doğamaz) |

## Merkez DB + tesis başına DB — roller

- **Merkez DB** (`DATABASE_URL`ın veritabanı): yalnız yönlendirme ve yaşam döngüsü tabloları — `facility_databases` (durum `ISTENDI|HAZIR|IMHA_SURUYOR|IMHA_EDILDI`) · `installation_routes` (kurulum → tesis) · `login_routes` (e-posta özeti → tesis) · `facility_destructions` · `support_access` (`db-grants.ts` `MERKEZ_TABLES`). **Tesis DB'si** `<merkez>_t<tesis kimliğinin ilk 16 onaltılık hanesi>` (`lib/tesis-db-ad.ts`; ad kimlikten TÜRETİLİR, satırdan okunmaz) kiracı verisini taşır. Tek şema, tek göç zinciri her DB'de; tablonun nerede yaşadığını yetkiler belirler (merkezde tesis tablosu, tesiste merkez tablosu boş ve yetkisiz — bekçi ölçer). Yönlendirici `lib/tesis-db.ts`; satır yoksa 404, `ISTENDI` ya da şeması geride tesis 503 `TEKRAR_DENEYIN`.
- **Göç rolü** (`GOC_DATABASE_URL`, tablo sahibi): merkezde `prisma migrate deploy` + `scripts/db-rolleri.ts`, tesislerde `scripts/tesis-db.ts goc` (Prisma CLI'siz koşucu `lib/tesis-goc.ts`, bir tesisin hatası ötekini durdurmaz), hazırlayıcı ve satıcı CLI'si. Sunucu bu rolle BAĞLANMAZ.
- **Tesis rolleri** `<tesis DB>_uyg` (uygulama) ve `<tesis DB>_esit` (eşitleme): LOGIN NOSUPERUSER NOBYPASSRLS, tablo sahibi değil; yetkileri tek kaynak `src/lib/db-grants.ts` (tablo + `*_COLUMN_GRANTS` kolon düzeyi) — uygulama rolü projeksiyona YAZAMAZ, eşitleme rolü hesap/oturum tablosunu OKUYAMAZ (tek istisna: gelen kutusu claim'inin `accounts` kolon düzeyi SELECT'i). Parola DİSKTE tutulmaz, `tesis_rol_anahtari` sırrından (`ANAHTAR_DIZINI/patron-tesis-db.key`; üretimde `TESIS_ROL_ANAHTARI_DOSYASI`) HMAC ile türetilir; anahtar kaybı = her tesis rolünün parolası kaybı, yedeği emanettedir. Sunucu açılışta rolleri ölçer: RLS'i atlayabilen rolle KALKMAZ.
- **Hazırlık:** `patron-hazirla` servisi (`scripts/tesis-db.ts izle`, göç rolüyle, yalnız iç ağ) `ISTENDI` satırlarını yoklar: claim → rol → DB (`CONNECT` yalnız tesis rollerine) → göç → yetkiler → `HAZIR`. `tesis-db.ts hazirla --tesis=<uuid>` tek tesisi eşzamanlı kurar; `patron-goc` zinciri `migrate deploy && db-rolleri && tesis-db goc`. Sunucu hazırlayıcıyı import ETMEZ. Her DB'ye hazırlayıcı `app.veritabani_tesisi` yazar (merkezde `merkez`); tx'in ilk ifadesi bu işareti ölçer.
- Tesis DB'sinde de `app.tesis_id` ayarsız/sıfırlanmış bağlantıda sorgu HATA verir (fail-closed) ve RLS + `app.projeksiyonlar` RESTRICTIVE politikası aynen geçerlidir ("sipariş görür, tutar görmez"); `*` projeksiyon YASAK. Yeni tablonun yetkisi `db-grants.ts`e AYNI dilimde girer — girmezse roller erişemez.
- **Destek rolü** `<tesis DB>_destek` (merkezde `patron_destek`; Ek-6/B §3.2): sunucu bu rolle BAĞLANMAZ — Lisans Veren çalışanının doğrudan destek sorgusu içindir. Göç NOLOGIN kurar, `db-rolleri.ts` ve hazırlayıcı yetkisini `SUPPORT_GRANTS`ten verir (yalnız SELECT, sır kolonları hariç); çalıştırabildiği fonksiyonlar `SUPPORT_FUNCTIONS` beyanıdır. Kapı GUC DEĞİLDİR: okunabilir her tabloda RESTRICTIVE `destek_kapisi`; izin yalnız `destek_ac(...)` (SECURITY DEFINER, ≤ 480 dk) ile açılır ve silinemeyen `support_access` kaydına yazılır; `destek_kapat()` kapatır.
- **İmha:** `HAZIR → IMHA_SURUYOR` claim → tesis rollerinin bağlantısı kesilir → sayım planı merkeze → `DROP DATABASE` + roller → tutanak; yedek tesis başına alınır. Ayrıntı: `docs/ops/PATRON-TESIS-DB-GECIS.md`, `docs/design/PATRON-TESIS-DB.md`.

## Advisory kilit envanteri (patron DB'si — backend 80xx ve satıcı 91xx'ten bağımsız)

Kilit tx'in İLK ifadesidir ve kiracı ayarıyla AYNI SELECT'te alınır (`lib/tenant.ts`); bir tx tek kilit alır (merkez tx'i ile tesis tx'i ayrı bağlantıdır; sıra önce `LOGIN_ROUTE` sonra `ACCOUNT_ADMIN`). Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; bu tablo onunla birebir (bekçi `scripts/test_patron_kapilari.ts` §1).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9201 | `PACKAGE` | tesis başına eşitleme paketi — `try`: doluysa 409 `PAKET_ISLENIYOR` (fabrika bekleyip tekrar dener) |
| 9202 | `ACCOUNT_ADMIN` | tesis başına hesap yönetimi: davet · izin · kilit · arşiv · sıfırlama · davet kabul/onay (son yönetici kuralı) |
| 9203 | `CLIENT_TOKEN` | (tesis, işlem kimliği) başına: gelen kutusu mesajı · rapor isteği · cihaz kaydı tekrarları sıraya girer |
| 9204 | `LOGIN_ROUTE` | MERKEZ DB'sinde, e-posta özeti başına giriş dizini yazımı (davet onayı); hesap kilidinden ÖNCE alınır |

## Alt-alan kuralları — dokunmadan önce oku

- **Kurulum kaydı** — bu bölüme dokunmadan önce oku: `docs/kurallar/patron-bulutu.md` § Patron sunucusu — Kurulum kaydı
- **Hizmet aşaması** — bu bölüme dokunmadan önce oku: `docs/kurallar/patron-bulutu.md` § Patron sunucusu — Hizmet aşaması
- **Hesaplar** — bu bölüme dokunmadan önce oku: `docs/kurallar/patron-bulutu.md` § Patron sunucusu — Hesaplar
- **Bildirimler (B5)** — bu bölüme dokunmadan önce oku: `docs/kurallar/patron-bulutu.md` § Patron sunucusu — Bildirimler (B5)

## Budama beyanı (telemetri + okuma kopyası)

Yaşa göre silinen tablolar YALNIZ `src/services/maintenance.ts` `PRUNED_TABLES` (bekçi `test_patron_kapilari` §4 iki yönlü ölçer; tesis imhasının silmeleri ayrı beyanlı dosyada, § Hizmet aşaması): `projection_rows` (tesisin saklama süresi — 3 · 13 · 25 ay · tümü, varsayılan 13 — kökü düşen kaydın alt satırı ve kalemiyle; 7 günden eski mezar taşı) · `request_nonces` · `package_receipts` · `full_sync_runs` · `report_results` · `report_requests` · `inbox_messages` (sonuçlanmış; asıl kayıt fabrikada) · `sessions` · `operation_receipts` · `account_audit` (ayak izi: başarısız giriş 90 gün, diğerleri 730 gün) · `notifications` (sonuçlanmış bildirim, `BILDIRIM_SAKLAMA_GUN` = 90) · `push_devices` + `sessions` (kimliği silinen hesabınki). Hiçbiri fabrikanın defteri değildir; iş kararı bunlardan okunmaz. Başka her silme yasak; hesap soft (durum; PASIF terminal) ve cihaz soft (`active`).

**Yaşa göre silinen ALAN** (satır kalır) YALNIZ `maintenance.ts` `AGED_FIELDS` (bekçi `test_patron_kapilari` §8 iki yönlü): giriş olaylarının istemci adresi `account_audit.summary.ip` → 30 gün (`IP_RETENTION_DAYS`, koddadır; Ek-6/A §2.4 erişim/IP kaydı). Uygulama IP'yi başka hiçbir yerde saklamaz: erişim günlüğü satırı `[patron] <yöntem> <yol> <durum> <ms>`dir (IP ve sorgu dizgisi yok), hız sınırı adresi bellekte 60 sn tutar, giriş kilidi hesap + kaynak çiftini yalnız süreç anahtarlı özetle `KILIT_DK` boyunca bellekte tutar; istemci adresi yalnız HTTP katmanında (`http/rate-limit.ts` `clientAddress`) okunur. Uygulama rolünün `account_audit` UPDATE yetkisi tablo düzeyinde YOKTUR: yalnız `summary` kolonunda (kolon düzeyi, `APP_COLUMN_GRANTS`) ve yalnız bu alan silmesi içindir — olay, aktör, zaman yazılamaz (bekçi `test_rls_sizinti` §5d · `test_patron_kapilari` §8g).

**Kapanan hesabın kimliği (Ek-6/A §2.5):** PASIF geçişi kapanış anını (`accounts.closed_at`) AYNI claim'de yazar (CHECK: PASIF ⇔ dolu); bakım tiki (`purgeClosedIdentities`, `IDENTITY_PURGE_DAYS` = 30, koddadır) kapanıştan 30 gün sonra, `ACCOUNT_ADMIN` kilidiyle ve hesap başına atomik claim'le ad/e-postayı tombstone'a (`Silinmiş hesap #<8>` · `silinmis-<id>@hesap.invalid`), parola/TOTP/davet/kilit sayaçlarını NULL'a çeker, oturumları ve cihaz anahtarlarını siler, gelen kutusu yazar adını ve işlem makbuzlarının yanıtındaki kimlik alanlarını (hesap görünümünün ad/e-postası, gelen kutusu yazar adı) tombstone yapar — makbuz, işlem kimliği ve gövde özeti KALIR, aynı işlem kimliği tombstone'lu saklı yanıtı alır (uygulama rolü makbuzda yalnız `response` kolonunu güncelleyebilir; başka yazan `test_patron_kapilari` §8e'de kırmızı); satır, kimlik, durum ve izinler kalır (CHECK: kimliği silinmiş hesap sır taşımaz). Arşivdeki hesap düzenlenemez (409). Ayak izi `HESAP_KIMLIGI_SILINDI` (kategori + sayı; kimlik içeriği yok).

Audit istisnaları (beyanlı sınıflar): fabrika kanalı yazımları (paket makbuzu kendi kaydıdır — sistem işi) · bakım işi (sistem işi) · oturum dokunuşu (telemetri). Hesap CUD'u, davet, giriş/çıkış, gelen kutusu/rapor yazımı/iptali, cihaz kaydı `account_audit`e düşer.

## Komutlar

```bash
cd patron/sunucu
npx prisma migrate deploy && npx prisma generate && npx tsx scripts/db-rolleri.ts   # migrate dev/reset YASAK
npm run typecheck:scripts && npm run lint        # commit kapısı altıncı proje olarak aynısını ölçer (tip + eslint + lint-baseline.json tavanı)
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `GOC_DATABASE_URL` · `DATABASE_URL` (uygulama rolü) · `ESITLEME_DATABASE_URL` (eşitleme rolü) — üçü AYNI `_test` DB'yi, ÜÇ AYRI rolle gösterir (`tekserp_fabrika_*` ASLA). Tesis CLI'leri, tam ortam listesi, CI: `patron/sunucu/MIMARI.md` § Komutlar.
