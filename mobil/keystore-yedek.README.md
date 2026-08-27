# `keystore-yedek.tar.gz.enc` — imza anahtarlarının şifreli yedeği

Bu dosya, mobil uygulamanın **iki imza anahtarını** parola korumalı bir arşivde taşır.
Şifresiz hâlleri `mobil/keystore/` altındadır ve **git'e girmez** (`.gitignore`).

> Depo private, ama git geçmişi kalıcıdır ve her klonla birlikte gider. Bu yüzden
> anahtarlar düz değil **şifreli** duruyor: depoya erişmek tek başına yetmez.
> Parola depoda DEĞİLDİR — parola yöneticisindedir.

## İçindekiler ve kaybının bedeli

| Dosya | Ne işe yarar | Kaybolursa |
|---|---|---|
| `tekserp-release.keystore` + `keystore.properties` | **Mühür** — APK'yı imzalar | İmza değişir, Android üstüne binmeyi reddeder → **her tablette sil + yeniden kur**. Silinen veri: cihaz eşleşmesi, sunucu adresi, oturum, gönderilmemiş kayıtlar |
| `ota-keys/private-key.pem` | **Kod imzalama** — OTA paketlerini imzalar | Yeni sertifika + yeni APK gerekir; ama APK aynı mühürle imzalandığı için **uygulama içi güncelleyiciden tek dokunuşla** dağıtılır — dolaşma ve veri kaybı YOK |
| `ota-certs/certificate.pem` · `ota-keys/public-key.pem` | Sertifika/açık anahtar (APK'ya gömülür) | Özel anahtardan yeniden üretilebilir |

Yani **asıl korunması gereken mühürdür**; OTA anahtarının kaybı çok daha ucuz.

## Geri yükleme

```bash
cd <repo>
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in mobil/keystore-yedek.tar.gz.enc | tar -xzf - -C mobil
```

Parolayı soracak. Sonrasında `mobil/keystore/` altında beş dosya oluşur ve
`npm run build:apk` / `npm run yayinla` çalışır hâle gelir.

## Yedeği yenilemek (anahtarlar değişirse)

```bash
tar -czf - -C mobil keystore | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -out mobil/keystore-yedek.tar.gz.enc
```

⚠️ Yenileme sonrası **açıldığını doğrula** — açılmayan bir yedek, yedek değildir:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in mobil/keystore-yedek.tar.gz.enc | tar -tzf -
```

## Sınır

Bu yedek **diski kaybetmeye** karşı korur, **parolayı kaybetmeye** karşı korumaz.
Parola olmadan arşiv kullanılamaz ve "anahtar kayboldu" durumuna geri dönülür.
Parolanın parola yöneticisinde durduğundan emin ol.

Ayrıntı: [`docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`](../docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md) §5.
