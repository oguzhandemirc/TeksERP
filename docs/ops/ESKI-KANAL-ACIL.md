# Eski kanal (adnansahin) acil yayın yolu

> Tek ortak paket düzeninde (`deploy/dagitim.json` grupları) adnansahin'e ayrı kanal yayını YAPILMAZ; eski kanal betikleri O15'te ağaçtan kalktı. Bu belge, kullanıcı açıkça isterse eski yolun `eski-kanal-son` etiketinden yeniden üretilmesini anlatır. Tasarım: `docs/design/TEK-ORTAK-PAKET.md` §8.1.

## Kural

- adnansahin'e yeni sürüm YALNIZ kullanıcı açıkça isterse (kullanıcı cümlesiyle) çıkar. Bugün böyle bir iş yoktur.
- adnansahin'in VDS dosyalarına ve `guncelleme.etkiliyazilim.com`a bu yolun DIŞINDA dokunulmaz.
- Çalışma `main`de değil, etiketten açılan ayrı worktree'de yapılır; iş bitince worktree silinir, `main`e commit YOK.
- `deploy/kanallar.json` bayt-donuk kalır (`test_eski_kanal_donuk.mjs`).

## Yol

1. Önce ölç: `node ../indirme-kapisi-olc.mjs --adnansahin` (repo dışı, `Teks-Erp-wt/`; beklenen 9/9) ve `deploy/vds-dogrula.sh`.
2. `git worktree add ../acil eski-kanal-son` ve `cd ../acil`.
3. Etiketteki betiklerle, yalnız istenen ürün için:
   - Panel: `./deploy/electron-paketle.sh adnansahin` sonra `./deploy/electron-yayinla.sh --musteri=adnansahin [--kuru|--dogrula]`
   - Tablet OTA: `cd mobil && npm run yayinla -- --musteri=adnansahin`, sonra `node deploy/mobil-yayinla.mjs --musteri=adnansahin --paket=…|--apk=…`
   - Backend: `pwsh deploy/paketle.ps1 -Musteri adnansahin`, sonra `node deploy/backend-yayinla.mjs --musteri=adnansahin --paket=… --anahtar=…`
4. Sonra tekrar ölç: aynı `indirme-kapisi-olc.mjs --adnansahin` (9/9) ve `deploy/vds-dogrula.sh`; fark varsa dur ve kullanıcıya bildir.
5. `git worktree remove ../acil`.

## Güncel ağaçta kalkan dosyalar (`eski-kanal-son..HEAD`)

Tam liste için `git diff --name-status eski-kanal-son HEAD`. Başlıcaları: electron-yayinla (sh, ps1), mobil-yayinla.mjs, mobil musteri.json, mobil kanal.cjs, mobil yayinla-ota.mjs, check-kanallar.mjs, kanal-kapisi.mjs, lib/kanallar.mjs, test_kanal_yayin_kapisi.mjs. Ayrıca `paketle.ps1 -Musteri/-Kurulum`, `build-korumali --musteri/--kurulum` ve `backend-yayinla --musteri` artık EMEKLİ diye DURUR.

Kalanlar: `deploy/kanallar.json` (bayt-donuk), `deploy/vds-dogrula.sh`, `deploy/gecis/gecis.ps1` (K-13).
