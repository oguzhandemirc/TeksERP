# patron/sunucu — TeksERP patron bulutu sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter, atomik claim, kilit tx'in ilk ifadesi, fail-closed, `details.code`, TR mesaj, sır hijyeni, audit yalnız ayak izi). Sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md`; alan kuralları `docs/kurallar/patron-bulutu.md`; anlatım, tam ayrıntı (katman tablosu, DB rolleri, budama), komut ve ortam `patron/sunucu/MIMARI.md`; bekçiler `Teks-Erp/docs/BEKCI-HARITASI.md` § patron-bulutu.

## Amaç

Patronun buluttaki OKUMA KOPYASI ve TEK yazma kanalı. **Bulut hesap yapmaz, fabrika tek yazardır:** fabrika projeksiyonları imzalı paketle gönderir; bulut saklar, izinle süzer, gösterir. Yazma bir MESAJdır: gelen kutusuna düşer, fabrika çeker ve kendi servis yolundan yazar. Patron uygulaması yalnız bu sunucunun `/api/*`sine konuşur.

## Katmanlar

- **Protokol** `src/lisans-protokol/`: Teks-Erp protokolünün BAYT-EŞİT aynası; burada düzenlenmez (bekçi `test_lisans_protokol_aynasi.ts` + `test_patron_kapilari` §7).
- **Tel şeması** `src/wire/esitleme.ts`: istek KATI, yanıt GEVŞEK.
- **Katalog** `src/catalog/`: izin (süper yetki YOK) · projeksiyon → izin · rapor → izin; eşlenmeyen ad RED.
- **Kiracı** `src/lib/tenant.ts`: `app.*` ayarlarının TEK yazarı; her tx'in İLK ifadesi tek SELECT'te ayar + (varsa) advisory kilit.
- **Servis**: durum geçişi atomik claim; claim kuyruğu `FOR UPDATE SKIP LOCKED` CTE; işlem kimliği tek boğaz `lib/idempotency.ts`.
- **HTTP**: tek dinleyici — `/v1/*` fabrika kanalı (kurulum imzalı, boyut tavanlı) + `/api/*` hesap API'si (Bearer, rota tablosu veridir).
- **Şema**: her tabloda `tesis_id` + RLS ENABLE + FORCE; çift yüklem DB CHECK ile de seddelenir.
- **Değişim akışı** `services/change-feed.ts` + `GET /api/degisim?since=&bekle=` (`http/change-routes.ts`): `sync_state.change_counter` YALNIZ paket tx'inde (9201 altında), veri kabul edildiyse +1; hub süreç içidir (halka 64, `notify` COMMIT'ten sonra), yanıt içerik taşımaz, ≤ 25 sn, adlar oturumun okuyabildiği projeksiyonlarla süzülür (bekçi `test_degisim_sayaci`).

## Merkez DB + tesis başına DB — roller

- Merkez DB yalnız yönlendirme ve yaşam döngüsü tablolarını, tesis DB'si (`lib/tesis-db-ad.ts`, ad kimlikten türetilir) kiracı verisini taşır; tek şema, tek göç zinciri; yönlendirici `lib/tesis-db.ts`.
- Göç rolü tablo sahibidir; sunucu bu rolle BAĞLANMAZ. Tesis rolleri (`_uyg`, `_esit`) NOBYPASSRLS; yetkiler tek kaynak `src/lib/db-grants.ts` — yeni tablonun yetkisi AYNI dilimde girer. Rol parolası diskte tutulmaz, anahtardan türetilir. Sunucu RLS'i atlayabilen rolle KALKMAZ.
- `app.tesis_id` ayarsız bağlantıda sorgu HATA verir (fail-closed); `*` projeksiyon YASAK. Sunucu hazırlayıcıyı import ETMEZ.
- Destek rolüyle sunucu bağlanmaz; kapı `destek_ac(...)` ile açılır ve `support_access`e yazılır. İmha claim'li ve tutanaklıdır. Ayrıntı `docs/ops/PATRON-TESIS-DB-GECIS.md`, `docs/design/PATRON-TESIS-DB.md`.

## Advisory kilit envanteri (patron DB'si — backend 80xx ve satıcı 91xx'ten bağımsız)

Kilit tx'in İLK ifadesidir ve kiracı ayarıyla AYNI SELECT'te alınır (`lib/tenant.ts`); bir tx tek kilit alır (sıra önce `LOGIN_ROUTE` sonra `ACCOUNT_ADMIN`). Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; tablo onunla birebir (bekçi `scripts/test_patron_kapilari.ts` §1).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9201 | `PACKAGE` | tesis başına eşitleme paketi — `try`: doluysa 409 `PAKET_ISLENIYOR` |
| 9202 | `ACCOUNT_ADMIN` | tesis başına hesap yönetimi (son yönetici kuralı) |
| 9203 | `CLIENT_TOKEN` | (tesis, işlem kimliği) başına tekrarlar sıraya girer |
| 9204 | `LOGIN_ROUTE` | MERKEZ DB'sinde kimlik e-posta özeti başına (davet kabul/onay/bağla, satıcı kimlik sıfırlaması, merkez kimlik kapanışı/silmesi, kendi hesabını silme, özet yenileme (ozet-yenile)); hesap kilidinden ÖNCE |

## Alt-alan kuralları — dokunmadan önce oku

`docs/kurallar/patron-bulutu.md` § Patron sunucusu — Kurulum kaydı · Hizmet aşaması · Hesaplar · Bildirimler (B5).

## Budama beyanı (telemetri + okuma kopyası)

- Yaşa göre silinen tablolar YALNIZ `src/services/maintenance.ts` `PRUNED_TABLES`; yaşa göre silinen ALAN YALNIZ `AGED_FIELDS` (bekçi `test_patron_kapilari` §4, §8 iki yönlü). Hiçbiri fabrikanın defteri değildir; iş kararı bunlardan okunmaz; başka her silme yasak; hesap ve cihaz soft.
- İstemci adresi yalnız HTTP katmanında okunur, kalıcı olarak yalnız beyanlı alanda ve süreyle tutulur.
- Kapanan hesabın kimliği süre sonunda tombstone'a çekilir; satır, kimlik, durum, izin ve makbuz kalır.
- Audit istisnaları beyanlı sınıflardır (fabrika kanalı · bakım · oturum dokunuşu); hesap işlemleri `account_audit`e düşer.
- Süreler ve tam metin `MIMARI.md`.

## Komutlar

```bash
cd patron/sunucu
npx prisma migrate deploy && npx prisma generate && npx tsx scripts/db-rolleri.ts   # migrate dev/reset YASAK
npm run typecheck:scripts && npm run lint
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` repoya girmez (0600): `GOC_DATABASE_URL` · `DATABASE_URL` · `ESITLEME_DATABASE_URL` — üçü aynı `_test` DB'yi üç ayrı rolle gösterir (`tekserp_fabrika_*` ASLA). Tam liste `MIMARI.md` § Komutlar.
