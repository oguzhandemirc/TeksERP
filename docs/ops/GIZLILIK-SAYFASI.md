# Gizlilik sayfası — `https://tekserp.etkiliyazilim.com/gizlilik` (Play K2)

> Durum (2026-10-08): VDS'e KURULDU (`736c9f8a1`; konteyner içi 200 bayt-eşit, köke Cloudflare'siz 403, adnansahin/vds-dogrula önce=sonra AYNI); DNS kaydı yok — kullanıcı adımı bekliyor. Karar: kullanıcı K2, 2026-10-08 (`PLAY-KONSOL-FORMLARI.md` §0).

| | |
|---|---|
| Metin (tek kaynak) | `docs/legal/GIZLILIK-POLITIKASI.md` → `node deploy/gizlilik-sayfasi/uret.mjs` → `deploy/gizlilik-sayfasi/html/gizlilik.html` |
| Köken | VDS `/opt/stack/apps/tekserp-gizlilik` — compose projesi/konteyner `tekserp-gizlilik` (nginx:alpine, salt-okunur kök, 32m) |
| Kenar | Traefik yönlendirici `tekserp-gizlilik` → `tekserp-gizlilik-cf` (Cloudflare ipallowlist) → `tekserp-gizlilik-hiz`; TLS Origin CA `*.etkiliyazilim.com` |
| Ayrılık | indir kapısının (Worker) ve eski güncelleme sitesinin DIŞINDA; ortak ara katman yok |
| Bekçi | `node scripts/test_gizlilik_sayfasi.mjs` (+ `--sonda`) |

## Kurulum sırası

1. Metindeki köşeli parantezli alanlar doldurulur (2026-10-08: unvan "Etkili Yazılım Ltd. Şti.", adres satırı kaldırıldı; hukukçu incelemesi yapılmadı — kullanıcı kararı) → `node deploy/gizlilik-sayfasi/uret.mjs` → commit (+ isteğe bağlı hukukçu incelemesi). Yer tutucu kaldıkça `--uygula` durur.
2. Kuru: `deploy/gizlilik-sayfasi/vds-kur.sh` — bekçi, VDS önkoşulları, köken durumu, komşu ölçümü (adnansahin + indir); VDS'e yazmaz.
3. Uygula: `deploy/gizlilik-sayfasi/vds-kur.sh --uygula` — `nginx -t` → yardımcı konteynerle dosyalar (root 0644, öncekiler `onceki/`) → `docker compose up -d --force-recreate` → konteyner içinden sayfa = repo → köke Cloudflare'siz istek 403 → komşu ölçümü sonra.
4. Cloudflare DNS (kullanıcı, aşağıda). DNS EN SON: köken kapılı olmadan ad çözülmez.
5. Ölçüm: `node deploy/gizlilik-sayfasi/olc.mjs` — DNS proxy açık, 200 + bayt-eşit, kısa önbellek, CSP, yönlendirmeler, 404 no-store, köke doğrudan 403, adnansahin 200, indir 403.
6. Play Console → Uygulama içeriği → Gizlilik politikası → URL'yi gir.

## Cloudflare adımı (kullanıcı)

1. `dash.cloudflare.com` → hesap → **etkiliyazilim.com** alanı.
2. Sol menü **DNS** → **Records** → **Add record**.
3. Type **A** · Name **`tekserp`** · IPv4 address **`80.253.255.188`** · Proxy status **Proxied** (turuncu bulut AÇIK) · TTL **Auto** → **Save**.
4. Kontrol: alanın **Workers Routes** listesinde `*.etkiliyazilim.com/*` joker rota ya da `tekserp.etkiliyazilim.com` rotası YOK (olursa sayfa belirteç ister); **Zero Trust → Access → Applications**'ta bu adı kapsayan uygulama YOK; **Security → WAF**'ta ülke engeli bu adı kapsamaz (Play coğrafi kısıt istemez).

## Güncelleme ve geri alma

- Metin değişikliği: kaynak → `uret.mjs` → commit → `vds-kur.sh --uygula` (aynı yol; kenar 5 dk içinde tazelenir).
- vc60 (yalnız şifreli bağlantı) yayına çıkınca: politika §7 + Play veri güvenliği Soru 2 birlikte güncellenir (K3).
- Geri alma: önce Cloudflare'de `tekserp` DNS kaydı silinir, sonra `vds-kur.sh --geri-al` (konteyner durur, dizin SİLİNMEZ). adnansahin ve indir etkilenmez; her adımda komşu ölçümü koşulur.
