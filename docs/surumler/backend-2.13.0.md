# Backend `2.13.0`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **yok — sıfırdan kurulum** (`demofabrika`, thinkpad-1; `docs/ops/SENARYO-YENI-MUSTERI.md` §5).
Öteki kanallar (ölçüldü 2026-10-01): `adnansahin` **2.11.2** (etiket `backend-v2.11.2` = `72889f5a`, kurulum kaydı
`backend-2.11.2.md`) · `testfabrika` **2.12.1** prova paketi (sürüm son eki hedefteki yerel commit; `backend-2.12.1.md`
kurulum kaydı; thinkpad-1 bu turda temizlenir). `backend-v2.12.*` etiketi YOK: 2.12.0 ve 2.12.1 yalnız prova paketi olarak üretildi.

Kaynak: dal `surum/2.13.0` (taban `origin/main` `4467956b` + sürüm notu `72da14c1` + bu belge). Sürüm numaraları
yönetici kararı 2026-10-01: backend 2.13.0 · panel 1.4.2 · tablet 1.0.15. KÜÇÜK hane ELLE (`-Surum 2.13.0`): yama
otomatiği `backend-v2.11.2`den 2.11.3 üretir ve bu belgeyi bulamaz. `Teks-Erp/package.json` sürümünü paketleyici yazar
ve yayından sonra commit'lenir — depoda ÖNCEDEN yazılmaz (`backend-surum.mjs --uygula` aynı değeri görünce "package.json >
version yazilamadi" ile paketlemeyi DURDURUR).

**Bu belgenin ilk kullanımı `demofabrika`dır:** KORUMALI paket (`paketle.ps1 -Korumali -Hedef win-x64 -Musteri demofabrika
-Surum 2.13.0 -NativeYol …`), hedef platformda (thinkpad-1) üretilir, ÜRETİM PAKET anahtarı **`paket-2026`** ile Mac'te
imzalanır; lisans ÜRETİM satıcısından (kök `kok-2026-1`), satıcıda **Zorla** kip. `adnansahin`e bu sürüm yalnız kullanıcının
terfi onayıyla gider; o gün `backend-2.12.0.md` ve `backend-2.12.1.md` §2–§4 de geçerlidir.

## 1. Özet

**İlk kurulum sözleşme kabulü (Ek-7 §5):** etkinleştirme, bu sunucunun lisans anahtarına bağlı geçerli bir kabul kaydı
olmadan satıcıya GİTMEZ (409 `LICENSE_ACCEPTANCE_REQUIRED`); kabul panelden (1.4.2, Sistem → Lisans → "Lisans sözleşmesi"
kartı) alınır ve imzalı kabul belgesi etkinleştirme gövdesinde (çevrimdışı zarfta da) satıcıya taşınır. **Üretim güven
çapası** (tören 2026-09-30): kök `kok-2026-1` + PAKET anahtarı `paket-2026` TS çapasında ve native çekirdeğe gömülü →
fabrika üretim satıcısının HAK'larını ve üretim anahtarıyla imzalı paketleri tanır. Yeni HAK kabul edilince bütünlük kararı
son ölçümle hemen verilir. Yeni müşteri kanalı `demofabrika`.

## 2. Ne değişti

Taban 2.12.1 (`dd54c252`) → bu sürüm; yalnız backend ve dağıtım dosyaları (satıcı/patron/hukuk commit'leri pakete girmez).

- `4927f00e` · `ca668f51` (entegrasyon `c33628ce`) — sözleşme kabulü: `license_acceptances` tablosu (ekleme-yalnız: metin
  kimliği + özeti, işaretlenen kutular, ad/unvan, kabul eden kullanıcı, kurulum anahtar kimliği, imzalı kabul belgesi) ·
  `GET /api/license/kabul` (`license:view` ya da `license:manage`) · `POST /api/license/kabul` (`license:manage`;
  `clientToken` ile idempotent; 400 `LICENSE_ACCEPTANCE_BOXES` · 409 `LICENSE_ACCEPTANCE_TEXT_CHANGED` /
  `LICENSE_ACCEPTANCE_TEXT_UNPUBLISHED`). `POST /api/license/etkinlestir` ve çevrimdışı etkinleştirme isteği kabul
  belgesini gövdede taşır; kabul yoksa satıcıya çıkmadan 409 `LICENSE_ACCEPTANCE_REQUIRED` (`details.kabulDurumu`:
  `YOK` · `METIN_DEGISTI` · `ANAHTAR_DEGISTI`). Metin tek kaynak `docs/hukuk/KABUL-METNI.md` §2 →
  `src/lib/license/acceptance-text.generated.ts` (bugün `KM-2026.1-taslak`; panel "Taslak metin" rozeti gösterir).
  Kabul audit'e `LICENSE_ACCEPTANCE` olarak yazılır.
- `0df46be0` (entegrasyon `b7a05866`) — üretim güven çapası: `ROOT_PUBLIC_KEYS` += `kok-2026-1` (sınıflar URETIM · TEST ·
  DR · DEMO · BAYI · BARINDIRILAN), `PACKAGE_PUBLIC_KEYS` += `paket-2026`; native `src/anchor.rs` aynı dört girdi
  (`hazirlik-2026-1` · `kok-2026-1` · `paket-hazirlik` · `paket-2026`).
- `4467956b` — kâhin bekçisi derlenmiş ikilinin gömülü çapasını CANLI kıyaslar; fikstür kökleri gerçek kid taşımaz
  (yalnız test; çalışma anı etkisi yok).
- `2db43c50` (P5 B2) — yeni HAK'ta bütünlük kararı son ölçümle hemen verilir (`decideForClass`), ardından lisans durum
  geçişleri hemen değerlendirilir: etkinleştirme anındaki geçici `OLCULEMEDI` (yalnız hazırlık PAKET anahtarında) kapandı.
- `8dc27166` — anahtar sarma tek uygulama (`src/lib/license/protocol/anahtar-sarma.ts`): parolalı üretim PAKET anahtarı
  aracı için; sunucunun çalışma anı yolunda kullanılmaz.
- `a6ec0d81` · `45a7ba64` — `deploy/kanallar.json` `demofabrika` (tür hazırlık, aynasız; backend `urunAdi` "TeksERP Demo
  Fabrika Backend", `pm2Ad` `tekserp-backend-demofabrika`).
- Native lisans çekirdeği: `anchor.rs` değişti → YENİDEN derlendi (ÜRETİM, test çapasız; §5). 2.12.x'in native'i
  (`e2691bc1…7c90`) eski çapayı taşır, bu pakette KULLANILMAZ.
- Web paneli (`dist-web`): pakete girmez (B6'dan beri) — değişiklik yok.

## 3. Sözleşme

- **Kırıldı mı:** EVET, yalnız ETKİNLEŞTİRME akışında — `POST /api/license/etkinlestir` ve çevrimdışı etkinleştirme isteği
  (`/api/license/cevrimdisi-istek`, amaç `etkinlestir`) geçerli kabul kaydı olmadan 409 `LICENSE_ACCEPTANCE_REQUIRED`.
  Öteki değişiklikler yalnız EKLER (`GET` / `POST /api/license/kabul`).
- **Eski istemci ne yapar:**
  - *Panel ≤ 1.4.1:* kabul kartı yok → etkinleştirme 409 ile reddedilir, ileti Türkçe ("Etkinleştirmeden önce lisans
    sözleşmesi kabul edilmeli … eski panel sürümü güncellenmeli"). Etkinleştirilecek kurulumda panel **1.4.2** şart.
    Etkin kurulumda (yoklama, yenileme, taşıma) fark yok.
  - *Panel 1.4.2 + eski backend (≤ 2.12.x):* `GET /api/license/kabul` 404 → kart "Sunucu sürümü sözleşme kabulünü
    desteklemiyor; önce sunucuyu güncelleyin." der, etkinleştirme düğmeleri kapalı kalır (fail-closed).
  - *Tablet (her sürüm):* değişiklik yok.
  - *Satıcı:* kabulü uygulayan satıcı, kabul belgesi taşımayan etkinleştirmeyi 409 `KABUL_GEREKLI` ile reddeder → 2.12.x
    backend o satıcıda etkinleştiremez.
  - *İzinler:* yeni izin YOK (`license:view` · `license:manage`).
- **`minVersion` dokunuldu mu:** HAYIR (`src/config/client-version-policy.ts`).

## 4. Migration

- **Var mı:** EVET — **1** adet, yalnız EKLER: `20260930200000_lisans_sozlesme_kabulu` — `license_acceptances` (UUID PK,
  `clientToken` UNIQUE, `(installationKeyId, createdAt)` indeksi, `acceptedById` → `users` FK RESTRICT; boş doğar;
  idempotent, DEFERRABLE FK'lara dokunmaz).
- **Toplam migration:** **369** (2.12.1'de 368, 2.11.2'de 363). Sıfırdan kurulumda `[7/9]` 369'un hepsini uygular;
  2.12.1'den gelen kuran **1**, 2.11.2'den gelen **6** uygulanan migration görmelidir. Farklı sayı = yanlış paket ya da
  yanlış DB → DUR.
- **Veri yazan adımlar:** yok (tablo boş doğar; backfill yok).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback = yedekten restore.

## 5. Kurulum notu

- **Beklenen kesinti:** sıfırdan kurulumda yok (çalışan hizmet yok); güncellemede ~2–3 dk API kapalı (`[4/9]` → `[8/9]`).
- **Sıra:** backend ÖNCE, sonra panel **1.4.2** (etkinleştirme onu ister) ve tablet **1.0.15** (yeni kanalın ilk tableti
  APK'dır; `docs/ops/SENARYO-YENI-MUSTERI.md` §0.6).
- **Paket (bu tur):** KORUMALI, `win-x64`, hedef platformda üretilir (DEPLOY-RUNBOOK §3c; LISANS-DEVREYE-ALMA-TESTFABRIKA
  §4.2 kalıbı — derleme kökü `C:\ProgramData\testfabrika\klis3`, pwsh 7, ayrık, düşük öncelikli, prizde). Kaynak, bu
  commit'in sığ klonudur (paketin `commit` alanı depodaki commit'tir). Native çekirdek ÜRETİM derlemesi (`npm run
  derle:win:uretim`, cargo-xwin, test çapasız): `lisans-cekirdek.win32-x64-msvc.node` sha256
  `7fcc0204f422c8aba1647da240244e8b1bba4c97e6d68c1cb338b2c12aed62ad` (PE32+ DLL x86-64; dört çapa anahtarı ikilide;
  aynı kaynaktan darwin derlemeleri kâhin §3d'de `builtinAnchor()` = TS, 42/0).
- **İmza (Mac, satıcı; parola kullanıcıda):** `cd Teks-Erp && npx tsx scripts/build-korumali-imza.ts zip --zip={zip}
  --anahtar=$HOME/.tekserp/satici-uretim/paket/paket-2026.paket.json --surum-belgesi=../docs/surumler/backend-2.13.0.md`
  → zip'e `butunluk.jws` + `butunluk-liste.txt`, `PAKET.json` `dosyaSayisi` +2 ve `butunlukKid` `paket-2026`. İmzasız
  korumalı paketi `kur.ps1` `[1/9]`da REDDEDER. Hazırlık anahtarıyla (`paket-hazirlik`) imzalı paket ÜRETİM sınıfı HAK'ta
  bütünlük `GECERSIZ` (`BUTUNLUK_HAZIRLIK_ANAHTARI`) verir — `demofabrika`da yalnız `paket-2026`.
- **Kurulum yöntemi (sıfırdan, `demofabrika`):** senaryo §5 — `ilk-kurulum.ps1` (iskelet) → `.env`de `LICENSE_SERVER_URL`
  satırı YOK (varsayılan üretim satıcısı `https://lisans.etkiliyazilim.com`) → `kur.ps1 -Kok C:\TeksERP -Paket {zip}
  -UygulamaAdi tekserp-backend-demofabrika` (SSH'tan: paketteki `uzaktan-kos.ps1` ile SYSTEM görevi, `-Zorla`) →
  `node dist\tools\superadmin-olustur.cjs` (gerçek terminal).
- **Bu sürüme özel:**
  - Etkinleştirmeden ÖNCE panelde Sistem → Lisans → "Lisans sözleşmesi" kartı: kutular + "Ad Soyad" + "Unvan" →
    "Kabul ediyorum ve devam et". Kabul kurulum anahtarına bağlıdır: sunucu taşınır ya da metin değişirse yeniden istenir.
  - `.env`: zorunlu yeni anahtar YOK.
  - Senaryo belgesinin §7'si ("Sözleşme kabul adımı — BUGÜN YOK") bu sürümle bayattır: adım artık VAR.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma · postgres/node
  süreçlerini `Stop-Process` ile durdurma · `C:\TeksERP\pgsql\bin` recursive SİLİNMEZ · `pm2` CLI SSH'tan koşulmaz ·
  `-GeriAl` ile `-Zorla` elle birlikte KULLANMA (SYSTEM görevinde soru sorulamaz, orada birlikte verilir) · başarısız
  kurulumu TEKRAR DENEME · **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**.

## 6. Geri alma

Sıfırdan kurulumda geri alınacak önceki kod yok: `[7/9]` öncesi hata → betik kendini toplar; sonrası → DUR, insana rapor
(DB yeni, gerekirse `ilk-kurulum` baştan — karar insanın). Güncelleme kurulumunda `kur.ps1 -GeriAl` (SYSTEM görevi:
`uzaktan-kos.ps1 -Betik C:\TeksERP\kur.ps1 -Argumanlar '-Kok C:\TeksERP -GeriAl -Zorla -UygulamaAdi {çalışan ad}'`)
en yeni geçerli `app.eski-*`i geri koyar. Migration yalnız EKLER → 2.12.x koduna dönüş şema işlemi istemez;
`license_acceptances` kalır ve eski kodda okunmaz. Veri dönüşü gerekiyorsa `[3/9]`da alınan
`C:\TeksERP\backups\premigrate_*.dump`tan restore. `[7/9]` yarıda düşerse Prisma o migration'ı FAILED işaretler — elle
`resolve` YAPILMAZ, insana rapor edilir. Panel 1.4.1 / tablet 1.0.14'e dönüş: yayın kanalındaki önceki paket.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- `[1/9]`: `uygulama surumu : 2.13.0` · `migration : 369` · `paket kendi Node'unu tasiyor: runtime\node.exe v24.18.0` ·
  `paket korumali (dist\server.jsc bayt kodu)` · `paket imzali dosya listesi tasiyor (butunluk.jws, anahtar paket-2026)` ·
  `dosya sayisi beyanla uyusuyor`
- pm2 (online, restart sayısı, yorumlayıcı `app\runtime\node.exe`, ad `tekserp-backend-demofabrika`); tek dinleyici 4000
- `/health` → `UP/UP 2.13.0`
- `[7/9]`: sıfırdan kurulumda 369 uygulandı; `_prisma_migrations` 369 bitmiş / 0 sorunlu, son
  `20260930200000_lisans_sozlesme_kabulu`
- `backend-err*.log` son satırlar — yeni hata var mı
- lisans (kimlikli `/api/admin/health` `license` bloğu ya da Sistem → Lisans): çekirdek `native` · bütünlük `GECERLI`
  (kid `paket-2026`) · motor `CALISIYOR` · satıcı `https://lisans.etkiliyazilim.com`
- Sözleşme: kabulden önce etkinleştirme düğmeleri kapalı; kabul sonrası `SELECT count(*) FROM license_acceptances` = 1 ve
  Sistem → Aktivite Günlüğü'nde "Lisans Sözleşmesi Kabulü"; etkinleştirme sonrası kip Zorla, kademe Normal
- panel/tablet oturumları bağlandı; ölçülen kesinti
