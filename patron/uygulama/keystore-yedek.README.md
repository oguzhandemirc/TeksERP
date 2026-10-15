# `keystore-yedek.tar.gz.enc` — Patron uygulaması Play YÜKLEME anahtarının şifreli yedeği

Patron uygulamasının (mağazada "TeksERP Yönetim", `com.etkiliyazilim.tekserp.yonetim`; 2026-10-16'ya kadar `…tekserp.patron`, o paket Play'e hiç yüklenmedi — anahtar AYNI) Google Play **yükleme anahtarını** parola korumalı
arşivde taşır. Şifresiz hâli repo DIŞINDADIR: `~/.tekserp/patron-android/yukleme/` (dizin 700, dosya 600).
Kalıp tabletinkiyle aynıdır (`mobil/keystore-yedek.README.md`); anahtar ve parola tablettekinden AYRIDIR.

> Depo private, ama git geçmişi kalıcıdır ve her klonla gider. Bu yüzden anahtar **şifreli** durur.
> Parola depoda DEĞİLDİR: macOS Anahtar Zinciri `tekserp/patron-play-yukleme` (hesap `tekserp`, kayıt biçimi
> `tkp1:<hex>` — `scripts/lib/parola-kasasi.mjs`). Parola tören anında rastgele üretildi (24 bayt, base64url);
> Mac'in diski kaybolursa Anahtar Zinciri de gider — **parolayı bir kez parola yöneticisine kopyala** (aşağıda).

## İçindekiler ve kaybının bedeli

| Dosya | Ne işe yarar | Kaybolursa |
|---|---|---|
| `yukleme/tekserp-patron-yukleme.keystore` (PKCS12, alias `tekserp-patron-yukleme`, RSA 4096, 10000 gün) | AAB'yi Play'e yüklerken imzalar | Play App Signing'de uygulama mührü Google'dadır: kullanıcılar etkilenmez. Play Console → Uygulama bütünlüğü → **Yükleme anahtarı sıfırlama** isteğiyle yeni anahtar tanıtılır (Google onayı birkaç gün sürer; o sürede yeni sürüm yüklenemez). |

Yükleme sertifikası SHA-256 (açık bilgi, Play Console'da görünenle eşleşmeli):
`3D:D9:6B:00:46:8F:3F:8C:CB:E3:44:16:BE:D8:05:78:1A:B8:67:53:72:ED:D6:99:4C:BC:CC:97:A6:30:27:EA`

## Parolayı parola yöneticisine kopyalamak (bir kez, kullanıcı)

Anahtar Zinciri Erişimi → arama: `tekserp/patron-play-yukleme` → çift tık → "Parolayı göster". Değer `tkp1:` ile
başlayan hex'tir; asıl parola onun UTF-8 çözümüdür. Kayıt biçimini bozmadan saklamak için değerin tamamını
(`tkp1:…`) parola yöneticisine yaz. Geri yüklemede: `node scripts/parola-kaydet.mjs patron-play-yukleme` asıl
parolayı ister (hex'in çözümü; `printf '%s' '<hex>' | xxd -r -p` ile görülür — terminal geçmişine düşürme).

## Geri yükleme (yeni Mac)

```bash
# 1) Parolayı Anahtar Zinciri'ne koy (repo kökünde, kendi Terminal'inde; gizli sorar):
node scripts/parola-kaydet.mjs patron-play-yukleme
# 2) Arşivi aç (parolayı openssl sorar):
mkdir -p ~/.tekserp/patron-android && chmod 700 ~/.tekserp/patron-android
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -in patron/uygulama/keystore-yedek.tar.gz.enc | tar -xzf - -C ~/.tekserp/patron-android
chmod 700 ~/.tekserp/patron-android/yukleme && chmod 600 ~/.tekserp/patron-android/yukleme/*.keystore
# 3) Dene:
cd patron/uygulama && npm run build:aab
```

## Yedeği yenilemek

```bash
cd patron/uygulama && node scripts/anahtar-uret.mjs --yedek
```

Betik arşivi Anahtar Zinciri parolasıyla şifreler, yazmadan ÖNCE açıp içindeki anahtarın diskteki ile bayt-eşit
olduğunu doğrular. İlk üretim `node scripts/anahtar-uret.mjs` (var olan anahtarın ya da kasa kaydının üstüne yazmaz).

## Sınır

Yedek **diski kaybetmeye** karşı korur, **parolayı kaybetmeye** karşı korumaz. Parola yöneticisindeki kopya yoksa
ve Mac giderse yol "Yükleme anahtarı sıfırlama"dır (Play Console). Runbook: `docs/ops/PATRON-MAGAZA-ANDROID.md`.
