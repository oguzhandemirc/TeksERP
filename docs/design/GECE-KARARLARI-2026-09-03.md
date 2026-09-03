# Gece Kararları — 2026-09-03

> Kullanıcı uyurken (gece yetkisi: "planı bitir, gerekirse sektör standardına göre karar ver")
> alınan ürün/mimari kararlar. Her satır: karar · emsal/gerekçe · geri alınabilirlik.
> Sabah kullanıcı topluca görür; itiraz edilen satır sonraki pakette geri alınır.
> Uygulama kuralı: geri alınması PAHALI kararlarda (şema kısıtı, veri dönüşümü) en
> muhafazakâr seçenek seçildi. Peer oturum (`patron-remote-monitoring-dashboard`)
> gece boyunca süpervizördü; "peer onaylı" satırlar onunla tartışılarak kesinleşti.

## Ortam / veri

| # | Karar | Gerekçe | Geri alma |
|---|---|---|---|
| E1 | Dev DB `tekserp_demo` 228 → **230 migration**'a çıkarıldı (P1 grandfathering + P2 `users.isSystemAccount`). Damga sonucu: `production/ticaret/iplik/depo.multiEnabled = true` (finance açık + 2 depo → "dünkü davranış"), `kumasTeknik/tezgah = false`, sistem hesabı 0 (supap açık). | P2 kodu her istekte yeni kolonu okuyor; migrationsız `.env`'li dev sunucu 500 verirdi. Migration'lar additive. | Gerekmez; istenirse `tekserp_demo2` dokunulmamış (227). |
| E2 | Kullanıcının :4000 dev sunucusu (bir ajanın `pkill -f "tsx src/server.ts"`i düşürmüştü) `nohup npx tsx src/server.ts` ile `.env`'den (tekserp_demo, PORT=4000) yeniden kaldırıldı — pid `lsof -iTCP:4000`. | Kullanıcı sabah çalışır sunucu bulsun. | `kill <pid>`. |
| E3 | Test DB `tekserp_modul_test` (fabrika 2 Eyl dump'ı + 230 migration) — sistem hesabı `bakim` (SAHTE test değerleri), yardımcı `p2test/test123`, pasif `bekci.*` kullanıcıları. | Bekçi ortamı; prod'a benzer. | `DROP DATABASE tekserp_modul_test`. |

## P2 — süperadmin (peer onaylı, referans: arşiv notu "Süperadmin P2")

Q1 supap · Q2 TOTP env tohumu + kurtarma kodu YOK · Q3 takma ad + 404 · Q4 FORCE_SYNC rotasyon · Q5 salt-okunur Modüller — hepsi arşiv notunda gerekçeli.

## P3 — ayar şifresi (gece kararı; tasarım §7.2'yi somutlar)

| # | Karar | Emsal / gerekçe | Geri alma |
|---|---|---|---|
| P3-1 | Hash `SystemSetting["security.settingsPasswordHash"]` (bcrypt 10) ama `systemSettingService.set()` ÜZERİNDEN DEĞİL — doğrudan upsert + ayrı audit olayı (payload'da şifre/hash yok). `security.*` ön eki hiçbir liste/dışa aktarımda dönmez; `PUT /admin/settings/:key` bu anahtarı reddeder. | Kural 8: `AuditService.log` oldData/newData'yı HAM yazar (P2'de ölçüldü); `SECRET_FIELDS` yalnız `changes`i maskeler. | Ayar satırı silinir; kod additive. |
| P3-2 | Şifre **başlıkta** (`X-Settings-Password`), gövdede değil. | Gövde `strictObject` (Zod) + gövde alanı audit `changes`ine sızabilir; başlık audit'e girmez. SAP "re-authentication" ve Odoo "sudo/confirm password" desenleri de kimliği gövde dışında taşır. | Başlık adı değişebilir; istemci tek sarmalayıcıdan geçer. |
| P3-3 | Kapsam: `PATCH /feature-flags` (belge-dışı anahtar taşıyan gövde), `PUT /feature-flags/documents-logo`, `PUT /admin/settings/:key`. **Belge-only gövde MUAF** (`document-template:write` büro personeli), **süperadmin MUAF**. Hash yoksa kapı uyur (Adnan sıfır fark). | Tasarım "davranış bayrağı ekranı"; belge şablonu ayrı yetki (2026-08-05 kararı). Süperadmin zaten ikinci faktör/parola sahibi. | Kapsam middleware'in bağlandığı uç listesidir — genişletmek/daraltmak tek satır. |
| P3-4 | Deneme sınırı mevcut `login-lockout` yardımcısı, anahtar `sp:<userId>`, kilit kontrolü `bcrypt.compare`'den ÖNCE; `auth.pinLockoutEnabled` kapalıysa kilit yok (ayrı şalter icat edilmedi). | `auth.controller` sırası emsali; tek şalter ilkesi. | Ayrı şalter eklenebilir. |
| P3-5 | Yönetim ucu (`PUT/DELETE /admin/settings-password`) yalnız süperadmin, aksi **404**. Süperadmin yoksa özellik erişilemez (tasarım: "süperadmin üretir/dağıtır"). Min 8 / max 128 karakter. | P2 S6 kalıbı (403 varlığı doğrular). Muhafazakâr: fabrika admininin kendi kendine ayar şifresi koyup unutması → kilitlenme sınıfı. | Supap açıkken admin'e de açılabilir (tek dal). |
| P3-6 | Her kayıtta sorulur, oturumda HATIRLANMAZ; audit: `SETTINGS_PASSWORD_USED {userId, keys}` / `_FAILED` / `_LOCKED` / `_SET` / `_ROTATED` / `_REVOKED`; `REQUIRED` (başlıksız ilk tur) audit'e girmez. | Tasarım literal ("her değişiklikte"); gürültü kontrolü. | Oturum içi hatırlama istemci tarafı bir ayardır. |

## Süreç

| # | Karar | Gerekçe |
|---|---|---|
| S1 | `pkill -f "tsx src/server.ts"` YASAK — tasarım §12-12 kalıcı kural. | Kullanıcının dev sunucusunu iki kez düşürdü. |
| S2 | Ölçüm rakamları hangi DB'de ölçüldüğüyle yazılır (test DB artıklarıyla şişmiş sayı arşive girmez). | P2'de 64/1952 → 9/641 düzeltmesi. |
