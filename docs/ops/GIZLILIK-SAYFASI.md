# Yasal sayfalar — `https://tekserp.etkiliyazilim.com/gizlilik` (Play K2) · `/yonetim-gizlilik` (eski `/patron-gizlilik` → 301)

> Durum (2026-10-08): YAYINDA — DNS proxy açık, `olc.mjs` tamamen yeşil (e-posta karartması email_off ile kapatıldı). Karar: kullanıcı K2, 2026-10-08 (`PLAY-KONSOL-FORMLARI.md` §0).

| | |
|---|---|
| Metin (tek kaynak) | `docs/legal/GIZLILIK-POLITIKASI.md` → `html/gizlilik.html` (tablet) · `docs/legal/PATRON-GIZLILIK-POLITIKASI.md` → `html/yonetim-gizlilik.html` (TeksERP Yönetim) — ikisi de `node deploy/gizlilik-sayfasi/uret.mjs` (`SAYFALAR`) |
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

## Patron sayfası (`/yonetim-gizlilik`; 2026-10-15 `/patron-gizlilik` olarak doğdu, 2026-10-16 ad değişimi)

- TeksERP Yönetim (patron) uygulamasının Play gizlilik politikası (`YONETIM-GP-2026.3`) ve hesap silme adresi
  `https://tekserp.etkiliyazilim.com/yonetim-gizlilik#hesap-silme` (çapa "Hesap silme" başlığından; başlık değişmez).
  Aynı köken, aynı konteyner; nginx'te ayrı konum (`= /yonetim-gizlilik` + `= /yonetim-gizlilik/` → 301). Tablet sayfası bayt-eşit kalır.
- Emekli yol: `= /patron-gizlilik` ve `= /patron-gizlilik/` → kalıcı 301 `/yonetim-gizlilik` (`uret.mjs` `YONLENDIRMELER`,
  bekçi §4; `#hesap-silme` çapası sunucuya gelmez, tarayıcı 301 hedefine kendisi ekler). `vds-kur.sh --uygula` eski
  `html/patron-gizlilik.html`'i `onceki/`'ye taşır ve konteyner içinden 301'i ölçer; `olc.mjs` canlıda iki eski yolu da ölçer.
- İlk yayın conf değiştirdiği için `--html` kipi YETMEZ (VDS conf'u repodakinden farklıyken durur): kuru
  `deploy/gizlilik-sayfasi/vds-kur.sh` → `deploy/gizlilik-sayfasi/vds-kur.sh --uygula` → `node deploy/gizlilik-sayfasi/olc.mjs`
  (kenar ≤ 5 dk'da tazelenir). DNS/Cloudflare adımı yok (aynı ad). 2026-10-16 ad değişimi de conf değiştirir → yine `--uygula`.
  Sonra yalnız metin değişikliğinde `--html`.
- Metin koddan ölçülür: süreler (`patron/sunucu` `IDENTITY_PURGE_DAYS` · `IP_RETENTION_DAYS` · denetim saklama
  varsayılanları) ve `NATIVE_PUSH` cümlesi bekçi §7'de; native push açılınca politika §2/§4 + `PATRON-MAGAZA-ANDROID.md` §4.2 birlikte güncellenir.

## Güncelleme ve geri alma

- Metin değişikliği: kaynak → `uret.mjs` → commit → `vds-kur.sh --html` (kuru) → `vds-kur.sh --html --uygula` (yalnız `html/gizlilik.html` değişir; önceki `onceki/html_gizlilik.html`; konteyner yeniden başlamaz). compose/conf değişirse `--uygula`.
- E-posta: Cloudflare "Email Address Obfuscation" zone genelinde açık ve adresi çözücü betiğe bağlar; CSP (`default-src 'none'`) betiği engellediği için adres görünmez. Zone ayarına dokunulmaz — `uret.mjs` her adresi `<!--email_off-->…<!--/email_off-->` ile sarar (bekçi §1 ölçer). Kenar bu iki yorum işaretini siler, başka bayta dokunmaz (ölçüldü 2026-10-08); `olc.mjs` bayt-eşitliği işaretler çıkarılmış repo html'ine karşı ölçer ve `[email protected]`/`cdn-cgi/l/email-protection` yokluğunu ayrıca denetler.
- vc60 (yalnız şifreli bağlantı) yayına çıkınca: politika §7 + Play veri güvenliği Soru 2 birlikte güncellenir (K3).
- Geri alma: önce Cloudflare'de `tekserp` DNS kaydı silinir, sonra `vds-kur.sh --geri-al` (konteyner durur, dizin SİLİNMEZ). adnansahin ve indir etkilenmez; her adımda komşu ölçümü koşulur.
