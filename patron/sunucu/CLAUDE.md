# patron/sunucu — TeksERP patron bulutu sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter semantiği, atomik claim, advisory kilit tx'in ilk ifadesi, fail-closed kapı, `details.code`, TR mesaj, sır hijyeni, audit yalnız ayak izi). Plan: Patron bulutu (Plan B, dilim B2). Sözleşme: `docs/design/PATRON-BULUTU-ESITLEME.md` (§6 paket · §7 rapor · §8 gelen kutusu · §9 bulut veri modeli + RLS · §10 izin kataloğu · §17 B2 uygulama notları). Alan kuralları: `docs/kurallar/patron-bulutu.md`.

## Amaç

Patronun buluttaki OKUMA KOPYASI ve TEK yazma kanalı. **Bulut hesap yapmaz, fabrika tek yazardır:** fabrika (`Teks-Erp/src/cloud-sync/`, B1) projeksiyonları hesaplayıp imzalı paketle gönderir; bulut saklar, izinle süzer, gösterir. Yazma (sipariş/cari) bir MESAJdır: gelen kutusuna düşer, fabrika çeker ve kendi normal servis yolundan yazar (B3). Patron uygulaması (iOS/Android/web, B4) yalnız bu sunucunun `/api/*`sine konuşur; fabrikaya hiç bağlanmaz.

## Katmanlar

| Katman | Yer | Kural |
|---|---|---|
| Protokol | `src/lisans-protokol/` | `Teks-Erp/src/lib/license/protocol/` klasörünün **BAYT-EŞİT aynası**; burada düzenlenmez (bekçi `Teks-Erp/scripts/test_lisans_protokol_aynasi.ts` + `test_patron_kapilari` §7) |
| Tel şeması | `src/wire/esitleme.ts` | Paket zarfı, gelen kutusu/rapor istek-yanıtları, mesaj gövdeleri, satıcı iç API yanıtı — istek KATI, yanıt GEVŞEK. Sözleşme §6–§8 |
| Katalog | `src/catalog/` | İzin kataloğu (`permissions.ts`, süper yetki YOK, `bulut:oturum` örtük) · projeksiyon → izin eşlemesi (`projections.ts`; alt satır `.finans`/`.kisisel`; kökte yasak alan; saklama tarihi alanı; ebeveyn) · rapor ailesi → izin (`reports.ts`; audit ve kişi adlı rapor buluttan istenemez). Eşlenmeyen ad RED |
| Kiracı | `src/lib/tenant.ts` | `app.*` oturum ayarlarının TEK yazarı: her tx'in İLK ifadesi tek SELECT'te `set_config(tesis) + set_config(projeksiyonlar) + arama anahtarlarını sıfırla + (varsa) advisory kilit`. Kipler: `withTesis` · `withLookup` (giriş e-postası · oturum özeti · davet özeti · kurulum kimliği; kiracı = sıfır UUID) · `withMaintenanceList` |
| Servis | `src/services/` · `src/auth/` | İş kuralı + tx. Durum geçişi atomik claim; claim kuyruğu `WITH … FOR UPDATE SKIP LOCKED` CTE (IN-altsorgu LIMIT'i aşar — ölçüldü); işlem kimliği tek boğaz `lib/idempotency.ts` |
| HTTP | `src/http/` | Tek dinleyici: `/v1/*` fabrika kanalı (kurulum imzalı, HAM gövde ≤ 4 MB, gzip açılır ≤ 32 MB; eşitleme rolü) + `/api/*` hesap API'si (Bearer oturum, yazma yalnız JSON; uygulama rolü; rota TABLOSU veridir) |
| Şema | `prisma/` | Model/kolon İngilizce snake_case, kod değerleri Türkçe; her tabloda `tesis_id` + RLS ENABLE + FORCE (migration SQL); CHECK'ler çift yüklemi DB'de de sedder (AKTİF hesap TOTP'siz doğamaz) |

## Çok kiracılı tek DB — üç rol

- **Göç rolü** (`GOC_DATABASE_URL`, tablo sahibi): yalnız `prisma migrate deploy`, `scripts/db-rolleri.ts`, satıcı CLI'si. Sunucu bu rolle BAĞLANMAZ.
- **Uygulama rolü** (`DATABASE_URL`) ve **eşitleme rolü** (`ESITLEME_DATABASE_URL`): LOGIN NOSUPERUSER NOBYPASSRLS, tablo sahibi değil; yetkileri tek kaynak `src/lib/db-grants.ts` — uygulama rolü projeksiyona YAZAMAZ, eşitleme rolü hesap/oturum tablosunu OKUYAMAZ. Sunucu açılışta iki rolü ölçer: RLS'i atlayabilen rolle (süper/BYPASSRLS) KALKMAZ.
- `app.tesis_id` ayarsız/sıfırlanmış bağlantıda sorgu HATA verir (fail-closed, sıfır satır); `app.projeksiyonlar` RESTRICTIVE politikası izinsiz alt satırı DB düzeyinde gizler ("sipariş görür, tutar görmez"). `*` projeksiyon YASAK.
- Roller küme düzeyindedir: her `migrate deploy`dan SONRA `npx tsx scripts/db-rolleri.ts` (idempotent; yeni tablonun yetkisi `db-grants.ts`e AYNI dilimde girer — girmezse iki rol de erişemez).

## Advisory kilit envanteri (patron DB'si — backend 80xx ve satıcı 91xx'ten bağımsız)

Kilit tx'in İLK ifadesidir ve kiracı ayarıyla AYNI SELECT'te alınır (`lib/tenant.ts`); bir tx tek kilit alır. Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; bu tablo onunla birebir (bekçi `scripts/test_patron_kapilari.ts` §1).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9201 | `PACKAGE` | tesis başına eşitleme paketi — `try`: doluysa 409 `PAKET_ISLENIYOR` (fabrika bekleyip tekrar dener) |
| 9202 | `ACCOUNT_ADMIN` | tesis başına hesap yönetimi: davet · izin · kilit · arşiv · sıfırlama · davet kabul/onay (son yönetici kuralı) |
| 9203 | `CLIENT_TOKEN` | (tesis, işlem kimliği) başına: gelen kutusu mesajı · rapor isteği · cihaz kaydı tekrarları sıraya girer |

## Kurulum kaydı (imzalı istek + eşitleme hakkı)

`KURULUM_KAYNAGI=kayit` (varsayılan): satıcı CLI'si (`scripts/tesis.ts kurulum-kaydet`) açık anahtarı, sınıfı, modülleri, patron bulutu bitişini yazar. `KURULUM_KAYNAGI=satici`: satıcı İÇ API'si (`GET <SATICI_IC_API_URL>/ic/v1/kurulum/:id`, Bearer, iç ağ) + `installations` önbelleği — önbellek TAZELİKTİR: süre (`KURULUM_ONBELLEK_DK`) dolunca sorulur, ulaşılamazsa bayat kayıt, HİÇ dolmadıysa RED; satıcının 404'ü kaydı pasife çeker. Zil (`POST /ic/v1/zil {tesisId, konu}`) yalnız bu kipte gider, içerik taşımaz. Satıcı tarafı iç API'si AYRI dilimdir (sözleşme §17).

Eşitleme hakkı (bulut İKİNCİ kapıdır; fabrika zaten göndermez): `sinif = URETIM` ∧ `patron-bulut ∈ modüller` ∧ `patronBulutBitis > şimdi` ∧ devredilmemiş — yoksa 403 `SINIF_GONDEREMEZ` / `PATRON_BULUT_KAPALI`. Hesap yazmaları (gelen kutusu, rapor isteği) da tesisin açık aboneliğini ister; OKUMA abonelik bitse de açık kalır (veri sözleşme süresi sonunda imha edilir).

## Hesaplar

Bulutta BAĞIMSIZ (fabrika kullanıcısına bağlanmaz), hesap başına TEK tesis, e-posta bütün bulutta tekil (giriş tesis sormaz). Giriş tek adım: e-posta + parola (scrypt) + TOTP — TOTP'siz oturum YOK (DB CHECK dahil); tek hata iletisi, ardışık hatada süreli kilit, TOTP adım kilidi. Hesap DAVETLE doğar: satıcı CLI'si ilk tesis yöneticisini (`scripts/tesis.ts yonetici-davet`), yönetici ekibini (`POST /api/hesaplar`) davet eder; davetli kendi cihazında kabul (parola → TOTP sırrı BİR KEZ) + onay (ilk kod → AKTİF). Kurtarma kodu YOK: kayıpta yönetici sıfırlar, yönetici yoksa satıcı CLI'si (`yonetici-yeniden-davet`). Son aktif yönetici düşürülemez (409 `SON_YONETICI`). TOTP sırrı AES-256-GCM sarılı, anahtar `ANAHTAR_DIZINI/patron-totp.key` (DB'de değil).

## Budama beyanı (telemetri + okuma kopyası)

Yaşa göre silinen tablolar YALNIZ `src/services/maintenance.ts` `PRUNED_TABLES` (bekçi `test_patron_kapilari` §4 iki yönlü ölçer): `projection_rows` (tesisin saklama süresi — 3 · 13 · 25 ay · tümü, varsayılan 13 — kökü düşen kaydın alt satırı ve kalemiyle; 7 günden eski mezar taşı) · `request_nonces` · `package_receipts` · `full_sync_runs` · `report_results` · `report_requests` · `inbox_messages` (sonuçlanmış; asıl kayıt fabrikada) · `sessions` · `operation_receipts` · `account_audit` (ayak izi: başarısız giriş 90 gün, diğerleri 730 gün). Hiçbiri fabrikanın defteri değildir; iş kararı bunlardan okunmaz. Başka her silme yasak; hesap ve cihaz soft (durum/`active`).

Audit istisnaları (beyanlı sınıflar): fabrika kanalı yazımları (paket makbuzu kendi kaydıdır — sistem işi) · bakım işi (sistem işi) · oturum dokunuşu (telemetri). Hesap CUD'u, davet, giriş/çıkış, gelen kutusu/rapor yazımı/iptali, cihaz kaydı `account_audit`e düşer.

## Komutlar

```bash
cd patron/sunucu
npx prisma migrate deploy && npx prisma generate && npx tsx scripts/db-rolleri.ts   # migrate dev/reset YASAK
npx tsx scripts/tesis.ts tesis-ac --tesis=<uuid> --ad="Fabrika" [--saklama=13|3|25|tumu]
npx tsx scripts/tesis.ts kurulum-kaydet --tesis=<uuid> --kurulum=<uuid> --acik-anahtar=<x> --sinif=URETIM --moduller=patron-bulut,production.enabled --bitis=<ISO>
npx tsx scripts/tesis.ts yonetici-davet --tesis=<uuid> --eposta=<e-posta> --ad="Ad Soyad"   # davet belirteci BİR KEZ basılır
npm run typecheck:scripts && npm run lint        # commit kapısı altıncı proje olarak aynısını ölçer (tip + eslint + lint-baseline.json tavanı)
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `GOC_DATABASE_URL` · `DATABASE_URL` (uygulama rolü) · `ESITLEME_DATABASE_URL` (eşitleme rolü) — üçü AYNI `_test` DB'yi, ÜÇ AYRI rolle gösterir (`tekserp_fabrika_*` ASLA) · `ANAHTAR_DIZINI` · `PORT` (varsayılan 4620); isteğe bağlılar `.env.example`te. Bekçiler `scripts/test_*.ts`; harita `Teks-Erp/docs/BEKCI-HARITASI.md` § patron-bulutu. CI'da ayrı "Patron sunucusu" job'ı (PG 16, `migrate deploy`, roller, lint + tavan + tip + kapı kapsamı + bekçi koşucusu).
