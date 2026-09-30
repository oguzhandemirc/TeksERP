# Backend `2.12.1`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.11.2** (etiket `backend-v2.11.2` = `72889f5a`; `adnansahin`, 2026-09-28 kurulum kaydı
`backend-2.11.2.md`). 2.12.0 prova olmayan paket olarak ÜRETİLMEDİ (`backend-v2.12.0` etiketi yok). Hazırlık
kanalında (`testfabrika`, thinkpad-1) kurulu olan, 2026-09-30 13:25'te ölçüldü:
`/health` `UP/UP 2.12.0-prova.05b962e` · `app\PAKET.json` korumalı, 367 migration, `prova: true` (`backend-2.12.0.md` kurulum kaydı).

Kaynak taslak `docs/surumler/2.12.1-taslak.md` (sürüm numaraları yönetici kararı 2026-09-30, I10: backend
2.12.1 · panel 1.4.1 · tablet 1.0.14). Kod tabanı `origin/main` `dd54c252` (`47b9d825` + `lisans/entegrasyon`
I8…I11). Yama hanesi ELLE (`-Surum 2.12.1`); yama otomatiği `backend-v2.11.2`den 2.11.3 üretir ve bu belgeyi
bulamaz. 2.12.0'ın içeriği (lisans gözlemi, destek, yedek şifreleme, patron bulutu hazırlığı) bu sürümle birlikte
gelir: `adnansahin`e doğrudan 2.12.1 kurulursa `backend-2.12.0.md` §2–§4 de geçerlidir.

**Bu belgenin ilk kullanımı hazırlık kanalıdır:** testfabrika'ya KORUMALI **prova** paketi
(`paketle.ps1 -Korumali -Prova -Surum 2.12.1`, sürüm `2.12.1-prova.{yerel sha7}`) kurulur; runbook
`docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md` §4. `adnansahin` paketi (prova olmayan) yalnız kullanıcının terfi
onayıyla ve ayrı bir karar olan `-Korumali` seçimiyle üretilir; o gün yukarıdaki üç alanı `paketle.ps1` yazar.

## 1. Özet

**Fabrika saat dilimi** tarihli DÖNEMLER defteridir (`factory_timezone_periods`; satır yoksa bütün zaman
`Europe/Istanbul` = bugünkü davranış): fabrika günü, rapor gün sınırları, belge/PDF/Excel basım saatleri
ve patron bulutuna giden tesis dilimi buradan, her kayıt KAYDIN ANINDAKİ dilimle. Değişiklik yalnız
önizlemeli uçtan, yeni dilimde ertesi gün başından geçerli; geçmiş kayıtların saati/günü değişmez,
bekleyen değişiklik ters kayıtla iptal edilir.
**İki adımlı giriş (TOTP) herkes için isteğe bağlı**; açan kullanıcıya her parolalı girişte sorulur
(önceden yalnız tünelden). **Eski uzaktan erişim tüneli emekli**: backend TEK dinleyici, Access JWT
kapısı ve `/api/boss/overview` kalktı, özet `cloud-sync`te. Fabrikadan **bulut hesabı kilitleme**
(bulut sahada açık değil). **Şube/ürün kartı künyesi** doğuşta yazılır.

## 2. Ne değişti

- **Saat dilimi (TZ-B + I9):** `src/constants/time.ts` tek kaynak açılışta `company.timezone`u yükler
  (dinleyici ondan SONRA açılır). Kayıtlı değer geçersizse sunucu varsayılanla AÇILIR ve
  `FACTORY_TIMEZONE_INVALID_STORED` uyarısı `/api/admin/health`, ayar yanıtı
  (`factoryTimezoneWarning`) ve panel şeridinde görünür; DB'ye ulaşılamazsa bugünkü gibi açılır.
  Takvim alanları (vade · termin · planlanan bitiş) hibrit kuralla basılır: tam UTC gece yarısı ise
  UTC günü, değilse fabrika günü (tasarım §5.6).
- **Saat dilimi dönemleri (TZ-D):** tek değerli ayar yerine ekleme-yalnız dönem defteri
  (`FactoryTimezonePeriod`: dilim · `validFrom` · sebep · `reversesPeriodId` ters bağı · künye).
  `factoryTimezoneAt(an)` kaydın anındaki dilimi verir; gün/saat işlevleri ve SQL yardımcısı dönem
  sınırında uzamış/kısalmış günü bölmeden çözer (dönem yokken SQL metni bugünküyle birebir). Planlama
  yeni dilimde şimdiden sonraki ilk gece yarısını `validFrom` yapar; bekleyen varken ikinci değişiklik
  409; iptal SİLME değil ters kayıttır (çift söner, sonradan daha erken bir değişiklikle dirilmez).
  İki yazar da advisory **8037** kilidini tx'in ilk ifadesi olarak alır. TZ-B'nin `company.timezone`
  satırı hiçbir sürüme çıkmadı; varsa geçerli değeri TABAN (ilk dönemden önceki dilim) sayılır.
  Panel/tablet/patron uygulaması dönemleri `factory-time-zone.ts` (üç projede bayt-eşit) ile uygular.
- **Genel ayar ucundan yazım kapalı:** `company.timezone` `PUT /api/admin/settings/:key` üzerinden 400
  `SETTING_KEY_RESERVED`; yalnız aşağıdaki önizlemeli uç yazar.
- **Künye (KÜN):** şube (`CustomerBranch`) ve ürün kartı (`Item`, hızlı kumaş dahil) doğuşta
  `createdById/updatedById` yazar; aktörsüz doğuş 401. Geçmiş NULL kalır, backfill yok.
- **Tünel emekliliği (B6):** `REMOTE_PORT` ikinci dinleyicisi, `remote-access` ara katmanı (Access
  JWT/JWKS, uzakta 404 listesi, uzak-yalnız TOTP), `boss.routes` ve `WEB_BOSS` şablon kataloğu
  satırı kalktı. Fabrika paketi web panelini (`dist-web`) TAŞIMAZ; `kur.ps1` eski `.env`deki emekli
  anahtarları (`WEB_DIST_DIR` · `REMOTE_PORT` · `CF_ACCESS_*`) ADIYLA söyler, `.env`e dokunmaz.
  `REMOTE_PORT` kalmışsa `CLIENT_IP_HEADER` yok sayılır + uyarı.
- **Bulut hesabı kilitle (B6):** `POST /api/patron-bulut/hesap/:id/kilitle` — fabrika yalnız İSTER
  (kurulum imzalı `/v1/hesap-kilitle`, işlem kimliği mantıksal deneme başına), bulut tek yazar. Lisans
  kapısında KISITLI kademede açık, DURDURULMUŞ'ta kapalı. `PATRON_CLOUD_URL` yoksa 409
  `PATRON_BULUT_KAPALI`, dış istek yok.
- **TOTP (B6-2):** "açık" = sır + `totpEnabledAt` + tüketilmiş kurulum penceresi kanıtı
  (`TotpAccountService.readActive`). `superadmin:kur` artık TOTP üretmez; `--rotate` açık 2FA'yı kapatır.
  Sahadaki otomatik tohumlanmış süperadmin TOTP'si veri göçü OLMADAN kapalı sayılır.
- **Kurulum (I8):** `kur.ps1` [5/9] birleşik ecosystem başlığı; kurulum kaydında migration sayısı
  DB'den (`_prisma_migrations`) ölçülür; pm2 ad kapısı.


## 3. Sözleşme

- **Kırıldı mı:** BİR uç kalktı, gerisi yalnız EKLER. `GET /api/boss/overview` → 404 (yalnız eski BossShell `#/boss`
  çağırırdı; sahada kullanan yok, taslakta ölçüldü); eski panel ana kabukta etkilenmez. Giriş davranışı: 2FA'sı
  AÇIK kullanıcı kodsuz parolalı girişte 409 `TOTP_REQUIRED`, yanlış kodda 401 `TOTP_INVALID` (önceden yalnız tünelden).
- **Yeni uçlar:** `GET /api/feature-flags/factory-timezone/preview` · `PUT /api/feature-flags/factory-timezone`
  (`admin:settings` + ayar şifresi; dönem PLANLAR, `expectedCurrent` ile atomik; 409 `FACTORY_TIMEZONE_CHANGED` ·
  `FACTORY_TIMEZONE_PENDING`) · `POST /api/feature-flags/factory-timezone/cancel` (ters kayıtla iptal; 409
  `FACTORY_TIMEZONE_NOT_PENDING`) · `GET /api/feature-flags/factory-timezone/periods` · `POST /api/patron-bulut/hesap/:id/kilitle`.
- **Eski istemci ne yapar:**
  - *Eski panel (≤ 1.4.0):* dönem alanlarını (`factoryTimezoneBase` · `factoryTimezonePeriods` · `factoryTimezonePending`)
    tanımaz ve `factoryTimezone`u tek dilim sanar — dönem yokken fark yok. Panel ≥ 1.3.7 `TOTP_REQUIRED`/`TOTP_INVALID`i
    `TotpStep` ile işler.
  - *Eski tablet (≤ 1.0.13):* kod adımı taşımaz; 2FA'sı açık kullanıcıya ileti PIN/kart yoluna yönlendirir. 2FA'sı kapalı
    kullanıcıda ve PIN/kart girişinde değişiklik yok.
  - *Genel ayar ucu:* `PUT /api/admin/settings/company.timezone` 400 `SETTING_KEY_RESERVED` (yalnız önizlemeli uç yazar).
  - *İzinler:* yeni izin YOK; `WEB_BOSS` şablonu katalogdan çıktı, kurulumdaki satır kalır (uzlaştırma yalnız ekler).
- **`minVersion` dokunuldu mu:** HAYIR (`src/config/client-version-policy.ts`).

## 4. Migration

- **Var mı:** EVET — **1** adet, yalnız EKLER: `20260930180000_fabrika_saat_dilimi_donemleri` — `factory_timezone_periods`
  tablosu (UUID PK, `validFrom`/`createdAt` timestamptz, `reversesPeriodId` UNIQUE ters bağ, boş dilim CHECK'i, künye FK).
  Tünel emekliliği şemaya dokunmaz (`ClientType.WEB` değeri DB'de kalır).
- **Toplam migration:** **368** (2.12.0'da 367, 2.11.2'de 363; ölçüldü: `47b9d825`..`dd54c252` farkı tek klasör).
  2.12.0'dan gelen kuran `[7/9]`da "368 migrations found" + **1** uygulanan migration görmelidir; 2.11.2'den gelen **5**
  (2.12.0'ın dördü + bu). Farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok — tablo boş doğar = bütün zaman `Europe/Istanbul` (bugünkü davranış). Backfill yok
  (künye geçmişi NULL kalır).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback = yedekten restore.

## 5. Kurulum notu

- **Beklenen kesinti:** ~2–3 dk API kapalı (`[4/9]` → `[8/9]`; 2.12.0 prova thinkpad-1'de ≤ 2 dk). 2.11.2'den gelen
  kurulumda 2.12.0'ın `rolls`/`roll_movements` indeksleri de koşar (~5–6 dk).
- **Sıra:** backend ÖNCE, panel 1.4.1 + tablet 1.0.14 OTA sonra (tablet native değişmedi → APK yok).
- **Kurulum yöntemi:** paketin kendi `kur.ps1` + `uzaktan-kos.ps1`i çıkarılır (zip SHA256 kıyası), SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -ZamanAsimiDakika 45 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'` (prova paketinde
  ek olarak `-ProvaKabul`; çalışan pm2 adı paketin kanal adından farklıysa `-UygulamaAdi {çalışan ad}` — ad kapısı).
  `kur.ps1` sunucunun `.env`ini BAYT BAYT korur; korumalı pakette `ecosystem.config.js`i paketin Node'una bağlayarak
  birleştirir (F-ECO).
- **Bu sürüme özel:**
  - `.env`: zorunlu yeni anahtar YOK. Eski kurulumda `WEB_DIST_DIR` · `REMOTE_PORT` · `CF_ACCESS_*` varsa `kur.ps1` ADIYLA
    uyarır, `.env`e dokunmaz; elle silinebilir (tünel kurulu kurulum YOK). Fabrika paketi web panelini (`dist-web`) TAŞIMAZ.
  - Korumalı paket HEDEF platformda üretilir (pwsh 7, prizde, ayrık ve düşük öncelikli — DEPLOY-RUNBOOK §3c); imza Mac'te
    (`build-korumali-imza.ts zip`); native çekirdek `47b9d825`ten beri farksız.
  - **Saat dilimi değişikliği planlanır ya da iptal edilirse (ops):** `sl_day_exact` istatistiği sunucunun ürettiği
    ifadeyle yeniden kurulur — `DEPLOY-RUNBOOK.md` §12. Dönemsiz (İstanbul) kurulumda adım gerekmez.
  - 2FA'sını daha önce panelden kurmuş kullanıcılara kod artık LAN girişinde de sorulur; kurtarma gerekirse yönetici
    Kullanıcılar → İki Adımlı sekmesinden sıfırlar.
- **Paketleme komutları (yayın/etiket YOK):** backend `paketle.ps1 -Musteri {kanal} -Surum 2.12.1` (`-Korumali` ayrı karar;
  etiket yayından SONRA `backend-surum.mjs --etiketle 2.12.1`) · panel `./deploy/electron-paketle.sh {kanal}` (otomatik
  1.4.1) · tablet `cd mobil && npm run yayinla -- --musteri={kanal}` (otomatik 1.0.14; OTA).
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma · postgres/node
  süreçlerini `Stop-Process` ile durdurma · `C:\TeksERP\pgsql\bin` recursive SİLİNMEZ · `pm2` CLI SSH'tan koşulmaz ·
  `-GeriAl` ile `-Zorla` elle birlikte KULLANMA (SYSTEM görevinde soru sorulamaz, orada birlikte verilir) · başarısız
  kurulumu TEKRAR DENEME · **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**.

## 6. Geri alma

`kur.ps1 -GeriAl` (SYSTEM görevi: `uzaktan-kos.ps1 -Betik C:\TeksERP\kur.ps1 -Argumanlar '-Kok C:\TeksERP -GeriAl -Zorla
-UygulamaAdi {çalışan ad}'`) en yeni geçerli `app.eski-*`i geri koyar ve ecosystem birleştirmesini simetrik geri alır.
Eşik ÖNCESİ hata: betik kendini toplar, `app.eski-*` oluşmaz. Eşik SONRASI: migration yalnız EKLER → 2.12.0 / 2.11.2
koduna dönüş şema işlemi istemez; `factory_timezone_periods` kalır ve eski kodda okunmaz (sabit İstanbul — İstanbul dışı
bir dönem yürürlüğe girdiyse o dönemin kayıtları da İstanbul gün sınırlarıyla gösterilir). 2.12.0'a dönülürse tünel kodu
geri gelir ama `REMOTE_PORT` tanımsızsa ikinci dinleyici açılmaz. Veri dönüşü gerekiyorsa `[3/9]`da alınan
`C:\TeksERP\backups\premigrate_*.dump`tan restore (şifreliyse önce yedek parolasıyla düz kopyaya çözülür). `[7/9]` yarıda
düşerse Prisma o migration'ı FAILED işaretler — elle `resolve` YAPILMAZ, insana rapor edilir. Panel 1.4.0 / tablet
1.0.13'e dönüş: yayın kanalındaki önceki paket.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + pm2 (online, restart sayısı, yorumlayıcı `app\runtime\node.exe`); tek dinleyici (4000; 4001 dinlenmiyor)
- `/health` → `UP/UP 2.12.1` (prova: `2.12.1-prova.{yerel sha7}`)
- `[7/9]`: 1 migration uygulandı; `_prisma_migrations` 368 bitmiş / 0 sorunlu, son `20260930180000_fabrika_saat_dilimi_donemleri`;
  kurulum kaydında `yeniMigrationSayisi` DB'den (2.12.0'dan gelende 1)
- `backend-err*.log` son satırlar — yeni hata var mı
- korumalı paket: `korumali=True` · `/api/admin/health` `license` bloğu: `cekirdek native` · `butunluk GECERLI` · motor
  `CALISIYOR` · kip `gozlem` (kimlikli ölçüm; runbook §4.5)
- `/api/admin/health` `factoryTimezone` = `Europe/Istanbul`, uyarı yok; `SELECT count(*) FROM factory_timezone_periods` = 0
- Panel: Genel Ayarlar → Sistem → Şirket Bilgileri → Saat dilimi önizlemesi açılıyor (değiştirmeden); bekleyen değişiklik
  yok, dönem geçmişi boş
- 2FA'sı kapalı kullanıcı panelde ve tablette her zamanki gibi giriyor; PIN/kart girişleri aynı; yeni ürün kartında bilgi
  düğmesi "Oluşturulma" altında kullanıcı adını gösteriyor
- panel/tablet oturumları kurulum sonrası yeniden bağlandı; ölçülen kesinti

**Kurulum kaydı — 2026-09-30 (testfabrika / thinkpad-1, KORUMALI PROVA) — BAŞARILI:**

- Kaynak `origin/main` `dd54c252`in `git archive`ı (hedefte tek yerel commit; sürüm `2.12.1-prova.4b8d916`, son ek o yerel commit'tir,
  depoda yoktur). Native yeniden kullanıldı: `Teks-Erp/native` `47b9d825`..`dd54c252` arasında farksız, `e2691bc1…7c90`.
- Paket `tekserp-backend-prova-20260930_133103-4b8d916.zip` · imzasız SHA256 `6D1310B97EE81E9A58A6CC54B6C05C89E10FC2AC368C11F06F9D9872D4E0B8C3`
  → imzalı (kid `paket-hazirlik`, 13378 dosya kapsam) SHA256 `26D5CA66A1D5BD0D6ADD3AE9AEAE27290B2985F16716195FA8B5566CE715435C` ·
  13388 girdi · 368 migration · paketin `kur.ps1`i depodaki `deploy/kur.ps1` ile bayt-eşit. Paketleme ~9 dk (pwsh 7, ayrık, BelowNormal, prizde).
- `-UygulamaAdi tekserp-backend-yeni` (çalışan ad pm2 pid dosyası + `dump.pm2`'den ölçüldü) · `[1/9]` ad kapısı `OK pm2: 'tekserp-backend-yeni'
  bu kurulumun backend'i` · `[2/9]` `ecosystem.config.js zaten paketin Node'una bagli (runtime/node.exe) - DOKUNULMAYACAK` (2.12.0 kurulumunun
  birleşik dosyası) · `[3/9]` `premigrate_20260930_134625.dump.tkenc` (9,56 MB, doğrulandı) · `[7/9]` `368 migrations found`, uygulanan
  `20260930180000_fabrika_saat_dilimi_donemleri`, `bu kurulumda DB'ye uygulanan: 1` · `[8/9]` pm2 başlatıldı + kaydedildi · `[9/9]` `KURULUM TAMAM`,
  `API UP DB UP 2.12.1-prova.4b8d916`; kurulum kaydı `yeniMigrationSayisi 1` · `migrationSayisi 368`.
- Ölçüm: uygulama süreci `C:\TeksERP\app\runtime\node.exe` (SYSTEM), `dump.pm2` `exec_interpreter` aynı yol, restart 0 · `/health` 200
  `UP/UP 2.12.1-prova.4b8d916` · tek dinleyici `0.0.0.0:4000` (4001 yok) · `GET /api/boss/overview` 404 · `_prisma_migrations` 368 bitmiş /
  0 sorunlu · `factory_timezone_periods` 0 satır, `company.timezone` ayarı yok → `Europe/Istanbul` · açılış günlüğü kapı zili ve patron-bulut
  "hazır, dışarı istek atmaz", `yoklama zamanlayıcısı aktif — satıcı: lisans-test.etkiliyazilim.com (ortam)` (motor `CALISIYOR`) ·
  `backend-err` yalnız bilinen offsite uyarısı · `asama-dogrula --asama=4`: 4.1–4.3 ✅, 4.4 ⚠️ (belirteç dosyası yok) → çekirdek `native` ·
  bütünlük `GECERLI` · kip `gozlem` ÖLÇÜLEMEDİ (yalnız kimlikli `/api/admin/health` `license` bloğu gösterir).
- Kesinti ≤ 2 dk (`[4/9]` → `[8/9]`); bağlı istemci 0; etkin oturumlar (ELECTRON 7 · MOBILE 12) önce ve sonra aynı.
- Geri dönüş noktaları: kod `C:\TeksERP\app.eski-20260930_134625` (`2.12.0-prova.05b962e`) · veri `premigrate_20260930_134625.dump.tkenc`.
  Önceki denemelerin kalıntıları silindi (klis2'deki eski kaynak/çıktı/kur dizinleri ve arşivleri, `2.12.0-prova.05b962e` zip'leri, `premigrate_20260930_045319`,
  en eski iki `app.eski-*`); son üç `app.eski-*` kalır.
