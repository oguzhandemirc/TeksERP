# Satıcı portalı — genel erişim (Cloudflare Access) runbook'u

> **Karar (kullanıcı, 2026-09-30):** satıcı portalı her cihaza Tailscale kurmadan internetten açılır — `https://portal.etkiliyazilim.com`, Cloudflare proxy AÇIK + **Cloudflare Access** (e-posta tek kullanımlık kodu, izinli e-posta listesi) + mevcut portal parolası + TOTP. Kök parolası isteyen nadir işler (HAK imzası, kalıcıya çevirme) **yine yalnız tailnet/geri döngüden** (Mac'te `node deploy/satici/portal-baglan.mjs`).
> Kod: `satici/sunucu/src/http/access-jwt.ts` · `access-app.ts` · bekçi `satici/sunucu/scripts/test_erisim_kapisi.ts`. Compose üst dosyası: [`deploy/satici/docker-compose.portal-genel.yml`](../../deploy/satici/docker-compose.portal-genel.yml). Kural: [`kurallar/lisans.md`](../kurallar/lisans.md). Kurulum: [`SATICI-KURULUM.md`](SATICI-KURULUM.md). Arşiv notu: `docs/history/CLAUDE-NOT-ARSIVI.md` "2026-09-30 — Satıcı portalı internetten (PG)".
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` → *adnansahin baytları AYNI*. Cloudflare ve VDS yazımı kullanıcının ya da yöneticinin "uygula" cümlesiyle; bu belge komutları sıralar, koşturmaz.

## 0. Dört kapı (dıştan içe; biri düşse de öteki fail-closed)

| # | Kapı | Nerede | Düşerse |
|---|---|---|---|
| 1 | Cloudflare Access — One-time PIN, izinli e-posta listesi, oturum 12 sa | Cloudflare kenarı | 3. kapı yine her isteği ister |
| 2 | Traefik `ipallowlist` — portal yönlendiricisi yalnız Cloudflare kenar aralıklarından gelen TCP bağlantısını kabul eder | VDS Traefik (etiketle, statik yapılandırma değişmez) | 3. kapı yine her isteği ister |
| 3 | Satıcının **ERİŞİM** dinleyicisi (4613, kenar adresi, port yayını YOK) — **her** istekte `Cf-Access-Jwt-Assertion`: RS256 · takım JWKS'i · `aud` = uygulamanın AUD etiketi · `iss` = takım · `exp`/`nbf` · e-posta; değilse **404** | satıcı süreci | — (son teknik kapı) |
| 4 | Portal parolası + TOTP; kök parolalı uç (`POST /portal/api/haklar/:id/surum`) bu yolda gövde okunmadan **404**, arayüz imza formunu açmaz | satıcı süreci + web arayüzü | — |

Kök parolası Cloudflare'den (TLS'i kenarda sonlanan üçüncü taraf) **geçmez**: sunucunun 404'ü parolanın gönderilmesini engelleyemez, engel ekrandadır — ERİŞİM oturumunda "Lisansı imzala/yenile" düğmesi yerine tailnet/geri döngü yolunu anlatan açıklama durur.

## 1. Ölçülmüş başlangıç durumu (2026-09-30)

| Ölçüm | Sonuç | Kaynak |
|---|---|---|
| Zero Trust takımı | **VAR** — `gentle-snow-a8b9.cloudflareaccess.com` (JWKS `https://gentle-snow-a8b9.cloudflareaccess.com/cdn-cgi/access/certs`, `iss` bu alan) | yönetici, salt okuma |
| Giriş yöntemi (IdP) | **YOK** → One-time PIN eklenecek | yönetici, salt okuma |
| Access uygulaması | **YOK** | yönetici, salt okuma |
| `portal.etkiliyazilim.com` DNS kaydı | **YOK** (`dig +short` boş) | Mac |
| Köken Cloudflare'e kapalı mı? | **HAYIR** — Mac'ten (CF dışı IP) `curl -sk --resolve lisans-test.etkiliyazilim.com:443:80.253.255.188 https://lisans-test.etkiliyazilim.com/saglik` → **200**; Traefik'te CF IP daraltması yok. Bu yüzden 2. ve 3. kapı ŞART | Mac |
| Köken sertifikası | Cloudflare Origin CA `*.etkiliyazilim.com` → `portal.` kapsanır | `SATICI-KURULUM.md` §1 |
| Satıcının dış bağlantısı | **YOK** (geri döngü kipinde dört ağ da internal) → JWKS çekimi için `erisim-cikis` köprüsü gerekir (§4, §5) | `deploy/satici/docker-compose*.yml` |

## 2. Cloudflare — API ile (sıralı; yönetici koşturur)

Belirteç yöneticide (`~/.tekserp/sirlar/cloudflare-token.txt`): repoya, loga, komut satırına (argv) GİRMEZ — başlık 0600 geçici dosyadan okunur. Gereken izinler: Hesap → *Access: Organizations, Identity Providers, and Groups* (Edit) · *Access: Apps and Policies* (Edit); Bölge → *DNS* (Edit). İzinli e-posta listesi dağıtımda verilir ve yalnız ortam değişkeninde yaşar (dosyaya/runbook'a yazılmaz).

```bash
CF=https://api.cloudflare.com/client/v4
ACCOUNT_ID=<hesap kimliği>            # sır değil
ZONE_ID=<etkiliyazilim.com bölge kimliği>
TAKIM=gentle-snow-a8b9.cloudflareaccess.com
HOST=portal.etkiliyazilim.com
VDS_IP=80.253.255.188                 # lisans-test ile aynı köken (SUNUCU-ENVANTERI.md)
read -rs IZINLI_EPOSTALAR; export IZINLI_EPOSTALAR   # virgülle ayrık; ekrana basılmaz
umask 077; H="$(mktemp)"; printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$(cat ~/.tekserp/sirlar/cloudflare-token.txt)" > "$H"
cf() { curl -sS -H @"$H" "$@"; }      # iş bitince: rm -f "$H"
```

**2.0 Takımı doğrula (salt okuma):**
```bash
cf "$CF/accounts/$ACCOUNT_ID/access/organizations" | jq -r '.result.auth_domain'   # → gentle-snow-a8b9.cloudflareaccess.com
```

**2.1 Giriş yöntemi: One-time PIN (yoksa ekle):**
```bash
cf "$CF/accounts/$ACCOUNT_ID/access/identity_providers" | jq -r '.result[] | select(.type=="onetimepin") | .id'   # boşsa:
IDP_ID=$(cf -X POST "$CF/accounts/$ACCOUNT_ID/access/identity_providers" \
  -d '{"name":"E-posta kodu","type":"onetimepin","config":{}}' | jq -r '.result.id'); echo "$IDP_ID"
```

**2.2 Self-hosted uygulama `portal.etkiliyazilim.com`** (politikasız doğar = kimse giremez; güvenli ara durum):
```bash
APP=$(cf -X POST "$CF/accounts/$ACCOUNT_ID/access/apps" -d "$(jq -n --arg h "$HOST" --arg idp "$IDP_ID" '{
  type:"self_hosted", name:"TeksERP satıcı portalı", domain:$h,
  session_duration:"12h", allowed_idps:[$idp], auto_redirect_to_identity:true,
  app_launcher_visible:false, http_only_cookie_attribute:true, same_site_cookie_attribute:"lax"}')")
APP_ID=$(jq -r '.result.id' <<<"$APP"); echo "$APP_ID"
```
Oturum süresi 12 sa = portal oturumunun mutlak ömrü (`PORTAL_OTURUM_AZAMI_SAAT`). `same_site` **lax** kalır: OTP dönüşü siteler arası yönlendirmedir, `strict` çerezi o zincirde göndermez ve giriş döngüye girer.

**2.3 Allow politikası — izinli e-posta listesi:**
```bash
cf -X POST "$CF/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" -d "$(jq -n --arg l "$IZINLI_EPOSTALAR" '{
  name:"İzinli e-postalar", decision:"allow", precedence:1, session_duration:"12h",
  include: ($l | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0)) | map({email:{email:.}}))}')" \
  | jq '{ok: .success, id: .result.id, kisi: (.result.include | length)}'
```
(Cloudflare yeni hesaplarda yeniden kullanılabilir politikayı önerir: aynı gövdeyle `POST /accounts/$ACCOUNT_ID/access/policies`, sonra uygulamanın `policies: [{id, precedence: 1}]` alanı. Sonuç aynıdır.)

**2.4 AUD etiketini oku** (sır değil; satıcının `.env`'ine girer):
```bash
cf "$CF/accounts/$ACCOUNT_ID/access/apps/$APP_ID" | jq -r '.result.aud'   # 64 onaltılık → CF_ACCESS_AUD
```

**2.5 DNS — EN SONA (satıcı ERİŞİM kipinde ayağa kalktıktan sonra, §4):**
```bash
cf "$CF/zones/$ZONE_ID/dns_records?name=$HOST" | jq '.result | length'   # 0 olmalı
cf -X POST "$CF/zones/$ZONE_ID/dns_records" -d "$(jq -n --arg ip "$VDS_IP" \
  '{type:"A", name:"portal", content:$ip, proxied:true, ttl:1, comment:"TeksERP satıcı portalı (Access)"}')" | jq '{ok: .success, id: .result.id}'
rm -f "$H"
```
Proxy (turuncu bulut) **AÇIK** kalmalı: Origin CA'ya yalnız Cloudflare güvenir ve Access yalnız proxy'lenen kayıtta çalışır.

## 3. Cloudflare — panelden (aynı adımlar)

1. **Zero Trust → Settings → Authentication → Login methods → Add new → One-time PIN** → Save.
2. **Zero Trust → Access → Applications → Add an application → Self-hosted**: ad "TeksERP satıcı portalı" · Session Duration **12 hours** · Application domain: subdomain `portal`, domain `etkiliyazilim.com` · Identity providers: yalnız **One-time PIN**, *Instant Auth* açık · App Launcher'da gösterme.
3. **Policies → Add a policy**: ad "İzinli e-postalar" · Action **Allow** · Include → **Emails** → izinli adresler (dağıtımda verilir) → Save.
4. **Settings → Cookie settings**: HttpOnly açık · SameSite **Lax** (Strict OTP dönüşünü döngüye sokar). *Binding cookie* isteğe bağlı (çalınan belirtece karşı; `cloudflared access` ile komut satırı denemesinde sorun çıkarırsa kapatılır).
5. Uygulamanın **Overview** sekmesi → **Application Audience (AUD) Tag** → kopyala → `CF_ACCESS_AUD`.
6. **DNS → Records → Add record**: Type **A** · Name `portal` · IPv4 VDS adresi · Proxy status **Proxied** — satıcı §4'te ERİŞİM kipine geçtikten SONRA.

## 4. VDS — satıcıyı genel portal kipine al

Önkoşul: satıcı imajı bu dilimi içerir (ERİŞİM dinleyicisi + göç `20261001120000_portal_erisim_dinleyicisi`) — `deploy/satici/imaj-derle.sh` birleşmiş HEAD'den.

1. `deploy/vds-dogrula.sh` → AYNI.
2. Yedek: `sudo docker compose exec satici-yedek /arac/yedek-dongusu.sh tek`.
3. Göç (yeni imajla, tek seferlik): `sudo docker compose --profile goc run --rm satici-goc` → "All migrations have been successfully applied".
4. `deploy/satici/docker-compose.portal-genel.yml` → `/opt/stack/apps/tekserp-satici-<ortam>/` (compose'un yanına).
5. `.env`'e (sır DEĞİL):
   ```
   PORTAL_HOST=portal.etkiliyazilim.com
   CF_ACCESS_TAKIM_ALANI=gentle-snow-a8b9.cloudflareaccess.com
   CF_ACCESS_AUD=<§2.4 çıktısı>
   ERISIM_CIKIS_AGI=172.31.255.0/29        # docker network ls + ip -4 route ile çakışmadığı ÖLÇÜLÜR
   COMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml   # geri döngü kipi
   ```
6. Mac'te yalıtım denetimi: `node deploy/satici/compose-denetle.mjs --env-file <.env>` → yeşil (2026-09-30 yerel ölçüm: geri döngü + portal-genel birleşik 39/0).
7. `sudo docker compose up -d satici` → günlük: `SATICI_DINLIYOR genel=4610 tailnet=4611 ic=4612 erisim=4613` ve `erisim: Cloudflare Access kapısı AÇIK (takım gentle-snow-a8b9…)`. Access ayarı eksikse satıcı AÇILIR ama `genel portal KAPALI … her isteğe 404` basar (fail-closed; `/v1` etkilenmez).
8. JWKS sağlığı (tailnet/geri döngü yolundan): `/portal/saglik` → `erisim.kip: "acik"`, `erisim.jwks.filled: true`, `lastError: null`.
9. §2.5 DNS kaydı → §6 doğrulama → `deploy/vds-dogrula.sh` → AYNI.

## 5. Çıkış (JWKS) — isteğe bağlı daraltma

Satıcı Access imza anahtarlarını kendisi çeker (15 dk tazelik; bayat anahtar döner, hiç dolmadıysa her istek 404). Bu kip satıcıya dış bağlantı açar: `erisim-cikis` köprüsüne YALNIZ satıcı katılır ve üzerinde dinleyici yoktur. Hedefi daraltmak host kuralıdır (sudo; ana kipteki tailnet kuralları gibi DOCKER-USER'da):
```bash
sudo iptables -I DOCKER-USER 1 -s <ERISIM_CIKIS_AGI> -m conntrack --ctstate NEW -j DROP
sudo iptables -I DOCKER-USER 1 -s <ERISIM_CIKIS_AGI> -p udp --dport 53 -m conntrack --ctstate NEW -j RETURN
sudo iptables -I DOCKER-USER 1 -s <ERISIM_CIKIS_AGI> -p tcp -m multiport --dports 53,443 -m conntrack --ctstate NEW -j RETURN
```
Kuraldan sonra §4.8 (JWKS `filled: true`, `lastError: null`) yeniden ölçülür. Satıcıyı dış bağlantısız tutmak isteniyorsa seçenek: JWKS'i yalnız çıkışlı bir yan konteyner ya da host zamanlayıcısı dosyaya çeker, satıcı dosyadan okur (doğrulayıcının çekim kancası hazır; ayrı dilim, karar yöneticide).

## 6. Doğrulama

| # | Komut | Nereden | Beklenen |
|---|---|---|---|
| 1 | `curl -sI https://portal.etkiliyazilim.com/portal/` | herhangi | **302** → `https://gentle-snow-a8b9.cloudflareaccess.com/cdn-cgi/access/login/…` (Access'siz istek kökene ulaşmaz) |
| 2 | `curl -sk -o /dev/null -w '%{http_code}\n' --resolve portal.etkiliyazilim.com:443:80.253.255.188 https://portal.etkiliyazilim.com/portal/` | Mac (CF dışı) | **403** (Traefik `ipallowlist`); ara katman yoksa **404** (satıcının JWT kapısı) — asla 200 |
| 3 | Tarayıcı: `https://portal.etkiliyazilim.com` → e-posta kodu → portal giriş ekranı → parola + TOTP | izinli e-posta | **200**, pano açılır; izinsiz e-posta Access'te durur |
| 4 | `cloudflared access curl https://portal.etkiliyazilim.com/portal/api/oturum` | izinli e-posta | **401 `OTURUM_YOK`** (Access kapısı geçildi, portal oturumu yok) |
| 5 | `cloudflared access curl -X POST -H 'Content-Type: application/json' -d '{}' https://portal.etkiliyazilim.com/portal/api/haklar/00000000-0000-4000-8000-000000000000/surum` | izinli e-posta | **404** — aynı anda `…/portal/api/pano` **401**: fark kök parolalı rotanın kapısından |
| 6 | Kurulum → Lisans sekmesi (genel yoldan girişte) | tarayıcı | "Lisansı imzala/yenile" YOK, tailnet/geri döngü yolunu anlatan açıklama VAR |
| 7 | `node deploy/satici/portal-baglan.mjs` → `http://127.0.0.1:14611/portal/` | Mac | tailnet/geri döngü yolu DEĞİŞMEDİ: giriş + imza formu açık |
| 8 | `sudo docker compose logs satici \| grep "erisim:"` | VDS | `Cloudflare Access kapısı AÇIK`; 2. adımdan sonra (ara katman yoksa) `RED BASLIK_YOK` satırı, dakikada en çok bir |

## 6b. Bilinen davranış

- **İki ayrı oturum, iki ayrı saat:** Access oturumu (12 sa, e-posta kodundan itibaren) ve portal oturumu (12 sa mutlak, 30 dk boşta — parola + TOTP'den itibaren) bağımsızdır. Access oturumu dolunca arayüzün API çağrıları Cloudflare giriş sayfasına yönlenir ve ekran ağ hatası gösterir: sayfayı yenilemek e-posta koduna götürür, portal oturumu sürüyorsa kaldığı yerden devam eder.
- **Tek ad, tek ortam:** `portal.etkiliyazilim.com` bir anda YALNIZ bir satıcı ortamına (bugün `hazirlik`) bağlanır — `PORTAL_HOST` o ortamın `.env`'indedir. Üretim satıcısı kurulunca ad ona taşınır (hazırlıkta satır kaldırılır, üretimde eklenir) ya da hazırlığa ayrı ad verilir; iki ortam aynı adı taşıyamaz (Traefik iki yönlendiriciyi çakıştırır).
- Portal arayüzünün statik dosyaları (`/portal/assets/*`, içerik özetli, `immutable`) Cloudflare kenarında önbelleğe girebilir; Access denetimi önbellekten ÖNCE koşar ve bu dosyalar sır taşımaz. API ve giriş HTML'i `no-store`.

## 7. Ana (Tailscale) kipe geçerken

Ana kipte `tailnet` köprüsü de ağ geçitlidir; ikinci ağ geçitli ağ (`erisim-cikis`) konteynerin varsayılan rotasını değiştirebilir ve tailnet'ten gelen portal isteklerinin yanıtı başka köprüden çıkabilir. Geçişten ÖNCE ölçülür: konteynerin varsayılan rotası (`/proc/net/route`) · tailnet'ten `/portal/saglik` 200 · JWKS `filled: true`. Tutmazsa JWKS dosya yoluna (§5 son paragraf) geçilir.

## 8. Geri alma

1. `.env`'deki `COMPOSE_FILE`'dan `:docker-compose.portal-genel.yml` çıkarılır → `sudo docker compose up -d satici` → günlük `erisim=kapali`; sonra `sudo docker network rm tekserp-satici-<ortam>-erisim-cikis`.
2. Cloudflare: DNS `portal` kaydı silinir (ya da kalır — köken artık o Host'u yönlendirmez); Access uygulaması silinir ya da politikası boşaltılır.
3. Göç geri alınmaz (enum değeri `ERISIM` kalır, zararsız): eski imaj bu değeri yazmaz, oturumu yalnız belirteç özetiyle okur; ERİŞİM oturumları budamayla gider.
4. `deploy/vds-dogrula.sh` → AYNI.
