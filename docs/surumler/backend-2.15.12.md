# Backend `2.15.12`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.11 (`test` grubu, etiket `backend-v2.15.11`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Dokuma topu KK1'de doğabilir (yeni ayar `dokuma.rollBirth`, üç mod).** `TABLET_DOFF` (varsayılan = bugünkü yol:
  top tablette İNDİR ile doğar) · `KK1_LABEL_OR_ORDER` (ham girişte tezgah etiketi ya da açık dokuma iş emri) ·
  `KK1_LABEL_ONLY` (ham girişte yalnız tezgah etiketi). KK1 yollarında indirme kaydını sunucu topla aynı işlemde yazar.
  Ayar değiştirilmedikçe hiçbir davranış değişmez.
- **Tezgah ve levent etiketi.** İki yeni etiket türü (`MACHINE`, `WARP_BEAM`) ve baskı uçları; şablon atanmamışsa
  baskı yapılmaz.
- **Üç yeni dokuma raporu.** Levent Sonucu, Kapasite Kullanımı, Levent Bitiş Tahmini.
- **Tarayıcı paneli** (imajda taşınan web paneli) bu turun panel ekranlarını taşır: tezgah/levent etiketi basma, üç
  rapor sayfası, "Dokuma topu nerede doğar" ayarı. **Masaüstü panel paketi bu turda ÇIKMADI** (ayrı tur; çıktığında
  1.6.7 numarasıyla 2026-10-20 ve 2026-10-21 panel maddelerini birlikte taşıyacak). Deneme kurulumu panel
  değişikliklerini bu imajdaki web panelinden görür.
- Tablet 1.4.2 (vc64) aynı turda Play dahili teste çıkar: KK1'de tezgah etiketi/iş emri ile top doğuşu, Levent Sarım
  ekranı istasyon düzeni, levent takmada barkod.

## 2. Ne değişti

**KK1 top doğuşu — S1** (PR #79; commit'ler `9e4d3c112`, `ef88da870`, `6db146818`, `b47f9dd56`, `0d8e4131b`,
`87d56fe74`; kural `docs/kurallar/dokuma.md`, `docs/kurallar/kk1.md`)

- Yeni ayar `dokuma.rollBirth` (enum; `PUT` özellik anahtarları gövdesinde `dokumaRollBirth`), varsayılan `TABLET_DOFF`.
- `POST /api/rolls/initial-entry` gövdesine isteğe bağlı alanlar: `machineCode` (tezgah etiketi) XOR `weavingOrderId`
  (açık dokuma iş emri), `warpBeamId` (levent beyanı, yalnız `machineCode` ile; son 12 saatte o tezgahta
  takılmış/sökülmüş olmalı), `productionLineNo` (yalnız `machineCode` ile). `doffEventId` ile birlikte verilemez.
  Sunucu açık koşumdan indirme kaydını (kaynak OPERATOR, sayaç boş) topla AYNI işlemde üretir, topu bağlar, bağlı
  leventten otomatik tüketir. İş birden çok tezgahta koşuyorsa indirme ve levent tüketimi yazılmaz; top yeni
  `Roll.weavingOrderId` kolonu ile işe bağlanır ve cevap `warnings` taşır.
- Mod kapısı: KK1 alanları `TABLET_DOFF` modunda 400 `ROLL_BIRTH_MODE`; `KK1_LABEL_ONLY` modunda iş emri seçimi
  400 `ROLL_BIRTH_MODE`; dokuma kapalıysa 403 `MODULE_DISABLED`. Yeni hata kodları: `MACHINE_NOT_LOOM`,
  `WEAVING_ORDER_SUBCONTRACTED`, `WARP_BEAM_NOT_RECENT`, `PRODUCTION_LINE_OUT_OF_RANGE`, `MACHINE_NO_OPEN_RUN`,
  `WEAVING_ORDER_NOT_OPEN`, `WEAVING_ORDER_NO_OPEN_RUN`, `DOFF_CODE_COLLISION`. `clientToken` tekrarı aynı cevabı verir.
- Yeni salt okuma ucu `GET /api/machine-doffs/kk1-context?machineCode=…` — KK1 ekranının ön doldurması (açık koşum,
  iş, takılı levent); değerler öneridir.
- `GET /api/weaving-orders` listesi `mobile:kk1` iznine de açıldı (KK1'in iş emri seçim listesi; yeni izin kodu yok).
- Bekçiler: `test_kk1_roll_birth` (yeni), `test_dokuma_regime_gate`, `test_mobile_screen_permissions` (#82: dokuma
  tablet ekranındaki levent takma okumaları `mobile:devere` arkasında beyanlı muaf).

**Etiket türleri — S1b** (PR #76; commit'ler `0896f4eb6`, `d3d6af889`)

- `LabelKind` + `MACHINE` (tezgah etiketi, barkod = tezgah kodu) ve + `WARP_BEAM` (levent etiketi, barkod = levent no).
- Yeni uçlar `GET /api/labels/machines/:id` (+ `/html`, `/native`), `POST /api/labels/machines/:id/print-event`,
  `GET /api/labels/warp-beams/:id` (+ `/html`, `/native`), `POST /api/labels/warp-beams/:id/print-event`.
  Şablon atanmamış türde baskı yapılmaz ve nedeni döner; tek seferde en fazla 200 adet.

**Üç dokuma raporu — S1c** (PR #75; commit `711ccf6b0`)

- `GET /api/reports/dokuma/levent-sonucu`, `/kapasite-kullanimi`, `/levent-bitis-tahmini`. Levent raporları Devere
  modülü kapalıyken kapalıdır. Hesaplanamayan değer `null` + gerekçe döner, sıfır uydurulmaz.

**Tarayıcı paneli** (imajdaki web paneli; PR #78 S4a, #81 S4b) — Üretim İstasyonları'nda tezgah etiketi, Leventler
listesinde "Levent etiketi bas", Raporlar → Dokuma'da üç rapor sayfası, Sistem → Özellik Anahtarları → Dokuma'da
"Dokuma topu nerede doğar" ayarı (KK1 yolu seçilip Devere'de levent tezgah bağı ya da otomatik levent düşümü
kapalıysa sarı uyarı). Masaüstü panel paketi bu turda yok (bkz. §1).

**Tablet tarafı (sunucu değişikliği değil, bilgi için)** — PR #77 S3b (Levent Sarım istasyon düzeni, levent etiketi
kuyruğu), PR #80 S3 (KK1 tezgah etiketi/iş emri, levent takmada barkod; KK1 modlarında tezgah ekranında İNDİR gizli).

**Pakete girmeyenler:** `Teks-Erp/scripts/dokuma-urun-adi-ayikla.ts` (S5, PR #73 — ürün adı ayıklama betiği,
varsayılan dry-run; sahada koşulmadı), plan belgeleri.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Yalnız yeni uçlar, yeni isteğe bağlı gövde alanları ve yeni enum değerleri eklendi; var olan
  uçların cevabı değişmedi.
- **Eski istemci ne yapar:** eski tablet (≤ 1.4.1) yeni alanları göndermez; `doffEventId` yolu (tablette İNDİR, KK1'de
  indirme seçimi) mod kapısından GEÇMEZ ve **her modda** bugünkü gibi çalışır. Ayar KK1 moduna alınırsa eski tablet
  KK1'de tezgah etiketi okutamaz ve tezgah ekranında İNDİR'i göstermeye devam eder — bu yüzden ayar ancak tabletler
  1.4.2'ye geçtikten sonra değiştirilmeli. Eski masaüstü panel (≤ 1.6.6) yeni ayarı, etiket türlerini ve raporları
  göstermez; ayar varsayılanda kaldığı sürece etkisi yoktur. Yeni tablet eski sunucuya (≤ 2.15.11) bağlanırsa KK1
  modu okunamaz, varsayılan yol işler.
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** EVET — 3 yeni migration.
  - `20261021180000_label_kind_machine` — `ALTER TYPE "LabelKind" ADD VALUE 'MACHINE'` (geri alınamaz).
  - `20261021181000_label_kind_warp_beam` — `ALTER TYPE "LabelKind" ADD VALUE 'WARP_BEAM'` (geri alınamaz).
  - `20261021200000_roll_weaving_order_link` — `rolls."weavingOrderId"` (UUID, boş olabilir) + index + FK
    (`weaving_orders`, RESTRICT) + CHECK `rolls_weaving_order_xor_ck` (indirme bağı ile iş bağı aynı anda dolu olamaz;
    mevcut satırlarda kolon boş olduğundan sağlanır). Eklemeli, veri yazmaz.
- **Toplam migration:** 395 (2.15.11'de 392). Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
  (Paketleme anında yeniden sayılır.)
- **Prova:** üçü de eklemeli ve `IF NOT EXISTS` korumalı; deneme kurulumu ilk prova yeridir.
- **Geri alınabilir mi:** HAYIR (iki enum `ADD VALUE`). 2.15.11 imajı göç kümesi eşit olmadığı için güncelleyicili
  düzende açılmaz; geri dönüş yalnız güncelleme öncesi yedekten (bkz. §6).

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 3 migration); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; tablet 1.4.2 sonra. `dokuma.rollBirth` ayarı tabletler 1.4.2'ye geçmeden KK1 moduna alınmaz.
- **Bu sürüme özel:** KK1 modlarının levent dengesi için Devere'de "Levent tezgah bağı defteri" ve "Tezgahtan inen
  top leventten otomatik düşsün" açık olmalı (panel uyarır, engellemez). Tezgah/levent etiketi basmak için Etiket
  Stüdyosu'nda iki türe şablon atanmalı. Ürün adı ayıklama betiği bu kurulumun parçası değildir.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe
kendiliğinden dönülür. Kurulum başarılı olduktan sonra geri dönmek gerekirse: 3 migration uygulanmıştır ve ikisi
geri alınamaz → yalnız güncelleme öncesi yedekten geri yükleme (göç sayısı 392'ye döner), ardından 2.15.11 imajı;
yalnız kullanıcı onayıyla. `migrate reset`, `docker compose down -v`, `dropdb` yok. Tercih edilen yol ileri
düzeltmedir (2.15.13).

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.12, sunucu ve veritabanı ayakta.
- Veritabanı: 395 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `sistemHesabiMuhru` ve `auditProtection` 2.15.11'deki değerleriyle aynı.
- Dokuma modülü açık kurulumda `GET /api/machine-doffs/kk1-context?machineCode=` (bir tezgah kodu) 200 dönüyor.
- `dokuma.rollBirth` değeri `TABLET_DOFF` (ayar değiştirilmediyse).
- Web panelinde Raporlar → Dokuma'da üç yeni rapor açılıyor; Etiket Stüdyosu'nda Tezgah ve Levent etiketi türleri var.
- `docker ps`: `yedek` konteyneri de `tekserp-korumali:2.15.12` imajında.
- Masaüstü panelle giriş ve tabletle PIN girişi bugünkü gibi çalışıyor.
