# `deploy/guncelleme-sunucusu/` — güncelleme yayın servisi

VPS'teki **`/opt/stack/apps/tekserp-guncelleme/`** dizininin kaynağı.
Fabrikadaki Electron panelleri yeni sürümü buradan indirir.

| | |
|---|---|
| Adres | `https://guncelleme.etkiliyazilim.com/adnansahin/electron/` |
| Sunucu | `oguzhan@91.217.119.138`, port **2222** (ssh takma adı `yenisunucu`) |
| Ortam | Docker + Traefik v3.5 (nginx **yok** — bu servis kendi nginx'ini taşır) |
| Yayın klasörü | `/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron/` (sahibi `oguzhan`) |
| Yol şeması | **`/<müşteri>/<ürün>/`** — yeni müşteri = yeni klasör, başka hiçbir şey |

Reçete ve işletme adımları: [`docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`](../../docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md)

## Sunucuya uygulama

Bu dosyalar **sunucuya elle kopyalanır** (`kur.ps1` ile aynı durum — servis
kendi yapılandırmasını güncelleyemez):

```bash
scp docker-compose.yml yenisunucu:/tmp/dc.yml
scp nginx/default.conf  yenisunucu:/tmp/nginx-default.conf
ssh yenisunucu 'cd /opt/stack/apps/tekserp-guncelleme
  sudo cp /tmp/dc.yml docker-compose.yml
  sudo cp /tmp/nginx-default.conf nginx/default.conf
  sudo docker compose up -d
  sudo docker exec tekserp-guncelleme nginx -t'   # config testi SON DEĞİL, doğrulama
```

## İki kural, ikisi de yanarak öğrenildi

**① `.exe` başlığında `always` KULLANMA.** `add_header ... always` başlığı hata
yanıtlarına da ekler; Cloudflare origin'in talimatına uyup bir **404'ü de bir
hafta önbelleğe alır**. Paket henüz yüklenmemişken o adrese tek bir istek
geldiyse, dosya yüklendikten sonra bile bir hafta 404 döner. 2026-08-26'da tam
olarak bu yaşandı (kurulum sırasındaki 404 sondası önbelleğe girdi). İkinci hat
olarak `error_page 404 → no-store` eklendi.

**② Cloudflare proxy'si (turuncu bulut) AÇIK kalmalı.** Sertifika bir Cloudflare
**Origin CA** wildcard'ıdır (`*.etkiliyazilim.com`, 2036'ya kadar,
`traefik/dynamic/tls.yml`); ACME yok çünkü alan adı bu CF hesabının zone'unda
değil. Origin CA'ya **yalnız Cloudflare Edge güvenir** — kayıt DNS-only'ye
çevrilirse istemci sertifikayı reddeder ve güncelleme sessizce durur.

## Mobil

Mobil APK/OTA yayını da buradadır (taşındı, 2026-08-26): **`html/adnansahin/mobil/`** (`ota/`,
`apk/`) — aynı servise, ayrı konteyner veya alan adı gerekmez. Mobil tarafın
cache kuralı için `nginx/default.conf`'a uzantı eklenmesi gerekir: **manifest
uzantısı `no-cache` tarafına**, paket (`.apk`) uzun cache tarafına.

## Yeni müşteri eklemek

```bash
ssh yenisunucu 'mkdir -p /opt/stack/apps/tekserp-guncelleme/html/<musteri>/electron'
./deploy/electron-paketle.sh <musteri>     # adres pakete gömülür + kapı doğrular
./deploy/electron-yayinla.sh               # hedefi paketin kimliğinden çözer
```

DNS, sertifika, Traefik ya da servis değişikliği **yoktur**. Adresi elle
düzenleme — paketleme komutu `shared/musteri.json` ve `package.json`ı birlikte
yazar ve derlemeden SONRA paketin içindeki gömülü adresi doğrular.
