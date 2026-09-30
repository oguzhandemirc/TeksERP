# Backend `2.12.0`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.11.2** (etiket `backend-v2.11.2` = `72889f5a`; `adnansahin`, 2026-09-28 kurulum kaydı
`backend-2.11.2.md`). Hazırlık kanalında (`testfabrika`, thinkpad-1) kurulu olan, 2026-09-30 03:59'da ölçüldü:
`/health` `UP/UP 2.11.2-lis-prova.771ac50d` · `app\PAKET.json` 363 migration, korumasız, `prova: true`.

Kaynak taslak `docs/surumler/2.12.0-taslak.md` (sürüm numaraları yönetici kararı 2026-09-30, I7: backend
2.12.0 · panel 1.4.0 · tablet 1.0.13). Kod tabanı `origin/main` `55203d97` (İniş A1 + İniş A2). Küçük hane
ELLE (`-Surum 2.12.0`); yama otomatiği `backend-v2.11.2`den 2.11.3 üretir ve bu belgeyi bulamaz.

**Bu belgenin ilk kullanımı hazırlık kanalıdır:** testfabrika'ya KORUMALI **prova** paketi
(`paketle.ps1 -Korumali -Prova -Surum 2.12.0`, sürüm `2.12.0-prova.{yerel sha7}`) kurulur; runbook
`docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md` §4. `adnansahin` paketi (prova olmayan) yalnız kullanıcının terfi
onayıyla ve ayrı bir karar olan `-Korumali` seçimiyle üretilir; o gün yukarıdaki üç alanı `paketle.ps1` yazar.

## 1. Özet

Lisans motoru **gözlem kipinde** (hiçbir istek/modül engellenmez; kira yoksa da gözlem), lisans uçları
(`/api/license/*`), Hakkında/Lisans ekranlarının sunucu tarafı, satıcıya **destek talebi** (`/api/destek`),
**yedek şifreleme** (`.tkenc`; anahtar dizini yoksa davranış aynı), K5 "verilerimi al" giriş dalı, çok parçalı
lisans QR'ı, sipariş oluşturanın doğuşta yazılması ve **patron bulutu eşitlemesinin fabrika tarafı** (hazırlık;
bulut sahada açık değil). Panel **1.4.0** · tablet **1.0.13** ile aynı turda çıkar; backend ÖNCE.

## 2. Ne değişti

- **Lisans (gözlem):** `app.use("/api", licenseGate)` — gözlemde yalnız sayar ("reddedilirdi" sayaçları), reddetmez.
  Kimlik `LICENSE_DIR`'de (kurulumId); parmak izi, yoklama zili, kira doğrulaması, modül tavanı (gözlemde açık).
  Açılışta + günlük paket bütünlüğü denetimi (gözlemde yalnız rapor). Etkinleşmemiş kurulum satıcıya istek atmaz.
- **Destek:** `support_tickets` + `support_ticket_replies`; talep `clientToken @unique`, bağlantı yoksa giden
  kutusunda bekler, yoklama satıcı yanıtlarını çeker.
- **Yedek şifreleme:** gece yedeği, panelden alınan yedek ve `premigrate_` yedeği doğrulandıktan sonra `.tkenc`e
  şifrelenir (yalnız `BACKUP_KEY_DIR` tanımlıysa). Şifreli yedekte önizleme/geri yükleme/kopya
  `X-Backup-Password` ister. Runbook `docs/ops/YEDEK-SIFRELEME.md`.
- **Sipariş künyesi:** panel, hızlı sipariş, içe aktarma ve gelen kutusu siparişinde `createdById/updatedById`
  yazılır (geçmiş NULL kalır, backfill yok).
- **Patron bulutu (hazırlık):** `sync_marks` tetikleyicileri + filigran indeksleri; gelen kutusu makbuzu;
  Yetkilendirme → Patron Bulutu ekranının uçları. `PATRON_CLOUD_URL` yoksa eşitleme koşmaz.
- **İniş A2:** modül şifreleme (2d; varsayılan paket ŞİFRESİZ, şifreli paket yalnız `-Korumali -Sifrele`) ·
  paket bütünlüğü sertleşmesi (2e-S; liste ayrı dosyada, `node_modules` + migration SQL kapsamda; kart yalnız
  satıcı oturumuna çizilir) · DR devrinde ana kurulum kimliği isteğe bağlı (409 `DR_ANA_BELIRSIZ`) · patron
  bildirimleri ve bulut dağıtımı (hazırlık, fabrika paketine etkisi yok). Satıcı sunucusu fabrika paketi DIŞIdır
  ve fabrikadan ÖNCE yayınlanır (runbook §2).
- **Korumalı paket biçimi (`-Korumali`):** `dist\server.jsc` (V8 bayt kodu, hedefte üretilir) · native lisans
  çekirdeği `lisans-cekirdek.win32-x64-msvc.node` (zorunlu kip) · `butunluk.jws` + `butunluk-liste.txt` (PAKET
  anahtarıyla Mac'te imzalı; hazırlık anahtarı `paket-hazirlik` yalnız TEST/DEMO kurulumunda kabul edilir).

**`dist-web` DEĞİŞMEZ bu turda testfabrika için:** prova paketi `-WebPanelHaric` ile üretilir (thinkpad-1
`WEB_DIST_DIR` taşımıyor, web paneli sunulmuyor). `adnansahin` paketinde panel 1.4.0 kaynağından derlenir.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız EKLEYEN (yeni uçlar `/api/license/*`, `/api/destek`, patron bulutu yönetim
  uçları; `login-methods` yanıtına isteğe bağlı `lisansDurduruldu`; yedek listesinde `encrypted`).
- **Eski istemci ne yapar:**
  - *Eski panel (≤ 1.3.7):* `lisansDurduruldu` alanını tanımaz, bugünkü girişi çizer; şifreli yedeği geri
    yükleyemez (parola soramaz, 403) — şifreleme yalnız anahtar töreninden sonra açılır, töreni yapılmamış
    kurulumda görünmez.
  - *Eski tablet (≤ 1.0.12):* lisans reddinde kaydı eskisi gibi düşürür — gözlemde red olmadığı için fark yok.
  - *İzinler:* `license:view`, `license:manage`, `support:create` katalogdan gelir (migration YOK), kimseye
    ATANMAZ; SoD üçlüsüne dokunulmadı.
- **`minVersion` dokunuldu mu:** HAYIR (`src/config/client-version-policy.ts`).

## 4. Migration

- **Var mı:** EVET — **4** adet, hepsi yalnız EKLER:
  `20260929152815_patron_bulut_esitleme` (`sync_marks` + `sync_watermarks`, 33 indeks, 28 satır tetikleyicisi;
  `rolls`/`roll_movements` indeksleri CONCURRENTLY DEĞİL → backend durmuşken `[7/9]`da koşar) ·
  `20260929180000_bulut_gelen_kutusu_makbuzu` · `20260930160000_destek_talepleri` ·
  `20260930170000_destek_talebi_kunye_nullable`.
- **Toplam migration:** **367** (2.11.2'de 363). Kuran `[7/9]`da "367 migrations found" + **4** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok (tetikleyiciler bundan sonraki yazımlarda `sync_marks`a işaret yazar; telemetri
  sınıfı, budanır).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback = yedekten restore.

## 5. Kurulum notu

- **Beklenen kesinti:** ~5–6 dk API kapalı (`[4/9]` → `[9/9]`; 2.11.2 thinkpad-1'de ~6 dk, SAHINSRV'de ≤ 3 dk).
- **Sıra:** backend ÖNCE, panel 1.4.0 + tablet 1.0.13 OTA sonra (tablet native değişmedi → APK yok).
- **Kurulum yöntemi:** paketin kendi `kur.ps1` + `uzaktan-kos.ps1`i çıkarılır (zip SHA256 kıyası), SYSTEM
  görevi: `uzaktan-kos.ps1 -Betik kur.ps1 -ZamanAsimiDakika 45 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'`
  (prova paketinde ek olarak `-ProvaKabul`). `kur.ps1` sunucunun `.env`ini BAYT BAYT korur; korumalı pakette
  `ecosystem.config.js`ini paketin Node'una BAĞLAYARAK birleştirir (env ve diğer ayarlar sunucunun; yedek
  `ecosystem.config.js.onceki`; `[2/9]` satırı `ecosystem.config.js BIRLESTIRILECEK`) — bu düzeltmeyi taşıyan paketle kurulur.
- **Bu sürüme özel:**
  - Korumalı paket HEDEF platformda üretilir (pwsh 7, prizde, ayrık ve düşük öncelikli — DEPLOY-RUNBOOK §3c);
    imzasız korumalı paketi `kur.ps1` REDDEDER; imza Mac'te (`build-korumali-imza.ts zip`).
  - `.env`'e zorunlu yeni anahtar YOK. Hazırlık kanalında kurulumdan ÖNCE yalnız satır EKLENİR:
    `LICENSE_SERVER_URL=https://lisans-test.etkiliyazilim.com` (varsayılan üretim satıcısıdır; hazırlık satıcısı
    yalnız TEST/DEMO HAK'ı imzalar). İsteğe bağlı: `BACKUP_KEY_DIR` (yalnız anahtar töreniyle), `HTTPS_PROXY`,
    `PATRON_CLOUD_URL` (bulut açılana dek YAZILMAZ).
  - İzin ataması kurulumdan sonra panelden (`license:view` / `support:create`).
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma · `C:\TeksERP\pgsql\bin` recursive SİLİNMEZ · `pm2` CLI
  SSH'tan koşulmaz · `-GeriAl` ile `-Zorla` elle birlikte KULLANMA (SYSTEM görevinde soru sorulamaz, orada
  birlikte verilir) · başarısız kurulumu TEKRAR DENEME · **`[7/9]` eşiğinden sonra herhangi bir hata → DUR,
  düzeltme, insana rapor et**.

## 6. Geri alma

`kur.ps1 -GeriAl` (SYSTEM görevi: `uzaktan-kos.ps1 -Betik C:\TeksERP\kur.ps1 -Argumanlar '-Kok C:\TeksERP -GeriAl -Zorla'`)
en yeni geçerli `app.eski-*`i geri koyar. Eşik ÖNCESİ hata: betik kendini toplar, `app.eski-*` oluşmaz. Eşik
SONRASI: dört migration yalnız EKLER; eski 2.11.2 kodu yeni tabloları okumadan çalışır, fakat tetikleyiciler
`sync_marks`'a yazmaya devam eder (zararsız, budanır). Veri dönüşü gerekiyorsa `[3/9]`da alınan
`C:\TeksERP\backups\premigrate_*.dump`tan restore (şifreliyse önce yedek parolasıyla düz kopyaya çözülür).
`LICENSE_SERVER_URL` satırı kalabilir (etkinleşmemiş kurulum dışarı çıkmaz). `[7/9]` yarıda düşerse Prisma
o migration'ı FAILED işaretler — elle `resolve` YAPILMAZ, insana rapor edilir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + pm2 (SYSTEM görevi ya da `pm2-oku`; online, restart sayısı)
- `/health` → `UP/UP 2.12.0` (prova: `2.12.0-prova.{yerel sha7}`)
- `[7/9]`: 4 migration uygulandı; `_prisma_migrations` 367 bitmiş / 0 sorunlu, son
  `20260930170000_destek_talebi_kunye_nullable`
- `backend-err*.log` son satırlar — yeni hata var mı
- korumalı paket: `korumali=True` · çekirdek `native` · `butunluk GECERLI` (hazırlıkta `butunlukKid paket-hazirlik…`)
  · lisans motoru `CALISIYOR`, kip `gozlem`, etkinleşmemiş (runbook §4.5, `asama-dogrula --asama=4 --olc`)
- `GET /api/license/durum` → `kip: gozlem`; hiçbir istek 403 `LICENSE_*` almamış
- panel/tablet oturumları kurulum sonrası yeniden bağlandı
- ölçülen kesinti

**Kurulum kaydı — 2026-09-30 (testfabrika / thinkpad-1, KORUMALI PROVA) — BAŞARISIZ, GERİ ALINDI:**

- Paket `tekserp-backend-prova-20260930_043616-e970149.zip` · imzasız SHA256 `9D537D0DB8207AD2A7CCEA551C999D9A9798B7023E0F2F141F060494617537B6`
  → imzalı (kid `paket-hazirlik`) SHA256 `2CDDB44F5087FEC287203D58B3B2AEC55D3D92A07DF350370A80E1EA170AD651` · sürüm
  `2.12.0-prova.e970149` (kaynak: dal `ops/testfabrika-2.12.0` ucunun `git archive`ı; son ek hedefteki tek yerel commit, depoda yok) · 13386 dosya · 367 migration.
- `[1/9]`–`[8/9]` yeşil: korumalı + imzalı liste + native çekirdek + runtime node 24.18.0 kapıları OK; premigrate
  `premigrate_20260930_045319.dump.tkenc` (9,52 MB, doğrulandı); `[7/9]` 367 found, 4 uygulandı.
- `[9/9]` ❌ 120 sn sağlık yok: pm2 uygulamayı SİSTEM Node'uyla (v26.4.0, V8 14.6) başlattı, yükleyici reddetti
  ("KORUMALI PAKET bu Node ile ACILAMAZ" — paket V8 13.6). Kök neden: `kur.ps1` sunucunun ESKİ `ecosystem.config.js`ini
  korudu ve onda `interpreter`/`RUNTIME_NODE` bağı yok (paketin `.paket` kopyasında var). **Korumalı paketin ilk
  kurulumundan ÖNCE sunucu ecosystem'ine runtime bağı eklenmeli ya da `kur.ps1` bu durumda `[3/9]`dan önce durmalı.**
  → Çözüm (F-ECO, dal `fix/ecosystem-yukseltme`): `kur.ps1` `[2/9]`da sunucunun dosyasını paketin Node'una bağlayarak
  birleştirir, `[8/9]`da delete + start; okunamazsa `[3/9]`dan önce durur (DEPLOY-RUNBOOK ecosystem notu).
- Geri alma (SYSTEM, `-Kok C:\TeksERP -GeriAl -Zorla`): `API UP / DB UP / v2.11.2-lis-prova.771ac50d`; DB 367 migration'da
  kaldı (dördü yalnız ekler; eski kod açıldı, `backend-err` yalnız bilinen offsite uyarısı). Kesinti ~7 dk (04:59 → 05:06);
  bağlı istemci 0; etkin oturumlar (ELECTRON 7 · MOBILE 12) değişmedi.
- Geri dönüş noktaları: kod `C:\TeksERP\app.eski-20260930_045319` şimdi yine `app` · başarısız kurulum
  `C:\TeksERP\app.basarisiz-20260930_050608` · veri `C:\TeksERP\backups\premigrate_20260930_045319.dump.tkenc`.

**Kurulum kaydı — 2026-09-30 (testfabrika / thinkpad-1, KORUMALI PROVA, ikinci deneme — F-ECO `kur.ps1`) — BAŞARILI:**

- Kaynak `origin/main` `47b9d825`in `git archive`ı (hedefte tek yerel commit; sürüm `2.12.0-prova.05b962e`, son ek o yerel commit'tir,
  depoda yoktur). Native yeniden kullanıldı: `Teks-Erp/native` `55203d97`..`47b9d825` arasında farksız, `e2691bc1…7c90`.
- Paket `tekserp-backend-prova-20260930_054621-05b962e.zip` · imzasız SHA256 `1E2A114CFABB144C000ADCB961323E01BABD1D1B748E97029497843C14E85F95`
  → imzalı (kid `paket-hazirlik`, 13377 dosya kapsam) SHA256 `BB757C725CE01943D2D3AAE0B20A5CF301DB094F4EEA05A246E467BA543DB7A1` ·
  13386 dosya · 367 migration · paketin `kur.ps1`i depodaki `deploy/kur.ps1` ile bayt-eşit.
- `-UygulamaAdi tekserp-backend-yeni` (çalışan ad pm2 pid dosyası + `dump.pm2`'den ölçüldü); paketin kanal kimliği
  `tekserp-backend-testfabrika` → `[1/9]` beklenen uyarıyı bastı, ad değiştirilmedi.
- `[2/9]` `ecosystem.config.js BIRLESTIRILECEK: yorumlayici sistem Node -> runtime/node.exe … env 14 anahtar AYNEN` ·
  `[3/9]` `premigrate_20260930_055943.dump.tkenc` (9,56 MB, doğrulandı) · `[7/9]` DB O2'den 367'de, yeni migration yok ·
  `[8/9]` `pm2 delete` + `start` + `save` · `[9/9]` `KURULUM TAMAM`, `API UP DB UP 2.12.0-prova.05b962e`, kayıt `kurulum-gecmisi.jsonl`'de.
- Ölçüm: uygulama süreci `C:\TeksERP\app\runtime\node.exe` (SYSTEM), `dump.pm2` `exec_interpreter` aynı yol, restart 0 ·
  `app\ecosystem.config.js` birleşik (`KUR.PS1 BIRLESTIRMESI` başlığı), `.onceki` önceki sunucu dosyasıyla bayt-eşit ·
  `/health` 200 `UP/UP 2.12.0-prova.05b962e` · `asama-dogrula --asama=4`: 4.1–4.3 ✅, 4.4 ⚠️ (belirteç dosyası yok) ·
  açılış günlüğü `yoklama zamanlayıcısı aktif — satıcı: lisans-test.etkiliyazilim.com (ortam); etkinleşmemiş kurulum dışarı
  istek atmaz` (motor `CALISIYOR`) · `backend-err` yalnız bilinen offsite uyarısı. Çekirdek `native` · bütünlük `GECERLI` ·
  kip `gozlem` ÖLÇÜLEMEDİ: native düşüşü sessizdir (`CEKIRDEK_YOK`, süreç düşmez), yalnız kimlikli `/api/license/durum` gösterir.
- Kesinti ≤ 2 dk (`[4/9]` → `[8/9]`); bağlı istemci 0; etkin oturumlar (ELECTRON 7 · MOBILE 12) değişmedi.
- Geri dönüş noktaları: kod `C:\TeksERP\app.eski-20260930_055943` (2.11.2-lis) · veri `premigrate_20260930_055943.dump.tkenc` ·
  `-GeriAl` birleştirmeyi simetrik geri alır. İlk denemenin kalıntıları (`app.basarisiz-20260930_050608`, klis2'deki iki eski zip) silindi.
- Kozmetik bulgu: `[5/9]` birleştirmeden sonra da `ecosystem.config.js: sunucununki KORUNDU (paketinki: .paket)` başlığıyla anahtar
  farkını basıyor — birleşik dosyada yanıltıcı (ölçüm birleştirmenin yapıldığını gösteriyor).
