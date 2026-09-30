# Satıcı portalı — genel erişim (Cloudflare Access) runbook'u

> **Karar (kullanıcı, 2026-09-30):** satıcı portalı her cihaza Tailscale kurmadan internetten açılır — `https://portal.etkiliyazilim.com`, Cloudflare proxy AÇIK + **Cloudflare Access** (e-posta tek kullanımlık kodu, izinli e-posta listesi) + mevcut portal parolası + TOTP. Kök parolası isteyen nadir işler (HAK imzası, kalıcıya çevirme) ve **kullanıcı yönetimi** (hesap açma · TOTP ve parola sıfırlama — tohum ve parola taşır) **yine yalnız tailnet/geri döngüden** (Mac'te `node deploy/satici/portal-baglan.mjs`). Genel yolda YALNIZ izin listesindeki rotalar bağlanır (`satici/sunucu/src/http/erisim-rotalari.ts`, opt-in; sertleştirme 2026-09-30).
> Kod: `satici/sunucu/src/http/access-jwt.ts` · `access-app.ts` · bekçi `satici/sunucu/scripts/test_erisim_kapisi.ts`. Compose üst dosyası: [`deploy/satici/docker-compose.portal-genel.yml`](../../deploy/satici/docker-compose.portal-genel.yml). Kural: [`kurallar/lisans.md`](../kurallar/lisans.md). Kurulum: [`SATICI-KURULUM.md`](SATICI-KURULUM.md). Arşiv notu: `docs/history/CLAUDE-NOT-ARSIVI.md` "2026-09-30 — Satıcı portalı internetten (PG)".
> **Değişmez:** her VDS yazımından ÖNCE ve SONRA `deploy/vds-dogrula.sh` → *adnansahin baytları AYNI*. Cloudflare ve VDS yazımı kullanıcının ya da yöneticinin "uygula" cümlesiyle; bu belge komutları sıralar, koşturmaz.

## 0. Dört kapı (dıştan içe; biri düşse de öteki fail-closed)

| # | Kapı | Nerede | Düşerse |
|---|---|---|---|
| 1 | Cloudflare Access — One-time PIN, izinli e-posta listesi, oturum 12 sa | Cloudflare kenarı | 3. kapı yine her isteği ister |
| 2 | Traefik `ipallowlist` — portal yönlendiricisi yalnız Cloudflare kenar aralıklarından gelen TCP bağlantısını kabul eder | VDS Traefik (etiketle, statik yapılandırma değişmez) | 3. kapı yine her isteği ister |
| 3 | Satıcının **ERİŞİM** dinleyicisi (4613, kenar adresi, port yayını YOK) — **her** istekte `Cf-Access-Jwt-Assertion`: RS256 · takım JWKS'i (yan konteynerin yazdığı dosyadan, satıcı ağa çıkmaz) · `aud` = uygulamanın AUD etiketi · `iss` = takım · `exp`/`nbf` · e-posta; değilse **404** | satıcı süreci | — (son teknik kapı) |
| 4 | Portal parolası + TOTP; bu yolda YALNIZ izin listesindeki rotalar (opt-in): kök parolalı uç (`POST /portal/api/haklar/:id/surum`), kullanıcı yönetimi (`/portal/api/kullanicilar*`) ve güven kökü ekleyen anahtar kayıtları (`POST /portal/api/bayiler/:id/anahtar` · `POST /portal/api/yayincilar`) gövde okunmadan **404**, arayüz o ekranları açmaz; kök imzası ayrıca imza boğazında dinleyiciyle reddedilir (listeye yanlışlıkla girse de) | satıcı süreci + web arayüzü | — |

Kök parolası, TOTP tohumu ve başka kullanıcının parolası Cloudflare'den (TLS'i kenarda sonlanan üçüncü taraf) **geçmez**: sunucunun 404'ü gönderilmesini engelleyemez, engel ekrandadır — ERİŞİM oturumunda "Lisansı imzala/yenile" düğmesi ve "Portal kullanıcıları" sayfası yerine tailnet/geri döngü yolunu anlatan açıklama durur. ERİŞİM'den gelen her denetim satırı Access e-postasını taşır (`erisimKimligi`); kendi denetimini yazmayan yazma `ERISIM_YAZMA` satırı alır.

## 1. Ölçülmüş başlangıç durumu (2026-09-30)

| Ölçüm | Sonuç | Kaynak |
|---|---|---|
| Zero Trust takımı | **VAR** — `gentle-snow-a8b9.cloudflareaccess.com` (JWKS `https://gentle-snow-a8b9.cloudflareaccess.com/cdn-cgi/access/certs`, `iss` bu alan) | yönetici, salt okuma |
| Giriş yöntemi (IdP) | **YOK** → One-time PIN eklenecek | yönetici, salt okuma |
| Access uygulaması | **YOK** | yönetici, salt okuma |
| `portal.etkiliyazilim.com` DNS kaydı | **YOK** (`dig +short` boş) | Mac |
| Köken Cloudflare'e kapalı mı? | **HAYIR** — Mac'ten (CF dışı IP) `curl -sk --resolve lisans-test.etkiliyazilim.com:443:80.253.255.188 https://lisans-test.etkiliyazilim.com/saglik` → **200**; Traefik'te CF IP daraltması yok. Bu yüzden 2. ve 3. kapı ŞART | Mac |
| Köken sertifikası | Cloudflare Origin CA `*.etkiliyazilim.com` → `portal.` kapsanır | `SATICI-KURULUM.md` §1 |
| Satıcının dış bağlantısı | **YOK ve öyle KALIR** (yönetici kararı B, 2026-09-30: anahtar tutan konteynere çıkış açılmaz) → Access imza anahtarlarını `satici-jwks` yan konteyneri çeker, satıcı dosyayı salt okunur okur (§4, §5) | `deploy/satici/docker-compose*.yml` |

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

Önkoşul: satıcı imajı bu dilimi içerir (ERİŞİM dinleyicisi + `dist/jwks-cekici.js` + göç `20261001120000_portal_erisim_dinleyicisi`) — `deploy/satici/imaj-derle.sh` birleşmiş HEAD'den. Yan konteyner AYNI imajdır (yeni imaj/paket yok).

1. `deploy/vds-dogrula.sh` → AYNI.
2. Yedek: `sudo docker compose exec satici-yedek /arac/yedek-dongusu.sh tek`.
3. Göç (yeni imajla, tek seferlik): `sudo docker compose --profile goc run --rm satici-goc` → "All migrations have been successfully applied".
4. `deploy/satici/docker-compose.portal-genel.yml` → `/opt/stack/apps/tekserp-satici-<ortam>/` (compose'un yanına).
4b. **JWKS dizini** (yan konteyner yazar, satıcı salt okur; yoksa compose DURUR — `create_host_path: false`): `sudo install -d -o 10001 -g 10001 -m 0755 /opt/stack/apps/tekserp-satici-<ortam>/erisim-jwks` — sudo'suz: `SATICI-KURULUM.md` §12'deki tek seferlik yardımcı konteyner kalıbı (`--network none`, yalnız üst dizin bağlı, içeride `install -d -o 10001 -g 10001 -m 0755 …/erisim-jwks`). Anahtar biriminin, `/dosyalar`ın ve yayın kökünün İÇİNDE olmaz.
5. `.env`'e (sır DEĞİL):
   ```
   PORTAL_HOST=portal.etkiliyazilim.com
   CF_ACCESS_TAKIM_ALANI=gentle-snow-a8b9.cloudflareaccess.com
   CF_ACCESS_AUD=<§2.4 çıktısı>
   ERISIM_JWKS_DIZINI_HOST=/opt/stack/apps/tekserp-satici-<ortam>/erisim-jwks
   JWKS_CIKIS_AGI=172.31.255.0/29          # YALNIZ yan konteynerin köprüsü; docker network ls + ip -4 route ile çakışmadığı ÖLÇÜLÜR
   COMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml   # geri döngü kipi
   ```
6. Mac'te yalıtım denetimi: `node deploy/satici/compose-denetle.mjs --env-file <.env> --diger-env <öteki ortamın .env'i>` → kip satırında `örtü: portal-genel`, 0 ihlal; Ⓞ + ⑬a–h maddeleri (⑬g `satici-jwks` ortamı ALLOWLIST: `CF_ACCESS_TAKIM_ALANI` · `JWKS_DOSYASI` satıcınınkiyle aynı · `JWKS_CEKIM_DK` 1–60 · `NODE_ENV=production`, başka anahtar — `NODE_OPTIONS`, vekil — YOK · ⑬h `jwks-cikis` alt ağı = `.env`'deki `JWKS_CIKIS_AGI`, tek ipam girdisi: aşağıdaki DOCKER-USER kuralları o ağa bağlıdır; ⑥c ağda IPv6 kapalı) ve beklenen negatif sondalar [`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13.9-2'de. `--diger-env`siz koşumda ⑫ "ölçülmedi" basılır (çıkış 0; hazırlık + geri döngü + portal-genel örnek şablonlarla 66 geçti · 0 ihlal · 1 ölçülmedi, 2026-09-30 — her serviste ③b yalıtım gevşetmesi yok + ③c tanınan anahtarlar; kurgular ve on gevşetme örtüsü bekçi `satici test_compose_yalitimi`de).
7. `sudo docker compose up -d satici-jwks satici` → yan konteyner günlüğü `[jwks] yazıldı: N anahtar` (dosya `…/erisim-jwks/certs.json`, 10001, 0644); satıcı günlüğü `SATICI_DINLIYOR genel=4610 tailnet=4611 ic=4612 erisim=4613` ve `erisim: Cloudflare Access kapısı AÇIK (takım gentle-snow-a8b9…, JWKS dosyası /erisim-jwks/certs.json)`. Access ayarı eksikse satıcı AÇILIR ama `… yok — genel portal KAPALI … her isteğe 404` basar (fail-closed; `/v1` etkilenmez). Dosya henüz yoksa istekler 404 alır, yan konteyner yazınca (≤ 1 dk'da tekrar dener) kendiliğinden açılır.
8. JWKS sağlığı (tailnet/geri döngü yolundan): `/portal/saglik` → `erisim.kip: "acik"`, `erisim.jwks.dolu: true`, `sonHata: null`, `dosyaYasiSn` < ~660 (10 dk çekim + tazelik), `azamiYasSn: 604800`, `yasDurumu: "TAZE"`. Yaş saatlerce büyüyorsa yan konteynerin günlüğüne bak — eski ama geçerli küme YAŞ TAVANINA dek kabul edilir (`CF_ACCESS_JWKS_AZAMI_YAS_GUN`, varsayılan 7 gün; Cloudflare anahtarı 6 haftada döndürür, eskisi 7 gün daha geçerli): `UYARI` = tavanın yarısı geçti (satıcı günlüğünde saatte bir uyarı), `ASILDI` = genel portal HER isteğe 404 (`RED JWKS_ESKI`) — yan konteyner yazınca kendiliğinden açılır.
9. §2.5 DNS kaydı → §6 doğrulama → `deploy/vds-dogrula.sh` → AYNI.

## 5. Çıkış (JWKS) — yalnız yan konteyner, yalnız 443

Satıcı DIŞ BAĞLANTISIZDIR: katıldığı her ağ internal (geri döngü kipi; ana kipte internal olmayan tek ağı tailnet'tir ve DOCKER-USER onun çıkışını kapatır) — üst dosya ona ağ eklemez. Access imza anahtarlarını `satici-jwks` çeker: satıcıyla AYNI imaj, `node /uygulama/dist/jwks-cekici.js`; 10 dk'da bir `https://<takım>/cdn-cgi/access/certs` → satıcının kuralıyla doğrulama (RS256 · ≥ 2048 bit RSA · use=sig; geçerli anahtar yoksa YAZMAZ) → aynı dizinde geçici dosya + fsync + rename. Başarısız çekim eski dosyaya dokunmaz, 1 dk sonra yeniden dener. Sır, anahtar birimi, DB, port, Traefik etiketi YOK; yalnız kendi `jwks-cikis` köprüsünde. Satıcı dosyayı salt okunur okur (60 sn tazelik; bilinmeyen kid'de dosyayı bir kez yeniden okur; dosya yok/bozuk/boş küme ve önbellek hiç dolmadıysa RED; eski ama geçerli küme yaş tavanına dek — varsayılan 7 gün — kabul, aşan RED; yaş ve durum sağlıkta).

Yan konteynerin çıkışı YALNIZ 443 (+ DNS) — host kuralı (sudo; ana kipteki tailnet kuralları gibi DOCKER-USER'da; son eklenen başa geçer):
```bash
sudo iptables -I DOCKER-USER 1 -s <JWKS_CIKIS_AGI> -m conntrack --ctstate NEW -j DROP
sudo iptables -I DOCKER-USER 1 -s <JWKS_CIKIS_AGI> -p udp --dport 53 -m conntrack --ctstate NEW -j RETURN
sudo iptables -I DOCKER-USER 1 -s <JWKS_CIKIS_AGI> -p tcp -m multiport --dports 53,443 -m conntrack --ctstate NEW -j RETURN
```
Kural yalnız IPv4'ü ve yalnız `<JWKS_CIKIS_AGI>`yi daraltır: `sudo docker network inspect tekserp-satici-<ortam>-jwks-cikis --format '{{.EnableIPv6}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'` → `false <JWKS_CIKIS_AGI>` (compose denetimi ⑬h/⑥c bunu dosyada ölçer; daemon varsayılanını yalnız bu komut görür). Kuraldan sonra ölç: yan konteyner günlüğünde yeni `[jwks] yazıldı` (en geç 10 dk; `sudo docker compose restart satici-jwks` hemen dener) ve §4.8. Kalıcılık: kurallar yeniden başlatmada kaybolur — ana kipte `tekserp-satici-tailnet@` biriminin yaptığı gibi birime alınır (sudo, ayrı adım).

## 6. Doğrulama

| # | Komut | Nereden | Beklenen |
|---|---|---|---|
| 1 | `curl -sI https://portal.etkiliyazilim.com/portal/` | herhangi | **302** → `https://gentle-snow-a8b9.cloudflareaccess.com/cdn-cgi/access/login/…` (Access'siz istek kökene ulaşmaz) |
| 2 | `curl -sk -o /dev/null -w '%{http_code}\n' --resolve portal.etkiliyazilim.com:443:80.253.255.188 https://portal.etkiliyazilim.com/portal/` | Mac (CF dışı) | **403** (Traefik `ipallowlist`); ara katman yoksa **404** (satıcının JWT kapısı) — asla 200 |
| 3 | Tarayıcı: `https://portal.etkiliyazilim.com` → e-posta kodu → portal giriş ekranı → parola + TOTP | izinli e-posta | **200**, pano açılır; izinsiz e-posta Access'te durur |
| 4 | `cloudflared access curl https://portal.etkiliyazilim.com/portal/api/oturum` | izinli e-posta | **401 `OTURUM_YOK`** (Access kapısı geçildi, portal oturumu yok) |
| 5 | `cloudflared access curl -X POST -H 'Content-Type: application/json' -d '{}' https://portal.etkiliyazilim.com/portal/api/haklar/00000000-0000-4000-8000-000000000000/surum` | izinli e-posta | **404** — aynı anda `…/portal/api/pano` **401**: fark kök parolalı rotanın kapısından |
| 5b | `cloudflared access curl https://portal.etkiliyazilim.com/portal/api/kullanicilar` (tarayıcıdan alınan portal çerezi ile) | izinli e-posta | **404** (kullanıcı yönetimi yalnız tailnet); aynı uç `portal-baglan` yolunda **200** |
| 6 | Kurulum → Lisans sekmesi ve menü (genel yoldan girişte) | tarayıcı | "Lisansı imzala/yenile" YOK ve menüde "Portal kullanıcıları" YOK; yerlerinde tailnet/geri döngü yolunu anlatan açıklama |
| 6b | Denetim defteri → son `PORTAL_GIRIS` (genel yoldan) | tarayıcı | özette `erisimKimligi` = giriş yapan izinli e-posta; tailnet girişinde bu alan YOK |
| 7 | `node deploy/satici/portal-baglan.mjs` → `http://127.0.0.1:14611/portal/` | Mac | tailnet/geri döngü yolu DEĞİŞMEDİ: giriş + imza formu açık |
| 8 | `sudo docker compose logs satici \| grep "erisim:"` | VDS | `Cloudflare Access kapısı AÇIK`; 2. adımdan sonra (ara katman yoksa) `RED BASLIK_YOK` satırı, dakikada en çok bir |
| 9 | `sudo docker compose logs satici-jwks \| tail -3` | VDS | `[jwks] yazıldı: N anahtar` (10 dk'da bir); `çekilemedi (eski dosya KORUNDU)` sürüyorsa çıkış kuralı/DNS |
| 10 | `sudo docker network inspect tekserp-satici-<ortam>-jwks-cikis --format '{{range .Containers}}{{.Name}} {{end}}'` | VDS | YALNIZ `tekserp-satici-<ortam>-jwks` — satıcı bu köprüde DEĞİL |

## 6b. Bilinen davranış

- **İki ayrı oturum, iki ayrı saat:** Access oturumu (12 sa, e-posta kodundan itibaren) ve portal oturumu (12 sa mutlak, 30 dk boşta — parola + TOTP'den itibaren) bağımsızdır. Access oturumu dolunca arayüzün API çağrıları Cloudflare giriş sayfasına yönlenir ve ekran ağ hatası gösterir: sayfayı yenilemek e-posta koduna götürür, portal oturumu sürüyorsa kaldığı yerden devam eder.
- **Tek ad, tek ortam:** `portal.etkiliyazilim.com` bir anda YALNIZ bir satıcı ortamına (bugün `hazirlik`) bağlanır — `PORTAL_HOST` o ortamın `.env`'indedir. Üretim satıcısı kurulunca ad ona taşınır (hazırlıkta satır kaldırılır, üretimde eklenir) ya da hazırlığa ayrı ad verilir; iki ortam aynı adı taşıyamaz (Traefik iki yönlendiriciyi çakıştırır).
- Portal arayüzünün statik dosyaları (`/portal/assets/*`, içerik özetli, `immutable`) Cloudflare kenarında önbelleğe girebilir; Access denetimi önbellekten ÖNCE koşar ve bu dosyalar sır taşımaz. API ve giriş HTML'i `no-store`.

## 7. Ana (Tailscale) kipe geçerken

Üst dosya satıcıya ağ eklemediği için satıcının yönlendirmesi ana kipte de DEĞİŞMEZ (internal olmayan tek ağı tailnet; DOCKER-USER onun çıkışını kapatır). Yan konteyner kendi köprüsünde bağımsızdır; ana kipte de §5'teki 443 kuralı geçerlidir.

## 8. Geri alma

1. `.env`'deki `COMPOSE_FILE`'dan `:docker-compose.portal-genel.yml` çıkarılır → `sudo docker compose up -d --remove-orphans satici` (yan konteyner kaldırılır) → günlük `erisim=kapali`; sonra `sudo docker network rm tekserp-satici-<ortam>-jwks-cikis` ve §5'in DOCKER-USER satırları `-D` ile silinir. JWKS dizini kalabilir (açık anahtarlar, sır değil).
2. Cloudflare: DNS `portal` kaydı silinir (ya da kalır — köken artık o Host'u yönlendirmez); Access uygulaması silinir ya da politikası boşaltılır.
3. Göç geri alınmaz (enum değeri `ERISIM` kalır, zararsız): eski imaj bu değeri yazmaz, oturumu yalnız belirteç özetiyle okur; ERİŞİM oturumları budamayla gider.
4. `deploy/vds-dogrula.sh` → AYNI.
