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
| P3-7 | (uygulamada ölçüldü) Kilit kovası ayrımı KEY'de (`sp:` ön eki her kovanın anahtarında), kimlikte DEĞİL — `resolveLoginLockoutKeys` varsayılan `ip` kapsamında kimliği düşürüyordu; 5 yanlış ayar şifresi tüm IP'nin GİRİŞİNİ kilitliyordu. | Ölçüm (A ajanı). | — |
| P3-8 | (D2 Fable) Şifre karakter kümesi `^[\x21-\x7E]+$`, 8–72 (bcrypt 72 bayt; HTTP başlığı non-ASCII/boşluk taşımaz — fabrika rotasyona kadar kilitli kalırdı). `.trim()` yerine RED. | RFC 7230 field-value + bcrypt sınırı. | Sınır değiştirilebilir (72 üst sınır sabit). |
| P3-9 | (D2 Fable) Kapsam elle sayılmaz: `src/routes/**`te ayar yazan HER route (`set(`/`setFeatureFlags(`) kapı zincirinde olmalı — AST tripwire; `/admin/backups/offsite` + `authorize` kapıya alındı (yedek hedefi şifresiz değiştirilebiliyordu). | Ölçüm: offsite PATCH 200 şifresiz. | — |
| P3-10 | (D2 Fable) USED/FAILED/LOCKED audit `path` = `req.path` (query hariç — query erişim loguna ve system_logs'a düşer); LOCKED audit yalnız kilit ANINDA (`justLocked`), login kilidi de aynı kural; 429'da `Retry-After` tek noktadan (error middleware). | Sel + sink ölçümü. | — |
| P3-11 | (D2 Fable, P2 eki) Oturum jti ↔ userId bağı `verifyToken`da (`session.userId !== payload.userId` → 401): JWT_SECRET sızarsa bile başka oturumun jti'siyle süperadmin kimliği üretilemesin (savunma derinliği). | Ölçüm: admin jti + bakim userId → /auth/me isSystemAccount=true idi. | — |

## Süreç

| # | Karar | Gerekçe |
|---|---|---|
| S1 | `pkill -f "tsx src/server.ts"` YASAK — tasarım §12-12 kalıcı kural. | Kullanıcının dev sunucusunu iki kez düşürdü. |
| S2 | Ölçüm rakamları hangi DB'de ölçüldüğüyle yazılır (test DB artıklarıyla şişmiş sayı arşive girmez). | P2'de 64/1952 → 9/641 düzeltmesi. |

## P4 — kalite = istasyon yeteneği, Faz A (gece kararı; tasarım §5.1 + karar #11)

| # | Karar | Emsal / gerekçe | Geri alma |
|---|---|---|---|
| P4-1 | Boğaz TEK DEĞİL **İKİZ**: saf yüklem `stepCanApplyQuality()` + Prisma where-parçası `QUALITY_STATION_WHERE` (yeni `helpers/quality-station.helper.ts`). 28 PROCESS_QC karar noktasının 12'si `where` içinde (biri atomik claim) — saf yüklem oraya giremez. | `fason-open-dispatch.helper` OPEN_OUTSTANDING emsali; plan "~15 nokta tek yükleme" eksikti (ölçüldü). | Additive; Faz B'de `kind` dalı düşer. |
| P4-2 | Yüklem Faz A'da `kind===PROCESS_QC \|\| appliesQuality` (köprü) — backfill'e güvenmez; seed'e `appliesQuality:true` da yazılır. | 2026-08-10 appliesColor seed tuzağı (migration boş tabloda koşar). | Faz B'de tek satır. |
| P4-3 | `assertWoAtStepKind(PROCESS_QC)` (kursun-qc:245) DOKUNULMAZ — roll-step.helper TAMBUR ile paylaşılıyor (R1). Bekçide gerekçeli muaf. | "Davranış birebir" kısıtı; R1 Faz B. | Faz B. |
| P4-4 | Panel kutusu "Kalite kontrol uygular" HER istasyon türünde görünür (KK1/SEVK dahil) — gizli kural icat edilmez; anlam dokümanda. | Tasarım §12-6 "if (X) yasak" ruhu; yüklem KK1'de zaten etkisiz (WO adımı değil). | UI'da gizlenebilir. |
| P4-5 | "KK1 WO adımı olamaz" = **istemci sözleşmesi** (3 Electron picker filtresi); backend `allowAsWorkOrderStep`ı hiç okumaz → guard EKLENMEZ (davranış değişikliği olurdu; dump'ta sayı ölçülür). Nota bu ayrımla yazılır. | Ölçüm: `src`de 0 okuyucu. | Guard ayrı paket. |
| P4-6 | Drift onarımları AYRI commit (Electron SHIPPING enum+zod, mobil StationKind/StationType hayaletleri, station-colors WAREHOUSE→SHIPPING) — bug fix; SEVK_1 bugün panelden düzenlenemiyor, düzenlense OTHER'a düşüp tabletin tartı ekranını kapatıyor. | Kozmetik değil, saha hatası. | — |
| P4-7 | Kanban `kursunColumn` where-parçasına alınır ama kolon ADI "Kurşun" KALIR (Faz A küme aynı). Faz B'de ikinci KK istasyonu doğarsa etiket "Kalite Kontrol" olur — karar şimdi verildi ki iki fazda iki cevap doğmasın. | 2026-08-27 "aynı soruya iki cevap" dersi. | Etiket değişikliği. |
| P4-8 | Electron `buildStationPayload` drift'i (mevcut renk/özellik kutuları ÖLÜ — payload göndermiyor) P4 içinde onarılır; route edilmeyen `StationsPage.tsx` import'suzsa silinir. | 2026-08-13 "gövdeyi elle kuran katman sessiz allowlist" sınıfı. | — |
| P4-9 | R9 `QC2_COMPLETED` adı Faz A'da KORUNUR (enum değeri eklemek 4-kapı işi, Faz B kararı). | Kapsam. | Faz B. |

## P6 — tamlık bekçisi + profiller (gece kararı; tasarım §3 tamlık, §10 profiller) — P5'TEN ÖNCE (bağımlılık)

| # | Karar | Emsal / gerekçe | Geri alma |
|---|---|---|---|
| P6-1 | `ScreenEntry.modul` ZORUNLU alan; değer kümesi `ModulKey` (7, `MODULE_FLAG_KEYS` ile birebir) · `cekirdek:*` (5 blok, ön ek zorunlu) · `planlanan:fason\|kartela` (tasarımda var, anahtarı yok). Plandaki `MODULESIZ_EKRANLAR` muafı YAZILMAZ (alan zorunlu → doğduğu gün ölü muaf); muaflar karo/kapı eksenine (`KARO_VARYANT`/`KARO_BEKLEYEN`/`RAPOR_KARMA`/`KARO_YOK`/`EKRANSIZ_MODULLER`). | 93 ekran (78+15) ölçüldü, hepsi eşlendi. | Alan opsiyonel yapılabilir. |
| P6-2 | Tereddütlü eşlemeler: stations/machines/defect-types → çekirdek ana-veri (kapısız); mobil KK1 → production (karar #2: istasyon ekranı üretimde — toptancı "Mal Girişi" ekranı ilk toptancıda); traveler-card → production, studio → belge (üretimsiz kurulumda stüdyo önizlemesi 403 — kabul); reports/production+quality → production (backend `/api/reports` kapısız — karo gizlenir, uç açık; `RAPOR_KARMA`). | Tasarım §2 + P1 kapı listesi. | Satır değiştirmek tek edit. |
| P6-3 | **Profiller TS sabiti** `constants/module-profiles.ts` — plandaki `deploy/profiller/*.json` REDDEDİLDİ: `paketle.ps1` `deploy/`yi pakete koymuyor, job üretimde dosyayı bulamaz, sessiz no-op. Beş profil (basit/standart/perde/dokuma/tam; boyahane yok), yalnız 7 modül anahtarı; davranış bayrakları PROFİLE GİRMEZ (seed `upsert.update` ile ezerek yazıyor — iki yazar olmaz; Dilim 2). | permission-catalog emsali (dist'e derlenir). | JSON yoluna geçilirse paketle.ps1 + kur.ps1 dokunuşu şart. |
| P6-4 | Job `TEKSERP_PROFIL` env'i YOKSA HİÇ yazmaz (varsayılan profil yazılmaz — erken boot yanlış profili kalıcılaştırırdı); eksikleri `createMany skipDuplicates` ile yazar; saf bağımlılık yüklemi (servis userId ister, çağrılamaz); damga `system.profile` yalnız yazıldıysa; `system.profile` K7 reserved. | superadmin.job `absent` kalıbı. | — |
| P6-5 | Profil uygula için YAZMA UCU YOK — istemci diff'i `PATCH /feature-flags` ile gönderir (tek kapı: süperadmin guard + ayar şifresi). Fark SUNUCUDA (`GET /api/admin/module-profile`), profil kaynağı istemciye sızmaz. `/api/admin/screens` izni `admin:users ∨ admin:settings` (katalog sır değil; salt-okunur Sistem Profili). | Tasarım §12-5 kapı çoğaltma yasağı. | — |

## P5 — Electron karo/ctx + modül kilidi + Sistem Profili (gece kararı; tasarım §3.3/§3.5/§7.3)

| # | Karar | Emsal / gerekçe | Geri alma |
|---|---|---|---|
| P5-1 | Önce iki CANLI ayrışma: Mal Kabul karosu backend ticaret kapısıyla hizasız (karo çizilir, uç 403); Kalem Fiyatları karosu `financeEnabled` okuyor ama uç `requireTicaretEnabled` (yön ters). Adnan'da görünmez (izin yok/finance kapalı), ilk ticaret müşterisinde patlardı. | Ölçüm. | — |
| P5-2 | Modül kapalıyken karo GİZLENİR (tasarım §3.3 literal): üretim karoları + Tanımlar'daki rota/reçete/istasyon-yeteneği/refakat kartı → `productionEnabled`; stations/machines/kataloglar çekirdek (bağlanmaz). "Yeniden açan yapılandıramaz" endişesi geçersiz: açma Sistem Profili'nden her zaman mümkün. | §3.3. | Salt-okunur karoya çevrilebilir. |
| P5-3 | Sidebar jenerik `?? false` kaldırılır, menü ctx'ten okur (production varsayılan AÇIK → bayrak yüklenene kadar üretim menüsü kaybolmaz — sıfır görünür fark); palet nav girdilerine `featureFlag` taşınır (bugün sızıyor). | Ölçülmüş titreme riski. | — |
| P5-4 | Ayar kategorilerinde modül = **KİLİT** (`moduleKey`, `superadminOnly` ikizi), `regime` (GİZLEME) DEĞİL — üretim/ticaret kategorilerine `regime` konursa `test_feature_flag_contract §14` kırmızı (4+ okuyucu çekirdek route'lardan ulaşılabilir, ölçüldü). `warehouse` kategorisi ikiye bölünür (ticaret / iplik). `kk1.*` ÇEKİRDEK alt bayrağı (stok-giriş motoru). **`finance` kategorisinin mevcut GİZLEME davranışı KORUNUR** (Adnan'da finance kapalı → kategori bugün gizli; kilide çevirmek görünür fark) — tasarım §3.5 ile mevcut finance-gizleme tutarsızlığı SABAH KARARI. | §14 ölçümü; sıfır görünür fark. | Tek satır (`regime` ↔ `moduleKey`). |
| P5-5 | Bant metni "dondu; modül açılınca düzenlenebilir" — "etkisiz" DEMEZ: tasarım §3.6 tek-resolver (modül kapalıyken alt bayrak OKUNMAZ) backend'de YOK ve bu pakette UYGULANMAZ (üretim kapalıyken `kk1DuplicateGuardEnabled` `/api/rolls`tan hâlâ koşar — ölçüldü). §3.6 → Dilim 2 davranış-bayrakları paketine. | Dürüst bant. | — |
| P5-6 | Süperadmin kapısı TEK KAYNAK `lib/superadmin-gate.ts` (`isSystemAccount \|\| !systemAccountExists`) — ProtectedRoute + hub karosu + FeatureFlagSection + palet aynı yüklemi import eder (üç kopya ayrışırsa süperadminsiz kurulumda ekran hiç açılmaz). Karo `admin:settings` iznini KORUR, kimlik üçüncü kapı. Sayfa fabrika adminine SALT-OKUNUR (şeffaflık). | FeatureFlagSection'daki gömülü kural. | — |
| P5-7 | Yer tutucu modüller (kumaşTeknik/tezgah) Sistem Profili'nde "yüzeyi yok" rozetiyle GÖSTERİLİR (tam fotoğraf); Genel Ayarlar'da yok (aynen). | §7.3. | — |
