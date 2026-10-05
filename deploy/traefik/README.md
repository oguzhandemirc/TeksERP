# `deploy/traefik/` — VDS kenar vekili (tekserp-vds `/opt/stack/traefik/`)

VDS'teki Traefik yapılandırmasının KAYNAĞI. Sunucuya elle kopyalanır (servis kendi yapılandırmasını güncelleyemez);
sertifikalar (`certs/`, Cloudflare Origin CA `*.etkiliyazilim.com`) repoya GİRMEZ.

| Dosya | Ne |
|---|---|
| `docker-compose.yml` | Traefik v3.5 + salt okunur docker soketi vekili; kenar ağları (satıcı · patron) dış ağ olarak |
| `traefik.yml` | statik: entryPoint'ler, zaman aşımları, sağlayıcılar — değişikliği Traefik'i YENİDEN BAŞLATIR (bütün hostlar kesilir) |
| `dynamic/tls.yml` | Origin CA sertifikası (dosya sağlayıcısı, sıcak yüklenir) |
| `docker-proxy.conf` | soket vekili: yalnız GET/HEAD, API sürümünü 1.44'e sabitler |
| `kenar-zinciri.mjs` | satıcı ve patron `compose-denetle`nin ortak kenar zinciri denetimi (⑦k · ⑬f) |

## Yönlendiriciler ve ara katmanlar

Yönlendiriciler hizmetlerin KENDİ compose etiketlerindedir (`deploy/satici/`, `deploy/patron/`, `deploy/guncelleme-sunucusu/`).

- **lisans · portal · patron:** zincir tam iki halka, bu sırayla — ① Cloudflare `ipallowlist` (TCP karşı ucu, başlık okunmaz; liste uygulama kodundaki `CLOUDFLARE_NETWORKS` ile birebir) ② `ratelimit` gerçek istemci başına (`Cf-Connecting-Ip`; yalnız ① geçtiyse güvenilir). Sed uygulamanın kendi sınırlarının üstündedir — yoklama ve eşitleme ona hiç değmez.
- **guncelleme (fabrikaların güncelleme yolu):** ara katman YOK. Büyük indirmeler (140 MB, Cloudflare üzerinden ~30 dk) ve belirteçsiz eski istemciler burada; kökeni Cloudflare'e kapatmak indirme kapısı runbook'unun işidir (`docs/ops/INDIRME-KAPISI-WORKER.md` §5).
- **Zaman aşımları (`websecure`):** `writeTimeout 0` ŞART (uzun indirme + `/v1/zil` SSE); `readTimeout 60s` başlık + gövde okumasını sınırlar (yavaş istemci); `idleTimeout 180s`.

Uygulama ve geri alma: tekserp-vds'e her yazımdan önce/sonra adnansahin baytları (`deploy/vds-dogrula.sh`) + `latest.yml` + büyük dosya HEAD/aralıklı GET ölçülür.
