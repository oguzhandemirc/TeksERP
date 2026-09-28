# Backend `2.11.2`

**Paket:** `tekserp-backend-20260928_213101-72889f5a.zip`
**SHA256:** `C758660D1DEA6B32C07E934679068A1096FD22DB1FB1634C7F7171EA1799C527`
**Commit:** `72889f5a`
**Önceki saha sürümü:** **2.10.0** (etiket `backend-v2.10.0` = `63b50d78`; SAHINSRV'de 2026-09-28 21:23 ölçüldü: `/health` 2.10.0 · `app\PAKET.json` 2.10.0 / 347 migration / commit `63b50d78` · `_prisma_migrations` 347 bitmiş, 0 sorunlu, son `20260924001000_roll_series_max_value` · pm2 `tekserp-backend-yeni` online, restart 0 · `company.name` ayar satırı YOK).

**2.11.0 ve 2.11.1 sahaya hiç çıkmadı** — ikisi de yalnız test fabrikasına (thinkpad-1) prova paketi olarak kuruldu
(`2.11.1-prova.1c85b778`, `2.11.2-prova.13d781f2`). Bu belge üçünün birleşimidir; kaynak taslaklar
`docs/surumler/2.11.0-taslak.md` (BACKEND + YAYIN GÜNÜ bölümleri) ve `2.11.1-taslak.md`. Küçük hane ELLE
artırıldı (2.10.0 → 2.11.x = yeni yetenek); paketleme **`-Surum 2.11.2`** ile koşulur (yama otomatiği
`backend-v2.10.0`dan 2.10.1 üretir ve bu belgeyi bulamaz).

**Backend kodu test fabrikasında denenenle AYNI:** `git diff 13d781f2 4de814f5 -- Teks-Erp/` boş (ölçüldü
2026-09-28); aradaki iki commit yalnız panel (`Electron/`) ve sürüm notu. Paket bu belgeyi taşıyan docs
commit'inden çıkar; `dist-web` (web paneli) panel 1.3.7 kaynağından derlenir.

**Terfi onayı (kullanıcı, 2026-09-28 21:1x):** "gerekli testleri ben de yaptım test fabrikasında ve bir sorun
yaşamadım. adnansahin fabrikasına hem backend hem de clientlere güncelleme çıkabiliriz artık." · zamanlama:
"Şimdi, vardiya yok". Panel/tablet terfi etiketleri `terfi/adnansahin/panel-v1.3.7` (`4de814f5`) ve
`terfi/adnansahin/tablet-v1.0.12` (`13d781f2`).

## 1. Özet

Ürün kartı yaşam döngüsü (Aktif · Tükenene kadar · Pasif) ve canlı referanslı ana verinin arşivlenememesi,
top durum defteri, iş emri hareket defteri + kapanış künyesi, kartela olay defteri, tekrar gönderimin tek
boğazdan cevaplanması (token replay), çek teslim bordrosu hareket fişi (bayrak KAPALI), firma adının koddan
veriye dondurulması ve **müşteri × kumaş × renk adı** (kumaşa özel müşteri renk adı: tablo, uçlar, içe
aktarma şablonu). Panel **1.3.7** · tablet **1.0.12** ile aynı turda çıkar; tablet OTA'sı backend'den ÖNCE
yayınlandı (§5 sıra).

Ölçüm (git, `backend-v2.10.0..4de814f5`): **217** commit, **148**'i `Teks-Erp/`a dokunuyor · **16** yeni
migration (toplam **363**) · yeni ortam değişkeni **0** (`ecosystem.config.js` farkı yalnız yorum satırı).

## 2. Ne değişti

- **Ürün yaşam döngüsü ve arşiv seddi** — ürün kartı üç durumlu; "Sil" yerine "Kullanımdan kaldır"; canlı
  kaydı (top, açık iş emri, sipariş kalemi, kartela, çuval, bakiye…) olan ürün/renk/müşteri/depo/fasoncu
  pasife alınamaz (409 + kayıt listesi). DB tetikleyicileri `rolls_item_not_archived` ·
  `order_lines_item_not_archived` · `rolls_color_not_archived` · `swatches_master_not_archived`
  (23514 → 409 Türkçe). Göç: bugün pasif olup canlı kaydı olan kartlar `PHASE_OUT` ("Tükenene kadar") olur.
- **Top durum defteri** (`roll_status_events`, append-only, DB tetikleyicisi yazar; aynı andaki geçişlerin
  kesin sırası DB saati + son olay + 1 ms).
- **İş emri hareket defteri + kapanış künyesi** (`work_order_events`, `work_order_close_snapshots`);
  tamamlanmış iş emrine top getiren her yol 409 `WO_COMPLETED_NO_ADD` (iş emri artık kendiliğinden yeniden
  açılmaz); iş emri numarası düzenlemede değişmez; başlamış iş emrinde renk/en/sipariş bağı yalnız tek amaçlı
  uçlardan; yeni izin `mobile:is-emri-duzelt` (varsayılan rol paketinde YOK); Parti Ekle ucu
  `POST /api/work-orders/:id/batches`; aynı iş emrinde parti numarası çakışmaz.
- **Kartela olay defteri** (`swatch_events` + `swatches.status`), Kartela Hareketleri ucu `GET /api/kartela/events`,
  durum seddi `swatches_status_shape` (ihlalli eski veride NOT VALID kalır).
- **Token replay tek boğaz** — kayıt yaratan ~40 uçta aynı `clientToken`lı tekrar ilk kaydı döner; farklı
  gövde 409 `CLIENT_TOKEN_COLLISION`; iptal edilmiş kaydın tekrarı adlı 409 (`CASH_TXN_CANCELLED`,
  `WORK_ORDER_CANCELLED`, `TRANSFER_CANCELLED`, `INVOICE_CANCELLED`, `PAYMENT_CANCELLED`, `CHEQUE_CANCELLED`,
  `PURCHASE_ORDER_CANCELLED`, `GOODS_RECEIPT_CANCELLED`, `WARP_BEAM_*`, `BATCH_MERGED`…). Ayrıntı:
  `2.11.0-taslak.md` BACKEND bölümü.
- **Çek bordrosu** — taslak önizleme ucu, resmî bordroda `clientToken`; hareket fişi bayrağı
  `finance.chequeNoteMovementEnabled` (varsayılan KAPALI = bugünkü davranış).
- **Fason** — çok partili sevkte `multiBatchStrategy` (`SEPARATE` | `MERGE`; alan yoksa bugünkü 409
  `MULTI_BATCH`); kabulde isteğe bağlı `batchId`.
- **Stok defteri** — yeni ters kodlar `ROLL_DETACH` ve `PRODUCTION_ISSUE_TRANSFER`; iptal edilen iş
  emrindeki toplar alındıkları yere döner.
- **Firma adı** (2.11.1) — koddaki varsayılan nötr "TeksERP"; migration `20260928120000_firma_adi_dondur`
  `company.name` satırı olmayan ve verisi olan kurulumlara bugüne kadar görünen adı SATIR olarak yazar
  (SAHINSRV'de satır yok → yazılacak; ekrandaki ad DEĞİŞMEMELİ, §7).
- **Müşteri × kumaş × renk adı** (2.11.2, `docs/design/MUSTERI-KUMAS-RENK-ADI.md`) — tablo
  `customer_item_color_aliases`; uçlar `GET/PUT/DELETE /api/customers/:id/item-color-aliases[/:itemId/:colorId]`
  ve `GET /api/items/:itemId/customer-color-aliases` (izin `customer-alias:read|write`, yeni izin kodu yok);
  tek çözücü zinciri (sipariş satırı adı → kumaşa özel ad → genel müşteri renk adı → renk adı); yanıtlara
  isteğe bağlı `colorNameScope` / `resolvedCustomerColorName`; içe aktarma şablonu "Müşteri Kumaşa Özel
  Renk Adları" (eski panelde de görünür — liste `/api/import/entities`ten dinamik).
- **Sağlık ucu** — `/api/admin/health` → `masterDataArchive` · `unvalidatedConstraints`.
- **Sahadaki elle yama kapandı** — `pg-tool.helper` stdout boşaltma düzeltmesi (`bb914927`) pakette; 2.10.0
  kurulum kaydındaki `pg-tool.helper.js` elle yaması bu kurulumla KODA girer (`….js.2.10.0-orijinal` kopyası
  eski `app.eski-*` içinde kalır).
- **Kurulum betikleri** — `kur.ps1` SSH oturumunda daemon yoksa durur, iş `uzaktan-kos.ps1` SYSTEM görevine
  verilir; sır dosyaları ACL daraltması; yayın günü araçları pakette (`dist\tools\*.cjs`).

**`dist-web` DEĞİŞTİ** — panel kaynağı 1.3.3 → 1.3.7; web arayüzü paketi yeniden derlenir (SAHINSRV `.env`inde
`WEB_DIST_DIR` yok → web paneli bugün de sunulmuyor, davranış değişmez).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız EKLEYEN (yeni tablo, yeni uç, yanıtlarda isteğe bağlı alan, yeni hata
  kodları). Kaldırılan uç 0, enum değeri kaldırılan 0, zorunlu hâle gelen parametre 0.
- **Eski istemci ne yapar:**
  - *Eski panel (1.3.3):* "Sil" canlı kayıtta 409 alır ve genel hata tostunu gösterir; başlamış iş emrinde
    renk/en değişikliği 409 (mesaj Türkçe); yeni 409 kodlarını genel hata tostunda gösterir; sipariş detayı
    kumaşa özel adı olan satırda GENEL adı gösterir (panel güncellenene kadar); "Müşteri Kumaşa Özel Renk
    Adları" içe aktarma şablonu eski panelde de görünür.
  - *Eski tablet (1.0.8 ve altı):* ⚠️ **Tambur etiket önizlemesindeki "kalıcı" kayıt kumaşa özel adı GENEL
    ada yazabilir** (tasarım §7) — risk yalnız kumaşa özel ad VARKEN doğar (panel 1.3.7 ekranı ya da içe
    aktarma); tablet 1.0.12 OTA'sı bu yüzden backend'den ÖNCE yayınlandı. Kumaşa özel ad girmeden önce
    `Session.clientVersion` ile her tabletin 1.0.12'ye geçtiği görülmeli (§7, kontrol listesi ②).
  - *Token replay:* eski istemci aynı token'lı tekrarda 200/201 alır (başarı sayar); farklı gövde 409.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — **16** adet:
  `20260925100000_urun_yasam_dongusu` · `20260925160000_roll_status_events` ·
  `20260925180000_roll_status_events_kaynak` · `20260925200000_urun_arsiv_db_seddi` ·
  `20260926000000_work_order_events` · `20260926010000_work_order_close_snapshots` ·
  `20260926020000_reason_preset_kind_work_order_plan_change` · `20260926030000_batch_client_token` ·
  `20260926030000_cek_bordro_client_token` · `20260926100000_kartela_olay_defteri` ·
  `20260926110000_kartela_durum_seddi` · `20260926140000_cek_olayi_bordro_bagi` ·
  `20260926170000_roll_status_event_sira` · `20260926190000_arsiv_seddi_kartela_renk` ·
  `20260928120000_firma_adi_dondur` · `20260928133711_musteri_kumas_renk_adi`.
- **Toplam migration:** **363** (2.10.0'da 347). Kuran `[7/9]`da "363 migrations found" + **16** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** ürün yaşam döngüsü göçü (pasif + canlı kayıtlı kart → `PHASE_OUT`, sebep satırı) ·
  `company.name` satırı (yoksa) · kartela durum göçü · sebep türü `WORK_ORDER_PLAN_CHANGE` (enum
  `ADD VALUE IF NOT EXISTS`). Seddi NOT VALID bırakabilen: `swatches_status_shape` (ihlalli eski satır
  varsa, NOTICE ile).
- **Prova:** 23 Eylül fabrika dökümünde temiz ve idempotent (2.11.0 taslağı); test fabrikasında (thinkpad-1)
  362 → 363 temiz (2026-09-28 19:2x, `2.11.2-prova.13d781f2`).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback = yedekten restore.

## 5. Kurulum notu

- **Beklenen kesinti:** ~5–6 dk API kapalı (`[4/9]` → `[9/9]`; test fabrikasında 2.11.2 kurulumu ~6 dk ölçüldü).
- **Sıra:** tablet 1.0.12 OTA (yayında) → backend 2.11.2 → panel 1.3.7. Sözleşme bağımlılığı yok; tabletin
  önce çıkması §3'teki sızıntı riskini kapatmak içindir (tasarım §7, bilinçli sapma).
- **Kurulum yöntemi:** paket `C:\TeksERP\guncelleme\`e; paketin kendi `kur.ps1` + `uzaktan-kos.ps1`i çıkarılır,
  `C:\TeksERP\kur.ps1` onunla değiştirilir; SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'` (uygulama adı varsayılan
  `tekserp-backend-yeni` = sahadaki). `kur.ps1` çıktısı PowerShell yönlendirmesiyle ALINMAZ (2.10.0 dersi);
  uzaktan-kos kendi log'unu `C:\TeksERP\logs\uzaktan-*.log`a yazar.
- **Bu sürüme özel:**
  - **Yayın günü veri araçları** (`2.11.0-taslak.md` Yayın Günü ③–⑥b) pakette `dist\tools\*.cjs` olarak
    gelir; deneme varsayılan, `--apply --onay=N --hedef=tekserp_yeni` **KULLANICININ** işidir ve bu kurulumda
    KOŞULMADI: `backfill_roll_status_events` · `backfill_roll_fold_and_reason` ·
    `fix_tambur_undo_cancel_marker` (⚠️ taslakta "panel/tablet açılmadan aynı pencerede" — koşulmazsa eski
    Tambur geri alma parçaları "geri alınabilir" görünür) · `backfill_workorder_events` ·
    `kartela_durum_anomali`.
  - **⑦ salt-okur liste** (göçün "Tükenene kadar"a aldığı kartlar) kurulumdan sonra okunur ve kurulum
    kaydına yazılır.
  - **⑩ teslim bordrosu hareket fişi bayrağı** panel 1.3.7 sahadayken, kullanıcı kararıyla açılır.
  - mDNS: SAHINSRV ecosystem'inde `DISCOVERY_MDNS_ENABLED` yorum satırı (kapalı) — sunucununki KORUNUR.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma, `postgresql-tekserp` servisine dokunma ·
  `C:\TeksERP\pgsql\bin` JUNCTION'dır (→ `D:\PostgreSQL\16\bin`), recursive SİLİNMEZ · gece yedeği görevi
  `TeksERP-DB-Backup-Yeni` (03:00) çakışmamalı · elle koşumda `-GeriAl` ile `-Zorla` birlikte KULLANMA · başarısız
  kurulumu TEKRAR DENEME · **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**.

## 6. Geri alma

`kur.ps1 -GeriAl` (elle, yönetici PowerShell'de: `-GeriAl` tek başına, onay sorar; SYSTEM görevinde soru
sorulamadığı için uzaktan-kos ile `-Kok C:\TeksERP -GeriAl -Zorla`) en yeni geçerli `app.eski-*`i (bu kurulumun kenara
aldığı 2.10.0) geri koyar. Eşik ÖNCESİ hata: betik kendini toplar, `app.eski-*` oluşmaz. Eşik SONRASI
(`[7/9]`'da migration uygulandıysa): 16 migration yalnız EKLER (yeni tablo/kolon/tetikleyici); ancak yeni
tetikleyiciler (arşiv seddi, top durum defteri) 2.10.0 kodunun yazımlarına da uygulanır — eski kodun yeni
şemada davranışı ÖLÇÜLMEDİ ⇒ güvenli dönüş = **premigrate yedeğinden restore** (`[3/9]`da alınan
`C:\TeksERP\backups\premigrate_*.dump`; kurulum kaydında dosya adı ve boyutu) + `-GeriAl`. `[7/9]` yarıda
düşerse Prisma o migration'ı FAILED işaretler — elle `resolve` YAPILMAZ, insana rapor edilir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı; iki ölçüm arası pid ve başlama saati DEĞİŞMEMELİ)
- `/health` → `UP/UP 2.11.2`
- `[7/9]`: 16 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu, son
  `20260928133711_musteri_kumas_renk_adi`
- `backend-err*.log` son satırlar — yeni hata var mı
- `company.name` satırı = **"Adnan Şahin Tekstil"** ve `GET /api/auth/login-methods` → `companyName` aynı
  (kurulumdan önce ölçülen değer)
- yeni uç kimliksiz 401: `GET /api/items/{uuid}/customer-color-aliases`
- ⑦ listesi (salt-okur, `BEGIN READ ONLY`):
  `SELECT code, name FROM items WHERE "lifecycleStatus" = 'PHASE_OUT' AND "lifecycleReason" IS NOT NULL ORDER BY code;`
- ölçülen kesinti
- tablet yayılımı: `sessions.clientVersion` (MOBILE) dağılımı — kumaşa özel ad girilmeden önce her tablet
  1.0.12 olmalı (tasarım §7 ②; gözlemdir, sunucu kapısı değil)

**Kurulum kaydı — 2026-09-28 (SAHINSRV, uzaktan SYSTEM görevi, vardiya yokken):**

- Yöntem: paket `C:\TeksERP\guncelleme\`e scp; paketin `kur.ps1`/`uzaktan-kos.ps1`i `guncelleme\k2112\`ye
  çıkarıldı (zip SHA256 tuttu); `C:\TeksERP\kur.ps1` pakettekiyle değişti (eski kopya
  `guncelleme\kur.ps1.2.10.0-yedek`); görev `TeksERP-Uzaktan-20260928_213826`, log
  `C:\TeksERP\logs\uzaktan-20260928_213826.log`, çıkış 0; görev kendini sildi.
- `[1/9]`–`[9/9]` 21:38:26 → 21:41:12; `premigrate_20260928_213826.dump` (9,52 MB, doğrulandı); eski kurulum
  `C:\TeksERP\app.eski-20260928_213826` (2.10.0). **API kesintisi ≤ 3 dk** (görev 21:38:26 → sağlık 21:41:12; API `[3/9]` yedeğinden sonra durdu,
  yeni süreç 21:40:28'de kalktı).
- `[7/9]` 16 migration uygulandı, "363 migrations found"; NOTICE/WARNING CLI'da görünmedi.
- Sonra (21:42 ve 21:44, iki ölçüm): `/health` UP/UP 2.11.2 · pm2 `tekserp-backend-yeni` pid 205316 SYSTEM,
  restart 0, iki ölçümde aynı · daemon pid 11944 değişmedi · `pm2-logrotate` yeniden kuruldu (restart 3,
  test fabrikasındaki gibi) · `_prisma_migrations` 363 bitmiş / 0 sorunlu, son
  `20260928133711_musteri_kumas_renk_adi` · 5 yeni tablo var, `customer_item_color_aliases` 0 satır ·
  NOT VALID kısıt yalnız `rolls_qty_le_initial` (beklenen) · `company.name` = "Adnan Şahin Tekstil" (migration
  yazdı), `login-methods` `companyName` kurulumdan önceki değerle aynı · yeni uçlar kimliksiz 401 ·
  ecosystem sunucununki korundu (mDNS ilanı kurulum öncesi gibi açık) · boot uzlaştırması:
  `mobile:is-emri-duzelt` izni + `ADMIN_FULL` şablonuna eklendi, numara serisi kataloğu 53 · `backend-err`
  yalnız önceden de görülen pg `DeprecationWarning`.
- ⑦ göçün "Tükenene kadar"a aldığı kartlar (10): STK-000003 · STK-000004 · STK-000005 · STK-000006 ·
  STK-000012 · STK-000019 · STK-000031 · STK-000032 · STK-000093 · STK-000177 (adlarıyla liste 1e'nin
  kurulum raporunda; fabrika verisi olduğu için belgeye yalnız kod). Ürün durumları: Aktif 140 · Tükenene kadar 10 · Pasif 115.
- Kurulumun uyarısı (düzeltilmedi, kullanıcı kararı): `C:\TeksERP\backups` ve `C:\TeksERP\pg-setup`
  `BUILTIN\Users` + `Authenticated Users`a açık — daraltma `ilk-kurulum.ps1` izin adımıyla.
- **KOŞULMADI (kullanıcıda):** yayın günü araçları ③–⑥b (deneme dahil) ve ⑩ bayrağı.
- Geri dönüş noktaları: kod `C:\TeksERP\app.eski-20260928_213826` (`kur.ps1 -GeriAl`) · veri
  `C:\TeksERP\backups\premigrate_20260928_213826.dump`.
- Aynı pencerede: tablet OTA 1.0.12 (21:2x, backend'den önce) ve panel 1.3.7 (22:09) `adnansahin` kanalında.
